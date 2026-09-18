# Azure 이전 준비

이 문서는 릴레이어를 Azure Container Apps와 Azure Blob Storage로 옮길 때의 일반적인
준비 순서다. 자원을 실제로 만들지 않으며, 구독·리소스 그룹·앱 이름·저장소 이름 같은
환경 식별자는 조직의 배포 설정에서 관리한다.

## 목표 구조

| 영역 | 현재 배포 | 이전 후 예시 |
|---|---|---|
| 앱 | 기관이 승인한 호스트 또는 관리형 실행 환경 | Azure Container Apps |
| 공개 주소 | 조직이 관리하는 HTTPS 프록시 | 같은 공개 주소의 새 origin |
| 데이터베이스 | PostgreSQL 호환 서비스 | 기존 데이터베이스 유지 또는 승인된 서비스 |
| 음성·문서 | 기관이 관리하는 파일 저장소 | 비공개 Azure Blob 컨테이너 |
| 음성 전사 | Azure Speech | 같은 리전·보존 정책을 검토한 Speech 리소스 |

앱 수준 암호화가 필요한 파일은 서버 측 암호화만으로 대체하지 않는다. Blob 컨테이너는
공개 접근을 막고, 앱은 필요한 파일을 암호화한 뒤 업로드한다.

## 리소스 설계

- Container Apps 환경은 최소·최대 replica, ingress, target port를 기관의 부하와 비용
  정책에 맞춘다.
- Storage 계정은 공개 접근을 차단하고 TLS를 강제한다.
- Blob 컨테이너와 로그의 보존·삭제 정책을 별도로 정한다.
- Key Vault를 추가할지는 비밀 관리 시스템을 하나의 정본으로 유지할 수 있는지 검토한
  뒤 결정한다. 두 시스템에 같은 값을 따로 저장하지 않는다.

## 환경 변수 매핑

비밀 관리 시스템의 값은 Azure Container Apps secret으로 주입하고 앱에는 다음 이름으로
보인다.

| 앱 환경 변수 | 용도 |
|---|---|
| `DATABASE_URL` | PostgreSQL 연결 문자열 |
| `PII_ENC_KEY` | 개인정보 암호화 키 |
| `SESSION_SECRET` | 세션 서명 키 |
| `OPENAI_API_KEY` | 선택적 OpenAI 키 |
| `GEMINI_API_KEY` | 선택적 Gemini 키 |
| `AI_PROVIDER`, `AI_MODEL` | 선택적 AI 설정 |
| `AZURE_SPEECH_KEY` | Speech 인증 키 |
| `AZURE_SPEECH_REGION` 또는 `AZURE_SPEECH_ENDPOINT` | Speech 위치 |
| `VOICE_ENABLED` | 음성 기능 플래그 |
| `PORT` | Container Apps target port와 일치하는 포트 |

Blob 백엔드를 구현하는 별도 코드가 추가되면 다음 이름을 제안할 수 있다. 실제 채택
전에는 코드 계약과 키 회전 절차를 먼저 정한다.

| 이름 | 용도 |
|---|---|
| `VOICE_BLOB_ACCOUNT` | Storage 계정 식별자 |
| `VOICE_BLOB_CONTAINER` | 비공개 음성 컨테이너 |
| `VOICE_BLOB_ENC_KEY` | 앱 수준 암호화용 base64 32바이트 키 |
| `VOICE_BLOB_CONN` 또는 관리 ID | Blob 업로드 자격 |

## 단계

### 1. 준비와 이미지

```bash
az login
az containerapp create --help       # 조직 정책과 필수 옵션 확인
docker build -t relayer:<release> .
```

`az` 명령의 비밀 인자에는 값을 직접 쓰지 않는다. 관리 ID와 RBAC를 사용할 수 있으면
장기 연결 문자열보다 우선한다.

### 2. 비밀 주입

비밀 관리 시스템에서 읽은 값을 파일 또는 승인된 연동으로 Azure secret에 등록한다.
값은 화면·argv·로그에 나오지 않아야 한다. 앱에서 `/health`와 암호화 기록 조회를
먼저 확인한다.

### 3. 음성·문서 이전

1. 기존 저장소를 상대 경로·크기·해시만 포함한 비밀 없는 manifest로 목록화한다.
2. 앱 수준 암호화를 적용하는 이전 도구로 비공개 Blob에 업로드한다.
3. manifest와 Blob 목록의 개수·크기·해시를 대조한다.
4. 새 저장소 검증 전에는 기존 원본을 삭제하지 않는다.

### 4. 공개 origin 전환

DNS를 바꾸거나 새 주소를 공개하기 전에 HTTPS 프록시의 origin을 새 Container App으로
전환한다. 기존 origin은 롤백 검증 기간 동안 접근 통제된 상태로 유지한다. 두 앱이 같은
데이터베이스를 동시에 쓰면 쓰기 경합과 마이그레이션 순서를 먼저 검토한다.

### 5. 롤백

문제가 생기면 프록시 origin을 이전 환경으로 되돌리고, 새 앱의 쓰기 작업을 멈춘 뒤
데이터베이스·파일 상태를 확인한다. 전환 전 원본과 manifest를 유지했는지 확인한다.

## 확인

```bash
az containerapp exec -n <app> -g <resource-group> --command "node api/src/migrate.ts --check"
curl -fsS https://<public-app>/health
```

마이그레이션 미적용 여부, `health` 응답, 로그인, 암호화된 기록, 음성 업로드·전사를
값 없이 확인한다. 최소한의 소거 기간 동안 이전 파일과 복구 경로를 유지한 뒤, 승인된
보존 정책에 따라 이전 자원을 정리한다.
