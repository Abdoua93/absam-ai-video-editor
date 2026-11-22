import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createHuggingFaceLtxProvider,
  mapRatioToModelSize,
  clampDuration,
  classifyRemoteError,
  isQuotaError,
  buildPayloadFromInfo,
  extractProgress
} from '../server/video/providers/huggingface-ltx.js';
import { isValidHfToken } from '../server/utils.js';

// Valid-shaped dummy only: hf_ + 34 letters. Not a real credential.
const TOKEN = `hf_${'A'.repeat(34)}`;

const makeConfig = (token = '') => ({
  video: {
    ltx: {
      spaceId: 'Upsampler/ltx-video',
      spaceApiUrl: 'https://hf.test/api/spaces/Upsampler/ltx-video',
      whoamiUrl: 'https://hf.test/api/whoami-v2',
      baseUrl: 'https://space.test',
      apiName: 'generate_video',
      token,
      timeoutMs: 5000,
      statusTimeoutMs: 1000,
      highRes: false,
      enhancePrompt: false,
      randomizeSeed: true,
      seed: 10
    }
  }
});

const json = (value, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(value),
  json: async () => value
});

const stream = (value) => new ReadableStream({
  start(controller) {
    controller.enqueue(typeof value === 'string' ? new TextEncoder().encode(value) : value);
    controller.close();
  }
});

const endpointSpec = {
  parameters: [
    { parameter_name: 'input_image', label: 'Input Image (Optional)', component: 'Image' },
    { parameter_name: 'prompt', label: 'Prompt', component: 'Textbox' },
    { parameter_name: 'duration', label: 'Duration (seconds)', component: 'Slider' },
    { parameter_name: 'enhance_prompt', label: 'Enhance Prompt', component: 'Checkbox' },
    { parameter_name: 'seed', label: 'Seed', component: 'Slider' },
    { parameter_name: 'randomize_seed', label: 'Randomize Seed', component: 'Checkbox' },
    { parameter_name: 'height', label: 'Height', component: 'Number' },
    { parameter_name: 'width', label: 'Width', component: 'Number' }
  ]
};

const runtimeConfig = {
  api_prefix: '/gradio_api',
  dependencies: [
    { id: 0, api_name: 'on_image_upload' },
    { id: 2, api_name: 'generate_video' }
  ]
};

const mp4 = Buffer.from([
  0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
  0, 0, 0, 0, 0, 0, 0, 24, 0, 0, 0, 0
]);

const fileData = {
  path: '/tmp/gradio/out.mp4',
  url: 'https://space.test/gradio_api/file=/tmp/gradio/out.mp4',
  meta: { _type: 'gradio.FileData' }
};

function standardFetch(overrides = {}) {
  return async (url, options = {}) => {
    const target = String(url);
    if (overrides[target]) return overrides[target](options);
    if (target.includes('/api/spaces/')) {
      return json({ runtime: { stage: 'RUNNING' }, gated: false, disabled: false });
    }
    if (target.includes('/api/whoami-v2')) return json({ name: 'free-user' });
    if (target.endsWith('/config')) return json(runtimeConfig);
    if (target.endsWith('/gradio_api/info')) {
      return json({ named_endpoints: { '/generate_video': endpointSpec } });
    }
    throw new Error(`unexpected request: ${target}`);
  };
}

test('maps ratios to the Space presets, low by default and high on request', () => {
  assert.deepEqual(mapRatioToModelSize('9:16'), { width: 512, height: 768 });
  assert.deepEqual(mapRatioToModelSize('16:9'), { width: 768, height: 512 });
  assert.deepEqual(mapRatioToModelSize('1:1'), { width: 768, height: 768 });
  assert.deepEqual(mapRatioToModelSize('9:16', true), { width: 1024, height: 1536 });
  assert.deepEqual(mapRatioToModelSize('16:9', true), { width: 1536, height: 1024 });
});

test('clamps duration to the documented 1–10 second slider', () => {
  assert.equal(clampDuration(10), 10);
  assert.equal(clampDuration(3.14), 3.1);
  assert.equal(clampDuration(0), 1);
  assert.equal(clampDuration(50), 10);
});

test('builds payload order from the live API spec instead of a hard-coded order', () => {
  const values = {
    input_image: { url: 'data:image/png;base64,AAAA' },
    prompt: 'test prompt',
    duration: 5,
    enhance_prompt: false,
    seed: 10,
    randomize_seed: true,
    height: 768,
    width: 512
  };
  assert.deepEqual(buildPayloadFromInfo(endpointSpec, values), [
    values.input_image,
    'test prompt',
    5,
    false,
    10,
    true,
    768,
    512
  ]);
});

