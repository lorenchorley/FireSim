/**
 * The pace signal as the session feeds it (SimSession.trackPace): a scripted engine that computes at a chosen speed, a manual
 * animation-frame clock, and the checks that matter to a person: the signal appears when the engine cannot keep up, goes when
 * it can, is silent for every excluded state, reads the engine's own statistics when it reports them, and that nothing the
 * tracker does reaches the engine (no tier change, no step change, no rewind).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CellExplanation, Ignition, Insight, ScenarioData, ScenarioEdit, SimSnapshot } from '../core/types';
import type { EngineInfo } from '../core/simTypes';
import type { SceneViewApi } from '../render/api';
import type { SimController, SimEvents, SimOptionKey } from '../sim/protocol';
import { SimSession } from './session';
import { Emitter } from './store';

const DURATION = 6 * 3600;
const STEP = 60;

/** An engine that computes `capacity` simulated seconds per wall second towards the target it was asked for, one display step at a time. */
class SlowEngine implements SimController {
  private readonly ev = new Emitter<SimEvents>();
  readonly calls: { name: string; args: unknown[] }[] = [];
  time = 0;
  until = 0;
  running = false;
  capacity = 40;
  /** What the engine reports about itself with every snapshot. */
  info: EngineInfo | null = null;
  private carry = 0;

  async init(): Promise<Insight[]> {
    return [];
  }
  run(until: number): void {
    this.calls.push({ name: 'run', args: [until] });
    this.until = Math.min(until, DURATION);
    this.running = true;
    this.ev.emit('status', { time: this.time, running: true, speed: this.capacity, until });
  }
  pause(): void {
    this.calls.push({ name: 'pause', args: [] });
    this.running = false;
    this.ev.emit('status', { time: this.time, running: false, speed: 0, until: this.until });
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
    this.time = Math.floor(t / STEP) * STEP;
    this.ev.emit('rewound', t);
  }
  setOption(k: SimOptionKey, v: number | boolean): void {
    this.calls.push({ name: 'setOption', args: [k, v] });
  }
  setQuality(): void {
    this.calls.push({ name: 'setQuality', args: [] });
  }
  async explain(): Promise<CellExplanation> {
    return {} as CellExplanation;
  }
  on<K extends keyof SimEvents>(e: K, cb: SimEvents[K]): () => void {
    return this.ev.on(e, cb);
  }
  dispose(): void {}

  names(): string[] {
    return this.calls.map((c) => c.name);
  }

  /** The worker fails, or rewinds on its own (a tier switch restores the latest checkpoint). */
  fail(message: string): void {
    this.running = false;
    this.ev.emit('error', message);
  }
  rewoundAt(t: number): void {
    this.ev.emit('rewound', t);
  }

  snapshot(time: number): void {
    this.ev.emit('snapshot', { time, insights: [], spotFires: [], stats: { time }, ...(this.info ? { engine: this.info } : {}) } as unknown as SimSnapshot);
  }

  /** Compute `wallS` seconds of work: whole display steps as they complete, then stop at the target. */
  work(wallS: number): void {
    if (!this.running) return;
    this.carry += this.capacity * wallS;
    while (this.carry >= STEP && this.time < this.until - 1e-9) {
      this.carry -= STEP;
      this.time += STEP;
      this.snapshot(this.time);
      this.ev.emit('status', { time: this.time, running: true, speed: this.capacity, until: this.until });
    }
    if (this.time >= this.until - 1e-9) {
      this.running = false;
      this.carry = 0;
      this.ev.emit('status', { time: this.time, running: false, speed: 0, until: this.until });
    }
  }
}

const nullView = new Proxy({}, { get: () => () => null }) as unknown as SceneViewApi;
const scenario = (): ScenarioData =>
  ({ id: 's', name: 's', origin: { lat: 0, lon: 0 }, extent: 3000, startTime: 0, duration: DURATION, ignitions: [], edits: [], options: { snapshotInterval: STEP, coupling: 1, embers: true, mountainPhenomena: true } }) as unknown as ScenarioData;

// A manual animation-frame clock, on the clock `performance.now()` reads.
let frames: ((now: number) => void)[] = [];
let wall = 0;
const g = globalThis as { requestAnimationFrame?: unknown; cancelAnimationFrame?: unknown };
let savedRaf: unknown;
let savedCaf: unknown;
beforeEach(() => {
  savedRaf = g.requestAnimationFrame;
  savedCaf = g.cancelAnimationFrame;
  frames = [];
  wall = performance.now();
  g.requestAnimationFrame = (cb: (now: number) => void): number => frames.push(cb);
  g.cancelAnimationFrame = (id: number): void => {
    frames[id - 1] = () => undefined;
  };
});
afterEach(() => {
  g.requestAnimationFrame = savedRaf;
  g.cancelAnimationFrame = savedCaf;
});

