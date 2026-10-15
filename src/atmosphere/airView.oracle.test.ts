/**
 * The air views the two engines publish (plan section 7.2 and 7.3), checked against the engines' own samplers:
 *   - Atmosphere.view() is the terrain-following layout of the native arrays, and the render sampler on it equals the
 *     engine's own `sample()`;
 *   - DiagnosticWind.view() publishes the stamp-blended diagnosed wind (kind 'diagnosed', no temperature or smoke), and the
 *     render sampler on it equals the engine's own `sample()` (sampleBg) at any point of the blend;
 *   - reading a view changes nothing (purity), a restored checkpoint gives the same bytes, and a wind edit shows in the
 *     diagnosed field only from the stamps at or after its time.
 * The sampler's own behaviour (both layouts, guards, allocation) is in render/atmosphereSampler.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { sampleBilinear } from '../core/grid';
import { Rng } from '../core/rng';
import type { AtmosphereView, Terrain, WeatherHour, WindEdit } from '../core/types';
import { AtmosphereSampler } from '../render/atmosphereSampler';
import { Atmosphere } from './atmosphere';
import { DiagnosticWind } from './diagnosticWind';
import { analyticTerrain, featuresDouble, fuelDouble, hour, nightState, seriesOf } from './testUtils';
import { insolation } from '../terrain';

const HOURS: WeatherHour[] = [0, 1, 2].map((q) => hour(Date.UTC(2025, 0, 5, q), 8 + q, 270 + 20 * q));
const SERIES = seriesOf(HOURS, { sourceElevation: 600 });
const RIDGE = analyticTerrain(6000, 40, (x) => 500 + 700 * Math.exp(-((x / 600) ** 2)));
const bytes = (a: Float32Array): Buffer => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
const same = (a: Float32Array, b: Float32Array): boolean => a.length === b.length && bytes(a).equals(bytes(b));
const sameView = (a: AtmosphereView, b: AtmosphereView): boolean =>
  (['levels', 'terrainHeight', 'surfaceU', 'surfaceV', 'u', 'v', 'w', 'thetaAnomaly', 'smoke'] as const).every((k) => same(a[k], b[k])) &&
  a.layout === b.layout && a.kind === b.kind && a.topM === b.topM && a.baseM === b.baseM && a.nz === b.nz;

function atmosphere(spinS: number, spinOnly = false): Atmosphere {
  const a = new Atmosphere(RIDGE, undefined, fuelDouble(RIDGE.grid), featuresDouble(RIDGE), 'standard', 6000, SERIES, new Rng(3));
  a.setAmbient(HOURS[0]!, HOURS[1]!);
  a.setTime(HOURS[0]!.time);
  if (!spinOnly) advance(a, spinS);
  return a;
}
function advance(a: Atmosphere, seconds: number, onStep?: () => void): void {
  let t = 0;
  while (t < seconds - 1e-9) {
    const dt = Math.min(a.maxStableDt(), seconds - t);
    a.step(dt);
    onStep?.();
    t += dt;
  }
}

function fast(terrain: Terrain = RIDGE, extra: WindEdit[] = []): DiagnosticWind {
  const a = new DiagnosticWind(terrain, undefined, fuelDouble(terrain.grid), featuresDouble(terrain), 'fast', 6000, SERIES, new Rng(4));
  if (extra.length) a.setWindEdits(extra, HOURS[0]!.time);
  a.setAmbient(HOURS[0]!, HOURS[1]!);
  a.setTime(HOURS[0]!.time + 0.37 * 3600e3);
  a.setSurfaceHeating(insolation(terrain, HOURS[0]!.time), HOURS[0]!, 30, nightState(0));
  a.step(10);
  return a;
}

/** Random points over the domain, heights above the ground that stress the bottom of the column. */
function oraclePoints(n: number, seed: number): Array<{ x: number; y: number; agl: number }> {
  const rng = new Rng(seed);
  const g = RIDGE.grid;
  const heights = [0, 0.5, 2, 5, 10, 30, 60, 100, 250, 600, 1200, 2000];
  return Array.from({ length: n }, (_, q) => ({
    x: g.x0 + rng.range(0.05, 0.95) * (g.nx - 1) * g.cellSize,
    y: g.y0 + rng.range(0.05, 0.95) * (g.ny - 1) * g.cellSize,
    agl: heights[q % heights.length]!,
  }));
}

