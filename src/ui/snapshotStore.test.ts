/**
 * The compact history store (snapshotStore.ts) on small synthetic snapshots: light frames, keyframes, exact fire
 * reconstruction, identity within a quantum, buffer rotation, truncation, spot-fire log and the memory bound.
 * (Against the real simulation: snapshotStore.sim.test.ts.)
 */
import { describe, expect, it } from 'vitest';
import { BurnState, type FireField, type SimSnapshot, type SimStats, type SpotFire } from '../core/types';
import { MAX_QUANTUM_S, SnapshotStore } from './snapshotStore';

const N = 100;
const GRID = { nx: 10, ny: 10, cellSize: 30, x0: 0, y0: 0, origin: { lat: 0, lon: 0 } } as unknown as FireField['grid'];

/**
 * A fire whose cell k arrives at 30·k (k < 40, rest never), burns for `burn` s; state as at time t. Cell 99 is
 * non-flammable. All other arrays are distinct so sharing can be observed.
 */
function fireAt(t: number, burn = 120): FireField {
  const arrivalTime = new Float32Array(N).fill(Infinity);
  const burnState = new Uint8Array(N).fill(BurnState.Unburnt);
  for (let k = 0; k < 40; k++) {
    const a = 30 * k;
    if (a <= t) {
      arrivalTime[k] = a;
      burnState[k] = t - a < burn ? BurnState.Burning : BurnState.BurntOut;
    }
  }
  burnState[99] = BurnState.NonFlammable;
  return { grid: GRID, arrivalTime, burnState, ros: new Float32Array(N).fill(0.5), intensity: new Float32Array(N).fill(900), flameHeight: new Float32Array(N).fill(2), spreadDir: new Float32Array(N).fill(45), driver: new Uint8Array(N), phase: new Uint8Array(N) };
}

const stats = (time: number): SimStats => ({ time, burntAreaHa: time / 100, deadFuelMoistureMean: 8 }) as unknown as SimStats;

interface MakeOpts {
  spots?: number;
  bigBytes?: number;
  burn?: number;
  moisture?: Float32Array;
}

function snap(time: number, o: MakeOpts = {}): SimSnapshot {
  const spotFires: SpotFire[] = Array.from({ length: o.spots ?? 0 }, (_, i) => ({ id: i + 1, x: i, y: i, time: i * 10, distance: 1, travel: 1 }));
  const big = o.bigBytes ? new Float32Array(o.bigBytes / 4) : undefined;
  return {
    time,
    fire: fireAt(time, o.burn),
    moisture: o.moisture ?? new Float32Array(N).fill(time),
    atmosphere: big ? ({ grid: GRID, nz: 1, levels: big, terrainHeight: new Float32Array(0), surfaceU: new Float32Array(0), surfaceV: new Float32Array(0), u: new Float32Array(0), v: new Float32Array(0), w: new Float32Array(0), thetaAnomaly: new Float32Array(0), smoke: new Float32Array(0) } as unknown as SimSnapshot['atmosphere']) : undefined,
    embers: { count: 1, data: new Float32Array(4).fill(time) },
    spotFires,
    stats: stats(time),
    insights: [],
    layers: { vls: new Float32Array(N).fill(time) },
  } as SimSnapshot;
}

function filled(upTo: number, step = 60, o: MakeOpts = {}, store = new SnapshotStore({ minInterval: step, maxBytes: 1e9 })): SnapshotStore {
  for (let t = 0; t <= upTo; t += step) store.push(snap(t, o));
  return store;
}

