/**
 * The time-lapse recorder of an Air slice line (0.4.1): what it stores is the live slice to within the packing bound, what it reads
 * back follows the rule of contract 4.1, it cuts by time order, it thins uniformly inside its budget, and it drops itself when the line
 * or the lattice changes. Pure: no DOM, no engine.
 */
import { describe, expect, it } from 'vitest';
import { makeGridSpec } from '../../core/grid';
import { packField, sliceFieldErrorBound, sliceSampleBytes, SLICE_RECORDER_MAX_BYTES, SMOKE_CODE_MAX_RELATIVE_ERROR } from '../../core/sliceRecording';
import { AtmosphereSampler } from '../atmosphereSampler';
import { sectionFromEndpoints } from './sectionLine';
import { sampleSlice } from './sliceField';
import { SliceRecorder, sliceLineKey } from './sliceRecorder';
import { makeAirView, makeSliceData } from './testing';
import type { SliceData } from './types';

const MiB = 1048576;
const ORIGIN = { lat: -33.7, lon: 150.3 };
const ridge = (x: number, y: number): number => 600 + 500 * Math.exp(-((x / 900) ** 2)) + 150 * Math.sin(y / 700);

/** A model of 45 x 45 columns 133 m apart (a 6 km area), 20 levels, fields that vary in all three directions and in time `t`. */
function model(t: number, kind: 'prognostic' | 'diagnosed' = 'prognostic') {
  const grid = makeGridSpec(ORIGIN, 45 * 133, 133);
  const view = makeAirView({
    grid,
    nz: 20,
    kind,
    time: t,
    baseM: 500,
    topM: 3000,
    groundAt: (x, y) => ridge(x, y) - 20,
    u: (x, _y, z) => 6 + 0.004 * (z - 500) + 2 * Math.sin(x / 900 + t / 600),
    v: (_x, y, z) => 1 + 0.001 * (z - 500) + Math.cos(y / 800),
    w: (x, _y, z) => 0.5 * Math.sin(x / 600 + z / 400),
    theta: kind === 'prognostic' ? (x, _y, z) => 0.002 * x + 0.001 * (z - 500) + Math.sin(t / 900) : null,
    smoke: kind === 'prognostic' ? (_x, y, z) => 10 ** (-5 + 4 * Math.max(0, Math.sin(y / 900 + z / 1500))) : null,
  });
  return { grid, view };
}

/** A slice of a hand-made field, 90 x 54 by default, with a wind that depends on `t` (the recorder never looks at what it packs). */
function slice(t = 0, o: Parameters<typeof makeSliceData>[0] = {}): SliceData {
  return makeSliceData({
    columns: 90,
    rows: 54,
    a: [0, 0],
    b: [6000, 0],
    zMin: 400,
    zMax: 3400,
    topAsl: 3500,
    ground: (s) => 600 + 100 * Math.sin(s / 700),
    modelGround: (s) => 620 + 80 * Math.sin(s / 700),
    wind: (s, z) => [6 + 0.004 * (z - 500) + Math.sin(s / 900 + t / 600), 1 + 0.5 * Math.cos(s / 800), 0.4 * Math.sin(s / 600 + z / 400)],
    theta: (s, z) => 0.002 * s + 0.001 * (z - 500) + Math.sin(t / 900),
    smoke: (s, z) => 10 ** (-5 + 4 * Math.max(0, Math.sin(s / 900 + z / 1500))),
    airTime: t,
    shownTime: t,
    ...o,
  });
}

/** One arrival of the recording loop (the scene glue's body): the time-order cut, whether a sample is wanted, the sample. */
function arriveAndStore(rec: SliceRecorder, d: SliceData, t: number): boolean {
  if (!rec.arrive(t)) return false;
  rec.store(d, t);
  return true;
}

describe('sliceLineKey', () => {
  it('names both ends to 0.1 m, in order', () => {
    const d = slice();
    const k = sliceLineKey(d.line);
    expect(k).toBe('0,0;60000,0');
    expect(sliceLineKey({ a: [0.04, -0.04], b: [6000.04, 0.049] })).toBe(k); // within a twentieth of a metre: the same line
    expect(sliceLineKey({ a: [0.06, 0], b: [6000, 0] })).not.toBe(k);
    expect(sliceLineKey({ a: [6000, 0], b: [0, 0] })).not.toBe(k); // swapped ends are another line (A is always the left end)
  });
});

