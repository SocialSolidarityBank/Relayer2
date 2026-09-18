// AI 텍스트 경로(P3). 순서가 곧 규칙이다.
//
//   동의 확인 → 마스킹 → 외부 호출 → **초안 저장** → 사람이 승인해야 기록
//
// 승인 전에는 어떤 것도 회차 기록이 되지 않는다. 승인은 사람만 한다(GLOSSARY §6-5).
//
// 사례 기억(2026-09-18 Q, SPEC §15-6): 지난 회차 전량을 매번 보내는 대신, 사례당 한 행의 요약 캐시를
// 초안의 과거 입력으로 쓴다. 기억도 초안처럼 비공식이며, 언제든 done 회차 전체에서 다시 만든다.
import { assertConsent, ConsentRequired, replaceAiCards } from './service.ts';
import { AI_PROVIDERS, type AiProviderId } from './consent.ts';
import { audit } from './audit.ts';
import { sql } from './db.ts';
import { maskAll, type MaskSubject } from './domain/masking.ts';

import { decryptPii, decryptText, encryptText } from './pii.ts';
import {
  EVIDENCE_GRADES,
  EVIDENCE_TRANSFORMS,
  type AiEvidence,
  type AiOmission,
  type Card,
  type FactChange,
  type Session,
} from './domain/types.ts';

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
  /** 항목별 근거(2026-09-18 Q). 2026-09-18 이전 행은 빈 배열이다. 인용은 서버가 자료와 대조한 것만 남는다. */
  evidence: AiEvidence[];
  /** 역방향 점검 — 어떤 항목에도 안 쓰인 자료 구간(상·중). 2026-09-18 이전 행은 빈 배열. */
  omissions: AiOmission[];
  /** 놓친 구간 중 `하`(인사·잡담·반복) 건수. 낱개로 나열하지 않는다. */
  omitted_minor_count: number;
  mask_hits: Record<string, number>;
  model: string | null;
  created_by: number | null;
  created_at: string;
};

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

const SYSTEM = [
  ...RULES,
  '',
  '사실관계 변화(fact_changes): [사례 기억] 자료가 함께 오면, 기억에 적힌 지난 회차 내용과 이번 회차에서',
  '말한 것이 **서로 어긋나는 사실**만 찾는다(건수·금액·기간·관계·상태). 새로 알게 된 것은 아니다.',
  '양쪽 원문을 한 문장씩 **자료에 적힌 그대로** 옮긴다. 고쳐 쓰거나 줄이지 않는다. before.seq 는 기억에 적힌 회차 번호다.',
  '어느 쪽이 맞는지 판정하지 않는다 — 앞뒤 맥락만 한두 문장으로 적는다. 사례 기억이 없으면 빈 배열.',
  '',
  '근거(evidence): changes·tasks·questions 의 **항목마다 하나**. 방향은 늘 항목 → 자료다 — 항목을 하나씩 순회하며',
  '그 항목을 쓰게 만든 자료 구간을 찾는다. 표현 유사도로 판단하지 않는다: 항목은 결론이고 자료는 사건이라 단어가 하나도 안 겹쳐도 대응한다.',
  'item 은 항목 문장을 글자 그대로. source 는 그 자료의 대괄호 라벨(상담 내용·전사문 등). quotes 는 항목을 만들게 한 원문 문장들을',
  '**자료에 적힌 그대로**(줄임·다듬기·맞춤법 교정 금지) — 여기저기 흩어져 있으면 끝까지 훑어 전부 모은다. 한 구간이 여러 항목의 근거여도 된다.',
  'context 는 quotes 를 품은 앞뒤 문장 발췌(보통 2~5문장), 자료 그대로. context 만 읽어도 왜 그 항목이 나왔는지 읽혀야 한다.',
  'grade: 완전(명시적 근거, 정확히 반영) · 부분(근거는 있으나 일부만) · 정황(명시적 진술 없이 어조·맥락·반복에서 추론) ·',
  '과잉(근거보다 세게·넓게 단정) · 모순(자료와 어긋남) · 없음(대응 구간 못 찾음). 애매하면 늘 낮은 등급. 억지로 붙이는 것이 가장 나쁘다.',
  'transforms: 자료 → 항목에 일어난 변환(일반화·감정 라벨링·집계·경향화·해석·판단·압축·화자 전환), 해당하는 것 전부.',
  '대응시키지 않는 경우: 같은 단어지만 맥락이 다름, 시점이 다름(현재 vs 과거 회상), 화자가 다름(제3자의 말), 부정·가정·전문(傳聞) 맥락,',
  '질문자가 유도한 뒤의 단순 동의("응", "네")만으로 뒷받침되는 경우. 배제했으면 note 에 왜 배제했는지 적는다.',
  'note: 왜 근거인지 한두 문장. 추론이 개입했으면 어디서인지.',
  '',
  '놓친 구간(omissions): 자료를 다 본 뒤, 어떤 항목에도 대응되지 않은 구간을 뽑는다. importance 상 = 정리의 결론을 바꿀 수 있는 내용',
  '또는 정리와 반대 방향의 신호, 중 = 정리에 있으면 좋았을 구체 정보(금액·날짜·관계). 각각 quote(자료 그대로)와 summary 한 줄.',
  '하(인사·잡담·반복)는 나열하지 않고 omitted_minor_count 에 건수만 적는다.',
  '',
  '출력 전 확인: 모든 인용이 자료에 그 문자열 그대로 있는가. 완전을 준 항목에 정말 명시적 근거가 있는가(의심되면 정황). 항목 수와 evidence 수가 같은가.',
].join('\n');

