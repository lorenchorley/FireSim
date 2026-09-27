/**
 * Additional physical validation of FireSpreadModel (review additions; spec §7.3–§7.5, §7.8, §7.11, §15 V5/V12/V16):
 * a wind change turns the former flank into the head (V12 core), grid-orientation invariance of the level set,
 * whole-fire heat conservation (§7.5 ∫q dt = H·w), the domain edge (§7.2 ghost cells, leftDomain), a wind-driven
 * run downslope under the Kataburn bound (§7.3, D3), the forest 15 km/h head cap vs grass (§7.4, D4, global 6 m/s cap),
 * rolling debris never rolling uphill (§7.11), and that constructor parameter overrides reach every formula (§0.1).
 */
import { describe, expect, it } from 'vitest';
import { cellAt, type GridSpec } from '../../core/grid';
import { HEAT_YIELD_KJ_PER_KG } from '../../core/physics';
import { FuelType, SpreadDriver } from '../../core/types';
import { windToUV } from '../../core/units';
import { fuelParamsAt } from '../../fuel/fuelMap';
import { createHeadKernelOut, headRosKernel, slopeFactor } from '../models';
import { makeScenario, runScenario, syntheticTerrain, uniformFuel, type Scenario } from './testing';

const DEG = Math.PI / 180;
const flat = () => 500;
const point = (x: number, y: number, time = 0) => ({ id: 'p', kind: 'point' as const, points: [[x, y]] as [number, number][], time, origin: 'observed' as const });

/** Largest projection of the burnt cells (tArr ≤ T) on the unit vector (ux, uy) about (x0, y0). */
function extent(s: Scenario, T: number, x0: number, y0: number, ux: number, uy: number): number {
  const g: GridSpec = s.terrain.grid;
  const tA = s.model.field.arrivalTime;
  let d = -Infinity;
  for (let j = 0; j < g.ny; j++) {
    for (let i = 0; i < g.nx; i++) {
      if (!(tA[j * g.nx + i]! <= T)) continue;
      const p = (g.x0 + i * g.cellSize - x0) * ux + (g.y0 + j * g.cellSize - y0) * uy;
      if (p > d) d = p;
    }
  }
  return d;
}

const burntCells = (s: Scenario, T = Infinity): number => {
  let c = 0;
  for (const t of s.model.field.arrivalTime) if (t <= T) c++;
  return c;
};

function kernelRw(s: Scenario, k: number, uKmh: number, m: number): { rw: number; r0: number } {
  const K = createHeadKernelOut();
  headRosKernel(fuelParamsAt(s.fuel, k), uKmh, m, s.env.availability[k]!, K, s.env.droughtFactor);
  return { rw: K.rw, r0: K.r0 };
}

function setWind(s: Scenario, kmh: number, fromDeg: number): void {
  const [u, v] = windToUV(kmh / 3.6, fromDeg);
  s.env.windU.fill(u);
  s.env.windV.fill(v);
  s.env.windBgU.fill(u);
  s.env.windBgV.fill(v);
  s.env.weather.windSpeed10 = kmh / 3.6;
  s.env.weather.windDir10 = fromDeg;
}

