# 릴레이어 v2 작업계획안 (베타까지)

- 작성일: 2026-09-14 · 개정 2: 2026-09-13 PLANNER 확정(표시명 9건·후속 요구 36건·다섯 결정·인테이크) 반영
- 짝 문서: `GLOSSARY.md`(**이름 정본**), `SPEC.md`(동작 계약), `CARRYOVER.md`(버릴 것/살릴 것), `.ouroboros/seed-beta.yaml`(실행 Seed)
- 제품 정본: CCC `.worktrees/PLANNER/docs/superpowers/plans/2026-09-13-planner-handoff.md`(최신·우선), `inbox/2026-09-12/relayer-definitions-v2-2026-09-12.md`, `handoff-decisions-2026-09-12.md`, `inbox/2026-09-13/handoff-sensitive-data-rules-2026-09-13.md`

---

## 1. 베타 완료 판정 — 두 관문

**관문 1 (기계)**: 합성 당사자 1명으로 **당사자 등록 → 인테이크 작성하기 → 상담 일정 등록 → 2회차 상담 기록하기**를 마치면, **15초 다시보기**가 확인할 과제·오늘 물어볼 것·오늘 상담 목표·수기 위험 신호를 각각 **출처 회차 번호**와 함께 띄운다. E2E 1개로 판정.

**관문 2 (사람)**: 실무자 1명이 도움 없이 합성 사례 2회차를 기록했을 때 **필수 입력 수와 소요 시간이 현행 CCC 베타보다 늘지 않고**, 다음 상담에도 쓰겠다고 답한다. **비교 대상은 현행 CCC 베타 클라이언트다**(2026-09-14 Q 확정 — 원래 기준은 종이·한글 서식이었으나 지금은 기존 버전이 경쟁 제품이다). 종이·한글 서식은 보조 기준으로만 적는다.

관문 1만 통과하면 "조립 로직이 돈다"는 뜻이지 제품이 돈다는 뜻이 아니다(Ouroboros contrarian 지적 1). 확정 결정 03·13이 약속한 것은 **기록이 덜 번거로워지는 것**이다.

**베타 데이터는 합성 자료만 쓴다.** 실제 당사자 자료를 넣는 순간 동의·감사·자유 글 암호화·백업이 선행조건이 된다(2026-09-13 규칙). 그것은 베타가 아니라 P1이다.

---

## 2. 확정 (검토 반영)

| # | 결정 | 근거 |
|---|---|---|
| A1 | DB는 **Postgres 하나**. 이식성 계층 없음 | 2026-09-13 "서울 서버에 저장". CCC에서 이 계층만 27,400줄 |
| A2 | **단일 배포 모드**. 설치기·서명 매니페스트·capability 게이팅 없음 | 베타는 기관 1곳 |
| A3 | **단일 기관**. `org_id` 없음 | 필요해지면 Postgres ALTER + RLS |
| A4 | **STT 없음. AI는 베타 비교군 밖**이되 카드 모델에 수납 자리(`source_type`)만 남긴다 | 설치 기본값이 AI·STT 꺼짐. AI 없는 열화 동작이 정본 요구 |
| A5 | 화면은 **Vite React SPA 하나** + JSON API 하나 | ADR-0041 D80 |
| A6 | 디자인 **계승**: `tokens.css` 397줄 + wire CSS 1,442줄을 `.css`로 이식 | |
| A7 | Apache-2.0 승계. 이식 파일 첫머리에 원본 경로 주석 + NOTICE | |
| **D1** | 인증은 **자체 Argon2id + httpOnly 쿠키 세션**(~80줄). Supabase Auth 쓰지 않음 | 벤더 결정을 베타 전으로 당기지 않기 위해. MFA는 P1 |
| **D4** | 베타는 **합성 데이터 전용** | 위 §1 |
| D2 | 배포처는 **P1 전까지 미정**. 베타는 로컬 + 사내 임시 호스트 | 합성 데이터라 국내 리전 요건이 아직 안 걸림 |
| D3 | `org_id` 안 넣음 | A3 |
| D5 | CCC와 독립 레포. 파일별 출처 주석 | A7 |

---

## 3. 단계

### M0 — 토대

워크스페이스 2개(`api`, `web`), docker compose Postgres 17, `migrations/0001_init.sql` + 러너(`node api/src/migrate.ts`, `--check` 지원), 8테이블, CSS 이식, 앱 셸.

