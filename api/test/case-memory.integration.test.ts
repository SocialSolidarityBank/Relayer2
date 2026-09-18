// 사례 기억(2026-09-18 Q, SPEC §15-6). 외부 모델은 fetch 스텁이다 — 요청 본문을 가로채 **무엇이 나가는지**를 본다.
//
//  - 동의 없으면 기억도 없고 외부 호출도 없다
//  - 기록 저장·승인 뒤에 뒤에서 한 번 접히고, 감사에 어디로 무엇을 보냈는지 남는다
//  - 초안은 "직전까지" 의 기억만 쓰고, 없거나 어긋나면 그 자리에서 다시 만든다. 그것도 안 되면 503
//  - 원본 수정·동의 철회·사례 삭제·종결에 따라 사라지거나 얼어붙는다
//  - 초안 요청 본문은 회차 수에 비례해 자라지 않는다
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MEMORY_MAX_CHARS, refreshCaseMemory, settleCaseMemory } from '../src/ai.ts';
import { sql } from '../src/db.ts';
import { encryptPii } from '../src/pii.ts';
import { enabled, fixture, req } from './voice-fixture.ts';

const CONSENTS = ['personal_data_collection_use', 'sensitive_information_processing', 'external_llm_cross_border_processing'] as const;
const NO_LLM = ['personal_data_collection_use', 'sensitive_information_processing'] as const;

/** 금고 값. 어느 요청 본문에도 실리면 사고다. */
const REAL = { name: '김민희', phone: '010-2345-6789' };

type Sent = { name: string; prompt: string; body: string };
/** 스텁이 받은 요청. 어떤 틀(초안·기억)로 무엇을 보냈는지. */
let sent: Sent[] = [];
/** 기억 응답을 시험마다 바꾼다 — 근거 오류·상한 초과를 흉내 낸다. */
const goodMemory = ({ session_ids }: { session_ids: number[] }) => ({
  text: `전체 목표: 월세 연체 해소 (1회차). 미완료 과제: 내역서 떼기 (${session_ids.length}회차).`,
  refs: session_ids.map((id, i) => ({ session_id: id, seq: i + 1, card_ids: [] })),
});
let memoryReply: (ids: { session_ids: number[] }) => unknown = goodMemory;

