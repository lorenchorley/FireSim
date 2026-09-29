/**
 * Main-thread controllers implementing {@link SimController} (spec §2.3, §12.1):
 *
 * - {@link SimClient}: spawns the Web Worker (`new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`)
 *   and talks the protocol of protocol.ts. Where `Worker` does not exist (Node tests, very old WebViews) it falls
 *   back to an in-thread host transparently.
 * - {@link LocalSimController}: the same host running in the calling thread (chunks yield with setTimeout), for
 *   environments without Worker and for tests. Snapshot arrays are handed over without copying.
 *
 * `explain(x, y, time?)`: the optional view time travels as the `time` field of the 'explain' message; the worker
 * evaluates arrival state at min(time, now).
 */
import type { CellExplanation, Ignition, Insight, QualityTier, ScenarioData, ScenarioEdit } from '../core/types';
import { SimHost, type SimHostOptions } from './host';
import type { FromWorker, SimController, SimEvents, SimOptionKey, ToWorker } from './protocol';

type Listener = (...args: never[]) => void;

/** Tiny typed event emitter. */
class Events {
  private readonly map = new Map<keyof SimEvents, Set<Listener>>();
  on<K extends keyof SimEvents>(event: K, cb: SimEvents[K]): () => void {
    let s = this.map.get(event);
    if (!s) this.map.set(event, (s = new Set()));
    s.add(cb as unknown as Listener);
    return () => s!.delete(cb as unknown as Listener);
  }
  emit<K extends keyof SimEvents>(event: K, ...args: Parameters<SimEvents[K]>): void {
    const s = this.map.get(event);
    if (!s) return;
    for (const cb of [...s]) {
      try {
        (cb as unknown as (...a: Parameters<SimEvents[K]>) => void)(...args);
      } catch (e) {
        // A failing listener must not break the others or the message pump.
        if (typeof console !== 'undefined') console.error('[FireSim] sim listener failed', e);
      }
    }
  }
}

/** Shared protocol client: sends ToWorker messages through `send`, dispatches FromWorker messages to listeners. */
abstract class ProtocolController implements SimController {
  protected readonly events = new Events();
  private readonly pendingExplain = new Map<number, { resolve: (e: CellExplanation) => void; reject: (e: Error) => void }>();
  private reqId = 1;
  private readyWaiter: { resolve: (i: Insight[]) => void; reject: (e: Error) => void } | null = null;
  protected disposed = false;

  protected abstract send(msg: ToWorker): void;

  /** Handle one message from the simulation. */
  protected receive(msg: FromWorker): void {
    if (this.disposed) return;
    switch (msg.type) {
      case 'ready':
        this.events.emit('ready', msg.forecastInsights);
        if (this.readyWaiter) {
          this.readyWaiter.resolve(msg.forecastInsights);
          this.readyWaiter = null;
        }
        break;
      case 'snapshot':
        this.events.emit('snapshot', msg.snapshot);
        break;
      case 'status':
        this.events.emit('status', { time: msg.time, running: msg.running, speed: msg.speed, ...(msg.until !== undefined ? { until: msg.until } : {}) });
        break;
      case 'rewound':
        this.events.emit('rewound', msg.time);
        break;
      case 'explain': {
        const p = this.pendingExplain.get(msg.reqId);
        if (p) {
          this.pendingExplain.delete(msg.reqId);
          p.resolve(msg.explanation);
        }
        break;
      }
      case 'error': {
        this.events.emit('error', msg.message);
        if (this.readyWaiter) {
          this.readyWaiter.reject(new Error(msg.message));
          this.readyWaiter = null;
        }
        for (const p of this.pendingExplain.values()) p.reject(new Error(msg.message));
        this.pendingExplain.clear();
        break;
      }
    }
  }

  init(scenario: ScenarioData): Promise<Insight[]> {
    if (this.readyWaiter) this.readyWaiter.reject(new Error('superseded by a new init'));
    return new Promise<Insight[]>((resolve, reject) => {
      this.readyWaiter = { resolve, reject };
      this.send({ type: 'init', scenario });
    });
  }
  run(until: number): void {
    this.send({ type: 'run', until });
  }
  pause(): void {
    this.send({ type: 'pause' });
  }
  ignite(ignition: Ignition): void {
    this.send({ type: 'ignite', ignition });
  }
  edit(edit: ScenarioEdit, time: number): void {
    this.send({ type: 'edit', edit, time });
  }
  removeEdit(id: string): void {
    this.send({ type: 'removeEdit', id });
  }
  removeIgnition(id: string): void {
    this.send({ type: 'removeIgnition', id });
  }
  rewind(time: number): void {
    this.send({ type: 'rewind', time });
  }
  setOption(key: SimOptionKey, value: number | boolean): void {
    this.send({ type: 'setOption', key, value });
  }
  setQuality(tier: QualityTier): void {
    this.send({ type: 'setQuality', tier });
  }
  /** `time` (s, optional): explain the state at that view time (≤ the simulation time). */
  explain(x: number, y: number, time?: number): Promise<CellExplanation> {
    const reqId = this.reqId++;
    return new Promise<CellExplanation>((resolve, reject) => {
      this.pendingExplain.set(reqId, { resolve, reject });
      const msg: ToWorker = { type: 'explain', x, y, reqId, ...(time !== undefined && Number.isFinite(time) ? { time } : {}) };
      this.send(msg);
    });
  }
  on<K extends keyof SimEvents>(event: K, cb: SimEvents[K]): () => void {
    return this.events.on(event, cb);
  }
  dispose(): void {
    this.disposed = true;
    for (const p of this.pendingExplain.values()) p.reject(new Error('disposed'));
    this.pendingExplain.clear();
    if (this.readyWaiter) this.readyWaiter.reject(new Error('disposed'));
    this.readyWaiter = null;
  }
}

