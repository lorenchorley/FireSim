# Verifier S, batch N (numerics, gate 3 and the size of the port)

Run notes: I reproduced the noise-injection runs myself with the reviewer's `r3_noise.mjs` preload against the prebuilt 3a exporter bundle, in my own worktree, under `flock /tmp/firesim-heavy.lock`. Each run takes about 2 to 3 s. I wrote my own driver at `.../scratchpad/vN-run.sh` and output to `.../scratchpad/vN-out/`. Nothing in the repository was changed.

N-1. Own answer (before reading the claim): The 1e-15 perturbation does change the doubles. Wind and temperature move by about 4.5 ulp, but the float32 state arrays probably absorb it, so it says little about libm noise. Real 1-ulp libm differences inside the iteration need to be injected to learn anything, and that has to be done at several horizons.
Verdict: PARTLY     Severity: MINOR     Change follows: partly
Evidence checked:
- `katoomba3-fast-seed13` against `...-pert1e-15` at 1800 s, with the reviewer's `r3_cmp.mjs`. The result was "arrays 25 elements 194472 arrays differing 0". The only differing JSON leaves were `stats.weather.temperature` (31.400679617908942 -> ...978), `stats.weather.windSpeed10`, `stats.ffdi` and wall-clock fields. `arrival.f32` is `cmp`-identical.
- `src/sim/testing/hash.ts` hashes every key of the snapshot except `stats.msPerSimMinute` and `engine`. So `stats.weather` and `stats.ffdi`, which echo the input, change the hash. The 3a report's inference "the snapshot hashes change... so the perturbation reached the solver" (`3a-tier-difference.md:95`) is invalid.
- At 900 s the same pair had 1 of 25 arrays differing, with 2 bytes different in `embers.data`. The perturbation therefore does reach the state, but it is almost completely absorbed.
- I re-ran noise injection with the reviewer's `r3_noise.mjs` (`R3_REAL=1`: exp 9.7 %, pow 9.8 %, atan2 17.6 %, cbrt 47.8 % and so on), fast tier, seed 13, noise seeds 1 to 10. Each run is compared with a noise-free run of the same horizon.

| Horizon | Runs that differ in burnt status | Differ % | Max arrival difference | p95 |
|---|---|---|---|---|
| 900 s | 0 of 10 | 0 | 0 | 0 |
| 1800 s | 3 of 10 (noise seeds 2, 8, 10); 5 of 10 had any arrival change | 0.09 and 0.19 | 120 s | at most 0.01 s |
| 3600 s | 5 of 10 (noise seeds 2, 5, 8, 9, 10) | 0.05 to 0.56 | 723 s (noise seed 2) | at most 40 s |

  The 3600 s runs have area changes of -0.05 to -0.46 % and a median arrival difference of at most 0.007 s.
- My counts are 5 of 10 at 3600 s and 3 of 10 at 1800 s, against the reviewer's 6 of 10 and 1 of 10. The ranges (0.05 to 0.56 %, max 723 s) match exactly. The reviewer probably used other noise seeds. Noise seeds 2 and 10 gave identical output, and so did 5 and 9, so the seed mapping is not independent.
- The scenario's `durationS` is 3600. The `--to 10800` runs simply reproduced the 3600 s result, so no horizon beyond 3600 s was tested here.

Notes:
- True: the 1e-15 evidence is weak. The hash-based inference is wrong, and "tested" in the artifact is overstated. Real libm noise does flip a handful of cells, from 0.05 to 0.56 % of ever-burning cells, at 3600 s.
- Overstated: none of those differences breaks the plan's bars (1 % differ, 2 % area, 30 s median, 60 s p95). The worst case is 0.56 %, area -0.46 %, median about 0 and p95 40 s. The 60 s p95 bar is only checked at 900 s and 1800 s in plan section 10.
- The practical conclusion "last-bit math is not the risk" therefore survives. What changes is the wording: "expected difference about 0" should read "about 0.1 to 0.6 % of cells at 3600 s". A multi-seed, multi-tier, 10,800 s noise study is reasonable but is not shown to be necessary. Setting bars as multiples of a measured noise floor is a sound idea. The proposed "first snapshot at which the ember set differs" report is cheap and fine.

