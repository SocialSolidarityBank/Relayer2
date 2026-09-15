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

# 시크릿을 환경변수로 주입해 명령을 실행한다. 값은 argv 에 싣지 않는다.
with_secrets() {
  CLIENT_ID="$(field ggbss_client_ID)" CLIENT_SECRET="$(field ggbss_client_secret)" \
  PROJECT_ID="$PROJECT_ID" SECRET_PATH="$SECRET_PATH" python3 - "$@" <<'PY'
import json, os, subprocess, sys, urllib.parse, urllib.request

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

env = dict(os.environ)
env.pop("CLIENT_ID", None); env.pop("CLIENT_SECRET", None)
env.update(got)
sys.exit(subprocess.run(["sh", "-c", sys.argv[1]], env=env).returncode)
PY
}

# 제공자별 키 이름과 유효성 확인 URL. 키 이름은 Infisical 쪽 이름이다.
probe_cmd='
  case "$P" in
    openai) k="${RELAYER2_OPENAI_API_KEY:-}"; [ -z "$k" ] && { echo 키없음; exit 0; }
      curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $k" https://api.openai.com/v1/models ;;
    gemini) k="${GEMINI_API_KEY:-}"; [ -z "$k" ] && { echo 키없음; exit 0; }
      curl -s -o /dev/null -w "%{http_code}" -H "x-goog-api-key: $k" https://generativelanguage.googleapis.com/v1beta/models ;;
  esac'

current() { grep -E '^AI_PROVIDER=' .env 2>/dev/null | cut -d= -f2 || echo openai; }

if [ $# -eq 0 ]; then
  echo "지금 제공자: $(current)   (Infisical: ggbss-agent · prod · $SECRET_PATH)"
  for p in openai gemini; do
    printf '  %-7s ' "$p"
    P="$p" with_secrets "P=$p; $probe_cmd"
    echo
  done
  exit 0
fi

target="$1"
case "$target" in openai|gemini) ;; *) echo "openai 또는 gemini 만 됩니다." >&2; exit 2;; esac

code="$(with_secrets "P=$target; $probe_cmd")"
[ "$code" = "200" ] || { echo "$target 키가 쓸 수 없습니다 (HTTP $code). 바꾸지 않았어요." >&2; exit 1; }

src=$([ "$target" = openai ] && echo RELAYER2_OPENAI_API_KEY || echo GEMINI_API_KEY)
dst=$([ "$target" = openai ] && echo OPENAI_API_KEY || echo GEMINI_API_KEY)

tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
grep -v -E "^(AI_PROVIDER|AI_MODEL|OPENAI_API_KEY|GEMINI_API_KEY)=" .env > "$tmp" || true
with_secrets "printf '%s=%s\n' '$dst' \"\$$src\"" >> "$tmp"
printf 'AI_PROVIDER=%s\n' "$target" >> "$tmp"
mv "$tmp" .env; chmod 600 .env

echo "제공자를 $target 로 바꿨습니다 (HTTP 200)."
echo
echo "남은 것:"
echo "  1. API 다시 띄우기"
echo "  2. **외부 LLM·국외 처리 동의를 다시 받기** — 수신자가 바뀌어 기존 동의는 '확인 필요'입니다."
echo "     받기 전에는 초안 요청이 409 로 막힙니다. 막히는 게 정상입니다."
