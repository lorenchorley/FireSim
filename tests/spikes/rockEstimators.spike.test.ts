/**
 * Spike S6 (plan docs/plans/air-slice-wind-detail-honest-speed.md, 9d.4 and 9d.5): which estimator of BARE ROCK should
 * H-sim use for `Terrain.rockFraction`? Throwaway harness: it changes nothing in the app and is skipped unless
 * FIRESIM_SPIKE is set, so `npm test` never runs it.
 *
 *   FIRESIM_SPIKE=1 nice -n 10 npx vitest run tests/spikes/rockEstimators.spike.test.ts
 *
 * What it does, per bundled site (katoomba, kanangra, grose, tomah):
 *   1. loads the 10 m terrain, the fire-grid terrain, the terrain features and the fire-grid canopy cover with the app's
 *      own functions (loadHiResDem, fireTerrainFromHiRes, computeTerrainFeatures, loadCanopyLayer);
 *   2. computes the estimators E0, F, E1, E2, E3, E23 (and their sub-cell "c" variants) for every fire cell;
 *   3. picks 20 patches of 3 x 3 fire cells with a fixed seed, from the numbers only (never from the photo);
 *   4. draws two contact sheets (sheet-<site>-blind.jpg without numbers, sheet-<site>.jpg with them);
 *   5. when labels.json exists in the output folder, scores every estimator against the labels and writes results.md.
 *
 * Environment: FIRESIM_SPIKE_SITES (comma list, default the four sites), FIRESIM_SPIKE_OUT (output folder, default
 * docs/plans/spikes/S6-rock-estimators), FIRESIM_SPIKE_AID (a folder for the labelling aid sheets: the same crop as is,
 * with the shadows lifted, as raw 8 m pixels and as a wider 810 m crop; no slope and no numbers; scratch use only).
 * Nothing new is installed: the JPEG decoder is the one inside geotiff; a small baseline JPEG encoder and a 5 x 7 bitmap
 * font are written here. The default vitest reporter does not print the harness's log lines; add --reporter=verbose.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDecoder } from 'geotiff';
import { describe, expect, it } from 'vitest';
import { LocalProjection } from '../../src/core/geo';
import { sampleBilinear, type GridSpec } from '../../src/core/grid';
import type { Terrain } from '../../src/core/types';
import { loadAssetJson } from '../../src/data/assets';
import { loadBundledCanopyRaster, mapGrids, resampleMapped } from '../../src/data/canopy';
import { DEMO_SITES } from '../../src/data/demoSites';
import { loadDemoImageryBytes } from '../../src/data/demoRasters';
import { computeTerrainFeatures, type TerrainFeaturesExt } from '../../src/fire/terrainFeatures';
import { loadCanopyLayer } from '../../src/scenario/layers';
import { SCENARIO_PARAMS } from '../../src/scenario/params';
import { fireTerrainFromHiRes, loadHiResDem, slopeDegOf } from '../../src/scenario/terrain';
import { terrainDerived } from '../../src/terrain';

const SPIKE = Boolean(process.env.FIRESIM_SPIKE);
const REPO = fileURLToPath(new URL('../../', import.meta.url));
const OUT_DIR = process.env.FIRESIM_SPIKE_OUT ?? join(REPO, 'docs/plans/spikes/S6-rock-estimators');
const SITE_IDS = (process.env.FIRESIM_SPIKE_SITES ?? 'katoomba,kanangra,grose,tomah')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const SITE_PREFIX: Record<string, string> = { katoomba: 'KT', kanangra: 'KN', grose: 'GR', tomah: 'TM', budawangs: 'BW', thredbo: 'TH' };

// ─────────────────────────────────────────────────────────────────────────────
// Pre-registered settings (fixed before any tile of the four study sites was looked at or scored; the README quotes them and the hash below)
// ─────────────────────────────────────────────────────────────────────────────

const CONFIG = {
  /** Seed of every random draw (patch choice, tile order). */
  seed: 6006,
  /** Fire cell (m): SCENARIO_PARAMS.fireCellM, the default. */
  fireCellM: 30,
  /** E1: a 10 m sub-cell is steep at this slope or more (plan SCENARIO_PARAMS.rockSlopeDeg, an [H] guess). Other values are reported as sensitivity only. */
  rockSlopeDeg: 55,
  rockSlopeSensitivityDeg: [50, 60] as readonly number[],
  /** Classes (plan 9d.4 item 2). chute = drainage and trench >= chuteTrench and rock >= chuteRock; wall = rock >= wallRock and not chute. */
  wallRock: 0.5,
  partialRock: 0.1,
  chuteRock: 0.2,
  chuteTrench: 0.3,
  /** E3 greenness: ExG = 2g - r - b on chromatic coordinates; a pixel is vegetation when ExG > T. T is the quantile of the ExG of the reference forest of the same photo. */
  green: { refSlopeLoDeg: 25, refSlopeHiDeg: 45, refCoverMin: 0.8, quantile: 0.05, relShift: 0.2 },
  /** Patches: 3 x 3 fire cells, tile crop 270 m, centres at least minSepCells apart, centre at least edgeCells from the edge. */
  patchCells: 3,
  cropM: 270,
  minSepCells: 9,
  edgeCells: 5,
  strata: { high: 8, mid: 6, disagree: 4, control: 2 },
  highMinSteep: 0.5,
  midMinSteep: 0.1,
  disagreeMinSteep: 0.1,
  controlMaxSteep: 0.02,
  controlMaxSlopeDeg: 15,
  controlMinCover: 0.6,
  /** A tile counts as a wall tile when at least this many of its 9 cells are wall; partial when wall + partial cells reach partialCellsMin; it has a chute when it holds one chute cell. */
  wallCellsMin: 5,
  partialCellsMin: 3,
  chuteCellsMin: 1,
} as const;

/** The pass criteria. G1 and G2 and G3 decide S6; the minimum counts say when a gate cannot be judged (then it is "inconclusive", which D17 treats as a miss). */
const CRITERIA = {
  /** minPatchSteep: only tiles whose patch-mean steepFraction is at least this are "steep" (below it no estimator can call a wall, so the tile says nothing about false walls or recall). */
  minPatchSteep: 0.3,
  G1_falseWall: { onLabel: 'veg', maxWallTileShare: 0.1, maxWallCellShare: 0.1, minTiles: 8 },
  G2_wallRecall: { onLabel: 'rock', minWallTileShare: 0.75, minTiles: 8 },
  G3_chutes: { maxChuteInRockTileShare: 0.25, minChuteTileShare: 0.5, minChuteTilesToJudgeRecall: 3 },
  labels: ['rock', 'mixed', 'veg', 'chute', 'unsure'],
  /** How the single rater (an AI looking at the 8 m photo crops) decides a label. Written before the first tile was looked at. */
  labelRules: {
    rock: 'bare cliff face or pavement is the main thing inside the yellow box: pale grey, cream or orange rock, or a smooth dark face with no tree texture whose sunlit part (pale rock, ledges, a bright rim) shows in the same crop',
    mixed: 'rock (as above) and vegetation (tree, shrub or grass texture, green or olive) each clearly cover at least about a fifth of the box',
    veg: 'tree, shrub or grass texture covers the box, whatever the ground is doing; shadow in which tree texture or crowns can be seen counts as vegetation',
    chute: 'a vegetated strip (green or textured, at least about one photo pixel wide) cuts across a rock band inside the box',
    unsure: 'the box is mostly deep shadow with no sunlit part of the same feature in the crop, or haze, or nothing can be told apart at 8 m pixels; a dark smooth patch alone is never "rock"',
    order: 'labels are written from the photo (as is and with shadows lifted) before the estimator numbers or the slope panel are looked at; each label gets a few words of evidence and a confidence (high or low)',
  },
} as const;

const configHash = (): string => createHash('sha256').update(JSON.stringify({ CONFIG, CRITERIA })).digest('hex').slice(0, 16);

type Label = 'rock' | 'mixed' | 'veg' | 'chute' | 'unsure';
const LABELS: readonly Label[] = ['rock', 'mixed', 'veg', 'chute', 'unsure'];

// ─────────────────────────────────────────────────────────────────────────────
// Small utilities
// ─────────────────────────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], rnd: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Wilson 95 % interval of k out of n. */
function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

/** "42 % (5/12)" or "n/a (0/0)". */
function share(k: number, n: number, digits = 0): string {
  return n === 0 ? 'n/a (0/0)' : `${((100 * k) / n).toFixed(digits)} % (${k}/${n})`;
}

/** "42 % (5/12, 95 % CI 19-68 %)". */
function shareCi(k: number, n: number): string {
  if (n === 0) return 'n/a (0/0)';
  const [lo, hi] = wilson(k, n);
  return `${((100 * k) / n).toFixed(0)} % (${k}/${n}, CI ${(100 * lo).toFixed(0)}-${(100 * hi).toFixed(0)} %)`;
}

const quantile = (values: ArrayLike<number>, q: number): number => {
  const a = Float64Array.from(values as ArrayLike<number>).sort();
  if (!a.length) return NaN;
  const pos = q * (a.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(a.length - 1, lo + 1);
  return a[lo]! + (a[hi]! - a[lo]!) * (pos - lo);
};

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

// ─────────────────────────────────────────────────────────────────────────────
// Images: RGB buffers, JPEG decode (geotiff's decoder), bicubic sampling, drawing, a 5 x 7 font, a baseline JPEG encoder
// ─────────────────────────────────────────────────────────────────────────────

interface Rgb {
  w: number;
  h: number;
  /** r, g, b per pixel, row 0 at the top. */
  d: Uint8Array;
}
type Colour = readonly [number, number, number];

const newRgb = (w: number, h: number, c: Colour = [255, 255, 255]): Rgb => {
  const d = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    d[i * 3] = c[0];
    d[i * 3 + 1] = c[1];
    d[i * 3 + 2] = c[2];
  }
  return { w, h, d };
};

function jpegSize(b: Uint8Array): { w: number; h: number } {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) throw new Error('jpegSize: bad marker');
    const m = b[i + 1]!;
    if (m === 0xc0 || m === 0xc1 || m === 0xc2) return { h: (b[i + 5]! << 8) | b[i + 6]!, w: (b[i + 7]! << 8) | b[i + 8]! };
    i += 2 + ((b[i + 2]! << 8) | b[i + 3]!);
  }
  throw new Error('jpegSize: no SOF marker');
}

/**
 * Decode a baseline or progressive JPEG with the decoder that ships inside geotiff (compression 7). It returns the
 * components without the colour transform, so YCbCr to RGB (JFIF, full range) is done here. The result differs from
 * libjpeg (PIL) by 0.26 grey levels on average, 12 at most, because libjpeg smooths the chroma when it upsamples it.
 */