// 칸은 **사람이 쓰는 칸과 같다**(GLOSSARY §6-2). 그래야 승인하면 그대로 카드가 된다.
// 한 덩어리로 받으면 무엇을 버릴지 모델이 제멋대로 고른다.
type Shape = {
  summary: string;
  changes: string[];
  tasks: string[];
  questions: string[];
  fact_changes: FactChange[];
  evidence: AiEvidence[];
  omissions: AiOmission[];
  omitted_minor_count: number;
};

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'changes', 'tasks', 'questions', 'fact_changes', 'evidence', 'omissions', 'omitted_minor_count'],
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
    evidence: {
      type: 'array',
      description: 'changes·tasks·questions 항목마다 하나. 항목을 낳은 원문 문장들과 앞뒤 맥락을 자료 그대로.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['item', 'source', 'quotes', 'context', 'grade', 'transforms', 'note'],
        properties: {
          item: { type: 'string', description: '항목 문장 그대로' },
          source: { type: 'string', description: '자료의 대괄호 라벨 그대로(상담 내용·전사문 등)' },
          quotes: { type: 'array', items: { type: 'string' }, description: '항목을 만들게 한 원문 문장들, 자료 그대로. 없음이면 빈 배열' },
          context: { type: 'string', description: 'quotes 를 품은 앞뒤 문장 발췌, 자료 그대로. 없음이면 빈 문자열' },
          grade: { type: 'string', enum: EVIDENCE_GRADES, description: '완전·부분·정황·과잉·모순·없음, 애매하면 낮게' },
          transforms: { type: 'array', items: { type: 'string', enum: EVIDENCE_TRANSFORMS }, description: '자료 → 항목 변환 유형, 해당하는 것 전부' },
          note: { type: 'string', description: '왜 근거인지 한두 문장. 추론·배제 사유' },
        },
      },
    },
    omissions: {
      type: 'array',
      description: '어떤 항목에도 대응되지 않은 자료 구간, 상·중만. 하는 건수로.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['source', 'quote', 'importance', 'summary'],
        properties: {
          source: { type: 'string', description: '자료의 대괄호 라벨 그대로' },
          quote: { type: 'string', description: '자료 그대로' },
          importance: { type: 'string', enum: ['상', '중'] },
          summary: { type: 'string', description: '내용 한 줄' },
        },
      },
    },
    omitted_minor_count: { type: 'integer', description: '놓친 구간 중 하(인사·잡담·반복) 건수' },
  },
} as const;

/** 모델에 보내는 한 요청. 초안과 기억이 규칙(system)·틀(schema)만 다르고 길은 같다. */
type ModelRequest = { system: string; prompt: string; schema: object; name: string };

async function callGemini<T>(req: ModelRequest): Promise<T> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AiUnavailable('AI 정리 불가, GEMINI_API_KEY 없음');
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
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
      model: MODEL,
      // 추론을 길게 돌릴 일이 아니다. 적힌 말을 정리할 뿐이다.
      // gpt-5.4 이상은 'minimal' 을 받지 않는다. 'none' 이 같은 자리다.
      reasoning: { effort: MODEL.startsWith('gpt-5.') ? 'none' : 'minimal' },
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

const callModel = <T>(req: ModelRequest): Promise<T> =>
  PROVIDER === 'gemini' ? callGemini<T>(req) : callOpenAi<T>(req);

