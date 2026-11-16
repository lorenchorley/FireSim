// T1.6a: merges the files of fsmath-abba.sh into one JSON (stdout) and a markdown table (stderr).
//   node fsmath-merge.mjs OUT_DIR > fsmath-abba.json
// Per engine, build, function and implementation: for each round the ns per call of the two V8 `Math` runs (A) and of the two WebAssembly runs (B) are each averaged
// (A B B A), the round's ratio is B / A, and the rounds give median, min and max.
import fs from 'node:fs';

const dir = process.argv[2];
const files = fs.readdirSync(dir).filter((f) => /^(node|chromium)-(aot|interp)-r\d+-(js|wasm)-[12]\.json$/.test(f));
const med = (a) => [...a].sort((p, q) => p - q)[a.length >> 1];
const mean = (a) => a.reduce((p, q) => p + q, 0) / a.length;
const cells = new Map(); // `${engine}|${build}|${fn}|${impl}` -> { rounds: Map(round -> {js: [], wasm: []}) }
const meta = {};
for (const f of files) {
  const [, engine, build, round, kind] = f.match(/^(node|chromium)-(aot|interp)-r(\d+)-(js|wasm)-[12]\.json$/);
  const j = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'));
  meta[`${engine}-${build}`] = { engine, build, browser: j.browser ?? j.version, v8: j.v8, node: j.node, runtime: j.runtime };
  for (const r of j.rows) {
    const impls = kind === 'js' ? ['fdlibm', 'cms'] : [r.impl]; // the V8 row belongs to both implementations
    for (const impl of impls) {
      const key = `${engine}|${build}|${r.fn}|${impl}`;
      const c = cells.get(key) ?? { rounds: new Map() };
      const rd = c.rounds.get(round) ?? { js: [], wasm: [] };
      rd[kind].push(r.nsMedian);
      c.rounds.set(round, rd);
      cells.set(key, c);
    }
  }
}
const rows = [];
for (const [key, c] of cells) {
  const [engine, build, fn, impl] = key.split('|');
  const per = [...c.rounds.values()].filter((x) => x.js.length === 2 && x.wasm.length === 2).map((x) => ({ js: mean(x.js), wasm: mean(x.wasm) }));
  if (!per.length) continue;
  const ratios = per.map((x) => x.wasm / x.js);
  rows.push({
    engine, build, fn, impl, rounds: per.length,
    jsNsMedian: med(per.map((x) => x.js)), wasmNsMedian: med(per.map((x) => x.wasm)),
    jsNsMin: Math.min(...per.map((x) => x.js)), jsNsMax: Math.max(...per.map((x) => x.js)),
    wasmNsMin: Math.min(...per.map((x) => x.wasm)), wasmNsMax: Math.max(...per.map((x) => x.wasm)),
    ratioMedian: med(ratios), ratioMin: Math.min(...ratios), ratioMax: Math.max(...ratios),
  });
}
console.log(JSON.stringify({ meta, rows }, null, 1));
const FN = ['exp', 'log', 'pow', 'sin', 'cos', 'tan', 'atan', 'atan2', 'acos', 'asin', 'sinh', 'cbrt', 'log2', 'log10', 'hypot'];
for (const impl of ['fdlibm', 'cms']) {
  console.error(`\n${impl}: ns per call, V8 Math -> WebAssembly (ratio median [min-max])`);
  console.error('fn | node AOT | chromium AOT | node interp | chromium interp');
  for (const fn of FN) {
    const cell = (e, b) => { const r = rows.find((x) => x.engine === e && x.build === b && x.fn === fn && x.impl === impl); return r ? `${r.jsNsMedian.toFixed(1)} -> ${r.wasmNsMedian.toFixed(1)} (${r.ratioMedian.toFixed(2)} [${r.ratioMin.toFixed(2)}-${r.ratioMax.toFixed(2)}])` : '-'; };
    console.error(`${fn} | ${cell('node', 'aot')} | ${cell('chromium', 'aot')} | ${cell('node', 'interp')} | ${cell('chromium', 'interp')}`);
  }
}
