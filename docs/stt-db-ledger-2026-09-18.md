# RELAYER2 — STT·DB Cloud v2 결정 장부 (2026-09-18)

## 범위

기관별 ACA 배포, 기관 소유 Supabase·Azure Speech 연결, STT 키·녹음 토글, 음성·문서 Blob 암호화, 프로비저닝, S3 UI 인계를 위한 실행 계약. 기준선은 현재 `origin/main` `0af8903`; `ae88395`(#64) 이후 #66 랜딩 변경까지 포함한다.

## 확정 결정

1. 기관당 앱 1개. 멀티테넌트 `org_id` 전환은 비범위.
2. BSS가 ACA `koreacentral`에서 기관별 컨테이너 앱을 운영한다.
3. DB는 기관 소유 Supabase 서울 Pro. 기관은 BSS를 조직 Owner로 초대한다.
4. BSS는 비밀번호 재설정으로 세션 풀러 `pooler.supabase.com:5432` 문자열을 얻는다. 직접 연결 IPv6 주소와 6543 트랜잭션 풀러는 거절한다.
5. STT는 기관 소유 Azure Speech. 관리자는 키만 입력하고 지역은 `koreacentral` 고정이다.
6. `PUT /settings/stt-key {key:string|null}`는 관리자 전용. `issueToken` 검증 성공 뒤 `organization.enc_speech_key`에 `encryptPii`; 실패는 400이며 저장하지 않는다.
7. `PUT /settings/voice {enabled:boolean}`는 관리자 전용. `organization.voice_enabled boolean null`; 키와 별개이며 `null`만 env 폴백이다.
8. `voiceEnabled()`·`sttEnabled()`는 비동기 DB 우선 읽기다. 직접 env 읽기·프로세스 캐시는 금지한다.
9. 음성·문서는 `voice`·`documents` 비공개 Blob 컨테이너에 저장한다. ACA managed identity와 `Storage Blob Data Contributor`를 쓴다.
10. 저장 바이트는 기존 `PII_ENC_KEY`로 AES-256-GCM 암호화한다. 별도 `VOICE_BLOB_ENC_KEY`, 계정키, 연결 문자열은 쓰지 않는다.
11. Infisical `ggbss-agent · prod · /RELAYER2/<slug>`가 `DATABASE_URL`·`PII_ENC_KEY`·`SESSION_SECRET`의 정본이다. 기관 폴더는 정리 단위이지 접근 제어가 아니다.
12. 프로비저닝은 `scripts/azure/provision-institution.sh <slug>` 하나. DRY-RUN 기본, `APPLY=1` 실행, 입력 문자열·비밀값 무출력, 기존 값 무덮어쓰기.
13. 동의 처리자는 `organization.name`, 수탁자는 사회연대은행, 리전은 한국 중부다. `canonicalPreimage`에 기관명을 넣고 코드 판을 v4로 올린다.
14. 기관명 치환과 v4 전환으로 현재 동의 전부가 `확인 필요`가 된다. 관리자 화면에는 이미 “이메일 등 정해진 방식으로 고지 후 재동의” 경고가 있으며 그대로 유지한다. 기관명 변경도 재동의 사유다.
15. 신규 마이그레이션은 **`0029_stt_key_voice.sql`**이다. `0027_ui_plan_api.sql`과 `0028_onboarding_step.sql`은 이미 main에 있다.
16. 맥미니 파일 이전, 메일 발송, PII 키 로테이션, 1Password 사본, ACR 선택, Cloudflare 전환, STT 제공자 선택은 비범위.

## 레인 소유권

| 레인 | 소유 |
|---|---|
| S1 | routes/settings/consent/service/audit, `0029_stt_key_voice.sql` |
| S2b | storage/pii/stt/documents |
| S2 | `scripts/azure/**`, Infisical 스크립트, 프로비저닝 문서 |
| S3 | `web/src/api.ts`, `ui.tsx` 지정 부품, `dialog.tsx`, `ConsentDetail` 통합, 온보딩·설정·랜딩, `web/src/styles/app.css` |

소비 서명은 `HANDOFF-STT.md`가 소유한다. S3 외 레인은 `app.css`를 건드리지 않는다.

## 현재 main 계약과 STT 증분

### UI 계획 누락 4건의 실제 종결

- 구조화 인테이크: `memo` 리비전은 `sessions.memo`만 수정한다. `detail_json`·카드·다음 목표는 리비전 텍스트에 합치지 않고 기존 편집 경로를 쓴다.
- duration: 일정 생성과 기록 수정이 `duration_min`을 받고, 사례/회차 상세 조회가 반환한다. 생략 유지·`null` 삭제·양수만 허용.
- 요약: `kind:'summary'` 리비전이 승인 `ai_drafts` 새 행을 만들고 기존 changes/tasks/questions/fact_changes를 보존한다. 별도 draft PATCH 없음.
- next goal: 사례 API는 마지막 기록 회차를 고른 뒤 `updateNextGoal`을 재사용한다. 기록 전과 다음 회차가 이미 이어받은 상태를 모두 409로 거절한다.

### N1/N2 사실

- 서버 심벌은 `service.startSession`; 클라이언트 보장 함수는 `record.tsx`의 `ensureSession`. 기존 `session_id` 인자로 이어 쓰기/새 회차를 구분한다.
- 마법사 재진입은 `0028_onboarding_step.sql`로 확정. `onboarding_step` 0~4를 저장하며 값 유무로 유추하지 않는다.
- 랜딩 설정 가이드는 S3 소유.

### STT API

```text
PUT /settings/stt-key {key:string|null} -> {ok:true}
PUT /settings/voice {enabled:boolean} -> {ok:true}
GET /settings/connections ->
  stt:{connected,provider:'azure',region:'koreacentral',source:'db'|'env'|null}
  voice:{enabled,source:'db'|'env'|null}
  db:{connected,checked_at,env}
```

실무자는 변경 API 403. 응답·감사·로그에 키 값 없음. 감사 종류 `stt.key.set`, `voice.toggle` 등록.

## 저장 계약

`api/src/storage.ts`에 하나의 backend 인터페이스를 둔다.

```ts
put(container: 'voice' | 'documents', relPath: string, bytes: Uint8Array): Promise<void>
get(container: 'voice' | 'documents', relPath: string): Promise<Uint8Array>
del(container: 'voice' | 'documents', relPath: string): Promise<void>
exists(container: 'voice' | 'documents', relPath: string): Promise<boolean>
```

- 로컬·테스트: `VOICE_ROOT`/`DOC_ROOT` 파일시스템.
- Azure: `BLOB_ACCOUNT` + `DefaultAzureCredential`.
- 평문 기준 `recordings.bytes`·`sha256` 유지.
- 음성·문서 읽기/쓰기/삭제/보유기간 sweep 전부 같은 adapter 경유.
- #65 `c4acb52`의 backend 경계, 스트림 처리, Azurite 테스트는 선별 재사용 가능. 계정키와 HKDF 계약은 폐기.

## 동의 v4 착수 조건

1. 일회용 DB에서 v3 동의 사건 생성.
2. 기관명 포함 v4를 적용.
3. 모든 현재 상태가 `확인 필요`로 바뀌고 음성/STT 게이트가 잠기는지 확인.
4. 설정 화면의 이메일 등 고지 경고 유지.
5. `api/test/consent.test.ts`가 기관명 변경 시 해시 변경, 같은 기관명에서 안정성을 보장.

## align·measure 판정

- `align-check`: 중심 `x`·`y`·`xy`만.
- `right`·`width`·`top`: Playwright `boundingBox()` 또는 `getBoundingClientRect()` 별도 측정.
- 설정 카드 행동은 카드별 선택자 안에서 측정. 전역 제목/버튼 선택자 금지.
- `measure-cards`는 카드 높이를 잠시 `auto`로 바꾼다. PASS는 실제 등높이 화면의 늘어난 아래 여백 증거가 아니다.

## 검증 순서

`계약·정본 → 통합본 검증(일회용 DB, tsc/build·measure·e2e·migrate·align) → 배포 → 운영 스모크`

## 수용 기준

- 유효 Speech 키 저장·삭제, 잘못된/타 리전 키 400 무저장, 실무자 403, 키 무노출.
- 녹음 토글이 active consent domains를 바꾸고 키 없음+토글 켬은 녹음 성공/전사 skipped.
- v4 기관명 문안과 재동의 경계 검증.
- fs/Blob 모두 암호문 저장·복호 읽기·삭제·sweep.
- 프로비저닝 DRY-RUN은 세션 풀러 검증, Infisical 중첩 폴더, Blob/MI/RBAC, ACA, migrate, signup URL 순서를 값 없이 출력.
- 통합본 tsc/build, measure, e2e `--workers=1`, API 통합, migrate check, align/bounding-box 통과.

## PR 처리 기록

- #61 닫음.
- #63 닫음.
- #62 `e4735bd` 머지.
- #64 `ae88395` 머지.
- #65 닫음; checkpoint `c4acb52` 선별 재사용 가능.
- 현재 main에는 이후 #66 `0af8903`도 포함.
