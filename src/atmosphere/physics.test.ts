/**
 * 3-D atmosphere validation (spec §8.11, §15 V6/V7, task validation list): resting stratified atmosphere and cold
 * pool over the real Katoomba DEM, neutral flow over a Gaussian hill (speed-up), lee deceleration and separation
 * blend, warm bubble, fire plume (updraft, surface indraft, Briggs), unstable column, anabatic flow by day,
 * katabatic drainage and valley decoupling at night, fire-heat energy budget.
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { DEG, windToUV } from '../core/units';
import { FuelType, type Terrain, type WeatherHour, type WeatherSeries } from '../core/types';
import { CP } from '../core/physics';
import { insolation } from '../terrain';
import { Atmosphere } from './atmosphere';
import { DiagnosticWind } from './diagnosticWind';
import { ATMOS_PARAMS } from './params';
import { alphaVRatio, buildProfile, pressureAt } from './profile';
import { briggsRise, plumeColumn } from './plume';
import {
  analyticTerrain,
  cellAt,
  ctxFor,
  featuresDouble,
  fireWinds,
  flatTerrain,
  fuelDouble,
  hour,
  katoombaTerrain,
  nightState,
  runFor,
  seriesOf,
} from './testUtils';
import type { GridSpec } from '../core/grid';
import type { FireWindContextExt } from './base';

type HiRes = { grid: GridSpec; elevation: Float32Array };
const grass = (t: Terrain) => fuelDouble(t.grid, FuelType.Grassland, 0, 0);
const make3d = (t: Terrain, s: WeatherSeries, extent: number, hiRes?: HiRes, fuel = fuelDouble(t.grid)) =>
  new Atmosphere(t, hiRes, fuel, featuresDouble(t), 'standard', extent, s, new Rng(5));

/** Private 3-D state for white-box checks. */
type Internals = { th: Float32Array; cpT: Float32Array; zAslC: Float32Array; uc: Float32Array; vc: Float32Array; wc: Float32Array; initialiseState(): void };
const internals = (a: Atmosphere) => a as unknown as Internals;

describe('§8.11 resting stratified atmosphere over the real Katoomba DEM (no sun, no fire)', () => {
  it('without a cold pool the rest state is exact (no spurious pressure-gradient flow) for 1 h', async () => {
    const { terrain, hiRes } = await katoombaTerrain(6000, 30);
    const t0 = Date.UTC(2025, 5, 15, 15);
    const hrs = [0, 1].map((q) => hour(t0 + q * 3600e3, 0, 0, { temperature: 5 }));
    const a = make3d(terrain, seriesOf(hrs, { sourceElevation: 715 }), 6000, hiRes);
    a.setAmbient(hrs[0]!, hrs[1]!);
    a.setTime(t0);
    runFor(a, 3600);
    let m = 0;
    const st = a.state;
    for (let q = 0; q < st.uc.length; q++) m = Math.max(m, Math.hypot(st.uc[q]!, st.vc[q]!, st.wc[q]!), Math.abs(st.theta[q]!));
    expect(m).toBeLessThan(1e-6);
  }, 120000);

  it('with a 5 K cold pool: the valley inversion loses < 1 K in 3 h; drainage stays katabatic (< 3 m/s)', async () => {
    const { terrain, hiRes } = await katoombaTerrain(6000, 30);
    const t0 = Date.UTC(2025, 5, 15, 15); // ≈ 01:00 local, winter
    const hrs = [0, 1, 2, 3].map((q) => hour(t0 + q * 3600e3, 0, 0, { temperature: 5 }));
    const a = make3d(terrain, seriesOf(hrs, { sourceElevation: 715 }), 6000, hiRes);
    a.setAmbient(hrs[0]!, hrs[1]!);
    a.setTime(t0);
    a.setNightState(nightState(5, 150)); // surface heating off: no radiative cooling source
    internals(a).initialiseState();
    const d0 = a.diagnostics().inversion.dTheta;
    expect(d0).toBeGreaterThan(4.5);
    let t = 0;
    let maxSpeed = 0;
    for (let h = 1; h <= 3; h++) {
      runFor(a, 3600);
      t += 3600;
      a.setAmbient(hrs[h]!, hrs[Math.min(3, h + 1)]!);
      a.setTime(t0 + t * 1000);
      const st = a.state;
      for (let q = 0; q < st.uc.length; q++) maxSpeed = Math.max(maxSpeed, Math.hypot(st.uc[q]!, st.vc[q]!, st.wc[q]!));
    }
    const d3 = a.diagnostics().inversion;
    expect(d3.present).toBe(true);
    expect(d0 - d3.dTheta).toBeLessThan(1);
    expect(maxSpeed).toBeLessThan(3);
  }, 300000);
});

