// node tiers.mjs DIR : lines per file of the union slice, split by the tier that reaches them (both / fast only / standard only). DIR holds slice-union|fast|std.json.
import fs from 'node:fs';
const S = process.argv[2];
const L = (n) => JSON.parse(fs.readFileSync(`${S}/${n}.json`));
const u = L('slice-union'), f = L('slice-fast'), s = L('slice-std');
const fi = new Set(f.entries.map((e) => e.id)), si = new Set(s.entries.map((e) => e.id));
const tot = { both: 0, fast: 0, std: 0 };
const rows = {};
for (const e of u.entries) {
  if (e.module || e.synthetic) continue;
  const t = fi.has(e.id) && si.has(e.id) ? 'both' : fi.has(e.id) ? 'fast' : 'std';
  (rows[e.file] ??= { both: 0, fast: 0, std: 0 })[t] += e.lines;
}
console.log('file'.padEnd(42), 'both fast-only std-only   (function span lines; a function nested in another counts in both)');
for (const [k, v] of Object.entries(rows).sort()) {
  console.log(k.padEnd(42), String(v.both).padStart(5), String(v.fast).padStart(9), String(v.std).padStart(8));
  for (const t of ['both', 'fast', 'std']) tot[t] += v[t];
}
console.log('TOTAL', tot, 'union lines (nested counted once):', u.totalLines, 'fast tier:', f.totalLines, 'standard tier:', s.totalLines);