N-2. Own answer (before reading the claim): .NET Math calls the platform C runtime, and Microsoft documents that the result may differ across OS and architecture. V8 12.4 has its own fdlibm port. Current V8 appears to have moved to LLVM libc, so JavaScript results also change across engine versions. I expect the plan to do no cross-OS or phone-versus-desktop numeric check.
Verdict: CONFIRMED     Severity: MINOR     Change follows: partly
Evidence checked:
- https://learn.microsoft.com/en-us/dotnet/api/system.math.sin (page updated 2026-10-16, net-11.0 moniker). Remarks: "This method calls into the underlying C runtime, and the exact result or valid input range may differ between different operating systems or architectures."
- V8 tag 12.4.254.21 `src/base/ieee754.cc` implements exp, log, pow, atan2, cbrt, sin and cos itself (fdlibm port). `pow` does not call `std::pow`. sin/cos sit under `#if defined(V8_USE_LIBM_TRIG_FUNCTIONS)` at lines 1351 and 2447.
- V8 `refs/heads/main` `ieee754.cc` (fetched raw via `?format=TEXT`). Line 28 is `#include "third_party/llvm-libc/src/shared/math.h"`, and lines 159 to 231 are `double exp(double x) { return LIBC_NAMESPACE::shared::exp(x); }` and the same for cos, sin, atan2, log, cbrt and pow. I grepped each tag: 13.4, 14.0, 14.5 and 15.0.100.1 have 0 matching lines, and 15.1.1 through 15.9.1 have 15 and 16.0.1 has 18. So the switch landed in V8 15.1 or a 15.0 tag after 15.0.100.1. I did not pin it more exactly. Chromium milestone 150 is V8 15.0, with `late_stable_date` 2026-07-14 per chromiumdash. So "V8 15.x (Chrome 150 and later, July 2026)" is roughly right, and 15.1 or later is safer. This is a source tag fact; I did not check which WebView version ships on any phone.
- I re-ran the reviewer's `r3_gen.mjs` and `r3_cmp_libm.py` (Node v22.22.0, V8 12.4.254.21-node.33, against Python's glibc 2.39). Per-call mismatch: exp 9.67 %, log 0.86 %, sin and cos 3.31 %, pow 9.80 %, atan2 17.63 %, cbrt 47.78 % (max 3 ulp), tan 3.83 %. All match the claim exactly.
- The plan states "Container" as the only run site for stage 3 (section 3 table). Stage 4 on the phone gates on airplane mode and protocol 2, not on numbers. Plan section 3 line 48 and section 10 item 1 say bit-identical hashes with the TypeScript are not expected.
- `desktop/engine.test.ts:139-170` compares `LocalSimController` (in Node) with the Node host plus remote controller. Both are Node. `e2e/robustness.spec.ts` hashes in the page only, and I found no pinned Node value. `src/ui/desktopRestart.ts:3-4` says the two engines cannot hand a running state to each other. My grep was limited to `e2e`, `desktop` and `src`, so "no existing test compares Node with the in-browser engine" is probably true but not exhaustively proven.

Notes: The facts are all correct, including the plan not comparing C# across OSes or the phone against the desktop. Severity is MINOR because N-1 shows the practical size of the effect is below the bars. A managed shared `FsMath` is a heavy fix for a small effect. The cheap parts of the proposal follow: Chromium against Node 22 as a free control, a stage 4 numeric spot check, and fixing the "(tested)" sentence. Note that the app already has this exposure today, because the phone WebView and the Node desktop host use different V8 math.

N-3. Own answer (before reading the claim): API 24 (Android 7.0), because .NET 11 raised MAUI's floor from API 21.
Verdict: CONFIRMED     Severity: NONE     Change follows: yes (no change was proposed)
Evidence checked:
- https://learn.microsoft.com/en-us/dotnet/maui/supported-platforms (updated 2026-09-16), net-maui-11.0 block: "Android 7.0 (API 24) or higher is required." and the note ".NET MAUI apps that target .NET 11 require Android API level 24 or higher". For 9.0 and 10.0 it says API 21.
- The "What's new in .NET MAUI for .NET 11" page has a "Minimum supported Android API" section. I did not read that section; the supported-platforms page is the authority I used.
Notes: Plan stage 5 already lists "Android 7.0 (API 24) floor", so it is consistent.

