/**
 * Landing, exclusion zone and ignition (spec §9.5): P_ig·S_state·R_fuel·(m/m0)^0.25, exclusion zone d_ex, pile
 * synergy, P_spot = 1 − e^{−W·p}, delays, holdovers, provenance, stats and overlays.
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { FuelType, type LandingInfo, type SpotProvenance } from '../core/types';
import { EmberModel, type EmberLandingEvent } from './EmberModel';
import { ignitionProbability } from './physics';
import { flatTerrain, grid, noTurb, uniformFuel, uniformWind } from './testing';

const base: LandingInfo = {
  moisture: 5, fuelType: FuelType.DryForestShrubby, burnable: true, burnt: false, fuelTempC: 30, surfaceHazard: 3.4,
  nearSurfaceHazard: 2.9, family: 'vesta2', curing: 100, bedWindMs: 1, distToFront: 5000, frontDirX: 1, frontDirY: 0, rosLocal: 0.2,
};

interface Rig {
  model: EmberModel;
  events: EmberLandingEvent[];
  spots: { x: number; y: number; t: number; prov: SpotProvenance }[];
  info: LandingInfo;
  run: (seconds: number, dt?: number) => void;
  drop: (o?: { x?: number; y?: number; tauF?: number; weight?: number; cls?: 'heavy' | 'twig'; z?: number }) => void;
}

function rig(fuelType = FuelType.DryForestShrubby): Rig {
  const g = grid(3000, 30);
  const terrain = flatTerrain(g, 500);
  const fuel = uniformFuel(g, { type: fuelType });
  const events: EmberLandingEvent[] = [];
  const spots: Rig['spots'] = [];
  const model = new EmberModel(terrain, fuel, { maxEmbers: 1000, tier: 'fast', onLanding: (e) => events.push(e) }, new Rng(21));
  model.setEnvironment({ airDensity: 1.1 });
  const r: Rig = {
    model, events, spots, info: { ...base },
    run: (seconds, dt = 1) => {
      for (let t = 0; t < seconds; t += dt) {
        model.step(dt, uniformWind(0, 0), noTurb, () => ({ ...r.info }), (x, y, _travel, prov) => spots.push({ x, y, t: model.clock + dt, prov }));
      }
    },
    drop: (o = {}) => {
      model.injectParticle({ x: o.x ?? 0, y: o.y ?? 0, z: o.z ?? 501, emberClass: o.cls ?? 'heavy', vt0: 10, tauB: 600, tauF: o.tauF ?? 100,
        weight: o.weight ?? 1 });
    },
  };
  return r;
}

describe('discard and exclusion zone', () => {
  it('burnt or non-burnable cells never ignite', () => {
    const r = rig();
    r.info = { ...base, burnt: true };
    r.drop({ weight: 1000 });
    r.run(2);
    r.info = { ...base, burnable: false };
    r.drop({ weight: 1000 });
    r.run(60);
    expect(r.events.map((e) => e.outcome)).toEqual(['discarded', 'discarded']);
    expect(r.spots.length).toBe(0);
  });

  it('d_ex = max(2Δx, R·180 s): downwind landings inside are short-range, upwind or outside attempt', () => {
    const r = rig();
    // wind blowing east; the front is west of the landing (frontDir = +x) → downwind
    const wind = uniformWind(5, 0);
    const step = (info: LandingInfo): EmberLandingEvent => {
      r.model.injectParticle({ x: 0, y: 0, z: 501, emberClass: 'heavy', vt0: 10, tauB: 600, tauF: 100 });
      r.model.step(1, wind, noTurb, () => info, () => undefined);
      return r.events[r.events.length - 1]!;
    };
    expect(step({ ...base, distToFront: 170, rosLocal: 1 }).outcome).toBe('shortRange'); // d_ex = 180 m
    expect(step({ ...base, distToFront: 190, rosLocal: 1 }).outcome).toBe('attempt');
    expect(step({ ...base, distToFront: 50, rosLocal: 0.1 }).outcome).toBe('shortRange'); // d_ex = 2Δx = 60 m
    expect(step({ ...base, distToFront: 70, rosLocal: 0.1 }).outcome).toBe('attempt');
    expect(step({ ...base, distToFront: 50, rosLocal: 1, frontDirX: -1 }).outcome).toBe('attempt'); // upwind of the front
    expect(r.model.stats().shortRange10min).toBeCloseTo(2, 6);
  });
});

describe('ignition probability p = P_ig·S_state·R_fuel·(m/m0)^0.25', () => {
  it('flaming, glowing, fuel families and receptivity', () => {
    const r = rig();
    const pig = ignitionProbability(30, 5);
    r.info = { ...base, surfaceHazard: 1 };
    r.drop({ tauF: 100 });
    r.run(1);
    const m = (e: EmberLandingEvent): number => Math.sqrt(Math.sqrt(1 - e.flightTime / 600));
    let e = r.events[0]!;
    expect(e.state).toBe('flaming');
    expect(e.p).toBeCloseTo(pig * 1 * 0.5 * m(e), 6); // R_fuel = 1.0 × min(1, 1/2)
    r.info = { ...base, bedWindMs: 1 };
    r.drop({ tauF: 0.01 });
    r.run(1);
    e = r.events[1]!;
    expect(e.state).toBe('glowing');
    expect(e.p).toBeCloseTo(pig * 0.3 * 0.5 * 1 * m(e), 6); // S = 0.3·clamp(1/2)
    r.info = { ...base, family: 'heath', nearSurfaceHazard: 1.5 };
    r.drop({ x: 300 });
    r.run(1);
    expect(r.events[2]!.p).toBeCloseTo(pig * 0.75 * m(r.events[2]!), 6);
    r.info = { ...base, family: 'grass', curing: 60 };
    r.drop({ x: 600 });
    r.run(1);
    expect(r.events[3]!.p).toBeCloseTo(pig * 0.6 * m(r.events[3]!), 6);
    // WetForest receptivity 0.5 (§4.1 catalogue)
    const w = rig(FuelType.WetForest);
    w.drop();
    w.run(1);
    expect(w.events[0]!.p).toBeCloseTo(pig * 0.5 * m(w.events[0]!), 6);
  });

  it('pile synergy: ≥ 3 brands in one cell within 60 s multiply p by 1 + 0.2·min(n − 1, 10) (p ≤ 0.95)', () => {
    const r = rig();
    r.info = { ...base, surfaceHazard: 1, moisture: 10 };
    for (let q = 0; q < 5; q++) {
      r.drop();
      r.run(1);
    }
    const p = r.events.map((e) => e.p / Math.sqrt(Math.sqrt(1 - e.flightTime / 600)));
    const p0 = ignitionProbability(30, 10) * 0.5;
    expect(p[0]).toBeCloseTo(p0, 5);
    expect(p[1]).toBeCloseTo(p0, 5);
    expect(p[2]).toBeCloseTo(p0 * 1.4, 5);
    expect(p[4]).toBeCloseTo(p0 * 1.8, 5);
    // after the 60 s window the count restarts
    r.run(70, 10);
    r.drop();
    r.run(1);
    expect(r.events[5]!.p / Math.sqrt(Math.sqrt(1 - r.events[5]!.flightTime / 600))).toBeCloseTo(p0, 5);
    // cap
    const c = rig();
    c.info = { ...base, moisture: 2 };
    c.drop({ weight: 50 });
    c.run(1);
    expect(c.events[0]!.p).toBeLessThanOrEqual(0.95);
  });
});

describe('spot ignition: delays, cancellation, holdovers, provenance', () => {
  it('flaming landings ignite after U(5, 30) s, glowing after U(60, 600) s', () => {
    const delays: { flaming: number[]; glowing: number[] } = { flaming: [], glowing: [] };
    for (let q = 0; q < 12; q++) {
      for (const kind of ['flaming', 'glowing'] as const) {
        const r = rig();
        r.drop({ tauF: kind === 'flaming' ? 100 : 0.01, weight: 500 });
        r.run(700, 1);
        expect(r.spots.length).toBe(1);
        const s = r.spots[0]!;
        delays[kind].push(s.t - (s.prov.emitTime + s.prov.flightTime));
        expect(s.prov.landingState).toBe(kind);
      }
    }
    for (const d of delays.flaming) {
      expect(d).toBeGreaterThanOrEqual(5 - 1e-6);
      expect(d).toBeLessThanOrEqual(31);
    }
    for (const d of delays.glowing) {
      expect(d).toBeGreaterThanOrEqual(60 - 1e-6);
      expect(d).toBeLessThanOrEqual(601);
    }
  });

  it('a scheduled ignition is cancelled when the cell burns first', () => {
    const r = rig();
    r.drop({ tauF: 0.01, weight: 500 });
    r.run(2);
    expect(r.model.stats().pendingIgnitions).toBe(1);
    r.info = { ...base, burnt: true };
    r.run(700, 10);
    expect(r.spots.length).toBe(0);
    expect(r.model.stats().pendingIgnitions).toBe(0);
  });

  it('holdovers smoulder in heavy fuel while M ≥ 10 % and convert with hazard (1/3600)·clamp((10 − M)/5, 0, 1)', () => {
    const r = rig();
    r.info = { ...base, moisture: 40, surfaceHazard: 3.5 }; // P_ig ≈ 0 → no immediate spot
    r.drop({ tauF: 0.01, weight: 300 });
    r.run(2);
    expect(r.events[0]!.holdover).toBe(true);
    expect(r.model.stats().holdovers).toBe(1);
    r.info = { ...base, moisture: 12, surfaceHazard: 3.5 };
    r.run(4 * 3600, 60);
    expect(r.spots.length).toBe(0);
    r.info = { ...base, moisture: 4, surfaceHazard: 3.5 };
    r.run(10 * 3600, 60);
    expect(r.spots.length).toBe(1);
    expect(r.spots[0]!.prov.landingState).toBe('holdover');
    expect(r.model.stats().holdovers).toBe(0);
    // light litter (FHS_s < 3) never holds over
    const l = rig();
    l.info = { ...base, moisture: 40, surfaceHazard: 2 };
    l.drop({ tauF: 0.01, weight: 300 });
    l.run(2);
    expect(l.model.stats().holdovers).toBe(0);
  });

  it('provenance and stats', () => {
    const r = rig();
    r.model.injectParticle({ x: 0, y: 0, z: 800, emberClass: 'twig', vt0: 5, tauB: 121, tauF: 200, weight: 400, sourceCell: 7 });
    r.info = { ...base, distToFront: 800 };
    // lands after ≈ 110 s (5·(a − a²/242) = 300 m), ignites U(5, 30) s later
    r.run(150, 1);
    expect(r.spots.length).toBe(1);
    const p = r.spots[0]!.prov;
    expect(p.emberClass).toBe('twig');
    expect(p.sourceCell).toBe(7);
    expect(p.ridgeDrop).toBeCloseTo(300, 0);
    expect(p.maxHeightAGL).toBeCloseTo(300, 0);
    expect(p.flightTime).toBeGreaterThan(60);
    expect(p.landingSlope).toBe(0);
    expect(p.landingMoisture).toBe(5);
    expect(p.pIgnite).toBeGreaterThan(0.3);
    const st = r.model.stats();
    expect(st.landings10min).toBeCloseTo(400, 3);
    expect(st.ignitions10min).toBe(1);
    expect(st.ignitionCapableShare).toBe(1);
    const ov = r.model.overlays();
    let dens = 0;
    let ign = 0;
    for (let k = 0; k < ov.landing.length; k++) {
      dens += ov.landing[k]!;
      ign += ov.ignitions[k]!;
    }
    // ΣW/m² in the landing cell decayed by e^{−t/600} since landing
    expect(dens).toBeGreaterThan((400 / 900) * Math.exp(-45 / 600));
    expect(dens).toBeLessThan(400 / 900);
    expect(ign).toBeGreaterThan(0);
    // overlays decay with τ = 10 min
    r.run(600, 60);
    const later = r.model.overlays().landing.reduce((a, b) => a + b, 0);
    expect(later / dens).toBeCloseTo(Math.exp(-1), 2);
  });
});
