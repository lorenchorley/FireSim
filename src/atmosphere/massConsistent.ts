/**
 * Mass-consistent background wind u_bg (spec §8.3; V WindNinja `ninja::discretize`).
 *
 * Minimise ∫[α_h²((u − u₀)² + (v − v₀)²) + α_v²(w − w₀)²]dV subject to ∇·u = 0 ⇒ ∇·(R∇φ) = −∇·u₀,
 * u = u₀ + R∇φ, R = diag(R_h, R_h, R_v) = 1/(2α²); φ = 0 on the lateral and top faces, ∂φ/∂n = 0 at the ground.
 * First guess: terrain-following profile below 300 m AGL, the grid-point column at the same ASL height above 800 m,
 * linear blend between (doc 07 §7.7). User wind edits enter only through u₀.
 */
import type { WindEdit } from '../core/types';
import { smoothstep, windToUV } from '../core/units';
import type { AtmosGrid } from './grid';
import { ATMOS_PARAMS } from './params';
import { alphaVRatio, profileWind, type BackgroundProfile } from './profile';
import { EllipticSolver, allLateralActive, type SolveResult } from './solver';

/** A wind edit resolved to an absolute start time (unix ms). */
export interface ResolvedWindEdit {
  x: number;
  y: number;
  radius: number;
  speed: number;
  dir: number;
  startMs: number;
}

export function resolveWindEdits(edits: WindEdit[], scenarioStartMs: number): ResolvedWindEdit[] {
  return edits.map((e) => ({ x: e.x, y: e.y, radius: e.radius, speed: e.speed, dir: e.dir, startMs: scenarioStartMs + e.time * 1000 }));
}

/** Solved background wind of one stamp (face fields, physical components) plus its solver state. */
export interface BgWind {
  time: number;
  profile: BackgroundProfile;
  u: Float32Array;
  v: Float32Array;
  w: Float32Array;
  /** Cell-centred u, v, w (for sampling and the view). */
  uc: Float32Array;
  vc: Float32Array;
  wc: Float32Array;
  /** Converged potential (warm start of the next stamp). */
  phi: Float64Array;
  alphaV: number;
  result: SolveResult;
}

/** Physical w at the ground face = ū·z_x + v̄·z_y (no penetration, W̃ = 0). */
export function setGroundW(g: AtmosGrid, u: Float32Array, v: Float32Array, w: Float32Array): void {
  const { nx, ny } = g;
  const nx1 = nx + 1;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const c = j * nx + i;
      const uc = 0.5 * (u[j * nx1 + i]! + u[j * nx1 + i + 1]!);
      const vc = 0.5 * (v[j * nx + i]! + v[(j + 1) * nx + i]!);
      w[c] = uc * g.zsx[c]! + vc * g.zsy[c]!;
    }
  }
}

/** Face → cell-centre averages. */
export function facesToCentres(g: AtmosGrid, u: Float32Array, v: Float32Array, w: Float32Array, uc: Float32Array, vc: Float32Array, wc: Float32Array): void {
  const { nx, ny, nz, plane } = g;
  const nx1 = nx + 1;
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      const fu = (k * ny + j) * nx1;
      const fv = (k * (ny + 1) + j) * nx;
      const o = k * plane + j * nx;
      for (let i = 0; i < nx; i++) {
        uc[o + i] = 0.5 * (u[fu + i]! + u[fu + i + 1]!);
        vc[o + i] = 0.5 * (v[fv + i]! + v[fv + i + nx]!);
        wc[o + i] = 0.5 * (w[o + i]! + w[o + plane + i]!);
      }
    }
  }
}

export class MassConsistentSolver {
  readonly g: AtmosGrid;
  readonly solver: EllipticSolver;
  /** Face heights (AGL, ASL) and positions, static. */
  private uAgl: Float32Array;
  private uAsl: Float32Array;
  private vAgl: Float32Array;
  private vAsl: Float32Array;
  private rhs: Float64Array;

  constructor(g: AtmosGrid) {
    this.g = g;
    this.solver = new EllipticSolver(g, 0.5, 0.5, allLateralActive(g, true));
    const { nx, ny, nz } = g;
    const nx1 = nx + 1;
    this.uAgl = new Float32Array(g.nU);
    this.uAsl = new Float32Array(g.nU);
    this.vAgl = new Float32Array(g.nV);
    this.vAsl = new Float32Array(g.nV);
    for (let k = 0; k < nz; k++) {
      const zc = g.zetaC[k]!;
      for (let j = 0; j < ny; j++) {
        for (let iu = 0; iu <= nx; iu++) {
          const f = (k * ny + j) * nx1 + iu;
          const a = g.zs[j * nx + Math.max(0, iu - 1)]!;
          const b = g.zs[j * nx + Math.min(nx - 1, iu)]!;
          const agl = zc * g.Ju[j * nx1 + iu]!;
          this.uAgl[f] = agl;
          this.uAsl[f] = 0.5 * (a + b) + agl;
        }
      }
      for (let jv = 0; jv <= ny; jv++) {
        for (let i = 0; i < nx; i++) {
          const f = (k * (ny + 1) + jv) * nx + i;
          const a = g.zs[Math.max(0, jv - 1) * nx + i]!;
          const b = g.zs[Math.min(ny - 1, jv) * nx + i]!;
          const agl = zc * g.Jv[jv * nx + i]!;
          this.vAgl[f] = agl;
          this.vAsl[f] = 0.5 * (a + b) + agl;
        }
      }
    }
    this.rhs = new Float64Array(g.n);
  }

