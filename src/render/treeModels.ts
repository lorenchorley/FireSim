/**
 * Procedural tree geometry for the 3-D canopy (pure; no Three.js). Every model is built once, in UNIT space: the crown is
 * one unit wide in x/z and the tree one unit tall in y, standing on y = 0; the vertex shader scales x/z by the crown width
 * and y by the tree height (both in metres, from the canopy data), so tree HEIGHTS stay true to the data.
 *
 * Per-vertex attributes (all models share them):
 *   position, normal, uv (into the leaf atlas or the impostor atlas, see treeTextures.ts) and `mat` = (part, ao, lobe):
 *     part   0 wood (trunk, branch)  1 foliage card (alpha-tested)  2 bark streamer  3 ground decal (contact shadow + litter)
 *            4 solid crown (simple / coded styles)  5 far-LOD billboard
 *     ao     baked crown-depth shading 0–1 (inner and lower parts of a crown are darker)
 *     lobe   1… id of the foliage lobe the vertex belongs to (0 = none); the shader jitters lobes per tree and hides the optional
 *            ones (id > MIN_LOBES) on some trees, so one mesh gives crowns of 4–7 lobes in many arrangements.
 *
 * Three levels of detail per species: 0 = near (~150–350 triangles), 1 = mid (~40–60), 2 = far (one billboard, 2 triangles).
 * Two model families: 'natural' (species-shaped, textured cards) and 'flat' (the simple and coded styles: clean low-poly shapes).
 */
import { Impostor, IMPOSTOR_SLOTS, LEAF_TILES, LeafTile } from './treeTextures';
import type { BarkKind } from './canopyStyle';
import { VegGroup } from './vegetationPlacement';

export type { BarkKind };

export const Part = { Wood: 0, Leaf: 1, Streamer: 2, Decal: 3, Solid: 4, Billboard: 5 } as const;

export interface MeshData {
  pos: number[];
  nor: number[];
  uv: number[];
  mat: number[];
  idx: number[];
}

/** Lobes with an id above this are optional: the shader hides some of them per tree (4–7 lobes overall). */
export const MIN_LOBES = 4;

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Small deterministic PRNG (mulberry32) so every model is identical on every device. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function newMesh(): MeshData {
  return { pos: [], nor: [], uv: [], mat: [], idx: [] };
}

function vert(m: MeshData, p: V3, n: V3, uv: [number, number], part: number, ao: number, lobe: number): number {
  m.pos.push(p[0], p[1], p[2]);
  m.nor.push(n[0], n[1], n[2]);
  m.uv.push(uv[0], uv[1]);
  m.mat.push(part, ao, lobe);
  return m.pos.length / 3 - 1;
}

export const triangleCount = (m: MeshData): number => m.idx.length / 3;

// ─────────────────────────────────────────────────────────────────────────────
// Building blocks
// ─────────────────────────────────────────────────────────────────────────────

interface CrownShape {
  /** Crown centre (unit space) and radii, for the crown-depth ambient occlusion and the normal blend. */
  c: V3;
  r: V3;
}

function crownAo(p: V3, crown: CrownShape): number {
  const d: V3 = [(p[0] - crown.c[0]) / crown.r[0], (p[1] - crown.c[1]) / crown.r[1], (p[2] - crown.c[2]) / crown.r[2]];
  const l = len(d);
  const dist = clamp01(l);
  const up = 0.5 + 0.5 * (d[1] / (l || 1));
  // Outer, upward-facing parts of the crown are bright; the inside and the underside are darker.
  return clamp01(0.5 + 0.26 * smooth(0.0, 1.0, dist) + 0.24 * up);
}

/** Tube along a polyline with radii per point; smooth normals; part 0 (wood). uv = (angle 0–1, height in unit y). */
function tube(m: MeshData, pts: V3[], radii: number[], sides: number, aoAt: (p: V3) => number, lobe = 0): void {
  let u0: V3 = [1, 0, 0];
  let prevT: V3 | null = null;
  const rings: number[][] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)]!;
    const b = pts[Math.min(pts.length - 1, i + 1)]!;
    const t = norm(sub(b, a));
    if (prevT) {
      // Parallel transport of the frame.
      const axis = cross(prevT, t);
      const s = len(axis);
      if (s > 1e-6) {
        const k = norm(axis);
        const c = dot(prevT, t);
        const cr = cross(k, u0);
        u0 = add(add(mul(u0, c), mul(cr, s)), mul(k, dot(k, u0) * (1 - c)));
      }
    } else {
      const ref: V3 = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      u0 = norm(cross(t, cross(ref, t)));
    }
    prevT = t;
    const v0 = cross(t, u0);
    const ring: number[] = [];
    for (let s = 0; s <= sides; s++) {
      const th = (s / sides) * Math.PI * 2;
      const nrm = add(mul(u0, Math.cos(th)), mul(v0, Math.sin(th)));
      const p = add(pts[i]!, mul(nrm, radii[i]!));
      ring.push(vert(m, p, nrm, [s / sides, pts[i]![1]], Part.Wood, aoAt(p), lobe));
    }
    rings.push(ring);
  }
  for (let i = 0; i + 1 < rings.length; i++) {
    for (let s = 0; s < sides; s++) {
      const a = rings[i]![s]!;
      const b = rings[i]![s + 1]!;
      const c = rings[i + 1]![s]!;
      const d = rings[i + 1]![s + 1]!;
      m.idx.push(a, c, b, b, c, d);
    }
  }
}

