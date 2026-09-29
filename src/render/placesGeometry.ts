/**
 * Pure geometry for the "places" layers (roads, fire trails, land-use zones, homes, labels). No Three.js and no DOM, so
 * every builder is unit-testable in Node and cheap enough to run in time slices (see placesLayer.ts).
 *
 * All coordinates are LOCAL metres (x east, y north) about the scenario origin; heights are metres ASL from the
 * renderer's height field. The vertical exaggeration is applied in the shaders, never here.
 */
import type { ContextLayers, PlaceKind, RoadClass, ZoneKind, ZonePolygon } from '../core/places';

export interface Bounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles (colours are sRGB hex "as seen in daylight"; the shaders dim them with the scene light at night)
// ─────────────────────────────────────────────────────────────────────────────

export const ROAD_CLASSES: readonly RoadClass[] = ['motorway', 'primary', 'arterial', 'subarterial', 'distributor', 'local', 'service', 'track', 'path'];
export const ZONE_KINDS: readonly ZoneKind[] = ['residential', 'village', 'envLiving', 'ruralSmall', 'commercial', 'industrial', 'tourist'];

/** Real-world road width (m) per class; on screen a line is never thinner than its style's minimum pixel width. */
export const ROAD_WIDTH_M: Record<RoadClass, number> = {
  motorway: 14,
  primary: 14,
  arterial: 12,
  subarterial: 10,
  distributor: 8,
  local: 6,
  service: 4,
  track: 4,
  path: 2,
};

export const FIRE_TRAIL_WIDTH_M = 5;

/** Ribbon style index: road classes 0–8, the fire trail 9, zone outlines 10–16 (in {@link ZONE_KINDS} order). */
export const FIRE_TRAIL_STYLE = 9;
export const ZONE_STYLE_BASE = 10;
export const STYLE_COUNT = ZONE_STYLE_BASE + 7;

export const roadStyleIndex = (c: RoadClass): number => ROAD_CLASSES.indexOf(c);
export const zoneStyleIndex = (k: ZoneKind): number => ZONE_STYLE_BASE + ZONE_KINDS.indexOf(k);

export interface RibbonStyle {
  /** Inner (fill) colour, sRGB hex. */
  fill: string;
  /** Casing (outline) colour, sRGB hex. */
  casing: string;
  /** Minimum width of the FILL on screen (CSS px). */
  minFillPx: number;
  /** Casing width on each side: at least this many metres and at least this many CSS px. */
  casingM: number;
  casingPx: number;
  /** Fraction of a dash period that is drawn (dashed lines only). */
  duty: number;
  /** Shortest dash period on screen (CSS px): dashes stretch in wide views instead of aliasing. */
  dashMinPx: number;
  /** 1 = opaque. */
  alpha: number;
}

const road = (fill: string, casing: string, minFillPx: number, casingM: number, casingPx: number, duty = 0.62, dashMinPx = 9): RibbonStyle => ({
  fill,
  casing,
  minFillPx,
  casingM,
  casingPx,
  duty,
  dashMinPx,
  alpha: 1,
});

/** Zone fill (sRGB 0–1 + opacity) and the darker outline colour per zone kind. */
export const ZONE_PAINT: Record<ZoneKind, { rgb: [number, number, number]; alpha: number; edge: string }> = {
  residential: { rgb: [0.96, 0.62, 0.15], alpha: 0.46, edge: '#d97a00' },
  village: { rgb: [0.98, 0.78, 0.36], alpha: 0.42, edge: '#d6a020' },
  envLiving: { rgb: [0.62, 0.72, 0.22], alpha: 0.3, edge: '#7f9a1a' },
  ruralSmall: { rgb: [0.94, 0.88, 0.32], alpha: 0.34, edge: '#c2b420' },
  commercial: { rgb: [0.42, 0.62, 0.86], alpha: 0.5, edge: '#3a6ea8' },
  industrial: { rgb: [0.62, 0.62, 0.64], alpha: 0.5, edge: '#6a6a70' },
  tourist: { rgb: [0.66, 0.42, 0.88], alpha: 0.5, edge: '#7a45b0' },
};

