// T1.3: compares the WebAssembly result files of one build and engine with the linux-x64 result files of the same implementation, bit for bit (NaN equals NaN),
// writes DATA_DIR/identity-VARIANT.json and, with --delete, removes the compared WebAssembly result files (they are 8 MB each; the digests stay in run-VARIANT.json).
//   node wasm-identity.mjs DATA_DIR VARIANT [--delete]        VARIANT: wasm-aot-node, wasm-aot-chromium, wasm-interp-node, wasm-interp-chromium
import fs from 'node:fs';
import { compare } from './compare.mjs';

const [data, variant, del] = process.argv.slice(2);
const FNS = ['exp', 'log', 'pow', 'sin', 'cos', 'tan', 'atan', 'atan2', 'acos', 'asin', 'sinh', 'cbrt', 'log2', 'log10', 'hypot'];
const load = (p) => { const b = fs.readFileSync(p); return new Uint32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
const out = { variant, sets: {} };
for (const set of ['synthetic', 'recorded', 'stress']) {
  out.sets[set] = {};
  for (const impl of ['fdlibm', 'cms']) {
    let calls = 0, mism = 0, files = 0;
    const per = {};
    for (const fn of FNS) {
      const a = `${data}/${set}/${fn}.${impl}.f64`, b = `${data}/${set}/${fn}.${variant}-${impl}.f64`;
      if (!fs.existsSync(a) || !fs.existsSync(b)) continue;
      const r = compare(load(a), load(b));
      files++; calls += r.calls; mism += r.mismatches; per[fn] = r.mismatches;
      if (del === '--delete') fs.unlinkSync(b);
    }
    if (files) out.sets[set][impl] = { functions: files, calls, mismatches: mism, perFunction: per };
  }
}
fs.writeFileSync(`${data}/identity-${variant}.json`, JSON.stringify(out, null, 1));
console.log(variant, JSON.stringify(Object.fromEntries(Object.entries(out.sets).map(([s, v]) => [s, Object.fromEntries(Object.entries(v).map(([i, r]) => [i, `${r.calls} calls, ${r.mismatches} mismatches`]))]))));