beforeEach(() => {
  sent = [];
  memoryReply = goodMemory;
  vi.stubEnv('OPENAI_API_KEY', 'test-key');
  vi.stubEnv('AI_PROVIDER', 'openai');
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { text: { format: { name: string } }; input: Array<{ content: string }> };
    const name = body.text.format.name;
    const prompt = body.input[1].content;
    sent.push({ name, prompt, body: init.body });
    const reply =
      name === 'case_memory'
        ? memoryReply({ session_ids: [...prompt.matchAll(/session_id=(\d+)/g)].map((m) => Number(m[1])) })
        : { summary: '요약', changes: [], tasks: [], questions: [], fact_changes: [] };
    return new Response(JSON.stringify({ output_text: JSON.stringify(reply) }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const memoryRow = async (caseId: number) =>
  (await sql<Array<{ through_seq: number; updated_at: string }>>`
    select through_seq, updated_at from case_memories where case_id = ${caseId}`)[0] ?? null;
const lastMemoryAudit = async (caseId: number) =>
  (await sql<Array<{ fields: string[] }>>`
    select fields from audit_log where action = 'ai.memory' and case_id = ${caseId} order by id desc limit 1`)[0];

async function caseWith(consents: readonly string[]) {
  const f = await fixture(consents);
  await sql`insert into participant_pii (participant_id, enc_name, enc_phone)
    select participant_id, ${encryptPii(REAL.name)}, ${encryptPii(REAL.phone)} from support_cases where id = ${f.case_id}
    on conflict (participant_id) do update set enc_name = excluded.enc_name, enc_phone = excluded.enc_phone`;
  return f;
}

/** 회차 하나를 잡고 기록한 뒤, 뒤에서 도는 기억 갱신까지 기다린다. 본문에 금고 값을 섞는다 — 마스킹이 빠지면 걸린다. */
async function record(caseId: number, worker: number, seq: number, memo?: string) {
  const planned = await (await req(`/cases/${caseId}/sessions`, worker, 'POST', {
    scheduled_at: `2026-09-${String(seq).padStart(2, '0')}T01:00:00Z`, method: 'phone',
  })).json();
  const saved = await req(`/sessions/${planned.session_id}`, worker, 'PATCH', {
    memo: memo ?? `${REAL.name}가 월세 ${seq}개월 밀렸다고 함. 연락은 ${REAL.phone}.`,
    method: 'phone',
    cards: [{ kind: 'promise', text: `${seq}회차 과제: 내역서 떼기`, section: 'promise' }],
  });
  expect(saved.status).toBe(200);
  await settleCaseMemory();
  return planned.session_id as number;
}
async function revise(sessionId: number, worker: number, memo: string) {
  expect((await req(`/sessions/${sessionId}`, worker, 'PATCH', { memo, method: 'phone' })).status).toBe(200);
  await settleCaseMemory();
}

const memoryCalls = () => sent.filter((s) => s.name === 'case_memory');
const draftCalls = () => sent.filter((s) => s.name === 'session_draft');

describe.skipIf(!enabled)('사례 기억', () => {
  it('외부 LLM 동의가 없으면 기억도 외부 호출도 없다', async () => {
    const { case_id, worker } = await caseWith(NO_LLM);
    await record(case_id, worker, 1);
    await record(case_id, worker, 2);
    expect(await memoryRow(case_id)).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it('기록 저장 뒤 직전 회차까지 접히고, 원문 없이 나가며, 감사에 남는다', async () => {
    const { case_id, worker } = await caseWith(CONSENTS);
    const s1 = await record(case_id, worker, 1);
    // 1회차뿐이면 접을 "직전" 이 없다.
    expect(await memoryRow(case_id)).toBeNull();
    expect(memoryCalls()).toHaveLength(0);

    await record(case_id, worker, 2);
    expect((await memoryRow(case_id))?.through_seq).toBe(1);
    const [call] = memoryCalls();
    expect(call.body).not.toContain(REAL.name);
    expect(call.body).not.toContain(REAL.phone);
    expect(call.prompt).toContain(`[1회차 session_id=${s1}]`);
    expect(call.prompt).toMatch(/card_id=\d+/);
    expect(call.prompt).toContain('[연락처]');

    const audit = await lastMemoryAudit(case_id);
    expect(audit.fields).toEqual(
      expect.arrayContaining(['trigger=record_done', 'through_seq=1', 'store=false', 'masked:name=1', 'masked:phone=1']),
    );
    expect(audit.fields.some((f) => f.startsWith('recipient='))).toBe(true);
    expect(audit.fields.some((f) => f.startsWith('country='))).toBe(true);
  });

  // v6(2026-09-18 Q 결정 20): 초안은 기억을 읽지 않는다 — 기억은 저장·삭제·동결만 남은 보류 기능이다.
  // 그래서 여기서는 원본 수정이 기억을 지우고 다시 접는 것까지만 본다.
  it('원본을 고치면 지워지고 다시 접힌다', async () => {
    const { case_id, worker } = await caseWith(CONSENTS);
    const s1 = await record(case_id, worker, 1);
    const s2 = await record(case_id, worker, 2);
    expect((await memoryRow(case_id))?.through_seq).toBe(1);

    // 지난 회차(1회차) 수정: 트랜잭션에서 지우고, 지난 회차 수정이라 전부(2회차까지) 다시 접힌다.
    sent = [];
    await revise(s1, worker, `${REAL.name} 월세 1개월. 고침.`);
    expect((await memoryRow(case_id))?.through_seq).toBe(2);
    expect(memoryCalls()[0].prompt).toContain(`[2회차 session_id=${s2}]`);
    expect((await lastMemoryAudit(case_id)).fields).toContain('trigger=edit');

    // 마지막 회차(2회차) 수정: 그 앞까지만 접힌다.
    sent = [];
    await revise(s2, worker, `${REAL.name} 월세 2개월. 고침.`);
    expect((await memoryRow(case_id))?.through_seq).toBe(1);
    expect(memoryCalls()[0].prompt).not.toContain(`session_id=${s2}]`);

    // 근거가 사례 밖을 가리키면 실패. 상한을 넘어도 실패. 행은 남지 않는다.
    await sql`delete from case_memories where case_id = ${case_id}`;
    memoryReply = () => ({ text: '지어낸 기억', refs: [{ session_id: 999999999, seq: 1, card_ids: [] }] });
    await expect(refreshCaseMemory(case_id, worker, 'edit')).rejects.toThrow();
    memoryReply = () => ({ text: '가'.repeat(MEMORY_MAX_CHARS + 1), refs: [] });
    await expect(refreshCaseMemory(case_id, worker, 'edit')).rejects.toThrow();
    expect(await memoryRow(case_id)).toBeNull();
  });

  it('종결 사례는 얼어붙고, 동의 철회·사례 삭제로 사라진다', async () => {
    const { case_id, worker } = await caseWith(CONSENTS);
    await record(case_id, worker, 1);
    await record(case_id, worker, 2);
    const before = await memoryRow(case_id);
    expect(before?.through_seq).toBe(1);

    await sql`update support_cases set status = 'closed' where id = ${case_id}`;
    sent = [];
    expect(await refreshCaseMemory(case_id, worker, 'approve_draft')).toBeNull();
    expect(sent).toHaveLength(0);
    expect(await memoryRow(case_id)).toEqual(before);
    await sql`update support_cases set status = 'open' where id = ${case_id}`;

    const withdrawn = await req(`/cases/${case_id}/consents`, worker, 'POST', {
      domain: 'external_llm_cross_border_processing', decision: 'withdraw',
    });
    expect(withdrawn.status).toBe(200);
    expect(await memoryRow(case_id)).toBeNull();
    const [{ n }] = await sql<Array<{ n: number }>>`
      select count(*)::int as n from audit_log where action = 'ai.memory.withdraw' and case_id = ${case_id}`;
    expect(n).toBe(1);
    // 철회 뒤 기록해도 새 기억은 생기지 않는다.
    sent = [];
    await record(case_id, worker, 3);
    expect(await memoryRow(case_id)).toBeNull();
    expect(memoryCalls()).toHaveLength(0);

    const other = await caseWith(CONSENTS);
    await record(other.case_id, other.worker, 1);
    await record(other.case_id, other.worker, 2);
    expect(await memoryRow(other.case_id)).not.toBeNull();
    // 사례 삭제는 운영 절차(scripts/purge-test-data.mjs)처럼 append-only 잠금을 잠시 풀어야 한다.
    const locks = await sql<Array<{ tgname: string; relname: string }>>`
      select t.tgname, c.relname from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where (t.tgname like '%append_only' or t.tgname like '%_retention') and not t.tgisinternal`;
    for (const l of locks) await sql.unsafe(`alter table ${l.relname} disable trigger ${l.tgname}`);
    try {
      await sql`delete from support_cases where id = ${other.case_id}`;
    } finally {
      for (const l of locks) await sql.unsafe(`alter table ${l.relname} enable trigger ${l.tgname}`);
    }
    expect(await memoryRow(other.case_id)).toBeNull();
  });
});
