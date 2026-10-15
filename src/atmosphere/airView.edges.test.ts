/**
 * A second oracle for the air view and sampler v2, written to reach what the random-point oracle of `airView.oracle.test.ts`
 * does not: the render sampler on a published view against the engines' own `sample()` (Atmosphere.sampleAt,
 * DiagnosticWind.sampleBg) exactly on column nodes, on and beyond the domain edge and corners, exactly on every level centre
 * and just either side of it, below the first level, at the top and above it, on a steep real DEM (Katoomba) and on a cliff
 * step, across the fast tier's sub-stamps and a wind edit; a whole `sampleSlice` (values and validity mask) edge to edge on
 * steep ground; and fields that are empty, short or hold a NaN.
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import type { AtmosphereView, WeatherHour, WindEdit } from '../core/types';
import { AtmosphereSampler } from '../render/atmosphereSampler';
import { sampleBilinear } from '../core/grid';
import { sampleSlice } from '../render/slice/sliceField';
import { insolation } from '../terrain';
import { Atmosphere } from './atmosphere';
import { DiagnosticWind } from './diagnosticWind';
import { analyticTerrain, featuresDouble, fuelDouble, hour, katoombaTerrain, nightState, seriesOf } from './testUtils';
import type { Terrain } from '../core/types';

const HOURS: WeatherHour[] = [0, 1, 2].map((q) => hour(Date.UTC(2025, 0, 5, q), 8 + q, 270 + 20 * q));
const SERIES = seriesOf(HOURS, { sourceElevation: 600 });
const TOL = 1e-3;

/** A cliff 180 m high across the middle of the domain plus a conical hill: nothing smooth about it. */
const CLIFF = analyticTerrain(6000, 40, (x, y) => 400 + (x > 0 ? 180 : 0) + 500 * Math.max(0, 1 - Math.hypot(x + 1500, y - 800) / 700));
const FLAT = analyticTerrain(6000, 40, () => 650);

interface Engine {
  sample(x: number, y: number, zAgl: number, out: Float32Array): void;
  view(): AtmosphereView;
}
type WithGround = { groundAt(x: number, y: number): number; grid: { nx: number; ny: number; dx: number; Hp: number; zMin: number; nz: number; plane: number; zetaC: Float64Array; J: Float64Array; zs: Float64Array; grid: { x0: number; y0: number } } };

function standard(terrain: Terrain): Atmosphere {
  const a = new Atmosphere(terrain, undefined, fuelDouble(terrain.grid), featuresDouble(terrain), 'standard', 6000, SERIES, new Rng(3));
  a.setAmbient(HOURS[0]!, HOURS[1]!);
  a.setTime(HOURS[0]!.time);
  let t = 0;
  while (t < 120 - 1e-9) {
    const dt = Math.min(a.maxStableDt(), 120 - t);
    a.step(dt);
    t += dt;
  }
  return a;
}
function fast(terrain: Terrain, edits: WindEdit[] = [], frac = 0.37): DiagnosticWind {
  const a = new DiagnosticWind(terrain, undefined, fuelDouble(terrain.grid), featuresDouble(terrain), 'fast', 6000, SERIES, new Rng(4));
  if (edits.length) a.setWindEdits(edits, HOURS[0]!.time);
  a.setAmbient(HOURS[0]!, HOURS[1]!);
  a.setTime(HOURS[0]!.time + frac * 3600e3);
  a.setSurfaceHeating(insolation(terrain, HOURS[0]!.time), HOURS[0]!, 30, nightState(0));
  a.step(10);
  return a;
}

interface P {
  x: number;
  y: number;
  agl: number;
  tag: string;
}

