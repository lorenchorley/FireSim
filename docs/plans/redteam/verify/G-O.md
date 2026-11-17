# Batch G, verifier O (gates 1 and 2, measurement method)

Worktree: `/home/user/FireSim/.claude/worktrees/agent-a2524c927a83aa7d8` at `05795ff`. All file:line references are relative to it unless the path is absolute. Plan = `docs/plans/dotnet-option-b-prototype.md`.

---

G-1. Own answer (before reading the claim): Gate 1 compares the C# kernel on all cores (Parallel.For, up to 4 threads) with the existing TypeScript kernel in a Node harness, which is single-threaded. On the desktop, a pass could come from threads alone, and D34 explicitly allows threads within the TypeScript project. On the phone, D34 leaves the engine unchanged (one worker), so the comparison is different there.
Verdict: PARTLY     Severity: MAJOR     Change follows: partly
Evidence checked:
- Plan:34 gate: "All-core C# is under 1.5× the TypeScript on desktop, or under 2.0× on the phone". Plan:40: "benchmark each against the TypeScript in Node". Plan:105: "The TypeScript side stays a Node harness".
- `prototypes/dotnet-b/reports/RESULTS-SCHEMA.md:13-15`: example run `"spread-step ts", "impl": "ts", "threads": 1` and gate `"all-core C# >= 1.5x TypeScript on desktop"`. So the TypeScript side is 1 thread and the C# side is all cores.
- `docs/plans/air-slice-wind-detail-honest-speed.md:121` (D34): "Speed beyond one core comes from threads, and from WebAssembly or WebGPU for one hot loop only if the measurement says so, within the TypeScript project" and "the phone's own offline engine is unchanged".
- Same file:1018 (15e): "Amdahl upper bounds on 4 cores: the air alone 1.9x (Standard) and 2.6x (High); the fire alone 1.8 to 2.0x".
- Chromium blink-dev "Intent to Ship: Restriction on SharedArrayBuffers" (2020, via search): SharedArrayBuffer "never worked on WebView". Multi-worker TypeScript on the phone is therefore not free.
Notes: The desktop half is right. C# at V8 parity per core, scaled over 4 threads on a parallel kernel, clears 1.5×, and D34 already allows the TypeScript project to get that same gain with worker_threads. Two parts are overstated:
- The "1.8 to 2.6×" figures are whole-step Amdahl bounds, not kernel bounds. On a single kernel, TypeScript workers could reach more than that, so the point is stronger than stated, not weaker.
- On the phone, D34's status quo is one thread, and shared-memory workers in the Android WebView are not established. The thread gain there is closer to a B-specific gain.
The plan already records C# at 1 to 4 threads (plan:34 "1 to 4 threads"), so the 1-thread versus 1-thread ratio and the scaling curve come out of stage 1 anyway. What has to change is which ratio the gate uses. For the desktop, the change follows. For the phone, comparing against "TypeScript with worker_threads on the same partition" needs a WebView route that works (SharedArrayBuffer or transfer); without one, gate the phone on the 1-thread ratio plus the C# scaling.

G-2. Own answer: 15e and D39 judged threads, WebAssembly and WebGPU "not worth starting for speed", with 2 to 2.6× on 4 cores at best (whole step). Gate 1's bars (1.5× desktop, 2.0× phone) are at or below that range, and they apply to one kernel's ratio, not to the whole step. A kernel ratio is diluted by everything the kernel does not cover.
Verdict: CONFIRMED     Severity: MAJOR     Change follows: yes
Evidence checked:
- Plan:34 (stage 1 output "The hottest kernel in C#"; gate on "All-core C#" versus "the TypeScript").
- `air-slice-wind-detail-honest-speed.md:1018`: "Threads, WebAssembly and WebGPU are not worth starting for speed on this evidence (they would help the 3-D air by at most about 2 to 2.6x on 4 cores)". Line 126 (D39): "it says about 2 to 2.6 times on four cores at best".
- `studies/desktop-simulation/README.md:153` gives the fast-tier fireStep at 37.7 %. Lines 176-184 are the Amdahl table (for example "fast, 30 m | the fire ... | 58 % | 1.78x").
- My arithmetic: a 1.5× gain on a 58 % share gives 1/(0.42 + 0.58/1.5) = 1.24× on the whole step; on the 37.7 % level-set alone it gives 1.14×.
Notes: The claim is correct. One nuance: the 15e bounds are for threads only, while a C# kernel ratio also contains any per-core gain. Even so, a kernel bar at or below the thread-only whole-step bound is a weak bar. Plan:90 then reads a pass as a "speed argument for B", which overstates what the measurement shows.