function tileUv(tile: number, u: number, v: number, flip = false): [number, number] {
  const inset = 0.004;
  const uu = flip ? 1 - u : u;
  return [(tile + inset + uu * (1 - 2 * inset)) / LEAF_TILES, v];
}

/**
 * A foliage card: a quad centred at `c` spanned by `right` and `up` (half sizes hw, hh), textured with `tile`.
 * Lighting normals are radial (from the lobe and the crown) so a clump shades like a soft volume whichever way a card faces.
 */
function card(m: MeshData, c: V3, right: V3, up: V3, hw: number, hh: number, tile: number, lobeC: V3, crown: CrownShape, lobe: number, flip: boolean, part: number = Part.Leaf): void {
  const corners: [V3, [number, number]][] = [
    [add(sub(c, mul(right, hw)), mul(up, -hh)), [0, 0]],
    [add(add(c, mul(right, hw)), mul(up, -hh)), [1, 0]],
    [add(add(c, mul(right, hw)), mul(up, hh)), [1, 1]],
    [add(sub(c, mul(right, hw)), mul(up, hh)), [0, 1]],
  ];
  const ids = corners.map(([p, uv]) => {
    const rl = norm(sub(p, lobeC));
    const rc = norm(sub(p, crown.c));
    const nrm = norm([rl[0] * 0.5 + rc[0] * 0.5, rl[1] * 0.5 + rc[1] * 0.5 + 0.35, rl[2] * 0.5 + rc[2] * 0.5]);
    return vert(m, p, nrm, tileUv(tile, uv[0], uv[1], flip), part, crownAo(p, crown), lobe);
  });
  m.idx.push(ids[0]!, ids[1]!, ids[2]!, ids[0]!, ids[2]!, ids[3]!);
}

/** Fibonacci-sphere directions (n points), upper hemisphere weighted by `up` (0 = uniform, 1 = mostly upward). */
function sphereDirs(n: number, rand: () => number, up: number): V3[] {
  const out: V3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  const spin = rand() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    let y = 1 - ((i + 0.5) / n) * 2;
    y = y * (1 - up * 0.45) + up * 0.42; // shift toward the top
    y = Math.max(-0.95, Math.min(1, y));
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * golden + spin;
    out.push([Math.cos(th) * r, y, Math.sin(th) * r]);
  }
  return out;
}

/**
 * A lobe of foliage: `n` cards on and just inside the surface of an ellipsoid, each facing outwards (tangent to it), the
 * upper side favoured. Gaps between the cards make the crown see-through and layered.
 */
function lobeOfCards(m: MeshData, c: V3, r: V3, n: number, tile: number, crown: CrownShape, lobe: number, rand: () => number, opts: { cardScale?: number; upBias?: number; aspect?: number } = {}): void {
  const cs = opts.cardScale ?? 1.7;
  const ub = opts.upBias ?? 0.55;
  const aspect = opts.aspect ?? 0.85;
  const dirs = sphereDirs(n, rand, ub);
  const rr = (r[0] + r[2]) / 2;
  dirs.forEach((d, i) => {
    // Centre on the ellipsoid surface (a little inside for every other card), jittered.
    const depth = i % 3 === 2 ? 0.45 : 0.78 + 0.12 * rand();
    const off: V3 = [d[0] * r[0] * depth + (rand() - 0.5) * 0.02, d[1] * r[1] * depth, d[2] * r[2] * depth + (rand() - 0.5) * 0.02];
    // Card plane ⟂ to the (slightly flattened) outward direction, tilted a little at random.
    const nrm = norm([d[0] * 0.8 + (rand() - 0.5) * 0.35, d[1] + 0.25, d[2] * 0.8 + (rand() - 0.5) * 0.35]);
    const rc = cross([0, 1, 0], nrm);
    const right = len(rc) < 1e-4 ? ([1, 0, 0] as V3) : norm(rc);
    const up = norm(cross(nrm, right));
    const hw = 0.5 * cs * (0.8 + 0.35 * rand()) * rr * 0.62;
    const hh = hw * aspect;
    card(m, add(c, off), right, up, hw, hh, tile, c, crown, lobe, rand() < 0.5);
  });
}

/**
 * Leafy hexagonal bipyramid (12 triangles) textured with a leaf tile: the compact crown lobe of the mid LOD. Dense enough to
 * read as a solid puff from a distance; radial lighting normals.
 */
