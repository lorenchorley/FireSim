import { describe, expect, it } from 'vitest';
import { FuelType, Landform, type Terrain } from '../../core/types';
import { initialStableNight } from '../../core/physics';
import { buildTerrain, terrainDerived } from '../../terrain';
import { cone, ewGorge, plane, randomHills, testGrid } from '../../terrain/testing/synthetic';
import { forestMoisture } from './afdrs';
import { MoistureModel } from './model';
import { spinUpStableNight } from './night';
import { diurnalSeries, lmstMs, meanWhere, runModel, uniformFuel } from './testing';

const H = 3.6e6;
const LON = 150.3;
const drought = { kbdi: 60, df: 8 };

function makeTerrain(extent: number, cell: number, elev: (g: ReturnType<typeof testGrid>) => Float32Array): Terrain {
  const g = testGrid(extent, cell);
  return buildTerrain(g, elev(g), 'synthetic');
}

/** Calibration-afternoon weather (spec §5.4): T 25 °C, RH 30 %, U10 15 km/h, clear. */
const calibSeries = (t0: number, z: number) =>
  diurnalSeries(t0 - 170 * H, 180, { tMin: 25, tMax: 25, td: 0, rh: 30, uDay: 15 / 3.6, uNight: 15 / 3.6, cloud: 0, dir: 270 }, { lat: -33.7, lon: LON }, z);

describe('MoistureModel on flat ground: AFDRS parity', () => {
  it('flat cell with c = c_ref: anomaly ≈ 0, afdrs = M_A(cell T, RH), M ≈ M_A after spin-up in steady weather', () => {
    const terrain = makeTerrain(600, 30, (g) => plane(g, 0, 0, 700));
    const fuel = uniformFuel(terrain, FuelType.DryForestShrubby);
    const m = new MoistureModel(terrain, fuel, terrainDerived(terrain));
    const t0 = lmstMs(2026, 10, 15, 14);
    m.initialise(calibSeries(t0, 700), t0, drought, initialStableNight(null));
    const k = 210;
    expect(m.airT[k]).toBeCloseTo(25, 4);
    expect(m.airRH[k]).toBeCloseTo(30, 3);
    expect(m.afdrs[k]).toBeCloseTo(forestMoisture(1, 25, 30), 3);
    expect(Math.abs(m.anomaly[k]!)).toBeLessThan(0.02);
    expect(Math.abs(m.field[k]! - m.afdrs[k]!)).toBeLessThan(0.3); // time lag settled in constant weather
    expect(m.availability[k]).toBeCloseTo(0.95, 2); // FA_dry(DF 8)
    expect(m.warnings.filter((w) => /calibration/.test(w))).toEqual([]); // 4.98 vs 6.01 → no log
    expect(m.fuelTemp[k]).toBeGreaterThan(30);
  });

  it('lapse: a cell 300 m above the grid point is colder by Γ·0.3 km (9.8 K/km on a sunny afternoon)', () => {
    const terrain = makeTerrain(600, 30, (g) => plane(g, 0, 0, 1000));
    const m = new MoistureModel(terrain, uniformFuel(terrain, FuelType.DryForestShrubby), terrainDerived(terrain));
    const t0 = lmstMs(2026, 10, 15, 14);
    m.initialise(calibSeries(t0, 700), t0, drought, initialStableNight(null));
    expect(m.airT[100]).toBeCloseTo(25 - 9.8 * 0.3, 3);
    expect(m.airRH[100]).toBeGreaterThan(30);
  });
});

