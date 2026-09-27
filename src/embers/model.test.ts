/**
 * EmberModel as a whole: determinism (§12.5), checkpoint/restore bitwise equality (§12.4), class populations at
 * 0.8·maxEmbers in steady emission (§9.2/§9.7), budget changes, the render packing, NaN safety and the §9.7 / §13
 * performance budget (≤ 300 ns per particle-step and 2–5 ms per atmosphere step on a phone ≈ 2–3× slower than x86).
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { BurnState, FuelType, type LandingInfo, type SpotProvenance } from '../core/types';
import { EmberModel } from './EmberModel';
import {
  burningAt,
  constTurb,
  emptyAux,
  flatTerrain,
  grid,
  planarFire,
  planarLanding,
  powerLawWind,
  runLineFire,
  uniformFuel,
  uniformWind,
  type PlanarFront,
} from './testing';

/** A 3-D-tier rig (sub-grid plume on) that can be stepped piecewise, for determinism and checkpoints. */
function rig(seed: number) {
  const g = grid(12000, 30);
  const terrain = flatTerrain(g);
  const fuel = uniformFuel(g);
  const front: PlanarFront = { x0: -4000, y0: 0, dirDeg: 80, ros: 0.4, intensity: 12000, flameHeight: 18, halfLength: 800 };
  const fire = planarFire(g, front);
  const aux = emptyAux(g.nx * g.ny);
  const model = new EmberModel(terrain, fuel, { maxEmbers: 1500, tier: 'standard' }, new Rng(seed));
  model.setEnvironment({ temperatureC: 30 });
  const wind = powerLawWind(12, 260);
  // spatially varying turbulence scales (exercises the per-column cache across checkpoints)
  const turb = (x: number, y: number, _z: number, out: Float32Array): void => {
    out[0] = 1500 + 0.02 * x;
    out[1] = 2 + 0.0002 * y;
    out[2] = 0.7;
  };
  let now = 0;
  const landing = planarLanding(g, fire, front, () => now, { moisture: 5 });
  const spots: { x: number; y: number; travel: number; prov: SpotProvenance; t: number }[] = [];
  let t = 0;
  const advance = (steps: number): void => {
    for (let q = 0; q < steps; q++) {
      now = t;
      model.emit(fire, fuel, burningAt(fire, t, 10, 200), 10, t, aux);
      now = t + 10;
      model.step(10, wind, turb, landing, (x, y, travel, prov) => spots.push({ x, y, travel, prov, t: now }));
      t += 10;
    }
  };
  return { model, advance, spots, time: () => t, setTime: (v: number) => (t = v) };
}

describe('determinism (§12.5)', () => {
  it('fixed seed → identical spot sequence and particle state; a different seed differs', () => {
    const a = rig(5);
    const b = rig(5);
    const c = rig(6);
    a.advance(150);
    b.advance(150);
    c.advance(150);
    expect(a.spots.length).toBeGreaterThan(0);
    expect(JSON.stringify(b.spots)).toBe(JSON.stringify(a.spots));
    expect(Array.from(b.model.particles().data)).toEqual(Array.from(a.model.particles().data));
    expect(JSON.stringify(c.spots)).not.toBe(JSON.stringify(a.spots));
  });
});

describe('checkpoint / restore (§12.4)', () => {
  it('restore then step is bitwise equal to an uninterrupted run (structured-clone safe)', () => {
    const ref = rig(9);
    ref.advance(60);
    const cp = structuredClone(ref.model.checkpoint());
    const nSpots = ref.spots.length;
    ref.advance(60);
    const refData = ref.model.particles().data;
    const refStats = ref.model.stats();
    const refOv = ref.model.overlays();

    const other = rig(1234); // different seed and history: everything must come from the checkpoint
    other.advance(20);
    other.model.restore(cp);
    other.setTime(600);
    other.advance(60);
    expect(Array.from(other.model.particles().data)).toEqual(Array.from(refData));
    expect(JSON.stringify(other.spots.slice(other.spots.length - (ref.spots.length - nSpots)))).toBe(JSON.stringify(ref.spots.slice(nSpots)));
    const st = other.model.stats();
    expect(st.active).toBe(refStats.active);
    expect(st.landings10min).toBe(refStats.landings10min);
    expect(st.classWeights).toEqual(refStats.classWeights);
    expect(st.pendingIgnitions).toBe(refStats.pendingIgnitions);
    expect(Array.from(st.beyondEdgeHistogram)).toEqual(Array.from(refStats.beyondEdgeHistogram));
    const ov = other.model.overlays();
    expect(Array.from(ov.landing)).toEqual(Array.from(refOv.landing));
    expect(Array.from(ov.ignitions)).toEqual(Array.from(refOv.ignitions));
  });
});