describe('wind change (spec §15 V12 core): the former flank becomes the head', () => {
  it('a 90° wind shift after 1 h: the north flank runs at the flat head rate R_w within 30 min', () => {
    const terrain = syntheticTerrain(3000, 30, flat);
    const s = makeScenario(terrain, uniformFuel(terrain.grid, FuelType.DryForestShrubby), { windKmh: 20, windFromDeg: 270, moisturePct: 8, droughtFactor: 10 });
    s.model.ignite(point(-900, -600));
    runScenario(s, 3600, { dtA: 12 });
    const { rw } = kernelRw(s, 0, 20, 8);
    // Before the change the north flank is slow (≈ R_F); after it the northward extent advances at ≈ R_w.
    const n0 = extent(s, 3600, -900, -600, 0, 1);
    setWind(s, 20, 180);
    runScenario(s, 1200, { dtA: 12 });
    const n1 = extent(s, 4800, -900, -600, 0, 1);
    runScenario(s, 1800, { dtA: 12 });
    const n2 = extent(s, 6600, -900, -600, 0, 1);
    expect(n1).toBeGreaterThan(n0 + 0.5 * rw * (1200 / 3600));
    const rate = ((n2 - n1) / 1800) * 3600;
    expect(Math.abs(rate / rw - 1)).toBeLessThan(0.1);
    // The new head is attributed to the wind.
    expect(s.model.field.driver[cellAt(terrain.grid, -900, n2 - 600 - 60)]).toBe(SpreadDriver.Wind);
  });
});

describe('level-set grid orientation (spec §7.2, V16)', () => {
  it('head extent and burnt area for a wind along the grid axis and along the diagonal agree within 5 %', () => {
    const run = (from: number) => {
      const terrain = syntheticTerrain(2400, 30, flat);
      const s = makeScenario(terrain, uniformFuel(terrain.grid, FuelType.DryForestShrubby), { windKmh: 25, windFromDeg: from, moisturePct: 8, droughtFactor: 10 });
      const to = (from + 180) * DEG;
      const ux = Math.sin(to);
      const uy = Math.cos(to);
      s.model.ignite(point(-700 * ux, -700 * uy));
      runScenario(s, 5400, { dtA: 12 });
      return { head: extent(s, 5400, -700 * ux, -700 * uy, ux, uy), area: burntCells(s, 5400) };
    };
    const axis = run(270);
    const diag = run(225);
    expect(Math.abs(diag.head / axis.head - 1)).toBeLessThan(0.05);
    expect(Math.abs(diag.area / axis.area - 1)).toBeLessThan(0.05);
  });
});

describe('heat release of a whole fire (spec §7.5, D27)', () => {
  it('Σ heatRelease·Δt_a·Δx² = Σ H·w_c/10·Δx² once the fire is out (closed fuel patch)', () => {
    const terrain = syntheticTerrain(900, 30, flat);
    const fuel = uniformFuel(terrain.grid, FuelType.DryForestShrubby, (x, y) => (Math.hypot(x, y) > 200 ? FuelType.NonFuel : null));
    const s = makeScenario(terrain, fuel, { windKmh: 15, windFromDeg: 270, moisturePct: 7, droughtFactor: 10 });
    s.model.ignite(point(-100, 0));
    let released = 0;
    const dtA = 12;
    runScenario(s, 3 * 3600, {
      dtA,
      onStep: () => {
        const h = s.model.heatRelease();
        let q = 0;
        for (let k = 0; k < h.length; k++) q += h[k]!;
        released += q * dtA;
      },
    });
    const n = s.model.field.arrivalTime.length;
    let expected = 0;
    for (let k = 0; k < n; k++) if (s.model.field.arrivalTime[k]! < Infinity) expected += (HEAT_YIELD_KJ_PER_KG * s.model.fuelConsumed(k)) / 10;
    expect(burntCells(s)).toBeGreaterThan(100);
    expect(Math.abs(released / expected - 1)).toBeLessThan(0.002);
    expect(s.model.firePowerW()).toBe(0);
    expect(s.model.frontCells().length).toBe(0);
  });
});

