import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSubtitles, cuesFromPlainText, buildAss, mapCuesToTrim, normalizeCues
} from '../server/subtitles.js';
import {
  parseSilences, parseScenes, keepIntervals, splitInterval, buildTrimPlan
} from '../server/analyze.js';

test('parses Arabic SRT cues', () => {
  const srt = `1
00:00:01,000 --> 00:00:03,500
مرحبا بالعالم

2
00:00:04,250 --> 00:00:06,000
العربية جميلة
`;
  const cues = parseSubtitles(srt);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].start, 1);
  assert.equal(cues[0].end, 3.5);
  assert.equal(cues[0].text, 'مرحبا بالعالم');
});

test('parses WebVTT with cue settings and NOTE blocks', () => {
  const vtt = `WEBVTT

NOTE this is ignored

00:00:02.000 --> 00:00:04.000 align:start line:0
First line

00:04.500 --> 00:06.000
Second line
`;
  const cues = parseSubtitles(vtt);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].start, 2);
  assert.equal(cues[1].start, 4.5);
});

test('spreads plain text lines across the timeline', () => {
  const cues = cuesFromPlainText('واحد\nاثنان\nثلاثة', 10);
  assert.equal(cues.length, 3);
  assert.ok(cues[0].start < cues[1].start);
  assert.ok(cues.every((cue) => cue.end <= 10));
});

test('ASS output marks RTL paragraphs and uses the Arabic font', () => {
  const ass = buildAss([{ start: 1, end: 3, text: 'مرحبا\nبالعالم' }]);
  assert.match(ass, /Noto Naskh Arabic/);
  assert.match(ass, /Dialogue: 0,0:00:01\.00,0:00:03\.00/);
  assert.match(ass, /\u200Fمرحبا\\N\u200Fبالعالم/);
  assert.match(ass, /PlayResX: 1920/);
});

test('maps Whisper cues from a trimmed source onto the output timeline', () => {
  const cues = [
    { start: 1, end: 2, text: 'before' },
    { start: 4, end: 6, text: 'inside' },
    { start: 9, end: 10, text: 'after' }
  ];
  const mapped = mapCuesToTrim(cues, 3, 7, 12);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].start, 13);
  assert.equal(mapped[0].end, 15);
});

test('normalizeCues removes overlaps', () => {
  const cues = normalizeCues([
    { start: 0, end: 2, text: 'a' },
    { start: 1.5, end: 3, text: 'b' }
  ]);
  assert.equal(cues.length, 2);
  assert.ok(cues[1].start >= cues[0].end);
});

test('parses silencedetect output including a trailing silence', () => {
  const log = `silence_start: 1.20
silence_end: 2.40 | silence_duration: 1.20
silence_start: 8.00
`;
  assert.deepEqual(parseSilences(log, 10), [
    { start: 1.2, end: 2.4 },
    { start: 8, end: 10 }
  ]);
});

test('parses showinfo scene times', () => {
  assert.deepEqual(parseScenes('pts_time:2.5 n:0\npts_time:7.25 n:1\npts_time:2.5 n:2'), [2.5, 7.25]);
});

test('keepIntervals removes long silences but keeps speech padding', () => {
  const intervals = keepIntervals(10, [{ start: 2, end: 5 }], { padding: 0.14, minSilence: 0.6 });
  assert.deepEqual(intervals, [{ start: 0, end: 2.14 }, { start: 4.86, end: 10 }]);
});

test('splitInterval splits both sides at scene boundaries', () => {
  const parts = splitInterval({ start: 0, end: 20 }, [6.1, 13], 6);
  assert.ok(parts.length >= 3);
  assert.ok(parts.every((part) => part.end - part.start <= 6.01));
  assert.equal(parts[0].start, 0);
  assert.equal(parts.at(-1).end, 20);
});

test('buildTrimPlan respects target length and source order', () => {
  const settings = { autoTrim: true, targetSeconds: 60, maxClipSeconds: 15, minClipSeconds: 1 };
  const plan = buildTrimPlan({ duration: 20 }, [], [], settings);
  assert.equal(plan.length, 2);
  assert.deepEqual(plan.map((item) => item.start), [0, 15]);
});

test('buildTrimPlan with autoTrim disabled keeps the full clip', () => {
  const plan = buildTrimPlan({ duration: 42 }, [], [], { autoTrim: false });
  assert.deepEqual(plan, [{ start: 0, end: 42, score: 1, reason: 'full' }]);
});
