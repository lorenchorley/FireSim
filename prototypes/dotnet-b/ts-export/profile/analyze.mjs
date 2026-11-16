#!/usr/bin/env node
/**
 * Reads a T1.1 session folder (session.mjs) and writes the summary the report uses.
 *
 *   node prototypes/dotnet-b/ts-export/profile/analyze.mjs --dir SESSION_DIR --out SUMMARY.json
 *
 * What it computes, per scenario:
 *  - from each `node --cpu-prof` profile: the samples inside the simulation window, i.e. with `Simulation.spinUp` or `Simulation.advance` on the
 *    stack (the scenario build, the Simulation constructor with its moisture spin-up, and the final snapshot are outside), split two ways:
 *      by phase (the app's own module taxonomy, `src/sim/perfStats.ts`): a sample belongs to the phase of the function `stepOnce` called that
 *      leads to it (embers.step, FireSpreadModel.step, Atmosphere.step, ...); the 3-D spin-up is its own phase; and
 *      by kernel: self time per (function, source file), with file groups.
 *  - from each run without a profiler: the app's own module timers (`Simulation.perf().modules`) mapped onto the same phases.
 *  - from the counting runs: Math call counts per step and per phase.
 * Spread over runs: median, min and max.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const opt = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const dir = opt('dir');
const outFile = opt('out');
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
const load = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8').trim().split('\n').pop());

const PHASES = ['air', 'fire', 'coupling', 'embers', 'moisture', 'detectors', 'picture', 'checkpoints', 'other'];
// The app's lap -> module map (src/sim/perfStats.ts PERF_LAP_MODULE), `airAt` is nested in surfaceWind and not added again.
const LAP_PHASE = {
  atmosphere: 'air',
  firePrepare: 'fire',
  fireStep: 'fire',
  fireMasks: 'fire',
  fireMinute: 'fire',
  surfaceWind: 'coupling',
  fireHeat: 'coupling',
  embers: 'embers',
  solarMoisture: 'moisture',
  diagnostics: 'detectors',
  explain: 'detectors',
  snapshot: 'picture',
  checkpoint: 'checkpoints',
  records: 'other',
  stamps: 'other',
  weatherNight: 'other',
};
const lapPhase = (l) => LAP_PHASE[l] ?? 'other';

/** The phase of a function that `stepOnce` calls directly (name|source file) */
function childPhase(fn, file) {
  const f = file;
  const is = (re) => re.test(f);
  if (is(/atmosphere\/atmosphere\./) && ['step', 'maxStableDt', 'stepLimit'].includes(fn)) return 'air';
  if (is(/atmosphere\/atmosphere\./) && fn === 'addFireHeat') return 'coupling';
  if (is(/atmosphere\/atmosphere\./) && fn === 'diagnostics') return 'detectors';
  if (is(/sim\/simulation\./) && fn === 'fireWinds') return 'coupling';
  if (is(/atmosphere\/base\./) && ['surfaceWindForFire', 'airAt'].includes(fn)) return 'coupling';
  if (is(/fire\/spread\//) || is(/fire\/terrainFeatures/)) return 'fire';
  if (is(/sim\/stats\./) && fn === 'frontRosBlocks') return 'fire';
  if (is(/embers\//)) return fn === 'setEnvironment' ? 'detectors' : 'embers';
  if (is(/fuel\/moisture\/model\./) || (is(/atmosphere\/base\./) && fn === 'setSurfaceHeating')) return 'moisture';
  if (is(/sim\/simulation\./) && ['solarAt', 'moistureCtx'].includes(fn)) return 'moisture';
  if (is(/explain\//) || (is(/sim\/simulation\./) && ['plumeTop', 'emberEnv', 'view'].includes(fn))) return 'detectors';
  if (is(/sim\/simulation\./) && ['makeSnapshot', 'emitSnapshot', 'coalesceNow'].includes(fn)) return 'picture';
  if (is(/sim\/simulation\./) && fn === 'makeCheckpoint') return 'checkpoints';
  return 'other';
}

/** Kernel groups by source file (a second, coarser cut) */
function fileGroup(file) {
  if (/atmosphere\/pyrogenic/.test(file)) return 'src/atmosphere/pyrogenic (coupling solve)';
  if (/atmosphere\/(solver)/.test(file)) return 'src/atmosphere/solver (elliptic)';
  if (/atmosphere\//.test(file)) return 'src/atmosphere/other';
  if (/fire\/spread\/levelSet/.test(file)) return 'src/fire/spread/levelSet';
  if (/fire\//.test(file)) return 'src/fire/other (spread model, rate models)';
  if (/embers\//.test(file)) return 'src/embers';
  if (/fuel\/moisture|terrain\/solar/.test(file)) return 'src/fuel/moisture + terrain/solar';
  if (/explain\//.test(file)) return 'src/explain';
  if (/sim\//.test(file)) return 'src/sim';
  if (/core\//.test(file)) return 'src/core';
  return 'other (runtime, node internals, harness)';
}

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const stat = (a) => ({ median: median(a), min: Math.min(...a), max: Math.max(...a), values: a });

function analyseProfile(path, simWindows) {
  const p = JSON.parse(readFileSync(path, 'utf8'));
  const nodes = new Map(p.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const srcOf = (cf) => cf.url.replace(/^.*?\/\.build-ts-profile(?:-count)?\//, '').replace(/\.mjs$/, '.ts');
  const phaseMs = { advance: Object.fromEntries(PHASES.map((x) => [x, 0])), spin: 0 };
  const selfAdv = new Map();
  const selfSpin = new Map();
  const groupAdv = new Map();
  let total = 0;
  let gc = 0;
  let idle = 0;
  const unmapped = new Map();
  for (let i = 0; i < p.samples.length; i++) {
    const dt = (p.timeDeltas[i + 1] ?? p.timeDeltas[i]) / 1000;
    const leaf = nodes.get(p.samples[i]);
    total += dt;
    const lf = leaf.callFrame.functionName;
    if (lf === '(idle)') {
      idle += dt;
      continue;
    }
    if (lf === '(garbage collector)') gc += dt;
    // walk up: find the anchor and the frame just below it
    let prev = null;
    let kind = null;
    let child = null;
    for (let x = p.samples[i]; x; x = parent.get(x)) {
      const n = nodes.get(x);
      const fn = n.callFrame.functionName;
      const url = n.callFrame.url;
      if (fn === 'stepOnce' && url.includes('sim/simulation')) {
        kind = 'adv';
        child = prev;
        break;
      }
      if (fn === 'advance' && url.includes('sim/simulation')) {
        kind = 'adv';
        child = prev && prev.callFrame.functionName === 'stepOnce' ? null : prev;
        break;
      }
      if (fn === 'spinUp' && url.includes('sim/simulation')) {
        kind = 'spin';
        break;
      }
      prev = n;
    }
    if (!kind) continue;
    const key = `${lf || '(anon)'} ${srcOf(leaf.callFrame)}`;
    const grp = fileGroup(srcOf(leaf.callFrame));
    if (kind === 'spin') {
      phaseMs.spin += dt;
      selfSpin.set(key, (selfSpin.get(key) ?? 0) + dt);
      continue;
    }
    const ph = child ? childPhase(child.callFrame.functionName || '(anon)', srcOf(child.callFrame)) : 'other';
    if (ph === 'other' && child) {
      const k = `${child.callFrame.functionName || '(anon)'} ${srcOf(child.callFrame)}`;
      unmapped.set(k, (unmapped.get(k) ?? 0) + dt);
    }
    phaseMs.advance[ph] += dt;
    selfAdv.set(key, (selfAdv.get(key) ?? 0) + dt);
    groupAdv.set(grp, (groupAdv.get(grp) ?? 0) + dt);
  }
  const advTotal = Object.values(phaseMs.advance).reduce((a, b) => a + b, 0);
  const rank = (m) => [...m].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => ({ kernel: k, selfMs: v }));
  return { processMs: total, idleMs: idle, gcMs: gc, advanceMs: advTotal, spinUpMs: phaseMs.spin, phaseMs: phaseMs.advance, selfAdvance: rank(selfAdv), selfAllOf: Object.fromEntries(selfAdv), selfSpin: rank(selfSpin), selfSpinAll: Object.fromEntries(selfSpin), fileGroupsMs: Object.fromEntries(groupAdv), unmapped: rank(unmapped).slice(0, 10).map((u) => ({ child: u.kernel, ms: u.selfMs })) };
}

const scenarios = [...new Set(files.map((f) => f.replace(/-(time|plain|count)-r\d+\.json$/, '')))].filter((s) => !s.startsWith('summary'));
const out = { generatedFrom: dir, scenarios: {} };

for (const scen of scenarios) {
  const timeRuns = files.filter((f) => f.startsWith(`${scen}-time-r`)).sort().map(load);
  const plainRuns = files.filter((f) => f.startsWith(`${scen}-plain-r`)).sort().map(load);
  const countRuns = files.filter((f) => f.startsWith(`${scen}-count-r`)).sort().map(load);
  if (!timeRuns.length) continue;
  const prof = timeRuns.map((r) => ({ run: r, a: analyseProfile(r.envelope.cpuProfile) }));

  // phase shares of the advance window, and of spin-up + advance
  const phaseShare = {};
  const phaseShareWithSpin = {};
  for (const ph of PHASES) {
    phaseShare[ph] = stat(prof.map(({ a }) => (100 * a.phaseMs[ph]) / a.advanceMs));
    phaseShareWithSpin[ph] = stat(prof.map(({ a }) => (100 * a.phaseMs[ph]) / (a.advanceMs + a.spinUpMs)));
  }
  phaseShareWithSpin['spinUp (3-D air spin-up, 900 s)'] = stat(prof.map(({ a }) => (100 * a.spinUpMs) / (a.advanceMs + a.spinUpMs)));

  // kernels: average self time (ms) over runs
  const kernelMs = new Map();
  for (const { a } of prof) for (const [k, v] of Object.entries(a.selfAllOf)) kernelMs.set(k, [...(kernelMs.get(k) ?? []), v]);
  const kernels = [...kernelMs]
    .map(([k, v]) => {
      const perRun = prof.map(({ a }) => ((a.selfAllOf[k] ?? 0) / a.advanceMs) * 100);
      return { kernel: k, selfMs: stat(prof.map(({ a }) => a.selfAllOf[k] ?? 0)), sharePct: stat(perRun) };
    })
    .sort((x, y) => y.selfMs.median - x.selfMs.median)
    .slice(0, 25);
  // with the spin-up included
  const kernelsWithSpin = (() => {
    const all = new Map();
    for (const { a } of prof) {
      const m = new Map(Object.entries(a.selfAllOf));
      for (const [k, v] of Object.entries(a.selfSpinAll)) m.set(k, (m.get(k) ?? 0) + v);
      all.set(a, m);
    }
    const keys = new Set([...all.values()].flatMap((m) => [...m.keys()]));
    return [...keys]
      .map((k) => ({ kernel: k, sharePct: stat(prof.map(({ a }) => (100 * (all.get(a).get(k) ?? 0)) / (a.advanceMs + a.spinUpMs))) }))
      .sort((x, y) => y.sharePct.median - x.sharePct.median)
      .slice(0, 12);
  })();
  const groups = {};
  for (const g of new Set(prof.flatMap(({ a }) => Object.keys(a.fileGroupsMs)))) groups[g] = stat(prof.map(({ a }) => (100 * (a.fileGroupsMs[g] ?? 0)) / a.advanceMs));

  // the app's own timers (profiler off)
  const appPhase = {};
  const appRuns = plainRuns.map((r) => {
    const m = Object.fromEntries(PHASES.map((x) => [x, 0]));
    for (const [lap, ms] of Object.entries(r.perfModulesMs)) if (lap !== 'airAt') m[lapPhase(lap)] += ms;
    const tot = Object.values(m).reduce((a, b) => a + b, 0);
    return { ms: m, total: tot };
  });
  for (const ph of PHASES) appPhase[ph] = stat(appRuns.map((r) => (100 * r.ms[ph]) / r.total));
  const withSpinApp = plainRuns.map((r, i) => (r.perfInitMs.spinUp ?? 0) / (appRuns[i].total + (r.perfInitMs.spinUp ?? 0)) * 100);

  // counts
  let counts;
  if (countRuns.length) {
    const c0 = countRuns[0];
    const steps = c0.steps.advanceSteps;
    const spinSteps = c0.steps.atmStepsSpinUp;
    const byPhase = Object.fromEntries(PHASES.map((x) => [x, {}]));
    const sitesByPhase = Object.fromEntries(PHASES.map((x) => [x, {}]));
    for (const [lap, t] of Object.entries(c0.counts.byLap)) {
      if (lap.startsWith('(')) continue;
      const ph = lap === '(after last lap)' ? 'other' : lapPhase(lap);
      for (const [fn, n] of Object.entries(t.counts)) byPhase[ph][fn] = (byPhase[ph][fn] ?? 0) + n;
      for (const [fn, m] of Object.entries(t.sites)) for (const [s, n] of Object.entries(m)) sitesByPhase[ph][`${fn} ${s}`] = (sitesByPhase[ph][`${fn} ${s}`] ?? 0) + n;
    }
    const totalFn = {};
    for (const ph of PHASES) for (const [fn, n] of Object.entries(byPhase[ph])) totalFn[fn] = (totalFn[fn] ?? 0) + n;
    const sites = {};
    for (const ph of PHASES) sites[ph] = Object.entries(sitesByPhase[ph]).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => ({ site: k, estCalls: n * 16, estPerStep: (n * 16) / steps }));
    const sameTotals = countRuns.length > 1 && JSON.stringify(countRuns[0].counts.total) === JSON.stringify(countRuns[1].counts.total);
    counts = {
      advanceSteps: steps,
      spinUpAtmSteps: spinSteps,
      repeatable: countRuns.length > 1 ? sameTotals : null,
      perStepByPhase: Object.fromEntries(PHASES.map((ph) => [ph, Object.fromEntries(Object.entries(byPhase[ph]).map(([fn, n]) => [fn, n / steps]))])),
      perStepTotal: Object.fromEntries(Object.entries(totalFn).map(([fn, n]) => [fn, n / steps])),
      totalsAdvance: totalFn,
      spinUpTotals: c0.counts.byLap['(spinUp)']?.counts ?? {},
      spinUpPerAtmStep: Object.fromEntries(Object.entries(c0.counts.byLap['(spinUp)']?.counts ?? {}).map(([fn, n]) => [fn, spinSteps ? n / spinSteps : 0])),
      constructTotals: c0.counts.byLap['(scenario build + construct)']?.counts ?? {},
      topSitesByPhase: sites,
      samplingNote: 'call sites: every 16th non-sqrt Math call, first stack frame outside the wrapper; estCalls = samples x 16',
    };
  }
  const r0 = timeRuns[0];
  out.scenarios[scen] = {
    tier: r0.tier,
    burntCells: timeRuns.map((r) => r.burntCells),
    steps: r0.steps,
    simSeconds: r0.runTo,
    runs: timeRuns.length,
    wallAdvanceMsProfiled: stat(timeRuns.map((r) => r.ms.advance)),
    wallSpinUpMsProfiled: stat(timeRuns.map((r) => r.ms.spinUp)),
    wallAdvanceMsPlain: stat(plainRuns.map((r) => r.ms.advance)),
    wallSpinUpMsPlain: stat(plainRuns.map((r) => r.ms.spinUp)),
    msPerStepPlain: stat(plainRuns.map((r) => r.ms.advance / r.steps.advanceSteps)),
    profileWindowMs: stat(prof.map(({ a }) => a.advanceMs)),
    profileSpinUpMs: stat(prof.map(({ a }) => a.spinUpMs)),
    gcMsOfProcess: stat(prof.map(({ a }) => a.gcMs)),
    phaseShareAdvancePct: phaseShare,
    phaseShareWithSpinUpPct: phaseShareWithSpin,
    appTimersShareAdvancePct: appPhase,
    appTimersSpinUpShareOfRunPct: stat(withSpinApp),
    kernelsAdvance: kernels,
    kernelsWithSpinUp: kernelsWithSpin,
    fileGroupsAdvancePct: groups,
    unmappedChildren: prof[0].a.unmapped,
    counts,
    conditions: {
      node: r0.node,
      cpu: r0.cpu,
      cores: r0.cores,
      runs: [...timeRuns, ...plainRuns, ...countRuns].map((r) => ({ tag: r.envelope.tag, loadavgStart: r.envelope.before.loadavg, loadavgEnd: r.envelope.after.loadavg, uptimeStart: r.envelope.before.uptime, uptimeEnd: r.envelope.after.uptime, waitedS: r.envelope.before.waitedS, highLoadAtStart: r.envelope.before.highLoadAtStart, startedAt: r.envelope.startedAt })),
    },
  };
}
writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log(`wrote ${outFile}`);
