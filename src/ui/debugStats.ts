/**
 * The CONTENT of the "Simulation debug statistics" screen (workstream A of docs/plans/air-slice-wind-detail-honest-speed.md,
 * §5), pure (no DOM): `buildDebugStats()` turns what the app knows (the engine's report with its `perf` block, the session's
 * playback state, the view's frame statistics, the history store, the phone facts and the recent events) into groups of rows,
 * and `debugStatsToText()` is the "Copy" export. The screen (screens/debugStats.ts) only draws it and patches the values.
 *
 * RULES. Every number is a measurement on this phone or a value the app was given; a number that is not there says "Not
 * measured yet", "No run yet" or "Not available", never undefined, NaN or null. The text never holds a coordinate, a custom
 * place name or an identifier (no serial, IMEI or advertising id): a bundled site is named by its own name, any other place
 * is "a custom place", and the error lines are scrubbed of links and long decimals. The labels and group titles are stable
 * (people paste this into messages and a developer reads them), and the text ends with a marker so a cut-off paste shows.
 */
import { formatBytes } from '../core/datasets';
import type { EngineInfo, QualityTier } from '../core/types';
import type { FrameStatsInfo, QualityInfo, TerrainDrawStats } from '../render/api';
import { phoneIdentity, type DeviceLater, type DeviceNow } from './deviceInfo';
import { waited, type LogEvent } from './eventLog';
import { formatDuration, formatSpeedHint } from './format';
import type { PaceInfo } from './paceTypes';

export const TITLE = 'Simulation debug statistics';
export const END_MARKER = '-- end --';

const NOT_YET = 'Not measured yet';
const NO_RUN = 'No run yet';
const NA = 'Not available';
const NB = ' ';

// ───────────────────────────── input and output shapes ─────────────────────────────

/** What the run is (from the scenario; no coordinates and no name: a bundled site is looked up by its id prefix). */
export interface RunFacts {
  id: string;
  extentM: number;
  fireCellM: number;
  durationS: number;
  /** Scenario start (ms since the epoch): a date in the model, not a place. */
  startTimeMs: number;
  seed: number;
}

/** The session's state that the statistics read. */
export interface PlaybackFacts {
  playing: boolean;
  viewTime: number;
  headTime: number;
  /** The playback speed asked for (simulated s per wall s); Infinity is Max. */
  speed: number;
  /** A jump to a time not computed yet is in progress. */
  seeking: boolean;
  reviewing: boolean;
  pace: PaceInfo | null;
  /** The worker's recent computing speed (the average the session keeps), the fallback when the engine reports none. */
  workerSpeed: number;
}

/** What the history store holds (SnapshotStore getters). */
export interface StoreFacts {
  bytes: number;
  maxBytes: number;
  keyframes: number;
  keyframeBytes: number;
  newestBytes: number;
  frames: number;
  spacingS: number;
  displayStepS: number;
  range: { start: number; end: number } | null;
}

export interface DebugStatsInput {
  /** The newest engine report; null before the first picture. */
  engine: EngineInfo | null;
  /** 'mock' = the demo engine runs (nothing is simulated). */
  engineSource: 'real' | 'mock';
  /** The run, or null when no run was started (opened from Setup). */
  run: RunFacts | null;
  playback: PlaybackFacts | null;
  /** The 3-D view's frame statistics; null when the view cannot say (the 2-D map). */
  frames: FrameStatsInfo | null;
  /** Long tasks of the last minute; `supported` false when the browser has no such API. */
  longTasks: { supported: boolean; count: number; totalMs: number; maxMs: number };
  quality: QualityInfo | null;
  settings: { performance: 'auto' | 'battery' | 'quality'; pictureQuality?: string };
  /** The cliff drawing's statistics: null when nothing was sharpened, undefined when this build cannot say. */
  terrain: TerrainDrawStats | null | undefined;
  store: StoreFacts | null;
  /** The history budget, and the device-memory class it came from (null: the phone does not say, 3 GB is assumed). */
  historyBudget: { bytes: number; memoryGb: number | null } | null;
  /** The main thread's JavaScript heap (`performance.memory`), or null. */
  heap: { usedBytes: number; totalBytes: number | null; limitBytes: number | null } | null;
  device: DeviceNow;
  deviceLater: DeviceLater | null;
  events: readonly LogEvent[];
  /** Uncaught errors since the app started, oldest first. */
  errors: readonly string[];
  /** Texts that must never appear (a custom place's name): replaced by "<place>" in the events and errors. */
  hide?: readonly string[];
  build: { version: string; id: string; mode: string };
  clock: { nowMs: number; bootMs: number; runStartMs: number | null; tzOffsetMin: number };
  /** The bundled sites by id; a scenario whose id starts with one of them is named by it. */
  siteNames: Readonly<Record<string, string>>;
}

export interface StatRow {
  id: string;
  label: string;
  value: string;
  note?: string;
  /** The value changes while the run goes on. */
  live?: boolean;
  /** A series for the tiny chart on the screen (the row's `value` is then empty; the numbers are the row above, and in the text export). */
  spark?: (number | null)[];
}

export type GroupId =
  | 'summary'
  | 'run'
  | 'choices'
  | 'grids'
  | 'speed'
  | 'history'
  | 'step'
  | 'duty'
  | 'time'
  | 'quality'
  | 'embers'
  | 'reruns'
  | 'memory'
  | 'display'
  | 'hardware'
  | 'software'
  | 'canDo'
  | 'events';

export interface StatGroup {
  id: GroupId;
  title: string;
  /** One line shown under the title when the group is collapsed. */
  summary: string;
  rows: StatRow[];
}

export interface DebugStats {
  title: string;
  header: {
    copiedAt: string;
    app: string;
    /** "run 01:32:10 (playing)", "no run yet" ... */
    run: string;
    seed: string | null;
    /** The one word the screen shows under the title: Live, Paused, Finished, No run yet, Demo engine. */
    status: 'Live' | 'Paused' | 'Finished' | 'No run yet' | 'Demo engine';
  };
  groups: StatGroup[];
}

// ───────────────────────────── small formatters (never print undefined or NaN) ─────────────────────────────