describe('§8.11 neutral flow over a Gaussian hill and a steep ridge', () => {
  it('3-D hill (h/L = 0.15): crest speed-up within ±30 % of 1.6h/L', () => {
    const h = 150;
    const L = 1000; // half-width at half height
    const sig = L / Math.sqrt(2 * Math.log(2));
    const t = analyticTerrain(9000, 30, (x, y) => 500 + h * Math.exp(-(x * x + y * y) / (2 * sig * sig)));
    const hrs = [0, 1].map((q) => hour(Date.UTC(2025, 0, 5, 3 + q), 8, 270));
    const a = make3d(t, seriesOf(hrs, { sourceElevation: 500 }), 9000, undefined, grass(t));
    a.setAmbient(hrs[0]!, hrs[1]!);
    a.setTime(hrs[0]!.time);
    runFor(a, 1800);
    const r = fireWinds(a, t, ctxFor(t, { slopeFlowOn: false }));
    const sp = (x: number) => {
      const k = cellAt(t, x, 0);
      return Math.hypot(r.u[k]!, r.v[k]!);
    };
    const up = sp(-4000);
    const ds = (sp(0) - up) / up;
    const target = (1.6 * h) / L;
    expect(ds).toBeGreaterThan(0.7 * target);
    expect(ds).toBeLessThan(1.3 * target);
  }, 120000);

  it('steep ridge: strong deceleration on the lee slope; the §7.9 separation blend reverses the fire wind there', () => {
    const t = analyticTerrain(6000, 30, (x) => 400 + 450 * Math.exp(-(x * x) / (2 * 450 * 450)));
    const hrs = [0, 1].map((q) => hour(Date.UTC(2025, 0, 5, 3 + q), 10, 270));
    const a = make3d(t, seriesOf(hrs, { sourceElevation: 400 }), 6000);
    a.setAmbient(hrs[0]!, hrs[1]!);
    a.setTime(hrs[0]!.time);
    runFor(a, 1800);
    const r = fireWinds(a, t, ctxFor(t, { slopeFlowOn: false }));
    const at = (x: number) => r.u[cellAt(t, x, 0)]!;
    expect(at(0)).toBeGreaterThan(1.4 * at(-2500)); // crest speed-up
    expect(at(900)).toBeLessThan(0.4 * at(0)); // lee wake
    // Full separation weight on the lee slope: U ← 0.3·U_ridge·û(upslope) (westward, against the westerly).
    const n = t.grid.nx * t.grid.ny;
    const sep = new Float32Array(n);
    const kLee = cellAt(t, 500, 0);
    sep[kLee] = 1;
    const r2 = fireWinds(a, t, ctxFor(t, { slopeFlowOn: false, sep }));
    expect(r2.u[kLee]!).toBeLessThan(0);
    if (Number.isFinite(r2.ridge[kLee]!)) expect(r2.u[kLee]!).toBeCloseTo(-0.3 * r2.ridge[kLee]!, 1);
  }, 120000);
});

