// Inputs and V8 results for every transcendental the solver uses (same generator and ranges as the N-O verifier's r3_gen.mjs, N=200k, plus sinh/log2/log10/hypot/asin/acos).
import fs from 'fs';
const out = process.argv[2]; const N = 200000;
let s = 12345; const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), s | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const specs = {
  exp: [() => -30 + 35 * rnd(), (x) => Math.exp(x[0]), 1],
  log: [() => Math.exp(-14 + 21 * rnd()), (x) => Math.log(x[0]), 1],
  sin: [() => -50 + 100 * rnd(), (x) => Math.sin(x[0]), 1],
  cos: [() => -50 + 100 * rnd(), (x) => Math.cos(x[0]), 1],
  tan: [() => -1.5 + 3 * rnd(), (x) => Math.tan(x[0]), 1],
  atan: [() => -100 + 200 * rnd(), (x) => Math.atan(x[0]), 1],
  cbrt: [() => 1e-3 + 1e3 * rnd(), (x) => Math.cbrt(x[0]), 1],
  pow: [() => [0.01 + 100 * rnd(), -3 + 8 * rnd()], (x) => Math.pow(x[0], x[1]), 2],
  atan2: [() => [-10 + 20 * rnd(), -10 + 20 * rnd()], (x) => Math.atan2(x[0], x[1]), 2],
  asin: [() => -1 + 2 * rnd(), (x) => Math.asin(x[0]), 1],
  acos: [() => -1 + 2 * rnd(), (x) => Math.acos(x[0]), 1],
  sinh: [() => -5 + 10 * rnd(), (x) => Math.sinh(x[0]), 1],
  log2: [() => Math.exp(-14 + 21 * rnd()), (x) => Math.log2(x[0]), 1],
  log10: [() => Math.exp(-14 + 21 * rnd()), (x) => Math.log10(x[0]), 1],
  hypot: [() => [-1000 + 2000 * rnd(), -1000 + 2000 * rnd()], (x) => Math.hypot(x[0], x[1]), 2],
  sqrt: [() => 1e-3 + 1e3 * rnd(), (x) => Math.sqrt(x[0]), 1],
};
for (const [name, [gen, f, arity]] of Object.entries(specs)) {
  const xs = new Float64Array(N * arity), ys = new Float64Array(N);
  for (let i = 0; i < N; i++) { const g = gen(); const a = arity === 1 ? [g] : g; for (let k = 0; k < arity; k++) xs[i * arity + k] = a[k]; ys[i] = f(a); }
  fs.writeFileSync(`${out}/${name}.in`, Buffer.from(xs.buffer)); fs.writeFileSync(`${out}/${name}.v8`, Buffer.from(ys.buffer));
}
console.log('node', process.version, 'v8', process.versions.v8, 'N', N);
