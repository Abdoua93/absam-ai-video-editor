#!/usr/bin/env node
/**
 * End-to-end smoke test. Requires a running server and FFmpeg on PATH.
 * Usage: node scripts/smoke.mjs [http://127.0.0.1:8080]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const BASE = process.argv[2] || process.env.BASE_URL || 'http://127.0.0.1:8080';
const work = fs.mkdtempSync(path.resolve('data/tmp/smoke-'));

const run = (bin, args) => {
  const result = spawnSync(bin, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${bin} failed: ${result.stderr?.slice(-300)}`);
  return result.stdout;
};

const api = async (url, options = {}) => {
  const response = await fetch(`${BASE}/api${url}`, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status}: ${body.error || 'request failed'}`);
  return body;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  run('ffmpeg', ['-version']);
  console.log('Generating two short test clips…');
  for (let index = 1; index <= 2; index += 1) {
    run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `testsrc=size=640x360:rate=25`,
      '-f', 'lavfi', '-i', `sine=frequency=${300 + index * 100}:sample_rate=48000`,
      '-t', '6', '-c:v', 'libx264', '-preset', 'ultrafast',
      '-c:a', 'aac', '-shortest', path.join(work, `clip${index}.mp4`)
    ]);
  }

  const project = await api('/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'ABSAM smoke test' })
  });
  console.log(`Project ${project.id}`);

  const form = new FormData();
  for (const name of ['clip1.mp4', 'clip2.mp4']) {
    form.append('files', new Blob([fs.readFileSync(path.join(work, name))], { type: 'video/mp4' }), name);
  }
  const uploaded = await api(`/projects/${project.id}/clips`, { method: 'POST', body: form });
  console.log(`Uploaded ${uploaded.clips.length} clips`);

  const subtitles = new FormData();
  subtitles.append('text', 'مرحبا بالعالم\nهذه ترجمة تجريبية');
  subtitles.append('mode', 'provided');
  const subs = await api(`/projects/${project.id}/subtitles`, { method: 'POST', body: subtitles });
  console.log(`Subtitles: ${subs.cues.length} cues`);

  await api(`/projects/${project.id}/settings`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      autoTrim: true, targetSeconds: 8, maxClipSeconds: 5,
      subtitleMode: 'provided', musicMode: 'ambient',
      musicVolume: 0.12, quality: 'fast'
    })
  });

  console.log('Analysing…');
  const analysed = await api(`/projects/${project.id}/analyze`, { method: 'POST' });
  console.log(`Trim plan: ${analysed.job.result?.totalSeconds ?? 0}s`);

  console.log('Rendering…');
  const job = await api(`/projects/${project.id}/render`, { method: 'POST' });
  let latest = job;
  const deadline = Date.now() + 5 * 60 * 1000;
  while (!['done', 'failed'].includes(latest.status) && Date.now() < deadline) {
    await sleep(1000);
    latest = await api(`/jobs/${job.id}`);
    process.stdout.write(`\r  ${latest.progress}% ${latest.stage || ''}   `);
  }
  process.stdout.write('\n');
  if (latest.status !== 'done') throw new Error(`Render failed: ${latest.error}`);

  const output = path.join(work, 'output.mp4');
  const response = await fetch(`${BASE}/api/jobs/${job.id}/download`);
  fs.writeFileSync(output, Buffer.from(await response.arrayBuffer()));
  const info = run('ffprobe', [
    '-v', 'error', '-show_entries', 'stream=width,height,codec_name:format=duration',
    '-of', 'json', output
  ]);
  console.log(`Output: ${(fs.statSync(output).size / 1024 / 1024).toFixed(2)} MB`);
  console.log(info.trim());
  console.log('SMOKE TEST PASSED');
} catch (error) {
  console.error(`SMOKE TEST FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
