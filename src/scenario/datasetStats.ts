/**
 * Statistics of the finished grids and series, for the data set records (core/datasets.ts `stats` and `distribution`).
 *
 * Pure: arrays in, formatted facts out. Every function makes one or two passes over the grid and uses fixed-width
 * histograms for percentiles instead of sorting, so all of them together take a few milliseconds on a 300 x 300 grid
 * (checked by datasetStats.test.ts, budget 30 ms). Percentiles from a histogram are exact to the bin width
 * (0.25 deg of slope, 0.5 m of canopy height, 0.25 years of time since fire, 0.25 % of moisture); the width is stated in
 * each function.
 *
 * All `value` strings are ready to show; `raw` carries the number in the stated `unit`.
 */
import type { ContextLayers, RoadClass, ZoneKind } from '../core/places';
import { formatPercent, type DatasetDistribution, type DatasetStat } from '../core/datasets';
import { FireHistoryKind, FuelFlag, FuelType, Landform, type FireHistoryRecord, type FuelMap, type Terrain, type WeatherSeries } from '../core/types';
import { ffdi } from '../fire/models/mcarthur';
import { FUEL_CLASSES, FUEL_TYPES } from '../fuel/catalogue';
import { CTX_CHM_VALID, CTX_INFERRED, CTX_MINORITY_WET, type FuelMapExt } from '../fuel/fuelMap';
import { LANDFORM_NAMES } from '../terrain';

// ─────────────────────────────────────────────────────────────────────────────
// Building blocks
// ─────────────────────────────────────────────────────────────────────────────

const round = (v: number, d: number): number => {
  const m = 10 ** d;
  return Math.round(v * m) / m;
};

/** A number with `d` decimals and a thousands separator for 4+ digit integers ("1 076", "12.5"). */
export function num(v: number, d = 0): string {
  if (!Number.isFinite(v)) return 'n/a';
  const r = round(v, d);
  const [i, f] = Math.abs(r).toFixed(d).split('.');
  const sign = r < 0 ? '−' : '';
  return `${sign}${i!.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${f ? `.${f}` : ''}`;
}

/** A stat with a value formatted as `num(raw, digits) + unit`. */
export function stat(label: string, raw: number, unit: string, digits = 0, hint?: string): DatasetStat {
  const s: DatasetStat = { label, value: Number.isFinite(raw) ? `${num(raw, digits)}${unit ? (unit.startsWith('°') ? '' : ' ') : ''}${unit}`.trimEnd() : 'n/a', unit };
  if (Number.isFinite(raw)) s.raw = round(raw, Math.max(digits, 3));
  if (hint) s.hint = hint;
  return s;
}

/** A share (0-1) as a percentage stat ("12 %"); `raw` is the percentage. */
export function shareStat(label: string, fraction: number, hint?: string): DatasetStat {
  const s: DatasetStat = { label, value: formatPercent(fraction), unit: '%' };
  if (Number.isFinite(fraction)) s.raw = round(fraction * 100, 2);
  if (hint) s.hint = hint;
  return s;
}

/** Plain text stat. */
export const textStat = (label: string, value: string, hint?: string): DatasetStat => ({ label, value, ...(hint ? { hint } : {}) });

/** Fixed-width histogram: counts of values in [lo, lo + width * bins), values beyond are clamped to the ends. */
export class Hist {
  readonly counts: Uint32Array;
  total = 0;
  min = Infinity;
  max = -Infinity;
  sum = 0;
  constructor(
    readonly lo: number,
    readonly width: number,
    readonly bins: number,
  ) {
    this.counts = new Uint32Array(bins);
  }
  add(v: number): void {
    if (!(v === v) || v === Infinity || v === -Infinity) return;
    let b = Math.floor((v - this.lo) / this.width);
    if (b < 0) b = 0;
    else if (b >= this.bins) b = this.bins - 1;
    this.counts[b]!++;
    this.total++;
    this.sum += v;
    if (v < this.min) this.min = v;
    if (v > this.max) this.max = v;
  }
  get mean(): number {
    return this.total ? this.sum / this.total : NaN;
  }
  /** p in [0, 1]; linear inside the bin, clamped to the observed min and max. */
  quantile(p: number): number {
    if (!this.total) return NaN;
    const target = p * this.total;
    let acc = 0;
    for (let b = 0; b < this.bins; b++) {
      const c = this.counts[b]!;
      if (acc + c >= target && c > 0) {
        const v = this.lo + (b + (target - acc) / c) * this.width;
        return Math.min(this.max, Math.max(this.min, v));
      }
      acc += c;
    }
    return this.max;
  }
  /** Share of values above `v` (exact when v is a bin edge). */
  shareAbove(v: number): number {
    if (!this.total) return NaN;
    const b = Math.floor((v - this.lo) / this.width + 1e-9);
    let n = 0;
    for (let i = Math.max(0, b); i < this.bins; i++) n += this.counts[i]!;
    return n / this.total;
  }
}

/** Shares of `values` in equal-width bins from `lo` to `hi` (values outside are clamped to the end bins). */
export function binShares(values: ArrayLike<number>, lo: number, hi: number, bins: number, mask?: Uint8Array): { edges: number[]; shares: number[]; count: number } {
  const counts = new Array<number>(bins).fill(0);
  const w = (hi - lo) / bins || 1;
  let count = 0;
  for (let k = 0; k < values.length; k++) {
    if (mask && !mask[k]) continue;
    const v = values[k]!;
    if (!(v === v)) continue;
    let b = Math.floor((v - lo) / w);
    if (b < 0) b = 0;
    else if (b >= bins) b = bins - 1;
    counts[b]!++;
    count++;
  }
  const edges = Array.from({ length: bins + 1 }, (_, i) => round(lo + i * w, 4));
  return { edges, shares: counts.map((c) => (count ? round(c / count, 5) : 0)), count };
}

const km = (m: number): number => m / 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Terrain
// ─────────────────────────────────────────────────────────────────────────────

