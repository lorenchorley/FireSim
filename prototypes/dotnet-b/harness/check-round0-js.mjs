// Node check of round 0's browser-side code (plan T0.6b), run by build-speedtest.sh and by hand:  node prototypes/dotnet-b/harness/check-round0-js.mjs
//  1. speedtest.worker.js, run in a vm sandbox with a fake worker scope, reproduces both frozen checksums (0x7d268009 stencil after 3 sweeps, 0x1e84aad9 copy after 2)
//     and reports the SHA-256 of src/ui/speedTestKernels.ts it was built from (compared with the file now);
//  2. round0-arms.js (the page script), run against node's globals, produces the document the C# side expects: its WebAssembly feature byte strings validate the way node's
//     own engine says they should (SIMD and bulk memory true, a bad module false), every part answers or is recorded in `failures`, and the result is plain JSON.
// Node is not a WebView: this proves the logic and the byte strings, not the WebView's answers. Exits 1 on any failure.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const wwwroot = resolve(repo, 'prototypes/dotnet-b/Fs.TestApp/Resources/Raw/wwwroot');
let failed = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failed++; };

// ---- 1. the worker bundle ----
const workerSrc = readFileSync(resolve(wwwroot, 'speedtest.worker.js'), 'utf8');
const sandboxScope = { onmessage: null, posted: [], postMessage(m) { this.posted.push(m); } };
const sandbox = { self: sandboxScope, performance, Float32Array, Uint32Array, Math, String, Error };
vm.createContext(sandbox);
vm.runInContext(workerSrc, sandbox, { filename: 'speedtest.worker.js' });
check(typeof sandboxScope.onmessage === 'function', 'the bundle sets self.onmessage');
const t0 = performance.now();
sandboxScope.onmessage({});
const wall = performance.now() - t0;
const m = sandboxScope.posted[0] ?? {};
console.log(JSON.stringify({ ...m, wallMs: Math.round(wall) }));
check(m.error === undefined, 'the worker did not report an error' + (m.error ? ': ' + m.error : ''));
check(m.stencilAfter3 === '0x7d268009', `K1 stencil after 3 sweeps = 0x7d268009 (got ${m.stencilAfter3})`);
check(m.copyAfter2 === '0x1e84aad9', `K2 copy after 2 sweeps = 0x1e84aad9 (got ${m.copyAfter2})`);
check(m.stencilMcellsPerS > 0 && m.copyGBps > 0, `positive rates (stencil ${m.stencilMcellsPerS?.toFixed(1)} Mcells/s, copy ${m.copyGBps?.toFixed(2)} GB/s) - node on this machine, indicative only`);
check(m.warmMs === 200 && m.timeMs === 800, 'warm-up 200 ms and timed 800 ms, as the app');
const nowSha = createHash('sha256').update(readFileSync(resolve(repo, 'src/ui/speedTestKernels.ts'))).digest('hex');
check(m.kernelsSha256 === nowSha, 'the bundle was built from the current src/ui/speedTestKernels.ts (sha256 ' + nowSha.slice(0, 12) + '...)');
// the frozen numbers in the app's own test must be the ones this check pins
const frozenLine = readFileSync(resolve(repo, 'src/ui/speedTest.test.ts'), 'utf8').match(/const FROZEN = \{[^}]*\}/)?.[0] ?? '';
check(/0x7d268009/.test(frozenLine) && /0x1e84aad9/.test(frozenLine), 'src/ui/speedTest.test.ts still pins 0x7d268009 and 0x1e84aad9');

// ---- 2. the page script ----
vm.runInThisContext(readFileSync(resolve(wwwroot, 'round0-arms.js'), 'utf8'), { filename: 'round0-arms.js' });
const r0 = globalThis.fsRound0;
check(!!r0 && typeof globalThis.fsArms['webview-facts'] === 'function' && typeof globalThis.fsArms['speedtest-kernels'] === 'function', 'round0-arms.js registers webview-facts and speedtest-kernels');
const q = r0.quickFeatures();
console.log(JSON.stringify(q));
check(q.failures.length === 0, 'quickFeatures: no part failed');
check(q.wasmSimd === true, 'a SIMD module validates in node (it supports WebAssembly SIMD)');
check(q.wasmBulkMemory === true, 'a bulk-memory module validates');
check(q.wasmSharedMemoryModule === true, 'a shared-memory module validates');
check(q.wasmThreads === true, 'the threads module (atomics on shared memory) validates');
check(q.wasmSharedMemoryConstructs === true, 'new WebAssembly.Memory({shared:true}) gives a SharedArrayBuffer');
check(q.sharedArrayBuffer === 'function' && q.sharedArrayBufferConstructs === true, 'SharedArrayBuffer is a function and constructs');
check(q.crossOriginIsolated === false, 'crossOriginIsolated is false in node (the page reports true only when isolated)');
check(WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 2, 0, 0, 0])) === false, 'a bad module does not validate (so the tests can say false)');
console.log('relaxed SIMD in this node: ' + q.wasmRelaxedSimd);

const progress = [];
const ctx = { cancelled: () => false, progress: (f, t) => progress.push([f, t]) };
const facts = await globalThis.fsArms['webview-facts']({}, ctx);
const text = JSON.stringify(facts);
console.log(text.length > 1500 ? text.slice(0, 1500) + '...' : text);
check(JSON.parse(text) !== null && facts.schema === 1, 'the facts are plain JSON');
for (const part of ['page', 'navigator', 'features', 'timer', 'webgpu', 'workers']) check(facts[part] !== undefined || facts.failures.some((f) => f.part === part), `part "${part}" answered or is in failures`);
check(facts.timer && facts.timer.minStepMs > 0, `timer resolution measured (${facts.timer?.minStepMs} ms in node)`);
check(facts.webgpu && facts.webgpu.present === false, 'no navigator.gpu in node: reported as present:false, not an error');
check(progress.length >= 5 && progress.at(-1)[0] === 1, 'progress reported up to 1');

if (failed) { console.log(`${failed} check(s) FAILED`); process.exit(1); }
console.log('all round 0 JS checks passed');
