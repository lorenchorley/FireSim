/**
 * Transport (spec §9.3; §9.7 vectors "uniform 16.7 m/s wind, no plume, ρ = ρ_ref: an E2 brand released at
 * z* = 0.8005·v_t0·τ_b lands at Ū·τ_b ± 5 %, an E4 brand released at z_b = v_t0·τ_b/2 lands at Ū·τ_b ± 5 %").
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import type { LandingInfo } from '../core/types';
import { EmberModel, type EmberLandingEvent, type EmberModelOptions } from './EmberModel';
import { burnoutFallCoefficient } from './physics';
import { EMBER_PARAMS } from './params';
import { burningAt, constTurb, emptyAux, flatTerrain, grid, noTurb, planarFire, uniformFuel, uniformWind, type PlanarFront } from './testing';
import type { WindFn } from './plume';

const noLanding = (): LandingInfo => ({
  moisture: 30, fuelType: 4, burnable: false, burnt: false, fuelTempC: 20, surfaceHazard: 0, nearSurfaceHazard: 0, family: 'vesta2',
  curing: 0, bedWindMs: 0, distToFront: 1e9, frontDirX: 0, frontDirY: 0, rosLocal: 0,
});

function setup(extent = 40000, cell = 60, o: Partial<EmberModelOptions> = {}): { model: EmberModel; events: EmberLandingEvent[]; x0: number } {
  const g = grid(extent, cell);
  const terrain = flatTerrain(g, 300);
  const fuel = uniformFuel(g);
  const events: EmberLandingEvent[] = [];
  const model = new EmberModel(terrain, fuel, { maxEmbers: 5000, tier: 'standard', onLanding: (e) => events.push(e), ...o }, new Rng(9));
  model.setEnvironment({ airDensity: 1.1 });
  return { model, events, x0: g.x0 };
}

const runFor = (m: EmberModel, seconds: number, wind: WindFn, dt = 10, turb = noTurb): void => {
  for (let t = 0; t < seconds; t += dt) m.step(dt, wind, turb, noLanding, () => undefined);
};

describe('burnout-limited fall (§9.7 vectors)', () => {
  it('E2 ribbon at z* = 0.8005·v_t0·τ_b lands at Ū·τ_b ± 5 %', () => {
    const { model, events, x0 } = setup();
    const vt0 = 5.5;
    const tauB = 400;
    const zStar = burnoutFallCoefficient(0.25, 0.3) * vt0 * tauB;
    expect(zStar / (vt0 * tauB)).toBeCloseTo(0.8005, 4);
    const xs = x0 + 1000;
    model.injectParticle({ x: xs, y: 0, z: 300 + zStar, emberClass: 'ribbon', vt0, tauB, tauF: 60 });
    runFor(model, tauB + 60, uniformWind(16.7, 0));
    expect(events.length).toBe(1);
    const d = events[0]!.x - xs;
    expect(d / (16.7 * tauB)).toBeGreaterThan(0.95);
    expect(d / (16.7 * tauB)).toBeLessThan(1.05);
    expect(events[0]!.flightTime / tauB).toBeGreaterThan(0.95);
  });

  it('E4 twig at z_b = v_t0·τ_b/2 lands at Ū·τ_b ± 5 % (Albini, n = 1)', () => {
    const { model, events, x0 } = setup();
    const vt0 = 5;
    const tauB = EMBER_PARAMS.albiniK * vt0; // 121.7 s
    const zb = (vt0 * tauB) / 2; // 304 m
    const xs = x0 + 1000;
    model.injectParticle({ x: xs, y: 0, z: 300 + zb, emberClass: 'twig', vt0, tauB, tauF: 20 });
    runFor(model, 200, uniformWind(16.7, 0));
    expect(events.length).toBe(1);
    const d = events[0]!.x - xs;
    expect(d / (16.7 * tauB)).toBeGreaterThan(0.95);
    expect(d / (16.7 * tauB)).toBeLessThan(1.05);
  });

  it('a brand released above its burnout height burns out in flight', () => {
    const { model, events, x0 } = setup();
    model.injectParticle({ x: x0 + 1000, y: 0, z: 300 + 1.2 * 0.5 * 5 * 121.7, emberClass: 'twig', vt0: 5, tauB: 121.7 });
    runFor(model, 300, uniformWind(10, 0));
    expect(events.length).toBe(0);
    expect(model.stats().burntOutInFlight).toBe(1);
    expect(model.stats().active).toBe(0);
  });

  it('thin air falls faster: v_t ∝ √(ρ_ref/ρ)', () => {
    const times: number[] = [];
    for (const rho of [1.1, 0.8]) {
      const { model, events, x0 } = setup();
      model.setEnvironment({ airDensity: rho });
      model.injectParticle({ x: x0 + 1000, y: 0, z: 300 + 200, emberClass: 'heavy', vt0: 10, tauB: 600 });
      runFor(model, 100, uniformWind(5, 0), 1);
      times.push(events[0]!.flightTime);
    }
    expect(times[0]! / times[1]!).toBeCloseTo(Math.sqrt(1.1 / 0.8), 1);
  });
});

describe('turbulence (§9.3 OU)', () => {
  it('daytime CBL: lateral spread of a puff matches the OU dispersion 2σ²T²(t/T − 1 + e^{−t/T}) (±25 %)', () => {
    const { model, x0 } = setup(40000, 60);
    const n = 800;
    for (let q = 0; q < n; q++) model.injectParticle({ x: x0 + 2000, y: 0, z: 300 + 1100, emberClass: 'ribbon', vt0: 5.5, tauB: 1400 });
    const zi = 1500;
    const ws = 2;
    runFor(model, 100, uniformWind(0, 0), 10, constTurb(zi, ws, 0.5));
    const p = model.particles();
    let s2 = 0;
    for (let q = 0; q < p.count; q++) s2 += p.data[q * 4 + 1]! ** 2;
    const varY = s2 / p.count;
    const su = 0.6 * ws;
    const T = (0.15 * zi) / su / Math.sqrt(1 + (5.5 / su) ** 2); // crossing trajectories
    const t = 100;
    const expected = 2 * su * su * T * T * (t / T - 1 + Math.exp(-t / T));
    expect(p.count).toBe(n);
    expect(varY / expected).toBeGreaterThan(0.75);
    expect(varY / expected).toBeLessThan(1.25);
  });

  it('no turbulence scales → deterministic straight fall', () => {
    const { model, x0 } = setup();
    for (let q = 0; q < 10; q++) model.injectParticle({ x: x0 + 1000, y: 0, z: 900, emberClass: 'ribbon', vt0: 5.5, tauB: 1000 });
    runFor(model, 30, uniformWind(3, 0));
    const p = model.particles();
    for (let q = 1; q < p.count; q++) expect(p.data[q * 4]).toBe(p.data[0]);
  });
});

describe('domain exit and model top', () => {
  it('leaving the domain: leftDomain + beyond-edge histogram at Ū·min(z/v_t, τ_b − age)', () => {
    const { model, x0 } = setup(6000, 60);
    const xEdge = x0 + (100 - 0.5) * 60;
    // heavy brand 900 m AGL just inside the east edge in a 20 m/s wind, v_t ≈ 10 m/s → 90 s → 1.8 km beyond the edge
    model.injectParticle({ x: xEdge - 30, y: 0, z: 300 + 900, emberClass: 'heavy', vt0: 10, tauB: 600, tauF: 600 });
    model.setEnvironment({ weather: { time: 0, temperature: 25, relativeHumidity: 30, windSpeed10: 20, windDir10: 270 } });
    runFor(model, 10, uniformWind(20, 0));
    const st = model.stats();
    expect(st.leftDomain).toBe(1);
    expect(st.active).toBe(0);
    let bin = -1;
    st.beyondEdgeHistogram.forEach((v, b) => {
      if (v > 0) bin = b;
    });
    expect(bin).toBe(1);
    expect(st.beyondEdgeHistogram.length).toBe(30);
  });

  it('above the model top the ambient profile replaces the callback wind', () => {
    const { model, x0 } = setup(40000, 60);
    model.setEnvironment({ modelTopAGL: 500, weather: { time: 0, temperature: 25, relativeHumidity: 30, windSpeed10: 30, windDir10: 270 } });
    model.injectParticle({ x: x0 + 1000, y: 0, z: 300 + 2000, emberClass: 'ribbon', vt0: 5.5, tauB: 1400 });
    runFor(model, 10, uniformWind(5, 0));
    const p = model.particles();
    expect(p.data[0]! - (x0 + 1000)).toBeCloseTo(300, 0);
  });
});

describe('lofting', () => {
  const front: PlanarFront = { x0: -1500, y0: 0, dirDeg: 90, ros: 0.5, intensity: 20000, flameHeight: 20, halfLength: 500 };

  function loftRun(tier: 'fast' | 'standard'): { maxH: number[]; model: EmberModel } {
    const g = grid(8000, 30);
    const terrain = flatTerrain(g, 300);
    const fuel = uniformFuel(g);
    const fire = planarFire(g, front);
    const aux = emptyAux(g.nx * g.ny);
    const maxH: number[] = [];
    const model = new EmberModel(terrain, fuel, { maxEmbers: 3000, tier, onLanding: (e) => e.emberClass === 'flake' && maxH.push(e.maxHeightAGL) }, new Rng(4));
    for (let t = 0; t < 900; t += 10) {
      model.emit(fire, fuel, burningAt(fire, t, 10, 400), 10, t, aux);
      model.step(10, uniformWind(8, 0), constTurb(1500, 1.5, 0.5), noLanding, () => undefined);
    }
    return { maxH, model };
  }

  it('fast tier: flakes lofted to z_L = z_p·√ξ ≤ the updraft cap; heights spread up to the cap', () => {
    const { maxH, model } = loftRun('fast');
    const zp = model.stats().plumeTopAGL;
    expect(zp).toBeGreaterThan(500);
    const sorted = [...maxH].sort((a, b) => a - b);
    expect(sorted.length).toBeGreaterThan(200);
    const p95 = sorted[Math.floor(0.95 * sorted.length)]!;
    expect(p95).toBeGreaterThan(0.2 * zp);
    expect(sorted[sorted.length - 1]!).toBeLessThanOrEqual(zp * 1.3); // cap + turbulence overshoot after release
  });

  it('3-D tier: the sub-grid plume lofts flakes well above their launch height (≤ 8 m)', () => {
    const { maxH } = loftRun('standard');
    const sorted = [...maxH].sort((a, b) => a - b);
    expect(sorted.length).toBeGreaterThan(200);
    expect(sorted[Math.floor(0.9 * sorted.length)]!).toBeGreaterThan(40);
  });
});
