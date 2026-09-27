/**
 * Safety overlays (spec §10.5, P1): Tobler walking speed vectors (§14), firefighter walking factors, the refuge rule
 * (4 × FH, IRPG doubling), and the dead-man zone sweep (shape under the post-change wind, non-fuel barriers,
 * ≤ 100 ms on a 90 000-cell fire grid).
 */
import { describe, expect, it } from 'vitest';
import { BurnState, FuelType } from '../core/types';
import { standaloneContext } from './context';
import { ffdi, mk5 } from './deps';
import { DmzComputer, refugeCheck, toblerKmh, walkingSpeedKmh } from './safety';
import { TestWorld } from './testing/simState';

describe('Tobler walking speed (spec §10.5 / §14 vectors)', () => {
  it.each([
    [0, 5.04],
    [-3, 5.95],
    [10, 2.72],
    [20, 1.41],
    [30, 0.67],
  ])('θ = %d° → %d km/h', (deg, v) => {
    expect(toblerKmh(deg)).toBeCloseTo(v, 2);
  });
  it('firefighter speed = Tobler × 0.6 off-track × 0.8 load; the fastest slope is about −2.9° (tan θ = −0.05)', () => {
    expect(walkingSpeedKmh(10)).toBeCloseTo(toblerKmh(10) * 0.48, 12);
    expect(walkingSpeedKmh(10, false, false)).toBeCloseTo(toblerKmh(10), 12);
    expect(toblerKmh((Math.atan(-0.05) * 180) / Math.PI)).toBeCloseTo(6, 12);
    // Walking uphill is always slower than a fire running uphill at 1 km/h on 20°?  (1.41 × 0.48 = 0.68 km/h)
    expect(walkingSpeedKmh(20)).toBeLessThan(1);
  });
});

describe('refuge rule (spec §10.5)', () => {
  it('clear distance ≥ 4 × flame height, doubling note above 11° approach slope or 16 km/h wind; never "you are safe"', () => {
    const a = refugeCheck(50, 10, 5, 10);
    expect(a.requiredM).toBe(40);
    expect(a.doubled).toBe(false);
    expect(a.ok).toBe(true);
    const b = refugeCheck(50, 10, 15, 10);
    expect(b.doubled).toBe(true);
    expect(b.ok).toBe(false);
    expect(refugeCheck(90, 10, 5, 20).ok).toBe(true);
    for (const r of [a, b]) expect(r.note).not.toMatch(/you are safe/i);
    expect(a.note).toContain('less exposed');
  });
});

describe('dead-man zone sweep (spec §10.5)', () => {
  function hotWorld(extentM = 9030): TestWorld {
    const w = new TestWorld({ extentM, temperature: 38, rh: 10, droughtFactor: 10, windSpeed: 30 / 3.6, windDir: 315 });
    w.igniteDisc(0, 0, 300);
    return w;
  }
  const change = (w: TestWorld) => ({ time: w.startMs + 30 * 60e3, toDir: 225, postSpeed: 50 / 3.6 });

  /** Furthest DMZ cell from the disc edge along azimuth az (m). */
  function extent(w: TestWorld, layer: Float32Array, az: number): number {
    const ux = Math.sin((az * Math.PI) / 180);
    const uy = Math.cos((az * Math.PI) / 180);
    let best = 0;
    for (let d = 300; d <= 2000; d += 10) {
      const k = w.cell(d * ux, d * uy);
      if (layer[k]! > 0) best = d - 300;
    }
    return best;
  }

  it('the zone runs downwind of the NEW wind at about the post-change head speed for 5 min; little upwind', () => {
    const w = hotWorld();
    const ctx = standaloneContext(w.view);
    const dmz = new DmzComputer(w.terrain, w.fuel);
    const r = dmz.compute(w.view, ctx.front, ctx.nFront, change(w));
    expect(r.cells).toBeGreaterThan(0);
    // Expected head run: Mk5 flat ROS (hot day, FFDI ≈ 100) × 5 min.
    const W = w.fuel.surfaceLoad[0]! + w.fuel.nearSurfaceLoad[0]! + w.fuel.elevatedLoad[0]!;
    const F = ffdi(38, 10, 50, 10);
    expect(F).toBeGreaterThan(90);
    const head = (mk5(F, W).rosMh / 3600) * 300;
    const ne = extent(w, r.layer, 45);
    const sw = extent(w, r.layer, 225);
    expect(ne).toBeGreaterThan(0.7 * head);
    expect(ne).toBeLessThan(1.6 * head + 60);
    expect(sw).toBeLessThanOrEqual(90);
    const se = extent(w, r.layer, 135);
    expect(ne).toBeGreaterThan(1.5 * se);
    // Layer values: 1 at the perimeter falling to ≥ 0.02 at 5 min; burnt cells excluded.
    let max = 0;
    for (let k = 0; k < w.N; k++) {
      const v = r.layer[k]!;
      if (v > 0) expect(w.view.fire.burnState[k]).toBe(BurnState.Unburnt);
      max = Math.max(max, v);
    }
    expect(max).toBeLessThanOrEqual(1);
    expect(max).toBeGreaterThan(0.8);
    expect(r.areaHa).toBeCloseTo((r.cells * 900) / 1e4, 9);
    // Centroid on the NE side.
    expect(r.x).toBeGreaterThan(0);
    expect(r.y).toBeGreaterThan(0);
  });

  it('a non-fuel strip stops the zone', () => {
    const w = hotWorld(6030);
    // 150 m rock band across the NE run, 330–480 m from the centre along 45°.
    w.forEach((k, x, y) => {
      const a = (x + y) / Math.SQRT2;
      if (a >= 330 && a <= 480) {
        w.fuel.type[k] = FuelType.NonFuel;
        w.view.fire.burnState[k] = BurnState.NonFlammable;
      }
    });
    const ctx = standaloneContext(w.view);
    const r = new DmzComputer(w.terrain, w.fuel).compute(w.view, ctx.front, ctx.nFront, change(w));
    w.forEach((k, x, y) => {
      if ((x + y) / Math.SQRT2 > 540) expect(r.layer[k]).toBe(0);
    });
    expect(r.cells).toBeGreaterThan(0);
  });

  it('a sim-injected rate-of-spread provider is used when given', () => {
    const w = hotWorld(6030);
    const ctx = standaloneContext(w.view);
    const r = new DmzComputer(w.terrain, w.fuel).compute(w.view, ctx.front, ctx.nFront, change(w), (_k, _u, to, out) => {
      out.rH = 2;
      out.rB = 2;
      out.rF = 2;
      out.e = to;
    });
    // Isotropic 2 m/s for 300 s → ≈ 600 m in every direction.
    const e = extent(w, r.layer, 90);
    expect(e).toBeGreaterThan(480);
    expect(e).toBeLessThan(760);
  });

  it('≤ 100 ms on a 90 000-cell fire grid (spec §10.5 budget)', () => {
    const w = hotWorld(9030);
    expect(w.N).toBeGreaterThanOrEqual(90000);
    const ctx = standaloneContext(w.view);
    const dmz = new DmzComputer(w.terrain, w.fuel);
    dmz.compute(w.view, ctx.front, ctx.nFront, change(w)); // warm-up
    const ms: number[] = [];
    for (let a = 0; a < 5; a++) {
      const t0 = performance.now();
      dmz.compute(w.view, ctx.front, ctx.nFront, change(w));
      ms.push(performance.now() - t0);
    }
    ms.sort((a, b) => a - b);
    expect(ms[2]!).toBeLessThan(100);
  });
});
