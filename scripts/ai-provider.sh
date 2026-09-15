#!/usr/bin/env bash
# AI 제공자를 확인하거나 바꾼다.
#
#   ./scripts/ai-provider.sh            지금 상태 점검
#   ./scripts/ai-provider.sh openai     openai 로 바꾼다
#   ./scripts/ai-provider.sh gemini     gemini 로 바꾼다
#
# 값은 출력하지 않는다. 유효성은 HTTP 상태코드로만 본다.
# 자격은 Machine Identity **`ggbss-agent`** (universal-auth) 하나만 쓴다.
# `ggbss_project_access_token` 은 서비스 토큰이라 루트 `/` 밖을 못 읽으므로 쓰지 않는다.
#
# **제공자를 바꾸면 외부 LLM 동의를 다시 받아야 한다.** 수신자가 동의 문안 해시에 묶여 있어서,
# 바뀌는 순간 기존 동의가 `확인 필요`로 떨어지고 초안 요청이 409 로 막힌다. 그게 맞는 동작이다.
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT_ID="a7c44b37-a885-4c62-98cd-cbc8a9810de9"   # ggbss-agent
SECRET_PATH="/RELAYER2"

opsvc=~/.dotfiles/scripts/opsvc
field() { OP_BIOMETRIC_UNLOCK_ENABLED=false "$opsvc" item get 'Infisical · account@ggbss.or.kr' \
  --vault BSS --fields "label=$1" --reveal; }

# Infisical 에서 값을 받아 파이썬 안에서 일을 끝낸다.
# 키는 HTTP 헤더로만 나간다 — argv 에 싣거나 자식 프로세스 환경에 통째로 넘기지 않는다.
# 인자로 받는 것은 부속 명령 이름뿐이다(값이 아니다).
with_secrets() {
  CLIENT_ID="$(field ggbss_client_ID)" CLIENT_SECRET="$(field ggbss_client_secret)" \
  PROJECT_ID="$PROJECT_ID" SECRET_PATH="$SECRET_PATH" python3 - "$@" <<'PY'
import json, os, sys, urllib.error, urllib.parse, urllib.request

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
got = {s["secretKey"]: s["secretValue"] for s in json.loads(res.read()).get("secrets", [])}

# 제공자별 Infisical 쪽 키 이름과 유효성 확인 URL·헤더.
PROBE = {
    "openai": ("RELAYER_OPENAI_API_KEY", "https://api.openai.com/v1/models",
               lambda k: {"authorization": f"Bearer {k}"}),
    "gemini": ("GEMINI_API_KEY", "https://generativelanguage.googleapis.com/v1beta/models",
               lambda k: {"x-goog-api-key": k}),
}

def probe(provider):
    name, url, headers = PROBE[provider]
    key = got.get(name, "")
    if not key:
        print("키없음")
        return
    try:
        urllib.request.urlopen(urllib.request.Request(url, headers=headers(key)), timeout=15)
        print(200)
    except urllib.error.HTTPError as e:
        print(e.code)          # 401·404 같은 응답도 상태코드로 돌려준다
    except urllib.error.URLError:
        print("연결안됨")

cmd = sys.argv[1]
if cmd == "probe":
    probe(sys.argv[2])
elif cmd == "line":
    # .env 에 넣을 `이름=값` 한 줄을 stdout 으로 낸다. 셸을 거치지 않는다.
    print(f"{sys.argv[2]}={got.get(sys.argv[3], '')}")
PY
}

current() { grep -E '^AI_PROVIDER=' .env 2>/dev/null | cut -d= -f2 || echo openai; }

if [ $# -eq 0 ]; then
  echo "지금 제공자: $(current)   (Infisical: ggbss-agent · prod · $SECRET_PATH)"
  for p in openai gemini; do
    printf '  %-7s ' "$p"
    with_secrets probe "$p"
    echo
  done
  exit 0
fi

target="$1"
case "$target" in openai|gemini) ;; *) echo "openai 또는 gemini 만 됩니다." >&2; exit 2;; esac

code="$(with_secrets probe "$target")"
[ "$code" = "200" ] || { echo "$target 키가 쓸 수 없습니다 (HTTP $code). 바꾸지 않았어요." >&2; exit 1; }

src=$([ "$target" = openai ] && echo RELAYER_OPENAI_API_KEY || echo GEMINI_API_KEY)
dst=$([ "$target" = openai ] && echo OPENAI_API_KEY || echo GEMINI_API_KEY)

tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
grep -v -E "^(AI_PROVIDER|AI_MODEL|OPENAI_API_KEY|GEMINI_API_KEY)=" .env > "$tmp" || true
with_secrets line "$dst" "$src" >> "$tmp"
printf 'AI_PROVIDER=%s\n' "$target" >> "$tmp"
mv "$tmp" .env; chmod 600 .env

echo "제공자를 $target 로 바꿨습니다 (HTTP 200)."
echo
echo "남은 것:"
echo "  1. API 다시 띄우기"
echo "  2. **외부 LLM·국외 처리 동의를 다시 받기** — 수신자가 바뀌어 기존 동의는 '확인 필요'입니다."
echo "     받기 전에는 초안 요청이 409 로 막힙니다. 막히는 게 정상입니다."
