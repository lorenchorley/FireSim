/**
 * Reviewer tests of the moisture kernel (spec §5.2–§5.5) against an independent evaluation of the same chain with
 * the exact point functions (no tables, no inlining), plus physical validation (canopy, wind, cast shadow, night
 * long-wave), robustness (NaN winds / atmosphere T, empty burnt mask, wrong-size arrays, negative Δt) and
 * determinism. The kernel inlines ~10 table lookups per cell (fastMath.ts); a transcription slip there would pass
 * the scenario tests with plausible-looking numbers, so every cell of a hilly, mixed-fuel grid is re-derived here.
 */
import { describe, expect, it } from 'vitest';
import { FuelType, Landform, type FuelMap, type Terrain, type WeatherHour } from '../../core/types';
import type { InsolationResult, MoistureContext, StableNightState } from '../../core/simTypes';
import { dewPointC, esat, initialStableNight, lmstHour } from '../../core/physics';
import { buildTerrain, insolation, solarPosition, terrainDerived } from '../../terrain';
import { cone, plane, randomHills, testGrid } from '../../terrain/testing/synthetic';
import { FUEL_TYPES } from '../catalogue';
import { fuelParamsAt } from '../fuelMap';
import { afdrsMoisture } from './afdrs';
import { cellAir, lapseRate } from './air';
import { MOISTURE_TYPE_DEFAULTS } from './cellParams';
import {
  columnEmc,
  dewStore,
  dewTerm,
  droughtDamping,
  gullyKbdiFade,
  gullyOffsetBase,
  relaxMoisture,
  timeLagRatio,
} from './fuelPhysics';
import { MoistureModel, type MoistureCheckpoint } from './model';
import { MOISTURE_PARAMS } from './params';
import { diurnalSeries, lmstMs, uniformFuel } from './testing';

const H = 3.6e6;
const LON = 150.3;
const LAT = -33.7;

function makeTerrain(extent: number, cell: number, elev: (g: ReturnType<typeof testGrid>) => Float32Array): Terrain {
  const g = testGrid(extent, cell);
  return buildTerrain(g, elev(g), 'synthetic');
}

/** A mixed fuel map: types by k, CHM-like canopy cover varying cell to cell (CHM flag not set: LAI stays LAI_type). */
const mixedType = (k: number): FuelType =>
  [FuelType.DryForestShrubby, FuelType.WetForest, FuelType.Heath, FuelType.Grassland, FuelType.PinePlantation, FuelType.DryForestGrassy, FuelType.Rainforest][k % 7]!;
const mixedCover = (k: number): number => 0.05 + 0.9 * (((k * 7919) % 101) / 100);

/**
 * Independent evaluation of one 600 s update of cell k (spec §5.2–5.5) from the pre-step state `cp`, with the exact
 * functions of fuelPhysics.ts / afdrs.ts / air.ts. No rain in the series (R_mem = 0, MC2 = 0).
 */
