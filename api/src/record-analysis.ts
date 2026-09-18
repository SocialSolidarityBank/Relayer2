// v6 상담기록 분석 오케스트레이션(2026-09-18 Q). 순수 규칙은 domain/ 에 있고
// 여기는 DB·LLM·원문 조회·저장만 한다 — domain/mismatch.ts 와 service.ts 의 분리 관례 그대로.
//
// 순서가 곧 규칙이다(ai.ts 와 같다):
//   동의 확인 → 원문 문서·span 고정 → 마스킹 → 외부 호출 → 검증 → **초안 저장** → 사람이 승인해야 기록
//
// 원칙(domain/record-analysis.ts 헤더와 같다):
//   · 원문은 저장소(memo·manual 카드·intake detail·transcripts)에서만 읽는다.
//   · 현재 회차만 본다 — 지난 회차·브리핑·다음 회차 자료는 입력에도 결과에도 없다(T08·T16).
//   · 사실의 근거는 수기(w:)뿐. 전사(t:)는 연결·대조만 한다(T19).
import { createHash } from 'node:crypto';
import { assertConsent, replaceAiCards, approvedSummaries } from './service.ts';
import { AI_PROVIDERS, type AiProviderId } from './consent.ts';
import { audit } from './audit.ts';
import { sql } from './db.ts';
import { maskText, type MaskSubject } from './domain/masking.ts';
import { decryptJson, decryptPii, decryptText, encryptText } from './pii.ts';
import { callModel, AiUnavailable } from './ai.ts';
import { validateStructuredRecord } from './domain/structured-record.ts';
import { validateSessionSummary } from './domain/session-summary.ts';
import { validateTranscriptLinks } from './domain/transcript-links.ts';
import {
  ANALYSIS_RULE_VERSION,
  ANALYSIS_SCHEMA_VERSION,
  checkReferences,
  forbiddenWordsIn,
  INTAKE_FREE_TEXT_KEYS,
  LLM_ANALYSIS_JSON_SCHEMA_NAME,
  LlmAnalysisSchema,
  spansOf,
  type AnalysisBody,
  type AnalysisRevision,
  type AnalysisView,
  type ApproveBody,
  type Backlink,
  type Keyword,
  type LlmAnalysis,
  type SessionAiSummary,
  type SourceDocument,
  type SourceKind,
  type SourceSpan,
  type SourceVersions,
} from './domain/record-analysis.ts';
import type { Card, Session } from './domain/types.ts';

/** 승인 시점의 초안·원본이 화면이 본 것과 다르다. 라우트는 409 로 답한다(T28). */
export class AnalysisConflict extends Error {}
/** 승인 전 편집이 검증을 통과하지 못했다. 라우트는 400 으로 답한다. */
export class AnalysisInvalid extends Error {}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

// 카드 종류 → 팝업 수기 열 제목(ai.ts SECTION_LABEL 과 같은 말). 원문 건수에 섞이지 않게 label 로만 쓴다.
const CARD_LABEL: Record<Card['kind'], string> = {
  promise: '수행할 과제',
  question: '다음에 물어볼 것',
  judgment: '실무자 의견',
  fact: '확인한 사실',
};

// 인테이크 자유 글 키 → 문항 제목(web/src/intake-questions.ts 의 label 과 같다).
const INTAKE_LABEL: Record<(typeof INTAKE_FREE_TEXT_KEYS)[number], string> = {
  welfare_other: '기타 공적급여',
  contact_caution: '연락 시 주의사항',
  application_reason_detail: '신청 배경',
  previous_support_detail: '다른 기관에서 받았거나 신청한 지원',
  strength_detail: '강점과 도와줄 사람',
  reference_memo: '참고 메모',
};

type TranscriptInfo = {
  id: number;
  status: 'draft' | 'approved';
  text: string;
  segments?: Array<{ text: string; offset_ms: number; duration_ms: number }>;
  recordings_without_transcript: number;
};

/** 회차의 마지막 전사 행. 승인된 것만 분석 재료가 되고, 초안은 상태만 화면에 알린다(사람 확인 게이트 유지). */
async function latestTranscriptInfo(sessionId: number): Promise<TranscriptInfo | null> {
  const [row] = await sql<Array<{ id: number; status: 'draft' | 'approved'; text: string; segments: string | null }>>`
    select id, status, text, segments from transcripts where session_id = ${sessionId} order by id desc limit 1`;
  const [{ recordings }] = await sql<Array<{ recordings: number }>>`
    select count(*)::int as recordings from recordings where session_id = ${sessionId} and deleted_at is null`;
  if (!row) return null;
  let segments: TranscriptInfo['segments'];
  const packed = row.segments ? decryptText(row.segments) : null;
  if (packed) {
    try {
      const parsed = JSON.parse(packed) as TranscriptInfo['segments'];
      if (Array.isArray(parsed)) segments = parsed;
    } catch {
      segments = undefined;
    }
  }
  return {
    id: row.id,
    status: row.status,
    text: decryptText(row.text) ?? '',
    segments,
    recordings_without_transcript: recordings - 1,
  };
}