/** One animation frame after `ms` of wall time: the engine works for that long, then the loop runs. */
function frame(e: SlowEngine, ms = 50): void {
  wall += ms;
  e.work(ms / 1000);
  const now = wall;
  const cbs = frames;
  frames = [];
  for (const cb of cbs) cb(now);
}
const run = (e: SlowEngine, seconds: number): void => {
  for (let i = 0; i < Math.round(seconds * 20); i++) frame(e);
};

async function make(capacity = 40): Promise<{ e: SlowEngine; s: SimSession }> {
  const e = new SlowEngine();
  e.capacity = capacity;
  const s = new SimSession(scenario(), e, nullView, { maxBytes: 1e9 });
  await s.start();
  e.snapshot(0);
  return { e, s };
}

/** The engine's own report, with the statistics of workstream A. */
const report = (o: { speed?: number | null; duty?: number | null; tierCause?: EngineInfo['tierCause']; tier?: EngineInfo['tier']; rewinds?: number } = {}): EngineInfo =>
  ({
    tier: o.tier ?? 'standard',
    tierCause: o.tierCause ?? 'auto-tune',
    perf: {
      speed: { s10: o.speed === undefined ? 38 : o.speed, s60: null, mean: null, best10: null, worst10: null },
      duty: { s10: o.duty === undefined ? 0.97 : o.duty, s60: null },
      reruns: { rewinds: o.rewinds ?? 0, recomputedS: 0, tierSwitches: 0, restores: 0 },
      history: [],
      modules: [],
    },
  }) as unknown as EngineInfo;

