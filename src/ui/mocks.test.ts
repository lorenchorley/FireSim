import { describe, expect, it } from 'vitest';
import type { Insight, SimSnapshot } from '../core/types';
import { MockSimController, mockBuildScenario } from './mocks';
import { slopeFactor } from './mockFire';
import type { BuildProgress } from '../scenario/request';
import { datasetIssues } from '../core/datasets';

describe('mock fire physics helpers', () => {
  it('slope factor doubles about every 10° uphill and never halves downhill', () => {
    expect(slopeFactor(0)).toBeCloseTo(1);
    expect(slopeFactor(10)).toBeCloseTo(2, 0);
    expect(slopeFactor(-10)).toBeCloseTo(0.67, 1);
    expect(slopeFactor(-40)).toBeGreaterThan(0.5);
  });
});

describe('mock scenario + controller', () => {
  it('builds Katoomba from bundled terrain and grows a fire with insights', async () => {
    const steps: BuildProgress[] = [];
    const scenario = await mockBuildScenario(
      {
        centre: { lat: -33.715, lon: 150.285 },
        extent: 6000,
        demoSiteId: 'katoomba',
        weather: { kind: 'preset', presetId: 'hot-nw-sw-change', start: Date.UTC(2026, 0, 10, 0) },
        duration: 6 * 3600,
        options: { fireCellSize: 40 },
        online: false,
      },
      (p) => steps.push(p),
    );
    expect(steps.at(-1)!.step).toBe('done');
    expect(scenario.terrain.source).toMatch(/NSW|LiDAR|Terrain|Synthetic/i);
    expect(scenario.terrain.maxElevation - scenario.terrain.minElevation).toBeGreaterThan(200);
    // The mock carries a data-set inventory like a real build: real bundled terrain, everything fabricated says so.
    expect(datasetIssues(scenario.datasets!)).toEqual([]);
    expect(scenario.datasets!.find((r) => r.id === 'terrain')).toMatchObject({ status: 'used', origin: 'bundled' });
    expect(scenario.datasets!.find((r) => r.id === 'terrain')!.sizes.transferredBytes).toBeGreaterThan(100_000);
    expect(scenario.datasets!.find((r) => r.id === 'weather')).toMatchObject({ status: 'fallback', origin: 'synthetic' });
    expect(scenario.datasetSummary!.totals.count).toBe(scenario.datasets!.length);
    expect(scenario.datasetSummary!.workingMemory!.cells).toBe(scenario.terrain.grid.nx * scenario.terrain.grid.ny);
    expect(new Set(steps.map((p) => p.step))).not.toContain('moisture' as never);

    const sim = new MockSimController();
    const snaps: SimSnapshot[] = [];
    const insights: Insight[] = [];
    sim.on('snapshot', (s) => {
      snaps.push(s);
      insights.push(...s.insights);
    });
    const forecast = await sim.init(scenario);
    expect(forecast.some((i) => i.kind === 'wind-change')).toBe(true);
    sim.ignite({ id: 'a', kind: 'point', points: [[-800, -600]], time: 0, radius: 60, origin: 'observed' });
    await new Promise<void>((resolve) => {
      sim.on('status', (st) => {
        if (!st.running && st.time >= 6 * 3600) resolve();
      });
      sim.run(6 * 3600);
    });
    const last = snaps.at(-1)!;
    expect(last.time).toBe(6 * 3600);
    expect(last.stats.burntAreaHa).toBeGreaterThan(20);
    expect(snaps[3]!.stats.burntAreaHa).toBeLessThan(last.stats.burntAreaHa);
    expect(insights.length).toBeGreaterThan(1);
    expect(insights.some((i) => i.severity === 'danger')).toBe(true);
    const ex = await sim.explain(-800, -600);
    expect(ex.narrative.length).toBeGreaterThan(2);
    expect(Number.isFinite(ex.arrivalTime)).toBe(true);
    sim.dispose();
  }, 60_000);

  it('honours the display step live, ends a run with a snapshot at exactly the target, and computes hours in seconds', async () => {
    const scenario = await mockBuildScenario({
      centre: { lat: -33.715, lon: 150.285 },
      extent: 3000,
      demoSiteId: 'katoomba',
      weather: { kind: 'preset', presetId: 'hot-nw-sw-change', start: Date.UTC(2026, 0, 10, 0) },
      duration: 6 * 3600,
      options: { fireCellSize: 60, snapshotInterval: 60 },
      online: false,
    }, () => undefined);
    const sim = new MockSimController();
    const times: number[] = [];
    let last: { time: number; running: boolean; until?: number } | null = null;
    sim.on('snapshot', (s) => times.push(s.time));
    sim.on('status', (st) => (last = st));
    await sim.init(scenario);
    sim.ignite({ id: 'a', kind: 'point', points: [[-300, -200]], time: 0, radius: 60, origin: 'observed' });
    const runTo = (t: number): Promise<void> =>
      new Promise((resolve) => {
        const off = sim.on('status', (st) => {
          if (!st.running && st.time >= t) {
            off();
            resolve();
          }
        });
        sim.run(t);
      });
    await runTo(1237);
    expect(times.at(-1)).toBe(1237); // the run-end snapshot, at exactly the target
    expect(last!.until).toBe(1237);
    sim.setOption('snapshotInterval', 30);
    times.length = 0;
    await runTo(2000);
    expect(times.at(-1)).toBe(2000);
    for (const t of times.slice(0, -1)) expect(t % 30).toBe(0);
    // A jump across hours is one run: well under a second per simulated hour.
    times.length = 0;
    const t0 = Date.now();
    await runTo(6 * 3600);
    expect(Date.now() - t0).toBeLessThan(15_000);
    expect(times.at(-1)).toBe(6 * 3600);
    sim.dispose();
  }, 60_000);
});