/**
 * 한 회차의 수기 원본 문서 묶음(Q 19). 일반 회차 = memo + manual 카드 4종(id 순),
 * 첫상담은 여기에 detail 자유 글 키를 문항 순으로 덧붙인다. ai_approved 카드·목표 텍스트는 원문이 아니다.
 * 빈 텍스트는 문서가 아니다 — 없는 문서의 span 은 만들 수 없다.
 */
export async function sourceDocuments(session: Session): Promise<SourceDocument[]> {
  const docs: SourceDocument[] = [];
  const push = (id: string, kind: SourceKind, label: string, text: string | null) => {
    if (!text?.trim()) return;
    docs.push({ id, kind, label, text, hash: sha256(text), order: docs.length });
  };

  push('memo', 'memo', '상담 내용', decryptText(session.memo));

  const cards = await sql<Card[]>`
    select * from cards where source_session_id = ${session.id} and source_type = 'manual' order by id`;
  for (const card of cards) {
    push(`card:${card.id}`, `card:${card.kind}` as SourceKind, CARD_LABEL[card.kind], decryptText(card.text));
  }

  if (session.kind === 'intake') {
    const detail = decryptJson(session.detail);
    for (const key of INTAKE_FREE_TEXT_KEYS) {
      const value = detail[key];
      push(`intake:${key}`, 'intake', INTAKE_LABEL[key], typeof value === 'string' ? value : null);
    }
  }
  return docs;
}

/**
 * 전사 문서와 span. **마지막 행이 approved 일 때만** 문서가 된다 — 초안 전사는 사람 확인 전이라
 * 연결·대조 재료로 쓰지 않는다. segments 가 본문을 덮고 문장 수가 맞을 때만 시각을 붙인다 —
 * 어긋나면 null 로 둔다. 가짜 시각을 만들지 않는다(T05).
 */
function transcriptDocument(info: TranscriptInfo): { doc: SourceDocument; spans: SourceSpan[] } | null {
  if (info.status !== 'approved' || !info.text.trim()) return null;
  const doc: SourceDocument = {
    id: `transcript:${info.id}`,
    kind: 'transcript',
    label: '녹음 전사',
    text: info.text,
    hash: sha256(info.text),
    order: 0,
  };
  const spans = spansOf('t', String(info.id), info.text, doc.id);
  const segments = info.segments;
  if (segments && segments.length === spans.length) {
    const joined = segments.map((s) => s.text).join('');
    const body = spans.map((s) => info.text.slice(s.start, s.end)).join('');
    if (joined === body) {
      spans.forEach((s, i) => {
        s.offset_ms = segments[i].offset_ms;
        s.duration_ms = segments[i].duration_ms;
      });
    }
  }
  return { doc, spans };
}

/** 분석이 본 원본 버전 묶음. 현재 값과 하나라도 다르면 stale(T16·T28). */
export function sourceVersions(
  docs: SourceDocument[],
  transcriptId: number | null,
): SourceVersions {
  const cards: SourceVersions['cards'] = [];
  let memo_hash: string | null = null;
  const intakeTexts: string[] = [];
  for (const doc of docs) {
    if (doc.id === 'memo') memo_hash = doc.hash;
    else if (doc.id.startsWith('card:')) cards.push({ id: Number(doc.id.slice(5)), hash: doc.hash });
    else if (doc.id.startsWith('intake:')) intakeTexts.push(doc.text);
  }
  return {
    memo_hash,
    cards,
    intake_hash: intakeTexts.length > 0 ? sha256(intakeTexts.join('\n')) : null,
    transcript_id: transcriptId,
  };
}

// jsonb 는 키 순서를 보존하지 않는다 — 문자열 비교가 아니라 값 비교다.
const sameVersions = (a: SourceVersions, b: SourceVersions): boolean =>
  a.memo_hash === b.memo_hash &&
  a.intake_hash === b.intake_hash &&
  a.transcript_id === b.transcript_id &&
  a.cards.length === b.cards.length &&
  a.cards.every((c, i) => c.id === b.cards[i]?.id && c.hash === b.cards[i]?.hash);

/** 당사자 금고 값 — 마스킹의 ①축. ai.ts draftSession 과 같은 조회다. */
async function maskSubject(caseId: number): Promise<MaskSubject> {
  const [participant] = await sql<
    Array<{ pseudonym: string; enc_name: string | null; enc_phone: string | null; enc_email: string | null }>
  >`
    select p.pseudonym, v.enc_name, v.enc_phone, v.enc_email
    from support_cases c
    join participants p on p.id = c.participant_id
    left join participant_pii v on v.participant_id = p.id
    where c.id = ${caseId}`;
  return {
    pseudonym: participant.pseudonym,
    name: decryptPii(participant.enc_name),
    phone: decryptPii(participant.enc_phone),
    email: decryptPii(participant.enc_email),
  };
}