/**
 * In-thread controller: the simulation runs in the calling thread in chunks (setTimeout yields), with the same
 * message semantics as the worker. Messages in both directions are delivered asynchronously (like postMessage).
 */
export class LocalSimController extends ProtocolController {
  private readonly host: SimHost;

  constructor(opts: Omit<SimHostOptions, 'transfer'> = {}) {
    super();
    this.host = new SimHost({ post: (m) => queueMicrotask(() => this.receive(m)) }, { ...opts, transfer: false });
  }

  /** The in-thread simulation (tests, developer panel). */
  get simulation(): SimHost['simulation'] {
    return this.host.simulation;
  }

  protected send(msg: ToWorker): void {
    if (this.disposed) return;
    // Asynchronous like postMessage, so callers never re-enter the simulation from a listener.
    setTimeout(() => this.host.handle(msg), 0);
  }

  override dispose(): void {
    super.dispose();
    this.host.dispose();
  }
}

/**
 * The scenario as the worker needs it: without the display-only places context (roads, homes, zones, place names),
 * which can be hundreds of KB of typed arrays the simulation never reads and postMessage would clone for nothing.
 * The caller's object is left intact (the render layer still reads `context`).
 */
export function withoutContext(scenario: ScenarioData): ScenarioData {
  if (scenario.context === undefined) return scenario;
  const { context: _display, ...rest } = scenario;
  return rest;
}

/** Worker-backed controller (spec §2.3). Falls back to an in-thread host when `Worker` is unavailable. */
export class SimClient extends ProtocolController {
  private readonly worker: Worker | null;
  private readonly local: LocalSimController | null;

  constructor(worker?: Worker) {
    super();
    let w: Worker | null = worker ?? null;
    if (!w && typeof Worker !== 'undefined') {
      try {
        w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      } catch {
        w = null;
      }
    }
    this.worker = w;
    if (w) {
      this.local = null;
      w.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data);
      w.onerror = (e: ErrorEvent) => {
        e.preventDefault?.();
        this.receive({ type: 'error', message: e.message || 'simulation worker failed' });
      };
      w.onmessageerror = () => this.receive({ type: 'error', message: 'simulation worker message could not be decoded' });
    } else {
      // No Worker: run in this thread; forward its events.
      const local = new LocalSimController();
      this.local = local;
      for (const ev of ['ready', 'snapshot', 'status', 'error', 'rewound'] as const) {
        local.on(ev, ((...a: never[]) => (this.events.emit as (e: string, ...x: never[]) => void)(ev, ...a)) as never);
      }
    }
  }

  /** True when the simulation runs in a Web Worker. */
  get inWorker(): boolean {
    return this.worker !== null;
  }

  protected send(msg: ToWorker): void {
    if (this.disposed) return;
    if (this.worker) this.worker.postMessage(msg.type === 'init' ? { ...msg, scenario: withoutContext(msg.scenario) } : msg);
  }

  override init(scenario: ScenarioData): Promise<Insight[]> {
    if (this.local) return this.local.init(scenario);
    return super.init(scenario);
  }
  override run(until: number): void {
    if (this.local) this.local.run(until);
    else super.run(until);
  }
  override pause(): void {
    if (this.local) this.local.pause();
    else super.pause();
  }
  override ignite(ignition: Ignition): void {
    if (this.local) this.local.ignite(ignition);
    else super.ignite(ignition);
  }
  override edit(edit: ScenarioEdit, time: number): void {
    if (this.local) this.local.edit(edit, time);
    else super.edit(edit, time);
  }
  override removeEdit(id: string): void {
    if (this.local) this.local.removeEdit(id);
    else super.removeEdit(id);
  }
  override removeIgnition(id: string): void {
    if (this.local) this.local.removeIgnition(id);
    else super.removeIgnition(id);
  }
  override rewind(time: number): void {
    if (this.local) this.local.rewind(time);
    else super.rewind(time);
  }
  override setOption(key: SimOptionKey, value: number | boolean): void {
    if (this.local) this.local.setOption(key, value);
    else super.setOption(key, value);
  }
  override setQuality(tier: QualityTier): void {
    if (this.local) this.local.setQuality(tier);
    else super.setQuality(tier);
  }
  override explain(x: number, y: number, time?: number): Promise<CellExplanation> {
    if (this.local) return this.local.explain(x, y, time);
    return super.explain(x, y, time);
  }
  override dispose(): void {
    super.dispose();
    this.local?.dispose();
    this.worker?.terminate();
  }
}
