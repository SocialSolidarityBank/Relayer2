// 라우터 하나, 검증 한 곳. 베타 API 6개(PLAN §5).
import { Hono } from 'hono';
import { z } from 'zod';
import { actorFromCookie, clearCookie, issueCookie, login, type Actor } from './auth.ts';
import {
  DocumentRejected,
  listDocuments,
  readDocument,
  saveDocument,
} from './documents.ts';
import {
  approveTranscript,
  draftTranscript,
  latestTranscript,
  listRecordings,
  readRecordingAudio,
  RecordingRejected,
  saveRecording,
  SPEECH_MAX_BYTES,
  speechStatus,
  SttUnavailable,
  withdrawCaseRecordings,
} from './stt.ts';
import { AiUnavailable, approveDraft, draftSession, latestDraft, openAiKey } from './ai.ts';
import { audit, auditCsv, auditSummary, listAudit, AUDIT_KIND_LIST } from './audit.ts';
import { accessState, issueAccess, openAccess, revokeAccess } from './participant-access.ts';
import {
  activeDomains,
  CONSENT_DECISIONS,
  CONSENT_DOMAINS,
  copyHash,
  copyText,
  copyVersion,
} from './consent.ts';
import { putConsentCopy } from './consent-copy.ts';
import { listRevisions, NothingToRevise, REVISION_KINDS, reviseSession } from './revisions.ts';
import { CARD_OWNERS, LIFE_AREAS } from './domain/types.ts';
import * as service from './service.ts';
import * as settings from './settings.ts';
import { sql } from './db.ts';
import {
  AccessDenied,
  assertCaseAccess,
  assertProgramActive,
  CaseClosed,
  caseIdOfDocument,
  caseIdOfRecording,
  caseIdOfSession,
  NotFound,
  ProgramRetired,
} from './access.ts';

// 영역은 국가 표준 10종+기타 하나뿐이다(SPEC §8). 여기에 목록을 또 적으면 이번처럼 어긋난다.
const area = z.enum(LIFE_AREAS);

// 실제 상담 방식. 'visit' 은 옛 기록에 남아 있어 받아들이고, 새 선택지는 'other' 까지다.
const sessionMethod = z.enum(['in_person', 'phone', 'video', 'visit', 'other']);
// 상담 일시는 ISO datetime 만 받는다 — 잘못 들어온 날짜가 조용히 저장되지 않게.
const isoDateTime = z.string().datetime({ offset: true });
// 소요 분(2026-09-18 Q D4). 종료 시각은 화면이 분으로 바꿔 보낸다. null 은 지움, 안 보내면 그대로.
const durationMin = z.number().int().positive().max(24 * 60).nullable().optional();

const cardInput = z.object({
  kind: z.enum(['fact', 'question', 'promise', 'judgment']),
  text: z.string().min(1),
  section: z.enum(['intake', 'memo', 'change', 'promise', 'question', 'judgment']),
  area: area.optional(),
  risk_type: z.string().optional(),
  quote: z.string().optional(),
  owner: z.enum(CARD_OWNERS).optional(),
});

const outcomeInput = z.object({
  card_id: z.number().int(),
  result: z.enum(['done', 'in_progress', 'not_done', 'confirmed']),
  follow: z.enum(['continue', 'stop']).optional(),
  reason: z.string().optional(),
  note: z.string().optional(),
});

export const app = new Hono<{ Variables: { actor: Actor } }>();

// 동의 게이트에 걸린 저장은 409 다. 잘못 쓴 요청(400)도 서버 잘못(500)도 아니다.
app.onError((err, c) => {
  if (err instanceof NotFound) return c.json({ error: err.message }, 404);
  if (err instanceof AccessDenied) return c.json({ error: err.message }, 403);
  if (err instanceof service.ConsentRequired) return c.json({ error: err.message }, 409);
  // 종결 사례에 새 녹음·전사를 보내는 것도, 종료된 사업에 새 기록을 쓰는 것도 상태 충돌이다.
  if (
    err instanceof CaseClosed ||
    err instanceof ProgramRetired ||
    err instanceof service.SessionAlreadyStarted ||
    err instanceof service.GoalLocked ||
    err instanceof NothingToRevise
  ) {
    return c.json({ error: err.message }, 409);
  }
  // AI 는 없어도 제품이 돌아간다. 없는 것을 있는 것처럼 답하지 않는다.
  if (err instanceof AiUnavailable || err instanceof SttUnavailable) {
    return c.json({ error: err.message }, 503);
  }
  // 받지 않는 파일은 **보낸 쪽 잘못**이다. 서버 고장이 아니다.
  if (err instanceof DocumentRejected || err instanceof RecordingRejected) {
    return c.json({ error: err.message }, 400);
  }
  // 입력이 스키마에 안 맞으면 **보낸 쪽 잘못**이다. 500 으로 답하면 서버가 고장난 줄 안다.
  // 어느 자리가 틀렸는지만 알려 준다 — 보낸 값은 되돌려주지 않는다(PII 가 섞여 있다).
  if (err instanceof z.ZodError) {
    const where = err.issues.map((i) => i.path.join('.') || '(본문)').join(', ');
    return c.json({ error: `요청 형식 오류: ${where}` }, 400);
  }
  throw err;
});

app.get('/health', (c) => c.json({ ok: true }));

/**
 * API 응답은 저장하지 않는다. 이름·연락처·상담 내용이 실려 나가므로
 * 브라우저 디스크 캐시나 중간 프록시에 남으면 안 된다(P1). 화면 파일은 해당 없다.
 */
app.use('*', async (c, next) => {
  await next();
  if (!new URL(c.req.url).pathname.startsWith('/assets/')) {
    c.header('cache-control', 'no-store');
  }
});

app.post('/auth/login', async (c) => {
  const body = z.object({ email: z.string().min(1), password: z.string().min(1) }).parse(await c.req.json());
  const result = await login(body.email, body.password);
  if (!result.ok) {
    const message =
      result.reason === 'participant'
        ? '당사자 로그인 불가, 실무자가 보낸 링크와 코드로 열람'
        : '아이디 또는 비밀번호 불일치';
    return c.json({ error: message }, 401);
  }
  c.header('set-cookie', issueCookie(result.actor.id));
  return c.json(result.actor);
});

