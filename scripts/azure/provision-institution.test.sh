#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT/scripts/azure/provision-institution.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"

for name in az curl psql opsvc; do
  cat >"$TMP/bin/$name" <<'STUB'
#!/usr/bin/env bash
echo "FORBIDDEN_EXTERNAL_CALL: $(basename "$0")" >&2
exit 97
STUB
  chmod +x "$TMP/bin/$name"
done

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

invoke() {
  local url="$1"
  shift
  printf '%s\n' "$url" | env \
    PATH="$TMP/bin:$PATH" \
    OPSVC="$TMP/bin/opsvc" \
    RELAYER_PUBLIC_URL="https://test2.relayer.kr" \
    PGSCHEMA="test2" \
    bash "$SCRIPT" "$@" 2>&1
}

expect_rejected() {
  local url="$1" expected="$2" output
  if output="$(invoke "$url" test2)"; then
    fail "거절해야 할 DATABASE_URL을 허용함"
  fi
  [[ "$output" == *"$expected"* ]] || fail "예상 오류 없음: $expected"
  [[ "$output" != *"$url"* ]] || fail "거절 출력에 DATABASE_URL 노출"
  [[ "$output" != *"FORBIDDEN_EXTERNAL_CALL"* ]] || fail "거절 전에 외부 명령 호출"
}

expect_rejected \
  'postgresql://postgres.test2:leak-marker@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres' \
  '트랜잭션 풀러(6543)는 지원하지 않습니다. 세션 풀러(5432)를 쓰세요.'
expect_rejected \
  'postgresql://postgres:leak-marker@db.example.supabase.co:5432/postgres' \
  '직접 DB 주소는 IPv6 전용입니다. pooler.supabase.com 세션 풀러 주소를 쓰세요.'
expect_rejected \
  'postgresql://postgres:leak-marker@database.example.com:5432/postgres' \
  'DATABASE_URL은 pooler.supabase.com 세션 풀러만 허용합니다.'

secret_url='postgresql://postgres.test2:leak-marker%21@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres'
output="$(invoke "$secret_url" test2)" || fail "유효한 DRY-RUN 실패"

[[ "$output" != *"$secret_url"* ]] || fail "DRY-RUN 출력에 DATABASE_URL 노출"
[[ "$output" != *"leak-marker"* ]] || fail "DRY-RUN 출력에 DB 비밀번호 노출"
[[ "$output" != *"FORBIDDEN_EXTERNAL_CALL"* ]] || fail "DRY-RUN 중 외부 명령 호출"
[[ "$output" == *"DRY-RUN"* ]] || fail "DRY-RUN 표지 없음"
[[ "$output" == *"BLOB_ACCOUNT=relayer2test2"* ]] || fail "BLOB_ACCOUNT 계획 없음"
[[ "$output" == *"RELAYER_SLUG=test2"* ]] || fail "RELAYER_SLUG 계획 없음"
[[ "$output" == *"RELAYER_PUBLIC_URL=https://test2.relayer.kr"* ]] || fail "공개 URL 계획 없음"
[[ "$output" == *"PGSCHEMA=test2"* ]] || fail "별도 DB 스키마 계획 없음"
[[ "$output" != *"account key"* ]] || fail "Storage account key 사용 계획이 섞임"
[[ "$output" != *"connection string"* ]] || fail "Storage 연결 문자열 사용 계획이 섞임"

rest="$output"
for expected in \
  '1. DATABASE_URL 형식 검증' \
  '2. DATABASE_URL 연결 확인: select 1' \
  '3. Infisical prod:/RELAYER2/test2' \
  '4. resource group relayer2-prod' \
  '5. storage account relayer2test2' \
  '6. blob containers voice documents' \
  '7. Container App relayer2-test2' \
  '8. system managed identity' \
  '9. Storage Blob Data Contributor' \
  '10. node api/src/migrate.ts --check' \
  '11. GET /auth/signup open:true' \
  '12. Cloudflare DNS test2.relayer.kr: CNAME(프록시 없음) + TXT asuid.test2.relayer.kr' \
  '13. custom hostname test2.relayer.kr' \
  '가입 URL: https://test2.relayer.kr/#/signup'
do
  case "$rest" in
    *"$expected"*) rest="${rest#*"$expected"}" ;;
    *) fail "DRY-RUN 순서/항목 누락: $expected" ;;
  esac
done

# cloudflare_dns.py — 토큰·Cloudflare 를 가짜 서버로 바꿔 세 경우를 본다: 없음→생성, 같음→건너뜀, 다름→멈춤.
dns_out="$(python3 - "$ROOT" <<'PY'
import io, json, os, sys, types, urllib.request
sys.path.insert(0, sys.argv[1] + "/scripts")
os.environ["PROJECT_ID"] = "p1"
fake = types.ModuleType("infisical_get"); fake.API = "http://infisical.test"; fake.login = lambda: "t"
sys.modules["infisical_get"] = fake
import cloudflare_dns as m
records = []   # 가짜 zone 의 현재 레코드
calls = []
def opener(req, timeout=30):
    url, method = req.full_url, req.get_method(); calls.append(method)
    if "infisical" in url: body = {"secrets": [{"secretKey": "CLOUDFLARE_DNS_API_TOKEN", "secretValue": "cf-secret-marker"}]}
    elif "/zones?" in url: body = {"success": True, "result": [{"id": "z1"}]}
    elif method == "GET":
        q = dict(p.split("=") for p in url.split("?")[1].split("&"))
        body = {"success": True, "result": [r for r in records if r["type"] == q["type"] and r["name"] == q["name"]]}
    else:
        records.append(json.loads(req.data)); body = {"success": True, "result": {}}
    return io.BytesIO(json.dumps(body).encode())
urllib.request.urlopen = opener
sys.argv = ["x", "test2.relayer.kr", "app.example.azurecontainerapps.io", "ABC"]
out = io.StringIO(); sys.stdout = out
m.main(); m.main()                      # 1회: 생성 둘, 2회: 있음 둘
records[0]["content"] = "other.target"  # CNAME 이 다른 곳을 가리키면
try: m.main(); status = "덮음"
except SystemExit as e: status = str(e)
sys.stdout = sys.__stdout__
print(out.getvalue()); print("STATUS:", status)
print("PROXIED:", [r.get("proxied") for r in records if r["type"] == "CNAME"])
print("POSTS:", calls.count("POST"))
PY
)"
[[ "$dns_out" == *"생성: CNAME test2.relayer.kr"* && "$dns_out" == *"생성: TXT asuid.test2.relayer.kr"* ]] || fail "DNS 레코드 생성 없음"
[[ "$dns_out" == *"있음: CNAME test2.relayer.kr"* ]] || fail "같은 레코드를 건너뛰지 않음"
[[ "$dns_out" == *"STATUS: 오류: CNAME test2.relayer.kr 가 다른 값으로"* ]] || fail "다른 값의 레코드를 덮어씀"
[[ "$dns_out" == *"PROXIED: [False]"* ]] || fail "CNAME 이 프록시 없음이 아님"
[[ "$dns_out" == *"POSTS: 2"* ]] || fail "레코드 생성 횟수가 2가 아님"
[[ "$dns_out" != *"cf-secret-marker"* ]] || fail "DNS 출력에 토큰 노출"

printf 'PROVISION_OK\n'
