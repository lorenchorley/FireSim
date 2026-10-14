/**
 * What the always-on timing statistics cost (plan §5.4 "Cost guardrails"): under 1 % of whole-step time on the fast and
 * standard tiers, under 16 KB retained in the worker, no allocation per step, no extra clock reads. Timing on a shared
 * machine is noisy, so the 1 % is checked as a measured cost per step (the feed plus one report per step, the worst
 * case) against the measured whole-step time of a real run, and the on/off comparison of whole runs is reported and
 * held to a looser bound. Numbers go to stderr like atmosphere/perf.test.ts's `[atmos perf]`.
 */
import { PerformanceObserver } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { typedArrayFootprint } from '../core/datasets';
import type { QualityTier } from '../core/types';
import { PerfStats } from './perfStats';
import { Simulation } from './simulation';
import { pointIgnition, syntheticScenario } from './testing/scenarios';

const log = (s: string): void => {
  process.stderr.write(`[sim perf] ${s}\n`);
};

const scenario = (extent: number) => syntheticScenario({ ignitions: [pointIgnition('a', -300, 0, 0, 60)], extent, options: { snapshotInterval: 60 } });

/** Wall ms of `steps` whole steps after `warm` warm-up steps (the 3-D spin-up is skipped: only the loop is timed). */
function timeRun(tier: QualityTier, perfStats: boolean, extent: number, warm: number, steps: number): { ms: number; medianMs: number | null } {
  const sim = new Simulation(scenario(extent), { tier, perfStats, skipSpinUp: true });
  const dt = tier === 'fast' ? 10 : 6; // the loop takes whole atmosphere steps: this is a coarse way to ask for a fixed number
  let t = 0;
  for (let i = 0; i < warm; i++) sim.advance((t += dt));
  const t0 = performance.now();
  const s0 = sim.perf().steps;
  while (sim.perf().steps - s0 < steps) sim.advance((t += dt));
  const ms = performance.now() - t0;
  return { ms: ms / (sim.perf().steps - s0), medianMs: sim.snapshot().engine?.perf?.step.medianMs ?? null };
}

