// 근거 인용 검증(2026-09-18 Q). 모델이 준 인용이 보낸 자료에 그대로 없으면 화면에 오르면 안 된다 —
// 지어낸 인용은 이 작업에서 가장 나쁜 결과다. 검증기가 그것을 걸러 `없음` 으로 내리는지 본다.
import { describe, expect, it } from 'vitest';
import { verifyEvidence } from '../src/ai.ts';

const PARTS = [
  { label: '상담 내용', text: '월세 40만 원이 두 달 밀렸다고 함.\n주민센터에서 면박당해 서류를 못 뗐다고 함.' },
  { label: '전사문', text: '그날 그냥 다 놓고 싶더라고요. 형이 같이 있었어요.' },
];

const base = {
  summary: '',
  changes: [],
  tasks: [],
  questions: [],
  fact_changes: [],
  omissions: [],
  omitted_minor_count: 0,
};

describe('verifyEvidence', () => {
  it('자료에 그대로 있는 인용만 남기고, 줄바꿈 차이는 인용으로 본다', () => {
    const out = verifyEvidence(
      {
        ...base,
        evidence: [
          {
            item: '서류 준비 지연',
            source: '상담 내용',
            quotes: ['서류를 못 뗐다고 함.', '월세 40만 원이 두 달\n밀렸다고 함.', '연체 3건'],
            context: '주민센터에서 면박당해 서류를 못 뗐다고 함.',
            grade: '완전',
            transforms: ['압축'],
            note: '',
          },
        ],
      },
      PARTS,
    );
    expect(out.evidence[0].quotes).toEqual(['서류를 못 뗐다고 함.', '월세 40만 원이 두 달\n밀렸다고 함.']);
    expect(out.evidence[0].grade).toBe('완전');
  });

  it('인용이 다 떨어지면 없음으로 내리고 맥락도 비운다', () => {
    const out = verifyEvidence(
      {
        ...base,
        evidence: [
          { item: '무력감', source: '전사문', quotes: ['다 포기하고 싶다'], context: '지어낸 맥락', grade: '완전', transforms: [], note: '' },
        ],
      },
      PARTS,
    );
    expect(out.evidence[0]).toMatchObject({ quotes: [], context: '', grade: '없음' });
  });

  it('라벨이 틀린 인용은 다른 자료에서 찾고, 놓친 구간도 같은 규칙이다', () => {
    const out = verifyEvidence(
      {
        ...base,
        evidence: [
          { item: '무력감', source: '상담 내용', quotes: ['그냥 다 놓고 싶더라고요.'], context: '', grade: '정황', transforms: ['감정 라벨링'], note: '' },
        ],
        omissions: [
          { source: '전사문', quote: '형이 같이 있었어요.', importance: '상', summary: '동거인 존재' },
          { source: '전사문', quote: '누나가 같이 있었어요.', importance: '상', summary: '지어냄' },
        ],
        omitted_minor_count: -2,
      },
      PARTS,
    );
    expect(out.evidence[0].grade).toBe('정황');
    expect(out.omissions.map((o) => o.quote)).toEqual(['형이 같이 있었어요.']);
    expect(out.omitted_minor_count).toBe(0);
  });
});
