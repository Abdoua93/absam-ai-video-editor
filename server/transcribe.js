import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { config } from './config.js';
import { runCommand, tempFile, cleanup } from './ffmpeg.js';
import { parseSubtitles } from './subtitles.js';

export function whisperStatus() {
  const configured = Boolean(config.whisperBin && config.whisperModel);
  let binary = false;
  if (config.whisperBin) {
    const probe = spawnSync(config.whisperBin, ['--help'], { encoding: 'utf8', timeout: 4000 });
    binary = probe.status === 0 || /usage|whisper/i.test(`${probe.stdout || ''}${probe.stderr || ''}`);
  }
  const model = Boolean(config.whisperModel && fs.existsSync(config.whisperModel));
  return { configured, binary, model, available: configured && binary && model };
}

/** Extract the small mono WAV Whisper expects, then run the local CLI. */
export async function transcribeFile(file, language = config.whisperLang, signal) {
  if (!config.whisperBin || !config.whisperModel) {
    throw new Error('Local Whisper is not configured. Set WHISPER_BIN and WHISPER_MODEL.');
  }
  if (!fs.existsSync(config.whisperModel)) {
    throw new Error(`Whisper model not found: ${config.whisperModel}`);
  }

  const wav = tempFile('whisper', 'wav');
  const prefix = tempFile('whisper_out', '');
  try {
    const extracted = await runCommand(config.ffmpegBin, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav
    ], { signal });
    if (extracted.code !== 0) throw new Error('Could not extract audio for transcription.');

    const result = await runCommand(config.whisperBin, [
      '-m', config.whisperModel,
      '-f', wav,
      '-l', language,
      '-osrt',
      '-of', prefix,
      '-t', '4',
      '-np'
    ], { signal });
    if (result.code !== 0) throw new Error('Local Whisper transcription failed.');

    const srtFile = `${prefix}.srt`;
    if (!fs.existsSync(srtFile)) throw new Error('Whisper did not produce a subtitle file.');
    return parseSubtitles(fs.readFileSync(srtFile, 'utf8'));
  } finally {
    cleanup([wav, `${prefix}.srt`, `${prefix}.txt`, `${prefix}.vtt`, `${prefix}.json`]);
  }
}
