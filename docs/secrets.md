# 비밀값을 어디에 어떻게 두는가

이 문서만 보고 따라 할 수 있게 적는다. **값은 어디에도 붙여넣지 않는다** — 채팅, 파일, 커밋 전부.

---

## 1. 한 곳만 본다

```
Infisical
 └ 프로젝트: ggbss-agent          (ID a7c44b37-a885-4c62-98cd-cbc8a9810de9)
    └ 환경: prod
       └ 폴더: /RELAYER2          ← 릴레이어 값은 전부 여기
```

**왜 여기인가.** 릴레이어를 읽는 자격(머신 ID `ggbss-agent`)이 이 프로젝트에만 붙어 있다.
다른 프로젝트(`relayer-u-glt` 등)에 두면 읽지 못한다. 프로젝트 전용 머신 ID 는
다른 프로젝트로 빌려줄 수 없기 때문이다(2026-09-15 확인).

제품 격리는 **폴더**가 한다. `/CCC`, `/ggbss-web`, `/RELAYER2` 가 서로 안 섞인다.
루트 `/` 에는 **넣지 않는다** — 거기 값은 CCC 와 공유되고, 실제로 그것 때문에
OpenAI 키 하나가 죽으면서 두 제품이 같이 멈췄다.

---

## 2. 무엇이 들어 있고, 무엇을 넣어야 하나

### 이미 있는 것 (없으면 배포가 멈춘다)

| 이름 | 무엇 |
|---|---|
| `DATABASE_URL` | Supabase 연결 문자열 |
| `PII_ENC_KEY` | 이름·연락처 금고 열쇠 |
| `SESSION_SECRET` | 로그인 쿠키 서명 열쇠 |

### 넣어야 할 것 (없으면 AI 정리만 안 된다)

| 이름 | 무엇 | 없으면 |
|---|---|---|
| `RELAYER_OPENAI_API_KEY` | OpenAI 서비스 계정 키 (`sk-svcacct-…`) | AI 정리 요청이 503 |
| `GEMINI_API_KEY` | Google Gemini 키 (예비 제공자) | 위와 같음 |
| `AI_PROVIDER` | `openai` 또는 `gemini` | 기본 `openai` |
| `AI_MODEL` | 모델 이름. 비워 두면 알아서 고른다 | 기본값 사용 |

**AI 키는 선택이다.** 없으면 배포 스크립트가 그냥 건너뛰고 나머지는 정상으로 돈다.
없는 것을 있는 척하지 않는다 — AI 정리만 503 으로 정확히 실패한다.

### 음성 업로드·전사 설정

`scripts/infisical_get.py`는 아래 고정 이름을 선택적으로 주입한다. 모두 RELAYER2의 같은 `prod /RELAYER2` 경로를 사용한다.

| 이름 | 용도 |
|---|---|
| `VOICE_ENABLED` | `1`일 때 음성 업로드 허용 |
| `VOICE_ROOT` | 배포 교체 후에도 유지되는 기관 음성 저장 경로 |
| `AZURE_SPEECH_KEY` | RELAYER2가 사용하는 Azure Speech 인증 |
| `AZURE_SPEECH_REGION` | 해당 Speech 리소스의 지역 |
| `AZURE_SPEECH_ENDPOINT` | 리소스 전용 HTTPS 엔드포인트. 지역 대신 지정 가능 |

2026-09-16 Q가 기존 키 재사용을 허용하여, `ccc-stt-koreacentral`의 **기존 KEY 2**를 이 경로에 등록했다.
`AZURE_SPEECH_REGION=koreacentral`, `VOICE_ENABLED=1`도 등록했다. 기존 Azure 키의 재생성이나 CCC 설정 변경은 하지 않았다.
Azure 인증 HTTP 200과 합성 한국어 음성의 Fast Transcription → 승인 → 숫자 불일치 비교를 검증했다.

이 키는 기존 Speech 리소스를 공유하므로 사용량·요금·키 회전의 영향을 함께 받는다. 향후 KEY 2를 회전하면 RELAYER2도 갱신해야 한다.
키 값은 출력하거나 별도 파일로 저장하지 않았으며, 실제 사람의 녹음은 검증에 사용하지 않았다. 운영 프로세스 반영 여부는 코드 배포와 별도로 확인한다.

---

## 3. 넣는 방법 (웹에서, 5단계)

1. <https://app.infisical.com> 로그인
2. 프로젝트 **`ggbss-agent`** 열기
3. 왼쪽 **Secrets** → 위쪽 환경에서 **`prod`** 선택
4. 폴더 목록에서 **`RELAYER2`** 클릭 (주소창 끝이 `secretPath=%2FRELAYER2` 가 된다)
5. **Add Secret** → 이름 `RELAYER_OPENAI_API_KEY`, 값에 키 붙여넣기 → 저장

> 이름을 **정확히** 그대로 쓴다. 배포 스크립트가 이 이름을 찾는다
> (`scripts/infisical_get.py` 의 `OPTIONAL`). 앱 안에서는 `OPENAI_API_KEY` 로 바뀌어 들어간다.

### 옮기는 경우 (다른 프로젝트에 이미 만들었다면)

값을 화면에 띄워 복사하지 말고, **원래 자리에서 지우고 여기서 새로 만든다.**
OpenAI 콘솔에서 키를 새로 뽑는 편이 더 안전하다 — 옮기는 동안 값이 화면·클립보드에 남지 않는다.