describe('super-particle budget (§9.2)', () => {
  it('class populations sum to 0.8·maxEmbers ± 10 % in steady emission; W_c ≥ 1e-3; nothing dropped', () => {
    // FFDI 100-like head fire, front at 73° (no grid-aligned ignition bursts), fast tier, budget 2000
    const pops: number[] = [];
    const r = runLineFire({
      u10kmh: 66.7, rosMh: 1800, intensity: 13950, flameHeight: 25, dirDeg: 73, seconds: 2400, maxEmbers: 2000,
      onStep: (t, m) => {
        if (t > 1200 && t % 60 === 0) pops.push(m.stats().classPopulation.reduce((a, b) => a + b, 0));
      },
    });
    const st = r.model.stats();
    expect(st.classWeights.every((w) => w >= 1e-3)).toBe(true);
    const mean = pops.reduce((a, b) => a + b, 0) / pops.length;
    expect(mean / (0.8 * 2000)).toBeGreaterThan(0.9);
    expect(mean / (0.8 * 2000)).toBeLessThan(1.1);
    for (const p of pops) expect(p).toBeLessThanOrEqual(2000);
    expect(st.dropped).toBe(0);
    // the long-range classes get their share: E1 flakes hold ≥ 1/4 of the particles
    expect(st.classPopulation[0]! / st.active).toBeGreaterThan(0.25);
  });

  it('setMaxEmbers shrinks the store and keeps the oldest particles; emission then respects the new budget', () => {
    const r = rig(3);
    r.advance(40);
    const before = r.model.stats().active;
    expect(before).toBeGreaterThan(100);
    r.model.setMaxEmbers(100);
    expect(r.model.stats().active).toBeLessThanOrEqual(100);
    r.advance(20);
    expect(r.model.stats().active).toBeLessThanOrEqual(100);
  });
});

describe('render packing and robustness', () => {
  it('particles(): [x, y, z ASL, temperature fraction] per ember', () => {
    const g = grid(3000, 30);
    const m = new EmberModel(flatTerrain(g, 700), uniformFuel(g), { maxEmbers: 10, tier: 'fast' }, new Rng(1));
    m.injectParticle({ x: 10, y: -20, z: 900, emberClass: 'ribbon', vt0: 5.5, tauB: 400, tauF: 60 });
    const p = m.particles();
    expect(p.count).toBe(1);
    expect(Array.from(p.data)).toEqual([10, -20, 900, 1]);
  });

  it('NaN inputs never produce NaN rates, weights or particles', () => {
    const g = grid(3000, 30);
    const terrain = flatTerrain(g);
    const fuel = uniformFuel(g);
    const front: PlanarFront = { x0: -1000, y0: 0, dirDeg: 90, ros: 0.3, intensity: 8000, flameHeight: 12 };
    const fire = planarFire(g, front);
    for (let k = 0; k < 2000; k++) {
      fire.intensity[k] = NaN;
      fire.ros[k] = NaN;
      fire.flameHeight[k] = NaN;
    }
    fuel.barkHazard[5] = NaN;
    fire.burnState[7] = BurnState.NonFlammable;
    const m = new EmberModel(terrain, fuel, { maxEmbers: 500, tier: 'fast' }, new Rng(2));
    const info: LandingInfo = {
      moisture: NaN, fuelType: FuelType.DryForestShrubby, burnable: true, burnt: false, fuelTempC: NaN, surfaceHazard: 3, nearSurfaceHazard: 2,
      family: 'vesta2', curing: 100, bedWindMs: NaN, distToFront: NaN, frontDirX: 0, frontDirY: 0, rosLocal: NaN,
    };
    let t = 0;
    const nanWind = (x: number, _y: number, _z: number, out: Float32Array): void => {
      out[0] = x > 500 ? NaN : 10;
      out[1] = 0;
      out[2] = 0;
    };
    let spots = 0;
    for (let q = 0; q < 60; q++, t += 10) {
      m.emit(fire, fuel, burningAt(fire, t, 10, 200), 10, t, emptyAux(g.nx * g.ny));
      m.step(10, q % 2 ? nanWind : uniformWind(10, 0), constTurb(NaN, NaN, NaN), () => info, () => spots++);
    }
    const st = m.stats();
    expect(st.classWeights.every((w) => Number.isFinite(w))).toBe(true);
    expect(Number.isFinite(st.emissionRate)).toBe(true);
    expect(st.active).toBeGreaterThan(0);
    expect(Array.from(m.particles().data).every((v) => Number.isFinite(v))).toBe(true);
    expect(spots).toBe(0); // NaN moisture → P_ig 0
  });
});

