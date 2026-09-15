#!/usr/bin/env bash
# Infisical `prod:/RELAYER2` 의 값을 이 기기의 `.env` 로 내려받는다(600).
# 값은 화면에 찍지 않는다. 이름과 건수만 낸다.
#
#   ./scripts/pull-secrets.sh
#
# 새 기기를 붙일 때 쓴다. 키를 사람 손으로 옮기지 않기 위한 절차다.
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077

opsvc="$HOME/.dotfiles/scripts/opsvc"
[ -x "$opsvc" ] || { echo "opsvc 가 없다: $opsvc"; exit 1; }

INFISICAL_TOKEN="$(OP_BIOMETRIC_UNLOCK_ENABLED=false "$opsvc" item get 'Infisical · account@ggbss.or.kr' \
  --vault BSS --fields label=ggbss_project_access_token --reveal)"
[ -n "$INFISICAL_TOKEN" ] || { echo "Infisical 토큰을 읽지 못했다"; exit 1; }
export INFISICAL_TOKEN

tmp="$(mktemp -t relayer-env)"
trap 'rm -f "$tmp"' EXIT

# `infisical run` 이 값을 자식 환경에만 넣는다. 자식이 필요한 세 개만 파일로 적는다.
infisical run --env=prod --path=/RELAYER2 --silent -- sh -c '
  for k in DATABASE_URL PII_ENC_KEY SESSION_SECRET; do
    eval "v=\$$k"
    [ -n "$v" ] && printf "%s=%s\n" "$k" "$v"
  done
' > "$tmp"

count="$(wc -l < "$tmp" | tr -d ' ')"
[ "$count" = "3" ] || { echo "받은 값이 3개가 아니다: ${count}개"; exit 1; }

printf 'PORT=%s\n' "${PORT:-8790}" >> "$tmp"
mv "$tmp" .env
chmod 600 .env
trap - EXIT

echo ".env 작성: $(cut -d= -f1 .env | tr '\n' ' ')"
