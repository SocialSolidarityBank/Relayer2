// Isolated local DB only: scripts/check-case-access.mjs creates and migrates a disposable database.
// LLM 은 AI_PROVIDER=stub — AI_STUB_FILE 의 고정 응답으로 모델 자리만 단락하고
// 동의·마스킹·검증·저장은 그대로 돈다.
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

const MEMO = '월세 두 달 밀림. 김합성 내역서는 못 뗐다고 함. 다음 주까지 내역서를 떼기로 함.';
const CARD_TEXT = '내역서를 떼어 오기';

async function fixture() {
  const prefix = randomUUID();
  const [{ id: actor }] = await sql<Array<{ id: number }>>`
    insert into users (email, name, role) values (${`${prefix}@test.invalid`}, 'v6 검증', 'worker')
    returning id`;
  const created = await request('/cases', actor, 'POST', {
    name: '김합성',
    program_id: await ensureProgram('v6 검증'),
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
    memo: MEMO,
    method: 'phone',
    overall_goal: '월세 연체 해결',
    cards: [{ kind: 'promise', text: CARD_TEXT, section: 'promise' }],
  });
  expect(recorded.status).toBe(200);
  const [card] = await sql<Array<{ id: number }>>`
    select id from cards where source_session_id = ${sessionId} and source_type = 'manual'`;
  return { actor, caseId, sessionId, cardId: card.id };
}

// stub 응답. 카드 span ID 는 fixture 의 카드 번호에 맞춰 만든다 — 수기 span 은 전부 단락에 배치해야 한다.
const stubAnalysis = (cardId: number) => ({
  default: {
    record: {
      topics: [{ id: '01', title: '월세 연체', paragraph_ids: ['1-1', '1-2'] }],
      paragraphs: [
        { id: '1-1', title: '월세 연체와 내역서', spans: ['w:memo:0', 'w:memo:1', 'w:memo:2'] },
        { id: '1-2', title: '내역서 과제', spans: [`w:card:${cardId}:0`] },
      ],
      annotations: [],
    },
    summary: {
      core: [{ text: '월세 두 달 밀림', spans: ['w:memo:0'], goal: 'overall' }],
      changes: { promise_result: [], newly_revealed: [], new_possibility: [] },
      follow_up: [{ text: '다음 주까지 내역서를 떼기로 함', spans: ['w:memo:2'], goal: null }],
      completed: [],
    },
    links: [],
    discrepancies: [],
    keywords: [{ text: '월세', spans: ['w:memo:0'] }],
    tasks: ['통장 사본 떼어 오기'],
    questions: ['내역서를 못 뗀 이유'],
  },
});

const stubDir = mkdtempSync(join(tmpdir(), 'relayer-v6-stub-'));
const useStub = (body: unknown) => {
  const file = join(stubDir, `${randomUUID()}.json`);
  writeFileSync(file, JSON.stringify(body));
  process.env.AI_PROVIDER = 'stub';
  process.env.AI_STUB_FILE = file;
};

type Revision = {
  id: number;
  status: 'draft' | 'approved' | 'failed';
  source_versions: { memo_hash: string | null; cards: Array<{ id: number; hash: string }>; intake_hash: string | null; transcript_id: number | null };
  error: string | null;
  body: {
    documents: Array<{ id: string }>;
    spans: Array<{ id: string }>;
    record: { paragraphs: Array<{ id: string }> };
    keywords: Array<{ text: string; source: string; spans: string[] }>;
    summary_override: { text: string } | null;
  } | null;
};

type Detail = {
  sessions: Array<{
    id: number;
    ai_summary: { kind: string; summary?: unknown; override?: { text: string } | null } | null;
    stale: { ai_summary: boolean };
  }>;
  open_cards: Array<{ kind: string; text: string; source_type: string }>;
};
const detailOf = async (caseId: number, actor: number) =>
  (await (await request(`/cases/${caseId}/detail`, actor)).json()) as Detail;

