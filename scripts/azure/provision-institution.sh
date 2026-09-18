#!/usr/bin/env bash
# 기관별 Azure 자원을 준비한다. 기본은 DRY-RUN이며 APPLY=1일 때만 외부 시스템을 바꾼다.
# DATABASE_URL은 표준입력에서만 받고 화면·argv·로그에 출력하지 않는다.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
umask 077

APPLY="${APPLY:-0}"
RG="${AZURE_RESOURCE_GROUP:-relayer2-prod}"
LOCATION="${AZURE_LOCATION:-koreacentral}"
ACA_ENV="${AZURE_CONTAINERAPPS_ENV:-relayer2-env}"
IMAGE="${RELAYER_IMAGE:-ghcr.io/socialsolidaritybank/relayer:0.2.1}"
INFISICAL_PROJECT_ID="${INFISICAL_PROJECT_ID:-a7c44b37-a885-4c62-98cd-cbc8a9810de9}"
OPSVC="${OPSVC:-$HOME/.dotfiles/scripts/opsvc}"

fail() {
  printf '오류: %s\n' "$*" >&2
  exit 1
}

[ "$#" -eq 1 ] || fail "사용법: $0 <slug>"
slug="$1"
[[ "$slug" =~ ^[a-z0-9][a-z0-9-]*[a-z0-9]$ ]] || fail "slug는 소문자 영문·숫자·하이픈만 허용합니다."
[[ "$slug" != *--* ]] || fail "slug에는 연속 하이픈을 쓸 수 없습니다."

storage_slug="${slug//-/}"
storage_account="relayer2${storage_slug}"
app_name="relayer2-${slug}"
[ "${#storage_account}" -le 24 ] || fail "slug가 너무 깁니다. storage account 이름은 24자 이하여야 합니다."
[ "${#app_name}" -lt 32 ] || fail "slug가 너무 깁니다. Container App 이름은 32자 미만이어야 합니다."

