const $ = (selector) => document.querySelector(selector);

const I18N = {
  ar: {
    gateTitle: 'محمي بكلمة مرور', gateHint: 'أدخل كلمة مرور التطبيق للمتابعة', passwordPlaceholder: 'كلمة المرور', unlock: 'فتح',
    brandAi: 'ذكاء', brandSub: 'محرر فيديو ذكي للجوال', checking: 'جارٍ فحص الخادم…', newProject: 'مشروع جديد',
    stepUpload: 'ارفع', stepTrim: 'قصّ', stepSubs: 'ترجمة', stepMusic: 'موسيقى', stepExport: 'تصدير',
    uploadTitle: 'ارفع مقاطع الفيديو', uploadHint: 'اختر عدة مقاطع — سيتم ترتيبها تلقائياً',
    dropTitle: 'اضغط لاختيار الفيديوهات', dropSub: 'MP4، MOV، WEBM — حتى 20 مقطعاً', noClips: 'لا توجد مقاطع بعد.',
    trimTitle: 'القصّ الذكي التلقائي', trimHint: 'يحذف الصمت ويختار أفضل اللحظات محلياً',
    autoTrim: 'تفعيل القصّ التلقائي', autoTrimSub: 'كشف الصمت ومشاهد الحركة',
    targetDuration: 'المدة المستهدفة (ث)', maxSegment: 'أطول مقطع (ث)', analyzeBtn: 'حلّل المقاطع واقترح القصّ',
    subsTitle: 'ترجمة عربية RTL', subsHint: 'النص يُكتب من اليمين إلى اليسار ويُحرق داخل الفيديو',
    subtitleMode: 'مصدر الترجمة', subNone: 'بدون ترجمة', subProvided: 'نص أو ملف SRT', subWhisper: 'Whisper محلي (بدون إنترنت)',
    subPlaceholder: 'اكتب الترجمة هنا، سطراً لكل جملة...\nأو الصق ملف SRT بعلامات الوقت',
    chooseSrt: 'ملف SRT / VTT', applySubs: 'تطبيق الترجمة', rtlToggle: 'اتجاه RTL', fontSize: 'حجم الخط',
    whisperHint: 'يحتاج تثبيت Whisper.cpp محلياً. راجع ملف README.',
    musicTitle: 'الموسيقى الخلفية', musicHint: 'ارفع موسيقاك أو استخدم نغمة مولّدة مجاناً',
    musicMode: 'المصدر', musicUpload: 'ملف صوتي مرفوع', musicAmbient: 'نغمة هادئة مولّدة', musicNone: 'بدون موسيقى',
    chooseAudio: 'اختر ملف MP3 / M4A / WAV', volume: 'مستوى الصوت',
    exportTitle: 'التصدير MP4 — 1080p', exportHint: 'H.264 + AAC، متوافق مع كل الهواتف',
    quality: 'الجودة', qualityFast: 'سريعة (أصغر حجماً)', qualityBalanced: 'متوازنة', qualityHigh: 'عالية',
    renderBtn: 'ابدأ التصدير', waiting: 'في الانتظار…', details: 'تفاصيل المعالجة', download: 'تنزيل MP4', openVideo: 'فتح',
    footer: 'مفتوح المصدر بالكامل · FFmpeg محلي · بدون واجهات مدفوعة',
    uploading: 'جارٍ الرفع…', analyzing: 'جارٍ التحليل…', rendering: 'جارٍ التصدير…', ready: 'جاهز للتنزيل',
    clipsCount: (n) => `${n} مقطع`, seconds: (n) => `${n} ث`, segments: (n) => `${n} مقطع مختار`,
    subtitlesReady: (n) => `${n} جملة ترجمة جاهزة`, chooseFirst: 'ارفع مقطع فيديو أولاً',
    analysisDone: 'اكتمل التحليل', uploadDone: 'تمت إضافة المقاطع', subsDone: 'تم حفظ الترجمة',
    musicDone: 'تمت إضافة الموسيقى', renderStarted: 'بدأ التصدير', exportDone: 'اكتمل التصدير!',
    renderFailed: 'فشل التصدير', downloadNow: 'تنزيل الملف', serverOffline: 'الخادم غير متصل',
    whisperMissing: 'Whisper غير مثبت على الخادم', wrongPassword: 'كلمة المرور غير صحيحة',
    interrupter: 'تم إلغاء المهمة', stage: { analysing: 'تحليل', 'rendering-clips': 'تجزئة المقاطع', muxing: 'دمج المقاطع', complete: 'اكتمل', failed: 'فشل' }
  },
  en: {
    gateTitle: 'Password protected', gateHint: 'Enter the app password to continue', passwordPlaceholder: 'Password', unlock: 'Unlock',
    brandAi: 'AI', brandSub: 'Smart video editor for phones', checking: 'Checking server…', newProject: 'New project',
    stepUpload: 'Upload', stepTrim: 'Trim', stepSubs: 'Subtitles', stepMusic: 'Music', stepExport: 'Export',
    uploadTitle: 'Upload video clips', uploadHint: 'Pick several clips — they are combined automatically',
    dropTitle: 'Tap to choose videos', dropSub: 'MP4, MOV, WEBM — up to 20 clips', noClips: 'No clips yet.',
    trimTitle: 'Automatic smart trim', trimHint: 'Removes silence and picks the best moments locally',
    autoTrim: 'Enable auto trim', autoTrimSub: 'Silence and scene-change detection',
    targetDuration: 'Target length (sec)', maxSegment: 'Max segment (sec)', analyzeBtn: 'Analyse & suggest trims',
    subsTitle: 'Arabic RTL subtitles', subsHint: 'Right-to-left text burned into the video',
    subtitleMode: 'Subtitle source', subNone: 'No subtitles', subProvided: 'Text or SRT file', subWhisper: 'Local Whisper (offline)',
    subPlaceholder: 'Type subtitles here, one line per sentence...\nor paste an SRT file with timestamps',
    chooseSrt: 'SRT / VTT file', applySubs: 'Apply subtitles', rtlToggle: 'RTL direction', fontSize: 'Font size',
    whisperHint: 'Requires local Whisper.cpp. See the README.',
    musicTitle: 'Background music', musicHint: 'Upload your own track or use a free generated bed',
    musicMode: 'Source', musicUpload: 'Uploaded audio', musicAmbient: 'Generated ambient bed', musicNone: 'No music',
    chooseAudio: 'Choose MP3 / M4A / WAV', volume: 'Volume',
    exportTitle: 'Export MP4 — 1080p', exportHint: 'H.264 + AAC, works on every phone',
    quality: 'Quality', qualityFast: 'Fast (smaller)', qualityBalanced: 'Balanced', qualityHigh: 'High',
    renderBtn: 'Start export', waiting: 'Waiting…', details: 'Processing details', download: 'Download MP4', openVideo: 'Open',
    footer: 'Fully open source · local FFmpeg · no paid APIs',
    uploading: 'Uploading…', analyzing: 'Analysing…', rendering: 'Exporting…', ready: 'Ready to download',
    clipsCount: (n) => `${n} clip${n === 1 ? '' : 's'}`, seconds: (n) => `${n}s`, segments: (n) => `${n} segment${n === 1 ? '' : 's'} selected`,
    subtitlesReady: (n) => `${n} subtitle line${n === 1 ? '' : 's'} ready`, chooseFirst: 'Upload a video first',
    analysisDone: 'Analysis complete', uploadDone: 'Clips added', subsDone: 'Subtitles saved',
    musicDone: 'Music added', renderStarted: 'Export started', exportDone: 'Export complete!',
    renderFailed: 'Export failed', downloadNow: 'Download file', serverOffline: 'Server is offline',
    whisperMissing: 'Whisper is not installed on the server', wrongPassword: 'Wrong password',
    interrupter: 'Job cancelled', stage: { analysing: 'Analysing', 'rendering-clips': 'Rendering clips', muxing: 'Merging', complete: 'Complete', failed: 'Failed' }
  }
};