app.get('/auth/invite/:token', async (c) => {
  const found = await settings.peekInvite(c.req.param('token'));
  if (!found) return c.json({ error: '쓸 수 없는 초대, 기한 만료 또는 이미 사용됨' }, 404);
  return c.json(found);
});

app.post('/auth/invite/:token', async (c) => {
  const body = z
    .object({
      email: z.string().trim().min(2, '아이디 입력'),
      password: z.string().min(4, '비밀번호 네 자 이상'),
      name: z.string().trim().min(1, '이름 입력'),
    })
    .parse(await c.req.json());
  const out = await settings.signUpWithInvite({ token: c.req.param('token'), ...body });
  if ('error' in out) return c.json(out, 409);
  c.header('set-cookie', issueCookie(out.userId));
  return c.json({ ok: true });
});

/**
 * 첫 가입(2026-09-17 Q). 활성 관리자가 없을 때만 열린다 — 그 뒤는 초대 링크뿐이다.
 * 열렸는지(GET)와 가입(POST) 둘 다 로그인 앞이다. GET 은 기관 워크스페이스 정보도 함께 낸다 —
 * 문이 닫힌 사람에게 어느 기관인지 보여 주고 로그인으로 보내기 위해서다(이름·슬러그는 비밀이 아니다).
 * POST 는 계정만 만든다. 기관 워크스페이스는 로그인 뒤 `POST /settings/workspace` 다.
 */
app.get('/auth/signup', async (c) =>
  c.json({ open: await settings.signupOpen(), workspace: await settings.workspaceInfo() }),
);

app.post('/auth/signup', async (c) => {
  const body = z
    .object({
      email: z.string().trim().min(2, '아이디를 적어 주세요.'),
      password: z.string().min(4, '비밀번호는 네 자 이상이어야 해요.'),
      name: z.string().trim().min(1, '이름을 적어 주세요.'),
    })
    .parse(await c.req.json());
  const out = await settings.bootstrapAdmin(body);
  if ('error' in out) return c.json({ error: out.error }, out.status);
  c.header('set-cookie', issueCookie(out.userId));
  return c.json({ ok: true });
});

app.post('/auth/logout', (c) => {
  c.header('set-cookie', clearCookie());
  return c.json({ ok: true });
});

/** 당사자 열람은 로그인 없이 연다. 대신 링크와 코드 두 자물쇠를 통과해야 한다. */
const isParticipantGate = (path: string): boolean => path === '/access/open';

/**
 * 화면으로 들어오는 주소. 로그인 전에도 받아야 로그인 화면이 뜬다.
 * `/test` 는 관문 2 측정용 입구다 — 참가자에게 `relayer.kr/test` 한 줄만 주면 된다.
 */
const WEB_ENTRIES = new Set(['/', '/test']);

/**
 * 빌드가 루트에 내놓는 파일. `web/dist` 에는 `index.html` 과 `assets/` 뿐이다.
 * 브라우저가 묻지도 않았는데 찾는 것들만 더 연다.
 */
const PUBLIC_FILES = new Set(['/index.html', '/favicon.ico', '/robots.txt']);

/**
 * 로그인 없이 줄 수 있는 것.
 *
 * **확장자로 판정하지 않는다**(2026-09-16 검수). 전에는 `/\.[a-z0-9]+$/` 로 "점이 있으면
 * 정적 파일"이라 보았는데, `GET /sessions/1.0` 이 그 그물을 빠져나가 **로그인 없이 상담 기록을
 * 통째로 내주고 있었다** — Hono 는 그것을 `/sessions/:id` 로 받고 `Number('1.0')` 은 1 이다.
 *
 * 그래서 목록으로 못 박는다. 정적 자산은 `assets/` 아래에만 있고 루트 파일은 셋뿐이다.
 * 새 파일이 늘면 여기 적어야 한다 — 적는 수고가 뚫리는 것보다 싸다.
 */
export const isWebAsset = (path: string): boolean =>
  WEB_ENTRIES.has(path) || PUBLIC_FILES.has(path) || path.startsWith('/assets/');

// 여기부터는 로그인한 사람만. 실패는 401 하나로 답한다(무엇이 있는지 알려주지 않는다).
app.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (c.req.method === 'GET' && isWebAsset(path)) return next();
  if (c.req.method === 'POST' && isParticipantGate(path)) return next();
  const actor = await actorFromCookie(c.req.header('cookie'));
  if (!actor) return c.json({ error: '로그인 필요' }, 401);
  c.set('actor', actor);
  await next();
});
const positiveId = (raw: string): number => {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new NotFound('없음');
  return value;
};

const caseAccess = async (raw: string, actorId: number): Promise<number> => {
  const caseId = positiveId(raw);
  await assertCaseAccess(caseId, actorId);
  return caseId;
};

const sessionAccess = async (raw: string, actorId: number): Promise<number> => {
  const sessionId = positiveId(raw);
  const caseId = await caseIdOfSession(sessionId);
  if (!caseId) throw new NotFound('회차 없음');
  await assertCaseAccess(caseId, actorId);
  return sessionId;
};

const recordingAccess = async (raw: string, actorId: number): Promise<number> => {
  const recordingId = positiveId(raw);
  const caseId = await caseIdOfRecording(recordingId);
  if (!caseId) throw new NotFound('녹음 없음');
  await assertCaseAccess(caseId, actorId);
  return recordingId;
};

const documentAccess = async (raw: string, actorId: number): Promise<number> => {
  const documentId = positiveId(raw);
  const caseId = await caseIdOfDocument(documentId);
  if (!caseId) throw new NotFound('문서 없음');
  await assertCaseAccess(caseId, actorId);
  return documentId;
};

// 마법사를 마쳤는지와 기관 워크스페이스(이름·주소 이름)도 함께 싣는다 — 화면이 이것으로 관리자를 마법사에,
// 실무자를 '기관 준비 중' 에 붙들어 둔다(서버 잠금 없음).
app.get('/me', async (c) =>
  c.json({ ...c.get('actor'), onboarded: await settings.isOnboarded(), workspace: await settings.workspaceInfo() }),
);

