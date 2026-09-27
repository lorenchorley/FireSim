/**
 * CPU sampling of the atmosphere fields for particles, the plume and the vertical cross-section (pure; no Three.js).
 *
 * AtmosphereView 3-D fields are on a z-level grid: k = (z·ny + j)·nx + i, level centres `levels[z]` in metres above
 * the lowest terrain (`base` m ASL). Cells below the terrain are masked by the solver (zero wind); sampling below the
 * first level clamps to it. Without an atmosphere the sampler falls back to the ambient wind with a power-law profile.
 */
import type { GridSpec } from '../core/grid';
import type { AtmosphereView, WeatherHour } from '../core/types';
import { clamp, windToUV } from '../core/units';

export class AtmosphereSampler {
  readonly atm: AtmosphereView | null;
  /** Elevation (m ASL) of the atmosphere's height datum ("lowest terrain"). */
  readonly base: number;
  private readonly amb: [number, number];
  private readonly g: GridSpec | null;

  /**
   * @param atm      atmosphere view (null → ambient fallback)
   * @param base     m ASL of the atmosphere's height datum
   * @param ambient  ambient weather (10 m wind) for the fallback / above the model top
   */
  constructor(atm: AtmosphereView | null | undefined, base: number, ambient: WeatherHour | null) {
    this.atm = atm ?? null;
    this.g = atm?.grid ?? null;
    this.base = base;
    this.amb = ambient ? windToUV(ambient.windSpeed10, ambient.windDir10) : [0, 0];
  }

  /** Ambient 10 m wind (u, v). */
  get ambient(): [number, number] {
    return this.amb;
  }

  // Scratch state of the last horizontal / vertical lookup. The sampler is called per particle per frame (wind
  // streaks, embers), so lookups write here instead of returning arrays (no garbage in the render loop).
  private hk = 0;
  private htx = 0;
  private hty = 0;
  private vz0 = 0;
  private vtz = 0;

  /** Fractional horizontal cell coordinates, clamped → hk (index of the SW corner), htx, hty. */
  private hfrac(x: number, y: number): void {
    const g = this.g!;
    const fx = clamp((x - g.x0) / g.cellSize, 0, g.nx - 1.0001);
    const fy = clamp((y - g.y0) / g.cellSize, 0, g.ny - 1.0001);
    const i0 = Math.floor(fx);
    const j0 = Math.floor(fy);
    this.htx = fx - i0;
    this.hty = fy - j0;
    this.hk = j0 * g.nx + i0;
  }

