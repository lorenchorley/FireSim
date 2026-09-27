/**
 * 3-D dynamics kernels for the standard/high tiers (spec §8.4; doc 07 §7.1–7.3): semi-Lagrangian advection on the
 * MAC grid (RK2 midpoint back-trace in (x, y, ζ) index space with (u, v, ω), trilinear), Smagorinsky eddy
 * viscosity with the stability correction [V WRF], explicit horizontal and implicit vertical diffusion.
 * Module-level functions over typed arrays (no allocation in the loops) so V8 optimises them as hot kernels.
 */
import type { AtmosGrid } from './grid';
import { ATMOS_PARAMS } from './params';

/**
 * Cell-centred velocities: physical (uc, vc, wc) and, when given, index-space rates (Ui, Vi, Wi in cells per
 * second) with Wi = ω/Δζ_k, ω = (w − u·z_x|ζ − v·z_y|ζ)/J. `stats` (optional) receives max(|uc|, |vc|) and max|wc|
 * (physical w, as the §8.4 Δt_a rule uses).
 */
export function collocate(
  g: AtmosGrid,
  u: Float32Array,
  v: Float32Array,
  w: Float32Array,
  uc: Float32Array,
  vc: Float32Array,
  wc: Float32Array,
  Ui: Float32Array | null,
  Vi: Float32Array | null,
  Wi: Float32Array | null,
  stats: Float64Array | null = null,
): void {
  const { nx, ny, nz, plane, dx } = g;
  const nx1 = nx + 1;
  const invdx = 1 / dx;
  let mh = 0;
  let mv = 0;
  for (let k = 0; k < nz; k++) {
    const fz = 1 - g.zetaC[k]! / g.Hp;
    const idz = 1 / g.dzeta[k]!;
    for (let j = 0; j < ny; j++) {
      const fu = (k * ny + j) * nx1;
      const fv = (k * (ny + 1) + j) * nx;
      const o = k * plane + j * nx;
      const col = j * nx;
      for (let i = 0; i < nx; i++) {
        const a = 0.5 * (u[fu + i]! + u[fu + i + 1]!);
        const b = 0.5 * (v[fv + i]! + v[fv + i + nx]!);
        const c = 0.5 * (w[o + i]! + w[o + plane + i]!);
        uc[o + i] = a;
        vc[o + i] = b;
        wc[o + i] = c;
        if (Ui) {
          const cc = col + i;
          const om = (c - fz * (a * g.zsx[cc]! + b * g.zsy[cc]!)) / g.J[cc]!;
          Ui[o + i] = a * invdx;
          Vi![o + i] = b * invdx;
          Wi![o + i] = om * idz;
        }
        if (stats) {
          const h = a > 0 ? a : -a;
          const hb = b > 0 ? b : -b;
          const vv = c > 0 ? c : -c;
          if (h > mh) mh = h;
          if (hb > mh) mh = hb;
          if (vv > mv) mv = vv;
        }
      }
    }
  }
  if (stats) {
    stats[0] = mh;
    stats[1] = mv;
  }
}

/**
 * RK2-midpoint back-trace displacement (in index units) of every cell centre:
 * D = Δt·U(x − ½Δt·U(x)), U = (u/Δx, v/Δy, ω/Δζ) trilinear in centre-index space (clamped).
 */
