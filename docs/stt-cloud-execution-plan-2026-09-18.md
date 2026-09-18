# STT·DB Cloud v2 실행 계획

> **실행 작업자:** 이 문서와 `.ouroboros/seed-stt-db.yaml`, `HANDOFF-STT.md`를 함께 읽고 레인별 소유 경계를 지킨다.

**목표:** 기관별 ACA 앱이 기관 소유 Supabase·Azure Speech와 연결되고, 키 1회 입력·녹음 토글·암호화 Blob 저장까지 관리자와 운영자의 최소 액션으로 동작하게 한다.

**구조:** S1이 DB·설정·동의·비동기 게이트를, S2b가 저장 adapter와 음성·문서 연결을, S2가 Azure/Infisical 프로비저닝을, S3가 공용 UI·API 소비·랜딩 가이드를 소유한다. 통합 후 일회용 DB와 로컬 Blob/Azurite에서 전체 계약을 검증한 다음에만 배포한다.

**기술:** TypeScript, Hono, PostgreSQL 17, React, Vite, Playwright, Vitest, Azure Blob SDK, DefaultAzureCredential, Azure CLI, Infisical HTTP API.

**정본:** `.ouroboros/seed-stt-db.yaml`

## 전역 제약

- 운영 체크아웃, 공유 DB `relayer`, 운영 Supabase 금지. 모든 DB 검증은 새 일회용 DB.
- 신규 migration은 `migrations/0029_stt_key_voice.sql` 하나.
- `web/src/styles/app.css`는 S3만 수정.
- Speech/DB/PII 키는 argv·응답·감사·로그·PR 본문에 출력하지 않음.
- 기본 DRY-RUN. 실제 프로비저닝·배포·DNS는 별도 승인 경계.
- 실행 순서: **계약·정본 → 통합본 검증 → 배포 → 운영 스모크**.

---

## Task 1 — S1 backend: STT 설정·비동기 게이트·동의 v4

**소유 파일**

- Create: `migrations/0029_stt_key_voice.sql`
- Modify: `api/src/routes.ts`, `api/src/settings.ts`, `api/src/consent.ts`, `api/src/service.ts`, `api/src/stt.ts`의 S1 호출 경계, `api/src/audit.ts`
- Test: `api/test/stt-key.integration.test.ts`, `api/test/voice-toggle.integration.test.ts`, `api/test/consent-copy.test.ts`, 기존 consent/voice 테스트

**인터페이스**

- Produce: `PUT /settings/stt-key`, `PUT /settings/voice`, 확장 `GET /settings/connections`
- Produce: async `voiceEnabled()`·`sttEnabled()`, DB Speech 키 조회 함수
- Consume: `HANDOFF-STT.md` HTTP/TypeScript 계약

**구현**

1. `organization.enc_speech_key text`, `organization.voice_enabled boolean null`을 0029에 추가한다.
2. `setAiKey` 패턴으로 Speech 키를 `koreacentral issueToken`에 검증한 뒤 `encryptPii` 저장한다. `null`은 DB 값 삭제. 관리자 전용, 실패 400 무저장.
3. 녹음 토글을 DB에 저장하고 `stt.key.set`, `voice.toggle`을 `AUDIT_KINDS`에 등록한다.
4. `voiceEnabled()`·`sttEnabled()`와 모든 호출자를 async로 전환한다. DB 값 우선, `null`/키 없음에만 env fallback. `transcribeAudio`의 직접 env 읽기를 제거하고 pending 전사 게이트를 try 안으로 옮긴다.
5. `connections.stt`와 `connections.voice`를 `HANDOFF-STT.md` 타입으로 반환하고 DB 상태는 실제 `select 1`로 판정한다.
6. `CODE_COPY_VERSION`을 v4로 올리고 처리자 `organization.name`, 수탁자 사회연대은행, 고정 리전을 문안과 `canonicalPreimage`에 포함한다.
7. v3 동의 사건을 만든 뒤 기관명 포함 v4에서 현재 동의가 모두 `확인 필요`가 되고 기능 게이트가 잠기는 통합 테스트를 둔다. 같은 기관명 해시는 안정적이고 기관명 변경 시 달라져야 한다.

**완료 판정**

```bash
RELAYER_INTEGRATION=1 pnpm --dir api exec vitest run \
  test/stt-key.integration.test.ts \
  test/voice-toggle.integration.test.ts \
  test/consent-copy.test.ts --reporter=basic
```

관찰값: 잘못된/타 리전 키 400 무저장, 관리자 성공, 실무자 403, 키 무노출, 토글 active domains 반영, v4 재동의 경계.

