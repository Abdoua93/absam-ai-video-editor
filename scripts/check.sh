#!/usr/bin/env bash
set -euo pipefail

echo "ABSAM AI VIDEO EDITOR — environment check"
echo "------------------------------------------"

fail=0
node_version=$(node --version 2>/dev/null || true)
echo "Node:      ${node_version:-MISSING}"
if [[ -z "$node_version" ]]; then
  echo "  Install: pkg install nodejs  (Termux)  or  https://nodejs.org"
  fail=1
fi

ffmpeg_version=$(ffmpeg -version 2>/dev/null | head -n 1 || true)
echo "FFmpeg:    ${ffmpeg_version:-MISSING}"
if [[ -z "$ffmpeg_version" ]]; then
  echo "  Install: pkg install ffmpeg  (Termux)  or  sudo apt install ffmpeg"
  fail=1
else
  encoders=$(ffmpeg -hide_banner -encoders 2>/dev/null || true)
  filters=$(ffmpeg -hide_banner -filters 2>/dev/null || true)
  grep -q 'libx264' <<<"$encoders" || { echo "  WARNING: libx264 encoder missing (H.264 export needs it)."; fail=1; }
  grep -q ' subtitles ' <<<"$filters" || { echo "  WARNING: libass 'subtitles' filter missing (Arabic subtitles need it)."; fail=1; }
  grep -q ' silencedetect ' <<<"$filters" || echo "  WARNING: no silencedetect filter (auto trim will be limited)."
fi

if [[ -d assets/fonts ]] && compgen -G 'assets/fonts/*' >/dev/null; then
  echo "Fonts:     $(find assets/fonts -type f | wc -l) local font file(s)"
else
  echo "Fonts:     no local Arabic font (system fonts will be used)"
  echo "  Optional: npm run fonts"
fi

if [[ -d node_modules ]]; then echo "Packages:  installed"; else echo "Packages:  MISSING — run npm install"; fail=1; fi

echo "------------------------------------------"
if [[ $fail -eq 0 ]]; then
  echo "All good. Start with: npm start"
else
  echo "Some items need attention (see above)."
  exit 1
fi