const SYSTEM_V6 = [
  '너는 한국 사회복지 상담 기록을 정리하는 도구다.',
  '',
  '입력은 **이번 회차**의 수기 문장(span ID 가 붙은 것)과 목표, 그리고 보조 자료인 녹음 전사뿐이다.',
  '지난 회차·다음 회차·브리핑 자료는 없다 — 있는 것처럼 쓰지 않는다.',
  '',
  '반드시 지킨다:',
  '- 사실의 근거는 수기(w:)뿐이다. 전사(t:)는 수기 문장과의 연결·불일치 대조에만 쓴다.',
  '  전사에만 있는 말로 새 사실·변화·완료·상태를 만들지 않는다.',
  '- 원문 어휘를 그대로 쓴다. 노력→시도, 상담→멘토링 같은 치환은 실패다.',
  '- 변화(change)는 같은 회차의 전(before)·후(after) span 이 둘 다 있을 때만 단다.',
  '  전후를 못 찾으면 요약의 `상담 중 새로 드러난 것` 에서 summary_only_exception=true 로만 남긴다.',
  '- 약속 이행 여부는 약속 span 과 결과 span 이 둘 다 있을 때만 쓴다.',
  '  새로운 가능성은 변화 span 에 이어지는 합의·계획 span 이 있을 때만 쓴다.',
  '  `하기로 함`·`예정`은 완료가 아니다. 실제로 끝난 증거가 있을 때만 완료다.',
  '- 불일치는 같은 대상·같은 속성·같은 시기·양립 불가 네 조건이 모두 맞을 때만 단다.',
  '  숫자만 다르거나, 한쪽에만 있거나, 말이 다를 뿐인 것은 불일치가 아니다.',
  '- `실무자:`·`당사자:` 대사는 원문에 그 말이 그대로 있을 때만 쓴다.',
  '- span ID 만 참조하고 원문을 통째로 복제하지 않는다(짧은 인용은 허용).',
  '- 대괄호 자리표([otter-001], [연락처])는 그대로 둔다. 추측해 채우지 않는다.',
  '- 모르면 비운다. 없는 것을 지어내지 않는다.',
  '',
  '무엇이 먼저인가: `이번 상담의 핵심` 은 목표(전체·이번 회차)와의 관련성이 1순위다.',
  '시간 흐름이 모호한 단락을 묶을 때도 목표 관련성으로 묶는다.',
].join('\n');

/**
 * OpenAI json_schema(strict) 용 스키마. LlmAnalysisSchema 와 같은 모양이어야 한다 —
 * strict 는 모든 필드를 required 로 요구하므로 선택 필드는 nullable 로 둔다(서버가 zod 로 다시 검증한다).
 */
