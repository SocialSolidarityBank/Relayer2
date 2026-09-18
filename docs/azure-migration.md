# Azure 이전 런북 (koreacentral)

앱을 맥미니에서 **Azure Container Apps(koreacentral)** 로 옮기고, 음성·문서를
**Azure Blob + 앱 수준 암호화**로 저장한다. DB는 Supabase 서울을 그대로 쓴다.

> **게이트:** 2026-09-18 플래너가 `relayer2-prod` 안 자원 생성에 `GO`했다.
> 프로비저닝은 계속 `APPLY=1 PLANNER_GO=GO` 두 값을 요구한다. DNS 전환은 별도 `GO` 전까지 금지한다.

## 목표와 유지 항목

| 항목 | 전환 전 | 전환 후 |
|---|---|---|
| 앱 | 맥미니 `~/services/relayer2` (`or.bss.relayer`) | ACA `relayer2`, GHCR `ghcr.io/socialsolidaritybank/relayer:0.2.0` |
| 공개 주소 | Cloudflare DNS·Tunnel → 맥미니 `:8790` | Cloudflare DNS-only A → ACA 환경 고정 IP, ACA 관리 인증서 |
| DB | Supabase `relayer2`, `ap-northeast-2` | **변경 없음** |
| 음성·문서 | 맥미니 파일시스템 | Blob `voice`·`documents`, 앱이 AES-256-GCM으로 암호화 |
| STT | `ccc-stt-koreacentral` | **변경 없음** |
| 롤백 | — | 맥미니 앱·Tunnel·Funnel·원본 파일 유지 |

DNS 제공자는 Cloudflare다. `relayer.kr` 네임서버는 `noah.ns.cloudflare.com`·
`perla.ns.cloudflare.com`이고, 2026-09-18 현재 공개 조회 A 값은 Cloudflare 프록시 주소다.
가비아는 등록기관일 뿐 DNS 변경 지점이 아니다(`docs/deploy.md`).

## 자원 계약

| 자원 | 이름 | 계약 |
|---|---|---|
| 리소스 그룹 | `relayer2-prod` | `koreacentral` |
| Container Apps 환경 | `relayer2-env` | Consumption only, Log Analytics 연결 |
| Container App | `relayer2` | external ingress, 8787, 0.25 vCPU, 0.5 GiB, min 1 / max 1 |
| Log Analytics | `relayer2-logs` | PerGB2018, 30일 |
| Storage 계정 | `relayer2voice` | StorageV2 Hot LRS, HTTPS only, TLS 1.2+, 익명 Blob 공개 차단 |
| Blob 컨테이너 | `voice`, `documents` | `public-access=off` |
| Key Vault | 만들지 않음 | 시크릿 정본은 Infisical 하나 |

Storage 공개 네트워크 엔드포인트는 ACA가 접근해야 하므로 켠다. 여기서 “공개 접근 차단”은
계정의 익명 Blob 공개와 두 컨테이너의 공개 ACL을 모두 끈다는 뜻이다. M2 계약은
Storage 계정 키를 Infisical에서 ACA secret으로 주입한다. 관리 ID로 바꾸기 전에는
`allow-shared-key-access=false`를 켜면 앱이 깨진다.

ACA 환경 생성 CLI는 Log Analytics customer ID와 shared key를 함께 요구한다.
`provision.sh`는 `GO` 뒤에만 key를 읽어 `az` 자식 프로세스 argv에 전달하고 출력하지 않은 뒤
즉시 shell 변수에서 제거한다.

## M2 저장소·환경 변수 계약

M2 Blob 백엔드는 음성과 문서를 같은 추상화로 저장한다. 컨테이너 이름은 코드 고정값
`voice`·`documents`다. Blob 본문은 `PII_ENC_KEY`에서 HKDF(`storage`)로 분리한 키와
AES-256-GCM으로 암호화하므로 별도 `VOICE_BLOB_ENC_KEY`는 만들지 않는다.

| Infisical 이름 | 앱 환경 변수 | ACA 처리 |
|---|---|---|
| `DATABASE_URL` | `DATABASE_URL` | secret, Supabase 서울 세션 풀러 그대로 |
| `PII_ENC_KEY` | `PII_ENC_KEY` | secret, PII와 Blob 파생키의 루트 |
| `SESSION_SECRET` | `SESSION_SECRET` | secret |
| `AZURE_STORAGE_ACCOUNT_KEY` | `AZURE_STORAGE_ACCOUNT_KEY` | secret |
| `RELAYER_OPENAI_API_KEY` | `OPENAI_API_KEY` | 선택 secret |
| `GEMINI_API_KEY` | `GEMINI_API_KEY` | 선택 secret |
| `AZURE_SPEECH_KEY` | `AZURE_SPEECH_KEY` | 선택 secret |
| `AI_PROVIDER`, `AI_MODEL` | 동일 | 선택 |
| `AZURE_SPEECH_REGION`, `AZURE_SPEECH_ENDPOINT` | 동일 | 선택 |
| `VOICE_ENABLED` | `VOICE_ENABLED` | 선택 |
| `RELAYER_SLUG`, `RELAYER_PUBLIC_URL` | 동일 | 선택, 기관 공개 주소 |

