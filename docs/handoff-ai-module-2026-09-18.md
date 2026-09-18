# 인계 — AI 작동 모듈: v6 분류 + LLM 위키 구조화 레인 (2026-09-18)

코드 변경 없음. Ouroboros 인터뷰(Path B, MCP 없음)로 결정을 닫고 시드를 만들었다. 이 문서는 **다른 메인 세션의
오케스트레이터가 이어받아 실행**하기 위한 것이다. 이 세션은 구현·배포·설정 변경을 하지 않았다.

## 산출물 (브랜치 `feat/ai-module-v6` 첫 커밋, `.worktrees/ai-module`)

| 파일 | 무엇 |
|---|---|
| `.ouroboros/seed-ai-module.yaml` | **실행 계약.** 제약 22 · 수용 기준 9 · 온톨로지 13 · 종료 조건 6. `ooo qa`(document) 0.8 임계 통과 |
| `docs/ai-module-ledger-2026-09-18.md` | 인터뷰 장부 — Q 결정 1~20, 게이트 기본값, 코드 사실(file:line@origin/main), 범위 밖 |
| `docs/relayer_v1_handoff.md` | 규칙 정본(01·02·04·별첨·공통 HTML 부록). §2·§6 의 코드 설명은 70beaaa 기준이라 낡음 — 장부의 바탕 사실이 현행 |

시드가 정본이다. 아래는 시드를 읽기 전에 알아야 할 맥락과, 시드에 넣지 않은 실행 순서다.

## 한 줄 목표

현재 회차의 수기 원본(memo + 수기 카드 4종)만을 근거로 v6 규칙대로 단락 구조·상태·키워드·전사 연결·요약을 **한 초안으로 만들어
한 번 승인**하게 하고, 원본 팝업 수기 열의 `원문 그대로|구조화` 토글·전사 열의 띠·클릭 대조·불일치 필터·키워드 백링크 패널·
회차별 요약 4구역으로 그린다. 목표(전체+회차)는 시간 모호 시 묶음 기준이자 핵심 선별 1순위. 전사는 연결·대조만.

## Q 가 직접 내린 결정 (되묻지 말 것)

| # | 결정 | 기각한 대안 |
|---|---|---|
| 1 | 01 계층은 **시간순**, 목표는 시간 모호 시 묶음 기준 + 02 핵심 선별 1순위. 전체 목표·회차 목표 **둘 다** | 목표를 01 묶음 1기준으로, 위키 허브 |
| 2 | 전사 역할 **v6 그대로**(연결·대조·상태 상속만) | 수기 없는 회차만 전사 분류, 동등 분류 |
| 3 | 키워드 = **구조 데이터(결정적) + LLM 추출**(수기 어휘 그대로, span 검증) | 구조 데이터만, LLM만 |
| 4 | 백링크 = **같은 사례 전 회차**(첫상담 포함) 읽기 이동만 | 현재 회차만, 사례 넘어 |
| 5 | 색 = **현재 DESIGN 유지**(변화 민트·확인필요 코랄·완료 블루·불일치 코랄 배경·위험 핑크·AI 라벤더) | v6 의미로 재배정(블루/앰버/민트) |
| 6 | 표기 = **DESIGN §6 우선**(이모지 없음·명사구). 하위 3소제목·①번호·`약속:/실제 결과:/변화점:/확인된 내용:` 형식은 v6 | v6 이모지·문장형 그대로 |
| 7 | 구조화 뷰 = **팝업 수기 열 토글**, 접힘 없는 목차형. DESIGN:230(3단 아코디언 미채택) 유지 | 3단 아코디언, 별도 화면 |
| 8 | **한 초안, 한 승인**. 승인 전엔 원문만 | 단락·키워드는 즉시 표시 |
| 9 | 기존 AI 계약 **전면 교체**(현재 회차만, 나중 말·fact_changes 삭제, 카드 반영 유지, 구버전은 읽기만) | 병행 |
| 10 | 키워드 화면 = **칩 + 팝업 패널**(대조 패널 자리) | 키워드 탭 |
| 11 | **한 레인이 전부**(api·migration·web·css·문서) | 서버/UI 분리 |
| 12 | 골든 fixture = **relayer-testdata 발췌 커밋**(합성, 음성 제외) | 직접 쓴 짧은 자료만 |
| 13 | 첫상담 **포함**, 양식은 그대로(자유 글 항목만 구조화, 토글 없음) | 제외 |
| 14 | 다중 녹음 **범위 밖**, `전사 없는 녹음 N건` 결손 표시만 | 파일별 최신 전사 |
| 15 | 승인 후 `수정` = **자유 편집, 근거 해제 표시**(`사람이 고침`, 01/04 는 그대로) | 항목 단위 편집, 수정 없음 |
| 16 | `확인필요`·`완료·해결` = **v6 승인 결과로만**, 브리핑 분할 채움 폐지, 재분석은 회차별 수동 | 구버전 회차만 브리핑 유지, 일괄 재분석 |
| 17 | 수기 원본 = **memo + manual 카드 4종**, 목표는 기준·키워드로만 | memo만, 다음 목표 포함 |
| 18 | 겹치는 레인: **v6 우선** — `feat/case-memory` 의 초안 기억 주입·fact_changes 는 rebase 때 제거(표·훅은 보류 기능으로 남김), `ui/participant-card` 는 내린 뒤 rebase | 공존(보조 패널), 사례 기억 보류 |

