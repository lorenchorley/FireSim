# Phase 0, T0.6b: round 0 ("link check") arms

Date 2026-11-16. Built on the T0.5 shell (`0-apk-check.md`). **Nothing here has run on Android**: there is no emulator or phone in the build container. The owner's phone is the first real test of everything in
section 5 below; this note says what the round records, how to read the result, and what to expect to go wrong.

## 1. What the round is

Plan section 5, round 0: *a Release MAUI APK installs and runs; device facts; WebView version, `crossOriginIsolated`, SharedArrayBuffer, WebAssembly SIMD and threads support; the two frozen speed-test
kernels in TypeScript in the WebView (checksums must match); the channel end to end; the uninstall button.* The app is the T0.5 shell built with `-p:ProtoRound=0` (application id `au.firesim.proto.r0`,
launcher name "FireSim TEST r0", slate-blue icon with the red TEST band). Phone time: about 30 s of arms plus the 10-second countdown, the send and the screens, so the first screen says **about 2 minutes** (the plan's
budget). Its text:

> This is a test build of FireSim. It is a connectivity and device check: it reads this phone's model and WebView, runs a short speed check and sends the numbers to the developer. It does not change your
> FireSim app. It takes about 2 minutes. Keep this screen open.

One block per arm, in this order, so the progress line says which check is running (`Running block 2 of 3. WebView check - webview-facts. Less than a minute left.`):

| Block | Arm | Where | Estimated |
|---|---|---|---|
| `device check` | `device-facts` | C#, native | 2 s |
| `WebView check` | `webview-facts` | page script, V8 in the WebView (`v8-webview`) | 6 s |
| `speed check` | `speedtest-kernels` | page script starting a worker (`v8-webview`) | 15 s (three runs) |

The gate before each block is the T0.5 one (charge above 50 % or charging; thermal status back to *none*), except that round 0 waits at most **20 s** per block for the thermal status instead of 5 minutes (it is a
link check, not a gated speed run); a warm start is visible in `conditions.thermalAtStart` and `logs.gating`. Facts go first, so if the kernels crash the app, the next launch still has the facts' context in the crash note (section 4).

## 2. The arms and what each records (the arm's `result` in `arms[]` of the result document)

Every result starts with a one-line **`digest`** (at most 280 characters): the *Send with GitHub* fallback prints the digest instead of the first characters of the JSON, so the answers that matter reach the issue even
when the owner uses the one-tap fallback (6 KB cap) and the full document does not. Everything below is in the full document (primary send, or *Share*).

### 2.1 `device-facts` (native, `Fs.TestApp.Core/Round0/DeviceFactsArm.cs`, `CpuFacts.cs`, `Platforms/Android/AndroidDeviceProbe.cs`)

Each member is read in its own try/catch; a failure goes to `failures[]` (`item` = `section.member`, `error`) and the rest still run. Nothing personal (no serial, Android ID, IMEI, account, location, language, time zone).
Numbers are JSON numbers, text is as the platform gave it (never localised); NaN is left out.

| Section | Members |
|---|---|
| `hardware` | `manufacturer`, `brand`, `model`, `device`, `product`, `hardware`, `board`, `buildId`, `buildDisplay`, `buildType`, `buildTags`, `supportedAbis[]`, `supported64BitAbis[]`, `supported32BitAbis[]`, `socManufacturer`, `socModel` (API 31+) |
| `os` | `release`, `sdkInt`, `codename`, `incremental`, `securityPatch`, `previewSdkInt`, `targetSdkOfApp` |
| `memory` | `totalMb`, `availableMb`, `lowMemory`, `lowMemoryThresholdMb`, `appMemoryClassMb`, `appLargeMemoryClassMb`, `isLowRamDevice` |
| `screen` | `widthPx`, `heightPx`, `densityDpi`, `density`, `xdpi`, `ydpi`, `widthDp`, `heightDp`, `refreshRateHz`, `supportedModes[]` (`WxH@Hz`), `isHdr` |
| `battery` | sticky broadcast extras: `temperatureC`, `voltageMv`, `health`, `plugged`, `technology`, `present` |
| `power` | `isInteractive`, `isPowerSaveMode`, `isDeviceIdleMode`, `isSustainedPerformanceModeSupported` |
| `runtime` | `dotnet`, `processArchitecture`, `osArchitecture`, `is64BitProcess`, `processorCount`, `javaAvailableProcessors`, `osArch`, `nativeLibraryDir` (last path segment) |
| `cpu` | `logicalCores`; `present`/`possible`/`online`; `cores[]` (`cpu`, `maxKhz`, `minKhz`, `curKhz`, `governor`, `relatedCpus[]`, and from `/proc/cpuinfo` `implementer`, `part`, `armCore` for Arm's own cores, e.g. `Cortex-A55`, `Cortex-X3`); `clusters[]` (cores grouped by maximum frequency, ascending: the first is the little cluster); `cpufreqRead` (false if no core's `cpuinfo_max_freq` could be read); `unreadable[]` (files that refused, grouped by error) |
| `state` | at the time the arm ran: `thermalStatus`, `thermalHeadroom`, `batteryPercent`, `charging`, `chargeCounterUah`, `powerSaver`, `airplaneMode`, `networkReachable` (unreadable values are absent) |
| `failures[]`, `collectedMs` | |

