/**
 * Fast tier `DiagnosticWind` (spec §8.9, P0): no 3-D dynamics. Mass-consistent u_bg per stamp (time-interpolated),
 * night decoupling, sub-grid slope flows (full S), lee separation, pyrogenic potential (c_p = c_f, head correction),
 * user wind edits via u₀. view() returns the 10 m fields and a zero 3-D volume; airAt() the §5.2 template T;
 * sampleTurb from similarity; spunUp is always false; diagnostics: inversion from the §5.2a template, Briggs /
 * 1-D plume top. No wall-clock dependence anywhere (tier changes are recorded edits, §12.6).
 */
import type { Rng } from '../core/rng';
import type { AtmosDiagnostics, TerrainFeatures } from '../core/simTypes';
import type { AtmosphereView, FuelMap, GridSpec, QualityTier, Terrain, WeatherSeries } from '../core/types';
import { clamp, smoothstep } from '../core/units';
import { AtmosBase, type AtmosphereOptions, type BaseCheckpoint, type FireWindContextExt } from './base';
import { ATMOS_PARAMS } from './params';
import { kappaLookup, profileWind, thetaRaw } from './profile';
import { PyrogenicPotential } from './pyrogenic';

interface DiagCheckpoint {
  kind: 'diagnosticWind';
  base: BaseCheckpoint;
  psi: Float64Array;
  up: Float32Array;
  vp: Float32Array;
  lastPyro: number;
}

export class DiagnosticWind extends AtmosBase {
  private readonly pyro: PyrogenicPotential;
  private lastPyro = -Infinity;
  private readonly tmp3 = new Float64Array(2);

  constructor(
    terrain: Terrain,
    hiRes: { grid: GridSpec; elevation: Float32Array } | undefined,
    fuel: FuelMap,
    features: TerrainFeatures,
    tier: QualityTier,
    extent: number,
    series: WeatherSeries,
    rng: Rng,
    opts: AtmosphereOptions = {},
  ) {
    // The fast tier uses the standard-tier grid for its mass-consistent solve (tier table §12.6).
    super(terrain, hiRes, fuel, features, tier === 'fast' ? 'fast' : tier, extent, series, rng, opts);
    this.pyro = new PyrogenicPotential(terrain.grid);
  }

  override get spunUp(): boolean {
    return false;
  }

  /**
   * Night decoupling weight w_night(z_cell) (§8.4 taper): smoothstep(z_low, z_low + 300, z_cell) with
   * z_low = min(P90 − 300 m, z_floor,col + h_inv). Deviation [H]: the spec's §8.4 z_low (min(P90, …)) describes air
   * 300 m above ridge level in the 3-D column; evaluated at the ground it would decouple ridge tops and the whole of
   * a flat domain (breaking V21 at night). Shifting the ridge term down by the taper depth keeps surfaces at ridge
   * level coupled and valley floors inside the cold pool decoupled.
   */
  private wNight(k: number): number {
    const g = this.grid;
    const c = g.colOfFire[k]!;
    const d = ATMOS_PARAMS.nudgeNightDepth;
    const zLow = Math.min(g.zP90 - d, g.zFloor[c]! + this.night.hInv);
    return smoothstep(zLow, zLow + d, this.terrain.elevation[k]!);
  }

