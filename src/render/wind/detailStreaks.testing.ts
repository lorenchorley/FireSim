/**
 * Test fixtures of the detailed streaks' builder (not imported by application code, like `glyphOracle.testing.ts`, whose cameras, rasters and
 * scenarios it builds on): a scenario whose plan is the level-4 plan with the detail flag, a reader of the output by line, and the bytes
 * of the used part of it for the determinism tests.
 */
import { crownDiscRadius } from './detailObstacles';
import { metresPerPixelAt, planLod } from './glyphLod';
import { makeScenario, type Scenario, type ScenarioOptions } from './glyphOracle.testing';
import type { DetailInput, DetailOutput, GroundRaster } from './glyphTypes';

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
