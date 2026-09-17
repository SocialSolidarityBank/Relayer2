# Azure 이전 준비 (koreacentral)

앱을 맥미니에서 **Azure Container Apps(koreacentral)** 로 옮기고, 음성 원본을 맥미니 디스크에서
**Azure Blob(앱 수준 암호화)** 로 옮기는 작업의 런북이다. **이 문서는 준비다 — 자원을 만들지 않는다.**

기록된 견적: 고정비 연 ~$270 + 전사 사용량분.

## 지금 상태 (2026-09-17)

| | 지금 | 목표 |
|---|---|---|
| 앱 | 맥미니 `~/services/relayer2` (launchd `or.bss.relayer`) | Azure Container Apps |
| 공개 주소 | `relayer.kr` → Cloudflare Tunnel → 맥미니 `:8790`, 대비책 Funnel | `relayer.kr` → Tunnel → ACA FQDN (또는 ACA 사용자 도메인) |
| DB | Supabase `relayer2` (서울) | **그대로 둔다** |
| 음성 | 맥미니 디스크 `VOICE_ROOT` — **백업 없음** | Blob 컨테이너, 앱이 암호화해 넣는다 |
| 문서 | 맥미니 디스크 `DOC_ROOT` — 백업 없음 | 별도 결정(아래 열린 일) |
| STT | `ccc-stt-koreacentral` — 릴레이어 전용으로 이미 있음 | 그대로 |

## 전제

- `az` CLI: **설치됨**(`/opt/homebrew/bin/az`), **로그인 안 됨** — `az login` 은 사람이 브라우저로 한다.
- Infisical `ggbss-agent · prod · /RELAYER2` 가 시크릿 정본(`docs/secrets.md`).
- 음성의 Blob 저장은 **코드 변경이 필요하다.** 지금 앱은 `VOICE_ROOT` 파일시스템만 안다
  (`api/src/stt.ts`). Blob 백엔드와 앱 수준 암호화는 별도 코드 레인이다. 이 런북은 그 착지점을
  준비하고, 새 환경 변수 이름을 제안한다.

## 만들 자원

| 자원 | 이름(안) | 비고 |
|---|---|---|
| 리소스 그룹 | `relayer2-prod` | koreacentral |
| Container Apps 환경 | `relayer2-env` | 소비(Consumption) 플랜 |
| Container App | `relayer2` | ingress external, targetPort 8787, min 0 / max 1 |
| Storage 계정 | `relayer2voice` | Standard_LRS, 공개 접근 차단, TLS1.2+ |
| Blob 컨테이너 | `voice` | private. 서버 측 암호화는 기본, **앱 수준 암호화가 본체** |
| Key Vault | (선택) | **Infisical 을 계속 쓰면 만들지 않는다.** 이중 정본을 피한다 |

`scripts/azure/provision.sh` 가 이 목록을 만든다 — 기본은 DRY-RUN 이고 `APPLY=1` 일 때만 실행한다.

## 환경 변수 매핑

정본은 Infisical `prod:/RELAYER2` 다. Container Apps 에는 `az containerapp secret set` +
`--secrets`/`--env-vars ... secretref:` 로 주입한다. **값을 스크립트·문서·argv 에 적지 않는다** —
`scripts/infisical_get.py` 가 `.env`(600) 를 만들면 그 파일에서 `az` 가 읽게 한다.

| Infisical 이름 | 앱이 읽는 이름 | 비고 |
|---|---|---|
| `DATABASE_URL` | `DATABASE_URL` | Supabase 그대로. 세션 풀러(5432) 유지 |
| `PII_ENC_KEY` | `PII_ENC_KEY` | 백업과 다른 곳 — Infisical 에만 |
| `SESSION_SECRET` | `SESSION_SECRET` | |
| `RELAYER_OPENAI_API_KEY` | `OPENAI_API_KEY` | 선택. 없으면 AI 정리만 503 |
| `GEMINI_API_KEY` | `GEMINI_API_KEY` | 선택 |
| `AI_PROVIDER` / `AI_MODEL` | 동일 | 선택 |
| `AZURE_SPEECH_KEY` | `AZURE_SPEECH_KEY` | `ccc-stt-koreacentral` 기존 KEY 2 |
| `AZURE_SPEECH_REGION` | `AZURE_SPEECH_REGION` | `koreacentral` |
| `AZURE_SPEECH_ENDPOINT` | `AZURE_SPEECH_ENDPOINT` | 있으면 지역 대신 사용 |
| `VOICE_ENABLED` | `VOICE_ENABLED` | `1` |
| `VOICE_ROOT` | — | **Blob 백엔드로 대체. 아래 신규 이름** |
| — | `PORT` | 8787 (ACA targetPort 와 맞춘다) |

신규 이름(제안 — Blob 백엔드 코드가 읽을 자리):

| 이름 | 무엇 |
|---|---|
| `VOICE_BLOB_ACCOUNT` | Storage 계정 이름 |
| `VOICE_BLOB_CONTAINER` | `voice` |
| `VOICE_BLOB_ENC_KEY` | 앱 수준 암호화 열쇠(base64 32바이트). Infisical `/RELAYER2` 에 새로 만든다 |
| `VOICE_BLOB_CONN` 또는 관리 ID | 업로드 자격. 관리 ID + RBAC(`Storage Blob Data Contributor`)이면 비밀번호가 없다 |

## 단계