export interface TerrainFacts {
  minElevation: number;
  maxElevation: number;
  meanElevation: number;
  relief: number;
  medianSlopeDeg: number;
  p90SlopeDeg: number;
  maxSlopeDeg: number;
  shareSteeper20: number;
  shareSteeper25: number;
  shareSteeper30: number;
  meanCliffFraction: number;
  shareP90Over45: number;
  flatShare: number;
  landformShares: number[];
  medianLocalRelief?: number;
  reliefClass?: 'flat' | 'undulating' | 'hilly' | 'mountainous';
  cells: number;
}

export interface StatsResult<F> {
  stats: DatasetStat[];
  distribution?: DatasetDistribution;
  facts: F;
}

/** One pass over the fire-grid terrain (its own small function, so the engine optimises the loop at once). */
function accumulateTerrain(t: Terrain, n: number, slopeH: Hist, relH: Hist | null, relief: Float32Array | undefined) {
  const z = t.elevation;
  const sl = t.slopeDeg;
  const aspect = t.aspectDeg;
  const landform = t.landform;
  let zMin = Infinity;
  let zMax = -Infinity;
  let zSum = 0;
  let s20 = 0;
  let s25 = 0;
  let s30 = 0;
  let flat = 0;
  const lfCounts = new Uint32Array(11);
  for (let k = 0; k < n; k++) {
    const v = z[k]!;
    if (v < zMin) zMin = v;
    if (v > zMax) zMax = v;
    zSum += v;
    const s = sl[k]!;
    slopeH.add(s);
    if (s > 20) s20++;
    if (s > 25) s25++;
    if (s > 30) s30++;
    const a = aspect[k]!;
    if (!(a === a)) flat++;
    const c = landform[k]!;
    if (c < lfCounts.length) lfCounts[c]!++;
  }
  let cliffSum = 0;
  let p90Over45 = 0;
  const cliffFraction = t.cliffFraction;
  const slopeP90 = t.slopeP90Deg;
  if (cliffFraction) for (let k = 0; k < n; k++) cliffSum += cliffFraction[k]!;
  if (slopeP90) for (let k = 0; k < n; k++) if (slopeP90[k]! > 45) p90Over45++;
  if (relH && relief) for (let k = 0; k < n; k++) relH.add(relief[k]!);
  return { zMin, zMax, zSum, s20, s25, s30, flat, lf: Array.from(lfCounts), cliffSum, p90Over45 };
}

/**
 * Statistics of the fire-grid terrain. Slope percentiles come from 0.25 degree bins. `localRelief` (TerrainDerived, m,
 * ~1 km window) is optional: with it the median local relief and the Hammond relief class are added.
 */
