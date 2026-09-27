/**
 * Atmosphere grid (spec §8.1): extent-scaled horizontal MAC grid, block-averaged and slope-limited terrain,
 * Gal-Chen terrain-following vertical coordinate with geometric stretching, metric fields, canopy roughness and the
 * fire-grid → column mapping.
 *
 * Layouts (k-major planes, as AtmosphereView):
 *   centres  (k·ny + j)·nx + i                      n = nx·ny·nz        (p, θ′, smoke)
 *   u-faces  (k·ny + j)·(nx + 1) + i  (face i−½)    nU = (nx+1)·ny·nz
 *   v-faces  (k·(ny + 1) + j)·nx + i  (face j−½)    nV = nx·(ny+1)·nz
 *   w-faces  (m·ny + j)·nx + i        (face m, 0 = ground, nz = top)   nW = nx·ny·(nz+1)
 * Vertical: ζ ∈ [0, H′]; face ζF[m], centre ζC[k] = ζF[k] + Δζ_k/2; physical height z = z_s + ζ·J, J = (H − z_s)/H′.
 */
import { makeGridSpec, type GridSpec } from '../core/grid';
import type { FuelMap, Terrain } from '../core/types';
import { clamp } from '../core/units';
import { KAPPA_VK } from '../core/physics';
import { ATMOS_PARAMS, ATMOS_TIERS, type AtmosTierSettings } from './params';
import type { QualityTier } from '../core/types';

/** Options that override the tier table (tests, sim overrides). */
export interface AtmosGridOptions {
  cellSize?: number;
  levels?: number;
  dz1?: number;
  atmosTop?: number;
}

export interface AtmosGrid {
  /** Horizontal grid of the column centres. */
  grid: GridSpec;
  nx: number;
  ny: number;
  nz: number;
  plane: number;
  n: number;
  nU: number;
  nV: number;
  nW: number;
  dx: number;
  /** H′ (m), z_min (m ASL), H = z_min + H′. */
  Hp: number;
  zMin: number;
  zTop: number;
  /** Stretch ratio r and first-level thickness Δζ₁. */
  stretch: number;
  dz1: number;
  dzeta: Float64Array;
  zetaC: Float64Array;
  zetaF: Float64Array;
  /** Distance between the centres on either side of w-face m (m = 0: ground → ζC[0]; m = nz: top → H′ − ζC[nz−1]). */
  dzetaW: Float64Array;
  /** Smoothed terrain (m ASL), Jacobian, terrain slopes at column centres. */
  zs: Float64Array;
  J: Float64Array;
  zsx: Float64Array;
  zsy: Float64Array;
  /** J at u-faces ((nx+1)·ny) and v-faces (nx·(ny+1)). */
  Ju: Float64Array;
  Jv: Float64Array;
  /** Canopy: mean effective height H̄, roughness z₀, displacement d, drag coefficient C_D (per column). */
  hBar: Float32Array;
  z0: Float32Array;
  disp: Float32Array;
  cd: Float32Array;
  /** Davies zone width (cells). */
  nDavies: number;
  /** Fire grid mapping: column of each fire cell, fire-cell count per column. */
  fireGrid: GridSpec;
  colOfFire: Int32Array;
  fireCount: Int32Array;
  /** Column valley-floor elevation (m ASL) for the cold pool and nudging taper (§8.4). */
  zFloor: Float32Array;
  /** P90 of the fire-grid terrain elevation (m), nudging taper z_low (§8.4). */
  zP90: number;
  /** Relief of the smoothed atmosphere terrain (m). */
  relief: number;
  /** Maximum slope (deg) of the smoothed terrain and the number of smoothing passes used. */
  maxSlopeDeg: number;
  smoothingPasses: number;
  tier: AtmosTierSettings;
}

