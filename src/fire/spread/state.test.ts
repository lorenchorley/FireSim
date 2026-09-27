/**
 * State, bookkeeping and API of FireSpreadModel (spec §7.5, §7.12, §7.13, §12.4, §12.5; §14 cross-module vectors):
 * heat-release normalisation, the SpreadFactors product, ignition API, evaluateCell, determinism (V18) and the
 * checkpoint → restore → step bitwise round trip.
 */
import { describe, expect, it } from 'vitest';
import { cellAt } from '../../core/grid';
import { HEAT_YIELD_KJ_PER_KG } from '../../core/physics';
import { Rng } from '../../core/rng';
import { BurnState, DEFAULT_SIM_OPTIONS, FuelType, SpreadDriver } from '../../core/types';
import { FireSpreadModel } from './FireSpreadModel';
import { makeScenario, runScenario, syntheticTerrain, uniformFuel, type Scenario } from './testing';

const DEG = Math.PI / 180;

describe('heat release and burn state (spec §7.5)', () => {
  it('∫q dt over 10τ_f (q cut at 7τ_f) = HEAT_YIELD·w/10 within 0.1 %; Burning for 3τ_f then BurntOut', () => {
    const terrain = syntheticTerrain(600, 30, () => 500);
    const g = terrain.grid;
    const kc = cellAt(g, 15, 15);
    const fuel = uniformFuel(g, FuelType.NonFuel, (_x, _y, k) => (k === kc ? FuelType.DryForestShrubby : null));
    const s = makeScenario(terrain, fuel, { windKmh: 10, moisturePct: 8, droughtFactor: 10 });
    expect(s.model.igniteAt(15, 15, 0)).toBe(true);
    const tau = 45; // DryForestShrubby flameResidence
    let integral = 0;
    let power = 0;
    const dt = 5;
    for (let t = 0; t < 10 * tau; t += dt) {
      s.env.time = t;
      s.model.prepare(s.env);
      s.model.step(dt, s.env);
      integral += s.model.heatRelease()[kc]! * dt;
      power += s.model.firePowerW() * dt;
      const age = t + dt;
      expect(s.model.field.burnState[kc]).toBe(age < 3 * tau ? BurnState.Burning : BurnState.BurntOut);
    }
    const w = s.model.fuelConsumed(kc);
    expect(w).toBeGreaterThan(0);
    const expected = (HEAT_YIELD_KJ_PER_KG * w) / 10;
    expect(Math.abs(integral / expected - 1)).toBeLessThan(0.001);
    expect(Math.abs(power / (expected * 900 * 1000) - 1)).toBeLessThan(0.001);
    expect(s.model.heatRelease()[kc]).toBe(0);
    // No spread into non-fuel.
    let burnt = 0;
    for (let k = 0; k < s.model.field.arrivalTime.length; k++) if (s.model.field.arrivalTime[k]! < Infinity) burnt++;
    expect(burnt).toBe(1);
  });
});