/** The worst |sampler − engine| over the points, in m/s, and how many of them held a real wind. */
function oracle(engine: { sample(x: number, y: number, z: number, out: Float32Array): void }, view: AtmosphereView, n: number): { worst: number; windy: number } {
  const s = new AtmosphereSampler(view, 0, null);
  const out = new Float32Array(3);
  const got = new Float32Array(3);
  const pos = new Float64Array(4);
  let worst = 0;
  let windy = 0;
  for (const p of oraclePoints(n, 91)) {
    engine.sample(p.x, p.y, p.agl, out);
    pos[0] = p.x;
    pos[1] = p.y;
    pos[2] = sampleBilinear(RIDGE.grid, RIDGE.elevation, p.x, p.y) + p.agl;
    s.windP(pos, got);
    for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(got[k]! - out[k]!));
    if (Math.hypot(out[0]!, out[1]!) > 0.5) windy++;
  }
  process.stderr.write(`[air oracle] ${view.kind}: worst |sampler - engine sample()| ${worst.toExponential(2)} m/s over ${n} points (${windy} with a wind over 0.5 m/s)\n`);
  return { worst, windy };
}

describe('Atmosphere.view(): the terrain-following layout of the native arrays', () => {
  const a = atmosphere(150);
  const v = a.view();
  const g = a.grid;

  it('says what it is and carries the model’s own top, datum and levels', () => {
    expect(v.layout).toBe('terrain-following');
    expect(v.kind).toBe('prognostic');
    expect(v.topM).toBe(g.Hp);
    expect(v.baseM).toBe(g.zMin);
    expect(v.nz).toBe(g.nz);
    expect(Array.from(v.levels)).toEqual(Array.from(g.zetaC, (z) => Math.fround(z)));
    for (const c of [0, 700, g.plane - 1]) expect(v.terrainHeight[c]).toBe(Math.fround(g.zs[c]! - g.zMin));
    // `time` is the orchestrator's stamp (sim/simulation.ts makeSnapshot): the engine's own view leaves it out.
    expect(v.time).toBeUndefined();
  });

  it('is copies of the engine’s centre arrays, index for index (k x plane + column)', () => {
    const st = a.state;
    expect(same(v.u, st.uc) && same(v.v, st.vc) && same(v.w, st.wc)).toBe(true);
    expect(same(v.thetaAnomaly, st.theta) && same(v.smoke, st.smoke)).toBe(true);
    expect(v.u.buffer).not.toBe(st.uc.buffer); // fresh arrays: a snapshot's buffers are transferred and detach
    expect(v.u.length).toBe(g.plane * g.nz);
  });

  it('has no zero cell under the ridge, where the old flat resample had thousands', () => {
    let zeros = 0;
    for (let k = 0; k < v.u.length; k++) if (v.u[k] === 0 && v.v[k] === 0) zeros++;
    expect(zeros).toBe(0);
  });

  it('the sampler on it equals the engine’s own sample() at 1200 points from the ground to 2000 m, to 1e-3 m/s', () => {
    const r = oracle(a, v, 1200);
    expect(r.worst).toBeLessThan(1e-3);
    expect(r.windy).toBeGreaterThan(1000);
  });

  it('is pure: two calls give the same bytes, and reading it between steps changes nothing that follows', () => {
    expect(sameView(a.view(), a.view())).toBe(true);
    const quiet = atmosphere(0, true);
    const curious = atmosphere(0, true);
    advance(quiet, 120);
    let views = 0;
    advance(curious, 120, () => {
      curious.view();
      views++;
    });
    expect(views).toBeGreaterThan(5);
    expect(sameView(quiet.view(), curious.view())).toBe(true);
    expect(same(quiet.state.theta, curious.state.theta)).toBe(true);
  });

  it('a restored checkpoint gives bitwise-identical view arrays', () => {
    const b = atmosphere(60);
    const cp = structuredClone(b.checkpoint());
    const before = b.view();
    advance(b, 60);
    expect(sameView(b.view(), before)).toBe(false);
    b.restore(cp);
    b.setAmbient(HOURS[0]!, HOURS[1]!);
    b.setTime(HOURS[0]!.time);
    expect(sameView(b.view(), before)).toBe(true);
  });
});

