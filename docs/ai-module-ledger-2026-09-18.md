# RELAYER2 — AI 작동 모듈(v6 분류 + LLM 위키 구조화) 인터뷰 장부 (Path B, 2026-09-18)

Ouroboros MCP 없음 → Path B(대화 맥락 장부). 세션 ID·측정 점수 없음. 코드 수정 없음.

## 원 요청 (Q)
AI 작동 모듈 2종을 이번에 구현한다. 당사자 카드의 `회차별 요약`·`회차별 원본 보기`에 표현되는 정보의 핵심 로직이며 AI·STT가 존재하는 이유다.
1. 상담 내용(수기 기록 + 녹음 기록)을 `docs/relayer_v1_handoff.md`의 v6 규칙(01 구조화된 상담기록, 02 회차별 요약, 04 전사 하이라이트·연결, 별첨 불일치)으로 분류한다. 핵심은 목표 중심 정리, 우선순위가 모호할 땐 목표 기준. 분류 결과의 색은 릴레이어 컬러 규칙 핵심 6색 안에서 쓴다.
2. LLM 위키 방식 정보 구조화 + 백링크로 키워드·맥락별 문장을 모아 준다. 구조화 대상은 원본. `회차별 원본 보기`를 먼저 시각적으로 구조화(맥락에 맞게 짧은 문장~긴 문단 단위로 쪼갬) → 쪼갠 단락을 요약 → `회차별 요약`.

