/**
 * The updater with a fake clock: a snapshot-time request inside 250 ms is pending and `poll` releases it, an edit never waits,
 * the arrays are reused across updates, and `invalidate` forgets everything. With a recording (0.4.1) it asks the reader first and
 * takes its slice, and a live slice never keeps the recorded tag.
 */
import { describe, expect, it } from 'vitest';
import { makeGridSpec } from '../../core/grid';
import { AtmosphereSampler, type SectionLine } from '../atmosphereSampler';
import { createSliceUpdater } from './sliceUpdater';
import { makeAirView, makeResolveContext, makeSliceData } from './testing';
import { SLICE_PRESET_IDS, SLICE_UPDATE_MIN_MS, type SliceData, type SliceInputs, type SliceKind, type SliceLineState, type SliceRecordingReader } from './types';

const ORIGIN = { lat: -33.7, lon: 150.3 };
const GRID = makeGridSpec(ORIGIN, 31 * 200, 200); // +-3000 m, 200 m cells
const ridge = (x: number): number => 500 + 400 * Math.exp(-((x / 700) ** 2));
const terrain = { heightAt: (x: number) => ridge(x) };

const airView = (speed: number) => makeAirView({ grid: GRID, groundAt: ridge, u: () => speed, v: () => 0, w: () => 0, theta: (x) => x / 1000, smoke: () => 1 });
const ctx = makeResolveContext({ grid: GRID, heightAt: ridge, fire: [200, 0], windFromDeg: 270, user: [-1500, 0] });
const east: SliceLineState = { azimuth: 90, centre: [0, 0] };

function inputs(o: { speed?: number; line?: SliceLineState; shownTime?: number; sampler?: AtmosphereSampler; recording?: SliceRecordingReader } = {}): SliceInputs {
  return {
    line: o.line ?? east,
    ctx,
    sampler: o.sampler ?? new AtmosphereSampler(airView(o.speed ?? 5), 0, null),
    terrain,
    shownTime: o.shownTime ?? 0,
    ...(o.recording ? { recording: o.recording } : {}),
  };
}

describe('createSliceUpdater: the throttle', () => {
  it('computes the first request at once, even when it is not immediate', () => {
    const u = createSliceUpdater();
    expect(u.latest).toBeNull();
    const r = u.request(inputs(), 1000);
    expect(r).not.toBeNull();
    expect(u.latest).toBe(r);
    expect(r!.data!.seq).toBe(1);
  });

  it('a snapshot request inside 250 ms is pending (null), and poll releases it once the time has passed', () => {
    const u = createSliceUpdater();
    const first = u.request(inputs({ shownTime: 1 }), 1000)!;
    expect(u.request(inputs({ shownTime: 2 }), 1100)).toBeNull();
    expect(u.latest).toBe(first);
    expect(u.poll(1200)).toBeNull(); // 200 ms since the last computation
    expect(u.poll(1249.9)).toBeNull();
    const released = u.poll(1250)!; // 250 ms
    expect(released).not.toBeNull();
    expect(u.latest).toBe(released);
    expect(released.data!.shownTime).toBe(2); // the pending request, not the first
    expect(u.poll(1500)).toBeNull(); // nothing pending any more
    expect(u.poll(99999)).toBeNull();
  });

  it('the newest pending request wins, and only one computation follows', () => {
    const u = createSliceUpdater();
    u.request(inputs({ shownTime: 1 }), 0);
    u.request(inputs({ shownTime: 2 }), 50);
    u.request(inputs({ shownTime: 3 }), 100);
    u.request(inputs({ shownTime: 4 }), 150);
    const r = u.poll(250)!;
    expect(r.data!.shownTime).toBe(4);
    expect(r.data!.seq).toBe(2); // the first request and this one: two computations in all
  });

  it('a request after the interval computes at once and clears anything pending', () => {
    const u = createSliceUpdater();
    u.request(inputs({ shownTime: 1 }), 0);
    u.request(inputs({ shownTime: 2 }), 100); // pending
    const r = u.request(inputs({ shownTime: 3 }), 400)!;
    expect(r.data!.shownTime).toBe(3);
    expect(u.poll(1000)).toBeNull(); // the pending one was superseded
  });

  it('immediate never waits, however soon after the last computation, and resets the interval', () => {
    const u = createSliceUpdater();
    u.request(inputs({ shownTime: 1 }), 1000);
    // (The data object is the same each time and changes in place: read what it holds before the next request.)
    expect(u.request(inputs({ shownTime: 2 }), 1001, true)!.data!.shownTime).toBe(2);
    expect(u.request(inputs({ shownTime: 3 }), 1002, true)!.data!.shownTime).toBe(3);
    // The interval counts from the last computation (1002), so a snapshot at 1100 waits for 1252.
    expect(u.request(inputs({ shownTime: 4 }), 1100)).toBeNull();
    expect(u.poll(1251)).toBeNull();
    expect(u.poll(1252)!.data!.shownTime).toBe(4);
  });

  it('an immediate request drops a pending snapshot request: the edit is the newer state', () => {
    const u = createSliceUpdater();
    u.request(inputs({ shownTime: 1 }), 0);
    u.request(inputs({ shownTime: 2 }), 10); // pending
    u.request(inputs({ shownTime: 9 }), 20, true);
    expect(u.poll(10_000)).toBeNull();
    expect(u.latest!.data!.shownTime).toBe(9);
  });

  it('uses the minimum interval of its options, 250 ms by default', () => {
    expect(SLICE_UPDATE_MIN_MS).toBe(250);
    const slow = createSliceUpdater({ minIntervalMs: 1000 });
    slow.request(inputs(), 0);
    expect(slow.request(inputs(), 600)).toBeNull();
    expect(slow.poll(999)).toBeNull();
    expect(slow.poll(1000)).not.toBeNull();
    const none = createSliceUpdater({ minIntervalMs: 0 });
    none.request(inputs(), 5);
    expect(none.request(inputs(), 5)).not.toBeNull();
  });

  it('a clock that goes backwards computes at once instead of waiting for ever', () => {
    const u = createSliceUpdater();
    u.request(inputs(), 10_000);
    expect(u.request(inputs(), 100)).not.toBeNull();
  });
});

