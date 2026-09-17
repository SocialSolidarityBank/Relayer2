# 디자인 레인 인계 (2026-09-18 갱신)

워크트리 `RELAYER2/.worktrees/DESIGN`. 캘린더 레인은 착지해서 끝났다(`HANDOFF-CALENDAR.md`).

## 이 레인이 맡는 것

화면·CSS·레이아웃·문구. 서버·마이그레이션·권한은 루트 세션이 맡는다.
디자인 변경에 API 변경이 필요하면 멈추고 알린다. 동의 문안(`api/src/consent.ts`)은 해시에 묶여 있어 손대지 않는다.

## 검증 (PR 전 반드시 넷)

```bash
pnpm --dir web exec tsc --noEmit && pnpm --dir web build
node scripts/measure-cards.mjs http://localhost:8798 test2      # 8개 화면 카드 여백·버튼·한 줄, PASS 여야 한다
PLAYWRIGHT_BASE_URL=http://localhost:8798 PLAYWRIGHT_API_PREFIX= VOICE_ENABLED=1 \
  pnpm --dir web exec playwright test --workers=1               # 현재 26/26
```

함정 넷 — 다 겪었다.

1. **`--workers=1` 필수.** 전 spec 이 DB 하나를 공유한다. 병렬이면 서로의 데이터를 밟는다.
2. **seed 뒤 `programs` 를 채워야 한다.** `0016_settings.sql` 이 *그때 있던* `support_cases` 에서
   역채움하므로 migrate → seed 순서인 일회용 DB 에서는 0건이 된다. 안 채우면 당사자 등록의 `사업명`
   선택창이 비어 여러 spec 이 60초씩 타임아웃한다.
   ```bash
   docker exec relayer-db psql -U relayer -d <일회용DB> -c \
     "insert into programs(name) select distinct program_name from support_cases where program_name <> '' on conflict do nothing"
   ```
3. **녹음 spec 은 `VOICE_ENABLED=1`** 이 필요하다(STT 키 없이 `전사 건너뜀` 으로 지난다).
4. **다른 레인 마이그레이션이 오면** `DATABASE_URL=…/relayer_design node api/src/migrate.ts` 뒤 서버를 다시
   띄운다. 안 하면 e2e 가 12개씩 떨어진다. 서버 소스(`api/`)가 바뀐 pull 뒤에도 재시작해야 한다
   (빌드만으로 반영되는 건 `web/dist` 쪽이다).

## 로컬 검증 환경

- 서버: `node api/src/index.ts`, `PORT=8798`, `web/dist` 를 같은 원점에서 낸다
- DB: 일회용 `relayer_design`(운영 `.env` 에 붙지 않는다)
- 계정: `test1`(관리자) · `test2`(실무자, 시드 사례) · `test3`(당사자, 로그인 불가). 비밀번호 = 아이디
- **접근은 역할이 아니라 배정이 정한다**(`case_assignments`). 관리자도 배정이 없으면 사례 상세가 막힌다
- `#/cases/:id/...` 를 주소창으로 바로 열면 목록을 거치지 않아 홈으로 튕기는 자리가 있다 — 실측은 목록에서 카드를 눌러 들어간다

## 배포 (요청받았을 때만)

```bash
gh pr merge --repo SocialSolidarityBank/Relayer2 <branch> --squash --match-head-commit "$(git rev-parse HEAD)"
ssh mini '~/services/relayer2/scripts/backup.sh | head -n 1 && git -C ~/services/relayer2 pull -q --ff-only origin main && env PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin pnpm --dir ~/services/relayer2/web build 2>&1 | tail -n 1 && launchctl kickstart -k gui/501/or.bss.relayer && sleep 4 && git -C ~/services/relayer2 rev-parse --short HEAD && /opt/homebrew/bin/node --env-file=/Users/barq/services/relayer2/.env /Users/barq/services/relayer2/api/src/migrate.ts --check'
curl -s https://relayer.kr/health
```

스쿼시 머지 뒤 브랜치는 `main` 과 갈라진다. 다음 작업 전에 `git reset --hard origin/main`.

## 정본

- 디자인 규칙: `DESIGN.md`. **§6 이 2026-09-18 에 개정됐다** — 아래 다섯 계약이 전역이다.
- 이름: `GLOSSARY.md` / 동작: `SPEC.md` (둘 다 이 레인이 임의로 안 고친다)
- 부품: `web/src/ui.tsx`(`ParticipantHero`·`Card`·`Fold`·`Item`·`Field`·`Meta`…), 공용 카드 `web/src/consent-link.tsx`
- CSS 순서: `tokens.css → wire.css → shell.css → app.css`. 릴레이어 보정은 `app.css` 에만
  - **순서 함정**: 이식 규칙이 같은 특이도의 뒤 파일 규칙에 지는 자리가 있다
  - **이식 규칙이 한 가지 쓰임만 상정한 자리**도 있다: `.wire-input-box .wire-chevron` 은 선택창 꺽쇠 하나만 있다고 보고 절대 배치로 오른쪽에 못박는다 — 입력칸 안에 꺽쇠를 둘 두면(숫자 스테퍼) 같은 좌표에 겹친다

### §6 개정판 다섯 계약 (2026-09-18 Q)

