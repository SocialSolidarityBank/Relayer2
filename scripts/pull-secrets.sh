#!/usr/bin/env bash
# Infisical `prod:/RELAYER2/<slug>` 값을 이 기기의 `.env`(0600)로 내려받는다.
# 경로를 생략하면 옛 단일 배포 경로 `/RELAYER2`를 읽는다. 값은 화면에 출력하지 않는다.
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077

opsvc="$HOME/.dotfiles/scripts/opsvc"
[ -x "$opsvc" ] || { echo "opsvc가 없다: $opsvc"; exit 1; }

secret_path="${1:-/RELAYER2}"
refs="$(mktemp -t relayer-infisical-refs)"
trap 'rm -f "$refs"' EXIT
cat >"$refs" <<'EOF'
CLIENT_ID=op://BSS/Infisical · account@ggbss.or.kr/ggbss_client_ID
CLIENT_SECRET=op://BSS/Infisical · account@ggbss.or.kr/ggbss_client_secret
EOF
chmod 600 "$refs"

OP_BIOMETRIC_UNLOCK_ENABLED=false "$opsvc" run --env-file="$refs" -- \
  env PROJECT_ID="a7c44b37-a885-4c62-98cd-cbc8a9810de9" PORT="${PORT:-8790}" \
  python3 scripts/infisical_get.py "$secret_path"
