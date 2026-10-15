/**
 * Test fixtures for the air slice (not imported by application code): a literal `SliceData` made from functions of
 * (distance along the line, height), a terrain-following `AtmosphereView` made from functions of (x, y, height ASL), and a
 * `SliceResolveContext`. They follow the conventions at the top of types.ts, so a test of the panel, the probe or the streaks
 * starts from numbers that mean what the real sampler's mean.
 */
import { makeGridSpec, type GridSpec } from '../../core/grid';
import type { AtmosphereView } from '../../core/types';
import { SLICE_FIELD_IDS, type SliceCells, type SliceData, type SliceFieldId, type SliceHas, type SliceKind, type SlicePoint, type SliceResolveContext } from './types';

export interface SliceFixtureOptions {
  columns?: number;
  rows?: number;
  /** The line, A to B in local metres (default (0, 0) to (3000, 0), due east). */
  a?: SlicePoint;
  b?: SlicePoint;
  kind?: SliceKind;
  zMin?: number;
  zMax?: number;
  topAsl?: number;
  /** The 10 m ground and the model's own ground under the point `s` metres from A (default 100 m, and the same). */
  ground?: (s: number) => number;
  modelGround?: (s: number) => number;
  /** The wind (u east, v north, w up; m/s) at (s, z ASL); default a steady 5 m/s from the west. */
  wind?: (s: number, z: number) => readonly [number, number, number];
  /** The raw temperature anomaly (K) and smoke at (s, z); the row mean of the valid cells comes off the temperature, as in `sampleSlice`. */
  theta?: (s: number, z: number) => number;
  smoke?: (s: number, z: number) => number;
  has?: Partial<SliceHas>;
  cellSizeM?: number;
  airTime?: number | null;
  shownTime?: number;
  seq?: number;
  cells?: SliceCells | null;
}

/** A `SliceData` built from functions, with every convention applied (along, across, validity, row-mean temperature). */
export function makeSliceData(o: SliceFixtureOptions = {}): SliceData {
  const columns = o.columns ?? 60;
  const rows = o.rows ?? 40;
  const a: SlicePoint = o.a ?? [0, 0];
  const b: SlicePoint = o.b ?? [3000, 0];
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const dir: [number, number] = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
  const kind = o.kind ?? 'prognostic';
  const zMin = o.zMin ?? 0;
  const zMax = o.zMax ?? 2000;
  const topAsl = o.topAsl ?? Math.max(zMax, 3000);
  const ground = o.ground ?? (() => 100);
  const modelGround = o.modelGround ?? ground;
  const wind = o.wind ?? (() => [5, 0, 0] as const);
  const has: SliceHas = { wind: true, theta: kind === 'prognostic', smoke: kind === 'prognostic', ...o.has };
  const n = columns * rows;
  const values = {} as Record<SliceFieldId, Float32Array>;
  for (const id of SLICE_FIELD_IDS) values[id] = new Float32Array(n);
  const valid = new Uint8Array(n);
  const g = new Float32Array(columns);
  const mg = new Float32Array(columns);
  for (let c = 0; c < columns; c++) {
    const s = (c / (columns - 1)) * length;
    g[c] = ground(s);
    mg[c] = modelGround(s);
  }
  for (let r = 0; r < rows; r++) {
    const z = zMin + (r / (rows - 1)) * (zMax - zMin);
    let sum = 0;
    let count = 0;
    for (let c = 0; c < columns; c++) {
      const s = (c / (columns - 1)) * length;
      const k = r * columns + c;
      if (!(z >= mg[c]! && z <= topAsl)) continue;
      const [u, v, w] = wind(s, z);
      valid[k] = 1;
      values.speed[k] = Math.hypot(u, v);
      values.along[k] = u * dir[0] + v * dir[1];
      values.across[k] = u * dir[1] - v * dir[0];
      values.up[k] = w;
      if (has.theta) {
        values.theta[k] = o.theta ? o.theta(s, z) : 0;
        sum += values.theta[k]!;
        count++;
      }
      if (has.smoke) values.smoke[k] = o.smoke ? o.smoke(s, z) : 0;
    }
    if (count > 0) {
      const mean = sum / count;
      for (let c = 0; c < columns; c++) if (valid[r * columns + c]) values.theta[r * columns + c] = values.theta[r * columns + c]! - mean;
    }
  }
  return {
    seq: o.seq ?? 1,
    kind,
    line: { a: [a[0], a[1]], b: [b[0], b[1]], dir, length },
    columns,
    rows,
    zMin,
    zMax,
    topAsl,
    values,
    valid,
    ground: g,
    modelGround: mg,
    has,
    cellSizeM: o.cellSizeM ?? 133,
    cells: o.cells ?? null,
    airTime: o.airTime === undefined ? 600 : o.airTime,
    shownTime: o.shownTime ?? 600,
  };
}

