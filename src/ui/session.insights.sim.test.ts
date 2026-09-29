/**
 * Insight cards with the REAL engine on the Katoomba demo (hot NW wind, a fire on the escarpment): a whole run at maximum
 * speed and at 600x never stops by itself (only the end of the scenario does), every card is revealed exactly once, in
 * order and never before the clock reached it, and a fast-forward reveals the cards it passes. Set FIRESIM_SKIP_SLOW=1
 * to skip (about 40 s).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Insight } from '../core/types';
import type { SceneViewApi } from '../render/api';
import { LocalSimController } from '../sim/client';
import { demoScenario, pointIgnition, withIgnitions } from '../sim/testing/scenarios';
import { SimSession } from './session';

const SKIP = typeof process !== 'undefined' && process.env['FIRESIM_SKIP_SLOW'] === '1';
const nullView = new Proxy({}, { get: () => () => null }) as unknown as SceneViewApi;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, ms: number, what: string): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${what}`);
    await sleep(4);
  }
}

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

async function katoomba(hours: number): Promise<SimSession> {
  const base = await demoScenario({ startCivil: [2025, 12, 20, 14], extent: 6000, tier: 'fast', duration: hours * 3600 });
  const sc = withIgnitions(base, [pointIgnition('escarpment', -2170, 900, 0, 60)], { snapshotInterval: 60, tier: 'fast' });
  const s = new SimSession(sc, new LocalSimController({ chunkMs: 40 }), nullView, { maxBytes: 300e6 });
  live = s;
  await s.start();
  return s;
}

function watchReveals(s: SimSession): { log: { id: string; time: number; view: number }[] } {
  const log: { id: string; time: number; view: number }[] = [];
  s.events.on('reveal', (i: Insight) => log.push({ id: i.id, time: i.time, view: s.state.get().viewTime }));
  return { log };
}

describe.skipIf(SKIP)('insight cards with the real engine', () => {
  for (const speed of [Infinity, 600]) {
    it(`a whole run at ${speed === Infinity ? 'maximum speed' : `${speed}x`}: every card once, in order, never early, and playback only stops at the end`, async () => {
      const s = await katoomba(1.5);
      const rv = watchReveals(s);
      const playing: { view: number; playing: boolean }[] = [];
      s.state.subscribe((st) => playing.push({ view: st.viewTime, playing: st.playing }), ['playing']);
      let ended = 0;
      s.events.on('ended', () => ended++);
      s.setSpeed(speed);
      s.play();
      await until(() => ended > 0, 300000, 'the end of the scenario');
      const st = s.state.get();
      // playing went true once and false once, at the end
      expect(playing.map((p) => p.playing)).toEqual([true, false]);
      expect(playing[1]!.view).toBeGreaterThanOrEqual(s.duration - 1);
      expect(st.viewTime).toBe(s.duration);
      expect(st.error).toBeNull();
      // cards
      expect(st.insights.length).toBeGreaterThan(5);
      expect(st.insights.some((i) => i.severity === 'danger')).toBe(true);
      expect(new Set(rv.log.map((e) => e.id)).size).toBe(rv.log.length);
      expect(rv.log.length).toBe(st.insights.length);
      for (const e of rv.log) expect(e.time).toBeLessThanOrEqual(e.view + 1e-6);
      for (let i = 1; i < rv.log.length; i++) expect(rv.log[i]!.time).toBeGreaterThanOrEqual(rv.log[i - 1]!.time - 1);
      // scrubbing over old cards never reveals them again
      const n = rv.log.length;
      s.seek(1000);
      s.seek(s.duration);
      s.seek(2500);
      expect(rv.log.length).toBe(n);
    }, 400000);
  }

  it('a fast-forward reveals the cards it passes, in order, and a jump back and forth reveals nothing twice', async () => {
    const s = await katoomba(1.5);
    const rv = watchReveals(s);
    s.seek(4200);
    await until(() => s.state.get().seekTarget === null, 240000, 'landing');
    expect(rv.log.length).toBeGreaterThan(0);
    for (const e of rv.log) expect(e.time).toBeLessThanOrEqual(4200);
    for (let i = 1; i < rv.log.length; i++) expect(rv.log[i]!.time).toBeGreaterThanOrEqual(rv.log[i - 1]!.time - 1);
    const n = rv.log.length;
    const visibleAt = (t: number): number => {
      s.seek(t);
      return s.visibleInsights().filter((i) => !s.state.get().forecastInsights.includes(i)).length;
    };
    const early = visibleAt(1200);
    const late = visibleAt(4200);
    expect(early).toBeLessThan(late);
    s.seek(0);
    s.seek(3000);
    expect(rv.log.length).toBe(n);
  }, 400000);
});