app.post('/cases', async (c) => {
  const body = z
    .object({
      name: z.string().min(1),
      phone: z.string().optional(),
      email: z.string().optional(),
      birth: z.string().optional(),
      address: z.string().optional(),
      program_id: z.number().int().positive(),
      sessions_planned: z.number().int().positive().optional(),
      consents: z
        .array(z.object({ domain: z.enum(CONSENT_DOMAINS), decision: z.enum(CONSENT_DECISIONS) }))
        .optional(),
    })
    .parse(await c.req.json());
  // 개인정보 수집·이용 동의 없이는 사례를 열지 않는다(P1 게이트).
  const personal = body.consents?.find((x) => x.domain === 'personal_data_collection_use');
  if (personal?.decision !== 'grant') {
    return c.json({ error: '개인정보 수집·이용 동의 필요' }, 400);
  }
  return c.json(await service.createCase({ ...body, actorId: c.get('actor').id }), 201);
});

app.put('/cases/:id/intake', async (c) => {
  const caseId = await caseAccess(c.req.param('id'), c.get('actor').id);
  const body = z
    .object({
      held_at: isoDateTime.optional(),
      method: sessionMethod.optional(),
      place: z.string().nullable().optional(),
      memo: z.string().optional(),
      // 전체 상담 목표는 비워둘 수 있다.
      overall_goal: z.string().nullable().optional(),
      detail: z.record(z.unknown()).optional(),
      cards: z.array(cardInput).optional(),
    })
    .parse(await c.req.json());
  return c.json(await service.saveIntake(caseId, body));
});

app.post('/cases/:id/sessions', async (c) => {
  const caseId = await caseAccess(c.req.param('id'), c.get('actor').id);
  const body = z
    .object({
      scheduled_at: z.string(),
      method: sessionMethod,
      place: z.string().nullable().optional(),
      plan_memo: z.string().optional(),
      is_closing: z.boolean().optional(),
      duration_min: durationMin,
    })
    .parse(await c.req.json());
  if (body.place && body.method !== 'in_person') {
    return c.json({ error: '상담 장소는 대면일 때만 입력' }, 400);
  }
  return c.json(await service.planSession(caseId, body), 201);
});

/**
 * 상담 시작(2026-09-16 Q). 수기 첫 입력이든 녹음 시작이든 그 순간 회차가 생긴다.
 * 예정 회차 id 를 주면 그 회차를 기록됨으로 바꾸고, 없으면 새 회차를 만든다. 내용은 나중에 채운다.
 */
app.post('/cases/:id/sessions/start', async (c) => {
  const caseId = await caseAccess(c.req.param('id'), c.get('actor').id);
  const body = z
    .object({
      session_id: z.number().int().positive().optional(),
      method: sessionMethod.optional(),
      is_closing: z.boolean().optional(),
    })
    .parse(await c.req.json().catch(() => ({})));
  return c.json(await service.startSession(caseId, { ...body, actorId: c.get('actor').id }), 201);
});


app.get('/cases/:id', async (c) => {
  const caseId = await caseAccess(c.req.param('id'), c.get('actor').id);
  const found = await service.getCase(caseId);
  return found ? c.json(found) : c.json({ error: '사례 없음' }, 404);
});

// `/detail` 은 ui-plan §4 계약의 이름이다. 같은 것을 낸다 — `stale`·`duration_min` 이 실려 있다.
app.on('GET', ['/sessions/:id', '/sessions/:id/detail'], async (c) => {
  const sessionId = await sessionAccess(c.req.param('id'), c.get('actor').id);
  const found = await service.getSessionRecord(sessionId);
  return found ? c.json(found) : c.json({ error: '회차 없음' }, 404);
});

app.patch('/sessions/:id', async (c) => {
  const sessionId = await sessionAccess(c.req.param('id'), c.get('actor').id);
  const body = z
    .object({
      held_at: isoDateTime.optional(),
      // 상담 내용은 선택이다(2026-09-16 Q). 녹음만 하고 나중에 적어도 회차다.
      memo: z.string().optional(),
      method: sessionMethod.optional(),
      place: z.string().nullable().optional(),
      detail: z.record(z.unknown()).optional(),
      next_goal_text: z.string().nullable().optional(),
      overall_goal: z.string().nullable().optional(),
      cards: z.array(cardInput).optional(),
      outcomes: z.array(outcomeInput).optional(),
      is_closing: z.boolean().optional(),
      duration_min: durationMin,
    })
    .parse(await c.req.json());
  return c.json(await service.recordSession(sessionId, { ...body, actorId: c.get('actor').id }));
});

// 목표 탭 전용(2026-09-18 Q). 회차 저장을 거치지 않으므로 카드 결과를 건드리지 않는다.
app.patch('/cases/:id/goal', async (c) => {
  const caseId = await caseAccess(c.req.param('id'), c.get('actor').id);
  const body = z.object({ overall_goal: z.string().nullable() }).parse(await c.req.json());
  await service.updateOverallGoal(caseId, body.overall_goal?.trim() || null);
  return c.json({ ok: true });
});

app.patch('/sessions/:id/next-goal', async (c) => {
  const sessionId = await sessionAccess(c.req.param('id'), c.get('actor').id);
  const body = z.object({ next_goal_text: z.string().nullable() }).parse(await c.req.json());
  await service.updateNextGoal(sessionId, body.next_goal_text?.trim() || null);
  return c.json({ ok: true });
});

/**
 * 다음 상담 목표를 줄 배열로(2026-09-18 Q D5). 대상 회차는 detail 의 `pending_next_goal` 과 같고,
 * 서버가 '\n' 으로 이어 기존 컬럼에 둔다. 빈 줄은 버린다.
 */
app.patch('/cases/:id/next-goals', async (c) => {
  const caseId = await caseAccess(c.req.param('id'), c.get('actor').id);
  const body = z.object({ lines: z.array(z.string()) }).parse(await c.req.json());
  return c.json({ ok: true, ...(await service.updateNextGoalLines(caseId, body.lines)) });
});

/**
 * 회차 원본 리비전(2026-09-18 Q D3). 수기·전사·요약을 편집 모드로 고치고 로그를 쌓는다.
 * 파생물은 자동 재처리하지 않는다 — detail 의 `stale` 이 배지를 붙이고 사람이 다시 돌린다.
 */
