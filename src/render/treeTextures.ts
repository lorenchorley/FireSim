/**
 * Procedural textures for the 3-D canopy (pure; no Three.js, no canvas: plain RGBA8 byte arrays, so they are
 * deterministic, unit-testable in Node and cost the APK nothing).
 *
 * Two atlases:
 *  - LEAF atlas: one row of 128 × 128 tiles of alpha-tested foliage / bark cards. RGB is a SHADING MULTIPLIER (a neutral,
 *    slightly warm/cool grey the shader multiplies with the tree's tint), A is the leaf coverage.
 *  - IMPOSTOR atlas: one row of 64 × 128 tree silhouettes for the far level of detail. R = shading, G = trunk mask (255 on
 *    the trunk, 0 on foliage), B = 255 on the outer, sun-facing part of the crown (used for the crown-depth shading), A = coverage.
 *
 * Mip maps are generated here (not by the GPU) with coverage-preserving alpha, so an alpha-tested foliage card keeps the same
 * proportion of opaque pixels at every distance instead of thinning out into a see-through ghost.
 */

export const TILE = 128;
export const IMP_W = 64;
export const IMP_H = 128;

/** Tile indices of the leaf atlas. */
export enum LeafTile {
  /** Eucalypt leaf cluster: drooping lanceolate leaves with gaps between them. */
  Eucalypt = 0,
  /** Dense broad leaves (rainforest). */
  Dense = 1,
  /** Pine needle tier: a branch with a fringe of hanging needles. */
  Needle = 2,
  /** Heath / shrub foliage: many small round leaves. */
  Heath = 3,
  /** Ribbon-bark streamer: a ragged, tapering strip of bark. */
  Streamer = 4,
  /** Grass tuft: curved blades fanning up from the base. */
  Tuft = 5,
}
export const LEAF_TILES = 6;

/** Slots of the impostor atlas. */
export enum Impostor {
  Eucalypt = 0,
  TallGum = 1,
  Rainforest = 2,
  SnowGum = 3,
  Conifer = 4,
  Heath = 5,
  Understorey = 6,
  /** Plain round tree / cone / mound (simple and coded styles). */
  SimpleRound = 7,
  SimpleCone = 8,
  SimpleMound = 9,
}
export const IMPOSTOR_SLOTS = 10;

