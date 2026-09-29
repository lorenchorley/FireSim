/**
 * Random operation sequences against the REAL engine (LocalSimController): jumps, plays, pauses, speeds, display steps, and
 * edits, re-runs and undone ignitions. Whatever the timing, the session keeps its invariants:
 *  - the clock never runs while a jump is in progress, and the progress of one jump only goes up;
 *  - the picture is never later than the clock, nor the clock later than the end of the scenario;
 *  - the clock is never left ahead of the computed range for good (it may wait a moment while the engine catches up
 *    after an edit; a stopped view shows the newest computed time);
 *  - the history has strictly increasing times.
 * After the sequence, scrubbing to times the engine produced shows the live fire (arrival times and burn state).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ScenarioData } from '../core/types';
import type { SceneViewApi } from '../render/api';
import { LocalSimController } from '../sim/client';
import { pointIgnition, syntheticScenario } from '../sim/testing/scenarios';
import { SimSession } from './session';

const nullView = new Proxy({}, { get: () => () => null }) as unknown as SceneViewApi;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, ms: number, what: string): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${what}`);
    await sleep(4);
  }
}
function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const g = globalThis as { requestAnimationFrame?: unknown; cancelAnimationFrame?: unknown };
let savedRaf: unknown;
let savedCaf: unknown;
let live: SimSession | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
beforeEach(() => {
  savedRaf = g.requestAnimationFrame;
  savedCaf = g.cancelAnimationFrame;
  g.requestAnimationFrame = (cb: (n: number) => void): number => setTimeout(() => cb(performance.now()), 16) as unknown as number;
  g.cancelAnimationFrame = (id: number): void => clearTimeout(id as unknown as NodeJS.Timeout);
});
afterEach(() => {
  if (timer) clearInterval(timer);
  timer = null;
  live?.dispose();
  live = null;
  g.requestAnimationFrame = savedRaf;
  g.cancelAnimationFrame = savedCaf;
});

interface Rig {
  s: SimSession;
  sc: ScenarioData;
  violations: string[];
  truth: Map<number, { arrival: Float32Array; burn: Uint8Array }>;
}

async function rig(duration: number, step: number): Promise<Rig> {
  const c = new LocalSimController({ chunkMs: 40, simulation: { minSnapshotWallMs: 0 } });
  const sc = syntheticScenario({ ignitions: [pointIgnition('a', -300, 0, 0, 60)], extent: 2400, duration, options: { snapshotInterval: step } });
  const s = new SimSession(sc, c, nullView, { maxBytes: 300e6 });
  live = s;
  const truth: Rig['truth'] = new Map();
  c.on('snapshot', (snap) => truth.set(snap.time, { arrival: snap.fire.arrivalTime.slice(), burn: snap.fire.burnState.slice() }));
  const violations: string[] = [];
  let beyondSince: number | null = null;
  let lastTarget: number | null = null;
  let lastProgress = 0;
  timer = setInterval(() => {
    const st = s.state.get();
    if (st.playing && st.seekTarget !== null) violations.push('playing during a jump');
    if (st.snapshot && st.snapshot.time > st.viewTime + 1e-6) violations.push(`picture ${st.snapshot.time} later than the clock ${st.viewTime}`);
    if (st.viewTime < -1e-9 || st.viewTime > s.duration + 1e-6) violations.push(`clock ${st.viewTime} outside the scenario`);
    if (st.seekProgress < -1e-9 || st.seekProgress > 1 + 1e-9) violations.push(`progress ${st.seekProgress}`);
    if (st.seekTarget !== null && st.seekTarget === lastTarget && st.seekProgress < lastProgress - 1e-9) violations.push(`progress went back ${lastProgress} -> ${st.seekProgress}`);
    lastTarget = st.seekTarget;
    lastProgress = st.seekTarget === null ? 0 : st.seekProgress;
    if (st.snapshot && st.viewTime > st.headTime + 1e-6) {
      beyondSince ??= performance.now();
      if (performance.now() - beyondSince > 10000) violations.push(`clock ${st.viewTime} stuck beyond the computed range ${st.headTime}`);
    } else beyondSince = null;
  }, 3);
  await s.start();
  return { s, sc, violations, truth };
}

describe('random operation sequences', () => {
  for (const seed of [1, 2, 3]) {
    it(`jumps, plays, pauses, speeds and display steps (seed ${seed})`, async () => {
      const R = await rig(3 * 3600, seed === 2 ? 10 : 60);
      const { s } = R;
      const rnd = mulberry32(seed);
      const ops: string[] = [];
      const dur = 3 * 3600;
      for (let i = 0; i < 45; i++) {
        const r = rnd();
        const t = Math.floor(rnd() * dur);
        if (r < 0.25) { ops.push(`seek ${t}`); s.seek(t); }
        else if (r < 0.32) { ops.push(`seek ${t} resume`); s.seek(t, { resume: true }); }
        else if (r < 0.4) { ops.push('play'); s.play(); }
        else if (r < 0.5) { ops.push('pause'); s.pause(); }
        else if (r < 0.55) { ops.push('toggle'); s.toggle(); }
        else if (r < 0.62) { const d = [-3600, -60, 60, 3600][Math.floor(rnd() * 4)]!; ops.push(`stepBy ${d}`); s.stepBy(d); }
        else if (r < 0.68) { ops.push('cancelSeek'); s.cancelSeek(); }
        else if (r < 0.76) { const sp = [1, 60, 600, 3600, Infinity][Math.floor(rnd() * 5)]!; ops.push(`speed ${sp}`); s.setSpeed(sp); }
        else if (r < 0.86) { ops.push(`scrub ${t}`); s.beginScrub(); s.scrub(t * 0.5); s.scrub(t * 0.3); s.endScrub(rnd() < 0.5 ? t : t * 0.3); }
        else if (r < 0.9) { const ts = [10, 30, 60, 120, 300][Math.floor(rnd() * 5)]!; ops.push(`timeStep ${ts}`); s.setTimeStep(ts); }
        await sleep(Math.floor(rnd() * 120));
        if (R.violations.length) throw new Error(`violation after op ${i} (${ops.at(-1)}): ${R.violations.slice(0, 3).join(' | ')}\nops: ${ops.join(', ')}`);
      }
      s.pause();
      await until(() => !s.state.get().computing, 30000, 'idle');
      await sleep(100);
      expect(R.violations).toEqual([]);
      expect(s.state.get().viewTime).toBeLessThanOrEqual(s.state.get().headTime + 1e-6);
      // scrubbing to times the engine produced shows the live fire
      const head = s.state.get().headTime;
      const times = [...R.truth.keys()].filter((x) => x > 0 && x < head - 1).sort((a, b) => a - b);
      expect(times.length).toBeGreaterThan(10);
      let compared = 0;
      let differing = 0;
      for (let k = 0; k < times.length; k += Math.max(1, Math.floor(times.length / 20))) {
        const t = times[k]!;
        s.seek(t);
        const snap = s.state.get().snapshot!;
        expect(snap.time).toBe(t);
        const tr = R.truth.get(t)!;
        for (let q = 0; q < tr.arrival.length; q++) if (!Object.is(snap.fire.arrivalTime[q], tr.arrival[q]) || snap.fire.burnState[q] !== tr.burn[q]) differing++;
        compared++;
      }
      expect(compared).toBeGreaterThan(5);
      expect(differing).toBeLessThan(20 * compared); // (an ember landing inside the last step shows one step early)
    }, 300000);
  }

  for (const seed of [11, 12]) {
    it(`edits, re-runs and undone ignitions between the jumps (seed ${seed})`, async () => {
      const R = await rig(2 * 3600, seed % 2 ? 30 : 60);
      const { s } = R;
      const rnd = mulberry32(seed);
      const ops: string[] = [];
      let id = 0;
      for (let i = 0; i < 40; i++) {
        const r = rnd();
        const st = s.state.get();
        const t = Math.floor(rnd() * 2 * 3600);
        if (r < 0.2) { ops.push(`seek ${t}`); s.seek(t); }
        else if (r < 0.3) { ops.push(`seek ${t} resume`); s.seek(t, { resume: true }); }
        else if (r < 0.4) { ops.push('play'); s.play(); }
        else if (r < 0.48) { ops.push('pause'); s.pause(); }
        else if (r < 0.6) { ops.push(`ignite @${st.viewTime.toFixed(0)}`); s.ignite({ id: `i${id++}`, kind: 'point', points: [[(rnd() - 0.5) * 1800, (rnd() - 0.5) * 1800]], radius: 45, origin: 'observed' }); }
        else if (r < 0.66 && st.ignitions.length > 1) { const ig = st.ignitions[st.ignitions.length - 1]!; ops.push(`removeIgnition ${ig.id}`); s.removeIgnition(ig.id); }
        else if (r < 0.72) { ops.push('solver'); s.setSolverStep(rnd() < 0.5 ? 2 : 0); }
        else if (r < 0.8) { ops.push('rerun'); s.rerunWith({ ...st.options, embers: !st.options.embers }, 'x'); }
        else if (r < 0.87) { ops.push('step'); s.setTimeStep([10, 30, 60][Math.floor(rnd() * 3)]!); }
        else if (r < 0.94) { ops.push('speed'); s.setSpeed([60, 600, Infinity][Math.floor(rnd() * 3)]!); }
        else { ops.push('stepBy'); s.stepBy(-100); }
        await sleep(Math.floor(rnd() * 150));
        if (R.violations.length) throw new Error(`violation after op ${i} (${ops.at(-1)}): ${R.violations.slice(0, 3).join(' | ')}\nops: ${ops.join(', ')}`);
      }
      s.pause();
      await until(() => !s.state.get().computing, 60000, 'idle');
      await sleep(150);
      expect(R.violations).toEqual([]);
      const times = s.snapshots.times();
      for (let i = 1; i < times.length; i++) expect(times[i]!).toBeGreaterThan(times[i - 1]!);
      const st = s.state.get();
      expect(st.viewTime).toBeLessThanOrEqual(st.headTime + 1e-6);
      expect(st.playing).toBe(false);
    }, 300000);
  }
});
