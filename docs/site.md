# 소개와 가이드 페이지

앱과 분리된 정적 페이지 세 장이다. 빌드 도구가 없고, 파일을 열어 글자만 바꾸면 그대로 반영된다.

**`site/` 에 둔 것은 전부 공개된다.** 앱이 그 폴더를 `relayer.kr` 아래에 그대로 내므로
(`api/src/routes.ts` 의 정적 마운트) 파일을 하나 놓으면 그 이름으로 누구나 열 수 있다.
그래서 이 문서와 한글 검수 스크립트는 `site/` 밖에 둔다. 시안이나 메모도 넣지 않는다.

```
site/                 공개되는 것만
  index.html          소개(랜딩)
  guide-user.html     사용자 가이드, 실무자용
  guide-admin.html    관리자 가이드
  site.css            색과 형태. 앱 토큰의 사본이다
  site.js             펼침 목록과 가이드 목차 표시
  fonts/              Chillax, 영문 전용
  img/cover.webp      첫 화면 커버. 배경이 비어 있는 워드마크 그림
  shots/              화면 사진

docs/site.md          이 문서
scripts/site-check-text.mjs   한글 검수
```

## 보기

```bash
python3 -m http.server 8080 --directory site
# http://127.0.0.1:8080
```

## 글 고치기

문장은 모두 HTML 안에 그대로 있다. 찾아서 바꾸면 끝이다. 고친 뒤에는 검수를 돌린다.

```bash
node scripts/site-check-text.mjs
```

가운데점과 긴 대시는 쓰지 않는다. 검수가 막는다. 목록과 구분은 쉼표로 쓴다.

구획을 하나 늘릴 때는 `<section>` 하나를 복사하고, 가이드라면 목차(`data-toc`)에 줄 하나를 더한다.
`id` 를 같게 맞추면 목차 표시가 따라온다.

## 앱으로 가는 링크

두 개뿐이다.

| 링크 | 가는 곳 | 누르는 사람 |
|---|---|---|
| `/#/signup` | 관리자 계정 만들기 | 기관에서 처음 쓰는 사람 |
| `/#/login` | 로그인 | 계정을 이미 받은 사람 |

앱을 다른 주소에 올렸으면 세 HTML 에서 이 두 경로만 바꾼다.

```bash
cd site && sed -i '' 's|"/#/|"https://앱주소/#/|g' index.html guide-user.html guide-admin.html
```

## 화면 사진 다시 찍기

앱 화면이 바뀌면 `shots/` 를 다시 찍는다. 사진은 합성 데이터(`api/src/seed.ts`)로만 찍는다.
실제 상담 자료가 담긴 화면은 올리지 않는다.

1. 시험용 데이터베이스를 따로 만든다. 공용 개발 데이터베이스를 쓰면 다른 작업을 지운다.

   ```bash
   docker exec relayer-db psql -U relayer -d postgres -c "create database relayer_shots"
   set -a && . ./.env && set +a
   export DATABASE_URL="postgres://relayer:relayer@127.0.0.1:55432/relayer_shots"
   node api/src/migrate.ts && node api/src/seed.ts
   pnpm --dir web build && PORT=8795 node api/src/index.ts
   ```

2. 브라우저 창을 1440 x 900, 배율 2 로 맞추고 `test2 / test2`(실무자) 로 로그인한다.

   | 파일 | 주소 | 계정 |
   |---|---|---|
   | `schedule.png` | `#/schedule` | test2 |
   | `participants.png` | `#/participants` | test2 |
   | `participant-info.png` | `#/cases/1/info` | test2 |
   | `record.png` | `#/cases/1/record` | test2 |
   | `admin-org.png` | `#/settings/org` | test1 |
   | `admin-staff.png` | `#/settings/staff` | test1 |
   | `admin-system.png` | `#/settings/system` | test1 |

3. 다 찍은 뒤 시험용 데이터베이스를 지운다.

   ```bash
   docker exec relayer-db psql -U relayer -d postgres -c "drop database relayer_shots"
   ```

## 디자인을 어디서 가져왔나

