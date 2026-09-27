import { describe, expect, it } from 'vitest';
import { FireHistoryKind, FuelType } from '../core/types';
import { accumulate, evolve, makeCellHistory, makeFuelState, olson, postFireEligible, type CellHistory } from './accumulation';
import { resolveClass } from './catalogue';
import { FIRE_KIND_USER_BURN } from './history';
import { FUEL_PARAMS, resolveFuelParams, YEAR_MS } from './params';

const T0 = Date.UTC(2026, 8, 27);
function hist(recs: [yearsBeforeT0: number, kind: number][]): CellHistory {
  const h = makeCellHistory();
  h.n = recs.length;
  recs.forEach(([y, kind], q) => {
    h.tb[q] = T0 - y * YEAR_MS;
    h.kind[q] = kind;
  });
  return h;
}
const W = FireHistoryKind.Wildfire;
const PB = FireHistoryKind.PrescribedBurn;
const DSF = resolveClass(FuelType.DryForestShrubby);
const P = FUEL_PARAMS;

describe('Olson accumulation (spec §4.5 worked example)', () => {
  it('Sydney montane DSF surface (14.5 t/ha, k 0.17) after a wildfire', () => {
    const want: [number, number][] = [[1, 2.27], [2, 4.18], [5, 8.30], [10, 11.85], [20, 14.02]];
    for (const [t, x] of want) {
      expect(evolve(14.5, 0.17, 0.4, 0, hist([[t, W]]), T0)).toBeCloseTo(x, 2);
      expect(olson(14.5, 0, 0.17, t)).toBeCloseTo(x, 2);
    }
  });

  it('FHS_s (max 3.4) with the surface k', () => {
    const want: [number, number][] = [[1, 0.53], [2, 0.98], [5, 1.95], [10, 2.78], [20, 3.29]];
    for (const [t, x] of want) expect(evolve(3.4, 0.17, 0.4, 0, hist([[t, W]]), T0)).toBeCloseTo(x, 2);
  });

  it('a 2019-20 burn seen in late 2026 (6.8 yr) carries 9.94 t/ha (69 %)', () => {
    const x = evolve(14.5, 0.17, 0.4, 0, hist([[6.8, W]]), T0);
    expect(x).toBeCloseTo(9.94, 2);
    expect(x / 14.5).toBeCloseTo(0.69, 2);
  });

  it('no record = steady state (D40)', () => {
    expect(evolve(14.5, 0.17, 0.4, 0, hist([]), T0)).toBe(14.5);
  });

  it('prescribed burn from steady state, p = 0.6: 14.5 → 5.8 immediately, 8.31 after 2 yr', () => {
    expect(evolve(14.5, 0.17, 1 - P.patchiness, 0, hist([[0, PB]]), T0)).toBeCloseTo(5.8, 6);
    expect(evolve(14.5, 0.17, 1 - P.patchiness, 0, hist([[2, PB]]), T0)).toBeCloseTo(14.5 - 8.7 * Math.exp(-0.34), 6);
    expect(evolve(14.5, 0.17, 1 - P.patchiness, 0, hist([[2, PB]]), T0)).toBeCloseTo(8.31, 2);
  });

  it('residual form chains records: wildfire then prescribed burn', () => {
    // Wildfire 10 yr ago: 6 yr of recovery to the burn 4 yr ago, ×0.4, then 4 yr of Olson recovery from that residual.
    const x6 = olson(14.5, 0, 0.17, 6);
    const expected = olson(14.5, 0.4 * x6, 0.17, 4);
    expect(evolve(14.5, 0.17, 0.4, 0, hist([[10, W], [4, PB]]), T0)).toBeCloseTo(expected, 9);
  });

  it('unknown kind resets like a wildfire; user burn uses its own retention', () => {
    expect(evolve(10, 0.2, 0.4, 0.5, hist([[0, FireHistoryKind.Unknown]]), T0)).toBe(0);
    expect(evolve(10, 0.2, 0.4, 0.5, hist([[0, FIRE_KIND_USER_BURN]]), T0)).toBeCloseTo(5, 9);
  });
});