export interface MipLevel {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface TextureImage {
  width: number;
  height: number;
  /** Level 0 first. Rows run from the BOTTOM (v = 0) to the top, as GL expects with flipY = false. */
  mips: MipLevel[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic helpers
// ─────────────────────────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

const fbm2 = (x: number, y: number, seed: number): number => 0.55 * vnoise(x, y, seed) + 0.3 * vnoise(x * 2.1, y * 2.1, seed + 7) + 0.15 * vnoise(x * 4.3, y * 4.3, seed + 13);

/** Image buffer, rows top-down while painting. */
class Canvas {
  readonly data: Uint8Array;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.data = new Uint8Array(w * h * 4);
  }

  /** Paint a pixel with coverage `a` (0–1) using "over"-like max blending: a more opaque pixel replaces the colour. */
  plot(x: number, y: number, a: number, r: number, g: number, b: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
    const o = (y * this.w + x) * 4;
    const old = this.data[o + 3]! / 255;
    if (a >= old || a > 0.999) {
      // Blend the colour by relative coverage so antialiased edges do not show the previous leaf's colour.
      const t = old <= 0 ? 1 : Math.min(1, a / Math.max(a, old) + (a > old ? 0.35 : 0));
      this.data[o] = Math.round(this.data[o]! * (1 - t) + r * t);
      this.data[o + 1] = Math.round(this.data[o + 1]! * (1 - t) + g * t);
      this.data[o + 2] = Math.round(this.data[o + 2]! * (1 - t) + b * t);
      this.data[o + 3] = Math.round(Math.max(a, old) * 255);
    }
  }

  /** A rotated ellipse-ish shape with an arbitrary half-width profile along its axis. */
  leaf(cx: number, cy: number, len: number, wid: number, ang: number, profile: (t: number) => number, colour: (t: number, s: number) => [number, number, number]): void {
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const ext = Math.ceil(len * 0.5 + wid + 2);
    for (let py = Math.floor(cy - ext); py <= Math.ceil(cy + ext); py++) {
      for (let px = Math.floor(cx - ext); px <= Math.ceil(cx + ext); px++) {
        const dx = px + 0.5 - cx;
        const dy = py + 0.5 - cy;
        const u = dx * ca + dy * sa; // along the axis
        const v = -dx * sa + dy * ca; // across
        const t = u / len + 0.5;
        if (t < 0 || t > 1) continue;
        const hw = profile(t) * wid * 0.5;
        const d = hw - Math.abs(v);
        if (d < -0.5) continue;
        const cov = Math.min(1, Math.max(0, d + 0.5));
        const s = v / Math.max(hw, 1e-3);
        const [r, g, b] = colour(t, s);
        this.plot(px, py, cov, r, g, b);
      }
    }
  }

  disc(cx: number, cy: number, rx: number, ry: number, colour: (dx: number, dy: number) => [number, number, number]): void {
    for (let py = Math.floor(cy - ry - 1); py <= Math.ceil(cy + ry + 1); py++) {
      for (let px = Math.floor(cx - rx - 1); px <= Math.ceil(cx + rx + 1); px++) {
        const dx = (px + 0.5 - cx) / rx;
        const dy = (py + 0.5 - cy) / ry;
        const r = Math.hypot(dx, dy);
        if (r > 1 + 0.6 / Math.min(rx, ry)) continue;
        const cov = Math.min(1, Math.max(0, (1 - r) * Math.min(rx, ry) + 0.5));
        const [R, G, B] = colour(dx, dy);
        this.plot(px, py, cov, R, G, B);
      }
    }
  }
}

const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);
const shade = (b: number, warm: number): [number, number, number] => [clamp255(b * (0.93 + 0.1 * warm)), clamp255(b), clamp255(b * (0.86 + 0.1 * (1 - warm)))];

// ─────────────────────────────────────────────────────────────────────────────
// Leaf tiles (128 × 128)
// ─────────────────────────────────────────────────────────────────────────────

function paintEucalypt(c: Canvas, ox: number): void {
  const rnd = mulberry32(1101);
  const tile = new Canvas(TILE, TILE);
  // A layer of leaf clusters: each cluster is a small fan of hanging lanceolate leaves; clusters overlap into an irregular
  // cloud with gaps, brighter at the top of the tile (the sunlit side) and darker at the bottom.
  const clusters = 20;
  for (let ci = 0; ci < clusters; ci++) {
    const a = rnd() * Math.PI * 2;
    const rr = Math.sqrt(rnd()) * 0.8;
    const cx = 64 + Math.cos(a) * rr * 40;
    const cy = 52 + Math.sin(a) * rr * 30;
    const cb = 0.62 + 0.38 * rnd();
    const nl = 9 + Math.floor(rnd() * 5);
    for (let li = 0; li < nl; li++) {
      const ang = Math.PI / 2 + (rnd() - 0.5) * 1.5;
      const len = 16 + rnd() * 10;
      const wid = 4.4 + rnd() * 2.2;
      const ax = cx + (rnd() - 0.5) * 9;
      const ay = cy + (rnd() - 0.5) * 6;
      const top = 1 - ay / TILE;
      const warm = rnd();
      const base = cb * (0.85 + 0.15 * rnd());
      tile.leaf(ax, ay + len * 0.4, len, wid, ang, (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.75)), 0.75), (t, s) => shade(base * (0.72 + 0.34 * top) * (0.9 + 0.12 * t) * (0.9 + 0.1 * Math.abs(s)) * 255, warm));
    }
  }
  blit(c, tile, ox);
}

function paintDense(c: Canvas, ox: number): void {
  const rnd = mulberry32(2202);
  const tile = new Canvas(TILE, TILE);
  // Solid, lumpy core plus broad overlapping leaves round the rim: reads as a dense, dark crown.
  tile.disc(64, 64, 40, 38, (_dx, dy) => shade((0.62 + 0.18 * (-dy * 0.5 + 0.5)) * 255, 0.5));
  for (let i = 0; i < 46; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = 0.35 + rnd() * 0.6;
    const cx = 64 + Math.cos(a) * rr * 46;
    const cy = 64 + Math.sin(a) * rr * 44;
    const rx = 8 + rnd() * 6;
    const ry = 5 + rnd() * 4;
    const ang = a + (rnd() - 0.5) * 1.2;
    const base = 0.5 + 0.5 * rnd();
    const light = 0.75 + 0.25 * (1 - cy / TILE);
    const warm = rnd();
    tile.leaf(cx, cy, rx * 2, ry * 2, ang, (t) => Math.pow(Math.sin(Math.PI * t), 0.7), (_t, s) => shade(base * light * (0.88 + 0.12 * (1 - Math.abs(s))) * 255, warm));
  }
  blit(c, tile, ox);
}