N-4. Own answer (before reading the claim): The main traps are float*float computed in float, `Math.round` rounding halves up against C#'s default to-even, an unstable `Array.Sort`, NaN placement in sorts, culture-sensitive string comparison, saturating float-to-int casts, and `Math.Pow` edge cases. The plan lists only the first, as "Float32 storage with double arithmetic", plus no FMA and fixed-order reductions.
Verdict: PARTLY     Severity: MINOR     Change follows: yes
Evidence checked:
- `node .../r7/k1.mjs` prints "js checksum 2099675145 float-op checksum 441721657 cells differing 26874 of 40500". 2099675145 is 0x7d268009, the pinned `FROZEN.stencilAfter3` in `src/ui/speedTest.test.ts:26`. The "C#" figure comes from a JavaScript replica that rounds every op with `Math.fround`, not from real C#. That model matches the C# rule that float*float stays float on .NET Core x64 and arm64, so I judge it fair.
- Node checks I ran: `Math.round(2.5)` is 3, `Math.round(-2.5)` is -2, and `Math.round(0.5)` is 1. `Float64Array([3,NaN,1]).sort()` gives `[1,3,NaN]`. `1**NaN` is NaN, `(-1)**Infinity` is NaN, and `Math.pow(1,NaN)` is NaN. `(2**31+5)|0` is -2147483643 (it wraps), and `NaN|0` is 0. `['b','B','a','-x'].sort()` gives `['-x','B','a','b']` (UTF-16 code-unit order). A Map `set` on an existing key keeps its position, and delete then set moves the key to the end.
- Microsoft Learn "Floating point-to-integer conversions are saturating": in .NET 9 and later out-of-range casts saturate and NaN gives 0. JS `|0` wraps modulo 2^32.
- Repository counts, as a measure of how often these bite: 77 `Math.round` and 40 `.sort(` calls in the non-test solver directories, and many `**` uses.
- `src/embers/EmberModel.ts:1208` sorts with `age[a] - age[b] || b - a`, an explicit index tie-break, so it is not an unstable-sort trap. `src/atmosphere/base.ts:1002` sorts indices by `zs` with no tie-break, which is a real trap, since JS sort is stable and `Array.Sort` is not. `src/sim/simulation.ts:1668` does `delete` then `set`, so Map order after delete and re-insert matters. .NET `Dictionary` order after removals is not guaranteed. `src/explain/engine.ts:202` uses a default string `.sort()`, which is a code-unit order, against .NET's culture default. These last three pointers are valid.

Notes:
- Overstated: "at least eight traps bite". Trap 1 (float arithmetic) is the plan's own first item restated, so seven are beyond the plan's list. `1 ** NaN` and the ±1 ** ±Infinity cases are real language differences, but I did not find that the solver reaches them. The Map wording "moves a re-set key to the end" is imprecise: only delete then set moves a key, which is what the code does. `EmberModel.ts:1208` is a counter-example, not a trap.
- True and useful: the sort, NaN-sort, string, cast and rounding differences are real, the plan does not list them, and the K1 float-versus-double number is a strong illustration (66 % of cells differ). Written conventions plus one test each are standard practice, and the proposed change follows.

N-5. Own answer (before reading the claim): The standard error of a difference of two 30-seed means is cv*sqrt(2/30), about 0.26*cv. The bar passes when the mean difference falls in ±12 %.
Verdict: PARTLY     Severity: MINOR     Change follows: partly
Evidence checked:
- My calculation, using the normal approximation:

| cv | Standard error | A correct port fails the 12 % bar | A port with a true 10 % bias passes |
|---|---|---|---|
| 19.0 % | 4.9 % | 1.4 % | 65.8 % |
| 22.4 % | 5.8 % | 3.8 % | 63.5 % |
| 27.1 % | 7.0 % | 8.6 % | 61.2 % |

  These match the claim's ranges of 1 to 9 % and 61 to 66 %.
- `3a-results.json` `seedEnsembles`: the fast tier has 6 seeds with cv 19.0 %; standard has 4 seeds with cv 22.4 %; high30 has 4 seeds with cv 27.05 %. The 6 and 4 runs are correct. For n=6 the sd interval factors are sqrt(5/12.83)=0.62 to sqrt(5/0.831)=2.45, which matches.
- Power: 10 % bias at 80 % power needs a standard error of about 3.6 %, so n = 2*(cv/3.57)^2, which is 57 for cv 19 and 114 for cv 27. This matches.
- The artifact text is "results differ run to run by 20 to 50 % of burning cells". The TypeScript solver is deterministic for a given seed, so the 20 to 50 % is seed to seed. "Run to run" is loose, not false: it describes runs with a different random stream.

