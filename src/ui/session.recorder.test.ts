/**
 * The session and the Air slice time-lapse recorder (0.4.1, plan 8.6): `onSnapshot` feeds every snapshot to `view.sliceRecording`, and
 * the one helper `cutHistory(t)` cuts the history and the recorder at the five places the session cuts. A scripted engine drives the
 * session; a spy sees the calls, and a real `SliceTimeLapse` behind the spy shows what is kept (the sample at t) and what is gone (the
 * sample after it). Tier switches and replays arrive as earlier snapshots and cut by time order, which is tested the same way.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeGridSpec } from '../core/grid';
import { SLICE_RECORDER_MAX_BYTES } from '../core/sliceRecording';
import type { CellExplanation, Ignition, Insight, ScenarioData, ScenarioEdit, SimSnapshot } from '../core/types';
import type { SceneViewApi } from '../render/api';
import { resolveSlice } from '../render/slice/sectionLine';
import { createSliceTimeLapse, type SliceTimeLapse } from '../render/slice/sliceTimeLapse';
import { makeAirView, makeResolveContext } from '../render/slice/testing';
import type { SliceLineState, SliceRecordingApi, SliceRecordingStatus } from '../render/slice/types';
import type { SimController, SimEvents, SimOptionKey } from '../sim/protocol';
import { defaultSnapshotBudget, SimSession } from './session';
import { Emitter } from './store';

const MiB = 1048576;
const ridge = (x: number, y: number): number => 600 + 500 * Math.exp(-((x / 900) ** 2)) + 150 * Math.sin(y / 700);
/** A small model (a 6 km area of 21 x 21 columns and 12 levels): the same air in every snapshot, which is all the recorder needs. */
const AIR = makeAirView({ grid: makeGridSpec({ lat: -33.7, lon: 150.3 }, 21 * 300, 300), nz: 12, baseM: 500, topM: 3000, groundAt: (x, y) => ridge(x, y) - 20, u: (x, _y, z) => 6 + 0.004 * (z - 500) + Math.sin(x / 900), v: () => 1, w: () => 0.2, theta: (x) => 0.002 * x, smoke: () => 1e-3 });
const HAND: SliceLineState = { azimuth: 0, centre: [0, 0], a: [-2500, -900], b: [2500, 1200], preset: null };
const LINE = resolveSlice(HAND, makeResolveContext({ grid: AIR.grid, heightAt: ridge })).line!;

// ───────────────────────────── a scripted engine (as session.timeline.test.ts, with air in its snapshots) ─────────────────────────────

class FakeEngine implements SimController {
  private readonly ev = new Emitter<SimEvents>();
  readonly calls: { name: string; args: unknown[] }[] = [];
  time = 0;
  until = 0;
  running = false;
  step = 60;
  duration = 7200;
  /** Say 'rewound' when asked to rewind (the real worker does, a moment later); off, a test sends it itself. */
  announceRewind = false;

  async init(): Promise<Insight[]> {
    return [];
  }
  run(until: number): void {
    this.calls.push({ name: 'run', args: [until] });
    this.until = Math.min(until, this.duration);
    this.running = true;
  }
  pause(): void {
    this.running = false;
  }
  ignite(i: Ignition): void {
    this.calls.push({ name: 'ignite', args: [i] });
  }
  edit(e: ScenarioEdit, t: number): void {
    this.calls.push({ name: 'edit', args: [e, t] });
  }
  removeEdit(id: string): void {
    this.calls.push({ name: 'removeEdit', args: [id] });
  }
  removeIgnition(id: string): void {
    this.calls.push({ name: 'removeIgnition', args: [id] });
  }
  rewind(t: number): void {
    this.calls.push({ name: 'rewind', args: [t] });
    this.time = Math.floor(t / this.step) * this.step;
    if (this.announceRewind) this.ev.emit('rewound', t);
  }
  setOption(k: SimOptionKey, v: number | boolean): void {
    this.calls.push({ name: 'setOption', args: [k, v] });
    if (k === 'snapshotInterval') this.step = Number(v);
  }
  setQuality(): void {}
  async explain(): Promise<CellExplanation> {
    return {} as CellExplanation;
  }
  on<K extends keyof SimEvents>(e: K, cb: SimEvents[K]): () => void {
    return this.ev.on(e, cb);
  }
  emit<K extends keyof SimEvents>(e: K, ...a: Parameters<SimEvents[K]>): void {
    this.ev.emit(e, ...a);
  }
  dispose(): void {}

