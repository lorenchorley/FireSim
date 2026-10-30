/**
 * The history keeps the wind the fire feels (0.7.0, `SimSnapshot.fireWind`; D-CONTRACT-070-raster sections 2 and 8): in the newest snapshot and
 * in every keyframe, counted in the byte totals, returned by `compose()` as the keyframe's own picture stamped with its own time, dropped with
 * its keyframe by thinning, truncation and a rewind. Small synthetic snapshots, as snapshotStore.test.ts; the real engine's pictures go through
 * the same store in fireWind.sim.test.ts and the 6 h table of snapshotStore.fast6h.sim.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { fireWindBytes } from '../core/fireWind';
import { BurnState, type FireField, type FireWindRaster, type SimSnapshot } from '../core/types';
import { publishFireWind } from '../sim/fireWindPublish';
import { SnapshotStore, estimateSnapshotBytes, keyframeBytes } from './snapshotStore';

const N = 100;
const GRID = { nx: 10, ny: 10, cellSize: 30, x0: 0, y0: 0, origin: { lat: 0, lon: 0 } } as unknown as FireField['grid'];

/** The picture of a 10 x 10 fire grid whose wind is `time / 100` m/s east and `-time / 100` north everywhere: it says which snapshot it came from. */
function windAt(time: number): FireWindRaster {
  return publishFireWind(GRID, new Float32Array(N).fill(time / 100), new Float32Array(N).fill(-time / 100), time);
}

function fireAt(t: number): FireField {
  const arrivalTime = new Float32Array(N).fill(Infinity);
  const burnState = new Uint8Array(N).fill(BurnState.Unburnt);
  for (let k = 0; k < 40; k++) {
    if (30 * k <= t) {
      arrivalTime[k] = 30 * k;
      burnState[k] = t - 30 * k < 120 ? BurnState.Burning : BurnState.BurntOut;
    }
  }
  return { grid: GRID, arrivalTime, burnState, ros: new Float32Array(N), intensity: new Float32Array(N), flameHeight: new Float32Array(N), spreadDir: new Float32Array(N), driver: new Uint8Array(N), phase: new Uint8Array(N) };
}

function snap(time: number, o: { wind?: boolean; bigBytes?: number } = {}): SimSnapshot {
  const big = o.bigBytes ? new Float32Array(o.bigBytes / 4) : undefined;
  return {
    time,
    fire: fireAt(time),
    moisture: new Float32Array(N).fill(time),
    atmosphere: big ? ({ grid: GRID, nz: 1, levels: big, terrainHeight: new Float32Array(0), surfaceU: new Float32Array(0), surfaceV: new Float32Array(0), u: new Float32Array(0), v: new Float32Array(0), w: new Float32Array(0), thetaAnomaly: new Float32Array(0), smoke: new Float32Array(0) } as unknown as SimSnapshot['atmosphere']) : undefined,
    embers: { count: 1, data: new Float32Array(4).fill(time) },
    spotFires: [],
    stats: { time, burntAreaHa: time / 100, deadFuelMoistureMean: 8 } as unknown as SimSnapshot['stats'],
    insights: [],
    layers: { vls: new Float32Array(N).fill(time) },
    ...(o.wind === false ? {} : { fireWind: windAt(time) }),
  } as SimSnapshot;
}

/** Snapshots 0, 60, ... `upTo`, kept so a test can compare what the store returns with what went in. */
function filled(upTo: number, o: { wind?: boolean; bigBytes?: number; maxBytes?: number } = {}): { st: SnapshotStore; pushed: Map<number, SimSnapshot> } {
  const st = new SnapshotStore({ minInterval: 60, maxBytes: o.maxBytes ?? 1e9 });
  const pushed = new Map<number, SimSnapshot>();
  for (let t = 0; t <= upTo; t += 60) {
    const s = snap(t, o);
    pushed.set(t, s);
    st.push(s);
  }
  return { st, pushed };
}

describe('the newest snapshot and the keyframes keep the picture', () => {
  it('the newest snapshot comes back whole, with its own picture', () => {
    const { st, pushed } = filled(900);
    expect(st.latest()!.fireWind).toBe(pushed.get(900)!.fireWind);
    expect(st.at(900)!.fireWind!.time).toBe(900);
    expect(st.at(1e6)!.fireWind).toBe(pushed.get(900)!.fireWind); // a time after the newest is the newest
  });

  it('a composed picture takes the keyframe\'s own copy, stamped with the keyframe\'s time (the air\'s rule), not the light frame\'s', () => {
    const { st, pushed } = filled(1200);
    expect(st.keyframeTimes()).toEqual([0, 300, 600, 900]); // the newest (1200) is not yet demoted
    for (const [t, key] of [[0, 0], [200, 0], [299, 0], [300, 300], [480, 300], [599, 300], [600, 600], [840, 600], [1000, 900]] as const) {
      const fw = st.at(t)!.fireWind!;
      expect(fw, `at ${t}`).toBe(pushed.get(key)!.fireWind); // the same object that went in at the keyframe's time: no copy, nothing rebuilt
      expect(fw.time, `stamp at ${t}`).toBe(key);
      expect(t - fw.time, `age at ${t}`).toBeLessThan(300); // up to one key interval older than the picture it is shown with
      expect(fw.u[0], `value at ${t}`).toBe(key); // time / 100 m/s in hundredths
    }
  });

  it('the quantised composition (playback) returns the same picture for the whole quantum', () => {
    const { st } = filled(1200);
    const a = st.atOrBefore(610)!;
    expect(st.atOrBefore(630)!.fireWind).toBe(a.fireWind);
    expect(a.fireWind!.time).toBe(600);
  });

  it('a snapshot without it (the demo engine, an old producer) leaves the composed picture without one too: the key is absent, not undefined', () => {
    const { st } = filled(900, { wind: false });
    const composed = st.at(450)!;
    expect('fireWind' in composed).toBe(false);
    expect('fireWind' in st.latest()!).toBe(false);
    expect(st.keyframeCount).toBe(3);
  });

  it('a run that gains the picture part-way (an engine restart) has it from then on', () => {
    const st = new SnapshotStore({ minInterval: 60, maxBytes: 1e9 });
    for (let t = 0; t <= 1200; t += 60) st.push(snap(t, { wind: t >= 600 }));
    expect(st.at(450)!.fireWind).toBeUndefined();
    expect(st.at(700)!.fireWind!.time).toBe(600);
    expect(st.at(1000)!.fireWind!.time).toBe(900);
  });
});

