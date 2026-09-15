#!/usr/bin/env bash
# 맥미니에서 공개 주소로 띄운다(D2 임시). 앱은 여기서 돌고, DB 는 .env 가 가리키는 곳이다.
#
#   ./scripts/serve-public.sh          앱만 띄운다(8787)
#   ./scripts/serve-public.sh --tunnel 임시 공개 주소까지 만든다(trycloudflare, 무료·인증 불필요)
#
# 고정 주소가 필요하면 `cloudflared tunnel login` 뒤 이름 있는 터널을 만든다(docs/deploy.md).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

: "${PII_ENC_KEY:?PII_ENC_KEY 가 없다}"
: "${SESSION_SECRET:?SESSION_SECRET 가 없다}"

pnpm --dir web build
node api/src/migrate.ts
node api/src/index.ts &
app_pid=$!
trap 'kill $app_pid 2>/dev/null || true' EXIT

sleep 2
curl -fsS "http://127.0.0.1:${PORT:-8787}/health" >/dev/null && echo "앱 준비됨: http://127.0.0.1:${PORT:-8787}"

if [ "${1:-}" = "--tunnel" ]; then
  command -v cloudflared >/dev/null || { echo "cloudflared 가 없다: brew install cloudflared"; exit 1; }
  echo "임시 공개 주소를 만든다. 이 창을 닫으면 주소도 사라진다."
  cloudflared tunnel --url "http://127.0.0.1:${PORT:-8787}"
else
  wait $app_pid
fi
