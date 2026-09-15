#!/usr/bin/env bash
# 복구 연습(P1). **운영 DB 를 건드리지 않는다** — 옆에 빈 DB 를 만들어 거기로 되살린다.
#
# 백업은 "떴다"가 아니라 "되살아났다"로 증명한다. 이 스크립트는
#   ① 덤프 해시 확인 ② 연습용 DB 생성 ③ 복원 ④ 행 수 대조 ⑤ 자유 글 복호화 한 건
# 까지 하고 연습용 DB 를 지운다.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

file="${1:-}"
if [ -z "$file" ]; then
  file=$(ls -t backups/relayer-*.sql 2>/dev/null | head -1 || true)
fi
[ -n "$file" ] && [ -f "$file" ] || { echo "백업 파일이 없다. ./scripts/backup.sh 를 먼저 돌린다."; exit 1; }

echo "▸ 덤프: $file"
if [ -f "$file.sha256" ]; then
  shasum -a 256 -c "$file.sha256" >/dev/null && echo "▸ 해시 확인"
else
  echo "▸ 해시 파일 없음 — 무결성 확인 건너뜀"
fi

drill="relayer_restore_drill"
docker exec relayer-db psql -U relayer -d postgres -c "drop database if exists $drill" >/dev/null
docker exec relayer-db psql -U relayer -d postgres -c "create database $drill" >/dev/null
docker exec -i relayer-db psql -U relayer -d "$drill" -q < "$file" >/dev/null 2>&1
echo "▸ 연습용 DB 로 복원: $drill"

count() { docker exec relayer-db psql -U relayer -d "$1" -tA -c "$2"; }
tables="participants support_cases sessions cards card_outcomes consent_events audit_log"
ok=1
for t in $tables; do
  a=$(count relayer "select count(*) from $t")
  b=$(count "$drill" "select count(*) from $t")
  mark="같음"
  if [ "$a" != "$b" ]; then mark="다름 ✗"; ok=0; fi
  printf "  %-16s 운영 %-6s 복구 %-6s %s\n" "$t" "$a" "$b" "$mark"
done

# 되살린 자유 글이 실제로 열쇠로 열리는지 한 건 확인한다.
packed=$(count "$drill" "select memo from sessions where memo is not null limit 1")
if [ -n "$packed" ]; then
  PACKED="$packed" node --input-type=module -e '
    process.env.PII_ENC_KEY ||= "";
    const { decryptText } = await import("./api/src/pii.ts");
    const plain = decryptText(process.env.PACKED);
    if (!plain || plain.startsWith("v1.")) { console.error("  복호화 실패 ✗"); process.exit(1); }
    console.log(`  자유 글 복호화: "${plain.slice(0, 20)}…"`);
  '
fi

docker exec relayer-db psql -U relayer -d postgres -c "drop database $drill" >/dev/null
echo "▸ 연습용 DB 정리"
[ "$ok" = "1" ] && echo "복구 연습 통과" || { echo "복구 연습 실패"; exit 1; }