const state = {
  lang: localStorage.getItem('absam_lang') === 'en' ? 'en' : 'ar',
  password: sessionStorage.getItem('absam_password') || '',
  project: null,
  health: null,
  job: null,
  subtitleFile: null,
  source: null,
  polling: null
};

const t = (key, ...args) => {
  const value = I18N[state.lang][key] ?? I18N.ar[key] ?? key;
  return typeof value === 'function' ? value(...args) : value;
};

function applyLanguage() {
  document.documentElement.lang = state.lang;
  document.documentElement.dir = state.lang === 'ar' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    const value = t(node.dataset.i18n);
    if (typeof value === 'string') node.textContent = value;
  });
  document.querySelectorAll('[data-i18n-ph]').forEach((node) => {
    node.placeholder = t(node.dataset.i18nPh);
  });
  $('#lang-toggle').textContent = state.lang === 'ar' ? 'EN' : 'ع';
  updatePrimaryAction();
  if (state.job) updateJob(state.job, false);
}

let toastTimer;
function toast(message, isError = false) {
  const node = $('#toast');
  node.textContent = message;
  node.style.borderColor = isError ? 'var(--danger)' : 'var(--line)';
  node.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.add('hidden'), 3600);
}

async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.password) headers['x-app-password'] = state.password;
  const response = await fetch(`/api${url}`, { ...options, headers });
  if (response.status === 401) {
    $('#password-gate').classList.remove('hidden');
    throw new Error(t('wrongPassword'));
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function xhrUpload(url, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api${url}`);
    if (state.password) xhr.setRequestHeader('x-app-password', state.password);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new Error(body.error || `HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error(t('serverOffline')));
    xhr.send(formData);
  });
}

