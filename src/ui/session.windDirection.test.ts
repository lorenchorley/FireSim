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
import { WIND_TURN_S, windDirectionEdits } from '../scenario/windDirection';
import { syntheticScenario } from '../sim/testing/scenarios';
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
    expect(edit).toEqual({ kind: 'windDirection', id: 'w1', dir: 180, time: 600 });
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
