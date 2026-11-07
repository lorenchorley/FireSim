/**
 * The quality map and the sizing numbers (pure functions of the fields written by 01_baseline.run.ts; no simulation here).
 *
 * COMPLEXITY (first definition, a pure function of the terrain; nothing is fitted to any result):
 *   five groups, each in [0, 1] from linear ramps whose edges are numbers the code already uses where it has one:
 *     S steepness   max( ramp(slope30, 15, 25 deg), ramp(slopeP90, 30, 60 deg) )
 *                   15 and 25 deg are the lee-separation edges (SPREAD_PARAMS.sep.slopeLoDeg / slopeHiDeg; 15 deg is also the gate
 *                   that makes a cell a candidate for the lee-separation and VLS terms, FireSpreadModel.ts ~l.363); 30 to 60 deg is
 *                   "steeper than the VLS edge (28) up to the cliff slope (60 = SCENARIO_PARAMS.cliffSlopeDeg)" for the 10 m
 *                   sub-cell slopes the 30 m cell smooths away (Terrain.slopeP90Deg)
 *     C cliff       ramp(cliffFraction, 0, 0.3)       0.3 = TERRAIN_FEATURE_PARAMS.cliff.minFraction (the cliff-mask threshold)
 *     G gully       max(trench score, drainage flag)  (terrainFeatures.ts: T of spec 7.6, upslope area >= 5 ha)
 *     L landform    1 on Ridge, Spur, Gully, Saddle, Peak, Cliff (the classes that bend flow or the front), else 0
 *     R relief      max( ramp(rough10, 0, 3 m), ramp(curv10, 0, 0.02 1/m) )  edges chosen a priori, not from the data: 3 m RMS
 *                   about the best plane is 10 % of a 30 m cell; 0.02 1/m is a 2 m kink against the mean of the four 10 m neighbours
 *   complexity = the plain mean of the five (equal weights: no group is known to matter more). The weights were not tuned.
 *   Sensitivity versions: the max of the five, the mean without L, and each group alone.
 *
 * IMPORTANCE (per cell, from the baseline run; a function of the simulation state and its scenario inputs only, never of
 * load or speed; here read back from the finished run, i.e. with a perfect forecast of arrival):
 *   I_time    exp(-t_arrival / 1 h) where the front reached the cell, else 0
 *   I_ros     min(1, local spread rate / 1 m/s)  where reached, else 0
 *   I_home    1 where reached and a home address lies within 300 m of the cell centre, else 0
 *   I_regime  1 where reached and the code's regime flag fired at the cell: junction boost > 1, attachment A.E >= 0.3
 *             (SPREAD_PARAMS.attachment.eruptiveAE), an active vorticity-lateral-spread zone, or the front arrived within 30 min after
 *             a forecast wind change (explain/params.ts windChange.holdAfterS is 20 min; 30 min used)
 *   importance = the plain mean of the four.
 * QUALITY = complexity x importance.
 */
import { Landform } from '../../../../src/core/types';

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const ramp = (v: number, lo: number, hi: number): number => clamp01((v - lo) / (hi - lo));

export interface Fields {
  slope30: Float32Array;
  slopeP90: Float32Array;
  cliffFrac: Float32Array;
  landform: Uint8Array;
  drainage: Uint8Array;
  trench: Float32Array;
  curv30: Float32Array;
  slope10Max: Float32Array;
  rough10: Float32Array;
  curv10: Float32Array;
  flammable: Uint8Array;
  arrival: Float32Array;
  ros: Float32Array;
  intensity: Float32Array;
  junMax: Float32Array;
  aeMax: Float32Array;
  vlsEver: Uint8Array;
  homes: Float32Array;
}

export interface Meta {
  site: string;
  name: string;
  centre: { lat: number; lon: number };
  grid: { nx: number; ny: number; cellSize: number; x0: number; y0: number };
  hours: number;
  ignition: { x: number; y: number };
  windChanges: { tS: number; fromDir: number; toDir: number; shift: number; postSpeed: number }[];
  air: { nx: number; ny: number; dxM: number; kind: string };
  series: { t: number; burntHa: number; burning: number; perimeterKm: number; headRos: number; maxRos: number; spots: number; front: number; wallS: number }[];
  engineSamples: { t: number; outerS: number | null; subS: number | null; fireMsPerOuter: number | null; subStepsPerOuter: number | null; burning: number | null }[];
  insightKinds: Record<string, number>;
  regimeInsights: [string, number, number, number][];
  homesInDomain: number;
  homesTotal: number;
  wall: { buildS: number; runS: number };
}

