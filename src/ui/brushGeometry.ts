/**
 * Geometry for the fuel brush, fire-line and local-wind tools (pure, unit-tested).
 *
 * A painted brush stroke (a finger path with a radius) must become ONE fuel edit: sending overlapping circles would
 * apply additive hazard changes twice where they overlap. {@link strokeToPolygon} therefore rasterises the stroke's
 * union of discs on a fine local grid, traces the outer boundary along cell edges and simplifies it
 * (Ramer–Douglas–Peucker), giving a simple polygon in local metres that follows curved strokes (roads, gullies).
 */

export type Pt = [number, number];

/** Polygon area (m²), shoelace formula; positive for counter-clockwise rings. */
export function signedArea(poly: readonly Pt[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j]![0] - poly[i]![0]) * (poly[j]![1] + poly[i]![1]);
  return a / 2;
}

export const polygonArea = (poly: readonly Pt[]): number => Math.abs(signedArea(poly));

/** Total length of a polyline (m). */
export function polylineLength(pts: readonly Pt[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
  return L;
}

/**
 * Regular polygon approximating a circle, counter-clockwise. The vertex radius is enlarged slightly so the polygon has
 * the same AREA as the circle (a fuel edit should change the same amount of ground whatever the segment count).
 */
export function circlePolygon(cx: number, cy: number, r: number, segments = 32): Pt[] {
  const n = Math.max(3, Math.round(segments));
  const rv = r * Math.sqrt((2 * Math.PI) / (n * Math.sin((2 * Math.PI) / n)));
  const out: Pt[] = [];
  for (let s = 0; s < n; s++) {
    const a = (2 * Math.PI * s) / n;
    out.push([cx + rv * Math.cos(a), cy + rv * Math.sin(a)]);
  }
  return out;
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Ramer–Douglas–Peucker simplification of an open polyline. */
export function simplifyPolyline(pts: readonly Pt[], tolerance: number): Pt[] {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = distToSegment(pts[i]!, pts[s]!, pts[e]!);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > tolerance) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i] === 1);
}

/** Simplify a closed ring (split at the vertex farthest from the first so both halves are open polylines). */
export function simplifyRing(ring: readonly Pt[], tolerance: number): Pt[] {
  if (ring.length <= 4) return ring.slice();
  let far = 0;
  let farD = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i]![0] - ring[0]![0], ring[i]![1] - ring[0]![1]);
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const a = simplifyPolyline(ring.slice(0, far + 1), tolerance);
  const b = simplifyPolyline([...ring.slice(far), ring[0]!], tolerance);
  const out = [...a.slice(0, -1), ...b.slice(0, -1)];
  return out.length >= 3 ? out : ring.slice();
}

/**
 * Outline polygon (local metres, counter-clockwise) of the union of discs of `radius` centred along the polyline
 * `points`. A single point gives a circle. `cellsPerRadius` sets the raster resolution (default 6 → error ≈ r/6
 * before simplification).
 */
export function strokeToPolygon(points: readonly Pt[], radius: number, cellsPerRadius = 6): Pt[] {
  if (points.length === 0 || !(radius > 0)) return [];
  if (points.length === 1 || polylineLength(points) < radius * 0.25) return circlePolygon(points[0]![0], points[0]![1], radius, 32);
  const cell = radius / cellsPerRadius;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const x0 = minX - radius - 2 * cell;
  const y0 = minY - radius - 2 * cell;
  const nx = Math.ceil((maxX - minX + 2 * radius + 4 * cell) / cell);
  const ny = Math.ceil((maxY - minY + 2 * radius + 4 * cell) / cell);
  if (nx * ny > 4_000_000) return circlePolygon(points[0]![0], points[0]![1], radius, 32); // absurd stroke: bail out
  const mask = new Uint8Array(nx * ny);
  // Rasterise: a cell is inside if its centre is within `radius` of any segment.
  for (let s = 0; s < points.length - 1; s++) {
    const a = points[s]!;
    const b = points[s + 1]!;
    const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - radius - x0) / cell));
    const i1 = Math.min(nx - 1, Math.ceil((Math.max(a[0], b[0]) + radius - x0) / cell));
    const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - radius - y0) / cell));
    const j1 = Math.min(ny - 1, Math.ceil((Math.max(a[1], b[1]) + radius - y0) / cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * nx + i;
        if (mask[k]) continue;
        if (distToSegment([x0 + (i + 0.5) * cell, y0 + (j + 0.5) * cell], a, b) <= radius) mask[k] = 1;
      }
    }
  }
  const ring = traceOuterBoundary(mask, nx, ny);
  if (ring.length < 3) return circlePolygon(points[0]![0], points[0]![1], radius, 32);
  const world: Pt[] = ring.map(([i, j]) => [x0 + i * cell, y0 + j * cell]);
  const simple = simplifyRing(world, cell * 0.75);
  return signedArea(simple) < 0 ? simple.reverse() : simple;
}

