/**
 * Sampling a vertical slice of the air (pure; plan 8.4). `sampleSlice` reads the air on a regular lattice along a line with
 * `AtmosphereSampler.fieldsP` (one lookup per lattice point, no boxed doubles), splits the wind into the slice's own
 * components and fills the arrays the curtain, the panel, the probe and the streaks all read. Its arrays are reused from one
 * update to the next. The conventions (along, across, up, units, validity, the lattice and the temperature anomaly) are
 * written once, at the top of types.ts.
 *
 * It also records the model's own cells that the line passes through, for "Show model cells": the real horizontal columns
 * and the real level boundaries, with the model's own value in each (not interpolated).
 */
import type { AtmosphereView } from '../../core/types';
import type { AtmosphereSampler } from '../atmosphereSampler';
import { SLICE_FIELD_IDS, type SliceCells, type SliceData, type SliceFieldId, type SliceSpec, type SliceTerrain } from './types';

/** The lowest row sits this far (m) under the lowest ground on the line; the top is the highest ground plus `ABOVE_GROUND_M`. */
const BELOW_GROUND_M = 50;
const ABOVE_GROUND_M = 2000;
/** Rows: about one per this many metres of height, between `MIN_ROWS` and `MAX_ROWS`. */
const ROW_SPACING_M = 50;
const MIN_ROWS = 48;
const MAX_ROWS = 56;
const MIN_COLUMNS = 48;
const MAX_COLUMNS = 192;
/** A slice whose height range is under this (m) is not worth drawing (the model top lies at or below the ground). */
const MIN_SPAN_M = 10;

// Scratch shared by every call: a computation allocates only when a line needs more room than any before it.
const pos = new Float64Array(4);
const f5 = new Float32Array(5);
let colX = new Float64Array(MAX_COLUMNS);
let colY = new Float64Array(MAX_COLUMNS);
let groundS = new Float32Array(MAX_COLUMNS);
let modelGroundS = new Float32Array(MAX_COLUMNS);
let crossT = new Float64Array(512);
let crossEdges = new Float64Array(512);
let crossCol = new Int32Array(512);
let faceZ = new Float64Array(64);
/** The mean temperature anomaly of each lattice row's valid cells (NaN for a row with none), kept for the model's cells. */
let rowMean = new Float64Array(64);

function ensureColumns(n: number): void {
  if (colX.length >= n) return;
  colX = new Float64Array(n);
  colY = new Float64Array(n);
  groundS = new Float32Array(n);
  modelGroundS = new Float32Array(n);
}

function allocValues(n: number): Record<SliceFieldId, Float32Array> {
  const v = {} as Record<SliceFieldId, Float32Array>;
  for (const id of SLICE_FIELD_IDS) v[id] = new Float32Array(n);
  return v;
}

function allocData(columns: number, rows: number): SliceData {
  return {
    seq: 0,
    kind: 'prognostic',
    line: { a: [0, 0], b: [0, 0], dir: [1, 0], length: 0 },
    columns,
    rows,
    zMin: 0,
    zMax: 0,
    topAsl: 0,
    values: allocValues(columns * rows),
    valid: new Uint8Array(columns * rows),
    ground: new Float32Array(columns),
    modelGround: new Float32Array(columns),
    has: { wind: false, theta: false, smoke: false },
    cellSizeM: 0,
    cells: null,
    airTime: null,
    shownTime: 0,
  };
}

/**
 * Sample the air along `spec.line` into a `SliceData`: `columns` (48 to 192, one per half model cell of the line) by `rows` (48 to
 * 56, linear in height from 50 m under the lowest ground on the line to the highest ground plus 2000 m or the model top). Every
 * lattice point in the model's air (above its own smoothed ground, at or below its top) is read from the sampler; the rest hold 0
 * and `valid` 0. `theta` is the temperature anomaly minus the mean of the valid points of its row. `out` of the same lattice
 * size is refilled in place (its `seq` counts up); any other size, or none, allocates. Returns null when the air holds no 3-D wind
 * (kind 'surface' or 'none') or the line has no length, or the model top lies at or below the ground.
 */
