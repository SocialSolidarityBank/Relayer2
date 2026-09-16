/**
 * 자동 시험이 만든 자취를 지운다(2026-09-16 Q — "사람들이 헷갈려 한다").
 *
 * E2E·실측 스크립트는 `E2E 합성1789…` 처럼 시각을 붙인 이름을 남긴다. 사람이 만든 기록과
 * 섞이면 목록이 백 줄을 넘고, 무엇이 진짜 상담이었는지 알아볼 수 없다.
 *
 * **이름 꼴로만 고른다.** 사람이 손으로 지은 이름은 이 꼴이 될 수 없다 — 뒤에 붙은
 * 13자리 숫자는 `Date.now()` 다. 이름은 금고 안이라 SQL 로 못 고르고, 여기서 복호화해서 가른다.
 *
 * **감사는 append-only 다**(`audit_log_retention` 트리거가 update 를 막고, delete 는 3년 지난 줄만 연다).
 * 사례를 지우면 `on delete set null` 이 감사 줄을 고치려 들어 그 트리거에 걸린다 —
 * 즉 지금 설계에서는 감사가 가리키는 사례를 지울 수 없다. 그것이 옳다.
 *
 * 그래서 이 스크립트는 정리하는 동안만 잠금을 풀고 `finally` 에서 반드시 되건다.
 * **합성 데이터 전용이다.** 실데이터가 든 DB 에는 절대 돌리지 않는다 — 그 DB 에서
 * 감사 잠금을 푸는 일 자체가 사고다.
 *
 *   node scripts/purge-test-data.mjs          무엇을 지울지 보여만 준다
 *   node scripts/purge-test-data.mjs --apply  실제로 지운다
 */
import { sql } from '../api/src/db.ts';
import { decryptPii } from '../api/src/pii.ts';

// 자동 시험만 쓰는 이름 꼴. 끝의 13자리는 `Date.now()` 라 사람이 지을 수 없다.
const JUNK_NAME = /^(E2E |장소시험|검증$|목표 재현 \d{10,}|목표수정 시험$|시험 당사자)/;
// 초대 흐름을 실측하며 만든 계정. 사람이 고른 아이디는 이 꼴이 아니다.
const JUNK_LOGIN = /^invited\d{3,}$/;

const apply = process.argv.includes('--apply');

const rows = await sql`
  select c.id as case_id, p.id as participant_id, p.pseudonym, v.enc_name,
         (select count(*) from sessions s where s.case_id = c.id)::int as sessions
  from support_cases c
  join participants p on p.id = c.participant_id
  left join participant_pii v on v.participant_id = p.id
  order by c.id`;

const named = rows.map((r) => ({ ...r, name: decryptPii(r.enc_name) }));
const junk = named.filter((r) => JUNK_NAME.test(r.name ?? ''));
const keep = named.filter((r) => !junk.includes(r));

console.log(`사례 ${named.length}건 — 지울 것 ${junk.length}건, 남을 것 ${keep.length}건`);
console.log('남을 것:', keep.map((r) => `${r.name ?? r.pseudonym}(${r.sessions}회차)`).join(' · ') || '(없음)');

const accounts = await sql`
  select id, email, name from users where deactivated_at is null order by id`;
const junkUsers = accounts.filter((u) => JUNK_LOGIN.test(u.email));
if (junkUsers.length) console.log('지울 계정:', junkUsers.map((u) => u.email).join(' · '));

if (!apply) {
  console.log('\n보여주기만 했어요. 실제로 지우려면 --apply 를 붙이세요.');
  process.exit(0);
}

const caseIds = junk.map((r) => r.case_id);
const pids = [...new Set(junk.map((r) => r.participant_id))];

// append-only 표는 감사 하나가 아니다. 붙어 있는 잠금을 전부 찾아 푼다 —
// 이름을 손으로 적어 두면 표가 늘 때마다 여기서 조용히 새 구멍이 난다.
// 이름 꼴로 찾는다. `audit_log` 는 2026-09-16 에 `_retention` 으로 바뀌었고,
// 그때 이 목록이 그것을 놓쳐 감사 줄 삭제가 조용히 실패했다.
const locks = await sql`
  select t.tgname, c.relname
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
  where (t.tgname like '%append_only' or t.tgname like '%_retention') and not t.tgisinternal`;
console.log('잠긴 표:', locks.map((l) => l.relname).join(' · '));

for (const l of locks) await sql.unsafe(`alter table ${l.relname} disable trigger ${l.tgname}`);
try {
if (caseIds.length) {
  // 회차끼리 서로를 가리키는 열쇠부터 끊는다(`today_goal_from_session_id` 등은 cascade 가 아니다).
  await sql`
    update sessions set today_goal_from_session_id = null, next_goal_consumed_by_session_id = null
    where case_id = any(${caseIds})`;
  // 감사 줄은 사례가 사라져도 남으므로 먼저 지운다. 주인 없는 줄을 남기지 않는다.
  await sql`delete from audit_log where case_id = any(${caseIds})`;
  // 회차를 가리키는 append-only 줄들. 사례가 지워질 때 cascade 로 따라가지만,
  // 잠금을 푼 지금 명시적으로 지워 순서 문제를 없앤다.
  await sql`delete from goal_revisions where case_id = any(${caseIds})`;
  await sql`delete from support_cases where id = any(${caseIds})`;
}

// 다른 사례가 남아 있지 않은 당사자만 지운다. 한 사람이 두 사업에 있을 수 있다.
const orphans = pids.length
  ? await sql`
      select id from participants
      where id = any(${pids}) and not exists (select 1 from support_cases c where c.participant_id = participants.id)`
  : [];
if (orphans.length) {
  const ids = orphans.map((o) => o.id);
  await sql`delete from audit_log where participant_id = any(${ids})`;
  await sql`delete from participants where id = any(${ids})`;
}

for (const u of junkUsers) {
  await sql`delete from invites where accepted_by = ${u.id} or created_by = ${u.id}`;
  await sql`delete from assignment_requests where requested_by = ${u.id} or decided_by = ${u.id}`;
  await sql`delete from audit_log where actor_id = ${u.id}`;
  await sql`update support_cases set assigned_user_id = null where assigned_user_id = ${u.id}`;
  await sql`delete from users where id = ${u.id}`;
}

} finally {
  for (const l of locks) await sql.unsafe(`alter table ${l.relname} enable trigger ${l.tgname}`);
}

// 잠금이 제자리로 돌아왔는지 확인한다. 말로 끝내지 않는다.
// **푼 것과 같은 목록으로 센다.** 전에는 확인 쿼리만 `%append_only` 라서, 감사 잠금이
// 안 걸린 채로도 '제자리' 라고 말했다(2026-09-16 검수).
const after = await sql`
  select tgname, tgenabled from pg_trigger
  where tgname = any(${locks.map((l) => l.tgname)}) and not tgisinternal`;
const loose = after.filter((t) => t.tgenabled !== 'O');
if (loose.length) throw new Error(`잠금이 안 걸린 표: ${loose.map((t) => t.tgname).join(', ')}`);
console.log(`append-only 잠금 ${after.length}개: 제자리`);

// 실측하며 만든 사업. 쓰는 사례가 없을 때만 지운다.
await sql`
  delete from programs
  where name in ('새 시험 사업', '시험 사업')
    and not exists (select 1 from support_cases c where c.program_name = programs.name)`;

const [{ count: left }] = await sql`select count(*) from support_cases`;
console.log(`\n지웠어요. 남은 사례 ${left}건.`);
process.exit(0);