describe('domain edge (spec §7.2 ghost cells)', () => {
  it('a grass fire running off the domain sets leftDomain; all fields stay finite; the band keeps working', () => {
    const terrain = syntheticTerrain(900, 30, flat);
    const s = makeScenario(terrain, uniformFuel(terrain.grid, FuelType.Grassland), { windKmh: 30, windFromDeg: 270, moisturePct: 5, droughtFactor: 10 });
    s.model.ignite(point(0, 0));
    runScenario(s, 3600, { dtA: 12 });
    const f = s.model.field;
    const g = terrain.grid;
    expect(s.model.aux().leftDomain).toBe(true);
    // The east edge column burnt; nothing is NaN.
    let edge = 0;
    for (let j = 0; j < g.ny; j++) if (f.arrivalTime[j * g.nx + g.nx - 1]! < Infinity) edge++;
    expect(edge).toBeGreaterThan(3);
    for (let k = 0; k < f.arrivalTime.length; k++) {
      expect(Number.isNaN(f.arrivalTime[k]!)).toBe(false);
      expect(Number.isFinite(f.ros[k]!)).toBe(true);
      expect(Number.isFinite(f.intensity[k]!)).toBe(true);
    }
    expect(Number.isFinite(s.model.maxStableDt()) || s.model.maxStableDt() === Infinity).toBe(true);
  });
});

describe('downslope wind (spec §7.3 Kataburn bound, D3)', () => {
  it('20 km/h blowing down a 20° slope: the head runs downhill at ≤ R_w·SF(−20°) (not the additive flat-like rate)', () => {
    const terrain = syntheticTerrain(2400, 20, (_x, y) => 500 + Math.tan(20 * DEG) * y);
    const s = makeScenario(terrain, uniformFuel(terrain.grid, FuelType.DryForestShrubby), { windKmh: 20, windFromDeg: 0, moisturePct: 8, droughtFactor: 10 });
    s.model.ignite({ id: 'l', kind: 'line', points: [[-500, 700], [500, 700]], time: 0, origin: 'observed' });
    runScenario(s, 2 * 3600, { dtA: 12 });
    const k = cellAt(terrain.grid, 0, 0);
    const { rw, r0 } = kernelRw(s, k, 20, 8);
    expect(rw - r0).toBeGreaterThan(3 * r0); // the wind wins: e points downslope
    const tA = s.model.field.arrivalTime;
    const t1 = tA[cellAt(terrain.grid, 0, 400)]!;
    const t2 = tA[cellAt(terrain.grid, 0, 100)]!;
    const ros = (300 / (t2 - t1)) * 3600;
    const bound = rw * slopeFactor(-20);
    expect(ros).toBeLessThanOrEqual(bound * 1.03);
    expect(ros).toBeGreaterThan(0.85 * bound);
  });
});

describe('head caps (spec §7.4 D4, §7.2 global 6 m/s)', () => {
  it('forest head ≤ 15 km/h (validated = false); grass is exempt from the forest cap but ≤ 6 m/s', () => {
    const plane = (_x: number, y: number) => 500 + Math.tan(30 * DEG) * y;
    const run = (type: FuelType) => {
      const terrain = syntheticTerrain(3000, 30, plane);
      const s = makeScenario(terrain, uniformFuel(terrain.grid, type), { windKmh: 60, windFromDeg: 180, moisturePct: 4, droughtFactor: 10 });
      s.model.ignite({ id: 'l', kind: 'line', points: [[-600, -1300], [600, -1300]], time: 0, origin: 'observed' });
      runScenario(s, 900, { dtA: 12 });
      return s;
    };
    const forest = run(FuelType.DryForestShrubby);
    const f = forest.model.field;
    let maxRos = 0;
    let capped = 0;
    for (let k = 0; k < f.ros.length; k++) {
      if (!(f.arrivalTime[k]! > 0 && f.arrivalTime[k]! < Infinity)) continue;
      maxRos = Math.max(maxRos, f.ros[k]!);
      if (!forest.model.validatedAt(k)) capped++;
    }
    expect(maxRos * 3.6).toBeLessThanOrEqual(15 * 1.0001);
    expect(maxRos * 3.6).toBeGreaterThan(14);
    expect(capped).toBeGreaterThan(0);
    const grass = run(FuelType.Grassland);
    let gMax = 0;
    for (let k = 0; k < grass.model.field.ros.length; k++) if (grass.model.field.arrivalTime[k]! > 0) gMax = Math.max(gMax, grass.model.field.ros[k]!);
    expect(gMax * 3.6).toBeGreaterThan(15);
    expect(gMax).toBeLessThanOrEqual(6 + 1e-6);
  });
});