app.post('/sessions/:id/revisions', async (c) => {
  const sessionId = await sessionAccess(c.req.param('id'), c.get('actor').id);
  const body = z.object({ kind: z.enum(REVISION_KINDS), text: z.string().trim().min(1) }).parse(await c.req.json());
  return c.json(await reviseSession(sessionId, c.get('actor').id, body.kind, body.text), 201);
});

app.get('/sessions/:id/revisions', async (c) => {
  const sessionId = await sessionAccess(c.req.param('id'), c.get('actor').id);
  return c.json(await listRevisions(sessionId));
});

const consentInput = z.object({
  domain: z.enum(CONSENT_DOMAINS),
  decision: z.enum(CONSENT_DECISIONS),
});

app.get('/cases/:id/consents', async (c) => {
  const caseId = await caseAccess(c.req.param('id'), c.get('actor').id);
  const found = await service.getConsents(caseId);
  return found ? c.json(found) : c.json({ error: '사례 없음' }, 404);
});

app.post('/cases/:id/consents', async (c) => {
  const caseId = await caseAccess(c.req.param('id'), c.get('actor').id);
  await assertProgramActive(caseId);
  const body = consentInput.parse(await c.req.json());
  const view = await service.recordConsent(caseId, { ...body, actorId: c.get('actor').id });
  // 녹음·보유기간 동의를 거두면 그 사례의 음성 원본을 그 자리에서 지운다 — 문안이 그렇게 약속한다.
  if (
    body.decision === 'withdraw' &&
    (body.domain === 'counseling_recording' || body.domain === 'voice_original_retention_period')
  ) {
    await withdrawCaseRecordings(caseId, c.get('actor').id);
  }
  // 동의·철회는 열람이 아니지만 남긴다 — 누가 언제 받았는지가 곧 증거다.
  await audit({
    actorId: c.get('actor').id,
    action: 'consent.record',
    caseId,
    fields: [`${body.domain}:${body.decision}`],
  });
  return c.json(view);
});

app.get('/cases/:id/intake', async (c) => {
  const caseId = await caseAccess(c.req.param('id'), c.get('actor').id);
  const found = await service.getIntake(caseId);
  return found ? c.json(found) : c.json({ error: '사례 없음' }, 404);
});

app.get('/cases/:id/detail', async (c) => {
  const caseId = await caseAccess(c.req.param('id'), c.get('actor').id);
  const detail = await service.getCaseDetail(caseId);
  if (!detail) return c.json({ error: '사례 없음' }, 404);
  // 당사자 정보는 금고에서 이름·연락처·이메일을 꺼내 싣는다. 실은 항목만 적는다.
  const fields = (['name', 'phone', 'email'] as const).filter((k) => detail.participant[k]);
  await audit({
    actorId: c.get('actor').id,
    action: 'case.detail',
    participantId: detail.case.participant_id,
    caseId: detail.case.id,
    fields: [...fields],
  });
  return c.json(detail);
});

app.post('/access/open', async (c) => {
  const body = z.object({ token: z.string().min(1), code: z.string().min(1) }).parse(await c.req.json());
  const result = await openAccess(body.token, body.code);
  if (result.ok) return c.json(result.view);
  const message =
    result.reason === 'wrong_code'
      ? `코드 불일치, ${result.attempts_left}번 더 입력 가능`
      : result.reason === 'expired'
        ? '링크 만료, 담당 실무자에게 새 링크 요청'
        : result.reason === 'locked'
          ? '입력 횟수 초과로 잠김, 담당 실무자에게 새 링크 요청'
          : '링크 오류';
  return c.json({ error: message }, 401);
});

app.get('/cases/:id/access', async (c) => {
  const caseId = await caseAccess(c.req.param('id'), c.get('actor').id);
  return c.json(await accessState(caseId, c.get('actor').id));
});

app.post('/cases/:id/access', async (c) => {
  const caseId = await caseAccess(c.req.param('id'), c.get('actor').id);
  await assertProgramActive(caseId);
  const issued = await issueAccess(caseId, c.get('actor').id);
  await audit({
    actorId: c.get('actor').id,
    action: 'consent.record',
    caseId,
    fields: ['access:issue'],
  });
  return c.json(issued);
});

app.delete('/cases/:id/access', async (c) => {
  const caseId = await caseAccess(c.req.param('id'), c.get('actor').id);
  await revokeAccess(caseId, c.get('actor').id);
  return c.json({ ok: true });
});

app.get('/sessions/:id/draft', async (c) => {
  const sessionId = await sessionAccess(c.req.param('id'), c.get('actor').id);
  const found = await latestDraft(sessionId);
  return c.json(found ?? { status: 'none' });
});

app.post('/sessions/:id/draft', async (c) => {
  const sessionId = await sessionAccess(c.req.param('id'), c.get('actor').id);
  return c.json(await draftSession(sessionId, c.get('actor').id));
});

app.post('/sessions/:id/draft/approve', async (c) => {
  const sessionId = await sessionAccess(c.req.param('id'), c.get('actor').id);
  const body = z
    .object({
      summary: z.string().optional(),
      // `changes` 가 빠져 있었다(2026-09-16 검수). zod 가 조용히 버려서, 사람이 고친
      // `달라진 것` 이 사라지고 AI 가 쓴 옛 문장이 승인됐다 — 고친 줄 알고 넘어간 기록이다.
      changes: z.array(z.string()).optional(),
      tasks: z.array(z.string()).optional(),
      questions: z.array(z.string()).optional(),
    })
    .parse(await c.req.json().catch(() => ({})));
  return c.json(await approveDraft(sessionId, c.get('actor').id, body));
});

app.get('/speech/status', (c) => c.json(speechStatus()));

/**
 * 음성 경로(P4). 녹음은 본문 그대로 받는다 — multipart 로 감싸 봐야 바이트는 같고,
 * 파싱 단계가 하나 늘면 그만큼 실패할 자리가 는다.
 */
