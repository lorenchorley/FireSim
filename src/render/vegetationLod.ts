/**
 * Level-of-detail planning for the 3-D canopy (pure; no Three.js).
 *
 * Every instance gets one of three levels from its distance to the camera relative to its own height (i.e. from how big it
 * looks): 0 near = full model (~150–350 triangles), 1 mid = simplified (~40–60), 2 far = one billboard (2 triangles);
 * plants that would be smaller than a pixel are dropped, and groups without a far level (understorey, grass) simply vanish
 * with distance. The nearest instances win when a level is over its instance or triangle budget, so the totals are hard
 * limits: the plan never exceeds `maxTriangles` (250 k on quality 'high', 100 k on 'low') or `maxInstances`.
 * The plan is deterministic and depends only on the inputs (unit-tested).
 */
import { HAS_FAR_LOD, modelTriangles, type Lod, type ModelFamily } from './treeModels';
import { VegGroup, type VegInstances } from './vegetationPlacement';

/** Low plants: drawn in detail only very close, capped separately from the trees. */
export const isLowPlant = (g: VegGroup): boolean => g === VegGroup.Heath || g === VegGroup.Understorey || g === VegGroup.Grass;

export interface LodParams {
  /** Camera position: local x, y (m) and elevation z (m ASL). */
  cam: readonly [number, number, number];
  /** Terrain vertical exaggeration (tree heights are not exaggerated, positions are). */
  vex: number;
  /** Pixels per radian of the view (viewport height / vertical FOV). */
  pxPerRad: number;
  family: ModelFamily;
  /** Distance / tree height below which an instance is drawn with the near / mid model (default 14 / 55). */
  nearRatio?: number;
  midRatio?: number;
  /** Instance caps of the near and mid levels (trees; the low plants — heath, understorey, grass — have their own, see below). */
  maxNear: number;
  maxMid: number;
  /** Caps for the low plants (default 2 × / 1 × the tree caps): they must not use up the trees' share of the detailed levels. */
  maxNearSmall?: number;
  maxMidSmall?: number;
  /** Hard budget over all levels. */
  maxTriangles: number;
  maxInstances: number;
  /** Instances projected smaller than this many pixels are dropped (default 0.9). */
  minPx?: number;
  /** Groups not drawn at all (e.g. the understorey when it is switched off). */
  hidden?: ReadonlySet<VegGroup>;
}

export interface LodSet {
  group: VegGroup;
  lod: Lod;
  set: VegInstances;
}

export interface LodPlan {
  sets: LodSet[];
  /** Instances per level [near, mid, far] and in total. */
  counts: [number, number, number];
  instances: number;
  triangles: number;
}

export const DEFAULT_NEAR_RATIO = 14;
export const DEFAULT_MID_RATIO = 55;
/** Low plants (heath, understorey, grass) keep each level this much further out, relative to their height. */
export const LOW_PLANT_RANGE = 1.6;
/** Share of the triangle budget the near and mid levels may use at most (the far level gets the rest). */
export const NEAR_TRI_SHARE = 0.4;
export const MID_TRI_SHARE = 0.32;

/**
 * From the candidates (flat indices) keep those with the smallest key while the summed cost stays within `cap`.
 * O(n): a histogram over the key range, the boundary bin filled in candidate order. Returns [kept, dropped].
 */
export function capByKey(cands: number[], key: Float32Array, cost: (flat: number) => number, cap: number): [number[], number[]] {
  let total = 0;
  for (const c of cands) total += cost(c);
  if (total <= cap) return [cands, []];
  if (cap <= 0) return [[], cands];
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of cands) {
    const k = key[c]!;
    if (k < lo) lo = k;
    if (k > hi) hi = k;
  }
  const B = 512;
  const span = Math.max(hi - lo, 1e-9);
  const bin = (c: number): number => Math.min(B - 1, Math.floor(((key[c]! - lo) / span) * B));
  const hist = new Float64Array(B);
  for (const c of cands) hist[bin(c)]! += cost(c);
  let acc = 0;
  let cut = 0;
  for (; cut < B; cut++) {
    if (acc + hist[cut]! > cap) break;
    acc += hist[cut]!;
  }
  let quota = cap - acc;
  const kept: number[] = [];
  const dropped: number[] = [];
  for (const c of cands) {
    const b = bin(c);
    if (b < cut) kept.push(c);
    else if (b === cut && cost(c) <= quota) {
      kept.push(c);
      quota -= cost(c);
    } else dropped.push(c);
  }
  return [kept, dropped];
}

function subset(src: VegInstances, idx: number[]): VegInstances {
  const n = idx.length;
  const position = new Float32Array(n * 3);
  const size = new Float32Array(n * 2);
  const rand = new Float32Array(n * 2);
  const tint = new Uint8Array(n * 4);
  const info = new Uint8Array(n * 4);
  const aux = new Uint8Array(n * 4);
  for (let o = 0; o < n; o++) {
    const i = idx[o]!;
    position[o * 3] = src.position[i * 3]!;
    position[o * 3 + 1] = src.position[i * 3 + 1]!;
    position[o * 3 + 2] = src.position[i * 3 + 2]!;
    size[o * 2] = src.size[i * 2]!;
    size[o * 2 + 1] = src.size[i * 2 + 1]!;
    rand[o * 2] = src.rand[i * 2]!;
    rand[o * 2 + 1] = src.rand[i * 2 + 1]!;
    for (let q = 0; q < 4; q++) {
      tint[o * 4 + q] = src.tint[i * 4 + q]!;
      info[o * 4 + q] = src.info[i * 4 + q]!;
      aux[o * 4 + q] = src.aux[i * 4 + q]!;
    }
  }
  return { group: src.group, count: n, position, size, rand, tint, info, aux };
}