test('normalizes Gradio progress payloads', () => {
  assert.equal(extractProgress({ progress_data: [{ progress: 0.4 }] }), 0.4);
  assert.equal(extractProgress({ progress_data: [{ progress: 65 }] }), 0.65);
  assert.equal(extractProgress({ progress: 3 }), 3 / 100);
  assert.equal(extractProgress({}), null);
});

test('shows quota message only for confirmed quota errors, never for empty errors', () => {
  assert.equal(isQuotaError('ZeroGPU quota exceeded'), true);
  assert.equal(isQuotaError('null'), false);
  assert.match(classifyRemoteError(0, 'You have exceeded your ZeroGPU quota (0s left)'), /الحصة المجانية/);
  assert.match(classifyRemoteError(429, 'rate limit'), /الحصة المجانية/);
  const neutral = classifyRemoteError(0, '');
  assert.doesNotMatch(neutral, /الحصة|quota/);
  assert.match(neutral, /لم تُعد تفاصيل الخطأ/);
  assert.match(classifyRemoteError(503, 'Found no NVIDIA driver'), /متوقفة|خطأ في التشغيل/);
  assert.match(classifyRemoteError(403, 'gated repo'), /المصادقة|التوكن/);
  assert.match(classifyRemoteError(404, ''), /نقطة API/);
});

test('validates HF token shape without echoing the value', () => {
  assert.equal(isValidHfToken(TOKEN), true);
  assert.equal(isValidHfToken(`${TOKEN} extra`), false);
  assert.equal(isValidHfToken(`${TOKEN}\u001b[0m`), false);
  assert.equal(isValidHfToken(`hf_${'A'.repeat(33)}`), false);
  assert.equal(isValidHfToken(''), false);
});

test('rejects a malformed token format before building any Authorization header', async () => {
  let fetched = false;
  const fetchImpl = () => {
    fetched = true;
    throw new Error('fetch must not be called for a malformed token');
  };
  const config = makeConfig(`${TOKEN} copied-from-terminal`);
  config.video.ltx.tokenFormatValid = false;
  const provider = createHuggingFaceLtxProvider({ config, fetchImpl });
  const status = await provider.availability();
  assert.equal(fetched, false);
  assert.equal(status.available, false);
  assert.equal(status.auth.tokenConfigured, true);
  assert.equal(status.auth.authenticated, false);
  assert.match(status.reason, /صيغة التوكن غير صالحة/);
  assert.doesNotMatch(status.reason, new RegExp(TOKEN));
});

test('availability confirms the Space and reports anonymous mode without a token', async () => {
  const provider = createHuggingFaceLtxProvider({ config: makeConfig(), fetchImpl: standardFetch() });
  const status = await provider.availability();
  assert.equal(status.available, true);
  assert.equal(status.auth.tokenConfigured, false);
  assert.equal(status.auth.mode, 'anonymous');
});

test('availability verifies a free account token without exposing it', async () => {
  const provider = createHuggingFaceLtxProvider({ config: makeConfig(TOKEN), fetchImpl: standardFetch() });
  const status = await provider.availability();
  assert.equal(status.available, true);
  assert.equal(status.auth.authenticated, true);
  assert.equal(status.auth.user, 'free-user');
  assert.doesNotMatch(JSON.stringify(status), new RegExp(TOKEN));
});

test('availability rejects an invalid token with a clear Arabic reason and no token echo', async () => {
  const fetchImpl = standardFetch({
    'https://hf.test/api/whoami-v2': () => json({ error: 'Invalid username or password.' }, 401)
  });
  const provider = createHuggingFaceLtxProvider({ config: makeConfig(TOKEN), fetchImpl });
  const status = await provider.availability();
  assert.equal(status.available, false);
  assert.match(status.reason, /التوكن/);
  assert.doesNotMatch(status.reason, new RegExp(TOKEN));
});

