import { config } from './config.js';
import { runCommand } from './ffmpeg.js';
import { clamp, round } from './utils.js';
import { getProject, saveProject } from './projects.js';
import * as storage from './storage.js';

/** Parse `silencedetect` output into [{start, end}] ranges. */
export function parseSilences(log, duration = 0) {
  const ranges = [];
  let open = null;
  for (const line of String(log || '').split(/\r?\n/)) {
    const start = line.match(/silence_start:\s*([\d.]+)/);
    const end = line.match(/silence_end:\s*([\d.]+)/);
    if (start) open = Number(start[1]);
    if (end && open !== null) {
      ranges.push({ start: round(open), end: round(Number(end[1])) });
      open = null;
    }
  }
  if (open !== null && duration > open) ranges.push({ start: round(open), end: round(duration) });
  return ranges;
}

/** Parse `showinfo` pts_time values from the scene-change filter. */
export function parseScenes(log) {
  const times = [];
  for (const match of String(log || '').matchAll(/pts_time:([\d.]+)/g)) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) times.push(round(value));
  }
  return [...new Set(times)].sort((a, b) => a - b);
}

/** Complement of the long silent ranges, padded so speech is not clipped. */
export function keepIntervals(duration, silences, options = {}) {
  const { padding = 0.14, minSilence = 0.6 } = options;
  if (!(duration > 0)) return [];
  const significant = silences
    .filter((range) => range.end - range.start >= minSilence)
    .sort((a, b) => a.start - b.start);

  const intervals = [];
  let cursor = 0;
  for (const silence of significant) {
    const end = clamp(silence.start + padding, 0, duration);
    if (end - cursor >= 0.2) intervals.push({ start: round(cursor), end: round(end) });
    cursor = Math.max(cursor, clamp(silence.end - padding, 0, duration));
  }
  if (duration - cursor >= 0.2) intervals.push({ start: round(cursor), end: round(duration) });
  return intervals;
}

/** Split an interval at the scene cut nearest its ideal boundary. */
export function splitInterval(interval, scenes, maxLength) {
  const length = interval.end - interval.start;
  if (length <= maxLength || length < 0.2) return [interval];

  const target = interval.start + maxLength;
  const candidates = scenes.filter(
    (time) => time > interval.start + 0.8 && time < interval.end - 0.8
  );
  let cut = candidates.length
    ? candidates.reduce((best, time) =>
        Math.abs(time - target) < Math.abs(best - target) ? time : best, candidates[0])
    : target;
  if (cut <= interval.start + 0.5 || cut >= interval.end - 0.5) cut = target;

  return [
    ...splitInterval({ start: interval.start, end: round(cut) }, scenes, maxLength),
    ...splitInterval({ start: round(cut), end: interval.end }, scenes, maxLength)
  ];
}

function scoreSegment(segment, scenes, duration) {
  const length = segment.end - segment.start;
  const cuts = scenes.filter((time) => time > segment.start && time < segment.end).length;
  const energy = clamp(cuts / Math.max(1, length / 4), 0, 2) / 2;
  const substance = clamp(length / Math.max(1, duration * 0.25), 0, 1);
  const recency = 1 - clamp(segment.start / Math.max(1, duration), 0, 1);
  return round(0.5 * substance + 0.35 * energy + 0.15 * recency, 4);
}

/**
 * Pure planning function: given analysis data, choose the segments to keep.
 * Result segments are ordered as they appear in the source video.
 */
export function buildTrimPlan(probe, silences, scenes, settings) {
  const duration = probe.duration || 0;
  if (!(duration > 0)) return [];

  if (!settings.autoTrim) {
    return [{ start: 0, end: round(duration), score: 1, reason: 'full' }];
  }

  const intervals = keepIntervals(duration, silences);
  const maxLength = Math.max(1, Number(settings.maxClipSeconds) || 15);
  const minLength = Math.max(0.3, Number(settings.minClipSeconds) || 1.2);
  const target = Math.max(1, Number(settings.targetSeconds) || 60);

  const candidates = intervals
    .flatMap((interval) => splitInterval(interval, scenes, maxLength))
    .filter((segment) => segment.end - segment.start >= minLength)
    .map((segment) => ({
      ...segment,
      score: scoreSegment(segment, scenes, duration),
      reason: scenes.some((time) => time > segment.start && time < segment.end) ? 'scene+speech' : 'speech'
    }));

  const picked = [];
  let total = 0;
  for (const segment of [...candidates].sort((a, b) => b.score - a.score || a.start - b.start)) {
    if (total >= target) break;
    picked.push(segment);
    total += segment.end - segment.start;
  }

  return picked.sort((a, b) => a.start - b.start).map((segment, index) => ({
    start: segment.start,
    end: segment.end,
    score: segment.score,
    reason: segment.reason,
    order: index + 1
  }));
}

async function detectSilence(file, thresholdDb, signal) {
  const { stderr } = await runCommand(config.ffmpegBin, [
    '-hide_banner', '-nostats', '-i', file,
    '-af', `silencedetect=noise=${thresholdDb}dB:d=0.4`,
    '-f', 'null', '-'
  ], { signal });
  return stderr;
}

async function detectScenes(file, threshold, signal) {
  const { stderr } = await runCommand(config.ffmpegBin, [
    '-hide_banner', '-nostats', '-i', file,
    '-vf', `select=gt(scene\\,${threshold}),showinfo`,
    '-an', '-f', 'null', '-'
  ], { signal });
  return stderr;
}

/** Job handler: analyse every clip and write a proposed trim plan to the project. */
export async function analyzeProjectJob({ projectId }, context) {
  const project = getProject(projectId);
  if (!project) throw new Error('Project not found.');
  if (!project.clips.length) throw new Error('Upload at least one clip first.');

  const total = project.clips.length;
  for (let index = 0; index < total; index += 1) {
    const clip = project.clips[index];
    context.progress(index / total, 'analysing');
    context.log(`Analysing ${clip.name}`);
    const file = await storage.localFile(clip.key);

    let silences = [];
    let scenes = [];
    if (project.settings.autoTrim) {
      const silenceLog = await detectSilence(file, project.settings.silenceThresholdDb, context.signal);
      silences = parseSilences(silenceLog, clip.duration);
      const sceneLog = await detectScenes(file, project.settings.sceneThreshold, context.signal);
      scenes = parseScenes(sceneLog).filter((time) => time < clip.duration);
    }

    clip.analysis = { silences, scenes };
    clip.trims = buildTrimPlan(
      { duration: clip.duration }, silences, scenes, project.settings
    );
    context.log(`${clip.name}: ${clip.trims.length} segment(s) selected`);
    saveProject(project);
  }

  context.progress(1, 'analysed');
  saveProject(project);
  return {
    clips: project.clips.map((clip) => ({ id: clip.id, trims: clip.trims })),
    totalSeconds: round(project.clips.reduce(
      (sum, clip) => sum + clip.trims.reduce((inner, trim) => inner + trim.end - trim.start, 0), 0
    ))
  };
}