app.post('/sessions/:id/recordings', async (c) => {
  const sessionId = await sessionAccess(c.req.param('id'), c.get('actor').id);
  const declaredBytes = Number(c.req.header('content-length'));
  if (Number.isFinite(declaredBytes) && declaredBytes > SPEECH_MAX_BYTES) {
    throw new RecordingRejected(
      `파일 크기 초과, ${Math.floor(SPEECH_MAX_BYTES / 1024 / 1024)}MB 까지`,
    );
  }
  const rawDurationMs = c.req.query('duration_ms');
  const contentType = c.req.header('content-type') ?? '';
  // 권한을 먼저 확인하고 나서야 바이트를 읽는다. 맡지 않은 요청으로 큰 파일을
  // 읽거나 디스크·외부 제공자를 건드리지 않는다.
  const audio = new Uint8Array(await c.req.arrayBuffer());
  return c.json(
    await saveRecording(sessionId, audio, c.get('actor').id, {
      durationMs: rawDurationMs === undefined ? undefined : Number(rawDurationMs),
      contentType,
    }),
    201,
  );
});

app.get('/sessions/:id/recordings', async (c) => {
  const sessionId = await sessionAccess(c.req.param('id'), c.get('actor').id);
  return c.json(await listRecordings(sessionId, c.get('actor').id));
});

app.get('/recordings/:id/audio', async (c) => {
  const recordingId = await recordingAccess(c.req.param('id'), c.get('actor').id);
  const { bytes, content_type } = await readRecordingAudio(recordingId, c.get('actor').id);
  return new Response(bytes, {
    headers: {
      'content-type': content_type,
      'content-length': String(bytes.byteLength),
      'content-disposition': 'inline',
      'cache-control': 'no-store',
    },
  });
});

/**
 * 회차의 불일치 둘. 한 목록에 섞지 않는다(요구 23).
 * 판정하지 않는다 — 달라졌다는 사실만 낸다. 고치는 것은 사람이다.
 */
app.get('/sessions/:id/mismatches', async (c) => {
  const sessionId = await sessionAccess(c.req.param('id'), c.get('actor').id);
  return c.json(await service.getMismatches(sessionId));
});

app.get('/sessions/:id/transcript', async (c) => {
  const sessionId = await sessionAccess(c.req.param('id'), c.get('actor').id);
  const found = await latestTranscript(sessionId, c.get('actor').id);
  return c.json(found ?? { status: 'none' });
});

app.post('/recordings/:id/transcript', async (c) => {
  const recordingId = await recordingAccess(c.req.param('id'), c.get('actor').id);
  return c.json(await draftTranscript(recordingId, c.get('actor').id));
});

app.post('/sessions/:id/transcript/approve', async (c) => {
  const sessionId = await sessionAccess(c.req.param('id'), c.get('actor').id);
  const body = z
    .object({ transcript_id: z.number().int().positive(), text: z.string().optional() })
    .parse(await c.req.json());
  return c.json(
    await approveTranscript(sessionId, c.get('actor').id, body.text, body.transcript_id),
  );
});

/**
 * 서면 문서(2026-09-16 Q). 본문 그대로 받는다 — 이름과 형식은 쿼리로 온다.
 * multipart 로 감싸도 바이트는 같고, 파싱 단계가 늘면 그만큼 실패할 자리가 는다.
 */
app.post('/cases/:id/documents', async (c) => {
  const caseId = await caseAccess(c.req.param('id'), c.get('actor').id);
  await assertProgramActive(caseId);
  const rawSessionId = c.req.query('session_id');
  let sessionId: number | null = null;
  if (rawSessionId !== undefined) {
    sessionId = positiveId(rawSessionId);
    if ((await caseIdOfSession(sessionId)) !== caseId) {
      throw new NotFound('회차 없음');
    }
  }
  return c.json(
    await saveDocument({
      caseId,
      sessionId,
      label: c.req.query('label') ?? '',
      contentType: c.req.header('content-type') ?? '',
      // 권한·회차 소속을 모두 확인한 뒤에야 파일을 읽는다.
      bytes: new Uint8Array(await c.req.arrayBuffer()),
      actorId: c.get('actor').id,
    }),
    201,
  );
});

app.get('/cases/:id/documents', async (c) => {
  const caseId = await caseAccess(c.req.param('id'), c.get('actor').id);
  return c.json(await listDocuments(caseId));
});

app.get('/documents/:id', async (c) => {
  const documentId = await documentAccess(c.req.param('id'), c.get('actor').id);
  const { row, bytes } = await readDocument(documentId, c.get('actor').id);
  // 파일 이름은 사람이 붙인 이름을 쓴다. 원본 파일명은 저장하지 않는다.
  return new Response(bytes, {
    headers: {
      'content-type': row.content_type,
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(row.label)}`,
      'cache-control': 'no-store',
    },
  });
});

const auditQuery = (c: { req: { query: (k: string) => string | undefined } }) => ({
  days: Number(c.req.query('days')) || undefined,
  kind: AUDIT_KIND_LIST.find((k) => k === c.req.query('kind')),
  actorId: Number(c.req.query('actor')) || undefined,
  caseId: Number(c.req.query('case')) || undefined,
  only: (['off_assignment', 'download'] as const).find((o) => o === c.req.query('only')),
});

app.get('/audit', async (c) => {
  // 열람 기록은 관리자만 본다(GLOSSARY §6-7 설정 › 열람 기록).
  if (c.get('actor').role !== 'admin') return c.json({ error: '관리자 전용' }, 403);
  const rows = await listAudit({ ...auditQuery(c), viewerId: c.get('actor').id });
  // 이 화면은 이름을 꺼내 보여 준다. 그러니 이 화면을 연 것도 남는다.
  await audit({ actorId: c.get('actor').id, action: 'audit.view', fields: ['name'] });
  return c.json(rows);
});

app.get('/audit/summary', async (c) => {
  if (c.get('actor').role !== 'admin') return c.json({ error: '관리자 전용' }, 403);
  return c.json(await auditSummary(Number(c.req.query('days')) || undefined));
});

/**
 * CSV 로 내려받기. `names=1` 이면 실명이, 아니면 가명이 실린다.
 * **어느 쪽으로 내렸는지가 감사에 남는다** — 자유는 두되 책임이 따른다(docs/audit-view.md).
 */
app.get('/audit/export', async (c) => {
  if (c.get('actor').role !== 'admin') return c.json({ error: '관리자 전용' }, 403);
  const withNames = c.req.query('names') === '1';
  const q = auditQuery(c);
  const rows = await listAudit({ ...q, limit: 5000, viewerId: c.get('actor').id });
  await audit({
    actorId: c.get('actor').id,
    action: 'audit.export',
    fields: [withNames ? '이름 포함' : '가명만', `줄 ${rows.length}`, `기간 ${q.days ?? 30}일`],
  });
  const day = new Date().toISOString().slice(0, 10);
  return new Response(auditCsv(rows, withNames), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`열람기록_${day}.csv`)}`,
      'cache-control': 'no-store',
    },
  });
});

