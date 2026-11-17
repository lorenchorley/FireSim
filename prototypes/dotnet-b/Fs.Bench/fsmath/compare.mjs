// T1.3: compares result files bit for bit.
//   node compare.mjs DIR REF CAND[,CAND...] [FNS] [--json OUT.json] [--examples K]
// DIR holds {fn}.{tag}.f64 files (raw float64 results of the same input file). For each function and candidate: the number of calls whose result bits differ
// from REF's (two NaNs count as equal: the sign and payload of a NaN are not specified, hashes canonicalise them), the largest distance in units in the last
// place (the distance of the two results as ordered integers; a NaN against a number counts as infinite), the histogram of distances (1, 2, 3 to 4, 5 and more),
// and the first K mismatching call indexes. A missing file is reported as "missing" and skipped.
import fs from 'node:fs';

const FNS = ['exp', 'log', 'pow', 'sin', 'cos', 'tan', 'atan', 'atan2', 'acos', 'asin', 'sinh', 'cbrt', 'log2', 'log10', 'hypot'];
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const jsonOut = flag('--json');
const K = Number(flag('--examples', 5));
const [dir, ref, cands, fnArg] = args;
const fns = fnArg ? fnArg.split(',') : FNS;

function load(p) { const b = fs.readFileSync(p); return new Uint32Array(b.buffer, b.byteOffset, b.byteLength / 4); }
const isNaNBits = (hi, lo) => (hi & 0x7ff00000) === 0x7ff00000 && ((hi & 0x000fffff) | lo) !== 0;
const ord = (hi, lo) => { const v = (BigInt(hi >>> 0) << 32n) | BigInt(lo >>> 0); return v >> 63n ? -(v & 0x7fffffffffffffffn) : v; };

export function compare(a, b) {
  const n = a.length / 2;
  let mismatches = 0, maxUlp = 0n, nanVsNumber = 0;
  const hist = { 1: 0, 2: 0, '3-4': 0, '5+': 0, nan: 0 };
  const examples = [];
  for (let i = 0; i < n; i++) {
    const ahi = a[2 * i + 1], alo = a[2 * i], bhi = b[2 * i + 1], blo = b[2 * i];
    if (ahi === bhi && alo === blo) continue;
    const an = isNaNBits(ahi, alo), bn = isNaNBits(bhi, blo);
    if (an && bn) continue;
    mismatches++;
    let u;
    if (an || bn) { nanVsNumber++; hist.nan++; u = -1n; }
    else {
      u = ord(ahi, alo) - ord(bhi, blo); if (u < 0n) u = -u;
      if (u > maxUlp) maxUlp = u;
      if (u === 1n) hist[1]++; else if (u === 2n) hist[2]++; else if (u <= 4n) hist['3-4']++; else hist['5+']++;
    }
    if (examples.length < K) examples.push({ i, ref: `${ahi.toString(16).padStart(8, '0')}${alo.toString(16).padStart(8, '0')}`, cand: `${bhi.toString(16).padStart(8, '0')}${blo.toString(16).padStart(8, '0')}`, ulp: u < 0n ? 'nan' : Number(u) });
  }
  return { calls: n, mismatches, rate: mismatches / n, maxUlp: nanVsNumber ? 'inf (NaN vs number)' : Number(maxUlp), maxUlpFinite: Number(maxUlp), nanVsNumber, hist, examples };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = {};
  const names = cands.split(',');
  console.log(`reference ${ref}; candidates ${names.join(', ')}; mismatches (max ulp) per function`);
  console.log(`${'fn'.padEnd(6)} ${names.map((c) => c.padStart(22)).join(' ')}`);
  for (const fn of fns) {
    result[fn] = {};
    const pr = `${dir}/${fn}.${ref}.f64`;
    const row = [];
    if (!fs.existsSync(pr)) { console.log(`${fn.padEnd(6)} reference missing`); continue; }
    const a = load(pr);
    for (const c of names) {
      const pc = `${dir}/${fn}.${c}.f64`;
      if (!fs.existsSync(pc)) { result[fn][c] = 'missing'; row.push('missing'.padStart(22)); continue; }
      const r = compare(a, load(pc));
      result[fn][c] = r;
      row.push(`${r.mismatches} (${r.maxUlp === 'inf (NaN vs number)' ? 'NaN!' : r.maxUlp})`.padStart(22));
    }
    console.log(`${fn.padEnd(6)} ${row.join(' ')}`);
  }
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ dir, ref, candidates: names, result }, null, 1));
}