Notes:
- The arithmetic is right. Three caveats: burnt area is skewed and heavy-tailed, so the normal approximation is rough. The cv rests on 4 to 6 runs. And the bar only applies if the random stream cannot be ported exactly.
- N-8 shows the stream is mulberry32, so the exact port is easy (unsigned 32-bit integer ops). The loose 12 % bar is then a fallback that probably never applies, which lowers the severity. The power-sizing and distribution-check suggestions are sound for that fallback only. "Seed to seed" in the artifact is a fair wording fix.

N-6. Own answer (before reading the claim): Seed 11 on the fast tier gives the same burnt area as the embers-off run, so the ember-to-ignition feedback is not exercised in the raster. Ember emission and transport may still run.
Verdict: PARTLY     Severity: MINOR     Change follows: partly
Evidence checked:
- `3a-results.json` study rows at 1800 s: `katoomba3-fast-noembers` against `katoomba3-fast` (seed 11) gives differPct 0 and area 0, with 630 burnt cells in both. The seed summary has fast 56.7 ha at seed 11 against 56.7 ha embers-off.
- This holds for the fast tier only. In the standard tier seed 11 gives 84.5 ha against 66.4 ha embers-off, so the claim must be read for the fast fixtures the plan uses.
- Snapshot at 1800 s via `inspect.mjs`: seed 11 fast has `snapshot.embers.count: 572` (embers in flight) and 2 spot-fire entries. The embers-off run has `embers.count: 0` and the same 2 spot-fire entries (they look like a short-range, non-option-gated mechanism; this is my inference). Seed 13 has 688 embers and 6 spot fires.
- Plan section 10 item 2 already says: "Seed 11 starts no effective spot fire, so it equals the no-embers run; seeds 12 and 13 exercise the ember code." The 3a-tier-difference report also says to use seed 13 or 12 (line 123). The plan names seed 11 only for the 3a fixture (section 3, 3a detail). Section 10 does not name a Gate 3 seed.

Notes:
- Overstated: seed 11 does run the ember code (572 embers alive). What it cannot detect is an error in whether an ember lights a spot fire that changes the arrival raster. A bit-identical thread-count hash on seed 11 would still cover the embers arrays, because the hash includes `embers.data`.
- The substance is right for the raster bars, and the plan has not stated which seeds Gate 3 uses. The proposal of seeds 12, 13 and 14 with seed 13 for the thread-count test follows. Naming seeds in the plan is a one-line fix.

N-7. Own answer (before reading the claim): Gate 3 compares only at 900 s and 1800 s on a Katoomba 3 km fast-tier scenario with one start time. The app and the validation suite run for hours.
Verdict: PARTLY     Severity: MAJOR     Change follows: partly
Evidence checked:
- Plan section 10: "same tier, same seed, 900 s and 1800 s". Section 3, 3a detail: Katoomba 3 km, fast tier, seed 11, one 310 m ignition line, to 1,800 s. `3a-tier-difference.md:126` caveat: "One scenario, one site, one start time ... 30 min of fire".
- `README.md:1173-1174`: `SLOW=1 npx vitest run src/sim/validation` "include the long §15 scenarios (night, 6 h runs)". `docs/plans/air-slice-wind-detail-honest-speed.md:1016`: Katoomba 4 h burnt area at 30, 20, 15 and 10 m is 2,483, 2,964, 2,716 and 2,738 ha with embers on, and 1,002, 1,881, 1,860 and 1,520 ha with embers off, "the split appears after the wind change".
- The scenario's `durationS` is 3600, so the 3a fixtures stop there. My noise runs to 3600 s gave at most 0.56 % differing cells.

Notes:
- True: the gate window is 30 minutes of a 3 km window, and the app runs hours. The coverage argument is the strongest one: nothing in the first 30 minutes exercises a wind change, so the slice's wind-direction and edit code is never compared.
- Overstated: the 15e Katoomba split is between grid resolutions and ember caps, not noise growing over time in one model. It shows the fire is sensitive to model settings, not that last-bit noise grows. I did not test noise growth past 3600 s.
- The reviewer's extra 4 h run at seeds 12 and 13 plus a second site is a reasonable scope addition. "Time of first divergence per seed" is a useful report. The evidence cited does not by itself justify it, so the change follows partly.

