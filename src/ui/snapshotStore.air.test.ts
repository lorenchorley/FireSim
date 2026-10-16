/**
 * The air in the history (plan 7.1 goal 4 and 7.3, and fix F1 of the 0.4.0 list): a picture composed from the store carries the
 * air of the keyframe at or before it, with that air's own time, so "air from 14:05" can be said for any time on the scrubber.
 * The fast tier's diagnosed volume is kept in a list of its own, packed (core/airPack.ts), with a share of the budget of its own:
 * it is weighed into the history with its real byte length, it never costs a picture, and an old picture takes the newest saved
 * volume at or before it, stamped with that volume's time.
 */
import { describe, expect, it } from 'vitest';
import { packWind, windPackErrorBound } from '../core/airPack';
import { airAgeS, airHas, airKind, airLayout, airTime, hasAirWind, AIR_STALE_S } from '../core/airView';
import { BurnState, type AtmosphereView, type FireField, type SimSnapshot, type SimStats } from '../core/types';
import { SnapshotStore, keyframeBytes } from './snapshotStore';

const N = 100;
const NZ = 20;
const GRID = { nx: 10, ny: 10, cellSize: 30, x0: 0, y0: 0, origin: { lat: 0, lon: 0 } } as unknown as FireField['grid'];
/** Bytes of one packed volume of the fixture: 6 per cell and level and the 64 of bookkeeping. */
const PACKED = N * NZ * 6 + 64;

const fire = (): FireField => ({
  grid: GRID,
  arrivalTime: new Float32Array(N).fill(Infinity),
  burnState: new Uint8Array(N).fill(BurnState.Unburnt),
  ros: new Float32Array(N),
  intensity: new Float32Array(N),
  flameHeight: new Float32Array(N),
  spreadDir: new Float32Array(N),
  driver: new Uint8Array(N),
  phase: new Uint8Array(N),
});

/** A wind field that is not zero and is different at every time (so a restored volume can be told from one of another time). */
const wind = (time: number, salt: number, peak: number): Float32Array => {
  const f = new Float32Array(N * NZ);
  for (let i = 0; i < f.length; i++) f[i] = Math.sin(i * 0.37 + salt + time / 1000) * peak;
  return f;
};

/** The view of a fast-tier snapshot (u, v, w only, kind diagnosed) or a 3-D one (five fields), stamped with its time. */
function air(time: number, kind: 'diagnosed' | 'prognostic'): AtmosphereView {
  const none = new Float32Array(0);
  const vol = (salt: number): Float32Array => wind(time, salt, 10);
  return {
    grid: GRID,
    nz: NZ,
    levels: new Float32Array(NZ).map((_, l) => 50 + 150 * l),
    terrainHeight: new Float32Array(N).map((_, c) => c),
    layout: 'terrain-following',
    kind,
    topM: 3000,
    baseM: 500,
    time,
    surfaceU: new Float32Array(N).fill(3),
    surfaceV: new Float32Array(N).fill(-2),
    u: vol(1),
    v: vol(2),
    w: wind(time, 3, 1),
    thetaAnomaly: kind === 'prognostic' ? vol(4) : none,
    smoke: kind === 'prognostic' ? vol(5) : none,
  };
}

/** `layerCells` sizes the overlay raster, to make a keyframe as heavy as a real one against a volume. */
function snap(time: number, kind: 'diagnosed' | 'prognostic', layerCells = N): SimSnapshot {
  return {
    time,
    fire: fire(),
    moisture: new Float32Array(N),
    atmosphere: air(time, kind),
    embers: { count: 0, data: new Float32Array(0) },
    spotFires: [],
    stats: { time, burntAreaHa: 0, deadFuelMoistureMean: 8 } as unknown as SimStats,
    insights: [],
    layers: { vls: new Float32Array(layerCells) },
  } as SimSnapshot;
}

const withoutWind = (s: SimSnapshot): SimSnapshot => ({ ...s, atmosphere: { ...s.atmosphere!, u: new Float32Array(0), v: new Float32Array(0), w: new Float32Array(0) } });