export function displacements(g: AtmosGrid, Ui: Float32Array, Vi: Float32Array, Wi: Float32Array, dt: number, Dx: Float32Array, Dy: Float32Array, Dz: Float32Array): void {
  const { nx, ny, nz, plane } = g;
  const nxm = nx - 1;
  const nym = ny - 1;
  const nzm = nz - 1;
  const nxm2 = nx - 2;
  const nym2 = ny - 2;
  const nzm2 = nz - 2;
  const hdt = 0.5 * dt;
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      const row = k * plane + j * nx;
      for (let i = 0; i < nx; i++) {
        const o = row + i;
        const xm = i - hdt * Ui[o]!;
        const ym = j - hdt * Vi[o]!;
        const zm = k - hdt * Wi[o]!;
        const fx = xm < 0 ? 0 : xm > nxm ? nxm : xm;
        const fy = ym < 0 ? 0 : ym > nym ? nym : ym;
        const fz = zm < 0 ? 0 : zm > nzm ? nzm : zm;
        let i0 = fx | 0;
        if (i0 > nxm2) i0 = nxm2;
        let j0 = fy | 0;
        if (j0 > nym2) j0 = nym2;
        let k0 = fz | 0;
        if (k0 > nzm2) k0 = nzm2;
        const tx = fx - i0;
        const ty = fy - j0;
        const tz = fz - k0;
        const q = k0 * plane + j0 * nx + i0;
        const a = q + 1;
        const b = q + nx;
        const c = b + 1;
        const d = q + plane;
        const e = d + 1;
        const f = d + nx;
        const h = f + 1;
        const sx = 1 - tx;
        const sy = 1 - ty;
        const sz = 1 - tz;
        const w00 = sx * sy;
        const w10 = tx * sy;
        const w01 = sx * ty;
        const w11 = tx * ty;
        const vx = sz * (w00 * Ui[q]! + w10 * Ui[a]! + w01 * Ui[b]! + w11 * Ui[c]!) + tz * (w00 * Ui[d]! + w10 * Ui[e]! + w01 * Ui[f]! + w11 * Ui[h]!);
        const vy = sz * (w00 * Vi[q]! + w10 * Vi[a]! + w01 * Vi[b]! + w11 * Vi[c]!) + tz * (w00 * Vi[d]! + w10 * Vi[e]! + w01 * Vi[f]! + w11 * Vi[h]!);
        const vz = sz * (w00 * Wi[q]! + w10 * Wi[a]! + w01 * Wi[b]! + w11 * Wi[c]!) + tz * (w00 * Wi[d]! + w10 * Wi[e]! + w01 * Wi[f]! + w11 * Wi[h]!);
        Dx[o] = dt * vx;
        Dy[o] = dt * vy;
        Dz[o] = dt * vz;
      }
    }
  }
}

/**
 * Semi-Lagrangian advection (spec §8.4 step 1) of a field on a staggered grid (nxF, nyF, nzF) whose point
 * (iF, jF, kF) sits at centre-index position (iF − ox, jF − oy, kF − oz). The departure displacement of a face is
 * the mean of the RK2 displacements of the two centres it separates (second-order in space); the value is
 * trilinear in the field's own index space, clamped (zero-gradient inflow, ground, lid). An optional second field
 * on the same grid shares the departure points (θ′ and smoke).
 */
export function advect(
  g: AtmosGrid,
  Dx: Float32Array,
  Dy: Float32Array,
  Dz: Float32Array,
  src: Float32Array,
  dst: Float32Array,
  nxF: number,
  nyF: number,
  nzF: number,
  ox: number,
  oy: number,
  oz: number,
  src2: Float32Array | null = null,
  dst2: Float32Array | null = null,
): void {
  const { nx, ny, nz, plane } = g;
  const planeF = nxF * nyF;
  const xFmax = nxF - 1;
  const yFmax = nyF - 1;
  const zFmax = nzF - 1;
  const xF2 = nxF - 2;
  const yF2 = nyF - 2;
  const zF2 = nzF - 2;
  const sxo = ox > 0 ? 1 : 0;
  const syo = oy > 0 ? 1 : 0;
  const szo = oz > 0 ? 1 : 0;
  for (let kF = 0; kF < nzF; kF++) {
    const z = kF - oz;
    const k1 = kF < nz ? kF : nz - 1;
    const k0 = kF - szo < 0 ? 0 : kF - szo > nz - 1 ? nz - 1 : kF - szo;
    for (let jF = 0; jF < nyF; jF++) {
      const y = jF - oy;
      const j1 = jF < ny ? jF : ny - 1;
      const j0 = jF - syo < 0 ? 0 : jF - syo > ny - 1 ? ny - 1 : jF - syo;
      const rowF = kF * planeF + jF * nxF;
      const r0 = k0 * plane + j0 * nx;
      const r1 = k1 * plane + j1 * nx;
      for (let iF = 0; iF < nxF; iF++) {
        const i1 = iF < nx ? iF : nx - 1;
        const i0 = iF - sxo < 0 ? 0 : iF - sxo > nx - 1 ? nx - 1 : iF - sxo;
        const c0 = r0 + i0;
        const c1 = r1 + i1;
        let xd = iF - 0.5 * (Dx[c0]! + Dx[c1]!);
        let yd = y + oy - 0.5 * (Dy[c0]! + Dy[c1]!);
        let zd = z + oz - 0.5 * (Dz[c0]! + Dz[c1]!);
        xd = xd < 0 ? 0 : xd > xFmax ? xFmax : xd;
        yd = yd < 0 ? 0 : yd > yFmax ? yFmax : yd;
        zd = zd < 0 ? 0 : zd > zFmax ? zFmax : zd;
        let I = xd | 0;
        if (I > xF2) I = xF2;
        let J = yd | 0;
        if (J > yF2) J = yF2;
        let K = zd | 0;
        if (K > zF2) K = zF2;
        const tx = xd - I;
        const ty = yd - J;
        const tz = zd - K;
        const q = K * planeF + J * nxF + I;
        const a = q + 1;
        const b = q + nxF;
        const c = b + 1;
        const d = q + planeF;
        const e = d + 1;
        const f = d + nxF;
        const h = f + 1;
        const sx = 1 - tx;
        const sy = 1 - ty;
        const sz = 1 - tz;
        const w00 = sx * sy;
        const w10 = tx * sy;
        const w01 = sx * ty;
        const w11 = tx * ty;
        dst[rowF + iF] = sz * (w00 * src[q]! + w10 * src[a]! + w01 * src[b]! + w11 * src[c]!) + tz * (w00 * src[d]! + w10 * src[e]! + w01 * src[f]! + w11 * src[h]!);
        if (src2) dst2![rowF + iF] = sz * (w00 * src2[q]! + w10 * src2[a]! + w01 * src2[b]! + w11 * src2[c]!) + tz * (w00 * src2[d]! + w10 * src2[e]! + w01 * src2[f]! + w11 * src2[h]!);
      }
    }
  }
}