function leafyPuff(m: MeshData, c: V3, r: V3, tile: number, lobe: number, crown: CrownShape, rot: number): void {
  const N = 8;
  // A lens: a domed top, a flat-ish underside. Normals lean upwards all round so the underside stays lit by the sky.
  const dirs: V3[] = [[0, 0.78, 0], [0, -0.4, 0]];
  for (let k = 0; k < N; k++) {
    const a = rot + (k / N) * Math.PI * 2;
    dirs.push([Math.cos(a), 0.06, Math.sin(a)]);
  }
  const ids = dirs.map((d, i) => {
    const p: V3 = [c[0] + d[0] * r[0], c[1] + d[1] * r[1], c[2] + d[2] * r[2]];
    const nrm = i === 0 ? ([0, 1, 0] as V3) : i === 1 ? norm([0, 0.12, 0.05]) : norm([d[0], 0.62, d[2]]);
    return vert(m, p, nrm, tileUv(tile, 0.5 + 0.5 * d[0], 0.5 + 0.5 * d[2]), Part.Leaf, crownAo(p, crown), lobe);
  });
  for (let k = 0; k < N; k++) {
    const a = 2 + k;
    const b = 2 + ((k + 1) % N);
    m.idx.push(ids[0]!, ids[a]!, ids[b]!, ids[1]!, ids[b]!, ids[a]!);
  }
}

/** Hanging bark streamer: a slightly bowed vertical strip attached at the trunk. */
function streamer(m: MeshData, base: V3, dirOut: V3, length: number, width: number, seed: number): void {
  const tan = norm(cross([0, 1, 0], dirOut));
  const bow = 0.06 + 0.06 * ((seed * 7) % 1);
  const top = base;
  const bot = add(add(base, mul(dirOut, bow)), [0, -length, 0]);
  const mid = add(add(base, mul(dirOut, bow * 0.55)), [0, -length * 0.5, 0]);
  const hw = width / 2;
  const nrm = norm(add(dirOut, [0, 0.2, 0]));
  const rows: [V3, number, number][] = [
    [top, 1, 1],
    [mid, 0.85, 0.5],
    [bot, 0.6, 0],
  ];
  const ids: number[][] = rows.map(([p, w, v]) => [
    vert(m, sub(p, mul(tan, hw * w)), nrm, tileUv(LeafTile.Streamer, 0, v), Part.Streamer, 0.8, 0),
    vert(m, add(p, mul(tan, hw * w)), nrm, tileUv(LeafTile.Streamer, 1, v), Part.Streamer, 0.8, 0),
  ]);
  for (let i = 0; i < 2; i++) m.idx.push(ids[i]![0]!, ids[i]![1]!, ids[i + 1]![1]!, ids[i]![0]!, ids[i + 1]![1]!, ids[i + 1]![0]!);
}

