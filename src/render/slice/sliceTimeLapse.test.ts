/**
 * The scene's half of the time-lapse recorder (0.4.1): which lines it records and which it says it does not, that it samples the line the
 * updater resolves, that a failure stays inside it, and the rule everything rests on: the simulation never depends on it. The
 * determinism tests run the real engine on both tiers with the recorder in the snapshot hook.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeGridSpec } from '../../core/grid';
import { SLICE_RECORDER_MAX_BYTES } from '../../core/sliceRecording';
import type { SimSnapshot } from '../../core/types';
import { Simulation } from '../../sim/simulation';
import { snapshotHash } from '../../sim/testing/hash';
import { pointIgnition, syntheticScenario } from '../../sim/testing/scenarios';
import { HeightField } from '../heightfield';
import { resolveSlice } from './sectionLine';
import { sampleSlice } from './sliceField';
import { SliceRecorder, sliceLineKey } from './sliceRecorder';
import { createSliceTimeLapse, type SliceTimeLapse } from './sliceTimeLapse';
import { makeAirView, makeResolveContext } from './testing';
import type { ResolvedSlice, SliceLineState, SliceTerrain } from './types';
import { AtmosphereSampler } from '../atmosphereSampler';

const MiB = 1048576;
const ORIGIN = { lat: -33.7, lon: 150.3 };
const ridge = (x: number, y: number): number => 600 + 500 * Math.exp(-((x / 900) ** 2)) + 150 * Math.sin(y / 700);
const GRID = makeGridSpec(ORIGIN, 45 * 133, 133);
const TERRAIN: SliceTerrain = { heightAt: ridge };

/** A snapshot with the air of a 6 km model at time `t` (only what the recorder reads: the time, the air and the weather). */
function snapAt(t: number, kind: 'prognostic' | 'diagnosed' = 'prognostic', airTime = t): SimSnapshot {
  const view = makeAirView({
    grid: GRID,
    nz: 20,
    kind,
    time: airTime,
    baseM: 500,
    topM: 3000,
    groundAt: (x, y) => ridge(x, y) - 20,
    u: (x, _y, z) => 6 + 0.004 * (z - 500) + 2 * Math.sin(x / 900 + airTime / 600),
    v: (_x, y, z) => 1 + 0.001 * (z - 500) + Math.cos(y / 800),
    w: (x, _y, z) => 0.5 * Math.sin(x / 600 + z / 400),
    theta: kind === 'prognostic' ? (x, _y, z) => 0.002 * x + 0.001 * (z - 500) : null,
    smoke: kind === 'prognostic' ? (_x, y) => Math.max(0, 2 - y / 1000) * 1e-3 : null,
  });
  return { time: t, atmosphere: view, stats: { time: t, weather: null } } as unknown as SimSnapshot;
}

const A: [number, number] = [-2900, -1200];
const B: [number, number] = [2900, 1500];
const HAND: SliceLineState = { azimuth: 0, centre: [0, 0], a: A, b: B, preset: null };

function make(state: () => SliceLineState = () => HAND, o: { enabled?: () => boolean; terrain?: () => SliceTerrain | null; budgetBytes?: number; changed?: () => void } = {}): SliceTimeLapse {
  return createSliceTimeLapse({
    line: state,
    enabled: o.enabled ?? (() => true),
    terrain: o.terrain ?? (() => TERRAIN),
    budgetBytes: o.budgetBytes ?? SLICE_RECORDER_MAX_BYTES,
    ...(o.changed ? { changed: o.changed } : {}),
  });
}

