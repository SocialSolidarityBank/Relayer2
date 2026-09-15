#!/usr/bin/env bash
# 로테이션 왓쳐. 다른 세션이 Infisical 시크릿을 교체·이동하는 동안,
# **릴레이어2가 읽는 자리**가 언제 어떻게 바뀌는지 지켜본다.
#
# 값은 절대 읽지도 찍지도 않는다. 보는 것은 셋뿐이다.
#   ① 우리 폴더(ggbss-agent · prod · /RELAYER2)의 **이름 목록**
#   ② 각 이름의 **지문**(값의 sha256 앞 8자) — 값이 바뀌었는지만 안다
#   ③ 인계 메모 파일의 등장
#
# 지문은 값이 아니다. 되돌릴 수 없고, 같은지 다른지만 말해 준다.
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT_ID="a7c44b37-a885-4c62-98cd-cbc8a9810de9"   # ggbss-agent
SECRET_PATH="/RELAYER2"
NOTE_DIR="$HOME/DEVELOPER/PROJECTS/CCC-new/.worktrees/beta-0.9-orchestrator/artifacts/orchestration"
STATE="${TMPDIR:-/tmp}/relayer-rotation-state.txt"
INTERVAL="${INTERVAL:-60}"
ROUNDS="${ROUNDS:-60}"

opsvc=~/.dotfiles/scripts/opsvc
field() { OP_BIOMETRIC_UNLOCK_ENABLED=false "$opsvc" item get 'Infisical · account@ggbss.or.kr' \
  --vault BSS --fields "label=$1" --reveal; }

snapshot() {
  CLIENT_ID="$(field ggbss_client_ID)" CLIENT_SECRET="$(field ggbss_client_secret)" \
  PROJECT_ID="$PROJECT_ID" SECRET_PATH="$SECRET_PATH" python3 - <<'PY'
import hashlib, json, os, urllib.parse, urllib.request

API = "https://app.infisical.com/api"
req = urllib.request.Request(
    f"{API}/v1/auth/universal-auth/login",
    data=json.dumps({"clientId": os.environ["CLIENT_ID"],
                     "clientSecret": os.environ["CLIENT_SECRET"]}).encode(),
    headers={"content-type": "application/json"}, method="POST")
token = json.loads(urllib.request.urlopen(req, timeout=30).read())["accessToken"]

q = urllib.parse.urlencode({"workspaceId": os.environ["PROJECT_ID"],
                            "environment": "prod", "secretPath": os.environ["SECRET_PATH"]})
res = urllib.request.urlopen(
    urllib.request.Request(f"{API}/v3/secrets/raw?{q}",
                           headers={"authorization": f"Bearer {token}"}), timeout=30)

# 값은 여기서만 메모리에 잠깐 있고, 밖으로는 **지문만** 나간다.
for s in sorted(json.loads(res.read()).get("secrets", []), key=lambda x: x["secretKey"]):
    fp = hashlib.sha256(s["secretValue"].encode()).hexdigest()[:8]
    print(f'{s["secretKey"]} {fp}')
PY
}

echo "왓쳐 시작 — $INTERVAL 초마다, 최대 $ROUNDS 회 (약 $((INTERVAL*ROUNDS/60))분)"
echo "보는 곳: ggbss-agent · prod · $SECRET_PATH"
[ -f "$STATE" ] || snapshot > "$STATE"
echo "현재 이름: $(cut -d' ' -f1 "$STATE" | tr '\n' ' ')"

for i in $(seq 1 "$ROUNDS"); do
  sleep "$INTERVAL"
  now="$(snapshot)" || { echo "[$i] 읽기 실패 — 권한이 바뀌었을 수 있다"; continue; }
  if [ "$now" != "$(cat "$STATE")" ]; then
    echo
    echo "=== 바뀌었다 ($(date '+%H:%M:%S'))"
    diff <(cat "$STATE") <(echo "$now") | sed 's/^/    /' || true
    echo "$now" > "$STATE"
  fi
  # 인계 메모가 생기면 알린다
  for f in "$NOTE_DIR"/rotation-breakage-notice.*; do
    [ -e "$f" ] || continue
    echo "=== 인계 메모 도착: $f"
  done
done
echo "왓쳐 종료."
