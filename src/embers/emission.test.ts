/**
 * Emission (spec §9.2, D52; §9.7 tests "emission per km of front equal (±5 %) for a grid-aligned and a 45° front",
 * "BH 2 → 3 triples landing density", the 324 brands km⁻¹ h⁻¹ reference; class split; VLS injection; §9.7 plume top).
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { FuelFlag, FuelType, type FireField, type FuelMap } from '../core/types';
import type { GridSpec } from '../core/grid';
import { EmberModel, type EmberModelOptions } from './EmberModel';
import type { EmberCellFuel } from './fuelInfo';
import { CLS_FLAKE, CLS_HEAVY, CLS_LEAF, CLS_RIBBON, CLS_TWIG } from './params';
import {
  burningAt,
  constTurb,
  emptyAux,
  flatTerrain,
  grid,
  noTurb,
  planarFire,
  planarLanding,
  uniformFuel,
  uniformWind,
  type PlanarFront,
} from './testing';

const Q_REF = 9e-5; // brands m⁻¹ s⁻¹ at 10 MW/m, BH 3, e = g = 1

/** Fuel: DryForestShrubby inside a circle of radius r, grassland (spotting = false) outside. */
function circleFuel(g: GridSpec, r: number, bh = 3, flags = FuelFlag.Stringybark): FuelMap {
  const f = uniformFuel(g, { barkHazard: bh, flags });
  for (let j = 0; j < g.ny; j++)
    for (let i = 0; i < g.nx; i++) {
      const x = g.x0 + i * g.cellSize;
      const y = g.y0 + j * g.cellSize;
      if (x * x + y * y > r * r) f.type[j * g.nx + i] = FuelType.Grassland;
    }
  return f;
}

/** Cells burning with at least one unburnt 4-neighbour at time t (what fire.frontCells() returns). */
function frontCellsAt(fire: FireField, t: number): Int32Array {
  const { nx, ny } = fire.grid;
  const a = fire.arrivalTime;
  const out: number[] = [];
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (!(a[k]! <= t)) continue;
      const un = (kk: number): boolean => !(a[kk]! <= t);
      if ((i > 0 && un(k - 1)) || (i < nx - 1 && un(k + 1)) || (j > 0 && un(k - nx)) || (j < ny - 1 && un(k + nx))) out.push(k);
    }
  return Int32Array.from(out);
}

interface EmitRun {
  model: EmberModel;
  emitted: number;
  emittedByClass: number[];
}

/** Run emit() only (no transport) between t = 0 and tEnd, returning the exact expected emission in [t1, t2]. */
function emissionWindow(g: GridSpec, fuel: FuelMap, front: PlanarFront, t1: number, t2: number, o: Partial<EmberModelOptions> = {},
  list: 'burning' | 'front' = 'burning', vls?: Uint8Array): EmitRun {
  const terrain = flatTerrain(g);
  const fire = planarFire(g, front);
  const aux = emptyAux(g.nx * g.ny);
  if (vls) aux.vlsActive.set(vls);
  const model = new EmberModel(terrain, fuel, { maxEmbers: 50, tier: 'fast', ...o }, new Rng(1));
  const dt = 10;
  let e1: number[] = [0, 0, 0, 0, 0];
  for (let t = 0; t < t2; t += dt) {
    if (t === t1) e1 = model.stats().emittedBrands;
    const burning = list === 'burning' ? burningAt(fire, t, dt, 400) : frontCellsAt(fire, t + dt);
    model.emit(fire, fuel, burning, dt, t, aux);
  }
  const e2 = model.stats().emittedBrands;
  const byClass = e2.map((v, c) => v - e1[c]!);
  return { model, emitted: byClass.reduce((a, b) => a + b, 0), emittedByClass: byClass };
}

