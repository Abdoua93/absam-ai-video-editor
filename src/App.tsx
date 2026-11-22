import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";

type Mode = "text" | "image";

type ProviderAuth = {
  tokenConfigured: boolean;
  authenticated: boolean;
  mode: string;
  user?: string;
  detail?: string;
};

type ProviderInfo = {
  id: string;
  name: string;
  description: string;
  available: boolean;
  reason: string;
  capabilities: Record<string, unknown>;
  auth?: ProviderAuth;
};

type GenerationResult = {
  key: string;
  filename: string;
  size: number;
  duration: number;
  width: number;
  height: number;
  fps: number;
  provider: string;
  previewUrl: string;
  downloadUrl: string;
};

type GenerationJob = {
  id: string;
  provider: string;
  input: {
    mode: Mode;
    prompt: string;
    ratio: string;
    duration: number;
    size: { width: number; height: number };
    hasImage: boolean;
  };
  status: "queued" | "running" | "done" | "failed";
  progress: number;
  stage: string;
  log: string[];
  error: string | null;
  result: GenerationResult | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

const API_BASE = "/api/video";

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const password = sessionStorage.getItem("absam_password");
  if (password) headers.set("x-app-password", password);

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    // A network/proxy error may return plain text.
  }
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : `تعذّر الاتصال بالخادم (${response.status}).`;
    throw new Error(message);
  }
  return data as T;
}

const STAGE_LABELS: Record<string, string> = {
  waiting: "في قائمة الانتظار",
  preparing: "جارٍ تجهيز المدخلات",
  generating: "جارٍ توليد الفيديو",
  validating: "جارٍ التحقق من الفيديو",
  storing: "جارٍ حفظ الفيديو",
  complete: "اكتمل التوليد",
  failed: "فشل التوليد"
};

