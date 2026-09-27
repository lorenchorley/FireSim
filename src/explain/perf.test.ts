/**
 * Performance (spec §13: "detectors, junctions, debris ≤ 10 ms per call" on a phone ≈ 2–3× slower than one x86 Node
 * core; §10.1: < 5 % of the worker, front cells ≤ 20 000) and a real-terrain run on the bundled Katoomba 10 m LiDAR
 * DEM with the fire module's TerrainFeatures producer (spec §2.2).
 */
import { describe, expect, it } from 'vitest';
import { makeGridSpec } from '../core/grid';
import { BurnState, FuelType, type Insight } from '../core/types';
import { loadDemoDem, loadDemoElevation } from '../data';
import { computeTerrainFeatures } from '../fire/terrainFeatures';
import { buildTerrain, terrainDerived } from '../terrain';
import { InsightEngine } from './engine';
import { DOCTRINE } from './text';
import { TestWorld } from './testing/simState';

const median = (a: number[]): number => [...a].sort((x, y) => x - y)[a.length >> 1]!;

/** 9 km × 9 km at 30 m (301² cells) of ridges and valleys with the real feature producer. */
function mountainWorld(): TestWorld {
  const w = new TestWorld({
    extentM: 9030,
    elevation: (x, y) => 700 + 260 * Math.sin(x / 1100) * Math.cos(y / 800) + 120 * Math.sin((x + y) / 450) + 0.02 * y,
    temperature: 34,
    rh: 15,
    windSpeed: 30 / 3.6,
    windDir: 300,
    moisture: 6,
    droughtFactor: 10,
    kbdi: 160,
  });
  const f = computeTerrainFeatures(w.terrain, w.derived);
  Object.assign(w.features, f);
  (w.features as { crest: typeof f.crest }).crest = f.crest.bind(f);
  // Patchy fuels: a recent burn, wet gullies, a break.
  w.forEach((k, x, y) => {
    if (Math.hypot(x - 2500, y - 1500) < 600) w.fuel.timeSinceFire[k] = 3;
    if (w.features.drainage[k] && w.derived.tpiSmall[k]! < -8) w.fuel.type[k] = FuelType.WetForest;
  });
  return w;
}

function timeEngine(w: TestWorld, cycles: number): { ctorMs: number; ms: number[]; all: Insight[] } {
  const t0 = performance.now();
  const eng = new InsightEngine(w.terrain, w.derived, w.fuel, w.features, { startTime: w.startMs });
  const ctorMs = performance.now() - t0;
  const ms: number[] = [];
  const all: Insight[] = [];
  for (let c = 0; c < cycles; c++) {
    w.setTime(4 * 3600 + 60 * c);
    const a = performance.now();
    all.push(...eng.update(w.view));
    ms.push(performance.now() - a);
  }
  return { ctorMs, ms: ms.slice(5), all };
}

describe('detector cost (spec §13, §10.1)', () => {
  it('typical 9 km scenario (≈ 3 km wide fire): median update ≤ 5 ms on Node (≤ 10 ms phone budget; measured ≈ 2–3 ms)', () => {
    const w = mountainWorld();
    w.igniteDisc(-500, 0, 1500, { ros: 0.3, intensity: 6000, flameHeight: 7 });
    const r = timeEngine(w, 40);
    expect(median(r.ms)).toBeLessThan(5);
    expect(r.ctorMs).toBeLessThan(1500);
    for (const i of r.all) expect(i.safety!.endsWith(DOCTRINE)).toBe(true);
    console.log(`explain 301² typical: ctor ${r.ctorMs.toFixed(0)} ms, update median ${median(r.ms).toFixed(2)} ms, max ${Math.max(...r.ms).toFixed(2)} ms, ${r.all.length} insights`);
  });

  it('stress: ≈ 22 000 front cells (strided sampling above 6000), median update ≤ 25 ms on Node (measured ≈ 11 ms)', () => {
    const w = mountainWorld();
    const g = w.grid;
    const f = w.view.fire;
    // Burning rows every 4th row with burnt-out rows between → ~ 22 000 front cells.
    for (let j = 1; j < g.ny - 1; j++) {
      for (let i = 0; i < g.nx; i++) {
        const k = j * g.nx + i;
        if (f.burnState[k] === BurnState.NonFlammable) continue;
        const m = j % 4;
        if (m === 0) {
          f.burnState[k] = BurnState.Burning;
          f.arrivalTime[k] = 0;
          f.ros[k] = 0.1;
          f.intensity[k] = 3000;
          f.flameHeight[k] = 4;
          f.spreadDir[k] = 0;
          w.view.aux.direction[k] = 1;
        } else if (m === 3) f.burnState[k] = BurnState.BurntOut;
      }
    }
    w.refreshFront();
    expect(w.view.aux.front.length).toBeGreaterThan(18000);
    const r = timeEngine(w, 20);
    expect(median(r.ms)).toBeLessThan(25);
    console.log(`explain 301² stress (${w.view.aux.front.length} front cells): update median ${median(r.ms).toFixed(1)} ms`);
  });
});

