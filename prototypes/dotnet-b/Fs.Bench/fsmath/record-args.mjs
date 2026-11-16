// T1.3: records the arguments the solver really passes to the transcendental Math functions.
// Preload it into a run of the solver's counting build (ts-export/profile/run.mjs build --count), for example:
//   FS_REPO_ROOT=$PWD OUT=$SCRATCH/args node --import ./prototypes/dotnet-b/Fs.Bench/fsmath/record-args.mjs BUILD/profile.mjs katoomba3-fast --seed 13 --to 1800
// It wraps Math.exp, log, pow, sin, cos, tan, atan, atan2, acos, asin, sinh, cbrt, log2, log10, hypot (two-argument calls) and the `**` operator (the build
// rewrites `a ** b` to globalThis.__fsStarStar(a, b); calls with exponent 2 are counted only, they are x * x in the port). It keeps the first CAP calls of each
// function (raw little-endian float64, two per call for two-argument functions) in OUT/NAME.rec and, over all calls, the count, the minimum, the maximum and a
// histogram of floor(log2 |arg|) per argument, in OUT/stats.json. Nothing of the solver is changed: every wrapper calls the original.
import fs from 'node:fs';
const realLog2 = Math.log2; // kept before the wrappers go in: note() must not record itself

const OUT = process.env.OUT ?? 'args-out';
const CAP = Number(process.env.CAP ?? 2_000_000);
const FNS = ['exp', 'log', 'pow', 'sin', 'cos', 'tan', 'atan', 'atan2', 'acos', 'asin', 'sinh', 'cbrt', 'log2', 'log10', 'hypot'];
const ARITY = { pow: 2, atan2: 2, hypot: 2 };
const rec = {};
const mk = (name) => {
  const arity = ARITY[name] ?? 1;
  return (rec[name] = {
    arity, buf: new Float64Array(CAP * arity), n: 0, total: 0, threeArg: 0,
    min: [Infinity, Infinity], max: [-Infinity, -Infinity], nan: 0, zero: [0, 0], neg: [0, 0], inf: 0,
    hist: [new Map(), new Map()], // exponent bucket -> count, per argument
  });
};
for (const f of [...FNS, 'pow2']) mk(f);

function note(r, k, v) {
  if (v < r.min[k]) r.min[k] = v;
  if (v > r.max[k]) r.max[k] = v;
  if (v === 0) r.zero[k]++;
  else if (v < 0) r.neg[k]++;
  if (!Number.isFinite(v)) { if (Number.isNaN(v)) r.nan++; else r.inf++; }
  const e = v === 0 || !Number.isFinite(v) ? -9999 : Math.floor(realLog2(Math.abs(v)));
  r.hist[k].set(e, (r.hist[k].get(e) ?? 0) + 1);
}

for (const name of FNS) {
  const orig = Math[name];
  const r = rec[name];
  const w = r.arity === 1
    ? function (a) {
        r.total++;
        note(r, 0, a);
        if (r.n < CAP) r.buf[r.n++] = a;
        return orig(a);
      }
    : function (a, b, c) {
        if (c !== undefined) { r.threeArg++; return orig(a, b, c); }
        r.total++;
        note(r, 0, a); note(r, 1, b);
        if (r.n < CAP) { r.buf[2 * r.n] = a; r.buf[2 * r.n + 1] = b; r.n++; }
        return orig(a, b);
      };
  Object.defineProperty(w, 'name', { value: name });
  Math[name] = w;
}

// `**`: the counting build calls globalThis.__fsStarStar (defined by profile/mathwrap.ts when it loads). Intercept the assignment and wrap it.
let inner;
Object.defineProperty(globalThis, '__fsStarStar', {
  configurable: true,
  get() { return wrapped; },
  set(f) { inner = f; },
});
function wrapped(a, b) {
  if (b === 2) { rec.pow2.total++; return inner(a, b); }
  const r = rec.pow;
  r.total++; r.starStar = (r.starStar ?? 0) + 1;
  note(r, 0, a); note(r, 1, b);
  if (r.n < CAP) { r.buf[2 * r.n] = a; r.buf[2 * r.n + 1] = b; r.n++; }
  return inner(a, b);
}

process.on('exit', () => {
  fs.mkdirSync(OUT, { recursive: true });
  const stats = {};
  for (const [name, r] of Object.entries(rec)) {
    if (name === 'pow2') { stats[name] = { total: r.total }; continue; }
    if (r.total === 0) { stats[name] = { total: 0 }; continue; }
    fs.writeFileSync(`${OUT}/${name}.rec`, Buffer.from(r.buf.buffer, 0, r.n * r.arity * 8));
    stats[name] = {
      total: r.total, kept: r.n, arity: r.arity, threeArg: r.threeArg || undefined, starStar: r.starStar,
      min: r.min.slice(0, r.arity), max: r.max.slice(0, r.arity), zero: r.zero.slice(0, r.arity), negative: r.neg.slice(0, r.arity), nan: r.nan, inf: r.inf,
      log2Hist: r.hist.slice(0, r.arity).map((m) => Object.fromEntries([...m.entries()].sort((a, b) => a[0] - b[0]))),
    };
  }
  fs.writeFileSync(`${OUT}/stats.json`, JSON.stringify({ node: process.version, argv: process.argv.slice(2), stats }));
});
