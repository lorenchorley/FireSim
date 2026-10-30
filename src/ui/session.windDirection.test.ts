/**
 * Wind direction through the session (contract D-CONTRACT-060-wind, section 7.3): `setWindDirection` and
 * `removeWindDirection` with a scripted engine (as session.recorder.test.ts), and `windWeather()` with the real series.
 * What a person sees: a change starts on a whole minute at or after the view time, a change asked for in the past view
 * rewinds first, the top bar and the Weather tab read one stable series that follows the list, and removing a change
 * cuts the results at ITS time, not at the view.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CellExplanation, Ignition, Insight, ScenarioData, ScenarioEdit, SimSnapshot, WindDirectionEdit } from '../core/types';
import type { SceneViewApi } from '../render/api';
import type { SimController, SimEvents, SimOptionKey } from '../sim/protocol';
import { weatherAt } from '../scenario/weather';
import { WIND_TURN_S, applyWindDirection, windDirectionEdits } from '../scenario/windDirection';
import { LocalSimController } from '../sim/client';
import { snapshotPartHashes } from '../sim/testing/hash';
import { pointIgnition, syntheticScenario } from '../sim/testing/scenarios';
import { SimSession } from './session';
import { Emitter } from './store';

class FakeEngine implements SimController {
  private readonly ev = new Emitter<SimEvents>();
  readonly calls: { name: string; args: unknown[] }[] = [];
  time = 0;
  until = 0;
  running = false;
  step = 60;
  duration = 7200;

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
  }
  setOption(k: SimOptionKey, v: number | boolean): void {
    this.calls.push({ name: 'setOption', args: [k, v] });
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

  names(): string[] {
    return this.calls.map((c) => c.name);
  }
  snapshot(time: number): void {
    this.ev.emit('snapshot', { time, insights: [], spotFires: [], stats: { time } } as unknown as SimSnapshot);
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

const DURATION = 7200;
const sc = (edits: ScenarioEdit[] = []): ScenarioData => ({ ...syntheticScenario({ windFromDeg: 270, windKmh: 36, extent: 1500, duration: DURATION }), edits });
const nullView = new Proxy({}, { get: (_t, key) => (key === 'sliceRecording' ? undefined : () => null) }) as unknown as SceneViewApi;

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

async function make(edits: ScenarioEdit[] = []): Promise<{ e: FakeEngine; s: SimSession; scenario: ScenarioData }> {
  const e = new FakeEngine();
  const scenario = sc(edits);
  const s = new SimSession(scenario, e, nullView, { maxBytes: 1e9 });
  await s.start();
  return { e, s, scenario };
}

const sent = (e: FakeEngine): { name: string; args: unknown[] }[] => e.calls.filter((c) => c.name === 'edit' || c.name === 'rewind' || c.name === 'removeEdit');

describe('setWindDirection', () => {
  it('starts at the view time (a whole minute), sends it to the engine with its own time and records it in the edits', async () => {
    const { e, s } = await make();
    e.history(600);
    s.seek(600);
    const edit = s.setWindDirection('w1', 180)!;
    expect(edit).toEqual({ kind: 'windDirection', id: 'w1', dir: 180, time: 600, madeAt: 600 }); // madeAt: the view time Apply was pressed at (0.7.0)
    expect(sent(e)).toEqual([{ name: 'edit', args: [edit, 600] }]); // at the head: no rewind
    expect(s.state.get().edits).toEqual([{ edit, time: 600 }]);
    s.dispose();
  });

  it('raises a time to the next whole minute, and a time before the view to the view time', async () => {
    const { e, s } = await make();
    e.history(600);
    s.seek(600);
    expect(s.setWindDirection('a', 90, 1201)!.time).toBe(1260);
    expect(s.setWindDirection('b', 90, 1200)!.time).toBe(1200);
    expect(s.setWindDirection('c', 90, 100)!.time).toBe(600); // before the view
    expect(s.setWindDirection('d', 90, 0)!.time).toBe(600);
    expect(s.setWindDirection('f', 90, NaN)!.time).toBe(600);
    for (const x of windDirectionEdits(s.state.get().edits)) expect(x.time % 60).toBe(0);
    s.dispose();
  });

  it('rounds the direction to a whole degree in [0, 360)', async () => {
    const { e, s } = await make();
    e.history(600);
    s.seek(600);
    expect(s.setWindDirection('a', 450.4)!.dir).toBe(90);
    expect(s.setWindDirection('b', -10)!.dir).toBe(350);
    expect(s.setWindDirection('c', 359.6)!.dir).toBe(0);
    s.dispose();
  });

  it('gives null and sends nothing when the scenario ends within a minute', async () => {
    const { e, s } = await make();
    e.duration = DURATION;
    e.history(DURATION);
    s.seek(DURATION);
    e.calls.length = 0;
    expect(s.setWindDirection('late', 90)).toBeNull();
    expect(s.setWindDirection('late', 90, DURATION)).toBeNull();
    expect(e.calls).toEqual([]);
    expect(s.state.get().edits).toEqual([]);
    // and a time asked for beyond the end is the last whole minute that still does something
    s.seek(0);
    const last = s.setWindDirection('end', 90, DURATION + 1000)!;
    expect(last.time).toBe(DURATION - 60);
    s.dispose();
  });

  it('with the view in the past it rewinds the engine to the view first, cuts the history there and leaves review', async () => {
    const { e, s } = await make();
    e.history(1800);
    s.seek(600);
    expect(s.state.get().reviewing).toBe(true);
    const edit = s.setWindDirection('w1', 180)!;
    expect(edit.time).toBe(600);
    expect(sent(e).map((c) => c.name)).toEqual(['rewind', 'edit']);
    expect(sent(e)[0]!.args).toEqual([600]);
    expect(s.snapshots.headTime()).toBe(600);
    expect(s.state.get().headTime).toBe(600);
    expect(s.state.get().reviewing).toBe(false);
    s.dispose();
  });

  it('a change set for later while viewing the past is rewound to the view, not to its own time', async () => {
    const { e, s } = await make();
    e.history(1800);
    s.seek(600);
    const edit = s.setWindDirection('w1', 180, 1500)!;
    expect(edit.time).toBe(1500);
    expect(sent(e)[0]).toEqual({ name: 'rewind', args: [600] });
    expect(sent(e)[1]).toEqual({ name: 'edit', args: [edit, 1500] });
    expect(s.state.get().headTime).toBe(600);
    s.dispose();
  });

  it('the same id replaces the earlier change in the list', async () => {
    const { e, s } = await make();
    e.history(600);
    s.seek(600);
    s.setWindDirection('w1', 180);
    const second = s.setWindDirection('w1', 90, 1200)!;
    expect(s.state.get().edits).toEqual([{ edit: second, time: 1200 }]);
    s.dispose();
  });

  it('keeps the time of a change that came with the scenario in the edits list', async () => {
    const given: WindDirectionEdit = { kind: 'windDirection', id: 'given', dir: 200, time: 900 };
    const { s } = await make([given]);
    expect(s.state.get().edits).toEqual([{ edit: given, time: 900 }]);
    expect(windDirectionEdits(s.state.get().edits)[0]!.time).toBe(900);
    s.dispose();
  });
});

describe('windWeather', () => {
  it('is the forecast itself while there is no change, one object until the list changes, and follows the list', async () => {
    const { e, s, scenario } = await make();
    e.history(600);
    s.seek(600);
    expect(s.windWeather()).toBe(scenario.weather);
    const edit = s.setWindDirection('w1', 180)!;
    const a = s.windWeather();
    expect(a).not.toBe(scenario.weather);
    expect(s.windWeather()).toBe(a);
    // the same series the engine reads: the direction is the new one when the turn is done, the forecast's before
    const at = (t: number): number => weatherAt(a, scenario.startTime + t * 1000).windDir10;
    expect(at(edit.time - 60)).toBeCloseTo(270, 6);
    expect(at(edit.time + WIND_TURN_S)).toBeCloseTo(180, 6);
    expect(weatherAt(a, scenario.startTime + 3000 * 1000).windSpeed10).toBeCloseTo(10, 1);
    // another change: a new object; a state change that is not a wind change: the same one
    const b2 = (s.setWindDirection('w2', 90, 1800), s.windWeather());
    expect(b2).not.toBe(a);
    s.setTimeStep(120);
    expect(s.windWeather()).toBe(b2);
    s.dispose();
  });

  it('goes back to the forecast object when the last change is removed', async () => {
    const { e, s, scenario } = await make();
    e.history(600);
    s.seek(600);
    s.setWindDirection('w1', 180);
    expect(s.windWeather()).not.toBe(scenario.weather);
    s.removeWindDirection('w1');
    expect(s.windWeather()).toBe(scenario.weather);
    s.dispose();
  });
});

describe('removeWindDirection', () => {
  it('cuts the history at the CHANGE\'s time, not at the view, tells the engine and runs on to the view when paused beyond the head', async () => {
    const { e, s } = await make();
    e.history(600);
    s.seek(600);
    s.setWindDirection('w1', 180); // at 600
    for (let t = 660; t <= 1800; t += 60) e.snapshot(t); // the engine's run with the change
    e.time = 1800;
    s.seek(1500);
    e.calls.length = 0;
    s.removeWindDirection('w1');
    expect(e.names()).toEqual(['removeEdit', 'run']);
    expect(e.calls[0]!.args).toEqual(['w1']);
    expect(s.snapshots.headTime()).toBe(600); // not 1500
    expect(s.state.get().headTime).toBe(600);
    expect(s.state.get().edits).toEqual([]);
    expect(s.state.get().reviewing).toBe(false);
    expect(e.calls[1]!.args).toEqual([1500]); // the picture on screen is re-computed without pressing Play
    s.dispose();
  });

  it('the engine\'s own report after the removal cuts at the checkpoint it went back to, even before the view', async () => {
    const { e, s } = await make();
    e.history(600);
    s.seek(600);
    s.setWindDirection('w1', 180);
    for (let t = 660; t <= 1800; t += 60) e.snapshot(t);
    e.time = 1800;
    s.seek(1200);
    s.removeWindDirection('w1');
    for (let t = 660; t <= 1800; t += 60) e.snapshot(t); // the engine's run without the change arrives
    s.seek(1500);
    e.emit('rewound', 600);
    expect(s.snapshots.headTime()).toBe(600);
    s.dispose();
  });

  it('a change that has not started yet cuts nothing and does not need a re-run', async () => {
    const { e, s } = await make();
    e.history(600);
    s.seek(600);
    s.setWindDirection('later', 90, 3000);
    e.calls.length = 0;
    s.removeWindDirection('later');
    expect(e.names()).toEqual(['removeEdit']);
    expect(s.state.get().headTime).toBe(600);
    expect(s.state.get().edits).toEqual([]);
    s.dispose();
  });

  it('an unknown id (or a change already removed) does nothing', async () => {
    const { e, s } = await make();
    e.history(600);
    s.seek(600);
    e.calls.length = 0;
    s.removeWindDirection('nobody');
    expect(e.calls).toEqual([]);
    s.setWindDirection('w1', 180);
    s.removeWindDirection('w1');
    e.calls.length = 0;
    s.removeWindDirection('w1');
    expect(e.calls).toEqual([]);
    s.dispose();
  });
});

describe('the forecast cards after a change', () => {
  const card = (id: string, kind: Insight['kind'], time: number): Insight => ({ id, kind, severity: kind === 'wind-change' ? 'danger' : 'info', time, x: 0, y: 0, title: id, body: '', factors: [] });
  const early = card('early', 'wind-change', 900); // a forecast swing at 900 s
  const late = card('late', 'wind-change', 3600); // and one at 3600 s
  const peak = card('peak', 'afternoon-peak', 3600); // a forecast card that is not about the wind direction
  class WithForecast extends FakeEngine {
    override async init(): Promise<Insight[]> {
      return [early, late, peak];
    }
  }
  async function makeWith(edits: ScenarioEdit[] = []): Promise<{ e: FakeEngine; s: SimSession }> {
    const e = new WithForecast();
    const s = new SimSession(sc(edits), e, nullView, { maxBytes: 1e9 });
    await s.start();
    e.history(600);
    s.seek(600);
    return { e, s };
  }
  const ids = (xs: Insight[]): string[] => xs.map((i) => i.id).sort();

  it('lists and marks every forecast card while there is no change', async () => {
    const { s } = await makeWith();
    expect(ids(s.visibleInsights())).toEqual(['early', 'late', 'peak']);
    expect(ids(s.mapInsights())).toEqual(['early', 'late', 'peak']);
    s.dispose();
  });

  it('drops the wind-change cards from the first change on, and keeps the ones before it and the other kinds', async () => {
    const { s } = await makeWith();
    s.setWindDirection('w1', 180, 1200); // starts after the swing at 900 s and before the one at 3600 s
    expect(ids(s.visibleInsights())).toEqual(['early', 'peak']);
    expect(ids(s.mapInsights())).toEqual(['early', 'peak']);
    s.setWindDirection('w0', 90, 600); // an earlier change: now it replaces both
    expect(ids(s.visibleInsights())).toEqual(['peak']);
    expect(ids(s.mapInsights())).toEqual(['peak']);
    s.dispose();
  });

  it('brings them back when the last change is removed', async () => {
    const { s } = await makeWith();
    s.setWindDirection('w1', 180, 600);
    expect(ids(s.visibleInsights())).toEqual(['peak']);
    s.removeWindDirection('w1');
    expect(ids(s.visibleInsights())).toEqual(['early', 'late', 'peak']);
    expect(ids(s.mapInsights())).toEqual(['early', 'late', 'peak']);
    s.dispose();
  });

  it('is the same for a change that came with the scenario', async () => {
    const e = new WithForecast();
    const s = new SimSession(sc([{ kind: 'windDirection', id: 'given', dir: 200, time: 600 }]), e, nullView, { maxBytes: 1e9 });
    await s.start();
    expect(ids(s.visibleInsights())).toEqual(['peak']);
    s.dispose();
  });
});

describe('madeAt (0.7.0)', () => {
  it('is the view time the person pressed Apply at, whatever the start, and never after the start', async () => {
    const { e, s } = await make();
    e.history(700);
    s.seek(600);
    expect(s.setWindDirection('a', 180)!.madeAt).toBe(600); // now
    const later = s.setWindDirection('b', 90, 3000)!;
    expect(later).toMatchObject({ time: 3000, madeAt: 600 }); // for later: counted by the engine from now
    s.seek(660);
    expect(s.setWindDirection('c', 90, 1200)!.madeAt).toBe(s.state.get().viewTime); // the view had moved on: the time of this Apply
    for (const x of windDirectionEdits(s.state.get().edits)) expect(x.madeAt!).toBeLessThanOrEqual(x.time);
    s.dispose();
  });

  it('with the view in the past it is the view time the engine was rewound to, and it is what the engine is sent', async () => {
    const { e, s } = await make();
    e.history(1800);
    s.seek(600);
    const edit = s.setWindDirection('w1', 180, 1500)!;
    expect(edit.madeAt).toBe(600);
    expect(sent(e)[1]).toEqual({ name: 'edit', args: [edit, 1500] });
    expect((sent(e)[1]!.args[0] as WindDirectionEdit).madeAt).toBe(600);
    s.dispose();
  });

  it('is no part of the weather the top bar and the Weather tab read', async () => {
    const { e, s, scenario } = await make();
    e.history(600);
    s.seek(600);
    s.setWindDirection('w1', 180, 1200);
    const a = s.windWeather();
    const plain = windDirectionEdits(s.state.get().edits).map((x) => ({ kind: x.kind, id: x.id, dir: x.dir, time: x.time }) as WindDirectionEdit);
    expect(a).toEqual(applyWindDirection(scenario.weather, scenario.startTime, plain));
    s.dispose();
  });
});

describe('backToForecast', () => {
  const reading: ScenarioEdit = { kind: 'wind', id: 'belt-kit-1', x: 0, y: 0, radius: 800, speed: 5, dir: 84, time: 0 };

  it('with no change it removes nothing, sends nothing and returns 0', async () => {
    const { e, s } = await make();
    e.history(600);
    s.seek(600);
    s.edit(reading);
    e.calls.length = 0;
    expect(s.backToForecast()).toBe(0);
    expect(e.calls).toEqual([]);
    expect(s.state.get().edits.map((x) => x.edit.id)).toEqual(['belt-kit-1']);
    s.dispose();
  });

  it('removes every change, earliest first whatever the order they were made in, and keeps a belt-kit reading; the number is what it removed', async () => {
    const { e, s, scenario } = await make();
    e.history(600);
    s.seek(600);
    s.setWindDirection('late', 90, 2400);
    s.edit(reading);
    s.setWindDirection('early', 180, 1200);
    expect(s.windWeather()).not.toBe(scenario.weather);
    e.calls.length = 0;
    expect(s.backToForecast()).toBe(2);
    expect(e.calls.filter((c) => c.name === 'removeEdit').map((c) => c.args[0])).toEqual(['early', 'late']); // earliest start first; the reading is not sent
    expect(s.state.get().edits.map((x) => x.edit.id)).toEqual(['belt-kit-1']);
    expect(s.windWeather()).toBe(scenario.weather); // the forecast object again
    s.dispose();
  });

  it('cuts the results at the EARLIEST start (not the view, not the later change), tells the history and runs on to the view when paused beyond the head', async () => {
    const { e, s } = await make();
    e.history(600);
    s.seek(600);
    s.setWindDirection('first', 180); // at 600
    s.setWindDirection('second', 90, 1200);
    for (let t = 660; t <= 2400; t += 60) e.snapshot(t);
    e.time = 2400;
    s.seek(1800);
    expect(s.state.get().headTime).toBe(2400);
    e.calls.length = 0;
    expect(s.backToForecast()).toBe(2);
    expect(e.names()).toEqual(['removeEdit', 'removeEdit', 'run']);
    expect(e.calls[2]!.args).toEqual([1800]); // the picture on screen is re-computed without pressing Play
    expect(s.snapshots.headTime()).toBe(600);
    expect(s.state.get().headTime).toBe(600);
    expect(s.state.get().reviewing).toBe(false);
    s.dispose();
  });

  it('changes that have not started cut nothing and need no re-run; the engine\'s own rewind report after a removal cuts at the earliest start, even before the view', async () => {
    const { e, s } = await make();
    e.history(600);
    s.seek(600);
    s.setWindDirection('a', 90, 3000);
    s.setWindDirection('b', 180, 3600);
    e.calls.length = 0;
    expect(s.backToForecast()).toBe(2);
    expect(e.names()).toEqual(['removeEdit', 'removeEdit']);
    expect(s.state.get().headTime).toBe(600);
    // started ones: the report of the rewind names the first start
    s.setWindDirection('c', 180);
    for (let t = 660; t <= 1800; t += 60) e.snapshot(t);
    e.time = 1800;
    s.seek(1200);
    expect(s.backToForecast()).toBe(1);
    for (let t = 660; t <= 1800; t += 60) e.snapshot(t); // the engine's run without the change arrives
    s.seek(1500);
    e.emit('rewound', 600);
    expect(s.snapshots.headTime()).toBe(600);
    s.dispose();
  });

  it('takes the forecast cards of the wind back, as removing the last change does', async () => {
    const card = (id: string, time: number): Insight => ({ id, kind: 'wind-change', severity: 'danger', time, x: 0, y: 0, title: id, body: '', factors: [] });
    class WithForecast extends FakeEngine {
      override async init(): Promise<Insight[]> {
        return [card('early', 900), card('late', 3600)];
      }
    }
    const e = new WithForecast();
    const s = new SimSession(sc(), e, nullView, { maxBytes: 1e9 });
    await s.start();
    e.history(600);
    s.seek(600);
    s.setWindDirection('a', 180, 600);
    s.setWindDirection('b', 90, 1500);
    expect(s.visibleInsights().map((i) => i.id)).toEqual([]);
    s.backToForecast();
    expect(s.visibleInsights().map((i) => i.id).sort()).toEqual(['early', 'late']);
    s.dispose();
  });
});

describe('backToForecast with the real engine (in-thread controller)', () => {
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  async function until(pred: () => boolean, what: string, ms = 120000): Promise<void> {
    const t0 = Date.now();
    while (!pred()) {
      if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${what}`);
      await sleep(5);
    }
  }
  beforeEach(() => {
    // the session's own loop and the fast-forward need a frame clock
    g.requestAnimationFrame = (cb: (n: number) => void): number => setTimeout(() => cb(performance.now()), 16) as unknown as number;
    g.cancelAnimationFrame = (id: number): void => clearTimeout(id as unknown as NodeJS.Timeout);
  });

  const scenario = (): ScenarioData => ({
    ...syntheticScenario({ windFromDeg: 270, windKmh: 36, slopeDeg: 0, extent: 2000, duration: 3600, ignitions: [pointIgnition('a', -400, 0, 0, 60)], options: { snapshotInterval: 60 } }),
  });
  async function open(): Promise<SimSession> {
    const s = new SimSession(scenario(), new LocalSimController({ chunkMs: 30, simulation: { minSnapshotWallMs: 0 } }), nullView, { maxBytes: 1e9 });
    await s.start();
    return s;
  }
  async function reach(s: SimSession, t: number): Promise<void> {
    s.seek(t);
    await until(() => s.state.get().seekTarget === null && s.state.get().headTime >= t - 1e-6, `the head at ${t}`);
  }
  /** What the engine reported at `t` in the parts that are the physics (the store keeps the air and the fire's diagnostic fields of an old picture thinner, so only the newest one is compared in those). */
  const physics = (s: SimSession, t: number, newest = false): string => {
    const p = snapshotPartHashes(s.snapshots.at(t)!);
    return JSON.stringify(['time', 'moisture', 'embers', 'spotFires', 'stats', 'fire.arrivalTime', 'fire.burnState', ...(newest ? ['atmosphere', 'fire.ros', 'fire.intensity'] : [])].map((k) => [k, p[k]]));
  };

  it('two changes then Back to the forecast equals a run that never had them, with one checkpoint restore', async () => {
    const s = await open();
    const control = await open();
    try {
      await reach(s, 600);
      s.setWindDirection('w1', 180, 660);
      s.setWindDirection('w2', 90, 900); // cuts the first turn: done at 1800
      await reach(s, 1800);
      expect(s.snapshots.at(1800)!.stats.weather.windDir10).toBeCloseTo(90, 6); // the changes are in force
      const before = s.snapshots.latest()!.engine?.perf?.reruns.restores ?? 0;
      expect(s.backToForecast()).toBe(2);
      expect(s.state.get().edits).toEqual([]);
      await until(() => s.state.get().headTime >= 1800 - 1e-6, 're-run up to the view');
      await reach(control, 1800);
      expect(s.snapshots.at(1800)!.stats.weather.windDir10).toBeCloseTo(270, 6);
      for (const t of [660, 900, 1200, 1500]) expect(physics(s, t), `t=${t}`).toBe(physics(control, t));
      expect(physics(s, 1800, true)).toBe(physics(control, 1800, true));
      expect((s.snapshots.latest()!.engine?.perf?.reruns.restores ?? 0) - before).toBe(1);
    } finally {
      s.dispose();
      control.dispose();
    }
  }, 300000);
});
