// 합성 사례 1건. 베타 완료 판정 흐름을 그대로 따라간다.
// 당사자 등록 → 인테이크 작성하기 → 상담 일정 등록 → 2회차 상담 기록하기 → 3회차 상담 일정 등록.
import { hashPassword } from './auth.ts';
import { sql } from './db.ts';
import { createCase, planSession, recordSession, saveIntake } from './service.ts';

const day = (offset: number): string =>
  new Date(Date.now() + offset * 86_400_000).toISOString();

await sql`truncate participants, support_cases restart identity cascade`;

// 베타 시험 계정. 합성 데이터 전용이며 실제 당사자 자료에는 쓰지 않는다.
const BETA_PASSWORD = process.env.SEED_PASSWORD ?? 'relayer-beta';
await sql`delete from users where email in ('worker@relayer.test', 'admin@relayer.test')`;
await sql`insert into users (email, password_hash, name, role) values
  ('worker@relayer.test', ${await hashPassword(BETA_PASSWORD)}, '시험 실무자', 'worker'),
  ('admin@relayer.test', ${await hashPassword(BETA_PASSWORD)}, '시험 관리자', 'admin')`;

const created = await createCase({
  name: '김민희',
  phone: '010-0000-0000',
  email: 'minhee@example.com',
  program_name: '함께온기금 울타리대출',
  sessions_planned: 6,
});

await saveIntake(created.case_id, {
  held_at: day(-21),
  memo: '간병으로 근로시간이 줄어 카드대금이 연체됐다고 말함.',
  overall_goal: null, // 인테이크에서 목표를 안 세워도 저장된다
  cards: [
    { kind: 'fact', text: '가족 간병으로 주 3일만 근무', section: 'intake', area: 'employment' },
    { kind: 'question', text: '채무 조정 신청 이력이 있는지', section: 'intake', area: 'economy' },
  ],
});

const second = await planSession(created.case_id, {
  scheduled_at: day(-7),
  method: 'in_person',
  place: '사회연대은행 상담실',
  plan_memo: '연체 현황 확인하고 서류 준비 안내',
});

await recordSession(second.session_id, {
  held_at: day(-7),
  memo: '연체 2건 확인. 채무 조정은 아직 신청 전이라고 함.',
  overall_goal: '연체를 정리하고 근로시간을 회복한다', // 상담 중에 전체 목표를 세움
  next_goal_text: '채무 조정 서류 준비 상황을 함께 확인한다',
  cards: [
    { kind: 'promise', text: '채무 조정 서류 떼어 오기', section: 'promise', area: 'economy' },
    { kind: 'question', text: '간병 부담을 나눌 가족이 있는지', section: 'question', area: 'family' },
    { kind: 'fact', text: '주거는 변동 없음', section: 'change', area: 'living_env' },
    { kind: 'judgment', text: '약속한 서류 제출이 두 번 미뤄짐', section: 'judgment', risk_type: '약속 불이행' },
  ],
  outcomes: [
    // 1회차의 확인할 것 카드 하나를 확인함 처리
    { card_id: 2, result: 'confirmed', note: '채무 조정 신청 이력 없음' },
  ],
});

const third = await planSession(created.case_id, {
  scheduled_at: day(3),
  method: 'phone',
  plan_memo: '서류 준비 상황 확인',
});

console.log(
  JSON.stringify(
    {
      case_id: created.case_id,
      pseudonym: created.pseudonym,
      sessions: [1, second.seq, third.seq],
      login: { email: 'worker@relayer.test', password: BETA_PASSWORD },
    },
    null,
    2,
  ),
);

await sql.end();
