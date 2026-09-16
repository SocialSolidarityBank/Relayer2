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
  saveRecording,
  SttUnavailable,
} from './stt.ts';
import { AiUnavailable, approveDraft, draftSession, latestDraft } from './ai.ts';
import { audit, listAudit, AUDIT_KIND_LIST } from './audit.ts';
import { accessState, issueAccess, openAccess, revokeAccess } from './participant-access.ts';
import { CONSENT_COPY, CONSENT_DECISIONS, CONSENT_DOMAINS, copyHash } from './consent.ts';
import { LIFE_AREAS } from './domain/types.ts';
import * as service from './service.ts';
import * as settings from './settings.ts';
import { sql } from './db.ts';

// 영역은 국가 표준 10종+기타 하나뿐이다(SPEC §8). 여기에 목록을 또 적으면 이번처럼 어긋난다.
const area = z.enum(LIFE_AREAS);

const cardInput = z.object({
  kind: z.enum(['fact', 'question', 'promise', 'judgment']),
  text: z.string().min(1),
  section: z.enum(['intake', 'memo', 'change', 'promise', 'question', 'judgment']),
  area: area.optional(),
  risk_type: z.string().optional(),
  quote: z.string().optional(),
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
  if (err instanceof service.ConsentRequired) return c.json({ error: err.message }, 409);
  // AI 는 없어도 제품이 돌아간다. 없는 것을 있는 것처럼 답하지 않는다.
  if (err instanceof AiUnavailable || err instanceof SttUnavailable) {
    return c.json({ error: err.message }, 503);
  }
  // 받지 않는 파일은 **보낸 쪽 잘못**이다. 서버 고장이 아니다.
  if (err instanceof DocumentRejected) return c.json({ error: err.message }, 400);
  // 입력이 스키마에 안 맞으면 **보낸 쪽 잘못**이다. 500 으로 답하면 서버가 고장난 줄 안다.
  // 어느 자리가 틀렸는지만 알려 준다 — 보낸 값은 되돌려주지 않는다(PII 가 섞여 있다).
  if (err instanceof z.ZodError) {
    const where = err.issues.map((i) => i.path.join('.') || '(본문)').join(', ');
    return c.json({ error: `요청 형식이 맞지 않아요: ${where}` }, 400);
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
        ? '당사자는 로그인하지 않아요. 실무자가 보낸 링크와 코드로 열어요.'
        : '아이디나 비밀번호가 맞지 않아요.';
    return c.json({ error: message }, 401);
  }
  c.header('set-cookie', issueCookie(result.actor.id));
  return c.json(result.actor);
});

app.get('/auth/invite/:token', async (c) => {
  const found = await settings.peekInvite(c.req.param('token'));
  if (!found) return c.json({ error: '쓸 수 없는 초대예요. 기한이 지났거나 이미 쓰였어요.' }, 404);
  return c.json(found);
});

app.post('/auth/invite/:token', async (c) => {
  const body = z
    .object({
      email: z.string().trim().min(2, '아이디를 적어 주세요.'),
      password: z.string().min(4, '비밀번호는 네 자 이상이어야 해요.'),
      name: z.string().trim().min(1, '이름을 적어 주세요.'),
    })
    .parse(await c.req.json());
  const out = await settings.signUpWithInvite({ token: c.req.param('token'), ...body });
  if ('error' in out) return c.json(out, 409);
  c.header('set-cookie', issueCookie(out.userId));
  return c.json({ ok: true });
});

app.post('/auth/logout', (c) => {
  c.header('set-cookie', clearCookie());
  return c.json({ ok: true });
});

/**
 * 화면 껍데기(HTML·JS·CSS)는 로그인 전에도 받아야 로그인 화면이 뜬다.
 * 자료는 그 뒤 API 가 내고 그건 전부 막혀 있다. API 경로에는 확장자가 없다.
 */
/** 당사자 열람은 로그인 없이 연다. 대신 링크와 코드 두 자물쇠를 통과해야 한다. */
const isParticipantGate = (path: string): boolean => path === '/access/open';

