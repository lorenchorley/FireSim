/**
 * bars.mjs (cards T3.1b and T3.1c): the agreement metrics of plan section 10.3, computed from two `arrival.f32` rasters and a horizon. Pure functions, no
 * dependency; `node --test prototypes/dotnet-b/ts-export/bars.test.mjs` tests them on synthetic rasters.
 *
 * INPUT. `arrival.f32` is what ts-export/export.ts writes (and harness/run-solver-browser.mjs): nx*ny float32, little endian, row-major, the arrival time in
 * seconds from scenario start of the LAST snapshot's fire.arrivalTime, and -1 for a cell that never burnt (the snapshot's +Infinity is converted at export).
 * A cell's arrival time is set once, when it ignites, so the raster of a 4 h run also holds every earlier state: at horizon H a cell is burnt iff 0 <= arrival <= H.
 * A nested run (one 4 h run read at 900 s, 1,800 s, ...) is therefore the same as one run per horizon (checked on a pair of runs, reports/3-floors.md).
 *
 * UNBURNT. A cell is unburnt at horizon H when its arrival is -1 (any negative value), NaN, +-Infinity, or later than H. Nothing else is special.
 *
 * REFERENCE AND CANDIDATE. `ref` is the reference run (the noise-free TypeScript in Node 22: plan 10.3); `cand` is the run compared with it (a noisy run, the
 * browser, later the C# port). Ratios and percentages are relative to the reference where they have a direction.
 *
 * THE METRICS at horizon H (all counted over the fire grid; cells are square and equal, so counts of cells are ratios of areas; `cellSizeM`, when given,
 * only turns counts into hectares):
 *   burntRef, burntCand      cells burnt by H in each run.
 *   ever                     cells burnt by H in EITHER run ("ever-burning" cells).
 *   disagree                 cells burnt by H in exactly one of the two runs (a differing burnt status).
 *   disagreePct              100 * disagree / ever  (0 when ever = 0).  Bar: 1 % (embers on) or 2.5 % (embers off).
 *   areaRatio                burntCand / burntRef  (NaN when both are 0; +Infinity when only burntRef is 0).
 *   areaDiffPct              100 * |areaRatio - 1|, the "burnt area within x %" of the bars (0 when both are 0, +Infinity when only the reference is empty).
 *                            Bar: 2 % (embers on) or 2.5 % (embers off). `areaSignedPct` = 100 * (areaRatio - 1) keeps the sign.
 *   both                     cells burnt by H in both runs.
 *   d = |arrCand - arrRef|   seconds, for the cells in `both` (float32 values widened to double, subtracted in double).
 *   differing                cells in `both` with d > 0.
 *   medianAbsS, p95AbsS, maxAbsS   the median, 95th percentile and maximum of d over `both` (NaN when `both` is 0). Quantiles by linear interpolation between
 *                            the order statistics at rank q*(n-1) (the default of numpy; the median of an even count is the mean of the middle two).
 *                            Bars: median <= 30 s; p95 <= 60 s (embers off only).
 *
 * FIRST DIVERGENCE (`firstDivergence`). Burnt status at time t differs from the moment the earlier of a cell's two arrival times is passed (a cell that
 * ignites in one run at a and in the other at b > a, or never, differs in status for t in [a, b), and in arrival time from b on), so:
 *   exactS                   min over all cells whose two arrival times differ (unburnt counts as +Infinity) of min(arrCand, arrRef); null if the rasters are identical.
 *                            At every t >= exactS some bar metric is nonzero (status difference while t < max, arrival difference from max on).
 *   snapshotS                the first time of the snapshot grid (default every 300 s, the cadence of the 4 h scenarios) that is >= exactS: the first
 *                            snapshot at which any bar metric is nonzero; null if none up to the last time of the grid, or the rasters are identical.
 *   firstExceedS             for each bar the first grid time at which the metric is above the bar (null if never up to the last grid time).
 * Hashes cannot be used for a noisy run (its t = 0 snapshot already differs), and for the arrival raster they add nothing: the raster is the fire state.
 */
import fs from 'node:fs';

/** The bars of plan 10.3 (same tier, same seed, "embers on, generator and draw order ported exactly" and "embers off"). null = no bar. */
export const BARS = {
  embersOn: { disagreePct: 1, areaDiffPct: 2, medianAbsS: 30, p95AbsS: null },
  embersOff: { disagreePct: 2.5, areaDiffPct: 2.5, medianAbsS: 30, p95AbsS: 60 },
};

/** The horizons of T3.1b and T3.1c (seconds): 900 s, 1,800 s, 1 h, 2 h, 4 h. */
export const HORIZONS = [900, 1800, 3600, 7200, 14400];

/** The metric names that have bars, in report order. */
export const METRICS = ['disagreePct', 'areaDiffPct', 'medianAbsS', 'p95AbsS'];

/** Reads an arrival.f32 file as a Float32Array (aligned copy). */
export function readArrival(file) {
  const b = fs.readFileSync(file);
  if (b.length % 4 !== 0) throw new Error(`${file}: ${b.length} bytes is not a whole number of float32`);
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
}

