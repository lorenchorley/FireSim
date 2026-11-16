# 1-profile: where the time goes in the two gate tiers (card T1.1)

Stage 1, builder T1.1, option B prototype. Numbers: `1-profile.json` (schema `RESULTS-SCHEMA.md`, stage `1-profile`, `indicative: true`; the JSON also carries every per-run value, the 25 hottest functions, the counts per phase and the call sites). Harness and runner: `ts-export/profile/` (`session.mjs` runs everything, `analyze.mjs` and `report.mjs` make the JSON and the tables below).

**Scenarios.** `katoomba6-fast` (6 km, fast tier, 200x200 fire cells at 30 m) and `katoomba3-standard` (3 km, standard tier = 3-D air, 100x100 at 30 m, 900 s 3-D spin-up first), both `--seed 13`, 1,800 s of fire, one 310 m ignition line, civil start 2025-12-20 12:00. **The plan's card says "Katoomba 6 km standard"; no such scenario exists in `ts-export/scenarios.ts`, and the card has been corrected to the 3 km one** (the 3a report does not export a 6 km standard fixture either).

**Conditions.** The shared container: Intel Xeon @ 2.10 GHz, 4 vCPUs, Linux 6.18, Node v22.22.0 (V8 12.4), one thread, 2026-11-16, repository commit `b5e83f8` plus this card's files. Per tier: 3 runs under `node --cpu-prof --cpu-prof-interval 100` (100 µs), 3 runs with no profiler (the app's own module timers, `Simulation.perf()`), 2 counting runs (Math wrapped), plus one 4-hour sensitivity run each (below). Every process ran as `flock /tmp/firesim-heavy.lock node ...`. The 1-minute load average at the start of each run was 1.35 to 2.18 (limit 3.5, so no run was repeated; part of the figure is my own previous process, and the busiest-process list recorded before and after each run, in the JSON, shows no other busy process at those instants, which is weak evidence because `ps` %CPU is a lifetime average). The profiler costs time: step loop 4,796 ms profiled against 3,813 ms plain on standard (+26 %), 1,869 against 1,792 on fast (+4 %); shares from the profile are shares of the profiled run. **Lock note for the orchestrator:** for the first 25 minutes of my session `/tmp/firesim-heavy.lock` could not be taken by anyone: a Roslyn compile server (`VBCSCompiler`, pid 1521, started by a .NET build under `flock`) had inherited the lock's file descriptor and kept the lock until it was gone (it was gone when I looked again at 13:56). Any `dotnet build` under the lock should pass `-p:UseSharedCompilation=false` (and `DOTNET_CLI_USE_MSBUILD_SERVER=0`), or the server holds the lock after the build ends.

## What was measured, and how phases are cut

The window is the simulation itself: samples with `Simulation.advance` (the step loop) or `Simulation.spinUp` on the stack. Scenario building, the `Simulation` constructor (with its moisture spin-up and the 3-D air initialisation, 0.7 to 0.9 s) and the final snapshot are outside; picture encoding is not in the exporter at all (the snapshot hook does nothing), so the **picture** row below is only the cost of assembling the snapshot; **T5.1 measures encoding.** Garbage-collector samples have no stack and are not in any share (0.15 to 0.17 s per process, about 3 % of the profiled step loop on standard and 9 % on fast).

Phases are the app's own taxonomy (`src/sim/perfStats.ts`, the same one plan §15e used): a sample belongs to the phase of the call `stepOnce` made that leads to it. So **air** is everything under `Atmosphere.step` (EllipticSolver.relax, gradient, divergence, `dynamics.advect`, diffusion, projection...); **coupling** is the wind for the fire (`Simulation.fireWinds`: `surfaceWindForFire`, the pyrogenic solve `src/atmosphere/pyrogenic.ts`, `sampleBg`) plus `addFireHeat`; **fire** is the level set and spread model (`src/fire/spread`, `src/fire/models`), masks and the minute tasks; **embers** is emission and flight (including its `Atmosphere.sampleAt` wind lookups, which are called from the ember step); **moisture** is the litter model, insolation and surface heating; **detectors** is the explanation engine and the diagnostics; **picture** is `makeSnapshot`; **other** is the rest, including time V8 inlined into `stepOnce`. The "app's own timers" column is `Simulation.perf().modules` of runs without a profiler, mapped the same way; it agrees with the profile everywhere except **other** (the profile sees inlined time that the timers book to the lap).

## Phase shares, 1,800 s, three runs (median, min to max, % of the step loop)