/** 어디로 어떤 설정으로 보냈는지. 초안과 기억이 같은 줄을 남긴다 — 감사가 서로 다르면 하나는 거짓이다. */
const outboundFields = (hits: Record<string, number>): string[] => [
  `recipient=${AI_PROVIDERS[PROVIDER].legalRecipient}`,
  `country=${AI_PROVIDERS[PROVIDER].country}`,
  `model=${MODEL}`,
  // 어떤 보관 설정으로 보냈는지가 증거다. Gemini 경로에는 그 설정이 없어 남기지 않는다.
  ...(PROVIDER === 'openai' ? [`store=${OPENAI_STORE}`] : []),
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

/**
 * 회차 하나의 자료 조각(상담 내용 + 확인된 전사문 + 카드). 마스킹 전 평문이다.
 * 전사문은 **확인(승인)된 것만** 넣는다(2026-09-18 Q — 근거를 수기 혹은 녹음 전사에서 찾는다).
 * 초안은 기록의 후보고 승인은 사람이 한다는 규칙은 그대로다.
 */
async function sessionParts(session: Session): Promise<Array<{ label: string; text: string }>> {
  const cards = await sql<Card[]>`select * from cards where source_session_id = ${session.id} order by id`;
  const [tr] = await sql<Array<{ text: string }>>`
    select t.text from transcripts t
    join recordings r on r.id = t.recording_id
    where t.session_id = ${session.id} and t.status = 'approved' and r.deleted_at is null
    order by t.id desc limit 1`;
  return [
    { label: '상담 내용', text: decryptText(session.memo) ?? '' },
    { label: '전사문', text: tr ? decryptText(tr.text) ?? '' : '' },
    ...cards.map((c) => ({ label: SECTION_LABEL[c.source_section] ?? c.source_section, text: decryptText(c.text) ?? '' })),
  ].filter((p) => p.text.trim());
}

/**
 * 한 회차의 초안을 만든다. 저장된 자료만 쓰고, 보내기 전에 마스킹한다.
 * 동의(외부 LLM·국외 처리)가 없으면 호출 자체를 하지 않는다.
 * 지난 회차는 사례 기억으로 보낸다 — 사실관계 변화는 견줄 상대가 있어야 나온다.
 * 기억이 없거나 이번 회차 직전까지가 아니면 그 자리에서 다시 만든다. 그것도 안 되면 초안도 안 된다(유일 경로).
 */
export async function draftSession(sessionId: number, actorId: number): Promise<Draft> {
  const [session] = await sql<Session[]>`select * from sessions where id = ${sessionId}`;
  if (!session) throw new Error('회차 없음');
  await assertConsent(session.case_id, 'external_llm_cross_border_processing');

  const subject = await subjectFor(session.case_id);

  const parts = await sessionParts(session);
  if (parts.length === 0) throw new AiUnavailable('정리할 내용 없음, 상담 내용 먼저 입력');
  // 마스킹 건수는 이번 회차 것만 센다 — 감사에 남는 값이다. 기억 쪽 건수는 기억 사건이 따로 남긴다.
  const { parts: masked, hits } = maskAll(parts, subject);

  const memory = await memoryBefore(session, actorId);

  const prompt = [
    `${session.seq}회차 상담 자료다. 아래 내용만 보고 정리한다.`,
    '',
    ...masked.map((p) => `[${p.label}]\n${p.text}`),
    ...(memory ? ['', MEMORY_HEADER, memory] : []),
  ].join('\n');

  const raw = await callModel<Shape>({ system: SYSTEM, prompt, schema: SCHEMA, name: 'session_draft' });
  const shape = verifyEvidence(raw, masked);

  const [row] = await sql<Array<{ id: number; created_at: string }>>`
    insert into ai_drafts (session_id, status, summary, changes, tasks, questions, fact_changes, evidence, omissions, omitted_minor_count, mask_hits, model, created_by)
    values (${sessionId}, 'draft', ${shape.summary}, ${sql.json(shape.changes)}, ${sql.json(shape.tasks)},
            ${sql.json(shape.questions)}, ${sql.json(shape.fact_changes)}, ${sql.json(shape.evidence)}, ${sql.json(shape.omissions)},
            ${shape.omitted_minor_count}, ${sql.json(hits)}, ${MODEL}, ${actorId})
    returning id, created_at`;

  // 무엇을 몇 건 마스킹해 **어디로** 보냈는지 남긴다. 보낸 원문은 남기지 않는다.
  // 수신자는 국외 이전 기록의 본체다. 빠지면 "누구에게 넘어갔나"에 답할 수 없다.
  await audit({
    actorId,
    action: 'ai.draft',
    caseId: session.case_id,
    fields: outboundFields(hits),
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
    evidence: shape.evidence,
    omissions: shape.omissions,
    omitted_minor_count: shape.omitted_minor_count,
    mask_hits: hits,
    model: MODEL,
    created_by: actorId,
    created_at: row.created_at,
  };
}

/**
 * 인용 검증(2026-09-18 Q — 받은 문안의 "출력 전 자기검증"을 서버가 한다). 모델이 준 인용이 보낸 자료에
 * **문자열 그대로** 없으면 버린다. 인용이 다 떨어진 근거는 `없음`으로 내린다 — 지어낸 인용은 화면에 못 오른다.
 * 대조는 공백만 접어서 한다(줄바꿈 차이는 인용이 아니다). 놓친 구간의 인용도 같은 규칙이다.
 * 라벨이 맞는 자료를 먼저 보고, 없으면 어느 자료든 본다 — 라벨을 틀리게 붙인 인용을 통째로 버리지 않기 위해.
 */
export function verifyEvidence(shape: Shape, parts: Array<{ label: string; text: string }>): Shape {
  const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
  // 모델이 라벨을 `[상담 내용]` 처럼 대괄호째 옮긴다(2026-09-18 실측). 화면·짝 찾기는 맨 라벨을 쓴다.
  const label = (s: string) => squash(s).replace(/^\[|\]$/g, '');
  const texts = parts.map((p) => ({ label: p.label, text: squash(p.text) }));
  const found = (source: string, quote: string): boolean => {
    const q = squash(quote);
    if (!q) return false;
    const own = texts.find((t) => t.label === label(source));
    return (own?.text.includes(q) ?? false) || texts.some((t) => t.text.includes(q));
  };
  const isGrade = (g: string): g is AiEvidence['grade'] => (EVIDENCE_GRADES as readonly string[]).includes(g);
  return {
    ...shape,
    evidence: (shape.evidence ?? []).map((e) => {
      const quotes = (e.quotes ?? []).filter((q) => found(e.source, q));
      const grade = quotes.length === 0 ? '없음' : isGrade(e.grade) ? e.grade : '정황';
      return {
        ...e,
        source: label(e.source),
        quotes,
        context: quotes.length === 0 ? '' : e.context,
        grade,
        transforms: (e.transforms ?? []).filter((t) => (EVIDENCE_TRANSFORMS as readonly string[]).includes(t)),
      };
    }),
    omissions: (shape.omissions ?? []).filter((o) => found(o.source, o.quote)).map((o) => ({ ...o, source: label(o.source) })),
    omitted_minor_count: Math.max(0, Math.trunc(Number(shape.omitted_minor_count) || 0)),
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

export const MEMORY_HEADER = '---- 사례 기억 (사실관계 변화를 찾는 데만 쓴다) ----';
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
    values (${caseId}, ${encryptText(shape.text)}, ${through}, ${sql.json(refs)}, ${sql.json(hits)}, ${MODEL}, ${actorId}, now())
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

/**
 * 이번 회차 직전까지의 기억. 지난 done 회차가 없으면 없음. 있는데 through_seq 가 정확히 그 직전이 아니면
 * (뒤처졌든, 이번 회차까지 접혔든) 그 자리에서 다시 만든다 — 이번 회차 자료가 기억에 섞이면 변화를 못 찾는다.
 */
async function memoryBefore(session: Session, actorId: number): Promise<string | null> {
  const [{ prev }] = await sql<Array<{ prev: number | null }>>`
    select max(seq) as prev from sessions
    where case_id = ${session.case_id} and status = 'done' and seq < ${session.seq}`;
  if (prev === null) return null;
  const [row] = await sql<Array<{ enc_text: string; through_seq: number }>>`
    select enc_text, through_seq from case_memories where case_id = ${session.case_id}`;
  if (row && row.through_seq === prev) return decryptText(row.enc_text);
  const fresh = await refreshCaseMemory(session.case_id, actorId, 'draft_request', { beforeSeq: session.seq });
  return fresh?.text ?? null;
}

/** 회차의 현재 초안. 마지막 행이 현재 상태다. */
export async function latestDraft(sessionId: number): Promise<Draft | null> {
  const [row] = await sql<Draft[]>`
    select id, session_id, status, summary, changes, tasks, questions, fact_changes, evidence, omissions, omitted_minor_count, mask_hits, model, created_by, created_at
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
      insert into ai_drafts (session_id, status, summary, changes, tasks, questions, fact_changes, evidence, omissions, omitted_minor_count, mask_hits, model, created_by, approved_by)
      values (${sessionId}, 'approved', ${summary}, ${sql.json(changes)}, ${sql.json(tasks)}, ${sql.json(questions)},
              ${sql.json(current.fact_changes)}, ${sql.json(current.evidence)}, ${sql.json(current.omissions)}, ${current.omitted_minor_count},
              ${sql.json(current.mask_hits)}, ${current.model}, ${current.created_by ?? actorId}, ${actorId})
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
  // 승인이 곧 기록이다 — 이 회차까지 접은 기억이 다음 회차 초안의 입력이 된다.
  refreshCaseMemoryInBackground(session.case_id, actorId, 'approve_draft');

  return { ...current, id: row.id, status: 'approved', summary, changes, tasks, questions, created_at: row.created_at };
}