## 실행 순서 제안 (의존성 순서)

1. **워크트리**: `.worktrees/ai-module`(`feat/ai-module-v6`, origin/main d3c024f 기준)은 인터뷰 세션이 만들어 산출물 4개를 첫 커밋으로 넣었다. 루트(detached)·`DESIGN`·`PLANNER`·`landing`·`memory` 는 건드리지 않는다. 착수 시 `git fetch` 후 `origin/main` 이 앞서 있으면 rebase. 마이그레이션 번호는 0031(origin/main 0029, `feat/case-memory` 0030) — case-memory 가 안 내렸으면 0030.
2. **도메인 검증기 + fixture** — `api/src/domain/record-analysis.ts`(span·버전·회차 검증), `structured-record.ts`(01), `session-summary.ts`(02 필터·번호·중복), `transcript-links.ts`(04·4조건). fixture 는 R2 `…/2026-09-17` 의 `manifest.json`·회차 텍스트에서 2~3 회차를 발췌(`scripts/load-dataset.mjs` 의 구조 참고). 단위 테스트를 먼저 녹색으로.
3. **마이그레이션 + `api/src/record-analysis.ts`** — `record_analyses` 표, 문장 선분할·span ID, 마스킹 후 LLM 호출(`ai.ts` 의 callModel 재사용, SYSTEM/SCHEMA 를 v6 로 교체), 검증 실패 → failed, `AI_PROVIDER=stub`. 승인 트랜잭션은 `approveDraft` 의 `replaceAiCards` 를 그대로 잇는다.
4. **API·조회** — draft/approve/analysis/backlinks 라우트, `getCaseDetail.sessions[].ai_summary` v6/legacy 분기, v6 stale(source_versions 비교), `revisions.ts` summary → summary_override. 통합 테스트 → `node scripts/check-case-access.mjs`.
5. **웹** — `api.ts` 타입, 공용 렌더러 `structured-record.tsx`·`session-summary.tsx`·`transcript-view.tsx`, `participant-info.tsx` 4구역·브리핑 분할 제거·키워드 칩, `session-original.tsx` 토글·전사 띠·대조/백링크 패널·필터, `review.tsx` v6 검토. CSS 는 `app.css` `/* ==== AI-MODULE ==== */` 구획, `--discrepancy-tint` 토큰 1개.
6. **e2e + 증거** — `AI_PROVIDER=stub` 서버, 격리 DB, `e2e/record-analysis-v6.spec.ts`, 기존 3 spec 회귀, 스크린샷 `docs/record-analysis-v6-evidence/`, coverage 스크립트.
7. **문서·보고** — SPEC §15/§16-4/§3/§17-4, GLOSSARY §6-4·§6-5·용어, DESIGN §2·요약·팝업 절, README 문구, `docs/record-analysis-v6-report.md`(T-ID 표·수동 검수·검증 대기).

## 알려진 함정 (인터뷰 중 발견, 시드에 반영됨)