function paintNeedle(c: Canvas, ox: number): void {
  const rnd = mulberry32(3303);
  const tile = new Canvas(TILE, TILE);
  // A drooping branch tier: a dense core along y = 34 with needles hanging down and outwards.
  for (let i = 0; i < 190; i++) {
    const ax = 4 + rnd() * 120;
    const ay = 8 + rnd() * 32;
    const out = (ax - 64) / 64;
    const ang = Math.PI / 2 + out * 0.55 + (rnd() - 0.5) * 0.9;
    const len = 26 + rnd() * 34 * (1 - 0.5 * Math.abs(out));
    const base = 0.5 + 0.5 * rnd();
    const light = 0.7 + 0.3 * (1 - (ay + len * 0.5) / TILE);
    tile.leaf(ax, ay, len, 2.6, ang, (t) => 1 - 0.55 * t, (t) => shade(base * light * (1 - 0.15 * t) * 255, 0.35));
  }
  blit(c, tile, ox);
}

function paintHeath(c: Canvas, ox: number): void {
  const rnd = mulberry32(4404);
  const tile = new Canvas(TILE, TILE);
  for (let i = 0; i < 260; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = Math.sqrt(rnd()) * 0.92;
    const cx = 64 + Math.cos(a) * rr * 52;
    const cy = 66 + Math.sin(a) * rr * 44;
    const r = 2.6 + rnd() * 2.6;
    const base = 0.52 + 0.48 * rnd();
    const light = 0.72 + 0.28 * (1 - cy / TILE);
    const warm = rnd();
    tile.disc(cx, cy, r, r * (0.7 + 0.3 * rnd()), () => shade(base * light * 255, warm));
  }
  blit(c, tile, ox);
}

function paintStreamer(c: Canvas, ox: number): void {
  const tile = new Canvas(TILE, TILE);
  for (let y = 0; y < TILE; y++) {
    const t = y / (TILE - 1); // 0 top … 1 bottom tip
    const half = (0.9 - 0.62 * Math.pow(t, 1.3)) * 0.5 * TILE * 0.78;
    const sway = (fbm2(y * 0.09, 3.3, 5) - 0.5) * 22 * t;
    const cx = 64 + sway;
    for (let x = 0; x < TILE; x++) {
      const dx = x + 0.5 - cx;
      const ragged = (fbm2(x * 0.16, y * 0.05, 9) - 0.5) * 10;
      const lim = half + ragged * (0.35 + t);
      if (Math.abs(dx) > lim || t > 0.97) continue;
      const edge = Math.min(1, (lim - Math.abs(dx)) / 1.2);
      // Fibres: fine vertical streaks, darker toward the edges and the tip.
      const fib = vnoise(x * 0.9, y * 0.06, 21);
      const dark = 0.62 + 0.38 * fib - 0.22 * t - 0.18 * Math.pow(Math.abs(dx) / Math.max(lim, 1), 3);
      const b = clamp255(dark * 255);
      tile.plot(x, y, edge, b * 0.98, b, b * 0.94);
    }
  }
  blit(c, tile, ox);
}

function paintTuft(c: Canvas, ox: number): void {
  const rnd = mulberry32(6606);
  const tile = new Canvas(TILE, TILE);
  for (let i = 0; i < 46; i++) {
    const bx = 64 + (rnd() - 0.5) * 34;
    const lean = (bx - 64) / 34 + (rnd() - 0.5) * 0.7;
    const len = 62 + rnd() * 58;
    const bend = (rnd() - 0.5) * 0.9 + lean * 0.5;
    const base = 0.5 + 0.5 * rnd();
    const steps = 40;
    let px = bx;
    let py = TILE - 4;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const ang = -Math.PI / 2 + lean * (0.55 + t * 0.9) + bend * t * t;
      const seg = len / steps;
      const nx = px + Math.cos(ang) * seg;
      const ny = py + Math.sin(ang) * seg;
      const w = 3.4 * (1 - t * 0.92) + 0.4;
      tile.leaf((px + nx) / 2, (py + ny) / 2, seg * 1.6, w, ang, () => 1, () => shade(base * (0.72 + 0.28 * t) * 255, 0.55));
      px = nx;
      py = ny;
    }
  }
  blit(c, tile, ox);
}

