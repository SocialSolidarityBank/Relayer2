# v6 상담기록 분석 — 구현·검증 보고 (2026-09-18, 브랜치 `feat/ai-module-v6`)

마이그레이션 번호: **0032** (`migrations/0032_record_analysis_v6.sql`; origin/main 에 0030 사례 기억·0031 `ai_drafts_evidence`(#102)가 먼저 내려 0031→0032 로 옮김). 바탕 origin/main d3c024f.
시드 `.ouroboros/seed-ai-module.yaml`, 장부 `docs/ai-module-ledger-2026-09-18.md`, 규칙 정본 `docs/relayer_v1_handoff.md` 부록.

## 1. 변경 이유와 결과 동작

회차별 요약·원본 보기가 v6 규칙(01 구조화·02 요약·04 전사 연결·별첨 불일치)으로 바뀌었다. 현재 회차의 수기 원본(memo + manual 카드 4종, 첫상담은 자유 글 항목)만을 근거로 서버가 문장 span 을 자르고, 마스킹된 문장 + span ID 만 모델에 보내며, 응답은 스키마·참조·규칙 검증을 모두 넘어야 초안이 된다(못 넘으면 `failed`). 한 초안을 한 번 승인하면 회차 카드 4구역·팝업 구조화 뷰·전사 띠·대조 패널·키워드 백링크가 선다. 지난 회차·브리핑·`나중 말` 규칙·fact_changes 는 새 경로에 없다.

## 2. 실제 수정 파일과 계약

| 영역 | 파일 | 무엇 |
|---|---|---|
| 계약 | `api/src/domain/record-analysis.ts` | 타입·zod `LlmAnalysisSchema`·span ID(`w:<doc>:<n>`/`t:<id>:<n>`)·`splitSentences`·`coverageOf`·`checkReferences`·금지어·`INTAKE_FREE_TEXT_KEYS`·라우트 표 |
| 규칙 | `api/src/domain/structured-record.ts`, `session-summary.ts`, `transcript-links.ts` | 01·02·04 검증기(순수 함수), `renderOrder`(①번호), `statusForTranscriptSpan` |
| 저장·오케스트레이션 | `migrations/0032_record_analysis_v6.sql`, `api/src/record-analysis.ts` | `record_analyses`(draft/approved/failed, source_versions, 암호화 body, append-only), 문서·span·문장별 마스킹·프롬프트·검증·draft/failed·approve(draft_id+source_versions 409, `replaceAiCards` 유지)·`analysisView`·`backlinks`·`sessionAiSummaries`·`v6StaleFlags` |
| 제공자 | `api/src/ai.ts`, `api/src/consent.ts` | `callModel<T>` 일반화, `AI_PROVIDER=stub`(`AI_STUB_FILE`, 호출마다 재읽기), `sessionParts` manual 필터, 지난 회차 루프·나중 말·fact_changes 생성 삭제 |
| 라우트·조회 | `api/src/routes.ts`, `api/src/service.ts`, `api/src/revisions.ts` | `GET/POST /sessions/:id/draft`, `POST /sessions/:id/draft/approve`, `GET /sessions/:id/analysis`, `GET /cases/:id/backlinks?keyword=`; `CaseDetail.sessions[].ai_summary` = `SessionAiSummary`(v6|legacy); `kind=summary` 리비전 → `summary_override` |
| 화면 부품 | `web/src/structured-record.tsx`, `session-summary.tsx`, `transcript-view.tsx`, `analysis-panel.tsx`, `analysis-preview.tsx` | 구조화 뷰·요약 4구역·전사 뷰·대조/백링크 패널·개발용 합성 fixture |
| 화면 | `web/src/screens/participant-info.tsx`, `web/src/session-original.tsx`, `web/src/screens/review.tsx`, `web/src/api.ts` | 회차 카드(브리핑 분할 폐지·빈 구역 숨김·키워드 칩·구버전/사람이 고침 배지), 팝업(`원문 그대로|구조화` 토글·전사 띠·불일치 배경·대조 4항목·필터·백링크·`onOpenSession`), 검토 화면 v6 승인 |
| 스타일 | `web/src/styles/app.css`(`/* ==== AI-MODULE ==== */`), `tokens.css`(`--discrepancy-tint`) | 상태 띠 민트/코랄/블루, 불일치 배경, split 레이아웃, 인쇄 |
| 개발 환경 | `web/vite.config.ts`, `scripts/check-case-access.mjs` | `WEB_PORT`/`API_PORT` env, 격리 DB 러너 파일 필터 |
| 자료·도구 | `api/test/fixtures/record-analysis-v6/**`, `scripts/record-analysis-coverage.mjs`, `scripts/fetch-testdata-fixture.mjs` | 합성 데이터셋 발췌 3회차 + stub 응답, 원문 무손실 검사 |
| 문서 | `SPEC.md` §15·§16-4·§17-4, `GLOSSARY.md` §6-4~6-8, `DESIGN.md` §2·요약·팝업, `README.md` | v6 계약 반영 |

## 3. 핸드오프 T01~T38 대응표

| ID | 범위 | 담당 검증 | 결과 |
|---|---|---|---|
| T01 원문 재구성(한글·이모지·따옴표·빈 줄) | in | `scripts/record-analysis-coverage.mjs`(재조립 일치·sha256), `test/record-analysis.test.ts` | 통과 |
| T02 `…` 보존·생성 줄임표 검출 | in | coverage 스크립트(말줄임 검사) | 통과 |
| T03 긴 전사 처음·중간·끝 | in | coverage(c08 전사 160 span) | 통과 |
| T04 일부 segments 만 존재 | in | `record-analysis.ts` transcriptDocument(개수 불일치 시 시각 null, 본문 전체 분할) | 코드 경로(통합 테스트는 segments 없는 전사만) |
| T05 시간·화자 없는 문장 | in | 화면 `구간 미확인`, 서버 null | 통과(fixture 에 segments 없음) |
| T06 전사 없음/실패/403 구분 | in | e2e (i), `session-original.tsx` 상태 3종 | e2e 참조 |
| T07 파일 2개·재전사 | **out**(Q 15) | `전사 없는 녹음 N건` 결손 표시만 | — |
| T08 현재는 결과만, 이전 회차 약속 | in | `session-summary.test.ts`, 통합(프롬프트에 지난 회차 없음) | 통과 |
| T09 같은 회차 약속→마침 | in | `session-summary.test.ts` | 통과 |
| T10 전후 없는 새 대처(요약 전용) | in | `record-analysis.test.ts`(T27), `session-summary.test.ts` | 통과 |
| T11 후속 계획만 | in | `session-summary.test.ts` | 통과 |
| T12 하위 3종 조합·①연속 | in | `session-summary.test.ts`(7조합), e2e (a) | 통과 |
| T13 약속만 | in | `session-summary.test.ts` | 통과 |
| T14 예정/완료 | in | `session-summary.test.ts`(보수적 휴리스틱) | 통과 |
| T15 단순 중요 상태 | in | 검증기는 막지 않음(모델·승인 몫) — 테스트로 문서화 | 통과 |
| T16 다음 회차 완료가 과거 요약 불변 | in | 설계(회차별 승인 행 고정, 브리핑 채움 폐지), 통합 테스트 | 통과 |
| T17 노력→시도 치환 | in | `forbiddenWordsIn`, 세 검증기 | 통과 |
| T18 대사 창작 금지 | in | `session-summary.test.ts` | 통과 |
| T19 전사 단독 완료·변화 | in | `transcript-links.test.ts`(상태 상속만) | 통과 |
| T20~T22 불일치 4조건 | in | `transcript-links.test.ts` | 통과 |
| T23 회차 밖 span | in | `checkReferences`, 통합(failed 행) | 통과 |
| T24 동일 문구 반복 | in | `record-analysis.test.ts`, e2e (b) | 통과 |
| T25 A 클릭 후 B 클릭 | in | e2e (d) | e2e 참조 |
| T26 필터 켜기/끄기 | in | e2e (e) | e2e 참조 |
| T27 요약 전용 파랑 비전파 | in | `record-analysis.test.ts`, `transcript-links.test.ts` | 통과 |
| T28 버전 충돌 승인 거절 | in | 통합(draft_id·source_versions 409) | 통과 |
| T29 malformed/잘림/없는 span | in | 통합(failed 행, 원문 열람 가능) | 통과 |
| T30 초안/승인/재생성 | in | 통합, `ai-approval.integration.test.ts` | 통과 |
| T31 `</script>` 전사 | in | 렌더러 텍스트 노드(smoke), e2e (b) | 통과(smoke) |
| T32 390px·키보드 | in | e2e (j) | e2e 참조 |
| T33 새로고침·회차 전환 | in | e2e (l) | e2e 참조 |
| T34 인쇄 | in | e2e (k), CSS print | e2e 참조 |
| T35 403·동의 게이트 | in | 통합(`/analysis`·`/backlinks` 403) | 통과 |
| T36 payload·감사 | in | 통합(마스킹, 감사에 원문 없음) | 통과 |
| T37 구버전 데이터 위 migration | in | 통합(legacy 요약 읽기), `ui-plan-api` 갱신 | 통과 |
| T38 UI 텍스트·내부 표현 비노출 | in | 렌더러(6유형·점수·조건표 미렌더), e2e | 통과(smoke) |

## 4. 실행한 테스트

| 명령 | 결과 |
|---|---|
| `pnpm --dir api exec vitest run test/record-analysis.test.ts test/session-summary.test.ts test/transcript-links.test.ts` | 3 files, 47 passed |
| `node scripts/check-case-access.mjs`(격리 DB, 전체 API 스위트) | 36 files passed, 179 passed, 1 skipped(기존) |
| `node scripts/record-analysis-coverage.mjs api/test/fixtures/record-analysis-v6` | COVERAGE_OK (c08-s1 인테이크 5 자유글+전사 160 span, c10-s10 memo 26+전사 109, c03-s8) — 재조립 일치·sha256·스키마·참조·인용·키워드·말줄임 전부 ok |
| `pnpm --dir web exec tsc --noEmit && pnpm --dir web build` | exit 0, build ok |
| `RELAYER_INTEGRATION=1 node api/src/migrate.ts --check` | (전체 스위트 러너가 0031 적용 확인) |
| `PLAYWRIGHT_BASE_URL=http://localhost:5177 pnpm --dir web exec playwright test e2e/record-analysis-v6.spec.ts --reporter=line` | 8 passed(직렬 1워커, 장면 a~l, pageerror 0) |
| 회귀 `e2e/beta-flow.spec.ts e2e/user-feedback.spec.ts e2e/participant-list.spec.ts` (같은 서버, main 688a331 병합 뒤) | 13 + 3 + 1 passed(main 의 갱신된 spec 그대로) |
| 회귀 `e2e/voice-start.spec.ts` (자체 스크래치 서버) | 1 passed |

**main 병합(688a331) 뒤 재조립.** 작업 중 main 이 같은 화면을 재작성해(#92·#96·#97·#100: 3탭, 요약 아코디언 카드, 행동 버튼·요약문 편집 삭제, 원본 팝업 = 기록지 embedded + 전사 맥락 덩어리, 근거 하이라이터) 병합 시 9파일이 충돌했다. Q 결정(장부 21): main 화면 우선. 처리 — `ai.ts` 는 main 판(사례 기억) 위에 stub 제공자·lazy `provider()/model()` 재적용, 구 `draftSession`·`latestDraft`·`approveDraft`·`memoryBefore` 삭제(초안은 `record-analysis.ts`), 사례 기억은 초안 입력에서 제거(결정 20, `case-memory` 테스트의 초안 소비 단언 제거); 화면은 main 판 위에 v6 재조립(아코디언 안 4구역, 근거 모달을 span 좌표 `<mark>` 로, 기록지 위 `구조화` 토글, 맥락 덩어리 자리에 문장 행, 대조 패널, 키워드 칩·근거 링크가 팝업 진입점, 승인 후 요약 편집 UI 없음); `FactChanges` 부품 삭제; e2e spec 을 새 DOM 으로 갱신하고 스크린샷 11장 재생성. 병합 뒤 전체 API 스위트 37 files / 183 passed.

라이브 스모크(격리 DB `relayer_ai_module`, API 8797 stub, web 5177): 시드 회차 2에 tailored stub → `POST /sessions/2/draft` draft → approve → `GET /cases/1/detail` `ai_summary.kind=v6` → `GET /cases/1/backlinks?keyword=채무 조정` 1건 → 브라우저에서 회차 카드(핵심 라벤더·확인필요 코랄·키워드 칩·빈 구역 없음)와 팝업 `구조화`(01/02 주제·단락·코랄 띠 `rgb(242,169,156)`) 확인.

원문 무손실 수치: coverage 스크립트 출력 참조(문서별 raw line·chars·span·sha256; gaps_nonblank 0·overlaps 0).

## 5. 화면 증거

`docs/record-analysis-v6-evidence/README.md` 참조 — PNG 11장(00-review-draft · 01-session-card · 02-structured · 03-panel-discrepancy · 04-panel-link · 05-discrepancy-filter · 06-backlinks · 07-print · 08-override · 09-stale · 10-mobile), T06·T12·T24·T25·T26·T31·T32·T33·T34 대응.

e2e 로 잡은 결함 1건(수정됨): 전사 span 의 `doc` 이 전사 행 id(`44`)였고 문서 id 는 `transcript:44` 라 화면이 원문을 못 찾아 전사 행·대조 패널 `녹음 내용` 이 비어 보였다. `spansOf(prefix, key, text, doc = key)` 로 전사 span 이 문서 id 를 들게 고쳤고, spec 이 행·패널의 문장 텍스트를 단언한다(수정 전 실패 → 수정 후 통과 확인).

## 6. 수동 검수와 검증 대기

- **수동 1회(실제 LLM)**: 미실행. 실키(`organization.enc_openai_key` 또는 env)와 비용이 들어 Q 가 실행한다 — 절차: relayer-testdata C10 s10 을 로더로 적재 → `AI_PROVIDER=openai` 로 `POST /sessions/:id/draft` → failed 여부·`error`·규칙 위반(어휘 치환·이전 회차 참조·전사 단독 확정·대사 창작) 건수 기록.
- **실제 상담 자료 검수**: `검증 대기`(자료 없음, 공개 레포 커밋 금지).
- **T07 다중 녹음**: 범위 밖, 결손 표시로 대체.

## 7. 미해결·한계

- 결정적 키워드로 전체 목표 문장 전체가 칩이 된다(예: `연체를 정리하고 근로시간을 회복한다`) — 계약대로지만 길다. 목표 칩을 짧게 표기할지 후속 결정.
- 회차 카드 접힌 한 줄(desc)에 핵심 문장이 들어가 머리줄이 좁아진다(기존 desc 규칙). 시각 조정 후속.
- `completed` 판정 휴리스틱은 보수적 목록(INTENTION/COMPLETION 표지) — 경계 사례는 승인자가 본다.
- `feat/case-memory` 가 먼저 내리면 rebase 때 `memoryBefore`·`MEMORY_HEADER`·fact_changes 제거(Q 20). `ui/participant-card` 가 내리면 4구역을 `SeqSection` 위에 얹는다.
- `.worktrees/DESIGN`·`memory` 파일은 건드리지 않았다. 원격 push 만 했고 PR·병합·배포 없음.
