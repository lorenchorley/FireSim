/**
 * Deterministic placement of the "3-D forest" instances (pure; no Three.js).
 *
 * Stems are representative, not a census (doc 09 §8.3): the expected number of crowns per fuel cell follows the canopy cover
 * and a nominal crown spacing, then everything is scaled to fit a performance budget. Density is highest around a focus
 * point (the camera target) and thins with distance; distant crowns are drawn a little wider so the forest still reads as
 * continuous, but TREE HEIGHTS always follow the canopy-height data. Each instance is placed from a hash of (cell, slot,
 * seed), so the same scenario always gives the same trees and re-placing after a camera move only changes density, not the
 * layout of surviving trees.
 *
 * Species (groups): the eucalypt family is split by bark class (stringybark / ribbon bark / smooth gum, from the fuel flags and
 * bark hazard) so the trunk teaches the ember-source hazard; tall wet forest, rainforest, snow gum and pine plantation (in
 * rows) have their own shapes; heath shrubs, forest UNDERSTOREY shrubs (real elevated-fuel height, more and lusher with a
 * higher elevated-fuel hazard) and grass tufts (colour follows the curing) complete the picture.
 *
 * The work is written as a resumable {@link PlacementJob} that is run a few milliseconds per frame, so re-placing the forest
 * when the camera settles never causes a visible hitch; {@link placeVegetation} runs the same job to completion.
 */
import type { GridSpec } from '../core/grid';
import type { FuelMap } from '../core/types';
import { FuelType } from '../core/types';
import { clamp } from '../core/units';
import { BARK_CODE, FOLIAGE, barkKindOf, type BarkKind } from './canopyStyle';
import { hash01 } from './fields';
import { mixRgb, type Rgb } from './palette';

/** Instance groups; each is drawn by its own meshes (one per level of detail). */
export enum VegGroup {
  /** Eucalypt with stringy bark: thick dark fibrous trunk, dense crown. */
  Stringybark = 0,
  /** Eucalypt with ribbon bark: pale trunk with hanging bark streamers. */
  Ribbonbark = 1,
  /** Smooth-barked gum: pale smooth trunk. */
  SmoothGum = 2,
  /** Tall wet forest: very tall straight trunks with small high crowns. */
  TallWetGum = 3,
  /** Rainforest: broad dense dark rounded crowns. */
  Rainforest = 4,
  /** Snow gum / alpine woodland: gnarled multi-stem trees with pale trunks. */
  SnowGum = 5,
  /** Pine plantation: conical crowns in rows. */
  Conifer = 6,
  /** Heath / shrubland mounds. */
  Heath = 7,
  /** Understorey shrubs under the canopy (the ladder fuel). */
  Understorey = 8,
  /** Grass tufts. */
  Grass = 9,
}
export const VEG_GROUP_COUNT = 10;

/** Names for UI and diagnostics. */
export const VEG_GROUP_LABELS: Record<VegGroup, string> = {
  [VegGroup.Stringybark]: 'Stringybark eucalypt',
  [VegGroup.Ribbonbark]: 'Ribbon-bark eucalypt',
  [VegGroup.SmoothGum]: 'Smooth-barked gum',
  [VegGroup.TallWetGum]: 'Tall wet-forest gum',
  [VegGroup.Rainforest]: 'Rainforest tree',
  [VegGroup.SnowGum]: 'Snow gum',
  [VegGroup.Conifer]: 'Pine',
  [VegGroup.Heath]: 'Heath shrub',
  [VegGroup.Understorey]: 'Understorey shrub',
  [VegGroup.Grass]: 'Grass',
};

/** Per-instance data, struct-of-arrays. */
export interface VegInstances {
  group: VegGroup;
  count: number;
  /** Local x, y (m) and ground elevation z (m ASL), packed [x, y, z] per instance. */
  position: Float32Array;
  /** [height (m), crown/shrub width (m)] per instance. */
  size: Float32Array;
  /** [rotation 0–1, random 0–1] per instance. */
  rand: Float32Array;
  /** sRGB tint 0–255 and the bark code (BARK_CODE), [r, g, b, bark] per instance. */
  tint: Uint8Array;
  /**
   * [bark hazard, understorey (elevated) hazard, canopy cover, years since fire] per instance, as bytes:
   * hazards = value / 4 × 255; cover = value × 255; years = min(250, round(years × 8)), 255 = no recorded fire.
   */
  info: Uint8Array;
  /**
   * [surface hazard, ground slope east, ground slope north, cell canopy height] per instance, as bytes:
   * surface hazard = value / 4 × 255; slope = (gradient / 2 + 0.5) × 255 (rise per metre, ±2); canopy height = m × 4 (max 63 m).
   */
  aux: Uint8Array;
}

