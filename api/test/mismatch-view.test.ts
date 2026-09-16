import { describe, expect, it } from 'vitest';
import { buildMismatches } from '../src/domain/mismatch-view.ts';

const base = { written: '연체 3건', previous: null, current: { seq: 2 } };

describe('comparison readiness', () => {
  it('does not represent missing or unreviewed speech as a completed comparison', () => {
    const missing = buildMismatches({ ...base, transcript: null, transcriptStatus: null });
    expect(missing.voice_status).toBe('unavailable');
    expect(missing.voice_reason).toBe('missing_transcript');
    const draft = buildMismatches({ ...base, transcript: '연체 4건', transcriptStatus: 'draft' });
    expect(draft.voice_status).toBe('needs_review');
    expect(draft.voice_vs_written).toEqual([]);
  });

  it('requires a saved written record as the other source', () => {
    const result = buildMismatches({ ...base, written: null, transcript: '연체 4건', transcriptStatus: 'approved' });
    expect(result.voice_status).toBe('unavailable');
    expect(result.voice_reason).toBe('missing_written');
  });

  it('compares approved speech and preserves distinct session-to-session evidence', () => {
    const result = buildMismatches({ ...base, previous: {seq:1,text:'연체 2건'}, transcript: '연체 4건', transcriptStatus: 'approved' });
    expect(result.voice_status).toBe('ready');
    expect(result.voice_vs_written).toEqual([expect.objectContaining({left:'4',right:'3',kind:'voice_vs_written'})]);
    expect(result.across_sessions).toEqual([expect.objectContaining({left:'2',right:'3',kind:'across_sessions'})]);
  });
});