async function decodeJpegRgb(bytes: Uint8Array): Promise<Rgb> {
  const { w, h } = jpegSize(bytes);
  const dec = await getDecoder(7, { tileWidth: w, tileHeight: h, predictor: 1, bitsPerSample: [8, 8, 8], planarConfiguration: 1 });
  const raw = new Uint8Array(await dec.decodeBlock(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
  const out = new Uint8Array(w * h * 3);
  const c8 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
  for (let i = 0; i < w * h; i++) {
    const y = raw[i * 3]!;
    const cb = raw[i * 3 + 1]! - 128;
    const cr = raw[i * 3 + 2]! - 128;
    out[i * 3] = c8(y + 1.402 * cr);
    out[i * 3 + 1] = c8(y - 0.344136 * cb - 0.714136 * cr);
    out[i * 3 + 2] = c8(y + 1.772 * cb);
  }
  return { w, h, d: out };
}

/** Catmull-Rom weight. */
function cubicW(t0: number): number {
  const t = Math.abs(t0);
  if (t <= 1) return 1.5 * t * t * t - 2.5 * t * t + 1;
  if (t < 2) return -0.5 * t * t * t + 2.5 * t * t - 4 * t + 2;
  return 0;
}

/** Bicubic sample at pixel-centre coordinates (u, v): pixel (c, r) has its centre at integers. Edges are clamped. */
function sampleBicubic(img: Rgb, u: number, v: number, out: number[]): void {
  const iu = Math.floor(u);
  const iv = Math.floor(v);
  const fu = u - iu;
  const fv = v - iv;
  const wu = [cubicW(fu + 1), cubicW(fu), cubicW(1 - fu), cubicW(2 - fu)];
  const wv = [cubicW(fv + 1), cubicW(fv), cubicW(1 - fv), cubicW(2 - fv)];
  let r = 0;
  let g = 0;
  let b = 0;
  for (let q = 0; q < 4; q++) {
    const rr = clamp(iv - 1 + q, 0, img.h - 1);
    for (let p = 0; p < 4; p++) {
      const cc = clamp(iu - 1 + p, 0, img.w - 1);
      const w = wu[p]! * wv[q]!;
      const o = (rr * img.w + cc) * 3;
      r += w * img.d[o]!;
      g += w * img.d[o + 1]!;
      b += w * img.d[o + 2]!;
    }
  }
  out[0] = clamp(Math.round(r), 0, 255);
  out[1] = clamp(Math.round(g), 0, 255);
  out[2] = clamp(Math.round(b), 0, 255);
}

function fillRect(img: Rgb, x: number, y: number, w: number, h: number, c: Colour): void {
  for (let j = Math.max(0, y); j < Math.min(img.h, y + h); j++) {
    for (let i = Math.max(0, x); i < Math.min(img.w, x + w); i++) {
      const o = (j * img.w + i) * 3;
      img.d[o] = c[0];
      img.d[o + 1] = c[1];
      img.d[o + 2] = c[2];
    }
  }
}

/** 1 px outline of a rectangle (x, y, w, h), clipped to the image. */
function outlineRect(img: Rgb, x: number, y: number, w: number, h: number, c: Colour): void {
  fillRect(img, x, y, w, 1, c);
  fillRect(img, x, y + h - 1, w, 1, c);
  fillRect(img, x, y, 1, h, c);
  fillRect(img, x + w - 1, y, 1, h, c);
}

function blit(dst: Rgb, src: Rgb, x: number, y: number): void {
  for (let j = 0; j < src.h; j++) {
    const dj = y + j;
    if (dj < 0 || dj >= dst.h) continue;
    for (let i = 0; i < src.w; i++) {
      const di = x + i;
      if (di < 0 || di >= dst.w) continue;
      const so = (j * src.w + i) * 3;
      const o = (dj * dst.w + di) * 3;
      dst.d[o] = src.d[so]!;
      dst.d[o + 1] = src.d[so + 1]!;
      dst.d[o + 2] = src.d[so + 2]!;
    }
  }
}

/** 5 x 7 glyphs: five column bytes, bit 0 = top row. Lower case is drawn as upper case. */
const FONT: Record<string, readonly number[]> = {
  ' ': [0x00, 0x00, 0x00, 0x00, 0x00],
  '!': [0x00, 0x00, 0x5f, 0x00, 0x00],
  '#': [0x14, 0x7f, 0x14, 0x7f, 0x14],
  '%': [0x23, 0x13, 0x08, 0x64, 0x62],
  "'": [0x00, 0x05, 0x03, 0x00, 0x00],
  '(': [0x00, 0x1c, 0x22, 0x41, 0x00],
  ')': [0x00, 0x41, 0x22, 0x1c, 0x00],
  '*': [0x14, 0x08, 0x3e, 0x08, 0x14],
  '+': [0x08, 0x08, 0x3e, 0x08, 0x08],
  ',': [0x00, 0x50, 0x30, 0x00, 0x00],
  '-': [0x08, 0x08, 0x08, 0x08, 0x08],
  '.': [0x00, 0x60, 0x60, 0x00, 0x00],
  '/': [0x20, 0x10, 0x08, 0x04, 0x02],
  '0': [0x3e, 0x51, 0x49, 0x45, 0x3e],
  '1': [0x00, 0x42, 0x7f, 0x40, 0x00],
  '2': [0x42, 0x61, 0x51, 0x49, 0x46],
  '3': [0x21, 0x41, 0x45, 0x4b, 0x31],
  '4': [0x18, 0x14, 0x12, 0x7f, 0x10],
  '5': [0x27, 0x45, 0x45, 0x45, 0x39],
  '6': [0x3c, 0x4a, 0x49, 0x49, 0x30],
  '7': [0x01, 0x71, 0x09, 0x05, 0x03],
  '8': [0x36, 0x49, 0x49, 0x49, 0x36],
  '9': [0x06, 0x49, 0x49, 0x29, 0x1e],
  ':': [0x00, 0x36, 0x36, 0x00, 0x00],
  '<': [0x08, 0x14, 0x22, 0x41, 0x00],
  '=': [0x14, 0x14, 0x14, 0x14, 0x14],
  '>': [0x00, 0x41, 0x22, 0x14, 0x08],
  '?': [0x02, 0x01, 0x51, 0x09, 0x06],
  A: [0x7e, 0x11, 0x11, 0x11, 0x7e],
  B: [0x7f, 0x49, 0x49, 0x49, 0x36],
  C: [0x3e, 0x41, 0x41, 0x41, 0x22],
  D: [0x7f, 0x41, 0x41, 0x22, 0x1c],
  E: [0x7f, 0x49, 0x49, 0x49, 0x41],
  F: [0x7f, 0x09, 0x09, 0x09, 0x01],
  G: [0x3e, 0x41, 0x49, 0x49, 0x7a],
  H: [0x7f, 0x08, 0x08, 0x08, 0x7f],
  I: [0x00, 0x41, 0x7f, 0x41, 0x00],
  J: [0x20, 0x40, 0x41, 0x3f, 0x01],
  K: [0x7f, 0x08, 0x14, 0x22, 0x41],
  L: [0x7f, 0x40, 0x40, 0x40, 0x40],
  M: [0x7f, 0x02, 0x0c, 0x02, 0x7f],
  N: [0x7f, 0x04, 0x08, 0x10, 0x7f],
  O: [0x3e, 0x41, 0x41, 0x41, 0x3e],
  P: [0x7f, 0x09, 0x09, 0x09, 0x06],
  Q: [0x3e, 0x41, 0x51, 0x21, 0x5e],
  R: [0x7f, 0x09, 0x19, 0x29, 0x46],
  S: [0x46, 0x49, 0x49, 0x49, 0x31],
  T: [0x01, 0x01, 0x7f, 0x01, 0x01],
  U: [0x3f, 0x40, 0x40, 0x40, 0x3f],
  V: [0x1f, 0x20, 0x40, 0x20, 0x1f],
  W: [0x3f, 0x40, 0x38, 0x40, 0x3f],
  X: [0x63, 0x14, 0x08, 0x14, 0x63],
  Y: [0x07, 0x08, 0x70, 0x08, 0x07],
  Z: [0x61, 0x51, 0x49, 0x45, 0x43],
  '_': [0x40, 0x40, 0x40, 0x40, 0x40],
  '|': [0x00, 0x00, 0x7f, 0x00, 0x00],
  '~': [0x08, 0x04, 0x08, 0x10, 0x08],
};

/** Draw text with the 5 x 7 font (6 px advance per character at scale 1). Returns the x after the last character. */
function drawText(img: Rgb, x: number, y: number, text: string, c: Colour, scale = 1, bold = false): number {
  let cx = x;
  for (const ch of text.toUpperCase()) {
    const g = FONT[ch] ?? FONT['?']!;
    for (let col = 0; col < 5; col++) {
      for (let row = 0; row < 7; row++) {
        if (!((g[col]! >> row) & 1)) continue;
        fillRect(img, cx + col * scale, y + row * scale, scale + (bold ? 1 : 0), scale, c);
      }
    }
    cx += 6 * scale + (bold ? 1 : 0);
  }
  return cx;
}

// Baseline JPEG encoder: 4:2:0, the Annex K quantisation tables scaled by quality, the Annex K luminance Huffman tables
// for every component. The harness checks its own output by decoding it again (see selfCheckJpeg).
const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46,
  53, 60, 61, 54, 47, 55, 62, 63,
];
const STD_LUM_Q = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103,
  121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];
const STD_CHR_Q = [
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99, ...new Array<number>(32).fill(99),
];
const DC_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const AC_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 125];
const AC_VALS = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72,
  0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
  0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3,
  0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
];

interface HuffTable {
  code: Int32Array;
  len: Int32Array;
}
function makeHuff(bits: readonly number[], vals: readonly number[]): HuffTable {
  if (new Set(vals).size !== vals.length || bits.reduce((a, b) => a + b, 0) !== vals.length) throw new Error('makeHuff: inconsistent table');
  const code = new Int32Array(256);
  const len = new Int32Array(256);
  let c = 0;
  let k = 0;
  for (let l = 1; l <= 16; l++) {
    for (let i = 0; i < bits[l - 1]!; i++) {
      code[vals[k]!] = c;
      len[vals[k]!] = l;
      k++;
      c++;
    }
    c <<= 1;
  }
  return { code, len };
}

/** Cosine table T[u][x] = 0.5 c(u) cos((2x + 1) u pi / 16), so that F = T f T^t is the 8 x 8 DCT-II of JPEG. */
const DCT_T: Float64Array[] = Array.from({ length: 8 }, (_, u) => Float64Array.from({ length: 8 }, (_, x) => 0.5 * (u === 0 ? Math.SQRT1_2 : 1) * Math.cos(((2 * x + 1) * u * Math.PI) / 16)));

function encodeJpeg(img: Rgb, quality: number): Uint8Array {
  const sc = quality < 50 ? 5000 / quality : 200 - quality * 2;
  const qL = STD_LUM_Q.map((v) => clamp(Math.floor((v * sc + 50) / 100), 1, 255));
  const qC = STD_CHR_Q.map((v) => clamp(Math.floor((v * sc + 50) / 100), 1, 255));
  const dc = makeHuff(DC_BITS, DC_VALS);
  const ac = makeHuff(AC_BITS, AC_VALS);
  const W = Math.ceil(img.w / 16) * 16;
  const H = Math.ceil(img.h / 16) * 16;
  const Y = new Float32Array(W * H);
  const Cb = new Float32Array((W / 2) * (H / 2));
  const Cr = new Float32Array((W / 2) * (H / 2));
  for (let y = 0; y < H; y++) {
    const sy = Math.min(y, img.h - 1);
    for (let x = 0; x < W; x++) {
      const o = (sy * img.w + Math.min(x, img.w - 1)) * 3;
      const r = img.d[o]!;
      const g = img.d[o + 1]!;
      const b = img.d[o + 2]!;
      Y[y * W + x] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
      const cb = -0.168736 * r - 0.331264 * g + 0.5 * b;
      const cr = 0.5 * r - 0.418688 * g - 0.081312 * b;
      const ci = (y >> 1) * (W / 2) + (x >> 1);
      Cb[ci] = Cb[ci]! + cb / 4;
      Cr[ci] = Cr[ci]! + cr / 4;
    }
  }
  const out: number[] = [];
  const u16 = (v: number): void => void out.push((v >> 8) & 255, v & 255);
  out.push(0xff, 0xd8);
  out.push(0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0);
  for (const [id, q] of [[0, qL], [1, qC]] as const) {
    out.push(0xff, 0xdb);
    u16(67);
    out.push(id);
    for (let i = 0; i < 64; i++) out.push(q[ZIGZAG[i]!]!);
  }
  out.push(0xff, 0xc0);
  u16(17);
  out.push(8);
  u16(img.h);
  u16(img.w);
  out.push(3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1);
  for (const [cls, bits, vals] of [[0x00, DC_BITS, DC_VALS], [0x10, AC_BITS, AC_VALS]] as const) {
    out.push(0xff, 0xc4);
    u16(2 + 1 + 16 + vals.length);
    out.push(cls, ...bits, ...vals);
  }
  out.push(0xff, 0xda);
  u16(12);
  out.push(3, 1, 0x00, 2, 0x00, 3, 0x00, 0, 63, 0);

  // Entropy-coded data.
  let acc = 0;
  let nb = 0;
  const put = (code: number, len: number): void => {
    acc = ((acc << len) | code) & 0xffffff;
    nb += len;
    while (nb >= 8) {
      nb -= 8;
      const b = (acc >> nb) & 255;
      out.push(b);
      if (b === 255) out.push(0);
    }
  };
  const tmp = new Float64Array(64);
  const coef = new Float64Array(64);
  const predDc = [0, 0, 0];
  const block = (plane: Float32Array, stride: number, bx: number, by: number, q: number[], comp: number): void => {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) tmp[y * 8 + x] = plane[(by + y) * stride + bx + x]!;
    // rows then columns
    const mid = new Float64Array(64);
    for (let y = 0; y < 8; y++) {
      for (let u = 0; u < 8; u++) {
        let s = 0;
        for (let x = 0; x < 8; x++) s += tmp[y * 8 + x]! * DCT_T[u]![x]!;
        mid[y * 8 + u] = s;
      }
    }
    for (let u = 0; u < 8; u++) {
      for (let v = 0; v < 8; v++) {
        let s = 0;
        for (let y = 0; y < 8; y++) s += mid[y * 8 + u]! * DCT_T[v]![y]!;
        coef[v * 8 + u] = s;
      }
    }
    const zz = new Int32Array(64);
    for (let i = 0; i < 64; i++) {
      const n = ZIGZAG[i]!;
      zz[i] = Math.round(coef[n]! / q[n]!);
    }
    const diff = zz[0]! - predDc[comp]!;
    predDc[comp] = zz[0]!;
    let a = Math.abs(diff);
    let size = 0;
    while (a) {
      size++;
      a >>= 1;
    }
    put(dc.code[size]!, dc.len[size]!);
    if (size) put(diff < 0 ? (diff - 1) & ((1 << size) - 1) : diff, size);
    let run = 0;
    for (let i = 1; i < 64; i++) {
      const v = zz[i]!;
      if (v === 0) {
        run++;
        continue;
      }
      while (run > 15) {
        put(ac.code[0xf0]!, ac.len[0xf0]!);
        run -= 16;
      }
      let m = Math.abs(v);
      let s = 0;
      while (m) {
        s++;
        m >>= 1;
      }
      const sym = (run << 4) | s;
      put(ac.code[sym]!, ac.len[sym]!);
      put(v < 0 ? (v - 1) & ((1 << s) - 1) : v, s);
      run = 0;
    }
    if (run > 0) put(ac.code[0]!, ac.len[0]!);
  };
  for (let my = 0; my < H; my += 16) {
    for (let mx = 0; mx < W; mx += 16) {
      block(Y, W, mx, my, qL, 0);
      block(Y, W, mx + 8, my, qL, 0);
      block(Y, W, mx, my + 8, qL, 0);
      block(Y, W, mx + 8, my + 8, qL, 0);
      block(Cb, W / 2, mx / 2, my / 2, qC, 1);
      block(Cr, W / 2, mx / 2, my / 2, qC, 2);
    }
  }
  if (nb > 0) put((1 << (8 - nb)) - 1, 8 - nb);
  out.push(0xff, 0xd9);
  return Uint8Array.from(out);
}

/** Highest quality (from a fixed ladder) whose file fits the byte budget. */
function encodeWithin(img: Rgb, maxBytes: number): { bytes: Uint8Array; quality: number } {
  let last: { bytes: Uint8Array; quality: number } | null = null;
  for (const q of [88, 84, 80, 76, 72, 68, 64, 60, 55, 50]) {
    last = { bytes: encodeJpeg(img, q), quality: q };
    if (last.bytes.length <= maxBytes) return last;
  }
  return last!;
}

/** Decode our own JPEG with geotiff's decoder and return the PSNR (dB) against the source. */
async function selfCheckJpeg(src: Rgb, bytes: Uint8Array): Promise<number> {
  const back = await decodeJpegRgb(bytes);
  if (back.w !== src.w || back.h !== src.h) throw new Error('selfCheckJpeg: size mismatch');
  let se = 0;
  for (let i = 0; i < src.d.length; i++) se += (src.d[i]! - back.d[i]!) ** 2;
  return 10 * Math.log10((255 * 255) / Math.max(1e-9, se / src.d.length));
}

