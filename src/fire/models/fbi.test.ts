/** Spec §6.11 FBI tables (14 vectors), ratings, AFDRS-parity FBI (4 vectors, D41) and the §5.3 M_A adapter. */
import { describe, expect, it } from 'vitest';
import { rhFromTd } from '../../core/physics';
import { FuelType, type WeatherHour } from '../../core/types';
import { afdrsMoistureFor as afdrsMoistureLocal, setAfdrsMoistureProvider } from './afdrsMoisture';
import { afdrsFbi, FBI_TABLES_FBITG, FBI_TABLES_PYROXL_2024, fbiFromMetric, fbiTableFor, fireDangerRating, ratingFromFbi } from './fbi';
import { expectVector } from './testUtil';

describe('FBI tables (spec §6.11)', () => {
  const T = FBI_TABLES_FBITG;
  it('forest 5000 → 28; 99 → 5; 100 → 6; 15 000 → 62; 30 000 → 100; 40 000 → 116; 90 000 → 200', () => {
    expect([5000, 99, 100, 15000, 30000, 40000, 90000].map((i) => fbiFromMetric(i, T.forest))).toEqual([28, 5, 6, 62, 100, 116, 200]);
  });
  it('grass 2500 → 12; grass 25 000 → 100; shrub 3000 → 20; savanna 2000 → 8, 10 000 → 28, 20 000 → 66', () => {
    expect(fbiFromMetric(2500, T.grass)).toBe(12);
    expect(fbiFromMetric(25000, T.grass)).toBe(100);
    expect(fbiFromMetric(3000, T.shrub)).toBe(20);
    expect([2000, 10000, 20000].map((i) => fbiFromMetric(i, T.savanna))).toEqual([8, 28, 66]);
  });
  it('extrapolates linearly beyond 90 000 kW/m; 0 for no fire; PyroXL grass variant rates 2500 kW/m at 10', () => {
    expect(fbiFromMetric(150000, T.forest)).toBe(300);
    expect(fbiFromMetric(0, T.forest)).toBe(0);
    expect(fbiFromMetric(-5, T.grass)).toBe(0);
    expect(fbiFromMetric(2500, FBI_TABLES_PYROXL_2024.grass)).toBe(10);
    expect(FBI_TABLES_PYROXL_2024.shrub.metric).toBe('ros');
  });
  it('FBI is non-decreasing in the metric for every table', () => {
    for (const t of [...Object.values(FBI_TABLES_FBITG), ...Object.values(FBI_TABLES_PYROXL_2024)]) {
      let prev = 0;
      for (let m = 0; m < 120000; m += 37) {
        const f = fbiFromMetric(m, t);
        expect(f).toBeGreaterThanOrEqual(prev);
        prev = f;
      }
    }
  });
  it('ratings and colours', () => {
    expect([0, 11, 12, 23, 24, 49, 50, 99, 100, 250].map(ratingFromFbi)).toEqual([
      'No rating', 'No rating', 'Moderate', 'Moderate', 'High', 'High', 'Extreme', 'Extreme', 'Catastrophic', 'Catastrophic',
    ]);
    expect(fireDangerRating(5)).toEqual({ rating: 'No rating', colour: '#ffffff', border: '#e0e0e0' });
    expect(fireDangerRating(60).colour).toBe('#f78100');
  });
  it('table per fuel (spec §6.1): forest, grass, savanna, shrub', () => {
    expect(fbiTableFor(FuelType.DryForestShrubby)).toBe('forest');
    expect(fbiTableFor(FuelType.PinePlantation)).toBe('forest');
    expect(fbiTableFor(FuelType.Grassland)).toBe('grass');
    expect(fbiTableFor(FuelType.GrassyWoodland)).toBe('savanna');
    expect(fbiTableFor(FuelType.Urban)).toBe('savanna');
    expect(fbiTableFor(FuelType.AlpineHeathGrass, 35)).toBe('savanna');
    expect(fbiTableFor(FuelType.Grassland, 48)).toBe('savanna');
    expect(fbiTableFor(FuelType.AlpineHeathGrass, 39)).toBe('grass');
    expect(fbiTableFor(FuelType.AlpineHeathGrass)).toBe('shrub');
    expect(fbiTableFor(FuelType.Heath)).toBe('shrub');
    expect(fbiTableFor(FuelType.NonFuel)).toBeNull();
  });
});

