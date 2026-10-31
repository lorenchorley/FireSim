/**
 * Test fixtures of the detailed streaks' builder (not imported by application code, like `glyphOracle.testing.ts`, whose cameras, rasters and
 * scenarios it builds on): a scenario whose plan is the level-4 plan with the detail flag, a reader of the output by line, and the bytes
 * of the used part of it for the determinism tests.
 */
import type { GridSpec } from '../../core/grid';
import type { FuelMap } from '../../core/types';
import { canopyPlane, crownDiscRadius } from './detailObstacles';
import { KATOOMBA } from './detailStreaks.katoomba.testing';
import { metresPerPixelAt, planLod, visibleBox } from './glyphLod';
import { makeCamera, makeScenario, ORIGIN, type Scenario, type ScenarioOptions } from './glyphOracle.testing';
import { DETAIL_RELIEF, type CrownSet, type DetailInput, type DetailOutput, type DetailRelief, type GroundRaster } from './glyphTypes';
import { hash01 } from '../fields';

export interface DetailScenarioOptions extends ScenarioOptions {
  /** The 10 m ground the terrain terms come from (default: the scenario's own ground raster). */
  ground10?: GroundRaster;
  seed?: number;
  heightM?: number;
}

export interface DetailScenario extends Scenario {
  input: DetailInput;
}

/** A scenario at the level of the detailed streaks (`cellPx` 150 unless given: a model cell of 150 px), planned with the detail flag. */
export function makeDetailScenario(o: DetailScenarioOptions = {}): DetailScenario {
  const sc = makeScenario({ cellPx: 150, ...o });
  const mppC = metresPerPixelAt(sc.camera.distance, sc.camera.fovDeg, sc.camera.cssH);
  const plan = planLod((o.planCellM ?? sc.raster.grid.cellSize) / mppC, mppC, o.prev ?? null, undefined, true);
  if (o.plan) Object.assign(plan, o.plan, { lengthPx: { ...plan.lengthPx, ...o.plan.lengthPx } });
  const input: DetailInput = { ...sc.input, lod: plan, ground10: o.ground10 ?? sc.ground, seed: o.seed ?? 0 };
  if (o.heightM !== undefined) input.heightM = o.heightM;
  return { ...sc, plan, input };
}

/** One line of the output: the segments from the one that starts at arc length 0 to the next such, in order. */
export interface Line {
  index: number;
  seg: number;
  count: number;
  /** Seed and end in local metres. */
  seed: [number, number];
  end: [number, number];
  /** `L` (px), the life seed (0 to 1), the speed (m/s), `turb`, `lift` and the tail (px), as the first segment says them. */
  lengthPx: number;
  life: number;
  speed: number;
  turb: number;
  lift: number;
  tail: number;
}

export function linesOf(out: DetailOutput): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (let k = 1; k <= out.segments; k++) {
    if (k < out.segments && out.d[4 * k] !== 0) continue;
    const last = k - 1;
    lines.push({
      index: lines.length,
      seg: start,
      count: k - start,
      seed: [out.a[3 * start]!, -out.a[3 * start + 2]!],
      end: [out.b[3 * last]!, -out.b[3 * last + 2]!],
      lengthPx: out.d[4 * start + 2]!,
      life: out.d[4 * start + 3]!,
      speed: out.e[4 * start]!,
      turb: out.e[4 * start + 1]!,
      lift: out.e[4 * start + 2]!,
      tail: out.e[4 * start + 3]!,
    });
    start = k;
  }
  return lines;
}

/** Local (x, y) start and end of segment k. */
export function segmentXY(out: DetailOutput, k: number): [number, number, number, number] {
  return [out.a[3 * k]!, -out.a[3 * k + 2]!, out.b[3 * k]!, -out.b[3 * k + 2]!];
}

export function segmentLength(out: DetailOutput, k: number): number {
  const [x0, y0, x1, y1] = segmentXY(out, k);
  return Math.hypot(x1 - x0, y1 - y0);
}

/** The bytes of the used part of the output (all five arrays), for the determinism tests. */
export function detailBytes(out: DetailOutput): Buffer {
  const n = out.segments;
  return Buffer.concat([out.a.subarray(0, 3 * n), out.b.subarray(0, 3 * n), out.c.subarray(0, 4 * n), out.d.subarray(0, 4 * n), out.e.subarray(0, 4 * n)].map((a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength)));
}

