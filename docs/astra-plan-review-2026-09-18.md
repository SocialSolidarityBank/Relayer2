# ASTRA 계획 검토 종결 기록 (2026-09-18)

검토 대상은 UI 개편 계획, 온보딩 인계, STT·DB Cloud v2 seed와 현재 `main` 코드다. 최초 문서는 병렬 착수 전 P0 4건과 P1 보완을 요구했다. 아래는 현재 사실과 종결 계약이다.

## 판정

**P0-1~P0-4와 P1 계약 보완 완료.** 다음 단계는 `docs/stt-cloud-execution-plan-2026-09-18.md`의 레인 구현이며, 배포 전 통합본 검증이 필수다.

## P0-1 — 공유 파일과 의존 순서

종결:

- S3를 UI 통합 소유자로 지정했다.
- S3 소유: `web/src/api.ts`, `web/src/ui.tsx` 지정 부품(`ParticipantHero`·`participantHeroDetails`·`ConsentDetail` 및 필요한 공용 소비), `web/src/dialog.tsx`, 온보딩·설정·랜딩.
- `web/src/styles/app.css`는 S3만 수정한다.
- S1은 routes/settings/consent/service, S2b는 storage/pii/stt/documents, S2는 Azure·Infisical 프로비저닝을 소유한다.
- 소비 props와 API 서명은 `HANDOFF-STT.md`에 먼저 고정했다. 소비 레인은 임시 공용 부품이나 API 별칭을 만들지 않는다.

## P0-2 — 서버 계약 누락과 마이그레이션 번호

현재 main `0027_ui_plan_api.sql`과 구현의 실제 종결:

1. 구조화 인테이크 `detail_json`은 텍스트 리비전에 포함하지 않는다. 인테이크는 잠긴 작성 양식에서 읽고 기존 편집 경로로 수정한다. `kind:'memo'`는 `sessions.memo`만 수정한다.
2. `duration_min`은 일정 생성 `POST /cases/:id/sessions`, 기록 `PATCH /sessions/:id`, 사례/회차 상세 조회 모두에 있다.
3. 요약 수정은 `POST /sessions/:id/revisions {kind:'summary'}`가 승인 `ai_drafts` 새 행을 쌓는다. 별도 `PATCH /drafts/:id`는 만들지 않았다.
4. `PATCH /cases/:id/next-goals`는 마지막 기록 회차를 고르고 `updateNextGoal`을 재사용해 기록 전과 이미 이어받은 목표를 모두 거절한다.

`0027`은 이미 사용됐고 `0028_onboarding_step.sql`도 존재한다. STT 신규 migration은 **`0029_stt_key_voice.sql`**이다.

동의 v4 착수 조건도 보강했다. 처리자 `organization.name`을 해시에 넣으면 현재 동의 전부가 `확인 필요`가 된다. 설정 화면에는 이미 “실사용 중이면 이메일 등 정해진 방식으로 고지 후 재동의” 경고가 있다. 기관명 변경도 재동의 사유로 검증·문서화한다.

## P0-3 — align 판정 능력

종결:

- `align-check`는 중심 `x`·`y`·`xy`에만 사용한다.
- 우측 끝 `right`, 폭 `width`, 상단 `top`은 Playwright `boundingBox()`/`getBoundingClientRect()` 별도 실측 계약으로 분리했다.
- 설정 카드 행동은 `.me-profile-card`, `.org-card`, `.download-card` 등 카드별 선택자 안에서 비교한다. 전역 `.wire-card-title`/`.wire-card-action` 묶음은 금지한다.
- 당사자 카드도 각 `.participant-card`를 부모로 잡아 행동과 폭을 카드별로 잰다.
- `scripts/measure-cards.mjs`는 측정 중 `card.style.height='auto'`로 등높이 늘림을 끈다. PASS를 실제 화면의 늘어난 카드 아래 여백 증거로 읽지 않는다.

## P0-4 — 순서

고정 순서:

**계약·정본 → 통합본 검증(일회용 DB, tsc/build·measure·e2e·migrate·align) → 배포 → 운영 스모크**

공유 DB `relayer`, 운영 Supabase, 운영 체크아웃은 통합 검증에 사용하지 않는다.

## P1 — 2차 배치 사실과 완료 기준

- N1: 서버 심벌은 `service.startSession`; `ensureSession`은 `record.tsx` 클라이언트 클로저다. 기존 `session_id` 인자로 미작성 회차 이어 쓰기/새 회차를 구분하는 구현이 main에 착지했다.
- N2: `onboarding_step` 선택은 끝났다. `0028_onboarding_step.sql`과 `PUT /settings/onboarding/step`을 쓴다. 값 유무 추론은 폐기했다.
- 랜딩 설정 가이드와 설정 아코디언 진입은 S3가 함께 소유한다.
- 완료 기준: 미작성 회차 선택 e2e, 세션 중단 뒤 같은 마법사 단계 재진입, 랜딩/설정이 같은 가이드 문안 열기, tsc/build·일회용 DB e2e 통과.

## D6 동의 확인

관리자 수정 경고는 main 설정 화면에 이미 있다. 새 v4는 기관명 치환을 추가하므로, 실제 사용 전 현재 동의 전부가 `확인 필요`가 되는 경로와 이메일 등 관리자 고지 절차를 확인해야 한다. 경고 확인 없이 문안 DB화 또는 v4를 배포하지 않는다.

## PR 정리

- #61·#63: 닫음.
- #62·#64: 머지(`e4735bd`, `ae88395`).
- #65: 닫힌 checkpoint. `c4acb52`의 저장 adapter·테스트 일부는 새 자격/키 계약에 맞춰 선별 재사용 가능.
- 기준선은 이후 #66까지 포함한 `0af8903`.

## 실행 정본

- `HANDOFF-STT.md`
- `docs/handoff-stt-db-2026-09-18.md`
- `docs/stt-db-ledger-2026-09-18.md`
- `docs/stt-cloud-execution-plan-2026-09-18.md`
- `.ouroboros/seed-stt-db.yaml`
