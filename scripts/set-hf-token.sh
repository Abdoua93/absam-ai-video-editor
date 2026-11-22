#!/usr/bin/env bash
# Store a clean, backend-only HF_LTX_TOKEN in .env from inside Termux.
# The token is read with echo disabled, validated by shape, and never printed.
set -euo pipefail
export LC_ALL=C

cd "$(dirname "$0")/.."
umask 077

ENV_FILE='.env'

# 1. Make sure .env exists, using the safe sample as a starting point.
if [ ! -f "$ENV_FILE" ]; then
  cp .env.example "$ENV_FILE"
fi
chmod 600 "$ENV_FILE"

# 2. Make sure .env and its temporary siblings can never be committed.
#    .env.example stays tracked via the explicit negation below.
for pattern in '.env' '.env.*'; do
  if ! grep -qxF "$pattern" .gitignore 2>/dev/null; then
    printf '%s\n' "$pattern" >> .gitignore
  fi
done
if ! grep -qxF '!.env.example' .gitignore 2>/dev/null; then
  printf '%s\n' '!.env.example' >> .gitignore
fi

# 3. Read the token with echo disabled. IFS= preserves any stray whitespace so
#    validation can reject it instead of silently storing a contaminated value.
printf 'HF token (Read-only, free Hugging Face account): ' >&2
IFS= read -rs TOKEN
printf '\n' >&2

if [ -z "$TOKEN" ]; then
  echo 'No token entered; .env was left unchanged.' >&2
  unset TOKEN
  exit 1
fi

# 4. Refuse terminal-pasted noise. Nothing is trimmed or truncated: the user
#    must paste the token itself from https://huggingface.co/settings/tokens.
if [[ $TOKEN == *$'\033'* ]]; then
  echo 'The input contains ANSI/terminal codes. Copy the token only from https://huggingface.co/settings/tokens.' >&2
  unset TOKEN
  exit 1
fi
if [[ $TOKEN == *[[:space:]]* ]]; then
  echo 'The input contains spaces or line breaks. Copy the token only, with no extra text.' >&2
  unset TOKEN
  exit 1
fi
if [[ ! $TOKEN =~ ^hf_[A-Za-z0-9]{34}$ ]]; then
  echo 'Invalid token shape (expected hf_ followed by 34 letters/digits). Nothing was saved or printed.' >&2
  unset TOKEN
  exit 1
fi

# 5. Replace any previous value safely. The temp file lives beside .env so the
#    final rename is atomic, and it is covered by the .env.* ignore rule above.
tmp=$(mktemp .env.hf.XXXXXX)
trap 'rm -f "$tmp"' EXIT
awk '!/^HF_LTX_TOKEN=/' "$ENV_FILE" > "$tmp"
printf 'HF_LTX_TOKEN=%s\n' "$TOKEN" >> "$tmp"
chmod 600 "$tmp"
mv "$tmp" "$ENV_FILE"
trap - EXIT
unset TOKEN

echo 'Saved to .env (mode 600, gitignored, backend only, value hidden).'
echo "Restart ABSAM: pkill -f 'node server/index.js' && npm start"
echo "Verify: curl -s http://localhost:8080/api/video/providers | node -e 'let s=\"\";process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>{console.log(JSON.parse(s).providers.find(p=>p.id===\"huggingface-ltx\").auth)})'"