/** All ribbon styles, indexed by style id (uploaded as shader uniform arrays). */
export const STYLES: RibbonStyle[] = [
  road('#ff9d1e', '#5c3200', 3.2, 0.5, 1.1), // motorway
  road('#ffb02e', '#5c3a00', 3.2, 0.5, 1.1), // primary
  road('#ffc44a', '#5c4400', 3.0, 0.5, 1.1), // arterial
  road('#ffdb6e', '#5a4c10', 2.8, 0.45, 1.0), // subarterial
  road('#fff1c2', '#544f3c', 2.4, 0.4, 0.9), // distributor
  road('#ffffff', '#4a5560', 2.2, 0.35, 0.9), // local
  road('#e6e9eb', '#4a5560', 1.8, 0.3, 0.8), // service
  road('#cf8a48', '#33200f', 1.8, 0.25, 0.75, 0.62, 9), // track (brown, dashed)
  road('#22190f', '#f6f1e4', 1.5, 0.2, 0.7, 0.42, 7), // path (dark dots)
  // Fire trail: a colour that appears nowhere else in the scene (hot magenta), bold, white halo, always dashed.
  road('#ff2a9d', '#ffffff', 3.6, 0.7, 1.5, 0.66, 16),
  ...ZONE_KINDS.map((k) => road(ZONE_PAINT[k].edge, '#ffffff', 1.3, 0.15, 0.55, 1, 9)),
];
// Zone outlines are translucent so they never shout over the fire or the photo.
for (let i = ZONE_STYLE_BASE; i < STYLE_COUNT; i++) STYLES[i]!.alpha = 0.85;

// ─────────────────────────────────────────────────────────────────────────────
// Polylines: clipping, resampling, ribbons
// ─────────────────────────────────────────────────────────────────────────────

/** Clip a polyline [x0, y0, x1, y1, ...] to a rectangle. Consecutive inside portions stay one piece. */
export function clipPolyline(xy: ArrayLike<number>, b: Bounds): Float32Array[] {
  const n = xy.length >> 1;
  const out: Float32Array[] = [];
  let cur: number[] = [];
  const flush = (): void => {
    if (cur.length >= 4) out.push(Float32Array.from(cur));
    cur = [];
  };
  for (let i = 0; i + 1 < n; i++) {
    const ax = xy[2 * i]!;
    const ay = xy[2 * i + 1]!;
    const bx = xy[2 * i + 2]!;
    const by = xy[2 * i + 3]!;
    // Liang–Barsky.
    let t0 = 0;
    let t1 = 1;
    const dx = bx - ax;
    const dy = by - ay;
    const p = [-dx, dx, -dy, dy];
    const q = [ax - b.xMin, b.xMax - ax, ay - b.yMin, b.yMax - ay];
    let inside = true;
    for (let k = 0; k < 4; k++) {
      if (p[k] === 0) {
        if (q[k]! < 0) {
          inside = false;
          break;
        }
      } else {
        const r = q[k]! / p[k]!;
        if (p[k]! < 0) {
          if (r > t1) {
            inside = false;
            break;
          }
          if (r > t0) t0 = r;
        } else {
          if (r < t0) {
            inside = false;
            break;
          }
          if (r < t1) t1 = r;
        }
      }
    }
    if (!inside || t0 > t1) {
      flush();
      continue;
    }
    // Exact end points when nothing was clipped, so consecutive segments join bit-for-bit.
    const sx = t0 === 0 ? ax : ax + dx * t0;
    const sy = t0 === 0 ? ay : ay + dy * t0;
    const ex = t1 === 1 ? bx : ax + dx * t1;
    const ey = t1 === 1 ? by : ay + dy * t1;
    const last = cur.length;
    if (last === 0) cur.push(sx, sy);
    else if (cur[last - 2] !== sx || cur[last - 1] !== sy) {
      flush(); // the line left the rectangle and came back
      cur.push(sx, sy);
    }
    cur.push(ex, ey);
    if (t1 < 1) flush(); // left the rectangle
  }
  flush();
  return out;
}

/**
 * Resample a polyline so that no segment is longer than `maxStep` metres (original vertices are kept). Returns the
 * points and the distance along the line at each.
 */