/** What the scene's updater resolves for a line state on this grid (the line it asks the recorder about). */
const resolved = (state: SliceLineState): ResolvedSlice => resolveSlice(state, makeResolveContext({ grid: GRID, heightAt: ridge }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('which lines it records', () => {
  it('a hand-placed line, at every snapshot, and the line it samples is the one the updater resolves', () => {
    const tl = make();
    expect(tl.status()).toMatchObject({ state: 'off', offFor: null, count: 0 });
    for (let i = 0; i < 5; i++) tl.record(snapAt(i * 60));
    expect(tl.status()).toMatchObject({ state: 'recording', offFor: null, count: 5, from: 0, to: 240, spacingS: 0, dropped: null });
    const r = resolved(HAND);
    expect(r.source).toBe('endpoints');
    const back = tl.read(r.line!, 130, 'prognostic', 0, null)!;
    expect(back).not.toBeNull();
    expect(back.recordedAt).toBe(120);
    expect(back.line).toBe(r.line);
    expect(back.kind).toBe('prognostic');
    expect(back.cells).toBeNull();
  });

  it('what it stores is what the live slice shows: the same lattice, to the packing bound (the line that was resolved, 90 columns or so, 48 to 56 rows)', () => {
    const tl = make();
    const snap = snapAt(300);
    tl.record(snap);
    const r = resolved(HAND);
    const live = sampleSlice(new AtmosphereSampler(snap.atmosphere!, 500, null), TERRAIN, { line: r.line!, shownTime: 300 })!;
    const back = tl.read(r.line!, 300, 'prognostic', null, null)!;
    expect([back.columns, back.rows]).toEqual([live.columns, live.rows]);
    expect(back.columns).toBeGreaterThanOrEqual(48);
    expect(back.rows).toBeGreaterThanOrEqual(48);
    expect(Array.from(back.valid)).toEqual(Array.from(live.valid));
    let worst = 0;
    for (let i = 0; i < live.values.along.length; i++) worst = Math.max(worst, Math.abs(back.values.along[i]! - live.values.along[i]!));
    expect(worst).toBeLessThan(0.001);
    expect(worst).toBeGreaterThan(0);
  });

  it('a line placed beyond the model edge is clipped like the live one, and the same recording is found with the clipped line', () => {
    const state: SliceLineState = { azimuth: 0, centre: [0, 0], a: [-9000, 0], b: [2900, 100], preset: null };
    const tl = make(() => state);
    tl.record(snapAt(0));
    const r = resolved(state);
    expect(r.notes).toContain('clipped');
    expect(tl.status().count).toBe(1);
    expect(tl.read(r.line!, 0, 'prognostic', null, null)).not.toBeNull();
  });

  it('a live preset is not recorded, and says why; neither is the Layers chord', () => {
    for (const [name, state, offFor] of [
      ['a preset', { azimuth: 0, centre: [0, 0], a: A, b: B, preset: 'along' } as SliceLineState, 'preset'],
      ['the chord through the centre', { azimuth: 45, centre: [0, 0] } as SliceLineState, 'chord'],
      ['a lone A (a half-placed line)', { azimuth: 45, centre: [0, 0], a: A } as SliceLineState, 'chord'],
    ] as const) {
      const tl = make(() => state);
      for (let i = 0; i < 3; i++) tl.record(snapAt(i * 60));
      expect(tl.status(), name).toMatchObject({ state: 'off', offFor, count: 0, bytes: 0 });
      const line = resolved(state).line;
      if (line) expect(tl.read(line, 60, 'prognostic', null, null), name).toBeNull();
    }
  });

  it('a kept preset (its ends written as A and B, preset null) is recorded from the next picture', () => {
    let state: SliceLineState = { azimuth: 0, centre: [0, 0], preset: 'along' };
    const tl = make(() => state);
    for (let i = 0; i < 2; i++) tl.record(snapAt(i * 60));
    expect(tl.status()).toMatchObject({ state: 'off', offFor: 'preset' });
    const line = resolved({ ...state, a: undefined }).line!;
    expect(line).not.toBeNull();
    state = { azimuth: 0, centre: [0, 0], a: line.a, b: line.b, preset: null }; // "Keep this line"
    tl.follow(resolved(state));
    expect(tl.status()).toMatchObject({ state: 'waiting', offFor: null, count: 0, dropped: null });
    tl.record(snapAt(120));
    tl.record(snapAt(180));
    expect(tl.status()).toMatchObject({ state: 'recording', count: 2, from: 120, to: 180 });
    expect(tl.read(resolved(state).line!, 180, 'prognostic', 0, null)!.recordedAt).toBe(180);
  });

  it('records the diagnosed wind of the fast tier: three fields, kind diagnosed', () => {
    const tl = make();
    for (let i = 0; i < 3; i++) tl.record(snapAt(i * 60, 'diagnosed'));
    const st = tl.status();
    expect(st.count).toBe(3);
    const line = resolved(HAND).line!;
    const back = tl.read(line, 120, 'diagnosed', null, null)!;
    expect(back.kind).toBe('diagnosed');
    expect(back.has).toEqual({ wind: true, theta: false, smoke: false });
    expect(tl.read(line, 120, 'prognostic', null, null)).toBeNull();
    const perSample = (st.bytes - 6000) / 3;
    expect(perSample).toBeGreaterThan(back.columns * back.rows * 6 - 500);
    expect(perSample).toBeLessThan(back.columns * back.rows * 6 + 500);
  });

  it('a snapshot with no 3-D wind (the fast tier before it publishes, a view with no air) records nothing and fails nothing', () => {
    const tl = make();
    const bare = { time: 0, stats: { time: 0, weather: null } } as unknown as SimSnapshot;
    tl.record(bare);
    const surface = snapAt(60);
    surface.atmosphere = { ...surface.atmosphere!, nz: 0, u: new Float32Array(0), v: new Float32Array(0), w: new Float32Array(0), kind: undefined };
    tl.record(surface);
    expect(tl.status()).toMatchObject({ state: 'waiting', count: 0 });
    tl.record(snapAt(120));
    expect(tl.status().count).toBe(1);
  });

  it('with no ground to sample against nothing is recorded (the scene before its first terrain)', () => {
    const tl = make(() => HAND, { terrain: () => null });
    tl.record(snapAt(0));
    expect(tl.status()).toMatchObject({ state: 'waiting', count: 0 });
  });
});

describe('a line that changes', () => {
  it('follow() applies a moved line at once, even while paused: the old recording is dropped and the panel can say so', () => {
    let state = HAND;
    const tl = make(() => state);
    for (let i = 0; i < 4; i++) tl.record(snapAt(i * 60));
    expect(tl.status().count).toBe(4);
    state = { ...HAND, a: [A[0] + 200, A[1]] };
    tl.follow(resolved(state)); // no snapshot has arrived
    expect(tl.status()).toMatchObject({ state: 'waiting', count: 0, dropped: 'line' });
    expect(tl.read(resolved(HAND).line!, 180, 'prognostic', null, null)).toBeNull();
    tl.record(snapAt(240));
    expect(tl.status()).toMatchObject({ state: 'recording', count: 1, from: 240, dropped: 'line' });
  });

  it('record() sees a moved line by itself (the next snapshot), a swap included, and a following preset or compass drops it', () => {
    let state = HAND;
    const tl = make(() => state);
    tl.record(snapAt(0));
    tl.record(snapAt(60));
    state = { ...HAND, a: B, b: A }; // Swap
    tl.record(snapAt(120));
    expect(tl.status()).toMatchObject({ count: 1, from: 120, dropped: 'line' });
    state = { azimuth: 30, centre: [0, 0] }; // the compass
    tl.record(snapAt(180));
    expect(tl.status()).toMatchObject({ state: 'off', offFor: 'chord', count: 0, dropped: 'line' });
  });

  it('the same line, written again, keeps the recording', () => {
    let state = HAND;
    const tl = make(() => state);
    tl.record(snapAt(0));
    tl.record(snapAt(60));
    state = { ...HAND, a: [A[0] + 0.01, A[1]] }; // a hundredth of a metre
    tl.follow(resolved(state));
    tl.record(snapAt(120));
    expect(tl.status()).toMatchObject({ count: 3, dropped: null });
  });

  it('switching the slice off clears the recording without a word, and on again starts from nothing', () => {
    let on = true;
    const tl = make(() => HAND, { enabled: () => on });
    for (let i = 0; i < 3; i++) tl.record(snapAt(i * 60));
    on = false;
    tl.record(snapAt(180));
    expect(tl.status()).toMatchObject({ state: 'off', offFor: null, count: 0, dropped: null, bytes: 0 });
    on = true;
    tl.record(snapAt(240));
    expect(tl.status()).toMatchObject({ state: 'recording', count: 1, from: 240, dropped: null });
    tl.reset(); // what the scene does as it switches off, and for a new scenario
    expect(tl.status()).toMatchObject({ state: 'off', count: 0, dropped: null });
  });

  it('Clear recording drops the samples, keeps the line, asks the scene to refresh once, and does not refresh an empty recording', () => {
    const changed = vi.fn();
    const tl = make(() => HAND, { changed });
    tl.clear();
    expect(changed).not.toHaveBeenCalled();
    for (let i = 0; i < 3; i++) tl.record(snapAt(i * 60));
    tl.clear();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(tl.status()).toMatchObject({ state: 'waiting', count: 0, dropped: 'cleared' });
    tl.record(snapAt(180));
    expect(tl.status()).toMatchObject({ state: 'recording', from: 180, dropped: 'cleared' });
  });

  it('a snapshot at or before the newest sample cuts later samples by time order (a replay), and the cut keeps the earlier ones', () => {
    const tl = make();
    for (let i = 0; i < 6; i++) tl.record(snapAt(i * 60));
    tl.truncateAfter(200); // the session's cut
    expect(tl.status()).toMatchObject({ count: 4, to: 180 });
    tl.record(snapAt(120)); // a re-emitted snapshot (a tier switch restored a checkpoint): 120, 180 are stale
    expect(tl.status()).toMatchObject({ count: 3, from: 0, to: 120 });
  });

  it('the history budget the session reports sets the recorder’s: an eighth, at most 12 MiB', () => {
    const tl = make();
    expect(tl.status().budgetBytes).toBe(12 * MiB);
    tl.setHistoryBudget!(48 * MiB);
    expect(tl.status().budgetBytes).toBe(6 * MiB);
    tl.setHistoryBudget!(160 * MiB);
    expect(tl.status().budgetBytes).toBe(12 * MiB);
  });
});

describe('a failure stays inside the recorder', () => {
  it('a sampler that throws: no throw, nothing logged, status failed, no new attempt on the same line, reads give nothing', () => {
    const log = [vi.spyOn(console, 'error'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'log'), vi.spyOn(console, 'info'), vi.spyOn(console, 'debug')];
    let calls = 0;
    let broken = true;
    const terrain: SliceTerrain = {
      heightAt: (x, y) => {
        calls++;
        if (broken) throw new Error('the ground is gone');
        return ridge(x, y);
      },
    };
    const tl = make(() => HAND, { terrain: () => terrain });
    expect(() => tl.record(snapAt(0))).not.toThrow();
    expect(tl.status()).toMatchObject({ state: 'failed', count: 0, bytes: 0 });
    const attempts = calls;
    expect(attempts).toBeGreaterThan(0);
    for (let i = 1; i < 4; i++) expect(() => tl.record(snapAt(i * 60))).not.toThrow();
    expect(calls).toBe(attempts); // it did not try again at every snapshot
    expect(tl.status().state).toBe('failed');
    expect(tl.read(resolved(HAND).line!, 120, 'prognostic', null, null)).toBeNull();
    for (const spy of log) expect(spy).not.toHaveBeenCalled();

    // another line tries again, and so does the person's Clear recording
    broken = false;
    tl.follow(resolved({ ...HAND, a: [A[0] + 300, A[1]] }));
    expect(tl.status().state).not.toBe('failed');
    tl.record(snapAt(240));
    expect(tl.status()).toMatchObject({ state: 'recording' });
    broken = true;
    tl.record(snapAt(300));
    // (the sampler ran for the same line: a sample is wanted at every picture, so it failed again)
    expect(tl.status().state).toBe('failed');
    broken = false;
    tl.clear();
    tl.record(snapAt(360));
    expect(tl.status()).toMatchObject({ state: 'recording', count: 1 });
    for (const spy of log) expect(spy).not.toHaveBeenCalled();
  });

  it('a line state that throws is swallowed too', () => {
    const tl = createSliceTimeLapse({
      line: () => {
        throw new Error('no layers');
      },
      enabled: () => true,
      terrain: () => TERRAIN,
      budgetBytes: SLICE_RECORDER_MAX_BYTES,
    });
    expect(() => tl.record(snapAt(0))).not.toThrow();
    expect(tl.status().state).toBe('failed');
  });
});

describe('the simulation never depends on the recorder', () => {
  it('a snapshot is not changed by recording it: the hash before and after, and the snapshot is not kept (the typed arrays are not shared)', () => {
    const tl = make();
    const snap = snapAt(300);
    const before = snapshotHash(snap);
    const u = snap.atmosphere!.u.slice();
    tl.record(snap);
    expect(snapshotHash(snap)).toBe(before);
    expect(Array.from(snap.atmosphere!.u)).toEqual(Array.from(u));
    snap.atmosphere!.u.fill(99); // the engine reuses nothing, but a consumer that overwrote a snapshot must not change the recording
    snap.atmosphere!.v.fill(99);
    const back = tl.read(resolved(HAND).line!, 300, 'prognostic', null, null)!;
    expect(Math.max(...Array.from(back.values.speed))).toBeLessThan(30);
  });

  for (const [tier, extent, until, chunk] of [
    ['fast', 2400, 900, 300],
    ['standard', 1500, 360, 120],
  ] as const) {
    it(`${tier} tier, a real run of ${until} s: the same snapshot hashes with the recorder in the snapshot hook as without, and the recorder really recorded`, { timeout: 240_000 }, () => {
      const sc = syntheticScenario({ ignitions: [pointIgnition('a', -300, 0, 0, 60)], extent, options: { snapshotInterval: 60, tier } });
      const g = sc.terrain.grid;
      const ground = new HeightField(g, sc.terrain.elevation, 1);
      const half = extent * 0.4;
      const state: SliceLineState = { azimuth: 0, centre: [0, 0], a: [-half, -half * 0.3], b: [half, half * 0.5], preset: null };

      const plain = new Map<number, number>();
      const simA = new Simulation(sc, { tier, hooks: { snapshot: (snap) => plain.set(snap.time, snapshotHash(snap)) } });
      for (let t = chunk; t <= until; t += chunk) simA.advance(t);

      const tl = createSliceTimeLapse({ line: () => state, enabled: () => true, terrain: () => ground, budgetBytes: SLICE_RECORDER_MAX_BYTES });
      const withRec = new Map<number, number>();
      const around: string[] = [];
      const simB = new Simulation(sc, {
        tier,
        hooks: {
          snapshot: (snap) => {
            const h0 = snapshotHash(snap);
            tl.record(snap);
            const h1 = snapshotHash(snap);
            if (h0 !== h1) around.push(`t=${snap.time}`);
            withRec.set(snap.time, h1);
          },
        },
      });
      for (let t = chunk; t <= until; t += chunk) simB.advance(t);

      expect(around).toEqual([]);
      expect([...withRec.keys()]).toEqual([...plain.keys()]);
      expect(plain.size).toBe(until / 60);
      for (const [t, h] of plain) expect(withRec.get(t), `t=${t}`).toBe(h);
      // the recorder was not idle: it holds a sample for every picture
      const st = tl.status();
      expect(st.state).toBe('recording');
      expect(st.count).toBe(until / 60);
      expect(st.to).toBe(until);
      // and what it holds is the air of that time on this tier's kind
      const line = resolveSlice(state, makeResolveContext({ grid: simB.snapshot().atmosphere!.grid, heightAt: (x, y) => ground.heightAt(x, y) })).line!;
      const kind = tier === 'fast' ? 'diagnosed' : 'prognostic';
      const back = tl.read(line, until, kind, null, null)!;
      expect(back.kind).toBe(kind);
      expect(back.airTime).toBeGreaterThan(until - 60 - 1e-6);
      expect(back.values.speed.some((x) => x > 0)).toBe(true);
    });
  }

  it('the standard and the fast tier are built on one atmosphere grid, so a switch between them keeps the recording; the high tier has a finer one and starts another', { timeout: 240_000 }, () => {
    const extent = 6000; // 133 m cells on the standard and fast tiers, 100 m on the high tier
    const mk = (tier: 'fast' | 'standard' | 'high'): SimSnapshot => {
      const sc = syntheticScenario({ ignitions: [pointIgnition('a', -300, 0, 0, 60)], extent, cellSize: 60, options: { snapshotInterval: 60, tier } });
      const sim = new Simulation(sc, { tier });
      sim.advance(120);
      return sim.snapshot();
    };
    const sc = syntheticScenario({ extent, cellSize: 60, options: { tier: 'fast' } });
    const ground = new HeightField(sc.terrain.grid, sc.terrain.elevation, 1);
    const state: SliceLineState = { azimuth: 0, centre: [0, 0], a: [-2500, -1000], b: [2500, 1500], preset: null };
    const take = (snap: SimSnapshot, t: number) => {
      const r = resolveSlice(state, makeResolveContext({ grid: snap.atmosphere!.grid, heightAt: (x, y) => ground.heightAt(x, y) })).line!;
      return { r, d: sampleSlice(new AtmosphereSampler(snap.atmosphere!, snap.atmosphere!.baseM!, null), ground, { line: r, shownTime: t })! };
    };
    const a = take(mk('standard'), 120);
    const b = take(mk('fast'), 180);
    expect(a.d.kind).toBe('prognostic');
    expect(b.d.kind).toBe('diagnosed');
    expect(a.d.cellSizeM).toBeCloseTo(133.3, 0);
    const rec = new SliceRecorder();
    rec.setLine(sliceLineKey(a.r));
    rec.store(a.d, 120);
    rec.store(b.d, 180);
    expect(rec.status()).toMatchObject({ count: 2, dropped: null }); // one epoch: the same lattice, height axis and model ground
    expect(rec.read(b.r, 180, 'diagnosed', null, null)!.kind).toBe('diagnosed');
    expect(rec.read(b.r, 150, 'prognostic', null, null)!.kind).toBe('prognostic');
    // the high tier: a finer model grid is another lattice
    const high = take(mk('high'), 240);
    expect(high.d.cellSizeM).toBeCloseTo(100, 0);
    expect(high.d.columns).toBeGreaterThan(a.d.columns);
    rec.store({ ...high.d, line: a.r }, 240);
    expect(rec.status()).toMatchObject({ count: 1, from: 240, dropped: 'model' });
  });
});
