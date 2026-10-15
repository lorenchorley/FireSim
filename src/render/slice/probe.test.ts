/**
 * The probe: readings from the stored arrays on a rotated line, the four `where` cases, the keyboard, the sentence in both
 * kinds and both units, and the "from" wind with its compass word.
 */
import { describe, expect, it } from 'vitest';
import { windToUV } from '../../core/units';
import { moveProbe, probeAt, probeSentence, windFromDeg } from './probe';
import { AtmosphereSampler, type SectionLine } from '../atmosphereSampler';
import { Rng } from '../../core/rng';
import { makeGridSpec } from '../../core/grid';
import { sampleSlice } from './sliceField';
import { makeAirView, makeSliceData } from './testing';
import type { SliceProbeReading } from './types';

const ms = (kmh: number): number => kmh / 3.6;

describe('windFromDeg', () => {
  it('is the direction the wind comes FROM, clockwise from north, in [0, 360)', () => {
    expect(windFromDeg(5, 0)).toBeCloseTo(270, 9); // blowing east: from the west
    expect(windFromDeg(-5, 0)).toBeCloseTo(90, 9);
    expect(windFromDeg(0, 5)).toBeCloseTo(180, 9); // blowing north: from the south
    expect(windFromDeg(0, -5)).toBeCloseTo(0, 9);
    expect(windFromDeg(-1, -1)).toBeCloseTo(45, 9);
    expect(windFromDeg(1, 1)).toBeCloseTo(225, 9);
    for (let deg = 0; deg < 360; deg += 7.5) {
      const [u, v] = windToUV(3.3, deg);
      expect(windFromDeg(u, v)).toBeCloseTo(deg, 6);
    }
    for (const [u, v] of [[0, 0], [1e-12, -1e-12], [-3, 4], [3, -4]]) {
      const d = windFromDeg(u!, v!);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThan(360);
    }
    expect(windFromDeg(0, 0)).toBe(0);
  });
});

