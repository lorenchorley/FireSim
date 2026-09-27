/**
 * Deterministic placement of the "3-D forest" instances (pure; no Three.js).
 *
 * Stems are representative, not a census (doc 09 §8.3): the expected number of crowns per fuel cell follows the
 * canopy cover and a nominal crown spacing, then everything is scaled to fit a performance budget. Density is highest
 * around a focus point (the camera target) and thins with distance; distant crowns are drawn larger so the forest
 * still reads as continuous. Each instance is placed from a hash of (cell, slot, seed), so the same scenario always
 * gives the same trees and re-placing after a camera move only changes density, not the layout of surviving trees.
 */
import type { FuelMap } from '../core/types';
import { FuelType } from '../core/types';
import { clamp } from '../core/units';
import { hash01 } from './fields';
import { FUEL_GROUND, hexToRgb, mixRgb, type Rgb } from './palette';

/** Instance groups; each is one draw call with its own low-poly geometry. */
export enum VegGroup {
  /** Eucalypt (dry/wet sclerophyll, woodland, snow gum): open clumped crowns on a visible trunk. */
  Eucalypt = 0,
  /** Rainforest: dense dark rounded crowns. */
  Rainforest = 1,
  /** Pine plantation: cones. */
  Conifer = 2,
  /** Heath / understorey shrubs. */
  Shrub = 3,
  /** Grass tussocks. */
  Grass = 4,
}
export const VEG_GROUP_COUNT = 5;

export interface VegInstances {
  group: VegGroup;
  count: number;
  /** Local x, y (m) and ground elevation z (m ASL), packed [x, y, z] per instance. */
  position: Float32Array;
  /** [height (m), crown/shrub width (m)] per instance. */
  size: Float32Array;
  /** [rotation 0–1, random 0–1] per instance. */
  rand: Float32Array;
  /** sRGB tint 0–255 [r, g, b] per instance. */
  tint: Uint8Array;
}

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
  /** Minimum density multiplier far from the focus (default 0.12). */
  farDensity?: number;
  /** Multiplier on every group's density (e.g. 0.35 when an overlay is shown). */
  densityScale?: number;
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

/** Budget share per group when every group has demand (unused shares are redistributed). */
const SHARE: Record<VegGroup, number> = {
  [VegGroup.Eucalypt]: 0.52,
  [VegGroup.Rainforest]: 0.1,
  [VegGroup.Conifer]: 0.03,
  [VegGroup.Shrub]: 0.23,
  [VegGroup.Grass]: 0.12,
};

/** Nominal ground area per crown at 100 % cover (m²) — the "representative stem" spacing. */
const CROWN_AREA: Record<VegGroup, number> = {
  [VegGroup.Eucalypt]: 90,
  [VegGroup.Rainforest]: 90,
  [VegGroup.Conifer]: 40,
  [VegGroup.Shrub]: 30,
  [VegGroup.Grass]: 12,
};

interface Demand {
  /** Expected full-density count per fuel cell. */
  e: Float32Array;
  total: number;
}

/** Tree group of a fuel type (null = no trees). */
export function treeGroupOf(t: FuelType): VegGroup | null {
  switch (t) {
    case FuelType.Rainforest:
      return VegGroup.Rainforest;
    case FuelType.PinePlantation:
      return VegGroup.Conifer;
    case FuelType.DryForestShrubby:
    case FuelType.DryForestGrassy:
    case FuelType.WetForest:
    case FuelType.GrassyWoodland:
    case FuelType.SnowGumWoodland:
    case FuelType.Urban:
      return VegGroup.Eucalypt;
    case FuelType.Heath:
    case FuelType.AlpineHeathGrass:
    case FuelType.Grassland:
      return VegGroup.Eucalypt; // scattered emergent trees where the canopy raster says so
    default:
      return null;
  }
}

const isGrassy = (t: FuelType): boolean =>
  t === FuelType.Grassland || t === FuelType.GrassyWoodland || t === FuelType.AlpineHeathGrass || t === FuelType.DryForestGrassy || t === FuelType.SnowGumWoodland;
