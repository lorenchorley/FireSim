# TypeScript arms of the T1.4 kernels (card T1.5 a to c)

The best TypeScript opponents for Gate 1 (native C#) and Gate 1W (C# WebAssembly): the seven kernels of T1.4 (`EllipticSolver.relax`, `gradient`, `divergence`,
`dynamics.advect`; `LevelSetCore.evaluate`, `reinit`; `PyrogenicPotential.solve`) in three arrangements. Results: `reports/1-ts-arms.md` and `.json`.

| arm | what runs | where | files |
|---|---|---|---|
| (a) one worker | the app's UNMODIFIED kernels (`src/` imported, never edited), data resident in the worker, timing inside the worker | Node `worker_threads`; one Chromium Web Worker | `air-app.ts`, `fast-app.ts` |
| (b) pool | range forms of the kernels on the SAME chunks as the C# `Parallel.For` forms (T1.4: 2-row relax chunks, plane chunks, 16-row advect chunks, 256-cell evaluate chunks with a chunk-ordered maximum, 8-row reinit chunks and a 32 x 32 tile wavefront, 4-row pyrogenic phases), on 1, 2, 4, 8 workers over one `SharedArrayBuffer`, `Atomics` barrier, workers spawned once | Node | `pool.ts`, `air-pool.ts`, `fast-pool.ts` (+ `*-be.ts` for replay and timed operations) |
| (c) browser | arm (a) in one Web Worker and arm (b) on 1, 2, 4, 8 Web Workers in a cross-origin isolated page (local server sends COOP `same-origin`, COEP `require-corp`) | Playwright's Chromium, headless | `page-main.ts`, `worker-browser.ts`, `../../../harness/vite.arms.config.ts`, `../../../harness/run-arms-browser.mjs` |

Every arm replays the golden cases of T1.4 (the `cases` of each fixture's `header.json` = `Fs.Tests/golden/air-*.json`, `fast-k6f-*.json`: poison recipes, hooks, 311 hashes per fast
window) and compares SHA-256 (first 128 bits, NaN canonicalised, -0 kept: `sha.ts`) with the unmodified TypeScript's. Verify runs and timed runs are separate processes.

## Run it
From the repository root (`node_modules` reachable: `npm ci` or a link). Nothing here needs dotnet.
```
S=$SCRATCH/T1.5ac                                              # fixtures and results; never committed
bash prototypes/dotnet-b/Fs.Bench/ts/air/regen.sh  $S/air      # fixtures (5 and 25 MB) and the golden files (git diff shows whether the TypeScript's results changed)
bash prototypes/dotnet-b/Fs.Bench/ts/fast/regen.sh $S/fast     # (8 MB each)
bash prototypes/dotnet-b/Fs.Bench/ts/arms/run-arms.sh build $S $S/res
# one arm, one problem (problems: air:k3std air:k6high fast:k6f-900 fast:k6f-late):
node prototypes/dotnet-b/fixtures/.build-arms/node-main.mjs --fixtures $S --arm app --mode verify --problem air:k3std --out o.json                  # (a) Node
node prototypes/dotnet-b/fixtures/.build-arms/node-main.mjs --fixtures $S --arm pool --threads 4 --mode time --problem fast:k6f-late --out o.json   # (b) Node, 4 workers
node prototypes/dotnet-b/harness/run-arms-browser.mjs --fixtures $S --arm pool --threads 4 --mode time --problem air:k3std --out o.json              # (c) Chromium (builds the bundles on first use)
# the campaign (the timed steps under the heavy lock, one hold each; run-arms.sh itself never takes the lock):
flock /tmp/firesim-heavy.lock bash prototypes/dotnet-b/Fs.Bench/ts/arms/run-arms.sh verify $S $S/res
bash prototypes/dotnet-b/Fs.Bench/ts/arms/measure.sh $S $S/res
node prototypes/dotnet-b/Fs.Bench/ts/arms/make-report.mjs $S/res prototypes/dotnet-b/reports/1-ts-arms.json $(git rev-parse --short HEAD) $S/res/conditions.log
```
Options of both runners: `--samples` (1000; 600 for the 6 km grid), `--warm` (1500 ms), `--min-sample-ms` (Node 0 = single operations as T1.4's TypeScript timing; Chromium 2 = batches,
because a worker's clock has 0.1 ms resolution), `--spin` (microseconds a waiting thread spins before it sleeps: 200, and 0 when workers outnumber cores), `--only a,b`, `--force` (verify:
take the chunked paths whatever the size, as the C# tests do besides the default). `tsc -p prototypes/dotnet-b/Fs.Bench/ts/arms/tsconfig.json` type-checks the sources.

## What T1.6b and T1.7 take from here
`run-arms.sh abba|chromium` and the `*.json` files give the TypeScript denominators for Gate 1W (arm (a) in Chromium and in Node, in the same A B B A shape) and for Gate 1 (the best of arms (a) and
(b) in Node). The pool's job table is registered in the same order on every thread (`makeFastThread`, `new AirPar`): add a kernel by registering its jobs in both constructors, not elsewhere.
