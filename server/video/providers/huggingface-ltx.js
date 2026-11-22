import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { safeName } from '../../utils.js';

// Live-verified contract (checked against /config and /gradio_api/info):
// Space: Upsampler/ltx-video  (RUNNING, zero-a10g, public, ungated)
// Browser protocol (Gradio 6): POST {base}{api_prefix}/queue/join
//                              GET  {base}{api_prefix}/queue/data?session_hash=...
// The simplified /gradio_api/call/{api}/{event_id} stream returns only
// `event: error / data: null` on failure, losing the real ZeroGPU message.
// The queue/data stream carries the detailed `process_completed.output.error`.
// Input order is read from /gradio_api/info (parameter_name), never assumed.
//   input_image, prompt, duration, enhance_prompt, seed, randomize_seed,
//   height, width
// Output: [FileData(mp4), seed]
// The image is sent as a Gradio FileData carrying a base64 data URL, which is
// supported by this Space and keeps the bytes inside the backend request.

const API_NAME = 'generate_video';
const EXPECTED_INPUTS = [
  'input_image',
  'prompt',
  'duration',
  'enhance_prompt',
  'seed',
  'randomize_seed',
  'height',
  'width'
];
const LABEL_ALIASES = {
  'Input Image (Optional)': 'input_image',
  'Prompt': 'prompt',
  'Duration (seconds)': 'duration',
  'Enhance Prompt': 'enhance_prompt',
  'Seed': 'seed',
  'Randomize Seed': 'randomize_seed',
  'Height': 'height',
  'Width': 'width'
};
const READY_STAGES = new Set(['RUNNING', 'READY']);
const ERROR_MESSAGES = new Set([
  'error',
  'unexpected_error',
  'queue_full',
  'broken_connection',
  'validation_error'
]);
const QUOTA_PATTERN = /quota|zero.?gpu|rate.?limit|exceeded|limit reached|not enough (?:quota|time)|free tier/i;
const AUTH_PATTERN = /unauthorized|forbidden|invalid (?:username|token)|gated|token required|authentication/i;
const STOPPED_PATTERN = /runtime.?error|not running|sleeping|stopped|unavailable|no nvidia|cuda|build error|dead/i;

const RESOLUTIONS = {
  low: {
    '9:16': { width: 512, height: 768 },
    '16:9': { width: 768, height: 512 },
    '1:1': { width: 768, height: 768 }
  },
  high: {
    '9:16': { width: 1024, height: 1536 },
    '16:9': { width: 1536, height: 1024 },
    '1:1': { width: 1024, height: 1024 }
  }
};

/** Map the UI ratio to the exact presets used by the Space's app.py. */
export function mapRatioToModelSize(ratio, highRes = false) {
  const tier = highRes ? 'high' : 'low';
  return { ...(RESOLUTIONS[tier][ratio] || RESOLUTIONS[tier]['9:16']) };
}

/** The Space slider accepts 1.0–10.0 seconds. */
export function clampDuration(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value)) return 5;
  return Math.max(1, Math.min(10, Math.round(value * 10) / 10));
}

/** True only when the remote response actually confirms a quota problem. */
export function isQuotaError(text = '') {
  return QUOTA_PATTERN.test(String(text || ''));
}

/**
 * Turn a remote failure into an Arabic message. A quota message is shown ONLY
 * when the Space's real error text confirms it; an empty error stays neutral.
 */
export function classifyRemoteError(status, body = '', title = '') {
  const text = String(body || '').slice(0, 500);
  const heading = String(title || '').trim();
  const detail = [heading, text].filter(Boolean).join(' — ');

  if (status === 429 || isQuotaError(detail)) {
    const suffix = detail ? ` تفاصيل المساحة: ${detail}` : '';
    return `انتهت الحصة المجانية لمساحة Hugging Face ZeroGPU أو تم تجاوز الحد المسموح. حاول لاحقاً، أو اضبط HF_LTX_TOKEN بحساب Free في الخادم فقط.${suffix}`;
  }
  if (status === 401 || status === 403 || AUTH_PATTERN.test(detail)) {
    return `فشلت المصادقة مع Hugging Face. تحقق من HF_LTX_TOKEN في الخادم فقط.${detail ? ` ${detail}` : ''}`;
  }
  if (status === 502 || status === 503 || status === 504 || STOPPED_PATTERN.test(detail)) {
    return `مساحة Hugging Face متوقفة حالياً أو تعاني من خطأ في التشغيل. حاول لاحقاً.${detail ? ` ${detail}` : ''}`;
  }
  if (status === 404) return 'نقطة API غير موجودة في المساحة؛ راجع إعدادات المحرك.';
  if (!detail) return 'تعذّر التوليد في المساحة؛ لم تُعد تفاصيل الخطأ. حاول لاحقاً.';
  return `تعذّر التوليد في المساحة${status ? ` (${status})` : ''}. ${detail}`;
}

