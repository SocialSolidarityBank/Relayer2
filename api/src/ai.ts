// AI 텍스트 경로(P3). 순서가 곧 규칙이다.
//
//   동의 확인 → 마스킹 → 외부 호출 → **초안 저장** → 사람이 승인해야 기록
//
// 승인 전에는 어떤 것도 회차 기록이 되지 않는다. 승인은 사람만 한다(GLOSSARY §6-5).
//
// v6(2026-09-18 Q): 초안 자체는 record-analysis.ts 가 만든다(현재 회차만, span 참조). 여기에는 제공자 호출과
// 사례 기억만 남는다. 사례 기억(SPEC §15-6)은 저장·삭제·동결만 하고 초안 입력으로 쓰지 않는다(결정 20).
import { readFileSync } from 'node:fs';
import { assertConsent, ConsentRequired } from './service.ts';
import { AI_PROVIDERS, type AiProviderId } from './consent.ts';
import { audit } from './audit.ts';
import { sql } from './db.ts';
import { maskAll, type MaskSubject } from './domain/masking.ts';
import type { StubFile } from './domain/record-analysis.ts';

import { decryptPii, decryptText, encryptText } from './pii.ts';
import type { Card, Session } from './domain/types.ts';

/**
 * 제공자는 기관이 고른다. 바꾸면 동의 문안 해시가 달라져 기존 동의가 `확인 필요`로 떨어진다 —
 * 그게 맞는 동작이다. 누구에게 보내는지가 곧 동의의 내용이다.
 */
// 호출마다 읽는다(상수 아님) — 시험이 import 뒤에 AI_PROVIDER=stub 을 켠다(2026-09-18 v6).
export const provider = (): AiProviderId => (process.env.AI_PROVIDER ?? 'openai') as AiProviderId;
// gemini-2.5-flash 는 신규 사용자에게 닫혔다(2026-09-15 실측 404). 별칭을 쓴다.
// openai 는 gpt-5.5 — 9개 모델을 재 보고 골랐다(SPEC.md §15-4).
export const model = (): string => process.env.AI_MODEL ?? (provider() === 'gemini' ? 'gemini-flash-latest' : 'gpt-5.5');

export class AiUnavailable extends Error {}

/** 초안과 기억이 함께 지키는 규칙. 기억은 여기에 "무엇을 접는가"만 더한다. */
const RULES = [
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
];

/** 모델에 보내는 한 요청. 초안·기억·v6 분석이 규칙(system)·틀(schema)만 다르고 길은 같다. */
export type ModelRequest = {
  system: string;
  prompt: string;
  schema: object;
  name: string;
  /** AI_PROVIDER=stub 일 때 StubFile.by_seq 의 열쇠(회차 번호). 없으면 default. */
  stubKey?: string;
};

async function callGemini<T>(req: ModelRequest): Promise<T> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AiUnavailable('AI 정리 불가, GEMINI_API_KEY 없음');
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model()}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
        // Gemini 의 스키마는 OpenAPI 계열이라 `additionalProperties` 를 모른다. 중첩까지 전부 뺀다.
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: JSON.parse(
            JSON.stringify(req.schema, (k, v) => (k === 'additionalProperties' ? undefined : v)),
          ),
        },
      }),
    },
  );
  if (!res.ok) throw new AiUnavailable(`AI 응답 실패 (${res.status})`);
  const payload = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new AiUnavailable('AI 응답 해석 실패');
  return JSON.parse(text) as T;
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

async function callOpenAi<T>(req: ModelRequest): Promise<T> {
  const found = await openAiKey();
  if (!found) throw new AiUnavailable('AI 정리 불가, OpenAI API 키 없음');
  const { key } = found;

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: model(),
      // 추론을 길게 돌릴 일이 아니다. 적힌 말을 정리할 뿐이다.
      // gpt-5.4 이상은 'minimal' 을 받지 않는다. 'none' 이 같은 자리다.
      reasoning: { effort: model().startsWith('gpt-5.') ? 'none' : 'minimal' },
      // 응답 재사용용 보관을 끈다. 남용 감시 30일은 별건이다.
      store: OPENAI_STORE,
      input: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.prompt },
      ],
      text: { format: { type: 'json_schema', name: req.name, strict: true, schema: req.schema } },
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
  return JSON.parse(text) as T;
}

