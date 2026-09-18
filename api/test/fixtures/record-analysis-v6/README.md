# record-analysis-v6 픽스처

합성 데이터셋 `relayer-testdata` 2026-09-17 판에서 가져온 텍스트 전용 픽스처다.
전부 합성 인물·합성 사례다(실제 당사자 없음). 오디오는 받지 않았고 커밋하지 않는다.

- 출처: `https://pub-0acad9da70b54900924fea276388490a.r2.dev/2026-09-17/manifest.json`
- 수기 원문: `cases/<CASE>/sessions/<NN>.note.md` — 바이트 그대로 보존(정규화·트림 없음)
- 전사 원문: `cases/<CASE>/sessions/<NN>.dialogue.json` 의 turns 를 서버 저장 형태(`<화자 라벨>: <발화>` 줄 결합, `scripts/load-dataset.mjs` 의 `transcriptFromDialogue` 와 동일)로 만든 텍스트
- 인테이크 자유 글·카드: `cases/<CASE>/case.json` 의 `intake.detail`·`intake.promises`·`intake.questions`
- 생성 도구: `scripts/fetch-testdata-fixture.mjs <case> <seq> [출력]`

## 파일별로 검증하는 규칙 패턴

| 파일 | 회차 | 패턴 |
|---|---|---|
| `c08-s1.json` | C08 인테이크 | 인테이크 자유 글 5키(`welfare_other` 포함)·약속 3·질문 3 카드 span. 불일치: 수기 `620만 원 정정`(w:memo:5) vs 전사 `650만 원이었는데`(t:1:140) — 같은 피해금액·같은 시기·양립 불가. 비불일치 예: 아들 나이(55) 전사 생략, 손녀 학년 전사가 더 상세, 마지막 연락 표현 차이. |
| `c10-s10.json` | C10 10회차 | 약속→결과 같은 회차 수기: 새 통장 개설 완료·미용실 언니 보관(w:memo:4-5). 불일치: 필기시험 날짜 수기 `7월 18일`(w:memo:9) vs 전사 `7월 25일`(t:1:44). 비불일치 예: 월급 170만(수기)/180만(전사) 예상치 표현 차이, 분짜·문제집 등 전사만 상세. newly_revealed(언니 정서적 지지), new_possibility(취업처→남편 통보 계획). |
| `c03-s8.json` | C03 8회차 | 약속→결과: 5/19 병원 진료 완료(w:memo:2). 불일치: 약 용량 수기 `27mg`(w:memo:5) vs 전사 `18mg`(t:1:22). 비불일치 예: 복용 시작일 표현 차이, 포켓몬 카드·약 기록 등 전사만 상세. change 주석(남편 냉전→모가 밀고 감, 전후 span). |

## stub/

`AI_PROVIDER=stub`·`AI_STUB_FILE` 용 모델 응답 정답지. 각 픽스처의 실제 span 좌표로 쓴 `LlmAnalysis`다.

- `default.json` — 임의 짧은 수기(`월세 두 달 밀림. 내역서는 못 뗐다고 함. 다음 주까지 내역서를 떼기로 함.`)용 최소 유효 응답
- `c08-s1.json` / `c10-s10.json` / `c03-s8.json` — 같은 이름 픽스처의 정답 응답. 카드 doc 은 픽스처 순서대로 `card:1..` 를 쓴다(서버는 실제 카드 id 를 씀). 전사 doc 은 `transcript` → span id `t:1:<n>`(전사 id 1 자리표시자)
- `stub-file.json` — `{ default, by_seq: { "1", "8", "10" } }` 형태의 StubFile 집계본

## 검증

```sh
node scripts/record-analysis-coverage.mjs api/test/fixtures/record-analysis-v6
```

문서별 span 무손실(coverage)·sha256·stub 의 `LlmAnalysisSchema`·`checkReferences`·생성문 말줄임 검사를 돌리고 `COVERAGE_OK` 를 출력한다.
