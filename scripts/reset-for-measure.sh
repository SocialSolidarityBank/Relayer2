#!/usr/bin/env bash
# 관문 2 측정 한 판을 위한 초기화. **당사자와 사례를 전부 지우고** 합성 1건을 다시 깐다.
# 측정 참가자가 바뀔 때마다 돌린다. 앞사람이 만든 사례가 남아 있으면 시간이 왜곡된다.
#
#   ./scripts/reset-for-measure.sh          이 맥의 .env (개발 DB)
#   ./scripts/reset-for-measure.sh --mini   맥미니 운영 (공개 주소로 측정할 때)
#
# **합성 데이터 전용이다.** 실데이터가 들어 있는 DB 에 절대 돌리지 않는다.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "${1:-}" = "--mini" ]; then
  echo "맥미니 운영 DB 를 초기화합니다. 합성 데이터만 들어 있어야 합니다."
  printf '정말 진행하려면 reset 이라고 적으세요: '
  read -r answer
  [ "$answer" = "reset" ] || { echo "그만둡니다."; exit 1; }
  ssh mini 'cd ~/services/relayer2 && set -a && . ./.env && set +a && node api/src/migrate.ts && node api/src/seed.ts'
  echo
  echo "접속 주소 (참가자에게 이 한 줄만)"
  echo "  https://relayer.kr/test          ← 도메인 연결이 끝났으면"
  echo "  https://mac-mini.tail79fba7.ts.net/test   ← 언제나 되는 주소"
else
  set -a; . ./.env; set +a
  node api/src/migrate.ts
  node api/src/seed.ts
  echo
  echo "접속 주소"
  echo "  이 맥:       http://localhost:5173/test"
  echo "  같은 Wi-Fi:  http://$(ipconfig getifaddr en0 2>/dev/null || echo '(en0 없음)'):5173/test"
fi

echo "계정 (아이디 = 비밀번호)"
echo "  test1  관리자"
echo "  test2  실무자   ← 대본은 이 계정으로"
echo "  test3  당사자   ← 로그인되지 않는 것이 정상"
echo
echo "계수기: 참가자 브라우저 콘솔에 docs/measure.js 를 붙여 넣고, 끝나면 relayer측정.끝()"
