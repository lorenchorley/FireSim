/**
 * The line of an air slice: clipping a hand-placed line to the model rectangle, the minimum length, the four presets from
 * fixtures with every issue they can raise, and the precedence of the rules. Geometry is checked against the conventions of
 * types.ts (along and across of the wind on the line a preset makes).
 */
import { describe, expect, it } from 'vitest';
import { makeGridSpec } from '../../core/grid';
import { windToUV } from '../../core/units';
import { sectionLine } from '../atmosphereSampler';
import { resolveSlice, sectionFromEndpoints, slicePresetStatus } from './sectionLine';
import { makeResolveContext } from './testing';
import { SLICE_PRESET_HALF_LENGTH_M, SLICE_PRESET_IDS, type SliceLineState, type SlicePoint } from './types';

const ORIGIN = { lat: -33.7, lon: 150.3 };
/** 31 x 31 nodes 200 m apart: the model rectangle is -3000 to 3000 in x and y; the shortest line is 2 cells, 400 m. */
const GRID200 = makeGridSpec(ORIGIN, 31 * 200, 200);
/** The standard tier's 133 m cells over 6 km: 45 nodes, the shortest line is 300 m (two cells would be 266 m). */
const GRID133 = makeGridSpec(ORIGIN, 45 * 133, 133);
const R = 3000;

const near = (a: readonly number[], b: readonly number[], tol = 1e-6): void => {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) expect(Math.abs(a[i]! - b[i]!), `[${i}] ${a[i]} vs ${b[i]}`).toBeLessThan(tol);
};