ACA에 직접 넣는 비밀 아닌 값은 `PORT=8787`, `STORAGE_BACKEND=blob`,
`AZURE_STORAGE_ACCOUNT=relayer2voice`다. `VOICE_ROOT`·`DOC_ROOT`는 Blob 모드에서 쓰지 않는다.

`scripts/azure/deploy.py`는 `.env` 권한 0600을 확인하고 secret 값을 0600 임시 JSON에만
쓴 뒤 `az containerapp update --yaml`로 전달하고 즉시 지운다. 값은 argv·출력에 나타나지 않는다.
기존 custom domain을 보존하도록 update spec에는 ingress를 넣지 않는다.

## 실행 순서

### 0. CLI와 서비스 프린시펄 로그인

디바이스 코드는 테넌트 조건부 액세스(`AADSTS530035`, 미등록 기기)로 막혔다. 재시도하지 않는다.
플래너가 등록된 맥북에서 브라우저 로그인 후 전용 서비스 프린시펄을 만들고, 다음 네 값을
Infisical `prod:/RELAYER2`에 넣는다.

| 이름 | 용도 |
|---|---|
| `AZURE_CLIENT_ID` | 서비스 프린시펄 application/client ID |
| `AZURE_CLIENT_SECRET` | 서비스 프린시펄 secret |
| `AZURE_TENANT_ID` | Entra tenant |
| `AZURE_SUBSCRIPTION_ID` | 배포 대상 subscription |

값이 들어왔다는 통보 뒤에만 실행한다.

```bash
./scripts/pull-secrets.sh
./scripts/azure/login.py
```

`pull-secrets.sh`는 `opsvc`를 통해 Infisical을 읽고 `.env`를 0600으로 만든다.
`login.py`는 플래너가 지정한 `az login --service-principal -u ... -p ... --tenant ...`를
스크립트 안에서 실행해 shell history에 남기지 않는다. Azure CLI 출력을 숨기고 subscription을
명시적으로 선택한 뒤 Infisical 값과 대조한다. 실행 중 client secret은 `az` argv에만 잠깐 존재한다.

### 1. 구독·권한·이름 사전 확인

```bash
az account show --query '{subscription:name,type:user.type}' --output table
SP_ID="$(az account show --query user.name --output tsv)"
az role assignment list --all --include-inherited --assignee "$SP_ID" \
  --query '[].roleDefinitionName' --output tsv
unset SP_ID
az storage account check-name --name relayer2voice \
  --query '{available:nameAvailable,reason:reason}' --output table
```

계정 type은 `servicePrincipal`이어야 한다. SP는 기존 `relayer2-prod` 범위 Contributor다.
`Microsoft.App`·`Microsoft.OperationalInsights`·`Microsoft.Storage`는 구독에서 미리 등록됐다.
RG 위치·상태와 Storage 이름 가용성을 확인하고, 값이 모호하면 생성을 시작하지 않는다.

### 2. 생성 전 dry-run

```bash
./scripts/azure/provision.sh
```

출력은 기존 리소스 그룹, Log Analytics, Storage, private 컨테이너 2개,
Consumption 환경, MCR 임시 이미지를 쓰는 Container App 순서여야 한다.
`[dry-run]`만 있어야 하며 Azure 변경은 0건이어야 한다.

### 3. 플래너 GO 뒤 프로비저닝

```bash
APPLY=1 PLANNER_GO=GO ./scripts/azure/provision.sh
```

M1 GHCR 이미지가 아직 게시되지 않았다면 MCR의
`mcr.microsoft.com/dotnet/samples:aspnetapp`을 임시로 사용한다. 이 이미지는
`ASPNETCORE_HTTP_PORTS=8787`로 target port에서 응답하도록 로컬 검증했다. M1이
`ghcr.io/socialsolidaritybank/relayer:0.2.0`을 public으로 게시하면 `deploy.py`로 교체한다.
ACR은 만들지 않는다.

### 4. Storage 키를 Infisical 정본에 넣기

Azure에서 읽은 값은 화면이나 argv에 내지 않는다. 아래 임시 파일은 0600이고 종료 때 지운다.

