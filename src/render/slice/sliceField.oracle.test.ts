/**
 * The oracle of the air slice (plan 8.8): a slice value is the engine's own value. On both tiers, a real engine on a synthetic
 * 700 m ridge publishes its view, `sampleSlice` samples a line through it, and every cell above the 10 m ground must equal the
 * engine's native `sample()` (Atmosphere.sampleAt on the 3-D tier, DiagnosticWind.sampleBg with the stamp blend on the fast
 * tier) at the same point, split into along, across and up, to 1e-3 m/s. The model's own cells must be the engine's own state
 * arrays and its own level boundaries. The same arithmetic, so differences are rounding; a difference is a bug.
 */
import { describe, expect, it } from 'vitest';
import { Atmosphere } from '../../atmosphere/atmosphere';
import { DiagnosticWind } from '../../atmosphere/diagnosticWind';
import { analyticTerrain, featuresDouble, fuelDouble, hour, nightState, seriesOf } from '../../atmosphere/testUtils';
import { sampleBilinear } from '../../core/grid';
import { Rng } from '../../core/rng';
import type { AtmosphereView, WeatherHour } from '../../core/types';
import { insolation } from '../../terrain';
import { AtmosphereSampler, type SectionLine } from '../atmosphereSampler';
import { sampleSlice } from './sliceField';
import type { SliceData, SliceFieldId } from './types';

const HOURS: WeatherHour[] = [0, 1, 2].map((q) => hour(Date.UTC(2025, 0, 5, q), 8 + q, 270 + 20 * q));
const SERIES = seriesOf(HOURS, { sourceElevation: 600 });
const RIDGE = analyticTerrain(6000, 40, (x) => 500 + 700 * Math.exp(-((x / 600) ** 2)));
const terrain = { heightAt: (x: number, y: number) => sampleBilinear(RIDGE.grid, RIDGE.elevation, x, y) };

function line(a: [number, number], b: [number, number]): SectionLine {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return { a, b, dir: [(b[0] - a[0]) / length, (b[1] - a[1]) / length], length };
}
/** Across the ridge (it runs north to south), along it, and oblique: the three give different mixes of along and across. */
const LINES: Array<[string, SectionLine]> = [
  ['across the ridge', line([-2600, 150], [2600, -150])],
  ['along the ridge', line([100, -2700], [-60, 2600])],
  ['oblique', line([-2400, -2000], [2300, 1900])],
];

function threeD(): Atmosphere {
  const a = new Atmosphere(RIDGE, undefined, fuelDouble(RIDGE.grid), featuresDouble(RIDGE), 'standard', 6000, SERIES, new Rng(3));
  a.setAmbient(HOURS[0]!, HOURS[1]!);
  a.setTime(HOURS[0]!.time);
  let t = 0;
  while (t < 150) {
    const dt = Math.min(a.maxStableDt(), 150 - t);
    a.step(dt);
    t += dt;
  }
  return a;
}

function fast(): DiagnosticWind {
  const a = new DiagnosticWind(RIDGE, undefined, fuelDouble(RIDGE.grid), featuresDouble(RIDGE), 'fast', 6000, SERIES, new Rng(4));
  a.setAmbient(HOURS[0]!, HOURS[1]!);
  a.setTime(HOURS[0]!.time + 0.37 * 3600e3); // part way between the two stamps: the blend is live
  a.setSurfaceHeating(insolation(RIDGE, HOURS[0]!.time), HOURS[0]!, 30, nightState(0));
  a.step(10);
  return a;
}

const zOf = (d: SliceData, r: number): number => (r === d.rows - 1 ? d.zMax : d.zMin + (r * (d.zMax - d.zMin)) / (d.rows - 1));

