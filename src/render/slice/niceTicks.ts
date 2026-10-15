/**
 * Axis ticks for the side view (pure; plan 8.5): the multiples of 1, 2 or 5 times a power of ten that fall inside the range,
 * the step chosen to give about `target` ticks. A 600 to 3000 m height axis gets 500 m steps (1000, 1500 ... 3000) and so does
 * a 0 to 1500 m one. Labels in km or m are the panel's (ui/format.ts `formatDistance`).
 */

const MANTISSAS = [1, 2, 5] as const;

/** The multiples of `step` in [lo, hi] (a little slack for rounding), as clean decimals (0.1 x 3 is 0.3, not 0.30000000000000004). */
function multiples(lo: number, hi: number, step: number): number[] {
  const slack = step * 1e-9;
  const first = Math.ceil((lo - slack) / step);
  const last = Math.floor((hi + slack) / step);
  const out: number[] = [];
  for (let k = first; k <= last; k++) out.push(Number((k * step).toPrecision(12)) + 0); // + 0 turns -0 into 0
  return out;
}

/**
 * Ticks for an axis from `lo` to `hi`: `values` ascend, are multiples of `step` and lie in [lo, hi]; `step` is 1, 2 or 5 times a
 * power of ten, whichever gives a tick count closest to `target` (default 5; a tie takes the larger step). For hi > lo the list
 * is never empty (a step that would put no multiple inside is never chosen). A range that is empty, reversed or not finite
 * gives `{ values: [lo], step: 1 }`.
 */
export function niceTicks(lo: number, hi: number, target = 5): { values: number[]; step: number } {
  if (!(hi > lo) || !Number.isFinite(lo) || !Number.isFinite(hi)) return { values: [lo], step: 1 };
  const want = Math.max(1, Number.isFinite(target) ? target : 5);
  const raw = (hi - lo) / want;
  const e = Math.floor(Math.log10(raw));
  let best: { values: number[]; step: number } | null = null;
  let bestErr = Infinity;
  for (let p = e - 1; p <= e + 1; p++) {
    for (const m of MANTISSAS) {
      const step = m * 10 ** p;
      const values = multiples(lo, hi, step);
      if (values.length === 0) continue;
      const err = Math.abs(values.length - want);
      // Candidates run from the finest step to the coarsest, so `<=` lets the larger step win a tie.
      if (err <= bestErr) {
        best = { values, step };
        bestErr = err;
      }
    }
  }
  // A step of a tenth of `raw` or finer always has a multiple inside, so `best` is set; this keeps the types honest.
  return best ?? { values: [lo], step: raw };
}
