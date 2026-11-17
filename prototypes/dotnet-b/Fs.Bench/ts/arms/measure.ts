/**
 * T1.5: the timing loop of `Fs.Bench/ts/air/bench.ts` and `fast/bench.ts` (one operation per sample, a warm-up of at least `warmMs` and 30 operations first), with one addition for
 * browsers: `minSampleMs` > 0 times a BATCH of `per` operations per sample (per chosen after the warm-up so that a sample lasts at least `minSampleMs`) and reports the time per operation,
 * because a Chromium worker's `performance.now()` has 0.1 ms resolution (5 us when cross-origin isolated), too coarse for operations of 20 to 200 us.
 */
export interface OpStats {
  kernel: string;
  n: number;
  per: number;
  warmup: number;
  medianMs: number;
  meanMs: number;
  stdDevMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
}

const pct = (s: number[], p: number): number => s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]!;

export function measureOp(name: string, op: () => unknown, samples: number, warmMs: number, minSampleMs: number): OpStats {
  let warm = 0;
  const t0 = performance.now();
  while (warm < 30 || performance.now() - t0 < warmMs) {
    op();
    warm++;
  }
  let per = 1;
  if (minSampleMs > 0) {
    // calibrate: the median of 15 single operations is too coarse in Chromium, so time a growing batch
    let probe = 1;
    for (;;) {
      const a = performance.now();
      for (let i = 0; i < probe; i++) op();
      const dt = performance.now() - a;
      if (dt >= Math.max(minSampleMs, 1)) {
        per = Math.max(1, Math.ceil((probe * minSampleMs) / dt));
        break;
      }
      probe *= 2;
    }
  }
  const ms: number[] = [];
  for (let i = 0; i < samples; i++) {
    const a = performance.now();
    for (let j = 0; j < per; j++) op();
    ms.push((performance.now() - a) / per);
  }
  const s = [...ms].sort((x, y) => x - y);
  const mean = ms.reduce((x, y) => x + y, 0) / ms.length;
  const sd = Math.sqrt(ms.reduce((x, y) => x + (y - mean) * (y - mean), 0) / Math.max(1, ms.length - 1));
  return { kernel: name, n: samples, per, warmup: warm, medianMs: pct(s, 0.5), meanMs: mean, stdDevMs: sd, p95Ms: pct(s, 0.95), minMs: s[0]!, maxMs: s[s.length - 1]! };
}

export function measureAll(ops: Record<string, () => unknown>, samples: number, warmMs: number, minSampleMs: number, only?: string[]): OpStats[] {
  const out: OpStats[] = [];
  for (const [name, op] of Object.entries(ops)) {
    if (only && !only.includes(name)) continue;
    out.push(measureOp(name, op, samples, warmMs, minSampleMs));
  }
  return out;
}
