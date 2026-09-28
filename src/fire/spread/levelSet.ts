/**
 * Narrow-band level-set core of the fire spread (spec docs/research/00-synthesis.md §7.2, D1) [V WRF-SFIRE numerics].
 *
 * φ < 0 inside the burnt area, φ > 0 outside, the front is φ = 0 (grid convention §0.2: k = j·nx + i, j = 0 south).
 * Per Heun (RK2) sub-step Δt_f the unburnt band cells evolve with
 * ```
 *   tend = −R·|∇φ|⁺ + ν·R·Δx·min(0, ∇²φ)          (Sethian upwind |∇φ| for outward motion; one-sided viscosity, D1)
 *   φ* = φⁿ + Δt·tend(φⁿ);  φⁿ⁺¹ = min(φⁿ, ½(φⁿ + φ* + Δt·tend(φ*)))       (grows-only)
 *   Δt_f ≤ bound = 0.9 / max[R((|n_x| + 2ν)/Δx + (|n_y| + 2ν)/Δy)]         (corrected CFL, D1)
 * ```
 * with the normal speed of the convex offset ellipse (§7.4) evaluated inline from per-cell coefficients (a², b_F², c
 * in m/s, head unit vector ê, VLS lateral rate with the contour tangent t̂ as max(R_ell, R_VLS|n·t̂|), junction boost),
 * capped at 6 m/s, and the normal from central differences (fallback ê; one-sided upwind differences in active VLS
 * cells).
 *
 * **Burnt-side extension** (FireSim numerics, `SPREAD_PARAMS.levelSet.burntExtension`, a deviation from applying the
 * same equation to every band cell): a cell reached by the front evolves as φ_t = −R_arrival (so φ = −R·(t − t_arr)
 * behind the front) and an ignition cell as φ_t = −R(n); neither enters the CFL maximum (it is an ODE). With the
 * plain scheme φ stays flat inside young fires and narrow heads (the upwind |∇φ| is 0 at a minimum, and the distance
 * to the flanks is shorter than to the tip), so the first-order step lags the head: a point ignition with LB 3.84
 * at Δx 30 m reached 0.64 of the analytic head after 30 min, 0.96 with the extension (the spec's measured 0.959).
 *
 * Every `reinitEvery` sub-steps the band is re-distanced by fast sweeping (4 orderings × 2 iterations) of |∇φ| = 1 on
 * the band's bounding box: zero-crossing cells keep their exact φ (re-interpolating them pulls young fronts back;
 * burnt ones at most 2 cells deeper than Δx, so a front that stalled beside them does not jump when it resumes),
 * unburnt cells take the distance, burnt extension cells the deeper of their extension and the distance (at most 2
 * cells deeper); φ = ±9Δx outside |φ| ≤ 8Δx and the band list is rebuilt sorted. Ghost cells outside the domain are
 * linear extrapolations of φ. The core knows nothing about fuel or weather: the owner fills the speed coefficients
 * and receives arrivals and lazy speed requests through {@link LevelSetHooks}. No allocation per sub-step.
 */
import type { GridSpec } from '../../core/grid';
import { SPREAD_PARAMS, type SpreadParams } from './params';

/** Callbacks from the core into the fire model. */
export interface LevelSetHooks {
  /**
   * Stage-1 request for the speed coefficients of band cell k (called once per stamp for unburnt cells whose smallest
   * 4-neighbour φ is within `lazyPrepareCells·Δx`, and for any band cell that was never prepared). The hook must set
   * `prepStamp[k] = stamp`.
   */
  ensureSpeed(k: number): void;
  /** The front reached cell k at time tA (s); r (m/s), (nx, ny) = the stage-1 normal speed and outward normal. */
  onArrival(k: number, tA: number, r: number, nx: number, ny: number): void;
}

type LevelSetParams = SpreadParams['levelSet'];

const NO_HOOKS: LevelSetHooks = { ensureSpeed: () => undefined, onArrival: () => undefined };