describe('the bytes', () => {
  it('keyframeBytes and the newest snapshot count the picture\'s two arrays and its fixed part, exactly', () => {
    const a = snap(0);
    const b = snap(0, { wind: false });
    const fw = fireWindBytes(a.fireWind);
    expect(fw).toBe(2 * 2 * 5 * 5 + 64); // 10 x 10 fire cells of 30 m: 5 x 5 blocks of 60 m, two Int16 arrays
    expect(keyframeBytes(a) - keyframeBytes(b)).toBe(fw);
    expect(estimateSnapshotBytes(a) - estimateSnapshotBytes(b)).toBe(fw);
  });

  it('the store totals grow by exactly that for the newest picture and for each keyframe it keeps', () => {
    const w = filled(1200).st;
    const n = filled(1200, { wind: false }).st;
    const fw = fireWindBytes(windAt(0));
    expect(w.keyframeCount).toBe(4);
    expect(w.newestBytes - n.newestBytes).toBe(fw);
    expect(w.keyframeBytes - n.keyframeBytes).toBe(4 * fw);
    expect(w.totalBytes - n.totalBytes).toBe(5 * fw); // the newest picture and four keyframes
  });
});

describe('thinning, truncation and a rewind drop it with its keyframe', () => {
  it('thinning keeps the picture of every keyframe it keeps, and what it drops is gone: a time between kept keyframes shows the older one', () => {
    // 60 KiB keyframes under a budget of 1 MiB with 6 h of steps: the store has to thin
    const { st } = filled(6 * 3600, { bigBytes: 200_000, maxBytes: 3_000_000 });
    expect(st.thinnedCount).toBeGreaterThan(0);
    const keys = st.keyframeTimes();
    expect(keys.length).toBeLessThan(6 * 12); // thinned from 72
    expect(st.totalBytes).toBeLessThanOrEqual(3_000_000);
    for (const t of keys) expect(st.at(t)!.fireWind!.time, `kept keyframe ${t}`).toBe(t);
    // a time whose own keyframe was thinned away shows the nearest kept one at or before it
    const gap = keys.findIndex((k, i) => i > 0 && k - keys[i - 1]! > 300);
    expect(gap).toBeGreaterThan(0);
    const dropped = keys[gap - 1]! + 300; // a keyframe time that is gone
    expect(keys).not.toContain(dropped);
    expect(st.at(dropped)!.fireWind!.time).toBe(keys[gap - 1]);
  });

  it('truncateAfter drops the later keyframes and the newest picture: the newest left is the last kept keyframe\'s', () => {
    const { st } = filled(1200);
    st.truncateAfter(700);
    expect(st.headTime()).toBe(660);
    expect(st.latest()!.fireWind!.time).toBe(600); // composed from the keyframe at 600: the 660 snapshot was the newest and is gone
    expect(st.keyframeTimes()).toEqual([0, 300, 600]);
    st.truncateFrom(300);
    expect(st.latest()!.fireWind!.time).toBe(0);
    st.truncateFrom(0);
    expect(st.latest()).toBeNull();
    expect(st.keyframeBytes + st.newestBytes).toBe(0);
  });

  it('a snapshot at an earlier time (the worker re-simulated after a rewind) replaces the pictures after it', () => {
    const { st } = filled(1200);
    const redo = snap(600);
    redo.fireWind = { ...windAt(600), u: new Int16Array(25).fill(-77) }; // the re-run\'s own picture of that time
    st.push(redo);
    expect(st.headTime()).toBe(600);
    expect(st.latest()!.fireWind).toBe(redo.fireWind);
    expect(st.keyframeTimes()).toEqual([0, 300]);
    expect(st.at(450)!.fireWind!.time).toBe(300);
    st.push(snap(660));
    expect(st.at(630)!.fireWind!.u[0]).toBe(-77); // demoted into the new keyframe: the re-run's, not the old run's
  });

  it('clear drops every picture and every byte', () => {
    const { st } = filled(900);
    st.clear();
    expect(st.latest()).toBeNull();
    expect(st.keyframeBytes + st.newestBytes + st.totalBytes).toBe(0);
  });
});