describe('what it stores is the live slice', () => {
  for (const kind of ['prognostic', 'diagnosed'] as const) {
    it(`${kind} air at 90 x 54: every field within the packing bound, the derived speed within hypot, everything else identical`, () => {
      const { grid, view } = model(900, kind);
      const sampler = new AtmosphereSampler(view, 500, null);
      const line = sectionFromEndpoints([-2900, -1200], [2900, 1500], grid).line!;
      const live = sampleSlice(sampler, { heightAt: ridge }, { line, shownTime: 900, columns: 90, rows: 54 })!;
      expect(live.columns * live.rows).toBe(4860);
      expect(live.kind).toBe(kind);
      const rec = new SliceRecorder();
      rec.setLine(sliceLineKey(line));
      expect(arriveAndStore(rec, live, 900)).toBe(true);
      expect(rec.count).toBe(1);

      const back = rec.read(line, 900, kind, null, null)!;
      expect(back).not.toBeNull();
      expect(back).not.toBe(live);
      expect(back.recordedAt).toBe(900);
      expect(back.cells).toBeNull();
      // identical, not approximate
      expect(back.kind).toBe(live.kind);
      expect(back.has).toEqual(live.has);
      expect(back.line).toBe(line);
      expect([back.columns, back.rows, back.zMin, back.zMax, back.topAsl, back.cellSizeM]).toEqual([live.columns, live.rows, live.zMin, live.zMax, live.topAsl, live.cellSizeM]);
      expect(Array.from(back.valid)).toEqual(Array.from(live.valid));
      expect(Array.from(back.ground)).toEqual(Array.from(live.ground));
      expect(Array.from(back.modelGround)).toEqual(Array.from(live.modelGround));
      expect(back.airTime).toBe(900);
      expect(back.shownTime).toBe(900);

      // each stored field within 0.502 of its own quantum
      const scaleOf = (f: Float32Array): number => packField(f, f.length, new Int16Array(f.length), 0);
      const worst = (a: Float32Array, b: Float32Array): number => {
        let w = 0;
        for (let i = 0; i < a.length; i++) w = Math.max(w, Math.abs(a[i]! - b[i]!));
        return w;
      };
      const eAlong = sliceFieldErrorBound(scaleOf(live.values.along));
      const eAcross = sliceFieldErrorBound(scaleOf(live.values.across));
      expect(worst(back.values.along, live.values.along)).toBeLessThanOrEqual(eAlong);
      expect(worst(back.values.across, live.values.across)).toBeLessThanOrEqual(eAcross);
      expect(worst(back.values.up, live.values.up)).toBeLessThanOrEqual(sliceFieldErrorBound(scaleOf(live.values.up)));
      expect(worst(back.values.along, live.values.along)).toBeGreaterThan(0); // the integers are coarser than the Float32 field
      // the speed is derived: hypot of the two rotated components, so its error is at most hypot of their bounds
      expect(worst(back.values.speed, live.values.speed)).toBeLessThanOrEqual(Math.hypot(eAlong, eAcross) * 1.0001);
      if (kind === 'prognostic') {
        expect(worst(back.values.theta, live.values.theta)).toBeLessThanOrEqual(sliceFieldErrorBound(scaleOf(live.values.theta)));
        // smoke: a relative bound above the floor, an absolute 1e-6 below it
        let rel = 0;
        let abs = 0;
        for (let i = 0; i < live.values.smoke.length; i++) {
          const s = live.values.smoke[i]!;
          if (s >= 1e-6) rel = Math.max(rel, Math.abs(back.values.smoke[i]! - s) / s);
          else abs = Math.max(abs, Math.abs(back.values.smoke[i]! - s));
        }
        expect(rel).toBeLessThanOrEqual(SMOKE_CODE_MAX_RELATIVE_ERROR);
        expect(abs).toBeLessThan(1e-6);
        expect(live.values.smoke.some((s) => s > 1e-3)).toBe(true); // the field had a plume to test
      } else {
        expect(back.values.theta.every((x) => x === 0)).toBe(true);
        expect(back.values.smoke.every((x) => x === 0)).toBe(true);
      }
      // invalid cells hold 0 in every field
      for (const id of ['speed', 'along', 'across', 'up', 'theta', 'smoke'] as const) {
        for (let i = 0; i < live.valid.length; i++) if (live.valid[i] === 0) expect(back.values[id][i], `${id}[${i}]`).toBe(0);
      }
      expect(live.valid.some((x) => x === 0) && live.valid.some((x) => x === 1)).toBe(true);
    });
  }

  it('does not keep the slice it was given: the next sample overwrites that array in place', () => {
    const rec = new SliceRecorder();
    const d = slice(0);
    rec.setLine(sliceLineKey(d.line));
    arriveAndStore(rec, d, 100);
    const before = rec.read(d.line, 100, 'prognostic', null, null)!;
    const copy = Array.from(before.values.along);
    d.values.along.fill(25); // the sampler refills one object for every sample
    d.values.speed.fill(25);
    d.valid.fill(0);
    const after = rec.read(d.line, 100, 'prognostic', null, null)!;
    expect(Array.from(after.values.along)).toEqual(copy);
    expect(after.valid.some((x) => x === 1)).toBe(true);
  });

  it('a sample made from a Float32 field with non-finite points stores them as 0', () => {
    const rec = new SliceRecorder();
    const d = slice(0);
    d.values.along[10] = NaN;
    d.values.across[11] = Infinity;
    d.values.smoke[12] = NaN;
    rec.setLine(sliceLineKey(d.line));
    arriveAndStore(rec, d, 5);
    const back = rec.read(d.line, 5, 'prognostic', null, null)!;
    expect(back.values.along[10]).toBe(0);
    expect(back.values.across[11]).toBe(0);
    expect(back.values.smoke[12]).toBe(0);
    expect(back.values.speed.every(Number.isFinite)).toBe(true);
  });
});