### M1 — 쓰기 경로 (핵심)

| 흐름 | 내용 | 만들어지는 카드 |
|---|---|---|
| 당사자 등록 | 가명 ID 발번, PII 금고(AES-256-GCM), 참여 사업 | — |
| 인테이크 작성하기 | 공통 뼈대 + 고른 영역 모듈 + 전체 상담 목표 + 다음에 물어볼 것. 질문지 이식 + 공적급여 4문항 개정 | `fact`·`judgment`·`question` |
| 상담 일정 등록 | `sessions`에 `status=planned` 행 1개(일시·방법·**메모**) | — (메모는 카드가 아니다, 요구 4) |
| 상담 기록하기 | 6구획(수기 메모 필수 / 수행할 과제 / 다음에 물어볼 것 / 달라진 것 / 실무자 의견 / 다음 상담 목표). 열린 카드는 보조 레일 + 결과 버튼 | `promise`·`question`·`fact`·`judgment` + 미처리 카드 `unchecked` 자동 |

카드 생성·결과·개폐 규칙은 `SPEC.md` §2, 목표 이어받기는 §4.

### M2 — 읽기 경로

15초 다시보기 **6구획**(위험 신호 / 당사자 카드 / 목표 / 직전 회차 요약 / 오늘 물어볼 것 / 확인할 과제). 상태 3종 계산은 `SPEC.md` §3.

### M2.5 — 디자인 패스 (한 번에, 화면이 다 생긴 뒤) — **완료 2026-09-14**

M0~M2 화면은 **의도적으로 무지 상태**로 둔다. 이식한 CSS에서 **토큰(색·간격·형태 변수)만** 쓰고 wire의 컴포넌트 클래스 계약은 붙이지 않는다.

| 왜 미루나 | 근거 |
|---|---|
| 지금 검증 대상은 데이터 흐름이지 픽셀이 아니다 | 관문 1은 조립 로직 판정이다(§1) |
| 디자인 정본은 CCC `DESIGN` 워크트리 소유다 | 임의 해석으로 붙이면 전부 다시 고친다 |
| 화면 5개가 다 생긴 뒤 한 번에 해야 위계가 맞는다 | 화면마다 따로 입히면 화면 간 위계가 어긋난다 |

한 번에 할 일: 라벨·문구 다듬기(예: `목표` 아래 전체/오늘 두 줄의 구분 방식), 카드 아웃라인 계약(`.surface-card`), 배지·버튼 어휘, 위계 4단 여백, 위험 신호 배너의 그라데이션 테두리, 반응형 1280/767/390, 긴 이름 잘림 검사.

**결과**: CCC `layout.tsx`의 셸·화면 CSS를 `web/src/styles/shell.css`로 추가 이식(1,220줄)하고, 화면 5개를 wire 계약(`surface-card wire-card`·`wire-button[data-variant]`·`wire-form-field`·`wire-choice`·`rail-grid record-grid`·`risk-banner`)으로 교체했다. 임시 클래스 19종은 `web/src/ui.tsx` 부품으로 흡수해 전부 제거했다. 선택은 알약 버튼이 아니라 네이티브 radio·checkbox다.

**남은 것**: 라벨·문구 미세 조정, 다크·고대비 확인. 1280/767/390에서 가로 넘침 0은 확인했다.

**착수 조건(이력)**: 화면 5개가 다 있고 관문 1이 통과한 뒤. `DESIGN.md`·`DESIGN-RULES.md`를 정본으로 읽고, 이식 CSS의 클래스 이름을 그대로 쓴다(이름을 바꾸면 이식이 구조 변경이 된다).

### M3 — 시험 가능 상태

- 로그인 **완료 2026-09-14**: Argon2id(`@node-rs/argon2`) + HMAC 서명 httpOnly 쿠키(12시간). 세션 표를 두지 않았다 — 강제 로그아웃·기기 관리가 필요해지면 P1에서 만든다. `/health`와 `/auth/login` 밖의 모든 API는 401로 막힌다.
- 합성 시드 1세트 **완료**: 사례 1건 + 시험 계정 2개(worker·admin).
- 진입 동선 **완료 2026-09-14**: 홈을 `일정`(`/schedule`)으로 두고 `당사자 목록`을 더했다(화면 5 → 7, API 6 → 8). 처음에 `다가오는 상담`·`당사자`라는 없는 이름을 썼고 2026-09-15 Q가 잡아 정본(`GLOSSARY.md` §2-2)으로 되돌렸다.
- 즉석 기록 **완료 2026-09-15**: 예정 회차가 없어도 `상담 기록하기`에서 일시·상담 방식을 적고 회차를 연다. 일정 등록은 기록의 전제가 아니다. 관문 2 대본에서 "사례로 돌아갈 길이 없다"고 미리 사과해야 했던 자리다. 목록 검색은 이름이 암호문이라 화면에서 거른다(`SPEC.md` §1).
- 남은 것: 사내 임시 배포(D2 미정이라 로컬 우선), **관문 2 실측**.

