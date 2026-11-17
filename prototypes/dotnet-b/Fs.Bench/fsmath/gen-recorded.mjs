// T1.3: the input set "recorded": the arguments the solver really passed (record-args.mjs), pooled over the recording runs and thinned evenly to at most N calls
// per function (every k-th call of the pooled sequence, k = ceil(total / N); no randomness). Functions the runs never called get no file.
//   node gen-recorded.mjs OUT [N=1000000] REC_DIR [REC_DIR...]
import fs from 'node:fs';
import crypto from 'node:crypto';

const [out, nArg, ...dirs] = process.argv.slice(2);
const N = Number(nArg ?? 1_000_000);
const FNS = ['exp', 'log', 'pow', 'sin', 'cos', 'tan', 'atan', 'atan2', 'acos', 'asin', 'sinh', 'cbrt', 'log2', 'log10', 'hypot'];
const ARITY = { pow: 2, atan2: 2, hypot: 2 };
fs.mkdirSync(out, { recursive: true });
const files = {};
for (const fn of FNS) {
  const ar = ARITY[fn] ?? 1;
  const parts = [];
  for (const d of dirs) {
    const p = `${d}/${fn}.rec`;
    if (fs.existsSync(p)) { const b = fs.readFileSync(p); parts.push(new Float64Array(b.buffer, b.byteOffset, b.byteLength / 8)); }
  }
  const total = parts.reduce((s, a) => s + a.length / ar, 0);
  if (total === 0) continue;
  const k = Math.max(1, Math.ceil(total / N));
  const keep = [];
  let idx = 0;
  for (const a of parts) for (let i = 0; i < a.length / ar; i++, idx++) if (idx % k === 0) for (let j = 0; j < ar; j++) keep.push(a[ar * i + j]);
  const buf = Buffer.from(new Float64Array(keep).buffer);
  fs.writeFileSync(`${out}/${fn}.in`, buf);
  files[fn] = { file: `${fn}.in`, calls: keep.length / ar, pooledCalls: total, stride: k, arity: ar, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
}
fs.writeFileSync(`${out}/inputs.json`, JSON.stringify({ node: process.version, source: dirs, n: N, files }, null, 1));
console.log(Object.entries(files).map(([f, v]) => `${f}:${v.calls}`).join(' '));