describe('the air of a composed picture and its own time', () => {
  const store = new SnapshotStore({ minInterval: 60, maxBytes: 1e9 });
  for (let t = 0; t <= 1500; t += 60) store.push(snap(t, 'diagnosed'));

  it('a picture at a step carries the view of the keyframe at or before it, and says how old that air is', () => {
    const times: number[] = [];
    for (const t of [0, 60, 240, 300, 360, 540, 600, 780, 900, 1200]) {
      const view = store.at(t)!.atmosphere!;
      expect(airKind(view), `kind at ${t}`).toBe('diagnosed');
      const air = airTime(view)!;
      expect(air, `air time at ${t}`).toBeLessThanOrEqual(t);
      expect(air % 300, `air time at ${t} is a keyframe time`).toBe(0);
      expect(airAgeS(view, t)).toBe(t - air);
      expect(t - air).toBeLessThan(300);
      times.push(air);
    }
    expect(times).toEqual([0, 0, 0, 300, 300, 300, 600, 600, 900, 1200]);
  });

  it('beyond the 90 s that count as the same moment, the age is what the footer would report', () => {
    expect(airAgeS(store.at(540)!.atmosphere, 540)).toBe(240);
    expect(airAgeS(store.at(540)!.atmosphere, 540)!).toBeGreaterThan(AIR_STALE_S);
    expect(airAgeS(store.at(360)!.atmosphere, 360)!).toBeLessThan(AIR_STALE_S);
  });

  it('the newest picture (the live head) carries its own air at its own time', () => {
    const head = store.latest()!;
    expect(airTime(head.atmosphere)).toBe(head.time);
    expect(airAgeS(head.atmosphere, head.time)).toBe(0);
  });

  it('an older picture still has the wind, the layout, the top and the datum of its air, and the wind of its own time', () => {
    const exact = snap(600, 'diagnosed').atmosphere!;
    const view = store.at(600)!.atmosphere!;
    expect(hasAirWind(view)).toBe(true);
    expect([airLayout(view), view.topM, view.baseM, view.time, view.nz]).toEqual(['terrain-following', 3000, 500, 600, NZ]);
    expect(view.grid).toBe(GRID);
    expect(view.surfaceU).toEqual(exact.surfaceU);
    expect(view.terrainHeight).toEqual(exact.terrainHeight);
    const bound = windPackErrorBound(packWind(exact.u, exact.v, exact.w)!);
    const worst = (a: Float32Array, b: Float32Array): number => a.reduce((m, x, k) => Math.max(m, Math.abs(x - b[k]!)), 0);
    expect(worst(view.u, exact.u)).toBeLessThanOrEqual(bound[0]);
    expect(worst(view.v, exact.v)).toBeLessThanOrEqual(bound[1]);
    expect(worst(view.w, exact.w)).toBeLessThanOrEqual(bound[2]);
    expect(worst(view.u, exact.u)).toBeGreaterThan(0); // restored, not the exact arrays
    // ... and not the wind of another time: 5 min earlier or later is a different field.
    expect(worst(view.u, snap(300, 'diagnosed').atmosphere!.u)).toBeGreaterThan(0.1);
  });

  it('the volume is restored once for the pictures of one stretch of air, and again for the next', () => {
    const a = store.at(610)!.atmosphere!;
    const b = store.at(690)!.atmosphere!;
    const c = store.at(910)!.atmosphere!;
    expect(b.u).toBe(a.u);
    expect(c.u).not.toBe(a.u);
    expect(airTime(a)).toBe(600);
    expect(airTime(c)).toBe(900);
  });
});