describe('probeAt: readings', () => {
  it('reads a uniform wind on a line rotated 45 degrees, with the wind named by where it comes from', () => {
    const [u, v] = [3, 4];
    const d = makeSliceData({ a: [0, 0], b: [2000, 2000], wind: () => [u, v, 0.5], theta: () => 0, ground: () => 100 });
    const r = probeAt(d, { s: 1000, z: 800 });
    expect(r.where).toBe('air');
    expect(r.speed).toBeCloseTo(5, 5);
    // dir = (1, 1)/sqrt 2: along = (3 + 4)/sqrt 2, across = (3 - 4)/sqrt 2 (negative: the air goes to the LEFT of A to B).
    expect(r.along).toBeCloseTo(7 / Math.SQRT2, 5);
    expect(r.across).toBeCloseTo(-1 / Math.SQRT2, 5);
    expect(r.up).toBeCloseTo(0.5, 6);
    // The wind blows towards azimuth atan2(3, 4) = 36.87 degrees, so it comes from 216.87: south-west.
    expect(r.fromDeg).toBeCloseTo(216.87, 2);
    expect(r.fromWord).toBe('south-west');
    expect(r.pos).toEqual({ s: 1000, z: 800 });
    expect(r.x).toBeCloseTo(1000 / Math.SQRT2, 6);
    expect(r.y).toBeCloseTo(1000 / Math.SQRT2, 6);
    expect(r.aglM).toBeCloseTo(700, 4);
  });

  it('says west for a wind blowing east, north-west for one blowing south-east, on a line that points the wrong way', () => {
    const east = makeSliceData({ a: [3000, 0], b: [0, 0], wind: () => [6, 0, 0] }); // the line runs westwards, against the wind
    const r = probeAt(east, { s: 1500, z: 900 });
    expect(r.along).toBeCloseTo(-6, 5);
    expect(r.across).toBeCloseTo(0, 5);
    expect(r.fromDeg).toBeCloseTo(270, 4);
    expect(r.fromWord).toBe('west');
    const se = probeAt(makeSliceData({ a: [0, 0], b: [0, 3000], wind: () => windToUV(8, 315).concat(0) as [number, number, number] }), { s: 700, z: 900 });
    expect(se.fromWord).toBe('north-west');
    expect(se.fromDeg).toBeCloseTo(315, 4);
  });

  it('a linear shear is read exactly between lattice points (bilinear on the stored arrays)', () => {
    const d = makeSliceData({ columns: 41, rows: 33, a: [0, 0], b: [4000, 0], zMin: 0, zMax: 2000, ground: () => -50, wind: (s, z) => [2 + 0.004 * z + 0.0005 * s, 1 - 0.001 * z, 0.0002 * s] });
    for (const [s, z] of [[123.4, 456.7], [3999, 1999], [2000, 1000], [57.3, 11.9]] as const) {
      const r = probeAt(d, { s, z });
      const u = 2 + 0.004 * z + 0.0005 * s;
      const v = 1 - 0.001 * z;
      expect(r.along, `${s},${z}`).toBeCloseTo(u, 3);
      expect(r.across, `${s},${z}`).toBeCloseTo(-v, 3); // line due east: across = u dy - v dx = -v
      expect(r.up, `${s},${z}`).toBeCloseTo(0.0002 * s, 3);
    }
  });

  it('reads the stored fields at a lattice point exactly', () => {
    const d = makeSliceData({ columns: 21, rows: 11, a: [0, 0], b: [2000, 0], zMin: 0, zMax: 1000, ground: () => -10, wind: (s, z) => [s / 100 + 1, z / 100, 0.1 * (s / 100)], theta: (s) => s / 1000, smoke: (_s, z) => z / 500 });
    const c = 7;
    const rr = 4;
    const k = rr * d.columns + c;
    const r = probeAt(d, { s: (c / (d.columns - 1)) * 2000, z: (rr / (d.rows - 1)) * 1000 });
    expect(r.speed).toBeCloseTo(d.values.speed[k]!, 5);
    expect(r.along).toBeCloseTo(d.values.along[k]!, 5);
    expect(r.across).toBeCloseTo(d.values.across[k]!, 5);
    expect(r.up).toBeCloseTo(d.values.up[k]!, 5);
    expect(r.thetaK).toBeCloseTo(d.values.theta[k]!, 5);
    expect(r.smoke).toBeCloseTo(d.values.smoke[k]!, 5);
  });

  it('a point just above the model ground is not diluted by the invalid cells under it', () => {
    // The model's ground rises from 100 to 700 m over the line; cells under it hold zeros. A naive bilinear read there is low.
    const d = makeSliceData({ columns: 31, rows: 41, a: [0, 0], b: [3000, 0], zMin: 0, zMax: 2000, ground: (s) => 100 + (600 * s) / 3000, wind: () => [5, 0, 0] });
    for (const s of [500, 1500, 2500]) {
      const mg = 100 + (600 * s) / 3000;
      for (const above of [0.5, 5, 30]) {
        const r = probeAt(d, { s, z: mg + above });
        expect(r.where, `${s} +${above}`).toBe('air');
        expect(r.speed).toBeCloseTo(5, 4);
        expect(r.along).toBeCloseTo(5, 4);
      }
    }
  });

  it('reports a calm without a direction', () => {
    const d = makeSliceData({ wind: () => [0.05, 0.05, 0] });
    const r = probeAt(d, { s: 1000, z: 500 });
    expect(r.where).toBe('air');
    expect(r.fromDeg).toBeNull();
    expect(r.fromWord).toBeNull();
    expect(r.speed).toBeCloseTo(Math.hypot(0.05, 0.05), 5);
  });

  it('temperature is null where the air has none (the diagnosed kind), and so is smoke', () => {
    const d = makeSliceData({ kind: 'diagnosed' });
    const r = probeAt(d, { s: 1000, z: 500 });
    expect(r.thetaK).toBeNull();
    expect(r.smoke).toBeNull();
    const p = probeAt(makeSliceData({ kind: 'prognostic', theta: (s) => (s > 1500 ? 3 : -1) }), { s: 2500, z: 500 });
    expect(p.thetaK).not.toBeNull();
    expect(p.smoke).not.toBeNull();
  });

  it('the temperature is the slice anomaly: warmer than the row average is positive', () => {
    const d = makeSliceData({ columns: 41, theta: (s) => (s > 1500 ? 4 : 0) });
    const warm = probeAt(d, { s: 2800, z: 900 });
    const cool = probeAt(d, { s: 200, z: 900 });
    expect(warm.thetaK!).toBeGreaterThan(0);
    expect(cool.thetaK!).toBeLessThan(0);
    // The two halves of the row differ by 4 K, the row mean is 0 over the valid cells.
    expect(warm.thetaK! - cool.thetaK!).toBeCloseTo(4, 3);
  });
});

