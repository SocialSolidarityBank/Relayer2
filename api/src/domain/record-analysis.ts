// v6 상담기록 분석 계약(2026-09-18 Q). 순수 타입·스키마·문장 분할·참조 검증만 있다 — DB·HTTP·LLM 없음.
//
// 원칙(docs/relayer_v1_handoff.md 부록 01·02·04·별첨):
//   · 원문은 저장소(memo·cards·intake detail·transcripts)에서만 읽는다. 모델이 돌려준 문자열을 원문 자리에 쓰지 않는다.
//   · 모든 판정은 **현재 회차** 안에서만. 지난 회차·브리핑·다음 회차 자료는 입력에도 결과에도 없다.
//   · 사실 확정의 근거는 수기(w:)뿐이다. 전사(t:)는 연결·대조·상태 상속만 한다.
//   · 상태 `change` 는 같은 회차 안의 before·after span 이 둘 다 있어야 한다. 요약 전용 예외는 플래그로만 남긴다.
//
// span ID 형식 (화면 번호가 아니라 데이터 ID다):
//   수기  `w:<doc>:<n>`   doc ∈ `memo` | `card:<cardId>` | `intake:<detailKey>`   예) w:memo:3, w:card:12:0, w:intake:reference_memo:1
//   전사  `t:<transcriptId>:<n>`                                                   예) t:44:17
//   n 은 문서 안 문장 순서(0부터). offset 은 JS UTF-16 인덱스, 문서 텍스트는 저장 문자열 그대로(정규화 없음).
//
// 라우트 계약(api/src/routes.ts, 모두 기존 sessionAccess/caseAccess 뒤):
//   POST /sessions/:id/draft                 → AnalysisRevision (status draft | failed). 제공자 없음·동의 없음은 기존 503/409.
//   GET  /sessions/:id/draft                 → AnalysisRevision | { status: 'none' }   (record_analyses 마지막 행)
//   POST /sessions/:id/draft/approve         body ApproveBody → AnalysisRevision(approved). draft_id·source_versions 불일치 409.
//   GET  /sessions/:id/analysis              → AnalysisView (승인 분석 + 원문 문서·span + 전사 + stale + legacy)
//   GET  /cases/:id/backlinks?keyword=…      → Backlink[]
//   GET  /cases/:id/detail                   sessions[].ai_summary → SessionAiSummary | null, stale.ai_summary 는 v6 면 source_versions 비교
//   POST /sessions/:id/revisions kind=summary → v6 분석이 있으면 body.summary_override 를 담은 새 approved 행
//
// 테스트 제공자: AI_PROVIDER=stub, AI_STUB_FILE=<json 경로>. 파일 모양은 StubFile. 동의·마스킹·검증은 그대로 돈다.
import { z } from 'zod';
import { EVIDENCE_GRADES, EVIDENCE_TRANSFORMS, type EvidenceGrade, type EvidenceTransform } from './types.ts';

export const ANALYSIS_SCHEMA_VERSION = 1;
export const ANALYSIS_RULE_VERSION = 'v6';


// ─── 원문 문서와 문장 span ───────────────────────────────────────────────────────

export type SourceKind = 'memo' | 'card:promise' | 'card:question' | 'card:judgment' | 'card:fact' | 'intake' | 'transcript';

/** 한 회차의 원문 한 덩어리. 화면 제목(label)과 원문(text)은 따로 둔다 — 제목이 원문 건수에 섞이면 안 된다. */
export type SourceDocument = {
  /** `memo` | `card:<id>` | `intake:<key>` | `transcript:<id>` — span ID 의 doc 자리와 같다. */
  id: string;
  kind: SourceKind;
  label: string;
  text: string;
  /** sha256(text). 저장 문자열 그대로 잰다. */
  hash: string;
  /** 팝업 수기 열 순서. memo → 카드(id 순) → intake 자유 글(문항 순). 전사는 따로. */
  order: number;
};

export type SourceSpan = {
  id: string;
  doc: string;
  /** UTF-16 [start, end). text.slice(start, end) 가 원문 문장이다. */
  start: number;
  end: number;
  /** 문서 안 순서(0부터). id 의 마지막 자리와 같다. */
  order: number;
  /** 전사 segment 가 있을 때만. 없으면 null — 가짜 시각을 만들지 않는다(T05). */
  offset_ms?: number | null;
  duration_ms?: number | null;
};