G-3. Own answer: The simulation uses its own seeded mulberry32 generator, not Math.random. Its integer core (32-bit add, Math.imul, shifts) can be reproduced bit for bit in C# with `uint` and `unchecked` arithmetic. Only the derived normal and log-normal draws pass through Math.log, cos and exp, where last-bit differences are possible.
Verdict: REFUTED     Severity: NONE     Change follows: yes (no change is needed, but because the generator is portable, not because it is not)
Evidence checked:
- `src/core/rng.ts:1-16`: "Small, fast, seedable PRNG (mulberry32) ... `t = Math.imul(t ^ (t >>> 15), t | 1)` ...".
- `src/embers/sampling.ts:16-26`: FastRng is the same mulberry32.
- `src/sim/simulation.ts:434-437`: streams `new Rng(so.seed)`, `seed + 1`, `seed + 2`, `seed + 3`.
- `grep -rn "Math.random" src --include=*.ts | grep -v test`: the only hits are UI ids and a dataset stamp (`src/ui/screens/datasets.ts:153`, `timePopover.ts:41`, `speedControl.ts:59`). None is in sim, fire or embers.
Notes: The claim is false. The plan's section 10 decision to port the generator and its draw order exactly (plan:134) is feasible for the generator itself. The hard part is the draw order (see G-6).

G-4. Own answer: Defaults are performance "auto", Katoomba, 6 km, "Normal" 30 m. "Auto" builds the Standard (3-D) tier and drops to the fast tier only if the timed spin-up predicts the run is hopeless; the cut-off is about 198 ms per air step, 4.8 times the one phone measured. In Standard, the air takes about 61.5 % (3-D step alone) to about 70 % (with stamps and surface wind; 69 % by CPU profile), and the fire about 18 to 20 %. In the fast tier, the fire is 58 %, embers 13 %, coupling 11 % and air 5 %. Stage 1 profiles only the fast tier.
Verdict: CONFIRMED     Severity: MAJOR     Change follows: yes
Evidence checked:
- `src/ui/settings.ts:66` `performance: 'auto'`. Lines 195-203: the default case returns `tier: 'auto'`.
- `src/ui/setupModel.ts:93-98`: `extentKm: 6, detail: 'normal'`.
- `src/sim/simulation.ts:430`: `const buildTier ... = this.tierReq === 'auto' ? 'standard' : this.tierReq`.
- `src/sim/params.ts:36-49`: "the detailed 3-D air unless it is hopeless ... about 198 ms per air step for a 6 h run, 4.8 times the one phone measured so far".
- Summing `studies/desktop-simulation/README.md:148-163` with a short python script: Standard fire laps (prepare, step, masks, minute) = 19.5 %; fast-tier fire = 58 %. Line 169: Standard air-solver files "are 69 % of the CPU time".
- Plan:40: "on the Katoomba 6 km fast-tier scenario". Plan:46: "defer the atmosphere port".
Notes: The fire share in Standard is about 18 to 20 % by laps (fireStep alone is 11.7 %), slightly above the claim's 12 to 17 %. That does not change the conclusion. If the fast-tier hottest kernel (the level-set) is ported, even an infinite speed-up of fireStep gives at most about 1.13× on a default Standard phone run.

