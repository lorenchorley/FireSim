# T1.6a: WebAssembly, the early reading (Gate 1W)

How to run: `bash prototypes/dotnet-b/Fs.Bench/wasm/run-all.sh $S` then `run-extra.sh $S`, after the setup in the headers of those scripts (two `dotnet publish` runs, one `vite build`, `gen-inputs.mjs`); tables: `node Fs.Bench/wasm/make-report.mjs $S <commit> reports/1w-early.json`.
Card T1.6a of `docs/plans/dotnet-option-b-plan.md`, built 2026-11-16. Machine-readable results: `1w-early.json` (stage `1w-early`, conventions of `1-fsmath.json`).
Conditions of every number: one container, Intel Xeon 2.10 GHz, 4 shared cores (one thread used), Linux 6.18 x64; .NET SDK 11.0.100, Mono 11.0.0 on `browser-wasm`; Node 22.22.0 (V8 12.4.254.21-node.33);
Chromium 153.0.8010.12 (V8 15.3.76.4, headless, `chromium.launch()` with no options, the kernels run inside a dedicated Web Worker); every timed run under `flock /tmp/firesim-heavy.lock`. Timings are **indicative**
(shared container: other builders' light work runs outside the lock; the 1-minute load average at the start of each step is in section 8).

## 1. Answer: Gate 1W's ratio

Gate 1W (plan section 4): *whole-step time of Mono WebAssembly AOT, one thread, at most **1.25x** the TypeScript worker's, on desktop Chromium and the phone's WebView.* **This card cannot measure that**: it measures the two frozen kernels only,
so what follows is a kernel-level reading, not the gate. Ratio = .NET Mono AOT (scalar contract path, the code T1.2 froze) time per sweep / TypeScript time per sweep in the same engine, data resident, median of 5 rounds (min-max of the rounds).
The headline column divides by the TypeScript kernel run **alone** in a fresh process (section 5 says why); the in-process A B B A ratio the card asked for is beside it.

| engine | K1 stencil, vs TS alone (A B B A in process) | K2 copy, vs TS alone (A B B A in process) |
|---|---|---|
| Chromium 153 (Worker) | **0.94** (0.89-0.98); in process 0.92 (0.86-1.01) | **0.95** (0.91-1.00); in process 0.93 (0.87-1.02) |
| Node 22 | **0.85** (0.84-1.07); in process 0.84 (0.78-1.04) | **1.17** (1.13-1.21); in process 0.76 (0.72-0.82) |

Every cell is under the 1.25 bar; the worst round of any cell is 1.21 against TS alone (1.04 in process). The checksums match in all arms (`0x7d268009`, `0x1e84aad9`, both engines, both builds, all three .NET paths).
The interpreter is 21 to 24 times slower than TypeScript on the stencil and 4.8 to 8.6 times on the copy (section 3): AOT is not optional.
`Vector128` is accelerated (`Vector128.IsHardwareAccelerated` is True in both builds) and the `Vector128` path is faster still: stencil 0.78 to 0.84, copy 0.32 to 0.36 of TypeScript (same bits).

## 2. What was built

* `Fs.Wasm/SpeedTestExports.cs`: `[JSExport]` `Load(kernel, path)` (builds the kernel from the fixed seed inside the WebAssembly heap, so the data stays resident), `Run(sweeps)` (n whole sweeps, returns a result word), `Checksum()`,
  `Call(byte[] payload, sweeps)` (the end-to-end shape), `InputBytes`, `Info`. It calls `Fs.Kernel/SpeedTest` (T1.2) unchanged: K1 `StencilKernel`, K2 `CopyKernel`, paths Scalar (the contract), Vector128, ScalarPlain. `FsMathExports.cs` and `Fs.Wasm.csproj` are not touched; no `Fma`, `PackedSimd` or X86/Arm/Wasm intrinsics symbol.
* `harness/speedtest-kernels.entry.ts` + `vite.kernels.config.ts`: `src/ui/speedTestKernels.ts` (unmodified) built into one classic script exposing `FsKernels` (`makeStencilKernel`, `makeCopyKernel`, `sweeps`). Round 0's committed `speedtest.worker.js` only offers the app's own `measureAll`, so it cannot hand out a kernel; it was used as a cross-check (section 4). Both come from the same source with the same Vite target.
* `Fs.Bench/wasm/`: `speed-driver.mjs` (the A B B A driver, shared by Node and the Worker), `speed-run.mjs` (Node and Chromium runner; modes `suite`, `startup`, `tsalone`, `app`), `run-all.sh`, `run-extra.sh`, `fsmath-abba.sh` + `fsmath-merge.mjs` (second table, reusing T1.3's `js-math.mjs`, `chromium-ref.mjs`, `wasm-run.mjs`), `simd-scan.sh`, `make-report.mjs`.
* Method. One sample = `per` whole sweeps between two `performance.now()` reads (stencil 40 sweeps, copy 4; 14 ms or more, so Chromium's 0.1 ms timer is under 1 %), reported per sweep. A block = 1 s warm-up on a fresh kernel (the same fixed seed in both languages), then 12 samples, value = their median. A round = TypeScript, .NET, .NET, TypeScript; its ratio = mean of the two .NET blocks / mean of the two TypeScript blocks. 5 rounds, in Node and in Chromium, for AOT; 3 rounds of shorter blocks (1 sweep per sample for .NET) for the interpreter. The .NET call is `Run(per)`: one JavaScript-to-WebAssembly call per sample, data never crosses. The TypeScript arm is `sweeps(k, per)`, the app's own function.

## 3. Tables

### Gate 1W ratio, kernel level (Mono AOT / TypeScript, one thread; < 1 means WebAssembly is faster)

| engine | kernel | .NET path | TS in process ms/sweep | TS alone ms/sweep | .NET AOT ms/sweep | ratio A B B A in process: median (min-max of 5 rounds) | **ratio against TS alone**: median (min-max) | repeat run, in process / vs alone |
|---|---|---|---:|---:|---:|---|---|---|
| node | stencil | scalar | 0.704 | 0.684 | 0.581 (0.577-0.730) | 0.84 (0.78-1.04) | **0.85** (0.84-1.07) | 0.82 / 0.85 |
| node | stencil | vector128 | 0.704 | 0.684 | 0.575 (0.538-0.621) | 0.79 (0.74-0.88) | **0.84** (0.79-0.91) | 0.73 / 0.80 |
| node | stencil | plain | 0.699 | 0.684 | 0.621 (0.573-0.662) | 0.86 (0.82-0.95) | **0.91** (0.84-0.97) | 0.83 / 0.86 |
| node | copy | scalar | 6.347 | 4.090 | 4.798 (4.633-4.963) | 0.76 (0.72-0.82) | **1.17** (1.13-1.21) | 0.76 / 1.10 |
| node | copy | vector128 | 6.051 | 4.090 | 1.320 (1.274-1.371) | 0.21 (0.17-0.22) | **0.32** (0.31-0.34) | 0.22 / 0.33 |
| chromium | stencil | scalar | 0.661 | 0.672 | 0.634 (0.597-0.659) | 0.92 (0.86-1.01) | **0.94** (0.89-0.98) | 0.88 / 0.88 |
| chromium | stencil | vector128 | 0.665 | 0.672 | 0.524 (0.517-0.545) | 0.79 (0.72-0.79) | **0.78** (0.77-0.81) | 0.78 / 0.77 |
| chromium | stencil | plain | 0.733 | 0.672 | 0.586 (0.579-0.636) | 0.84 (0.76-0.89) | **0.87** (0.86-0.95) | 0.89 / 0.87 |
| chromium | copy | scalar | 3.550 | 3.600 | 3.412 (3.288-3.587) | 0.93 (0.87-1.02) | **0.95** (0.91-1.00) | 0.91 / 0.92 |
| chromium | copy | vector128 | 3.725 | 3.600 | 1.300 (1.263-1.550) | 0.36 (0.34-0.42) | **0.36** (0.35-0.43) | 0.36 / 0.35 |

### TypeScript alone: median of 3 fresh processes / workers (min-max), ms per sweep

| engine | stencil | copy |
|---|---:|---:|
| node | 0.684 (0.667-0.786) | 4.090 (3.836-4.571) |
| chromium | 0.672 (0.655-0.688) | 3.600 (3.550-3.900) |

### Interpreter (what AOT buys), scalar path

| engine | kernel | TypeScript ms/sweep | .NET interpreter ms/sweep | ratio median | min | max |
|---|---|---:|---:|---:|---:|---:|
| node | stencil | 0.725 | 14.493 | 21.2 | 19.8 | 21.5 |
| node | copy | 6.336 | 31.128 | 4.8 | 4.6 | 4.9 |
| chromium | stencil | 0.664 | 15.600 | 23.6 | 23.5 | 24.3 |
| chromium | copy | 3.987 | 31.550 | 8.6 | 7.0 | 9.1 |

### End to end (byte[] argument copied in by the marshaller), AOT, ms

| engine | kernel | argument | copy + call only | copy + call + 1 sweep | resident 1 sweep | (TypeScript 1 sweep) |
|---|---|---:|---:|---:|---:|---:|
| node | stencil | 0.81 MB | 0.15 (0.15-0.21) | 0.77 (0.74-0.78) | 0.581 | 0.704 |
| node | copy | 16.78 MB | 5.58 (4.38-7.84) | 10.46 (9.52-13.39) | 4.798 | 6.347 |
| chromium | stencil | 0.81 MB | 0.20 (0.10-0.20) | 0.80 (0.80-0.80) | 0.634 | 0.661 |
| chromium | copy | 16.78 MB | 4.80 (4.40-5.60) | 9.60 (8.70-11.20) | 3.412 | 3.550 |

### Start-up (median of 5 fresh processes / browsers), ms

| engine | build | import + create | first result (Load + 1 sweep) | first result min-max |
|---|---|---:|---:|---:|
| node | aot | 136 | 148 | 141-151 |
| chromium | aot | 304 | 318 | 301-354 |
| node | interp | 113 | 289 | 251-308 |
| chromium | interp | 162 | 368 | 342-394 |

### Download (the `_framework` folder as published)

| build | raw | brotli | gzip | dotnet.native.wasm raw / brotli |
|---|---:|---:|---:|---:|
| aot | 7.72 MB | 1.81 MB | 2.52 MB | 5.95 / 1.36 MB |
| interp | 3.34 MB | 1.03 MB | 1.28 MB | 1.57 / 0.47 MB |

### The app's own measureAll (round 0's committed worker), TypeScript only

| engine | run | stencil Mcells/s | copy GB/s | checksums |
|---|---:|---:|---:|---|
| node | 1 | 48.9 | 3.83 | 0x7d268009 0x1e84aad9 |
| node | 2 | 48.2 | 3.83 | 0x7d268009 0x1e84aad9 |
| node | 3 | 46.4 | 4.13 | 0x7d268009 0x1e84aad9 |
| chromium | 1 | 47.8 | 4.66 | 0x7d268009 0x1e84aad9 |
| chromium | 2 | 47.7 | 4.47 | 0x7d268009 0x1e84aad9 |
| chromium | 3 | 49.3 | 4.68 | 0x7d268009 0x1e84aad9 |

### FsMath (FdLibm) as WebAssembly against V8 `Math`, same engine, ns per call (median of 3 rounds of A B B A), ratio = WebAssembly / V8

| function | node: Math | node: AOT | ratio [min-max] | chromium: Math | chromium: AOT | ratio [min-max] | node: interp | ratio |
|---|---:|---:|---|---:|---:|---|---:|---:|
| exp | 11.3 | 14.5 | 1.27 [0.93-1.33] | 10.7 | 16.0 | 1.50 [1.43-1.57] | 72 | 6.2 |
| log | 9.3 | 11.6 | 1.26 [0.93-1.29] | 8.4 | 13.0 | 1.64 [1.45-1.70] | 65 | 6.6 |
| pow | 61.0 | 68.1 | 1.07 [0.93-1.37] | 16.8 | 67.9 | 4.05 [4.00-4.05] | 238 | 3.8 |
| sin | 29.2 | 37.1 | 1.27 [1.08-1.30] | 23.7 | 35.9 | 1.52 [1.52-1.57] | 154 | 5.2 |
| cos | 29.3 | 36.8 | 1.25 [1.10-1.32] | 24.4 | 38.9 | 1.63 [1.42-1.65] | 157 | 5.5 |
| tan | 18.9 | 26.5 | 1.40 [1.10-1.60] | 32.8 | 25.2 | 0.74 [0.46-0.83] | 138 | 7.2 |
| atan | 13.7 | 20.1 | 1.41 [1.38-1.81] | 22.1 | 20.6 | 0.93 [0.90-1.00] | 69 | 5.1 |
| atan2 | 31.9 | 36.8 | 1.15 [1.01-1.17] | 31.3 | 35.9 | 1.20 [1.12-1.21] | 126 | 3.9 |
| acos | 13.7 | 17.8 | 1.30 [1.29-1.50] | 29.0 | 18.3 | 0.64 [0.62-0.68] | 59 | 4.4 |
| asin | 14.4 | 17.8 | 1.24 [1.23-1.29] | 25.9 | 18.3 | 0.71 [0.65-0.73] | 60 | 4.0 |
| sinh | 20.9 | 26.3 | 1.26 [1.15-1.27] | 16.8 | 24.4 | 1.45 [1.41-1.59] | 170 | 8.1 |
| cbrt | 8.0 | 10.8 | 1.36 [1.28-1.39] | 22.9 | 9.9 | 0.43 [0.42-0.46] | 56 | 6.9 |
| log2 | 10.3 | 12.5 | 1.23 [1.19-1.28] | 10.7 | 13.7 | 1.21 [1.20-1.29] | 73 | 7.0 |
| log10 | 18.4 | 21.5 | 1.17 [1.17-1.37] | 11.4 | 21.4 | 1.87 [1.80-2.07] | 121 | 6.3 |
| hypot | 41.0 | 17.2 | 0.42 [0.42-0.48] | 28.2 | 16.8 | 0.59 [0.58-0.64] | 80 | 2.0 |

CoreMathSharp, AOT (WebAssembly has no FMA instruction, so it runs a software one): 

| function | node: Math | node: AOT | ratio | chromium: AOT | ratio |
|---|---:|---:|---:|---:|---:|
| exp | 11.3 | 26.3 | 2.34 | 25.2 | 2.36 |
| log | 9.3 | 86.6 | 9.31 | 83.2 | 10.36 |
| pow | 61.0 | 265.9 | 4.26 | 256.3 | 15.05 |
| sin | 29.2 | 238.0 | 8.06 | 228.9 | 9.68 |
| cos | 29.3 | 233.6 | 8.11 | 249.5 | 10.06 |
| tan | 18.9 | 228.5 | 12.09 | 231.9 | 7.41 |
| atan | 13.7 | 55.6 | 4.01 | 49.6 | 2.24 |
| atan2 | 31.9 | 76.2 | 2.36 | 71.7 | 2.33 |
| acos | 13.7 | 56.6 | 4.23 | 48.1 | 1.66 |
| asin | 14.4 | 83.8 | 5.86 | 76.3 | 2.94 |
| sinh | 20.9 | 41.7 | 1.96 | 39.7 | 2.36 |
| cbrt | 8.0 | 40.6 | 5.20 | 35.9 | 1.50 |
| log2 | 10.3 | 23.8 | 2.30 | 19.8 | 1.86 |
| log10 | 18.4 | 102.2 | 5.73 | 101.5 | 9.50 |
| hypot | 41.0 | 17.3 | 0.42 | 16.8 | 0.61 |


## 4. What this shows, and what it does not

* **Shows:** on these two kernels, Mono WebAssembly AOT running the frozen scalar C# takes 0.85 to 1.17 times the app's TypeScript time in V8, in Node 22 (V8 12.4) and in Chromium 153 (V8 15.3), single thread; the bar is 1.25. The Chromium cells (0.94, 0.95) hold in a repeat run minutes later (0.88 and 0.91 in process, 0.88 and 0.92 against TS alone), the Node cells too (0.85 and 1.10 against TS alone). The TypeScript arm reproduces the app's own `measureAll` (table above: Node 46 to 49 Mcells/s and 3.8 to 4.1 GB/s; Chromium 48 to 49 Mcells/s and 4.5 to 4.7 GB/s; this card's 33,282-cell sweep in 0.68 ms is 49 Mcells/s: the same).
* **Does not show:** (1) **the gate**: it is defined on the whole simulation step; two kernels (a 7-point stencil with a gather, a 16 MiB copy) are not the step, whose air solve, fire front, embers and transcendental calls (`FsMath`, last tables) are not in them. T1.4a's kernels and T6.4 will say. (2) **A phone**: desktop Chromium and Node on one shared 2.1 GHz Xeon, not a phone's WebView, whose V8 and cores differ (the plan puts the phone WebView in the gate). (3) **One thread** only, no WebAssembly threads. (4) **Headless Chromium** with default flags; the Worker is not cross-origin isolated. (5) Container timings, load average 1.0 to 1.8 (section 8). (6) The .NET code is the path T1.2 froze (integer truncation by a compare instead of `x | 0`, widenings through `Vector128`): a different instruction mix from the TypeScript, same bits. (7) Peak WebAssembly memory is not measured (T1.6b).
* Why the .NET stencil is faster than V8's is a reading of the numbers, not profiled: V8 does a bounds check and a float-to-double conversion on each of the 14 `Float32Array` reads of a cell; WebAssembly pays a bounds check per load as well.

## 5. A finding about the method: the in-process reference is disturbed (Node, K2 copy)

After Mono WebAssembly has run the 16 MiB copy in a Node process, **the TypeScript copy kernel in the same process runs about 45 % slower** (4.0 ms per sweep in a fresh process, 5.9 to 6.3 ms after the .NET runtime has run the copy; merely loading the .NET runtime and leaving it idle changes nothing: 3.7 to 4.4 ms). Calling `gc()` between blocks did not remove it (6.3 to 8.0 ms). The cause was not found (memory placement or page-size effects after the WebAssembly memory grew are suspected; not investigated). It does not appear in Chromium's Worker (3.55 ms in the interleaved run, 3.6 ms alone, 3.6 to 4.0 in the app's own worker) nor on the stencil (0.70 against 0.68 ms). So the card's A B B A in Node flatters the .NET copy: 0.76 in process against **1.17 against TypeScript alone** (a fresh process, 3 runs: 4.57, 3.84, 4.09 ms). The headline uses the TypeScript-alone reference because that is what the app runs. Whether a real app would feel the same disturbance (TypeScript and WebAssembly in one worker) is a question for T1.6b and T6.4.

## 6. Is the Mono AOT output SIMD? (`simd-scan.sh`)

`llvm-objdump -d` (from the Emscripten pack of the wasm-tools workload) on the published `dotnet.native.wasm`: AOT build **40,969 SIMD instructions** (21,844 `v128.store`, 14,829 `v128.load`, `f64x2.add` 24, `f64x2.mul` 17, `f64x2.sub` 17, `f32x4.add` 13, `f32x4.mul` 6, ...); interpreter build 1,069 (416 `v128.load`, 282 `v128.store`, one each of `f64x2.add`, `mul`, `sub`: the runtime's own C code). So AOT emitted WebAssembly SIMD for the managed code, and the visible effect is the copy's `Vector128<float>` path (`v128.load`, `v128.store`: 3 times faster than the scalar loop). The functions have no names in the published module, so SIMD use cannot be attributed to the stencil's `Vector128<double>` path by symbol; there is only one `f64x2.promote_low_f32x4` in each build, so the float-to-double widenings (`WidenLower`) are probably lowered to scalar conversions (not verified). The scalar contract path (the gate rows) is plain WebAssembly numeric code either way.

## 7. Sizes, start-up, build time

* **Download** (the `_framework` folder, 8 files, as published): AOT 7.72 MB raw, **1.81 MB Brotli**, 2.52 MB gzip (`dotnet.native.wasm` 5.95 MB raw, 1.36 MB Brotli); interpreter 3.34 MB raw, 1.03 MB Brotli, 1.28 MB gzip. The proposed budget is 6 MB compressed: met with room, with no solver code yet (`Fs.Kernel` is 217 KB of IL; T1.6b adds the real solver). T1.3 reported 4.45 MB raw for the interpreter build and 7.67 MB for AOT; here 3.34 and 7.72 (the interpreter figure differs; not checked why).
* **Start-up to first result** (fresh process or browser: `import('dotnet.js')`, `create()`, `Load`, one sweep; median of 5): Node AOT 148 ms (141-151); Chromium Worker AOT 318 ms (301-354; the files come from Playwright routes, so this includes V8's compile and the routing, not a network); interpreter 289 ms in Node and 368 ms in Chromium (its first sweep is slow).
* **AOT build**: `dotnet publish -c Release` with `RunAOTCompilation=true`: **82 s** wall (restore included, clean `obj`; the 1-minute load average was 1.78 at the start); the interpreter publish 26 s (clean `obj`).
* **End to end** (a byte[] argument copied in by the marshaller, section 3): the 0.81 MB state of the stencil costs 0.15 to 0.2 ms to copy in, the 16.8 MB of the copy 4.4 to 7.8 ms (as long as the copy kernel itself): moving a kernel-sized array into WebAssembly on every call would double the copy kernel's time and add a quarter to the stencil's. **Data must stay resident** (or be addressed by pointer, not tried).

## 8. Load, and what did not go as planned

* 1-minute load average at the start of the main steps: suite node AOT 1.76 and Chromium AOT 1.56 (both **above 1.5**), repeat suites 1.17 and 1.08, interpreter suites 1.32 and 1.27, TypeScript alone 0.80, 1.64, 1.42, 1.52, 1.31, 1.17 (1.64 and 1.52 above 1.5), FsMath 1.31. After every step 1.0 to 1.6. One thread of mine is about 1.0 of it; the rest is other builders' light work. The first AOT suites ran at the highest load and agree with the repeats (scalar-path ratios within 0.02 to 0.06).
* The first interpreter run failed (`MONO interpreter: NIY encountered in method System.OutOfMemoryException:.ctor`): publishing the interpreter build straight after the AOT build reuses the AOT build's stripped assemblies in `obj/` (IL removed after AOT). **Delete `Fs.Wasm/obj` and `bin` between the two publishes** (stated in `run-all.sh`). T1.3's report does not say it. (The `FAILED` lines in `results/loads.txt` are that first attempt.)
* T1.4a published `Fs.Wasm` at the same time from its own worktree (separate `obj`); the heavy lock made my AOT publish wait about 45 minutes for its benchmark, so my steps ran later than planned but never overlapped another timed run.
* Plan 10.2 says arrays cross `[JSExport]` as `Span<T>` without a copy; T1.3 had shown a `Float64Array` is rejected, so `SpeedTestExports` keeps the data inside WebAssembly (`Load`) and passes a `byte[]` only for the end-to-end row.
* T1.6a step 1 says the build runs "inside a Web Worker": it did in Chromium (a dedicated Worker); Node ran it on its main thread, as T1.3.

## 9. Files

`Fs.Wasm/SpeedTestExports.cs`; `harness/speedtest-kernels.entry.ts`, `harness/vite.kernels.config.ts`; `Fs.Bench/wasm/{speed-driver.mjs, speed-run.mjs, run-all.sh, run-extra.sh, fsmath-abba.sh, fsmath-merge.mjs, make-report.mjs, simd-scan.sh}`; `reports/1w-early.md`, `reports/1w-early.json`. Raw results (not committed): `$FIRESIM_SCRATCH/T1.6a/results/`.
Lines for `FsProto.slnx`: none new (the line for `Fs.Wasm` is T1.3's).