describe('sectionFromEndpoints', () => {
  it('keeps a line that is inside the rectangle exactly as placed', () => {
    const r = sectionFromEndpoints([-1000, 200], [1500, -700], GRID200);
    expect(r.issue).toBeNull();
    expect(r.clipped).toBe(false);
    expect(r.line!.a).toEqual([-1000, 200]);
    expect(r.line!.b).toEqual([1500, -700]);
    expect(r.line!.length).toBeCloseTo(Math.hypot(2500, 900), 9);
    near(r.line!.dir, [2500 / Math.hypot(2500, 900), -900 / Math.hypot(2500, 900)], 1e-12);
    expect(Math.hypot(...r.line!.dir)).toBeCloseTo(1, 12);
  });

  it('cuts a line that leaves the rectangle at the edge, keeping the end that is inside', () => {
    const r = sectionFromEndpoints([0, 0], [6000, 0], GRID200);
    expect(r.clipped).toBe(true);
    expect(r.line!.a).toEqual([0, 0]);
    near(r.line!.b, [R, 0]);
    expect(r.line!.length).toBeCloseTo(R, 9);
    // Both ends outside, line passing through (a diagonal): both cut, the A to B order kept.
    const d = sectionFromEndpoints([-5000, -5000], [5000, 5000], GRID200);
    expect(d.clipped).toBe(true);
    near(d.line!.a, [-R, -R]);
    near(d.line!.b, [R, R]);
    near(d.line!.dir, [Math.SQRT1_2, Math.SQRT1_2], 1e-12);
    // A line that is oblique to the edge: the cut end lies ON the edge and on the original line.
    const o = sectionFromEndpoints([0, 0], [4000, 1000], GRID200);
    near(o.line!.b, [R, 750]);
  });

  it('a line that ends exactly on the edge, or runs along it, is not clipped', () => {
    const e = sectionFromEndpoints([-R, 0], [R, 0], GRID200);
    expect(e.clipped).toBe(false);
    expect(e.line!.length).toBe(2 * R);
    const along = sectionFromEndpoints([-2000, R], [2000, R], GRID200);
    expect(along.issue).toBeNull();
    expect(along.clipped).toBe(false);
    expect(along.line!.a).toEqual([-2000, R]);
  });

  it('a line that misses the rectangle is outside-model', () => {
    for (const [a, b] of [
      [[4000, 0], [8000, 0]],
      [[-5000, 3500], [5000, 3500]], // parallel and outside
      [[-5000, 2000], [-2500, 5000]], // cuts the corner region outside
      [[3500, 3500], [3600, 3600]],
    ] as Array<[SlicePoint, SlicePoint]>) {
      const r = sectionFromEndpoints(a, b, GRID200);
      expect(r.line).toBeNull();
      expect(r.issue).toBe('outside-model');
      expect(r.clipped).toBe(false);
    }
  });

  it('checks the minimum length of the clipped line: 300 m, or two model cells when that is longer', () => {
    const g133 = sectionFromEndpoints([0, 0], [299, 0], GRID133);
    expect(g133.minLengthM).toBe(300);
    expect(g133.issue).toBe('too-short');
    expect(g133.line).toBeNull();
    expect(sectionFromEndpoints([0, 0], [300, 0], GRID133).issue).toBeNull();
    // 200 m cells: two cells are 400 m.
    expect(sectionFromEndpoints([0, 0], [399, 0], GRID200).issue).toBe('too-short');
    expect(sectionFromEndpoints([0, 0], [399, 0], GRID200).minLengthM).toBe(400);
    expect(sectionFromEndpoints([0, 0], [400, 0], GRID200).issue).toBeNull();
    // 267 m cells (the 12 km view of the standard tier): 534 m.
    const g267 = makeGridSpec(ORIGIN, 45 * 267, 267);
    expect(sectionFromEndpoints([0, 0], [500, 0], g267).issue).toBe('too-short');
    expect(sectionFromEndpoints([0, 0], [535, 0], g267).issue).toBeNull();
  });

  it('a long line with only a short part inside is too-short, and says it was clipped', () => {
    const r = sectionFromEndpoints([R - 100, 0], [R + 4000, 0], GRID200);
    expect(r.line).toBeNull();
    expect(r.issue).toBe('too-short');
    expect(r.clipped).toBe(true);
  });

  it('a point (A = B) is too-short inside the rectangle and outside-model outside it', () => {
    expect(sectionFromEndpoints([10, 10], [10, 10], GRID200).issue).toBe('too-short');
    expect(sectionFromEndpoints([9000, 10], [9000, 10], GRID200).issue).toBe('outside-model');
  });

  it('swapping A and B gives the same line reversed', () => {
    for (const [a, b] of [
      [[-500, -200], [900, 1300]],
      [[0, 0], [9000, 4000]], // clipped
      [[-8000, 1000], [8000, -1500]], // clipped at both ends
    ] as Array<[SlicePoint, SlicePoint]>) {
      const f = sectionFromEndpoints(a, b, GRID200);
      const r = sectionFromEndpoints(b, a, GRID200);
      expect(r.clipped).toBe(f.clipped);
      near(r.line!.a, f.line!.b);
      near(r.line!.b, f.line!.a);
      near(r.line!.dir, [-f.line!.dir[0], -f.line!.dir[1]], 1e-12);
      expect(r.line!.length).toBeCloseTo(f.line!.length, 9);
    }
  });

  it('never throws on non-finite points', () => {
    for (const p of [[NaN, 0], [0, Infinity], [-Infinity, NaN]] as SlicePoint[]) {
      expect(sectionFromEndpoints(p, [100, 100], GRID200).issue).toBe('outside-model');
      expect(sectionFromEndpoints([0, 0], p, GRID200).issue).toBe('outside-model');
    }
  });
});

