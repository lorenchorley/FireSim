#!/usr/bin/env node
/**
 * The whole T1.1 measurement session: for each scenario, three profiled runs (`node --cpu-prof`), three runs without a profiler (the app's own
 * module timers), and two counting runs. Every process runs as `flock /tmp/firesim-heavy.lock node run.mjs ...`; run.mjs records the load average
 * before and after (inside the lock) and waits up to 3 minutes for a load average above 3.5 to fall.
 *
 *   node prototypes/dotnet-b/ts-export/profile/session.mjs --build BUILD --count-build COUNT_BUILD --out OUT_DIR [--runs 3] [--seed 13] [--scenarios a,b] [--to S --duration S] [--count-runs 2]
 *
 * Output: OUT_DIR/<scenario>-<time|plain|count>-r<k>.json (the harness JSON with an `envelope`) and OUT_DIR/prof/<tag>.cpuprofile.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..', '..');
const opt = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const out = resolve(opt('out'));
const build = resolve(opt('build'));
const countBuild = resolve(opt('count-build'));
const runs = Number(opt('runs', '3'));
const seed = opt('seed', '13');
const to = opt('to');
const duration = opt('duration');
const countRuns = Number(opt('count-runs', '2'));
const scenarios = (opt('scenarios', 'katoomba6-fast,katoomba3-standard') ?? '').split(',');
mkdirSync(join(out, 'prof'), { recursive: true });

function one(cmd, scen, k) {
  const tag = `${scen}-${cmd}-r${k}`;
  const args = ['/tmp/firesim-heavy.lock', process.execPath, join(here, 'run.mjs'), cmd, scen, '--build', cmd === 'count' ? countBuild : build, '--seed', seed, '--tag', tag, '--prof', join(out, 'prof'), ...(to ? ['--to', to] : []), ...(duration ? ['--duration', duration] : [])];
  const r = spawnSync('flock', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'inherit'] });
  if (r.status !== 0) {
    console.error(`FAILED ${tag}: exit ${r.status}`);
    return;
  }
  writeFileSync(join(out, `${tag}.json`), r.stdout);
  const j = JSON.parse(r.stdout.trim().split('\n').pop());
  console.log(`${tag}: advance ${j.ms.advance.toFixed(0)} ms, load at start ${j.envelope.before.loadavg[0]}, after ${j.envelope.after.loadavg[0]}${j.envelope.before.highLoadAtStart ? '  HIGH LOAD AT START' : ''}`);
}

for (let k = 1; k <= runs; k++) {
  for (const s of scenarios) {
    one('time', s, k);
    one('plain', s, k);
  }
}
for (const s of scenarios) for (let k = 1; k <= countRuns; k++) one('count', s, k);
console.log('session done');