const LLM_ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['record', 'summary', 'links', 'discrepancies', 'keywords', 'tasks', 'questions'],
  properties: {
    record: {
      type: 'object',
      additionalProperties: false,
      required: ['topics', 'paragraphs', 'annotations'],
      properties: {
        topics: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'title', 'paragraph_ids'],
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              paragraph_ids: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        paragraphs: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'title', 'spans'],
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              spans: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        annotations: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['span', 'status', 'before', 'after'],
            properties: {
              span: { type: 'string' },
              status: { type: 'string', enum: ['change', 'follow_up', 'completed'] },
              before: { type: ['array', 'null'], items: { type: 'string' } },
              after: { type: ['array', 'null'], items: { type: 'string' } },
            },
          },
        },
      },
    },
    summary: {
      type: 'object',
      additionalProperties: false,
      required: ['core', 'changes', 'follow_up', 'completed'],
      properties: {
        core: { $ref: '#/$defs/summaryItems' },
        changes: {
          type: 'object',
          additionalProperties: false,
          required: ['promise_result', 'newly_revealed', 'new_possibility'],
          properties: {
            promise_result: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['promise', 'result', 'promise_spans', 'result_spans', 'changes', 'conclusion', 'goal'],
                properties: {
                  promise: { type: 'string' },
                  result: { type: 'string' },
                  promise_spans: { type: 'array', items: { type: 'string' } },
                  result_spans: { type: 'array', items: { type: 'string' } },
                  changes: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['before', 'after', 'meaning'],
                      properties: {
                        before: { type: 'string' },
                        after: { type: 'string' },
                        meaning: { type: ['string', 'null'] },
                      },
                    },
                  },
                  conclusion: { type: ['string', 'null'] },
                  goal: { type: ['string', 'null'], enum: ['overall', 'session', null] },
                },
              },
            },
            newly_revealed: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['dialogue', 'mode', 'lines', 'spans', 'summary_only_exception', 'goal'],
                properties: {
                  dialogue: {
                    type: ['object', 'null'],
                    additionalProperties: false,
                    required: ['worker', 'participant'],
                    properties: {
                      worker: { type: ['string', 'null'] },
                      participant: { type: ['string', 'null'] },
                    },
                  },
                  mode: { type: 'string', enum: ['change', 'confirmed'] },
                  lines: { type: 'array', items: { type: 'string' } },
                  spans: { type: 'array', items: { type: 'string' } },
                  summary_only_exception: { type: 'boolean' },
                  goal: { type: ['string', 'null'], enum: ['overall', 'session', null] },
                },
              },
            },
            new_possibility: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['dialogue', 'lines', 'change_spans', 'plan_spans', 'goal'],
                properties: {
                  dialogue: {
                    type: ['object', 'null'],
                    additionalProperties: false,
                    required: ['worker', 'participant'],
                    properties: {
                      worker: { type: ['string', 'null'] },
                      participant: { type: ['string', 'null'] },
                    },
                  },
                  lines: { type: 'array', items: { type: 'string' } },
                  change_spans: { type: 'array', items: { type: 'string' } },
                  plan_spans: { type: 'array', items: { type: 'string' } },
                  goal: { type: ['string', 'null'], enum: ['overall', 'session', null] },
                },
              },
            },
          },
        },
        follow_up: { $ref: '#/$defs/summaryItems' },
        completed: { $ref: '#/$defs/summaryItems' },
      },
    },
    links: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['transcript_span', 'written_spans', 'match'],
        properties: {
          transcript_span: { type: 'string' },
          written_spans: { type: 'array', items: { type: 'string' } },
          match: { type: 'string', enum: ['match', 'uncertain'] },
        },
      },
    },
    discrepancies: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['transcript_span', 'written_spans', 'paragraph_id', 'difference', 'conditions'],
        properties: {
          transcript_span: { type: 'string' },
          written_spans: { type: 'array', items: { type: 'string' } },
          paragraph_id: { type: 'string' },
          difference: { type: 'string' },
          conditions: {
            type: 'object',
            additionalProperties: false,
            required: ['same_subject', 'same_attribute', 'same_time', 'incompatible'],
            properties: {
              same_subject: { type: 'boolean' },
              same_attribute: { type: 'boolean' },
              same_time: { type: 'boolean' },
              incompatible: { type: 'boolean' },
            },
          },
        },
      },
    },
    keywords: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'spans'],
        properties: {
          text: { type: 'string' },
          spans: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    tasks: { type: 'array', items: { type: 'string' } },
    questions: { type: 'array', items: { type: 'string' } },
  },
  $defs: {
    summaryItems: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'spans', 'goal'],
        properties: {
          text: { type: 'string' },
          spans: { type: 'array', items: { type: 'string' } },
          goal: { type: ['string', 'null'], enum: ['overall', 'session', null] },
        },
      },
    },
  },
} as const;

// strict 스키마에서 선택 필드는 nullable 로 선언했다 — 모델이 null 을 돌려주면
// zod 의 optional 과 어긋나므로 파싱 전에 지운다. `goal` 은 진짜 nullable 이라 건드리지 않는다.
const NULLABLE_OPTIONAL_KEYS: Record<string, true> = {
  before: true, after: true, conclusion: true, meaning: true, dialogue: true, worker: true, participant: true,
};
function stripNulls(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) stripNulls(item);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, v] of Object.entries(value)) {
      if (v === null && NULLABLE_OPTIONAL_KEYS[key]) delete (value as Record<string, unknown>)[key];
      else stripNulls(v);
    }
  }
}

/** span ID → 원문 문장. 검증기·키워드 검사가 같은 함수를 쓴다. */
function spanTextResolver(docs: SourceDocument[], spans: SourceSpan[]): (spanId: string) => string {
  const byDoc = new Map(docs.map((d) => [d.id, d.text]));
  const byId = new Map(spans.map((s) => [s.id, s]));
  return (spanId) => {
    const span = byId.get(spanId);
    // t: span 의 doc 자리는 전사 id 그대로다(t:44:3 → 44). 문서 id 는 transcript:44.
    const text = span ? (byDoc.get(span.doc) ?? byDoc.get(`transcript:${span.doc}`)) : undefined;
    return span && text !== undefined ? text.slice(span.start, span.end) : '';
  };
}

/** 실패 사유는 사람이 읽는 명사구다 — 원문·모델 응답을 담지 않는다. */
function summarizeProblems(problems: Array<{ where: string; reason: string }>): string {
  const LABEL: Record<string, string> = {
    unknown_span: '원문 범위 밖 참조',
    not_written: '수기 아닌 span 참조',
    not_transcript: '전사 아닌 span 참조',
    schema: '응답 형식 오류',
  };
  const first = problems[0];
  const label = first ? (LABEL[first.reason] ?? '검증 실패') : '검증 실패';
  return `${label} ${problems.length}건`;
}

