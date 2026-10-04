#!/usr/bin/env node
/**
 * Bundle budget of the production (APK) build: run `npm run build:cap` first, then `npm run check:bundle`.
 *
 * Checks the `dist/` folder that Capacitor copies into the app (webDir) and prints the figures the budgets in
 * docs/ARCHITECTURE.md ("Performance budgets") are written against:
 *   - the only page is index.html (no style guide, 3-D dev harness or legend gallery: they are dev pages, never built),
 *   - no source maps (`--mode capacitor` leaves them out; they are ~12 MB),
 *   - JavaScript and CSS size (raw and gzipped; the WebView reads files from the APK uncompressed, so the raw figure is what
 *     is parsed, the gzipped one is what a web host would send),
 *   - the entry chunk (index-*.js: everything the first screen needs before it can show Setup),
 *   - the bundled data (public/demo, public/replays) stays what the manifest says.
 * The exit code is 1 when a budget is exceeded.
 *
 *   npm run build:cap && node scripts/check-bundle.mjs [--dist dist]
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const dist = path.resolve(arg('dist', 'dist'));
if (!fs.existsSync(dist)) {
  console.error(`No ${dist}: run \`npm run build:cap\` first.`);
  process.exit(2);
}

/** Budgets (kB): a regression guard with ~10 % headroom over the measured size, not a target. Raise one only with a reason. */
const BUDGET = {
  entryGzipKb: 195, // index-*.js gzip: the main bundle (all screens, the Data sets screen and the model card text)
  jsGzipKb: 1000, // every chunk, gzip (the render chunk with three.js and the sim chunk are the big ones)
  cssKb: 135, // raw (minified)
  cssGzipKb: 25,
  demoMb: 31, // public/demo
};

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const files = walk(dist);
const rel = (f) => path.relative(dist, f).split(path.sep).join('/');
const kb = (n) => n / 1024;
const gz = (f) => zlib.gzipSync(fs.readFileSync(f), { level: 9 }).length;

const problems = [];
const pages = files.filter((f) => f.endsWith('.html')).map(rel);
if (pages.length !== 1 || pages[0] !== 'index.html') problems.push(`expected index.html as the only page, found: ${pages.join(', ') || 'none'}`);
const maps = files.filter((f) => f.endsWith('.map'));
if (maps.length) problems.push(`${maps.length} source map(s) in the app bundle (build with --mode capacitor)`);

const assets = files.filter((f) => rel(f).startsWith('assets/') && !f.endsWith('.map'));
const js = assets.filter((f) => f.endsWith('.js'));
const css = assets.filter((f) => f.endsWith('.css'));
const sum = (list, fn) => list.reduce((a, f) => a + fn(f), 0);
const size = (f) => fs.statSync(f).size;
const entry = js.find((f) => /\/index-[\w-]+\.js$/.test(f));
const demo = files.filter((f) => rel(f).startsWith('demo/'));
const fig = {
  jsKb: kb(sum(js, size)),
  jsGzipKb: kb(sum(js, gz)),
  entryKb: entry ? kb(size(entry)) : NaN,
  entryGzipKb: entry ? kb(gz(entry)) : NaN,
  cssKb: kb(sum(css, size)),
  cssGzipKb: kb(sum(css, gz)),
  demoMb: sum(demo, size) / 1048576,
};
const check = (name, value, limit) => {
  const ok = value <= limit;
  console.log(`${ok ? 'ok  ' : 'OVER'} ${name.padEnd(14)} ${value.toFixed(1).padStart(8)}  (budget ${limit})`);
  if (!ok) problems.push(`${name} ${value.toFixed(1)} is over the budget of ${limit}`);
};
console.log(`${dist}: ${files.length} files, ${js.length} scripts, ${css.length} stylesheet(s), page(s): ${pages.join(', ')}`);
check('entry gzip kB', fig.entryGzipKb, BUDGET.entryGzipKb);
check('js gzip kB', fig.jsGzipKb, BUDGET.jsGzipKb);
check('css kB', fig.cssKb, BUDGET.cssKb);
check('css gzip kB', fig.cssGzipKb, BUDGET.cssGzipKb);
check('demo data MB', fig.demoMb, BUDGET.demoMb);
console.log(`     (raw: js ${fig.jsKb.toFixed(0)} kB, entry ${fig.entryKb.toFixed(0)} kB)`);
for (const p of problems) console.error(`FAIL ${p}`);
process.exit(problems.length ? 1 : 0);
