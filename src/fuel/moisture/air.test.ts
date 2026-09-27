import { describe, expect, it } from 'vitest';
import { initialStableNight, rhFromTd, stableNight } from '../../core/physics';
import { cellAir, coldPoolTerm, isThermalBelt, lapseRate, type AirForcing } from './air';

describe('lapse rate Γ (D43)', () => {
  it('6.5 K/km at night and low sun, 9.8 K/km by day when the mixed layer spans the relief', () => {
    expect(lapseRate(-10, 450, 1500)).toBe(6.5);
    expect(lapseRate(4.9, 450, 1500)).toBe(6.5);
    expect(lapseRate(30, 450, 1500)).toBeCloseTo(9.8, 9);
    expect(lapseRate(30, 450, undefined)).toBeCloseTo(9.8, 9); // BLH ?? 1500 m
    expect(lapseRate(10, 450, 1500)).toBeCloseTo(6.5 + 3.3 * 0.5, 9); // smoothstep(5, 15, 10) = 0.5
    expect(lapseRate(30, 450, 200)).toBe(6.5); // shallow mixed layer (< 0.75·relief)
    expect(lapseRate(30, 450, 450)).toBeCloseTo(6.5 + 3.3 * 0.5, 9);
  });
  it("gives ≈ 1.5 K extra cooling across Katoomba's 450 m by day", () => {
    expect(((lapseRate(40, 450, 2000) - lapseRate(-5, 450, 2000)) * 450) / 1000).toBeCloseTo(1.485, 3);
  });
});

describe('cell air with the cold pool (spec §5.2)', () => {
  const f: AirForcing = { tS: 10, tdS: 5, zS: 700, lapse: 6.5, dTheta: 5, hInv: 150, dewLapse: 1.8 };
  const out = [0, 0];
  it('lapse correction from the grid-point elevation (not optional)', () => {
    cellAir({ ...f, dTheta: 0 }, 1000, 500, out);
    expect(out[0]).toBeCloseTo(10 - 6.5 * 0.3, 9);
    expect(out[1]).toBeCloseTo(5 - 1.8 * 0.3, 9);
  });
  it('valley floor is Δθ colder than the belt and keeps its moisture; the belt is the warmest night air', () => {
    const zFloor = 700;
    cellAir(f, zFloor, 0, out);
    const tValley = out[0]!;
    const tdValley = out[1]!;
    expect(tValley).toBeCloseTo(10 - (6.5 * 150) / 1000 - 5, 9); // sn = 1 (Δθ ≥ 3 K): the spec formula
    expect(tdValley).toBeLessThanOrEqual(tValley);
    cellAir(f, zFloor + 150, 150, out);
    const tBelt = out[0]!;
    const rhBelt = rhFromTd(out[0]!, out[1]!);
    cellAir(f, zFloor + 400, 400, out);
    const tRidge = out[0]!;
    expect(tBelt - tValley).toBeCloseTo(5, 9);
    expect(tBelt).toBeGreaterThan(tRidge);
    expect(rhFromTd(tValley, tdValley)).toBeGreaterThan(rhBelt + 20);
    expect(isThermalBelt(150, 150)).toBe(true);
    expect(isThermalBelt(10, 150)).toBe(false);
  });
  it('no stable night (Δθ = 0): no pool at all; weak pools fade the isothermal shift with sn = Δθ/3 K', () => {
    cellAir({ ...f, dTheta: 0 }, 700, 0, out);
    expect(out[0]).toBeCloseTo(10, 9);
    expect(coldPoolTerm({ ...f, dTheta: 0 }, 700, 0)).toBe(0);
    const weak = coldPoolTerm({ ...f, dTheta: 0.3 }, 700, 0); // sn = 0.1
    expect(weak).toBeCloseTo(-0.3 - 0.1 * 6.5 * 0.15, 9);
    expect(coldPoolTerm({ ...f, dTheta: 3 }, 700, 0)).toBeCloseTo(-3 - 6.5 * 0.15, 9);
  });

  it('cold-pool term changes by < 0.5 K per 600 s across sunrise and across U10 = 4 m/s (D49)', () => {
    const H = 3.6e6;
    // Across sunrise: Δθ from a calm night (≈ 5.9 K), Γ switching to 9.8 K/km with the rising sun.
    const tSr = 500 * H;
    const s = { ...initialStableNight({ dThetaMax: 6, hInv: 150 }), dTheta: 5.9 };
    const hs = [0, 30, 75, 120, 149];
    let prev: number[] | null = null;
    for (let t = tSr - 2 * H; t <= tSr + 5 * H; t += 600000) {
      const hss = (t - tSr) / H;
      const sunEl = hss * 12;
      stableNight(s, { time: t, sunElevation: sunEl, hoursSinceSunrise: hss >= 0 ? hss : hss + 24, u10: 1, cloudPct: 0, rain24: 0 }, 600);
      const g = lapseRate(sunEl, 450, 1500);
      const terms = hs.map((hav) => coldPoolTerm({ ...f, lapse: g, dTheta: s.dTheta, hInv: s.hInv }, 700 + hav, hav));
      if (prev) terms.forEach((v, i) => expect(Math.abs(v - prev![i]!)).toBeLessThan(0.5));
      prev = terms;
    }
    // Across U10 = 4 m/s at night (interpolated hourly stamps ramp 3 → 5 m/s).
    const n = { ...initialStableNight(null), dTheta: 4.5 };
    prev = null;
    for (let i = 0; i <= 12; i++) {
      const u10 = 3 + (2 * i) / 12;
      stableNight(n, { time: i * 600000, sunElevation: -20, hoursSinceSunrise: 16, u10, cloudPct: 0, rain24: 0 }, 600);
      const terms = hs.map((hav) => coldPoolTerm({ ...f, dTheta: n.dTheta, hInv: n.hInv }, 700 + hav, hav));
      if (prev) terms.forEach((v, j) => expect(Math.abs(v - prev![j]!)).toBeLessThan(0.5));
      prev = terms;
    }
  });
});