```bash
umask 077
storage_env="$(mktemp)"
trap 'rm -f "$storage_env"' EXIT
az storage account keys list --resource-group relayer2-prod --account-name relayer2voice \
  --query '[0].value' --output tsv |
  { IFS= read -r value; printf 'AZURE_STORAGE_ACCOUNT_KEY=%s\n' "$value" >"$storage_env"; }

opsvc="$HOME/.dotfiles/scripts/opsvc"
CLIENT_ID="$(OP_BIOMETRIC_UNLOCK_ENABLED=false "$opsvc" item get \
  'Infisical · account@ggbss.or.kr' --vault BSS --fields label=ggbss_client_ID --reveal)"
CLIENT_SECRET="$(OP_BIOMETRIC_UNLOCK_ENABLED=false "$opsvc" item get \
  'Infisical · account@ggbss.or.kr' --vault BSS --fields label=ggbss_client_secret --reveal)"
CLIENT_ID="$CLIENT_ID" CLIENT_SECRET="$CLIENT_SECRET" \
  PROJECT_ID="a7c44b37-a885-4c62-98cd-cbc8a9810de9" SECRET_PATH="/RELAYER2" \
  ENV_FILE="$storage_env" python3 scripts/infisical_put.py
unset CLIENT_ID CLIENT_SECRET
```

출력은 이름과 HTTP 상태만 확인한다. 키 값은 확인·복사하지 않는다.

### 5. Infisical → ACA 배포

```bash
./scripts/pull-secrets.sh
PLANNER_GO=GO ./scripts/azure/deploy.py
```

`pull-secrets.sh`는 `~/.dotfiles/scripts/opsvc`를 통해 `prod:/RELAYER2`를 읽는다.
`deploy.py`는 필수 이름 네 개가 없거나 `.env` 권한이 0600이 아니면 배포를 거절한다.

### 6. ACA 직접 검증

```bash
ACA_FQDN="$(az containerapp show --name relayer2 --resource-group relayer2-prod \
  --query properties.configuration.ingress.fqdn --output tsv)"
az containerapp exec --name relayer2 --resource-group relayer2-prod \
  --command "node api/src/migrate.ts --check"
curl -fsS "https://${ACA_FQDN}/health"
```

기대값은 각각 `migrations up to date`, `{"ok":true}`다. DNS는 이 두 검사가 끝날 때까지
바꾸지 않는다.

### 7. 음성·문서 이전

평문 `az storage blob upload`는 금지한다. M2의 앱 암호화 경로로만 올린다.

1. 맥미니 원본의 상대경로·크기·sha256 manifest를 만든다.
2. M2 이전 명령으로 `voice`·`documents`에 암호문을 쓴다.
3. DB의 `rel_path`·`bytes`·`sha256`과 Blob 목록을 대조한다.
4. 새 음성 1건과 문서 1건을 앱으로 올리고 읽기·삭제·보유기간 처리를 확인한다.
5. 맥미니 원본은 최소 1주 동안 지우지 않는다.

### 8. `relayer.kr` DNS 전환

ACA 관리 인증서에서 apex는 CNAME이 아니라 **환경 고정 IP를 가리키는 A 레코드**가 필요하다.
Cloudflare 프록시를 켜면 인증서 발급·갱신이 막히므로 DNS-only로 둔다.

```bash
STATIC_IP="$(az containerapp env show --name relayer2-env --resource-group relayer2-prod \
  --query properties.staticIp --output tsv)"
VERIFY_ID="$(az containerapp show --name relayer2 --resource-group relayer2-prod \
  --query properties.customDomainVerificationId --output tsv)"
```

1. Cloudflare의 현재 root 레코드 type·content·proxied·TTL을 롤백 기록으로 보존한다.
2. TXT `asuid=$VERIFY_ID`를 추가한다.
3. root `@`를 `A $STATIC_IP`, DNS-only로 바꾼다.
4. 다음을 실행한다.

```bash
az containerapp hostname add --hostname relayer.kr \
  --name relayer2 --resource-group relayer2-prod
az containerapp hostname bind --hostname relayer.kr \
  --name relayer2 --resource-group relayer2-prod \
  --environment relayer2-env --validation-method HTTP
curl -fsS https://relayer.kr/health
```

전환 중에도 맥미니 `or.bss.relayer`, Cloudflare Tunnel, Tailscale Funnel
`mac-mini.tail79fba7.ts.net`은 그대로 둔다.

### 9. 롤백

1. Cloudflare root 레코드를 8-1에서 보존한 값으로 복구한다.
2. `https://relayer.kr/health`가 맥미니 응답으로 돌아왔는지 확인한다.
3. ACA는 DNS에서 제외한 채 조사한다. 비용 중단이 필요하면 별도 승인 후 min 0으로 낮춘다.

DB가 같은 Supabase 서울이고 맥미니 앱·원본을 유지하므로 데이터 역이전은 없다.

## 비용 견적 (2026-09-18 Azure Retail Prices API, koreacentral, USD)

