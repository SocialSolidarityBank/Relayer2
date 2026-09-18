# 합성 데이터셋 적재

이 절차는 `relayer-testdata` 2026-09-17 판의 C02·C08·C01·C10·C03을 새 릴레이어 스택에 넣는다. 다섯 사례는 전부 합성이지만 실제 자료처럼 보이므로 실데이터와 같은 DB·Blob 위치에 섞지 않는다.

## 중단 조건

- `~/services/relayer2` 운영 체크아웃에서는 실행하지 않는다.
- 운영 Supabase, 공유 `relayer` DB, 기존 기관 DB에는 실행하지 않는다.
- Azure 새 스택의 DB·Blob 경로를 플래너가 확인하고 **GO** 하기 전에는 원격 API를 대상으로 실행하지 않는다.
- 비밀번호를 `--login` 값에 직접 쓰지 않는다. 명령행은 프로세스 목록과 셸 기록에 남는다.
- `.relayer-dataset-receipt.json`을 적재 중 지우지 않는다. 서버가 발급한 가명이 멱등 키다. 영수증에 미완료 사례가 있으면 스크립트는 중복 사례를 만들지 않고 중단한다.

스크립트는 로컬호스트가 아닌 API를 기본 차단한다. 플래너 GO 뒤에만 `RELAYER_DATASET_ALLOW_REMOTE=1`을 설정한다.

## 적재 범위

기본 선택은 양이 많은 다섯 사례다.

| 사례 | 회차 | 녹음 | 수기 | 원 담당 |
|---|---:|---:|---:|---|
| C02 | 19 | 18 | 17 | 최은정 |
| C08 | 16 | 13 | 15 | 최은정 |
| C01 | 14 | 13 | 12 | 박지연 |
| C10 | 11 | 10 | 10 | 최은정 |
| C03 | 12 | 11 | 12 | 박지연 |
| 합계 | 72 | 65 | 66 | |

합계는 고정 상수가 아니라 실행 시 `manifest.json`에서 다시 계산된다. 현재 음성 합계는 116,186,829바이트다.

스크립트는 관리자 `test1`으로 다음 API 흐름만 사용한다.

1. 실무자 박지연(`curated.park`)·이도현(`curated.lee`)·최은정(`curated.choi`) 초대 및 가입
2. 당사자 등록과 동의 7종 `grant`
3. 인테이크 저장
4. 2회차부터 일정 등록 → 해당 일정으로 기록 시작 → 수기 저장
5. MP3를 `POST /sessions/:id/recordings`로 업로드
6. `dialogue.json`을 화자 라벨이 있는 승인 전사문으로 가져오기
7. `test1`과 사례 원 담당자를 공동 담당으로 배정

현재 다섯 사례에는 이도현 원 담당 사례가 없다. 계정은 다음 데이터 추가를 위해 만들되, 임의 사례에 배정하지 않는다. `test1`은 검증과 인계를 위해 다섯 사례 모두에 남긴다.

## 새 스택 계정 순서

| 계정 | 용도 | 준비 상태 |
|---|---|---|
| `test1` | 사회연대은행 관리자와 검증 계정 | 기관·사업·DB·음성 저장을 마법사에서 설정하고, AI·STT는 끈 채 적재 |
| `test2` | 스테이징 복제본 검증 | 운영 초기화·적재가 끝난 스택을 복제한 뒤 사용, 같은 DB를 공유하지 않음 |
| `test3` | 실제 기관 가입 안내 | 합성 데이터 적재 계정으로 쓰지 않음, 기관 주소(슬러그) 생성부터 안내 |

DB와 음성 저장 경로는 적재 전에 준비한다. AI·STT 연결은 적재와 화면 검증을 마친 뒤 설정한다. 스크립트는 시작할 때 `/speech/status`를 확인하고 `transcription_ready=true`이면 중단한다. 데이터셋 승인 전사문을 직접 가져오는 동안 Azure 자동 전사가 함께 실행되면 비용이 발생하고 정답 전사문을 뒤늦은 초안이 가릴 수 있기 때문이다.

## 일회용 로컬 리허설

공유 DB 대신 `relayer_m5_rehearsal` 같은 전용 DB를 새로 만든다. 기존 DB를 재사용하지 않는다.

```sh
docker exec relayer-db psql -U relayer -d postgres -c \
  "drop database if exists relayer_m5_rehearsal with (force)"
docker exec relayer-db psql -U relayer -d postgres -c \
  "create database relayer_m5_rehearsal"
```

