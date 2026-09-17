# 배포 (0.1.0 / 0.2.0-P1)

관문 2를 제대로 재려면 실무자가 **자기 자리에서 자기 기기로** 들어와야 한다. 사내망 임시 공개로는 약속을 잡아야 하고, 약속을 잡으면 "시험한다"는 의식이 생겨 평소 속도가 안 나온다.

## 한 프로세스다

API 가 만들어진 화면을 함께 낸다. 앞단을 둘로 두면 쿠키·프록시가 따라 늘어난다.

```
node api/src/migrate.ts && node api/src/index.ts
```

- 개발에서는 vite 가 화면을 내고 `/api` 로 프록시한다. `web/dist` 가 없으면 이 경로는 건너뛴다.
- 배포에서는 같은 출처라 프록시가 없다(`web/src/api.ts` 의 `BASE`).
- 화면 껍데기(HTML·JS·CSS)는 로그인 전에도 받는다. 자료를 내는 API 는 전부 막혀 있다.

## 컨테이너

```bash
docker build -t relayer:0.1.0 .
# .env 는 권한 0600 으로 두고 파일로만 넘긴다.
# `-e NAME=값` 은 값이 argv 와 셸 이력에 남으므로 쓰지 않는다.
docker run -p 8787:8787 --env-file .env relayer:0.1.0
```

`node:24-slim` 이다 — `.ts` 를 그대로 실행하므로 번들러가 없다. 부팅 때 마이그레이션을 맞추고 뜬다.

**확인함(2026-09-15)**: 이미지 빌드 → 컨테이너 기동 → `/health` 200 · 화면 200 · 정적 200 · 로그인 200.

## 환경 변수

| 이름 | 없으면 |
|---|---|
| `DATABASE_URL` | 로컬 기본값으로 붙는다(배포에서는 반드시 준다) |
| `PII_ENC_KEY` | 금고·자유 글 암복호가 실패한다. base64 32바이트 |
| `SESSION_SECRET` | 로그인이 실패한다 |
| `PORT` | 8787 |
| `RELAYER_SLUG` | 마법사 1단계 `주소 이름` 칸의 기본값이 빈다(관리자가 직접 적는다). 기관별 서브도메인의 라벨(아래) |

**`PII_ENC_KEY` 는 백업과 다른 곳에 둔다.** 잃으면 자유 글과 금고를 영영 못 읽는다(`SPEC.md` §13).

## 올리기 전에

1. `node api/src/seed.ts` 로 시험 계정(`test1`·`test4` 관리자, `test2` 실무자, `test3` 당사자)과 기관·사업·합성 사례를 만든다.
   시드는 기관 이름을 적으므로 마법사(`#/onboarding`)를 건너뛴다.
2. **합성 데이터만 올린다.** 실데이터는 P1 게이트가 갖춰졌어도 별도 결정(D2 국내 리전)이 남아 있다.
3. 공개 주소가 생기면 `docs/beta-scenario.md` §0-B 의 접속 안내를 그 주소로 바꾼다.
4. 번호표(`docs/qa-steps.js`)와 계수기(`docs/measure.js`)는 그대로 쓴다 — 콘솔에 붙여 넣는 조각이라 배포와 무관하다.

## 새 DB 의 첫 가입 (2026-09-17)

시드를 넣지 않은 새 기관 배포는 **첫 가입(signup)** 으로 연다(`SPEC.md` §24-1). 초대 규율의 유일한 예외이고, 첫 관리자가 생기면 영구히 닫힌다.

```
RELAYER_SLUG=yeondae node api/src/migrate.ts && node api/src/index.ts   # 마이그레이션이 organization 행(id=1)을 만든다
curl -s http://localhost:8787/auth/signup                               # → {"open":true,"workspace":null}
```

1. 브라우저로 `/` 를 열면 로그인 화면이다(= 랜딩). 아래 `가입하기` → `#/signup` 에서 **첫 관리자 계정만** 만든다(아이디·비밀번호·이름).
2. 가입이 끝나면 로그인된 채 마법사 `#/onboarding`(기관 워크스페이스 설정하기)으로 간다 — **1 기관 워크스페이스 만들기(기관명·주소 이름, 기본값은 RELAYER_SLUG)** →
   2 기관 정보 → 3 사업 1개 이상 → 4 실무자 초대(건너뛰기 가능) → 5 외부 서비스 연결 → 완료. 마치기 전에는 관리자가 다른 화면으로 가도 마법사로 돌아오고,
   초대로 먼저 들어온 실무자는 `기관을 준비하고 있어요` 를 본다. 완료는 기관 요약(`#/workspace?done=1`)을 보이고 `상담 일정으로 이동하기` 로 홈에 간다.