describe('createSliceUpdater: what it computes', () => {
  it('resolves the line, samples it, and states which presets can be tapped', () => {
    const u = createSliceUpdater();
    const r = u.request(inputs({ line: { ...east, preset: 'along' } }), 0)!;
    expect(r.resolved.source).toBe('preset');
    expect(r.resolved.line).not.toBeNull();
    expect(r.data!.line).toBe(r.resolved.line);
    expect(r.data!.kind).toBe('prognostic');
    expect(Object.keys(r.presets).sort()).toEqual([...SLICE_PRESET_IDS].sort());
    expect(r.presets.along).toEqual({ ok: true });
    expect(r.presets.me).toEqual({ ok: true });
    expect(r.presets.slope).toEqual({ ok: true });
    const none = u.request({ ...inputs(), ctx: makeResolveContext({ grid: GRID, heightAt: () => 500, fire: null, windFromDeg: null, user: null }) }, 1000, true)!;
    expect(none.presets).toEqual({ along: { ok: false, issue: 'calm' }, across: { ok: false, issue: 'calm' }, slope: { ok: false, issue: 'flat-ground' }, me: { ok: false, issue: 'no-user' } });
  });

  it('has no data when there is no line (and says why), and keeps the presets', () => {
    const u = createSliceUpdater();
    const r = u.request(inputs({ line: { azimuth: 90, centre: [0, 0], a: [0, 0], b: [100, 0] } }), 0)!;
    expect(r.resolved.issue).toBe('too-short');
    expect(r.data).toBeNull();
    expect(r.presets.along.ok).toBe(true);
  });

  it('has no data when the air holds no 3-D wind', () => {
    const u = createSliceUpdater();
    expect(u.request(inputs({ sampler: new AtmosphereSampler(null, 0, null) }), 0)!.data).toBeNull();
  });
});