1. **화면 문구는 문장이 아니라 단어·명사구**다. 서술어 어미(`…해요`)와 마침표를 쓰지 않는다. 설명형 hint 금지(§13). 패턴: `불러오는 중` · `[대상] 없음` · `[동작] 실패` · `[대상] 필요`/`선택` · `저장됨`.
2. **라벨 색은 민트 deep 기본**이고 주목·경고는 코랄(`Field/Card tone="warn"`), AI 산출은 라벤더(`tone="ai"`). 카드 제목·항목 제목은 `--ink`.
3. **정보 조각 사이 `·`·`|`·`—` 금지** → `Meta`(`ui.tsx`) 의 독립 노드 + 간격 16. 같은 종류 목록은 쉼표. 용어 안 가운데 점(`개인정보 수집·이용`)은 예외.
4. **버튼·항목 제목·항목 설명·카드 도움말은 한 줄.** 넘치면 말줄임 + `title`(버튼은 말줄임 대신 이름을 줄인다).
5. **카드 여백은 사방 한 값**이고 눈이 아니라 `scripts/measure-cards.mjs` 로 잰다.

## 2026-09-18 에 착지한 것 (PR #27~#39, 운영 반영됨)

- 상담 일정 보기(주간표·다가오는 일정 접힘 목록) · 상담 일정 등록(명사형 카드 제목) · 당사자 고르기 목록(업무 바·2열·현황판·쪽 넘기기)
- 당사자 정보 탭: 회차 정보 접힘 카드 · 동의 항목별 접힘 · 파일 업로드 · 상담 종결 한 행 · 동의 링크 카드
- 회차별 요약/원본 보기: 회차 하나 = 접힘 카드 하나, 위험 신호를 회차 카드로, AI 배지
- 당사자 등록: 동의 항목별 접힘 카드(체크는 머리) · 필수는 별표 · 이름·연락처·이메일 3열 · 사업명·예정 회차 수 2열 + 꺽쇠 스테퍼 · 동의 요청 링크 카드를 동의 위로
- **동의 요청 링크 카드는 한 부품**이다(`consent-link.tsx` `ConsentLinkCard`) — 당사자 등록과 당사자 정보 탭이 같이 쓴다. 등록 화면에서는 누르면 먼저 등록하고 발급한다(사례가 없으면 링크를 못 만든다)

## 2026-09-18 회차 원본 드로어 (Q 승인)

- 회차는 아코디언, **원본은 드로어**다. 회차 머리의 `상담 기록 보기`·`녹음 전사 보기`가 오른쪽
  드로어(`web/src/session-original.tsx`, `.side-drawer`)를 연다.
- 구 `회차별 원본 보기` 탭과 `상담 내용 원본 보기` 화면(`/full`)은 **폐지**했다. 탭은 셋이다.
- 팀 목업 네 벌(`~/Downloads/릴레이어_*.html` 등)은 같은 골격이지만 **1,024~1,040px 모달**이다.
  모달은 회차 목록을 가려 대조를 못 해서 드로어로 갔다. 이모지 제목·대괄호 버튼·`…습니다` 문장체·
  `·` 혼합 나열·배지 남용은 우리 규칙과 충돌해 채택하지 않았다.
- 머리 가운데가 버튼 자리라 **펼침을 노리는 클릭은 회차 글자를 겨눈다** — e2e 도 `.seq-head-no` 를
  누른다. `summary` 중심 클릭은 버튼에 먹혀 드로어가 열린다(voice-start 가 그렇게 한 번 깨졌다).

## 알려진 것 · 다음 후보

디자인·UI 후보만 추린 목록(2026-09-18 실측). Q 가 고른다.

1. **목표 탭** — 설명형 hint 2개 잔존(§13 위반), 카드마다 따로 선 `저장` 버튼 3벌
2. **설정 4화면** — 제목 아래 `관리자` meta 줄 4곳, `저장하기`·`계정 삭제하기`·`사업 추가하기`
   (§6 명사구 위반), 카드 제목이 화면 제목과 중복, `AI·전사·데이터베이스 연결 상태`·
   `기간·실무자·종류를 정해 CSV 받기`(§6 `·` 금지)
3. **감사(열람 기록)** — `#/audit` 라우트가 없다(상담 일정으로 튕김). 입구는 `시스템 › 열람 기록 관리`
4. **상담 기록하기·인테이크** — 가장 긴 두 화면(579·433줄)이 §6 개정 이후 미검수
5. **로그인·초대·당사자 열람** — 비로그인 3화면 미검수
6. **인쇄 스타일** — 팀 목업 넷은 전부 인쇄 지향인데 우리에게 `@media print` 가 없다
- 카드가 머리인 화면에는 **화면 이름이 없다**(Q ①ⓐ). 사이드바에 메뉴가 없는 화면(원본 보기·검토·종결)은 단서가 `뒤로` 알약뿐이다
- `.participant-card` 여백은 이식값 20/24 그대로다(`wire.css:51`). `measure-cards` 는 카드 스스로의 여백과 내용 거리가 맞는지만 보므로 PASS 다 — §6 의 24 한 값으로 맞출지는 미결
- 2열 목록은 줄마다 등높이다(`height:100%`) — 짧은 카드는 아래가 벌어진다. `measure-cards` 는 재는 동안만 늘림을 끈다
- `SPEC.md`·`GLOSSARY.md` 에 `15초 다시보기` 가 화면·용어로 남아 있다(정본이라 손대지 않았다)
- 이식만 되고 안 쓰는 CSS: 드로어·모바일 바 · 사업 전환기 · 고대비 토큰(`DESIGN.md` §10 표)
- 대비 한계: 민트 묶음 제목 2.00:1 · 입력칸 경계 1.28:1 · 배지 면 위 흰 글자 2.0~2.5:1

## 운영

- 주소 `https://relayer.kr`, 대비 `https://mac-mini.tail79fba7.ts.net`
- 계정 `test1`(관리자) `test2`(실무자), 비밀번호 = 아이디
- 실무자 실사 일정이 잡히면 그 앞뒤로 배포하지 않는다