/**
 * Smagorinsky eddy coefficients at cell centres [V WRF module_diffusion_em]:
 * K_m = (c_s ℓ)²·√max(0, D² − N²/Pr), K_h = K_m/Pr, both ≤ 0.1ℓ²/Δt; ℓ_h = Δx, ℓ_v = Δz = J·Δζ_k.
 * N² = (g/θ_env)(dθ_env/dz + ∂θ′/∂z). Horizontal K_h for θ′ is limited on steep ζ-surfaces (doc 07 §7.3 [H]).
 */
export function smagorinsky(
  g: AtmosGrid,
  dt: number,
  u: Float32Array,
  v: Float32Array,
  w: Float32Array,
  uc: Float32Array,
  vc: Float32Array,
  wc: Float32Array,
  th: Float32Array,
  gth: Float32Array,
  dth: Float32Array,
  slopeLim: Float32Array,
  kmh: Float32Array,
  kmv: Float32Array,
  khh: Float32Array,
  khv: Float32Array,
): void {
  const P = ATMOS_PARAMS;
  const { nx, ny, nz, plane, dx } = g;
  const nx1 = nx + 1;
  const cs2h = (P.smagCs * dx) ** 2;
  const limH = (P.smagLimit * dx * dx) / dt;
  const invPr = 1 / P.prandtl;
  const invdx = 1 / dx;
  for (let k = 0; k < nz; k++) {
    const kd = k > 0 ? k - 1 : k;
    const ku = k < nz - 1 ? k + 1 : k;
    for (let j = 0; j < ny; j++) {
      const jd = j > 0 ? j - 1 : j;
      const ju = j < ny - 1 ? j + 1 : j;
      const fu = (k * ny + j) * nx1;
      const fv = (k * (ny + 1) + j) * nx;
      for (let i = 0; i < nx; i++) {
        const col = j * nx + i;
        const o = k * plane + col;
        const J = g.J[col]!;
        const dz = J * g.dzeta[k]!;
        const id = i > 0 ? i - 1 : i;
        const iu = i < nx - 1 ? i + 1 : i;
        const hxs = invdx / Math.max(1, iu - id);
        const hys = invdx / Math.max(1, ju - jd);
        const dzs = 1 / (J * Math.max(1e-6, g.zetaC[ku]! - g.zetaC[kd]!));
        const ux = (u[fu + i + 1]! - u[fu + i]!) * invdx;
        const vy = (v[fv + i + nx]! - v[fv + i]!) * invdx;
        const wz = (w[o + plane]! - w[o]!) / dz;
        const rj = k * plane;
        const uy = (uc[rj + ju * nx + i]! - uc[rj + jd * nx + i]!) * hys;
        const vx = (vc[rj + j * nx + iu]! - vc[rj + j * nx + id]!) * hxs;
        const uz = (uc[ku * plane + col]! - uc[kd * plane + col]!) * dzs;
        const vz = (vc[ku * plane + col]! - vc[kd * plane + col]!) * dzs;
        const wx = (wc[rj + j * nx + iu]! - wc[rj + j * nx + id]!) * hxs;
        const wy = (wc[rj + ju * nx + i]! - wc[rj + jd * nx + i]!) * hys;
        const d2 = 2 * (ux * ux + vy * vy + wz * wz) + (uy + vx) ** 2 + (uz + wx) ** 2 + (vz + wy) ** 2;
        const n2 = gth[o]! * (dth[o]! + (th[ku * plane + col]! - th[kd * plane + col]!) * dzs);
        const s = d2 - n2 * invPr;
        const r = s > 0 ? Math.sqrt(s) : 0;
        const limV = (P.smagLimit * dz * dz) / dt;
        const cs2v = (P.smagCs * dz) ** 2;
        let a = cs2h * r;
        kmh[o] = a > limH ? limH : a;
        a = cs2v * r;
        kmv[o] = a > limV ? limV : a;
        a = kmh[o]! * invPr;
        khh[o] = (a > limH ? limH : a) * slopeLim[o]!;
        a = kmv[o]! * invPr;
        khv[o] = a > limV ? limV : a;
      }
    }
  }
}