describe('§8.11 warm bubble and fire plume', () => {
  it('a 0.5 K warm bubble rises symmetrically', () => {
    const t = flatTerrain(4000, 40, 500);
    const hrs = [0, 1].map((q) => hour(Date.UTC(2025, 0, 5, 3 + q), 0, 270));
    const a = make3d(t, seriesOf(hrs, { sourceElevation: 500 }), 4000, undefined, grass(t));
    a.setAmbient(hrs[0]!, hrs[1]!);
    a.setTime(hrs[0]!.time);
    internals(a).initialiseState();
    const g = a.grid;
    const th = a.state.theta;
    const xc = g.grid.x0 + ((g.nx - 1) / 2) * g.dx;
    const yc = g.grid.y0 + ((g.ny - 1) / 2) * g.dx;
    for (let k = 0; k < g.nz; k++) {
      for (let j = 0; j < g.ny; j++) {
        for (let i = 0; i < g.nx; i++) {
          const r = Math.hypot((g.grid.x0 + i * g.dx - xc) / 300, (g.grid.y0 + j * g.dx - yc) / 300, (g.zetaC[k]! - 400) / 200);
          if (r < 1) th[k * g.plane + j * g.nx + i] = 0.5 * Math.cos((Math.PI * r) / 2) ** 2;
        }
      }
    }
    const centroid = (): number => {
      let s = 0;
      let sz = 0;
      for (let k = 0; k < g.nz; k++) for (let c = 0; c < g.plane; c++) if (th[k * g.plane + c]! > 0.02) {
        s += th[k * g.plane + c]!;
        sz += th[k * g.plane + c]! * g.zetaC[k]!;
      }
      return sz / s;
    };
    const z0 = centroid();
    runFor(a, 300);
    expect(centroid()).toBeGreaterThan(z0 + 50);
    const w = a.state.wc;
    let asym = 0;
    let wmax = 0;
    for (let k = 0; k < g.nz; k++) {
      for (let j = 0; j < g.ny; j++) {
        for (let i = 0; i < g.nx; i++) {
          const q = k * g.plane + j * g.nx + i;
          asym = Math.max(asym, Math.abs(w[q]! - w[k * g.plane + j * g.nx + (g.nx - 1 - i)]!), Math.abs(w[q]! - w[k * g.plane + (g.ny - 1 - j) * g.nx + i]!));
          wmax = Math.max(wmax, w[q]!);
        }
      }
    }
    expect(wmax).toBeGreaterThan(0.5);
    expect(asym).toBeLessThan(1e-4 * wmax);
  }, 60000);

  it('a 7 GW fire produces a plume (strong updraft) and a surface indraft toward the fire', () => {
    const t = flatTerrain(6000, 30, 500);
    const hrs = [0, 1].map((q) => hour(Date.UTC(2025, 0, 5, 3 + q), 3, 270));
    const a = make3d(t, seriesOf(hrs, { sourceElevation: 500 }), 6000, undefined, grass(t));
    a.setAmbient(hrs[0]!, hrs[1]!);
    a.setTime(hrs[0]!.time);
    const fg = t.grid;
    const n = fg.nx * fg.ny;
    const q = new Float32Array(n);
    const fd = new Float32Array(n);
    let P = 0;
    for (let j = 0; j < fg.ny; j++) {
      for (let i = 0; i < fg.nx; i++) {
        const r = Math.hypot(fg.x0 + i * 30, fg.y0 + j * 30);
        if (r < 150) q[j * fg.nx + i] = 100; // kW/m²
        fd[j * fg.nx + i] = Math.max(0, r - 150);
        P += q[j * fg.nx + i]! * 900 * 1000;
      }
    }
    for (let s = 0; s < 60; s++) {
      a.addFireHeat(fg, q, new Float32Array(n));
      a.step(Math.min(a.maxStableDt(), 10));
    }
    const d = a.diagnostics();
    expect(d.maxUpdraft).toBeGreaterThan(5);
    expect(d.firePowerMW).toBeCloseTo(P / 1e6, 0);
    const r = fireWinds(a, t, ctxFor(t, { firePowerW: P, frontDist: fd, slopeFlowOn: false }));
    const kW = cellAt(t, -400, 0);
    const kN = cellAt(t, 0, 400);
    const kS = cellAt(t, 0, -400);
    expect(r.iu[kW]!).toBeGreaterThan(0.1); // upwind side: indraft eastward, toward the fire
    expect(r.iv[kN]!).toBeLessThan(-0.1); // north side: southward
    expect(r.iv[kS]!).toBeGreaterThan(0.1); // south side: northward
    // Resolved head correction (V22 3-D tier): at a head cell the component along the outward normal is removed
    // (both signs, from U_fire and U_fireInd); the cross-normal part and the other cells are untouched.
    const head = new Uint8Array(n);
    const hx = new Float32Array(n);
    const hy = new Float32Array(n);
    head[kW] = 1;
    hx[kW] = -1; // outward normal of the fire's west edge
    const hctx: FireWindContextExt = { ...ctxFor(t, { firePowerW: P, frontDist: fd, slopeFlowOn: false }), headMask: head, headDirX: hx, headDirY: hy };
    const rh = fireWinds(a, t, hctx);
    expect(Math.abs(rh.iu[kW]!)).toBeLessThan(1e-6);
    expect(rh.iv[kW]).toBeCloseTo(r.iv[kW]!, 6);
    expect(rh.u[kW]).toBeCloseTo(r.u[kW]! - r.iu[kW]!, 5);
    expect(rh.iv[kN]).toBe(r.iv[kN]);
    // Coupling off: the fire-induced part vanishes (one-way coupling).
    a.setCoupling(0);
    const r0 = fireWinds(a, t, ctxFor(t, { firePowerW: P, frontDist: fd, slopeFlowOn: false }));
    expect(r0.iu[kW]).toBe(0);
  }, 120000);

  it('fire heat injection conserves energy: Σ ρc_pΠθ′ΔV gained = χ_c·ΣqA·Δt', () => {
    const t = flatTerrain(3000, 30, 500);
    const hrs = [0, 1].map((q) => hour(Date.UTC(2025, 0, 5, 3 + q), 0, 270));
    const a = make3d(t, seriesOf(hrs, { sourceElevation: 500 }), 3000, undefined, grass(t));
    a.setAmbient(hrs[0]!, hrs[1]!);
    a.setTime(hrs[0]!.time);
    internals(a).initialiseState();
    const fg = t.grid;
    const n = fg.nx * fg.ny;
    const q = new Float32Array(n);
    q[cellAt(t, 0, 0)] = 50; // 50 kW/m² on one 30 m cell = 45 MW (θ′ stays far below the 60 K cap)
    a.addFireHeat(fg, q, new Float32Array(n));
    const dt = 3;
    a.step(dt);
    const g = a.grid;
    const p = buildProfile(hrs[0]!, seriesOf(hrs, { sourceElevation: 500 }), g.zMin, g.relief);
    let E = 0;
    const it = internals(a);
    for (let o = 0; o < g.n; o++) {
      const c = o % g.plane;
      const k = (o - c) / g.plane;
      const z = it.zAslC[o]!;
      const pz = pressureAt(p, z);
      const pi = (pz / 1000) ** 0.2857;
      const T = (it.th[o]! + 300) * pi; // θ′ ≪ θ: ρ from the environment
      const rho = (pz * 100) / (287 * T);
      E += rho * CP * pi * it.th[o]! * g.J[c]! * g.dzeta[k]! * g.dx * g.dx;
    }
    const expected = ATMOS_PARAMS.chiC * 50e3 * 900 * dt;
    expect(E / expected).toBeGreaterThan(0.9);
    expect(E / expected).toBeLessThan(1.1);
  }, 60000);

  it('1-D plume top within ×2 of Briggs through a stable sounding; unstable column gives finite α_v, Fr_h, Briggs', () => {
    const levels = [
      { hPa: 925, height: 800, temperature: 22, relativeHumidity: 40, windSpeed: 6, windDir: 270 },
      { hPa: 850, height: 1500, temperature: 18, relativeHumidity: 35, windSpeed: 8, windDir: 270 },
      { hPa: 700, height: 3100, temperature: 6, relativeHumidity: 30, windSpeed: 12, windDir: 270 },
      { hPa: 500, height: 5800, temperature: -12, relativeHumidity: 30, windSpeed: 18, windDir: 270 },
    ];
    const w = hour(Date.UTC(2025, 0, 5, 3), 5, 270, { temperature: 24, pressureLevels: levels });
    const s = seriesOf([w], { sourceElevation: 300, upperAirSource: 'model' });
    const p = buildProfile(w, s, 300, 400);
    for (const P of [1e9, 1e10]) {
      const pl = plumeColumn(p, P, 1e5, 300, 1.15, 297);
      const n2 = Math.max(p.nSquared, 1e-4);
      const br = briggsRise(ATMOS_PARAMS.chiC * P, 5, n2, 1.15, 297).rise;
      expect(pl.rise).toBeGreaterThan(br / 2);
      expect(pl.rise).toBeLessThan(br * 2);
    }
    // §8.11 unstable column: 2 m θ 315.5 K at 715 m vs 309.2 K at 850 hPa.
    const unstable = [
      { hPa: 850, height: 1480, temperature: 309.2 * (850 / 1000) ** 0.2857 - 273.15, relativeHumidity: 20, windSpeed: 8, windDir: 300 },
      { hPa: 700, height: 3100, temperature: 12, relativeHumidity: 15, windSpeed: 12, windDir: 300 },
    ];
    const pS = 925;
    const wu = hour(Date.UTC(2025, 0, 5, 4), 6, 300, { temperature: 315.5 * (pS / 1000) ** 0.2857 - 273.15, surfacePressure: pS, pressureLevels: unstable });
    const pu = buildProfile(wu, seriesOf([wu], { sourceElevation: 715, upperAirSource: 'model' }), 700, 400);
    expect(pu.th[1]!).toBeGreaterThan(pu.th[2]!); // superadiabatic between 2 m and 850 hPa
    expect(Number.isFinite(pu.froude)).toBe(true);
    expect(Number.isFinite(alphaVRatio(pu))).toBe(true);
    expect(Number.isFinite(briggsRise(1e9, 6, pu.nSquared, 1.1, 315).rise)).toBe(true);
    expect(Number.isFinite(plumeColumn(pu, 1e9, 1e5, 715, 1.1, 315).topASL)).toBe(true);
  });
});