  protected fireWindTier(
    outU: Float32Array,
    outV: Float32Array,
    outBgU: Float32Array,
    outBgV: Float32Array,
    outIndU: Float32Array,
    outIndV: Float32Array,
    ctx: FireWindContextExt,
    cf: number,
  ): { resolvedU: Float32Array | null; resolvedV: Float32Array | null } {
    const sn = this.night.sn;
    const P = ATMOS_PARAMS;
    const up = this.pyro.up;
    const vp = this.pyro.vp;
    const cp = cf; // D32: c_p = c_f
    const pyroOn = cp > 0 && this.firePowerW > 0;
    for (let k = 0; k < this.nf; k++) {
      let bu = outBgU[k]!;
      let bv = outBgV[k]!;
      if (sn > 0) {
        const f = 1 - P.nightDecouple * sn * (1 - this.wNight(k));
        bu *= f;
        bv *= f;
        outBgU[k] = bu;
        outBgV[k] = bv;
      }
      let iu = 0;
      let iv = 0;
      if (pyroOn) {
        iu = up[k]!;
        iv = vp[k]!;
        // Head correction: remove the component opposing the head (ê = head direction; fallback: wind-to).
        let ex: number;
        let ey: number;
        let isHead: boolean;
        if (ctx.headMask && ctx.headDirX && ctx.headDirY) {
          isHead = ctx.headMask[k] === 1;
          ex = ctx.headDirX[k]!;
          ey = ctx.headDirY[k]!;
        } else {
          const sp = Math.hypot(bu, bv);
          isHead = sp > 0.1;
          ex = sp > 0 ? bu / sp : 0;
          ey = sp > 0 ? bv / sp : 0;
        }
        if (isHead) {
          const d = iu * ex + iv * ey;
          if (d < 0) {
            iu -= d * ex;
            iv -= d * ey;
          }
        }
        iu *= cp;
        iv *= cp;
      }
      outIndU[k] = iu;
      outIndV[k] = iv;
      outU[k] = bu + iu;
      outV[k] = bv + iv;
    }
    return { resolvedU: null, resolvedV: null };
  }

  addFireHeat(fireGrid: GridSpec, heatKwM2: Float32Array, _crownShare: Float32Array): void {
    this.checkFireGrid(fireGrid);
    this.fireTotals(heatKwM2);
    // Pyrogenic potential every 60 s of simulated time (deterministic cadence on the step clock).
    if (this.simTime - this.lastPyro >= ATMOS_PARAMS.pyroIntervalS) {
      this.pyro.solve(heatKwM2);
      this.lastPyro = this.simTime;
    }
  }

  step(dt: number): void {
    this.accumulateHeating(dt);
  }

  maxStableDt(): number {
    return 10; // §12.2: fast tier 10 s fixed
  }

  protected windAt(x: number, y: number, zAgl: number, out: Float32Array): void {
    this.sampleBg(x, y, zAgl, out);
  }

  /** u_bg (u, v, w) at a point (fire-terrain AGL), trilinear between columns and levels. */
  private sampleBg(x: number, y: number, zAgl: number, out: Float32Array): void {
    const g = this.grid;
    const A = this.stampA.bg!;
    const B = this.stampB.bg!;
    const a = this.wgt;
    const zAsl = this.groundAt(x, y) + Math.max(0, zAgl);
    const fx = clamp((x - g.grid.x0) / g.dx, 0, g.nx - 1);
    const fy = clamp((y - g.grid.y0) / g.dx, 0, g.ny - 1);
    const i0 = Math.min(Math.floor(fx), Math.max(0, g.nx - 2));
    const j0 = Math.min(Math.floor(fy), Math.max(0, g.ny - 2));
    const tx = fx - i0;
    const ty = fy - j0;
    let su = 0;
    let sv = 0;
    let sw = 0;
    const plane = g.plane;
    for (let q = 0; q < 4; q++) {
      const c = (j0 + (q >> 1)) * g.nx + i0 + (q & 1);
      const wq = (q & 1 ? tx : 1 - tx) * (q >> 1 ? ty : 1 - ty);
      if (wq === 0) continue;
      const zeta = (zAsl - g.zs[c]!) / g.J[c]!;
      if (zeta > g.Hp) {
        // Above the model top: grid-point profile, w = 0.
        profileWind(this.stampA.profile, zAsl - this.stampA.profile.zgp, this.tmp3);
        su += wq * this.tmp3[0]!;
        sv += wq * this.tmp3[1]!;
        continue;
      }
      let kf = 0;
      const zc = g.zetaC;
      if (zeta >= zc[g.nz - 1]!) kf = g.nz - 1;
      else if (zeta > zc[0]!) {
        let lo = 0;
        while (lo < g.nz - 2 && zc[lo + 1]! <= zeta) lo++;
        kf = lo + (zeta - zc[lo]!) / (zc[lo + 1]! - zc[lo]!);
      }
      const k0 = Math.min(Math.floor(kf), g.nz - 2);
      const t = kf - k0;
      const o = k0 * plane + c;
      const lerpF = (f: Float32Array): number => f[o]! + (f[o + plane]! - f[o]!) * t;
      su += wq * ((1 - a) * lerpF(A.uc) + a * lerpF(B.uc));
      sv += wq * ((1 - a) * lerpF(A.vc) + a * lerpF(B.vc));
      sw += wq * ((1 - a) * lerpF(A.wc) + a * lerpF(B.wc));
    }
    out[0] = su;
    out[1] = sv;
    out[2] = sw;
  }