async function loadProject() {
  const stored = localStorage.getItem('absam_project');
  if (stored) {
    try {
      state.project = await api(`/projects/${stored}`);
    } catch {
      localStorage.removeItem('absam_project');
    }
  }
  if (!state.project) {
    state.project = await api('/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'ABSAM video' })
    });
    localStorage.setItem('absam_project', state.project.id);
  }
  syncFormFromProject();
  renderClips();
  renderTrimResult();
  updatePrimaryAction();
}

function syncFormFromProject() {
  const p = state.project;
  if (!p) return;
  const s = p.settings;
  $('#auto-trim').checked = Boolean(s.autoTrim);
  $('#target-seconds').value = s.targetSeconds;
  $('#max-clip-seconds').value = s.maxClipSeconds;
  $('#subtitle-mode').value = s.subtitleMode;
  $('#subtitle-rtl').checked = s.subtitleRtl !== false;
  $('#font-size').value = s.subtitleFontSize || 52;
  $('#music-mode').value = s.musicMode;
  $('#music-volume').value = Math.round((s.musicVolume ?? 0.16) * 100);
  $('#volume-value').textContent = `${$('#music-volume').value}%`;
  $('#quality').value = s.quality;
  $('#music-name').textContent = p.assets.musicName || '';
  if (p.subtitles?.length) $('#subtitle-text').value = p.subtitles.map((cue) => cue.text.replace(/\n/g, ' ')).join('\n');
  updateSubtitleCount();
  updateModeBoxes();
}

function updateModeBoxes() {
  const mode = $('#subtitle-mode').value;
  $('#provided-box').classList.toggle('hidden', mode !== 'provided');
  $('#whisper-box').classList.toggle('hidden', mode !== 'whisper');
  const whisperOption = $('#subtitle-mode').querySelector('[value="whisper"]');
  whisperOption.disabled = !state.health?.whisper?.available;
  if (mode === 'whisper' && whisperOption.disabled) {
    $('#subtitle-mode').value = 'none';
    $('#whisper-box').classList.add('hidden');
  }
  $('#music-upload-box').classList.toggle('hidden', $('#music-mode').value !== 'upload');
}

