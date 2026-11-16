// T1.3: the special-value table: every function at every combination (every pair for pow, atan2 and hypot) of 27 special values (+-0, +-1, +-0.5, +-2, +-3, 10, 0.1,
// +-Infinity, NaN, +-5e-324, +-1e-300, +-1e300, +-MaxValue, pi, pi/2, 1e22), with the bits of Node 22's (V8 12.4) result. Fs.Tests checks both implementations against it,
// which is where JavaScript's own rules (pow(1, Infinity) is NaN, pow(NaN, 0) is 1, atan2's quadrant table, hypot's Infinity-beats-NaN) are tested against the real engine.
//   node gen-specials.mjs OUT.json
import fs from 'node:fs';

const f64 = new Float64Array(1), u64 = new BigUint64Array(f64.buffer);
const bits = (x) => { f64[0] = x; return u64[0].toString(16).padStart(16, '0'); };
const V = [0, -0, 1, -1, 0.5, -0.5, 2, -2, 3, -3, 10, 0.1, Infinity, -Infinity, NaN, 5e-324, -5e-324, 1e-300, -1e-300, 1e300, -1e300, 1.7976931348623157e308, -1.7976931348623157e308, Math.PI, Math.PI / 2, 1e22, -1e22];
const ONE = ['exp', 'log', 'sin', 'cos', 'tan', 'atan', 'acos', 'asin', 'sinh', 'cbrt', 'log2', 'log10'];
const TWO = ['pow', 'atan2', 'hypot'];
const out = { generatedBy: 'Fs.Bench/fsmath/gen-specials.mjs', node: process.version, v8: process.versions.v8, values: V.map(bits), functions: {} };
// the call order is implied: one argument, call i is values[i]; two arguments, call i is (values[floor(i / n)], values[i % n]) with n = values.length
for (const fn of ONE) out.functions[fn] = { arity: 1, node22: V.map((a) => bits(Math[fn](a))) };
for (const fn of TWO) {
  const y = [];
  for (const a of V) for (const b of V) y.push(bits(Math[fn](a, b)));
  out.functions[fn] = { arity: 2, node22: y };
}
fs.writeFileSync(process.argv[2], JSON.stringify(out));
console.log(Object.entries(out.functions).map(([f, v]) => `${f}:${v.node22.length}`).join(' '));
