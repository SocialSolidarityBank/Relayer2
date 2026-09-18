// Isolated local DB only: scripts/check-case-access.mjs creates and migrates a disposable database.
// LLM 은 AI_PROVIDER=stub — 승인 계약(draft_id·source_versions)과 카드 반영을 검증한다.
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
      { domain: 'external_llm_cross_border_processing', decision: 'grant' },
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
  const [card] = await sql<Array<{ id: number }>>`
    select id from cards where source_session_id = ${sessionId} and source_type = 'manual'`;
  return { actor, caseId, sessionId, cardId: card.id };
}

const stubDir = mkdtempSync(join(tmpdir(), 'relayer-ai-stub-'));

// 수기 span 은 전부 단락에 배치해야 한다 — 카드 span ID 는 fixture 의 카드 번호에 맞춘다.
const useStub = (cardId: number, tasks: string[], questions: string[]) => {
  const file = join(stubDir, `${randomUUID()}.json`);
  writeFileSync(file, JSON.stringify({
    default: {
      record: {
        topics: [{ id: '01', title: '월세 연체', paragraph_ids: ['1-1', '1-2'] }],
        paragraphs: [
          { id: '1-1', title: '월세 연체', spans: ['w:memo:0', 'w:memo:1'] },
          { id: '1-2', title: '과제', spans: [`w:card:${cardId}:0`] },
        ],
        annotations: [],
      },
      summary: {
        core: [{ text: '월세 연체가 두 달로 늘었고 내역서는 아직 못 뗌.', spans: ['w:memo:0'], goal: null }],
        changes: { promise_result: [], newly_revealed: [], new_possibility: [] },
        follow_up: [],
        completed: [],
      },
      links: [],
      discrepancies: [],
      keywords: [],
      tasks,
      questions,
    },
  }));
  process.env.AI_PROVIDER = 'stub';
  process.env.AI_STUB_FILE = file;
};

type Revision = {
  id: number;
  status: string;
  source_versions: unknown;
};
type OpenCard = { kind: string; text: string; source_type: string };
type Detail = {
  sessions: Array<{ id: number; ai_summary: { kind: string; summary?: { core: Array<{ text: string }> } } | null }>;
  open_cards: OpenCard[];
};
const detailOf = async (caseId: number, actor: number) =>
  (await (await request(`/cases/${caseId}/detail`, actor)).json()) as Detail;

const draft = async (sessionId: number, actor: number): Promise<Revision> => {
  const res = await request(`/sessions/${sessionId}/draft`, actor, 'POST');
  expect(res.status).toBe(200);
  return (await res.json()) as Revision;
};

describe.skipIf(!enabled)('approved AI analyses become visible records', () => {
  it('shows the approved v6 summary in session detail and turns tasks and questions into open cards', async () => {
    const { actor, caseId, sessionId, cardId } = await fixture();
    useStub(cardId, ['이미 적은 과제', '통장 사본 떼어 오기'], ['내역서를 못 뗀 이유']);

    const before = await detailOf(caseId, actor);
    expect(before.sessions.find((s) => s.id === sessionId)?.ai_summary).toBeNull();

    const first = await draft(sessionId, actor);
    const approved = await request(`/sessions/${sessionId}/draft/approve`, actor, 'POST', {
      draft_id: first.id, source_versions: first.source_versions,
    });
    expect(approved.status).toBe(200);

    const detail = await detailOf(caseId, actor);
    const summary = detail.sessions.find((s) => s.id === sessionId)?.ai_summary;
    expect(summary?.kind).toBe('v6');
    expect(summary?.summary?.core[0]?.text).toBe('월세 연체가 두 달로 늘었고 내역서는 아직 못 뗌.');
    const openTexts = detail.open_cards.map((c) => [c.kind, c.text, c.source_type]);
    expect(openTexts).toContainEqual(['promise', '통장 사본 떼어 오기', 'ai_approved']);
    expect(openTexts).toContainEqual(['question', '내역서를 못 뗀 이유', 'ai_approved']);
    // A task the practitioner already wrote is not duplicated by approval.
    expect(openTexts.filter((c) => c[1] === '이미 적은 과제')).toHaveLength(1);

    // Re-approving an edited draft replaces the unresolved AI cards instead of stacking them.
    const second = await draft(sessionId, actor);
    expect((await request(`/sessions/${sessionId}/draft/approve`, actor, 'POST', {
      draft_id: second.id,
      source_versions: second.source_versions,
      edits: { tasks: ['주민센터 동행 일정 잡기'], questions: [] },
    })).status).toBe(200);
    const again = await detailOf(caseId, actor);
    const aiCards = again.open_cards.filter((c) => c.source_type === 'ai_approved').map((c) => c.text);
    expect(aiCards).toEqual(['주민센터 동행 일정 잡기']);
    expect(again.open_cards.some((c) => c.text === '이미 적은 과제')).toBe(true);
  });
});
