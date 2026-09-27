/**
 * Fire shape: length-to-breadth ratio and the flat ellipse support function (spec §6.8) [V Spark forms; D20, D21].
 *
 * ```
 * forest/pine:  LB = U < 5 ? 1 + (0.9286·e^{0.0505U} − 1)·clamp((U − 2)/3, 0, 1) : (U < 25 ? 0.9286·e^{0.0505U} : 0.1143U + 0.4143)
 * grass/heath:  LB = U < 2 ? 1 : 1 + (1.1·U^0.464 − 1)·clamp((U − 2)/3, 0, 1)        (ramps replace the jumps, D21)
 * cc = √(1 − LB⁻²);  cb = (1 − cc)/(1 + cc);  f = (1 + cb)/2;  g = (1 − cb)/2;  h = f/LB
 * ŝ(ψ) = g·cos ψ + √(h² + (f² − h²)·cos²ψ)          (1 head, h flank, cb back)
 * ```
 * U is the wind component along the head direction, U_axis = max(0, U10·cos(e − windTo)) (km/h).
 */
import type { FuelFamily } from '../../core/types';
import { FIRE_MODEL_PARAMS } from './params';

const RS = FIRE_MODEL_PARAMS.lb.rampStart;
const RW = FIRE_MODEL_PARAMS.lb.rampWidth;

/** Forest/pine length-to-breadth ratio (U km/h along the head axis). */
export function lbForest(u: number): number {
  if (!(u > 0)) return 1;
  if (u < 5) {
    let r = (u - RS) / RW;
    if (r <= 0) return 1;
    if (r > 1) r = 1;
    return 1 + (0.9286 * Math.exp(0.0505 * u) - 1) * r;
  }
  return u < 25 ? 0.9286 * Math.exp(0.0505 * u) : 0.1143 * u + 0.4143;
}

/** Grass/heath length-to-breadth ratio (U km/h along the head axis). */
export function lbGrass(u: number): number {
  if (!(u >= RS)) return 1;
  let r = (u - RS) / RW;
  if (r > 1) r = 1;
  return 1 + (1.1 * Math.pow(u, 0.464) - 1) * r;
}

/** LB for a model family: forest form for vesta2/pine, grass form for grass/heath; 1 for none. */
export function lengthToBreadth(family: FuelFamily, uAxisKmh: number): number {
  if (family === 'vesta2' || family === 'pine') return lbForest(uAxisKmh);
  if (family === 'grass' || family === 'heath') return lbGrass(uAxisKmh);
  return 1;
}

/** Ellipse coefficients of the flat support function (all as fractions of the head ROS). */
export interface EllipseCoeffs {
  lb: number;
  /** Back fraction cb = R_B/R_H. */
  cb: number;
  /** Flank fraction h = R_F/R_H. */
  h: number;
  f: number;
  g: number;
}

export const createEllipseCoeffs = (): EllipseCoeffs => ({ lb: 1, cb: 1, h: 1, f: 1, g: 0 });

/** Fill the ellipse coefficients for a length-to-breadth ratio (LB ≥ 1; LB = 1 is a circle). */
export function ellipseCoefficients(lb: number, out: EllipseCoeffs): EllipseCoeffs {
  const l = lb > 1 ? lb : 1;
  const cc = Math.sqrt(1 - 1 / (l * l));
  const cb = (1 - cc) / (1 + cc);
  const f = (1 + cb) / 2;
  out.lb = l;
  out.cb = cb;
  out.f = f;
  out.g = (1 - cb) / 2;
  out.h = f / l;
  return out;
}

/** Support function ŝ at an angle with cosine `cosPsi` from the head direction (1 at the head, h flank, cb back). */
export function ellipseSupportCos(c: EllipseCoeffs, cosPsi: number): number {
  const c2 = cosPsi * cosPsi;
  return c.g * cosPsi + Math.sqrt(c.h * c.h + (c.f * c.f - c.h * c.h) * c2);
}

/** Support function ŝ(ψ) for LB at angle ψ (deg) from the head direction. */
export function ellipseSupport(lb: number, psiDeg: number): number {
  return ellipseSupportCos(ellipseCoefficients(lb, createEllipseCoeffs()), Math.cos((psiDeg * Math.PI) / 180));
}
