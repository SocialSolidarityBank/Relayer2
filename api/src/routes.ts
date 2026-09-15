// 라우터 하나, 검증 한 곳. 베타 API 6개(PLAN §5).
import { Hono } from 'hono';
import { z } from 'zod';
import { actorFromCookie, clearCookie, issueCookie, login, type Actor } from './auth.ts';
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

// 여기부터는 로그인한 사람만. 실패는 401 하나로 답한다(무엇이 있는지 알려주지 않는다).
app.use('*', async (c, next) => {
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
    })
    .parse(await c.req.json());
  return c.json(await service.createCase(body), 201);
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

app.get('/cases/:id/intake', async (c) => {
  const found = await service.getIntake(Number(c.req.param('id')));
  return found ? c.json(found) : c.json({ error: '사례를 찾지 못했어요.' }, 404);
});

app.get('/cases/:id/detail', async (c) => {
  const detail = await service.getCaseDetail(Number(c.req.param('id')));
  return detail ? c.json(detail) : c.json({ error: '사례를 찾지 못했어요.' }, 404);
});

app.post('/cases/:id/close', async (c) => {
  const body = z
    .object({ close_reason: z.string().min(1), unfinished_note: z.string().nullish() })
    .parse(await c.req.json());
  return c.json(
    await service.closeCase(Number(c.req.param('id')), { ...body, actorId: c.get('actor').id }),
  );
});

app.get('/participants', async (c) => c.json(await service.listParticipants()));

app.get('/schedules', async (c) => {
  const now = new Date();
  const from = c.req.query('from') ?? new Date(now.getTime() - 86_400_000).toISOString();
  const to = c.req.query('to') ?? new Date(now.getTime() + 30 * 86_400_000).toISOString();
  return c.json(await service.listSchedules(from, to));
});

app.get('/cases/:id/briefing', async (c) => {
  const found = await service.getBriefing(Number(c.req.param('id')));
  return found ? c.json(found) : c.json({ error: 'not found' }, 404);
});