### 베타 밖 (각각 별도 Seed)

| 단계 | 내용 | 시작 조건 |
|---|---|---|
| P1 실데이터 게이트 | 동의 2영역(개인정보 수집·이용 / 민감정보 처리)·철회·문안 해시, `audit_log`, 자유 글 암호화, 백업·복구, 국내 리전 배포(D2) | 실제 당사자 자료를 넣기로 할 때 |
| P2 결과물 확장 | 당사자 정보 탭 4(회차별 요약·15초 다시보기·목표·정보), 상담 종결, 일정 화면 | 관문 2 통과 후 |
| P3 AI 텍스트 경로 | 마스킹 → OpenAI → 승인 게이트(R2) → AI가 정리한 내용 검토하기(승인/수정, 불일치 2종 분리) | P1 완료 후 |
| P4 STT | 엔진 1종만 | S13 자격 통과 후 |

---

## 4. 스키마 (10테이블)

```
users(id, email, password_hash, name, role[participant|worker|admin], created_at, deactivated_at)
participants(id, pseudonym, created_at)
participant_pii(participant_id PK, enc_name, enc_phone, enc_birth, enc_address, key_version)
support_cases(id, participant_id, program_name, status[open|closed], opened_at,
              overall_goal, overall_goal_source[agreed|intake_need], sessions_planned,   -- overall_goal 은 NULL 허용
              assigned_user_id)
sessions(id, case_id, seq, kind[intake|regular], status[planned|done],
         scheduled_at, method, place, plan_memo, held_at, memo, detail_json,
         today_goal_text, today_goal_from_session_id,   -- 이어받은 오늘 상담 목표
         next_goal_text,                                 -- 이 회차에서 쓴 다음 상담 목표
         next_goal_consumed_by_session_id,
         created_by, created_at)
cards(id, case_id, kind[fact|question|promise|judgment], text,
      area, topic_key, risk_type, quote,
      source_session_id, source_section, source_type[manual|ai_approved], created_at)
card_outcomes(id, card_id, session_id, result[done|in_progress|not_done|confirmed|unchecked],
              follow[continue|stop], reason, note, created_at,
              UNIQUE(card_id, session_id))
schema_migrations(version, applied_at)
goal_revisions(id, case_id, text, changed_by, created_at)   -- 전체 상담 목표 문구 이력, append-only
case_closures(id, case_id UNIQUE, last_session_id, closed_at, close_reason,
              unfinished_note, created_by)                  -- 상담 종결 기록. 회차가 아니다(P2 구현, 모델만 고정)
```

검토로 바뀐 것:
- `schedules` → `sessions.status=planned`로 병합. 일정이 곧 예정 회차이므로 일정에서 만든 카드도 `source_session_id`를 갖는다(architect 지적 2 해소).
- `risk_flags` → `cards(kind=judgment, risk_type, quote)`로 병합.
- `cards.closed_at` 제거. 열림/닫힘은 `card_outcomes`에서 파생한다(상태 중복 소유 제거).
- `card_outcomes.result`에 `confirmed` 추가(확인할 것 카드의 "확인함").
- `cards.area`·`topic_key`·`source_section` 추가 — 주제별 "처음/마지막 확인된 상태"를 계산할 축(P2 리포트의 전제).
- `programs`·`case_assignees`·`consent_events`·`short_term_goals`·`audit_log` 제거 → P1/P2.
- 파생 사실 카드는 **저장하지 않는다**. 결과에서 조립한다.

2026-09-13 확정으로 바뀐 것:
- `long_term_goal` → **`overall_goal`(전체 상담 목표)**. `단기목표`라는 개념 자체를 두지 않는다.
- `sessions.today_goal_*` / `next_goal_*` 추가 — 목표 이어받기를 회차에 결속한다. 조회·예약 취소로 소비되지 않도록 **수신 회차 id**를 기록한다(`SPEC.md` §4).
- `sessions.crisis_level` **제거**(요구 18), `plan_note` → `plan_memo`(요구 4), `place` 추가(대면일 때만, 요구 14).
- `cards.owner`·`due_on` **제거**(요구 15·16). 기한과 수행 주체를 입력받지 않으므로 묵시적 완료가 생기지 않는다.