describe('the diagnosed volume is weighed into the history', () => {
  it('keyframeBytes of a live snapshot counts the three wind arrays of the fast tier (12 B per cell) and five fields of the 3-D tiers (20 B)', () => {
    const fast = keyframeBytes(snap(0, 'diagnosed'));
    const full = keyframeBytes(snap(0, 'prognostic'));
    const without = keyframeBytes(withoutWind(snap(0, 'diagnosed')));
    expect(fast - without).toBe(3 * N * NZ * 4);
    expect(full - fast).toBe(2 * N * NZ * 4);
  });

  it('a kept keyframe of the fast tier holds its volume at half the bytes (16-bit integers), in the wind list', () => {
    const st = new SnapshotStore({ minInterval: 300, maxBytes: 1e9 });
    st.push(snap(0, 'diagnosed'));
    expect(st.windFrameCount).toBe(0); // the newest snapshot is the live one: whole, nothing packed
    st.push(snap(300, 'diagnosed'));
    expect(st.keyframeCount).toBe(1);
    expect(st.windFrameCount).toBe(1);
    const live = keyframeBytes(snap(0, 'diagnosed'));
    const light = keyframeBytes({ ...snap(0, 'diagnosed'), atmosphere: { ...air(0, 'diagnosed'), u: new Float32Array(0), v: new Float32Array(0), w: new Float32Array(0) } });
    expect(st.keyframeBytes).toBe(light + PACKED);
    expect(st.keyframeBytes).toBeLessThan(live - 0.4 * (3 * N * NZ * 4));
    // The store counts them in what it holds: the live snapshot, the kept keyframe with its volume, the fire scratch and the rest.
    expect(st.totalBytes).toBeGreaterThan(keyframeBytes(snap(0, 'diagnosed')) + st.keyframeBytes);
  });

  it('the 3-D tiers keep their air exactly as before: whole, in the keyframe, and the picture is the very view that was pushed', () => {
    const st = new SnapshotStore({ minInterval: 300, maxBytes: 1e9 });
    const first = snap(0, 'prognostic');
    for (const t of [0, 300, 600]) st.push(t === 0 ? first : snap(t, 'prognostic'));
    expect(st.windFrameCount).toBe(0);
    expect(st.at(100)!.atmosphere).toBe(first.atmosphere);
    expect(st.keyframeBytes).toBe(2 * keyframeBytes(first));
  });

  it('a view without a volume (the 0.3.0 fast tier, or any view that holds none) stays without one, and nothing is borrowed', () => {
    const st = new SnapshotStore({ minInterval: 300, maxBytes: 1e9 });
    for (let t = 0; t <= 900; t += 300) st.push(withoutWind(snap(t, 'diagnosed')));
    expect(st.windFrameCount).toBe(0);
    const v = st.at(450)!.atmosphere!;
    expect(hasAirWind(v)).toBe(false);
    expect(airHas(v, 'wind')).toBe(false);
  });
});

