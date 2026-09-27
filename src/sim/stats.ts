/**
 * Snapshot statistics (spec §12.3). Pure functions over the fire field, aux rasters and the moisture field; O(N) per
 * snapshot (N = fire-grid cells), no allocation beyond small scratch.
 */
import { BurnState, FuelType, type FireAux, type FireField, type FuelMap, type GridSpec } from '../core/types';
import { SIM_PARAMS } from './params';

export interface FireStats {
  burntAreaHa: number;
  burningCells: number;
  perimeterKm: number;
  maxRos: number;
  maxIntensity: number;
  headDir: number;
  headRos: number;
  headIndex: number;
  convectiveNumber: number;
  /** Cells that have arrived (tArr ≤ t). */
  burntCells: number;
}

/**
 * Fire statistics at time t (s): burnt area N(tArr ≤ t)·Δx²/10⁴; perimeter = burnt/unburnt 4-neighbour edges·Δx·π/4
 * [D staircase correction]; max ROS / intensity over burning cells; head = front cell of max arrival ROS among cells
 * that arrived within `headWindowS` (else over the whole front); N_c = max over head cells (aux.direction ≥ 0.8) of
 * aux.nc averaged over the front cells of a 5×5 window.
 */
export function fireStats(field: FireField, aux: FireAux, t: number): FireStats {
  const g = field.grid;
  const { nx, ny } = g;
  const h = g.cellSize;
  const tArr = field.arrivalTime;
  const bs = field.burnState;
  const n = nx * ny;
  let burnt = 0;
  let edges = 0;
  let burning = 0;
  let maxRos = 0;
  let maxI = 0;
  const lim = t + 1e-6;
  for (let j = 0; j < ny; j++) {
    const row = j * nx;
    for (let i = 0; i < nx; i++) {
      const k = row + i;
      const b = tArr[k]! <= lim;
      if (b) {
        burnt++;
        if (i + 1 < nx && !(tArr[k + 1]! <= lim)) edges++;
        if (j + 1 < ny && !(tArr[k + nx]! <= lim)) edges++;
        if (i > 0 && !(tArr[k - 1]! <= lim)) edges++;
        if (j > 0 && !(tArr[k - nx]! <= lim)) edges++;
      }
      if (bs[k] === BurnState.Burning) {
        burning++;
        const r = field.ros[k]!;
        if (r > maxRos) maxRos = r;
        const I = field.intensity[k]!;
        if (I > maxI) maxI = I;
      }
    }
  }
  // Head: freshest part of the front first.
  const front = aux.front;
  let head = -1;
  let headR = -1;
  const win = SIM_PARAMS.headWindowS;
  for (let pass = 0; pass < 2 && head < 0; pass++) {
    for (let a = 0; a < front.length; a++) {
      const k = front[a]!;
      if (k < 0 || k >= n) continue;
      if (pass === 0 && !(t - tArr[k]! <= win)) continue;
      const r = field.ros[k]!;
      if (r > headR) {
        headR = r;
        head = k;
      }
    }
  }
  // Convective number: 5-cell (±2) window mean over front cells, max over head cells.
  const hw = SIM_PARAMS.ncHalfWidth;
  const nc = aux.nc;
  const dir = aux.direction;
  let ncMax = 0;
  if (front.length) {
    for (let a = 0; a < front.length; a++) {
      const k = front[a]!;
      if (k < 0 || k >= n || !(dir[k]! >= SIM_PARAMS.headDirection)) continue;
      const i = k % nx;
      const j = (k - i) / nx;
      let s = 0;
      let c = 0;
      for (let dj = -hw; dj <= hw; dj++) {
        const jj = j + dj;
        if (jj < 0 || jj >= ny) continue;
        for (let di = -hw; di <= hw; di++) {
          const ii = i + di;
          if (ii < 0 || ii >= nx) continue;
          const v = nc[jj * nx + ii]!;
          if (v > 0) {
            s += v;
            c++;
          }
        }
      }
      if (c > 0 && s / c > ncMax) ncMax = s / c;
    }
  }
  return {
    burntAreaHa: (burnt * h * h) / 1e4,
    burningCells: burning,
    perimeterKm: (edges * h * Math.PI) / 4 / 1000,
    maxRos,
    maxIntensity: maxI,
    headDir: head >= 0 && Number.isFinite(field.spreadDir[head]!) ? field.spreadDir[head]! : 0,
    headRos: head >= 0 ? Math.max(0, field.ros[head]!) : 0,
    headIndex: head,
    convectiveNumber: ncMax,
    burntCells: burnt,
  };
}

