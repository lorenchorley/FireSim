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
