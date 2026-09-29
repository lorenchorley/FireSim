/**
 * Messages between the main thread (UI) and the simulation Web Worker, and the controller interface the UI
 * programs against. The worker owns all simulation state; the UI only sees snapshots and explanations.
 */
import type { CellExplanation, Ignition, Insight, QualityTier, ScenarioData, ScenarioEdit, SimSnapshot } from '../core/types';

/**
 * Options the UI can change while a run is in progress.
 *  - 'snapshotInterval' (s): display step — how often the engine emits a picture. Applies from now on; does not
 *    change the simulation (no rewind).
 *  - 'maxStepS' (s, 0 = automatic): cap on the solver step Δt_a. Changes the trajectory, so it is a timed record
 *    applied from the current simulation time (like 'coupling').
 */
export type SimOptionKey = 'coupling' | 'embers' | 'mountainPhenomena' | 'maxEmbers' | 'snapshotInterval' | 'maxStepS';

export type ToWorker =
  | { type: 'init'; scenario: ScenarioData }
  /** Simulate forward until `until` seconds after scenario start (runs in chunks; snapshots stream back). */
  | { type: 'run'; until: number }
  | { type: 'pause' }
  /** Add fire observed on the ground (applies at `ignition.time`; if in the past the worker rewinds and replays). */
  | { type: 'ignite'; ignition: Ignition }
  | { type: 'edit'; edit: ScenarioEdit; /** simulation time from which the edit applies (s) */ time: number }
  | { type: 'removeEdit'; id: string }
  /** Remove a marked ignition as if it had never been marked (the worker rewinds to its time and re-runs). */
  | { type: 'removeIgnition'; id: string }
  /** "Why here?" at (x, y); `time` (s, optional) is the view time: arrival state is evaluated at min(time, now). */
  | { type: 'explain'; x: number; y: number; reqId: number; time?: number }
  /** Rewind to the nearest checkpoint at or before `time` and discard later results. */
  | { type: 'rewind'; time: number }
  | { type: 'setOption'; key: SimOptionKey; value: number | boolean }
  /** Recorded as an edit at the current sim time. */
  | { type: 'setQuality'; tier: QualityTier };

export type FromWorker =
  | { type: 'ready'; forecastInsights: Insight[] }
  | { type: 'snapshot'; snapshot: SimSnapshot }
  | { type: 'explain'; reqId: number; explanation: CellExplanation }
  | { type: 'status'; time: number; running: boolean; /** simulated seconds per wall-clock second */ speed: number }
  | { type: 'error'; message: string }
  /** The worker rewound: the UI drops insights and spot fires with time > `time`. */
  | { type: 'rewound'; time: number };

export interface SimEvents {
  ready: (forecastInsights: Insight[]) => void;
  snapshot: (s: SimSnapshot) => void;
  status: (st: { time: number; running: boolean; speed: number }) => void;
  error: (message: string) => void;
  rewound: (time: number) => void;
}

/** What the UI uses to drive a simulation. Implemented by SimClient (worker) and by test/mocks. */
export interface SimController {
  init(scenario: ScenarioData): Promise<Insight[]>;
  run(until: number): void;
  pause(): void;
  ignite(ignition: Ignition): void;
  edit(edit: ScenarioEdit, time: number): void;
  removeEdit(id: string): void;
  /** Undo a marked ignition (results after its time are re-computed; a 'rewound' event reports its time). */
  removeIgnition(id: string): void;
  rewind(time: number): void;
  setOption(key: SimOptionKey, value: number | boolean): void;
  setQuality(tier: QualityTier): void;
  /** Explain a point; `time` is the view time (default: the simulation's current time). */
  explain(x: number, y: number, time?: number): Promise<CellExplanation>;
  on<K extends keyof SimEvents>(event: K, cb: SimEvents[K]): () => void;
  dispose(): void;
}