describe('SnapshotStore steps and keyframes', () => {
  it('keeps a light frame for every step and a full picture per 300 s', () => {
    const st = filled(900);
    expect(st.times()).toEqual(Array.from({ length: 16 }, (_, i) => i * 60));
    expect(st.size).toBe(16);
    expect(st.keyframeTimes()).toEqual([0, 300, 600]); // the newest snapshot (900) is whole, not yet demoted
    st.push(snap(960));
    expect(st.keyframeTimes()).toEqual([0, 300, 600, 900]);
    expect(st.range()).toEqual({ start: 0, end: 960 });
    expect(st.all().map((f) => f.time)).toEqual(st.times());
    expect(st.all()[3]!.stats.burntAreaHa).toBe(1.8);
    expect(st.spacing).toBe(60);
  });

  it('keyframes are as far apart as the display step when that is larger than 300 s', () => {
    const st = filled(3000, 600, {}, new SnapshotStore({ minInterval: 600, maxBytes: 1e9 }));
    expect(st.keyframeTimes()).toEqual([0, 600, 1200, 1800, 2400]);
  });

  it('a snapshot at or before existing ones invalidates them; truncation drops later history', () => {
    const st = filled(1200);
    st.push(snap(600)); // the worker re-simulated from an earlier checkpoint
    expect(st.times().at(-1)).toBe(600);
    expect(st.latest()!.time).toBe(600);
    expect(st.keyframeTimes()).toEqual([0, 300]);
    st.truncateAfter(300);
    expect(st.range()).toEqual({ start: 0, end: 300 });
    st.truncateFrom(0);
    expect(st.size).toBe(0);
    expect(st.latest()).toBeNull();
    expect(st.at(10)).toBeNull();
    expect(st.totalBytes).toBe(0);
  });
});

describe('SnapshotStore.at', () => {
  it('gives the real newest snapshot at or after its time and the first one before the first time', () => {
    const st = filled(600);
    const head = st.latest()!;
    expect(head.time).toBe(600);
    expect(st.at(600)).toBe(head);
    expect(st.at(9999)).toBe(head);
    expect(st.at(-50)!.time).toBe(0);
    expect(st.atOrBefore(-50)!.time).toBe(0);
  });

  it('composes an exact picture for any earlier time: the fire from the newest arrays, the rest from the frames', () => {
    const st = filled(900);
    const head = st.latest()!;
    const s = st.at(437)!;
    expect(s.time).toBe(437);
    // Fire: arrival later than t is unburnt again; the earlier arrivals are exactly the newest's.
    for (let k = 0; k < 40; k++) {
      const a = 30 * k;
      expect(s.fire.arrivalTime[k], `arrival ${k}`).toBe(a <= 437 ? a : Infinity);
      const want = a > 437 ? BurnState.Unburnt : 437 - a < 120 ? BurnState.Burning : BurnState.BurntOut;
      expect(s.fire.burnState[k], `state ${k}`).toBe(want);
    }
    expect(s.fire.burnState[99]).toBe(BurnState.NonFlammable);
    expect(s.fire.burnState[60]).toBe(BurnState.Unburnt);
    // The other per-cell arrays are the newest snapshot's own.
    expect(s.fire.ros).toBe(head.fire.ros);
    expect(s.fire.intensity).toBe(head.fire.intensity);
    expect(s.fire.driver).toBe(head.fire.driver);
    expect(s.fire.grid).toBe(head.fire.grid);
    // Light frame at or before 437 (420), keyframe at or before (300), embers of the nearest step (420).
    expect(s.stats.time).toBe(420);
    expect(s.moisture[0]).toBe(300);
    expect(s.layers!['vls']![0]).toBe(300);
    expect(s.embers.data[0]).toBe(420);
    expect(s.insights).toEqual([]);
  });

  it('is stable within a quantum (min of the display step and 30 s) unless an exact time is asked for', () => {
    const st = filled(900);
    expect(MAX_QUANTUM_S).toBe(30);
    const a = st.atOrBefore(431)!;
    expect(a.time).toBe(420);
    expect(st.atOrBefore(420)).toBe(a);
    expect(st.atOrBefore(449.9)).toBe(a);
    const b = st.atOrBefore(450)!;
    expect(b).not.toBe(a);
    expect(b.time).toBe(450);
    // Exact times are cached per time only.
    const e = st.at(431)!;
    expect(e.time).toBe(431);
    expect(st.at(431)).toBe(e);
    expect(st.at(432)).not.toBe(e);
    // A shorter display step shortens the quantum.
    st.setStep(10);
    expect(st.atOrBefore(437)!.time).toBe(430);
    expect(st.displayStep).toBe(10);
  });

  it('keeps a composed picture valid across forward pushes but not across truncation', () => {
    const st = filled(900);
    const a = st.atOrBefore(437)!;
    st.push(snap(960));
    st.push(snap(1020));
    expect(st.atOrBefore(437)).toBe(a);
    st.truncateAfter(800);
    expect(st.atOrBefore(437)).not.toBe(a);
  });

  it('rebuilds into two rotating buffers: a composed picture is valid until the second next composition', () => {
    const st = filled(900);
    const a = st.at(100)!;
    const b = st.at(200)!;
    const c = st.at(300)!;
    expect(b.fire.arrivalTime).not.toBe(a.fire.arrivalTime);
    expect(c.fire.arrivalTime).toBe(a.fire.arrivalTime); // reused: `a` is stale now
    expect(b.fire.arrivalTime[5]).toBe(150);
    expect(b.fire.arrivalTime[7]).toBe(Infinity);
    expect(c.fire.arrivalTime[10]).toBe(300);
    expect(st.at(200)!.fire.arrivalTime[7]).toBe(Infinity);
  });

  it('notes burn-out between steps: Burning until the step it was first seen burnt out (midpoint)', () => {
    const st = new SnapshotStore({ minInterval: 60, maxBytes: 1e9 });
    for (let t = 0; t <= 600; t += 60) st.push(snap(t, { burn: 200 }));
    // Cell 3 arrives at 90 and burns out at 290 (true): first seen burnt out at 300, last seen burning at 240.
    const at = (t: number): number => st.at(t)!.fire.burnState[3]!;
    expect(at(60)).toBe(BurnState.Unburnt);
    expect(at(120)).toBe(BurnState.Burning);
    expect(at(240)).toBe(BurnState.Burning);
    expect(at(269)).toBe(BurnState.Burning); // the estimate is the midpoint of (240, 300]
    expect(at(271)).toBe(BurnState.BurntOut);
    expect(at(300)).toBe(BurnState.BurntOut);
    expect(at(420)).toBe(BurnState.BurntOut);
  });
});

