// AI 없는 회차의 한 줄. 요약이 아니라 기록 상태 표시다(SPEC §5).
import type { Card, LifeArea, Session } from './types.ts';
import { LIFE_AREAS, LIFE_AREA_LABEL } from './types.ts';

export function buildSessionLine(session: Session, cards: Card[]): string {
  const mine = cards.filter((c) => c.source_session_id === session.id);
  const parts: string[] = [];

  const promises = mine.filter((c) => c.kind === 'promise').length;
  if (promises > 0) parts.push(`수행할 과제 ${promises}`);

  const questions = mine.filter((c) => c.kind === 'question').length;
  if (questions > 0) parts.push(`물어볼 것 ${questions}`);

  const changed = LIFE_AREAS.filter((area: LifeArea) =>
    mine.some((c) => c.source_section === 'change' && c.area === area),
  );
  if (changed.length > 0) parts.push(`달라진 것: ${changed.map((a) => LIFE_AREA_LABEL[a]).join('·')}`);

  if (mine.some((c) => c.source_section === 'judgment')) parts.push('의견 있음');

  return parts.length > 0 ? parts.join(', ') : '수기 기록';
}
