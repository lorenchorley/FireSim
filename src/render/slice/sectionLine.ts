/**
 * The line of an air slice (pure; plan 8.2 and 8.3): a hand-placed A to B clipped to the model rectangle, the four preset lines
 * resolved from live data (the wind at the shown time, the fire, the ground, the phone), and the one function that turns a
 * `SliceLineState` into the line to sample. Nothing here throws: a line that cannot be made is `line: null` with an issue code
 * (the words belong to whoever shows it). The conventions are in types.ts.
 */
import type { GridSpec } from '../../core/grid';
import { azimuthToUnit, DEG } from '../../core/units';
import { sectionLine, type SectionLine } from '../atmosphereSampler';
import {
  SLICE_MIN_LENGTH_CELLS,
  SLICE_MIN_LENGTH_M,
  SLICE_PRESET_HALF_LENGTH_M,
  type ResolvedSlice,
  type SectionResult,
  type SliceIssue,
  type SliceLineState,
  type SliceNote,
  type SlicePoint,
  type SlicePresetId,
  type SlicePresetStatus,
  type SliceResolveContext,
} from './types';

/** Ground flatter than this (degrees) has no up-slope direction worth a line (the plan says about 2). */
const FLAT_GROUND_DEG = 2;
/** An end that moved by less than this (m) was not clipped: it only touched the edge. */
const CLIP_TOLERANCE_M = 1e-3;

