// T1.3: the golden file Fs.Tests/golden/fsmath-node22.json (small: 300 calls per function).
//   node gen-golden.mjs OUT.json          step 1: inputs and Node 22's Math results (this file)
//   python3 -I cr-reference.py OUT.json   step 2: adds the correctly rounded results ("cr"), computed with mpmath at 400 bits (cr-reference.py)
// For each function: 200 calls from the solver ranges of gen-inputs.mjs (a different seed) and 100 structured calls (zeros, exact cases, the neighbours in the last
// place of the points where the algorithms change branch, powers of two, multiples of pi/2, near 1, huge and subnormal values). Only finite inputs whose
// result is not NaN (so "cr" is defined everywhere); overflow gives Infinity and underflow gives 0 in both. Numbers are stored as 16 hex digits (the bits).
import fs from 'node:fs';
import { RANGES } from './gen-inputs.mjs';

const out = process.argv[2];
function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const f64 = new Float64Array(1), u64 = new BigUint64Array(f64.buffer);
const bits = (x) => { f64[0] = x; return u64[0].toString(16).padStart(16, '0'); };
const up = (x) => { f64[0] = x; u64[0] += x >= 0 ? 1n : -1n; return f64[0]; };
const down = (x) => { f64[0] = x; u64[0] -= x >= 0 ? 1n : -1n; return f64[0]; };
const around = (x) => [down(x), x, up(x)];
const PI = Math.PI;
const multiplesOfPio2 = [1, 2, 3, 4, 5, 8, 16, 100, 1000, 1e5, 3.3e5, 1e6, 1e9, 1e15].flatMap((k) => around(k * (PI / 2)));
const huge = [1e22, 1e100, 1e300, 1.7976931348623157e308];
const tiny = [5e-324, 1e-320, 2.2250738585072014e-308, 1e-300, 1e-200, 1e-100, 1e-20, 1e-10, 2 ** -28, 2 ** -27, 2 ** -26, 2 ** -54];

