#!/usr/bin/env bash
# 릴레이어 전용 Supabase 프로젝트를 만든다(2026-09-15).
#
# 왜 전용인가: 기존 `Relayer` 프로젝트에는 CCC 스키마가 이미 있어 `audit_log`·`consent_events`
# 이름이 겹친다. 한 DB 를 나눠 쓰면 마이그레이션·백업·권한이 서로 걸린다.
#
# 비밀번호는 이 스크립트 안에서 만들어 파일로만 내보낸다. 화면에도 argv 에도 남기지 않는다.
# 출력은 프로젝트 ref 와 상태뿐이다.
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077

ORG_ID="${ORG_ID:-ucsgfwgvdfuwmysfqnmp}"
REGION="${REGION:-ap-northeast-2}"
NAME="${1:-relayer2}"
PW_OUT="${2:-./.supabase-dbpw}"

PW_OUT="$PW_OUT" ORG_ID="$ORG_ID" REGION="$REGION" NAME="$NAME" python3 - <<'PY'
import json, os, secrets, string, subprocess, urllib.error, urllib.request

API = "https://api.supabase.com/v1"

token = subprocess.run(
    ["security", "find-generic-password", "-s", "Supabase CLI", "-w"],
    capture_output=True, text=True, check=True,
).stdout.strip()
if not token:
    raise SystemExit("Supabase CLI 토큰을 찾지 못했다")

# 접속 주소에 넣어도 탈 나지 않는 글자만 쓴다.
alphabet = string.ascii_letters + string.digits
password = "".join(secrets.choice(alphabet) for _ in range(32))

body = {
    "name": os.environ["NAME"],
    "organization_id": os.environ["ORG_ID"],
    "region": os.environ["REGION"],
    "db_pass": password,
}
req = urllib.request.Request(
    f"{API}/projects",
    data=json.dumps(body).encode(),
    headers={"authorization": f"Bearer {token}", "content-type": "application/json"},
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=60) as res:
        created = json.loads(res.read())
except urllib.error.HTTPError as e:
    raise SystemExit(f"생성 실패 HTTP {e.code}: {e.read().decode()[:200]}")

with open(os.environ["PW_OUT"], "w") as f:
    os.chmod(os.environ["PW_OUT"], 0o600)
    f.write(password)

print(f"  ref={created['id']} region={created.get('region')} status={created.get('status')}")
print(f"  비밀번호 파일: {os.environ['PW_OUT']}")
PY