---

## 4. 확인하는 방법

```bash
cd ~/DEVELOPER/PROJECTS/RELAYER2
./scripts/ai-provider.sh
```

```
지금 제공자: openai   (Infisical: ggbss-agent · prod · /RELAYER2)
  openai  200        ← 200 이면 살아 있는 키
  gemini  키없음
```

`401` 이면 키가 폐기된 것이고, `키없음` 이면 그 이름이 폴더에 없는 것이다.
**값은 절대 출력하지 않는다.** 상태코드만 본다.

제공자를 바꿀 때:

```bash
./scripts/ai-provider.sh openai
```

> 바꾼 뒤에는 **외부 LLM·국외 처리 동의를 다시 받아야 한다.** 수신자(OpenAI / Google)가
> 동의 문안 해시에 묶여 있어서, 바뀌는 순간 기존 동의가 `확인 필요`로 떨어지고
> 초안 요청이 409 로 막힌다. 고장이 아니라 설계다(`SPEC.md` §15).

---

## 5. 자격(머신 ID)은 어디에 적어 두나

### 지금 쓰는 것

```
1Password · BSS 금고
  항목: "Infisical · account@ggbss.or.kr"     (UUID l34nxgvhlqrca67cikcdpetsfe)
    ggbss_client_ID        ← universal-auth client id   (이 둘로 로그인한다)
    ggbss_client_secret    ← universal-auth client secret
    ggbss_machine_id       ← e184b6da-a4e8-4537-8125-e28bf040f127
    ggbss_project_access_token  ← 서비스 토큰. **쓰지 않는다** (아래 참고)
```

### 이름이 비슷한 것이 넷 있다. 헷갈리지 말 것

| 이름 | 성격 | 우리 것 |
|---|---|---|
| `agent` | 조직 전역 · 회사 내부용 | ✗ |
| `hermes-bss` | 조직 전역 | ✗ |
| `bss-agent` | `hermes-bss` 프로젝트 전용 | ✗ |
| **`ggbss-agent`** | `ggbss-agent` 프로젝트 전용 · Admin | **✅ 이것** |

**어느 자격인지 1초에 확인하는 법** — 로그인 토큰이 스스로 이름을 말한다.

```bash
# JWT payload 를 디코드하면 identityName 이 나온다. 값은 노출되지 않는다.
printf %s "$ACCESS_TOKEN" | cut -d. -f2 | python3 -c "
import sys,base64,json
s=sys.stdin.read().strip(); s+='='*(-len(s)%4)
print(json.loads(base64.urlsafe_b64decode(s))['identityName'])"
```

접근 가능한 프로젝트 목록:

```
GET https://app.infisical.com/api/v1/workspace   (Bearer <access token>)
```

### 프로젝트 ID 를 쓰는 곳

자격은 위 항목 하나뿐이다. 새로 만들 일은 없다. 다만 값의 위치를 옮기면
코드 두 군데를 같이 고친다.

```
scripts/wire-secrets.sh    INFISICAL_PROJECT_ID / INFISICAL_PATH
scripts/ai-provider.sh     PROJECT_ID / SECRET_PATH
```

---

## 6. 하지 말 것

- 값을 채팅·파일·커밋·스크린샷에 남기기
- 루트 `/` 에 릴레이어 값 넣기 (CCC 와 공유된다)
- `ggbss_project_access_token`(서비스 토큰) 쓰기
  — 스코프가 루트뿐이라 `/RELAYER2` 를 못 읽는다. Infisical 도 폐기 예정이다
- CLI `infisical secrets set` 으로 값 올리기
  — 값이 `argv` 에 실려 `ps` 에 보인다. `scripts/infisical_put.py` 가 HTTP 로 올린다
- 릴레이어 자격을 CCC 와 공유하기 (반대 방향도)

---

## 7. 로테이션이 일어났을 때

2026-09-15 에 CCC 쪽이 공용 자격을 갈고 Infisical 폴더 이름을 대문자로 바꿨다.
**릴레이어2는 아무것도 끊기지 않았다.** 우리가 읽는 자리가 그쪽과 겹치지 않기 때문이다.

확인하는 법은 간단하다. 우리가 실제로 읽는 이름을 코드에서 세어 보면 된다.

```bash
for n in CLOUDFLARE_WORKERS_API_TOKEN CCC_LINEAR_API_KEY AZURE_SPEECH_KEY RELAYER_PII_ENC_KEY; do
  printf '%-32s ' "$n"
  grep -rl "$n" --include="*.ts" --include="*.sh" --include="*.py" . 2>/dev/null | grep -v node_modules | wc -l
done
```

전부 `0` 이면 무관하다. 이름이 비슷해도 **프로젝트가 다르면 남의 것**이다 —
`RELAYER_PII_ENC_KEY` 는 RELAYER 프로젝트 것이고, 우리 것은 `/RELAYER2` 폴더의
접두 없는 `PII_ENC_KEY` 다.

값이 바뀌었는지는 지문으로 본다. 값을 보지 않고도 같은지 다른지 알 수 있다.

```bash
# 이름과 sha256 앞 8자만 낸다. 값은 메모리 밖으로 나가지 않는다.
./scripts/ai-provider.sh          # 제공자 키 상태(HTTP 상태코드만)
```