/** Distance from the camera to the middle of an instance (positions are exaggerated by `vex`, tree heights are not). */
function distanceTo(set: VegInstances, i: number, cam: readonly [number, number, number], vex: number): number {
  const dx = set.position[i * 3]! - cam[0];
  const dy = set.position[i * 3 + 1]! - cam[1];
  const dz = (set.position[i * 3 + 2]! - cam[2]) * vex + 0.5 * set.size[i * 2]!;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function planLod(sets: VegInstances[], p: LodParams): LodPlan {
  const nearR = p.nearRatio ?? DEFAULT_NEAR_RATIO;
  const midR = p.midRatio ?? DEFAULT_MID_RATIO;
  const minPx = p.minPx ?? 0.9;
  // Flatten: offsets of each set in the flat index space.
  const offs: number[] = [];
  let total = 0;
  for (const s of sets) {
    offs.push(total);
    total += s.count;
  }
  const key = new Float32Array(total); // distance / height (smaller = bigger on screen)
  const near: number[] = [];
  const mid: number[] = [];
  const far: number[] = [];
  const setOf = new Uint8Array(total);
  sets.forEach((s, si) => {
    if (p.hidden?.has(s.group)) return;
    const farOk = HAS_FAR_LOD[s.group];
    for (let i = 0; i < s.count; i++) {
      const f = offs[si]! + i;
      setOf[f] = si;
      const h = Math.max(0.05, s.size[i * 2]!);
      const d = Math.max(distanceTo(s, i, p.cam, p.vex), 1);
      if ((h / d) * p.pxPerRad < minPx) continue;
      const ratio = d / h;
      key[f] = ratio;
      // Low plants stay detailed a little further (the ladder fuel under the canopy is worth seeing from a low view).
      const k = isLowPlant(s.group) ? LOW_PLANT_RANGE : 1;
      if (ratio < nearR * k) near.push(f);
      else if (ratio < midR * k) mid.push(f);
      else if (farOk) far.push(f);
    }
  });
  // Triangles per instance of every (set, level): looked up per candidate, so no string keys or allocation in the hot loops.
  const triTab = new Float64Array(sets.length * 3);
  sets.forEach((s, si) => {
    for (const lv of [0, 1, 2] as const) triTab[si * 3 + lv] = modelTriangles(s.group, p.family, lv);
  });
  const trisOf = (lv: Lod) => (flat: number): number => triTab[setOf[flat]! * 3 + lv]!;
  // Near level: instance caps (trees and low plants separately), then the triangle share; the overflow moves to the mid level.
  const isSmall = (flat: number): boolean => isLowPlant(sets[setOf[flat]!]!.group);
  const split = (list: number[]): [number[], number[]] => {
    const a: number[] = [];
    const b: number[] = [];
    for (const f of list) (isSmall(f) ? b : a).push(f);
    return [a, b];
  };
  const [nearTrees, nearSmall] = split(near);
  const [kt, dt] = capByKey(nearTrees, key, () => 1, p.maxNear);
  const [ks, ds] = capByKey(nearSmall, key, () => 1, p.maxNearSmall ?? p.maxNear * 2);
  let nearKept = kt.concat(ks);
  let nearDrop = dt.concat(ds);
  let nearTris = 0;
  {
    const [k2, d2] = capByKey(nearKept, key, trisOf(0), p.maxTriangles * NEAR_TRI_SHARE);
    nearKept = k2;
    nearDrop = nearDrop.concat(d2);
    for (const f of nearKept) nearTris += trisOf(0)(f);
  }
  // Mid level (with the demoted near instances; groups without a far level lose the overflow).
  const midAll = mid.concat(nearDrop);
  const [midTrees, midSmall] = split(midAll);
  const [mt, mdt] = capByKey(midTrees, key, () => 1, p.maxMid);
  const [ms, mds] = capByKey(midSmall, key, () => 1, p.maxMidSmall ?? p.maxMid);
  let midKept = mt.concat(ms);
  let midDrop = mdt.concat(mds);
  {
    const [k2, d2] = capByKey(midKept, key, trisOf(1), p.maxTriangles * MID_TRI_SHARE);
    midKept = k2;
    midDrop = midDrop.concat(d2);
  }
  let midTris = 0;
  for (const f of midKept) midTris += trisOf(1)(f);
  // Far level: what is left of the triangle and instance budgets.
  const farAll = far.concat(midDrop.filter((f) => HAS_FAR_LOD[sets[setOf[f]!]!.group]));
  const farRoom = Math.max(0, Math.min(p.maxTriangles - nearTris - midTris, (p.maxInstances - nearKept.length - midKept.length) * 2));
  const [farKept] = capByKey(farAll, key, trisOf(2), farRoom);
  // Assemble.
  const groups: number[][][] = sets.map(() => [[], [], []]);
  const put = (list: number[], lv: 0 | 1 | 2): void => {
    for (const f of list) {
      const si = setOf[f]!;
      groups[si]![lv]!.push(f - offs[si]!);
    }
  };
  put(nearKept, 0);
  put(midKept, 1);
  put(farKept, 2);
  const out: LodSet[] = [];
  let triangles = 0;
  const counts: [number, number, number] = [0, 0, 0];
  sets.forEach((s, si) => {
    for (const lv of [0, 1, 2] as const) {
      const idx = groups[si]![lv]!;
      if (idx.length === 0) continue;
      out.push({ group: s.group, lod: lv, set: subset(s, idx) });
      counts[lv] += idx.length;
      triangles += idx.length * triTab[si * 3 + lv]!;
    }
  });
  return { sets: out, counts, instances: counts[0] + counts[1] + counts[2], triangles };
}