export function resamplePolyline(xy: ArrayLike<number>, maxStep: number): { xy: Float32Array; along: Float32Array } {
  const n = xy.length >> 1;
  if (n === 0) return { xy: new Float32Array(0), along: new Float32Array(0) };
  // Count first so the arrays are allocated once.
  let count = 1;
  for (let i = 1; i < n; i++) {
    const l = Math.hypot(xy[2 * i]! - xy[2 * i - 2]!, xy[2 * i + 1]! - xy[2 * i - 1]!);
    count += Math.max(1, Math.ceil(l / maxStep));
  }
  const out = new Float32Array(count * 2);
  const along = new Float32Array(count);
  out[0] = xy[0]!;
  out[1] = xy[1]!;
  let k = 1;
  let d = 0;
  for (let i = 1; i < n; i++) {
    const ax = xy[2 * i - 2]!;
    const ay = xy[2 * i - 1]!;
    const bx = xy[2 * i]!;
    const by = xy[2 * i + 1]!;
    const l = Math.hypot(bx - ax, by - ay);
    const m = Math.max(1, Math.ceil(l / maxStep));
    for (let s = 1; s <= m; s++) {
      const t = s / m;
      out[2 * k] = s === m ? bx : ax + (bx - ax) * t;
      out[2 * k + 1] = s === m ? by : ay + (by - ay) * t;
      along[k] = d + l * t;
      k++;
    }
    d += l;
  }
  return { xy: out, along };
}

/** Floats per ribbon vertex: x, y, z(ASL), offset xy, across, half-width (m), along (m), dash period (m), style. */
export const RIBBON_STRIDE = 10;

export interface RibbonMeshData {
  /** Interleaved vertices ({@link RIBBON_STRIDE} floats). */
  data: Float32Array;
  index: Uint16Array | Uint32Array;
  vertexCount: number;
  triangleCount: number;
}

export interface RibbonLineOptions {
  style: number;
  /** Real-world width (m). */
  widthM: number;
  /** Dash period in metres (0 = solid). */
  periodM: number;
  /** A ring: the last point joins the first. */
  closed?: boolean;
  /** Longest segment (m) after resampling (default 20). */
  maxStep?: number;
}

/**
 * Accumulates draped, mitred line ribbons into one interleaved vertex buffer. Two vertices per resampled point,
 * offset sideways in the vertex shader by the (screen-size dependent) half-width times `offset`, so the geometry never
 * has to be rebuilt when the camera moves.
 */
export class RibbonBuilder {
  private data = new Float32Array(2048 * RIBBON_STRIDE);
  private idx = new Uint32Array(6 * 2048);
  private nv = 0;
  private ni = 0;

  get vertexCount(): number {
    return this.nv;
  }

  private ensure(extraV: number, extraI: number): void {
    if ((this.nv + extraV) * RIBBON_STRIDE > this.data.length) {
      const d = new Float32Array(Math.max(this.data.length * 2, (this.nv + extraV) * RIBBON_STRIDE));
      d.set(this.data.subarray(0, this.nv * RIBBON_STRIDE));
      this.data = d;
    }
    if (this.ni + extraI > this.idx.length) {
      const d = new Uint32Array(Math.max(this.idx.length * 2, this.ni + extraI));
      d.set(this.idx.subarray(0, this.ni));
      this.idx = d;
    }
  }

