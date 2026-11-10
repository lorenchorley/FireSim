/**
 * The Desktop detail setting (0.9.0, decision D35; plan 15e "Measured"), as pure logic with no DOM: what each level sets, the words that say
 * what a result with it is, and the page's two memory rules. Used by the Setup row (screens/desktopDetailRow.ts), the label on the run, the
 * statistics, the model card and "Continue on this device"; the tests pin every number.
 *
 * The levels (chosen from the 15e measurements: 30 m, 20 m and 10 m were run on Katoomba, 6 km and 9 km; 15 m needs a 5 m elevation grid):
 *   Standard  nothing changes: this is what 0.8.0 built, and a run with it is byte for byte the same (src/sim/desktopDetail.determinism.test.ts)
 *   Finer     20 m fire cells, about 2.2 times the work of 30 m (11.7 s against 5.3 s an hour of fire, 6 km, fast tier), a snapshot of about 5 MB
 *   Finest    10 m fire cells, about 8.9 times the work (47.0 s an hour), a snapshot of 16 MB (6 km) to 39 MB (9 km), 1.2 to 1.9 GB on the desktop
 * A level sets the fire cell, the ember cap and allows the High air; the air tier itself stays the person's choice (Settings, Performance),
 * and Auto is still decided by the engine's own timing, which on a desktop run is the desktop's. Nothing else changes.
 *
 * What it cannot be called is more accurate: Katoomba's 4 h burnt area is 2,483 ha at 30 m and 2,738 ha at 10 m (embers off: 1,002 and 1,520 ha),
 * and the spread formulas were calibrated at 20 and 30 m. So every place a result is shown says {@link DETAIL_LABEL}.
 *
 * Rule 1 and 2 of plan section 4: the level is chosen by the person, recorded with the run (`SimOptions.desktopDetail`) and never changes after the
 * start; nothing here reads a speed, a display or a statistic.
 */
import { formatBytes } from '../core/datasets';
import { fireWindBytesModel } from '../core/fireWind';
import type { DesktopDetailLevel, QualityTier } from '../core/types';
import { atmosphereGrid, keyframeBytesModel, SNAPSHOT_FIRE_BYTES_PER_CELL, workingMemory } from '../scenario/memoryModel';
import { SCENARIO_PARAMS } from '../scenario/params';
import { SIM_PARAMS } from '../sim/params';
import type { DetailChoice } from './desktopDetailChoice';

export { applyDetail, levelOf, type DetailChoice } from './desktopDetailChoice';
export const DETAIL_CHOICES: readonly DetailChoice[] = ['standard', 'finer', 'finest'];

/** The owner's words (D35). Every result made with a finer level says exactly this. */
export const DETAIL_LABEL = 'Finer grid, results differ, not validated';
export const DETAIL_ROW_LABEL = 'Desktop detail';

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;
const NB = '\u00a0';
const bytesText = (b: number): string => formatBytes(b).replace(/ /g, NB);
const kmText = (extentM: number): string => `${extentM / 1000}${NB}km`;
const cellText = (cellM: number): string => `${cellM}${NB}m`;

// ───────────────────────────── what a level sets ─────────────────────────────

/** The fire cell (m) of a level; null for the standard detail (the builder's own rule applies). */
export const levelCellM = (c: DetailChoice): number | null => (c === 'standard' ? null : SCENARIO_PARAMS.desktopDetailCellM[c]);
/** The ember cap of a level; null for the standard detail (the performance setting's cap applies). */
export const levelEmbers = (c: DetailChoice): number | null => (c === 'standard' ? null : SIM_PARAMS.desktopDetailMaxEmbers[c]);

// ───────────────────────────── the words ─────────────────────────────

/** The chip of the Setup row. */
export const detailChipLabel = (c: DetailChoice): string => (c === 'standard' ? 'Standard' : `${c === 'finer' ? 'Finer' : 'Finest'} · ${cellText(levelCellM(c)!)}`);

/**
 * What the level costs, said once, from the 15e measurements (one study on one 4-core computer, the fast tier over 6 km; yours will differ, and
 * the desktop's own measured speed is on the statistics once a run is going).
 */
export const DETAIL_COST = {
  finer: 'About 2 times the work of the usual 30 m cells',
  finest: 'About 9 times the work of the usual 30 m cells, and about 16 MB a picture over 6 km',
} as const;

/** The sentence under the chips for the chosen level. */
export function detailHint(c: DetailChoice): string {
  if (c === 'standard') return 'The usual detail of the app: 30 m fire cells (20 m with Detailed, up to 6 km).';
  const cell = SCENARIO_PARAMS.desktopDetailCellM[c];
  const embers = SIM_PARAMS.desktopDetailMaxEmbers[c];
  return `Fire cells of ${cell} m at any area, up to ${embers.toLocaleString('en-AU')} embers. ${DETAIL_COST[c]} (one study, one computer). The High 3-D air is allowed and stays your choice in Settings.`;
}

/** Where the person is told what the setting is for: it is offered only with a desktop engine. */
export const DETAIL_WHERE = 'Only the desktop computer runs the finer grids; this device does not.';

