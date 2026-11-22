import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { config } from './config.js';
import { probe, ffmpegVersion, makeThumbnail, tempFile, cleanup } from './ffmpeg.js';
import { createProject, getProject, listProjects, saveProject } from './projects.js';
import { cuesFromInput, toSrt } from './subtitles.js';
import { whisperStatus } from './transcribe.js';
import { enqueue, getJob, waitFor, subscribe, cancel } from './jobs.js';
import * as storage from './storage.js';
import { uid, safeName, formatBytes } from './utils.js';

const router = express.Router();

// Videos stream to disk: an 800 MB phone recording should never sit in RAM.
const videoUpload = multer({
  storage: multer.diskStorage({
    destination: config.tempDir,
    filename: (_req, file, done) => done(null, `${uid('upload_')}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: config.maxClips }
});

// Subtitle/audio assets are small enough for memory storage.
const assetUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 }
});

const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.3gp', '.ts']);
const AUDIO_EXT = new Set(['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.opus', '.flac']);

const isVideo = (file) => file.mimetype.startsWith('video/') || VIDEO_EXT.has(path.extname(file.originalname).toLowerCase());
const isAudio = (file) => file.mimetype.startsWith('audio/') || AUDIO_EXT.has(path.extname(file.originalname).toLowerCase());

const fail = (res, status, message) => res.status(status).json({ error: message });
const requireProject = (req, res, next) => {
  const project = getProject(req.params.id);
  if (!project) return fail(res, 404, 'Project not found.');
  req.project = project;
  next();
};

function publicJob(job) {
  if (!job) return null;
  return { ...job, log: job.log.slice(-30) };
}

function timelineDuration(project) {
  return project.clips.reduce(
    (sum, clip) => sum + (clip.trims?.length
      ? clip.trims.reduce((inner, trim) => inner + trim.end - trim.start, 0)
      : clip.duration || 0),
    0
  );
}

router.get('/health', async (_req, res) => {
  res.json({
    ok: true,
    app: 'ABSAM AI Video Editor',
    version: '1.0.0',
    ffmpeg: (await ffmpegVersion()) || null,
    whisper: whisperStatus(),
    storage: storage.isRemote() ? 's3-compatible' : 'local',
    maxUploadMb: config.maxUploadMb,
    maxClips: config.maxClips
  });
});

router.post('/projects', (req, res) => {
  res.status(201).json(createProject(req.body?.title || 'My video'));
});

router.get('/projects', (_req, res) => res.json(listProjects()));

router.get('/projects/:id', requireProject, (req, res) => res.json(req.project));

router.delete('/projects/:id', requireProject, async (req, res) => {
  await storage.removePrefix(`projects/${req.project.id}`);
  res.json({ ok: true });
});

router.post('/projects/:id/clips', requireProject, videoUpload.array('files', config.maxClips), async (req, res) => {
  const files = req.files || [];
  if (!files.length) return fail(res, 400, 'Choose at least one video file.');
  const bad = files.find((file) => !isVideo(file));
  if (bad) {
    cleanup(files.map((file) => file.path));
    return fail(res, 415, `"${bad.originalname}" is not a video file.`);
  }
  const project = req.project;
  if (project.clips.length + files.length > config.maxClips) {
    cleanup(files.map((file) => file.path));
    return fail(res, 400, `A project can hold at most ${config.maxClips} clips.`);
  }

  const added = [];
  try {
    for (const file of files) {
      const scratch = file.path;
      try {
        const meta = await probe(scratch);
        const key = storage.keyFor(project.id, 'clips', file.originalname);
        await storage.put(key, scratch);
        const clip = {
          id: uid('clip_'),
          name: safeName(file.originalname),
          originalName: file.originalname.slice(0, 160),
          key,
          thumbnailKey: null,
          duration: meta.duration,
          width: meta.width,
          height: meta.height,
          fps: meta.fps,
          hasAudio: meta.hasAudio,
          size: file.size,
          trims: [],
          analysis: null
        };
        const local = await storage.localFile(key);
        const thumb = tempFile('thumb', 'jpg');
        if (await makeThumbnail(local, thumb, Math.min(1, meta.duration / 2))) {
          clip.thumbnailKey = storage.keyFor(project.id, 'thumbs', `${clip.id}.jpg`);
          await storage.put(clip.thumbnailKey, thumb);
        }
        cleanup([thumb]);
        project.clips.push(clip);
        added.push(clip);
      } finally {
        cleanup([scratch]);
      }
    }
    saveProject(project);
    res.status(201).json({ clips: added, project });
  } catch (error) {
    for (const clip of added) {
      await storage.remove(clip.key);
      await storage.remove(clip.thumbnailKey);
    }
    fail(res, 422, error.message || 'Could not read the uploaded video.');
  }
});

router.delete('/projects/:id/clips/:clipId', requireProject, async (req, res) => {
  const index = req.project.clips.findIndex((clip) => clip.id === req.params.clipId);
  if (index < 0) return fail(res, 404, 'Clip not found.');
  const [clip] = req.project.clips.splice(index, 1);
  await storage.remove(clip.key);
  await storage.remove(clip.thumbnailKey);
  saveProject(req.project);
  res.json({ ok: true });
});

router.get('/projects/:id/clips/:clipId/thumbnail', requireProject, async (req, res) => {
  const clip = req.project.clips.find((item) => item.id === req.params.clipId);
  if (!clip?.thumbnailKey) return fail(res, 404, 'No thumbnail yet.');
  try {
    const stream = await storage.createReadStream(clip.thumbnailKey);
    res.type('image/jpeg');
    stream.pipe(res);
  } catch {
    fail(res, 404, 'Thumbnail storage error.');
  }
});

router.patch('/projects/:id/settings', requireProject, (req, res) => {
  const allowed = new Set([
    'autoTrim', 'targetSeconds', 'maxClipSeconds', 'minClipSeconds',
    'silenceThresholdDb', 'sceneThreshold', 'subtitleMode', 'subtitleFont',
    'subtitleFontSize', 'subtitleRtl', 'musicMode', 'musicVolume',
    'musicFadeSeconds', 'quality'
  ]);
  const trimKeys = ['autoTrim', 'targetSeconds', 'maxClipSeconds', 'minClipSeconds', 'silenceThresholdDb', 'sceneThreshold'];
  const trimChanged = Object.keys(req.body || {}).some((key) => trimKeys.includes(key));
  for (const [key, value] of Object.entries(req.body || {})) {
    if (allowed.has(key)) req.project.settings[key] = value;
  }
  if (trimChanged) {
    // A trim plan belongs to the settings that produced it — invalidate it.
    for (const clip of req.project.clips) {
      clip.trims = [];
      clip.analysis = null;
    }
  }
  saveProject(req.project);
  res.json(req.project.settings);
});

router.post('/projects/:id/subtitles', requireProject, assetUpload.single('file'), async (req, res) => {
  let text = String(req.body?.text || '');
  if (req.file) {
    if (req.file.size > 2 * 1024 * 1024) return fail(res, 413, 'Subtitle file is too large.');
    text = req.file.buffer.toString('utf8').replace(/^\uFEFF/, '').replace(/\0/g, '');
  }
  const cues = cuesFromInput(text, timelineDuration(req.project));
  if (!cues.length) return fail(res, 400, 'No subtitle lines found.');
  if (req.file) {
    req.project.assets.subtitleKey = storage.keyFor(req.project.id, 'assets', req.file.originalname);
    await storage.put(req.project.assets.subtitleKey, req.file.buffer);
  }
  req.project.subtitles = cues;
  req.project.settings.subtitleMode = req.body?.mode || 'provided';
  saveProject(req.project);
  res.json({ cues, mode: req.project.settings.subtitleMode });
});

router.post('/projects/:id/music', requireProject, assetUpload.single('file'), async (req, res) => {
  if (!req.file) return fail(res, 400, 'Choose an audio file.');
  if (!isAudio(req.file)) return fail(res, 415, 'Choose an audio (MP3, M4A, WAV...) file.');
  const key = storage.keyFor(req.project.id, 'assets', req.file.originalname);
  await storage.put(key, req.file.buffer);
  req.project.assets.musicKey = key;
  req.project.assets.musicName = safeName(req.file.originalname);
  req.project.settings.musicMode = 'upload';
  saveProject(req.project);
  res.json({ name: req.project.assets.musicName, size: formatBytes(req.file.size) });
});

router.delete('/projects/:id/assets/:kind', requireProject, async (req, res) => {
  const keyName = req.params.kind === 'music' ? 'musicKey' : 'subtitleKey';
  const key = req.project.assets[keyName];
  await storage.remove(key);
  req.project.assets[keyName] = null;
  if (req.params.kind === 'music') req.project.settings.musicMode = 'ambient';
  else {
    req.project.subtitles = [];
    req.project.settings.subtitleMode = 'none';
  }
  saveProject(req.project);
  res.json({ ok: true });
});

router.post('/projects/:id/analyze', requireProject, async (req, res) => {
  const job = enqueue('analyze', { projectId: req.project.id }, req.project.id);
  try {
    const finished = await waitFor(job.id, 10 * 60 * 1000);
    if (finished.status === 'failed') return fail(res, 422, finished.error);
    res.json({ job: publicJob(finished), project: getProject(req.project.id) });
  } catch (error) {
    fail(res, 504, error.message);
  }
});

router.post('/projects/:id/render', requireProject, (req, res) => {
  if (req.project.settings.subtitleMode === 'whisper' && !whisperStatus().available) {
    return fail(res, 400, 'Local Whisper is not configured. Paste subtitles or choose ambient/no subtitles.');
  }
  const jobId = uid('job_');
  const job = enqueue('render', { projectId: req.project.id, jobId }, req.project.id, jobId);
  res.status(202).json(publicJob(job));
});

router.get('/projects/:id/captions', requireProject, (_req, res) => {
  res.type('application/x-subrip').send(toSrt(req.project.subtitles || []));
});

router.get('/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return fail(res, 404, 'Job not found.');
  res.json(publicJob(job));
});

router.get('/jobs/:id/events', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return fail(res, 404, 'Job not found.');
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();
  const send = (value) => res.write(`data: ${JSON.stringify(publicJob(value))}\n\n`);
  send(job);
  const unsubscribe = subscribe(req.params.id, send);
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => {
    clearInterval(ping);
    unsubscribe();
  });
});

router.post('/jobs/:id/cancel', (req, res) => {
  const job = cancel(req.params.id);
  if (!job) return fail(res, 404, 'Job not found.');
  res.json(publicJob(job));
});

router.get('/jobs/:id/download', async (req, res) => {
  const job = getJob(req.params.id);
  if (!job || job.status !== 'done' || !job.result?.key) return fail(res, 404, 'Export not ready.');
  const { key, filename, size } = job.result;
  const headers = {
    'Content-Type': 'video/mp4',
    'Content-Disposition': `attachment; filename="absam-video.mp4"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'Accept-Ranges': 'bytes'
  };
  try {
    if (req.headers.range && size && !storage.isRemote()) {
      const match = req.headers.range.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        const start = Number(match[1]);
        const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
        if (Number.isFinite(start) && start < size && end >= start) {
          res.writeHead(206, {
            ...headers,
            'Content-Range': `bytes ${start}-${end}/${size}`,
            'Content-Length': end - start + 1
          });
          const stream = await storage.createReadStream(key, { start, end });
          return stream.pipe(res);
        }
      }
    }
    if (size) headers['Content-Length'] = size;
    res.writeHead(200, headers);
    const stream = await storage.createReadStream(key);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  } catch {
    fail(res, 404, 'Exported file is missing.');
  }
});

export default router;
