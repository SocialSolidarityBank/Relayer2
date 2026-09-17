// Isolated local DB only: scripts/check-case-access.mjs creates and migrates a disposable database.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { issueCookie } from '../src/auth.ts';
import { DATABASE_URL, sql } from '../src/db.ts';
import { decryptJson, decryptText, encryptJson, encryptText } from '../src/pii.ts';
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

async function fixture(): Promise<{ actor: number; caseId: number }> {
  const prefix = randomUUID();
  const [{ id: actor }] = await sql<Array<{ id: number }>>`
    insert into users (email, name, role) values (${`${prefix}@test.invalid`}, '인테이크 검증', 'worker')
    returning id`;
  const response = await request('/cases', actor, 'POST', {
    name: '인테이크 보존 합성',
    program_id: await ensureProgram('회귀 검증'),
    consents: [
      { domain: 'personal_data_collection_use', decision: 'grant' },
      { domain: 'sensitive_information_processing', decision: 'grant' },
    ],
  });
  expect(response.status).toBe(201);
  const { case_id: caseId } = (await response.json()) as { case_id: number };
  return { actor, caseId };
}

describe.skipIf(!enabled)('intake feedback persistence', () => {
  it('round-trips actual metadata and preserves retired detail and hidden cards on partial edits', async () => {
    const { actor, caseId } = await fixture();
    const originalHeldAt = '2026-09-16T01:30:00.000Z';
    const created = await request(`/cases/${caseId}/intake`, actor, 'PUT', {
      held_at: originalHeldAt,
      method: 'in_person',
      place: '상담실 2',
      memo: '처음 인테이크 메모',
      overall_goal: '기존 전체 목표',
      detail: { preferred_counsel_method: '전화', retired_answer: '없어진 질문의 답' },
      cards: [
        { kind: 'fact', text: '숨은 사실', section: 'intake' },
        { kind: 'judgment', text: '숨은 판단', section: 'judgment' },
        { kind: 'promise', text: '잠글 과제', section: 'promise' },
        { kind: 'question', text: '지울 질문', section: 'intake' },
      ],
    });
    expect(created.status).toBe(200);
    const { session_id: intakeId } = (await created.json()) as { session_id: number };

    const initial = (await (await request(`/cases/${caseId}/intake`, actor)).json()) as {
      held_at: string | null;
      method: string | null;
      place: string | null;
      memo: string | null;
      detail: Record<string, unknown>;
    };
    expect(initial).toMatchObject({
      held_at: originalHeldAt,
      method: 'in_person',
      place: '상담실 2',
      memo: '처음 인테이크 메모',
    });
    expect(initial.detail).toMatchObject({
      preferred_counsel_method: '전화',
      retired_answer: '없어진 질문의 답',
    });

    const rawCards = await sql<Array<{ id: number; kind: string; text: string }>>`
      select id, kind, text from cards where source_session_id = ${intakeId} order by id`;
    const factId = rawCards.find((card) => card.kind === 'fact')!.id;
    const judgmentId = rawCards.find((card) => card.kind === 'judgment')!.id;
    const promise = rawCards.find((card) => decryptText(card.text) === '잠글 과제')!;
    await sql`insert into card_outcomes (card_id, session_id, result)
      values (${promise.id}, ${intakeId}, 'confirmed')`;

    // Older/partial clients omit fields. Only supplied detail is merged; everything else survives.
    expect((await request(`/cases/${caseId}/intake`, actor, 'PUT', {
      detail: { newly_added: '새 답' },
    })).status).toBe(200);
    let reopened = (await (await request(`/cases/${caseId}/intake`, actor)).json()) as {
      held_at: string | null;
      method: string | null;
      place: string | null;
      memo: string | null;
      detail: Record<string, unknown>;
    };
    expect(reopened).toMatchObject({
      held_at: originalHeldAt,
      method: 'in_person',
      place: '상담실 2',
      memo: '처음 인테이크 메모',
    });
    expect(reopened.detail).toMatchObject({
      preferred_counsel_method: '전화',
      retired_answer: '없어진 질문의 답',
      newly_added: '새 답',
    });

    for (const method of ['visit', 'video', 'other'] as const) {
      expect((await request(`/cases/${caseId}/intake`, actor, 'PUT', { method })).status).toBe(200);
      reopened = (await (await request(`/cases/${caseId}/intake`, actor)).json()) as typeof reopened;
      expect(reopened.method).toBe(method);
      expect(reopened.place).toBeNull();
    }
    // Non-in-person always clears place, even if an old client sends one.
    expect((await request(`/cases/${caseId}/intake`, actor, 'PUT', {
      method: 'phone',
      place: '남아서는 안 되는 장소',
      cards: [],
    })).status).toBe(200);

    // Empty cards clears only visible editable kinds. Hidden fact/judgment and locked promise keep IDs.
    let remaining = await sql<Array<{ id: number; kind: string; text: string }>>`
      select id, kind, text from cards where source_session_id = ${intakeId} order by id`;
    expect(remaining.some((card) => card.id === factId && card.kind === 'fact')).toBe(true);
    expect(remaining.some((card) => card.id === judgmentId && card.kind === 'judgment')).toBe(true);
    expect(remaining.some((card) => card.id === promise.id)).toBe(true);
    expect(remaining.some((card) => decryptText(card.text) === '지울 질문')).toBe(false);

    // Locked ciphertext must be compared after decryption, otherwise this duplicates the same card.
    expect((await request(`/cases/${caseId}/intake`, actor, 'PUT', {
      cards: [{ kind: 'promise', text: '잠글 과제', section: 'promise' }],
    })).status).toBe(200);
    remaining = await sql<Array<{ id: number; kind: string; text: string }>>`
      select id, kind, text from cards where source_session_id = ${intakeId} order by id`;
    expect(remaining.filter((card) => card.kind === 'promise' && decryptText(card.text) === '잠글 과제'))
      .toHaveLength(1);

    reopened = (await (await request(`/cases/${caseId}/intake`, actor)).json()) as typeof reopened;
    expect(reopened).toMatchObject({ method: 'phone', place: null, memo: '처음 인테이크 메모' });
    expect(reopened.detail).toMatchObject({ retired_answer: '없어진 질문의 답', newly_added: '새 답' });

    // The generic record endpoint can also edit an intake; omitted detail and hidden intake cards survive.
    expect((await request(`/sessions/${intakeId}`, actor, 'PATCH', {
      memo: '기록 경로에서 고친 메모',
      cards: [],
    })).status).toBe(200);
    reopened = (await (await request(`/cases/${caseId}/intake`, actor)).json()) as typeof reopened;
    expect(reopened.detail).toMatchObject({ retired_answer: '없어진 질문의 답', newly_added: '새 답' });
    remaining = await sql<Array<{ id: number; kind: string; text: string }>>`
      select id, kind, text from cards where source_session_id = ${intakeId} order by id`;
    expect(remaining.some((card) => card.id === factId)).toBe(true);
    expect(remaining.some((card) => card.id === judgmentId)).toBe(true);

    expect((await request(`/cases/${caseId}/intake`, actor, 'PUT', {
      held_at: 'not-a-date',
    })).status).toBe(400);
    expect((await request(`/cases/${caseId}/intake`, actor, 'PUT', {
      method: 'carrier-pigeon',
    })).status).toBe(400);
  });

  it('keeps encrypted detail, overall goal and old fact IDs when a record is edited', async () => {
    const { actor, caseId } = await fixture();
    expect((await request(`/cases/${caseId}/intake`, actor, 'PUT', {
      overall_goal: '지워지면 안 되는 전체 목표',
    })).status).toBe(200);

    const planned = await request(`/cases/${caseId}/sessions`, actor, 'POST', {
      scheduled_at: '2026-09-17T02:00:00.000Z',
      method: 'other',
    });
    expect(planned.status).toBe(201);
    const { session_id: sessionId } = (await planned.json()) as { session_id: number };
    await sql`update sessions set detail = ${sql.json(encryptJson({ retired_record_answer: '보존' }))}
      where id = ${sessionId}`;
    const [{ id: factId }] = await sql<Array<{ id: number }>>`
      insert into cards (case_id, kind, text, source_session_id, source_section)
      values (${caseId}, 'fact', ${encryptText('예전 달라진 것')}, ${sessionId}, 'change') returning id`;

    const heldAt = '2026-09-17T02:10:00.000Z';
    expect((await request(`/sessions/${sessionId}`, actor, 'PATCH', {
      held_at: heldAt,
      memo: '첫 기록',
      method: 'other',
      cards: [
        { kind: 'promise', text: '새 과제', section: 'promise' },
        { kind: 'judgment', text: '기존 의견', section: 'judgment' },
      ],
    })).status).toBe(200);

    // UI no longer sends facts or overall_goal. Empty visible cards removes only those it owns.
    expect((await request(`/sessions/${sessionId}`, actor, 'PATCH', {
      memo: '고친 기록',
      cards: [],
    })).status).toBe(200);

    const [stored] = await sql<Array<{
      held_at: string;
      method: string;
      place: string | null;
      detail: Record<string, unknown>;
    }>>`select held_at, method, place, detail from sessions where id = ${sessionId}`;
    expect(new Date(stored.held_at).toISOString()).toBe(heldAt);
    expect(stored.method).toBe('other');
    expect(stored.place).toBeNull();
    expect(decryptJson(stored.detail)).toEqual({ retired_record_answer: '보존' });

    const record = (await (await request(`/sessions/${sessionId}`, actor)).json()) as {
      overall_goal: string;
      cards: Array<{ kind: string; text: string }>;
    };
    expect(record.overall_goal).toBe('지워지면 안 되는 전체 목표');
    expect(record.cards).toEqual([{ kind: 'fact', text: '예전 달라진 것', area: null, owner: 'participant', locked: false }]);
    const [{ id: survivingFactId }] = await sql<Array<{ id: number }>>`
      select id from cards where source_session_id = ${sessionId} and kind = 'fact'`;
    expect(survivingFactId).toBe(factId);
  });
});