describe('createSliceUpdater: the arrays are reused', () => {
  it('the same SliceData object and the same arrays across updates of the same line, with seq counting up', () => {
    const u = createSliceUpdater();
    const a = u.request(inputs({ speed: 5 }), 0)!.data!;
    const speedArr = a.values.speed;
    const b = u.request(inputs({ speed: 9 }), 300)!.data!;
    expect(b).toBe(a);
    expect(b.values.speed).toBe(speedArr);
    expect(b.seq).toBe(a.seq); // the same object: it changed in place
    expect(b.seq).toBe(2);
    expect(b.values.speed[b.values.speed.length - 1]).toBeCloseTo(9, 4); // the new air is in it
    const c = u.request(inputs({ speed: 3 }), 600, true)!.data!;
    expect(c).toBe(a);
    expect(c.seq).toBe(3);
  });

  it('a longer line is a new object, and the one after it reuses that', () => {
    const u = createSliceUpdater();
    const a = u.request(inputs({ line: { azimuth: 90, centre: [0, 0], a: [-500, 0], b: [500, 0] } }), 0)!.data!;
    const b = u.request(inputs(), 1000, true)!.data!;
    expect(b).not.toBe(a);
    expect(b.columns).toBeGreaterThan(a.columns);
    expect(b.seq).toBeGreaterThan(a.seq);
    const c = u.request(inputs(), 2000, true)!.data!;
    expect(c).toBe(b);
  });

  it('the data survives a moment with no usable line, so the same line later reuses it', () => {
    const u = createSliceUpdater();
    const a = u.request(inputs(), 0)!.data!;
    expect(u.request(inputs({ line: { azimuth: 90, centre: [9e6, 0] } }), 1000, true)!.data).toBeNull();
    expect(u.request(inputs(), 2000, true)!.data).toBe(a);
  });

  it('seq never goes back, even across a change of lattice size and an invalidation', () => {
    const u = createSliceUpdater();
    const seqs: number[] = [];
    seqs.push(u.request(inputs({ line: { azimuth: 90, centre: [0, 0], a: [-500, 0], b: [500, 0] } }), 0)!.data!.seq);
    seqs.push(u.request(inputs(), 1000, true)!.data!.seq);
    u.invalidate();
    seqs.push(u.request(inputs(), 2000, true)!.data!.seq);
    seqs.push(u.request(inputs(), 3000, true)!.data!.seq);
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]!).toBeGreaterThan(seqs[i - 1]!);
  });
});

