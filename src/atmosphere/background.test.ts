/**
 * Background wind, grid and profile (spec §8.1–§8.3, §8.5, §8.9, §8.10): mass-consistent solve on flat terrain and
 * over the Katoomba DEM (no drift of φ), extra 10-min stamps on direction changes, user wind edits through u₀,
 * κ / profile fixture checks, synthetic upper air, grid geometry and canopy, diagnostics and turbulence inputs.
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { windToUV, uvToWind, angleDiffDeg } from '../core/units';
import { buildTerrain } from '../terrain';
import { insolation } from '../terrain';
import { buildAtmosGrid } from './grid';
import { MassConsistentSolver, facesToCentres } from './massConsistent';
import { buildProfile, profileWind, thetaRaw } from './profile';
import { DiagnosticWind } from './diagnosticWind';
import { Atmosphere } from './atmosphere';
import { ATMOS_PARAMS } from './params';
import { cellAt, ctxFor, featuresDouble, fireWinds, flatTerrain, fuelDouble, hour, katoombaTerrain, nightState, parseOpenMeteoFixture, seriesOf } from './testUtils';

describe('§8.3 mass-consistent u_bg', () => {
  it('flat terrain: the solve leaves the first-guess profile unchanged (w = 0) and κ maps it back to U10', () => {
    const t = flatTerrain(6000, 30, 700);
    const w = hour(Date.UTC(2025, 0, 5, 3), 7, 250, { windProfile: [{ heightAGL: 80, speed: 10.5, dir: 262 }] });
    const s = seriesOf([w], { sourceElevation: 700 });
    const g = buildAtmosGrid(t, undefined, undefined, 'standard', 6000);
    const mc = new MassConsistentSolver(g);
    const p = buildProfile(w, s, g.zMin, g.relief);
    const bg = mc.solve(p, [], null);
    const u0 = new Float32Array(g.nU);
    const v0 = new Float32Array(g.nV);
    const w0 = new Float32Array(g.nW);
    mc.firstGuess(p, [], u0, v0, w0);
    let du = 0;
    for (let q = 0; q < g.nU; q++) du = Math.max(du, Math.abs(bg.u[q]! - u0[q]!));
    let wm = 0;
    for (let q = 0; q < g.nW; q++) wm = Math.max(wm, Math.abs(bg.w[q]!));
    expect(du).toBeLessThan(1e-4);
    expect(wm).toBeLessThan(1e-4);
    // Profile samples: 10 m and 80 m are reproduced exactly by u_prof.
    const o = new Float64Array(2);
    profileWind(p, 80, o);
    expect(Math.hypot(o[0]!, o[1]!)).toBeCloseTo(10.5, 6);
    expect(uvToWind(o[0]!, o[1]!)[1]).toBeCloseTo(262, 4);
  });

  it('Katoomba DEM: converges to 1e-6 with the §8.3 boundaries; a warm-started re-solve does not drift φ', async () => {
    const { terrain, hiRes } = await katoombaTerrain(6000, 30);
    const w = hour(Date.UTC(2025, 0, 5, 3), 9, 300);
    const s = seriesOf([w], { sourceElevation: 715 });
    const g = buildAtmosGrid(terrain, hiRes, undefined, 'standard', 6000);
    const mc = new MassConsistentSolver(g);
    const p = buildProfile(w, s, g.zMin, g.relief);
    const a = mc.solve(p, [], null);
    expect(a.result.relResidual).toBeLessThan(ATMOS_PARAMS.mcTol);
    const b = mc.solve(p, [], a.phi);
    let dphi = 0;
    let ref = 0;
    for (let q = 0; q < g.n; q++) {
      dphi = Math.max(dphi, Math.abs(b.phi[q]! - a.phi[q]!));
      ref = Math.max(ref, Math.abs(a.phi[q]!));
    }
    expect(dphi / ref).toBeLessThan(1e-5);
    // Divergence-free: max|∇·u|·Δx/|u| ≪ 1e-3.
    const div = new Float64Array(g.n);
    mc.solver.divergence(a.u, a.v, a.w, div);
    let worst = 0;
    for (let k = 0; k < g.nz; k++) for (let c = 0; c < g.plane; c++) worst = Math.max(worst, Math.abs(div[k * g.plane + c]!) / (g.J[c]! * g.dx * g.dx * g.dzeta[k]!));
    expect((worst * g.dx) / 9).toBeLessThan(1e-4);
    // Terrain effects: flow speeds up over the plateau edge relative to the first guess somewhere, and the rebuilt
    // background from φ (checkpoint path) is bitwise identical.
    const r = mc.fromPotential(p, [], a.phi);
    expect(Buffer.from(r.u.buffer).equals(Buffer.from(a.u.buffer))).toBe(true);
    const uc = new Float32Array(g.n);
    const vc = new Float32Array(g.n);
    const wc = new Float32Array(g.n);
    facesToCentres(g, a.u, a.v, a.w, uc, vc, wc);
    let maxS = 0;
    for (let c = 0; c < g.plane; c++) maxS = Math.max(maxS, Math.hypot(uc[c]!, vc[c]!));
    const o = new Float64Array(2);
    profileWind(p, g.zetaC[0]!, o);
    expect(maxS).toBeGreaterThan(1.15 * Math.hypot(o[0]!, o[1]!));
  }, 60000);

  it('extra 10-min stamps when the direction changes by > 20° between hourly stamps', () => {
    const t = flatTerrain(3000, 30, 500);
    const hrs = [hour(Date.UTC(2025, 0, 5, 3), 8, 300), hour(Date.UTC(2025, 0, 5, 4), 8, 200)];
    const a = new DiagnosticWind(t, undefined, fuelDouble(t.grid), featuresDouble(t), 'fast', 3000, seriesOf(hrs, { sourceElevation: 500 }), new Rng(1));
    a.setAmbient(hrs[0]!, hrs[1]!);
    const seq = (a as unknown as { seq: { hour: { time: number; windDir10: number } }[] }).seq;
    expect(seq.length).toBe(7);
    expect(seq[1]!.hour.time - seq[0]!.hour.time).toBe(600e3);
    // Mid-ramp the fire wind follows the interpolated direction.
    a.setTime(hrs[0]!.time + 1800e3);
    const r = fireWinds(a, t);
    const k = cellAt(t, 0, 0);
    const [, dir] = uvToWind(r.u[k]!, r.v[k]!);
    expect(Math.abs(angleDiffDeg(dir, 250))).toBeLessThan(3);
    // No extra stamps for a small change.
    a.setAmbient(hrs[0]!, { ...hrs[1]!, windDir10: 290 });
    expect(seq.length).toBe(7); // old array untouched …
    expect((a as unknown as { seq: unknown[] }).seq.length).toBe(2); // … new sequence has two stamps
  });

  it('user wind edits enter only through u₀: local wind follows the edit, far field unchanged', () => {
    const t = flatTerrain(6000, 30, 500);
    const hrs = [hour(Date.UTC(2025, 0, 5, 3), 5, 270), hour(Date.UTC(2025, 0, 5, 4), 5, 270)];
    const s = seriesOf(hrs, { sourceElevation: 500 });
    const a = new DiagnosticWind(t, undefined, fuelDouble(t.grid), featuresDouble(t), 'fast', 6000, s, new Rng(1), {
      windEdits: [{ kind: 'wind', id: 'e1', time: 0, x: 0, y: 0, radius: 1200, speed: 5, dir: 200 }],
      scenarioStartMs: hrs[0]!.time,
    });
    a.setAmbient(hrs[0]!, hrs[1]!);
    a.setTime(hrs[0]!.time);
    const r = fireWinds(a, t);
    const kc = cellAt(t, 0, 0);
    const [sp, dir] = uvToWind(r.u[kc]!, r.v[kc]!);
    expect(Math.abs(angleDiffDeg(dir, 200))).toBeLessThan(25);
    expect(sp).toBeGreaterThan(3);
    const kf = cellAt(t, -2700, 2700);
    const [spF, dirF] = uvToWind(r.u[kf]!, r.v[kf]!);
    expect(Math.abs(spF - 5) / 5).toBeLessThan(0.05);
    expect(Math.abs(angleDiffDeg(dirF, 270))).toBeLessThan(5);
  });
});

describe('§8.2 profile and κ', () => {
  it('Katoomba forecast fixture: median U80/U10 = 1.51 (the κ scale the forecast implies)', () => {
    const s = parseOpenMeteoFixture('openmeteo-forecast-katoomba.json');
    const o = new Float64Array(2);
    const ratios: number[] = [];
    for (const w of s.hours) {
      if (w.windSpeed10 < 1) continue;
      const p = buildProfile(w, s, 700, 300);
      profileWind(p, 80, o);
      ratios.push(Math.hypot(o[0]!, o[1]!) / w.windSpeed10);
    }
    ratios.sort((a, b) => a - b);
    const med = ratios[ratios.length >> 1]!;
    expect(med).toBeGreaterThan(1.46);
    expect(med).toBeLessThan(1.56);
  });

  it('synthetic upper air: day θ constant to BLH then 3.3 K/km; night 3.3 K/km throughout; power-law wind to 1 km', () => {
    const lat = -33.7;
    const day = hour(Date.UTC(2025, 0, 5, 3), 6, 270, { boundaryLayerHeight: 1200 }); // 14:00 local
    const night = hour(Date.UTC(2025, 0, 5, 16), 6, 270); // 03:00 local
    const s = seriesOf([day, night], { sourceElevation: 700, upperAirSource: 'synthetic', location: { lat, lon: 150.3 } });
    const pd = buildProfile(day, s, 700, 300);
    expect(pd.synthetic).toBe(true);
    expect(thetaRaw(pd, 700 + 1100) - thetaRaw(pd, 702)).toBeCloseTo(0, 6);
    expect((thetaRaw(pd, 700 + 2200) - thetaRaw(pd, 700 + 1200)) / 1000).toBeCloseTo(3.3e-3, 5);
    const pn = buildProfile(night, s, 700, 300);
    expect((thetaRaw(pn, 1500) - thetaRaw(pn, 800)) / 700).toBeCloseTo(3.3e-3, 5);
    const o = new Float64Array(2);
    profileWind(pn, 10, o);
    const u10 = Math.hypot(o[0]!, o[1]!);
    profileWind(pn, 1000, o);
    expect(Math.hypot(o[0]!, o[1]!) / u10).toBeCloseTo((1000 / 10) ** 0.14, 3);
    profileWind(pn, 2500, o);
    expect(Math.hypot(o[0]!, o[1]!) / u10).toBeCloseTo((1000 / 10) ** 0.14, 3);
  });
});

describe('§8.1 grid geometry and canopy', () => {
  it('Katoomba 6 km standard: 45×45×20, Δx 133 m, max slope ≤ 35° after smoothing, ΣΔζ = H′, n_D 5, forest C_D 0.030', async () => {
    const { terrain, hiRes } = await katoombaTerrain(6000, 30);
    const g = buildAtmosGrid(terrain, hiRes, fuelDouble(terrain.grid, undefined, 20, 0.5), 'standard', 6000);
    expect([g.nx, g.ny, g.nz]).toEqual([45, 45, 20]);
    expect(g.dx).toBeCloseTo(6000 / 45, 6);
    expect(g.maxSlopeDeg).toBeLessThanOrEqual(35);
    let sum = 0;
    for (let k = 0; k < g.nz; k++) sum += g.dzeta[k]!;
    expect(sum).toBeCloseTo(g.Hp, 6);
    expect(g.dzeta[0]).toBeCloseTo(30, 1);
    expect(g.Hp).toBeGreaterThanOrEqual(3000);
    expect(g.nDavies).toBe(5);
    expect(g.cd[0]).toBeCloseTo(0.03, 6);
    // Valley floor: never above the column terrain.
    for (let c = 0; c < g.plane; c++) expect(g.zFloor[c]!).toBeLessThanOrEqual(g.zs[c]! + 1e-3);
  });

  it('fallback without the 10 m DEM uses the fire-grid terrain', () => {
    const t = buildTerrain(flatTerrain(3000, 30, 812).grid, new Float32Array(100 * 100).fill(812), 'flat');
    const g = buildAtmosGrid(t, undefined, undefined, 'standard', 3000);
    expect(g.dx).toBe(100);
    expect(g.zs[0]).toBeCloseTo(812, 6);
    expect(g.relief).toBeCloseTo(0, 6);
  });
});

describe('§8.9/§8.10 diagnostics, turbulence and air temperature', () => {
  it('fast tier: night inversion from the §5.2a state, break ETA after sunrise, similarity z_i day/night', () => {
    const t = flatTerrain(3000, 30, 500);
    const t0 = Date.UTC(2025, 2, 14, 21); // ≈ 08:00 local, sun up
    const hrs = [hour(t0, 1, 0), hour(t0 + 3600e3, 1, 0)];
    const a = new DiagnosticWind(t, undefined, fuelDouble(t.grid), featuresDouble(t), 'fast', 3000, seriesOf(hrs, { sourceElevation: 500 }), new Rng(1));
    a.setAmbient(hrs[0]!, hrs[1]!);
    a.setTime(t0);
    a.setSurfaceHeating(insolation(t, t0), hrs[0]!, 20, nightState(4, 150));
    const d = a.diagnostics();
    expect(d.inversion.present).toBe(true);
    expect(d.inversion.dTheta).toBeGreaterThan(3);
    expect(d.inversion.breakEta).not.toBeNull();
    expect(d.inversion.breakEta!).toBeGreaterThan(0);
    expect(d.cHaines).toBeNull(); // synthetic/none upper air
    expect(d.spunUp).toBe(false);
    const out = new Float32Array(3);
    a.sampleTurb(0, 0, 20, out);
    expect(out[0]).toBe(ATMOS_PARAMS.defaultMixedLayer);
    expect(out[1]).toBeGreaterThan(0); // w* by day
    expect(out[2]).toBeGreaterThan(0);
    const tn = Date.UTC(2025, 2, 14, 15); // 02:00 local
    const b = new DiagnosticWind(t, undefined, fuelDouble(t.grid), featuresDouble(t), 'fast', 3000, seriesOf([hour(tn, 3, 0), hour(tn + 3600e3, 3, 0)], { sourceElevation: 500 }), new Rng(1));
    b.setAmbient(hour(tn, 3, 0), hour(tn + 3600e3, 3, 0));
    b.setTime(tn);
    b.sampleTurb(0, 0, 20, out);
    expect(out[0]).toBe(ATMOS_PARAMS.nightZi);
    expect(out[1]).toBe(0);
  });

  it('airAt: the fast tier returns the §5.2 template; the 3-D tier equals it at t0 and warms sunlit ground', () => {
    const t = flatTerrain(3000, 30, 900);
    const t0 = Date.UTC(2025, 0, 5, 1); // 12:00 local
    const hrs = [hour(t0, 1, 0, { temperature: 25 }), hour(t0 + 3600e3, 1, 0, { temperature: 26 })];
    const s = seriesOf(hrs, { sourceElevation: 700 });
    const n = t.grid.nx * t.grid.ny;
    const T = new Float32Array(n);
    const R = new Float32Array(n);
    const f = new DiagnosticWind(t, undefined, fuelDouble(t.grid), featuresDouble(t), 'fast', 3000, s, new Rng(1));
    f.setAmbient(hrs[0]!, hrs[1]!);
    f.setTime(t0);
    f.airAt(t.grid, T, R);
    // Γ = 6.5 + 3.3·(sun ≥ 15°)·(BLH 1500 ≥ 1.25·relief) = 9.8 K/km over 200 m.
    expect(T[0]).toBeCloseTo(25 - 9.8 * 0.2, 3);
    expect(R[0]).toBeGreaterThan(1.0);
    expect(R[0]).toBeLessThan(1.1);
    const a = new Atmosphere(t, undefined, fuelDouble(t.grid), featuresDouble(t), 'standard', 3000, s, new Rng(1));
    a.setAmbient(hrs[0]!, hrs[1]!);
    a.setTime(t0);
    a.setSurfaceHeating(insolation(t, t0), hrs[0]!, 20, nightState(0));
    const T3 = new Float32Array(n);
    a.airAt(t.grid, T3, R);
    expect(T3[500]).toBeCloseTo(T[500]!, 4);
    for (let q = 0; q < 60; q++) a.step(10);
    a.airAt(t.grid, T3, R);
    const k = cellAt(t, 0, 0);
    expect(T3[k]! - T[k]!).toBeGreaterThan(0.05);
    expect(T3[k]! - T[k]!).toBeLessThan(5);
  }, 60000);

  it('fire-wind κ and U10 scale: the reported κ(50 m) equals |u_prof(10)|/|û(50)| on flat terrain', () => {
    const t = flatTerrain(3000, 30, 500);
    const w = hour(Date.UTC(2025, 0, 5, 3), 6, 270, { windProfile: [{ heightAGL: 80, speed: 9, dir: 270 }] });
    const a = new DiagnosticWind(t, undefined, fuelDouble(t.grid, undefined, 0, 0), featuresDouble(t), 'fast', 3000, seriesOf([w, { ...w, time: w.time + 3600e3 }], { sourceElevation: 500 }), new Rng(1));
    a.setAmbient(w, { ...w, time: w.time + 3600e3 });
    a.setTime(w.time);
    const d = a.diagnostics();
    expect(d.kappa).toBeGreaterThan(0.6);
    expect(d.kappa).toBeLessThan(0.9);
    const r = fireWinds(a, t, ctxFor(t));
    const [u10] = windToUV(6, 270);
    expect(r.u[cellAt(t, 0, 0)]!).toBeCloseTo(u10, 2);
  });
});