/**
 * 화면으로 들어오는 주소. 여기 없는 확장자 없는 경로는 전부 API 로 본다.
 * `/test` 는 관문 2 측정용 입구다 — 참가자에게 `relayer.kr/test` 한 줄만 주면 된다.
 * 목록으로 두는 이유: 아무 경로나 화면으로 열면 API 오타가 404 대신 화면을 뱉어 원인을 못 찾는다.
 */
const WEB_ENTRIES = new Set(['/', '/test']);

const isWebAsset = (path: string): boolean =>
  WEB_ENTRIES.has(path) || path.startsWith('/assets/') || /\.[a-z0-9]+$/i.test(path);

// 여기부터는 로그인한 사람만. 실패는 401 하나로 답한다(무엇이 있는지 알려주지 않는다).
app.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (c.req.method === 'GET' && isWebAsset(path)) return next();
  if (c.req.method === 'POST' && isParticipantGate(path)) return next();
  const actor = await actorFromCookie(c.req.header('cookie'));
  if (!actor) return c.json({ error: '로그인이 필요해요.' }, 401);
  c.set('actor', actor);
  await next();
});

app.get('/me', (c) => c.json(c.get('actor')));

app.post('/cases', async (c) => {
  const body = z
    .object({
      name: z.string().min(1),
      phone: z.string().optional(),
      email: z.string().optional(),
      birth: z.string().optional(),
      address: z.string().optional(),
      program_name: z.string().min(1),
      sessions_planned: z.number().int().positive().optional(),
      consents: z
        .array(z.object({ domain: z.enum(CONSENT_DOMAINS), decision: z.enum(CONSENT_DECISIONS) }))
        .optional(),
    })
    .parse(await c.req.json());
  // 개인정보 수집·이용 동의 없이는 사례를 열지 않는다(P1 게이트).
  const personal = body.consents?.find((x) => x.domain === 'personal_data_collection_use');
  if (personal?.decision !== 'grant') {
    return c.json({ error: '개인정보 수집·이용 동의를 받아야 당사자를 등록할 수 있어요.' }, 400);
  }
  return c.json(await service.createCase({ ...body, actorId: c.get('actor').id }), 201);
});

app.put('/cases/:id/intake', async (c) => {
  const body = z
    .object({
      held_at: z.string().optional(),
      memo: z.string().optional(),
      // 전체 상담 목표는 비워둘 수 있다.
      overall_goal: z.string().nullable().optional(),
      detail: z.record(z.unknown()).optional(),
      cards: z.array(cardInput).optional(),
    })
    .parse(await c.req.json());
  return c.json(await service.saveIntake(Number(c.req.param('id')), body));
});

app.post('/cases/:id/sessions', async (c) => {
  const body = z
    .object({
      scheduled_at: z.string(),
      method: z.enum(['in_person', 'phone', 'video', 'visit']),
      place: z.string().optional(),
      plan_memo: z.string().optional(),
      is_closing: z.boolean().optional(),
    })
    .parse(await c.req.json());
  if (body.place && body.method !== 'in_person') {
    return c.json({ error: '상담 장소는 대면일 때만 적어요.' }, 400);
  }
  return c.json(await service.planSession(Number(c.req.param('id')), body), 201);
});

app.get('/cases/:id', async (c) => {
  const found = await service.getCase(Number(c.req.param('id')));
  return found ? c.json(found) : c.json({ error: 'not found' }, 404);
});

app.get('/sessions/:id', async (c) => {
  const found = await service.getSessionRecord(Number(c.req.param('id')));
  return found ? c.json(found) : c.json({ error: '회차를 찾지 못했어요.' }, 404);
});

app.patch('/sessions/:id', async (c) => {
  const body = z
    .object({
      held_at: z.string().optional(),
      memo: z.string().min(1), // 유일한 필수 입력
      method: z.enum(['in_person', 'phone', 'video', 'visit']).optional(),
      place: z.string().optional(),
      detail: z.record(z.unknown()).optional(),
      next_goal_text: z.string().nullable().optional(),
      overall_goal: z.string().nullable().optional(),
      cards: z.array(cardInput).optional(),
      outcomes: z.array(outcomeInput).optional(),
      is_closing: z.boolean().optional(),
    })
    .parse(await c.req.json());
  return c.json(await service.recordSession(Number(c.req.param('id')), { ...body, actorId: c.get('actor').id }));
});