N-8. Own answer (before reading the claim): FireSim uses a seeded mulberry32 generator, not `Math.random`, and the integer stream can be reproduced exactly elsewhere.
Verdict: REFUTED     Severity: NONE     Change follows: n/a (no change was proposed; but the claim is false)
Evidence checked:
- `src/core/rng.ts:1-4`: "Small, fast, seedable PRNG (mulberry32) so simulations are reproducible: the same scenario + seed gives the same embers and spot fires". `next()` is `(s + 0x6d2b79f5) >>> 0`, `Math.imul`, xor-shifts, then `/ 4294967296`.
- `src/embers/sampling.ts:4,15`: `FastRng` is "the same mulberry32 stream as core/rng Rng.next()". Simulation seeds are `new Rng(so.seed)`, `so.seed + 1`, `+ 2` and `+ 3` (`src/sim/simulation.ts:~431`).
- `grep Math.random` in `src/sim`, `src/embers`, `src/fire`, `src/atmosphere` and `src/core` (non-test) returned nothing. `Math.random` appears only in render, UI and speed-test files.

Notes: The 32-bit integer stream ports exactly with unsigned 32-bit multiply and xor. Derived values (`normal()` and `poisson()` use `Math.log`, `Math.cos`, `Math.sin` and `Math.exp`) depend on libm last bits (see N-1 and N-2). So the draws are reproducible, and results differ only through libm. Plan section 10's decision "port the generator and draw order exactly" is feasible. The claim is the opposite of the code. It also undermines the N-5 fallback scenario.

N-9. Own answer (before reading the claim): The closure from `src/sim/host.ts` over non-test, non-type imports is far above 25,000 lines because `simulation.ts` imports explain, fuel, terrain and scenario code. Stage 4's page uses rewind, edits and explain.
Verdict: CONFIRMED     Severity: MAJOR     Change follows: yes
Evidence checked:
- I ran the reviewer's `r3_closure.mjs src src/sim/host.ts`: "TOTAL 37727 files 117". It resolves relative imports, skips `import type`, and counts raw lines including blank and comment lines. Biggest areas: fire/spread 3,777; EmberModel 2,272; fuel/moisture 2,269; sim/simulation.ts 2,214; explain/rules 2,071 and explain overall about 7,000.
- `wc -l` of non-test files in core, fire, embers, atmosphere and sim is 3,737 + 6,729 + 4,028 + 6,260 + 5,022 = 25,776. Their test files sum to 14,098. That matches the plan's "about 25,000 and 15,000" (section 7, line 93), so the plan counted those five directories (my inference from the match).
- Test lines of the closure's directories: the five above 14,098 plus fuel 3,658, terrain 1,112 and explain 2,314 gives about 21,180. This matches "about 21,200". I did not check whether those tests are reusable. Tests are TypeScript Vitest, so no direct reuse in C# is a fair statement.
- `src/sim/simulation.ts:95-115` imports `../explain` (`InsightEngine`), `../fuel`, `../fuel/moisture`, `../scenario/weather`, `../scenario/windDirection`, `../terrain`, and records/stats.
- `src/sim/protocol.ts:17-55`: protocol messages include `explain`, `rewind`, `edit`, `removeEdit`, `ignite`, `removeIgnition`, `setOption`, `setQuality`, and `ready` carries `forecastInsights`. `e2e/desktop-real.spec.ts:~378-400` ignites and sets a wind change mid-run: "marking in the past rewinds the host's run to a checkpoint and replays". `desktop/engine.test.ts:139-170` asserts a `rewound` event, insights and explanation equality.
- Plan stage 3 slice (3b) lists: decode the start message, grid and spread step, fuel and moisture, embers, and atmosphere optional. It does not list rewind or checkpoints, records, insights or explain.

Notes:
- Caveats: raw line counts include comments and blank lines, so they are only a rough proxy. A regex closure over-approximates when a module is imported for one function. For example `scenario/openMeteo.ts` (597 lines) probably does not need a port. So "30,000 to 38,000" is a sensible range, and 37,727 is an upper bound.
- True: the plan's 25,000 is low by about a third, and stage 4's "page needs no change" does require rewind, edits, insights and explain. Either scoping stage 4 down or adding a checkpoint/records/rewind stage follows.

