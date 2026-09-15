// 회차 하나의 불일치를 모아 낸다. 두 종류를 **섞지 않는다**(요구 23).
// 원인도 대응도 다르다 — 앞은 "못 들었거나 잘못 적었다", 뒤는 "말이 달라졌다"이다.
import { acrossSessions, voiceVsWritten, type Mismatch } from './mismatch.ts';

export type MismatchView = {
  /** 전사문과 수기 기록이 어긋난 것. 전사문이 없으면 빈 배열이다. */
  voice_vs_written: Mismatch[];
  /** 지난 회차와 이번 회차가 어긋난 것. 직전 회차가 없으면 빈 배열이다. */
  across_sessions: Mismatch[];
};

export function buildMismatches(input: {
  written: string | null;
  transcript: string | null;
  previous: { seq: number; text: string } | null;
  current: { seq: number };
}): MismatchView {
  const written = input.written?.trim() ?? '';
  return {
    voice_vs_written:
      input.transcript && written ? voiceVsWritten(input.transcript, written) : [],
    across_sessions:
      input.previous && written
        ? acrossSessions(input.previous, { seq: input.current.seq, text: written })
        : [],
  };
}
