// T1.3: runs the published Fs.Wasm under Node or in Chromium over the fixed input files.
//   node wasm-run.mjs node     PUBLISH_FRAMEWORK_DIR ref IN_DIR OUT_DIR TAG          writes OUT_DIR/{fn}.{TAG}-{fdlibm|cms}.f64 and OUT_DIR/run-{TAG}.json
//   node wasm-run.mjs chromium PUBLISH_FRAMEWORK_DIR ref IN_DIR OUT_DIR TAG
//   node wasm-run.mjs node|chromium PUBLISH_FRAMEWORK_DIR ns IN_DIR OUT.json TAG [N=65536] [REPEATS=15]
// PUBLISH_FRAMEWORK_DIR is Fs.Wasm/bin/Release/net11.0/publish/wwwroot/_framework. In Chromium the page is served from a route (no server, nothing on disk but the files read).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as driver from './wasm-driver.mjs';

const [engine, fwDir, cmd, inDir, out, tag, a7, a8] = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const present = driver.FNS.filter((f) => fs.existsSync(`${inDir}/${f}.in`));
const outputs = new Map(); // `${fn}.${impl}` -> Buffer
let info = {};

if (engine === 'node') {
  const { dotnet } = await import(pathToFileURL(path.join(path.resolve(fwDir), 'dotnet.js')).href);
  const { getAssemblyExports } = await dotnet.withDiagnosticTracing(false).create();
  const E = (await getAssemblyExports('Fs.Wasm')).Fs.Wasm.FsMathExports;
  info = { engine: 'node', node: process.version, v8: process.versions.v8, runtime: E.Info() };
  const io = {
    input: async (fn) => { const p = `${inDir}/${fn}.in`; if (!fs.existsSync(p)) return null; const b = fs.readFileSync(p); return new Float64Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); },
    output: async (fn, impl, y) => { outputs.set(`${fn}.${impl}`, Buffer.from(y.buffer)); },
  };
  if (cmd === 'ref') await driver.ref(E, io, present);
  else { const r = await driver.ns(E, io, present, Number(a7 ?? 65536), Number(a8 ?? 15)); fs.writeFileSync(out, JSON.stringify({ ...info, ...r }, null, 1)); for (const x of r.rows) console.log(`${x.fn.padEnd(6)} ${x.impl.padEnd(7)} median ${x.nsMedian.toFixed(2).padStart(8)} ns   min ${x.nsMin.toFixed(2).padStart(8)}   max ${x.nsMax.toFixed(2).padStart(8)}`); }
} else {
  const { chromium } = createRequire(import.meta.url)('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text()); });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.dat': 'application/octet-stream', '.html': 'text/html' };
  await page.route('http://fsmath.test/**', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.pathname === '/index.html') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>fsmath wasm</title>' });
    if (u.pathname === '/driver.mjs') return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(here, 'wasm-driver.mjs')) });
    if (req.method() === 'POST') { outputs.set(u.pathname.slice(5), req.postDataBuffer()); return route.fulfill({ status: 204 }); }
    if (u.pathname.startsWith('/in/')) { const f = `${inDir}/${u.pathname.slice(4)}`; return fs.existsSync(f) ? route.fulfill({ contentType: 'application/octet-stream', body: fs.readFileSync(f) }) : route.fulfill({ status: 404 }); }
    if (u.pathname.startsWith('/_framework/')) {
      const f = path.join(path.resolve(fwDir), u.pathname.slice('/_framework/'.length));
      return fs.existsSync(f) ? route.fulfill({ contentType: mime[path.extname(f)] ?? 'application/octet-stream', body: fs.readFileSync(f) }) : route.fulfill({ status: 404 });
    }
    return route.fulfill({ status: 404 });
  });
  await page.goto('http://fsmath.test/index.html');
  const cdp = await browser.newBrowserCDPSession();
  const v8 = (await cdp.send('Browser.getVersion')).jsVersion;
  const res = await page.evaluate(async ({ cmd, present, n, repeats }) => {
    const { dotnet } = await import('/_framework/dotnet.js');
    const drv = await import('/driver.mjs');
    const { getAssemblyExports } = await dotnet.withDiagnosticTracing(false).create();
    const E = (await getAssemblyExports('Fs.Wasm')).Fs.Wasm.FsMathExports;
    const io = {
      input: async (fn) => { const r = await fetch(`/in/${fn}.in`); return r.ok ? new Float64Array(await r.arrayBuffer()) : null; },
      output: async (fn, impl, y) => { await fetch(`/out/${fn}.${impl}`, { method: 'POST', body: y.buffer }); },
    };
    const runtime = E.Info();
    if (cmd === 'ref') { await drv.ref(E, io, present); return { runtime }; }
    return { runtime, ...(await drv.ns(E, io, present, n, repeats)) };
  }, { cmd, present, n: Number(a7 ?? 65536), repeats: Number(a8 ?? 15) });
  info = { engine: 'chromium', browser: browser.version(), v8, runtime: res.runtime };
  if (cmd === 'ns') { fs.writeFileSync(out, JSON.stringify({ ...info, rows: res.rows, sink: res.sink }, null, 1)); for (const x of res.rows) console.log(`${x.fn.padEnd(6)} ${x.impl.padEnd(7)} median ${x.nsMedian.toFixed(2).padStart(8)} ns   min ${x.nsMin.toFixed(2).padStart(8)}   max ${x.nsMax.toFixed(2).padStart(8)}`); }
  await browser.close();
}
if (cmd === 'ref') {
  fs.mkdirSync(out, { recursive: true });
  const sha = {};
  for (const [k, b] of outputs) {
    const [fn, impl] = k.split('.');
    fs.writeFileSync(`${out}/${fn}.${tag}-${impl}.f64`, b);
    sha[k] = crypto.createHash('sha256').update(b).digest('hex');
  }
  fs.writeFileSync(`${out}/run-${tag}.json`, JSON.stringify({ tag, ...info, sha256: sha }, null, 1));
  console.log(`${tag}: ${outputs.size} result files -> ${out}  (${info.runtime})`);
}
