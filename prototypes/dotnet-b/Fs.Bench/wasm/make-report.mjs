// T1.6a: assembles reports/1w-early.json (stage 1w-early, the conventions of 1-fsmath.json / RESULTS-SCHEMA.md) from the result files of run-all.sh and prints the markdown tables used in
// reports/1w-early.md to stdout.
//   node make-report.mjs SCRATCH_DIR REPO_COMMIT OUT.json > tables.md
// SCRATCH_DIR holds results/ (run-all.sh), aot/ and interp/ (the two publishes), fsmath-abba.json (fsmath-merge.mjs) and sizes.json (written here from the publish folders).
import fs from 'node:fs';
import path from 'node:path';

const [S, commit, outFile] = process.argv.slice(2);
const R = `${S}/results`;
const rd = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const med = (a) => [...a].sort((p, q) => p - q)[a.length >> 1];
const p95 = (a) => { const s = [...a].sort((p, q) => p - q); return s[Math.min(s.length - 1, Math.max(0, Math.ceil(0.95 * s.length) - 1))]; };
const f3 = (x) => x.toFixed(3);
const md = [];
const runs = [];
const gate = {};
const startup = {};
const e2e = {};
const meta = {};

for (const build of ['aot', 'interp']) {
  for (const eng of ['node', 'chromium']) {
    const file = `${R}/suite-${eng}-${build}.json`;
    if (!fs.existsSync(file)) continue;
    const d = rd(file);
    meta[`${eng}-${build}`] = { engine: d.engine, node: d.node, browser: d.browser, v8: d.v8, runtime: d.runtime, loadavgBefore: d.host.loadavgBefore, loadavgAfter: d.host.loadavgAfter, checksums: d.checksums, cfg: d.cfg };
    for (const s of d.series) {
      const poolTs = s.rounds.flatMap((r) => r.ts.flatMap((b) => b.samples));
      const poolNet = s.rounds.flatMap((r) => r.net.flatMap((b) => b.samples));
      const sm = s.summary;
      const base = { threads: 1, n: d.cfg.rounds, unit: 'ms per sweep' };
      const notes = `${eng}, ${s.kernel}, .NET path ${s.path}; median over ${d.cfg.rounds} rounds of the mean of 2 blocks (A B B A), block = median of ${d.cfg.samples} samples; p95 over all samples`;
      runs.push({ name: `${s.kernel} ts ${eng}`, impl: 'ts', runtime: eng === 'node' ? 'v8-node' : 'v8-chromium', ...base, medianMs: sm.tsMsMedian, p95Ms: p95(poolTs), minMs: sm.tsMsMin, maxMs: sm.tsMsMax, engine: eng, kernel: s.kernel, notes });
      runs.push({ name: `${s.kernel} ${s.path} ${eng} ${build}`, impl: `csharp-${s.path}`, runtime: build === 'aot' ? 'mono-wasm-aot' : 'mono-wasm-interp', ...base, medianMs: sm.netMsMedian, p95Ms: p95(poolNet), minMs: sm.netMsMin, maxMs: sm.netMsMax, engine: eng, kernel: s.kernel, ratioToTs: { median: sm.ratioMedian, min: sm.ratioMin, max: sm.ratioMax, rounds: sm.ratios }, notes });
      gate[`${build}|${eng}|${s.kernel}|${s.path}`] = { ...sm, tsMsMedian: sm.tsMsMedian };
    }
    e2e[`${eng}-${build}`] = ['stencil', 'copy'].map((k) => {
      const per = d.endToEnd.map((r) => r[k]);
      return { kernel: k, bytes: per[0].bytes, copyOnlyMs: med(per.map((x) => x.copyOnly.median)), copyOnlyMin: Math.min(...per.map((x) => x.copyOnly.median)), copyOnlyMax: Math.max(...per.map((x) => x.copyOnly.median)), copyPlusOneSweepMs: med(per.map((x) => x.copyPlusOneSweep.median)), copyPlusOneSweepMin: Math.min(...per.map((x) => x.copyPlusOneSweep.median)), copyPlusOneSweepMax: Math.max(...per.map((x) => x.copyPlusOneSweep.median)) };
    });
  }
  for (const eng of ['node', 'chromium']) {
    const fs_ = fs.readdirSync(R).filter((f) => f.startsWith(`startup-${eng}-${build}-`) && f.endsWith('.json')).map((f) => rd(`${R}/${f}`));
    if (fs_.length) startup[`${eng}-${build}`] = { runs: fs_.length, importAndCreateMs: med(fs_.map((x) => x.startup.importAndCreateMs)), firstResultMs: med(fs_.map((x) => x.startup.firstResultMs)), firstResultMin: Math.min(...fs_.map((x) => x.startup.firstResultMs)), firstResultMax: Math.max(...fs_.map((x) => x.startup.firstResultMs)) };
  }
}