describe('SnapshotStore after a rewind', () => {
  it('still shows the exact fire up to the truncation time from the discarded newest arrays, then from the new ones', () => {
    const st = filled(900);
    const before = Array.from(st.at(500)!.fire.arrivalTime);
    st.truncateAfter(600);
    expect(st.range()!.end).toBe(600);
    expect(st.latest()!.time).toBe(600);
    expect(st.latest()!.fire.arrivalTime[10]).toBe(300);
    expect(st.latest()!.fire.arrivalTime[21]).toBe(Infinity); // 630 > 600
    expect(Array.from(st.at(500)!.fire.arrivalTime)).toEqual(before);
    // The worker re-simulates with a new fire (cell 50 ignited at 630) and reports the next step.
    const next = snap(660);
    next.fire.arrivalTime[50] = 630;
    next.fire.burnState[50] = BurnState.Burning;
    st.push(next);
    expect(st.at(640)!.fire.arrivalTime[50]).toBe(630);
    expect(st.at(500)!.fire.arrivalTime[50]).toBe(Infinity);
    expect(Array.from(st.at(500)!.fire.arrivalTime)).toEqual(before);
  });

  it('shows the re-run\'s moisture / layers / atmosphere straight after a rewind, not a keyframe of the old run', () => {
    // 20 min of the old run: keyframes at 0, 300, 600, 900 (the newest snapshot, 1200, is whole and not yet demoted).
    const st = filled(1200, 60, { moisture: new Float32Array(N).fill(1) });
    expect(st.keyframeTimes()).toEqual([0, 300, 600, 900]);
    // A rewind to 700 (an atmosphere tier change, an edit): the worker re-runs from there with different data (moisture 2).
    st.truncateAfter(700);
    for (let t = 720; t <= 1020; t += 60) st.push(snap(t, { moisture: new Float32Array(N).fill(2) }));
    // The first re-run picture became a keyframe at once, although the last old one (600) is less than 300 s older.
    expect(st.keyframeTimes()).toEqual([0, 300, 600, 720]);
    // A time inside the re-run shows the new data (before the fix it came from the old keyframe at 600 until 900).
    expect(st.at(780)!.moisture![0]).toBe(2);
    expect(st.at(1000)!.moisture![0]).toBe(2);
    // The kept part of the old run is untouched.
    expect(st.at(650)!.moisture![0]).toBe(1);
    expect(st.at(300)!.moisture![0]).toBe(1);
    // Later keyframes keep their usual spacing.
    for (let t = 1080; t <= 1500; t += 60) st.push(snap(t, { moisture: new Float32Array(N).fill(2) }));
    expect(st.keyframeTimes()).toEqual([0, 300, 600, 720, 1020, 1320]);
  });
});

