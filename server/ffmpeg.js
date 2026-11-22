import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { cleanLogLine, clamp } from './utils.js';

/**
 * Spawn FFmpeg/FFprobe and stream progress back. Never builds a shell string:
 * every argument is passed as an array element, so uploaded names are safe.
 */
export function runCommand(bin, args, options = {}) {
  const { onProgress, onLog, onStdout, signal, duration = 0 } = options;
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(bin, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        signal,
        windowsHide: true
      });
    } catch (error) {
      reject(error);
      return;
    }

    let stdout = '';
    let stderr = '';
    let lastTime = 0;

    const emitProgress = (line) => {
      const [key, raw] = line.split(/=(.*)/s, 2);
      if (!raw) return;
      const value = raw.trim();
      if (key === 'out_time_ms') {
        // FFmpeg >= 5 reports microseconds here. Older builds report a clock.
        const numeric = Number(value);
        lastTime = Number.isFinite(numeric) ? numeric / 1e6 : 0;
      } else if (key === 'out_time') {
        const parts = value.split(':').map(Number);
        if (parts.length === 3) lastTime = parts[0] * 3600 + parts[1] * 60 + parts[2];
      } else if (key === 'frame') {
        onProgress?.({ frame: Number(value) || 0, time: lastTime, ratio: ratioOf(lastTime, duration) });
        return;
      } else if (key === 'speed') {
        onProgress?.({ speed: value, time: lastTime, ratio: ratioOf(lastTime, duration) });
        return;
      }
      onProgress?.({ time: lastTime, ratio: ratioOf(lastTime, duration) });
    };

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stdout += text;
      if (onStdout) {
        for (const line of text.split(/\r?\n/)) if (line.trim()) onStdout(line);
      }
      if (onProgress) {
        for (const line of text.split(/\r?\n/)) if (line.includes('=')) emitProgress(line);
      }
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stderr += text;
      if (onLog) {
        for (const line of text.split(/\r?\n/)) {
          const clean = cleanLogLine(line);
          if (clean && /(error|warning|invalid|failed)/i.test(clean)) onLog(clean);
        }
      }
    });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

const ratioOf = (time, duration) =>
  duration > 0 ? clamp(time / duration, 0, 1) : 0;

export async function probe(file) {
  const { code, stdout } = await runCommand(config.ffprobeBin, [
    '-v', 'error',
    '-show_entries', 'format=duration,size:stream=index,codec_type,codec_name,width,height,r_frame_rate,duration',
    '-of', 'json',
    file
  ]);
  let meta = {};
  try {
    meta = JSON.parse(stdout);
  } catch {
    throw new Error('Could not read media metadata (ffprobe output was not JSON).');
  }
  if (code !== 0) throw new Error('ffprobe failed to read this file.');

  const video = (meta.streams || []).find((s) => s.codec_type === 'video');
  const audio = (meta.streams || []).find((s) => s.codec_type === 'audio');
  if (!video) throw new Error('The uploaded file has no video stream.');

  const [fpsNum, fpsDen] = String(video.r_frame_rate || '30/1').split('/').map(Number);
  const streamDuration = Number(video.duration) || Number(meta.format?.duration) || 0;
  return {
    duration: Number.isFinite(streamDuration) ? streamDuration : 0,
    width: Number(video.width) || 0,
    height: Number(video.height) || 0,
    fps: fpsDen ? fpsNum / fpsDen : fpsNum || 30,
    hasAudio: Boolean(audio),
    videoCodec: video.codec_name || '',
    audioCodec: audio?.codec_name || '',
    size: Number(meta.format?.size) || 0
  };
}

export async function ffmpegVersion() {
  try {
    const { code, stdout } = await runCommand(config.ffmpegBin, ['-version']);
    return code === 0 ? stdout.split('\n')[0] : '';
  } catch {
    return '';
  }
}

export async function makeThumbnail(input, output, atSecond = 1) {
  const { code } = await runCommand(config.ffmpegBin, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', String(Math.max(0, atSecond)),
    '-i', input,
    '-frames:v', '1',
    '-vf', 'scale=360:-2',
    '-q:v', '5',
    output
  ]);
  return code === 0 && fs.existsSync(output);
}

/** Write an FFmpeg concat-demuxer list with correctly escaped absolute paths. */
export function writeConcatList(file, paths) {
  const lines = paths.map((item) => `file '${String(item).replaceAll("'", "'\\''")}'`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

export function tempFile(prefix, extension) {
  return path.join(config.tempDir, `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`);
}

export function cleanup(...files) {
  for (const file of files.flat()) {
    try {
      if (file) fs.rmSync(file, { force: true });
    } catch {
      // Best effort only.
    }
  }
}
