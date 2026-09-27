/**
 * Random sampling for the ember model (spec §9.1 class table, §9.2 super-particles, §12.5 determinism).
 *
 * - `FastRng`: the same mulberry32 stream as `core/rng` `Rng.next()` with its state in a public field, so the
 *   transport loop can draw without a method on a shared object; the model copies the state from/to the stream-0 `Rng`
 *   at every public call, so checkpoints of either object resume the identical sequence.
 * - A 4096-entry inverse-normal table for the OU turbulence draws (doc 06 §4.7 recommends a table or ziggurat; the
 *   table is rescaled to unit variance, tails truncated at ±3.6σ, which is immaterial for turbulence).
 * - Class property sampling: v_t0, τ_f, τ_b with importance weights (defensive mixture proposal q = (1 − α)f + αg for
 *   the E1 lifetimes and the E2 far tail: the particle weight is multiplied by the likelihood ratio f/q ≤ 1/(1 − α),
 *   which keeps expected counts unbiased [standard MC]).
 */
import { EMBER_PARAMS, type EmberClassParams, type EmberParams } from './params';

/** mulberry32 identical to `Rng.next()` (core/rng.ts). */
export class FastRng {
  s: number;
  constructor(state: number) {
    this.s = state >>> 0;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }
  /** Accurate standard normal (Box–Muller; used at emission, not in the transport loop). */
  normal(): number {
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  /** Poisson count (Knuth below 30, normal approximation above) — same algorithm as `Rng.poisson`. */
  poisson(mean: number): number {
    if (!(mean > 0)) return 0;
    if (mean > 30) return Math.max(0, Math.round(mean + Math.sqrt(mean) * this.normal()));
    const l = Math.exp(-mean);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= this.next();
    } while (p > l);
    return k - 1;
  }
}

/** Acklam's inverse normal CDF (relative error < 1.2e-9). */
export function inverseNormalCdf(p: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - pl) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

export const NORMAL_TABLE_BITS = 12;
export const NORMAL_TABLE_SIZE = 1 << NORMAL_TABLE_BITS;

/** Unit-variance table of N(0,1) quantiles at (i + 0.5)/N; index with ⌊u·N⌋. */
export const NORMAL_TABLE: Float64Array = (() => {
  const t = new Float64Array(NORMAL_TABLE_SIZE);
  let s2 = 0;
  for (let i = 0; i < NORMAL_TABLE_SIZE; i++) {
    const z = inverseNormalCdf((i + 0.5) / NORMAL_TABLE_SIZE);
    t[i] = z;
    s2 += z * z;
  }
  const k = 1 / Math.sqrt(s2 / NORMAL_TABLE_SIZE);
  for (let i = 0; i < NORMAL_TABLE_SIZE; i++) t[i]! *= k;
  return t;
})();

/** Table normal from one uniform draw. */
export const tableNormal = (r: FastRng): number => NORMAL_TABLE[(r.next() * NORMAL_TABLE_SIZE) | 0]!;

// ── lifetime distributions ───────────────────────────────────────────────────────────────────────────────

const SQRT2PI = Math.sqrt(2 * Math.PI);
/** Lognormal pdf times τ (the 1/τ factor cancels in likelihood ratios, so densities are kept in ln τ). */
const lnPdf = (lnT: number, mu: number, s: number): number => Math.exp(-((lnT - mu) * (lnT - mu)) / (2 * s * s)) / (s * SQRT2PI);
/** Log-uniform pdf times τ on [a, b]. */
const luPdf = (t: number, a: number, b: number): number => (t >= a && t <= b ? 1 / Math.log(b / a) : 0);

/** Nature density of τ_b in ln τ (τ·f(τ)) for class c. */
export function natureTauBDensity(c: EmberClassParams, tau: number, p: EmberParams = EMBER_PARAMS): number {
  const lt = Math.log(tau);
  if (c.tauB.kind === 'lognormal') return lnPdf(lt, Math.log(c.tauB.median), c.tauB.sigmaLn);
  if (c.tauB.kind === 'ribbonMixture') {
    const r = p.ribbonTauB;
    let s = 0;
    for (const m of r.means) s += lnPdf(lt, Math.log(m) - (r.sigmaLn * r.sigmaLn) / 2, r.sigmaLn);
    return ((1 - r.tailWeight) * s) / r.means.length + r.tailWeight * luPdf(tau, r.tailMin, r.tailMax);
  }
  return NaN; // fixed / albini: no density needed (no proposal)
}