export function sampleSlice(sampler: AtmosphereSampler, terrain: SliceTerrain, spec: SliceSpec, out?: SliceData | null): SliceData | null {
  const atm = sampler.atm;
  if (!atm || !sampler.hasWind) return null;
  const line = spec.line;
  const length = line.length;
  if (!(length > 0) || !Number.isFinite(length)) return null;
  const cellSizeM = atm.grid.cellSize;
  const columns = Math.max(2, Math.floor(spec.columns ?? Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, Math.round(length / (0.5 * cellSizeM))))));
  ensureColumns(columns);

  // The ground under every column first: the height axis comes from it.
  const ax = line.a[0];
  const ay = line.a[1];
  const dx = line.dir[0];
  const dy = line.dir[1];
  const ds = length / (columns - 1);
  let lowest = Infinity;
  let highest = -Infinity;
  for (let c = 0; c < columns; c++) {
    const s = c * ds;
    const x = ax + dx * s;
    const y = ay + dy * s;
    colX[c] = x;
    colY[c] = y;
    const g = (groundS[c] = terrain.heightAt(x, y));
    modelGroundS[c] = sampler.modelGroundAt(x, y);
    if (g < lowest) lowest = g;
    if (g > highest) highest = g;
  }
  const topAsl = sampler.top;
  const zMin = lowest - BELOW_GROUND_M;
  const zMax = Math.min(highest + ABOVE_GROUND_M, topAsl);
  if (!(zMax - zMin >= MIN_SPAN_M)) return null;
  const rows = Math.max(2, Math.floor(spec.rows ?? Math.min(MAX_ROWS, Math.max(MIN_ROWS, Math.round((zMax - zMin) / ROW_SPACING_M)))));

  const d = out && out.columns === columns && out.rows === rows ? out : allocData(columns, rows);
  d.seq = (out?.seq ?? 0) + 1;
  d.kind = sampler.kind === 'prognostic' ? 'prognostic' : 'diagnosed';
  d.line = line;
  d.zMin = zMin;
  d.zMax = zMax;
  d.topAsl = topAsl;
  d.has.wind = true;
  d.has.theta = sampler.hasTheta;
  d.has.smoke = sampler.hasSmoke;
  d.cellSizeM = cellSizeM;
  d.airTime = sampler.airTime;
  d.shownTime = spec.shownTime;
  for (let c = 0; c < columns; c++) {
    d.ground[c] = groundS[c]!;
    d.modelGround[c] = modelGroundS[c]!;
  }

  const { speed, along, across, up, theta, smoke } = d.values;
  const valid = d.valid;
  const modelGround = d.modelGround;
  const ground = d.ground;
  const hasTheta = sampler.hasTheta;
  const dz = (zMax - zMin) / (rows - 1);
  if (rowMean.length < rows) rowMean = new Float64Array(rows);
  for (let r = 0; r < rows; r++) {
    const z = r === rows - 1 ? zMax : zMin + r * dz;
    const row = r * columns;
    let sum = 0;
    let n = 0;
    for (let c = 0; c < columns; c++) {
      const k = row + c;
      if (z >= modelGround[c]! && z <= topAsl) {
        pos[0] = colX[c]!;
        pos[1] = colY[c]!;
        pos[2] = z;
        pos[3] = Math.max(0, z - ground[c]!);
        sampler.fieldsP(pos, f5);
        const u = f5[0]!;
        const v = f5[1]!;
        speed[k] = Math.sqrt(u * u + v * v);
        along[k] = u * dx + v * dy;
        across[k] = u * dy - v * dx;
        up[k] = f5[2]!;
        theta[k] = f5[3]!;
        smoke[k] = f5[4]!;
        valid[k] = 1;
        sum += theta[k]!;
        n++;
      } else {
        speed[k] = 0;
        along[k] = 0;
        across[k] = 0;
        up[k] = 0;
        theta[k] = 0;
        smoke[k] = 0;
        valid[k] = 0;
      }
    }
    // The temperature anomaly against the slice's own air at this height: the row mean of the valid points comes off.
    rowMean[r] = hasTheta && n > 0 ? sum / n : NaN;
    if (hasTheta && n > 0) {
      const mean = sum / n;
      for (let c = 0; c < columns; c++) if (valid[row + c] === 1) theta[row + c] = theta[row + c]! - mean;
    }
  }
  d.cells = sliceCells(atm, sampler, line, d.cells, d.has.theta, d.has.smoke, zMin, dz, rows);
  return d;
}