describe('the pace signal from the animation loop', () => {
  it('appears when the engine cannot keep up, and the engine is never touched to "fix" it', async () => {
    const { e, s } = await make(40);
    s.setSpeed(600);
    s.play();
    expect(s.state.get().pace).toBeNull();
    run(e, 14);
    expect(s.state.get().pace).toBeNull(); // the wait after Play
    run(e, 30);
    const p = s.state.get().pace;
    expect(p?.level).toBe('waiting');
    expect(p!.wanted).toBe(600);
    expect(p!.capacity).toBe(40); // the status reports' speed: the fallback while the engine reports no statistics
    expect(p!.waitingShare).toBeGreaterThan(0.5);
    // The tracker only looks: no tier, no step, no option, no rewind came out of it.
    expect(e.names().filter((n) => n !== 'run' && n !== 'pause')).toEqual([]);
    s.dispose();
  });

  it('stays quiet when the engine keeps up, and publishes a reading with the numbers of the engine', async () => {
    const { e, s } = await make(5000);
    s.setSpeed(60);
    s.play();
    run(e, 60);
    const p = s.state.get().pace;
    expect(p?.level).toBe('ok');
    expect(p!.achieved).toBeGreaterThan(59);
    expect(p!.aheadS).toBeGreaterThan(100);
    s.dispose();
  });

  it('gives the signal up when the user plays slower (the wait after a change of speed, then ok)', async () => {
    const { e, s } = await make(40);
    s.setSpeed(600);
    s.play();
    run(e, 40);
    expect(s.state.get().pace?.level).toBe('waiting');
    s.setSpeed(30);
    run(e, 1);
    expect(s.state.get().pace).toBeNull();
    run(e, 40);
    expect(s.state.get().pace?.level).toBe('ok');
    expect(s.state.get().pace!.wanted).toBe(30);
    s.dispose();
  });

  it('is null while paused, and after Play the wait starts again', async () => {
    const { e, s } = await make(40);
    s.setSpeed(600);
    s.play();
    run(e, 40);
    expect(s.state.get().pace?.level).toBe('waiting');
    s.pause();
    expect(s.state.get().pace).toBeNull();
    run(e, 30);
    expect(s.state.get().pace).toBeNull();
    s.play();
    run(e, 10);
    expect(s.state.get().pace).toBeNull();
    run(e, 40);
    expect(s.state.get().pace?.level).toBe('waiting');
    s.dispose();
  });

  it('is null during a jump beyond the computed range, and Max speed publishes no pace', async () => {
    const { e, s } = await make(40);
    s.setSpeed(600);
    s.play();
    run(e, 40);
    expect(s.state.get().pace?.level).toBe('waiting');
    s.seek(3 * 3600);
    expect(s.state.get().seekTarget).not.toBeNull();
    expect(s.state.get().pace).toBeNull();
    s.cancelSeek();
    s.setSpeed(Infinity);
    s.play();
    run(e, 60);
    expect(s.state.get().pace).toBeNull();
    s.dispose();
  });

  it('is null while the engine is still deciding its tier (auto-pending) and spinning up', async () => {
    const { e, s } = await make(40);
    e.info = report({ tierCause: 'auto-pending' });
    e.snapshot(0);
    s.setSpeed(600);
    s.play();
    run(e, 60);
    expect(s.state.get().headTime).toBeGreaterThan(60); // results are arriving, and the clock is held at them: it would look like lag
    expect(s.state.get().pace).toBeNull();
    // The decision is made: the engine reports its tier, and the signal can come after the wait.
    e.info = report({ tierCause: 'auto-tune' });
    e.snapshot(e.time);
    run(e, 40);
    expect(s.state.get().pace?.level).toBe('waiting');
    s.dispose();
  });

  it('drops the reading when the user edits the run (an ignition rewinds and re-runs), and waits again', async () => {
    const { e, s } = await make(40);
    s.setSpeed(600);
    s.play();
    run(e, 40);
    expect(s.state.get().pace?.level).toBe('waiting');
    s.ignite({ id: 'i1', points: [[0, 0]], radius: 20, origin: 'observed' } as unknown as Omit<Ignition, 'time'>);
    expect(s.state.get().pace).toBeNull();
    s.dispose();
  });

  it('drops the reading when the worker rewinds on its own (a tier switch re-runs from a checkpoint)', async () => {
    const { e, s } = await make(40);
    s.setSpeed(600);
    s.play();
    run(e, 40);
    expect(s.state.get().pace?.level).toBe('waiting');
    e.rewoundAt(e.time);
    expect(s.state.get().pace).toBeNull();
    s.dispose();
  });

  it('is null when a worker error stops playback', async () => {
    const { e, s } = await make(40);
    s.setSpeed(600);
    s.play();
    run(e, 40);
    expect(s.state.get().pace?.level).toBe('waiting');
    e.fail('boom');
    expect(s.state.get().playing).toBe(false);
    expect(s.state.get().pace).toBeNull();
    s.dispose();
  });

  it('reads the engine\'s own statistics when it reports them (the capacity and the duty of the last 10 s)', async () => {
    const { e, s } = await make(40);
    e.info = report({ speed: 33, duty: 0.95 });
    e.snapshot(0);
    s.setSpeed(600);
    s.play();
    run(e, 40);
    // The next snapshots carry the report.
    const p = s.state.get().pace;
    expect(p?.level).toBe('waiting');
    expect(p!.capacity).toBe(33);
    expect(p!.duty).toBe(0.95);
    expect(s.engineInfo()?.perf?.speed.s10).toBe(33);
    s.dispose();
  });

  it('drops the reading when the engine says it re-ran (a restore or a tier switch)', async () => {
    const { e, s } = await make(40);
    e.info = report({ rewinds: 0 });
    e.snapshot(0);
    s.setSpeed(600);
    s.play();
    run(e, 40);
    expect(s.state.get().pace?.level).toBe('waiting');
    e.info = report({ rewinds: 1 });
    e.snapshot(e.time);
    run(e, 1);
    expect(s.state.get().pace).toBeNull();
    s.dispose();
  });

  it('publishes a new reading about once a second, not on every frame', async () => {
    const { e, s } = await make(5000);
    s.setSpeed(60);
    s.play();
    run(e, 20);
    let changes = 0;
    const off = s.state.subscribe(() => changes++, ['pace']);
    run(e, 10);
    off();
    expect(changes).toBeGreaterThan(0);
    expect(changes).toBeLessThanOrEqual(12);
    s.dispose();
  });

  it('the debug hook forces a level (paused too) and gives control back', async () => {
    const { e, s } = await make(5000);
    s.debugForcePace('waiting');
    expect(s.state.get().pace?.level).toBe('waiting');
    expect(s.state.get().playing).toBe(false);
    s.debugForcePace('behind');
    expect(s.state.get().pace?.level).toBe('behind');
    s.debugForcePace(null);
    expect(s.state.get().pace).toBeNull();
    run(e, 1);
    expect(e.names()).toEqual([]);
    s.dispose();
  });
});