/** Ground decal (contact shadow and leaf-litter tint) as a horizontal quad of radius r. The shader lays it on the slope. */
function decal(m: MeshData, r: number): void {
  const c: [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  const ids = c.map(([x, z]) => vert(m, [x * r, 0, z * r], [0, 1, 0], [(x + 1) / 2, (z + 1) / 2], Part.Decal, 1, 0));
  m.idx.push(ids[0]!, ids[2]!, ids[1]!, ids[0]!, ids[3]!, ids[2]!);
}

/** Camera-facing quad textured with an impostor slot (the shader turns it towards the camera). */
function billboard(m: MeshData, slot: Impostor, widthUnits: number): void {
  const hw = widthUnits / 2;
  const inset = 0.5 / 64;
  const u0 = (slot + inset) / IMPOSTOR_SLOTS;
  const u1 = (slot + 1 - inset) / IMPOSTOR_SLOTS;
  const n: V3 = norm([0, 0.2, 1]);
  const a = vert(m, [-hw, 0, 0], n, [u0, 0.004], Part.Billboard, 1, 0);
  const b = vert(m, [hw, 0, 0], n, [u1, 0.004], Part.Billboard, 1, 0);
  const c = vert(m, [hw, 1, 0], n, [u1, 0.996], Part.Billboard, 1, 0);
  const d = vert(m, [-hw, 1, 0], n, [u0, 0.996], Part.Billboard, 1, 0);
  m.idx.push(a, b, c, a, c, d);
}

// ─────────────────────────────────────────────────────────────────────────────
// Natural species models
// ─────────────────────────────────────────────────────────────────────────────


interface EucalyptSpec {
  bark: BarkKind;
  /** Trunk base radius (unit space) and how fast it tapers. */
  r0: number;
  lobes: number;
  cards: number;
  seed: number;
}

const EUC_SPECS: Record<BarkKind, EucalyptSpec> = {
  // Stringybark: thick dark fibrous trunk, heavier, denser crown.
  stringy: { bark: 'stringy', r0: 0.05, lobes: 7, cards: 11, seed: 101 },
  // Ribbon bark: slender pale trunk with hanging streamers, open drooping crown.
  ribbon: { bark: 'ribbon', r0: 0.036, lobes: 7, cards: 10, seed: 202 },
  // Smooth gum: pale smooth trunk, lighter open crown.
  smooth: { bark: 'smooth', r0: 0.034, lobes: 6, cards: 9, seed: 303 },
};

/** Lobe layout of an irregular, open eucalypt crown: [x, y, z, rx, ry] in unit space (id = index + 1). */
function eucLobes(seed: number, count: number): [number, number, number, number, number][] {
  const rand = rng(seed);
  const out: [number, number, number, number, number][] = [[0.03, 0.83, 0.0, 0.32, 0.2]];
  for (let i = 1; i < count; i++) {
    const a = (i / (count - 1)) * Math.PI * 2 * 0.98 + rand() * 0.6;
    const rho = 0.2 + 0.16 * rand();
    const y = 0.6 + 0.16 * rand() - 0.03 * (i % 2);
    out.push([Math.cos(a) * rho, y, Math.sin(a) * rho, 0.25 + 0.07 * rand(), 0.17 + 0.05 * rand()]);
  }
  return out;
}

function eucalyptModel(kind: BarkKind, lod: 0 | 1): MeshData {
  const s = EUC_SPECS[kind];
  const m = newMesh();
  const rand = rng(s.seed + lod);
  const crown: CrownShape = { c: [0.02, 0.74, 0], r: [0.5, 0.26, 0.5] };
  const trunkAo = (p: V3): number => 1 - 0.5 * smooth(0.28, 0.72, p[1]);
  const lean = kind === 'smooth' ? 0.03 : 0.018;
  const lobes = eucLobes(s.seed, s.lobes);
  if (lod === 0) {
    const pts: V3[] = [];
    const radii: number[] = [];
    for (let i = 0; i <= 5; i++) {
      const t = i / 5;
      pts.push([lean * t * t * 1.4 + 0.004 * Math.sin(t * 5), 0.7 * t, 0.012 * Math.sin(t * 4 + s.seed)]);
      // Buttress-like flare at the base, then taper.
      radii.push(s.r0 * (1 - 0.66 * t) * (1 + 0.5 * Math.pow(1 - t, 6)));
    }
    tube(m, pts, radii, 8, trunkAo);
    // Limbs to the outer lobes.
    lobes.slice(1).forEach((l, i) => {
      const fromY = 0.44 + 0.08 * ((i * 7) % 3);
      const a: V3 = [pts[Math.min(5, 1 + Math.round(fromY * 5))]![0], fromY, 0];
      const b: V3 = [l[0] * 0.8, l[1] - 0.05, l[2] * 0.8];
      const midp: V3 = [(a[0] + b[0]) / 2 + (rand() - 0.5) * 0.03, (a[1] + b[1]) / 2 + 0.03, (a[2] + b[2]) / 2 + (rand() - 0.5) * 0.03];
      tube(m, [a, midp, b], [0.02, 0.014, 0.007], 4, () => 0.55);
    });
    lobes.forEach((l, i) => {
      lobeOfCards(m, [l[0], l[1], l[2]], [l[3], l[4], l[3]], s.cards, LeafTile.Eucalypt, crown, i + 1, rand, { cardScale: kind === 'stringy' ? 1.9 : 1.75, upBias: kind === 'ribbon' ? 0.4 : 0.6 });
    });
    if (kind === 'ribbon') {
      // Streamers hanging from the trunk and the limbs.
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2 + rand() * 0.5;
        const sLen = 0.1 + 0.12 * rand();
        const y = sLen + 0.03 + rand() * (0.56 - sLen);
        const tt = y / 0.7;
        const r = s.r0 * (1 - 0.66 * tt) * (1 + 0.5 * Math.pow(1 - tt, 6)) * 1.06;
        const px = lean * tt * tt * 1.4 + 0.004 * Math.sin(tt * 5);
        streamer(m, [px + Math.cos(a) * r, y, Math.sin(a) * r], [Math.cos(a), 0, Math.sin(a)], sLen, 0.07 + 0.04 * rand(), i * 0.37);
      }
    }
    decal(m, 0.58);
  } else {
    const pts: V3[] = [
      [0, 0, 0],
      [lean * 0.4, 0.36, 0],
      [lean * 1.4, 0.7, 0],
    ];
    tube(m, pts, [s.r0 * 1.1, s.r0 * 0.75, s.r0 * 0.4], 5, trunkAo);
    lobes.slice(0, Math.min(lobes.length, 4)).forEach((l, i) => leafyPuff(m, [l[0], l[1], l[2]], [l[3] * 1.55, l[4] * 1.3, l[3] * 1.55], LeafTile.Dense, i + 1, crown, rand() * 3));
    if (kind === 'ribbon') {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const y = 0.2 + 0.3 * rand();
        streamer(m, [Math.cos(a) * s.r0 * 0.7, y, Math.sin(a) * s.r0 * 0.7], [Math.cos(a), 0, Math.sin(a)], 0.12, 0.045, i);
      }
    }
    decal(m, 0.58);
  }
  return m;
}

