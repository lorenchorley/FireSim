/**
 * "Continue on this device" (src/ui/desktopRestart.ts): what a restart is made of (the scenario, the person's marks, their order, the
 * options that differ), and the whole step through the real session and the run's switchable controller with scripted engines: the
 * desktop's engine is cut, nothing happens by itself, the tap starts the same scenario again on a fresh engine with the marks in their
 * original order and times, and nothing of the desktop's run is left.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CellExplanation, Ignition, Insight, QualityTier, ScenarioData, ScenarioEdit, SimSnapshot } from '../core/types';
import type { SceneViewApi } from '../render/api';
import type { SimController, SimEvents, SimOptionKey } from '../sim/protocol';
import { pointIgnition, syntheticScenario } from '../sim/testing/scenarios';
import { applyPlan, continueOnDevice, restartPlan, START_TIMEOUT_MS, type RestartInput } from './desktopRestart';
import { RESTARTED_HERE } from './desktopWords';
import { SwitchableController } from './runController';
import { SimSession } from './session';
import { Emitter } from './store';

const fuel = (id: string, setType = 1): ScenarioEdit => ({ kind: 'fuel', id, shape: { kind: 'circle', x: 0, y: 0, radius: 50 }, setType: setType as never });
const wind = (id: string, time: number): ScenarioEdit => ({ kind: 'wind', id, x: 0, y: 0, radius: 300, speed: 8, dir: 200, time });
const turn = (id: string, time: number): ScenarioEdit => ({ kind: 'windDirection', id, dir: 180, time, madeAt: 0 });
const OPTIONS = { coupling: 1, embers: true, mountainPhenomena: true };

function input(over: Partial<RestartInput> = {}): RestartInput {
  const scenario = syntheticScenario({ duration: 7200 });
  return { scenario, ignitions: scenario.ignitions, edits: scenario.edits.map((edit) => ({ edit, time: 0 })), options: { ...OPTIONS }, timeStep: scenario.options.snapshotInterval, solverStep: 0, order: new Map(), ...over };
}

describe('restartPlan: what the new engine is given', () => {
  it('a run with nothing marked and nothing changed restarts as the scenario itself, with nothing sent behind it', () => {
    const i = input();
    const p = restartPlan(i);
    expect(p.scenario).toBe(i.scenario);
    expect(p.steps).toEqual([]);
  });

  it('sends the options that differ from the scenario, and only those', () => {
    const i = input({ options: { coupling: 0.5, embers: true, mountainPhenomena: false }, timeStep: 120, solverStep: 6 });
    expect(restartPlan(i).steps).toEqual([
      { type: 'setOption', key: 'coupling', value: 0.5 },
      { type: 'setOption', key: 'mountainPhenomena', value: false },
      { type: 'setOption', key: 'snapshotInterval', value: 120 },
      { type: 'setOption', key: 'maxStepS', value: 6 },
    ]);
    // a scenario that came with its own step limit: the same value is not sent again
    const sc = syntheticScenario({ options: { maxStepS: 6 } });
    expect(restartPlan(input({ scenario: sc, ignitions: sc.ignitions, solverStep: 6 })).steps).toEqual([]);
    expect(restartPlan(input({ scenario: sc, ignitions: sc.ignitions, solverStep: 0 })).steps).toEqual([{ type: 'setOption', key: 'maxStepS', value: 0 }]);
  });

  it('re-applies the marks the person added, each with its own time, in the order the calls were made (two at the same time keep their order)', () => {
    const a = pointIgnition('a', 10, 10, 600);
    const b = pointIgnition('b', 20, 20, 600);
    const f = fuel('f');
    const w = turn('w', 1800);
    const i = input({
      ignitions: [a, b],
      edits: [
        { edit: f, time: 600 },
        { edit: w, time: 1800 },
      ],
      order: new Map([['a', 0], ['f', 1], ['b', 2], ['w', 3]]),
    });
    expect(restartPlan(i).steps).toEqual([
      { type: 'ignite', ignition: a },
      { type: 'edit', edit: f, time: 600 },
      { type: 'ignite', ignition: b },
      { type: 'edit', edit: w, time: 1800 },
    ]);
    // the other order of the same marks comes out the other way round: the call numbers decide, not the kind of mark
    const j = input({ ...i, order: new Map([['f', 0], ['w', 1], ['b', 2], ['a', 3]]) });
    expect(restartPlan(j).steps.map((s) => (s.type === 'ignite' ? s.ignition.id : s.type === 'edit' ? s.edit.id : '?'))).toEqual(['f', 'w', 'b', 'a']);
  });

  it('an edit sent again (same id) is re-applied once, from the time it was sent again, after what came between', () => {
    const f2 = fuel('f', 2);
    const b = pointIgnition('b', 0, 0, 0);
    const i = input({ ignitions: [b], edits: [{ edit: f2, time: 300 }], order: new Map([['b', 1], ['f', 2]]) });
    expect(restartPlan(i).steps).toEqual([
      { type: 'ignite', ignition: b },
      { type: 'edit', edit: f2, time: 300 },
    ]);
  });

  it('marks without a call number (should not happen) go last: ignitions first, then edits, each in list order', () => {
    const a = pointIgnition('a', 0, 0, 0);
    const b = pointIgnition('b', 0, 0, 0);
    const f = fuel('f');
    const g = fuel('g');
    const p = restartPlan(input({ ignitions: [a, b], edits: [{ edit: f, time: 0 }, { edit: g, time: 0 }], order: new Map([['g', 0]]) }));
    expect(p.steps.map((s) => (s.type === 'ignite' ? s.ignition.id : s.type === 'edit' ? s.edit.id : '?'))).toEqual(['g', 'a', 'b', 'f']);
  });

  it('the scenario\'s own marks come back with the scenario, not as steps; one the person removed does not come back at all', () => {
    const own = pointIgnition('own', 1, 1, 0);
    const ownEdit = wind('belt', 0);
    const goneIgnition = pointIgnition('gone', 2, 2, 0);
    const goneEdit = wind('goneWind', 900);
    const sc = { ...syntheticScenario({ duration: 7200 }), ignitions: [own, goneIgnition], edits: [ownEdit, goneEdit] };
    const mine = pointIgnition('mine', 3, 3, 120);
    const p = restartPlan({ scenario: sc, ignitions: [own, mine], edits: [{ edit: ownEdit, time: 0 }], options: { ...OPTIONS }, timeStep: sc.options.snapshotInterval, solverStep: 0, order: new Map([['mine', 0]]) });
    expect(p.scenario).not.toBe(sc);
    expect(p.scenario.ignitions).toEqual([own]);
    expect(p.scenario.edits).toEqual([ownEdit]);
    expect(p.scenario.terrain).toBe(sc.terrain); // the same data, not a copy
    expect(p.steps).toEqual([{ type: 'ignite', ignition: mine }]);
    expect(sc.ignitions).toHaveLength(2); // the session's own scenario is not touched
    expect(sc.edits).toHaveLength(2);
  });

  it('a scenario edit the person sent again keeps the original in the scenario and re-applies the new one from its time', () => {
    const orig = wind('belt', 0);
    const again = { ...orig, speed: 3, time: 1200 } as ScenarioEdit;
    const sc = { ...syntheticScenario({ duration: 7200 }), edits: [orig] };
    const p = restartPlan({ scenario: sc, ignitions: [], edits: [{ edit: again, time: 1200 }], options: { ...OPTIONS }, timeStep: sc.options.snapshotInterval, solverStep: 0, order: new Map([['belt', 4]]) });
    expect(p.scenario).toBe(sc);
    expect(p.steps).toEqual([{ type: 'edit', edit: again, time: 1200 }]);
  });

  it('applyPlan sends the steps to an engine in the order given', () => {
    const calls: string[] = [];
    const c = { setOption: (k: string) => calls.push(`opt ${k}`), ignite: (i: Ignition) => calls.push(`ign ${i.id}`), edit: (e: ScenarioEdit, t: number) => calls.push(`edit ${e.id} ${t}`) } as unknown as SimController;
    applyPlan(c, [
      { type: 'setOption', key: 'coupling', value: 0 },
      { type: 'ignite', ignition: pointIgnition('a', 0, 0) },
      { type: 'edit', edit: fuel('f'), time: 5 },
    ]);
    expect(calls).toEqual(['opt coupling', 'ign a', 'edit f 5']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// The whole step, through the real session
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

class Engine implements SimController {
  readonly ev = new Emitter<SimEvents>();
  readonly calls: unknown[][] = [];
  disposed = 0;
  failInit = false;
  constructor(readonly name: string) {}
  async init(s: ScenarioData): Promise<Insight[]> {
    this.calls.push(['init', s.ignitions.length, s.edits.length]);
    if (this.failInit) throw new Error('init failed');
    this.ev.emit('ready', []);
    return [];
  }
  run(u: number): void {
    this.calls.push(['run', u]);
  }
  pause(): void {
    this.calls.push(['pause']);
  }
  ignite(i: Ignition): void {
    this.calls.push(['ignite', i.id, i.time]);
  }
  edit(e: ScenarioEdit, t: number): void {
    this.calls.push(['edit', e.id, t]);
  }
  removeEdit(id: string): void {
    this.calls.push(['removeEdit', id]);
  }
  removeIgnition(id: string): void {
    this.calls.push(['removeIgnition', id]);
  }
  rewind(t: number): void {
    this.calls.push(['rewind', t]);
  }
  setOption(k: SimOptionKey, v: number | boolean): void {
    this.calls.push(['setOption', k, v]);
  }
  setQuality(t: QualityTier): void {
    this.calls.push(['setQuality', t]);
  }
  async explain(): Promise<CellExplanation> {
    return {} as CellExplanation;
  }
  on<K extends keyof SimEvents>(e: K, cb: SimEvents[K]): () => void {
    return this.ev.on(e, cb);
  }
  dispose(): void {
    this.disposed++;
  }
  snapshot(time: number, insights: Insight[] = []): void {
    this.ev.emit('snapshot', { time, insights, spotFires: [], stats: { time } } as unknown as SimSnapshot);
  }
}

const insight = (id: string, time: number): Insight => ({ id, kind: 'fire-start', severity: 'info', time, x: 0, y: 0, title: id, body: '' }) as unknown as Insight;
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

async function desktopRun(): Promise<{ desktop: Engine; proxy: SwitchableController; session: SimSession; scenario: ScenarioData }> {
  const desktop = new Engine('desktop');
  const proxy = new SwitchableController(desktop);
  const scenario = syntheticScenario({ duration: 7200 });
  const session = new SimSession(scenario, proxy, nullView, { maxBytes: 1e9 });
  await session.start();
  return { desktop, proxy, session, scenario };
}

describe('continueOnDevice, through the real session', () => {
  it('the desktop is cut: nothing switches by itself; the tap restarts the same scenario on a fresh engine with the marks in their order and times, and says so', async () => {
    const { desktop, proxy, session } = await desktopRun();
    // the person marks, at the start: a fire, a fuel brush, a second fire (same time), and a wind change that starts later; and changes two options
    session.ignite({ id: 'fire-a', kind: 'point', points: [[10, 10]], radius: 40, origin: 'observed' });
    session.edit(fuel('brush-1'));
    session.ignite({ id: 'fire-b', kind: 'point', points: [[30, 30]], radius: 40, origin: 'observed' });
    session.setWindDirection('turn-1', 200, 1800);
    session.setTimeStep(120);
    session.setSolverStep(6);
    desktop.snapshot(0, [insight('card-1', 0)]);
    desktop.snapshot(600, [insight('card-2', 300)]);
    session.seek(600);
    // the link is lost
    desktop.ev.emit('error', 'The desktop connection closed.');
    expect(session.state.get().error).toBe('The desktop connection closed.');
    expect(session.state.get().headTime).toBe(600);
    // never automatic: nothing was asked of any other engine, the picture and the error stay
    expect(proxy.inner).toBe(desktop);
    expect(session.state.get().snapshot).not.toBeNull();

    const local = new Engine('local');
    const said: string[] = [];
    await continueOnDevice({ session, proxy, makeController: () => local, announce: (m) => said.push(m) });

    expect(proxy.inner).toBe(local);
    expect(desktop.disposed).toBe(1);
    expect(said).toEqual([RESTARTED_HERE]);
    // the scenario is initialised as it came (no mark of its own was removed), then the options, then the marks in the order they were made
    expect(local.calls.filter((c) => c[0] !== 'pause')).toEqual([
      ['init', 0, 0],
      ['setOption', 'snapshotInterval', 120],
      ['setOption', 'maxStepS', 6],
      ['ignite', 'fire-a', 0],
      ['edit', 'brush-1', 0],
      ['ignite', 'fire-b', 0],
      ['edit', 'turn-1', 1800],
    ]);
    // the desktop's run is not in the new one: no picture, no cards, no error, back at time 0 and paused; the marks are still the person's
    const s = session.state.get();
    expect(s).toMatchObject({ viewTime: 0, headTime: 0, playing: false, snapshot: null, error: null, insights: [], forecastInsights: [], computing: false });
    expect(session.snapshots.size).toBe(0);
    expect(s.ignitions.map((i) => i.id)).toEqual(['fire-a', 'fire-b']);
    expect(s.edits.map((e) => [e.edit.id, e.time])).toEqual([['brush-1', 0], ['turn-1', 1800]]);
    expect(s.timeStep).toBe(120);
    expect(s.solverStep).toBe(6);
    // and the session now listens to the new engine, through the same listeners
    local.snapshot(0, [insight('card-1', 0)]);
    expect(session.state.get().headTime).toBe(0);
    expect(session.state.get().insights.map((i) => i.id)).toEqual(['card-1']);
    local.ev.emit('error', 'a problem of this device');
    expect(session.state.get().error).toBe('a problem of this device');
    session.dispose();
  });

  it('a second restart (the person marks more on this device, the engine fails, they tap again) keeps the order as well', async () => {
    const { proxy, session } = await desktopRun();
    session.ignite({ id: 'one', kind: 'point', points: [[0, 0]], radius: 40, origin: 'observed' });
    const first = new Engine('first');
    await continueOnDevice({ session, proxy, makeController: () => first, announce: () => undefined });
    session.edit(fuel('two'));
    session.ignite({ id: 'three', kind: 'point', points: [[5, 5]], radius: 40, origin: 'observed' });
    const second = new Engine('second');
    await continueOnDevice({ session, proxy, makeController: () => second, announce: () => undefined });
    expect(second.calls.filter((c) => c[0] === 'ignite' || c[0] === 'edit').map((c) => c[1])).toEqual(['one', 'two', 'three']);
    session.dispose();
  });

  it('the scenario the desktop was given and the one this device gets are the same data: the person\'s own removed marks stay removed', async () => {
    const own = pointIgnition('own', 1, 1, 0);
    const scenario = { ...syntheticScenario({ duration: 7200 }), ignitions: [own] };
    const desktop = new Engine('desktop');
    const proxy = new SwitchableController(desktop);
    const session = new SimSession(scenario, proxy, nullView, { maxBytes: 1e9 });
    await session.start();
    session.removeIgnition('own');
    desktop.ev.emit('error', 'The desktop connection closed.');
    const local = new Engine('local');
    await continueOnDevice({ session, proxy, makeController: () => local, announce: () => undefined });
    expect(local.calls.find((c) => c[0] === 'init')).toEqual(['init', 0, 0]); // the removed fire is not in the new run
    expect(scenario.ignitions).toHaveLength(1); // the session's scenario is untouched
    session.dispose();
  });

  it('an engine that cannot be made, or that fails to start, leaves the desktop run exactly as it was: nothing is marked started, the error stays, the person may tap again', async () => {
    const { desktop, proxy, session } = await desktopRun();
    desktop.ev.emit('error', 'The desktop connection closed.');
    let started = 0;
    const said: string[] = [];
    const deps = { session, proxy, announce: (m: string) => said.push(m), started: () => void started++ };
    await expect(
      continueOnDevice({
        ...deps,
        makeController: () => {
          throw new Error('no engine');
        },
      }),
    ).rejects.toThrow('no engine');
    // an engine that is made but whose init rejects (the worker script cannot be fetched): it is thrown away, nothing of it reaches the run
    const bad = new Engine('bad');
    bad.failInit = true;
    await expect(continueOnDevice({ ...deps, makeController: () => bad })).rejects.toThrow('init failed');
    bad.ev.emit('error', 'init failed'); // a late word of the engine that failed: nobody listens
    expect(bad.disposed).toBe(1);
    expect(proxy.inner).toBe(desktop);
    expect(desktop.disposed).toBe(0);
    expect(started).toBe(0);
    expect(said).toEqual([]);
    expect(session.state.get().error).toBe('The desktop connection closed.'); // the chip still has its sentence, and the same action
    // the second tap, with a fresh engine, works
    const good = new Engine('good');
    await continueOnDevice({ ...deps, makeController: () => good });
    expect(proxy.inner).toBe(good);
    expect(desktop.disposed).toBe(1);
    expect(started).toBe(1);
    expect(said).toEqual([RESTARTED_HERE]);
    expect(session.state.get().error).toBeNull();
    session.dispose();
  });

  it('the standby engine is used first and not made again; if it fails, it is thrown away and the second tap makes a fresh one', async () => {
    const desktop = new Engine('desktop');
    const standby = new Engine('standby');
    const proxy = new SwitchableController(desktop, standby);
    const session = new SimSession(syntheticScenario({ duration: 7200 }), proxy, nullView, { maxBytes: 1e9 });
    await session.start();
    desktop.ev.emit('error', 'The desktop connection closed.');
    let made = 0;
    const makeController = (): Engine => (made++, new Engine('fresh'));
    standby.failInit = true;
    await expect(continueOnDevice({ session, proxy, makeController, announce: () => undefined })).rejects.toThrow('init failed');
    expect(made).toBe(0); // the standby was the one asked
    expect(standby.disposed).toBe(1);
    expect(proxy.standby).toBeNull(); // it is spent either way
    expect(proxy.inner).toBe(desktop);
    await continueOnDevice({ session, proxy, makeController, announce: () => undefined });
    expect(made).toBe(1); // the retry makes a fresh engine
    expect(proxy.inner).not.toBe(desktop);
    expect(desktop.disposed).toBe(1);
    session.dispose();
  });

  it('a standby that failed while it was idle is not asked at all: a fresh engine is made at once', async () => {
    const desktop = new Engine('desktop');
    const standby = new Engine('standby');
    const proxy = new SwitchableController(desktop, standby);
    const session = new SimSession(syntheticScenario({ duration: 7200 }), proxy, nullView, { maxBytes: 1e9 });
    await session.start();
    desktop.ev.emit('error', 'The desktop connection closed.');
    standby.ev.emit('error', 'simulation worker failed'); // its script could not be loaded
    const fresh = new Engine('fresh');
    await continueOnDevice({ session, proxy, makeController: () => fresh, announce: () => undefined });
    expect(standby.calls).toEqual([]); // never asked: it could not have answered
    expect(standby.disposed).toBe(1);
    expect(proxy.inner).toBe(fresh);
    session.dispose();
  });

  it('a standby that starts is the run\'s engine, with what it said while it started (ready, the first picture) heard by the session once it is committed', async () => {
    const desktop = new Engine('desktop');
    const standby = new Engine('standby');
    const proxy = new SwitchableController(desktop, standby);
    const session = new SimSession(syntheticScenario({ duration: 7200 }), proxy, nullView, { maxBytes: 1e9 });
    await session.start();
    desktop.ev.emit('error', 'The desktop connection closed.');
    const init = standby.init.bind(standby);
    standby.init = async (sc) => {
      const out = await init(sc);
      standby.snapshot(0, [insight('card-1', 0)]); // the first picture arrives with, or before, the answer of init
      return out;
    };
    await continueOnDevice({ session, proxy, makeController: () => new Engine('unused'), announce: () => undefined });
    expect(proxy.inner).toBe(standby);
    expect(session.state.get().insights.map((i) => i.id)).toEqual(['card-1']);
    expect(session.state.get().headTime).toBe(0);
    session.dispose();
  });

  it('an engine that never answers is given up on after the time given: the run is as it was, and the engine is thrown away', async () => {
    const { desktop, proxy, session } = await desktopRun();
    desktop.ev.emit('error', 'The desktop connection closed.');
    const silent = new Engine('silent');
    silent.init = () => new Promise<Insight[]>(() => undefined);
    await expect(continueOnDevice({ session, proxy, makeController: () => silent, announce: () => undefined, timeoutMs: 5 })).rejects.toThrow('This device did not answer in time.');
    expect(silent.disposed).toBe(1);
    expect(proxy.inner).toBe(desktop);
    expect(START_TIMEOUT_MS).toBeGreaterThan(30_000); // a slow device is given time; the sentence is for one that is stuck
    session.dispose();
  });

  it('revealed cards are counted again in the new run (a card of the same id is new there)', async () => {
    const { desktop, proxy, session } = await desktopRun();
    const revealed: string[] = [];
    session.events.on('reveal', (i) => revealed.push(i.id));
    desktop.snapshot(0);
    desktop.snapshot(600, [insight('card-1', 300)]);
    session.seek(600);
    expect(revealed).toEqual(['card-1']);
    const local = new Engine('local');
    await continueOnDevice({ session, proxy, makeController: () => local, announce: () => undefined });
    local.snapshot(0);
    local.snapshot(600, [insight('card-1', 300)]);
    session.seek(600);
    expect(revealed).toEqual(['card-1', 'card-1']);
    session.dispose();
  });
});
