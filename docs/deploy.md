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
docker run -p 8787:8787 \
  -e DATABASE_URL=postgres://… \
  -e PII_ENC_KEY=…   \
  -e SESSION_SECRET=… \
  relayer:0.1.0
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

**`PII_ENC_KEY` 는 백업과 다른 곳에 둔다.** 잃으면 자유 글과 금고를 영영 못 읽는다(`SPEC.md` §13).

## 올리기 전에

1. `node api/src/seed.ts` 로 시험 계정(`test1`·`test2`·`test3`)과 합성 사례를 만든다.
2. **합성 데이터만 올린다.** 실데이터는 P1 게이트가 갖춰졌어도 별도 결정(D2 국내 리전)이 남아 있다.
3. 공개 주소가 생기면 `docs/beta-scenario.md` §0-B 의 접속 안내를 그 주소로 바꾼다.
4. 번호표(`docs/qa-steps.js`)와 계수기(`docs/measure.js`)는 그대로 쓴다 — 콘솔에 붙여 넣는 조각이라 배포와 무관하다.

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

# https://mac-mini.tail79fba7.ts.net

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
