# 릴레이어 v2 — 버릴 것과 살릴 것

- 작성일: 2026-09-14
- 기준 레포: `SocialSolidarityBank/CCC` (로컬 `~/DEVELOPER/PROJECTS/CCC-new`, main `4352d321`)
- 기준 규모: 추적 파일 1,091개 / TS·JS 111,379줄 / Python 10,044줄 / 마이그레이션 62개
- 이 문서의 쓰임: 새 레포가 무엇을 이어받고 무엇을 버리는지 한 장으로 고정한다. CCC 레포는 그대로 둔다(읽기 전용 참조).

---

## 0. 무게가 어디에 있었나 (측정값)

| 덩어리 | 규모 | 성격 |
|---|---|---|
| `packages/core/src/gateway.ts` | **21,611줄 단일 파일**, export 함수 ~200개 | DB SQL + 권한 + 감사 + 암호화를 한 파일에 넣은 god-object |
| 이중 DB 이식성 | **~27,400줄** (parity.yaml 23,700 + postgres/*.sql ~3,000 + sql.ts + db-postgres 363 + db-d1 277) | SQLite↔Postgres↔D1 물리 동등성 유지 비용 |
| `packages/http-api/src/request-handler.ts` | 3,646줄 / 라우트 111개 if-체인 | 2/3가 수작업 파서·직렬화 배관 |
| `apps/web` | 34,383줄 (Next SSR, 서버액션 1,601 + api.ts 2,624) | 테스트가 파일의 ~30% |
| `apps/api` 테스트 | routes 4,241 + gateway-domain 2,677 + triggers 1,961 … | 구현 세부에 결합 |
| `scripts/` | 18,018줄 / 가드 10종 / CI 5잡 | 사고 이력에서 자란 가드 |
| `apps/pipeline` | 10,044줄 Python, venv 2개(torch·pyannote) | STT 기본값은 `off` |

핵심 가치(브리핑·인테이크·기록·일정·목표)에 직결되는 서버 코드는 gateway.ts의 **약 25%(~5,300줄)** 뿐이다. 나머지는 멀티 배포모드·설치 매니페스트·에이전트 잡 큐·레거시 이중 모델·감사 증적이다.

---

## 1. 살릴 것

### 1-1. 그대로 복사 (재작성 비용 큼, 이식 비용 0에 가까움)

| 자산 | 경로 | 비고 |
|---|---|---|
| 도메인 용어집 | `CONTEXT.md` (333줄) | 기관·당사자·사례·참여사업 정본. 화면 라벨은 2026-09-12 결정으로 갱신 |
| 결과물 정의서 | `inbox/2026-09-12/relayer-definitions-v2-2026-09-12.md` | 카드 4종·회차 요약 3층·톺아보기 7항목 — **새 제품의 사실상 PRD** |
| 화면 결정 45건 | `inbox/2026-09-12/handoff-decisions-2026-09-12.md` | 6구획 기록지·탭 4개·용어 개편 확정본 |
| 민감정보 규칙 | `inbox/2026-09-13/handoff-sensitive-data-{scope,rules,architecture}-*.md` | 밸브 3개·등급 6단계·STT/AI 정한 것/안 정한 것 |
| 와이어프레임 | `inbox/2026-09-12/relayer-wireframes-*.html`, `inbox/2026-09-13/relayer-site-wireframe.html` | 이미 릴레이어 기준으로 그려짐 |
| 디자인 토큰 | `design/tokens.css` (397줄) | 순수 CSS. 다크·고대비·reduced-motion 포함. 이식 1순위 |
| 디자인 CSS | `apps/web/app/components/wire/wire-styles.ts` (1,442줄) + `layout.tsx` 내 ~420줄 | 내용 100% CSS. 백틱 벗겨 `.css`로. `apps/client`가 이미 그 방식으로 소비 중 |
| 디자인 규칙 | `DESIGN-RULES.md` | 위계·형태 3종·여백 4단 — 명세로 그대로 사용 |
| 인테이크 질문지 | `apps/web/app/.../records/intake/intake-questions.ts` (423줄) | 순수 데이터 |
| 동의 문안 | `packages/contracts/src/consent-notice.ts` (125) + `consent.ts` (88) | 한국어 법률 문안 정본 |
| AI 프롬프트·스키마 | `packages/ai-runtime/src/ai-provider.ts` 1160-1317, 1753-1795 | 초안·대조3종·불일치·메모리. 나머지 89%는 배관이라 버림 |
| 한국어 PII 마스킹 | `apps/pipeline/ccc_pipeline/masking.py` (318) + `condition_terms.py` | stdlib 정규식 + 질병명 사전. 도메인 자산 최상 |
| 가명 ID 어휘 | `packages/contracts/src/animal-slugs.ts` (57) | append-only 동물 슬러그 |
| 순수 로직 | `access-policy.ts` (44), `schedule-calendar.ts` (219, ISO 주 계산), `form-draft.ts` (266, 민감필드 제외 규율) | 프레임워크 무관 |
| 모델 라이선스 정본 | `supply-chain/model-license-manifest.json` | STT 붙일 때 재조사 불필요 |

### 1-2. 개념만 이식 (코드는 새로, 설계는 검증됨)

- **PII 분리 보관**: 가명 ID + `participant_pii_vault` 암호문 전용 테이블 + `key_version` + 파기 상태머신. 앱층 AES-256-GCM(Node `crypto` 50줄이면 됨).
- **승인 게이트(R2)**: AI 초안은 `approved_at` 전까지 브리핑·통계·리포트에 안 나간다. 수기 메모는 즉시 공식 기록. → 단일 `drafts` 테이블 + 승인 플래그로 축소.
- **6도메인 동의(0051)**: `consent_events` append-only + 멱등키 + 문안 리비전 해시.
- **배정 상태머신(0044)**: requested/active/ended + 이관 사유 + 당사자 안내 확인.
- **append-only 감사**: 요청 미들웨어 한 곳에서 insert. gateway 함수마다 `writeAudit` 수작업 호출은 버린다.
- **AI 금지 영역(R5)·감정 숫자만(R4)**: 규칙은 `CLAUDE.md` 4장 그대로.

### 1-3. 시나리오만 이식

`apps/web` 테스트 ~60파일, `apps/api` 테스트 ~15,000줄은 DOM 클래스·RSC·mock에 강결합이라 **코드는 전부 버리고 행동 계약 목록만** 인수 기준으로 옮긴다. 예: "위기도 선택 시 아코디언 자동 펼침", "일시 비면 다음 불가", "승인 전 초안은 브리핑에 안 나옴".

---

## 2. 버릴 것

| 버릴 것 | 규모 | 왜 |
|---|---|---|
| 이중/삼중 DB 이식성 | ~27,400줄 | parity.yaml·postgres 수동 이식본·방언 스캐너·어댑터 2종. DB 하나 고르면 전부 증발 |
| 멀티 배포모드 3종 + 설치 신뢰 경계 | install-manifest 294 + capabilities 211+84 + runtime 절반 | Ed25519 서명 매니페스트·capability 게이팅은 '설치형 판매' 운영 모델 산물 |
| 에이전트 잡 큐 v2 | gateway ~1,718 + contracts 352 + 라우트 17개 | claim/lease/heartbeat/egress/4-probe 삭제증빙 = 외부 처리 장비 전제 |
| 오디오 생애주기·삭제 증빙 | ~480줄 + 테이블 4개 | 보존기간 삭제는 TTL 작업 하나로 족함 |
| 레거시↔canonical 이중 표면 | 레거시 함수 ~30개 + 라우트 11개 + 호환 뷰·컷오버 매니페스트 | canonical만 만든다 |
| 초대·자기가입 토큰 | ~720줄 + 공개 라우트 6개 | v0은 관리자 등록만 |
| 상담 메모리 서브시스템 | gateway 796 + 테이블 11개 + 무효화 트리거 ~20개 + 라우트 7개 | 별도 NER·egress·세대 임대가 전제 |
| 프리뷰 게이트 | `preview-gate.ts` 325 + middleware + `/preview/*` | 배포 부산물 |
| Next SSR + 서버 액션 | 1,601 + 2,624줄 | ADR-0041(D80)이 이미 "정적 클라이언트 + Bearer API"로 방향 확정 |
| admin 5화면·onboarding·join·welcome·kit | ~1,500줄 | v0 범위 밖 |
| 디자인 가드 스위트 | ~4,400줄 + CI 2잡(Playwright·한글폰트) | 디자인 사고 이력에서 자란 가드. 사고 나면 그때 하나씩 |
| 릴리스 공급망 게이트 | `release/verify.mjs` 930줄 + supply-chain 절차 | `.cccx` 오픈소스 배포판 전제 |
| STT 벤치마크·fixture | ~1,900줄 + fixture 150개 | 엔진 선정 끝난 뒤의 회귀 도구 |
| `apps/pipeline` 무거운 반쪽 | qwen_runtime·qwen_child·diarize·emotion·trial_server·azure_stt | torch 격리 venv + 모델 수 GB + HF 게이트 |
| SQLite `_next` 리빌드 관례 | 0033·0034·0036·0039·0045·0053 | ALTER 한계 우회. 처음부터 맞는 스키마로 만들면 불필요 |
| 타임스탬프 정규화 트리거 7개 + 0047 | 레거시 포맷 교정용 | 앱에서 ISO만 쓰면 됨 |
| `artifacts/`·`records/`·`_workspace/`·`docs/superpowers/plans` 43개·handoffs·postmortems | 158파일 + 374MB | 에이전트 작업 흔적. **`records/test/`의 실인물 녹음 m4a 5개는 이전 금지(PII)** |
| 106티켓·E0~E12 웨이브 절차 | `CCC_OPEN_PILOT_PLAN.md` 610줄 | 참조용으로만. 첫날부터 지면 무게 |

---

## 3. 권고하는 v0 골격

CCC 자신의 2026-09-13 결정("상담 기록은 서울 서버에 저장, STT 끔 + AI 켬이 권장 기본값")과 일치시킨 최소 구성:

| 층 | 선택 | 버려지는 것 |
|---|---|---|
| 배포 | 단일 모드(기관 소유 Postgres 서울) | Local Single/Office 분기, 설치기, DPAPI, Electron |
| DB | Postgres 하나 + 순번 SQL 마이그레이션 | parity.yaml, 어댑터 3종, 방언 스캐너 |
| API | 라우터 1개(Hono 등) + zod 검증 1곳 + 도메인별 모듈 | if-체인 111개, 수작업 파서 2,400줄 |
| 화면 | Vite SPA + fetch 클라이언트 | Next SSR, 서버 액션, 미들웨어 게이트 |
| 디자인 | tokens.css + wire CSS를 `.css`로 추출, 래퍼 컴포넌트는 필요한 것만 | wire 래퍼 ~60개, kit, 실측 하니스 |
| AI | 수기 메모 → 마스킹 → OpenAI, 초안은 승인 전 비공식 | 에이전트 잡 큐, 오디오 생애주기, 메모리 |
| STT | **day-1 제외** (제품 기본값이 `off`, 수기 경로가 완결 경로) | 파이프라인 전체 |
| CI | typecheck + test + gitleaks | 가드 10종, 디자인 스윕, 배포 게이트 |

핵심 테이블은 ~20개(당사자·참여사업·배정·PII금고·회차·목표+이력·할일·위험신호·일정·동의이벤트·감사·AI초안)로 시작. 나머지 ~30개는 위에서 버린 기능에 딸린 것이다.

**규모 예상**: 서버 도메인 ~5~6k + API ~1.5k + SPA ~8k ≈ 15k줄 안팎. 원본의 1/7.

---

## 4. 결정 필요 (Q 확인)

1. **DB**: Postgres(Supabase 서울) 단일로 못박나, 아니면 Local 모드 여지를 남기나. 남기면 포트 추상화가 다시 들어온다.
2. **범위**: v0에 사례 종결·PII 보존 파기·관리자 화면을 넣나, 빼나.
3. **AI**: v0에 AI를 켜나(마스킹 경로 필요), 아니면 수기+구조화 값만으로 톺아보기·리포트를 먼저 세우나.
4. **디자인**: CCC 디자인을 계승하나(토큰·CSS 이식), 새로 그리나. 계승 시 CCC `DESIGN` 워크트리 소유권 규칙과의 관계 정리 필요(현재 규칙은 CCC 레포 파일 한정).
5. **코드 이식 경로**: CCC를 서브모듈/참조로 두나, 필요한 파일만 복사하고 출처를 주석으로 남기나(Apache-2.0 + NOTICE 승계 필요).