G-5. Own answer: The plan gives no TypeScript-on-phone number for the 2.0× phone bar to divide by. The TypeScript side is a Node harness, and the only phone app planned is a C# benchmark app. The app does ship a phone-run benchmark: the speed test, with two frozen kernels (K1 is a 45×45×20 Float32 air stencil, the Standard tier's air) and checksums pinned by a unit test.
Verdict: CONFIRMED     Severity: BLOCKER (for the phone half of Gate 1; cheap to fix)     Change follows: yes
Evidence checked:
- Plan:34 (phone bar), plan:62 (K1: "a minimal Android benchmark app for the phone"), plan:105 ("The TypeScript side stays a Node harness"), plan:76 (the owner pastes results).
- `src/ui/speedTestKernels.ts:1-12`: "The two FROZEN kernels of the speed test ... K1 'air stencil': a 45 x 45 x 20 Float32 grid (the standard tier's air ...) ... from a fixed LCG seed".
- `src/ui/speedTest.ts:1-6`: "off the main thread ... so phones can be compared". Its result shows on the debug statistics screen.
- `src/ui/speedTest.test.ts:38-47`: "K1, the air stencil, gives the pinned checksum after 3 sweeps".
Notes: As written, the phone ratio cannot be computed. A ported speed-test K1 is a good same-device baseline, and it is also the Standard tier's air, which addresses G-4. Small error in the source: the header of `speedTestKernels.ts:10` names `speedTest.kernels.test.ts`, but the pins are in `speedTest.test.ts`. A whole-step TypeScript pace on the phone is also available from the app itself (15e cites "one phone's measured 41 ms a step"), but that is not a kernel number.

G-6. Own answer: Stage 1 asks only for identical inputs. It does not require the kernel's outputs or random state to match the TypeScript, and its gate does not test thread-count identity. General rule 4 (identical on 1, 2, 4 and 8 threads) arguably binds every C# kernel, but only stage 3 tests it.
- The spread step draws breach outcomes from the fire stream inside the level-set band loop (through the `ensureSpeed` hook).
- `computeCell` takes the maximum of neighbours' `pE` values written earlier in the same pass.
- The ember transport loops over particles serially, with one mulberry32 state carried across particles, a data-dependent number of draws per sub-step, and swap-removal.
So reproducing the exact draw order keeps at least the ember transport serial, and the spread step's prep order-dependent.
Verdict: PARTLY     Severity: MAJOR     Change follows: partly
Evidence checked:
- `src/fire/spread/FireSpreadModel.ts:33-34` ("fixed iteration orders (sorted band, list order), all randomness from the fire RNG stream (VLS periods, breach draws, debris)"), line 479 (`ensureSpeed: (k) => this.prepareCell(...)`), lines 1352-1353 (`if (first) e0 = this.maxNbr(k, this.pE)`), line 1379 (`breachDraw` in `prepareCell`), line 1416 (`this.pE[k] = s.e`), line 1504 (`const breached = this.rng.next() < p`).
- `src/fire/spread/levelSet.ts:269-275`: `hooks.ensureSpeed(k)` inside the band loop.
- `src/embers/EmberModel.ts:671-675`: `while (i < this.count) { if (this.advance(i, ...)) this.removeAt(i, ...) ...}`. Lines 1458 and 1602-1654: `let rs = rr.s`, with draws under `if (su > 0)`, `if (sw > 0)` and the reflame condition, inside `while (rem > 1e-9)`.
- Plan:12 (rule 4), plan:40 (stage 1 asks only for identical inputs), plan:134 (exact draw order decided for stage 3).
Notes: The direction is right, but the numbers are mislabelled.
- Embers are 12.8 % of fast-tier time, not 25.6 % (`studies/desktop-simulation/README.md:156`). The 25.6 to 25.9 % is everything outside air, fire and coupling (embers 12.8, explain 5.0, snapshot 4.5, solar 1.8, and so on).
- "About 2.2×" is 15e's row "air, fire and the coupling ... 74 % ... 2.25x". That row assumes the fire runs in parallel, which the claim's own argument says the faithful port cannot do as is. If the spread prep must also stay in order, the cap is lower: about 1.3× with fire and embers serial (my arithmetic).
- Inference: mulberry32 is a Weyl counter, so jump-ahead is O(1). Parallel exact reproduction would still need each work item's draw count in advance, which is data-dependent here.
On the proposed change: "outputs equal the TypeScript's" bit for bit is stricter than the plan's own stage 3 bars (plan:126-132). In-order draws inside the timing, thread-count identity at stage 1, a serial inventory and a whole-step gate all follow from the evidence.

