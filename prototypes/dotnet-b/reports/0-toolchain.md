# Phase 0, T0.4: toolchain, analyzers and the test project

Date 2026-11-16. Machine: the build container, Linux x64, 4 shared cores, 16 GB, no `/dev/kvm`; other builders ran at the same time, so every time is
**indicative**, one run each. SDK 11.0.100 (Roslyn 5.12), workload set 11.0.100.1. What is installed, with hashes and licences: `../TOOLCHAIN.md`.

## Method

A clone of the T0.4 commit (`git clone` of the worktree, commit `71cf3a0` plus the later commits that only touch docs) into a new directory, `source env.sh`,
each step as a separate command, restore in locked mode (`-p:RestoreLockedMode=true`) so every package is the one in the committed `packages.lock.json`.
The NuGet cache (`NUGET_PACKAGES`) and the SDK/workloads are shared with the other sessions, so these are "clean source tree, warm package cache" builds, not
cold-cache builds. Times exclude the wait for `/tmp/firesim-heavy.lock` (the wasm workload install waited about 13 minutes for it). Script: kept in the
scratchpad (`T0.4/clean-build.sh`); the commands are the ones in `../TOOLCHAIN.md` section 1.

## Timings (wall clock of the dotnet command, one run)

| Step | Command (abridged) | Time | Result |
|---|---|---|---|
| Install `wasm-tools` + `wasm-experimental` | `dotnet workload install wasm-tools wasm-experimental --version 11.0.100.1` | 50.7 s (real; 29 packs, 3.9 GB) | success |
| Hello 1: console | `dotnet build hello/console -c Release` | 3.0 s | built; prints `hello from .NET 11.0.0 on linux-x64 (X64)` |
| Hello 2: WebAssembly, Mono AOT | `dotnet publish hello/wasm -c Release -p:RunAOTCompilation=true` | 70.1 s | published `_framework/` (`dotnet.native.wasm` 5.7 MB, `System.Private.CoreLib.wasm` 1.1 MB, LLVM `.bc` for `HelloWasm`, `System.Private.CoreLib`, `System.Runtime.InteropServices.JavaScript` and `aot-instances`); under Node 22.22.0 `Hello("node")` returns `hello, node, from .NET 11.0.0 on browser-wasm` and `SumOfSquares(1000)` returns `333833500` |
| Hello 3: MAUI Android, Release | `dotnet build hello/maui-android -c Release -p:AndroidPackageFormats=apk -p:EmbedAssembliesIntoApk=true` | 118.1 s (MSBuild: 1 min 57.8 s) | 0 warnings, 0 errors; `au.firesim.hello-Signed.apk` 19,046,135 bytes, SHA-256 `0a28d7015eacdee1828c6c4f6c12c7f333594a5b802881c9d44a5f7cd4d19bb0` (the unsigned `au.firesim.hello.apk`, 18,945,211 bytes, is also produced) |
| Same with `-p:UseMonoRuntime=true` | | 0.7 s | **fails with NETSDK1242** (text in `../TOOLCHAIN.md` 3.1) |
| `dotnet test --solution FsProto.slnx` (restore, build of 6 projects, run) | | 13.9 s | 75 passed, 0 failed |
| `bash Fs.Analyzers/tools/demo-bad-solver.sh` | | 13.2 s | bad file fails with `RS0030` and `FS0001`; exempt files and non-solver project build |

Disk: 11 GB free before and after the builds (16 GB before the workload install, other builders also writing).

## The APK, checked

`aapt2 dump badging`: package `au.firesim.hello`, versionCode 1, versionName 1.0, compileSdk 37, targetSdk 37, `native-code: 'arm64-v8a'`, launchable activity
`crc64ec6bb0d0f3cda3b3.MainActivity`, permissions `INTERNET`, `ACCESS_NETWORK_STATE` (the template's) plus ones the MAUI libraries add (`USE_BIOMETRIC`, `USE_FINGERPRINT`,
`au.firesim.hello.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`). Native libraries include `libcoreclr.so` and `libclrjit.so`: **CoreCLR**, as the plan says.
`apksigner verify --print-certs`: verifies (v2 and v3 schemes; not v1, not v4), one signer, `CN=Android Debug, O=Android, C=US`, RSA 3072,
certificate SHA-256 `94aa0085fe7f7e899a2deb68684435d3f0bf654dfdc9d863d223c787239e4da3`. No password was printed or passed.

**This is not the key of the installed FireSim** (plan section 3, `f7570f27…a862e7`, `/root/.android/debug.keystore`): the .NET Android tooling created its own debug keystore under
`/root/.local/share/Xamarin/Mono for Android/` during this build. See `../TOOLCHAIN.md` 3.2; T0.3 and T0.5 must pick the key on purpose.

## The rules, tested

`Fs.Tests` (MSTest 4.5.3 on Microsoft.Testing.Platform, 75 cases): 35 for the FS0001 analyzer, 39 for the banned-symbols file (completeness against Roslyn's documentation IDs of the
running runtime, allowed functions still allowed, the real BannedApiAnalyzers over 22 banned and 13 allowed snippets), 1 smoke test. They ran green on the first full run after the
analyzer-loading helper was fixed (the first run failed 35 of 75 because the test host could not find `Microsoft.CodeAnalysis.BannedApiAnalyzers.dll` next to the C# analyzer DLL).
Not a pass that was not run: the per-file exemptions (`FsMath.cs`, `FsConv.cs`, `Pyrogenic/`) are not unit-tested in process; they are shown by the build demonstration only.

Things that failed on the way and what they taught: a bare `M:System.Math.Exp` in `BannedSymbols.txt` bans nothing (full signatures needed, hence the generator);
`[**/Name.cs]` sections in `.editorconfig` did not match, `[Name.cs]` and `[Dir/Sub/**.cs]` do; `global` analyzer-config sections must be absolute paths, so `.editorconfig` was used instead.