describe('§8.11 diurnal slope and valley flows (§15 V6/V7)', () => {
  const ridge = analyticTerrain(6000, 30, (_x, y) => 400 + 500 * Math.exp(-(y * y) / (2 * 800 * 800)));
  /** Mean upslope component (m/s) over slopes > 10° facing north (sunlit at 11:00 in October) or south. */
  const upslope = (t: Terrain, u: Float32Array, v: Float32Array, north: boolean): number => {
    let s = 0;
    let n = 0;
    const g = t.grid;
    for (let k = 0; k < u.length; k++) {
      const asp = t.aspectDeg[k]!;
      const i = k % g.nx;
      if (!(t.slopeDeg[k]! > 10) || !Number.isFinite(asp) || i < 8 || i > g.nx - 9) continue;
      if ((asp < 90 || asp > 270) !== north) continue;
      s += -(u[k]! * Math.sin(asp * DEG) + v[k]! * Math.cos(asp * DEG));
      n++;
    }
    return s / n;
  };

  it('anabatic: 1–3 m/s upslope on sunlit slopes by 11:00 (3-D, calm)', () => {
    const t0 = Date.UTC(2025, 9, 15, 0); // 11:00 AEDT
    const hrs = [0, 1, 2].map((q) => hour(t0 + (q - 1) * 3600e3, 0.5, 90, { temperature: 25 }));
    const a = make3d(ridge, seriesOf(hrs, { sourceElevation: 900 }), 6000);
    a.setAmbient(hrs[0]!, hrs[1]!);
    a.setTime(t0 - 1800e3);
    a.setSurfaceHeating(insolation(ridge, t0), hrs[1]!, 30, nightState(0));
    runFor(a, 1800);
    a.setAmbient(hrs[1]!, hrs[2]!);
    a.setTime(t0);
    const r = fireWinds(a, ridge, ctxFor(ridge, { slopeFlowOn: false }));
    const up = upslope(ridge, r.u, r.v, true);
    expect(up).toBeGreaterThan(1);
    expect(up).toBeLessThan(3);
    expect(a.diagnostics().heatFlux[cellAt(ridge, 0, 600)]!).toBeGreaterThan(150);
  }, 120000);

  const gorge = analyticTerrain(6000, 30, (_x, y) => 1000 - 500 * Math.exp(-(y * y) / (2 * 450 * 450)));
  const t0 = Date.UTC(2025, 2, 14, 16); // ≈ 03:00 local
  const night3d = (U: number): { a: Atmosphere; r: ReturnType<typeof fireWinds> } => {
    const hrs = [0, 1, 2].map((q) => hour(t0 + (q - 1) * 3600e3, U, 0, { temperature: 10 }));
    const a = make3d(gorge, seriesOf(hrs, { sourceElevation: 1000 }), 6000);
    a.setAmbient(hrs[0]!, hrs[1]!);
    a.setTime(t0 - 1800e3);
    a.setSurfaceHeating(insolation(gorge, t0), hrs[1]!, 30, nightState(5));
    runFor(a, 1800);
    a.setAmbient(hrs[1]!, hrs[2]!);
    a.setTime(t0);
    return { a, r: fireWinds(a, gorge) };
  };

  it('katabatic: ≥ 60 % of slopes > 10° drain downslope at 0.5–3 m/s before sunrise (calm, 3-D)', () => {
    const { a, r } = night3d(0.5);
    let n = 0;
    let down = 0;
    for (let k = 0; k < r.u.length; k++) {
      const asp = gorge.aspectDeg[k]!;
      if (!(gorge.slopeDeg[k]! > 10) || !Number.isFinite(asp)) continue;
      const sp = Math.hypot(r.u[k]!, r.v[k]!);
      const cosd = (r.u[k]! * Math.sin(asp * DEG) + r.v[k]! * Math.cos(asp * DEG)) / Math.max(sp, 1e-9);
      n++;
      if (cosd > 0.5 && sp >= 0.5 && sp <= 3) down++;
    }
    expect(down / n).toBeGreaterThan(0.6);
    expect(a.diagnostics().inversion.present).toBe(true);
  }, 120000);

  it('valley floor < 2 m/s under a 10 m/s ridge wind before sunrise (3-D and fast tiers)', () => {
    const { r } = night3d(10);
    const kV = cellAt(gorge, 0, 0);
    const kR = cellAt(gorge, 0, -2800);
    expect(Math.hypot(r.u[kV]!, r.v[kV]!)).toBeLessThan(2);
    expect(Math.hypot(r.u[kR]!, r.v[kR]!)).toBeGreaterThan(7);
    const hrs = [0, 1].map((q) => hour(t0 + q * 3600e3, 10, 0, { temperature: 10 }));
    const f = new DiagnosticWind(gorge, undefined, fuelDouble(gorge.grid), featuresDouble(gorge), 'fast', 6000, seriesOf(hrs, { sourceElevation: 1000 }), new Rng(1));
    f.setAmbient(hrs[0]!, hrs[1]!);
    f.setTime(t0);
    f.setSurfaceHeating(insolation(gorge, t0), hrs[0]!, 30, nightState(5));
    const rf = fireWinds(f, gorge);
    expect(Math.hypot(rf.u[kV]!, rf.v[kV]!)).toBeLessThan(2);
    expect(Math.hypot(rf.u[kR]!, rf.v[kR]!)).toBeGreaterThan(7);
  }, 120000);
});