/**
 * Explicit horizontal diffusion along ζ-surfaces of a staggered field: dst = src + Δt·K̄·∇²_h src (5-point,
 * zero-gradient at the edges). K is taken from the centre array `K`, averaged onto the field points (ox/oy = ½:
 * average of the two neighbouring centres).
 */
export function diffuseH(
  g: AtmosGrid,
  dt: number,
  K: Float32Array,
  src: Float32Array,
  dst: Float32Array,
  nxF: number,
  nyF: number,
  nzF: number,
  ox: number,
  oy: number,
  oz: number,
): void {
  const { nx, ny, nz, plane, dx } = g;
  const planeF = nxF * nyF;
  const c = dt / (dx * dx);
  for (let kF = 0; kF < nzF; kF++) {
    const kc0 = Math.min(nz - 1, Math.max(0, kF - (oz > 0 ? 1 : 0)));
    const kc1 = Math.min(nz - 1, kF);
    for (let jF = 0; jF < nyF; jF++) {
      const jc0 = Math.min(ny - 1, Math.max(0, jF - (oy > 0 ? 1 : 0)));
      const jc1 = Math.min(ny - 1, jF);
      const row = kF * planeF + jF * nxF;
      for (let iF = 0; iF < nxF; iF++) {
        const ic0 = Math.min(nx - 1, Math.max(0, iF - (ox > 0 ? 1 : 0)));
        const ic1 = Math.min(nx - 1, iF);
        const Kf = 0.5 * (K[kc0 * plane + jc0 * nx + ic0]! + K[kc1 * plane + jc1 * nx + ic1]!);
        const q = row + iF;
        const s0 = src[q]!;
        let lap = 0;
        if (iF > 0) lap += src[q - 1]! - s0;
        if (iF < nxF - 1) lap += src[q + 1]! - s0;
        if (jF > 0) lap += src[q - nxF]! - s0;
        if (jF < nyF - 1) lap += src[q + nxF]! - s0;
        dst[q] = s0 + c * Kf * lap;
      }
    }
  }
}

/** Column geometry of a staggered centre-level field for the vertical diffusion kernels. */
export interface ColumnMap {
  planeF: number;
  /** The two centre columns whose K average onto each field column (equal for centre fields). */
  c0: Int32Array;
  c1: Int32Array;
  /** 1/J² of each field column. */
  invJ2: Float64Array;
}

/** Build the ColumnMap of a field living at horizontal position (ox, oy) (u-faces: ox = ½) with Jacobian Jf. */
export function columnMap(g: AtmosGrid, nxF: number, nyF: number, ox: number, oy: number, Jf: Float64Array): ColumnMap {
  const { nx, ny } = g;
  const planeF = nxF * nyF;
  const c0 = new Int32Array(planeF);
  const c1 = new Int32Array(planeF);
  const invJ2 = new Float64Array(planeF);
  for (let jF = 0; jF < nyF; jF++) {
    const jc0 = Math.min(ny - 1, Math.max(0, jF - (oy > 0 ? 1 : 0)));
    const jc1 = Math.min(ny - 1, jF);
    for (let iF = 0; iF < nxF; iF++) {
      const ic0 = Math.min(nx - 1, Math.max(0, iF - (ox > 0 ? 1 : 0)));
      const ic1 = Math.min(nx - 1, iF);
      const q = jF * nxF + iF;
      c0[q] = jc0 * nx + ic0;
      c1[q] = jc1 * nx + ic1;
      const J = Jf[q]!;
      invJ2[q] = 1 / (J * J);
    }
  }
  return { planeF, c0, c1, invJ2 };
}