export class LevelSetCore {
  readonly nx: number;
  readonly ny: number;
  readonly n: number;
  readonly h: number;
  /** Level set φ (m) and the Heun stage copy (equal to φ between sub-steps). */
  readonly phi: Float64Array;
  readonly phiS: Float64Array;
  /** Speed coefficients per cell (m/s, m²/s²): R(ψ) = C·cos ψ + √(A2·cos²ψ + B2·sin²ψ) + vls·|n·t̂|, × jun. */
  readonly sA2: Float32Array;
  readonly sB2: Float32Array;
  readonly sC: Float32Array;
  readonly sEx: Float32Array;
  readonly sEy: Float32Array;
  readonly sVls: Float32Array;
  readonly sJun: Float32Array;
  /**
   * Burnt-side extension speed (m/s): a burnt cell with sBurnt > 0 evolves as φ_t = −sBurnt (its arrival ROS), so
   * φ = −R·(t − t_arr) behind the front; 0 = the ordinary level-set evolution (ignition cells).
   */
  readonly sBurnt: Float32Array;
  /** Static unit contour tangent (⊥ ∇z; 0 on flat). */
  readonly sTx: Float32Array;
  readonly sTy: Float32Array;
  /** Stamp at which the owner last prepared each cell (0 = never). */
  readonly prepStamp: Int32Array;
  /** Current preparation stamp (incremented by the owner at each prepare). */
  stamp = 1;
  /** Band: sorted cell indices with |φ| ≤ 8Δx (plus ignition inserts), and membership / ever-in-band flags. */
  readonly band: Int32Array;
  bandCount = 0;
  readonly inBand: Uint8Array;
  readonly touched: Uint8Array;
  /** Sub-steps since the start (reinitialisation cadence). */
  subCount = 0;
  /** Bound (s) found by the last stage-1 evaluation. */
  lastBound = Infinity;
  /** Lazy speed requests on (the fire model); off in the pure level-set tests. */
  lazy = true;
  hooks: LevelSetHooks = NO_HOOKS;

  private readonly P: LevelSetParams;
  private readonly edge: Uint8Array;
  // Per-band-position scratch (grown on demand to the band size).
  private tend1: Float64Array;
  private tend2: Float64Array;
  private r1: Float32Array;
  private n1x: Float32Array;
  private n1y: Float32Array;
  private arrA: Int32Array;
  private arrP0: Float64Array;
  private arrPn: Float64Array;
  private readonly dist: Float32Array;
  private readonly fixed: Uint8Array;
  private pendingInsert: Int32Array;
  private pendingCount = 0;

  constructor(grid: GridSpec, params: LevelSetParams = SPREAD_PARAMS.levelSet) {
    this.P = params;
    this.nx = grid.nx;
    this.ny = grid.ny;
    this.n = grid.nx * grid.ny;
    this.h = grid.cellSize;
    const n = this.n;
    this.phi = new Float64Array(n).fill(params.farCells * this.h);
    this.phiS = new Float64Array(n).fill(params.farCells * this.h);
    this.sA2 = new Float32Array(n);
    this.sB2 = new Float32Array(n);
    this.sC = new Float32Array(n);
    this.sEx = new Float32Array(n);
    this.sEy = new Float32Array(n).fill(1);
    this.sVls = new Float32Array(n);
    this.sJun = new Float32Array(n).fill(1);
    this.sBurnt = new Float32Array(n);
    this.sTx = new Float32Array(n);
    this.sTy = new Float32Array(n);
    this.prepStamp = new Int32Array(n);
    this.band = new Int32Array(n);
    this.inBand = new Uint8Array(n);
    this.touched = new Uint8Array(n);
    this.edge = new Uint8Array(n);
    for (let j = 0; j < this.ny; j++) {
      for (let i = 0; i < this.nx; i++) if (i === 0 || j === 0 || i === this.nx - 1 || j === this.ny - 1) this.edge[j * this.nx + i] = 1;
    }
    const cap = Math.min(n, 1024);
    this.tend1 = new Float64Array(cap);
    this.tend2 = new Float64Array(cap);
    this.r1 = new Float32Array(cap);
    this.n1x = new Float32Array(cap);
    this.n1y = new Float32Array(cap);
    this.arrA = new Int32Array(cap);
    this.arrP0 = new Float64Array(cap);
    this.arrPn = new Float64Array(cap);
    this.dist = new Float32Array(n);
    this.fixed = new Uint8Array(n);
    this.pendingInsert = new Int32Array(256);
  }

  /** φ outside the band (m). */
  get far(): number {
    return this.P.farCells * this.h;
  }

  /** Set φ of cell k (both copies). */
  setPhi(k: number, v: number): void {
    this.phi[k] = v;
    this.phiS[k] = v;
  }