export default function App() {
  const [mode, setMode] = useState<Mode>("text");
  const [prompt, setPrompt] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [ratio, setRatio] = useState("9:16");
  const [duration, setDuration] = useState("5");

  const [job, setJob] = useState<GenerationJob | null>(null);
  const [engine, setEngine] = useState<ProviderInfo | null>(null);
  const [engineLoaded, setEngineLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const busy = submitting || job?.status === "queued" || job?.status === "running";
  const canGenerate =
    prompt.trim().length >= 3 && (mode === "text" || file !== null) && !busy;

  useEffect(() => {
    let active = true;
    apiRequest<{ providers: ProviderInfo[]; defaultProvider: string }>("/providers")
      .then((data) => {
        if (!active) return;
        setEngine(
          data.providers.find((item) => item.id === data.defaultProvider) ??
            data.providers[0] ??
            null
        );
      })
      .catch(() => {
        // The generate action will still show a clear server error.
      })
      .finally(() => {
        if (active) setEngineLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!job || !["queued", "running"].includes(job.status)) return;
    let active = true;
    const timer = window.setInterval(() => {
      apiRequest<GenerationJob>(`/jobs/${encodeURIComponent(job.id)}`)
        .then((updated) => {
          if (active) setJob(updated);
        })
        .catch((pollError: Error) => {
          if (active) setError(pollError.message);
        });
    }, 1500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [job?.id, job?.status]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setFile(event.target.files?.[0] ?? null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canGenerate) return;
    setError(null);
    setJob(null);
    setSubmitting(true);
    try {
      const body = new FormData();
      body.set("mode", mode);
      body.set("prompt", prompt.trim());
      body.set("ratio", ratio);
      body.set("duration", duration);
      if (mode === "image" && file) body.set("image", file);

      const response = await apiRequest<{ job: GenerationJob }>("/generate", {
        method: "POST",
        body
      });
      setJob(response.job);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "حدث خطأ غير متوقع.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (!job || !["queued", "running"].includes(job.status)) return;
    try {
      const updated = await apiRequest<GenerationJob>(
        `/jobs/${encodeURIComponent(job.id)}/cancel`,
        { method: "POST" }
      );
      setJob(updated);
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "تعذّر إلغاء التوليد.");
    }
  };

  const result = job?.status === "done" ? job.result : null;

  return (
    <main className="app" dir="rtl" lang="ar">
      <header className="header">
        <div className="logo">
          ✦ ABSAM <span>AI VIDEO</span>
        </div>
        <div className="subtitle">استوديو صناعة الفيديو بالذكاء الاصطناعي</div>
      </header>

      <section className="hero">
        <div className="tag">✦ AI CREATIVE STUDIO</div>
        <h1>حوّل أفكارك إلى فيديوهات مذهلة</h1>
        <p>أطلق العنان لإبداعك مع الذكاء الاصطناعي</p>
      </section>

      <section className="panel" aria-labelledby="create-title">
        <h2 id="create-title">إنشاء فيديو جديد</h2>

        {engineLoaded && (
          <p className={`engine-status ${engine?.available ? "ready" : "unavailable"}`}>
            {engine
              ? engine.available
                ? `المحرك جاهز: ${engine.name}`
                : `المحرك غير متاح: ${engine.reason || "لم يتم تهيئة محرك التوليد."}`
              : "تعذّر التحقق من محرك التوليد."}
          </p>
        )}

        {engine?.auth && (
          <p className="engine-auth">
            {engine.auth.tokenConfigured
              ? engine.auth.authenticated
                ? `حساب Hugging Face متصل${engine.auth.user ? ` (${engine.auth.user})` : ""}`
                : `إعداد التوكن في الخادم يحتاج مراجعة: ${engine.auth.detail || "غير صالح"}`
              : "التوليد كزائر مجهول؛ أضف توكن Hugging Face مجاني في الخادم لزيادة الحصة."}
          </p>
        )}

        <form onSubmit={handleSubmit}>
          <div className="tabs" role="tablist" aria-label="نوع الفيديو">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "text"}
              className={mode === "text" ? "active" : ""}
              onClick={() => setMode("text")}
            >
              ✍️ نص إلى فيديو
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={mode === "image"}
              className={mode === "image" ? "active" : ""}
              onClick={() => setMode("image")}
            >
              🖼️ صورة إلى فيديو
            </button>
          </div>

          <label className="field-title" htmlFor="prompt">
            {mode === "text" ? "وصف الفيديو" : "وصف الحركة المطلوبة"}
          </label>

          <textarea
            id="prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="اكتب هنا وصف الفيديو الذي تريد إنشاءه..."
            dir="rtl"
            rows={5}
          />

          {mode === "image" && (
            <label className="upload">
              <span>＋</span>
              <strong>اختر صورة من هاتفك</strong>
              <small>{file ? file.name : "PNG أو JPG"}</small>
              <input
                type="file"
                accept="image/*"
                onChange={handleFileChange}
              />
            </label>
          )}

          <span className="field-title" id="ratio-label">أبعاد الفيديو</span>
          <div className="formats" role="group" aria-labelledby="ratio-label">
            {["9:16", "16:9", "1:1"].map((item) => (
              <button
                type="button"
                key={item}
                aria-pressed={ratio === item}
                className={ratio === item ? "selected" : ""}
                onClick={() => setRatio(item)}
              >
                {item}
              </button>
            ))}
          </div>

          <label className="field-title" htmlFor="duration">مدة الفيديو</label>
          <select
            id="duration"
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
          >
            <option value="5">5 ثوانٍ</option>
            <option value="10">10 ثوانٍ</option>
          </select>

          <button className="generate" type="submit" disabled={!canGenerate}>
            {busy ? "⏳ جارٍ التوليد..." : "✨ توليد الفيديو"}
          </button>
        </form>

        {error && (
          <div className="message error" role="alert">
            {error}
          </div>
        )}

        {job && job.status !== "done" && (
          <div className="progress-card" aria-live="polite">
            <div className="progress-head">
              <strong>{STAGE_LABELS[job.stage] || job.stage}</strong>
              <span>{job.progress}%</span>
            </div>
            <div
              className="progress-track"
              role="progressbar"
              aria-valuenow={job.progress}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="progress-fill" style={{ width: `${job.progress}%` }} />
            </div>
            {job.error && <p className="message error">{job.error}</p>}
            {busy && (
              <button type="button" className="secondary" onClick={handleCancel}>
                إلغاء التوليد
              </button>
            )}
          </div>
        )}

        {result && (
          <div className="result-card">
            <h3>الفيديو جاهز</h3>
            <video
              src={result.previewUrl}
              controls
              playsInline
              preload="metadata"
            />
            <a
              className="download"
              href={result.downloadUrl}
              download={result.filename}
            >
              ⬇️ تحميل MP4
            </a>
            <small>
              {result.width}×{result.height} • {result.duration.toFixed(1)} ثانية •{" "}
              {result.provider}
            </small>
          </div>
        )}

        <p className="notice">
          {engine?.available
            ? "يتم التوليد عبر مساحة Gradio مجانية من الخادم. لا توجد مفاتيح أو اشتراكات في الواجهة، وتخضع المدة والدقة لحدود الحصة المجانية."
            : `لن يظهر أي فيديو وهمي. ${engine?.reason || "المحرك غير متاح حالياً."}`}
        </p>
      </section>

      <footer>ABSAM AI VIDEO © 2026</footer>
    </main>
  );
}
