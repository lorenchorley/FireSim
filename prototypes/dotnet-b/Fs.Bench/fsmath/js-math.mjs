// T1.3: JavaScript's own Math over the fixed input files, in Node (this file) and in Chromium (chromium-ref.mjs shares the loops below).
//   node js-math.mjs ref IN_DIR OUT_DIR [TAG=node22]      writes OUT_DIR/{fn}.{TAG}.f64 (raw float64 results) and OUT_DIR/run-{TAG}.json
//   node --jitless js-math.mjs ref IN_DIR OUT_DIR node22-jitless      the same with V8's interpreter only (does the optimising compiler change a bit?)
//   node js-math.mjs ns IN_DIR OUT.json [N=65536] [REPEATS=15]        ns per call of Math.* (same loop shape as FsMathNs and the WebAssembly timings)
import fs from 'node:fs';
import crypto from 'node:crypto';

export const FNS = ['exp', 'log', 'pow', 'sin', 'cos', 'tan', 'atan', 'atan2', 'acos', 'asin', 'sinh', 'cbrt', 'log2', 'log10', 'hypot'];
export const ARITY = { pow: 2, atan2: 2, hypot: 2 };

/** One loop per function with the call written out (as the C# loops), built with new Function so each is optimised on its own. */
export function makeLoop(fn) {
  return ARITY[fn] === 2
    ? new Function('x', 'y', 'n', `for (let i = 0; i < n; i++) y[i] = Math.${fn}(x[2 * i], x[2 * i + 1]);`)
    : new Function('x', 'y', 'n', `for (let i = 0; i < n; i++) y[i] = Math.${fn}(x[i]);`);
}

export function median(a) { const s = [...a].sort((p, q) => p - q); return s[s.length >> 1]; }

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, inDir, out, a3, a4] = process.argv.slice(2);
  const rd = (fn) => { const b = fs.readFileSync(`${inDir}/${fn}.in`); return new Float64Array(b.buffer, b.byteOffset, b.byteLength / 8); };
  if (cmd === 'ref') {
    const tag = a3 ?? 'node22';
    fs.mkdirSync(out, { recursive: true });
    const sha = {};
    for (const fn of FNS) {
      if (!fs.existsSync(`${inDir}/${fn}.in`)) continue; // a set may lack a function (the recorded set has no log2, log10, sinh)
      const x = rd(fn);
      const n = x.length / (ARITY[fn] ?? 1);
      const y = new Float64Array(n);
      makeLoop(fn)(x, y, n);
      const bytes = Buffer.from(y.buffer);
      fs.writeFileSync(`${out}/${fn}.${tag}.f64`, bytes);
      sha[fn] = crypto.createHash('sha256').update(bytes).digest('hex');
    }
    fs.writeFileSync(`${out}/run-${tag}.json`, JSON.stringify({ tag, node: process.version, v8: process.versions.v8, argv: process.execArgv, sha256: sha }, null, 1));
    console.log(`${tag}: node ${process.version} v8 ${process.versions.v8}: ${FNS.length} functions -> ${out}`);
  } else if (cmd === 'ns') {
    const n = Number(a3 ?? 65536), repeats = Number(a4 ?? 15);
    const rows = [];
    let sink = 0;
    for (const fn of FNS) {
      if (!fs.existsSync(`${inDir}/${fn}.in`)) continue;
      const ar = ARITY[fn] ?? 1;
      const x = rd(fn).slice(0, n * ar);
      const y = new Float64Array(n);
      const loop = makeLoop(fn);
      const t = [];
      for (let r = -3; r < repeats; r++) {
        const t0 = performance.now();
        loop(x, y, n);
        const dt = ((performance.now() - t0) * 1e6) / n;
        if (r >= 0) t.push(dt);
        sink += y[(r + 3) % n];
      }
      t.sort((p, q) => p - q);
      rows.push({ fn, impl: 'js-math', n, repeats, nsMedian: t[t.length >> 1], nsMin: t[0], nsMax: t[t.length - 1] });
      console.log(`${fn.padEnd(6)} js-math median ${t[t.length >> 1].toFixed(2).padStart(8)} ns   min ${t[0].toFixed(2).padStart(8)}   max ${t[t.length - 1].toFixed(2).padStart(8)}`);
    }
    fs.writeFileSync(out, JSON.stringify({ engine: 'node', node: process.version, v8: process.versions.v8, sink, rows }, null, 1));
  }
}
