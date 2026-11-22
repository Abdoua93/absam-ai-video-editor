import { clamp, parseClock, round } from './utils.js';

const RLM = '\u200F'; // Right-to-left mark: locks the paragraph direction to RTL.

/**
 * Parse SRT or WebVTT into [{start, end, text}]. Tolerates cue numbers,
 * VTT headers, cue settings and both ',' / '.' millisecond separators.
 */
export function parseSubtitles(raw) {
  const lines = String(raw || '')
    .replace(/\r\n?/g, '\n')
    .replace(/^\uFEFF/, '')
    .split('\n');
  const cues = [];
  const timeLine = /(-?[\d:.,]+)\s*-->\s*(-?[\d:.,]+)/;

  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(timeLine);
    if (!match) continue;
    const start = parseClock(match[1]);
    const end = parseClock(match[2]);
    if (start === null || end === null || end <= start) continue;

    const text = [];
    i += 1;
    while (i < lines.length && lines[i].trim() !== '') {
      const line = lines[i].trim();
      if (!timeLine.test(line) && !/^(WEBVTT|NOTE|STYLE|REGION)\b/i.test(line)) {
        text.push(line);
      }
      i += 1;
    }
    if (text.length) cues.push({ start, end, text: text.join('\n') });
  }

  return cues.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Turn plain lines (no timestamps) into evenly spaced cues. */
export function cuesFromPlainText(raw, duration = 0, maxCueSeconds = 6) {
  const lines = String(raw || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];
  const total = Number.isFinite(duration) && duration > 0 ? duration : lines.length * 3.5;
  const slot = clamp(total / lines.length, 1.4, maxCueSeconds);
  return lines.map((text, index) => ({
    start: round(index * slot + 0.2),
    end: round(Math.min(total, (index + 1) * slot - 0.2)),
    text: text.replace(/^\d+[.)-]\s*/, '')
  }));
}

/** If the input already has timestamps, use it; otherwise spread lines evenly. */
export function cuesFromInput(raw, duration = 0) {
  const parsed = parseSubtitles(raw);
  return parsed.length ? parsed : cuesFromPlainText(raw, duration);
}

/**
 * Select cues that overlap a kept range and shift them onto the final timeline.
 * Used when Whisper transcribes the original clip but we render only its trim.
 */
export function mapCuesToTrim(cues, sourceStart, sourceEnd, outputOffset) {
  const length = Math.max(0, sourceEnd - sourceStart);
  return cues
    .filter((cue) => cue.end > sourceStart + 0.05 && cue.start < sourceEnd - 0.05)
    .map((cue) => ({
      start: round(outputOffset + clamp(cue.start - sourceStart, 0, length)),
      end: round(outputOffset + clamp(cue.end - sourceStart, 0, length)),
      text: cue.text
    }))
    .filter((cue) => cue.end - cue.start >= 0.35);
}

/** Resolve overlaps so libass never shows two captions at the same time. */
export function normalizeCues(cues, totalDuration = Infinity) {
  const sorted = cues
    .map((cue) => ({ ...cue, start: round(Math.max(0, cue.start)), end: round(cue.end) }))
    .filter((cue) => cue.end > cue.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const out = [];
  for (const cue of sorted) {
    const last = out[out.length - 1];
    const start = last ? Math.max(cue.start, last.end + 0.02) : cue.start;
    const end = Math.min(cue.end, totalDuration);
    if (end - start >= 0.35) out.push({ start: round(start), end: round(end), text: cue.text });
  }
  return out;
}

function assText(text, rtl = true) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const clean = line.replace(/[{}]/g, '').replace(/\\/g, '／').trim();
      return rtl ? `${RLM}${clean}` : clean;
    })
    .join('\\N');
}

/**
 * Build a libass subtitle file. libass (via FriBidi + HarfBuzz) shapes Arabic;
 * the RLM prefix and bottom-centred style make the direction explicit.
 */
export function buildAss(cues, options = {}) {
  const {
    font = 'Noto Naskh Arabic',
    fontSize = 52,
    rtl = true,
    marginV = 72,
    outline = 2,
    shadow = 1,
    primary = '&H00FFFFFF',
    outlineColor = '&H00000000'
  } = options;

  const header = [
    '[Script Info]',
    'Title: ABSAM AI Video Editor subtitles',
    'ScriptType: v4.00+',
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    'PlayResX: 1920',
    'PlayResY: 1080',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${font},${fontSize},${primary},&H000000FF,${outlineColor},&H80000000,0,0,0,0,100,100,0,0,1,${outline},${shadow},2,80,80,${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  ];

  const lines = cues
    .filter((cue) => assText(cue.text, rtl))
    .map((cue) => `Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Default,,0,0,0,,${assText(cue.text, rtl)}`);

  return [...header, ...lines, ''].join('\n');
}

function assTime(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = value % 60;
  return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}

export function toSrt(cues) {
  return cues
    .map((cue, index) => `${index + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.text}\n`)
    .join('\n');
}

function srtTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}