describe('Katoomba LiDAR DEM (bundled)', async () => {
  const centre = { lat: -33.715, lon: 150.285 };
  const grid = makeGridSpec(centre, 6000, 30);
  const el = await loadDemoElevation(grid, ['katoomba']);
  const hi = await loadDemoDem('katoomba');
  it.skipIf(!el || !hi)('the detectors run on real escarpment terrain: plausible cards, no NaN text, explainAt everywhere', () => {
    const terrain = buildTerrain(grid, el!.elevation, el!.source);
    const derived = terrainDerived(terrain);
    const features = computeTerrainFeatures(terrain, derived, { grid: hi!.grid, elevation: hi!.elevation });
    // Re-use the test double's view with the real terrain.
    const w = new TestWorld({ extentM: 6000, temperature: 33, rh: 15, windSpeed: 35 / 3.6, windDir: 300, moisture: 6, droughtFactor: 10, kbdi: 150 });
    expect(w.grid.nx).toBe(grid.nx);
    Object.assign(w.terrain, terrain);
    Object.assign(w.derived, derived);
    Object.assign(w.features, features);
    (w.features as { crest: typeof features.crest }).crest = features.crest.bind(features);
    w.igniteDisc(-800, -600, 700, { ros: 0.25, intensity: 8000, flameHeight: 8 });
    const t0 = performance.now();
    const eng = new InsightEngine(w.terrain, w.derived, w.fuel, w.features, { startTime: w.startMs });
    const ctorMs = performance.now() - t0;
    const all: Insight[] = [];
    const ms: number[] = [];
    for (let c = 0; c < 20; c++) {
      w.setTime(4 * 3600 + 60 * c);
      const a = performance.now();
      all.push(...eng.update(w.view));
      if (c >= 5) ms.push(performance.now() - a);
    }
    const kinds = new Set(all.map((i) => i.kind));
    // A hot NW day on the Blue Mountains escarpment: slope and crown/heavy fuel cards appear.
    expect(kinds.has('upslope-run') || kinds.has('downslope-backing')).toBe(true);
    for (const i of all) {
      expect(i.safety!.endsWith(DOCTRINE)).toBe(true);
      expect(`${i.title} ${i.body}`).not.toMatch(/NaN|undefined|\?/);
      expect(Number.isFinite(i.x) && Number.isFinite(i.y)).toBe(true);
    }
    for (let a = 0; a < 50; a++) {
      const e = eng.explainAt(-2900 + a * 118, 2900 - a * 118, w.view);
      expect(e.narrative.length).toBeGreaterThan(0);
      expect(e.narrative.length).toBeLessThanOrEqual(5);
      for (const l of e.narrative) expect(l).not.toMatch(/NaN|undefined/);
    }
    // Measured ≈ 1.5 ms alone; the gate leaves room for CPU contention when the whole suite runs in parallel.
    expect(median(ms)).toBeLessThan(10);
    console.log(`explain Katoomba 200²: ctor ${ctorMs.toFixed(0)} ms, update median ${median(ms).toFixed(2)} ms; kinds ${[...kinds].join(', ')}`);
  });
});