/** Tall wet forest: very tall straight clear trunk, small high crown. */
function tallGumModel(lod: 0 | 1): MeshData {
  const m = newMesh();
  const rand = rng(404 + lod);
  const crown: CrownShape = { c: [0, 0.83, 0], r: [0.5, 0.17, 0.5] };
  const trunkAo = (p: V3): number => 1 - 0.55 * smooth(0.45, 0.8, p[1]);
  const lobes: [number, number, number, number, number][] = [
    [0, 0.92, 0, 0.24, 0.09],
    [0.22, 0.83, 0.07, 0.2, 0.08],
    [-0.2, 0.85, -0.09, 0.2, 0.08],
    [0.04, 0.8, -0.2, 0.18, 0.07],
    [-0.08, 0.79, 0.2, 0.17, 0.07],
    [0.27, 0.76, -0.14, 0.14, 0.06],
  ];
  const steps = lod === 0 ? 6 : 2;
  const pts: V3[] = [];
  const radii: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push([0.01 * Math.sin(t * 3), 0.84 * t, 0.008 * Math.sin(t * 2.4)]);
    radii.push(0.028 * (1 - 0.72 * t) * (1 + 0.35 * Math.pow(1 - t, 5)));
  }
  tube(m, pts, radii, lod === 0 ? 8 : 5, trunkAo);
  if (lod === 0) {
    lobes.slice(1, 5).forEach((l, i) => tube(m, [[0.008, 0.66 + 0.04 * i, 0], [l[0] * 0.5, l[1] - 0.04, l[2] * 0.5], [l[0] * 0.85, l[1] - 0.02, l[2] * 0.85]], [0.014, 0.01, 0.006], 4, () => 0.55));
    lobes.forEach((l, i) => {
      lobeOfCards(m, [l[0], l[1], l[2]], [l[3], l[4], l[3]], 6, LeafTile.Eucalypt, crown, i + 1, rand, { cardScale: 1.8, upBias: 0.5 });
    });
  } else {
    lobes.slice(0, 4).forEach((l, i) => leafyPuff(m, [l[0], l[1], l[2]], [l[3] * 1.15, l[4] * 1.15, l[3] * 1.15], LeafTile.Dense, i + 1, crown, rand() * 3));
  }
  decal(m, 0.5);
  return m;
}

/** Rainforest: broad dense dark rounded crown on a short, buttressed trunk. */
function rainforestModel(lod: 0 | 1): MeshData {
  const m = newMesh();
  const rand = rng(505 + lod);
  const crown: CrownShape = { c: [0, 0.66, 0], r: [0.52, 0.34, 0.52] };
  const trunkAo = (p: V3): number => 1 - 0.55 * smooth(0.2, 0.5, p[1]);
  const lobes: [number, number, number, number, number][] = [
    [0, 0.78, 0, 0.36, 0.2],
    [0.27, 0.62, -0.1, 0.26, 0.17],
    [-0.25, 0.63, 0.13, 0.27, 0.17],
    [0.07, 0.58, 0.29, 0.22, 0.15],
    [-0.14, 0.57, -0.27, 0.22, 0.15],
    [0.33, 0.55, 0.2, 0.17, 0.12],
    [-0.34, 0.54, -0.1, 0.17, 0.12],
  ];
  const pts: V3[] = lod === 0 ? [[0, 0, 0], [0.006, 0.14, 0], [0.01, 0.3, 0], [0.01, 0.5, 0]] : [[0, 0, 0], [0.01, 0.5, 0]];
  const radii = lod === 0 ? [0.075, 0.05, 0.042, 0.032] : [0.06, 0.035];
  tube(m, pts, radii, lod === 0 ? 8 : 5, trunkAo);
  if (lod === 0) {
    tube(m, [[0.01, 0.34, 0], [0.12, 0.48, -0.05], [0.24, 0.58, -0.1]], [0.026, 0.017, 0.01], 4, () => 0.5);
    tube(m, [[0.01, 0.36, 0], [-0.1, 0.5, 0.06], [-0.22, 0.6, 0.12]], [0.026, 0.017, 0.01], 4, () => 0.5);
    lobes.forEach((l, i) => {
      lobeOfCards(m, [l[0], l[1], l[2]], [l[3], l[4], l[3]], 7, LeafTile.Dense, crown, i + 1, rand, { cardScale: 1.7, upBias: 0.5, aspect: 0.9 });
    });
  } else {
    lobes.slice(0, 5).forEach((l, i) => leafyPuff(m, [l[0], l[1], l[2]], [l[3] * 1.1, l[4] * 1.1, l[3] * 1.1], LeafTile.Dense, i + 1, crown, rand() * 3));
  }
  decal(m, 0.62);
  return m;
}