describe('resolveSlice: the rules of the line state, in order', () => {
  const ctx = makeResolveContext({ grid: GRID200, fire: [200, 100], windFromDeg: 270, user: [-1500, -800] });
  const base: SliceLineState = { azimuth: 90, centre: [0, 0] };

  it('a live preset beats a hand-placed line, which beats the chord through the centre', () => {
    const all: SliceLineState = { ...base, a: [-1000, -1000], b: [1000, 1000], preset: 'along' };
    expect(resolveSlice(all, ctx).source).toBe('preset');
    expect(resolveSlice({ ...all, preset: null }, ctx).source).toBe('endpoints');
    expect(resolveSlice({ ...all, preset: undefined }, ctx).source).toBe('endpoints');
    expect(resolveSlice({ ...base }, ctx).source).toBe('centre');
    // A lone end is ignored (the tool keeps a draft).
    expect(resolveSlice({ ...base, a: [-1000, -1000] }, ctx).source).toBe('centre');
    expect(resolveSlice({ ...base, b: [1000, 1000] }, ctx).source).toBe('centre');
  });

  it('the centre rule is the original curtain chord, unchanged', () => {
    const rect = { xMin: -R, xMax: R, yMin: -R, yMax: R };
    for (const [centre, az] of [[[0, 0], 90], [[500, -300], 37], [[-1200, 800], 200]] as Array<[SlicePoint, number]>) {
      const r = resolveSlice({ azimuth: az, centre }, ctx);
      const want = sectionLine(rect, centre, az)!;
      expect(r.source).toBe('centre');
      expect(r.preset).toBeNull();
      expect(r.issue).toBeNull();
      expect(r.notes).toEqual([]);
      expect(r.line).toEqual(want);
    }
  });

  it('a centre outside the model, or a chord too short to sample, is an issue and not a line', () => {
    expect(resolveSlice({ azimuth: 90, centre: [9000, 0] }, ctx)).toMatchObject({ line: null, issue: 'outside-model', source: 'centre' });
    const tiny = makeResolveContext({ grid: makeGridSpec(ORIGIN, 200, 100) }); // a 100 m square: the longest chord is 141 m
    expect(resolveSlice({ azimuth: 45, centre: [0, 0] }, tiny)).toMatchObject({ line: null, issue: 'too-short' });
    expect(resolveSlice({ azimuth: NaN, centre: [0, 0] }, ctx).issue).toBe('outside-model');
  });

  it('hand-placed endpoints are clipped, with the note, and a miss is an issue', () => {
    const r = resolveSlice({ ...base, a: [0, 0], b: [8000, 0] }, ctx);
    expect(r).toMatchObject({ source: 'endpoints', preset: null, issue: null, notes: ['clipped'] });
    near(r.line!.b, [R, 0]);
    expect(resolveSlice({ ...base, a: [0, 0], b: [100, 0] }, ctx)).toMatchObject({ line: null, issue: 'too-short', notes: [] });
    expect(resolveSlice({ ...base, a: [5000, 0], b: [9000, 0] }, ctx)).toMatchObject({ line: null, issue: 'outside-model' });
    expect(resolveSlice({ ...base, a: [-500, 0], b: [500, 0] }, ctx).minLengthM).toBe(400);
  });
});

