#!/usr/bin/env bash
# 백업(P1). `.env` 의 DATABASE_URL 이 가리키는 곳을 통째로 뜬다 — 로컬이든 Supabase 든 같다.
#
#   ./scripts/backup.sh [보관폴더]
#
# **열쇠는 백업에 들어가지 않는다.** 덤프 안의 자유 글과 금고는 암호문이고
# 열쇠(PII_ENC_KEY)는 .env 와 Infisical 에만 있다. 둘이 같은 자리에 있으면 암호화한 뜻이 없다.
#
# Supabase Pro 의 자동 백업(일 1회)과 별개다. 그쪽은 대시보드에서만 되살릴 수 있고
# 우리가 되살아남을 증명할 수 없다. 이 덤프는 우리가 직접 복구 연습에 쓴다.
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077

set -a; . ./.env; set +a
: "${DATABASE_URL:?.env 에 DATABASE_URL 이 없다}"

# 연결 정보는 인자가 아니라 PG* 환경변수와 임시 PGPASSFILE 로 넘긴다 — 인자는 `ps` 에 보인다.
. ./scripts/lib/pgpass.sh
pg_env_from_url "$DATABASE_URL"

# Homebrew libpq 는 PATH 에 심어 주지 않는다. 있으면 그것을 쓴다.
PG_DUMP="$(command -v pg_dump || true)"
[ -n "$PG_DUMP" ] || PG_DUMP=/opt/homebrew/opt/libpq/bin/pg_dump
[ -x "$PG_DUMP" ] || { echo "pg_dump 가 없다: brew install libpq"; exit 1; }

out_dir="${1:-backups}"
mkdir -p "$out_dir"
# 덤프에는 비밀번호 해시와 당사자 열람 token/code_hash 까지 들어 있다.
# umask 는 새 파일만 지키니, 폴더와 이미 있는 덤프의 권한도 매번 맞춘다.
chmod 700 "$out_dir"
find "$out_dir" -maxdepth 1 -type f -exec chmod 600 {} +
stamp="$(date +%Y%m%d-%H%M%S)"
file="$out_dir/relayer-$stamp.sql"

# --no-owner/--no-acl: 되살릴 곳의 역할 이름이 달라도 들어간다(Supabase → 로컬 연습).
"$PG_DUMP" --clean --if-exists --no-owner --no-acl --schema=public > "$file"
shasum -a 256 "$file" > "$file.sha256"

# 오래된 것은 지운다. 백업이 디스크를 잡아먹어 서비스가 멈추면 본말전도다.
keep="${BACKUP_KEEP:-14}"
ls -t "$out_dir"/relayer-*.sql 2>/dev/null | tail -n +$((keep + 1)) | while read -r old; do
  rm -f "$old" "$old.sha256"
done

echo "백업: $file ($(wc -c < "$file" | tr -d ' ') bytes) · 보관 최근 ${keep}개"
echo "열쇠는 들어 있지 않다. PII_ENC_KEY 를 잃으면 자유 글과 금고를 영영 못 읽는다."