test('submits I2V via queue/join and writes a validated MP4 from queue/data (mock transport)', async () => {
  const os = await import('node:os');
  const fs = await import('node:fs/promises');
  const nodePath = await import('node:path');
  const dir = await fs.mkdtemp(nodePath.join(os.tmpdir(), 'ltx-provider-'));
  const imagePath = nodePath.join(dir, 'input.png');
  const outputPath = nodePath.join(dir, 'output.mp4');
  await fs.writeFile(
    imagePath,
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9nZAAAAABJRU5ErkJggg==', 'base64')
  );

  const seen = { join: null, authHeader: null, eventStream: null };
  const sse = [
    'event: process_starts\ndata: {"msg":"process_starts","event_id":"evt-1"}\n\n',
    'data: {"msg":"progress","event_id":"evt-1","progress_data":[{"progress":0.5}]}\n\n',
    `data: ${JSON.stringify({
      msg: 'process_completed',
      event_id: 'evt-1',
      success: true,
      output: { data: [fileData, 42] }
    })}\n\n`,
    'data: {"msg":"close_stream","event_id":null}\n\n'
  ].join('');

  const fetchImpl = standardFetch({
    'https://space.test/gradio_api/queue/join': (options) => {
      seen.join = JSON.parse(options.body);
      seen.authHeader = options.headers.get('Authorization');
      return json({ event_id: 'evt-1' });
    },
    'https://space.test/gradio_api/queue/data?session_hash=probe': () => ({
      ok: true,
      status: 200,
      body: stream(sse)
    }),
    [fileData.url]: () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'video/mp4' },
      body: stream(new Uint8Array(mp4))
    })
  });

  // Capture the actual generated session_hash so the mock can answer it.
  const wrappedFetch = async (url, options = {}) => {
    if (String(url).includes('/queue/data?session_hash=')) {
      seen.eventStream = String(url);
      return {
        ok: true,
        status: 200,
        body: stream(sse)
      };
    }
    return fetchImpl(url, options);
  };

  const progressEvents = [];
  const provider = createHuggingFaceLtxProvider({ config: makeConfig(TOKEN), fetchImpl: wrappedFetch });
  await provider.generate({
    input: { mode: 'image', prompt: 'a cinematic test', ratio: '9:16', duration: 5 },
    imagePath,
    outputPath,
    context: {
      log() {},
      progress(value, stage) {
        progressEvents.push([value, stage]);
      }
    }
  });

  assert.equal(seen.join.fn_index, 2);
  assert.ok(seen.join.session_hash.startsWith('absam-'));
  assert.deepEqual(seen.join.data.slice(1), ['a cinematic test', 5, false, 10, true, 768, 512]);
  assert.match(seen.join.data[0].url, /^data:image\/png;base64,/);
  assert.equal(seen.authHeader, `Bearer ${TOKEN}`);
  assert.match(seen.eventStream, /session_hash=absam-/);
  assert.ok(progressEvents.some(([value]) => value > 0.2 && value < 0.9));
  const written = await fs.readFile(outputPath);
  assert.equal(written.subarray(4, 8).toString('ascii'), 'ftyp');
  assert.doesNotMatch(progressEvents.flat().join(' '), new RegExp(TOKEN));
  await fs.rm(dir, { recursive: true, force: true });
});

test('surfaces the real ZeroGPU error text from process_completed', async () => {
  const realError = 'You have exceeded your ZeroGPU quota (30s requested vs. 0s left). Try again in 0:00:00.';
  const sse = `data: ${JSON.stringify({
    msg: 'process_completed',
    event_id: 'evt-2',
    success: false,
    output: { error: realError, title: 'ZeroGPU quota exceeded' }
  })}\n\n`;
  const fetchImpl = standardFetch({
    'https://space.test/gradio_api/queue/join': () => json({ event_id: 'evt-2' }),
    'https://space.test/gradio_api/queue/data?session_hash=probe': () => ({ ok: true, status: 200, body: stream(sse) })
  });
  const wrappedFetch = (url, options) => {
    if (String(url).includes('/queue/data?session_hash=')) return fetchImpl('https://space.test/gradio_api/queue/data?session_hash=probe', options);
    return fetchImpl(url, options);
  };
  const provider = createHuggingFaceLtxProvider({ config: makeConfig(), fetchImpl: wrappedFetch });
  await assert.rejects(
    provider.generate({
      input: { mode: 'text', prompt: 'test', ratio: '16:9', duration: 5 },
      outputPath: '/tmp/should-not-exist.mp4',
      context: {}
    }),
    (error) => {
      assert.match(error.message, /الحصة المجانية/);
      assert.match(error.message, /ZeroGPU quota exceeded/);
      assert.match(error.message, /0s left/);
      return true;
    }
  );
});

test('an empty remote error stays neutral and never claims quota exhaustion', async () => {
  const sse = 'data: {"msg":"unexpected_error","event_id":"evt-3"}\n\n';
  const fetchImpl = standardFetch({
    'https://space.test/gradio_api/queue/join': () => json({ event_id: 'evt-3' }),
    'https://space.test/gradio_api/queue/data?session_hash=probe': () => ({ ok: true, status: 200, body: stream(sse) })
  });
  const wrappedFetch = (url, options) => {
    if (String(url).includes('/queue/data?session_hash=')) return fetchImpl('https://space.test/gradio_api/queue/data?session_hash=probe', options);
    return fetchImpl(url, options);
  };
  const provider = createHuggingFaceLtxProvider({ config: makeConfig(), fetchImpl: wrappedFetch });
  await assert.rejects(
    provider.generate({
      input: { mode: 'text', prompt: 'test', ratio: '16:9', duration: 5 },
      outputPath: '/tmp/should-not-exist.mp4',
      context: {}
    }),
    (error) => {
      assert.doesNotMatch(error.message, /الحصة|quota/);
      assert.match(error.message, /لم تُعد تفاصيل الخطأ/);
      return true;
    }
  );
});