const FEATURE_LANDFORMS = new Set<number>([Landform.Ridge, Landform.Spur, Landform.Gully, Landform.Saddle, Landform.Peak, Landform.Cliff]);

export const COMPLEXITY_EDGES = {
  slope30: [15, 25],
  slopeP90: [30, 60],
  cliffFraction: [0, 0.3],
  rough10M: [0, 3],
  curv10PerM: [0, 0.02],
} as const;

export interface Complexity {
  S: Float32Array;
  C: Float32Array;
  G: Float32Array;
  L: Float32Array;
  R: Float32Array;
  mean: Float32Array;
  max: Float32Array;
  meanNoL: Float32Array;
  /** slope30 >= 15 deg: the cells the code already gates in for lee separation and VLS. */
  steep: Uint8Array;
}

export function complexity(a: Fields): Complexity {
  const n = a.slope30.length;
  const E = COMPLEXITY_EDGES;
  const S = new Float32Array(n);
  const C = new Float32Array(n);
  const G = new Float32Array(n);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const mean = new Float32Array(n);
  const max = new Float32Array(n);
  const meanNoL = new Float32Array(n);
  const steep = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    S[k] = Math.max(ramp(a.slope30[k]!, E.slope30[0], E.slope30[1]), ramp(a.slopeP90[k]!, E.slopeP90[0], E.slopeP90[1]));
    C[k] = ramp(a.cliffFrac[k]!, E.cliffFraction[0], E.cliffFraction[1]);
    G[k] = Math.max(a.trench[k]!, a.drainage[k]! ? 1 : 0);
    L[k] = FEATURE_LANDFORMS.has(a.landform[k]!) ? 1 : 0;
    R[k] = Math.max(ramp(a.rough10[k]!, E.rough10M[0], E.rough10M[1]), ramp(a.curv10[k]!, E.curv10PerM[0], E.curv10PerM[1]));
    mean[k] = (S[k]! + C[k]! + G[k]! + L[k]! + R[k]!) / 5;
    max[k] = Math.max(S[k]!, C[k]!, G[k]!, L[k]!, R[k]!);
    meanNoL[k] = (S[k]! + C[k]! + G[k]! + R[k]!) / 4;
    steep[k] = a.slope30[k]! >= 15 ? 1 : 0;
  }
  return { S, C, G, L, R, mean, max, meanNoL, steep };
}

/**
 * The top `p` share of cells by score (ties broken by the lower index). Cells with a score of 0 or less are never chosen, so a group
 * that is zero over most of the domain (cliff, gully) gives a set smaller than `p` instead of a set padded with arbitrary zeros.
 */
export function topShare(score: ArrayLike<number>, p: number): Uint8Array {
  const n = score.length;
  const order = Int32Array.from({ length: n }, (_, i) => i).sort((x, y) => score[y]! - score[x]! || x - y);
  const m = Math.round(p * n);
  const out = new Uint8Array(n);
  for (let q = 0; q < m; q++) if (score[order[q]!]! > 0) out[order[q]!] = 1;
  return out;
}

export const count = (m: ArrayLike<number>): number => {
  let c = 0;
  for (let i = 0; i < m.length; i++) if (m[i]) c++;
  return c;
};
export const countAnd = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  let c = 0;
  for (let i = 0; i < a.length; i++) if (a[i] && b[i]) c++;
  return c;
};
export const jaccard = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  let i = 0;
  let u = 0;
  for (let k = 0; k < a.length; k++) {
    if (a[k] && b[k]) i++;
    if (a[k] || b[k]) u++;
  }
  return u === 0 ? 1 : i / u;
};

/** Exact Euclidean distance (in cells) from each cell to the nearest cell with `feature[k] = 1` (Felzenszwalb and Huttenlocher; Infinity with none). */
export function distanceToFeature(feature: ArrayLike<number>, nx: number, ny: number): Float32Array {
  const INF = 1e20;
  const f = new Float64Array(Math.max(nx, ny));
  const d = new Float64Array(Math.max(nx, ny));
  const v = new Int32Array(Math.max(nx, ny));
  const z = new Float64Array(Math.max(nx, ny) + 1);
  const g = new Float64Array(nx * ny);
  const dt1 = (len: number): void => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
      while (s <= z[k]!) {
        k--;
        s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1]! < q) k++;
      const p = v[k]!;
      d[q] = (q - p) * (q - p) + f[p]!;
    }
  };
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) f[j] = feature[j * nx + i] ? 0 : INF;
    dt1(ny);
    for (let j = 0; j < ny; j++) g[j * nx + i] = d[j]!;
  }
  const out = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) f[i] = g[j * nx + i]!;
    dt1(nx);
    for (let i = 0; i < nx; i++) out[j * nx + i] = d[i]! >= INF / 2 ? Infinity : Math.sqrt(d[i]!);
  }
  return out;
}