  /**
   * Lower φ of cell k to min(φ, v) (clamped to ±far) and queue it for band insertion when |φ| ≤ band.
   * Returns the new φ. Call {@link commitInserts} after a batch.
   */
  lowerPhi(k: number, v: number): number {
    const far = this.far;
    const c = v < -far ? -far : v > far ? far : v;
    const p = this.phi[k]! < c ? this.phi[k]! : c;
    this.phi[k] = p;
    this.phiS[k] = p;
    if (this.inBand[k] === 0 && Math.abs(p) <= this.P.bandCells * this.h) {
      if (this.pendingCount >= this.pendingInsert.length) {
        const g = new Int32Array(this.pendingInsert.length * 2);
        g.set(this.pendingInsert);
        this.pendingInsert = g;
      }
      this.inBand[k] = 2; // queued
      this.pendingInsert[this.pendingCount++] = k;
    }
    return p;
  }

  /** Merge queued cells into the sorted band list. */
  commitInserts(): void {
    if (this.pendingCount === 0) return;
    for (let a = 0; a < this.pendingCount; a++) {
      const k = this.pendingInsert[a]!;
      this.band[this.bandCount++] = k;
      this.inBand[k] = 1;
      this.touched[k] = 1;
    }
    this.pendingCount = 0;
    this.band.subarray(0, this.bandCount).sort();
  }

  /** Replace the band by the given sorted cells (checkpoint restore). */
  setBand(cells: Int32Array, count: number): void {
    for (let a = 0; a < this.bandCount; a++) this.inBand[this.band[a]!] = 0;
    this.band.set(cells.subarray(0, count));
    this.bandCount = count;
    for (let a = 0; a < count; a++) {
      this.inBand[cells[a]!] = 1;
      this.touched[cells[a]!] = 1;
    }
  }

