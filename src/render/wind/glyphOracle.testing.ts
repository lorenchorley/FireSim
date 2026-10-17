/**
 * Test fixtures and the oracle of the wind glyph engine (not imported by application code, like `slice/testing.ts`): a pure
 * camera (the projection x view matrix, its inverse and the orientation, as THREE builds them), builder inputs over analytic
 * fields, a reader of the builder's output, the lattice seed written the plain way from `hash01` of render/fields.ts, and the
 * direct tracer through `AtmosphereSampler.windP` that the raster design is measured against (spike S3's `v2p`).
 */
import { makeGridSpec, type GridSpec } from '../../core/grid';
import { hash01 } from '../fields';
import type { AtmosphereSampler } from '../atmosphereSampler';
import { GLYPH_CALM_MS } from './flowGlyphs';
import { metresPerPixelAt, planLod, visibleBox } from './glyphLod';
import type { Box, FlowRaster, GlyphInput, GroundRaster, LodPlan } from './glyphTypes';
import type { GlyphOutputDetail } from './flowGlyphs';

// ───────────────────────── camera ─────────────────────────

export interface CameraOptions {
  eye: [number, number, number];
  target: [number, number, number];
  fovDeg?: number;
  cssW?: number;
  cssH?: number;
  near?: number;
  far?: number;
}

export interface Camera {
  eye: [number, number, number];
  target: [number, number, number];
  fovDeg: number;
  cssW: number;
  cssH: number;
  near: number;
  far: number;
  /** projection x view, column-major (what `GlyphInput.viewProj` holds). */
  viewProj: Float64Array;
  /** `matrixWorld x projectionMatrixInverse`, column-major (what `visibleBox` takes). */
  unproject: Float64Array;
  /** Orientation x, y, z, w. */
  quat: [number, number, number, number];
  distance: number;
  pxPerMetre1: number;
}

const sub = (a: readonly number[], b: readonly number[]): number[] => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const dot = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const cross = (a: readonly number[], b: readonly number[]): number[] => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
const unit = (a: readonly number[]): number[] => {
  const l = Math.hypot(a[0]!, a[1]!, a[2]!);
  return [a[0]! / l, a[1]! / l, a[2]! / l];
};

/** Column-major product a x b. */
export function mat4Multiply(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r]! * b[c * 4]! + a[4 + r]! * b[c * 4 + 1]! + a[8 + r]! * b[c * 4 + 2]! + a[12 + r]! * b[c * 4 + 3]!;
  return o;
}

/** Inverse of a column-major 4 x 4 (Gauss-Jordan with partial pivoting). */
export function mat4Invert(m: ArrayLike<number>): Float64Array {
  const a: number[][] = [];
  for (let r = 0; r < 4; r++) a.push([m[r]!, m[4 + r]!, m[8 + r]!, m[12 + r]!, r === 0 ? 1 : 0, r === 1 ? 1 : 0, r === 2 ? 1 : 0, r === 3 ? 1 : 0]);
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(a[r]![c]!) > Math.abs(a[p]![c]!)) p = r;
    [a[c], a[p]] = [a[p]!, a[c]!];
    const d = a[c]![c]!;
    for (let k = 0; k < 8; k++) a[c]![k] = a[c]![k]! / d;
    for (let r = 0; r < 4; r++) {
      if (r === c) continue;
      const q = a[r]![c]!;
      for (let k = 0; k < 8; k++) a[r]![k] = a[r]![k]! - q * a[c]![k]!;
    }
  }
  const o = new Float64Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) o[c * 4 + r] = a[r]![4 + c]!;
  return o;
}