function referenceCell(
  fuel: FuelMap,
  terrain: Terrain,
  derived: ReturnType<typeof terrainDerived>,
  k: number,
  w: WeatherHour,
  sun: InsolationResult,
  ctx: MoistureContext,
  cp: MoistureCheckpoint,
  zS: number,
): { m: number; mA: number; a: number; tF: number; tAir: number; rh: number } {
  const P = MOISTURE_PARAMS;
  const p = fuelParamsAt(fuel, k);
  const relief = Math.max(1, terrain.maxElevation - terrain.minElevation);
  const out = [0, 0];
  const td0 = w.dewPoint ?? dewPointC(w.temperature, w.relativeHumidity);
  cellAir(
    { tS: w.temperature, tdS: td0, zS, lapse: lapseRate(ctx.sunElevation, relief, w.boundaryLayerHeight), dTheta: ctx.night.dTheta, hInv: ctx.night.hInv, dewLapse: P.dewLapse },
    terrain.elevation[k]!,
    derived.heightAboveValley[k]!,
    out,
  );
  const [tAir, td] = out as [number, number];
  const rh = (100 * esat(td)) / esat(tAir);
  const mA = afdrsMoisture(p.moistureFamily, tAir, rh, ctx.lmstHour, ctx.month, ctx.cloudFrac, 0, 1000);
  const cover = Math.min(1, Math.max(0, p.cover));
  const ft = FUEL_TYPES[p.type];
  const laiRef = ft.canopyCover > 1e-3 ? (ft.lai * p.cRef) / ft.canopyCover : ft.lai;
  const u10 = ctx.u10[k]!;
  const uF = u10 / (P.uFDivisor * p.wrf);
  const h = ctx.sunElevation;
  const sinH = Math.sin((h * Math.PI) / 180);
  const cell = columnEmc({ tC: tAir, rh, direct: sun.direct[k]!, diffuse: Math.max(0, sun.total[k]! - sun.direct[k]!), cover, lai: p.lai, sunElevDeg: h, uF, cloudFrac: ctx.cloudFrac });
  const ref = columnEmc({ tC: tAir, rh, direct: h > 0 ? sun.dni * sinH : 0, diffuse: h > 0 ? sun.dhi : 0, cover: p.cRef, lai: laiRef, sunElevDeg: h, uF, cloudFrac: ctx.cloudFrac });
  const lf = terrain.landform[k];
  const vesta = p.family === 'vesta2';
  const g = vesta ? gullyOffsetBase(derived.tpiSmall[k]!, lf === Landform.Gully || lf === Landform.ValleyFloor) * gullyKbdiFade(ctx.kbdi) : 0;
  const a = (cell.e - ref.e) * droughtDamping(ctx.df) + g;
  const mEq = Math.max(P.mEqMin, mA + a);
  const m0 = cp.mLag[k]!;
  const fTau = timeLagRatio(cell.hF, u10 * 3.6, cell.tF, m0 < mEq);
  const mLag = relaxMoisture(m0, mEq, fTau, 600);
  const lDew = dewStore(cp.lDew[k]!, cell.tF, td, cell.sF, 600 / 3600);
  const mm = Math.min(P.mMax, Math.max(P.mMin, mLag + dewTerm(lDew) + p.moistureOffset));
  return { m: mm, mA, a, tF: cell.tF, tAir, rh };
}

function contextAt(terrain: Terrain, t: number, w: WeatherHour, night: StableNightState, u10: Float32Array): { ctx: MoistureContext; sun: InsolationResult } {
  const n = terrain.elevation.length;
  const sun = insolation(terrain, t, { cloudCover: w.cloudCover });
  const ctx: MoistureContext = {
    time: t,
    lmstHour: lmstHour(t, LON),
    month: new Date(t + (LON / 15) * H).getUTCMonth() + 1,
    sunElevation: solarPosition(t, LAT, LON).elevation,
    cloudFrac: (w.cloudCover ?? 0) / 100,
    u10,
    burnt: new Uint8Array(n),
    kbdi: 80,
    df: 8.8,
    night,
  };
  return { ctx, sun };
}