/** The points: nodes, edges, corners, outside, every level boundary and the two sides of it, below the first level, the top and above. */
function points(eng: WithGround, seed: number): P[] {
  const g = eng.grid;
  const x0 = g.grid.x0;
  const y0 = g.grid.y0;
  const xe = x0 + (g.nx - 1) * g.dx;
  const ye = y0 + (g.ny - 1) * g.dx;
  const rng = new Rng(seed);
  const out: P[] = [];
  const xy: Array<[number, number, string]> = [
    [x0, y0, 'corner'],
    [xe, y0, 'corner'],
    [x0, ye, 'corner'],
    [xe, ye, 'corner'],
    [x0 + 1e-9, y0 + 0.5 * g.dx, 'edge'],
    [xe - 1e-9, ye - 0.5 * g.dx, 'edge'],
    [x0 - 300, y0 + 2000, 'outside'],
    [xe + 300, ye - 1000, 'outside'],
    [x0 + 2000, y0 - 500, 'outside'],
    [x0 + 3000, ye + 500, 'outside'],
  ];
  for (let q = 0; q < 12; q++) {
    const i = 1 + Math.floor(rng.next() * (g.nx - 2));
    const j = 1 + Math.floor(rng.next() * (g.ny - 2));
    xy.push([x0 + i * g.dx, y0 + j * g.dx, 'node']);
    xy.push([x0 + (i + rng.next()) * g.dx, y0 + (j + rng.next()) * g.dx, 'interior']);
  }
  for (const [x, y, tag] of xy) {
    const ground = eng.groundAt(x, y);
    // Heights in the engine's own terms (above the fire-grid ground at the point).
    const c = Math.min(g.ny - 1, Math.max(0, Math.round((y - y0) / g.dx))) * g.nx + Math.min(g.nx - 1, Math.max(0, Math.round((x - x0) / g.dx)));
    const zsC = g.zs[c]!;
    const aglOfZeta = (zeta: number): number => zsC + zeta * g.J[c]! - ground;
    const hs: number[] = [0, 0.001, 0.5, 1.9, 5, 30, 120, 800, 1999];
    for (let k = 0; k < g.nz; k++) {
      const e = aglOfZeta(g.zetaC[k]!);
      for (const d of [-1e-3, 0, 1e-3]) hs.push(e + d);
    }
    hs.push(aglOfZeta(g.zetaC[0]! * 0.5), aglOfZeta(g.zetaC[0]! * 0.999), aglOfZeta(g.zetaC[0]! * 1.001));
    hs.push(aglOfZeta(g.Hp * 0.999), aglOfZeta(g.Hp * 0.9999));
    for (const agl of hs) if (agl >= 0 && Number.isFinite(agl)) out.push({ x, y, agl, tag });
  }
  return out;
}

interface Worst {
  worst: number;
  at: string;
  n: number;
}
function compare(eng: Engine & WithGround, view: AtmosphereView, pts: P[]): Record<string, Worst> {
  const s = new AtmosphereSampler(view, 0, null);
  const ref = new Float32Array(3);
  const got = new Float32Array(3);
  const all = new Float32Array(5);
  const pos = new Float64Array(4);
  const res: Record<string, Worst> = {};
  for (const p of pts) {
    eng.sample(p.x, p.y, p.agl, ref);
    const zAsl = eng.groundAt(p.x, p.y) + Math.max(0, p.agl);
    pos[0] = p.x;
    pos[1] = p.y;
    pos[2] = zAsl;
    pos[3] = p.agl;
    s.windP(pos, got);
    const r = (res[p.tag] ??= { worst: 0, at: '', n: 0 });
    r.n++;
    let d = 0;
    for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(got[k]! - ref[k]!));
    // The other three entry points must agree with windP bit for bit.
    s.fieldsP(pos, all);
    const boxed = new Float32Array(3);
    s.wind(p.x, p.y, zAsl, p.agl, boxed);
    for (let k = 0; k < 3; k++) {
      expect(all[k]).toBe(got[k]);
      expect(boxed[k]).toBe(got[k]);
    }
    expect(Math.fround(s.sample3(view.u, p.x, p.y, zAsl))).toBe(got[0]);
    if (!(d <= r.worst)) {
      r.worst = d;
      r.at = `${p.tag} (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) agl ${p.agl.toFixed(4)} engine [${Array.from(ref).map((q) => q.toFixed(4))}] sampler [${Array.from(got).map((q) => q.toFixed(4))}]`;
    }
  }
  return res;
}

