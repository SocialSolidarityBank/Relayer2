/**
 * 보유기간 청소(2026-09-16 검수에서 발견).
 *
 * 세 개의 쓸기 함수를 **아무도 부르지 않고 있었다.** 문서·음성 30일(구 1년), 감사 3년이라고
 * 동의서에 적어 두고 실제로는 지우지 않은 것이다 — 그것은 고지가 아니라 거짓말이다.
 *
 * 서버가 뜰 때 한 번 돌고, 그 뒤 하루에 한 번 돈다.
 *
 * 크론이나 별도 일꾼을 두지 않는 이유는 기관마다 서버 한 대라서다. 프로세스가 죽어 있으면
 * 제품도 죽어 있으므로, 살아 있는 동안만 도는 것으로 충분하다. 못 돈 날이 있어도
 * 다음에 뜰 때 밀린 것을 한꺼번에 지운다 — 기한을 날짜로 판정하지 회차로 세지 않기 때문이다.
 */
import { sweepAudit } from './audit.ts';
import { sweepExpiredDocuments } from './documents.ts';
import { sweepExpiredRecordings } from './stt.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 지운 수만 센다. 쓸기마다 돌려주는 모양이 달라 여기서 하나로 맞춘다. */
type Sweep = { name: string; run: () => Promise<number> };

const SWEEPS: readonly Sweep[] = [
  { name: '문서', run: async () => (await sweepExpiredDocuments()).deleted },
  { name: '음성', run: async () => (await sweepExpiredRecordings()).deleted },
  { name: '열람 기록', run: sweepAudit },
];

/**
 * 한 판. 하나가 실패해도 나머지는 돈다 — 문서 오류로 음성이 안 지워지면 안 된다.
 *
 * **지울 것이 없어도 한 줄 남긴다.** 조용하면 돌았는지 안 돌았는지 구분할 수 없고,
 * 그 구분이 안 되어 이 청소가 반년 동안 안 돌고 있었다(2026-09-16 검수).
 */
export async function sweepOnce(): Promise<void> {
  const done: string[] = [];
  for (const { name, run } of SWEEPS) {
    try {
      done.push(`${name} ${await run()}건`);
    } catch (error) {
      done.push(`${name} 실패`);
      console.error(`[보유기간] ${name} 청소 실패`, error);
    }
  }
  console.log(`[보유기간] 청소 ${new Date().toISOString()} · ${done.join(' · ')}`);
}

export function startRetentionSweep(): () => void {
  void sweepOnce();
  const timer = setInterval(() => void sweepOnce(), DAY_MS);
  // 타이머가 프로세스를 붙잡지 않게 한다 — 종료가 하루씩 늦어지면 배포가 멈춘다.
  timer.unref?.();
  return () => clearInterval(timer);
}
