/**
 * Sub-grid plume updraft for the 3-D tiers (spec §9.3; doc 06 §4.3 "hybrid plume").
 *
 * ```
 * w_sg = C_w·F_L^{1/3}·exp(−(z − z0)/z_d)·φ ,  φ = max(0, 1 − d⊥/Δx_a)
 * d⊥ = horizontal distance from the tilted plume axis  x_src + ∫ (U(z')/(C_w F_L^{1/3})) dz' · û
 * F_L = g·χ_c·I/(ρ c_p T) of the plume-source raster (max over burning cells per atmosphere column)
 * ```
 * The field is rebuilt once per atmosphere step (the wind is frozen per step): for every active source column the
 * tilted axis is marched upward in `plumeDz` steps through the frozen wind, and w_sg·φ is max-deposited on the nodes
 * of a small 3-D grid (horizontal spacing Δx_a/2, vertical `plumeDz`, ASL) that covers only the plume footprints.
 * Particles then read w_sg with one trilinear lookup (O(1) per particle-step, independent of the number of burning
 * cells), which keeps the §9.7 budget of ≤ 300 ns per particle-step.
 */
import { EMBER_PARAMS, type EmberParams } from './params';

export type WindFn = (x: number, y: number, zAGL: number, out: Float32Array) => void;

/** Plume source columns collected by `EmberModel.emit` (one per atmosphere column with burning cells). */
export class PlumeSources {
  n = 0;
  x: Float64Array = new Float64Array(64);
  y: Float64Array = new Float64Array(64);
  z0: Float64Array = new Float64Array(64);
  /** C_w·F_L^{1/3} (m/s). */
  w0: Float64Array = new Float64Array(64);
  alpha: Float64Array = new Float64Array(64);

  clear(): void {
    this.n = 0;
  }

  push(x: number, y: number, z0: number, w0: number, alpha: number): number {
    if (this.n === this.x.length) this.grow();
    const s = this.n++;
    this.x[s] = x;
    this.y[s] = y;
    this.z0[s] = z0;
    this.w0[s] = w0;
    this.alpha[s] = alpha;
    return s;
  }

  private grow(): void {
    const g = (a: Float64Array): Float64Array => {
      const b = new Float64Array(a.length * 2);
      b.set(a);
      return b;
    };
    this.x = g(this.x);
    this.y = g(this.y);
    this.z0 = g(this.z0);
    this.w0 = g(this.w0);
    this.alpha = g(this.alpha);
  }
}

export class PlumeField {
  active = false;
  /** Grid origin (node 0), spacing and size. */
  private gx0 = 0;
  private gy0 = 0;
  private h = 100;
  private nx = 0;
  private ny = 0;
  private nz = 0;
  private zBase = 0;
  private dz = 25;
  private w: Float32Array = new Float32Array(0);
  private a: Float32Array = new Float32Array(0);
  /** Axis scratch: per source × level (x, y). */
  private ax: Float64Array = new Float64Array(0);
  private ay: Float64Array = new Float64Array(0);
  private readonly out = new Float32Array(3);
  /** α_p at the last sample (in-plume turbulence). */
  lastAlpha = 0;

  constructor(private readonly p: EmberParams['transport'] = EMBER_PARAMS.transport) {}

