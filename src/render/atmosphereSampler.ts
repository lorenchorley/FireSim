/**
 * CPU sampling of the atmosphere fields for particles, the plume, the vertical cross-section and the air slice (pure; no
 * Three.js). The view's 3-D fields are k = (z·ny + j)·nx + i and come in two layouts (core/airView.ts):
 *   flat              level l is `levels[l]` m above the datum for every column; cells below the terrain hold zero
 *                     (views made before the terrain-following layout existed: dev scenario, 2-D mock, test fixtures)
 *   terrain-following the model's native arrays: level l of column c is at `h0 + levels[l] · J` above the datum, with
 *                     h0 = terrainHeight[c] and J = 1 − h0 / topM. The sampler does what the engine's own `sample()` does
 *                     (Atmosphere.sampleAt, DiagnosticWind.sampleBg): per column of the four-column stencil it works out
 *                     ζ = (zAsl − baseM − h0) / J, finds the level by binary search and interpolates linearly in ζ, then
 *                     blends the four columns bilinearly. Nothing is resampled, so nothing below the ground leaks in.
 * Below the first level centre a sample takes level 0 (like the engine); above the top it takes the top level. The datum
 * is the view's own `baseM` when it has one, else the `base` the caller estimated.
 *
 * Allocation: spike S3 measured that a method taking and returning doubles is boxed (48 bytes per call) unless V8 inlines
 * it, which it does not for a loop of tens of thousands of calls. `windP` and `fieldsP` therefore take their position in
 * a Float64Array and write the answer to a Float32Array, and allocate nothing, whether or not V8 inlines the blend (two tests
 * measure it). `wind`, `surfaceWind`, `theta`, `smoke` and `sample3` keep their old signatures for the layers that call them
 * a few thousand times a frame; each double argument of a call V8 does not inline costs a heap number (16 bytes), so a loop
 * that must not allocate calls `windP`.
 * Without an atmosphere, or one that holds no wind, the sampler falls back to the ambient wind with a power-law profile.
 */
import type { GridSpec } from '../core/grid';
import { airHas, airKind, airLayout, type AirKind, type AirLayout } from '../core/airView';
import type { AtmosphereView, WeatherHour } from '../core/types';
import { clamp, windToUV } from '../core/units';

export class AtmosphereSampler {
  readonly atm: AtmosphereView | null;
  /** Elevation (m ASL) of the atmosphere's height datum ("lowest terrain"): the view's `baseM`, else the caller's estimate. */
  readonly base: number;
  readonly layout: AirLayout;
  readonly kind: AirKind;
  /** Which 3-D fields the view really holds (`airHas`, and a usable grid). A field it lacks reads as the fallback or 0. */
  readonly hasWind: boolean;
  readonly hasTheta: boolean;
  readonly hasSmoke: boolean;
  private readonly amb: [number, number];
  private readonly g: GridSpec | null;
  private readonly tf: boolean;
  private readonly nx: number;
  private readonly ny: number;
  private readonly nz: number;
  private readonly plane: number;
  /** Offset to the level above (0 for a one-level view, so the blend never reads past the array). */
  private readonly dk: number;
  private readonly x0: number;
  private readonly y0: number;
  private readonly invCell: number;
  private readonly topM: number;
  private readonly invTop: number;
  private readonly lv: Float32Array;
  private readonly h0: Float32Array;
  // Scratch of the last lookup: the four stencil columns, their horizontal weights, the level below and the fraction up
  // to the next one in each. Written by `locate`, read by the blends. No lookup allocates.
  private readonly pos = new Float64Array(4);
  private readonly sc = new Int32Array(4);
  private readonly qw = new Float64Array(4);
  private readonly sk = new Int32Array(4);
  private readonly st = new Float64Array(4);
  /** The answers of the last blends (see `blendTo`). */
  private readonly acc = new Float64Array(3);

  /**
   * @param atm      atmosphere view (null → ambient fallback)
   * @param base     m ASL of the atmosphere's height datum, used when the view does not carry its own `baseM`
   * @param ambient  ambient weather (10 m wind) for the fallback / above the model top
   */
  constructor(atm: AtmosphereView | null | undefined, base: number, ambient: WeatherHour | null) {
    this.atm = atm ?? null;
    this.g = atm?.grid ?? null;
    this.base = atm?.baseM ?? base;
    this.amb = ambient ? windToUV(ambient.windSpeed10, ambient.windDir10) : [0, 0];
    this.layout = airLayout(atm);
    this.kind = airKind(atm);
    const g = this.g;
    const usable = !!atm && !!g && atm.nz > 0 && g.nx >= 2 && g.ny >= 2 && atm.levels.length >= atm.nz;
    const plane = g ? g.nx * g.ny : 0;
    // A view that claims the terrain-following layout without its terrain heights cannot be sampled: it holds no air here.
    const tf = usable && this.layout === 'terrain-following' && atm!.terrainHeight.length >= plane;
    this.tf = tf;
    this.nx = g?.nx ?? 0;
    this.ny = g?.ny ?? 0;
    this.nz = usable ? atm!.nz : 0;
    this.plane = plane;
    this.dk = this.nz > 1 ? plane : 0;
    this.x0 = g?.x0 ?? 0;
    this.y0 = g?.y0 ?? 0;
    this.invCell = g && g.cellSize > 0 ? 1 / g.cellSize : 0;
    const top = atm?.topM;
    this.topM = top !== undefined && top > 0 ? top : 0;
    this.invTop = this.topM > 0 ? 1 / this.topM : 0;
    this.lv = usable ? atm!.levels : new Float32Array(0);
    this.h0 = tf ? atm!.terrainHeight : new Float32Array(0);
    const ok = usable && (this.layout === 'flat' || tf);
    this.hasWind = ok && airHas(atm, 'wind');
    this.hasTheta = ok && airHas(atm, 'theta');
    this.hasSmoke = ok && airHas(atm, 'smoke');
  }

