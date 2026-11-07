/**
 * The controller of a run that was started on the desktop engine (0.8.0, workstream J). The session holds it for the whole run and
 * everything that listens to the engine listens to it; what it forwards to can change once, from the desktop link to a fresh in-app
 * engine ("Continue on this device", desktopRestart.ts), without anyone having to move a listener. It also keeps the order the
 * person's fires and changes were sent in (id to call number): the session keeps its ignitions and its edits in two lists, and only
 * the order of the calls says which came first when two were made at the same simulation time.
 * It changes no message and no result: every call is the target's own.
 */
import type { CellExplanation, Ignition, Insight, QualityTier, ScenarioData, ScenarioEdit } from '../core/types';
import type { SimController, SimEvents, SimOptionKey } from '../sim/protocol';
import { Emitter } from './store';

const EVENTS = ['ready', 'snapshot', 'status', 'error', 'rewound'] as const;

export class SwitchableController implements SimController {
  private readonly events = new Emitter<SimEvents>();
  private stops: (() => void)[] = [];
  private calls = 0;
  /** id of an ignition or an edit to the number of the call that sent it (the newest call for an edit that was sent again). */
  readonly order = new Map<string, number>();

  constructor(private target: SimController) {
    this.attach();
  }

  /** What the calls go to now. */
  get inner(): SimController {
    return this.target;
  }

  /** From now on the calls go to `next`, its events reach the same listeners, and the old target is finished with. */
  switchTo(next: SimController): void {
    for (const stop of this.stops) stop();
    const old = this.target;
    this.target = next;
    this.attach();
    old.dispose();
  }

  private attach(): void {
    this.stops = EVENTS.map((ev) => this.target.on(ev, ((...a: never[]) => (this.events.emit as (e: string, ...x: never[]) => void)(ev, ...a)) as never));
  }

  init(scenario: ScenarioData): Promise<Insight[]> {
    return this.target.init(scenario);
  }
  run(until: number): void {
    this.target.run(until);
  }
  pause(): void {
    this.target.pause();
  }
  ignite(ignition: Ignition): void {
    this.order.set(ignition.id, this.calls++);
    this.target.ignite(ignition);
  }
  edit(edit: ScenarioEdit, time: number): void {
    this.order.set(edit.id, this.calls++);
    this.target.edit(edit, time);
  }
  removeEdit(id: string): void {
    this.order.delete(id);
    this.target.removeEdit(id);
  }
  removeIgnition(id: string): void {
    this.order.delete(id);
    this.target.removeIgnition(id);
  }
  rewind(time: number): void {
    this.target.rewind(time);
  }
  setOption(key: SimOptionKey, value: number | boolean): void {
    this.target.setOption(key, value);
  }
  setQuality(tier: QualityTier): void {
    this.target.setQuality(tier);
  }
  explain(x: number, y: number, time?: number): Promise<CellExplanation> {
    return this.target.explain(x, y, time);
  }
  on<K extends keyof SimEvents>(event: K, cb: SimEvents[K]): () => void {
    return this.events.on(event, cb);
  }
  dispose(): void {
    for (const stop of this.stops) stop();
    this.events.clear();
    this.target.dispose();
  }
}