일회용 키와 음성 경로를 현재 셸 환경에만 넣고 마이그레이션한다. 값은 파일·채팅·명령 인자에 남기지 않는다.

```sh
export DATABASE_URL='postgres://relayer:relayer@127.0.0.1:55432/relayer_m5_rehearsal'
export PII_ENC_KEY="$(openssl rand -base64 32)"
export SESSION_SECRET="$(openssl rand -base64 32)"
export VOICE_ENABLED=1
export VOICE_ROOT="$(mktemp -d)/voice"
node api/src/migrate.ts
```

시드는 넣지 않는다. 빈 DB의 `/auth/signup`으로 `test1` 관리자를 만들고, 기관 이름과 사업을 API 또는 마법사에서 등록한다. 그래야 검증 수치가 시드 사례를 포함하지 않고 정확히 당사자 5명이다.

서버와 빌드된 화면을 같은 원점에서 띄운 뒤 환경 변수로 비밀번호를 전달한다.

```sh
export RELAYER_PASSWORD='관리자 비밀번호'
export RELAYER_STAFF_PASSWORD='합성 실무자 공통 초기 비밀번호'
node scripts/load-dataset.mjs \
  --base https://pub-0acad9da70b54900924fea276388490a.r2.dev/2026-09-17 \
  --cases C02,C08,C01,C10,C03 \
  --api http://127.0.0.1:8790 \
  --login test1/RELAYER_PASSWORD
```

`--login`의 슬래시 뒤는 비밀번호가 아니라 환경 변수 **이름**이다. 성공 출력은 선택한 manifest 합계와 실제 적재·건너뜀 사례 수를 함께 말한다. 같은 명령을 다시 실행하면 영수증의 가명을 `/participants`와 대조하고 다섯 사례를 건너뛴다.

## Azure 새 스택 실행

플래너 GO 뒤 다음 순서로만 진행한다.

1. 새 스택 DB와 Blob 대상 확인
2. 해당 스택 환경으로 `scripts/purge-test-data.mjs` 미리보기 실행
3. 삭제 대상이 자동 시험 자료뿐인지 확인 후 `--apply`
4. `test1` 관리자·기관·사업·DB·음성 저장 상태 확인, AI·STT 연결은 끈 상태 유지
5. 위 적재 명령에 새 스택 API URL 사용, `RELAYER_DATASET_ALLOW_REMOTE=1` 추가
6. 아래 수치와 화면 검증
7. AI·STT 연결 설정
8. `RELAYER_PASSWORD`, `RELAYER_STAFF_PASSWORD`, `RELAYER_DATASET_ALLOW_REMOTE` 해제

```sh
node scripts/purge-test-data.mjs
node scripts/purge-test-data.mjs --apply
export RELAYER_DATASET_ALLOW_REMOTE=1
# 위와 같은 load-dataset 명령. --api만 GO 받은 새 스택 주소로 바꾼다.
unset RELAYER_PASSWORD RELAYER_STAFF_PASSWORD RELAYER_DATASET_ALLOW_REMOTE
```

`purge-test-data.mjs`가 남길 자료 목록을 먼저 출력한다. 예상하지 않은 이름이 남거나 삭제 대상으로 잡히면 적용하지 않는다. 이미 데이터셋을 적재한 스택을 통째로 초기화하는 도구가 아니므로, 재리허설은 일회용 DB를 폐기하고 새로 만든다.

## 검증

### 수치

manifest 재계산 기대치는 당사자 5·회차 72·녹음 65·수기 66이다. DB 수치는 일회용 DB에서만 읽는다.

```sql
select count(*) from support_cases;
select count(*) from sessions where status = 'done';
select count(*) from recordings where deleted_at is null;
select count(*) from sessions where memo is not null;
select count(*) from transcripts where status = 'approved';
```

전사 승인 기대치는 녹음 수와 같은 65다. 담당 배정은 `test1` 5건, 박지연 2건, 최은정 3건, 이도현 0건이다.

### 화면

`test1`으로 로그인해 다음 세 장을 남긴다.

1. **당사자 목록**: 다섯 카드와 담당 실무자
2. **회차별 요약**: C02의 19회차 목록과 수기·녹음·전사 상태
3. **원본 팝업과 재생**: C02 녹음 회차의 왼쪽 수기, 오른쪽 승인 전사문, 녹음 재생 컨트롤

원본 팝업에서 오디오 요청이 200이고 브라우저가 재생 가능 상태(`readyState >= 1`)가 되는지 확인한다. 수치만 맞고 원본 또는 음성이 열리지 않으면 인계하지 않는다.
