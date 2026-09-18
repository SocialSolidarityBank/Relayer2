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
  'voice.read': { kind: '열람', label: '녹음 재생', fold: false },
  'audit.view': { kind: '열람', label: '열람 기록 조회', fold: true },
  'audit.export': { kind: '열람', label: '열람 기록 내려받기', fold: false },
  'assign.view': { kind: '열람', label: '배정 목록 조회(이름·연락처)', fold: true },

  'consent.record': { kind: '기록', label: '동의 받음', fold: false },
  'ai.draft': { kind: '기록', label: '외부 AI 로 보냄', fold: false },
  'ai.approve': { kind: '기록', label: 'AI 초안 승인', fold: false },
  'document.add': { kind: '기록', label: '서면 문서 올림', fold: false },
  'document.sweep': { kind: '기록', label: '기한 지난 문서 삭제', fold: false },
  'voice.record': { kind: '기록', label: '녹음 저장', fold: false },
  'voice.transcribe': { kind: '기록', label: '전사함', fold: false },
  'voice.approve': { kind: '기록', label: '전사 승인', fold: false },
  'voice.sweep': { kind: '기록', label: '기한 지난 녹음 삭제', fold: false },
  'voice.withdraw': { kind: '기록', label: '동의 철회로 녹음 삭제', fold: false },
  'session.revise': { kind: '기록', label: '회차 원본 수정', fold: false },

  'assignment.request': { kind: '운영', label: '담당 배정 요청', fold: false },
  'assignment.decide': { kind: '운영', label: '담당 배정 결정', fold: false },
  // `case.assign` 은 2026-09-18 전 행이다. 새 배정은 `assignment.set` 으로 남긴다(ui-plan §4).
  'case.assign': { kind: '운영', label: '담당 바꿈', fold: false },
  'assignment.set': { kind: '운영', label: '담당 실무자 배정', fold: false },
  'invite.create': { kind: '운영', label: '초대 링크 만듦', fold: false },
  'invite.revoke': { kind: '운영', label: '초대 취소', fold: false },
  'invite.accept': { kind: '운영', label: '초대로 들어옴', fold: false },
  'org.bootstrap': { kind: '운영', label: '기관 열기(첫 가입·워크스페이스 만들기)', fold: false },
  'org.update': { kind: '운영', label: '기관 정보 고침', fold: false },
  'program.add': { kind: '운영', label: '사업 더함', fold: false },
  'program.update': { kind: '운영', label: '사업 고침', fold: false },
  'program.retire': { kind: '운영', label: '사업 종료', fold: false },
  'program.reopen': { kind: '운영', label: '사업 다시 열기', fold: false },
  'user.profile.update': { kind: '운영', label: '내 정보 고침', fold: false },
  'user.role.update': { kind: '운영', label: '역할 바꿈', fold: false },
  'user.deactivate': { kind: '운영', label: '계정 삭제', fold: false },
  'ai.key.set': { kind: '운영', label: 'AI 키 설정', fold: false },
  'stt.key.set': { kind: '운영', label: 'STT 키 설정', fold: false },
  'voice.toggle': { kind: '운영', label: '녹음 설정 변경', fold: false },
  'consent.copy.update': { kind: '운영', label: '동의 문안 고침(새 판)', fold: false },
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
  actor_id: number | null;
  actor_name: string | null;
  /** 당사자 본인이 연 것인지. 실무자 열람과 구분해 읽는다. */
  by_participant: boolean;
  /** 누구의 것을 봤나. 이름은 금고에서 꺼내 실어 보낸다 — 감사 표에는 저장하지 않는다. */
  subject: string | null;
  pseudonym: string | null;
  case_id: number | null;
  program_name: string | null;
  /**
   * 이 열람이 **맡은 사람의 것이 아니었나.** 세기만 한다 — 판정하지 않는다.
   * 상담 기록은 맡은 사람만 보는 것이 원칙이라, 그 밖이면 관리자가 들여다볼 값이 있다.
   */
  off_assignment: boolean;
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
  case_exists: boolean;
  actor_assigned: boolean;
  viewer_assigned: boolean;
};

export type AuditQuery = {
  /** 며칠치. 기본 30일 — 화면을 열자마자 보이는 범위다(docs/audit-view.md). */
  days?: number;
  kind?: AuditKind;
  /** 누가 했나. 한 사람으로 좁혀 조사를 잇는 자리다. */
  actorId?: number;
  /** 누구 것인가. 사례 하나로 좁힌다. */
  caseId?: number;
  /**
   * 눈여겨볼 것만 골라 보기(2026-09-16 Q). 세는 것과 거르는 것이 같은 조건이라
   * 필터가 곧 숫자다 — 화면 위에 요약을 따로 세우지 않는다.
   */
  only?: 'off_assignment' | 'download';
  limit?: number;
  /** 열람 기록을 보는 관리자. 맡지 않은 사례의 실명·자유 글은 이 화면에도 내지 않는다. */
  viewerId?: number;
};

