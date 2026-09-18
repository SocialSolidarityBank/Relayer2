# 기관 IT 담당자를 위한 설치 안내

이 문서는 기관의 IT 담당자가 비밀값을 보지 않고 릴레이어가 사용하는 외부 서비스를
준비하는 절차다. 값 자체는 문서·채팅·커밋에 적지 않는다. 환경 변수의 이름과 의미는
`docs/secrets.md`, 일반 운영 절차는 `docs/ops-internal.md`를 기준으로 한다.

## 1. 준비할 서비스

- PostgreSQL 호환 데이터베이스: `DATABASE_URL`을 발급한다. 개인정보를 다루는
  환경의 리전·보존·백업 정책은 기관의 요건에 맞춘다.
- AI 제공자(선택): OpenAI 또는 Google Gemini를 사용할 경우 해당 API 키와
  `AI_PROVIDER`, `AI_MODEL`을 준비한다.
- 음성 전사 제공자(선택): Azure Speech 리소스와 `AZURE_SPEECH_KEY`를 준비하고,
  `AZURE_SPEECH_REGION` 또는 `AZURE_SPEECH_ENDPOINT`를 선택한다.
- 비밀 관리 시스템: [Infisical](https://infisical.com/) 또는 조직이 승인한 동등한
  시스템을 사용한다. 프로젝트·환경·경로 이름은 기관의 정책으로 정하고 이 저장소에
  기록하지 않는다.

## 2. 애플리케이션 환경 변수

### 필수

| 이름 | 의미 |
|---|---|
| `DATABASE_URL` | PostgreSQL 연결 문자열 |
| `PII_ENC_KEY` | 이름·연락처·자유 글을 암호화하는 base64 32바이트 키 |
| `SESSION_SECRET` | 로그인 세션 쿠키 서명용 무작위 값 |

### 선택

| 이름 | 의미 |
|---|---|
| `OPENAI_API_KEY` | OpenAI 인증 키 |
| `GEMINI_API_KEY` | Gemini 인증 키 |
| `AI_PROVIDER` | `openai` 또는 `gemini` |
| `AI_MODEL` | 선택한 제공자의 모델 이름 |
| `AZURE_SPEECH_KEY` | Azure Speech 인증 키 |
| `AZURE_SPEECH_REGION` | Speech 리소스 지역 |
| `AZURE_SPEECH_ENDPOINT` | Speech 리소스 전용 HTTPS 엔드포인트 |
| `VOICE_ENABLED` | `1`이면 음성 기능 활성화 |
| `VOICE_ROOT` | 음성 파일 저장 위치 |
| `PORT` | HTTP 수신 포트, 기본 `8787` |
| `RELAYER_SLUG` | 배포 식별 라벨 |
| `RELAYER_PUBLIC_URL` | 화면에 표시할 공개 주소 |
| `DOC_ROOT` | 서면 문서 저장 위치 |
| `PGSCHEMA` | 사용할 PostgreSQL 스키마 |
| `STT_CONCURRENCY` | 동시 전사 작업 수 |

## 3. 비밀값 생성·등록

1. 신뢰할 수 있는 운영자 장비나 비밀 관리 시스템에서 `PII_ENC_KEY`와
   `SESSION_SECRET`을 암호학적으로 무작위 생성한다.
2. 비밀 관리 시스템에 환경별로 값을 등록한다. 접근 권한은 배포 자동화와 필요한
   운영자에게만 준다.
3. 배포 도구가 비밀을 앱 이름으로 매핑한다면 최종 프로세스에는 위 표의 환경 변수
   이름이 주입되는지 확인한다.
4. 로컬 환경 파일이 필요한 경우 저장소 밖에 만들고 소유자만 읽게 한다(예: `0600`).
5. 키와 연결 문자열은 명령행 인자·셸 이력·로그·스크린샷에 남기지 않는다.

## 4. 데이터베이스와 외부 제공자

- 마이그레이션을 적용할 전용 데이터베이스와 애플리케이션 계정을 준비한다.
- `PII_ENC_KEY`는 데이터베이스 백업과 다른 보관 위치에 둔다. 키를 바꾸면 기존
  암호문을 읽을 수 없으므로 키 회전 전에 복구 계획을 세운다.
- AI를 사용하지 않으면 AI 변수를 생략할 수 있다. 음성을 사용하려면
  `VOICE_ENABLED=1`, 키, 지역 또는 엔드포인트가 모두 있어야 한다.
- 외부 제공자의 동의·국외 처리·보존 정책은 기관의 법무·개인정보 담당자와 확인한다.

## 5. 기동 확인

```bash
node api/src/migrate.ts
node api/src/index.ts
```

기동 후 `/health`의 성공 응답, 로그인, 암호화된 기록의 저장·조회가 되는지 확인한다.
선택 기능을 켠 경우 해당 기능의 상태 코드만 확인하고 키 값은 출력하지 않는다. 공개
배포 주소가 `https://relayer.kr/test`라면 참가자에게는 그 공개 주소만 전달하고, 관리
포트와 데이터베이스 포트는 외부에 열지 않는다.

백업·복구·자격 회전은 `docs/ops-internal.md`의 값 없는 절차를 따른다.