/** Snow gum / alpine: gnarled multi-stem trees with pale trunks and a compact, low, wide crown. */
function snowGumModel(lod: 0 | 1): MeshData {
  const m = newMesh();
  const rand = rng(606 + lod);
  const crown: CrownShape = { c: [0, 0.68, 0], r: [0.5, 0.26, 0.5] };
  const trunkAo = (p: V3): number => 1 - 0.45 * smooth(0.3, 0.7, p[1]);
  const lobes: [number, number, number, number, number][] = [
    [0.02, 0.86, 0, 0.26, 0.14],
    [0.27, 0.68, 0.08, 0.24, 0.13],
    [-0.26, 0.7, -0.08, 0.24, 0.13],
    [0.05, 0.66, -0.27, 0.2, 0.12],
    [-0.1, 0.64, 0.26, 0.2, 0.12],
    [0.34, 0.6, -0.18, 0.16, 0.1],
  ];
  const stems: [V3, V3, V3][] = [
    [[0, 0, 0], [-0.05, 0.3, 0.02], [-0.12, 0.62, 0.05]],
    [[0.01, 0, 0.01], [0.07, 0.32, -0.02], [0.2, 0.6, -0.06]],
    [[0, 0, -0.01], [0.0, 0.4, -0.03], [0.03, 0.78, 0.0]],
  ];
  const nStem = lod === 0 ? 3 : 2;
  for (let i = 0; i < nStem; i++) {
    const st = stems[i]!;
    const mid: V3 = lod === 0 ? st[1] : st[1];
    const pts: V3[] = lod === 0 ? [st[0], mid, st[2]] : [st[0], st[2]];
    tube(m, pts, lod === 0 ? [0.034, 0.026, 0.016] : [0.03, 0.016], lod === 0 ? 7 : 5, trunkAo);
  }
  if (lod === 0) {
    tube(m, [[-0.1, 0.55, 0.04], [-0.2, 0.62, 0.0], [-0.27, 0.68, -0.06]], [0.016, 0.011, 0.007], 4, () => 0.55);
    tube(m, [[0.16, 0.54, -0.05], [0.28, 0.6, 0.0], [0.3, 0.66, 0.06]], [0.016, 0.011, 0.007], 4, () => 0.55);
    lobes.forEach((l, i) => {
      lobeOfCards(m, [l[0], l[1], l[2]], [l[3] * 1.2, l[4] * 1.25, l[3] * 1.2], 8, LeafTile.Eucalypt, crown, i + 1, rand, { cardScale: 2.0, upBias: 0.65 });
    });
  } else {
    lobes.slice(0, 4).forEach((l, i) => leafyPuff(m, [l[0], l[1], l[2]], [l[3] * 1.2, l[4] * 1.25, l[3] * 1.2], LeafTile.Dense, i + 1, crown, rand() * 3));
  }
  decal(m, 0.6);
  return m;
}

/** Pine plantation: conical crown of drooping needle tiers on a straight trunk. */
function coniferModel(lod: 0 | 1): MeshData {
  const m = newMesh();
  tube(m, [[0, 0, 0], [0, 0.4, 0]], [0.03, 0.02], lod === 0 ? 6 : 4, (p) => 1 - 0.5 * smooth(0.1, 0.35, p[1]));
  const tiers = lod === 0 ? 9 : 4;
  const sides = lod === 0 ? 8 : 6;
  for (let k = 0; k < tiers; k++) {
    const t = k / (tiers - 1);
    const yTop = 0.98 - t * 0.7;
    const yBot = Math.max(0.03, yTop - (lod === 0 ? 0.22 : 0.3));
    const rBot = 0.07 + 0.43 * Math.pow(t, 0.85);
    const rTop = 0.3 * rBot;
    const ring: number[][] = [[], []];
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * Math.PI * 2 + k * 0.6;
      const u = s / sides;
      for (let e = 0; e < 2; e++) {
        const r = e === 0 ? rTop : rBot;
        const y = e === 0 ? yTop : yBot;
        const p: V3 = [Math.cos(a) * r, y, Math.sin(a) * r];
        const n = norm([Math.cos(a), 0.55, Math.sin(a)]);
        const ao = clamp01(0.45 + 0.4 * (e === 1 ? 1 : 0.6) + 0.15 * (1 - t)) * (0.75 + 0.25 * smooth(0, 1, yTop));
        ring[e]!.push(vert(m, p, n, tileUv(LeafTile.Needle, u, e === 0 ? 0.8 : 0.04), Part.Leaf, ao, k + 1));
      }
    }
    for (let s = 0; s < sides; s++) m.idx.push(ring[0]![s]!, ring[1]![s]!, ring[0]![s + 1]!, ring[0]![s + 1]!, ring[1]![s]!, ring[1]![s + 1]!);
  }
  decal(m, 0.5);
  return m;
}

/**
 * Shrub (heath mound, understorey): leaf cards sprayed up and out from the base like a bush's foliage, so it reads as a
 * leafy shrub from any side and shows the ladder fuel; `tall` shrubs are narrower and more upright.
 */
function moundModel(kind: 'heath' | 'understorey', lod: 0 | 1): MeshData {
  const m = newMesh();
  const rand = rng((kind === 'heath' ? 707 : 808) + lod);
  const tall = kind === 'understorey';
  const crown: CrownShape = { c: [0, 0.4, 0], r: [0.5, 0.5, 0.5] };
  const n = lod === 0 ? 18 : 7;
  for (let i = 0; i < n; i++) {
    const az = (i / n) * Math.PI * 2 + rand() * 0.5;
    // Lean from the vertical: upright sprays in the middle, spreading ones at the edge.
    const lean = (tall ? 0.1 : 0.2) + (i % 3) * (tall ? 0.2 : 0.23) + rand() * 0.15;
    const reach = tall ? 0.36 : 0.5;
    const dir: V3 = norm([Math.cos(az) * Math.sin(lean) * reach * 2, Math.cos(lean), Math.sin(az) * Math.sin(lean) * reach * 2]);
    const L = (tall ? 0.72 : 0.62) * (0.8 + 0.35 * rand());
    const start: V3 = [Math.cos(az) * 0.07 * rand(), 0.02, Math.sin(az) * 0.07 * rand()];
    const centre = add(start, mul(dir, L / 2));
    const right: V3 = [-Math.sin(az), 0, Math.cos(az)];
    const hw = (tall ? 0.22 : 0.3) * (0.85 + 0.3 * rand());
    card(m, centre, right, dir, hw, L / 2, LeafTile.Heath, [0, 0.05, 0], crown, 0, rand() < 0.5);
  }
  return m;
}

