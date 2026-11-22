import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const uid = (prefix = '') => `${prefix}${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const round = (value, digits = 2) => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Atomic enough for a single-process queue: write temp file then rename. */
export function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

export function safeName(name) {
  return String(name || 'file')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'file';
}

/**
 * A user access token is exactly `hf_` + 34 letters/digits.
 * Used only for shape checks; the value itself is never logged or returned.
 */
const HF_TOKEN_SHAPE = /^hf_[A-Za-z0-9]{34}$/;
export function isValidHfToken(value) {
  return HF_TOKEN_SHAPE.test(String(value || ''));
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

export function parseClock(value) {
  const match = String(value)
    .trim()
    .replace(',', '.')
    .match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (!match) return null;
  const [, h, m, s, ms] = match;
  return Number(h || 0) * 3600 + Number(m) * 60 + Number(s) + Number((ms || '0').padEnd(3, '0')) / 1000;
}

export function formatClock(seconds, sep = ',') {
  const total = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const ms = Math.round((total % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(ms).padStart(3, '0')}`;
}

/** Remove the FFmpeg ANSI/progress noise so logs stay readable on a phone. */
export function cleanLogLine(line) {
  return String(line)
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\r/g, '')
    .trim();
}