// TypeScript alone (fresh process / worker, no WebAssembly loaded) and the repeat suite
const tsAloneRuns = {};
const tsAlone = {};
const rep2 = {};
for (const eng of ['node', 'chromium']) {
  const files = fs.readdirSync(R).filter((f) => f.startsWith(`tsalone-${eng}-`) && f.endsWith('.json')).map((f) => rd(`${R}/${f}`));
  if (files.length) {
    tsAloneRuns[eng] = files;
    tsAlone[eng] = Object.fromEntries(['stencil', 'copy'].map((k) => { const m = files.map((x) => x.kernels[k].median); return [k, { runs: files.length, median: med(m), min: Math.min(...m), max: Math.max(...m), perRun: m }]; }));
  }
  if (fs.existsSync(`${R}/suite-${eng}-aot-rep2.json`)) for (const s of rd(`${R}/suite-${eng}-aot-rep2.json`).series) rep2[`${eng}|${s.kernel}|${s.path}`] = s.summary;
}
for (const [k, g] of Object.entries(gate)) {
  const [build, eng, kernel] = k.split('|');
  if (build !== 'aot' || !tsAlone[eng]) continue;
  const ref = tsAlone[eng][kernel].median;
  g.vsAlone = { tsAloneMs: ref, ratioMedian: g.netMsMedian / ref, ratioMin: g.netMsMin / ref, ratioMax: g.netMsMax / ref };
  const r2 = rep2[`${eng}|${kernel}|${k.split('|')[3]}`];
  if (r2) g.rep2 = { ratioMedian: r2.ratioMedian, ratioMin: r2.ratioMin, ratioMax: r2.ratioMax, tsMsMedian: r2.tsMsMedian, netMsMedian: r2.netMsMedian, vsAloneMedian: r2.netMsMedian / ref };
}

// sizes of the published _framework folders (the .br and .gz are the build's own pre-compressed copies)
const sizes = {};
for (const build of ['aot', 'interp']) {
  const d = `${S}/${build}/wwwroot/_framework`;
  const all = fs.readdirSync(d);
  const sum = (pred) => all.filter(pred).reduce((a, f) => a + fs.statSync(path.join(d, f)).size, 0);
  sizes[build] = { rawBytes: sum((f) => !/\.(br|gz)$/.test(f)), brotliBytes: sum((f) => f.endsWith('.br')), gzipBytes: sum((f) => f.endsWith('.gz')), files: all.filter((f) => !/\.(br|gz)$/.test(f)).length, nativeWasmRaw: sum((f) => /^dotnet\.native\..*\.wasm$/.test(f)), nativeWasmBrotli: sum((f) => /^dotnet\.native\..*\.wasm\.br$/.test(f)) };
}

const app = {};
for (const eng of ['node', 'chromium']) if (fs.existsSync(`${R}/app-${eng}.json`)) app[eng] = rd(`${R}/app-${eng}.json`).runs;

