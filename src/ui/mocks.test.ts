import { describe, expect, it } from 'vitest';
import type { Insight, SimSnapshot } from '../core/types';
import { MockSimController, mockBuildScenario } from './mocks';
import { slopeFactor } from './mockFire';
import type { BuildProgress } from '../scenario/request';

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
});