  /** Ambient 10 m wind (u, v). */
  get ambient(): [number, number] {
    return this.amb;
  }

  /** Simulation time (s) of the air the view holds, or null for a view that does not say ("air from 14:05"). */
  get airTime(): number | null {
    return this.atm?.time ?? null;
  }

  /** Horizontal part of a lookup: the four columns around pos[0], pos[1] and their bilinear weights → sc, qw. */
  private horiz(pos: Float64Array): void {
    const nx = this.nx;
    const fx = Math.max(0, Math.min(nx - 1, (pos[0]! - this.x0) * this.invCell));
    const fy = Math.max(0, Math.min(this.ny - 1, (pos[1]! - this.y0) * this.invCell));
    const i0 = Math.min(fx | 0, nx - 2);
    const j0 = Math.min(fy | 0, this.ny - 2);
    const tx = fx - i0;
    const ty = fy - j0;
    const c0 = j0 * nx + i0;
    const sc = this.sc;
    const qw = this.qw;
    sc[0] = c0;
    sc[1] = c0 + 1;
    sc[2] = c0 + nx;
    sc[3] = c0 + nx + 1;
    qw[0] = (1 - tx) * (1 - ty);
    qw[1] = tx * (1 - ty);
    qw[2] = (1 - tx) * ty;
    qw[3] = tx * ty;
  }

  /**
   * A full lookup at pos = (x, y, zAsl): `horiz`, then per stencil column the level below the point and the fraction up to
   * the next level. Flat layout: one search for all four columns. Terrain-following: one per column, in ζ.
   */
  private locate(pos: Float64Array): void {
    this.horiz(pos);
    const lv = this.lv;
    const nz = this.nz;
    const zr = pos[2]! - this.base;
    const sk = this.sk;
    const st = this.st;
    const nq = this.tf ? 4 : 1;
    for (let q = 0; q < nq; q++) {
      let zeta = zr;
      if (this.tf) {
        const h0 = this.h0[this.sc[q]!]!;
        zeta = (zr - h0) / (1 - h0 * this.invTop);
      }
      let k0 = 0;
      let t = 0;
      if (zeta <= lv[0]!) {
        k0 = 0;
        t = 0;
      } else if (zeta >= lv[nz - 1]!) {
        k0 = nz > 1 ? nz - 2 : 0;
        t = 1;
      } else {
        let lo = 0;
        let hi = nz - 1;
        while (hi - lo > 1) {
          const m = (lo + hi) >> 1;
          if (lv[m]! <= zeta) lo = m;
          else hi = m;
        }
        k0 = lo;
        t = (zeta - lv[lo]!) / (lv[lo + 1]! - lv[lo]!);
      }
      sk[q] = k0;
      st[q] = t;
    }
    if (nq === 1) {
      for (let q = 1; q < 4; q++) {
        sk[q] = sk[0]!;
        st[q] = st[0]!;
      }
    }
  }

  /**
   * Blend of one 3-D field over the stencil of the last `locate`, into acc[i]. It hands its answer back through `acc` and not
   * through a return value: a method that returns a double is boxed (a heap number per call) whenever V8 does not inline it,
   * which it declines to do on a busy machine or in a cold loop (atmosphereSampler.alloc.test.ts runs with inlining off).
   */
  private blendTo(f: Float32Array, i: number): void {
    const plane = this.plane;
    const dk = this.dk;
    let s = 0;
    for (let q = 0; q < 4; q++) {
      const o = this.sk[q]! * plane + this.sc[q]!;
      s += this.qw[q]! * (f[o]! + (f[o + dk]! - f[o]!) * this.st[q]!);
    }
    this.acc[i] = s;
  }

  /** The ambient wind with a power-law profile of the height above ground. */
  private ambientWind(agl: number, out: Float32Array | number[]): void {
    const f = profileFactor(agl);
    out[0] = this.amb[0] * f;
    out[1] = this.amb[1] * f;
    out[2] = 0;
  }