const STRUCTURED = {
  exp: [0, -0, 1, -1, 0.5, 2, 10, -10, 0.34657359027997264, 0.5 * Math.LN2, 1.5 * Math.LN2, 709, 709.7, 709.78, 709.7827128933841, 709.79, 710, 1000, -700, -708, -709, -745, -745.1, -745.2, -746, -1000, ...around(Math.LN2), ...around(-Math.LN2), ...tiny, ...tiny.map((t) => -t)],
  log: [1, 2, 0.5, 10, 0.1, Math.E, 2 ** 52, 2 ** -52, 2 ** 1023, 2 ** -1022, 5e-324, 1e-310, 1.7976931348623157e308, 0.7071067810058594, 1.4142135381698608, ...around(1), ...around(Math.SQRT2), ...around(Math.SQRT1_2), 1.0000001, 0.9999999, 100, 1e6, 1e-6, 3, 7, 1e22, 1e300, 1e-300],
  log2: [1, 2, 4, 8, 0.5, 0.25, 1024, 2 ** -1022, 2 ** 1023, 5e-324, 3, 10, 0.1, 1e-310, 1.7976931348623157e308, ...around(1), ...around(2), ...around(Math.SQRT2), 1e22, 1e300, 1e-300, 1e6, 7],
  log10: [1, 10, 100, 1000, 0.1, 0.01, 1e-6, 1e6, 1e15, 1e22, 1e300, 1e-300, 2, 3, 5e-324, 1e-310, 2 ** -1022, 1.7976931348623157e308, ...around(1), ...around(10), ...around(100), ...around(1000), 0.5, 7],
  pow: [], // pairs below
  sin: [0, -0, 1, -1, PI, -PI, PI / 2, PI / 4, 3 * PI / 4, ...multiplesOfPio2, 1e-5, 2 ** -27, 2 ** -28, 0.5, 0.78, 0.7853981633974483, 1e22, 1e100, 1e300, 1.7976931348623157e308, ...tiny, ...tiny.map((t) => -t), 6, 100, -100, 1e6, 1e15],
  cos: [0, -0, 1, -1, PI, -PI, PI / 2, PI / 4, 3 * PI / 4, ...multiplesOfPio2, 1e-5, 2 ** -27, 2 ** -28, 0.5, 0.78, 0.7853981633974483, 1e22, 1e100, 1e300, 1.7976931348623157e308, ...tiny, ...tiny.map((t) => -t), 6, 100, -100, 1e6, 1e15],
  tan: [0, -0, 1, -1, 0.5, 0.6744, 0.67434, 0.7853981633974483, 1.5, 1.5707963267948966, -1.5707963267948966, PI, PI / 4, 3 * PI / 4, ...multiplesOfPio2, 1e-5, 2 ** -28, 2 ** -29, 1e22, 1e100, 1e300, ...tiny, ...tiny.map((t) => -t), 6, 100, 1e6],
  atan: [0, -0, 1, -1, 0.5, 0.4375, 0.6875, 1.1875, 2.4375, 2 ** 66, 2 ** 65, 1e10, 1e300, 1.7976931348623157e308, -1e300, 2 ** -27, 2 ** -28, 0.4, 0.5, 0.7, 1.5, 2, 3, 100, ...around(0.4375), ...around(0.6875), ...around(1.1875), ...around(2.4375), ...tiny, ...tiny.map((t) => -t)],
  atan2: [],
  acos: [0, -0, 1, -1, 0.5, -0.5, 0.25, -0.25, 0.75, -0.75, 0.9, 0.99, 0.999, -0.999, 2 ** -57, 2 ** -58, 2 ** -27, 2 ** -28, 1e-10, -1e-10, ...around(0.5), ...around(-0.5), ...around(1).filter((v) => Math.abs(v) <= 1), ...around(-1).filter((v) => Math.abs(v) <= 1), ...tiny, ...tiny.map((t) => -t), 0.975, ...around(0.975)],
  asin: [0, -0, 1, -1, 0.5, -0.5, 0.25, -0.25, 0.75, -0.75, 0.9, 0.99, 0.999, -0.999, 2 ** -27, 2 ** -28, 1e-10, -1e-10, ...around(0.5), ...around(-0.5), ...around(1).filter((v) => Math.abs(v) <= 1), ...around(-1).filter((v) => Math.abs(v) <= 1), ...tiny, ...tiny.map((t) => -t), 0.975, ...around(0.975), ...around(0.9749999999999999)],
  sinh: [0, -0, 1, -1, 0.5, 2, 10, 22, -22, 21.999999999999996, 22.000000000000004, 100, 709.78, 709.7822265625, 710, 710.4758600739439, 710.475860073944, 711, -710, 1e-10, 2 ** -28, 2 ** -29, ...tiny, ...tiny.map((t) => -t), 0.9999999999999999, 1.0000000000000002, 3, 5, -5],
  cbrt: [0, -0, 1, -1, 8, -8, 27, 64, 125, 1000, 0.001, 1e-3, 2, 3, 10, 5e-324, 1e-310, 2.2250738585072014e-308, 1.7976931348623157e308, -1.7976931348623157e308, 1e300, 1e-300, 1e22, 1e6, 1e-6, ...around(1), ...around(8), ...around(27), 0.5, 7, 100, ...tiny.map((t) => -t)],
  hypot: [],
};
// pairs
STRUCTURED.pow = [
  [2, 10], [2, 0.5], [2, -1], [10, 2], [10, -2], [10, 3], [0.5, 2], [9, 0.5], [4, 0.5], [2, 0.5], [3, 3], [-2, 3], [-2, 2], [-2, 4], [-3, 5], [-8, 1], [-1, 3], [-1, 2], [1, 5], [1, 1e300],
  [0.1, 3], [0.1, -3], [1.5, 2.5], [7, 1.5], [1e10, 0.1], [1e-10, 0.1], [1e300, 2], [1e300, 0.5], [1e-300, 2], [2, 1023], [2, 1024], [2, -1074], [2, -1075], [2, -1022], [10, 308], [10, 309], [10, -323], [10, -324],
  [0, 5], [-0, 3], [0, 0.5], [0, -1], [-0, -3], [0, 2], [2, 0], [0.5, 0], [-2, 0], [1.0000000000000002, 1e16], [0.9999999999999999, 1e16], [1.0000000000000002, -1e16], [1.0000000000000002, 1e300], [0.9999999999999999, 1e300],
  [1.0000000000000002, 2 ** 40], [0.99999999, 2 ** 31], [0.99999999, 2 ** 32], [1.5, 1e5], [1.5, -1e5], [3, 40], [3, -40], [5, 22], [5, 23], [10, 22], [10, 23], [2, 52], [2, 53], [2, 54], [2.5, 0.5], [0.25, 0.5], [1e-5, 0.5],
  [8, 1 / 3], [27, 1 / 3], [100, 0.5], [100, 1.5], [1.1, 10], [1.1, 100], [1.1, 1000], [0.9, 1000], [1.0001, 10000], [2, 0.1], [2, 1e-5], [2, -1e-5], [3.3, -2.2], [1000, 0.3333333333333333], [Math.E, 3], [Math.PI, 2],
  [2, 3], [2, 2], [5, 2], [-5, 2], [0.7, 2], [4, 1.5], [4, -0.5], [16, 0.25], [16, 0.75], [81, 0.25], [1e5, 2.5], [1e-3, -2.5], [123.456, 7.89], [0.001, 0.001], [1e3, 1e-3],
];
STRUCTURED.atan2 = [
  [1, 1], [1, -1], [-1, 1], [-1, -1], [0, 1], [0, -1], [-0, 1], [-0, -1], [1, 0], [-1, 0], [1, -0], [-1, -0], [0, 0], [-0, -0], [0, -0], [-0, 0], [1, 2], [2, 1], [1, 1e300], [1e300, 1], [1e300, 1e-300], [1e-300, 1e300], [5e-324, 1], [1, 5e-324],
  [1, 3], [3, 1], [-1, -3], [1e10, 1], [1, 1e10], [1, 1e-10], [1e-10, 1], [-5, 5], [5, -5], [2 ** 60, 1], [1, 2 ** 60], [1, 2 ** 61], [2 ** 61, 1], [-1, 2 ** 61], [1, -(2 ** 61)], [1, -(2 ** 59)], [1e-5, -1e5], [1e5, -1e-5], [-1e-5, -1e5],
  [0.5, 0.25], [0.25, 0.5], [0.4375, 1], [0.6875, 1], [1.1875, 1], [2.4375, 1], [100, 1], [1, 100], [-100, 3], [3, -100], [1.7976931348623157e308, 1.7976931348623157e308], [1.7976931348623157e308, 1], [1, 1.7976931348623157e308],
  [1, 1.0000000000000002], [1.0000000000000002, 1], [0.9999999999999999, 1], [1, 0.9999999999999999], [10, 3], [10, -3], [-10, 3], [-10, -3], [0.1, 0.2], [0.7, 0.3], [123.456, 7.89],
];
STRUCTURED.hypot = [
  [3, 4], [4, 3], [5, 12], [8, 15], [1, 1], [1, 0], [0, 1], [0, 0], [-0, -0], [-3, 4], [3, -4], [-3, -4], [1e300, 1e300], [1e308, 1e308], [1.7976931348623157e308, 1.7976931348623157e308], [1e-300, 1e-300], [5e-324, 5e-324], [5e-324, 0], [1e-320, 1e-320],
  [1e150, 1e150], [1e200, 1], [1, 1e200], [1e-200, 1], [1, 1e-200], [0.1, 0.2], [0.3, 0.4], [1e10, 1e-10], [2, 3], [1.5, 2.5], [123.456, 789.012], [1e-5, 1e5], [7, 24], [20, 21], [1e3, 1e-3], [1, 2 ** -27], [1, 2 ** -53], [1, 2 ** -54], [1, 1e-16],
  [3, 4.000000000000001], [3.0000000000000004, 4], [0.5, 0.5], [1.0000000000000002, 1], [2.2250738585072014e-308, 2.2250738585072014e-308], [1e-310, 1e-310], [1e10, 1e10], [16, 63], [65, 72], [0.6, 0.8], [9, 40], [11, 60],
];

