#!/usr/bin/env bash
# 복구 연습(P1). **운영 DB 를 건드리지 않는다** — 로컬 Postgres 에 빈 DB 를 만들어 거기로 되살린다.
#
#   ./scripts/restore-drill.sh [덤프파일]     # 없으면 가장 최근 것
#
# 백업은 "떴다"가 아니라 "되살아났다"로 증명한다. 여기서
#   ① 해시 확인 ② 연습용 DB 생성 ③ 복원 ④ 표별 행 수 대조 ⑤ 자유 글 한 건 복호화
# 까지 하고 연습용 DB 를 지운다. ⑤ 까지 해야 열쇠와 덤프가 짝이 맞는다는 것이 증명된다.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

# 연결 정보는 인자가 아니라 PG* 환경변수와 임시 PGPASSFILE 로 넘긴다 — 인자는 `ps` 에 보인다.
. ./scripts/lib/pgpass.sh
: "${DATABASE_URL:?.env 에 DATABASE_URL 이 없다}"

file="${1:-}"
[ -n "$file" ] || file="$(ls -t backups/relayer-*.sql 2>/dev/null | head -1 || true)"
[ -n "$file" ] && [ -f "$file" ] || { echo "백업 파일이 없다. ./scripts/backup.sh 를 먼저 돌린다."; exit 1; }

# 연습터는 로컬 docker Postgres 다. 운영이 Supabase 여도 되살리는 곳은 여기다.
DRILL_URL="${DRILL_DATABASE_URL:-postgres://relayer:relayer@localhost:55432/relayer_restore_drill}"
ADMIN_URL="${DRILL_ADMIN_URL:-postgres://relayer:relayer@localhost:55432/postgres}"
PSQL="$(command -v psql || echo /opt/homebrew/opt/libpq/bin/psql)"
[ -x "$PSQL" ] || { echo "psql 이 없다: brew install libpq"; exit 1; }

echo "▸ 덤프: $file"
if [ -f "$file.sha256" ]; then
  shasum -a 256 -c "$file.sha256" >/dev/null && echo "▸ 해시 확인"
else
  echo "▸ 해시 파일 없음 — 무결성 확인 건너뜀"
fi

pg_env_from_url "$ADMIN_URL"
"$PSQL" -q -c 'drop database if exists relayer_restore_drill' >/dev/null
"$PSQL" -q -c 'create database relayer_restore_drill' >/dev/null
pg_env_from_url "$DRILL_URL"
"$PSQL" -q -f "$file" >/dev/null 2>&1
echo "▸ 연습용 DB 로 복원"

ok=1
for t in participants support_cases sessions cards card_outcomes consent_events audit_log; do
  pg_env_from_url "$DATABASE_URL"
  a="$("$PSQL" -tA -c "select count(*) from $t")"
  pg_env_from_url "$DRILL_URL"
  b="$("$PSQL" -tA -c "select count(*) from $t")"
  mark="같음"
  if [ "$a" != "$b" ]; then mark="다름 ✗"; ok=0; fi
  printf "  %-16s 운영 %-6s 복구 %-6s %s\n" "$t" "$a" "$b" "$mark"
done

pg_env_from_url "$DRILL_URL"
packed="$("$PSQL" -tA -c "select memo from sessions where memo is not null limit 1")"
if [ -n "$packed" ]; then
  PACKED="$packed" node --input-type=module -e '
    const { decryptText } = await import("./api/src/pii.ts");
    const plain = decryptText(process.env.PACKED);
    if (!plain || plain.startsWith("v1.")) { console.error("  복호화 실패 ✗"); process.exit(1); }
    console.log(`  자유 글 복호화: 성공 (${plain.length}자)`);
  '
fi

pg_env_from_url "$ADMIN_URL"
"$PSQL" -q -c 'drop database relayer_restore_drill' >/dev/null
echo "▸ 연습용 DB 정리"
[ "$ok" = "1" ] && echo "복구 연습 통과" || { echo "복구 연습 실패"; exit 1; }