  /** Add one polyline (already clipped to the terrain), draped with `heightAt`. */
  addLine(xy: ArrayLike<number>, heightAt: (x: number, y: number) => number, o: RibbonLineOptions): void {
    let src = xy;
    if (o.closed && xy.length >= 4 && (xy[0] !== xy[xy.length - 2] || xy[1] !== xy[xy.length - 1])) {
      const c = new Float32Array(xy.length + 2);
      for (let i = 0; i < xy.length; i++) c[i] = xy[i]!;
      c[xy.length] = xy[0]!;
      c[xy.length + 1] = xy[1]!;
      src = c;
    }
    const rs = resamplePolyline(src, o.maxStep ?? 20);
    // Drop points closer than 5 cm to their predecessor (degenerate tangents).
    const P: number[] = [];
    const A: number[] = [];
    for (let i = 0; i < rs.along.length; i++) {
      const x = rs.xy[2 * i]!;
      const y = rs.xy[2 * i + 1]!;
      const m = P.length;
      if (m >= 2 && Math.hypot(x - P[m - 2]!, y - P[m - 1]!) < 0.05) continue;
      P.push(x, y);
      A.push(rs.along[i]!);
    }
    const n = P.length >> 1;
    if (n < 2) return;
    // Segment tangents.
    const tx = new Float32Array(n - 1);
    const ty = new Float32Array(n - 1);
    for (let i = 0; i < n - 1; i++) {
      const dx = P[2 * i + 2]! - P[2 * i]!;
      const dy = P[2 * i + 3]! - P[2 * i + 1]!;
      const l = Math.hypot(dx, dy) || 1;
      tx[i] = dx / l;
      ty[i] = dy / l;
    }
    const ring = !!o.closed && n > 3 && P[0] === P[2 * n - 2] && P[1] === P[2 * n - 1];
    this.ensure(2 * n, 6 * (n - 1));
    const base = this.nv;
    const d = this.data;
    for (let i = 0; i < n; i++) {
      // Left normal of the incoming and outgoing segments; a ring wraps around its seam.
      let i0 = i - 1;
      let i1 = i;
      if (i === 0) i0 = ring ? n - 2 : 0;
      if (i === n - 1) i1 = ring ? 0 : n - 2;
      if (i0 < 0) i0 = 0;
      const n0x = -ty[i0]!;
      const n0y = tx[i0]!;
      const n1x = -ty[i1]!;
      const n1y = tx[i1]!;
      let mx = n0x + n1x;
      let my = n0y + n1y;
      const ml = Math.hypot(mx, my);
      let ox: number;
      let oy: number;
      if (ml < 1e-4) {
        ox = n0x;
        oy = n0y;
      } else {
        mx /= ml;
        my /= ml;
        // Mitre length 1/cos(half turn), limited so hairpins pinch instead of spiking.
        const s = 1 / Math.max(mx * n0x + my * n0y, 0.45);
        ox = mx * s;
        oy = my * s;
      }
      const x = P[2 * i]!;
      const y = P[2 * i + 1]!;
      const z = heightAt(x, y);
      for (let side = 0; side < 2; side++) {
        const o0 = (base + 2 * i + side) * RIBBON_STRIDE;
        d[o0] = x;
        d[o0 + 1] = y;
        d[o0 + 2] = z;
        d[o0 + 3] = ox;
        d[o0 + 4] = oy;
        d[o0 + 5] = side === 0 ? 1 : -1;
        d[o0 + 6] = o.widthM / 2;
        d[o0 + 7] = A[i]!;
        d[o0 + 8] = o.periodM;
        d[o0 + 9] = o.style;
      }
    }
    const ix = this.idx;
    let q = this.ni;
    for (let i = 0; i < n - 1; i++) {
      const a = base + 2 * i;
      ix[q++] = a;
      ix[q++] = a + 1;
      ix[q++] = a + 2;
      ix[q++] = a + 1;
      ix[q++] = a + 3;
      ix[q++] = a + 2;
    }
    this.nv += 2 * n;
    this.ni = q;
  }

  build(): RibbonMeshData {
    const data = this.data.slice(0, this.nv * RIBBON_STRIDE);
    const src = this.idx.subarray(0, this.ni);
    const index = this.nv > 65535 ? src.slice() : Uint16Array.from(src);
    return { data, index, vertexCount: this.nv, triangleCount: this.ni / 3 };
  }
}