/**
 * stub 제공자(2026-09-18 v6). 동의·마스킹·검증은 그대로 돌고 모델 자리만 고정 파일로 단락한다.
 * 파일은 호출마다 다시 읽는다 — e2e 가 장면마다 바꿔 쓴다. 모양은 domain/record-analysis.ts 의 StubFile.
 */
async function callStub<T>(req: ModelRequest): Promise<T> {
  const file = process.env.AI_STUB_FILE;
  if (!file) throw new AiUnavailable('AI 정리 불가, AI_STUB_FILE 없음');
  const stub = JSON.parse(readFileSync(file, 'utf8')) as StubFile;
  const picked = (req.stubKey && stub.by_seq?.[req.stubKey]) ?? stub.default;
  if (!picked) throw new AiUnavailable('AI 정리 불가, stub 응답 없음');
  return picked as T;
}

export const callModel = <T>(req: ModelRequest): Promise<T> => {
  const p = provider();
  if (p === 'stub') return callStub<T>(req);
  return p === 'gemini' ? callGemini<T>(req) : callOpenAi<T>(req);
};

/** 어디로 어떤 설정으로 보냈는지. 초안과 기억이 같은 줄을 남긴다 — 감사가 서로 다르면 하나는 거짓이다. */
const outboundFields = (hits: Record<string, number>): string[] => [
  `recipient=${AI_PROVIDERS[provider()].legalRecipient}`,
  `country=${AI_PROVIDERS[provider()].country}`,
  `model=${model()}`,
  // 어떤 보관 설정으로 보냈는지가 증거다. Gemini 경로에는 그 설정이 없어 남기지 않는다.
  ...(provider() === 'openai' ? [`store=${OPENAI_STORE}`] : []),
  ...Object.entries(hits).map(([kind, n]) => `masked:${kind}=${n}`),
];

/** 마스킹 대상 — 이 사례 당사자의 가명과 금고 값. 금고가 비어 있어도 형태 규칙은 돈다. */
async function subjectFor(caseId: number): Promise<MaskSubject> {
  const [participant] = await sql<Array<{ pseudonym: string; enc_name: string | null; enc_phone: string | null; enc_email: string | null }>>`
    select p.pseudonym, v.enc_name, v.enc_phone, v.enc_email
    from support_cases c
    join participants p on p.id = c.participant_id
    left join participant_pii v on v.participant_id = p.id
    where c.id = ${caseId}`;
  if (!participant) throw new Error('사례 없음');
  return {
    pseudonym: participant.pseudonym,
    name: decryptPii(participant.enc_name),
    phone: decryptPii(participant.enc_phone),
    email: decryptPii(participant.enc_email),
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

// ── 사례 기억 ──────────────────────────────────────────────────────────────────

/** 기본값: 평문 상한. ponytail: 고정 상한 — 회차가 수십 개로 늘어 모자라면 오래된 회차 압축 규칙을 더한다. */
export const MEMORY_MAX_CHARS = 4000;

export type MemoryTrigger = 'record_done' | 'approve_draft' | 'draft_request' | 'edit';
export type MemoryRef = { session_id: number; seq: number; card_ids: number[] };
type MemoryShape = { text: string; refs: MemoryRef[] };

const MEMORY_SYSTEM = [
  ...RULES,
  '',
  '지금 할 일: 한 사례의 지난 회차 자료 전체를 **다음 회차 초안을 만들 때 대신 읽을 기억**으로 접는다.',
  '기억에 반드시 담는다:',
  '- 전체 상담 목표(있으면)',
  '- 아직 안 끝난 과제와 약속, 그리고 안 된 이유',
  '- 회차 사이에 달라진 사실(건수·금액·기간·관계·상태) — 이전과 이후를 회차 번호와 함께',
  '- 각 항목 끝에 근거 회차 번호를 "(3회차)" 꼴로 적는다',
  `본문은 ${MEMORY_MAX_CHARS}자를 넘기지 않는다. 오래된 회차는 짧게, 최근 회차는 자세히.`,
  'refs 에는 실제로 읽은 회차의 session_id·seq 와 그 회차에서 근거로 쓴 card_id 만 적는다. 자료에 없는 id 는 적지 않는다.',
].join('\n');

const MEMORY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'refs'],
  properties: {
    text: { type: 'string', description: `기억 본문. 기록체. ${MEMORY_MAX_CHARS}자 이내.` },
    refs: {
      type: 'array',
      description: '근거로 쓴 회차와 카드. 자료에 적힌 id 만.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['session_id', 'seq', 'card_ids'],
        properties: {
          session_id: { type: 'integer' },
          seq: { type: 'integer' },
          card_ids: { type: 'array', items: { type: 'integer' } },
        },
      },
    },
  },
} as const;