- `api/src/ai.ts:215-221` `sessionParts` 가 `source_type` 없이 모든 카드를 보낸다 — `ai_approved` 재투입. manual 만.
- `api/src/service.ts:614-623` `staleFlags` 는 `session_revisions` 만 본다 — 전사 승인(`approveTranscript`)은 transcripts 행만 추가해 안 잡힌다. v6 는 source_versions 비교.
- `web/src/screens/participant-info.tsx:169-180` 확인필요·완료를 브리핑으로 채운다 — 후속 회차 완료가 과거 회차에 반영. 폐지 대상.
- `web/src/session-original.tsx:269-274` 전사 본문은 `segments.map(text).join('\n')` — segments 가 본문 전부를 덮는지 보장 안 함(T04). `stt.ts:386-393` 은 시각 없는 phrase 를 segments 에서 뺀다.
- 인테이크 `detail` 은 `Record<string, unknown>`(routes.ts:299,361) — 자유 글 키 목록을 코드에 명시해야 선택지 값이 원문으로 새지 않는다.
- 수기는 원문 저장 → 마스킹 사본 전송이라 offset 이 어긋나고, 전사는 마스킹 후 저장이라 원문 = 마스킹본. 그래서 span 은 서버가 원문에서 먼저 자르고 모델은 ID 만 받는다.
- `AI_PROVIDER` 는 openai|gemini 뿐, Playwright 는 서버 선기동 전제(`web/playwright.config.ts:3-9`) — stub 제공자 없이는 e2e 가 실 LLM 을 부른다.
- 코랄이 두 역할(확인필요 띠, 불일치 배경) — 띠/배경으로 구분하고 한 문장에 동시 표시 가능해야 한다. `--discrepancy-tint` 는 color-mix, 새 hue 아님.
- SPEC:30·GLOSSARY §6-4 는 아직 `15초 다시보기` 탭을 적는다(코드는 2026-09-17 폐지). 같이 고친다.
- `docs/relayer_v1_handoff.md` §2 표의 "마지막 마이그레이션 0024", "드로어", "15초 다시보기" 는 낡았다. 규칙 부록만 정본.
- STT 레인이 `stt.ts`·설정·마이그레이션 번호를 동시에 잡고 있다 — `stt.ts` 계약은 건드리지 않고, 번호 충돌은 rebase 시 Q 지시로.
- `feat/case-memory`(`.worktrees/memory`, 3f43eb4, 미푸시) — `ai.ts` draftSession 이 `memoryBefore()` 로 사례 기억을 붙이고 SYSTEM 이 `[사례 기억]` 로 fact_changes 를 지시한다. v6 우선(Q 18): rebase 때 `memoryBefore`·`MEMORY_HEADER` 주입과 fact_changes 를 지우고 `refreshCaseMemory`·훅·철회·감사·`case_memories` 는 남긴다(SPEC §15-6 에 '초안 입력으로 쓰지 않음' 한 줄).
- `ui/participant-card`(`.worktrees/DESIGN`, c359266, 푸시됨) — `participant-info.tsx` 4구역이 `<details>` 기반 `SeqSection`(tone) 으로, 날짜 표기가 `date-time.ts` 로 모였다. 내린 뒤 rebase 하고 4구역·빈 구역 숨김·키워드 칩은 `SeqSection` 위에 얹는다. `session-original.tsx`·`app.css`·`ui.tsx` 도 소폭 겹친다.

## 비범위 (시드와 동일)

다중 녹음 파일별 전사(T07) · 사례 넘어 백링크·목표 허브 · 단일 HTML 내보내기 · 마스킹 전 원문 저장 · 자동 재처리 · 부분 재생성·부분 승인 ·
당사자 열람 노출 · 실데이터 검증(검증 대기) · `stt.ts` 계약 변경 · 원격 push·병합·배포 · `records/` 사용.

## 확인이 필요한 사람 게이트 (구현 뒤)

- 수동 1회: relayer-testdata 1사례를 실제 LLM(기관 키 또는 env)으로 분석해 규칙 위반을 세는 검수 — 실키·비용이 든다. 자동 기준에 넣지 않았다.
- 실제 상담 자료 검수는 자료가 없어 `검증 대기`. 확보되면 별도 실행(공개 레포에 커밋 금지).
- Q 의 모델 규칙: Fable 5.1 소진 시 부계정으로 이어서 오늘 quota 소진, 작은 작업은 OPUS 인계.