3. 그 뒤 `GET /auth/signup` 은 `{"open":false,"workspace":{…}}` 이고 `POST /auth/signup` 은 403 이다. `#/signup` 은 기관 이름과 초대 안내만 낸다.
   실무자·추가 관리자는 **설정 › 실무자 관리 › 초대** 링크로만 들어온다.
4. **문은 다시 열리지 않는다.** 관리자가 사고로 0명이 되면 DB 에서 복구한다 — `update users set deactivated_at = null where …` 또는 새 관리자 행을
   직접 넣는다. `organization.bootstrap_closed_at` 을 지워 문을 다시 여는 것은 마지막 수단이다(그 사이 주소를 아는 누구나 관리자가 될 수 있다).

`.env` 에 `OPENAI_API_KEY` 를 두지 않아도 된다 — 관리자가 마법사(또는 설정 › 시스템 › 외부 서비스 연결)에서 키를 넣으면 검증 뒤 암호문으로 DB 에 저장되고 호출마다 DB → env 순으로 읽는다.
STT(Azure)·DB 는 여전히 환경 변수다.

## 기관별 서브도메인 (2026-09-17)

기관마다 `기관.relayer.kr` 을 주되 **앱은 하나의 기관만 안다** — 배포 하나가 기관 하나다(PLAN A3, `organization` 단일 행).
앱 코드는 `Host` 를 읽지 않으므로 서브도메인은 전부 DNS·프록시 층의 일이다. **주소 이름(slug)은 배포자가 `RELAYER_SLUG` 로 정한다** —
DB 하나만 보는 앱은 전체 배포에서의 중복도, DNS 가 실제로 붙었는지도 알 수 없어 화면은 읽기 전용으로 보여 주기만 한다(ASTRA 검토 E).

```
RELAYER_SLUG=<slug>              ┐  그 기관 앱의 .env
DNS  <slug>.relayer.kr  CNAME → Cloudflare Tunnel (또는 A → 그 기관의 서버)
Tunnel/프록시 ingress        <slug>.relayer.kr → http://localhost:<그 기관 앱의 PORT>
앱 프로세스                  기관마다 하나 — 자기 DATABASE_URL·PII_ENC_KEY·SESSION_SECRET·PORT·RELAYER_SLUG
```

절차:

1. 기관마다 DB 하나(Supabase 프로젝트 또는 스키마)·`.env` 하나·앱 프로세스 하나를 둔다. 포트를 달리 주고 `RELAYER_SLUG` 를 적는다.
2. Cloudflare DNS 에 `<slug>` CNAME 을 터널 주소로 더한다(또는 A 레코드). 와일드카드 `*.relayer.kr` 을 터널에 물려 두면 DNS 는 한 번이다.
3. 터널 `config.yml` 의 `ingress` 에 `hostname: <slug>.relayer.kr → service: http://localhost:<PORT>` 한 줄을 더하고 터널만 재시작한다(`launchctl kickstart -k … or.bss.relayer-tunnel`).
4. 그 주소로 `/auth/signup` 이 `{"open":true,…}` 인지 확인하고 위 **새 DB 의 첫 가입** 절차를 밟는다.

한 프로세스가 여러 기관을 받는 멀티테넌트(`org_id`)와 앱 안의 서브도메인 라우팅, 공용 주소에서의 기관 자동 생성(프로비저닝)은 범위 밖이다. 필요해지면 그때 결정한다.

## D2 배포처 (2026-09-15 확정)

**앱은 맥미니, DB 는 Supabase Pro(서울 리전).** 추가 비용 0원이고 실데이터로 넘어갈 때 업체를 갈아타지 않아도 된다.

왜 이렇게 골랐는지:

| 후보 | 왜 아닌가 |
|---|---|
| Vercel Hobby | **약관이 막는다.** 2026-06-01 개정 약관이 Hobby 를 개인·비상업 용도로 제한하고 금지 목록에 `내부 업무 도구`가 있다. 한도는 남아도 예고 없이 정지될 수 있다 |
| Vercel Pro | 월 $20. 맥미니로 되는 일에 쓸 이유가 없다 |
| Fly + Managed Postgres | DB 최저 월 $38. 합성 데이터 시험에 과하다 |
| Fly + 자체 Postgres | 월 $3. 맥미니가 없을 때의 차선 |
| Supabase 무료 | **7일 무활동이면 일시정지**된다. 실무자가 며칠 안 들어오면 멈춘다 (Pro 는 안 멈춘다) |

