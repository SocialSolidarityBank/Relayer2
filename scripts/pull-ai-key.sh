#!/usr/bin/env bash
# OPENAI_API_KEY 를 Infisical 루트에서 받아 `.env` 에 넣는다(P3). 값은 찍지 않는다.
# AI 는 없어도 제품이 돈다 — 이 스크립트를 돌리지 않으면 AI 경로만 503 이다.
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077

opsvc="$HOME/.dotfiles/scripts/opsvc"
INFISICAL_TOKEN="$(OP_BIOMETRIC_UNLOCK_ENABLED=false "$opsvc" item get 'Infisical · account@ggbss.or.kr' \
  --vault BSS --fields label=ggbss_project_access_token --reveal)"
[ -n "$INFISICAL_TOKEN" ] || { echo "토큰을 읽지 못했다"; exit 1; }
export INFISICAL_TOKEN

tmp="$(mktemp -t relayer-ai)"
trap 'rm -f "$tmp"' EXIT
infisical run --env=prod --path=/ --silent -- sh -c 'printf "OPENAI_API_KEY=%s\n" "$OPENAI_API_KEY"' > "$tmp"
grep -q '^OPENAI_API_KEY=.\+' "$tmp" || { echo "OPENAI_API_KEY 를 받지 못했다"; exit 1; }

# 기존 줄을 지우고 새로 붙인다.
grep -v '^OPENAI_API_KEY=' .env > "$tmp.env" || true
cat "$tmp" >> "$tmp.env"
mv "$tmp.env" .env
chmod 600 .env
echo ".env 에 OPENAI_API_KEY 를 넣었다(값 미출력)."