// ─────────────────────────────────────────────────────────────────────────────
// Site data and the estimators
// ─────────────────────────────────────────────────────────────────────────────

const DEMO_EXTENT = SCENARIO_PARAMS.demoExtentM;
/** Quantiles of the reference-forest ExG used only for the post-hoc threshold sweep in results.md. */
const SWEEP_QUANTILES = [0.01, 0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 0.7] as const;

/**
 * E0  today's wall mask (features.cliff).                         F    rock = cliffFraction (60 degree share), the plan's no-canopy fallback, with the new classes.
 * E1  rock = steepFraction (55 degree share).                     E2   rock = steepFraction x (1 - canopy cover), fire-grid cover as build.ts makes it.
 * E3  rock = steepFraction x (1 - photo vegetation fraction).     E23  rock = steepFraction x (1 - max(cover, photo vegetation)).
 * "c" variants: the product is taken per 10 m sub-cell and then averaged (steep AND bare), not as a product of cell means.
 * E3T80 / E3T120: E3 with T x 0.8 / x 1.2 (the brief's +/-20 % of the threshold). E3D80 / E3D120: the greenness deficit (median - T) x 0.8 / x 1.2.
 */
type EstId = 'E0' | 'F' | 'E1' | 'E2' | 'E3' | 'E23' | 'E2c' | 'E3c' | 'E23c' | 'E3T80' | 'E3T120' | 'E3D80' | 'E3D120';
const EST_IDS: readonly EstId[] = ['E0', 'F', 'E1', 'E2', 'E3', 'E23', 'E2c', 'E3c', 'E23c', 'E3T80', 'E3T120', 'E3D80', 'E3D120'];
const MAIN_EST: readonly EstId[] = ['E0', 'F', 'E1', 'E2', 'E3', 'E23'];
const EST_NAME: Record<EstId, string> = {
  E0: "E0 today's cliff mask",
  F: 'F cliffFraction (60 deg)',
  E1: 'E1 slope only (55 deg)',
  E2: 'E2 slope x (1 - cover)',
  E3: 'E3 slope x (1 - photo green)',
  E23: 'E23 slope x (1 - max(cover, green))',
  E2c: 'E2c sub-cell steep AND no cover',
  E3c: 'E3c sub-cell steep AND not green',
  E23c: 'E23c sub-cell steep AND neither',
  E3T80: 'E3 with T x 0.8',
  E3T120: 'E3 with T x 1.2',
  E3D80: 'E3 with deficit x 0.8',
  E3D120: 'E3 with deficit x 1.2',
};

const CLS_NONE = 0;
const CLS_PARTIAL = 1;
const CLS_WALL = 2;
const CLS_CHUTE = 3;

interface Est {
  rock: Float32Array;
  cls: Uint8Array;
}

interface Greenness {
  /** ExG value below which a photo pixel counts as not vegetation. */
  T: number;
  /** Median ExG of the reference forest and the deficit median - T. */
  median: number;
  delta: number;
  refCells: number;
  refPixels: number;
  /** ExG quantiles of the reference forest, for the post-hoc threshold sweep. */
  refQuantiles: Record<string, number>;
}

interface SiteData {
  id: string;
  name: string;
  proj: LocalProjection;
  hiGrid: GridSpec;
  elevation: Float32Array;
  s10: Float32Array;
  hs10: Float32Array;
  terrain: Terrain;
  features: TerrainFeaturesExt;
  nx: number;
  ny: number;
  coverFire: Float32Array;
  photo: Rgb;
  photoCell: number;
  exg: Float32Array;
  lum: Float32Array;
  green: Greenness;
  vegCtx: VegCtx;
  steep: Float32Array;
  /** Share of the 10 m sub-cells of each fire cell at 65 degrees or more (very steep, cliff-like ground). */
  steep65Cell: Float32Array;
  /** Photo vegetation share of each fire cell at the base threshold T. */
  vegFire: Float32Array;
  est: Record<EstId, Est>;
  /** Wall share of E1 at the other slope thresholds (sensitivity). */
  e1Sens: { deg: number; wall: number; partial: number; chute: number }[];
  canopyNote: string;
  demNote: string;
  photoNote: string;
  /** Checks that our block averaging matches the app's own numbers. */
  checks: { cliffFractionMaxDiff: number; coverBlockMeanAbsDiff: number };
}

const exgOf = (r: number, g: number, b: number): number => {
  const s = r + g + b;
  return s > 0 ? (2 * g - r - b) / s : 0;
};

/** Mean of each b x b block of a hi-res array (j = 0 south) on the fire grid. */
function blockMean(f: Float32Array, hiN: number, b: number, nx: number, ny: number): Float32Array {
  const out = new Float32Array(nx * ny);
  const inv = 1 / (b * b);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      let s = 0;
      for (let bj = 0; bj < b; bj++) for (let bi = 0; bi < b; bi++) s += f[(j * b + bj) * hiN + i * b + bi]!;
      out[j * nx + i] = s * inv;
    }
  }
  return out;
}

/** Exact area average of a square raster onto a coarser or finer square raster of the same extent (both row 0 first). */
function boxResample(src: Float32Array, srcN: number, srcCell: number, dstN: number, dstCell: number): Float32Array {
  const idx: number[][] = [];
  const wts: number[][] = [];
  for (let d = 0; d < dstN; d++) {
    const a = d * dstCell;
    const b = a + dstCell;
    const c0 = Math.max(0, Math.floor(a / srcCell + 1e-9));
    const c1 = Math.min(srcN - 1, Math.ceil(b / srcCell - 1e-9) - 1);
    const ii: number[] = [];
    const ww: number[] = [];
    let tot = 0;
    for (let c = c0; c <= c1; c++) {
      const o = Math.min(b, (c + 1) * srcCell) - Math.max(a, c * srcCell);
      if (o > 1e-9) {
        ii.push(c);
        ww.push(o);
        tot += o;
      }
    }
    idx.push(ii);
    wts.push(ww.map((w) => w / tot));
  }
  const tmp = new Float32Array(srcN * dstN);
  for (let r = 0; r < srcN; r++) {
    for (let d = 0; d < dstN; d++) {
      let s = 0;
      const ii = idx[d]!;
      const ww = wts[d]!;
      for (let q = 0; q < ii.length; q++) s += src[r * srcN + ii[q]!]! * ww[q]!;
      tmp[r * dstN + d] = s;
    }
  }
  const out = new Float32Array(dstN * dstN);
  for (let d = 0; d < dstN; d++) {
    const ii = idx[d]!;
    const ww = wts[d]!;
    for (let x = 0; x < dstN; x++) {
      let s = 0;
      for (let q = 0; q < ii.length; q++) s += tmp[ii[q]! * dstN + x]! * ww[q]!;
      out[d * dstN + x] = s;
    }
  }
  return out;
}

/** Flip the rows of a square raster (image order, row 0 north, to grid order, j = 0 south). */
function flipRows(a: Float32Array, n: number): Float32Array {
  const out = new Float32Array(a.length);
  for (let r = 0; r < n; r++) out.set(a.subarray(r * n, (r + 1) * n), (n - 1 - r) * n);
  return out;
}

/** Hillshade (0..1) of a DEM, sun from azimuth `az` (deg, clockwise from north) at altitude `alt` (deg). */
function hillshadeOf(g: GridSpec, z: Float32Array, az: number, alt: number): Float32Array {
  const { nx, ny, cellSize: h } = g;
  const out = new Float32Array(nx * ny);
  const a = (az * Math.PI) / 180;
  const e = (alt * Math.PI) / 180;
  const lx = Math.cos(e) * Math.sin(a);
  const ly = Math.cos(e) * Math.cos(a);
  const lz = Math.sin(e);
  for (let j = 0; j < ny; j++) {
    const jd = Math.max(0, j - 1);
    const ju = Math.min(ny - 1, j + 1);
    for (let i = 0; i < nx; i++) {
      const il = Math.max(0, i - 1);
      const ir = Math.min(nx - 1, i + 1);
      const dx = (z[j * nx + ir]! - z[j * nx + il]!) / (h * (ir - il));
      const dy = (z[ju * nx + i]! - z[jd * nx + i]!) / (h * (ju - jd));
      const inv = 1 / Math.sqrt(1 + dx * dx + dy * dy);
      out[j * nx + i] = Math.max(0, (-dx * lx - dy * ly + lz) * inv);
    }
  }
  return out;
}

interface VegCtx {
  exg: Float32Array;
  photoN: number;
  photoCell: number;
  hiN: number;
  hiCell: number;
  b: number;
  nx: number;
  ny: number;
}

/** Photo vegetation share (ExG > t) per 10 m sub-cell (j = 0 south) and per fire cell, by exact area averaging. */
function vegFractions(c: VegCtx, t: number): { veg10: Float32Array; vegFire: Float32Array } {
  const mask = new Float32Array(c.exg.length);
  for (let p = 0; p < mask.length; p++) mask[p] = c.exg[p]! > t ? 1 : 0;
  const veg10 = flipRows(boxResample(mask, c.photoN, c.photoCell, c.hiN, c.hiCell), c.hiN);
  return { veg10, vegFire: blockMean(veg10, c.hiN, c.b, c.nx, c.ny) };
}

/** Class of every fire cell from a rock fraction and the app's own drainage and trench score (plan 9d.4 item 2). */
function classify(rock: Float32Array, drainage: Uint8Array, trench: Float32Array): Uint8Array {
  const cls = new Uint8Array(rock.length);
  for (let k = 0; k < rock.length; k++) {
    const r = rock[k]!;
    const chute = drainage[k] === 1 && trench[k]! >= CONFIG.chuteTrench && r >= CONFIG.chuteRock;
    cls[k] = chute ? CLS_CHUTE : r >= CONFIG.wallRock ? CLS_WALL : r >= CONFIG.partialRock ? CLS_PARTIAL : CLS_NONE;
  }
  return cls;
}

/** Photo pixel index ranges (half open) whose centres fall inside the fire cell centred at local (cx, cy), half-width hw. */
function photoRange(cx: number, cy: number, hw: number, cell: number): { c0: number; c1: number; r0: number; r1: number } {
  const half = DEMO_EXTENT / 2;
  // pixel c centre x = -half + cell * c + cell / 2 ; pixel r centre y = half - cell * r - cell / 2
  const c0 = Math.ceil((cx - hw + half - cell / 2) / cell - 1e-9);
  const c1 = Math.ceil((cx + hw + half - cell / 2) / cell - 1e-9) - 1;
  const r0 = Math.floor((half - cell / 2 - (cy + hw)) / cell + 1e-9) + 1;
  const r1 = Math.floor((half - cell / 2 - (cy - hw)) / cell + 1e-9);
  return { c0, c1, r0, r1 };
}