/** True when the cell is burnt by horizon h (0 <= arrival <= h; NaN, -1, any negative value and +-Infinity are unburnt). */
export function burntBy(arrival, h) {
  return arrival >= 0 && arrival <= h; // false for NaN and negatives; +Infinity fails the second test
}

/** Linear-interpolation quantile of an ascending-sorted array (NaN if empty). */
export function quantileSorted(sorted, q) {
  const n = sorted.length;
  if (n === 0) return NaN;
  const r = q * (n - 1);
  const lo = Math.floor(r);
  const hi = Math.ceil(r);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (r - lo);
}

/** The metrics of the header at one horizon. `ref` and `cand` are Float32Array (or arrays) of equal length. */
export function barMetrics(ref, cand, horizon, cellSizeM) {
  if (ref.length !== cand.length) throw new Error(`rasters differ in size: ${ref.length} and ${cand.length} cells`);
  let burntRef = 0, burntCand = 0, ever = 0, disagree = 0, both = 0, differing = 0, maxAbsS = 0;
  const abs = [];
  for (let i = 0; i < ref.length; i++) {
    const a = ref[i], b = cand[i];
    const ba = burntBy(a, horizon), bb = burntBy(b, horizon);
    if (ba) burntRef++;
    if (bb) burntCand++;
    if (ba || bb) ever++;
    if (ba !== bb) disagree++;
    if (ba && bb) {
      both++;
      const d = Math.abs(b - a);
      if (d > 0) differing++;
      if (d > maxAbsS) maxAbsS = d;
      abs.push(d);
    }
  }
  abs.sort((x, y) => x - y);
  const bothEmpty = burntRef === 0 && burntCand === 0;
  const areaRatio = burntRef === 0 ? (burntCand === 0 ? NaN : Infinity) : burntCand / burntRef;
  const m = {
    horizonS: horizon,
    cells: ref.length,
    burntRef, burntCand, ever, disagree,
    disagreePct: ever ? (100 * disagree) / ever : 0,
    areaRatio,
    areaDiffPct: bothEmpty ? 0 : 100 * Math.abs(areaRatio - 1),
    areaSignedPct: bothEmpty ? 0 : 100 * (areaRatio - 1),
    both, differing,
    medianAbsS: quantileSorted(abs, 0.5),
    p95AbsS: quantileSorted(abs, 0.95),
    maxAbsS: both ? maxAbsS : NaN,
  };
  if (cellSizeM) {
    m.burntRefHa = (burntRef * cellSizeM * cellSizeM) / 1e4;
    m.burntCandHa = (burntCand * cellSizeM * cellSizeM) / 1e4;
  }
  return m;
}

/** Each metric as a fraction of its bar (null where the case has no bar). NaN metrics (no cell burnt in both) count as 0: nothing differs. */
export function barFractions(m, embers = true) {
  const bar = embers ? BARS.embersOn : BARS.embersOff;
  const out = {};
  for (const k of METRICS) out[k] = bar[k] === null ? null : Number.isNaN(m[k]) ? 0 : m[k] / bar[k];
  return out;
}

/** The largest fraction of a bar over the metrics that have a bar (the number a verdict is made from). */
export function worstFraction(m, embers = true) {
  return Math.max(...Object.values(barFractions(m, embers)).filter((x) => x !== null));
}

/**
 * Verdict words of the report for a worst fraction of a bar r (the largest metric/bar ratio): r >= 1 "at or above the bar"; r <= 0.1 "far below the bar"
 * (a factor of 10 or more); otherwise "within a factor of N of the bar", N = ceil(1 / r).
 */
export function verdict(r) {
  if (!(r > 0)) return 'floor far below the bar (zero)';
  if (r >= 1) return 'at or above the bar';
  if (r <= 0.1) return 'floor far below the bar';
  return `within a factor of ${Math.ceil(1 / r)} of the bar`;
}

/** First divergence and first exceedance of each bar over a grid of times (see the header). */
export function firstDivergence(ref, cand, { gridS, embers = true } = {}) {
  if (ref.length !== cand.length) throw new Error(`rasters differ in size: ${ref.length} and ${cand.length} cells`);
  const grid = gridS ?? Array.from({ length: 48 }, (_, i) => 300 * (i + 1));
  const t = (x) => (x >= 0 && Number.isFinite(x) ? x : Infinity);
  let exactS = Infinity;
  for (let i = 0; i < ref.length; i++) {
    const a = t(ref[i]), b = t(cand[i]);
    if (a === b) continue;
    const m = Math.min(a, b);
    if (m < exactS) exactS = m;
  }
  const snapshotS = Number.isFinite(exactS) ? (grid.find((g) => g >= exactS) ?? null) : null;
  const bar = embers ? BARS.embersOn : BARS.embersOff;
  const firstExceedS = Object.fromEntries(METRICS.map((k) => [k, null]));
  for (const g of grid) {
    const m = barMetrics(ref, cand, g);
    for (const k of METRICS) if (bar[k] !== null && firstExceedS[k] === null && m[k] > bar[k]) firstExceedS[k] = g;
  }
  return { exactS: Number.isFinite(exactS) ? exactS : null, snapshotS, firstExceedS };
}
