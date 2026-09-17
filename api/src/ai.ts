// AI 텍스트 경로(P3). 순서가 곧 규칙이다.
//
//   동의 확인 → 마스킹 → 외부 호출 → **초안 저장** → 사람이 승인해야 기록
//
// 승인 전에는 어떤 것도 회차 기록이 되지 않는다. 승인은 사람만 한다(GLOSSARY §6-5).
import { assertConsent, replaceAiCards } from './service.ts';
import { AI_PROVIDERS, type AiProviderId } from './consent.ts';
import { audit } from './audit.ts';
import { sql } from './db.ts';
import { maskAll } from './domain/masking.ts';

import { decryptPii, decryptText } from './pii.ts';
import type { Card, FactChange, Session } from './domain/types.ts';

/**
 * 제공자는 기관이 고른다. 바꾸면 동의 문안 해시가 달라져 기존 동의가 `확인 필요`로 떨어진다 —
 * 그게 맞는 동작이다. 누구에게 보내는지가 곧 동의의 내용이다.
 */
const PROVIDER = (process.env.AI_PROVIDER ?? 'openai') as AiProviderId;
// gemini-2.5-flash 는 신규 사용자에게 닫혔다(2026-09-15 실측 404). 별칭을 쓴다.
// openai 는 gpt-5.5 — 9개 모델을 재 보고 골랐다(SPEC.md §15-4).
const MODEL = process.env.AI_MODEL ?? (PROVIDER === 'gemini' ? 'gemini-flash-latest' : 'gpt-5.5');

export type Draft = {
  id: number;
  session_id: number;
  status: 'draft' | 'approved';
  summary: string;
  changes: string[];
  tasks: string[];
  questions: string[];
  fact_changes: FactChange[];
  mask_hits: Record<string, number>;
  model: string | null;
  created_by: number | null;
  created_at: string;
};

export class AiUnavailable extends Error {}

const SYSTEM = [
  '너는 한국 사회복지 상담 기록을 정리하는 도구다.',
  '',
  '무엇을 하는가: 실무자가 다음 상담 전에 15초만 보고 이어서 일할 수 있게 만든다.',
  '길면 원문을 다시 읽는 것과 같고, 중요한 것이 빠지면 사람을 오해하게 만든다.',
  '',
  '반드시 지킨다:',
  '- 자료에 없는 사실을 지어내지 않는다. 모르면 비운다.',
  '- 대괄호로 마스킹한 자리표([otter-001], [연락처])는 그대로 둔다. 추측해 채우지 않는다.',
  '- 진단·평가·판정을 하지 않는다. 적힌 말을 정리만 한다.',
  '- 존댓말 대신 기록체(…함, …라고 말함)를 쓴다.',
  '- 숫자는 반드시 살린다. 건수·금액·기간. "늘었다"가 아니라 "3건에서 4건으로".',
  '- 같은 것을 두 번 다르게 말했으면 **나중 말**을 쓴다. 처음에 둘러대고 나중에 진짜를 말하는 일이 잦다.',
  '',
  '무엇이 먼저인가 (요약에 넣을 것을 고르는 순서):',
  '1. 안전 — 폭력·착취, 위기 발언, 연락 두절 위험',
  '2. 돈과 집 — 연체·채무·월세·퇴거',
  '3. 하기로 한 일이 안 된 것과 **그 이유**',
  '4. 당사자가 먼저 요청한 것',
  '5. 건강·돌봄의 변화',
  '',
  '요약에 넣지 않는 것: 지각·날씨·교통 같은 잡담, 같은 말의 반복, 변화 없는 상태.',
  '',
  '사실관계 변화(fact_changes): [지난 회차] 자료가 함께 오면, 지난 회차에서 말한 것과 이번 회차에서',
  '말한 것이 **서로 어긋나는 사실**만 찾는다(건수·금액·기간·관계·상태). 새로 알게 된 것은 아니다.',
  '양쪽 원문을 한 문장씩 **자료에 적힌 그대로** 옮긴다. 고쳐 쓰거나 줄이지 않는다.',
  '어느 쪽이 맞는지 판정하지 않는다 — 앞뒤 맥락만 한두 문장으로 적는다. 지난 회차 자료가 없으면 빈 배열.',
].join('\n');

