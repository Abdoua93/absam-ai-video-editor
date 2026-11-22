import express from 'express';
import multer from 'multer';
import { config } from '../config.js';
import * as storage from '../storage.js';
import { normalizeGenerationInput } from './validation.js';
import {
  enqueue,
  getJob,
  listJobs,
  listProviders,
  providerAvailability,
  publicJob,
  subscribe,
  cancel
} from './manager.js';

const router = express.Router();

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.video.maxImageMb * 1024 * 1024, files: 1 }
});

const fail = (res, status, message) => res.status(status).json({ error: message });

router.get('/providers', async (_req, res) => {
  res.json({ providers: await listProviders(), defaultProvider: config.video.provider });
});

/** Main generation endpoint. No secrets are accepted from the client. */
router.post('/generate', imageUpload.single('image'), async (req, res) => {
  let input;
  try {
    input = normalizeGenerationInput(req.body || {}, req.file || null);
  } catch (error) {
    return fail(res, 400, error.message || 'طلب غير صالح.');
  }

  const status = await providerAvailability(config.video.provider);
  if (!status.available) {
    return fail(res, 503, status.reason || 'محرك التوليد غير متاح حالياً.');
  }

  const job = enqueue(input, req.file);
  res.status(202).json({ job: publicJob(job) });
});

router.get('/jobs', (_req, res) => {
  res.json({ jobs: listJobs().map(publicJob) });
});

router.get('/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return fail(res, 404, 'مهمة التوليد غير موجودة.');
  res.json(publicJob(job));
});

router.get('/jobs/:id/events', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return fail(res, 404, 'مهمة التوليد غير موجودة.');
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
  if (!job) return fail(res, 404, 'مهمة التوليد غير موجودة.');
  res.json(publicJob(job));
});

function readyJob(req, res) {
  const job = getJob(req.params.id);
  if (!job || job.status !== 'done' || !job.result?.key) {
    fail(res, 404, 'الفيديو غير جاهز بعد.');
    return null;
  }
  return job;
}

async function streamVideo(req, res, job, inline) {
  const { key, filename, size } = job.result;
  const headers = {
    'Content-Type': 'video/mp4',
    'Content-Disposition': inline
      ? `inline; filename="absam-video.mp4"; filename*=UTF-8''${encodeURIComponent(filename)}`
      : `attachment; filename="absam-video.mp4"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600'
  };
  try {
    if (req.headers.range && size && !storage.isRemote()) {
      const match = String(req.headers.range).match(/bytes=(\d+)-(\d*)/);
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
          stream.on('error', () => res.destroy());
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
    if (!res.headersSent) fail(res, 404, 'ملف الفيديو غير موجود.');
    else res.destroy();
  }
}

router.get('/jobs/:id/preview', async (req, res) => {
  const job = readyJob(req, res);
  if (job) await streamVideo(req, res, job, true);
});

router.get('/jobs/:id/download', async (req, res) => {
  const job = readyJob(req, res);
  if (job) await streamVideo(req, res, job, false);
});

export default router;