/** A perspective camera as THREE's `PerspectiveCamera.lookAt` builds it (the world has x east, y up, z south). */
export function makeCamera(o: CameraOptions): Camera {
  const fovDeg = o.fovDeg ?? 50;
  const cssW = o.cssW ?? 412;
  const cssH = o.cssH ?? 868;
  const near = o.near ?? 5;
  const far = o.far ?? 60000;
  const zAxis = unit(sub(o.eye, o.target));
  let up = [0, 1, 0];
  if (Math.abs(dot(zAxis, up)) > 0.9999) up = [0, 0, -1];
  const xAxis = unit(cross(up, zAxis));
  const yAxis = cross(zAxis, xAxis);
  const view = new Float64Array([
    xAxis[0]!, yAxis[0]!, zAxis[0]!, 0,
    xAxis[1]!, yAxis[1]!, zAxis[1]!, 0,
    xAxis[2]!, yAxis[2]!, zAxis[2]!, 0,
    -dot(xAxis, o.eye), -dot(yAxis, o.eye), -dot(zAxis, o.eye), 1,
  ]);
  const f = 1 / Math.tan((fovDeg * Math.PI) / 360);
  const proj = new Float64Array(16);
  proj[0] = f / (cssW / cssH);
  proj[5] = f;
  proj[10] = (far + near) / (near - far);
  proj[11] = -1;
  proj[14] = (2 * far * near) / (near - far);
  const viewProj = mat4Multiply(proj, view);
  const m00 = xAxis[0]!, m01 = yAxis[0]!, m02 = zAxis[0]!;
  const m10 = xAxis[1]!, m11 = yAxis[1]!, m12 = zAxis[1]!;
  const m20 = xAxis[2]!, m21 = yAxis[2]!, m22 = zAxis[2]!;
  const tr = m00 + m11 + m22;
  let q: [number, number, number, number];
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    q = [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  return {
    eye: [...o.eye],
    target: [...o.target],
    fovDeg,
    cssW,
    cssH,
    near,
    far,
    viewProj,
    unproject: mat4Invert(viewProj),
    quat: q,
    distance: Math.hypot(...(sub(o.eye, o.target) as [number, number, number])),
    pxPerMetre1: cssH / (2 * Math.tan((fovDeg * Math.PI) / 360)),
  };
}

/** A camera straight above local point (cx, cy), `d` metres above world height `baseY`, with `d` such that one model cell is `cellPx` pixels wide. */
export function topDownCamera(cellM: number, cellPx: number, cx = 0, cy = 0, o: Partial<CameraOptions> = {}, baseY = 0): Camera {
  const fovDeg = o.fovDeg ?? 50;
  const cssH = o.cssH ?? 868;
  const mpp = cellM / cellPx;
  const d = mpp * (cssH / (2 * Math.tan((fovDeg * Math.PI) / 360)));
  return makeCamera({ eye: [cx, baseY + d, -cy], target: [cx, baseY, -cy], ...o });
}

// ───────────────────────── rasters and inputs ─────────────────────────

export const ORIGIN = { lat: -33.7, lon: 150.3 };

/** A raster of a field of local (x, y), at the grid's nodes. */
export function rasterOf(grid: GridSpec, fn: (x: number, y: number) => readonly [number, number]): FlowRaster {
  const u = new Float32Array(grid.nx * grid.ny);
  const v = new Float32Array(grid.nx * grid.ny);
  for (let j = 0; j < grid.ny; j++) {
    for (let i = 0; i < grid.nx; i++) {
      const [a, b] = fn(grid.x0 + i * grid.cellSize, grid.y0 + j * grid.cellSize);
      u[j * grid.nx + i] = a;
      v[j * grid.nx + i] = b;
    }
  }
  return { grid, u, v };
}

/** The ground as a raster of a function of local (x, y) (metres ASL). */
export function groundOf(grid: GridSpec, fn: (x: number, y: number) => number): GroundRaster {
  const elevation = new Float32Array(grid.nx * grid.ny);
  for (let j = 0; j < grid.ny; j++) for (let i = 0; i < grid.nx; i++) elevation[j * grid.nx + i] = fn(grid.x0 + i * grid.cellSize, grid.y0 + j * grid.cellSize);
  return { grid, elevation };
}

export interface ScenarioOptions {
  /** Columns a side and cell size of the wind raster (default 45 x 133 m, the standard tier). */
  n?: number;
  cell?: number;
  field?: (x: number, y: number) => readonly [number, number];
  /** A ready raster instead of `field`. */
  raster?: FlowRaster;
  /** The ground (m ASL, default flat at 0, which is world height 0 when `vex` is 1). */
  ground?: (x: number, y: number) => number;
  /** A ready ground raster instead of `ground`. */
  groundRaster?: GroundRaster;
  /** Ground raster spacing (default 40 m, finer than the wind). */
  groundCell?: number;
  /** Model cell size on screen (default 60 px: L3). */
  cellPx?: number;
  /** The model's cell in metres for the plan when `raster` is a refined one (default: the raster's own cell). */
  planCellM?: number;
  camera?: Camera;
  /** Plan override fields (for the length rules etc). */
  plan?: Partial<LodPlan>;
  cap?: { glyphs: number; segments: number };
  vex?: number;
  /** Looked-at point (local metres); with `camera` unset. */
  centre?: [number, number];
  /** Metres from the camera the visible box reaches at the horizon. */
  maxRangeM?: number;
  boxMargin?: number;
  now?: () => number;
  /** The previous plan, for the hysteresis. */
  prev?: LodPlan | null;
}

export interface Scenario {
  input: GlyphInput;
  camera: Camera;
  raster: FlowRaster;
  ground: GroundRaster;
  plan: LodPlan;
  grid: GridSpec;
}

/** A complete builder input over an analytic field and ground, seen from above (or from `camera`). */
export function makeScenario(o: ScenarioOptions = {}): Scenario {
  const n = o.n ?? 45;
  const cell = o.cell ?? 133;
  const grid = makeGridSpec(ORIGIN, n * cell, cell);
  const raster = o.raster ?? rasterOf(grid, o.field ?? (() => [6, 8]));
  const gc = o.groundCell ?? 40;
  const gg: GridSpec = { nx: Math.ceil(((grid.nx - 1) * cell) / gc) + 1, ny: Math.ceil(((grid.ny - 1) * cell) / gc) + 1, cellSize: gc, x0: grid.x0, y0: grid.y0, origin: ORIGIN };
  const ground = o.groundRaster ?? groundOf(gg, o.ground ?? (() => 0));
  const cellPx = o.cellPx ?? 60;
  const [cx, cy] = o.centre ?? [0, 0];
  const camera = o.camera ?? topDownCamera(raster.grid.cellSize, cellPx, cx, cy);
  const mppC = metresPerPixelAt(camera.distance, camera.fovDeg, camera.cssH);
  const plan = planLod((o.planCellM ?? raster.grid.cellSize) / mppC, mppC, o.prev ?? null);
  if (o.plan) Object.assign(plan, o.plan, { lengthPx: { ...plan.lengthPx, ...o.plan.lengthPx } });
  const g = raster.grid;
  const bounds: Box = { x0: g.x0, y0: g.y0, x1: g.x0 + (g.nx - 1) * g.cellSize, y1: g.y0 + (g.ny - 1) * g.cellSize };
  let low = Infinity;
  for (let k = 0; k < ground.elevation.length; k++) low = Math.min(low, ground.elevation[k]!);
  const vex = o.vex ?? 1;
  const box = visibleBox(camera.unproject, camera.eye, low * vex, bounds, o.maxRangeM ?? 20000, o.boxMargin ?? 0.25) ?? { x0: 0, y0: 0, x1: -1, y1: -1 };
  const input: GlyphInput = {
    field: raster,
    ground,
    vex,
    lod: plan,
    eye: camera.eye,
    viewProj: camera.viewProj,
    cssW: camera.cssW,
    cssH: camera.cssH,
    pxPerMetre1: camera.pxPerMetre1,
    near: camera.near,
    box,
    cap: o.cap ?? { glyphs: 2000, segments: 12000 },
    now: o.now ?? (() => 0),
  };
  return { input, camera, raster, ground, plan, grid };
}

/** A clock that advances `stepMs` on every read (0: never). */
export function counterClock(stepMs = 0): { now: () => number; reads: () => number } {
  let t = 0;
  let reads = 0;
  return {
    now: () => {
      reads++;
      return (t += stepMs);
    },
    reads: () => reads,
  };
}

// ───────────────────────── reading the output ─────────────────────────

export interface Glyph {
  index: number;
  /** First segment and the number of segments (dot 1, else shaft + 2). */
  seg: number;
  count: number;
  dot: boolean;
  shaft: number;
  /** Seed and tip in local metres. */
  seed: [number, number];
  tip: [number, number];
  /** Drawn height (world y) of the seed vertex. */
  yWorld: number;
}

export function glyphsOf(out: GlyphOutputDetail): Glyph[] {
  const gs: Glyph[] = [];
  for (let g = 0; g < out.glyphs; g++) {
    const seg = out.starts[g]!;
    const count = out.starts[g + 1]! - seg;
    const dot = count === 1;
    const shaft = dot ? 0 : count - 2;
    const lastShaft = dot ? seg : seg + shaft - 1;
    gs.push({
      index: g,
      seg,
      count,
      dot,
      shaft,
      seed: [out.a[3 * seg]!, -out.a[3 * seg + 2]!],
      tip: [out.b[3 * lastShaft]!, -out.b[3 * lastShaft + 2]!],
      yWorld: out.a[3 * seg + 1]!,
    });
  }
  return gs;
}

/** Local (x, y) start and end of segment k. */
export function segmentXY(out: GlyphOutputDetail, k: number): [number, number, number, number] {
  return [out.a[3 * k]!, -out.a[3 * k + 2]!, out.b[3 * k]!, -out.b[3 * k + 2]!];
}

export function segmentLength(out: GlyphOutputDetail, k: number): number {
  const [x0, y0, x1, y1] = segmentXY(out, k);
  return Math.hypot(x1 - x0, y1 - y0);
}

/** Clip depth of a world point under a column-major projection x view. */
export const clipW = (vp: ArrayLike<number>, x: number, y: number, z: number): number => vp[3]! * x + vp[7]! * y + vp[11]! * z + vp[15]!;

/** Runs a whole build with a budget that never runs out. Returns the number of `step` calls. */
export function buildAll(b: { begin(i: GlyphInput): void; step(ms: number): boolean }, input: GlyphInput, budgetMs = 1e9): number {
  b.begin(input);
  let steps = 0;
  while (steps < 100000) {
    steps++;
    if (b.step(budgetMs)) break;
  }
  return steps;
}

/** The bytes of the used part of the output (positions and colours), for the determinism tests. */
export function outputBytes(out: GlyphOutputDetail): Buffer {
  const n = out.segments;
  return Buffer.concat([out.a.subarray(0, 3 * n), out.b.subarray(0, 3 * n), out.c.subarray(0, 4 * n)].map((a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength)));
}

// ───────────────────────── the lattice, the plain way ─────────────────────────

/** Seed of lattice cell (i, j) at spacing 2^k m, as the design writes it: the cell centre moved by `jitter` of the cell with `hash01`. The salts are the builder's. */
export function latticeSeed(i: number, j: number, k: number, jitter: number): [number, number] {
  const S = 2 ** k;
  if (jitter <= 0) return [(i + 0.5) * S, (j + 0.5) * S];
  const salt = 32 + 2 * (Math.max(-16, Math.min(48, k)) + 16);
  return [(i + 0.5 + jitter * (hash01(i, j, salt) - 0.5) * 2) * S, (j + 0.5 + jitter * (hash01(i, j, salt + 1) - 0.5) * 2) * S];
}

// ───────────────────────── direct tracing (the oracle) ─────────────────────────

/**
 * The glyph's shaft traced through the 3-D air directly: every step asks `windP` at (x, y, ground(x, y) + h), where the builder
 * reads the raster of those same values. Same rules (RK2 midpoint on the unit direction, steps of `ds`, stop under the calm
 * speed or at the domain edge), so the difference between the two tips is the raster's error.
 */
export class DirectOracle {
  private readonly pos = new Float64Array(4);
  private readonly w = new Float32Array(3);
  constructor(
    private readonly sampler: AtmosphereSampler,
    private readonly ground: GroundRaster,
    /** Metres above the ground, or 'surface' for the model's 10 m wind (`surfaceWind`). */
    private readonly heightM: number | 'surface',
    private readonly dom: Box,
  ) {}

  private groundAt(x: number, y: number): number {
    const g = this.ground.grid;
    const e = this.ground.elevation;
    let fx = (x - g.x0) / g.cellSize;
    let fy = (y - g.y0) / g.cellSize;
    fx = Math.max(0, Math.min(g.nx - 1, fx));
    fy = Math.max(0, Math.min(g.ny - 1, fy));
    let i0 = Math.floor(fx);
    let j0 = Math.floor(fy);
    if (i0 >= g.nx - 1) i0 = g.nx - 2;
    if (j0 >= g.ny - 1) j0 = g.ny - 2;
    const tx = fx - i0;
    const ty = fy - j0;
    const k = j0 * g.nx + i0;
    return (e[k]! * (1 - tx) + e[k + 1]! * tx) * (1 - ty) + (e[k + g.nx]! * (1 - tx) + e[k + g.nx + 1]! * tx) * ty;
  }

  /** u, v of the air `heightM` above the ground at (x, y). */
  wind(x: number, y: number): [number, number] {
    if (this.heightM === 'surface') {
      this.sampler.surfaceWind(x, y, this.w);
      return [this.w[0]!, this.w[1]!];
    }
    this.pos[0] = x;
    this.pos[1] = y;
    this.pos[2] = this.groundAt(x, y) + this.heightM;
    this.pos[3] = this.heightM;
    this.sampler.windP(this.pos, this.w);
    return [this.w[0]!, this.w[1]!];
  }

  /** Tip of a shaft of `steps` steps of `ds` metres from (x, y), and how many steps were made. */
  trace(x: number, y: number, ds: number, steps: number): { x: number; y: number; made: number } {
    let made = 0;
    for (let k = 0; k < steps; k++) {
      const [u, v] = this.wind(x, y);
      const sp = Math.hypot(u, v);
      if (!(sp >= GLYPH_CALM_MS)) break;
      const [u2, v2] = this.wind(x + (u / sp) * 0.5 * ds, y + (v / sp) * 0.5 * ds);
      const sp2 = Math.hypot(u2, v2);
      if (!(sp2 >= GLYPH_CALM_MS)) break;
      const qx = x + (u2 / sp2) * ds;
      const qy = y + (v2 / sp2) * ds;
      if (qx < this.dom.x0 || qx > this.dom.x1 || qy < this.dom.y0 || qy > this.dom.y1) break;
      x = qx;
      y = qy;
      made++;
    }
    return { x, y, made };
  }
}

/** Bilinear lookup of a raster at (x, y), clamped at the edge: an independent copy of the tracer's, for the exactness tests. */
export function bilinear(r: FlowRaster, x: number, y: number): [number, number] {
  const g = r.grid;
  let fx = (x - g.x0) / g.cellSize;
  let fy = (y - g.y0) / g.cellSize;
  fx = Math.max(0, Math.min(g.nx - 1, fx));
  fy = Math.max(0, Math.min(g.ny - 1, fy));
  const i0 = Math.min(Math.floor(fx), g.nx - 2);
  const j0 = Math.min(Math.floor(fy), g.ny - 2);
  const tx = fx - i0;
  const ty = fy - j0;
  const k = j0 * g.nx + i0;
  const at = (f: Float32Array): number => (f[k]! * (1 - tx) + f[k + 1]! * tx) * (1 - ty) + (f[k + g.nx]! * (1 - tx) + f[k + g.nx + 1]! * tx) * ty;
  return [at(r.u), at(r.v)];
}
