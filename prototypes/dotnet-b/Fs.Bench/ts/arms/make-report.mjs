#!/usr/bin/env node
/**
 * T1.5 (a)-(c): turns the run files of `run-arms.sh` into the tables of reports/1-ts-arms.md (written to RESULTS/tables.md) and into reports/1-ts-arms.json (schema: reports/RESULTS-SCHEMA.md).
 *   node prototypes/dotnet-b/Fs.Bench/ts/arms/make-report.mjs RESULTS OUT.json COMMIT [CONDITIONS.json]
 * The C# numbers are read from reports/1-air-kernels.json and reports/1-fast-kernels.json (BenchmarkDotNet, earlier runs on the same container); a ratio is TypeScript median over C# median.
 * Aggregation: each (engine, arm, workers, problem, kernel) has one median per run (a fresh process); the table shows the median of those medians and the min to max of the run medians.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const reports = path.resolve(here, '..', '..', '..', 'reports');
const [resDir, outJson, commit = 'unknown', condFile] = process.argv.slice(2);
if (!resDir || !outJson) {
  console.error('usage: make-report.mjs RESULTS OUT.json COMMIT [CONDITIONS.json]');
  process.exit(2);
}
const files = fs.readdirSync(resDir).filter((f) => f.endsWith('.json') && !['tables.json'].includes(f) && /^(time|abba|verify|spin)-/.test(f));
const docs = files.map((f) => ({ f, ...JSON.parse(fs.readFileSync(path.join(resDir, f), 'utf8')) }));
const med = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const fmt = (x, d = 4) => (x === undefined || x === null || Number.isNaN(x) ? '-' : x.toFixed(d));

// ───────── timing aggregation ─────────
// key: group|engine|arm|threads|problem|kernel  ->  { runs: [stats...], loads: [...] }
const agg = new Map();
for (const d of docs) {
  if (!/^(time|abba)-/.test(d.f) || !d.result?.stats) continue;
  const group = d.f.startsWith('abba') ? 'abba' : 'main';
  const arm = d.arm === 'app' ? 'app' : `pool${d.threads}`;
  for (const s of d.result.stats) {
    const k = [group, d.runtime, arm, d.problem, s.kernel].join('|');
    if (!agg.has(k)) agg.set(k, { group, engine: d.runtime, arm, threads: d.arm === 'app' ? 1 : d.threads, problem: d.problem, kernel: s.kernel, stats: [], loads: [], per: s.per, minSampleMs: d.minSampleMs, spin: d.spinUs });
    const e = agg.get(k);
    e.stats.push(s);
    e.loads.push(d.host?.loadavgStart?.[0]);
  }
}
const get = (group, engine, arm, problem, kernel) => agg.get([group, engine, arm, problem, kernel].join('|'));
const medOf = (e) => (e ? med(e.stats.map((s) => s.medianMs)) : undefined);
const range = (e) => (e ? `${fmt(Math.min(...e.stats.map((s) => s.medianMs)))} to ${fmt(Math.max(...e.stats.map((s) => s.medianMs)))}` : '-');
// net of the restore for reinit (each arm subtracts its own restore)
const netMed = (group, engine, arm, problem, kernel) => {
  const m = medOf(get(group, engine, arm, problem, kernel));
  if (kernel === 'reinit') return m - (medOf(get(group, engine, arm, problem, 'restore')) ?? 0);
  return m;
};

const problems = ['air:k3std', 'air:k6high', 'fast:k6f-900', 'fast:k6f-late'];
const kernelsOf = { air: ['relax', 'gradient', 'divergenceF32', 'divergenceF64', 'advect'], fast: ['evalStage1', 'evalStage2', 'reinit', 'pyro'] };
const pname = (p) => ({ 'air:k3std': 'katoomba3-standard 3 km, 30x30x20 (the app grid)', 'air:k6high': '6 km high tier, 60x60x24', 'fast:k6f-900': 'katoomba6-fast-4h at 900 s (band 1,606)', 'fast:k6f-late': 'katoomba6-fast-4h at 14,100 s (band 9,690)' }[p] ?? p);
const nodeArms = ['app', 'pool1', 'pool2', 'pool4', 'pool8'];
const chrArms = ['pool1', 'pool2', 'pool4', 'pool8'];
let md = '';
const out = (s = '') => { md += s + '\n'; };

// ───────── 1. hash equality ─────────
out('## Hash equality\n');
out('One row = every verify run of one engine and problem: the app kernels in one worker and the pool on 1, 2, 4, 8 workers, each with the default thresholds and with the chunked paths forced (10 runs). The digest is a hash of every hash the run computed; "digests" counts how many different ones the 10 runs gave.\n');
out('| engine | problem | runs | cases per run | hash checks per run | mismatches against the golden (Node 22) hashes, all runs | digests |');
out('|---|---|---:|---:|---:|---:|---:|');
const ver = docs.filter((d) => d.f.startsWith('verify-'));
const groups = new Map();
for (const d of ver) {
  const k = `${d.runtime}|${d.problem}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(d);
}
for (const [k, g] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
  const [engine, problem] = k.split('|');
  out(`| ${engine} | ${problem} | ${g.length} | ${g[0].result.verify.cases} | ${g[0].result.verify.checks} | ${g.reduce((a, d) => a + d.result.verify.mismatches, 0)} | ${new Set(g.map((d) => d.result.verify.digest)).size} |`);
}
out('');

// ───────── 2. timing per kernel ─────────
const best = {}; // for the ratio table: problem|kernel -> { nodeBest:{arm,ms}, chrBest:{arm,ms} }
for (const p of problems) {
  const kind = p.split(':')[0];
  out(`\n## ${pname(p)}: median ms per operation, Node 22 (V8 12.4), single operations; median of the run medians (min to max)\n`);
  out('| kernel | app kernels, one worker (a) | pool 1 worker | pool 2 | pool 4 | pool 8 | best Node arm |');
  out('|---|---:|---:|---:|---:|---:|---|');
  for (const k of kernelsOf[kind]) {
    const cells = nodeArms.map((a) => get('main', 'v8-node', a, p, k));
    let bestArm = null, bestMs = Infinity;
    nodeArms.forEach((a, i) => { const m = netMed('main', 'v8-node', a, p, k); if (cells[i] && m < bestMs) { bestMs = m; bestArm = a; } });
    best[`${p}|${k}`] = { node: { arm: bestArm, ms: bestMs } };
    const net = k === 'reinit' ? ' (with the restore)' : '';
    out(`| ${k}${net} | ${nodeArms.map((a, i) => (cells[i] ? `${fmt(medOf(cells[i]))} (${range(cells[i])})` : '-')).join(' | ')} | ${bestArm ?? '-'} ${fmt(bestMs)}${k === 'reinit' ? ' net' : ''} |`);
  }
  if (kind === 'fast') {
    const r = nodeArms.map((a) => medOf(get('main', 'v8-node', a, p, 'restore')));
    out(`| restore alone (subtracted from reinit above in the "best" column) | ${r.map((x) => fmt(x)).join(' | ')} | |`);
  }
}

// ───────── 3. thread curve ─────────
out('\n## TypeScript thread curve (Node, pool on the C# chunks): speed-up over the pool with 1 worker, and over the app kernels in one worker (above 1 = faster)\n');
out('| problem | kernel | 2 workers | 4 workers | 8 workers (no spinning: 4 cores) | 4 workers over the app kernels |');
out('|---|---|---:|---:|---:|---:|');
for (const p of problems) for (const k of kernelsOf[p.split(':')[0]]) {
  const m = (a) => netMed('main', 'v8-node', a, p, k);
  const sp = (a) => fmt(m('pool1') / m(a), 2);
  out(`| ${p} | ${k} | ${sp('pool2')} | ${sp('pool4')} | ${sp('pool8')} | ${fmt(m('app') / m('pool4'), 2)} |`);
}

// ───────── 4. browser ─────────
out('\n## Browser worker against Node worker (the app kernels, one worker, batched samples of at least 2 ms, A B B A: Node, Chromium, Chromium, Node, three rounds)\n');
out('| problem | kernel | Node ms (median of 6 runs; min to max) | Chromium ms (6 runs) | Chromium over Node |');
out('|---|---|---:|---:|---:|');
const abbaRatios = [];
for (const p of problems) for (const k of kernelsOf[p.split(':')[0]]) {
  const n = get('abba', 'v8-node', 'app', p, k), c = get('abba', 'v8-chromium', 'app', p, k);
  if (!n || !c) continue;
  const r = netMed('abba', 'v8-chromium', 'app', p, k) / netMed('abba', 'v8-node', 'app', p, k);
  abbaRatios.push({ p, k, r });
  out(`| ${p} | ${k} | ${fmt(medOf(n))} (${range(n)}) | ${fmt(medOf(c))} (${range(c)}) | ${fmt(r, 3)} |`);
}
if (abbaRatios.length) out(`\nChromium over Node, all ${abbaRatios.length} kernel cells: median ${fmt(med(abbaRatios.map((x) => x.r)), 3)}, min ${fmt(Math.min(...abbaRatios.map((x) => x.r)), 3)}, max ${fmt(Math.max(...abbaRatios.map((x) => x.r)), 3)}.`);
out('\n## Chromium thread curve (cross-origin isolated page, pool on the C# chunks, batched samples): median ms per operation\n');
out('| problem | kernel | Chromium app kernels, 1 worker (from the A B B A) | pool 1 | pool 2 | pool 4 | pool 8 | pool 4 in Node (single operations) |');
out('|---|---|---:|---:|---:|---:|---:|---:|');
for (const p of problems) for (const k of kernelsOf[p.split(':')[0]]) {
  const c = chrArms.map((a) => get('main', 'v8-chromium', a, p, k));
  let bestC = { arm: 'app', ms: netMed('abba', 'v8-chromium', 'app', p, k) };
  chrArms.forEach((a, i) => { if (c[i]) { const m = netMed('main', 'v8-chromium', a, p, k); if (m < bestC.ms) bestC = { arm: a, ms: m }; } });
  best[`${p}|${k}`].chromium = bestC;
  out(`| ${p} | ${k} | ${fmt(medOf(get('abba', 'v8-chromium', 'app', p, k)))} | ${c.map((e) => (e ? `${fmt(medOf(e))} (${range(e)})` : '-')).join(' | ')} | ${fmt(medOf(get('main', 'v8-node', 'pool4', p, k)))} |`);
}

// ───────── 5. ratio to C# ─────────
const cs = {};
for (const jf of ['1-air-kernels.json', '1-fast-kernels.json']) {
  const j = JSON.parse(fs.readFileSync(path.join(reports, jf), 'utf8'));
  for (const r of j.runs) {
    const m = /^(air|fast) (\w+) (Scalar|Vector|Parallel4|ParallelVector4) \[(.+)\]$/.exec(r.name);
    if (m) cs[`${m[1]}:${m[4].replace('fx-', '')}|${m[2]}|${m[3]}`] = r.medianMs;
  }
}
const csTime = (p, k, form) => {
  const v = cs[`${p}|${k}|${form}`];
  if (k !== 'reinit') return v;
  return v - cs[`${p}|restore|Scalar`];
};
const forms = ['Scalar', 'Vector', 'Parallel4', 'ParallelVector4'];
out('\n## Best TypeScript arm against C# (TypeScript median over C# median; above 1 = C# faster)\n');
out('C# numbers: BenchmarkDotNet default job, one process per case, from reports/1-air-kernels.json and 1-fast-kernels.json (EARLIER runs on the same container, not run together with these); reinit net of the restore on both sides. Best Node arm = the fastest of the app kernels in one worker and the pool on 1, 2, 4, 8 workers.\n');
out('| problem | kernel | best Node arm | TS ms | vs C# scalar | vs C# Vector128 | vs C# Parallel x4 | vs C# Parallel x4 + Vector128 | vs best C# form | app kernels in one worker vs C# scalar |');
out('|---|---|---|---:|---:|---:|---:|---:|---:|---:|');
const ratioRows = [];
for (const p of problems) for (const k of kernelsOf[p.split(':')[0]]) {
  const b = best[`${p}|${k}`]?.node;
  if (!b?.arm) continue;
  const c = forms.map((f) => csTime(p, k, f));
  const bestC = Math.min(...c);
  const appMs = netMed('main', 'v8-node', 'app', p, k);
  ratioRows.push({ p, k, tsArm: b.arm, tsMs: b.ms, csMs: Object.fromEntries(forms.map((f, i) => [f, c[i]])), ratios: Object.fromEntries(forms.map((f, i) => [f, b.ms / c[i]])), vsBest: b.ms / bestC, appVsScalar: appMs / c[0], chromiumBest: best[`${p}|${k}`].chromium });
  out(`| ${p} | ${k} | ${b.arm} | ${fmt(b.ms)} | ${c.map((x) => fmt(b.ms / x, 2)).join(' | ')} | ${fmt(b.ms / bestC, 2)} | ${fmt(appMs / c[0], 2)} |`);
}
out('\nThe same, for Gate 1W: the best Chromium arm (the app kernels in one worker, or the pool) in place of the Node arm.\n');
out('| problem | kernel | best Chromium arm | TS ms | vs best C# form (native) |');
out('|---|---|---|---:|---:|');
for (const r of ratioRows) if (r.chromiumBest) out(`| ${r.p} | ${r.k} | ${r.chromiumBest.arm} | ${fmt(r.chromiumBest.ms)} | ${fmt(r.chromiumBest.ms / Math.min(...Object.values(r.csMs)), 2)} |`);

// ───────── 5b. projection ─────────
// T1.1's shares of the step (reports/1-profile.md; quoted in 1-air-kernels.md section 5 and 1-fast-kernels.md section 6). Everything not listed is "no faster" in every arm.
const shares = [
  { name: 'standard tier (katoomba3-standard, 30x30x20)', p: 'air:k3std', items: [['relax', ['relax'], 0.151], ['advect', ['advect'], 0.093], ['divergence', ['divergenceF32'], 0.054], ['gradient', ['gradient'], 0.050]], bar: 1.5 },
  { name: 'fast tier, 30-minute shares, 900 s frame', p: 'fast:k6f-900', items: [['evaluate', ['evalStage1', 'evalStage2'], 0.030], ['reinit', ['reinit'], 0.029], ['pyrogenic solve', ['pyro'], 0.084]], bar: 1.2 },
  { name: 'fast tier, 4-hour shares, 14,100 s frame', p: 'fast:k6f-late', items: [['evaluate', ['evalStage1', 'evalStage2'], 0.136], ['reinit', ['reinit'], 0.101], ['pyrogenic solve', ['pyro'], 0.092]], bar: 1.2 },
];
const projection = [];
out("\n## Projected whole-step effect of the kernels (arithmetic on T1.1's shares; every other phase of the step taken as no faster in every arm)\n");
out("A kernel's time is taken as a fraction of its time in the app kernels in one worker (this run). New step = 1 - sum of shares + sum of share x fraction. \"C# best forms\" = the fastest of the four C# forms per kernel (earlier BenchmarkDotNet runs); \"best TypeScript\" = the fastest Node arm per kernel (app kernels in one worker, or the pool on 1, 2, 4, 8 workers).\n");
out("| tier | C# scalar over TypeScript one worker | C# best forms over TypeScript one worker | best TypeScript over TypeScript one worker | **C# best forms over best TypeScript** | Gate 1 bar (over the best TypeScript arm) | the kernels' Amdahl ceiling |");
out('|---|---:|---:|---:|---:|---:|---:|');
for (const t of shares) {
  let fScalar = 1, fCs = 1, fTs = 1, tot = 0;
  const parts = [];
  for (const [label, ks, sh] of t.items) {
    const a = ks.reduce((x, k) => x + netMed('main', 'v8-node', 'app', t.p, k), 0);
    const b = ks.reduce((x, k) => x + (best[`${t.p}|${k}`]?.node.ms ?? NaN), 0);
    const cS = ks.reduce((x, k) => x + csTime(t.p, k, 'Scalar'), 0);
    const cB = ks.reduce((x, k) => x + Math.min(...forms.map((f) => csTime(t.p, k, f))), 0);
    fScalar += sh * (cS / a - 1); fCs += sh * (cB / a - 1); fTs += sh * (b / a - 1); tot += sh;
    parts.push({ kernel: label, share: sh, appMs: a, bestTsMs: b, csScalarMs: cS, csBestMs: cB });
  }
  projection.push({ tier: t.name, problem: t.p, csScalarOverTs1: 1 / fScalar, csBestOverTs1: 1 / fCs, bestTsOverTs1: 1 / fTs, csBestOverBestTs: fTs / fCs, bar: t.bar, ceiling: 1 / (1 - tot), parts });
  out(`| ${t.name} | ${fmt(1 / fScalar, 3)}x | ${fmt(1 / fCs, 3)}x | ${fmt(1 / fTs, 3)}x | **${fmt(fTs / fCs, 3)}x** | ${t.bar}x | ${fmt(1 / (1 - tot), 3)}x |`);
}

// ───────── 6. spin ─────────
const spin = docs.filter((d) => d.f.startsWith('spin-'));
if (spin.length) {
  out('\n## Spin-wait sensitivity (pool, Node, medians of one run each, ms per operation)\n');
  out('| problem | workers | spin us | ' + [...new Set(spin.flatMap((d) => d.result.stats.map((s) => s.kernel)))].join(' | ') + ' |');
  out('|---|---:|---:|' + [...new Set(spin.flatMap((d) => d.result.stats.map((s) => s.kernel)))].map(() => '---:').join('|') + '|');
  const ks = [...new Set(spin.flatMap((d) => d.result.stats.map((s) => s.kernel)))];
  for (const d of spin.sort((a, b) => a.f.localeCompare(b.f))) out(`| ${d.problem} | ${d.threads} | ${d.spinUs} | ${ks.map((k) => fmt(d.result.stats.find((s) => s.kernel === k)?.medianMs)).join(' | ')} |`);
}

// ───────── conditions ─────────
const loads = docs.filter((d) => d.host?.loadavgStart).map((d) => d.host.loadavgStart[0]);
out(`\nProcesses: ${docs.length} run files; 1-minute load average at the start of a timed process: min ${fmt(Math.min(...loads), 2)}, median ${fmt(med(loads), 2)}, max ${fmt(Math.max(...loads), 2)}.`);
fs.writeFileSync(path.join(resDir, 'tables.md'), md);
console.log(md);

// ───────── JSON ─────────
const host = docs.find((d) => d.host?.node)?.host ?? {};
const chr = docs.find((d) => d.browser);
const runs = [];
for (const e of agg.values()) {
  const ms = e.stats.map((s) => s.medianMs);
  runs.push({
    name: `ts ${e.kernel} ${e.engine === 'v8-node' ? 'node' : 'chromium'} ${e.arm}${e.group === 'abba' ? ' abba' : ''} [${e.problem}]`,
    impl: e.arm === 'app' ? 'ts-app-worker' : 'ts-pool', runtime: e.engine, threads: e.threads, case: e.problem, kernel: e.kernel,
    n: e.stats.reduce((a, s) => a + s.n, 0), medianMs: med(ms), p95Ms: med(e.stats.map((s) => s.p95Ms)), minMs: Math.min(...ms), maxMs: Math.max(...ms), runMedians: ms,
    samplePer: e.per, spinUs: e.spin, loadavgAtStart: e.loads,
    notes: `${e.arm === 'app' ? "the app's unmodified kernels in one worker, data resident, timed inside the worker" : 'range forms on the C# chunks over a SharedArrayBuffer, worker 0 takes part'}; ${e.engine === 'v8-node' ? 'Node worker_threads' : 'Chromium Web Worker, isolated page'}; median of ${ms.length} runs' medians (minMs and maxMs are the lowest and highest run median), one run = one fresh process${e.minSampleMs > 0 ? `, samples of ${e.per} batched operations` : ', single operations per sample'}`,
  });
}
const hashRuns = ver.map((d) => ({ engine: d.runtime, arm: d.arm, threads: d.arm === 'app' ? 1 : d.threads, problem: d.problem, forced: d.f.includes('-forced'), cases: d.result.verify.cases, checks: d.result.verify.checks, mismatches: d.result.verify.mismatches, digest: d.result.verify.digest, failed: d.result.verify.mismatches ? d.result.verify.failed : undefined }));
const doc = {
  stage: '1-ts-arms',
  when: new Date().toISOString(),
  machine: { label: 'container', cpu: host.cpu, cores: host.cores, os: 'Linux x64 (container, 4 shared vCPUs)', runtime: `Node ${host.node} (V8 ${host.v8})`, node: host.node, v8: host.v8, chromium: chr?.browser?.version, chromiumV8: chr?.browser?.v8, chromiumCrossOriginIsolated: chr?.page?.crossOriginIsolated },
  indicative: true,
  build: { configuration: 'Release', commit },
  runs,
  hashChecks: hashRuns,
  tsVsCsharp: ratioRows,
  projection,
  conditions: condFile && fs.existsSync(condFile) ? (condFile.endsWith('.log') ? { loadAverageLog: fs.readFileSync(condFile, 'utf8').split('\n').filter(Boolean) } : JSON.parse(fs.readFileSync(condFile, 'utf8'))) : undefined,
  gate: { bar: 'Gate 1: native C# against the best TypeScript arm (standard tier 1.5x, fast tier 1.2x of the whole step); Gate 1W: C# WebAssembly at most 1.25x the TypeScript worker', measured: 'kernel level only (this card builds the opponents; the ratios are in tsVsCsharp)', result: 'not run', why: 'both gates are defined on the whole step (T1.7, T6.4, T6.6); T1.5 (a)-(c) supplies the TypeScript arms' },
  notRun: ['Android WebView and the phone (round 1)', 'whole-step timing of the pool forms (kernels only)', 'Firefox and Safari engines'],
};
fs.writeFileSync(outJson, JSON.stringify(doc, null, 1));
console.error(`wrote ${outJson}: ${runs.length} runs, ${hashRuns.length} hash-check files`);
