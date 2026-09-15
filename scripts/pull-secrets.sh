#!/usr/bin/env bash
# Infisical `prod:/RELAYER2` 의 값을 이 기기의 `.env`(600) 로 내려받는다.
# 값은 화면에 찍지 않는다. 새 기기를 붙일 때 쓴다 — 키를 사람 손으로 옮기지 않기 위한 절차다.
#
# 읽기도 Machine Identity 로 한다. project access token 의 스코프는 루트뿐이라
# `/RELAYER2` 를 읽지 못한다(2026-09-15 실측).
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077

opsvc="$HOME/.dotfiles/scripts/opsvc"
[ -x "$opsvc" ] || { echo "opsvc 가 없다: $opsvc"; exit 1; }

CLIENT_ID="$(OP_BIOMETRIC_UNLOCK_ENABLED=false "$opsvc" item get 'Infisical · account@ggbss.or.kr' \
  --vault BSS --fields label=ggbss_client_ID --reveal)"
CLIENT_SECRET="$(OP_BIOMETRIC_UNLOCK_ENABLED=false "$opsvc" item get 'Infisical · account@ggbss.or.kr' \
  --vault BSS --fields label=ggbss_client_secret --reveal)"
[ -n "$CLIENT_ID" ] && [ -n "$CLIENT_SECRET" ] || { echo "자격증명을 읽지 못했다"; exit 1; }

CLIENT_ID="$CLIENT_ID" CLIENT_SECRET="$CLIENT_SECRET" \
PROJECT_ID="a7c44b37-a885-4c62-98cd-cbc8a9810de9" SECRET_PATH="/RELAYER2" \
PORT="${PORT:-8790}" python3 scripts/infisical_get.py