describe('aspect: north/NW-facing slopes drier than south/SE-facing in the afternoon (V7, spec §5.4)', () => {
  it('30° cone at 14:00 LMST on 15 Oct: SE − NW in [1.2, 3.5] pp, S wetter than N', () => {
    const R = 1200;
    const terrain = makeTerrain(3000, 20, (g) => cone(g, R * Math.tan((30 * Math.PI) / 180), R, 0, 0, 500));
    const fuel = uniformFuel(terrain, FuelType.DryForestShrubby);
    const m = new MoistureModel(terrain, fuel, terrainDerived(terrain));
    const t0 = lmstMs(2026, 10, 15, 14);
    m.initialise(calibSeries(t0, 700), t0, { kbdi: 60, df: 7 }, initialStableNight(null));
    const { grid } = terrain;
    const sel = (az: number) => (k: number) => {
      const x = grid.x0 + (k % grid.nx) * grid.cellSize;
      const y = grid.y0 + Math.floor(k / grid.nx) * grid.cellSize;
      const r = Math.hypot(x, y);
      const a = terrain.aspectDeg[k]!;
      const d = Math.abs((((a - az) % 360) + 540) % 360 - 180);
      return r > 300 && r < 1000 && d < 10;
    };
    const nw = meanWhere(m.field, sel(315));
    const se = meanWhere(m.field, sel(135));
    const n = meanWhere(m.field, sel(0));
    const s = meanWhere(m.field, sel(180));
    expect(nw.n).toBeGreaterThan(50);
    expect(se.mean - nw.mean).toBeGreaterThan(1.2);
    expect(se.mean - nw.mean).toBeLessThan(3.5);
    expect(s.mean).toBeGreaterThan(n.mean + 0.5);
    // Anomaly carries the contrast; M_A is aspect-blind (same air on the same contour).
    expect(meanWhere(m.anomaly, sel(135)).mean - meanWhere(m.anomaly, sel(315)).mean).toBeGreaterThan(1.2);
  });
});

describe('night: recovery, thermal belt and cold valley floor (V8, spec §5.2, §5.5)', () => {
  // calm-night-katabatic preset shape (15 Mar): T 8/24, T_d 6, W 2/1.5 m/s, clear, Δθ_max 6 K, h_inv 150 m.
  const night = { tMin: 8, tMax: 24, td: 6, uDay: 2, uNight: 1.5, cloud: 0, dir: 270 };
  const terrain = makeTerrain(4000, 30, (g) => ewGorge(g, 400, 350, 1000));
  const derived = terrainDerived(terrain);
  const zMed = 900;
  const series = diurnalSeries(lmstMs(2026, 3, 8, 0), 9 * 24, night, { lat: -33.715, lon: LON }, zMed, { dThetaMax: 6, hInv: 150 });

  it('at 05:00 the thermal-belt cells are ≥ 3 pp drier than the valley floor; night M > afternoon M', () => {
    const fuel = uniformFuel(terrain, FuelType.DryForestShrubby);
    const m = new MoistureModel(terrain, fuel, derived);
    const t0 = lmstMs(2026, 3, 16, 5);
    const ns = spinUpStableNight(series, t0);
    expect(ns.dTheta).toBeGreaterThan(5);
    m.initialise(series, t0, { kbdi: 60, df: 7 }, ns);
    const hav = derived.heightAboveValley;
    const floor = meanWhere(m.field, (k) => hav[k]! < 20);
    const belt = meanWhere(m.field, (k) => Math.abs(hav[k]! - 150) <= 75 && terrain.slopeDeg[k]! > 5);
    expect(floor.n).toBeGreaterThan(20);
    expect(belt.n).toBeGreaterThan(20);
    expect(floor.mean - belt.mean).toBeGreaterThanOrEqual(3);
    expect(meanWhere(m.airT, (k) => Math.abs(hav[k]! - 150) <= 75).mean).toBeGreaterThan(meanWhere(m.airT, (k) => hav[k]! < 20).mean + 4);
    // Recovery: the same model at 15:00 the day before was much drier.
    const m15 = new MoistureModel(terrain, fuel, derived);
    const t15 = lmstMs(2026, 3, 15, 15);
    m15.initialise(series, t15, { kbdi: 60, df: 7 }, spinUpStableNight(series, t15));
    expect(meanWhere(m.field, (k) => hav[k]! > 300).mean).toBeGreaterThan(meanWhere(m15.field, (k) => hav[k]! > 300).mean + 5);
  });

  it('gully floor wetter than the plateau on a sunny afternoon (gully offset G, shade, sky view)', () => {
    // V-shaped E–W gully, 150 m deep, 31° walls, falling to the west at 8.5° (convergent contours → Gully),
    // cut into a tilted plateau.
    const tg = makeTerrain(3000, 30, (g) => {
      const out = new Float32Array(g.nx * g.ny);
      for (let j = 0; j < g.ny; j++)
        for (let i = 0; i < g.nx; i++) out[j * g.nx + i] = 1000 + 0.15 * (g.x0 + i * g.cellSize) - 150 * Math.max(0, 1 - Math.abs(g.y0 + j * g.cellSize) / 250);
      return out;
    });
    const dg = terrainDerived(tg);
    const s2 = diurnalSeries(lmstMs(2026, 3, 8, 0), 9 * 24, { ...night, uNight: 4, uDay: 4 }, { lat: -33.715, lon: LON }, 1000);
    const m = new MoistureModel(tg, uniformFuel(tg, FuelType.DryForestShrubby), dg);
    const t0 = lmstMs(2026, 3, 15, 14);
    m.initialise(s2, t0, { kbdi: 60, df: 7 }, spinUpStableNight(s2, t0));
    const y = (k: number) => tg.grid.y0 + Math.floor(k / tg.grid.nx) * tg.grid.cellSize;
    const floorSel = (k: number) => Math.abs(y(k)) < 20 && tg.landform[k] === Landform.Gully;
    const plateauSel = (k: number) => Math.abs(y(k)) > 600 && Math.abs(y(k)) < 1200;
    const floor = meanWhere(m.field, floorSel);
    const plateau = meanWhere(m.field, plateauSel);
    expect(floor.n).toBeGreaterThan(50);
    expect(dg.tpiSmall[tg.grid.nx * ((tg.grid.ny - 1) >> 1) + 50]!).toBeLessThan(-15);
    expect(floor.mean).toBeGreaterThan(plateau.mean + 1.5);
    expect(meanWhere(m.anomaly, floorSel).mean).toBeGreaterThan(meanWhere(m.anomaly, plateauSel).mean + 1.5);
  });
});

