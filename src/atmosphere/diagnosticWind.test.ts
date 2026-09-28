/**
 * Fast tier DiagnosticWind (spec §8.8, §8.9, §15 V21/V22): κ scaling reproduces the forecast U10 on flat terrain for
 * the forecast, replay and ERA5 fixtures; pyrogenic strip indraft; head correction; night decoupling; slope flows;
 * checkpoint/restore; view/diagnostics shapes.
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import type { FireWindContext } from '../core/simTypes';
import { windToUV } from '../core/units';
import type { Terrain, WeatherHour, WeatherSeries } from '../core/types';
import { DiagnosticWind } from './diagnosticWind';
import { interpolateHour } from './weatherInterp';
import { featuresDouble, flatTerrain, fuelDouble, hour, nightState, parseOpenMeteoFixture, seriesOf, analyticTerrain } from './testUtils';
import { insolation } from '../terrain';
import { buildProfile, profileWind } from './profile';

function makeFast(t: Terrain, s: WeatherSeries, extent = 6000): DiagnosticWind {
  return new DiagnosticWind(t, undefined, fuelDouble(t.grid), featuresDouble(t), 'fast', extent, s, new Rng(4));
}

function ctxFor(t: Terrain, extra: Partial<FireWindContext> = {}): FireWindContext {
  const n = t.grid.nx * t.grid.ny;
  return { sep: new Float32Array(n), frontDist: new Float32Array(n).fill(Infinity), firePowerW: 0, plumeTopAGL: 1000, slopeFlowOn: true, time: 0, ...extra };
}

function winds(a: DiagnosticWind, t: Terrain, ctx = ctxFor(t)) {
  const n = t.grid.nx * t.grid.ny;
  const o = Array.from({ length: 7 }, () => new Float32Array(n));
  a.surfaceWindForFire(t.grid, o[0]!, o[1]!, o[2]!, o[3]!, o[4]!, o[5]!, o[6]!, ctx);
  return { u: o[0]!, v: o[1]!, bu: o[2]!, bv: o[3]!, iu: o[4]!, iv: o[5]!, ridge: o[6]! };
}

describe('fast tier: flat terrain reproduces the forecast U10 (V21, D30)', () => {
  const t = flatTerrain(6000, 30, 700);
  const cases: [string, number][] = [
    ['openmeteo-forecast-katoomba.json', 24],
    ['replay-gospers-2019-12-19.json', 24],
    ['replay-katoomba-2013-10-16.json', 24],
    ['replay-thredbo-2020-01-02.json', 12],
  ];
  for (const [file, nh] of cases) {
    it(`${file}: every cell within ±1 % of the interpolated forecast U10 (${nh} stamps)`, () => {
      const s = parseOpenMeteoFixture(file);
      s.sourceElevation = 700; // same ground as the flat test domain
      const a = makeFast(t, s);
      let worst = 0;
      let used = 0;
      const prof = new Float64Array(2);
      for (let h = 0; h < nh; h++) {
        const A = s.hours[h]!;
        const B = s.hours[h + 1]!;
        // Skip degenerate profiles (|u(z_ref)| < 0.5 m/s: the §8.2 log-law fallback applies, no exact match).
        const degenerate = [A, B].some((w) => {
          profileWind(buildProfile(w, s, 700, 0), 50, prof);
          return Math.hypot(prof[0]!, prof[1]!) < 1 || w.windSpeed10 < 0.5;
        });
        if (degenerate) continue;
        used++;
        a.setAmbient(A, B);
        const tm = A.time + 0.37 * (B.time - A.time);
        a.setTime(tm);
        const w = interpolateHour(A, B, 0.37);
        const [fu, fv] = windToUV(w.windSpeed10, w.windDir10);
        const sp = Math.hypot(fu, fv);
        const r = winds(a, t);
        for (let k = 0; k < r.u.length; k += 97) {
          const err = Math.hypot(r.u[k]! - fu, r.v[k]! - fv) / Math.max(sp, 0.5);
          worst = Math.max(worst, err);
        }
      }
      expect(used).toBeGreaterThan(nh / 2);
      expect(worst).toBeLessThan(0.01);
    });
  }
  it('synthetic preset-like series with pressure levels (upperAirSource preset)', () => {
    const levels = [
      { hPa: 850, height: 1500, temperature: 26, relativeHumidity: 20, windSpeed: 14, windDir: 310 },
      { hPa: 700, height: 3100, temperature: 12, relativeHumidity: 15, windSpeed: 17, windDir: 310 },
      { hPa: 500, height: 5800, temperature: -8, relativeHumidity: 20, windSpeed: 22, windDir: 310 },
    ];
    const hrs = [0, 1].map((q) => hour(Date.UTC(2025, 11, 20, 3 + q), 11, 310, { pressureLevels: levels, temperature: 35 }));
    const s = seriesOf(hrs, { sourceElevation: 700, upperAirSource: 'preset' });
    const a = makeFast(t, s);
    a.setAmbient(hrs[0]!, hrs[1]!);
    a.setTime(hrs[0]!.time + 1800e3);
    const r = winds(a, t);
    const [fu, fv] = windToUV(11, 310);
    let worst = 0;
    for (let k = 0; k < r.u.length; k += 13) worst = Math.max(worst, Math.hypot(r.u[k]! - fu, r.v[k]! - fv) / 11);
    expect(worst).toBeLessThan(0.01);
    const d = a.diagnostics();
    expect(d.upperAirSource).toBe('preset');
    expect(d.cHaines).not.toBeNull();
  });
});

describe('fast tier: pyrogenic potential and head correction (§8.8, D32, V22)', () => {
  const t = flatTerrain(6000, 30, 500);
  const n = t.grid.nx * t.grid.ny;
  const s = seriesOf([hour(Date.UTC(2025, 0, 10, 2), 5.56, 270), hour(Date.UTC(2025, 0, 10, 3), 5.56, 270)], { sourceElevation: 500 });
  // A north–south strip at x ≈ 0, 60 m wide, carrying I = 10 MW/m (q = I / width).
  const q = new Float32Array(n);
  const width = 60;
  for (let j = 0; j < t.grid.ny; j++) for (let i = 0; i < t.grid.nx; i++) if (Math.abs(t.grid.x0 + i * 30) < width / 2) q[j * t.grid.nx + i] = 10000 / width;
  it('an infinite strip of 10 MW/m induces ≈ k·I/2 = 3 m/s indraft each side', () => {
    const a = makeFast(t, s);
    a.setAmbient(s.hours[0]!, s.hours[1]!);
    a.setTime(s.hours[0]!.time);
    a.addFireHeat(t.grid, q, new Float32Array(n));
    const pyro = (a as unknown as { pyro: { up: Float32Array } }).pyro;
    const j = t.grid.ny >> 1;
    const iW = Math.round((-300 - t.grid.x0) / 30);
    const iE = Math.round((300 - t.grid.x0) / 30);
    const uW = pyro.up[j * t.grid.nx + iW]!;
    const uE = pyro.up[j * t.grid.nx + iE]!;
    expect(uW).toBeGreaterThan(2.4); // west side flows east (toward the fire)
    expect(uW).toBeLessThan(3.3);
    expect(uE).toBeLessThan(-2.4);
    expect(uE).toBeGreaterThan(-3.3);
  });
  it('pyrogenic source smoothed over the plume response time: a pulsed strip gives a steady ≈ k·Ī/2 indraft; checkpointed', () => {
    // Regression (V15): the cells of a straight front ignite together, so its heat comes in pulses; solved from the
    // instantaneous flux the indraft swung 0.2 ↔ 3 m/s between solves. Here the strip burns 1 step in 4 at 4 × q.
    const a = makeFast(t, s);
    a.setAmbient(s.hours[0]!, s.hours[1]!);
    a.setTime(s.hours[0]!.time);
    const pyro = (x: DiagnosticWind): Float32Array => (x as unknown as { pyro: { up: Float32Array } }).pyro.up;
    const kW = (t.grid.ny >> 1) * t.grid.nx + Math.round((-300 - t.grid.x0) / 30);
    const pulse = new Float32Array(n);
    for (let k = 0; k < n; k++) pulse[k] = 4 * q[k]!;
    const zero = new Float32Array(n);
    const samples: number[] = [];
    let b: DiagnosticWind | null = null;
    for (let st = 0; st < 240; st++) {
      const heat = st % 4 === 0 ? pulse : zero;
      a.addFireHeat(t.grid, heat, zero);
      b?.addFireHeat(t.grid, heat, zero);
      a.step(10);
      b?.step(10);
      if (st >= 180 && st % 6 === 0) samples.push(pyro(a)[kW]!);
      if (st === 150) {
        b = makeFast(t, s);
        b.setAmbient(s.hours[0]!, s.hours[1]!);
        b.setTime(s.hours[0]!.time);
        b.restore(a.checkpoint());
      }
    }
    const mean = samples.reduce((x, y) => x + y, 0) / samples.length;
    expect(mean).toBeGreaterThan(2.4);
    expect(mean).toBeLessThan(3.3);
    expect(Math.max(...samples) - Math.min(...samples)).toBeLessThan(0.25 * mean);
    expect(Buffer.from(pyro(b!).buffer).equals(Buffer.from(pyro(a).buffer))).toBe(true);
  });
  it('head correction: downwind (head side) along-wind speed unchanged by coupling; upwind side gains indraft', () => {
    const a = makeFast(t, s);
    a.setAmbient(s.hours[0]!, s.hours[1]!);
    a.setTime(s.hours[0]!.time);
    a.addFireHeat(t.grid, q, new Float32Array(n));
    const frontDist = new Float32Array(n);
    for (let k = 0; k < n; k++) frontDist[k] = Math.abs(t.grid.x0 + (k % t.grid.nx) * 30);
    const on = winds(a, t, ctxFor(t, { firePowerW: 1e10, frontDist }));
    a.setCoupling(0);
    const off = winds(a, t, ctxFor(t, { firePowerW: 1e10, frontDist }));
    const j = t.grid.ny >> 1;
    const kHead = j * t.grid.nx + Math.round((150 - t.grid.x0) / 30); // east = downwind of a westerly
    const kBack = j * t.grid.nx + Math.round((-150 - t.grid.x0) / 30);
    expect(Math.abs(on.u[kHead]! - off.u[kHead]!)).toBeLessThan(0.05 * off.u[kHead]!); // V22: head ROS within ±5 %
    expect(on.u[kBack]!).toBeGreaterThan(off.u[kBack]! + 1);
    expect(off.iu[kBack]).toBe(0);
    // Background output carries no fire terms.
    expect(on.bu[kHead]).toBeCloseTo(off.bu[kHead]!, 6);
  });
});

describe('fast tier: night decoupling, slope flows, ridge wind', () => {
  const ridgeT = analyticTerrain(6000, 30, (_x, y) => 400 + 400 * Math.exp(-(y * y) / (2 * 700 * 700)));
  // Plateau (1000 m) cut by an east–west gorge 500 m deep: the valley floor sits under the ridge-top wind.
  const gorgeT = analyticTerrain(6000, 30, (_x, y) => 1000 - 500 * Math.exp(-(y * y) / (2 * 350 * 350)));
  const t0 = Date.UTC(2025, 2, 15, 17); // ≈ 04:00 local, before sunrise
  const s = seriesOf([hour(t0, 10, 0), hour(t0 + 3600e3, 10, 0)], { sourceElevation: 1000 });
  it('valley-floor wind < 2 m/s under a 10 m/s ridge wind before sunrise (sn = 1)', () => {
    const a = makeFast(gorgeT, s);
    a.setAmbient(s.hours[0]!, s.hours[1]!);
    a.setTime(t0);
    a.setSurfaceHeating(insolation(gorgeT, t0), s.hours[0]!, 20, nightState(5));
    const r = winds(a, gorgeT, ctxFor(gorgeT, { slopeFlowOn: false }));
    const g = gorgeT.grid;
    const kValley = (g.ny >> 1) * g.nx + (g.nx >> 1);
    const kRidge = 10 * g.nx + (g.nx >> 1);
    const sv = Math.hypot(r.u[kValley]!, r.v[kValley]!);
    const sr = Math.hypot(r.u[kRidge]!, r.v[kRidge]!);
    expect(sr).toBeGreaterThan(8);
    expect(sv).toBeLessThan(2);
    // Daytime (sn = 0): no decoupling.
    a.setSurfaceHeating(insolation(gorgeT, t0), s.hours[0]!, 20, nightState(0));
    const d = winds(a, gorgeT, ctxFor(gorgeT, { slopeFlowOn: false }));
    expect(Math.hypot(d.u[kValley]!, d.v[kValley]!)).toBeGreaterThan(sv * 2);
  });
  it('katabatic top-up points downslope at night; ridge wind speed-up at the crest by day', () => {
    const calm = seriesOf([hour(t0, 0.5, 90), hour(t0 + 3600e3, 0.5, 90)], { sourceElevation: 800 });
    const a = makeFast(ridgeT, calm);
    a.setAmbient(calm.hours[0]!, calm.hours[1]!);
    a.setTime(t0);
    a.setSurfaceHeating(insolation(ridgeT, t0), calm.hours[0]!, 20, nightState(0));
    const r = winds(a, ridgeT);
    const g = ridgeT.grid;
    // North flank (y ≈ +700 m) faces north: downslope = north (+v).
    const kN = Math.round((700 - g.y0) / 30) * g.nx + (g.nx >> 1);
    expect(r.v[kN]!).toBeGreaterThan(0.5);
    const d = a.diagnostics();
    expect(d.slopeFlow[kN]!).toBeGreaterThan(0.5);
    expect(d.heatFlux[kN]!).toBeLessThan(0);
  });
});

describe('fast tier: checkpoint/restore and view', () => {
  it('restore then surfaceWindForFire is bitwise equal', () => {
    const t = analyticTerrain(4000, 40, (x, y) => 500 + 200 * Math.sin(x / 700) * Math.cos(y / 900));
    const hrs: WeatherHour[] = [0, 1, 2].map((q) => hour(Date.UTC(2025, 0, 5, q), 6 + q, 250 + 40 * q));
    const s = seriesOf(hrs, { sourceElevation: 500 });
    const a = makeFast(t, s, 4000);
    a.setAmbient(hrs[0]!, hrs[1]!);
    a.setTime(hrs[0]!.time + 900e3);
    a.setSurfaceHeating(insolation(t, hrs[0]!.time), hrs[0]!, 30, nightState(0));
    const cp = structuredClone(a.checkpoint());
    a.setAmbient(hrs[1]!, hrs[2]!);
    a.setTime(hrs[1]!.time + 1200e3);
    a.step(10);
    const r1 = winds(a, t);
    a.restore(cp);
    a.setAmbient(hrs[1]!, hrs[2]!);
    a.setTime(hrs[1]!.time + 1200e3);
    a.step(10);
    const r2 = winds(a, t);
    expect(Buffer.from(r2.u.buffer).equals(Buffer.from(r1.u.buffer))).toBe(true);
    expect(Buffer.from(r2.v.buffer).equals(Buffer.from(r1.v.buffer))).toBe(true);
    const v = a.view();
    expect(v.nz).toBe(0);
    expect(v.surfaceU.length).toBe(a.grid.plane);
    expect(a.spunUp).toBe(false);
    expect(a.maxStableDt()).toBe(10);
  });
});
