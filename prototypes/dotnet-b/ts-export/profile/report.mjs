#!/usr/bin/env node
/**
 * Turns analyze.mjs's summary into reports/1-profile.json (RESULTS-SCHEMA.md) and prints the markdown tables the report uses.
 *
 *   node prototypes/dotnet-b/ts-export/profile/report.mjs --summary SUMMARY.json --json prototypes/dotnet-b/reports/1-profile.json [--tables TABLES.md]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const opt = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const S = JSON.parse(readFileSync(opt('summary'), 'utf8'));
const NAMES = Object.keys(S.scenarios);
const PH = ['air', 'fire', 'coupling', 'embers', 'moisture', 'detectors', 'picture', 'checkpoints', 'other'];
const f1 = (x) => x.toFixed(1);
const cell = (st, d = 1) => `${st.median.toFixed(d)} (${st.min.toFixed(d)} to ${st.max.toFixed(d)})`;
const md = [];

// 1 phase shares
for (const n of NAMES) {
  const s = S.scenarios[n];
  md.push(`### ${n} (${s.tier} tier): share of the step loop (advance, ${s.steps.advanceSteps} steps, ${s.simSeconds} s), %`);
  md.push('');
  md.push('| phase | CPU profile, median (min to max) | the app\'s own timers, profiler off | note |');
  md.push('|---|---|---|---|');
  for (const ph of PH) md.push(`| ${ph} | ${cell(s.phaseShareAdvancePct[ph])} | ${cell(s.appTimersShareAdvancePct[ph])} | |`);
  md.push('');
}
// 2 kernels
for (const n of NAMES) {
  const s = S.scenarios[n];
  md.push(`### ${n}: hottest functions by self time (share of the step loop, %, median of ${s.runs} runs)`);
  md.push('');
  md.push('| function | file | share, median (min to max) | self ms, median |');
  md.push('|---|---|---|---|');
  for (const k of s.kernelsAdvance.slice(0, 12)) {
    const [fn, file] = k.kernel.split(' ');
    md.push(`| ${fn} | ${file} | ${cell(k.sharePct)} | ${k.selfMs.median.toFixed(0)} |`);
  }
  md.push('');
}
// 3 counts
const FNS = ['exp', 'log', 'pow', '**', 'sin', 'cos', 'tan', 'atan', 'atan2', 'acos', 'asin', 'cbrt', 'hypot'];
for (const n of NAMES) {
  const s = S.scenarios[n];
  const c = s.counts;
  if (!c) continue;
  md.push(`### ${n}: Math calls per solver step (one step = ${(s.simSeconds / c.advanceSteps).toFixed(1)} s of fire on average, ${c.advanceSteps} steps), counted`);
  md.push('');
  md.push(`| phase | ${FNS.join(' | ')} | transcendental total | \`**2\` (squares) | sqrt |`);
  md.push(`|---|${FNS.map(() => '---').join('|')}|---|---|---|`);
  const rows = [...PH.map((ph) => [ph, c.perStepByPhase[ph]]), ['all phases', c.perStepTotal]];
  for (const [ph, m] of rows) {
    const tot = FNS.reduce((a, k) => a + (m[k] ?? 0), 0);
    md.push(`| ${ph} | ${FNS.map((k) => Math.round(m[k] ?? 0).toLocaleString('en')).join(' | ')} | ${Math.round(tot).toLocaleString('en')} | ${Math.round(m['**2'] ?? 0).toLocaleString('en')} | ${Math.round(m.sqrt ?? 0).toLocaleString('en')} |`);
  }
  md.push('');
}
if (opt('tables')) writeFileSync(opt('tables'), md.join('\n') + '\n');
else console.log(md.join('\n'));

// JSON in the RESULTS-SCHEMA shape (stage, machine, runs, gate, notRun) plus the detail
let commit = 'unknown';
try {
  commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {
  /* keep unknown */
}
const first = S.scenarios[NAMES[0]];
const runs = [];
for (const n of NAMES) {
  const s = S.scenarios[n];
  const base = { impl: 'ts', runtime: 'v8-node', threads: 1, n: s.runs };
  runs.push({ ...base, name: `${n} step loop wall (profiler off)`, medianMs: s.wallAdvanceMsPlain.median, p95Ms: s.wallAdvanceMsPlain.max, minMs: s.wallAdvanceMsPlain.min, maxMs: s.wallAdvanceMsPlain.max, notes: `${s.steps.advanceSteps} steps, ${s.simSeconds} s simulated; p95Ms is the max of ${s.runs} runs` });
  if (s.wallSpinUpMsPlain.median > 1) runs.push({ ...base, name: `${n} 3-D spin-up wall (profiler off)`, medianMs: s.wallSpinUpMsPlain.median, p95Ms: s.wallSpinUpMsPlain.max, minMs: s.wallSpinUpMsPlain.min, maxMs: s.wallSpinUpMsPlain.max, notes: '900 s of 3-D air steps before the fire starts' });
  for (const ph of PH) {
    const sh = s.phaseShareAdvancePct[ph];
    const ms = s.profileWindowMs.median * (sh.median / 100);
    runs.push({ ...base, name: `${n} phase ${ph} (CPU profile)`, medianMs: ms, p95Ms: (s.profileWindowMs.max * sh.max) / 100, minMs: (s.profileWindowMs.min * sh.min) / 100, maxMs: (s.profileWindowMs.max * sh.max) / 100, notes: `share of the step loop ${f1(sh.median)} % (min ${f1(sh.min)}, max ${f1(sh.max)}); app timers ${f1(s.appTimersShareAdvancePct[ph].median)} %` });
  }
}
const json = {
  stage: '1-profile',
  when: new Date().toISOString(),
  machine: { label: 'container (shared)', cpu: first.conditions.cpu, cores: first.conditions.cores, os: execFileSync('uname', ['-sr'], { encoding: 'utf8' }).trim(), runtime: `Node ${first.conditions.node} (V8)` },
  indicative: true,
  commit,
  runs,
  gate: { bar: 'phase shares agree with plan 15e within 10 points, or the difference is explained', measured: opt('gate-measured') ?? 'see report', result: opt('gate-result') ?? 'not run', why: opt('gate-why') ?? '' },
  notRun: ['Picture encoding (the exporter does not encode a picture for the page): measured in T5.1', 'Katoomba 6 km standard tier: no such scenario exists; the card now names katoomba3-standard', 'katoomba3-high and the 10 m rows of plan 15e were not profiled (not asked)'],
  detail: S.scenarios,
};
writeFileSync(opt('json'), JSON.stringify(json, null, 1));
console.log(`wrote ${opt('json')}`);
