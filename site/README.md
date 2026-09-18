# 소개와 가이드 페이지

앱과 분리된 정적 페이지 세 장이다. 빌드 도구가 없고, 파일을 열어 글자만 바꾸면 그대로 반영된다.

```
site/
  index.html        소개(랜딩)
  guide-user.html   사용자 가이드, 실무자용
  guide-admin.html  관리자 가이드
  site.css          색과 형태. 앱 토큰의 사본이다
  site.js           펼침 목록과 가이드 목차 표시
  check-text.mjs    한글 검수
  fonts/            Chillax, 워드마크 전용
  shots/            화면 사진
```

## 보기

```bash
python3 -m http.server 8080 --directory site
# http://127.0.0.1:8080
```

## 글 고치기

문장은 모두 HTML 안에 그대로 있다. 찾아서 바꾸면 끝이다. 고친 뒤에는 검수를 돌린다.

```bash
node site/check-text.mjs
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

서체는 앱과 같은 스택(Pretendard 계열)을 쓴다. Chillax 는 워드마크 `Relayer` 한 곳에만 쓰고,
파일은 `fonts/` 에 함께 두므로 바깥 서버를 부르지 않는다.

## 정렬 검사

글이나 부품을 고친 뒤에는 실제 렌더에서 중심 좌표를 재서 확인한다.

```bash
cd node_modules/.pnpm/@playwright+test@1.63.0/node_modules
node ~/developer/tools/align-tools/align-check.mjs http://127.0.0.1:8081/index.html \
  '[{"name":"버튼 라벨 중앙","selectors":[".btn .btn-text",".btn"],"axis":"xy","tolerance":1}]'
```
