# 인계 — 녹음 시작·전문 보기 화면 (DESIGN 레인, 2026-09-16)

시드: `.ouroboros/seed-voice-start.yaml`. 서버 레인과 디자인 레인이 함께 따르는 계약이다.
마지막에 루트 서버를 띄워 통합 검증한다.

## 원칙 (Q 확정)

- **시작이 곧 회차.** 수기 첫 입력이든 녹음 시작이든 그 순간 회차(기록됨)가 생기고 부족한 정보는 나중에 채운다.
  임시저장·예정 같은 중간 상태를 두지 않는다.
- 녹음은 브라우저 안에서 바로(`MediaRecorder`) **또는** 기기 파일 올리기. 둘 다 상담 기록하기 **상단** 버튼.
- 업로드는 즉시 끝난다. 전사는 서버가 뒤에서 돌린다(자동). 화면은 상태만 보여 주고 `전사하기`는 재시도 용도로 남긴다.
- 전사 초안은 승인 전에도 보인다. `확인 전` 표시. 승인(전사 확인)은 불일치 비교·기록 반영에만 문이다.
- 회차별 요약(당사자 정보 탭)에 **모든 기록 회차**가 나오고, 수기가 없으면 `수기 미작성`, 녹음·전사 상태가 함께 붙는다.
  거기서 **수기·음성 전문 보기**로 가고, 전문에서 다시 요약으로 돌아온다.

## 서버 계약 (루트 레인이 구현, 이 모양 그대로 쓴다)

### 새 경로

`POST /cases/:id/sessions/start` — 본문 `{ session_id?: number, method?: string, is_closing?: boolean }`

- 응답 `{ session_id: number, seq: number }`.
- `session_id` 를 주면 그 **예정(planned)** 회차를 기록됨(done)으로 바꾼다. 없으면 새 회차를 만든다.
- 만든 회차는 `status='done'`, `held_at=now`, `memo=null`. 회차 번호·회차 수·15초 다시보기에 포함되는 정식 회차다.
- 409: 지정한 회차가 이 사례 것이 아니거나 이미 done 이거나, 사례가 종결(closed)됐거나, 민감정보 처리 동의가 없을 때.
- 화면 규칙: 상담 기록하기에서 **회차 id 가 없는 상태에서** 사용자가 (a) 녹음 시작을 누르거나 (b) 수기 칸에 처음 입력하면
  이 경로를 한 번 부르고, 받은 `session_id` 를 이후 업로드·저장(`PATCH /sessions/:id`)에 쓴다. 두 번 부르지 않는다.
  예정 회차를 열어 시작했으면 그 id 를 `session_id` 로 넘긴다.

### 바뀐 경로

- `PATCH /sessions/:id` (기록 저장): `memo` 가 **선택**이 된다. 비워서 저장해도 된다(수기 미작성 회차).
- `GET /cases/:id` 의 `sessions[]` 각 항목에 두 필드가 **추가**된다(기존 필드는 그대로):
  ```ts
  written: boolean;                   // memo 가 비어 있지 않음
  voice: {
    recordings: number;               // 삭제되지 않은 녹음 수
    transcript: 'none' | 'pending' | 'draft' | 'approved' | 'failed' | 'skipped';
  };
  ```
  `transcript` 의 뜻: none 녹음 없음/전사 없음 · pending 서버가 전사 중 · draft 초안 있음(확인 전) · approved 확인됨 ·
  failed 전사 실패(재시도 가능) · skipped 외부 STT 동의 없어 건너뜀. 여러 녹음이 있으면 가장 최근 녹음 기준.
- `GET /sessions/:id/recordings` 의 각 항목에 `transcribe_state: 'pending' | 'done' | 'failed' | 'skipped'` 가 추가된다.
- `GET /speech/status` 의 `max_bytes` 가 **200MiB** (209715200) 가 된다. 화면 상한 문구는 이 값을 읽어 만든다.
- `POST /sessions/:id/recordings`: 그대로. 응답은 전사를 기다리지 않는다. 종결 사례면 409.
- `POST /recordings/:id/transcript`: 그대로(수동 재시도). 종결 사례면 409.
- `GET /sessions/:id/transcript`: 그대로. `status: 'draft' | 'approved'`. 초안도 온다.

## 화면 작업 (web/** 만)

### 1. 상담 기록하기 상단 — 녹음 버튼

`web/src/screens/record.tsx` 상단(제목 아래, 구획 위)에 녹음 구역을 둔다. 지금 맨 아래 접힌 카드
`음성·수기 기록 불일치`(`session-audio.tsx`)의 업로드·전사하기·전사문·확인 부분은 상단으로 옮기고,
접힌 카드에는 불일치 비교만 남긴다.

