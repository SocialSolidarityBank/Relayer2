# 온보딩 레인 — 다음 세션 시작 프롬프트 (2026-09-18)

아래를 새 세션 첫 메시지로 붙여 넣는다 (`cd /Users/seongqkim/DEVELOPER/PROJECTS/RELAYER2/.worktrees/onboarding` 에서 `omp` 실행).
PR #36 이 머지됐으면 이 워크트리·브랜치는 루트 세션에서 지우고, 아래 후속 항목은 새 브랜치에서 한다.

```
You are in the RELAYER2 worktree `onboarding` (branch `feat/onboarding`, PR #36 → main), at
/Users/seongqkim/DEVELOPER/PROJECTS/RELAYER2/.worktrees/onboarding

State: branch HEAD f8fd7ad has origin/main (7ce6a24) merged in; PR #36 is MERGEABLE/CLEAN. Everything in
`.ouroboros/seed-onboarding.yaml` is implemented and verified (api 107/107 via `node scripts/check-case-access.mjs`,
Playwright 27/27, `migrate --check`). QA P1 1–5 and tech 10 are done; Q decisions 6 (`기관 워크스페이스` is a term
we use — GLOSSARY §15-2) and 7 (주소/slug is read-only, value display only, deploy-procedure change only) are applied.
Design record: SPEC.md §24, GLOSSARY §15-2, docs/deploy.md, docs/astra-onboarding-design-2026-09-17.md.

First: `git fetch && git status`. If #36 is already merged, stop and tell Q to remove this worktree from the repo
root; do follow-ups on a fresh branch from main. `pnpm install` if node_modules is missing. Postgres: the shared
container `relayer-db` (:55432) is usually up; do NOT run migrations against the shared `relayer` DB — use
`node scripts/check-case-access.mjs` (disposable DB) for the api suite, and for manual/e2e runs build your own
DB + server (see api/test/scratch-db.ts; e2e/onboarding.spec.ts spins its own). Web e2e against a seeded server:
`PLAYWRIGHT_BASE_URL=http://localhost:<port> PLAYWRIGHT_API_PREFIX= pnpm --dir web exec playwright test`.

Follow-ups, in order (all UI copy is noun-phrase per DESIGN.md §6; CSS/tokens/DESIGN.md belong to `.worktrees/DESIGN`,
relayer-only rules go in web/src/styles/app.css):
1. QA P2 #9 — resume the wizard from server-side progress after a session drop (today only `onboarded_at` exists;
   derive step from org name/reg_no, programs count, invites, ai key — or add a small `onboarding_step` column).
2. 설정 가이드 popup for 외부 서비스 연결 (AI 정리·녹음 글로 옮기기·데이터베이스): the guide text now lives inside each
   accordion; Q wants the guide attached to the landing page and opened as a popup from the accordion. Use the
   existing dialog vocabulary (web/src/dialog.tsx from main).
3. 초대 QR code under the 역할 column (slot `.invite-link-slot` is reserved; no dependency added yet).
4. QA P2 #8 — verify on the staging build that no blue `기다리는 중` badge remains (current code uses mint/coral 연결됨/연결 안 됨).

Out of scope (seed): mail sending, multi-tenant org_id, in-app subdomain routing, STT/Supabase key entry in UI,
schedule cancel API. Never migrate the shared dev DB `relayer` until #36 is merged (0025 drops `support_cases.program_name`).
```

## 이번 세션 결과 요약 (2026-09-17~18)
- 커밋 17개(main 병합 포함). 마지막 `f8fd7ad`.
- 서버: 0025 마이그레이션(사업 실체·기관 컬럼·영구 마감), 첫 가입 문, 역할 변경, 사업 PATCH/DELETE/reopen + 종료 잠금, 실무자 사업 필터, AI 키 저장, `/me.onboarded·workspace`.
- 화면: 로그인=랜딩(CCC 게이트) · 가입(계정만) · 마법사 5단계 · 기관 요약 · 실무자 준비 중 · returnTo · 사업/실무자 사업 걸개 · 역할 바꾸기 · 외부 서비스 연결 아코디언.
- 문서: SPEC §18-3·§18-5 수정, §24 신설, GLOSSARY §15-2, deploy.md(첫 가입·서브도메인·RELAYER_SLUG/RELAYER_PUBLIC_URL), README, ASTRA 검토 원문.
- 알려진 기존 플레이크: `api/test/voice-auto.integration.test.ts`(동시성 상한, 드물게 타이밍 실패).
