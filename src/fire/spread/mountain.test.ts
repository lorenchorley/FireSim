/**
 * Mountain phenomena of the spread (spec §7.6–§7.11; §15 V10, V11, V14): vorticity-driven lateral spread on a
 * synthetic lee slope (on vs off, and no VLS in a 10 km/h wind), the attachment amplifier in a V-gully (chimney),
 * junction closing speed, rolling debris.
 */
import { describe, expect, it } from 'vitest';
import { cellAt, type GridSpec } from '../../core/grid';
import { FuelType, SpreadDriver } from '../../core/types';
import { createHeadKernelOut, headRosKernel } from '../models';
import { fuelParamsAt } from '../../fuel/fuelMap';
import { junctionGeometric } from './math';
import { makeScenario, runScenario, syntheticTerrain, uniformFuel, type Scenario } from './testing';

const DEG = Math.PI / 180;

const tAt = (s: Scenario, x: number, y: number): number => s.model.field.arrivalTime[cellAt(s.terrain.grid, x, y)]!;

describe('VLS on a lee slope (spec §7.9, V10)', () => {
  // N–S ridge at x = 0: windward (west) slope 15°, lee (east) slope 28°, relief 250 m; W wind; M 6 %.
  const H = 250;
  const ridge = (x: number): number => 400 + Math.max(0, x < 0 ? H + x * Math.tan(15 * DEG) : H - x * Math.tan(28 * DEG));
  const run = (mountain: boolean, windKmh: number): Scenario => {
    const terrain = syntheticTerrain(2400, 30, ridge);
    const s = makeScenario(terrain, uniformFuel(terrain.grid, FuelType.DryForestShrubby), {
      windKmh, windFromDeg: 270, moisturePct: 6, droughtFactor: 10, mountainPhenomena: mountain, uRidge: 'crest',
    });
    s.model.ignite({ id: 'l', kind: 'line', points: [[-800, -300], [-800, 300]], time: 0, origin: 'observed' });
    runScenario(s, 3600, { dtA: 12, leeBlend: true });
    return s;
  };
  const leeStats = (s: Scenario) => {
    const g: GridSpec = s.terrain.grid;
    const f = s.model.field;
    let ymax = 0;
    let n = 0;
    let lv = 0;
    for (let j = 0; j < g.ny; j++) {
      for (let i = 0; i < g.nx; i++) {
        const k = j * g.nx + i;
        const x = g.x0 + i * g.cellSize;
        if (!(x > 0 && x < 160) || !(f.arrivalTime[k]! < Infinity)) continue;
        ymax = Math.max(ymax, Math.abs(g.y0 + j * g.cellSize));
        n++;
        if (f.driver[k] === SpreadDriver.LateralVorticity) lv++;
      }
    }
    return { ymax, n, lvShare: n ? lv / n : 0 };
  };

  it('strong wind, mountainPhenomena on: zones form and activate; lateral spread along the lee slope at 1.5–4 km/h; LV drivers', () => {
    const s = run(true, 40);
    const a = s.model.aux();
    let zone = 0;
    for (let k = 0; k < a.vls.length; k++) if (a.vls[k]! >= 0.5) zone++;
    expect(zone).toBeGreaterThan(100);
    // The lee-separation weight is on over the lee slope and off on the windward slope.
    expect(a.sep[cellAt(s.terrain.grid, 100, 0)]!).toBeGreaterThan(0.9);
    expect(a.sep[cellAt(s.terrain.grid, -300, 0)]!).toBe(0);
    const st = leeStats(s);
    expect(st.lvShare).toBeGreaterThanOrEqual(0.2);
    // Lateral rate along the upper lee slope (x = 45 m) beyond the crossing strip.
    const rate = (360 / (tAt(s, 45, 1005) - tAt(s, 45, 645))) * 3.6;
    expect(rate).toBeGreaterThan(1.5);
    expect(rate).toBeLessThan(4);
    const off = leeStats(run(false, 40));
    expect(off.lvShare).toBe(0);
    expect(st.ymax).toBeGreaterThan(off.ymax + 300);
  });

  it('no VLS zone at 10 km/h', () => {
    const s = run(true, 10);
    const a = s.model.aux();
    let zone = 0;
    let active = 0;
    for (let k = 0; k < a.vls.length; k++) {
      if (a.vls[k]! >= 0.5) zone++;
      active += a.vlsActive[k]!;
    }
    expect(zone).toBe(0);
    expect(active).toBe(0);
    expect(leeStats(s).lvShare).toBe(0);
  });
});