describe('SnapshotStore spot fires', () => {
  it('keeps each step its own count from one shared log, and survives a divergence', () => {
    const st = new SnapshotStore({ minInterval: 60, maxBytes: 1e9 });
    for (let i = 0; i <= 6; i++) st.push(snap(i * 60, { spots: Math.max(0, i - 1) }));
    expect(st.at(60)!.spotFires).toHaveLength(0);
    expect(st.at(180)!.spotFires.map((s) => s.id)).toEqual([1, 2]);
    expect(st.at(359)!.spotFires).toHaveLength(4);
    expect(st.latest()!.spotFires).toHaveLength(5);
    // The re-simulation produced a different third spot fire.
    st.truncateFrom(300);
    const other = snap(300, { spots: 4 });
    other.spotFires[2] = { ...other.spotFires[2]!, id: 99 };
    st.push(other);
    expect(st.latest()!.spotFires.map((s) => s.id)).toEqual([1, 2, 99, 4]);
    expect(st.at(200)!.spotFires.map((s) => s.id)).toEqual([1, 2]);
    expect(st.at(299)!.spotFires.map((s) => s.id)).toEqual([1, 2]);
  });
});

describe('SnapshotStore memory', () => {
  const MB = 1048576;

  it('stays inside the budget for 6 h at a 10 s step, thinning older history and keeping recent history fine', () => {
    const budget = 40 * MB;
    const st = new SnapshotStore({ minInterval: 10, maxBytes: budget });
    const big = 3 * MB; // atmosphere view per keyframe
    let peak = 0;
    const template = snap(0, { bigBytes: big });
    for (let t = 0; t <= 6 * 3600; t += 10) {
      st.push({ ...template, time: t, fire: template.fire, stats: stats(t) });
      peak = Math.max(peak, st.totalBytes);
    }
    expect(peak).toBeLessThanOrEqual(budget);
    expect(st.totalBytes).toBeLessThanOrEqual(budget);
    expect(st.keyframeCount).toBeGreaterThanOrEqual(3);
    expect(st.keyframeCount).toBeLessThan(40);
    const kt = st.keyframeTimes();
    expect(kt[0]).toBe(0);
    // Older history is coarser than recent history.
    const gaps = kt.slice(1).map((v, i) => v - kt[i]!);
    expect(gaps[gaps.length - 1]!).toBeLessThanOrEqual(gaps[0]!);
    expect(Math.max(...gaps.slice(-3))).toBeLessThanOrEqual(1800);
    expect(st.latest()!.time).toBe(6 * 3600);
    const ts = st.times();
    expect(ts[0]).toBe(0);
    expect(ts.at(-1)! - ts.at(-2)!).toBe(10);
    expect(ts.length).toBeGreaterThan(1000); // stats for (almost) every step survive
    // Every time can be shown, recent ones with the exact time.
    for (const t of [0, 1, 5000, 12345, 21599]) {
      const s = st.at(t)!;
      expect(s.time).toBe(t);
      expect(s.fire.arrivalTime.length).toBe(N);
    }
  });

  it('never drops the first keyframe or the newest snapshot, even with a budget smaller than one picture', () => {
    const st = new SnapshotStore({ minInterval: 60, maxBytes: 1000 });
    for (let t = 0; t <= 3600; t += 60) st.push(snap(t, { bigBytes: 100_000 }));
    expect(st.keyframeTimes()[0]).toBe(0);
    expect(st.latest()!.time).toBe(3600);
    expect(st.at(1234)!.time).toBe(1234);
    expect(st.times()[0]).toBe(0);
  });

  it('tolerates minimal snapshots (no fire, no arrays)', () => {
    const st = new SnapshotStore({ minInterval: 300, maxBytes: 1e9 });
    for (let t = 0; t <= 1200; t += 300) st.push({ time: t, insights: [], spotFires: [], stats: { time: t } } as unknown as SimSnapshot);
    expect(st.at(500)!.time).toBe(500);
    expect(st.at(500)!.stats.time).toBe(300);
    expect(st.latest()!.time).toBe(1200);
    st.truncateAfter(600);
    expect(st.latest()!.time).toBe(600);
  });
});