const consentInput = z.object({
  domain: z.enum(CONSENT_DOMAINS),
  decision: z.enum(CONSENT_DECISIONS),
});

app.get('/cases/:id/consents', async (c) => {
  const found = await service.getConsents(Number(c.req.param('id')));
  return found ? c.json(found) : c.json({ error: '사례를 찾지 못했어요.' }, 404);
});

app.post('/cases/:id/consents', async (c) => {
  const body = consentInput.parse(await c.req.json());
  const caseId = Number(c.req.param('id'));
  const view = await service.recordConsent(caseId, { ...body, actorId: c.get('actor').id });
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
  const found = await service.getIntake(Number(c.req.param('id')));
  return found ? c.json(found) : c.json({ error: '사례를 찾지 못했어요.' }, 404);
});

app.get('/cases/:id/detail', async (c) => {
  const detail = await service.getCaseDetail(Number(c.req.param('id')));
  if (!detail) return c.json({ error: '사례를 찾지 못했어요.' }, 404);
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
      ? `코드가 맞지 않아요. ${result.attempts_left}번 더 넣을 수 있어요.`
      : result.reason === 'expired'
        ? '링크가 만료됐어요. 담당 실무자에게 새 링크를 받아 주세요.'
        : result.reason === 'locked'
          ? '여러 번 틀려서 잠겼어요. 담당 실무자에게 새 링크를 받아 주세요.'
          : '링크가 올바르지 않아요.';
  return c.json({ error: message }, 401);
});

app.get('/participants/:id/access', async (c) =>
  c.json(await accessState(Number(c.req.param('id')))),
);

app.post('/participants/:id/access', async (c) => {
  const participantId = Number(c.req.param('id'));
  const issued = await issueAccess(participantId, c.get('actor').id);
  await audit({
    actorId: c.get('actor').id,
    action: 'consent.record',
    participantId,
    fields: ['access:issue'],
  });
  return c.json(issued);
});

app.delete('/participants/:id/access', async (c) => {
  await revokeAccess(Number(c.req.param('id')));
  return c.json({ ok: true });
});

app.get('/sessions/:id/draft', async (c) => {
  const found = await latestDraft(Number(c.req.param('id')));
  return c.json(found ?? { status: 'none' });
});

app.post('/sessions/:id/draft', async (c) =>
  c.json(await draftSession(Number(c.req.param('id')), c.get('actor').id)),
);

app.post('/sessions/:id/draft/approve', async (c) => {
  const body = z
    .object({
      summary: z.string().optional(),
      tasks: z.array(z.string()).optional(),
      questions: z.array(z.string()).optional(),
    })
    .parse(await c.req.json().catch(() => ({})));
  return c.json(await approveDraft(Number(c.req.param('id')), c.get('actor').id, body));
});

/**
 * 음성 경로(P4). 녹음은 본문 그대로 받는다 — multipart 로 감싸 봐야 바이트는 같고,
 * 파싱 단계가 하나 늘면 그만큼 실패할 자리가 는다.
 */
app.post('/sessions/:id/recordings', async (c) => {
  const audio = new Uint8Array(await c.req.arrayBuffer());
  const ms = Number(c.req.query('duration_ms'));
  return c.json(
    await saveRecording(Number(c.req.param('id')), audio, c.get('actor').id, Number.isFinite(ms) ? ms : undefined),
    201,
  );
});

/**
 * 회차의 불일치 둘. 한 목록에 섞지 않는다(요구 23).
 * 판정하지 않는다 — 달라졌다는 사실만 낸다. 고치는 것은 사람이다.
 */
app.get('/sessions/:id/mismatches', async (c) =>
  c.json(await service.getMismatches(Number(c.req.param('id')))),
);

app.get('/sessions/:id/transcript', async (c) => {
  const found = await latestTranscript(Number(c.req.param('id')));
  return c.json(found ?? { status: 'none' });
});

