// Statistical self-test of noise.ts: per-function mismatch rate and ulp-size mix against the spec, the exact-case guards, determinism, restore().
import { installNoise, NOISE_SPECS, NOISE_FUNCTIONS } from '../noise';

const f64 = new Float64Array(1);
const i64 = new BigInt64Array(f64.buffer);
const ulpDist = (a: number, b: number): number => {
  f64[0] = a;
  const x = i64[0]!;
  f64[0] = b;
  return Number(x > i64[0]! ? x - i64[0]! : i64[0]! - x);
};
const clean: Record<string, (...a: number[]) => number> = {};
const M = Math as unknown as Record<string, (...a: number[]) => number>;
for (const n of NOISE_FUNCTIONS) clean[n] = M[n]!;

let s = 7;
const rnd = (): number => {
  s = (s + 0x6d2b79f5) >>> 0;
  let t = Math.imul(s ^ (s >>> 15), s | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const args: Record<string, () => number[]> = {
  exp: () => [-30 + 35 * rnd()], log: () => [Math.exp(-14 + 21 * rnd())], sin: () => [-50 + 100 * rnd()], cos: () => [-50 + 100 * rnd()], tan: () => [-1.5 + 3 * rnd()],
  atan: () => [-100 + 200 * rnd()], cbrt: () => [1e-3 + 1e3 * rnd()], pow: () => [0.01 + 100 * rnd(), -3 + 8 * rnd()], atan2: () => [-10 + 20 * rnd(), -10 + 20 * rnd()],
  asin: () => [-1 + 2 * rnd()], acos: () => [-1 + 2 * rnd()], sinh: () => [-5 + 10 * rnd()], log2: () => [Math.exp(-14 + 21 * rnd())], log10: () => [Math.exp(-14 + 21 * rnd())],
  hypot: () => [-1000 + 2000 * rnd(), -1000 + 2000 * rnd()],
};
const N = 300000;
const run = (seed: number): { rows: string[]; sig: number } => {
  const h = installNoise(seed);
  const rows: string[] = [];
  let sig = 0;
  for (const n of NOISE_FUNCTIONS) {
    s = 7;
    let diff = 0;
    const hist: Record<number, number> = {};
    for (let i = 0; i < N; i++) {
      const a = args[n]!();
      const v = M[n]!(...a);
      sig = (Math.imul(sig, 31) + (v === clean[n]!(...a) ? 0 : 1)) | 0;
      const d = ulpDist(v, clean[n]!(...a));
      if (d) {
        diff++;
        hist[d] = (hist[d] ?? 0) + 1;
      }
    }
    const sp = NOISE_SPECS[n]!;
    rows.push(`${n.padEnd(6)} measured rate ${(100 * diff / N).toFixed(2)} % (spec ${(100 * sp.rate).toFixed(2)} %), ulp sizes ${JSON.stringify(hist)}`);
  }
  h.restore();
  return { rows, sig };
};
const a = run(5);
console.log(a.rows.join('\n'));
const b = run(5);
const c = run(6);
console.log('same seed, same pattern:', a.sig === b.sig, '; other seed differs:', a.sig !== c.sig);
// restore
console.log('restored:', NOISE_FUNCTIONS.every((n) => M[n] === clean[n]));
// exact-case guards
const h = installNoise(1, 1);
let bad = 0;
for (let i = 0; i < 100000; i++) {
  if (Math.exp(0) !== 1 || Math.cos(0) !== 1 || Math.sin(0) !== 0 || Math.log(1) !== 0 || Math.pow(7, 2) !== 49 || Math.pow(3, 1) !== 3 || Math.pow(2, 10) !== 1024 || Math.hypot(3, 4) !== 5 || Math.hypot(0, 7) !== 7 || Math.atan2(0, 1) !== 0 || Math.atan2(1, 1) !== clean.atan2!(1, 1) || Math.cbrt(27) !== 3 || Math.log2(8) !== 3 || Math.log10(1000) !== 3) bad++;
}
console.log('exact cases moved in', bad, 'of 100000 rounds; hypot3 ok:', Math.hypot(1, 2, 2) === 3 || 'moved');
h.restore();