describe('rain and dew memory (spec §5.5)', () => {
  it('10 mm at 12:00: ≥ 30 pp at 13:00, 5–15 pp at 12:00 next day, < 3 pp before it leaves the 48 h window, small drop at 48 h', () => {
    const terrain = makeTerrain(300, 30, (g) => plane(g, 0, 0, 700));
    const fuel = uniformFuel(terrain, FuelType.DryForestShrubby);
    const derived = terrainDerived(terrain);
    const tRain = lmstMs(2026, 10, 15, 12);
    const stamp = Math.round(tRain / H) * H; // rain in the hour ending at the stamp nearest 12:00 LMST
    const shape = { tMin: 10, tMax: 24, td: 5, uDay: 3, uNight: 1, cloud: 0, dir: 270 };
    const start = stamp - 180 * H;
    const dry = diurnalSeries(start, 260, shape, { lat: -33.7, lon: LON }, 700);
    const wet = diurnalSeries(start, 260, { ...shape, rain: (t) => (t === stamp ? 10 : 0) }, { lat: -33.7, lon: LON }, 700);
    const mk = (s: typeof dry) => {
      const m = new MoistureModel(terrain, fuel, derived);
      const t0 = stamp - 2 * H;
      m.initialise(s, t0, drought, spinUpStableNight(s, t0));
      return { m, night: spinUpStableNight(s, t0), s, t0 };
    };
    const a = mk(dry);
    const b = mk(wet);
    const k = 40;
    const excess: { t: number; d: number }[] = [];
    // Lock-step: both models advance one 600 s update at a time.
    for (let t = a.t0; t < stamp + 49 * H - 1; t += 600e3) {
      runModel(a.m, terrain, a.s, a.night, t, t + 600e3, drought);
      runModel(b.m, terrain, b.s, b.night, t, t + 600e3, drought);
      excess.push({ t: t + 600e3, d: b.m.field[k]! - a.m.field[k]! });
    }
    const at = (t: number) => excess.find((e) => Math.abs(e.t - t) < 1000)!.d;
    expect(at(stamp + H)).toBeGreaterThanOrEqual(30);
    expect(at(stamp + 24 * H)).toBeGreaterThan(5);
    expect(at(stamp + 24 * H)).toBeLessThan(15);
    expect(at(stamp + 47.5 * H)).toBeLessThan(3);
    expect(at(stamp + 47.5 * H)).toBeGreaterThan(0);
    // The drop as the rain leaves the 48 h window stays below 3 pp per step; afterwards the excess is ~0.
    for (let i = 1; i < excess.length; i++) if (excess[i]!.t > stamp + 47 * H) expect(excess[i - 1]!.d - excess[i]!.d).toBeLessThan(3);
    expect(Math.abs(at(stamp + 49 * H))).toBeLessThan(0.05);
    // Breakdown attributes it to rain memory.
    expect(b.m.breakdown(k).rainMemory).toBeCloseTo(0, 6);
  });

  it('heath: rain enters through AFDRS MC2 inside M_A (no extra R_mem); afdrs output includes MC2', () => {
    const terrain = makeTerrain(300, 30, (g) => plane(g, 0, 0, 700));
    const fuel = uniformFuel(terrain, FuelType.Heath);
    const stamp = Math.round(lmstMs(2026, 10, 15, 9) / H) * H;
    const shape = { tMin: 12, tMax: 26, td: 6, uDay: 4, uNight: 2, cloud: 0, dir: 270 };
    const wet = diurnalSeries(stamp - 180 * H, 200, { ...shape, rain: (t) => (t === stamp ? 5 : 0) }, { lat: -33.7, lon: LON }, 700);
    const dry = diurnalSeries(stamp - 180 * H, 200, shape, { lat: -33.7, lon: LON }, 700);
    const t0 = stamp + 12 * H;
    const run = (s: typeof wet) => {
      const m = new MoistureModel(terrain, fuel, terrainDerived(terrain));
      m.initialise(s, t0, drought, spinUpStableNight(s, t0));
      return m;
    };
    const a = run(dry);
    const b = run(wet);
    const k = 40;
    // MC2(5 mm, 12 h) = 67.128·(1 − e^{−15.66})·e^{−1.03} = 23.99 pp in M_A.
    expect(b.afdrs[k]! - a.afdrs[k]!).toBeCloseTo(67.128 * Math.exp(-0.0858 * 12), 1);
    expect(b.breakdown(k).rainMemory).toBe(0);
    expect(b.field[k]! - a.field[k]!).toBeGreaterThan(15);
    // M_lag lags the decaying MC2 (wetting τ 2 h, drying 1.5 h, × f_τ), so M − M_A stays a few pp above it.
    expect(b.field[k]! - a.field[k]!).toBeLessThan(b.afdrs[k]! - a.afdrs[k]! + 8);
    expect(b.breakdown(k).lag).toBeGreaterThan(0);
  });

  it('atmosphere air temperature (ctx.airT) replaces the lapse T; belt-kit offset shifts T and T_d', () => {
    const terrain = makeTerrain(300, 30, (g) => plane(g, 0, 0, 700));
    const fuel = uniformFuel(terrain, FuelType.DryForestShrubby);
    const t0 = lmstMs(2026, 10, 15, 14);
    const s = calibSeries(t0, 700);
    const m = new MoistureModel(terrain, fuel, terrainDerived(terrain));
    m.initialise(s, t0, drought, initialStableNight(null));
    const n = terrain.elevation.length;
    const night = initialStableNight(null);
    const w = s.hours.find((h) => h.time >= t0)!;
    const sun = { total: new Float32Array(n), direct: new Float32Array(n), shaded: new Uint8Array(n), sunAzimuth: 300, sunElevation: 50, ghi: 0, dni: 0, dhi: 0 };
    const ctx = { time: t0 + 600e3, lmstHour: 14.2, month: 10, sunElevation: 50, cloudFrac: 0, u10: new Float32Array(n).fill(4), burnt: new Uint8Array(n), kbdi: 60, df: 8, night, airT: new Float32Array(n).fill(30) };
    m.update(w, sun, 600, ctx);
    expect(m.airT[10]).toBeCloseTo(30, 5);
    expect(m.airRH[10]).toBeLessThan(30); // same dew point, warmer air
    m.setAirOffset(2, 0);
    m.update(w, sun, 600, { ...ctx, time: t0 + 1200e3, airT: undefined });
    expect(m.airT[10]).toBeCloseTo(w.temperature + 2, 4);
  });

  it('dew forms on a clear calm night in the open and dries after sunrise', () => {
    const terrain = makeTerrain(300, 30, (g) => plane(g, 0, 0, 700));
    const fuel = uniformFuel(terrain, FuelType.Grassland);
    const s = diurnalSeries(lmstMs(2026, 4, 1, 0), 10 * 24, { tMin: 6, tMax: 20, td: 5, uDay: 2, uNight: 0.5, cloud: 0, dir: 0 }, { lat: -33.7, lon: LON }, 700);
    const m = new MoistureModel(terrain, fuel, terrainDerived(terrain));
    const t5 = lmstMs(2026, 4, 8, 5.5);
    m.initialise(s, t5, drought, spinUpStableNight(s, t5));
    expect(m.breakdown(40).dew).toBeGreaterThan(5);
    const m2 = new MoistureModel(terrain, fuel, terrainDerived(terrain));
    const t13 = lmstMs(2026, 4, 8, 13);
    m2.initialise(s, t13, drought, spinUpStableNight(s, t13));
    expect(m2.breakdown(40).dew).toBe(0);
  });
});

