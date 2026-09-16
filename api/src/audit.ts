// 열람 기록(P1). 정본 규칙: PII 를 실은 화면 조회 1건 = 감사 1행, 실은 항목은 그 행의 fields 에.
// 값은 남기지 않는다 — 항목 이름만 남긴다. 감사 기록이 또 하나의 개인정보 창고가 되면 안 된다.
import { sql } from './db.ts';
import { decryptPii } from './pii.ts';

/**
 * 남기는 사건과 그 뜻(2026-09-16 Q — "모든 게 다 찍히는 게 아니라 특정 액션만").
 *
 * **목록 조회는 남기지 않는다.** 화면을 여는 것마다 한 줄이면 기록이 아니라 소음이다.
 * 실측으로 700줄 가운데 676줄이 `일정 목록`·`당사자 목록`이었고, 그 사이에 묻힌
 * 실제 사건은 24줄이었다. 목록에는 가명과 회차만 실려 PII 값이 나가지 않는다 —
 * 남길 값이 없는 조회를 남기는 것은 감사가 아니라 접속 기록이다.
 *
 * `kind` 셋은 화면에서 거르는 축이다.
 * - `열람` — 누가 누구의 무엇을 봤나. 개인정보 통제의 본체다.
 * - `기록` — 상담 자료가 바뀐 일. 동의·AI·음성·문서.
 * - `운영` — 사람과 기관을 건드린 일. 배정·초대·설정.
 *
 * `fold` 는 같은 사람이 같은 대상을 짧은 사이에 다시 열었을 때 한 줄로 접는다는 뜻이다.
 * 15초 다시보기는 상담 중에 몇 번이고 다시 보는 화면이라 그대로 두면 그 사람만 백 줄이 된다.
 */
export const AUDIT_KINDS = {
  'case.detail': { kind: '열람', label: '당사자 정보 조회', fold: true },
  'case.briefing': { kind: '열람', label: '15초 다시보기 조회', fold: true },
  'participant.view': { kind: '열람', label: '당사자 본인 열람', fold: true },
  'document.read': { kind: '열람', label: '서면 문서 내려받기', fold: false },
  'audit.view': { kind: '열람', label: '열람 기록 조회', fold: true },

  'consent.record': { kind: '기록', label: '동의 받음', fold: false },
  'ai.draft': { kind: '기록', label: '외부 AI 로 보냄', fold: false },
  'ai.approve': { kind: '기록', label: 'AI 초안 승인', fold: false },
  'document.add': { kind: '기록', label: '서면 문서 올림', fold: false },
  'document.sweep': { kind: '기록', label: '기한 지난 문서 삭제', fold: false },
  'voice.record': { kind: '기록', label: '녹음 저장', fold: false },
  'voice.transcribe': { kind: '기록', label: '전사함', fold: false },
  'voice.approve': { kind: '기록', label: '전사 승인', fold: false },
  'voice.sweep': { kind: '기록', label: '기한 지난 녹음 삭제', fold: false },

  'assignment.request': { kind: '운영', label: '담당 배정 요청', fold: false },
  'assignment.decide': { kind: '운영', label: '담당 배정 결정', fold: false },
  'case.assign': { kind: '운영', label: '담당 바꿈', fold: false },
  'invite.create': { kind: '운영', label: '초대 링크 만듦', fold: false },
  'invite.revoke': { kind: '운영', label: '초대 취소', fold: false },
  'invite.accept': { kind: '운영', label: '초대로 들어옴', fold: false },
  'org.update': { kind: '운영', label: '기관 정보 고침', fold: false },
  'program.add': { kind: '운영', label: '사업 더함', fold: false },
  'program.retire': { kind: '운영', label: '사업 내림', fold: false },
  'user.profile.update': { kind: '운영', label: '내 정보 고침', fold: false },
  'user.deactivate': { kind: '운영', label: '계정 삭제', fold: false },
} as const;

export type AuditAction = keyof typeof AUDIT_KINDS;
export type AuditKind = (typeof AUDIT_KINDS)[AuditAction]['kind'];

export const AUDIT_KIND_LIST = ['열람', '기록', '운영'] as const;

export type AuditEntry = {
  /** 0 이면 당사자 본인이다(로그인 사용자가 아니다). */
  actorId: number;
  action: AuditAction;
  participantId?: number | null;
  caseId?: number | null;
  /** 실제로 응답에 실은 PII 항목 이름. 값이 아니라 이름이다. */
  fields?: string[];
};

/** 접는 창. 같은 사람이 같은 대상을 이 사이에 다시 열면 새 줄을 만들지 않는다. */
const FOLD_MINUTES = 10;

