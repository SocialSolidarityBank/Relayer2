# 인계 — 녹음 파일 형식 결정 + 합성 테스트 데이터 세트 (2026-09-17)

코드 변경 없음. 결정과 자료 위치만 남긴다. 브랜치는 그대로 작업 중.

## 결정: 브라우저가 녹음한 그대로 저장하고 그대로 Azure 에 보낸다

근거: Azure fast transcription 은 WAV·MP3·OPUS/OGG·FLAC·WMA·AAC·WebM·AMR 을 받고 5시간·500MB 미만이면 된다
(GStreamer 백엔드). 현재 `api/src/stt.ts` 는 원본을 그대로 저장(sha256, 200MiB 상한, 매직 검사)하고 그대로
multipart 로 보낸다 — **지금 구현이 곧 결정이다.** 서버는 손대지 않는다.

| 단계 | 형식 | 비고 |
|---|---|---|
| 녹음 Chrome·Edge·Android | `audio/webm;codecs=opus`, mono, 48 kbps | 1시간 ≈ 22 MB |
| 녹음 iPhone·iPad Safari | `audio/mp4`(AAC), mono, 48~64 kbps | Safari 는 webm 녹음 불가. 1시간 ≈ 22~28 MB |
| 저장 | 원본 바이트 그대로 | 트랜스코딩 없음. sha256 이 원본 증명 |
| Azure 전송 | 원본 그대로 inline multipart | 공개 URL 방식은 음성을 기관 밖에 두게 되므로 안 쓴다. 2시간도 45 MB |

화면 쪽 할 일 한 줄(DESIGN 레인, `record.tsx` 녹음 시작부):
`new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 48_000 })` + `getUserMedia({ audio: { channelCount: 1 } })`.
브라우저 기본값(64~128k)의 절반이고 STT 품질 차이는 없다(아래 세트의 mp3 48k mono 가 CER 1% 안).

무압축 wav 는 안 쓴다 — 16kHz mono 도 115 MB/시간(5배)이고 상담 음성은 48k 에서 이미 인식 상한 근처다.

## 트랜스코딩을 넣어야 하는 신호 — 나오면 한 단계, 한 형식

1. Chrome `MediaRecorder` webm 은 duration/cue 헤더가 없다(스트리밍 기록) → `<audio>` 길이 표시와
   전문 보기의 `문장 클릭 → seek` 가 안 될 수 있다. **실기기에서 먼저 확인.**
2. iPhone Safari 에서 데스크톱이 녹음한 webm 재생 불가 가능성(추정, 미검증).

둘 중 하나라도 확인되면 업로드 시점(`saveRecording`)에 **mp3 mono 24kHz 48k 로 통일**:

```
ffmpeg -i in.webm -ac 1 -ar 24000 -b:a 48k out.mp3
```

이유: 아래 테스트 세트가 정확히 이 형식이라 Azure 왕복이 검증돼 있고, 어느 브라우저든 재생되며, 1시간 22 MB.
ogg/opus 가 더 작지만(≈11 MB) Safari 재생이 불확실하다. 맥미니에 ffmpeg 있음(`/opt/homebrew/bin/ffmpeg`), 1시간 인코딩 수 초.
저장 형식이 하나면 보유기간 스윕·백업 용량 계산도 단순해진다.

## 용량 기준점 (1시간 1파일)

| 형식 | 용량 |
|---|---|
| webm/opus·mp3·AAC 48 kbps mono | 22 MB |
| iPhone m4a 기본(64k) | 28 MB |
| wav 16kHz mono | 115 MB |
| wav 44.1kHz stereo | 635 MB (200MiB 상한에 20분에서 막힘) |

실무자 1명 주 10회차 × 60분이면 연 약 11 GB(48k 기준). **`backup.sh` 는 DB 만 뜬다 — 음성 백업 정책은 아직 없다.**

## 합성 테스트 데이터 세트 (전부 허구, 커밋하지 않는다)

- 공개 목록: `https://pub-0acad9da70b54900924fea276388490a.r2.dev/2026-09-17/manifest.json`
  (Cloudflare R2 `relayer-testdata`, account@bss.or.kr, 인증 없음. **User-Agent `Python-urllib` 만 403** — urllib 이면 아무 UA 나 붙인다)
- 설명서 `README.md`·설계 `DESIGN.md` 같은 자리. 원본·도구는 맥북 `~/DEVELOPER/PROJECTS/relayer-testdata` (git 아님, 레포 밖).
- 사례 10건 · 회차 103(음성 93 · 수기 93) · 음성 462분 · 167 MB · mp3 24kHz mono 48k.
  분야: 재무(도박 숨김, 14회) · 정신건강(자살사고→회복, 19회) · 아동심리(12) · 가정(부부 싸움, 9) · 자립준비청년(연락두절, 5) ·
  전세사기(7) · 노동(사투리·급종결, 6) · 노인 인지저하(착취 위험, 16) · 알코올(자진종결, 3) · 다문화(폭력 위험, 11).
- 회차마다 `NN.dialogue.json`(전문 = 전사 정답) · `NN.note.md`(수기, 전문의 20~40%, 숫자 오기·누락·추정 1~3개 심음) · `NN.mp3`.
- 적재: `python3 tools/load_to_relayer.py --cases C01,C09` (`RELAYER_URL/EMAIL/PASSWORD` 환경변수, 표준 라이브러리만).
  동의 7영역 grant → `PUT intake`(과제·질문 카드) → `sessions/start` → `PATCH memo` → `POST recordings`.
  2026-09-17 빈 DB + `main`(e06a9a8) 서버로 C02·C05·C09 28회차 적재·전사 초안까지 확인.
- 실데이터 전환 전 `scripts/purge-test-data.mjs` 로 지운다. **실데이터 DB 에 섞지 않는다.**

## 이 세트로 재 볼 것 (많아지면 터지는 순서)

1. AI 초안이 지난 회차 **전부**를 보내는 구조(`api/src/ai.ts`) — C02 19회차로 토큰·지연 측정.
2. 전사 큐 — 동기 요청, 회차 여러 개 동시 업로드 시 뒤 전사가 밀리는지. 동시 처리 상한 없음.
3. 가림 누락 — 전사문에 번호·호수·임대인 이름이 말로 들어온다. 정규식이 못 잡는 형태 비율.
4. 불일치 잡음 — 수기는 원래 전문의 일부. 숫자·날짜·약·금액만 띄우는 기준 없이는 실무자가 안 본다.
5. `recordings.delete_after` 스윕이 실제로 도는지, 지운 뒤 전사문 잔존(설계상 남음).
6. 합성음은 깨끗해서 잡음을 섞어도 CER 0.6~1.3% — **하한**이다. 실무자가 원고를 폰으로 읽어 녹음한 것 몇 개를 섞어야 현장 수치가 나온다.