describe('emission per unit front length (D52)', () => {
  const g = grid(5000, 30);
  const r = 1500;
  const chordIntegral = r * r * (Math.sqrt(3) / 2 + Math.PI / 3); // ∫ chord ds over |s| ≤ r/2

  it('324 brands km⁻¹ h⁻¹ at the reference, equal (±5 %) for a grid-aligned and a 45° front', () => {
    const fuel = circleFuel(g, r);
    const R = 0.5;
    const res: number[] = [];
    for (const dir of [90, 45]) {
      const d = (dir * Math.PI) / 180;
      const front: PlanarFront = { x0: -2000 * Math.sin(d), y0: -2000 * Math.cos(d), dirDeg: dir, ros: R, intensity: 10000, flameHeight: 20 };
      // front position s = R·t − 2000 crosses |s| ≤ r/2 during t ∈ [2500, 5500] s
      const run = emissionWindow(g, fuel, front, 2500, 5500);
      const expected = (Q_REF / R) * chordIntegral;
      res.push(run.emitted);
      expect(run.emitted / expected).toBeGreaterThan(0.95);
      expect(run.emitted / expected).toBeLessThan(1.05);
    }
    expect(res[1]! / res[0]!).toBeGreaterThan(0.95);
    expect(res[1]! / res[0]!).toBeLessThan(1.05);
  });

  it('is independent of R and τ_f', () => {
    const fuel = circleFuel(g, r);
    const out: number[] = [];
    for (const [R, tauF] of [[0.25, 45], [1.0, 45], [0.5, 15], [0.5, 120]] as const) {
      const front: PlanarFront = { x0: -2000, y0: 0, dirDeg: 90, ros: R, intensity: 10000, flameHeight: 20 };
      const t1 = 1250 / R;
      const t2 = 2750 / R;
      const cellFuel = (k: number): EmberCellFuel => ({ spotting: fuel.type[k] !== FuelType.Grassland, barkClass: 'stringy', tauF,
        receptivity: 1, hOEff: 20, family: 'vesta2', flags: 4 });
      const run = emissionWindow(g, fuel, front, Math.round(t1 / 10) * 10, Math.round(t2 / 10) * 10, { cellFuel });
      // brands per metre of front per second, averaged over the window
      const perLength = (run.emitted * R) / chordIntegral / 1;
      out.push(perLength);
    }
    for (const v of out) {
      expect(v / Q_REF).toBeGreaterThan(0.95);
      expect(v / Q_REF).toBeLessThan(1.05);
    }
  });

  it('front-cell lists lose no emission (cells tracked until 3τ_f)', () => {
    const fuel = circleFuel(g, r);
    const front: PlanarFront = { x0: -1000, y0: -600, dirDeg: 60, ros: 0.4, intensity: 8000, flameHeight: 15 };
    const a = emissionWindow(g, fuel, front, 0, 4000, {}, 'burning');
    const b = emissionWindow(g, fuel, front, 0, 4000, {}, 'front');
    expect(a.emitted).toBeGreaterThan(0);
    expect(b.emitted / a.emitted).toBeCloseTo(1, 6);
  });

  it('bark hazard: BH 2 → 3 triples emission exactly; onset and bark-engagement gates', () => {
    const front: PlanarFront = { x0: -2000, y0: 0, dirDeg: 90, ros: 0.5, intensity: 10000, flameHeight: 20 };
    const e2 = emissionWindow(g, circleFuel(g, r, 2), front, 0, 3000).emitted;
    const e3 = emissionWindow(g, circleFuel(g, r, 3), front, 0, 3000).emitted;
    expect(e3 / e2).toBeCloseTo(3, 6);
    const low = emissionWindow(g, circleFuel(g, r), { ...front, intensity: 480 }, 0, 3000).emitted;
    expect(low).toBe(0);
    const shortFlame = emissionWindow(g, circleFuel(g, r), { ...front, flameHeight: 1 }, 0, 3000).emitted;
    expect(shortFlame).toBe(0);
    const grass = uniformFuel(g, { type: FuelType.Grassland });
    const run = emissionWindow(g, grass, front, 0, 3000);
    expect(run.emitted).toBe(0);
    expect(run.model.stats().firePowerW).toBeGreaterThan(0); // non-spotting fuel still feeds the plume
  });
});

describe('class split (§9.1 shares renormalised over the classes present)', () => {
  const g = grid(3000, 30);
  const front: PlanarFront = { x0: -1200, y0: 0, dirDeg: 90, ros: 0.5, intensity: 10000, flameHeight: 10 };

  it('stringybark only: E1/E4/E5 = 0.35/0.15/0.05 renormalised', () => {
    const run = emissionWindow(g, uniformFuel(g, { flags: FuelFlag.Stringybark, canopyHeight: 20 }), front, 0, 2000);
    const tot = run.emitted;
    expect(run.emittedByClass[CLS_FLAKE]! / tot).toBeCloseTo(0.35 / 0.55, 6);
    expect(run.emittedByClass[CLS_TWIG]! / tot).toBeCloseTo(0.15 / 0.55, 6);
    expect(run.emittedByClass[CLS_HEAVY]! / tot).toBeCloseTo(0.05 / 0.55, 6);
    expect(run.emittedByClass[CLS_RIBBON]!).toBe(0);
    expect(run.emittedByClass[CLS_LEAF]!).toBe(0);
  });

  it('E2 ribbon only with RibbonBark and BH ≥ 3; E3 leaves only when FH > 0.66·H_o,eff', () => {
    const rib3 = emissionWindow(g, uniformFuel(g, { flags: FuelFlag.RibbonBark | FuelFlag.Stringybark, barkHazard: 3 }), front, 0, 2000);
    expect(rib3.emittedByClass[CLS_RIBBON]! / rib3.emitted).toBeCloseTo(0.3 / 0.85, 6);
    const rib29 = emissionWindow(g, uniformFuel(g, { flags: FuelFlag.RibbonBark | FuelFlag.Stringybark, barkHazard: 2.9 }), front, 0, 2000);
    expect(rib29.emittedByClass[CLS_RIBBON]!).toBe(0);
    // H_o,eff = max(CHM 12, 0.8 × 20 m type height) = 16 m → leaves need FH > 10.6 m
    const crown = emissionWindow(g, uniformFuel(g, { canopyHeight: 12 }), { ...front, flameHeight: 12 }, 0, 2000);
    expect(crown.emittedByClass[CLS_LEAF]! / crown.emitted).toBeCloseTo(0.15 / 0.7, 6);
  });

  it('VLS injection ×2.5 on E1–E4 only (§9.2, §9.4)', () => {
    const fuel = uniformFuel(g);
    const base = emissionWindow(g, fuel, front, 0, 2000);
    const vls = new Uint8Array(g.nx * g.ny).fill(1);
    const boosted = emissionWindow(g, fuel, front, 0, 2000, {}, 'burning', vls);
    expect(boosted.emittedByClass[CLS_FLAKE]! / base.emittedByClass[CLS_FLAKE]!).toBeCloseTo(2.5, 6);
    expect(boosted.emittedByClass[CLS_TWIG]! / base.emittedByClass[CLS_TWIG]!).toBeCloseTo(2.5, 6);
    expect(boosted.emittedByClass[CLS_HEAVY]! / base.emittedByClass[CLS_HEAVY]!).toBeCloseTo(1, 6);
  });
});

