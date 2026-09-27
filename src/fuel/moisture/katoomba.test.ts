/**
 * Demo-terrain validation and performance of the moisture model on the bundled Katoomba 10 m LiDAR DTM,
 * block-resampled to the 30 m fire grid (9 km, 300 × 300 = 90k cells): V8 (spec §15) and the §13 budgets.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { FuelType, Landform, type Terrain } from '../../core/types';
import { loadElevation } from '../../data';
import { DEMO_SITES } from '../../data/demoSites';
import { buildTerrain, insolation, terrainDerived, type TerrainDerived } from '../../terrain';
import { medianOf } from './air';
import { MoistureModel } from './model';
import { spinUpStableNight } from './night';
import { diurnalSeries, lmstMs, meanWhere, runModel, uniformFuel } from './testing';

const H = 3.6e6;
const site = DEMO_SITES.find((s) => s.id === 'katoomba')!;
let terrain: Terrain;
let derived: TerrainDerived;
let zMed: number;

beforeAll(async () => {
  const el = await loadElevation({ centre: site.centre, extent: 9000, cellSize: 30, cache: null, offline: true });
  terrain = buildTerrain(el.grid, el.elevation, el.source);
  derived = terrainDerived(terrain);
  zMed = medianOf(terrain.elevation);
}, 60000);

const inAz = (a: number, lo: number, hi: number): boolean => (lo <= hi ? a >= lo && a <= hi : a >= lo || a <= hi);

describe('Katoomba demo (V8, spec §15)', () => {
  it('mild-spring 15 Oct 14:00: S/SE-facing gully cells ≥ N/NW slopes + 2 pp', () => {
    const loc = { lat: site.centre.lat, lon: site.centre.lon };
    const series = diurnalSeries(lmstMs(2026, 10, 7, 0, loc.lon), 9 * 24, { tMin: 8, tMax: 20, td: 7.7, uDay: 4.5, uNight: 1.5, cloud: 20, dir: 130 }, loc, zMed);
    const fuel = uniformFuel(terrain, FuelType.DryForestShrubby, 0.6);
    const m = new MoistureModel(terrain, fuel, derived);
    const t0 = lmstMs(2026, 10, 15, 14, loc.lon);
    const t = performance.now();
    m.initialise(series, t0, { kbdi: 60, df: 8 }, spinUpStableNight(series, t0));
    const spin = performance.now() - t;
    const asp = terrain.aspectDeg;
    const lf = terrain.landform;
    const gully = meanWhere(m.field, (k) => lf[k] === Landform.Gully && inAz(asp[k]!, 135, 225));
    const nnw = meanWhere(m.field, (k) => terrain.slopeDeg[k]! >= 10 && lf[k] !== Landform.Gully && lf[k] !== Landform.ValleyFloor && inAz(asp[k]!, 292.5, 22.5));
    expect(gully.n).toBeGreaterThan(100);
    expect(nnw.n).toBeGreaterThan(1000);
    expect(gully.mean).toBeGreaterThanOrEqual(nnw.mean + 2);
    // Sanity: M in the plausible range of a mild spring afternoon (M_A ≈ 8 %).
    const all = meanWhere(m.field, () => true).mean;
    expect(all).toBeGreaterThan(5);
    expect(all).toBeLessThan(16);
    // §13 / §5.6: spin-up (LUT + 48 h per cell, 90k cells) ≤ 1.5 s on a phone ≈ 0.75 s on x86 Node (2× slower phone).
    process.env.MOISTURE_PERF_LOG && process.stdout.write(`moisture spin-up 90k cells: ${spin.toFixed(0)} ms\n`);
    expect(spin).toBeLessThan(1500);
  });

  it('calm-night preset 16 Mar 05:00: thermal-belt cells ≥ 3 pp drier than the valley floor', () => {
    const loc = { lat: site.centre.lat, lon: site.centre.lon };
    const series = diurnalSeries(lmstMs(2026, 3, 8, 0, loc.lon), 9 * 24, { tMin: 8, tMax: 24, td: 6, uDay: 2, uNight: 1.5, cloud: 0, dir: 270 }, loc, zMed, { dThetaMax: 6, hInv: 150 });
    const m = new MoistureModel(terrain, uniformFuel(terrain, FuelType.DryForestShrubby, 0.6), derived);
    const t0 = lmstMs(2026, 3, 16, 5, loc.lon);
    m.initialise(series, t0, { kbdi: 60, df: 7 }, spinUpStableNight(series, t0));
    const hav = derived.heightAboveValley;
    const floor = meanWhere(m.field, (k) => hav[k]! < 15);
    const belt = meanWhere(m.field, (k) => Math.abs(hav[k]! - 150) <= 75);
    expect(floor.n).toBeGreaterThan(500);
    expect(belt.n).toBeGreaterThan(5000);
    expect(floor.mean - belt.mean).toBeGreaterThanOrEqual(3);
  });

  it('performance: one 600 s update (moisture + insolation) on 90k cells within the §13 budget', () => {
    const loc = { lat: site.centre.lat, lon: site.centre.lon };
    const series = diurnalSeries(lmstMs(2026, 10, 7, 0, loc.lon), 9 * 24, { tMin: 8, tMax: 20, td: 7.7, uDay: 4.5, uNight: 1.5, cloud: 20, dir: 130 }, loc, zMed);
    const m = new MoistureModel(terrain, uniformFuel(terrain, FuelType.DryForestShrubby, 0.6), derived);
    const t0 = lmstMs(2026, 10, 15, 11, loc.lon);
    const night = spinUpStableNight(series, t0);
    m.initialise(series, t0, { kbdi: 60, df: 8 }, night);
    // Warm up, then time 12 updates (2 h) including insolation.
    runModel(m, terrain, series, night, t0, t0 + 2 * H, { kbdi: 60, df: 8 });
    const t = performance.now();
    runModel(m, terrain, series, night, t0 + 2 * H, t0 + 4 * H, { kbdi: 60, df: 8 });
    const per = (performance.now() - t) / 12;
    // Kernel alone.
    const sun = insolation(terrain, t0 + 4 * H, { cloudCover: 20 });
    const ctx = { time: t0 + 4 * H, lmstHour: 15, month: 10, sunElevation: sun.sunElevation, cloudFrac: 0.2, u10: new Float32Array(terrain.elevation.length).fill(3), burnt: new Uint8Array(terrain.elevation.length), kbdi: 60, df: 8, night };
    const w = series.hours[series.hours.length - 60]!;
    const tk = performance.now();
    for (let i = 0; i < 10; i++) m.update(w, sun, 600, ctx);
    const kernel = (performance.now() - tk) / 10;
    process.env.MOISTURE_PERF_LOG && process.stdout.write(`moisture update 90k: ${per.toFixed(1)} ms incl. insolation, kernel ${kernel.toFixed(1)} ms\n`);
    expect(per).toBeLessThan(40); // phone budget 10–20 ms ≈ 5–10 ms on Node; generous CI bound
    expect(kernel).toBeLessThan(25);
  });
});
