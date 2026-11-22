import { EventEmitter } from 'node:events';
import { config } from './config.js';
import { readJson, writeJson, uid } from './utils.js';

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

const state = readJson(config.jobsFile, { jobs: {}, queue: [] });
state.jobs ||= {};
state.queue ||= [];

const handlers = new Map();
const controllers = new Map();
let active = 0;

// A restart kills in-flight FFmpeg processes, so never leave jobs "running".
for (const job of Object.values(state.jobs)) {
  if (job.status === 'running' || job.status === 'queued') {
    job.status = 'failed';
    job.error = 'Interrupted by server restart. Please try again.';
    job.finishedAt = new Date().toISOString();
  }
}
state.queue = [];

function persist() {
  writeJson(config.jobsFile, state);
}

function notify(job) {
  emitter.emit(`job:${job.id}`, job);
  emitter.emit('jobs', job);
}

export function registerHandler(type, handler) {
  handlers.set(type, handler);
}

export function getJob(id) {
  return state.jobs[id] || null;
}

export function listJobs(projectId) {
  return Object.values(state.jobs)
    .filter((job) => !projectId || job.projectId === projectId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function subscribe(id, listener) {
  const event = `job:${id}`;
  emitter.on(event, listener);
  return () => emitter.off(event, listener);
}

export function subscribeAll(listener) {
  emitter.on('jobs', listener);
  return () => emitter.off('jobs', listener);
}

export function enqueue(type, payload, projectId = null, forcedId = null) {
  const job = {
    id: forcedId || uid('job_'),
    type,
    projectId,
    payload: payload || {},
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
  state.queue.push(job.id);
  persist();
  notify(job);
  pump();
  return job;
}

export function cancel(id) {
  const job = state.jobs[id];
  if (!job || !['queued', 'running'].includes(job.status)) return job || null;
  controllers.get(id)?.abort();
  if (job.status === 'queued') {
    state.queue = state.queue.filter((jobId) => jobId !== id);
    job.status = 'failed';
    job.error = 'Cancelled by user.';
    job.finishedAt = new Date().toISOString();
    notify(job);
    persist();
  }
  return job;
}

export function waitFor(id, timeoutMs = 10 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const job = state.jobs[id];
    if (!job) return reject(new Error('Job not found.'));
    if (isTerminal(job)) return resolve(job);
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error('Timed out waiting for the job.'));
    }, timeoutMs);
    const unsubscribe = subscribe(id, (updated) => {
      if (!isTerminal(updated)) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(updated);
    });
  });
}

const isTerminal = (job) => ['done', 'failed'].includes(job.status);

async function run(job) {
  const controller = new AbortController();
  controllers.set(job.id, controller);
  job.status = 'running';
  job.startedAt = new Date().toISOString();
  job.stage = 'starting';
  notify(job);

  const context = {
    signal: controller.signal,
    update(patch) {
      Object.assign(job, patch);
      notify(job);
    },
    log(message) {
      job.log.push(String(message).slice(0, 220));
      if (job.log.length > 120) job.log.shift();
      notify(job);
    },
    progress(ratio, stage) {
      // FFmpeg progress lines are not perfectly ordered; never move backwards.
      const value = Math.max(job.progress, Math.round(Math.min(1, Math.max(0, ratio || 0)) * 100));
      if (job.progress !== value || job.stage !== stage) {
        job.progress = value;
        job.stage = stage || job.stage;
        notify(job);
      }
    }
  };

  try {
    const handler = handlers.get(job.type);
    if (!handler) throw new Error(`No handler for job type "${job.type}".`);
    const result = await handler(job.payload || {}, context);
    job.result = result || null;
    job.status = 'done';
    job.progress = 100;
    job.stage = 'complete';
  } catch (error) {
    job.status = 'failed';
    job.error = controller.signal.aborted
      ? 'Cancelled by user.'
      : (error?.message || String(error));
    job.stage = 'failed';
  } finally {
    job.finishedAt = new Date().toISOString();
    controllers.delete(job.id);
    active -= 1;
    persist();
    notify(job);
    pump();
  }
}

function pump() {
  while (active < config.jobConcurrency && state.queue.length) {
    const id = state.queue.shift();
    const job = state.jobs[id];
    if (!job || job.status !== 'queued') continue;
    active += 1;
    persist();
    run(job).catch((error) => {
      active -= 1;
      job.status = 'failed';
      job.error = error?.message || String(error);
      persist();
      notify(job);
      pump();
    });
  }
}