describe.skipIf(!enabled)('v6 record analysis draft/approve', () => {
  it('drafts from written spans only, masks the name, approves into cards and v6 summary', async () => {
    const { actor, caseId, sessionId, cardId } = await fixture();
    useStub(stubAnalysis(cardId));

    const drafted = await request(`/sessions/${sessionId}/draft`, actor, 'POST');
    expect(drafted.status).toBe(200);
    const draft = (await drafted.json()) as Revision;
    expect(draft.status).toBe('draft');
    const spanIds = draft.body!.spans.map((s) => s.id);
    expect(spanIds).toEqual(['w:memo:0', 'w:memo:1', 'w:memo:2', `w:card:${cardId}:0`]);
    // 결정적 키워드 — 수기 과제 카드와 전체 목표가 서버 계산으로 들어간다.
    const keywordTexts = draft.body!.keywords.map((k) => [k.text, k.source]);
    expect(keywordTexts).toContainEqual([CARD_TEXT, 'deterministic']);
    expect(keywordTexts).toContainEqual(['월세 연체 해결', 'deterministic']);
    expect(keywordTexts).toContainEqual(['월세', 'llm']);

    // 이름은 가명 자리표로 가려 나갔다 — 감사에 건수만 남는다.
    const [sent] = await sql<Array<{ fields: string[] }>>`
      select fields from audit_log where action = 'ai.draft' and case_id = ${caseId} order by id desc limit 1`;
    expect(sent.fields).toContain('masked:name=1');

    // 화면이 본 것과 다른 초안·다른 원본은 409 다.
    expect(
      (await request(`/sessions/${sessionId}/draft/approve`, actor, 'POST', {
        draft_id: draft.id + 1, source_versions: draft.source_versions,
      })).status,
    ).toBe(409);
    const revised = await request(`/sessions/${sessionId}/revisions`, actor, 'POST', {
      kind: 'memo', text: '월세 세 달 밀림. 내역서는 못 뗐다고 함.',
    });
    expect(revised.status).toBe(201);
    expect(
      (await request(`/sessions/${sessionId}/draft/approve`, actor, 'POST', {
        draft_id: draft.id, source_versions: draft.source_versions,
      })).status,
    ).toBe(409);

    // 원본이 바뀌었으니 새 초안을 만들어 승인한다 — stub 도 고친 메모(문장 2개)에 맞춘다.
    const revisedStub = stubAnalysis(cardId);
    revisedStub.default.record.paragraphs[0].spans = ['w:memo:0', 'w:memo:1'];
    revisedStub.default.summary.follow_up = [{ text: '내역서는 못 뗐다고 함', spans: ['w:memo:1'], goal: null }];
    useStub(revisedStub);
    const redraft = (await (await request(`/sessions/${sessionId}/draft`, actor, 'POST')).json()) as Revision;
    expect(redraft.status).toBe('draft');
    const approved = await request(`/sessions/${sessionId}/draft/approve`, actor, 'POST', {
      draft_id: redraft.id, source_versions: redraft.source_versions,
    });
    expect(approved.status).toBe(200);
    expect(((await approved.json()) as Revision).status).toBe('approved');

    const detail = await detailOf(caseId, actor);
    const row = detail.sessions.find((s) => s.id === sessionId)!;
    expect(row.ai_summary?.kind).toBe('v6');
    const openTexts = detail.open_cards.map((c) => [c.kind, c.text, c.source_type]);
    expect(openTexts).toContainEqual(['promise', '통장 사본 떼어 오기', 'ai_approved']);
    expect(openTexts).toContainEqual(['question', '내역서를 못 뗀 이유', 'ai_approved']);
    expect(openTexts).toContainEqual(['promise', CARD_TEXT, 'manual']);

    // 원본을 고치면 stale — 자동 재처리는 없다.
    await request(`/sessions/${sessionId}/revisions`, actor, 'POST', { kind: 'memo', text: MEMO });
    expect((await detailOf(caseId, actor)).sessions.find((s) => s.id === sessionId)!.stale.ai_summary).toBe(true);

    // 요약 리비전은 summary_override 를 담은 새 승인 행 — 구조는 그대로다.
    const overridden = await request(`/sessions/${sessionId}/revisions`, actor, 'POST', {
      kind: 'summary', text: '사람이 고친 요약',
    });
    expect(overridden.status).toBe(201);
    const view = (await (await request(`/sessions/${sessionId}/analysis`, actor)).json()) as {
      analysis: Revision | null;
      documents: Array<{ id: string }>;
      stale: boolean;
    };
    expect(view.analysis?.body?.summary_override?.text).toBe('사람이 고친 요약');
    expect(view.analysis?.body?.record.paragraphs).toHaveLength(2);
    expect(view.documents.map((d) => d.id)).toEqual(['memo', `card:${cardId}`]);
    expect(view.stale).toBe(true);

    // 키워드 백링크 — 카드 키워드의 span 이 원문 텍스트와 함께 돌아온다.
    const links = (await (
      await request(`/cases/${caseId}/backlinks?keyword=${encodeURIComponent(CARD_TEXT)}`, actor)
    ).json()) as Array<{ session_id: number; span_id: string; paragraph_id: string | null; text: string }>;
    expect(links).toEqual([
      { session_id: sessionId, seq: 1, span_id: `w:card:${cardId}:0`, paragraph_id: '1-2', text: CARD_TEXT },
    ]);
  });

  it('keeps a failed row and still serves documents when the model cites outside the session', async () => {
    const { actor, sessionId, cardId } = await fixture();
    const bad = stubAnalysis(cardId);
    bad.default.record.paragraphs[0].spans.push('w:memo:99');
    useStub(bad);

    const drafted = await request(`/sessions/${sessionId}/draft`, actor, 'POST');
    expect(drafted.status).toBe(200);
    const failed = (await drafted.json()) as Revision;
    expect(failed.status).toBe('failed');
    expect(failed.error).toBeTruthy();
    expect(failed.body).toBeNull();

    const view = (await (await request(`/sessions/${sessionId}/analysis`, actor)).json()) as {
      analysis: Revision | null;
      documents: Array<{ id: string }>;
    };
    expect(view.analysis).toBeNull();
    expect(view.documents.map((d) => d.id)).toEqual(['memo', `card:${cardId}`]);
  });

  it('reads a legacy ai_drafts approval as legacy summary', async () => {
    const { actor, caseId, sessionId } = await fixture();
    await sql`
      insert into ai_drafts (session_id, status, summary, changes, tasks, questions, fact_changes, mask_hits, model, created_by, approved_by)
      values (${sessionId}, 'approved', '구버전 요약', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, 'test-model', ${actor}, ${actor})`;
    const detail = await detailOf(caseId, actor);
    expect(detail.sessions.find((s) => s.id === sessionId)!.ai_summary).toEqual({
      kind: 'legacy', summary: '구버전 요약',
    });
  });

  it('denies analysis and backlinks to a worker without assignment', async () => {
    const { caseId, sessionId } = await fixture();
    const [{ id: other }] = await sql<Array<{ id: number }>>`
      insert into users (email, name, role) values (${randomUUID() + '@test.invalid'}, '배정 없음', 'worker')
      returning id`;
    expect((await request(`/sessions/${sessionId}/analysis`, other)).status).toBe(403);
    expect((await request(`/cases/${caseId}/backlinks?keyword=x`, other)).status).toBe(403);
  });
});
