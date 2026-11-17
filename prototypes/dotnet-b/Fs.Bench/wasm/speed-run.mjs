// T1.6a runner: the frozen speed-test kernels, TypeScript against the published Fs.Wasm (Mono WebAssembly), same engine, A B B A, in Node or in a Web Worker of Chromium (Playwright).
//   node speed-run.mjs ENGINE FRAMEWORK_DIR OUT.json TAG [--mode suite|startup|app] [--build aot|interp] [--rounds N] [--samples N] [--kernels KERNELS.js]
//   ENGINE = node | chromium. FRAMEWORK_DIR = <publish>/wwwroot/_framework of Fs.Wasm. KERNELS.js = the FsKernels IIFE (default $FS_KERNELS_OUT/speedtest-kernels.js, built with
//   FS_KERNELS_OUT=DIR npx vite build -c prototypes/dotnet-b/harness/vite.kernels.config.ts from the repository root).
//   suite   the A B B A timing (+ checksums, + end-to-end rows). startup  from "about to load dotnet.js" to the first result, once per process (run it several times).
//   tsalone the same TypeScript blocks in a process / worker where no WebAssembly was ever loaded (the reference the in-process A B B A cannot give, report section 5)
//   app     the app's own measureAll (round 0's committed speedtest.worker.js, 200 ms warm + 800 ms timed per kernel): Mcells/s and GB/s, as a cross-check of the TS arm.
// Heavy and timed: run it as  flock /tmp/firesim-heavy.lock node speed-run.mjs ...   In Chromium the page and the worker are served from routes (no server).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const [engine, fwDir, out, tag] = argv;
const opt = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : dflt; };
const mode = opt('mode', 'suite');
const build = opt('build', 'aot');
const kernelsJs = opt('kernels', path.join(process.env.FS_KERNELS_OUT ?? '', 'speedtest-kernels.js'));
const appWorker = path.resolve(here, '../../Fs.TestApp/Resources/Raw/wwwroot/speedtest.worker.js');

const aot = {
  rounds: 5, samples: 12, warmMs: 1000, warmMin: 3, e2eSamples: 9,
  tsPer: { stencil: 40, copy: 4 }, netPer: { stencil: 40, copy: 4 },
  paths: { stencil: ['scalar', 'vector128', 'plain'], copy: ['scalar', 'vector128'] },
};
// the interpreter is far slower: fewer, shorter blocks (TypeScript keeps its own, larger, sample so a block is long enough for the timer)
const interp = {
  rounds: 3, samples: 5, warmMs: 0, warmMin: 2, e2eSamples: 3,
  tsPer: { stencil: 40, copy: 4 }, netPer: { stencil: 1, copy: 1 },
  paths: { stencil: ['scalar'], copy: ['scalar'] },
};
const cfg = { ...(build === 'interp' ? interp : aot) };
if (opt('rounds')) cfg.rounds = Number(opt('rounds'));
if (opt('samples')) cfg.samples = Number(opt('samples'));
if (opt('gc')) cfg.gc = true; // node only, run with: node --expose-gc speed-run.mjs ... --gc 1
if (opt('only')) { const [k, p] = opt('only').split('/'); cfg.paths = { stencil: [], copy: [], [k]: [p] }; } // e.g. --only copy/scalar

const loadBefore = os.loadavg();
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
let res;