  /** Vertical level index and weight for a height above the datum → vz0, vtz. */
  private vfrac(h: number): void {
    const lv = this.atm!.levels;
    const nz = this.atm!.nz;
    if (nz <= 1 || h <= lv[0]!) {
      this.vz0 = 0;
      this.vtz = 0;
      return;
    }
    if (h >= lv[nz - 1]!) {
      this.vz0 = nz - 2;
      this.vtz = 1;
      return;
    }
    let lo = 0;
    let hi = nz - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (lv[m]! <= h) lo = m;
      else hi = m;
    }
    this.vz0 = lo;
    this.vtz = (h - lv[lo]!) / (lv[lo + 1]! - lv[lo]!);
  }

  /** Bilinear blend of the 4 texels of a horizontal plane starting at offset `o` (uses the last hfrac). */
  private lerp2(f: Float32Array, o: number): number {
    const nx = this.g!.nx;
    const tx = this.htx;
    const ty = this.hty;
    const a = f[o]!;
    const b = f[o + 1]!;
    const c = f[o + nx]!;
    const d = f[o + nx + 1]!;
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  }

  /** Trilinear blend at the last hfrac/vfrac lookup. */
  private lerp3(f: Float32Array): number {
    const plane = this.g!.nx * this.g!.ny;
    const k = this.vz0 * plane + this.hk;
    const lo = this.lerp2(f, k);
    if (this.vtz <= 0 || this.atm!.nz <= 1) return lo;
    return lo + (this.lerp2(f, k + plane) - lo) * this.vtz;
  }

  /** Bilinear sample of a 2-D atmosphere-grid field. */
  sample2(f: Float32Array, x: number, y: number): number {
    this.hfrac(x, y);
    return this.lerp2(f, this.hk);
  }

  /** Trilinear sample of a 3-D atmosphere field at a local point and elevation (m ASL). */
  sample3(f: Float32Array, x: number, y: number, zAsl: number): number {
    this.hfrac(x, y);
    this.vfrac(zAsl - this.base);
    return this.lerp3(f);
  }

  /** 10 m wind (u, v) at a local point. */
  surfaceWind(x: number, y: number, out: Float32Array | number[]): void {
    if (!this.atm) {
      out[0] = this.amb[0];
      out[1] = this.amb[1];
      return;
    }
    this.hfrac(x, y);
    out[0] = this.lerp2(this.atm.surfaceU, this.hk);
    out[1] = this.lerp2(this.atm.surfaceV, this.hk);
  }

  /**
   * 3-D wind (u, v, w) at a local point; `aglHint` (m above ground) is used by the fallback's power-law profile.
   */
  wind(x: number, y: number, zAsl: number, aglHint: number, out: Float32Array | number[]): void {
    if (!this.atm) {
      const f = profileFactor(aglHint);
      out[0] = this.amb[0] * f;
      out[1] = this.amb[1] * f;
      out[2] = 0;
      return;
    }
    // One horizontal + vertical lookup shared by the three components.
    this.hfrac(x, y);
    this.vfrac(zAsl - this.base);
    out[0] = this.lerp3(this.atm.u);
    out[1] = this.lerp3(this.atm.v);
    out[2] = this.lerp3(this.atm.w);
  }

  theta(x: number, y: number, zAsl: number): number {
    return this.atm ? this.sample3(this.atm.thetaAnomaly, x, y, zAsl) : 0;
  }

  smoke(x: number, y: number, zAsl: number): number {
    return this.atm ? this.sample3(this.atm.smoke, x, y, zAsl) : 0;
  }

  /** Model top (m ASL). */
  get top(): number {
    if (!this.atm || this.atm.nz === 0) return this.base + 3000;
    const lv = this.atm.levels;
    const dz = this.atm.nz > 1 ? lv[this.atm.nz - 1]! - lv[this.atm.nz - 2]! : 100;
    return this.base + lv[this.atm.nz - 1]! + dz / 2;
  }
}

/** Wind speed-up with height relative to 10 m (power law, exponent 1/7, capped at 2.5×). */
export function profileFactor(agl: number): number {
  return clamp((Math.max(agl, 1) / 10) ** (1 / 7), 0.6, 2.5);
}

// ─────────────────────────────────────────────────────────────────────────────
// Cross-section geometry
// ─────────────────────────────────────────────────────────────────────────────

export interface SectionLine {
  /** Endpoints (local m) clipped to the domain rectangle. */
  a: [number, number];
  b: [number, number];
  /** Unit vector along the section (east, north) = azimuth direction. */
  dir: [number, number];
  length: number;
}

/**
 * The longest segment through `centre` along `azimuthDeg` (both directions) inside the rectangle, or null if the
 * centre lies outside it.
 */
export function sectionLine(
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number },
  centre: [number, number],
  azimuthDeg: number,
): SectionLine | null {
  const [cx, cy] = centre;
  if (cx < bounds.xMin || cx > bounds.xMax || cy < bounds.yMin || cy > bounds.yMax) return null;
  const az = (azimuthDeg * Math.PI) / 180;
  const dx = Math.sin(az);
  const dy = Math.cos(az);
  // Ray-box exit distances in +dir and −dir.
  const exit = (sx: number, sy: number): number => {
    let t = Infinity;
    if (sx > 1e-12) t = Math.min(t, (bounds.xMax - cx) / sx);
    if (sx < -1e-12) t = Math.min(t, (bounds.xMin - cx) / sx);
    if (sy > 1e-12) t = Math.min(t, (bounds.yMax - cy) / sy);
    if (sy < -1e-12) t = Math.min(t, (bounds.yMin - cy) / sy);
    return t;
  };
  const tf = exit(dx, dy);
  const tb = exit(-dx, -dy);
  const a: [number, number] = [cx - dx * tb, cy - dy * tb];
  const b: [number, number] = [cx + dx * tf, cy + dy * tf];
  return { a, b, dir: [dx, dy], length: tf + tb };
}
