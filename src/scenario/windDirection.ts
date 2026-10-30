/**
 * The Wind direction tool as a transform of the forecast (0.6.0): `applyWindDirection(series, startMs, edits)` returns
 * the forecast with its wind turned from the change time on. The engine reads its wind from that series, so the fire,
 * the embers, the air slices, the arrows and the top bar follow without any change in atmosphere/, fire/ or embers/.
 *
 * Settled with the owner:
 *  - The time is when the turn STARTS (so "Now" works); the direction is reached `WIND_TURN_S` (900 s) later.
 *  - After the change the direction HOLDS until the next change: the forecast's own later swings are replaced.
 *  - The speed is untouched; the whole column (profile and pressure levels) turns by the same angle as the 10 m wind.
 *  - A change is a whole minute of simulation time, so the step grid (which follows the display step) cannot move it
 *    (plan section 4, rule 1: the results do not depend on the display).
 *  - Not built: a user change does not raise the "wind change coming" card or the Danger zone (they read the
 *    forecast), and there is no "Back to the forecast" change. The old per-place Local wind tool is gone as a tool;
 *    `WindEdit` stays in the union for Setup's belt-kit readings.
 *
 * C0/C1 contract: the constants and the five small helpers are real; `windDirectionAt` and `applyWindDirection` are stubs
 * (no change, so nothing in the simulation moves) until the W-core lane fills them in.
 */
import type { ScenarioEdit, WeatherSeries, WindDirectionEdit } from '../core/types';
import { angleDiffDeg, smoothstep, wrapDeg } from '../core/units';

/** A swing takes this long (s), from the change time: a step is not physical, research doc 02 asks 15 to 30 min. */
export const WIND_TURN_S = 900;

/** Largest arc (degrees) between two stamps of a swing, before easing: stamps are linear in u/v, so a big arc dips in speed. */
export const WIND_TURN_STEP_DEG = 15;

/**
 * A change time for the engine and the UI (both use this one): `seconds` rounded UP to a whole minute and at most the
 * last whole minute that is at or before `durationS - 60` (a change in the last minute would do nothing); NaN or a
 * negative time gives 0.
 */
export function windDirectionTime(seconds: number, durationS: number): number {
  if (!(seconds > 0)) return 0;
  const last = Math.max(0, Math.floor((durationS - 60) / 60) * 60);
  return Math.min(Math.ceil(seconds / 60) * 60, last);
}

/** How far a swing has gone `elapsedS` after its change time: smoothstep(0, WIND_TURN_S), 0 before it and 1 after it. */
export function turnFraction(elapsedS: number): number {
  return elapsedS > 0 ? smoothstep(0, WIND_TURN_S, elapsedS) : 0;
}

/** `from` to `to` by fraction `f` along the shortest arc; an exact half turn goes clockwise. Degrees in [0, 360). */
export function turnDirection(from: number, to: number, f: number): number {
  return wrapDeg(from + angleDiffDeg(to, from) * f);
}

/** Where a change is at a given simulation time: not started, turning (the 15 minutes), or finished. */
export type WindChangePhase = 'scheduled' | 'turning' | 'done';

/** The phase of a change at `nowS` (s from the scenario start); scrubbing back to before `time` gives 'scheduled' again. */
export function windChangePhase(edit: Pick<WindDirectionEdit, 'time'>, nowS: number): WindChangePhase {
  if (nowS < edit.time) return 'scheduled';
  return nowS < edit.time + WIND_TURN_S ? 'turning' : 'done';
}

/** The Wind direction changes among `list` (as `SessionState.edits` holds them), in (time, list index) order. */
export function windDirectionEdits(list: readonly { edit: ScenarioEdit }[]): WindDirectionEdit[] {
  const out: WindDirectionEdit[] = [];
  for (const { edit } of list) if (edit.kind === 'windDirection') out.push(edit);
  return out.sort((a, b) => a.time - b.time); // a stable sort: equal times keep their list order
}

/**
 * The 10 m direction (degrees from) that the changes give at `tMs`, or null before the first change starts.
 * Several changes apply in (time, insertion) order; one that starts inside a swing cuts it and starts from the value
 * reached. STUB (C0): always null.
 */
export function windDirectionAt(
  _series: WeatherSeries,
  _startMs: number,
  _edits: readonly WindDirectionEdit[],
  _tMs: number,
): number | null {
  return null;
}

/**
 * The forecast with the changes applied; `edits` empty returns `series` itself (so with no change every existing hash
 * stays bitwise). Pure: the input is not touched. STUB (C0): always returns `series`.
 */
export function applyWindDirection(series: WeatherSeries, _startMs: number, _edits: readonly WindDirectionEdit[]): WeatherSeries {
  return series;
}