function blit(dst: Canvas, src: Canvas, ox: number): void {
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const so = (y * src.w + x) * 4;
      const d = (y * dst.w + ox + x) * 4;
      dst.data[d] = src.data[so]!;
      dst.data[d + 1] = src.data[so + 1]!;
      dst.data[d + 2] = src.data[so + 2]!;
      dst.data[d + 3] = src.data[so + 3]!;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Impostors (64 × 128)
// ─────────────────────────────────────────────────────────────────────────────

/** Fills the pixels of a noisy blob: `holes` opens gaps (see-through crowns), lit from the upper left. */
function crownBlob(c: Canvas, ox: number, cx: number, cy: number, rx: number, ry: number, seed: number, holes: number, amp = 0.28): void {
  for (let py = Math.floor(cy - ry * 1.4); py <= Math.ceil(cy + ry * 1.4); py++) {
    for (let px = Math.floor(cx - rx * 1.4); px <= Math.ceil(cx + rx * 1.4); px++) {
      if (px < 2 || px >= IMP_W - 2 || py < 1 || py >= IMP_H - 1) continue;
      const dx = (px + 0.5 - cx) / rx;
      const dy = (py + 0.5 - cy) / ry;
      const n = fbm2(px * 0.16 + seed, py * 0.16, seed) - 0.5;
      const r = Math.hypot(dx, dy) + n * amp * 2;
      if (r > 1.02) continue;
      const hole = holes > 0 ? fbm2(px * 0.28, py * 0.28, seed + 31) : 0;
      if (holes > 0 && r > 0.55 && hole < holes * (r - 0.4)) continue;
      const cov = Math.min(1, (1.02 - r) * Math.min(rx, ry) * 0.9 + 0.3);
      // Sphere-like shading lit from the upper left, darker toward the lower part.
      const nz = Math.sqrt(Math.max(0, 1 - Math.min(1, dx * dx + dy * dy)));
      const lit = 0.55 + 0.45 * Math.max(0, -0.55 * dx - 0.7 * dy + 0.45 * nz);
      const rim = r > 0.78 ? 255 : 0;
      c.plot(px, py, cov, clamp255(lit * 255 * (0.9 + 0.2 * n)), 0, rim && dy < 0.2 ? 255 : 0);
    }
  }
  void ox;
}

/** A tapered/leaning trunk from (x0, yBottom) to (x1, yTop) with half-widths w0 → w1. */
function trunkLine(c: Canvas, x0: number, y0: number, x1: number, y1: number, w0: number, w1: number, bright = 0.62): void {
  const n = 40;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    const w = w0 + (w1 - w0) * t;
    for (let py = Math.floor(y - 1.5); py <= Math.ceil(y + 1.5); py++) {
      for (let px = Math.floor(x - w - 1); px <= Math.ceil(x + w + 1); px++) {
        const d = w - Math.abs(px + 0.5 - x);
        const cov = Math.min(1, Math.max(0, d + 0.5));
        if (cov <= 0) continue;
        c.plot(px, py, cov, clamp255((bright + 0.22 * (0.5 - (px + 0.5 - x) / (2 * w + 1e-3))) * 255), 255, 0);
      }
    }
  }
}

