// usage: node cpuprofTop.mjs file.cpuprofile BUNDLE.mjs [N] [--json]
// Top self-time functions (self time = samples whose top frame is the function), with the source file each bundle line came from
// (the bundle keeps `//#region src/...` comments) and a per-file total.
import fs from 'node:fs';
const p = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const bundle = fs.readFileSync(process.argv[3], 'utf8').split('\n');
const N = Number(process.argv[4] ?? 30);
const asJson = process.argv.includes('--json');
const regionAt = new Array(bundle.length + 2).fill('(bundle)');
let cur = '(bundle)';
for (let i = 0; i < bundle.length; i++) {
  const m = /^\/\/#region (.*)$/.exec(bundle[i]);
  if (m) cur = m[1];
  else if (/^\/\/#endregion/.test(bundle[i])) cur = '(bundle)';
  regionAt[i + 1] = cur;
}
const byId = new Map(p.nodes.map((n) => [n.id, n]));
const self = new Map();
const files = new Map();
let total = 0;
for (let i = 0; i < p.samples.length; i++) {
  const d = p.timeDeltas[i] ?? 0;
  const cf = byId.get(p.samples[i]).callFrame;
  const file = cf.url.endsWith('.mjs') ? regionAt[cf.lineNumber + 1] ?? '(bundle)' : cf.url || '(native)';
  const key = `${cf.functionName || '(anonymous)'} [${file}]`;
  self.set(key, (self.get(key) ?? 0) + d);
  files.set(file, (files.get(file) ?? 0) + d);
  total += d;
}
const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, N);
const topFiles = [...files.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
if (asJson) {
  console.log(JSON.stringify({ totalMs: total / 1000, functions: top.map(([k, v]) => ({ fn: k, selfMs: v / 1000, pct: (v / total) * 100 })), files: topFiles.map(([k, v]) => ({ file: k, selfMs: v / 1000, pct: (v / total) * 100 })) }));
} else {
  console.log('total sampled ms', (total / 1000).toFixed(0));
  for (const [k, v] of top) console.log(((v / total) * 100).toFixed(1).padStart(5) + '%  ' + (v / 1000).toFixed(0).padStart(6) + ' ms  ' + k);
  console.log('--- by source file (self time) ---');
  for (const [k, v] of topFiles) console.log(((v / total) * 100).toFixed(1).padStart(5) + '%  ' + (v / 1000).toFixed(0).padStart(6) + ' ms  ' + k);
}