/** Solve Δζ₁·(r^n − 1)/(r − 1) = H′ for r ≥ 1 (bisection; r = 1 when n·Δζ₁ ≥ H′). */
export function stretchRatio(levels: number, dz1: number, Hp: number): number {
  if (levels * dz1 >= Hp) return 1;
  const sum = (r: number): number => (Math.abs(r - 1) < 1e-12 ? levels * dz1 : (dz1 * (r ** levels - 1)) / (r - 1));
  let lo = 1;
  let hi = 2;
  while (sum(hi) < Hp) hi *= 1.5;
  for (let it = 0; it < 200; it++) {
    const mid = 0.5 * (lo + hi);
    if (sum(mid) < Hp) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** Atmosphere horizontal cell size Δx_a = clamp(extent/N_tier, 100, 270) m (§8.1). */
export function atmosCellSize(extent: number, tier: QualityTier): number {
  return clamp(extent / ATMOS_TIERS[tier].nTier, ATMOS_PARAMS.minCellSize, ATMOS_PARAMS.maxCellSize);
}

/**
 * Canopy drag coefficient (D51): z₀ = max(0.01, 0.1·H̄), d = 0.67·H̄, z_eff = max(z₁ − d, 10·z₀),
 * C_D = min(0.030, [κ/ln(z_eff/z₀)]²). z₁ = first level centre AGL.
 */
export function canopyDrag(hBar: number, z1: number): { z0: number; d: number; cd: number } {
  const P = ATMOS_PARAMS;
  const z0 = Math.max(P.z0Min, P.z0Frac * hBar);
  const d = P.dispFrac * hBar;
  const zEff = Math.max(z1 - d, P.zEffZ0Mult * z0);
  const cd = Math.min(P.cdMax, (KAPPA_VK / Math.log(zEff / z0)) ** 2);
  return { z0, d, cd };
}

/** Block-average a high-resolution DEM onto the atmosphere columns (cell containing each hi-res centre). */
function blockAverage(g: GridSpec, hi: { grid: GridSpec; elevation: Float32Array }): { sum: Float64Array; cnt: Float64Array } {
  const sum = new Float64Array(g.nx * g.ny);
  const cnt = new Float64Array(g.nx * g.ny);
  const hg = hi.grid;
  for (let j = 0; j < hg.ny; j++) {
    const y = hg.y0 + j * hg.cellSize;
    const cj = Math.round((y - g.y0) / g.cellSize);
    if (cj < 0 || cj >= g.ny) continue;
    for (let i = 0; i < hg.nx; i++) {
      const x = hg.x0 + i * hg.cellSize;
      const ci = Math.round((x - g.x0) / g.cellSize);
      if (ci < 0 || ci >= g.nx) continue;
      const z = hi.elevation[j * hg.nx + i]!;
      if (!Number.isFinite(z)) continue;
      const c = cj * g.nx + ci;
      sum[c]! += z;
      cnt[c]! += 1;
    }
  }
  return { sum, cnt };
}

/** Max slope (deg) of a column field by central differences (one-sided at the edges). */
function maxSlope(nx: number, ny: number, h: number, z: Float64Array): number {
  let m = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const c = j * nx + i;
      const il = i > 0 ? c - 1 : c;
      const ir = i < nx - 1 ? c + 1 : c;
      const jd = j > 0 ? c - nx : c;
      const ju = j < ny - 1 ? c + nx : c;
      const gx = (z[ir]! - z[il]!) / (h * (ir - il || 1));
      const gy = (z[ju]! - z[jd]!) / (h * ((ju - jd) / nx || 1));
      const s = Math.hypot(gx, gy);
      if (s > m) m = s;
    }
  }
  return (Math.atan(m) * 180) / Math.PI;
}

/** One 3×3 Gaussian (1-2-1 ⊗ 1-2-1) pass with edge clamping. */
function gaussPass(nx: number, ny: number, z: Float64Array, tmp: Float64Array): void {
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const il = i > 0 ? i - 1 : i;
      const ir = i < nx - 1 ? i + 1 : i;
      const r = j * nx;
      tmp[r + i] = 0.25 * z[r + il]! + 0.5 * z[r + i]! + 0.25 * z[r + ir]!;
    }
  }
  for (let j = 0; j < ny; j++) {
    const jd = j > 0 ? j - 1 : j;
    const ju = j < ny - 1 ? j + 1 : j;
    for (let i = 0; i < nx; i++) z[j * nx + i] = 0.25 * tmp[jd * nx + i]! + 0.5 * tmp[j * nx + i]! + 0.25 * tmp[ju * nx + i]!;
  }
}

/** Sliding-window minimum over a (2r+1)² square (clamped), brute force (the atmosphere grid is small). */
function windowMin(nx: number, ny: number, z: Float64Array, r: number): Float32Array {
  const out = new Float32Array(nx * ny);
  const tmp = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      let m = Infinity;
      for (let t = Math.max(0, i - r); t <= Math.min(nx - 1, i + r); t++) m = Math.min(m, z[j * nx + t]!);
      tmp[j * nx + i] = m;
    }
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      let m = Infinity;
      for (let t = Math.max(0, j - r); t <= Math.min(ny - 1, j + r); t++) m = Math.min(m, tmp[t * nx + i]!);
      out[j * nx + i] = m;
    }
  }
  return out;
}

/**
 * Build the atmosphere grid for a scenario.
 * @param terrain  fire-grid terrain (fallback elevation source and the fire-cell mapping)
 * @param hiRes    10 m DEM (preferred elevation source), optional
 * @param fuel     fire-grid fuel map (canopy roughness)
 * @param extent   domain side (m)
 */