describe('probeAt: where', () => {
  // The 10 m ground is 300 m; the model's own ground is 300 m on the left and a smoothed 500 m on the right (the valley the model fills).
  const d = makeSliceData({ columns: 61, rows: 61, zMin: 0, zMax: 2000, topAsl: 2500, ground: () => 300, modelGround: (s) => (s < 1500 ? 300 : 500) });

  it('in-ground: under the 10 m ground', () => {
    const r = probeAt(d, { s: 500, z: 250 });
    expect(r.where).toBe('in-ground');
    expect(r.aglM).toBeCloseTo(-50, 5);
    expect([r.speed, r.along, r.across, r.up, r.fromDeg, r.fromWord, r.thetaK, r.smoke]).toEqual([null, null, null, null, null, null, null, null]);
  });

  it('below-model: above the 10 m ground but under the model’s own ground', () => {
    const r = probeAt(d, { s: 2500, z: 400 });
    expect(r.where).toBe('below-model');
    expect(r.aglM).toBeCloseTo(100, 5);
    expect(r.speed).toBeNull();
    expect(r.up).toBeNull();
  });

  it('air: above both', () => {
    const r = probeAt(d, { s: 2500, z: 900 });
    expect(r.where).toBe('air');
    expect(r.speed).not.toBeNull();
  });

  it('above-model: over the model top (reachable only when the height axis runs past it)', () => {
    const tall = makeSliceData({ zMin: 0, zMax: 3000, topAsl: 2500, ground: () => 100 });
    const r = probeAt(tall, { s: 1000, z: 2800 });
    expect(r.where).toBe('above-model');
    expect(r.speed).toBeNull();
    expect(probeAt(tall, { s: 1000, z: 2400 }).where).toBe('air');
  });

  it('in-ground wins where the model ground is lower than the 10 m ground (a crest the model smooths away)', () => {
    const crest = makeSliceData({ ground: () => 600, modelGround: () => 300, zMin: 0, zMax: 2000 });
    expect(probeAt(crest, { s: 1000, z: 500 }).where).toBe('in-ground');
    expect(probeAt(crest, { s: 1000, z: 650 }).where).toBe('air');
  });

  it('interpolates the ground between columns: the height above ground and the in-ground test follow the slope', () => {
    const slope = makeSliceData({ columns: 31, rows: 41, a: [0, 0], b: [3000, 0], zMin: 0, zMax: 2000, ground: (s) => 100 + s / 5, wind: () => [3, 0, 0] });
    const r = probeAt(slope, { s: 1234.5, z: 700 });
    expect(r.aglM).toBeCloseTo(700 - (100 + 1234.5 / 5), 3);
    expect(probeAt(slope, { s: 1234.5, z: 100 + 1234.5 / 5 - 5 }).where).toBe('in-ground');
  });
});

