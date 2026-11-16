// T1.3: collects every measurement of the FsMath comparison into reports/1-fsmath.json (schema: reports/RESULTS-SCHEMA.md, stage "1-fsmath") and prints the markdown
// tables of reports/1-fsmath.md.
//   node make-results.mjs DATA_DIR SPEED_DIR OUT.json [TABLES.md]
// DATA_DIR/{synthetic,recorded,stress}/ hold the input files, the result files {fn}.{tag}.f64 and the cr-check.json of each set (see reports/1-fsmath.md for how each was made);
// SPEED_DIR holds x64-bdn.json (BenchmarkDotNet's report), x64-ns.json (fsmath-ns), x64-ns-noavx.json, js-node.json, js-chromium.json, wasm-{aot,interp}-{node,chromium}-ns.json.
import fs from 'node:fs';
import { compare } from './compare.mjs';

const [data, speed, outJson, outMd] = process.argv.slice(2);
const FNS = ['exp', 'log', 'pow', 'sin', 'cos', 'tan', 'atan', 'atan2', 'acos', 'asin', 'sinh', 'cbrt', 'log2', 'log10', 'hypot'];
const SETS = ['synthetic', 'recorded', 'stress'];
const exists = (p) => fs.existsSync(p);
const load = (p) => { const b = fs.readFileSync(p); return new Uint32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
const readJson = (p) => (exists(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null);

const out = { stage: '1-fsmath', when: new Date().toISOString(), indicative: true, sets: {}, mismatch: {}, identity: {}, correctness: {}, speed: {}, notRun: [] };
const md = [];
const pct = (r) => (r === 0 ? '0' : (100 * r).toFixed(r < 0.001 ? 3 : 2));

// ---- inputs ----
for (const set of SETS) {
  const meta = readJson(`${data}/${set}/inputs.json`);
  out.sets[set] = meta;
}

// ---- mismatch tables: each reference engine against each candidate ----
const refs = { node22: ['fdlibm', 'cms', 'platform', 'chromium', 'node22-jitless'], chromium: ['node22', 'fdlibm', 'cms', 'platform'] };
for (const set of SETS) {
  out.mismatch[set] = {};
  for (const [ref, cands] of Object.entries(refs)) {
    out.mismatch[set][ref] = {};
    for (const fn of FNS) {
      const pr = `${data}/${set}/${fn}.${ref}.f64`;
      if (!exists(pr)) continue;
      const a = load(pr);
      const row = (out.mismatch[set][ref][fn] = {});
      for (const c of cands) {
        const pc = `${data}/${set}/${fn}.${c}.f64`;
        if (!exists(pc)) continue;
        const r = compare(a, load(pc));
        row[c] = { calls: r.calls, mismatches: r.mismatches, rate: r.rate, maxUlp: r.maxUlp, nanVsNumber: r.nanVsNumber, hist: r.hist };
      }
    }
  }
}
function mismatchTable(set, ref, cands, title) {
  md.push(`**${title}**\n`);
  md.push(`| function | calls | ${cands.map((c) => c).join(' | ')} |`);
  md.push(`|---|---:|${cands.map(() => '---:').join('|')}|`);
  for (const fn of FNS) {
    const row = out.mismatch[set][ref][fn];
    if (!row) continue;
    const first = Object.values(row)[0];
    md.push(`| ${fn} | ${first.calls.toLocaleString('en-US')} | ${cands.map((c) => (row[c] ? `${row[c].mismatches.toLocaleString('en-US')} (${pct(row[c].rate)} %, max ${row[c].maxUlp === 'inf (NaN vs number)' ? 'NaN' : row[c].maxUlp} ulp)` : '-')).join(' | ')} |`);
  }
  md.push('');
}
for (const set of SETS) {
  mismatchTable(set, 'node22', refs.node22, `${set} inputs: Node 22 (V8 12.4) as the reference`);
  mismatchTable(set, 'chromium', refs.chromium, `${set} inputs: Chromium (V8 15.3) as the reference`);
}

// ---- Node's interpreter-only mode (node --jitless) against its optimising compiler: compare.mjs made cmp-node22.json before the 8 MB result files were deleted ----
out.jitless = {};
for (const set of SETS) {
  const j = readJson(`${data}/${set}/cmp-node22.json`);
  if (!j) continue;
  out.jitless[set] = Object.fromEntries(Object.entries(j.result).map(([fn, r]) => [fn, r['node22-jitless']?.mismatches]));
}

// ---- correctly rounded check (mpmath) ----
for (const set of SETS) {
  const j = readJson(`${data}/${set}/cr-check.json`);
  if (!j) continue;
  out.correctness[set] = j;
}
md.push('**Distance from the correctly rounded value (mpmath, 400 bits; a sample of each set)**\n');
for (const set of SETS) {
  const j = out.correctness[set];
  if (!j) continue;
  md.push(`${set} (${j.maxCallsPerFunction} calls per function at most):\n`);
  md.push('| function | checked | FdLibm not CR (max ulp) | CoreMathSharp not CR (max ulp) | Node 22 not CR (max ulp) |');
  md.push('|---|---:|---:|---:|---:|');
  for (const fn of FNS) {
    const r = j.result[fn];
    if (!r) continue;
    const f = (k) => { const s = r.impls[k]; if (!s) return '-'; return `${s.notCorrectlyRounded} (${s.nanVsNumber ? 'NaN vs number: ' + s.nanVsNumber + '; ' : ''}${s.maxUlp >= 2 ** 40 ? 'NaN' : s.maxUlp})`; };
    md.push(`| ${fn} | ${r.checked} | ${f('fdlibm')} | ${f('cms')} | ${f('node22')} |`);
  }
  md.push('');
}

// ---- WebAssembly and x64 identity ----
const variants = ['wasm-aot-node', 'wasm-aot-chromium', 'wasm-interp-node', 'wasm-interp-chromium'];
for (const v of variants) {
  // wasm-identity.mjs compared the files (and deleted them: 8 MB each) and left identity-VARIANT.json
  out.identity[v] = readJson(`${data}/identity-${v}.json`)?.sets ?? Object.fromEntries(SETS.map((s) => [s, {}]));
}
md.push('**WebAssembly against linux-x64 (bits compared with the x64 output of the same implementation; NaN equals NaN)**\n');
md.push('| build, engine | set | FdLibm: calls, mismatches | CoreMathSharp: calls, mismatches |');
md.push('|---|---|---:|---:|');
for (const v of variants) for (const set of SETS) {
  const r = out.identity[v][set];
  if (!r.fdlibm && !r.cms) continue;
  md.push(`| ${v} | ${set} | ${r.fdlibm ? `${r.fdlibm.calls.toLocaleString('en-US')}, ${r.fdlibm.mismatches}` : '-'} | ${r.cms ? `${r.cms.calls.toLocaleString('en-US')}, ${r.cms.mismatches}` : '-'} |`);
}
md.push('');

// ---- digests (reproducibility) ----
out.digests = {};
for (const set of SETS) {
  out.digests[set] = {};
  for (const run of fs.readdirSync(`${data}/${set}`).filter((f) => /^run-.*\.json$/.test(f))) out.digests[set][run.replace(/^run-|\.json$/g, '')] = readJson(`${data}/${set}/${run}`);
}

// ---- speed ----
const sp = {};
for (const f of ['x64-ns', 'x64-ns-noavx', 'js-node', 'js-chromium', 'wasm-aot-node-ns', 'wasm-aot-chromium-ns', 'wasm-interp-node-ns', 'wasm-interp-chromium-ns']) sp[f] = readJson(`${speed}/${f}.json`);
out.speed = sp;
const bdn = readJson(`${speed}/x64-bdn.json`);
out.speed['x64-bdn'] = bdn ? { host: bdn.HostEnvironmentInfo, benchmarks: bdn.Benchmarks.map((b) => ({ fn: b.Parameters.replace('Fn=', ''), method: b.Method, description: b.Descriptor?.DisplayInfo, nsMean: b.Statistics?.Mean, nsMedian: b.Statistics?.Median, nsStdDev: b.Statistics?.StandardDeviation, n: b.Statistics?.N })) } : null;
const get = (j, fn, impl) => j?.rows?.find((r) => r.fn === fn && r.impl === impl)?.nsMedian;
md.push('**ns per call (median of 15 repeats of 65,536 calls; the same loop everywhere)**\n');
md.push('| function | x64 platform Math | x64 FdLibm | x64 CoreMathSharp | x64 CMS, software FMA | Node 22 Math | Chromium Math | wasm AOT FdLibm (Node / Chromium) | wasm AOT CMS (Node / Chromium) | wasm interp FdLibm (Node) | wasm interp CMS (Node) |');
md.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
const f1 = (x) => (x === undefined ? '-' : x.toFixed(1));
for (const fn of FNS) {
  md.push(`| ${fn} | ${f1(get(sp['x64-ns'], fn, 'platform'))} | ${f1(get(sp['x64-ns'], fn, 'fdlibm'))} | ${f1(get(sp['x64-ns'], fn, 'cms'))} | ${f1(get(sp['x64-ns-noavx'], fn, 'cms'))} | ${f1(get(sp['js-node'], fn, 'js-math'))} | ${f1(get(sp['js-chromium'], fn, 'js-math'))} | ${f1(get(sp['wasm-aot-node-ns'], fn, 'fdlibm'))} / ${f1(get(sp['wasm-aot-chromium-ns'], fn, 'fdlibm'))} | ${f1(get(sp['wasm-aot-node-ns'], fn, 'cms'))} / ${f1(get(sp['wasm-aot-chromium-ns'], fn, 'cms'))} | ${f1(get(sp['wasm-interp-node-ns'], fn, 'fdlibm'))} | ${f1(get(sp['wasm-interp-node-ns'], fn, 'cms'))} |`);
}
md.push('');

// ---- the schema's runs[] list: one row per (function, implementation, runtime) ----
out.machine = { label: 'container', cpu: 'Intel(R) Xeon(R) Processor @ 2.10GHz', cores: 4, os: 'Linux 6.18 x64', runtime: '.NET 11.0.0 (CoreCLR x64), Mono wasm 11.0.0, Node 22.22.0 (V8 12.4.254.21-node.33), Chromium 153.0.8010.12 (V8 15.3.76.4)' };
out.runs = [];
const addRows = (j, runtime, implMap = (x) => x) => { for (const r of j?.rows ?? []) out.runs.push({ name: `${r.fn} ${implMap(r.impl)}`, impl: implMap(r.impl), runtime, threads: 1, n: r.n * r.repeats, medianMs: r.nsMedian / 1e6, p95Ms: r.nsMax / 1e6, minMs: r.nsMin / 1e6, maxMs: r.nsMax / 1e6, unit: 'ms per call', nsPerCall: r.nsMedian, notes: `median of ${r.repeats} repeats of ${r.n} calls` }); };
addRows(sp['x64-ns'], 'coreclr');
addRows(sp['x64-ns-noavx'], 'coreclr', (i) => `${i}-no-avx2`);
addRows(sp['js-node'], 'v8-node');
addRows(sp['js-chromium'], 'v8-chromium');
addRows(sp['wasm-aot-node-ns'], 'mono-wasm-aot', (i) => `${i}-node`);
addRows(sp['wasm-aot-chromium-ns'], 'mono-wasm-aot', (i) => `${i}-chromium`);
addRows(sp['wasm-interp-node-ns'], 'mono-wasm-interp', (i) => `${i}-node`);
addRows(sp['wasm-interp-chromium-ns'], 'mono-wasm-interp', (i) => `${i}-chromium`);

// ---- the card's "done when", facts recorded by hand from runs whose outputs were too large to keep (see reports/1-fsmath.md sections 5 and 6) ----
out.gate = {
  bar: 'T1.3 done when: the mismatch and speed tables exist, and both candidates (FdLibm, CoreMathSharp) give identical bits on x64 and WebAssembly',
  measured: 'mismatch tables (3 input sets x 2 reference engines) and speed tables (x64, Node, Chromium, wasm AOT and interpreter) exist; identity: 0 mismatches in 24 cells of 23.4 million calls per implementation',
  result: 'pass',
  why: 'FdLibm equals Node 22 on 100 % of 23.4 million calls; CoreMathSharp equals Chromium 153 on 11 of 15 functions; both identical across linux-x64 JIT/hardware settings and Mono WebAssembly (AOT and interpreter, Node and Chromium)',
};
out.envMatrix = { settings: ['default', 'DOTNET_EnableAVX2=0', 'DOTNET_EnableHWIntrinsic=0', 'DOTNET_TieredCompilation=0', 'DOTNET_TieredPGO=0', 'DOTNET_ReadyToRun=0', 'DOTNET_EnableSSE41=0', 'DOTNET_EnableAVX2=0 DOTNET_EnableFMA=0 DOTNET_EnableAVX=0'], sets: ['synthetic', 'stress'], filesPerSet: 30, differFromDefault: 0, note: 'fsmath-run SHA-256 of every output file compared with the default process' };
out.coreMathVectors = { source: 'CoreMathSharp.Tests/Binary64/*.txt at 7e70c831 (CORE-MATH C functions)', functionsChecked: 13, differ: 0, pow: { vectors: 1193, differ: 5, why: 'pow(+-1, +-Infinity) and pow(1, NaN): C99 gives 1, JavaScript gives NaN' }, atan2Note: 'the vector files list the arguments as (x, y)' };
out.notRun = [
  'linux-arm64 (no arm64 machine in the container): CoreMathSharp\'s AdvSimd fused multiply-add path and RyuJIT on arm64 not exercised; T4.5 runtime test (plan 10.2)',
  'CoreCLR WebAssembly (UseMonoRuntime=false) and Mono with threads: not part of T1.3 (T1.6b)',
  'the correctly-rounded check covers a sample (20,000 calls per function and set), not all 10^6',
  'timings of a phone, WebView or a quiet machine: container numbers are indicative',
];
fs.writeFileSync(outJson, JSON.stringify(out, null, 1));
if (outMd) fs.writeFileSync(outMd, md.join('\n'));
console.log(`wrote ${outJson}${outMd ? ' and ' + outMd : ''}`);