/** Grass tuft: crossed cards textured with fanning blades. */
function tuftModel(lod: 0 | 1): MeshData {
  const m = newMesh();
  const crown: CrownShape = { c: [0, 0.5, 0], r: [0.5, 0.5, 0.5] };
  const n = lod === 0 ? 3 : 2;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI + 0.3;
    card(m, [0, 0.5, 0], [Math.cos(a), 0, Math.sin(a)], [0, 1, 0], 0.62, 0.5, LeafTile.Tuft, [0, 0.4, 0], crown, k + 1, k === 1);
  }
  return m;
}

// ─────────────────────────────────────────────────────────────────────────────
// Flat models (simple and coded styles): clean, uniform, low-detail shapes
// ─────────────────────────────────────────────────────────────────────────────

/** Solid ellipsoid from an icosphere (20 triangles, or 80 with `subdivide`), smooth normals: the clean crown of the simple styles. */
function solidBlob(m: MeshData, c: V3, r: V3, lobe: number, ao: (dir: V3) => number, subdivide = false): void {
  const PHI = (1 + Math.sqrt(5)) / 2;
  const verts: V3[] = [[-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0], [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI], [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1]].map((v) => norm(v as V3));
  let faces = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];
  if (subdivide) {
    const mid = new Map<string, number>();
    const midpoint = (i: number, j: number): number => {
      const key = i < j ? `${i}_${j}` : `${j}_${i}`;
      let k = mid.get(key);
      if (k === undefined) {
        k = verts.length;
        verts.push(norm([(verts[i]![0] + verts[j]![0]) / 2, (verts[i]![1] + verts[j]![1]) / 2, (verts[i]![2] + verts[j]![2]) / 2]));
        mid.set(key, k);
      }
      return k;
    };
    const next: number[] = [];
    for (let f = 0; f < faces.length; f += 3) {
      const a0 = faces[f]!;
      const b0 = faces[f + 1]!;
      const c0 = faces[f + 2]!;
      const ab = midpoint(a0, b0);
      const bc = midpoint(b0, c0);
      const ca = midpoint(c0, a0);
      next.push(a0, ab, ca, b0, bc, ab, c0, ca, bc, ab, bc, ca);
    }
    faces = next;
  }
  const ids = verts.map((d) => vert(m, [c[0] + d[0] * r[0], c[1] + d[1] * r[1], c[2] + d[2] * r[2]], d, [0, 0], Part.Solid, ao(d), lobe));
  for (let i = 0; i < faces.length; i += 3) m.idx.push(ids[faces[i]!]!, ids[faces[i + 1]!]!, ids[faces[i + 2]!]!);
}

const flatAo = (d: V3): number => clamp01(0.62 + 0.38 * d[1]);

function flatRound(lod: 0 | 1): MeshData {
  const m = newMesh();
  tube(m, [[0, 0, 0], [0, 0.55, 0]], [0.04, 0.026], lod === 0 ? 6 : 4, (p) => 1 - 0.4 * smooth(0.3, 0.6, p[1]));
  solidBlob(m, [0, 0.72, 0], [0.5, 0.29, 0.5], 1, flatAo, lod === 0);
  decal(m, 0.55);
  return m;
}

function flatCone(lod: 0 | 1): MeshData {
  const m = newMesh();
  tube(m, [[0, 0, 0], [0, 0.25, 0]], [0.04, 0.03], 4, () => 0.7);
  const sides = lod === 0 ? 8 : 6;
  const apex = vert(m, [0, 1, 0], [0, 1, 0], [0, 0], Part.Solid, 1, 1);
  const ring: number[] = [];
  for (let s = 0; s < sides; s++) {
    const a = (s / sides) * Math.PI * 2;
    ring.push(vert(m, [Math.cos(a) * 0.5, 0.2, Math.sin(a) * 0.5], norm([Math.cos(a), 0.6, Math.sin(a)]), [0, 0], Part.Solid, 0.6, 1));
  }
  for (let s = 0; s < sides; s++) m.idx.push(apex, ring[(s + 1) % sides]!, ring[s]!);
  decal(m, 0.5);
  return m;
}

function flatMound(tall: boolean): MeshData {
  const m = newMesh();
  const r: V3 = tall ? [0.5, 0.5, 0.5] : [0.55, 0.42, 0.55];
  solidBlob(m, [0, r[1], 0], r, 1, flatAo, false);
  return m;
}

