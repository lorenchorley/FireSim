# Batch N: numerics, gate 3 and the size of the port (10 items)

Follow VERIFY-COMMON.md. Do Part 1 for an item (investigate the question, write your own answer) before you read that item in Part 2. Helper scripts written by a reviewer exist at `/tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/r3-tools/` and `.../scratchpad/r7/k1.mjs`; you may read and run them (small runs only), but judge their output yourself. Fixtures are in `.../scratchpad/dotnet-fixtures/`.

## Part 1: the questions

- **N-1.** Stage 3a perturbed the weather inputs by 1e-15, 1e-12 and 1e-9 and concluded that last-bit math differences do not matter. Did the 1e-15 perturbation actually reach the solver's state, and what happens to the results when noise of the size of real libm differences is injected, at 900 s, 1800 s and 3600 s?
- **N-2.** Do JavaScript engines and .NET give the same results for Math.exp, log, pow, sin, cos, atan2 and cbrt on every platform and version? Specifically: what does Microsoft document for .NET Math functions, what does V8 use in Node 22 (V8 12.4) and in current Chrome/WebView (V8 15.x), and does the plan check C# against C# across operating systems or the phone against the desktop?
- **N-3.** What is the minimum Android API level supported by .NET MAUI apps targeting .NET 11?
- **N-4.** Which JavaScript semantics used in the solver behave differently in C# by default (float arithmetic, rounding of halves, sort stability, NaN ordering in sorts, Map iteration order after delete and re-insert, exponentiation edge cases, string comparison, float-to-integer conversion), and does the plan's list cover them?
- **N-5.** If the C# random stream differs from the TypeScript, the plan's fallback bar is "mean burnt area over 30 seeds within 12 % of the TypeScript mean". With the run-to-run variation measured in 3a, how often would a correct port fail that bar, and how often would a port with a true 10 % bias pass it?
- **N-6.** Does seed 11, the primary fixture seed, exercise the ember (spotting) code?
- **N-7.** At what simulated times and on how many sites and scenarios does Gate 3 compare C# with TypeScript, and how long are the scenarios the app's users and validation suite run?
- **N-8.** How does FireSim's simulation generate its random numbers, and could the sequence be reproduced exactly in another language?
- **N-9.** How many lines of non-test TypeScript does the solver's runtime import closure contain (starting from `src/sim/host.ts`), how many test lines go with it, and does the stage 3 slice cover what stage 4's "existing page, protocol 2, page needs no change" requires (rewind/checkpoints, records, explain)?
- **N-10.** Is the plan's rule "results must not depend on thread count" compatible with the tier `auto`, which chooses a tier from measured timing?

## Part 2: the claims (read each only after answering its question)

**N-1.**
Claim: The 1e-15 evidence is vacuous: every typed array was byte-identical to the base run, and the snapshot hashes changed only because the hash includes `stats.weather` and `stats.ffdi`, which echo the perturbed input. When noise with the per-function probabilities of real V8-versus-glibc differences is injected, fast seed 13 at 3600 s flips burnt status in 6 of 10 noise seeds (0.05 to 0.56 % of ever-burning cells, max arrival difference up to 723 s); at 1800 s 9 of 10 runs were identical. So "tested" in the artifact and "expected difference about 0" in plan section 10 are overstated, and the bars are only checked at 900 s and 1800 s.
Pointers: `prototypes/dotnet-b/reports/3a-tier-difference.md` section 3; `src/sim/testing/hash.ts`; `src/core/types.ts` (`SimStats.weather`); `.../scratchpad/r3-tools/` (r3_cmp.mjs, r3_noise.mjs, r3_driver.sh); plan section 10; artifact table "Results and validation".
Proposed change: replace the 1e-15 evidence with a noise-injection study (more seeds, three tiers, 900 to 10,800 s); set the stage 3 bars as multiples of the measured noise floor at each horizon; report the first snapshot at which the ember set differs; reword the artifact.

