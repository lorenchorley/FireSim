/**
 * Performance against the §13 budgets on real terrain and fuel: the Katoomba demo (bundled 10 m LiDAR DTM, SVTM
 * vegetation, NPWS fire history, canopy) on a 200 × 200 fire grid (central 6 km at 30 m), a 6 h run with
 * Δt_a = 12 s in the §12.2 order (refreshMasks and minuteTasks every 60 s, prepare + step every step), a 30 km/h
 * north-westerly, M 6 %, DF 10, mountainPhenomena on.
 *
 * Budget (§13, phone ≈ 2–3 × one x86 Node core): fire prepare 4–22 s + sub-steps 3–18 s + minute tasks < 4 s per 6 h
 * on a phone ⇒ ≲ 20 s on x86. The CI gate below is lenient (other suites run concurrently); the measured numbers are
 * printed with FIRESIM_VERBOSE=1.
 */
import { describe, expect, it } from 'vitest';
import { makeGridSpec, type GridSpec } from '../../core/grid';
import { Rng } from '../../core/rng';
import type { SpreadEnvironment } from '../../core/simTypes';
import { BurnState, DEFAULT_SIM_OPTIONS, type Terrain, type WeatherHour } from '../../core/types';
import { windToUV } from '../../core/units';
import { loadDemoDem } from '../../data';
import { buildDemoFuel } from '../../fuel/demo';
import { fuelParamsAt } from '../../fuel/fuelMap';
import { cellAvailability } from '../../fuel/moisture/availability';
import { buildTerrain, terrainDerived } from '../../terrain';
import { computeTerrainFeatures } from '../terrainFeatures';
import { FireSpreadModel } from './FireSpreadModel';

/** Central `n × n` block of the 10 m DEM averaged to `cell` m (with the 10 m sub-cell slope statistics, §11.6). */
async function katoombaTerrain(n: number, cell: number): Promise<Terrain | null> {
  const dem = await loadDemoDem('katoomba');
  if (!dem) return null;
  const src = dem.grid;
  const b = Math.round(cell / src.cellSize);
  const off = Math.floor((src.nx / b - n) / 2);
  const grid: GridSpec = makeGridSpec(src.origin, n * cell, cell);
  const z = new Float32Array(n * n);
  const p90 = new Float32Array(n * n);
  const cliff = new Float32Array(n * n);
  const vals = new Float32Array(b * b);
  const h = src.cellSize;
  const e = dem.elevation;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let s = 0;
      let c = 0;
      let nc = 0;
      for (let bj = 0; bj < b; bj++) {
        for (let bi = 0; bi < b; bi++) {
          const ii = (i + off) * b + bi;
          const jj = (j + off) * b + bj;
          const k = jj * src.nx + ii;
          s += e[k]!;
          const dx = (e[k + (ii < src.nx - 1 ? 1 : 0)]! - e[k - (ii > 0 ? 1 : 0)]!) / (2 * h);
          const dy = (e[k + (jj < src.ny - 1 ? src.nx : 0)]! - e[k - (jj > 0 ? src.nx : 0)]!) / (2 * h);
          const sl = (Math.atan(Math.hypot(dx, dy)) * 180) / Math.PI;
          vals[c++] = sl;
          if (sl > 60) nc++;
        }
      }
      z[j * n + i] = s / (b * b);
      vals.sort();
      p90[j * n + i] = vals[Math.min(b * b - 1, Math.round(0.9 * (b * b - 1)))]!;
      cliff[j * n + i] = nc / (b * b);
    }
  }
  const t = buildTerrain(grid, z, 'Katoomba 10 m LiDAR (block-averaged)');
  t.slopeP90Deg = p90;
  t.cliffFraction = cliff;
  return t;
}

