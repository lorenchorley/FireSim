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
 *  - Not built: a user change does not raise a "wind change coming" card or a Danger zone of its own, and there is no "Back
 *    to the forecast" change. The forecast's own swings that it replaces are not shown as coming (`forecastSwingsKept`).
 *    The old per-place Local wind tool is gone as a tool; `WindEdit` stays in the union for Setup's belt-kit readings.
 *
 * Light imports on purpose (core/types, core/units, atmosphere/weatherInterp): the Session, which sits in the entry chunk,
 * imports this module, and `scenario/weather.ts` is a separate lazy chunk.
 */
import type { ScenarioEdit, WeatherHour, WeatherSeries, WindDirectionEdit } from '../core/types';
import { angleDiffDeg, smoothstep, wrapDeg } from '../core/units';
import { interpolateHour } from '../atmosphere/weatherInterp';

/** A swing takes this long (s), from the change time: a step is not physical, research doc 02 asks 15 to 30 min. */
export const WIND_TURN_S = 900;

/**
 * Largest arc (degrees) between two neighbouring stamps of a swing, after easing: stamps are linear in u/v, so a big arc
 * dips in speed. The easing's steepest slope is 1.5 times the average, so a swing gets `ceil(1.5 * arc / this)` segments.
 */
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
 * When the first change starts (s from the scenario start), or null for none: from then on the 10 m direction is the plan's
 * and the forecast's own swings are replaced (`applyWindDirection`). A change whose time or direction is not a number
 * is left out, as `planSwings` leaves it out.
 */
export function windOverrideFrom(edits: readonly Pick<WindDirectionEdit, 'dir' | 'time'>[]): number | null {
  let from: number | null = null;
  for (const e of edits) if (Number.isFinite(e.time) && Number.isFinite(e.dir) && (from === null || e.time < from)) from = e.time;
  return from;
}

/**
 * The forecast's own wind changes (anything with a `time`, unix ms) that still come once the changes in `edits` are made:
 * those that happen before the first change starts. The later ones are replaced by the held direction, so the "wind change
 * coming" cards, marks and warnings built from the forecast must not show them. `changes` itself when there is no change.
 */
export function forecastSwingsKept<T extends { time: number }>(changes: readonly T[], startMs: number, edits: readonly Pick<WindDirectionEdit, 'dir' | 'time'>[]): readonly T[] {
  const from = windOverrideFrom(edits);
  return from === null ? changes : changes.filter((c) => c.time < startMs + from * 1000);
}

/** One swing of a plan: from `t0` (unix ms) the 10 m direction goes from `from` to `to` over `WIND_TURN_S`. */
export interface WindSwing {
  t0: number;
  from: number;
  to: number;
}

/** The forecast stamp at `tMs`: the stamp itself, or the interpolation of its bracket (the nearest stamp held outside the span). */
function stampAt(hours: readonly WeatherHour[], tMs: number): WeatherHour {
  const n = hours.length;
  if (tMs <= hours[0]!.time) return { ...hours[0]!, time: tMs };
  if (tMs >= hours[n - 1]!.time) return { ...hours[n - 1]!, time: tMs };
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (hours[m]!.time <= tMs) lo = m;
    else hi = m;
  }
  const a = hours[lo]!;
  const b = hours[hi]!;
  return a.time === tMs ? a : { ...interpolateHour(a, b, (tMs - a.time) / (b.time - a.time)), time: tMs };
}

/** The value of the last swing that has started by `tMs`, or null before the first one. Exact at both ends of a swing. */
function swingsAt(swings: readonly WindSwing[], tMs: number): number | null {
  let s: WindSwing | null = null;
  for (const x of swings) {
    if (x.t0 <= tMs) s = x;
    else break;
  }
  if (!s) return null;
  const f = turnFraction((tMs - s.t0) / 1000);
  return f <= 0 ? s.from : f >= 1 ? s.to : turnDirection(s.from, s.to, f);
}

/**
 * The swings the changes make, in (time, list index) order. A change starts from the direction the earlier swings have
 * reached at its time (it cuts a swing that is still turning), else from the forecast's 10 m direction at that time.
 * Changes with a time or direction that is not a number are left out.
 */
export function planSwings(series: WeatherSeries, startMs: number, edits: readonly WindDirectionEdit[]): WindSwing[] {
  const order = edits
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => Number.isFinite(e.time) && Number.isFinite(e.dir))
    .sort((a, b) => a.e.time - b.e.time || a.i - b.i)
    .map((x) => x.e);
  const swings: WindSwing[] = [];
  for (const e of order) {
    const t0 = startMs + e.time * 1000;
    const to = wrapDeg(e.dir);
    const from = swingsAt(swings, t0) ?? (series.hours.length ? wrapDeg(stampAt(series.hours, t0).windDir10) : to);
    swings.push({ t0, from, to });
  }
  return swings;
}

/**
 * The 10 m direction (degrees from) that the changes give at `tMs`, or null before the first change starts.
 * Several changes apply in (time, insertion) order; one that starts inside a swing cuts it and starts from the value
 * reached. This is the ideal curve: the series `applyWindDirection` makes follows it to within a degree.
 */
export function windDirectionAt(series: WeatherSeries, startMs: number, edits: readonly WindDirectionEdit[], tMs: number): number | null {
  return swingsAt(planSwings(series, startMs, edits), tMs);
}

/**
 * The forecast with the changes applied; `edits` empty returns `series` itself (so with no change every existing hash
 * stays bitwise). Pure: the input is not touched, and the stamps before the first change are the same objects.
 *
 * Each swing adds stamps at `t0 + k * WIND_TURN_S / m` (k = 0..m, `m = ceil(1.5 * arc / WIND_TURN_STEP_DEG)`), made from the
 * original bracketing stamps, so the atmosphere (which reads the series only as pairs of stamps) turns smoothly. From the
 * first change on, every stamp's 10 m direction becomes the plan's, and its wind profile and pressure levels turn by the
 * same angle: the forecast's own veer with height is kept, its later swings are replaced. Speeds and everything else stay.
 */
export function applyWindDirection(series: WeatherSeries, startMs: number, edits: readonly WindDirectionEdit[]): WeatherSeries {
  if (edits.length === 0 || series.hours.length === 0) return series;
  const swings = planSwings(series, startMs, edits);
  if (swings.length === 0) return series;
  const times = new Set<number>();
  for (const s of swings) {
    const m = Math.max(1, Math.ceil((Math.abs(angleDiffDeg(s.to, s.from)) * 1.5) / WIND_TURN_STEP_DEG));
    for (let k = 0; k <= m; k++) times.add(s.t0 + Math.round((k * WIND_TURN_S * 1000) / m));
  }
  const have = new Set(series.hours.map((h) => h.time));
  const added = [...times].filter((t) => !have.has(t)).map((t) => stampAt(series.hours, t));
  const merged = [...series.hours, ...added].sort((a, b) => a.time - b.time);
  const first = swings[0]!.t0;
  const hours = merged.map((h) => {
    if (h.time < first) return h;
    const d = swingsAt(swings, h.time);
    if (d === null) return h;
    const turn = angleDiffDeg(d, h.windDir10);
    const out: WeatherHour = { ...h, windDir10: d };
    if (h.windProfile) out.windProfile = h.windProfile.map((p) => ({ ...p, dir: wrapDeg(p.dir + turn) }));
    if (h.pressureLevels) out.pressureLevels = h.pressureLevels.map((l) => ({ ...l, windDir: wrapDeg(l.windDir + turn) }));
    return out;
  });
  return { ...series, hours };
}
