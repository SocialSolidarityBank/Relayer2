// AI 텍스트 경로(P3). 순서가 곧 규칙이다.
//
//   동의 확인 → 가림 처리 → 외부 호출 → **초안 저장** → 사람이 승인해야 기록
//
// 승인 전에는 어떤 것도 회차 기록이 되지 않는다. 승인은 사람만 한다(GLOSSARY §6-5).
import { assertConsent } from './service.ts';
import { audit } from './audit.ts';
import { sql } from './db.ts';
import { maskAll } from './domain/masking.ts';
import { decryptPii, decryptText } from './pii.ts';
import type { Card, Session } from './domain/types.ts';

/**
 * 제공자는 기관이 고른다. 바꾸면 동의 문안 해시가 달라져 기존 동의가 `확인 필요`로 떨어진다 —
 * 그게 맞는 동작이다. 누구에게 보내는지가 곧 동의의 내용이다.
 */
const PROVIDER = (process.env.AI_PROVIDER ?? 'openai') as 'openai' | 'gemini';
// gemini-2.5-flash 는 신규 사용자에게 닫혔다(2026-09-15 실측 404). 별칭을 쓴다.
const MODEL = process.env.AI_MODEL ?? (PROVIDER === 'gemini' ? 'gemini-flash-latest' : 'gpt-5-mini');

export type Draft = {
  id: number;
  session_id: number;
  status: 'draft' | 'approved';
  summary: string;
  tasks: string[];
  questions: string[];
  mask_hits: Record<string, number>;
  model: string | null;
  created_by: number | null;
  created_at: string;
};

export class AiUnavailable extends Error {}

const SYSTEM = [
  '너는 한국 사회복지 상담 기록을 정리하는 도구다.',
  '규칙:',
  '- 자료에 없는 사실을 지어내지 않는다. 모르면 비운다.',
  '- 대괄호로 가려진 자리표([otter-001], [연락처])는 그대로 둔다. 추측해 채우지 않는다.',
  '- 진단·평가·판정을 하지 않는다. 적힌 말을 정리만 한다.',
  '- 존댓말 대신 기록체(…함, …라고 말함)를 쓴다.',
].join('\n');

type Shape = { summary: string; tasks: string[]; questions: string[] };

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'tasks', 'questions'],
  properties: {
    summary: { type: 'string', description: '두세 문장. 오늘 상담에서 확인된 것만.' },
    tasks: { type: 'array', items: { type: 'string' }, description: '다음까지 하기로 한 일' },
    questions: { type: 'array', items: { type: 'string' }, description: '다음에 확인할 것' },
  },
} as const;

async function callGemini(prompt: string): Promise<Shape> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AiUnavailable('GEMINI_API_KEY 가 없어 AI 정리를 할 수 없어요.');
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        // Gemini 의 스키마는 OpenAPI 계열이라 `additionalProperties` 를 모른다. 그것만 뺀다.
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: { ...SCHEMA, additionalProperties: undefined },
        },
      }),
    },
  );
  if (!res.ok) throw new AiUnavailable(`AI 응답이 오지 않았어요 (${res.status}).`);
  const payload = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new AiUnavailable('AI 응답을 읽지 못했어요.');
  return JSON.parse(text) as Shape;
}

async function callOpenAi(prompt: string): Promise<Shape> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new AiUnavailable('OPENAI_API_KEY 가 없어 AI 정리를 할 수 없어요.');

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      input: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: prompt },
      ],
      text: { format: { type: 'json_schema', name: 'session_draft', strict: true, schema: SCHEMA } },
    }),
  });

  if (!res.ok) throw new AiUnavailable(`AI 응답이 오지 않았어요 (${res.status}).`);
  const payload = (await res.json()) as {
    output?: Array<{ content?: Array<{ text?: string }> }>;
    output_text?: string;
  };
  const text = payload.output_text ?? payload.output?.[0]?.content?.[0]?.text;
  if (!text) throw new AiUnavailable('AI 응답을 읽지 못했어요.');
  return JSON.parse(text) as Shape;
}

const callModel = (prompt: string): Promise<Shape> =>
  PROVIDER === 'gemini' ? callGemini(prompt) : callOpenAi(prompt);

/**
 * 한 회차의 초안을 만든다. 저장된 자료만 쓰고, 보내기 전에 가린다.
 * 동의(외부 LLM·국외 처리)가 없으면 호출 자체를 하지 않는다.
 */