  snapshot(time: number): void {
    this.ev.emit('snapshot', { time, insights: [], spotFires: [], stats: { time, weather: null }, atmosphere: AIR } as unknown as SimSnapshot);
  }
  /** t0 plus a computed history up to `t` (paused). */
  history(t: number): void {
    this.snapshot(0);
    for (let x = this.step; x <= t; x += this.step) {
      this.time = x;
      this.snapshot(x);
    }
    this.time = t;
  }
}

const scenario = (duration = 7200): ScenarioData =>
  ({ id: 's', name: 's', origin: { lat: 0, lon: 0 }, extent: 3000, startTime: 0, duration, ignitions: [], edits: [], options: { snapshotInterval: 60, coupling: 1, embers: true, mountainPhenomena: true } }) as unknown as ScenarioData;

/** A view whose `sliceRecording` is a spy on a real time-lapse recorder: every call is logged, then passed on. */
function spiedView(): { view: SceneViewApi; calls: { name: string; arg?: number }[]; real: SliceTimeLapse; budgets: number[]; cleared: () => number } {
  const real = createSliceTimeLapse({ line: () => HAND, enabled: () => true, terrain: () => ({ heightAt: ridge }), budgetBytes: SLICE_RECORDER_MAX_BYTES });
  const calls: { name: string; arg?: number }[] = [];
  const budgets: number[] = [];
  let cleared = 0;
  const api: SliceRecordingApi = {
    record: (s) => {
      calls.push({ name: 'record', arg: s.time });
      real.record(s);
    },
    truncateAfter: (t) => {
      calls.push({ name: 'truncateAfter', arg: t });
      real.truncateAfter(t);
    },
    clear: () => {
      cleared++;
      calls.push({ name: 'clear' });
      real.clear();
    },
    status: () => real.status(),
    setHistoryBudget: (b) => {
      budgets.push(b);
      real.setHistoryBudget!(b);
    },
  };
  const view = new Proxy({}, { get: (_t, key) => (key === 'sliceRecording' ? api : () => null) }) as unknown as SceneViewApi;
  return { view, calls, real, budgets, cleared: () => cleared };
}

// A manual animation-frame clock (the session runs its loop on requestAnimationFrame).
const g = globalThis as { requestAnimationFrame?: unknown; cancelAnimationFrame?: unknown };
let savedRaf: unknown;
let savedCaf: unknown;
beforeEach(() => {
  savedRaf = g.requestAnimationFrame;
  savedCaf = g.cancelAnimationFrame;
  g.requestAnimationFrame = (): number => 1;
  g.cancelAnimationFrame = (): void => undefined;
});
afterEach(() => {
  g.requestAnimationFrame = savedRaf;
  g.cancelAnimationFrame = savedCaf;
});

async function make(view: SceneViewApi, opts: { maxBytes?: number } = { maxBytes: 1e9 }): Promise<{ e: FakeEngine; s: SimSession }> {
  const e = new FakeEngine();
  const s = new SimSession(scenario(), e, view, opts);
  await s.start();
  return { e, s };
}

const cuts = (calls: { name: string; arg?: number }[]): number[] => calls.filter((c) => c.name === 'truncateAfter').map((c) => c.arg!);
const readAt = (real: SliceTimeLapse, t: number): number | null => real.read(LINE, t, 'prognostic', null, null)?.recordedAt ?? null;