async function loadSite(id: string): Promise<SiteData> {
  const meta = DEMO_SITES.find((s) => s.id === id);
  if (!meta) throw new Error(`unknown site ${id}`);
  const B = CONFIG.fireCellM / SCENARIO_PARAMS.hiResCellM;
  // 1. The app's own terrain path.
  const hi = await loadHiResDem({ centre: meta.centre, extent: DEMO_EXTENT, online: false, demoSiteId: id });
  if (hi.origin !== 'lidar') throw new Error(`${id}: expected the bundled 10 m terrain, got ${hi.origin}`);
  const hiGrid = hi.dem.grid;
  const terrain = fireTerrainFromHiRes(hi.dem, CONFIG.fireCellM);
  const derived = terrainDerived(terrain);
  const features = computeTerrainFeatures(terrain, derived, hi.dem);
  const nx = terrain.grid.nx;
  const ny = terrain.grid.ny;
  const n = nx * ny;
  const s10 = slopeDegOf(hiGrid, hi.dem.elevation);
  // 2. Canopy cover on the fire grid exactly as the build does it, and at 10 m for the sub-cell variants.
  const layer = await loadCanopyLayer(terrain.grid, { centre: meta.centre, extent: DEMO_EXTENT, online: false, demoSiteId: id });
  if (!layer.canopy || layer.origin !== 'demo') throw new Error(`${id}: no bundled canopy`);
  const coverFire = layer.canopy.cover;
  const raster = await loadBundledCanopyRaster(id);
  if (!raster) throw new Error(`${id}: no canopy raster`);
  const cover10 = resampleMapped(raster.grid, raster.cover, hiGrid, mapGrids(raster.grid, hiGrid));
  // 3. The photo.
  const imeta = await loadAssetJson<{ cellSize: number; n: number; extent: number; source?: string; attribution?: string; serviceCopyright?: string }>(`demo/${id}/imagery.json`);
  const jpg = await loadDemoImageryBytes(id);
  if (!imeta || !jpg) throw new Error(`${id}: no aerial photo`);
  const photo = await decodeJpegRgb(jpg);
  if (photo.w !== imeta.n || photo.h !== imeta.n || imeta.extent !== DEMO_EXTENT) throw new Error(`${id}: photo size ${photo.w}x${photo.h} does not match imagery.json`);
  const photoCell = imeta.cellSize;
  const exg = new Float32Array(photo.w * photo.h);
  const lum = new Float32Array(photo.w * photo.h);
  for (let p = 0; p < exg.length; p++) {
    const r = photo.d[p * 3]!;
    const g = photo.d[p * 3 + 1]!;
    const b = photo.d[p * 3 + 2]!;
    exg[p] = exgOf(r, g, b);
    lum[p] = (r + g + b) / 3;
  }
  // 4. Steep sub-cells and the steep fraction (E1).
  const hiN = hiGrid.nx;
  const steepSubAt = (deg: number): Float32Array => {
    const a = new Float32Array(s10.length);
    for (let p = 0; p < a.length; p++) a[p] = s10[p]! >= deg ? 1 : 0;
    return a;
  };
  const steepSub = steepSubAt(CONFIG.rockSlopeDeg);
  const steep = blockMean(steepSub, hiN, B, nx, ny);
  const steep65Cell = blockMean(steepSubAt(65), hiN, B, nx, ny);
  // 5. Greenness threshold from the reference forest of this photo (decided before any label exists).
  const gcfg = CONFIG.green;
  const refVals: number[] = [];
  let refCells = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const sl = terrain.slopeDeg[k]!;
      if (!(sl >= gcfg.refSlopeLoDeg && sl < gcfg.refSlopeHiDeg && coverFire[k]! >= gcfg.refCoverMin && steep[k]! === 0)) continue;
      refCells++;
      const cx = terrain.grid.x0 + i * terrain.grid.cellSize;
      const cy = terrain.grid.y0 + j * terrain.grid.cellSize;
      const { c0, c1, r0, r1 } = photoRange(cx, cy, terrain.grid.cellSize / 2, photoCell);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) refVals.push(exg[r * photo.w + c]!);
    }
  }
  if (refVals.length < 1000) throw new Error(`${id}: reference forest too small (${refVals.length} pixels)`);
  const T = quantile(refVals, gcfg.quantile);
  const median = quantile(refVals, 0.5);
  const refQuantiles: Record<string, number> = {};
  for (const qq of SWEEP_QUANTILES) refQuantiles[String(qq)] = quantile(refVals, qq);
  const green: Greenness = { T, median, delta: median - T, refCells, refPixels: refVals.length, refQuantiles };

  // 6. Estimators.
  const vegCtx: VegCtx = { exg, photoN: photo.w, photoCell, hiN, hiCell: hiGrid.cellSize, b: B, nx, ny };
  const vegAt = (t: number): { veg10: Float32Array; vegFire: Float32Array } => vegFractions(vegCtx, t);
  const times = (a: Float32Array, b: Float32Array): Float32Array => {
    const o = new Float32Array(a.length);
    for (let k = 0; k < o.length; k++) o[k] = a[k]! * (1 - b[k]!);
    return o;
  };
  const subAnd = (veg: Float32Array): Float32Array => {
    const o = new Float32Array(steepSub.length);
    for (let p = 0; p < o.length; p++) o[p] = steepSub[p]! * (1 - veg[p]!);
    return blockMean(o, hiN, B, nx, ny);
  };
  const maxOf = (a: Float32Array, b: Float32Array): Float32Array => {
    const o = new Float32Array(a.length);
    for (let k = 0; k < o.length; k++) o[k] = Math.max(a[k]!, b[k]!);
    return o;
  };
  // Checks: our 3 x 3 block averaging reproduces the app's own cliffFraction (strict > 60 degrees) exactly, and the 10 m cover
  // averaged over the same blocks is close to the fire-grid cover the build makes (they differ only in how 20 m cells are resampled).
  const over60 = new Float32Array(s10.length);
  for (let p = 0; p < over60.length; p++) over60[p] = s10[p]! > SCENARIO_PARAMS.cliffSlopeDeg ? 1 : 0;
  const cf = blockMean(over60, hiN, B, nx, ny);
  let cliffFractionMaxDiff = 0;
  for (let k = 0; k < n; k++) cliffFractionMaxDiff = Math.max(cliffFractionMaxDiff, Math.abs(cf[k]! - terrain.cliffFraction![k]!));
  if (cliffFractionMaxDiff > 1e-5) throw new Error(`${id}: block averaging differs from the app's cliffFraction by ${cliffFractionMaxDiff}`);
  const cb = blockMean(cover10, hiN, B, nx, ny);
  let coverDiff = 0;
  for (let k = 0; k < n; k++) coverDiff += Math.abs(cb[k]! - coverFire[k]!) / n;
  const base = vegAt(T);
  const rocks: Record<EstId, Float32Array> = {
    E0: Float32Array.from(features.cliff, (v) => v),
    F: terrain.cliffFraction!,
    E1: steep,
    E2: times(steep, coverFire),
    E3: times(steep, base.vegFire),
    E23: times(steep, maxOf(coverFire, base.vegFire)),
    E2c: subAnd(cover10),
    E3c: subAnd(base.veg10),
    E23c: subAnd(maxOf(cover10, base.veg10)),
    E3T80: times(steep, vegAt(T * (1 - gcfg.relShift)).vegFire),
    E3T120: times(steep, vegAt(T * (1 + gcfg.relShift)).vegFire),
    E3D80: times(steep, vegAt(median - (1 - gcfg.relShift) * green.delta).vegFire),
    E3D120: times(steep, vegAt(median - (1 + gcfg.relShift) * green.delta).vegFire),
  };
  const est = {} as Record<EstId, Est>;
  for (const e of EST_IDS) {
    if (e === 'E0') {
      const cls = new Uint8Array(n);
      for (let k = 0; k < n; k++) cls[k] = features.cliff[k] === 1 ? CLS_WALL : CLS_NONE;
      est[e] = { rock: rocks[e], cls };
    } else est[e] = { rock: rocks[e], cls: classify(rocks[e], features.drainage, features.trench) };
  }
  const e1Sens = CONFIG.rockSlopeSensitivityDeg.map((deg) => {
    const c = classify(blockMean(steepSubAt(deg), hiN, B, nx, ny), features.drainage, features.trench);
    let w = 0;
    let p = 0;
    let ch = 0;
    for (let k = 0; k < n; k++) {
      if (c[k] === CLS_WALL) w++;
      else if (c[k] === CLS_PARTIAL) p++;
      else if (c[k] === CLS_CHUTE) ch++;
    }
    return { deg, wall: w, partial: p, chute: ch };
  });
  return {
    id,
    name: meta.name,
    proj: new LocalProjection(meta.centre),
    hiGrid,
    elevation: hi.dem.elevation,
    s10,
    hs10: hillshadeOf(hiGrid, hi.dem.elevation, 315, 45),
    terrain,
    features,
    nx,
    ny,
    coverFire,
    photo,
    photoCell,
    exg,
    lum,
    green,
    vegCtx,
    steep,
    steep65Cell,
    vegFire: base.vegFire,
    est,
    e1Sens,
    canopyNote: `${layer.canopy.source}`,
    demNote: hi.dem.source,
    photoNote: `${imeta.source ?? 'bundled aerial photo'}; ${imeta.attribution ?? ''}; service copyright ${imeta.serviceCopyright ?? 'not stated'}`,
    checks: { cliffFractionMaxDiff, coverBlockMeanAbsDiff: coverDiff },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Patch choice (from the numbers only) and tile records
// ─────────────────────────────────────────────────────────────────────────────

type Stratum = 'high' | 'mid' | 'disagree' | 'control';
const STRATUM_LETTER: Record<Stratum, string> = { high: 'H', mid: 'M', disagree: 'D', control: 'C' };

interface Patch {
  ci: number;
  cj: number;
  stratum: Stratum;
  /** For the disagreement stratum: which disagreement ranked it. */
  kind: string;
}

/** Mean of the 3 x 3 block centred on each cell (cells on the border get 0; they are never candidates). */
function box3(a: Float32Array, nx: number, ny: number): Float32Array {
  const out = new Float32Array(a.length);
  for (let j = 1; j < ny - 1; j++) {
    for (let i = 1; i < nx - 1; i++) {
      let s = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) s += a[(j + dj) * nx + i + di]!;
      out[j * nx + i] = s / 9;
    }
  }
  return out;
}

function selectPatches(site: SiteData, siteIdx: number): { patches: Patch[]; notes: string[] } {
  const { nx, ny } = site;
  const m1 = box3(site.est.E1.rock, nx, ny);
  const m2 = box3(site.est.E2.rock, nx, ny);
  const m3 = box3(site.est.E3.rock, nx, ny);
  const mCover = box3(site.coverFire, nx, ny);
  const mSlope = box3(site.terrain.slopeDeg, nx, ny);
  interface Cand {
    ci: number;
    cj: number;
    steep: number;
    range: number;
    d23: number;
    cover: number;
    slope: number;
  }
  const cands: Cand[] = [];
  const e = CONFIG.edgeCells;
  for (let cj = e; cj < ny - e; cj++) {
    for (let ci = e; ci < nx - e; ci++) {
      const k = cj * nx + ci;
      const a = m1[k]!;
      const b = m2[k]!;
      const c = m3[k]!;
      cands.push({ ci, cj, steep: a, range: Math.max(a, b, c) - Math.min(a, b, c), d23: Math.abs(b - c), cover: mCover[k]!, slope: mSlope[k]! });
    }
  }
  const chosen: Patch[] = [];
  const notes: string[] = [];
  const far = (c: Cand): boolean => chosen.every((p) => Math.max(Math.abs(p.ci - c.ci), Math.abs(p.cj - c.cj)) >= CONFIG.minSepCells);
  const take = (list: Cand[], count: number, stratum: Stratum, kind: string): number => {
    let got = 0;
    for (const c of list) {
      if (got >= count) break;
      if (!far(c)) continue;
      chosen.push({ ci: c.ci, cj: c.cj, stratum, kind });
      got++;
    }
    return got;
  };
  const byKey = (key: (c: Cand) => number): ((a: Cand, b: Cand) => number) => (a, b) => key(b) - key(a) || a.cj - b.cj || a.ci - b.ci;
  const stratumRng = (s: number): (() => number) => mulberry32(CONFIG.seed * 1009 + siteIdx * 31 + s);
  const S = CONFIG.strata;
  // Disagreement first (deterministic ranking): two by the range of E1, E2, E3 and two by |E2 - E3|, among steep patches.
  const steepList = cands.filter((c) => c.steep >= CONFIG.disagreeMinSteep);
  const gotRange = take([...steepList].sort(byKey((c) => c.range)), S.disagree / 2, 'disagree', 'range');
  const gotD23 = take([...steepList].sort(byKey((c) => c.d23)), S.disagree - gotRange, 'disagree', 'E2-E3');
  if (gotRange + gotD23 < S.disagree) notes.push(`disagree: only ${gotRange + gotD23} of ${S.disagree} found`);
  const gotHigh = take(shuffled(cands.filter((c) => c.steep >= CONFIG.highMinSteep), stratumRng(1)), S.high, 'high', '');
  if (gotHigh < S.high) notes.push(`high: only ${gotHigh} of ${S.high} patches with steepFraction >= ${CONFIG.highMinSteep} at ${CONFIG.minSepCells} cells apart`);
  const midPool = shuffled(cands.filter((c) => c.steep >= CONFIG.midMinSteep && c.steep < CONFIG.highMinSteep), stratumRng(2));
  const gotMid = take(midPool, S.mid, 'mid', '');
  if (gotMid < S.mid) notes.push(`mid: only ${gotMid} of ${S.mid}`);
  const gotControl = take(
    shuffled(cands.filter((c) => c.steep < CONFIG.controlMaxSteep && c.slope < CONFIG.controlMaxSlopeDeg && c.cover >= CONFIG.controlMinCover), stratumRng(3)),
    S.control,
    'control',
    '',
  );
  if (gotControl < S.control) notes.push(`control: only ${gotControl} of ${S.control}`);
  const total = S.high + S.mid + S.disagree + S.control;
  if (chosen.length < total) {
    // Make up the numbers from the steep pools (further 'mid' patches, then further 'high' ones) and say so.
    const before = chosen.length;
    take(midPool, total - chosen.length, 'mid', 'fill');
    if (chosen.length < total) take(shuffled(cands.filter((c) => c.steep >= CONFIG.highMinSteep), stratumRng(4)), total - chosen.length, 'high', 'fill');
    notes.push(`filled ${chosen.length - before} places from the steep pools`);
  }
  return { patches: chosen, notes };
}

interface TileEst {
  rockMean: number;
  nW: number;
  nP: number;
  nC: number;
}

interface Tile {
  id: string;
  site: string;
  stratum: Stratum;
  kind: string;
  ci: number;
  cj: number;
  /** Patch centre, local metres and degrees. */
  x: number;
  y: number;
  lat: number;
  lon: number;
  steep: number;
  cover: number;
  veg: number;
  slope: number;
  /** Share of the 81 10 m sub-cells of the patch at 65 degrees or more, and the steepest one (deg): context for tiles the photo shows as vegetated. */
  steep65: number;
  max10: number;
  /** Mean ExG and mean luminance (0-255) of the photo pixels inside the 90 m patch box. */
  exgMean: number;
  lumMean: number;
  /** Direction the ground faces (deg, compass), the circular mean over the 9 cells weighted by steepFraction; NaN on flat ground. */
  facing: number;
  est: Record<EstId, TileEst>;
}

