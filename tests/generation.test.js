import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeGenerationInput,
  publicProvider,
  MODES,
  RATIOS
} from '../server/video/validation.js';
import { createWan22Provider } from '../server/video/providers/wan22.js';

const imageFile = { mimetype: 'image/jpeg', originalname: 'photo.jpg' };

test('normalizes a valid text-to-video request', () => {
  const input = normalizeGenerationInput({
    mode: 'text',
    prompt: '  فيديو عن الصحراء  ',
    ratio: '9:16',
    duration: '5'
  });
  assert.equal(input.mode, 'text');
  assert.equal(input.prompt, 'فيديو عن الصحراء');
  assert.deepEqual(input.size, { width: 720, height: 1280 });
  assert.equal(input.duration, 5);
  assert.equal(input.hasImage, false);
});

test('requires a real image for image-to-video', () => {
  assert.throws(
    () => normalizeGenerationInput({ mode: 'image', prompt: 'حركة موجية' }, null),
    /صورة مرفوعة/
  );
  const input = normalizeGenerationInput(
    { mode: 'image', prompt: 'حركة موجية', ratio: '16:9', duration: '10' },
    imageFile
  );
  assert.equal(input.hasImage, true);
  assert.deepEqual(input.size, { width: 1280, height: 720 });
});

test('rejects invalid modes, ratios, durations and short prompts', () => {
  assert.deepEqual(MODES, ['text', 'image']);
  assert.deepEqual(RATIOS, ['9:16', '16:9', '1:1']);
  assert.throws(() => normalizeGenerationInput({ mode: 'voice', prompt: 'وصف صالح' }), /نوع الفيديو/);
  assert.throws(() => normalizeGenerationInput({ prompt: 'وصف صالح', ratio: '4:3' }), /أبعاد/);
  assert.throws(() => normalizeGenerationInput({ prompt: 'وصف صالح', duration: '30' }), /مدة/);
  assert.throws(() => normalizeGenerationInput({ prompt: 'لا' }), /3 أحرف/);
});

test('public provider info never exposes paths or secrets', () => {
  const info = publicProvider({
    id: 'wan22-local',
    name: 'Wan 2.2',
    description: 'local',
    available: false,
    reason: 'WAN22_MODEL_DIR missing',
    capabilities: { textToVideo: true },
    modelDir: '/secret/models',
    apiKey: 'do-not-leak'
  });
  assert.equal(info.available, false);
  assert.match(info.reason, /WAN22_MODEL_DIR/);
  assert.equal(Object.hasOwn(info, 'modelDir'), false);
  assert.equal(Object.hasOwn(info, 'apiKey'), false);
});

test('Wan 2.2 adapter reports missing engine and refuses to fake output', async () => {
  const provider = createWan22Provider({
    config: {
      projectRoot: '/nonexistent',
      video: {
        timeoutMs: 1000,
        wan22: {
          enabled: true,
          python: 'python3',
          runner: '/nonexistent/wan22_runner.py',
          modelDir: '',
          modelName: 'model',
          imageModelName: 'image-model',
          device: 'cpu',
          localFilesOnly: true,
          fps: 16
        }
      }
    }
  });
  const status = await provider.availability();
  assert.equal(status.available, false);
  assert.match(status.reason, /WAN22_MODEL_DIR|wan22_runner/);
  await assert.rejects(
    () => provider.generate({ job: { id: 'test' }, input: {}, outputPath: '/tmp/out.mp4' }),
    /WAN22_MODEL_DIR|wan22_runner|غير مثبّت/
  );
});