// 칸은 **사람이 쓰는 칸과 같다**(GLOSSARY §6-2). 그래야 승인하면 그대로 카드가 된다.
// 한 덩어리로 받으면 무엇을 버릴지 모델이 제멋대로 고른다.
type Shape = { summary: string; changes: string[]; tasks: string[]; questions: string[]; fact_changes: FactChange[] };

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'changes', 'tasks', 'questions', 'fact_changes'],
  properties: {
    summary: {
      type: 'string',
      description:
        '세 문장 이내. 위 우선순위대로 고른다. 1순위가 있으면 그것으로 시작한다. ' +
        '15초에 읽히지 않으면 쓸모가 없다.',
    },
    changes: {
      type: 'array',
      items: { type: 'string' },
      description:
        '지난 회차와 견줘 **달라진** 것만. 이전과 이후를 함께 쓴다(예: 연체 3건 → 4건). ' +
        '새로 알게 된 사실이나 그대로인 상태는 넣지 않는다. 없으면 빈 배열.',
    },
    tasks: {
      type: 'array',
      items: { type: 'string' },
      description: '다음까지 하기로 한 일. 자료에 적힌 것만. 못 한 것은 이유와 함께 남긴다.',
    },
    questions: {
      type: 'array',
      items: { type: 'string' },
      description: '다음에 확인할 것. 자료에 적힌 것만.',
    },
    fact_changes: {
      type: 'array',
      description: '지난 회차와 이번 회차가 서로 어긋나는 사실. 양쪽 원문을 그대로 옮긴다. 없으면 빈 배열.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['topic', 'before', 'after', 'note'],
        properties: {
          topic: { type: 'string', description: '무엇이 달라졌는지 한 줄' },
          before: {
            type: 'object', additionalProperties: false, required: ['seq', 'quote'],
            properties: { seq: { type: 'integer', description: '지난 회차 번호' }, quote: { type: 'string', description: '그 회차 자료의 원문 한 문장' } },
          },
          after: {
            type: 'object', additionalProperties: false, required: ['seq', 'quote'],
            properties: { seq: { type: 'integer', description: '이번 회차 번호' }, quote: { type: 'string', description: '이번 회차 자료의 원문 한 문장' } },
          },
          note: { type: 'string', description: '앞뒤 맥락 한두 문장. 판정이 아니다.' },
        },
      },
    },
  },
} as const;

async function callGemini(prompt: string): Promise<Shape> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AiUnavailable('AI 정리 불가, GEMINI_API_KEY 없음');
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        // Gemini 의 스키마는 OpenAPI 계열이라 `additionalProperties` 를 모른다. 중첩까지 전부 뺀다.
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: JSON.parse(
            JSON.stringify(SCHEMA, (k, v) => (k === 'additionalProperties' ? undefined : v)),
          ),
        },
      }),
    },
  );
  if (!res.ok) throw new AiUnavailable(`AI 응답 실패 (${res.status})`);
  const payload = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new AiUnavailable('AI 응답 해석 실패');
  return JSON.parse(text) as Shape;
}

/**
 * OpenAI 키의 출처(2026-09-17 Q). 기관이 화면에서 넣은 키(DB 암호문)가 먼저고, 없으면 환경 변수다.
 * 호출마다 다시 읽는다 — 키를 바꾸면 다음 호출부터 바로 적용된다. 값은 절대 응답·로그에 싣지 않는다.
 */
export async function openAiKey(): Promise<{ key: string; source: 'db' | 'env' } | null> {
  const [row] = await sql<Array<{ enc_openai_key: string | null }>>`
    select enc_openai_key from organization where id = 1`;
  const stored = decryptPii(row?.enc_openai_key ?? null);
  if (stored) return { key: stored, source: 'db' };
  const env = process.env.OPENAI_API_KEY;
  return env ? { key: env, source: 'env' } : null;
}

/**
 * OpenAI 에 응답 보관을 맡기지 않는다 — 동의 문안이 그렇게 약속한다(2026-09-17 Q).
 * 요청 본문과 감사 기록이 같은 값을 읽는다. 둘이 어긋나면 감사가 거짓이 된다.
 */
const OPENAI_STORE = false;