app.post('/cases/:id/close', async (c) => {
  const caseId = await caseAccess(c.req.param('id'), c.get('actor').id);
  const body = z
    .object({ close_reason: z.string().min(1), unfinished_note: z.string().nullish() })
    .parse(await c.req.json());
  return c.json(await service.closeCase(caseId, { ...body, actorId: c.get('actor').id }));
});

// 목록 조회는 감사에 남기지 않는다(2026-09-16 Q). 화면을 여는 것마다 한 줄이면
// 기록이 아니라 소음이다 — 실측으로 700줄 가운데 676줄이 목록 조회였다.
// 맡지 않은 행은 가명·사업·상태·담당자만 내고 임상 정보는 서버에서 지운다.
app.get('/participants', async (c) =>
  c.json(await service.listParticipants(c.get('actor').id)),
);

app.get('/schedules', async (c) => {
  const now = new Date();
  const from = c.req.query('from') ?? new Date(now.getTime() - 86_400_000).toISOString();
  const to = c.req.query('to') ?? new Date(now.getTime() + 30 * 86_400_000).toISOString();
  return c.json(await service.listSchedules(c.get('actor').id, from, to));
});

app.get('/cases/:id/briefing', async (c) => {
  const caseId = await caseAccess(c.req.param('id'), c.get('actor').id);
  // `seq` 를 주면 그 회차를 준비하던 시점으로 잘라서 본다.
  const seq = Number(c.req.query('seq'));
  const found = await service.getBriefing(caseId, Number.isFinite(seq) && seq > 0 ? seq : undefined);
  if (!found) return c.json({ error: '사례 없음' }, 404);
  if (found.participant_card.name) {
    await audit({ actorId: c.get('actor').id, action: 'case.briefing', caseId, fields: ['name'] });
  }
  return c.json(found);
});

// ── 설정하기(2026-09-16 Q) ────────────────────────────────────────────────
// 공통은 본인, 나머지는 관리자. 화면에서 감추는 것은 안내일 뿐이라 여기서 다시 막는다.

const adminOnly = (c: { get: (k: 'actor') => { role: string } }) => c.get('actor').role !== 'admin';
const DENY = { error: '관리자 전용' } as const;

// 초대장 확인·가입은 로그인 앞에 선다. 인증 미들웨어보다 위에 둘 자리가 없어
// `/auth` 아래로 보낸다 — 그 경로는 이미 열려 있다.
app.get('/settings/profile', async (c) => c.json(await settings.getProfile(c.get('actor').id)));

app.patch('/settings/profile', async (c) => {
  const body = z
    .object({
      name: z.string().trim().min(1, '이름 입력'),
      phone: z.string().trim().nullable().default(null),
      contact_email: z.string().trim().nullable().default(null),
    })
    .parse(await c.req.json());
  return c.json(await settings.updateProfile(c.get('actor').id, body));
});

app.post('/settings/deactivate', async (c) => {
  const out = await settings.deactivate(c.get('actor').id);
  if ('error' in out) return c.json(out, 409);
  // 나간 사람의 쿠키는 그 자리에서 끊는다.
  c.header('set-cookie', clearCookie());
  return c.json(out);
});

app.get('/settings/org', async (c) => c.json(await settings.getOrg()));

app.put('/settings/org', async (c) => {
  if (adminOnly(c)) return c.json(DENY, 403);
  const body = z
    .object({
      name: z.string().trim().min(1, '기관 이름을 적어 주세요.'),
      reg_no: z.string().trim().nullable().default(null),
      address: z.string().trim().nullable().default(null),
      phone: z.string().trim().nullable().default(null),
    })
    .parse(await c.req.json());
  return c.json(await settings.updateOrg(c.get('actor').id, body));
});

// 사업 목록은 누구나 읽는다 — 당사자 등록에서 고르는 선택지다.
app.get('/settings/programs', async (c) => c.json(await settings.listPrograms(c.req.query('all') === '1')));

// 날짜는 YYYY-MM-DD 만. 시작이 끝보다 늦으면 보낸 쪽 잘못이다(DB 제약이 뒤를 받친다).
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '날짜 형식이 맞지 않아요.');
const programInput = z
  .object({
    name: z.string().trim().min(1, '사업 이름을 적어 주세요.'),
    starts_on: isoDate.nullable().default(null),
    ends_on: isoDate.nullable().default(null),
    description: z.string().trim().nullable().default(null),
  })
  .refine((p) => !p.starts_on || !p.ends_on || p.starts_on <= p.ends_on, {
    message: '사업 기간의 끝이 시작보다 빠를 수 없어요.',
    path: ['ends_on'],
  });

app.post('/settings/programs', async (c) => {
  if (adminOnly(c)) return c.json(DENY, 403);
  const body = programInput.parse(await c.req.json());
  const out = await settings.addProgram(c.get('actor').id, body);
  if ('error' in out) return c.json(out, 409);
  return c.json(out.program, 201);
});

app.patch('/settings/programs/:id', async (c) => {
  if (adminOnly(c)) return c.json(DENY, 403);
  const body = z
    .object({
      name: z.string().trim().min(1, '사업 이름을 적어 주세요.').optional(),
      starts_on: isoDate.nullable().optional(),
      ends_on: isoDate.nullable().optional(),
      description: z.string().trim().nullable().optional(),
    })
    .refine((p) => !p.starts_on || !p.ends_on || p.starts_on <= p.ends_on, {
      message: '사업 기간의 끝이 시작보다 빠를 수 없어요.',
      path: ['ends_on'],
    })
    .parse(await c.req.json());
  const out = await settings.updateProgram(c.get('actor').id, positiveId(c.req.param('id')), body);
  if ('error' in out) return c.json({ error: out.error }, out.status);
  return c.json(out.program);
});

/**
 * 사업 종료. 열린 사례·예정 회차가 있으면 409 로 건수를 돌려주고 멈춘다 —
 * `?confirm=1` 로 다시 보내면 종료한다. 화면이 그 사이에 백업(scripts/backup.sh)을 권한다.
 */
