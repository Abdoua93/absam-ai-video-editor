import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createHuggingFaceWan22Provider,
  mapRatioToModelSize,
  clampDuration,
  classifyRemoteError
} from '../server/video/providers/huggingface-wan22.js';

const config = {
  video: {
    huggingface: {
      spaceId: 'owner/space',
      spaceApiUrl: 'https://hf.test/api/spaces/owner/space',
      baseUrl: 'https://space.test',
      apiName: 'generate_video',
      token: '',
      timeoutMs: 1000,
      statusTimeoutMs: 1000,
      samplingSteps: 20,
      guideScale: null,
      shift: null,
      solver: 'unipc',
      offloadModel: true
    }
  }
};

const json = (value, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(value)
});

test('maps ratios to Wan 2.2 dimensions (multiples of 32, within max area)', () => {
  const portrait = mapRatioToModelSize('9:16');
  const landscape = mapRatioToModelSize('16:9');
  const square = mapRatioToModelSize('1:1');
  assert.deepEqual(portrait, { width: 704, height: 1280 });
  assert.deepEqual(landscape, { width: 1280, height: 704 });
  assert.deepEqual(square, { width: 896, height: 896 });
  for (const size of [portrait, landscape, square]) {
    assert.equal(size.width % 32, 0);
    assert.equal(size.height % 32, 0);
    assert.ok(size.width * size.height <= 1280 * 704);
  }
});

test('clamps duration to the model frame limit', () => {
  assert.equal(clampDuration(10), 7.5);
  assert.equal(clampDuration(3), 3);
  assert.equal(clampDuration(0), 0.5);
});

test('classifies quota, stopped service, auth and missing endpoint errors', () => {
  assert.match(classifyRemoteError(429, 'rate limit'), /حصة المجانية/);
  assert.match(classifyRemoteError(503, 'Found no NVIDIA driver'), /متوقفة/);
  assert.match(classifyRemoteError(403, 'gated repo'), /تصريح/);
  assert.match(classifyRemoteError(404, ''), /نقطة API/);
});

test('reports a stopped Space with its runtime error as unavailable', async () => {
  const provider = createHuggingFaceWan22Provider({
    config,
    fetchImpl: async (url) => {
      if (String(url).includes('/api/spaces/')) {
        return json({ runtime: { stage: 'RUNTIME_ERROR', errorMessage: 'Found no NVIDIA driver' } });
      }
      throw new Error('unexpected request');
    }
  });
  const status = await provider.availability();
  assert.equal(status.available, false);
  assert.match(status.reason, /متوقفة/);
  assert.match(status.reason, /NVIDIA/);
});

test('accepts a ready Space whose OpenAPI exposes generate_video', async () => {
  const provider = createHuggingFaceWan22Provider({
    config,
    fetchImpl: async (url) => {
      const target = String(url);
      if (target.includes('/api/spaces/')) return json({ runtime: { stage: 'READY' }, gated: false });
      if (target.endsWith('/gradio_api/info')) return json({ named_endpoints: {} });
      if (target.endsWith('/gradio_api/openapi.json')) {
        return json({ paths: { '/gradio_api/call/generate_video': {} } });
      }
      throw new Error(`unexpected request: ${target}`);
    }
  });
  const status = await provider.availability();
  assert.deepEqual(status, { available: true, reason: '' });
  assert.equal(provider.id, 'huggingface-wan22');
});
