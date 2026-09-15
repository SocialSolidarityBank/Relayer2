#!/usr/bin/env bash
# 자유 글이 정말 암호문으로 앉아 있는지 DB 에서 직접 확인한다(P1).
# 평문이 한 줄이라도 남아 있으면 실패다.
set -euo pipefail
cd "$(dirname "$0")/.."

# DATABASE_URL 이 가리키는 곳을 본다 — 로컬이든 Supabase 든 같은 검사다.
set -a; . ./.env; set +a
rows=$(node --input-type=module -e "
import { sql } from './api/src/db.ts';
const [r] = await sql\`
  select count(*)::int as count from (
    select memo as v from sessions where memo is not null
    union all select plan_memo from sessions where plan_memo is not null
    union all select today_goal_text from sessions where today_goal_text is not null
    union all select next_goal_text from sessions where next_goal_text is not null
    union all select text from cards
    union all select overall_goal from support_cases where overall_goal is not null
    union all select text from goal_revisions where text is not null
    union all select close_reason from case_closures
  ) t where v !~ '^v[0-9]+\.'\`;
console.log(r.count);
await sql.end();
")

if [ "$rows" != "0" ]; then
  echo "평문이 남아 있다: ${rows}건"
  exit 1
fi
echo "자유 글 전부 암호문 (평문 0건)"