function makeTiles(site: SiteData, patches: Patch[], siteIdx: number): Tile[] {
  const order = shuffled(patches, mulberry32(CONFIG.seed * 7 + siteIdx));
  const prefix = SITE_PREFIX[site.id] ?? site.id.slice(0, 2).toUpperCase();
  const g = site.terrain.grid;
  return order.map((p, n) => {
    const cells: number[] = [];
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) cells.push((p.cj + dj) * site.nx + p.ci + di);
    const mean = (a: Float32Array): number => cells.reduce((s, k) => s + a[k]!, 0) / cells.length;
    const est = {} as Record<EstId, TileEst>;
    for (const id of EST_IDS) {
      const e = site.est[id];
      let nW = 0;
      let nP = 0;
      let nC = 0;
      for (const k of cells) {
        if (e.cls[k] === CLS_WALL) nW++;
        else if (e.cls[k] === CLS_PARTIAL) nP++;
        else if (e.cls[k] === CLS_CHUTE) nC++;
      }
      est[id] = { rockMean: mean(e.rock), nW, nP, nC };
    }
    const x = g.x0 + p.ci * g.cellSize;
    const y = g.y0 + p.cj * g.cellSize;
    const ll = site.proj.toLatLon(x, y);
    const B = CONFIG.fireCellM / SCENARIO_PARAMS.hiResCellM;
    const hn = site.hiGrid.nx;
    let exgSum = 0;
    let lumSum = 0;
    let nPx = 0;
    {
      const hw = (CONFIG.patchCells * CONFIG.fireCellM) / 2;
      const { c0, c1, r0, r1 } = photoRange(x, y, hw, site.photoCell);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          exgSum += site.exg[r * site.photo.w + c]!;
          lumSum += site.lum[r * site.photo.w + c]!;
          nPx++;
        }
      }
    }
    let fx = 0;
    let fy = 0;
    for (const k of cells) {
      const a = site.terrain.aspectDeg[k]!;
      if (!Number.isFinite(a)) continue;
      const w = site.steep[k]! + 1e-6;
      fx += w * Math.sin((a * Math.PI) / 180);
      fy += w * Math.cos((a * Math.PI) / 180);
    }
    const facing = fx === 0 && fy === 0 ? NaN : (((Math.atan2(fx, fy) * 180) / Math.PI) % 360 + 360) % 360;
    let n65 = 0;
    let max10 = 0;
    for (let sj = B * (p.cj - 1); sj < B * (p.cj + 2); sj++) {
      for (let si = B * (p.ci - 1); si < B * (p.ci + 2); si++) {
        const v = site.s10[sj * hn + si]!;
        if (v >= 65) n65++;
        if (v > max10) max10 = v;
      }
    }
    return {
      id: `${prefix}${String(n + 1).padStart(2, '0')}`,
      site: site.id,
      stratum: p.stratum,
      kind: p.kind,
      ci: p.ci,
      cj: p.cj,
      x,
      y,
      lat: ll.lat,
      lon: ll.lon,
      steep: mean(site.steep),
      cover: mean(site.coverFire),
      veg: mean(site.vegFire),
      slope: mean(site.terrain.slopeDeg),
      steep65: n65 / (9 * B * B),
      max10,
      exgMean: exgSum / nPx,
      lumMean: lumSum / nPx,
      facing,
      est,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Contact sheets
// ─────────────────────────────────────────────────────────────────────────────

const SHEET = { panel: 192, panelGap: 3, header: 16, gap: 8, margin: 8, cols: 4, titleH: 26, footLine: 9, budgetBytes: 290_000 } as const;
const INK: Colour = [20, 20, 20];
const PAPER: Colour = [244, 244, 240];
const BOX_PHOTO: Colour = [255, 235, 0];
const BOX_SLOPE: Colour = [255, 255, 255];

const SLOPE_STOPS: readonly (readonly [number, Colour])[] = [
  [0, [236, 240, 244]],
  [20, [205, 224, 176]],
  [35, [244, 232, 120]],
  [45, [243, 162, 64]],
  [55, [226, 72, 52]],
  [65, [150, 24, 70]],
  [80, [70, 0, 90]],
];

function slopeColour(s: number): Colour {
  const st = SLOPE_STOPS;
  if (s <= st[0]![0]) return st[0]![1];
  for (let i = 1; i < st.length; i++) {
    if (s <= st[i]![0]) {
      const t = (s - st[i - 1]![0]) / (st[i]![0] - st[i - 1]![0]);
      const a = st[i - 1]![1];
      const b = st[i]![1];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    }
  }
  return st[st.length - 1]![1];
}

/** The aerial crop (north up) centred on (cx, cy), bicubic from the 8 m photo, with the patch box. */
function photoPanel(site: SiteData, cx: number, cy: number, P: number = SHEET.panel, gamma = 1, nearest = false, cropM: number = CONFIG.cropM): Rgb {
  const out = newRgb(P, P);
  const half = DEMO_EXTENT / 2;
  const px = [0, 0, 0];
  for (let j = 0; j < P; j++) {
    const y = cy + cropM / 2 - ((j + 0.5) / P) * cropM;
    const v = (half - y) / site.photoCell - 0.5;
    for (let i = 0; i < P; i++) {
      const x = cx - cropM / 2 + ((i + 0.5) / P) * cropM;
      const u = (x + half) / site.photoCell - 0.5;
      if (nearest) {
        const o2 = (clamp(Math.round(v), 0, site.photo.h - 1) * site.photo.w + clamp(Math.round(u), 0, site.photo.w - 1)) * 3;
        px[0] = site.photo.d[o2]!;
        px[1] = site.photo.d[o2 + 1]!;
        px[2] = site.photo.d[o2 + 2]!;
      } else sampleBicubic(site.photo, u, v, px);
      const o = (j * P + i) * 3;
      for (let q = 0; q < 3; q++) out.d[o + q] = gamma === 1 ? px[q]! : Math.round(255 * (px[q]! / 255) ** gamma);
    }
  }
  const bw = Math.round((P * CONFIG.patchCells * CONFIG.fireCellM) / cropM);
  const b0 = Math.round((P - bw) / 2);
  outlineRect(out, b0, b0, bw, bw, BOX_PHOTO);
  return out;
}

/** The 10 m slope colour ramp under a hillshade, same crop, same box. */
function slopePanel(site: SiteData, cx: number, cy: number): Rgb {
  const P = SHEET.panel;
  const out = newRgb(P, P);
  for (let j = 0; j < P; j++) {
    const y = cy + CONFIG.cropM / 2 - ((j + 0.5) / P) * CONFIG.cropM;
    for (let i = 0; i < P; i++) {
      const x = cx - CONFIG.cropM / 2 + ((i + 0.5) / P) * CONFIG.cropM;
      const s = sampleBilinear(site.hiGrid, site.s10, x, y);
      const hs = sampleBilinear(site.hiGrid, site.hs10, x, y);
      const c = slopeColour(s);
      const f = 0.72 + 0.28 * hs;
      const o = (j * P + i) * 3;
      out.d[o] = clamp(Math.round(c[0] * f), 0, 255);
      out.d[o + 1] = clamp(Math.round(c[1] * f), 0, 255);
      out.d[o + 2] = clamp(Math.round(c[2] * f), 0, 255);
    }
  }
  const b0 = Math.round(P / 3);
  outlineRect(out, b0, b0, Math.round(P / 3), Math.round(P / 3), BOX_SLOPE);
  outlineRect(out, b0 - 1, b0 - 1, Math.round(P / 3) + 2, Math.round(P / 3) + 2, [0, 0, 0]);
  return out;
}

const f2 = (v: number): string => (v >= 0.995 ? '1.0' : v.toFixed(2).replace(/^0/, ''));

/** The numbers printed under a tile on the "for the record" sheet. */
function tileNumbers(t: Tile): string[] {
  const cnt = (e: TileEst): string => `${e.nW}/${e.nP}/${e.nC}`;
  return [
    `${STRATUM_LETTER[t.stratum]} ST ${f2(t.steep)} CV ${f2(t.cover)} VG ${f2(t.veg)} SL ${t.slope.toFixed(0)}  E0 WALL ${t.est.E0.nW}`,
    `E1 ${f2(t.est.E1.rockMean)} ${cnt(t.est.E1)}  E2 ${f2(t.est.E2.rockMean)} ${cnt(t.est.E2)}  E3 ${f2(t.est.E3.rockMean)} ${cnt(t.est.E3)}`,
    `E23 ${f2(t.est.E23.rockMean)} ${cnt(t.est.E23)}  F ${f2(t.est.F.rockMean)} ${cnt(t.est.F)}  (ROCK MEAN, W/P/C CELLS OF 9)`,
  ];
}

/** Labelling aid (scratch only, not a deliverable): the same crop as is, with the shadows lifted, and as raw 8 m pixels. No slope, no numbers. */
const AID = { panel: 192, gamma: 0.55, cols: 1, rows: 5, wideM: 810 } as const;
function renderAid(site: SiteData, tiles: Tile[], part: number): Rgb | null {
  const per = AID.cols * AID.rows;
  const list = tiles.slice(part * per, (part + 1) * per);
  if (!list.length) return null;
  const tileW = 4 * AID.panel + 9;
  const tileH = 16 + AID.panel + 3;
  const rows = Math.ceil(list.length / AID.cols);
  const W = 16 + AID.cols * tileW + (AID.cols - 1) * 8;
  const H = 20 + rows * (tileH + 8);
  const img = newRgb(W, H, PAPER);
  drawText(img, 8, 5, `${site.id.toUpperCase()} LABELLING AID ${part + 1}: PHOTO AS IS | SHADOWS LIFTED (GAMMA ${AID.gamma}) | RAW 8 M PIXELS | WIDER CROP ${AID.wideM} M; YELLOW BOX = 90 M; CROP 270 M, NORTH UP; NO ESTIMATOR DATA`, INK);
  list.forEach((t, n) => {
    const x0 = 8 + (n % AID.cols) * (tileW + 8);
    const y0 = 20 + Math.floor(n / AID.cols) * (tileH + 8);
    fillRect(img, x0, y0, tileW, tileH, [226, 226, 220]);
    drawText(img, x0 + 3, y0 + 1, t.id, INK, 2, true);
    blit(img, photoPanel(site, t.x, t.y, AID.panel, 1), x0, y0 + 16);
    blit(img, photoPanel(site, t.x, t.y, AID.panel, AID.gamma), x0 + AID.panel + 3, y0 + 16);
    blit(img, photoPanel(site, t.x, t.y, AID.panel, 1, true), x0 + 2 * (AID.panel + 3), y0 + 16);
    blit(img, photoPanel(site, t.x, t.y, AID.panel, 1, false, AID.wideM), x0 + 3 * (AID.panel + 3), y0 + 16);
  });
  return img;
}

function renderSheet(site: SiteData, tiles: Tile[], numbers: boolean): Rgb {
  const S = SHEET;
  const tileW = 2 * S.panel + S.panelGap;
  const foot = numbers ? 3 * S.footLine + 3 : 3;
  const tileH = S.header + S.panel + foot;
  const rows = Math.ceil(tiles.length / S.cols);
  const W = 2 * S.margin + S.cols * tileW + (S.cols - 1) * S.gap;
  const H = S.titleH + S.margin + rows * (tileH + S.gap);
  const img = newRgb(W, H, PAPER);
  const title = `${site.id.toUpperCase()}  ${numbers ? 'WITH ESTIMATOR NUMBERS (FOR THE RECORD)' : 'BLIND SHEET (NO ESTIMATOR NUMBERS)'}  SEED ${CONFIG.seed}  PHOTO (C) SPATIAL SERVICES NSW CC BY 4.0`;
  drawText(img, S.margin, 3, title, INK);
  // slope legend
  let lx = S.margin;
  drawText(img, lx, 15, 'SLOPE 10 M:', INK);
  lx += 6 * 11 + 4;
  for (const [deg, label] of [[10, '<20'], [27, '20-35'], [40, '35-45'], [50, '45-55'], [60, '55-65'], [72, '>65']] as const) {
    const c = slopeColour(deg);
    fillRect(img, lx, 15, 10, 7, [Math.round(c[0] * 0.86), Math.round(c[1] * 0.86), Math.round(c[2] * 0.86)]);
    lx = drawText(img, lx + 12, 15, label, INK) + 6;
  }
  drawText(img, lx + 6, 15, 'DEG.  YELLOW BOX = 3X3 FIRE CELLS (90 M), CROP 270 M, NORTH UP', INK);
  tiles.forEach((t, n) => {
    const col = n % S.cols;
    const row = Math.floor(n / S.cols);
    const x0 = S.margin + col * (tileW + S.gap);
    const y0 = S.titleH + S.margin + row * (tileH + S.gap);
    fillRect(img, x0, y0, tileW, tileH, [226, 226, 220]);
    drawText(img, x0 + 3, y0 + 1, t.id, INK, 2, true);
    drawText(img, x0 + tileW - 6 * 10 - 4, y0 + 5, 'N UP 270 M', [90, 90, 90]);
    blit(img, photoPanel(site, t.x, t.y), x0, y0 + S.header);
    blit(img, slopePanel(site, t.x, t.y), x0 + S.panel + S.panelGap, y0 + S.header);
    if (numbers) {
      tileNumbers(t).forEach((line, q) => drawText(img, x0 + 2, y0 + S.header + S.panel + 3 + q * S.footLine, line, INK));
    }
  });
  return img;
}

// ─────────────────────────────────────────────────────────────────────────────
// Registration check: does the photo line up with the 10 m terrain?
// ─────────────────────────────────────────────────────────────────────────────

interface Registration {
  az: number;
  alt: number;
  corr0: number;
  best: { dx: number; dy: number; corr: number };
  pixels: number;
}

/**
 * Photo luminance against a hillshade made from the 10 m terrain, over pixels steeper than 15 degrees. The sun direction
 * is searched first (zero shift), then the shift (+/-6 photo pixels) that maximises the correlation. A peak away from
 * (0, 0) would mean the photo and the terrain are offset by that many photo pixels (8 m each); dx > 0 is the photo
 * content lying to the east of the terrain feature that shades it, dy > 0 to the north.
 */
function registrationCheck(site: SiteData): Registration {
  const n = site.photo.w;
  const cell = site.photoCell;
  const half = DEMO_EXTENT / 2;
  const g8: GridSpec = { nx: n, ny: n, cellSize: cell, x0: -half + cell / 2, y0: -half + cell / 2, origin: { lat: 0, lon: 0 } };
  const z8 = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) z8[j * n + i] = sampleBilinear(site.hiGrid, site.elevation, g8.x0 + i * cell, g8.y0 + j * cell);
  const lum = flipRows(site.lum, n);
  const sl = slopeDegOf(g8, z8);
  const M = 8;
  const corr = (hs: Float32Array, dx: number, dy: number): { r: number; n: number } => {
    let sa = 0;
    let sb = 0;
    let saa = 0;
    let sbb = 0;
    let sab = 0;
    let cnt = 0;
    for (let j = M; j < n - M; j += 2) {
      for (let i = M; i < n - M; i += 2) {
        const k = j * n + i;
        if (sl[k]! < 15) continue;
        const a = hs[k]!;
        const b = lum[(j + dy) * n + i + dx]!;
        sa += a;
        sb += b;
        saa += a * a;
        sbb += b * b;
        sab += a * b;
        cnt++;
      }
    }
    const cov = sab / cnt - (sa / cnt) * (sb / cnt);
    const va = saa / cnt - (sa / cnt) ** 2;
    const vb = sbb / cnt - (sb / cnt) ** 2;
    return { r: cov / Math.sqrt(Math.max(1e-12, va * vb)), n: cnt };
  };
  let bestAz = 0;
  let bestAlt = 0;
  let bestR = -2;
  let pixels = 0;
  for (let az = 0; az < 360; az += 22.5) {
    for (const alt of [25, 40, 55]) {
      const c = corr(hillshadeOf(g8, z8, az, alt), 0, 0);
      if (c.r > bestR) {
        bestR = c.r;
        bestAz = az;
        bestAlt = alt;
        pixels = c.n;
      }
    }
  }
  const hs = hillshadeOf(g8, z8, bestAz, bestAlt);
  const best = { dx: 0, dy: 0, corr: -2 };
  for (let dy = -6; dy <= 6; dy++) {
    for (let dx = -6; dx <= 6; dx++) {
      const c = corr(hs, dx, dy).r;
      if (c > best.corr) Object.assign(best, { dx, dy, corr: c });
    }
  }
  return { az: bestAz, alt: bestAlt, corr0: bestR, best, pixels };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoring against the labels
// ─────────────────────────────────────────────────────────────────────────────

interface LTile extends Tile {
  label: Label;
  evidence: string;
  confidence: 'high' | 'low';
}
type Group = 'rock' | 'rock-gentle' | 'mixed' | 'veg-steep' | 'veg-gentle' | 'chute' | 'unsure';
const GROUPS: readonly Group[] = ['rock', 'rock-gentle', 'mixed', 'veg-steep', 'veg-gentle', 'chute', 'unsure'];
const PRED_COLS = ['wall', 'partial', 'chute', 'none'] as const;
type Pred = (typeof PRED_COLS)[number];
type Status = 'pass' | 'fail' | 'inconclusive' | 'not testable';

const isWallTile = (e: TileEst): boolean => e.nW >= CONFIG.wallCellsMin;
const hasChute = (e: TileEst): boolean => e.nC >= CONFIG.chuteCellsMin;
const isPartialTile = (e: TileEst): boolean => !isWallTile(e) && e.nW + e.nP >= CONFIG.partialCellsMin;
const predOf = (e: TileEst): Pred => (hasChute(e) ? 'chute' : isWallTile(e) ? 'wall' : isPartialTile(e) ? 'partial' : 'none');
const groupOf = (t: LTile): Group => {
  const steep = t.steep >= CRITERIA.minPatchSteep;
  if (t.label === 'veg') return steep ? 'veg-steep' : 'veg-gentle';
  if (t.label === 'rock') return steep ? 'rock' : 'rock-gentle';
  return t.label;
};
const CELLS = CONFIG.patchCells * CONFIG.patchCells;

/** Mann-Whitney AUC: the chance that a random positive tile outranks a random negative one (ties count half). */
function auc(pos: number[], neg: number[]): number | null {
  if (!pos.length || !neg.length) return null;
  let s = 0;
  for (const p of pos) for (const q of neg) s += p > q ? 1 : p === q ? 0.5 : 0;
  return s / (pos.length * neg.length);
}

interface Score {
  est: EstId;
  groups: Record<Group, LTile[]>;
  confusion: Record<Group, Record<Pred, number>>;
  g1: { status: Status; tilesK: number; tilesN: number; cellsK: number; cellsN: number };
  g2: { status: Status; k: number; n: number };
  g3a: { status: Status; k: number; n: number };
  g3b: { status: Status; k: number; n: number };
  verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE';
  tp: number;
  wallRockAll: number;
  fpOther: number;
  fpMixed: number;
  partialStrict: { k: number; n: number };
  partialLenient: { k: number; n: number };
  controlWallCells: number;
  controlWallTiles: number;
  auc: number | null;
  wallCellsByGroup: Record<Group, number>;
}

function score(tiles: LTile[], est: EstId): Score {
  const C = CRITERIA;
  const groups = Object.fromEntries(GROUPS.map((g) => [g, [] as LTile[]])) as Record<Group, LTile[]>;
  for (const t of tiles) groups[groupOf(t)].push(t);
  const confusion = Object.fromEntries(GROUPS.map((g) => [g, { wall: 0, partial: 0, chute: 0, none: 0 }])) as Record<Group, Record<Pred, number>>;
  const wallCellsByGroup = Object.fromEntries(GROUPS.map((g) => [g, 0])) as Record<Group, number>;
  for (const g of GROUPS) {
    for (const t of groups[g]) {
      confusion[g][predOf(t.est[est])]++;
      wallCellsByGroup[g] += t.est[est].nW;
    }
  }
  const vs = groups['veg-steep'];
  const rs = groups.rock;
  const cs = groups.chute;
  const ms = groups.mixed;
  const g1Tiles = vs.filter((t) => isWallTile(t.est[est])).length;
  const g1Cells = vs.reduce((s, t) => s + t.est[est].nW, 0);
  const g1: Score['g1'] = { status: 'inconclusive', tilesK: g1Tiles, tilesN: vs.length, cellsK: g1Cells, cellsN: vs.length * CELLS };
  if (vs.length >= C.G1_falseWall.minTiles) g1.status = g1Tiles / vs.length <= C.G1_falseWall.maxWallTileShare && g1Cells / (vs.length * CELLS) <= C.G1_falseWall.maxWallCellShare ? 'pass' : 'fail';
  const g2k = rs.filter((t) => isWallTile(t.est[est])).length;
  const g2: Score['g2'] = { status: 'inconclusive', k: g2k, n: rs.length };
  if (rs.length >= C.G2_wallRecall.minTiles) g2.status = g2k / rs.length >= C.G2_wallRecall.minWallTileShare ? 'pass' : 'fail';
  const g3ak = rs.filter((t) => hasChute(t.est[est])).length;
  const g3a: Score['g3a'] = { status: 'inconclusive', k: g3ak, n: rs.length };
  if (rs.length >= C.G2_wallRecall.minTiles) g3a.status = g3ak / rs.length <= C.G3_chutes.maxChuteInRockTileShare ? 'pass' : 'fail';
  const g3bk = cs.filter((t) => hasChute(t.est[est])).length;
  const g3b: Score['g3b'] = { status: 'not testable', k: g3bk, n: cs.length };
  if (cs.length >= C.G3_chutes.minChuteTilesToJudgeRecall) g3b.status = g3bk / cs.length >= C.G3_chutes.minChuteTileShare ? 'pass' : 'fail';
  const all = [g1.status, g2.status, g3a.status, g3b.status];
  const verdict = all.includes('fail') ? 'FAIL' : [g1.status, g2.status, g3a.status].every((s) => s === 'pass') && (g3b.status === 'pass' || g3b.status === 'not testable') ? 'PASS' : 'INCONCLUSIVE';
  const wallOf = (g: Group): number => groups[g].filter((t) => isWallTile(t.est[est])).length;
  const key = (t: LTile): number => (est === 'E0' ? t.est[est].nW : t.est[est].rockMean);
  return {
    est,
    groups,
    confusion,
    g1,
    g2,
    g3a,
    g3b,
    verdict,
    tp: g2k,
    wallRockAll: wallOf('rock') + wallOf('rock-gentle'),
    fpOther: wallOf('veg-steep') + wallOf('veg-gentle') + wallOf('chute'),
    fpMixed: wallOf('mixed'),
    partialStrict: { k: ms.filter((t) => predOf(t.est[est]) === 'partial').length, n: ms.length },
    partialLenient: { k: ms.filter((t) => isPartialTile(t.est[est]) || isWallTile(t.est[est])).length, n: ms.length },
    controlWallCells: groups['veg-gentle'].reduce((s, t) => s + t.est[est].nW, 0),
    controlWallTiles: wallOf('veg-gentle'),
    auc: auc(rs.map(key), vs.map(key)),
    wallCellsByGroup,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// results.md
// ─────────────────────────────────────────────────────────────────────────────

function table(head: string[], rows: (string | number)[][]): string {
  const lines = [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];
  for (const r of rows) lines.push(`| ${r.join(' | ')} |`);
  return lines.join('\n');
}

interface SiteRun {
  site: SiteData;
  tiles: Tile[];
  notes: string[];
  reg: Registration;
}

function gridCounts(site: SiteData, est: EstId): { wall: number; partial: number; chute: number; n: number } {
  const cls = site.est[est].cls;
  let wall = 0;
  let partial = 0;
  let chute = 0;
  for (let k = 0; k < cls.length; k++) {
    if (cls[k] === CLS_WALL) wall++;
    else if (cls[k] === CLS_PARTIAL) partial++;
    else if (cls[k] === CLS_CHUTE) chute++;
  }
  return { wall, partial, chute, n: cls.length };
}

function planChecks(site: SiteData, est: EstId): { wallShare: number; wallHighCover: number; drain35: { n: number; pass: number }; drainSteep: { n: number; pass: number } } {
  const cls = site.est[est].cls;
  let wall = 0;
  let wallHigh = 0;
  const d35 = { n: 0, pass: 0 };
  const dst = { n: 0, pass: 0 };
  for (let k = 0; k < cls.length; k++) {
    const isWall = cls[k] === CLS_WALL;
    if (isWall) {
      wall++;
      if (site.coverFire[k]! > 0.6) wallHigh++;
    }
    if (site.features.drainage[k] === 1) {
      if (site.terrain.slopeDeg[k]! >= 35) {
        d35.n++;
        if (!isWall) d35.pass++;
      }
      if (site.steep[k]! >= 0.2) {
        dst.n++;
        if (!isWall) dst.pass++;
      }
    }
  }
  return { wallShare: wall / cls.length, wallHighCover: wallHigh, drain35: d35, drainSteep: dst };
}

type LabelMap = Record<string, { label: Label; evidence: string; confidence: 'high' | 'low' }>;

function readLabels(): LabelMap | null {
  const p = join(OUT_DIR, 'labels.json');
  if (!existsSync(p)) return null;
  const j = JSON.parse(readFileSync(p, 'utf8')) as { labels?: Record<string, { label?: string; evidence?: string; confidence?: string }> };
  const out: LabelMap = {};
  for (const [id, v] of Object.entries(j.labels ?? {})) {
    if (!v.label || !(LABELS as readonly string[]).includes(v.label)) throw new Error(`labels.json: ${id} has the label ${String(v.label)}`);
    out[id] = { label: v.label as Label, evidence: v.evidence ?? '', confidence: v.confidence === 'low' ? 'low' : 'high' };
  }
  return out;
}

const pctOf = (k: number, n: number): string => (n ? `${((100 * k) / n).toFixed(2)} %` : 'n/a');
const cellPct = (k: number, n: number): string => `${k} (${pctOf(k, n)})`;

function resultsMarkdown(runs: SiteRun[], labels: LabelMap): string {
  const out: string[] = [];
  const P = (s = ''): void => void out.push(s);
  const allTiles: LTile[] = [];
  const missing: string[] = [];
  for (const r of runs) {
    for (const t of r.tiles) {
      const l = labels[t.id];
      if (!l) missing.push(t.id);
      else allTiles.push({ ...t, label: l.label, evidence: l.evidence, confidence: l.confidence });
    }
  }
  if (missing.length) throw new Error(`labels.json has no label for ${missing.join(', ')}`);

  P('# S6 results: bare-rock estimators against hand-checked patches');
  P();
  P('Generated by `tests/spikes/rockEstimators.spike.test.ts` (run: `FIRESIM_SPIKE=1 nice -n 10 npx vitest run tests/spikes/rockEstimators.spike.test.ts`). Do not edit by hand.');
  P();
  P(`Settings hash (CONFIG and CRITERIA of the harness): \`${configHash()}\`. Seed ${CONFIG.seed}. Fire cell ${CONFIG.fireCellM} m. Sites: ${runs.map((r) => r.site.id).join(', ')}.`);
  P();
  P('Data, all read with the app\'s own loaders from `public/demo/<site>/` (offline):');
  P();
  P(table(['site', 'terrain', 'canopy', 'aerial photo'], runs.map((r) => [r.site.id, r.site.demNote, r.site.canopyNote, r.site.photoNote])));
  P();
  P('Labels are one rater (an AI) looking at 8 m aerial photos, not an expert survey. Every percentage carries its counts; 20 tiles per site means wide error bars (Wilson 95 % intervals where shown).');
  P();

  P('## 0. Label rules (fixed before the first tile was looked at)');
  P();
  for (const [k, v] of Object.entries(CRITERIA.labelRules)) P(`- **${k}**: ${v}`);
  P();

  // 1. E3 thresholds
  P('## 1. E3 greenness threshold (set from the photo and the reference forest, before any label existed)');
  P();
  P(`Index: ExG = 2g - r - b on chromatic coordinates (r, g, b divided by their sum). A photo pixel is vegetation when ExG > T. T = the ${CONFIG.green.quantile * 100} % quantile of ExG over the photo pixels in the reference forest of the same photo: fire cells with 30 m slope ${CONFIG.green.refSlopeLoDeg} to ${CONFIG.green.refSlopeHiDeg} degrees, canopy cover >= ${CONFIG.green.refCoverMin} and no 10 m sub-cell at ${CONFIG.rockSlopeDeg} degrees or more. Deficit = median - T.`);
  P();
  P(
    table(
      ['site', 'reference cells', 'reference pixels', 'median ExG', 'T', 'deficit', 'T x 0.8', 'T x 1.2', 'deficit x 0.8 gives T', 'deficit x 1.2 gives T'],
      runs.map((r) => {
        const g = r.site.green;
        return [r.site.id, g.refCells, g.refPixels, g.median.toFixed(4), g.T.toFixed(4), g.delta.toFixed(4), (g.T * 0.8).toFixed(4), (g.T * 1.2).toFixed(4), (g.median - 0.8 * g.delta).toFixed(4), (g.median - 1.2 * g.delta).toFixed(4)];
      }),
    ),
  );
  P();
  P('Where T is near zero, "T x 0.8" and "T x 1.2" barely move it, so the deficit rows are the meaningful +/-20 % test.');
  P();

  // 2. Whole-grid shares
  P('## 2. Whole fire grid (30 m cells): wall, partial and chute cells per estimator');
  P();
  for (const r of runs) {
    P(`### ${r.site.id} (${r.site.nx} x ${r.site.ny} = ${r.site.nx * r.site.ny} cells)`);
    P();
    P(
      table(
        ['estimator', 'wall', 'partial', 'chute', 'rock >= 0.1 (wall + partial + chute)'],
        ([...MAIN_EST, 'E2c', 'E3c', 'E23c', 'E3T80', 'E3T120', 'E3D80', 'E3D120'] as EstId[]).map((e) => {
          const c = gridCounts(r.site, e);
          return [EST_NAME[e], cellPct(c.wall, c.n), cellPct(c.partial, c.n), cellPct(c.chute, c.n), cellPct(c.wall + c.partial + c.chute, c.n)];
        }),
      ),
    );
    P();
  }
  P('E1 at other slope thresholds (the 55 degree value is the plan guess):');
  P();
  P(
    table(
      ['site', 'threshold', 'wall', 'partial', 'chute'],
      runs.flatMap((r) => {
        const n = r.site.nx * r.site.ny;
        const c55 = gridCounts(r.site, 'E1');
        return [
          ...r.site.e1Sens.filter((s) => s.deg < CONFIG.rockSlopeDeg).map((s) => [r.site.id, `${s.deg} deg`, cellPct(s.wall, n), cellPct(s.partial, n), cellPct(s.chute, n)]),
          [r.site.id, `${CONFIG.rockSlopeDeg} deg (plan)`, cellPct(c55.wall, n), cellPct(c55.partial, n), cellPct(c55.chute, n)],
          ...r.site.e1Sens.filter((s) => s.deg > CONFIG.rockSlopeDeg).map((s) => [r.site.id, `${s.deg} deg`, cellPct(s.wall, n), cellPct(s.partial, n), cellPct(s.chute, n)]),
        ];
      }),
    ),
  );
  P();

  // 3. Plan acceptance numbers
  P('## 3. The plan\'s acceptance numbers (9d.6), re-checked');
  P();
  P('Plan: wall share at Katoomba about 1.5 to 3.5 % (today 3.3 %); no wall cell with canopy cover above 0.6; at least 90 % of steep drainage cells passable. "Steep drainage cell" is not defined in the plan; two definitions are shown: drainage cells with 30 m slope >= 35 degrees, and drainage cells with steepFraction >= 0.2. Passable = not a wall (a chute or a partial cell is passable).');
  P();
  for (const r of runs) {
    P(`### ${r.site.id}`);
    P();
    P(
      table(
        ['estimator', 'wall share', 'wall cells with cover > 0.6', 'steep drainage (slope >= 35) passable', 'steep drainage (steepFraction >= 0.2) passable'],
        (MAIN_EST as readonly EstId[]).map((e) => {
          const c = planChecks(r.site, e);
          return [EST_NAME[e], `${(100 * c.wallShare).toFixed(2)} %`, c.wallHighCover, share(c.drain35.pass, c.drain35.n), share(c.drainSteep.pass, c.drainSteep.n)];
        }),
      ),
    );
    P();
  }

  // 3b. What each estimator opens of today's walls
  P('## 3b. What each estimator does to today\'s wall cells (whole fire grid, no labels)');
  P();
  P('Of the cells E0 (today) calls a wall: how many the estimator still calls a wall, and how many it opens (partial, chute or none). "Very steep" = at least 25 % of the cell\'s 10 m sub-cells at 65 degrees or more. Cells opened while very steep are where the estimator trusts the canopy or the photo over the terrain: if those are real cliffs under trees or in shadow, they become passable.');
  P();
  const openRows: (string | number)[][] = [];
  for (const r of runs) {
    const e0 = r.site.est.E0.cls;
    for (const e of ['F', 'E1', 'E2', 'E3', 'E23'] as const) {
      const cls = r.site.est[e].cls;
      let kept = 0;
      let opened = 0;
      let openedVery = 0;
      for (let k = 0; k < e0.length; k++) {
        if (e0[k] !== CLS_WALL) continue;
        if (cls[k] === CLS_WALL) kept++;
        else {
          opened++;
          if (r.site.steep65Cell[k]! >= 0.25) openedVery++;
        }
      }
      openRows.push([r.site.id, EST_NAME[e], kept + opened, cellPct(kept, kept + opened), cellPct(opened, kept + opened), cellPct(openedVery, opened)]);
    }
  }
  P(table(['site', 'estimator', "E0's wall cells", 'still wall', 'opened', 'of the opened, very steep'], openRows));
  P();

  // 4. The sample
  P('## 4. The sample: 20 tiles per site chosen from the numbers, then labelled by eye from the photo');
  P();
  P(`Strata: high = mean steepFraction over the 3 x 3 patch >= ${CONFIG.highMinSteep}; mid = ${CONFIG.midMinSteep} to ${CONFIG.highMinSteep}; disagree = steep patches (mean steepFraction >= ${CONFIG.disagreeMinSteep}) where E1, E2 and E3 disagree most (two by the range of the three patch means, two by |E2 - E3|); control = gentle forest (steepFraction < ${CONFIG.controlMaxSteep}, slope < ${CONFIG.controlMaxSlopeDeg} degrees, cover >= ${CONFIG.controlMinCover}). Centres at least ${CONFIG.minSepCells} cells (${CONFIG.minSepCells * CONFIG.fireCellM} m) apart.`);
  P();
  for (const r of runs) for (const n of r.notes) P(`- ${r.site.id}: ${n}`);
  if (runs.some((r) => r.notes.length)) P();
  P(
    table(
      ['id', 'stratum', 'centre lat, lon', 'cell i,j', 'steep', 'share >= 65 deg', 'steepest 10 m', 'cover', 'photo veg', 'photo ExG', 'photo lum', 'slope 30 m', 'E1 rock', 'E2 rock', 'E3 rock', 'label', 'confidence', 'evidence'],
      allTiles.map((t) => [
        t.id,
        t.stratum + (t.kind ? ` (${t.kind})` : ''),
        `${t.lat.toFixed(5)}, ${t.lon.toFixed(5)}`,
        `${t.ci},${t.cj}`,
        t.steep.toFixed(2),
        t.steep65.toFixed(2),
        t.max10.toFixed(0),
        t.cover.toFixed(2),
        t.veg.toFixed(2),
        t.exgMean.toFixed(3),
        t.lumMean.toFixed(0),
        t.slope.toFixed(0),
        t.est.E1.rockMean.toFixed(2),
        t.est.E2.rockMean.toFixed(2),
        t.est.E3.rockMean.toFixed(2),
        t.label,
        t.confidence,
        t.evidence.replace(/\|/g, '/'),
      ]),
    ),
  );
  P();
  P('### Label counts');
  P();
  const lc = (ts: LTile[]): (string | number)[] => [...(LABELS as readonly Label[]).map((l) => ts.filter((t) => t.label === l).length), ts.length];
  P(table(['group', ...LABELS, 'tiles'], [...runs.map((r) => [r.site.id, ...lc(allTiles.filter((t) => t.site === r.site.id))]), ['all', ...lc(allTiles)]]));
  P();
  P(table(['stratum', ...LABELS, 'tiles'], (['high', 'mid', 'disagree', 'control'] as Stratum[]).map((s) => [s, ...lc(allTiles.filter((t) => t.stratum === s))])));
  P();

  // 5. Scoring
  const scores: Partial<Record<EstId, Score>> = {};
  for (const e of EST_IDS) scores[e] = score(allTiles, e);
  const S = (e: EstId): Score => scores[e]!;
  P('## 5. Scoring against the labels (all four sites pooled)');
  P();
  P(`Tile rules: wall tile = at least ${CONFIG.wallCellsMin} of the 9 cells are wall; partial tile = not a wall tile and wall + partial cells >= ${CONFIG.partialCellsMin}; chute tile = at least ${CONFIG.chuteCellsMin} chute cell. "Steep" tiles have a patch-mean steepFraction >= ${CRITERIA.minPatchSteep}: "veg (steep)" and "rock" are the tiles the gates are judged on; "veg (gentle)" and "rock (gentle)" are the labelled tiles below that steepness.`);
  P();
  P('### 5.1 The gates');
  P();
  P(`G1 false walls: of the veg (steep) tiles at most ${100 * CRITERIA.G1_falseWall.maxWallTileShare} % are wall tiles and at most ${100 * CRITERIA.G1_falseWall.maxWallCellShare} % of their cells are wall cells (needs >= ${CRITERIA.G1_falseWall.minTiles} such tiles).`);
  P(`G2 wall recall: of the rock (steep) tiles at least ${100 * CRITERIA.G2_wallRecall.minWallTileShare} % are wall tiles (needs >= ${CRITERIA.G2_wallRecall.minTiles} rock tiles).`);
  P(`G3 chutes: (a) at most ${100 * CRITERIA.G3_chutes.maxChuteInRockTileShare} % of rock (steep) tiles hold a chute cell; (b) at least ${100 * CRITERIA.G3_chutes.minChuteTileShare} % of chute tiles hold a chute cell, judged only with >= ${CRITERIA.G3_chutes.minChuteTilesToJudgeRecall} chute tiles, otherwise "not testable".`);
  P();
  P(
    table(
      ['estimator', 'G1 veg(steep) wall tiles', 'G1 wall cells', 'G1', 'G2 rock tiles that are wall', 'G2', 'G3a rock tiles with a chute', 'G3a', 'G3b chute tiles with a chute', 'G3b', 'verdict'],
      (EST_IDS as readonly EstId[]).map((e) => {
        const s = S(e);
        return [EST_NAME[e], shareCi(s.g1.tilesK, s.g1.tilesN), shareCi(s.g1.cellsK, s.g1.cellsN), s.g1.status, shareCi(s.g2.k, s.g2.n), s.g2.status, shareCi(s.g3a.k, s.g3a.n), s.g3a.status, share(s.g3b.k, s.g3b.n), s.g3b.status, `**${s.verdict}**`];
      }),
    ),
  );
  P();
  P('### 5.2 Wall precision and recall, partial agreement, ranking power');
  P();
  P(
    table(
      ['estimator', 'wall recall on rock (steep)', 'wall precision (strict: wall tiles that are rock, steep or gentle)', 'wall tiles that are mixed', 'wall tiles on veg or chute tiles (false walls)', 'mixed tiles called partial', 'mixed tiles called partial or wall', 'veg (gentle) tiles with a wall cell', 'AUC rock vs veg (steep)'],
      (EST_IDS as readonly EstId[]).map((e) => {
        const s = S(e);
        const wallTiles = s.wallRockAll + s.fpOther + s.fpMixed;
        return [EST_NAME[e], share(s.tp, s.groups.rock.length), share(s.wallRockAll, wallTiles), `${s.fpMixed}`, `${s.fpOther}`, share(s.partialStrict.k, s.partialStrict.n), share(s.partialLenient.k, s.partialLenient.n), `${s.controlWallCells} cells in ${s.controlWallTiles} tiles`, s.auc === null ? 'n/a' : s.auc.toFixed(2)];
      }),
    ),
  );
  P();
  P('AUC is threshold free: 1.0 = every rock tile has a higher patch-mean rock value (E0: wall cell count) than every veg (steep) tile, 0.5 = no information.');
  P();
  P('### 5.3 Confusion matrices (rows: my label; columns: what the estimator calls the tile)');
  P();
  for (const e of MAIN_EST) {
    const s = S(e);
    P(`**${EST_NAME[e]}**`);
    P();
    P(
      table(
        ['label', 'wall', 'partial', 'chute', 'none', 'tiles'],
        GROUPS.map((g) => [g, s.confusion[g].wall, s.confusion[g].partial, s.confusion[g].chute, s.confusion[g].none, s.groups[g].length]),
      ),
    );
    P();
  }
  P('### 5.4 Per site (counts; gates are judged on the pooled tiles only)');
  P();
  const perSite: (string | number)[][] = [];
  for (const r of runs) {
    const ts = allTiles.filter((t) => t.site === r.site.id);
    for (const e of MAIN_EST) {
      const s = score(ts, e);
      perSite.push([r.site.id, EST_NAME[e], `${s.g1.tilesK}/${s.g1.tilesN}`, `${s.g1.cellsK}/${s.g1.cellsN}`, `${s.g2.k}/${s.g2.n}`, `${s.g3a.k}/${s.g3a.n}`, `${s.g3b.k}/${s.g3b.n}`]);
    }
  }
  P(table(['site', 'estimator', 'veg(steep) wall tiles', 'veg(steep) wall cells', 'rock tiles that are wall', 'rock tiles with a chute', 'chute tiles with a chute'], perSite));
  P();

  P('### 5.5 The same gates on the high-confidence labels only (sensitivity to my own doubt)');
  P();
  const hc = allTiles.filter((t) => t.confidence === 'high');
  P(`High-confidence tiles: ${hc.length} of ${allTiles.length}.`);
  P();
  P(
    table(
      ['estimator', 'G1 veg(steep) wall tiles', 'G1 wall cells', 'G1', 'G2 rock tiles that are wall', 'G2', 'G3a', 'verdict'],
      (MAIN_EST as readonly EstId[]).map((e) => {
        const s = score(hc, e);
        return [EST_NAME[e], shareCi(s.g1.tilesK, s.g1.tilesN), shareCi(s.g1.cellsK, s.g1.cellsN), s.g1.status, shareCi(s.g2.k, s.g2.n), s.g2.status, `${s.g3a.k}/${s.g3a.n} ${s.g3a.status}`, `**${s.verdict}**`];
      }),
    ),
  );
  P();

  P('### 5.6 Which tiles');
  P();
  P(
    table(
      ['estimator', 'veg (steep) tiles called wall (false walls)', 'rock tiles called wall', 'rock tiles not called wall', 'unsure tiles called wall', 'gentle veg tiles with any wall cell (cells)', 'control tiles with any wall cell'],
      (MAIN_EST as readonly EstId[]).map((e) => {
        const ids = (ts: LTile[]): string => ts.map((t) => t.id).join(', ') || 'none';
        const s = S(e);
        return [EST_NAME[e], ids(s.groups['veg-steep'].filter((t) => isWallTile(t.est[e]))), ids(s.groups.rock.filter((t) => isWallTile(t.est[e]))), ids(s.groups.rock.filter((t) => !isWallTile(t.est[e]))), ids(s.groups.unsure.filter((t) => isWallTile(t.est[e]))), s.groups['veg-gentle'].filter((t) => t.est[e].nW > 0).map((t) => `${t.id} (${t.est[e].nW})`).join(', ') || 'none', ids(allTiles.filter((t) => t.stratum === 'control' && t.est[e].nW > 0))];
      }),
    ),
  );
  P();

  // 6. E0 against the labels
  P('## 6. Wall cells of each estimator inside tiles of each label (the bug H-sim is meant to fix, for E0)');
  P();
  P('Counts of wall cells in the labelled sample (unsure tiles excluded from the share). The sample over-represents steep ground, so these shares describe the sample, not the whole grid.');
  P();
  const wallRows: (string | number)[][] = [];
  for (const e of MAIN_EST) {
    const s = S(e);
    const tot = GROUPS.filter((g) => g !== 'unsure').reduce((a, g) => a + s.wallCellsByGroup[g], 0);
    wallRows.push([EST_NAME[e], tot, ...(['rock', 'rock-gentle', 'mixed', 'veg-steep', 'veg-gentle', 'chute'] as Group[]).map((g) => `${s.wallCellsByGroup[g]} (${tot ? ((100 * s.wallCellsByGroup[g]) / tot).toFixed(0) : 0} %)`), s.wallCellsByGroup.unsure]);
  }
  P(table(['estimator', 'wall cells (not unsure)', 'in rock tiles (steep)', 'in rock tiles (gentle)', 'in mixed tiles', 'in veg tiles (steep)', 'in veg tiles (gentle)', 'in chute tiles', 'in unsure tiles (not counted)'], wallRows));
  P();

  // 7. Post-hoc
  P('## 7. Supplementary and post-hoc (tuned or explored AFTER the labels existed; not part of the pre-written criteria)');
  P();
  P('Threshold sweep of E3: the same estimator with T taken at other quantiles of the reference-forest ExG. A higher quantile calls more pixels bare. This shows whether any threshold could have met G1 and G2 with this photo and index. These numbers are tuned on the labels and must not be read as a result for E3.');
  P();
  const sweepRows: (string | number)[][] = [];
  for (const q of SWEEP_QUANTILES) {
    const tl: LTile[] = [];
    for (const r of runs) {
      const T = r.site.green.refQuantiles[String(q)]!;
      const { vegFire } = vegFractions(r.site.vegCtx, T);
      const rock = new Float32Array(r.site.steep.length);
      for (let k = 0; k < rock.length; k++) rock[k] = r.site.steep[k]! * (1 - vegFire[k]!);
      const cls = classify(rock, r.site.features.drainage, r.site.features.trench);
      for (const t of allTiles.filter((x) => x.site === r.site.id)) {
        let nW = 0;
        let nP = 0;
        let nC = 0;
        let sum = 0;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const k = (t.cj + dj) * r.site.nx + t.ci + di;
            sum += rock[k]!;
            if (cls[k] === CLS_WALL) nW++;
            else if (cls[k] === CLS_PARTIAL) nP++;
            else if (cls[k] === CLS_CHUTE) nC++;
          }
        }
        tl.push({ ...t, est: { ...t.est, E3: { rockMean: sum / 9, nW, nP, nC } } });
      }
    }
    const s = score(tl, 'E3');
    sweepRows.push([q, s.g1.status === 'inconclusive' ? 'n/a' : shareCi(s.g1.tilesK, s.g1.tilesN), shareCi(s.g1.cellsK, s.g1.cellsN), shareCi(s.g2.k, s.g2.n), s.auc === null ? 'n/a' : s.auc.toFixed(2), runs.map((r) => `${r.site.id} ${r.site.green.refQuantiles[String(q)]!.toFixed(3)}`).join(', ')]);
  }
  P(table(['quantile of reference ExG used as T', 'veg(steep) wall tiles', 'veg(steep) wall cells', 'rock tiles that are wall', 'AUC (same for all T up to ties)', 'T per site'], sweepRows));
  P();
  P('Steep veg tiles that an estimator calls a wall, split by how cliff-like the patch is (share of 10 m sub-cells at 65 degrees or more). A "veg" label comes from what the photo shows from above; a near-vertical face has almost no area from above, so a wall tile with many 65 degree cells under trees may still be a real cliff.');
  P();
  const vsAll = allTiles.filter((t) => groupOf(t) === 'veg-steep');
  P(
    table(
      ['estimator', 'veg (steep) tiles', 'wall tiles', 'of which share >= 65 deg is 0.2 or more', 'of which less than 0.2'],
      (MAIN_EST as readonly EstId[]).map((e) => {
        const w = vsAll.filter((t) => isWallTile(t.est[e]));
        return [EST_NAME[e], vsAll.length, w.length, w.filter((t) => t.steep65 >= 0.2).length, w.filter((t) => t.steep65 < 0.2).length];
      }),
    ),
  );
  P();
  P('Steep forest proper: the veg (steep) tiles with a cliff-like share (10 m sub-cells at 65 degrees or more) under 0.2, so slopes of 55 to 65 degrees under vegetation, where a wall is least likely to be right. The G1 rates again on that subset only (tuned on nothing, but chosen after the labels existed):');
  P();
  const forest = vsAll.filter((t) => t.steep65 < 0.2);
  P(
    table(
      ['estimator', 'tiles', 'wall tiles', 'wall cells'],
      (MAIN_EST as readonly EstId[]).map((e) => [EST_NAME[e], forest.length, shareCi(forest.filter((t) => isWallTile(t.est[e])).length, forest.length), shareCi(forest.reduce((a, t) => a + t.est[e].nW, 0), forest.length * CELLS)]),
    ),
  );
  P();
  P('Which way the ground faces (steepFraction-weighted compass octant of the downhill direction), for the unsure tiles (deep shadow) against all tiles. The best-matching sun for the photo shading is in the north-west at all four sites (section 8), so faces turned away from it, to the south-east and east, are the ones in shadow:');
  P();
  const octs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const oct = (a: number): number => (Number.isFinite(a) ? Math.round(a / 45) % 8 : -1);
  P(
    table(
      ['facing', ...octs],
      [
        ['all 80 tiles', ...octs.map((_, i) => allTiles.filter((t) => oct(t.facing) === i).length)],
        ['unsure tiles', ...octs.map((_, i) => allTiles.filter((t) => t.label === 'unsure' && oct(t.facing) === i).length)],
        ['rock tiles', ...octs.map((_, i) => allTiles.filter((t) => t.label === 'rock' && oct(t.facing) === i).length)],
      ],
    ),
  );
  P();
  P('Mean photo colour and canopy by label group (tile means; ExG and luminance are over the photo pixels inside the 90 m box; "photo vegetation share" is the share of pixels with ExG > T):');
  P();
  const meanOf = (ts: LTile[], f: (t: LTile) => number, d = 2): string => (ts.length ? (ts.reduce((s, t) => s + f(t), 0) / ts.length).toFixed(d) : 'n/a');
  P(
    table(
      ['label group', 'tiles', 'mean steep', 'mean share >= 65 deg', 'mean canopy cover', 'mean photo vegetation share', 'mean ExG', 'mean luminance', 'mean E2 rock', 'mean E3 rock'],
      GROUPS.map((g) => {
        const ts = allTiles.filter((t) => groupOf(t) === g);
        return [g, ts.length, meanOf(ts, (t) => t.steep), meanOf(ts, (t) => t.steep65), meanOf(ts, (t) => t.cover), meanOf(ts, (t) => t.veg), meanOf(ts, (t) => t.exgMean, 3), meanOf(ts, (t) => t.lumMean, 0), meanOf(ts, (t) => t.est.E2.rockMean), meanOf(ts, (t) => t.est.E3.rockMean)];
      }),
    ),
  );
  P();

  // 8. Registration
  P('## 8. Registration check: photo against the 10 m terrain');
  P();
  P('Photo luminance against a hillshade of the 10 m terrain, over pixels steeper than 15 degrees. Sun direction searched first, then the shift in photo pixels (8 m) of the best correlation. A best shift of (0, 0) means no offset can be seen at this scale.');
  P();
  P(table(['site', 'best sun azimuth / altitude (deg)', 'correlation with no shift', 'best shift dx, dy (px)', 'correlation at best shift', 'pixels used (every 2nd)'], runs.map((r) => [r.site.id, `${r.reg.az} / ${r.reg.alt}`, r.reg.corr0.toFixed(3), `${r.reg.best.dx}, ${r.reg.best.dy}`, r.reg.best.corr.toFixed(3), r.reg.pixels])));
  P();
  return out.join('\n') + '\n';
}

// ─────────────────────────────────────────────────────────────────────────────
// The spike
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!SPIKE)('S6 rock estimators (spike, FIRESIM_SPIKE=1)', () => {
  const runs: SiteRun[] = [];

  it('the JPEG encoder round-trips through the geotiff decoder', async () => {
    const img = newRgb(131, 77);
    for (let j = 0; j < img.h; j++) {
      for (let i = 0; i < img.w; i++) {
        const o = (j * img.w + i) * 3;
        img.d[o] = (i * 255) / img.w;
        img.d[o + 1] = (j * 255) / img.h;
        img.d[o + 2] = 128 + 100 * Math.sin(i / 7) * Math.cos(j / 5);
      }
    }
    drawText(img, 4, 4, 'AB 0123456789 .:-/%', [0, 0, 0], 1);
    const psnr = await selfCheckJpeg(img, encodeJpeg(img, 88));
    expect(psnr).toBeGreaterThan(27);
  });

  it('area averaging keeps a constant field constant and conserves the mean', () => {
    const src = new Float32Array(1125 * 1125).fill(0.37);
    const dst = boxResample(src, 1125, 8, 900, 10);
    expect(dst.reduce((m, v) => Math.max(m, Math.abs(v - 0.37)), 0)).toBeLessThan(1e-5);
    const ramp = Float32Array.from({ length: 1125 * 1125 }, (_, p) => (p % 1125) / 1125);
    const mean = (a: Float32Array): number => a.reduce((s, v) => s + v, 0) / a.length;
    expect(Math.abs(mean(boxResample(ramp, 1125, 8, 900, 10)) - mean(ramp))).toBeLessThan(1e-4);
    // flipRows is its own inverse and moves row 0 to the end.
    const f = Float32Array.from({ length: 9 }, (_, i) => i);
    expect(Array.from(flipRows(flipRows(f, 3), 3))).toEqual(Array.from(f));
    expect(Array.from(flipRows(f, 3)).slice(0, 3)).toEqual([6, 7, 8]);
  });

  SITE_IDS.forEach((id, idx) => {
    it(
      `site ${id}: estimators, patches and contact sheets`,
      async () => {
        const site = await loadSite(id);
        const { patches, notes } = selectPatches(site, idx);
        const tiles = makeTiles(site, patches, idx);
        mkdirSync(OUT_DIR, { recursive: true });
        const sizes: string[] = [];
        for (const numbers of [false, true]) {
          const img = renderSheet(site, tiles, numbers);
          const { bytes, quality } = encodeWithin(img, SHEET.budgetBytes);
          writeFileSync(join(OUT_DIR, `sheet-${id}${numbers ? '' : '-blind'}.jpg`), bytes);
          const psnr = await selfCheckJpeg(img, bytes);
          expect(psnr).toBeGreaterThan(24);
          sizes.push(`${numbers ? 'numbers' : 'blind'} ${img.w}x${img.h} q${quality} ${(bytes.length / 1024).toFixed(0)} KB PSNR ${psnr.toFixed(1)} dB`);
        }
        const aidDir = process.env.FIRESIM_SPIKE_AID;
        if (aidDir) {
          mkdirSync(aidDir, { recursive: true });
          for (let part = 0; part < 4; part++) {
            const aid = renderAid(site, tiles, part);
            if (aid) writeFileSync(join(aidDir, `aid-${id}-${part + 1}.jpg`), encodeJpeg(aid, 90));
          }
        }
        for (const k of ['E2', 'E3', 'E23', 'F'] as const) {
          for (let c = 0; c < site.steep.length; c++) expect(site.est[k].rock[c]!).toBeLessThanOrEqual(site.steep[c]! + 1e-6);
        }
        const reg = registrationCheck(site);
        runs.push({ site, tiles, notes, reg });
        const shares = MAIN_EST.map((e) => {
          const c = gridCounts(site, e);
          return `${e} ${pctOf(c.wall, c.n)}/${pctOf(c.partial, c.n)}/${pctOf(c.chute, c.n)}`;
        }).join('  ');
        const g = site.green;
        console.log(
          [
            `[S6] ${id}: ${tiles.length} tiles (${(['high', 'mid', 'disagree', 'control'] as Stratum[]).map((s) => `${s} ${tiles.filter((t) => t.stratum === s).length}`).join(', ')}); ${notes.join('; ') || 'no shortfall'}`,
            `[S6] ${id}: E3 reference ${g.refCells} cells ${g.refPixels} px, median ExG ${g.median.toFixed(4)}, T ${g.T.toFixed(4)}, deficit ${g.delta.toFixed(4)}`,
            `[S6] ${id}: whole-grid wall/partial/chute  ${shares}`,
            `[S6] ${id}: checks: block averaging vs the app's cliffFraction max diff ${site.checks.cliffFractionMaxDiff.toExponential(1)}; 10 m cover block mean vs fire-grid cover mean abs diff ${site.checks.coverBlockMeanAbsDiff.toFixed(4)}`,
            `[S6] ${id}: sheets ${sizes.join(' | ')}`,
            `[S6] ${id}: registration best sun ${reg.az}/${reg.alt}, corr ${reg.corr0.toFixed(3)} at no shift, best shift (${reg.best.dx}, ${reg.best.dy}) px corr ${reg.best.corr.toFixed(3)}`,
          ].join('\n'),
        );
        expect(tiles.length).toBeGreaterThan(0);
      },
      900_000,
    );
  });

  it('results.md (only when labels.json exists)', () => {
    console.log(`[S6] settings hash ${configHash()}`);
    const labels = readLabels();
    if (!labels) {
      console.log('[S6] no labels.json in the output folder: sheets written, nothing scored');
      return;
    }
    writeFileSync(join(OUT_DIR, 'results.md'), resultsMarkdown(runs, labels));
    console.log(`[S6] wrote ${join(OUT_DIR, 'results.md')}`);
  });
});