  /**
   * Evaluate the tendency of every band cell on field `src` into `out` (indexed by band position); stage 1 also stores
   * the normal speed and normal, issues lazy speed requests and returns max R·(|n_x| + |n_y| + 4ν)/Δx.
   * `out = null` only computes that maximum (no lazy requests).
   */
  private evaluate(src: Float64Array, out: Float64Array | null, stage1: boolean): number {
    const { nx, band, edge, sA2, sB2, sC, sEx, sEy, sVls, sJun, sTx, sTy, sBurnt, prepStamp } = this;
    const ext = this.P.burntExtension;
    const count = this.bandCount;
    const h = this.h;
    const inv = 1 / h;
    const half = 0.5 * inv;
    const inv2 = inv * inv;
    const nu = this.P.nu;
    const nuH = nu * h;
    const nu4 = 4 * nu;
    const eps = this.P.normalEps;
    const rMax = this.P.rosMaxMs;
    const lazyH = this.P.lazyPrepareCells * h;
    const lazy = stage1 && this.lazy && out !== null;
    const stamp = this.stamp;
    const hooks = this.hooks;
    const r1 = this.r1;
    const n1x = this.n1x;
    const n1y = this.n1y;
    let maxC = 0;
    for (let a = 0; a < count; a++) {
      const k = band[a]!;
      const p = src[k]!;
      const burntExt = ext && !(p > 0);
      if (burntExt) {
        const sb = sBurnt[k]!;
        if (sb > 0) {
          // Burnt-side extension φ_t = −R_arrival: an ODE, unconditionally stable, outside the CFL bound.
          if (out !== null) out[a] = -sb;
          if (stage1) {
            r1[a] = 0;
            n1x[a] = sEx[k]!;
            n1y[a] = sEy[k]!;
          }
          continue;
        }
      }
      let pl: number;
      let pr: number;
      let pd: number;
      let pu: number;
      if (edge[k] === 0) {
        pl = src[k - 1]!;
        pr = src[k + 1]!;
        pd = src[k - nx]!;
        pu = src[k + nx]!;
      } else {
        const i = k % nx;
        const j = (k - i) / nx;
        const hasL = i > 0;
        const hasR = i < nx - 1;
        const hasD = j > 0;
        const hasU = j < this.ny - 1;
        pl = hasL ? src[k - 1]! : hasR ? 2 * p - src[k + 1]! : p;
        pr = hasR ? src[k + 1]! : hasL ? 2 * p - src[k - 1]! : p;
        pd = hasD ? src[k - nx]! : hasU ? 2 * p - src[k + nx]! : p;
        pu = hasU ? src[k + nx]! : hasD ? 2 * p - src[k - nx]! : p;
      }
      if (lazy && prepStamp[k] !== stamp) {
        if (p > 0) {
          let m = pl < pr ? pl : pr;
          if (pd < m) m = pd;
          if (pu < m) m = pu;
          if (m <= lazyH) hooks.ensureSpeed(k);
        } else if (prepStamp[k] === 0) hooks.ensureSpeed(k);
      }
      const a2 = sA2[k]!;
      const b2 = sB2[k]!;
      const vr = sVls[k]!;
      if (a2 === 0 && b2 === 0 && vr === 0) {
        if (out !== null) out[a] = 0;
        if (stage1) {
          r1[a] = 0;
          n1x[a] = sEx[k]!;
          n1y[a] = sEy[k]!;
        }
        continue;
      }
      // Normal from central differences (fallback ê). In an active VLS zone (vr > 0) from the one-sided differences
      // the upwind |∇φ| below uses instead: there the lateral finger is 1–5 cells wide and the lee-eddy ellipse is
      // extremely eccentric (R_H ≈ 7.7, R_F ≈ 0.2, R_B ≈ 0.02 km/h on V10's 28° lee), so the central normal's
      // smoothing across the finger tilts it toward the upslope head and R(ψ) jumps (0.2 → 1.4 km/h for a 10° tilt).
      let cx: number;
      let cy: number;
      if (vr > 0) {
        const dmx = (p - pl) * inv;
        const dpx = (pr - p) * inv;
        const dmy = (p - pd) * inv;
        const dpy = (pu - p) * inv;
        cx = dmx > 0 && dmx >= -dpx ? dmx : dpx < 0 ? dpx : 0;
        cy = dmy > 0 && dmy >= -dpy ? dmy : dpy < 0 ? dpy : 0;
      } else {
        cx = (pr - pl) * half;
        cy = (pu - pd) * half;
      }
      const cn = Math.sqrt(cx * cx + cy * cy);
      const ex = sEx[k]!;
      const ey = sEy[k]!;
      let nxv: number;
      let nyv: number;
      if (cn > eps) {
        nxv = cx / cn;
        nyv = cy / cn;
      } else {
        nxv = ex;
        nyv = ey;
      }
      const cosp = nxv * ex + nyv * ey;
      const c2 = cosp * cosp;
      const s2 = 1 - c2;
      let R = sC[k]! * cosp + Math.sqrt(a2 * c2 + (s2 > 0 ? b2 * s2 : 0));
      if (vr > 0) {
        // VLS is an absolute lateral rate (D23): the support function of the convex hull of the ellipse and the
        // segment ±R_VLS·t̂, max(R_ell, R_VLS|n·t̂|) — still convex; the spec's sum R_ell + R_VLS|n·t̂| (§7.4) put the
        // flank on top of the observed lateral rate.
        const tt = nxv * sTx[k]! + nyv * sTy[k]!;
        const rv = vr * (tt < 0 ? -tt : tt);
        if (rv > R) R = rv;
      }
      R *= sJun[k]!;
      if (R > rMax) R = rMax;
      if (burntExt) {
        // Burnt cell not reached by the front (ignition): unit-slope extension at its own normal speed.
        if (out !== null) out[a] = -R;
        if (stage1) {
          r1[a] = R;
          n1x[a] = nxv;
          n1y[a] = nyv;
        }
        continue;
      }
      if (stage1) {
        const c = R * ((nxv < 0 ? -nxv : nxv) + (nyv < 0 ? -nyv : nyv) + nu4) * inv;
        if (c > maxC) maxC = c;
      }
      if (out === null) continue;
      // Upwind |∇φ| (Sethian, outward motion).
      const dmx = (p - pl) * inv;
      const dpx = (pr - p) * inv;
      const dmy = (p - pd) * inv;
      const dpy = (pu - p) * inv;
      let g2 = 0;
      if (dmx > 0) g2 += dmx * dmx;
      if (dpx < 0) g2 += dpx * dpx;
      if (dmy > 0) g2 += dmy * dmy;
      if (dpy < 0) g2 += dpy * dpy;
      const lap = (pl + pr + pd + pu - 4 * p) * inv2;
      out[a] = -R * Math.sqrt(g2) + (lap < 0 ? nuH * R * lap : 0);
      if (stage1) {
        r1[a] = R;
        n1x[a] = nxv;
        n1y[a] = nyv;
      }
    }
    return maxC;
  }