app.post('/recordings/:id/transcript', async (c) =>
  c.json(await draftTranscript(Number(c.req.param('id')), c.get('actor').id)),
);

app.post('/sessions/:id/transcript/approve', async (c) => {
  const body = z.object({ text: z.string().optional() }).parse(await c.req.json().catch(() => ({})));
  return c.json(await approveTranscript(Number(c.req.param('id')), c.get('actor').id, body.text));
});

/**
 * 서면 문서(2026-09-16 Q). 본문 그대로 받는다 — 이름과 형식은 쿼리로 온다.
 * multipart 로 감싸도 바이트는 같고, 파싱 단계가 늘면 그만큼 실패할 자리가 는다.
 */
app.post('/cases/:id/documents', async (c) => {
  const sid = Number(c.req.query('session_id'));
  return c.json(
    await saveDocument({
      caseId: Number(c.req.param('id')),
      sessionId: Number.isFinite(sid) ? sid : null,
      label: c.req.query('label') ?? '',
      contentType: c.req.header('content-type') ?? '',
      bytes: new Uint8Array(await c.req.arrayBuffer()),
      actorId: c.get('actor').id,
    }),
    201,
  );
});

app.get('/cases/:id/documents', async (c) => c.json(await listDocuments(Number(c.req.param('id')))));