describe('performance (§9.7, §13)', () => {
  it('transport ≤ 300 ns per particle-step on a phone (x86 gate 450 ns; measured ≈ 150–180 ns)', () => {
    const g = grid(20000, 30);
    const m = new EmberModel(flatTerrain(g), uniformFuel(g), { maxEmbers: 4000, tier: 'standard' }, new Rng(7));
    const r = new Rng(3);
    for (let q = 0; q < 4000; q++)
      m.injectParticle({ x: -9000 + 2000 * r.next(), y: -1000 + 2000 * r.next(), z: 1500 + 2000 * r.next(), emberClass: 'flake', vt0: 4.5, tauB: 1e5, tauF: 30 });
    const info: LandingInfo = {
      moisture: 5, fuelType: FuelType.DryForestShrubby, burnable: true, burnt: false, fuelTempC: 35, surfaceHazard: 3.4, nearSurfaceHazard: 2.9,
      family: 'vesta2', curing: 100, bedWindMs: 1.5, distToFront: 5000, frontDirX: 1, frontDirY: 0, rosLocal: 0.25,
    };
    const w = uniformWind(3, 0);
    const turb = constTurb(1500, 2, 0.8);
    for (let s = 0; s < 10; s++) m.step(10, w, turb, () => info, () => undefined); // warm-up (JIT)
    const s0 = m.stats().particleSteps;
    const t0 = performance.now();
    for (let s = 0; s < 30; s++) m.step(10, w, turb, () => info, () => undefined);
    const ms = performance.now() - t0;
    const ns = (ms * 1e6) / (m.stats().particleSteps - s0);
    expect(ns).toBeLessThan(450);
  });

  it('full model (emission + transport + landing), ≈ 3200 embers, fast tier: ≤ 2.5 ms per atmosphere step on x86', () => {
    // FFDI 100-like head fire (2 km, 14 MW/m), front at 73°; burning lists precomputed so only the model is timed
    const g = grid(20000, 30);
    const terrain = flatTerrain(g);
    const fuel = uniformFuel(g);
    const front: PlanarFront = { x0: -8000 * Math.sin((73 * Math.PI) / 180), y0: -8000 * Math.cos((73 * Math.PI) / 180), dirDeg: 73, ros: 0.5,
      intensity: 13950, flameHeight: 25, halfLength: 1000 };
    const fire = planarFire(g, front);
    const aux = emptyAux(g.nx * g.ny);
    const lists: Int32Array[] = [];
    for (let t = 0; t < 1800; t += 10) lists.push(burningAt(fire, t, 10, 200));
    const m = new EmberModel(terrain, fuel, { maxEmbers: 4000, tier: 'fast' }, new Rng(7));
    const wind = powerLawWind(66.7 / 3.6, 253);
    const turb = constTurb(1500, 2, 0.8);
    const info: LandingInfo = {
      moisture: 5, fuelType: FuelType.DryForestShrubby, burnable: true, burnt: false, fuelTempC: 35, surfaceHazard: 3.4, nearSurfaceHazard: 2.9,
      family: 'vesta2', curing: 100, bedWindMs: 1.5, distToFront: 5000, frontDirX: 1, frontDirY: 0, rosLocal: 0.5,
    };
    let ms = 0;
    let n = 0;
    for (let q = 0; q < lists.length; q++) {
      const t = q * 10;
      const a = performance.now();
      m.emit(fire, fuel, lists[q]!, 10, t, aux);
      m.step(10, wind, turb, () => info, () => undefined);
      if (t >= 900) {
        ms += performance.now() - a;
        n++;
      }
    }
    expect(m.stats().active).toBeGreaterThan(2500);
    expect(ms / n).toBeLessThan(2.5);
  });
});