type AnalysisRow = {
  id: number;
  session_id: number;
  status: 'draft' | 'approved' | 'failed';
  schema_version: number;
  rule_version: string;
  source_versions: SourceVersions;
  model: string | null;
  mask_hits: Record<string, number>;
  body: string | null;
  error: string | null;
  created_by: number | null;
  approved_by: number | null;
  created_at: string;
};

const ANALYSIS_COLUMNS = sql([
  'id', 'session_id', 'status', 'schema_version', 'rule_version', 'source_versions',
  'model', 'mask_hits', 'body', 'error', 'created_by', 'approved_by', 'created_at',
]);

const toRevision = (row: AnalysisRow): AnalysisRevision => ({
  ...row,
  body: row.body ? (JSON.parse(decryptText(row.body) ?? 'null') as AnalysisBody) : null,
});

/** 회차의 현재 분석. 마지막 행이 현재 상태다(ai_drafts·transcripts 와 같은 규칙). */
export async function latestAnalysis(sessionId: number): Promise<AnalysisRevision | null> {
  const [row] = await sql<AnalysisRow[]>`
    select ${ANALYSIS_COLUMNS} from record_analyses where session_id = ${sessionId} order by id desc limit 1`;
  return row ? toRevision(row) : null;
}

/** 마지막 행이 승인일 때만 낸다 — 새 초안이 쌓이면 이전 승인본으로 조용히 되돌아가지 않는다. */
export async function approvedAnalysis(sessionId: number): Promise<AnalysisRevision | null> {
  const found = await latestAnalysis(sessionId);
  return found?.status === 'approved' ? found : null;
}

/**
 * 한 회차의 v6 초안을 만든다. 저장된 원문만 쓰고, 보내기 전에 문장마다 마스킹한다.
 * 검증(참조·구조·요약·전사 규칙)을 하나라도 못 넘으면 failed 행으로 남긴다 — 화면은 원문만 보인다(T29).
 */
