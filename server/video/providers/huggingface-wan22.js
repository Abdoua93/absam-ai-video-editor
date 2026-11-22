import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { safeName } from '../../utils.js';

// Verified from the Space's app.py (Wan 2.2 TI2V-5B, Gradio 6.1.0):
// gradio_api endpoint name: generate_video
// 12 positional inputs, in this exact order:
//   image, prompt, negative_prompt, height, width, duration_seconds,
//   sampling_steps, guide_scale, shift, sample_solver, seed, offload_model
const MAX_AREA = 1280 * 704;
const MOD = 32;
const MIN_FRAME_SECONDS = 0.5;
const MAX_FRAME_SECONDS = 7.5;

const MODEL_SIZES = {
  '9:16': { width: 704, height: 1280 },
  '16:9': { width: 1280, height: 704 },
  '1:1': { width: 896, height: 896 }
};

/** Map the UI aspect ratio to dimensions accepted by Wan 2.2 TI2V-5B. */
export function mapRatioToModelSize(ratio) {
  let { width, height } = MODEL_SIZES[ratio] || MODEL_SIZES['9:16'];
  const factor = Math.sqrt(MAX_AREA / (width * height));
  if (factor < 1) {
    width *= factor;
    height *= factor;
  }
  const snap = (value) => Math.max(MOD * 4, Math.min(1280, Math.floor(value / MOD) * MOD));
  return { width: snap(width), height: snap(height) };
}

/** The Space clamps to 8–121 frames; at its fixed fps this is about 7.5 s. */
export function clampDuration(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value)) return 5;
  return Math.max(MIN_FRAME_SECONDS, Math.min(MAX_FRAME_SECONDS, Math.round(value * 10) / 10));
}

/** Turn remote failures into clear Arabic messages, including quota/stop cases. */
export function classifyRemoteError(status, body = '') {
  const text = String(body || '').slice(0, 400);
  if (status === 429 || /quota|rate.?limit|exceeded|limit reached|free tier|zero.?gpu/i.test(text)) {
    return 'انتهت الحصة المجانية لمساحة Hugging Face أو تم تجاوز الحد المسموح. حاول لاحقاً.';
  }
  if (status === 401 || status === 403 || /unauthorized|forbidden|gated|token required/i.test(text)) {
    return 'المساحة تتطلب تصريحاً أو أن الوصول إليها مقيّد. لا توجد أي مفاتيح في الواجهة.';
  }
  if (
    status === 502 || status === 503 || status === 504 ||
    /runtime.?error|not running|sleeping|stopped|unavailable|no nvidia|cuda|build error|dead/i.test(text)
  ) {
    return 'مساحة Hugging Face متوقفة حالياً (RuntimeError أو hardware غير مناسب). حاول لاحقاً.';
  }
  if (status === 404) {
    return 'نقطة API غير موجودة في المساحة؛ راجع إعدادات api_name.';
  }
  return `تعذّر الاتصال بمساحة التوليد${status ? ` (${status})` : ''}.${text ? ` ${text}` : ''}`;
}

function friendlyError(error) {
  if (error?.name === 'TimeoutError' || /aborted due to timeout/i.test(error?.message || '')) {
    return 'انتهت مهلة الاتصال بمساحة Hugging Face. حاول لاحقاً.';
  }
  if (error?.name === 'AbortError') return 'تم إلغاء التوليد.';
  return error?.message || String(error);
}

/**
 * Free Hugging Face Gradio Space adapter. All requests originate in the
 * backend; the browser never sees the Space token (if one is configured).
 */