// ---- tables ----
md.push('### Gate 1W ratio, kernel level (Mono AOT / TypeScript, one thread; < 1 means WebAssembly is faster)\n');
md.push('| engine | kernel | .NET path | TS in process ms/sweep | TS alone ms/sweep | .NET AOT ms/sweep | ratio A B B A in process: median (min-max of 5 rounds) | **ratio against TS alone**: median (min-max) | repeat run, in process / vs alone |');
md.push('|---|---|---|---:|---:|---:|---|---|---|');
for (const eng of ['node', 'chromium']) for (const k of ['stencil', 'copy']) for (const p of ['scalar', 'vector128', 'plain']) {
  const g = gate[`aot|${eng}|${k}|${p}`];
  if (!g) continue;
  const a = g.vsAlone, r = g.rep2;
  md.push(`| ${eng} | ${k} | ${p} | ${f3(g.tsMsMedian)} | ${a ? f3(a.tsAloneMs) : '-'} | ${f3(g.netMsMedian)} (${f3(g.netMsMin)}-${f3(g.netMsMax)}) | ${g.ratioMedian.toFixed(2)} (${g.ratioMin.toFixed(2)}-${g.ratioMax.toFixed(2)}) | **${a ? a.ratioMedian.toFixed(2) : '-'}** (${a ? a.ratioMin.toFixed(2) + '-' + a.ratioMax.toFixed(2) : '-'}) | ${r ? r.ratioMedian.toFixed(2) + ' / ' + r.vsAloneMedian.toFixed(2) : '-'} |`);
}
md.push('\n### TypeScript alone: median of 3 fresh processes / workers (min-max), ms per sweep\n');
md.push('| engine | stencil | copy |');
md.push('|---|---:|---:|');
for (const [eng, t] of Object.entries(tsAlone)) md.push(`| ${eng} | ${f3(t.stencil.median)} (${f3(t.stencil.min)}-${f3(t.stencil.max)}) | ${f3(t.copy.median)} (${f3(t.copy.min)}-${f3(t.copy.max)}) |`);
md.push('\n### Interpreter (what AOT buys), scalar path\n');
md.push('| engine | kernel | TypeScript ms/sweep | .NET interpreter ms/sweep | ratio median | min | max |');
md.push('|---|---|---:|---:|---:|---:|---:|');
for (const eng of ['node', 'chromium']) for (const k of ['stencil', 'copy']) {
  const g = gate[`interp|${eng}|${k}|scalar`];
  if (g) md.push(`| ${eng} | ${k} | ${f3(g.tsMsMedian)} | ${f3(g.netMsMedian)} | ${g.ratioMedian.toFixed(1)} | ${g.ratioMin.toFixed(1)} | ${g.ratioMax.toFixed(1)} |`);
}
md.push('\n### End to end (byte[] argument copied in by the marshaller), AOT, ms\n');
md.push('| engine | kernel | argument | copy + call only | copy + call + 1 sweep | resident 1 sweep | (TypeScript 1 sweep) |');
md.push('|---|---|---:|---:|---:|---:|---:|');
for (const eng of ['node', 'chromium']) for (const e of e2e[`${eng}-aot`] ?? []) {
  const g = gate[`aot|${eng}|${e.kernel}|scalar`];
  md.push(`| ${eng} | ${e.kernel} | ${(e.bytes / 1e6).toFixed(2)} MB | ${e.copyOnlyMs.toFixed(2)} (${e.copyOnlyMin.toFixed(2)}-${e.copyOnlyMax.toFixed(2)}) | ${e.copyPlusOneSweepMs.toFixed(2)} (${e.copyPlusOneSweepMin.toFixed(2)}-${e.copyPlusOneSweepMax.toFixed(2)}) | ${f3(g.netMsMedian)} | ${f3(g.tsMsMedian)} |`);
}
md.push('\n### Start-up (median of 5 fresh processes / browsers), ms\n');
md.push('| engine | build | import + create | first result (Load + 1 sweep) | first result min-max |');
md.push('|---|---|---:|---:|---:|');
for (const [k, v] of Object.entries(startup)) md.push(`| ${k.split('-')[0]} | ${k.split('-')[1]} | ${v.importAndCreateMs.toFixed(0)} | ${v.firstResultMs.toFixed(0)} | ${v.firstResultMin.toFixed(0)}-${v.firstResultMax.toFixed(0)} |`);
md.push('\n### Download (the `_framework` folder as published)\n');
md.push('| build | raw | brotli | gzip | dotnet.native.wasm raw / brotli |');
md.push('|---|---:|---:|---:|---:|');
for (const [k, v] of Object.entries(sizes)) md.push(`| ${k} | ${(v.rawBytes / 1e6).toFixed(2)} MB | ${(v.brotliBytes / 1e6).toFixed(2)} MB | ${(v.gzipBytes / 1e6).toFixed(2)} MB | ${(v.nativeWasmRaw / 1e6).toFixed(2)} / ${(v.nativeWasmBrotli / 1e6).toFixed(2)} MB |`);
md.push('\n### The app\'s own measureAll (round 0\'s committed worker), TypeScript only\n');
md.push('| engine | run | stencil Mcells/s | copy GB/s | checksums |');
md.push('|---|---:|---:|---:|---|');
for (const [eng, rs] of Object.entries(app)) rs.forEach((r, i) => md.push(`| ${eng} | ${i + 1} | ${r.stencilMcellsPerS?.toFixed(1)} | ${r.copyGBps?.toFixed(2)} | ${r.stencilAfter3} ${r.copyAfter2} |`));