describe('createSliceUpdater: invalidate', () => {
  it('drops the held result and the pending request, and the next request computes at once into fresh arrays', () => {
    const u = createSliceUpdater();
    const first = u.request(inputs({ shownTime: 1 }), 1000)!;
    u.request(inputs({ shownTime: 2 }), 1100); // pending
    u.invalidate();
    expect(u.latest).toBeNull();
    expect(u.poll(5000)).toBeNull();
    const after = u.request(inputs({ shownTime: 3 }), 1101)!; // 1 ms after the last computation, and still computed: nothing to wait for
    expect(after.data!.shownTime).toBe(3);
    expect(after.data).not.toBe(first.data);
    expect(after.data!.values.speed).not.toBe(first.data!.values.speed);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The time-lapse recording (0.4.1)
// ─────────────────────────────────────────────────────────────────────────────

interface ReadCall {
  line: SectionLine;
  shownTime: number;
  kind: SliceKind;
  pictureAirTime: number | null;
  out: SliceData | null;
}

/** A reader that answers from a function and remembers what it was asked. */
function reader(answer: (call: ReadCall) => SliceData | null): { reader: SliceRecordingReader; calls: ReadCall[] } {
  const calls: ReadCall[] = [];
  return {
    calls,
    reader: {
      read(line, shownTime, kind, pictureAirTime, out) {
        const call = { line, shownTime, kind, pictureAirTime, out };
        calls.push(call);
        return answer(call);
      },
    },
  };
}

/** A recorded slice the way the reader makes it: tagged, with no model cells, wind 9 m/s along the line. */
function recorded(at: number, out: SliceData | null = null): SliceData {
  const d = out ?? makeSliceData({ columns: 60, rows: 40, a: [-3000, 0], b: [3000, 0], wind: () => [9, 0, 0] });
  d.recordedAt = at;
  d.cells = null;
  return d;
}

describe('createSliceUpdater: a recorded slice', () => {
  it('is the data when the reader answers, tagged, with the updater\'s own count on it', () => {
    const u = createSliceUpdater();
    const r = reader(() => recorded(300));
    const out = u.request(inputs({ recording: r.reader, shownTime: 400 }), 0)!;
    expect(out.data).not.toBeNull();
    expect(out.data!.recordedAt).toBe(300);
    expect(out.data!.cells).toBeNull();
    expect(out.data!.values.speed[0]).toBe(0); // (the reader's lattice, not a live sample of the 5 m/s air)
    expect(out.data!.seq).toBe(1);
    expect(u.request(inputs({ recording: r.reader, shownTime: 500 }), 1000, true)!.data!.seq).toBe(2);
  });

  it('asks the reader for the resolved line, the time shown, the kind of air, the picture\'s air time and the data it holds', () => {
    const u = createSliceUpdater();
    const r = reader(() => null);
    const first = u.request(inputs({ recording: r.reader, shownTime: 450 }), 0)!;
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]!.line).toBe(first.resolved.line);
    expect(r.calls[0]!.shownTime).toBe(450);
    expect(r.calls[0]!.kind).toBe('prognostic');
    expect(r.calls[0]!.pictureAirTime).toBe(600); // the air view's own time (the fixture's default)
    expect(r.calls[0]!.out).toBeNull(); // nothing held yet
    u.request(inputs({ recording: r.reader, shownTime: 460 }), 1000, true);
    expect(r.calls[1]!.out).toBe(first.data); // the object the live slice was made into: the reader may refill it
  });

  it('says "diagnosed" for the fast tier\'s air', () => {
    const u = createSliceUpdater();
    const r = reader(() => null);
    const sampler = new AtmosphereSampler(makeAirView({ grid: GRID, groundAt: ridge, u: () => 4, v: () => 0, w: () => 0, kind: 'diagnosed', time: 120 }), 0, null);
    expect(u.request(inputs({ recording: r.reader, sampler }), 0)!.data!.kind).toBe('diagnosed');
    expect(r.calls[0]!.kind).toBe('diagnosed');
    expect(r.calls[0]!.pictureAirTime).toBe(120);
  });

  it('falls back to a live slice of the picture\'s air when the reader has none', () => {
    const u = createSliceUpdater();
    const r = reader(() => null);
    const d = u.request(inputs({ recording: r.reader, speed: 7 }), 0)!.data!;
    expect(d.recordedAt).toBeUndefined();
    expect(d.cells).not.toBeNull();
    expect(d.values.speed[d.values.speed.length - 1]).toBeCloseTo(7, 4);
  });

  it('a live slice after a recorded one, in the same object, has no recordedAt and has its model cells again', () => {
    const u = createSliceUpdater();
    let mode: 'live' | 'recorded' = 'live';
    // The reader refills the slice it is given when the lattice matches, as the real one does.
    const r = reader((c) => (mode === 'recorded' && c.out ? recorded(250, c.out) : null));
    const live = u.request(inputs({ recording: r.reader }), 0)!.data!;
    expect(live.recordedAt).toBeUndefined();
    mode = 'recorded';
    const rec = u.request(inputs({ recording: r.reader }), 1000, true)!.data!;
    expect(rec).toBe(live); // one object, changed in place
    expect(rec.recordedAt).toBe(250);
    expect(rec.cells).toBeNull();
    mode = 'live';
    const again = u.request(inputs({ recording: r.reader }), 2000, true)!.data!;
    expect(again).toBe(live);
    expect(again.recordedAt).toBeUndefined();
    expect(again.cells).not.toBeNull();
  });

  it('a live slice after a recorded one of another size is a new object without the tag', () => {
    const u = createSliceUpdater();
    let mode: 'recorded' | 'live' = 'recorded';
    const r = reader(() => (mode === 'recorded' ? recorded(100) : null));
    const rec = u.request(inputs({ recording: r.reader }), 0)!.data!;
    expect(rec.recordedAt).toBe(100);
    mode = 'live';
    const live = u.request(inputs({ recording: r.reader }), 1000, true)!.data!;
    expect(live).not.toBe(rec);
    expect(live.recordedAt).toBeUndefined();
  });

  it('without a recording the reader is never involved: the slice is as in 0.4.0', () => {
    const u = createSliceUpdater();
    const d = u.request(inputs(), 0)!.data!;
    expect(d.recordedAt).toBeUndefined();
    expect(d.cells).not.toBeNull();
  });

  it('does not ask when there is no line or the air holds no 3-D wind', () => {
    const u = createSliceUpdater();
    const r = reader(() => recorded(1));
    expect(u.request(inputs({ recording: r.reader, line: { azimuth: 90, centre: [0, 0], a: [0, 0], b: [100, 0] } }), 0)!.data).toBeNull();
    expect(u.request(inputs({ recording: r.reader, sampler: new AtmosphereSampler(null, 0, null) }), 1000, true)!.data).toBeNull();
    expect(r.calls).toHaveLength(0);
  });

  it('a reader that throws leaves the live slice, never an error in the scene\'s update', () => {
    const u = createSliceUpdater();
    const r = reader(() => {
      throw new Error('broken recorder');
    });
    let out: ReturnType<typeof u.request> = null;
    expect(() => (out = u.request(inputs({ recording: r.reader, speed: 6 }), 0))).not.toThrow();
    expect(out!.data!.recordedAt).toBeUndefined();
    expect(out!.data!.values.speed[out!.data!.values.speed.length - 1]).toBeCloseTo(6, 4);
  });

  it('a pending snapshot request keeps its reader for the poll that releases it', () => {
    const u = createSliceUpdater();
    const r = reader(() => recorded(200));
    u.request(inputs(), 0);
    expect(u.request(inputs({ recording: r.reader, shownTime: 90 }), 100)).toBeNull();
    const released = u.poll(300)!;
    expect(released.data!.recordedAt).toBe(200);
    expect(r.calls[0]!.shownTime).toBe(90);
  });
});
