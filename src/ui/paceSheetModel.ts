/**
 * Every sentence of the slow-run sheet (plan §6.5), as pure functions of what the phone measured: the pace reading
 * (paceModel.ts), the engine's own statistics (`EngineInfo.perf`) and how much of the run is left. The DOM file
 * (screens/sim/paceSheet.ts) only lays the result out, so every sentence is unit-tested here.
 *
 * Voice (content.ts): plain words, "about" for numbers, sentence case, no em dashes. Every number is a measurement on
 * this phone and says so; nothing here is a forecast (the start-time prediction is never quoted). Nothing can be NaN:
 * an unknown value drops its sentence rather than printing a guess.
 */
import type { EnginePerfInfo, PerfModuleId } from '../core/simTypes';
import type { QualityTier } from '../core/types';
import { formatSpeedMultiple } from './format';
import type { PaceInfo } from './paceTypes';
import { niceSpeed, SPEED_PRESETS } from './screens/sim/speedModel';

/** The accessible name of the button on the timeline, and what a screen reader hears (once) when the simulation starts to hold playback. */
export const PACE_BUTTON_LABEL = 'Simulation is running slower than your playback speed. Show details.';
export const PACE_ANNOUNCEMENT = 'Simulation is running slower than your playback speed.';

/** The air flow is "the heaviest part" and worth a reason at this share of the busy time; likewise the fire (with its wind) and the embers. */
export const REASON_SHARE = { air: 0.4, fire: 0.4, embers: 0.25 } as const;
/** "Slower than earlier in this run": the speed now is under this fraction of the median of the first four history samples. */
export const SLOWER_THAN_EARLIER = 0.75;

/** What the sheet needs to know of the engine: the tier, whether it is the demo engine, and the statistics. */
export interface PaceSheetEngine {
  tier: QualityTier;
  mock?: boolean;
  perf?: EnginePerfInfo | undefined;
}

export interface PaceSheetInput {
  /** The tracker's reading; null once it has nothing to say (the sheet can still be open when the simulation catches up). */
  pace: PaceInfo | null;
  engine: PaceSheetEngine | null;
  /** Simulated seconds from the clock to the end of the run. */
  remainingS: number;
}

export type PaceRowId = 'air' | 'fire' | 'embers' | 'other';

export interface PaceTimeRow {
  id: PaceRowId;
  label: string;
  /** Whole percent; the four rows add up to 100. */
  percent: number;
  /** "52 %". */
  text: string;
}

export interface PaceSheetView {
  /** `ok` when the simulation is keeping up again (the sheet was open when it caught up), else the level shown. */
  state: 'ok' | 'behind' | 'waiting';
  title: string;
  lead: string;
  result: { question: string; answer: string };
  time: { title: string; rows: PaceTimeRow[] } | null;
  /** "Likely reasons": each only when the numbers support it. */
  reasons: string[];
  /** "What you can do". */
  actions: {
    playAt: { speed: number; label: string } | null;
    fast: { label: string; note: string } | null;
    pausing: string;
  } | null;
  end: string | null;
  link: string;
  footnote: string;
}

// ───────────────────────────── small pieces ─────────────────────────────

/** A number for a sentence: whole above 10, two decimals trimmed below. */
function num(v: number): string {
  return v >= 10 ? String(Math.round(v)) : String(Number(v.toFixed(2)));
}

/** "60×", rounded to a readable value first ("1200×", not "1234×"). */
export function speedWord(speed: number): string {
  return formatSpeedMultiple(niceSpeed(speed));
}

/** What a speed means in fire time: "1 minute of fire every second", "30 seconds of fire every second", "real time". */
export function fireEvery(speed: number): string {
  if (!(speed > 0) || !Number.isFinite(speed)) return '';
  if (speed === 1) return 'real time';
  if (speed < 1) return `1 second of fire takes about ${num(1 / speed)} seconds`;
  const unit = (v: number, one: string): string => `${num(v)} ${one}${num(v) === '1' ? '' : 's'} of fire every second`;
  if (speed < 60) return unit(speed, 'second');
  if (speed < 3600) return unit(speed / 60, 'minute');
  return unit(speed / 3600, 'hour');
}

/** A length of time for "about N …": seconds under 45 s, minutes under 90 min, then hours in halves. Null for a length that is not a number. */
function span(seconds: number): { n: number; unit: 'second' | 'minute' | 'hour' } | null {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 45) return { n: Math.max(1, Math.round(seconds)), unit: 'second' };
  if (seconds < 5400) return { n: Math.max(1, Math.round(seconds / 60)), unit: 'minute' };
  return { n: Math.round(seconds / 1800) / 2, unit: 'hour' };
}