describe('a volume never costs a picture', () => {
  /**
   * Six hours of keyframes at a step equal to the keyframe spacing. `layerCells` makes them heavy (20 000 cells: 85 kB, as the real
   * ones are against their volumes) or light (100: 4 kB, so that the volumes, 12 kB each, are most of what the store holds).
   */
  const feed = (maxBytes: number, volume: boolean, layerCells: number): SnapshotStore => {
    const st = new SnapshotStore({ minInterval: 300, maxBytes });
    for (let t = 0; t <= 6 * 3600; t += 300) {
      const s = snap(t, 'diagnosed', layerCells);
      st.push(volume ? s : withoutWind(s));
    }
    return st;
  };

  it('with only the volumes over their share, they are thinned and not one picture is: the keyframes and the thinning count are the same as without them', () => {
    const volume = feed(1_100_000, true, N);
    const bare = feed(1_100_000, false, N);
    expect(volume.keyframeCount).toBe(72); // 6 h at 5 min: the 73rd snapshot is the live one
    expect(bare.keyframeCount).toBe(72);
    expect(volume.thinnedCount).toBe(0);
    expect(bare.thinnedCount).toBe(0);
    expect(volume.keyframeTimes()).toEqual(bare.keyframeTimes());
    // 72 volumes of 12 kB would be 870 kB, most of this budget; the list holds a few, a share of it.
    expect(volume.windFrameCount).toBeGreaterThan(1);
    expect(volume.windFrameCount).toBeLessThan(volume.keyframeCount / 10);
    expect(volume.windFrameCount * PACKED).toBeLessThanOrEqual(0.04 * 1_100_000);
    expect(volume.totalBytes).toBeLessThanOrEqual(1_100_000);
  });

  it('under a budget that thins the pictures, the pictures are thinned as without the volumes and the volumes are held to their small share', () => {
    // 73 keyframes of about 85 kB and their volumes would need 6.9 MB; at 5 MB the pictures are thinned.
    const volume = feed(5_000_000, true, 20_000);
    const bare = feed(5_000_000, false, 20_000);
    expect(bare.thinnedCount).toBeGreaterThan(0);
    expect(volume.keyframeCount).toBeGreaterThanOrEqual(bare.keyframeCount - 3);
    expect(volume.totalBytes).toBeLessThanOrEqual(5_000_000);
    expect(volume.windFrameCount * PACKED).toBeLessThanOrEqual(0.04 * 5_000_000);
    expect(volume.keyframeTimes()[0]).toBe(0);
  });

  it('every picture still has a wind: the newest saved volume at or before it, with that volume’s own time and the age the footer reports', () => {
    const st = feed(5_000_000, true, 20_000);
    const saved = st.windFrameTimes();
    expect(saved[0]).toBe(0); // the first volume is never dropped
    let stale = 0;
    for (let t = 0; t <= 6 * 3600 - 600; t += 450) {
      const view = st.at(t)!.atmosphere!;
      expect(hasAirWind(view), `wind at ${t}`).toBe(true);
      const when = airTime(view)!;
      const newest = Math.max(...saved.filter((s) => s <= t));
      expect(when, `air time at ${t}`).toBe(newest);
      expect(airAgeS(view, t)).toBe(t - newest);
      if (t - newest > AIR_STALE_S) stale++;
      // The rest of the air is the keyframe's own: the layout, the top and the datum.
      expect([airLayout(view), view.topM, view.baseM, view.nz]).toEqual(['terrain-following', 3000, 500, NZ]);
    }
    expect(stale).toBeGreaterThan(0); // the footer has something to say about the older pictures
  });

  it('thinned volumes are the ones of the old history: the newest few are kept at every step', () => {
    const st = feed(5_000_000, true, 20_000);
    const saved = st.windFrameTimes();
    const last = st.keyframeTimes().at(-1)!;
    expect(saved.at(-1)).toBe(last); // the newest keyframe's volume is the newest volume (the live snapshot is not a keyframe yet)
    const recent = saved.filter((t) => t > last - 3600).length;
    const old = saved.filter((t) => t < 3600).length;
    expect(recent).toBeGreaterThan(old); // finer where the history is young
  });

  it('before the budget is reached every volume is kept', () => {
    const st = feed(1e9, true, N);
    expect(st.windFrameCount).toBe(st.keyframeCount);
    expect(st.thinnedCount).toBe(0);
  });
});

describe('a rewind takes the volumes of the history it cuts', () => {
  it('truncateAfter drops later volumes and a later picture borrows from an earlier one only', () => {
    const st = new SnapshotStore({ minInterval: 60, maxBytes: 1e9 });
    for (let t = 0; t <= 1800; t += 60) st.push(snap(t, 'diagnosed'));
    expect(st.windFrameTimes()).toEqual([0, 300, 600, 900, 1200, 1500]);
    const before = st.totalBytes;
    st.truncateAfter(700);
    expect(st.windFrameTimes()).toEqual([0, 300, 600]);
    expect(st.totalBytes).toBeLessThan(before);
    expect(airTime(st.at(700)!.atmosphere)).toBe(600);
    // The re-run writes new volumes from the cut on: the first picture after the cut is a keyframe whatever the spacing, so it has its own.
    for (let t = 720; t <= 1500; t += 60) st.push(snap(t, 'diagnosed'));
    expect(st.windFrameTimes()).toEqual([0, 300, 600, 720, 1020, 1320]);
    expect(airTime(st.at(1000)!.atmosphere)).toBe(720);
    const bytes = st.totalBytes;
    st.clear();
    expect(st.totalBytes).toBe(0);
    expect(st.windFrameCount).toBe(0);
    expect(bytes).toBeGreaterThan(0);
  });
});