const isHeath = (t: FuelType): boolean => t === FuelType.Heath || t === FuelType.AlpineHeathGrass;

/** Expected instance counts per cell and group at full density. */
function demand(fuel: FuelMap): Demand[] {
  const g = fuel.grid;
  const n = g.nx * g.ny;
  const area = g.cellSize * g.cellSize;
  const out: Demand[] = [];
  for (let s = 0; s < VEG_GROUP_COUNT; s++) out.push({ e: new Float32Array(n), total: 0 });
  for (let k = 0; k < n; k++) {
    const t = fuel.type[k] as FuelType;
    if (t === FuelType.Water || t === FuelType.NonFuel) continue;
    const cover = clamp(fuel.canopyCover[k] ?? 0, 0, 1);
    const ch = fuel.canopyHeight[k] ?? 0;
    const tg = treeGroupOf(t);
    if (tg !== null && cover > 0.03 && ch >= 2.5) {
      const e = (area * cover) / CROWN_AREA[tg];
      out[tg]!.e[k] = e;
      out[tg]!.total += e;
    }
    // Shrubs: heath everywhere, forest understorey by elevated hazard.
    const eh = fuel.elevatedHazard[k] ?? 0;
    const shrubCover = isHeath(t) ? clamp(0.35 + 0.15 * eh, 0.2, 0.9) : clamp((eh - 0.5) / 3.5, 0, 0.7) * (1 - 0.5 * cover);
    if (shrubCover > 0) {
      const e = (area * shrubCover) / CROWN_AREA[VegGroup.Shrub];
      out[VegGroup.Shrub].e[k] = e;
      out[VegGroup.Shrub].total += e;
    }
    if (isGrassy(t)) {
      const ns = fuel.nearSurfaceHazard[k] ?? 1;
      const grassCover = clamp(0.25 + 0.15 * ns, 0.1, 0.85) * (1 - 0.6 * cover);
      const e = (area * grassCover) / CROWN_AREA[VegGroup.Grass];
      out[VegGroup.Grass].e[k] = e;
      out[VegGroup.Grass].total += e;
    }
  }
  return out;
}

