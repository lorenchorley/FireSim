/**
 * Pure helpers of the engine info (core/simTypes.ts `EngineInfo`, reported with every snapshot by
 * Simulation.makeSnapshot): the empirical spread models a scenario's fuel map uses, the weather stamp spacing, the
 * plain sentence behind the tier, and the 30 s throttle of the measured memory. Nothing here touches the physics.
 */
import type { EngineInfo, EngineMemoryInfo, FuelFamily, FuelMap, QualityTier, SpreadModelUse, WeatherSeries } from '../core/types';
import { resolveClass } from '../fuel/catalogue';
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
    case 'auto-tune':
      if (!a) return `Auto: ${TIER_WORDS[o.tier]}.`;
      return (
        `Auto: the first ${a.steps} 3-D steps took ${round(a.stepMs, 1)}${NB}ms each on this device, so the whole ` +
        `${round(o.durationS / 3600, 1)}${NB}h run was predicted to take ${round(a.predictedS)}${NB}s against a budget of ${round(a.budgetS)}${NB}s: ` +
        `${a.chosen === 'fast' ? 'too slow, so ' : ''}${TIER_WORDS[a.chosen]} ${a.chosen === 'fast' ? 'was chosen' : 'was kept'}.`
      );
    case 'auto-pending':
      return 'Auto: the 3-D atmosphere is being timed on this device during its spin-up; it stays only if a whole run would finish within the budget.';
    case 'auto-default':
      return `Auto without a timing sample: ${TIER_WORDS[o.tier]}.`;
    case 'changed':
      return `Changed during the run: ${TIER_WORDS[o.tier]} from ${formatSimTime(o.changedAt ?? 0)} of simulated time (the engine re-ran from the checkpoint there).`;
    default:
      return `Asked for when the run started: ${TIER_WORDS[o.tier]}.`;
  }
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
