// 화면 여러 곳이 같은 낱말을 쓴다. 한 군데서만 고치게 모아 둔다.
import type { NewSessionInput } from './api.ts';

export const METHODS: ReadonlyArray<{ key: NonNullable<NewSessionInput['method']>; label: string }> = [
  { key: 'in_person', label: '대면' },
  { key: 'visit', label: '방문' },
  { key: 'phone', label: '전화' },
  { key: 'video', label: '화상' },
];

export const METHOD_LABEL: Record<string, string> = Object.fromEntries(
  METHODS.map((m) => [m.key, m.label]),
);