G-7. Own answer: For the phone, the plan specifies only the phone model and Android version (plan:77, schema:19), conditions on every number (rule 3: machine, cores, run count, median, spread) and a 60 s sustained transport run (plan:42). BenchmarkDotNet's warm-up is named for the C# timings (plan:105) but not for the phone app. Nothing covers thermal state, warm-up on the phone, run order, a sustained kernel run, core types or big/little scheduling.
Verdict: CONFIRMED     Severity: MAJOR     Change follows: yes (the specific durations are design choices, not derived)
Evidence checked:
- grep of the plan for thermal, warm, little and Release: no hits. "Fixed partition" appears only at plan:40. Plan:11 (rule 3), plan:42, plan:76-77.
- https://developer.android.com/games/optimize/adpf/thermal (read 2026-11-12): "Devices can only maintain a high level of performance for a limited amount of time before being thermally throttled ... You shouldn't call it [getThermalHeadroom] more than once every 10 seconds" (API 30+).
Notes: "Waits for the slowest core" holds if "fixed partition" means one chunk per thread, which is the natural reading next to rule 4 but not the only one. The determinism point is correct: fixed chunk boundaries and a fixed reduction order give identical results whichever thread runs a chunk. The proposal's 10 s headroom polling matches Android's documented minimum interval.

G-8. Own answer: API 24 (Android 7.0). It was raised from 21 in .NET 11 Preview 3.
Verdict: CONFIRMED     Severity: NONE     Change follows: yes
Evidence checked:
- https://learn.microsoft.com/dotnet/maui/whats-new/dotnet-11 (ms.date 2026-09-10): "the minimum supported Android API level has been raised from 21 (Lollipop) to 24 (Nougat). This means that .NET MAUI apps in .NET 11 require Android 7.0 or higher."
- Local workload pack `/tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/dotnet-sdk/packs/Microsoft.Android.Sdk.Linux/37.2.31/targets/Microsoft.Android.Sdk.SupportedPlatforms.targets:13`: `<AndroidMinimumSupportedApiLevel ...>24<` (the older 36.1.118 pack says 21).
Notes: The plan already states this (plan:53, "Android 7.0 (API 24) floor").

G-9. Own answer: Plan section 5 asks for "debug builds, sideload". In .NET 11, an Android Debug build is CoreCLR with JIT and no ReadyToRun. Debug also compiles with `Optimize=false`, which marks the assembly so the JIT disables optimisation. Microsoft says "Always profile Release builds". Also, a Debug build defaults to Fast Deployment, so the assemblies are not embedded in the APK and a sideloaded Debug APK will not start unless `EmbedAssembliesIntoApk=true`.
Verdict: CONFIRMED     Severity: BLOCKER     Change follows: yes
Evidence checked:
- Plan:76: "Install the benchmark and transport APKs (debug builds, sideload)".
- https://learn.microsoft.com/dotnet/maui/deployment/runtimes-compilation (ms.date 2026-10-08), .NET 11 table: "Android | CoreCLR + JIT | CoreCLR + composite partial ReadyToRun + JIT".
- https://learn.microsoft.com/dotnet/maui/fundamentals/profiling (ms.date 2026-09-11): "Always profile `Release` builds for accurate performance measurements."
- Local SDK `/tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/dotnet-sdk/sdk/11.0.100/Sdks/Microsoft.NET.Sdk/targets/Microsoft.NET.Sdk.props:48-50`: Debug sets `<Optimize ...>false`. Learn's DebuggableAttribute.DebuggingModes says DisableOptimizations turns JIT optimisation off.
- Local pack `.../Microsoft.Android.Sdk.Linux/37.2.31/tools/Xamarin.Android.Common.targets:163-166`: `AndroidEnableFastDeployment` is True when `Optimize != True`, which makes `EmbedAssembliesIntoApk` False.
- https://learn.microsoft.com/dotnet/android/building-apps/build-properties (updated 2026-10-03): EmbedAssembliesIntoApk "should be True for Release builds and False for Debug builds"; AndroidKeyStore defaults to False, "the default debug-signing key will be used"; AndroidPackageFormats defaults to `aab;apk` for Release.
Notes: Followed literally, the Gate 1 phone number would time unoptimised JIT code, which could produce a false stop. The Fast Deployment point is my inference from the targets: the default Debug APK most likely does not run at all when installed without `dotnet build -t:Install`. A Release APK is debug-signed by default and also produced as an APK, so `-p:AndroidPackageFormats=apk` is optional. Record `-c Release` beside each number.

