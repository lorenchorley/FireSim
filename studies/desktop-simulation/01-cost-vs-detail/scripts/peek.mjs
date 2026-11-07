// Prints one line per row JSON in a folder: the numbers the table needs. node peek.mjs <dir> [id-prefix]
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [dir, prefix = ''] = process.argv.slice(2);
const f = (x, d = 1) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(d) : String(x));
for (const name of readdirSync(dir).filter((n) => n.endsWith('.json') && !n.endsWith('.spec.json') && !n.startsWith('specs') && n.startsWith(prefix)).sort()) {
  const r = JSON.parse(readFileSync(resolve(dir, name), 'utf8'));
  if (r.error) {
    console.log(`${r.spec.id}: ERROR ${String(r.error).split('\n')[0]}`);
    continue;
  }
  const m = r.modulesMs;
  const tot = Object.values(m).reduce((a, b) => a + b, 0);
  const top = Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${f((100 * v) / tot, 0)}%`).join(' ');
  console.log(
    `${r.spec.id}: cells ${r.grid.cells} sim ${f(r.simTimeS, 0)} s wall ${f(r.advanceWallS)} s (${f(r.wallPerSimHourS)} s/h, ${f(r.simSPerWallS, 0)} x) steps/h ${f(r.stepsPerSimHour, 0)} sub/h ${f(r.fireSubStepsPerSimHour, 0)} ` +
      `peakRSS ${r.peak.maxRssProcessMB} MB endRSS ${r.end.rssAfterGcMB} heap ${r.end.heapUsedAfterGcMB} snap ${f(r.snapshot.typedBytes / 1e6, 2)} MB area ${f(r.final.areaHa, 0)} ha cpu/wall ${f(r.cpuOverWall, 2)} ctor ${f(r.constructS)} spin ${f(r.spinUpS)} | ${top}${r.truncatedAtS ? ' TRUNCATED' : ''}`,
  );
}
