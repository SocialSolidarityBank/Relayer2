#!/usr/bin/env bash
# 시크릿 배선(P1/D2). **값을 화면에 찍지 않는다.**
#
#   ./scripts/wire-secrets.sh <비밀번호가 담긴 파일>
#
# 하는 일
#   ① 파일에서 DB 비밀번호를 읽어 Supabase 세션 풀러 접속 주소를 조립한다
#   ② 로컬 `.env` 의 DATABASE_URL 을 그 값으로 바꾼다(다른 줄은 건드리지 않는다)
#   ③ Infisical `/RELAYER2` 에 DATABASE_URL·PII_ENC_KEY·SESSION_SECRET 을 올린다
#      — `--file` 로 넘긴다. 명령 인자에 값이 들어가면 `ps` 에 보인다
#   ④ 임시 파일과 비밀번호 파일을 지운다
#
# 출력은 길이·성공 여부뿐이다.
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077

pw_file="${1:?비밀번호 파일 경로가 필요하다}"
[ -s "$pw_file" ] || { echo "비밀번호 파일이 비었다"; exit 1; }

PROJECT_REF="wtbdqyedyimivdbgljcs"
POOLER_HOST="aws-0-ap-northeast-2.pooler.supabase.com"
INFISICAL_PATH="/RELAYER2"
INFISICAL_PROJECT_ID="a7c44b37-a885-4c62-98cd-cbc8a9810de9"

set -a; . ./.env; set +a
: "${PII_ENC_KEY:?.env 에 PII_ENC_KEY 가 없다}"
: "${SESSION_SECRET:?.env 에 SESSION_SECRET 가 없다}"

tmp_env="$(mktemp -t relayer-secrets)"
trap 'rm -f "$tmp_env"' EXIT

# 비밀번호에 @ : / 같은 글자가 있어도 깨지지 않게 URL 인코딩한다.
DB_URL="$(PWFILE="$pw_file" REF="$PROJECT_REF" HOST="$POOLER_HOST" python3 - <<'PY'
import os, urllib.parse
pw = open(os.environ['PWFILE']).read().strip()
user = urllib.parse.quote(f"postgres.{os.environ['REF']}", safe='')
print(f"postgresql://{user}:{urllib.parse.quote(pw, safe='')}@{os.environ['HOST']}:5432/postgres")
PY
)"

{
  printf 'DATABASE_URL=%s\n' "$DB_URL"
  printf 'PII_ENC_KEY=%s\n' "$PII_ENC_KEY"
  printf 'SESSION_SECRET=%s\n' "$SESSION_SECRET"
} > "$tmp_env"

# ② 로컬 .env
python3 - "$tmp_env" <<'PY'
import pathlib, sys
url = next(l for l in open(sys.argv[1]) if l.startswith('DATABASE_URL=')).rstrip('\n')
env = pathlib.Path('.env')
lines = [l.rstrip('\n') for l in env.read_text().splitlines()]
out, done = [], False
for line in lines:
    if line.startswith('DATABASE_URL='):
        out.append(url); done = True
    else:
        out.append(line)
if not done:
    out.append(url)
env.write_text('\n'.join(out) + '\n')
print('  .env 갱신')
PY

# ③ Infisical — 쓰기는 Machine Identity 로 한다.
# `ggbss_project_access_token` 은 read 전용이고, CLI `secrets set` 은 값을 argv 에 싣는다.
# 그래서 자격증명과 값을 **환경변수로만** 넘기고 파이썬이 HTTP 로 올린다(portwright/services/infisical.md).
(
  set -eu
  CLIENT_ID="$(OP_BIOMETRIC_UNLOCK_ENABLED=false ~/.dotfiles/scripts/opsvc item get 'Infisical · account@ggbss.or.kr' \
    --vault BSS --fields label=ggbss_client_ID --reveal)"
  CLIENT_SECRET="$(OP_BIOMETRIC_UNLOCK_ENABLED=false ~/.dotfiles/scripts/opsvc item get 'Infisical · account@ggbss.or.kr' \
    --vault BSS --fields label=ggbss_client_secret --reveal)"
  test -n "$CLIENT_ID" && test -n "$CLIENT_SECRET"
  CLIENT_ID="$CLIENT_ID" CLIENT_SECRET="$CLIENT_SECRET" ENV_FILE="$tmp_env" \
  PROJECT_ID="$INFISICAL_PROJECT_ID" SECRET_PATH="$INFISICAL_PATH" python3 scripts/infisical_put.py
)

rm -f "$pw_file"
echo "  비밀번호 파일 삭제: $pw_file"
echo "완료. 값은 .env 와 Infisical 에만 있다."