  /** Grow the per-band scratch to the band size (amortised; never shrinks). */
  private ensureScratch(): void {
    const need = this.bandCount;
    if (this.tend1.length >= need) return;
    const cap = Math.min(this.n, Math.max(need, Math.ceil(this.tend1.length * 1.5)));
    this.tend1 = new Float64Array(cap);
    this.tend2 = new Float64Array(cap);
    this.r1 = new Float32Array(cap);
    this.n1x = new Float32Array(cap);
    this.n1y = new Float32Array(cap);
    this.arrA = new Int32Array(cap);
    this.arrP0 = new Float64Array(cap);
    this.arrPn = new Float64Array(cap);
  }

  /** The CFL bound (s) at the current φ and speeds (∞ with no moving band cell); no side effects. */
  bound(): number {
    this.ensureScratch();
    const c = this.evaluate(this.phi, null, true);
    return c > 0 ? this.P.cflSafety / c : Infinity;
  }

  /**
   * One sub-step starting at time t with Δt = min(dtMax, bound); returns the Δt used. Arrivals are reported through
   * the hooks in band order after the update; reinitialisation runs every `reinitEvery` sub-steps.
   */
  advance(t: number, dtMax: number): number {
    this.ensureScratch();
    const c = this.evaluate(this.phi, this.tend1, true);
    const bound = c > 0 ? this.P.cflSafety / c : Infinity;
    this.lastBound = bound;
    const dt = dtMax < bound ? dtMax : bound;
    this.apply(t, dt);
    return dt;
  }

  /** One sub-step of exactly `dt` (s); throws RangeError when dt exceeds the CFL bound by more than the guard (§7.2). */
  stepFixed(t: number, dt: number): void {
    this.ensureScratch();
    const c = this.evaluate(this.phi, this.tend1, true);
    const bound = c > 0 ? this.P.cflSafety / c : Infinity;
    this.lastBound = bound;
    if (dt > this.P.cflGuard * bound) throw new RangeError(`level-set sub-step ${dt.toFixed(3)} s exceeds the CFL bound ${bound.toFixed(3)} s`);
    this.apply(t, dt);
  }

  private apply(t: number, dt: number): void {
    const { band, phi, phiS, tend1, tend2 } = this;
    const count = this.bandCount;
    if (count === 0 || !(dt > 0)) return;
    for (let a = 0; a < count; a++) {
      const k = band[a]!;
      phiS[k] = phi[k]! + dt * tend1[a]!;
    }
    this.evaluate(phiS, tend2, false);
    let nArr = 0;
    for (let a = 0; a < count; a++) {
      const k = band[a]!;
      const p0 = phi[k]!;
      let pn = 0.5 * (p0 + phiS[k]! + dt * tend2[a]!);
      if (pn > p0) pn = p0;
      phi[k] = pn;
      phiS[k] = pn;
      if (p0 > 0 && pn <= 0) {
        this.arrA[nArr] = a;
        this.arrP0[nArr] = p0;
        this.arrPn[nArr] = pn;
        nArr++;
      }
    }
    const hooks = this.hooks;
    for (let q = 0; q < nArr; q++) {
      const a = this.arrA[q]!;
      const p0 = this.arrP0[q]!;
      const tA = t + (dt * p0) / (p0 - this.arrPn[q]!);
      this.sBurnt[band[a]!] = this.r1[a]!;
      hooks.onArrival(band[a]!, tA, this.r1[a]!, this.n1x[a]!, this.n1y[a]!);
    }
    this.subCount++;
    if (this.subCount % this.P.reinitEvery === 0) this.reinit();
  }

