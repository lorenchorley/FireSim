/**
 * Pure words and maths of the Wind direction panel (no DOM): the "When" choices and the change time they give, the status
 * lines, the list of the user's changes, the announcements and the dial size. The panel (windPanel.ts) only lays them out.
 * Tested in windPanelModel.test.ts.
 */
import type { WindDirectionEdit } from '../../../core/types';
import { wrapDeg } from '../../../core/units';
import { WIND_TURN_S, windChangePhase, windDirectionTime } from '../../../scenario/windDirection';
import { compassName, formatClock, formatDayClock, formatDirFrom, formatRelative, zonedDate, zonedTime } from '../../format';
import { clockToSimTime, parseTimeOfDay } from './timelineModel';

/** The scenario the panel works in: its start (unix ms), the time zone its clock is read in, and its length (s). */
export interface WindEnv {
  startMs: number;
  tz: string;
  durationS: number;
}

/** A scenario longer than this shows the day with its clock ("Sat 14:41"): the same clock time comes round twice. */
const DAY_CLOCK_OVER_S = 20 * 3600;

/** A simulation time (s) as the clock the person reads: "14:41", or "Sat 14:41" in a scenario of more than 20 h. */
export function windClock(env: WindEnv, t: number): string {
  const ms = env.startMs + t * 1000;
  return env.durationS > DAY_CLOCK_OVER_S ? formatDayClock(ms, env.tz) : formatClock(ms, env.tz);
}

// ───────────────────────────── when ─────────────────────────────

export type WhenChoice = 'now' | '10' | '30' | '60' | 'at';

export const WHEN_OPTIONS: readonly { value: WhenChoice; label: string }[] = [
  { value: 'now', label: 'Now' },
  { value: '10', label: 'In 10 min' },
  { value: '30', label: 'In 30 min' },
  { value: '60', label: 'In 1 h' },
  { value: 'at', label: 'At a time' },
];

/** How far after the view time each preset starts the turn (s). */
const PRESET_S: Record<Exclude<WhenChoice, 'at'>, number> = { now: 0, '10': 600, '30': 1800, '60': 3600 };

export interface WhenState {
  choice: WhenChoice;
  /** What the time field holds ("14:35"): used when the choice is "At a time". */
  clock: string;
}

/**
 * Why a change cannot be made: `late` = the scenario ends within a minute; `outside` = the time is after the last minute
 * that can take a change; `badClock` = the field is empty or not a time; `notInScenario` = the clock time never comes in
 * this scenario; `past` = it came, but before the "Now" start.
 */
export type WhenProblem = 'late' | 'outside' | 'badClock' | 'notInScenario' | 'past';

export type When = { ok: true; time: number } | { ok: false; problem: WhenProblem };

/** The start a change made now gets (the view time raised to a whole minute), or `time < viewTime` when no minute is left. */
const nowTime = (viewTime: number, env: WindEnv): number => windDirectionTime(viewTime, env.durationS);

/**
 * The first simulation time at or after `fromS` (and within the scenario) at which the wall clock in `tz` reads
 * `secondsOfDay`; null when there is none. Scans the days the scenario touches, as `clockToSimTime` does.
 */
export function nextClockTime(secondsOfDay: number, startMs: number, tz: string, durationS: number, fromS: number): number | null {
  const [y, mo, d] = zonedDate(startMs, tz).split('-').map(Number) as [number, number, number];
  const hh = Math.floor(secondsOfDay / 3600);
  const mm = Math.floor((secondsOfDay % 3600) / 60);
  const ss = secondsOfDay % 60;
  let best: number | null = null;
  for (let day = 0; day <= Math.ceil(durationS / 86400) + 1; day++) {
    const date = new Date(Date.UTC(y, mo - 1, d + day)).toISOString().slice(0, 10);
    const t = (zonedTime(date, hh, mm, tz) + ss * 1000 - startMs) / 1000;
    if (t < fromS - 1e-6 || t > durationS + 1e-6) continue;
    if (best === null || t < best) best = t;
  }
  return best;
}

/** The simulation time (a whole minute) the choice starts the turn at, or why it cannot. The zone is the scenario's, never the device's. */
export function resolveWhen(state: WhenState, viewTime: number, env: WindEnv): When {
  const D = env.durationS;
  const last = windDirectionTime(D, D);
  const now = nowTime(viewTime, env);
  if (now < viewTime - 1e-6) return { ok: false, problem: 'late' };
  if (state.choice !== 'at') {
    const offset = PRESET_S[state.choice];
    if (viewTime + offset > D - 60 + 1e-6) return { ok: false, problem: 'outside' };
    return { ok: true, time: windDirectionTime(viewTime + offset, D) };
  }
  const sod = parseTimeOfDay(state.clock);
  if (sod === null) return { ok: false, problem: 'badClock' };
  const t = nextClockTime(sod, env.startMs, env.tz, D, now);
  if (t === null) return { ok: false, problem: clockToSimTime(sod, env.startMs, env.tz, D) === null ? 'notInScenario' : 'past' };
  if (t > last + 1e-6) return { ok: false, problem: 'outside' };
  return { ok: true, time: windDirectionTime(t, D) };
}

/** What the time field holds when the panel opens: the clock of the "Now" start plus 10 minutes (kept inside the scenario). */
export function defaultClock(viewTime: number, env: WindEnv): string {
  const t = windDirectionTime(nowTime(viewTime, env) + 600, env.durationS);
  return formatClock(env.startMs + t * 1000, env.tz);
}

