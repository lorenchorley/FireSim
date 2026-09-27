/**
 * Terrain-following elliptic solver (spec §8.1 metric, §8.3 mass-consistent problem, §8.5 multigrid).
 *
 * Discretisation (variational, so the projection is exact to solver tolerance and the operator is symmetric):
 *   D u  = volume-integrated divergence  Δy Δζ_k [J_u u]_{i±½} + Δx Δζ_k [J_v v]_{j±½} + Δx Δy [W̃]_{m±½},
 *          W̃ = J·ω = w − ū·z_x|ζ − v̄·z_y|ζ at w-faces (ū, v̄ = 4-face averages), W̃ = 0 at the ground.
 *   G φ  = −M⁻¹Dᵀλ with λ = −φ, M = face volumes  ⇒  G_u = φ_x − (z_x/J)·φ_ζ (averaged), G_w = φ_ζ/J
 *          (the physical gradient (∂/∂x)_z, ∂/∂z of §8.1).
 *   A φ  = −D(R G φ)   (symmetric positive semi-definite), R = diag(R_h, R_h, R_v).
 *   Mass-consistent / projection: A φ = D u₀,  u = u₀ + R G φ  ⇒  D u = 0.
 * Boundary faces are either "active" (Dirichlet φ = 0 at the face: the face velocity is adjusted, flow may pass)
 * or inactive (Neumann: the face velocity is fixed). The ground is always Neumann (W̃ = 0).
 *
 * Multigrid (§8.5): horizontal semi-coarsening (nx, ny halve, nz fixed) down to ≤ 8 cells, z-line (tridiagonal)
 * zebra relaxation with pre-factorised lines, bilinear prolongation P and restriction Pᵀ, on the 7-point part A₇
 * (J K_h p_xx, J K_h p_yy and the lumped ζζ coefficient). The metric cross terms enter the fine residual only
 * (defect correction). When defect correction converges slower than 0.3 per cycle the same V-cycle preconditions
 * CG (A is symmetric by construction, so PCG replaces the spec's BiCGSTAB at half the cost per iteration).
 */
import type { AtmosGrid } from './grid';
import { ATMOS_PARAMS } from './params';

/** Which boundary faces are active (Dirichlet φ = 0 → velocity adjustable). Interior faces are always active. */
export interface BoundaryMasks {
  /** Over u-faces (nU); only the entries at i = 0 and i = nx are read. */
  activeU: Uint8Array;
  /** Over v-faces (nV); only the entries at j = 0 and j = ny are read. */
  activeV: Uint8Array;
  /** Top face Dirichlet (true) or Neumann (false). */
  topActive: boolean;
}

/** All lateral faces active (mass-consistent problem, §8.3). */
export function allLateralActive(g: AtmosGrid, topActive: boolean): BoundaryMasks {
  return { activeU: new Uint8Array(g.nU).fill(1), activeV: new Uint8Array(g.nV).fill(1), topActive };
}

/** Multigrid level (Float32: the V-cycle is a preconditioner; the outer residual stays Float64). */
interface Level {
  nx: number;
  ny: number;
  nz: number;
  plane: number;
  n: number;
  cx: Float32Array;
  cy: Float32Array;
  cz: Float32Array;
  diag: Float32Array;
  tInv: Float32Array;
  tC: Float32Array;
  x: Float32Array;
  b: Float32Array;
  r: Float32Array;
  /** Transfer to the next coarser level: per fine i (j) the two coarse indices and the weight of the second. */
  px0?: Int32Array;
  px1?: Int32Array;
  ax0?: Float64Array;
  ax1?: Float64Array;
  py0?: Int32Array;
  py1?: Int32Array;
  ay0?: Float64Array;
  ay1?: Float64Array;
}

export interface SolveResult {
  iterations: number;
  /** ‖b − Aφ‖/‖b‖ at the last evaluation (NaN when not evaluated after the last cycle). */
  relResidual: number;
  /** Mean reduction factor per cycle. */
  rate: number;
  method: 'dc' | 'pcg' | 'none';
}

export class EllipticSolver {
  readonly g: AtmosGrid;
  Rh: number;
  Rv: number;
  masks: BoundaryMasks;
  private levels: Level[] = [];
  // Scratch for the full operator.
  private gu: Float64Array;
  private gv: Float64Array;
  private gw: Float64Array;
  private sx: Float64Array;
  private sy: Float64Array;
  private wt: Float64Array;
  private tmpCol: Float64Array;
  /** Metric factor (1 − ζF[m]/H′) per w-face level. */
  private fzeta: Float64Array;
  // PCG scratch.
  private pr: Float64Array;
  private pz: Float64Array;
  private pp: Float64Array;
  private pAp: Float64Array;
  /** Set when the system has no Dirichlet face (compatibility: remove the mean). */
  singular = false;