describe('attachment in a V-gully (spec §7.6, §7.7, V11)', () => {
  it('head ROS up a 30° V-gully (25° walls, 60 m deep) ≥ 1.8 × the open 30° slope; eruptive driver; not validated', () => {
    const t30 = Math.tan(30 * DEG);
    const t25 = Math.tan(25 * DEG);
    const wall = 60 / t25;
    // Gully along x = −300 (up-gully north); open 30° plane elsewhere.
    const terrain = syntheticTerrain(1600, 10, (x, y) => 500 + t30 * y + (Math.abs(x + 300) < wall ? t25 * Math.abs(x + 300) - 60 : 0));
    const s = makeScenario(terrain, uniformFuel(terrain.grid, FuelType.DryForestShrubby), { windKmh: 0, moisturePct: 8, droughtFactor: 10, mountainPhenomena: true });
    s.model.ignite(point(-300, -600));
    s.model.ignite(point(400, -600));
    runScenario(s, 2.5 * 3600, { dtA: 60 });
    const g = s.terrain.grid;
    const ros = (x: number): number => (200 / (tAt(s, x, -300) - tAt(s, x, -500))) * 3600;
    const gully = ros(-300);
    const open = ros(400);
    expect(gully / open).toBeGreaterThanOrEqual(1.8);
    const k = cellAt(g, -300, -350);
    expect(s.model.field.driver[k]).toBe(SpreadDriver.Eruptive);
    expect(s.model.validatedAt(k)).toBe(false);
    expect(s.model.aux().attach[k]!).toBeGreaterThan(0.3);
  });
});

const point = (x: number, y: number, time = 0) => ({ id: 'p', kind: 'point' as const, points: [[x, y]] as [number, number][], time, origin: 'observed' as const });

describe('junctions (spec §7.10, V14)', () => {
  it('V of two line fires at 30°: the wedge closes at ≥ 0.9 × R/sin(15°); Junction drivers appear (pyrogenic off)', () => {
    const terrain = syntheticTerrain(1400, 10, () => 500);
    const fuel = uniformFuel(terrain.grid, FuelType.Heath);
    const s = makeScenario(terrain, fuel, { windKmh: 0, moisturePct: 8, droughtFactor: 10 });
    const L = 500;
    const sx = L * Math.sin(15 * DEG);
    const sy = L * Math.cos(15 * DEG);
    s.model.ignite({ id: 'v', kind: 'line', points: [[-sx, sy - 300], [0, -300], [sx, sy - 300]], time: 0, origin: 'observed' });
    runScenario(s, 2400, { dtA: 30 });
    const K = createHeadKernelOut();
    headRosKernel(fuelParamsAt(fuel, 0), 0, 8, 1, K, 10);
    const close = (150 / (tAt(s, 0, -50) - tAt(s, 0, -200))) * 3600;
    expect(close).toBeGreaterThanOrEqual(0.9 * junctionGeometric(30) * K.rw);
    let nJ = 0;
    const f = s.model.field;
    for (let k = 0; k < f.driver.length; k++) if (f.driver[k] === SpreadDriver.Junction) nJ++;
    expect(nJ).toBeGreaterThan(3);
  });

  it('no junction boost with the pyrogenic potential on (fast tier)', () => {
    const terrain = syntheticTerrain(1000, 10, () => 500);
    const s = makeScenario(terrain, uniformFuel(terrain.grid, FuelType.Heath), { windKmh: 0, moisturePct: 8, droughtFactor: 10, pyrogenicOn: true });
    const sx = 300 * Math.sin(15 * DEG);
    const sy = 300 * Math.cos(15 * DEG);
    s.model.ignite({ id: 'v', kind: 'line', points: [[-sx, sy - 200], [0, -200], [sx, sy - 200]], time: 0, origin: 'observed' });
    runScenario(s, 1200, { dtA: 30 });
    const j = s.model.aux().junction;
    for (let k = 0; k < j.length; k++) expect(j[k]).toBe(1);
  });
});

describe('rolling debris (spec §7.11)', () => {
  it('burning steep stringybark cells release items that roll downslope and are kept 10 min', () => {
    const terrain = syntheticTerrain(1200, 20, (_x, y) => 600 + Math.tan(35 * DEG) * Math.max(-300, y));
    const fuel = uniformFuel(terrain.grid, FuelType.DryForestShrubby);
    fuel.barkHazard.fill(3.5);
    const s = makeScenario(terrain, fuel, { windKmh: 10, windFromDeg: 180, moisturePct: 5, droughtFactor: 10, mountainPhenomena: true });
    s.model.ignite({ id: 'l', kind: 'line', points: [[-300, 100], [300, 100]], time: 0, origin: 'observed' });
    let seen = 0;
    let downhill = 0;
    const z = terrain.elevation;
    const g = terrain.grid;
    runScenario(s, 3600, {
      dtA: 12,
      onStep: () => {
        for (const d of s.model.aux().debris) {
          seen++;
          const n = d.path.length;
          const z0 = z[cellAt(g, d.path[0]!, d.path[1]!)]!;
          const z1 = z[cellAt(g, d.path[n - 2]!, d.path[n - 1]!)]!;
          if (z1 <= z0) downhill++;
        }
      },
    });
    expect(seen).toBeGreaterThan(0);
    expect(downhill).toBe(seen);
    const t = s.model.time;
    for (const d of s.model.aux().debris) expect(d.t).toBeGreaterThanOrEqual(t - 600 - 60);
    for (const ig of s.model.takeDebrisIgnitions()) expect(s.model.field.driver[cellAt(g, ig.x, ig.y)]).toBe(SpreadDriver.Spotting);
  });
});