describe('spin-up, checkpoints, edits', () => {
  const terrain = makeTerrain(2400, 30, (g) => randomHills(g, 7, 25, 250));
  const derived = terrainDerived(terrain);
  const fuel = uniformFuel(
    terrain,
    (k) => (terrain.elevation[k]! > 700 ? FuelType.Heath : terrain.tpi[k]! < -10 ? FuelType.WetForest : k % 17 === 0 ? FuelType.Grassland : FuelType.DryForestShrubby),
    (k) => 0.2 + 0.7 * ((k * 7919) % 100) / 100,
  );
  const t0 = lmstMs(2026, 11, 20, 15);
  const series = diurnalSeries(t0 - 190 * H, 200, { tMin: 12, tMax: 31, td: 6, uDay: 5, uNight: 1.5, cloud: 10, dir: 300, rain: (t) => (Math.abs(t - (t0 - 120 * H)) < 1 ? 6 : Math.abs(t - (t0 - 30 * H)) < 1 ? 3 : 0) }, { lat: -33.7, lon: LON }, 600);

  it('LUT spin-up and full per-cell spin-up agree to ±0.3 pp at t0', () => {
    const night = spinUpStableNight(series, t0);
    const a = new MoistureModel(terrain, fuel, derived);
    a.initialise(series, t0, drought, night);
    const b = new MoistureModel(terrain, fuel, derived, { spinUpLut: false });
    b.initialise(series, t0, drought, night);
    let maxDiff = 0;
    for (let k = 0; k < a.field.length; k++) maxDiff = Math.max(maxDiff, Math.abs(a.field[k]! - b.field[k]!));
    expect(maxDiff).toBeLessThanOrEqual(0.3);
  });

  it('checkpoint → restore → step is bitwise equal to an uninterrupted run; burnt cells stay frozen', () => {
    const night0 = spinUpStableNight(series, t0 - 3 * H);
    const m = new MoistureModel(terrain, fuel, derived);
    m.initialise(series, t0 - 3 * H, drought, night0);
    const n1 = { ...night0 };
    runModel(m, terrain, series, n1, t0 - 3 * H, t0 - 2 * H, drought);
    const cp = m.checkpoint();
    const nCp = { ...n1 };
    runModel(m, terrain, series, n1, t0 - 2 * H, t0, drought);
    const ref = m.field.slice();
    const ref2 = m.fuelTemp.slice();
    const fieldRef = m.field;
    m.restore(cp);
    expect(m.field).toBe(fieldRef); // identity kept
    runModel(m, terrain, series, { ...nCp }, t0 - 2 * H, t0, drought);
    expect(Array.from(m.field)).toEqual(Array.from(ref));
    expect(Array.from(m.fuelTemp)).toEqual(Array.from(ref2));
    // Burnt cells keep their last value.
    const burnt = new Uint8Array(m.field.length);
    burnt[5] = 1;
    const before = m.field[5];
    runModel(m, terrain, series, { ...nCp }, t0, t0 + 2 * H, drought, 600, undefined, burnt);
    expect(m.field[5]).toBe(before);
    expect(m.field[6]).not.toBe(ref[6]);
  });

  it('moisture offsets add pp; refreshFuel picks up edits; FA follows DF/KBDI changes', () => {
    const f2 = uniformFuel(terrain, FuelType.DryForestShrubby, 0.6);
    const m = new MoistureModel(terrain, f2, derived);
    m.initialise(series, t0, drought, spinUpStableNight(series, t0));
    const base = m.field[100]!;
    f2.moistureOffset![100] = 5;
    m.refreshFuel([100]);
    runModel(m, terrain, series, spinUpStableNight(series, t0), t0, t0 + 600e3, drought);
    const m2 = new MoistureModel(terrain, uniformFuel(terrain, FuelType.DryForestShrubby, 0.6), derived);
    m2.initialise(series, t0, drought, spinUpStableNight(series, t0));
    runModel(m2, terrain, series, spinUpStableNight(series, t0), t0, t0 + 600e3, drought);
    expect(m.field[100]! - m2.field[100]!).toBeCloseTo(5, 4);
    expect(base).toBeGreaterThan(2);
    expect(m.availability[100]).toBeCloseTo(0.95, 2);
    runModel(m, terrain, series, spinUpStableNight(series, t0), t0 + 600e3, t0 + 1200e3, { kbdi: 60, df: 5 });
    expect(m.availability[100]).toBeCloseTo(0.504, 3);
  });

  it('update with Δt = 0 re-evaluates outputs without advancing the state (the t0 refresh)', () => {
    const m = new MoistureModel(terrain, fuel, derived);
    m.initialise(series, t0, drought, spinUpStableNight(series, t0));
    const cp = m.checkpoint();
    const night = spinUpStableNight(series, t0);
    const n = terrain.elevation.length;
    const w = series.hours.find((h) => h.time >= t0)!;
    const ctx = { time: t0, lmstHour: 15, month: 11, sunElevation: 40, cloudFrac: 0.1, u10: new Float32Array(n).fill(2), burnt: new Uint8Array(n), kbdi: 60, df: 8, night };
    const sun = { total: new Float32Array(n).fill(600), direct: new Float32Array(n).fill(500), shaded: new Uint8Array(n), sunAzimuth: 300, sunElevation: 40, ghi: 600, dni: 700, dhi: 100 };
    m.update(w, sun, 0, ctx);
    const once = m.field.slice();
    m.update(w, sun, 0, ctx);
    expect(Array.from(m.field)).toEqual(Array.from(once));
    const after = m.checkpoint();
    expect(Array.from(after.mLag)).toEqual(Array.from(cp.mLag));
    expect(Array.from(after.lDew)).toEqual(Array.from(cp.lDew));
  });

  it('3 h update steps are stable (no overshoot, finite, within [2, 250])', () => {
    const m = new MoistureModel(terrain, fuel, derived);
    m.initialise(series, t0 - 48 * H, drought, spinUpStableNight(series, t0 - 48 * H));
    runModel(m, terrain, series, spinUpStableNight(series, t0 - 48 * H), t0 - 48 * H, t0, drought, 3 * 3600);
    for (const v of m.field) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(250);
    }
  });

  it('non-burnable cells get M = 0, FA = 0; air T/RH still computed', () => {
    const f3 = uniformFuel(terrain, (k) => (k === 3 ? FuelType.NonFuel : FuelType.Heath));
    const m = new MoistureModel(terrain, f3, derived);
    m.initialise(series, t0, drought, spinUpStableNight(series, t0));
    expect(m.field[3]).toBe(0);
    expect(m.availability[3]).toBe(0);
    expect(m.airRH[3]).toBeGreaterThan(0);
    expect(m.familyAt(4)).toBe('heath');
    expect(m.availability[4]).toBe(1);
  });
});
