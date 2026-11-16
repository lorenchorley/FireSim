# T1.3: `FsMath` candidates

Card T1.3 of `docs/plans/dotnet-option-b-plan.md`, built 2026-11-16. Conditions of every number: one container, Intel Xeon 2.10 GHz, 4 shared cores (one thread used), Linux 6.18 x64, glibc 2.39;
.NET SDK 11.0.100 (CoreCLR 11.0.0 on linux-x64, Mono 11.0.0 on `browser-wasm`); Node 22.22.0 (V8 12.4.254.21-node.33); Chromium 153.0.8010.12 via Playwright (V8 15.3.76.4, headless). Timings are **indicative**
(shared container; the heavy lock keeps other builders' heavy work away, not their light work). Machine-readable results: `1-fsmath.json` (schema `RESULTS-SCHEMA.md`, stage `1-fsmath`).

## 1. Answer

* **`FsMath`** (`Fs.Kernel/FsMath.cs`, one file, exempt from the analyzers by name) has all 15 functions of the card (`Exp Log Pow Sin Cos Tan Atan Atan2 Acos Asin Sinh Cbrt Log2 Log10 Hypot`, plus a three-argument `Hypot`)
  behind `FsMath.Implementation` (`FdLibm` | `CoreMathSharp`). `Cosh`, `Tanh`, `Expm1`, `Log1p` are **not** implemented: no file of `src/{sim,fire,embers,atmosphere,terrain,core,fuel}` calls them (grep; `Expm1` exists inside `FdLibm` only because `Sinh` needs it).
* **Recommended default: `FdLibm`** (it is the default in the code). It gives **Node 22's bits in 100 % of 23.4 million calls**: 20.4 million on the solver's argument ranges (15 functions x 10^6 synthetic, 5.4 million recorded) and 3 million over the whole domain (stress); 0 mismatches, maximum 0 ulp, which is what the TypeScript fixtures were made with.
  `CoreMathSharp` differs from Node 22 in 0.3 to 26 % of the calls of 14 functions (table 4.1) because it is correctly rounded and V8 12.4 is not.
* **Both candidates give identical bits on x64 and in WebAssembly**: 23.4 million calls per implementation compared with the linux-x64 output, in Mono AOT and Mono interpreter builds, under Node 22 and in Chromium 153: **0 mismatches** in all 24 (build x engine x set x implementation) cells (table 6.2). On x64 the output is also the same under `DOTNET_EnableAVX2=0`, `EnableHWIntrinsic=0`, `TieredCompilation=0`, `TieredPGO=0`, `ReadyToRun=0` (section 6.1; this includes CoreMathSharp's software fused multiply-add against the hardware one).
* **Against Chromium (V8 15.3, the browsers' engine floor input), what remains** (table 4.2): `FdLibm` is exactly as far from Chromium as Node 22 is, **0.27 % (`log2`) to 18 % (`atan2`) of the calls of 14 functions, one ulp (two for `sinh`, `log10`)**; `hypot` 0. `CoreMathSharp` equals Chromium bit for bit on 11 of 15 functions
  (`exp log sin cos tan atan2 acos cbrt log2 log10 hypot`), 1 call in 10^6 off for `atan`, 9 for `asin`, **0.08 % for `pow`, 25 % for `sinh`**: V8 15.3's `pow` is not correctly rounded (it equals glibc's `pow` in 100 % of the calls) and its `sinh` is not either.
* **Speed** (section 7, indicative): on x64 `FdLibm` costs 0.5 to 3.6 times the platform's `Math` per call (BenchmarkDotNet: faster on `acos asin atan atan2 cbrt sinh`, 1.05 to 2.1 times on `exp log sin cos tan log2 log10 hypot`, 3.6 times on `pow`: 51 ns against 14 ns); in WebAssembly AOT it takes 0.4 to 1.4 times as long as Node's own `Math` in the same Node (`pow` 1.03; `tan` is an outlier at 3.1, 2.5 times its Chromium value, probably noise). `CoreMathSharp` with hardware FMA is 0.4 to 3.2 times `FdLibm` on x64; **without hardware FMA** (x64 with AVX2 off, and WebAssembly, which has none) it is 1.0 to 17 times slower than with it on x64 (`log` 13x, `log10` 17x, `tan` 6x, `pow` 7.6x) and 1.0 to 8 times slower than `FdLibm` in WebAssembly AOT (`log` 7.7x, `sin`/`cos` 6.7x, `asin` 5x, `log10` 4.6x). The Mono interpreter takes 2.4 to 7 times as long as AOT for `FdLibm` and 4.5 to 13 times for `CoreMathSharp`.
* **Findings that change what the plan assumed** (section 9): two real defects in CoreMathSharp 1.0.0 (`Asin` and `Pow`, not on the solver's range), Chromium's `pow` and `sinh` are not correctly rounded, and `[JSExport]` cannot take a JavaScript typed array as `Span<T>` (T1.6a).

## 2. What was built

| Path | What |
|---|---|
| `Fs.Kernel/FsMath.cs` | `FsMath` (dispatcher, `FsMathImplementation`), `FsMath.FdLibm` (managed port of V8 12.4's `src/base/ieee754.cc`: `exp log log2 log10 pow sin cos tan atan atan2 acos asin sinh cbrt`, plus `expm1`, `rem_pio2`, the kernels), `FsMath.CoreMath` (wiring of the vendored sources + JavaScript's `pow` rules), `FsMath.V8Hypot` (literal port of `MathHypot`, `src/builtins/math.tq`). Only `+ - * /`, `Math.Sqrt`, `Abs`, `Floor`; no `Math.Exp` and friends, no FMA. |
| `Fs.Kernel/ThirdParty/CoreMathSharp/` | CoreMathSharp 1.0.0 vendored unchanged at commit `7e70c831e8fb79c9441a9b12bac038cde39fded8` (only the 24 files FsMath needs), `VENDORED.md` (provenance, checks, defects), `LICENSE.md`, `THIRD-PARTY.md`; `ThirdParty/FdLibm-NOTICE.md` (fdlibm and V8 licences) |
| `.editorconfig` | one path rule: `[Fs.Kernel/ThirdParty/**.cs]` turns RS0030 and FS0001 off (commented) |
| `Fs.Tests/FsMathTests.cs`, `Fs.Tests/golden/fsmath-node22.json` (248 KB), `golden/fsmath-specials-node22.json` (49 KB) | 96 tests (all pass), section 5 |
| `Fs.Wasm/` | `Microsoft.NET.Sdk.WebAssembly`, `OutputType=Library`, `[JSExport]` `FsMathExports.Eval/Load/Run/Info`, generated loops; a solver project |
| `Fs.Bench/` | `FsMathTable`, `FsMathRun` (`fsmath-run`), `FsMathNs` (`fsmath-ns`), `FsMathVectors` (`fsmath-vectors`), `FsMathBench` (BenchmarkDotNet), `FsMathLoops.g.cs`; `fsmath/*.mjs, *.py` (input generators, Node and Chromium runs, comparison, mpmath reference, result collection; headers say how to run each) |

## 3. The inputs: what the solver really passes

`fsmath/record-args.mjs` (a `node --import` preload) wrapped `Math.*` and the `**` operator (counting build of `ts-export/profile`) in three runs, seed 13: `katoomba3-fast` to 1,800 s, `katoomba6-fast` to 900 s, `katoomba3-standard` to 300 s, **9.77 million transcendental calls** (and 7.88 million `x ** 2`). Observed ranges, and the ranges drawn from for the 10^6 "synthetic" calls per function (`fsmath/gen-inputs.mjs`):

| function | calls seen | observed argument range | drawn from |
|---|---:|---|---|
| exp | 3,045,532 | -100 .. 35 (half within 2^-9..2^4 in magnitude) | 80 % U(-8, 4), 20 % U(-100, 36) |
| log | 770,575 | 4.6e-5 .. 1.3e5 | log-uniform 1e-5 .. 2e5 |
| pow | 371,880 (336,079 are `**`) | base 0 .. 1.8e5; exponent -24 .. 25 | base log-uniform 1e-3 .. 2e5; exponent 70 % U(-4, 4), 30 % U(-24, 25) |
| sin | 612,403 | -6.6 .. 508 | half U(-10, 10), half U(-520, 520) |
| cos | 1,449,854 | -8.6 .. 170 | half U(-10, 10), half U(-200, 200) |
| tan | 34,157 | -0.57 .. 1.39 | U(-1.5, 1.5) |
| atan | 2,036,871 (8 % zero) | -0.98 .. 8.65 | 8 % zero, else +-log-uniform 1e-3 .. 20 |
| atan2 | 237,842 | y -989 .. 41, x -39 .. 831 | both +-log-uniform 1e-3 .. 1e3 |
| acos | 155,459 | -0.999997 .. 1 | U(-1, 1) |
| asin | 27,858 | only -0.398 .. -0.396 (one site) | U(-1, 1) (whole domain) |
| sinh | **0** | not called in these runs (one site in the source) | U(-5, 5) (a guess) |
| cbrt | 330,731 | 0.038 .. 1.2e8 | log-uniform 1e-2 .. 1e9 |
| log2, log10 | **0** | not called in these runs (one site each) | log-uniform 1e-5 .. 2e5 (a guess) |
| hypot | 694,448 (22 % have a zero component) | components -9446 .. 8778 | each 20 % zero, else +-log-uniform 1e-3 .. 1e4 |

Three input sets, all deterministic (digests in `1-fsmath.json`, section "digests"):
**synthetic** (the table above, 10^6 calls per function, generator mulberry32), **recorded** (the arguments of the three runs, thinned evenly to at most 10^6 per function: 25,438 to 761,383 calls; none for `sinh log2 log10`), **stress** (200,000 per function over the whole domain: 25 % random 64-bit patterns, 25 % wide range, 25 % within 3 ulp of branch points, 25 % subnormal and tiny).

## 4. Mismatch tables

A mismatch is a call whose result bits differ (two NaNs count as equal: the sign and payload of a NaN are not specified, hashes canonicalise them, plan 10.4). The distance is in units in the last place of the ordered integers. `platform` is `System.Math` on linux-x64 (glibc 2.39), for context; its `hypot` row is `double.Hypot` (CoreLib's own managed algorithm; .NET has no `Math.Hypot`). `chromium` is Chromium 153's `Math` in the same loops as Node's.

### 4.1 Synthetic inputs (the solver's ranges), 10^6 calls per function, reference Node 22

| function | calls | fdlibm | cms | platform | chromium |
|---|---:|---:|---:|---:|---:|
| exp | 1,000,000 | 0 (0 %, max 0 ulp) | 98,759 (9.88 %, max 1 ulp) | 98,725 (9.87 %, max 1 ulp) | 98,759 (9.88 %, max 1 ulp) |
| log | 1,000,000 | 0 (0 %, max 0 ulp) | 7,621 (0.76 %, max 1 ulp) | 7,624 (0.76 %, max 1 ulp) | 7,621 (0.76 %, max 1 ulp) |
| pow | 1,000,000 | 0 (0 %, max 0 ulp) | 97,928 (9.79 %, max 1 ulp) | 97,961 (9.80 %, max 1 ulp) | 97,961 (9.80 %, max 1 ulp) |
| sin | 1,000,000 | 0 (0 %, max 0 ulp) | 33,259 (3.33 %, max 1 ulp) | 32,852 (3.29 %, max 1 ulp) | 33,259 (3.33 %, max 1 ulp) |
| cos | 1,000,000 | 0 (0 %, max 0 ulp) | 33,215 (3.32 %, max 1 ulp) | 32,835 (3.28 %, max 1 ulp) | 33,215 (3.32 %, max 1 ulp) |
| tan | 1,000,000 | 0 (0 %, max 0 ulp) | 38,362 (3.84 %, max 1 ulp) | 38,372 (3.84 %, max 1 ulp) | 38,362 (3.84 %, max 1 ulp) |
| atan | 1,000,000 | 0 (0 %, max 0 ulp) | 26,687 (2.67 %, max 1 ulp) | 26,646 (2.66 %, max 1 ulp) | 26,688 (2.67 %, max 1 ulp) |
| atan2 | 1,000,000 | 0 (0 %, max 0 ulp) | 180,062 (18.01 %, max 1 ulp) | 180,016 (18.00 %, max 1 ulp) | 180,062 (18.01 %, max 1 ulp) |
| acos | 1,000,000 | 0 (0 %, max 0 ulp) | 75,957 (7.60 %, max 1 ulp) | 75,779 (7.58 %, max 1 ulp) | 75,957 (7.60 %, max 1 ulp) |
| asin | 1,000,000 | 0 (0 %, max 0 ulp) | 60,095 (6.01 %, max 1 ulp) | 59,762 (5.98 %, max 1 ulp) | 60,092 (6.01 %, max 1 ulp) |
| sinh | 1,000,000 | 0 (0 %, max 0 ulp) | 261,364 (26.14 %, max 2 ulp) | 1,101 (0.11 %, max 2 ulp) | 88,632 (8.86 %, max 2 ulp) |
| cbrt | 1,000,000 | 0 (0 %, max 0 ulp) | 83,613 (8.36 %, max 1 ulp) | 512,327 (51.23 %, max 3 ulp) | 83,613 (8.36 %, max 1 ulp) |
| log2 | 1,000,000 | 0 (0 %, max 0 ulp) | 2,673 (0.27 %, max 1 ulp) | 2,765 (0.28 %, max 1 ulp) | 2,673 (0.27 %, max 1 ulp) |
| log10 | 1,000,000 | 0 (0 %, max 0 ulp) | 63,845 (6.38 %, max 2 ulp) | 11,265 (1.13 %, max 2 ulp) | 63,845 (6.38 %, max 2 ulp) |
| hypot | 1,000,000 | 0 (0 %, max 0 ulp) | 0 (0 %, max 0 ulp) | 256,046 (25.60 %, max 2 ulp) | 0 (0 %, max 0 ulp) |

`node --jitless` (V8's interpreter only) gives the same bits as the optimising compiler for every function and every set (0 mismatches, 15 functions x 3 sets; `1-fsmath.json`, key `jitless`): the reference does not depend on V8's tier. The measured rates agree with `reports/3-scenarios.md` (V8 12.4 against glibc 2.39, 200,000 inputs, other generator) where the ranges are alike: exp 9.62 % (here 9.87), log 0.87 (0.76), pow 9.85 (9.80), sin 3.30 (3.29), cos 3.33 (3.28), tan 3.86 (3.84), acos 7.65 (7.58), asin 6.02 (5.98), sinh 0.10 (0.11), log2 0.28 (0.28). It differs where the argument ranges differ (cbrt 47.7 against 51.2, atan 1.45 against 2.66, atan2 17.7 against 18.0) and for `hypot` (glibc's `hypot` there, `double.Hypot` here).

### 4.2 Synthetic inputs, reference Chromium 153 (V8 15.3)

| function | calls | node22 | fdlibm | cms | platform |
|---|---:|---:|---:|---:|---:|
| exp | 1,000,000 | 98,759 (9.88 %, max 1 ulp) | 98,759 (9.88 %, max 1 ulp) | 0 (0 %, max 0 ulp) | 786 (0.079 %, max 1 ulp) |
| log | 1,000,000 | 7,621 (0.76 %, max 1 ulp) | 7,621 (0.76 %, max 1 ulp) | 0 (0 %, max 0 ulp) | 105 (0.011 %, max 1 ulp) |
| pow | 1,000,000 | 97,961 (9.80 %, max 1 ulp) | 97,961 (9.80 %, max 1 ulp) | 811 (0.081 %, max 1 ulp) | 0 (0 %, max 0 ulp) |
| sin | 1,000,000 | 33,259 (3.33 %, max 1 ulp) | 33,259 (3.33 %, max 1 ulp) | 0 (0 %, max 0 ulp) | 1,443 (0.14 %, max 1 ulp) |
| cos | 1,000,000 | 33,215 (3.32 %, max 1 ulp) | 33,215 (3.32 %, max 1 ulp) | 0 (0 %, max 0 ulp) | 1,384 (0.14 %, max 1 ulp) |
| tan | 1,000,000 | 38,362 (3.84 %, max 1 ulp) | 38,362 (3.84 %, max 1 ulp) | 0 (0 %, max 0 ulp) | 2,418 (0.24 %, max 1 ulp) |
| atan | 1,000,000 | 26,688 (2.67 %, max 1 ulp) | 26,688 (2.67 %, max 1 ulp) | 1 (0.000 %, max 1 ulp) | 1,180 (0.12 %, max 1 ulp) |
| atan2 | 1,000,000 | 180,062 (18.01 %, max 1 ulp) | 180,062 (18.01 %, max 1 ulp) | 0 (0 %, max 0 ulp) | 496 (0.050 %, max 1 ulp) |
| acos | 1,000,000 | 75,957 (7.60 %, max 1 ulp) | 75,957 (7.60 %, max 1 ulp) | 0 (0 %, max 0 ulp) | 720 (0.072 %, max 1 ulp) |
| asin | 1,000,000 | 60,092 (6.01 %, max 1 ulp) | 60,092 (6.01 %, max 1 ulp) | 9 (0.001 %, max 1 ulp) | 1,646 (0.16 %, max 1 ulp) |
| sinh | 1,000,000 | 88,632 (8.86 %, max 2 ulp) | 88,632 (8.86 %, max 2 ulp) | 248,424 (24.84 %, max 2 ulp) | 88,477 (8.85 %, max 2 ulp) |
| cbrt | 1,000,000 | 83,613 (8.36 %, max 1 ulp) | 83,613 (8.36 %, max 1 ulp) | 0 (0 %, max 0 ulp) | 509,014 (50.90 %, max 3 ulp) |
| log2 | 1,000,000 | 2,673 (0.27 %, max 1 ulp) | 2,673 (0.27 %, max 1 ulp) | 0 (0 %, max 0 ulp) | 378 (0.038 %, max 1 ulp) |
| log10 | 1,000,000 | 63,845 (6.38 %, max 2 ulp) | 63,845 (6.38 %, max 2 ulp) | 0 (0 %, max 0 ulp) | 62,477 (6.25 %, max 2 ulp) |
| hypot | 1,000,000 | 0 (0 %, max 0 ulp) | 0 (0 %, max 0 ulp) | 0 (0 %, max 0 ulp) | 256,046 (25.60 %, max 2 ulp) |

### 4.3 Recorded inputs (what the solver passed), reference Node 22 and Chromium

**recorded inputs: Node 22 (V8 12.4) as the reference**

| function | calls | fdlibm | cms | platform | chromium |
|---|---:|---:|---:|---:|---:|
| exp | 761,383 | 0 (0 %, max 0 ulp) | 59,171 (7.77 %, max 1 ulp) | 59,181 (7.77 %, max 1 ulp) | 59,171 (7.77 %, max 1 ulp) |
| log | 770,575 | 0 (0 %, max 0 ulp) | 25,438 (3.30 %, max 1 ulp) | 25,385 (3.29 %, max 1 ulp) | 25,438 (3.30 %, max 1 ulp) |
| pow | 371,880 | 0 (0 %, max 0 ulp) | 32,608 (8.77 %, max 1 ulp) | 32,535 (8.75 %, max 1 ulp) | 32,535 (8.75 %, max 1 ulp) |
| sin | 612,403 | 0 (0 %, max 0 ulp) | 12,518 (2.04 %, max 1 ulp) | 11,946 (1.95 %, max 1 ulp) | 12,518 (2.04 %, max 1 ulp) |
| cos | 724,927 | 0 (0 %, max 0 ulp) | 12,563 (1.73 %, max 1 ulp) | 12,379 (1.71 %, max 1 ulp) | 12,563 (1.73 %, max 1 ulp) |
| tan | 34,157 | 0 (0 %, max 0 ulp) | 166 (0.49 %, max 1 ulp) | 703 (2.06 %, max 1 ulp) | 166 (0.49 %, max 1 ulp) |
| atan | 678,957 | 0 (0 %, max 0 ulp) | 16,826 (2.48 %, max 1 ulp) | 16,795 (2.47 %, max 1 ulp) | 16,828 (2.48 %, max 1 ulp) |
| atan2 | 237,842 | 0 (0 %, max 0 ulp) | 37,440 (15.74 %, max 1 ulp) | 37,459 (15.75 %, max 1 ulp) | 37,440 (15.74 %, max 1 ulp) |
| acos | 155,459 | 0 (0 %, max 0 ulp) | 6,498 (4.18 %, max 1 ulp) | 6,550 (4.21 %, max 1 ulp) | 6,498 (4.18 %, max 1 ulp) |
| asin | 27,858 | 0 (0 %, max 0 ulp) | 603 (2.16 %, max 1 ulp) | 600 (2.15 %, max 1 ulp) | 603 (2.16 %, max 1 ulp) |
| cbrt | 330,731 | 0 (0 %, max 0 ulp) | 27,487 (8.31 %, max 1 ulp) | 192,528 (58.21 %, max 3 ulp) | 27,487 (8.31 %, max 1 ulp) |
| hypot | 694,448 | 0 (0 %, max 0 ulp) | 0 (0 %, max 0 ulp) | 80,399 (11.58 %, max 2 ulp) | 0 (0 %, max 0 ulp) |

**recorded inputs: Chromium (V8 15.3) as the reference**

| function | calls | node22 | fdlibm | cms | platform |
|---|---:|---:|---:|---:|---:|
| exp | 761,383 | 59,171 (7.77 %, max 1 ulp) | 59,171 (7.77 %, max 1 ulp) | 0 (0 %, max 0 ulp) | 456 (0.060 %, max 1 ulp) |
| log | 770,575 | 25,438 (3.30 %, max 1 ulp) | 25,438 (3.30 %, max 1 ulp) | 0 (0 %, max 0 ulp) | 125 (0.016 %, max 1 ulp) |
| pow | 371,880 | 32,535 (8.75 %, max 1 ulp) | 32,535 (8.75 %, max 1 ulp) | 263 (0.071 %, max 1 ulp) | 0 (0 %, max 0 ulp) |
| sin | 612,403 | 12,518 (2.04 %, max 1 ulp) | 12,518 (2.04 %, max 1 ulp) | 0 (0 %, max 0 ulp) | 742 (0.12 %, max 1 ulp) |
| cos | 724,927 | 12,563 (1.73 %, max 1 ulp) | 12,563 (1.73 %, max 1 ulp) | 0 (0 %, max 0 ulp) | 342 (0.047 %, max 1 ulp) |
| tan | 34,157 | 166 (0.49 %, max 1 ulp) | 166 (0.49 %, max 1 ulp) | 0 (0 %, max 0 ulp) | 579 (1.70 %, max 1 ulp) |
| atan | 678,957 | 16,828 (2.48 %, max 1 ulp) | 16,828 (2.48 %, max 1 ulp) | 2 (0.000 %, max 1 ulp) | 2,243 (0.33 %, max 1 ulp) |
| atan2 | 237,842 | 37,440 (15.74 %, max 1 ulp) | 37,440 (15.74 %, max 1 ulp) | 0 (0 %, max 0 ulp) | 101 (0.042 %, max 1 ulp) |
| acos | 155,459 | 6,498 (4.18 %, max 1 ulp) | 6,498 (4.18 %, max 1 ulp) | 0 (0 %, max 0 ulp) | 300 (0.19 %, max 1 ulp) |
| asin | 27,858 | 603 (2.16 %, max 1 ulp) | 603 (2.16 %, max 1 ulp) | 0 (0 %, max 0 ulp) | 3 (0.011 %, max 1 ulp) |
| cbrt | 330,731 | 27,487 (8.31 %, max 1 ulp) | 27,487 (8.31 %, max 1 ulp) | 0 (0 %, max 0 ulp) | 191,920 (58.03 %, max 3 ulp) |
| hypot | 694,448 | 0 (0 %, max 0 ulp) | 0 (0 %, max 0 ulp) | 0 (0 %, max 0 ulp) | 80,399 (11.58 %, max 2 ulp) |

### 4.4 Stress inputs (whole domain), reference Node 22

| function | calls | fdlibm | cms | platform | chromium |
|---|---:|---:|---:|---:|---:|
| exp | 200,000 | 0 (0 %, max 0 ulp) | 11,178 (5.59 %, max 1 ulp) | 9,499 (4.75 %, max 1 ulp) | 12,062 (6.03 %, max 1 ulp) |
| log | 200,000 | 0 (0 %, max 0 ulp) | 809 (0.40 %, max 1 ulp) | 810 (0.40 %, max 1 ulp) | 809 (0.40 %, max 1 ulp) |
| pow | 200,000 | 0 (0 %, max 0 ulp) | 9,269 (4.63 %, max NaN ulp) | 6,068 (3.03 %, max 1 ulp) | 6,068 (3.03 %, max 1 ulp) |
| sin | 200,000 | 0 (0 %, max 0 ulp) | 2,751 (1.38 %, max 1 ulp) | 2,723 (1.36 %, max 1 ulp) | 2,769 (1.38 %, max 1 ulp) |
| cos | 200,000 | 0 (0 %, max 0 ulp) | 3,920 (1.96 %, max 1 ulp) | 4,511 (2.26 %, max 1 ulp) | 3,920 (1.96 %, max 1 ulp) |
| tan | 200,000 | 0 (0 %, max 0 ulp) | 3,311 (1.66 %, max 1 ulp) | 3,326 (1.66 %, max 1 ulp) | 3,333 (1.67 %, max 1 ulp) |
| atan | 200,000 | 0 (0 %, max 0 ulp) | 3,669 (1.83 %, max 1 ulp) | 3,668 (1.83 %, max 1 ulp) | 3,732 (1.87 %, max 1 ulp) |
| atan2 | 200,000 | 0 (0 %, max 0 ulp) | 6,655 (3.33 %, max 1 ulp) | 6,657 (3.33 %, max 1 ulp) | 7,382 (3.69 %, max 1 ulp) |
| acos | 200,000 | 0 (0 %, max 0 ulp) | 3,757 (1.88 %, max 1 ulp) | 3,745 (1.87 %, max 1 ulp) | 3,757 (1.88 %, max 1 ulp) |
| asin | 200,000 | 0 (0 %, max 0 ulp) | 8,230 (4.12 %, max 47453132 ulp) | 4,119 (2.06 %, max 1 ulp) | 4,129 (2.06 %, max 1 ulp) |
| sinh | 200,000 | 0 (0 %, max 0 ulp) | 9,922 (4.96 %, max 2 ulp) | 4,651 (2.33 %, max 3 ulp) | 5,987 (2.99 %, max 3 ulp) |
| cbrt | 200,000 | 0 (0 %, max 0 ulp) | 10,302 (5.15 %, max 1 ulp) | 105,869 (52.93 %, max 3 ulp) | 10,302 (5.15 %, max 1 ulp) |
| log2 | 200,000 | 0 (0 %, max 0 ulp) | 7 (0.003 %, max 1 ulp) | 7 (0.003 %, max 1 ulp) | 7 (0.003 %, max 1 ulp) |
| log10 | 200,000 | 0 (0 %, max 0 ulp) | 5,017 (2.51 %, max 1 ulp) | 25 (0.013 %, max 2 ulp) | 5,017 (2.51 %, max 1 ulp) |
| hypot | 200,000 | 0 (0 %, max 0 ulp) | 0 (0 %, max 0 ulp) | 9,359 (4.68 %, max 2 ulp) | 0 (0 %, max 0 ulp) |

`FdLibm` has **0 mismatches** with Node 22 over the whole double domain too (NaN, infinities, subnormals, huge arguments of `sin cos tan` up to 1.8e308, the branch points). `CoreMathSharp`'s `pow` row has the NaN: see section 5.3.

## 5. Correctness

### 5.1 Tests (`Fs.Tests`, 96 pass: `dotnet test --project Fs.Tests -- --filter "FullyQualifiedName~FsMath"`)

* **Edge cases of every function, both implementations** (`FsMathEdgeTests`): signed zeros, infinities, NaN, subnormals, huge arguments (`sin(1e22)`), exact cases (`exp(0)`, `log2(2^k)` for every k from -1074 to 1023, `log10(10^k)` for k = 0..22, `pow(x, 2) = x * x`, `pow(x, 0.5) = sqrt(x)` on 20,000 random x, `cbrt(27)`), the atan2 quadrant table, JavaScript's `pow` rules (`pow(1, +-Infinity)`, `pow(+-1, NaN)` are NaN; `pow(x, +-0)` is 1 for every x including NaN; signs of zero and infinity results; negative base with a non-integer exponent is NaN), `hypot`'s rules.
* **Special-value table against Node 22** (`FsMathSpecialsTests`, `golden/fsmath-specials-node22.json`): every function at every combination of 27 special values (729 pairs for `pow`, `atan2`, `hypot`), the bits Node 22 gives. `FdLibm` equals them all (0 ulp); `CoreMathSharp` equals them wherever the result is NaN, infinite or zero, within 2 ulp elsewhere.
* **Golden file** (`golden/fsmath-node22.json`, 227 to 299 calls per function: 200 from the solver ranges, the rest structured: zeros, branch points +-3 ulp, powers of two, multiples of pi/2, subnormals, huge values; only finite inputs with a non-NaN result): Node 22's bits and the **correctly rounded** bits (below). Tolerances and the real maxima: `FdLibm` against Node 22: **0 ulp stated, 0 ulp measured**, every function. `CoreMathSharp` against the correctly rounded value: **0 ulp stated, 0 measured** (`hypot`, which is V8's algorithm in both implementations, is checked against Node 22's bits instead). `FdLibm` against the correctly rounded value: at most 2 ulp stated, measured 1 ulp (`sinh`, `log10`, `hypot`: 2).
* `FsMathSourceTests` reads `FsMath.cs` and every vendored file and fails on any call of `Math.Exp/Log/Pow/Sin/...`, `FusedMultiplyAdd`, `Round`, `TensorPrimitives`, `Vector<T>`, `*Native`: what the analyzers would say about files they are told to ignore.

### 5.2 How "correctly rounded" was checked (three independent ways)

1. **mpmath** (pure Python, 400 bits of precision; the result rounded to nearest-even by exact rational conversion, so subnormals and overflow are right; `fsmath/cr-reference.py`): for the golden file, and for a sample of every input set with `fsmath/cr-check.py` (20,000 calls per function and set; calls with a NaN or infinite argument or a NaN result are left to the edge tests):

synthetic (20000 calls per function at most):

| function | checked | FdLibm not CR (max ulp) | CoreMathSharp not CR (max ulp) | Node 22 not CR (max ulp) |
|---|---:|---:|---:|---:|
| exp | 20000 | 1985 (1) | 0 (0) | 1985 (1) |
| log | 20000 | 143 (1) | 0 (0) | 143 (1) |
| pow | 20000 | 1958 (1) | 0 (0) | 1958 (1) |
| sin | 20000 | 681 (1) | 0 (0) | 681 (1) |
| cos | 20000 | 648 (1) | 0 (0) | 648 (1) |
| tan | 20000 | 757 (1) | 0 (0) | 757 (1) |
| atan | 20000 | 533 (1) | 0 (0) | 533 (1) |
| atan2 | 20000 | 3685 (1) | 0 (0) | 3685 (1) |
| acos | 20000 | 1501 (1) | 0 (0) | 1501 (1) |
| asin | 20000 | 1159 (1) | 0 (0) | 1159 (1) |
| sinh | 20000 | 5204 (2) | 0 (0) | 5204 (2) |
| cbrt | 20000 | 1704 (1) | 0 (0) | 1704 (1) |
| log2 | 20000 | 55 (1) | 0 (0) | 55 (1) |
| log10 | 20000 | 1299 (2) | 0 (0) | 1299 (2) |
| hypot | 20000 | 5020 (2) | 5020 (2) | 5020 (2) |

recorded (20000 calls per function at most):

| function | checked | FdLibm not CR (max ulp) | CoreMathSharp not CR (max ulp) | Node 22 not CR (max ulp) |
|---|---:|---:|---:|---:|
| exp | 19523 | 1477 (1) | 0 (0) | 1477 (1) |
| log | 19759 | 661 (1) | 0 (0) | 661 (1) |
| pow | 19573 | 1709 (1) | 0 (0) | 1709 (1) |
| sin | 19755 | 402 (1) | 0 (0) | 402 (1) |
| cos | 19593 | 333 (1) | 0 (0) | 333 (1) |
| tan | 17079 | 84 (1) | 0 (0) | 84 (1) |
| atan | 19970 | 488 (1) | 0 (0) | 488 (1) |
| atan2 | 19821 | 3023 (1) | 0 (0) | 3023 (1) |
| acos | 19433 | 767 (1) | 0 (0) | 767 (1) |
| asin | 13929 | 298 (1) | 0 (0) | 298 (1) |
| cbrt | 19455 | 1604 (1) | 0 (0) | 1604 (1) |
| hypot | 19842 | 2170 (2) | 2170 (2) | 2170 (2) |

stress (20000 calls per function at most):

| function | checked | FdLibm not CR (max ulp) | CoreMathSharp not CR (max ulp) | Node 22 not CR (max ulp) |
|---|---:|---:|---:|---:|
| exp | 19485 | 743 (1) | 0 (0) | 743 (1) |
| log | 14973 | 159 (1) | 0 (0) | 159 (1) |
| pow | 13679 | 700 (1) | 608 (NaN vs number: 608; NaN) | 700 (1) |
| sin | 19624 | 285 (1) | 0 (0) | 285 (1) |
| cos | 19648 | 514 (1) | 0 (0) | 514 (1) |
| tan | 19457 | 384 (1) | 0 (0) | 384 (1) |
| atan | 19446 | 704 (1) | 0 (0) | 704 (1) |
| atan2 | 13680 | 162 (1) | 0 (0) | 162 (1) |
| acos | 13128 | 3 (1) | 0 (0) | 3 (1) |
| asin | 13102 | 201 (1) | 878 (47453132) | 201 (1) |
| sinh | 19301 | 1009 (1) | 0 (0) | 1009 (1) |
| cbrt | 19267 | 832 (1) | 0 (0) | 832 (1) |
| log2 | 14969 | 2 (1) | 0 (0) | 2 (1) |
| log10 | 15002 | 998 (1) | 0 (0) | 998 (1) |
| hypot | 14210 | 1108 (1) | 1108 (1) | 1108 (1) |

2. **CORE-MATH's own test vectors** from the repository (`CoreMathSharp.Tests/Binary64/*.txt`, made by the original C functions `cr_exp`, ... ; 1,037 to 1,193 lines each): `dotnet run --project Fs.Bench -- fsmath-vectors DIR`: `exp log sin cos tan atan atan2 acos asin sinh cbrt log2 log10`: **0 of 15,000-odd vectors differ**; `pow`: 5 of 1,193 differ, exactly `pow(+-1, +-Infinity)` and `pow(1, NaN)`, where C99 (the vectors) and JavaScript differ.
3. **Chromium 153** (V8 15.3, LLVM libc): equal to CoreMathSharp bit for bit on 10^6 calls of 11 functions (table 4.2).

### 5.3 Two defects in CoreMathSharp 1.0.0 (details in `ThirdParty/CoreMathSharp/VENDORED.md`; reported here, not patched)

* `Asin` is wrong (not correctly rounded, off by about 2 x 10^7 ulp) at |x| = 1 - 2^-52 and 1 - 3 x 2^-53, e.g. `asin(0.9999999999999998)` = 1.5707963162581844, correct 1.5707963057214724. Cause found and fixed in a scratch copy: the 128-bit helpers `shl`/`shr` in `Asin.cs` use `lo >> -n` / `hi << -n`, and in C# a shift by 0 does not give 0 as the C original's `__int128` shift does. 878 of the 13,102 stress calls checked hit the two values.
* `Pow` returns NaN instead of 5e-324 for bases within a few ulp of 2 and exponents within a few ulp of -1074 (the edge of the subnormal range): 608 of 13,679 stress calls checked, all in that corner.
* Neither is reachable from the solver's ranges (`asin` is called at -0.4, `pow` results are never subnormal) and neither is in the synthetic or recorded sets (0 not-correctly-rounded results in the 487,890 calls checked in those two sets for the 14 functions other than `hypot`: 280,000 synthetic, 207,890 recorded). CoreMathSharp is not the default.

## 6. Determinism

### 6.1 linux-x64: JIT and hardware settings

`fsmath-run` over the synthetic and the stress input sets (30 result files each: 15 functions x 2 implementations; SHA-256 per file) under eight settings, each compared with the default process: default; `DOTNET_EnableAVX2=0` (this turns `Fma.IsSupported` off, so CoreMathSharp runs its software fused multiply-add); `DOTNET_EnableHWIntrinsic=0` (no SSE4.1 rounding, no `Vector128`); `DOTNET_TieredCompilation=0`; `DOTNET_TieredPGO=0`; `DOTNET_ReadyToRun=0`; `DOTNET_EnableSSE41=0`; AVX2, AVX and FMA off together. **0 of 420 file comparisons differ** (7 settings x 2 sets x 30 files, each against the default). The JIT does not contract `a * b + c` into a fused multiply-add (it would have changed `FdLibm`'s bits on this machine, which has FMA). **Not run: linux-arm64** (no arm64 machine here; arm64's `AdvSimd` fused multiply-add path of CoreMathSharp and RyuJIT's behaviour on arm64 are covered only by T4.5's runtime test, plan 10.2).

### 6.2 WebAssembly against x64

`Fs.Wasm` published with `RunAOTCompilation=true` (Mono AOT; **publish took 82 s**; `_framework` 7.67 MB uncompressed, 1.78 MB with Brotli, against 4.45 MB and 1.39 MB without AOT) and without (interpreter), loaded with `dotnet.create()` under Node 22 and in Chromium 153 (`fsmath/wasm-run.mjs`, the page served through Playwright routes). The same input files; results as raw float64 bits compared with the x64 output of the same implementation:

| build, engine | set | FdLibm: calls, mismatches | CoreMathSharp: calls, mismatches |
|---|---|---:|---:|
| wasm-aot-node | synthetic | 15,000,000, 0 | 15,000,000, 0 |
| wasm-aot-node | recorded | 5,400,620, 0 | 5,400,620, 0 |
| wasm-aot-node | stress | 3,000,000, 0 | 3,000,000, 0 |
| wasm-aot-chromium | synthetic | 15,000,000, 0 | 15,000,000, 0 |
| wasm-aot-chromium | recorded | 5,400,620, 0 | 5,400,620, 0 |
| wasm-aot-chromium | stress | 3,000,000, 0 | 3,000,000, 0 |
| wasm-interp-node | synthetic | 15,000,000, 0 | 15,000,000, 0 |
| wasm-interp-node | recorded | 5,400,620, 0 | 5,400,620, 0 |
| wasm-interp-node | stress | 3,000,000, 0 | 3,000,000, 0 |
| wasm-interp-chromium | synthetic | 15,000,000, 0 | 15,000,000, 0 |
| wasm-interp-chromium | recorded | 5,400,620, 0 | 5,400,620, 0 |
| wasm-interp-chromium | stress | 3,000,000, 0 | 3,000,000, 0 |

`Fma.IsSupported` is false in WebAssembly (the runtime reports `packedSimd True, fma False`), so CoreMathSharp ran its software fused multiply-add there, and its bits equal the x64 hardware-FMA bits.

## 7. Speed

Method: a loop over 65,536 calls with the call written out (generated by `fsmath/gen-loops.py` for C#, `new Function` for JavaScript), results written to an array; 3 warm-up repeats, 15 timed repeats, ns per call = repeat time / 65,536, **median** (min and max are in the JSON). The x64 rows are from `fsmath-ns` with `DOTNET_TieredCompilation=0` (a first run with tiering varied by 2 times between functions); BenchmarkDotNet 0.15.8 default job (in-process toolchain: it does not know the net11.0 moniker) over 4,096 inputs is in 7.1. The synthetic inputs. Container timings: indicative.

**ns per call (median of 15 repeats of 65,536 calls; the same loop everywhere)**

| function | x64 platform Math | x64 FdLibm | x64 CoreMathSharp | x64 CMS, software FMA | Node 22 Math | Chromium Math | wasm AOT FdLibm (Node / Chromium) | wasm AOT CMS (Node / Chromium) | wasm interp FdLibm (Node) | wasm interp CMS (Node) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| exp | 5.2 | 10.7 | 7.8 | 19.6 | 11.7 | 10.7 | 14.1 / 15.3 | 25.8 / 24.4 | 82.8 | 257.6 |
| log | 5.1 | 6.7 | 6.7 | 88.4 | 9.6 | 7.6 | 11.4 / 12.2 | 87.8 / 82.4 | 62.6 | 739.0 |
| pow | 13.8 | 54.7 | 32.4 | 246.3 | 64.8 | 16.8 | 66.6 / 65.6 | 250.1 / 257.9 | 254.6 | 2602.4 |
| sin | 21.2 | 32.4 | 54.4 | 190.2 | 30.1 | 24.4 | 36.8 / 38.1 | 242.9 / 230.4 | 159.0 | 2207.6 |
| cos | 19.3 | 30.7 | 46.9 | 187.1 | 28.6 | 24.4 | 36.7 / 36.6 | 247.1 / 228.9 | 161.8 | 2368.8 |
| tan | 16.6 | 17.4 | 38.7 | 241.4 | 19.1 | 32.0 | 59.9 / 24.4 | 242.0 / 219.7 | 145.7 | 2734.8 |
| atan | 16.6 | 11.5 | 24.4 | 45.2 | 13.8 | 19.8 | 19.1 / 21.4 | 54.9 / 54.9 | 69.5 | 479.4 |
| atan2 | 34.3 | 28.8 | 20.2 | 65.1 | 32.0 | 30.5 | 36.8 / 36.6 | 76.6 / 79.3 | 129.8 | 708.8 |
| acos | 18.8 | 12.5 | 14.3 | 39.0 | 13.6 | 27.5 | 17.6 / 18.3 | 54.9 / 64.1 | 63.1 | 380.7 |
| asin | 19.1 | 10.4 | 33.5 | 34.8 | 14.6 | 25.9 | 17.8 / 27.5 | 89.4 / 102.2 | 60.8 | 1163.9 |
| sinh | 27.9 | 18.7 | 14.2 | 36.9 | 22.8 | 16.8 | 25.9 / 41.2 | 41.5 / 61.0 | 177.6 | 452.0 |
| cbrt | 12.6 | 9.3 | 20.6 | 33.3 | 7.5 | 22.9 | 10.1 / 16.8 | 41.0 / 48.8 | 68.6 | 298.8 |
| log2 | 4.9 | 8.4 | 8.2 | 21.1 | 18.9 | 10.7 | 12.5 / 15.3 | 23.7 / 19.8 | 71.1 | 141.0 |
| log10 | 9.1 | 16.7 | 7.2 | 119.4 | 18.6 | 10.7 | 22.0 / 21.4 | 100.7 / 103.8 | 122.0 | 1002.9 |
| hypot | 12.4 | 10.3 | 10.1 | 10.5 | 45.3 | 29.0 | 17.1 / 21.4 | 17.6 / 21.4 | 82.5 | 79.9 |

### 7.1 BenchmarkDotNet (default job, `baseline` = platform `Math`)

0.15.8 .NET 11.0.0 (11.0.0, 11.0.26.53018); mean ns per call over the iterations of the default job (in process); ratio to the platform baseline.

| function | platform Math (ns) | FdLibm (ns, ratio) | CoreMathSharp (ns, ratio) | FsMath default (ns, ratio) |
|---|---:|---:|---:|---:|
| exp | 5.1 | 7.2 (1.42x) | 7.9 (1.56x) | 7.4 (1.45x) |
| log | 5.0 | 6.7 (1.33x) | 6.4 (1.28x) | 6.8 (1.35x) |
| pow | 14.3 | 51.1 (3.57x) | 33.4 (2.33x) | 51.8 (3.61x) |
| sin | 10.4 | 21.8 (2.10x) | 38.6 (3.72x) | 21.5 (2.07x) |
| cos | 11.3 | 19.9 (1.76x) | 35.3 (3.13x) | 19.4 (1.72x) |
| tan | 8.5 | 8.9 (1.05x) | 25.3 (2.99x) | 9.1 (1.07x) |
| atan | 5.9 | 4.7 (0.79x) | 20.4 (3.43x) | 4.7 (0.79x) |
| atan2 | 29.3 | 14.4 (0.49x) | 18.0 (0.62x) | 14.6 (0.50x) |
| acos | 12.1 | 6.0 (0.49x) | 12.0 (0.99x) | 5.8 (0.48x) |
| asin | 10.4 | 5.5 (0.53x) | 23.3 (2.24x) | 5.9 (0.57x) |
| sinh | 17.2 | 13.3 (0.77x) | 12.8 (0.74x) | 12.9 (0.75x) |
| cbrt | 12.5 | 6.7 (0.54x) | 12.6 (1.01x) | 6.6 (0.53x) |
| log2 | 5.2 | 8.7 (1.68x) | 8.0 (1.55x) | 8.4 (1.64x) |
| log10 | 9.6 | 10.7 (1.12x) | 7.1 (0.75x) | 11.2 (1.17x) |
| hypot | 4.3 | 4.9 (1.15x) | 5.1 (1.18x) | 5.1 (1.18x) |

### 7.2 Reading the tables

* The two C# measurements differ by up to 2 times for the same function (for example `FdLibm` `exp`: 10.7 ns in the 65,536-call loop, 7.2 ns in BenchmarkDotNet's 4,096-call loop; `sin` 32 against 22 ns): different input counts, different harness, a shared container. Use the numbers to size, not to rank close calls.
* `FsMath (default)` equals the `FdLibm` row: the dispatcher's branch is not measurable (within the noise).
* x64 `CoreMathSharp` is as fast as `FdLibm` or faster for `exp log pow atan2 sinh log2 log10 hypot` and 1.1 to 3.2 times slower for `sin cos tan atan acos asin cbrt` (hardware FMA on). It is the FMA that makes it competitive: the same code with AVX2 turned off takes 1.0 to 17 times longer (the "software FMA" column), and WebAssembly has no FMA instruction, so there it pays that price: `log` 88 ns, `sin` and `cos` 230 to 250 ns, `pow` 250 ns, `log10` 100 ns, against 11, 37, 37, 67, 22 ns for `FdLibm`.
* Weighted by the call mix of `reports/1-profile.md` (about 21,000 transcendental calls a step in both tiers; fast tier: `exp` 8,762, `cos` 6,308, `atan` 1,400 to 1,600, `pow` and `**` about 300 to 400, `hypot` about 550, the other functions together about 1,500) and the WebAssembly AOT medians above, `FdLibm` costs about 0.5 ms and `CoreMathSharp` about 2.2 ms of WebAssembly time per step (a rough sum: the split of the last 1,500 calls is assumed), against a TypeScript fast-tier step of 10.0 ms (standard tier 20.2 ms): **about 5 % of a step with `FdLibm`, about 20 % with `CoreMathSharp`, in WebAssembly**. On x64 with FMA the two cost about the same (0.2 to 0.3 ms). T1.7's projection should take the measured per-function figures, not this estimate.
* Chromium's own `Math` timings are coarse (the timer is rounded to about 0.2 ns per call at these loop sizes and jittered); Node's are the reference column.

## 8. Recommendation

**Default `FdLibm`.** It matches Node 22 on 100 % of the calls tested (the fixtures' engine and the plan's reference, 10.3), it is the cheaper of the two on every function, and its bits are identical on x64 and in WebAssembly. Remaining differences from Chromium (the engine floor input for T3.1c) are those of Node 22 itself, listed in table 4.2: for the solver's most-called functions `exp` (3.0 million calls in the three runs, 3,000 s of simulated time together), `cos`, `atan`, `log`, `hypot` the rates are 9.9 %, 3.3 %, 2.7 %, 0.76 % and 0 % of calls, one ulp each.
**`CoreMathSharp` stays the switch** for the day the reference engine becomes a Chrome with LLVM libc (V8 15.1+): it then agrees with it on 11 of 15 functions; `pow` (0.08 %) and `sinh` (25 %) would still differ, and `pow` is called 120 to 230 times a step. Before it is used for anything, its two defects (5.3) should be reported upstream or patched in the vendored copy (the `Asin` fix is one line each in two helpers).

## 9. Surprises, corrections, questions

* **Plan 10.2 / T1.6a, `[JSExport]` and `Span<T>`:** the plan says `Span<T>`/`ArraySegment<T>` cross as `MemoryView`s without a copy. That is the .NET-to-JavaScript direction. A `[JSExport]` method with `Span<double>` needs `[JSMarshalAs<JSType.MemoryView>]` and then **rejects a JavaScript `Float64Array`**: "Assert failed: Expected MemoryViewType.Double" (JavaScript cannot build a MemoryView). `Fs.Wasm` passes `byte[]` (an exact copy each way). For T1.6a's large arrays the zero-copy route is probably a pointer: `Marshal.AllocHGlobal` in C#, a `Float64Array` view of the WebAssembly heap in JavaScript (not tried).
* **Plan T1.3 step 1, "aiming at the same bits as LLVM libc in V8 15.1+ where both are correctly rounded":** true for 11 functions (including `hypot`); not for `pow` and `sinh` in Chromium 153 (section 1). `hypot` is the same algorithm in V8 12.4 and 15.3 (0 mismatches Chromium against both).
* **Plan section 3** counts `sinh`, `log2`, `log10` once each; none of them was called in three simulation runs (up to 30 minutes of simulated time, three scenarios), so their ranges are guesses and their cost cannot matter for speed.
* **Playwright's Chromium reports V8 15.3.76.4** through the DevTools protocol (`Browser.getVersion.jsVersion`); `chrome://version` is not usable headless.
* **BenchmarkDotNet 0.15.8 cannot run an out-of-process job on net11.0** ("GetRuntimeVersion not implemented for NotRecognized"); the in-process toolchain works.
* **Heavy lock:** a surviving `VBCSCompiler` (Roslyn compiler server) of another builder's Android build held the lock's file descriptor and blocked every waiter for about 10 minutes (the failure mode `TOOLCHAIN.md` warns about; it exited by its own idle time-out).
* **Disk:** the comparison files are large (8 MB per function and result); after the tables were made everything but digests, summaries and the golden files was deleted from the scratch folder.
* **Questions for the owner:** (1) is the reference engine for the C# port Node 22 for the whole port (then `FdLibm` stays) or the browsers' Chrome (then `CoreMathSharp`, with its `pow`/`sinh` caveat)? (2) is a patched vendored copy acceptable (the `Asin` bug), or should the unmodified pinned source stay?

## 10. Reproduce

`FsProto.slnx` is not edited. Lines to add: `<Project Path="Fs.Wasm/Fs.Wasm.csproj" />` (builds in the solution with the wasm-tools workload: `dotnet build` of a temporary copy of `FsProto.slnx` with that line: 0 errors, 0 warnings, 19 s; `dotnet test --solution` of it: 171 tests pass).

```
source prototypes/dotnet-b/env.sh
dotnet test --project prototypes/dotnet-b/Fs.Tests -- --filter "FullyQualifiedName~FsMath"          # 96 tests
node Fs.Bench/fsmath/gen-inputs.mjs  $D/synthetic 1000000     # also gen-recorded.mjs (after record-args.mjs), gen-stress.mjs
node Fs.Bench/fsmath/js-math.mjs ref $D/synthetic $D/synthetic node22      # Node 22; --jitless; chromium-ref.mjs ref ... chromium
dotnet Fs.Bench/bin/Release/net11.0/Fs.Bench.dll fsmath-run $D/synthetic $D/synthetic     # fdlibm, cms, platform
node Fs.Bench/fsmath/compare.mjs $D/synthetic node22 fdlibm,cms,platform,chromium
flock /tmp/firesim-heavy.lock dotnet publish prototypes/dotnet-b/Fs.Wasm -c Release [-p:RunAOTCompilation=false]
node Fs.Bench/fsmath/wasm-run.mjs node|chromium .../publish/wwwroot/_framework ref $D/synthetic $D/synthetic wasm-aot-node
python3 -I Fs.Bench/fsmath/cr-check.py $D/synthetic out.json $MPMATH_DIR 20000          # correctly rounded check
FSMATH_INPUTS=$D/synthetic flock /tmp/firesim-heavy.lock dotnet Fs.Bench/bin/Release/net11.0/Fs.Bench.dll --filter "*FsMathBench*"
```

Digests: every input file's SHA-256 and every result file's SHA-256 (fdlibm, cms, platform, Node 22, Chromium, and each WebAssembly run) are in `1-fsmath.json` under `sets` and `digests`; the golden files are committed. Sources used (read as data, in their own scratch folders): V8 `src/base/ieee754.cc` and `src/builtins/math.tq` at tag `12.4.254.21`; CoreMathSharp 1.0.0 package and repository (SHA-256s in `VENDORED.md`, `FdLibm-NOTICE.md`); mpmath 1.4.1.

Skills read: `dotnet-diag/microbenchmarking` (`SKILL.md` and the `references/` on `OperationsPerInvoke` and avoiding loops: each benchmark is one loop of 4,096 calls with `OperationsPerInvoke`, the documented exception, because a per-call delegate would cost 10 % of a fast function; baseline, `[GlobalSetup]`, results returned, inputs in fields; the default job for the final numbers), `dotnet-test/test-anti-patterns` and `assertion-quality` (applied to `FsMathTests.cs`: failure messages carry the call, input and bits; exact expected values, no swallowed exceptions, one `[DoNotParallelize]` test for the one static switch). `dotnet-blazor/use-js-interop` has no `[JSExport]` guidance (it is about Blazor components), so the `Span<T>` finding in section 9 comes from running it.
