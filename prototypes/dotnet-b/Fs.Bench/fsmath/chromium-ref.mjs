// T1.3: JavaScript's Math in Chromium (Playwright's) over the fixed input files: results (bit patterns) and ns per call.
//   node chromium-ref.mjs ref IN_DIR OUT_DIR [TAG=chromium]       writes OUT_DIR/{fn}.{TAG}.f64 and OUT_DIR/run-{TAG}.json (browser and V8 version)
//   node chromium-ref.mjs ns  IN_DIR OUT.json [N=65536] [REPEATS=15]
// The input files are served to the page through a route and the results posted back (no base64), so the page does exactly what js-math.mjs does under Node:
// the same loops (new Function, the call written out). The page is about:blank-like and idle; headless Chromium, default flags.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { FNS, ARITY } from './js-math.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const [cmd, inDir, out, a3, a4] = process.argv.slice(2);

const browser = await chromium.launch();
const page = await browser.newPage();
const results = new Map();
await page.route('http://fsmath.test/**', async (route) => {
  const req = route.request();
  const u = new URL(req.url());
  if (u.pathname === '/index.html') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>fsmath</title>' });
  if (req.method() === 'POST') { results.set(u.pathname.slice(5), req.postDataBuffer()); return route.fulfill({ status: 204 }); }
  const f = `${inDir}${u.pathname}`;
  return fs.existsSync(f) ? route.fulfill({ contentType: 'application/octet-stream', body: fs.readFileSync(f) }) : route.fulfill({ status: 404 });
});
await page.goto('http://fsmath.test/index.html');
const ua = await page.evaluate(() => navigator.userAgent);
let v8 = null;
try {
  const cdp = await browser.newBrowserCDPSession();
  v8 = (await cdp.send('Browser.getVersion')).jsVersion; // the V8 version, from the DevTools protocol
} catch { /* not available */ }
const info = { browser: 'chromium', version: browser.version(), userAgent: ua, v8 };

const present = FNS.filter((f) => fs.existsSync(`${inDir}/${f}.in`));
if (cmd === 'ref') {
  const tag = a3 ?? 'chromium';
  fs.mkdirSync(out, { recursive: true });
  await page.evaluate(async ({ fns, arity }) => {
    for (const fn of fns) {
      const x = new Float64Array(await (await fetch(`/${fn}.in`)).arrayBuffer());
      const ar = arity[fn] ?? 1;
      const n = x.length / ar;
      const y = new Float64Array(n);
      const loop = ar === 2
        ? new Function('x', 'y', 'n', `for (let i = 0; i < n; i++) y[i] = Math.${fn}(x[2 * i], x[2 * i + 1]);`)
        : new Function('x', 'y', 'n', `for (let i = 0; i < n; i++) y[i] = Math.${fn}(x[i]);`);
      loop(x, y, n);
      await fetch(`/out/${fn}`, { method: 'POST', body: y.buffer });
    }
  }, { fns: present, arity: ARITY });
  const sha = {};
  for (const fn of present) {
    const b = results.get(fn);
    fs.writeFileSync(`${out}/${fn}.${tag}.f64`, b);
    sha[fn] = crypto.createHash('sha256').update(b).digest('hex');
  }
  fs.writeFileSync(`${out}/run-${tag}.json`, JSON.stringify({ tag, ...info, sha256: sha }, null, 1));
  console.log(`${tag}: ${info.version} (${ua}) v8 ${v8}: ${present.length} functions -> ${out}`);
} else if (cmd === 'ns') {
  const n = Number(a3 ?? 65536), repeats = Number(a4 ?? 15);
  const rows = await page.evaluate(async ({ fns, arity, n, repeats }) => {
    const rows = [];
    let sink = 0;
    for (const fn of fns) {
      const ar = arity[fn] ?? 1;
      const x = new Float64Array(await (await fetch(`/${fn}.in`)).arrayBuffer()).slice(0, n * ar);
      const y = new Float64Array(n);
      const loop = ar === 2
        ? new Function('x', 'y', 'n', `for (let i = 0; i < n; i++) y[i] = Math.${fn}(x[2 * i], x[2 * i + 1]);`)
        : new Function('x', 'y', 'n', `for (let i = 0; i < n; i++) y[i] = Math.${fn}(x[i]);`);
      const t = [];
      for (let r = -3; r < repeats; r++) {
        const t0 = performance.now();
        loop(x, y, n);
        const dt = ((performance.now() - t0) * 1e6) / n;
        if (r >= 0) t.push(dt);
        sink += y[(r + 3) % n];
      }
      t.sort((p, q) => p - q);
      rows.push({ fn, impl: 'js-math', n, repeats, nsMedian: t[t.length >> 1], nsMin: t[0], nsMax: t[t.length - 1] });
    }
    return { rows, sink };
  }, { fns: present, arity: ARITY, n, repeats });
  for (const r of rows.rows) console.log(`${r.fn.padEnd(6)} js-math median ${r.nsMedian.toFixed(2).padStart(8)} ns   min ${r.nsMin.toFixed(2).padStart(8)}   max ${r.nsMax.toFixed(2).padStart(8)}`);
  fs.writeFileSync(out, JSON.stringify({ engine: 'chromium', ...info, ...rows }, null, 1));
}
await browser.close();