function paintImpostor(slot: Impostor, c: Canvas): void {
  const x0 = slot * IMP_W;
  const s = new Canvas(IMP_W, IMP_H);
  const g = IMP_H; // ground line at the bottom (image y = IMP_H - 1)
  switch (slot) {
    case Impostor.Eucalypt:
      trunkLine(s, 33, g - 1, 32, g * 0.5, 3.4, 2, 0.6);
      trunkLine(s, 32.5, g * 0.6, 17, g * 0.42, 1.6, 1, 0.6);
      trunkLine(s, 32.5, g * 0.57, 48, g * 0.4, 1.6, 1, 0.6);
      crownBlob(s, 0, 32, 28, 27, 20, 3, 0.4);
      crownBlob(s, 0, 15, 47, 16, 14, 5, 0.36);
      crownBlob(s, 0, 49, 45, 16, 14, 7, 0.36);
      crownBlob(s, 0, 31, 55, 19, 11, 9, 0.36);
      break;
    case Impostor.TallGum:
      trunkLine(s, 32, g - 1, 32.5, 34, 2.6, 1.3, 0.72);
      crownBlob(s, 0, 32.5, 20, 20, 17, 11, 0.36);
      crownBlob(s, 0, 21, 36, 12, 10, 13, 0.34);
      crownBlob(s, 0, 44, 34, 13, 10, 15, 0.34);
      break;
    case Impostor.Rainforest:
      trunkLine(s, 32, g - 1, 32, g * 0.6, 3.6, 2.4, 0.4);
      crownBlob(s, 0, 32, 50, 30, 32, 17, 0.06, 0.2);
      crownBlob(s, 0, 17, 70, 17, 17, 19, 0.08, 0.2);
      crownBlob(s, 0, 47, 68, 17, 17, 21, 0.08, 0.2);
      break;
    case Impostor.SnowGum:
      trunkLine(s, 27, g - 1, 24, g * 0.66, 2.6, 1.8, 0.86);
      trunkLine(s, 37, g - 1, 41, g * 0.66, 2.6, 1.8, 0.86);
      trunkLine(s, 32, g - 1, 32, g * 0.6, 2.4, 1.6, 0.86);
      crownBlob(s, 0, 32, 70, 28, 22, 23, 0.22);
      crownBlob(s, 0, 18, 78, 15, 13, 25, 0.2);
      crownBlob(s, 0, 47, 78, 15, 13, 27, 0.2);
      break;
    case Impostor.Conifer:
      trunkLine(s, 32, g - 1, 32, g * 0.78, 1.8, 1.2, 0.35);
      for (let k = 0; k < 8; k++) {
        const y = g * (0.08 + k * 0.1);
        const w = 6 + k * 3.4;
        crownBlob(s, 0, 32, y + 8, w, 11, 30 + k, 0.1, 0.2);
      }
      break;
    case Impostor.Heath:
      crownBlob(s, 0, 32, g - 30, 29, 25, 41, 0.12);
      crownBlob(s, 0, 17, g - 20, 16, 16, 43, 0.12);
      crownBlob(s, 0, 47, g - 20, 16, 16, 45, 0.12);
      break;
    case Impostor.Understorey:
      crownBlob(s, 0, 32, g - 38, 18, 30, 51, 0.16);
      crownBlob(s, 0, 22, g - 22, 14, 19, 53, 0.16);
      crownBlob(s, 0, 43, g - 24, 14, 20, 55, 0.16);
      break;
    case Impostor.SimpleRound:
      trunkLine(s, 32, g - 1, 32, g * 0.5, 2.2, 1.6, 0.6);
      crownBlob(s, 0, 32, g * 0.32, 25, 24, 61, 0, 0.06);
      break;
    case Impostor.SimpleCone:
      trunkLine(s, 32, g - 1, 32, g * 0.8, 1.8, 1.4, 0.5);
      for (let y = 8; y < g * 0.84; y++) {
        const w = (y - 6) * 0.3;
        for (let x = Math.floor(32 - w - 1); x <= Math.ceil(32 + w + 1); x++) {
          const cov = Math.min(1, Math.max(0, w - Math.abs(x + 0.5 - 32) + 0.5));
          const l = 0.62 + 0.38 * Math.max(0, -(x + 0.5 - 32) / (w + 1e-3)) * 0.6;
          s.plot(x, y, cov, clamp255(l * 255), 0, 0);
        }
      }
      break;
    case Impostor.SimpleMound:
      crownBlob(s, 0, 32, g - 30, 28, 24, 71, 0, 0.05);
      break;
  }
  blit(c, s, x0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Mips and export
// ─────────────────────────────────────────────────────────────────────────────

function coverage(data: Uint8Array, scale: number): number {
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i]! * scale >= 127.5) n++;
  return n / (data.length / 4);
}

