#!/usr/bin/env node
/**
 * Card T1.5 (c): the TypeScript kernel arms in a Web Worker in Playwright's pre-installed Chromium (headless, `chromium.launch()` with no options).
 *
 *   node prototypes/dotnet-b/harness/run-arms-browser.mjs --arm app|pool [--threads N] --mode verify|time --problem air:k3std|air:k6high|fast:k6f-900|fast:k6f-late
 *        --fixtures DIR --out FILE.json [--samples 1000] [--warm 1500] [--min-sample-ms 2] [--spin 200] [--only a,b] [--isolation on|off] [--rebuild]
 *
 * `--arm app`: ONE worker, the app's unmodified kernels, data resident, timing inside the worker. `--arm pool --threads N`: N workers over a SharedArrayBuffer on the C# chunks; needs
 * `crossOriginIsolated`, which the tiny local server provides by sending Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp on every response
 * (`--isolation off` omits them: the page is then not isolated and SharedArrayBuffer is absent; the one-worker arm still runs).
 * Samples are batches of operations (`--min-sample-ms`, default 2 ms): a Chromium worker's clock has 0.1 ms resolution (5 us when isolated).
 * FIXTURES holds air/fx-k3std, air/fx-k6high, fast/fx-k6f-900, fast/fx-k6f-late. Bundles go to FS_ARMS_OUT (default prototypes/dotnet-b/fixtures/.build-arms-browser), rebuilt when older than
 * their sources. Timed runs belong under `flock /tmp/firesim-heavy.lock` (this script does not take the lock).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..');
const bundleDir = process.env.FS_ARMS_OUT ?? path.join(repo, 'prototypes', 'dotnet-b', 'fixtures', '.build-arms-browser');
const argv = process.argv.slice(2);
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  if (i >= 0) return argv[i + 1];
  if (d !== undefined) return d;
  console.error(`missing --${n}`);
  process.exit(2);
};

function newest(dirs, exts) {
  let n = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (exts.test(e.name)) n = Math.max(n, fs.statSync(p).mtimeMs);
    }
  };
  for (const d of dirs) walk(path.join(repo, d));
  n = Math.max(n, fs.statSync(path.join(here, 'vite.arms.config.ts')).mtimeMs);
  return n;
}
const srcTime = newest(['src/atmosphere', 'src/fire', 'src/core', 'prototypes/dotnet-b/Fs.Bench/ts/arms'], /\.ts$/);
for (const which of ['worker', 'page']) {
  const f = path.join(bundleDir, `arms-${which}.js`);
  if (argv.includes('--rebuild') || !fs.existsSync(f) || fs.statSync(f).mtimeMs < srcTime) {
    const r = spawnSync('npx', ['vite', 'build', '-c', path.join(here, 'vite.arms.config.ts')], { cwd: repo, stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, FS_ARMS_OUT: bundleDir, FS_ARMS_ENTRY: which } });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
}

const isolation = opt('isolation', 'on') === 'on';
const fixtures = path.resolve(opt('fixtures'));
const html = '<!doctype html><meta charset="utf-8"><title>arms</title><script src="/arms-page.js"></script>';
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const headers = isolation ? { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin' } : {};
  const send = (type, body) => void res.writeHead(200, { 'content-type': type, ...headers }).end(body);
  if (u.pathname === '/' || u.pathname === '/index.html') return send('text/html', html);
  if (u.pathname === '/arms-page.js' || u.pathname === '/arms-worker.js') return send('text/javascript', fs.readFileSync(path.join(bundleDir, u.pathname.slice(1))));
  if (u.pathname.startsWith('/fx/')) {
    const f = path.normalize(path.join(fixtures, u.pathname.slice(4)));
    if (f.startsWith(fixtures + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) return send(f.endsWith('.json') ? 'application/json' : 'application/octet-stream', fs.readFileSync(f));
  }
  res.writeHead(404, headers).end('not found');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const arm = opt('arm');
const threads = arm === 'app' ? 1 : Number(opt('threads'));
const problem = opt('problem');
const fixName = problem.split(':')[1];
const spec = {
  problem, arm, threads, mode: opt('mode', 'time'),
  spinUs: Number(opt('spin', threads > os.cpus().length ? '0' : '200')),
  samples: Number(opt('samples', fixName === 'k6high' ? '600' : '1000')), warmMs: Number(opt('warm', '1500')), minSampleMs: Number(opt('min-sample-ms', '2')),
  only: argv.includes('--only') ? opt('only').split(',') : undefined,
};

const { chromium } = createRequire(import.meta.url)('playwright');
const loadStart = os.loadavg();
const browser = await chromium.launch();
let out;
try {
  const page = await browser.newPage();
  page.on('console', (m) => console.error(`[page] ${m.text()}`));
  page.on('pageerror', (e) => console.error(`[page error] ${e.message}`));
  await page.goto(`http://127.0.0.1:${port}/index.html`);
  await page.waitForFunction(() => window.armsPageReady === true);
  let v8 = null;
  try {
    v8 = (await (await browser.newBrowserCDPSession()).send('Browser.getVersion')).jsVersion;
  } catch {
    /* not available */
  }
  out = await page.evaluate((s) => window.runArm(s), spec);
  out.browser = { kind: 'chromium', version: browser.version(), v8 };
} finally {
  await browser.close();
  server.close();
}
const doc = {
  runtime: 'v8-chromium', problem, arm, threads, spinUs: spec.spinUs, mode: spec.mode, samples: spec.samples, warmMs: spec.warmMs, minSampleMs: spec.minSampleMs, isolation,
  host: { cpu: os.cpus()[0]?.model, cores: os.cpus().length, loadavgStart: loadStart, loadavgEnd: os.loadavg(), utc: new Date().toISOString() },
  ...out,
};
fs.writeFileSync(opt('out'), JSON.stringify(doc));
const r = out.result;
const tag = `${problem} chromium ${arm}${arm === 'pool' ? ' x' + threads : ''}`;
if (r.verify) console.log(`${tag} verify: ${r.verify.cases} cases, ${r.verify.checks} hash checks, ${r.verify.mismatches} mismatches (crossOriginIsolated ${out.page.crossOriginIsolated})`);
if (r.verify && r.verify.mismatches > 0) console.log(JSON.stringify(r.verify.failed, null, 1));
if (r.stats) console.log(`${tag}: ` + r.stats.map((s) => `${s.kernel} ${s.medianMs.toFixed(4)}`).join(', '));
process.exit(r.verify && r.verify.mismatches > 0 ? 3 : 0);