describe('statistics cost', () => {
  it('add no clock reads: a run reads the clock as often with statistics on as off', () => {
    for (const tier of ['fast', 'standard'] as const) {
      const reads: number[] = [];
      for (const perfStats of [false, true]) {
        let n = 0;
        const sim = new Simulation(scenario(1500), { tier, perfStats, skipSpinUp: true, clock: () => (n++, 0) });
        sim.advance(300);
        sim.snapshot();
        reads.push(n);
      }
      expect(reads[1], tier).toBe(reads[0]);
      expect(reads[0]).toBeGreaterThan(100); // it did read the clock: the comparison means something
    }
  }, 120000);

  it('holds under 16 KB in the worker: measured typed arrays, and the engine memory report grows by that much and no more', () => {
    const on = new Simulation(scenario(1500), { perfStats: true });
    const off = new Simulation(scenario(1500), { perfStats: false });
    const stats = (on as unknown as { perfStats: PerfStats }).perfStats;
    const typed = typedArrayFootprint(stats).bytes;
    log(`statistics retained: ${typed} bytes of typed arrays, ${stats.retainedBytes()} bytes with the event queue at its largest`);
    expect(typed).toBeGreaterThan(5000);
    expect(stats.retainedBytes()).toBeLessThan(16 * 1024);
    expect(stats.retainedBytes()).toBeGreaterThanOrEqual(typed);
    // The memory report walks every typed array of the simulation: the statistics are the whole difference.
    expect(on.memoryReport().totalBytes - off.memoryReport().totalBytes).toBe(typed);
  }, 60000);

  it('feeding a step allocates nothing: no garbage collection in a million steps', async () => {
    const gcs: number[] = [];
    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) gcs.push(e.startTime);
    });
    obs.observe({ entryTypes: ['gc'] });
    const s = new PerfStats();
    const laps = ['records', 'stamps', 'weatherNight', 'solarMoisture', 'fireMasks', 'surfaceWind', 'firePrepare', 'fireStep', 'fireHeat', 'atmosphere', 'embers', 'fireMinute', 'diagnostics', 'explain', 'snapshot', 'checkpoint'];
    const feed = (n: number): void => {
      let t = 5000;
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < laps.length; k++) s.addLap(laps[k]!, 0.5);
        s.noteAirStep(i & 3, 20 + (i & 7), 3, 2);
        s.noteFireSubSteps(i & 3);
        s.noteRecomputed(i & 1);
        s.endStep(t, t + 9.5, 10, i * 10);
        t += 10;
      }
    };
    feed(20000); // warm up (compiles, fills the rings)
    await new Promise((r) => setTimeout(r, 20));
    obs.takeRecords();
    gcs.length = 0;
    feed(1_000_000);
    await new Promise((r) => setTimeout(r, 50)); // GC entries are delivered on a later turn
    const seen = gcs.length + obs.takeRecords().length;
    obs.disconnect();
    log(`a million fed steps: ${seen} garbage collections`);
    expect(seen).toBe(0);
  }, 120000);

  for (const [tier, extent] of [
    ['fast', 6000],
    ['standard', 6000],
  ] as const) {
    it(`${tier} tier: the feed plus a report per step costs under 1 % of a whole step, and whole runs agree within noise`, () => {
      // 1. A real run with statistics on: the whole-step time to compare with.
      const warm = tier === 'fast' ? 20 : 10;
      const steps = tier === 'fast' ? 80 : 40;
      const reps: { on: number; off: number }[] = [];
      let median: number | null = null;
      for (let r = 0; r < 4; r++) {
        const off = timeRun(tier, false, extent, warm, steps);
        const on = timeRun(tier, true, extent, warm, steps);
        reps.push({ on: on.ms, off: off.ms });
        median = on.medianMs ?? median;
      }
      const onMs = Math.min(...reps.map((x) => x.on));
      const offMs = Math.min(...reps.map((x) => x.off));
      const wholeRun = ((onMs - offMs) / offMs) * 100;
      // 2. The cost per step of the statistics themselves, in isolation (a report every step is the worst case: a display
      //    step as short as the solver step).
      const s = new PerfStats();
      const N = 100_000;
      let t = 0;
      const t0 = performance.now();
      for (let i = 0; i < N; i++) {
        s.addLap('atmosphere', 6);
        s.addLap('fireStep', 2);
        s.addLap('surfaceWind', 1);
        s.addLap('embers', 1);
        s.addLap('snapshot', 1);
        s.noteAirStep(i & 3, 20, 3, 2);
        s.noteFireSubSteps(3);
        s.endStep(t, t + 11, 10, i * 10);
        t += 12;
      }
      const feedUs = ((performance.now() - t0) / N) * 1000;
      const R = 20_000;
      const t1 = performance.now();
      for (let i = 0; i < R; i++) s.report({ nowMs: t, stepStartMs: t - 3, spinUpWallS: 1, burningCells: 100 });
      const reportUs = ((performance.now() - t1) / R) * 1000;
      const stepUs = (median ?? 0) * 1000;
      const share = ((feedUs + reportUs) / stepUs) * 100;
      log(
        `${tier} ${extent / 1000} km: whole step ${(median ?? 0).toFixed(2)} ms (median); statistics per step: feed ${feedUs.toFixed(2)} us + report ${reportUs.toFixed(2)} us = ${share.toFixed(3)} % of a step; ` +
          `whole runs, best of 4: off ${offMs.toFixed(3)} ms, on ${onMs.toFixed(3)} ms per step (${wholeRun >= 0 ? '+' : ''}${wholeRun.toFixed(2)} %)`,
      );
      expect(median).not.toBeNull();
      expect(share).toBeLessThan(1);
      expect(wholeRun).toBeLessThan(5); // noise bound; the 1 % claim is the per-step cost above
    }, 300000);
  }
});