  sample(x: number, y: number, zAGL: number, out: Float32Array): void {
    this.sampleBg(x, y, zAGL, out);
  }

  view(): AtmosphereView {
    const g = this.grid;
    const A = this.stampA;
    const B = this.stampB;
    const a = this.wgt;
    const su = new Float32Array(g.plane);
    const sv = new Float32Array(g.plane);
    const th = new Float32Array(g.plane);
    for (let c = 0; c < g.plane; c++) {
      const z1 = g.zetaC[0]! * g.J[c]!;
      const ar = kappaLookup(A.kappa!.re, z1);
      const ai = kappaLookup(A.kappa!.im, z1);
      const br = kappaLookup(B.kappa!.re, z1);
      const bi = kappaLookup(B.kappa!.im, z1);
      const ua = A.bg!.uc[c]!;
      const va = A.bg!.vc[c]!;
      const ub = B.bg!.uc[c]!;
      const vb = B.bg!.vc[c]!;
      su[c] = (1 - a) * (ar * ua - ai * va) + a * (br * ub - bi * vb);
      sv[c] = (1 - a) * (ar * va + ai * ua) + a * (br * vb + bi * ub);
      th[c] = g.zs[c]! - g.zMin;
    }
    const empty = new Float32Array(0);
    return { grid: g.grid, nz: 0, levels: empty, terrainHeight: th, surfaceU: su, surfaceV: sv, u: empty, v: empty, w: empty, thetaAnomaly: empty, smoke: empty };
  }

  /** θ = raw θ_env + §5.2a cold-pool template (no resolved perturbation in the fast tier). */
  protected thetaAt(c: number, zAsl: number): number {
    const g = this.grid;
    const th = thetaRaw(this.stampA.profile, zAsl);
    const hav = zAsl - g.zFloor[c]!;
    const hInv = Math.max(1, this.night.hInv);
    return hav < hInv ? th - this.night.dTheta * (1 - Math.max(0, hav) / hInv) : th;
  }

  diagnostics(): AtmosDiagnostics {
    const pl = this.plume();
    return this.commonDiagnostics(pl ? pl.maxW : 0);
  }

  checkpoint(): unknown {
    const c: DiagCheckpoint = {
      kind: 'diagnosticWind',
      base: this.baseCheckpoint(),
      psi: this.pyro.psi.slice(),
      up: this.pyro.up.slice(),
      vp: this.pyro.vp.slice(),
      lastPyro: this.lastPyro,
    };
    return c;
  }

  restore(cIn: unknown): void {
    const c = cIn as DiagCheckpoint;
    if (!c || c.kind !== 'diagnosticWind') throw new Error('DiagnosticWind.restore: not a DiagnosticWind checkpoint');
    this.baseRestore(c.base);
    this.pyro.psi.set(c.psi);
    this.pyro.up.set(c.up);
    this.pyro.vp.set(c.vp);
    this.lastPyro = c.lastPyro;
  }
}
