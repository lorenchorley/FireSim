// node waterfall.mjs DIR : what the cuts remove. Per file: function-span lines reachable without cuts (slice-all.json) against with cuts (slice-union.json); and the import-closure size of src/sim/host.ts.
import fs from 'node:fs';
const D = process.argv[2];
const A = JSON.parse(fs.readFileSync(`${D}/slice-all.json`)), U = JSON.parse(fs.readFileSync(`${D}/slice-union.json`));
const rows = [];
for (const [f, n] of Object.entries(A.fileLines)) rows.push([f, n, U.fileLines[f] || 0]);
rows.sort((a, b) => (b[1] - b[2]) - (a[1] - a[2]));
const groups = [
  ['explain engine (src/explain/): insights, cards, text; never read back by the physics', /^src\/explain\//],
  ['snapshot, checkpoint, engine-info, stats, view and performance bookkeeping in src/sim/ (simulation.ts remainder, stats.ts, engineInfo.ts, perfStats.ts, fireWindPublish.ts)', /^src\/sim\/(simulation|stats|engineInfo|perfStats|fireWindPublish|records)\.ts$/],
  ['user edits: fuel edits, brush polygons, wind-direction edits, datasets', /^src\/(fuel\/edits|fuel\/polygon|scenario\/windDirection|scenario\/openMeteo|core\/datasets)\.ts$/],
  ['ember statistics, overlays, checkpoint (src/embers/stats.ts and EmberModel members)', /^src\/embers\//],
  ['spread-driver attribution (src/fire/spread/attribution.ts)', /^src\/fire\/spread\/attribution\.ts$/],
  ['moisture breakdown (explain callback)', /^src\/fuel\/moisture\/model\.ts$/],
];
const used = new Set();
const out = [];
for (const [title, re] of groups) {
  let a = 0, u = 0;
  for (const [f, na, nu] of rows) if (re.test(f) && !used.has(f)) { a += na; u += nu; used.add(f); }
  out.push(`| ${title} | ${a} | ${u} | ${a - u} |`);
}
let a = 0, u = 0; for (const [f, na, nu] of rows) if (!used.has(f)) { a += na; u += nu; }
out.push(`| everything else (mostly pulled in only through the removed code, e.g. checkpoint members of FireSpreadModel and Atmosphere, MoistureModel) | ${a} | ${u} | ${a - u} |`);
console.log('| what is cut | lines reachable without cuts | lines left | removed |'); console.log('|---|---|---|---|');
console.log(out.join('\n'));
console.log(`| total | ${A.totalLines} | ${U.totalLines} | ${A.totalLines - U.totalLines} |`);
console.log('\nper file, the largest removals:'); for (const [f, na, nu] of rows.filter((r) => r[1] !== r[2]).slice(0, 25)) console.log(`${f}: ${na} -> ${nu}`);
