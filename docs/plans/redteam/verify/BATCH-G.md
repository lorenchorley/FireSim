# Batch G: gates 1 and 2, measurement method (10 items)

Follow VERIFY-COMMON.md. Do Part 1 for an item (investigate the question, write your own answer) before you read that item in Part 2.

## Part 1: the questions

- **G-1.** In the plan's Gate 1, what exactly is compared with what (threads on each side), and could a pass be explained by threads that the TypeScript project could also use under D34?
- **G-2.** How do Gate 1's pass bars (1.5x desktop, 2.0x phone) compare with what plan 15e and D39 concluded about the value of 2 to 2.6 times, and does Gate 1 gate on a kernel or on the whole simulation step?
- **G-3.** How does FireSim's simulation generate its random numbers, and could the sequence be reproduced exactly in another language?
- **G-4.** Which simulation tier does the app build by default on a capable phone, what share of solver time does each subsystem take in that tier and in the fast tier, and which tier does stage 1 profile?
- **G-5.** For Gate 1's phone bar ("under 2.0x the TypeScript on the phone"), what TypeScript number on the phone does the plan provide to divide by? Does the app already contain a phone-run benchmark that could serve?
- **G-6.** Must the stage 1 benchmarked kernel produce the same outputs, the same random draws in the same order, and identical results across thread counts as the stage 3 port will require? How much of the fast tier must stay serial if the TypeScript random draw order is reproduced exactly?
- **G-7.** What does the plan specify for measuring speed on a phone (thermal state, warm-up, core types, run order, repetitions, partitioning of work across big and little cores)?
- **G-8.** What is the minimum Android API level supported by .NET MAUI apps targeting .NET 11?
- **G-9.** What build configuration does the plan ask for on the phone, and what does Microsoft say about measuring performance with that configuration in .NET 11 MAUI on Android?
- **G-10.** Where do the Gate 2 rates (2.2 MB at 4/s, 6.5 MB at 2/s, 16 MB at 1/s) come from, and do they match the picture sizes and rates a phone would actually produce? Is the transport measured with the solver running?

## Part 2: the claims (read each only after answering its question)

**G-1.**
Claim: Gate 1 compares all-core C# with single-thread TypeScript in Node. Plan 15e bounds TypeScript workers at about 1.8 to 2.6 times on 4 cores, and D34 allows those threads. So Gate 1 can pass with C# no faster than V8 per core, and the gain it measures is one the status quo can also get.
Pointers: plan section 3 stage 1 table row and "Stage 1 detail"; `docs/plans/air-slice-wind-detail-honest-speed.md` around 1018 ("Amdahl upper bounds on 4 cores ...") and D34 (around 121).
Proposed change: report C# 1 thread against TypeScript 1 thread, C# scaling, and C# all-core against TypeScript with worker_threads on the same partition; gate on the B-specific gain.

**G-2.**
Claim: The bars (1.5x, 2.0x) sit at or below the 2 to 2.6 times that 15e and D39 already judged "not worth starting for speed", and the gate is on one kernel's speed, not on the whole step; with Amdahl's law, a kernel speed-up is diluted by the other phases.
Pointers: plan section 3; 15e "Threads, WebAssembly and WebGPU are not worth starting for speed on this evidence"; D39 around line 126; `studies/desktop-simulation/README.md` phase table.
Proposed change: gate on a projected whole-step speed-up (profile shares through Amdahl) against the best TypeScript arm, with the Amdahl ceiling written beside every kernel ratio.

**G-3.**
Claim: FireSim's simulation draws its random numbers from Math.random(), so the sequence cannot be reproduced in another language.
Pointers: `src/core/rng.ts`.
Proposed change: none.

**G-4.**
Claim: The default performance mode is "auto", which builds the Standard (3-D) tier and keeps it unless the air is "hopeless" (on the one phone measured it was not); in Standard the air takes about 63 to 70 % of time and the fire 12 to 17 %. Stage 1 profiles only the fast tier, and stage 3b may defer the atmosphere. So Gate 1 can pass on a kernel whose effect on a default phone run is small.
Pointers: `src/ui/settings.ts` around 195-203; `src/sim/simulation.ts` around 430 (`buildTier = tierReq === 'auto' ? 'standard' : tierReq`); `src/sim/params.ts` around 44-48; 15e profile figures; plan section 3 stage 1 and 3b.
Proposed change: profile the tier the owner's phone actually runs, port that tier's hottest kernel (likely the air step), gate on whole-step time, do not defer the atmosphere if Standard is the phone's tier.

