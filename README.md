# ABSAM AI VIDEO EDITOR

A **mobile-first, free and open-source cloud video editor**. Upload clips from an Android phone, let the server find the useful parts, add right-to-left Arabic subtitles and background music, then export a 1080p MP4 — all with **FFmpeg** and **no paid APIs**.

> The "AI" part runs on your own machine/server: audio silence detection + scene-change analysis for trimming, and optional **local Whisper.cpp** for Arabic speech-to-text subtitles. Nothing is sent to a third party.

---

## Table of contents

1. [What gets built](#1-what-gets-built)
2. [Requirements](#2-requirements)
3. [Step 1 — Run it on an Android phone with Termux](#step-1--run-it-on-an-android-phone-with-termux)
4. [Step 2 — Make your first video in the mobile UI](#step-2--make-your-first-video-in-the-mobile-ui)
5. [Step 3 — Install an Arabic font for subtitles](#step-3--install-an-arabic-font-for-subtitles-optional-but-recommended)
6. [Step 4 — Enable offline Arabic transcription with Whisper](#step-4--enable-offline-arabic-transcription-with-whisper-optional)
7. [Step 5 — Deploy to the cloud with Docker](#step-5--deploy-to-the-cloud-with-docker)
8. [Step 6 — Object storage with MinIO / S3](#step-6--object-storage-with-minio--s3-optional)
9. [Step 7 — Secure a public deployment](#step-7--secure-a-public-deployment)
10. [How it works](#how-it-works)
11. [API reference](#api-reference)
12. [Configuration](#configuration)
13. [Troubleshooting & tests](#troubleshooting--tests)
14. [License](#license)

---

## 1. What gets built

```
 absam-ai-video-editor/
 ├── public/                  Mobile web UI (vanilla JS, no bundler, installable PWA)
 │   ├── index.html           Arabic RTL by default, English toggle
 │   ├── styles.css           Touch-friendly, safe-area aware, dark theme
 │   ├── app.js               Uploads, settings, job progress, download
 │   ├── sw.js / manifest…    Offline app shell
 ├── server/
 │   ├── index.js             Express bootstrap + optional password gate
 │   ├── routes.js            REST API, multipart uploads, SSE progress, range downloads
 │   ├── jobs.js              Persistent single-worker job queue
 │   ├── analyze.js           Silence + scene detection → trim plan (pure planners + job)
 │   ├── render.js            Per-segment normalisation, concat, subtitles, music, MP4
 │   ├── subtitles.js         SRT/VTT parser, ASS builder with RTL marks
 │   ├── transcribe.js        Optional local Whisper.cpp CLI wrapper
 │   ├── storage.js           Local disk or S3-compatible storage adapter
 │   ├── projects.js          Project JSON persistence
 │   ├── ffmpeg.js            Safe spawn wrappers, ffprobe, progress parsing
 │   └── config.js            Environment + .env loader
 ├── tests/                   Unit tests (node:test, no FFmpeg needed)
 ├── scripts/                 Environment check + Arabic font installer
 ├── Dockerfile / docker-compose.yml
 └── .env.example
```

### Feature checklist

| Requirement | Implementation |
|---|---|
| Mobile-first Android UI | Responsive PWA, 44px+ touch targets, RTL Arabic default, camera-friendly file input |
| Upload video files | Multipart upload, up to 20 clips / 800 MB each, validated with `ffprobe` |
| Automatic trim & combine | `silencedetect` + scene-change detection → ranked segments → concat demuxer |
| Arabic subtitles, RTL | SRT/VTT/plain-text parser, ASS `Dialogue` with U+200F RL marks, Noto Naskh Arabic, libass burn-in |
| Background music | Uploaded audio, looped/faded/mixed, **or** a free synthesized ambient bed |
| MP4 1080p export | 1920×1080 pad/scale, H.264 (libx264) + AAC, `+faststart`, 3 quality presets |
| FFmpeg | All analysis, thumbnails and rendering |
| AI text/image → video | Provider-swappable `/api/video/generate`, free HF Gradio Wan 2.2 adapter, job status, MP4 preview/download |
| Free/open source, no paid APIs | MIT code, Apache-2.0 AWS SDK (optional S3), FFmpeg/libass/Whisper.cpp; public free Gradio Space only, no paid API or keys in frontend |

### React AI studio screen

A separate React 19 + TypeScript screen lives in `src/` (the "text/image to video" studio UI). It is built with Vite and served by the same Express server at **`/studio/`**:

```bash
npm run build     # tsc --noEmit && vite build  → public/studio/
npm start         # then open http://localhost:8080/studio/
```

The original mobile editor remains at `/`. On Termux the npm scripts call the tools through `node` directly because `/usr/bin/env` is not available there.

### AI video generation (`/api/video/*`)

A separate generation backend lives in `server/video/`. It never touches the old editor routes and is provider-swappable: the UI and API only depend on `server/video/providers/index.js`.

| Endpoint | Purpose |
|---|---|
| `GET /api/video/providers` | List providers and whether each is actually installed (safe fields only) |
| `POST /api/video/generate` | Multipart: `mode`, `prompt`, `ratio`, `duration`, optional `image`. Returns `202` + job |
| `GET /api/video/jobs/:id` | Poll status, progress, stage and result |
| `GET /api/video/jobs/:id/events` | Server-sent events for the same job |
| `POST /api/video/jobs/:id/cancel` | Cancel a queued/running job |
| `GET /api/video/jobs/:id/preview` | Inline MP4 (supports byte ranges) |
| `GET /api/video/jobs/:id/download` | MP4 attachment |

The default provider is **`huggingface-ltx`**: the free public `Upsampler/ltx-video` Hugging Face Space running LTX 2.3 (text + image to video). It requires **no local weights, no `WAN22_MODEL_DIR`, no Python packages, and no GPU on the phone**. All calls (image submission, prediction, result download) are made by the backend only.

Verified live contract (read from `/config` and `/gradio_api/info`, not assumed):

```text
Space: https://huggingface.co/spaces/Upsampler/ltx-video
Runtime: RUNNING / zero-a10g / public / ungated
Join:    POST {space}/gradio_api/queue/join
         { data: [...], fn_index: <from /config>, session_hash: <random> }
Events:  GET  {space}/gradio_api/queue/data?session_hash=<same hash>
Inputs:  input_image, prompt, duration, enhance_prompt,
         seed, randomize_seed, height, width
Output:  [FileData(mp4), seed]
```

The adapter reads `parameter_name` from the live `/gradio_api/info` and builds the positional array in that exact order, so an upstream reordering cannot swap the image with the prompt or `height` with `width`. It uses the same `queue/join` + `queue/data` protocol as the browser: the simplified `/gradio_api/call/.../{event_id}` stream only returns `event: error / data: null` on failure and hides the real cause. A local image is sent as a Gradio `FileData` carrying a base64 data URL (supported by this Space's Image component); no fake/public URL is used. Ratios map to the Space's own presets: low = 512×768 / 768×512 / 768×768, high = 1024×1536 / 1536×1024 / 1024×1024 (`HF_LTX_HIGH_RES=1`). Duration is clamped to 1–10 s. The returned MP4 is downloaded, checked for the `ftyp` signature, then validated by `ffprobe` before the job can succeed.

The previous **`huggingface-wan22`** provider remains registered, so rollback is a one-line env change: `VIDEO_PROVIDER=huggingface-wan22`. That Space was observed in `RUNTIME_ERROR` (CPU hardware for a CUDA model), so it may report unavailable; this does not affect the new default.

Quota/stop behavior: ZeroGPU allows anonymous visitors a small daily quota (about 2 minutes) and registered Free accounts more (about 5 minutes). Low-resolution presets are the default to fit that quota. A quota message is displayed **only** when the Space's real error text confirms it (e.g. `ZeroGPU quota exceeded`); an empty `data: null` produces a neutral error, never a guess. If the Space is paused, stopped, or the quota is exhausted, `/generate` returns **503** with a clear Arabic message, and the UI never shows a fake result. No paid service or subscription is used.

`HF_LTX_TOKEN` (or `HF_TOKEN` as fallback) is optional, read only by the backend, and never exposed to the browser. It is used as a Bearer header on Space requests and verified with `GET https://huggingface.co/api/whoami-v2`; the resulting authentication state (never the token itself) is exposed in `/api/video/providers` and shown in the UI. Use a **Read-only** token from a **free** Hugging Face account. To add another provider later, implement `availability()` + `generate()` and register it in `server/video/providers/index.js`; no route or UI changes are needed.

---

## 2. Requirements

- **Node.js 20+** (22 recommended)
- **FFmpeg + FFprobe** with `libx264` and the libass `subtitles` filter
- 2–4 GB free storage for uploads and renders
- Optional: Docker + Docker Compose for cloud hosting
- Optional: Whisper.cpp with a GGML model for speech transcription

On Termux, FFmpeg from `pkg` includes libx264 and libass in current versions. Check with:

```bash
npm run check
```

---

## Step 1 — Run it on an Android phone with Termux

This is the fastest way to use the app directly on the phone whose camera roll holds the clips.

```bash
# 1. Install the runtime and FFmpeg
pkg update -y
pkg install -y nodejs ffmpeg git

# 2. Get the project (skip this if you already copied this folder)
git clone <your-repository-url> absam-ai-video-editor
cd absam-ai-video-editor

# 3. Install packages
npm install

# 4. Copy the sample config (optional, safe defaults work as-is)
cp .env.example .env

# 5. Verify the environment
npm run check

# 6. Optional: add or REPLACE a FREE Hugging Face token for more ZeroGPU quota
#    Create a Read-only token at https://huggingface.co/settings/tokens
#    The prompt hides what you type; nothing is echoed or committed.
npm run token:hf

# 7. Start the server
npm start
```

`npm run token:hf` can be run again to replace an existing token. It accepts **only** the token itself (`hf_` followed by 34 letters/digits). It rejects ANSI/terminal codes, spaces, extra text, and wrong shapes before writing, so a value copied from terminal output can never poison `.env`. If the value in `.env` is malformed, the backend reports `invalid format` in the startup log and `صيغة التوكن غير صالحة` in the provider status — without printing the value.

Always copy the token from the Hugging Face settings page, not from terminal output or logs.

The startup log prints only `Hugging Face token: loaded ...`, `invalid format ...`, or `not configured`; it never prints the value. Restart the server, then check the loaded state without revealing it:

```bash
pkill -f 'node server/index.js' && npm start
curl -s http://localhost:8080/api/video/providers | \
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(JSON.parse(s).providers.find(p=>p.id==="huggingface-ltx").auth)})'
```

Wait for `"authenticated": true` before starting any generation. A `401` means the token is invalid/revoked; `invalid format` means it was copied with extra text and must be re-entered.

The server prints two addresses:

```
ABSAM AI VIDEO EDITOR ready on http://localhost:8080
   phone / LAN: http://192.168.1.42:8080
```

Open the **phone/LAN** address in Chrome. Keep Termux awake while exporting:

```bash
termux-wake-lock
```

Tips:

- Use **Add to Home screen** in Chrome for a full-screen PWA.
- The phone and the server must be on the same Wi-Fi if you open it from another device.
- Stop with `Ctrl+C`; release the wake lock with `termux-wake-unlock`.

---

## Step 2 — Make your first video in the mobile UI

1. **Upload** — tap the upload card and select several clips. Thumbnails and durations appear.
2. **Trim** — leave *Auto trim* on, set a target length (e.g. `60` seconds) and max segment length (`15`), then tap **Analyse**. The server removes long silences, splits long clips near scene changes, ranks the segments, and shows how many were selected.
3. **Subtitles** — choose *Text or SRT*, type Arabic lines (the field is `dir="rtl"`), or upload an `.srt`/`.vtt`/`.txt` file, then tap **Apply subtitles**. Plain lines are spread evenly across the final timeline; timestamped files keep their own timings. Toggle RTL off only if you intentionally want LTR captions.
4. **Music** — upload an MP3/M4A/WAV, choose the free generated ambient bed, or disable music. Adjust the volume slider.
5. **Export** — pick a quality preset and tap **Start export**. Progress streams live; when done, tap **Download MP4**.

The output is always `1920×1080`, H.264/AAC, in an MP4 container with `faststart` for instant playback.

---

## Step 3 — Install an Arabic font for subtitles (optional but recommended)

Arabic shaping is done by libass with FriBidi/HarfBuzz, but a proper Arabic font makes a big visual difference.

```bash
npm run fonts
```

This downloads **Noto Naskh Arabic** into `assets/fonts/` from Google's font repository (SIL Open Font License). Alternatively:

```bash
# Termux
pkg install -y fonts-noto-arabic
# Debian/Ubuntu
sudo apt install -y fonts-noto-core fonts-noto-extra
# Alpine (also done automatically in the Docker image)
apk add font-noto-arabic
```

`FONTS_DIR` in `.env` points libass at the font folder. Restart the server after adding fonts.

---

## Step 4 — Enable offline Arabic transcription with Whisper (optional)

Whisper.cpp is open source (MIT) and runs entirely on your machine — no API key, no upload.

```bash
# Example on a desktop/Linux server (Termux also works with clang+cmake)
git clone https://github.com/ggml-org/whisper.cpp
cd whisper.cpp
cmake -B build && cmake --build build -j4
bash ./models/download-ggml-model.sh base     # multilingual model; supports Arabic
cd ..
```

Point the app at the binary and model:

```bash
# .env
WHISPER_BIN=/absam/whisper.cpp/build/bin/whisper-cli
WHISPER_MODEL=/absam/whisper.cpp/models/ggml-base.bin
WHISPER_LANG=ar
```

Restart, then select **Local Whisper (offline)** in the UI. The health strip/`GET /api/health` shows `whisper.available: true`. For each kept segment the server extracts 16 kHz mono audio, transcribes locally with `-l ar`, keeps only cues inside that segment, shifts them onto the final timeline, and burns them in as RTL ASS subtitles.

If Whisper is not configured, the option is disabled and pasted/SRT subtitles still work perfectly.

---

## Step 5 — Deploy to the cloud with Docker

```bash
# 1. Set a password before exposing it publicly
cat > .env <<'EOF'
APP_PASSWORD=choose-a-long-random-password
FFMPEG_CRF=21
EOF

# 2. Build and run
docker compose up -d --build

# 3. Watch logs
docker compose logs -f app
```

Open `http://<server-ip>:8080`. Uploads, projects and exported MP4s live in the named volume `absam_data`, so containers can be recreated safely.

Put a reverse proxy with HTTPS in front of it for real users. With Caddy:

```caddyfile
video.example.com {
  reverse_proxy 127.0.0.1:8080
}
```

Then `caddy reload`. Caddy handles certificates automatically.

For multiple concurrent renders, raise `JOB_CONCURRENCY` and CPU/RAM limits — the queue is persistent and each job runs an isolated set of FFmpeg processes.

---

## Step 6 — Object storage with MinIO / S3 (optional)

Local volumes are the default. To store assets in an S3-compatible bucket (MinIO, Cloudflare R2, AWS S3):

```bash
# .env
S3_ENDPOINT=http://127.0.0.1:9000
S3_BUCKET=absam-video
S3_ACCESS_KEY=absam
S3_SECRET_KEY=absam-secret
S3_FORCE_PATH_STYLE=true
```

Start the bundled MinIO with the optional profile:

```bash
docker compose --profile storage up -d
```

Create the `absam-video` bucket in the MinIO console at `http://<server-ip>:9001`. FFmpeg downloads assets into a local cache on demand; final MP4s are uploaded to the bucket and streamed back through the API with HTTP range support.

---

## Step 7 — Secure a public deployment

- Set `APP_PASSWORD`. The UI shows a gate and all non-health API calls require the `x-app-password` header.
- Always use HTTPS (Caddy/Nginx/Traefik).
- Restrict upload size at the proxy to match `MAX_UPLOAD_MB`.
- The app has no user accounts: it is designed as a private tool or single-tenant deployment. Add your own auth/proxy for multi-user hosting.
- Keep `data/` out of git (already in `.gitignore`).

---

## How it works

### Automatic trimming

1. `silencedetect=noise=-35dB:d=0.4` finds long silent gaps. Their complement becomes "active" intervals, with 0.14 s padding so speech is not cut.
2. `select=gt(scene,0.32),showinfo` finds scene changes. Active intervals longer than `maxClipSeconds` are recursively split at the scene cut nearest the ideal boundary.
3. Each candidate is scored for substance (length), visual energy (cuts per 4 s) and recency. The highest-scoring candidates are picked until the target duration is reached, then restored to source order.
4. Every selected segment is re-encoded to identical 1080p/30fps/H.264 parameters, concatenated with the FFmpeg concat demuxer, then subtitled and mixed in one final pass.

All of this is deterministic signal analysis — no network calls. Whisper adds real speech understanding when enabled.

### Arabic RTL subtitles

- SRT, WebVTT and plain lines are parsed into `{start, end, text}` cues.
- The ASS builder emits `PlayRes 1920×1080`, a bottom-centred `Noto Naskh Arabic` style, and prefixes every visual line with `U+200F (RIGHT-TO-LEFT MARK)`. Multi-line cues use ASS's `\N`.
- libass handles shaping and bidi via FriBidi/HarfBuzz; `fontsdir` points to the bundled or system Arabic fonts.
- Subtitles are burned in (not a soft subtitle track), so they appear on every phone and in every player. `GET /api/projects/:id/captions` also returns the cue list as SRT.

### Background music & export

Uploaded music is looped with `-stream_loop -1`, trimmed to the exact timeline, faded in/out, reduced by the chosen volume, and mixed with the clip audio via `amix` + `alimiter`. The `ambient` mode synthesizes a soft three-note pad with FFmpeg `sine`/`lowpass`/`aecho` — completely royalty-free.

Final encode: `libx264` (`veryfast`/CRF 25, `veryfast`/CRF 21, or `medium`/CRF 18), `yuv420p`, 30 fps, AAC 160 kbps, `+faststart`.

---

## API reference

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | FFmpeg/Whisper/storage status |
| POST | `/api/projects` | Create project `{title}` |
| GET | `/api/projects` / `/api/projects/:id` | List / read |
| DELETE | `/api/projects/:id` | Delete all assets |
| POST | `/api/projects/:id/clips` | Multipart `files[]` upload + probe + thumbnail |
| DELETE | `/api/projects/:id/clips/:clipId` | Remove a clip |
| GET | `/api/projects/:id/clips/:clipId/thumbnail` | JPEG thumbnail |
| PATCH | `/api/projects/:id/settings` | Update trim/subtitle/music/quality settings |
| POST | `/api/projects/:id/subtitles` | Multipart `text`, `mode`, optional `file` |
| POST | `/api/projects/:id/music` | Multipart `file` audio |
| POST | `/api/projects/:id/analyze` | Run analysis, wait for result |
| POST | `/api/projects/:id/render` | Queue export, returns job |
| GET | `/api/projects/:id/captions` | Download cues as SRT |
| GET | `/api/jobs/:id` | Job status |
| GET | `/api/jobs/:id/events` | Server-Sent Events progress |
| POST | `/api/jobs/:id/cancel` | Cancel a job |
| GET | `/api/jobs/:id/download` | Stream final MP4 (range requests supported) |

Example:

```bash
curl -X POST http://localhost:8080/api/projects \
  -H 'content-type: application/json' -d '{"title":"My video"}'

curl -X POST http://localhost:8080/api/projects/<id>/clips \
  -F 'files=@clip1.mp4' -F 'files=@clip2.mp4'
```

---

## Configuration

Copy `.env.example` to `.env`. Notable options:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` / `HOST` | `8080` / `0.0.0.0` | Listen address |
| `APP_PASSWORD` | empty | Shared password; empty = no gate (local only) |
| `MAX_UPLOAD_MB` / `MAX_CLIPS` | `800` / `20` | Upload limits |
| `JOB_CONCURRENCY` | `1` | Parallel render jobs |
| `FFMPEG_BIN` / `FFPROBE_BIN` | `ffmpeg` / `ffprobe` | Custom binaries |
| `FFMPEG_PRESET` / `FFMPEG_CRF` | `veryfast` / `21` | Speed/quality |
| `OUTPUT_FPS` | `30` | Output frame rate |
| `FONTS_DIR` / `SUBTITLE_FONT` | `assets/fonts` / `Noto Naskh Arabic` | Subtitle typography |
| `WHISPER_BIN` / `WHISPER_MODEL` | empty | Offline transcription |
| `VIDEO_PROVIDER` | `huggingface-ltx` | `huggingface-ltx`, `huggingface-wan22`, `wan22-local`, `none` |
| `HF_LTX_SPACE_ID` / `HF_LTX_SPACE_URL` | `Upsampler/ltx-video` / matching host | Free LTX Space |
| `HF_LTX_HIGH_RES` | `0` | Use high-resolution presets (much more quota) |
| `HF_LTX_TOKEN` / `HF_TOKEN` | empty | Optional backend-only Read token from a free Hugging Face account |
| `HF_WHOAMI_URL` | Hugging Face `/api/whoami-v2` | Endpoint used to verify the token without logging it |
| `S3_ENDPOINT` / `S3_BUCKET` | empty / `absam-video` | Object storage |

---

## Troubleshooting & tests

```bash
npm test        # 12 pure-logic tests, no FFmpeg required
npm run check   # verifies Node, FFmpeg, libx264, libass filter, fonts, packages
```

With the server running and FFmpeg installed, run a full pipeline test (generates two synthetic clips, uploads, analyses, subtitles, renders, and probes the exported MP4):

```bash
npm run smoke
```

- **`subtitles` filter missing** → install a libass-enabled FFmpeg build.
- **Arabic shows as boxes** → run `npm run fonts` or install a system Arabic font, then restart.
- **Render fails on one clip** → check the job log in the UI; the clip may be corrupt or have no video stream.
- **Whisper option disabled** → `WHISPER_BIN` and `WHISPER_MODEL` must both be set and the model file must exist.
- **Slow export on phone** → choose the *Fast* quality preset, shorten the target duration, or render on a cloud VM.
- **Downloads don't open on Android** → the download button uses a standard MP4 MIME type with range support; try "Open" to play in the browser.

---

## License

Application code: **MIT** (see `LICENSE`).

Third-party components keep their own licenses: FFmpeg (LGPL/GPL depending on build), libass (ISC), Whisper.cpp (MIT), Noto fonts (SIL OFL), Express/Multer/CORS (MIT), AWS SDK v3 (Apache-2.0), MinIO (AGPLv3, optional service only).
