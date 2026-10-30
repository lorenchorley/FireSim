/**
 * The words of the speed test (0.7.0, item C), pure: what the "Speed test" row of the debug statistics says in each state, the status line under its button,
 * and why the button is off. Plain words, "about" for numbers, sentence case, no em dashes (content.ts:1-5). A number that is not there is never NaN.
 */
import type { SpeedTestResult } from './speedTest';

/** What the screen knows about the test (DebugStatsInput.speedTest). */
export interface SpeedTestFacts {
  state: 'idle' | 'running' | 'blocked';
  reason?: string;
  last: SpeedTestResult | null;
}

export const SPEED_TEST_LABEL = 'Run the speed test';
export const SPEED_TEST_IDLE = 'Not run yet. Takes about 2 seconds.';
export const SPEED_TEST_RUNNING = 'Testing, about 2 seconds.';
/** Why the button is off (the status line says it, the button is disabled and described by it). */
export const SPEED_TEST_BLOCKED = {
  playing: 'Pause first so the test is fair.',
  computing: 'The simulation is still computing. Try again in a moment so the test is fair.',
  hidden: 'The app is in the background, so the test would not be fair.',
} as const;
export const SPEED_TEST_FAILED = 'This phone cannot run the test here.';
export const SPEED_TEST_STOPPED = 'The test was stopped. Run it again when you are ready.';
const CAVEAT = 'One short test on one thread: heat and other apps change it, so run it twice. It does not predict a run; the simulation\'s own measured speed is the better number once a run exists.';

const ok = (v: number): boolean => Number.isFinite(v) && v > 0;
/** Three figures: 25.1, 3.8, 120 (never a long tail of decimals). */
const figures = (v: number): string => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2).replace(/(\.\d)0$/, '$1'));

/** 1: slower than the build machine, -1: faster, 0: about the same (within 5 %). */
const way = (ratio: number): number => (ratio > 1.05 ? 1 : ratio < 1 / 1.05 ? -1 : 0);

/** "about 3.2 times slower than the build machine" (the ratio is reference / measured: over 1 is slower), or "about the same speed as it" within 5 %. */
export function ratioWords(ratio: number, machine = true): string {
  if (!ok(ratio)) return 'not compared with the build machine';
  const than = machine ? ' than the build machine' : '';
  const w = way(ratio);
  if (w > 0) return `about ${figures(ratio)} times slower${than}`;
  if (w < 0) return `about ${figures(1 / ratio)} times faster${than}`;
  return machine ? 'about as fast as the build machine' : 'about as fast';
}

/** "14:05" in the phone's own time (`tzOffsetMin` east of UTC, given so the node tests do not depend on the machine's zone). */
const clock = (ms: number, tzOffsetMin: number): string => (Number.isFinite(ms) ? new Date(ms + tzOffsetMin * 60_000).toISOString().slice(11, 16) : 'a moment ago');

/** The finished test in words: both kernels, each against the build machine, the version and the time, and what the number is and is not. */
export function speedTestResultWords(r: SpeedTestResult, tzOffsetMin = 0): string {
  if (!ok(r.stencilMcellsPerS) || !ok(r.copyGBps)) return `The test gave no usable numbers. ${CAVEAT}`;
  const sameWay = ok(r.ratioStencil) && ok(r.ratioCopy) && way(r.ratioStencil) === way(r.ratioCopy) && way(r.ratioCopy) !== 0;
  return `Air kernel ${figures(r.stencilMcellsPerS)} million cell updates a second (${ratioWords(r.ratioStencil)}). Memory copy ${figures(r.copyGBps)} GB a second (${ratioWords(r.ratioCopy, !sameWay)}). Test version ${r.version}, ${clock(r.at, tzOffsetMin)}. ${CAVEAT}`;
}

/** The row's text (the screen and the copied text): the result of this visit, else the words for what is happening. */
export function speedTestRowValue(f: SpeedTestFacts, tzOffsetMin = 0): string {
  if (f.state === 'running') return SPEED_TEST_RUNNING;
  return f.last ? speedTestResultWords(f.last, tzOffsetMin) : SPEED_TEST_IDLE;
}

/** The polite status line under the button: what is happening, why the button is off, or that a result has come in (the row holds the numbers). */
export function speedTestStatus(f: SpeedTestFacts): string {
  if (f.state === 'running') return SPEED_TEST_RUNNING;
  if (f.state === 'blocked') return f.reason ?? SPEED_TEST_BLOCKED.playing;
  if (!f.last) return '';
  return `Done${ok(f.last.ratioStencil) ? `: ${ratioWords(f.last.ratioStencil)} on the air kernel` : ''}.`;
}
