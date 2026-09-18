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

echo "[1/5] $host 에서 main 과의 차이를 본다"
changed="$(run 'git fetch -q origin main && git diff --name-only HEAD origin/main')"
if [ -z "$changed" ]; then
  echo "     새 것 없음. 이미 최신이다."
  exit 0
fi
printf '%s\n' "$changed" | sed 's/^/     /'

needs_restart="$(printf '%s\n' "$changed" | grep -E '^(api|web)/' || true)"
needs_migrate="$(printf '%s\n' "$changed" | grep -E '^migrations/' || true)"
# 의존성이 바뀌었으면 받은 뒤에 설치한다. 2026-09-18 에 이것이 없어서 운영이 내려갔다.
# 다른 레인이 `@azure/identity` 를 더했는데 그 기기에 없어, 앱이 부팅에서 죽고 502 가 났다.
needs_install="$(printf '%s\n' "$changed" | grep -E '(^|/)(package\.json|pnpm-lock\.yaml)$' || true)"

echo "[2/5] 받는다"
run 'git pull -q --ff-only'
run 'git log --oneline -1' | sed 's/^/     /'

if [ -n "$needs_install" ]; then
  echo "[3/5] 의존성이 바뀌었다. 설치한다"
  run 'pnpm install --frozen-lockfile' | tail -2 | sed 's/^/     /'
else
  echo "[3/5] 의존성은 그대로다"
fi

if [ -n "$needs_restart" ]; then
  echo "[4/5] 코드가 바뀌었다. 앱을 다시 띄운다"
  ssh -o BatchMode=yes "$host" 'launchctl kickstart -k gui/$(id -u)/or.bss.relayer'
  sleep 6
else
  echo "[4/5] 파일만 바뀌었다. 앱은 그대로 둔다"
fi

echo "[5/5] 확인"
for path in / /guide-user.html /guide-admin.html /test /health; do
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$site$path")"
  printf '     %-20s %s\n' "$path" "$code"
  if [ "$code" != 200 ]; then
    echo "     실패: $site$path 가 $code 다. 앱 로그 마지막 20줄:"
    run 'tail -20 relayer.err.log' | sed 's/^/       /'
    echo "     되돌리려면: ssh $host 'cd \$HOME/services/relayer2 && git reset --hard HEAD~1 && launchctl kickstart -k gui/\$(id -u)/or.bss.relayer'"
    exit 1
  fi
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