The result document's own `device` and `conditions` objects (T0.5) are filled as before, so `device.model`, `device.soc`, `device.cpuCores` and `device.webViewVersion` are there too.
An unreadable `/sys/devices/system/cpu/*/cpufreq` (newer Android may refuse it to an app) is not an error of the run: `cpu.cpufreqRead` is false and `cpu.unreadable` says what the platform answered; `armCore` from
`/proc/cpuinfo` is then the way to tell the big and little cores apart.

### 2.2 `webview-facts` (page script `wwwroot/round0-arms.js`, merged in C# by `WebHost/Round0Arms.cs` and `WebViewFactsMerge.cs`)

The page part, each part in its own try/catch (`failures[]` at the top level):

| Part | Members |
|---|---|
| `page` | `origin`, `protocol`, `href`, `isSecureContext`, `visibilityState`, `devicePixelRatio`, `screenWidth/Height`, `headerSeenByPage` (the page fetches itself and reads `Document-Isolation-Policy`), `coepSeenByPage` |
| `navigator` | `userAgent`, `chromeVersion`, `isWebViewUserAgent`, `hardwareConcurrency`, `deviceMemoryGb`, `brands[]`, `mobile`, `language` (recorded for the reader; nothing depends on it) |
| `features` | `crossOriginIsolated`, `sharedArrayBuffer` (`typeof`), `sharedArrayBufferConstructs`, `webAssembly`, **`wasmSimd`** and **`wasmThreads`** (a tiny hand-assembled module given to `WebAssembly.validate`; the byte strings are the ones of the wasm-feature-detect library, and `harness/check-round0-js.mjs` checks them against node's engine), `wasmSharedMemoryModule`, `wasmSharedMemoryConstructs` (`new WebAssembly.Memory({shared:true})` gives a `SharedArrayBuffer`), `wasmBulkMemory`, `wasmRelaxedSimd`, `atomics`, `atomicsWaitAsync` (`typeof Atomics.waitAsync`). A feature test that threw is the text `"error: ..."`, not `false` |
| `timer` | `minStepMs` (the smallest step `performance.now()` takes: about 0.1 ms means a coarse timer, 0.005 ms or less means isolated), `distinctSteps`, `calls`, `spanMs` |
| `webgpu` | `present` (`typeof navigator.gpu`); if present, `adapter` (`vendor`, `architecture`, `device`, `description`, `isFallbackAdapter`, `features[]`, a few `limits`) after `requestAdapter()` with a 4 s guard, or `adapterError` / `adapter: null` |
| `workers` | `typeofWorker`, `typeofOffscreenCanvas`, `typeofBlob`, `typeofCreateObjectURL` |

The native part, added in C# (`native`): `pageReady`, `isolationHeaderSent`, `isolationHeaderValue`, `expectedOrigin` (`https://0.0.0.1`), `webViewPackage`, `webViewVersion`, and `allowlist` (`libraryPresent`,
`featureSupported` = whether `WebViewFeature.CROSS_ORIGIN_ISOLATED_ALLOWLIST` was reported supported, `applied` = whether `Profile.setCrossOriginIsolatedAllowlist` ran without an exception, `origin`, `error` = the
exception text if the reflection failed). If the page never answers, the arm still returns the native part with a **`pageError`** (and the Done screen says so).

**`verdict`**: `sharedMemoryObtained` (isolated, `SharedArrayBuffer` a function and constructible), `crossOriginIsolated`, `sharedArrayBuffer`, `wasmSimd`, `wasmThreads` (true, false or absent = unknown), `pageOrigin`,
`originIsExpected`, and **`explanation[]`**, plain sentences in the order to check them: the page never reported ready; the origin is not `https://0.0.0.1`; the app did or did not answer the page with the header and the
WebView did not isolate it; what the page saw of the header; the allowlist (library missing / feature not supported by this WebView / setting it failed with this text / set without an exception yet not isolated,
so the origin string or the header was not honoured). The list is empty when shared memory was obtained.