export async function draftAnalysis(sessionId: number, actorId: number): Promise<AnalysisRevision> {
  const [session] = await sql<Session[]>`select * from sessions where id = ${sessionId}`;
  if (!session) throw new Error('회차 없음');
  await assertConsent(session.case_id, 'external_llm_cross_border_processing');

  const subject = await maskSubject(session.case_id);
  const docs = await sourceDocuments(session);
  if (docs.length === 0) throw new AiUnavailable('정리할 내용 없음, 상담 내용 먼저 입력');

  const transcript = await latestTranscriptInfo(sessionId);
  const tdoc = transcript ? transcriptDocument(transcript) : null;

  const writtenSpans = docs.flatMap((d) => spansOf('w', d.id, d.text));
  const spans = [...writtenSpans, ...(tdoc?.spans ?? [])];
  const versions = sourceVersions(docs, tdoc ? transcript!.id : null);

  // 문장마다 가린다 — 문서 통째로 가리면 자리표가 문장 경계를 지운다.
  const hits: Record<string, number> = {};
  const maskedLine = (spanId: string, text: string): string => {
    const masked = maskText(text, subject);
    for (const [kind, n] of Object.entries(masked.hits)) hits[kind] = (hits[kind] ?? 0) + n;
    return `[${spanId}] ${masked.text}`;
  };

  const [supportCase] = await sql<Array<{ overall_goal: string | null }>>`
    select overall_goal from support_cases where id = ${session.case_id}`;
  const overallGoal = decryptText(supportCase?.overall_goal ?? null);
  const todayGoal = decryptText(session.today_goal_text);
  // 목표도 밖으로 나가는 글이다 — 같은 방식으로 가린다.
  const maskedGoal = (text: string | null) => {
    if (!text?.trim()) return null;
    const masked = maskText(text, subject);
    for (const [kind, n] of Object.entries(masked.hits)) hits[kind] = (hits[kind] ?? 0) + n;
    return masked.text;
  };

  const prompt = [
    `${session.seq}회차 상담 자료다. 아래 수기 문장만이 사실의 근거다.`,
    '',
    '## 전체 상담 목표',
    maskedGoal(overallGoal) ?? '(없음)',
    '',
    '## 이번 회차 목표',
    maskedGoal(todayGoal) ?? '(없음)',
    '',
    ...docs.flatMap((doc) => [
      `## ${doc.label}`,
      ...spansOf('w', doc.id, doc.text).map((s) => maskedLine(s.id, doc.text.slice(s.start, s.end))),
      '',
    ]),
    ...(tdoc
      ? [
          '## 녹음 전사 (보조 자료)',
          ...tdoc.spans.map((s) => maskedLine(s.id, tdoc.doc.text.slice(s.start, s.end))),
        ]
      : []),
  ].join('\n');

  const PROVIDER = (process.env.AI_PROVIDER ?? 'openai') as AiProviderId;
  const MODEL = process.env.AI_MODEL ?? (PROVIDER === 'gemini' ? 'gemini-flash-latest' : 'gpt-5.5');

  const insertFailed = async (error: string): Promise<AnalysisRevision> => {
    const [row] = await sql<AnalysisRow[]>`
      insert into record_analyses (session_id, status, schema_version, rule_version, source_versions, model, mask_hits, error, created_by)
      values (${sessionId}, 'failed', ${ANALYSIS_SCHEMA_VERSION}, ${ANALYSIS_RULE_VERSION},
              ${sql.json(versions)}, ${MODEL}, ${sql.json(hits)}, ${error}, ${actorId})
      returning ${ANALYSIS_COLUMNS}`;
    return toRevision(row);
  };

  let analysis: LlmAnalysis;
  try {
    const raw = await callModel<unknown>({
      system: SYSTEM_V6,
      prompt,
      schema: LLM_ANALYSIS_JSON_SCHEMA,
      name: LLM_ANALYSIS_JSON_SCHEMA_NAME,
      stubKey: String(session.seq),
    });
    stripNulls(raw);
    const parsed = LlmAnalysisSchema.safeParse(raw);
    if (!parsed.success) {
      return await finish(insertFailed(`응답 형식 오류 ${parsed.error.issues.length}건`));
    }
    analysis = parsed.data;
  } catch (error) {
    if (error instanceof AiUnavailable) throw error;
    return await finish(insertFailed('모델 호출 실패'));
  }

  // 참조 검증 — 회차 밖 span·수기 자리의 전사 span 은 그 자리에서 실패다(T23·T29).
  const textOf = spanTextResolver(tdoc ? [...docs, tdoc.doc] : docs, spans);
  const referenceProblems = checkReferences(analysis, spans);
  const problems =
    referenceProblems.length > 0
      ? referenceProblems
      : [
          ...validateStructuredRecord(analysis, spans, textOf),
          ...validateSessionSummary(analysis, spans, textOf),
          ...validateTranscriptLinks(analysis, spans, textOf),
        ];
  if (problems.length > 0) {
    return await finish(insertFailed(summarizeProblems(problems)));
  }

  // 키워드는 서버가 만든다 — 목표·수기 과제·질문 카드는 결정적, 모델 것은 참조 원문에
  // 그 문자열이 있을 때만 산다(Q 4).
  const keywords: Keyword[] = [];
  const goalKeyword = (text: string | null) => {
    if (!text?.trim()) return;
    const token = text.trim().split(/\s+/).find((t) => t.length >= 2);
    const hit = token
      ? writtenSpans.filter((s) => textOf(s.id).includes(token)).map((s) => s.id)
      : [];
    keywords.push({ text: text.trim(), source: 'deterministic', spans: hit });
  };
  goalKeyword(overallGoal);
  goalKeyword(todayGoal);
  for (const doc of docs) {
    if (doc.kind !== 'card:promise' && doc.kind !== 'card:question') continue;
    keywords.push({
      text: doc.text.trim(),
      source: 'deterministic',
      spans: spansOf('w', doc.id, doc.text).map((s) => s.id),
    });
  }
  for (const k of analysis.keywords) {
    const referenced = k.spans.map((id) => textOf(id)).join('\n');
    if (referenced.includes(k.text)) keywords.push({ text: k.text, source: 'llm', spans: k.spans });
  }

  const body: AnalysisBody = {
    schema_version: ANALYSIS_SCHEMA_VERSION,
    rule_version: ANALYSIS_RULE_VERSION,
    documents: (tdoc ? [...docs, tdoc.doc] : docs).map(({ text: _text, ...rest }) => rest),
    spans,
    record: analysis.record,
    summary: analysis.summary,
    links: analysis.links,
    discrepancies: analysis.discrepancies,
    keywords,
    tasks: analysis.tasks,
    questions: analysis.questions,
    summary_override: null,
  };

  const [row] = await sql<AnalysisRow[]>`
    insert into record_analyses (session_id, status, schema_version, rule_version, source_versions, model, mask_hits, body, created_by)
    values (${sessionId}, 'draft', ${ANALYSIS_SCHEMA_VERSION}, ${ANALYSIS_RULE_VERSION},
            ${sql.json(versions)}, ${MODEL}, ${sql.json(hits)}, ${encryptText(JSON.stringify(body))}, ${actorId})
    returning ${ANALYSIS_COLUMNS}`;
  return await finish(toRevision(row));

  // 무엇을 몇 건 마스킹해 **어디로** 보냈는지 남긴다. 보낸 원문은 남기지 않는다(ai.ts 와 같은 규칙).
  async function finish(revisionPromise: Promise<AnalysisRevision> | AnalysisRevision): Promise<AnalysisRevision> {
    const revision = await revisionPromise;
    await audit({
      actorId,
      action: 'ai.draft',
      caseId: session.case_id,
      fields: [
        `recipient=${AI_PROVIDERS[PROVIDER].legalRecipient}`,
        `country=${AI_PROVIDERS[PROVIDER].country}`,
        `model=${MODEL}`,
        ...(PROVIDER === 'openai' ? ['store=false'] : []),
        ...Object.entries(hits).map(([kind, n]) => `masked:${kind}=${n}`),
      ],
    });
    return revision;
  }
}

