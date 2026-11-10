/**
 * The slow-run sheet for a run that computes on the desktop (0.9.0, D35; contract 4.1 item 4): the figures are the engine's own (`perf`, measured by
 * the engine that computes the run, which is the desktop's), so only the words change: the desktop, not this phone; no "warm phone" reason; and the
 * footnote says what was measured and that no test of this phone is used. Without `where` the sheet is the one 0.8.0 made, word for word.
 */
import { describe, expect, it } from 'vitest';
import type { PaceInfo } from './paceTypes';
import { paceSheet, type PaceSheetInput } from './paceSheetModel';

const pace = (over: Partial<PaceInfo> = {}): PaceInfo => ({ level: 'waiting', wanted: 600, achieved: 410, waitingShare: 0.27, capacity: 430, duty: 0.97, aheadS: 12, bufferS: 0.02, sinceMs: 0, ...over });
const input = (over: Partial<PaceSheetInput> = {}): PaceSheetInput => ({ pace: pace(), engine: { tier: 'standard' }, remainingS: 3600, ...over });

describe('the sheet names the computer that measured the speed', () => {
  it('waiting: "The desktop is computing about N× right now", and the footnote says it is the desktop engine\'s own measurement', () => {
    const v = paceSheet(input({ where: 'desktop' }));
    expect(v.lead).toContain('The desktop is computing about 430× right now, so playback waits');
    expect(v.lead).not.toMatch(/phone/i);
    expect(v.footnote).toBe("Measured by the desktop's own engine while it computes this run, over the last 10 seconds. No test of this phone is used.");
  });

  it('keeping up: "the desktop is computing"', () => {
    const v = paceSheet(input({ where: 'desktop', pace: pace({ level: 'ok' }) }));
    expect(v.lead).toContain('the desktop is computing about 430× right now');
    expect(v.lead).not.toMatch(/phone/i);
  });

  it('slower than before: the reason is a busy desktop, not a warm phone in battery saver', () => {
    const perf = { history: [800, 800, 800, 800, 400], modules: [], speed: { s10: 400 } } as never;
    const v = paceSheet(input({ where: 'desktop', pace: pace({ capacity: 400 }), engine: { tier: 'fast', perf } }));
    expect(v.reasons.join(' ')).toMatch(/Slower than before.*The desktop may be busy with other work\./);
    expect(v.reasons.join(' ')).not.toMatch(/warm|battery/);
  });

  it('this phone, or no `where`: the sheet is word for word the one 0.8.0 made', () => {
    const v = paceSheet(input());
    expect(v.lead).toContain('This phone is computing about 430× right now, so playback waits');
    expect(v.footnote).toBe('Measured on this phone, over the last 10 seconds.');
    expect(paceSheet(input({ pace: pace({ level: 'ok' }) })).lead).toContain('this phone is computing about 430× right now');
  });
});
