// 라우터 하나, 검증 한 곳. 베타 API 6개(PLAN §5).
import { Hono } from 'hono';
import { z } from 'zod';
import { actorFromCookie, clearCookie, issueCookie, login, type Actor } from './auth.ts';
import {
  approveTranscript,
  draftTranscript,
  latestTranscript,
  saveRecording,
  SttUnavailable,
} from './stt.ts';
import { AiUnavailable, approveDraft, draftSession, latestDraft } from './ai.ts';
import { audit, listAudit } from './audit.ts';
import { accessState, issueAccess, openAccess, revokeAccess } from './participant-access.ts';
import { CONSENT_DECISIONS, CONSENT_DOMAINS } from './consent.ts';
import { LIFE_AREAS } from './domain/types.ts';
import * as service from './service.ts';

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

app.get('/audit', async (c) => {
  // 열람 기록은 관리자만 본다(GLOSSARY §6-7 설정 › 열람 기록).
  if (c.get('actor').role !== 'admin') return c.json({ error: '관리자만 볼 수 있어요.' }, 403);
  return c.json(await listAudit());
});

app.post('/cases/:id/close', async (c) => {
  const body = z
    .object({ close_reason: z.string().min(1), unfinished_note: z.string().nullish() })
    .parse(await c.req.json());
  return c.json(
    await service.closeCase(Number(c.req.param('id')), { ...body, actorId: c.get('actor').id }),
  );
});

app.get('/participants', async (c) => {
  const rows = await service.listParticipants();
  // 목록에 실은 PII 는 이름뿐이다. 실은 사람 수가 아니라 조회 1건으로 남긴다.
  if (rows.some((r) => r.name)) {
    await audit({ actorId: c.get('actor').id, action: 'participants.list', fields: ['name'] });
  }
  return c.json(rows);
});

app.get('/schedules', async (c) => {
  const now = new Date();
  const from = c.req.query('from') ?? new Date(now.getTime() - 86_400_000).toISOString();
  const to = c.req.query('to') ?? new Date(now.getTime() + 30 * 86_400_000).toISOString();
  const rows = await service.listSchedules(from, to);
  if (rows.some((r) => r.name)) {
    await audit({ actorId: c.get('actor').id, action: 'schedule.list', fields: ['name'] });
  }
  return c.json(rows);
});

app.get('/cases/:id/briefing', async (c) => {
  const caseId = Number(c.req.param('id'));
  const found = await service.getBriefing(caseId);
  if (!found) return c.json({ error: 'not found' }, 404);
  if (found.participant_card.name) {
    await audit({ actorId: c.get('actor').id, action: 'case.briefing', caseId, fields: ['name'] });
  }
  return c.json(found);
});