export function buildAtmosGrid(
  terrain: Terrain,
  hiRes: { grid: GridSpec; elevation: Float32Array } | undefined,
  fuel: FuelMap | undefined,
  tier: QualityTier,
  extent: number,
  opts: AtmosGridOptions = {},
): AtmosGrid {
  const P = ATMOS_PARAMS;
  const ts = ATMOS_TIERS[tier];
  const dx = opts.cellSize ?? atmosCellSize(extent, tier);
  const grid = makeGridSpec(terrain.grid.origin, extent, dx);
  const { nx, ny } = grid;
  const plane = nx * ny;
  const nz = opts.levels ?? ts.levels;
  const dz1 = opts.dz1 ?? ts.dz1;

  // ── terrain: block average of the 10 m DEM, fallback bilinear fire-grid terrain ──
  const zs = new Float64Array(plane);
  const acc = hiRes ? blockAverage(grid, hiRes) : null;
  const fg = terrain.grid;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const c = j * nx + i;
      if (acc && acc.cnt[c]! > 0) zs[c] = acc.sum[c]! / acc.cnt[c]!;
      else {
        // Mean of the fire cells inside the column, else bilinear.
        const x = grid.x0 + i * dx;
        const y = grid.y0 + j * dx;
        let s = 0;
        let nn = 0;
        const i0 = Math.ceil((x - dx / 2 - fg.x0) / fg.cellSize - 1e-9);
        const i1 = Math.floor((x + dx / 2 - fg.x0) / fg.cellSize - 1e-9);
        const j0 = Math.ceil((y - dx / 2 - fg.y0) / fg.cellSize - 1e-9);
        const j1 = Math.floor((y + dx / 2 - fg.y0) / fg.cellSize - 1e-9);
        for (let jj = Math.max(0, j0); jj <= Math.min(fg.ny - 1, j1); jj++) {
          for (let ii = Math.max(0, i0); ii <= Math.min(fg.nx - 1, i1); ii++) {
            s += terrain.elevation[jj * fg.nx + ii]!;
            nn++;
          }
        }
        if (nn > 0) zs[c] = s / nn;
        else {
          const fi = clamp(Math.round((x - fg.x0) / fg.cellSize), 0, fg.nx - 1);
          const fj = clamp(Math.round((y - fg.y0) / fg.cellSize), 0, fg.ny - 1);
          zs[c] = terrain.elevation[fj * fg.nx + fi]!;
        }
      }
    }
  }
  // Smooth until the max slope ≤ 35° (doc 07 §7.5).
  const tmp = new Float64Array(plane);
  let passes = 0;
  let ms = maxSlope(nx, ny, dx, zs);
  while (ms > P.maxSmoothedSlopeDeg && passes < P.maxSmoothingPasses) {
    gaussPass(nx, ny, zs, tmp);
    passes++;
    ms = maxSlope(nx, ny, dx, zs);
  }
  let zMin = Infinity;
  let zMax = -Infinity;
  for (let c = 0; c < plane; c++) {
    zMin = Math.min(zMin, zs[c]!);
    zMax = Math.max(zMax, zs[c]!);
  }
  const relief = zMax - zMin;
  const Hp = Math.max(opts.atmosTop ?? P.atmosTop, relief + P.reliefMargin);
  const zTop = zMin + Hp;

  // ── vertical levels ──
  const r = stretchRatio(nz, dz1, Hp);
  const dzeta = new Float64Array(nz);
  const zetaF = new Float64Array(nz + 1);
  const zetaC = new Float64Array(nz);
  let acc0 = 0;
  for (let k = 0; k < nz; k++) {
    dzeta[k] = dz1 * r ** k;
    zetaF[k] = acc0;
    acc0 += dzeta[k]!;
  }
  // Rescale so the faces end exactly at H′ (bisection residual).
  const sc = Hp / acc0;
  acc0 = 0;
  for (let k = 0; k < nz; k++) {
    dzeta[k]! *= sc;
    zetaF[k] = acc0;
    zetaC[k] = acc0 + dzeta[k]! / 2;
    acc0 += dzeta[k]!;
  }
  zetaF[nz] = Hp;
  const dzetaW = new Float64Array(nz + 1);
  dzetaW[0] = zetaC[0]!;
  for (let m = 1; m < nz; m++) dzetaW[m] = zetaC[m]! - zetaC[m - 1]!;
  dzetaW[nz] = Hp - zetaC[nz - 1]!;

  // ── metric ──
  const J = new Float64Array(plane);
  const zsx = new Float64Array(plane);
  const zsy = new Float64Array(plane);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const c = j * nx + i;
      J[c] = (zTop - zs[c]!) / Hp;
      const il = i > 0 ? c - 1 : c;
      const ir = i < nx - 1 ? c + 1 : c;
      const jd = j > 0 ? c - nx : c;
      const ju = j < ny - 1 ? c + nx : c;
      zsx[c] = (zs[ir]! - zs[il]!) / (dx * (ir - il || 1));
      zsy[c] = (zs[ju]! - zs[jd]!) / (dx * ((ju - jd) / nx || 1));
    }
  }
  const Ju = new Float64Array((nx + 1) * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const a = J[j * nx + Math.max(0, i - 1)]!;
      const b = J[j * nx + Math.min(nx - 1, i)]!;
      Ju[j * (nx + 1) + i] = 0.5 * (a + b);
    }
  }
  const Jv = new Float64Array(nx * (ny + 1));
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = J[Math.max(0, j - 1) * nx + i]!;
      const b = J[Math.min(ny - 1, j) * nx + i]!;
      Jv[j * nx + i] = 0.5 * (a + b);
    }
  }

  // ── fire-grid mapping ──
  const nf = fg.nx * fg.ny;
  const colOfFire = new Int32Array(nf);
  const fireCount = new Int32Array(plane);
  for (let j = 0; j < fg.ny; j++) {
    const cj = clamp(Math.round((fg.y0 + j * fg.cellSize - grid.y0) / dx), 0, ny - 1);
    for (let i = 0; i < fg.nx; i++) {
      const ci = clamp(Math.round((fg.x0 + i * fg.cellSize - grid.x0) / dx), 0, nx - 1);
      const c = cj * nx + ci;
      colOfFire[j * fg.nx + i] = c;
      fireCount[c]! += 1;
    }
  }

  // ── canopy roughness (D51) ──
  const hBar = new Float32Array(plane);
  const z0 = new Float32Array(plane);
  const disp = new Float32Array(plane);
  const cd = new Float32Array(plane);
  if (fuel) {
    const hsum = new Float64Array(plane);
    for (let k = 0; k < nf; k++) {
      const h = fuel.canopyHeight[k]! * Math.min(1, fuel.canopyCover[k]! / P.canopyCoverRef);
      if (Number.isFinite(h)) hsum[colOfFire[k]!]! += h;
    }
    for (let c = 0; c < plane; c++) hBar[c] = fireCount[c]! > 0 ? hsum[c]! / fireCount[c]! : 0;
  }
  for (let c = 0; c < plane; c++) {
    const z1 = zetaC[0]! * J[c]!;
    const cdv = canopyDrag(hBar[c]!, z1);
    z0[c] = cdv.z0;
    disp[c] = cdv.d;
    cd[c] = cdv.cd;
  }

  // ── valley floor per column and P90 of the fire terrain ──
  const rFloor = Math.max(1, Math.round(P.valleyFloorRadius / dx));
  const zFloor = windowMin(nx, ny, zs, rFloor);
  const sorted = Float32Array.from(terrain.elevation).sort();
  const zP90 = sorted[Math.min(sorted.length - 1, Math.floor(0.9 * sorted.length))]!;

  const nDavies = Math.min(Math.floor((Math.min(nx, ny) - 1) / 2), Math.max(P.daviesMinCells, Math.round(P.daviesFraction * nx)));

  return {
    grid,
    nx,
    ny,
    nz,
    plane,
    n: plane * nz,
    nU: (nx + 1) * ny * nz,
    nV: nx * (ny + 1) * nz,
    nW: plane * (nz + 1),
    dx,
    Hp,
    zMin,
    zTop,
    stretch: r,
    dz1,
    dzeta,
    zetaC,
    zetaF,
    dzetaW,
    zs,
    J,
    zsx,
    zsy,
    Ju,
    Jv,
    hBar,
    z0,
    disp,
    cd,
    nDavies,
    fireGrid: fg,
    colOfFire,
    fireCount,
    zFloor,
    zP90,
    relief,
    maxSlopeDeg: ms,
    smoothingPasses: passes,
    tier: ts,
  };
}

/** Physical height AGL of ζ in column c. */
export const aglOf = (g: AtmosGrid, c: number, zeta: number): number => zeta * g.J[c]!;

/**
 * Fractional centre-level index (0 … nz−1, clamped) of a height AGL in column c, for linear interpolation between
 * level centres. Below the first centre → 0; above the last → nz − 1.
 */
export function levelFrac(g: AtmosGrid, c: number, zAgl: number): number {
  const zeta = zAgl / g.J[c]!;
  const zc = g.zetaC;
  const nz = g.nz;
  if (zeta <= zc[0]!) return 0;
  if (zeta >= zc[nz - 1]!) return nz - 1;
  // Geometric stretching: invert approximately, then correct locally.
  let lo = 0;
  let hi = nz - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (zc[m]! <= zeta) lo = m;
    else hi = m;
  }
  return lo + (zeta - zc[lo]!) / (zc[lo + 1]! - zc[lo]!);
}