| 항목 | 단가·가정 | 월 추정 |
|---|---|---|
| ACA active | vCPU `$0.000024/s`, memory `$0.000003/GiB-s`; 0.25 vCPU·0.5 GiB | 월 200 active 시간까지 무료 할당량 안, 730시간 계속 active면 약 `$14.31` |
| ACA 요청 | 월 200만 요청 무료 | 예상 `$0` |
| Blob Hot LRS | 첫 구간 `$0.020/GB-month` | 10 GB면 `$0.20` + 작업·송신 |
| Log Analytics | 첫 5 GB/month 무료, 초과 `$3.11/GB` | 5 GB 이하 `$0` |
| Speech | 기존 `ccc-stt-koreacentral` 사용량 | 별도 사용량 과금 |

Consumption-only 환경 자체의 고정 관리비는 없다. 현재 min 1이므로 한 replica가 계속 active라는
보수적 가정으로 계산했다. 무료 할당량이 다른 ACA 앱에서 이미 소진되면 약 `$19.71/month`다.
계약 할인·비영리 크레딧·송신·작업 수수료는 제외한 소매가 견적이다.

근거:

- <https://learn.microsoft.com/en-us/azure/container-apps/billing>
- <https://prices.azure.com/api/retail/prices>
- <https://azure.microsoft.com/en-us/pricing/details/monitor/>
- <https://learn.microsoft.com/en-us/azure/container-apps/custom-domains-managed-certificates>

## 2026-09-18 실측 기록

| 단계 | 명령 | 결과 |
|---|---|---|
| CLI 설치 | `brew install azure-cli` | Azure CLI `2.90.0` 설치 |
| 디바이스 로그인 | `az login --use-device-code` | 조건부 액세스 `AADSTS530035`; 플래너 지시로 중단·코드 파일 삭제, 재시도 금지 |
| SP 로그인 | `./scripts/azure/login.py` | 성공; SP 구독 선택·대조, `relayer2-prod` `koreacentral`/`Succeeded` 확인 |
| Infisical 읽기 | `./scripts/pull-secrets.sh` | `opsvc` 경유 성공, `.env` 0600; SP 네 값과 Storage key 포함, 값 미출력 |
| 생성 dry-run | `./scripts/azure/provision.sh` | 전체 명령 출력, 변경 0건 |
| 프로비저닝 1차 | `APPLY=1 PLANNER_GO=GO ...` | Log Analytics·Storage·컨테이너 생성 후 ACA 환경에서 workspace key 요구 확인 |
| 프로비저닝 재개 | 같은 명령 | customer ID + shared key 계약으로 수정 후 환경·앱까지 성공 |
| Log Analytics | `az monitor log-analytics workspace show ...` | Korea Central, PerGB2018, retention 30, `Succeeded` |
| Storage | `az storage account show ...` | Korea Central, HTTPS only, TLS1.2, anonymous/cross-tenant false, `Succeeded` |
| Blob 컨테이너 | `az storage container-rm list ...` | `voice`·`documents`, public access 없음 |
| Storage key 정본 | `az ... keys list | ... infisical_put.py` | `opsvc` 경유 Infisical `AZURE_STORAGE_ACCOUNT_KEY` HTTP 200, 값 미출력 |
| ACA 환경 | `az containerapp env show ...` | Korea Central, Log Analytics, `Succeeded` |
| 임시 ACA 앱 | `az containerapp show ...` | external targetPort 8787, min/max 1, MCR placeholder, ready revision, `Succeeded` |
| ACA secrets | 이름·secretRef만 조회 | 필수 4개 + 현재 선택 2개 참조 확인, 값 미조회 |
| 임시 endpoint | ACA 기본 FQDN `curl` | HTTP `200` |
| M1 이미지 | `docker manifest inspect ...:0.2.0` | 아직 `denied`; 최종 앱·migration 대기 |
| DNS·롤백 | `dig`, hostname list, `curl https://relayer.kr/health` | Cloudflare A 유지, custom hostname `[]`, 맥미니 `{"ok":true}` |
| 로컬 이미지 | `docker build -t relayer:0.2.0-m3-rehearsal .` | 성공, manifest list `sha256:2263230929a21641fe08db60a86ad0bfc78d0920a32e65df91808e36cb9ab5ac` |
| 일회용 DB 리허설 | 전용 Docker network + PostgreSQL 16 | `migrations up to date` |
| 로컬 health | `curl -fsS http://127.0.0.1:18787/health` | `{"ok":true}` |
| 로컬 화면 | `curl ... http://127.0.0.1:18787/` | HTTP `200` |

일회용 컨테이너와 network는 검증 직후 삭제했다. 운영 체크아웃과 공유 DB는 사용하지 않았다.
