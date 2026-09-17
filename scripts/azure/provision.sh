#!/usr/bin/env bash
# Azure 자원 준비(docs/azure-migration.md). 기본은 DRY-RUN — 무엇을 만들지만 보여 준다.
# 실제로 만들 때만:
#   APPLY=1 ./scripts/azure/provision.sh
#
# 비밀값은 여기 없다. 시크릿 주입은 Infisical → .env → az containerapp secret set 순서다.
set -euo pipefail

# ── 여기만 고친다 ─────────────────────────────
RG=relayer2-prod
LOCATION=koreacentral
ACA_ENV=relayer2-env
ACA_APP=relayer2
ST_ACCOUNT=relayer2voice      # 전역 유일 — 소문자·숫자만
ST_CONTAINER=voice
# ───────────────────────────────────────────────

APPLY="${APPLY:-0}"
run() {
  if [ "$APPLY" = "1" ]; then "$@"; else printf '[dry-run] %s\n' "$*"; fi
}
# 이미 있으면 건너뛴다 — 두 번 돌려도 같은 상태다.
ensure() { # ensure <확인 명령...> -- <생성 명령...>
  local check=() create=() seen=0
  for a in "$@"; do
    if [ "$a" = "--" ]; then seen=1; continue; fi
    if [ "$seen" = 0 ]; then check+=("$a"); else create+=("$a"); fi
  done
  if [ "$APPLY" = "1" ] && "${check[@]}" >/dev/null 2>&1; then
    printf '[있음] %s\n' "${check[*]}"
  else
    run "${create[@]}"
  fi
}

command -v az >/dev/null || { echo "az 가 없다: brew install azure-cli"; exit 1; }
az account show >/dev/null 2>&1 || { echo "로그인이 필요하다: az login"; exit 1; }

ensure az group show --name "$RG" -- \
  az group create --name "$RG" --location "$LOCATION"

ensure az storage account show --name "$ST_ACCOUNT" -g "$RG" -- \
  az storage account create --name "$ST_ACCOUNT" -g "$RG" --location "$LOCATION" \
    --sku Standard_LRS --min-tls-version TLS1_2 --allow-blob-public-access false

ensure az storage container show --name "$ST_CONTAINER" --account-name "$ST_ACCOUNT" --auth-mode login -- \
  az storage container create --name "$ST_CONTAINER" --account-name "$ST_ACCOUNT" --auth-mode login

ensure az containerapp env show --name "$ACA_ENV" -g "$RG" -- \
  az containerapp env create --name "$ACA_ENV" -g "$RG" --location "$LOCATION"

# 첫 생성은 자리 표시 이미지다 — 실제 이미지는 containerapp update 로 넣는다(런북 1단계).
ensure az containerapp show --name "$ACA_APP" -g "$RG" -- \
  az containerapp create --name "$ACA_APP" -g "$RG" --environment "$ACA_ENV" \
    --image mcr.microsoft.com/k8se/quickstart:latest \
    --target-port 8787 --ingress external --min-replicas 0 --max-replicas 1

[ "$APPLY" = "1" ] || echo "DRY-RUN 이었다. 만들려면: APPLY=1 $0"
