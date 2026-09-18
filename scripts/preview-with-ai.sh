#!/usr/bin/env bash
# 설계 프리뷰 서버를 **Infisical 의 OpenAI 키를 자식 환경에만** 얹어 띄운다(2026-09-18 Q "키 infisical에 있어").
# 값은 어디에도 찍지 않는다 — 있는지와 길이만 stderr 에 알린다. DB 등 나머지는 .env.design 그대로다.
#   사용: scripts/preview-with-ai.sh [ENV_FILE=.env.design] [SECRET_PATH=/RELAYER2]
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077

env_file="${1:-.env.design}"
secret_path="${2:-/RELAYER2}"
opsvc="$HOME/.dotfiles/scripts/opsvc"
[ -x "$opsvc" ] || { echo "opsvc가 없다: $opsvc" >&2; exit 1; }

refs="$(mktemp -t relayer-infisical-refs)"
trap 'rm -f "$refs"' EXIT
cat >"$refs" <<'EOF'
CLIENT_ID=op://BSS/l34nxgvhlqrca67cikcdpetsfe/ggbss_client_ID
CLIENT_SECRET=op://BSS/l34nxgvhlqrca67cikcdpetsfe/ggbss_client_secret
EOF
chmod 600 "$refs"

# 파이썬이 토큰을 받아 키 하나만 집고, 같은 프로세스에서 node 로 exec 한다 — 값이 argv·파일·화면에 닿지 않는다.
OP_BIOMETRIC_UNLOCK_ENABLED=false "$opsvc" run --env-file="$refs" -- \
  env PROJECT_ID="a7c44b37-a885-4c62-98cd-cbc8a9810de9" SECRET_PATH="$secret_path" ENV_FILE="$env_file" \
  python3 - <<'PY'
import json, os, sys, urllib.parse, urllib.request
sys.path.insert(0, "scripts")
from infisical_get import API, login

token = login()
query = urllib.parse.urlencode({
    "workspaceId": os.environ["PROJECT_ID"], "environment": "prod", "secretPath": os.environ["SECRET_PATH"],
})
req = urllib.request.Request(f"{API}/v3/secrets/raw?{query}", headers={"authorization": f"Bearer {token}"})
with urllib.request.urlopen(req, timeout=30) as res:
    got = {s["secretKey"]: s["secretValue"] for s in json.loads(res.read()).get("secrets", [])}

env = {k: v for k, v in os.environ.items() if k not in ("CLIENT_ID", "CLIENT_SECRET", "PROJECT_ID", "SECRET_PATH", "ENV_FILE")}
for src, dst in (("RELAYER_OPENAI_API_KEY", "OPENAI_API_KEY"), ("AI_PROVIDER", "AI_PROVIDER"), ("AI_MODEL", "AI_MODEL")):
    if src in got:
        env[dst] = got[src]
        print(f"{dst}: 있음 len={len(got[src])}", file=sys.stderr)
    else:
        print(f"{dst}: 없음", file=sys.stderr)
os.execvpe("node", ["node", f"--env-file={os.environ['ENV_FILE']}", "api/src/index.ts"], env)
PY
