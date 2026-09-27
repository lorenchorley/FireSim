/**
 * SimHost — the message loop around a {@link Simulation} (spec §12.1), shared by the Web Worker entry (worker.ts) and
 * the in-thread {@link LocalSimController} (client.ts).
 *
 * - `init` builds the simulation (moisture spin-up), posts 'ready' (forecast insights) and the t0 snapshot at once,
 *   then runs the 3-D spin-up (and the auto-tune) in chunks. Messages that need the spun-up state (run excepted) are
 *   queued until then.
 * - `run(until)` runs whole atmosphere steps in chunks of ≤ `chunkMs` wall time and yields between chunks
 *   (`schedule`, a MessageChannel post-to-self in the worker), so pause / explain / edit / setOption / setQuality
 *   are handled between chunks. Snapshots stream out as they are produced; 'status' reports progress (time, running,
 *   simulated seconds per wall second) at most every `statusIntervalMs` and whenever running starts or stops.
 * - `rewind(time)` restores the latest checkpoint ≤ time, posts 'rewound' and re-runs to `time` (no duplicate
 *   snapshots); edits / ignitions in the past do the same.
 * - Every handler is guarded: an exception becomes an 'error' message and stops the run.
 */
import type { SimSnapshot } from '../core/types';
import { SIM_PARAMS } from './params';
import type { FromWorker, ToWorker } from './protocol';
import { Simulation, type SimulationOptions } from './simulation';

export interface HostPort {
  post(msg: FromWorker, transfer?: Transferable[]): void;
}

export interface SimHostOptions {
  /** Yield and call `fn` later (worker: MessageChannel; main thread / Node: setTimeout). */
  schedule?: (fn: () => void) => void;
  /** Wall clock (ms). */
  clock?: () => number;
  /** Transfer typed-array buffers with snapshots (worker: true; in-thread: false, the arrays are handed over). */
  transfer?: boolean;
  /** Extra Simulation options (tests: tier override). */
  simulation?: Omit<SimulationOptions, 'hooks' | 'clock'>;
  chunkMs?: number;
}

/** Every distinct ArrayBuffer referenced by the typed arrays of a snapshot (transfer list). */
export function snapshotTransferables(s: SimSnapshot): Transferable[] {
  const set = new Set<ArrayBufferLike>();
  const add = (a: unknown): void => {
    if (ArrayBuffer.isView(a) && a.buffer instanceof ArrayBuffer && a.byteLength > 0) set.add(a.buffer);
  };
  const f = s.fire;
  for (const a of [f.arrivalTime, f.burnState, f.ros, f.intensity, f.flameHeight, f.spreadDir, f.driver, f.phase]) add(a);
  add(s.moisture);
  add(s.embers.data);
  if (s.atmosphere) {
    const v = s.atmosphere;
    for (const a of [v.levels, v.terrainHeight, v.surfaceU, v.surfaceV, v.u, v.v, v.w, v.thetaAnomaly, v.smoke]) add(a);
  }
  if (s.layers) for (const a of Object.values(s.layers)) add(a);
  return [...set] as Transferable[];
}

export class SimHost {
  private sim: Simulation | null = null;
  private queue: ToWorker[] = [];
  private until = 0;
  private running = false;
  private scheduled = false;
  private disposed = false;
  private lastStatus = -Infinity;
  private speed = 0;
  private readonly schedule: (fn: () => void) => void;
  private readonly clock: () => number;
  private readonly transfer: boolean;
  private readonly chunkMs: number;

  constructor(
    private readonly port: HostPort,
    private readonly o: SimHostOptions = {},
  ) {
    this.schedule = o.schedule ?? ((fn) => setTimeout(fn, 0));
    this.clock = o.clock ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    this.transfer = o.transfer ?? false;
    this.chunkMs = o.chunkMs ?? SIM_PARAMS.chunkMs;
  }

  /** The simulation (after init), for tests and the developer panel. */
  get simulation(): Simulation | null {
    return this.sim;
  }

  dispose(): void {
    this.disposed = true;
    this.running = false;
    this.sim = null;
    this.queue = [];
  }

  handle(msg: ToWorker): void {
    if (this.disposed) return;
    try {
      this.dispatch(msg);
    } catch (e) {
      this.fail(e);
    }
  }

  private dispatch(msg: ToWorker): void {
    switch (msg.type) {
      case 'init':
        this.init(msg.scenario);
        return;
      case 'run':
        this.until = Math.max(0, msg.until);
        if (!this.sim) return;
        this.running = true;
        this.status(true);
        this.kick();
        return;
      case 'pause':
        this.running = false;
        if (this.sim) this.status(true);
        return;
      default:
        break;
    }
    const sim = this.sim;
    if (!sim || !sim.isReady) {
      this.queue.push(msg);
      if (sim) this.kick();
      return;
    }
    this.apply(sim, msg);
  }

