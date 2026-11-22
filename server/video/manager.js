import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { config } from '../config.js';
import { readJson, writeJson, uid } from '../utils.js';
import * as storage from '../storage.js';
import { probe, cleanup, tempFile } from '../ffmpeg.js';
import { createProviderRegistry } from './providers/index.js';

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

const state = readJson(config.video.jobsFile, { jobs: {} });
state.jobs ||= {};

// In-flight engines die with the process; never leave a job hanging as "running".
for (const job of Object.values(state.jobs)) {
  if (job.status === 'running' || job.status === 'queued') {
    job.status = 'failed';
    job.error = 'انقطع الخادم أثناء التوليد. أعد المحاولة.';
    job.finishedAt = new Date().toISOString();
  }
}

const registry = createProviderRegistry({
  config,
  logger: (message) => console.log('[generation]', String(message).slice(0, 300))
});

const controllers = new Map();
// Uploaded bytes live only in memory, never in the persisted job file.
const pendingImages = new Map();
let active = 0;

function persist() {
  writeJson(config.video.jobsFile, state);
}

function notify(job) {
  emitter.emit(`generation:${job.id}`, job);
  emitter.emit('generations', job);
}

export function listProviders() {
  return registry.list();
}

export async function providerAvailability(id) {
  const provider = registry.get(id);
  if (!provider) return { available: false, reason: `مزوّد غير معروف: ${id}`, known: false };
  const result = await provider.availability();
  return { ...result, known: true };
}

export function getJob(id) {
  return state.jobs[String(id)] || null;
}

export function listJobs() {
  return Object.values(state.jobs).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function subscribe(id, listener) {
  const event = `generation:${id}`;
  emitter.on(event, listener);
  return () => emitter.off(event, listener);
}

export function publicJob(job) {
  if (!job) return null;
  const ready = job.status === 'done' && Boolean(job.result?.key);
  return {
    id: job.id,
    provider: job.provider,
    input: job.input,
    status: job.status,
    progress: job.progress,
    stage: job.stage,
    log: (job.log || []).slice(-30),
    error: job.error || null,
    result: ready
      ? {
          ...job.result,
          previewUrl: `/api/video/jobs/${job.id}/preview`,
          downloadUrl: `/api/video/jobs/${job.id}/download`
        }
      : null,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt
  };
}

/** Enqueue a generation job. Availability is checked before anything is stored. */
export function enqueue(input, imageFile = null) {
  const provider = registry.get(config.video.provider);
  const job = {
    id: uid('gen_'),
    provider: provider?.id || config.video.provider,
    input: { ...input },
    imageKey: null,
    status: 'queued',
    progress: 0,
    stage: 'waiting',
    log: [],
    result: null,
    error: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null
  };
  state.jobs[job.id] = job;
  if (imageFile?.buffer) {
    pendingImages.set(job.id, {
      buffer: imageFile.buffer,
      name: imageFile.originalname || 'input.jpg'
    });
  }
  persist();
  notify(job);
  pump();
  return job;
}

export function cancel(id) {
  const job = state.jobs[String(id)];
  if (!job || !['queued', 'running'].includes(job.status)) return job || null;
  controllers.get(job.id)?.abort();
  if (job.status === 'queued') {
    pendingImages.delete(job.id);
    job.status = 'failed';
    job.error = 'تم إلغاء التوليد.';
    job.finishedAt = new Date().toISOString();
    notify(job);
    persist();
  }
  return job;
}

async function run(job) {
  const controller = new AbortController();
  controllers.set(job.id, controller);
  job.status = 'running';
  job.startedAt = new Date().toISOString();
  job.stage = 'preparing';
  job.progress = 5;
  notify(job);

  const outputPath = tempFile('generated', 'mp4');
  const storedKeys = [];

  const context = {
    signal: controller.signal,
    update(patch) {
      Object.assign(job, patch);
      notify(job);
    },
    log(message) {
      job.log.push(String(message).slice(0, 300));
      if (job.log.length > 60) job.log.shift();
      notify(job);
    },
    progress(value, stage) {
      // Engine progress is mapped into 15–90%; the rest is validation/storage.
      const mapped = 15 + Math.round(Math.min(1, Math.max(0, Number(value) || 0)) * 75);
      if (job.progress !== mapped || job.stage !== stage) {
        job.progress = mapped;
        job.stage = stage || job.stage;
        notify(job);
      }
    }
  };

  try {
    const provider = registry.get(job.provider);
    if (!provider) throw new Error(`مزوّد غير معروف: ${job.provider}`);

    const status = await provider.availability();
    if (!status.available) throw new Error(status.reason || 'محرك التوليد غير متاح.');

    const pendingImage = pendingImages.get(job.id);
    if (pendingImage) {
      const ext = String(pendingImage.name).match(/\.(png|jpe?g|webp)$/i)?.[1] || 'jpg';
      const key = `generations/${job.id}/input.${ext}`;
      await storage.put(key, pendingImage.buffer);
      storedKeys.push(key);
      job.imageKey = key;
      context.update({ stage: 'preparing' });
    }
    pendingImages.delete(job.id);

    const imagePath = job.imageKey ? await storage.localFile(job.imageKey) : null;
    context.log(`provider: ${provider.name}`);
    context.update({ stage: 'generating', progress: 15 });

    await provider.generate({
      job: publicJob(job),
      input: job.input,
      imagePath,
      outputPath,
      signal: controller.signal,
      context
    });

    if (controller.signal.aborted) throw new Error('تم إلغاء التوليد.');

    context.update({ stage: 'validating', progress: 92 });
    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1024) {
      throw new Error('لم يُنتج المحرك ملف فيديو صالحاً. لن يتم عرض أي فيديو وهمي.');
    }
    const meta = await probe(outputPath);
    if (!(meta.duration > 0) || !(meta.width > 0) || !(meta.height > 0)) {
      throw new Error('ملف الإخراج لا يحتوي على فيديو صالح.');
    }

    context.update({ stage: 'storing', progress: 96 });
    const key = `generations/${job.id}/output.mp4`;
    await storage.put(key, outputPath);
    storedKeys.push(key);
    const info = await storage.stat(key);

    job.result = {
      key,
      filename: `absam-${job.id}.mp4`,
      size: info?.size || fs.statSync(outputPath).size,
      duration: meta.duration,
      width: meta.width,
      height: meta.height,
      fps: meta.fps,
      provider: provider.id
    };
    job.status = 'done';
    job.progress = 100;
    job.stage = 'complete';
    context.log('تم توليد الفيديو بنجاح.');
  } catch (error) {
    job.status = 'failed';
    job.error = controller.signal.aborted
      ? 'تم إلغاء التوليد.'
      : (error?.message || String(error));
    job.stage = 'failed';
    // Never keep a fake/partial result downloadable.
    job.result = null;
    for (const key of storedKeys) {
      try {
        await storage.remove(key);
      } catch {
        // Best effort cleanup.
      }
    }
  } finally {
    pendingImages.delete(job.id);
    cleanup([outputPath]);
    job.finishedAt = new Date().toISOString();
    controllers.delete(job.id);
    active -= 1;
    persist();
    notify(job);
    pump();
  }
}

function pump() {
  while (active < config.video.concurrency) {
    const job = Object.values(state.jobs).find((item) => item.status === 'queued');
    if (!job) break;
    active += 1;
    run(job).catch((error) => {
      job.status = 'failed';
      job.error = error?.message || String(error);
      job.stage = 'failed';
      active -= 1;
      persist();
      notify(job);
      pump();
    });
  }
}