describe('probeAt: clamping and the pin', () => {
  const d = makeSliceData({ a: [100, 200], b: [100, 2200], zMin: 0, zMax: 1500, ground: () => 50 });

  it('clamps the position into the slice and puts the pin at a + dir x s', () => {
    const r = probeAt(d, { s: -50, z: -300 });
    expect(r.pos).toEqual({ s: 0, z: 0 });
    expect(r.x).toBeCloseTo(100, 9);
    expect(r.y).toBeCloseTo(200, 9);
    const q = probeAt(d, { s: 99999, z: 99999 });
    expect(q.pos).toEqual({ s: 2000, z: 1500 });
    expect(q.x).toBeCloseTo(100, 9);
    expect(q.y).toBeCloseTo(2200, 9);
    const m = probeAt(d, { s: 500, z: 700 });
    expect(m.x).toBeCloseTo(100, 9);
    expect(m.y).toBeCloseTo(700, 9);
  });

  it('survives a position that is not a number', () => {
    const r = probeAt(d, { s: NaN, z: NaN });
    expect(Number.isFinite(r.pos.s) && Number.isFinite(r.pos.z)).toBe(true);
  });
});

describe('moveProbe: the keyboard', () => {
  const d = makeSliceData({ columns: 61, rows: 41, a: [0, 0], b: [6000, 0], zMin: 200, zMax: 2200 });
  const ds = 6000 / 60;
  const dz = 2000 / 40;

  it('moves one lattice step per key, right towards B and up upwards', () => {
    const p = { s: 3000, z: 1000 };
    expect(moveProbe(d, p, 'right')).toEqual({ s: 3000 + ds, z: 1000 });
    expect(moveProbe(d, p, 'left')).toEqual({ s: 3000 - ds, z: 1000 });
    expect(moveProbe(d, p, 'up')).toEqual({ s: 3000, z: 1000 + dz });
    expect(moveProbe(d, p, 'down')).toEqual({ s: 3000, z: 1000 - dz });
  });

  it('moves a quarter of the axis when big', () => {
    const p = { s: 3000, z: 1000 };
    expect(moveProbe(d, p, 'right', true)).toEqual({ s: 4500, z: 1000 });
    expect(moveProbe(d, p, 'down', true)).toEqual({ s: 3000, z: 500 });
  });

  it('starts from the middle of the slice when there is no probe yet', () => {
    expect(moveProbe(d, null, 'right')).toEqual({ s: 3000 + ds, z: 1200 });
    expect(moveProbe(d, null, 'up')).toEqual({ s: 3000, z: 1200 + dz });
    expect(moveProbe(d, null, 'left', true)).toEqual({ s: 1500, z: 1200 });
  });

  it('never leaves the slice, by any number of presses from any start', () => {
    let p = { s: 10, z: 210 };
    for (let i = 0; i < 20; i++) p = moveProbe(d, p, 'left', i % 2 === 0);
    expect(p.s).toBe(0);
    for (let i = 0; i < 20; i++) p = moveProbe(d, p, 'down', true);
    expect(p.z).toBe(200);
    let q = { s: 5990, z: 2190 };
    for (let i = 0; i < 20; i++) q = moveProbe(d, moveProbe(d, q, 'right', true), 'up', true);
    expect(q).toEqual({ s: 6000, z: 2200 });
    // A position that was already outside is brought back in.
    expect(moveProbe(d, { s: 9e6, z: -9e6 }, 'left')).toEqual({ s: 6000 - ds, z: 200 });
  });

  it('every key press ends at a position probeAt can read', () => {
    let p: ReturnType<typeof moveProbe> | null = null;
    for (const key of ['right', 'right', 'up', 'left', 'down', 'down', 'right'] as const) {
      p = moveProbe(d, p, key);
      expect(probeAt(d, p).pos).toEqual(p);
    }
  });
});

