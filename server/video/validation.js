export const MODES = ['text', 'image'];
export const RATIOS = ['9:16', '16:9', '1:1'];
export const DURATIONS = ['5', '10'];

const RATIO_SIZES = {
  '9:16': { width: 720, height: 1280 },
  '16:9': { width: 1280, height: 720 },
  '1:1': { width: 1024, height: 1024 }
};

/** Pure validation of the public generation request. No I/O, no secrets. */
export function normalizeGenerationInput(body = {}, imageFile = null) {
  const mode = String(body.mode || 'text').toLowerCase();
  if (!MODES.includes(mode)) {
    throw new Error('نوع الفيديو غير صالح. اختر text أو image.');
  }

  const prompt = String(body.prompt || '').trim();
  if (prompt.length < 3) {
    throw new Error('اكتب وصفاً للفيديو (3 أحرف على الأقل).');
  }
  if (prompt.length > 1000) {
    throw new Error('الوصف طويل جداً (الحد الأقصى 1000 حرف).');
  }

  const ratio = String(body.ratio || '9:16');
  if (!RATIOS.includes(ratio)) {
    throw new Error('أبعاد الفيديو غير صالحة. اختر 9:16 أو 16:9 أو 1:1.');
  }

  const durationRaw = String(body.duration || '5');
  if (!DURATIONS.includes(durationRaw)) {
    throw new Error('مدة الفيديو غير صالحة. اختر 5 أو 10 ثوانٍ.');
  }

  if (mode === 'image') {
    if (!imageFile) {
      throw new Error('وضع صورة إلى فيديو يحتاج إلى صورة مرفوعة.');
    }
    if (!String(imageFile.mimetype || '').startsWith('image/')) {
      throw new Error('الملف المرفوع يجب أن يكون صورة PNG أو JPG.');
    }
  }

  return {
    mode,
    prompt,
    ratio,
    duration: Number(durationRaw),
    size: RATIO_SIZES[ratio],
    hasImage: mode === 'image' && Boolean(imageFile)
  };
}

/** Only expose safe fields to the browser/API consumers. */
export function publicProvider(info) {
  return {
    id: info.id,
    name: info.name,
    description: info.description,
    available: Boolean(info.available),
    reason: info.reason || '',
    capabilities: info.capabilities || {}
  };
}