/** A placed tree as the vegetation layer holds it: the foot (local metres and the ground's height over the datum), the tree's height and the crown's width. */
export interface PlacedTree {
  x: number;
  y: number;
  ground: number;
  height: number;
  width: number;
}

/**
 * How many of the `count` vertices (world axes, three numbers each: x east, y up, z south) lie inside `fraction` of the radius of the disc that a tree's crown
 * shows at the vertex's own height, for each of `fractions`: the crown is the builder's ellipsoid (centre at 0.7 of the height, half height 0.3 of it) and
 * a tree counts only where the builder's own rules would count it (it stands `clearM` over the vertex, and the disc is at least `minRadiusM` across the radius).
 * A line that parts round the crowns has none inside 0.8 radii (a seed may stand between 0.8 and 0.85); the e2e spec reads a real picture with it.
 */
export function crownIncursions(vertices: ArrayLike<number>, count: number, trees: readonly PlacedTree[], fractions: readonly number[], clearM = 1.5, minRadiusM = 0.5): number[] {
  const inside = fractions.map(() => 0);
  for (let i = 0; i < count; i++) {
    const x = vertices[3 * i]!;
    const y = -vertices[3 * i + 2]!;
    const wy = vertices[3 * i + 1]!;
    for (const t of trees) {
      const zv = wy - t.ground;
      if (!(t.height - zv >= clearM)) continue;
      const r = crownDiscRadius(t.height, t.width, zv, 0.7, 0.3);
      if (!(r >= minRadiusM)) continue;
      const d2 = (x - t.x) * (x - t.x) + (y - t.y) * (y - t.y);
      for (let f = 0; f < fractions.length; f++) {
        const rf = fractions[f]! * r;
        if (d2 < rf * rf) inside[f]!++;
      }
    }
  }
  return inside;
}

const int16 = (b64: string): Int16Array => {
  const buf = Buffer.from(b64, 'base64');
  return new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
};

/**
 * The builder's input for a camera `d` metres from the point the Katoomba scene (`detailStreaks.katoomba.testing.ts`) is cut out around, `tiltDeg` degrees
 * from the vertical, looking north-north-east (the verifier's views of the real app: 412 x 891 px, a field of view of 50 degrees, the air view's cell 53.3 m),
 * made as the layer makes it: the camera's near plane a quarter of its height over the ground it stands on, the box of the ground in view, the lattice
 * planned for the metres a pixel covers at the strokes' own height, and the plane's cap (`eyeShare` of the eye's height) given as `planeCapM`.
 * `relief` is what the builder is given (the tuned constants by default; `null` is the 0.6.0 picture, strokes at the ground and a lattice planned for it).
 * No crown is placed unless `trees` is set: then a stand of them (`katoombaTrees`) grows over the whole crop, as tall as the canopy, so that the lines have crowns to go round.
 */
