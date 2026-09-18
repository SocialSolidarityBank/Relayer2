# HANDOFF — STT·DB Cloud v2 UI 계약 (2026-09-18)

이 문서는 구현 레인보다 먼저 고정하는 소비 계약이다. 현재 `main`의 공용 부품과 API 모양을 기준으로 하며, UI 레인 **S3**는 이 문서의 서명을 소비한다. 공유 개발 DB `relayer`와 운영 Supabase는 사용하지 않는다.

## 레인 소유권

| 레인 | 단독 소유 경계 |
|---|---|
| S1 backend | `api/src/routes.ts`, `api/src/settings.ts`, `api/src/consent.ts`, `api/src/service.ts` 및 해당 API 테스트 |
| S2b storage | `api/src/storage.ts`, `api/src/pii.ts`, `api/src/stt.ts`, `api/src/documents.ts` 및 저장 테스트 |
| S2 provisioning | `scripts/azure/**`, `scripts/infisical_get.py`, `scripts/infisical_put.py`, 프로비저닝 테스트·런북 |
| S3 UI integration | `web/src/api.ts`, `web/src/ui.tsx`의 아래 지정 부품, `web/src/dialog.tsx`, `web/src/screens/onboarding.tsx`, `web/src/screens/settings.tsx`, `ConsentDetail` 소비 화면, UI/e2e |

`web/src/styles/app.css`는 **S3만** 수정한다. 다른 레인은 CSS·공용 UI 부품·`web/src/api.ts`에 임시 구현을 만들지 않고 이 계약을 소비한다.

## S3가 유지할 공용 부품 서명

현재 `main` 서명을 깨지 않는다. 확장이 필요하면 S3가 모든 소비자를 한 번에 옮긴다.

```ts
export function ConsentDetail(props: {
  copy: {
    body: string;
    items: string[];
    purpose_text: string;
    retention_text: string;
    refusal_text: string;
    recipient: string | null;
  };
}): JSX.Element;

export function ParticipantHero(props: {
  name: string | null;
  pseudonym: string;
  details?: ReadonlyArray<[string, ReactNode]>;
  actions?: ReactNode;
}): JSX.Element;

export function participantHeroDetails(input: {
  pseudonym: string;
  program: string;
  seqLabel?: string | null;
  phone?: string | null;
  email?: string | null;
}): ReadonlyArray<[string, ReactNode]>;

export function Dialog(props: {
  id: string;
  title: ReactNode;
  trigger?: string;
  size?: 'wide';
  open?: boolean;
  onClose?: () => void;
  className?: string;
  actions?: ReactNode;
  children: ReactNode;
}): JSX.Element;
```

`Card`·`Fold`·`Field`·`Button`은 현재 `web/src/ui.tsx` 서명을 재사용한다. STT 전용 복제 부품을 만들지 않는다. `ConsentDetail`은 당사자 등록·당사자 정보·설정의 같은 문안을 계속 그린다.

## S1 → S3 HTTP 계약

모든 라우트는 로그인 필요. 변경 라우트는 관리자만 허용하며 실무자는 `403`. 키 원문은 응답·감사·로그에 넣지 않는다.

### Speech 키

```http
PUT /settings/stt-key
Content-Type: application/json

{"key":"<Azure Speech key>"}
```

- `key: string | null`; `null`은 DB 저장 키 삭제.
- 서버는 저장 전에 `koreacentral` `issueToken`으로 검증한다.
- 성공: `200 {"ok":true}`.
- 검증 실패·타 리전 키: `400 {"error":"..."}`이고 저장하지 않는다. S3는 서버 오류 문구를 값 없이 표시한다.
- UI에는 지역·endpoint 입력을 만들지 않는다.

### 녹음 토글

```http
PUT /settings/voice
Content-Type: application/json

{"enabled":true}
```

- `enabled: boolean`; 키 저장과 별도인 명시 토글.
- 성공: `200 {"ok":true}`.
- 키가 없어도 토글을 켤 수 있다. 이때 녹음은 가능하고 전사는 `skipped`.

### 연결 상태

```ts
type ConnectionSource = 'db' | 'env' | null;

type Connections = {
  ai: {
    connected: boolean;
    provider: string;
    model: string;
    env: string;
    source: ConnectionSource;
  };
  stt: {
    connected: boolean;
    provider: 'azure';
    region: 'koreacentral';
    source: ConnectionSource;
  };
  voice: {
    enabled: boolean;
    source: ConnectionSource;
  };
  db: {
    connected: boolean;
    checked_at: string;
    env: string;
  };
};
```

`GET /settings/connections`가 위 구조를 반환한다. `stt.connected`는 실제 사용 가능한 키 존재, `voice.enabled`는 DB 토글 우선·`null`이면 env 폴백, `db.connected`는 실제 `select 1` 결과다. 키·endpoint는 반환하지 않는다.

S3의 `web/src/api.ts` 공개 서명은 다음으로 고정한다.

```ts
export const getConnections: () => Promise<Connections>;
export const setSttKey: (key: string | null) => Promise<{ ok: true }>;
export const setVoiceEnabled: (enabled: boolean) => Promise<{ ok: true }>;
```

기존 `setAiKey(key: string | null)`는 유지한다. S1은 이 이름을 import하지 않으며 HTTP 계약만 구현한다.

## S3 화면 계약

- 온보딩 4단계와 `설정 › 외부 서비스 연결`은 같은 `ConnectionsPane`을 소비한다.
- Speech 키는 비밀번호형 입력 1개. 저장 성공 후 입력을 비우고 상태를 다시 읽는다. 기존 값은 절대 채워 넣지 않는다.
- 녹음 토글은 키 저장과 독립. 켬/끔 뒤 상태를 다시 읽는다.
- 상태 문구는 `연결됨`·`연결 안 됨`, `녹음 켬`·`녹음 끔`처럼 명사구로 둔다. 지역은 읽기값 `한국 중부(koreacentral)`만 표시한다.
- 랜딩의 설정 가이드 팝업과 그 진입점도 S3 소유다. 설정 아코디언은 S3가 같은 문안 출처를 열고, 다른 레인이 랜딩 파일이나 가이드 복제본을 만들지 않는다.
- `COPY_VERSION v4`와 기관명 치환으로 기존 동의가 모두 `확인 필요`가 된다. 동의 관리 화면의 기존 경고 절차(실사용 중 이메일 등 정해진 방식으로 고지 후 재동의)를 유지한다.

## 완료 기준

- TypeScript가 위 공개 서명으로 컴파일되고 온보딩·설정 두 소비 화면이 같은 API를 사용한다.
- 유효 키 저장, 잘못된 키 `400`, 키 삭제, 녹음 토글 켬/끔, 실무자 `403`을 e2e 또는 API 통합 시나리오로 관찰한다.
- 응답·화면·감사·로그 어디에도 키 원문이 없다.
- `web/src/styles/app.css` 변경은 S3 커밋에만 있다.