값의 정본은 앱이다. 이 폴더는 사본이고, 사본을 먼저 고치면 앱과 어긋난다.

| 가져온 것 | 정본 |
|---|---|
| 색, 모서리, 간격, 글자 계단, 모션 | `web/src/styles/tokens.css` |
| 버튼 알약 해부도, 배지, 아웃라인 카드, 호버 흐름 | `web/src/styles/wire.css` |
| 머리줄 그라데이션 선, 활성 내비 어휘 | `web/src/styles/shell.css` |
| 값 확정 이력과 근거 | 루트 `DESIGN.md` |

원 출처는 `SocialSolidarityBank/CCC` 의 `design/tokens.css` 이고 릴레이어가 값 그대로 이식했다.

부품은 앱과 같은 실측값을 쓴다.

- 버튼: 알약, 높이 32, 좌우 14, 글자 14/600. 아웃라인은 브랜드 그라데이션 1px,
  프라이머리는 행동 그라데이션 면 + 잉크 50% 1px. 호버에 그라데이션이 흐르고 누르면 1px 내려간다.
  첫 화면 한 쌍만 높이 40(앱 입력칸 높이)에 좌우 20 이다.
- 배지: 알약, 높이 22, 좌우 8, 12/400. 중립은 회색 1px, 민트와 라벤더는 면을 채우고 흰 글자다.
- 카드: 회색 1px + 흰 면 + 모서리 12. 그림자는 없다. 민트는 사람, 라벤더는 주의, 블루는 시간이다.
- 활성 표시: 블루 tint 면 + 브랜드 그라데이션 1px + 잉크 글자. 머리줄의 현재 장과 목차가 같이 쓴다.
- 머리줄 아래 1px 은 3색 축(블루, 민트, 라벤더)이다. 그라데이션을 구조선으로 쓰는 자리는 여기뿐이다.

이 폴더에만 있는 값은 셋이다. 첫 화면 제목 한 단, 첫 화면 리드 18/400, 구획 간격 96(좁은 화면 64).
이유는 `site.css` 머리말에 있다.

서체는 앱과 같은 스택(Pretendard 계열)을 쓴다. Chillax 는 **영문 세 자리에만** 쓴다.
파일은 `fonts/` 에 함께 두므로 바깥 서버를 부르지 않는다.

| 자리 | 굵기 | 크기 | 색 |
|---|---|---|---|
| 워드마크 `Relayer` | 600 | 머리줄 24, 꼬리줄 28 | 3색 축 가로 그라데이션 |
| 순서 번호 | 600 | 59(좁은 화면 40) | 민트 deep 과 라벤더 deep 을 번갈아 |
| 제목 안 약어(`LLM`) | 600 | 제목의 1.3배 | 3색 축 가로 그라데이션 |
| 영문 서브타이틀 | 500 | 13 | `--sub`, 그라데이션 없음 |

한글에는 쓰지 않는다. 이 서체에 한글 글리프가 없어 한 줄 안에 폴백 서체가 섞인다.

순서 번호 59px 은 눈대중이 아니다. 글 덩어리(제목 16/1.35 + 설명 14/1.35)의 실측 높이가
40.5px 이고, 캔버스 `TextMetrics` 로 잰 이 서체 숫자의 잉크 높이(0.686em)가 40.5 가 되는
지점이 59px 이다. 글을 고쳐 줄 수가 달라지면 이 값을 다시 재야 한다.

## 정렬 검사

글이나 부품을 고친 뒤에는 실제 렌더에서 중심 좌표를 재서 확인한다.

```bash
cd node_modules/.pnpm/@playwright+test@1.63.0/node_modules
node ~/developer/tools/align-tools/align-check.mjs http://127.0.0.1:8081/index.html \
  '[{"name":"버튼 라벨 중앙","selectors":[".btn .btn-text",".btn"],"axis":"xy","tolerance":1}]'
```

## 캐시