function report(name: string, r: Record<string, Worst>): void {
  for (const [tag, w] of Object.entries(r)) process.stderr.write(`[verify oracle] ${name} ${tag}: worst ${w.worst.toExponential(2)} m/s over ${w.n} points\n`);
}

describe('verifier oracle: the sampler on the published view equals the engine sample() everywhere inside the model', () => {
  for (const [terrainName, terrain] of [['cliff step + cone', CLIFF], ['flat ground', FLAT]] as const) {
    it(`standard tier, ${terrainName}: nodes, edges, corners, outside, every level centre and its two sides`, () => {
      const a = standard(terrain);
      const r = compare(a as unknown as Engine & WithGround, a.view(), points(a as unknown as WithGround, 5));
      report(`prognostic/${terrainName}`, r);
      for (const [tag, w] of Object.entries(r)) expect(w.worst, `${tag}: ${w.at}`).toBeLessThan(TOL);
    });
    it(`fast tier (stamp blend 0.37), ${terrainName}`, () => {
      const a = fast(terrain);
      const r = compare(a as unknown as Engine & WithGround, a.view(), points(a as unknown as WithGround, 6));
      report(`diagnosed/${terrainName}`, r);
      for (const [tag, w] of Object.entries(r)) expect(w.worst, `${tag}: ${w.at}`).toBeLessThan(TOL);
    });
  }

  it('fast tier with a wind edit, at blend 0, 0.5 and 1 of the hour, on the cliff terrain', () => {
    const edit: WindEdit = { kind: 'wind', id: 'e1', x: -500, y: 500, radius: 900, speed: 18, dir: 90, time: 600 };
    for (const frac of [0, 0.5, 0.9999]) {
      const a = fast(CLIFF, [edit], frac);
      const r = compare(a as unknown as Engine & WithGround, a.view(), points(a as unknown as WithGround, 7));
      report(`diagnosed+edit@${frac}`, r);
      for (const [tag, w] of Object.entries(r)) expect(w.worst, `${tag}: ${w.at}`).toBeLessThan(TOL);
    }
  });

  it('fast tier across sub-stamps (a 90 degree wind change in the hour), at every sub-stamp edge, midway, at the end of the hour and past it', () => {
    const turning = [hour(Date.UTC(2025, 0, 5, 0), 9, 250), hour(Date.UTC(2025, 0, 5, 1), 14, 340), hour(Date.UTC(2025, 0, 5, 2), 12, 20)];
    const series = seriesOf(turning, { sourceElevation: 600 });
    let worstAll = 0;
    for (const frac of [0, 0.1666, 0.25, 0.5, 0.75, 0.8333, 1, 1.4]) {
      const a = new DiagnosticWind(CLIFF, undefined, fuelDouble(CLIFF.grid), featuresDouble(CLIFF), 'fast', 6000, series, new Rng(4));
      a.setAmbient(turning[0]!, turning[1]!);
      a.setTime(turning[0]!.time + frac * 3600e3);
      a.setSurfaceHeating(insolation(CLIFF, turning[0]!.time), turning[0]!, 30, nightState(0));
      a.step(10);
      const r = compare(a as unknown as Engine & WithGround, a.view(), points(a as unknown as WithGround, 11));
      for (const [tag, w] of Object.entries(r)) {
        worstAll = Math.max(worstAll, w.worst);
        expect(w.worst, `frac ${frac} ${tag}: ${w.at}`).toBeLessThan(TOL);
      }
    }
    process.stderr.write(`[verify oracle] diagnosed across sub-stamps: worst ${worstAll.toExponential(2)} m/s\n`);
  });

  it('steep real terrain (Katoomba, 6 km, 30 m cells), both tiers', async () => {
    const { terrain, hiRes } = await katoombaTerrain(6000, 30);
    const a = new Atmosphere(terrain, hiRes, fuelDouble(terrain.grid), featuresDouble(terrain), 'standard', 6000, SERIES, new Rng(3));
    a.setAmbient(HOURS[0]!, HOURS[1]!);
    a.setTime(HOURS[0]!.time);
    for (let t = 0; t < 90; ) {
      const dt = Math.min(a.maxStableDt(), 90 - t);
      a.step(dt);
      t += dt;
    }
    const r1 = compare(a as unknown as Engine & WithGround, a.view(), points(a as unknown as WithGround, 8));
    report('prognostic/Katoomba', r1);
    for (const [tag, w] of Object.entries(r1)) expect(w.worst, `${tag}: ${w.at}`).toBeLessThan(TOL);
    const f = new DiagnosticWind(terrain, hiRes, fuelDouble(terrain.grid), featuresDouble(terrain), 'fast', 6000, SERIES, new Rng(4));
    f.setAmbient(HOURS[0]!, HOURS[1]!);
    f.setTime(HOURS[0]!.time + 0.61 * 3600e3);
    f.setSurfaceHeating(insolation(terrain, HOURS[0]!.time), HOURS[0]!, 30, nightState(0));
    f.step(10);
    const r2 = compare(f as unknown as Engine & WithGround, f.view(), points(f as unknown as WithGround, 9));
    report('diagnosed/Katoomba', r2);
    for (const [tag, w] of Object.entries(r2)) expect(w.worst, `${tag}: ${w.at}`).toBeLessThan(TOL);
  }, 120_000);
});

