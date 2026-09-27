/**
 * 3-D atmosphere for the standard/high tiers (spec §8.1–§8.8, §8.10; doc 07 §7, §9.1).
 *
 * Dry Boussinesq perturbation form on a terrain-following MAC grid: u, v, w (physical components) on faces, θ′ and
 * smoke at centres; b = gθ′/θ_env, θ′ advected with −w·dθ_env/dz added explicitly. One step (§8.4, never reorder):
 *   1 semi-Lagrangian advection (RK2 midpoint in (x, y, ζ) with (u, v, ω), trilinear)
 *   2 w += Δt·g·θ′/θ_env                       (buoyancy FIRST)
 *   3 θ′ += −Δt·w·dθ_env/dz                     (with the NEW w: forward–backward, neutral for NΔt < 2)
 *   4 heat sources (surface Q_h,col e-folding Δz₁, fire heat §8.7) ·1/(ρc_pΠΔz); cap θ′ ≤ 60 K
 *   5 implicit drag (lowest level), implicit nudging to u_bg with the taper w_n, implicit sponge (top 800 m)
 *   6 Smagorinsky: horizontal explicit, vertical implicit; θ′ diffused about θ_env(z_ASL)
 *   7 projection ∇·(∇p′) = (ρ₀/Δt)∇·u* (multigrid V(2,2), Neumann ground/top/inflow, p′ = 0 on outflow faces)
 *   8 Davies relaxation zones (u, v × w_n)
 * plus the [H] horizontal-mean θ′ control (ATMOS_PARAMS.meanThetaTauS) and smoke decay.
 */
import { CP, G, exner, pressureIsa } from '../core/physics';
import type { Rng } from '../core/rng';
import type { AtmosDiagnostics, TerrainFeatures } from '../core/simTypes';
import type { AtmosphereView, FuelMap, GridSpec, QualityTier, Terrain, WeatherSeries } from '../core/types';
import { clamp, smoothstep } from '../core/units';
import { AtmosBase, type AtmosphereOptions, type BaseCheckpoint, type FireWindContextExt, type Stamp } from './base';
import { advect, collocate, diffuseH, diffuseVLevels, diffuseVW, displacements, indexRates, smagorinsky } from './dynamics';
import { levelFrac } from './grid';
import { setGroundW } from './massConsistent';
import { ATMOS_PARAMS } from './params';
import { dThetaEnvDz, kappaLookup, pressureAt, profileWind, thetaEnv, thetaRaw } from './profile';
import { EllipticSolver, type BoundaryMasks } from './solver';
import { crownLayerFraction, expLayerFraction } from './surface';

interface StampDyn {
  gth: Float32Array;
  dth: Float32Array;
  hc: Float32Array;
}

interface AtmosCheckpoint {
  kind: 'atmosphere';
  base: BaseCheckpoint;
  u: Float32Array;
  v: Float32Array;
  w: Float32Array;
  th: Float32Array;
  sm: Float32Array;
  phi: Float64Array;
  initialised: boolean;
  spinTime: number;
  maxU: number;
  maxW: number;
  smokeActive: boolean;
  qfS: Float64Array;
  qfC: Float64Array;
  hC: Float64Array;
  fireCols: number[];
}

export class Atmosphere extends AtmosBase {
  // ── state ──
  private u: Float32Array;
  private v: Float32Array;
  private w: Float32Array;
  private th: Float32Array;
  private sm: Float32Array;
  private phi: Float64Array;
  // ── scratch ──
  private u2: Float32Array;
  private v2: Float32Array;
  private w2: Float32Array;
  private th2: Float32Array;
  private sm2: Float32Array;
  private readonly uc: Float32Array;
  private readonly vc: Float32Array;
  private readonly wc: Float32Array;
  private readonly Ui: Float32Array;
  private readonly Vi: Float32Array;
  private readonly Wi: Float32Array;
  private readonly kmh: Float32Array;
  private readonly kmv: Float32Array;
  private readonly khh: Float32Array;
  private readonly khv: Float32Array;
  private readonly rhs: Float64Array;
  private readonly colScratch: Float64Array;
  // ── blended background / per-cell environment ──
  private readonly bgU: Float32Array;
  private readonly bgV: Float32Array;
  private readonly bgW: Float32Array;
  private readonly gth: Float32Array;
  private readonly dth: Float32Array;
  private readonly hc: Float32Array;
  private readonly dyn = new WeakMap<Stamp, StampDyn>();
  private blendKey = '';
  private maskKey: Stamp | null = null;
  // ── static geometry ──
  private readonly fS: Float32Array;
  private readonly fF: Float32Array;
  private readonly nSurfLevels: number;
  private readonly zAslC: Float32Array;
  private readonly zAglU: Float32Array;
  private readonly zAslU: Float32Array;
  private readonly zAglV: Float32Array;
  private readonly zAslV: Float32Array;
  private readonly zAglW: Float32Array;
  private readonly zAslW: Float32Array;
  private readonly JuF: Float64Array;
  private readonly JvF: Float64Array;
  private readonly dvU: Float32Array;
  private readonly dvV: Float32Array;
  private readonly dvC: Float32Array;
  /** Indices (per plane) of the Davies-zone points of the u, v and centre grids. */
  private readonly dzU: Int32Array;
  private readonly dzV: Int32Array;
  private readonly dzC: Int32Array;
  private readonly spongeW: Float32Array;
  private readonly spongeC: Float32Array;
  private readonly slopeLim: Float32Array;
  private readonly bin: Uint16Array;
  private readonly binSum: Float64Array;
  private readonly binCnt: Float64Array;
  private readonly dzMin: number;
  private readonly piFire: Float32Array;
  private readonly st2K: Int16Array;
  private readonly st2T: Float32Array;
  // ── night-dependent ──
  private readonly nuU: Float32Array;
  private readonly nuV: Float32Array;
  private readonly nuW: Float32Array;
  /** Background-compensation weight of drag and diffusion per face (1 = u_bg is an equilibrium). */
  private readonly cmpU: Float32Array;
  private readonly cmpV: Float32Array;
  private readonly cmpW: Float32Array;
  private readonly cbU: Float32Array;
  private readonly cbV: Float32Array;
  private readonly cbW: Float32Array;
  private readonly cpT: Float32Array;
  // ── fire heat (per column, consumed by the next step) ──
  private readonly qfS: Float64Array;
  private readonly qfC: Float64Array;
  private readonly hC: Float64Array;
  private fireCols: number[] = [];
  // ── projection ──
  private readonly proj: EllipticSolver;
  private masks: BoundaryMasks;
  // ── bookkeeping ──
  private initialised = false;
  private spinTime = 0;
  private maxU = 0;
  private maxW = 0;
  private smokeActive = false;
  private readonly tmp2 = new Float64Array(2);
  private readonly tmp2b = new Float64Array(2);
  /** Last projection solve (tests/diagnostics). */
  lastProjection = { iterations: 0, relResidual: NaN };

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
    super(terrain, hiRes, fuel, features, tier === 'fast' ? 'standard' : tier, extent, series, rng, opts);
    const g = this.grid;
    const { nx, ny, nz, plane, n, nU, nV, nW } = g;
    const nx1 = nx + 1;
    const P = ATMOS_PARAMS;
    this.u = new Float32Array(nU);
    this.v = new Float32Array(nV);
    this.w = new Float32Array(nW);
    this.th = new Float32Array(n);
    this.sm = new Float32Array(n);
    this.phi = new Float64Array(n);
    this.u2 = new Float32Array(nU);
    this.v2 = new Float32Array(nV);
    this.w2 = new Float32Array(nW);
    this.th2 = new Float32Array(n);
    this.sm2 = new Float32Array(n);
    this.uc = new Float32Array(n);
    this.vc = new Float32Array(n);
    this.wc = new Float32Array(n);
    this.Ui = new Float32Array(n);
    this.Vi = new Float32Array(n);
    this.Wi = new Float32Array(n);
    this.kmh = new Float32Array(n);
    this.kmv = new Float32Array(n);
    this.khh = new Float32Array(n);
    this.khv = new Float32Array(n);
    this.rhs = new Float64Array(n);
    this.colScratch = new Float64Array(2 * (nz + 1));
    this.bgU = new Float32Array(nU);
    this.bgV = new Float32Array(nV);
    this.bgW = new Float32Array(nW);
    this.gth = new Float32Array(n);
    this.dth = new Float32Array(n);
    this.hc = new Float32Array(n);
    this.nuU = new Float32Array(nU);
    this.nuV = new Float32Array(nV);
    this.nuW = new Float32Array(nW);
    this.cmpU = new Float32Array(nU);
    this.cmpV = new Float32Array(nV);
    this.cmpW = new Float32Array(nW);
    this.cbU = new Float32Array(nU);
    this.cbV = new Float32Array(nV);
    this.cbW = new Float32Array(nW);
    this.cpT = new Float32Array(n);
    this.qfS = new Float64Array(plane);
    this.qfC = new Float64Array(plane);
    this.hC = new Float64Array(plane);