## Task 2 — S2b storage: 암호화 저장 adapter

**소유 파일**

- Create/Modify: `api/src/storage.ts`
- Modify: `api/src/pii.ts`, `api/src/stt.ts`, `api/src/documents.ts`, 필요한 읽기 응답 경계
- Test: `api/test/storage.integration.test.ts`, `api/test/storage-azurite.integration.test.ts`, `api/test/documents.integration.test.ts`, 기존 voice/withdraw 테스트

**인터페이스**

```ts
put(container: 'voice' | 'documents', relPath: string, bytes: Uint8Array): Promise<void>
get(container: 'voice' | 'documents', relPath: string): Promise<Uint8Array>
del(container: 'voice' | 'documents', relPath: string): Promise<void>
exists(container: 'voice' | 'documents', relPath: string): Promise<boolean>
```

**구현**

1. #65 checkpoint `c4acb52`에서 storage 경계, 스트림 수명 처리, Azurite 테스트를 선별 적용한다. 커밋 전체 cherry-pick은 금지한다.
2. 계정키/connection string을 제거하고 Azure backend는 `BLOB_ACCOUNT` + `DefaultAzureCredential`만 쓴다.
3. HKDF 파생 키를 제거하고 `PII_ENC_KEY` 32바이트를 기존 AES-256-GCM 형식과 일관되게 바이너리 암복호에 사용한다.
4. `stt.ts`·`documents.ts`의 직접 fs 읽기/쓰기/삭제/sweep를 adapter로 교체한다. 평문 기준 bytes/sha256은 유지한다.
5. fs와 Blob 모두 저장 바이트가 평문과 다르고 읽으면 원문이며, 철회·보유기간 sweep가 실제 객체를 지우는지 검증한다.

**완료 판정**

```bash
RELAYER_INTEGRATION=1 pnpm --dir api exec vitest run \
  test/storage.integration.test.ts \
  test/storage-azurite.integration.test.ts \
  test/voice.test.ts \
  test/documents.integration.test.ts \
  test/voice-withdraw.integration.test.ts --reporter=basic
```

## Task 3 — S2 provisioning: 기관별 Azure·Infisical 결정적 실행

**소유 파일**

- Create: `scripts/azure/provision-institution.sh`, `scripts/azure/provision-institution.test.sh`
- Modify: `scripts/infisical_put.py`, `scripts/infisical_get.py`, `scripts/check-case-access.mjs`
- Replace/remove after cutover: 구 `scripts/azure/provision.sh`
- Modify docs: `docs/azure-migration.md`, `docs/institution-setup.md`, `docs/secrets.md`, `docs/deploy.md`

**구현**

1. stdin 비표시로 Supabase 문자열을 받고 `pooler.supabase.com:5432`와 `select 1`을 검증한다. 6543과 직접 IPv6 호스트는 정해진 문장으로 거절한다.
2. PII/세션 키를 생성하고 `/RELAYER2/<slug>` 부모→자식 폴더를 ensure한 뒤 `--skip-if-exists`로 기존 이름을 덮지 않는다.
3. 스토리지, 비공개 `voice`/`documents`, 시스템 할당 managed identity, Blob Data Contributor, ACA 앱, `BLOB_ACCOUNT`, migrate check, signup URL 순으로 실행한다.
4. DRY-RUN은 외부 변경 없이 순서와 비밀 무출력을 검증한다. APPLY 경로는 별도 승인 전 실행하지 않는다.
5. `infisical_get.py`에 경로 인자를 추가하고 STT/VOICE env 이름을 WANT/OPTIONAL에서 제거한다. `DOCUMENT_ROOT` 오타를 `DOC_ROOT`로 고친다.
6. `scripts/check-case-access.mjs`가 일회용 DB에서 전체 migration 뒤 `node api/src/migrate.ts --check`까지 실행하고 나서만 DB를 삭제하게 한다.

**완료 판정**

```bash
bash scripts/azure/provision-institution.test.sh
```

출력에 `PROVISION_OK`; 입력 문자열·비밀값 없음.

## Task 4 — S3 UI integration: 설정·온보딩·랜딩

**소유 파일**

- Modify: `web/src/api.ts`, `web/src/screens/onboarding.tsx`, `web/src/screens/settings.tsx`, 랜딩 화면 파일
- Shared owner: `web/src/ui.tsx` 지정 부품, `web/src/dialog.tsx`, `ConsentDetail` 소비 화면
- CSS: `web/src/styles/app.css`만, S3만 수정
- Test: 관련 Playwright spec