**N-2.**
Claim: Microsoft documents that .NET Math functions call the platform C runtime and "may differ between different operating systems or architectures", while V8 12.4 (Node 22) uses its own fdlibm port and V8 15.x (Chrome 150 and later, July 2026) forwards to LLVM libc, so JavaScript also changes across V8 versions; measured mismatch V8 12.4 vs glibc 2.39 per call: exp 9.7 %, pow 9.8 %, atan2 17.6 %, cbrt 47.8 %, sin/cos 3.3 %. The plan tests C# on one Linux x64 container only and compares nothing numerically on the phone; no existing test compares the Node engine with the in-browser engine.
Pointers: https://learn.microsoft.com/dotnet/api/system.math.sin (and exp); https://chromium.googlesource.com/v8/v8/+/refs/heads/main/src/base/ieee754.cc and tag 12.4.254.21; tc39.es ECMA-262 section 21.3.2; Android bionic `libm/Android.bp`; `desktop/engine.test.ts` 139-170; `e2e/robustness.spec.ts` around 360; `src/ui/desktopRestart.ts` 3-4.
Proposed change: a free control first (the fixtures in current Chromium against Node 22 under the bars); route every transcendental through one `FsMath` class so a managed shared implementation can replace libm; a numeric check in stage 4 (phone C#, container C#, phone WebView TypeScript); fix the artifact sentence.

**N-3.**
Claim: The minimum Android API level for .NET MAUI apps targeting .NET 11 is 24 (Android 7.0).
Pointers: Microsoft Learn, "What's new in .NET MAUI for .NET 11".
Proposed change: none.

**N-4.**
Claim: Beyond the plan's three items (float storage with double arithmetic, no FMA, fixed-order reductions), at least eight traps bite: C# float*float is float arithmetic (reproduced: the app's frozen K1 kernel gives checksum 0x7d268009 with double maths and float32 stores, as pinned, but 441721657 with float operations, 26,874 of 40,500 cells differing); `Math.round` rounds halves up but .NET `Math.Round` to even; `Array.Sort` is unstable; typed-array `sort()` puts NaN last while `Array.Sort(float[])` puts NaN first; JS Map keeps insertion order and moves a re-set key to the end; `1 ** NaN` and `(+-1) ** +-Infinity` differ; culture-sensitive string comparison; saturating casts.
Pointers: `.../scratchpad/r7/k1.mjs`; `src/ui/speedTestKernels.ts`; `src/ui/speedTest.test.ts:26`; `src/embers/EmberModel.ts:1208`; `src/atmosphere/base.ts:1002-1003`; `src/sim/simulation.ts:1668`; `src/fire/spread/levelSet.ts` 234, 489, 542; `src/explain/engine.ts:202`; Learn pages for Math.Round, Array.Sort, fp-to-integer conversions.
Proposed change: written porting conventions (double locals when reading float arrays, a JS-style round helper, stable sorts or explicit tie-breaks, NaN-last sort, insertion-ordered maps, ordinal compares) and one test per convention; the K1 checksum as the first C# gate.

**N-5.**
Claim: With a per-run coefficient of variation of 19 to 27 %, the difference of two 30-seed means has a standard error of about 4.9 to 7.0 %: a correct port fails the 12 % bar about 1 to 9 % of the time, and a port with a true 10 % bias passes about 61 to 66 % of the time; the cv itself rests on 6 and 4 runs (95 % interval on the sd about 0.62 to 2.45 times the estimate). The artifact also misdescribes the variation as "run to run" when it is seed to seed.
Pointers: `prototypes/dotnet-b/reports/3a-tier-difference.md` sections 2 and 4; plan section 10; artifact "Results and validation" row.
Proposed change: an equivalence test sized for power (about 57 to 114 runs per side), distribution checks (spot-fire count, ember landing distances, burn-probability map), and "seed to seed" in the artifact.

**N-6.**
Claim: Seed 11 starts no effective spot fire: its burnt area equals the embers-off run, so a gate run on seed 11 does not test the ember code; the 3a report itself recommends seeds 12 and 13, but plan section 3 (stage 3a) still names seed 11.
Pointers: `prototypes/dotnet-b/reports/3a-tier-difference.md`; plan section 3 (3a detail) and section 10.
Proposed change: the tight bar and the thread-count test pass on seeds 12, 13 and 14 at 900 and 1800 s, seed 13 required for the thread-count test.

**N-7.**
Claim: Gate 3 compares only at 900 s and 1800 s on one 3 km scenario at one site and start time, while the app's validation scenarios run 6 h and plan 15e shows results splitting over hours (for example after the wind change in a 4 h Katoomba run).
Pointers: plan section 10 bars; 3a caveats; `README.md` (`SLOW=1 npx vitest run src/sim/validation`, "6 h runs"); 15e Katoomba 4 h figures.
Proposed change: add a 4 h Katoomba 6 km run with the wind change at seeds 12 and 13 and one run on a second site, compared at 1, 2 and 4 h, reporting the time of first divergence per seed.

**N-8.**
Claim: FireSim's simulation draws its random numbers from Math.random(), so the sequence cannot be reproduced in another language.
Pointers: `src/core/rng.ts`, `src/embers/sampling.ts`.
Proposed change: none.

**N-9.**
Claim: The plan's "about 25,000 lines and 15,000 lines of tests" counts only core, fire, embers, atmosphere and sim. The import closure from `src/sim/host.ts` is 37,727 non-test lines in 117 files (adding fuel and moisture, terrain, explain, scenario weather and wind direction, and data types), with about 21,200 test lines, none reusable. Stage 4's page and the existing desktop-host parity tests need rewind/checkpoints, records, insights and explain, which the stage 3 slice omits.
Pointers: `.../scratchpad/r3-tools/r3_closure.mjs`; `src/sim/simulation.ts` 95-115; `e2e/desktop-real.spec.ts` 378-444; `desktop/engine.test.ts` 139-170; plan sections 3 (3b) and 7.
Proposed change: restate the port as about 30,000 to 38,000 lines plus about 21,000 test lines; either scope stage 4 down explicitly (no rewind, explain, insights) or add a stage 3f for checkpoints, records and rewind and price explain.

**N-10.**
Claim: Tier `auto` reads the wall clock to choose the tier at the start of a run, so with more threads (a faster engine) `auto` can pick a different tier; plan rule 4 ("identical results on 1, 2, 4 and 8 threads") therefore holds only with the tier pinned.
Pointers: `src/sim/simulation.ts` around 1182-1190 and 430; plan section 1 rule 4.
Proposed change: restate rule 4 as "bit-identical across thread counts with the tier pinned explicitly".