G-10. Own answer: Section 3 gives 2.2 MB at 4/s and 16 MB at 1/s; 6.5 MB is listed only as a size, and no "6.5 MB at 2/s" rate appears in the plan or the artifact. The sizes come from the 0.9.0 desktop measurements: 2.2 MB is the Katoomba 6 km 30 m snapshot, 6.5 MB is the scenario (start) message, and about 16 MB is a 10 m snapshot of a synthetic scenario. 10 m cells exist only at the desktop detail level. Phone pictures are about 0.68 MB (3 km), 2.2 MB (6 km) and 4.3 to 5.4 MB (9 km at 30 m, or 6 km at 20 m). The real picture rate is solver speed divided by the display step (10 to 600 s, default 60), coalesced to at most about 25 per second. Stage 2 uses synthetic buffers with no solver load. Stage 4's 10-minute run is the first time cadence is checked under load.
Verdict: CONFIRMED     Severity: MAJOR     Change follows: yes
Evidence checked:
- Plan:42.
- `desktop/README.md:188` ("A scenario is about 6.5 MB on the wire and one snapshot about 2.2 MB") and lines 200-211 (the 10 m rows are `syntheticScenario({ cellSize: 10 })` "because the tree has no finer builder"; snapshots 15.3, 16.5 and 33.8 MiB; 9 km at 30 m: 4.3 MiB; 6 km high at 20 m: 5.4 MiB).
- `prototypes/dotnet-b/reports/3a-reference.md:14-15`: snap-60 is 680,064 B at 3 km and 2,283,808 B at 6 km.
- `src/scenario/params.ts:22-31`: `fireCellM: 30`, `highDetailCellM: 20`, `desktopDetailCellM: { finer: 20, finest: 10 }`. `src/ui/desktopDetailChoice.ts:1-9`: desktop pages only.
- `src/ui/setupModel.ts:37` (`EXTENTS_KM = [3, 6, 9]`) and line 306 (`snapshotInterval: settings.timeStep`).
- `src/ui/settings.ts:56` (`TIME_STEPS = [10, 30, 60, 120, 300, 600]`).
- `src/sim/params.ts:109` (`snapshotMinWallMs: 40`) and `src/sim/host.ts:14` ("coalesced to at most ~25 per wall second").
Notes: Each part of the claim checks out. Two adjustments:
- The "6.5 MB at 2/s" in the question is not a plan rate.
- The plan does partly test load later (stage 4, "picture cadence held", plan:51), but only after Gates 1 and 2 are decided.
A required 16 MB/s case could fail Gate 2 for a size the phone never produces. Conversely, a faster C# solver at the 10 s step can exceed 4 pictures per second at 2.2 MB, up to the 25/s cap.

---

## Summary