- 버튼 둘: **녹음 시작/멈춤** · **파일 올리기**. `GET /speech/status`의 `enabled` 가 false 면 구역을 숨긴다.
- 녹음 시작: 회차 id 없으면 먼저 `sessions/start`. 그다음 `navigator.mediaDevices.getUserMedia({ audio: true })` →
  `MediaRecorder`. `mimeType` 은 `MediaRecorder.isTypeSupported` 로 고른다:
  `audio/webm;codecs=opus`(Windows·Mac·Android Chrome/Edge) → `audio/mp4`(iPhone·iPad Safari, m4a) → 기본값.
  서버는 wav/mp3/m4a/flac/ogg/webm 을 받는다.
- 멈춤: Blob 을 `POST /sessions/:id/recordings` 로 올린다(기존 `uploadRecording`). 올라가면 목록에 `전사 중` 표시.
  `duration_ms` 는 시작·멈춤 시각 차로 넣는다.
- 녹음 중 표시: 경과 시간, 멈춤 버튼. 페이지 이탈 시 `beforeunload` 경고(녹음 중이면).
- iPhone 제약을 UI 문구로 알린다: 화면 잠금·다른 앱 전환 시 녹음이 끊길 수 있음.
- 상한: `max_bytes` 를 넘는 파일은 올리기 전에 막고 `NNN MB 까지` 문구.
- 전사 상태 표시: `pending` 전사 중… / `draft` 전사 초안(확인 전) / `approved` 전사 확인됨 / `failed` 전사 실패 — 전사하기 재시도 /
  `skipped` 동의 없어 전사 안 함. 상태는 업로드 뒤 폴링(3~5초, `GET /sessions/:id/recordings`)으로 갱신하고
  pending 이 없어지면 폴링을 멈춘다.
- 수기 첫 입력 시에도 회차 id 없으면 `sessions/start` 를 부른다(원칙: 시작이 곧 회차). 그 뒤 저장 버튼은 `PATCH` 만.

### 2. 회차별 요약 — 상태와 링크

`web/src/screens/participant-info.tsx` `Sessions`:

- 지금은 `status === 'done'` 만 보여 준다. 그대로 두되, 각 회차 줄에 `written === false` 면 **`수기 미작성`** 배지,
  `voice.recordings > 0` 이면 `녹음 N` 과 전사 상태 문구(위 표)를 붙인다.
- 각 회차 줄에 **`전문 보기`** 링크 → `#/cases/:caseId/sessions/:sessionId/full`.

### 3. 수기·음성 전문 보기 (새 화면)

`#/cases/:caseId/sessions/:sessionId/full` — 새 파일 `web/src/screens/session-full.tsx`, 라우트 등록은 기존 라우트 파일 관례대로.

- 위: 회차 머리(`N회차 · 날짜 · 방법`). 뒤로 = 회차별 요약(`#/cases/:id/info`).
- **수기**: 회차 저장본 전체 — 상담 내용(memo) 본문 + 카드(과제·질문·판단, 출처 구획 라벨). 비어 있으면 `수기 미작성`.
  데이터: 기존 회차 조회(`GET /sessions/:id`)와 카드 조회를 재사용. 새 API 없음.
- **음성**: 녹음 목록(`GET /sessions/:id/recordings`) + 재생(`<audio controls src={recordingAudioHref(id)}>`),
  전사문(`GET /sessions/:id/transcript`) 본문. `status === 'draft'` 면 제목에 `확인 전` 표시. 시간 구간이 있으면 문장 클릭 → 재생 위치 이동(기존 `seek` 재사용).
- 편집·승인 버튼은 여기 두지 않는다(상담 기록하기가 담당).

### 4. E2E

`web/e2e/voice-start.spec.ts` — Playwright, Chromium 가짜 마이크:
`launchOptions.args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']` (해당 spec 에서만).
시나리오: 당사자 등록(동의: 녹음·STT 포함) → 상담 기록하기 열기 → 녹음 시작 → 회차가 생김(URL 또는 화면에 회차 번호)
→ 멈춤 → 녹음 1개 표시 → 당사자 정보 회차별 요약에 그 회차가 `수기 미작성`·녹음 1 로 보임 → `전문 보기` → 수기 미작성·재생 컨트롤·
전사 상태 표시 → 뒤로 → 회차별 요약.
서버 없이는 못 돈다 — 루트 서버(`VOICE_ENABLED=1`, STT 키 없음 → 전사 `skipped`)에 붙여 돌린다.

## 하지 않는 것

- `web/**` 밖을 고치지 않는다. 서버 계약이 다르게 보이면 루트 레인에 묻는다(hub).
- 실시간 스트리밍 전사·화자 분리·전사문→수기 자동 반영·분할 업로드.
- 기존 `음성·수기 기록 불일치` 비교 로직 변경.

## 검증

`pnpm --dir web exec tsc --noEmit` · `pnpm --dir web exec playwright test e2e/voice-start.spec.ts --reporter=line`
(루트 서버에 붙여) · 데스크톱/모바일 폭에서 상단 녹음 구역이 가로 넘침 없음.