/**
 * 감사 한 줄. 화면 응답을 막지 않도록 실패해도 삼킨다 —
 * 다만 삼킨 사실은 서버 로그에 남긴다(조용히 사라지면 감사가 아니다).
 */
export async function audit(entry: AuditEntry): Promise<void> {
  const spec = AUDIT_KINDS[entry.action];
  if (!spec) {
    console.error('audit: 모르는 사건', entry.action);
    return;
  }
  try {
    if (spec.fold) {
      // 같은 사람·같은 대상·같은 행위가 방금 있었으면 접는다. 몇 번 봤는지가 아니라
      // 봤다는 사실이 감사의 내용이다.
      const [recent] = await sql<Array<{ id: number }>>`
        select id from audit_log
        where actor_id is not distinct from ${entry.actorId || null}
          and action = ${entry.action}
          and case_id is not distinct from ${entry.caseId ?? null}
          and participant_id is not distinct from ${entry.participantId ?? null}
          and at > now() - (${FOLD_MINUTES} || ' minutes')::interval
        limit 1`;
      if (recent) return;
    }
    await sql`
      insert into audit_log (actor_id, action, participant_id, case_id, fields)
      values (${entry.actorId || null}, ${entry.action}, ${entry.participantId ?? null},
              ${entry.caseId ?? null}, ${entry.fields ?? []})`;
  } catch (error) {
    console.error('audit write failed', entry.action, error);
  }
}

export type AuditRow = {
  id: number;
  at: string;
  action: AuditAction;
  kind: AuditKind;
  label: string;
  fields: string[];
  actor_name: string | null;
  /** 당사자 본인이 연 것인지. 실무자 열람과 구분해 읽는다. */
  by_participant: boolean;
  /** 누구의 것을 봤나. 이름은 금고에서 꺼내 실어 보낸다 — 감사 표에는 저장하지 않는다. */
  subject: string | null;
  pseudonym: string | null;
  case_id: number | null;
  program_name: string | null;
};

/** 표에서 그대로 나온 줄. 이름은 아직 암호문이다. */
type RawRow = {
  id: number;
  at: string;
  action: AuditAction;
  fields: string[];
  actor_id: number | null;
  actor_name: string | null;
  pseudonym: string | null;
  enc_name: string | null;
  case_id: number | null;
  program_name: string | null;
};

/**
 * 열람 기록 조회. 관리자만 본다(라우트에서 막는다).
 *
 * **이름은 표에 없다.** 감사가 또 하나의 개인정보 창고가 되면 안 되므로 `participant_id` 만
 * 두고, 볼 때 금고에서 꺼낸다. 가명만 보여 주면 관리자가 당사자 목록과 맞춰 볼 수 없어
 * "누구 것을 봤나"에 답하지 못한다 — 그것이 이 화면의 존재 이유다.
 *
 * 그래서 **이 화면을 연 것 자체도 남긴다**(`audit.view`).
 */
export async function listAudit(opts: { limit?: number; kind?: AuditKind } = {}): Promise<AuditRow[]> {
  const { limit = 200, kind } = opts;
  // 지금 쓰지 않는 사건은 목록에 세우지 않는다. 옛 `schedule.list` 같은 줄이 섞이면
  // 소음을 걷어 낸 뜻이 없어진다 — 표에는 그대로 남는다(감사는 지우지 않는다).
  const actions = (Object.keys(AUDIT_KINDS) as AuditAction[]).filter(
    (a) => !kind || AUDIT_KINDS[a].kind === kind,
  );
  const rows = await sql<RawRow[]>`
    select a.id, a.at, a.action, a.fields, a.actor_id, u.name as actor_name,
           p.pseudonym, v.enc_name, a.case_id, c.program_name
    from audit_log a
    left join users u on u.id = a.actor_id
    left join support_cases c on c.id = a.case_id
    -- 사례만 적힌 줄에서도 누구인지 찾는다. 15초 다시보기는 사례 열쇠만 들고 온다.
    left join participants p on p.id = coalesce(a.participant_id, c.participant_id)
    left join participant_pii v on v.participant_id = p.id
    where a.action = any(${actions})
    order by a.at desc, a.id desc
    limit ${limit}`;

  return rows.map(({ actor_id, enc_name, ...row }) => {
    const spec = AUDIT_KINDS[row.action] ?? { kind: '운영' as AuditKind, label: row.action };
    return {
      ...row,
      kind: spec.kind,
      label: spec.label,
      by_participant: actor_id === null,
      subject: decryptPii(enc_name),
    };
  });
}
