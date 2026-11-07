// Summarises a V8 CPU profile written by row.ts (spec.cpuProfile): self time by source file and by function.
//   node profile-summary.mjs <profile.json> [topFunctions=18]  ->  JSON on stdout
import { readFileSync } from 'node:fs';

const [path, topN = '18'] = process.argv.slice(2);
const p = JSON.parse(readFileSync(path, 'utf8'));
const byId = new Map(p.nodes.map((n) => [n.id, n]));
const self = new Map();
for (let i = 0; i < p.samples.length; i++) self.set(p.samples[i], (self.get(p.samples[i]) ?? 0) + (p.timeDeltas[i] ?? 0));
let total = 0;
const files = new Map();
const funcs = new Map();
const kinds = { gc: 0, program: 0, idle: 0, native: 0 };
for (const [id, us] of self) {
  const cf = byId.get(id).callFrame;
  total += us;
  const url = cf.url || '';
  const name = cf.functionName || '(anonymous)';
  if (name === '(garbage collector)') kinds.gc += us;
  else if (name === '(program)') kinds.program += us;
  else if (name === '(idle)') kinds.idle += us;
  let file = url.replace(/^file:\/\//, '');
  const m = file.match(/\/(src\/.*)$/);
  file = m ? m[1].replace(/\?.*$/, '') : url ? 'node_modules or runtime: ' + (file.split('/node_modules/').pop() || file).slice(0, 60) : `(${name})`;
  files.set(file, (files.get(file) ?? 0) + us);
  const key = `${name} @ ${file}:${cf.lineNumber + 1}`;
  funcs.set(key, (funcs.get(key) ?? 0) + us);
}
const rank = (m, n) =>
  [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ name: k, selfMs: Math.round(v / 1000), pct: Math.round((1000 * v) / total) / 10 }));
console.log(JSON.stringify({ totalMs: Math.round(total / 1000), gcMs: Math.round(kinds.gc / 1000), programMs: Math.round(kinds.program / 1000), idleMs: Math.round(kinds.idle / 1000), files: rank(files, 22), functions: rank(funcs, Number(topN)) }, null, 1));