describe('kernel = exact §5.2–§5.5 chain, cell by cell', () => {
  const terrain = makeTerrain(2400, 30, (g) => randomHills(g, 11, 30, 300));
  const derived = terrainDerived(terrain);
  const n = terrain.elevation.length;
  const fuel = uniformFuel(terrain, mixedType, mixedCover);
  for (let k = 0; k < n; k += 97) fuel.moistureOffset![k] = 2.5; // some class/edit offsets
  const u10 = new Float32Array(n);
  for (let k = 0; k < n; k++) u10[k] = 0.3 + (k % 11) * 0.7;

  const cases: [string, number, { tMin: number; tMax: number; td: number }, number][] = [
    ['sunny afternoon, sub-calibration drought (15 Oct 14:20)', lmstMs(2026, 10, 15, 14.33), { tMin: 9, tMax: 27, td: 4 }, 1.6],
    ['clear humid night with dew and a 2 K cold pool (16 Oct 03:10)', lmstMs(2026, 10, 16, 3.17), { tMin: 9, tMax: 22, td: 8.5 }, 2],
    ['low morning sun (16 Oct 07:05)', lmstMs(2026, 10, 16, 7.08), { tMin: 9, tMax: 22, td: 6 }, 0.8],
  ];
  it.each(cases)('%s', (_name, t, shape, dTheta) => {
    const series = diurnalSeries(lmstMs(2026, 10, 8, 0), 9 * 24, { ...shape, uDay: 3, uNight: 1, cloud: 10, dir: 300 }, { lat: LAT, lon: LON }, 650);
    const m = new MoistureModel(terrain, fuel, derived);
    m.initialise(series, t - 600e3, { kbdi: 80, df: 8.8 }, initialStableNight(null));
    const cp = m.checkpoint();
    const w = series.hours.find((x) => x.time >= t)!;
    const wt: WeatherHour = { ...w, time: t };
    const night = { ...initialStableNight(null), dTheta: dTheta, sn: Math.min(1, dTheta / 3) };
    const { ctx, sun } = contextAt(terrain, t, wt, night, u10);
    m.update(wt, sun, 600, ctx);
    let worst = 0;
    let worstA = 0;
    let checked = 0;
    for (let k = 0; k < n; k++) {
      const r = referenceCell(fuel, terrain, derived, k, wt, sun, ctx, cp, 650);
      expect(Math.abs(m.airT[k]! - r.tAir)).toBeLessThan(1e-3);
      expect(Math.abs(m.airRH[k]! - r.rh)).toBeLessThan(2e-3);
      expect(Math.abs(m.fuelTemp[k]! - r.tF)).toBeLessThan(1e-3);
      expect(Math.abs(m.afdrs[k]! - r.mA)).toBeLessThan(1e-3);
      worstA = Math.max(worstA, Math.abs(m.anomaly[k]! - r.a));
      worst = Math.max(worst, Math.abs(m.field[k]! - r.m));
      checked++;
    }
    expect(checked).toBe(n);
    expect(worstA).toBeLessThan(2e-3);
    expect(worst).toBeLessThan(3e-3);
  });

  it('reference LAI is the catalogue density at c_ref (not the cell lai/cover ratio)', () => {
    // Uniform forest, cover varying 0.05–0.95, flat and open sky: the reference column must not depend on the cell,
    // so on flat ground the anomaly is a function of cover only through the CELL column (monotone in cover by day).
    const flat = makeTerrain(900, 30, (g) => plane(g, 0, 0, 650));
    const nf = flat.elevation.length;
    const f = uniformFuel(flat, FuelType.DryForestShrubby, mixedCover);
    const m = new MoistureModel(flat, f, terrainDerived(flat));
    const t = lmstMs(2026, 10, 15, 14);
    const series = diurnalSeries(lmstMs(2026, 10, 8, 0), 9 * 24, { tMin: 10, tMax: 26, td: 3, uDay: 3, uNight: 1, cloud: 0, dir: 300 }, { lat: LAT, lon: LON }, 650);
    m.initialise(series, t, { kbdi: 60, df: 7 }, initialStableNight(null));
    // A cell with c = c_ref = 0.6 has zero anomaly whatever the other cells are.
    const k06 = Array.from({ length: nf }, (_, k) => k).find((k) => Math.abs(mixedCover(k) - 0.6) < 0.005)!;
    expect(Math.abs(m.anomaly[k06]!)).toBeLessThan(0.03);
    // Anomaly increases with cover (more shade → cooler, wetter litter).
    const pairs = Array.from({ length: nf }, (_, k) => [mixedCover(k), m.anomaly[k]!] as const).sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < pairs.length; i++) if (pairs[i]![0] > pairs[i - 1]![0] + 1e-6) expect(pairs[i]![1]).toBeGreaterThanOrEqual(pairs[i - 1]![1] - 1e-4);
    expect(pairs[pairs.length - 1]![1] - pairs[0]![1]).toBeGreaterThan(1);
  });

  it('the local type table matches the fuel catalogue (family, cover, LAI, WRF, c_ref)', () => {
    for (const [t, d] of Object.entries(MOISTURE_TYPE_DEFAULTS)) {
      const f = FUEL_TYPES[Number(t) as FuelType];
      expect([d.family, d.moistureFamily, d.cover, d.lai, d.wrf, d.cRef]).toEqual([f.family, f.moistureFamily, f.canopyCover, f.lai, f.wrf, f.moistureRefCanopy]);
    }
  });
});