const N_RANDOM = 200;
const result = { generatedBy: 'Fs.Bench/fsmath/gen-golden.mjs', node: process.version, v8: process.versions.v8, note: 'x: input bits (two per call, interleaved, for pow, atan2 and hypot); node22: Math result bits under Node 22 / V8 12.4; cr: correctly rounded result bits (mpmath, 400 bits; cr-reference.py)', functions: {} };
let seed = 1000;
for (const [fn, gen] of Object.entries(RANGES)) {
  const r = mulberry32(0x5eed0000 + seed++);
  const calls = [];
  const arity = Array.isArray(gen(mulberry32(1))) ? 2 : 1;
  for (let i = 0; i < N_RANDOM; i++) calls.push(gen(r));
  for (const s of STRUCTURED[fn]) calls.push(s);
  // keep a function-appropriate count, drop calls whose Node result is NaN (cr undefined) and duplicates
  const seen = new Set();
  const keep = [];
  for (const c of calls) {
    const a = arity === 1 ? [c] : c;
    if (!a.every(Number.isFinite)) continue;
    const key = a.map(bits).join(',');
    if (seen.has(key)) continue;
    const y = Math[fn](...a);
    if (Number.isNaN(y)) continue;
    seen.add(key);
    keep.push([a, y]);
  }
  result.functions[fn] = { arity, calls: keep.length, x: keep.flatMap(([a]) => a.map(bits)), node22: keep.map(([, y]) => bits(y)) };
}
fs.writeFileSync(out, JSON.stringify(result));
console.log(Object.entries(result.functions).map(([f, v]) => `${f}:${v.calls}`).join(' '));
