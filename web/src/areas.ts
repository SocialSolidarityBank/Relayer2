// 국가 표준 욕구영역 10종 + 기타(2024 희망복지지원단 업무안내). SPEC §6.
export const LIFE_AREAS = [
  { key: 'safety', label: '안전' },
  { key: 'health', label: '건강' },
  { key: 'daily_living', label: '일상생활유지' },
  { key: 'family', label: '가족관계' },
  { key: 'social', label: '사회적관계' },
  { key: 'economy', label: '경제' },
  { key: 'education', label: '교육' },
  { key: 'employment', label: '고용' },
  { key: 'living_env', label: '생활환경' },
  { key: 'legal', label: '법률·권익보장' },
  { key: 'other', label: '기타' },
] as const;