function friendlyError(error) {
  if (error?.name === 'TimeoutError' || /aborted due to timeout/i.test(error?.message || '')) {
    return 'انتهت مهلة الاتصال بمساحة Hugging Face. حاول لاحقاً.';
  }
  if (error?.name === 'AbortError') return 'تم إلغاء التوليد.';
  return error?.message || String(error);
}

/**
 * Build the positional Gradio payload from the *live* /gradio_api/info spec.
 * The order comes from the Space itself, so an upstream reordering cannot
 * silently swap the image with the prompt or the height with the width.
 */
export function buildPayloadFromInfo(endpointSpec, values) {
  const parameters = endpointSpec?.parameters;
  if (!Array.isArray(parameters) || parameters.length !== EXPECTED_INPUTS.length) {
    throw new Error('واجهة Gradio API للمساحة لا تطابق العدد المتوقع للمدخلات.');
  }

  const names = parameters.map((param) => {
    const declared = param?.parameter_name;
    if (declared) return declared;
    return LABEL_ALIASES[param?.label] || param?.label || '';
  });
  const missing = EXPECTED_INPUTS.filter((name) => !names.includes(name));
  if (missing.length) {
    throw new Error(`واجهة المساحة لا تعرض المدخلات المتوقعة: ${missing.join(', ')}.`);
  }

  return parameters.map((param, index) => {
    const name = names[index];
    if (!Object.prototype.hasOwnProperty.call(values, name)) {
      throw new Error(`لا توجد قيمة للمدخل ${name || index + 1}.`);
    }
    return values[name];
  });
}

function outputFromData(data) {
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = outputFromData(item);
      if (found) return found;
    }
    return null;
  }
  if (!data || typeof data !== 'object') {
    return typeof data === 'string' && data.trim() ? data : null;
  }
  if (data.path || data.url) return data;
  if (data.output) return outputFromData(data.output);
  if (data.data) return outputFromData(data.data);
  return null;
}

/** Gradio emits several progress shapes; normalize them to 0..1. */
export function extractProgress(data) {
  if (!data || typeof data !== 'object') return null;
  const candidates = [];
  if (Array.isArray(data.progress_data)) candidates.push(...data.progress_data);
  else if (data.progress_data) candidates.push(data.progress_data);
  if (typeof data.progress === 'number') candidates.push({ progress: data.progress });
  if (typeof data.value === 'number' && data.value <= 1) candidates.push({ progress: data.value });

  for (const item of candidates) {
    let value = null;
    if (typeof item === 'number') value = item;
    else if (typeof item?.progress === 'number') value = item.progress;
    else if (typeof item?.value === 'number') value = item.value;
    if (value === null || !Number.isFinite(value)) continue;
    if (value > 0 && value <= 1) return value;
    if (value > 1 && value <= 100) return value / 100;
  }
  return null;
}

function encodedFileUrl(base, filePath) {
  const clean = String(filePath).replace(/^\/+/, '');
  const encoded = clean.split('/').map((part) => encodeURIComponent(part)).join('/');
  return `${base}/gradio_api/file=/${encoded}`;
}