/** Bytes per instance of the four packed attributes. */
export const INSTANCE_BYTES = 4;

export interface PlacementOptions {
  /** Total instance budget across all groups (default 45 000; hard cap 60 000). */
  budget?: number;
  seed?: number;
  /** Ground elevation (m ASL) at a local point (the render heightfield). */
  heightAt: (x: number, y: number) => number;
  /** Focus point (local m) around which density is highest; default the domain centre. */
  focus?: [number, number];
  /** Radius (m) of full density around the focus (default 1500). */
  focusRadius?: number;
  /** Minimum density multiplier far from the focus (default 0.12; a close camera can go down to 0.02). */
  farDensity?: number;
  /** Multiplier on every group's density (e.g. 0.4 when a heat map is shown). */
  densityScale?: number;
  /** False leaves out the understorey shrubs (their budget goes to the other groups). Default true. */
  understorey?: boolean;
  /**
   * Cache for the focus-independent demand pass (reuse between camera moves for the same fuel map; create a new one
   * after the fuel map changes).
   */
  cache?: PlacementCache;
}

/** Opaque cache of per-cell demand for one fuel map. */
export interface PlacementCache {
  fuel?: FuelMap;
  demand?: Demand[];
}

export const MAX_VEG_INSTANCES = 60000;

/** Placement families: the eucalypt family is split into three groups by bark. */
enum Fam {
  Eucalypt = 0,
  TallWet = 1,
  Rainforest = 2,
  SnowGum = 3,
  Conifer = 4,
  Heath = 5,
  Understorey = 6,
  Grass = 7,
}
const FAM_COUNT = 8;

/** Budget share per family when every family has demand (unused shares are redistributed). */
const SHARE: Record<Fam, number> = {
  [Fam.Eucalypt]: 0.55,
  [Fam.TallWet]: 0.06,
  [Fam.Rainforest]: 0.06,
  [Fam.SnowGum]: 0.03,
  [Fam.Conifer]: 0.04,
  [Fam.Heath]: 0.07,
  [Fam.Understorey]: 0.11,
  [Fam.Grass]: 0.08,
};

/**
 * How each family's density falls off with the distance from the focus: full density inside `radius` × the focus radius
 * (at least `minR` m), then (R/d)^`exp`, never below `floor`. Small plants only matter close to the camera, so they are
 * concentrated there and the budget goes to the trees that carry the view from afar.
 */
const FALLOFF: Record<Fam, { radius: number; minR: number; exp: number; floor: number }> = {
  [Fam.Eucalypt]: { radius: 1, minR: 0, exp: 2.5, floor: -1 },
  [Fam.TallWet]: { radius: 1, minR: 0, exp: 2.5, floor: -1 },
  [Fam.Rainforest]: { radius: 1, minR: 0, exp: 2.5, floor: -1 },
  [Fam.SnowGum]: { radius: 1, minR: 0, exp: 2.5, floor: -1 },
  [Fam.Conifer]: { radius: 1, minR: 0, exp: 2.5, floor: -1 },
  [Fam.Heath]: { radius: 0.5, minR: 250, exp: 3, floor: 0 },
  [Fam.Understorey]: { radius: 0.3, minR: 180, exp: 4, floor: 0 },
  [Fam.Grass]: { radius: 0.2, minR: 120, exp: 4, floor: 0 },
};

/** Nominal ground area per crown at 100 % cover (m²): the "representative stem" spacing. */
const CROWN_AREA: Record<Fam, number> = {
  [Fam.Eucalypt]: 90,
  [Fam.TallWet]: 110,
  [Fam.Rainforest]: 90,
  [Fam.SnowGum]: 40,
  [Fam.Conifer]: 22,
  [Fam.Heath]: 24,
  [Fam.Understorey]: 30,
  [Fam.Grass]: 12,
};

interface Demand {
  /** Expected full-density count per fuel cell. */
  e: Float32Array;
  total: number;
}

