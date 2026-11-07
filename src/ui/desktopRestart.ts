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
  /** A fresh in-app engine (the page's `createLocalController`), for when the standby is gone or failed. May throw. */
  makeController(): SimController;
  announce(message: string): void;
  /** The new engine has started, just before the run is switched to it: the desktop gives its link up here (and not before). */
  started?(): void;
  /** How long the new engine may take to answer (ms). */
  timeoutMs?: number;
}

/** A start that does not answer in this long has failed (an engine whose script cannot be loaded says so at once; this is for one that says nothing). */
export const START_TIMEOUT_MS = 90_000;

/**
 * Start the run over on this device's engine, all or nothing. The engine is the standby made when the link opened (its script is already
 * here, so no network is needed), or a fresh one. It is started on the side: initialised with the scenario while the run goes on
 * showing what it showed and hearing the desktop's last word. Only when it has answered is the run switched: `started` is called (the
 * desktop gives its link up and the run is marked as started again here), the session drops what the desktop computed, the controller
 * points at the new engine, the person's marks are sent behind the scenario, and it is announced. If the engine fails, nothing was
 * changed: it is thrown away, the promise rejects, and the next try takes a fresh engine. Paused at the start: the person presses Play.
 */
export async function continueOnDevice(d: ContinueDeps): Promise<void> {
  const next = d.proxy.takeStandby() ?? d.makeController();
  const s = d.session.state.get();
  const plan = restartPlan({ scenario: d.session.scenario, ignitions: s.ignitions, edits: s.edits, options: s.options, timeStep: s.timeStep, solverStep: s.solverStep, order: d.proxy.order });
  d.proxy.stage(next);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      next.init(plan.scenario),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('This device did not answer in time.')), d.timeoutMs ?? START_TIMEOUT_MS);
      }),
    ]);
  } catch (e) {
    d.proxy.abandon();
    throw e;
  } finally {
    clearTimeout(timer);
  }
  d.started?.();
  d.session.restart(); // its pause goes to the old engine
  d.proxy.commit();
  applyPlan(d.proxy, plan.steps);
  d.announce(RESTARTED_HERE);
}
