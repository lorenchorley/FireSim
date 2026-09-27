/**
 * Pyrogenic potential for the fast tier (spec §8.8; D32) [H, UNVERIFIED Hilton constant, §16 item 13].
 *
 * On the fire grid coarsened ×2: −∇²ψ = k·q (q = fire heat flux kW/m², ψ = 0 on the boundary), u_p = ∇ψ,
 * |u_p| ≤ 5 m/s. An infinite strip of intensity I kW/m induces k·I/2 m/s each side (3 m/s at 10 MW/m, k = 6e-4).
 * Solved exactly with a separable discrete sine transform (cell-centred Dirichlet eigenbasis sin(πp(i + ½)/n)),
 * O(n³) per solve with precomputed tables (≈ 4 ms at 100², every 60 s of simulated time).
 */
import type { GridSpec } from '../core/grid';
import { ATMOS_PARAMS } from './params';

class Dst {
  readonly n: number;
  /** S[p·n + i] = sin(π(p + 1)(i + ½)/n), p = 0…n−1. */
  readonly S: Float64Array;
  /** 1 / norm² of each basis vector. */
  readonly invNorm: Float64Array;
  /** Eigenvalue factor 4 sin²(π(p + 1)/(2n)). */
  readonly lam: Float64Array;
  constructor(n: number) {
    this.n = n;
    this.S = new Float64Array(n * n);
    this.invNorm = new Float64Array(n);
    this.lam = new Float64Array(n);
    for (let p = 0; p < n; p++) {
      for (let i = 0; i < n; i++) this.S[p * n + i] = Math.sin((Math.PI * (p + 1) * (i + 0.5)) / n);
      this.invNorm[p] = p === n - 1 ? 1 / n : 2 / n;
      this.lam[p] = 4 * Math.sin((Math.PI * (p + 1)) / (2 * n)) ** 2;
    }
  }
}

export class PyrogenicPotential {
  readonly fire: GridSpec;
  readonly nx: number;
  readonly ny: number;
  readonly h: number;
  private dx: Dst;
  private dy: Dst;
  /** Potential ψ (m²/s) on the coarse grid and u_p on the fire grid. */
  readonly psi: Float64Array;
  readonly up: Float32Array;
  readonly vp: Float32Array;
  private tmp: Float64Array;
  private q: Float64Array;

  constructor(fire: GridSpec) {
    this.fire = fire;
    this.nx = Math.ceil(fire.nx / 2);
    this.ny = Math.ceil(fire.ny / 2);
    this.h = 2 * fire.cellSize;
    this.dx = new Dst(this.nx);
    this.dy = this.ny === this.nx ? this.dx : new Dst(this.ny);
    this.psi = new Float64Array(this.nx * this.ny);
    this.tmp = new Float64Array(this.nx * this.ny);
    this.q = new Float64Array(this.nx * this.ny);
    this.up = new Float32Array(fire.nx * fire.ny);
    this.vp = new Float32Array(fire.nx * fire.ny);
  }