/**
 * 승인. 화면이 본 초안(draft_id)과 원본 묶음(source_versions)이 지금과 같을 때만 된다(T28).
 * 승인이 곧 기록이다 — 과제·질문은 같은 트랜잭션에서 ai_approved 카드가 된다(approveDraft 와 같다).
 */
export async function approveAnalysis(
  sessionId: number,
  actorId: number,
  body: ApproveBody,
): Promise<AnalysisRevision> {
  const [session] = await sql<Session[]>`select * from sessions where id = ${sessionId}`;
  if (!session) throw new Error('회차 없음');
  const current = await latestAnalysis(sessionId);
  if (!current || current.status !== 'draft' || current.id !== body.draft_id || !current.body) {
    throw new AnalysisConflict('새 초안 도착, 다시 확인 후 승인');
  }

  const docs = await sourceDocuments(session);
  const transcript = await latestTranscriptInfo(sessionId);
  const tdoc = transcript ? transcriptDocument(transcript) : null;
  const now = sourceVersions(docs, tdoc ? transcript!.id : null);
  if (!sameVersions(now, body.source_versions) || !sameVersions(now, current.source_versions)) {
    throw new AnalysisConflict('원본 바뀜, AI 정리 다시 하기');
  }

  const summary = body.edits?.summary ?? current.body.summary;
  const tasks = body.edits?.tasks ?? current.body.tasks;
  const questions = body.edits?.questions ?? current.body.questions;

  // 사람이 고친 문구도 같은 검증을 지난다 — span 은 잠금이라 요약만 다시 본다.
  if (body.edits) {
    const allDocs = tdoc ? [...docs, tdoc.doc] : docs;
    const spans = current.body.spans;
    const textOf = spanTextResolver(allDocs, spans);
    const problems = validateSessionSummary(
      {
        record: current.body.record,
        summary,
        links: current.body.links,
        discrepancies: current.body.discrepancies,
        keywords: current.body.keywords,
        tasks,
        questions,
      },
      spans,
      textOf,
    );
    const writtenText = docs.map((d) => d.text).join('\n');
    const forbidden = [
      ...tasks.flatMap((t) => forbiddenWordsIn(t, writtenText)),
      ...questions.flatMap((q) => forbiddenWordsIn(q, writtenText)),
    ];
    if (problems.length > 0 || forbidden.length > 0) {
      throw new AnalysisInvalid('수정한 요약이 규칙을 벗어남');
    }
  }

  const approvedBody: AnalysisBody = {
    ...current.body,
    summary,
    tasks,
    questions,
  };

  const row = await sql.begin(async (tx) => {
    const [inserted] = await tx<AnalysisRow[]>`
      insert into record_analyses
        (session_id, status, schema_version, rule_version, source_versions, model, mask_hits, body, created_by, approved_by)
      values (${sessionId}, 'approved', ${approvedBody.schema_version}, ${approvedBody.rule_version},
              ${tx.json(current.source_versions)}, ${current.model}, ${tx.json(current.mask_hits)},
              ${encryptText(JSON.stringify(approvedBody))}, ${current.created_by ?? actorId}, ${actorId})
      returning ${ANALYSIS_COLUMNS}`;
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
    fields: [`draft=${current.id}`, body.edits ? 'edited=yes' : 'edited=no'],
  });

  return toRevision(row);
}


/** 원본 팝업·검토 화면의 재료. 원문 텍스트는 여기서만 온다 — 분석 본문에는 hash·좌표만 있다. */
export async function analysisView(sessionId: number): Promise<AnalysisView> {
  const [session] = await sql<Session[]>`select * from sessions where id = ${sessionId}`;
  if (!session) throw new Error('회차 없음');
  const docs = await sourceDocuments(session);
  const transcript = await latestTranscriptInfo(sessionId);
  const tdoc = transcript ? transcriptDocument(transcript) : null;
  const documents = tdoc ? [...docs, tdoc.doc] : docs;
  const spans = [
    ...docs.flatMap((d) => spansOf('w', d.id, d.text)),
    ...(tdoc?.spans ?? []),
  ];
  const analysis = await approvedAnalysis(sessionId);
  const stale = analysis
    ? !sameVersions(sourceVersions(docs, tdoc ? transcript!.id : null), analysis.source_versions)
    : false;
  return {
    session_id: sessionId,
    analysis,
    documents,
    spans,
    transcript: transcript
      ? { id: transcript.id, status: transcript.status, recordings_without_transcript: transcript.recordings_without_transcript }
      : null,
    stale,
  };
}

