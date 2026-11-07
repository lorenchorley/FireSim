/**
 * `SimSession.restart` (0.8.0, workstream J: "Continue on this device"): the run starts over after its engine was replaced. What the old
 * engine computed is dropped (pictures, cards, the error, the Air slice recording, the pace and revealed bookkeeping), what the person
 * marked and chose stays, and the clock is stopped at 0. Tested here directly with a scripted engine; src/ui/desktopRestart.test.ts
 * has the whole step (the new engine, the marks in their order) on top of it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CellExplanation, Ignition, Insight, ScenarioData, ScenarioEdit, SimSnapshot } from '../core/types';
import type { SceneViewApi } from '../render/api';
import type { SimController, SimEvents, SimOptionKey } from '../sim/protocol';
import { syntheticScenario } from '../sim/testing/scenarios';
import { SimSession } from './session';
import { Emitter } from './store';

class Engine implements SimController {
  readonly ev = new Emitter<SimEvents>();
  readonly calls: string[] = [];
  async init(): Promise<Insight[]> {
    return [];
  }
  run(until: number): void {
    this.calls.push(`run ${until}`);
  }
  pause(): void {
    this.calls.push('pause');
  }
  ignite(): void {}
  edit(): void {}
  removeEdit(): void {}
  removeIgnition(): void {}
  rewind(): void {}
  setOption(_k: SimOptionKey, _v: number | boolean): void {}
  setQuality(): void {}
  async explain(): Promise<CellExplanation> {
    return {} as CellExplanation;
  }
  on<K extends keyof SimEvents>(e: K, cb: SimEvents[K]): () => void {
    return this.ev.on(e, cb);
  }
  dispose(): void {}
  snapshot(time: number, insights: Insight[] = [], engine?: unknown): void {
    this.ev.emit('snapshot', { time, insights, spotFires: [], stats: { time }, engine } as unknown as SimSnapshot);
  }
}

const insight = (id: string, time: number): Insight => ({ id, kind: 'fire-start', severity: 'info', time, x: 0, y: 0, title: id, body: '' }) as unknown as Insight;

const recorder = { cleared: 0, record: () => undefined, clear(): void { this.cleared++; }, truncateAfter: () => undefined };
const view = new Proxy({}, { get: (_t, key) => (key === 'sliceRecording' ? recorder : () => null) }) as unknown as SceneViewApi;

const g = globalThis as { requestAnimationFrame?: unknown; cancelAnimationFrame?: unknown };
let savedRaf: unknown;
let savedCaf: unknown;
beforeEach(() => {
  recorder.cleared = 0;
  savedRaf = g.requestAnimationFrame;
  savedCaf = g.cancelAnimationFrame;
  g.requestAnimationFrame = (): number => 1;
  g.cancelAnimationFrame = (): void => undefined;
});
afterEach(() => {
  g.requestAnimationFrame = savedRaf;
  g.cancelAnimationFrame = savedCaf;
});

async function make(scenario: ScenarioData = syntheticScenario({ duration: 7200 })): Promise<{ e: Engine; s: SimSession }> {
  const e = new Engine();
  const s = new SimSession(scenario, e, view, { maxBytes: 1e9 });
  await s.start();
  return { e, s };
}

const wind = (id: string): ScenarioEdit => ({ kind: 'wind', id, x: 0, y: 0, radius: 300, speed: 8, dir: 200, time: 0 });
const fire = (id: string): Ignition => ({ id, kind: 'point', points: [[10, 10]], radius: 40, origin: 'observed' }) as Ignition;

describe('SimSession.restart', () => {
  it('drops what the engine computed: the pictures, the cards, the error, the clock; and stops playing', async () => {
    const { e, s } = await make();
    s.play();
    e.snapshot(0, [insight('card-1', 0)], { tier: 'high' });
    e.snapshot(600, [insight('card-2', 300)]);
    s.seek(600);
    e.ev.emit('error', 'The desktop connection closed.');
    expect(s.state.get()).toMatchObject({ headTime: 600, error: 'The desktop connection closed.' });
    expect(s.snapshots.size).toBeGreaterThan(0);
    expect(s.engineInfo()).not.toBeNull();

    s.restart();

    expect(s.state.get()).toMatchObject({
      viewTime: 0,
      headTime: 0,
      playing: false,
      snapshot: null,
      reviewing: false,
      computing: false,
      workerSpeed: 0,
      insights: [],
      forecastInsights: [],
      compare: null,
      error: null,
      seekTarget: null,
    });
    expect(s.snapshots.size).toBe(0);
    expect(s.engineInfo()).toBeNull(); // the report of the old engine is not the new engine's
    expect(recorder.cleared).toBe(1); // the pinned Air slice line starts over too
    s.dispose();
  });

  it('keeps what the person marked and chose: ignitions, scenario edits, options, display step, solver step and speed', async () => {
    const { s } = await make();
    s.ignite(fire('fire-a'));
    s.edit(wind('wind-1'));
    s.setTimeStep(120);
    s.setSolverStep(6);
    s.setSpeed(60);
    const before = s.state.get();

    s.restart();

    const after = s.state.get();
    expect(after.ignitions).toEqual(before.ignitions);
    expect(after.edits).toEqual(before.edits);
    expect(after.options).toEqual(before.options);
    expect(after.timeStep).toBe(120);
    expect(after.solverStep).toBe(6);
    expect(after.speed).toBe(60);
    s.dispose();
  });

  it('stops the engine it was running (a pause is sent, once) and a fast-forward in progress ends where it is', async () => {
    const { e, s } = await make();
    e.snapshot(0);
    s.seek(3600); // beyond what is computed: a fast-forward
    expect(s.state.get().seekTarget).toBe(3600);
    const pauses = e.calls.filter((c) => c === 'pause').length;
    s.restart();
    expect(e.calls.filter((c) => c === 'pause').length).toBe(pauses + 1);
    expect(s.state.get().seekTarget).toBeNull();
    expect(s.state.get().seekProgress).toBe(0);
    s.dispose();
  });

  it('what was asked of the old engine is forgotten: the next play asks the new engine to run from the start', async () => {
    const { e, s } = await make();
    s.play();
    expect(e.calls.some((c) => c.startsWith('run '))).toBe(true);
    e.snapshot(0);
    e.snapshot(600);
    s.restart();
    const asked = e.calls.length;
    s.play();
    const run = e.calls.slice(asked).find((c) => c.startsWith('run '));
    expect(run).toBeDefined(); // a run call goes out at once, not held back because the old one reached further
    expect(s.state.get().playing).toBe(true);
    s.dispose();
  });

  it('a card of the same id is new in the restarted run (it is revealed, and counted, again)', async () => {
    const { e, s } = await make();
    const revealed: string[] = [];
    s.events.on('reveal', (i) => revealed.push(i.id));
    e.snapshot(0);
    e.snapshot(600, [insight('card-1', 300)]);
    s.seek(600);
    expect(revealed).toEqual(['card-1']);
    s.restart();
    e.snapshot(0);
    e.snapshot(600, [insight('card-1', 300)]);
    s.seek(600);
    expect(revealed).toEqual(['card-1', 'card-1']);
    s.dispose();
  });

  it('the pictures of the new engine are taken as the first of the run (time 0 is accepted again, after a restart from a later time)', async () => {
    const { e, s } = await make();
    e.snapshot(0);
    e.snapshot(900);
    s.seek(900);
    expect(s.state.get().headTime).toBe(900);
    s.restart();
    e.snapshot(0);
    expect(s.state.get().headTime).toBe(0);
    expect(s.state.get().snapshot).not.toBeNull();
    e.snapshot(60);
    expect(s.state.get().headTime).toBe(60);
    s.dispose();
  });

  it('is safe to call on a run that never had anything (nothing computed, nothing marked)', async () => {
    const { s } = await make();
    expect(() => s.restart()).not.toThrow();
    expect(() => s.restart()).not.toThrow();
    expect(s.state.get()).toMatchObject({ viewTime: 0, headTime: 0, snapshot: null, error: null });
    s.dispose();
  });
});