    // ── static heights ──
    this.zAslC = new Float32Array(n);
    this.fS = new Float32Array(n);
    this.fF = new Float32Array(n);
    const alphaS = g.dz1;
    const alphaF = Math.max(P.fireAlphaMin, g.dz1);
    let nSurf = 1;
    for (let k = 0; k < nz; k++) {
      for (let c = 0; c < plane; c++) {
        const J = g.J[c]!;
        const o = k * plane + c;
        this.zAslC[o] = g.zs[c]! + g.zetaC[k]! * J;
        const z0 = g.zetaF[k]! * J;
        const z1 = g.zetaF[k + 1]! * J;
        this.fS[o] = expLayerFraction(z0, z1, alphaS);
        this.fF[o] = expLayerFraction(z0, z1, alphaF);
      }
      if (g.zetaF[k]! < 8 * alphaF) nSurf = k + 1;
    }
    this.nSurfLevels = nSurf;
    this.JuF = g.Ju;
    this.JvF = g.Jv;
    this.zAglU = new Float32Array(nU);
    this.zAslU = new Float32Array(nU);
    this.zAglV = new Float32Array(nV);
    this.zAslV = new Float32Array(nV);
    this.zAglW = new Float32Array(nW);
    this.zAslW = new Float32Array(nW);
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let iu = 0; iu <= nx; iu++) {
          const f = (k * ny + j) * nx1 + iu;
          const zs = 0.5 * (g.zs[j * nx + Math.max(0, iu - 1)]! + g.zs[j * nx + Math.min(nx - 1, iu)]!);
          const agl = g.zetaC[k]! * g.Ju[j * nx1 + iu]!;
          this.zAglU[f] = agl;
          this.zAslU[f] = zs + agl;
        }
      }
      for (let jv = 0; jv <= ny; jv++) {
        for (let i = 0; i < nx; i++) {
          const f = (k * (ny + 1) + jv) * nx + i;
          const zs = 0.5 * (g.zs[Math.max(0, jv - 1) * nx + i]! + g.zs[Math.min(ny - 1, jv) * nx + i]!);
          const agl = g.zetaC[k]! * g.Jv[jv * nx + i]!;
          this.zAglV[f] = agl;
          this.zAslV[f] = zs + agl;
        }
      }
    }
    for (let m = 0; m <= nz; m++) {
      for (let c = 0; c < plane; c++) {
        const agl = g.zetaF[m]! * g.J[c]!;
        this.zAglW[m * plane + c] = agl;
        this.zAslW[m * plane + c] = g.zs[c]! + agl;
      }
    }
    // ── Davies coefficients δ = e^{−d/2}/5 (d in cells from the edge) ──
    const nD = g.nDavies;
    const dav = (x: number, y: number): number => {
      const d = Math.max(0, Math.min(x, nx - 1 - x, y, ny - 1 - y));
      return d < nD ? Math.exp(-d / 2) / P.daviesSteps : 0;
    };
    this.dvU = new Float32Array((nx + 1) * ny);
    this.dvV = new Float32Array(nx * (ny + 1));
    this.dvC = new Float32Array(plane);
    for (let j = 0; j < ny; j++) for (let iu = 0; iu <= nx; iu++) this.dvU[j * nx1 + iu] = dav(iu - 0.5, j);
    for (let jv = 0; jv <= ny; jv++) for (let i = 0; i < nx; i++) this.dvV[jv * nx + i] = dav(i, jv - 0.5);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) this.dvC[j * nx + i] = dav(i, j);
    const nonzero = (a: Float32Array): Int32Array => {
      const out: number[] = [];
      for (let q = 0; q < a.length; q++) if (a[q]! > 0) out.push(q);
      return Int32Array.from(out);
    };
    this.dzU = nonzero(this.dvU);
    this.dzV = nonzero(this.dvV);
    this.dzC = nonzero(this.dvC);
    // ── sponge profiles (per level) ──
    this.spongeC = new Float32Array(nz);
    this.spongeW = new Float32Array(nz + 1);
    const zb = g.Hp - P.spongeDepth;
    const sp = (z: number): number => (z >= zb ? Math.sin((Math.PI / 2) * ((z - zb) / P.spongeDepth)) ** 2 : 0);
    for (let k = 0; k < nz; k++) this.spongeC[k] = sp(g.zetaC[k]!);
    for (let m = 0; m <= nz; m++) this.spongeW[m] = sp(g.zetaF[m]!);
    // ── θ′ horizontal-diffusion slope limiter and mean-control bins ──
    this.slopeLim = new Float32Array(n);
    this.bin = new Uint16Array(n);
    const nBins = Math.ceil((g.zTop + g.relief - g.zMin) / P.meanThetaBandM) + 2;
    this.binSum = new Float64Array(nBins);
    this.binCnt = new Float64Array(nBins);
    let dzMin = Infinity;
    for (let k = 0; k < nz; k++) {
      for (let c = 0; c < plane; c++) {
        const o = k * plane + c;
        const J = g.J[c]!;
        const dz = J * g.dzeta[k]!;
        const sl = Math.hypot(g.zsx[c]!, g.zsy[c]!) * (1 - g.zetaC[k]! / g.Hp);
        this.slopeLim[o] = sl > 0 ? Math.min(1, (P.thetaDiffSlopeLimit * dz) / (sl * g.dx)) : 1;
        this.bin[o] = Math.min(nBins - 1, Math.max(0, Math.floor((this.zAslC[o]! - g.zMin) / P.meanThetaBandM)));
        this.binCnt[this.bin[o]!]! += 1;
        if (k === 0) dzMin = Math.min(dzMin, dz);
      }
    }
    this.dzMin = dzMin;
    // ── fire-cell Exner and the z_cell + 2 m stencil (levels only; horizontal part shared) ──
    const nf = this.nf;
    this.piFire = new Float32Array(nf);
    this.st2K = new Int16Array(4 * nf);
    this.st2T = new Float32Array(4 * nf);
    for (let k = 0; k < nf; k++) {
      const z = terrain.elevation[k]! + 2;
      this.piFire[k] = exner(pressureIsa(z));
      for (let q = 0; q < 4; q++) {
        const c = this.stC[4 * k + q]!;
        const kf = levelFrac(g, c, z - g.zs[c]!);
        const k0 = Math.min(Math.floor(kf), nz - 2);
        this.st2K[4 * k + q] = k0;
        this.st2T[4 * k + q] = kf - k0;
      }
    }
    // ── projection solver (R = 1); masks set per stamp pair ──
    this.masks = { activeU: new Uint8Array(nU), activeV: new Uint8Array(nV), topActive: false };
    this.proj = new EllipticSolver(g, 1, 1, this.masks);
    this.updateNightFields();
  }

  override get spunUp(): boolean {
    return this.spinTime >= ATMOS_PARAMS.spinUpS;
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Stamp-dependent environment
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  protected override onStampDerived(st: Stamp): void {
    const g = this.grid;
    const { nz, plane } = g;
    const gth = new Float32Array(g.n);
    const dth = new Float32Array(g.n);
    const hc = new Float32Array(g.n);
    const p = st.profile;
    for (let k = 0; k < nz; k++) {
      for (let c = 0; c < plane; c++) {
        const o = k * plane + c;
        const z = this.zAslC[o]!;
        const thE = thetaEnv(p, z);
        gth[o] = G / thE;
        dth[o] = dThetaEnvDz(p, z);
        const pz = pressureAt(p, z);
        const pi = exner(pz);
        const T = thE * pi;
        const rho = (pz * 100) / (287 * T);
        hc[o] = 1 / (rho * CP * pi * g.J[c]! * g.dzeta[k]!);
      }
    }
    this.dyn.set(st, { gth, dth, hc });
  }

  protected override onTimeChanged(): void {
    this.blendKey = '';
  }

  protected override onHeatingChanged(): void {
    this.updateNightFields();
  }

  /** Nudging coefficients w_n/τ_n per face and the cold-pool template θ′_cp per cell (§8.2 item 4, §8.4). */
  private updateNightFields(): void {
    const g = this.grid;
    const P = ATMOS_PARAMS;
    const { nx, ny, nz, plane } = g;
    const nx1 = nx + 1;
    const sn = clamp(this.night.sn, 0, 1);
    const hInv = Math.max(1, this.night.hInv);
    const dTh = this.night.dTheta;
    const inv = 1 / P.nudgeTauS;
    const wn = (agl: number, asl: number, c: number): number => {
      const wDay = P.nudgeDayBase + (1 - P.nudgeDayBase) * smoothstep(P.nudgeDayRamp0, P.nudgeDayRamp1, agl);
      if (sn <= 0) return wDay;
      const zLow = Math.min(g.zP90, g.zFloor[c]! + hInv);
      const wNight = smoothstep(zLow, zLow + P.nudgeNightDepth, asl);
      return (1 - sn) * wDay + sn * wNight;
    };
    // [H] Compensation of the background's drag/diffusion: full by day; at night only above the decoupled
    // valley air (z_low′ = min(P90 − 300 m, z_floor + h_inv), the fast-tier decoupling height), so valley floors
    // under a cold pool decouple from the ridge wind while flat terrain keeps the forecast profile.
    const cmp = (asl: number, c: number): number => {
      if (sn <= 0) return 1;
      const d = P.nudgeNightDepth;
      const zLow = Math.min(g.zP90 - d, g.zFloor[c]! + hInv);
      return 1 - sn + sn * smoothstep(zLow, zLow + d, asl);
    };
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let iu = 0; iu <= nx; iu++) {
          const f = (k * ny + j) * nx1 + iu;
          const c = j * nx + Math.min(nx - 1, iu);
          this.nuU[f] = wn(this.zAglU[f]!, this.zAslU[f]!, c) * inv;
          this.cmpU[f] = cmp(this.zAslU[f]!, c);
        }
      }
      for (let jv = 0; jv <= ny; jv++) {
        for (let i = 0; i < nx; i++) {
          const f = (k * (ny + 1) + jv) * nx + i;
          const c = Math.min(ny - 1, jv) * nx + i;
          this.nuV[f] = wn(this.zAglV[f]!, this.zAslV[f]!, c) * inv;
          this.cmpV[f] = cmp(this.zAslV[f]!, c);
        }
      }
    }
    for (let m = 0; m <= nz; m++) {
      for (let c = 0; c < plane; c++) {
        const f = m * plane + c;
        this.nuW[f] = wn(this.zAglW[f]!, this.zAslW[f]!, c) * inv;
        this.cmpW[f] = cmp(this.zAslW[f]!, c);
      }
    }
    this.blendKey = '';
    for (let k = 0; k < nz; k++) {
      for (let c = 0; c < plane; c++) {
        const o = k * plane + c;
        const hav = this.zAslC[o]! - g.zFloor[c]!;
        this.cpT[o] = dTh > 0 && hav < hInv ? -dTh * (1 - Math.max(0, hav) / hInv) : 0;
      }
    }
  }

  /** Blend the stamp pair into the current background faces and per-cell environment; refresh outflow masks. */
  private refreshBlend(): void {
    const A = this.stampA;
    const B = this.stampB;
    const key = `${A.hour.time}|${B.hour.time}|${this.wgt}`;
    if (key === this.blendKey) return;
    this.blendKey = key;
    const a = this.wgt;
    const ba = A.bg!;
    const bb = B.bg!;
    const lerpInto = (out: Float32Array, x: Float32Array, y: Float32Array): void => {
      for (let q = 0; q < out.length; q++) out[q] = x[q]! + (y[q]! - x[q]!) * a;
    };
    lerpInto(this.bgU, ba.u, bb.u);
    lerpInto(this.bgV, ba.v, bb.v);
    lerpInto(this.bgW, ba.w, bb.w);
    mulInto(this.cbU, this.bgU, this.cmpU);
    mulInto(this.cbV, this.bgV, this.cmpV);
    mulInto(this.cbW, this.bgW, this.cmpW);
    const da = this.dyn.get(A)!;
    const db = this.dyn.get(B)!;
    lerpInto(this.gth, da.gth, db.gth);
    lerpInto(this.dth, da.dth, db.dth);
    lerpInto(this.hc, da.hc, db.hc);
    if (this.maskKey !== A) {
      this.maskKey = A;
      this.updateMasks(ba.u, ba.v);
    }
  }

  /** p′ = 0 (active) on outflow faces u_bg·n_out > 0, Neumann elsewhere (§8.5). */
  private updateMasks(ub: Float32Array, vb: Float32Array): void {
    const g = this.grid;
    const { nx, ny, nz } = g;
    const nx1 = nx + 1;
    const au = new Uint8Array(g.nU);
    const av = new Uint8Array(g.nV);
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        const f0 = (k * ny + j) * nx1;
        au[f0] = ub[f0]! < 0 ? 1 : 0;
        au[f0 + nx] = ub[f0 + nx]! > 0 ? 1 : 0;
      }
      for (let i = 0; i < nx; i++) {
        const fs = k * (ny + 1) * nx + i;
        const fn = (k * (ny + 1) + ny) * nx + i;
        av[fs] = vb[fs]! < 0 ? 1 : 0;
        av[fn] = vb[fn]! > 0 ? 1 : 0;
      }
    }
    // Interior faces are always active in the solver; only boundary entries are read.
    this.masks = { activeU: au, activeV: av, topActive: false };
    this.proj.reconfigure(1, 1, this.masks);
  }

  private initialiseState(): void {
    this.refreshBlend();
    this.u.set(this.bgU);
    this.v.set(this.bgV);
    this.w.set(this.bgW);
    this.th.set(this.cpT);
    this.sm.fill(0);
    this.phi.fill(0);
    this.initialised = true;
    collocate(this.grid, this.u, this.v, this.w, this.uc, this.vc, this.wc, null, null, null);
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Fire heat (§8.7)
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  addFireHeat(fireGrid: GridSpec, heatKwM2: Float32Array, crownShare: Float32Array): void {
    this.checkFireGrid(fireGrid);
    this.fireTotals(heatKwM2);
    const g = this.grid;
    const fg = this.terrain.grid;
    const scale = (1000 * ATMOS_PARAMS.chiC * fg.cellSize * fg.cellSize) / (g.dx * g.dx);
    const hEff = this.fuel.canopyHeightEff ?? this.fuel.canopyHeight;
    this.qfS.fill(0);
    this.qfC.fill(0);
    this.hC.fill(0);
    const cols = new Set<number>();
    for (let k = 0; k < this.nf; k++) {
      const q = heatKwM2[k]!;
      if (!(q > 0)) continue;
      const c = g.colOfFire[k]!;
      const cs = clamp(crownShare[k] ?? 0, 0, 1);
      this.qfS[c]! += scale * q * (1 - cs);
      if (cs > 0) {
        const qc = scale * q * cs;
        this.qfC[c]! += qc;
        this.hC[c]! += qc * (Number.isFinite(hEff[k]!) ? hEff[k]! : 20);
      }
      cols.add(c);
    }
    for (const c of cols) if (this.qfC[c]! > 0) this.hC[c] = this.hC[c]! / this.qfC[c]!;
    this.fireCols = Array.from(cols).sort((a, b) => a - b);
    if (this.fireCols.length) this.smokeActive = true;
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Step
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  maxStableDt(): number {
    const P = ATMOS_PARAMS;
    const a = this.maxU > 1e-6 ? this.grid.dx / this.maxU : Infinity;
    const b = this.maxW > 1e-6 ? this.dzMin / this.maxW : Infinity;
    return clamp(P.courant * Math.min(a, b), P.dtMin, P.dtMax);
  }

  step(dt: number): void {
    if (!(dt > 0)) return;
    const g = this.grid;
    const P = ATMOS_PARAMS;
    if (!this.initialised) this.initialiseState();
    this.refreshBlend();
    const { nx, ny, nz, plane, n } = g;
    const nx1 = nx + 1;

    // 1 advection (uc, vc, wc are the collocated fields of the current state, kept up to date by every writer)
    indexRates(g, this.uc, this.vc, this.wc, this.Ui, this.Vi, this.Wi);
    // Displacements overwrite the index-rate arrays' companions (khh/khv/kmh reused as scratch before Smagorinsky).
    const Dx = this.kmh;
    const Dy = this.kmv;
    const Dz = this.khh;
    displacements(g, this.Ui, this.Vi, this.Wi, dt, Dx, Dy, Dz);
    advect(g, Dx, Dy, Dz, this.u, this.u2, nx + 1, ny, nz, 0.5, 0, 0);
    advect(g, Dx, Dy, Dz, this.v, this.v2, nx, ny + 1, nz, 0, 0.5, 0);
    advect(g, Dx, Dy, Dz, this.w, this.w2, nx, ny, nz + 1, 0, 0, 0.5);
    advect(g, Dx, Dy, Dz, this.th, this.th2, nx, ny, nz, 0, 0, 0, this.smokeActive ? this.sm : null, this.sm2);
    [this.u, this.u2] = [this.u2, this.u];
    [this.v, this.v2] = [this.v2, this.v];
    [this.w, this.w2] = [this.w2, this.w];
    [this.th, this.th2] = [this.th2, this.th];
    if (this.smokeActive) [this.sm, this.sm2] = [this.sm2, this.sm];
    const u = this.u;
    const v = this.v;
    const w = this.w;
    const th = this.th;
    const sm = this.sm;
    for (let c = 0; c < plane; c++) w[nz * plane + c] = 0;
    setGroundW(g, u, v, w);

    // 2 buoyancy (first), 3 stratification with the new w
    const gth = this.gth;
    for (let m = 1; m < nz; m++) {
      const o = m * plane;
      const ob = (m - 1) * plane;
      for (let c = 0; c < plane; c++) w[o + c] = w[o + c]! + dt * 0.5 * (gth[ob + c]! * th[ob + c]! + gth[o + c]! * th[o + c]!);
    }
    const dth = this.dth;
    for (let k = 0; k < nz; k++) {
      const o = k * plane;
      for (let c = 0; c < plane; c++) th[o + c] = th[o + c]! - dt * 0.5 * (w[o + c]! + w[o + plane + c]!) * dth[o + c]!;
    }

    // 4 heat sources
    const hc = this.hc;
    if (this.heatingOn) {
      for (let k = 0; k < this.nSurfLevels; k++) {
        const o = k * plane;
        for (let c = 0; c < plane; c++) {
          const q = this.qhCol[c]!;
          if (q !== 0) th[o + c] = th[o + c]! + dt * q * this.fS[o + c]! * hc[o + c]!;
        }
      }
    }
    if (this.fireCols.length) {
      const smk = P.smokePerJ;
      for (const c of this.fireCols) {
        const qs = this.qfS[c]!;
        const qc = this.qfC[c]!;
        const H = this.hC[c]!;
        const J = g.J[c]!;
        for (let k = 0; k < nz; k++) {
          const o = k * plane + c;
          let dq = qs * this.fF[o]!;
          if (qc > 0) dq += qc * crownLayerFraction(g.zetaF[k]! * J, g.zetaF[k + 1]! * J, H);
          if (dq <= 0) {
            if (g.zetaF[k]! * J > 3000) break;
            continue;
          }
          th[o] = th[o]! + dt * dq * hc[o]!;
          sm[o] = sm[o]! + (dt * dq * smk) / (J * g.dzeta[k]!);
        }
      }
      this.qfS.fill(0);
      this.qfC.fill(0);
      this.fireCols = [];
    }
    for (let o = 0; o < n; o++) if (th[o]! > P.thetaCap) th[o] = P.thetaCap;

    // 5 drag (lowest level), nudging, sponge. [H] The drag acts on the departure from u_bg (the background's own
    //   drag is compensated) so the mass-consistent background is an equilibrium of the model: flat terrain keeps
    //   the forecast profile (V21/D30) and the fire model's WRF stays the only canopy reduction of U10.
    const bgU = this.cbU;
    const bgV = this.cbV;
    for (let j = 0; j < ny; j++) {
      for (let iu = 0; iu <= nx; iu++) {
        const f = j * nx1 + iu;
        const il = Math.max(0, iu - 1);
        const ir = Math.min(nx - 1, iu);
        const cd = 0.5 * (g.cd[j * nx + il]! + g.cd[j * nx + ir]!);
        const vb = 0.25 * (v[j * nx + il]! + v[(j + 1) * nx + il]! + v[j * nx + ir]! + v[(j + 1) * nx + ir]!);
        const vbb = 0.25 * (this.bgV[j * nx + il]! + this.bgV[(j + 1) * nx + il]! + this.bgV[j * nx + ir]! + this.bgV[(j + 1) * nx + ir]!);
        const a = (dt * cd) / (g.dzeta[0]! * g.Ju[f]!);
        const sp = Math.hypot(u[f]!, vb);
        const spb = Math.hypot(this.bgU[f]!, vbb);
        u[f] = (u[f]! + a * spb * bgU[f]!) / (1 + a * sp);
      }
    }
    for (let jv = 0; jv <= ny; jv++) {
      const jl = Math.max(0, jv - 1);
      const jr = Math.min(ny - 1, jv);
      for (let i = 0; i < nx; i++) {
        const f = jv * nx + i;
        const cd = 0.5 * (g.cd[jl * nx + i]! + g.cd[jr * nx + i]!);
        const ub = 0.25 * (u[jl * nx1 + i]! + u[jl * nx1 + i + 1]! + u[jr * nx1 + i]! + u[jr * nx1 + i + 1]!);
        const ubb = 0.25 * (this.bgU[jl * nx1 + i]! + this.bgU[jl * nx1 + i + 1]! + this.bgU[jr * nx1 + i]! + this.bgU[jr * nx1 + i + 1]!);
        const a = (dt * cd) / (g.dzeta[0]! * g.Jv[f]!);
        const sp = Math.hypot(v[f]!, ub);
        const spb = Math.hypot(this.bgV[f]!, ubb);
        v[f] = (v[f]! + a * spb * bgV[f]!) / (1 + a * sp);
      }
    }
    nudge(u, this.bgU, this.nuU, dt);
    nudge(v, this.bgV, this.nuV, dt);
    nudge(w, this.bgW, this.nuW, dt);
    this.sponge(dt);

    // 6 Smagorinsky diffusion ([H] momentum diffused as the departure from u_bg, θ′ about θ_env(z_ASL))
    collocate(g, u, v, w, this.uc, this.vc, this.wc, null, null, null);
    smagorinsky(g, dt, u, v, w, this.uc, this.vc, this.wc, th, gth, dth, this.slopeLim, this.kmh, this.kmv, this.khh, this.khv);
    subInPlace(u, bgU);
    subInPlace(v, bgV);
    subInPlace(w, this.cbW);
    diffuseH(g, dt, this.kmh, u, this.u2, nx + 1, ny, nz, 0.5, 0, 0);
    diffuseH(g, dt, this.kmh, v, this.v2, nx, ny + 1, nz, 0, 0.5, 0);
    diffuseH(g, dt, this.kmh, w, this.w2, nx, ny, nz + 1, 0, 0, 0.5);
    diffuseH(g, dt, this.khh, th, this.th2, nx, ny, nz, 0, 0, 0);
    [this.u, this.u2] = [this.u2, this.u];
    [this.v, this.v2] = [this.v2, this.v];
    [this.w, this.w2] = [this.w2, this.w];
    [this.th, this.th2] = [this.th2, this.th];
    if (this.smokeActive) {
      diffuseH(g, dt, this.khh, sm, this.sm2, nx, ny, nz, 0, 0, 0);
      [this.sm, this.sm2] = [this.sm2, this.sm];
    }
    const cs = this.colScratch;
    diffuseVLevels(g, dt, this.kmv, this.u, nx + 1, ny, 0.5, 0, this.JuF, cs);
    diffuseVLevels(g, dt, this.kmv, this.v, nx, ny + 1, 0, 0.5, this.JvF, cs);
    diffuseVW(g, dt, this.kmv, this.w, cs);
    diffuseVLevels(g, dt, this.khv, this.th, nx, ny, 0, 0, g.J, cs);
    if (this.smokeActive) diffuseVLevels(g, dt, this.khv, this.sm, nx, ny, 0, 0, g.J, cs);
    addInPlace(this.u, bgU);
    addInPlace(this.v, bgV);
    addInPlace(this.w, this.cbW);

    // 7 projection
    this.project();

    // 8 Davies zones (θ′ target = cold pool + the current band mean, so the zones follow the interior's mean state)
    this.bandMeans();
    this.davies();

    // [H] horizontal-mean θ′ control on ASL bands, smoke decay
    this.meanThetaControl(dt);
    if (this.smokeActive) {
      const f = Math.exp(-dt / P.smokeTauS);
      const s = this.sm;
      for (let o = 0; o < n; o++) s[o] = s[o]! * f;
    }

    // Stats and the collocated fields for sampling.
    collocate(g, this.u, this.v, this.w, this.uc, this.vc, this.wc, null, null, null);
    let mu = 0;
    for (let q = 0; q < this.u.length; q++) mu = Math.max(mu, Math.abs(this.u[q]!));
    for (let q = 0; q < this.v.length; q++) mu = Math.max(mu, Math.abs(this.v[q]!));
    let mw = 0;
    for (let q = plane; q < this.w.length - plane; q++) mw = Math.max(mw, Math.abs(this.w[q]!));
    this.maxU = mu;
    this.maxW = mw;
    this.spinTime += dt;
    this.accumulateHeating(dt);
  }

  private sponge(dt: number): void {
    const g = this.grid;
    const P = ATMOS_PARAMS;
    const { nx, ny, nz, plane } = g;
    const nx1 = nx + 1;
    for (let m = 0; m <= nz; m++) {
      const s = this.spongeW[m]!;
      if (s <= 0) continue;
      const f = 1 / (1 + dt * P.spongeGammaW * s);
      for (let c = 0; c < plane; c++) this.w[m * plane + c] = this.w[m * plane + c]! * f;
    }
    for (let k = 0; k < nz; k++) {
      const s = this.spongeC[k]!;
      if (s <= 0) continue;
      const r = dt * P.spongeRelax * s;
      const f = 1 / (1 + r);
      for (let q = k * ny * nx1; q < (k + 1) * ny * nx1; q++) this.u[q] = (this.u[q]! + r * this.bgU[q]!) * f;
      for (let q = k * (ny + 1) * nx; q < (k + 1) * (ny + 1) * nx; q++) this.v[q] = (this.v[q]! + r * this.bgV[q]!) * f;
      for (let c = 0; c < plane; c++) {
        const o = k * plane + c;
        this.th[o] = (this.th[o]! + r * this.cpT[o]!) * f;
      }
    }
  }

  private project(): void {
    const g = this.grid;
    const P = ATMOS_PARAMS;
    this.proj.divergence(this.u, this.v, this.w, this.rhs);
    const cycles = g.tier.vCycles;
    const res = this.proj.solve(this.phi, this.rhs, { tol: P.projTol, minIter: cycles, maxIter: cycles + P.projExtraCycles });
    this.lastProjection = { iterations: res.iterations, relResidual: res.relResidual };
    this.proj.correct(this.phi, this.u, this.v, this.w);
    setGroundW(g, this.u, this.v, this.w);
  }

  private davies(): void {
    const g = this.grid;
    const { nx, ny, nz, plane } = g;
    const nx1 = nx + 1;
    const u = this.u;
    const v = this.v;
    const w = this.w;
    const tau = ATMOS_PARAMS.nudgeTauS;
    const zu = this.dzU;
    const zv = this.dzV;
    const zc = this.dzC;
    for (let k = 0; k < nz; k++) {
      const ou = k * ny * nx1;
      for (let p = 0; p < zu.length; p++) {
        const q = zu[p]!;
        const f = ou + q;
        const lam = this.dvU[q]! * this.nuU[f]! * tau;
        u[f] = u[f]! - lam * (u[f]! - this.bgU[f]!);
      }
      const ov = k * (ny + 1) * nx;
      for (let p = 0; p < zv.length; p++) {
        const q = zv[p]!;
        const f = ov + q;
        const lam = this.dvV[q]! * this.nuV[f]! * tau;
        v[f] = v[f]! - lam * (v[f]! - this.bgV[f]!);
      }
      const oc = k * plane;
      for (let p = 0; p < zc.length; p++) {
        const c = zc[p]!;
        const d = this.dvC[c]!;
        const o = oc + c;
        const target = this.cpT[o]! + this.binSum[this.bin[o]!]!;
        this.th[o] = this.th[o]! - d * (this.th[o]! - target);
        if (this.smokeActive) this.sm[o] = this.sm[o]! * (1 - d);
        if (k > 0) w[o] = w[o]! - d * (w[o]! - this.bgW[o]!);
      }
    }
  }

  /** Band means of (θ′ − θ′_cp) on 50 m ASL bands → binSum (mean per band). */
  private bandMeans(): void {
    const th = this.th;
    const cp = this.cpT;
    const bin = this.bin;
    const sum = this.binSum;
    sum.fill(0);
    const n = th.length;
    for (let o = 0; o < n; o++) sum[bin[o]!] += th[o]! - cp[o]!;
    for (let b = 0; b < sum.length; b++) sum[b] = this.binCnt[b]! > 0 ? sum[b]! / this.binCnt[b]! : 0;
  }

  /** Relax the band means of (θ′ − θ′_cp) toward 0 with τ = meanThetaTauS (uses binSum from bandMeans()). */
  private meanThetaControl(dt: number): void {
    const tau = ATMOS_PARAMS.meanThetaTauS;
    if (!(tau > 0)) return;
    this.bandMeans();
    const f = 1 - Math.exp(-dt / tau);
    const th = this.th;
    const bin = this.bin;
    const sum = this.binSum;
    const n = th.length;
    for (let o = 0; o < n; o++) th[o] = th[o]! - f * sum[bin[o]!]!;
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Fire wind (§8.8, 3-D tiers)
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  protected fireWindTier(
    outU: Float32Array,
    outV: Float32Array,
    outBgU: Float32Array,
    outBgV: Float32Array,
    outIndU: Float32Array,
    outIndV: Float32Array,
    _ctx: FireWindContextExt,
    cf: number,
  ): { resolvedU: Float32Array | null; resolvedV: Float32Array | null } {
    if (!this.initialised) this.initialiseState();
    const du = this.scratchA;
    const dv = this.scratchB;
    this.sampleFire(this.uc, this.vc, du, dv);
    const kap = this.tmp2;
    for (let k = 0; k < this.nf; k++) {
      this.kappaAt(k, kap);
      const re = kap[0]!;
      const im = kap[1]!;
      const pu = du[k]!;
      const pv = dv[k]!;
      const dyU = re * pu - im * pv;
      const dyV = re * pv + im * pu;
      du[k] = dyU;
      dv[k] = dyV;
      const bu = outBgU[k]!;
      const bv = outBgV[k]!;
      const mf = this.fireInfluence[k]!;
      if (cf > 0) {
        const f = 1 - mf + cf * mf;
        outU[k] = bu + (dyU - bu) * f;
        outV[k] = bv + (dyV - bv) * f;
        outIndU[k] = cf * mf * (dyU - bu);
        outIndV[k] = cf * mf * (dyV - bv);
      } else {
        outU[k] = dyU;
        outV[k] = dyV;
        outIndU[k] = 0;
        outIndV[k] = 0;
      }
    }
    return { resolvedU: du, resolvedV: dv };
  }

  /** Resolved θ′ anomaly at z_cell + 2 m relative to the cold-pool template, converted to K (°C difference). */
  protected override addAirAnomaly(outT: Float32Array): void {
    if (!this.initialised) return;
    const plane = this.grid.plane;
    const th = this.th;
    const cp = this.cpT;
    for (let k = 0; k < this.nf; k++) {
      let s = 0;
      for (let q = 4 * k; q < 4 * k + 4; q++) {
        const wq = this.stW[q]!;
        if (wq === 0) continue;
        const o = this.st2K[q]! * plane + this.stC[q]!;
        const t = this.st2T[q]!;
        const a = th[o]! - cp[o]!;
        const b = th[o + plane]! - cp[o + plane]!;
        s += wq * (a + (b - a) * t);
      }
      outT[k] = outT[k]! + s * this.piFire[k]!;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Sampling and view
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  /** Trilinear sample of centre fields at (x, y, z_ASL); returns false above the lid. */
  private sampleAt(x: number, y: number, zAsl: number, f1: Float32Array, f2: Float32Array, f3: Float32Array, out: Float32Array): boolean {
    const g = this.grid;
    const fx = clamp((x - g.grid.x0) / g.dx, 0, g.nx - 1);
    const fy = clamp((y - g.grid.y0) / g.dx, 0, g.ny - 1);
    const i0 = Math.min(Math.floor(fx), Math.max(0, g.nx - 2));
    const j0 = Math.min(Math.floor(fy), Math.max(0, g.ny - 2));
    const tx = fx - i0;
    const ty = fy - j0;
    const plane = g.plane;
    let a = 0;
    let b = 0;
    let c3 = 0;
    let above = true;
    for (let q = 0; q < 4; q++) {
      const c = (j0 + (q >> 1)) * g.nx + i0 + (q & 1);
      const wq = (q & 1 ? tx : 1 - tx) * (q >> 1 ? ty : 1 - ty);
      if (wq === 0) continue;
      const agl = zAsl - g.zs[c]!;
      if (agl / g.J[c]! <= g.Hp) above = false;
      const kf = levelFrac(g, c, agl);
      const k0 = Math.min(Math.floor(kf), g.nz - 2);
      const t = kf - k0;
      const o = k0 * plane + c;
      a += wq * (f1[o]! + (f1[o + plane]! - f1[o]!) * t);
      b += wq * (f2[o]! + (f2[o + plane]! - f2[o]!) * t);
      c3 += wq * (f3[o]! + (f3[o + plane]! - f3[o]!) * t);
    }
    out[0] = a;
    out[1] = b;
    out[2] = c3;
    return !above;
  }

  sample(x: number, y: number, zAGL: number, out: Float32Array): void {
    if (!this.initialised) this.initialiseState();
    const zAsl = this.groundAt(x, y) + Math.max(0, zAGL);
    const inside = this.sampleAt(x, y, zAsl, this.uc, this.vc, this.wc, out);
    if (!inside) {
      // Above the lid: grid-point profile at the same height, w = 0.
      const p = this.stampA.profile;
      profileWind(p, zAsl - p.zgp, this.tmp2b);
      out[0] = this.tmp2b[0]!;
      out[1] = this.tmp2b[1]!;
      out[2] = 0;
    }
  }

  protected windAt(x: number, y: number, zAgl: number, out: Float32Array): void {
    this.sample(x, y, zAgl, out);
  }

  view(): AtmosphereView {
    if (!this.initialised) this.initialiseState();
    const g = this.grid;
    const { nz, plane } = g;
    const N = plane * nz;
    const u = new Float32Array(N);
    const v = new Float32Array(N);
    const w = new Float32Array(N);
    const th = new Float32Array(N);
    const sm = new Float32Array(N);
    const levels = new Float32Array(nz);
    for (let k = 0; k < nz; k++) levels[k] = g.zetaC[k]!;
    const terrainHeight = new Float32Array(plane);
    const surfaceU = new Float32Array(plane);
    const surfaceV = new Float32Array(plane);
    const A = this.stampA;
    const B = this.stampB;
    const a = this.wgt;
    for (let c = 0; c < plane; c++) {
      const h0 = g.zs[c]! - g.zMin;
      terrainHeight[c] = h0;
      const J = g.J[c]!;
      for (let l = 0; l < nz; l++) {
        const zeta = (g.zetaC[l]! - h0) / J;
        if (zeta < 0) continue; // below the terrain: 0
        const kf = zeta <= g.zetaC[0]! ? 0 : levelFrac(g, c, zeta * J);
        const k0 = Math.min(Math.floor(kf), nz - 2);
        const t = kf - k0;
        const o = k0 * plane + c;
        const d = l * plane + c;
        u[d] = this.uc[o]! + (this.uc[o + plane]! - this.uc[o]!) * t;
        v[d] = this.vc[o]! + (this.vc[o + plane]! - this.vc[o]!) * t;
        w[d] = this.wc[o]! + (this.wc[o + plane]! - this.wc[o]!) * t;
        th[d] = this.th[o]! + (this.th[o + plane]! - this.th[o]!) * t;
        sm[d] = this.sm[o]! + (this.sm[o + plane]! - this.sm[o]!) * t;
      }
      const z1 = g.zetaC[0]! * J;
      const re = (1 - a) * kappaLookup(A.kappa!.re, z1) + a * kappaLookup(B.kappa!.re, z1);
      const im = (1 - a) * kappaLookup(A.kappa!.im, z1) + a * kappaLookup(B.kappa!.im, z1);
      const uu = this.uc[c]!;
      const vv = this.vc[c]!;
      surfaceU[c] = re * uu - im * vv;
      surfaceV[c] = re * vv + im * uu;
    }
    return { grid: g.grid, nz, levels, terrainHeight, surfaceU, surfaceV, u, v, w, thetaAnomaly: th, smoke: sm };
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Diagnostics
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  protected thetaAt(c: number, zAsl: number): number {
    const g = this.grid;
    const base = thetaRaw(this.stampA.profile, zAsl);
    if (!this.initialised) {
      const hav = zAsl - g.zFloor[c]!;
      const hInv = Math.max(1, this.night.hInv);
      return hav < hInv ? base - this.night.dTheta * (1 - Math.max(0, hav) / hInv) : base;
    }
    const kf = levelFrac(g, c, zAsl - g.zs[c]!);
    const k0 = Math.min(Math.floor(kf), g.nz - 2);
    const t = kf - k0;
    const o = k0 * g.plane + c;
    return base + this.th[o]! + (this.th[o + g.plane]! - this.th[o]!) * t;
  }

  diagnostics(): AtmosDiagnostics {
    return this.commonDiagnostics(this.maxW);
  }

  /** Max |∇·u|·Δx/|u| over the domain (projection quality, §8.11). */
  divergenceMetric(): number {
    const g = this.grid;
    this.proj.divergence(this.u, this.v, this.w, this.rhs);
    let worst = 0;
    let umax = 1e-6;
    for (let q = 0; q < this.uc.length; q++) umax = Math.max(umax, Math.hypot(this.uc[q]!, this.vc[q]!));
    for (let k = 0; k < g.nz; k++) {
      for (let c = 0; c < g.plane; c++) {
        const vol = g.J[c]! * g.dx * g.dx * g.dzeta[k]!;
        worst = Math.max(worst, Math.abs(this.rhs[k * g.plane + c]!) / vol);
      }
    }
    return (worst * g.dx) / umax;
  }

  /** Read-only access to the state for tests and render adapters. */
  get state(): { u: Float32Array; v: Float32Array; w: Float32Array; theta: Float32Array; smoke: Float32Array; uc: Float32Array; vc: Float32Array; wc: Float32Array } {
    return { u: this.u, v: this.v, w: this.w, theta: this.th, smoke: this.sm, uc: this.uc, vc: this.vc, wc: this.wc };
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Checkpoint
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  checkpoint(): unknown {
    const c: AtmosCheckpoint = {
      kind: 'atmosphere',
      base: this.baseCheckpoint(),
      u: this.u.slice(),
      v: this.v.slice(),
      w: this.w.slice(),
      th: this.th.slice(),
      sm: this.sm.slice(),
      phi: this.phi.slice(),
      initialised: this.initialised,
      spinTime: this.spinTime,
      maxU: this.maxU,
      maxW: this.maxW,
      smokeActive: this.smokeActive,
      qfS: this.qfS.slice(),
      qfC: this.qfC.slice(),
      hC: this.hC.slice(),
      fireCols: this.fireCols.slice(),
    };
    return c;
  }

  restore(cIn: unknown): void {
    const c = cIn as AtmosCheckpoint;
    if (!c || c.kind !== 'atmosphere') throw new Error('Atmosphere.restore: not an Atmosphere checkpoint');
    this.baseRestore(c.base);
    this.u.set(c.u);
    this.v.set(c.v);
    this.w.set(c.w);
    this.th.set(c.th);
    this.sm.set(c.sm);
    this.phi.set(c.phi);
    this.initialised = c.initialised;
    this.spinTime = c.spinTime;
    this.maxU = c.maxU;
    this.maxW = c.maxW;
    this.smokeActive = c.smokeActive;
    this.qfS.set(c.qfS);
    this.qfC.set(c.qfC);
    this.hC.set(c.hC);
    this.fireCols = c.fireCols.slice();
    this.blendKey = '';
    this.maskKey = null;
    collocate(this.grid, this.u, this.v, this.w, this.uc, this.vc, this.wc, null, null, null);
  }
}

function mulInto(out: Float32Array, a: Float32Array, b: Float32Array): void {
  for (let q = 0; q < out.length; q++) out[q] = a[q]! * b[q]!;
}

function subInPlace(a: Float32Array, b: Float32Array): void {
  for (let q = 0; q < a.length; q++) a[q] = a[q]! - b[q]!;
}

function addInPlace(a: Float32Array, b: Float32Array): void {
  for (let q = 0; q < a.length; q++) a[q] = a[q]! + b[q]!;
}

/** Implicit relaxation u ← (u + Δt·ν·u_bg)/(1 + Δt·ν). */
function nudge(f: Float32Array, bg: Float32Array, nu: Float32Array, dt: number): void {
  for (let q = 0; q < f.length; q++) {
    const r = dt * nu[q]!;
    f[q] = (f[q]! + r * bg[q]!) / (1 + r);
  }
}
