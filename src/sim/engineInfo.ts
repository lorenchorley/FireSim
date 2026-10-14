/**
 * Pure helpers of the engine info (core/simTypes.ts `EngineInfo`, reported with every snapshot by
 * Simulation.makeSnapshot): the empirical spread models a scenario's fuel map uses, the weather stamp spacing, the
 * Auto decision (tier from timed steps) and the plain sentence behind the tier, and the 30 s throttle of the measured
 * memory. Nothing here touches the physics.
 */
import type { EngineInfo, EngineMemoryInfo, FuelFamily, FuelMap, QualityTier, SpreadModelUse, WeatherSeries } from '../core/types';
import { resolveClass } from '../fuel/catalogue';
import { SIM_PARAMS } from './params';
import type { SimMemoryReport } from './simulation';

/**
 * The model each fuel family dispatches to (fire/models/kernel.ts `headRosKernel`, spec §6.1): vesta2 → Vesta Mk2
 * (§6.2), grass → CSIRO grassland (§6.5), heath → the AFDRS heath model in use (§6.6), pine → the pine model (§6.7:
 * Vesta Mk2 surface fire plus a crown-fraction-burnt ramp).
 */
export function spreadModelName(family: FuelFamily, heathModel: 'refit2024' | 'v1'): string {
  switch (family) {
    case 'vesta2':
      return 'Vesta Mk2';
    case 'grass':
      return 'CSIRO grassland';
    case 'heath':
      return heathModel === 'v1' ? 'AFDRS heath v1.0' : 'AFDRS heath (2024 refit)';
    case 'pine':
      return 'Pine plantation (Vesta Mk2 surface fire + crown fraction burnt)';
    default:
      return 'No spread (non-fuel)';
  }
}

/**
 * The fast tier's fixed outer step (s): DiagnosticWind.maxStableDt() (spec §12.2, "fast tier 10 s fixed"). The model card
 * quotes it before an engine has reported (a plan); engineInfo.test.ts checks it against a running fast engine.
 */
export const FAST_TIER_STEP_S = 10;

const FAMILY_ORDER: readonly FuelFamily[] = ['vesta2', 'grass', 'heath', 'pine'];

/**
 * Burnable cells per fuel family of a fuel map, with the model each one runs. The family is the CLASS family, exactly as
 * the kernel dispatches (fuel/fuelMap.ts `fuelParamsInto`: the vegetation class when it belongs to the cell's type, else
 * the type's generic class). Non-fuel cells are left out; families with no cell are left out; most cells first.
 */
export function spreadModelUse(fuel: Pick<FuelMap, 'type'> & { fuelClass?: Uint8Array }, heathModel: 'refit2024' | 'v1'): SpreadModelUse[] {
  const counts = new Map<FuelFamily, number>();
  const n = fuel.type.length;
  const cls = fuel.fuelClass;
  // Class ids and types are small integers: cache the family per (class, type) pair.
  const memo = new Map<number, FuelFamily>();
  let burnable = 0;
  for (let k = 0; k < n; k++) {
    const type = fuel.type[k]!;
    const classId = cls ? cls[k]! : type;
    const key = classId * 256 + type;
    let fam = memo.get(key);
    if (fam === undefined) {
      fam = resolveClass(resolveClass(classId).id === type ? classId : type).family;
      memo.set(key, fam);
    }
    if (fam === 'none') continue;
    burnable++;
    counts.set(fam, (counts.get(fam) ?? 0) + 1);
  }
  const out: SpreadModelUse[] = [];
  for (const family of FAMILY_ORDER) {
    const cells = counts.get(family) ?? 0;
    if (cells > 0) out.push({ family, model: spreadModelName(family, heathModel), cells, share: cells / burnable });
  }
  return out.sort((a, b) => b.cells - a.cells || FAMILY_ORDER.indexOf(a.family) - FAMILY_ORDER.indexOf(b.family));
}