/** The worst |slice - engine| over every cell that is valid and above the 10 m ground, in each of the four wind fields (m/s). */
function oracle(engine: { sample(x: number, y: number, zAgl: number, out: Float32Array): void }, view: AtmosphereView, l: SectionLine, tag: string): SliceData {
  const d = sampleSlice(new AtmosphereSampler(view, 0, null), terrain, { line: l, shownTime: 0 })!;
  const out = new Float32Array(3);
  const worst: Record<string, number> = { along: 0, across: 0, up: 0, speed: 0 };
  let compared = 0;
  let windy = 0;
  for (let r = 0; r < d.rows; r++) {
    const z = zOf(d, r);
    for (let c = 0; c < d.columns; c++) {
      const k = r * d.columns + c;
      const s = (c / (d.columns - 1)) * l.length;
      const x = l.a[0] + l.dir[0] * s;
      const y = l.a[1] + l.dir[1] * s;
      const agl = z - terrain.heightAt(x, y);
      // Cells under the 10 m ground are not air in the picture; the engine's sample() takes a height above ground, so it cannot be asked there.
      if (!d.valid[k] || agl < 0) continue;
      engine.sample(x, y, agl, out);
      const u = out[0]!;
      const v = out[1]!;
      worst.along = Math.max(worst.along!, Math.abs(d.values.along[k]! - (u * l.dir[0] + v * l.dir[1])));
      worst.across = Math.max(worst.across!, Math.abs(d.values.across[k]! - (u * l.dir[1] - v * l.dir[0])));
      worst.up = Math.max(worst.up!, Math.abs(d.values.up[k]! - out[2]!));
      worst.speed = Math.max(worst.speed!, Math.abs(d.values.speed[k]! - Math.hypot(u, v)));
      compared++;
      if (Math.hypot(u, v) > 0.5) windy++;
    }
  }
  process.stderr.write(`[slice oracle] ${view.kind} ${tag}: worst |slice - engine sample()| along ${worst.along!.toExponential(2)}, across ${worst.across!.toExponential(2)}, up ${worst.up!.toExponential(2)}, speed ${worst.speed!.toExponential(2)} m/s over ${compared} cells (${windy} with a wind over 0.5 m/s)\n`);
  for (const key of Object.keys(worst)) expect(worst[key], `${tag}: ${key}`).toBeLessThan(1e-3);
  expect(compared, tag).toBeGreaterThan(d.valid.length * 0.4);
  expect(windy, tag).toBeGreaterThan(compared * 0.9);
  return d;
}

/** The model's own cells against the engine's arrays and metric, field by field. */
function cellsAgainstEngine(d: SliceData, view: AtmosphereView, l: SectionLine, grid: Atmosphere['grid'], native: Record<'u' | 'v' | 'w' | 'theta' | 'smoke', Float32Array | null>): void {
  const c = d.cells!;
  const nz = grid.nz;
  const plane = grid.plane;
  expect(c.levels).toBe(nz);
  expect(c.count).toBeGreaterThan(20);
  for (let q = 0; q < c.count; q++) {
    const col = c.column[q]!;
    // The boundaries of the layers of that column: the engine's faces zeta_F scaled by its metric, from its own smoothed ground to the model top.
    for (let m = 0; m <= nz; m++) expect(c.zEdges[q * (nz + 1) + m]!, `column ${col} face ${m}`).toBeCloseTo(grid.zs[col]! + grid.zetaF[m]! * grid.J[col]!, 1);
  }
  const fields: Array<[SliceFieldId, (u: number, v: number, w: number, th: number, sm: number) => number]> = [
    ['speed', (u, v) => Math.hypot(u, v)],
    ['along', (u, v) => u * l.dir[0] + v * l.dir[1]],
    ['across', (u, v) => u * l.dir[1] - v * l.dir[0]],
    ['up', (_u, _v, w) => w],
    ['smoke', (_u, _v, _w, _th, sm) => sm],
  ];
  // The temperature reference: the slice's row mean (raw anomaly = stored anomaly + the mean of its row) at the height of the cell's centre.
  const rowMean: number[] = [];
  if (native.theta) {
    const s = new AtmosphereSampler(view, 0, null);
    for (let r = 0; r < d.rows; r++) {
      let m = NaN;
      for (let col = 0; col < d.columns && Number.isNaN(m); col++) {
        const k = r * d.columns + col;
        if (!d.valid[k]) continue;
        const sm = (col / (d.columns - 1)) * l.length;
        m = s.theta(l.a[0] + l.dir[0] * sm, l.a[1] + l.dir[1] * sm, zOf(d, r)) - d.values.theta[k]!;
      }
      rowMean.push(m);
    }
  }
  const meanAt = (z: number): number => {
    const f = (z - d.zMin) / ((d.zMax - d.zMin) / (d.rows - 1));
    const r0 = Math.max(0, Math.min(d.rows - 1, Math.floor(f)));
    const r1 = Math.min(d.rows - 1, r0 + 1);
    const a = rowMean[r0]!;
    const b = rowMean[r1]!;
    if (Number.isNaN(a)) return Number.isNaN(b) ? 0 : b;
    if (Number.isNaN(b)) return a;
    return a + (b - a) * Math.max(0, Math.min(1, f - r0));
  };
  for (let q = 0; q < c.count; q++) {
    for (let m = 0; m < nz; m++) {
      const src = m * plane + c.column[q]!;
      const [u, v, w] = [native.u![src]!, native.v![src]!, native.w![src]!];
      const th = native.theta ? native.theta[src]! : 0;
      const sm = native.smoke ? native.smoke[src]! : 0;
      for (const [id, f] of fields) expect(c.values[id][q * nz + m], `${id} column ${q} level ${m}`).toBeCloseTo(f(u, v, w, th, sm), 4);
      const zc = (c.zEdges[q * (nz + 1) + m]! + c.zEdges[q * (nz + 1) + m + 1]!) / 2;
      expect(c.values.theta[q * nz + m], `theta column ${q} level ${m}`).toBeCloseTo(native.theta ? th - meanAt(zc) : 0, 3);
    }
  }
  // And the view the sampler read holds the same numbers as the engine's state (the published copy is the native array).
  expect(view.u.length).toBe(plane * nz);
}

