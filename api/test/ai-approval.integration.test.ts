// Isolated local DB only: scripts/check-case-access.mjs creates and migrates a disposable database.
// No external AI call: the draft row is inserted directly, exactly as draftSession stores it.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { issueCookie } from '../src/auth.ts';
import { DATABASE_URL, sql } from '../src/db.ts';
import { app } from '../src/routes.ts';
import { ensureProgram } from './voice-fixture.ts';

const enabled = process.env.RELAYER_INTEGRATION === '1';
if (enabled) {
  const db = new URL(DATABASE_URL);
  if (!['localhost', '127.0.0.1'].includes(db.hostname) || !db.pathname.startsWith('/relayer_shared_check_')) {
    throw new Error('Integration tests require an isolated relayer_shared_check_ database on localhost.');
  }
}

const request = (path: string, actor: number, method = 'GET', body?: unknown) =>
  app.request(path, {
    method,
    headers: {
      cookie: issueCookie(actor).split(';')[0],
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function fixture() {
  const prefix = randomUUID();
  const [{ id: actor }] = await sql<Array<{ id: number }>>`
    insert into users (email, name, role) values (${`${prefix}@test.invalid`}, 'AI 승인 검증', 'worker')
    returning id`;
  const created = await request('/cases', actor, 'POST', {
    name: 'AI 승인 합성',
    program_id: await ensureProgram('회귀 검증'),
    consents: [
      { domain: 'personal_data_collection_use', decision: 'grant' },
      { domain: 'sensitive_information_processing', decision: 'grant' },
    ],
  });
  expect(created.status).toBe(201);
  const { case_id: caseId } = (await created.json()) as { case_id: number };
  const planned = await request(`/cases/${caseId}/sessions`, actor, 'POST', {
    scheduled_at: '2026-09-10T01:00:00Z', method: 'phone',
  });
  const { session_id: sessionId } = (await planned.json()) as { session_id: number };
  const recorded = await request(`/sessions/${sessionId}`, actor, 'PATCH', {
    memo: '월세 두 달 밀림. 내역서는 못 뗐다고 함.',
    method: 'phone',
    cards: [{ kind: 'promise', text: '이미 적은 과제', section: 'promise' }],
  });
  expect(recorded.status).toBe(200);
  return { actor, caseId, sessionId };
}

const FACT = { topic: '월세 연체 개월 수', before: { seq: 1, quote: '월세 한 달 밀림.' }, after: { seq: 2, quote: '월세 두 달 밀림.' }, note: '연체가 한 달에서 두 달로 늘었다고 말함.' };
const draftRow = (sessionId: number, actor: number, tasks: string[]) => sql`
  insert into ai_drafts (session_id, status, summary, changes, tasks, questions, fact_changes, mask_hits, model, created_by)
  values (${sessionId}, 'draft', '월세 연체가 두 달로 늘었다고 함.', ${sql.json(['연체 1개월 → 2개월'])},
          ${sql.json(tasks)}, ${sql.json(['내역서를 못 뗀 이유'])}, ${sql.json([FACT])}, '{}'::jsonb, 'test-model', ${actor})`;

type OpenCard = { kind: string; text: string; source_type: string };
type Detail = {
  sessions: Array<{ id: number; ai_summary: { summary: string; changes: string[]; fact_changes: unknown[] } | null }>;
  open_cards: OpenCard[];
};
type BriefingView = {
  last_session_summary: { session_seq: number | null; summary_state: string; summary: string | null };
  open_tasks: { items: Array<{ text: string }> } | null;
  today_questions: Array<{ text: string }> | null;
};
const detailOf = async (caseId: number, actor: number) =>
  (await (await request(`/cases/${caseId}/detail`, actor)).json()) as Detail;

describe.skipIf(!enabled)('approved AI drafts become visible records', () => {
  it('shows the approved summary in session detail and briefing and turns tasks and questions into open cards', async () => {
    const { actor, caseId, sessionId } = await fixture();
    await draftRow(sessionId, actor, ['이미 적은 과제', '통장 사본 떼어 오기']);

    const before = await detailOf(caseId, actor);
    expect(before.sessions.find((s) => s.id === sessionId)?.ai_summary).toBeNull();

    const approved = await request(`/sessions/${sessionId}/draft/approve`, actor, 'POST', {
      summary: '월세 연체가 두 달로 늘었고 내역서는 아직 못 뗌.',
    });
    expect(approved.status).toBe(200);

    const detail = await detailOf(caseId, actor);
    expect(detail.sessions.find((s) => s.id === sessionId)?.ai_summary).toEqual({
      summary: '월세 연체가 두 달로 늘었고 내역서는 아직 못 뗌.',
      changes: ['연체 1개월 → 2개월'],
      fact_changes: [FACT],
    });
    const openTexts = detail.open_cards.map((c) => [c.kind, c.text, c.source_type]);
    expect(openTexts).toContainEqual(['promise', '통장 사본 떼어 오기', 'ai_approved']);
    expect(openTexts).toContainEqual(['question', '내역서를 못 뗀 이유', 'ai_approved']);
    // A task the practitioner already wrote is not duplicated by approval.
    expect(openTexts.filter((c) => c[1] === '이미 적은 과제')).toHaveLength(1);

    const briefing = (await (await request(`/cases/${caseId}/briefing`, actor)).json()) as BriefingView;
    expect(briefing.last_session_summary.session_seq).toBe(1);
    expect(briefing.last_session_summary.summary_state).toBe('approved');
    expect(briefing.last_session_summary.summary).toBe('월세 연체가 두 달로 늘었고 내역서는 아직 못 뗌.');
    expect(briefing.open_tasks?.items.map((t) => t.text)).toContain('통장 사본 떼어 오기');
    expect(briefing.today_questions?.map((q) => q.text)).toContain('내역서를 못 뗀 이유');

    // Re-approving an edited draft replaces the unresolved AI cards instead of stacking them.
    await draftRow(sessionId, actor, ['통장 사본 떼어 오기']);
    expect((await request(`/sessions/${sessionId}/draft/approve`, actor, 'POST', {
      tasks: ['주민센터 동행 일정 잡기'], questions: [],
    })).status).toBe(200);
    const again = await detailOf(caseId, actor);
    const aiCards = again.open_cards.filter((c) => c.source_type === 'ai_approved').map((c) => c.text);
    expect(aiCards).toEqual(['주민센터 동행 일정 잡기']);
    expect(again.open_cards.some((c) => c.text === '이미 적은 과제')).toBe(true);
  });
});
