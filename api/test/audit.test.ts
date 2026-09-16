// 열람 기록이 무엇을 내보내고 무엇을 내보내지 않는가(docs/audit-view.md).
// CSV 는 기관 밖으로 나가는 유일한 길이라, 가명만 고른 파일에 실명이 섞이면 되돌릴 수 없다.
import { describe, expect, it } from 'vitest';
import { auditCsv, AUDIT_KINDS, type AuditRow } from '../src/audit.ts';

const row = (over: Partial<AuditRow> = {}): AuditRow => ({
  id: 1,
  at: '2026-09-16T02:00:00.000Z',
  action: 'case.briefing',
  kind: '열람',
  label: '15초 다시보기 조회',
  fields: ['name'],
  actor_id: 7,
  actor_name: '김실무',
  by_participant: false,
  subject: '김민희',
  pseudonym: 'otter-001',
  case_id: 3,
  program_name: '함께온기금 울타리대출',
  off_assignment: true,
  ...over,
});

describe('감사 CSV', () => {
  it('가명만 고르면 실명이 한 글자도 없다', () => {
    const csv = auditCsv([row()], false);
    expect(csv).not.toContain('김민희');
    expect(csv).toContain('otter-001');
  });

  it('이름 포함을 고르면 실명이 실린다', () => {
    expect(auditCsv([row()], true)).toContain('김민희');
  });

  it('이름이 없는 줄은 가명으로 대신한다', () => {
    // 금고가 비어 있어도 누구 것인지는 가명으로 남아야 조사가 이어진다.
    expect(auditCsv([row({ subject: null })], true)).toContain('otter-001');
  });

  it('쉼표와 따옴표가 든 값이 칸을 깨뜨리지 않는다', () => {
    const csv = auditCsv([row({ program_name: '가나, "다라"' })], false);
    expect(csv).toContain('"가나, ""다라"""');
    // 머리줄 + 본문 한 줄. 칸이 깨지면 줄이 늘어난다.
    expect(csv.trimEnd().split('\n')).toHaveLength(2);
  });

  it('엑셀이 한글을 깨뜨리지 않게 BOM 으로 시작한다', () => {
    expect(auditCsv([], false).startsWith('\uFEFF')).toBe(true);
  });

  it('맡은 사람 밖이었는지가 칸으로 남는다', () => {
    expect(auditCsv([row()], false)).toContain(',Y,');
    expect(auditCsv([row({ off_assignment: false })], false)).not.toContain(',Y,');
  });
});

describe('사건 이름', () => {
  it('묶음은 열람·기록·운영 셋뿐이다', () => {
    const kinds = new Set(Object.values(AUDIT_KINDS).map((s) => s.kind));
    expect([...kinds].sort()).toEqual(['기록', '열람', '운영']);
  });

  it('판정하는 말을 쓰지 않는다', () => {
    // 제품은 세기만 하고 판단은 사람이 한다(2026-09-16 Q).
    const labels = Object.values(AUDIT_KINDS).map((s) => s.label);
    for (const label of labels) {
      expect(label).not.toMatch(/의심|위험|경고|이상|불법|무단/);
    }
  });

  it('여러 번 여는 화면만 접는다', () => {
    // 접기는 열람에만 뜻이 있다. 동의·배정 같은 사건은 한 번 한 번이 다른 일이다.
    const folded = Object.entries(AUDIT_KINDS).filter(([, s]) => s.fold);
    expect(folded.every(([, s]) => s.kind === '열람')).toBe(true);
    expect(AUDIT_KINDS['document.read'].fold).toBe(false);
  });
});
