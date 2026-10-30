/**
 * Test fixtures of the detailed streaks' builder (not imported by application code, like `glyphOracle.testing.ts`, whose cameras, rasters and
 * scenarios it builds on): a scenario whose plan is the level-4 plan with the detail flag, a reader of the output by line, and the bytes
 * of the used part of it for the determinism tests.
 */
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