describe('landing density and plume top', () => {
  it('BH 2 → 3 triples the W-weighted landing density (±10 %)', () => {
    const g = grid(6000, 30);
    const front: PlanarFront = { x0: -2500, y0: 0, dirDeg: 90, ros: 0.4, intensity: 12000, flameHeight: 18, halfLength: 800 };
    const dens: number[] = [];
    for (const bh of [2, 3]) {
      const terrain = flatTerrain(g);
      const fuel = uniformFuel(g, { barkHazard: bh });
      const fire = planarFire(g, front);
      const aux = emptyAux(g.nx * g.ny);
      let now = 0;
      const m = new EmberModel(terrain, fuel, { maxEmbers: 3000, tier: 'fast' }, new Rng(bh * 17));
      const landing = planarLanding(g, fire, front, () => now, { moisture: 6 });
      const wind = uniformWind(8, 0);
      const turb = constTurb(1500, 1.5, 0.6);
      let sum = 0;
      for (let t = 0; t < 2400; t += 10) {
        now = t;
        m.emit(fire, fuel, burningAt(fire, t, 10, 400), 10, t, aux);
        now = t + 10;
        m.step(10, wind, turb, landing, () => undefined);
        if (t >= 600 && t % 300 === 0) {
          const ov = m.overlays().landing;
          for (let k = 0; k < ov.length; k++) sum += ov[k]!;
        }
      }
      dens.push(sum);
    }
    expect(dens[1]! / dens[0]!).toBeGreaterThan(2.7);
    expect(dens[1]! / dens[0]!).toBeLessThan(3.3);
  });

  it('1 km × 10 MW/m line fire, N 0.01, U 10 m/s: diagnosed plume top 1.2 km ± 30 % (§9.7)', () => {
    const g = grid(4000, 30);
    const terrain = flatTerrain(g, 100);
    const fuel = uniformFuel(g);
    const front: PlanarFront = { x0: -1500, y0: 0, dirDeg: 90, ros: 0.5, intensity: 10000, flameHeight: 20, halfLength: 500 };
    const fire = planarFire(g, front);
    const aux = emptyAux(g.nx * g.ny);
    const m = new EmberModel(terrain, fuel, { maxEmbers: 200, tier: 'fast' }, new Rng(2));
    m.setEnvironment({ nSquared: 1e-4, temperatureC: 30 });
    let pSum = 0;
    let zSum = 0;
    let n = 0;
    for (let t = 0; t < 1200; t += 10) {
      m.emit(fire, fuel, burningAt(fire, t, 10, 400), 10, t, aux);
      m.step(10, uniformWind(10, 0), noTurb, () => ({ moisture: 30, fuelType: 4, burnable: false, burnt: false, fuelTempC: 20,
        surfaceHazard: 0, nearSurfaceHazard: 0, family: 'vesta2', curing: 0, bedWindMs: 0, distToFront: 0, frontDirX: 0, frontDirY: 0,
        rosLocal: 0 }), () => undefined);
      if (t >= 600) {
        const st = m.stats();
        pSum += st.firePowerW;
        zSum += st.plumeTopAGL;
        n++;
      }
    }
    // Q = I·L = 10 MW/m × 33 rows × 30 m (0.99 km of front inside |y| ≤ 500 m)
    expect(pSum / n / 0.99e10).toBeGreaterThan(0.95);
    expect(pSum / n / 0.99e10).toBeLessThan(1.05);
    expect(zSum / n).toBeGreaterThan(1200 * 0.7);
    expect(zSum / n).toBeLessThan(1200 * 1.3);
  });
});