// ─────────────────────────────────────────────────────────────────────────────
// The model's own cells along the line
// ─────────────────────────────────────────────────────────────────────────────

/** Level boundaries (zeta, m above the ground of the column) of the view's levels into `faceZ[0..nz]`; the first is the ground, the last the top. */
function levelFaces(atm: AtmosphereView): void {
  const nz = atm.nz;
  if (faceZ.length < nz + 1) faceZ = new Float64Array(nz + 1);
  const lv = atm.levels;
  const top = atm.topM !== undefined && atm.topM > 0 ? atm.topM : 0;
  const terrainFollowing = atm.layout === 'terrain-following';
  // The engine's levels are the centres of its layers (grid.ts: zetaC = zetaF + dzeta / 2), so each boundary is the previous one
  // reflected in the centre between: F[k + 1] = 2 C[k] - F[k], starting from the ground. That is exact; if it does not give
  // rising boundaries (a hand-made view with other levels), the midpoints between centres are used.
  let ok = terrainFollowing;
  if (terrainFollowing) {
    faceZ[0] = 0;
    for (let k = 0; k < nz && ok; k++) {
      faceZ[k + 1] = 2 * lv[k]! - faceZ[k]!;
      if (!(faceZ[k + 1]! > faceZ[k]!)) ok = false;
    }
    if (ok && top > 0) {
      if (top > faceZ[nz - 1]! && Math.abs(faceZ[nz]! - top) <= 0.02 * top) faceZ[nz] = top;
      else ok = false;
    }
  }
  if (!ok) {
    const first = nz > 1 ? lv[0]! - (lv[1]! - lv[0]!) / 2 : 0;
    faceZ[0] = terrainFollowing ? 0 : Math.max(0, first);
    for (let k = 1; k < nz; k++) faceZ[k] = (lv[k - 1]! + lv[k]!) / 2;
    const last = nz > 1 ? lv[nz - 1]! + (lv[nz - 1]! - lv[nz - 2]!) / 2 : lv[0]! * 2;
    faceZ[nz] = top > faceZ[nz - 1]! ? top : last;
  }
}

/** The lattice's row mean of the temperature anomaly at height `z` (linear between rows; a row with no valid cell is skipped, 0 if none has one). */
function rowMeanAt(z: number, zMin: number, dz: number, rows: number): number {
  const f = dz > 0 ? (z - zMin) / dz : 0;
  const r0 = f <= 0 ? 0 : Math.min(rows - 1, Math.floor(f));
  const r1 = Math.min(rows - 1, r0 + 1);
  const t = f <= 0 ? 0 : Math.min(1, f - r0);
  const a = rowMean[r0]!;
  const b = rowMean[r1]!;
  if (a !== a) return b !== b ? 0 : b; // NaN: that row has no valid cell
  if (b !== b) return a;
  return a + (b - a) * t;
}

/**
 * The model columns the line crosses, in order from A, with the boundaries between them (distance from A), the level
 * boundaries of each in metres ASL and the model's own value of every field at each cell centre. The horizontal cell of node
 * (i, j) is centred on it and one cell wide, so the line changes cell where it crosses a half-cell line. `theta` here is the
 * native anomaly minus the lattice's row mean at the height of the cell's centre (linear between rows): the same "against the
 * slice's air at that height" as the lattice, so a cell and the raster under it agree. (The model's levels follow the terrain,
 * so the mean of a level over the crossed cells would be a different, tilted reference.) Reuses `prev` when the line crosses the
 * same cells.
 */