describe('verifier oracle: a whole slice against the engine sample() on real steep terrain, both tiers', () => {
  it('every valid lattice cell of sampleSlice equals the engine at that point (speed, along, across, up), the mask is the model ground and top, edge to edge', async () => {
    const { terrain, hiRes } = await katoombaTerrain(6000, 30);
    const mk = {
      prog: (): Engine & WithGround & { view(): AtmosphereView } => {
        const a = new Atmosphere(terrain, hiRes, fuelDouble(terrain.grid), featuresDouble(terrain), 'standard', 6000, SERIES, new Rng(3));
        a.setAmbient(HOURS[0]!, HOURS[1]!);
        a.setTime(HOURS[0]!.time);
        for (let t = 0; t < 90; ) {
          const dt = Math.min(a.maxStableDt(), 90 - t);
          a.step(dt);
          t += dt;
        }
        return a as never;
      },
      diag: (): Engine & WithGround & { view(): AtmosphereView } => {
        const f = new DiagnosticWind(terrain, hiRes, fuelDouble(terrain.grid), featuresDouble(terrain), 'fast', 6000, SERIES, new Rng(4));
        f.setAmbient(HOURS[0]!, HOURS[1]!);
        f.setTime(HOURS[0]!.time + 0.61 * 3600e3);
        f.setSurfaceHeating(insolation(terrain, HOURS[0]!.time), HOURS[0]!, 30, nightState(0));
        f.step(10);
        return f as never;
      },
    };
    for (const [name, make] of Object.entries(mk)) {
      const eng = make();
      const view = eng.view();
      const sampler = new AtmosphereSampler(view, 0, null);
      const g = view.grid;
      const xe = g.x0 + (g.nx - 1) * g.cellSize;
      const ye = g.y0 + (g.ny - 1) * g.cellSize;
      const dem = { heightAt: (x: number, y: number): number => sampleBilinear(hiRes.grid, hiRes.elevation, x, y) };
      const lines: Array<[string, [number, number], [number, number]]> = [
        ['edge to edge (west to east, through the middle)', [g.x0, (g.y0 + ye) / 2], [xe, (g.y0 + ye) / 2]],
        ['corner to corner', [g.x0, g.y0], [xe, ye]],
        ['across the escarpment', [-2900, 400], [-1200, 1700]],
        ['short, inside', [-300, -200], [150, 250]],
      ];
      for (const [label, a, b] of lines) {
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const dir: [number, number] = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
        const sd = sampleSlice(sampler, dem, { line: { a, b, dir, length }, shownTime: 100 });
        expect(sd, `${name} ${label}`).not.toBeNull();
        const d = sd!;
        const out = new Float32Array(3);
        let worst = 0;
        let checked = 0;
        let maskWrong = 0;
        let skippedBelowFireGround = 0;
        for (let r = 0; r < d.rows; r++) {
          const z = d.zMin + (r * (d.zMax - d.zMin)) / (d.rows - 1);
          for (let c = 0; c < d.columns; c++) {
            const s = (c / (d.columns - 1)) * length;
            const x = a[0] + dir[0] * s;
            const y = a[1] + dir[1] * s;
            const mg = view.baseM! + sampleBilinear(g, view.terrainHeight, x, y);
            const inside = z >= mg && z <= view.baseM! + view.topM!;
            const near = Math.abs(z - mg) < 0.01 || Math.abs(z - (view.baseM! + view.topM!)) < 0.01;
            const i = r * d.columns + c;
            if (!near && (d.valid[i] === 1) !== inside) maskWrong++;
            if (d.valid[i] !== 1) {
              expect(d.values.speed[i], 'invalid cells hold 0').toBe(0);
              continue;
            }
            const ground = eng.groundAt(x, y);
            if (z < ground) {
              skippedBelowFireGround++;
              continue;
            }
            eng.sample(x, y, z - ground, out);
            const along = out[0]! * dir[0] + out[1]! * dir[1];
            const across = out[0]! * dir[1] - out[1]! * dir[0];
            worst = Math.max(worst, Math.abs(d.values.speed[i]! - Math.hypot(out[0]!, out[1]!)), Math.abs(d.values.along[i]! - along), Math.abs(d.values.across[i]! - across), Math.abs(d.values.up[i]! - out[2]!));
            checked++;
          }
        }
        process.stderr.write(`[verify slice] ${name} ${label}: ${d.columns}x${d.rows}, ${checked} valid cells checked (${skippedBelowFireGround} below the fire-grid ground skipped), worst ${worst.toExponential(2)} m/s, mask differences ${maskWrong}\n`);
        expect(checked, `${name} ${label}`).toBeGreaterThan(500);
        expect(worst, `${name} ${label}`).toBeLessThan(TOL);
        expect(maskWrong, `${name} ${label} mask`).toBe(0);
      }
    }
  }, 180_000);
});