const ok = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);
const fix = (v: number, d: number): string => v.toFixed(d);
const num = (v: number | null | undefined, d = 0, unit = ''): string => (ok(v) ? `${fix(v, d)}${unit}` : NOT_YET);
const ms = (v: number | null | undefined): string => (ok(v) ? `${v < 10 ? fix(v, 1) : fix(v, 0)}${NB}ms` : NOT_YET);
const sec = (v: number | null | undefined): string => (ok(v) ? `${v >= 10 || Math.abs(v - Math.round(v)) < 0.05 ? fix(v, 0) : fix(v, 1)}${NB}s` : NOT_YET);
const speedX = (v: number | null | undefined): string => (ok(v) ? `${v >= 10 ? fix(v, 0) : fix(v, 1)}x` : NOT_YET);
const pct = (share: number | null | undefined): string => (ok(share) ? `${fix(Math.round(share * 100), 0)}${NB}%` : NOT_YET);
const bytes = (b: number | null | undefined): string => (ok(b) ? formatBytes(b).replace(/ /g, NB) : NOT_YET);
const yesNo = (b: boolean): string => (b ? 'Yes' : 'No');
const metres = (v: number): string => `${fix(v, v < 100 && v % 1 !== 0 ? 1 : 0)}${NB}m`;
const hms = (s: number | null | undefined): string => {
  if (!ok(s)) return NOT_YET;
  const t = Math.max(0, Math.round(s));
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(Math.floor(t / 3600))}:${p(Math.floor((t % 3600) / 60))}:${p(t % 60)}`;
};
const longSpan = (s: number): string => formatDuration(s).replace(/ /g, NB);

/** "2026-10-11 14:32:05" in the phone's time (the offset is given, so the node tests do not depend on the machine's zone). */
function localStamp(nowMs: number, offsetMin: number, withDate = true): string {
  if (!ok(nowMs)) return withDate ? '----/--/-- --:--:--' : '--:--:--';
  const iso = new Date(nowMs + offsetMin * 60_000).toISOString();
  return withDate ? `${iso.slice(0, 10)} ${iso.slice(11, 19)}` : iso.slice(11, 19);
}
function offsetName(offsetMin: number): string {
  if (offsetMin === 0) return 'UTC';
  const a = Math.abs(offsetMin);
  return `UTC${offsetMin < 0 ? '-' : '+'}${Math.floor(a / 60)}${a % 60 ? `:${String(a % 60).padStart(2, '0')}` : ''}`;
}

const TIER_NAME: Record<QualityTier, string> = { fast: 'Fast (surface wind)', standard: 'Standard (3-D air)', high: 'High (finer 3-D air)' };
const MODULE_NAME: Record<string, string> = {
  air: '3-D air step',
  fire: 'Fire spread',
  coupling: 'Coupling (wind sampling, heat)',
  embers: 'Embers',
  moisture: 'Moisture and sun',
  detectors: 'Detectors and insight cards',
  picture: 'Picture build',
  checkpoints: 'Checkpoints',
  other: 'Everything else',
};

/** A line made safe to copy: first line only, links gone, long decimals (coordinates) hidden, and every text in `hide` (a place's name) replaced. */
export function scrubError(text: string, hide: readonly string[] = []): string {
  return (
    hide
      .filter((h) => h.trim().length > 1)
      .reduce((t, h) => t.split(h).join('<place>'), text)
      .split('\n')[0]!
      .replace(/\b(?:https?|capacitor|file|blob):\/\/\S*/gi, '<link>')
      .replace(/-?\d+\.\d{3,}/g, '<number>')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160) || 'Unknown error'
  );
}

/** A row without undefined keys. */
const R = (id: string, label: string, value: string, note?: string, live?: boolean): StatRow => ({ id, label, value, ...(note ? { note } : {}), ...(live ? { live } : {}) });

// ───────────────────────────── the groups ─────────────────────────────

/** Picture quality: why this tier is in use (the view knows an option or a guess; the settings say which option). */
export function pictureQualityWhy(q: Pick<QualityInfo, 'source' | 'cores' | 'memoryGb'>, s: DebugStatsInput['settings']): string {
  if (q.source === 'option') {
    if (s.pictureQuality && s.pictureQuality !== 'auto') return 'set by you';
    return s.performance === 'quality' ? 'asked for by the Detail profile' : 'asked for by the app';
  }
  const cores = ok(q.cores) ? `${q.cores} cores` : 'cores not reported (counted as 4)';
  const mem = ok(q.memoryGb) ? `${q.memoryGb} GB` : 'memory not reported (counted as 4 GB)';
  return `guessed from this phone: ${cores}, ${mem}`;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function phoneClass(d: DeviceNow): string {
  return `${ok(d.cores) ? `${d.cores} cores` : 'cores not reported'}, ${ok(d.memoryGb) ? `about ${d.memoryGb}${NB}GB memory class` : 'memory class not reported'}`;
}

function bundledSite(id: string, sites: Readonly<Record<string, string>>): string | null {
  const key = Object.keys(sites).find((k) => id.startsWith(`${k}-`));
  return key ? sites[key]! : null;
}

function pacePhrase(p: PaceInfo | null): string {
  if (!p) return 'Not judged now (paused, as fast as possible, jumping, or hidden)';
  return p.level === 'ok' ? 'Keeping up' : p.level === 'behind' ? 'Falling behind the speed asked for' : 'Waiting for the simulation';
}

function summaryGroup(i: DebugStatsInput): StatGroup {
  const e = i.engine;
  const phone = phoneClass(i.device);
  let line: string;
  if (i.engineSource === 'mock') line = `The demo engine is running: nothing is simulated, so there are no engine numbers. This phone: ${phone}.`;
  else if (!e) line = i.run ? `The engine has not reported yet. This phone: ${phone}.` : `${NO_RUN}. This phone: ${phone}.`;
  else {
    const s = e.perf?.speed.s10 ?? e.run.simSecondsPerWallSecond;
    const wanted = i.playback ? (Number.isFinite(i.playback.speed) ? `${speedX(i.playback.speed)} asked for` : 'as fast as possible asked for') : null;
    line =
      `${TIER_NAME[e.tier]}, computing ${ok(s) ? `about ${speedX(s)}` : 'at a speed not measured yet'}${wanted ? ` (${wanted})` : ''}; ` +
      `engine memory ${e.memory ? bytes(e.memory.totalBytes) : 'not measured yet'}; this phone: ${phone}.`;
  }
  return { id: 'summary', title: 'Summary', summary: line, rows: [R('headline', 'In one line', line, undefined, true)] };
}

function runGroup(i: DebugStatsInput): StatGroup {
  const { build, device: d, clock } = i;
  const rows: StatRow[] = [
    R('app', 'App version', build.version),
    R('build', 'Build', `${build.id} (${build.mode})`),
    R('platform', 'Platform', d.platform === 'web' ? 'Web browser' : `${d.platform} (the app)`),
    R('engine-source', 'Engine', i.engineSource === 'mock' ? 'Demo engine (nothing is simulated)' : 'Full model'),
  ];
  const r = i.run;
  if (!r) {
    rows.push(R('place', 'Place', NO_RUN), R('clock', 'Run clock', NO_RUN, undefined, true));
  } else {
    const site = bundledSite(r.id, i.siteNames);
    const p = i.playback;
    rows.push(
      R('place', 'Place', site ?? 'A custom place (its name and position are never copied)'),
      R('area', 'Area', `${fix(r.extentM / 1000, r.extentM % 1000 ? 1 : 0)}${NB}km square`),
      R('cell', 'Fire cell', metres(r.fireCellM)),
      R('duration', 'Run length', longSpan(r.durationS)),
      R('start', 'Scenario start', ok(r.startTimeMs) ? `${new Date(r.startTimeMs).toISOString().slice(0, 16).replace('T', ' ')} UTC` : NOT_YET),
      R('seed', 'Seed', String(r.seed)),
      R('deterministic', 'Deterministic', i.engine ? (i.engine.run.deterministic ? 'Yes: the same choices give exactly the same result' : 'No') : NOT_YET),
      R('clock', 'Run clock', p ? hms(p.viewTime) : NOT_YET, p?.reviewing ? 'Looking at an earlier time' : undefined, true),
      R('computed', 'Computed up to', p ? hms(p.headTime) : NOT_YET, undefined, true),
      R('wall-run', 'Wall time since the run started', ok(clock.runStartMs) ? waited(clock.nowMs - clock.runStartMs) : NOT_YET, undefined, true),
    );
  }
  rows.push(R('wall-boot', 'Wall time since the app started', waited(clock.bootMs), undefined, true));
  return { id: 'run', title: 'Run', summary: r ? `${bundledSite(r.id, i.siteNames) ?? 'A custom place'}, ${fix(r.extentM / 1000, r.extentM % 1000 ? 1 : 0)} km, ${metres(r.fireCellM)} cells, seed ${r.seed}` : NO_RUN, rows };
}

function choicesGroup(i: DebugStatsInput): StatGroup {
  const e = i.engine;
  if (!e) return { id: 'choices', title: 'Choices', summary: i.engineSource === 'mock' ? 'Demo engine' : NO_RUN, rows: [R('tier', 'Tier in use', i.engineSource === 'mock' ? 'Demo engine' : NO_RUN)] };
  const a = e.autoTune;
  const cadence = e.cadence;
  const rows: StatRow[] = [
    R('tier', 'Tier in use', TIER_NAME[e.tier], e.tierReason, true),
    R('requested', 'Tier asked for', e.tierRequested === 'auto' ? 'Auto (decided when the run starts, from a short timing test on this phone)' : TIER_NAME[e.tierRequested]),
    R('cause', 'How it was decided', { requested: 'Asked for at the start', 'auto-tune': 'The timing test', 'auto-pending': 'The timing test is still running', 'auto-default': 'Auto without a timing test', changed: 'Changed during the run' }[e.tierCause]),
  ];
  if (e.tierChangedAt !== null) rows.push(R('changed-at', 'Tier changed at', hms(e.tierChangedAt)));
  if (a) {
    const warm = ok(a.warmupMeanMs) ? `; the warm-up steps before it averaged ${ms(a.warmupMeanMs)}` : '';
    rows.push(
      R(
        'autotune',
        'Timing test',
        `${ms(a.stepMs)} per 3-D air step over ${a.steps} steps${warm}`,
        `Predicted ${sec(a.predictedS)} for the whole run against a limit of ${sec(a.budgetS)}; chose ${TIER_NAME[a.chosen]}`,
      ),
    );
  } else if (e.tierRequested === 'auto') rows.push(R('autotune', 'Timing test', NOT_YET));
  rows.push(
    R('display-step', 'Display step', `A picture every ${longSpan(cadence.displayStepS)}`),
    R('solver-limit', 'Solver step limit', cadence.solverMaxStepS > 0 ? `${sec(cadence.solverMaxStepS)} (your setting)` : `Automatic (${sec(cadence.solverFloorS)} to ${sec(cadence.solverBoundS)})`),
    R('playback', 'Playback speed asked for', i.playback ? (Number.isFinite(i.playback.speed) ? speedX(i.playback.speed) : 'Max (as fast as possible)') : NO_RUN, i.playback && Number.isFinite(i.playback.speed) ? formatSpeedHint(i.playback.speed) : undefined, true),
    R('coupling', 'Fire and air feedback', e.models.coupling <= 0 ? 'Off' : `On, strength ${fix(e.models.coupling, 2)}`),
    R('embers', 'Embers', e.models.embersOn ? 'On' : 'Off'),
    R('mountain', 'Mountain phenomena', e.models.mountainPhenomena ? 'On' : 'Off'),
  );
  return { id: 'choices', title: 'Choices', summary: `${TIER_NAME[e.tier]}; ${e.tierRequested === 'auto' ? 'Auto' : 'chosen by you'}`, rows };
}

function gridsGroup(i: DebugStatsInput): StatGroup {
  const e = i.engine;
  if (!e) return { id: 'grids', title: 'Grids', summary: i.engineSource === 'mock' ? 'Demo engine' : NO_RUN, rows: [R('atmosphere', 'Atmosphere grid', i.engineSource === 'mock' ? 'None (demo engine)' : NO_RUN)] };
  const a = e.atmosphere;
  const f = e.fire;
  return {
    id: 'grids',
    title: 'Grids',
    summary: `Air ${a.nx} x ${a.ny} x ${a.nz}, ${metres(a.dxM)}; fire ${f.nx} x ${f.ny}, ${metres(f.cellM)}`,
    rows: [
      R('atmosphere', 'Atmosphere grid', `${a.nx} x ${a.ny} x ${a.nz} cells (${a.kind === '3d' ? 'time-stepped 3-D air' : 'a surface wind fitted to the terrain'})`),
      R('spacing', 'Atmosphere spacing', metres(a.dxM)),
      R('first-layer', 'First layer thickness', metres(a.dzFirstM)),
      R('top', 'Model top above the lowest ground', metres(a.topM)),
      R('stretch', 'Level stretch ratio', fix(a.stretch, 2)),
      R('spun-up', '3-D spin-up', a.kind === '3d' ? (a.spunUp ? 'Finished' : 'Not finished') : 'Not used in this tier', undefined, true),
      R('upper-air', 'Upper air from', { model: 'A weather model', preset: 'A designed preset air mass', synthetic: 'A standard profile (synthetic)', none: 'None' }[a.upperAir]),
      R('view-decimated', 'Air in the pictures', a.viewDecimated ? 'Halved for display' : 'Full grid'),
      R('fire-grid', 'Fire grid', `${f.nx} x ${f.ny} cells, ${metres(f.cellM)} apart`),
      R('sub-step', 'Fire sub-step now', f.currentSubStepS === null ? 'No front moving' : sec(f.currentSubStepS), undefined, true),
    ],
  };
}

function speedGroup(i: DebugStatsInput): StatGroup {
  const e = i.engine;
  const sp = e?.perf?.speed;
  const p = i.playback;
  const pace = p?.pace ?? null;
  const rows: StatRow[] = [];
  if (sp) {
    rows.push(
      R('s10', 'Computing speed, last 10 s', speedX(sp.s10), 'Simulated seconds per wall second while the worker is computing (idle time left out)', true),
      R('s60', 'Computing speed, last 60 s', speedX(sp.s60), undefined, true),
      R('mean', 'Computing speed, whole run on this tier', speedX(sp.mean), undefined, true),
      R('best10', 'Best 10 s window', speedX(sp.best10), undefined, true),
      R('worst10', 'Worst 10 s window', speedX(sp.worst10), undefined, true),
    );
  } else {
    const s = e?.run.simSecondsPerWallSecond;
    rows.push(R('s10', 'Computing speed, recent', e ? speedX(s) : NO_RUN, e ? 'This engine reports one recent figure only' : undefined, true));
    if (p && ok(p.workerSpeed) && p.workerSpeed > 0) rows.push(R('worker', 'Computing speed, average of recent chunks', speedX(p.workerSpeed), undefined, true));
  }
  rows.push(
    R('wanted', 'Playback speed asked for', p ? (Number.isFinite(p.speed) ? speedX(p.speed) : 'Max (as fast as possible)') : NO_RUN, p && Number.isFinite(p.speed) ? formatSpeedHint(p.speed) : undefined, true),
    R('achieved', 'Playback speed achieved, last 10 s', pace ? (ok(pace.achieved) ? speedX(pace.achieved) : 'Not measured yet (needs 10 s of play)') : 'Not judged now', undefined, true),
    R('waiting', 'Share of the last 10 s playback waited for the simulation', pace ? pct(pace.waitingShare) : 'Not judged now', undefined, true),
    R('pace', 'Pace signal', pacePhrase(pace), undefined, true),
  );
  const s10 = sp?.s10;
  return { id: 'speed', title: 'Speed', summary: ok(s10) ? `Computing about ${speedX(s10)}; ${pacePhrase(pace).toLowerCase()}` : e ? 'Computing speed not measured yet' : NO_RUN, rows };
}

function historyGroup(i: DebugStatsInput): StatGroup {
  const h = i.engine?.perf?.history;
  const have = !!h && h.some(ok);
  return {
    id: 'history',
    title: 'Speed history',
    summary: have ? `${h!.filter(ok).length} samples` : i.engine?.perf ? NOT_YET : NA,
    rows: [
      R(
        'samples',
        'Computing speed, one sample per 30 s of computing, oldest first',
        have ? h!.map((v) => (ok(v) ? fix(v, v >= 10 ? 0 : 1) : '-')).join(' ') : i.engine?.perf ? NOT_YET : i.engine ? 'Not reported by this engine' : NO_RUN,
        have ? 'x real time' : undefined,
        true,
      ),
      ...(have ? [{ id: 'chart', label: 'Chart', value: '', spark: h!.slice(), live: true } as StatRow] : []),
    ],
  };
}

function stepGroup(i: DebugStatsInput): StatGroup {
  const e = i.engine;
  const st = e?.perf?.step;
  if (!e) return { id: 'step', title: 'Step', summary: NO_RUN, rows: [R('outer', 'Outer step now', NO_RUN)] };
  const trio = (a: number | null, b: number | null, c: number | null): string => (ok(a) && ok(b) && ok(c) ? `${sec(a)} (shortest ${sec(b)}, longest ${sec(c)})` : NOT_YET);
  const rows: StatRow[] = [
    R('outer', 'Outer step now', st ? trio(st.nowS, st.minS, st.maxS) : sec(e.atmosphere.currentStepS), undefined, true),
    R('mean-outer', 'Outer step, mean', st ? sec(st.meanS) : NOT_YET, undefined, true),
    R('steps', 'Steps taken', String(e.run.steps), 'All tiers, re-runs included', true),
    R('whole-mean', 'Whole step, mean wall time', ms(e.run.meanStepMs), 'Fire, air, embers and detectors together, this tier', true),
  ];
  if (st) {
    rows.push(
      R('whole-median', 'Whole step, median (last 128)', ms(st.medianMs), undefined, true),
      R('whole-p95', 'Whole step, 95th percentile (last 128)', ms(st.p95Ms), undefined, true),
      R('whole-max', 'Whole step, longest (last 128)', ms(st.maxMs), undefined, true),
      R('over', 'Steps over 100 ms and over 250 ms', `${st.over100} and ${st.over250}`, 'Since this tier started', true),
    );
  }
  rows.push(R('air-mean', '3-D air step, mean wall time', e.atmosphere.kind === '3d' ? ms(e.atmosphere.meanStepMs) : 'Not used in this tier', undefined, true));
  return { id: 'step', title: 'Step', summary: `Whole step ${st && ok(st.medianMs) ? `about ${ms(st.medianMs)}` : ms(e.run.meanStepMs)}`, rows };
}

function dutyGroup(i: DebugStatsInput): StatGroup {
  const d = i.engine?.perf?.duty;
  return {
    id: 'duty',
    title: 'Worker duty',
    summary: d ? `${pct(d.s10)} busy over 10 s` : i.engine ? NA : NO_RUN,
    rows: d
      ? [R('s10', 'Share of wall time computing, last 10 s', pct(d.s10), 'Near 100 % means flat out; low means waiting to be watched', true), R('s60', 'Share of wall time computing, last 60 s', pct(d.s60), undefined, true)]
      : [R('s10', 'Share of wall time computing', i.engine ? 'Not reported by this engine' : NO_RUN)],
  };
}

function timeGroup(i: DebugStatsInput): StatGroup {
  const mods = i.engine?.perf?.modules ?? [];
  const rows = mods.map((m) =>
    R(m.id, MODULE_NAME[m.id] ?? cap(m.id), ok(m.ms) ? `${ms(m.ms)} per step, ${pct(m.share)} of busy time` : NOT_YET, ok(m.share10) ? `Last 10 s: ${pct(m.share10)}` : undefined, true),
  );
  const top = mods.filter((m) => ok(m.share)).sort((a, b) => b.share! - a.share!)[0];
  return {
    id: 'time',
    title: 'Where the time goes',
    summary: top ? `${MODULE_NAME[top.id] ?? cap(top.id)} ${pct(top.share)}` : i.engine ? NA : NO_RUN,
    rows: rows.length ? rows : [R('none', 'Per-module time', i.engine ? 'Not reported by this engine' : NO_RUN)],
  };
}

function qualityGroup(i: DebugStatsInput): StatGroup {
  const q = i.engine?.perf?.quality;
  if (!q) return { id: 'quality', title: 'Step quality', summary: i.engine ? NA : NO_RUN, rows: [R('none', 'Step quality', i.engine ? 'Not reported by this engine' : NO_RUN)] };
  const lim = q.limitedBy;
  return {
    id: 'quality',
    title: 'Step quality',
    summary: lim ? `Air steps limited by ${lim.cflH >= lim.cflV && lim.cflH >= lim.cap && lim.cflH >= lim.user ? 'horizontal wind' : lim.cflV >= lim.cap && lim.cflV >= lim.user ? 'vertical wind' : lim.cap >= lim.user ? 'the step cap' : 'your limit'} mostly` : 'No air steps counted',
    rows: [
      R(
        'limited-by',
        'Air steps limited by',
        lim ? `horizontal wind ${pct(lim.cflH)}, vertical wind ${pct(lim.cflV)}, the ${sec(i.engine!.cadence.solverBoundS)} cap ${pct(lim.cap)}, your limit ${pct(lim.user)}` : 'Not counted (no 3-D air steps yet, or the fast tier)',
        undefined,
        true,
      ),
      R('max-wind-h', 'Strongest horizontal wind in the air steps', ok(q.maxWindH) ? `${fix(q.maxWindH, 1)}${NB}m/s` : NOT_YET, undefined, true),
      R('max-wind-v', 'Strongest vertical wind in the air steps', ok(q.maxWindV) ? `${fix(q.maxWindV, 1)}${NB}m/s` : NOT_YET, undefined, true),
      R('projection', 'Pressure corrections per air step', num(q.projectionCorrections, 1), undefined, true),
      R('spin-up', '3-D spin-up wall time', ok(q.spinUpWallS) ? (q.spinUpWallS > 0 ? sec(q.spinUpWallS) : 'None (fast tier)') : NOT_YET),
      R('fire-sub', 'Fire sub-steps per outer step', num(q.fireSubSteps, 1), undefined, true),
      R('burning', 'Burning cells', ok(q.burningCells) ? String(Math.round(q.burningCells)) : NOT_YET, undefined, true),
    ],
  };
}

function embersGroup(i: DebugStatsInput): StatGroup {
  const e = i.engine;
  if (!e) return { id: 'embers', title: 'Embers', summary: i.engineSource === 'mock' ? 'Demo engine' : NO_RUN, rows: [R('tracked', 'Tracked embers', i.engineSource === 'mock' ? 'None (demo engine)' : NO_RUN)] };
  const t = e.perf?.embers;
  return {
    id: 'embers',
    title: 'Embers',
    summary: e.embers.on ? `${e.embers.active} of ${e.embers.max} tracked` : 'Switched off',
    rows: [
      R('tracked', 'Tracked embers now', e.embers.on ? `${e.embers.active} of ${e.embers.max}` : 'Switched off', 'Each tracked particle can stand for several real firebrands', true),
      R('spawned', 'Embers released, whole run', t ? String(t.spawned) : 'Not counted by this engine', undefined, true),
      R('landed', 'Embers landed, whole run', t ? String(t.landed) : 'Not counted by this engine', undefined, true),
    ],
  };
}

function rerunsGroup(i: DebugStatsInput): StatGroup {
  const r = i.engine?.perf?.reruns;
  return {
    id: 'reruns',
    title: 'Re-runs',
    summary: r ? `${r.rewinds} rewinds, ${r.tierSwitches} tier switches` : i.engine ? NA : NO_RUN,
    rows: r
      ? [
          R('rewinds', 'Rewinds (a change in the past)', String(r.rewinds), undefined, true),
          R('recomputed', 'Simulated time computed again', longSpan(r.recomputedS), undefined, true),
          R('tier-switches', 'Tier switches', String(r.tierSwitches), undefined, true),
          R('restores', 'Checkpoint restores', String(r.restores), undefined, true),
        ]
      : [R('none', 'Re-runs', i.engine ? 'Not reported by this engine' : NO_RUN)],
  };
}

function memoryGroup(i: DebugStatsInput): StatGroup {
  const e = i.engine;
  const s = i.store;
  const rows: StatRow[] = [];
  if (e?.memory) {
    const top = [...e.memory.parts].sort((a, b) => b.bytes - a.bytes).slice(0, 3);
    rows.push(
      R('engine', 'Engine memory (measured)', bytes(e.memory.totalBytes), `Measured at ${hms(e.memory.measuredAt)} of fire time; the largest parts: ${top.map((p) => `${p.name} ${bytes(p.bytes)}`).join(', ')}`, true),
    );
  } else rows.push(R('engine', 'Engine memory (measured)', e ? NOT_YET : NO_RUN, undefined, true));
  rows.push(R('checkpoints', 'Checkpoints (rewind points)', e ? `${e.run.checkpoints} held, ${bytes(e.run.checkpointBytes)}` : NO_RUN, undefined, true));
  const b = i.historyBudget;
  rows.push(
    R(
      'history-budget',
      'History budget (the time scrubber)',
      b ? bytes(b.bytes) : NOT_YET,
      b ? `6 % of the ${b.memoryGb !== null ? `${b.memoryGb} GB memory class` : 'memory class (3 GB assumed: this phone does not report it)'}, between 48 and 160 MB` : undefined,
    ),
  );
  if (s) {
    const expected = s.range && s.displayStepS > 0 ? Math.floor((s.range.end - s.range.start) / s.displayStepS) + 1 : 0;
    const thinned = Math.max(0, expected - s.frames);
    rows.push(
      R('history-held', 'History held', `${bytes(s.bytes)}${s.maxBytes > 0 ? ` of ${bytes(s.maxBytes)}` : ''}`, undefined, true),
      R('full-pictures', 'Full pictures (keyframes)', String(s.keyframes), `About ${bytes(s.keyframes > 0 ? s.keyframeBytes / s.keyframes : null)} each; the newest picture is ${bytes(s.newestBytes)}`, true),
      R('light-frames', 'Light frames kept', String(s.frames), undefined, true),
      R('thinned', 'Frames thinned away', s.frames > 0 ? `About ${thinned}` : NOT_YET, `Kept frames are now about ${sec(s.spacingS)} apart (display step ${sec(s.displayStepS)})`, true),
    );
  } else rows.push(R('history-held', 'History held', NO_RUN));
  const h = i.heap;
  rows.push(
    R('heap', 'JavaScript heap, screen thread', h ? `${bytes(h.usedBytes)} used${h.totalBytes !== null ? ` of ${bytes(h.totalBytes)}` : ''}${h.limitBytes !== null ? `, limit ${bytes(h.limitBytes)}` : ''}` : 'Not available on this phone (its browser engine does not report it)', 'The simulation worker and the graphics memory are not in it', true),
  );
  const st = i.deviceLater?.storage;
  rows.push(R('storage', 'Storage used by the app', st ? `${bytes(st.usage)} of ${bytes(st.quota)}` : i.deviceLater ? NA : 'Reading...', undefined, true));
  return { id: 'memory', title: 'Memory', summary: e?.memory ? `Engine ${bytes(e.memory.totalBytes)}${s ? `; history ${bytes(s.bytes)}` : ''}` : s ? `History ${bytes(s.bytes)}` : NO_RUN, rows };
}

function displayGroup(i: DebugStatsInput): StatGroup {
  const f = i.frames;
  const lt = i.longTasks;
  const q = i.quality;
  const rows: StatRow[] = [];
  if (f) {
    rows.push(
      R('fps', 'Frame rate, last 10 s', ok(f.fps10) ? `${fix(f.fps10, 0)} frames per second` : NOT_YET, 'The scene stops drawing while a full-screen screen is open, so this is the last seconds before it opened', true),
      R('frame-mean', 'Frame time, mean and 95th percentile', ok(f.frameMeanMs) && ok(f.frameP95Ms) ? `${ms(f.frameMeanMs)} and ${ms(f.frameP95Ms)}` : NOT_YET, `Over the last ${f.frames} frames`, true),
      R('slow-frames', 'Frames slower than 30 per second, and over 100 ms', `${f.over33} and ${f.over100}`, `Of the last ${f.frames} frames`, true),
    );
  } else rows.push(R('fps', 'Frame rate, last 10 s', 'Not available (the 2-D map keeps no frame statistics)'));
  rows.push(
    R(
      'long-tasks',
      'Long tasks, last 60 s',
      lt.supported ? `${lt.count} (${ms(lt.totalMs)} in all, longest ${ms(lt.maxMs)})` : 'Not available on this phone (its browser engine does not report them)',
      lt.supported ? 'Moments over 50 ms when the screen thread was busy' : undefined,
      true,
    ),
  );
  if (f) {
    rows.push(
      R('draw-calls', 'Draw calls and triangles', `${f.drawCalls} and ${f.triangles}`, undefined, true),
      R('textures', 'Textures held by the graphics card', String(f.textures), undefined, true),
      R('pixel-ratio', 'Pixel ratio used and its cap', `${fix(f.pixelRatio, 2)} and ${fix(f.pixelRatioCap, 2)}`, `The adaptive resolution has lowered it ${f.dprDrops} ${f.dprDrops === 1 ? 'time' : 'times'}`, true),
      R('canvas', 'Drawing size', `${f.canvasW} x ${f.canvasH} pixels`, undefined, true),
      R('last-draw', 'Last frame drawn', ok(f.lastDrawAgeS) ? `${fix(f.lastDrawAgeS, f.lastDrawAgeS < 10 ? 1 : 0)}${NB}s ago` : NOT_YET, undefined, true),
    );
  }
  if (q) {
    rows.push(
      R('picture-quality', 'Picture quality in use', `${cap(q.tier)} (${pictureQualityWhy(q, i.settings)})`),
      R(
        'picture-sets',
        'What that tier sets',
        `terrain ${q.terrainSamples} x ${q.terrainSamples} samples, ${q.treeBudget} trees, ${Math.round(q.canopyTriangles / 1000)}k canopy triangles, pixel ratio cap ${fix(q.pixelRatioCap, 2)}, ${q.flameSites} flame sites, ${q.smokePuffs} smoke puffs, tree sway ${q.treeSwayDefault ? 'on' : 'off'} by default`,
      ),
    );
  } else rows.push(R('picture-quality', 'Picture quality in use', 'Not available (the 2-D map has no picture tiers)'));
  const t = i.terrain;
  if (t) {
    const t0 = (v: number | null): string => (ok(v) ? ms(v) : NOT_YET);
    rows.push(
      R(
        'cliffs',
        'Cliff drawing (once per scenario)',
        `${ok(t.sharpenedShare) ? `${pct(t.sharpenedShare)} of the 10 m cells moved` : 'Share moved not measured'}; sharpening ${t0(t.sharpenMs)}, rock mask ${t0(t.maskMs)}, mesh ${t0(t.meshMs)}, lighting ${t0(t.gradientMs)}`,
        `${t.meshVertices} vertices, ${t.meshTriangles} triangles; rock detail in the shader: ${t.rockDetail}`,
      ),
    );
  } else if (t === null) rows.push(R('cliffs', 'Cliff drawing (once per scenario)', 'Nothing sharpened in this run (no 10 m terrain)'));
  const fpsText = f && ok(f.fps10) ? `${fix(f.fps10, 0)} frames per second` : 'frame rate not measured yet';
  return { id: 'display', title: 'Display (main thread)', summary: q ? `${cap(q.tier)} picture; ${fpsText}` : fpsText, rows };
}

function hardwareGroup(i: DebugStatsInput): StatGroup {
  const d = i.device;
  const l = i.deviceLater;
  const id = phoneIdentity(d, l);
  const from = (w: string): string => (w === 'hidden' ? 'hidden by the WebView' : w === 'none' ? 'not reported' : `from the ${w}`);
  const hints = l?.hints ?? null;
  const rows: StatRow[] = [
    R(
      'model',
      'Maker and model',
      id.model ? `${id.maker ? `${id.maker} ` : ''}${id.model}` : id.modelFrom === 'hidden' ? 'Hidden by the WebView' : 'Not reported',
      id.model ? `${cap(from(id.modelFrom))}${id.maker ? '; the maker is guessed from the model name' : ''}` : id.modelFrom === 'hidden' ? 'Its user agent is reduced ("Android 10; K")' : undefined,
    ),
    R(
      'android',
      'Android version',
      id.androidVersion ? `${id.androidVersion}${id.apiLevel ? ` (API level ${id.apiLevel})` : ''}` : id.androidFrom === 'hidden' ? 'Hidden by the WebView' : d.platform === 'web' ? 'Not Android' : 'Not reported',
      id.androidVersion ? cap(from(id.androidFrom)) : undefined,
    ),
    R('cores', 'CPU cores', ok(d.cores) ? String(d.cores) : 'Not reported'),
    R('arch', 'Architecture and bitness', hints && (hints.architecture || hints.bitness) ? `${hints.architecture ?? 'not reported'}, ${hints.bitness ? `${hints.bitness}-bit` : 'bitness not reported'}` : l ? 'Not reported (needs Client Hints)' : 'Reading...'),
    R('memory-class', 'Memory class', ok(d.memoryGb) ? `About ${d.memoryGb}${NB}GB` : 'Not reported', 'A coarse bucket the browser reports, not the real size'),
    R('screen', 'Screen', d.screenCss ? `${d.screenCss[0]} x ${d.screenCss[1]} CSS pixels${ok(d.pixelRatio) ? `, about ${Math.round(d.screenCss[0] * d.pixelRatio)} x ${Math.round(d.screenCss[1] * d.pixelRatio)} device pixels` : ''}` : 'Not reported', undefined, true),
    R('window', 'Window', d.windowCss ? `${d.windowCss[0]} x ${d.windowCss[1]} CSS pixels` : 'Not reported', undefined, true),
    R('pixel-ratio', 'Pixel ratio', ok(d.pixelRatio) ? fix(d.pixelRatio, 2) : 'Not reported'),
    R('refresh', 'Refresh rate', l ? (ok(l.refreshHz) ? `About ${l.refreshHz}${NB}Hz` : 'Not measured (frames did not come in time)') : 'Reading...', 'Measured from 30 animation frames'),
    R('touch', 'Touch points', d.touchPoints === null ? 'Not reported' : String(d.touchPoints)),
    R('battery', 'Battery', l ? (l.battery ? `${Math.round(l.battery.level * 100)}${NB}%, ${l.battery.charging ? 'charging' : 'not charging'}` : 'Not available on this phone') : 'Reading...', undefined, true),
  ];
  return { id: 'hardware', title: 'Phone: hardware', summary: `${id.model ? `${id.maker ? `${id.maker} ` : ''}${id.model}` : id.modelFrom === 'hidden' ? 'Model hidden by the WebView' : 'Model not reported'}; ${phoneClass(d)}`, rows };
}

function softwareGroup(i: DebugStatsInput): StatGroup {
  const d = i.device;
  const l = i.deviceLater;
  const id = phoneIdentity(d, l);
  const rows: StatRow[] = [
    R('webview', 'WebView or browser', `${id.webview ? 'Android WebView' : 'Chromium-based browser'} ${id.chromium ?? '(version not reported)'}`, d.brands.length ? `Brands: ${d.brands.join(', ')}` : d.hintsPresent ? undefined : 'This browser sends no Client Hints'),
    R('user-agent', 'User agent (as the WebView reports it)', d.userAgent || 'Not reported'),
  ];
  if (!l) rows.push(R('graphics', 'Graphics and features', 'Reading...'));
  else {
    const g = l.gl;
    rows.push(
      R('webgl2', 'WebGL2', g.ok ? 'Yes' : 'No: the 3-D view cannot run, the 2-D map is used', g.ok ? undefined : 'A WebGL2 context could not be made'),
      R('gpu', 'GPU vendor and renderer', g.ok ? `${g.vendor ?? 'vendor hidden'}, ${g.renderer ?? 'renderer hidden'}` : NA),
      R('max-texture', 'Largest texture', g.ok ? num(g.maxTextureSize) : NA),
      R('float-targets', 'Float and half-float render targets', g.ok ? `${yesNo(g.floatTargets)} and ${yesNo(g.halfFloatTargets)}` : NA, g.ok ? `Float textures can be filtered: ${yesNo(g.floatLinear).toLowerCase()}` : undefined),
      R('compressed', 'Compressed textures', g.ok ? (g.compressed.length ? g.compressed.join(', ') : 'None') : NA),
      R('webgpu', 'WebGPU', l.gpu.present ? (l.gpu.adapter ? `Yes, ${l.gpu.adapter.vendor ?? 'vendor hidden'} ${l.gpu.adapter.architecture ?? ''}`.trim() : 'Present, but it gave no adapter in time') : 'No'),
      R('wasm', 'WebAssembly and SIMD', `${yesNo(l.wasm)} and ${yesNo(l.simd)}`),
      R('shared', 'Shared memory between threads', `SharedArrayBuffer ${yesNo(l.sharedArrayBuffer).toLowerCase()}; cross-origin isolated ${l.crossOriginIsolated === null ? 'not reported' : yesNo(l.crossOriginIsolated).toLowerCase()}`),
      R('workers', 'Offscreen canvas and module workers', `${yesNo(l.offscreenCanvas)} and ${yesNo(l.moduleWorkers)}`),
    );
  }
  const media = (v: boolean | null, on: string, off: string): string => (v === null ? 'not reported' : v ? on : off);
  rows.push(R('preferences', 'Reduced motion, contrast, colour scheme', `${media(d.reducedMotion, 'reduced motion asked for', 'no motion preference')}; ${media(d.moreContrast, 'more contrast asked for', 'no contrast preference')}; ${media(d.darkScheme, 'dark', 'light')} scheme`));
  return {
    id: 'software',
    title: 'Phone: software and graphics',
    summary: `${id.webview ? 'Android WebView' : 'Browser'} ${id.chromium ?? '(version not reported)'}${l ? `; ${l.gl.ok ? `WebGL2, ${l.gl.renderer ?? 'GPU name hidden'}` : 'no WebGL2'}` : ''}`,
    rows,
  };
}

function canDoGroup(i: DebugStatsInput): StatGroup {
  const e = i.engine;
  const l = i.deviceLater;
  const sp = e?.perf?.speed;
  const a = e?.autoTune;
  let airFast: string;
  if (!e) airFast = i.engineSource === 'mock' ? 'The demo engine is running, so nothing was measured.' : 'No run has measured this phone yet. Start a run, or look here again during one.';
  else if (e.atmosphere.kind === '3d') {
    airFast = `On this phone the 3-D air step takes about ${ms(e.atmosphere.meanStepMs)} on average${a && a.chosen !== 'fast' ? ` (${ms(a.stepMs)} in the timing test)` : ''}, and the run computes at about ${speedX(sp?.mean ?? e.run.simSecondsPerWallSecond)} real time.`;
  } else
    airFast = `The fast model has computed this run at about ${speedX(sp?.mean ?? e.run.simSecondsPerWallSecond)} real time${a && a.chosen === 'fast' ? `; the 3-D air step took about ${ms(a.stepMs)} in the timing test` : ''}.`;
  const heap = i.heap;
  const mem =
    e?.memory && heap && heap.limitBytes !== null
      ? `The engine holds ${bytes(e.memory.totalBytes)}; the screen thread's JavaScript heap is ${bytes(heap.usedBytes)} of a ${bytes(heap.limitBytes)} limit (the engine's own memory is not in that heap).`
      : e?.memory
        ? `The engine holds ${bytes(e.memory.totalBytes)}; this phone does not report the screen thread's heap limit.`
        : 'Memory has not been measured yet.';
  const gfx = !l
    ? 'The graphics probe is still running.'
    : l.gl.ok
      ? `Graphics: WebGL2 on ${l.gl.renderer ?? 'a GPU whose name is hidden'}, float render targets ${l.gl.floatTargets ? 'yes' : 'no'}, WebGPU ${l.gpu.present ? 'present' : 'absent'}.`
      : 'Graphics: WebGL2 is not available, so the 3-D view cannot run and the 2-D map is used.';
  return {
    id: 'canDo',
    title: 'What this phone can do',
    summary: 'Three sentences from the measurements above',
    rows: [R('speed', 'Speed', airFast, undefined, true), R('memory', 'Memory', mem, undefined, true), R('graphics', 'Graphics', gfx)],
  };
}