/**
 * Implicit vertical diffusion (tridiagonal per column, backward Euler) of a centre-level field. Zero flux at the
 * ground and the lid; K at w-faces = mean of the (up to 4) neighbouring centres; spacing uses the column
 * Jacobian. The Thomas elimination runs plane by plane over all columns (contiguous memory); `cp` needs
 * ≥ planeF·nz entries, `kw` ≥ planeF.
 */
export function diffuseVLevels(g: AtmosGrid, dt: number, K: Float32Array, f: Float32Array, map: ColumnMap, cp: Float64Array, kw: Float64Array): void {
  const { nz, plane } = g;
  const { planeF, c0, c1, invJ2 } = map;
  const dz = g.dzeta;
  const dzw = g.dzetaW;
  for (let q = 0; q < planeF; q++) kw[q] = 0;
  for (let k = 0; k < nz; k++) {
    const o = k * planeF;
    const ok = k * plane;
    const ok1 = (k + 1) * plane;
    const hasU = k < nz - 1;
    const fa = dt / (dz[k]! * dzw[k]!);
    const fc = hasU ? dt / (dz[k]! * dzw[k + 1]!) : 0;
    for (let q = 0; q < planeF; q++) {
      const a0 = c0[q]!;
      const a1 = c1[q]!;
      const ij2 = invJ2[q]!;
      const a = fa * kw[q]! * ij2;
      let ku = 0;
      if (hasU) ku = 0.25 * (K[ok + a0]! + K[ok + a1]! + K[ok1 + a0]! + K[ok1 + a1]!);
      kw[q] = ku;
      const cc = fc * ku * ij2;
      const idx = o + q;
      if (k === 0) {
        const den = 1 + cc;
        cp[idx] = cc / den;
        f[idx] = f[idx]! / den;
      } else {
        const den = 1 + a + cc - a * cp[idx - planeF]!;
        cp[idx] = cc / den;
        f[idx] = (f[idx]! + a * f[idx - planeF]!) / den;
      }
    }
  }
  for (let k = nz - 2; k >= 0; k--) {
    const o = k * planeF;
    for (let q = 0; q < planeF; q++) {
      const idx = o + q;
      f[idx] = f[idx]! + cp[idx]! * f[idx + planeF]!;
    }
  }
}

/**
 * Implicit vertical diffusion of w on the interior w-faces (ground and lid values fixed), plane-major like
 * diffuseVLevels. K at the centres between faces; spacing uses the column Jacobian. `cp` ≥ plane·(nz + 1).
 */
export function diffuseVW(g: AtmosGrid, dt: number, K: Float32Array, w: Float32Array, invJ2: Float64Array, cp: Float64Array): void {
  const { nz, plane } = g;
  if (nz < 2) return;
  const dz = g.dzeta;
  const dzw = g.dzetaW;
  for (let m = 1; m < nz; m++) {
    const o = m * plane;
    const fa = dt / (dzw[m]! * dz[m - 1]!);
    const fc = dt / (dzw[m]! * dz[m]!);
    const first = m === 1;
    const last = m === nz - 1;
    for (let c = 0; c < plane; c++) {
      const ij2 = invJ2[c]!;
      const a = fa * K[o - plane + c]! * ij2;
      const cc = fc * K[o + c]! * ij2;
      const idx = o + c;
      let rhs = w[idx]!;
      if (first) rhs += a * w[c]!;
      if (last) rhs += cc * w[o + plane + c]!;
      const aa = first ? 0 : a;
      const den = 1 + a + cc - aa * (first ? 0 : cp[idx - plane]!);
      cp[idx] = last ? 0 : cc / den;
      w[idx] = (rhs + (first ? 0 : aa * w[idx - plane]!)) / den;
    }
  }
  for (let m = nz - 2; m >= 1; m--) {
    const o = m * plane;
    for (let c = 0; c < plane; c++) {
      const idx = o + c;
      w[idx] = w[idx]! + cp[idx]! * w[idx + plane]!;
    }
  }
}
