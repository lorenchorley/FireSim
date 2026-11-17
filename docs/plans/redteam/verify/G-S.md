# Batch G, verifier S

G-1. Own answer (before reading the claim): Gate 1 (plan section 3, row 1) is "All-core C# ... under 1.5x the TypeScript" with the TypeScript "in Node on identical inputs" (stage 1 detail, line 40). The plan never gives the TypeScript a thread count; the harness is a plain Node run, so one thread is the natural reading. C# is run on "1 to 4 threads". D34 allows worker threads in the TypeScript project, so a threads-only pass is something the status quo can also get.
Verdict: CONFIRMED     Severity: MAJOR     Change follows: yes
Evidence checked: plan lines 34 and 40; D34 in docs/plans/air-slice-wind-detail-honest-speed.md:121 ("Node host with worker threads ... Speed beyond one core comes from threads"); same file line 1014 ("Amdahl upper bounds on 4 cores: the air alone 1.9x (Standard) and 2.6x (High); the fire alone 1.8 to 2.0x").
Notes: The only softening is that the plan is silent, not explicit, about TypeScript threads. With 4 cores and a 1.5x bar, a C# that is only 0.4 to 0.6x as fast per core could pass if it scales. The proposed report (1 thread vs 1 thread, scaling, then all-core vs worker_threads on the same partition) follows.

G-2. Own answer (before reading the claim): The bars are 1.5x (desktop) and 2.0x (phone). Plan 15e says threads, WebAssembly and WebGPU "would help the 3-D air by at most about 2 to 2.6x on 4 cores" and are "not worth starting for speed"; D39 repeats that. Gate 1 is on "the hottest kernel", not the whole step.
Verdict: CONFIRMED     Severity: MAJOR     Change follows: yes
Evidence checked: plan lines 34 and 40 ("Is there a speed-up? The hottest kernel in C#"); docs/plans/air-slice-wind-detail-honest-speed.md:1018 ("Threads, WebAssembly and WebGPU are not worth starting for speed on this evidence (... at most about 2 to 2.6x on 4 cores)"), D39 at :126; studies/desktop-simulation/README.md:171-182 (Amdahl table: fast 30 m, fire alone 58 % gives 1.78x on 4 cores; Standard air 63 % gives 1.90x).
Notes: Slightly apples-to-oranges: the 2 to 2.6x is a threads bound, while the Gate 1 ratio mixes language speed and threads. But all-core C# against one-thread TypeScript is exactly the threads-comparable quantity, so the point stands. The README shows no dominant phase in the fast tier (level-set step 37.7 %), so a kernel ratio is diluted. Plan section 7 states no Amdahl ceiling anywhere.

G-3. Own answer (before reading the claim): The simulation uses a seeded mulberry32 generator (class Rng), with Box-Muller normal and Poisson on top. The 32-bit integer sequence is exactly reproducible in any language; the normal/log-normal/Poisson transforms call Math.log/cos/exp, which can differ in the last bit between runtimes.
Verdict: REFUTED     Severity: NONE     Change follows: n/a (claim proposes none)
Evidence checked: src/core/rng.ts:1-3 ("seedable PRNG (mulberry32) so simulations are reproducible"), :11-16 (integer arithmetic with Math.imul); src/sim/simulation.ts:436-437 (`new Rng(so.seed)`, `so.seed + 1`, `+ 3`); Grep for Math.random in src excluding tests: only UI element ids and a dataset stamp, plus comments saying "no Math.random". Plan section 10 already decides to port the generator and draw order exactly.
Notes: The claim is false. Caveat (inference): exact draws are reproducible, but derived values depend on transcendental functions; plan section 10 item 1 found 4.5 ulp perturbations did not move float32 arrivals.

G-4. Own answer (before reading the claim): Default performance mode is 'auto', which asks the engine for tier 'auto'; the engine builds Standard (3-D air) and may fall to fast only if auto-tune says hopeless. In Standard the air is about 61 to 69 % of time. Stage 1 profiles "the Katoomba 6 km fast-tier scenario" (plan line 40), not Standard.
Verdict: CONFIRMED     Severity: MAJOR     Change follows: yes
Evidence checked: src/ui/settings.ts:66 (`performance: 'auto'`) and :195-203 (default case returns tier 'auto'); src/sim/simulation.ts:433 (`buildTier = this.tierReq === 'auto' ? 'standard' : this.tierReq`); src/sim/params.ts:35-47 ("the detailed 3-D air unless it is hopeless ... 4.8 times the one phone measured so far"); studies/desktop-simulation/README.md:146-166 (Standard 30 m: air 61.5 %, 69 % of CPU in the air-solver files; fast 30 m: fire 58 %, embers 12.8 %, air 0.2 %); plan line 46 ("the slice may ... defer the atmosphere port").
Notes: Numbers slightly off: the README phase table gives Standard fire about 18 to 20 % (prepare 6.3 + level-set 11.7 + masks/minute 1.5), not 12 to 17 %; air is 61.5 % by phase, 63 % in 15e, 69 % by CPU file. Immaterial. Fast tier is a real configuration (battery mode, or auto when hopeless), so profiling it is not wrong, only not the default phone run.

