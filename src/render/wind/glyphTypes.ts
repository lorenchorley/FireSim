/**
 * Shared types and constants of the wind glyphs (0.5.0, stage E1): the zoom-adaptive arrows and flow lines drawn on the map
 * at a height the person chooses. Types and constants only, so the engine (render/wind), the render layer and the UI can
 * be built side by side from one contract. The caps are per picture tier; `FRAME_TRIANGLE_LIMIT` is the whole frame's budget.
 */
import type { GridSpec } from '../../core/grid';

export type GlyphLevel = 0 | 1 | 2 | 3 | 4;
/** What the glyphs show the wind of: `'fire'` is the model's 10 m wind over open ground, the numbers are metres above the ground. */
export type WindHeight = 'fire' | 50 | 100 | 300 | 1000 | 2000;
export const WIND_HEIGHTS: readonly WindHeight[] = ['fire', 50, 100, 300, 1000, 2000];
export type GlyphTier = 'low' | 'medium' | 'high';
/** Per tier: glyphs, and segments per batch (shaft + arrowhead; triangles are 4 x segments: halo batch and colour batch). */
export const GLYPH_CAPS: Record<GlyphTier, { glyphs: number; segments: number }> = {
  low: { glyphs: 600, segments: 4000 },
  medium: { glyphs: 1200, segments: 8000 },
  high: { glyphs: 2000, segments: 12000 },
};
export const FRAME_TRIANGLE_LIMIT = 550_000;
export const GLYPH_SHAFT_SEGMENTS_MAX = 10; // plus 2 for the arrowhead: 12 per glyph
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface LodPlan {
  level: GlyphLevel;
  cellPx: number;
  spacingPx: number;
  spacingExp: number;
  spacingM: number;
  curved: boolean;
  jitter: number;
  lengthPx: { min: number; max: number; pxPerMs: number };
  /**
   * Metres per CSS pixel at the middle of the screen, as given to `planLod` (additive in G-engine: the builder needs it for the
   * orbit density, `s = mppSeed / mppCentre`). Absent in a hand-made plan: the builder then uses `spacingM / spacingPx`.
   */
  mppCentre?: number;
  /**
   * Additive (0.6.0): the share of the finest lattice's density the picture keeps, 1/4 to 1 (absent is 1). Only the detailed streaks' builder
   * reads it: it runs a nested lattice (see `detailStreaks.ts`) whose finest octave is thinned by this, so the line count follows the zoom
   * continuously and the picture is the same on both sides of an octave edge. `planLod` gives 1 to every other level.
   */
  thin?: number;
}
/** Texel k = j * nx + i at (x0 + i * cellSize, y0 + j * cellSize); u east, v north, m/s. */
export interface FlowRaster {
  grid: GridSpec;
  u: Float32Array;
  v: Float32Array;
}
/** A ground height raster (m ASL, same indexing). `HeightField` satisfies it. */
export interface GroundRaster {
  grid: GridSpec;
  elevation: Float32Array;
}
export interface GlyphInput {
  field: FlowRaster;
  ground: GroundRaster;
  vex: number;
  lod: LodPlan;
  /** WORLD axes (x east, y up, z south): eye (3) and projection x view (16, column-major, THREE Matrix4.elements). */
  eye: ArrayLike<number>;
  viewProj: ArrayLike<number>;
  cssW: number;
  cssH: number;
  pxPerMetre1: number;
  near: number;
  box: Box;
  cap: { glyphs: number; segments: number };
  /** Milliseconds; performance.now in the app, a counter in tests. */
  now(): number;
}
export interface GlyphOutput {
  a: Float32Array;
  b: Float32Array;
  c: Float32Array;
  glyphs: number;
  segments: number;
  dropped: number;
  calm: number;
}
export interface GlyphBuilder {
  begin(input: GlyphInput): void;
  step(budgetMs: number): boolean;
  readonly busy: boolean;
  readonly out: GlyphOutput;
  cancel(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// The detailed streaks (0.6.0): what the most detailed level draws instead of the long flow lines.
// ─────────────────────────────────────────────────────────────────────────────

/** The level that draws the detailed streaks (the last of `GlyphLevel`). */
export const DETAIL_LEVEL = 4 as const;
/** `WindGlyphStats.detail`: no detailed streaks drawn, drawn and moving, or drawn standing still (reduced motion). */
export type DetailMotion = 'off' | 'moving' | 'still';
/**
 * First guesses for the look of the detailed streaks, in screen pixels (and px per m/s), tuned on a phone. `spacingPx` is how far apart the lines are on
 * the screen, on average, at every zoom (a lattice of one line to 32 x 32 px, about 400 to 630 lines over a 412 x 915 view): the lattice is a nested one,
 * its finest octave 16 to 32 px apart thinned to that by `LodPlan.thin`, so the count of lines follows the zoom and nothing pops where the octave changes
 * (a lattice of one power of two of metres, 32 to 64 px apart, lost three quarters of its lines through each octave and got them back, with the whole
 * picture replaced, at the edge).
 */
export const DETAIL_GEOMETRY = { spacingPx: 32, jitter: 0.35, minPx: 90, maxPx: 220, pxPerMs: 16, stepPx: 9, minSegments: 8, maxSegments: 24 } as const;
/** How long the detailed streaks take to fade in on entering the level, and out on leaving it (ms of capped frame time). */
export const DETAIL_FADE_IN_MS = 400;
export const DETAIL_FADE_OUT_MS = 250;
/**
 * The segments of the detailed streaks that the frame's triangle budget never takes away (at most the tier's own cap, so the Low and Medium tiers
 * keep their whole picture). A dense forest at the High tier fills the frame (terrain and canopy come to 548,000 to 563,000 triangles against
 * `FRAME_TRIANGLE_LIMIT`), and without a floor the closest zoom, which is the owner's request, draws nothing. The picture of a phone is about this
 * size, so the same view gives the same picture however the frame was filled. It costs the frame 2 triangles a segment: the limit is exceeded
 * by at most `2 x DETAIL_MIN_SEGMENTS` triangles, and only by the detailed streaks (the glyph pair of the lower levels has no floor).
 */
export const DETAIL_MIN_SEGMENTS = 8000;

/** A `GlyphInput` plus the 10 m ground as received (the lift and lee come from it) and the seed of the line lifetimes (0 in the app). */
export interface DetailInput extends GlyphInput {
  ground10: GroundRaster;
  seed: number;
  /** Additive (D-engine): metres above the ground the wind is read at (`'fire'` is 10), so the ground terms fade with height; absent is 10. */
  heightM?: number;
}
/**
 * Per segment, flat typed arrays: `a`, `b` the world ends (3 each), `c` colour rgb in display-linear light and alpha 1 (4), `d` the arc
 * lengths `s0`, `s1`, the line length `L` (all px) and the `seed` of the line (4), `e` the line's `speed` (m/s), `turb`, `lift` and `tail` (px) (4).
 */
export interface DetailOutput {
  a: Float32Array;
  b: Float32Array;
  c: Float32Array;
  d: Float32Array;
  e: Float32Array;
  lines: number;
  segments: number;
  dropped: number;
  calm: number;
  steep: number;
}
export interface DetailBuilder {
  begin(input: DetailInput): void;
  step(budgetMs: number): boolean;
  readonly busy: boolean;
  readonly out: DetailOutput;
  cancel(): void;
}
