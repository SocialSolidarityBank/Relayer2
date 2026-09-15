// 라우터 하나, 검증 한 곳. 베타 API 6개(PLAN §5).
import { Hono } from 'hono';
import { z } from 'zod';
import { actorFromCookie, clearCookie, issueCookie, login, type Actor } from './auth.ts';
import { audit, listAudit } from './audit.ts';
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
  throw err;
});

app.get('/health', (c) => c.json({ ok: true }));

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
const isWebAsset = (path: string): boolean =>
  path === '/' || path.startsWith('/assets/') || /\.[a-z0-9]+$/i.test(path);

// 여기부터는 로그인한 사람만. 실패는 401 하나로 답한다(무엇이 있는지 알려주지 않는다).
app.use('*', async (c, next) => {
  if (c.req.method === 'GET' && isWebAsset(new URL(c.req.url).pathname)) return next();
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
