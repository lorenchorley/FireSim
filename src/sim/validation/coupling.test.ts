/**
 * Fire–atmosphere coupling in the coupled model (spec §15 V15, V17, V22; §8.7–§8.8), headless through `Simulation`:
 *  V15 a hot, dry, near-calm afternoon (catastrophic air mass, light wind): plume-dominated fire (N_c ≥ 10) with the
 *      plume and fire-induced-wind cards;
 *  V17 coupling 0: the FireField is bitwise independent of χ_c and identical to a run whose addFireHeat is a no-op,
 *      in the fast and the standard tier;
 *  V22 fast tier: a 2 km line fire has the same steady head ROS with coupling 1 and 0 (±5 %, pyrogenic correction);
 *  indraft: with coupling 1 the fire draws air toward itself (U_fireInd at the front points inward) and the
 *      fire-induced-wind card appears; with coupling 0 U_fireInd ≡ 0.
 */
import { describe, expect, it } from 'vitest';
import { ATMOS_PARAMS } from '../../atmosphere';
import type { FireField, QualityTier } from '../../core/types';
import { WEATHER_PRESETS } from '../../scenario/presets';
import { lmstToUtc } from '../../scenario/time';
import { ORIGIN, SLOW, kindsOf, line, log, point, rosAlong, runSim, synth, type RunResult } from './harness';

const fireBytes = (f: FireField): Buffer[] =>
  [f.arrivalTime, f.burnState, f.ros, f.intensity, f.flameHeight, f.spreadDir, f.driver, f.phase].map((a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength));
const sameFire = (a: FireField, b: FireField): boolean => fireBytes(a).every((x, q) => x.equals(fireBytes(b)[q]!));

describe('V15 plume-dominated fire (catastrophic air mass, light wind 10 km/h, flat forest)', () => {
  const run = (tier: QualityTier): { ncMax: number; kinds: Set<string>; I: number } => {
    const start = lmstToUtc('2025-12-30', 12, ORIGIN.lon);
    const base = WEATHER_PRESETS['catastrophic-black-summer'].build(start, 4, { location: ORIGIN, sourceElevation: 500 });
    const weather = { ...base, hours: base.hours.map((h) => ({ ...h, windSpeed10: 10 / 3.6, windGust10: 15 / 3.6 })) };
    const s = synth({ extent: 6000, start, duration: 3 * 3600, weather, ignitions: [line([[-1500, -700], [-1500, 700]])] });
    let ncMax = 0;
    const r = runSim(s, { tier, until: 2 * 3600, every: 300, onTick: (sim) => (ncMax = Math.max(ncMax, sim.stats().convectiveNumber)) });
    const kinds = kindsOf(r.insights);
    log(`V15 ${tier}: max N_c ${ncMax.toFixed(1)}, max I ${r.sim.stats().maxIntensity.toFixed(0)} kW/m; cards ${[...kinds].join(', ')}`);
    return { ncMax, kinds, I: r.sim.stats().maxIntensity };
  };

  it('fast tier: N_c ≥ 10 at the head → plume-dominated card', () => {
    const r = run('fast');
    expect(r.ncMax).toBeGreaterThanOrEqual(10);
    expect(r.kinds.has('plume-dominated')).toBe(true);
  }, 180000);

  it.skipIf(!SLOW)('standard tier: N_c ≥ 10 → plume-dominated card [SLOW]', () => {
    const r = run('standard');
    expect(r.ncMax).toBeGreaterThanOrEqual(10);
    expect(r.kinds.has('plume-dominated')).toBe(true);
  }, 600000);

  // Regression: no fire-induced-wind card at V15's 5–7 MW/m. The pyrogenic indraft beside the front (k·I/2 ≈ 1.6 m/s
  // for an infinite strip, 1.0–1.6 m/s along this 1.4 km line) sat below the registry's 1.5 m/s floor; it swung
  // 0.2 ↔ 3 m/s between solves with the pulsed heat of a grid-aligned front (the card's 5 min never held); and the
  // freshly arrived front cells still carried the head-corrected (zero) indraft of the cells ahead of the front.
  // Now: floor 1.0 m/s, pyrogenic source smoothed over 300 s, front cells younger than 60 s skipped (share ≥ 0.3 in
  // 106 of 120 cycles).
  it('fast tier: fire-induced-wind card at V15 intensity', () => {
    expect(run('fast').kinds.has('fire-induced-wind')).toBe(true);
  }, 180000);
});

describe('V17 coupling off: the fire does not see χ_c or the heat injection', () => {
  const tiers: QualityTier[] = SLOW ? ['fast', 'standard'] : ['fast'];
  for (const tier of tiers) {
    it(`${tier}: FireField bitwise equal for χ_c 0.85 / 0.5 and with addFireHeat stubbed out`, () => {
      const mk = (): ReturnType<typeof synth> => synth({ extent: 3000, windKmh: 25, duration: 3600, ignitions: [point(-600, 0, 0, 45)], options: { coupling: 0, embers: false } });
      const chi0 = ATMOS_PARAMS.chiC;
      let a: RunResult;
      let b: RunResult;
      try {
        (ATMOS_PARAMS as { chiC: number }).chiC = 0.85;
        a = runSim(mk(), { tier, until: 3600, every: 600 });
        (ATMOS_PARAMS as { chiC: number }).chiC = 0.5;
        b = runSim(mk(), { tier, until: 3600, every: 600 });
      } finally {
        (ATMOS_PARAMS as { chiC: number }).chiC = chi0;
      }
      const c = runSim(mk(), {
        tier,
        until: 3600,
        every: 600,
        setup: (sim) => {
          const atm = (sim as unknown as { atm: { addFireHeat: (...x: unknown[]) => void } }).atm;
          atm.addFireHeat = () => undefined;
        },
      });
      const fa = a.sim.stateView().fire;
      expect(a.sim.stats().burntAreaHa).toBeGreaterThan(20);
      expect(sameFire(fa, b.sim.stateView().fire)).toBe(true);
      expect(sameFire(fa, c.sim.stateView().fire)).toBe(true);
    }, 300000);
  }
});

