# Stage 1, T1.2: the frozen speed-test kernels in C#

Indicative container numbers (4 shared cores, other builders running). Results file: `1-speedtest-kernels.json` (schema `RESULTS-SCHEMA.md`, stage `1-speedtest-kernels`).
Done-when of the card: both frozen checksums reproduced by the C# on `linux-x64` (met, section 2) and bench numbers exist (met, section 4).

## 1. What was ported

`src/ui/speedTestKernels.ts` (SPEED_TEST_VERSION 1) to `Fs.Kernel/SpeedTest/`:

| File | Holds |
|---|---|
| `SpeedTestKernels.cs` | constants (seed 20261030, 45 x 45 x 20, 4 Mi floats in 8 parts, K2 seed `seed ^ 0x5bd1e995`, the two frozen checksums), `Lcg`, `SpeedTest.Fnv`, `SpeedTest.Sweeps`, `ISpeedKernel`, `KernelPath` (`Scalar`, `Vector128`, `ScalarPlain`) |
| `StencilKernel.cs` | K1: `StencilCore.PartScalar` (the contract), `PartScalarPlain`, `PartVector128`, and the `StencilKernel` class |
| `CopyKernel.cs` | K2: `CopyCore.CopyScalar` (the contract), `CopyVector128`, `CopySpan` (memmove, **not** the contract, benchmark reference only), and the `CopyKernel` class |

Rules kept (plan 10.4, enforced by the T0.4 analyzers on `Fs.Kernel`; I checked they are live by adding `(int)d` and `Math.Sin` to a throwaway file: FS0001 and RS0030 fired):