`site/` 응답에는 `cache-control: public, max-age=60` 이 붙는다(`api/src/routes.ts` 의 `siteCache`).
다만 Cloudflare 영역의 Browser Cache TTL 이 4시간으로 잡혀 있어 정적 파일에서는 그 값이
`max-age=14400` 으로 덮인다(2026-09-18 실측). 그래서 CSS 나 JS 를 고치면 링크의 `?v=` 를
올려 새 주소로 만든다. HTML 은 덮이지 않으므로 `?v=` 만 바꾸면 브라우저가 새 파일을 받는다.

영역 설정을 `Respect Existing Headers` 로 바꾸면 `?v=` 를 올릴 일이 없어진다.

## 커버 그림 바꾸기

`site/img/cover.webp` 한 장을 갈아 끼우면 된다. 배경이 비어 있는(알파) 그림이어야 한다.
캔버스 색 위에 그대로 앉으므로 배경이 칠해진 그림을 넣으면 사각형이 보인다.

```bash
cwebp -q 86 -alpha_q 100 새그림.png -o site/img/cover.webp
```

바꾼 뒤 `site/index.html` 의 `width`, `height` 를 새 그림의 실제 화소 수로 맞춘다.
비율이 어긋나면 그림이 늦게 올 때 아래 글이 밀린다. 표시 폭은 CSS 가 정한다(최대 520).

`site/` 바로 아래 이미지는 커밋 대상이 아니다(로컬 제외 목록). 쓸 그림은 `img/` 나 `shots/` 에 둔다.

## 팀원이 고칠 때

저장소는 공개다(Apache-2.0). 클론에는 권한이 필요 없다.

```bash
git clone https://github.com/SocialSolidarityBank/Relayer2.git
cd Relayer2
python3 -m http.server 8080 --directory site   # http://127.0.0.1:8080
```

고칠 파일은 셋이다. `site/index.html`, `site/guide-user.html`, `site/guide-admin.html`.
문장은 HTML 안에 그대로 있으니 글자만 바꾸고 브라우저를 새로 고치면 된다.
**설치할 것도, 환경 변수도, 데이터베이스도 없다.** 빌드 도구가 없어서 그렇다.

고친 뒤 검수를 돌린다(Node 22 이상, 의존성 없음).

```bash
node scripts/site-check-text.mjs
```

올리는 길은 둘이다.

- **협업자로 초대받은 경우**: 브랜치를 만들어 push 하고 PR 을 연다.
  `gh repo view` 로 확인하면 지금 push 권한은 조직 계정 하나뿐이다. 초대는 저장소 관리자가 한다.
- **초대 없이**: GitHub 에서 fork 한 뒤 PR 을 연다. 공개 저장소라 그대로 된다.

`main` 에 들어가면 배포는 맥미니에서 한 줄이다(`docs/deploy.md`).

```bash
ssh mini 'cd ~/services/relayer2 && git pull && launchctl kickstart -k gui/$(id -u)/or.bss.relayer'
```

정적 파일이라 다시 빌드할 것이 없다. `site/` 만 바뀐 변경은 앱을 다시 띄우지 않아도
다음 요청부터 새 파일이 나간다(앱이 요청마다 디스크를 읽는다). 앱을 다시 띄우는 것은
`routes.ts` 처럼 코드가 바뀐 경우다.

## 환경 변수를 넘기는 방법

**소개 페이지와 가이드만 고치는 사람에게는 넘길 것이 없다.** 위 절차에 환경 변수가 없다.
시크릿을 주지 않는 것이 맞다.

앱 전체를 돌려야 하는 경우(화면 사진 다시 찍기, API 작업)도 **운영 값을 넘기지 않는다.**
`.env.example` 를 복사해 자기 기기용 값을 직접 만든다.

```bash
cp .env.example .env
openssl rand -base64 32   # PII_ENC_KEY
openssl rand -hex 32      # SESSION_SECRET
pnpm db:up && pnpm migrate && pnpm seed   # 로컬 docker DB, 합성 데이터
```

뜨는 데 필요한 값은 이 둘뿐이다. `DATABASE_URL` 은 비워 두면 로컬 docker 를 보고,
AI 와 음성 열쇠가 없으면 그 기능만 503 으로 실패한다. 나머지는 그대로 돈다.