/**
 * 키워드 백링크(Q 5·11). 같은 사례의 승인 분석(회차별 마지막 승인)에서 그 키워드의 span 을 모아
 * 회차 순으로 낸다. span 텍스트는 **지금** 원본에서 읽는다 — 분석 뒤 원본이 바뀌었어도 보이는 것은 현재 문장이다.
 */
export async function backlinks(caseId: number, keyword: string): Promise<Backlink[]> {
  const rows = await sql<Array<AnalysisRow & { seq: number }>>`
    select distinct on (a.session_id) a.id, a.session_id, a.status, a.schema_version, a.rule_version,
           a.source_versions, a.model, a.mask_hits, a.body, a.error, a.created_by, a.approved_by, a.created_at, s.seq
    from record_analyses a join sessions s on s.id = a.session_id
    where s.case_id = ${caseId} order by a.session_id, a.id desc`;
  const out: Backlink[] = [];
  for (const row of rows) {
    if (row.status !== 'approved' || !row.body) continue;
    const body = JSON.parse(decryptText(row.body) ?? 'null') as AnalysisBody;
    const hits = body.keywords.filter((k) => k.text === keyword).flatMap((k) => k.spans);
    if (hits.length === 0) continue;
    const [session] = await sql<Session[]>`select * from sessions where id = ${row.session_id}`;
    const docs = await sourceDocuments(session);
    const transcript = await latestTranscriptInfo(row.session_id);
    const tdoc = transcript ? transcriptDocument(transcript) : null;
    const textOf = spanTextResolver(tdoc ? [...docs, tdoc.doc] : docs, body.spans);
    const spanById = new Map(body.spans.map((s) => [s.id, s]));
    const paragraphOf = new Map(
      body.record.paragraphs.flatMap((p) => p.spans.map((s) => [s, p.id] as const)),
    );
    for (const spanId of hits) {
      const text = textOf(spanId);
      if (!text) continue;
      out.push({
        session_id: row.session_id,
        seq: row.seq,
        span_id: spanId,
        paragraph_id: paragraphOf.get(spanId) ?? null,
        text,
      });
    }
    out.sort((a, b) => {
      if (a.seq !== b.seq) return a.seq - b.seq;
      const sa = spanById.get(a.span_id);
      const sb = spanById.get(b.span_id);
      return (sa?.order ?? 0) - (sb?.order ?? 0);
    });
  }
  return out;
}

/** 회차 카드에 싣는 요약. v6 승인이 있으면 그것, 없고 구버전 승인만 있으면 legacy 다. */
export async function sessionAiSummaries(sessionIds: number[]): Promise<Record<number, SessionAiSummary>> {
  if (sessionIds.length === 0) return {};
  const rows = await sql<AnalysisRow[]>`
    select distinct on (session_id) ${ANALYSIS_COLUMNS}
    from record_analyses where session_id in ${sql(sessionIds)} order by session_id, id desc`;
  const out: Record<number, SessionAiSummary> = {};
  const legacyIds: number[] = [];
  for (const row of rows) {
    if (row.status === 'approved' && row.body) {
      const body = JSON.parse(decryptText(row.body) ?? 'null') as AnalysisBody;
      out[row.session_id] = {
        kind: 'v6',
        analysis_id: row.id,
        summary: body.summary,
        keywords: body.keywords,
        override: body.summary_override,
      };
    } else {
      legacyIds.push(row.session_id);
    }
  }
  // 분석 행이 한 번도 없는 회차도 구버전 승인이 있을 수 있다.
  const missing = sessionIds.filter((id) => !rows.some((r) => r.session_id === id));
  const legacy = await approvedSummaries([...legacyIds, ...missing]);
  for (const [id, summary] of Object.entries(legacy)) {
    out[Number(id)] = { kind: 'legacy', summary: summary.summary };
  }
  return out;
}

/**
 * v6 stale — 분석이 본 원본 묶음과 지금 원본이 하나라도 다르면 true(T16·T28).
 * 마지막 행이 approved 인 회차만 낸다. 그 외 회차는 service.staleFlags 의 구버전 규칙이 본다.
 */
export async function v6StaleFlags(sessionIds: number[]): Promise<Record<number, boolean>> {
  if (sessionIds.length === 0) return {};
  const rows = await sql<Array<{ session_id: number; status: string; source_versions: SourceVersions }>>`
    select distinct on (session_id) session_id, status, source_versions
    from record_analyses where session_id in ${sql(sessionIds)} order by session_id, id desc`;
  const out: Record<number, boolean> = {};
  for (const row of rows) {
    if (row.status !== 'approved') continue;
    const [session] = await sql<Session[]>`select * from sessions where id = ${row.session_id}`;
    const docs = await sourceDocuments(session);
    const transcript = await latestTranscriptInfo(row.session_id);
    const tdoc = transcript ? transcriptDocument(transcript) : null;
    out[row.session_id] = !sameVersions(sourceVersions(docs, tdoc ? transcript!.id : null), row.source_versions);
  }
  return out;
}