app.delete('/settings/programs/:id', async (c) => {
  if (adminOnly(c)) return c.json(DENY, 403);
  const out = await settings.retireProgram(
    c.get('actor').id,
    positiveId(c.req.param('id')),
    c.req.query('confirm') === '1',
  );
  if ('error' in out) return c.json(out, 404);
  if ('warning' in out) return c.json(out.warning, 409);
  return c.json(out);
});

app.post('/settings/programs/:id/reopen', async (c) => {
  if (adminOnly(c)) return c.json(DENY, 403);
  const out = await settings.reopenProgram(c.get('actor').id, positiveId(c.req.param('id')));
  if ('error' in out) return c.json(out, 404);
  return c.json(out);
});

// `?program=<id>` 면 그 사업의 열린 사례를 맡은 실무자만 — 사업 담당은 배정에서 파생된다.
app.get('/settings/workers', async (c) => {
  const raw = c.req.query('program');
  return c.json(await settings.listWorkers(raw === undefined ? null : positiveId(raw)));
});

app.put('/settings/workers/:id/role', async (c) => {
  if (adminOnly(c)) return c.json(DENY, 403);
  const { role } = z.object({ role: z.enum(['worker', 'admin']) }).parse(await c.req.json());
  const out = await settings.setRole(c.get('actor').id, positiveId(c.req.param('id')), role);
  if ('error' in out) return c.json({ error: out.error }, out.status);
  return c.json(out);
});

/** 마법사 완료. 관리자 전용. 두 번 눌러도 처음 시각을 지킨다. */
app.post('/settings/onboarding/complete', async (c) => {
  if (adminOnly(c)) return c.json(DENY, 403);
  await settings.completeOnboarding(c.get('actor').id);
  return c.json({ ok: true, onboarded: true });
});

/**
 * OpenAI 키 넣기·지우기. 저장 전 OpenAI 에 검증하고 실패하면 400 — 저장하지 않는다.
 * 키 값은 응답에 되돌려주지 않는다. 연결 상태는 `/settings/connections` 가 출처(db|env)만 말한다.
 */
app.put('/settings/ai-key', async (c) => {
  if (adminOnly(c)) return c.json(DENY, 403);
  const { key } = z.object({ key: z.string().trim().min(1).nullable() }).parse(await c.req.json());
  const out = await settings.setAiKey(c.get('actor').id, key);
  if ('error' in out) return c.json(out, 400);
  return c.json(out);
});

app.get('/settings/workers/:id/cases', async (c) => {
  const userId = positiveId(c.req.param('id'));
  const me = c.get('actor');
  if (me.role !== 'admin' && me.id !== userId) {
    return c.json({ error: '본인이 맡은 당사자만 열람 가능' }, 403);
  }
  return c.json(await settings.workerCases(userId));
});

// ── UI 개편 L5 계약(docs/ui-plan-2026-09-18.md §4, 2026-09-18) ────────────────

/** 담당 중인 당사자 팝업(J1). 본인 것은 배정 목록과 같아 감사에 안 남고, 남의 것은 이름을 실으므로 남는다. */
app.get('/users/:id/cases', async (c) => {
  const userId = positiveId(c.req.param('id'));
  const me = c.get('actor');
  if (me.role !== 'admin' && me.id !== userId) return c.json({ error: '본인이 맡은 당사자만 열람 가능' }, 403);
  const rows = await settings.userCases(userId);
  if (me.id !== userId && rows.some((r) => r.name)) {
    await audit({ actorId: me.id, action: 'assign.view', fields: ['name', `user=${userId}`] });
  }
  return c.json(rows);
});

/** 담당 실무자 배정 목록(J3). 이름·연락처·이메일을 실으므로 한 번 남긴다(10분 접힘). */
app.get('/assign/cases', async (c) => {
  if (adminOnly(c)) return c.json(DENY, 403);
  const rawProgram = c.req.query('program');
  const page = Math.max(1, Math.floor(Number(c.req.query('page')) || 1));
  const out = await settings.assignCases({
    q: (c.req.query('q') ?? '').trim(),
    programId: rawProgram ? positiveId(rawProgram) : null,
    page,
  });
  if (out.items.length > 0) {
    await audit({ actorId: c.get('actor').id, action: 'assign.view', fields: ['name', 'phone', 'email'] });
  }
  return c.json({ ...out, page, page_size: settings.ASSIGN_PAGE });
});

/** 배정 전체 치환(J3·D7). `/settings/assign` 과 같은 일이다 — 계약 경로로도 연다. */
app.put('/cases/:id/assignments', async (c) => {
  if (adminOnly(c)) return c.json(DENY, 403);
  const caseId = positiveId(c.req.param('id'));
  const body = z.object({ user_ids: z.array(z.number().int().positive()) }).parse(await c.req.json());
  const out = await settings.assign(c.get('actor').id, caseId, body.user_ids);
  if ('error' in out) return c.json(out, out.error === '사례 없음' ? 404 : 409);
  return c.json({ ok: true, assignees: (await settings.listAssignments()).find((a) => a.id === caseId)?.assignees ?? [] });
});

/** 배정 요청 승인(J4). 승인 트랜잭션에서 `case_assignments` 에 넣는다(`decideRequest`). */
app.post('/assignment-requests/:id/approve', async (c) => {
  if (adminOnly(c)) return c.json(DENY, 403);
  const out = await settings.decideRequest(c.get('actor').id, positiveId(c.req.param('id')), 'approved');
  if ('error' in out) return c.json(out, 409);
  return c.json({ ok: true });
});

app.get('/settings/assignments', async (c) => {
  if (adminOnly(c)) return c.json(DENY, 403);
  return c.json(await settings.listAssignments());
});

app.post('/settings/assign', async (c) => {
  if (adminOnly(c)) return c.json(DENY, 403);
  const body = z
    .object({
      case_id: z.number().int().positive(),
      user_ids: z.array(z.number().int().positive()),
    })
    .parse(await c.req.json());
  const out = await settings.assign(c.get('actor').id, body.case_id, body.user_ids);
  if ('error' in out) return c.json(out, 409);
  return c.json({ ok: true });
});