  /** Rebuild the field for the given sources, atmosphere cell size and frozen wind. */
  build(src: PlumeSources, dxa: number, wind: WindFn): void {
    const ns = src.n;
    this.active = false;
    if (ns === 0) return;
    const p = this.p;
    const dz = p.plumeDz;
    const nl = Math.max(2, Math.ceil((p.plumeDepthZd * p.zd) / dz) + 1);
    if (this.ax.length < ns * nl) {
      this.ax = new Float64Array(ns * nl);
      this.ay = new Float64Array(ns * nl);
    }
    // March each tilted axis through the frozen wind.
    let xmin = Infinity;
    let xmax = -Infinity;
    let ymin = Infinity;
    let ymax = -Infinity;
    let zmin = Infinity;
    let zmax = -Infinity;
    const out = this.out;
    for (let s = 0; s < ns; s++) {
      let x = src.x[s]!;
      let y = src.y[s]!;
      const w0 = src.w0[s]!;
      for (let l = 0; l < nl; l++) {
        this.ax[s * nl + l] = x;
        this.ay[s * nl + l] = y;
        if (x < xmin) xmin = x;
        if (x > xmax) xmax = x;
        if (y < ymin) ymin = y;
        if (y > ymax) ymax = y;
        // advance to the next level: Δx = (U/(C_w F_L^{1/3}))·Δz along the wind
        wind(x, y, l * dz, out);
        x += (out[0]! / w0) * dz;
        y += (out[1]! / w0) * dz;
      }
      const z0 = src.z0[s]!;
      if (z0 < zmin) zmin = z0;
      if (z0 + (nl - 1) * dz > zmax) zmax = z0 + (nl - 1) * dz;
    }
    const h = dxa / 2;
    this.h = h;
    this.dz = dz;
    this.gx0 = Math.floor((xmin - dxa) / h) * h;
    this.gy0 = Math.floor((ymin - dxa) / h) * h;
    this.nx = Math.ceil((xmax + dxa - this.gx0) / h) + 2;
    this.ny = Math.ceil((ymax + dxa - this.gy0) / h) + 2;
    this.zBase = zmin;
    this.nz = Math.ceil((zmax - zmin) / dz) + 2;
    const size = this.nx * this.ny * this.nz;
    if (this.w.length < size) {
      this.w = new Float32Array(Math.ceil(size * 1.25));
      this.a = new Float32Array(this.w.length);
    } else {
      this.w.fill(0, 0, size);
      this.a.fill(0, 0, size);
    }
    // Deposit w_sg·φ (max over sources) on the nodes within Δx_a of each axis point.
    const nxy = this.nx * this.ny;
    const rNodes = Math.ceil(dxa / h);
    const dxa2 = dxa * dxa;
    const invDxa = 1 / dxa;
    for (let s = 0; s < ns; s++) {
      const w0 = src.w0[s]!;
      const z0 = src.z0[s]!;
      const alpha = src.alpha[s]!;
      for (let l = 0; l < nl; l++) {
        const wl = w0 * Math.exp(-(l * dz) / p.zd);
        if (wl < p.plumeWMin) break;
        const cx = this.ax[s * nl + l]!;
        const cy = this.ay[s * nl + l]!;
        const lev = Math.round((z0 + l * dz - this.zBase) / dz);
        if (lev < 0 || lev >= this.nz) continue;
        const ic = Math.round((cx - this.gx0) / h);
        const jc = Math.round((cy - this.gy0) / h);
        for (let dj = -rNodes; dj <= rNodes; dj++) {
          const j = jc + dj;
          if (j < 0 || j >= this.ny) continue;
          const yn = this.gy0 + j * h;
          for (let di = -rNodes; di <= rNodes; di++) {
            const i = ic + di;
            if (i < 0 || i >= this.nx) continue;
            const xn = this.gx0 + i * h;
            const ddx = xn - cx;
            const ddy = yn - cy;
            const d2 = ddx * ddx + ddy * ddy;
            if (d2 >= dxa2) continue;
            const phi = 1 - Math.sqrt(d2) * invDxa;
            if (phi <= 0) continue;
            const v = wl * phi;
            const idx = lev * nxy + j * this.nx + i;
            if (v > this.w[idx]!) {
              this.w[idx] = v;
              this.a[idx] = alpha;
            }
          }
        }
      }
    }
    this.active = true;
  }

  /** w_sg (m/s) at a point (z ASL); sets `lastAlpha`. 0 outside the plume footprints. */
  sample(x: number, y: number, z: number): number {
    if (!this.active) return 0;
    const fx = (x - this.gx0) / this.h;
    const fy = (y - this.gy0) / this.h;
    const fz = (z - this.zBase) / this.dz;
    if (fx < 0 || fy < 0 || fz < 0) return 0;
    const i = fx | 0;
    const j = fy | 0;
    const l = fz | 0;
    if (i >= this.nx - 1 || j >= this.ny - 1 || l >= this.nz - 1) return 0;
    const tx = fx - i;
    const ty = fy - j;
    const tz = fz - l;
    const nx = this.nx;
    const nxy = nx * this.ny;
    const k = l * nxy + j * nx + i;
    const w = this.w;
    const c00 = w[k]! + (w[k + 1]! - w[k]!) * tx;
    const c10 = w[k + nx]! + (w[k + nx + 1]! - w[k + nx]!) * tx;
    const k1 = k + nxy;
    const c01 = w[k1]! + (w[k1 + 1]! - w[k1]!) * tx;
    const c11 = w[k1 + nx]! + (w[k1 + nx + 1]! - w[k1 + nx]!) * tx;
    const c0 = c00 + (c10 - c00) * ty;
    const c1 = c01 + (c11 - c01) * ty;
    const v = c0 + (c1 - c0) * tz;
    if (v > 0) {
      const a = this.a;
      let am = a[k]!;
      if (a[k + 1]! > am) am = a[k + 1]!;
      if (a[k1]! > am) am = a[k1]!;
      if (a[k + nx]! > am) am = a[k + nx]!;
      this.lastAlpha = am > 0 ? am : this.p.alphaP;
    } else this.lastAlpha = 0;
    return v;
  }
}
