/**
 * Types of the pace signal: whether the simulation is keeping up with the playback speed the viewer asked for
 * (workstream B of docs/plans/air-slice-wind-detail-honest-speed.md, §6.3). Pure types, so the session state, the
 * tracker (planned as `paceModel.ts`), the timeline button and the details sheet can all depend on them without
 * importing each other.
 */

/**
 * `ok`: the simulation keeps up (or nothing is asked of it), nothing shows. `behind`: an early warning, before any
 * stall: the worker's computing speed is below the speed asked for and it is busy nearly all the time. `waiting`:
 * playback has been held at the newest result, waiting for the simulation, for a sustained share of the last 10 s.
 */
export type PaceLevel = 'ok' | 'behind' | 'waiting';

/**
 * What the tracker publishes as `SessionState.pace`. Every number is a measurement on this phone; none of it can change a
 * result. The tracker may add fields; readers ignore the ones they do not know.
 */
export interface PaceInfo {
  level: PaceLevel;
  /** The playback speed asked for (simulated s per wall s). Always finite: Max speed has no wanted speed and publishes no pace. */
  wanted: number;
  /** Clock movement per wall second over the last 10 s of play; null until 10 s have been played. */
  achieved: number | null;
  /** Share (0–1) of the last 10 s in which the clock was held at the newest result, waiting for the worker. */
  waitingShare: number;
  /** The worker's computing speed while it is busy (`EngineInfo.perf.speed.s10`, else the `workerSpeed` average); null if unknown. */
  capacity: number | null;
  /** Share (0–1) of wall time the worker spent computing over the last 10 s; null if unknown. */
  duty: number | null;
  /** Simulated seconds already computed ahead of the clock (`headTime − viewTime`). */
  aheadS: number;
  /** The same lead in wall seconds at the wanted speed (`aheadS / wanted`): how long playback runs before it has to wait. */
  bufferS: number;
  /** `performance.now()` (ms) when `level` last changed: for "for N seconds" wording and the announce-at-most-every-2-minutes rule. */
  sinceMs: number;
}