describe('spread factors and attribution (spec §6.12, §7.12)', () => {
  it('base·wind·fuel·moisture·slope·direction·terrain = arrival ROS (< 1 %) on head, flank and back cells', () => {
    const terrain = syntheticTerrain(1600, 20, (_x, y) => 500 + Math.tan(20 * DEG) * y);
    const s = makeScenario(terrain, uniformFuel(terrain.grid, FuelType.DryForestShrubby), { windKmh: 20, windFromDeg: 225, moisturePct: 8, droughtFactor: 10 });
    s.model.ignite({ id: 'p', kind: 'point', points: [[-200, -300]], time: 0, origin: 'observed' });
    runScenario(s, 3600, { dtA: 12 });
    const f = s.model.field;
    let n = 0;
    let back = 0;
    let head = 0;
    for (let k = 0; k < f.arrivalTime.length; k++) {
      if (!(f.arrivalTime[k]! > 0 && f.arrivalTime[k]! < Infinity)) continue;
      const fx = s.model.factorsAt(k);
      const prod = fx.base * fx.wind * fx.fuel * fx.moisture * fx.slope * fx.direction! * fx.terrain;
      expect(Math.abs(prod / f.ros[k]! - 1)).toBeLessThan(0.01);
      n++;
      if (fx.direction! <= 0.3) back++;
      if (fx.direction! >= 0.95) head++;
    }
    expect(n).toBeGreaterThan(200);
    expect(back).toBeGreaterThan(10);
    expect(head).toBeGreaterThan(10);
  });

  it('evaluateCell reproduces the head arrival and is side-effect free', () => {
    const terrain = syntheticTerrain(1600, 20, () => 500);
    const s = makeScenario(terrain, uniformFuel(terrain.grid, FuelType.DryForestShrubby), { windKmh: 25, windFromDeg: 270, moisturePct: 8, droughtFactor: 10 });
    s.model.ignite({ id: 'p', kind: 'point', points: [[-600, 0]], time: 0, origin: 'observed' });
    runScenario(s, 2 * 3600, { dtA: 12 });
    const g = terrain.grid;
    const kHead = cellAt(g, 300, 0);
    const kAhead = cellAt(g, 700, 0);
    expect(s.model.field.arrivalTime[kHead]!).toBeLessThan(Infinity);
    const before = s.model.checkpoint();
    const ev = s.model.evaluateCell(kAhead, s.env);
    expect(ev.headDir).toBeCloseTo(90, 3);
    expect(ev.driver).toBe(SpreadDriver.Wind);
    expect(ev.ros).toBeGreaterThan(0);
    expect(Math.abs(ev.ros / s.model.field.ros[kHead]! - 1)).toBeLessThan(0.05);
    expect(ev.intensity).toBeGreaterThan(0);
    expect(ev.factors.direction).toBe(1);
    const after = s.model.checkpoint();
    expect(after.cells.arrays['pE']).toEqual(before.cells.arrays['pE']);
    expect(after.rng).toBe(before.rng);
  });
});

describe('ignition API (spec §7.2, §7.13)', () => {
  it('igniteAt: false on non-fuel, outside or burnt cells; seeded cells get driver Spotting', () => {
    const terrain = syntheticTerrain(900, 30, () => 500);
    const fuel = uniformFuel(terrain.grid, FuelType.DryForestShrubby, (x) => (x > 200 ? FuelType.Water : null));
    const s = makeScenario(terrain, fuel, { windKmh: 10, moisturePct: 8, droughtFactor: 10 });
    expect(s.model.igniteAt(300, 0, 10)).toBe(false);
    expect(s.model.igniteAt(5000, 0, 10)).toBe(false);
    expect(s.model.igniteAt(-15, -15, 10)).toBe(true);
    expect(s.model.igniteAt(-15, -15, 20)).toBe(false);
    s.env.time = 10;
    s.model.prepare(s.env);
    const k = cellAt(terrain.grid, -15, -15);
    expect(s.model.field.arrivalTime[k]).toBe(10);
    expect(s.model.field.driver[k]).toBe(SpreadDriver.Spotting);
    expect(s.model.field.burnState[k]).toBe(BurnState.Burning);
    expect(s.model.ageAt(k)).toBe(0);
    expect(s.model.frontCells().length).toBeGreaterThan(0);
  });

  it('line ignitions start with build b₀ = min(0.9, L/500 m); area ignitions burn their interior', () => {
    const terrain = syntheticTerrain(1500, 30, () => 500);
    const s = makeScenario(terrain, uniformFuel(terrain.grid, FuelType.DryForestShrubby), { windKmh: 10, moisturePct: 8, droughtFactor: 10 });
    s.model.ignite({ id: 'l', kind: 'line', points: [[-300, -400], [-50, -400]], time: 100, origin: 'backburn' });
    s.model.ignite({ id: 'a', kind: 'area', points: [[100, 100], [400, 100], [400, 400], [100, 400]], time: 100, origin: 'observed' });
    s.env.time = 100;
    s.model.prepare(s.env);
    const kl = cellAt(terrain.grid, -165, -405);
    expect(s.model.ageAt(kl)).toBeCloseTo((-60 * Math.log(1 - 0.5)) / 0.115, 6);
    const ka = cellAt(terrain.grid, 255, 255);
    expect(s.model.field.arrivalTime[ka]).toBe(100);
    expect(s.model.aux().leftDomain).toBe(false);
  });
});