## 바탕 사실 (코드, origin/main ee7a396)
- 루트 체크아웃 f282f4c detached(stale). 원격 `origin/main` ee7a396이 기준. UI 개편 L1~L5(#52~#60) 병합 완료. `.worktrees/DESIGN`(ui/2026-09-18)·`PLANNER`·`landing` 존재. 진행 중 원격 브랜치: `feat/stt-db-cloud-core`, `feat/blob-storage`, `feat/blob-managed-identity`, `infra/institution-provision`, `ui/stt-connection-wizard` — `api/src/stt.ts`·설정 경로를 건드림.
- `docs/relayer_v1_handoff.md`는 루트 미커밋 파일(origin/main에 없음). 분석 기준 70beaaa는 UI 개편 이전이라 `session-original.tsx`(드로어→팝업)·`participant-info.tsx`·리비전 설명이 낡음. 규칙 부록(01·02·04·별첨·공통 HTML)은 정본. ui-plan D10이 "하이라이터·백링크(LLM 위키)는 범위 밖, 팝업·요약 구현 뒤 별도 설계"라 적었고 이번이 그 설계다.
- `web/src/screens/participant-info.tsx:50` 탭 4: `당사자 정보 · 회차별 요약 · 회차별 원본 보기 · 목표`. 회차 카드 4구역 `이번 상담의 핵심`(is-ai 라벤더)·`확인된 변화`(is-change 민트)·`확인필요`(is-warn 코랄)·`완료·해결`(중립) + 조건부 `위험 신호`(--risk)·`기록 상태`. 빈 구역은 `AI 정리 없음`/`달라진 사실 없음`/`확인할 것 없음`/`완료된 것 없음` 문구로 표시. 확인필요·완료는 `getBriefing` 과제·질문을 `source_session_seq`로 갈라 채움(:169-180) — 후속 회차 완료가 과거 회차에 반영되는 구조. 버튼 `AI 정리 보기|검토|다시 하기`(→ `/review`), `수기 원본 보기`, `녹음 전사 기록 보기`, `수정`(요약 편집 → `POST /sessions/:id/revisions kind=summary`).
- `web/src/session-original.tsx`: `Dialog size="wide"` 2열(`written`|`voice`), 편집 모드 `Revisable`(memo/transcript) + `수정 기록 N`, 인테이크 회차는 `<IntakeScreen readOnly/>`. 수기 열 순서: `오늘 상담 내용`(memo) → 카드 `수행할 과제`·`다음에 물어볼 것`·`실무자 의견`·`확인한 사실` → `다음 상담 목표`. 전사 열: 녹음 목록+오디오, `전사문` + `확인 전` 배지 + `자동 전사라 틀린 곳 있음` + segments(seek 버튼) + 본문 편집. 3단 구조·하이라이트·대조 패널·필터·키워드 없음.
- `api/src/ai.ts`: PROVIDER openai(gpt-5.5, responses API, json_schema strict) | gemini. SYSTEM에 `나중 말` 규칙(:53), `[지난 회차]` fact_changes(:64-67). Shape `summary/changes/tasks/questions/fact_changes`. `sessionParts`는 `source_type` 필터 없음(ai_approved 카드 재투입). `draftSession`은 지난 done 회차 전부 마스킹해 전송(:252-268). 동의 게이트 `external_llm_cross_border_processing`. `approveDraft`: 새 `ai_drafts(status=approved)` 행 + `replaceAiCards`(tasks→promise, questions→question, `ai_approved`). 감사 `ai.draft`·`ai.approve`.
- `api/src/revisions.ts` + `migrations/0027`: `session_revisions(kind memo|transcript|summary, text, actor)` append-only. `staleFlags`: ai_summary = memo/transcript 리비전 > 마지막 ai_drafts; mismatch = memo 리비전 > 마지막 approved transcript. 전사 승인(`approveTranscript`)은 transcripts 행만 추가해 기존 플래그로는 잡히지 않음. 자동 재처리 없음.
- `api/src/service.ts`: `getSessionRecord`(cards에 id·source_type 없음), `approvedSummaries`(distinct on session_id, approved만), `getCaseDetail`(overall_goal, today_goal_text, pending_next_goal, goal_revisions, ai_summary, stale, open_cards), `getMismatches`(현재 memo + 회차 최신 전사 + 직전 회차 memo → `buildMismatches` 숫자 비교, voice_vs_written / across_sessions).
- `api/src/stt.ts`: `transcripts(status draft|approved, text·segments 암호화, mask_hits, engine)` append-only, 회차 최신 1행(`order by id desc limit 1`), recording_id 1개에 묶임. segments `{text, offset_ms, duration_ms}` 화자 없음, 시각 없는 phrase는 segments에서 빠짐. 다중 녹음은 recordings에만. 마스킹 후 저장(마스킹 전 원문 없음).
- 인테이크 `detail`은 `Record<string, unknown>`(routes.ts:299,361) — 선택지 값과 자유 글이 섞여 있어 자유 글 키 목록을 명시해야 함.
- 색 토큰(`web/src/styles/tokens.css`): 블루·민트·라벤더(base/deep/tint), `--lime-deep`, `--discrepancy #AC5346`(내용 불일치 전용 코랄), `--risk #B52573`(확인된 리스크 전용). 배지 면 `--badge-blue/mint/lavender/coral/amber/lime/cyan/light-magenta`. DESIGN.md:442-443 라벨 규칙(민트=사람·진행, 라벤더=AI, 블루=시간·상태, 코랄=주목·경고, 핑크=리스크). DESIGN.md:206 이모지 제목 불사용, :230 팝업 안 3단 아코디언 미채택. DESIGN §6 화면 문구 명사구·마침표 없음.
- 위키·백링크·키워드: 앱 코드에 없음(사이트 `준비 중` 문구만). 테스트용 LLM 스텁 제공자 없음(`AI_PROVIDER` openai|gemini). Playwright는 서버 선기동 전제.
- 합성 자료: `relayer-testdata` 2026-09-17판(C01·C02·C03·C08·C10, 72회차·65녹음·66수기) 외부 R2 `https://pub-0acad9da70b54900924fea276388490a.r2.dev/2026-09-17`, 로더 `scripts/load-dataset.mjs`(레포에 자료 미포함). 레포 fixture는 한두 줄 메모(`api/test/mismatch.test.ts` 등). `records/`는 실인물 녹음 — 절대 사용 금지.
- SPEC.md §15 AI 텍스트 경로(승인이 곧 기록, 버튼 승인/수정 둘), §16-4 회차간 기록 불일치, §17-4 리비전. GLOSSARY §6-4·SPEC:30은 아직 `15초 다시보기` 탭을 적음(코드와 어긋남, 이번 갱신 대상).
- 검증 체계: `pnpm --dir api exec vitest run`, `node scripts/check-case-access.mjs`(일회용 DB 통합), `pnpm --dir web exec tsc --noEmit`, `pnpm --dir web build`, Playwright(API 8787·web 5173·로컬 DB), align-check. 공유 DB `relayer`(:55432)에 브랜치 마이그레이션 금지(루트는 `relayer_root`·PORT 8799 관례). 마이그레이션은 0028까지 존재(STT 레인도 번호를 잡는 중 — 착수 시 재확인).

## 확정된 결정 (Q 답)
1. 요청 정리 확인: 그대로.
2. 목표 중심: 01 계층(큰 주제→세부 단락)은 수기 시간순 유지. 목표(전체 상담 목표 + 회차 목표 둘 다)는 (a) 시간 흐름이 없거나 섞여 순서가 모호한 단락의 묶음·배치 기준, (b) 02 `이번 상담의 핵심` 선별과 하위 항목 우선순위의 1순위 기준. '뒤 문장을 앞으로 옮기지 않음' 유지. 요약 항목에 어느 목표와 연결되는지 표시(`전체 목표`/`N회차 목표` 구분).
3. 녹음 기록: v6 그대로 — 사실 확정·요약·01 상태의 근거는 수기만. 전사는 문장 연결·불일치 대조·01 상태 상속만. 전사만으로 새 사실·색 금지.
4. 키워드 = 구조 데이터(전체/회차 목표, 수기 과제·질문 카드 등) 결정적(서버 계산) + LLM 추출 어휘(인물·기관·서비스·사건, 수기 원문 어휘 그대로, 서버가 원문 span으로 검증).
5. 백링크 범위: 같은 사례의 모든 회차(첫상담 포함) 읽기 이동. 분석·변화 판정에는 미사용(회차 격리 유지). 사례 넘어 금지.
6. 색: 현재 DESIGN 유지 — 변화=민트, 확인필요=코랄, 완료·해결=블루(상태 축; 요약 구역 제목은 지금 중립이므로 띠 색으로 블루 채택), 불일치=코랄(--discrepancy) 배경, 위험=핑크(--risk), AI 라벨=라벤더. 같은 색이 요약 구역·01 상태 띠·04 전사 띠에 공통. 확인필요 띠(코랄)와 불일치 배경(코랄 혼합)은 띠/배경으로 구분하고 한 문장에 동시 표시 가능.
7. 고정 표기: DESIGN §6 우선 — 이모지 제목 없음(색 띠+제목 `이번 회차에서 확인된 변화`·`확인필요`·`완료·해결`), 안내문 명사구(`자동 전사라 틀린 곳 있음`, `전사문 없음`). 하위 3소제목(`약속 이행 여부`·`상담 중 새로 드러난 것`·`이번 상담 후 새로운 가능성`)·①②③ 연속 번호·`약속:/실제 결과:/변화점:/확인된 내용:/∴` 형식·빈 항목 숨김은 v6 그대로.
8. 구조화 뷰: 원본 팝업 수기 열에 `원문 그대로 | 구조화` 토글(승인 분석이 있을 때만). 구조화 = 접힘 없는 목차형(주제 제목→단락 제목→원문 단락 전부 펼침, 상태 띠, 키워드 칩). 전사 열 = 전문 + 상태 띠 + 불일치 하이라이트, 문장 클릭 → 대조 패널(`차이점/녹음 내용/수기 내용/연결된 수기 단락`), `기록 불일치 모아보기` 필터. DESIGN:230 유지.
9. 승인: 한 초안, 한 승인 — 기존 `AI 정리 검토` 화면에서 단락 구조·상태·키워드·전사 연결·불일치·요약을 함께 검토·승인. 승인 전엔 원문만(구조화·요약 없음). 원본 수정 시 기존 stale·`AI 정리 다시 하기` 재사용.
10. 기존 AI 계약: 전면 교체 — 새 초안은 v6 구조만, 현재 회차만 전송, `나중 말` 규칙·`[지난 회차]`·fact_changes 삭제. 과제·질문 카드 반영 트랜잭션 유지. 기존 승인 데이터는 구버전으로 읽기만. 회차 간 비교(FactChanges 표·across_sessions)는 새 초안·새 화면에서 생성·표시 안 함(기존 데이터 삭제 안 함). SPEC §15·§16-4 개정.
11. 키워드 화면: 요약 카드 하단 + 팝업 구조화 뷰에 키워드 칩. 클릭 → 팝업 우측(모바일 하단) 패널에 같은 사례 모든 회차의 해당 문장 목록(회차·단락), 항목 클릭 → 그 회차 팝업의 단락으로 이동. 대조 패널과 같은 자리.
12. 레인: 한 레인이 전부(api·migration·web·css·SPEC/GLOSSARY/DESIGN). 새 워크트리 origin/main 기준(`.worktrees/ai-module`, `feat/ai-module-v6`). 원격 push·병합·배포는 별도.
13. 골든 케이스: relayer-testdata에서 2~3 회차 텍스트(수기+승인 전사) 발췌해 `api/test` fixture로 커밋(음성 제외). 테스트의 LLM은 스텁.
14. 첫상담 기록: 포함, 양식은 그대로 — 참고 메모·자유 글 항목만 단락 구조·상태·키워드 대상. 요약 4구역 동일. 팝업 수기 열은 양식 그대로(토글 없음). 첫상담의 01 구조는 검토 화면에서만 보임.
15. 다중 녹음: 범위 밖 — 회차 최신 승인 전사 1건 유지. 녹음이 여럿이면 `전사 없는 녹음 N건` 결손 표시. `stt.ts` 계약 불변(STT 레인 충돌 회피).
16. 수용 기준: (1) 자동 — vitest·check-case-access(통합, 일회용 DB, LLM 스텁)·tsc·build·새 `e2e/record-analysis-v6.spec.ts`·기존 e2e 회귀, 핸드오프 T01~T38 중 범위 안 항목을 테스트 ID로 대응. (2) 브라우저 증거 — 토글·상태 띠 계산 스타일·전사 문장 클릭→대조 4항목 갱신·키워드 칩→백링크 이동·불일치 필터·390px·인쇄 스크린샷, pageerror 0. (3) 원문 무손실 — hash·문자 수·span coverage 보고. (4) 수동 1회 — relayer-testdata 1사례 실제 LLM 분석, 규칙 위반(어휘 치환·이전 회차 참조·전사 단독 확정) 수검 보고. (5) 실제 상담 자료 검수는 `검증 대기`.
17. (게이트 HIGH-1) 승인 후 `수정`: 자유 편집 허용. 편집된 요약은 항목의 span 근거·목표 연결이 해제되고 `사람이 고침` 표시(원문 이동 없음). 01 구조·상태 띠·전사 연결·키워드는 승인 분석 그대로(요약 편집이 원본 분석을 건드리지 않음).
18. (게이트 HIGH-2) `확인필요`·`완료·해결` 구역은 해당 회차의 v6 승인 분석에서만 채움. 브리핑 open/closed 분할 채움 폐지. v6 분석이 없는 회차는 구버전 요약이 있으면 `이번 상담의 핵심`에 `구버전 정리` 표시로만, 없으면 `AI 정리 없음` + `AI 정리 검토`. 재분석은 회차별 수동. 과제 이행 이력은 상담 기록·목표 탭 기존 기능으로 유지.
19. (게이트 HIGH-3) 일반 회차의 수기 원본 = `sessions.memo` + `source_type=manual` 카드 4종(과제·질문·의견·사실) 각각 SourceDocument, 팝업 수기 열 순서 그대로. 목표 텍스트는 기준·키워드로만(원문 단락 아님). `ai_approved` 카드 제외.
20. (커밋 직전 게이트, origin/main d3c024f) 겹치는 레인 둘 발견. `feat/case-memory`(`.worktrees/memory`, 3f43eb4 미푸시)는 `ai.ts` draftSession에 '사례 기억' 요약을 주입해 fact_changes를 계속 만든다 → **v6 우선**: case-memory가 먼저 내리면 v6 레인이 rebase하며 기억 주입·fact_changes를 제거, `case_memories` 표·훅·철회·감사는 소비자 없는 보류 기능으로 남김. `ui/participant-card`(`.worktrees/DESIGN`, 푸시됨 c359266)는 `participant-info.tsx` 4구역을 `SeqSection`으로 개편 → 내린 뒤 rebase, 4구역은 그 위에 얹음. 마이그레이션은 0031(case-memory 미반영 시 0030). 기각: 공존(기억을 검토 화면 보조 패널로), 사례 기억 보류.
21. (병합 시점, origin/main 688a331) 작업 중 main 이 같은 화면을 재작성함(#92·#96·#97·#100: 3탭, 요약 아코디언 카드, 행동 버튼 4개·요약문 편집 삭제, 원본 팝업 = 기록지 embedded + 전사 맥락 블록, 근거 하이라이터 모달). Q 결정: **main 화면 우선** — 결정 17 개정: 승인 후 요약 편집 진입점 없음(`summary_override` 는 API·읽기 전용 표시만). v6 화면은 main 구조 위에 재조립(아코디언 안에 4구역, 근거 하이라이터를 span 근거로 교체, 기록지 위 `구조화` 토글, 맥락 블록 안 문장 띠·불일치·대조 패널, 키워드 칩·근거 링크가 팝업 진입점). 사례 기억(main 에 병합됨)은 결정 20대로 초안 입력에서 제거하고 구 draftSession 경로 삭제. `.worktrees/DESIGN` 파일 미수정.
22. (두 번째 병합, origin/main 5044911) main 에 #102 `항목별 근거(인용·맥락·등급·변환) + 놓친 구간`이 구 초안 경로(`ai_drafts.evidence`, `migrations/0031_ai_drafts_evidence.sql`, `verifyEvidence`)로 내려 v6 와 경쟁. Q 결정: **v6 안으로 흡수** — 요약 항목에 `grade`(완전·부분·정황·과잉·모순·없음)·`transforms`(`EVIDENCE_GRADES`/`EVIDENCE_TRANSFORMS` 재사용)를 모델이 같은 호출에서 매기고, `놓친 구간`은 서버가 결정적으로 계산(`omissionsOf`: 어떤 요약 항목도 참조하지 않은 수기 단락, `body.omissions`). 근거 모달은 #102 모양(프런트매터 항목·출처·자료·등급·변환 + 맥락 카드) 위에 v6 span `mark`. 구 초안 경로·`verifyEvidence`·`ai-evidence.test.ts` 삭제, `ai_drafts.evidence` 는 읽지 않음. v6 마이그레이션 0031→**0032**. 병합 끝날 때까지 `ai.ts`·`participant-info.tsx`·`review.tsx`·`session-original.tsx` 는 다른 세션이 건드리지 않기로(Q 동결).

## 수용 게이트 결과 (closer/contrarian/gap_hunter)
- contrarian·gap_hunter 회수, closer 응답 없어 취소 후 closer 기준을 메인에서 적용. HIGH 3건 → 결정 17~19로 종결 → seed_ready. Restate 승인(2026-09-18).
- MEDIUM 기본값(시드에 고정): 전사 승인 후 stale = 분석의 소스 버전 묶음(memo 리비전·카드·최신 approved transcript id) ≠ 현재; 결정적 키워드는 서버 계산, LLM 입력은 현재 회차 마스킹 텍스트 + 목표 텍스트만, 카드는 manual만; 수기 내 자기정정(같은 회차 '3건→4건')은 원문 보존 + 상태 판정은 최종 서술 기준(v6에 없는 규칙임을 명시); 서버가 원문을 문장 단위로 선분할해 span ID·UTF-16 offset 부여, 모델은 마스킹 텍스트+span ID만 받고 반환 복제 문자열은 검증용; 백링크 조회는 사례의 승인 분석 본문 스캔(별도 인덱스 표 없음, caseAccess + `case.detail` 감사 재사용); 테스트용 `AI_PROVIDER=stub`(동의 게이트 유지, callModel만 단락); T-ID in/out 표(T07 out); 인테이크 자유 글 키 목록 명시; 백링크 코퍼스는 수기 구조 단락만; hash는 저장 문자열 그대로(정규화 없음); 부분 재생성 없음(전체 재생성).

## 범위 밖 (명시)
- 독립 단일 HTML 내보내기. 사례 넘어 백링크·목표 허브 페이지. 다중 녹음 파일별 전사. 마스킹 전 원문 저장(STT 저장 경계 변경). 자동 재처리. 부분 재생성·부분 승인. 실데이터 검증(검증 대기). 원격 push·병합·배포. `records/` 사용. 당사자 열람 화면의 분석 노출.