  /**
   * Wind (u, v, w; m/s) at pos = (x, y, zAsl[, aglHint]) into out[0..2], allocation-free. The optional aglHint (m above
   * ground) only matters to the ambient fallback, when the view holds no wind.
   */
  windP(pos: Float64Array, out: Float32Array): void {
    if (!this.hasWind) {
      this.ambientWind(pos.length > 3 ? pos[3]! : 0, out);
      return;
    }
    this.locate(pos);
    const a = this.atm!;
    const acc = this.acc;
    this.blendTo(a.u, 0);
    this.blendTo(a.v, 1);
    this.blendTo(a.w, 2);
    out[0] = acc[0]!;
    out[1] = acc[1]!;
    out[2] = acc[2]!;
  }

  /**
   * Every 3-D field at pos = (x, y, zAsl[, aglHint]) from one lookup, into out[0..4] = u, v, w, theta anomaly, smoke
   * (allocation-free). A field the view lacks is 0 (the wind falls back to the ambient one, as `windP` does).
   */
  fieldsP(pos: Float64Array, out: Float32Array): void {
    if (!this.hasWind && !this.hasTheta && !this.hasSmoke) {
      this.ambientWind(pos.length > 3 ? pos[3]! : 0, out);
      out[3] = 0;
      out[4] = 0;
      return;
    }
    this.locate(pos);
    const a = this.atm!;
    const acc = this.acc;
    if (this.hasWind) {
      this.blendTo(a.u, 0);
      this.blendTo(a.v, 1);
      this.blendTo(a.w, 2);
      out[0] = acc[0]!;
      out[1] = acc[1]!;
      out[2] = acc[2]!;
    } else this.ambientWind(pos.length > 3 ? pos[3]! : 0, out);
    if (this.hasTheta) {
      this.blendTo(a.thetaAnomaly, 0);
      out[3] = acc[0]!;
    } else out[3] = 0;
    if (this.hasSmoke) {
      this.blendTo(a.smoke, 0);
      out[4] = acc[0]!;
    } else out[4] = 0;
  }

  /** Bilinear sample of a 2-D atmosphere-grid field. */
  sample2(f: Float32Array, x: number, y: number): number {
    if (!this.g || this.nx < 2) return 0;
    const p = this.pos;
    p[0] = x;
    p[1] = y;
    this.horiz(p);
    return this.qw[0]! * f[this.sc[0]!]! + this.qw[1]! * f[this.sc[1]!]! + this.qw[2]! * f[this.sc[2]!]! + this.qw[3]! * f[this.sc[3]!]!;
  }

  /** Trilinear sample of a 3-D atmosphere field at a local point and elevation (m ASL); 0 for a field the view lacks. */
  sample3(f: Float32Array, x: number, y: number, zAsl: number): number {
    if (this.nz === 0 || f.length < this.plane * this.nz) return 0;
    const p = this.pos;
    p[0] = x;
    p[1] = y;
    p[2] = zAsl;
    this.locate(p);
    this.blendTo(f, 0);
    return this.acc[0]!;
  }

  /** 10 m wind (u, v) at a local point. */
  surfaceWind(x: number, y: number, out: Float32Array | number[]): void {
    const a = this.atm;
    if (!a || this.nx < 2 || a.surfaceU.length < this.plane || a.surfaceV.length < this.plane) {
      out[0] = this.amb[0];
      out[1] = this.amb[1];
      return;
    }
    out[0] = this.sample2(a.surfaceU, x, y);
    out[1] = this.sample2(a.surfaceV, x, y);
  }

  /**
   * Elevation (m ASL) of the model's own, smoothed ground at a local point (the datum plus the view's `terrainHeight`, both
   * layouts), which is what a slice shades as "below the model's ground". The datum itself without an atmosphere.
   */
  modelGroundAt(x: number, y: number): number {
    const a = this.atm;
    if (!a || this.nx < 2 || a.terrainHeight.length < this.plane) return this.base;
    return this.base + this.sample2(a.terrainHeight, x, y);
  }

  /**
   * 3-D wind (u, v, w) at a local point; `aglHint` (m above ground) is used by the fallback's power-law profile.
   */
  wind(x: number, y: number, zAsl: number, aglHint: number, out: Float32Array | number[]): void {
    if (!this.hasWind) {
      this.ambientWind(aglHint, out);
      return;
    }
    const p = this.pos;
    p[0] = x;
    p[1] = y;
    p[2] = zAsl;
    this.locate(p);
    const a = this.atm!;
    const acc = this.acc;
    this.blendTo(a.u, 0);
    this.blendTo(a.v, 1);
    this.blendTo(a.w, 2);
    out[0] = acc[0]!;
    out[1] = acc[1]!;
    out[2] = acc[2]!;
  }

  theta(x: number, y: number, zAsl: number): number {
    return this.hasTheta ? this.sample3(this.atm!.thetaAnomaly, x, y, zAsl) : 0;
  }

  smoke(x: number, y: number, zAsl: number): number {
    return this.hasSmoke ? this.sample3(this.atm!.smoke, x, y, zAsl) : 0;
  }

  /** Model top (m ASL). */
  get top(): number {
    if (!this.atm || this.atm.nz === 0) return this.base + 3000;
    if (this.tf && this.topM > 0) return this.base + this.topM;
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
