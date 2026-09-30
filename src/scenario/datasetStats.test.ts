/**
 * Data-set statistics (datasetStats.ts) on synthetic grids with known answers, the histogram helpers against exact
 * sorting, and the time budget (< 30 ms per data set on a 300 x 300 grid).
 */
import { describe, expect, it } from 'vitest';
import { makeGridSpec } from '../core/grid';
import { FireHistoryKind, FuelType, type FuelMap, type WeatherHour, type WeatherSeries } from '../core/types';
import { uniformFuel } from '../fire/spread/testing';
import { buildTerrain } from '../terrain/analysis';
import { binShares, canopyStats, fireHistoryStats, fuelStats, Hist, moistureStats, terrainStats, vegetationStats, weatherStats } from './datasetStats';

const ORIGIN = { lat: -33.7, lon: 150.3 };

function plane(n: number, cell: number, slopeDeg: number) {
  const g = makeGridSpec(ORIGIN, n * cell, cell);
  const tan = Math.tan((slopeDeg * Math.PI) / 180);
  const z = new Float32Array(g.nx * g.ny);
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) z[j * g.nx + i] = 500 + (g.x0 + i * cell) * tan;
  return buildTerrain(g, z, 'plane');
}

describe('histogram helpers', () => {
  it('Hist quantiles are within one bin of the exact sorted quantiles', () => {
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const xs = Array.from({ length: 20_000 }, () => 90 * rnd() ** 2);
    const h = new Hist(0, 0.25, 400);
    for (const x of xs) h.add(x);
    h.add(NaN);
    h.add(Infinity);
    expect(h.total).toBe(xs.length);
    const sorted = [...xs].sort((a, b) => a - b);
    for (const p of [0.1, 0.5, 0.9, 0.99]) expect(Math.abs(h.quantile(p) - sorted[Math.floor(p * (sorted.length - 1))]!)).toBeLessThan(0.25);
    expect(h.mean).toBeCloseTo(xs.reduce((a, b) => a + b, 0) / xs.length, 6);
    expect(h.shareAbove(45)).toBeCloseTo(xs.filter((x) => x >= 45).length / xs.length, 2);
  });
  it('binShares adds up to 1, has one more edge than bins, skips NaN and honours the mask', () => {
    const v = Float32Array.from([1, 2, 3, 4, NaN, 100]);
    const b = binShares(v, 0, 10, 5);
    expect(b.edges).toHaveLength(6);
    expect(b.count).toBe(5);
    expect(b.shares.reduce((a, x) => a + x, 0)).toBeCloseTo(1, 4);
    expect(b.shares[4]).toBeCloseTo(0.2, 5); // 100 clamps into the last bin
    expect(binShares(v, 0, 10, 5, Uint8Array.from([1, 0, 0, 0, 0, 0])).count).toBe(1);
  });
});

describe('terrain', () => {
  it('a 22° plane: median and 90th percentile 22°, everything steeper than 20°, nothing steeper than 25°', () => {
    const t = plane(100, 30, 22);
    const r = terrainStats(t);
    expect(r.facts.medianSlopeDeg).toBeCloseTo(22, 0);
    expect(r.facts.p90SlopeDeg).toBeCloseTo(22, 0);
    expect(r.facts.shareSteeper20).toBeGreaterThan(0.97);
    expect(r.facts.shareSteeper25).toBe(0);
    expect(r.facts.relief).toBeCloseTo(99 * 30 * Math.tan((22 * Math.PI) / 180), -1);
    expect(r.facts.flatShare).toBe(0);
    expect(r.distribution!.values.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 4);
    expect(r.stats.find((s) => s.label === 'Ground steeper than 25°')!.value).toBe('0 %');
  });
  it('flat ground: no slope, every cell flat, one height', () => {
    const r = terrainStats(plane(50, 30, 0));
    expect(r.facts.medianSlopeDeg).toBe(0);
    expect(r.facts.flatShare).toBe(1);
    expect(r.facts.relief).toBe(0);
    for (const s of r.stats) expect(s.value).not.toMatch(/NaN|undefined/);
  });
});