`katoomba3-standard` (standard tier, 189 steps of 9.5 s on average, 20.2 ms a step, step loop 3,813 ms (3,695 to 3,925); the 900 s 3-D spin-up, 76 air steps, adds 1,009 ms (952 to 1,023), which is 20 % of the whole run):

| phase | CPU profile | the app's timers (no profiler) | three profiled runs |
|---|---|---|---|
| air | **63.5** (63.5 to 64.2) | 65.4 (65.3 to 65.5) | 64.2 / 63.5 / 63.5 |
| fire | 9.6 (9.3 to 9.7) | 9.9 (9.7 to 10.0) | 9.3 / 9.7 / 9.6 |
| coupling | 4.9 (4.9 to 5.1) | 5.0 (5.0 to 5.3) | 4.9 / 4.9 / 5.1 |
| embers | 12.3 (12.2 to 12.6) | 12.5 (12.3 to 12.6) | 12.6 / 12.3 / 12.2 |
| moisture | 1.7 (1.3 to 1.8) | 1.5 (1.5 to 1.8) | 1.3 / 1.7 / 1.8 |
| detectors | 2.8 (2.8 to 2.9) | 2.5 (2.4 to 2.5) | 2.8 / 2.8 / 2.9 |
| picture (snapshot assembly only) | 2.2 (2.1 to 2.2) | 2.2 (2.1 to 2.2) | 2.1 / 2.2 / 2.2 |
| checkpoints | 0.3 | 0.3 | 0.3 / 0.3 / 0.3 |
| other | 2.5 (2.4 to 2.6) | 0.6 | 2.5 / 2.6 / 2.4 |

With the spin-up counted as one more phase (profile, of spin-up plus step loop): spin-up 19.9 (19.5 to 22.7), air 51.1, embers 9.8, fire 7.5, coupling 3.9; so the 3-D air is 71 % of a 30-minute run from a cold start (spin-up and step loop together).

`katoomba6-fast` (fast tier, 180 steps of 10 s, 10.0 ms a step, step loop 1,792 ms (1,511 to 1,898), no spin-up):