export interface Importance {
  time: Float32Array;
  ros: Float32Array;
  home: Float32Array;
  regime: Float32Array;
  mean: Float32Array;
  /** The regime flag by source, for the shares. */
  flags: { junction: Uint8Array; eruptive: Uint8Array; vls: Uint8Array; windChange: Uint8Array; any: Uint8Array };
  /** Distance (m) to the nearest home address (cell resolution). */
  homeDistM: Float32Array;
}

export const HOME_RADIUS_M = 300;
export const WIND_CHANGE_PASSAGE_S = 1800;

export function importance(a: Fields, m: Meta): Importance {
  const { nx, ny, cellSize } = m.grid;
  const n = nx * ny;
  const homeCell = new Uint8Array(n);
  for (let q = 0; q < a.homes.length; q += 2) {
    const i = Math.round((a.homes[q]! - m.grid.x0) / cellSize);
    const j = Math.round((a.homes[q + 1]! - m.grid.y0) / cellSize);
    if (i >= 0 && j >= 0 && i < nx && j < ny) homeCell[j * nx + i] = 1;
  }
  const homeDistM = distanceToFeature(homeCell, nx, ny).map((c) => c * cellSize);
  const time = new Float32Array(n);
  const ros = new Float32Array(n);
  const home = new Float32Array(n);
  const regime = new Float32Array(n);
  const mean = new Float32Array(n);
  const flags = { junction: new Uint8Array(n), eruptive: new Uint8Array(n), vls: new Uint8Array(n), windChange: new Uint8Array(n), any: new Uint8Array(n) };
  for (let k = 0; k < n; k++) {
    const t = a.arrival[k]!;
    if (!Number.isFinite(t) || !a.flammable[k]) continue; // never reached: nothing of the run's importance
    time[k] = Math.exp(-t / 3600);
    ros[k] = Math.min(1, a.ros[k]! / 1);
    home[k] = homeDistM[k]! <= HOME_RADIUS_M ? 1 : 0;
    flags.junction[k] = a.junMax[k]! > 1.0001 ? 1 : 0;
    flags.eruptive[k] = a.aeMax[k]! >= 0.3 ? 1 : 0;
    flags.vls[k] = a.vlsEver[k] ? 1 : 0;
    for (const w of m.windChanges) if (t >= w.tS && t <= w.tS + WIND_CHANGE_PASSAGE_S) flags.windChange[k] = 1;
    flags.any[k] = flags.junction[k]! | flags.eruptive[k]! | flags.vls[k]! | flags.windChange[k]!;
    regime[k] = flags.any[k]!;
    mean[k] = (time[k]! + ros[k]! + home[k]! + regime[k]!) / 4;
  }
  return { time, ros, home, regime, mean, flags, homeDistM };
}

/**
 * Cells on the unburnt side of the front within `w` cells of burnt ground, at time `t` (burnt = arrival <= t).
 * Returns the distance field (cells; Infinity where there is no burnt cell) so that several widths share one transform.
 */
export function distanceAhead(arrival: Float32Array, t: number, nx: number, ny: number): Float32Array {
  const burnt = new Uint8Array(arrival.length);
  for (let k = 0; k < arrival.length; k++) burnt[k] = arrival[k]! <= t ? 1 : 0;
  return distanceToFeature(burnt, nx, ny);
}

/** Cells of the burnt set that touch an unburnt cell (4-neighbourhood) at time t: the front (for the air distance). */
export function frontMask(arrival: Float32Array, t: number, nx: number, ny: number): Uint8Array {
  const out = new Uint8Array(arrival.length);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (!(arrival[k]! <= t)) continue;
      if ((i > 0 && !(arrival[k - 1]! <= t)) || (i < nx - 1 && !(arrival[k + 1]! <= t)) || (j > 0 && !(arrival[k - nx]! <= t)) || (j < ny - 1 && !(arrival[k + nx]! <= t))) out[k] = 1;
    }
  }
  return out;
}
