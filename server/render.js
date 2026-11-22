import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { runCommand, writeConcatList, tempFile, cleanup } from './ffmpeg.js';
import { clamp, round, safeName } from './utils.js';
import { getProject, saveProject } from './projects.js';
import { normalizeCues, buildAss, mapCuesToTrim } from './subtitles.js';
import { transcribeFile } from './transcribe.js';
import * as storage from './storage.js';

const QUALITY = {
  fast: { preset: 'veryfast', crf: 25 },
  balanced: { preset: 'veryfast', crf: 21 },
  high: { preset: 'medium', crf: 18 }
};

function planSegments(project) {
  const segments = [];
  let offset = 0;
  for (const clip of project.clips) {
    const trims = clip.trims?.length
      ? [...clip.trims].sort((a, b) => a.start - b.start)
      : [{ start: 0, end: clip.duration }];
    for (const trim of trims) {
      const start = clamp(Number(trim.start) || 0, 0, clip.duration);
      const end = clamp(Number(trim.end) || clip.duration, start + 0.1, clip.duration);
      const length = round(end - start);
      if (length <= 0) continue;
      segments.push({ clip, start, end, length, outputStart: offset });
      offset += length;
    }
  }
  return segments;
}

async function renderSegment(segment, index, settings, context, signal) {
  const source = await storage.localFile(segment.clip.key);
  const output = tempFile(`segment-${index}`, 'mp4');
  const { preset, crf } = QUALITY[settings.quality] || QUALITY.balanced;
  const scale = `scale=${config.outputWidth}:${config.outputHeight}:force_original_aspect_ratio=decrease,` +
    `pad=${config.outputWidth}:${config.outputHeight}:(ow-iw)/2:(oh-ih)/2,setsar=1,` +
    `fps=${config.outputFps},format=yuv420p`;

  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', String(segment.start),
    '-i', source,
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
    '-t', String(segment.length),
    '-vf', scale,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'libx264', '-preset', preset, '-crf', String(crf),
    '-pix_fmt', 'yuv420p', '-g', String(config.outputFps * 2),
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000',
    '-shortest', '-movflags', '+faststart',
    '-progress', 'pipe:1', '-nostats',
    output
  ];

  const result = await runCommand(config.ffmpegBin, args, {
    signal,
    duration: segment.length,
    onProgress: ({ ratio }) => onSegmentProgress(context, segment, index, ratio),
    onLog: (line) => context.log(line)
  });
  if (result.code !== 0) throw new Error(`FFmpeg failed on clip "${segment.clip.name}".`);
  return output;
}

// Segments are rendered with equal weight so the phone shows steady progress.
function onSegmentProgress(context, segment, index, ratio) {
  const segments = context.meta.segments;
  const doneBefore = segments.slice(0, index).reduce((sum, item) => sum + item.length, 0);
  const total = context.meta.total || 1;
  context.progress(0.05 + 0.7 * ((doneBefore + ratio * segment.length) / total), 'rendering-clips');
}

async function makeAmbientBed(signal) {
  const output = tempFile('ambient', 'wav');
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=130.81:sample_rate=48000:duration=30',
    '-f', 'lavfi', '-i', 'sine=frequency=196:sample_rate=48000:duration=30',
    '-f', 'lavfi', '-i', 'sine=frequency=261.63:sample_rate=48000:duration=30',
    '-filter_complex',
    '[0:a][1:a][2:a]amix=inputs=3:duration=longest,volume=0.22,lowpass=f=900,aecho=0.8:0.88:45:0.18[a]',
    '-map', '[a]', '-c:a', 'pcm_s16le', output
  ];
  const { code } = await runCommand(config.ffmpegBin, args, { signal });
  if (code !== 0) throw new Error('Could not generate the ambient music bed.');
  return output;
}

async function collectCues(project, segments, total, context, signal) {
  const mode = project.settings.subtitleMode;
  if (mode === 'provided') {
    return normalizeCues(project.subtitles || [], total);
  }
  if (mode === 'whisper') {
    const cache = new Map();
    const cues = [];
    for (const segment of segments) {
      context.log(`Transcribing ${segment.clip.name} (local model)`);
      let clipCues = cache.get(segment.clip.id);
      if (!clipCues) {
        const source = await storage.localFile(segment.clip.key);
        clipCues = await transcribeFile(source, config.whisperLang, signal);
        cache.set(segment.clip.id, clipCues);
      }
      cues.push(...mapCuesToTrim(clipCues, segment.start, segment.end, segment.outputStart));
    }
    return normalizeCues(cues, total);
  }
  return [];
}

