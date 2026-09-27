/**
 * Fuel accumulation state machine (spec §4.5).
 *
 * For each layer X ∈ {s, ns, el, b, o} (steady state X_ss, Olson rate k per year) and each hazard score
 * H ∈ {FHS_s, FHS_ns, FHS_el} (class maxima, with the k of its layer), the included fire records of a cell are
 * processed in order of burn time t_b:
 *
 *   X ← X_ss; tPrev ← −∞                                              (no record = steady state, D40)
 *   for rec: if tPrev finite: X ← X_ss − (X_ss − X)·exp(−k·(t_b − tPrev)/YEAR)     (Olson with residual, doc 05 §2.2)
 *            Wildfire | Unknown: every layer and hazard ← 0                         (operational reset, D16)
 *            PrescribedBurn (p = 0.6 [H]): s, ns, H_s, H_ns ×(1 − p); el, b, H_el ×(1 − 0.5p); o unchanged
 *            user burn (setTimeSinceFire, §4.8): the same with p = editBurnPatchiness (1)
 *            tPrev ← t_b
 *   if tPrev finite: X ← X_ss − (X_ss − X)·exp(−k·(t0 − tPrev)/YEAR)
 *
 * Post-fire regime (doc 05 §2.3, §5.2; ACT "2020_" pattern [V values, H use]): if the last record is a wildfire,
 * 1 ≤ tsf ≤ 15 yr and the class is DryForestShrubby, SnowGumWoodland or Montane WSF (class 30), the layers since that
 * fire are also evolved with ns_ss ×4, el_ss ×2.5, k_ns = k_el = 0.45, k_s ×0.67, k_b = 0.02 and blended
 * X = (1 − w)·X_standard + w·X_postFire (w = 0.5 unknown severity). Post-fire hazard maxima [H]:
 * max(class FHS max, fhsFromLoad(post-fire steady load)), capped at 4.
 *
 * Bark hazard from the evolved bark load: step table [V PyroXL `fl_to_fhs`].
 */
import { FireHistoryKind, FuelType, type FuelHistoryCompact } from '../core/types';
import type { ResolvedFuelClass } from './catalogue';
import { barkHazardFromLoad, fhsFromLoad } from './hazard';
import { FIRE_KIND_USER_BURN } from './history';
import { YEAR_MS, type FuelParams } from './params';

/** Olson accumulation from x0 towards xss over dtYears at rate k (/yr). */
export const olson = (xss: number, x0: number, k: number, dtYears: number): number => xss - (xss - x0) * Math.exp(-k * Math.max(0, dtYears));

/** Accumulation from 0 after a full reset: xss·(1 − e^(−k·t)). */
const grow = (xss: number, k: number, tYears: number): number => xss * (1 - Math.exp(-k * tYears));

/** A cell's fire records (sorted by t_b). Reusable buffer: `n` valid entries. */
export interface CellHistory {
  n: number;
  tb: Float64Array;
  kind: Uint8Array;
}

export function makeCellHistory(capacity = 64): CellHistory {
  return { n: 0, tb: new Float64Array(capacity), kind: new Uint8Array(capacity) };
}

/** Copy cell k's records from the compact history into `out` (grows the buffer if needed). */
export function loadCellHistory(h: FuelHistoryCompact | undefined | null, k: number, out: CellHistory): CellHistory {
  if (!h) {
    out.n = 0;
    return out;
  }
  const a = h.recStart[k]!;
  const b = h.recStart[k + 1]!;
  const n = b - a;
  if (out.tb.length < n) {
    out.tb = new Float64Array(n * 2);
    out.kind = new Uint8Array(n * 2);
  }
  for (let q = 0; q < n; q++) {
    const r = h.recIndex[a + q]!;
    out.tb[q] = h.tb[r]!;
    out.kind[q] = h.kind[r]!;
  }
  out.n = n;
  return out;
}

/** A single synthetic record (setTimeSinceFire edit) in `out`. */
export function syntheticCellHistory(tb: number, out: CellHistory): CellHistory {
  out.tb[0] = tb;
  out.kind[0] = FIRE_KIND_USER_BURN;
  out.n = 1;
  return out;
}

/**
 * Evolve one quantity (load or hazard) through the records (see module doc). `retPb` / `retUser` are the retained
 * fractions after a prescribed burn / user burn; wildfire and unknown kinds reset to 0.
 */
export function evolve(xss: number, k: number, retPb: number, retUser: number, h: CellHistory, t0: number): number {
  let x = xss;
  let tPrev = NaN;
  const kPerMs = k / YEAR_MS;
  for (let q = 0; q < h.n; q++) {
    const tb = h.tb[q]!;
    if (tPrev === tPrev) x = xss - (xss - x) * Math.exp(-kPerMs * Math.max(0, tb - tPrev));
    const kind = h.kind[q]!;
    if (kind === FireHistoryKind.PrescribedBurn) x *= retPb;
    else if (kind === FIRE_KIND_USER_BURN) x *= retUser;
    else x = 0;
    tPrev = tb;
  }
  if (tPrev === tPrev) x = xss - (xss - x) * Math.exp(-kPerMs * Math.max(0, t0 - tPrev));
  return x;
}

