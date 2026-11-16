// T1.3: the input set "stress": the whole domain of each function, not only what the solver uses. It exists to check that the port is right everywhere (huge
// arguments of sin, subnormals, the points where fdlibm changes branch, infinities and NaN), not to size the solver's mismatch rate. N calls per function:
//   25 % random 64-bit patterns (any double, NaN and infinities included), 25 % a wide natural range of the function, 25 % within a few units in the last place of
//   points where the algorithms change branch (multiples of pi/4, plus and minus 1, 0.5, powers of two, ln 2 multiples, 22, 56 ln 2, ...), 25 % subnormal and tiny.
//   node gen-stress.mjs OUT [N=200000]
import fs from 'node:fs';
import crypto from 'node:crypto';

const OUT = process.argv[2];
const N = Number(process.argv[3] ?? 200_000);
function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const f64 = new Float64Array(1), u64 = new BigUint64Array(f64.buffer);
const nudge = (x, k) => { f64[0] = x; u64[0] = BigInt.asUintN(64, u64[0] + BigInt(x >= 0 ? k : -k)); return f64[0]; };
const randomBits = (r) => { u64[0] = (BigInt((r() * 4294967296) >>> 0) << 32n) | BigInt((r() * 4294967296) >>> 0); return f64[0]; };
const lu = (r, lo, hi) => Math.exp(Math.log(lo) + (Math.log(hi) - Math.log(lo)) * r());
const un = (r, lo, hi) => lo + (hi - lo) * r();
const sgn = (r) => (r() < 0.5 ? -1 : 1);
const PI = Math.PI;

// per function: [wide natural range, branch points]
const SPEC = {
  exp: [(r) => un(r, -750, 715), [0, 0.5 * Math.LN2, 1.5 * Math.LN2, Math.LN2, 709.78, -745.13, 1, 2 ** -28, -(2 ** -28)]],
  log: [(r) => lu(r, 1e-310, 1e300), [1, 2, 0.5, Math.SQRT2, Math.SQRT1_2, 2 ** -1022, 1 + 2 ** -20, 1 - 2 ** -20, 10]],
  pow: [(r) => [lu(r, 1e-30, 1e30), un(r, -50, 50)], [[2, 10], [10, 2], [0.5, 2], [1, 3], [1.0000000001, 1e10], [3, 0.5], [0.5, 0.5], [2, 1023], [2, -1074]]],
  sin: [(r) => sgn(r) * lu(r, 1e-8, 1e22), [0, PI / 4, PI / 2, PI, 3 * PI / 2, 2 * PI, 2 ** 19 * PI / 2, 1e5, 1e6, 1e9, 1e15, 1e22]],
  cos: [(r) => sgn(r) * lu(r, 1e-8, 1e22), [0, PI / 4, PI / 2, PI, 3 * PI / 2, 2 * PI, 2 ** 19 * PI / 2, 1e5, 1e6, 1e9, 1e15, 1e22]],
  tan: [(r) => sgn(r) * lu(r, 1e-8, 1e22), [0, PI / 4, PI / 2, PI, 3 * PI / 4, 0.6744, 2 ** -28, 1e6]],
  atan: [(r) => sgn(r) * lu(r, 1e-30, 1e30), [0, 0.4375, 0.6875, 1.1875, 2.4375, 1, 2 ** 66, 2 ** -27]],
  atan2: [(r) => [sgn(r) * lu(r, 1e-30, 1e30), sgn(r) * lu(r, 1e-30, 1e30)], [[1, 1], [0, 1], [1, 0], [2 ** 60, 1], [1, 2 ** 60], [1, -1]]],
  acos: [(r) => un(r, -1.0000001, 1.0000001), [0, 0.5, -0.5, 1, -1, 0.975, 2 ** -57]],
  asin: [(r) => un(r, -1.0000001, 1.0000001), [0, 0.5, -0.5, 1, -1, 0.975, 2 ** -27]],
  sinh: [(r) => un(r, -715, 715), [0, 1, 22, 709.78, 710.4758600739439, 2 ** -28]],
  cbrt: [(r) => sgn(r) * lu(r, 1e-310, 1e308), [0, 1, 8, 27, 2 ** -1022, 2 ** 54]],
  log2: [(r) => lu(r, 1e-310, 1e300), [1, 2, 0.5, Math.SQRT2, 2 ** -1022]],
  log10: [(r) => lu(r, 1e-310, 1e300), [1, 10, 0.1, 100, 1e22, 2 ** -1022]],
  hypot: [(r) => [sgn(r) * lu(r, 1e-310, 1e308), sgn(r) * lu(r, 1e-310, 1e308)], [[3, 4], [0, 1], [1e308, 1e308], [1e-310, 1e-310], [1, 2 ** -53]]],
};
const TINY = [5e-324, 2.2250738585072014e-308, 1e-310, 1e-300, 2 ** -54, 2 ** -28, 2 ** -27];

if (!OUT) { console.error('usage: node gen-stress.mjs OUT [N]'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const files = {};
let seed = 77;
for (const [fn, [wide, points]] of Object.entries(SPEC)) {
  const r = mulberry32(0xbeef0000 + seed++);
  const two = Array.isArray(wide(mulberry32(1)));
  const draw = (kind) => {
    const one = (k) => {
      if (k === 0) return randomBits(r);
      if (k === 1) return wide(r);
      if (k === 2) { const p = points[Math.floor(r() * points.length)]; return nudge(Array.isArray(p) ? p[0] : p, Math.floor(r() * 7) - 3); }
      return (r() < 0.5 ? 1 : -1) * TINY[Math.floor(r() * TINY.length)] * (1 + Math.floor(r() * 4));
    };
    if (!two) return one(kind);
    // two arguments: the pair comes whole from the wide range, or each argument is drawn on its own
    if (kind === 1) return wide(r);
    if (kind === 2) { const p = points[Math.floor(r() * points.length)]; return [nudge(p[0], Math.floor(r() * 5) - 2), nudge(p[1], Math.floor(r() * 5) - 2)]; }
    return [one(kind), one(r() < 0.5 ? 1 : kind)];
  };
  const ar = two ? 2 : 1;
  const buf = new Float64Array(N * ar);
  for (let i = 0; i < N; i++) {
    const v = draw(i % 4);
    if (two) { buf[2 * i] = v[0]; buf[2 * i + 1] = v[1]; } else buf[i] = v;
  }
  const bytes = Buffer.from(buf.buffer);
  fs.writeFileSync(`${OUT}/${fn}.in`, bytes);
  files[fn] = { file: `${fn}.in`, calls: N, arity: ar, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}
fs.writeFileSync(`${OUT}/inputs.json`, JSON.stringify({ node: process.version, generator: 'mulberry32', n: N, files }, null, 1));
console.log(`wrote ${Object.keys(files).length} stress input files, ${N} calls each, to ${OUT}`);