/** Job handler: normalise clips, concatenate, subtitle, mix music, export MP4. */
export async function renderProjectJob({ projectId, jobId }, context) {
  const project = getProject(projectId);
  if (!project) throw new Error('Project not found.');
  const segments = planSegments(project);
  if (!segments.length) throw new Error('No clips to render. Run auto-trim first.');

  const total = round(segments.reduce((sum, segment) => sum + segment.length, 0));
  context.meta = { segments, total };
  context.log(`Timeline: ${segments.length} segment(s), ${total}s`);

  const cues = await collectCues(project, segments, total, context, context.signal);
  const assFile = cues.length
    ? tempFile('subtitles', 'ass')
    : null;
  if (assFile) {
    fs.writeFileSync(assFile, buildAss(cues, {
      font: project.settings.subtitleFont || config.defaultFont,
      fontSize: Number(project.settings.subtitleFontSize) || 52,
      rtl: project.settings.subtitleRtl !== false
    }));
    context.log(`${cues.length} Arabic subtitle cue(s) burned in`);
  }

  let musicFile = null;
  let generatedMusic = false;
  if (project.settings.musicMode === 'upload' && project.assets.musicKey) {
    musicFile = await storage.localFile(project.assets.musicKey);
  } else if (project.settings.musicMode === 'ambient') {
    musicFile = await makeAmbientBed(context.signal);
    generatedMusic = true;
  }

  const rendered = [];
  const concatList = tempFile('concat', 'txt');
  const output = tempFile('absam', 'mp4');
  try {
    for (let index = 0; index < segments.length; index += 1) {
      rendered.push(await renderSegment(segments[index], index, project.settings, context, context.signal));
    }
    writeConcatList(concatList, rendered);

    const { preset, crf } = QUALITY[project.settings.quality] || QUALITY.balanced;
    const args = [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'concat', '-safe', '0', '-i', concatList
    ];
    if (musicFile) args.push('-stream_loop', '-1', '-i', musicFile);

    const parts = [];
    const fade = clamp(Number(project.settings.musicFadeSeconds) || 0, 0, total / 2);
    const volume = clamp(Number(project.settings.musicVolume ?? 0.16), 0, 1);
    let videoChain = '[0:v]';
    if (assFile) {
      const fontDir = fs.existsSync(config.fontsDir) ? `:fontsdir=${config.fontsDir}` : '';
      videoChain += `subtitles=filename=${assFile}${fontDir}`;
    }
    parts.push(`${videoChain}[v]`);

    if (musicFile) {
      const fadeOut = round(Math.max(0, total - fade));
      parts.push(
        `[1:a]atrim=0:${total},asetpts=PTS-STARTPTS,volume=${volume},` +
        `afade=t=in:st=0:d=${fade},afade=t=out:st=${fadeOut}:d=${fade}[bgm];` +
        '[0:a]volume=1[vo];' +
        '[vo][bgm]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,' +
        'alimiter=limit=0.95[a]'
      );
    } else {
      parts.push('[0:a]alimiter=limit=0.95[a]');
    }

    args.push('-filter_complex', parts.join(';'));
    args.push(
      '-map', '[v]', '-map', '[a]',
      '-c:v', 'libx264', '-preset', preset, '-crf', String(crf),
      '-pix_fmt', 'yuv420p', '-r', String(config.outputFps),
      '-c:a', 'aac', '-b:a', '160k', '-ar', '48000',
      '-t', String(total), '-movflags', '+faststart',
      '-progress', 'pipe:1', '-nostats',
      output
    );

    context.progress(0.75, 'muxing');
    const result = await runCommand(config.ffmpegBin, args, {
      signal: context.signal,
      duration: total,
      onProgress: ({ ratio }) => context.progress(0.75 + 0.24 * ratio, 'muxing'),
      onLog: (line) => context.log(line)
    });
    if (result.code !== 0) throw new Error('FFmpeg failed while creating the final MP4.');

    const key = path.posix.join('projects', projectId, 'renders', `${jobId}.mp4`);
    await storage.put(key, output);
    const info = await storage.stat(key);
    const filename = `${safeName(project.title)}-1080p.mp4`;
    project.latestJobId = jobId;
    saveProject(project);
    context.progress(1, 'complete');
    return { key, filename, duration: total, size: info?.size || 0, subtitles: cues.length };
  } finally {
    cleanup([...rendered, concatList, output, assFile]);
    if (generatedMusic) cleanup([musicFile]);
  }
}
