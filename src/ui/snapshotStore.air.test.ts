/**
 * The air in the history (plan 7.1 goal 4 and 7.3): a picture composed from the store carries the air of the keyframe at or
 * before it, with that air's own time, so "air from 14:05" can be said for any time on the scrubber; and the fast tier's
 * diagnosed volume is weighed into the keyframes (real byte lengths), so the budget thins the history a little earlier.
 */
import { describe, expect, it } from 'vitest';
import { airAgeS, airKind, airTime, AIR_STALE_S } from '../core/airView';
import { BurnState, type AtmosphereView, type FireField, type SimSnapshot, type SimStats } from '../core/types';
import { SnapshotStore, keyframeBytes } from './snapshotStore';

const N = 100;
const NZ = 20;
const GRID = { nx: 10, ny: 10, cellSize: 30, x0: 0, y0: 0, origin: { lat: 0, lon: 0 } } as unknown as FireField['grid'];

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

/** The view of a fast-tier snapshot (u, v, w only, kind diagnosed) or a 3-D one (five fields), stamped with its time. */
function air(time: number, kind: 'diagnosed' | 'prognostic'): AtmosphereView {
  const vol = (): Float32Array => new Float32Array(N * NZ);
  const none = new Float32Array(0);
  return {
    grid: GRID,
    nz: NZ,
    levels: new Float32Array(NZ),
    terrainHeight: new Float32Array(N),
    layout: 'terrain-following',
    kind,
    topM: 3000,
    baseM: 500,
    time,
    surfaceU: new Float32Array(N),
    surfaceV: new Float32Array(N),
    u: vol(),
    v: vol(),
    w: vol(),
    thetaAnomaly: kind === 'prognostic' ? vol() : none,
    smoke: kind === 'prognostic' ? vol() : none,
  };
}

function snap(time: number, kind: 'diagnosed' | 'prognostic'): SimSnapshot {
  return {
    time,
    fire: fire(),
    moisture: new Float32Array(N),
    atmosphere: air(time, kind),
    embers: { count: 0, data: new Float32Array(0) },
    spotFires: [],
    stats: { time, burntAreaHa: 0, deadFuelMoistureMean: 8 } as unknown as SimStats,
    insights: [],
    layers: { vls: new Float32Array(N) },
  } as SimSnapshot;
}

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
});

describe('the diagnosed volume is weighed into a keyframe', () => {
  it('keyframeBytes counts the three wind arrays of the fast tier (12 B per cell) and five fields of the 3-D tiers (20 B)', () => {
    const fast = keyframeBytes(snap(0, 'diagnosed'));
    const full = keyframeBytes(snap(0, 'prognostic'));
    const without = keyframeBytes({ ...snap(0, 'diagnosed'), atmosphere: { ...air(0, 'diagnosed'), u: new Float32Array(0), v: new Float32Array(0), w: new Float32Array(0) } });
    expect(fast - without).toBe(3 * N * NZ * 4);
    expect(full - fast).toBe(2 * N * NZ * 4);
  });

  it('under the same small budget, the history that holds the volume keeps fewer full pictures: thinning starts earlier', () => {
    const run = (withVolume: boolean): SnapshotStore => {
      const st = new SnapshotStore({ minInterval: 60, maxBytes: 330_000 });
      for (let t = 0; t <= 6 * 3600; t += 60) {
        const s = snap(t, 'diagnosed');
        if (!withVolume) s.atmosphere = { ...s.atmosphere!, u: new Float32Array(0), v: new Float32Array(0), w: new Float32Array(0) };
        st.push(s);
      }
      return st;
    };
    const bare = run(false);
    const volume = run(true);
    expect(volume.keyframeCount).toBeLessThan(bare.keyframeCount);
    expect(volume.thinnedCount).toBeGreaterThanOrEqual(bare.thinnedCount);
    expect(volume.totalBytes).toBeLessThanOrEqual(330_000);
  });
});
