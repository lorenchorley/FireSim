/**
 * Regression tests from the review of the timeline / history work, with the REAL engine (LocalSimController): jumps of
 * hours, cancelling, retargeting, edits during a jump, and the clock never showing more than what is computed.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ScenarioData } from '../core/types';
import type { SceneViewApi } from '../render/api';
import { LocalSimController } from '../sim/client';
import { pointIgnition, syntheticScenario } from '../sim/testing/scenarios';
import { SimSession } from './session';

const nullView = new Proxy({}, { get: () => () => null }) as unknown as SceneViewApi;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, ms = 60000, what = 'condition'): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${what}`);
    await sleep(4);
  }
}

// A real-time animation-frame clock (the session's loop needs one; Node has none).
const g = globalThis as { requestAnimationFrame?: unknown; cancelAnimationFrame?: unknown };
let savedRaf: unknown;
let savedCaf: unknown;
let live: SimSession | null = null;
beforeEach(() => {
  savedRaf = g.requestAnimationFrame;
  savedCaf = g.cancelAnimationFrame;
  g.requestAnimationFrame = (cb: (n: number) => void): number => setTimeout(() => cb(performance.now()), 16) as unknown as number;
  g.cancelAnimationFrame = (id: number): void => clearTimeout(id as unknown as NodeJS.Timeout);
});
afterEach(() => {
  live?.dispose();
  live = null;
  g.requestAnimationFrame = savedRaf;
  g.cancelAnimationFrame = savedCaf;
});

async function rig(o: { duration?: number; ignitions?: ScenarioData['ignitions'] } = {}): Promise<{ s: SimSession; c: LocalSimController; sc: ScenarioData }> {
  const c = new LocalSimController({ chunkMs: 40, simulation: { minSnapshotWallMs: 0 } });
  const sc = syntheticScenario({ ignitions: o.ignitions ?? [pointIgnition('a', -300, 0, 0, 60)], extent: 2400, duration: o.duration ?? 4 * 3600 });
  const s = new SimSession(sc, c, nullView, { maxBytes: 300e6 });
  live = s;
  await s.start();
  return { s, c, sc };
}

describe('timeline jumps of hours with the real engine', () => {
  it('+3 h while paused: progress only goes up, the view follows the engine, it stops exactly and the engine goes idle', async () => {
    const { s } = await rig();
    const progress: number[] = [];
    const seen: string[] = [];
    s.state.subscribe((st) => {
      if (st.seekTarget !== null) progress.push(st.seekProgress);
      if (st.viewTime > st.headTime + 1e-6) seen.push(`view ${st.viewTime} beyond head ${st.headTime}`);
      if (st.playing && st.seekTarget !== null) seen.push('playing during a jump');
    });
    s.seek(3 * 3600 + 37);
    expect(s.state.get().playing).toBe(false);
    await until(() => s.state.get().seekTarget === null, 120000, 'landing');
    const st = s.state.get();
    expect(st.viewTime).toBe(3 * 3600 + 37);
    expect(st.snapshot!.time).toBe(3 * 3600 + 37);
    expect(st.playing).toBe(false);
    expect(progress.length).toBeGreaterThan(5);
    for (let i = 1; i < progress.length; i++) expect(progress[i]!).toBeGreaterThanOrEqual(progress[i - 1]!);
    expect(seen).toEqual([]);
    await until(() => !s.state.get().computing, 10000, 'idle');
    const head = s.state.get().headTime;
    await sleep(200);
    expect(s.state.get().headTime).toBe(head);
  }, 300000);

  it('cancelling a jump (pause) stops the engine at once; a jump into the computed range during a jump does too', async () => {
    const { s } = await rig({ duration: 2 * 3600 });
    s.seek(2 * 3600);
    await until(() => s.state.get().seekProgress > 0.15, 60000, 'progress');
    s.pause();
    expect(s.state.get().seekTarget).toBeNull();
    const stopAt = s.state.get().viewTime;
    await sleep(400);
    const head = s.state.get().headTime;
    await sleep(400);
    expect(s.state.get().headTime).toBe(head);
    expect(s.state.get().viewTime).toBe(stopAt);
    // second jump, then a jump back into the computed range
    s.seek(2 * 3600);
    await until(() => s.state.get().seekProgress > 0.1, 60000, 'progress 2');
    const mid = s.state.get().viewTime;
    s.seek(mid - 100);
    expect(s.state.get().seekTarget).toBeNull();
    await sleep(400);
    const h2 = s.state.get().headTime;
    await sleep(400);
    expect(s.state.get().headTime).toBe(h2);
    expect(s.state.get().viewTime).toBe(mid - 100);
  }, 300000);

  it('an ignition during a jump applies at the view time, ends the jump and leaves a consistent session', async () => {
    const { s, c } = await rig({ duration: 2 * 3600 });
    s.seek(2 * 3600);
    await until(() => s.state.get().seekProgress > 0.25, 60000, 'progress');
    const vt = s.state.get().viewTime;
    const ign = s.ignite({ id: 'x', kind: 'point', points: [[500, 300]], radius: 45, origin: 'observed' });
    expect(ign.time).toBe(vt);
    expect(s.state.get().seekTarget).toBeNull();
    await until(() => !s.state.get().computing && c.simulation!.time >= c.simulation!.logicalNow - 1e-6, 60000, 'idle');
    const st = s.state.get();
    expect(st.viewTime).toBe(vt);
    expect(st.viewTime).toBeLessThanOrEqual(st.headTime + 1e-6);
    s.seek(vt + 900);
    await until(() => s.state.get().seekTarget === null, 60000, 'landing');
    const grid = s.scenario.terrain.grid;
    const k = Math.round((500 - grid.x0) / grid.cellSize) + Math.round((300 - grid.y0) / grid.cellSize) * grid.nx;
    const arrival = s.state.get().snapshot!.fire.arrivalTime[k]!;
    expect(arrival).toBeGreaterThanOrEqual(vt - 1);
    expect(arrival).toBeLessThan(vt + 200);
  }, 300000);
});

describe('the clock never stays ahead of the computed range', () => {
  it('pausing while the clock waits for the engine (a re-run dropped the results) shows the newest computed time', async () => {
    const { s } = await rig({ duration: 2 * 3600, ignitions: [pointIgnition('a', -300, 0, 0, 60), pointIgnition('b', 300, 200, 100, 45)] });
    s.seek(1800);
    await until(() => s.state.get().seekTarget === null, 60000, 'landing');
    s.play();
    expect(s.state.get().playing).toBe(true);
    // Removing the early ignition drops every result after it; the clock (1800 s) is now far ahead of the results.
    s.removeIgnition('b');
    expect(s.state.get().headTime).toBeLessThan(1800);
    s.pause();
    const st = s.state.get();
    expect(st.playing).toBe(false);
    expect(st.viewTime).toBeLessThanOrEqual(st.headTime + 1e-6);
    expect(st.snapshot!.time).toBe(st.viewTime);
    // The engine is re-running the removed part anyway; whatever it delivers, the view stays inside it.
    await sleep(300);
    const later = s.state.get();
    expect(later.viewTime).toBeLessThanOrEqual(later.headTime + 1e-6);
  }, 120000);
});
