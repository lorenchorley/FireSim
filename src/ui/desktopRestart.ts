/**
 * "Continue on this device" (0.8.0, workstream J; contract section 4, "Fallback to this device"). When the desktop engine is gone the
 * person may start the SAME scenario again on this device's own engine, from its start. Never automatic: the last picture stays until
 * the tap. The two engines cannot hand a running state to each other, so it is a restart, and it says so.
 *
 * What a restart is made of, and where each part is the page's single copy of it:
 *   - the scenario: `session.scenario`, the full `ScenarioData` (the desktop got a copy without the display-only context layers);
 *   - the person's fires, changes and options: the session's own state (`ignitions`, `edits` with the time each applies from,
 *     `options`, the display step and the solver step). Nothing is stored a second time;
 *   - the order they were made in: the controller of the run (runController.ts) numbers the calls, because the session keeps ignitions
 *     and edits in two lists.
 * The new engine is given the scenario without the marks of its own the person removed, then what the person added, in the order the
 * calls were made (the engine applies records in (time, call) order, so two marks at the same time come out as they did), each with
 * its own time, after the options that differ from the scenario's. Nothing of the desktop's run (pictures, cards, the error) is kept:
 * `SimSession.restart` drops it. The in-app engine decides its own tier.
 */
import type { Ignition, ScenarioData, ScenarioEdit } from '../core/types';
import type { SimController, SimOptionKey } from '../sim/protocol';
import { RESTARTED_HERE } from './desktopWords';
import type { SwitchableController } from './runController';
import type { SimSession } from './session';

export type RestartStep =
  | { type: 'setOption'; key: SimOptionKey; value: number | boolean }
  | { type: 'ignite'; ignition: Ignition }
  | { type: 'edit'; edit: ScenarioEdit; time: number };

export interface RestartInput {
  scenario: ScenarioData;
  ignitions: readonly Ignition[];
  edits: readonly { edit: ScenarioEdit; time: number }[];
  options: { coupling: number; embers: boolean; mountainPhenomena: boolean };
  /** The display step and the solver step limit (0 = automatic) in force. */
  timeStep: number;
  solverStep: number;
  /** id to call number: the order the marks were sent in. */
  order: ReadonlyMap<string, number>;
}

export interface RestartPlan {
  /** What the new engine is initialised with: the scenario itself unless the person removed a mark that came with it. */
  scenario: ScenarioData;
  /** What is sent right behind it, in this order. */
  steps: RestartStep[];
}

/** A mark that has no call number (it should not happen) goes after the numbered ones, ignitions first, in list order. */
const UNNUMBERED = 1e9;

export function restartPlan(i: RestartInput): RestartPlan {
  const sc = i.scenario;
  const ownIgnitions = new Set<Ignition>(sc.ignitions);
  const ownEdits = new Set<ScenarioEdit>(sc.edits);
  const ignitionIds = new Set(i.ignitions.map((x) => x.id));
  const editIds = new Set(i.edits.map((x) => x.edit.id));
  const ignitions = sc.ignitions.filter((x) => ignitionIds.has(x.id));
  const edits = sc.edits.filter((x) => editIds.has(x.id));
  const scenario = ignitions.length === sc.ignitions.length && edits.length === sc.edits.length ? sc : { ...sc, ignitions, edits };

  const steps: RestartStep[] = [];
  const option = (key: SimOptionKey, value: number | boolean, was: number | boolean): void => {
    if (value !== was) steps.push({ type: 'setOption', key, value });
  };
  option('coupling', i.options.coupling, sc.options.coupling);
  option('embers', i.options.embers, sc.options.embers);
  option('mountainPhenomena', i.options.mountainPhenomena, sc.options.mountainPhenomena);
  option('snapshotInterval', i.timeStep, sc.options.snapshotInterval);
  option('maxStepS', i.solverStep, sc.options.maxStepS ?? 0);

  const marks: { n: number; step: RestartStep }[] = [];
  i.ignitions.forEach((ignition, k) => {
    if (!ownIgnitions.has(ignition)) marks.push({ n: i.order.get(ignition.id) ?? UNNUMBERED + k, step: { type: 'ignite', ignition } });
  });
  i.edits.forEach(({ edit, time }, k) => {
    if (!ownEdits.has(edit)) marks.push({ n: i.order.get(edit.id) ?? 2 * UNNUMBERED + k, step: { type: 'edit', edit, time } });
  });
  marks.sort((a, b) => a.n - b.n);
  for (const m of marks) steps.push(m.step);
  return { scenario, steps };
}

/** Send the steps to an engine, in order. */
export function applyPlan(c: SimController, steps: readonly RestartStep[]): void {
  for (const s of steps) {
    if (s.type === 'setOption') c.setOption(s.key, s.value);
    else if (s.type === 'ignite') c.ignite(s.ignition);
    else c.edit(s.edit, s.time);
  }
}

export interface ContinueDeps {
  session: Pick<SimSession, 'scenario' | 'state' | 'restart'>;
  /** The run's controller, as `take` handed it out. */
  proxy: SwitchableController;
  /** A fresh in-app engine (the page's own `createController` choice, with This device chosen). May throw. */
  makeController(): SimController;
  announce(message: string): void;
}

/**
 * Switch the run to a fresh in-app engine and start it over: the controller's calls go to the new engine, the session drops what the
 * desktop computed, and the scenario is initialised with the person's marks sent behind it. Paused at the start: the person presses Play.
 * Rejects when no engine could be made; an engine that fails after that says so through its own error event, as any run does.
 */
export async function continueOnDevice(d: ContinueDeps): Promise<void> {
  const next = d.makeController();
  const s = d.session.state.get();
  const plan = restartPlan({ scenario: d.session.scenario, ignitions: s.ignitions, edits: s.edits, options: s.options, timeStep: s.timeStep, solverStep: s.solverStep, order: d.proxy.order });
  d.session.restart(); // its pause goes to the old engine
  d.proxy.switchTo(next);
  d.announce(RESTARTED_HERE);
  const ready = d.proxy.init(plan.scenario);
  applyPlan(d.proxy, plan.steps);
  await ready.catch(() => undefined);
}
