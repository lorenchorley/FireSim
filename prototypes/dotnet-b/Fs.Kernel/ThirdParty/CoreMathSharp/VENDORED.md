# CoreMathSharp, vendored as source (plan T1.3)

| | |
|---|---|
| What | `AndanteSoft.CoreMathSharp` 1.0.0, a C# port of the [CORE-MATH](https://core-math.gitlabpages.inria.fr/) correctly rounded maths library (`StrictMath` class, binary64 functions) |
| Package | nuget.org `AndanteSoft.CoreMathSharp` 1.0.0, published 2026-02-06; `.nupkg` SHA-256 `ca000ffa1ce2d67d5498e64741aaa7a9732e25f6929be6e4fa6969d97f785cd3` (fetched 2026-11-16 from `https://api.nuget.org/v3-flatcontainer/andantesoft.coremathsharp/1.0.0/andantesoft.coremathsharp.1.0.0.nupkg`) |
| Repository | <https://github.com/andanteyk/CoreMathSharp>, one maintainer (Andante); the package's `.nuspec` names the commit it was built from |
| **Pinned commit** | **`7e70c831e8fb79c9441a9b12bac038cde39fded8`** (2026-02-06 16:08 +0900, "fix graph"; the commit in the package's nuspec. The repository's HEAD, `77505b1` "ver. 1.0.0", is one commit later and not what the package was built from) |
| Licence | MIT, Copyright (c) 2026 Andante (`LICENSE.md`, byte-identical to the file in the package). `THIRD-PARTY.md` (also byte-identical to the package's): CORE-MATH is MIT, Copyright (c) 2023-2025 Alexei Sibidanov; the `FusedMultiplyAdd` fallback is from musl, MIT, Copyright 2005-2020 Rich Felker et al. |
| Vendored | only what FsMath uses: `Binary64/` `Exp Log Pow Sin Cos Tan Atan Atan2 Acos Asin Sinh Cbrt Log2 Log10 Hypot` plus their helpers `FusedMultiplyAdd Helper Polyfill Abs CopySign MinMax Sqrt StrictMath` and `IsExternalInit.cs` (24 source files, 2 licence files; the other 80 of the library's 104 source files, Binary32 and the functions the solver does not use, are not here) |
| Changes | **none**: every vendored file is byte-identical to the pinned commit (`cmp` against a checkout of the commit, 26 of 26) |

## How it was checked against the package

1. The package's `net10.0` `CoreMathSharp.dll` and a build of the pinned commit (SDK 11.0.100, `-p:TargetFrameworks=net10.0`) were compared **method by method on normalised IL** (a small `System.Reflection.Metadata` tool that decodes every method body and replaces each metadata token by the name it stands for; it only reads files, nothing from the download is run): 813 methods in each; **788 identical, 19 differ only in the compiler-generated name of the regex source generator's class (hash of the build), 6 differ** (`ParseFormat`'s two regex getters and four local functions of `LGamma` and `TGamma`). None of the 6 is in a vendored file, so every method of the vendored files is identical to the package's.
2. The downloads (the `.nupkg`, a clone of the repository, the V8 sources used for FdLibm) were kept in their own scratch folders, read as data, and not executed; the only thing built from the repository is the library itself (`dotnet build`, the normal build).
3. Read for what it can do: no `DllImport`, no file, network, process, reflection or environment access in any vendored file (`grep`); the only platform calls are `Math.Floor`, `Math.Truncate`, `Math.Sqrt`, `Math.BigMul`, `Math.Min/Max`, `BitConverter` and CPU intrinsics (`Fma`, `Avx`, `Sse41`, `AdvSimd`, `Bmi2`), all exact operations. `Fs.Tests` (`FsMathSourceTests`) fails the build of the tests if any file here or `FsMath.cs` ever calls a platform transcendental function, `FusedMultiplyAdd`, `TensorPrimitives` or `Vector<T>`.

## Analyzers

`.editorconfig` has one path rule for `Fs.Kernel/ThirdParty/**.cs` that turns RS0030 (banned APIs) and FS0001 (float-to-integer casts) off for this folder: the code uses raw `(long)double` casts on values it has already rounded, and `Math.BitIncrement` in its polyfill. `FsMath.cs` is the only caller.

## Known defects of CoreMathSharp 1.0.0 (found by T1.3, reported in `reports/1-fsmath.md`; the sources here are not patched)

* `Asin` is **not correctly rounded for |x| = 1 - 2^-52 and |x| = 1 - 3*2^-53** (the two doubles just below 1 whose neighbours are 2 and 3 steps away; the result is off by about 2 * 10^7 units in the last place, 1.5707963162581844 for 0.9999999999999998 where the correct value is 1.5707963057214724). Cause (confirmed by a one-line fix in a scratch copy, which gives the correct values): the 128-bit helpers `shl` and `shr` at the top of `Asin.cs` compute `hi << n | lo >> -n` and `lo >> n | hi << -n`, and in C# a shift count of 0 is not the 64 of the C original, so a shift by 0 ORs the other word in. Fix: `n == 0 ? hi : ...` and `n == 0 ? lo : ...`.
* `Pow` returns **NaN** instead of the smallest subnormal 5e-324 for bases within a few units in the last place of 2 and exponents within a few units of -1074 (the result is at the edge of the subnormal range; 3,188 of the 200,000 calls of the stress set, all in that corner). Not investigated further.
* Neither is reachable from the solver's argument ranges (`asin` is called at about -0.4; `pow` results are never subnormal), and CoreMathSharp is not the default implementation.