/** A mountain scenario that exercises the RNG (VLS periods, breaks, debris) and all lists. */
function busyScenario(seed = 2): Scenario {
  const H = 250;
  const terrain = syntheticTerrain(1800, 30, (x) => 400 + Math.max(0, x < 0 ? H + x * Math.tan(20 * DEG) : H - x * Math.tan(30 * DEG)));
  const fuel = uniformFuel(terrain.grid, FuelType.DryForestShrubby);
  fuel.barkHazard.fill(3.5);
  const g = terrain.grid;
  const bw = new Float32Array(g.nx * g.ny);
  const ib = Math.round((-450 - g.x0) / g.cellSize);
  for (let j = 0; j < g.ny; j++) bw[j * g.nx + ib] = 3;
  fuel.breakWidth = bw;
  const s = makeScenario(terrain, fuel, { windKmh: 35, windFromDeg: 270, moisturePct: 6, droughtFactor: 10, mountainPhenomena: true, uRidge: 'crest' }, {}, undefined, seed);
  s.model.ignite({ id: 'l', kind: 'line', points: [[-700, -200], [-700, 200]], time: 0, origin: 'observed' });
  s.model.ignite({ id: 's', kind: 'point', points: [[-600, 400]], time: 0, origin: 'spot' });
  return s;
}

const fields = (s: Scenario) => {
  const f = s.model.field;
  const a = s.model.aux();
  return [f.arrivalTime, f.ros, f.intensity, f.flameHeight, f.spreadDir, f.driver, f.phase, f.burnState, a.vls, a.sep, a.attach, a.junction, a.heatFlux, a.frontDist, a.nc];
};