function eventsGroup(i: DebugStatsInput): StatGroup {
  const off = i.clock.tzOffsetMin;
  const rows: StatRow[] = [...i.events]
    .reverse()
    .slice(0, 40)
    .map((e, n) => R(`e${n}`, `${localStamp(e.wallMs, off, false)} (${e.runS === null ? 'no run clock' : `run ${hms(e.runS)}`})`, scrubError(e.text, i.hide)));
  const errs = i.errors.slice(-5).reverse();
  errs.forEach((t, n) => rows.push(R(`x${n}`, `Uncaught error ${n + 1}`, scrubError(t, i.hide))));
  if (!rows.length) rows.push(R('none', 'Events', 'Nothing yet'));
  return { id: 'events', title: 'Recent events', summary: `${i.events.length} events, ${i.errors.length} uncaught errors (newest first)`, rows };
}

// ───────────────────────────── the whole thing ─────────────────────────────

export function buildDebugStats(input: DebugStatsInput): DebugStats {
  // The demo engine (mock: true, or told so by the app) has no engine numbers: every group sees "no engine" and says why.
  const mock = input.engineSource === 'mock' || !!input.engine?.mock;
  const i: DebugStatsInput = mock ? { ...input, engineSource: 'mock', engine: null } : input;
  const p = i.playback;
  const ended = !!(i.run && p && p.viewTime >= i.run.durationS - 1);
  const status: DebugStats['header']['status'] = mock ? 'Demo engine' : !i.run ? 'No run yet' : ended ? 'Finished' : p?.playing ? 'Live' : 'Paused';
  const runText = !i.run ? 'no run yet' : `run ${hms(p?.viewTime)}${status === 'Paused' ? ' (paused)' : status === 'Finished' ? ' (finished)' : ''}`;
  return {
    title: TITLE,
    header: {
      copiedAt: `${localStamp(i.clock.nowMs, i.clock.tzOffsetMin)} (${offsetName(i.clock.tzOffsetMin)})`,
      app: `app ${i.build.version} (build ${i.build.id}, ${i.build.mode})`,
      run: runText,
      seed: i.run ? `seed ${i.run.seed}` : null,
      status,
    },
    groups: [
      summaryGroup(i),
      runGroup(i),
      choicesGroup(i),
      gridsGroup(i),
      speedGroup(i),
      historyGroup(i),
      stepGroup(i),
      dutyGroup(i),
      timeGroup(i),
      qualityGroup(i),
      embersGroup(i),
      rerunsGroup(i),
      memoryGroup(i),
      displayGroup(i),
      hardwareGroup(i),
      softwareGroup(i),
      canDoGroup(i),
      eventsGroup(i),
    ],
  };
}

/** The plain-text export: title, one header line, every group, and an end marker. Stable labels; one row per line. */
export function debugStatsToText(s: DebugStats): string {
  const h = s.header;
  const out: string[] = [`FireSim: ${s.title}`, ['Copied ' + h.copiedAt, h.app, h.run, ...(h.seed ? [h.seed] : [])].join(' | ')];
  for (const g of s.groups) {
    out.push('', `== ${g.title} ==`);
    for (const r of g.rows) {
      if (r.spark && !r.value) continue; // the chart is drawn on the screen; its numbers are the row above
      out.push(`  ${r.label}: ${r.value}${r.note ? ` (${r.note})` : ''}`);
    }
  }
  out.push('', END_MARKER);
  return out.join('\n').replace(/ /g, ' ');
}