  /**
   * Fast-sweeping re-distancing of the band (spec §7.2): crossing cells (a 4-neighbour of the other sign) stay fixed
   * at their current φ (the zero crossing is where linear interpolation between them puts it); the rest solve |∇d| = 1 by Godunov upwind sweeps in 4 orderings ×
   * `sweepIterations` on the band's bounding box grown by `farCells + 1`; then φ = sign·d inside the band (d ≤ 8Δx)
   * and sign·9Δx outside, and the band list is rebuilt in index order.
   */
  reinit(): void {
    const count = this.bandCount;
    if (count === 0) return;
    const { nx, ny, band, phi, phiS, dist, fixed, inBand } = this;
    const h = this.h;
    const far = this.far;
    const bandMax = this.P.bandCells * h;
    let i0 = nx;
    let i1 = -1;
    let j0 = ny;
    let j1 = -1;
    for (let a = 0; a < count; a++) {
      const k = band[a]!;
      const i = k % nx;
      const j = (k - i) / nx;
      if (i < i0) i0 = i;
      if (i > i1) i1 = i;
      if (j < j0) j0 = j;
      if (j > j1) j1 = j;
      inBand[k] = 0;
    }
    const grow = this.P.farCells + 1;
    i0 = Math.max(0, i0 - grow);
    j0 = Math.max(0, j0 - grow);
    i1 = Math.min(nx - 1, i1 + grow);
    j1 = Math.min(ny - 1, j1 + grow);
    // 1. Crossing cells (a 4-neighbour of the other sign) keep their current |φ| as fixed data: re-interpolating
    //    them would pull the front back wherever φ is not yet a distance function (tips, fresh ignitions).
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * nx + i;
        const p = phi[k]!;
        const neg = !(p > 0);
        const cross =
          (i > 0 && !(phi[k - 1]! > 0) !== neg) ||
          (i < nx - 1 && !(phi[k + 1]! > 0) !== neg) ||
          (j > 0 && !(phi[k - nx]! > 0) !== neg) ||
          (j < ny - 1 && !(phi[k + nx]! > 0) !== neg);
        if (cross) {
          fixed[k] = 1;
          dist[k] = neg ? -p : p;
        } else {
          fixed[k] = 0;
          dist[k] = far;
        }
      }
    }
    // 2. Sweeps.
    const its = this.P.sweepIterations;
    const h2 = 2 * h * h;
    for (let it = 0; it < its; it++) {
      for (let o = 0; o < 4; o++) {
        const iStart = o & 1 ? i1 : i0;
        const iEnd = o & 1 ? i0 - 1 : i1 + 1;
        const di = o & 1 ? -1 : 1;
        const jStart = o & 2 ? j1 : j0;
        const jEnd = o & 2 ? j0 - 1 : j1 + 1;
        const dj = o & 2 ? -1 : 1;
        for (let j = jStart; j !== jEnd; j += dj) {
          const row = j * nx;
          for (let i = iStart; i !== iEnd; i += di) {
            const k = row + i;
            if (fixed[k] !== 0) continue;
            const l = i > i0 ? dist[k - 1]! : Infinity;
            const r = i < i1 ? dist[k + 1]! : Infinity;
            const d = j > j0 ? dist[k - nx]! : Infinity;
            const u = j < j1 ? dist[k + nx]! : Infinity;
            const aa = l < r ? l : r;
            const bb = d < u ? d : u;
            let dn: number;
            const diff = aa - bb;
            if (diff >= h || diff <= -h) dn = (aa < bb ? aa : bb) + h;
            else dn = 0.5 * (aa + bb + Math.sqrt(h2 - diff * diff));
            if (dn < dist[k]!) dist[k] = dn;
          }
        }
      }
    }
    // 3. Write back and rebuild the band (row-major order = sorted).
    const ext = this.P.burntExtension;
    const sBurnt = this.sBurnt;
    const extraH = this.P.burntExtensionMaxExtraCells * h;
    let nb = 0;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * nx + i;
        const neg = !(phi[k]! > 0);
        const d = dist[k]!;
        let v: number;
        if (d <= bandMax) {
          if (fixed[k] === 1) {
            // Crossing cells keep their exact φ; a burnt one (distance to the front < Δx) at most `extra` cells deeper
            // than Δx, so an extension cell beside a stalled front (holding break, non-fuel, fuel too wet) does not
            // accumulate depth that later launches the resumed front through the next cell (bounded overshoot).
            v = phi[k]!;
            if (neg && ext && sBurnt[k]! > 0 && v < -(h + extraH)) v = -(h + extraH);
          }
          else if (!neg) v = d;
          else if (ext && sBurnt[k]! > 0) {
            // The deeper of the arrival extension and the true distance (the extension carries narrow heads, the
            // distance an accelerating fire), at most 2 cells deeper than the distance (bounds the overshoot of a
            // front entering slower fuel behind fast-burnt cells).
            const lo = -(d + extraH);
            const pk = phi[k]! < -d ? phi[k]! : -d;
            v = pk < lo ? lo : pk;
          } else v = -d;
          band[nb++] = k;
          inBand[k] = 1;
          this.touched[k] = 1;
        } else v = neg ? -far : far;
        phi[k] = v;
        phiS[k] = v;
      }
    }
    this.bandCount = nb;
  }
}