export function createHuggingFaceWan22Provider({ config, logger, fetchImpl = fetch } = {}) {
  const hf = config.video.huggingface;
  const base = String(hf.baseUrl).replace(/\/$/, '');
  const callUrl = `${base}/gradio_api/call/${hf.apiName}`;

  function headers(extra = {}) {
    const result = new Headers(extra);
    if (hf.token) result.set('Authorization', `Bearer ${hf.token}`);
    return result;
  }

  async function requestJson(url, options = {}) {
    const response = await fetchImpl(url, options);
    const text = await response.text().catch(() => '');
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Non-JSON error body: still useful in the classified message.
    }
    if (!response.ok) {
      const error = new Error(classifyRemoteError(response.status, text || json?.error || ''));
      error.status = response.status;
      throw error;
    }
    return json;
  }

  async function withStatusTimeout(work) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'TimeoutError')), hf.statusTimeoutMs);
    try {
      return await work(controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  async function availability() {
    try {
      const meta = await withStatusTimeout((signal) =>
        requestJson(hf.spaceApiUrl, { headers: headers(), signal })
      );

      if (meta?.disabled) {
        return { available: false, reason: 'مساحة Hugging Face معطّلة من قِبل صاحبها.' };
      }
      const runtime = meta?.runtime || {};
      if (runtime.stage && runtime.stage !== 'READY') {
        const detail = String(runtime.errorMessage || '').slice(0, 300);
        const reason = classifyRemoteError(503, detail);
        return { available: false, reason: detail ? `${reason} السبب: ${detail}` : reason };
      }

      // Verify that the live Gradio API really exposes generate_video.
      const endpoints = new Set();
      let firstError = null;
      try {
        const info = await withStatusTimeout((signal) =>
          requestJson(`${base}/gradio_api/info`, { headers: headers(), signal })
        );
        for (const key of Object.keys(info?.named_endpoints || {})) endpoints.add(key);
        for (const key of Object.keys(info?.unnamed_endpoints || {})) endpoints.add(key);
      } catch (error) {
        firstError = error;
      }
      try {
        const openapi = await withStatusTimeout((signal) =>
          requestJson(`${base}/gradio_api/openapi.json`, { headers: headers(), signal })
        );
        for (const key of Object.keys(openapi?.paths || {})) endpoints.add(key);
      } catch (error) {
        firstError ||= error;
      }

      if (!endpoints.size) {
        return {
          available: false,
          reason: firstError ? friendlyError(firstError) : 'تعذّر قراءة واجهة Gradio API.'
        };
      }
      const found = [...endpoints].some((key) => key.includes(`/${hf.apiName}`) || key === hf.apiName);
      if (!found) {
        return {
          available: false,
          reason: `واجهة المساحة لا تعرض الدالة ${hf.apiName}. تحقّق من إعداد HF_GRADIO_API_NAME.`
        };
      }
      return { available: true, reason: '' };
    } catch (error) {
      return { available: false, reason: friendlyError(error) };
    }
  }

  async function uploadImage(imagePath, originalName, signal) {
    const bytes = await fs.promises.readFile(imagePath);
    const ext = path.extname(originalName || '').toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    const name = safeName(originalName || `input${ext || '.jpg'}`);
    let lastError = null;

    for (const route of ['gradio_api/upload', 'upload']) {
      const form = new FormData();
      form.append('files', new Blob([bytes], { type: mime }), name);
      try {
        const result = await requestJson(`${base}/${route}`, {
          method: 'POST',
          headers: headers(),
          body: form,
          signal
        });
        const entry = Array.isArray(result)
          ? result[0]
          : (result?.files?.[0] ?? result);
        const uploaded = typeof entry === 'string' ? entry : entry?.path;
        if (!uploaded) throw new Error('لم تُعد المساحة مسار الصورة المرفوعة.');
        return {
          orig_name: name,
          path: uploaded,
          meta: { _type: 'gradio.FileData' }
        };
      } catch (error) {
        lastError = error;
        if (error.status !== 404) throw error;
      }
    }
    throw lastError || new Error('تعذّر رفع الصورة إلى المساحة.');
  }

  async function waitForCompletion(eventId, context, signal) {
    const response = await fetchImpl(`${callUrl}/${encodeURIComponent(eventId)}`, {
      headers: headers(),
      signal
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(classifyRemoteError(response.status, text));
    }
    if (!response.body) throw new Error('المساحة لم تُعد دائماً لقراءة النتيجة.');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let notified = false;

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r/g, '');

        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf('\n\n');
          if (!block.trim()) continue;

          let event = '';
          const dataLines = [];
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
          }
          const dataText = dataLines.join('\n');
          if (!event || event === 'heartbeat') continue;

          if (event.startsWith('error')) {
            let message = dataText;
            try {
              const parsed = JSON.parse(dataText);
              message = parsed?.error || parsed?.detail || parsed?.message || dataText;
            } catch {
              // Plain text error.
            }
            throw new Error(classifyRemoteError(0, message));
          }

          if (event === 'generating') {
            if (!notified) {
              notified = true;
              context?.log?.('جارٍ التوليد على مساحة Hugging Face...');
            }
            context?.progress?.(0.3, 'generating');
            continue;
          }

          if (event === 'complete') {
            let payload;
            try {
              payload = JSON.parse(dataText);
            } catch {
              throw new Error('أعادت المساحة نتيجة غير قابلة للقراءة.');
            }
            return Array.isArray(payload) ? payload[0] : payload;
          }
        }
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        // Ignore.
      }
    }
    throw new Error('أنهت المساحة الاتصال دون إرجاع فيديو.');
  }

  function fileUrls(fileData) {
    const urls = [];
    if (typeof fileData === 'string') urls.push(fileData);
    if (fileData && typeof fileData === 'object') {
      if (fileData.url) urls.push(fileData.url);
      if (fileData.path) {
        const clean = String(fileData.path).replace(/^\/+/, '');
        urls.push(`${base}/gradio_api/file=/${clean}`);
        urls.push(`${base}/file=/${clean}`);
      }
    }
    return urls
      .filter(Boolean)
      .map((url) => (/^https?:\/\//i.test(url) ? url : new URL(url, base).toString()));
  }

  async function downloadOutput(data, outputPath, signal) {
    const urls = fileUrls(data);
    if (!urls.length) throw new Error('لم تُعد المساحة مسار ملف الفيديو.');
    let lastError = null;

    for (const url of urls) {
      try {
        const response = await fetchImpl(url, { headers: headers(), signal });
        if (!response.ok) {
          lastError = new Error(classifyRemoteError(response.status, await response.text().catch(() => '')));
          continue;
        }
        const contentType = response.headers.get('content-type') || '';
        if (contentType && !/video|octet-stream|binary/i.test(contentType)) {
          lastError = new Error(`استجابة المساحة ليست ملف فيديو (${contentType}).`);
          continue;
        }
        if (!response.body) throw new Error('استجابة المساحة لا تحتوي على بيانات.');
        await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(outputPath));
        return;
      } catch (error) {
        lastError = error;
        if (signal?.aborted) throw error;
        await fs.promises.rm(outputPath, { force: true }).catch(() => {});
      }
    }
    throw lastError || new Error('تعذّر تنزيل الفيديو من المساحة.');
  }

  async function generate({ input, imagePath, outputPath, signal, context }) {
    const status = await availability();
    if (!status.available) throw new Error(status.reason);

    const size = mapRatioToModelSize(input.ratio);
    const duration = clampDuration(input.duration);
    if (duration < Number(input.duration)) {
      context?.log?.(`تم تقليص المدة إلى ${duration} ثانية حسب حدود النموذج.`);
    }

    let imageData = null;
    if (imagePath) {
      imageData = await uploadImage(imagePath, path.basename(imagePath), signal);
    }

    const data = [
      imageData,
      String(input.prompt),
      '',
      size.height,
      size.width,
      duration,
      hf.samplingSteps,
      hf.guideScale,
      hf.shift,
      hf.solver,
      -1,
      hf.offloadModel
    ];

    logger?.(`[huggingface-wan22] submitting ${hf.apiName} ${size.width}x${size.height} ${duration}s`);
    const submitted = await requestJson(callUrl, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ data }),
      signal
    });
    const eventId = submitted?.event_id;
    if (!eventId) throw new Error('لم تُعد المساحة معرّف المهمة (event_id).');
    context?.progress?.(0.25, 'generating');

    const result = await waitForCompletion(eventId, context, signal);
    if (!result) throw new Error('لم ترجع المساحة أي فيديو.');
    context?.progress?.(0.9, 'generating');

    await downloadOutput(result, outputPath, signal);
    context?.log?.('تم تنزيل الفيديو من المساحة بنجاح.');
  }

  return {
    id: 'huggingface-wan22',
    name: 'Wan 2.2 via Hugging Face (free Gradio Space)',
    description: 'Free cloud Wan 2.2 TI2V-5B through a public Gradio Space; called only from the backend.',
    capabilities: {
      textToVideo: true,
      imageToVideo: true,
      ratios: ['9:16', '16:9', '1:1'],
      durations: [5, 10],
      notes: 'Duration is clamped to ~7.5s by the upstream model.'
    },
    availability,
    generate
  };
}