describe('probeSentence', () => {
  const air = (o: Partial<SliceProbeReading> = {}): SliceProbeReading => ({
    pos: { s: 1000, z: 900 },
    x: 0,
    y: 0,
    aglM: 60,
    where: 'air',
    speed: ms(32),
    along: ms(28),
    across: 0.1,
    up: 1.4,
    fromDeg: 315,
    fromWord: 'north-west',
    thetaK: 3,
    smoke: null,
    ...o,
  });
  const kmh = { units: 'kmh', kind: 'prognostic' } as const;

  it('reads the plan’s example exactly', () => {
    expect(probeSentence(air(), kmh)).toBe('Wind about 32 km/h from the north-west, along the line 28 km/h towards B, up 1.4 m/s, 60 m above ground, 3 K warmer than the area');
  });

  it('says towards A for a negative along, to the right or left for across, down for a negative up, cooler for a negative anomaly', () => {
    expect(probeSentence(air({ along: -ms(10), across: 0.05 }), kmh)).toContain('along the line 10 km/h towards A');
    expect(probeSentence(air({ across: ms(12) }), kmh)).toContain('across the line 12 km/h to the right');
    expect(probeSentence(air({ across: -ms(12) }), kmh)).toContain('across the line 12 km/h to the left');
    expect(probeSentence(air({ up: -2.25 }), kmh)).toContain('down 2.3 m/s');
    expect(probeSentence(air({ up: 0.01 }), kmh)).not.toMatch(/\b(up|down)\b/);
    expect(probeSentence(air({ thetaK: -2.4 }), kmh)).toMatch(/2\.4 K cooler than the area$/);
    expect(probeSentence(air({ thetaK: 0.2 }), kmh)).toMatch(/about the same temperature as the area$/);
  });

  it('gives the temperature clause only for the time-stepped kind and only when the air has one', () => {
    expect(probeSentence(air(), { units: 'kmh', kind: 'diagnosed' })).not.toMatch(/\bK\b/);
    expect(probeSentence(air({ thetaK: null }), kmh)).not.toMatch(/\bK\b/);
    expect(probeSentence(air(), kmh)).toMatch(/\bK warmer\b/);
  });

  it('speaks in m/s when asked, with a decimal below 10, but the vertical stays in m/s either way', () => {
    expect(probeSentence(air({ speed: 9.44, along: 8.1, across: 0 }), { units: 'ms', kind: 'prognostic' })).toBe(
      'Wind about 9.4 m/s from the north-west, along the line 8.1 m/s towards B, up 1.4 m/s, 60 m above ground, 3 K warmer than the area',
    );
    expect(probeSentence(air({ speed: 14.2, along: 12.6 }), { units: 'ms', kind: 'diagnosed' })).toBe('Wind about 14 m/s from the north-west, along the line 13 m/s towards B, up 1.4 m/s, 60 m above ground');
  });

  it('names a calm and a height at the ground', () => {
    expect(probeSentence(air({ speed: 0.1, along: 0.05, across: 0, up: 0, fromDeg: null, fromWord: null, aglM: 0.4, thetaK: null }), kmh)).toBe('Calm, at ground level');
  });

  it('rounds the height above ground: whole metres up to 20, tens above', () => {
    expect(probeSentence(air({ aglM: 7.4 }), kmh)).toContain(', 7 m above ground');
    expect(probeSentence(air({ aglM: 183 }), kmh)).toContain(', 180 m above ground');
    expect(probeSentence(air({ aglM: 1250 }), kmh)).toContain(', 1250 m above ground');
  });

  it('one short sentence when the point is not in the model’s air', () => {
    const none = { speed: null, along: null, across: null, up: null, fromDeg: null, fromWord: null, thetaK: null, smoke: null };
    expect(probeSentence(air({ ...none, where: 'in-ground', aglM: -12 }), kmh)).toBe('Inside the ground');
    expect(probeSentence(air({ ...none, where: 'below-model' }), kmh)).toBe("Below the model's ground: the model has no air here");
    expect(probeSentence(air({ ...none, where: 'above-model' }), kmh)).toBe('Above the top of the model');
  });

  it('reads a real probe end to end', () => {
    const d = makeSliceData({ a: [0, 0], b: [3000, 0], wind: () => [ms(28), ms(5), 1], theta: (s) => (s > 1500 ? 2 : 0), ground: () => 100 });
    const s = probeSentence(probeAt(d, { s: 2600, z: 400 }), kmh);
    expect(s).toMatch(/^Wind about 28 km\/h from the west, along the line 28 km\/h towards B, across the line 5 km\/h to the left, up 1(\.0)? m\/s, 300 m above ground, \d(\.\d)? K (warmer|cooler) than the area$/);
  });
});