/** A measured value that can be quoted: a finite number above zero. */
const known = (v: number | null | undefined): v is number => v !== null && v !== undefined && Number.isFinite(v) && v > 0;

const unitText = (s: { n: number; unit: string }): string => `${num(s.n)} ${s.unit}${num(s.n) === '1' ? '' : 's'}`;

/** Whole percentages that add up to 100 (largest remainder). All zero when the shares are all zero. */
export function percents(shares: readonly number[]): number[] {
  const clean = shares.map((s) => (Number.isFinite(s) && s > 0 ? s : 0));
  const total = clean.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return clean.map(() => 0);
  const exact = clean.map((s) => (s / total) * 100);
  const out = exact.map(Math.floor);
  let left = 100 - out.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => ({ i, r: e - Math.floor(e) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    out[i]!++;
    left--;
  }
  return out;
}

/** The module groups people see: the fire's own work includes the coupling (its heat and the wind it feels), which grows with it. */
const GROUP: Record<PerfModuleId, PaceRowId> = {
  air: 'air',
  fire: 'fire',
  coupling: 'fire',
  embers: 'embers',
  moisture: 'other',
  detectors: 'other',
  picture: 'other',
  checkpoints: 'other',
  other: 'other',
};

interface Groups {
  shares: Record<PaceRowId, number>;
  /** Whether these are the shares of the last 10 s (else of the whole time since the tier started). */
  recent: boolean;
}

/** Shares of the busy time by group, from `perf.modules`; null when nothing has been measured yet. */
function groups(perf: EnginePerfInfo | undefined): Groups | null {
  const mods = perf?.modules;
  if (!mods || !mods.length) return null;
  const recent = mods.some((m) => m.share10 !== null && Number.isFinite(m.share10) && m.share10 > 0);
  const shares: Record<PaceRowId, number> = { air: 0, fire: 0, embers: 0, other: 0 };
  let total = 0;
  for (const m of mods) {
    const v = recent ? m.share10 : m.share;
    if (v === null || !Number.isFinite(v) || v <= 0) continue;
    shares[GROUP[m.id] ?? 'other'] += v;
    total += v;
  }
  if (!(total > 0)) return null;
  for (const k of Object.keys(shares) as PaceRowId[]) shares[k] /= total;
  return { shares, recent };
}

/** The median of a list of numbers (it is never called with an empty list). */
function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** The median of the first four measured samples of the speed history (the first two minutes of computing), or null with fewer than four. */
export function earlierSpeed(history: readonly (number | null)[] | undefined): number | null {
  const first: number[] = [];
  for (const v of history ?? []) {
    if (v !== null && Number.isFinite(v) && v > 0) first.push(v);
    if (first.length === 4) return median(first);
  }
  return null;
}

/**
 * The speed "Play at N" offers: the nearest preset at or below what the phone achieves (the lower of the speed the clock
 * really moved at and the speed the worker computes at), and below the speed asked for. Null when none is known or it is
 * under the slowest preset.
 */
export function playAtSpeed(pace: Pick<PaceInfo, 'wanted' | 'achieved' | 'capacity'>): number | null {
  const seen = [pace.achieved, pace.capacity].filter(known);
  if (!seen.length) return null;
  const basis = Math.min(...seen);
  let best: number | null = null;
  for (const p of SPEED_PRESETS) if (p <= basis + 1e-9 && p < pace.wanted && (best === null || p > best)) best = p;
  return best;
}

// ───────────────────────────── the sentences ─────────────────────────────

function lead(pace: PaceInfo | null): { state: PaceSheetView['state']; title: string; lead: string } {
  if (!pace || pace.level === 'ok') {
    const asked = pace ? ` You asked for ${speedWord(pace.wanted)}${known(pace.capacity) ? `; this phone is computing about ${speedWord(pace.capacity)} right now` : ''}.` : '';
    return { state: 'ok', title: 'Keeping up with playback', lead: `The simulation is keeping up now.${asked}` };
  }
  const title = 'Running slower than playback';
  if (pace.level === 'behind') {
    const ahead = known(pace.aheadS) && pace.aheadS >= 10 ? span(pace.aheadS) : null;
    const computed = ahead ? `About ${unitText(ahead)} of fire is already computed; after that, playback will wait.` : 'Playback is about to wait for the simulation.';
    const first = known(pace.capacity) ? `Computing about ${speedWord(pace.capacity)}; you asked for ${speedWord(pace.wanted)}.` : `You asked for ${speedWord(pace.wanted)}.`;
    return { state: 'behind', title, lead: `${first} ${computed}` };
  }
  const share = Number.isFinite(pace.waitingShare) ? Math.min(1, Math.max(0, pace.waitingShare)) : 0;
  const waits = Math.round(share * 10);
  const wait = waits >= 10 ? 'almost all the time' : waits >= 1 ? `about ${waits} ${waits === 1 ? 'second' : 'seconds'} in every 10` : 'now and then';
  const mid = known(pace.capacity) ? `This phone is computing about ${speedWord(pace.capacity)} right now, so playback waits` : 'Playback waits';
  return { state: 'waiting', title, lead: `You asked for ${speedWord(pace.wanted)} (${fireEvery(pace.wanted)}). ${mid} for the simulation ${wait}.` };
}

function reasonsFor(pace: PaceInfo, engine: PaceSheetEngine | null, g: Groups | null): string[] {
  const out: string[] = [];
  const tier = engine?.tier;
  if (g && (tier === 'standard' || tier === 'high') && g.shares.air > REASON_SHARE.air) {
    const heaviest = g.shares.air >= g.shares.fire && g.shares.air >= g.shares.embers && g.shares.air >= g.shares.other;
    out.push(`${heaviest ? 'The 3-D air flow is the heaviest part.' : 'The 3-D air flow takes a big share of the time.'} The fast model skips it and is usually about three times faster, with less detail.`);
  }
  const earlier = earlierSpeed(engine?.perf?.history);
  if (earlier !== null && known(pace.capacity) && pace.capacity < SLOWER_THAN_EARLIER * earlier) {
    out.push(`Slower than before (about ${speedWord(earlier)} earlier in this run). The phone may be warm or in battery saver.`);
  }
  if (g && g.shares.fire > REASON_SHARE.fire) out.push('A big fire takes longer to compute; this eases as it burns out.');
  if (g && g.shares.embers > REASON_SHARE.embers) out.push('Many embers are in the air, and each one takes time to follow. This eases when fewer are flying.');
  return out;
}

/** "At this pace the end of the run is about 9 minutes away (6 at your speed)." Null when there is nothing to compare, it is under a minute away, or both come to the same. */
function endLine(pace: PaceInfo, remainingS: number): string | null {
  if (!(remainingS >= 60) || !Number.isFinite(remainingS)) return null;
  const rate = known(pace.capacity) ? pace.capacity : known(pace.achieved) ? pace.achieved : null;
  if (rate === null || rate >= pace.wanted) return null;
  const here = span(remainingS / rate);
  const asked = span(remainingS / pace.wanted);
  if (!here || !asked || here.unit === 'second' || (here.unit === asked.unit && here.n === asked.n)) return null;
  const b = here.unit === asked.unit ? num(asked.n) : unitText(asked);
  return `At this pace the end of the run is about ${unitText(here)} away (${b} at your speed).`;
}

/** Everything the sheet says. */
export function paceSheet(input: PaceSheetInput): PaceSheetView {
  const { engine } = input;
  // A reading that does not say what was asked for cannot be explained: treat it as no reading.
  const pace = input.pace && known(input.pace.wanted) && Number.isFinite(input.pace.wanted) ? input.pace : null;
  const head = lead(pace);
  const g = groups(engine?.perf);
  const tier = engine?.tier;

  let time: PaceSheetView['time'] = null;
  if (g) {
    const labels: Record<PaceRowId, string> = { air: tier === 'fast' ? 'Surface wind' : '3-D air flow', fire: 'Fire spread', embers: 'Embers', other: 'Everything else' };
    const ids: PaceRowId[] = ['air', 'fire', 'embers', 'other'];
    const pct = percents(ids.map((id) => g.shares[id]));
    time = {
      title: g.recent ? 'Where the time goes (last 10 s)' : 'Where the time goes (this run so far)',
      rows: ids.map((id, i) => ({ id, label: labels[id], percent: pct[i]!, text: `${pct[i]!} %` })),
    };
  }

  let actions: PaceSheetView['actions'] = null;
  if (pace && pace.level !== 'ok') {
    const speed = playAtSpeed(pace);
    actions = {
      playAt: speed === null ? null : { speed, label: `Play at ${formatSpeedMultiple(speed)}` },
      fast: engine && !engine.mock && engine.tier !== 'fast' ? { label: 'Use the fast model from here', note: 'The fire from this moment on comes out a little different.' } : null,
      pausing: 'Pausing stops the simulation too. Playing slower is what lets it keep up.',
    };
  }

  return {
    ...head,
    result: { question: 'Does it change the result?', answer: 'No. The same choices give the same fire at any speed. It only takes longer to appear.' },
    time,
    reasons: pace && pace.level !== 'ok' ? reasonsFor(pace, engine, g) : [],
    actions,
    end: pace && pace.level !== 'ok' ? endLine(pace, input.remainingS) : null,
    link: 'All the numbers',
    footnote: 'Measured on this phone, over the last 10 seconds.',
  };
}