describe('rolling debris path (spec §7.11)', () => {
  it('every step of every trajectory goes strictly downhill on the fire-grid DEM (stops in pits)', () => {
    // A one-cell trench across a 35° slope: the filled surface drains it along its (flat) floor to the domain edges,
    // but debris that rolls into it must stop there (its central-difference slope is still 35°).
    const trench = (_x: number, y: number) => 600 + Math.tan(35 * DEG) * Math.max(-300, y) + (Math.abs(y - 50) < 5 ? -20 : 0);
    const terrain = syntheticTerrain(1200, 20, trench);
    const fuel = uniformFuel(terrain.grid, FuelType.DryForestShrubby);
    fuel.barkHazard.fill(3.5);
    const s = makeScenario(terrain, fuel, { windKmh: 10, windFromDeg: 180, moisturePct: 5, droughtFactor: 10, mountainPhenomena: true });
    s.model.ignite({ id: 'l', kind: 'line', points: [[-300, 100], [300, 100]], time: 0, origin: 'observed' });
    const z = terrain.elevation;
    const g = terrain.grid;
    let seen = 0;
    let uphill = 0;
    let stoppedInTrench = 0;
    runScenario(s, 3600, {
      dtA: 12,
      onStep: () => {
        for (const d of s.model.aux().debris) {
          seen++;
          if (Math.abs(d.path[d.path.length - 1]! - 50) < 5) stoppedInTrench++;
          for (let q = 2; q < d.path.length; q += 2) {
            if (z[cellAt(g, d.path[q]!, d.path[q + 1]!)]! >= z[cellAt(g, d.path[q - 2]!, d.path[q - 1]!)]!) uphill++;
          }
        }
      },
    });
    expect(seen).toBeGreaterThan(0);
    expect(stoppedInTrench).toBeGreaterThan(0);
    expect(uphill).toBe(0);
  });
});

describe('parameter overrides (spec §0.1: every [H] value tunable in SPREAD_PARAMS)', () => {
  it('constructor overrides reach the math functions (build floor, attribution thresholds)', () => {
    const terrain = syntheticTerrain(900, 30, (_x, y) => 500 + Math.tan(20 * DEG) * y);
    const fuel = uniformFuel(terrain.grid, FuelType.DryForestShrubby);
    const base = makeScenario(terrain, fuel, { windKmh: 0, moisturePct: 8, droughtFactor: 10 });
    const tuned = makeScenario(terrain, fuel, { windKmh: 0, moisturePct: 8, droughtFactor: 10 }, {}, { build: { minBuild: 0.5 }, attribution: { backingDirection: 0 } });
    const k = cellAt(terrain.grid, 0, 0);
    for (const s of [base, tuned]) {
      s.model.ignite(point(0, 0));
      s.model.prepare(s.env);
    }
    // At the ignition time the build-up is at its floor: 0.1 by default, 0.5 with the override.
    expect(base.model.evaluateCell(k, base.env).factors.build).toBeCloseTo(0.1, 9);
    expect(tuned.model.evaluateCell(k, tuned.env).factors.build).toBeCloseTo(0.5, 9);
    for (const s of [base, tuned]) runScenario(s, 4 * 3600, { dtA: 300 });
    const count = (s: Scenario, d: SpreadDriver) => {
      let c = 0;
      for (const v of s.model.field.driver) if (v === d) c++;
      return c;
    };
    expect(count(base, SpreadDriver.Backing)).toBeGreaterThan(0);
    expect(count(tuned, SpreadDriver.Backing)).toBe(0);
  });
});

