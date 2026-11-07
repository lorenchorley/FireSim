// Runs a list of rows one after the other, each in its own Node process and each under the machine's shared heavy-job lock.
//
//   setsid nohup node studies/desktop-simulation/01-cost-vs-detail/scripts/run-batch.mjs <specs.json> <outdir> <log> &
//   (the last line of <log> is "DONE" when the batch has finished; rows whose <outdir>/<id>.json exists are skipped)
//
// <specs.json> is an array of row specs (see row.ts, RowSpec). A row that fails or is stopped by maxWallS is recorded and the batch goes on.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');
const [specsPath, outDir, logPath] = process.argv.slice(2);
if (!specsPath || !outDir || !logPath) throw new Error('usage: run-batch.mjs <specs.json> <outdir> <log>');
mkdirSync(outDir, { recursive: true });
const specs = JSON.parse(readFileSync(specsPath, 'utf8'));
const log = (s) => appendFileSync(logPath, `${new Date().toISOString().slice(11, 19)} ${s}\n`);
log(`batch of ${specs.length} rows`);
for (const spec of specs) {
  const out = resolve(outDir, `${spec.id}.json`);
  if (existsSync(out)) {
    log(`skip ${spec.id} (done)`);
    continue;
  }
  const specFile = resolve(outDir, `${spec.id}.spec.json`);
  writeFileSync(specFile, JSON.stringify({ ...spec, ...(spec.cpuProfile ? { cpuProfile: resolve(outDir, spec.cpuProfile) } : {}) }));
  log(`start ${spec.id} (waits for the lock)`);
  const t = Date.now();
  const r = spawnSync('flock', ['/tmp/firesim-heavy.lock', 'node', '--expose-gc', '--max-old-space-size=6144', resolve(here, 'launch.mjs'), specFile, out], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 });
  log(`end ${spec.id} after ${Math.round((Date.now() - t) / 1000)} s incl. lock wait, status ${r.status}: ${(r.stdout || '').trim().split('\n').pop()} ${(r.stderr || '').trim().split('\n').slice(-3).join(' | ')}`);
}
appendFileSync(logPath, 'DONE\n');