describe('every snapshot reaches the recorder, after the history has it', () => {
  it('onSnapshot records each one once, in order, and the recorder holds a sample for each at the start (no gap yet)', async () => {
    const { view, calls, real } = spiedView();
    const { e, s } = await make(view);
    e.history(600);
    expect(calls.filter((c) => c.name === 'record').map((c) => c.arg)).toEqual([0, 60, 120, 180, 240, 300, 360, 420, 480, 540, 600]);
    expect(real.status()).toMatchObject({ state: 'recording', count: 11, from: 0, to: 600 });
    expect(s.snapshots.headTime()).toBe(600); // the history has it too
    s.dispose();
  });

  it('after dispose a late snapshot is ignored by both', async () => {
    const { view, calls } = spiedView();
    const { e, s } = await make(view);
    e.history(120);
    s.dispose();
    e.snapshot(180);
    expect(calls.filter((c) => c.name === 'record').map((c) => c.arg)).toEqual([0, 60, 120]);
  });

  it('a view that has no recorder (the 2-D map) changes nothing: edits, rewinds and dispose all work', async () => {
    const view = new Proxy({}, { get: (_t, key) => (key === 'sliceRecording' ? undefined : () => null) }) as unknown as SceneViewApi;
    const { e, s } = await make(view);
    e.history(1800);
    s.seek(600);
    s.ignite({ id: 'x', kind: 'point', points: [[0, 0]], origin: 'observed' });
    s.rerunWith({ coupling: 0, embers: true, mountainPhenomena: true }, 'w');
    s.setSolverStep(2);
    e.emit('rewound', 100);
    s.dispose();
    expect(s.snapshots.headTime()).toBeNull();
  });

  it('tells the recorder how much room the history has, so it keeps an eighth of it', async () => {
    const small = spiedView();
    const a = await make(small.view, { maxBytes: 48 * MiB });
    expect(small.budgets).toEqual([48 * MiB]);
    expect(small.real.status().budgetBytes).toBe(6 * MiB);
    a.s.dispose();
    const dflt = spiedView();
    const b = await make(dflt.view, {} as { maxBytes?: number });
    expect(dflt.budgets).toEqual([defaultSnapshotBudget()]);
    expect(dflt.real.status().budgetBytes).toBe(Math.min(12 * MiB, Math.round(defaultSnapshotBudget() / 8)));
    b.s.dispose();
  });
});