/** The label on a run, in the statistics and in the model card: the owner's words and the cell it was made with. */
export const runLabel = (level: DesktopDetailLevel): string => `${DETAIL_LABEL} · ${cellText(SCENARIO_PARAMS.desktopDetailCellM[level])} cells`;

/** What the model card's "How sure are we?" says about a run with a finer level (a warning at the top of that section). */
export function modelCardWords(level: DesktopDetailLevel, cellM: number, embersMax: number): string {
  return `${DETAIL_LABEL}. This run uses the desktop's ${level} detail: fire cells of ${cellM}${NB}m instead of 30${NB}m and up to ${embersMax.toLocaleString('en-AU')} embers. The spread formulas were set against 20 m and 30 m cells, so a finer grid is a different model setting, not a more accurate one: in one scenario (Katoomba, 4 hours) the burnt area was 2,483 ha at 30 m and 2,738 ha at 10 m, and 1,002 and 1,520 ha with embers off. Nothing says which is closer to a real fire. Compare runs made with the same detail.`;
}

/** The row of the statistics that says which detail a run has. */
export function statsWords(level: DesktopDetailLevel, cellM: number, embersMax: number): { value: string; note: string } {
  return {
    value: `${DETAIL_LABEL}`,
    note: `${level === 'finer' ? 'Finer' : 'Finest'} level: fire cells of ${cellM}${NB}m, up to ${embersMax.toLocaleString('en-AU')} embers. The standard detail is 30${NB}m cells.`,
  };
}

// ───────────────────────────── memory on the page ─────────────────────────────

/** What the page knows of the device it runs on (`navigator.userAgentData.mobile`, the user agent, `deviceMemory`: all can be missing). */
export interface PageClass {
  /** A phone or tablet; null when the browser does not say. */
  mobile: boolean | null;
  /** `navigator.deviceMemory` in GB (a coarse bucket, 8 at most); null when absent. */
  memoryGb: number | null;
}

/** The part of `navigator` the page class reads. */
export interface NavigatorLike {
  userAgent?: string;
  maxTouchPoints?: number;
  deviceMemory?: number;
  userAgentData?: { mobile?: boolean };
}

/** Read the page class from the browser's own words; a browser that says nothing about being mobile is judged by its user agent. */
export function pageClassOf(nav: NavigatorLike | undefined): PageClass {
  const ua = nav?.userAgent ?? '';
  const hinted = nav?.userAgentData?.mobile;
  // An iPad asks for the desktop site and says Macintosh, but it has a touch screen.
  const ipadAsMac = /Macintosh/.test(ua) && (nav?.maxTouchPoints ?? 0) > 1;
  const mobile = typeof hinted === 'boolean' ? hinted || ipadAsMac : ua ? /Android|iPhone|iPad|iPod|Mobi/i.test(ua) || ipadAsMac : null;
  return { mobile, memoryGb: typeof nav?.deviceMemory === 'number' && nav.deviceMemory > 0 ? nav.deviceMemory : null };
}

/** Memory the page assumes of a device that does not say (the assumption `defaultSnapshotBudget` makes). */
export const ASSUMED_MEMORY_GB = 3;

/**
 * The history budget of a desktop-class page for a finer level: 384 MiB, against the 48 to 160 MiB of `defaultSnapshotBudget`. Why: one picture of
 * a 10 m run is 16 MB over 6 km and 39 MB over 9 km, so 160 MiB keeps only 10 or 4 of them and thins a 4 h run about five times (15e); 384 MiB
 * keeps 24 or 9. It is 5 % of the 8 GB that Chrome reports at most, and the typed arrays of the history are outside the JavaScript heap.
 */
export const DESKTOP_HISTORY_BUDGET = 384 * MIB;

/** A page the budget may grow on: it says it is not a phone or tablet and reports the most memory a browser reports (8 GB). A phone's page never is. */
export const isDesktopClass = (p: PageClass): boolean => p.mobile === false && (p.memoryGb ?? 0) >= 8;

/**
 * The history budget of a run. `base` is `defaultSnapshotBudget()` (6 % of the device's memory, 48 to 160 MiB). With the standard detail, and on
 * every page that is not desktop-class, it is `base` exactly: a phone viewing a 10 m run gets 16 MB pictures in the same budget and thins as it does
 * today. Only a desktop-class page with a finer level gets more (never less than `base`).
 */
export function historyBudgetFor(level: DesktopDetailLevel | null, base: number, page: PageClass): number {
  return level && isDesktopClass(page) ? Math.max(base, DESKTOP_HISTORY_BUDGET) : base;
}

/**
 * Bytes of the newest picture of a run (the store's head: the fire arrays and one full keyframe, 23 + 20 bytes a fire cell, the air view and the wind
 * the fire feels), from the same model as the model card's working memory. 6 km at 10 m: about 16 MB, as 15e measured; at 30 m about 2 MB.
 */
