#!/usr/bin/env bash
# Azure 자원 준비(docs/azure-migration.md). 기본은 DRY-RUN이며 Azure를 변경하지 않는다.
# 플래너가 명시적으로 GO 한 뒤에만 두 게이트를 함께 연다:
#   APPLY=1 PLANNER_GO=GO ./scripts/azure/provision.sh
#
# 앱 시크릿은 이 파일에서 다루지 않는다. Infisical prod:/RELAYER2에서 별도로 주입한다.
set -euo pipefail

RG=relayer2-prod
LOCATION=koreacentral
ACA_ENV=relayer2-env
ACA_APP=relayer2
LOG_WORKSPACE=relayer2-logs
ST_ACCOUNT=relayer2voice
ST_CONTAINERS=(voice documents)
PLACEHOLDER_IMAGE=mcr.microsoft.com/dotnet/samples:aspnetapp
IMAGE="${IMAGE:-$PLACEHOLDER_IMAGE}"
APP_ENV=(PORT=8787 STORAGE_BACKEND=blob AZURE_STORAGE_ACCOUNT="$ST_ACCOUNT")
if [ "$IMAGE" = "$PLACEHOLDER_IMAGE" ]; then
  APP_ENV+=(ASPNETCORE_HTTP_PORTS=8787)
fi

APPLY="${APPLY:-0}"
PLANNER_GO="${PLANNER_GO:-}"

case "$APPLY" in
  0|1) ;;
  *) echo "APPLY는 0 또는 1이어야 한다" >&2; exit 2 ;;
esac
if [ "$APPLY" = "1" ] && [ "$PLANNER_GO" != "GO" ]; then
  echo "생성 차단: 플래너 GO 뒤 APPLY=1 PLANNER_GO=GO를 함께 지정한다" >&2
  exit 2
fi

run() {
  if [ "$APPLY" = "1" ]; then
    "$@"
    return
  fi
  printf '[dry-run]'
  printf ' %q' "$@"
  printf '\n'
}

# 이미 있으면 건너뛴다. 확인 명령과 생성 명령은 `--`로 나눈다.
ensure() {
  local check=() create=() seen=0
  for arg in "$@"; do
    if [ "$arg" = "--" ]; then seen=1; continue; fi
    if [ "$seen" = "0" ]; then check+=("$arg"); else create+=("$arg"); fi
  done
  if [ "$APPLY" = "1" ] && "${check[@]}" >/dev/null 2>&1; then
    printf '[있음] %s\n' "${check[*]}"
    return
  fi
  run "${create[@]}"
}

command -v az >/dev/null || { echo "az가 없다: brew install azure-cli" >&2; exit 1; }
ACCOUNT_TYPE="$(az account show --query user.type --output tsv 2>/dev/null)" || {
  echo "Azure SP 로그인이 필요하다: ./scripts/pull-secrets.sh && ./scripts/azure/login.py" >&2
  exit 1
}
if [ "$ACCOUNT_TYPE" != "servicePrincipal" ]; then
  echo "생성 차단: Azure 계정 type이 servicePrincipal이어야 한다" >&2
  exit 2
fi
unset ACCOUNT_TYPE


ensure az group show --name "$RG" -- \
  az group create --name "$RG" --location "$LOCATION" --output none --only-show-errors

ensure az monitor log-analytics workspace show --resource-group "$RG" --workspace-name "$LOG_WORKSPACE" -- \
  az monitor log-analytics workspace create \
    --resource-group "$RG" --workspace-name "$LOG_WORKSPACE" --location "$LOCATION" \
    --sku PerGB2018 --retention-time 30 --output none --only-show-errors

ensure az storage account show --name "$ST_ACCOUNT" --resource-group "$RG" -- \
  az storage account create \
    --name "$ST_ACCOUNT" --resource-group "$RG" --location "$LOCATION" \
    --kind StorageV2 --sku Standard_LRS --access-tier Hot \
    --min-tls-version TLS1_2 --https-only true \
    --allow-blob-public-access false --allow-cross-tenant-replication false \
    --public-network-access Enabled --output none --only-show-errors

for container in "${ST_CONTAINERS[@]}"; do
  ensure az storage container-rm show --name "$container" --storage-account "$ST_ACCOUNT" --resource-group "$RG" -- \
    az storage container-rm create \
      --name "$container" --storage-account "$ST_ACCOUNT" --resource-group "$RG" \
      --public-access off --output none --only-show-errors
done

if [ "$APPLY" = "1" ]; then
  LOG_WORKSPACE_ID="$(
    az monitor log-analytics workspace show \
      --resource-group "$RG" --workspace-name "$LOG_WORKSPACE" \
      --query customerId --output tsv
  )"
  LOG_WORKSPACE_KEY="$(
    az monitor log-analytics workspace get-shared-keys \
      --resource-group "$RG" --workspace-name "$LOG_WORKSPACE" \
      --query primarySharedKey --output tsv
  )"
else
  LOG_WORKSPACE_ID="<relayer2-logs-customer-id>"
  LOG_WORKSPACE_KEY="<relayer2-logs-primary-key>"
fi

ensure az containerapp env show --name "$ACA_ENV" --resource-group "$RG" -- \
  az containerapp env create \
    --name "$ACA_ENV" --resource-group "$RG" --location "$LOCATION" \
    --enable-workload-profiles false \
    --logs-destination log-analytics --logs-workspace-id "$LOG_WORKSPACE_ID" \
    --logs-workspace-key "$LOG_WORKSPACE_KEY" --output none --only-show-errors
unset LOG_WORKSPACE_ID LOG_WORKSPACE_KEY

ensure az containerapp show --name "$ACA_APP" --resource-group "$RG" -- \
  az containerapp create \
    --name "$ACA_APP" --resource-group "$RG" --environment "$ACA_ENV" \
    --image "$IMAGE" --revisions-mode single \
    --target-port 8787 --ingress external --transport auto \
    --cpu 0.25 --memory 0.5Gi --min-replicas 1 --max-replicas 1 \
    --env-vars "${APP_ENV[@]}" --output none --only-show-errors

if [ "$APPLY" = "0" ]; then
  echo "DRY-RUN: Azure 변경 없음."
  echo "실제 생성은 플래너 GO 뒤에만: APPLY=1 PLANNER_GO=GO $0"
fi