describe('verifier oracle: above the model top and below the ground', () => {
  it('above the top the sampler holds the top level, the engine the profile wind with w = 0 (documented), and neither is NaN', () => {
    for (const eng of [standard(CLIFF), fast(CLIFF)]) {
      const v = eng.view();
      const e = eng as unknown as WithGround & Engine;
      const s = new AtmosphereSampler(v, 0, null);
      const pos = new Float64Array(4);
      const out = new Float32Array(3);
      const at = new Float32Array(3);
      const ref = new Float32Array(3);
      const top = e.grid.zMin + e.grid.Hp;
      expect(s.top).toBeCloseTo(top, 3);
      for (const [x, y] of [[-2000, 0], [0, 0], [1800, -2400]] as const) {
        pos[0] = x;
        pos[1] = y;
        pos[2] = top;
        s.windP(pos, at);
        for (const dz of [1, 50, 500, 5000]) {
          pos[2] = top + dz;
          s.windP(pos, out);
          for (let k = 0; k < 3; k++) {
            expect(Number.isFinite(out[k])).toBe(true);
            expect(out[k]).toBeCloseTo(at[k]!, 4); // the top level, held
          }
          e.sample(x, y, top + dz - e.groundAt(x, y), ref);
          expect(ref[2]).toBe(0); // the engine's lid
        }
      }
    }
  });

  it('far below the ground (a slice under a hill) clamps to level 0, like the engine does for any point under a column`s own ground', () => {
    const a = standard(CLIFF);
    const s = new AtmosphereSampler(a.view(), 0, null);
    const pos = new Float64Array([-1500, 800, 0, 0]);
    const lo = new Float32Array(3);
    const mid = new Float32Array(3);
    s.windP(pos, lo);
    pos[2] = -1e6;
    s.windP(pos, mid);
    for (let k = 0; k < 3; k++) expect(mid[k]).toBe(lo[k]);
  });
});