function sampleNature(c: EmberClassParams, r: FastRng, vt0: number, p: EmberParams): number {
  switch (c.tauB.kind) {
    case 'lognormal':
      return c.tauB.median * Math.exp(c.tauB.sigmaLn * r.normal());
    case 'ribbonMixture': {
      const rb = p.ribbonTauB;
      if (r.next() < rb.tailWeight) return rb.tailMin * Math.exp(r.next() * Math.log(rb.tailMax / rb.tailMin));
      const m = rb.means[Math.min(rb.means.length - 1, (r.next() * rb.means.length) | 0)]!;
      return m * Math.exp(-(rb.sigmaLn * rb.sigmaLn) / 2 + rb.sigmaLn * r.normal());
    }
    case 'albini':
      return p.albiniK * vt0;
    default:
      return c.tauB.median;
  }
}

/** Mean τ_b (s) of what the model actually samples (proposal if any), the prior of the residence estimate τ̄_c. */
export function proposalMeanTauB(c: EmberClassParams, p: EmberParams = EMBER_PARAMS): number {
  let nature: number;
  switch (c.tauB.kind) {
    case 'lognormal':
      nature = c.tauB.median * Math.exp((c.tauB.sigmaLn * c.tauB.sigmaLn) / 2);
      break;
    case 'ribbonMixture': {
      const rb = p.ribbonTauB;
      const mean = rb.means.reduce((a, b) => a + b, 0) / rb.means.length;
      nature = (1 - rb.tailWeight) * mean + (rb.tailWeight * (rb.tailMax - rb.tailMin)) / Math.log(rb.tailMax / rb.tailMin);
      break;
    }
    case 'albini':
      nature = p.albiniK * 0.5 * (c.vt0.min + c.vt0.max);
      break;
    default:
      nature = c.tauB.median;
  }
  const q = c.proposal;
  if (!q) return nature;
  const g = q.kind === 'lognormal' ? q.p1 * Math.exp((q.p2 * q.p2) / 2) : (q.p2 - q.p1) / Math.log(q.p2 / q.p1);
  return (1 - q.mix) * nature + q.mix * g;
}

/** Median of the nature τ_b of a class (s) (the spec's τ̄_c, used for the residence floor). */
export function medianTauB(c: EmberClassParams, p: EmberParams = EMBER_PARAMS): number {
  switch (c.tauB.kind) {
    case 'ribbonMixture': {
      const m = [...p.ribbonTauB.means].sort((a, b) => a - b);
      return m[(m.length - 1) >> 1]!;
    }
    case 'albini':
      return p.albiniK * 0.5 * (c.vt0.min + c.vt0.max);
    default:
      return c.tauB.median;
  }
}

/** One sampled set of class properties. */
export interface EmberDraw {
  vt0: number;
  tauF: number;
  tauB: number;
  /** Likelihood ratio f/q of the τ_b draw (1 without a proposal). */
  weight: number;
}

/** Sample v_t0, τ_f, τ_b (+ importance ratio) for a class. `out` is overwritten and returned. */
export function sampleClass(c: EmberClassParams, r: FastRng, out: EmberDraw, p: EmberParams = EMBER_PARAMS): EmberDraw {
  // v_t0 at ρ_ref.
  let vt0: number;
  if (c.vt0.kind === 'uniform') vt0 = r.range(c.vt0.min, c.vt0.max);
  else {
    vt0 = NaN;
    for (let tries = 0; tries < 8; tries++) {
      const v = c.vt0.median * Math.exp(c.vt0.sigmaLn * r.normal());
      if (v >= c.vt0.min && v <= c.vt0.max) {
        vt0 = v;
        break;
      }
    }
    if (!(vt0 === vt0)) vt0 = Math.min(c.vt0.max, Math.max(c.vt0.min, c.vt0.median));
  }
  // τ_b with the importance proposal.
  let tauB: number;
  let w = 1;
  const q = c.proposal;
  if (q) {
    if (r.next() < q.mix) {
      tauB = q.kind === 'lognormal' ? q.p1 * Math.exp(q.p2 * r.normal()) : q.p1 * Math.exp(r.next() * Math.log(q.p2 / q.p1));
    } else tauB = sampleNature(c, r, vt0, p);
    const f = natureTauBDensity(c, tauB, p);
    const g = q.kind === 'lognormal' ? lnPdf(Math.log(tauB), Math.log(q.p1), q.p2) : luPdf(tauB, q.p1, q.p2);
    const qd = (1 - q.mix) * f + q.mix * g;
    w = qd > 0 ? f / qd : 0;
  } else tauB = sampleNature(c, r, vt0, p);
  if (!(tauB > 1)) tauB = 1;
  // τ_f (never longer than the brand lives).
  let tauF = c.tauF.sigmaLn > 0 ? c.tauF.median * Math.exp(c.tauF.sigmaLn * r.normal()) : c.tauF.median;
  if (tauF > tauB) tauF = tauB;
  out.vt0 = vt0;
  out.tauF = tauF;
  out.tauB = tauB;
  out.weight = w;
  return out;
}
