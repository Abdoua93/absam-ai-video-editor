import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isValidHfToken } from './utils.js';

const int = (value, fallback) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const bool = (value, fallback = false) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const number = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env support (no dependency). Real environment variables win.
const envFile = path.join(projectRoot, '.env');
if (fs.existsSync(envFile)) {
  for (const raw of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

const resolvePath = (value, fallback) => {
  const raw = value || fallback;
  return path.resolve(path.isAbsolute(raw) ? raw : path.join(projectRoot, raw));
};
const dataDir = resolvePath(process.env.DATA_DIR, 'data');
const ltxToken = process.env.HF_LTX_TOKEN || process.env.HF_TOKEN || '';

export const config = {
  projectRoot,
  dataDir,
  projectsDir: path.join(dataDir, 'projects'),
  cacheDir: path.join(dataDir, 'cache'),
  tempDir: path.join(dataDir, 'tmp'),
  jobsFile: path.join(dataDir, 'jobs.json'),
  port: int(process.env.PORT, 8080),
  host: process.env.HOST || '0.0.0.0',
  publicBaseUrl: process.env.PUBLIC_BASE_URL || '',
  appPassword: process.env.APP_PASSWORD || '',
  maxUploadMb: int(process.env.MAX_UPLOAD_MB, 800),
  maxClips: int(process.env.MAX_CLIPS, 20),
  jobConcurrency: int(process.env.JOB_CONCURRENCY, 1),
  ffmpegBin: process.env.FFMPEG_BIN || 'ffmpeg',
  ffprobeBin: process.env.FFPROBE_BIN || 'ffprobe',
  fontsDir: resolvePath(process.env.FONTS_DIR, 'assets/fonts'),
  defaultFont: process.env.SUBTITLE_FONT || 'Noto Naskh Arabic',
  ffmpegPreset: process.env.FFMPEG_PRESET || 'veryfast',
  ffmpegCrf: int(process.env.FFMPEG_CRF, 21),
  outputFps: int(process.env.OUTPUT_FPS, 30),
  outputWidth: 1920,
  outputHeight: 1080,
  whisperBin: process.env.WHISPER_BIN || '',
  whisperModel: process.env.WHISPER_MODEL || '',
  whisperLang: process.env.WHISPER_LANG || 'ar',
  // AI generation subsystem (provider-swappable; free engines only).
  video: {
    provider: process.env.VIDEO_PROVIDER || 'huggingface-ltx',
    jobsFile: path.join(dataDir, 'video-jobs.json'),
    concurrency: int(process.env.VIDEO_JOB_CONCURRENCY, 1),
    maxImageMb: int(process.env.MAX_GENERATION_IMAGE_MB, 10),
    timeoutMs: int(process.env.VIDEO_GENERATION_TIMEOUT_MS, 30) * 60 * 1000,
    // Default: free Upsampler LTX 2.3 Space (text + image to video).
    // Low-resolution presets keep each run inside the free ZeroGPU quota.
    // HF_TOKEN / HF_LTX_TOKEN are optional and stay server-side.
    ltx: {
      spaceId: process.env.HF_LTX_SPACE_ID || 'Upsampler/ltx-video',
      spaceApiUrl: process.env.HF_LTX_SPACE_API_URL || `https://huggingface.co/api/spaces/${process.env.HF_LTX_SPACE_ID || 'Upsampler/ltx-video'}`,
      baseUrl: process.env.HF_LTX_SPACE_URL || 'https://upsampler-ltx-video.hf.space',
      apiName: process.env.HF_LTX_GRADIO_API_NAME || 'generate_video',
      token: ltxToken,
      // Safe, value-free flag: malformed/terminal-pasted values are rejected
      // before any Bearer header is built, so fetch cannot fail locally.
      tokenFormatValid: isValidHfToken(ltxToken),
      whoamiUrl: process.env.HF_WHOAMI_URL || 'https://huggingface.co/api/whoami-v2',
      timeoutMs: int(process.env.HF_LTX_GENERATION_TIMEOUT_MS, 10) * 60 * 1000,
      statusTimeoutMs: int(process.env.HF_STATUS_TIMEOUT_MS, 10) * 1000,
      highRes: bool(process.env.HF_LTX_HIGH_RES, false),
      enhancePrompt: bool(process.env.HF_LTX_ENHANCE_PROMPT, false),
      randomizeSeed: bool(process.env.HF_LTX_RANDOMIZE_SEED, true),
      seed: int(process.env.HF_LTX_SEED, 10)
    },
    // Legacy free Gradio Space, kept registered as a rollback option.
    // HF_TOKEN is optional and stays server-side; the space is public.
    huggingface: {
      spaceId: process.env.HF_SPACE_ID || 'Hamzakhan1/wan2.2-text-image-to-video',
      spaceApiUrl: process.env.HF_SPACE_API_URL || `https://huggingface.co/api/spaces/${process.env.HF_SPACE_ID || 'Hamzakhan1/wan2.2-text-image-to-video'}`,
      baseUrl: process.env.HF_SPACE_URL || 'https://hamzakhan1-wan2-2-text-image-to-video.hf.space',
      apiName: process.env.HF_GRADIO_API_NAME || 'generate_video',
      token: process.env.HF_TOKEN || '',
      timeoutMs: int(process.env.HF_GENERATION_TIMEOUT_MS, 15) * 60 * 1000,
      statusTimeoutMs: int(process.env.HF_STATUS_TIMEOUT_MS, 10) * 1000,
      samplingSteps: int(process.env.HF_SAMPLING_STEPS, 20),
      guideScale: process.env.HF_GUIDE_SCALE ? number(process.env.HF_GUIDE_SCALE, null) : null,
      shift: process.env.HF_SHIFT ? number(process.env.HF_SHIFT, null) : null,
      solver: process.env.HF_SOLVER || 'unipc',
      offloadModel: bool(process.env.HF_OFFLOAD_MODEL, true)
    },
    // Legacy local adapter, kept registered for backwards compatibility only.
    wan22: {
      enabled: bool(process.env.WAN22_ENABLED, true),
      python: process.env.WAN22_PYTHON || 'python3',
      runner: resolvePath(process.env.WAN22_RUNNER, 'scripts/wan22_runner.py'),
      modelDir: process.env.WAN22_MODEL_DIR ? resolvePath(process.env.WAN22_MODEL_DIR, '') : '',
      modelName: process.env.WAN22_MODEL_NAME || 'Wan-AI/Wan2.2-T2V-A14B-Diffusers',
      imageModelName: process.env.WAN22_IMAGE_MODEL_NAME || 'Wan-AI/Wan2.2-I2V-A14B-Diffusers',
      device: process.env.WAN22_DEVICE || 'auto',
      localFilesOnly: bool(process.env.WAN22_LOCAL_FILES_ONLY, true),
      fps: int(process.env.WAN22_FPS, 16)
    }
  },
  // S3 / MinIO is optional. When S3_ENDPOINT is set, assets are stored there;
  // FFmpeg still works on a local cache copy downloaded on demand.
  s3: {
    endpoint: process.env.S3_ENDPOINT || '',
    region: process.env.S3_REGION || 'us-east-1',
    bucket: process.env.S3_BUCKET || 'absam-video',
    accessKey: process.env.S3_ACCESS_KEY || '',
    secretKey: process.env.S3_SECRET_KEY || '',
    forcePathStyle: bool(process.env.S3_FORCE_PATH_STYLE, true),
    useSsl: bool(process.env.S3_USE_SSL, false)
  }
};

for (const dir of [dataDir, config.projectsDir, config.cacheDir, config.tempDir]) {
  fs.mkdirSync(dir, { recursive: true });
}