describe('V22 coupled head (fast tier, 2 km line fire, flat, U10 20 km/h, M 8 %)', () => {
  it('steady head ROS with coupling 1 = coupling 0 ± 5 %; U_fireInd ≡ 0 with coupling 0 and inward at the front with 1', () => {
    const res: number[] = [];
    let inward = 0;
    let fronts = 0;
    for (const coupling of [0, 1]) {
      const s = synth({ extent: 6000, windKmh: 20, duration: 2 * 3600, ignitions: [line([[-2000, -1000], [-2000, 1000]])], options: { coupling } });
      const r = runSim(s, { until: 2 * 3600, moisturePct: 8, every: 1800 });
      const g = s.terrain.grid;
      const v = r.sim.stateView();
      res.push(rosAlong(g, v.fire.arrivalTime, -2000, 0, 90, 600, 1800));
      let ind = 0;
      for (let k = 0; k < v.fireIndU.length; k++) ind = Math.max(ind, Math.hypot(v.fireIndU[k]!, v.fireIndV[k]!));
      if (coupling === 0) expect(ind).toBe(0);
      else {
        // Front cells: the induced wind has a component against the outward normal (drawn into the fire).
        const a = v.aux;
        for (let q = 0; q < a.front.length; q++) {
          const k = a.front[q]!;
          const du = v.fireIndU[k]!;
          const dv = v.fireIndV[k]!;
          if (Math.hypot(du, dv) < 0.05) continue;
          fronts++;
          if (du * a.frontNormalX[k]! + dv * a.frontNormalY[k]! < 0) inward++; // normals are per cell
        }
        expect(kindsOf(r.insights).has('fire-induced-wind') || fronts > 0).toBe(true);
      }
    }
    log(`V22 fast: head ROS c0 ${(res[0]! * 3600).toFixed(0)} m/h, c1 ${(res[1]! * 3600).toFixed(0)} m/h (ratio ${(res[1]! / res[0]!).toFixed(3)}); inward induced wind on ${fronts ? ((100 * inward) / fronts).toFixed(0) : '—'} % of front cells`);
    expect(Math.abs(res[1]! / res[0]! - 1)).toBeLessThanOrEqual(0.05);
    expect(inward / Math.max(1, fronts)).toBeGreaterThan(0.6);
  }, 180000);

  // Regression (3-D tier, not a spec criterion): the resolved fire-induced flow at Δx_a ≈ 200 m accelerated the wind
  // ahead of the head (the heat injected in the lowest ~50 m is advected downwind before it rises, so the convergence
  // sits downwind of the front): 2.56 vs 1.54 km/h (+66 %). The resolved head correction (atmosphere
  // resolvedHeadCorrection: U_fireInd along the front normal removed at head cells) gives +1 %; the flanks and back
  // still see the resolved indraft.
  it.skipIf(!SLOW)('standard tier: coupled head ROS = uncoupled ± 5 %; resolved indraft kept off the head [SLOW]', () => {
    const res: number[] = [];
    let flank = 0;
    let flankIn = 0;
    let headAlong = 0;
    for (const coupling of [0, 1]) {
      const s = synth({ extent: 9000, windKmh: 20, temperature: 34, rh: 18, duration: 2 * 3600, ignitions: [line([[-4000, -1000], [-4000, 1000]])], options: { coupling } });
      const r = runSim(s, { tier: 'standard', until: 3600, every: 1800 });
      const v = r.sim.stateView();
      res.push(rosAlong(s.terrain.grid, v.fire.arrivalTime, -4000, 0, 90, 1000, 2500));
      if (coupling === 1) {
        const a = v.aux;
        for (let q = 0; q < a.front.length; q++) {
          const k = a.front[q]!;
          const du = v.fireIndU[k]!;
          const dv = v.fireIndV[k]!;
          const nX = a.frontNormalX[k]!;
          const nY = a.frontNormalY[k]!;
          const along = du * nX + dv * nY;
          if (nX > 0.9) headAlong = Math.max(headAlong, along); // head (wind from the west)
          else if (Math.abs(nX) < 0.5 && Math.hypot(du, dv) >= 0.05) {
            flank++;
            if (along < 0) flankIn++;
          }
        }
      }
    }
    log(`V22 standard: head ROS c0 ${(res[0]! * 3.6).toFixed(2)} km/h, c1 ${(res[1]! * 3.6).toFixed(2)} km/h; flank front cells with inward U_fireInd ${flankIn}/${flank}; aiding U_fireInd kept at the burning head (cards) up to ${headAlong.toFixed(2)} m/s`);
    expect(Math.abs(res[1]! / res[0]! - 1)).toBeLessThanOrEqual(0.05);
    expect(flank).toBeGreaterThan(0);
    expect(flankIn / flank).toBeGreaterThan(0.5);
  }, 600000);
});