if (engine === 'node') {
  if (mode === 'app') {
    const sandboxScope = { onmessage: null, posted: [], postMessage(m) { this.posted.push(m); } };
    const sandbox = { self: sandboxScope, performance, Float32Array, Uint32Array, Math, String, Error };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(appWorker, 'utf8'), sandbox, { filename: 'speedtest.worker.js' });
    const runs = [];
    for (let i = 0; i < Number(opt('rounds', 3)); i++) { sandboxScope.posted.length = 0; sandboxScope.onmessage({}); runs.push(sandboxScope.posted[0]); log(JSON.stringify(runs.at(-1))); }
    res = { engine: 'node', node: process.version, v8: process.versions.v8, mode, runs };
  } else {
    vm.runInThisContext(fs.readFileSync(kernelsJs, 'utf8') + '\n;globalThis.FsKernels = FsKernels;', { filename: 'speedtest-kernels.js' });
    if (mode === 'tsalone') {
      const drv = await import(pathToFileURL(path.join(here, 'speed-driver.mjs')).href);
      res = { engine: 'node', node: process.version, v8: process.versions.v8, mode, ...drv.tsAlone(globalThis.FsKernels, cfg, log) };
    } else {
    const t0 = performance.now();
    const { dotnet } = await import(pathToFileURL(path.join(path.resolve(fwDir), 'dotnet.js')).href);
    const { getAssemblyExports } = await dotnet.withDiagnosticTracing(false).create();
    const t1 = performance.now();
    const E = (await getAssemblyExports('Fs.Wasm')).Fs.Wasm.SpeedTestExports;
    E.Load(0, 0);
    E.Run(1);
    const t2 = performance.now();
    const startup = { importAndCreateMs: t1 - t0, firstResultMs: t2 - t0 };
    const info = { engine: 'node', node: process.version, v8: process.versions.v8, runtime: E.Info() };
    if (mode === 'startup') res = { ...info, mode, startup };
    else {
      const drv = await import(pathToFileURL(path.join(here, 'speed-driver.mjs')).href);
      res = { ...info, mode, startup, ...drv.suite(globalThis.FsKernels, E, cfg, log) };
    }
    }
  }
} else {
  const { chromium } = createRequire(import.meta.url)('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text()); });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.dat': 'application/octet-stream', '.html': 'text/html' };
  const workerSrc = `
    importScripts('/kernels.js');
    self.onmessage = async (e) => {
      const { mode, cfg } = e.data;
      const post = (m) => self.postMessage(m);
      try {
        if (mode === 'tsalone') { const d = await import('/driver.mjs'); post({ done: { mode, ...d.tsAlone(FsKernels, cfg, (m) => post({ log: m })) } }); return; }
        const t0 = performance.now();
        const { dotnet } = await import('/_framework/dotnet.js');
        const { getAssemblyExports } = await dotnet.withDiagnosticTracing(false).create();
        const t1 = performance.now();
        const E = (await getAssemblyExports('Fs.Wasm')).Fs.Wasm.SpeedTestExports;
        E.Load(0, 0);
        E.Run(1);
        const t2 = performance.now();
        const startup = { importAndCreateMs: t1 - t0, firstResultMs: t2 - t0 };
        const runtime = E.Info();
        if (mode === 'startup') { post({ done: { mode, runtime, startup } }); return; }
        const drv = await import('/driver.mjs');
        const r = drv.suite(FsKernels, E, cfg, (m) => post({ log: m }));
        post({ done: { mode, runtime, startup, ...r } });
      } catch (err) { post({ error: String(err && err.stack ? err.stack : err) }); }
    };`;
  await page.route('https://fsspeed.test/**', async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/index.html') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>fs speed</title>' });
    if (u.pathname === '/driver.mjs') return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(here, 'speed-driver.mjs')) });
    if (u.pathname === '/kernels.js') return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(kernelsJs) });
    if (u.pathname === '/app-worker.js') return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(appWorker) });
    if (u.pathname === '/worker.js') return route.fulfill({ contentType: 'text/javascript', body: workerSrc });
    if (u.pathname.startsWith('/_framework/')) {
      const f = path.join(path.resolve(fwDir), u.pathname.slice('/_framework/'.length));
      return fs.existsSync(f) ? route.fulfill({ contentType: mime[path.extname(f)] ?? 'application/octet-stream', body: fs.readFileSync(f) }) : route.fulfill({ status: 404 });
    }
    return route.fulfill({ status: 404 });
  });
  await page.goto('https://fsspeed.test/index.html');
  const cdp = await browser.newBrowserCDPSession();
  const v8 = (await cdp.send('Browser.getVersion')).jsVersion;
  const info = { engine: 'chromium', browser: browser.version(), v8, userAgent: await page.evaluate(() => navigator.userAgent) };
  page.on('console', (m) => { if (m.type() === 'log') log(m.text().slice(0, 400)); });
  const r = await page.evaluate(async ({ mode, cfg, rounds }) => {
    if (mode === 'app') {
      const runs = [];
      for (let i = 0; i < rounds; i++) {
        runs.push(await new Promise((resolve, reject) => {
          const w = new Worker('/app-worker.js');
          w.onmessage = (e) => { w.terminate(); resolve(e.data); };
          w.onerror = (e) => reject(new Error(String(e.message)));
          w.postMessage({});
        }));
        console.log(JSON.stringify(runs.at(-1)));
      }
      return { mode, runs };
    }
    return await new Promise((resolve, reject) => {
      const w = new Worker('/worker.js');
      w.onmessage = (e) => {
        if (e.data.log) console.log(e.data.log);
        else if (e.data.error) reject(new Error(e.data.error));
        else if (e.data.done) { w.terminate(); resolve(e.data.done); }
      };
      w.onerror = (e) => reject(new Error('worker error: ' + e.message));
      w.postMessage({ mode, cfg });
    });
  }, { mode, cfg, rounds: Number(opt('rounds', 3)) });
  res = { ...info, ...r };
  if (!res.runtime && mode !== 'app') res.runtime = null;
  await browser.close();
}

const doc = { tag, build, cfgName: build, host: { cpu: os.cpus()[0]?.model, cores: os.cpus().length, loadavgBefore: loadBefore, loadavgAfter: os.loadavg() }, ...res };
fs.writeFileSync(out, JSON.stringify(doc, null, 1));
if (doc.series) {
  for (const s of doc.series) console.log(`${tag} ${s.kernel}/${s.path}: ratio median ${s.summary.ratioMedian.toFixed(3)} (min ${s.summary.ratioMin.toFixed(3)}, max ${s.summary.ratioMax.toFixed(3)})  ts ${s.summary.tsMsMedian.toFixed(3)} ms  net ${s.summary.netMsMedian.toFixed(3)} ms per sweep`);
  console.log(`checksums ok: ${doc.checksums.ok}`);
}
if (doc.startup) console.log(`${tag} startup ${JSON.stringify(doc.startup)}`);
console.log(`wrote ${out}`);