  constructor(g: AtmosGrid, Rh: number, Rv: number, masks: BoundaryMasks) {
    this.g = g;
    this.Rh = Rh;
    this.Rv = Rv;
    this.masks = masks;
    this.gu = new Float64Array(g.nU);
    this.gv = new Float64Array(g.nV);
    this.gw = new Float64Array(g.nW);
    this.sx = new Float64Array(g.nW);
    this.sy = new Float64Array(g.nW);
    this.wt = new Float64Array(g.nW);
    this.tmpCol = new Float64Array(g.nz);
    this.fzeta = new Float64Array(g.nz + 1);
    for (let m = 0; m <= g.nz; m++) this.fzeta[m] = 1 - g.zetaF[m]! / g.Hp;
    this.pr = new Float64Array(g.n);
    this.pz = new Float64Array(g.n);
    this.pp = new Float64Array(g.n);
    this.pAp = new Float64Array(g.n);
    this.build();
  }

  /** Change weights and/or boundary masks and rebuild the hierarchy (O(N)). */
  reconfigure(Rh: number, Rv: number, masks: BoundaryMasks): void {
    this.Rh = Rh;
    this.Rv = Rv;
    this.masks = masks;
    this.build();
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Hierarchy
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  private build(): void {
    const g = this.g;
    const { nx, ny, nz, plane, dx } = g;
    const { activeU, activeV, topActive } = this.masks;
    const Rh = this.Rh;
    const Rv = this.Rv;
    const nx1 = nx + 1;
    const L0 = this.levels[0] ?? this.allocLevel(nx, ny, nz);
    // x-faces
    let anyDirichlet = topActive;
    for (let k = 0; k < nz; k++) {
      const dzk = g.dzeta[k]!;
      for (let j = 0; j < ny; j++) {
        for (let iu = 0; iu <= nx; iu++) {
          const f = (k * ny + j) * nx1 + iu;
          const bnd = iu === 0 || iu === nx;
          let c = 0;
          if (!bnd) c = (Rh * g.Ju[j * nx1 + iu]! * dx * dzk) / dx;
          else if (activeU[f]) {
            c = (Rh * g.Ju[j * nx1 + iu]! * dx * dzk) / (0.5 * dx);
            anyDirichlet = true;
          }
          L0.cx[f] = c;
        }
      }
      for (let jv = 0; jv <= ny; jv++) {
        for (let i = 0; i < nx; i++) {
          const f = (k * (ny + 1) + jv) * nx + i;
          const bnd = jv === 0 || jv === ny;
          let c = 0;
          if (!bnd) c = (Rh * g.Jv[jv * nx + i]! * dx * dzk) / dx;
          else if (activeV[f]) {
            c = (Rh * g.Jv[jv * nx + i]! * dx * dzk) / (0.5 * dx);
            anyDirichlet = true;
          }
          L0.cy[f] = c;
        }
      }
    }
    const area = dx * dx;
    for (let m = 0; m <= nz; m++) {
      const fz = this.fzeta[m]!;
      for (let c = 0; c < plane; c++) {
        let v = 0;
        if (m > 0 && m < nz) {
          const zx = g.zsx[c]! * fz;
          const zy = g.zsy[c]! * fz;
          v = (area * (Rv + Rh * (zx * zx + zy * zy))) / (g.J[c]! * g.dzetaW[m]!);
        } else if (m === nz && topActive) v = (area * Rv) / (g.J[c]! * g.dzetaW[m]!);
        L0.cz[m * plane + c] = v;
      }
    }
    this.singular = !anyDirichlet;
    this.levels = [L0];
    this.finishLevel(L0);
    // Coarse levels.
    let fine = L0;
    while (fine.nx > 8 || fine.ny > 8) {
      if (fine.nx <= 2 && fine.ny <= 2) break;
      const cnx = fine.nx > 8 ? Math.ceil(fine.nx / 2) : fine.nx;
      const cny = fine.ny > 8 ? Math.ceil(fine.ny / 2) : fine.ny;
      const C = this.allocLevel(cnx, cny, nz);
      this.coarsen(fine, C);
      this.finishLevel(C);
      this.levels.push(C);
      fine = C;
    }
  }

  private allocLevel(nx: number, ny: number, nz: number): Level {
    const plane = nx * ny;
    const n = plane * nz;
    return {
      nx,
      ny,
      nz,
      plane,
      n,
      cx: new Float32Array((nx + 1) * ny * nz),
      cy: new Float32Array(nx * (ny + 1) * nz),
      cz: new Float32Array(plane * (nz + 1)),
      diag: new Float32Array(n),
      tInv: new Float32Array(n),
      tC: new Float32Array(n),
      x: new Float32Array(n),
      b: new Float32Array(n),
      r: new Float32Array(n),
    };
  }

  /**
   * Transfer weights for one direction: fine n → coarse nc (coarse cell I covers fine 2I, 2I+1 when coarsened).
   * Fine value = a0·X[p0] + a1·X[p1]. Beyond the extreme coarse centres the interpolation goes toward the boundary
   * ghost: Dirichlet (φ = 0 at the face) → linear to 0 at the face; Neumann → constant.
   */
  private static transfer(
    n: number,
    nc: number,
    dirLo: boolean,
    dirHi: boolean,
  ): { p0: Int32Array; p1: Int32Array; a0: Float64Array; a1: Float64Array; start: Int32Array; width: Int32Array } {
    const p0 = new Int32Array(n);
    const p1 = new Int32Array(n);
    const a0 = new Float64Array(n);
    const a1 = new Float64Array(n);
    const start = new Int32Array(nc);
    const width = new Int32Array(nc);
    const coarsened = nc < n;
    const cc = new Float64Array(nc);
    for (let I = 0; I < nc; I++) {
      start[I] = coarsened ? 2 * I : I;
      width[I] = coarsened ? Math.min(2, n - 2 * I) : 1;
      cc[I] = start[I]! + width[I]! / 2;
    }
    for (let i = 0; i < n; i++) {
      const xi = i + 0.5;
      if (xi <= cc[0]!) {
        p0[i] = 0;
        p1[i] = 0;
        a0[i] = dirLo ? xi / cc[0]! : 1;
        a1[i] = 0;
        continue;
      }
      if (xi >= cc[nc - 1]!) {
        p0[i] = nc - 1;
        p1[i] = nc - 1;
        a0[i] = dirHi ? (n - xi) / (n - cc[nc - 1]!) : 1;
        a1[i] = 0;
        continue;
      }
      let I = 0;
      while (I < nc - 2 && cc[I + 1]! < xi) I++;
      const w = (xi - cc[I]!) / (cc[I + 1]! - cc[I]!);
      p0[i] = I;
      p1[i] = I + 1;
      a0[i] = 1 - w;
      a1[i] = w;
    }
    return { p0, p1, a0, a1, start, width };
  }

  /** A side counts as Dirichlet for the transfer when at least half of its boundary faces carry a coefficient. */
  private static sideDirichlet(F: Level): { w: boolean; e: boolean; s: boolean; n: boolean } {
    const { nx, ny, nz } = F;
    const nx1 = nx + 1;
    let w = 0;
    let e = 0;
    let s = 0;
    let n = 0;
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        if (F.cx[(k * ny + j) * nx1]! > 0) w++;
        if (F.cx[(k * ny + j) * nx1 + nx]! > 0) e++;
      }
      for (let i = 0; i < nx; i++) {
        if (F.cy[(k * (ny + 1)) * nx + i]! > 0) s++;
        if (F.cy[(k * (ny + 1) + ny) * nx + i]! > 0) n++;
      }
    }
    return { w: 2 * w >= ny * nz, e: 2 * e >= ny * nz, s: 2 * s >= nx * nz, n: 2 * n >= nx * nz };
  }

  /** Rediscretise the 7-point operator on the coarse level (sum rules of the flux form, see file header). */
  private coarsen(F: Level, C: Level): void {
    const side = EllipticSolver.sideDirichlet(F);
    const tx = EllipticSolver.transfer(F.nx, C.nx, side.w, side.e);
    const ty = EllipticSolver.transfer(F.ny, C.ny, side.s, side.n);
    F.px0 = tx.p0;
    F.px1 = tx.p1;
    F.ax0 = tx.a0;
    F.ax1 = tx.a1;
    F.py0 = ty.p0;
    F.py1 = ty.p1;
    F.ay0 = ty.a0;
    F.ay1 = ty.a1;
    const nz = F.nz;
    const fnx1 = F.nx + 1;
    const cnx1 = C.nx + 1;
    // x-faces: coarse face IU sits at fine face start[IU] (or F.nx at the east edge).
    for (let k = 0; k < nz; k++) {
      for (let J = 0; J < C.ny; J++) {
        for (let IU = 0; IU <= C.nx; IU++) {
          const iu = IU < C.nx ? tx.start[IU]! : F.nx;
          let s = 0;
          for (let j = ty.start[J]!; j < ty.start[J]! + ty.width[J]!; j++) s += F.cx[(k * F.ny + j) * fnx1 + iu]!;
          let d: number;
          if (IU === 0) d = tx.width[0]!;
          else if (IU === C.nx) d = tx.width[C.nx - 1]!;
          else d = 0.5 * (tx.width[IU - 1]! + tx.width[IU]!);
          C.cx[(k * C.ny + J) * cnx1 + IU] = s / d;
        }
      }
      for (let JV = 0; JV <= C.ny; JV++) {
        const jv = JV < C.ny ? ty.start[JV]! : F.ny;
        for (let I = 0; I < C.nx; I++) {
          let s = 0;
          for (let i = tx.start[I]!; i < tx.start[I]! + tx.width[I]!; i++) s += F.cy[(k * (F.ny + 1) + jv) * F.nx + i]!;
          let d: number;
          if (JV === 0) d = ty.width[0]!;
          else if (JV === C.ny) d = ty.width[C.ny - 1]!;
          else d = 0.5 * (ty.width[JV - 1]! + ty.width[JV]!);
          C.cy[(k * (C.ny + 1) + JV) * C.nx + I] = s / d;
        }
      }
    }
    for (let m = 0; m <= nz; m++) {
      for (let J = 0; J < C.ny; J++) {
        for (let I = 0; I < C.nx; I++) {
          let s = 0;
          for (let j = ty.start[J]!; j < ty.start[J]! + ty.width[J]!; j++) {
            for (let i = tx.start[I]!; i < tx.start[I]! + tx.width[I]!; i++) s += F.cz[m * F.plane + j * F.nx + i]!;
          }
          C.cz[m * C.plane + J * C.nx + I] = s;
        }
      }
    }
  }

  /** Diagonal = sum of face coefficients; pre-factorise every z-line (Thomas). */
  private finishLevel(L: Level): void {
    const { nx, ny, nz, plane } = L;
    const nx1 = nx + 1;
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const c = j * nx + i;
          const fu = (k * ny + j) * nx1 + i;
          const fv = (k * (ny + 1) + j) * nx + i;
          L.diag[k * plane + c] = L.cx[fu]! + L.cx[fu + 1]! + L.cy[fv]! + L.cy[fv + nx]! + L.cz[k * plane + c]! + L.cz[(k + 1) * plane + c]!;
        }
      }
    }
    for (let c = 0; c < plane; c++) {
      let cPrev = 0;
      for (let k = 0; k < nz; k++) {
        const idx = k * plane + c;
        const a = k > 0 ? L.cz[k * plane + c]! : 0;
        const up = k < nz - 1 ? L.cz[(k + 1) * plane + c]! : 0;
        const den = L.diag[idx]! - a * cPrev;
        const inv = den > 0 ? 1 / den : 0;
        L.tInv[idx] = inv;
        cPrev = up * inv;
        L.tC[idx] = cPrev;
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Full (fine) operator
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Physical gradient G φ on every face (0 on inactive faces), written to gu/gv/gw (scratch, reused).
   */
  gradient(phi: Float64Array): { gu: Float64Array; gv: Float64Array; gw: Float64Array } {
    const g = this.g;
    const { nx, ny, nz, plane, dx } = g;
    const nx1 = nx + 1;
    const { activeU, activeV, topActive } = this.masks;
    const sx = this.sx;
    const sy = this.sy;
    const gu = this.gu;
    const gv = this.gv;
    const gw = this.gw;
    // ζ-differences times the metric slopes at every interior w-face; w-face gradients.
    for (let c = 0; c < plane; c++) {
      sx[c] = 0;
      sy[c] = 0;
      gw[c] = 0;
      sx[nz * plane + c] = 0;
      sy[nz * plane + c] = 0;
    }
    for (let m = 1; m < nz; m++) {
      const fz = this.fzeta[m]!;
      const dzw = g.dzetaW[m]!;
      const o = m * plane;
      const ob = (m - 1) * plane;
      for (let c = 0; c < plane; c++) {
        const d = phi[o + c]! - phi[ob + c]!;
        sx[o + c] = g.zsx[c]! * fz * d;
        sy[o + c] = g.zsy[c]! * fz * d;
        gw[o + c] = d / (g.J[c]! * dzw);
      }
    }
    {
      const o = nz * plane;
      const ob = (nz - 1) * plane;
      const dzw = g.dzetaW[nz]!;
      for (let c = 0; c < plane; c++) gw[o + c] = topActive ? -phi[ob + c]! / (g.J[c]! * dzw) : 0;
    }
    const inv2dx = 2 / dx;
    const invdx = 1 / dx;
    for (let k = 0; k < nz; k++) {
      const dzk = g.dzeta[k]!;
      const o = k * plane;
      const o1 = (k + 1) * plane;
      for (let j = 0; j < ny; j++) {
        const row = j * nx;
        const fr = (k * ny + j) * nx1;
        const jr = j * nx1;
        // west boundary
        {
          const f = fr;
          if (activeU[f]) {
            const cR = row;
            const cross = 0.25 * (sx[o + cR]! + sx[o1 + cR]!);
            gu[f] = phi[o + cR]! * inv2dx - cross / (g.Ju[jr]! * dzk * 0.5);
          } else gu[f] = 0;
        }
        for (let iu = 1; iu < nx; iu++) {
          const cL = row + iu - 1;
          const cR = cL + 1;
          const cross = 0.25 * (sx[o + cL]! + sx[o1 + cL]! + sx[o + cR]! + sx[o1 + cR]!);
          gu[fr + iu] = (phi[o + cR]! - phi[o + cL]!) * invdx - cross / (g.Ju[jr + iu]! * dzk);
        }
        {
          const f = fr + nx;
          if (activeU[f]) {
            const cL = row + nx - 1;
            const cross = 0.25 * (sx[o + cL]! + sx[o1 + cL]!);
            gu[f] = -phi[o + cL]! * inv2dx - cross / (g.Ju[jr + nx]! * dzk * 0.5);
          } else gu[f] = 0;
        }
      }
      for (let jv = 0; jv <= ny; jv++) {
        const fr = (k * (ny + 1) + jv) * nx;
        const jr = jv * nx;
        if (jv === 0 || jv === ny) {
          const cRow = jv === 0 ? 0 : (ny - 1) * nx;
          const sgn = jv === 0 ? 1 : -1;
          for (let i = 0; i < nx; i++) {
            const f = fr + i;
            if (!activeV[f]) {
              gv[f] = 0;
              continue;
            }
            const c = cRow + i;
            const cross = 0.25 * (sy[o + c]! + sy[o1 + c]!);
            gv[f] = sgn * phi[o + c]! * inv2dx - cross / (g.Jv[jr + i]! * dzk * 0.5);
          }
        } else {
          const rowS = (jv - 1) * nx;
          const rowN = jv * nx;
          for (let i = 0; i < nx; i++) {
            const cS = rowS + i;
            const cN = rowN + i;
            const cross = 0.25 * (sy[o + cS]! + sy[o1 + cS]! + sy[o + cN]! + sy[o1 + cN]!);
            gv[fr + i] = (phi[o + cN]! - phi[o + cS]!) * invdx - cross / (g.Jv[jr + i]! * dzk);
          }
        }
      }
    }
    return { gu, gv, gw };
  }

  /**
   * Volume-integrated divergence of a face field (u on u-faces, v on v-faces, w on w-faces; physical components).
   * W̃ = w − ū z_x − v̄ z_y on interior w-faces, 0 at the ground, w at the top. `scaleU`/`scaleW` multiply the
   * horizontal / vertical components (R_h, R_v for fluxes; 1 for velocities).
   */
  divergence(
    u: ArrayLike<number>,
    v: ArrayLike<number>,
    w: ArrayLike<number>,
    out: Float64Array,
    scaleU = 1,
    scaleW = 1,
  ): void {
    const g = this.g;
    const { nx, ny, nz, plane, dx } = g;
    const nx1 = nx + 1;
    const wt = this.wt;
    // W̃ per w-face.
    for (let c = 0; c < plane; c++) {
      wt[c] = 0;
      wt[nz * plane + c] = scaleW * w[nz * plane + c]!;
    }
    for (let m = 1; m < nz; m++) {
      const fz = this.fzeta[m]!;
      const kb = m - 1;
      const o = m * plane;
      for (let j = 0; j < ny; j++) {
        const ub = (kb * ny + j) * nx1;
        const ua = (m * ny + j) * nx1;
        const vb = (kb * (ny + 1) + j) * nx;
        const va = (m * (ny + 1) + j) * nx;
        for (let i = 0; i < nx; i++) {
          const c = j * nx + i;
          const uS = u[ub + i]! + u[ub + i + 1]! + u[ua + i]! + u[ua + i + 1]!;
          const vS = v[vb + i]! + v[vb + i + nx]! + v[va + i]! + v[va + i + nx]!;
          wt[o + c] = scaleW * w[o + c]! - 0.25 * scaleU * fz * (g.zsx[c]! * uS + g.zsy[c]! * vS);
        }
      }
    }
    const area = dx * dx;
    for (let k = 0; k < nz; k++) {
      const dzk = g.dzeta[k]!;
      const hx = dx * dzk * scaleU;
      const o = k * plane;
      const o1 = (k + 1) * plane;
      for (let j = 0; j < ny; j++) {
        const fu = (k * ny + j) * nx1;
        const ju = j * nx1;
        const fv = (k * (ny + 1) + j) * nx;
        const jv = j * nx;
        for (let i = 0; i < nx; i++) {
          const c = j * nx + i;
          out[o + c] =
            hx * (g.Ju[ju + i + 1]! * u[fu + i + 1]! - g.Ju[ju + i]! * u[fu + i]!) +
            hx * (g.Jv[jv + i + nx]! * v[fv + i + nx]! - g.Jv[jv + i]! * v[fv + i]!) +
            area * (wt[o1 + c]! - wt[o + c]!);
        }
      }
    }
  }

  /** A φ = −D(R G φ). */
  applyFull(phi: Float64Array, out: Float64Array): void {
    const { gu, gv, gw } = this.gradient(phi);
    this.divergence(gu, gv, gw, out, this.Rh, this.Rv);
    for (let q = 0; q < out.length; q++) out[q] = -out[q]!;
  }

  /** u += scale·R·Gφ on active faces (w at interior faces and the active top). */
  correct(phi: Float64Array, u: Float32Array, v: Float32Array, w: Float32Array, scale = 1): void {
    const { gu, gv, gw } = this.gradient(phi);
    const sh = scale * this.Rh;
    const sv = scale * this.Rv;
    for (let f = 0; f < u.length; f++) u[f] = u[f]! + sh * gu[f]!;
    for (let f = 0; f < v.length; f++) v[f] = v[f]! + sh * gv[f]!;
    const plane = this.g.plane;
    for (let f = plane; f < w.length; f++) w[f] = w[f]! + sv * gw[f]!;
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Multigrid on A₇
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Zebra z-line Gauss–Seidel sweeps; `reverse` swaps the colour order (symmetric V-cycle). Each line is solved with
   * its pre-factorised Thomas coefficients (tInv, tC); the neighbours of a colour belong to the other colour.
   */
  private relax(L: Level, sweeps: number, reverse: boolean): void {
    const { nx, ny, nz, plane, cx, cy, cz, b, x, tInv, tC } = L;
    const nx1 = nx + 1;
    const tmp = this.tmpCol;
    const strideU = ny * nx1;
    const strideV = (ny + 1) * nx;
    for (let s = 0; s < sweeps; s++) {
      for (let pass = 0; pass < 2; pass++) {
        const colour = reverse ? 1 - pass : pass;
        for (let j = 0; j < ny; j++) {
          const hasS = j > 0;
          const hasN = j < ny - 1;
          for (let i = (j + colour) & 1; i < nx; i += 2) {
            const c = j * nx + i;
            const hasW = i > 0;
            const hasE = i < nx - 1;
            let fu = j * nx1 + i;
            let fv = j * nx + i;
            let idx = c;
            let rp = 0;
            for (let k = 0; k < nz; k++) {
              let rhs = b[idx]!;
              if (hasW) rhs += cx[fu]! * x[idx - 1]!;
              if (hasE) rhs += cx[fu + 1]! * x[idx + 1]!;
              if (hasS) rhs += cy[fv]! * x[idx - nx]!;
              if (hasN) rhs += cy[fv + nx]! * x[idx + nx]!;
              if (k > 0) rhs += cz[idx]! * rp;
              rp = rhs * tInv[idx]!;
              tmp[k] = rp;
              idx += plane;
              fu += strideU;
              fv += strideV;
            }
            idx -= plane;
            let xv = tmp[nz - 1]!;
            x[idx] = xv;
            for (let k = nz - 2; k >= 0; k--) {
              idx -= plane;
              xv = tmp[k]! + tC[idx]! * xv;
              x[idx] = xv;
            }
          }
        }
      }
    }
  }

  /** r = b − A₇x on a level. */
  private residual7(L: Level): void {
    const { nx, ny, nz, plane, cx, cy, cz, b, x, diag, r } = L;
    const nx1 = nx + 1;
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const c = j * nx + i;
          const idx = k * plane + c;
          const fu = (k * ny + j) * nx1 + i;
          const fv = (k * (ny + 1) + j) * nx + i;
          let s = b[idx]! - diag[idx]! * x[idx]!;
          if (i > 0) s += cx[fu]! * x[idx - 1]!;
          if (i < nx - 1) s += cx[fu + 1]! * x[idx + 1]!;
          if (j > 0) s += cy[fv]! * x[idx - nx]!;
          if (j < ny - 1) s += cy[fv + nx]! * x[idx + nx]!;
          if (k > 0) s += cz[idx]! * x[idx - plane]!;
          if (k < nz - 1) s += cz[idx + plane]! * x[idx + plane]!;
          r[idx] = s;
        }
      }
    }
  }

  private restrict(F: Level, C: Level): void {
    const cb = C.b;
    cb.fill(0);
    const { nx, ny, nz, plane, r } = F;
    const px0 = F.px0!;
    const px1 = F.px1!;
    const ax0 = F.ax0!;
    const ax1 = F.ax1!;
    const py0 = F.py0!;
    const py1 = F.py1!;
    const ay0 = F.ay0!;
    const ay1 = F.ay1!;
    const cnx = C.nx;
    for (let k = 0; k < nz; k++) {
      const oc = k * C.plane;
      for (let j = 0; j < ny; j++) {
        const J0 = oc + py0[j]! * cnx;
        const J1 = oc + py1[j]! * cnx;
        const b0 = ay0[j]!;
        const b1 = ay1[j]!;
        const row = k * plane + j * nx;
        for (let i = 0; i < nx; i++) {
          const v = r[row + i]!;
          if (v === 0) continue;
          const w0 = ax0[i]! * v;
          const w1 = ax1[i]! * v;
          const I0 = px0[i]!;
          const I1 = px1[i]!;
          cb[J0 + I0] += w0 * b0;
          cb[J0 + I1] += w1 * b0;
          cb[J1 + I0] += w0 * b1;
          cb[J1 + I1] += w1 * b1;
        }
      }
    }
  }

  private prolongAdd(F: Level, C: Level): void {
    const { nx, ny, nz, plane, x } = F;
    const px0 = F.px0!;
    const px1 = F.px1!;
    const ax0 = F.ax0!;
    const ax1 = F.ax1!;
    const py0 = F.py0!;
    const py1 = F.py1!;
    const ay0 = F.ay0!;
    const ay1 = F.ay1!;
    const cnx = C.nx;
    const cx = C.x;
    for (let k = 0; k < nz; k++) {
      const oc = k * C.plane;
      for (let j = 0; j < ny; j++) {
        const J0 = oc + py0[j]! * cnx;
        const J1 = oc + py1[j]! * cnx;
        const b0 = ay0[j]!;
        const b1 = ay1[j]!;
        const row = k * plane + j * nx;
        for (let i = 0; i < nx; i++) {
          const I0 = px0[i]!;
          const I1 = px1[i]!;
          const a0 = ax0[i]!;
          const a1 = ax1[i]!;
          x[row + i] += b0 * (a0 * cx[J0 + I0]! + a1 * cx[J0 + I1]!) + b1 * (a0 * cx[J1 + I0]! + a1 * cx[J1 + I1]!);
        }
      }
    }
  }

  private vcycle(l: number, nu1: number, nu2: number, symmetric: boolean): void {
    const L = this.levels[l]!;
    if (l === this.levels.length - 1) {
      if (this.singular) removeMean(L.b);
      this.relax(L, COARSE_SWEEPS, false);
      this.relax(L, COARSE_SWEEPS, true);
      return;
    }
    this.relax(L, nu1, false);
    this.residual7(L);
    const C = this.levels[l + 1]!;
    this.restrict(L, C);
    C.x.fill(0);
    this.vcycle(l + 1, nu1, nu2, symmetric);
    this.prolongAdd(L, C);
    // Same colour order after the correction converges ≈ 3× faster per cycle than the reversed (symmetric) order
    // (measured 0.10 vs 0.15); PCG needs the symmetric form.
    this.relax(L, nu2, symmetric);
  }

  /** Preconditioner: z ≈ A₇⁻¹ r by one V(2,2) from zero (symmetric colour order for PCG). */
  precondition(r: Float64Array, z: Float64Array, symmetric = false): void {
    const L0 = this.levels[0]!;
    L0.b.set(r);
    if (this.singular) removeMean(L0.b);
    L0.x.fill(0);
    this.vcycle(0, 2, 2, symmetric);
    z.set(L0.x);
  }

  /**
   * Solve A φ = rhs (φ holds the warm start). Defect correction (full residual, V-cycle on A₇) for at least
   * `minIter` and at most `maxIter` cycles, stopping at ‖r‖ ≤ tol·‖rhs‖; if the measured reduction per cycle is worse
   * than ATMOS_PARAMS.mgSlowRate and `allowPcg`, continue with V-cycle-preconditioned CG.
   */
  solve(
    phi: Float64Array,
    rhs: Float64Array,
    opts: { tol: number; minIter?: number; maxIter: number; allowPcg?: boolean; checkLast?: boolean },
  ): SolveResult {
    const n = this.g.n;
    if (this.singular) removeMean(rhs);
    const nb = norm2(rhs);
    if (!(nb > 0)) {
      phi.fill(0);
      return { iterations: 0, relResidual: 0, rate: 0, method: 'none' };
    }
    const r = this.pr;
    const z = this.pz;
    const minIter = opts.minIter ?? 1;
    let it = 0;
    let prev = NaN;
    let rel = NaN;
    let rate = 0;
    let first = NaN;
    for (;;) {
      this.applyFull(phi, r);
      for (let q = 0; q < n; q++) r[q] = rhs[q]! - r[q]!;
      if (this.singular) removeMean(r);
      rel = norm2(r) / nb;
      if (it === 0) first = rel;
      if (it > 0) rate = (rel / first) ** (1 / it);
      if ((rel <= opts.tol && it >= minIter) || it >= opts.maxIter) break;
      if (opts.allowPcg && it >= 2 && rel / prev > ATMOS_PARAMS.mgSlowRate) {
        return this.pcg(phi, rhs, nb, opts.tol, opts.maxIter - it, it, first);
      }
      prev = rel;
      this.precondition(r, z);
      for (let q = 0; q < n; q++) phi[q] = phi[q]! + z[q]!;
      it++;
      if (it >= opts.maxIter && !opts.checkLast) {
        rel = NaN;
        break;
      }
    }
    if (this.singular) removeMean(phi);
    return { iterations: it, relResidual: rel, rate, method: 'dc' };
  }

  private pcg(phi: Float64Array, rhs: Float64Array, nb: number, tol: number, maxIter: number, it0: number, first: number): SolveResult {
    const n = this.g.n;
    const r = this.pr;
    const z = this.pz;
    const p = this.pp;
    const Ap = this.pAp;
    this.applyFull(phi, r);
    for (let q = 0; q < n; q++) r[q] = rhs[q]! - r[q]!;
    if (this.singular) removeMean(r);
    this.precondition(r, z, true);
    p.set(z);
    let rz = dot(r, z);
    let rel = norm2(r) / nb;
    let it = 0;
    while (it < maxIter && rel > tol) {
      this.applyFull(p, Ap);
      const pAp = dot(p, Ap);
      if (!(pAp > 0)) break;
      const alpha = rz / pAp;
      for (let q = 0; q < n; q++) {
        phi[q] = phi[q]! + alpha * p[q]!;
        r[q] = r[q]! - alpha * Ap[q]!;
      }
      if (this.singular) removeMean(r);
      rel = norm2(r) / nb;
      it++;
      if (rel <= tol) break;
      this.precondition(r, z, true);
      const rz2 = dot(r, z);
      const beta = rz2 / rz;
      rz = rz2;
      for (let q = 0; q < n; q++) p[q] = z[q]! + beta * p[q]!;
    }
    if (this.singular) removeMean(phi);
    const total = it0 + it;
    return { iterations: total, relResidual: rel, rate: total > 0 ? (rel / first) ** (1 / total) : 0, method: 'pcg' };
  }

  /** Number of multigrid levels (for tests/diagnostics). */
  get levelCount(): number {
    return this.levels.length;
  }
}

/** Symmetric sweep pairs on the coarsest level (≤ 8×8 columns). */
const COARSE_SWEEPS = 10;

function norm2(a: Float64Array): number {
  let s = 0;
  for (let q = 0; q < a.length; q++) s += a[q]! * a[q]!;
  return Math.sqrt(s);
}

function dot(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let q = 0; q < a.length; q++) s += a[q]! * b[q]!;
  return s;
}

function removeMean(a: Float64Array | Float32Array): void {
  let s = 0;
  for (let q = 0; q < a.length; q++) s += a[q]!;
  const m = s / a.length;
  for (let q = 0; q < a.length; q++) a[q] = a[q]! - m;
}
