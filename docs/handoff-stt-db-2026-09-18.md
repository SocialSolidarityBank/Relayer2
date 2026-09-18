# 인계 — STT·DB Cloud v2 계약 통합 (2026-09-18)

## 기준선과 정본

- 이 정본화는 현재 `origin/main` `0af8903`(#66)을 읽어 작성했다. 요청 시점 기준 `ae88395`(#64) 뒤에 랜딩 변경 #66이 추가됐다.
- 실행 계약: `.ouroboros/seed-stt-db.yaml`
- 결정 장부: `docs/stt-db-ledger-2026-09-18.md`
- 레인 실행 계획: `docs/stt-cloud-execution-plan-2026-09-18.md`
- UI 소비 계약: `HANDOFF-STT.md`
- ASTRA 결론: `docs/astra-plan-review-2026-09-18.md`

공유 개발 DB `relayer`, 운영 Supabase, 운영 체크아웃은 금지한다. 마이그레이션·통합 검증은 레인마다 새로 만든 일회용 DB에서만 수행한다.

## 한 줄 목표

BSS가 기관별 Azure Container App을 운영하고 기관 소유 Supabase·Azure Speech를 연결한다. BSS 운영자는 결정적 명령 하나로 배포를 만들고, 첫 관리자는 Speech 키 1회 입력과 녹음 토글만 수행한다. 음성·문서는 `PII_ENC_KEY`로 앱 수준 암호화해 Blob에 저장한다.

## 공유 소유자 계약 — ASTRA P0-1 종결

| 레인 | 단독 소유 파일·영역 |
|---|---|
| S1 backend | `api/src/routes.ts`, `settings.ts`, `consent.ts`, `service.ts`, `audit.ts`, `migrations/0029_stt_key_voice.sql` |
| S2b storage | `api/src/storage.ts`, `pii.ts`, `stt.ts`, `documents.ts`, 저장 통합 테스트 |
| S2 provisioning | `scripts/azure/**`, `scripts/infisical_get.py`, `scripts/infisical_put.py`, 프로비저닝 테스트와 런북 |
| S3 UI integration | `web/src/api.ts`, `web/src/ui.tsx` 지정 부품, `web/src/dialog.tsx`, `ConsentDetail` 소비 화면, 온보딩·설정·랜딩, UI/e2e |

`web/src/styles/app.css`는 S3만 수정한다. 소비 props와 HTTP/API 서명은 구현보다 먼저 `HANDOFF-STT.md`에 고정했다. 다른 레인은 공용 UI나 API 복제본을 만들지 않는다.

## Q 결정 — 되묻지 않는다

1. 기관당 배포 1개. BSS가 ACA `koreacentral`에서 운영한다.
2. DB는 기관 소유 Supabase 서울 Pro. 기관이 BSS를 조직 Owner로 초대하고 BSS가 세션 풀러 `pooler.supabase.com:5432` 문자열을 얻는다.
3. STT는 기관 소유 Azure Speech. 지역 입력 없이 `koreacentral` 고정, 관리자 키 1회 입력.
4. 녹음 스위치는 `organization.voice_enabled`; 키 저장과 별개. `null`만 env 폴백.
5. 음성·문서는 Azure Blob, ACA managed identity + `Storage Blob Data Contributor`, 앱 수준 암호화 키는 기존 `PII_ENC_KEY`.
6. `voiceEnabled()`·`sttEnabled()`는 DB 우선 비동기 읽기. 프로세스 캐시 없음.
7. 동의 문안 처리자는 `organization.name`, 수탁자는 사회연대은행, 리전은 한국 중부. 코드 판은 v4.
8. Infisical `prod:/RELAYER2/<slug>`가 기관 비밀의 단일 정본. `PII_ENC_KEY` 손실은 복구 불가.
9. 프로비저닝은 `scripts/azure/provision-institution.sh <slug>` 하나. DRY-RUN 기본, 값 출력 없음.
10. 맥미니 파일 이전은 실데이터가 없어 비범위이며 새 스크립트를 만들지 않는다.

## 현재 main이 이미 닫은 UI 계약 4건 — ASTRA P0-2

`0027_ui_plan_api.sql`과 현재 코드가 다음처럼 종결했다. STT 신규 계약은 이 위에 `0029`로만 붙인다.

1. **구조화 인테이크 수정 범위**: `session_revisions.kind='memo'`는 `sessions.memo`만 바꾼다. `detail_json`·카드·다음 목표는 단일 텍스트 리비전 대상이 아니다. 인테이크 원본은 `IntakeScreen readOnly`에서 읽고 기존 인테이크 수정 경로로 이동한다. 일반 상담의 카드·다음 목표도 `기록 수정` 경로가 맡는다.
2. **duration 생성·조회**: `POST /cases/:id/sessions`와 `PATCH /sessions/:id`가 `duration_min`을 받는다. `GET /cases/:id/detail`, `GET /sessions/:id`, `GET /sessions/:id/detail`이 값을 반환한다. 생략은 기존 값 유지, `null`은 삭제, 0 이하는 400이다.
3. **요약 revision**: 별도 `PATCH /drafts/:id`를 만들지 않았다. `POST /sessions/:id/revisions {kind:'summary', text}`가 승인된 `ai_drafts` 행의 나머지 필드를 보존해 새 승인 행을 쌓고 `session_revisions` 로그를 남긴다. 기존 `POST /sessions/:id/draft/approve`는 초안 승인·편집 경로로 유지한다.
4. **next-goal 거절 경계**: `PATCH /cases/:id/next-goals {lines}`는 마지막 기록 회차를 고르고 기존 `updateNextGoal`을 호출한다. 기록 회차가 없거나 대상이 기록 전이면 409, 다음 회차가 이미 목표를 이어받았으면 409다. 줄은 빈 줄을 제거해 기존 `next_goal_text`에 `\n`으로 저장한다.

마이그레이션 번호: `0027_ui_plan_api.sql`과 `0028_onboarding_step.sql`이 이미 존재한다. 신규 파일은 전부 **`migrations/0029_stt_key_voice.sql`**로 쓴다.

## 동의 v4 착수 조건

현재 코드는 `CODE_COPY_VERSION='consent-standard-form-v3'`이고 해시에 기관명이 없다. S1은 처리자를 `organization.name`으로 치환하고 기관명을 `canonicalPreimage`에 포함해 v4로 올린다. 그 순간 기관명까지 포함한 현재 해시와 과거 해시가 달라져 **현재 동의 전부가 `확인 필요`**가 된다.

착수 전 확인 사항:

- 기존 동의 상태가 모두 `확인 필요`로 바뀌는 통합 테스트.
- 설정 › 동의서 관리의 기존 경고 유지: 실사용 중이면 이메일 등 정해진 절차로 고지한 뒤 재동의.
- 기관명 변경도 새 동의 문안으로 취급되어 재동의가 필요함을 운영 문서에 명시.
- 재동의 전에는 해당 동의가 필요한 음성·STT 기능이 잠기는 것을 확인.

## align·measure 계약 — ASTRA P0-3

`align-check`는 `x`·`y`·`xy` 중심 비교만 지원한다. `right`·`width`·`top`을 `x`나 `y`로 바꿔 쓰지 않는다. 다음은 Playwright `boundingBox()`/브라우저 `getBoundingClientRect()`로 별도 실측한다.

| 요구 | 카드별 기준 |
|---|---|
| 당사자 카드 행동 우측 끝 | 각 `.participant-card` 안에서 행동 묶음과 머리의 `right` 비교 |
| 목록 카드 폭 | 각 `.participant-card`와 `.participant-list`의 `left`·`right`·`width` 비교 |
| 기록 2열·원본 팝업 2열 | 각 부모 안 직계 열 둘의 `width` 비교 |
| 다음 목표 스테퍼·배정 요청 카드 상단 | 해당 행/묶음 안 형제의 `top` 비교 |
| 설정 카드 제목·행동 | `.me-profile-card`, `.org-card`, `.download-card` 등 카드별 선택자 안에서 비교 |
| 동의 카드 간격 | 같은 목록의 인접 카드별 `next.top - current.bottom` 비교 |

중심 정렬만 `align-check axis=y`를 쓴다. 전역 `.wire-card-title`/`.wire-card-action` 묶음 선택자는 금지한다. `scripts/measure-cards.mjs`는 실측 중 카드 인라인 높이를 `auto`로 바꾸므로, 그 PASS는 등높이 카드가 실제 화면에서 늘어난 뒤의 아래 여백을 증명하지 않는다. 실제 높이 상태의 아래 여백은 별도 bounding-box 실측으로 판정한다.

## 실행 순서 — ASTRA P0-4

**계약·정본 → 통합본 검증(일회용 DB, tsc/build·measure·e2e·migrate·align) → 배포 → 운영 스모크**

레인별 검증만으로 배포하지 않는다. 배포 전 통합본에서 `migrate --check`, API 통합 스위트, web tsc/build, `measure-cards`, e2e `--workers=1`, align-check와 별도 bounding-box 계약을 모두 수행한다.

## P1 종결 사실

- N1 심벌: 서버는 `api/src/service.ts`의 `startSession(caseId, {session_id? ...})`; 클라이언트는 `web/src/screens/record.tsx`의 `ensureSession(): Promise<number>` 클로저다. `ensureSession`은 서버 심벌이 아니다. 미작성 회차 이어 쓰기는 클라이언트가 기존 `session_id`를 `startSession`에 넘기는 방식으로 main에 착지했다.
- N2 재진입: `migrations/0028_onboarding_step.sql`, `settings.onboardingState`, `PUT /settings/onboarding/step`, `Me.onboarding_step`으로 확정됐다. 값 유무 추론은 쓰지 않는다.
- 랜딩 설정 가이드와 설정 아코디언의 가이드 진입은 S3 소유다.
- P1 완료 기준: 미작성 회차 이어 쓰기/새 회차 선택 e2e, 중단 후 마법사 동일 단계 재진입, 랜딩과 설정에서 같은 가이드 문안 열기, tsc/build·일회용 DB e2e 통과.

## 기존 PR 처리 기록

- #61 `docs/next-designs`: 닫음. 새 STT·DB 정본과 충돌하는 별도 seed를 병합하지 않는다.
- #63 `infra/azure-cutover`: 닫음. 만든 Azure 자원은 사실 기록으로만 남고, 구 connection-string/계정키 계약은 새 managed identity 계약에 우선하지 않는다.
- #62 `data/curated-dataset`: `e4735bd`로 머지.
- #64 공개 v0.2.0 준비: `ae88395`로 머지.
- #65 Blob checkpoint: 닫음. 커밋 `c4acb52`는 재사용 가능하되 `DefaultAzureCredential`·`BLOB_ACCOUNT`·직접 `PII_ENC_KEY` 계약으로 고친 뒤 선별 적용한다. 체크포인트의 migration 번호나 계정키 계약을 가져오지 않는다.

## 확인 게이트

- 실제 Speech 키 전사 1건과 Blob 암호문 1건은 구현·통합 검증 뒤 수동 운영 스모크에서 확인한다.
- 실제 기관 프로비저닝 `APPLY=1`과 배포·DNS는 별도 운영 승인 경계를 따른다.
- 배포 전까지 공유/운영 DB와 운영 체크아웃을 건드리지 않는다.