| ID | Verdict | Severity |
|---|---|---|
| G-1 | PARTLY | MAJOR |
| G-2 | CONFIRMED | MAJOR |
| G-3 | REFUTED | NONE |
| G-4 | CONFIRMED | MAJOR |
| G-5 | CONFIRMED | BLOCKER (phone half of Gate 1) |
| G-6 | PARTLY | MAJOR |
| G-7 | CONFIRMED | MAJOR |
| G-8 | CONFIRMED | NONE |
| G-9 | CONFIRMED | BLOCKER |
| G-10 | CONFIRMED | MAJOR |

## Sources used
- Repository (worktree at 05795ff):
  - `docs/plans/dotnet-option-b-prototype.md` (all)
  - `docs/plans/air-slice-wind-detail-honest-speed.md:121,126,1005-1022`
  - `studies/desktop-simulation/README.md:140-186`
  - `desktop/README.md:180-211,241`
  - `prototypes/dotnet-b/README.md`, `prototypes/dotnet-b/reports/RESULTS-SCHEMA.md`, `prototypes/dotnet-b/reports/3a-reference.md`
  - `src/core/rng.ts`, `src/embers/sampling.ts`, `src/embers/EmberModel.ts`, `src/fire/spread/FireSpreadModel.ts`, `src/fire/spread/levelSet.ts`
  - `src/sim/simulation.ts`, `src/sim/params.ts`, `src/sim/host.ts`
  - `src/ui/settings.ts`, `src/ui/setupModel.ts`, `src/ui/desktopDetailChoice.ts`, `src/scenario/params.ts`
  - `src/ui/speedTest.ts`, `src/ui/speedTestKernels.ts`, `src/ui/speedTest.test.ts`
- Owner artifact: `/tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/firesim-dotnet.html`, searched for rates and thread counts; no 6.5 MB at 2/s.
- Local .NET 11 SDK and workload packs under `/tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/dotnet-sdk/`:
  - `sdk/11.0.100/Sdks/Microsoft.NET.Sdk/targets/Microsoft.NET.Sdk.props:48-53`
  - `packs/Microsoft.Android.Sdk.Linux/37.2.31/targets/Microsoft.Android.Sdk.SupportedPlatforms.targets:13`
  - `packs/Microsoft.Android.Sdk.Linux/37.2.31/targets/Microsoft.Android.Sdk.DefaultProperties.targets:80-90`
  - `packs/Microsoft.Android.Sdk.Linux/37.2.31/targets/Microsoft.Android.Sdk.CoreCLR.targets:19-21`
  - `packs/Microsoft.Android.Sdk.Linux/37.2.31/tools/Xamarin.Android.Common.targets:161-166`
- Microsoft Learn (all read 2026-11-12):
  - [What's new in .NET MAUI for .NET 11](https://learn.microsoft.com/en-us/dotnet/maui/whats-new/dotnet-11) (ms.date 2026-09-10)
  - [Runtimes and compilation in .NET MAUI](https://learn.microsoft.com/en-us/dotnet/maui/deployment/runtimes-compilation?view=net-maui-11.0) (ms.date 2026-10-08)
  - [Performance Profiling](https://learn.microsoft.com/en-us/dotnet/maui/fundamentals/profiling?view=net-maui-11.0) (ms.date 2026-09-11)
  - [.NET for Android build properties](https://learn.microsoft.com/en-us/dotnet/android/building-apps/build-properties) (updated 2026-10-03)
  - [DebuggableAttribute.DebuggingModes](https://learn.microsoft.com/he-il/dotnet/api/system.diagnostics.debuggableattribute.debuggingmodes?view=net-5.0)
- Android: [ADPF Thermal API](https://developer.android.com/games/optimize/adpf/thermal) (read 2026-11-12)
- Chromium:
  - [Intent to Ship: Restriction on SharedArrayBuffers](https://groups.google.com/a/chromium.org/g/blink-dev/c/1NKvbIj3dq4/m/Vgfisu5HAwAJ?hl=hi)
  - [SharedArrayBuffer updates in Android Chrome 88 and Desktop Chrome 92](https://developer.chrome.com/blog/enabling-shared-array-buffer)
  - Current WebView SharedArrayBuffer status was seen only in secondary sources and not relied on.