export function terrainStats(t: Terrain, opts: { localRelief?: Float32Array; seaOrNoDataCells?: number } = {}): StatsResult<TerrainFacts> {
  const n = t.grid.nx * t.grid.ny;
  const z = t.elevation;
  const slopeH = new Hist(0, 0.25, 400);
  const relH = opts.localRelief ? new Hist(0, 5, 400) : null;
  const { zMin, zMax, zSum, s20, s25, s30, flat, lf, cliffSum, p90Over45 } = accumulateTerrain(t, n, slopeH, relH, opts.localRelief);
  const medRelief = relH ? relH.quantile(0.5) : undefined;
  const reliefClass = medRelief === undefined ? undefined : medRelief < 30 ? 'flat' : medRelief < 90 ? 'undulating' : medRelief < 300 ? 'hilly' : 'mountainous';
  const facts: TerrainFacts = {
    minElevation: zMin,
    maxElevation: zMax,
    meanElevation: zSum / n,
    relief: zMax - zMin,
    medianSlopeDeg: slopeH.quantile(0.5),
    p90SlopeDeg: slopeH.quantile(0.9),
    maxSlopeDeg: slopeH.max,
    shareSteeper20: s20 / n,
    shareSteeper25: s25 / n,
    shareSteeper30: s30 / n,
    meanCliffFraction: t.cliffFraction ? cliffSum / n : NaN,
    shareP90Over45: t.slopeP90Deg ? p90Over45 / n : NaN,
    flatShare: flat / n,
    landformShares: lf.map((c) => c / n),
    ...(medRelief !== undefined ? { medianLocalRelief: medRelief, reliefClass: reliefClass! } : {}),
    cells: n,
  };
  const stats: DatasetStat[] = [
    stat('Lowest ground', zMin, 'm'),
    stat('Highest ground', zMax, 'm'),
    stat('Average height', facts.meanElevation, 'm'),
    stat('Relief (highest minus lowest)', facts.relief, 'm'),
    stat('Typical slope (median)', facts.medianSlopeDeg, '°', 1),
    stat('Steep slope (90th percentile)', facts.p90SlopeDeg, '°', 1, 'Nine tenths of the ground is gentler than this.'),
    stat('Steepest cell', facts.maxSlopeDeg, '°', 1),
    shareStat('Ground steeper than 25°', facts.shareSteeper25, 'Fire runs much faster uphill on steep ground.'),
    shareStat('Ground steeper than 30°', facts.shareSteeper30),
  ];
  if (t.cliffFraction) stats.push(shareStat('Cliff (steeper than 60° at 10 m)', facts.meanCliffFraction, 'Share of 10 m squares; a 30 m cell can hide a cliff.'));
  if (t.slopeP90Deg) stats.push(shareStat('Cells with very steep ground inside (over 45°)', facts.shareP90Over45));
  stats.push(shareStat('Flat cells (no slope direction)', facts.flatShare));
  if (medRelief !== undefined) stats.push(textStat('Relief class (median relief within about 1 km)', `${reliefClass} (${num(medRelief)} m)`));
  const top = lf
    .map((c, i) => ({ i, share: c / n }))
    .sort((a, b) => b.share - a.share)
    .slice(0, 3)
    .filter((x) => x.share > 0.01);
  if (top.length) stats.push(textStat('Most common landforms', top.map((x) => `${LANDFORM_NAMES[x.i as Landform].toLowerCase()} ${formatPercent(x.share)}`).join(', ')));
  if (opts.seaOrNoDataCells !== undefined && opts.seaOrNoDataCells > 0) stats.push(stat('Sea-level or no-data points', opts.seaOrNoDataCells, '', 0, 'Set to 0 m; the model needs a real surface.'));
  const h = binShares(z, zMin, zMax + 1e-6, 10);
  return {
    stats,
    distribution: { kind: 'histogram', title: 'Ground height', unit: 'm', values: h.shares, edges: h.edges, count: h.count },
    facts,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fuel, vegetation, canopy
// ─────────────────────────────────────────────────────────────────────────────

const cellContext = (f: FuelMap): Uint8Array | undefined => (f as FuelMapExt).cellContext;

export interface FuelFacts {
  cells: number;
  typeShares: number[];
  nonFuelShare: number;
  waterShare: number;
  inferredShare: number;
  minorityWetShare: number;
  meanSurfaceHazard: number;
  meanNearSurfaceHazard: number;
  meanElevatedHazard: number;
  meanBarkHazard: number;
  p90SurfaceHazard: number;
  meanSurfaceLoad: number;
  maxSurfaceLoad: number;
  meanCuring: number;
  grassCells: number;
  meanCanopyCover: number;
  wrfMin: number;
  wrfMax: number;
  heavyFuelShare: number;
  stringybarkShare: number;
  postFireShare: number;
  roadShare: number;
  cliffShare: number;
}

/** One pass over the fuel map (a small function of its own, so the engine optimises the 90 000-cell loop at once). */
function accumulateFuel(f: FuelMap, ctx: Uint8Array | undefined, hazH: Hist) {
  const n = f.grid.nx * f.grid.ny;
  const a = { types: new Uint32Array(13), sH: 0, nsH: 0, eH: 0, bH: 0, loadSum: 0, loadMax: 0, curSum: 0, curN: 0, coverSum: 0, wMin: Infinity, wMax: -Infinity, inferred: 0, minority: 0, heavy: 0, stringy: 0, post: 0, road: 0, cliff: 0 };
  const { type, surfaceHazard, nearSurfaceHazard, elevatedHazard, barkHazard, surfaceLoad, curing, canopyCover, wrf, flags } = f;
  const types = a.types;
  let sH = 0, nsH = 0, eH = 0, bH = 0, loadSum = 0, loadMax = 0, curSum = 0, curN = 0, coverSum = 0, wMin = Infinity, wMax = -Infinity;
  let inferred = 0, minority = 0, heavy = 0, stringy = 0, post = 0, road = 0, cliff = 0;
  const F_INFERRED = FuelFlag.InferredVegetation;
  const F_HEAVY = FuelFlag.HeavyFuel;
  const F_STRINGY = FuelFlag.Stringybark;
  const F_POST = FuelFlag.PostFire;
  const F_ROAD = FuelFlag.Road;
  const F_CLIFF = FuelFlag.Cliff;
  const F_MINORITY = FuelFlag.WetGullyMinority;
  for (let k = 0; k < n; k++) {
    types[type[k]!]!++;
    const sh = surfaceHazard[k]!;
    sH += sh;
    hazH.add(sh);
    nsH += nearSurfaceHazard[k]!;
    eH += elevatedHazard[k]!;
    bH += barkHazard[k]!;
    const ld = surfaceLoad[k]!;
    loadSum += ld;
    if (ld > loadMax) loadMax = ld;
    const cu = curing[k]!;
    if (cu > 0) {
      curSum += cu;
      curN++;
    }
    coverSum += canopyCover[k]!;
    if (wrf) {
      const w = wrf[k]!;
      if (w < wMin) wMin = w;
      if (w > wMax) wMax = w;
    }
    if (flags) {
      const fl = flags[k]!;
      if (fl & F_INFERRED) inferred++;
      if (fl & F_HEAVY) heavy++;
      if (fl & F_STRINGY) stringy++;
      if (fl & F_POST) post++;
      if (fl & F_ROAD) road++;
      if (fl & F_CLIFF) cliff++;
      if (fl & F_MINORITY) minority++;
    } else if (ctx) {
      if (ctx[k]! & CTX_INFERRED) inferred++;
      if (ctx[k]! & CTX_MINORITY_WET) minority++;
    }
  }
  Object.assign(a, { sH, nsH, eH, bH, loadSum, loadMax, curSum, curN, coverSum, wMin, wMax, inferred, minority, heavy, stringy, post, road, cliff });
  return a;
}

/** Statistics of the derived fuel map: type shares, hazard and load, curing, cover, flags. */
export function fuelStats(f: FuelMap): StatsResult<FuelFacts> {
  const n = f.grid.nx * f.grid.ny;
  const ctx = cellContext(f);
  const hazH = new Hist(0, 0.05, 80);
  const { sH, nsH, eH, bH, loadSum, loadMax, curSum, curN, coverSum, wMin, wMax, inferred, minority, heavy, stringy, post, road, cliff, types: typeCounts } = accumulateFuel(f, ctx, hazH);
  const types = Array.from(typeCounts);
  const facts: FuelFacts = {
    cells: n,
    typeShares: types.map((c) => c / n),
    nonFuelShare: types[FuelType.NonFuel]! / n,
    waterShare: types[FuelType.Water]! / n,
    inferredShare: inferred / n,
    minorityWetShare: minority / n,
    meanSurfaceHazard: sH / n,
    meanNearSurfaceHazard: nsH / n,
    meanElevatedHazard: eH / n,
    meanBarkHazard: bH / n,
    p90SurfaceHazard: hazH.quantile(0.9),
    meanSurfaceLoad: loadSum / n,
    maxSurfaceLoad: loadMax,
    meanCuring: curN ? curSum / curN : NaN,
    grassCells: curN,
    meanCanopyCover: coverSum / n,
    wrfMin: wMin,
    wrfMax: wMax,
    heavyFuelShare: heavy / n,
    stringybarkShare: stringy / n,
    postFireShare: post / n,
    roadShare: road / n,
    cliffShare: cliff / n,
  };
  const ranked = types.map((c, i) => ({ i, share: c / n })).filter((x) => x.share > 0).sort((a, b) => b.share - a.share);
  const stats: DatasetStat[] = ranked.slice(0, 4).map((x) => shareStat(FUEL_TYPES[x.i as FuelType].name, x.share));
  if (ranked.length > 4) stats.push(shareStat('All other fuel types', ranked.slice(4).reduce((s, x) => s + x.share, 0)));
  stats.push(
    stat('Litter fuel hazard, average (0 to 4)', facts.meanSurfaceHazard, '', 2, 'Overall Fuel Hazard Assessment Guide scale: 1 low, 2 moderate, 3 high, 4 very high.'),
    stat('Near-surface fuel hazard, average', facts.meanNearSurfaceHazard, '', 2),
    stat('Understorey (shrub) fuel hazard, average', facts.meanElevatedHazard, '', 2),
    stat('Bark hazard, average', facts.meanBarkHazard, '', 2),
    stat('Litter load, average', facts.meanSurfaceLoad, 't/ha', 1),
    stat('Litter load, heaviest cell', facts.maxSurfaceLoad, 't/ha', 1),
  );
  if (curN) stats.push(stat('Grass curing, average over grassy cells', facts.meanCuring, '%', 0, 'How much of the grass has dried off.'));
  stats.push(shareStat('Tree canopy cover, average', facts.meanCanopyCover));
  if (Number.isFinite(wMin)) stats.push(textStat('Wind reduction inside the fuel (open wind / wind at the flames)', `${num(wMin, 1)} to ${num(wMax, 1)}`));
  stats.push(
    shareStat('Heavy fuel (flag)', facts.heavyFuelShare),
    shareStat('Stringybark (flag)', facts.stringybarkShare, 'Stringybark throws embers a long way.'),
    shareStat('Recently burnt (flag)', facts.postFireShare),
    shareStat('Road or fire-break cells (flag)', facts.roadShare),
    shareStat('Cliff cells (flag)', facts.cliffShare),
  );
  return {
    stats,
    distribution: {
      kind: 'categorical',
      title: 'Fuel types',
      values: ranked.map((x) => round(x.share, 5)),
      labels: ranked.map((x) => FUEL_TYPES[x.i as FuelType].name),
      colours: ranked.map((x) => FUEL_TYPES[x.i as FuelType].colour),
      count: n,
    },
    facts,
  };
}

export interface VegetationFacts {
  cells: number;
  /** Share of cells filled by inference (no vegetation map there). */
  inferredShare: number;
  /** Share of cells with a mapped SVTM class other than "Not classified". */
  mappedShare: number;
  topClasses: { name: string; share: number }[];
}

/** Cells per vegetation class, leaving out the inferred ones (a small function, optimised at once). */
function accumulateClasses(n: number, cls: Uint8Array, flags: Uint16Array | undefined, ctx: Uint8Array | undefined): { byClass: Uint32Array; inferred: number } {
  const byClass = new Uint32Array(256);
  const INF = FuelFlag.InferredVegetation;
  let inferred = 0;
  for (let k = 0; k < n; k++) {
    const inf = flags ? (flags[k]! & INF) !== 0 : ctx ? (ctx[k]! & CTX_INFERRED) !== 0 : false;
    if (inf) {
      inferred++;
      continue;
    }
    byClass[cls[k]!]!++;
  }
  return { byClass, inferred };
}

/** Vegetation classes of the cells the vegetation map covers, and the share filled by inference. */
export function vegetationStats(f: FuelMap): StatsResult<VegetationFacts> {
  const n = f.grid.nx * f.grid.ny;
  const cls = f.fuelClass;
  const flags = f.flags;
  const ctx = cellContext(f);
  const counts = new Map<number, number>();
  const { byClass, inferred } = accumulateClasses(n, cls ?? f.type, flags, ctx);
  for (let c = 0; c < 256; c++) if (byClass[c]) counts.set(c, byClass[c]!);
  const ranked = [...counts.entries()].map(([c, cnt]) => ({ c, share: cnt / n })).sort((a, b) => b.share - a.share);
  const nameOf = (c: number): string => FUEL_CLASSES[c]?.name ?? `Class ${c}`;
  const top = ranked.slice(0, 5);
  const facts: VegetationFacts = {
    cells: n,
    inferredShare: inferred / n,
    mappedShare: ranked.reduce((s, x) => s + x.share, 0),
    topClasses: top.map((x) => ({ name: nameOf(x.c), share: x.share })),
  };
  const stats: DatasetStat[] = top.map((x) => shareStat(nameOf(x.c), x.share));
  if (ranked.length > top.length) stats.push(shareStat('All other mapped classes', ranked.slice(top.length).reduce((s, x) => s + x.share, 0)));
  stats.push(shareStat('Filled in by the app (no map data)', facts.inferredShare, 'Fuel type guessed from terrain and canopy where the vegetation map has nothing.'));
  const labels = [...top.map((x) => nameOf(x.c)), ...(ranked.length > top.length ? ['Other mapped classes'] : []), ...(inferred ? ['Inferred'] : [])];
  const values = [...top.map((x) => round(x.share, 5)), ...(ranked.length > top.length ? [round(ranked.slice(top.length).reduce((s, x) => s + x.share, 0), 5)] : []), ...(inferred ? [round(inferred / n, 5)] : [])];
  return { stats, distribution: { kind: 'categorical', title: 'Vegetation classes', values, labels, count: n }, facts };
}

export interface CanopyFacts {
  cells: number;
  measuredShare: number;
  p10: number;
  p50: number;
  p90: number;
  max: number;
  meanCover: number;
  shareOver15: number;
  shareOver30: number;
}

/** One pass over the canopy arrays: the height histogram, the cover sum and the counts per height band (a small function, optimised at once). */
function accumulateCanopy(f: FuelMap, n: number, ctx: Uint8Array | undefined, h: Hist, edges: readonly number[]): { cover: number; valid: number; counts: number[] } {
  const height = f.canopyHeight;
  const coverArr = f.canopyCover;
  const bands = edges.length - 1;
  const counts = new Uint32Array(bands);
  let cover = 0;
  let valid = 0;
  for (let k = 0; k < n; k++) {
    if (ctx && !(ctx[k]! & CTX_CHM_VALID)) continue;
    valid++;
    const v = height[k]!;
    h.add(v);
    cover += coverArr[k]!;
    let b = bands - 1;
    for (let i = 0; i < bands; i++) {
      if (v < edges[i + 1]!) {
        b = i;
        break;
      }
    }
    counts[b]!++;
  }
  return { cover, valid, counts: Array.from(counts) };
}

/** Canopy height and cover on the cells the canopy map measured (CTX_CHM_VALID); the rest use type defaults. */
export function canopyStats(f: FuelMap): StatsResult<CanopyFacts> {
  const n = f.grid.nx * f.grid.ny;
  const ctx = cellContext(f);
  const h = new Hist(0, 0.5, 200);
  const edges = [0, 2, 5, 10, 15, 20, 30, 45];
  const { cover, valid, counts } = accumulateCanopy(f, n, ctx, h, edges);
  const facts: CanopyFacts = {
    cells: n,
    measuredShare: ctx ? valid / n : NaN,
    p10: h.quantile(0.1),
    p50: h.quantile(0.5),
    p90: h.quantile(0.9),
    max: h.max,
    meanCover: valid ? cover / valid : NaN,
    shareOver15: h.shareAbove(15),
    shareOver30: h.shareAbove(30),
  };
  const stats: DatasetStat[] = [];
  if (ctx) stats.push(shareStat('Cells with measured canopy', facts.measuredShare, 'The rest use the typical height of their vegetation type.'));
  if (valid) {
    stats.push(
      stat('Canopy height, typical (median)', facts.p50, 'm', 1),
      stat('Canopy height, tall trees (90th percentile)', facts.p90, 'm', 1),
      stat('Canopy height, tallest', facts.max, 'm', 1),
      shareStat('Tree cover, average of measured cells', facts.meanCover),
      shareStat('Cells with trees over 15 m', facts.shareOver15),
      shareStat('Cells with trees over 30 m', facts.shareOver30),
    );
  }
  const total = counts.reduce((s, c) => s + c, 0);
  return { stats, ...(total ? { distribution: { kind: 'histogram' as const, title: 'Canopy height', unit: 'm', values: counts.map((c) => round(c / total, 5)), edges, count: total } } : {}), facts };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fire history
// ─────────────────────────────────────────────────────────────────────────────

export interface FireHistoryFacts {
  cells: number;
  noRecordShare: number;
  medianYearsSinceFire: number;
  p90YearsSinceFire: number;
  burntUnder5Share: number;
  burntUnder10Share: number;
  burntLast30Share: number;
  wildfireShare: number;
  prescribedShare: number;
  shortIntervalShare: number;
  includedFires: number;
  latestFire?: string;
  activeFires: string[];
}

/** One pass over the fire-history arrays of the fuel map (a small function, optimised at once). */
function accumulateHistory(f: FuelMap, n: number, h: Hist) {
  let none = 0;
  let u5 = 0;
  let u10 = 0;
  let wild = 0;
  let presc = 0;
  let c30 = 0;
  let tfi = 0;
  const tsf = f.timeSinceFire;
  const lastKind = f.lastFireKind;
  const count30 = f.fireCount30;
  const countTfi = f.fireCountTfi;
  const WILD = FireHistoryKind.Wildfire;
  const PRESC = FireHistoryKind.PrescribedBurn;
  for (let k = 0; k < n; k++) {
    const t = tsf[k]!;
    if (!(t === t)) {
      none++;
      continue;
    }
    h.add(t);
    if (t < 5) u5++;
    if (t < 10) u10++;
    const kind = lastKind[k]!;
    if (kind === WILD) wild++;
    else if (kind === PRESC || kind === 3) presc++;
    if (count30 && count30[k]! > 0) c30++;
    if (countTfi && countTfi[k]! > 0) tfi++;
  }
  return { none, u5, u10, wild, presc, c30, tfi };
}

/**
 * Time-since-fire statistics (0.25 year bins). `included` are the fire polygons that entered the fuel model,
 * `activeFires` those burning at the start.
 */
export function fireHistoryStats(f: FuelMap, opts: { included?: readonly FireHistoryRecord[]; activeFires?: readonly FireHistoryRecord[]; rawFeatures?: number; skipped?: number; verDate?: number | null } = {}): StatsResult<FireHistoryFacts> {
  const n = f.grid.nx * f.grid.ny;
  const h = new Hist(0, 0.25, 800);
  const { none, u5, u10, wild, presc, c30, tfi } = accumulateHistory(f, n, h);
  const included = opts.included ?? [];
  let latest = -Infinity;
  for (const r of included) latest = Math.max(latest, r.endTime ?? r.startTime);
  const active = (opts.activeFires ?? []).map((r) => r.name ?? r.label).filter(Boolean);
  const facts: FireHistoryFacts = {
    cells: n,
    noRecordShare: none / n,
    medianYearsSinceFire: h.quantile(0.5),
    p90YearsSinceFire: h.quantile(0.9),
    burntUnder5Share: u5 / n,
    burntUnder10Share: u10 / n,
    burntLast30Share: c30 / n,
    wildfireShare: wild / n,
    prescribedShare: presc / n,
    shortIntervalShare: tfi / n,
    includedFires: included.length,
    ...(Number.isFinite(latest) ? { latestFire: new Date(latest).toISOString().slice(0, 10) } : {}),
    activeFires: active,
  };
  const stats: DatasetStat[] = [shareStat('Cells with no fire on record', facts.noRecordShare, 'The model assumes fuel has built up to its steady state there.')];
  if (h.total) {
    stats.push(
      stat('Typical time since the last fire (median)', facts.medianYearsSinceFire, 'years', 1),
      stat('Long unburnt (90th percentile)', facts.p90YearsSinceFire, 'years', 1),
      shareStat('Burnt in the last 5 years', facts.burntUnder5Share),
      shareStat('Burnt in the last 10 years', facts.burntUnder10Share),
      shareStat('Last fire was a wildfire', facts.wildfireShare),
      shareStat('Last fire was a prescribed burn', facts.prescribedShare),
      shareStat('Burnt again within the minimum fire interval', facts.shortIntervalShare, 'Repeat fires closer together than the vegetation tolerates.'),
    );
  }
  if (opts.rawFeatures !== undefined) stats.push(stat('Fire polygons in the data', opts.rawFeatures, '', 0));
  stats.push(stat('Fire outlines used in the model', facts.includedFires, '', 0, 'A fire mapped in several pieces counts once per piece; fires after the start, or still burning at it, are not counted.'));
  if (facts.latestFire) stats.push(textStat('Most recent fire in the area', facts.latestFire));
  if (opts.skipped) stats.push(stat('Records skipped (no shape or season)', opts.skipped, ''));
  if (opts.verDate) stats.push(textStat('Data current to', new Date(opts.verDate).toISOString().slice(0, 10)));
  stats.push(textStat('Fires burning at the start', active.length ? active.join(', ') : 'none'));
  const edges = [0, 2, 5, 10, 20, 40, 100];
  const counts = new Array<number>(edges.length - 1).fill(0);
  for (let k = 0; k < n; k++) {
    const t = f.timeSinceFire[k]!;
    if (!(t === t)) continue;
    let b = edges.length - 2;
    for (let i = 0; i < edges.length - 1; i++) {
      if (t < edges[i + 1]!) {
        b = i;
        break;
      }
    }
    counts[b]!++;
  }
  return {
    stats,
    ...(h.total ? { distribution: { kind: 'histogram' as const, title: 'Years since the last fire (cells with a record)', unit: 'years', values: counts.map((c) => round(c / h.total, 5)), edges, count: h.total } } : {}),
    facts,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Weather and drought
// ─────────────────────────────────────────────────────────────────────────────

export interface WeatherFacts {
  /** Hourly stamps in the series (a preset adds extra stamps around its wind change). */
  stamps: number;
  /** Hours of weather before the start (moisture spin-up) and after it. */
  hoursBeforeStart: number;
  hoursAfterStart: number;
  tMin: number;
  tMax: number;
  rhMin: number;
  rhMax: number;
  windMeanKmh: number;
  windMaxKmh: number;
  gustMaxKmh: number;
  cloudMean: number;
  rainTotalMm: number;
  pressureLevelHours: number;
  lapseCorrectionM?: number;
  peakFfdi?: number;
  peakFfdiAt?: number;
  firstTime: number;
  lastTime: number;
}

/** Statistics of a weather series over the simulated window [t0, t0 + duration]. */
export function weatherStats(series: WeatherSeries, t0: number, durationS: number, opts: { terrainMedianElevation?: number } = {}): StatsResult<WeatherFacts> {
  const end = t0 + durationS * 1000;
  const hs = series.hours;
  let before = 0;
  let during = 0;
  let after = 0;
  let plHours = 0;
  let tMin = Infinity;
  let tMax = -Infinity;
  let rhMin = Infinity;
  let rhMax = -Infinity;
  let wSum = 0;
  let wMax = 0;
  let gMax = 0;
  let cSum = 0;
  let cN = 0;
  let rain = 0;
  let peak = -Infinity;
  let peakAt = 0;
  const df = series.droughtFactor;
  for (const h of hs) {
    if (h.pressureLevels && h.pressureLevels.length) plHours++;
    if (h.time < t0) {
      before++;
      continue;
    }
    if (h.time > end) {
      after++;
      continue;
    }
    during++;
    if (h.temperature < tMin) tMin = h.temperature;
    if (h.temperature > tMax) tMax = h.temperature;
    if (h.relativeHumidity < rhMin) rhMin = h.relativeHumidity;
    if (h.relativeHumidity > rhMax) rhMax = h.relativeHumidity;
    wSum += h.windSpeed10;
    if (h.windSpeed10 > wMax) wMax = h.windSpeed10;
    const g = h.windGust10 ?? h.windSpeed10;
    if (g > gMax) gMax = g;
    if (h.cloudCover !== undefined) {
      cSum += h.cloudCover;
      cN++;
    }
    if (h.precipitation) rain += h.precipitation;
    if (df !== undefined && Number.isFinite(df)) {
      const fi = ffdi(h.temperature, h.relativeHumidity, h.windSpeed10 * 3.6, df);
      if (fi > peak) {
        peak = fi;
        peakAt = h.time;
      }
    }
  }
  if (!during) {
    // A series with no stamp inside the window (should not happen): describe all of it.
    for (const h of hs) {
      tMin = Math.min(tMin, h.temperature);
      tMax = Math.max(tMax, h.temperature);
      rhMin = Math.min(rhMin, h.relativeHumidity);
      rhMax = Math.max(rhMax, h.relativeHumidity);
      wSum += h.windSpeed10;
      wMax = Math.max(wMax, h.windSpeed10);
      gMax = Math.max(gMax, h.windGust10 ?? h.windSpeed10);
    }
  }
  const nWin = during || hs.length;
  const lapse = opts.terrainMedianElevation !== undefined && series.sourceElevation !== undefined ? series.sourceElevation - opts.terrainMedianElevation : undefined;
  const first = hs[0]?.time ?? t0;
  const last = hs[hs.length - 1]?.time ?? t0;
  const facts: WeatherFacts = {
    stamps: hs.length,
    hoursBeforeStart: Math.max(0, (t0 - first) / 3.6e6),
    hoursAfterStart: Math.max(0, (last - t0) / 3.6e6),
    tMin,
    tMax,
    rhMin,
    rhMax,
    windMeanKmh: (wSum / Math.max(1, nWin)) * 3.6,
    windMaxKmh: wMax * 3.6,
    gustMaxKmh: gMax * 3.6,
    cloudMean: cN ? cSum / cN : NaN,
    rainTotalMm: rain,
    pressureLevelHours: plHours,
    ...(lapse !== undefined ? { lapseCorrectionM: lapse } : {}),
    ...(Number.isFinite(peak) ? { peakFfdi: peak, peakFfdiAt: peakAt } : {}),
    firstTime: hs[0]?.time ?? NaN,
    lastTime: hs[hs.length - 1]?.time ?? NaN,
  };
  const stats: DatasetStat[] = [
    textStat('Temperature during the run', `${num(tMin)} to ${num(tMax)} °C`),
    textStat('Relative humidity during the run', `${num(rhMin)} to ${num(rhMax)} %`),
    stat('Wind at 10 m, average', facts.windMeanKmh, 'km/h'),
    stat('Wind at 10 m, strongest hour', facts.windMaxKmh, 'km/h'),
    stat('Gusts, strongest', facts.gustMaxKmh, 'km/h'),
  ];
  if (cN) stats.push(stat('Cloud cover, average', facts.cloudMean, '%'));
  stats.push(stat('Rain during the run', facts.rainTotalMm, 'mm', 1));
  if (facts.peakFfdi !== undefined) stats.push(stat('Peak fire danger index (FFDI)', facts.peakFfdi, '', 0, 'McArthur Forest Fire Danger Index at the hottest, driest, windiest hour of the run.'));
  stats.push(
    stat('Weather before the start (fuel moisture spin-up)', facts.hoursBeforeStart, 'h'),
    stat('Weather after the start', facts.hoursAfterStart, 'h'),
    stat('Stamps with upper-air (pressure level) data', plHours, ''),
  );
  void before;
  void after;
  if (lapse !== undefined && Math.abs(lapse) >= 1 && (series.kind === 'forecast' || series.kind === 'historical')) stats.push(stat(lapse >= 0 ? 'Weather grid point is higher than the terrain (median) by' : 'Weather grid point is lower than the terrain (median) by', Math.abs(lapse), 'm', 0, 'Temperatures are corrected for this height difference.'));
  return { stats, facts };
}

export interface DroughtFacts {
  kbdi?: number;
  df?: number;
  annualRainfallMm?: number;
  dailyDays: number;
  rain365Mm: number;
  rainLast20Mm: number;
  daysSince1mm?: number;
  daysSince10mm?: number;
  hottestDay?: { date: string; tMax: number };
}

/** Drought inputs: KBDI, drought factor, rainfall totals and the days since rain. */
export function droughtStats(series: WeatherSeries): StatsResult<DroughtFacts> {
  const daily = series.daily ?? [];
  let rain = 0;
  let hot: { date: string; tMax: number } | undefined;
  let since1: number | undefined;
  let since10: number | undefined;
  for (let i = daily.length - 1; i >= 0; i--) {
    const d = daily[i]!;
    const daysAgo = daily.length - i;
    rain += d.rain > 0 ? d.rain : 0;
    if (since1 === undefined && d.rain >= 1) since1 = daysAgo;
    if (since10 === undefined && d.rain >= 10) since10 = daysAgo;
    if (Number.isFinite(d.tMax) && (!hot || d.tMax > hot.tMax)) hot = { date: d.date, tMax: d.tMax };
  }
  const last20 = (series.rainLast20 ?? []).reduce((s, v) => s + (v > 0 ? v : 0), 0);
  const facts: DroughtFacts = {
    ...(series.kbdi !== undefined ? { kbdi: series.kbdi } : {}),
    ...(series.droughtFactor !== undefined ? { df: series.droughtFactor } : {}),
    ...(series.annualRainfall !== undefined ? { annualRainfallMm: series.annualRainfall } : {}),
    dailyDays: daily.length,
    rain365Mm: rain,
    rainLast20Mm: last20,
    ...(since1 !== undefined ? { daysSince1mm: since1 } : {}),
    ...(since10 !== undefined ? { daysSince10mm: since10 } : {}),
    ...(hot ? { hottestDay: hot } : {}),
  };
  const stats: DatasetStat[] = [];
  if (facts.kbdi !== undefined) stats.push(stat('Keetch-Byram Drought Index (0 wet to 203 driest)', facts.kbdi, '', 0, 'How dry the deep soil and litter are after months of weather.'));
  if (facts.df !== undefined) stats.push(stat('Drought factor (0 to 10)', facts.df, '', 1, 'Feeds the McArthur fire danger index.'));
  if (facts.annualRainfallMm !== undefined) stats.push(stat('Usual yearly rainfall', facts.annualRainfallMm, 'mm'));
  if (daily.length) {
    stats.push(
      stat('Days of rain and temperature history', daily.length, 'days'),
      stat('Rain over that history', rain, 'mm'),
      stat('Rain in the last 20 days', last20, 'mm', 1),
    );
    if (since1 !== undefined) stats.push(stat('Days since 1 mm or more of rain', since1, 'days'));
    if (since10 !== undefined) stats.push(stat('Days since 10 mm or more of rain', since10, 'days'));
    if (hot) stats.push(textStat('Hottest day in the history', `${num(hot.tMax, 1)} °C on ${hot.date}`));
  }
  return { stats, facts };
}

// ─────────────────────────────────────────────────────────────────────────────
// Context layers
// ─────────────────────────────────────────────────────────────────────────────

const ROAD_GROUPS: { title: string; classes: RoadClass[] }[] = [
  { title: 'Highways and main roads', classes: ['motorway', 'primary', 'arterial'] },
  { title: 'Local roads', classes: ['subarterial', 'distributor', 'local', 'service'] },
  { title: 'Tracks and paths', classes: ['track', 'path'] },
];

export interface ContextFacts {
  roadKm: number;
  roadCount: number;
  roadKmByClass: Record<string, number>;
  unsealedKm: number;
  fireTrailKm: number;
  fireTrailCount: number;
  homes: number;
  zoneCount: number;
  zoneAreaKm2ByKind: Record<string, number>;
  zoneAreaKm2: number;
  places: number;
  placeKinds: Record<string, number>;
}

/** Signed shoelace area (m^2) of a ring [x0, y0, x1, y1, ...]. */
function ringArea(r: Float32Array): number {
  let a = 0;
  const n = r.length >> 1;
  for (let i = 0, j = n - 1; i < n; j = i++) a += r[2 * j]! * r[2 * i + 1]! - r[2 * i]! * r[2 * j + 1]!;
  return a / 2;
}

/** Counts, lengths and areas of the context layers (all layers of a ContextLayers, or its empty parts). */
export function contextStats(c: ContextLayers): { facts: ContextFacts; roads: DatasetStat[]; fireTrails: DatasetStat[]; homes: DatasetStat[]; zones: DatasetStat[]; places: DatasetStat[] } {
  const byClass: Record<string, number> = {};
  let roadM = 0;
  let unsealed = 0;
  for (const r of c.roads) {
    byClass[r.cls] = (byClass[r.cls] ?? 0) + r.lengthM;
    roadM += r.lengthM;
    if (r.surface === 2 || r.surface === 3) unsealed += r.lengthM;
  }
  let trailM = 0;
  for (const t of c.fireTrails) trailM += t.lengthM;
  const zoneArea: Record<string, number> = {};
  let zoneTotal = 0;
  for (const z of c.zones) {
    let a = 0;
    z.rings.forEach((ring, i) => (a += i === 0 ? Math.abs(ringArea(ring)) : -Math.abs(ringArea(ring))));
    a = Math.max(0, a) / 1e6;
    zoneArea[z.kind] = (zoneArea[z.kind] ?? 0) + a;
    zoneTotal += a;
  }
  const kinds: Record<string, number> = {};
  for (const p of c.places) kinds[p.kind] = (kinds[p.kind] ?? 0) + 1;
  const homes = c.homes.length >> 1;
  const facts: ContextFacts = {
    roadKm: km(roadM),
    roadCount: c.roads.length,
    roadKmByClass: Object.fromEntries(Object.entries(byClass).map(([k, v]) => [k, km(v)])),
    unsealedKm: km(unsealed),
    fireTrailKm: km(trailM),
    fireTrailCount: c.fireTrails.length,
    homes,
    zoneCount: c.zones.length,
    zoneAreaKm2ByKind: zoneArea,
    zoneAreaKm2: zoneTotal,
    places: c.places.length,
    placeKinds: kinds,
  };
  const roads: DatasetStat[] = [stat('Road and track segments', c.roads.length, ''), stat('Total length', facts.roadKm, 'km', 1)];
  for (const g of ROAD_GROUPS) {
    const len = g.classes.reduce((s, k) => s + (byClass[k] ?? 0), 0);
    if (len > 0) roads.push(stat(g.title, km(len), 'km', 1));
  }
  roads.push(stat('Unsealed (dirt) roads and tracks', facts.unsealedKm, 'km', 1));
  const fireTrails: DatasetStat[] = [stat('Fire trails', c.fireTrails.length, ''), stat('Total length', facts.fireTrailKm, 'km', 1, 'Trails the Rural Fire Service classifies for firefighting access.')];
  const homesStats: DatasetStat[] = [stat('Home address points', homes, '', 0, 'One point per address; a block of units shares a point.')];
  const zones: DatasetStat[] = [stat('Zones', c.zones.length, ''), stat('Total area', facts.zoneAreaKm2, 'km²', 2)];
  for (const [k, v] of Object.entries(zoneArea).sort((a, b) => b[1] - a[1])) zones.push(stat(ZONE_TITLES[k as ZoneKind] ?? k, v, 'km²', 2));
  const places: DatasetStat[] = [stat('Place names', c.places.length, '')];
  for (const [k, v] of Object.entries(kinds).sort((a, b) => b[1] - a[1])) places.push(stat(PLACE_TITLES[k] ?? `${k[0]!.toUpperCase()}${k.slice(1)}`, v, ''));
  return { facts, roads, fireTrails, homes: homesStats, zones, places };
}

const PLACE_TITLES: Record<string, string> = { region: 'Regions', city: 'Cities', town: 'Towns', village: 'Villages', locality: 'Localities', suburb: 'Suburbs' };

const ZONE_TITLES: Record<ZoneKind, string> = {
  residential: 'Residential',
  village: 'Village',
  envLiving: 'Environmental living',
  ruralSmall: 'Small rural lots',
  commercial: 'Commercial',
  industrial: 'Industrial',
  tourist: 'Tourist',
};

// ─────────────────────────────────────────────────────────────────────────────
// Fuel moisture at the start (worker output)
// ─────────────────────────────────────────────────────────────────────────────

export interface MoistureFacts {
  min: number;
  median: number;
  max: number;
  mean: number;
  shareUnder6: number;
  shareOver20: number;
}

/** Litter moisture (%) of the first snapshot: range, median and the shares where embers catch easily (< 6 %) or fire struggles (> 20 %). */
export function moistureStats(moisture: ArrayLike<number>): StatsResult<MoistureFacts> {
  const h = new Hist(0, 0.25, 480);
  let u6 = 0;
  let o20 = 0;
  const n = moisture.length;
  for (let k = 0; k < n; k++) {
    const m = moisture[k]!;
    h.add(m);
    if (m < 6) u6++;
    if (m > 20) o20++;
  }
  const facts: MoistureFacts = { min: h.min, median: h.quantile(0.5), max: h.max, mean: h.mean, shareUnder6: u6 / n, shareOver20: o20 / n };
  const stats = [
    textStat('Litter moisture range at the start', `${num(facts.min, 1)} to ${num(facts.max, 1)} %`),
    stat('Litter moisture, median', facts.median, '%', 1),
    shareStat('Cells drier than 6 % (embers catch easily)', facts.shareUnder6),
    shareStat('Cells wetter than 20 % (fire struggles)', facts.shareOver20),
  ];
  return { stats, facts };
}

