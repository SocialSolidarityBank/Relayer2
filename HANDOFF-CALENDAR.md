# 캘린더 레인 — 끝났다 (2026-09-18 갱신)

`design/schedule-calendar`(PR #18~#21)는 `main` 에 들어갔다. 이 문서의 원래 몫
(15초 다시보기 폐지에 PR #18 을 맞추기)은 완료돼서, 지금은 **캘린더를 이어 만지는 쪽이
알아야 할 것**만 남긴다.

## 지금 상태

- 월간·주간·일간 세 보기, 기간 이동 꺽쇠, 기간 이름을 누르면 열리는 `DatePicker` 모달, `오늘`
- 홈(`#/schedule`)은 주간표 + 다가오는 일정 접힘 목록(가까운 5건, `날짜 더보기`)이다
- 일정 카드의 행동은 `당사자 정보`·`상담 기록하기` 둘이고 `15초 다시보기`는 폐지됐다
- 날짜·시간 입력은 공통 A안(`date-picker.tsx`·`date-time-input.*`)이며 일정 등록·기록·인테이크가 같이 쓴다
- 소유 파일: `web/src/calendar.ts` · `date-picker.tsx` · `date-time-input.*` · `screens/home.*` ·
  `screens/schedule-new.*` · `web/e2e/schedule-*.spec.ts`

## 문구·표시 계약 (2026-09-18 §6 개정 — 캘린더에도 걸린다)

- 화면 문구는 **단어·명사구**다. `예정된 상담 없음`·`불러오는 중`·`저장 실패` 처럼 쓰고 마침표와
  `…해요` 어미를 쓰지 않는다. 설명형 hint 는 두지 않는다(§13).
- **정보 조각 사이에 `·`·`|`·`—` 를 쓰지 않는다.** 일정 줄(`가명`·`사업명 N회차`·`일시`)은 `Meta`
  (`ui.tsx`)의 독립 노드로 두고 간격 16(`.wire-meta-row`)으로 가른다. 용어 안 가운데 점
  (`오전·오후`)은 예외다.
- 라벨은 민트 deep 기본, 주목·경고는 코랄(`tone="warn"`), AI 산출은 라벤더(`tone="ai"`).
- 카드 도움말·항목 제목·항목 설명은 **한 줄**이고 넘치면 말줄임 + `title`. 버튼은 이름을 줄인다.
- 시간대 안내는 한 군데만 둔다: 날짜·시간 입력 아래 `한국 시간 기준`.
- 주간표의 1행·1열 머리는 `--muted` 면이고, 오늘은 날짜 숫자에 원 테두리만 준다(배지 금지).

자세한 규칙은 `DESIGN.md` §4 `상담 일정 보기`·`상담 일정 등록`·`공통 날짜·시간 입력`, §6 전체.

## 검증 (지금 main 기준)

```bash
pnpm --dir web exec tsc --noEmit && pnpm --dir web build
node scripts/measure-cards.mjs http://localhost:8798 test2
PLAYWRIGHT_BASE_URL=http://localhost:8798 PLAYWRIGHT_API_PREFIX= VOICE_ENABLED=1 \
  pnpm --dir web exec playwright test --workers=1
```

- `--workers=1` 필수(26개가 DB 하나를 공유한다). 현재 통과 기준 **26/26**
- **seed 뒤 `programs` 를 채워야 한다**(`0016_settings.sql` 역채움 함정, `HANDOFF-DESIGN.md` 참고)
- 녹음 spec 은 `VOICE_ENABLED=1` 필요
- 캘린더 spec 은 `schedule-view`·`schedule-calendar` 다. 날짜 계산은 `calendar.ts` 단위로 붙잡고
  화면 단정은 주간표 셀·일정 카드의 이름으로 한다