| phase | CPU profile | the app's timers (no profiler) | three profiled runs |
|---|---|---|---|
| air (the diagnosed wind's own step) | 0.0 (0.0 to 0.0) | 0.3 | 0.0 / 0.0 / 0.0 |
| fire | **25.9** (25.3 to 26.5) | 27.0 (26.5 to 27.3) | 26.5 / 25.9 / 25.3 |
| coupling | 19.3 (19.2 to 20.3) | 18.5 (17.4 to 18.6) | 19.3 / 19.2 / 20.3 |
| embers | 24.1 (23.8 to 24.3) | 24.0 (22.8 to 24.7) | 24.1 / 23.8 / 24.3 |
| moisture | 5.5 (5.0 to 5.8) | 7.0 (6.0 to 8.7) | 5.8 / 5.5 / 5.0 |
| detectors | 8.9 (8.0 to 9.4) | 8.7 (8.0 to 9.1) | 8.0 / 9.4 / 8.9 |
| picture (snapshot assembly only) | 11.1 (10.7 to 11.2) | 12.6 (10.6 to 13.6) | 11.2 / 10.7 / 11.1 |
| checkpoints | 1.2 (1.0 to 1.8) | 1.3 | 1.0 / 1.2 / 1.8 |
| other | 4.1 (3.4 to 4.3) | 1.3 | 4.1 / 4.3 / 3.4 |

The spread over three runs is under 1.5 points in every phase and under 3 for the timers (the fast tier's wall time itself varies 1,511 to 1,898 ms, so the timers' shares of its small phases wobble more). 664 cells burnt in all three fast runs and 996 in all three standard runs.

Cut by source directory instead (share of the step loop, standard / fast): `src/atmosphere/solver.ts` (the elliptic solver) 29.4 / 0; the rest of `src/atmosphere` outside the pyrogenic file 43.0 / 18.9; `pyrogenic.ts` 0 / 10.4; `src/fire/spread/levelSet.ts` 3.7 / 7.7; other `src/fire` 6.2 / 18.7; `src/embers` 8.9 / 16.2; `src/fuel/moisture` and `terrain/solar` 0.9 / 3.9; `src/explain` 2.2 / 6.6.

## Hottest functions (self time, share of the step loop)

Standard tier: **`EllipticSolver.relax`, `src/atmosphere/solver.ts`, 15.1 % (14.9 to 15.2)**. Then `dynamics.advect` 9.3, `EllipticSolver.divergence` 5.4, `EllipticSolver.gradient` 5.0, `dynamics.diffuseVLevels` 4.1, `EmberModel.advance` 4.1, `dynamics.diffuseH` 3.3, `Atmosphere.step` 3.2, `dynamics.displacements` 2.8, `dynamics.smagorinsky` 2.7, `Atmosphere.sampleAt` 2.4, `dynamics.collocate` 2.2. The solver's own functions (relax, gradient, divergence and the rest of `solver.ts`) are 29.4 % together. Including the spin-up the order is the same (relax 15.1 %).

Fast tier, 1,800 s: **`PyrogenicPotential.solve`, `src/atmosphere/pyrogenic.ts`, 8.4 % (8.0 to 8.6)**. Then `EmberModel.advance` 6.7, `DiagnosticWind.sampleBg` 5.9, `DiagnosticWind.addFireHeat` 3.3, `LevelSetCore.evaluate` 3.0, `LevelSetCore.reinit` 2.9, `DistanceTransform.compute` 2.8, `surfaceWindForFire` 2.3, `FireSpreadModel.computeCell` 2.4. **The fast tier's hottest kernel depends on how big the fire is**: in the 4-hour run below it is `LevelSetCore.evaluate` 13.6 %, then `reinit` 10.1 %, then the pyrogenic solve 9.2 %. No function is above 15 % in the fast tier, so a fast-tier port has no single kernel to win on; the level set (evaluate, reinit) and the pyrogenic solve are the three to port first.

V8 inlines small functions, so a function's self time includes what was inlined into it (`stepOnce` shows 1.9 to 4 % for that reason).

## Agreement with plan §15e (the card's 10-point test)

§15e's numbers (V20 hot-NW preset with the south-west change about 2 h in, seed 1, embers on, 30 m cells, one thread, a 4 h run of Katoomba 6 km for the fast tier; its shares are "of the CPU" and add to 87 %): fast tier fire 58, embers 13, coupling 11, air 5; Standard 3-D tier air 63 %. To test whether fire size explains the difference I ran each scenario once more for four simulated hours (`--duration 14400 --to 14400`, one profiled and one plain run each; **one run, no spread**; 8,110 cells burnt in the fast run, 3,753 in the standard run).

| tier, phase | §15e | mine, 1,800 s (3 runs) | difference | mine, 4 h (1 run) | difference |
|---|---|---|---|---|---|
| fast, fire | 58 | 25.9 | -32 | 48.4 | -9.6 |
| fast, embers | 13 | 24.1 | +11 | 14.9 | +1.9 |
| fast, coupling | 11 | 19.3 | +8 | 15.9 | +4.9 |
| fast, air | 5 | 0.0 | -5 | 0.0 | -5 |
| standard, air (step loop) | 63 | 63.5 | +0.5 | 71.1 | +8.1 |
| standard, air + spin-up | not stated | 71.0 | | 72.2 | |

**Result.** The Standard tier agrees: air 63.5 % at 30 minutes (63 % in §15e), 71 % after four hours, both within 10 points. The fast tier agrees within 10 points on every phase at four hours (fire is the worst, 9.6 points under §15e's 58) and **does not at 30 minutes (fire 32 points lower, embers 11 higher, coupling 8 higher)**. The reason is the fire's size: after 30 minutes the line has burnt 664 cells (60 ha) and after four hours 8,110 (730 ha), so the level set has little to do while the per-step costs that do not grow with the burning area (ember emission and flight, the wind for the fire and the pyrogenic solve, the snapshot, the explanation engine) are the same; as the fire grows the fire phase takes over. In the fast tier "air" is 0.0 in the app's taxonomy because the diagnosed wind is booked under coupling; §15e's 5 % is probably a source-directory cut (the part of `src/atmosphere` that is not the pyrogenic solve is 12 to 19 % here), which it does not define. So **the phase shares are not a constant of the tier: they move with the fire**, and a speed-up projection for the fast tier must say for which fire size it holds. Amdahl bounds on 4 cores from my shares (plain 1/(1-p+p/4)): standard air alone 1.9x at 30 minutes and 2.1x at four hours (§15e: 1.9x); fast fire alone 1.2x at 30 minutes and 1.6x at four hours; fire, coupling and embers all split 2.1x at 30 minutes and 2.5x at four hours (§15e: about 3x). Wall seconds per simulated hour for comparison (plain runs, step loop only): standard 7.6 at 30 minutes (9.6 with the spin-up) and 5.9 over four hours, against §15e's 20.8; fast 3.6 and 3.0, against §15e's 5.3. This machine, at this load, was 1.5 to 3.5 times faster than §15e's; I cannot say why (different weather window, machine, load or build; not investigated), and it does not change the shares.

## Transcendental calls per step (counted)

How: `Math.exp, log, pow, sin, cos, tan, atan, atan2, acos, asin, sinh, cbrt, log2, log10, hypot` and `sqrt` are replaced by counting wrappers in the scratch harness (`profile/mathwrap.ts`, installed before the solver runs; the solver itself is untouched, `src/` was not edited). The `**` operator is not `Math.pow`, so the count build rewrites every `a ** b` of the solver's TypeScript in memory (42 sites, a TypeScript-AST edit in `run.mjs build --count`) to a counted call with the same value; `**` with exponent 2 is counted apart (it is a square, which V8 and a C# compiler can turn into a multiply; whether they do was not checked here). Counts are exact and repeatable (the two counting runs of each tier have identical totals); the results of a counting run are the same as of a plain run (same burnt cells). Counts are attributed to the app's laps by wrapping `PerfStats.addLap` (the lap name says which part of the step has just finished), then mapped to phases as above. A step is one `stepOnce`: 180 of 10.0 s (fast) and 189 of 9.5 s on average (standard); the 76 spin-up air steps and the constructor are counted apart. Call sites are sampled (every 16th non-`sqrt` call, first stack frame outside the wrapper); they are estimates.

`katoomba3-standard`, per step (the table's total is every function in the columns, including `**` with an exponent other than 2; `sqrt` is exact and not counted in the total):

| phase | exp | log | pow | `**` | sin | cos | tan | atan | atan2 | acos | asin | cbrt | hypot | total | `**2` | sqrt |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| air | 794 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 794 | 72,001 | 12,027 |
| fire | 4,979 | 440 | 152 | 0 | 83 | 1,847 | 0 | 1,577 | 527 | 522 | 0 | 0 | 2 | 10,131 | 0 | 33,440 |
| coupling | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 7,214 |
| embers | 6,020 | 918 | 72 | 96 | 177 | 289 | 0 | 0 | 1 | 0 | 0 | 1,325 | 469 | 9,368 | 0 | 16,028 |
| moisture | 16 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 142 | 0 | 159 | 0 | 419 |
| detectors | 10 | 27 | 4 | 74 | 92 | 81 | 2 | 22 | 64 | 1 | 2 | 0 | 65 | 444 | 2 | 224 |
| picture | 285 | 0 | 1 | 0 | 1 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 290 | 0 | 0 |
| checkpoints | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 53 |
| other | 1 | 1 | 0 | 7 | 167 | 86 | 14 | 0 | 12 | 9 | 11 | 0 | 14 | 323 | 11 | 6 |
| **all** | 12,105 | 1,387 | 229 | 178 | 521 | 2,304 | 16 | 1,599 | 605 | 533 | 13 | 1,467 | 551 | **21,508** | 72,014 | 69,411 |

`katoomba6-fast`, per step:

| phase | exp | log | pow | `**` | sin | cos | tan | atan | atan2 | acos | asin | cbrt | hypot | total | `**2` | sqrt |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| air | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| fire | 4,247 | 206 | 107 | 0 | 84 | 5,920 | 0 | 1,395 | 464 | 461 | 0 | 0 | 0 | 12,883 | 0 | 34,262 |
| coupling | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 9,990 |
| embers | 4,153 | 547 | 9 | 46 | 157 | 207 | 0 | 0 | 1 | 0 | 0 | 722 | 446 | 6,286 | 0 | 10,990 |
| moisture | 17 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 548 | 0 | 566 | 0 | 1,774 |
| detectors | 20 | 61 | 4 | 107 | 104 | 92 | 2 | 21 | 99 | 1 | 2 | 0 | 90 | 602 | 2 | 275 |
| picture | 325 | 0 | 1 | 0 | 1 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 330 | 0 | 0 |
| checkpoints | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 222 |
| other | 1 | 0 | 0 | 6 | 168 | 87 | 14 | 0 | 12 | 9 | 11 | 0 | 22 | 330 | 11 | 7 |
| **all** | 8,762 | 813 | 120 | 159 | 514 | 6,308 | 16 | 1,416 | 577 | 471 | 13 | 1,270 | 558 | **20,998** | 13 | 57,521 |

`sinh`, `log2` and `log10` are never called in a step. What the numbers say for `FsMath`'s weighting:
- **The 3-D air solve calls no transcendental function worth weighting**: 794 `exp` a step (all one site, `F` in `src/atmosphere/surface.ts`, the surface-heating flux) against 12,027 `sqrt` and 72,001 squares, and a spin-up step has 1.1 `exp` (and the same 72,001 squares, 8,087 `sqrt`). `FsMath` speed cannot move the 64 % of the standard tier that is air; what matters there is the speed of plain arithmetic, `sqrt` and `**2`.
- Both tiers call about **21,000 transcendental functions a step** (fast 20,998 in 10.0 ms a step; standard 21,508 in 20.2 ms), almost all in fire and embers. Each extra 10 ns a call costs 0.21 ms a step: **2.1 % of a fast-tier step, 1.1 % of a standard-tier step**. `exp` is the most called (8,762 and 12,105), then `cos` in the fast tier (6,308, 5,920 of them in the fire phase), `atan` (1.4 to 1.6 thousand), `cbrt`, `log`, `hypot` (about 550), `atan2`, `acos`, `sin`.
- Where the biggest sites are (sampled): `EmberModel.advance` (`exp` and `cbrt`, 3.4 to 4.9 thousand `exp` a step), `slopeFactor` in `src/fire/models/common.ts` (`exp`, 2.3 to 2.6 thousand), `leeAlignment` and `leeSeparation` in `src/fire/spread/math.ts` (`cos`, 1.4 thousand a step in the standard tier and 4.7 thousand in the fast tier, in the fire phase), `hybridHead` (`acos`, `atan`), `DecayRaster.at` in `src/embers/stats.ts` (`exp`, 285 to 325, in the snapshot).
- `**` with an exponent other than 2: 159 to 178 a step; `Math.pow`: 120 to 229. The plan's §3 count of `Math` calls in the solver's source (cos 113, exp 107, hypot 91...) is static; it does not see `**` (42 sites, mostly `** 2`).
- Outside the step: building the scenario and constructing `Simulation` (which includes the moisture spin-up and the air set-up) made 0.9 million (standard) and 3.8 million (fast) `sqrt` calls and about 1.1 million (standard) and 2.5 million (fast) transcendental calls (fast: 1.1 million `atan`, 0.34 million `hypot`; standard: 0.27 million `atan`, 0.16 million `exp`), a one-off cost (`constructTotals` in the JSON).

## What this does not cover

- Picture encoding (T5.1). The snapshot's assembly is in the table; the typed-array copies into the codec and the page's drawing are not.
- Katoomba 6 km standard, `katoomba3-high`, 10 m cells and many-thread behaviour; the profile is one thread.
- Fire-size dependence beyond the two points (30 minutes, four hours); the four-hour rows are one run each, with no spread.
- The profile attributes by call stack, so V8 inlining moves small functions' time to their callers; the lap-based timers do not have that error but cannot see inside a lap. They agree to within 3 points except for **other** (profile 2.5 to 4.1 %, timers 0.6 to 1.3 %).
- Timings are indicative: a shared container, load average 1.35 to 2.18 at the starts.

## Commands (from the repository root; `node_modules` is a link to the main checkout's)

```
node prototypes/dotnet-b/ts-export/profile/run.mjs build --out prototypes/dotnet-b/fixtures/.build-ts-profile
node prototypes/dotnet-b/ts-export/profile/run.mjs build --count --out prototypes/dotnet-b/fixtures/.build-ts-profile-count
node prototypes/dotnet-b/ts-export/profile/session.mjs --build prototypes/dotnet-b/fixtures/.build-ts-profile --count-build prototypes/dotnet-b/fixtures/.build-ts-profile-count --out $SCRATCH/session           # 3 profiled, 3 plain, 2 counting runs per tier, each under flock
node prototypes/dotnet-b/ts-export/profile/session.mjs ... --out $SCRATCH/session-4h --runs 1 --count-runs 0 --to 14400 --duration 14400   # the sensitivity runs
node prototypes/dotnet-b/ts-export/profile/analyze.mjs --dir $SCRATCH/session --out $SCRATCH/summary.json
node prototypes/dotnet-b/ts-export/profile/report.mjs --summary $SCRATCH/summary.json --extra $SCRATCH/summary-4h.json --json prototypes/dotnet-b/reports/1-profile.json
```
The `.cpuprofile` files (1 MB each) stay in the scratchpad (`.../scratchpad/T1.1/session/prof/`), not in git.