describe('physical validation of the anomaly (spec §5.4)', () => {
  const t14 = lmstMs(2026, 10, 15, 14);
  const t03 = lmstMs(2026, 10, 16, 3);
  const series = diurnalSeries(lmstMs(2026, 10, 8, 0), 9 * 24, { tMin: 8, tMax: 26, td: 5, uDay: 3, uNight: 0.5, cloud: 0, dir: 300 }, { lat: LAT, lon: LON }, 650);

  it('closed canopy litter is cooler and wetter than open litter by day; warmer and drier at night (long-wave)', () => {
    const flat = makeTerrain(600, 30, (g) => plane(g, 0, 0, 650));
    const run = (cover: number, t: number) => {
      const m = new MoistureModel(flat, uniformFuel(flat, FuelType.DryForestShrubby, cover), terrainDerived(flat));
      m.initialise(series, t, { kbdi: 60, df: 7 }, initialStableNight(null));
      return m;
    };
    const k = 110;
    const openDay = run(0.1, t14);
    const closedDay = run(0.95, t14);
    expect(openDay.fuelTemp[k]).toBeGreaterThan(closedDay.fuelTemp[k]! + 4);
    expect(closedDay.field[k]).toBeGreaterThan(openDay.field[k]! + 1);
    expect(openDay.afdrs[k]).toBeCloseTo(closedDay.afdrs[k]!, 6); // M_A is canopy-blind
    const openNight = run(0.1, t03);
    const closedNight = run(0.95, t03);
    expect(openNight.fuelTemp[k]).toBeLessThan(closedNight.fuelTemp[k]! - 1.5); // −(3(1 − c) + 0.5c) K
    expect(openNight.anomaly[k]).toBeGreaterThan(closedNight.anomaly[k]!);
  });

  it('CHM cover (share of pixels ≥ 2 m) is mapped onto the crown-cover scale: saturated forest = reference column', () => {
    // V8 root cause: a CHM cover of 1 (every forest cell of the demo sites) used as crown cover shaded every sunny
    // slope (+2 pp against AFDRS on flat ground) and CHM drop-outs on shaded slopes opened the gullies.
    const flat = makeTerrain(600, 30, (g) => plane(g, 0, 0, 650));
    const k = 110;
    const run = (type: FuelType, cover: number, chm: boolean) => {
      const resolve = (f: FuelMap, q: number) => ({ ...fuelParamsAt(f, q), coverFromChm: chm });
      const m = new MoistureModel(flat, uniformFuel(flat, type, cover), terrainDerived(flat), undefined, resolve);
      m.initialise(series, t14, { kbdi: 60, df: 7 }, initialStableNight(null));
      return m;
    };
    const chmFull = run(FuelType.DryForestShrubby, 1, true);
    const crownFull = run(FuelType.DryForestShrubby, 1, false);
    expect(Math.abs(chmFull.anomaly[k]!)).toBeLessThan(0.03); // c = c_type = c_ref: AFDRS parity on flat ground
    expect(crownFull.anomaly[k]).toBeGreaterThan(1); // a real crown cover of 1 still shades the litter
    // A CHM drop-out thins the canopy by at most 20 % (c = 0.8·c_type), far from the open-litter value.
    const chmGap = run(FuelType.DryForestShrubby, 0, true);
    const crownOpen = run(FuelType.DryForestShrubby, 0, false);
    expect(chmGap.anomaly[k]).toBeLessThan(0);
    expect(chmGap.anomaly[k]).toBeGreaterThan(-0.6);
    expect(crownOpen.anomaly[k]).toBeLessThan(chmGap.anomaly[k]! - 0.5);
    // Repainted to grass under a CHM canopy: open litter (c_type 0).
    expect(run(FuelType.Grassland, 1, true).fuelTemp[k]).toBeCloseTo(run(FuelType.Grassland, 0, false).fuelTemp[k]!, 6);
  });

  it('wind cools sunlit litter: a windier cell has a smaller fuel-temperature excess and less negative anomaly', () => {
    const R = 900;
    const terrain = makeTerrain(2400, 30, (g) => cone(g, R * Math.tan((30 * Math.PI) / 180), R, 0, 0, 500));
    const derived = terrainDerived(terrain);
    const n = terrain.elevation.length;
    const m = new MoistureModel(terrain, uniformFuel(terrain, FuelType.DryForestShrubby, 0.3), derived);
    m.initialise(series, t14 - 600e3, { kbdi: 60, df: 7 }, initialStableNight(null));
    const w = { ...series.hours.find((x) => x.time >= t14)!, time: t14 };
    const calm = new Float32Array(n).fill(0.5);
    const windy = new Float32Array(n).fill(10);
    const a = contextAt(terrain, t14, w, initialStableNight(null), calm);
    const cp = m.checkpoint();
    m.update(w, a.sun, 0, a.ctx);
    const tfCalm = m.fuelTemp.slice();
    const anCalm = m.anomaly.slice();
    m.restore(cp);
    m.update(w, a.sun, 0, { ...a.ctx, u10: windy });
    // NW-facing sunlit flank (aspect ≈ 300°, the afternoon sun azimuth).
    let nSel = 0;
    for (let k = 0; k < n; k++) {
      if (terrain.slopeDeg[k]! < 25 || Math.abs(((terrain.aspectDeg[k]! - 300 + 540) % 360) - 180) > 15) continue;
      nSel++;
      expect(tfCalm[k]! - m.airT[k]!).toBeGreaterThan(m.fuelTemp[k]! - m.airT[k]! + 3);
      expect(anCalm[k]!).toBeLessThan(m.anomaly[k]!);
    }
    expect(nSel).toBeGreaterThan(20);
  });

  it('a cell in cast shadow (no beam) is wetter than the same cell sunlit; flat open cell has A = 0 (AFDRS parity)', () => {
    const flat = makeTerrain(600, 30, (g) => plane(g, 0, 0, 650));
    const n = flat.elevation.length;
    const m = new MoistureModel(flat, uniformFuel(flat, FuelType.DryForestShrubby, 0.6), terrainDerived(flat));
    m.initialise(series, t14 - 600e3, { kbdi: 60, df: 7 }, initialStableNight(null));
    const w = { ...series.hours.find((x) => x.time >= t14)!, time: t14 };
    const { ctx, sun } = contextAt(flat, t14, w, initialStableNight(null), new Float32Array(n).fill(2));
    // Make one cell fully shaded (beam removed, diffuse kept): the shaded-gully case of §5.4.
    const k = 55;
    const shaded: InsolationResult = { ...sun, direct: sun.direct.slice(), total: sun.total.slice() };
    shaded.total[k] = sun.total[k]! - sun.direct[k]!;
    shaded.direct[k] = 0;
    // Hold the forcing for 8 h (48 updates) so M_lag relaxes to the new equilibrium (wetting τ = 2 h × f_τ, f_τ ≈ 2
    // for cool shaded litter).
    for (let i = 1; i <= 48; i++) m.update(w, shaded, 600, { ...ctx, time: t14 + i * 600e3 });
    expect(Math.abs(m.anomaly[k + 1]!)).toBeLessThan(0.05); // flat, open sky, c = c_ref
    expect(m.anomaly[k]!).toBeGreaterThan(1);
    expect(m.field[k]!).toBeGreaterThan(m.field[k + 1]! + 0.8 * m.anomaly[k]!);
  });
});

