# 릴레이어 0.2.0

릴레이어는 기관이 자체 운영하는 상담 지원 워크스페이스다. 당사자 정보를 암호화하고,
동의·열람 기록을 보존하며, 다음 상담 전에 실무자가 짧은 다시보기를 확인하도록 돕는다.

이 저장소는 공개 베타다. 각 기관은 공개 저장소를 포크한 뒤 코드와 운영 정책을 검토하고,
기관이 통제하는 격리 환경에 배포해야 한다. 공유 데모나 개발용 데이터베이스에 실제
당사자 자료를 넣지 않는다.

## 준비물

컨테이너로 배포할 때:

- [Git](https://git-scm.com/)
- [Docker Engine 또는 Docker Desktop](https://docs.docker.com/get-docker/)과 Docker Compose

소스를 직접 개발할 때만 Node.js 22.18 이상과 pnpm이 추가로 필요하다. Node.js 24를
권장한다. 운영 이미지는 의존성을 설치하고 빌드된 웹 화면과 API를 함께 제공한다.

## 포크·설정·배포

1. 공개 저장소를 기관이 관리하는 소스 저장소로 포크하고 그 포크를 클론한다.
2. 애플리케이션을 처음 시작하기 전에 기관 배포 라벨을 `RELAYER_SLUG`로 정한다.
   선택적으로 완전한 공개 주소를 `RELAYER_PUBLIC_URL`에 정한다. DNS, HTTPS, 접근 정책은
   저장소 밖에서 기관이 설정한다.
3. PostgreSQL 데이터베이스와 체크아웃 디렉터리 밖의 환경 파일을 준비한다. 아래 필수
   운영 변수를 설정한다. 파일은 소유자만 읽을 수 있게 하고 커밋·명령행·셸 기록·로그·
   스크린샷에 내용을 남기지 않는다.
4. 아래 Docker 예시로 이미지를 빌드하고 실행한다. 이미지는 서버를 시작하기 전에
   마이그레이션을 적용한다.
5. 배포 주소를 열고 기관 관리자 계정으로 최초 가입 절차를 마친다.

기관은 데이터와 비밀값, PostgreSQL 가용성, 백업·복구 리허설, 파일 저장소 보유·삭제
정책, 접근 통제, 동의 문안, 개인정보 고지, 국외 처리 여부, 법률·규제 검토를 책임진다.
`PII_ENC_KEY`는 데이터베이스 백업과 분리된 보호 위치에 보관한다. 이 키를 잃으면 백업에
있는 암호화 개인정보를 복구할 수 없다.

## 환경 변수 계약

아래 표는 런타임 계약이다. 비밀값 자체는 적지 않았다. 운영에서는 필수 표의 변수를
모두 주입한다. 선택 기능은 필요한 설정과 기관의 동의·정책이 갖춰진 경우에만 켠다.

### 운영 필수

| 변수 | 용도 | 기본값 |
|---|---|---|
| `DATABASE_URL` | 애플리케이션과 마이그레이션이 사용할 PostgreSQL 연결 문자열 | 운영에서는 없음. 개발 코드의 기본 연결은 컨테이너 배포에 쓰지 않는다 |
| `PII_ENC_KEY` | 이름·연락처·자유 글을 암호화하는 base64 인코딩 32바이트 키 | 없음. 없으면 시작 또는 암호화 데이터 접근이 실패한다 |
| `SESSION_SECRET` | 로그인 세션 쿠키 서명에 쓰는 무작위 비밀값 | 없음. 없으면 로그인이 실패한다 |

### 선택: AI

| 변수 | 용도 | 기본값 |
|---|---|---|
| `OPENAI_API_KEY` | AI 요약에 사용할 OpenAI API 키 | 미설정. 키가 없으면 AI를 사용할 수 없다(관리자는 설정 화면에서 지원되는 OpenAI 키를 설정할 수도 있다) |
| `GEMINI_API_KEY` | Gemini를 선택했을 때 사용할 Google Gemini API 키 | 미설정. 없으면 Gemini를 사용할 수 없다 |
| `AI_PROVIDER` | AI 제공자: `openai` 또는 `gemini` | `openai` |
| `AI_MODEL` | 선택한 제공자의 모델 이름 | OpenAI는 `gpt-5.5`, Gemini는 `gemini-flash-latest` |

### 선택: 음성·음성 인식(STT)

| 변수 | 용도 | 기본값 |
|---|---|---|
| `VOICE_ENABLED` | `1`일 때 음성 업로드·전사를 활성화하는 플래그 | 비활성화 |
| `AZURE_SPEECH_KEY` | Azure Speech 자격 증명 | 미설정. STT를 사용할 수 없다 |
| `AZURE_SPEECH_REGION` | Azure Speech 리소스 리전 | 미설정. `AZURE_SPEECH_ENDPOINT`와 둘 중 하나를 제공한다 |
| `AZURE_SPEECH_ENDPOINT` | Azure Speech 리소스의 HTTPS 엔드포인트 | 미설정. `AZURE_SPEECH_REGION`과 둘 중 하나를 제공한다 |
| `STT_PROVIDER` | 동의 메타데이터에 기록할 제공자 이름 | `azure` |
| `STT_CONCURRENCY` | 동시에 처리할 전사 작업 수 | `2` |

STT는 `VOICE_ENABLED=1`, `AZURE_SPEECH_KEY`, 그리고 리전 또는 엔드포인트가 모두
있을 때만 동작한다. 음성을 외부 제공자에게 보내기 전에 녹음·외부 STT 처리에 필요한
동의를 기관이 받아야 한다.

### 선택: 주소·저장소·런타임

| 변수 | 용도 | 기본값 |
|---|---|---|
| `RELAYER_SLUG` | 공개 URL이 없을 때 기관 주소로 표시할 배포 라벨 | 미설정. 최초 시작 전에 정해 주소를 알 수 있게 한다 |
| `RELAYER_PUBLIC_URL` | 워크스페이스 설정과 기관 설정에 표시할 공개 주소 | 미설정. 설정하면 `RELAYER_SLUG`보다 우선한다 |
| `PORT` | API와 빌드된 웹 애플리케이션이 수신할 HTTP 포트 | `8787` |
| `VOICE_ROOT` | 업로드한 음성 파일을 저장할 디렉터리 | `./voice` |
| `DOC_ROOT` | 업로드한 문서를 저장할 디렉터리 | `./documents` |
| `PGSCHEMA` | 애플리케이션이 사용할 PostgreSQL 스키마 | PostgreSQL 기본 스키마 |

`RELAYER_SLUG`와 `RELAYER_PUBLIC_URL`은 배포 설정이며 마법사가 수정하는 입력값이
아니다. 음성이나 문서를 사용할 때는 `VOICE_ROOT`와 `DOC_ROOT`를 기관의 백업·보유
정책이 적용되는 저장소에 연결한다.

비밀값 관리는 [`docs/secrets.md`](docs/secrets.md), 운영 점검은
[`docs/deploy.md`](docs/deploy.md)를 참고한다.

## Docker 배포

### 폐기 가능한 로컬 개발용 PostgreSQL

저장소의 Compose 파일로 PostgreSQL 17을 로컬에서 시작한다.

```bash
docker compose up -d db
```

Compose의 자격 증명과 볼륨은 폐기 가능한 로컬 개발용이다. 운영에서는 기관이 소유하는
PostgreSQL 서비스, 자격 증명, 네트워크, 백업 정책, 저장소를 사용한다. 애플리케이션은
마법사를 제공하기 전에 PostgreSQL에 연결할 수 있어야 한다. 마법사를 시작한다고 해서
데이터베이스 연결이 만들어지거나 바뀌지는 않는다.

### 이미지 빌드와 실행

저장소 밖에서 기관이 관리하는 경로에 환경 파일을 만든다. 필수 변수와 승인한 선택
설정을 채운 뒤 다음 명령을 실행한다.

```bash
docker build -t relayer:0.2.0 .
docker run --env-file /secure/path/relayer.env -p 8787:8787 relayer:0.2.0
```

`/secure/path/relayer.env`는 컨테이너에서 접근 가능한 `DATABASE_URL`을 담은 기관 관리
파일이어야 한다. 비밀값을 인라인 `-e` 옵션으로 넣지 말고 `--env-file`을 사용한다.
이미지의 실행 명령은 `node api/src/migrate.ts && node api/src/index.ts`다. 컨테이너가
시작할 때마다 미적용 마이그레이션을 먼저 적용한 뒤 서버를 시작한다. 기관이 승인한
HTTPS 프록시를 통해 애플리케이션을 공개하고 PostgreSQL·관리 포트는 공개하지 않는다.

## 최초 가입과 워크스페이스 설정

배포 운영자는 애플리케이션을 시작하기 전에 `RELAYER_SLUG`와 선택 사항인
`RELAYER_PUBLIC_URL`을 정한다. 새로 시드하지 않은 데이터베이스에서 최초 가입이
성공하면 초기 관리자가 만들어진다. 관리자가 생기면 공개 가입은 닫히고, 이후 사용자는
관리자의 초대 방식으로 가입한다.

최초 가입 뒤 관리자는 다음 순서로 마법사를 진행한다.

1. **기관 워크스페이스** — 기관 이름을 입력하고 배포가 제공한 slug 또는 공개 주소를
   읽기 전용 주소로 확인한다. 이 주소는 마법사에서 바꾸지 않는다.
2. **기관 정보** — 기관의 행정 정보를 입력한다.
3. **사업** — 계속 진행하기 전에 활성 사업을 하나 이상 만든다.
4. **실무자 초대** — 실무자를 초대한다. 이 단계는 건너뛴 뒤 다시 진행할 수 있다.
5. **외부 서비스 연결** — AI·STT·데이터베이스의 연결 상태와 설정 안내를 확인한다.

외부 서비스 연결 단계는 서버의 현재 설정을 확인할 뿐이다. `DATABASE_URL`을 수정하거나
PostgreSQL을 설치하지 않는다. 데이터베이스를 바꾸려면 운영자가 런타임 환경을 수정하고
마이그레이션·기동 절차를 적용한 뒤 애플리케이션을 재시작한다.

AI와 STT는 기본적으로 꺼져 있다. AI는 승인한 제공자 키와 필요한 동의가 있어야 하며,
STT는 음성 플래그·Azure Speech 설정·녹음 및 외부 STT 처리 동의가 추가로 필요하다.
데이터베이스는 다르다. 이 저장소에는 관리형 또는 외부 데이터베이스가 미리 연결되어
있지 않지만, 핵심 애플리케이션과 마법사를 시작하려면 연결 가능한 PostgreSQL이 반드시
필요하다.

## 소스 개발과 검증

다음은 운영 배포가 아닌 로컬 개발용 절차다. 먼저 위의 명령으로 로컬 DB를 시작하고,
체크아웃 밖에 소유자 전용 환경 파일을 만든 뒤 필수 암호화·세션 비밀값을 생성한다.
아래 절차는 값을 화면에 출력하지 않는다. 로컬 Compose DB를 쓸 때는 `DATABASE_URL`을
생략하면 개발 코드의 로컬 기본 연결을 사용하며, 운영에서는 반드시 명시적으로 설정한다.

```bash
docker compose up -d db
umask 077
ENV_FILE="${HOME}/.config/relayer/dev.env"
mkdir -p "$(dirname "$ENV_FILE")"
{
  printf 'PII_ENC_KEY=%s\n' "$(openssl rand -base64 32)"
  printf 'SESSION_SECRET=%s\n' "$(openssl rand -hex 32)"
} > "$ENV_FILE"
set -a
. "$ENV_FILE"
set +a

pnpm install
pnpm migrate
pnpm seed                 # 선택: 로컬 탐색용 합성 데이터
pnpm dev                  # API 서버
pnpm --dir web dev        # 두 번째 터미널에서 Vite 화면
pnpm test                 # API 단위 테스트
pnpm --dir web exec playwright test e2e/beta-flow.spec.ts
```

브라우저 테스트는 API와 Vite 개발 서버가 실행 중이어야 한다. 포크를 검증할 때는
합성 데이터를 사용하고, 비밀값을 출력하지 않은 상태에서 `/health`, 로그인, 암호화
기록 저장·조회를 확인한다.

## 더 읽을 문서

- [`docs/institution-setup.md`](docs/institution-setup.md) — 기관이 소유하는 서비스와
  설정 점검표
- [`docs/secrets.md`](docs/secrets.md) — 환경 변수 이름, 생성, 교체, 보관
- [`docs/deploy.md`](docs/deploy.md) — 컨테이너, 주소, 백업, 복구 안내

## 라이선스

릴레이어는 [Apache License 2.0](LICENSE)으로 배포한다. 상위 구성 요소의 저작권 표시와
고지는 [`NOTICE`](NOTICE)에 적었다.