export function katoombaScene(d: number, tiltDeg: number, relief: DetailRelief | null = DETAIL_RELIEF, trees = false): DetailInput {
  const { ground: G, canopy: C, wind: W } = KATOOMBA;
  const grid = (nx: number, x0: number, y0: number, cell: number): GridSpec => ({ nx, ny: nx, cellSize: cell, x0, y0, origin: ORIGIN });
  const dm = int16(G.dm);
  const elevation = Float32Array.from(dm, (v) => G.min + v / 10);
  const gGrid = grid(G.n, G.x0, G.y0, G.cell);
  const ground: GroundRaster = { grid: gGrid, elevation, minElevation: G.min };
  const heightAt = (x: number, y: number): number => {
    const fx = (x - G.x0) / G.cell;
    const fy = (y - G.y0) / G.cell;
    const i = Math.min(G.n - 2, Math.max(0, Math.floor(fx)));
    const j = Math.min(G.n - 2, Math.max(0, Math.floor(fy)));
    const tx = Math.min(1, Math.max(0, fx - i));
    const ty = Math.min(1, Math.max(0, fy - j));
    const e = (a: number, b: number): number => elevation[(j + b) * G.n + i + a]!;
    return (e(0, 0) * (1 - tx) + e(1, 0) * tx) * (1 - ty) + (e(0, 1) * (1 - tx) + e(1, 1) * tx) * ty;
  };
  const field = { grid: grid(W.n, W.x0, W.y0, W.cell), u: Float32Array.from(int16(W.u), (v) => v / 100), v: Float32Array.from(int16(W.v), (v) => v / 100) };
  const cGrid = grid(C.n, C.x0, C.y0, C.cell);
  const canopy = { grid: cGrid, canopyHeight: Float32Array.from(int16(C.dm), (v) => v / 10), canopyCover: new Float32Array(C.n * C.n).fill(1) } as unknown as FuelMap;
  const tiltR = (tiltDeg * Math.PI) / 180;
  const az = (200 * Math.PI) / 180;
  const targetY = heightAt(0, 0);
  const eye: [number, number, number] = [d * Math.sin(tiltR) * Math.sin(az), targetY + d * Math.cos(tiltR), -d * Math.sin(tiltR) * Math.cos(az)];
  const agl = eye[1] - heightAt(eye[0], -eye[2]);
  const camera = makeCamera({ eye, target: [0, targetY, 0], cssW: 412, cssH: 891, near: Math.min(60, Math.max(0.3, 0.25 * agl)) });
  const f = field.grid;
  const bounds = { x0: f.x0, y0: f.y0, x1: f.x0 + (f.nx - 1) * f.cellSize, y1: f.y0 + (f.ny - 1) * f.cellSize };
  const box = visibleBox(camera.unproject, camera.eye, G.min, bounds, Math.max(3000, 6 * d), 0.25);
  if (!box) throw new Error('the camera sees no ground');
  const mpp = metresPerPixelAt(camera.distance, camera.fovDeg, camera.cssH);
  const eyeHeight = d * Math.cos(tiltR);
  const cap = relief ? relief.canopy.eyeShare * eyeHeight : 0;
  const ratio = relief ? Math.min(1, Math.max(0.25, 1 - canopyPlane(canopy, 0, 0, relief.canopy, cap) / eyeHeight)) : 1;
  const input: DetailInput = {
    field,
    ground,
    vex: 1,
    lod: planLod(160 / 3 / (mpp * ratio), mpp * ratio, null, undefined, true),
    eye: camera.eye,
    viewProj: camera.viewProj,
    cssW: camera.cssW,
    cssH: camera.cssH,
    pxPerMetre1: camera.pxPerMetre1,
    near: camera.near,
    box,
    cap: { glyphs: 2000, segments: 12000 },
    now: () => 0,
    ground10: ground,
    seed: 0,
    heightM: 10,
  };
  if (relief) {
    input.relief = relief;
    input.canopy = canopy;
    if (cap > 0) input.planeCapM = cap;
    if (trees) input.crowns = [katoombaTrees(G.x0, G.y0, G.cell * (G.n - 1), heightAt, canopy)];
  }
  return input;
}

/**
 * A stand of trees over a square of the Katoomba crop (`x0`, `y0`, `size` m): a lattice of 8 m moved by up to 3 m a tree (a hash of its place), as tall as the canopy
 * at its foot (1.15 x, 0.85 to 1.15 of that, at least 14 m) and 6 to 12 m of crown: some 7,000 of them over the crop, in no pattern, standing on the real ground.
 */
export function katoombaTrees(x0: number, y0: number, size: number, heightAt: (x: number, y: number) => number, canopy: FuelMap): CrownSet {
  const step = 8;
  const n = Math.floor(size / step);
  const position = new Float32Array(3 * n * n);
  const sizes = new Float32Array(2 * n * n);
  const g = canopy.grid;
  let count = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = x0 + (i + 0.5) * step + (hash01(i, j, 71) - 0.5) * 6;
      const y = y0 + (j + 0.5) * step + (hash01(i, j, 72) - 0.5) * 6;
      const ci = Math.min(g.nx - 1, Math.max(0, Math.round((x - g.x0) / g.cellSize)));
      const cj = Math.min(g.ny - 1, Math.max(0, Math.round((y - g.y0) / g.cellSize)));
      const ch = canopy.canopyHeight[cj * g.nx + ci]!;
      const h = Math.max(14, 1.15 * ch * (0.85 + 0.3 * hash01(i, j, 73)));
      position.set([x, y, heightAt(x, y)], 3 * count);
      sizes.set([h, 6 + 6 * hash01(i, j, 74)], 2 * count);
      count++;
    }
  }
  return { group: 0, count, position, size: sizes };
}

