/**
 * Shared types and constants of the wind glyphs (0.5.0, stage E1): the zoom-adaptive arrows and flow lines drawn on the map
 * at a height the person chooses. Types and constants only, so the engine (render/wind), the render layer and the UI can
 * be built side by side from one contract. The caps are per picture tier; `FRAME_TRIANGLE_LIMIT` is the whole frame's budget.
 */
import type { GridSpec } from '../../core/grid';
import type { FuelMap } from '../../core/types';
import type { VegInstances } from '../vegetationPlacement';

export type GlyphLevel = 0 | 1 | 2 | 3 | 4;
/**
 * What the glyphs show the wind of: `'fire'` is the model's 10 m wind over open ground, the numbers are metres above the ground, and `'felt'`
 * (0.7.0, "What the fire feels") is the wind the fire model uses in each 60 m cell (`SimSnapshot.fireWind`). `'felt'` is not in `WIND_HEIGHTS` yet.
 */
export type WindHeight = 'felt' | 'fire' | 50 | 100 | 300 | 1000 | 2000;
export const WIND_HEIGHTS: readonly WindHeight[] = ['fire', 50, 100, 300, 1000, 2000];
export type GlyphTier = 'low' | 'medium' | 'high';
/** Per tier: glyphs, and segments per batch (shaft + arrowhead; triangles are 4 x segments: halo batch and colour batch). */
export const GLYPH_CAPS: Record<GlyphTier, { glyphs: number; segments: number }> = {
  low: { glyphs: 600, segments: 4000 },
  medium: { glyphs: 1200, segments: 8000 },
  high: { glyphs: 2000, segments: 12000 },
};
/** The whole frame's triangles; the glyph layer trims its picture to it (the detailed streaks keep `DETAIL_MIN_SEGMENTS` over it). */
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
  /** Additive (0.7.0): the lowest ground (m ASL) when the raster already knows it (`HeightField` does), so the layer need not walk the cells for it. */
  minElevation?: number;
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
/**
 * `WindGlyphStats.detail`: no detailed streaks drawn, drawn and moving, drawn standing still (reduced motion), or drawn standing still because
 * the view paused after a minute without a touch (0.7.0, `idleStop.ts`; reduced motion wins: a layer that stands still for it says `'still'`).
 */
export type DetailMotion = 'off' | 'moving' | 'still' | 'paused';
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
 * The segments of the detailed streaks that the frame's triangle budget never takes away (at most the tier's own cap). It is the High tier's cap, so
 * at no tier does the frame trim them: they are `min(what the view holds, the tier's cap)` and the same view gives the same picture however the frame
 * was filled when it was built. Why: a dense forest at the High tier fills the frame without them (terrain and canopy come to 548,000 to 578,000
 * triangles in the Katoomba valley, against `FRAME_TRIANGLE_LIMIT`), so a trim to the frame left the closest zoom, which is the owner's request,
 * with nothing at all, and a picture trimmed to a floor under the natural one (the lines of a phone come to 6,000 to 12,000 segments) was the size of
 * whatever the frame held when it was built (a jump) and not of the view (a smooth zoom). The cost is 2 triangles a segment: at most 8,000, 16,000
 * and 24,000 triangles at the Low, Medium and High tiers, a quarter of what the glyph pair of the lower levels may take, and only the detailed streaks
 * go over the limit (by at most `2 x DETAIL_MIN_SEGMENTS`, 4.4 % of it). Lower it to bring the trim back above that floor (`segmentCap`).
 */
export const DETAIL_MIN_SEGMENTS = GLYPH_CAPS.high.segments;

/**
 * A set of placed trees as the vegetation layer holds them (by reference: nothing is copied): `group` 0 to 6 are trees (the others are heath,
 * understorey and grass), `position` is [x, y, ground z] and `size` [height, crown width] per tree, in metres.
 */
export type CrownSet = Pick<VegInstances, 'group' | 'count' | 'position' | 'size'>;
/** Where the layer reads the placed crowns from (`VegetationLayer.crownSource()`): `serial` changes whenever `sets()` would answer differently. */
export interface CrownSource {
  readonly serial: number;
  sets(): readonly CrownSet[];
}
/** The fire's plume as a site for an eddy pair (local metres): its base, its radius and how strong it is (0 to 1). */
export interface Plume {
  x: number;
  y: number;
  radiusM: number;
  strength: number;
}

/**
 * The numbers of the detailed streaks' look (0.7.0, docs/plans/0.7.0/D-CONTRACT-070-detail-looks.md section 2: flow around ridges and tree crowns,
 * and eddies). First guesses, tuned on real pictures by the lane that builds them. `DETAIL_RELIEF.enabled` is the kill switch: false draws the
 * 0.6.0 picture whatever else is given. `DetailInput.relief` absent is the 0.6.0 picture too, byte for byte.
 */