운영 값이 정말 필요한 자리(맥미니, 새 기관 배포)는 값을 사람 손으로 옮기지 않는다.
Infisical `prod:/RELAYER2/<slug>` 에 권한을 주고 각자 기기에서 내려받는다.

```bash
./scripts/pull-secrets.sh /RELAYER2/<slug>    # .env(0600) 로 받는다. 화면에 찍지 않는다
```

받는 사람에게 필요한 것은 값이 아니라 **권한 둘**이다.

1. 1Password `BSS` 볼트의 Infisical 서비스 계정 항목 공유
2. `~/.dotfiles/scripts/opsvc` 가 있는 기기

카카오톡, 메일, 문서, 스크린샷으로 값을 보내지 않는다. 한 번 보내면 회수할 수 없고
`PII_ENC_KEY` 는 그 DB 의 상담 내용을 여는 열쇠다.

## 역할을 둘로 나눈다

| 하는 일 | 누가 | 필요한 것 |
|---|---|---|
| 글과 화면 고치기 | 팀원 | 클론과 브라우저. 끝이다 |
| 검수 | 팀원 | Node 22 이상 |
| PR 올리기 | 팀원 | GitHub 계정(fork 면 초대도 필요 없다) |
| 병합 | 저장소 관리자 | GitHub push 권한 |
| 배포 | 저장소 관리자 | 맥미니 ssh |

팀원은 배포에 손댈 이유가 없고 시크릿도 받을 이유가 없다.

### 팀원: 브라우저로 미리 보기

서버를 띄우지 않아도 된다. `site/index.html` 을 그냥 두 번 눌러 브라우저로 열면
CSS, Chillax 서체, 커버 그림, 화면 사진, 펼침 동작까지 전부 그대로 나온다(실측).

다만 `사용해 보기`, `로그인` 링크는 앱 주소(`/app#/...`)를 가리키므로 파일로 열면 눌리지 않는다.
그 두 링크까지 확인하려면 서버를 띄운다.

```bash
python3 -m http.server 8080 --directory site
```

### 관리자: 한 줄로 배포

`main` 에 들어간 것을 내보낸다.

```bash
./scripts/deploy-site.sh          # 기본 호스트 mini
```

하는 일은 넷이다. 무엇이 바뀌는지 보여 주고, 받고, `api/` 나 `web/` 가 바뀐 경우에만 앱을
다시 띄우고, `relayer.kr` 의 네 경로가 200 인지 확인한다. 새 것이 없으면 아무것도 하지 않는다.
`site/site.css` 나 `site/site.js` 가 바뀌었으면 `?v=` 를 올렸는지 되묻는다.

## 공개에 필요한 것들

셋을 갖췄다. 없으면 티가 나는 것들이다.

| 것 | 파일 | 없을 때 |
|---|---|---|
| 파비콘 | `site/img/icon-32.png`, `icon-180.png` | 탭에 빈 종이 |
| 링크 미리보기 | `site/img/og.png` + 세 HTML 의 og 태그 | 카카오톡에 주소만 뜬다 |
| 없는 주소 | `site/404.html` | 방문자가 `{"error":"로그인 필요"}` 를 본다 |

아이콘과 미리보기 그림은 커버(`img/cover.webp`)에서 뽑았다. 아이콘은 첫 글자 `R` 만
잘라 쓴 것이고, 미리보기는 커버와 첫 화면 제목을 1200x630 에 앉힌 것이다. 새로 그린 것은 없다.

`404.html` 은 앱이 낸다. 브라우저가 쪽을 달라고 온 요청(`Accept: text/html`) 가운데
`site/` 에도 없고 앱 입구도 아닌 주소에만 이 쪽이 나가고, 화면이 `fetch` 로 부르는
자료 경로는 그대로 로그인 게이트(401)로 간다. 404 는 401 보다 알려 주는 것이 적다.

`robots.txt` 는 앱 입구 둘(`/app`, `/test`)만 막고 나머지를 연다. `sitemap.xml` 은 세 쪽이다.
