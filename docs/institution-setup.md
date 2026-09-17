# 기관 IT 담당자를 위한 설치 안내

이 문서는 **기관의 IT 담당자가 비밀값을 한 번도 보지 않고** 릴레이어가 필요로 하는
외부 서비스 네 곳을 준비하는 절차다. 각 절에서 "무엇을 만들고", "앱이 어떤 이름의
환경 변수를 기다리는지", "그 값을 어디에 두는지"만 다룬다. **값 자체는 이 문서에도,
채팅에도, 커밋에도 적지 않는다.**

비밀값의 정본은 `docs/secrets.md`, 배포 절차의 정본은 `docs/deploy.md`다.
이 문서는 그 둘을 기관 입장에서 다시 정리한 것이다.

---

## 0. 전체 그림

```
기관 서버(맥미니 등)
 └ 릴레이어 앱 (node api/src/index.ts, 한 프로세스가 API+화면)
     ├─ .env  ← Infisical 에서 스크립트가 내려받는다 (사람이 값을 옮기지 않는다)
     │
     ├─ Supabase (서울)        ← 상담 기록 DB
     ├─ Azure Speech (한국중부) ← 녹음 전사(STT)
     ├─ OpenAI                 ← 상담 내용 AI 정리
     └─ Infisical              ← 위 비밀값들의 보관소
```

앱이 읽는 환경 변수는 두 부류다.

| 부류 | 이름 | 없으면 |
|---|---|---|
| **필수** | `DATABASE_URL`, `PII_ENC_KEY`, `SESSION_SECRET` | 배포가 멈춘다 (`scripts/infisical_get.py` 의 `WANT`) |
| **선택** | `OPENAI_API_KEY`, `GEMINI_API_KEY`, `AI_PROVIDER`, `AI_MODEL`, `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`, `AZURE_SPEECH_ENDPOINT`, `VOICE_ENABLED`, `VOICE_ROOT` | 그 기능만 정확히 실패한다. AI 정리는 503, 전사는 "설정이 없다" 안내. 나머지는 정상 동작 |

그 외 코드가 읽는 선택 변수: `PORT`(기본 8787, 상시 실행은 8790), `PGSCHEMA`(전용 스키마를 쓸 때만), `DOC_ROOT`(문서 저장 경로, 기본 `./documents`), `STT_CONCURRENCY`(동시 전사 수, 기본 2).

---

## 1. Supabase — 상담 기록 DB

### 만들 것