describe('read', () => {
  function recorded(times: number[], kind: 'prognostic' | 'diagnosed' = 'prognostic'): { rec: SliceRecorder; line: SliceData['line'] } {
    const rec = new SliceRecorder();
    const first = slice(0, { kind });
    rec.setLine(sliceLineKey(first.line));
    for (const t of times) arriveAndStore(rec, slice(t, { kind, airTime: t }), t);
    return { rec, line: first.line };
  }

  it('gives the newest sample at or before the time shown: exact, between, before the first, after the last', () => {
    const { rec, line } = recorded([60, 120, 180]);
    const at = (t: number) => rec.read(line, t, 'prognostic', null, null)?.recordedAt ?? null;
    expect(at(120)).toBe(120); // exactly
    expect(at(60)).toBe(60);
    expect(at(150)).toBe(120); // between two: the earlier
    expect(at(179.999)).toBe(120);
    expect(at(180)).toBe(180);
    expect(at(59.9)).toBeNull(); // before the first sample: the 0.4.0 path
    expect(at(0)).toBeNull();
    expect(at(10_000)).toBe(180); // after the last: the newest
    expect(rec.read(line, NaN, 'prognostic', null, null)).toBeNull();
  });

  it('answers only for this line and this kind of air', () => {
    const { rec, line } = recorded([60, 120]);
    const other = { ...line, a: [0, 5] as [number, number] };
    expect(rec.read(other, 120, 'prognostic', null, null)).toBeNull();
    expect(rec.read({ ...line, a: [0.04, 0] }, 120, 'prognostic', null, null)).not.toBeNull(); // the same key
    expect(rec.read(line, 120, 'diagnosed', null, null)).toBeNull();
    const fast = recorded([60, 120], 'diagnosed');
    expect(fast.rec.read(fast.line, 120, 'diagnosed', null, null)?.kind).toBe('diagnosed');
    expect(fast.rec.read(fast.line, 120, 'prognostic', null, null)).toBeNull();
  });

  it('is only for a picture whose own air is OLDER than the sample: the newest picture (air time = its time) stays live', () => {
    const { rec, line } = recorded([60, 120, 180]);
    const air = (a: number | null) => rec.read(line, 150, 'prognostic', a, null)?.recordedAt ?? null;
    expect(air(null)).toBe(120); // a picture that does not say: the recording is the better air
    expect(air(0)).toBe(120); // keyframe air 150 s older than the picture
    expect(air(119)).toBe(120); // 1 s older than the sample
    expect(air(119.6)).toBeNull(); // within half a second: the picture's own air is as good
    expect(air(120)).toBeNull(); // equal: the live air wins the tie
    expect(air(150)).toBeNull(); // newer
    expect(air(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('refills `out` in place when it has the lattice, and says what it is: recorded, no model cells, the time shown, the air time', () => {
    const { rec, line } = recorded([60, 120]);
    const first = rec.read(line, 100, 'prognostic', null, null)!;
    first.seq = 41;
    const again = rec.read(line, 120, 'prognostic', null, first)!;
    expect(again).toBe(first);
    expect(again.seq).toBe(42);
    expect(again.recordedAt).toBe(120);
    expect(again.shownTime).toBe(120);
    expect(again.airTime).toBe(120);
    // a slice the sampler made carries model cells and no recordedAt; refilled by a read it has neither of the old ones
    const live = slice(0);
    live.cells = { count: 1, edges: new Float32Array(2), column: new Int32Array(1), levels: 1, zEdges: new Float32Array(2), values: first.values };
    const asRecorded = rec.read(line, 120, 'prognostic', null, live)!;
    expect(asRecorded).toBe(live);
    expect(asRecorded.cells).toBeNull();
    expect(asRecorded.recordedAt).toBe(120);
    // another lattice is a new object, and the old one is left alone
    const small = slice(0, { columns: 60, rows: 40 });
    const fresh = rec.read(line, 120, 'prognostic', null, small)!;
    expect(fresh).not.toBe(small);
    expect(fresh.columns).toBe(90);
    expect(small.columns).toBe(60);
    expect(small.recordedAt).toBeUndefined();
  });

  it('a view that does not say when its air is from reads back as airTime null', () => {
    const rec = new SliceRecorder();
    const d = slice(0, { airTime: null });
    rec.setLine(sliceLineKey(d.line));
    arriveAndStore(rec, d, 30);
    expect(rec.read(d.line, 30, 'prognostic', null, null)!.airTime).toBeNull();
  });

  it('keeps the has flags of the air: a 3-D view without smoke has none back', () => {
    const rec = new SliceRecorder();
    const d = slice(0, { has: { smoke: false } });
    rec.setLine(sliceLineKey(d.line));
    arriveAndStore(rec, d, 30);
    const back = rec.read(d.line, 30, 'prognostic', null, null)!;
    expect(back.has).toEqual({ wind: true, theta: true, smoke: false });
    expect(back.values.smoke.every((x) => x === 0)).toBe(true);
    expect(rec.status().bytes).toBeLessThan(sliceSampleBytes(4860, 'prognostic') + 7000); // 4 fields, not 5
  });
});

describe('time order', () => {
  function recorded(times: number[]): SliceRecorder {
    const rec = new SliceRecorder();
    const first = slice(0);
    rec.setLine(sliceLineKey(first.line));
    for (const t of times) arriveAndStore(rec, slice(t), t);
    return rec;
  }
  const times = (rec: SliceRecorder): number[] => rec.sampleTimes();

  it('arrive(t) drops every sample at or after t, then asks for one', () => {
    const rec = recorded([60, 120, 180, 240]);
    expect(rec.arrive(200)).toBe(true); // 240 is gone, 180 is 20 s earlier and the gap is 0
    expect(times(rec)).toEqual([60, 120, 180]);
    expect(rec.arrive(120)).toBe(true); // a replay: the sample AT 120 is stale as well
    expect(times(rec)).toEqual([60]);
    expect(rec.status().to).toBe(60);
    expect(rec.arrive(30)).toBe(true); // before the first one: everything is gone
    expect(rec.count).toBe(0);
    expect(rec.bytes).toBe(0);
    expect(rec.status().state).toBe('waiting');
    expect(rec.arrive(Number.NaN)).toBe(false);
  });

  it('truncateAfter(t) keeps the samples at or before t; truncateFrom(t) drops those at or after it', () => {
    const rec = recorded([60, 120, 180, 240]);
    rec.truncateAfter(180);
    expect(times(rec)).toEqual([60, 120, 180]);
    rec.truncateAfter(180); // nothing more to cut at the same time
    expect(rec.count).toBe(3);
    rec.truncateFrom(180);
    expect(times(rec)).toEqual([60, 120]);
    rec.truncateAfter(119.9);
    expect(times(rec)).toEqual([60]);
    rec.truncateAfter(1000);
    expect(rec.count).toBe(1);
    rec.truncateAfter(-1);
    expect(rec.count).toBe(0);
    expect(rec.status().state).toBe('waiting'); // the line is kept, the samples are not
  });

  it('a cut recording records on from the cut: the next arrival after the cut is wanted, the old gap is kept', () => {
    const rec = recorded([60, 120, 180]);
    rec.truncateAfter(120);
    expect(rec.arrive(180)).toBe(true);
    rec.store(slice(180), 180);
    expect(rec.count).toBe(3);
    expect(rec.bytes).toBe(rec.status().bytes);
  });

  it('a sample that is not newer than the newest cuts it (the sampler is called after arrive, but the order holds whatever the caller does)', () => {
    const rec = recorded([60, 120]);
    rec.store(slice(100), 100); // without `arrive`
    expect(times(rec)).toEqual([60, 100]);
  });
});

describe('thinning: uniform, doubling, inside the budget', () => {
  /** A recorder whose budget holds `n` samples of the 90 x 54 slice (and the epoch). */
  function tight(n: number): { rec: SliceRecorder; per: number; epoch: number } {
    const probe = new SliceRecorder();
    const d = slice();
    probe.setLine(sliceLineKey(d.line));
    probe.store(d, 0);
    const per = sliceSampleBytes(4860, 'prognostic');
    const epoch = probe.bytes - per;
    const rec = new SliceRecorder({ budgetBytes: epoch + n * per + 100 });
    rec.setLine(sliceLineKey(d.line));
    return { rec, per, epoch };
  }

  /** 2,000 arrivals: 10 s steps for the first 700, then 60 s (a mid-run change of the display step). */
  function arrivals(): number[] {
    const out: number[] = [];
    let t = 0;
    for (let i = 0; i < 2000; i++) {
      out.push(t);
      t += i < 700 ? 10 : 60;
    }
    return out;
  }

  it('after 2,000 arrivals: bytes within the budget after every store, ascending times, first and newest kept, subset of the arrivals, the gap doubles, spacing never under the gap', () => {
    const { rec, per, epoch } = tight(40);
    const budget = rec.budgetBytes;
    const d = slice();
    const all = arrivals();
    const arrived = new Set(all);
    const gaps: number[] = [];
    let stored = 0;
    for (const t of all) {
      if (rec.arrive(t)) {
        rec.store(d, t);
        stored++;
        expect(rec.bytes).toBeLessThanOrEqual(budget);
        expect(rec.status().to).toBe(t); // the newest sample is the one just made
        expect(rec.status().from).toBe(0); // the first stays
      }
      const g = rec.status().spacingS;
      if (g !== (gaps[gaps.length - 1] ?? 0)) gaps.push(g);
    }
    expect(stored).toBeLessThan(all.length); // thinning made the recorder pass on arrivals
    // the gap doubles (the first thinning sets it to twice the least spacing the arrivals made: 20 s)
    expect(gaps[0]).toBe(20);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBe(2 * gaps[i - 1]!);
    expect(gaps.length).toBeGreaterThanOrEqual(4);

    // the final list
    const s = rec.status();
    const kept = rec.sampleTimes();
    expect(s.count).toBe(rec.count);
    expect(kept.length).toBe(s.count);
    expect(s.bytes).toBe(epoch + s.count * per);
    expect(s.count).toBeLessThanOrEqual(40);
    expect(s.count).toBeGreaterThanOrEqual(19); // a uniform halving keeps more than half of the room
    expect(kept[0]).toBe(0);
    expect(kept[kept.length - 1]).toBe(s.to);
    expect(s.to).toBeGreaterThan(all[all.length - 1]! - s.spacingS - 60); // the newest is at most one gap and one step behind the head
    for (let i = 1; i < kept.length; i++) {
      expect(kept[i]!).toBeGreaterThan(kept[i - 1]!);
      expect(kept[i]! - kept[i - 1]!, `spacing ${i}`).toBeGreaterThanOrEqual(s.spacingS - 1e-6);
    }
    for (const t of kept) expect(arrived.has(t), `${t} is an arrival time`).toBe(true);
  });

  it('is the same at every moment, not only at the end: spacing >= gap for all pairs, first and newest kept, after each of 600 arrivals', () => {
    const { rec } = tight(12);
    const d = slice();
    for (let i = 0; i < 600; i++) {
      const t = i * 30;
      if (rec.arrive(t)) rec.store(d, t);
      const g = rec.status().spacingS;
      const seen = rec.sampleTimes();
      for (let k = 1; k < seen.length; k++) expect(seen[k]! - seen[k - 1]!, `at ${t}: ${seen[k - 1]} to ${seen[k]} (gap ${g})`).toBeGreaterThanOrEqual(g - 1e-6);
      expect(seen[0]).toBe(0);
      expect(seen[seen.length - 1]).toBe(rec.status().to);
    }
    expect(rec.status().spacingS).toBeGreaterThan(0);
  });

  it('a short recording is not thinned and keeps every picture (spacing 0)', () => {
    const { rec } = tight(40);
    const d = slice();
    for (let i = 0; i < 30; i++) arriveAndStore(rec, d, i * 60);
    expect(rec.count).toBe(30);
    expect(rec.status().spacingS).toBe(0);
  });

  it('at least half of the room is always used, the count never above the capacity', () => {
    const { rec } = tight(25);
    const d = slice();
    let low = Infinity;
    for (let i = 0; i < 1500; i++) {
      arriveAndStore(rec, d, i * 20);
      expect(rec.count).toBeLessThanOrEqual(25);
      if (i > 200) low = Math.min(low, rec.count);
    }
    expect(low).toBeGreaterThanOrEqual(12);
  });

  it('a budget of one, two or three samples keeps the newest and never goes over', () => {
    for (const n of [1, 2, 3]) {
      const { rec, per, epoch } = tight(n);
      const d = slice();
      for (let i = 0; i < 40; i++) {
        arriveAndStore(rec, d, i * 60);
        expect(rec.bytes).toBeLessThanOrEqual(epoch + n * per + 100);
        expect(rec.count).toBeGreaterThanOrEqual(1);
        expect(rec.count).toBeLessThanOrEqual(n);
        expect(rec.sampleTimes()[rec.count - 1]).toBe(rec.status().to);
      }
      // the newest is within one gap of the head (the arrivals are taken at the gap, which has grown to hold them)
      expect(rec.status().to!).toBeGreaterThan(39 * 60 - rec.status().spacingS - 1);
      if (n >= 3) expect(rec.sampleTimes()[0]).toBe(0); // the first stays while two or more fit
    }
  });

  it('a budget under one sample records nothing and says waiting', () => {
    const rec = new SliceRecorder({ budgetBytes: 20_000 });
    const d = slice();
    rec.setLine(sliceLineKey(d.line));
    for (let i = 0; i < 5; i++) arriveAndStore(rec, d, i * 60);
    expect(rec.count).toBe(0);
    expect(rec.bytes).toBe(0);
    expect(rec.status().state).toBe('waiting');
  });

  it('a smaller budget from the session thins at once, and a budget under one sample empties it', () => {
    const rec = new SliceRecorder();
    const d = slice();
    rec.setLine(sliceLineKey(d.line));
    for (let i = 0; i < 100; i++) arriveAndStore(rec, d, i * 60);
    expect(rec.count).toBe(100);
    const per = sliceSampleBytes(4860, 'prognostic');
    rec.setBudget(30 * per);
    expect(rec.bytes).toBeLessThanOrEqual(30 * per);
    expect(rec.count).toBeLessThanOrEqual(30);
    expect(rec.count).toBeGreaterThan(10);
    expect(rec.status().spacingS).toBe(240); // 100 samples every 60 s halved twice: 25 every 240 s
    expect(rec.count).toBe(25);
    expect(rec.status().budgetBytes).toBe(30 * per);
    rec.setBudget(1000);
    expect(rec.count).toBe(0);
    expect(rec.bytes).toBe(0);
  });

  it('the default budget is 12 MiB and holds 258 samples of the 3-D air at 90 x 54 (the epoch is a tenth of one) before its first thinning', () => {
    const rec = new SliceRecorder();
    expect(rec.budgetBytes).toBe(SLICE_RECORDER_MAX_BYTES);
    const d = slice();
    rec.setLine(sliceLineKey(d.line));
    for (let i = 0; i < 258; i++) arriveAndStore(rec, d, i * 60);
    expect(Math.floor(12 * MiB / sliceSampleBytes(4860, 'prognostic'))).toBe(258);
    expect(rec.count).toBe(258);
    expect(rec.status().spacingS).toBe(0); // every picture so far
    expect(rec.bytes).toBeLessThanOrEqual(12 * MiB);
    arriveAndStore(rec, d, 258 * 60); // the 259th does not fit: every second sample goes
    expect(rec.status().spacingS).toBe(120);
    expect(rec.count).toBe(130); // 259 samples, positions 0, 2, ... 258
    expect(rec.bytes).toBeLessThanOrEqual(12 * MiB);
  });

  it('a picture a few seconds after another (the run-end picture of a pause) does not make the gap far under the real spacing: the status says what the spacing is', () => {
    // 60 s steps, and a pause that made an extra picture 3 s after the one at 120 s. The first thinning used to take twice the LEAST spacing (6 s) as the
    // gap, so the words said "about every 5 s" of pictures 2 min apart, and every later thinning doubled both, so it never corrected itself.
    for (const [label, extra] of [
      ['one pause', [123]],
      ['a pause 1 s after a picture', [61]],
      ['a pause every half hour, 17 s late', Array.from({ length: 20 }, (_, i) => i * 1800 + 17)],
    ] as const) {
      const rec = new SliceRecorder();
      const d = slice();
      rec.setLine(sliceLineKey(d.line));
      const times = [...new Set([...Array.from({ length: 700 }, (_, i) => i * 60), ...extra])].sort((a, b) => a - b);
      const seen: number[] = [];
      for (const t of times) {
        if (rec.arrive(t)) rec.store(d, t);
        const g = rec.status().spacingS;
        if (g !== (seen[seen.length - 1] ?? 0)) {
          seen.push(g);
          // every time the gap changes, what the status says is what the list is: no two pictures closer, and the typical one (the median) is that far apart
          const kept = rec.sampleTimes();
          const sp = kept.slice(1).map((x, i) => x - kept[i]!);
          const sorted = [...sp].sort((a, b) => a - b);
          expect(Math.min(...sp), `${label}: closest pair when the gap became ${g}`).toBeGreaterThanOrEqual(g - 1e-6);
          expect(sorted[sorted.length >> 1], `${label}: median spacing when the gap became ${g}`).toBeLessThanOrEqual(1.5 * g);
          expect(Math.max(...sp), `${label}: widest pair when the gap became ${g}`).toBeLessThanOrEqual(2 * g + 1e-6);
          expect(kept[0]).toBe(0);
          expect(kept[kept.length - 1]).toBe(rec.status().to);
        }
      }
      expect(seen[0], `${label}: the first gap is twice the 60 s of the steps`).toBe(120);
      for (let i = 1; i < seen.length; i++) expect(seen[i]).toBe(2 * seen[i - 1]!);
      expect(seen.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('on the diagnosed wind it holds 429 samples of 29,256 bytes (the 430 of the byte model less the epoch)', () => {
    const rec = new SliceRecorder();
    const d = slice(0, { kind: 'diagnosed' });
    rec.setLine(sliceLineKey(d.line));
    for (let i = 0; i < 429; i++) arriveAndStore(rec, d, i * 60);
    expect(rec.count).toBe(429);
    expect(rec.status().spacingS).toBe(0);
    arriveAndStore(rec, d, 429 * 60);
    expect(rec.status().spacingS).toBe(120);
    expect(rec.count).toBeLessThan(430);
  });
});

describe('a random stream of arrivals, replays, cuts and budget changes keeps every invariant at every step', () => {
  /** A small seeded generator (mulberry32). */
  function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  for (const seed of [1, 2, 3, 4, 5]) {
    it(`seed ${seed}: 3,000 operations`, () => {
      const r = rng(seed);
      const d = slice(0, { columns: 48, rows: 48 });
      const per = sliceSampleBytes(48 * 48, 'prognostic');
      const epoch = 48 * 48 + 2 * 48 * 4 + 192; // the valid flags, the two ground rows and the bookkeeping
      const rec = new SliceRecorder({ budgetBytes: 20 * per });
      rec.setLine(sliceLineKey(d.line));
      const arrivals = new Set<number>();
      let t = 0;
      let thinned = 0;
      for (let op = 0; op < 3000; op++) {
        const x = r();
        if (x < 0.72) {
          // a picture newer than everything stored: nothing is cut, and the first sample stays
          t += [10, 60, 60, 300][Math.floor(r() * 4)]!;
          arrivals.add(t);
          const before = rec.sampleTimes();
          arriveAndStore(rec, d, t);
          if (before.length > 0) expect(rec.sampleTimes()[0], `op ${op}: the first stays`).toBe(before[0]);
          if (rec.status().spacingS > 0) thinned++;
        } else if (x < 0.82 && rec.count > 0) {
          t = rec.sampleTimes()[Math.floor(r() * rec.count)]! + Math.floor(r() * 3) * 20; // the session cuts at a time that is near the samples
          rec.truncateAfter(t);
        } else if (x < 0.92 && rec.count > 0) {
          t = Math.max(0, rec.sampleTimes()[Math.floor(r() * rec.count)]! - Math.floor(r() * 2) * 60); // a re-emitted picture at or before one that is stored
          arrivals.add(t);
          arriveAndStore(rec, d, t);
        } else if (x < 0.94) {
          rec.setBudget((4 + Math.floor(r() * 30)) * per); // never under four samples, so the first is never the one that has to go
        } else if (x < 0.945) {
          rec.clear();
        }
        const times = rec.sampleTimes();
        const st = rec.status();
        expect(rec.bytes, `op ${op}`).toBeLessThanOrEqual(rec.budgetBytes);
        expect(st.count).toBe(times.length);
        expect(st.bytes).toBe(times.length === 0 ? 0 : epoch + times.length * per);
        if (times.length === 0) continue;
        expect(st.from).toBe(times[0]);
        expect(st.to).toBe(times[times.length - 1]);
        for (let k = 1; k < times.length; k++) {
          expect(times[k]!, `op ${op} order`).toBeGreaterThan(times[k - 1]!);
          expect(times[k]! - times[k - 1]!, `op ${op}: ${times[k - 1]} to ${times[k]} with a gap of ${st.spacingS}`).toBeGreaterThanOrEqual(st.spacingS - 1e-6);
        }
        for (const x2 of times) expect(arrivals.has(x2), `op ${op}: ${x2} is an arrival`).toBe(true);
      }
      expect(thinned, 'the stream did thin').toBeGreaterThan(50);
    });
  }
});

describe('dropping a recording', () => {
  it('the same line keeps it; another line, or none, drops it with `dropped: line` and frees the memory', () => {
    const rec = new SliceRecorder();
    const d = slice();
    const key = sliceLineKey(d.line);
    expect(rec.status()).toMatchObject({ state: 'off', offFor: null, count: 0, from: null, to: null, dropped: null, bytes: 0 });
    rec.setLine(key);
    expect(rec.status().state).toBe('waiting');
    for (let i = 0; i < 5; i++) arriveAndStore(rec, d, i * 60);
    rec.setLine(key); // the same key again: nothing happens
    expect(rec.count).toBe(5);
    expect(rec.status()).toMatchObject({ state: 'recording', from: 0, to: 240, dropped: null });
    expect(rec.bytes).toBeGreaterThan(5 * 48000);

    rec.setLine(sliceLineKey({ a: [0, 100], b: [6000, 100] }));
    expect(rec.count).toBe(0);
    expect(rec.bytes).toBe(0); // the memory is let go
    expect(rec.status()).toMatchObject({ state: 'waiting', dropped: 'line', from: null });
    expect(rec.read(d.line, 240, 'prognostic', null, null)).toBeNull(); // the old line reads nothing

    // recording again keeps the reason the earlier one was dropped, which the panel words with the time it starts
    arriveAndStore(rec, d, 300);
    expect(rec.status()).toMatchObject({ state: 'recording', from: 300, dropped: 'line' });

    rec.setLine(null, 'preset');
    expect(rec.status()).toMatchObject({ state: 'off', offFor: 'preset', count: 0, dropped: 'line' });
    expect(rec.arrive(360)).toBe(false); // no line: nothing is wanted
    rec.setLine(null, 'chord');
    expect(rec.status().offFor).toBe('chord');
    rec.setLine(null);
    expect(rec.status().offFor).toBeNull();
  });

  it('a line change with nothing recorded loses nothing, so it says nothing (a kept preset starts clean)', () => {
    const rec = new SliceRecorder();
    const d = slice();
    rec.setLine(sliceLineKey(d.line));
    arriveAndStore(rec, d, 0);
    rec.clear(); // the person's Clear
    expect(rec.status().dropped).toBe('cleared');
    rec.setLine(null, 'preset'); // nothing to drop
    expect(rec.status().dropped).toBeNull();
    rec.setLine(sliceLineKey(d.line)); // "Keep this line"
    expect(rec.status()).toMatchObject({ state: 'waiting', dropped: null, offFor: null });
  });

  it('another lattice (the high tier has a finer model grid) starts a new epoch: dropped `model`, and the new sample is the first', () => {
    const rec = new SliceRecorder();
    const d = slice();
    rec.setLine(sliceLineKey(d.line));
    for (let i = 0; i < 4; i++) arriveAndStore(rec, d, i * 60);
    const finer = slice(0, { columns: 120, rows: 54, cellSizeM: 100 });
    arriveAndStore(rec, finer, 240);
    expect(rec.count).toBe(1);
    expect(rec.status()).toMatchObject({ state: 'recording', from: 240, to: 240, dropped: 'model' });
    expect(rec.read(finer.line, 240, 'prognostic', null, null)!.columns).toBe(120);
    expect(rec.bytes).toBeLessThan(sliceSampleBytes(120 * 54, 'prognostic') + 12_000);
  });

  it('a height axis or a model ground that really differs is another lattice; one that differs by float noise is not', () => {
    const base = (): SliceRecorder => {
      const rec = new SliceRecorder();
      const d = slice();
      rec.setLine(sliceLineKey(d.line));
      arriveAndStore(rec, d, 0);
      return rec;
    };
    const kept = (mutate: (d: SliceData) => void): boolean => {
      const rec = base();
      const d = slice();
      mutate(d);
      arriveAndStore(rec, d, 60);
      return rec.count === 2;
    };
    expect(kept(() => undefined)).toBe(true);
    expect(kept((d) => (d.zMax += 0.004))).toBe(true);
    expect(kept((d) => (d.modelGround[3]! += 0.4))).toBe(true);
    expect(kept((d) => (d.zMax += 5))).toBe(false);
    expect(kept((d) => (d.zMin -= 5))).toBe(false);
    expect(kept((d) => (d.topAsl += 100))).toBe(false);
    expect(kept((d) => (d.modelGround[3]! += 0.7))).toBe(false);
    expect(kept((d) => (d.cellSizeM = 100))).toBe(false);
  });

  it('a change of the kind of air inside one lattice keeps the epoch: each sample has its own kind, and a read matches it', () => {
    const rec = new SliceRecorder();
    const prog = slice(0);
    rec.setLine(sliceLineKey(prog.line));
    arriveAndStore(rec, prog, 0);
    arriveAndStore(rec, prog, 60);
    const diag = slice(0, { kind: 'diagnosed' });
    arriveAndStore(rec, diag, 120);
    expect(rec.count).toBe(3);
    expect(rec.status().dropped).toBeNull();
    expect(rec.read(prog.line, 60, 'prognostic', null, null)!.kind).toBe('prognostic');
    expect(rec.read(prog.line, 120, 'diagnosed', null, null)!.kind).toBe('diagnosed');
    expect(rec.read(prog.line, 120, 'prognostic', null, null)).toBeNull(); // the picture is of the other air: no mixing
    expect(rec.read(prog.line, 60, 'diagnosed', null, null)).toBeNull();
    // the diagnosed sample is smaller: 3 fields a point
    expect(rec.bytes).toBeLessThan(2 * 48696 + 29256 + 12_000);
  });

  it('Clear recording drops the samples with `dropped: cleared`, keeps the line and restarts from the next picture; a silent clear says nothing', () => {
    const rec = new SliceRecorder();
    const d = slice();
    rec.setLine(sliceLineKey(d.line));
    for (let i = 0; i < 6; i++) arriveAndStore(rec, d, i * 60);
    rec.clear();
    expect(rec.status()).toMatchObject({ state: 'waiting', count: 0, dropped: 'cleared', spacingS: 0, bytes: 0 });
    expect(rec.arrive(360)).toBe(true);
    arriveAndStore(rec, d, 420);
    expect(rec.status()).toMatchObject({ state: 'recording', from: 420, dropped: 'cleared' });
    rec.clear(null);
    expect(rec.status()).toMatchObject({ state: 'waiting', dropped: null });
    rec.clear(); // nothing recorded: pressing it again changes nothing
    expect(rec.status().dropped).toBeNull();
  });

  it('reset forgets the line too, without a word', () => {
    const rec = new SliceRecorder();
    const d = slice();
    rec.setLine(sliceLineKey(d.line));
    arriveAndStore(rec, d, 0);
    rec.clear();
    arriveAndStore(rec, d, 60);
    rec.reset();
    expect(rec.status()).toMatchObject({ state: 'off', offFor: null, count: 0, dropped: null, bytes: 0, spacingS: 0 });
    expect(rec.arrive(120)).toBe(false);
    rec.store(d, 120); // no line: refused
    expect(rec.count).toBe(0);
  });

  it('a thinned recording that is dropped starts again at spacing 0', () => {
    const probe = new SliceRecorder({ budgetBytes: 6 * 48696 });
    const d = slice();
    probe.setLine(sliceLineKey(d.line));
    for (let i = 0; i < 40; i++) arriveAndStore(probe, d, i * 60);
    expect(probe.status().spacingS).toBeGreaterThan(0);
    probe.setLine(sliceLineKey({ a: [10, 0], b: [6010, 0] }));
    expect(probe.status().spacingS).toBe(0);
    arriveAndStore(probe, d, 2400);
    arriveAndStore(probe, d, 2460);
    expect(probe.count).toBe(2); // every picture again
  });
});

describe('what it does with memory', () => {
  it('bytes is exactly the epoch and whole samples after any amount of thinning and cutting, and never over the budget', () => {
    const rec = new SliceRecorder({ budgetBytes: 9 * 48696 });
    const d = slice();
    rec.setLine(sliceLineKey(d.line));
    const epoch = 4860 + 2 * 90 * 4 + 192; // the valid flags, the two ground rows and the bookkeeping
    for (let i = 0; i < 300; i++) {
      arriveAndStore(rec, d, i * 45);
      if (i % 37 === 36) rec.truncateAfter(i * 45 - 500);
      const s = rec.status();
      expect(s.bytes).toBe(s.count === 0 ? 0 : epoch + s.count * 48696);
      expect(s.bytes).toBeLessThanOrEqual(9 * 48696);
    }
    expect(rec.count).toBeGreaterThan(0);
  });

  it('the lines of an epoch are copied: a later change of the object it was given does not change what is read', () => {
    const rec = new SliceRecorder();
    const d = slice();
    rec.setLine(sliceLineKey(d.line));
    arriveAndStore(rec, d, 0);
    const a0 = d.line.a[0];
    d.line.a[0] = 999;
    d.ground.fill(0);
    const key = sliceLineKey({ a: [a0, 0], b: [6000, 0] });
    expect(key).toBe('0,0;60000,0');
    const back = rec.read({ a: [a0, 0], b: [6000, 0], dir: [1, 0], length: 6000 }, 0, 'prognostic', null, null)!;
    expect(back.ground[5]).toBeGreaterThan(400);
    expect(back.line.a[0]).toBe(0);
  });
});