function sliceCells(
  atm: AtmosphereView,
  sampler: AtmosphereSampler,
  line: SliceData['line'],
  prev: SliceCells | null,
  hasTheta: boolean,
  hasSmoke: boolean,
  zMin: number,
  rowDz: number,
  rows: number,
): SliceCells | null {
  const g = atm.grid;
  const nx = g.nx;
  const ny = g.ny;
  const cs = g.cellSize;
  const nz = atm.nz;
  const length = line.length;
  const dx = line.dir[0];
  const dy = line.dir[1];
  const ax = line.a[0];
  const ay = line.a[1];
  if (nz < 1 || nx < 1 || ny < 1 || !(cs > 0)) return null;
  const need = nx + ny + 8;
  if (crossT.length < need) {
    crossT = new Float64Array(need);
    crossEdges = new Float64Array(need);
    crossCol = new Int32Array(need);
  }

  // Where the line crosses a half-cell line (x = x0 + (i - 1/2) cs and the same for y), by distance from A, in order.
  let n = 0;
  if (Math.abs(dx) > 1e-12) {
    for (let i = 1; i < nx; i++) {
      const s = (g.x0 + (i - 0.5) * cs - ax) / dx;
      if (s > 1e-6 && s < length - 1e-6) crossT[n++] = s;
    }
  }
  if (Math.abs(dy) > 1e-12) {
    for (let j = 1; j < ny; j++) {
      const s = (g.y0 + (j - 0.5) * cs - ay) / dy;
      if (s > 1e-6 && s < length - 1e-6) crossT[n++] = s;
    }
  }
  for (let i = 1; i < n; i++) {
    const v = crossT[i]!;
    let j = i - 1;
    while (j >= 0 && crossT[j]! > v) {
      crossT[j + 1] = crossT[j]!;
      j--;
    }
    crossT[j + 1] = v;
  }

  // One cell per stretch between crossings; stretches in the same cell (a corner passed exactly) are one.
  let count = 0;
  let from = 0;
  for (let q = 0; q <= n; q++) {
    const to = q < n ? crossT[q]! : length;
    if (to - from < 1e-6 && q < n) continue;
    const mid = 0.5 * (from + to);
    const i = Math.min(nx - 1, Math.max(0, Math.floor((ax + dx * mid - g.x0) / cs + 0.5)));
    const j = Math.min(ny - 1, Math.max(0, Math.floor((ay + dy * mid - g.y0) / cs + 0.5)));
    const col = j * nx + i;
    if (count > 0 && crossCol[count - 1] === col) crossEdges[count] = to;
    else {
      crossCol[count] = col;
      crossEdges[count + 1] = to;
      count++;
    }
    from = to;
  }
  if (count === 0) return null;
  crossEdges[0] = 0;
  crossEdges[count] = length;

  const faces = nz + 1;
  let cells = prev;
  if (!cells || cells.count !== count || cells.levels !== nz) {
    cells = {
      count,
      edges: new Float32Array(count + 1),
      column: new Int32Array(count),
      levels: nz,
      zEdges: new Float32Array(count * faces),
      values: allocValues(count * nz),
    };
  }
  for (let c = 0; c <= count; c++) cells.edges[c] = crossEdges[c]!;
  for (let c = 0; c < count; c++) cells.column[c] = crossCol[c]!;

  levelFaces(atm);
  const base = sampler.base;
  const tf = atm.layout === 'terrain-following';
  const top = atm.topM !== undefined && atm.topM > 0 ? atm.topM : 0;
  const plane = nx * ny;
  const { speed, along, across, up, theta, smoke } = cells.values;
  for (let c = 0; c < count; c++) {
    const col = crossCol[c]!;
    const h0 = tf ? atm.terrainHeight[col]! : 0;
    const J = tf && top > 0 ? 1 - h0 / top : 1;
    for (let l = 0; l <= nz; l++) cells.zEdges[c * faces + l] = base + h0 + faceZ[l]! * J;
    for (let l = 0; l < nz; l++) {
      const k = c * nz + l;
      const src = l * plane + col;
      const u = atm.u[src]!;
      const v = atm.v[src]!;
      speed[k] = Math.sqrt(u * u + v * v);
      along[k] = u * dx + v * dy;
      across[k] = u * dy - v * dx;
      up[k] = atm.w[src]!;
      theta[k] = hasTheta ? atm.thetaAnomaly[src]! - rowMeanAt((cells.zEdges[c * faces + l]! + cells.zEdges[c * faces + l + 1]!) / 2, zMin, rowDz, rows) : 0;
      smoke[k] = hasSmoke ? atm.smoke[src]! : 0;
    }
  }
  return cells;
}