### 공개 주소 (2026-09-15)

# https://relayer.kr/test          ← 참가자에게 주는 주소
# https://mac-mini.tail79fba7.ts.net  ← 대비책. 그대로 살려 둔다

맥미니에서 상시로 돈다. Tailscale Funnel 이라 고정이고 HTTPS 이며 비용이 없다.

| | |
|---|---|
| 기기 | 맥미니(`BarQ.local`, tailnet `mac-mini`) |
| 경로 | `~/services/relayer2` |
| 상시 실행 | launchd `or.bss.relayer` (`KeepAlive`, 로그는 `relayer.{out,err}.log`) |
| 공개 | `tailscale funnel --bg --set-path=/ 8790` |

```bash
ssh mini 'launchctl list | grep relayer'                     # 살아 있나
ssh mini 'tail -20 ~/services/relayer2/relayer.err.log'      # 로그
ssh mini 'cd ~/services/relayer2 && git pull && pnpm --dir web build && launchctl kickstart -k gui/$(id -u)/or.bss.relayer'   # 새로 배포
```

새 기기를 붙일 때는 `./scripts/pull-secrets.sh` 로 Infisical 에서 `.env` 를 받는다.
키를 사람 손으로 옮기지 않는다.

**백업**: 맥미니 launchd `or.bss.relayer-backup` 이 매일 04:10 에 `./scripts/backup.sh` 를 돌린다.
최근 14개를 `~/services/relayer2/backups/` 에 둔다. 복구 연습은 맥북에서 `./scripts/restore-drill.sh`.

**Cloudflare Tunnel 을 못 쓴 이유**: `Account@bss.or.kr` 계정에 **등록된 영역(도메인)이 하나도 없다**
(Workers·D1 만 쓴다). named tunnel 의 `relayer.<도메인>` DNS 라우팅은 영역이 있어야 한다.
도메인을 Cloudflare 에 올리면 그때 옮길 수 있고, 그전까지 Funnel 이 같은 일을 공짜로 한다.

> Funnel 주소는 **기기 이름**을 딴다. 맥북에서 먼저 띄웠다가(`mac-book…`) 맥미니로 옮겼고,
> 맥북 쪽 Funnel 과 임시 터널은 껐다. 노트북을 닫아도 서비스는 살아 있다.

### 띄우기

```bash
./scripts/serve-public.sh --tunnel    # 화면 빌드 → 마이그레이션 → 앱 → 임시 공개 주소
```

`--tunnel` 은 `trycloudflare` 임시 주소다(무료·로그인 불필요, 창을 닫으면 사라진다). 관문 2 처럼 **며칠 열어 둘 때는 이름 있는 터널**을 쓴다:

```bash
cloudflared tunnel login                       # 브라우저에서 Cloudflare 계정 선택 (1회)
cloudflared tunnel create relayer
cloudflared tunnel route dns relayer relayer.<도메인>
cloudflared tunnel run --url http://127.0.0.1:8787 relayer
```

상시로 돌리려면 `cloudflared service install` 로 맥미니 로그인 항목에 올린다.

### 실제 배선 (2026-09-15)

| | |
|---|---|
| Supabase 프로젝트 | **`relayer2`** (`sqpzuqnfhrpaivzsgvxh`, ap-northeast-2, Pro 조직) — `./scripts/create-supabase-project.sh` 로 만들었다 |
| 스키마 | `public` (전용 프로젝트라 가를 이유가 없다) |
| 시크릿 | Infisical `ggbss` 프로젝트 · `prod` · **`/RELAYER2`** 에 `DATABASE_URL`·`PII_ENC_KEY`·`SESSION_SECRET` |
| 배선 스크립트 | `./scripts/wire-secrets.sh <비밀번호파일>` — 값을 찍지 않고 `.env` 와 Infisical 에 넣는다 |

> **왜 전용 프로젝트인가**: 처음에는 기존 `Relayer`(`wtbdqyedyimivdbgljcs`)에 붙였는데 그 프로젝트에는
> **CCC 스키마가 이미 들어 있었다** — `audit_log`·`consent_events` 이름이 그대로 겹친다.
> 스키마를 갈라 피할 수도 있지만 마이그레이션·백업·권한이 서로 걸린다. 2026-09-15 Q 지시로 분리했고,
> 그 프로젝트에 만들었던 `relayer` 스키마는 지웠다(확인: 남은 스키마 0).
>
> **남은 일**: 그 프로젝트의 DB 비밀번호를 접속 주소를 얻으려고 재설정했다. CCC 쪽에서 그 DB 를
> 쓰고 있었다면 저장된 접속 문자열을 새 값으로 바꿔야 한다(Infisical `prod:/CCC` 에는 DB 시크릿이 없었다).