describe('verifier oracle: fields that are empty, partly empty or hold a NaN', () => {
  const view = (): AtmosphereView => (standard(CLIFF).view());
  it('an empty u, v or w array means no wind at all (ambient fallback), never a read past the end', () => {
    for (const drop of ['u', 'v', 'w'] as const) {
      const v = { ...view(), [drop]: new Float32Array(0) } as AtmosphereView;
      const s = new AtmosphereSampler(v, 0, hour(0, 6, 270));
      expect(s.hasWind).toBe(false);
      const out = new Float32Array(3);
      s.wind(0, 0, 900, 100, out);
      for (const q of out) expect(Number.isFinite(q)).toBe(true);
      const pos = new Float64Array([0, 0, 900, 100]);
      const all = new Float32Array(5);
      s.fieldsP(pos, all);
      for (const q of all) expect(Number.isFinite(q)).toBe(true);
    }
  });
  it('a wrong-sized (short) array is treated as absent, not read out of bounds', () => {
    const v0 = view();
    const v = { ...v0, thetaAnomaly: v0.thetaAnomaly.slice(0, v0.thetaAnomaly.length - 1), smoke: v0.smoke.slice(0, 10) } as AtmosphereView;
    const s = new AtmosphereSampler(v, 0, null);
    expect(s.hasTheta).toBe(false);
    expect(s.hasSmoke).toBe(false);
    expect(s.theta(0, 0, 900)).toBe(0);
    expect(s.smoke(0, 0, 900)).toBe(0);
    expect(s.sample3(v.thetaAnomaly, 0, 0, 900)).toBe(0); // the short-array guard of sample3
  });
  it('a NaN cell only poisons the samples that touch it (the engine would do the same)', () => {
    const v0 = view();
    const g = v0.grid;
    const u = v0.u.slice();
    const plane = g.nx * g.ny;
    const c = 20 * g.nx + 20;
    u[3 * plane + c] = NaN;
    const s = new AtmosphereSampler({ ...v0, u }, 0, null);
    const out = new Float32Array(3);
    s.windP(new Float64Array([g.x0 + 5 * g.cellSize, g.y0 + 5 * g.cellSize, 1500, 0]), out);
    expect(Number.isFinite(out[0])).toBe(true);
    // At the poisoned node, at that level.
    const zAsl = v0.baseM! + v0.terrainHeight[c]! + v0.levels[3]! * (1 - v0.terrainHeight[c]! / v0.topM!);
    s.windP(new Float64Array([g.x0 + 20 * g.cellSize, g.y0 + 20 * g.cellSize, zAsl, 0]), out);
    expect(Number.isNaN(out[0])).toBe(true);
    expect(Number.isFinite(out[1])).toBe(true);
  });
  it('a NaN or infinite position never hangs and never reads out of bounds', () => {
    const s = new AtmosphereSampler(view(), 0, null);
    const out = new Float32Array(3);
    for (const p of [[NaN, 0, 900], [0, NaN, 900], [0, 0, NaN], [Infinity, 0, 900], [0, -Infinity, 900], [0, 0, Infinity], [0, 0, -Infinity]]) {
      s.windP(new Float64Array([p[0]!, p[1]!, p[2]!, 0]), out);
      for (const q of out) expect(typeof q).toBe('number');
    }
  });
});