app.get('/settings/invites', async (c) => {
  if (adminOnly(c)) return c.json(DENY, 403);
  return c.json(await settings.listInvites());
});

app.post('/settings/invites', async (c) => {
  if (adminOnly(c)) return c.json(DENY, 403);
  const body = z
    .object({ role: z.enum(['worker', 'admin']), note: z.string().trim().nullable().default(null) })
    .parse(await c.req.json());
  return c.json(await settings.createInvite(c.get('actor').id, body.role, body.note));
});

app.delete('/settings/invites/:id', async (c) => {
  if (adminOnly(c)) return c.json(DENY, 403);
  return c.json(await settings.revokeInvite(c.get('actor').id, Number(c.req.param('id'))));
});

app.get('/settings/requests', async (c) => {
  const me = c.get('actor');
  // 관리자는 전부 본다. 실무자는 자기 것만 — 남이 누구를 맡겠다고 했는지는 그의 일이 아니다.
  return c.json(await settings.listRequests(me.role === 'admin' ? null : me.id));
});

app.post('/settings/requests', async (c) => {
  const body = z
    .object({ case_id: z.number().int().positive(), reason: z.string().trim().nullable().default(null) })
    .parse(await c.req.json());
  const out = await settings.requestAssignment(c.get('actor').id, body.case_id, body.reason);
  if ('error' in out) return c.json(out, 409);
  return c.json(out);
});

app.post('/settings/requests/:id', async (c) => {
  if (adminOnly(c)) return c.json(DENY, 403);
  const requestId = positiveId(c.req.param('id'));
  const { decision } = z.object({ decision: z.enum(['approved', 'rejected']) }).parse(await c.req.json());
  const out = await settings.decideRequest(c.get('actor').id, requestId, decision);
  if ('error' in out) return c.json(out, 409);
  return c.json({ ok: true });
});

/**
 * 지금 쓰는 동의 문안. DB 판이 있으면 그것, 없으면 코드 정본(`consent.ts`·`consent-copy.ts`).
 *
 * 관리자 전용이 아니다. **동의를 받는 화면이 이것을 써야 한다** — 화면이 문안을 복사해 두면
 * 서버 문안이 바뀌어도 화면은 옛 글을 보여 주며 동의를 받는다. 그렇게 받은 동의는
 * 당사자가 본 적 없는 문안에 대한 동의다(2026-09-16 검수에서 실제로 그 상태였다).
 *
 * 꺼진 영역은 내지 않는다 — 음성이 꺼져 있으면 녹음 동의를 받을 이유가 없다.
 * `editable` 은 관리자에게만 true 다(2026-09-18 Q D6). 판·지문은 설정 › 동의서 관리에만 보인다(D9).
 */
const consentCopyView = (domain: (typeof CONSENT_DOMAINS)[number]) => {
  const c = copyText(domain);
  return {
    domain,
    label: c.label,
    body: c.copy,
    items: c.items,
    purpose_text: c.purposeText,
    retention_text: c.retentionText,
    refusal_text: c.refusalText,
    recipient: c.provider ? `${c.provider.legalRecipient} (${c.provider.country})` : null,
    // 개인정보 수집·이용이 없으면 사례를 열 수 없다. 나머지는 골라 받는다.
    required: domain === 'personal_data_collection_use',
    version: copyVersion(),
    hash: copyHash(domain).slice(0, 12),
  };
};

app.get('/consent-copy', async (c) => {
  const editable = c.get('actor').role === 'admin';
  return c.json(activeDomains().map((domain) => ({ ...consentCopyView(domain), editable })));
});

/**
 * 문안 고치기(2026-09-18 Q D6 — §21-3 "버튼은 아직 없다"를 대체). 관리자 전용.
 * 새 판 `consent-standard-form-v<N+1>` 이 되고 **모든 영역의 지난 동의가 `확인 필요`로 떨어진다** —
 * 경고창은 화면이 띄우고, 다시 받는 고지는 기관 절차다. 수신자·보유기간 값은 코드 정본이라 여기서 못 바꾼다.
 */
app.put('/consent-copy/:domain', async (c) => {
  if (adminOnly(c)) return c.json(DENY, 403);
  const domain = z.enum(CONSENT_DOMAINS).parse(c.req.param('domain'));
  const body = z
    .object({
      copy: z.string().trim().min(1),
      items: z.array(z.string().trim().min(1)).min(1),
      purpose_text: z.string().trim().min(1),
      retention_text: z.string().trim().min(1),
      refusal_text: z.string().trim().min(1),
    })
    .parse(await c.req.json());
  await putConsentCopy(c.get('actor').id, domain, {
    copy: body.copy,
    items: body.items,
    purposeText: body.purpose_text,
    retentionText: body.retention_text,
    refusalText: body.refusal_text,
  });
  return c.json({ ...consentCopyView(domain), editable: true });
});

/**
 * 연결 상태 — AI·전사·데이터베이스가 지금 붙어 있는지.
 *
 * **키를 화면으로 보내지 않는다.** 붙었는지 여부와 어느 제공자인지까지다.
 * 설정 자체(키 넣기)는 아직 없다 — 기관 서버의 환경 변수로 넣는다. 그 사실을 화면이 말한다.
 */
app.get('/settings/connections', async (c) => {
  if (adminOnly(c)) return c.json(DENY, 403);
  const [{ now }] = await sql<Array<{ now: string }>>`select now()`;
  const provider = process.env.AI_PROVIDER ?? 'openai';
  // 출처만 말한다(db|env|null). 키 값은 어떤 응답에도 싣지 않는다.
  const ai = provider === 'openai' ? await openAiKey() : null;
  return c.json({
    ai: {
      connected: provider === 'openai' ? ai !== null : Boolean(process.env.GEMINI_API_KEY),
      provider,
      model: process.env.AI_MODEL ?? 'gpt-5.5',
      env: 'OPENAI_API_KEY',
      source: ai?.source ?? null,
    },
    stt: {
      connected: Boolean(process.env.AZURE_SPEECH_KEY),
      provider: 'azure',
      region: process.env.AZURE_SPEECH_REGION ?? null,
      env: 'AZURE_SPEECH_KEY',
    },
    db: { connected: true, checked_at: now, env: 'DATABASE_URL' },
  });
});