Infisical 쓰기는 read 전용 project token 이 아니라 Machine Identity(`ggbss_client_ID`/`_secret`)로 한다.
CLI `secrets set` 은 값을 `argv` 에 실어 `ps` 에 보이므로 `scripts/infisical_put.py` 가 HTTP 로 올린다.

### Supabase 를 DB 로 쓸 때

`.env` 의 `DATABASE_URL` 만 바꾸면 된다. TLS 와 prepared statement 설정은 주소를 보고 자동으로 정한다(`api/src/db.ts`).

- **세션 풀러(5432)** 를 쓴다 — 앱이 상시 프로세스라 prepared statement 를 살리는 쪽이 빠르다.
- 트랜잭션 풀러(6543)를 쓰면 `prepare` 가 자동으로 꺼진다.
- 접속 주소는 `.env` 에만 둔다. 저장소·백업·로그 어디에도 적지 않는다.

```bash
node api/src/migrate.ts   # 표 만들기
node api/src/seed.ts      # 시험 계정 test1~3 + 합성 사례
```

**서울 리전(ap-northeast-2)** 을 고른다. 지금은 합성 데이터라 요건이 아니지만, 실데이터로 넘어갈 때 옮기지 않으려면 처음부터 서울에 둔다.

## 비밀값

`docs/secrets.md` 에 있다 — 어느 프로젝트·폴더에 무엇을 넣고, 자격은 어디에 적고,
어떻게 확인하는지. 그 문서가 정본이다.

## 공개 주소 둘 (2026-09-16)

| 주소 | 경로 | 비고 |
|---|---|---|
| `https://relayer.kr/test` | 가비아 등록 → Cloudflare DNS → Tunnel → 맥미니 `:8790` | 관문 2 측정 입구 |
| `https://mac-mini.tail79fba7.ts.net/test` | Tailscale Funnel → 맥미니 `:8790` | **대비책. 끄지 않는다** |

둘 다 같은 앱을 가리킨다. 하나가 죽어도 측정이 멈추지 않게 둘을 함께 둔다.

**본문 한도**: 녹음 업로드 상한은 앱이 200MiB 로 정한다(`SPEECH_MAX_BYTES`, 2026-09-16). Cloudflare Tunnel 은 무료 요금제에서
요청 본문 100MB 를 넘기지 못하므로 100MiB 를 넘는 녹음은 `relayer.kr` 경로에서 413 이 난다 — 그 경우 Funnel 주소를 쓴다.
Tailscale Funnel 에는 알려진 요청 본문 한도가 없다. 앱 자체 한도가 유일한 상한이 되게 리버스 프록시를 따로 두지 않는다.

### 구성

```
도메인 등록   가비아 (relayer.kr, 2027-09-15 만기)
네임서버      noah.ns.cloudflare.com · perla.ns.cloudflare.com
Cloudflare    영역 relayer.kr (Free), 계정 8855a07cd6da28d8f6120fa95081854e
Tunnel        이름 relayer, id c2c8e5d1-7288-4264-ae36-e51dd2fbab8d
              설정 ~/.cloudflared/config.yml (0600), 자격 같은 폴더의 .json
launchd       or.bss.relayer-tunnel (KeepAlive). 앱은 or.bss.relayer 로 따로 돈다
로그           ~/services/relayer2/tunnel.{out,err}.log
```

**네임서버를 바꿀 때는 소유자 본인인증이 필요하다**(가비아). 사람이 해야 하는 자리다.
`cloudflared tunnel login` 도 브라우저 승인이 한 번 필요하고, 그 인증서는
`~/.cloudflared/cert.pem` 에 남는다 — 이 파일과 터널 자격 `.json` 은 시크릿이다.

### 손보기

```bash
ssh mini 'launchctl list | grep relayer'                        # 셋 다 떠 있어야 한다
ssh mini 'tail -20 ~/services/relayer2/tunnel.err.log'          # 터널 로그
ssh mini 'launchctl kickstart -k gui/$(id -u)/or.bss.relayer-tunnel'   # 터널만 재시작
```

앱과 터널은 **따로 재시작한다.** 앱을 고칠 때 터널을 내릴 이유가 없다.