function updateSubtitleCount() {
  const count = state.project?.subtitles?.length || 0;
  $('#subs-count').textContent = count ? t('subtitlesReady', count) : '';
}

function renderClips() {
  const list = $('#clip-list');
  list.innerHTML = '';
  const clips = state.project?.clips || [];
  $('#empty-clips').classList.toggle('hidden', clips.length > 0);
  for (const clip of clips) {
    const row = document.createElement('div');
    row.className = 'clip';
    const image = document.createElement('img');
    image.alt = clip.name;
    image.src = clip.thumbnailKey ? `/api/projects/${state.project.id}/clips/${clip.id}/thumbnail` : '/icon.svg';
    const info = document.createElement('div');
    info.className = 'clip-info';
    const title = document.createElement('b');
    title.textContent = clip.name;
    const meta = document.createElement('small');
    meta.textContent = `${t('seconds', Math.round(clip.duration))} · ${clip.width}×${clip.height} · ${t('segments', clip.trims?.length || 0)}`;
    info.append(title, meta);
    const remove = document.createElement('button');
    remove.className = 'clip-del';
    remove.textContent = '×';
    remove.title = 'Remove';
    remove.onclick = async () => {
      try {
        await api(`/projects/${state.project.id}/clips/${clip.id}`, { method: 'DELETE' });
        state.project = await api(`/projects/${state.project.id}`);
        renderClips();
        renderTrimResult();
        updatePrimaryAction();
      } catch (error) { toast(error.message, true); }
    };
    row.append(image, info, remove);
    list.append(row);
  }
}

function renderTrimResult() {
  const box = $('#trim-result');
  const clips = state.project?.clips || [];
  const trims = clips.flatMap((clip) => clip.trims || []);
  if (!trims.length) return box.classList.add('hidden');
  const seconds = Math.round(trims.reduce((sum, item) => sum + item.end - item.start, 0));
  box.innerHTML = `<b>${t('segments', trims.length)}</b><br>${t('seconds', seconds)} · ${t('analysisDone')}`;
  box.classList.remove('hidden');
}

function setBusy(isBusy, label) {
  for (const id of ['#analyze-btn', '#render-btn', '#primary-action', '#apply-subs']) {
    $(id).disabled = isBusy;
  }
  if (label) $('#primary-action').textContent = label;
}

function updatePrimaryAction() {
  const button = $('#primary-action');
  if (!button) return;
  const clips = state.project?.clips?.length || 0;
  const trims = state.project?.clips?.reduce((sum, clip) => sum + (clip.trims?.length || 0), 0) || 0;
  const done = state.job?.status === 'done';
  button.textContent = !clips ? t('chooseFirst') : (!trims ? t('analyzeBtn') : (done ? t('downloadNow') : t('renderBtn')));
}

