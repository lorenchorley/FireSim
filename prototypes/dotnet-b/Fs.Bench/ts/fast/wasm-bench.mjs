// T1.4b: times the fast tier's kernels in the published Fs.Wasm (Mono WebAssembly AOT) under Node, the way bench.ts times the TypeScript: one operation at a time, 1,000 samples after a
// warm-up of at least 1.5 s and 30 operations. The same operations (Fs.Bench/FastOps.cs against bench.ts): evalStage1, evalStage2, reinit, restore, pyro, on form 0 (scalar) and 1 (Vector128).
// Run in a fresh process; the TypeScript is timed by bench.mjs in another fresh process (T1.6a: running the .NET runtime first slowed a TypeScript kernel in the same process).
//   node wasm-bench.mjs FRAMEWORK_DIR FIXTURE_DIR OUT.json [SAMPLES=1000] [WARM_MS=1500]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [fwDir, fixDir, outFile, sArg, wArg] = process.argv.slice(2);
if (!fwDir || !fixDir || !outFile) throw new Error('usage: wasm-bench.mjs FRAMEWORK_DIR FIXTURE_DIR OUT.json [SAMPLES] [WARM_MS]');
const samples = Number(sArg ?? 1000);
const warmMs = Number(wArg ?? 1500);
const { dotnet } = await import(pathToFileURL(path.join(path.resolve(fwDir), 'dotnet.js')).href);
const { getAssemblyExports } = await dotnet.withDiagnosticTracing(false).create();
const E = (await getAssemblyExports('Fs.Wasm')).Fs.Wasm.FastTierExports;
const headerText = fs.readFileSync(`${fixDir}/header.json`, 'utf8');
const header = JSON.parse(headerText);
const data = fs.readFileSync(`${fixDir}/data.bin`);
E.SetHeader(headerText);
for (const a of header.arrays) {
  const size = a.type === 'float64' ? 8 : a.type === 'uint8' ? 1 : 4;
  E.SetArray(a.name, new Uint8Array(data.buffer, data.byteOffset + a.byteOffset, a.length * size));
}
const sizes = JSON.parse(E.BenchSetup());
const cases = [];
for (const op of ['evalStage1', 'evalStage2', 'reinit', 'restore', 'pyro']) {
  for (const form of op === 'restore' ? [0] : [0, 1]) {
    const r = JSON.parse(E.BenchOp(op, form, samples, warmMs));
    cases.push({ kernel: op, form: form === 0 ? 'scalar' : 'vector128', ...r });
    console.log(`${header.scenario} ${header.window} wasm ${op} ${form === 0 ? 'scalar' : 'vector128'}: median ${r.medianMs.toFixed(4)} ms, min ${r.minMs.toFixed(4)}, p95 ${r.p95Ms.toFixed(4)}, max ${r.maxMs.toFixed(4)}, sd ${r.stdDevMs.toFixed(4)}`);
  }
}
fs.writeFileSync(outFile, JSON.stringify({ impl: 'cs-wasm-aot', engine: 'node', node: process.version, v8: process.versions.v8, cpu: os.cpus()[0]?.model, cores: os.cpus().length, loadavg: os.loadavg(), fixture: path.basename(fixDir), window: header.window, sizes, runtime: E.Info(), cases }, null, 1));
process.exit(0);