describe('the five places the history is cut, and the one helper that cuts it', () => {
  // The scripted engine does not say 'rewound' by itself here, so each site's own call is the only one the spy sees.
  async function atHead(viewTime: number): Promise<{ e: FakeEngine; s: SimSession; spy: ReturnType<typeof spiedView> }> {
    const spy = spiedView();
    const { e, s } = await make(spy.view);
    e.history(1800);
    s.seek(viewTime);
    spy.calls.length = 0;
    return { e, s, spy };
  }

  it('prepareEditAt (an edit made in the past): everything after the view time goes, the sample at the view time stays', async () => {
    const { e, s, spy } = await atHead(600);
    expect(readAt(spy.real, 1800)).toBe(1800);
    s.ignite({ id: 'x', kind: 'point', points: [[0, 0]], origin: 'observed' });
    expect(cuts(spy.calls)).toEqual([600]);
    expect(e.calls.map((c) => c.name)).toContain('rewind');
    expect(spy.real.status()).toMatchObject({ count: 11, from: 0, to: 600 }); // 0, 60 ... 600
    expect(readAt(spy.real, 600)).toBe(600);
    expect(readAt(spy.real, 660)).toBe(600); // nothing at 660: the newest at or before is 600
    expect(s.snapshots.headTime()).toBe(600);
    s.dispose();
  });

  it('prepareEditAt at the head cuts nothing (nothing is in the future)', async () => {
    const { s, spy } = await atHead(1800);
    s.ignite({ id: 'x', kind: 'point', points: [[0, 0]], origin: 'observed' });
    expect(cuts(spy.calls)).toEqual([]);
    expect(spy.real.status().to).toBe(1800);
    s.dispose();
  });

  it('rerunWith (a what-if from the view time): cut at the view time, even at the head', async () => {
    const { s, spy } = await atHead(900);
    s.rerunWith({ coupling: 0, embers: true, mountainPhenomena: true }, 'no coupling');
    expect(cuts(spy.calls)).toEqual([900]);
    expect(spy.real.status()).toMatchObject({ count: 16, to: 900 });
    expect(readAt(spy.real, 960)).toBe(900);
    s.dispose();
    const head = await atHead(1800);
    head.s.rerunWith({ coupling: 0, embers: true, mountainPhenomena: true }, 'at the head');
    expect(cuts(head.spy.calls)).toEqual([1800]);
    expect(head.spy.real.status().to).toBe(1800);
    head.s.dispose();
  });

  it('rerunFromView (a solver step change): cut at the view time', async () => {
    const { s, spy } = await atHead(1200);
    s.setSolverStep(2);
    expect(cuts(spy.calls)).toEqual([1200]);
    expect(spy.real.status()).toMatchObject({ count: 21, to: 1200 });
    expect(readAt(spy.real, 1260)).toBe(1200);
    s.dispose();
  });

  it('removeIgnition: cut at the IGNITION’s time, which can be far before the view time', async () => {
    const spy = spiedView();
    const { e, s } = await make(spy.view);
    e.history(1800);
    s.seek(300);
    const ign = s.ignite({ id: 'x', kind: 'point', points: [[0, 0]], origin: 'observed' }); // at 300; the future is cut, the engine re-runs it
    expect(ign.time).toBe(300);
    for (let t = 360; t <= 1800; t += 60) e.snapshot(t); // the new run's results
    e.time = 1800;
    s.seek(1200);
    expect(spy.real.status().to).toBe(1800);
    spy.calls.length = 0;
    s.removeIgnition('x');
    expect(cuts(spy.calls)).toEqual([300]); // not 1200
    expect(spy.real.status()).toMatchObject({ count: 6, from: 0, to: 300 });
    expect(readAt(spy.real, 300)).toBe(300);
    expect(readAt(spy.real, 1200)).toBe(300);
    expect(s.snapshots.headTime()).toBe(300);
    s.dispose();
  });

  it('removeIgnition of one that is not before the head cuts nothing', async () => {
    const spy = spiedView();
    const { e, s } = await make(spy.view);
    e.history(600);
    s.seek(600);
    const ign = s.ignite({ id: 'y', kind: 'point', points: [[0, 0]], origin: 'observed' }); // at the head (600)
    spy.calls.length = 0;
    expect(ign.time).toBe(600);
    s.removeIgnition('y');
    expect(cuts(spy.calls)).toEqual([]);
    s.dispose();
  });

  it('onRewound: the worker went back to a checkpoint; results after the view time (or after the checkpoint, if later) are stale', async () => {
    const { e, s, spy } = await atHead(900);
    e.emit('rewound', 660); // the view is at 900: results before it stay, they were made by the same run
    expect(cuts(spy.calls)).toEqual([900]);
    expect(spy.real.status()).toMatchObject({ count: 16, to: 900 });
    expect(s.snapshots.headTime()).toBe(900);
    s.dispose();
  });

  it('onRewound with a checkpoint after the view time keeps up to the checkpoint', async () => {
    const { e, s, spy } = await atHead(300);
    e.emit('rewound', 780);
    expect(cuts(spy.calls)).toEqual([780]);
    expect(spy.real.status()).toMatchObject({ to: 780 });
    s.dispose();
  });

  it('onRewound after removeIgnition: everything after the checkpoint is stale, even before the view time', async () => {
    const spy = spiedView();
    const { e, s } = await make(spy.view);
    e.history(1800);
    s.seek(300);
    s.ignite({ id: 'x', kind: 'point', points: [[0, 0]], origin: 'observed' });
    for (let t = 360; t <= 1800; t += 60) e.snapshot(t);
    e.time = 1800;
    s.seek(1200);
    s.removeIgnition('x'); // 300 is cut by the session itself
    for (let t = 360; t <= 1800; t += 60) e.snapshot(t); // the worker's run without the ignition arrives
    spy.calls.length = 0;
    s.seek(1500);
    e.emit('rewound', 300); // the worker's own report: the floor was set by the removal, so the cut is at the checkpoint, not the view time
    expect(cuts(spy.calls)).toEqual([300]);
    expect(spy.real.status().to).toBe(300);
    s.dispose();
  });

  it('the early return of onRewound (the view is at the head, nothing is stale) cuts nothing', async () => {
    const { e, s, spy } = await atHead(1800);
    e.emit('rewound', 1000);
    expect(cuts(spy.calls)).toEqual([]);
    expect(spy.real.status()).toMatchObject({ count: 31, to: 1800 });
    expect(s.snapshots.headTime()).toBe(1800);
    s.dispose();
  });

  it('with a worker that announces its rewind, an edit cuts at the same time twice and the result is the same', async () => {
    const spy = spiedView();
    const e = new FakeEngine();
    e.announceRewind = true;
    const s = new SimSession(scenario(), e, spy.view, { maxBytes: 1e9 });
    await s.start();
    e.history(1800);
    s.seek(600);
    spy.calls.length = 0;
    s.ignite({ id: 'x', kind: 'point', points: [[0, 0]], origin: 'observed' });
    expect(new Set(cuts(spy.calls))).toEqual(new Set([600]));
    expect(spy.real.status()).toMatchObject({ count: 11, to: 600 });
    s.dispose();
  });

  it('source audit: session.ts cuts the history in exactly one place, and the recorder is cut in that same place', () => {
    const src = readFileSync(new URL('./session.ts', import.meta.url), 'utf8');
    const truncs = src.match(/snapshots\.truncate\w*\(/g) ?? [];
    expect(truncs).toHaveLength(1);
    const body = src.slice(src.indexOf('private cutHistory('));
    const end = body.indexOf('\n  }\n');
    const helper = body.slice(0, end);
    expect(helper).toContain('this.snapshots.truncateAfter(t)');
    expect(helper).toContain('this.view.sliceRecording?.truncateAfter(t)');
    expect(src.match(/sliceRecording\?\.truncateAfter\(/g) ?? []).toHaveLength(1);
    expect((src.match(/this\.cutHistory\(/g) ?? []).length).toBe(5); // the five sites
    // the recorder is fed once, right after the store has the snapshot
    expect(src.match(/sliceRecording\?\.record\(/g) ?? []).toHaveLength(1);
    expect(src.indexOf('this.snapshots.push(snap)')).toBeLessThan(src.indexOf('sliceRecording?.record('));
  });
});

describe('time order: a snapshot at or before the newest sample drops the later ones', () => {
  it('a replay (a worker restored a checkpoint and streams the results again) drops the stale samples as each earlier snapshot arrives', async () => {
    const { view, real } = spiedView();
    const { e, s } = await make(view);
    e.history(1800);
    expect(real.status()).toMatchObject({ count: 31, to: 1800 });
    // A tier switch: the checkpoint at 600; the store and the recorder both hear the re-emitted pictures, earliest first.
    e.snapshot(660);
    expect(real.status()).toMatchObject({ count: 12, to: 660 });
    expect(s.snapshots.headTime()).toBe(660);
    e.snapshot(720);
    expect(real.status()).toMatchObject({ count: 13, to: 720 });
    // a picture at exactly the time of a stored one replaces it
    e.snapshot(720);
    expect(real.status()).toMatchObject({ count: 13, to: 720 });
    e.snapshot(300); // a re-run from far back
    expect(real.status()).toMatchObject({ count: 6, to: 300 });
    expect(s.snapshots.headTime()).toBe(300);
    s.dispose();
  });

  it('a thinned recording is cut the same way: a re-emitted picture drops what is after it and what stays is before it', async () => {
    const spy = spiedView();
    const { e, s } = await make(spy.view);
    spy.real.setHistoryBudget!(0.7 * MiB * 8); // a small budget: a few dozen samples, so it thins at once
    e.history(7200 - 60);
    const before = spy.real.status();
    expect(before.spacingS).toBeGreaterThan(0);
    expect(before.bytes).toBeLessThanOrEqual(before.budgetBytes);
    e.snapshot(3000);
    const after = spy.real.status();
    expect(after.to).toBeLessThanOrEqual(3000);
    expect(after.to).toBeGreaterThanOrEqual(3000 - after.spacingS - 1e-6);
    expect(after.from).toBe(0);
    s.dispose();
  });
});

describe('dispose', () => {
  it('clears the recorder (the scenario ended)', async () => {
    const spy = spiedView();
    const { e, s } = await make(spy.view);
    e.history(600);
    expect(spy.real.status().count).toBe(11);
    s.dispose();
    expect(spy.cleared()).toBe(1);
    expect(spy.real.status()).toMatchObject({ count: 0, bytes: 0 });
    // the status after the clear is what the panel shows for a person's Clear too
    const st: SliceRecordingStatus = spy.real.status();
    expect(st.dropped).toBe('cleared');
  });
});