describe('§8.8 V21 in the 3-D tier for the replay and ERA5 fixtures', () => {
  for (const file of ['replay-gospers-2019-12-19.json', 'replay-katoomba-2013-10-16.json']) {
    it(`${file}: flat terrain, U10_fire within ±1 % after spin-up`, async () => {
      const { parseOpenMeteoFixture } = await import('./testUtils');
      const t = flatTerrain(6000, 30, 700);
      const s = parseOpenMeteoFixture(file);
      s.sourceElevation = 700;
      const a = make3d(t, s, 6000);
      // A windy afternoon hour.
      let h = 0;
      for (let q = 0; q < s.hours.length - 1; q++) if (s.hours[q]!.windSpeed10 > s.hours[h]!.windSpeed10 && q < 40) h = q;
      const A: WeatherHour = s.hours[h]!;
      const B: WeatherHour = s.hours[h + 1]!;
      a.setAmbient(A, B);
      a.setTime(A.time);
      runFor(a, 900);
      const [fu, fv] = windToUV(A.windSpeed10, A.windDir10);
      const r = fireWinds(a, t, ctxFor(t, { slopeFlowOn: false }));
      let worst = 0;
      for (let k = 0; k < r.u.length; k += 41) worst = Math.max(worst, Math.hypot(r.u[k]! - fu, r.v[k]! - fv) / Math.hypot(fu, fv));
      expect(worst).toBeLessThan(0.01);
    }, 120000);
  }
  it('preset-like series with pressure levels (upperAirSource preset): U10_fire within ±1 %', () => {
    const levels = [
      { hPa: 850, height: 1500, temperature: 26, relativeHumidity: 20, windSpeed: 14, windDir: 310 },
      { hPa: 700, height: 3100, temperature: 12, relativeHumidity: 15, windSpeed: 17, windDir: 310 },
      { hPa: 500, height: 5800, temperature: -8, relativeHumidity: 20, windSpeed: 22, windDir: 310 },
    ];
    const hrs = [0, 1].map((q) => hour(Date.UTC(2025, 11, 20, 3 + q), 11, 310, { pressureLevels: levels, temperature: 35 }));
    const t = flatTerrain(6000, 30, 700);
    const a = make3d(t, seriesOf(hrs, { sourceElevation: 700, upperAirSource: 'preset' }), 6000);
    a.setAmbient(hrs[0]!, hrs[1]!);
    a.setTime(hrs[0]!.time);
    runFor(a, 900);
    const [fu, fv] = windToUV(11, 310);
    const r = fireWinds(a, t, ctxFor(t, { slopeFlowOn: false }));
    let worst = 0;
    for (let k = 0; k < r.u.length; k += 41) worst = Math.max(worst, Math.hypot(r.u[k]! - fu, r.v[k]! - fv) / 11);
    expect(worst).toBeLessThan(0.01);
    expect(a.diagnostics().cHaines).not.toBeNull();
  }, 120000);
});