public_url="${RELAYER_PUBLIC_URL:-https://${slug}.relayer.kr}"
[[ "$public_url" =~ ^https://[^/[:space:]]+/?$ ]] || fail "RELAYER_PUBLIC_URL은 경로 없는 https URL이어야 합니다."
public_url="${public_url%/}"
public_host="${public_url#https://}"
[[ "$public_host" == *.*.* ]] || fail "RELAYER_PUBLIC_URL 은 <이름>.<zone> 꼴의 하위 도메인이어야 합니다(DNS 는 zone 안에 만든다)."
pgschema="${PGSCHEMA:-}"
if [ -n "$pgschema" ]; then
  [[ "$pgschema" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || fail "PGSCHEMA는 PostgreSQL 식별자 형식이어야 합니다."
fi
secret_path="/RELAYER2/${slug}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
chmod 700 "$TMP"
db_file="$TMP/database-url"

if [ -t 0 ]; then
  IFS= read -r -s -p 'DATABASE_URL: ' database_url || fail "DATABASE_URL을 읽지 못했습니다."
  printf '\n' >&2
else
  IFS= read -r database_url || fail "DATABASE_URL을 표준입력으로 전달하세요."
fi
[ -n "$database_url" ] || fail "DATABASE_URL이 비었습니다."
printf '%s\n' "$database_url" >"$db_file"
chmod 600 "$db_file"
unset database_url

python3 - "$db_file" <<'PY'
import sys
from urllib.parse import urlsplit

raw = open(sys.argv[1], encoding="utf-8").read().strip()
try:
    parsed = urlsplit(raw)
    port = parsed.port
except ValueError:
    raise SystemExit("오류: DATABASE_URL을 해석할 수 없습니다. 비밀번호의 @, :, /는 URL 인코딩하세요.")

host = (parsed.hostname or "").lower()
if parsed.scheme not in {"postgres", "postgresql"} or not parsed.username or parsed.password is None or not parsed.path.strip("/"):
    raise SystemExit("오류: DATABASE_URL은 사용자·비밀번호·호스트·데이터베이스를 모두 포함해야 합니다.")
if port == 6543:
    raise SystemExit("오류: 트랜잭션 풀러(6543)는 지원하지 않습니다. 세션 풀러(5432)를 쓰세요.")
if host.startswith("db.") and host.endswith(".supabase.co"):
    raise SystemExit("오류: 직접 DB 주소는 IPv6 전용입니다. pooler.supabase.com 세션 풀러 주소를 쓰세요.")
if host != "pooler.supabase.com" and not host.endswith(".pooler.supabase.com"):
    raise SystemExit("오류: DATABASE_URL은 pooler.supabase.com 세션 풀러만 허용합니다.")
if port != 5432:
    raise SystemExit("오류: DATABASE_URL 포트는 세션 풀러 5432여야 합니다.")
PY

schema_plan=""
if [ -n "$pgschema" ]; then
  schema_plan="   PGSCHEMA=${pgschema}"
fi
if [ "$APPLY" != "1" ]; then
  cat <<EOF
DRY-RUN — 외부 시스템을 호출하거나 변경하지 않았습니다.
1. DATABASE_URL 형식 검증: pooler.supabase.com:5432
2. DATABASE_URL 연결 확인: select 1
3. Infisical prod:${secret_path}: 부모→자식 폴더 생성, 기존 DATABASE_URL PII_ENC_KEY SESSION_SECRET 건너뜀
4. resource group ${RG}: 기존 자원 재사용
5. storage account ${storage_account}: public blob 차단, TLS 1.2, 계정 키 접근 끔
6. blob containers voice documents: private
7. Container App ${app_name}: ${ACA_ENV}, ${IMAGE}, ingress 8787, min 0/max 1
   BLOB_ACCOUNT=${storage_account}
   RELAYER_SLUG=${slug}
   RELAYER_PUBLIC_URL=${public_url}
${schema_plan}
8. system managed identity: ${app_name}
9. Storage Blob Data Contributor: ${storage_account} scope
10. node api/src/migrate.ts --check
11. GET /auth/signup open:true
12. Cloudflare DNS ${public_host}: CNAME(프록시 없음) + TXT asuid.${public_host}
13. custom hostname ${public_host}: 관리형 인증서(CNAME 검증), GET ${public_url}/health
가입 URL: ${public_url}/#/signup
APPLY=1일 때만 위 계획을 실행합니다. DNS 토큰은 Infisical prod:/ CLOUDFLARE_DNS_API_TOKEN 이다.
EOF
  exit 0
fi

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 명령이 필요합니다."
}
for command_name in az curl psql python3; do
  require_command "$command_name"
done
[ -x "$OPSVC" ] || fail "opsvc가 없습니다: $OPSVC"
az account show >/dev/null 2>&1 || fail "Azure 서비스 프린시펄 로그인이 필요합니다."

printf '1. DATABASE_URL 형식 검증 완료\n'
printf '2. DATABASE_URL 연결 확인: select 1\n'
if ! python3 - "$db_file" <<'PY'
import os
import subprocess
import sys
from urllib.parse import unquote, urlsplit

parsed = urlsplit(open(sys.argv[1], encoding="utf-8").read().strip())
env = os.environ.copy()
env.update(
    PGHOST=parsed.hostname or "",
    PGPORT=str(parsed.port),
    PGUSER=unquote(parsed.username or ""),
    PGPASSWORD=unquote(parsed.password or ""),
    PGDATABASE=unquote(parsed.path.lstrip("/")),
    PGSSLMODE="require",
    PGCONNECT_TIMEOUT="10",
    PGAPPNAME="relayer2-provision",
)
result = subprocess.run(
    ["psql", "--no-psqlrc", "--set=ON_ERROR_STOP=1", "--command", "select 1"],
    env=env,
    stdin=subprocess.DEVNULL,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
    timeout=20,
    check=False,
)
raise SystemExit(result.returncode)
PY
then
  fail "DATABASE_URL 연결 확인에 실패했습니다. 세션 풀러 주소·비밀번호·네트워크를 확인하세요."
fi

seed_env="$TMP/generated.env"
python3 - "$db_file" "$seed_env" <<'PY'
import base64
import os
import pathlib
import secrets
import sys

url = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").strip()
out = pathlib.Path(sys.argv[2])
out.write_text(
    "DATABASE_URL=" + url + "\n"
    + "PII_ENC_KEY=" + base64.b64encode(secrets.token_bytes(32)).decode() + "\n"
    + "SESSION_SECRET=" + secrets.token_hex(32) + "\n",
    encoding="utf-8",
)
os.chmod(out, 0o600)
PY

# 항목은 ID 로 가리킨다. 제목의 `·` 는 op:// 참조에서 허용되지 않는 문자다(2026-09-18 실측: invalid character).
op_refs="$TMP/infisical-op.env"
cat >"$op_refs" <<'EOF'
CLIENT_ID=op://BSS/l34nxgvhlqrca67cikcdpetsfe/ggbss_client_ID
CLIENT_SECRET=op://BSS/l34nxgvhlqrca67cikcdpetsfe/ggbss_client_secret
EOF
chmod 600 "$op_refs"

printf '3. Infisical prod:%s\n' "$secret_path"
OP_BIOMETRIC_UNLOCK_ENABLED=false "$OPSVC" run --env-file="$op_refs" -- \
  env ENV_FILE="$seed_env" PROJECT_ID="$INFISICAL_PROJECT_ID" SECRET_PATH="$secret_path" \
  python3 scripts/infisical_put.py --skip-if-exists

app_env_dir="$TMP/app-env"
mkdir -m 700 "$app_env_dir"
(
  cd "$app_env_dir"
  OP_BIOMETRIC_UNLOCK_ENABLED=false "$OPSVC" run --env-file="$op_refs" -- \
    env PROJECT_ID="$INFISICAL_PROJECT_ID" PORT=8787 \
    python3 "$ROOT/scripts/infisical_get.py" "$secret_path"
)
app_env="$app_env_dir/.env"
python3 - "$app_env" <<'PY' || fail "Infisical .env 권한은 0600이어야 합니다."
import os
import stat
import sys

path = sys.argv[1]
raise SystemExit(0 if os.path.isfile(path) and stat.S_IMODE(os.stat(path).st_mode) == 0o600 else 1)
PY

ensure() {
  local label="$1"
  shift
  local check=() create=() seen=0 argument
  for argument in "$@"; do
    if [ "$argument" = "--" ]; then
      seen=1
      continue
    fi
    if [ "$seen" = 0 ]; then check+=("$argument"); else create+=("$argument"); fi
  done
  if "${check[@]}" >/dev/null 2>&1; then
    printf '  있음: %s\n' "$label"
  else
    "${create[@]}" >/dev/null
    printf '  생성: %s\n' "$label"
  fi
}

printf '4. resource group %s\n' "$RG"
ensure "$RG" az group show --name "$RG" -- \
  az group create --name "$RG" --location "$LOCATION" --output none
ensure "$ACA_ENV" az containerapp env show --name "$ACA_ENV" --resource-group "$RG" -- \
  az containerapp env create --name "$ACA_ENV" --resource-group "$RG" --location "$LOCATION" --output none

printf '5. storage account %s\n' "$storage_account"
ensure "$storage_account" az storage account show --name "$storage_account" --resource-group "$RG" -- \
  az storage account create --name "$storage_account" --resource-group "$RG" --location "$LOCATION" \
    --sku Standard_LRS --kind StorageV2 --min-tls-version TLS1_2 --https-only true \
    --allow-blob-public-access false --allow-shared-key-access false --output none
# 계정 키(뒷문)는 잠근다 — 앱은 관리 ID(정문)만 쓴다. 이미 있던 계정도 같은 상태로 맞춘다.
az storage account update --name "$storage_account" --resource-group "$RG" \
  --allow-shared-key-access false --output none

printf '6. blob containers voice documents\n'
for container in voice documents; do
  ensure "$storage_account/$container" \
    az storage container-rm show --storage-account "$storage_account" --name "$container" --resource-group "$RG" -- \
    az storage container-rm create --storage-account "$storage_account" --name "$container" \
      --resource-group "$RG" --public-access off --output none
done

environment_id="$(az containerapp env show --name "$ACA_ENV" --resource-group "$RG" --query id --output tsv)"
app_config="$TMP/containerapp.yaml"
APP_NAME="$app_name" APP_ENV_ID="$environment_id" APP_IMAGE="$IMAGE" APP_ENV_FILE="$app_env" \
BLOB_ACCOUNT="$storage_account" RELAYER_SLUG="$slug" RELAYER_PUBLIC_URL="$public_url" PGSCHEMA="$pgschema" \
python3 - "$app_config" <<'PY'
import json
import os
import pathlib
import re
import sys

values = {}
for raw in pathlib.Path(os.environ["APP_ENV_FILE"]).read_text(encoding="utf-8").splitlines():
    if raw and "=" in raw:
        name, value = raw.split("=", 1)
        values[name] = value

secrets = []
env = []
for name, value in values.items():
    if name == "PORT":
        continue
    secret_name = re.sub(r"[^a-z0-9-]", "-", name.lower().replace("_", "-"))
    secrets.append({"name": secret_name, "value": value})
    env.append({"name": name, "secretRef": secret_name})

env.extend(
    [
        {"name": "BLOB_ACCOUNT", "value": os.environ["BLOB_ACCOUNT"]},
        {"name": "RELAYER_SLUG", "value": os.environ["RELAYER_SLUG"]},
        {"name": "RELAYER_PUBLIC_URL", "value": os.environ["RELAYER_PUBLIC_URL"]},
        {"name": "PORT", "value": "8787"},
    ]
)
if os.environ.get("PGSCHEMA"):
    env.append({"name": "PGSCHEMA", "value": os.environ["PGSCHEMA"]})

config = {
    "identity": {"type": "SystemAssigned"},
    "properties": {
        "environmentId": os.environ["APP_ENV_ID"],
        "configuration": {
            "activeRevisionsMode": "Single",
            "ingress": {"external": True, "allowInsecure": False, "targetPort": 8787},
            "secrets": secrets,
        },
        "template": {
            "containers": [
                {
                    "name": os.environ["APP_NAME"],
                    "image": os.environ["APP_IMAGE"],
                    "resources": {"cpu": 0.25, "memory": "0.5Gi"},
                    "env": env,
                }
            ],
            "scale": {"minReplicas": 0, "maxReplicas": 1},
        },
    },
}
path = pathlib.Path(sys.argv[1])
path.write_text(json.dumps(config), encoding="utf-8")
os.chmod(path, 0o600)
PY

printf '7. Container App %s\n' "$app_name"
ensure "$app_name" az containerapp show --name "$app_name" --resource-group "$RG" -- \
  az containerapp create --name "$app_name" --resource-group "$RG" --environment "$ACA_ENV" \
    --yaml "$app_config" --output none

printf '8. system managed identity: %s\n' "$app_name"
principal_id="$(az containerapp show --name "$app_name" --resource-group "$RG" --query identity.principalId --output tsv)"
[ -n "$principal_id" ] || fail "Container App system managed identity를 확인하지 못했습니다."
storage_scope="$(az storage account show --name "$storage_account" --resource-group "$RG" --query id --output tsv)"

printf '9. Storage Blob Data Contributor: %s scope\n' "$storage_account"
role_count="$(az role assignment list --assignee-object-id "$principal_id" \
  --role 'Storage Blob Data Contributor' --scope "$storage_scope" \
  --fill-principal-name false --query 'length(@)' --output tsv)"
if [ "$role_count" = "0" ]; then
  az role assignment create --assignee-object-id "$principal_id" --assignee-principal-type ServicePrincipal \
    --role 'Storage Blob Data Contributor' --scope "$storage_scope" --output none
  printf '  역할 생성\n'
else
  printf '  역할 있음\n'
fi

fqdn="$(az containerapp show --name "$app_name" --resource-group "$RG" --query properties.configuration.ingress.fqdn --output tsv)"
[ -n "$fqdn" ] || fail "Container App FQDN을 확인하지 못했습니다."
curl -fsS --retry 12 --retry-delay 5 --retry-all-errors "https://${fqdn}/health" >/dev/null

printf '10. node api/src/migrate.ts --check\n'
# `az containerapp exec` 는 TTY 가 없으면 termios 오류로 죽는다(2026-09-18 실측). 파이프로
# 돌릴 때는 `script` 로 가짜 TTY 를 준다. 출력에서 "migrations up to date" 를 직접 확인한다.
exec_out="$TMP/migrate-check.log"
if [ -t 0 ]; then
  az containerapp exec --name "$app_name" --resource-group "$RG" \
    --command 'node api/src/migrate.ts --check' | tee "$exec_out"
else
  script -q "$exec_out" az containerapp exec --name "$app_name" --resource-group "$RG" \
    --command 'node api/src/migrate.ts --check' </dev/null >/dev/null
fi
grep -q 'migrations up to date' "$exec_out" || fail "migrate --check 가 'migrations up to date' 를 내지 않았습니다."

printf '11. GET /auth/signup open:true\n'
curl -fsS --retry 5 --retry-delay 2 --retry-all-errors "https://${fqdn}/auth/signup" | \
  python3 -c 'import json,sys; raise SystemExit(0 if json.load(sys.stdin).get("open") is True else 1)' || \
  fail "/auth/signup이 open:true가 아닙니다."

printf '12. Cloudflare DNS %s\n' "$public_host"
verification_id="$(az containerapp show --name "$app_name" --resource-group "$RG" \
  --query properties.customDomainVerificationId --output tsv)"
[ -n "$verification_id" ] || fail "customDomainVerificationId 를 확인하지 못했습니다."
OP_BIOMETRIC_UNLOCK_ENABLED=false "$OPSVC" run --env-file="$op_refs" -- \
  env PROJECT_ID="$INFISICAL_PROJECT_ID" PYTHONPATH=scripts \
  python3 scripts/cloudflare_dns.py "$public_host" "$fqdn" "$verification_id"

printf '13. custom hostname %s\n' "$public_host"
bound="$(az containerapp hostname list --name "$app_name" --resource-group "$RG" \
  --query "[?name=='${public_host}'] | length(@)" --output tsv)"
if [ "$bound" = "0" ]; then
  # 방금 만든 TXT 를 Azure 가 아직 못 볼 수 있다(2026-09-18 실측: InvalidCustomHostNameValidation).
  # 전파는 보통 1~2분이라 20초 간격으로 최대 5분 기다린다.
  added=0
  for attempt in $(seq 1 15); do
    if az containerapp hostname add --name "$app_name" --resource-group "$RG" --hostname "$public_host" \
         --output none 2>"$TMP/hostname-add.err"; then
      added=1
      break
    fi
    grep -q 'InvalidCustomHostNameValidation' "$TMP/hostname-add.err" || { cat "$TMP/hostname-add.err" >&2; fail "hostname add 실패"; }
    printf '  DNS 전파 대기 (%s/15)\n' "$attempt"
    sleep 20
  done
  [ "$added" = 1 ] || fail "asuid.${public_host} TXT 가 5분 안에 보이지 않았습니다."
  # 관리형 인증서 발급은 DNS 전파 뒤 수 분 걸린다. bind 가 끝까지 기다린다.
  az containerapp hostname bind --name "$app_name" --resource-group "$RG" --hostname "$public_host" \
    --environment "$ACA_ENV" --validation-method CNAME --output none
  printf '  생성: %s (관리형 인증서)\n' "$public_host"
else
  printf '  있음: %s\n' "$public_host"
fi
curl -fsS --retry 12 --retry-delay 10 --retry-all-errors "${public_url}/health" >/dev/null || \
  fail "${public_url}/health 응답 없음 — DNS 전파나 인증서 상태를 확인하세요."
printf '가입 URL: %s/#/signup\n' "$public_url"