**G-5.**
Claim: There is no TypeScript-on-phone number: the TypeScript side is a Node harness (Node does not run on the phone), so the phone ratio cannot be computed honestly. The app already ships a frozen, checksum-pinned air-stencil kernel run on the phone by its speed test; porting it bit-exactly to C# gives a same-device baseline.
Pointers: plan sections 3, 4 (K1 row) and 9; `src/ui/speedTestKernels.ts` lines 1-12; `src/ui/speedTest.ts`; `src/ui/speedTest.test.ts` (pinned checksum).
Proposed change: port the frozen kernel to C# and run it beside the app's speed test on the same phone; for the real kernel, run the TypeScript in a WebView worker inside the same test app.

**G-6.**
Claim: Stage 1 never requires identical outputs, random-generator state or thread-count identity of the benchmarked kernel. The spread step draws from the fire stream inside the band loop and the ember model draws from one stream in particle order inside variable sub-step loops; `computeCell` reads neighbours' values written in the same pass. Reproducing the exact draw order forces these parts onto one thread, capping the fast tier at about 2.2 times on 4 cores (embers about 25.6 % of fast-tier time), so a parallel kernel benchmark can show a gain the faithful port loses.
Pointers: `src/fire/spread/FireSpreadModel.ts` around 33-34, 479, 1353, 1379-1418, 1504, 1954-1981; `src/fire/spread/levelSet.ts` around 269-275; `src/embers/EmberModel.ts` around 629-674, 1367, 1458, 1602-1654, 2203; `src/sim/simulation.ts` 434-437; plan section 1 rule 4 and section 10.
Proposed change: a kernel counts only if its outputs and RNG state equal the TypeScript's, it is identical on 1, 2, 4, 8 threads, and its timing includes the draws in order; add a serial inventory per module; make Gate 1 a whole-step benchmark.

**G-7.**
Claim: The plan has no phone measurement protocol: no thermal control or logging, no warm-up rule for JIT/ReadyToRun, no run order (for example A B B A), no sustained run, and "Parallel.For with a fixed partition" waits for the slowest core on big/little phones; determinism needs fixed chunk boundaries and reduction order, not a fixed thread assignment.
Pointers: plan section 3 stage 1 detail, section 5; https://developer.android.com/games/optimize/adpf/thermal; https://source.android.com/docs/core/perf/performance-hint-api.
Proposed change: a written phone protocol (Release build, A B B A, 30 s warm-up, 60 s timed, a sustained 10-minute run per engine, thermal headroom every 10 s, many fixed chunks assigned dynamically, a per-thread-count curve, the SoC topology recorded).

**G-8.**
Claim: The minimum Android API level for .NET MAUI apps targeting .NET 11 is 24 (Android 7.0).
Pointers: Microsoft Learn, "What's new in .NET MAUI for .NET 11".
Proposed change: none.

**G-9.**
Claim: Plan section 5 asks for debug builds on the phone. In .NET 11 MAUI a Debug Android build runs CoreCLR with JIT and no ReadyToRun and unoptimised code; Microsoft says to profile Release builds. A Gate 1 phone stop or a Gate 2 rate could then fail on build configuration.
Pointers: plan section 5 ("debug builds, sideload"); https://learn.microsoft.com/dotnet/maui/deployment/runtimes-compilation; https://learn.microsoft.com/dotnet/maui/fundamentals/profiling; https://learn.microsoft.com/dotnet/android/building-apps/build-properties (`AndroidKeyStore`, `EmbedAssembliesIntoApk`).
Proposed change: every APK whose numbers feed a gate is a Release build (debug-signed, `-p:AndroidPackageFormats=apk`); Debug only for smoke tests; record the configuration beside each number.

**G-10.**
Claim: The rates are not derived from the phone: phone pictures are 30 m at 3, 6 or 9 km (about 0.7, 2.2 and 5 MB); 16 MB is a 10 m picture of the desktop-only detail setting and came from a synthetic scenario; 6.5 MB is the one-off scenario message, not a picture. The real rate is solver speed divided by the display step (10 to 600 s), so a Gate 1 pass raises the rate Gate 2 must carry. The transports are measured with an idle CPU, not with the solver holding the cores.
Pointers: `prototypes/dotnet-b/reports/3a-reference.md` (snapshot sizes); `src/ui/setupModel.ts` (`EXTENTS_KM`, `snapshotInterval: settings.timeStep`); `src/ui/settings.ts` (`TIME_STEPS`); `desktop/README.md` (sizes, "the tree has no finer builder"); `src/sim/params.ts` (`snapshotMinWallMs`).
Proposed change: derive the rates from the measured phone speed and the 10 s and 60 s steps at 0.7, 2.2 and about 5 MB; move 16 MB to the desktop stage; measure the transports under a busy-loop load on N and N-1 cores; report one end-to-end number for Gates 1 and 2.
