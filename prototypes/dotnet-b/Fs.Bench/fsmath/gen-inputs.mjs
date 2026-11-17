// T1.3: the fixed inputs of the FsMath comparison. 10^6 calls per function, drawn with a seeded generator from ranges taken from the arguments the solver
// really passes (Fs.Bench/fsmath/record-args.mjs; the ranges and the evidence are in reports/1-fsmath.md). Raw little-endian float64 (two per call, interleaved,
// for pow, atan2 and hypot) in OUT/NAME.in, and OUT/inputs.json with the SHA-256 of every file, so the run is reproducible bit for bit:
//   node gen-inputs.mjs OUT [N=1000000]
// The generator is mulberry32 (src/core/rng.ts) and only + - * / and the exact integer operations on its state are used to draw the uniform numbers, but
// several ranges are log-uniform (exp(u)), and Math.exp is not the same in every engine: the files are generated once, under Node 22, and then only read.
import fs from 'node:fs';
import crypto from 'node:crypto';

const OUT = process.argv[2];
const N = Number(process.argv[3] ?? 1_000_000);

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// log-uniform in [lo, hi] and uniform in [lo, hi]
const lu = (r, lo, hi) => Math.exp(Math.log(lo) + (Math.log(hi) - Math.log(lo)) * r());
const un = (r, lo, hi) => lo + (hi - lo) * r();
const sgn = (r) => (r() < 0.5 ? -1 : 1);

// RANGES: one drawing function per function name; each returns the argument(s) of one call. The ranges come from the arguments the solver really passes
// (record-args.mjs on katoomba3-fast to 1800 s, katoomba6-fast to 900 s and katoomba3-standard to 300 s, seed 13: 10.1 million calls; summary in
// reports/1-fsmath.md), widened a little so the whole used range is covered, plus the shares of exact zeros the solver produces (hypot and atan get zero
// components often). Where the three runs made no call (log2, log10, sinh; the plan's counts: one site each) the range is a guess and the report says so.
const mix = (r, p, a, b) => (r() < p ? a() : b()); // with probability p draw from a, else from b
export const RANGES = {
  // exp: observed -100..35, half of the calls within 2^-9..2^4 in magnitude (the Arrhenius, moisture and decay terms)
  exp: (r) => mix(r, 0.8, () => un(r, -8, 4), () => un(r, -100, 36)),
  // log: observed 4.6e-5..1.3e5
  log: (r) => lu(r, 1e-5, 2e5),
  // pow: observed base 0..1.8e5 (almost all 2^-5..2^6), exponent -24..25 (almost all 2^-2..2^3; the `**` sites with exponents other than 2 and Math.pow)
  pow: (r) => [lu(r, 1e-3, 2e5), mix(r, 0.7, () => un(r, -4, 4), () => un(r, -24, 25))],
  // sin: observed -6.6..508 (an angle times a distance in some uses), mostly within 2^-3..2^8
  sin: (r) => mix(r, 0.5, () => un(r, -10, 10), () => un(r, -520, 520)),
  // cos: observed -8.6..170
  cos: (r) => mix(r, 0.5, () => un(r, -10, 10), () => un(r, -200, 200)),
  // tan: observed -0.57..1.39 (slope angles); the solver caps slopes below the vertical
  tan: (r) => un(r, -1.5, 1.5),
  // atan: observed -0.98..8.65, 8 % exact zeros
  atan: (r) => (r() < 0.08 ? 0 : sgn(r) * lu(r, 1e-3, 20)),
  // atan2 (y, x): observed y -989..41, x -39..831, about 0.2 % zeros
  atan2: (r) => [sgn(r) * lu(r, 1e-3, 1e3), sgn(r) * lu(r, 1e-3, 1e3)],
  // acos: observed -0.999997..1 (cosines)
  acos: (r) => un(r, -1, 1),
  // asin: observed only -0.398..-0.396 (one site, nearly constant): the whole domain is drawn instead
  asin: (r) => un(r, -1, 1),
  // sinh: no call observed in the three runs; the single use in the source is a profile term of small argument
  sinh: (r) => un(r, -5, 5),
  // cbrt: observed 0.038..1.2e8
  cbrt: (r) => lu(r, 1e-2, 1e9),
  // log2, log10: no call observed; positive over the same decades as log
  log2: (r) => lu(r, 1e-5, 2e5),
  log10: (r) => lu(r, 1e-5, 2e5),
  // hypot: observed components -9446..8778, 22 % of the calls have a zero component (a vector along one axis)
  hypot: (r) => [r() < 0.2 ? 0 : sgn(r) * lu(r, 1e-3, 1e4), r() < 0.2 ? 0 : sgn(r) * lu(r, 1e-3, 1e4)],
};

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!OUT) { console.error('usage: node gen-inputs.mjs OUT [N]'); process.exit(2); }
  fs.mkdirSync(OUT, { recursive: true });
  const files = {};
  let seed = 1;
  for (const [name, gen] of Object.entries(RANGES)) {
    const r = mulberry32(0x1f2e3d4c + seed++);
    const first = gen(r);
    const arity = Array.isArray(first) ? first.length : 1;
    const buf = new Float64Array(N * arity);
    const r2 = mulberry32(0x1f2e3d4c + seed - 1);
    for (let i = 0; i < N; i++) {
      const v = gen(r2);
      if (arity === 1) buf[i] = v; else { buf[2 * i] = v[0]; buf[2 * i + 1] = v[1]; }
    }
    const bytes = Buffer.from(buf.buffer);
    fs.writeFileSync(`${OUT}/${name}.in`, bytes);
    files[name] = { file: `${name}.in`, calls: N, arity, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  }
  fs.writeFileSync(`${OUT}/inputs.json`, JSON.stringify({ node: process.version, v8: process.versions.v8, generator: 'mulberry32', n: N, files }, null, 1));
  console.log(`wrote ${Object.keys(files).length} input files, ${N} calls each, to ${OUT}`);
}