/**
 * Mean dead fuel moisture (%) over unburnt burnable cells within `radius` of the front (aux.frontDist), or over the
 * whole domain when there is no fire.
 */
export function moistureMean(moisture: Float32Array, field: FireField, frontDist: Float32Array, hasFire: boolean, radius = SIM_PARAMS.moistureMeanRadiusM): number {
  let s = 0;
  let c = 0;
  const bs = field.burnState;
  const tArr = field.arrivalTime;
  for (let pass = 0; pass < 2 && c === 0; pass++) {
    const near = pass === 0 && hasFire;
    for (let k = 0; k < moisture.length; k++) {
      if (bs[k] === BurnState.NonFlammable || tArr[k]! < Infinity) continue;
      if (near && !(frontDist[k]! <= radius)) continue;
      const m = moisture[k]!;
      if (!Number.isFinite(m)) continue;
      s += m;
      c++;
    }
    if (!near) break;
  }
  return c > 0 ? s / c : NaN;
}

/** Most common burnable fuel type of the map (the §12.3 / D41 FBI fuel); DryForestShrubby when none. */
export function dominantFuelType(fuel: FuelMap): FuelType {
  const counts = new Float64Array(32);
  const t = fuel.type;
  for (let k = 0; k < t.length; k++) counts[t[k]!]!++;
  let best = FuelType.DryForestShrubby as number;
  let bestN = -1;
  for (let f = 0; f < counts.length; f++) {
    if (f === FuelType.NonFuel || f === FuelType.Water || !(counts[f]! > 0)) continue;
    if (counts[f]! > bestN) {
      bestN = counts[f]!;
      best = f;
    }
  }
  return best as FuelType;
}

/**
 * Max arrival ROS of the front cells per block of `b` × `b` fire cells (m/s): the landing callback's rosLocal for
 * the ember exclusion zone (max over the 3 × 3 blocks around the landing ≈ the ROS of the nearest front).
 */
export function frontRosBlocks(field: FireField, aux: FireAux, b: number, out: Float32Array, bnx: number): void {
  out.fill(0);
  const { nx } = field.grid;
  const front = aux.front;
  const n = field.ros.length;
  for (let a = 0; a < front.length; a++) {
    const k = front[a]!;
    if (k < 0 || k >= n) continue;
    const i = k % nx;
    const j = (k - i) / nx;
    const q = Math.floor(j / b) * bnx + Math.floor(i / b);
    const r = field.ros[k]!;
    if (r > out[q]!) out[q] = r;
  }
}

/** rosLocal lookup of a cell in the block raster (max over the 3 × 3 blocks around it). */
export function frontRosAt(grid: GridSpec, blocks: Float32Array, b: number, bnx: number, bny: number, k: number): number {
  const i = k % grid.nx;
  const j = (k - i) / grid.nx;
  const bi = Math.floor(i / b);
  const bj = Math.floor(j / b);
  let r = 0;
  for (let dj = -1; dj <= 1; dj++) {
    const jj = bj + dj;
    if (jj < 0 || jj >= bny) continue;
    for (let di = -1; di <= 1; di++) {
      const ii = bi + di;
      if (ii < 0 || ii >= bnx) continue;
      const v = blocks[jj * bnx + ii]!;
      if (v > r) r = v;
    }
  }
  return r;
}