export interface DetailRelief {
  enabled: boolean;
  /** T2: where the ground rises ahead of a step (rise per metre along the flow, smoothstep between `riseLo` and `riseHi`) the line slides along the contour by `beta`; `forwardM` is the forward difference. */
  ridge: { riseLo: number; riseHi: number; beta: number; forwardM: number; maxTurnDeg: number };
  /** T1: the stroke rides at `topShare` x canopy height x cover weight (cover over `coverFull` counts as 1); the canopy height is clamped to `maxHeightM`. */
  canopy: { topShare: number; coverFull: number; maxHeightM: number };
  /** T3: crowns as obstacles. */
  crowns: {
    /** Only when a `gateCrownM` crown would be at least `gatePx` across on the screen (a camera nearer than about 580 m at 412 x 868). */
    gateCrownM: number;
    gatePx: number;
    /** Tree groups 0 to `maxGroup` count (trees, not heath, understorey or grass). */
    maxGroup: number;
    /** A tree is an obstacle when it stands `clearM` over the stroke; the crown is an ellipsoid whose middle is at `centreShare` x height and half height `halfShare` x height. */
    clearM: number;
    centreShare: number;
    halfShare: number;
    /** A disc under `minRadiusPx` on the screen is not an obstacle; at most `maxCrowns` are kept (the bound is the screen); the clock is read every `clockEvery` trees. */
    minRadiusPx: number;
    maxCrowns: number;
    clockEvery: number;
    /** The grid of crowns (`gridM` cells), the reach of one (`reach` x its radius), the doublet's softening (`soften` x r), the turn cap per step, the stop at the rim (x r) and the seed block (x r). */
    gridM: number;
    reach: number;
    soften: number;
    maxTurnDeg: number;
    rim: number;
    seedBlock: number;
    /** The per-line pin written into the colour alpha: `1 - pinDepth x (near an obstacle)` within `pinReach` x r, never under `pinMin` (the shader multiplies the meander by it). */
    pinMin: number;
    pinDepth: number;
    pinReach: number;
  };
  /** D6: counter-rotating Rankine vortex pairs behind proud crowns, in the lee of ridges and behind the plume. */
  eddies: {
    /** The pair stands `downwind` x r downwind and `lateral` x r either side; core `core` x r, strength `kappa`, faded to 0 at `reach` x r (fade from `fadeFromCores` core radii). */
    downwind: number;
    lateral: number;
    core: number;
    kappa: number;
    reach: number;
    fadeFromCores: number;
    /** A site is used only when its core is at least `minCorePx` across; at most `maxEddies`; kept by a hash priority under `keep`. */
    minCorePx: number;
    maxEddies: number;
    keep: number;
    /** (a) a crown standing `proudM` over the stand with no other obstacle within `freeReach` x r. */
    proudM: number;
    freeReach: number;
    /** (b) ridge lee: a world lattice of `latticeM`, kept where the lee factor is at least `leeMin`, the ground falls `fallMin` along the flow and is `upwindRiseM` higher `upwindM` upwind; r = clamp(`radiusPerDrop` x drop, `radiusMinM`, `radiusMaxM`). */
    latticeM: number;
    leeMin: number;
    fallMin: number;
    upwindM: number;
    upwindRiseM: number;
    radiusPerDrop: number;
    radiusMinM: number;
    radiusMaxM: number;
    /** (c) the plume: at most `plumeSites`; strength = min(1, intensity / `plumeIntensityKwM`), radius `plumeRadiusM` + `plumeRadiusGainM` x strength. */
    plumeSites: number;
    plumeIntensityKwM: number;
    plumeRadiusM: number;
    plumeRadiusGainM: number;
  };
}
export const DETAIL_RELIEF: DetailRelief = {
  enabled: true,
  ridge: { riseLo: 0.1, riseHi: 0.35, beta: 0.6, forwardM: 12, maxTurnDeg: 30 },
  canopy: { topShare: 0.85, coverFull: 0.3, maxHeightM: 60 },
  crowns: {
    gateCrownM: 5,
    gatePx: 8,
    maxGroup: 6,
    clearM: 1.5,
    centreShare: 0.7,
    halfShare: 0.3,
    minRadiusPx: 4,
    maxCrowns: 1024,
    clockEvery: 4096,
    gridM: 32,
    reach: 3,
    soften: 0.35,
    maxTurnDeg: 30,
    rim: 0.85,
    seedBlock: 0.8,
    pinMin: 0.05,
    pinDepth: 0.95,
    pinReach: 2.5,
  },
  eddies: {
    downwind: 1.7,
    lateral: 0.9,
    core: 0.7,
    kappa: 0.6,
    reach: 3.2,
    fadeFromCores: 2,
    minCorePx: 10,
    maxEddies: 32,
    keep: 0.5,
    proudM: 3,
    freeReach: 2.2,
    latticeM: 48,
    leeMin: 0.6,
    fallMin: 0.25,
    upwindM: 60,
    upwindRiseM: 12,
    radiusPerDrop: 0.25,
    radiusMinM: 10,
    radiusMaxM: 40,
    plumeSites: 2,
    plumeIntensityKwM: 20_000,
    plumeRadiusM: 30,
    plumeRadiusGainM: 90,
  },
};

/** A `GlyphInput` plus the 10 m ground as received (the lift and lee come from it) and the seed of the line lifetimes (0 in the app). */
export interface DetailInput extends GlyphInput {
  ground10: GroundRaster;
  seed: number;
  /** Additive (D-engine): metres above the ground the wind is read at (`'fire'` is 10), so the ground terms fade with height; absent is 10. */
  heightM?: number;
  /** Additive (0.7.0): the look of the lines round ridges, crowns and eddies. Absent (or `enabled` false) is the 0.6.0 picture, byte for byte. */
  relief?: DetailRelief;
  /** Additive (0.7.0): the canopy height and cover per fire cell, by reference (the strokes ride on the crowns' tops); absent or no `relief`: not read. */
  canopy?: FuelMap;
  /** Additive (0.7.0): the placed crowns, by reference (null when the canopy layer is off); absent or no `relief`: not read. */
  crowns?: readonly CrownSet[];
  /** Additive (0.7.0): the fire's plume as an eddy site; absent or no `relief`: not read. */
  plumes?: readonly Plume[];
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
  /** 0.7.0: seeds not drawn because they fell inside an obstacle's disc (0 while `relief` is absent). */
  blocked: number;
}
export interface DetailBuilder {
  begin(input: DetailInput): void;
  step(budgetMs: number): boolean;
  readonly busy: boolean;
  readonly out: DetailOutput;
  cancel(): void;
}