describe('DiagnosticWind.view(): the fast tier’s diagnosed wind', () => {
  const a = fast();
  const v = a.view();
  const g = a.grid;

  it('publishes a terrain-following volume of the wind only, kind diagnosed', () => {
    expect(v.nz).toBe(g.nz);
    expect(v.nz).toBeGreaterThan(0);
    expect(v.layout).toBe('terrain-following');
    expect(v.kind).toBe('diagnosed');
    expect(v.topM).toBe(g.Hp);
    expect(v.baseM).toBe(g.zMin);
    expect(v.levels.length).toBe(g.nz);
    expect(v.u.length).toBe(g.plane * g.nz);
    expect(v.v.length).toBe(g.plane * g.nz);
    expect(v.w.length).toBe(g.plane * g.nz);
    expect(v.thetaAnomaly.length).toBe(0);
    expect(v.smoke.length).toBe(0);
    expect(v.surfaceU.length).toBe(g.plane);
    expect(v.terrainHeight.length).toBe(g.plane);
    let zeros = 0;
    for (let k = 0; k < v.u.length; k++) if (v.u[k] === 0 && v.v[k] === 0) zeros++;
    expect(zeros).toBe(0);
  });

  it('the sampler on it equals the engine’s own sample() (sampleBg, with the stamp blend) at 1200 points, to 1e-3 m/s', () => {
    const r = oracle(a, v, 1200);
    expect(r.worst).toBeLessThan(1e-3);
    expect(r.windy).toBeGreaterThan(1000);
  });

  it('follows the blend between the two stamps: the oracle holds at 0, 37 and 100 % of the hour, and the field moves between them', () => {
    const b = fast();
    const views: AtmosphereView[] = [];
    for (const f of [0, 0.37, 1]) {
      b.setTime(HOURS[0]!.time + f * 3600e3);
      b.step(10);
      const w = b.view();
      expect(oracle(b, w, 300).worst, `blend ${f}`).toBeLessThan(1e-3);
      views.push(w);
    }
    expect(same(views[0]!.u, views[1]!.u)).toBe(false);
    expect(same(views[1]!.u, views[2]!.u)).toBe(false);
  });

  it('is pure: two calls give the same bytes, and a restored checkpoint gives the same view', () => {
    expect(sameView(a.view(), a.view())).toBe(true);
    const b = fast();
    const cp = structuredClone(b.checkpoint());
    const before = b.view();
    b.setTime(HOURS[0]!.time + 0.8 * 3600e3);
    b.step(10);
    expect(sameView(b.view(), before)).toBe(false);
    b.restore(cp);
    b.setAmbient(HOURS[0]!, HOURS[1]!);
    b.setTime(HOURS[0]!.time + 0.37 * 3600e3);
    b.step(10);
    expect(sameView(b.view(), before)).toBe(true);
  });

  it('shows a wind edit only from the stamps at or after its time, ramping in over the hour', () => {
    // An edit that applies from the second stamp (t = 1 h): the stamp pair is hour 0 and hour 1.
    const edit: WindEdit = { kind: 'wind', id: 'e', x: 0, y: 0, radius: 900, speed: 18, dir: 90, time: 3600 };
    const plain = fast();
    const edited = fast(RIDGE, [edit]);
    const at = (e: DiagnosticWind, f: number): AtmosphereView => {
      e.setTime(HOURS[0]!.time + f * 3600e3);
      e.step(10);
      return e.view();
    };
    // At the first stamp the edit has not started: the two fields are the same bytes.
    expect(sameView(at(plain, 0), at(edited, 0))).toBe(true);
    // Half way in, the edited stamp counts for half; at the second stamp, fully. The difference is linear in the blend.
    const half = [at(plain, 0.5), at(edited, 0.5)] as const;
    const full = [at(plain, 1), at(edited, 1)] as const;
    let maxHalf = 0;
    let maxFull = 0;
    let worstLinear = 0;
    for (let k = 0; k < half[0].u.length; k++) {
      const dh = half[1].u[k]! - half[0].u[k]!;
      const df = full[1].u[k]! - full[0].u[k]!;
      maxHalf = Math.max(maxHalf, Math.abs(dh));
      maxFull = Math.max(maxFull, Math.abs(df));
      worstLinear = Math.max(worstLinear, Math.abs(dh - 0.5 * df));
    }
    expect(maxFull).toBeGreaterThan(1); // the edit is felt
    expect(maxHalf).toBeGreaterThan(0.3 * maxFull);
    expect(maxHalf).toBeLessThan(0.7 * maxFull);
    expect(worstLinear).toBeLessThan(1e-3 * Math.max(1, maxFull));
    // Far from the edit (the domain corners, about 4 km away) it is a small fraction of what it is at the edit.
    const ag = a.grid;
    for (const c of [3 + 3 * ag.nx, ag.nx - 4 + (ag.ny - 4) * ag.nx]) {
      expect(Math.abs(full[1].u[c]! - full[0].u[c]!)).toBeLessThan(0.1 * maxFull);
    }
  });
});