1. [supabase.com](https://supabase.com) 에서 프로젝트를 새로 만든다.
   - **이름**: `relayer2` (현재 운영 프로젝트와 같은 이름)
   - **리전**: **서울(`ap-northeast-2`)** — 실데이터 전환 때 옮기지 않으려면 처음부터 서울에 둔다
   - **요금제**: **Pro** — 무료 플랜은 7일 무활동이면 일시정지된다. 실무자가 며칠 안 들어오면 서비스가 멈춘다
   - **스키마**: `public` 그대로 (전용 프로젝트라 가를 이유가 없다)
2. **전용 프로젝트로 만든다.** 다른 제품(CCC 등)과 같은 프로젝트를 쓰면
   `audit_log`·`consent_events` 같은 표 이름이 겹쳐 마이그레이션·백업·권한이 서로 걸린다.
   실제로 그래서 2026-09-15 에 분리했다.
3. 접속 문자열은 **세션 풀러(포트 5432)** 것을 쓴다. 앱이 상시 프로세스라
   prepared statement 를 살리는 쪽이 빠르다. 트랜잭션 풀러(6543)를 쓰면 `prepare` 가 꺼진다.
   TLS·prepare 설정은 주소를 보고 앱이 알아서 정한다(`api/src/db.ts`).

### 앱이 기다리는 이름

| 환경 변수 | 내용 |
|---|---|
| `DATABASE_URL` | Supabase 세션 풀러 접속 문자열 |

### 값을 두는 곳

- Infisical `ggbss-agent` · `prod` · `/RELAYER2` 에 `DATABASE_URL` 로 등록
- 호스트의 `.env` (권한 0600) — `scripts/pull-secrets.sh` 가 내려받는다
- **저장소·백업·로그 어디에도 적지 않는다**

### 로테이션

DB 비밀번호를 재설정하면 `DATABASE_URL` 전체가 바뀐다. Infisical 의 값을 새 것으로
갈아 끼우고 각 기기에서 `pull-secrets.sh` 를 다시 돌린 뒤 앱을 재시작한다.

---

## 2. Azure Speech — 녹음 전사(STT)

### 만들 것

1. Azure Portal 에서 **Speech 서비스** 리소스를 만든다.
   - **이름**: `ccc-stt-koreacentral` (현재 운영 리소스)
   - **리전**: **한국 중부(`koreacentral`)**
   - **SKU**: **S0** (표준 유료 — Fast Transcription 은 S0 에서만 된다)
2. 리소스의 **키 2개(KEY 1·KEY 2)** 와 **엔드포인트** 가 생긴다.
   둘 중 하나만 앱에 등록하면 된다 — 현재는 KEY 2 를 쓴다(아래 로테이션 참고).

### 앱이 기다리는 이름

| 환경 변수 | 내용 | 없으면 |
|---|---|---|
| `VOICE_ENABLED` | `1` 이면 음성 업로드 기능을 켠다 | 업로드 자체가 닫힌다 |
| `AZURE_SPEECH_KEY` | Speech 리소스의 KEY 1 또는 KEY 2 | 전사 불가 |
| `AZURE_SPEECH_REGION` | `koreacentral` | `AZURE_SPEECH_ENDPOINT` 가 있으면 생략 가능 |
| `AZURE_SPEECH_ENDPOINT` | 리소스 전용 HTTPS 엔드포인트 | `AZURE_SPEECH_REGION` 이 있으면 생략 가능 |
| `VOICE_ROOT` | 녹음 파일 저장 경로 (기본 `./voice`) | 기본 경로 사용. **배포 교체 후에도 유지되는 경로**로 잡는다 |

전사가 준비되려면 `VOICE_ENABLED=1` **+** 키 **+** (지역 또는 엔드포인트) 셋이
모두 있어야 한다(`api/src/consent.ts` 의 `sttEnabled()`).

### 값을 두는 곳

- Infisical `ggbss-agent` · `prod` · `/RELAYER2` 에 위 이름 그대로 등록
- 호스트 `.env` 는 `pull-secrets.sh` 가 채운다

### 로테이션·비용 메모 (알려진 것)

- **KEY 1 은 재생성됐다** — CCC 쪽에 남아 있던 사본을 무효화하기 위해서다.
  **KEY 2 가 릴레이어의 키다.** CCC 와 같은 Speech 리소스를 공유하므로
  사용량·요금·키 회전의 영향을 함께 받는다. KEY 2 를 회전하면 릴레이어 쪽
  `AZURE_SPEECH_KEY` 도 갱신해야 한다.
- **비영리 크레딧 $2,000/년, 만료 2027-09-03.** 만료 30일 전부터 갱신 버튼이
  뜨고, **이월은 없다.** 만료 전에 갱신 신청을 넣어 두는 것이 안전하다.
- 앱의 녹음 상한은 200MiB(`SPEECH_MAX_BYTES`)로 Azure Fast Transcription
  한도(300MB·2시간) 안이다.

### 왜 `azure` 로 못박혀 있나

`api/src/stt.ts` 의 `PROVIDER` 가 `'azure'` 로 코드에 고정돼 있다.
동의 문안이 "수신자 Microsoft Corporation · 국외 처리 US" 를 적어 당사자 동의를
받기 때문에, 다른 전사 업체로 바꾸려면 **코드와 동의 문안(정본)을 먼저 고쳐야 한다.**
환경 변수 `STT_PROVIDER` 로 바꿀 수 있는 값도 `azure` 뿐이다.

---

## 3. OpenAI — 상담 내용 AI 정리

### 만들 것

1. OpenAI 플랫폼에서 **서비스 계정 키**(`sk-svcacct-…`)를 발급한다.
   개인 API 키가 아니라 서비스 계정 키를 쓴다 — 사람이 나가도 키가 살아 있다.
2. 예비 제공자로 Google Gemini 키를 함께 둘 수 있다(선택).

### 앱이 기다리는 이름

| Infisical 이름 | 앱이 읽는 이름 | 비고 |
|---|---|---|
| `RELAYER_OPENAI_API_KEY` | `OPENAI_API_KEY` | `infisical_get.py` 가 이름을 바꿔 `.env` 에 쓴다 |
| `GEMINI_API_KEY` | `GEMINI_API_KEY` | 예비 제공자 |
| `AI_PROVIDER` | `AI_PROVIDER` | `openai` 또는 `gemini`. 기본 `openai` |
| `AI_MODEL` | `AI_MODEL` | 비워 두면 앱이 고른다(현재 `gpt-5.5` / `gemini-flash-latest`) |

### 값을 두는 곳

- Infisical `ggbss-agent` · `prod` · `/RELAYER2` — **루트 `/` 에 넣지 않는다.**
  루트 값은 CCC 와 공유되고, 실제로 OpenAI 키 하나가 죽으면서 두 제품이 같이 멈춘 적이 있다.
- 등록은 웹에서: app.infisical.com → `ggbss-agent` → Secrets → `prod` → 폴더 `RELAYER2` → Add Secret.
  이름을 정확히 그대로 쓴다.
- CLI `infisical secrets set` 은 쓰지 않는다 — 값이 `argv` 에 실려 `ps` 에 보인다.
  스크립트로 올릴 때는 `scripts/infisical_put.py`(HTTP)를 쓴다.

### 운영상 의미 — `store: false` 와 `AI_PROVIDER` 검증

- **`store: false`**: OpenAI Responses API 호출에 붙이는 저장 거부 플래그다.
  요청·응답이 OpenAI 쪽에 보관되지 않게 하는 운영 요건이다. API 를 호출하는
  코드를 고칠 때 이 플래그를 빼면 안 된다 — 당사자 상담 내용이 제공자 저장소에
  남는 것을 막는 장치다.
- **`AI_PROVIDER` 검증**: `scripts/ai-provider.sh` 는 `openai`·`gemini` 외 값을
  거부하고(exit 2), 바꾸기 전에 새 키로 실제 HTTP 요청을 날려 **200 이 나올 때만**
  `.env` 를 바꾼다. 죽은 키로 제공자를 바꾸는 사고를 막는 장치다.
- **제공자를 바꾸면 동의를 다시 받는다.** 수신자(OpenAI/Google)가 동의 문안 해시에
  묶여 있어서, 바꾸는 순간 기존 동의가 `확인 필요`로 떨어지고 초안 요청이 409 로
  막힌다. 고장이 아니라 설계다(`SPEC.md` §15).

### 확인

```bash
./scripts/ai-provider.sh     # 제공자별 키 상태를 HTTP 코드로만 보여 준다 (값은 안 나온다)
```

`401` = 키 폐기됨, `키없음` = Infisical 폴더에 그 이름이 없음.

---

## 4. Infisical — 비밀값 보관소

### 구조 (이대로 만든다)

```
Infisical
 └ 프로젝트: ggbss-agent          (ID a7c44b37-a885-4c62-98cd-cbc8a9810de9)
    └ 환경: prod
       └ 폴더: /RELAYER2          ← 릴레이어 값은 전부 여기
```

- **왜 이 프로젝트인가**: 릴레이어를 읽는 머신 ID `ggbss-agent` 가 이 프로젝트에만
  붙어 있다. 프로젝트 전용 머신 ID 는 다른 프로젝트로 빌려줄 수 없다.
- **제품 격리는 폴더가 한다**: `/CCC`, `/ggbss-web`, `/RELAYER2` 가 서로 안 섞인다.
- **루트 `/` 에는 넣지 않는다** — CCC 와 공유된다.

### 넣을 값 목록 (이름만)

| 필수 | 선택(AI·음성) |
|---|---|
| `DATABASE_URL` | `RELAYER_OPENAI_API_KEY`, `GEMINI_API_KEY`, `AI_PROVIDER`, `AI_MODEL` |
| `PII_ENC_KEY` (base64 32바이트) | `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`, `AZURE_SPEECH_ENDPOINT` |
| `SESSION_SECRET` | `VOICE_ENABLED`, `VOICE_ROOT` |

### 기관 서버에 내리는 법

```bash
./scripts/pull-secrets.sh    # Infisical → 이 기기의 .env (0600)
```

- 읽기는 **Machine Identity `ggbss-agent`(universal-auth)** 로 한다.
  `ggbss_project_access_token`(서비스 토큰)은 스코프가 루트뿐이라 `/RELAYER2` 를
  못 읽는다 — **쓰지 않는다.**
- 머신 ID 자격은 1Password `BSS` 금고의 `Infisical · account@ggbss.or.kr` 항목에 있다
  (`ggbss_client_ID` / `ggbss_client_secret` / `ggbss_machine_id`).
- 이름이 비슷한 머신 ID 가 넷 있다(`agent`, `hermes-bss`, `bss-agent`, `ggbss-agent`).
  우리 것은 **`ggbss-agent`** 뿐이다. 헷갈리면 `docs/secrets.md` §5 의 토큰 확인법을 쓴다.

### 하지 말 것

- 값을 채팅·파일·커밋·스크린샷에 남기기
- `docker run -e NAME=값` — 값이 argv 와 셸 이력에 남는다. `--env-file .env` 만 쓴다
- `PII_ENC_KEY` 를 백업과 같은 자리에 두기 — 잃으면 자유 글과 금고를 영영 못 읽는다
- 다른 제품의 자격·폴더와 섞어 쓰기 (어느 방향이든)

---

## 5. 설치 체크리스트

1. [ ] Supabase 프로젝트 `relayer2` 생성 — 서울(`ap-northeast-2`), Pro, 전용
2. [ ] Azure Speech `ccc-stt-koreacentral` 확인/생성 — 한국중부, S0
3. [ ] OpenAI 서비스 계정 키 발급
4. [ ] Infisical `ggbss-agent` · `prod` · `/RELAYER2` 에 위 표의 이름으로 등록
5. [ ] 기관 서버에서 `./scripts/pull-secrets.sh` → `.env` 생성 확인 (권한 0600)
6. [ ] `node api/src/migrate.ts` → `node api/src/index.ts` 로 기동
7. [ ] `./scripts/ai-provider.sh` 로 AI 키 상태 확인 (200)
8. [ ] 음성을 쓴다면 `VOICE_ENABLED=1` + 키 + 지역이 모두 내려왔는지 확인
9. [ ] 비영리 크레딧 만료일(2027-09-03)을 달력에 등록 — 30일 전 갱신 버튼
