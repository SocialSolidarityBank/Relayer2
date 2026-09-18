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
2. **`programs` 역채움은 이제 필요 없다**(2026-09-18 통합 검증). `0025_onboarding_programs.sql` 이
   `support_cases.program_name` 을 걷고 `programs` 를 정본으로 만들면서 `seed.ts` 가 사업을 직접 만든다.
   구 역채움 명령(`insert into programs(name) select distinct program_name …`)은 이제
   `column "program_name" does not exist` 로 죽는다 — 돌리지 않는다.
3. **녹음 spec 은 `VOICE_ENABLED=1`** 이 필요하다(STT 키 없이 `전사 건너뜀` 으로 지난다).
4. **다른 레인 마이그레이션이 오면** `DATABASE_URL=…/relayer_design node api/src/migrate.ts` 뒤 서버를 다시
   띄운다. 안 하면 e2e 가 12개씩 떨어진다. 서버 소스(`api/`)가 바뀐 pull 뒤에도 재시작해야 한다
   (빌드만으로 반영되는 건 `web/dist` 쪽이다).

## 로컬 검증 환경

- 서버: `node --env-file=.env.design api/src/index.ts`, `PORT=8798`, `web/dist` 를 같은 원점에서 낸다.
  `.env.design`(gitignore 됨)에 `DATABASE_URL`·`PII_ENC_KEY`·`SESSION_SECRET`·`PORT`·`VOICE_ENABLED=1` 이 있다.
- DB: 일회용 `relayer_design`(운영 `.env` 에 붙지 않는다). **시드만 남긴다** — e2e 가 만든 자료는
  쌓아 두지 않는다(2026-09-18 Q). 지저분해지면 통째로 다시 만든다:
  ```bash
  # 서버를 먼저 멈춘다(연결이 남아 있으면 drop 이 막힌다)
  docker exec relayer-db psql -U relayer -d postgres -c "drop database if exists relayer_design"
  docker exec relayer-db psql -U relayer -d postgres -c "create database relayer_design"
  node --env-file=.env.design api/src/migrate.ts && node --env-file=.env.design api/src/seed.ts
  docker exec relayer-db psql -U relayer -d relayer_design -tAc "
    insert into case_assignments(case_id, user_id, assigned_by)
      select 1, u.id, (select id from users where email='test1') from users u where u.email in ('test1','test2')
      on conflict do nothing"
  ```
  시드가 사업 하나와 사례 하나(`test2` 배정)를 만든다. 위 한 줄은 **관리자(`test1`)에게도 그 사례를 배정**해
  관리자 계정으로 사례 화면을 실측할 수 있게 하는 것뿐이다(안 해도 e2e 는 지난다).
  **PII_ENC_KEY 를 바꾸면 기존 금고를 못 읽는다** — DB 를 새로 만들 때만 새 열쇠를 쓴다.
- **레인 마이그레이션 경고는 끝났다**(2026-09-18 통합). 0025~0027 이 모두 `main` 에 있어 이 DB 에 그대로 적용한다.
  구 경고(0025 를 적용했더니 `main` 코드가 아직 읽는 `support_cases.program_name` 이 사라져 목록이 500 이 됐다)는
  그 마이그레이션이 착지하기 전의 이야기다. 다른 레인 것이 오면 `migrate` → 서버 재시작 순서만 지킨다.
- 계정: `test1`(관리자) · `test2`(실무자, 시드 사례 1) · `test3`(당사자, 로그인 불가). 비밀번호 = 아이디
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

## 2026-09-18 UI 개편 통합 (레인 다섯 착지 — #52·#54·#53·#56·#55)

화면 정본은 **`DESIGN.md` §4** 가 갖는다(사이드바 · 당사자 목록 · 일정 예약 · 상담 기록하기 · 당사자 정보 4탭 · 설정 네 화면).
용어는 **`GLOSSARY.md` §16**(동의 라벨 여섯 · `녹음 전사 기록` · `사업 종료` · 전역 `저장` · `담당 중인 당사자`)이다.
근거는 `docs/ui-plan-2026-09-18.md` §0 결정표(D1~D11)와 §1 항목표.