const DEFAULT_DAYS = 30;
const HARD_LIMIT = 1000;

/** 지금 목록에 세우는 사건들. 옛 사건(`schedule.list`)은 표에 남되 목록에는 안 선다. */
const liveActions = (kind?: AuditKind): AuditAction[] =>
  (Object.keys(AUDIT_KINDS) as AuditAction[]).filter((a) => !kind || AUDIT_KINDS[a].kind === kind);

/**
 * 열람 기록 조회. 관리자만 본다(라우트에서 막는다).
 *
 * **이름은 표에 없다.** 맡은 사례만 조회할 때 금고에서 꺼낸다. 맡지 않은 사례는
 * 관리자에게도 가명·사업·행위·필드 이름만 보여 준다 — 감사 화면이 상담 자료 우회로가
 * 되어서는 안 된다.
 *
 * 그래서 **이 화면을 연 것 자체도 남긴다**(`audit.view`).
 *
 * 글자 검색은 여기 없다. **이름이 금고 암호문이라 서버가 이름으로 못 찾는다** —
 * 불러온 것 안에서 화면이 거른다(당사자 목록이 이미 같은 제약을 안고 있다).
 */
export async function listAudit(q: AuditQuery = {}): Promise<AuditRow[]> {
  const days = q.days ?? DEFAULT_DAYS;
  const limit = Math.min(q.limit ?? 500, HARD_LIMIT);
  const rows = await sql<RawRow[]>`
    select a.id, a.at, a.action, a.fields, a.actor_id, u.name as actor_name,
           p.pseudonym, v.enc_name, a.case_id, pg.name as program_name,
           (c.id is not null) as case_exists,
           exists (select 1 from case_assignments ca
                   where ca.case_id = a.case_id and ca.user_id = a.actor_id) as actor_assigned,
           exists (
             select 1 from case_assignments ca
             join support_cases vc on vc.id = ca.case_id
             where ca.user_id = ${q.viewerId ?? 0}
               and (ca.case_id = a.case_id
                    or (a.case_id is null and vc.participant_id = p.id))
           ) as viewer_assigned
    from audit_log a
    left join users u on u.id = a.actor_id
    left join support_cases c on c.id = a.case_id
    left join programs pg on pg.id = c.program_id
    -- 사례만 적힌 줄에서도 누구인지 찾는다. 15초 다시보기는 사례 열쇠만 들고 온다.
    left join participants p on p.id = coalesce(a.participant_id, c.participant_id)
    left join participant_pii v on v.participant_id = p.id
    where a.action = any(${liveActions(q.kind)})
      and a.at > now() - (${days} || ' days')::interval
      and ${q.actorId ? sql`a.actor_id = ${q.actorId}` : sql`true`}
      and ${q.caseId ? sql`a.case_id = ${q.caseId}` : sql`true`}
      and ${
        q.only === 'download'
          ? sql`a.action = 'document.read'`
          : q.only === 'off_assignment'
            ? sql`a.action = any(${liveActions('열람')})
                  and a.case_id is not null and c.id is not null
                  and a.actor_id is not null
                  and not exists (
                    select 1 from case_assignments ca
                    where ca.case_id = a.case_id and ca.user_id = a.actor_id
                  )`
            : sql`true`
      }
    order by a.at desc, a.id desc
    limit ${limit}`;

  return rows.map(({ enc_name, case_exists, actor_assigned, viewer_assigned, ...row }) => {
    const spec = AUDIT_KINDS[row.action];
    const canSeeClinical = (row.case_id === null && enc_name === null) || viewer_assigned;
    return {
      ...row,
      // 맡지 않은 관리자는 무슨 항목을 다뤘는지는 알되 값은 못 본다.
      // `label=진단서` 같은 자유 글은 `label` 만 남긴다.
      fields: canSeeClinical ? row.fields : row.fields.map((field) => field.split('=', 1)[0]),
      kind: spec.kind,
      label: spec.label,
      by_participant: row.actor_id === null,
      subject: canSeeClinical ? decryptPii(enc_name) : null,
      // 열람에만 뜻이 있다. 기록·운영은 원래 담당 밖에서 하는 일이 있다(관리자 배정 등).
      off_assignment:
        spec.kind === '열람' &&
        row.actor_id !== null &&
        row.case_id !== null &&
        case_exists &&
        !actor_assigned,
    };
  });
}