/** Evolved fuel state of one cell. */
export interface FuelState {
  s: number;
  ns: number;
  el: number;
  b: number;
  o: number;
  fhsS: number;
  fhsNs: number;
  fhsEl: number;
  barkHazard: number;
  /** Post-fire regime weight actually applied (0 = none). */
  postFireW: number;
  /** Years since the last record (NaN = none). */
  tsf: number;
  /** Kind of the last record (FireHistoryKind; user burns report PrescribedBurn), 0 when none. */
  lastKind: number;
}

export function makeFuelState(): FuelState {
  return { s: 0, ns: 0, el: 0, b: 0, o: 0, fhsS: 0, fhsNs: 0, fhsEl: 0, barkHazard: 0, postFireW: 0, tsf: NaN, lastKind: 0 };
}

/** True for classes that take the post-fire regime (§4.5). */
export const postFireEligible = (cls: ResolvedFuelClass): boolean =>
  cls.id === FuelType.DryForestShrubby || cls.id === FuelType.SnowGumWoodland || cls.classId === 30;

/**
 * FESM severity code → post-fire blend weight: 0 unknown → w_unknown (0.5), 1 low/moderate → 0, 2 high/extreme → 1.
 */
export function postFireWeight(severity: number, P: FuelParams): number {
  return severity === 2 ? P.postFireWeightHighSeverity : severity === 1 ? P.postFireWeightLowSeverity : P.postFireWeightUnknownSeverity;
}

/** §4.5 for one cell: fills `out` from the class steady state and the cell's records at time t0. */
export function accumulate(cls: ResolvedFuelClass, h: CellHistory, t0: number, P: FuelParams, severity: number, out: FuelState): FuelState {
  const p = P.patchiness;
  const pu = P.editBurnPatchiness;
  const r1 = 1 - p;
  const r2 = 1 - 0.5 * p;
  const u1 = 1 - pu;
  const u2 = 1 - 0.5 * pu;
  const S = cls.surface;
  const NS = cls.nearSurface;
  const EL = cls.elevated;
  const B = cls.bark;
  const O = cls.canopy;
  const F = cls.fhsMax;
  // evolve() is linear in X_ss, so each layer and its hazard share one relative trajectory (same k, same retention);
  // near-surface reuses the surface trajectory when the rates match (most LUT rows).
  if (h.n === 0) {
    out.s = S.load; out.ns = NS.load; out.el = EL.load; out.b = B.load; out.o = O.load;
    out.fhsS = F.surface; out.fhsNs = F.nearSurface; out.fhsEl = F.elevated;
  } else {
    const gS = evolve(1, S.k, r1, u1, h, t0);
    const gNs = NS.k === S.k ? gS : evolve(1, NS.k, r1, u1, h, t0);
    const gEl = evolve(1, EL.k, r2, u2, h, t0);
    const gB = B.k === EL.k ? gEl : evolve(1, B.k, r2, u2, h, t0);
    const gO = evolve(1, O.k, 1, 1, h, t0);
    out.s = S.load * gS; out.fhsS = F.surface * gS;
    out.ns = NS.load * gNs; out.fhsNs = F.nearSurface * gNs;
    out.el = EL.load * gEl; out.fhsEl = F.elevated * gEl;
    out.b = B.load * gB;
    out.o = O.load * gO;
  }
  out.postFireW = 0;
  if (h.n === 0) {
    out.tsf = NaN;
    out.lastKind = 0;
  } else {
    const last = h.n - 1;
    out.tsf = (t0 - h.tb[last]!) / YEAR_MS;
    const lk = h.kind[last]!;
    out.lastKind = lk === FIRE_KIND_USER_BURN ? FireHistoryKind.PrescribedBurn : lk;
    if (lk === FireHistoryKind.Wildfire && out.tsf >= P.postFireTsfMin && out.tsf <= P.postFireTsfMax && postFireEligible(cls)) {
      const w = postFireWeight(severity, P);
      if (w > 0) {
        const t = out.tsf;
        const v = 1 - w;
        const kS = S.k * P.postFireKSurfaceMult;
        const kNsEl = P.postFireKNsEl;
        const nsSs = NS.load * P.postFireNsMult;
        const elSs = EL.load * P.postFireElMult;
        const fNs = Math.min(4, Math.max(F.nearSurface, fhsFromLoad('nearSurface', nsSs)));
        const fEl = Math.min(4, Math.max(F.elevated, fhsFromLoad('elevated', elSs)));
        out.s = v * out.s + w * grow(S.load, kS, t);
        out.ns = v * out.ns + w * grow(nsSs, kNsEl, t);
        out.el = v * out.el + w * grow(elSs, kNsEl, t);
        out.b = v * out.b + w * grow(B.load, P.postFireKBark, t);
        out.fhsS = v * out.fhsS + w * grow(F.surface, kS, t);
        out.fhsNs = v * out.fhsNs + w * grow(fNs, kNsEl, t);
        out.fhsEl = v * out.fhsEl + w * grow(fEl, kNsEl, t);
        out.postFireW = w;
      }
    }
  }
  out.barkHazard = barkHazardFromLoad(out.b);
  return out;
}