/**
 * 사례 기억을 다시 만든다. done 회차 전체(또는 `beforeSeq` 앞까지)에서 매번 처음부터 — 증분이 아니다.
 * 그래야 원본이 고쳐져도 같은 절차로 같은 답이 나온다.
 *
 * 순서는 초안과 같다: 동의 확인 → 마스킹 → 외부 호출 → 저장 → 감사. 종결 사례는 얼린다(아무것도 안 함).
 * 접을 회차가 없으면 행을 지운다. 응답의 refs 가 사례 밖 id 를 가리키면 실패다 — 지어낸 근거는 근거가 아니다.
 *
 * 동시 갱신은 막지 않는다. 둘 다 그 시점의 맞는 스냅샷이고, 초안은 through_seq 가 정확히 맞을 때만 읽는다.
 * ponytail: 잠금 없음 — 같은 사례를 두 사람이 동시에 저장하는 일이 잦아지면 advisory lock 을 더한다.
 */
export async function refreshCaseMemory(
  caseId: number,
  actorId: number,
  trigger: MemoryTrigger,
  opts: { beforeSeq?: number } = {},
): Promise<{ text: string; through_seq: number } | null> {
  const [supportCase] = await sql<Array<{ status: string }>>`select status from support_cases where id = ${caseId}`;
  if (!supportCase) throw new Error('사례 없음');
  if (supportCase.status === 'closed') return null;
  await assertConsent(caseId, 'external_llm_cross_border_processing');

  const sessions = await sql<Session[]>`
    select * from sessions
    where case_id = ${caseId} and status = 'done'
      and seq < ${opts.beforeSeq ?? 2147483647}
    order by seq`;
  if (sessions.length === 0) {
    await sql`delete from case_memories where case_id = ${caseId}`;
    return null;
  }

  const subject = await subjectFor(caseId);
  const hits: Record<string, number> = {};
  const lines: string[] = [];
  const cardIdsBySession = new Map<number, Set<number>>();
  for (const s of sessions) {
    const cards = await sql<Card[]>`select * from cards where source_session_id = ${s.id} order by id`;
    cardIdsBySession.set(s.id, new Set(cards.map((c) => c.id)));
    const parts = [
      { id: null as number | null, label: '상담 내용', text: decryptText(s.memo) ?? '' },
      ...cards.map((c) => ({ id: c.id as number | null, label: SECTION_LABEL[c.source_section] ?? c.source_section, text: decryptText(c.text) ?? '' })),
    ].filter((p) => p.text.trim());
    const masked = maskAll(parts, subject);
    for (const [kind, n] of Object.entries(masked.hits)) hits[kind] = (hits[kind] ?? 0) + n;
    lines.push(`[${s.seq}회차 session_id=${s.id}]`);
    masked.parts.forEach((p, i) => {
      const id = parts[i].id;
      lines.push(`(${p.label}${id === null ? '' : ` card_id=${id}`}) ${p.text}`);
    });
    lines.push('');
  }
  const through = sessions[sessions.length - 1].seq;

  const shape = await callModel<MemoryShape>({
    system: MEMORY_SYSTEM,
    prompt: ['이 사례의 지난 회차 자료다. 아래 내용만 보고 기억으로 접는다.', '', ...lines].join('\n'),
    schema: MEMORY_SCHEMA,
    name: 'case_memory',
  });
  if (typeof shape.text !== 'string' || !shape.text.trim()) throw new AiUnavailable('기억 응답 해석 실패');
  if (shape.text.length > MEMORY_MAX_CHARS) throw new AiUnavailable(`기억이 상한(${MEMORY_MAX_CHARS}자)을 넘음`);
  const refs = Array.isArray(shape.refs) ? shape.refs : [];
  for (const r of refs) {
    const known = cardIdsBySession.get(r.session_id);
    if (!known || !(r.card_ids ?? []).every((id) => known.has(id))) {
      throw new AiUnavailable('기억 근거가 사례 밖을 가리킴');
    }
  }

  await sql`
    insert into case_memories (case_id, enc_text, through_seq, refs, mask_hits, model, created_by, updated_at)
    values (${caseId}, ${encryptText(shape.text)}, ${through}, ${sql.json(refs)}, ${sql.json(hits)}, ${model()}, ${actorId}, now())
    on conflict (case_id) do update set
      enc_text = excluded.enc_text, through_seq = excluded.through_seq, refs = excluded.refs,
      mask_hits = excluded.mask_hits, model = excluded.model, created_by = excluded.created_by, updated_at = now()`;

  await audit({
    actorId,
    action: 'ai.memory',
    caseId,
    fields: [`trigger=${trigger}`, `through_seq=${through}`, ...outboundFields(hits)],
  });

  return { text: shape.text, through_seq: through };
}