/** Median spacing (s) of the weather series stamps (hourly = 3600; presets have 10 min inside change ramps). */
export function medianStampS(series: Pick<WeatherSeries, 'hours'>): number {
  const h = series.hours;
  if (h.length < 2) return 3600;
  const d: number[] = [];
  for (let i = 1; i < h.length; i++) {
    const s = (h[i]!.time - h[i - 1]!.time) / 1000;
    if (s > 0 && Number.isFinite(s)) d.push(s);
  }
  if (!d.length) return 3600;
  d.sort((a, b) => a - b);
  return d[Math.floor(d.length / 2)]!;
}

const TIER_WORDS: Record<QualityTier, string> = {
  fast: 'the fast tier (no time-stepped 3-D air flow)',
  standard: 'the standard 3-D atmosphere',
  high: 'the high-quality 3-D atmosphere',
};

const round = (v: number, d = 0): string => (Number.isFinite(v) ? v.toFixed(d) : '?');
/** No-break space between a number and its unit. */
const NB = '\u00a0';

/** What the Auto choice at the start measured and decided (EngineInfo.autoTune before `steps` and `warmupSteps` are added). */
export interface AutoTuneDecision {
  /** The number the decision used: the median wall time (ms) of the steady steps, after the warm-up. */
  stepMs: number;
  /** Mean wall time (ms) of the warm-up steps that were left out; null when none were. */
  warmupMeanMs: number | null;
  /** Predicted wall time (s) of the whole run on the 3-D air: overhead × step × (duration / 10 s). */
  predictedS: number;
  /** The most the 3-D air may take for a run this long (s). */
  budgetS: number;
  chosen: 'standard' | 'fast';
}

/**
 * The Auto decision of the start (spec §12.6, plan §6.2) from the wall times (ms) of the timed 3-D spin-up steps, in the
 * order they ran. The first `autoTuneWarmupSteps` are the JIT warm-up: only their mean is kept, for the statistics.
 * The prediction uses the MEDIAN of the others (one slow step from a garbage collection or another app does not decide),
 * and the 3-D air is kept unless the whole run is predicted to take longer than the budget, which is about ten minutes of
 * computing for six hours of fire (`autoTuneBudgetS`), scaled by the run length and never under a minute.
 */
export function autoTuneDecision(stepTimesMs: ArrayLike<number>, durationS: number, P: Pick<typeof SIM_PARAMS, 'autoTuneWarmupSteps' | 'autoTuneOverhead' | 'autoTuneStepS' | 'autoTuneBudgetS' | 'autoTuneBudgetRefS' | 'autoTuneMinBudgetS'> = SIM_PARAMS): AutoTuneDecision {
  const n = stepTimesMs.length;
  const warm = Math.min(P.autoTuneWarmupSteps, Math.max(0, n - 1));
  let warmSum = 0;
  for (let i = 0; i < warm; i++) warmSum += stepTimesMs[i]!;
  const steady = new Float64Array(n - warm);
  for (let i = warm; i < n; i++) steady[i - warm] = stepTimesMs[i]!;
  steady.sort();
  const m = steady.length >> 1;
  const stepMs = steady.length === 0 ? 0 : steady.length % 2 ? steady[m]! : (steady[m - 1]! + steady[m]!) / 2;
  const predictedS = (P.autoTuneOverhead * stepMs * (durationS / P.autoTuneStepS)) / 1000;
  const budgetS = Math.max(P.autoTuneMinBudgetS, (P.autoTuneBudgetS * durationS) / P.autoTuneBudgetRefS);
  return { stepMs, warmupMeanMs: warm > 0 ? warmSum / warm : null, predictedS, budgetS, chosen: predictedS <= budgetS ? 'standard' : 'fast' };
}

/** A computing time for a sentence ("53 s", "2 min", "1 h 5 min"; the caller says "about"). */
export function formatWallDuration(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '?';
  return s < 120 ? `${Math.round(s)}${NB}s` : formatSimTime(s);
}

