/** The words of the speed test: every state, the ratio phrases both ways, the clock, and that a number that is not there never prints as NaN. */
import { describe, expect, it } from 'vitest';
import type { SpeedTestResult } from './speedTest';
import {
  ratioWords,
  SPEED_TEST_BLOCKED,
  SPEED_TEST_IDLE,
  SPEED_TEST_RUNNING,
  speedTestResultWords,
  speedTestRowValue,
  speedTestStatus,
  type SpeedTestFacts,
} from './speedTestModel';

const BAD = /\b(undefined|NaN|Infinity|null)\b|\[object/;
// 2026-10-30 14:05 UTC
const AT = Date.UTC(2026, 9, 30, 14, 5, 0);
const result = (o: Partial<SpeedTestResult> = {}): SpeedTestResult => ({ version: 1, stencilMcellsPerS: 25.1, copyGBps: 3.8, ratioStencil: 3.2, ratioCopy: 2.1, at: AT, ...o });

describe('the ratio to the build machine', () => {
  it('says slower over 1 and faster under it, "about" the figure, and the same within 5 percent', () => {
    expect(ratioWords(3.2)).toBe('about 3.2 times slower than the build machine');
    expect(ratioWords(12.04)).toBe('about 12.0 times slower than the build machine');
    expect(ratioWords(120.4)).toBe('about 120 times slower than the build machine');
    expect(ratioWords(0.5)).toBe('about 2.0 times faster than the build machine');
    expect(ratioWords(0.8)).toBe('about 1.25 times faster than the build machine');
    expect(ratioWords(1.04)).toBe('about as fast as the build machine');
    expect(ratioWords(0.97)).toBe('about as fast as the build machine');
    expect(ratioWords(1.06)).toBe('about 1.06 times slower than the build machine');
    expect(ratioWords(3.2, false)).toBe('about 3.2 times slower');
    expect(ratioWords(1, false)).toBe('about as fast');
  });

  it('says it is not compared where the ratio is not a number', () => {
    for (const r of [NaN, Infinity, 0, -1]) expect(ratioWords(r)).toBe('not compared with the build machine');
  });
});

describe('the finished test in words', () => {
  it('gives both kernels with their ratios, the version and the time, and says what the number is not', () => {
    const w = speedTestResultWords(result());
    expect(w).toBe(
      "Air kernel 25.1 million cell updates a second (about 3.2 times slower than the build machine). Memory copy 3.8 GB a second (about 2.1 times slower). Test version 1, 14:05. One short test on one thread: heat and other apps change it, so run it twice. It does not predict a run; the simulation's own measured speed is the better number once a run exists.",
    );
    expect(w).toContain('run it twice');
    expect(w).toContain('does not predict a run');
  });

  it('shows the time in the phone\'s own zone (the offset is given)', () => {
    expect(speedTestResultWords(result(), 600)).toContain('Test version 1, 00:05.');
    expect(speedTestResultWords(result(), -300)).toContain('Test version 1, 09:05.');
  });

  it('names the build machine again when the two kernels differ in direction, and not when they agree', () => {
    expect(speedTestResultWords(result({ ratioStencil: 3, ratioCopy: 0.5 }))).toContain('(about 3.0 times slower than the build machine). Memory copy 3.8 GB a second (about 2.0 times faster than the build machine).');
    expect(speedTestResultWords(result({ ratioStencil: 1, ratioCopy: 1 }))).toContain('(about as fast as the build machine). Memory copy 3.8 GB a second (about as fast as the build machine).');
  });

  it('prints no NaN or undefined whatever it is given', () => {
    for (const r of [
      result({ ratioStencil: NaN, ratioCopy: NaN }),
      result({ stencilMcellsPerS: 0 }),
      result({ copyGBps: NaN }),
      result({ at: NaN }),
      result({ stencilMcellsPerS: 0.012, copyGBps: 0.5 }),
      result({ stencilMcellsPerS: 1234.5, copyGBps: 120.04 }),
    ]) {
      const w = speedTestResultWords(r);
      expect(w, w).not.toMatch(BAD);
    }
    expect(speedTestResultWords(result({ stencilMcellsPerS: 0 }))).toMatch(/^The test gave no usable numbers\./);
    expect(speedTestResultWords(result({ at: NaN }))).toContain('a moment ago');
    expect(speedTestResultWords(result({ stencilMcellsPerS: 1234.5, copyGBps: 120.04 }))).toContain('Air kernel 1235 million cell updates a second');
  });

  it('is plain: no em dashes, sentence case, "about" for approximate numbers', () => {
    const w = speedTestResultWords(result());
    expect(w).not.toMatch(/[—–]/);
    expect(w).toMatch(/^[A-Z]/);
    expect(w).toContain('about 3.2');
  });
});

describe('the row and the status line in each state', () => {
  const idle: SpeedTestFacts = { state: 'idle', last: null };
  it('idle with no result: "Not run yet. Takes about 2 seconds." and an empty status', () => {
    expect(speedTestRowValue(idle)).toBe(SPEED_TEST_IDLE);
    expect(SPEED_TEST_IDLE).toBe('Not run yet. Takes about 2 seconds.');
    expect(speedTestStatus(idle)).toBe('');
  });

  it('running: "Testing, about 2 seconds." in the row and the status, whatever the last result was', () => {
    for (const last of [null, result()]) {
      expect(speedTestRowValue({ state: 'running', last })).toBe(SPEED_TEST_RUNNING);
      expect(speedTestStatus({ state: 'running', last })).toBe('Testing, about 2 seconds.');
    }
  });

  it('idle with a result: the row holds the numbers and the status says it is done with the air kernel ratio', () => {
    const f: SpeedTestFacts = { state: 'idle', last: result() };
    expect(speedTestRowValue(f)).toBe(speedTestResultWords(result()));
    expect(speedTestStatus(f)).toBe('Done: about 3.2 times slower than the build machine on the air kernel.');
    expect(speedTestStatus({ state: 'idle', last: result({ ratioStencil: NaN }) })).toBe('Done.');
  });

  it('blocked: the reason is the status, and the row keeps the last result or the idle words', () => {
    for (const reason of Object.values(SPEED_TEST_BLOCKED)) {
      expect(speedTestStatus({ state: 'blocked', reason, last: null })).toBe(reason);
      expect(speedTestRowValue({ state: 'blocked', reason, last: null })).toBe(SPEED_TEST_IDLE);
      expect(speedTestRowValue({ state: 'blocked', reason, last: result() })).toBe(speedTestResultWords(result()));
    }
    expect(SPEED_TEST_BLOCKED.playing).toBe('Pause first so the test is fair.');
    expect(speedTestStatus({ state: 'blocked', last: null })).toBe(SPEED_TEST_BLOCKED.playing);
  });
});
