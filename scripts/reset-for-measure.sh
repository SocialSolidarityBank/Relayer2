#!/usr/bin/env bash
# 관문 2 측정 한 판을 위한 초기화. 합성 데이터만 지우고 다시 깐다.
# 측정 참가자가 바뀔 때마다 돌린다. 앞사람이 만든 사례가 남아 있으면 시간이 왜곡된다.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

node api/src/migrate.ts
node api/src/seed.ts

echo
echo "접속 주소"
echo "  이 맥:       http://localhost:5173/"
echo "  같은 Wi-Fi:  http://$(ipconfig getifaddr en0 2>/dev/null || echo '(en0 없음)'):5173/"
echo "계정: worker@relayer.test / ${SEED_PASSWORD:-relayer-beta}"
echo
echo "계수기: 참가자 브라우저 콘솔에 docs/measure.js 를 붙여 넣고, 끝나면 relayer측정.끝()"
