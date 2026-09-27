/**
 * Air temperature and humidity at each fire-grid cell (spec §5.2, D43, D26, D49).
 *
 *   Γ = 6.5 + 3.3·smoothstep(5°, 15°, h_sun)·smoothstep(0.75·relief, 1.25·relief, BLH ?? 1500 m)   K/km
 *   T_free(z) = T_s − Γ·(z − z_s)/1000 ;  Td_free(z) = T_d,s − 1.8·(z − z_s)/1000
 *   cold pool (hav < h_inv):  z_inv = z − hav + h_inv ;  T = T_free(z_inv) − Δθ·(1 − hav/h_inv) ;
 *                             Td = min(T, Td_free(z_inv))                       (the pool keeps its moisture)
 *                             (z_inv shift weighted by sn = clamp(Δθ/3 K, 0, 1), see cellAir)
 *   else T = T_free(z), Td = min(T, Td_free(z))
 *
 * z_s is the weather grid-point elevation (`series.sourceElevation`, e.g. 715 m for Katoomba whose plateau is at
 * ~1000 m: the lapse correction is not optional). The band |hav − h_inv| ≤ 75 m is the thermal belt.
 */
import { STABLE_NIGHT_PARAMS } from '../../core/physics';
import { smoothstep } from '../../core/units';
import { MOISTURE_PARAMS, type MoistureParams } from './params';

/** Air-temperature lapse rate Γ (K/km) for a sun elevation (deg), domain relief (m) and BLH (m, optional). */
export function lapseRate(sunElevDeg: number, reliefM: number, blhM: number | undefined, p: MoistureParams = MOISTURE_PARAMS): number {
  const blh = blhM !== undefined && Number.isFinite(blhM) ? blhM : p.blhDefault;
  const relief = Math.max(1, reliefM);
  const sunW = smoothstep(p.lapseSunLoDeg, p.lapseSunHiDeg, sunElevDeg);
  if (sunW === 0) return p.lapseNight;
  return p.lapseNight + (p.lapseDay - p.lapseNight) * sunW * smoothstep(p.lapseBlhLo * relief, p.lapseBlhHi * relief, blh);
}

/** Domain forcing for {@link cellAir}. */
export interface AirForcing {
  /** Grid-point air temperature and dew point (°C) at z_s. */
  tS: number;
  tdS: number;
  zS: number;
  /** Lapse rate Γ (K/km). */
  lapse: number;
  /** Cold-pool strength Δθ (K) and depth h_inv (m) from the stable-night state. */
  dTheta: number;
  hInv: number;
  dewLapse: number;
}

/**
 * Air temperature and dew point at a cell of elevation z (m) and height above the valley floor hav (m). Writes
 * [T, Td] to `out` (no allocation).
 *
 * Deviation from the literal §5.2 formula (documented in the module report): the isothermal shift of the pool
 * (z → z_inv) is weighted by the stable-night strength sn = clamp(Δθ/3 K, 0, 1), so the pool vanishes continuously
 * when Δθ → 0 (by day). The literal formula keeps a permanent isothermal layer (−Γ·h_inv ≈ −1.5 K at the valley
 * floor) on windy nights and in the afternoon, or jumps by that amount if gated on Δθ > 0; both contradict
 * "zero when there is no stable night" and the D49 continuity test. At sn = 1 (Δθ ≥ 3 K) it is the spec formula.
 */
export function cellAir(f: AirForcing, z: number, hav: number, out: Float64Array | number[]): void {
  let zq = z;
  let pool = 0;
  if (f.dTheta > 0 && f.hInv > 0 && hav < f.hInv) {
    const h = hav > 0 ? hav : 0;
    const sn = Math.min(1, f.dTheta / STABLE_NIGHT_PARAMS.snScaleK);
    zq = z + sn * (f.hInv - h);
    pool = f.dTheta * (1 - h / f.hInv);
  }
  const dz = (zq - f.zS) / 1000;
  const t = f.tS - f.lapse * dz - pool;
  const td = f.tdS - f.dewLapse * dz;
  out[0] = t;
  out[1] = td < t ? td : t;
}

/** Cold-pool temperature term T − T_free(z) (K) of a cell (≤ 0): what the stable night adds to the lapse. */
export function coldPoolTerm(f: AirForcing, z: number, hav: number): number {
  const out = [0, 0];
  cellAir(f, z, hav, out);
  return out[0]! - (f.tS - (f.lapse * (z - f.zS)) / 1000);
}

/** True for a thermal-belt cell: |hav − h_inv| ≤ 75 m (D26). */
export const isThermalBelt = (hav: number, hInv: number, halfWidth = 75): boolean => Math.abs(hav - hInv) <= halfWidth;

/** Median of a Float32Array (copy + sort; init-time helper). */
export function medianOf(a: ArrayLike<number>): number {
  const v = Float64Array.from(a as ArrayLike<number>).filter(Number.isFinite).sort();
  if (v.length === 0) return 0;
  const m = v.length >> 1;
  return v.length % 2 ? v[m]! : 0.5 * (v[m - 1]! + v[m]!);
}