export function pictureBytes(extentM: number, cellM: number, tier: QualityTier | 'auto' = 'auto'): number {
  const t: QualityTier = tier === 'auto' ? 'standard' : tier;
  const n = Math.round(extentM / cellM);
  const cells = n * n;
  const atm = atmosphereGrid(extentM, t);
  return 2048 + SNAPSHOT_FIRE_BYTES_PER_CELL * cells + keyframeBytesModel(t, cells, atm.columns, atm.nz, fireWindBytesModel(n, n, cellM));
}

/** The history keeps the first picture, the newest and room for at least one between: a budget under this many pictures cannot be kept. */
export const PICTURES_KEPT_MIN = 3;

export interface Refusal {
  /** What is said (a sentence, in the voice of the rest of the app). */
  sentence: string;
}

/**
 * "This page cannot keep the pictures of that grid": null when a run of `level` over `extentM` fits the history budget this page would give it,
 * else the sentence. Used on Setup (Build is refused with it, next to the chips) before anything is built; never lowers the level by itself.
 */
export function snapshotRefusal(o: { level: DesktopDetailLevel; extentM: number; page: PageClass; baseBudget: number; tier?: QualityTier | 'auto' }): Refusal | null {
  const cellM = SCENARIO_PARAMS.desktopDetailCellM[o.level];
  const budget = historyBudgetFor(o.level, o.baseBudget, o.page);
  const one = pictureBytes(o.extentM, cellM, o.tier);
  if (one * PICTURES_KEPT_MIN <= budget) return null;
  const room = Math.floor(budget / one);
  const other = o.level === 'finest' ? 'the Finer level' : 'the standard detail';
  return {
    sentence: `This device cannot keep the pictures of ${cellText(cellM)} cells over ${kmText(o.extentM)}: each is about ${bytesText(one)} and its history has room for ${room === 0 ? 'less than one' : `about ${room}`} (${bytesText(budget)}). Choose a smaller area or ${other}.`,
  };
}

/**
 * A third of the device's memory is what a page and its engine can use before the system ends them (the figure behind `defaultSnapshotBudget`:
 * WebViews are killed at roughly 1 to 1.5 GB on 4 GB phones).
 */
export const DEVICE_SHARE = 1 / 3;

/**
 * What a running engine holds beyond the model card's typed arrays (the JavaScript runtime, its heap, the code): about 300 MB. With it the model
 * reproduces the peaks 15e measured (6 km: 0.20 GB modelled plus 0.3 against 526 MB measured at 30 m; 0.86 plus 0.3 against 1.2 GB at 10 m; over 9 km
 * at 10 m 1.59 plus 0.3 against 1.9 GB), which the arrays alone fall 20 % to 60 % short of. [H]
 */
export const RUNTIME_OVERHEAD_BYTES = 300e6;

/**
 * "Continue on this device" after a desktop run with a finer level: can this device run that grid by itself? Null when it can (the same scenario
 * restarts here and keeps its label), else the sentence and the offer. The memory is the model card's working memory for the run's own grid, tier
 * and ember cap; the device's is what it reports (3 GB assumed when it does not). Never lowers the detail by itself: the person is offered the
 * standard detail and chooses.
 */
export function deviceRefusal(o: { level: DesktopDetailLevel; extentM: number; durationS: number; tier: QualityTier | 'auto'; maxEmbers: number; snapshotIntervalS?: number; page: PageClass; baseBudget: number }): (Refusal & { short: string; action: string }) | null {
  const cellM = SCENARIO_PARAMS.desktopDetailCellM[o.level];
  const n = Math.round(o.extentM / cellM);
  const need = RUNTIME_OVERHEAD_BYTES + workingMemory({
    tier: o.tier,
    fireNx: n,
    fireNy: n,
    extentM: o.extentM,
    fireCellM: cellM,
    maxEmbers: o.maxEmbers,
    durationS: o.durationS,
    ...(o.snapshotIntervalS ? { snapshotIntervalS: o.snapshotIntervalS } : {}),
    snapshotBudgetBytes: historyBudgetFor(o.level, o.baseBudget, o.page),
    hiResNx: Math.round(o.extentM / SCENARIO_PARAMS.hiResCellM),
    hiResNy: Math.round(o.extentM / SCENARIO_PARAMS.hiResCellM),
  }).totalBytes;
  const gb = o.page.memoryGb ?? ASSUMED_MEMORY_GB;
  const can = gb * GIB * DEVICE_SHARE;
  if (need <= can) return null;
  const reports = o.page.memoryGb === null ? `it reports no memory size, so ${ASSUMED_MEMORY_GB} GB is assumed` : `it reports about ${gb} GB`;
  return {
    sentence: `This device cannot run the ${cellText(cellM)} grid of this run by itself: it needs about ${bytesText(need)} of memory, ${reports}, and about a third of that is what an app can use. It would not be switched to a coarser grid for you.`,
    // The error chip has two lines for its sentence: this is the short form, the long one goes in its tooltip and the model card.
    short: `This device cannot run the ${cellText(cellM)} grid of this run.`,
    action: 'Set up at the standard detail',
  };
}