  /** First guess on the faces (§8.3), including wind edits active at the stamp time. */
  firstGuess(p: BackgroundProfile, edits: ResolvedWindEdit[], u: Float32Array, v: Float32Array, w: Float32Array): void {
    const P = ATMOS_PARAMS;
    const g = this.g;
    const { nx, ny, nz, dx } = g;
    const nx1 = nx + 1;
    const o1 = new Float64Array(2);
    const o2 = new Float64Array(2);
    const active = edits.filter((e) => p.time >= e.startMs && e.radius > 0);
    const s10 = Math.hypot(p.u10, p.v10);
    const blend = (agl: number, asl: number, comp: 0 | 1, x: number, y: number): number => {
      profileWind(p, agl, o1);
      let val = o1[comp]!;
      if (agl > P.firstGuessLow) {
        profileWind(p, Math.max(10, asl - p.zgp), o2);
        const t = Math.min(1, (agl - P.firstGuessLow) / (P.firstGuessHigh - P.firstGuessLow));
        val = val * (1 - t) + o2[comp]! * t;
      }
      for (const e of active) {
        const d = Math.hypot(x - e.x, y - e.y);
        const wgt = Math.exp(-((d / e.radius) ** 2)) * (1 - smoothstep(0, P.windEditFadeTop, agl));
        if (wgt < 1e-6) continue;
        const [eu, ev] = windToUV(e.speed, e.dir);
        // The edit is a 10 m open-equivalent reading: scale it with the profile shape (so U10_fire = edit on flat).
        profileWind(p, agl, o2);
        const shape = s10 > ATMOS_PARAMS.kappaMinSpeed ? Math.hypot(o2[0]!, o2[1]!) / s10 : 1;
        val = (1 - wgt) * val + wgt * (comp === 0 ? eu : ev) * shape;
      }
      return val;
    };
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        const y = g.grid.y0 + j * dx;
        for (let iu = 0; iu <= nx; iu++) {
          const f = (k * ny + j) * nx1 + iu;
          u[f] = blend(this.uAgl[f]!, this.uAsl[f]!, 0, g.grid.x0 + (iu - 0.5) * dx, y);
        }
      }
      for (let jv = 0; jv <= ny; jv++) {
        const y = g.grid.y0 + (jv - 0.5) * dx;
        for (let i = 0; i < nx; i++) {
          const f = (k * (ny + 1) + jv) * nx + i;
          v[f] = blend(this.vAgl[f]!, this.vAsl[f]!, 1, g.grid.x0 + i * dx, y);
        }
      }
    }
    w.fill(0);
  }

  /** Solve one stamp. `warm` is the potential of the previous stamp (deterministic warm start). */
  solve(p: BackgroundProfile, edits: ResolvedWindEdit[], warm: Float64Array | null): BgWind {
    const P = ATMOS_PARAMS;
    const g = this.g;
    const u = new Float32Array(g.nU);
    const v = new Float32Array(g.nV);
    const w = new Float32Array(g.nW);
    this.firstGuess(p, edits, u, v, w);
    const ratio = alphaVRatio(p);
    const aH = P.alphaH;
    const aV = aH * ratio;
    const Rh = 1 / (2 * aH * aH);
    const Rv = 1 / (2 * aV * aV);
    if (this.solver.Rh !== Rh || this.solver.Rv !== Rv) this.solver.reconfigure(Rh, Rv, this.solver.masks);
    this.solver.divergence(u, v, w, this.rhs);
    const phi = warm ? Float64Array.from(warm) : new Float64Array(g.n);
    const result = this.solver.solve(phi, this.rhs, { tol: P.mcTol, maxIter: P.mcMaxIter, allowPcg: true });
    this.solver.correct(phi, u, v, w);
    setGroundW(g, u, v, w);
    const uc = new Float32Array(g.n);
    const vc = new Float32Array(g.n);
    const wc = new Float32Array(g.n);
    facesToCentres(g, u, v, w, uc, vc, wc);
    return { time: p.time, profile: p, u, v, w, uc, vc, wc, phi, alphaV: ratio, result };
  }
}