N-10. Own answer (before reading the claim): `auto` times the first spin-up steps on the wall clock to decide between the standard and fast tiers, so a faster engine can pick a different tier. Rule 4 therefore holds only with the tier pinned.
Verdict: CONFIRMED     Severity: MINOR     Change follows: yes
Evidence checked:
- `src/sim/simulation.ts:1182-1190`: "Auto-tune ... from the wall times of the first `autoTuneSteps` standard spin-up steps ... The one decision that reads the wall clock; it is taken once, here". Line 429: `this.tierReq = o.tier ?? so.tier ?? 'auto'`, and line 430 builds standard when `auto`. Line 36 of the same file says wall time is used "only for the auto-tune decision at init".
- `e2e/robustness.spec.ts:395`: "the tier choice of 'auto' depends on how fast this machine is; fast is the same everywhere". The repo already knows this.
- Plan section 1 rule 4: "Results never depend on speed. The C# solver must give identical results on 1, 2, 4 and 8 threads ... a hard requirement". The 3a fixtures and the stage 3 test use the fast tier explicitly (section 3, 3a detail), so in practice the test is pinned.

Notes: The wording gap is real but small, since the prototype's test is on a pinned fast tier and the slice probably will not port auto-tune. Restating rule 4 as "bit-identical across thread counts with the tier pinned" costs nothing. If the C# product ever ships `auto`, the thread count would change the tier by design (as it does today for the TypeScript).

## Summary table

| ID | Verdict | Severity |
|---|---|---|
| N-1 | PARTLY | MINOR |
| N-2 | CONFIRMED | MINOR |
| N-3 | CONFIRMED | NONE |
| N-4 | PARTLY | MINOR |
| N-5 | PARTLY | MINOR |
| N-6 | PARTLY | MINOR |
| N-7 | PARTLY | MAJOR |
| N-8 | REFUTED | NONE |
| N-9 | CONFIRMED | MAJOR |
| N-10 | CONFIRMED | MINOR |

## Sources used
- `docs/plans/dotnet-option-b-prototype.md` (all), `prototypes/dotnet-b/reports/3a-tier-difference.md`, `3a-results.json`, `prototypes/dotnet-b/ts-export/README.md`.
- Repository files: `src/core/rng.ts`, `src/embers/sampling.ts`, `src/embers/EmberModel.ts:1208`, `src/atmosphere/base.ts:1002`, `src/sim/simulation.ts` (95-115, 420-440, 1182-1190, 1668), `src/sim/testing/hash.ts`, `src/sim/protocol.ts`, `src/ui/speedTest.test.ts`, `desktop/engine.test.ts`, `e2e/desktop-real.spec.ts`, `e2e/robustness.spec.ts`, `README.md` (1173-1174), `docs/plans/air-slice-wind-detail-honest-speed.md` (1016), `src/ui/desktopRestart.ts`.
- Fixtures in `.../scratchpad/dotnet-fixtures/` (seed 13 fast and its 1e-15 perturbation, seed 11 and embers-off, `inspect.mjs`). Reviewer helpers run: `r3-tools/r3_cmp.mjs`, `r3_noise.mjs`, `r3_diff.mjs`, `r3_gen.mjs`, `r3_cmp_libm.py`, `r3_closure.mjs`, and `r7/k1.mjs`. My own driver `.../scratchpad/vN-run.sh`.
- https://learn.microsoft.com/en-us/dotnet/maui/supported-platforms (updated 2026-09-16)
- https://learn.microsoft.com/en-us/dotnet/api/system.math.sin (updated 2026-10-16)
- https://learn.microsoft.com/en-us/dotnet/core/compatibility/jit/9.0/fp-to-integer (updated 2026-09-14)
- https://chromium.googlesource.com/v8/v8/+/refs/heads/main/src/base/ieee754.cc, and tags 12.4.254.21, 13.4.114.21, 14.0.365.4, 14.5.201.9, 15.0.100.1 and 15.1.1 to 16.0.1 (same file, fetched raw)
- https://chromiumdash.appspot.com/fetch_milestone_schedule?mstone=150 and `fetch_milestones` (read 2026-11-12)