The result document's `webView` object (T0.5) is filled earlier by the probe and also carries `extra.features` (the same feature tests) and `extra.headerSeenByPage`.

### 2.3 `speedtest-kernels` (worker `wwwroot/speedtest.worker.js`, judged in C# by `KernelChecks.cs`)

The bundle is `src/ui/speedTestKernels.ts` **unchanged** (imported by `harness/speedtest-worker.entry.ts`, built by Vite with the app's `es2022` target, unminified, classic IIFE worker, about 8 KB, committed).
It mirrors the app's own speed test (`src/ui/speedTest.ts`, `speedTest.worker.ts`): a throwaway worker per run, one message, `measureAll(performance.now)`, which warms each kernel for `WARM_MS` = 200 ms and
times it for `TIME_MS` = 800 ms at sweep boundaries (K1, the 45 x 45 x 20 air stencil, then K2, the 16 MiB copy). After the timing the worker makes **fresh** kernels and runs the checksum sweeps of
`src/ui/speedTest.test.ts:26` (K1 after 3 sweeps, K2 after 2), so the checksums cannot disturb the timed phase. The page runs this **3 times** (`args.runs`), starting each worker from
`speedtest.worker.js` (served with the isolation header) and, if that worker will not start, from a `blob:` copy of the same text (`startNotes[]` records why); if neither starts the arm fails with the reasons
and no number is made up. It reports per run: `stencilMcellsPerS`, `copyGBps` (the app's units), `stencilAfter3`, `copyAfter2` (hex words), `measureMs`, `verifyMs`, `wallMs`, `warmMs`, `timeMs`, `started` (`url` or
`blob`), `kernelsSha256` (SHA-256 of the `speedTestKernels.ts` the bundle was built from; a test fails if the committed bundle is stale).

**`verdict`** (made in C#, never by the page): `checksumsMatch` (every run's `stencilAfter3` equals `0x7d268009` **and** `copyAfter2` equals `0x1e84aad9`; compared as text), `stencilChecksumRunsOk`,
`copyChecksumRunsOk`, `why` and the values seen if not, `stencilMcellsPerS` and `copyGBps` as `{median, min, max, n, spreadPercent}`, and `ratioVsReference` = reference / measured median, **as the app's "Run
the speed test" does** (over 1 means slower than the build machine's node 22: reference 53.5 Mcells/s and 4.26 GB/s, 2026-10-30; a unit test fails if these constants drift from `src/ui/speedTest.ts`). So the numbers are
comparable with the app's own result on the same phone: the same kernels, the same warm-up and timing code, one worker per run; the only differences are the host (a WebView inside this app, not the app's Capacitor
WebView), a classic rather than a module worker, and three runs instead of one. They are a **same-phone baseline**, not a gate number.

## 3. How to read a round 0 result

1. `status` `complete` and the three arms `ok` (arms with `blockAttempt` whose block record is `ok`). The Done screen prints the same in words (`RunSummary`): one line per arm, e.g.
   `speedtest-kernels: ok (both checksums match; stencil 18.2 Mcells/s, copy 3.1 GB/s)`, and `N problems recorded` with the first one.
2. **Kernels:** `arms[speedtest-kernels].result.verdict.checksumsMatch` must be `true` (T0.6c's done-when). `stencilMcellsPerS`/`copyGBps` medians and spreads are the phone's WebView baseline; `ratioVsReference`
   is what the app's own speed test would show as its ratio.
3. **WebView facts:** `verdict.sharedMemoryObtained` says whether the allowlist plus the header gave this WebView shared memory; if false, read `verdict.explanation[]` first, then `native.allowlist`. `features.wasmSimd`,
   `features.wasmThreads` and `features.atomicsWaitAsync` are what a later round can rely on. `navigator.chromeVersion` / `native.webViewVersion` is the WebView version.
4. **Device:** `hardware`, `os`, `cpu.clusters` (the big/little split), `memory`, `screen`, `state.thermalStatus` at the start. `failures[]` lists every platform call that did not work on this phone.
5. **Errors and the first-launch story:** `errors[]` (`where` = `webview`, `device facts`, `previous launch`, `gate`, ...), `logs.gating`, `conditions`. A `previous launch` error is the crash note of section 4.
6. **The fallback path:** if the owner used *Send with GitHub*, the issue body has the key, build, device and webview lines and one line per arm (the digests); the same digests are the first member of each arm result.
7. **Uninstall:** see 4.

## 4. Failure handling added for a first run on Android

* Every Android call in the app is in a try/catch that records into the document (T0.5); the new device probe records per member.
* `CrashNote`: an unhandled exception (`AppDomain.UnhandledException`, `TaskScheduler.UnobservedTaskException`) writes a small file in the app's private folder; the next launch shows it on the first screen and records it
  as an error `previous launch` in the next document. (A native crash that kills the process before any managed handler runs leaves nothing; the owner reporting "it closed by itself" is then the evidence.)
* The Done screen lists one line per arm and the first problem (`RunSummary`), so a failure is visible without opening the file.
* If the WebView page never loads, the screen's "Page host:" line keeps saying `loading`, the arms `webview-facts` and `speedtest-kernels` fail (or `webview-facts` returns the native part with `pageError`) after the
  page-ready timeout (20 s) and per-arm timeouts, the device facts are still there, and the document is still saved and sent.
* **The uninstall outcome (item d)** uses T0.5's mechanism, unchanged: pressing *Uninstall* records `uninstall-screen-opened`, `app-info-opened` or `failed` (with detail) in the run's **state file** beside the saved
  document (never in the document, which does not change after it is saved and is normally already sent). If the owner cancels the system screen and opens the app again, the launch **resumes the finished run** (no
  second run) and the Done screen says `You tried to uninstall at HH:mm (outcome). The app is still installed.` The orchestrator learns it from the owner (the app being gone means the uninstall worked; this line means it
  was cancelled or did not run) and from nothing else: the outcome does not reach the endpoint. **A question for the orchestrator:** if the outcome should reach the endpoint, T0.6a would need a second small
  message kind (an "uninstall note" keyed by the idempotency key); not built, because the schema and the contract are T0.5's and T0.6a's.

## 5. What the owner's phone will test for the first time (nothing below has run on Android)

From T0.5 (`0-apk-check.md` section 5), all still untested: sideloading and starting a Release CoreCLR APK (v2/v3 signature, minSdk 24, assemblies in `libassembly-store.so`, trimming of the app assemblies); the
first-screen rendering, countdown and *Not now*; `KeepScreenOn`; the sticky battery broadcast, `PowerManager` thermal status and headroom, `Settings.Global` airplane mode, `Connectivity` events, `OnPause`/`OnResume`;
the APK read for the SHA-256; `HybridWebView` loading `https://0.0.0.1/index.html`; `WebResourceRequested` answering the listed files with headers and a stream body; `InvokeJavaScriptAsync` with global function names
and string arguments; `SendRawMessage` back; progress and cancellation across the bridge; the Java-reflection calls into androidx.webkit 1.18 (`WebViewFeature.isFeatureSupported`, `WebViewCompat.getProfile`,
`Profile.setCrossOriginIsolatedAllowlist`) and whether `https://0.0.0.1` is the origin form the allowlist wants; whether the WebView honours `Document-Isolation-Policy: isolate-and-require-corp`; the HTTPS POST,
the 6 KB GitHub address in the phone's browser, *Share* through the FileProvider; *Uninstall* on target SDK 37 with `REQUEST_DELETE_PACKAGES`; relaunch resume.

New in round 0:

* every Android API of `AndroidDeviceProbe` (`Build.SocModel`, `ActivityManager.MemoryInfo`, `DisplayManager` modes and refresh rate, the battery extras, `PowerManager` flags) and the reads of `/sys/devices/system/cpu/*/cpufreq`
  and `/proc/cpuinfo` (SELinux may refuse them);
* the page script `round0-arms.js` in a real WebView: the WebAssembly SIMD and threads feature tests (checked in node only), `WebAssembly.Memory({shared:true})`, `Atomics.waitAsync`, `navigator.gpu.requestAdapter()`, the
  timer-resolution probe, `fetch` of the page itself, and its **load order** (`round0-arms.js` before `arm-host.js`, which adds to what it registered);
* **a worker started from `speedtest.worker.js`** under the isolation headers (a classic worker whose script URL is served by `WebResourceRequested` with `Document-Isolation-Policy` and
  `Cross-Origin-Resource-Policy: same-origin`), with the `blob:` fallback; whether `new Worker(url)` is allowed from `https://0.0.0.1`; the speed of the kernels in an Android WebView;
* the three-block plan, the progress line for it, the Done-screen summary lines, the crash note, the 20 s thermal wait.

What the container did check (and nothing more): `node harness/check-round0-js.mjs` runs the committed worker bundle in a vm sandbox and reproduces both checksums (`0x7d268009`, `0x1e84aad9`), checks the page
script's output shape and that the WebAssembly byte strings validate in node 22 (SIMD, threads, shared memory, bulk memory and relaxed SIMD true; a corrupt module false); `Fs.Tests` (unit tests of every pure part:
cpufreq and cpuinfo parsing, the device-facts document and its failure and culture handling, the kernel verdict and its constants against `src/ui/speedTest*.ts`, the WebView merge and explanations, the plan,
the summary, the fallback digests) and the container dry run (scenario `k-round0-plan`: the real session and the real device-facts arm over a fake phone, the two WebView arms skipped, a schema-valid document that
the in-process endpoint accepts).

## 6. Build and checks

See the end of this file for the APK that was built (path, size, SHA-256, the output of `check-apk.sh`).

* Reproduce the bundle: `bash prototypes/dotnet-b/harness/build-speedtest.sh` (Vite from the repository's `node_modules`, then the node check). The bundle is **committed**
  (`Fs.TestApp/Resources/Raw/wwwroot/speedtest.worker.js`, about 8 KB) rather than built by an MSBuild step, so the APK build needs no node; `Fs.Tests` fails if it is older than `src/ui/speedTestKernels.ts`.
* Round 0 APK: `dotnet build prototypes/dotnet-b/Fs.TestApp -c Release -p:AndroidPackageFormats=apk -p:EmbedAssembliesIntoApk=true -p:ProtoRound=0`, then
  `bash prototypes/dotnet-b/Fs.TestApp/check-apk.sh <apk> 0` (now also checks that the round 0 page script and the worker bundle are in the APK). **`ProtoGitHubRepo`, `ProtoEndpoint` and `ProtoUploadCode` are empty in
  what is committed and in the APK built for this card**: the orchestrator builds the sendable APK with them (`README.md`); until then *Send with GitHub* says there is no repository and *Share* is the only way out.

## 7. The APK built for this card

Built 2026-11-16 from commit `a9f0b82` plus the one-line `System.Environment` fix of `AndroidDeviceProbe.cs` (committed after it), in the shared build container (Linux x64, 4 shared cores; the build waited about 70 minutes for the
heavy lock, so the 1 min 23 s MSBuild time is the only timing worth quoting, and it is indicative). **0 warnings, 0 errors.**

| | |
|---|---|
| File | `/tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/T0.6b/au.firesim.proto.r0-Signed.apk` (never committed) |
| Size | 18,578,948 bytes |
| SHA-256 | `24457fc6ab8322116a4d464cb6aeac07a22a4782ce5ef8148a00bdeee36435df` (also in `...apk.sha256` beside it; the signature is not deterministic, so a rebuild has another hash) |
| Application id, label, version name | `au.firesim.proto.r0`, `FireSim TEST r0`, `0.1.0-test.r0+a9f0b82` |
| Target / min SDK, ABI | 37 / 24, arm64-v8a, CoreCLR, not debuggable |
| Signer | .NET's default debug key, certificate SHA-256 `94aa0085...4da3` |
| `ProtoEndpoint`, `ProtoUploadCode`, `ProtoGitHubRepo` | all empty in this APK (the orchestrator builds the sendable APK) |

`check-apk.sh <apk> 0`: **ALL CHECKS PASSED** (the T0.5 checks and the three new round 0 ones: `round0-arms.js` and `speedtest.worker.js` are in `assets/wwwroot`, the page script registers both WebView arms, the worker
reports both checksums). The full output is in `check-apk-r0.txt` beside the APK. The assembly store is compressed, so the round 0 types cannot be read from the APK by `strings`; they were checked in the trimmer's output
instead (`obj/.../linked/Fs.TestApp.Core.dll` and `Fs.TestApp.dll` contain `device-facts`, `webview-facts`, `speedtest-kernels` and the round 0 first-screen text), i.e. trimming did not remove the round 0 code.

Container checks run for the final state: `dotnet run --project Fs.TestApp.DryRun`: 11 of 11 scenarios (the T0.5 ten and `k-round0-plan`); `dotnet test --project Fs.Tests`: 307 tests, all passed (0 failed, 0 skipped);
`node harness/check-round0-js.mjs`: all checks passed (both frozen checksums reproduced by the committed bundle in node 22; 49 Mcells/s and 4.0 GB/s in node on this shared container, indicative only).