describe('robustness and determinism', () => {
  const terrain = makeTerrain(1500, 30, (g) => randomHills(g, 5, 15, 200));
  const derived = terrainDerived(terrain);
  const n = terrain.elevation.length;
  const fuel = uniformFuel(terrain, mixedType, mixedCover);
  const t0 = lmstMs(2026, 11, 20, 13);
  const series = diurnalSeries(t0 - 200 * H, 210, { tMin: 12, tMax: 31, td: 6, uDay: 5, uNight: 1.5, cloud: 10, dir: 300, rain: (t) => (Math.abs(t - (t0 - 20 * H)) < 1 ? 4 : 0) }, { lat: LAT, lon: LON }, 600);
  const w = { ...series.hours.find((x) => x.time >= t0 + 600e3)!, time: t0 + 600e3 };

  it('NaN per-cell wind or atmosphere T falls back (grid-point wind, lapse T) instead of collapsing M to 2 %', () => {
    const mk = () => {
      const m = new MoistureModel(terrain, fuel, derived);
      m.initialise(series, t0, { kbdi: 60, df: 8 }, initialStableNight(null));
      return m;
    };
    const u = new Float32Array(n).fill(w.windSpeed10);
    const { ctx, sun } = contextAt(terrain, t0 + 600e3, w, initialStableNight(null), u);
    const a = mk();
    a.update(w, sun, 600, ctx);
    const uNaN = u.slice();
    uNaN[17] = NaN;
    uNaN[18] = -1;
    const airT = new Float32Array(n).fill(NaN);
    const b = mk();
    b.update(w, sun, 600, { ...ctx, u10: uNaN, airT });
    for (let k = 0; k < n; k++) expect(Number.isFinite(b.field[k]!)).toBe(true);
    expect(b.field[17]).toBeCloseTo(a.field[17]!, 5);
    expect(b.field[18]).toBeCloseTo(a.field[18]!, 5);
    expect(Array.from(b.airT)).toEqual(Array.from(a.airT));
  });

  it('an empty burnt mask means no fire; wrong-size arrays throw; a negative Δt does not advance the state', () => {
    const m = new MoistureModel(terrain, fuel, derived);
    m.initialise(series, t0, { kbdi: 60, df: 8 }, initialStableNight(null));
    const { ctx, sun } = contextAt(terrain, t0 + 600e3, w, initialStableNight(null), new Float32Array(n).fill(3));
    const cp = m.checkpoint();
    m.update(w, sun, 600, ctx);
    const ref = m.field.slice();
    m.restore(cp);
    m.update(w, sun, 600, { ...ctx, burnt: new Uint8Array(0) });
    expect(Array.from(m.field)).toEqual(Array.from(ref));
    expect(() => m.update(w, sun, 600, { ...ctx, u10: new Float32Array(3) })).toThrow(/u10/);
    expect(() => m.update(w, { ...sun, direct: new Float32Array(3) }, 600, ctx)).toThrow(/insolation/);
    m.restore(cp);
    m.update(w, sun, -600, ctx);
    const after = m.checkpoint();
    expect(Array.from(after.mLag)).toEqual(Array.from(cp.mLag));
    for (const v of m.field) expect(Number.isFinite(v)).toBe(true);
  });

  it('is deterministic: two identical spin-ups and update runs are bitwise equal (all cells, incl. grid edges)', () => {
    const run = () => {
      const m = new MoistureModel(terrain, fuel, derived);
      m.initialise(series, t0, { kbdi: 60, df: 8 }, initialStableNight(null));
      const { ctx, sun } = contextAt(terrain, t0 + 600e3, w, initialStableNight(null), new Float32Array(n).fill(2.5));
      m.update(w, sun, 600, ctx);
      return m;
    };
    const a = run();
    const b = run();
    expect(Array.from(a.field)).toEqual(Array.from(b.field));
    expect(Array.from(a.anomaly)).toEqual(Array.from(b.anomaly));
    for (let k = 0; k < n; k++) {
      expect(Number.isFinite(a.field[k]!)).toBe(true);
      if (a.familyAt(k) !== 'none') {
        expect(a.field[k]).toBeGreaterThanOrEqual(2);
        expect(a.field[k]).toBeLessThanOrEqual(250);
      }
    }
  });
});