// FsMath second table
const fsmFile = `${S}/fsmath-abba.json`;
let fsm = null;
if (fs.existsSync(fsmFile)) {
  fsm = rd(fsmFile);
  const FN = ['exp', 'log', 'pow', 'sin', 'cos', 'tan', 'atan', 'atan2', 'acos', 'asin', 'sinh', 'cbrt', 'log2', 'log10', 'hypot'];
  md.push('\n### FsMath (FdLibm) as WebAssembly against V8 `Math`, same engine, ns per call (median of 3 rounds of A B B A), ratio = WebAssembly / V8\n');
  md.push('| function | node: Math | node: AOT | ratio [min-max] | chromium: Math | chromium: AOT | ratio [min-max] | node: interp | ratio |');
  md.push('|---|---:|---:|---|---:|---:|---|---:|---:|');
  const row = (e, b, fn, impl) => fsm.rows.find((x) => x.engine === e && x.build === b && x.fn === fn && x.impl === impl);
  for (const fn of FN) {
    const na = row('node', 'aot', fn, 'fdlibm'), ca = row('chromium', 'aot', fn, 'fdlibm'), ni = row('node', 'interp', fn, 'fdlibm');
    const r = (x) => (x ? `${x.ratioMedian.toFixed(2)} [${x.ratioMin.toFixed(2)}-${x.ratioMax.toFixed(2)}]` : '-');
    md.push(`| ${fn} | ${na?.jsNsMedian.toFixed(1)} | ${na?.wasmNsMedian.toFixed(1)} | ${r(na)} | ${ca?.jsNsMedian.toFixed(1)} | ${ca?.wasmNsMedian.toFixed(1)} | ${r(ca)} | ${ni?.wasmNsMedian.toFixed(0)} | ${ni ? ni.ratioMedian.toFixed(1) : '-'} |`);
  }
  md.push('\nCoreMathSharp, AOT (WebAssembly has no FMA instruction, so it runs a software one): ');
  md.push('\n| function | node: Math | node: AOT | ratio | chromium: AOT | ratio |');
  md.push('|---|---:|---:|---:|---:|---:|');
  for (const fn of FN) {
    const na = row('node', 'aot', fn, 'cms'), ca = row('chromium', 'aot', fn, 'cms');
    md.push(`| ${fn} | ${na?.jsNsMedian.toFixed(1)} | ${na?.wasmNsMedian.toFixed(1)} | ${na?.ratioMedian.toFixed(2)} | ${ca?.wasmNsMedian.toFixed(1)} | ${ca?.ratioMedian.toFixed(2)} |`);
  }
}

const worst = (pred) => Math.max(...Object.entries(gate).filter(([k]) => pred(k)).map(([, v]) => Math.max(v.ratioMax, v.vsAlone?.ratioMax ?? 0)));
const doc = {
  stage: '1w-early',
  when: new Date().toISOString(),
  indicative: true,
  machine: { label: 'container', cpu: 'Intel(R) Xeon(R) Processor @ 2.10GHz', cores: 4, os: 'Linux 6.18 x64', runtime: 'Mono wasm 11.0.0 (AOT and interpreter) on Node 22.22.0 (V8 12.4.254.21-node.33) and Chromium 153.0.8010.12 (V8 15.3.76.4, headless, Playwright)' },
  build: { configuration: 'Release', commit },
  engines: meta,
  runs,
  tsAlone,
  gate1wKernelLevel: Object.fromEntries(Object.entries(gate).filter(([k]) => k.startsWith('aot|')).map(([k, v]) => [k.replace('aot|', ''), { ratioMedian: v.ratioMedian, ratioMin: v.ratioMin, ratioMax: v.ratioMax, ratios: v.ratios, tsMsMedian: v.tsMsMedian, netMsMedian: v.netMsMedian, vsTsAlone: v.vsAlone, repeat: v.rep2 }])),
  gateInterpreter: Object.fromEntries(Object.entries(gate).filter(([k]) => k.startsWith('interp|')).map(([k, v]) => [k.replace('interp|', ''), { ratioMedian: v.ratioMedian, ratioMin: v.ratioMin, ratioMax: v.ratioMax, tsMsMedian: v.tsMsMedian, netMsMedian: v.netMsMedian }])),
  endToEnd: e2e,
  startup,
  download: sizes,
  appMeasureAll: app,
  fsmathVsV8: fsm,
  gate: {
    bar: 'Gate 1W (plan section 4): whole-step time of Mono WebAssembly AOT, one thread, at most 1.25x the TypeScript worker\'s, on desktop Chromium and on the phone\'s WebView',
    measured: `kernel level only (the two frozen speed-test kernels, scalar contract path), AOT / TypeScript alone: ${Object.entries(gate).filter(([k]) => k.startsWith('aot|') && k.endsWith('|scalar')).map(([k, v]) => `${k.replace('aot|', '').replace('|scalar', '')} ${v.vsAlone.ratioMedian.toFixed(2)} (${v.vsAlone.ratioMin.toFixed(2)}-${v.vsAlone.ratioMax.toFixed(2)}); in-process A B B A ${v.ratioMedian.toFixed(2)}`).join('; ')}`,
    result: 'not run',
    why: `The gate is defined on the whole simulation step on desktop Chromium and the phone WebView; this early reading measures two kernels in the container only. At kernel level the worst round of any scalar-path cell is ${worst((k) => k.startsWith('aot|') && k.endsWith('|scalar')).toFixed(2)}x.`,
  },
  notRun: ['the whole step as WebAssembly (T6.4, T1.6b)', 'the phone WebView (round 1)', 'peak WebAssembly memory (T1.6b)'],
};
fs.writeFileSync(outFile, JSON.stringify(doc, null, 1));
console.log(md.join('\n'));