describe('presets: geometry from fixtures', () => {
  const fire: SlicePoint = [200, 100];
  const conv = (dir: SlicePoint, from: number): { along: number; across: number } => {
    const [u, v] = windToUV(1, from);
    return { along: u * dir[0] + v * dir[1], across: u * dir[1] - v * dir[0] };
  };

  it('Along the wind: through the fire, A upwind, B downwind, 3 km each way, along is positive', () => {
    for (const from of [0, 45, 90, 135, 180, 225, 270, 315, 10, 301]) {
      const ctx = makeResolveContext({ n: 61, cellSize: 200, fire, windFromDeg: from }); // +-6 km: room for 3 km each way
      const r = resolveSlice({ azimuth: 0, centre: [0, 0], preset: 'along' }, ctx);
      expect(r.source).toBe('preset');
      expect(r.preset).toBe('along');
      expect(r.issue).toBeNull();
      expect(r.notes).toEqual([]);
      const line = r.line!;
      expect(line.length).toBeCloseTo(2 * SLICE_PRESET_HALF_LENGTH_M, 6);
      near([(line.a[0] + line.b[0]) / 2, (line.a[1] + line.b[1]) / 2], fire, 1e-6);
      const c = conv(line.dir, from);
      expect(c.along, `from ${from}`).toBeCloseTo(1, 9);
      expect(c.across, `from ${from}`).toBeCloseTo(0, 9);
    }
    // A westerly (from 270) blows towards the east: A is the west end, B the east end.
    const w = resolveSlice({ azimuth: 0, centre: [0, 0], preset: 'along' }, makeResolveContext({ n: 61, cellSize: 200, fire, windFromDeg: 270 })).line!;
    expect(w.a[0]).toBeLessThan(w.b[0]);
    near(w.dir, [1, 0], 1e-12);
  });

  it('Across the wind: the wind blows towards the RIGHT of A to B, so across is positive', () => {
    for (const from of [0, 45, 90, 135, 180, 225, 270, 315, 17]) {
      const ctx = makeResolveContext({ n: 61, cellSize: 200, fire, windFromDeg: from });
      const r = resolveSlice({ azimuth: 0, centre: [0, 0], preset: 'across' }, ctx);
      expect(r.issue).toBeNull();
      const c = conv(r.line!.dir, from);
      expect(c.across, `from ${from}`).toBeCloseTo(1, 9);
      expect(c.along, `from ${from}`).toBeCloseTo(0, 9);
      expect(r.line!.length).toBeCloseTo(2 * SLICE_PRESET_HALF_LENGTH_M, 6);
    }
    // A westerly blows east; walking from A to B (due north) it blows to the right (east).
    const w = resolveSlice({ azimuth: 0, centre: [0, 0], preset: 'across' }, makeResolveContext({ n: 61, cellSize: 200, fire, windFromDeg: 270 })).line!;
    near(w.dir, [0, 1], 1e-12);
  });

  it('Up the slope: A downhill, B uphill, along the direction the ground rises', () => {
    const hill = (x: number, y: number): number => 500 + 0.2 * ((x + y) * Math.SQRT1_2); // rises towards the north-east, 11 degrees
    const ctx = makeResolveContext({ n: 61, cellSize: 200, fire, heightAt: hill });
    const r = resolveSlice({ azimuth: 0, centre: [0, 0], preset: 'slope' }, ctx);
    expect(r.issue).toBeNull();
    near(r.line!.dir, [Math.SQRT1_2, Math.SQRT1_2], 1e-9);
    expect(hill(...r.line!.a)).toBeLessThan(hill(...r.line!.b));
    near([(r.line!.a[0] + r.line!.b[0]) / 2, (r.line!.a[1] + r.line!.b[1]) / 2], fire, 1e-6);
    // Facing the other way, B stays uphill.
    const down = resolveSlice({ azimuth: 0, centre: [0, 0], preset: 'slope' }, makeResolveContext({ n: 61, cellSize: 200, fire, heightAt: (x, y) => 900 - hill(x, y) })).line!;
    near(down.dir, [-Math.SQRT1_2, -Math.SQRT1_2], 1e-9);
  });

  it('Up the slope is decided over a third of the line, not by a 30 m crag next to the fire', () => {
    const crag = (x: number, y: number): number => 500 + 0.1 * x + 80 * Math.exp(-(((x - fire[0]) ** 2 + (y - fire[1]) ** 2) / 40 ** 2)); // rises east; a spike on the fire
    const r = resolveSlice({ azimuth: 0, centre: [0, 0], preset: 'slope' }, makeResolveContext({ n: 61, cellSize: 200, fire, heightAt: crag }));
    near(r.line!.dir, [1, 0], 1e-3);
  });

  it('ground flatter than about 2 degrees has no up-slope line', () => {
    const flat = makeResolveContext({ n: 61, cellSize: 200, fire, heightAt: () => 500 });
    expect(resolveSlice({ azimuth: 0, centre: [0, 0], preset: 'slope' }, flat)).toMatchObject({ line: null, issue: 'flat-ground', preset: 'slope', source: 'preset' });
    const tilt = (deg: number) => makeResolveContext({ n: 61, cellSize: 200, fire, heightAt: (x) => 500 + Math.tan((deg * Math.PI) / 180) * x });
    expect(resolveSlice({ azimuth: 0, centre: [0, 0], preset: 'slope' }, tilt(1.5)).issue).toBe('flat-ground');
    expect(resolveSlice({ azimuth: 0, centre: [0, 0], preset: 'slope' }, tilt(2.5)).issue).toBeNull();
  });

  it('Me to fire: A is the phone, B is the fire, not extended', () => {
    const ctx = makeResolveContext({ n: 61, cellSize: 200, fire, user: [-1500, -800] });
    const r = resolveSlice({ azimuth: 0, centre: [0, 0], preset: 'me' }, ctx);
    expect(r).toMatchObject({ source: 'preset', preset: 'me', issue: null, notes: [] });
    expect(r.line!.a).toEqual([-1500, -800]);
    expect(r.line!.b).toEqual(fire);
    expect(r.line!.length).toBeCloseTo(Math.hypot(1700, 900), 9);
  });

  it('Me to fire: no phone position, a phone outside the model, or no fire are issues, in that order', () => {
    const me = (o: Parameters<typeof makeResolveContext>[0]) => resolveSlice({ azimuth: 0, centre: [0, 0], preset: 'me' }, makeResolveContext({ n: 61, cellSize: 200, ...o }));
    expect(me({ fire, user: null })).toMatchObject({ line: null, issue: 'no-user', preset: 'me' });
    expect(me({ fire, user: [9000, 0] })).toMatchObject({ line: null, issue: 'no-user' });
    expect(me({ fire: null, user: [100, 100] })).toMatchObject({ line: null, issue: 'no-fire' });
    expect(me({ fire: null, user: null }).issue).toBe('no-user');
    expect(me({ fire: [200, 100], user: [250, 100] }).issue).toBe('too-short'); // the phone is at the fire
  });

  it('with no fire, a preset goes through the map centre and says so; Me to fire has no such note', () => {
    const ctx = makeResolveContext({ n: 61, cellSize: 200, fire: null, mapCentre: [400, -300], windFromDeg: 270 });
    const r = resolveSlice({ azimuth: 0, centre: [0, 0], preset: 'along' }, ctx);
    expect(r.notes).toEqual(['no-fire-centred-on-map']);
    near([(r.line!.a[0] + r.line!.b[0]) / 2, (r.line!.a[1] + r.line!.b[1]) / 2], [400, -300], 1e-6);
    const withFire = resolveSlice({ azimuth: 0, centre: [0, 0], preset: 'along' }, { ...ctx, fire });
    expect(withFire.notes).toEqual([]);
  });

  it('a preset near the edge is cut at the rectangle, with the note, and keeps its direction', () => {
    const ctx = makeResolveContext({ n: 31, cellSize: 200, fire: [2000, 0], windFromDeg: 270 }); // rectangle +-3000: 1 km to the east edge
    const r = resolveSlice({ azimuth: 0, centre: [0, 0], preset: 'along' }, ctx);
    expect(r.notes).toEqual(['clipped']);
    near(r.line!.a, [-1000, 0]);
    near(r.line!.b, [R, 0]);
    expect(r.line!.length).toBeCloseTo(4000, 6);
    // Both orders of notes when the fire is missing too.
    const noFire = resolveSlice({ azimuth: 0, centre: [0, 0], preset: 'along' }, makeResolveContext({ n: 31, cellSize: 200, fire: null, mapCentre: [2000, 0], windFromDeg: 270 }));
    expect(noFire.notes).toEqual(['clipped', 'no-fire-centred-on-map']);
  });

  it('calm (no wind direction) stops Along and Across, and nothing else', () => {
    const ctx = makeResolveContext({ n: 61, cellSize: 200, fire, windFromDeg: null, user: [-1500, -800], heightAt: (x) => 500 + 0.2 * x });
    expect(resolveSlice({ azimuth: 0, centre: [0, 0], preset: 'along' }, ctx)).toMatchObject({ line: null, issue: 'calm' });
    expect(resolveSlice({ azimuth: 0, centre: [0, 0], preset: 'across' }, ctx)).toMatchObject({ line: null, issue: 'calm' });
    expect(resolveSlice({ azimuth: 0, centre: [0, 0], preset: 'slope' }, ctx).issue).toBeNull();
    expect(resolveSlice({ azimuth: 0, centre: [0, 0], preset: 'me' }, ctx).issue).toBeNull();
    expect(resolveSlice({ azimuth: 0, centre: [0, 0], preset: 'along' }, { ...ctx, windFromDeg: NaN }).issue).toBe('calm');
  });

  it('a map centre outside the model gives a cut line when the line still crosses it, and outside-model when it does not', () => {
    const ctx = makeResolveContext({ n: 31, cellSize: 200, fire: null, mapCentre: [R + 1000, 0], windFromDeg: 270 });
    const r = resolveSlice({ azimuth: 0, centre: [0, 0], preset: 'along' }, ctx); // runs east to west through x = 4000: 3 km each way reaches x = 1000
    expect(r.issue).toBeNull();
    expect(r.notes).toEqual(['clipped', 'no-fire-centred-on-map']);
    near(r.line!.a, [1000, 0]);
    near(r.line!.b, [R, 0]);
    const far = resolveSlice({ azimuth: 0, centre: [0, 0], preset: 'along' }, { ...ctx, mapCentre: [R + 9000, 0] });
    expect(far).toMatchObject({ line: null, issue: 'outside-model', notes: [] });
  });

  it('a line is too short, not a line, when the clip leaves under the minimum', () => {
    const ctx = makeResolveContext({ n: 31, cellSize: 200, fire: null, mapCentre: [R + 2800, 0], windFromDeg: 270 }); // only 200 m of the 3 km reach is inside
    expect(resolveSlice({ azimuth: 0, centre: [0, 0], preset: 'along' }, ctx)).toMatchObject({ line: null, issue: 'too-short' });
  });

  it('reports the shortest length in force on every result', () => {
    expect(resolveSlice({ azimuth: 0, centre: [0, 0], preset: 'along' }, makeResolveContext({ grid: GRID133 })).minLengthM).toBe(300);
    expect(resolveSlice({ azimuth: 0, centre: [0, 0], preset: 'me' }, makeResolveContext({ grid: GRID200 })).minLengthM).toBe(400);
  });

  it('never throws, even on non-finite inputs', () => {
    const bad = makeResolveContext({ n: 31, cellSize: 200, fire: [NaN, 0], mapCentre: [NaN, NaN], windFromDeg: 270, user: [NaN, 1] });
    for (const preset of SLICE_PRESET_IDS) expect(() => resolveSlice({ azimuth: 0, centre: [0, 0], preset }, bad)).not.toThrow();
    expect(() => resolveSlice({ azimuth: NaN, centre: [NaN, 0], a: [NaN, 0], b: [0, 0] }, bad)).not.toThrow();
  });
});