async function patchSettings(patch) {
  try {
    state.project.settings = await api(`/projects/${state.project.id}/settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch)
    });
    if (Object.keys(patch).some((key) => ['autoTrim', 'targetSeconds', 'maxClipSeconds'].includes(key))) {
      renderClips();
      renderTrimResult();
      updatePrimaryAction();
    }
  } catch (error) { toast(error.message, true); }
}

async function uploadClips(files) {
  if (!files?.length) return;
  const form = new FormData();
  for (const file of files) form.append('files', file);
  const line = $('#upload-progress');
  line.classList.remove('hidden');
  const bar = line.querySelector('i');
  try {
    setBusy(true, t('uploading'));
    const result = await xhrUpload(`/projects/${state.project.id}/clips`, form, (ratio) => {
      bar.style.width = `${Math.round(ratio * 100)}%`;
    });
    state.project = result.project;
    renderClips();
    updatePrimaryAction();
    toast(t('uploadDone'));
  } catch (error) {
    toast(error.message, true);
  } finally {
    line.classList.add('hidden');
    bar.style.width = '0%';
    setBusy(false);
    updatePrimaryAction();
  }
}

async function analyze() {
  if (!state.project?.clips?.length) return toast(t('chooseFirst'), true);
  try {
    setBusy(true, t('analyzing'));
    const data = await api(`/projects/${state.project.id}/analyze`, { method: 'POST' });
    state.project = data.project;
    renderClips();
    renderTrimResult();
    toast(t('analysisDone'));
  } catch (error) {
    toast(error.message, true);
  } finally {
    setBusy(false);
    updatePrimaryAction();
  }
}

async function applySubtitles() {
  const mode = $('#subtitle-mode').value;
  if (mode === 'none') {
    await patchSettings({ subtitleMode: 'none' });
    toast(t('subsDone'));
    return;
  }
  if (mode === 'provided') {
    const text = $('#subtitle-text').value.trim();
    if (!text && !state.subtitleFile) return toast(t('subPlaceholder'), true);
    const form = new FormData();
    form.append('text', text);
    form.append('mode', 'provided');
    if (state.subtitleFile) form.append('file', state.subtitleFile);
    try {
      const result = await xhrUpload(`/projects/${state.project.id}/subtitles`, form, () => {});
      state.project.subtitles = result.cues;
      state.project.settings.subtitleMode = result.mode;
      updateSubtitleCount();
      toast(t('subsDone'));
    } catch (error) { toast(error.message, true); }
    return;
  }
  await patchSettings({ subtitleMode: 'whisper' });
}

async function renderVideo() {
  try {
    setBusy(true, t('rendering'));
    const job = await api(`/projects/${state.project.id}/render`, { method: 'POST' });
    state.job = job;
    $('#job-card').classList.remove('hidden');
    $('#job-actions').classList.add('hidden');
    updateJob(job);
    followJob(job.id);
    toast(t('renderStarted'));
  } catch (error) {
    toast(error.message, true);
  } finally {
    setBusy(false);
    updatePrimaryAction();
  }
}

function updateJob(job, notify = true) {
  state.job = job;
  $('#job-percent').textContent = `${job.progress || 0}%`;
  $('#job-bar').style.width = `${job.progress || 0}%`;
  const stage = job.stage === 'starting' ? 'analyzing' : job.stage;
  $('#job-stage').textContent = I18N[state.lang].stage[stage] || job.stage || t('waiting');
  $('#job-log').textContent = (job.log || []).slice(-25).join('\n');
  if (job.status === 'done') {
    $('#job-actions').classList.remove('hidden');
    const url = `/api/jobs/${job.id}/download`;
    $('#download-link').href = url;
    $('#open-link').href = url;
    if (notify) toast(t('exportDone'));
  }
  if (job.status === 'failed' && notify) toast(job.error || t('renderFailed'), true);
  updatePrimaryAction();
}

function followJob(id) {
  state.source?.close();
  clearInterval(state.polling);
  try {
    const source = new EventSource(`/api/jobs/${id}/events`);
    state.source = source;
    source.onmessage = (event) => {
      const job = JSON.parse(event.data);
      updateJob(job);
      if (['done', 'failed'].includes(job.status)) {
        source.close();
        state.source = null;
      }
    };
    source.onerror = () => {
      source.close();
      state.source = null;
      state.polling = setInterval(async () => {
        try {
          const job = await api(`/jobs/${id}`);
          updateJob(job);
          if (['done', 'failed'].includes(job.status)) clearInterval(state.polling);
        } catch { clearInterval(state.polling); }
      }, 2000);
    };
  } catch {
    // EventSource unavailable: polling fallback only.
  }
}

function bindEvents() {
  $('#lang-toggle').onclick = () => {
    state.lang = state.lang === 'ar' ? 'en' : 'ar';
    localStorage.setItem('absam_lang', state.lang);
    applyLanguage();
  };

  for (const button of document.querySelectorAll('.step')) {
    button.onclick = () => {
      document.querySelectorAll('.step').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      document.getElementById(button.dataset.scroll).scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  }

  $('#video-input').onchange = (event) => {
    uploadClips([...event.target.files]);
    event.target.value = '';
  };
  const zone = $('#dropzone');
  zone.ondragover = (event) => { event.preventDefault(); zone.classList.add('dragover'); };
  zone.ondragleave = () => zone.classList.remove('dragover');
  zone.ondrop = (event) => {
    event.preventDefault();
    zone.classList.remove('dragover');
    uploadClips([...event.dataTransfer.files]);
  };

  $('#auto-trim').onchange = (event) => patchSettings({ autoTrim: event.target.checked });
  $('#target-seconds').onchange = (event) => patchSettings({ targetSeconds: Number(event.target.value) });
  $('#max-clip-seconds').onchange = (event) => patchSettings({ maxClipSeconds: Number(event.target.value) });
  $('#analyze-btn').onclick = analyze;

  $('#subtitle-mode').onchange = (event) => {
    updateModeBoxes();
    patchSettings({ subtitleMode: event.target.value });
  };
  $('#subtitle-file').onchange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    state.subtitleFile = file;
    $('#subtitle-text').value = await file.text();
  };
  // Once the user edits the text, the edited text wins over the uploaded file.
  $('#subtitle-text').oninput = () => { state.subtitleFile = null; };
  $('#apply-subs').onclick = applySubtitles;
  $('#subtitle-rtl').onchange = (event) => patchSettings({ subtitleRtl: event.target.checked });
  $('#font-size').onchange = (event) => patchSettings({ subtitleFontSize: Number(event.target.value) });

  $('#music-mode').onchange = (event) => {
    updateModeBoxes();
    patchSettings({ musicMode: event.target.value });
  };
  $('#music-file').onchange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try {
      const result = await xhrUpload(`/projects/${state.project.id}/music`, form, () => {});
      $('#music-name').textContent = result.name;
      $('#music-mode').value = 'upload';
      updateModeBoxes();
      toast(t('musicDone'));
    } catch (error) { toast(error.message, true); }
  };
  $('#music-volume').oninput = (event) => {
    $('#volume-value').textContent = `${event.target.value}%`;
  };
  $('#music-volume').onchange = (event) => patchSettings({ musicVolume: Number(event.target.value) / 100 });

  $('#quality').onchange = (event) => patchSettings({ quality: event.target.value });
  $('#render-btn').onclick = renderVideo;

  $('#primary-action').onclick = () => {
    const clips = state.project?.clips?.length || 0;
    const trims = state.project?.clips?.reduce((sum, clip) => sum + (clip.trims?.length || 0), 0) || 0;
    if (!clips) document.getElementById('upload').scrollIntoView({ behavior: 'smooth' });
    else if (!trims) analyze();
    else if (state.job?.status === 'done') document.getElementById('export').scrollIntoView({ behavior: 'smooth' });
    else renderVideo();
  };

  const newProject = async () => {
    localStorage.removeItem('absam_project');
    state.job = null;
    $('#job-card').classList.add('hidden');
    await loadProject();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  $('#new-project').onclick = newProject;
  $('#new-project-inline').onclick = newProject;

  $('#password-submit').onclick = () => {
    state.password = $('#password-input').value.trim();
    sessionStorage.setItem('absam_password', state.password);
    $('#password-gate').classList.add('hidden');
    loadProject().catch(() => $('#password-gate').classList.remove('hidden'));
  };
}

async function init() {
  applyLanguage();
  bindEvents();
  try {
    state.health = await api('/health');
    $('#health-dot').classList.add('ok');
    $('#health-text').textContent = state.health.ffmpeg
      ? `FFmpeg ${state.health.ffmpeg.split(' ')[2] || 'ready'} · ${state.health.storage}`
      : t('serverOffline');
    if (!state.health.whisper.available) $('#subtitle-mode [value="whisper"]').disabled = true;
    await loadProject();
  } catch (error) {
    $('#health-dot').classList.add('bad');
    $('#health-text').textContent = t('serverOffline');
    toast(error.message, true);
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

init();
