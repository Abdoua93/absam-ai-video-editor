import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Wan 2.2 provider adapter. It NEVER calls a paid API and NEVER fakes output.
 * The Python runner is expected to be provided locally by the operator; this
 * module only passes absolute local paths and validates that a real MP4 came
 * back. The runner can use diffusers/transformers, ComfyUI, or any local
 * Wan 2.2 implementation that accepts the documented JSON payload.
 */
export function createWan22Provider({ config, logger }) {
  const wan = config.video.wan22;
  const runner = wan.runner;

  function resolveModelDir() {
    if (!wan.modelDir) return '';
    return path.isAbsolute(wan.modelDir)
      ? wan.modelDir
      : path.resolve(config.projectRoot, wan.modelDir);
  }

  async function availability() {
    if (!wan.enabled) {
      return { available: false, reason: 'محرك Wan 2.2 معطّل عبر WAN22_ENABLED=0.' };
    }
    if (!fs.existsSync(runner)) {
      return {
        available: false,
        reason: 'محرك Wan 2.2 غير مثبّت. ضع wan22_runner.py في scripts/ أو اضبط WAN22_RUNNER.'
      };
    }
    if (wan.localFilesOnly && !resolveModelDir()) {
      return {
        available: false,
        reason: 'لم يتم ضبط WAN22_MODEL_DIR. حمّل أوزان Wan 2.2 محلياً ثم اضبط المسار (بدون مفاتيح أو خدمات مدفوعة).'
      };
    }
    return { available: true, reason: '' };
  }

  async function generate({ job, input, imagePath, outputPath, signal, context }) {
    const status = await availability();
    if (!status.available) throw new Error(status.reason);

    const payload = {
      mode: input.mode,
      prompt: input.prompt,
      ratio: input.ratio,
      width: input.size.width,
      height: input.size.height,
      duration: input.duration,
      fps: wan.fps,
      image: imagePath ? path.resolve(imagePath) : null,
      output: path.resolve(outputPath),
      modelDir: resolveModelDir(),
      model: input.mode === 'image' ? wan.imageModelName : wan.modelName,
      device: wan.device,
      localFilesOnly: wan.localFilesOnly
    };

    const child = spawn(wan.python, [runner], {
      cwd: config.projectRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    });

    // The runner reads its job description from stdin.
    child.stdin.on('error', () => {
      // Runner may exit before consuming input; its exit code is checked below.
    });
    child.stdin.end(`${JSON.stringify(payload)}\n`);

    let stdoutTail = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdoutTail = `${stdoutTail}${text}`.slice(-2000);
      const emit = context?.log || logger;
      emit?.(`[wan22 ${job.id}] ${text.trim()}`);
      // Runner may emit PROGRESS:<0-100> lines; map them to job progress.
      const match = text.match(/PROGRESS:\s*(\d{1,3})/i);
      if (match && context?.progress) {
        context.progress(Number(match[1]) / 100, 'generating');
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString().slice(-4000);
    });

    const onAbort = () => child.kill('SIGTERM');
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const code = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error('انتهت مهلة توليد الفيديو.'));
        }, config.video.timeoutMs);
        child.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
        child.on('close', (exitCode) => {
          clearTimeout(timer);
          resolve(exitCode);
        });
      });

      const details = (stderr || stdoutTail).trim().slice(-500);
      if (code !== 0 || !fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1024) {
        throw new Error(
          `فشل محرك Wan 2.2 في إخراج فيديو صالح.${details ? ` التفاصيل: ${details}` : ''}`
        );
      }
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  return {
    id: 'wan22-local',
    name: 'Wan 2.2 (local)',
    description: 'Local open-source Wan 2.2 engine for text/image to video.',
    capabilities: { textToVideo: true, imageToVideo: true, ratios: ['9:16', '16:9', '1:1'], durations: [5, 10] },
    availability,
    generate
  };
}