### 0. 준비 (사람)

```bash
az login
./scripts/azure/provision.sh            # DRY-RUN — 무엇을 만들지 눈으로 확인
APPLY=1 ./scripts/azure/provision.sh    # 실제 생성
```

### 1. 이미지

```bash
docker build -t relayer:<태그> .
# ACR 없이 GHCR/DOCKER Hub 에 올리거나, az acr 을 추가한다(선택).
az containerapp update -n relayer2 -g relayer2-prod --image <레지스트리>/relayer:<태그>
```

### 2. 시크릿 주입

```bash
./scripts/pull-secrets.sh               # .env(600) 생성 — 값은 화면에 안 나온다
# .env 의 이름을 az containerapp secret set 으로 옮긴다. 값은 파일에서만 읽는다.
```

### 3. 음성 이전

맥미니 `VOICE_ROOT` 의 파일을 Blob 으로 옮긴다. **앱 수준 암호화가 들어가면 평문 업로드는 안 된다** —
`az storage blob upload` 로 올린 평문은 새 백엔드가 못 읽는다. 순서:

1. `./scripts/azure/voice-inventory.sh "$VOICE_ROOT" > voice-manifest.tsv` — 상대경로·크기·sha256 목록.
   `recordings` 표의 `rel_path`·`bytes`·`sha256` 와 1:1 로 맞아야 한다.
2. Blob 백엔드 코드가 착지하면, **암호화 경로를 타는 이전 스크립트**로 올린다(코드 레인 산출물).
3. 올린 뒤 manifest 와 Blob 목록을 대조한다. 맥미니 원본은 검증이 끝날 때까지 **지우지 않는다.**

### 4. 전환 (cutover)

`relayer.kr` 은 Cloudflare Tunnel 이 잡고 있다. DNS 를 건드리지 않고 **터널의 origin 만 바꾼다**:

```bash
# 맥미니 ~/.cloudflared/config.yml — origin 을 ACA FQDN 으로
ssh mini 'launchctl kickstart -k gui/$(id -u)/or.bss.relayer-tunnel'
```

- 전환 전: origin `http://127.0.0.1:8790` (맥미니 앱)
- 전환 후: origin `https://<앱>.<환경>.koreacentral.azurecontainerapps.io`
- Funnel(`mac-mini.tail79fba7.ts.net`)은 맥미니 앱을 계속 가리키게 둔다 — **대비책이자 롤백 경로.**
- 맥미니 앱(`or.bss.relayer`)은 소거 기간 동안 **켜 둔다.** 같은 DB 를 보므로 양쪽이 동시에 살아 있어도 된다.

### 5. 롤백

```bash
# config.yml 의 origin 을 http://127.0.0.1:8790 으로 되돌리고 터널 재시작
ssh mini 'launchctl kickstart -k gui/$(id -u)/or.bss.relayer-tunnel'
```

DB 가 Supabase 에 그대로이므로 롤백은 **터널 한 줄**이다. 음성은 맥미니 원본을 지우지 않았으므로
맥미니 앱이 그대로 읽는다. ACA 쪽 자원은 끄기만 하면 과금이 멈춘다(min 0).

## 비용 (추정)

| 항목 | 추정 |
|---|---|
| Container Apps (0.25 vCPU / 0.5Gi 상시) | ~$12/월 |
| Blob LRS (수 GB) | ~$1/월 이하 |
| 기타(로그·송신) | 수 $/월 |
| **고정비 합계** | **~$270/년 안팎** (기록된 견적) |
| Speech 전사 | 사용량당 — `ccc-stt-koreacentral` 기존 과금에 붙는다 |

실제 수치는 레플리카 크기와 상시 여부에 따라 움직인다. min-replicas 0 이면 콜드 스타트가 생긴다 —
관문 측정 중에는 1 로 둔다.

## 검증

```bash
# 마이그레이션 미적용이 없어야 0
az containerapp exec -n relayer2 -g relayer2-prod --command "node api/src/migrate.ts --check"
# 또는 이미지 부팅 로그에서 migrate → listen 순서를 확인

curl -fsS https://<앱>.<환경>.koreacentral.azurecontainerapps.io/health   # {"ok":true}
curl -fsS https://relayer.kr/test/health                                # 전환 후 같은 응답
```

- `/api/.../status` 의 `db.connected`, `stt.connected`, `ai.connected` 를 본다(`routes.ts`).
- 음성: manifest 대조 + 새 녹음 1건 업로드 → Blob 에 암호문으로 있는지 확인 → 전사 1건.
- 소거 기간(최소 1주) 동안 맥미니 앱·Funnel·원본 파일을 유지하고, 이상 없으면 내린다.

## 열린 일

- **Blob 백엔드 코드**: `stt.ts` 가 `VOICE_ROOT` 파일시스템만 안다. Blob 읽고 쓰기 + 앱 수준
  암호화(`VOICE_BLOB_ENC_KEY`) + 보유기간 스윕의 Blob 판이 필요하다.
- **`DOC_ROOT`**: 문서도 맥미니 디스크다. ACA 에는 영구 디스크가 없다 — Azure Files 마운트 또는
  같은 Blob 경로로 옮길지 별도 결정.
- **ACR**: 이미지 레지스트리를 어느 것으로 할지(GHCR 이면 자원 추가 없음).
- `az login` 후 첫 실행에서 구독·지역 권한을 확인한다.