/**
 * Trace the outer boundary of the filled region containing the lowest-then-leftmost filled cell, along cell edges.
 * Returns corner coordinates (i, j) in cell units, counter-clockwise (filled region on the left).
 */
export function traceOuterBoundary(mask: Uint8Array, nx: number, ny: number): Pt[] {
  const filled = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < nx && j < ny && mask[j * nx + i] === 1;
  let start = -1;
  for (let k = 0; k < mask.length; k++)
    if (mask[k]) {
      start = k;
      break;
    }
  if (start < 0) return [];
  const si = start % nx;
  const sj = Math.floor(start / nx);
  // Start at the bottom-left corner of the start cell, heading east along its bottom edge (filled cell on the left).
  // Directions: 0 = +x (east), 1 = +y (north), 2 = −x, 3 = −y.
  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];
  let x = si;
  let y = sj;
  let d = 0;
  const out: Pt[] = [[x, y]];
  const maxSteps = 4 * (nx + 1) * (ny + 1);
  for (let step = 0; step < maxSteps; step++) {
    x += DX[d]!;
    y += DY[d]!;
    if (x === si && y === sj) break;
    // At corner (x, y), heading d: the cells ahead-left and ahead-right of the corner decide the turn.
    // For heading east (d = 0): ahead-left = cell (x, y), ahead-right = cell (x, y − 1).
    const [alI, alJ, arI, arJ] = aheadCells(x, y, d);
    const al = filled(alI, alJ);
    const ar = filled(arI, arJ);
    let nd: number;
    if (ar) nd = (d + 3) % 4; // turn right (keeps the region on the left, hugging the outside)
    else if (al) nd = d; // straight
    else nd = (d + 1) % 4; // turn left
    if (nd !== d) out.push([x, y]);
    d = nd;
  }
  return out;
}

/** Cells ahead-left and ahead-right of a corner when moving in direction d. */
function aheadCells(x: number, y: number, d: number): [number, number, number, number] {
  switch (d) {
    case 0:
      return [x, y, x, y - 1];
    case 1:
      return [x - 1, y, x, y];
    case 2:
      return [x - 1, y - 1, x - 1, y];
    default:
      return [x, y - 1, x - 1, y - 1];
  }
}

/** Point-in-polygon for local-metre rings. */
export function pointInRing(x: number, y: number, ring: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Densify-then-thin a finger path: drop points closer than `minSpacing` to the previous kept one. */
export function thinPath(pts: readonly Pt[], minSpacing: number): Pt[] {
  if (pts.length === 0) return [];
  const out: Pt[] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]!;
    const q = out[out.length - 1]!;
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) >= minSpacing || i === pts.length - 1) out.push(p);
  }
  return out;
}

/**
 * Screen rotation (deg, clockwise) of the local-wind glyph so that its arrow points the way the wind blows on screen,
 * whatever the camera heading and tilt: the downwind ground point is projected too. Falls back to a north-up map when
 * that point is off-screen.
 */
export function windScreenRotation(at: Pt, dirFrom: number, q: [number, number], project: (p: Pt) => [number, number] | null): number {
  const rad = (dirFrom * Math.PI) / 180;
  // Wind FROM dirFrom blows towards dirFrom + 180°: unit vector (−sin, −cos) in local x east / y north.
  const q2 = project([at[0] - 150 * Math.sin(rad), at[1] - 150 * Math.cos(rad)]);
  if (!q2) return dirFrom;
  const dx = q2[0] - q[0];
  const dy = q2[1] - q[1];
  if (Math.hypot(dx, dy) < 2) return dirFrom; // looking straight along the wind: keep the north-up estimate
  return Math.round(((Math.atan2(-dx, dy) * 180) / Math.PI) * 2) / 2;
}