describe('determinism and checkpoints (spec §12.4, §12.5, V18)', () => {
  it('two runs with the same inputs and seed are bitwise identical', () => {
    const a = busyScenario();
    const b = busyScenario();
    runScenario(a, 2400, { dtA: 12 });
    runScenario(b, 2400, { dtA: 12 });
    const fa = fields(a);
    const fb = fields(b);
    for (let q = 0; q < fa.length; q++) expect(Buffer.from(fa[q]!.buffer).equals(Buffer.from(fb[q]!.buffer))).toBe(true);
    expect(a.model.checkpoint().rng).toBe(b.model.checkpoint().rng);
    expect(a.model.aux().debris.length).toBe(b.model.aux().debris.length);
  });

  it('restore then step is bitwise equal to an uninterrupted step (checkpoint is structured-clone safe)', () => {
    const a = busyScenario();
    runScenario(a, 1200, { dtA: 12 });
    const cp = structuredClone(a.model.checkpoint());
    runScenario(a, 1200, { dtA: 12 });
    // A fresh model with a different RNG seed, restored from the checkpoint.
    const b = busyScenario(99);
    b.model.restore(cp);
    runScenario(b, 1200, { dtA: 12 });
    const fa = fields(a);
    const fb = fields(b);
    for (let q = 0; q < fa.length; q++) expect(Buffer.from(fa[q]!.buffer).equals(Buffer.from(fb[q]!.buffer))).toBe(true);
    expect(b.model.time).toBe(a.model.time);
    expect(b.model.firePowerW()).toBe(a.model.firePowerW());
    expect(Array.from(b.model.frontCells())).toEqual(Array.from(a.model.frontCells()));
    expect(b.model.checkpoint().rng).toBe(a.model.checkpoint().rng);
  });

  it('checkpoints are compact (touched cells only for per-cell state)', () => {
    const a = busyScenario();
    runScenario(a, 600, { dtA: 12 });
    const cp = a.model.checkpoint();
    let bytes = 0;
    for (const v of Object.values(cp.cells.arrays)) bytes += v.byteLength;
    const n = a.terrain.grid.nx * a.terrain.grid.ny;
    const touched = cp.cells.touched.length;
    expect(touched).toBeLessThan(n);
    // ≈ 26 B per cell for the full-copy rasters + ≤ 260 B per touched cell (6 h Katoomba 200 × 200: < 9 MB).
    expect(bytes).toBeLessThan(n * 30 + touched * 260);
  });

  it('the CFL guard rejects a sub-step of 1.2 × maxStableDt() (spec §7.2, V16)', () => {
    const terrain = syntheticTerrain(1200, 20, () => 500);
    const s = makeScenario(terrain, uniformFuel(terrain.grid, FuelType.Heath), { windKmh: 30, moisturePct: 6, droughtFactor: 10 });
    s.model.ignite({ id: 'p', kind: 'point', points: [[0, 0]], time: 0, origin: 'observed' });
    runScenario(s, 600, { dtA: 12 });
    s.model.prepare(s.env);
    const b = s.model.maxStableDt();
    expect(Number.isFinite(b) && b > 0).toBe(true);
    expect(() => s.model.stepFixed(1.2 * b, s.env)).toThrow(RangeError);
    expect(() => s.model.stepFixed(b, s.env)).not.toThrow();
  });

  it('the kernel is reused while |ΔU10| ≤ 2 % and M, FA are unchanged (spec §7.1)', () => {
    const terrain = syntheticTerrain(900, 30, () => 500);
    const s = makeScenario(terrain, uniformFuel(terrain.grid, FuelType.DryForestShrubby), { windKmh: 20, windFromDeg: 270, moisturePct: 8, droughtFactor: 10 });
    s.model.ignite({ id: 'p', kind: 'point', points: [[0, 0]], time: 0, origin: 'observed' });
    s.model.refreshMoistureCache(s.env);
    s.model.prepare(s.env);
    const k = cellAt(terrain.grid, 45, 15);
    const kU = (): number => s.model.checkpoint().cells.arrays['kU']![s.model.checkpoint().cells.touched.indexOf(k)]!;
    const u0 = kU();
    expect(u0).toBeCloseTo(20, 4);
    for (let q = 0; q < s.env.windU.length; q++) s.env.windU[q]! *= 1.015;
    s.model.prepare(s.env);
    expect(kU()).toBe(u0); // reused
    for (let q = 0; q < s.env.windU.length; q++) s.env.windU[q]! *= 1.02;
    s.model.prepare(s.env);
    expect(kU()).not.toBe(u0); // recomputed
    s.env.moisture.fill(9); // not copied until refreshMoistureCache
    s.model.prepare(s.env);
    expect(s.model.checkpoint().cells.arrays['kM']![s.model.checkpoint().cells.touched.indexOf(k)]).toBe(8);
    s.model.refreshMoistureCache(s.env);
    s.model.prepare(s.env);
    expect(s.model.checkpoint().cells.arrays['kM']![s.model.checkpoint().cells.touched.indexOf(k)]).toBe(9);
  });

  it('the constructor rejects a fuel grid that differs from the terrain grid', () => {
    const t = syntheticTerrain(600, 30, () => 500);
    const t2 = syntheticTerrain(900, 30, () => 500);
    const s = makeScenario(t, uniformFuel(t.grid, FuelType.Heath));
    expect(() => new FireSpreadModel(t, uniformFuel(t2.grid, FuelType.Heath), s.features, DEFAULT_SIM_OPTIONS, new Rng(1))).toThrow();
  });
});