/** Dash period (m) and style of a road segment: unsealed roads and tracks are dashed, sealed roads solid, paths dotted. */
export function roadDash(cls: RoadClass, surface: number): { periodM: number } {
  const w = ROAD_WIDTH_M[cls];
  if (cls === 'path') return { periodM: 6 };
  if (cls === 'track') return { periodM: surface === 1 ? 0 : Math.max(16, w * 4.5) };
  if (surface === 2) return { periodM: Math.max(16, w * 4.5) };
  if (surface === 3) return { periodM: Math.max(22, w * 6) };
  return { periodM: 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Homes
// ─────────────────────────────────────────────────────────────────────────────

export interface HouseGeometryData {
  position: Float32Array;
  normal: Float32Array;
  /** 0 = wall, 1 = roof. */
  part: Float32Array;
  index: Uint16Array;
}

/** Footprint (m) of the unit house: 8 m along the ridge (x), 6.4 m deep (z); walls 3 m, ridge 4.9 m, 1.2 m below ground. */
export const HOUSE = { hx: 4, hz: 3.2, wall: 3, ridge: 4.9, below: -1.2, overhang: 0.35 };

/** A gabled box of 30 vertices and 14 triangles, in metres about the footprint centre (y up, ground at 0). */
export function houseGeometry(): HouseGeometryData {
  const pos: number[] = [];
  const nor: number[] = [];
  const part: number[] = [];
  const idx: number[] = [];
  const { hx, hz, wall, ridge, below, overhang } = HOUSE;
  const quad = (p: number[][], n: number[], pt: number): void => {
    const b = pos.length / 3;
    for (const v of p) {
      pos.push(v[0]!, v[1]!, v[2]!);
      nor.push(n[0]!, n[1]!, n[2]!);
      part.push(pt);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  const tri = (p: number[][], n: number[], pt: number): void => {
    const b = pos.length / 3;
    for (const v of p) {
      pos.push(v[0]!, v[1]!, v[2]!);
      nor.push(n[0]!, n[1]!, n[2]!);
      part.push(pt);
    }
    idx.push(b, b + 1, b + 2);
  };
  // Walls (counter-clockwise seen from outside).
  quad([[-hx, below, hz], [hx, below, hz], [hx, wall, hz], [-hx, wall, hz]], [0, 0, 1], 0);
  quad([[hx, below, -hz], [-hx, below, -hz], [-hx, wall, -hz], [hx, wall, -hz]], [0, 0, -1], 0);
  quad([[hx, below, hz], [hx, below, -hz], [hx, wall, -hz], [hx, wall, hz]], [1, 0, 0], 0);
  quad([[-hx, below, -hz], [-hx, below, hz], [-hx, wall, hz], [-hx, wall, -hz]], [-1, 0, 0], 0);
  // Gables.
  tri([[hx, wall, hz], [hx, wall, -hz], [hx, ridge, 0]], [1, 0, 0], 0);
  tri([[-hx, wall, -hz], [-hx, wall, hz], [-hx, ridge, 0]], [-1, 0, 0], 0);
  // Roof planes with a small overhang.
  const ez = hz + overhang;
  const ex = hx + overhang;
  const eave = wall - 0.2;
  const rise = ridge - eave;
  const ln = Math.hypot(ez, rise);
  quad([[-ex, eave, ez], [ex, eave, ez], [ex, ridge, 0], [-ex, ridge, 0]], [0, ez / ln, rise / ln], 1);
  quad([[ex, eave, -ez], [-ex, eave, -ez], [-ex, ridge, 0], [ex, ridge, 0]], [0, ez / ln, -rise / ln], 1);
  return { position: Float32Array.from(pos), normal: Float32Array.from(nor), part: Float32Array.from(part), index: Uint16Array.from(idx) };
}

/**
 * Per-instance data for the homes: [x, y, zASL, random 0–1] with only the addresses inside `bounds`. The random
 * number (a deterministic hash of the position) sets each house's rotation and size.
 */
export function homeInstances(homes: Float32Array, bounds: Bounds, heightAt: (x: number, y: number) => number, from = 0, to = homes.length >> 1, out?: { data: Float32Array; n: number }): { data: Float32Array; n: number } {
  const res = out ?? { data: new Float32Array(((homes.length >> 1) + 1) * 4), n: 0 };
  for (let i = from; i < to; i++) {
    const x = homes[2 * i]!;
    const y = homes[2 * i + 1]!;
    if (x < bounds.xMin || x > bounds.xMax || y < bounds.yMin || y > bounds.yMax) continue;
    const k = res.n * 4;
    res.data[k] = x;
    res.data[k + 1] = y;
    res.data[k + 2] = heightAt(x, y);
    res.data[k + 3] = hash2(x, y);
    res.n++;
  }
  return res;
}

/** Deterministic hash of a position to [0, 1). */
export function hash2(x: number, y: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

// ─────────────────────────────────────────────────────────────────────────────
// Labels
// ─────────────────────────────────────────────────────────────────────────────

/** Place kinds and the four main road classes get labels. */
export type LabelKind = PlaceKind | 'road-motorway' | 'road-primary' | 'road-arterial' | 'road-subarterial';

export interface LabelStyle {
  /** Text size (CSS px) at the reference distance. */
  sizePx: number;
  /** Selection priority (higher wins a collision). */
  priority: number;
  /** Farthest camera distance (m) at which it is shown (fades out over the last 25 %). */
  range: number;
  bold: boolean;
  /** Hex text colour. */
  colour: string;
}

export const LABEL_STYLES: Record<LabelKind, LabelStyle> = {
  city: { sizePx: 19, priority: 100, range: 60000, bold: true, colour: '#ffffff' },
  region: { sizePx: 16, priority: 92, range: 60000, bold: true, colour: '#f2f4f8' },
  town: { sizePx: 17, priority: 90, range: 40000, bold: true, colour: '#ffffff' },
  village: { sizePx: 15, priority: 80, range: 22000, bold: true, colour: '#ffffff' },
  suburb: { sizePx: 14, priority: 70, range: 16000, bold: false, colour: '#ffffff' },
  locality: { sizePx: 13, priority: 60, range: 11000, bold: false, colour: '#f2f4f8' },
  'road-motorway': { sizePx: 12, priority: 58, range: 6500, bold: true, colour: '#ffe2a0' },
  'road-primary': { sizePx: 12, priority: 56, range: 6500, bold: true, colour: '#ffe2a0' },
  'road-arterial': { sizePx: 11.5, priority: 50, range: 5000, bold: false, colour: '#ffe9b8' },
  'road-subarterial': { sizePx: 11, priority: 40, range: 3600, bold: false, colour: '#ffeec6' },
};

export interface LabelCandidate {
  text: string;
  /** Same road / same place: labels of one group are kept apart on screen. */
  group: string;
  kind: LabelKind;
  x: number;
  y: number;
}

const ROAD_LABEL_CLASSES = new Set<RoadClass>(['motorway', 'primary', 'arterial', 'subarterial']);

/**
 * Candidate labels: the places of the context and, for the main roads (motorway … sub-arterial, named only), one
 * anchor every `spacing` metres along each road so a name is near the middle of the view wherever you look.
 * Places and anchors outside `bounds` are dropped; duplicate place names within 600 m keep the higher-ranked one.
 */
export function buildLabelCandidates(ctx: ContextLayers, bounds: Bounds, spacing = 900): LabelCandidate[] {
  const out: LabelCandidate[] = [];
  const inside = (x: number, y: number): boolean => x >= bounds.xMin && x <= bounds.xMax && y >= bounds.yMin && y <= bounds.yMax;
  const ranked = ctx.places.slice().sort((a, b) => LABEL_STYLES[b.kind].priority - LABEL_STYLES[a.kind].priority);
  const kept: { name: string; x: number; y: number }[] = [];
  for (const p of ranked) {
    if (!p.name || !inside(p.x, p.y)) continue;
    if (kept.some((k) => k.name === p.name.toLowerCase() && Math.hypot(k.x - p.x, k.y - p.y) < 600)) continue;
    kept.push({ name: p.name.toLowerCase(), x: p.x, y: p.y });
    out.push({ text: p.name, group: `p:${p.name.toLowerCase()}`, kind: p.kind, x: p.x, y: p.y });
  }
  // Roads: walk each named line; carry the distance since the last anchor per name so the spacing continues across
  // the many short pieces one road is split into.
  const carry = new Map<string, number>();
  const anchored = new Set<string>();
  const longest = new Map<string, { len: number; x: number; y: number; cls: RoadClass; text: string }>();
  for (const r of ctx.roads) {
    if (!r.name || !ROAD_LABEL_CLASSES.has(r.cls)) continue;
    const key = r.name.toLowerCase();
    const n = r.xy.length >> 1;
    if (n < 2) continue;
    const best = longest.get(key);
    if (!best || r.lengthM > best.len) {
      const m = n >> 1; // middle vertex
      longest.set(key, { len: r.lengthM, x: r.xy[2 * m]!, y: r.xy[2 * m + 1]!, cls: r.cls, text: r.name });
    }
    let since = carry.get(key) ?? spacing * 0.5; // the first anchor sits half a spacing in
    for (let i = 1; i < n; i++) {
      const ax = r.xy[2 * i - 2]!;
      const ay = r.xy[2 * i - 1]!;
      const bx = r.xy[2 * i]!;
      const by = r.xy[2 * i + 1]!;
      const l = Math.hypot(bx - ax, by - ay);
      if (l === 0) continue;
      let pos = 0;
      while (since + (l - pos) >= spacing) {
        pos += spacing - since;
        since = 0;
        const x = ax + ((bx - ax) * pos) / l;
        const y = ay + ((by - ay) * pos) / l;
        if (inside(x, y)) {
          out.push({ text: r.name, group: `r:${key}`, kind: `road-${r.cls}` as LabelKind, x, y });
          anchored.add(key);
        }
      }
      since += l - pos;
    }
    carry.set(key, since);
  }
  // Every named main road gets at least one anchor (its longest piece).
  for (const [key, b] of longest) {
    if (!anchored.has(key) && inside(b.x, b.y)) out.push({ text: b.text, group: `r:${key}`, kind: `road-${b.cls}` as LabelKind, x: b.x, y: b.y });
  }
  return out;
}

export interface ScreenItem {
  /** Centre in CSS px. */
  x: number;
  y: number;
  /** Size in CSS px. */
  w: number;
  h: number;
  priority: number;
  /** Numeric group id (same road / place). */
  group: number;
}

/**
 * Greedy label placement: highest priority first; a label is dropped if its box (grown by `pad`) overlaps an accepted
 * one, or if it belongs to the same group as an accepted label closer than `sameGroupGap` px. Returns the indices of
 * the accepted items, best first, at most `max` of them.
 */
export function selectLabels(items: readonly ScreenItem[], max = 30, pad = 5, sameGroupGap = 280): number[] {
  const order = items.map((_, i) => i).sort((a, b) => items[b]!.priority - items[a]!.priority || a - b);
  const acc: number[] = [];
  for (const i of order) {
    if (acc.length >= max) break;
    const a = items[i]!;
    let ok = true;
    for (const j of acc) {
      const b = items[j]!;
      if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 + pad && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + pad) {
        ok = false;
        break;
      }
      if (a.group === b.group && Math.hypot(a.x - b.x, a.y - b.y) < sameGroupGap) {
        ok = false;
        break;
      }
    }
    if (ok) acc.push(i);
  }
  return acc;
}

/**
 * True when the straight line from the camera to a point is not blocked by the terrain (heights × `vex`). The last
 * `tail` metres before the target are ignored so a label on a slope does not hide itself.
 */
export function lineOfSightClear(
  heightAt: (x: number, y: number) => number,
  vex: number,
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  stepM = 60,
  tail = 30,
): boolean {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy);
  if (len < 1) return true;
  const steps = Math.min(64, Math.max(2, Math.ceil(len / stepM)));
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    if ((1 - t) * len < tail) break;
    const x = from[0] + dx * t;
    const y = from[1] + dy * t;
    const z = from[2] + (to[2] - from[2]) * t;
    if (heightAt(x, y) * vex > z + 2) return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Zone raster
// ─────────────────────────────────────────────────────────────────────────────

export interface ZoneFrame {
  /** South-west corner (m) and side length (m) of the square covered by the texture. */
  x0: number;
  y0: number;
  size: number;
}

/** Square texture frame around all zone vertices (padded by 120 m, at least 1.5 km wide), or null without zones. */
export function zoneFrame(zones: readonly ZonePolygon[], bounds: Bounds): ZoneFrame | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const z of zones) {
    for (const ring of z.rings) {
      for (let i = 0; i + 1 < ring.length; i += 2) {
        const x = ring[i]!;
        const y = ring[i + 1]!;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (!(x1 > x0) || !(y1 > y0)) return null;
  x0 = Math.max(x0, bounds.xMin);
  x1 = Math.min(x1, bounds.xMax);
  y0 = Math.max(y0, bounds.yMin);
  y1 = Math.min(y1, bounds.yMax);
  if (!(x1 > x0) || !(y1 > y0)) return null;
  const pad = 120;
  const size = Math.max(1500, Math.max(x1 - x0, y1 - y0) + 2 * pad);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return { x0: cx - size / 2, y0: cy - size / 2, size };
}

const srgbToLinear = (v: number): number => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

/**
 * Rasterise the zones into a square RGBA8 texture, PREMULTIPLIED and in LINEAR colour (so the GPU's bilinear filtering
 * and mipmaps blend correctly and the shader can just add it). Coverage is exact to 1/4 pixel vertically and
 * analytic horizontally (even-odd rule, holes handled). Row 0 is the south edge, like every grid in the app.
 */
export function rasterizeZones(zones: readonly ZonePolygon[], frame: ZoneFrame, n: number, out: Uint8Array = new Uint8Array(n * n * 4), from = 0, to = zones.length): Uint8Array {
  const texel = frame.size / n;
  const SS = 4;
  for (let zi = from; zi < to; zi++) {
    const z = zones[zi]!;
    const paint = ZONE_PAINT[z.kind];
    if (!paint) continue;
    // Row range of this polygon.
    let minY = Infinity;
    let maxY = -Infinity;
    for (const ring of z.rings) {
      for (let i = 1; i < ring.length; i += 2) {
        const py = (ring[i]! - frame.y0) / texel;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
    }
    const r0 = Math.max(0, Math.floor(minY));
    const r1 = Math.min(n - 1, Math.floor(maxY));
    if (r1 < r0) continue;
    const rows = r1 - r0 + 1;
    const xs: number[][] = new Array(rows * SS);
    for (const ring of z.rings) {
      const m = ring.length >> 1;
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % m;
        const ax = (ring[2 * i]! - frame.x0) / texel;
        const ay = (ring[2 * i + 1]! - frame.y0) / texel;
        const bx = (ring[2 * j]! - frame.x0) / texel;
        const by = (ring[2 * j + 1]! - frame.y0) / texel;
        if (ay === by) continue;
        const lo = Math.min(ay, by);
        const hi = Math.max(ay, by);
        // Sub-scanline centres at (row + (k + 0.5) / SS); crossing when lo <= yc < hi.
        let s0 = Math.ceil(lo * SS - 0.5);
        let s1 = Math.ceil(hi * SS - 0.5) - 1;
        s0 = Math.max(s0, r0 * SS);
        s1 = Math.min(s1, (r1 + 1) * SS - 1);
        const slope = (bx - ax) / (by - ay);
        for (let s = s0; s <= s1; s++) {
          const yc = (s + 0.5) / SS;
          const x = ax + (yc - ay) * slope;
          const list = xs[s - r0 * SS];
          if (list) list.push(x);
          else xs[s - r0 * SS] = [x];
        }
      }
    }
    // Coverage per row, then composite.
    const cr = srgbToLinear(paint.rgb[0]);
    const cg = srgbToLinear(paint.rgb[1]);
    const cb = srgbToLinear(paint.rgb[2]);
    const cov = new Float32Array(n);
    for (let r = 0; r < rows; r++) {
      let touched = false;
      let cMin = n;
      let cMax = -1;
      for (let k = 0; k < SS; k++) {
        const list = xs[r * SS + k];
        if (!list || list.length < 2) continue;
        list.sort((p, q) => p - q);
        for (let a = 0; a + 1 < list.length; a += 2) {
          const xa = Math.max(0, Math.min(n, list[a]!));
          const xb = Math.max(0, Math.min(n, list[a + 1]!));
          if (xb <= xa) continue;
          const ia = Math.floor(xa);
          const ib = Math.min(n - 1, Math.floor(xb));
          if (ia === ib) cov[ia] = cov[ia]! + (xb - xa) / SS;
          else {
            cov[ia] = cov[ia]! + (ia + 1 - xa) / SS;
            for (let i = ia + 1; i < ib; i++) cov[i] = cov[i]! + 1 / SS;
            cov[ib] = cov[ib]! + (xb - ib) / SS;
          }
          touched = true;
          if (ia < cMin) cMin = ia;
          if (ib > cMax) cMax = ib;
        }
      }
      if (!touched) continue;
      const row = (r0 + r) * n;
      for (let i = cMin; i <= cMax; i++) {
        const c = cov[i]!;
        if (c <= 0) continue;
        cov[i] = 0;
        const a = paint.alpha * Math.min(1, c);
        const o = (row + i) * 4;
        const inv = 1 - a;
        out[o] = Math.round(cr * a * 255 + out[o]! * inv);
        out[o + 1] = Math.round(cg * a * 255 + out[o + 1]! * inv);
        out[o + 2] = Math.round(cb * a * 255 + out[o + 2]! * inv);
        out[o + 3] = Math.round(a * 255 + out[o + 3]! * inv);
      }
    }
  }
  return out;
}
