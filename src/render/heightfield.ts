/**
 * CPU heightfield used by the renderer for placing objects on the ground, clamping the camera above the terrain and
 * picking (ray → ground) without triangle raycasts. Pure TypeScript (no Three.js) so it is unit-testable in Node.
 *
 * Picking marches the camera ray through the domain box in steps of half a cell, then refines the first sign change
 * of (ray height − terrain height) by bisection. On a DEM this is exact to the bilinear surface and costs well under
 * a millisecond for a 400 × 400 grid.
 */
import type { GridSpec } from '../core/grid';

export interface RayHit {
  /** Local metres east / north of the origin. */
  x: number;
  y: number;
  /** Terrain elevation at the hit (m ASL). */
  z: number;
  /** Ray parameter (world units along the ray direction as given). */
  t: number;
}

export class HeightField {
  readonly grid: GridSpec;
  readonly elevation: Float32Array;
  readonly minElevation: number;
  readonly maxElevation: number;
  /** Vertical exaggeration applied to world heights. */
  vex: number;

  constructor(grid: GridSpec, elevation: Float32Array, vex = 1) {
    if (elevation.length !== grid.nx * grid.ny) throw new Error('HeightField: elevation size does not match grid');
    this.grid = grid;
    this.elevation = elevation;
    this.vex = vex;
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k < elevation.length; k++) {
      const v = elevation[k]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    this.minElevation = Number.isFinite(lo) ? lo : 0;
    this.maxElevation = Number.isFinite(hi) ? hi : 0;
  }

  /** Local x/y extents covered by the grid (outer cell centres). */
  get xMin(): number {
    return this.grid.x0;
  }
  get xMax(): number {
    return this.grid.x0 + (this.grid.nx - 1) * this.grid.cellSize;
  }
  get yMin(): number {
    return this.grid.y0;
  }
  get yMax(): number {
    return this.grid.y0 + (this.grid.ny - 1) * this.grid.cellSize;
  }

  /** True if the local point lies within the grid (between the outer cell centres). */
  contains(x: number, y: number): boolean {
    return x >= this.xMin && x <= this.xMax && y >= this.yMin && y <= this.yMax;
  }

  /** Bilinear elevation (m ASL) at a local point, clamped to the grid edge. */
  heightAt(x: number, y: number): number {
    const g = this.grid;
    let fx = (x - g.x0) / g.cellSize;
    let fy = (y - g.y0) / g.cellSize;
    const mx = g.nx - 1;
    const my = g.ny - 1;
    fx = fx < 0 ? 0 : fx > mx ? mx : fx;
    fy = fy < 0 ? 0 : fy > my ? my : fy;
    let i0 = Math.floor(fx);
    let j0 = Math.floor(fy);
    if (i0 >= mx) i0 = mx - 1;
    if (j0 >= my) j0 = my - 1;
    if (i0 < 0) i0 = 0;
    if (j0 < 0) j0 = 0;
    const tx = fx - i0;
    const ty = fy - j0;
    const e = this.elevation;
    const k = j0 * g.nx + i0;
    const a = e[k]!;
    const b = e[k + 1]!;
    const c = e[k + g.nx]!;
    const d = e[k + g.nx + 1]!;
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  }

  /** World-space height (Y) of the terrain under a local point. */
  worldHeightAt(x: number, y: number): number {
    return this.heightAt(x, y) * this.vex;
  }

  /**
   * First intersection of a WORLD-space ray (Y-up; world.z = −local y) with the terrain surface inside the domain.
   * The direction need not be normalised; `t` is returned in multiples of it. Returns null if the ray misses.
   * A ray that starts below the surface (e.g. inside a skirt) returns its entry point into the domain box.
   */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT = Infinity): RayHit | null {
    const vex = this.vex;
    // Domain box in world coordinates.
    const bx0 = this.xMin;
    const bx1 = this.xMax;
    const bz0 = -this.yMax;
    const bz1 = -this.yMin;
    const by0 = this.minElevation * vex - 1e-3;
    const by1 = this.maxElevation * vex + 1e-3;
    let t0 = 0;
    let t1 = maxT;
    const slab = (o: number, d: number, lo: number, hi: number): boolean => {
      if (Math.abs(d) < 1e-12) return o >= lo && o <= hi;
      let a = (lo - o) / d;
      let b = (hi - o) / d;
      if (a > b) [a, b] = [b, a];
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
      return t0 <= t1;
    };
    if (!slab(ox, dx, bx0, bx1) || !slab(oy, dy, by0, by1) || !slab(oz, dz, bz0, bz1)) return null;
    if (!Number.isFinite(t1)) return null;

    const f = (t: number): number => oy + dy * t - this.heightAt(ox + dx * t, -(oz + dz * t)) * vex;
    // Step so that consecutive samples are at most half a cell apart horizontally (and bounded in count).
    const horiz = Math.hypot(dx, dz);
    const span = t1 - t0;
    let dt = horiz > 1e-9 ? (0.5 * this.grid.cellSize) / horiz : span;
    const maxSteps = 4096;
    if (span / dt > maxSteps) dt = span / maxSteps;
    let ta = t0;
    if (f(ta) <= 0) return this.hitAt(ox, oz, dx, dz, ta);
    while (ta < t1) {
      const tb = Math.min(t1, ta + dt);
      const fb = f(tb);
      if (fb <= 0) {
        // Bisection on [ta, tb].
        let lo = ta;
        let hi = tb;
        for (let it = 0; it < 30; it++) {
          const mid = 0.5 * (lo + hi);
          if (f(mid) > 0) lo = mid;
          else hi = mid;
        }
        return this.hitAt(ox, oz, dx, dz, 0.5 * (lo + hi));
      }
      ta = tb;
    }
    return null;
  }

  private hitAt(ox: number, oz: number, dx: number, dz: number, t: number): RayHit {
    const x = ox + dx * t;
    const y = -(oz + dz * t);
    return { x, y, z: this.heightAt(x, y), t };
  }

  /**
   * Resample the heightfield onto a coarser grid of at most `maxN` samples per side (used for the GPU height texture
   * and the decimated mesh). Returns the sample stride and the chosen indices along each axis (always including the
   * last row/column so the mesh reaches the domain edge).
   */
  static decimation(nx: number, ny: number, maxN: number): { stride: number; is: number[]; js: number[] } {
    const stride = Math.max(1, Math.ceil(Math.max(nx, ny) / maxN));
    const axis = (n: number): number[] => {
      const out: number[] = [];
      for (let i = 0; i < n - 1; i += stride) out.push(i);
      out.push(n - 1);
      return out;
    };
    return { stride, is: axis(nx), js: axis(ny) };
  }
}