/** Split a total budget over groups proportionally to SHARE, capped by demand, redistributing leftovers. */
export function splitBudget(budget: number, demandTotals: number[]): number[] {
  const alloc = new Array<number>(VEG_GROUP_COUNT).fill(0);
  let remaining = budget;
  let active = demandTotals.map((d) => d > 0);
  for (let pass = 0; pass < VEG_GROUP_COUNT && remaining > 0.5; pass++) {
    const shareSum = active.reduce((s, a, gi) => s + (a ? SHARE[gi as VegGroup] : 0), 0);
    if (shareSum <= 0) break;
    let used = 0;
    const next = active.slice();
    for (let gi = 0; gi < VEG_GROUP_COUNT; gi++) {
      if (!active[gi]) continue;
      const want = (remaining * SHARE[gi as VegGroup]) / shareSum;
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

const TINT_EUC: Rgb = hexToRgb(FUEL_GROUND[FuelType.DryForestShrubby].canopy);
const TINT_WET: Rgb = hexToRgb(FUEL_GROUND[FuelType.WetForest].canopy);
const TINT_SNOW: Rgb = hexToRgb(FUEL_GROUND[FuelType.SnowGumWoodland].canopy);
const TINT_RAIN: Rgb = hexToRgb(FUEL_GROUND[FuelType.Rainforest].canopy);
const TINT_PINE: Rgb = hexToRgb(FUEL_GROUND[FuelType.PinePlantation].canopy);
const TINT_HEATH: Rgb = hexToRgb('#7b7d55');
const TINT_SHRUB: Rgb = hexToRgb('#56643a');
const TINT_GRASS: Rgb = hexToRgb('#8f9650');
const TINT_CURED: Rgb = hexToRgb('#c2ae6c');

function tintFor(group: VegGroup, t: FuelType, curing: number, r: number, out: Rgb): Rgb {
  let base: Rgb;
  switch (group) {
    case VegGroup.Eucalypt:
      base = t === FuelType.WetForest ? TINT_WET : t === FuelType.SnowGumWoodland ? TINT_SNOW : TINT_EUC;
      break;
    case VegGroup.Rainforest:
      base = TINT_RAIN;
      break;
    case VegGroup.Conifer:
      base = TINT_PINE;
      break;
    case VegGroup.Shrub:
      base = isHeath(t) ? TINT_HEATH : TINT_SHRUB;
      break;
    case VegGroup.Grass:
      mixRgb(TINT_GRASS, TINT_CURED, clamp(curing / 100, 0, 1), out);
      base = out;
      break;
  }
  // ±10 % brightness and a slight olive/blue-green shift per instance.
  const b = 0.9 + 0.2 * r;
  const shift = (r - 0.5) * 0.06;
  out[0] = clamp(base[0] * b + shift, 0, 1);
  out[1] = clamp(base[1] * b, 0, 1);
  out[2] = clamp(base[2] * b - shift, 0, 1);
  return out;
}

/**
 * Place vegetation instances for a fuel map. Deterministic for the same inputs; the total count never exceeds the
 * budget (≤ {@link MAX_VEG_INSTANCES}).
 */
export function placeVegetation(fuel: FuelMap, opts: PlacementOptions): VegInstances[] {
  const budget = Math.min(MAX_VEG_INSTANCES, Math.max(0, Math.floor((opts.budget ?? 45000) * (opts.densityScale ?? 1))));
  const seed = opts.seed ?? 1;
  const g = fuel.grid;
  const n = g.nx * g.ny;
  const h = g.cellSize;
  const focus = opts.focus ?? [g.x0 + ((g.nx - 1) * h) / 2, g.y0 + ((g.ny - 1) * h) / 2];
  const R0 = opts.focusRadius ?? 1500;
  const far = opts.farDensity ?? 0.12;

  // Distance weight per cell (1 inside R0, ∝ (R0/d)² beyond, floored).
  const w = new Float32Array(n);
  for (let j = 0; j < g.ny; j++) {
    const dy = g.y0 + j * h - focus[1];
    for (let i = 0; i < g.nx; i++) {
      const dx = g.x0 + i * h - focus[0];
      const d = Math.hypot(dx, dy);
      w[j * g.nx + i] = d <= R0 ? 1 : Math.max(far, (R0 / d) ** 2);
    }
  }
  let dem: Demand[];
  if (opts.cache && opts.cache.fuel === fuel && opts.cache.demand) dem = opts.cache.demand;
  else {
    dem = demand(fuel);
    if (opts.cache) {
      opts.cache.fuel = fuel;
      opts.cache.demand = dem;
    }
  }
  const weightedTotals = dem.map((d) => {
    let s = 0;
    for (let k = 0; k < n; k++) s += d.e[k]! * w[k]!;
    return s;
  });
  const alloc = splitBudget(budget, weightedTotals);

  const result: VegInstances[] = [];
  const tint: Rgb = [0, 0, 0];
  for (let gi = 0; gi < VEG_GROUP_COUNT; gi++) {
    const group = gi as VegGroup;
    const d = dem[gi]!;
    const total = weightedTotals[gi]!;
    const cap = alloc[gi]!;
    const scale = total > 0 ? Math.min(1, cap / total) : 0;
    // First pass: counts per cell by deterministic stochastic rounding.
    const counts = new Uint8Array(n);
    let count = 0;
    if (scale > 0) {
      for (let k = 0; k < n; k++) {
        const e = d.e[k]! * w[k]! * scale;
        if (e <= 0) continue;
        const i = k % g.nx;
        const j = (k / g.nx) | 0;
        const c = Math.min(255, Math.floor(e + hash01(i, j, seed * 131 + gi)));
        counts[k] = c;
        count += c;
      }
    }
    if (count > cap) {
      // Stochastic rounding can overshoot slightly: trim from the far cells first (deterministic order).
      let excess = count - cap;
      for (let k = n - 1; k >= 0 && excess > 0; k--) {
        if (counts[k]! > 0 && w[k]! < 1) {
          const t = Math.min(counts[k]!, excess);
          counts[k]! -= t;
          excess -= t;
        }
      }
      for (let k = n - 1; k >= 0 && excess > 0; k--) {
        const t = Math.min(counts[k]!, excess);
        counts[k]! -= t;
        excess -= t;
      }
      count = cap;
    }
    const position = new Float32Array(count * 3);
    const size = new Float32Array(count * 2);
    const rand = new Float32Array(count * 2);
    const tints = new Uint8Array(count * 3);
    let o = 0;
    for (let k = 0; k < n && o < count; k++) {
      const c = counts[k]!;
      if (c === 0) continue;
      const i = k % g.nx;
      const j = (k / g.nx) | 0;
      const t = fuel.type[k] as FuelType;
      // Thinned (by the budget or by distance) → larger crowns keep the canopy looking continuous: each crown then
      // stands for a small clump of trees (max ×2.2 wider).
      const grow = Math.min(2.2, 1 / Math.sqrt(Math.max(w[k]! * scale, 0.05)));
      for (let s = 0; s < c && o < count; s++) {
        const base = seed * 977 + gi * 53 + s * 7;
        const rx = hash01(i, j, base + 1);
        const ry = hash01(i, j, base + 2);
        const r3 = hash01(i, j, base + 3);
        const r4 = hash01(i, j, base + 4);
        const x = g.x0 + (i + rx - 0.5) * h;
        const y = g.y0 + (j + ry - 0.5) * h;
        let height: number;
        let width: number;
        switch (group) {
          case VegGroup.Eucalypt: {
            const ch = Math.max(4, fuel.canopyHeight[k]!);
            height = ch * (0.72 + 0.42 * r3);
            width = clamp(height * (0.45 + 0.25 * r4), 3.5, 16) * grow;
            break;
          }
          case VegGroup.Rainforest: {
            const ch = Math.max(6, fuel.canopyHeight[k]!);
            height = ch * (0.8 + 0.3 * r3);
            width = clamp(height * (0.45 + 0.2 * r4), 5, 18) * grow;
            break;
          }
          case VegGroup.Conifer: {
            const ch = Math.max(5, fuel.canopyHeight[k]!);
            height = ch * (0.85 + 0.25 * r3);
            width = clamp(height * 0.3, 2.5, 8) * grow;
            break;
          }
          case VegGroup.Shrub: {
            const eh = isHeath(t) ? Math.max(fuel.elevatedHeight[k]!, fuel.nearSurfaceHeight[k]!, 0.8) : Math.max(fuel.elevatedHeight[k]!, 0.6);
            height = clamp(eh, 0.4, 6) * (0.7 + 0.6 * r3);
            width = clamp(height * (1.1 + 0.8 * r4), 0.8, 6) * Math.min(grow, 1.4);
            break;
          }
          case VegGroup.Grass: {
            const nh = Math.max(fuel.nearSurfaceHeight[k]!, 0.3);
            height = clamp(nh, 0.2, 1.5) * (0.7 + 0.6 * r3);
            width = height * (1.2 + 0.8 * r4) * Math.min(grow, 1.3);
            break;
          }
        }
        position[o * 3] = x;
        position[o * 3 + 1] = y;
        position[o * 3 + 2] = opts.heightAt(x, y);
        size[o * 2] = height;
        size[o * 2 + 1] = width;
        rand[o * 2] = r4;
        rand[o * 2 + 1] = r3;
        tintFor(group, t, fuel.curing[k] ?? 0, hash01(i, j, base + 5), tint);
        tints[o * 3] = Math.round(tint[0] * 255);
        tints[o * 3 + 1] = Math.round(tint[1] * 255);
        tints[o * 3 + 2] = Math.round(tint[2] * 255);
        o++;
      }
    }
    result.push({ group, count: o, position: position.subarray(0, o * 3), size: size.subarray(0, o * 2), rand: rand.subarray(0, o * 2), tint: tints.subarray(0, o * 3) });
  }
  return result;
}

/** Total instances over all groups. */
export const totalInstances = (v: VegInstances[]): number => v.reduce((s, g) => s + g.count, 0);