describe('clock (spec §12.2 order)', () => {
  it('minuteTasks called with the step-start env.time (before t += Δt_a) does not rewind the model clock', () => {
    const terrain = syntheticTerrain(900, 30, flat);
    const s = makeScenario(terrain, uniformFuel(terrain.grid, FuelType.DryForestShrubby), { windKmh: 15, moisturePct: 8, droughtFactor: 10 });
    s.model.ignite(point(0, 0));
    s.model.refreshMoistureCache(s.env);
    for (let t = 0; t < 600; t += 12) {
      s.env.time = t;
      if (t % 60 === 0) s.model.refreshMasks(s.env);
      s.model.prepare(s.env);
      s.model.step(12, s.env);
      if ((t + 12) % 60 === 0) s.model.minuteTasks(s.env); // env.time is still t here (§12.2 step 9 precedes step 10)
      expect(s.model.time).toBe(t + 12);
    }
    const k = cellAt(terrain.grid, 0, 0);
    expect(s.model.ageAt(k)).toBe(600);
  });
});

describe('evaluateCell before any ignition (spec §7.12, explain explainAt)', () => {
  it('describes a developed fire (build 1): head ROS = R_w on flat ground', () => {
    const terrain = syntheticTerrain(900, 30, flat);
    const s = makeScenario(terrain, uniformFuel(terrain.grid, FuelType.DryForestShrubby), { windKmh: 20, windFromDeg: 270, moisturePct: 8, droughtFactor: 10 });
    const k = cellAt(terrain.grid, 0, 0);
    const ev = s.model.evaluateCell(k, s.env);
    const { rw } = kernelRw(s, k, 20, 8);
    expect(ev.factors.build).toBe(1);
    expect(Math.abs((ev.ros * 3600) / rw - 1)).toBeLessThan(1e-4);
    expect(ev.headDir).toBeCloseTo(90, 6);
    expect(ev.driver).toBe(SpreadDriver.Wind);
  });
});

describe('stalled front resumes (spec §7.2 reinitialisation, fuel edits)', () => {
  it('after 3 h against a non-fuel strip that is then edited to forest, the front resumes at its steady rate', () => {
    const terrain = syntheticTerrain(1800, 30, flat);
    const g = terrain.grid;
    const fuel = uniformFuel(g, FuelType.DryForestShrubby, (x) => (x >= 0 && x < 60 ? FuelType.NonFuel : null));
    const s = makeScenario(terrain, fuel, { windKmh: 20, windFromDeg: 270, moisturePct: 8, droughtFactor: 10 });
    s.model.ignite({ id: 'l', kind: 'line', points: [[-600, -400], [-600, 400]], time: 0, origin: 'observed' });
    runScenario(s, 3 * 3600, { dtA: 12 });
    const kStrip = cellAt(g, 0, 0);
    expect(s.model.field.arrivalTime[kStrip]).toBe(Infinity);
    const cells: number[] = [];
    for (let k = 0; k < g.nx * g.ny; k++) {
      const x = g.x0 + (k % g.nx) * g.cellSize;
      if (x >= 0 && x < 60) {
        cells.push(k);
        fuel.type[k] = FuelType.DryForestShrubby;
      }
    }
    s.model.refreshFuel(cells);
    const t0 = s.model.time;
    runScenario(s, 3600, { dtA: 12 });
    const { rw } = kernelRw(s, kStrip, 20, 8);
    const perCell = (30 / rw) * 3600;
    const tA = (x: number) => s.model.field.arrivalTime[cellAt(g, x, 0)]! - t0;
    // The first cell is not crossed in a flash (the burnt side did not keep deepening during the stall) …
    expect(tA(0)).toBeGreaterThan(0.25 * perCell);
    // … and a few cells on the front runs at the steady head rate.
    for (const x of [90, 120, 150]) expect(Math.abs((tA(x) - tA(x - 30)) / perCell - 1)).toBeLessThan(0.1);
  });
});