describe('accumulate() per layer (spec §4.5)', () => {
  it('prescribed burn: s/ns ×(1−p), el/bark ×(1−0.5p), canopy unchanged, hazards alike', () => {
    const st = accumulate(DSF, hist([[0, PB]]), T0, P, 0, makeFuelState());
    expect(st.s).toBeCloseTo(14.5 * 0.4, 6);
    expect(st.ns).toBeCloseTo(1.9 * 0.4, 6);
    expect(st.el).toBeCloseTo(4.9 * 0.7, 6);
    expect(st.b).toBeCloseTo(2.67 * 0.7, 6);
    expect(st.o).toBeCloseTo(3.5, 6);
    expect(st.fhsS).toBeCloseTo(3.4 * 0.4, 6);
    expect(st.fhsEl).toBeCloseTo(3.3 * 0.7, 6);
    expect(st.barkHazard).toBe(2); // 1.87 t/ha
    expect(st.lastKind).toBe(PB);
    expect(st.postFireW).toBe(0);
    expect(st.tsf).toBeCloseTo(0, 9);
  });

  it('steady state: bark 2.67 t/ha → bark hazard 3 (long-range spotting)', () => {
    const st = accumulate(DSF, hist([]), T0, P, 0, makeFuelState());
    expect(st.barkHazard).toBe(3);
    expect(Number.isNaN(st.tsf)).toBe(true);
  });

  it('post-fire regime: DSF shrubby 6.8 yr after a wildfire blends the shrub pulse (w = 0.5)', () => {
    const t = 6.8;
    const st = accumulate(DSF, hist([[t, W]]), T0, P, 0, makeFuelState());
    const w = 0.5;
    const std = (xss: number, k: number): number => xss * (1 - Math.exp(-k * t));
    expect(st.postFireW).toBe(w);
    expect(st.s).toBeCloseTo((1 - w) * std(14.5, 0.17) + w * std(14.5, 0.17 * 0.67), 6);
    expect(st.ns).toBeCloseTo((1 - w) * std(1.9, 0.17) + w * std(4 * 1.9, 0.45), 6);
    expect(st.el).toBeCloseTo((1 - w) * std(4.9, 0.2) + w * std(2.5 * 4.9, 0.45), 6);
    expect(st.b).toBeCloseTo((1 - w) * std(2.67, 0.1) + w * std(2.67, 0.02), 6);
    // More near-surface and elevated fuel than the standard curve: the post-fire thicket.
    expect(st.ns).toBeGreaterThan(std(1.9, 0.17));
    expect(st.el).toBeGreaterThan(std(4.9, 0.2));
    expect(st.fhsEl).toBeLessThanOrEqual(4);
  });

  it('post-fire regime only for eligible classes, wildfire last, 1 ≤ tsf ≤ 15; severity sets w', () => {
    expect(postFireEligible(DSF)).toBe(true);
    expect(postFireEligible(resolveClass(30))).toBe(true); // Montane WSF
    expect(postFireEligible(resolveClass(FuelType.WetForest))).toBe(false);
    expect(postFireEligible(resolveClass(FuelType.Heath))).toBe(false);
    const f = (recs: [number, number][], cls = DSF, sev = 0): number => accumulate(cls, hist(recs), T0, P, sev, makeFuelState()).postFireW;
    expect(f([[0.5, W]])).toBe(0);
    expect(f([[16, W]])).toBe(0);
    expect(f([[5, PB]])).toBe(0);
    expect(f([[5, W]], resolveClass(FuelType.Heath))).toBe(0);
    expect(f([[5, W]], DSF, 2)).toBe(1);
    expect(f([[5, W]], DSF, 1)).toBe(0);
    expect(f([[5, W]], resolveClass(FuelType.SnowGumWoodland))).toBe(0.5);
  });

  it('respects a custom patchiness', () => {
    const p2 = resolveFuelParams({ patchiness: 0.3 });
    const st = accumulate(DSF, hist([[0, PB]]), T0, p2, 0, makeFuelState());
    expect(st.s).toBeCloseTo(14.5 * 0.7, 6);
  });
});

describe('accumulation properties', () => {
  it('loads stay within [0, X_ss] and hazards within [0, 4] for random histories (no post-fire regime)', () => {
    let seed = 7;
    const rnd = (): number => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (const id of [13, 17, 25, 30, 31, 32, 33, 38, 39, 41, 46]) {
      const cls = resolveClass(id);
      for (let trial = 0; trial < 50; trial++) {
        const recs: [number, number][] = [];
        const nRec = Math.floor(rnd() * 6);
        for (let q = 0; q < nRec; q++) recs.push([rnd() * 40, rnd() < 0.5 ? W : PB]);
        recs.sort((a, b) => b[0] - a[0]);
        const st = accumulate(cls, hist(recs), T0, resolveFuelParams({ postFireWeightUnknownSeverity: 0 }), 0, makeFuelState());
        const pairs: [number, number][] = [[st.s, cls.surface.load], [st.ns, cls.nearSurface.load], [st.el, cls.elevated.load], [st.b, cls.bark.load], [st.o, cls.canopy.load]];
        for (const [x, ss] of pairs) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(ss + 1e-9);
        }
        for (const v of [st.fhsS, st.fhsNs, st.fhsEl, st.barkHazard]) expect(v >= 0 && v <= 4).toBe(true);
      }
    }
  });

  it('fuel grows monotonically with time since a wildfire', () => {
    let prev = -1;
    for (let t = 0; t <= 40; t += 0.5) {
      const st = accumulate(DSF, hist([[t, W]]), T0, P, 0, makeFuelState());
      expect(st.s).toBeGreaterThanOrEqual(prev);
      prev = st.s;
    }
  });
});
