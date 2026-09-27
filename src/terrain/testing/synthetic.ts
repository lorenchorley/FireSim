/**
 * Analytic test surfaces with known slope, aspect, landforms and shading (used by the terrain tests; handy for
 * other modules' tests too). Pure functions of the grid; no I/O.
 */
import { makeGridSpec, type GridSpec } from '../../core/grid';

export const TEST_ORIGIN = { lat: -33.7, lon: 150.3 };

export function testGrid(extentM = 6000, cellSize = 30): GridSpec {
  return makeGridSpec(TEST_ORIGIN, extentM, cellSize);
}

/** Evaluate z = f(x, y) (local metres) on every cell centre. */
export function surface(g: GridSpec, f: (x: number, y: number) => number): Float32Array {
  const out = new Float32Array(g.nx * g.ny);
  for (let j = 0; j < g.ny; j++) {
    const y = g.y0 + j * g.cellSize;
    for (let i = 0; i < g.nx; i++) out[j * g.nx + i] = f(g.x0 + i * g.cellSize, y);
  }
  return out;
}

/** Plane z = z0 + gx·x + gy·y (gx, gy = dz/dx, dz/dy). */
export const plane = (g: GridSpec, gx: number, gy: number, z0 = 500): Float32Array => surface(g, (x, y) => z0 + gx * x + gy * y);

/** Cone of height H and base radius R centred at (cx, cy), on a base level z0. */
export const cone = (g: GridSpec, H: number, R: number, cx = 0, cy = 0, z0 = 500): Float32Array =>
  surface(g, (x, y) => z0 + H * Math.max(0, 1 - Math.hypot(x - cx, y - cy) / R));

/** Parabolic valley whose axis runs north–south (trough at x = 0), falling towards the south with grade `fall`. */
export const nsValley = (g: GridSpec, a: number, fall: number, z0 = 500): Float32Array => surface(g, (x, y) => z0 + a * x * x + fall * y);

/** Parallel ridges (crests at x = 0, ±λ, …) and valleys (x = ±λ/2, …) of amplitude A, with an optional N–S grade. */
export const corrugated = (g: GridSpec, A: number, lambda: number, gradeNorth = 0, z0 = 600): Float32Array =>
  surface(g, (x, y) => z0 + A * Math.cos((2 * Math.PI * x) / lambda) + gradeNorth * y);

/**
 * An east–west ridge with two summits at (±xp, 0) and a pass (saddle) at the origin.
 * Cross-ridge profile H·exp(−y²/2σy²); along-ridge height factor 0.6 + 0.4·u·e^(1−u), u = x²/xp².
 */
export const saddleRidge = (g: GridSpec, H = 300, xp = 1000, sigmaY = 400, z0 = 400): Float32Array =>
  surface(g, (x, y) => {
    const u = (x * x) / (xp * xp);
    return z0 + H * Math.exp((-y * y) / (2 * sigmaY * sigmaY)) * (0.6 + 0.4 * u * Math.exp(1 - u));
  });

/** East–west gorge of depth D and half-width w (Gaussian cross-section) cut into a plateau at z0. */
export const ewGorge = (g: GridSpec, D = 400, w = 150, z0 = 1000): Float32Array => surface(g, (_x, y) => z0 - D * Math.exp((-y * y) / (2 * w * w)));

/** East–west ridge of height H with Gaussian cross-section (north- and south-facing flanks). */
export const ewRidge = (g: GridSpec, H = 300, sigma = 500, z0 = 400): Float32Array => surface(g, (_x, y) => z0 + H * Math.exp((-y * y) / (2 * sigma * sigma)));

/** Square flat-topped block (mesa) of side `side` and height H with vertical walls, centred at (cx, cy). */
export const mesa = (g: GridSpec, side: number, H: number, cx = 0, cy = 0, z0 = 300): Float32Array =>
  surface(g, (x, y) => (Math.abs(x - cx) <= side / 2 && Math.abs(y - cy) <= side / 2 ? z0 + H : z0));

/** Smooth random terrain: a sum of Gaussian bumps from a seeded LCG (for cross-checks against brute force). */
export function randomHills(g: GridSpec, seed = 1, count = 40, maxH = 250): Float32Array {
  let s = seed >>> 0 || 1;
  const rnd = (): number => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const ext = g.nx * g.cellSize;
  const bumps = Array.from({ length: count }, () => ({
    x: (rnd() - 0.5) * ext,
    y: (rnd() - 0.5) * ext,
    h: (rnd() * 2 - 0.6) * maxH,
    r: 150 + rnd() * 700,
  }));
  return surface(g, (x, y) => {
    let z = 600;
    for (const b of bumps) z += b.h * Math.exp(-((x - b.x) ** 2 + (y - b.y) ** 2) / (2 * b.r * b.r));
    return z;
  });
}