export type AuditSummary = {
  days: number;
  total: number;
  /** 묶음별 줄 수. 화면 맨 위 숫자다. */
  by_kind: Array<{ kind: AuditKind; count: number }>;
  /** 눈여겨볼 것. **판정하지 않는다 — 세기만 한다.** */
  watch: Array<{ key: 'off_assignment' | 'download'; label: string; count: number }>;
};

/**
 * 필터에 실을 숫자(2026-09-16 Q 2차). 화면 위에 요약을 따로 세우지 않는다 —
 * **거르는 조건과 세는 조건이 같으므로 필터가 곧 숫자다.**
 * `맡지 않은 당사자를 연 것 304건` 은 버튼 이름이면서 그 자체로 점검 결과다.
 *
 * `watch` 는 **사실을 센 것이지 판정이 아니다.** `담당 아닌 열람 9건`은 사실이고
 * `의심스러운 접근 9건`은 판정이다. 앞엣것만 낸다 — 불일치 기능과 같은 규율이다.
 *
 * 야간 열람과 열람 횟수는 세지 않는다. 기관마다 근무 형태가 달라 오탐이 많고,
 * 횟수는 10분 접기가 이미 걷었다.
 */
export async function auditSummary(days = DEFAULT_DAYS): Promise<AuditSummary> {
  const since = sql`now() - (${days} || ' days')::interval`;
  const live = liveActions();
  const viewing = liveActions('열람');

  const [byKind, off, downloads] = await Promise.all([
    sql<Array<{ action: AuditAction; count: number }>>`
      select action, count(*)::int as count from audit_log
      where action = any(${live}) and at > ${since} group by action`,
    sql<Array<{ count: number }>>`
      select count(*)::int as count
      from audit_log a join support_cases c on c.id = a.case_id
      where a.action = any(${viewing}) and a.at > ${since}
        and a.actor_id is not null
        and not exists (
          select 1 from case_assignments ca
          where ca.case_id = a.case_id and ca.user_id = a.actor_id
        )`,
    sql<Array<{ count: number }>>`
      select count(*)::int as count from audit_log
      where action = 'document.read' and at > ${since}`,
  ]);

  const counts = new Map<AuditKind, number>();
  let total = 0;
  for (const row of byKind) {
    const k = AUDIT_KINDS[row.action].kind;
    counts.set(k, (counts.get(k) ?? 0) + row.count);
    total += row.count;
  }

  return {
    days,
    total,
    by_kind: AUDIT_KIND_LIST.map((kind) => ({ kind, count: counts.get(kind) ?? 0 })),
    watch: [
      { key: 'off_assignment', label: '맡지 않은 당사자를 연 것', count: off[0]?.count ?? 0 },
      { key: 'download', label: '문서를 내려받은 것', count: downloads[0]?.count ?? 0 },
    ],
  };
}

/**
 * 기한이 지난 줄을 지운다. 3년이다(docs/audit-view.md) — 기록(음성·문서 1년)보다 길게 둔다.
 * 사고는 늦게 발견되므로, 기록은 지워도 누가 봤는지는 남긴다.
 *
 * 표의 트리거가 3년 안쪽을 거부하므로(`0017_audit_retention.sql`), 여기서 실수해도 막힌다.
 */
export async function sweepAudit(): Promise<number> {
  const rows = await sql`delete from audit_log where at <= now() - interval '3 years' returning id`;
  return rows.length;
}

/**
 * 감사 CSV(2026-09-16 Q). **이름을 넣을지 여기서 고른다.**
 *
 * 화면 그대로 내리면 금고에 넣어 둔 이름이 평문 파일로 기관 밖에 나가고, 그 파일에는
 * 우리 보유기간도 삭제 장치도 닿지 않는다. 자유는 두되 **어느 쪽으로 내렸는지가 기록에 남는다**
 * (라우트가 `audit.export` 를 쓴다).
 *
 * 엑셀이 한글을 깨뜨리지 않게 BOM 을 붙인다 — 받는 쪽은 대개 엑셀로 연다.
 */
export function auditCsv(rows: AuditRow[], withNames: boolean): string {
  const esc = (v: string | number | null): string => {
    const s = v === null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const head = ['시각', '묶음', '한 일', '한 사람', '대상', '사업', '맡은 사람 밖', '자세히'];
  const body = rows.map((r) =>
    [
      new Date(r.at).toLocaleString('ko-KR'),
      r.kind,
      r.label,
      r.by_participant ? '당사자 본인' : (r.actor_name ?? '알 수 없음'),
      withNames ? (r.subject ?? r.pseudonym ?? '') : (r.pseudonym ?? ''),
      r.program_name ?? '',
      r.off_assignment ? 'Y' : '',
      r.fields.join(' / '),
    ]
      .map(esc)
      .join(','),
  );
  return `\uFEFF${[head.join(','), ...body].join('\n')}\n`;
}