/**
 * How sharply the lines of a picture turn (the look verifier's measure of a corner, from the vertices of the builder's own output): the share (percent) of lines
 * (of two segments or more) that have at least one vertex where the heading, in plan, turns by more than each of `anglesDeg` between one segment and the next;
 * the worst single turn (degrees); and the share of lines that double back (`backShare`: a heading more than `backDeg` from the line's first one at some vertex,
 * a hairpin or a loop; the wind itself turns a long line a few tens of degrees at most).
 */
export function cornerShares(out: DetailOutput, anglesDeg: readonly number[], backDeg = 100): { lines: number; over: number[]; worstDeg: number; backShare: number } {
  const over = anglesDeg.map(() => 0);
  let lines = 0;
  let back = 0;
  let worst = 0;
  const cosBack = Math.cos((backDeg * Math.PI) / 180);
  let start = 0;
  for (let k = 1; k <= out.segments; k++) {
    if (k < out.segments && out.d[4 * k] !== 0) continue;
    if (k - start >= 2) {
      lines++;
      let maxTurn = 0;
      let doubled = false;
      let fx = 0;
      let fz = 0;
      let px = 0;
      let pz = 0;
      for (let s = start; s < k; s++) {
        let hx = out.b[3 * s]! - out.a[3 * s]!;
        let hz = out.b[3 * s + 2]! - out.a[3 * s + 2]!;
        const hl = Math.sqrt(hx * hx + hz * hz);
        if (!(hl > 1e-6)) continue;
        hx /= hl;
        hz /= hl;
        if (s === start) {
          fx = hx;
          fz = hz;
        } else {
          const c = Math.max(-1, Math.min(1, px * hx + pz * hz));
          const turn = (Math.acos(c) * 180) / Math.PI;
          if (turn > maxTurn) maxTurn = turn;
          if (fx * hx + fz * hz < cosBack) doubled = true;
        }
        px = hx;
        pz = hz;
      }
      for (let a = 0; a < anglesDeg.length; a++) if (maxTurn > anglesDeg[a]!) over[a]!++;
      if (maxTurn > worst) worst = maxTurn;
      if (doubled) back++;
    }
    start = k;
  }
  return { lines, over: over.map((n) => (lines > 0 ? (100 * n) / lines : 0)), worstDeg: worst, backShare: lines > 0 ? (100 * back) / lines : 0 };
}

/** Where the segments of a picture are on the screen: the share (percent) of those on it in the top tenth of its height and in the bottom three tenths, and how many are on it. */
export function screenShares(out: DetailOutput, viewProj: ArrayLike<number>): { top: number; bottom: number; on: number } {
  const v = viewProj;
  let on = 0;
  let top = 0;
  let bottom = 0;
  for (let k = 0; k < out.segments; k++) {
    const mx = 0.5 * (out.a[3 * k]! + out.b[3 * k]!);
    const my = 0.5 * (out.a[3 * k + 1]! + out.b[3 * k + 1]!);
    const mz = 0.5 * (out.a[3 * k + 2]! + out.b[3 * k + 2]!);
    const w = v[3]! * mx + v[7]! * my + v[11]! * mz + v[15]!;
    if (!(w > 0)) continue;
    const sx = (v[0]! * mx + v[4]! * my + v[8]! * mz + v[12]!) / w;
    const sy = (v[1]! * mx + v[5]! * my + v[9]! * mz + v[13]!) / w;
    if (Math.abs(sx) > 1 || Math.abs(sy) > 1) continue;
    on++;
    const row = (1 - sy) / 2;
    if (row < 0.1) top++;
    if (row >= 0.7) bottom++;
  }
  return { top: on > 0 ? (100 * top) / on : 0, bottom: on > 0 ? (100 * bottom) / on : 0, on };
}