/**
 * Box-filtered mip chain (colour weighted by alpha) whose alpha is rescaled at every level so that the fraction of texels
 * above the 0.5 alpha-test threshold stays that of level 0.
 */
export function buildMips(base: Uint8Array, w: number, h: number): MipLevel[] {
  const levels: MipLevel[] = [{ data: base, width: w, height: h }];
  const target = coverage(base, 1);
  let cur = levels[0]!;
  while (cur.width > 1 || cur.height > 1) {
    const nw = Math.max(1, cur.width >> 1);
    const nh = Math.max(1, cur.height >> 1);
    const out = new Uint8Array(nw * nh * 4);
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        let wsum = 0;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const sx = Math.min(cur.width - 1, x * 2 + dx);
            const sy = Math.min(cur.height - 1, y * 2 + dy);
            const o = (sy * cur.width + sx) * 4;
            const al = cur.data[o + 3]!;
            r += cur.data[o]! * al;
            g += cur.data[o + 1]! * al;
            b += cur.data[o + 2]! * al;
            a += al;
            wsum += al;
          }
        }
        const o = (y * nw + x) * 4;
        if (wsum > 0) {
          out[o] = Math.round(r / wsum);
          out[o + 1] = Math.round(g / wsum);
          out[o + 2] = Math.round(b / wsum);
        }
        out[o + 3] = Math.round(a / 4);
      }
    }
    // Coverage-preserving rescale (bisection on the scale).
    if (target > 0 && target < 1 && nw * nh >= 4) {
      let lo = 1;
      let hi = 6;
      if (coverage(out, 1) >= target) {
        hi = 1;
        lo = 0.4;
      }
      for (let it = 0; it < 14; it++) {
        const mid = (lo + hi) / 2;
        if (coverage(out, mid) < target) lo = mid;
        else hi = mid;
      }
      const sc = (lo + hi) / 2;
      for (let i = 3; i < out.length; i += 4) out[i] = Math.min(255, Math.round(out[i]! * sc));
    }
    cur = { data: out, width: nw, height: nh };
    levels.push(cur);
  }
  return levels;
}

/** Flip rows so that row 0 is the bottom of the image (v = 0). */
function flipRows(d: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(d.length);
  for (let y = 0; y < h; y++) out.set(d.subarray(y * w * 4, (y + 1) * w * 4), (h - 1 - y) * w * 4);
  return out;
}

let leafCache: TextureImage | null = null;
let impCache: TextureImage | null = null;

/** The leaf / bark card atlas (LEAF_TILES × TILE wide, TILE high). Built once and cached. */
export function leafAtlas(): TextureImage {
  if (leafCache) return leafCache;
  const w = LEAF_TILES * TILE;
  const c = new Canvas(w, TILE);
  paintEucalypt(c, LeafTile.Eucalypt * TILE);
  paintDense(c, LeafTile.Dense * TILE);
  paintNeedle(c, LeafTile.Needle * TILE);
  paintHeath(c, LeafTile.Heath * TILE);
  paintStreamer(c, LeafTile.Streamer * TILE);
  paintTuft(c, LeafTile.Tuft * TILE);
  leafCache = { width: w, height: TILE, mips: buildMips(flipRows(c.data, w, TILE), w, TILE) };
  return leafCache;
}

/** The far-LOD tree silhouettes (IMPOSTOR_SLOTS × IMP_W wide, IMP_H high). Built once and cached. */
export function impostorAtlas(): TextureImage {
  if (impCache) return impCache;
  const w = IMPOSTOR_SLOTS * IMP_W;
  const c = new Canvas(w, IMP_H);
  for (let s = 0; s < IMPOSTOR_SLOTS; s++) paintImpostor(s as Impostor, c);
  impCache = { width: w, height: IMP_H, mips: buildMips(flipRows(c.data, w, IMP_H), w, IMP_H) };
  return impCache;
}

/** Total bytes of both atlases including mips (memory the textures take; the APK does not grow). */
export function textureBytes(): number {
  const sum = (t: TextureImage): number => t.mips.reduce((s, m) => s + m.data.length, 0);
  return sum(leafAtlas()) + sum(impostorAtlas());
}

/** Drop the cached atlases (tests). */
export function resetTextureCache(): void {
  leafCache = null;
  impCache = null;
}