describe('probeAt on a slice the sampler made', () => {
  // A gentle slope (the four columns around a point have about the same ground) and fields linear in x, y and height: bilinear
  // reads of the stored lattice are then exact, so the probe equals the analytic field anywhere in the model's air.
  const ground = (x: number): number => 500 + 0.05 * x;
  const fu = (x: number, y: number, z: number): number => 3 + 0.004 * (z - 500) + 0.0008 * x - 0.0003 * y;
  const fv = (x: number, y: number, z: number): number => -1 + 0.002 * (z - 500) - 0.0004 * x + 0.0006 * y;
  const grid = makeGridSpec({ lat: -33.7, lon: 150.3 }, 31 * 200, 200);
  const view = makeAirView({ grid, groundAt: ground, u: fu, v: fv, w: (x) => 0.0002 * x, theta: (x) => x / 1000, smoke: (_x, y) => 2 + y / 1000 });
  const sampler = new AtmosphereSampler(view, 0, null);
  const length = Math.hypot(4400, 2100);
  const l: SectionLine = { a: [-2200, -1000], b: [2200, 1100], dir: [4400 / length, 2100 / length], length };
  const d = sampleSlice(sampler, { heightAt: (x) => ground(x) - 3 }, { line: l, shownTime: 0 })!;

  it('reads the analytic wind at random points between the lattice points, and the pin is on the line', () => {
    const rng = new Rng(9);
    let worst = 0;
    let n = 0;
    for (let q = 0; q < 400; q++) {
      const s = rng.range(0, length);
      const x = l.a[0] + l.dir[0] * s;
      const y = l.a[1] + l.dir[1] * s;
      const z = ground(x) + rng.range(250, 1900);
      if (z > d.zMax - 5 || z > sampler.top - 450) continue;
      const r = probeAt(d, { s, z });
      expect(r.where).toBe('air');
      expect([r.x, r.y]).toEqual([x, y].map((v) => expect.closeTo(v, 6)));
      const u = fu(x, y, z);
      const v = fv(x, y, z);
      worst = Math.max(worst, Math.abs(r.along! - (u * l.dir[0] + v * l.dir[1])), Math.abs(r.across! - (u * l.dir[1] - v * l.dir[0])), Math.abs(r.up! - 0.0002 * x));
      expect(r.fromDeg).toBeCloseTo(windFromDeg(u, v), 1);
      n++;
    }
    expect(n).toBeGreaterThan(300);
    expect(worst).toBeLessThan(2e-3);
  });

  it('says what it reads, end to end, in both units', () => {
    const r = probeAt(d, { s: length / 2, z: ground(0) + 600 });
    const kmh = probeSentence(r, { units: 'kmh', kind: 'prognostic' });
    const ms = probeSentence(r, { units: 'ms', kind: 'prognostic' });
    expect(kmh).toMatch(/^Wind about \d+ km\/h from the [a-z-]+, /);
    expect(ms).toMatch(/^Wind about \d+(\.\d)? m\/s from the [a-z-]+, /);
    expect(kmh).toContain('600 m above ground');
    expect(kmh).not.toContain('NaN');
  });
});