/** Tree family of a fuel type (null = no trees). */
function treeFamilyOf(t: FuelType): Fam | null {
  switch (t) {
    case FuelType.Rainforest:
      return Fam.Rainforest;
    case FuelType.PinePlantation:
      return Fam.Conifer;
    case FuelType.WetForest:
      return Fam.TallWet;
    case FuelType.SnowGumWoodland:
    case FuelType.AlpineHeathGrass:
      return Fam.SnowGum;
    case FuelType.DryForestShrubby:
    case FuelType.DryForestGrassy:
    case FuelType.GrassyWoodland:
    case FuelType.Urban:
    case FuelType.Heath: // scattered emergent trees where the canopy raster says so
    case FuelType.Grassland:
      return Fam.Eucalypt;
    default:
      return null;
  }
}

const isGrassy = (t: FuelType): boolean =>
  t === FuelType.Grassland || t === FuelType.GrassyWoodland || t === FuelType.AlpineHeathGrass || t === FuelType.DryForestGrassy || t === FuelType.SnowGumWoodland;
const isHeath = (t: FuelType): boolean => t === FuelType.Heath || t === FuelType.AlpineHeathGrass;

/** Demand of one cell, added into the arrays. */
function demandCell(fuel: FuelMap, k: number, area: number, out: Demand[]): void {
  const t = fuel.type[k] as FuelType;
  if (t === FuelType.Water || t === FuelType.NonFuel) return;
  const cover = clamp(fuel.canopyCover[k] ?? 0, 0, 1);
  const ch = fuel.canopyHeight[k] ?? 0;
  const tf = treeFamilyOf(t);
  if (tf !== null && cover > 0.03 && ch >= 2.5) {
    const e = (area * cover) / CROWN_AREA[tf];
    out[tf]!.e[k] = e;
    out[tf]!.total += e;
  }
  // Shrubs: heath everywhere, forest understorey by elevated hazard.
  const eh = fuel.elevatedHazard[k] ?? 0;
  if (isHeath(t)) {
    const shrubCover = clamp(0.35 + 0.15 * eh, 0.2, 0.9);
    const e = (area * shrubCover) / CROWN_AREA[Fam.Heath];
    out[Fam.Heath]!.e[k] = e;
    out[Fam.Heath]!.total += e;
  } else {
    const shrubCover = clamp((eh - 0.5) / 3.5, 0, 0.7) * (1 - 0.5 * cover);
    if (shrubCover > 0) {
      const e = (area * shrubCover) / CROWN_AREA[Fam.Understorey];
      out[Fam.Understorey]!.e[k] = e;
      out[Fam.Understorey]!.total += e;
    }
  }
  if (isGrassy(t)) {
    const ns = fuel.nearSurfaceHazard[k] ?? 1;
    const grassCover = clamp(0.25 + 0.15 * ns, 0.1, 0.85) * (1 - 0.6 * cover);
    const e = (area * grassCover) / CROWN_AREA[Fam.Grass];
    out[Fam.Grass]!.e[k] = e;
    out[Fam.Grass]!.total += e;
  }
}

/** Split a total budget over families proportionally to SHARE, capped by demand, redistributing leftovers. */
export function splitBudget(budget: number, demandTotals: number[]): number[] {
  const n = demandTotals.length;
  const alloc = new Array<number>(n).fill(0);
  let remaining = budget;
  let active = demandTotals.map((d) => d > 0);
  const share = (i: number): number => SHARE[i as Fam] ?? 1 / n;
  for (let pass = 0; pass < n && remaining > 0.5; pass++) {
    const shareSum = active.reduce((s, a, gi) => s + (a ? share(gi) : 0), 0);
    if (shareSum <= 0) break;
    let used = 0;
    const next = active.slice();
    for (let gi = 0; gi < n; gi++) {
      if (!active[gi]) continue;
      const want = (remaining * share(gi)) / shareSum;
      const room = demandTotals[gi]! - alloc[gi]!;
      const take = Math.min(want, room);
      alloc[gi]! += take;
      used += take;
      if (take >= room - 1e-9) next[gi] = false;
    }
    remaining -= used;
    active = next;
    if (used <= 0) break;
  }
  return alloc.map((a) => Math.floor(a));
}

/** Number of placement families (length of the array {@link splitBudget} works on in placement). */
export const PLACEMENT_FAMILIES = FAM_COUNT;