function flatTuft(): MeshData {
  const m = newMesh();
  // Three blades (triangles) fanning out.
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const tx = -dz;
    const tz = dx;
    const n: V3 = norm([dx, 0.4, dz]);
    const a0 = vert(m, [tx * -0.3 + dx * 0.05, 0, tz * -0.3 + dz * 0.05], n, [0, 0], Part.Solid, 0.7, 1);
    const a1 = vert(m, [tx * 0.3 + dx * 0.05, 0, tz * 0.3 + dz * 0.05], n, [0, 0], Part.Solid, 0.7, 1);
    const a2 = vert(m, [dx * 0.3, 1, dz * 0.3], n, [0, 0], Part.Solid, 1, 1);
    m.idx.push(a0, a1, a2);
  }
  return m;
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────────────

/** Model families: natural = species-shaped and textured; flat = clean low-poly shapes for the simple and coded styles. */
export type ModelFamily = 'natural' | 'flat';
export type Lod = 0 | 1 | 2;

const IMPOSTOR_OF: Record<VegGroup, [natural: Impostor, flat: Impostor]> = {
  [VegGroup.Stringybark]: [Impostor.Eucalypt, Impostor.SimpleRound],
  [VegGroup.Ribbonbark]: [Impostor.Eucalypt, Impostor.SimpleRound],
  [VegGroup.SmoothGum]: [Impostor.Eucalypt, Impostor.SimpleRound],
  [VegGroup.TallWetGum]: [Impostor.TallGum, Impostor.SimpleRound],
  [VegGroup.Rainforest]: [Impostor.Rainforest, Impostor.SimpleRound],
  [VegGroup.SnowGum]: [Impostor.SnowGum, Impostor.SimpleRound],
  [VegGroup.Conifer]: [Impostor.Conifer, Impostor.SimpleCone],
  [VegGroup.Heath]: [Impostor.Heath, Impostor.SimpleMound],
  [VegGroup.Understorey]: [Impostor.Understorey, Impostor.SimpleMound],
  [VegGroup.Grass]: [Impostor.Heath, Impostor.SimpleMound],
};

/** Groups that have a far (billboard) level; the rest are simply not drawn at a distance (they are hidden under the canopy or sub-pixel). */
export const HAS_FAR_LOD: Record<VegGroup, boolean> = {
  [VegGroup.Stringybark]: true,
  [VegGroup.Ribbonbark]: true,
  [VegGroup.SmoothGum]: true,
  [VegGroup.TallWetGum]: true,
  [VegGroup.Rainforest]: true,
  [VegGroup.SnowGum]: true,
  [VegGroup.Conifer]: true,
  [VegGroup.Heath]: true,
  [VegGroup.Understorey]: false,
  [VegGroup.Grass]: false,
};

/** Width of the far billboard in units of the crown width (the silhouettes fill ≈ 80 % of their slot). */
const BILLBOARD_W = 1.28;

const cache = new Map<string, MeshData>();

/** Geometry for a group at a level of detail. Cached: the same object is returned for the same arguments. */
export function treeModel(group: VegGroup, family: ModelFamily, lod: Lod): MeshData {
  const key = `${group}/${family}/${lod}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let m: MeshData;
  if (lod === 2) {
    m = newMesh();
    billboard(m, IMPOSTOR_OF[group][family === 'natural' ? 0 : 1], BILLBOARD_W);
  } else if (family === 'flat') {
    switch (group) {
      case VegGroup.Conifer:
        m = flatCone(lod);
        break;
      case VegGroup.Heath:
        m = flatMound(false);
        break;
      case VegGroup.Understorey:
        m = flatMound(true);
        break;
      case VegGroup.Grass:
        m = flatTuft();
        break;
      default:
        m = flatRound(lod);
    }
  } else {
    switch (group) {
      case VegGroup.Stringybark:
        m = eucalyptModel('stringy', lod);
        break;
      case VegGroup.Ribbonbark:
        m = eucalyptModel('ribbon', lod);
        break;
      case VegGroup.SmoothGum:
        m = eucalyptModel('smooth', lod);
        break;
      case VegGroup.TallWetGum:
        m = tallGumModel(lod);
        break;
      case VegGroup.Rainforest:
        m = rainforestModel(lod);
        break;
      case VegGroup.SnowGum:
        m = snowGumModel(lod);
        break;
      case VegGroup.Conifer:
        m = coniferModel(lod);
        break;
      case VegGroup.Heath:
        m = moundModel('heath', lod);
        break;
      case VegGroup.Understorey:
        m = moundModel('understorey', lod);
        break;
      case VegGroup.Grass:
        m = tuftModel(lod);
        break;
    }
  }
  cache.set(key, m);
  return m;
}

/** Triangles per instance of a group at a level of detail. */
export function modelTriangles(group: VegGroup, family: ModelFamily, lod: Lod): number {
  return triangleCount(treeModel(group, family, lod));
}

/** Bark kind of the three eucalypt groups (others: null). */
export function barkKindOfGroup(g: VegGroup): BarkKind | null {
  return g === VegGroup.Stringybark ? 'stringy' : g === VegGroup.Ribbonbark ? 'ribbon' : g === VegGroup.SmoothGum ? 'smooth' : null;
}