**인터페이스**

- Consume: `HANDOFF-STT.md`의 `Connections`, `setSttKey`, `setVoiceEnabled`
- Preserve: `ConsentDetail`, `ParticipantHero`, `participantHeroDetails`, `Dialog` 서명

**구현**

1. `web/src/api.ts` `Connections.stt`를 고정 region/source 타입으로 바꾸고 `voice`를 추가한다. `setSttKey`, `setVoiceEnabled`를 추가한다.
2. 온보딩 4단계와 설정이 같은 `ConnectionsPane`을 사용한다. 키 입력은 비밀번호형 한 칸, 저장 후 비우고 상태 재조회. 지역/endpoint 입력 없음.
3. 키와 별도 녹음 토글을 추가한다. 키가 없어도 켤 수 있으며 상태를 재조회한다.
4. 랜딩 설정 가이드 팝업과 설정 아코디언 진입이 같은 문안 출처를 사용하게 한다. 랜딩 소유권은 S3다.
5. 동의 관리의 기존 고지/재동의 경고를 유지하고 v4 기관명 치환으로 전부 확인 필요가 됨을 화면·e2e에서 확인한다.
6. `app.css`는 S3만 수정하고 카드별 측정 클래스를 부여한다.

**완료 판정**

```bash
pnpm --dir web exec tsc --noEmit
pnpm --dir web build
PLAYWRIGHT_BASE_URL=http://localhost:8798 PLAYWRIGHT_API_PREFIX= \
  pnpm --dir web exec playwright test --workers=1
```

관찰값: 온보딩/설정 같은 상태, 키 값 미표시, 400 제자리 오류, 토글 독립, 랜딩/설정 같은 가이드.

## Task 5 — P1 회귀 완료 판정

현재 main 계약을 새 구현이 깨지지 않게 확인한다.

1. 서버 `service.startSession`은 선택 `session_id`; 클라이언트 `record.tsx` `ensureSession()`이 선택 결과를 넘긴다. 서버 `ensureSession` 심벌을 만들지 않는다.
2. 미작성 회차 `이어 쓰기 / 새 회차` 선택 e2e를 실행한다.
3. `0028_onboarding_step.sql`과 저장 API로 세션 중단 뒤 같은 단계에 재진입하는지 확인한다.
4. 랜딩 가이드 소유·문안은 S3 한 곳인지 확인한다.

## Task 6 — 통합본 검증

**일회용 DB만** 사용한다. 레인별 성공만으로 통합 완료를 선언하지 않는다.

```bash
node scripts/check-case-access.mjs
pnpm --dir web exec tsc --noEmit
pnpm --dir web build
node scripts/measure-cards.mjs http://localhost:8798 test2
PLAYWRIGHT_BASE_URL=http://localhost:8798 PLAYWRIGHT_API_PREFIX= VOICE_ENABLED=1 \
  pnpm --dir web exec playwright test --workers=1
# check-case-access.mjs가 만든 일회용 DB 안에서 migrate와 migrate --check까지 실행한 뒤 DB를 삭제한다.
```

align 판정:

- `align-check axis=x|y|xy`는 중심 비교만 수행.
- `right`·`width`·`top`은 별도 Playwright `boundingBox()`로 카드별 비교.
- `.participant-card` 각각, `.me-profile-card`, `.org-card`, `.download-card`, 기록/원본 열 부모, next-goal/assign-request 부모를 루프로 측정.
- `measure-cards`가 높이를 `auto`로 바꾸므로 실제 등높이 상태의 아래 여백은 별도 측정.

## Task 7 — 배포와 운영 스모크

통합본 검증이 모두 끝난 뒤에만 수행한다.

1. 승인된 공개 multi-arch 이미지와 기관 env 계약을 확인한다.
2. 별도 승인된 APPLY로 기관 앱을 배포하고 `migrate.ts --check`를 실행한다.
3. `/health`, `/auth/signup open:true`, 로그인/마법사 상태를 확인한다.
4. 실제 Speech 키로 합성 음성 1건을 전사한다.
5. 새 녹음 1건의 Blob 저장 바이트가 평문이 아니고 앱을 통해 복호 재생되는지 확인한다.
6. DNS/custom domain은 별도 승인 없이는 변경하지 않는다.

## PR 이력 입력

- #61·#63 닫음.
- #62 `e4735bd`, #64 `ae88395` 머지.
- #65 checkpoint `c4acb52` 선별 재사용 가능.
- 현재 기준선 `0af8903`(#66 포함).