describe('slicePresetStatus', () => {
  it('is ok exactly when resolveSlice makes a line, and otherwise gives the issue it returns', () => {
    const hill = (x: number): number => 500 + 0.2 * x;
    const cases = [
      makeResolveContext({ n: 61, cellSize: 200, fire: [0, 0], windFromDeg: 270, user: [-1000, 0], heightAt: hill }),
      makeResolveContext({ n: 61, cellSize: 200, fire: null, windFromDeg: null, user: null }),
      makeResolveContext({ n: 61, cellSize: 200, fire: [0, 0], windFromDeg: 90, user: [20000, 0] }),
      makeResolveContext({ n: 61, cellSize: 200, fire: null, windFromDeg: 90, user: [100, 100] }),
    ];
    for (const ctx of cases) {
      for (const preset of SLICE_PRESET_IDS) {
        const r = resolveSlice({ azimuth: 0, centre: [0, 0], preset }, ctx);
        const s = slicePresetStatus(preset, ctx);
        expect(s.ok, preset).toBe(r.line !== null);
        if (!s.ok) expect(s.issue, preset).toBe(r.issue);
      }
    }
    expect(slicePresetStatus('me', cases[1]!)).toEqual({ ok: false, issue: 'no-user' });
    expect(slicePresetStatus('along', cases[1]!)).toEqual({ ok: false, issue: 'calm' });
    expect(slicePresetStatus('slope', cases[1]!)).toEqual({ ok: false, issue: 'flat-ground' });
    expect(slicePresetStatus('along', cases[0]!)).toEqual({ ok: true });
    expect(slicePresetStatus('me', cases[3]!)).toEqual({ ok: false, issue: 'no-fire' });
  });
});