interface Rect {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/** The model rectangle: the extent of the grid's nodes (cell centres). */
function rectOf(grid: GridSpec): Rect {
  return { xMin: grid.x0, xMax: grid.x0 + (grid.nx - 1) * grid.cellSize, yMin: grid.y0, yMax: grid.y0 + (grid.ny - 1) * grid.cellSize };
}

/** The shortest line allowed in this model (m): 300 m or two model cells, whichever is longer. */
function minLengthOf(grid: GridSpec): number {
  return Math.max(SLICE_MIN_LENGTH_M, SLICE_MIN_LENGTH_CELLS * grid.cellSize);
}

const finite = (p: readonly number[]): boolean => p.every((v) => Number.isFinite(v));
const insideRect = (r: Rect, p: SlicePoint): boolean => p[0] >= r.xMin && p[0] <= r.xMax && p[1] >= r.yMin && p[1] <= r.yMax;
const clampTo = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * Clip the segment A to B to the model rectangle (the node extent of `grid`), keep the A to B order, and check the minimum
 * length `max(SLICE_MIN_LENGTH_M, SLICE_MIN_LENGTH_CELLS x cellSize)` of the CLIPPED line. A line that misses the rectangle is
 * 'outside-model'; one that is shorter than the minimum after clipping is 'too-short'. Swapping `a` and `b` gives the same line
 * reversed. An end that is not moved keeps its exact coordinates.
 */
export function sectionFromEndpoints(a: SlicePoint, b: SlicePoint, grid: GridSpec): SectionResult {
  const minLengthM = minLengthOf(grid);
  const fail = (issue: 'too-short' | 'outside-model', clipped: boolean): SectionResult => ({ line: null, issue, clipped, minLengthM });
  if (!finite(a) || !finite(b)) return fail('outside-model', false);
  const r = rectOf(grid);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  // Liang-Barsky: the part of the segment, as fractions t0 to t1 of its length, that satisfies p x t <= q for each edge.
  let t0 = 0;
  let t1 = 1;
  const edge = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0; // parallel to this edge: inside or out for the whole segment
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  if (!(edge(-dx, a[0] - r.xMin) && edge(dx, r.xMax - a[0]) && edge(-dy, a[1] - r.yMin) && edge(dy, r.yMax - a[1]))) return fail('outside-model', false);
  const clipped = t0 * len > CLIP_TOLERANCE_M || (1 - t1) * len > CLIP_TOLERANCE_M;
  const ax = t0 > 0 ? clampTo(a[0] + t0 * dx, r.xMin, r.xMax) : a[0];
  const ay = t0 > 0 ? clampTo(a[1] + t0 * dy, r.yMin, r.yMax) : a[1];
  const bx = t1 < 1 ? clampTo(a[0] + t1 * dx, r.xMin, r.xMax) : b[0];
  const by = t1 < 1 ? clampTo(a[1] + t1 * dy, r.yMin, r.yMax) : b[1];
  const length = Math.hypot(bx - ax, by - ay);
  if (length + 1e-6 < minLengthM) return fail('too-short', clipped);
  const line: SectionLine = { a: [ax, ay], b: [bx, by], dir: [(bx - ax) / length, (by - ay) / length], length };
  return { line, issue: null, clipped, minLengthM };
}

/**
 * The direction the ground rises towards around `c`, as a unit vector (east, north), from the gradient of the DEM over about a
 * third of a preset line (a 3 x 3 stencil with Sobel weights, so a 10 m crag does not decide it); null when the ground is
 * flatter than about 2 degrees.
 */
function upSlope(heightAt: (x: number, y: number) => number, c: SlicePoint): SlicePoint | null {
  const d = SLICE_PRESET_HALF_LENGTH_M / 3;
  const h = (i: number, j: number): number => heightAt(c[0] + i * d, c[1] + j * d);
  const gx = (h(1, -1) - h(-1, -1) + 2 * (h(1, 0) - h(-1, 0)) + (h(1, 1) - h(-1, 1))) / (8 * d);
  const gy = (h(-1, 1) - h(-1, -1) + 2 * (h(0, 1) - h(0, -1)) + (h(1, 1) - h(1, -1))) / (8 * d);
  const g = Math.hypot(gx, gy);
  if (!Number.isFinite(g) || g < Math.tan(FLAT_GROUND_DEG * DEG)) return null;
  return [gx / g, gy / g];
}

type PresetLine = { a: SlicePoint; b: SlicePoint; centredOnMap: boolean } | { issue: SliceIssue };

/** The two ends of a preset line before clipping, or the issue that stops it. */
function presetEnds(preset: SlicePresetId, ctx: SliceResolveContext): PresetLine {
  if (preset === 'me') {
    const user = ctx.user;
    if (!user || !finite(user) || !insideRect(rectOf(ctx.grid), user)) return { issue: 'no-user' };
    if (!ctx.fire || !finite(ctx.fire)) return { issue: 'no-fire' };
    return { a: [user[0], user[1]], b: [ctx.fire[0], ctx.fire[1]], centredOnMap: false };
  }
  const onFire = !!ctx.fire && finite(ctx.fire);
  const c: SlicePoint = onFire ? ctx.fire! : ctx.mapCentre;
  if (!finite(c)) return { issue: 'outside-model' };
  let dir: SlicePoint | null;
  if (preset === 'slope') dir = upSlope(ctx.heightAt, c);
  else {
    const from = ctx.windFromDeg;
    if (from === null || !Number.isFinite(from)) return { issue: 'calm' };
    // The wind blows TOWARDS from + 180. 'along' runs with it (A upwind, B downwind); 'across' is turned 90 degrees to the left
    // of that, so the wind blows towards the right of someone walking A to B and `across` is positive.
    dir = azimuthToUnit(preset === 'along' ? from + 180 : from + 90);
  }
  if (!dir) return { issue: 'flat-ground' };
  const h = SLICE_PRESET_HALF_LENGTH_M;
  return { a: [c[0] - dir[0] * h, c[1] - dir[1] * h], b: [c[0] + dir[0] * h, c[1] + dir[1] * h], centredOnMap: !onFire };
}

function resolvePreset(preset: SlicePresetId, ctx: SliceResolveContext): ResolvedSlice {
  const minLengthM = minLengthOf(ctx.grid);
  const ends = presetEnds(preset, ctx);
  if ('issue' in ends) return { line: null, source: 'preset', preset, issue: ends.issue, notes: [], minLengthM };
  const r = sectionFromEndpoints(ends.a, ends.b, ctx.grid);
  const notes: SliceNote[] = [];
  if (r.line) {
    if (r.clipped) notes.push('clipped');
    if (ends.centredOnMap) notes.push('no-fire-centred-on-map');
  }
  return { line: r.line, source: 'preset', preset, issue: r.issue, notes, minLengthM };
}

/**
 * The effective line of a `SliceLineState`, by the first rule that applies: a live preset, then a hand-placed `a` and `b`
 * (a lone one is ignored), then the longest chord through `centre` along `azimuth`. Presets are chords through the fire (or the
 * map centre when there is none) of at most `SLICE_PRESET_HALF_LENGTH_M` each way ('me' runs from the phone to the fire and is
 * not extended); each is clipped and length-checked like `sectionFromEndpoints`. Never throws.
 */
export function resolveSlice(state: SliceLineState, ctx: SliceResolveContext): ResolvedSlice {
  if (state.preset) return resolvePreset(state.preset, ctx);
  const minLengthM = minLengthOf(ctx.grid);
  if (state.a && state.b) {
    const r = sectionFromEndpoints(state.a, state.b, ctx.grid);
    return { line: r.line, source: 'endpoints', preset: null, issue: r.issue, notes: r.line && r.clipped ? ['clipped'] : [], minLengthM };
  }
  const centre = state.centre;
  const centred = (line: SectionLine | null, issue: SliceIssue | null): ResolvedSlice => ({ line, source: 'centre', preset: null, issue, notes: [], minLengthM });
  if (!finite(centre) || !Number.isFinite(state.azimuth)) return centred(null, 'outside-model');
  const line = sectionLine(rectOf(ctx.grid), centre, state.azimuth);
  if (!line) return centred(null, 'outside-model');
  return line.length + 1e-6 < minLengthM ? centred(null, 'too-short') : centred(line, null);
}

/** Whether `resolveSlice` would make a line for the preset now; if not, the issue it would return. */
export function slicePresetStatus(preset: SlicePresetId, ctx: SliceResolveContext): SlicePresetStatus {
  const r = resolvePreset(preset, ctx);
  return r.line ? { ok: true } : { ok: false, issue: r.issue ?? 'outside-model' };
}