function fileUrls(fileData, base) {
  const urls = [];
  if (typeof fileData === 'string') urls.push(fileData);
  if (fileData && typeof fileData === 'object') {
    if (fileData.url) urls.push(fileData.url);
    if (fileData.path && !/^data:/i.test(fileData.path)) {
      urls.push(encodedFileUrl(base, fileData.path));
      urls.push(`${base}/file=/${String(fileData.path).replace(/^\/+/, '')}`);
    }
  }
  return urls
    .filter(Boolean)
    .map((url) => (/^https?:\/\//i.test(url) ? url : new URL(url, base).toString()));
}

function mimeFromName(name) {
  const ext = path.extname(name || '').toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

function looksLikeMp4(filePath) {
  const handle = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(12);
    const bytesRead = fs.readSync(handle, buffer, 0, 12, 0);
    return bytesRead >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp';
  } finally {
    fs.closeSync(handle);
  }
}

function parseSseBlock(block) {
  let event = '';
  const dataLines = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  if (!dataLines.length) return null;
  const text = dataLines.join('\n');
  try {
    return { event, payload: text ? JSON.parse(text) : null };
  } catch {
    return { event, payload: null };
  }
}

/**
 * Backend-only adapter for Upsampler/ltx-video (free Hugging Face ZeroGPU).
 * All traffic to the Space is server-side; no token or Space URL is sent to
 * the browser. The token is only ever used as a Bearer header on requests.
 */
export function createHuggingFaceLtxProvider({
  config,
  logger,
  fetchImpl = fetch,
  cacheMs = 30_000
} = {}) {
  const hf = config.video.ltx;
  const base = String(hf.baseUrl).replace(/\/$/, '');
  const whoamiUrl = hf.whoamiUrl || 'https://huggingface.co/api/whoami-v2';
  let contractCache = null;
  let authCache = null;

  function headers(extra = {}) {
    const result = new Headers(extra);
    // Never logged, never returned to the client; used only as a request header.
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
      // Non-JSON bodies are still useful in classified error messages.
    }
    if (!response.ok) {
      const error = new Error(classifyRemoteError(response.status, text || json?.error || ''));
      error.status = response.status;
      throw error;
    }
    return json;
  }

  /** Verify the configured token without ever echoing it. */
  async function authStatus(force = false) {
    const now = Date.now();
    if (!force && authCache && now - authCache.at < cacheMs) return authCache.value;

    let value;
    if (!hf.token) {
      value = {
        tokenConfigured: false,
        authenticated: false,
        mode: 'anonymous',
        detail: 'التوليد كزائر مجهول؛ حصة ZeroGPU المجانية محدودة.'
      };
    } else if (hf.tokenFormatValid === false) {
      // Copied terminal output / extra text would make undici reject the
      // Authorization header before any request. Report it safely instead.
      value = {
        tokenConfigured: true,
        authenticated: false,
        mode: 'token',
        detail: 'صيغة التوكن غير صالحة؛ أعد إدخاله عبر npm run token:hf (انسخ التوكن وحده من صفحة Hugging Face).'
      };
    } else {
      try {
        const response = await fetchImpl(whoamiUrl, {
          headers: headers(),
          signal: AbortSignal.timeout(hf.statusTimeoutMs)
        });
        if (response.status === 401 || response.status === 403) {
          value = {
            tokenConfigured: true,
            authenticated: false,
            mode: 'token',
            detail: 'التوكن المضبوط في الخادم غير صالح أو منتهي.'
          };
        } else if (!response.ok) {
          value = {
            tokenConfigured: true,
            authenticated: false,
            mode: 'token',
            detail: classifyRemoteError(response.status, await response.text().catch(() => ''))
          };
        } else {
          const me = await response.json().catch(() => null);
          value = {
            tokenConfigured: true,
            authenticated: true,
            mode: 'token',
            user: String(me?.name || ''),
            detail: ''
          };
        }
      } catch (error) {
        value = {
          tokenConfigured: true,
          authenticated: false,
          mode: 'token',
          detail: `تعذّر التحقق من التوكن: ${friendlyError(error)}`
        };
      }
    }
    authCache = { at: now, value };
    return value;
  }

  async function loadContract(force = false) {
    const now = Date.now();
    if (!force && contractCache && now - contractCache.at < cacheMs) return contractCache.value;

    const meta = await requestJson(hf.spaceApiUrl, {
      headers: headers(),
      signal: AbortSignal.timeout(hf.statusTimeoutMs)
    });
    if (meta?.disabled) throw new Error('مساحة Hugging Face معطّلة من قِبل صاحبها.');
    if (meta?.gated) throw new Error('المساحة تتطلب تصريحاً؛ لا يمكن استخدامها بشكل مجاني مفتوح.');
    const stage = String(meta?.runtime?.stage || '').toUpperCase();
    if (stage && !READY_STAGES.has(stage)) {
      const detail = String(meta?.runtime?.errorMessage || '').slice(0, 300);
      const reason = classifyRemoteError(503, detail || `stage=${stage}`);
      throw new Error(detail ? `${reason} السبب: ${detail}` : reason);
    }

    // /config gives the live api_prefix and the fn_index of generate_video.
    const cfg = await requestJson(`${base}/config`, {
      headers: headers(),
      signal: AbortSignal.timeout(hf.statusTimeoutMs)
    });
    const apiPrefix = String(cfg?.api_prefix || '/gradio_api').replace(/\/$/, '');
    const dependency = (Array.isArray(cfg?.dependencies) ? cfg.dependencies : []).find(
      (item) => item?.api_name === (hf.apiName || API_NAME)
    );
    if (!dependency || !Number.isInteger(dependency.id)) {
      throw new Error(`لم تعثر المساحة على رقم الدالة ${hf.apiName || API_NAME} في /config.`);
    }

    const info = await requestJson(`${base}${apiPrefix}/info`, {
      headers: headers(),
      signal: AbortSignal.timeout(hf.statusTimeoutMs)
    });
    const endpointKey = `/${hf.apiName || API_NAME}`;
    const spec = info?.named_endpoints?.[endpointKey] || info?.unnamed_endpoints?.[endpointKey];
    if (!spec) throw new Error(`واجهة المساحة لا تعرض الدالة ${endpointKey}.`);
    buildPayloadFromInfo(spec, Object.fromEntries(EXPECTED_INPUTS.map((name) => [name, null])));

    const value = { spec, apiPrefix, fnIndex: dependency.id };
    contractCache = { at: now, value };
    return value;
  }

  async function availability() {
    const auth = await authStatus();
    if (auth.tokenConfigured && !auth.authenticated) {
      return { available: false, reason: auth.detail, auth };
    }
    try {
      await loadContract();
      return { available: true, reason: '', auth };
    } catch (error) {
      return { available: false, reason: friendlyError(error), auth };
    }
  }

  async function imageFileData(imagePath, originalName) {
    const bytes = await fs.promises.readFile(imagePath);
    const mime = mimeFromName(originalName || imagePath);
    return {
      url: `data:${mime};base64,${bytes.toString('base64')}`,
      orig_name: safeName(originalName || `input${path.extname(imagePath) || '.jpg'}`),
      mime_type: mime,
      size: bytes.length,
      is_stream: false,
      meta: { _type: 'gradio.FileData' }
    };
  }

  /**
   * Same protocol the browser uses: queue/join + queue/data. This is what
   * carries the real ZeroGPU error text instead of `data: null`.
   */
  async function submitAndWait(data, contract, context, signal) {
    const sessionHash = `absam-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const submitted = await requestJson(`${base}${contract.apiPrefix}/queue/join`, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        data,
        fn_index: contract.fnIndex,
        session_hash: sessionHash
      }),
      signal
    });
    const eventId = submitted?.event_id;
    if (!eventId) throw new Error('لم تُعد المساحة معرّف المهمة (event_id).');
    context?.progress?.(0.2, 'generating');

    const response = await fetchImpl(
      `${base}${contract.apiPrefix}/queue/data?session_hash=${encodeURIComponent(sessionHash)}`,
      { headers: headers({ Accept: 'text/event-stream' }), signal }
    );
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(classifyRemoteError(response.status, text));
    }
    if (!response.body) throw new Error('المساحة لم تُعد دائماً لقراءة النتيجة.');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let notified = false;
    let resultData = null;

    const noteGenerating = () => {
      if (notified) return;
      notified = true;
      context?.log?.('جارٍ التوليد على مساحة LTX في Hugging Face...');
    };

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

          const parsed = parseSseBlock(block);
          const message = parsed?.payload;
          if (!message) continue;
          if (message.event_id && message.event_id !== eventId) continue;

          const kind = message.msg || parsed.event || '';

          if (ERROR_MESSAGES.has(kind)) {
            const detail = message.message || message.output?.error || message.detail || '';
            throw new Error(classifyRemoteError(0, detail, message.title || message.output?.title || ''));
          }
          if (kind === 'progress') {
            const progress = extractProgress({ progress_data: message.progress_data });
            if (progress !== null) {
              context?.progress?.(0.2 + 0.65 * Math.min(1, progress), 'generating');
            }
            noteGenerating();
            continue;
          }
          if (kind === 'process_generating') {
            if (message.success === false) {
              throw new Error(
                classifyRemoteError(0, message.output?.error || message.message || '', message.output?.title || '')
              );
            }
            const progress = extractProgress({ progress_data: message.progress_data });
            if (progress !== null) {
              context?.progress?.(0.2 + 0.65 * Math.min(1, progress), 'generating');
            }
            noteGenerating();
            continue;
          }
          if (kind === 'log') {
            noteGenerating();
            continue;
          }
          if (kind === 'estimation' || kind === 'process_starts' || kind === 'send_hash') {
            noteGenerating();
            context?.progress?.(0.2, 'generating');
            continue;
          }
          if (kind === 'send_data') {
            if (message.data) resultData = outputFromData(message.data) || message.data;
            continue;
          }
          if (kind === 'process_completed') {
            const output = message.output || {};
            if (output.error !== undefined || message.success === false) {
              throw new Error(
                classifyRemoteError(0, output.error || message.message || '', output.title || message.title || '')
              );
            }
            if (output.data) resultData = outputFromData(output.data) || output.data;
            if (resultData) return resultData;
            continue;
          }
          if (kind === 'complete' || kind === 'data') {
            const output = outputFromData(message);
            if (output) return output;
            continue;
          }
          if (kind === 'close_stream') break;
        }
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        // Ignore.
      }
    }
    if (resultData) return resultData;
    throw new Error(classifyRemoteError(0, ''));
  }

  async function downloadOutput(data, outputPath, signal) {
    const urls = fileUrls(data, base);
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
        if (!looksLikeMp4(outputPath)) {
          lastError = new Error('الملف الذي أعادته المساحة ليس MP4 صالحاً.');
          await fs.promises.rm(outputPath, { force: true }).catch(() => {});
          continue;
        }
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
    const timeoutController = new AbortController();
    const onExternalAbort = () => timeoutController.abort(signal?.reason);
    if (signal) signal.addEventListener('abort', onExternalAbort, { once: true });
    const timer = setTimeout(
      () => timeoutController.abort(new DOMException('generation timeout', 'TimeoutError')),
      hf.timeoutMs
    );
    const activeSignal = timeoutController.signal;
    let diagnosticStage = 'authentication';

    try {
      const auth = await authStatus();
      if (auth.tokenConfigured && !auth.authenticated) throw new Error(auth.detail);
      context?.log?.(
        auth.authenticated
          ? 'المصادقة: حساب Hugging Face متصل (التوكن في الخادم فقط).'
          : 'المصادقة: زائر مجهول؛ الحصة المجانية محدودة.'
      );

        diagnosticStage = 'loading-contract';
      const contract = await loadContract();
      const size = mapRatioToModelSize(input.ratio, hf.highRes);
      const duration = clampDuration(input.duration);
      if (duration !== Number(input.duration)) {
        context?.log?.(`تم ضبط المدة إلى ${duration} ثانية حسب حدود المساحة.`);
      }

      const imageData = imagePath ? await imageFileData(imagePath, path.basename(imagePath)) : null;
      const data = buildPayloadFromInfo(contract.spec, {
        input_image: imageData,
        prompt: String(input.prompt),
        duration,
        enhance_prompt: hf.enhancePrompt,
        seed: hf.seed,
        randomize_seed: hf.randomizeSeed,
        height: size.height,
        width: size.width
      });

      logger?.(`[huggingface-ltx] submitting ${hf.apiName} ${size.width}x${size.height} ${duration}s`);
      diagnosticStage = 'submitting-generation';
    const result = await submitAndWait(data, contract, context, activeSignal);
      if (!result) throw new Error('لم ترجع المساحة أي فيديو.');
      context?.progress?.(0.88, 'generating');

        diagnosticStage = 'downloading-video';
      await downloadOutput(result, outputPath, activeSignal);
      context?.log?.('تم تنزيل فيديو LTX من المساحة بنجاح.');
    } catch (error) {
      const diagnosticMessage = String(error?.message || error)
        .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
        .replace(/\bhf_[A-Za-z0-9_-]+\b/g, '[REDACTED]')
        .slice(0, 200);
      logger?.(`[huggingface-ltx] failed stage=${diagnosticStage} name=${error?.name || 'Error'} message=${diagnosticMessage}`);
      throw error;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onExternalAbort);
    }
  }

  return {
    id: 'huggingface-ltx',
    name: 'Upsampler LTX Video via Hugging Face (free Gradio Space)',
    description: 'Free LTX 2.3 text/image-to-video on a public ZeroGPU Gradio Space; backend-only.',
    capabilities: {
      textToVideo: true,
      imageToVideo: true,
      ratios: ['9:16', '16:9', '1:1'],
      durations: [5, 10],
      notes: 'Low-resolution presets are used by default to fit the free ZeroGPU quota.'
    },
    availability,
    authStatus,
    generate
  };
}