/** The sentence for a problem. "At a time" in the last minute of the scenario has its own words; the presets say the scenario ends. */
export function problemText(problem: WhenProblem, choice: WhenChoice, viewTime: number, env: WindEnv): string {
  switch (problem) {
    case 'late':
      return 'There is no time left in this scenario for a wind change.';
    case 'outside':
      return choice === 'at' ? `The last time you can choose is ${windClock(env, windDirectionTime(env.durationS, env.durationS))}.` : 'The scenario ends before that time.';
    case 'badClock':
      return 'Enter a time such as 14:35.';
    case 'notInScenario':
      return `That time is not in this scenario (${windClock(env, 0)} to ${windClock(env, env.durationS)}).`;
    case 'past':
      return `That time has passed. Choose a time after ${windClock(env, nowTime(viewTime, env))}.`;
  }
}

// ───────────────────────────── the panel's words ─────────────────────────────

export const WIND_HINT = `Choose where the wind comes from. It turns over ${WIND_TURN_S / 60} minutes and then holds that direction, so the forecast's later wind changes no longer apply. Wind speed stays as forecast.`;
export const DIAL_LABEL = 'Wind comes from. Drag the arrow, or use the arrow keys.';
export const WHEN_LABEL = 'When';
export const TIME_FIELD_LABEL = 'Local time';
export const TIME_FIELD_SPOKEN = 'Time the wind starts to turn';
export const LIST_TITLE = 'Your wind changes';

/** The text of the primary button. */
export const applyLabel = (dir: number): string => `Turn wind to ${compassName(dir)}`;

/** The note shown while the person is looking at an earlier time (an edit then re-runs the simulation from there). */
export const reviewingText = (viewTime: number, env: WindEnv): string => `You are viewing ${windClock(env, viewTime)}. Applying re-runs the simulation from then.`;

export interface WindView {
  when: When;
  /** The message under the time field ('' = none). */
  message: string;
  /** The status lines, in order. */
  lines: string[];
  /** One short line for the bar over Apply ('' when there is no valid time): a small portrait phone cannot show `lines` without scrolling. */
  plan: string;
  canApply: boolean;
}

/**
 * What the panel shows for a choice: whether Apply can be pressed, the message under the time field, and the status lines
 * ("Before the change: from NW (315°)." and where the turn starts and ends). `directionAt(t)` is the wind direction (from)
 * the forecast and the changes made so far give at simulation time t, so an earlier change counts as "before".
 */
export function windView(input: { when: WhenState; viewTime: number; env: WindEnv; dir: number; directionAt(t: number): number }): WindView {
  const { when: state, viewTime, env, dir, directionAt } = input;
  const when = resolveWhen(state, viewTime, env);
  const before = (t: number): string => `Before the change: from ${formatDirFrom(directionAt(t))}.`;
  if (when.ok) {
    return {
      when,
      message: '',
      lines: [before(when.time), `Starts turning at ${windClock(env, when.time)} and reaches ${formatDirFrom(dir)} by ${windClock(env, when.time + WIND_TURN_S)}.`],
      plan: `Starts turning at ${windClock(env, when.time)}, done by ${windClock(env, when.time + WIND_TURN_S)}.`,
      canApply: true,
    };
  }
  const text = problemText(when.problem, state.choice, viewTime, env);
  // With no time left the reason is the status; otherwise it sits under the field (and the status still says what is there now).
  if (when.problem === 'late') return { when, message: '', lines: [text], plan: '', canApply: false };
  return { when, message: text, lines: [before(nowTime(viewTime, env))], plan: '', canApply: false };
}

// ───────────────────────────── the list of changes ─────────────────────────────

export interface WindListItem {
  id: string;
  text: string;
  removeLabel: string;
}

/** One line per change, in time order: where it is now (not started, turning, done) is part of the words. */
export function windList(edits: readonly WindDirectionEdit[], viewTime: number, env: WindEnv): WindListItem[] {
  return edits.map((e) => {
    const from = `Wind from ${compassName(e.dir)}`;
    const phase = windChangePhase(e, viewTime);
    const text =
      phase === 'scheduled'
        ? `${from} · starts ${windClock(env, e.time)} (${formatRelative(e.time - viewTime)})`
        : phase === 'turning'
          ? `${from} · turning, done by ${windClock(env, e.time + WIND_TURN_S)}`
          : `${from} · done at ${windClock(env, e.time + WIND_TURN_S)}`;
    return { id: e.id, text, removeLabel: `Remove the wind change to ${compassName(e.dir)} at ${windClock(env, e.time)}` };
  });
}

// ───────────────────────────── announcements ─────────────────────────────

export function applyAnnouncement(edit: Pick<WindDirectionEdit, 'dir' | 'time'>, env: WindEnv): string {
  return `Wind direction change set. The wind turns to come from ${compassName(edit.dir)}, starting at ${windClock(env, edit.time)} and done by ${windClock(env, edit.time + WIND_TURN_S)}.`;
}

/** The re-run is only mentioned when the simulation had computed past the change (`headTime` before the removal). */
export function removeAnnouncement(edit: Pick<WindDirectionEdit, 'time'>, headTime: number, env: WindEnv): string {
  return `Wind change removed.${headTime > edit.time ? ` The simulation re-runs from ${windClock(env, edit.time)} without it.` : ''}`;
}

// ───────────────────────────── the dial ─────────────────────────────

/** The dial's value when the panel opens: the direction now, to the nearest 5 degrees (the dial's own step). */
export const dialStart = (dirNow: number): number => wrapDeg(Math.round(dirNow / 5) * 5);

/**
 * The dial's size (px) for the window height: the panel is short on a small phone, so the dial gives way. A portrait phone under
 * 700 px (360 x 640) also shows the plan line over Apply (sim.css), and the dial and its read-out give it the room.
 */
export function dialSize(innerHeight: number): number {
  return innerHeight >= 800 ? 184 : innerHeight >= 700 ? 148 : innerHeight >= 560 ? 140 : 120;
}
