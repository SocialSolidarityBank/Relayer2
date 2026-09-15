#!/usr/bin/env bash
# 백업(P1). DB 덤프 하나 + 무결성 해시.
#
# **열쇠는 백업에 들어가지 않는다.** 덤프 안의 자유 글과 금고는 암호문이고,
# 열쇠(PII_ENC_KEY)는 .env 에만 있다. 둘이 같은 자리에 있으면 암호화한 뜻이 없다.
# 열쇠는 1Password 같은 곳에 따로 보관하고, 복구할 때 손으로 가져온다.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

out_dir="${1:-backups}"
mkdir -p "$out_dir"
stamp=$(date +%Y%m%d-%H%M%S)
file="$out_dir/relayer-$stamp.sql"

docker exec relayer-db pg_dump -U relayer -d relayer --clean --if-exists > "$file"
shasum -a 256 "$file" | tee "$file.sha256"

echo
echo "백업: $file ($(wc -c < "$file" | tr -d ' ') bytes)"
echo "열쇠는 들어 있지 않다. PII_ENC_KEY 는 따로 보관한다 — 잃으면 자유 글과 금고를 영영 못 읽는다."