  private apply(sim: Simulation, msg: ToWorker): void {
    switch (msg.type) {
      case 'ignite':
        sim.ignite(msg.ignition);
        break;
      case 'edit':
        sim.edit(msg.edit, msg.time);
        break;
      case 'removeEdit':
        sim.removeEdit(msg.id);
        break;
      case 'setOption':
        sim.setOption(msg.key, msg.value);
        break;
      case 'setQuality':
        sim.setQuality(msg.tier);
        break;
      case 'rewind':
        sim.rewind(msg.time);
        // Re-run to the rewind point (the UI asks for more with 'run').
        this.until = Math.max(sim.time, msg.time);
        break;
      case 'explain': {
        const ex = sim.explain(msg.x, msg.y, (msg as { time?: number }).time);
        this.port.post({ type: 'explain', reqId: msg.reqId, explanation: ex });
        return;
      }
      default:
        return;
    }
    // Replays (rewind, edits in the past) run even while paused: the state must reach the logical "now".
    if (sim.time < sim.logicalNow - 1e-6) this.until = Math.max(this.until, sim.logicalNow);
    if (sim.time < this.until - 1e-6) this.kick();
  }

  private init(scenario: import('../core/types').ScenarioData): void {
    this.running = false;
    this.queue = [];
    this.sim = null;
    const sim = new Simulation(scenario, {
      ...(this.o.simulation ?? {}),
      clock: this.clock,
      hooks: {
        snapshot: (s) => this.postSnapshot(s),
        rewound: (time) => this.port.post({ type: 'rewound', time }),
      },
    });
    this.sim = sim;
    this.port.post({ type: 'ready', forecastInsights: sim.forecastInsights });
    this.postSnapshot(sim.snapshot());
    this.kick();
  }

  private postSnapshot(s: SimSnapshot): void {
    if (this.transfer) this.port.post({ type: 'snapshot', snapshot: s }, snapshotTransferables(s));
    else this.port.post({ type: 'snapshot', snapshot: s });
  }

  private kick(): void {
    if (this.scheduled || this.disposed) return;
    this.scheduled = true;
    this.schedule(() => {
      this.scheduled = false;
      try {
        this.loop();
      } catch (e) {
        this.fail(e);
      }
    });
  }

  /** One chunk: spin-up, queued messages, then whole steps until the wall budget is used. */
  private loop(): void {
    const sim = this.sim;
    if (!sim || this.disposed) return;
    const start = this.clock();
    const deadline = start + this.chunkMs;
    if (!sim.isReady) {
      sim.spinUp(deadline);
      if (!sim.isReady) {
        this.kick();
        return;
      }
    }
    while (this.queue.length && sim.isReady) this.apply(sim, this.queue.shift()!);
    const replaying = sim.time < sim.logicalNow - 1e-6;
    const target = Math.min(sim.duration, replaying ? Math.max(this.until, sim.logicalNow) : this.until);
    const active = (this.running || replaying) && sim.time < target - 1e-6;
    if (!active) {
      if (this.running && sim.time >= Math.min(this.until, sim.duration) - 1e-6) {
        this.running = false;
        this.status(true);
      }
      return;
    }
    const t0 = sim.time;
    const reached = sim.advance(target, this.clock() > deadline ? this.clock() + 1 : deadline);
    const wall = Math.max(1e-3, this.clock() - start);
    const sp = (sim.time - t0) / (wall / 1000);
    this.speed = this.speed > 0 ? 0.7 * this.speed + 0.3 * sp : sp;
    if (reached && sim.time >= Math.min(this.until, sim.duration) - 1e-6 && sim.time >= sim.logicalNow - 1e-6) {
      this.running = false;
      this.status(true);
      return;
    }
    this.status(false);
    this.kick();
  }

  private status(force: boolean): void {
    const sim = this.sim;
    if (!sim) return;
    const now = this.clock();
    if (!force && now - this.lastStatus < SIM_PARAMS.statusIntervalMs) return;
    this.lastStatus = now;
    const replaying = sim.time < sim.logicalNow - 1e-6;
    this.port.post({ type: 'status', time: sim.time, running: this.running || replaying, speed: this.speed });
  }

  private fail(e: unknown): void {
    this.running = false;
    const message = e instanceof Error ? `${e.message}${e.stack ? `\n${e.stack.split('\n').slice(1, 4).join('\n')}` : ''}` : String(e);
    this.port.post({ type: 'error', message });
  }
}