describe('performance (spec §13)', () => {
  it('6 h on the 200 × 200 Katoomba grid within the fire budget', async () => {
    const terrain = await katoombaTerrain(200, 30);
    if (!terrain) return; // demo data not bundled
    const t0 = Date.UTC(2019, 11, 20, 1);
    const tBuild = performance.now();
    const derived = terrainDerived(terrain);
    const features = computeTerrainFeatures(terrain, derived);
    const { fuel } = await buildDemoFuel('katoomba', terrain, t0, { droughtFactor: 10, kbdi: 100 });
    const g = terrain.grid;
    const n = g.nx * g.ny;
    const from = 315;
    const U = 30 / 3.6;
    const [u, v] = windToUV(U, from);
    const fill = (x: number): Float32Array => new Float32Array(n).fill(x);
    const fa = new Float32Array(n);
    const m = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const p = fuelParamsAt(fuel, k);
      fa[k] = cellAvailability(p.moistureFamily, 10, 100, p.wrf, p.faBlendW);
      m[k] = 6 + p.moistureOffset;
    }
    const uRidge = fill(NaN);
    for (let k = 0; k < n; k++) if (features.crest(k, from)) uRidge[k] = U;
    const weather: WeatherHour = { time: t0, temperature: 34, relativeHumidity: 15, windSpeed10: U, windDir10: from };
    const env: SpreadEnvironment = {
      windU: fill(u), windV: fill(v), windBgU: fill(u), windBgV: fill(v), fireIndU: fill(0), fireIndV: fill(0), uRidge, moisture: m, availability: fa,
      fuelTempC: fill(40), airT: fill(34), airRho: fill(1.05), droughtFactor: 10, kbdi: 100, weather, time: 0, sunElevation: 60, lmstHour: 13, cloudFrac: 0,
      mountainPhenomena: true, pyrogenicOn: false, coupling: 1,
    };
    const model = new FireSpreadModel(terrain, fuel, features, { ...DEFAULT_SIM_OPTIONS, fireCellSize: 30 }, new Rng(2));
    const setup = performance.now() - tBuild;
    model.ignite({ id: 'p', kind: 'point', points: [[-2200, 2200]], time: 0, origin: 'observed' });
    model.refreshMoistureCache(env);
    let tPrep = 0;
    let tStep = 0;
    let tMask = 0;
    let tMin = 0;
    let maxBand = 0;
    let subSteps = 0;
    const dtA = 12;
    for (let t = 0; t < 6 * 3600; t += dtA) {
      env.time = t;
      let c = performance.now();
      if (t % 60 === 0) {
        model.refreshMasks(env);
        tMask += performance.now() - c;
      }
      c = performance.now();
      model.prepare(env);
      tPrep += performance.now() - c;
      c = performance.now();
      const b = model.maxStableDt();
      subSteps += Number.isFinite(b) ? Math.ceil(dtA / b) : 1;
      model.step(dtA, env);
      tStep += performance.now() - c;
      env.time = t + dtA;
      if ((t + dtA) % 60 === 0) {
        c = performance.now();
        model.minuteTasks(env);
        tMin += performance.now() - c;
      }
      maxBand = Math.max(maxBand, model.aux().front.length);
    }
    const f = model.field;
    let burnt = 0;
    let nonFl = 0;
    for (let k = 0; k < n; k++) {
      if (f.arrivalTime[k]! < Infinity) burnt++;
      if (f.burnState[k] === BurnState.NonFlammable) nonFl++;
    }
    const total = tPrep + tStep + tMask + tMin;
    const cpBytes = (() => {
      const cp = model.checkpoint();
      let b = 0;
      for (const a of Object.values(cp.cells.arrays)) b += a.byteLength;
      return b;
    })();
    if (process.env['FIRESIM_VERBOSE']) {
      // eslint-disable-next-line no-console
      console.log(
        `katoomba 200×200, 6 h: setup ${setup.toFixed(0)} ms; prepare ${(tPrep / 1000).toFixed(2)} s, step ${(tStep / 1000).toFixed(2)} s ` +
          `(≈${subSteps} sub-steps), masks ${(tMask / 1000).toFixed(2)} s, minute ${(tMin / 1000).toFixed(2)} s; total ${(total / 1000).toFixed(2)} s; ` +
          `burnt ${burnt} cells (${((burnt * 900) / 1e4).toFixed(0)} ha), non-flammable ${nonFl}, max front ${maxBand}, checkpoint ${(cpBytes / 1e6).toFixed(1)} MB`,
      );
    }
    expect(burnt).toBeGreaterThan(1000);
    expect(total).toBeLessThan(45_000);
    expect(cpBytes).toBeLessThan(12e6);
  }, 240_000);
});