// ─────────────────────────────────────────────────────────────────────────────
// Tints
// ─────────────────────────────────────────────────────────────────────────────

const tmpA: Rgb = [0, 0, 0];

/** Variation of a base tint: ±12 % brightness and a slight olive ↔ blue-green shift (deterministic in r). */
function vary(base: Rgb, r: number, r2: number, out: Rgb): Rgb {
  const b = 0.88 + 0.24 * r;
  const shift = (r2 - 0.5) * 0.08;
  out[0] = clamp(base[0] * b + shift, 0, 1);
  out[1] = clamp(base[1] * b + shift * 0.25, 0, 1);
  out[2] = clamp(base[2] * b - shift, 0, 1);
  return out;
}

/** Natural-style foliage tint (sRGB 0–1) of an instance of a group. */
export function foliageTint(group: VegGroup, elevatedHazard: number, curing: number, r: number, r2: number, out: Rgb): Rgb {
  switch (group) {
    case VegGroup.Stringybark:
      return vary(FOLIAGE.stringy, r, r2, out);
    case VegGroup.Ribbonbark:
      return vary(FOLIAGE.ribbon, r, r2, out);
    case VegGroup.SmoothGum:
      return vary(FOLIAGE.smooth, r, r2, out);
    case VegGroup.TallWetGum:
      return vary(FOLIAGE.tallGum, r, r2, out);
    case VegGroup.Rainforest:
      return vary(FOLIAGE.rainforest, r, r2, out);
    case VegGroup.SnowGum:
      return vary(FOLIAGE.snowGum, r, r2, out);
    case VegGroup.Conifer:
      return vary(FOLIAGE.conifer, r, r2, out);
    case VegGroup.Heath:
      return vary(FOLIAGE.heath, r, r2, out);
    case VegGroup.Understorey:
      // Lusher (greener, darker) shrubs where the elevated fuel hazard is higher.
      mixRgb(FOLIAGE.understoreyDry, FOLIAGE.understoreyLush, clamp(elevatedHazard / 4, 0, 1), tmpA);
      return vary(tmpA, r, r2, out);
    case VegGroup.Grass:
      mixRgb(FOLIAGE.grassGreen, FOLIAGE.grassCured, clamp(curing / 100, 0, 1), tmpA);
      return vary(tmpA, r, r2, out);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The job
// ─────────────────────────────────────────────────────────────────────────────

/** Widest a crown is drawn relative to its true width when the forest is thinned (heights are never scaled). */
export const GROW_MAX = 1.7;

/** Rows of a pine plantation: direction (rad, from east) and spacing across / along the rows (m). */
const ROW_ANGLE = 0.35;
const ROW_ACROSS = 5.5;
const ROW_ALONG = 4;

enum Phase {
  Demand,
  Weights,
  Counts,
  Trim,
  Fill,
  Finish,
  Done,
}

/** Output arrays of one group while placing (capacity = the family's total, the used part is `n`). */
interface GroupOut {
  position: Float32Array;
  size: Float32Array;
  rand: Float32Array;
  tint: Uint8Array;
  info: Uint8Array;
  aux: Uint8Array;
  n: number;
}

/** The groups a family can produce (the eucalypt family is split by bark). */
const GROUPS_OF: Record<Fam, VegGroup[]> = {
  [Fam.Eucalypt]: [VegGroup.Stringybark, VegGroup.Ribbonbark, VegGroup.SmoothGum],
  [Fam.TallWet]: [VegGroup.TallWetGum],
  [Fam.Rainforest]: [VegGroup.Rainforest],
  [Fam.SnowGum]: [VegGroup.SnowGum],
  [Fam.Conifer]: [VegGroup.Conifer],
  [Fam.Heath]: [VegGroup.Heath],
  [Fam.Understorey]: [VegGroup.Understorey],
  [Fam.Grass]: [VegGroup.Grass],
};

/**
 * Resumable placement. Call {@link step} once per frame with a small time budget until it returns true, then read
 * {@link result}. Everything is deterministic in (fuel, options); the time budget only changes how many frames it takes.
 */
export class PlacementJob {
  private phase = Phase.Demand;
  private readonly g: GridSpec;
  private readonly n: number;
  private readonly seed: number;
  private readonly budget: number;
  private readonly focus: [number, number];
  private readonly R0: number;
  private readonly far: number;
  private readonly wantUnder: boolean;
  private dem: Demand[] | null = null;
  private cursor = 0;
  private w = new Float32Array(0);
  private weightedTotals: number[] = [];
  private scale: number[] = [];
  private cap: number[] = [];
  private counts: Uint8Array[] = [];
  private total: number[] = [];
  private outs: GroupOut[] = [];
  private res: VegInstances[] = [];

  constructor(
    private readonly fuel: FuelMap,
    private readonly opts: PlacementOptions,
  ) {
    this.g = fuel.grid;
    this.n = this.g.nx * this.g.ny;
    this.seed = opts.seed ?? 1;
    this.budget = Math.min(MAX_VEG_INSTANCES, Math.max(0, Math.floor((opts.budget ?? 45000) * (opts.densityScale ?? 1))));
    const h = this.g.cellSize;
    this.focus = opts.focus ?? [this.g.x0 + ((this.g.nx - 1) * h) / 2, this.g.y0 + ((this.g.ny - 1) * h) / 2];
    this.R0 = opts.focusRadius ?? 1500;
    this.far = opts.farDensity ?? 0.12;
    this.wantUnder = opts.understorey !== false;
    const c = opts.cache;
    if (c && c.fuel === fuel && c.demand) {
      this.dem = c.demand;
      this.phase = Phase.Weights;
    }
  }

  get done(): boolean {
    return this.phase === Phase.Done;
  }

  /** The placed instances, one set per group (valid once {@link done}). */
  get result(): VegInstances[] {
    return this.res;
  }

  /** Run for about `ms` milliseconds (never less than one small chunk of work). Returns true when finished. */
  step(ms = Infinity): boolean {
    const t0 = ms === Infinity ? 0 : performance.now();
    const over = (): boolean => ms !== Infinity && performance.now() - t0 >= ms;
    while (this.phase !== Phase.Done) {
      switch (this.phase) {
        case Phase.Demand:
          this.stepDemand(over);
          break;
        case Phase.Weights:
          this.stepWeights(over);
          break;
        case Phase.Counts:
          this.stepCounts(over);
          break;
        case Phase.Trim:
          this.trim();
          this.beginFill();
          break;
        case Phase.Fill:
          this.stepFill(over);
          break;
        case Phase.Finish:
          this.finish();
          break;
      }
      if ((this.phase as Phase) !== Phase.Done && over()) return false;
    }
    return true;
  }

  private stepDemand(over: () => boolean): void {
    const { n, g } = this;
    if (this.cursor === 0) {
      this.dem = [];
      for (let s = 0; s < FAM_COUNT; s++) this.dem.push({ e: new Float32Array(n), total: 0 });
    }
    const area = g.cellSize * g.cellSize;
    while (this.cursor < n) {
      const end = Math.min(n, this.cursor + 2048);
      for (let k = this.cursor; k < end; k++) demandCell(this.fuel, k, area, this.dem!);
      this.cursor = end;
      if (over()) return;
    }
    if (this.opts.cache) {
      this.opts.cache.fuel = this.fuel;
      this.opts.cache.demand = this.dem!;
    }
    this.cursor = 0;
    this.phase = Phase.Weights;
  }

  /** Density weight (0–1) of a family at distance d from the focus. */
  private weightAt(f: number, d: number): number {
    const fo = FALLOFF[f as Fam];
    const R = Math.max(fo.minR, this.R0 * fo.radius);
    const floor = fo.floor < 0 ? this.far : fo.floor;
    return d <= R ? 1 : Math.max(floor, (R / d) ** fo.exp);
  }

  private stepWeights(over: () => boolean): void {
    const { g, n } = this;
    const h = g.cellSize;
    if (this.cursor === 0) {
      this.w = new Float32Array(n * FAM_COUNT);
      this.weightedTotals = new Array<number>(FAM_COUNT).fill(0);
    }
    const dem = this.dem!;
    while (this.cursor < n) {
      const end = Math.min(n, this.cursor + 4096);
      for (let k = this.cursor; k < end; k++) {
        const i = k % g.nx;
        const j = (k / g.nx) | 0;
        const dx = g.x0 + i * h - this.focus[0];
        const dy = g.y0 + j * h - this.focus[1];
        const d = Math.hypot(dx, dy);
        for (let f = 0; f < FAM_COUNT; f++) {
          const e = dem[f]!.e[k]!;
          const wk = e > 0 ? this.weightAt(f, d) : 0;
          this.w[k * FAM_COUNT + f] = wk;
          this.weightedTotals[f]! += e * wk;
        }
      }
      this.cursor = end;
      if (over()) return;
    }
    if (!this.wantUnder) this.weightedTotals[Fam.Understorey] = 0;
    this.cap = splitBudget(this.budget, this.weightedTotals);
    this.scale = this.weightedTotals.map((t, f) => (t > 0 ? Math.min(1, this.cap[f]! / t) : 0));
    this.counts = [];
    for (let f = 0; f < FAM_COUNT; f++) this.counts.push(new Uint8Array(this.scale[f]! > 0 ? n : 0));
    this.total = new Array<number>(FAM_COUNT).fill(0);
    this.cursor = 0;
    this.phase = Phase.Counts;
  }

  private stepCounts(over: () => boolean): void {
    const { g, n } = this;
    const dem = this.dem!;
    while (this.cursor < n) {
      const end = Math.min(n, this.cursor + 4096);
      for (let k = this.cursor; k < end; k++) {
        const i = k % g.nx;
        const j = (k / g.nx) | 0;
        for (let f = 0; f < FAM_COUNT; f++) {
          const sc = this.scale[f]!;
          if (sc <= 0) continue;
          const e = dem[f]!.e[k]! * this.w[k * FAM_COUNT + f]! * sc;
          if (e <= 0) continue;
          // Stochastic rounding of the expected count, deterministic in (cell, seed, family).
          const c = Math.min(255, Math.floor(e + hash01(i, j, this.seed * 131 + f)));
          this.counts[f]![k] = c;
          this.total[f]! += c;
        }
      }
      this.cursor = end;
      if (over()) return;
    }
    this.phase = Phase.Trim;
  }

  /** Stochastic rounding can overshoot slightly: trim from the far cells first (deterministic order). */
  private trim(): void {
    const { n } = this;
    for (let f = 0; f < FAM_COUNT; f++) {
      const cap = this.cap[f]!;
      let excess = this.total[f]! - cap;
      if (excess <= 0) continue;
      const cn = this.counts[f]!;
      for (let k = n - 1; k >= 0 && excess > 0; k--) {
        if (cn[k]! > 0 && this.w[k * FAM_COUNT + f]! < 1) {
          const t = Math.min(cn[k]!, excess);
          cn[k]! -= t;
          excess -= t;
        }
      }
      for (let k = n - 1; k >= 0 && excess > 0; k--) {
        const t = Math.min(cn[k]!, excess);
        cn[k]! -= t;
        excess -= t;
      }
      this.total[f] = cap;
    }
  }

  private beginFill(): void {
    // One set of arrays per group, each with the capacity of its family: the result is then just views of these (no copy).
    const empty = (): GroupOut => ({ position: new Float32Array(0), size: new Float32Array(0), rand: new Float32Array(0), tint: new Uint8Array(0), info: new Uint8Array(0), aux: new Uint8Array(0), n: 0 });
    this.outs = Array.from({ length: VEG_GROUP_COUNT }, empty);
    for (let f = 0; f < FAM_COUNT; f++) {
      const c = this.total[f]!;
      if (c === 0) continue;
      for (const gr of GROUPS_OF[f as Fam]) {
        this.outs[gr] = {
          position: new Float32Array(c * 3),
          size: new Float32Array(c * 2),
          rand: new Float32Array(c * 2),
          tint: new Uint8Array(c * INSTANCE_BYTES),
          info: new Uint8Array(c * INSTANCE_BYTES),
          aux: new Uint8Array(c * INSTANCE_BYTES),
          n: 0,
        };
      }
    }
    this.cursor = 0;
    this.phase = Phase.Fill;
  }

  private stepFill(over: () => boolean): void {
    const { n } = this;
    while (this.cursor < n) {
      const end = Math.min(n, this.cursor + 384);
      for (let k = this.cursor; k < end; k++) this.fillCell(k);
      this.cursor = end;
      if (over()) return;
    }
    this.phase = Phase.Finish;
  }

  private fillCell(k: number): void {
    const { g, fuel, seed } = this;
    const h = g.cellSize;
    const i = k % g.nx;
    const j = (k / g.nx) | 0;
    const t = fuel.type[k] as FuelType;
    const cover = clamp(fuel.canopyCover[k] ?? 0, 0, 1);
    const canopyH = fuel.canopyHeight[k] ?? 0;
    const eh = fuel.elevatedHazard[k] ?? 0;
    const barkH = fuel.barkHazard[k] ?? 0;
    const surfH = fuel.surfaceHazard[k] ?? 0;
    const tsf = fuel.timeSinceFire[k];
    const flags = fuel.flags ? fuel.flags[k] : undefined;
    const curing = fuel.curing[k] ?? 0;
    const yearsByte = tsf === undefined || !Number.isFinite(tsf) || tsf < 0 ? 255 : Math.min(250, Math.round(tsf * 8));
    for (let f = 0; f < FAM_COUNT; f++) {
      const c = this.counts[f]?.[k] ?? 0;
      if (c === 0) continue;
      // Thinned (by the budget or by distance) → slightly wider crowns keep the canopy looking continuous (max ×1.8): each
      // crown then stands for a small clump of trees. Heights are never scaled.
      const grow = Math.min(GROW_MAX, 1 / Math.sqrt(Math.max(this.w[k * FAM_COUNT + f]! * this.scale[f]!, 0.05)));
      for (let s = 0; s < c; s++) {
        const base = seed * 977 + f * 53 + s * 7;
        const rx = hash01(i, j, base + 1);
        const ry = hash01(i, j, base + 2);
        const r3 = hash01(i, j, base + 3);
        const r4 = hash01(i, j, base + 4);
        const r5 = hash01(i, j, base + 5);
        const r6 = hash01(i, j, base + 6);
        let x = g.x0 + (i + rx - 0.5) * h;
        let y = g.y0 + (j + ry - 0.5) * h;
        let height: number;
        let width: number;
        let group: VegGroup;
        let bark: BarkKind = 'smooth';
        switch (f as Fam) {
          case Fam.Eucalypt: {
            bark = barkKindOf(flags, barkH, t, r6);
            group = bark === 'stringy' ? VegGroup.Stringybark : bark === 'ribbon' ? VegGroup.Ribbonbark : VegGroup.SmoothGum;
            const ch = Math.max(4, canopyH);
            height = ch * (0.86 + 0.24 * r3);
            const wr = bark === 'stringy' ? 0.44 + 0.16 * r4 : bark === 'ribbon' ? 0.42 + 0.16 * r4 : 0.4 + 0.14 * r4;
            width = clamp(height * wr, 3.5, 16) * grow;
            break;
          }
          case Fam.TallWet: {
            group = VegGroup.TallWetGum;
            bark = barkKindOf(flags, barkH, t, r6);
            const ch = Math.max(8, canopyH);
            height = ch * (0.9 + 0.2 * r3);
            width = clamp(height * (0.24 + 0.1 * r4), 5, 14) * Math.min(grow, 1.5);
            break;
          }
          case Fam.Rainforest: {
            group = VegGroup.Rainforest;
            const ch = Math.max(6, canopyH);
            height = ch * (0.86 + 0.24 * r3);
            width = clamp(height * (0.55 + 0.25 * r4), 6, 22) * grow;
            break;
          }
          case Fam.SnowGum: {
            group = VegGroup.SnowGum;
            const ch = Math.max(3, canopyH);
            height = ch * (0.86 + 0.28 * r3);
            width = clamp(height * (0.85 + 0.4 * r4), 3, 14) * Math.min(grow, 1.5);
            break;
          }
          case Fam.Conifer: {
            group = VegGroup.Conifer;
            const ch = Math.max(5, canopyH);
            height = ch * (0.9 + 0.2 * r3);
            width = clamp(height * 0.28, 2.5, 7) * Math.min(grow, 1.4);
            // Plantation rows: snap onto a rotated lattice that runs across cell borders.
            const ca = Math.cos(ROW_ANGLE);
            const sa = Math.sin(ROW_ANGLE);
            const u = Math.round((x * ca + y * sa) / ROW_ACROSS) * ROW_ACROSS;
            const v = Math.round((-x * sa + y * ca) / ROW_ALONG) * ROW_ALONG + (r5 - 0.5) * 0.8;
            x = u * ca - v * sa;
            y = u * sa + v * ca;
            break;
          }
          case Fam.Heath: {
            group = VegGroup.Heath;
            const hh = Math.max(fuel.elevatedHeight[k] ?? 0, 0.5);
            height = clamp(hh, 0.4, 4) * (0.75 + 0.5 * r3);
            width = clamp(height * (1.3 + 0.9 * r4), 0.8, 6) * Math.min(grow, 1.4);
            break;
          }
          case Fam.Understorey: {
            group = VegGroup.Understorey;
            // The cell's real elevated-fuel height; broader and bushier where the hazard is higher.
            const hh = Math.max(fuel.elevatedHeight[k] ?? 0, 0.4);
            height = clamp(hh, 0.3, 6) * (0.75 + 0.5 * r3);
            width = clamp(height * (0.75 + 0.5 * r4 + 0.12 * eh), 0.5, 5) * Math.min(grow, 1.3);
            break;
          }
          case Fam.Grass: {
            group = VegGroup.Grass;
            const nh = Math.max(fuel.nearSurfaceHeight[k] ?? 0, 0.3);
            height = clamp(nh, 0.15, 1.5) * (0.7 + 0.6 * r3);
            width = height * (1.2 + 0.8 * r4) * Math.min(grow, 1.3);
            break;
          }
        }
        const o = this.outs[group]!;
        const idx = o.n++;
        const z = this.opts.heightAt(x, y);
        o.position[idx * 3] = x;
        o.position[idx * 3 + 1] = y;
        o.position[idx * 3 + 2] = z;
        o.size[idx * 2] = height;
        o.size[idx * 2 + 1] = width;
        o.rand[idx * 2] = r4;
        o.rand[idx * 2 + 1] = r3;
        foliageTint(group, eh, curing, hash01(i, j, base + 8), r5, tmpA);
        const b = idx * INSTANCE_BYTES;
        o.tint[b] = Math.round(tmpA[0] * 255);
        o.tint[b + 1] = Math.round(tmpA[1] * 255);
        o.tint[b + 2] = Math.round(tmpA[2] * 255);
        o.tint[b + 3] = BARK_CODE[bark];
        o.info[b] = Math.round(clamp(barkH / 4, 0, 1) * 255);
        o.info[b + 1] = Math.round(clamp(eh / 4, 0, 1) * 255);
        o.info[b + 2] = Math.round(cover * 255);
        o.info[b + 3] = yearsByte;
        o.aux[b] = Math.round(clamp(surfH / 4, 0, 1) * 255);
        // Slope for the ground decal (contact shadow): central differences over ±3 m, only for the taller plants.
        if (group <= VegGroup.Conifer) {
          const gx = (this.opts.heightAt(x + 3, y) - this.opts.heightAt(x - 3, y)) / 6;
          const gy = (this.opts.heightAt(x, y + 3) - this.opts.heightAt(x, y - 3)) / 6;
          o.aux[b + 1] = Math.round((clamp(gx, -2, 2) / 2 + 0.5) * 255);
          o.aux[b + 2] = Math.round((clamp(gy, -2, 2) / 2 + 0.5) * 255);
        } else {
          o.aux[b + 1] = 128;
          o.aux[b + 2] = 128;
        }
        o.aux[b + 3] = Math.round(clamp(canopyH * 4, 0, 255));
      }
    }
  }

  private finish(): void {
    this.res = this.outs.map((o, gi) => ({
      group: gi as VegGroup,
      count: o.n,
      position: o.position.subarray(0, o.n * 3),
      size: o.size.subarray(0, o.n * 2),
      rand: o.rand.subarray(0, o.n * 2),
      tint: o.tint.subarray(0, o.n * INSTANCE_BYTES),
      info: o.info.subarray(0, o.n * INSTANCE_BYTES),
      aux: o.aux.subarray(0, o.n * INSTANCE_BYTES),
    }));
    this.outs = [];
    this.counts = [];
    this.w = new Float32Array(0);
    this.phase = Phase.Done;
  }
}

/**
 * Place vegetation instances for a fuel map. Deterministic for the same inputs; the total count never exceeds the
 * budget (≤ {@link MAX_VEG_INSTANCES}). Runs {@link PlacementJob} to completion in one go.
 */
export function placeVegetation(fuel: FuelMap, opts: PlacementOptions): VegInstances[] {
  const job = new PlacementJob(fuel, opts);
  job.step(Infinity);
  return job.result;
}

/** Total instances over all groups. */
export const totalInstances = (v: VegInstances[]): number => v.reduce((s, g) => s + g.count, 0);