describe('slice oracle, 3-D tier (time-stepped air)', () => {
  const atm = threeD();
  const view = atm.view();
  const st = atm.state;

  for (const [name, l] of LINES) {
    it(`${name}: along, across, up and speed equal Atmosphere.sample() at every cell above the ground, to 1e-3 m/s`, () => {
      const d = oracle(atm, view, l, name);
      expect(d.kind).toBe('prognostic');
      expect(d.has).toEqual({ wind: true, theta: true, smoke: true });
    });
  }

  it('the temperature of a slice is the engine’s own anomaly minus the row mean, and the smoke is the engine’s own', () => {
    const l = LINES[0]![1];
    const d = sampleSlice(new AtmosphereSampler(view, 0, null), terrain, { line: l, shownTime: 0 })!;
    const s = new AtmosphereSampler(view, 0, null);
    for (let r = 0; r < d.rows; r += 7) {
      const z = zOf(d, r);
      let sum = 0;
      let n = 0;
      for (let c = 0; c < d.columns; c++) {
        if (!d.valid[r * d.columns + c]) continue;
        const sm = (c / (d.columns - 1)) * l.length;
        const x = l.a[0] + l.dir[0] * sm;
        const y = l.a[1] + l.dir[1] * sm;
        sum += s.theta(x, y, z);
        n++;
        expect(d.values.smoke[r * d.columns + c]).toBeCloseTo(s.smoke(x, y, z), 5);
      }
      for (let c = 0; c < d.columns; c++) {
        if (!d.valid[r * d.columns + c]) continue;
        const sm = (c / (d.columns - 1)) * l.length;
        const raw = s.theta(l.a[0] + l.dir[0] * sm, l.a[1] + l.dir[1] * sm, z);
        expect(d.values.theta[r * d.columns + c]).toBeCloseTo(raw - sum / n, 4);
      }
    }
  });

  for (const [name, l] of LINES) {
    it(`${name}: the model's own cells are the engine's state arrays and its own level boundaries`, () => {
      const d = sampleSlice(new AtmosphereSampler(view, 0, null), terrain, { line: l, shownTime: 0 })!;
      cellsAgainstEngine(d, view, l, atm.grid, { u: st.uc, v: st.vc, w: st.wc, theta: st.theta, smoke: st.smoke });
    });
  }

  it('the ground the slice reports is the 10 m terrain and the model’s own smoothed ground, which differ over the ridge', () => {
    const l = LINES[0]![1];
    const d = sampleSlice(new AtmosphereSampler(view, 0, null), terrain, { line: l, shownTime: 0 })!;
    let worst = 0;
    for (let c = 0; c < d.columns; c++) {
      const s = (c / (d.columns - 1)) * l.length;
      const x = l.a[0] + l.dir[0] * s;
      const y = l.a[1] + l.dir[1] * s;
      expect(d.ground[c]).toBeCloseTo(terrain.heightAt(x, y), 3);
      worst = Math.max(worst, Math.abs(d.ground[c]! - d.modelGround[c]!));
    }
    expect(worst).toBeGreaterThan(1); // the model smooths the ridge: the two lines are not the same line
  });
});

describe('slice oracle, fast tier (diagnosed wind)', () => {
  const eng = fast();
  const view = eng.view();

  for (const [name, l] of LINES) {
    it(`${name}: along, across, up and speed equal DiagnosticWind.sample() (the stamp blend included) at every cell above the ground, to 1e-3 m/s`, () => {
      const d = oracle(eng, view, l, name);
      expect(d.kind).toBe('diagnosed');
      expect(d.has).toEqual({ wind: true, theta: false, smoke: false });
      expect(d.values.theta.every((x) => x === 0) && d.values.smoke.every((x) => x === 0)).toBe(true);
    });
  }

  it('the model’s own cells are the published diagnosed volume, with the engine’s level boundaries and no temperature or smoke', () => {
    const l = LINES[2]![1];
    const d = sampleSlice(new AtmosphereSampler(view, 0, null), terrain, { line: l, shownTime: 0 })!;
    cellsAgainstEngine(d, view, l, eng.grid, { u: view.u, v: view.v, w: view.w, theta: null, smoke: null });
    expect(d.cells!.values.theta.every((x) => x === 0)).toBe(true);
  });
});