describe('AFDRS-equivalent moisture M_A used by the parity path (spec §5.3 vectors)', () => {
  it('vectors (T, RH → forest P1/P2/P3, grass, heath MC1, pine)', () => {
    const rows: [number, number, string[]][] = [
      [15, 80, ['12.40', '16.45', '18.20', '17.55', '18.25', '13.53']],
      [25, 40, ['7.25', '9.24', '9.79', '9.98', '9.73', '8.57']],
      [30, 20, ['4.68', '5.63', '5.59', '6.19', '6.55', '6.09']],
      [40, 10, ['3.25', '3.49', '3.13', '5.00', '4.21', '4.69']],
    ];
    for (const [t, rh, v] of rows) {
      expectVector(afdrsMoistureLocal('forest', t, rh, 14, 12, 0, 0, 48), v[0]!);
      expectVector(afdrsMoistureLocal('forest', t, rh, 10, 12, 0, 0, 48), v[1]!);
      expectVector(afdrsMoistureLocal('forest', t, rh, 22, 12, 0, 0, 48), v[2]!);
      expectVector(afdrsMoistureLocal('grass', t, rh, 14, 12, 0, 0, 48), v[3]!);
      expectVector(afdrsMoistureLocal('heath', t, rh, 14, 12, 0, 0, 48), v[4]!);
      expectVector(afdrsMoistureLocal('pine', t, rh, 14, 12, 0, 0, 48), v[5]!);
    }
  });
  it('MC2(1 mm, 12 h) = 22.93; MC2(1 mm, 24 h) = 8.19; period 16:59 LMST in October → 1, 17:00 → 2', () => {
    const mc1 = afdrsMoistureLocal('heath', 25, 40, 14, 12, 0, 0, 48);
    expectVector(afdrsMoistureLocal('heath', 25, 40, 14, 12, 0, 1, 12) - mc1, '22.93');
    expectVector(afdrsMoistureLocal('heath', 25, 40, 14, 12, 0, 1, 24) - mc1, '8.19');
    expectVector(afdrsMoistureLocal('forest', 25, 40, 16 + 59 / 60, 10, 0, 0, 48), '7.25');
    expectVector(afdrsMoistureLocal('forest', 25, 40, 17, 10, 0, 0, 48), '9.24');
    // No period 1 in winter, with cloud ≥ 60 %, or in wet forest.
    expectVector(afdrsMoistureLocal('forest', 25, 40, 14, 6, 0, 0, 48), '9.24');
    expectVector(afdrsMoistureLocal('forest', 25, 40, 14, 12, 0.7, 0, 48), '9.24');
    expectVector(afdrsMoistureLocal('wetForest', 25, 40, 14, 12, 0, 0, 48), '9.24');
    expectVector(afdrsMoistureLocal('wetForest', 25, 40, 3, 12, 0, 0, 48), '9.79');
  });
});

describe('AFDRS-parity FBI (spec §6.11, D41)', () => {
  const LON = 150.3;
  // 20 Dec 15:00 LMST at 150.3° E = 05:00 UTC − 1.2 min.
  const lmstToUtc = (y: number, mo: number, d: number, hLmst: number): number => Date.UTC(y, mo - 1, d, 0, 0, 0) + (hLmst - LON / 15) * 3.6e6;
  const hour = (t: number, tC: number, td: number, u: number): WeatherHour => ({
    time: t, temperature: tC, relativeHumidity: rhFromTd(tC, td), dewPoint: td, windSpeed10: u, windDir10: 315, cloudCover: 0,
  });
  it('DryForestShrubby 36 °C / T_d 2 / 11 m/s / DF 9 (period 1) → ROS 2360, I 20 359, FBI 75 (Extreme)', () => {
    const r = afdrsFbi(FuelType.DryForestShrubby, hour(lmstToUtc(2026, 12, 20, 15), 36, 2, 11), LON, 9, 50);
    expectVector(r.ros, 2360, 1);
    expectVector(r.intensity, 20359, 1);
    expect(r.fbi).toBe(75);
    expect(r.rating).toBe('Extreme');
  });
  it('42 / −3 / 15 m/s / DF 10 → I 35 785, FBI 109', () => {
    const r = afdrsFbi(FuelType.DryForestShrubby, hour(lmstToUtc(2026, 12, 20, 15), 42, -3, 15), LON, 10, 50);
    expectVector(r.intensity, 35785, 1);
    expect(r.fbi).toBe(109);
    expect(r.rating).toBe('Catastrophic');
  });
  it('20 / 7.7 / 4 m/s / DF 6 → I 826, FBI 12', () => {
    const r = afdrsFbi(FuelType.DryForestShrubby, hour(lmstToUtc(2026, 12, 20, 15), 20, 7.7, 4), LON, 6, 50);
    expectVector(r.intensity, 826, 1);
    expect(r.fbi).toBe(12);
  });
  it('21:00 LMST (period 3) 21 °C, T_d 6, 2 m/s, DF 7 → FBI 7', () => {
    const r = afdrsFbi(FuelType.DryForestShrubby, hour(lmstToUtc(2026, 12, 20, 21), 21, 6, 2), LON, 7, 50);
    expect(r.fbi).toBe(7);
  });
  it('the other table variant is reported (grass 2500 kW/m: Moderate on FBI-TG, No rating on PyroXL)', () => {
    const w = hour(lmstToUtc(2026, 12, 20, 15), 36, 2, 11);
    const r = afdrsFbi(FuelType.DryForestShrubby, w, LON, 9, 50);
    expect(r.fbiVariant).toBe(r.fbi); // forest tables are identical
    expect(r.ratingDiffers).toBe(false);
    const g = afdrsFbi(FuelType.Grassland, { ...w, windSpeed10: 2, temperature: 22, relativeHumidity: 50 }, LON, 5, 50);
    expect(g.fbiVariant).toBeLessThanOrEqual(g.fbi);
  });
  it('grass, heath, pine and none run their parity model; a moisture provider can be injected', () => {
    const w = hour(lmstToUtc(2026, 12, 20, 15), 36, 2, 11);
    const g = afdrsFbi(FuelType.Grassland, w, LON, 9, 50);
    expect(g.table).toBe('grass');
    expect(g.fbi).toBeGreaterThan(20);
    const h = afdrsFbi(FuelType.Heath, w, LON, 9, 50);
    expect(h.table).toBe('shrub');
    expect(h.fbi).toBeGreaterThan(24);
    const p = afdrsFbi(FuelType.PinePlantation, w, LON, 9, 150);
    expect(p.table).toBe('forest');
    expect(p.intensity).toBeGreaterThan(1000);
    expect(afdrsFbi(FuelType.Water, w, LON, 9, 50).fbi).toBe(0);
    setAfdrsMoistureProvider(() => 30);
    try {
      expect(afdrsFbi(FuelType.DryForestShrubby, w, LON, 9, 50).fbi).toBe(0);
    } finally {
      setAfdrsMoistureProvider(null);
    }
    expect(afdrsFbi(FuelType.DryForestShrubby, w, LON, 9, 50).fbi).toBe(75);
  });
});
