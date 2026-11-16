# Stage 1, T1.4a: the standard tier's air kernels in C#

Indicative container numbers (4 shared vCPUs, Intel Xeon @ 2.10 GHz, AVX-512 capable, `Vector128` used throughout, Ubuntu 24.04, .NET 11.0.0, Node 22.22.0 / V8 12.4). Results file: `1-air-kernels.json` (schema `RESULTS-SCHEMA.md`, stage `1-air-kernels`). Builder T1.4a (standard tier half of card T1.4; the fast tier, the level set and `PyrogenicPotential` are T1.4b's and untouched).

## 1. What was ported

`Fs.Kernel/Air/` (a solver project: the banned-API list and FS0001 apply; nothing here needs `FsMath`, `FsConv`, `sqrt` or a transcendental call):

| TypeScript | C# | operations |
|---|---|---|
| `EllipticSolver.relax` (`src/atmosphere/solver.ts`, private; level data float32) | `AirRelax.Run` | + - * only; float32 reads widened, double arithmetic, two float32 stores |
| `EllipticSolver.gradient` | `AirOps.Gradient` | + - * / on Float64 arrays |
| `EllipticSolver.divergence` | `AirOps.Divergence` (float32 fields: `project()`'s call; Float64 fields: `applyFull`'s call) | + - * |
| `dynamics.advect` (`src/atmosphere/dynamics.ts`) | `AirAdvect.Run` | + - * and one `x \| 0` |

Each kernel has three forms, selected by `AirExec(Vector, Threads)`: **scalar** (a literal port in the TypeScript's operation order, widening where the TypeScript widens and rounding to float32 only where it stores), **element-wise `Vector128<double>`** (two lanes; no reduction exists in these four kernels, so nothing is "scalar in a fixed order"), and **fixed chunks run by `Parallel.For`** with `MaxDegreeOfParallelism = threads` (scalar or vector body). Float32 reads use the `Vector128.WidenLower(CreateScalarUnsafe(x))` widening of plan 10.4 (T1.2's finding). The one truncation, advect's `xd | 0`, is `AirTrunc.NonNegative`: floor, then the low bits of floor + 2^52 (no float-to-integer cast; NaN gives 0 as JavaScript does; the vector form keeps the integers as exact doubles and adds +0 so that -0 becomes +0, as `xd - 0` does).

**What may run in parallel, and why.**
- **`relax` is a red-black (checkerboard) z-line Gauss-Seidel.** A pass relaxes the lines with `(i + j) & 1 == colour`. Their four horizontal neighbours are the other colour, which that pass neither writes nor treats as anything but input; the only thing a line reads that the pass wrote is its own earlier k (the Thomas recurrence: forward elimination up the line, back substitution down it). So the lines of one pass are independent and may be done in any order on any thread, and that is exactly the TypeScript's own sweep (plane by plane), so the TypeScript's bits are kept. The two passes of a sweep, and the sweeps, depend on each other and keep the TypeScript's order with a barrier (the end of one `Parallel.For`) between passes. The parallel unit is a block of 2 rows, all k, forward then back (`RowsPerChunk`, a constant). The k direction is serial. Levels under 8,192 cells run serially (a rule about the level, never about the thread count; at 30x30x20 the finest level is parallel, the 15x15 and 8x8 levels are not).
- **`gradient` and `divergence`** are two element-wise phases with a barrier (phase 1: the w-face quantities, one plane m per chunk; phase 2: the u and v faces, or the cell divergence, one plane k per chunk). **`advect`**: every output point reads only the read-only displacement and source arrays; a chunk is 16 output rows.
- Every output element is written by exactly one chunk, there is no reduction anywhere, so "combined in chunk order" is vacuous and the result cannot depend on the thread count. Chunk boundaries are constants of the kernel.

## 2. Correctness (all run; `dotnet test --project Fs.Tests -c Release`: 573 of 573 pass, 0 skipped, 39 s, of which 22 are new)

**Reference data.** `Fs.Bench/ts/air/capture.ts` runs the app's real `Simulation` on `katoomba3-standard` (3 km, standard tier, 100 m air cells, 30 x 30 x 20, seed 13, 900 s of 3-D spin-up and then 900 s of fire; the 6 km high tier on the standard 30 m fire grid, 60 x 60 x 24, as the second fixture), takes the real state of the atmosphere (private fields read from outside; `src/` is not edited or wrapped) and runs the real, unmodified TypeScript kernels on it, through `EllipticSolver.prototype` with a plain object as `this` and the module function `advect`. 23 cases on the 3 km grid (25 on the 6 km one): gradient (real masks; a recipe with inactive faces and an active top; NaN and -0), divergence (float32 velocities, Float64 fluxes, other scale factors, NaN and -0 on both types), advect (u, v, w, th with the smoke field, NaN and -0), relax (the six calls of one real V(2,2) preconditioner, each replayed from its recorded input and checked against what the real `precondition` produced; one and three sweeps; reverse order; NaN and -0). Output hashes are SHA-256 (first 128 bits) of the raw bytes with NaN canonicalised and -0 kept. Two capture runs give identical bytes. **Committed**: `Fs.Tests/golden/air-k3std.json` and `air-k6high.json` (15 and 16 KB: the case recipes and every input and output hash). **Not committed**: the fixtures (5.3 MB and 25 MB), regenerated by `Fs.Bench/ts/air/regen.sh` (they live in `$FIRESIM_SCRATCH/T1.4a`, found through `FS_AIR_FIXTURES`; without them the fixture tests are *inconclusive*, never green).

**Result.** Every output of every case equals the TypeScript's bits on **9 forms**: scalar, `Vector128`, `Parallel.For` with 1 (inline), 2, 4 and 8 threads, and the vector body with 2, 4 and 8 threads (207 case-form checks on the 3 km fixture, 225 on the 6 km one, 0 differ; the input hashes are checked too, so a stale fixture fails). None of the four kernels touches `sqrt` or a transcendental function, so the bits are the TypeScript's own and no `FsMath` shim was needed. Further checks (`AirKernelTests`): on synthetic grids of 14 shapes (every row length 3 to 17 and 30, so every tail of the two-lane forms), the forms equal the scalar form bit for bit, with and without NaN and -0 in the input (relax 1,512 form checks, gradient and divergence 448, advect 1,792, advect with displacements far beyond a cell so the clamps act); parallel relax gives the same bits on 1, 2, 3, 4, 5, 8 and 16 threads; explicit NaN and -0 expectations that do not depend on the TypeScript (advect keeps -0 with zero displacement, a NaN displacement makes exactly its own point NaN; a NaN in relax's right-hand side stays in its own z-line after a sweep). `AirSeparateProcessTests` repeats the fixture check on scalar, vector and parallel forms, and the form-against-form checks, in **six child processes** (T1.2's arrangement): default hardware (AVX-512), `DOTNET_EnableAVX2=0`, AVX2 and AVX-512 off, `DOTNET_EnableHWIntrinsic=0` (software `Vector128`), `DOTNET_TieredCompilation=0`, `TieredPGO=0` with OSR off; each child fails if its setting did nothing. **Honest limit of the test**: relax and advect store float32, so double-rounding order differences vanish at the store (an operand-order mutation of relax's vector body, tried once, was *not* caught; a mutation of gradient's sum order, which keeps double precision, was caught on all 9 forms). Their bit equality therefore holds by construction rather than by the test's sharpness; the discriminating power for them is the structure (which elements are read and written, the colour order, the clamps), and that is tested.

**Not run:** arm64 execution (see 5), a phone, browser engines other than Node's V8.

## 3. Allocation and LINQ scan (`analyzing-dotnet-performance`, before any timing)

Recipes run over `Fs.Kernel/Air/*.cs` (critical-patterns reference loaded; standard depth; the code has no async, strings, regex or collections): LINQ (`Select|Where|OrderBy|GroupBy|ToList|ToArray|All|Any`) 0 hits, `foreach` 0, `new Dictionary|List` 0, `params` 0, string interpolation 0, `stackalloc|ArrayPool|Regex|async|await|Task` 0; `new T[]` 7 lines, all in constructors (the scratch arrays); lambdas 0 (the delegates `Parallel.For` needs are cached method groups made once in the constructors); 7 of 7 classes `sealed`. **Measured** (`GC.GetTotalAllocatedBytes(precise)`, all threads, after warm-up, one relax + gradient + two divergences + four advects per call): **scalar 0 B, `Vector128` 0 B per call**; BenchmarkDotNet's MemoryDiagnoser agrees (0 B for every scalar and vector benchmark). **The parallel forms allocate**, and the card's "zero allocation per call" cannot hold for `Parallel.For`: about 1.9 to 2.0 KB per `Parallel.For` call (BenchmarkDotNet, 4 threads, 3 km grid: relax 16.4 KB for its 8 parallel passes, advect 8.1 KB for 4 calls, gradient 3.8 and divergence 4.0 KB for 2 phases each). Another design (a persistent worker set and a spin barrier) would avoid it; not tried.

## 4. Timing

**Conditions.** One operation = `RelaxCycle` (the six relax calls of one V(2,2) from their recorded inputs, every level; x restored from the recorded input before each call, in both languages), `Gradient`, `DivergenceF32` (`project()`'s call), `DivergenceF64` (`applyFull`'s call), `AdvectStep` (the four advect calls of one atmosphere step). C#: BenchmarkDotNet 0.16.0-preview.2, **default job**, out of process, `[GlobalSetup]` loads the fixture, baseline = scalar per kernel, MemoryDiagnoser, 40 benchmark cases (5 kernels x 4 forms x 2 grids, about 65 s each), under `flock /tmp/firesim-heavy.lock`, 17:20 to 18:05 UTC; `uptime` load averages (1, 5, 15 min) at the start 1.01 1.16 1.18 and at the end 2.20 2.16 2.41 (another builder worked in the second half). TypeScript: the **unmodified** kernels bundled with the repository's Vite, Node 22.22.0, one thread, 1.5 s warm-up, 1,000 (3 km) or 600 (6 km) single operations a run, **three runs** in separate processes (one before the C# session, two after; uptime in the JSON), median of the three medians shown with the spread of the three medians. "x" = TypeScript median / this median (over 1: C# faster). Forms: scalar; `Vector128`; `Parallel.For` 4 threads (scalar body); `Parallel.For` 4 threads with the vector body. Medians in ms.

katoomba3-standard, 30 x 30 x 20 (the app's grid; 18,000 cells):

| kernel (one operation) | TypeScript (3 runs: min to max) | C# scalar | C# vector128 | C# parallel x4 | C# parallel x4 + vector128 |
|---|---:|---:|---:|---:|---:|
| relax (V(2,2) cycle) | 1.3185 (1.2915 to 1.3287) | 0.9379 (1.41x) | 0.7872 (1.67x) | 0.9199 (1.43x) | 0.8929 (1.48x) |
| gradient | 0.2417 (0.2394 to 0.2427) | 0.1740 (1.39x) | 0.1562 (1.55x) | 0.1618 (1.49x) | 0.1446 (1.67x) |
| divergence, float32 | 0.2551 (0.2491 to 0.2563) | 0.1741 (1.47x) | 0.1336 (1.91x) | 0.1229 (2.08x) | 0.1008 (2.53x) |
| divergence, Float64 | 0.2807 (0.2741 to 0.2838) | 0.1577 (1.78x) | 0.1402 (2.00x) | 0.1545 (1.82x) | 0.1305 (2.15x) |
| advect (one step's four calls) | 1.8106 (1.7883 to 2.0449) | 1.6356 (1.11x) | 1.4674 (1.23x) | 0.9071 (2.00x) | 0.7408 (2.44x) |

6 km high tier, 60 x 60 x 24 (86,400 cells; the largest air grid of any tier):

| kernel | TypeScript | C# scalar | C# vector128 | C# parallel x4 | C# parallel x4 + vector128 |
|---|---:|---:|---:|---:|---:|
| relax | 5.5672 (5.4555 to 5.5942) | 3.9767 (1.40x) | 3.2485 (1.71x) | 2.9531 (1.89x) | 2.8177 (1.98x) |
| gradient | 1.1644 (1.1516 to 1.1924) | 0.8584 (1.36x) | 0.7851 (1.48x) | 0.5000 (2.33x) | 0.4840 (2.41x) |
| divergence, float32 | 1.2214 (1.2009 to 1.2267) | 0.8274 (1.48x) | 0.6140 (1.99x) | 0.5101 (2.39x) | 0.4135 (2.95x) |
| divergence, Float64 | 1.3805 (1.3690 to 1.3895) | 0.8031 (1.72x) | 0.7435 (1.86x) | 0.6966 (1.98x) | 0.5337 (2.59x) |
| advect | 8.6358 (8.4295 to 8.6731) | 7.2923 (1.18x) | 6.3838 (1.35x) | 3.5238 (2.45x) | 3.1654 (2.73x) |

BenchmarkDotNet's own spread (standard deviation over iterations, 3 km): scalar 4 to 16 % of the median (relax 0.057 on 0.938 ms; gradient 0.029 on 0.174 is the noisiest); the vector relax case converged after 12 iterations (sd 0.009). The TypeScript medians of the three runs agree to 1 to 3 % except advect's (1.81, 2.04, 1.79: the second run came right after the C# session, when the load average was 2.2); its tail is long (max several times the median). A kernel's all-in time in the TypeScript agrees with T1.1: an atmosphere step is 20.2 ms there and advect is 1.81 ms of it (9.0 %; the profile's 9.3 %).

**Reading it.** (1) Scalar C# is 1.1 to 1.8 times Node on these kernels; advect, a gather, is only 1.1 times. (2) `Vector128` adds 1.1 to 1.3 times to the scalar form (divergence and relax most, advect least: the eight source reads per lane stay scalar gathers). It is bit-identical, so it is free. (3) `Parallel.For` pays where there is enough work per fork: advect 1.8x scalar at 4 threads on the 3 km grid, divergence 1.4x, gradient and relax almost nothing at 30 x 30 x 20, because a relax pass is about 45 microseconds of work against a fork and join of the same order. On the 60 x 60 x 24 grid relax gains 1.35x and gradient 1.7x. (4) The two together give 1.5 to 2.5 times the TypeScript at the app's size.

**Thread curve** (stopwatch, medians of 400 single operations after 400 ms warm-up, **one process with `DOTNET_TieredCompilation=0`**, `Parallel.For` with `MaxDegreeOfParallelism` = t; `uptime` 1.14 1.38 1.85 before, 1.60 1.49 1.84 after; shape only, not a benchmark; the table of a first run under default tiering is not used: it showed relax's vector form slower than scalar, which BenchmarkDotNet's one-process-per-form runs contradict, a JIT profile mixed across forms):

| 3 km, ms | scalar | vector | par t=1 | par t=2 | par t=4 | par t=8 | parvec t=1 | parvec t=2 | parvec t=4 | parvec t=8 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| relax | 0.974 | 0.785 | 0.972 | 0.941 | 0.994 | 1.072 | 0.788 | 0.903 | 0.841 | 0.893 |
| gradient | 0.168 | 0.121 | 0.168 | 0.123 | 0.103 | 0.093 | 0.127 | 0.146 | 0.085 | 0.080 |
| divergence f32 | 0.169 | 0.125 | 0.164 | 0.107 | 0.102 | 0.070 | 0.122 | 0.088 | 0.087 | 0.061 |
| advect | 1.576 | 1.386 | 1.586 | 1.234 | 0.880 | 0.836 | 1.351 | 1.031 | 0.708 | 0.712 |

(The 6 km table and all cells are in the JSON, `threadCurve`.) Parallel relax never beats its own vector body on the app's grid; with 4 cores the curve is flat from 4 to 8 threads, as it must be.

## 5. Whole-step projection against Gate 1

T1.1's shares of the `katoomba3-standard` step loop (CPU profile, 1,800 s, 3 runs): relax 15.1 %, advect 9.3, divergence 5.4, gradient 5.0 (34.8 % together; the whole air phase is 63.5 %). Each phase of the step that is not one of these four is taken as **no faster** (that is the assumption: nothing else was ported or measured). Speed-up of each kernel = TypeScript median / C# median on the app's 3 km grid (above); divergence uses the float32 call, which is what a standard-tier step makes.

| form (all four kernels in this form) | relax | advect | divergence | gradient | new share of the old step | projected step speed-up |
|---|---:|---:|---:|---:|---:|---:|
| scalar | 1.41x | 1.11x | 1.47x | 1.39x | 91.6 % | **1.09x** |
| `Vector128` | 1.67x | 1.23x | 1.91x | 1.55x | 87.8 % | **1.14x** |
| `Parallel.For` x4 | 1.43x | 2.00x | 2.08x | 1.49x | 86.3 % | **1.16x** |
| `Parallel.For` x4 + `Vector128` | 1.48x | 2.44x | 2.53x | 1.67x | 84.4 % | **1.19x** |
| best form of each kernel | 1.67x | 2.44x | 2.53x | 1.67x | 83.1 % | **1.20x** |

**Gate 1's bar for the standard tier is 1.5x over the best TypeScript arm. These four kernels cannot reach it however fast they get: they are 34.8 % of the step, so if they took no time at all the step would be 1.53x faster (the Amdahl ceiling), and with the measured speed-ups the projection is 1.09 to 1.20x.** For the bar the rest of the air phase (28.7 % of the step: `diffuseVLevels` 4.1, `diffuseH` 3.3, `Atmosphere.step` 3.2, `displacements` 2.8, `smagorinsky` 2.7, `sampleAt` 2.4, `collocate` 2.2...), and the 36.5 % that is not air (embers 12.3, fire 9.6, coupling 4.9...), would have to be made faster too (arithmetic only, not a measurement: even the whole air phase at 2.0x with nothing else faster is 1.47x). The projection compares with **one** TypeScript thread: T1.5 will add the TypeScript arms with `worker_threads` and SharedArrayBuffer, against which the parallel columns are worth less. Threads in a browser need cross-origin isolation (plan 10.2), so a browser build gets the scalar or vector column; Fs.Wasm runs `Parallel.For` on one thread. The numbers are container numbers on shared cores, kernel-only; the whole-step measurement is T6.4 and T6.6.

## 6. Builds for the three targets

- **linux-x64**: `dotnet build Fs.Kernel -c Release -r linux-x64`: succeeds, 0 warnings, the analyzers on. The tests and the benchmarks run on it.
- **android-arm64**: `dotnet build Fs.Kernel -c Release -r android-arm64`: succeeds, 0 warnings. **This only proves the library compiles** (a plain `net11.0` library is IL; the runtime identifier changes only the restore). **arm64 execution (NEON `Vector128`, the arm64 JIT, whether the bits are the x64 ones) needs the phone, round 1**; the form-against-form and TypeScript tests are unchanged and can run there. (These two builds rewrote two `packages.lock.json` files with the runtime-specific targets; they were reverted, not committed.)
- **browser-wasm**: `Fs.Wasm/AirExports.cs` (new; the FsMath exports are untouched): `[JSExport] SetHeader`, `SetArray` and `GetArray` (arrays as `byte[]`, T1.3's finding), `RunCase(caseJson, form)` (a golden case on form 0 scalar, 1 `Vector128`, 2 `Parallel.For` x4, 3 both), `Info`. Published with `dotnet publish Fs.Wasm -c Release` (Mono AOT, 1 min 32 s; `dotnet.native.wasm` 6.6 MB, `Fs.Kernel.wasm` 226 KB, uncompressed). Run once under Node 22 (`Fs.Bench/ts/air/wasm-run.mjs`, the T1.3 way of loading the build): **all 23 golden cases of the 3 km fixture on all 4 forms, 120 output hashes, equal the TypeScript's hashes (so the x64 ones: the x64 tests check the same golden hashes), 0 differ; the 6 km fixture the same: 25 cases, 128 hashes, 0 differ.** `Vector128.IsHardwareAccelerated` is true in the build (WebAssembly SIMD), and `Parallel.For` runs, on its one thread, without deadlock. Start-up 128 ms. WebAssembly speed was **not** measured here (T1.6b). Not run: Chromium, the phone's WebView, the interpreter build.

## 7. Things the orchestrator should know

1. **The card's four kernels cannot meet Gate 1's standard-tier bar** (section 5): ceiling 1.53x, projected 1.09 to 1.20x. The standard tier's step is only 63.5 % air and only 34.8 % these four functions; a speed case needs the rest of the air phase and the fire, ember and coupling phases too, or a different bar.
2. Vectorisation of these kernels is worth 1.1 to 1.3x, not 2x: two doubles per `Vector128`, and relax's lines are two apart in memory, so every operand is a two-element gather (only the arithmetic is wide); advect's reads are data-dependent gathers.
3. `Parallel.For` is overhead-bound at 30 x 30 x 20; a custom persistent pool would do better but breaks the card's `Parallel.For` shape and was not tried. Its per-call allocation (about 2 KB a fork) means the card's "zero allocation" holds for the scalar and vector forms only.
4. T1.1's relax share (15.1 %) is all levels of the multigrid; the benchmark's operation is the six relax calls of one V(2,2) so that the ratio has the same mix. The multigrid's restriction, prolongation and residual are not among T1.1's hottest functions and are not ported here.
5. A float32 store hides double-rounding order differences, so relax and advect cannot detect an operand-order slip through bit comparison (section 2); the structure is what the tests pin down.
6. BenchmarkDotNet writes a `.bdn` build folder inside `Fs.Bench` when it runs; `prototypes/dotnet-b/.gitignore` now ignores it (I had committed it once by mistake and removed it before anything was merged: the last, unpushed commit was recreated without it; no pushed history changed).

## 8. Reproduce

```
source prototypes/dotnet-b/env.sh
bash prototypes/dotnet-b/Fs.Bench/ts/air/regen.sh                                  # fixtures (5.3 and 25 MB) and the golden files
flock /tmp/firesim-heavy.lock dotnet test --project prototypes/dotnet-b/Fs.Tests -c Release
flock /tmp/firesim-heavy.lock dotnet build prototypes/dotnet-b/Fs.Bench -c Release
flock /tmp/firesim-heavy.lock dotnet prototypes/dotnet-b/Fs.Bench/bin/Release/net11.0/Fs.Bench.dll --filter "*AirBench*" --artifacts $FIRESIM_SCRATCH/T1.4a/bdn
flock /tmp/firesim-heavy.lock node prototypes/dotnet-b/fixtures/.build-air/bench.mjs $FIRESIM_SCRATCH/T1.4a/fx-k3std OUT.json 1000 1500    # three runs; fx-k6high with 600
DOTNET_TieredCompilation=0 dotnet prototypes/dotnet-b/Fs.Bench/bin/Release/net11.0/Fs.Bench.dll air-threads threads.json
dotnet prototypes/dotnet-b/Fs.Bench/bin/Release/net11.0/Fs.Bench.dll air-merge BDN-report-full.json TS_K3_RUNS TS_K6_RUNS prototypes/dotnet-b/reports/1-air-kernels.json [CONDITIONS.json] [THREADS.json]
flock /tmp/firesim-heavy.lock dotnet publish prototypes/dotnet-b/Fs.Wasm -c Release
flock /tmp/firesim-heavy.lock node prototypes/dotnet-b/Fs.Bench/ts/air/wasm-run.mjs prototypes/dotnet-b/Fs.Wasm/bin/Release/net11.0/publish/wwwroot/_framework $FIRESIM_SCRATCH/T1.4a/fx-k3std prototypes/dotnet-b/Fs.Tests/golden/air-k3std.json OUT.json
```
(The TypeScript benchmark needs `node_modules` reachable from the repository root and is built with `Fs.Bench/ts/build.mjs` into `prototypes/dotnet-b/fixtures/.build-air`.) Skills used: `dotnet-advanced/vectorization` (section 9's overrides applied), `dotnet-diag/microbenchmarking`, `dotnet-diag/analyzing-dotnet-performance`.