async function callOpenAi(prompt: string): Promise<Shape> {
  const found = await openAiKey();
  if (!found) throw new AiUnavailable('AI 정리 불가, OpenAI API 키 없음');
  const { key } = found;

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      // 추론을 길게 돌릴 일이 아니다. 적힌 말을 정리할 뿐이다.
      // gpt-5.4 이상은 'minimal' 을 받지 않는다. 'none' 이 같은 자리다.
      reasoning: { effort: MODEL.startsWith('gpt-5.') ? 'none' : 'minimal' },
      // 응답 재사용용 보관을 끈다. 남용 감시 30일은 별건이다.
      store: OPENAI_STORE,
      input: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: prompt },
      ],
      text: { format: { type: 'json_schema', name: 'session_draft', strict: true, schema: SCHEMA } },
    }),
  });

  if (!res.ok) throw new AiUnavailable(`AI 응답 실패 (${res.status})`);
  const payload = (await res.json()) as {
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
    output_text?: string;
  };
  // `output` 의 첫 항목은 추론(reasoning)이라 글이 없다. 말(message) 항목을 찾아야 한다.
  const text =
    payload.output_text ??
    payload.output
      ?.find((o) => o.type === 'message')
      ?.content?.find((c) => c.type === 'output_text')?.text;
  if (!text) throw new AiUnavailable('AI 응답 해석 실패');
  return JSON.parse(text) as Shape;
}

const callModel = (prompt: string): Promise<Shape> =>
  PROVIDER === 'gemini' ? callGemini(prompt) : callOpenAi(prompt);

/** 회차 하나의 자료 조각(상담 내용 + 카드). 마스킹 전 평문이다. */
async function sessionParts(session: Session): Promise<Array<{ label: string; text: string }>> {
  const cards = await sql<Card[]>`select * from cards where source_session_id = ${session.id} order by id`;
  return [
    { label: '상담 내용', text: decryptText(session.memo) ?? '' },
    ...cards.map((c) => ({ label: SECTION_LABEL[c.source_section] ?? c.source_section, text: decryptText(c.text) ?? '' })),
  ].filter((p) => p.text.trim());
}

/**
 * 한 회차의 초안을 만든다. 저장된 자료만 쓰고, 보내기 전에 마스킹한다.
 * 동의(외부 LLM·국외 처리)가 없으면 호출 자체를 하지 않는다.
 * 지난 회차 자료도 함께 보낸다 — 사실관계 변화는 견줄 상대가 있어야 나온다.
 * ponytail: 지난 회차 전부를 매번 보낸다. 회차가 수십 개로 늘면 최근 N개로 자른다.
 */