  /** Solve for the heat-flux field q (kW/m², fire grid) and refresh u_p on the fire grid. */
  solve(qFire: Float32Array): void {
    const { nx, ny, h } = this;
    const fg = this.fire;
    const k = ATMOS_PARAMS.pyroK;
    const q = this.q;
    q.fill(0);
    let any = false;
    for (let j = 0; j < fg.ny; j++) {
      for (let i = 0; i < fg.nx; i++) {
        const v = qFire[j * fg.nx + i]!;
        if (v > 0) {
          q[(j >> 1) * nx + (i >> 1)]! += v;
          any = true;
        }
      }
    }
    if (!any) {
      this.psi.fill(0);
      this.up.fill(0);
      this.vp.fill(0);
      return;
    }
    // Mean over the (≤ 4) fire cells of each coarse cell, times k.
    for (let J = 0; J < ny; J++) {
      const cy = Math.min(2, fg.ny - 2 * J);
      for (let I = 0; I < nx; I++) {
        const cx = Math.min(2, fg.nx - 2 * I);
        q[J * nx + I] = (k * q[J * nx + I]!) / (cx * cy);
      }
    }
    // Forward DST in x (rows), then y.
    const Sx = this.dx.S;
    const Sy = this.dy.S;
    const t = this.tmp;
    for (let J = 0; J < ny; J++) {
      const r = J * nx;
      for (let p = 0; p < nx; p++) {
        let s = 0;
        const o = p * nx;
        for (let i = 0; i < nx; i++) s += q[r + i]! * Sx[o + i]!;
        t[r + p] = s * this.dx.invNorm[p]!;
      }
    }
    const psi = this.psi;
    for (let p = 0; p < nx; p++) {
      for (let qy = 0; qy < ny; qy++) {
        let s = 0;
        const o = qy * ny;
        for (let J = 0; J < ny; J++) s += t[J * nx + p]! * Sy[o + J]!;
        // Divide by the eigenvalue of −∇² (1/h² scaling).
        psi[qy * nx + p] = (s * this.dy.invNorm[qy]! * h * h) / (this.dx.lam[p]! + this.dy.lam[qy]!);
      }
    }
    // Inverse: y then x.
    for (let p = 0; p < nx; p++) {
      for (let J = 0; J < ny; J++) {
        let s = 0;
        for (let qy = 0; qy < ny; qy++) s += psi[qy * nx + p]! * Sy[qy * ny + J]!;
        t[J * nx + p] = s;
      }
    }
    for (let J = 0; J < ny; J++) {
      const r = J * nx;
      for (let i = 0; i < nx; i++) {
        let s = 0;
        for (let p = 0; p < nx; p++) s += t[r + p]! * Sx[p * nx + i]!;
        psi[r + i] = s;
      }
    }
    this.gradientToFire();
  }

  /** u_p = ∇ψ (central differences, ghost −ψ beyond the boundary), bilinear to the fire grid, capped. */
  private gradientToFire(): void {
    const { nx, ny, h, psi } = this;
    const fg = this.fire;
    const gx = new Float64Array(nx * ny);
    const gy = new Float64Array(nx * ny);
    for (let J = 0; J < ny; J++) {
      for (let I = 0; I < nx; I++) {
        const c = J * nx + I;
        const w = I > 0 ? psi[c - 1]! : -psi[c]!;
        const e = I < nx - 1 ? psi[c + 1]! : -psi[c]!;
        const s = J > 0 ? psi[c - nx]! : -psi[c]!;
        const n = J < ny - 1 ? psi[c + nx]! : -psi[c]!;
        gx[c] = (e - w) / (2 * h);
        gy[c] = (n - s) / (2 * h);
      }
    }
    const cap = ATMOS_PARAMS.pyroMax;
    for (let j = 0; j < fg.ny; j++) {
      // Fire cell centre in coarse index space: (j + 0.5)/2 − 0.5.
      const fy = Math.min(Math.max((j + 0.5) / 2 - 0.5, 0), ny - 1);
      const J0 = Math.min(Math.floor(fy), Math.max(0, ny - 2));
      const ty = fy - J0;
      for (let i = 0; i < fg.nx; i++) {
        const fx = Math.min(Math.max((i + 0.5) / 2 - 0.5, 0), nx - 1);
        const I0 = Math.min(Math.floor(fx), Math.max(0, nx - 2));
        const tx = fx - I0;
        const c = J0 * nx + I0;
        const c1 = nx > 1 ? c + 1 : c;
        const c2 = ny > 1 ? c + nx : c;
        const c3 = nx > 1 && ny > 1 ? c + nx + 1 : c;
        let u = (gx[c]! * (1 - tx) + gx[c1]! * tx) * (1 - ty) + (gx[c2]! * (1 - tx) + gx[c3]! * tx) * ty;
        let v = (gy[c]! * (1 - tx) + gy[c1]! * tx) * (1 - ty) + (gy[c2]! * (1 - tx) + gy[c3]! * tx) * ty;
        const sp = Math.hypot(u, v);
        if (sp > cap) {
          u *= cap / sp;
          v *= cap / sp;
        }
        const k = j * fg.nx + i;
        this.up[k] = u;
        this.vp[k] = v;
      }
    }
  }
}
