/**
 * FireSpreadModel validation on synthetic terrain (spec §7.13, §15 V1–V4): circle in calm flat fuel, wind ellipse
 * LB, upslope 2^(θ/10) and Kataburn backing on calm planes, wind aligned with slope, cross-slope wind, stopping at
 * non-fuel, fire-break draws, ridge-crest slowing. Mountain phenomena are in mountain.test.ts; heat, factors, the
 * ignition API, determinism and checkpoints in state.test.ts; the §13 budget in perf.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { cellAt, type GridSpec } from '../../core/grid';
import { BurnState, FuelType, SpreadDriver, type FuelMap } from '../../core/types';
import { headRosKernel, createHeadKernelOut, lbForest } from '../models';
import { fuelParamsAt } from '../../fuel/fuelMap';
import { makeScenario, runScenario, syntheticTerrain, uniformFuel, type Scenario } from './testing';

const DEG = Math.PI / 180;

/** Bilinear arrival time (s) at a local point (Infinity if any corner is unburnt). */
function tArrAt(g: GridSpec, t: Float32Array, x: number, y: number): number {
  const fx = (x - g.x0) / g.cellSize;
  const fy = (y - g.y0) / g.cellSize;
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  const tx = fx - i;
  const ty = fy - j;
  const k = j * g.nx + i;
  const a = t[k]!;
  const b = t[k + 1]!;
  const c = t[k + g.nx]!;
  const d = t[k + g.nx + 1]!;
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/** ROS (m/h) from the arrival-time gradient between distances s0 and s1 from (x0, y0) along azimuth az. */
function rosBetween(s: Scenario, x0: number, y0: number, az: number, s0: number, s1: number): number {
  const g = s.terrain.grid;
  const ux = Math.sin(az * DEG);
  const uy = Math.cos(az * DEG);
  const t0 = tArrAt(g, s.model.field.arrivalTime, x0 + s0 * ux, y0 + s0 * uy);
  const t1 = tArrAt(g, s.model.field.arrivalTime, x0 + s1 * ux, y0 + s1 * uy);
  return ((s1 - s0) / (t1 - t0)) * 3600;
}

/** Plane rising toward the north at θ (deg). */
const plane = (thetaDeg: number) => (_x: number, y: number) => 500 + Math.tan(thetaDeg * DEG) * y;
const flat = () => 500;

const point = (x: number, y: number, time = 0) => ({ id: 'p', kind: 'point' as const, points: [[x, y]] as [number, number][], time, origin: 'observed' as const });

describe('calm planes (spec §7.13, V1): upslope 2^(θ/10), Kataburn backing', () => {
  // Calm, DryForestShrubby, M 8 %, DF 10, Δx 10 m. R0 = 30·φM(8)·FA(10) = 20.7 m/h.
  const flatRun = (() => {
    let s: Scenario | null = null;
    return (): Scenario => {
      if (s) return s;
      const terrain = syntheticTerrain(800, 10, flat);
      s = makeScenario(terrain, uniformFuel(terrain.grid, FuelType.DryForestShrubby), { windKmh: 0, moisturePct: 8, droughtFactor: 10 });
      s.model.ignite(point(0, 0));
      runScenario(s, 17 * 3600, { dtA: 300 });
      return s;
    };
  })();

  it('flat calm: R = R0 = 20.7 m/h and the burnt area stays circular', () => {
    const s = flatRun();
    const r = [0, 45, 90, 135, 180, 225, 270, 315].map((az) => rosBetween(s, 0, 0, az, 100, 300));
    for (const v of r) expect(Math.abs(v / 20.7 - 1)).toBeLessThan(0.03);
    // Radius at the latest common arrival: within 2 % in 16 directions.
    const g = s.terrain.grid;
    const T = 14 * 3600;
    const radii: number[] = [];
    for (let q = 0; q < 16; q++) {
      const az = q * 22.5;
      let lo = 0;
      let hi = 380;
      for (let it = 0; it < 40; it++) {
        const mid = 0.5 * (lo + hi);
        if (tArrAt(g, s.model.field.arrivalTime, mid * Math.sin(az * DEG), mid * Math.cos(az * DEG)) <= T) lo = mid;
        else hi = mid;
      }
      radii.push(lo);
    }
    const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
    for (const r0 of radii) expect(Math.abs(r0 / mean - 1)).toBeLessThan(0.02);
  });

  for (const [theta, up, down] of [
    [30, 8.0, 0.533],
    [20, 4.0, 0.571],
  ] as const) {
    it(`${theta}° plane: head/flat = ${up} ± 5 %, back/flat = ${down} ± 5 % (100–300 m up, 20–60 m down)`, () => {
      const terrain = syntheticTerrain(800, 10, plane(theta));
      // The attachment amplifier (§7.6, P1) is off here: this is the §7.13 level-set test of the slope factor.
      const s = makeScenario(terrain, uniformFuel(terrain.grid, FuelType.DryForestShrubby), { windKmh: 0, moisturePct: 8, droughtFactor: 10 });
      s.model.ignite(point(0, -250));
      runScenario(s, 9 * 3600, { dtA: 300 });
      const flatR = rosBetween(flatRun(), 0, 0, 0, 100, 300);
      const upR = rosBetween(s, 0, -250, 0, 100, 300);
      const downR = rosBetween(s, 0, -250, 180, 20, 60);
      expect(Math.abs(upR / flatR / up - 1)).toBeLessThan(0.05);
      expect(Math.abs(downR / flatR / down - 1)).toBeLessThan(0.05);
      expect(downR / flatR).toBeGreaterThanOrEqual(0.5 * 0.95);
      // The head is attributed to slope.
      const kHead = cellAt(terrain.grid, 0, -50);
      expect(s.model.field.driver[kHead]).toBe(SpreadDriver.Slope);
      const kBack = cellAt(terrain.grid, 0, -290);
      expect(s.model.field.driver[kBack]).toBe(SpreadDriver.Backing);
    });
  }

  it('mountainPhenomena on, 20° plane: the attachment amplifier stays small (G ≤ 1.03) and head/flat ≈ 4', () => {
    const terrain = syntheticTerrain(800, 10, plane(20));
    const s = makeScenario(terrain, uniformFuel(terrain.grid, FuelType.DryForestShrubby), { windKmh: 0, moisturePct: 8, droughtFactor: 10, mountainPhenomena: true });
    s.model.ignite(point(0, -250));
    runScenario(s, 4 * 3600, { dtA: 300 });
    const upR = rosBetween(s, 0, -250, 0, 100, 300);
    const flatR = rosBetween(flatRun(), 0, 0, 0, 100, 300);
    expect(upR / flatR).toBeGreaterThan(3.8);
    expect(upR / flatR).toBeLessThan(4.2 * 1.03);
  });
});

describe('wind on flat ground (spec §6.8, §7.4): ellipse LB matches the model', () => {
  it('U10 20 km/h: burnt shape LB ≈ LB(20) = 2.55, head rate ≈ R_w', () => {
    const terrain = syntheticTerrain(1600, 10, flat);
    const fuel = uniformFuel(terrain.grid, FuelType.DryForestShrubby);
    const s = makeScenario(terrain, fuel, { windKmh: 20, windFromDeg: 270, moisturePct: 8, droughtFactor: 10 });
    s.model.ignite(point(-600, 0));
    runScenario(s, 3600 * 2.2, { dtA: 30 });
    const f = s.model.field;
    const g = terrain.grid;
    const K = createHeadKernelOut();
    const p = fuelParamsAt(fuel, 0);
    headRosKernel(p, 20, 8, s.env.availability[0]!, K, 10);
    // Head rate between 400 and 700 m downwind (build ≈ 1 there).
    const head = rosBetween(s, -600, 0, 90, 400, 700);
    expect(Math.abs(head / K.rw - 1)).toBeLessThan(0.05);
    // Shape at a fixed time: length along x through the ignition row, breadth = max N–S extent.
    const T = 2 * 3600;
    let xmin = Infinity;
    let xmax = -Infinity;
    let ymin = Infinity;
    let ymax = -Infinity;
    for (let j = 0; j < g.ny; j++) {
      for (let i = 0; i < g.nx; i++) {
        if (!(f.arrivalTime[j * g.nx + i]! <= T)) continue;
        const x = g.x0 + i * g.cellSize;
        const y = g.y0 + j * g.cellSize;
        xmin = Math.min(xmin, x);
        xmax = Math.max(xmax, x);
        ymin = Math.min(ymin, y);
        ymax = Math.max(ymax, y);
      }
    }
    const lb = (xmax - xmin) / (ymax - ymin);
    expect(Math.abs(lb / lbForest(20) - 1)).toBeLessThan(0.1);
  });
});

describe('wind and slope (spec §15 V2, V3)', () => {
  it('V2: 10° slope with U10 30 km/h upslope, 1 km line ignition: head = flat × 2.0 ± 5 %', () => {
    const run = (theta: number): number => {
      const terrain = syntheticTerrain(2400, 20, plane(theta));
      const s = makeScenario(terrain, uniformFuel(terrain.grid, FuelType.DryForestShrubby), { windKmh: 30, windFromDeg: 180, moisturePct: 8, droughtFactor: 10 });
      s.model.ignite({ id: 'l', kind: 'line', points: [[-500, -900], [500, -900]], time: 0, origin: 'observed' });
      runScenario(s, 3600, { dtA: 12 });
      return rosBetween(s, 0, -900, 0, 200, 600);
    };
    const ratio = run(10) / run(0);
    expect(Math.abs(ratio / 2 - 1)).toBeLessThan(0.05);
  });

  it('V3: cross-slope wind: head direction between wind-to and upslope, ROS ≤ flat wind ROS × 1.2', () => {
    const terrain = syntheticTerrain(2000, 20, plane(20));
    const fuel = uniformFuel(terrain.grid, FuelType.DryForestShrubby);
    const s = makeScenario(terrain, fuel, { windKmh: 30, windFromDeg: 270, moisturePct: 8, droughtFactor: 10 });
    const k = cellAt(terrain.grid, 0, 0);
    s.model.prepare(s.env);
    const ev = s.model.evaluateCell(k, s.env);
    expect(ev.headDir).toBeGreaterThan(0);
    expect(ev.headDir).toBeLessThan(90);
    const K = createHeadKernelOut();
    headRosKernel(fuelParamsAt(fuel, k), 30, 8, s.env.availability[k]!, K, 10);
    expect(ev.rH * 3600).toBeLessThanOrEqual(1.2 * K.rw);
    // Vector sum: s⃗ = (SF(20) − 1)R0 north, w⃗ = (R_w − R0) east.
    const e = Math.atan2(K.rw - K.r0, 3 * K.r0) / DEG;
    expect(Math.abs(ev.headDir - e)).toBeLessThan(5);
  });
});

describe('barriers (spec §7.4, §7.5)', () => {
  const strip = (x0: number, x1: number) => (x: number) => (x >= x0 && x <= x1 ? FuelType.NonFuel : null);

  for (const width of [30, 60]) {
    it(`the fire stops at a ${width} m non-fuel strip (wind 25 km/h across it)`, () => {
      const terrain = syntheticTerrain(1800, 30, flat);
      const fuel = uniformFuel(terrain.grid, FuelType.DryForestShrubby, strip(-15, -15 + width - 1));
      const s = makeScenario(terrain, fuel, { windKmh: 25, windFromDeg: 270, moisturePct: 7, droughtFactor: 10 });
      s.model.ignite({ id: 'l', kind: 'line', points: [[-600, -300], [-600, 300]], time: 0, origin: 'observed' });
      runScenario(s, 3 * 3600, { dtA: 12 });
      const g = terrain.grid;
      const f = s.model.field;
      let beyond = 0;
      let before = 0;
      for (let j = 0; j < g.ny; j++) {
        for (let i = 0; i < g.nx; i++) {
          const x = g.x0 + i * g.cellSize;
          const k = j * g.nx + i;
          if (x > -15 + width && f.arrivalTime[k]! < Infinity) beyond++;
          if (x < -45 && x > -300 && Math.abs(g.y0 + j * g.cellSize) < 200 && f.arrivalTime[k]! < Infinity) before++;
          if (x >= -15 && x < -15 + width) expect(f.burnState[k]).toBe(BurnState.NonFlammable);
        }
      }
      expect(before).toBeGreaterThan(50);
      expect(beyond).toBe(0);
    });
  }

  it('a sub-cell break (breakWidth) is drawn once with the Wilson probability and reported', () => {
    const terrain = syntheticTerrain(1200, 30, flat);
    const fuel = uniformFuel(terrain.grid, FuelType.DryForestShrubby);
    const bw = new Float32Array(terrain.grid.nx * terrain.grid.ny);
    const g = terrain.grid;
    const iBreak = Math.round(-g.x0 / g.cellSize);
    for (let j = 0; j < g.ny; j++) bw[j * g.nx + iBreak] = 4;
    (fuel as FuelMap).breakWidth = bw;
    const s = makeScenario(terrain, fuel, { windKmh: 20, windFromDeg: 270, moisturePct: 8, droughtFactor: 10 });
    s.model.ignite({ id: 'l', kind: 'line', points: [[-300, -200], [-300, 200]], time: 0, origin: 'observed' });
    const events: ReturnType<typeof s.model.takeBreachEvents> = [];
    runScenario(s, 3600, { dtA: 12, onStep: () => void events.push(...s.model.takeBreachEvents()) });
    expect(events.length).toBeGreaterThan(5);
    const cells = new Set(events.map((e) => e.cell));
    for (const e of events) {
      expect(e.probability).toBeGreaterThan(0);
      expect(e.probability).toBeLessThan(1);
      expect(e.cell % g.nx).toBe(iBreak);
    }
    // Breached cells are drawn once; held cells re-draw only after 30 min.
    expect(cells.size).toBeGreaterThan(0.5 * events.length);
  });
});

describe('ridge crest (spec §15 V4)', () => {
  it('symmetric 25° ridge, U10 20 km/h across: ROS drops ≥ 60 % within 2 cells after the crest; drivers change', () => {
    const H = 300;
    const L = H / Math.tan(25 * DEG);
    const terrain = syntheticTerrain(2400, 20, (x) => 400 + Math.max(0, H - Math.abs(x) * Math.tan(25 * DEG)));
    const s = makeScenario(terrain, uniformFuel(terrain.grid, FuelType.DryForestShrubby), { windKmh: 20, windFromDeg: 270, moisturePct: 8, droughtFactor: 10 });
    s.model.ignite({ id: 'l', kind: 'line', points: [[-L, -400], [-L, 400]], time: 0, origin: 'observed' });
    runScenario(s, 3 * 3600, { dtA: 12 });
    const before = rosBetween(s, 0, 0, 270, 100, 40); // windward, approaching the crest (measured toward the crest)
    const after = rosBetween(s, 0, 0, 90, 10, 50); // lee, within 2 cells after the crest
    expect(Math.abs(before)).toBeGreaterThan(0);
    expect(after / Math.abs(before)).toBeLessThan(0.4);
    const f = s.model.field;
    const kW = cellAt(terrain.grid, -200, 0);
    const kL = cellAt(terrain.grid, 200, 0);
    expect([SpreadDriver.Slope, SpreadDriver.WindAndSlope]).toContain(f.driver[kW]);
    expect([SpreadDriver.Backing, SpreadDriver.Wind]).toContain(f.driver[kL]);
  });
});