app.get('/documents/:id', async (c) => {
  const { row, bytes } = await readDocument(Number(c.req.param('id')), c.get('actor').id);
  // 파일 이름은 사람이 붙인 이름을 쓴다. 원본 파일명은 저장하지 않는다.
  return new Response(bytes, {
    headers: {
      'content-type': row.content_type,
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(row.label)}`,
      'cache-control': 'no-store',
    },
  });
});

app.get('/audit', async (c) => {
  // 열람 기록은 관리자만 본다(GLOSSARY §6-7 설정 › 열람 기록).
  if (c.get('actor').role !== 'admin') return c.json({ error: '관리자만 볼 수 있어요.' }, 403);
  const kind = c.req.query('kind');
  const rows = await listAudit({
    kind: AUDIT_KIND_LIST.find((k) => k === kind),
  });
  // 이 화면은 이름을 꺼내 보여 준다. 그러니 이 화면을 연 것도 남는다.
  await audit({ actorId: c.get('actor').id, action: 'audit.view', fields: ['name'] });
  return c.json(rows);
});

app.post('/cases/:id/close', async (c) => {
  const body = z
    .object({ close_reason: z.string().min(1), unfinished_note: z.string().nullish() })
    .parse(await c.req.json());
  return c.json(
    await service.closeCase(Number(c.req.param('id')), { ...body, actorId: c.get('actor').id }),
  );
});

// 목록 조회는 감사에 남기지 않는다(2026-09-16 Q). 화면을 여는 것마다 한 줄이면
// 기록이 아니라 소음이다 — 실측으로 700줄 가운데 676줄이 목록 조회였다.
// 누구의 무엇을 봤는지는 사례를 열 때 남는다.
app.get('/participants', async (c) => c.json(await service.listParticipants()));

app.get('/schedules', async (c) => {
  const now = new Date();
  const from = c.req.query('from') ?? new Date(now.getTime() - 86_400_000).toISOString();
  const to = c.req.query('to') ?? new Date(now.getTime() + 30 * 86_400_000).toISOString();
  return c.json(await service.listSchedules(from, to));
});

app.get('/cases/:id/briefing', async (c) => {
  const caseId = Number(c.req.param('id'));
  // `seq` 를 주면 그 회차를 준비하던 시점으로 잘라서 본다.
  const seq = Number(c.req.query('seq'));
  const found = await service.getBriefing(caseId, Number.isFinite(seq) && seq > 0 ? seq : undefined);
  if (!found) return c.json({ error: 'not found' }, 404);
  if (found.participant_card.name) {
    await audit({ actorId: c.get('actor').id, action: 'case.briefing', caseId, fields: ['name'] });
  }
  return c.json(found);
});

// ── 설정하기(2026-09-16 Q) ────────────────────────────────────────────────
// 공통은 본인, 나머지는 관리자. 화면에서 감추는 것은 안내일 뿐이라 여기서 다시 막는다.

const adminOnly = (c: { get: (k: 'actor') => { role: string } }) => c.get('actor').role !== 'admin';
const DENY = { error: '관리자만 할 수 있어요.' } as const;

// 초대장 확인·가입은 로그인 앞에 선다. 인증 미들웨어보다 위에 둘 자리가 없어
// `/auth` 아래로 보낸다 — 그 경로는 이미 열려 있다.
app.get('/settings/profile', async (c) => c.json(await settings.getProfile(c.get('actor').id)));

app.patch('/settings/profile', async (c) => {
  const body = z
    .object({
      name: z.string().trim().min(1, '이름을 적어 주세요.'),
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
      name: z.string().trim(),
      reg_no: z.string().trim().nullable().default(null),
      address: z.string().trim().nullable().default(null),
      phone: z.string().trim().nullable().default(null),
    })
    .parse(await c.req.json());
  return c.json(await settings.updateOrg(c.get('actor').id, body));
});

// 사업 목록은 누구나 읽는다 — 당사자 등록에서 고르는 선택지다.
app.get('/settings/programs', async (c) => c.json(await settings.listPrograms(c.req.query('all') === '1')));

app.post('/settings/programs', async (c) => {
  if (adminOnly(c)) return c.json(DENY, 403);
  const { name } = z.object({ name: z.string().trim().min(1, '사업 이름을 적어 주세요.') }).parse(await c.req.json());
  return c.json(await settings.addProgram(c.get('actor').id, name));
});

app.delete('/settings/programs/:id', async (c) => {
  if (adminOnly(c)) return c.json(DENY, 403);
  return c.json(await settings.retireProgram(c.get('actor').id, Number(c.req.param('id'))));
});

app.get('/settings/workers', async (c) => c.json(await settings.listWorkers()));

app.get('/settings/workers/:id/cases', async (c) =>
  c.json(await settings.workerCases(Number(c.req.param('id')))),
);

app.post('/settings/assign', async (c) => {
  if (adminOnly(c)) return c.json(DENY, 403);
  const body = z
    .object({ case_id: z.number().int().positive(), user_id: z.number().int().positive().nullable() })
    .parse(await c.req.json());
  await settings.assign(c.get('actor').id, body.case_id, body.user_id);
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
  const { decision } = z.object({ decision: z.enum(['approved', 'rejected']) }).parse(await c.req.json());
  await settings.decideRequest(c.get('actor').id, Number(c.req.param('id')), decision);
  return c.json({ ok: true });
});

/**
 * 연결 상태 — AI·전사·데이터베이스가 지금 붙어 있는지.
 *
 * **키를 화면으로 보내지 않는다.** 붙었는지 여부와 어느 제공자인지까지다.
 * 설정 자체(키 넣기)는 아직 없다 — 기관 서버의 환경 변수로 넣는다. 그 사실을 화면이 말한다.
 */
/**
 * 지금 쓰는 동의 문안. **읽기만 한다** — 문안은 코드가 정본이다(`consent.ts`).
 * 화면에서 고치게 하면 글자 하나에 이미 받은 동의가 전부 `확인 필요`로 떨어진다.
 */
app.get('/settings/consent-copy', async (c) => {
  if (adminOnly(c)) return c.json(DENY, 403);
  return c.json(
    CONSENT_DOMAINS.map((domain) => ({
      domain,
      label: CONSENT_COPY[domain].label,
      body: CONSENT_COPY[domain].copy,
      purpose: CONSENT_COPY[domain].purpose,
      hash: copyHash(domain).slice(0, 12),
    })),
  );
});

app.get('/settings/connections', async (c) => {
  if (adminOnly(c)) return c.json(DENY, 403);
  const [{ now }] = await sql<Array<{ now: string }>>`select now()`;
  return c.json({
    ai: {
      connected: Boolean(process.env.OPENAI_API_KEY),
      provider: process.env.AI_PROVIDER ?? 'openai',
      model: process.env.AI_MODEL ?? 'gpt-5.5',
      env: 'OPENAI_API_KEY',
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