/** The most a run of this length may take, for a sentence: "10 min", "about 7 min", "100 s". */
function limitWords(budgetS: number): string {
  const exact = budgetS < 120 || Math.abs(budgetS / 60 - Math.round(budgetS / 60)) < 0.05;
  return `${exact ? '' : 'about '}${formatWallDuration(budgetS)}`;
}

const stepWords = (ms: number): string => `${round(ms, ms < 10 ? 1 : 0)}${NB}ms`;

/** The plain sentence behind the tier in use (EngineInfo.tierReason), with the auto-tune numbers when there are any. */
export function tierReasonText(o: {
  tier: QualityTier;
  cause: EngineInfo['tierCause'];
  autoTune: EngineInfo['autoTune'];
  changedAt: number | null;
  durationS: number;
}): string {
  const a = o.autoTune;
  switch (o.cause) {
    case 'auto-tune': {
      if (!a) return `Auto: ${TIER_WORDS[o.tier]}.`;
      const when = formatWallDuration(a.predictedS);
      if (a.chosen === 'fast') {
        return (
          `Fast surface-wind model: the detailed 3-D air would take about ${when} to compute this run on this phone ` +
          `(about ${stepWords(a.stepMs)} per air step), longer than the limit of ${limitWords(a.budgetS)} for a run this long. ` +
          'Switch in Settings, Performance, or Layers, Use the 3-D atmosphere.'
        );
      }
      const times = a.predictedS > 0 ? o.durationS / a.predictedS : 0;
      const real = times > 0 ? ` (about ${round(times, times < 10 ? 1 : 0)}${NB}times real time)` : '';
      return (
        `Detailed 3-D air: this phone takes about ${stepWords(a.stepMs)} per air step, so this run should compute in about ${when}${real}. ` +
        'It can fall behind when you play faster than that; the timeline will say so.'
      );
    }
    case 'auto-pending':
      return 'Auto: the 3-D atmosphere is being timed on this device during its spin-up; it stays unless a whole run would take longer than the time limit.';
    case 'auto-default':
      return `Auto without a timing sample: ${TIER_WORDS[o.tier]}.`;
    case 'changed':
      return `Changed during the run: ${TIER_WORDS[o.tier]} from ${formatSimTime(o.changedAt ?? 0)} of simulated time (the engine re-ran from the checkpoint there).`;
    default:
      return `Asked for when the run started: ${TIER_WORDS[o.tier]}.`;
  }
}

/** The "Recent events" line for the Auto decision (EnginePerfInfo.events). */
export function autoTuneEventText(d: AutoTuneDecision): string {
  return d.chosen === 'fast'
    ? `Auto chose the fast model: the 3-D air would take about ${formatWallDuration(d.predictedS)}, over the limit of ${limitWords(d.budgetS)}.`
    : `Auto kept the detailed 3-D air: about ${stepWords(d.stepMs)} per air step.`;
}

/** "1 h 30 min" / "45 min" / "0 min" from seconds (simulated time since the start). */
export function formatSimTime(s: number): string {
  const m = Math.max(0, Math.round(s / 60));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h > 0 ? `${h}${NB}h${mm ? ` ${mm}${NB}min` : ''}` : `${mm}${NB}min`;
}

/** Minimum wall-clock interval between two memory measurements of a running engine (ms). */
export const MEMORY_REFRESH_WALL_MS = 30_000;

/** EngineInfo.memory from a memory report (parts in a fixed order, zero parts kept so the list is stable). */
export function engineMemory(report: SimMemoryReport, measuredAt: number): EngineMemoryInfo {
  const order = ['scenario', 'fuel', 'fire', 'moisture', 'atmosphere', 'embers', 'explain', 'checkpoints', 'rasters'] as const;
  return { measuredAt, parts: order.map((name) => ({ name, bytes: report.parts[name] ?? 0 })), totalBytes: report.totalBytes };
}