export interface AirViewOptions {
  /** The horizontal grid of the model's columns (default 31 x 31 of 200 m, centred on the origin). */
  grid?: GridSpec;
  nz?: number;
  /** Model top above the datum (m) and the datum itself (m ASL). */
  topM?: number;
  baseM?: number;
  /** The model's own ground (m ASL) at a column. */
  groundAt?: (x: number, y: number) => number;
  /** Fields as functions of (x, y, height ASL); a field left out is all zero, `null` leaves the array empty (a diagnosed view has no temperature or smoke). */
  u?: (x: number, y: number, z: number) => number;
  v?: (x: number, y: number, z: number) => number;
  w?: (x: number, y: number, z: number) => number;
  theta?: ((x: number, y: number, z: number) => number) | null;
  smoke?: ((x: number, y: number, z: number) => number) | null;
  kind?: 'prognostic' | 'diagnosed';
  time?: number;
}

/**
 * A terrain-following `AtmosphereView` with analytic fields. Level k of column c is at `base + h0 + zeta_k x J` ASL
 * (levels stretched like the engine's: layers thicken upwards), the field value is the function at that point, so a field that
 * is linear in x, y and height ASL is reproduced exactly by the sampler between the levels.
 */
export function makeAirView(o: AirViewOptions = {}): AtmosphereView {
  const grid = o.grid ?? makeGridSpec({ lat: -33.7, lon: 150.3 }, 6200, 200);
  const nz = o.nz ?? 20;
  const topM = o.topM ?? 3000;
  const baseM = o.baseM ?? 500;
  const groundAt = o.groundAt ?? (() => baseM);
  const plane = grid.nx * grid.ny;
  // Layers of thickness r^k; faces scaled to end at topM; centres in the middle of each layer (as grid.ts builds them).
  const ratio = 1.15;
  const thick = Array.from({ length: nz }, (_, k) => ratio ** k);
  const sum = thick.reduce((p, q) => p + q, 0);
  const levels = new Float32Array(nz);
  let face = 0;
  for (let k = 0; k < nz; k++) {
    const d = (thick[k]! / sum) * topM;
    levels[k] = face + d / 2;
    face += d;
  }
  const terrainHeight = new Float32Array(plane);
  for (let c = 0; c < plane; c++) terrainHeight[c] = groundAt(grid.x0 + (c % grid.nx) * grid.cellSize, grid.y0 + Math.floor(c / grid.nx) * grid.cellSize) - baseM;
  const make = (f: ((x: number, y: number, z: number) => number) | null | undefined, dflt = 0): Float32Array => {
    if (f === null) return new Float32Array(0);
    const arr = new Float32Array(plane * nz);
    for (let k = 0; k < nz; k++) {
      for (let c = 0; c < plane; c++) {
        const x = grid.x0 + (c % grid.nx) * grid.cellSize;
        const y = grid.y0 + Math.floor(c / grid.nx) * grid.cellSize;
        const h0 = terrainHeight[c]!;
        const z = baseM + h0 + levels[k]! * (1 - h0 / topM);
        arr[k * plane + c] = f ? f(x, y, z) : dflt;
      }
    }
    return arr;
  };
  const kind = o.kind ?? 'prognostic';
  return {
    grid,
    nz,
    levels,
    terrainHeight,
    layout: 'terrain-following',
    kind,
    topM,
    baseM,
    time: o.time ?? 600,
    surfaceU: new Float32Array(plane),
    surfaceV: new Float32Array(plane),
    u: make(o.u),
    v: make(o.v),
    w: make(o.w),
    thetaAnomaly: kind === 'diagnosed' && o.theta === undefined ? new Float32Array(0) : make(o.theta),
    smoke: kind === 'diagnosed' && o.smoke === undefined ? new Float32Array(0) : make(o.smoke),
  };
}

/** A resolve context over a square grid of `n` x `n` nodes `cellSize` apart centred on the origin, with a plane of ground and no fire, phone or wind unless given. */
export function makeResolveContext(o: Partial<SliceResolveContext> & { n?: number; cellSize?: number } = {}): SliceResolveContext {
  const grid = o.grid ?? makeGridSpec({ lat: -33.7, lon: 150.3 }, (o.n ?? 31) * (o.cellSize ?? 200), o.cellSize ?? 200);
  return {
    grid,
    heightAt: o.heightAt ?? (() => 500),
    mapCentre: o.mapCentre ?? [0, 0],
    fire: o.fire ?? null,
    windFromDeg: o.windFromDeg === undefined ? 270 : o.windFromDeg,
    user: o.user ?? null,
  };
}
