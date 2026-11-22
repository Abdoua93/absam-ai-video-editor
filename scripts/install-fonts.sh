#!/usr/bin/env bash
set -euo pipefail

mkdir -p assets/fonts
base="https://github.com/googlefonts/noto-fonts/raw/main/hinted/ttf/NotoNaskhArabic"
urls=(
  "$base/NotoNaskhArabic-Regular.ttf"
  "$base/NotoNaskhArabic-Bold.ttf"
)

for url in "${urls[@]}"; do
  name=$(basename "$url")
  if [[ -s "assets/fonts/$name" ]]; then
    echo "$name already present"
    continue
  fi
  echo "Downloading $name ..."
  if curl -fL --retry 2 -o "assets/fonts/$name" "$url"; then
    echo "  saved to assets/fonts/$name"
  else
    rm -f "assets/fonts/$name"
    echo "  failed. Install a system font instead:"
    echo "    Termux: pkg install fonts-noto-arabic"
    echo "    Alpine: apk add font-noto-arabic"
    echo "    Debian: apt install fonts-noto-core fonts-noto-extra"
    exit 1
  fi
done

echo "Done. Restart the server so libass sees the fonts (or set FONTS_DIR)."