/** 마지막으로 뒤에서 띄운 갱신. 시험이 시간을 재지 않고 이것을 기다린다. 서비스 코드는 읽지 않는다. */
let lastBackgroundRefresh: Promise<void> = Promise.resolve();
export const settleCaseMemory = (): Promise<void> => lastBackgroundRefresh;

/**
 * 저장·승인 뒤에 뒤에서 한 번. 실패해도 요청은 성공이다 — 다음 초안 요청이 다시 만든다.
 *
 * 방금 저장한 회차가 **마지막** 회차면 그 앞까지만 접는다: 그 회차의 초안은 "직전까지" 의 기억을 원한다.
 * 지난 회차를 고친 것이면 전부 접는다 — 빼면 다음 초안이 그 회차를 모른다. 승인은 뺄 것이 없다.
 */
export function refreshCaseMemoryInBackground(
  caseId: number,
  actorId: number,
  trigger: MemoryTrigger,
  savedSessionId?: number,
): void {
  lastBackgroundRefresh = (async () => {
    let beforeSeq: number | undefined;
    if (savedSessionId !== undefined) {
      const [row] = await sql<Array<{ seq: number; last: number }>>`
        select s.seq, (select max(seq) from sessions where case_id = ${caseId} and status = 'done') as last
        from sessions s where s.id = ${savedSessionId}`;
      if (row && row.seq === row.last) beforeSeq = row.seq;
    }
    await refreshCaseMemory(caseId, actorId, trigger, { beforeSeq });
  })().catch((error) => {
    // 동의가 없거나 AI 가 없는 것은 사고가 아니라 상태다. 한 줄로 남기고 스택은 진짜 오류에만.
    if (error instanceof ConsentRequired || error instanceof AiUnavailable) {
      console.log(`[사례 기억] 건너뜀 case=${caseId} trigger=${trigger} · ${error.message}`);
      return;
    }
    console.error(`[사례 기억] 갱신 실패 case=${caseId} trigger=${trigger}`, error);
  });
}

/** 외부 LLM 동의를 거두면 그 동의로 만든 기억도 지운다(음성 철회와 대칭). 새 기억도 동의가 없어 안 생긴다. */
export async function withdrawCaseMemory(caseId: number, actorId: number): Promise<number> {
  const rows = await sql`delete from case_memories where case_id = ${caseId} returning case_id`;
  if (rows.length > 0) await audit({ actorId, action: 'ai.memory.withdraw', caseId, fields: [] });
  return rows.length;
}