export const isTranscriptSpan = (id: string): boolean => id.startsWith('t:');
export const isWrittenSpan = (id: string): boolean => id.startsWith('w:');

/** 인테이크 detail 중 자유 글 키. 선택지·배열 값은 원문이 아니다(Q 14·19). web/src/intake-questions.ts 의 text/textarea 문항과 같다. */
export const INTAKE_FREE_TEXT_KEYS = [
  'welfare_other',
  'contact_caution',
  'application_reason_detail',
  'previous_support_detail',
  'strength_detail',
  'reference_memo',
] as const;

/**
 * 문장 분할. 결정적이고 무손실이다 — span 을 이어 붙이고 사이의 공백만 채우면 원문이 된다.
 * 줄바꿈으로 먼저 자르고, 줄 안에서는 문장 부호(. ! ? … 。) 뒤 공백에서 자른다. 부호는 앞 문장에 붙는다.
 * 공백뿐인 줄은 span 이 아니다(원문에는 남는다). 원문의 `…` 는 그대로 문장 안에 있다(T02).
 */
export function splitSentences(text: string): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  const lineRe = /[^\n]*\n?/g;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(text)) !== null) {
    if (m[0] === '') break;
    const lineStart = m.index;
    const line = m[0].replace(/\n$/, '');
    // 문장 부호 뒤 공백(또는 줄 끝)에서 자른다. 따옴표·괄호가 부호 뒤에 붙으면 함께 앞 문장에 둔다.
    const sentRe = /[^.!?…。]*(?:[.!?…。]+[”’"')\]]*|$)/g;
    let s: RegExpExecArray | null;
    let cursor = 0;
    while (cursor < line.length && (s = sentRe.exec(line)) !== null) {
      if (s[0] === '') {
        sentRe.lastIndex = cursor + 1;
        cursor += 1;
        continue;
      }
      const raw = s[0];
      const lead = raw.length - raw.trimStart().length;
      const trail = raw.length - raw.trimEnd().length;
      const start = lineStart + s.index + lead;
      const end = lineStart + s.index + raw.length - trail;
      if (end > start) out.push({ start, end });
      cursor = s.index + raw.length;
      sentRe.lastIndex = cursor;
    }
    if (m[0].endsWith('\n') === false) break;
  }
  return out;
}

/**
 * 문서 하나의 span 목록. id 는 `${prefix}:${key}:${n}`, `doc` 은 문서 id 다.
 * 수기는 key 가 곧 문서 id(`memo`·`card:12`)지만 전사는 key 가 전사 행 id(`44`)이고 문서 id 는 `transcript:44` 라
 * 따로 받는다 — 화면과 백링크는 `span.doc` 으로 원문을 찾는다(전사 행이 비어 보인 원인, 2026-09-18 e2e).
 */
export function spansOf(prefix: 'w' | 't', key: string, text: string, doc: string = key): SourceSpan[] {
  return splitSentences(text).map((r, n) => ({ id: `${prefix}:${key}:${n}`, doc, start: r.start, end: r.end, order: n }));
}

/**
 * 무손실 검사. span 을 순서대로 이어 붙였을 때 사이가 공백뿐이고 겹침·역행이 없어야 한다.
 * 화면 줄 수가 아니라 문자 단위로 잰다(§9 테스트 방법).
 */
export function coverageOf(text: string, spans: ReadonlyArray<Pick<SourceSpan, 'start' | 'end'>>): {
  ok: boolean;
  chars: number;
  covered: number;
  gaps_nonblank: number;
  overlaps: number;
} {
  let cursor = 0;
  let covered = 0;
  let gapsNonBlank = 0;
  let overlaps = 0;
  for (const s of spans) {
    if (s.start < cursor) overlaps += 1;
    else if (/\S/.test(text.slice(cursor, s.start))) gapsNonBlank += 1;
    covered += Math.max(0, s.end - Math.max(s.start, cursor));
    cursor = Math.max(cursor, s.end);
  }
  if (/\S/.test(text.slice(cursor))) gapsNonBlank += 1;
  return { ok: overlaps === 0 && gapsNonBlank === 0, chars: text.length, covered, gaps_nonblank: gapsNonBlank, overlaps };
}

// ─── 01 구조화된 상담 기록 ────────────────────────────────────────────────────────

export const STATUSES = ['change', 'follow_up', 'completed'] as const;
export type Status = (typeof STATUSES)[number];

/** 중요 문장에만 붙는다(모든 문장에 색을 칠하지 않는다). change 는 before·after 가 같은 회차 수기 span 이어야 한다. */
export type Annotation = { span: string; status: Status; before?: string[]; after?: string[] };

/** 세부 단락 = 수기 span 의 시간순 분할. id 는 `1-1` 꼴이지만 화면 번호가 아니라 안정 키다. */
export type Paragraph = { id: string; title: string; spans: string[] };
/** 큰 주제 = 세부 단락의 의미 묶음(비연속 허용). id 는 `01` 꼴. */
export type Topic = { id: string; title: string; paragraph_ids: string[] };
export type StructuredRecord = { topics: Topic[]; paragraphs: Paragraph[]; annotations: Annotation[] };

// ─── 02 회차별 요약 ───────────────────────────────────────────────────────────────

export type GoalLink = 'overall' | 'session' | null;

/**
 * 항목별 근거 등급·변환(#102 를 v6 에 흡수, 2026-09-18 Q). 근거 자체는 span 참조가 보증하고,
 * 등급·변환은 모델이 같은 호출에서 매기는 판단이다 — 없으면 화면이 비워 둔다. 애매하면 낮은 등급.
 */
export type Evidence = { grade?: EvidenceGrade; transforms?: EvidenceTransform[] };

/** 핵심·확인필요·완료·해결의 한 줄. 어휘는 참조 span 의 원문 것이어야 한다(치환 금지). */
export type SummaryItem = Evidence & { text: string; spans: string[]; goal: GoalLink };

/** 실제 직접 발화가 원문에 있을 때만. 인용문은 참조 span 텍스트에 그대로 들어 있어야 한다(T18). */
export type Dialogue = { worker?: string; participant?: string };

/** 약속 이행 여부 — 약속 span 과 결과 span 이 모두 같은 회차 수기에 있어야 한다(T09·T13). */
export type PromiseResultItem = Evidence & {
  promise: string;
  result: string;
  promise_spans: string[];
  result_spans: string[];
  /** `변화점:` 줄들. 전후가 실제로 있을 때만. */
  changes: Array<{ before: string; after: string; meaning?: string }>;
  /** `∴` 문장. 근거가 충분할 때만. */
  conclusion?: string;
  goal: GoalLink;
};

/** 상담 중 새로 드러난 것 — 요약 전용 예외 항목. mode=change 는 `변화점:`(전후 span 필요), confirmed 는 `확인된 내용:`. */
export type NewlyRevealedItem = Evidence & {
  dialogue?: Dialogue;
  mode: 'change' | 'confirmed';
  lines: string[];
  spans: string[];
  /** mode=change 인데 01 의 change 조건(전후)을 충족하지 못한 경우 true — 01/04 파랑으로 전파하지 않는다(T10·T27). */
  summary_only_exception: boolean;
  goal: GoalLink;
};

/** 이번 상담 후 새로운 가능성 — 같은 회차의 변화 span → 후반 합의·계획 span 연결이 있을 때만(T11). */
export type NewPossibilityItem = Evidence & {
  dialogue?: Dialogue;
  lines: string[];
  change_spans: string[];
  plan_spans: string[];
  goal: GoalLink;
};

export type SessionSummary = {
  core: SummaryItem[];
  changes: {
    promise_result: PromiseResultItem[];
    newly_revealed: NewlyRevealedItem[];
    new_possibility: NewPossibilityItem[];
  };
  follow_up: SummaryItem[];
  completed: SummaryItem[];
};

/** 하위 항목 의미 순서. 화면 번호 ①②③ 은 여기 고정하지 않고 내용 있는 것만 세어 렌더 시 매긴다(T12). */
export const CHANGE_SUBSECTIONS = ['promise_result', 'newly_revealed', 'new_possibility'] as const;
export const CHANGE_SUBSECTION_LABEL: Record<(typeof CHANGE_SUBSECTIONS)[number], string> = {
  promise_result: '약속 이행 여부',
  newly_revealed: '상담 중 새로 드러난 것',
  new_possibility: '이번 상담 후 새로운 가능성',
};

// ─── 04 전사 연결·불일치 ──────────────────────────────────────────────────────────

/** 전사 문장 ↔ 수기 span. 연결 없는 문장은 목록에 없다(억지 연결 금지). 상태 띠는 written_spans 의 01 상태를 상속한다. */
export type EvidenceLink = { transcript_span: string; written_spans: string[]; match: 'match' | 'uncertain' };

/** 4조건이 모두 true 인 링크만 산다. 조건표는 저장하되 화면에 내지 않는다. */
export type Discrepancy = {
  transcript_span: string;
  written_spans: string[];
  paragraph_id: string;
  /** `차이점`. 두 원문의 실제 표현을 짧게 대비한다 — 동의어 치환 금지. */
  difference: string;
  conditions: { same_subject: boolean; same_attribute: boolean; same_time: boolean; incompatible: boolean };
};

// ─── 키워드 ────────────────────────────────────────────────────────────────────

/** deterministic = 서버가 목표·수기 과제·질문 카드에서 만든 것. llm = 모델이 뽑은 어휘(참조 span 안에 문자열이 있어야 산다). */
export type Keyword = { text: string; source: 'deterministic' | 'llm'; spans: string[] };

// ─── 모델 응답 (검증 전) ──────────────────────────────────────────────────────────

/** 모델이 돌려주는 것. 원문·span 목록은 서버 것이라 여기 없다. */
export type LlmAnalysis = {
  record: StructuredRecord;
  summary: SessionSummary;
  links: EvidenceLink[];
  discrepancies: Discrepancy[];
  keywords: Array<{ text: string; spans: string[] }>;
  /** 카드 반영용(승인 시 promise/question 카드). 자료에 적힌 것만. */
  tasks: string[];
  questions: string[];
};

const spanIds = z.array(z.string().min(1));
const goalLink = z.union([z.literal('overall'), z.literal('session'), z.null()]);
const evidence = { grade: z.enum(EVIDENCE_GRADES).optional(), transforms: z.array(z.enum(EVIDENCE_TRANSFORMS)).optional() };
const summaryItem = z.object({ ...evidence, text: z.string().min(1), spans: spanIds, goal: goalLink });
const dialogue = z.object({ worker: z.string().optional(), participant: z.string().optional() }).optional();

export const LlmAnalysisSchema: z.ZodType<LlmAnalysis> = z.object({
  record: z.object({
    topics: z.array(z.object({ id: z.string().min(1), title: z.string().min(1), paragraph_ids: z.array(z.string().min(1)) })),
    paragraphs: z.array(z.object({ id: z.string().min(1), title: z.string().min(1), spans: spanIds })),
    annotations: z.array(
      z.object({
        span: z.string().min(1),
        status: z.enum(STATUSES),
        before: spanIds.optional(),
        after: spanIds.optional(),
      }),
    ),
  }),
  summary: z.object({
    core: z.array(summaryItem),
    changes: z.object({
      promise_result: z.array(
        z.object({
          ...evidence,
          promise: z.string().min(1),
          result: z.string().min(1),
          promise_spans: spanIds,
          result_spans: spanIds,
          changes: z.array(z.object({ before: z.string(), after: z.string(), meaning: z.string().optional() })),
          conclusion: z.string().optional(),
          goal: goalLink,
        }),
      ),
      newly_revealed: z.array(
        z.object({
          ...evidence,
          dialogue,
          mode: z.enum(['change', 'confirmed']),
          lines: z.array(z.string()),
          spans: spanIds,
          summary_only_exception: z.boolean(),
          goal: goalLink,
        }),
      ),
      new_possibility: z.array(
        z.object({ ...evidence, dialogue, lines: z.array(z.string()), change_spans: spanIds, plan_spans: spanIds, goal: goalLink }),
      ),
    }),
    follow_up: z.array(summaryItem),
    completed: z.array(summaryItem),
  }),
  links: z.array(
    z.object({ transcript_span: z.string().min(1), written_spans: spanIds, match: z.enum(['match', 'uncertain']) }),
  ),
  discrepancies: z.array(
    z.object({
      transcript_span: z.string().min(1),
      written_spans: spanIds,
      paragraph_id: z.string().min(1),
      difference: z.string().min(1),
      conditions: z.object({
        same_subject: z.boolean(),
        same_attribute: z.boolean(),
        same_time: z.boolean(),
        incompatible: z.boolean(),
      }),
    }),
  ),
  keywords: z.array(z.object({ text: z.string().min(1), spans: spanIds })),
  tasks: z.array(z.string()),
  questions: z.array(z.string()),
});

/** OpenAI json_schema(strict) 용. zod 를 JSON Schema 로 옮긴 것과 같아야 한다 — 서버가 `LlmAnalysisSchema` 로 다시 검증한다. */
export const LLM_ANALYSIS_JSON_SCHEMA_NAME = 'record_analysis_v6';

// ─── 저장 행과 화면 DTO ──────────────────────────────────────────────────────────

export type AnalysisStatus = 'draft' | 'approved' | 'failed';

/** 분석이 본 원문 버전 묶음. 현재 값과 하나라도 다르면 stale(T16·T28). */
export type SourceVersions = {
  memo_hash: string | null;
  cards: Array<{ id: number; hash: string }>;
  intake_hash: string | null;
  /** 분석이 읽은 승인 전사 행. 없었으면 null. 전사 승인이 뒤에 오면 어긋나 stale 이 된다. */
  transcript_id: number | null;
};

export type SummaryOverride = { text: string; actor_id: number; at: string };

/** 검증을 통과해 저장되는 본문(암호화). 원문 텍스트는 없다 — 문서 hash·span 좌표만 있다. */
export type AnalysisBody = {
  schema_version: number;
  rule_version: string;
  documents: Array<Omit<SourceDocument, 'text'>>;
  spans: SourceSpan[];
  record: StructuredRecord;
  summary: SessionSummary;
  links: EvidenceLink[];
  discrepancies: Discrepancy[];
  keywords: Keyword[];
  tasks: string[];
  questions: string[];
  /** 놓친 구간(#102 흡수) — 어떤 요약 항목도 참조하지 않은 수기 단락. 모델이 아니라 서버가 센다(`omissionsOf`). */
  omissions: Omission[];
  /** 승인 뒤 사람이 통째 고친 요약(Q 17). 있으면 화면은 이 텍스트만 보이고 요약 항목의 근거·목표 연결을 해제한다. */
  summary_override: SummaryOverride | null;
};

export type Omission = { paragraph_id: string; spans: string[] };

/** 요약 항목이 참조하는 수기 span 전부. 근거 모달·놓친 구간이 같은 목록을 쓴다. */
export function referencedSpans(summary: SessionSummary): Set<string> {
  const out = new Set<string>();
  const add = (ids: ReadonlyArray<string> | undefined) => ids?.forEach((id) => out.add(id));
  summary.core.forEach((x) => add(x.spans));
  summary.changes.promise_result.forEach((x) => {
    add(x.promise_spans);
    add(x.result_spans);
  });
  summary.changes.newly_revealed.forEach((x) => add(x.spans));
  summary.changes.new_possibility.forEach((x) => {
    add(x.change_spans);
    add(x.plan_spans);
  });
  summary.follow_up.forEach((x) => add(x.spans));
  summary.completed.forEach((x) => add(x.spans));
  return out;
}

/** 놓친 구간 = 어느 span 도 요약에 안 쓰인 단락. 결정적이라 모델의 역방향 추정이 필요 없다(#102 의 `omissions` 대체). */
export function omissionsOf(record: StructuredRecord, summary: SessionSummary): Omission[] {
  const used = referencedSpans(summary);
  return record.paragraphs
    .filter((p) => p.spans.length > 0 && !p.spans.some((id) => used.has(id)))
    .map((p) => ({ paragraph_id: p.id, spans: p.spans }));
}

export type AnalysisRevision = {
  id: number;
  session_id: number;
  status: AnalysisStatus;
  schema_version: number;
  rule_version: string;
  source_versions: SourceVersions;
  model: string | null;
  mask_hits: Record<string, number>;
  /** failed 면 null. */
  body: AnalysisBody | null;
  /** failed 의 사유(사람이 읽는 명사구). 원문·모델 응답은 담지 않는다. */
  error: string | null;
  created_by: number | null;
  approved_by: number | null;
  created_at: string;
};

export type ApproveBody = {
  draft_id: number;
  source_versions: SourceVersions;
  /** 승인 전 편집. 요약 항목 텍스트·tasks·questions 만 바꿀 수 있다. span 은 잠금 — 서버가 다시 검증한다. */
  edits?: { summary?: SessionSummary; tasks?: string[]; questions?: string[] };
};

/** 회차 카드에 싣는 요약. v6 가 없고 구버전 승인만 있으면 legacy. */
export type SessionAiSummary =
  | { kind: 'v6'; analysis_id: number; summary: SessionSummary; keywords: Keyword[]; override: SummaryOverride | null }
  | { kind: 'legacy'; summary: string };

/** 원본 팝업·검토 화면의 재료. 원문 텍스트는 여기서만 온다. */
export type AnalysisView = {
  session_id: number;
  /** 마지막 승인 분석. 없으면 null(원문만 보인다). */
  analysis: AnalysisRevision | null;
  /** 현재 원문. analysis.body.documents 의 hash 와 견줘 stale 을 판단한다. */
  documents: SourceDocument[];
  spans: SourceSpan[];
  /** 전사가 있을 때. 문장 span 은 spans 에 t: 로 함께 온다. */
  transcript: { id: number; status: 'draft' | 'approved'; recordings_without_transcript: number } | null;
  stale: boolean;
};

export type Backlink = { session_id: number; seq: number; span_id: string; paragraph_id: string | null; text: string };

/** AI_PROVIDER=stub 의 파일 모양. seq 가 맞는 항목이 없으면 default. */
export type StubFile = { default: LlmAnalysis; by_seq?: Record<string, LlmAnalysis> };

// ─── 기본 참조 검증(구조 규칙은 structured-record.ts, 요약은 session-summary.ts, 전사는 transcript-links.ts) ──

export type ReferenceProblem = { where: string; span: string; reason: 'unknown_span' | 'not_written' | 'not_transcript' };

/**
 * 모델 응답의 모든 span 참조가 이 회차의 span 목록에 있는지, 수기 자리에 수기 span 이 왔는지 본다.
 * 하나라도 틀리면 초안은 failed 다(T23·T29). 규칙(전후·4조건·어휘)은 각 검증기가 본다.
 */
export function checkReferences(a: LlmAnalysis, spans: ReadonlyArray<SourceSpan>): ReferenceProblem[] {
  const known = new Set(spans.map((s) => s.id));
  const problems: ReferenceProblem[] = [];
  const written = (where: string, ids: ReadonlyArray<string> | undefined) => {
    for (const id of ids ?? []) {
      if (!known.has(id)) problems.push({ where, span: id, reason: 'unknown_span' });
      else if (!isWrittenSpan(id)) problems.push({ where, span: id, reason: 'not_written' });
    }
  };
  const transcript = (where: string, id: string) => {
    if (!known.has(id)) problems.push({ where, span: id, reason: 'unknown_span' });
    else if (!isTranscriptSpan(id)) problems.push({ where, span: id, reason: 'not_transcript' });
  };

  a.record.paragraphs.forEach((p) => written(`paragraph ${p.id}`, p.spans));
  a.record.annotations.forEach((x, i) => {
    written(`annotation ${i}`, [x.span]);
    written(`annotation ${i} before`, x.before);
    written(`annotation ${i} after`, x.after);
  });
  a.summary.core.forEach((x, i) => written(`core ${i}`, x.spans));
  a.summary.changes.promise_result.forEach((x, i) => {
    written(`promise_result ${i} promise`, x.promise_spans);
    written(`promise_result ${i} result`, x.result_spans);
  });
  a.summary.changes.newly_revealed.forEach((x, i) => written(`newly_revealed ${i}`, x.spans));
  a.summary.changes.new_possibility.forEach((x, i) => {
    written(`new_possibility ${i} change`, x.change_spans);
    written(`new_possibility ${i} plan`, x.plan_spans);
  });
  a.summary.follow_up.forEach((x, i) => written(`follow_up ${i}`, x.spans));
  a.summary.completed.forEach((x, i) => written(`completed ${i}`, x.spans));
  a.links.forEach((l, i) => {
    transcript(`link ${i}`, l.transcript_span);
    written(`link ${i}`, l.written_spans);
  });
  a.discrepancies.forEach((d, i) => {
    transcript(`discrepancy ${i}`, d.transcript_span);
    written(`discrepancy ${i}`, d.written_spans);
  });
  a.keywords.forEach((k, i) => written(`keyword ${i}`, k.spans));
  return problems;
}

/** 원문 어휘 치환 금지어(01·02·04·별첨 공통). 참조 원문에 없는데 생성문에 있으면 실패(T17). */
export const FORBIDDEN_SUBSTITUTIONS = ['시도', '멘토링', '회복력', '효능감', '역량 강화', '개입 성과'] as const;

/** 생성 문구가 참조 원문에 없는 금지어를 썼는가. */
export function forbiddenWordsIn(generated: string, referenced: string): string[] {
  return FORBIDDEN_SUBSTITUTIONS.filter((w) => generated.includes(w) && !referenced.includes(w));
}
