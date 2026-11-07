/**
 * The controller of a run that was started on the desktop engine (0.8.0, workstream J). The session holds it for the whole run and
 * everything that listens to the engine listens to it; what it forwards to can change once, from the desktop link to an in-app engine
 * ("Continue on this device", desktopRestart.ts), without anyone having to move a listener. It also
 *   - keeps the order the person's fires and changes were sent in (id to call number): the session keeps its ignitions and its edits in
 *     two lists, and only the order of the calls says which came first when two were made at the same simulation time;
 *   - holds the STANDBY: this device's own engine, made when the link opened and idle (it was sent nothing). On a page the desktop host
 *     serves, the in-app engine's script can only be fetched from that host; made early, it is already here when the host is gone;
 *   - starts the new engine on the side (`stage`): its events are kept back, the listeners go on hearing the current target, and only
 *     `commit` makes it the target (and then says what it said meanwhile). `abandon` throws it away. So a start that fails changes nothing.
 * It changes no message and no result: every call is the target's own.
 */
import type { CellExplanation, Ignition, Insight, QualityTier, ScenarioData, ScenarioEdit } from '../core/types';
import type { SimController, SimEvents, SimOptionKey } from '../sim/protocol';
import { Emitter } from './store';

const EVENTS = ['ready', 'snapshot', 'status', 'error', 'rewound'] as const;

interface Staged {
  engine: SimController;
  stops: (() => void)[];
  /** What the engine said while it was on the side, in order. */
  heard: [(typeof EVENTS)[number], never[]][];
}

/**
 * Is a standby engine still any use? One that reported an error before it was asked anything (its script could not be loaded, its worker
 * died) is not: a restart then makes a fresh engine at once instead of waiting for one that cannot answer. `stop` ends the watching.
 */
export function watchStandby(engine: SimController): { bad(): boolean; stop(): void } {
  let bad = false;
  const stop = engine.on('error', () => {
    bad = true;
  });
  return { bad: () => bad, stop };
}

export class SwitchableController implements SimController {
  private readonly events = new Emitter<SimEvents>();
  private stops: (() => void)[] = [];
  private staged: Staged | null = null;
  private calls = 0;
  /** id of an ignition or an edit to the number of the call that sent it (the newest call for an edit that was sent again). */
  readonly order = new Map<string, number>();
  private watch: ReturnType<typeof watchStandby> | null;

  constructor(
    private target: SimController,
    /** This device's own engine, idle, made in advance (null: there is none). */
    public standby: SimController | null = null,
  ) {
    this.stops = this.attach(this.target);
    this.watch = standby ? watchStandby(standby) : null;
  }

  /** What the calls go to now. */
  get inner(): SimController {
    return this.target;
  }

  /** The standby, handed over (the controller no longer owns it); null when there is none, or when it reported a failure (it is finished with). */
  takeStandby(): SimController | null {
    const s = this.standby;
    const bad = this.watch?.bad() ?? false;
    this.watch?.stop();
    this.watch = null;
    this.standby = null;
    if (s && bad) {
      s.dispose();
      return null;
    }
    return s;
  }

  private attach(engine: SimController): (() => void)[] {
    return EVENTS.map((ev) => engine.on(ev, ((...a: never[]) => (this.events.emit as (e: string, ...x: never[]) => void)(ev, ...a)) as never));
  }

  /** Start `next` on the side: it hears nothing from the listeners' side and they hear nothing from it until {@link commit}. */
  stage(next: SimController): void {
    this.abandon();
    const heard: Staged['heard'] = [];
    this.staged = { engine: next, heard, stops: EVENTS.map((ev) => next.on(ev, ((...a: never[]) => heard.push([ev, a])) as never)) };
  }

  /** The staged engine has started: from now on the calls go to it, and the listeners hear what it said meanwhile, then what it says. The old target is finished with. */
  commit(): void {
    const s = this.staged;
    if (!s) return;
    this.staged = null;
    for (const stop of [...this.stops, ...s.stops]) stop();
    const old = this.target;
    this.target = s.engine;
    this.stops = this.attach(this.target);
    old.dispose();
    for (const [ev, a] of s.heard) (this.events.emit as (e: string, ...x: never[]) => void)(ev, ...a);
  }

  /** The staged engine could not start: it is finished with, and the controller is as it was. */
  abandon(): void {
    const s = this.staged;
    if (!s) return;
    this.staged = null;
    for (const stop of s.stops) stop();
    s.engine.dispose();
  }

  /** The target is gone for a reason it did not report as an engine error (the link's end): the listeners hear it as one. */
  fail(message: string): void {
    this.events.emit('error', message);
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
    this.abandon();
    this.events.clear();
    this.watch?.stop();
    this.watch = null;
    this.standby?.dispose();
    this.standby = null;
    this.target.dispose();
  }
}
