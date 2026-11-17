#!/usr/bin/env node
/**
 * `node results.mjs --out FIXTURES_DIR --study STUDY_JSON --to reports/3a-results.json`: collects the per-scenario timings and sizes from the
 * fixtures' meta.json files and the study output (run.mjs study --json) into the stage's result file (reports/RESULTS-SCHEMA.md).
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function opt(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const out = opt('out');
const studyFile = opt('study');
const to = opt('to');
if (!out || !studyFile || !to) {
  console.error('usage: results.mjs --out FIXTURES_DIR --study STUDY_JSON --to RESULTS_JSON');
  process.exit(2);
}
const metas = readdirSync(out)
  .filter((n) => existsSync(join(out, n, 'meta.json')))
  .map((n) => JSON.parse(readFileSync(join(out, n, 'meta.json'), 'utf8')));
const study = JSON.parse(readFileSync(studyFile, 'utf8'));
const byName = Object.fromEntries(metas.map((m) => [m.fixture, m]));
const first = metas[0];

const fixtures = metas.map((m) => ({
  fixture: m.fixture,
  scenario: m.scenario,
  seed: m.seed,
  tier: m.tier,
  gridMode: m.gridMode,
  fireGrid: `${m.fireGrid.nx}x${m.fireGrid.ny} @ ${m.fireGrid.cellSize} m`,
  runToS: m.runToS,
  snapshots: m.snapshotTimesS.length,
  burntCells: m.arrival.burntCells,
  burntAreaHa: Math.round(m.arrival.burntAreaM2 / 100) / 100,
  initBinBytes: m.sizesBytes.initBin,
  snapshotBytes: m.sizesBytes.snapshot60,
  timingMs: m.timingMs,
  atmosphere: { cellM: m.options.atmosCellSize, levels: m.options.atmosLevels, dz1: m.options.atmosDz1, maxEmbers: m.options.maxEmbers, embers: m.options.embers },
}));

const runs = metas.map((m) => ({
  name: `ts ${m.fixture}: spin-up + advance to ${m.runToS} s`,
  impl: 'ts',
  threads: 1,
  n: 1,
  medianMs: m.timingMs.spinUpPlusAdvance,
  p95Ms: m.timingMs.spinUpPlusAdvance,
  minMs: m.timingMs.spinUpPlusAdvance,
  maxMs: m.timingMs.spinUpPlusAdvance,
  notes: `one run; scenario build ${m.timingMs.scenarioBuild} ms, Simulation construct ${m.timingMs.simConstruct} ms (moisture spin-up), 3-D spin-up ${m.timingMs.spinUp} ms, advance ${m.timingMs.advance} ms`,
}));
const det = ['katoomba3-fast', 'determinism-a', 'determinism-b'].map((n) => byName[n]?.timingMs.spinUpPlusAdvance).filter((x) => x !== undefined).sort((a, b) => a - b);
if (det.length) {
  runs.push({
    name: 'ts katoomba3-fast: spin-up + advance to 1800 s (three separate processes)',
    impl: 'ts',
    threads: 1,
    n: det.length,
    medianMs: det[Math.floor((det.length - 1) / 2)],
    p95Ms: det[det.length - 1],
    minMs: det[0],
    maxMs: det[det.length - 1],
    notes: 'the exports of katoomba3-fast, determinism-a and determinism-b',
  });
}

const result = {
  stage: '3a-reference',
  when: new Date().toISOString(),
  machine: { label: 'container (shared)', cpu: first.machine.cpu, cores: first.machine.cores, os: first.machine.os, runtime: `Node ${first.node}` },
  indicative: true,
  gitCommit: first.gitCommit,
  runs,
  fixtures,
  determinism: {
    scenario: 'katoomba3-fast',
    processes: 3,
    snapshotsPerRun: byName['katoomba3-fast']?.snapshotTimesS.length,
    identical: byName['katoomba3-fast'] && JSON.stringify(readFileSync(join(out, 'katoomba3-fast', 'hashes.json'))) === JSON.stringify(readFileSync(join(out, 'determinism-a', 'hashes.json'))) && JSON.stringify(readFileSync(join(out, 'katoomba3-fast', 'hashes.json'))) === JSON.stringify(readFileSync(join(out, 'determinism-b', 'hashes.json'))),
  },
  anchor: byName['anchor-080-katoomba6-point']?.expectedHashCheck?.equal ?? null,
  study,
  gate: {
    bar: 'none: stage 3a produces the reference fixtures and the yardstick; Gate 3 is decided by the comparison stage (C3)',
    measured: 'see study',
    result: 'not run',
    why: 'no gate belongs to 3a',
  },
  notRun: ['the C# side (nothing is ported in 3a)', 'Katoomba 6 km at the standard and high tiers (not asked for; the standard tier at 6 km was not exported)', 'runs on a phone or on a quiet machine: all timings are from one shared container'],
};
writeFileSync(to, JSON.stringify(result, null, 2));
console.log(`wrote ${to}: ${fixtures.length} fixtures, ${study.rows.length} comparison rows`);