이 문서에 있던 두 절은 **대체됐다** — 되살리지 않는다.

- 구 `회차 원본 드로어` 절: 원본은 이제 **큰 팝업 두 열**(`dialog.tsx` `size="wide"` + `session-original.tsx` 의 `SessionOriginalDialog`)이다.
  드로어 720px 에 수기와 전사를 나란히 못 놓아 안에서 전환해야 했던 것이 폭을 택한 이유다(Q 결정 E2·F5). 요약 머리 행동은 다시 **넷**이다(F4).
- 구 `목업 구성 이식` 절의 `당사자 정보 탭 상단 두 칸`: **`첫상담 기록` 카드는 삭제**됐고 `회차 정보`가 가로 풀폭이다(E1).
  회차 본문 네 구역 2×2 와 `source_session_seq` 로 가르는 규칙은 그대로이며, 구역 제목은 **배지**가 됐다(F2).

목업에서 **안 가져온 것**(유지): 이모지 제목, 3단 중첩 아코디언, 대괄호 버튼, `…습니다` 문장체, `·` 혼합 나열, 배지 남용, sky·slate 팔레트.

**소유 파일 규칙은 풀렸다**(2026-09-18 플래너). 레인별 소유·`ccc-preview` 식 잠금은 이 개편 동안의 장치였다.

## 알려진 것 · 다음 후보

디자인·UI 후보만 추린 목록. **1·2 는 2026-09-18 UI 개편(G·I~L)으로 해소됐다** — 남은 것만 둔다. Q 가 고른다.

1. **감사(열람 기록)** — `#/audit` 라우트가 없다(상담 일정으로 튕김). 입구는 `시스템 › 열람 기록 관리` 하나다
2. **인테이크** — 가장 긴 화면(433줄)이 §6 개정 이후 미검수. 상담 기록하기는 개편에서 함께 봤다(D)
3. **로그인·초대·당사자 열람** — 비로그인 3화면 미검수
4. **인쇄 스타일** — 팀 목업 넷은 전부 인쇄 지향인데 우리에게 `@media print` 가 없다
- 카드가 머리인 화면에는 **화면 이름이 없다**(Q ①ⓐ). 사이드바에 메뉴가 없는 화면(검토·종결)은 단서가 `뒤로` 알약뿐이다
- 당사자 목록 카드는 접힘 카드라 `.participant-card` 의 이식 여백 20/24 대신 `.wire-card` 의 24 한 값을 받는다(2026-09-18 A2). `measure-cards` PASS
- `SPEC.md` 에 `15초 다시보기` 가 화면·용어로 남아 있다(정본이라 손대지 않았다). `GLOSSARY.md` §2·§6 의 구 표기도 그대로다 — §16 이 이기는 자리만 적어 뒀다
- 이식만 되고 안 쓰는 CSS: 모바일 바 · 사업 전환기 · 고대비 토큰(`DESIGN.md` §10 표). **드로어(`.side-drawer`)는 이제 설정이 쓴다**(J3 담당 고르기 · L3 동의 문안 수정) — 회차 원본은 팝업으로 옮겼다
- `#/settings/assign`·`programs`·`workers` 같은 **묶음 안 항목 주소는 열리지 않는다** — `시스템` 묶음만 항목 주소를 갖는다(`nested`). 실측·e2e 는 `#/settings/staff`·`org` 로 들어간다
- 대비 한계: 민트 묶음 제목 2.00:1 · 입력칸 경계 1.28:1 · 배지 면 위 흰 글자 2.0~2.5:1

## 운영

- 주소 `https://relayer.kr`, 대비 `https://mac-mini.tail79fba7.ts.net`
- 계정 `test1`(관리자) `test2`(실무자), 비밀번호 = 아이디
- 실무자 실사 일정이 잡히면 그 앞뒤로 배포하지 않는다
