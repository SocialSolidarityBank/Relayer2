// 가림 처리. 외부로 나가기 전에 사람을 가리키는 것이 남아 있으면 안 된다.
import { describe, expect, it } from 'vitest';
import { maskAll, maskText } from '../src/domain/masking.ts';

const subject = {
  pseudonym: 'otter-001',
  name: '김민희',
  phone: '010-1234-5678',
  email: 'minhee@example.com',
};

describe('아는 값 가리기', () => {
  it('이름을 가명 자리표로 바꾼다 — 조사가 붙어도', () => {
    const { text } = maskText('김민희가 오늘 늦는다고 김민희씨 남편이 연락함.', subject);
    expect(text).not.toContain('김민희');
    expect(text).toBe('[otter-001]가 오늘 늦는다고 [otter-001]씨 남편이 연락함.');
  });

  it('금고에 든 연락처와 이메일을 가린다', () => {
    const { text } = maskText('010-1234-5678 로 연락. 메일은 minhee@example.com', subject);
    expect(text).toBe('[연락처] 로 연락. 메일은 [이메일]');
  });

  it('무엇을 몇 번 가렸는지 센다 — 원문은 담지 않는다', () => {
    const { hits } = maskText('김민희 김민희 010-1234-5678', subject);
    expect(hits).toEqual({ name: 2, phone: 1 });
  });
});

describe('형태로 가리기 — 자유 글에 섞여 들어온 남의 것', () => {
  it('다른 사람 휴대전화도 가린다', () => {
    expect(maskText('동생 번호 010-9999-8888', subject).text).toBe('동생 번호 [연락처]');
  });

  it('지역번호 전화를 가린다', () => {
    expect(maskText('주민센터 02-1234-5678', subject).text).toBe('주민센터 [연락처]');
  });

  it('주민등록번호를 가린다 — 전화 규칙보다 먼저다', () => {
    expect(maskText('900101-1234567 확인', subject).text).toBe('[주민번호] 확인');
  });

  it('카드번호와 계좌번호를 가린다', () => {
    expect(maskText('1234-5678-9012-3456 결제', subject).text).toBe('[카드번호] 결제');
    expect(maskText('계좌 110-123-456789', subject).text).toBe('계좌 [계좌번호]');
  });

  it('모르는 사람 이메일도 가린다', () => {
    expect(maskText('담당자 kim@agency.or.kr', subject).text).toBe('담당자 [이메일]');
  });
});

describe('가리지 않는 것', () => {
  it('금액·날짜·기관 이름은 남긴다 — 다 지우면 요약할 것이 없다', () => {
    const text = '2026년 9월 15일 주민센터 긴급복지 상담, 생계비 713,100원';
    expect(maskText(text, subject).text).toBe(text);
  });

  it('회차 번호를 연락처로 오인하지 않는다', () => {
    expect(maskText('3회차에 다시 확인', subject).text).toBe('3회차에 다시 확인');
  });
});

describe('여러 조각', () => {
  it('조각마다 가리고 횟수를 합친다', () => {
    const { parts, hits } = maskAll(
      [
        { label: '상담 내용', text: '김민희가 왔다' },
        { label: '의견', text: '010-1234-5678 로 통화' },
      ],
      subject,
    );
    expect(parts[0].text).toBe('[otter-001]가 왔다');
    expect(parts[1].text).toBe('[연락처] 로 통화');
    expect(hits).toEqual({ name: 1, phone: 1 });
  });
});