G-5. Own answer (before reading the claim): The plan's TypeScript side is a Node harness; Gate 1's phone bar ("under 2.0x the TypeScript on the phone") gives no phone TypeScript number; K1's deliverable is only "a minimal Android benchmark app". The app has a speed test with a frozen air-stencil kernel that runs in a worker on the phone.
Verdict: CONFIRMED     Severity: MAJOR     Change follows: yes
Evidence checked: plan lines 34, 40, 62 (K1 row), 105 ("The TypeScript side stays a Node harness"); no phone TypeScript run in plan sections 3 to 5. src/ui/speedTestKernels.ts:1-12 (K1 "air stencil", 45x45x20 Float32 grid, "Frozen ... checksum"; LCG "exact in integer arithmetic on every engine"); src/ui/speedTest.test.ts:38-41 (`expect(k.checksum()).toBe(FROZEN.stencilAfter3)`).
Notes: Bit-exact port is feasible if Float32 rounding is respected (inference). The frozen kernel is single-threaded, so it is a per-core baseline only; the second half of the proposal (TypeScript worker in a WebView in the same test app) covers the real kernel.

G-6. Own answer (before reading the claim): Plan stage 1 asks for the chosen kernel ported three ways and benchmarked on identical inputs; it does not require identical outputs, RNG state or thread-count identity (those are rule 4 of section 1, naming "the C# solver", and the Stage 3 gate). In the TypeScript, the fire stream draws in breachDraw (called from prepareCell only for break cells) and the debris Poisson loop; the ember model draws from one stream in particle order.
Verdict: PARTLY     Severity: MAJOR     Change follows: partly
Evidence checked: plan lines 12, 36, 40; src/fire/spread/FireSpreadModel.ts:1380-1381 (`if (this.breakW[k]! > 0 && this.canBurn[k] === 1) this.breachDraw(k, t)` inside prepareCell), :1504 (`this.rng.next() < p`), :1954-1984 (Poisson and range draws in a loop over active cells); src/embers/EmberModel.ts:629-630 (`this.r.poisson(...)`, `this.spawn(...)`), :2246-2251 (stream copied in and out); studies/desktop-simulation/README.md:156 (embers 12.8 % of fast 30 m) and :171-182 (embers included gives 2.87x on 4 cores).
Notes: True: stage 1 never demands equal outputs or thread identity, and a parallel kernel timing can show a gain a faithful port loses. Overstated or unverified: (1) "embers about 25.6 %" is not in the repo (README and 15e say 12.8 to 13 %); with embers serial at 12.8 % and the rest perfectly parallel the README bound is 2.87x, not 2.2x; 2.2x would need the fire draws serial too, which I could not confirm. (2) Fire-stream draws in prepareCell fire only on break cells (breakW > 0), so the main spread band is not forced serial in general (draws could be hoisted or sequenced; inference). (3) Same-pass neighbour reads in computeCell not checked in depth. The whole-step benchmark and serial inventory follow; do not quote the 2.2x cap.

G-7. Own answer (before reading the claim): The plan's phone instructions are minimal: "Install the benchmark and transport APKs (debug builds, sideload) ... Each screen shows its numbers", "Say which phone and Android version"; rule 3 asks for machine, cores, run count, median and spread. Nothing on thermal state, warm-up, run order, sustained runs or big/little topology.
Verdict: CONFIRMED     Severity: MAJOR     Change follows: yes
Evidence checked: whole plan read; plan line 11 (rule 3), 40 ("Parallel.For with a fixed partition"), 75-78 (section 5). BenchmarkDotNet is named for all C# timings (line 105) with no word on running it on Android (inference: it is not an Android app runner, so the phone harness would be home-made and the plan does not say so).
Notes: "Fixed partition" is ambiguous: fixed chunk boundaries (needed for determinism) are compatible with dynamic assignment to threads, so that sub-claim is plausible but not shown to be a plan error. The rest is true: no thermal logging, warm-up rule, run order, sustained run or topology record.

G-8. Own answer (before reading the claim): .NET 11 MAUI requires Android 7.0, API 24.
Verdict: CONFIRMED     Severity: NONE     Change follows: n/a (none proposed)
Evidence checked: https://learn.microsoft.com/en-us/dotnet/maui/supported-platforms (updated 2026-09-16, fetched 2026-11-12), net-maui-11.0 block: "Android 7.0 (API 24) or higher is required" and "Note: .NET MAUI apps that target .NET 11 require Android API level 24 or higher."
Notes: Plan stage 5 already lists "Android 7.0 (API 24) floor", consistent.

