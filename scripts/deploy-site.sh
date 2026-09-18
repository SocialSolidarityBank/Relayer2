#!/usr/bin/env bash
# main 에 들어간 것을 relayer.kr 로 내보낸다. 앱이 도는 기기(맥미니)에 ssh 로 붙어 git pull 한다.
#
#   ./scripts/deploy-site.sh            기본 호스트 mini
#   ./scripts/deploy-site.sh 다른호스트
#
# 소개 페이지와 가이드만 바뀌었으면 앱을 다시 띄우지 않는다. 앱이 요청마다 디스크를 읽으므로
# 파일만 새로 놓이면 다음 요청부터 새것이 나간다. 코드가 바뀌었을 때만 다시 띄운다.
# 표가 바뀌는 변경(migrations/)은 앱을 다시 띄울 때 run-service.sh 가 먼저 돌린다.
# 코드는 그대로인데 표만 바뀐 경우에는 앱이 다시 뜨지 않으므로 사람이 돌려야 한다.
set -euo pipefail

host="${1:-mini}"
remote='$HOME/services/relayer2'
site='https://relayer.kr'

run() { ssh -o BatchMode=yes "$host" "cd $remote && $1"; }

echo "[1/4] $host 에서 main 과의 차이를 본다"
changed="$(run 'git fetch -q origin main && git diff --name-only HEAD origin/main')"
if [ -z "$changed" ]; then
  echo "     새 것 없음. 이미 최신이다."
  exit 0
fi
printf '%s\n' "$changed" | sed 's/^/     /'

needs_restart="$(printf '%s\n' "$changed" | grep -E '^(api|web)/' || true)"
needs_migrate="$(printf '%s\n' "$changed" | grep -E '^migrations/' || true)"

echo "[2/4] 받는다"
run 'git pull -q --ff-only'
run 'git log --oneline -1' | sed 's/^/     /'

if [ -n "$needs_restart" ]; then
  echo "[3/4] 코드가 바뀌었다. 앱을 다시 띄운다"
  ssh -o BatchMode=yes "$host" 'launchctl kickstart -k gui/$(id -u)/or.bss.relayer'
  sleep 4
else
  echo "[3/4] 파일만 바뀌었다. 앱은 그대로 둔다"
fi

echo "[4/4] 확인"
for path in / /guide-user.html /guide-admin.html /test; do
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$site$path")"
  printf '     %-20s %s\n' "$path" "$code"
  [ "$code" = 200 ] || { echo "     실패: $site$path 가 200 이 아니다"; exit 1; }
done

if [ -n "$needs_migrate" ] && [ -z "$needs_restart" ]; then
  echo
  echo "주의: migrations/ 가 바뀌었는데 앱을 다시 띄우지 않았다. 표는 그대로다."
  echo "      ssh $host 'cd \$HOME/services/relayer2 && node api/src/migrate.ts'"
fi

echo
echo "끝. $site"
# CSS 나 JS 를 고쳤다면 Cloudflare 가 옛 파일을 최대 4시간 들고 있다.
# site/index.html 의 ?v= 를 올려 새 주소로 만들어야 바로 나간다(docs/site.md 캐시 절).
if printf '%s\n' "$changed" | grep -qE '^site/(site\.css|site\.js)$'; then
  echo "주의: site.css 나 site.js 가 바뀌었다. HTML 의 ?v= 를 올렸는지 확인한다."
fi