- float32 storage; every float32 read is widened to double before any arithmetic (the TypeScript's numbers are doubles); the only float32 roundings are the stores (`(float)` of a double, round to nearest even, the same as a typed-array store) and K2's `src[0] + 1` (a double addition stored back to float32);
- no fused multiply-add (RyuJIT never contracts `a*b+c`; the vector form uses separate `*` and `+`), no reordering: the 6-term `around` sum, the trilinear weights and the eight corners are added in the TypeScript's order, left to right;
- **no float-to-integer cast and no `FsConv.cs`**: the one truncation in the TypeScript, `x | 0` with `x = i - u[c]`, is replaced by integer arithmetic. `x` is in (i-1, i+1) and positive because the displacements are at most 0.9 cell and i >= 1, so the truncation is `i - 1` when `x < i` and `i` otherwise (also when `i - u` rounds back onto `i`). A test compares this with a literal oracle that truncates by cast, bit for bit, over edge displacements (0, -0, 1e-30, 1e-8, 0.1, 0.5, 0.9, 0.999, both signs);
- no `TensorPrimitives`, no `Vector<T>`, no horizontal sum, no `*Native`: element-wise `Vector128` only, and K1/K2 have no reduction (the checksum is a scalar FNV loop in fixed order);
- the TypeScript's speed test is **one worker thread, no thread pool** (`speedTest.worker.ts`; the main-thread fallback runs the same sweeps in slices), so no `Parallel.For` form was written. The parts of a sweep write disjoint planes, so a threaded form would be possible later; a test shows that running the parts in reverse order gives the same bits.

## 2. Correctness

Both frozen checksums are reproduced by **every C# path** (`Scalar`, `ScalarPlain`, `Vector128`) in every test process, and by the TypeScript in Node (the harness checks them before timing):

| | after | pinned (`src/ui/speedTest.test.ts:26`) | C# scalar | C# vector | TypeScript/Node |
|---|---|---|---|---|---|
| K1 stencil | 3 sweeps | `0x7d268009` | `0x7d268009` | `0x7d268009` | `0x7d268009` |
| K2 copy | 2 sweeps | `0x1e84aad9` | `0x1e84aad9` | `0x1e84aad9` | `0x1e84aad9` |

Tests (`Fs.Tests`, MSTest on Microsoft.Testing.Platform; `dotnet test --project prototypes/dotnet-b/Fs.Tests`; the whole project passes, 96 tests, 21 of them new):

- `SpeedTestKernelTests` (9): sizes/work/parts; the pinned numbers and the constants equal the ones **read from the TypeScript sources** at test time; LCG; FNV on known words; start state and every sweep changes it; the TypeScript test's naive oracle (agreement under 1e-5, values in [0, 1], not flat) on each path; the truncation-by-arithmetic test above; K2's checksum = the checksum of the input with `s[0]` raised twice; parts in reverse order give the same bits.
- `SpeedTestPathChecks` (6), the ones that depend on which SIMD the process has: the process has the support the child was asked for; both frozen checksums on every path; **scalar = plain scalar = vector, bit for bit**, for every row tail (interior rows of 1 to 12 cells, so the two-lane tail is 0 or 1 cell and 1 cell is shorter than a vector), 3 seeds, 3 depths, 5 sweeps, every value compared as bits after each sweep (108 grids), plus the app grid from 4 other seeds; K2: every length 0 to 70 at offsets 0 to 5, random bit patterns including NaN payloads and -0, sentinel words either side that must not change, scalar = vector = memmove; K2 kernels at other sizes and part counts.
- `SpeedTestSeparateProcessTests` (6): each starts `dotnet Fs.Tests.dll --filter ...SpeedTestPathChecks` as a **child process** with one runtime setting and tells it what to expect, so a setting that did nothing fails the child: default hardware (this machine: AVX-512 present, `Vector128`/`Vector256` accelerated), `DOTNET_EnableAVX2=0`, `DOTNET_EnableAVX2=0` + `DOTNET_EnableAVX512F=0`, `DOTNET_EnableHWIntrinsic=0` (`Vector128.IsHardwareAccelerated` must be false: the software fallback), `DOTNET_TieredCompilation=0`, `DOTNET_TieredPGO=0` + `DOTNET_TC_OnStackReplacement=0`. All passed. By hand: `DOTNET_EnableHWIntrinsic=0 FS_SPEEDTEST_EXPECT=software dotnet test --project prototypes/dotnet-b/Fs.Tests -- --filter "FullyQualifiedName~SpeedTestPathChecks"`.

Not run here (it needs another machine): arm64 (`Vector128` maps to NEON; the scalar-equals-vector tests would run there unchanged) and WebAssembly (T1.6a does the WebAssembly checksum). Nothing in these kernels depends on libm, so no cross-platform difference is expected, but that is not measured.

## 3. A finding that matters for every later kernel: float32 to double widening on x64

The literal port, `(double)a[c - 1] + ...`, runs at **24 Mcells/s, less than half of Node's 51**. The JIT's Tier-1 code (`DOTNET_JitDisasm=PartScalar`) shows why: each widening is `vcvtss2sd xmm6, xmm6, dword ptr [mem]`, whose first source is also the destination, so every conversion of a cell waits for the previous one (14 conversions a cell, a serial chain of about 4-cycle operations: roughly 90 cycles a cell, as measured). The same kind of widening written through a one-lane vector, `Vector128.WidenLower(Vector128.CreateScalarUnsafe(a[i])).ToScalar()` (`StencilCore.W`), makes the JIT emit `vmovss` + `vcvtps2pd`, which have no such dependency: **2.36x faster, same bits** (BenchmarkDotNet table below, `ScalarPlainWidening`). The `Scalar` path of K1 uses it; `ScalarPlain` is kept only to show the cost.

This is not specific to a speed test. Plan 10.4 says "float32 arrays read into double locals", which is exactly this pattern, so **the solver port (T1.4 and later) will hit the same cost unless it widens this way** (or the JIT is fixed; observed on .NET 11.0.0, RyuJIT x64, AVX-512 host). arm64 (`fcvt`) and WebAssembly (`f64.promote_f32`) have no such false dependency, so it is an x64 artefact. Also tried and not needed: an `x < i ? i - 1 : i` ternary was already compiled branch-free (`seta`), so the data-dependent sign of the displacement costs no mispredicts.

The two-lane `Vector128` form took one more fix to pay off: deriving the integer truncations from the lane compare *masks* (`Vector128.LessThan(...).AsInt64()` is -1 or 0, so the integer is `i + (int)mask`, a long-to-int cast, not a float cast) and the fractional parts from `ConditionalSelect` on the same masks, instead of extracting each double lane and comparing it again (that variant was slower than scalar: 0.91 ms against 0.61 ms in a quick probe, now 0.45 ms).

## 4. Speed (one thread)

Conditions: container, Intel Xeon @ 2.10 GHz, 4 shared cores (AVX-512 capable; `Vector128` used throughout), Ubuntu 24.04, .NET 11.0.0 (RyuJIT x64, Release). C#: BenchmarkDotNet 0.16.0-preview.2, **default job**, out of process, `[GlobalSetup]` builds the kernels, baseline = C# scalar, zero allocation per sweep (MemoryDiagnoser), under `flock /tmp/firesim-heavy.lock`; `uptime` before 1.38 0.99 0.96 (14:19:37), after 1.16 1.18 1.09 (14:26:32). TypeScript: the **unmodified** `src/ui/speedTestKernels.ts` bundled with the repository's Vite (`Fs.Bench/ts/build.mjs`, the exporter's mechanism), Node 22.22.0 / V8 12.4, one thread, 1.5 s warm-up, 600 (K1) and 300 (K2) timed sweeps; three runs, medians K1 0.651 / 0.655 / 0.655 ms and K2 3.836 / 3.790 / 3.833 ms; uptime before 1.07 1.16 1.08, after 0.91 1.11 1.07. The table uses the third run. **An operation is one whole sweep** (K1: the 18 parts, 33,282 cell updates; K2: 8 chunks, 16 MiB), the input sizes of the app's speed test. "vs TS" = TypeScript median / this median (over 1: faster than TypeScript).

K1, the air stencil:

| Implementation | n | median ms | mean ms | sd ms | p95 ms | min ms | max ms | Mcells/s | vs TS | vs C# scalar |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| TypeScript (Node 22) | 600 | 0.6547 | 0.6791 | 0.1880 | 0.7776 | 0.5550 | 4.0708 | 50.8 | 1.00x | 0.90x |
| C# scalar (contract, baseline) | 60 | 0.5924 | 0.5966 | 0.0265 | 0.6382 | 0.5546 | 0.6618 | 56.2 | 1.11x | 1.00x |
| C# scalar, plain `(double)f[i]` | 44 | 1.3945 | 1.4050 | 0.0511 | 1.5102 | 1.3278 | 1.5317 | 23.9 | 0.47x | 0.42x |
| C# `Vector128` | 71 | 0.4486 | 0.4534 | 0.0222 | 0.4896 | 0.4193 | 0.5009 | 74.2 | 1.46x | 1.32x |

K2, the 16 MiB copy:

| Implementation | n | median ms | mean ms | sd ms | p95 ms | min ms | max ms | GB/s | vs TS | vs C# scalar |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| TypeScript (Node 22) | 300 | 3.8333 | 4.2141 | 1.1678 | 6.7721 | 3.4311 | 12.2985 | 4.38 | 1.00x | 0.44x |
| C# scalar (contract, baseline) | 98 | 1.6998 | 1.7254 | 0.1565 | 2.0293 | 1.4861 | 2.1835 | 9.87 | 2.26x | 1.00x |
| C# `Vector128` | 81 | 1.4091 | 1.4172 | 0.0741 | 1.5656 | 1.3015 | 1.6173 | 11.91 | 2.72x | 1.21x |
| C# `Span.CopyTo` (memmove, not the contract) | 74 | 1.2923 | 1.3168 | 0.0633 | 1.4372 | 1.2298 | 1.4910 | 12.98 | 2.97x | 1.32x |

Reading it (indicative; the machine is shared, and the K2 spread, 9 percent in C# and 30 percent in Node, is memory-system noise from the other builders):

- C# scalar is on par with V8 for K1 (1.11x) once the widening is written as above, and about 2.3x faster than V8 for the copy. The 16 MiB copy is memory-bound; the app's reference run on its build machine measured 53.5 Mcells/s and 4.26 GB/s in Node, the same as the Node numbers here (50.8 and 4.38).
- `Vector128` adds 1.32x on K1 (two doubles a vector, the gather's eight loads per lane stay scalar; this is the only part of the stencil that vectorises: the arithmetic, not the memory access) and 1.21x on K2 (four floats a vector; memmove reaches 1.32x, so the copy is within about 10 percent of what this machine's memory does). Neither is a large gain; K1's is real but modest. Both are bit-identical to the scalar form, so the vector forms are safe to use, but nothing in this card needs them.
- Node's tail is long (p95 and max several times the median, run to run) probably because the machine is shared (not investigated); the median is stable across the three runs (0.651 to 0.655 ms).
- BenchmarkDotNet's `Dry` and `Short` jobs were used while developing (they showed the 2x widening problem and the vector form's mask fix); their numbers are not in the tables.

## 5. How to reproduce

```
source prototypes/dotnet-b/env.sh
dotnet test --project prototypes/dotnet-b/Fs.Tests                                   # includes the six separate-process runs
flock /tmp/firesim-heavy.lock dotnet build prototypes/dotnet-b/Fs.Bench -c Release
flock /tmp/firesim-heavy.lock dotnet prototypes/dotnet-b/Fs.Bench/bin/Release/net11.0/Fs.Bench.dll --filter "*SpeedTest*" --artifacts $SCRATCH/out   # add --job Dry|Short while developing
node prototypes/dotnet-b/Fs.Bench/ts/build.mjs $SCRATCH/tsbench prototypes/dotnet-b/Fs.Bench/ts/speedtest-bench.ts      # needs node_modules reachable from the repository root
flock /tmp/firesim-heavy.lock node $SCRATCH/tsbench/speedtest-bench.mjs $SCRATCH/ts.json 600 300 1500
dotnet prototypes/dotnet-b/Fs.Bench/bin/Release/net11.0/Fs.Bench.dll speedtest-merge \
  $SCRATCH/out/results/Fs.Bench.SpeedTestStencilBench-report-full.json $SCRATCH/out/results/Fs.Bench.SpeedTestCopyBench-report-full.json $SCRATCH/ts.json prototypes/dotnet-b/reports/1-speedtest-kernels.json
```

## 6. Things the orchestrator should know

- **BenchmarkDotNet 0.15.8 (the K1 salvage's pin) cannot run on .NET 11**: with `net11.0` it stops with "GetRuntimeVersion not implemented for NotRecognized" (`DotNetSdkValidator`), with `--job`, `--runtimes net11.0` (not a known moniker) and `CoreRuntime.CreateForNewVersion` alike. `Fs.Bench.csproj` now pins **0.16.0-preview.2** (`packages.lock.json` regenerated, committed); that version detects net11.0 and runs out of process. It is a preview package; the older K1 `PyrogenicBench` class builds against it unchanged but was not re-run. If a preview is unacceptable, the alternative is the in-process toolchain (no process isolation).
- Plan 10.4's "float32 arrays read into double locals" has a measured x64 JIT cost (section 3): T1.4 and the solver port should widen through `Vector128.WidenLower`-style helpers, or accept about 2x.
- Skills used: `dotnet-diag/microbenchmarking` (`SKILL.md` and, of its references, `writing-benchmarks.md` read in part; the other four listed but only skimmed or not read), `dotnet-advanced/vectorization` with the plan's section 9 override, `dotnet-diag/analyzing-dotnet-performance` (allocation scan: the kernels allocate nothing per sweep, no LINQ; BenchmarkDotNet's MemoryDiagnoser shows 0 B).