G-9. Own answer (before reading the claim): Plan section 5 asks for "debug builds, sideload". Microsoft's .NET 11 MAUI table: Android Debug is CoreCLR + JIT; Release is CoreCLR + composite partial ReadyToRun + JIT; the profiling page says always profile Release.
Verdict: CONFIRMED     Severity: MAJOR     Change follows: yes
Evidence checked: plan line 76. https://learn.microsoft.com/en-us/dotnet/maui/deployment/runtimes-compilation (updated 2026-10-13), net-maui-11.0 table: "Android | CoreCLR + JIT | CoreCLR + composite partial ReadyToRun + JIT"; "ReadyToRun is enabled by default in the Release configuration". https://learn.microsoft.com/en-us/dotnet/maui/fundamentals/profiling (updated 2026-09-24): "Always profile Release builds for accurate performance measurements."
Notes: "Unoptimised code" for Debug is inference (Debug configuration compiles IL unoptimised); the docs say JIT, not R2R. Even in Release, partial R2R means early calls run precompiled code before tier-up, so a warm-up rule is needed (see G-7). The proposed change follows.

G-10. Own answer (before reading the claim): 2.2 MB is a 6 km fast-tier 30 m snapshot and 6.5 MB the 6 km scenario upload (desktop/README.md:206). 16 MB is the 6 km 10 m snapshot (15.3 to 16.5 MiB), a synthetic row. Stage 2 uses synthetic buffers with no solver running.
Verdict: CONFIRMED     Severity: MAJOR     Change follows: partly
Evidence checked: desktop/README.md:187-188 ("A scenario is about 6.5 MB on the wire and one snapshot about 2.2 MB"), :206-210 (6 km fast 30 m 6.5 MiB / 2.2 MiB; 9 km 30 m 4.3 MiB; 6 km 10 m synthetic 15.3 MiB), :201 ("the tree has no finer builder"); src/ui/desktopDetail.ts:10-11 ("Finest 10 m ... a snapshot of 16 MB (6 km)"); src/ui/setupModel.ts:37 (`EXTENTS_KM = [3, 6, 9]`), :306 (`snapshotInterval: settings.timeStep`); src/ui/settings.ts:56 (`TIME_STEPS = [10, 30, 60, 120, 300, 600]`); src/sim/params.ts:109 (`snapshotMinWallMs: 40`); prototypes/dotnet-b/reports/3a-reference.md:14-15 (3 km fast snapshot 0.68 MB, 6 km 2.28 MB); plan line 42 ("Synthetic buffers at the real sizes ... sustained for 60 s").
Notes: Correct in substance. Small error: the 9 km snapshot is 4.3 MiB in the README, not "about 5". The plan labels the rates "Proposed", so they are asserted, not derived from phone speed. I did not check whether Finest is desktop-only in the UI beyond its name ("Desktop detail"). Stage 2 uses synthetic buffers with no solver in the loop: true. The busy-loop load idea is a sensible extension; "move 16 MB to the desktop stage" is a judgement call, hence "partly".

## Summary

| ID | Verdict | Severity |
|---|---|---|
| G-1 | CONFIRMED | MAJOR |
| G-2 | CONFIRMED | MAJOR |
| G-3 | REFUTED | NONE |
| G-4 | CONFIRMED | MAJOR |
| G-5 | CONFIRMED | MAJOR |
| G-6 | PARTLY | MAJOR |
| G-7 | CONFIRMED | MAJOR |
| G-8 | CONFIRMED | NONE |
| G-9 | CONFIRMED | MAJOR |
| G-10 | CONFIRMED | MAJOR |

## Sources used
- docs/plans/dotnet-option-b-prototype.md (all)
- docs/plans/air-slice-wind-detail-honest-speed.md lines 121, 126, 1014, 1018
- studies/desktop-simulation/README.md lines 144-182
- desktop/README.md lines 185-250
- src/core/rng.ts; src/sim/simulation.ts 433-437; src/sim/params.ts 35-60, 109; src/ui/settings.ts 56-66, 195-203; src/ui/setupModel.ts 37, 306; src/ui/desktopDetail.ts 1-20; src/ui/speedTestKernels.ts 1-12; src/ui/speedTest.test.ts; src/fire/spread/FireSpreadModel.ts 1380-1381, 1504, 1954-1984; src/embers/EmberModel.ts 629-630, 2246-2251
- prototypes/dotnet-b/reports/3a-reference.md
- https://learn.microsoft.com/en-us/dotnet/maui/supported-platforms (2026-09-16)
- https://learn.microsoft.com/en-us/dotnet/maui/deployment/runtimes-compilation (2026-10-13)
- https://learn.microsoft.com/en-us/dotnet/maui/fundamentals/profiling (2026-09-24)
