#!/usr/bin/env bash
# 상시 실행 진입점(launchd 가 부른다). `.env` 를 읽고 앱을 띄운다.
# 마이그레이션을 먼저 맞춘다 — 미적용 상태로 서비스가 열리면 안 된다.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
set -a; . ./.env; set +a
node api/src/migrate.ts
exec node api/src/index.ts