2026-09-14 Q 확정으로 바뀐 것:
- `overall_goal`은 **NULL 허용**. 인테이크에서 목표를 안 세워도 저장된다.
- **`goal_revisions` 부활**(베타). 전체 상담 목표는 상담 중에도 고칠 수 있고 이전 문구를 남긴다. 지난 회차 기록의 당시 목표는 소급 변경하지 않는다.
- **`case_closures` 신설**. `상담 종결`은 회차가 아니라 마지막 상담에 붙는 확인 절차다 → `sessions.kind`에 `closing`을 넣지 않는다. 구현은 P2지만 모델 경계는 지금 고정한다.
- `users.role`을 **`participant|worker|admin` 셋**으로. 구 `기관 관리자`/`기술 관리자` 2단 구분 삭제.

---

## 5. API (6개)

| API | 책임 |
|---|---|
| `POST /cases` | 당사자 + PII 금고 + 사례를 한 트랜잭션에 |
| `PUT /cases/:id/intake` | 1회차(intake) 저장 + 첫 카드 생성 |
| `POST /cases/:id/sessions` | 예정 회차(상담 일정 등록) 생성 |
| `GET /cases/:id` | 화면 재진입용: 당사자·예정 회차·열린 카드 |
| `PATCH /sessions/:id` | 회차 기록 + 카드 결과 + 새 카드 + 위험 신호를 **한 트랜잭션**. 제출 안 된 열린 카드는 같은 트랜잭션에서 `unchecked` |
| `GET /cases/:id/briefing` | 15초 다시보기. 고정 개수 쿼리(N+1 금지) |

로그인 2개(`POST /auth/login`, `GET /me`)는 M3에 추가. 나머지 15개(목록·일정 변경·목표·종결·리포트)는 P1/P2.

---

## 6. 규모 예상

| 영역 | 줄 |
|---|---|
| 스키마·마이그레이션 | ~200 |
| API·도메인·검증 | ~900 |
| 15초 다시보기 조립 | ~250 |
| SPA 5흐름 | ~1,600 |
| 인테이크 질문 데이터(이식) | 423 |
| CSS(이식) | 1,839 |
| 인증 | ~80 |
| 테스트(E2E 1 + 단위 3) | ~300 |
| **합계** | **~5,600** (새로 쓰는 코드 ~3,300) |

CCC 121k줄의 1/21. 초안의 10,200줄 추정은 리포트·운영 기능을 베타에 넣었을 때의 값이었다.

---

## 7. 남은 확인 (Q)

| # | 질문 | 상태 |
|---|---|---|
| Q-b | 베타 시험 인원·기간 | **닫힘** — 먼저 이 컴퓨터 한 대에서 관문 2까지 끝낸다. 다른 컴퓨터 접속은 배포 요구라 M3로 분리 |
| Q-d | 한 상담이 두 사례에 걸치는 실무 | **닫힘** — 한 상담 = 한 사례 = 한 사업. 겹침 없음, 회차는 사례에 1:1, 데이터도 사례별로 분리 |
| Q-f | 당사자 열람 | **닫힘(P2)** — 로그인 없음. 실무자가 전달한 **링크 + 코드**로만 여는 열람 페이지. 보이는 것은 **기본정보(이름·연락처·이메일)와 자기 일정까지**. 베타에선 빼고, 잘 돌아가면 바로 붙인다 |
| PII 금고 | 한 사람이 두 사업에 참여할 때 | **닫힘** — 금고는 **당사자 1명당 하나**. 사례별로 쪼개지 않는다 |
| 베타 사업명 | 시드 데이터 | **닫힘** — `함께온기금 울타리대출` |

**닫힌 것(이전)**: Q-a 비교 대상 = 현행 CCC 베타(§1). Q-c 욕구영역 = **국가 표준 10종 + 기타**(2024 희망복지지원단 업무안내, `SPEC.md` §6). Q-e 상담 종결 = 회차 아님, 다음 목표 소비 안 함(`SPEC.md` §4-3). Q8의 "이번 상담 목표 잠금"은 구획 삭제로 해소.