export async function draftSession(sessionId: number, actorId: number): Promise<Draft> {
  const [session] = await sql<Session[]>`select * from sessions where id = ${sessionId}`;
  if (!session) throw new Error('회차 없음');
  await assertConsent(session.case_id, 'external_llm_cross_border_processing');

  const [participant] = await sql<Array<{ pseudonym: string; enc_name: string | null; enc_phone: string | null; enc_email: string | null }>>`
    select p.pseudonym, v.enc_name, v.enc_phone, v.enc_email
    from support_cases c
    join participants p on p.id = c.participant_id
    left join participant_pii v on v.participant_id = p.id
    where c.id = ${session.case_id}`;

  const subject = {
    pseudonym: participant.pseudonym,
    name: decryptPii(participant.enc_name),
    phone: decryptPii(participant.enc_phone),
    email: decryptPii(participant.enc_email),
  };

  const parts = await sessionParts(session);
  if (parts.length === 0) throw new AiUnavailable('정리할 내용 없음, 상담 내용 먼저 입력');
  const { parts: masked, hits } = maskAll(parts, subject);

  // 지난 회차는 기록된 것만, 회차 순으로. 마스킹 건수는 이번 회차 것만 센다 — 감사에 남는 값이다.
  const previous = await sql<Session[]>`
    select * from sessions where case_id = ${session.case_id} and seq < ${session.seq} and status = 'done' order by seq`;
  const history: string[] = [];
  for (const p of previous) {
    const pParts = await sessionParts(p);
    if (pParts.length === 0) continue;
    const { parts: pMasked } = maskAll(pParts, subject);
    history.push(`[지난 회차 ${p.seq}회차]`, ...pMasked.map((x) => `(${x.label}) ${x.text}`), '');
  }

  const prompt = [
    `${session.seq}회차 상담 자료다. 아래 내용만 보고 정리한다.`,
    '',
    ...masked.map((p) => `[${p.label}]\n${p.text}`),
    ...(history.length > 0 ? ['', '---- 지난 회차 자료 (사실관계 변화를 찾는 데만 쓴다) ----', ...history] : []),
  ].join('\n');

  const shape = await callModel(prompt);

  const [row] = await sql<Array<{ id: number; created_at: string }>>`
    insert into ai_drafts (session_id, status, summary, changes, tasks, questions, fact_changes, mask_hits, model, created_by)
    values (${sessionId}, 'draft', ${shape.summary}, ${sql.json(shape.changes)}, ${sql.json(shape.tasks)},
            ${sql.json(shape.questions)}, ${sql.json(shape.fact_changes)}, ${sql.json(hits)}, ${MODEL}, ${actorId})
    returning id, created_at`;

  // 무엇을 몇 건 마스킹해 **어디로** 보냈는지 남긴다. 보낸 원문은 남기지 않는다.
  // 수신자는 국외 이전 기록의 본체다. 빠지면 "누구에게 넘어갔나"에 답할 수 없다.
  await audit({
    actorId,
    action: 'ai.draft',
    caseId: session.case_id,
    fields: [
      `recipient=${AI_PROVIDERS[PROVIDER].legalRecipient}`,
      `country=${AI_PROVIDERS[PROVIDER].country}`,
      `model=${MODEL}`,
      // 어떤 보관 설정으로 보냈는지가 증거다. Gemini 경로에는 그 설정이 없어 남기지 않는다.
      ...(PROVIDER === 'openai' ? [`store=${OPENAI_STORE}`] : []),
      ...Object.entries(hits).map(([kind, n]) => `masked:${kind}=${n}`),
    ],
  });

  return {
    id: row.id,
    session_id: sessionId,
    status: 'draft',
    summary: shape.summary,
    changes: shape.changes,
    tasks: shape.tasks,
    questions: shape.questions,
    fact_changes: shape.fact_changes,
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
    select id, session_id, status, summary, changes, tasks, questions, fact_changes, mask_hits, model, created_by, created_at
    from ai_drafts where session_id = ${sessionId} order by id desc limit 1`;
  return row ?? null;
}

/**
 * 승인. 사람이 고친 문구가 있으면 그것으로 승인한다(수정본도 승인 전에는 초안이다).
 * 지우지 않고 새 행을 쌓는다 — 무엇을 보고 승인했는지가 남아야 한다.
 *
 * **승인이 곧 기록이다**(SPEC §15-4, 2026-09-16 검수). 승인 행만 남기고 카드를 안 만들었더니
 * 승인한 요약이 어디에도 안 떴다. 과제·질문은 같은 트랜잭션에서 `ai_approved` 카드가 되어
 * 다음 회차의 확인할 과제·물어볼 것으로 올라간다. 요약·달라진 것은 승인 행에서 읽는다.
 */
export async function approveDraft(
  sessionId: number,
  actorId: number,
  edited?: { summary?: string; changes?: string[]; tasks?: string[]; questions?: string[] },
): Promise<Draft> {
  const [session] = await sql<Session[]>`select case_id from sessions where id = ${sessionId}`;
  if (!session) throw new Error('회차 없음');
  const current = await latestDraft(sessionId);
  if (!current) throw new Error('승인할 초안 없음');

  const summary = edited?.summary ?? current.summary;
  const changes = edited?.changes ?? current.changes;
  const tasks = edited?.tasks ?? current.tasks;
  const questions = edited?.questions ?? current.questions;

  const row = await sql.begin(async (tx) => {
    const [inserted] = await tx<Array<{ id: number; created_at: string }>>`
      insert into ai_drafts (session_id, status, summary, changes, tasks, questions, fact_changes, mask_hits, model, created_by, approved_by)
      values (${sessionId}, 'approved', ${summary}, ${sql.json(changes)}, ${sql.json(tasks)}, ${sql.json(questions)},
              ${sql.json(current.fact_changes)}, ${sql.json(current.mask_hits)}, ${current.model}, ${current.created_by ?? actorId}, ${actorId})
      returning id, created_at`;
    await replaceAiCards(tx as unknown as typeof sql, session.case_id, sessionId, [
      ...tasks.map((text) => ({ kind: 'promise' as const, text, section: 'promise' as const })),
      ...questions.map((text) => ({ kind: 'question' as const, text, section: 'question' as const })),
    ]);
    return inserted;
  });

  await audit({
    actorId,
    action: 'ai.approve',
    caseId: session.case_id,
    fields: [`draft=${current.id}`, edited ? 'edited=yes' : 'edited=no'],
  });

  return { ...current, id: row.id, status: 'approved', summary, changes, tasks, questions, created_at: row.created_at };
}