export async function draftSession(sessionId: number, actorId: number): Promise<Draft> {
  const [session] = await sql<Session[]>`select * from sessions where id = ${sessionId}`;
  if (!session) throw new Error('회차를 찾지 못했어요.');
  await assertConsent(session.case_id, 'external_llm_cross_border_processing');

  const [participant] = await sql<Array<{ pseudonym: string; enc_name: string | null; enc_phone: string | null; enc_email: string | null }>>`
    select p.pseudonym, v.enc_name, v.enc_phone, v.enc_email
    from support_cases c
    join participants p on p.id = c.participant_id
    left join participant_pii v on v.participant_id = p.id
    where c.id = ${session.case_id}`;

  const cards = await sql<Card[]>`
    select * from cards where source_session_id = ${sessionId} order by id`;

  const parts = [
    { label: '상담 내용', text: decryptText(session.memo) ?? '' },
    ...cards.map((c) => ({ label: SECTION_LABEL[c.source_section] ?? c.source_section, text: decryptText(c.text) ?? '' })),
  ].filter((p) => p.text.trim());

  if (parts.length === 0) throw new AiUnavailable('정리할 내용이 없어요. 상담 내용을 먼저 적어 주세요.');

  const { parts: masked, hits } = maskAll(parts, {
    pseudonym: participant.pseudonym,
    name: decryptPii(participant.enc_name),
    phone: decryptPii(participant.enc_phone),
    email: decryptPii(participant.enc_email),
  });

  const prompt = [
    `${session.seq}회차 상담 자료다. 아래 내용만 보고 정리한다.`,
    '',
    ...masked.map((p) => `[${p.label}]\n${p.text}`),
  ].join('\n');

  const shape = await callModel(prompt);

  const [row] = await sql<Array<{ id: number; created_at: string }>>`
    insert into ai_drafts (session_id, status, summary, tasks, questions, mask_hits, model, created_by)
    values (${sessionId}, 'draft', ${shape.summary}, ${sql.json(shape.tasks)},
            ${sql.json(shape.questions)}, ${sql.json(hits)}, ${MODEL}, ${actorId})
    returning id, created_at`;

  // 무엇을 몇 건 가려 보냈는지 남긴다. 보낸 원문은 남기지 않는다.
  await audit({
    actorId,
    action: 'ai.draft',
    caseId: session.case_id,
    fields: Object.entries(hits).map(([kind, n]) => `masked:${kind}=${n}`),
  });

  return {
    id: row.id,
    session_id: sessionId,
    status: 'draft',
    summary: shape.summary,
    tasks: shape.tasks,
    questions: shape.questions,
    mask_hits: hits,
    model: MODEL,
    created_by: actorId,
    created_at: row.created_at,
  };
}

const SECTION_LABEL: Record<string, string> = {
  memo: '상담 내용',
  promise: '수행할 과제',
  question: '다음에 물어볼 것',
  change: '달라진 것',
  judgment: '실무자 의견',
  intake: '인테이크',
};

/** 회차의 현재 초안. 마지막 행이 현재 상태다. */
export async function latestDraft(sessionId: number): Promise<Draft | null> {
  const [row] = await sql<Draft[]>`
    select id, session_id, status, summary, tasks, questions, mask_hits, model, created_by, created_at
    from ai_drafts where session_id = ${sessionId} order by id desc limit 1`;
  return row ?? null;
}

/**
 * 승인. 사람이 고친 문구가 있으면 그것으로 승인한다(수정본도 승인 전에는 초안이다).
 * 지우지 않고 새 행을 쌓는다 — 무엇을 보고 승인했는지가 남아야 한다.
 */
export async function approveDraft(
  sessionId: number,
  actorId: number,
  edited?: { summary?: string; tasks?: string[]; questions?: string[] },
): Promise<Draft> {
  const current = await latestDraft(sessionId);
  if (!current) throw new Error('승인할 초안이 없어요.');

  const summary = edited?.summary ?? current.summary;
  const tasks = edited?.tasks ?? current.tasks;
  const questions = edited?.questions ?? current.questions;

  const [row] = await sql<Array<{ id: number; created_at: string }>>`
    insert into ai_drafts (session_id, status, summary, tasks, questions, mask_hits, model, created_by, approved_by)
    values (${sessionId}, 'approved', ${summary}, ${sql.json(tasks)}, ${sql.json(questions)},
            ${sql.json(current.mask_hits)}, ${current.model}, ${current.created_by ?? actorId}, ${actorId})
    returning id, created_at`;

  await audit({ actorId, action: 'ai.approve', fields: [`draft=${current.id}`] });

  return { ...current, id: row.id, status: 'approved', summary, tasks, questions, created_at: row.created_at };
}