describe('fuel, vegetation, canopy, fire history', () => {
  const g = makeGridSpec(ORIGIN, 3000, 30);
  const n = g.nx * g.ny;
  const fuel = (): FuelMap => uniformFuel(g, FuelType.DryForestShrubby);

  it('a uniform fuel map: one type, the right share', () => {
    const r = fuelStats(fuel());
    expect(r.facts.typeShares[FuelType.DryForestShrubby]).toBe(1);
    expect(r.facts.nonFuelShare).toBe(0);
    expect(vegetationStats(fuel()).stats.length).toBeGreaterThan(0);
  });

  it('canopy: percentiles of a known ramp', () => {
    const f = fuel();
    for (let k = 0; k < n; k++) {
      f.canopyHeight[k] = (40 * k) / (n - 1);
      f.canopyCover[k] = 0.5;
    }
    const r = canopyStats(f);
    expect(r.facts.p50).toBeCloseTo(20, 0);
    expect(r.facts.p90).toBeCloseTo(36, 0);
    expect(r.facts.shareOver30).toBeCloseTo(0.25, 2);
    for (const st of r.stats) expect(st.value).not.toMatch(/NaN|undefined/);
    expect(r.facts.meanCover).toBeCloseTo(0.5, 3);
  });

  it('fire history: half unrecorded, a quarter burnt 3 years ago by a wildfire, a quarter 30 years ago by a burn', () => {
    const f = fuel();
    for (let k = 0; k < n; k++) {
      const q = k % 4;
      f.timeSinceFire[k] = q < 2 ? NaN : q === 2 ? 3 : 30;
      f.lastFireKind[k] = q === 2 ? FireHistoryKind.Wildfire : q === 3 ? FireHistoryKind.PrescribedBurn : 0;
    }
    const r = fireHistoryStats(f, { rawFeatures: 2, verDate: Date.UTC(2026, 8, 7) });
    expect(r.facts.noRecordShare).toBe(0.5);
    expect(r.facts.burntUnder5Share).toBe(0.25);
    expect(r.facts.burntUnder10Share).toBe(0.25);
    expect(r.facts.wildfireShare).toBe(0.25);
    expect(r.facts.prescribedShare).toBe(0.25);
    expect(r.facts.medianYearsSinceFire).toBeGreaterThanOrEqual(3);
    expect(r.facts.medianYearsSinceFire).toBeLessThanOrEqual(30);
    expect(r.stats.find((s) => s.label === 'Data current to')!.value).toBe('2026-09-07');
  });
});

describe('weather and moisture', () => {
  it('ranges over the simulated window only, and the spin-up hours before it', () => {
    const t0 = Date.UTC(2026, 0, 10, 2);
    const hours: WeatherHour[] = [];
    for (let h = -72; h <= 6; h++) hours.push({ time: t0 + h * 3.6e6, temperature: h < 0 ? 10 : 30 + h, relativeHumidity: h < 0 ? 90 : 20 - h, windSpeed10: 10, windDir10: 300, cloudCover: 20, precipitation: h === -5 ? 4 : 0 });
    const s: WeatherSeries = { kind: 'forecast', source: 'test', location: ORIGIN, timezone: 'Australia/Sydney', hours, droughtFactor: 9 };
    const r = weatherStats(s, t0, 4 * 3600);
    expect(r.facts.tMin).toBe(30);
    expect(r.facts.tMax).toBe(34);
    expect(r.facts.rhMin).toBe(16);
    expect(r.facts.hoursBeforeStart).toBe(72);
    expect(r.facts.hoursAfterStart).toBe(6); // weather available from the start on: the 4 h run and its tail
    expect(r.facts.rainTotalMm).toBe(0);
    expect(r.facts.windMeanKmh).toBeCloseTo(36, 1);
    expect(r.facts.peakFfdi).toBeGreaterThan(30);
  });
  it('moisture shares', () => {
    const m = Float32Array.from({ length: 100 }, (_, i) => i / 2); // 0 to 49.5 %
    const r = moistureStats(m);
    expect(r.facts.shareUnder6).toBe(0.12);
    expect(r.facts.shareOver20).toBe(0.59);
    expect(r.facts.median).toBeCloseTo(25, 0);
  });
});

describe('time budget', () => {
  it('each data set of a 300 x 300 grid in under 30 ms (best of 3)', () => {
    const t = plane(300, 30, 18);
    const f = uniformFuel(t.grid, FuelType.DryForestShrubby);
    for (let k = 0; k < f.timeSinceFire.length; k++) f.timeSinceFire[k] = k % 7;
    const best = (fn: () => unknown): number => {
      let b = Infinity;
      for (let i = 0; i < 3; i++) {
        const t0 = performance.now();
        fn();
        b = Math.min(b, performance.now() - t0);
      }
      return b;
    };
    const times = {
      terrain: best(() => terrainStats(t)),
      fuel: best(() => fuelStats(f)),
      vegetation: best(() => vegetationStats(f)),
      canopy: best(() => canopyStats(f)),
      fireHistory: best(() => fireHistoryStats(f)),
      moisture: best(() => moistureStats(f.surfaceLoad)),
    };
    for (const [k, ms] of Object.entries(times)) expect(ms, `${k} took ${ms.toFixed(1)} ms`).toBeLessThan(30);
  });
});
