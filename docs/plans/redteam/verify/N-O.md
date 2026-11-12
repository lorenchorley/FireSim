# Batch N, verifier O (2026-11-12)

Process note: the batch file shows Part 1 and Part 2 together, so I saw the claims when I opened it. Each "own answer" below comes from my own checks (fixture comparisons, re-runs and primary sources), and I did those checks before I judged the claim. Plan line numbers refer to `docs/plans/dotnet-option-b-prototype.md` in worktree agent-a7a4c695305c96b9b (HEAD 05795ff). All runs were small, each held `flock /tmp/firesim-heavy.lock`, and every temporary output was deleted afterwards.

---

N-1. Own answer (before reading the claim): The 1e-15 perturbation barely reached the solver. Base and pert1e-15 fixtures have bit-identical fire, atmosphere and moisture arrays in all 31 snapshots. The only typed-array difference is `snapshot.embers.data`: 1 or 2 of about 4,000 to 5,000 floats, in 2 to 5 snapshots, and only in the fast runs with embers on (seeds 11, 13, 14). The hash changes at every time only because it includes `stats.weather` and `stats.ffdi`, which echo the input. With per-call ±1 ulp noise at the measured V8-versus-glibc rates, fast seed 13 gives: 900 s, 10 of 10 identical; 1800 s, the same burnt status in 7 of 10 (4 bit-identical), 3 runs flipping 0.09 to 0.19 % of cells with max |dt| 120 s; 3600 s, 6 of 10 flipping 0.05 to 0.56 % with max |dt| 723 s and 7 against 6 spot fires. Fast seed 12 (6 noise seeds, to 3600 s) and standard seed 12 (5 noise seeds, 1800 s) flipped no cells.
Verdict: PARTLY     Severity: MINOR     Change follows: partly
Evidence checked:
- An inline node comparer decodes every snap-*.bin and compares typed arrays element by element:
  - katoomba3-fast vs -pert1e-15: "arrays: snap-420 embers.data 1/4120 max|d|=5.96e-8; snap-840 embers.data 1/4448; scalars: stats.weather.temperature, stats.weather.windSpeed10, stats.ffdi".
  - seed14: embers.data in 5 snapshots, max |d| 2.29e-5.
  - standard, standard-seed12, high-noembers, standard-noembers, fast-noembers at 1e-15: "arrays: none".
  - fast-noembers at 1e-12: atmosphere u/v/w differ in every snapshot, so 1e-12 did reach the state.
- determinism-a and -b against katoomba3-fast: "arrays differing: none", so the embers.data differences are real and not run-to-run noise.
- `src/sim/testing/hash.ts:31` hashes the whole snapshot and skips only `stats.msPerSimMinute` and `engine`.
- `src/core/types.ts:951,953`: `weather: WeatherHour; ... ffdi: number`.
- Re-run of `r3_noise.mjs` (R3_REAL=1, noise seeds 1 to 10) with the exporter bundle from worktree agent-a9f3f1dc95c9548c9:
  - Sanity check: R3_P=0 to 1800 s gives an arrival.f32 byte-equal to the fixture.
  - A run to 1800 s and the 1800 s snapshot of a run to 3600 s are equal for every noise seed.
- 3a report line 95: "(The snapshot hashes change at every time in every perturbed run, so the perturbation reached the solver ...)".
- Plan line 126: "(same tier, same seed, 900 s and 1800 s)".
- Artifact: "Last-bit math differences between JavaScript and .NET turned out not to matter (tested)."
Notes:
- The 3600 s numbers reproduce exactly (6 of 10; 0.05 to 0.56 %; 723 s).
- "At 1800 s 9 of 10 runs were identical" did not reproduce with noise seeds 1 to 10. I got 7 of 10 with the same burnt status and 4 of 10 bit-identical. The claim therefore understates the 1800 s effect, which supports its point.
- "Every typed array was byte-identical" is slightly wrong: embers.data moved. Calling the evidence "vacuous" is fair for fire and air, but not literally true.
- Severity is modest because realistic libm noise stays well inside the tight bars:
  - 1800 s: at most 0.19 % differ (bar 1 %), area within 0.19 % (bar 2 %), median 0 s.
  - 3600 s: at most 0.56 % differ, area within 0.46 %, median under 0.01 s, p95 at most 40 s (bar 60 s).
- So the plan's ranking (the random stream matters more than libm) survives. Still, "(tested)", "no ember decision flipped" and "expected about 0" are overstated: libm noise does flip ember outcomes, and the effect grows with time.
- What follows from the evidence: reword the artifact, and add a cheap noise-injection control at each gate horizon. Bars "as multiples of the noise floor" and runs to 10,800 s go further than this evidence requires, unless the horizons are extended (N-7).

N-2. Own answer: No.
- .NET: Learn (Math.Sin and Math.Exp, net-11.0) says: "This method calls into the underlying C runtime, and the exact result or valid input range may differ between different operating systems or architectures."
- Node 22: V8 12.4.254.21 (Node 22.22.0) defines its own fdlibm-derived exp, sin, cos and so on in `src/base/ieee754.cc`. Branch 14.9 still does.
- Current Chrome/WebView: V8 branch 15.0 and main `#include "third_party/llvm-libc/src/shared/math.h"` and forward exp, log, sin, cos, atan2, cbrt and pow to `LIBC_NAMESPACE::shared`. Chrome 150 (V8 15.0) reached stable on 2026-06-30.
- Measured V8 12.4 against glibc 2.39, 200k inputs per function:
  - exp 9.62 %, log 0.87 %, sin 3.30 %, cos 3.33 %, pow 9.83 %, atan2 17.96 %: each at most 1 ulp.
  - cbrt 47.6 %, at most 3 ulp.
  - sqrt 0 %.
- Phone: bionic takes sin, cos, atan2 and cbrt from FreeBSD msun and exp, log and pow from arm-optimized-routines. Phone C# and container C# can therefore differ.
- The plan runs stage 3 in the "Container" only (line 36). Stage 4 on the phone checks crash, cadence and memory, but no numbers (line 51).
- Existing tests: `desktop/engine.test.ts:138-170` compares in-thread with the host, both in Node; `e2e/robustness.spec.ts:360ff` and `e2e/speed-test.spec.ts` compare a page with a page. Neither compares Node with the in-browser engine.
Verdict: CONFIRMED     Severity: MINOR     Change follows: partly
Evidence checked:
- Learn Math.Sin and Math.Exp (updated 2026-10-16), Remarks quoted above.
- chromium.googlesource.com v8 `src/base/ieee754.cc` at tag 12.4.254.21 (fdlibm, `#if defined(V8_USE_LIBM_TRIG_FUNCTIONS)` for sin/cos), at branch-heads/14.9 (fdlibm) and at branch-heads/15.0 and main (llvm-libc).
- My own node-to-python pipe measurement (numbers above). `node -e` reports v22.22.0, V8 12.4.254.21-node.33; ldd reports glibc 2.39.
- bionic `libm/Android.bp` (main).
- developer.chrome.com release notes 150 (stable 2026-06-30).
Notes:
- All the factual parts check out. "Chrome 150, July 2026" should say 30 June 2026.
- The mismatch rates hold for synthetic uniform input ranges, not for the solver's own arguments.
- Inference: the app already lives with this. The Node 22 desktop host (fdlibm) and a Chrome 150+ WebView (llvm-libc) differ in the last bits today, and "Continue on this device" is a restart, not a hand-off (`src/ui/desktopRestart.ts:3-4`).
- Impact on the gates is bounded by the N-1 data: libm-sized noise stays inside the bars at 1800 s and 3600 s.
- The free Chromium-against-Node control and a phone numeric check in stage 4 follow from the evidence. A single `FsMath` routing point is a cheap convention.
- "A managed shared implementation can replace libm" is a design option whose cost was not shown. Inference: LLVM libc's correctly rounded double functions would let C# match V8 15+, but not Node 22.

N-3. Own answer: API 24 (Android 7.0).
- Learn, "What's new in .NET MAUI for .NET 11" (ms.date 2026-09-10): "Starting in .NET 11 Preview 3, the minimum supported Android API level has been raised from 21 (Lollipop) to 24 (Nougat). This means that .NET MAUI apps in .NET 11 require Android 7.0 or higher."
- The local SDK agrees: `packs/Microsoft.Android.Sdk.Linux/37.2.31/targets/Microsoft.Android.Sdk.SupportedPlatforms.targets:13` sets `AndroidMinimumSupportedApiLevel ... 24`. The .NET 10 pack 36.1.118 sets 21.
Verdict: CONFIRMED     Severity: NONE     Change follows: yes
Evidence checked: the Learn page above; a grep of the SDK packs (two files, values 24 and 21).
Notes: the plan already says "Android 7.0 (API 24) floor" (line 53).

N-4. Own answer: By default, C# differs from the JavaScript the solver relies on in these ways:
- `float*float` is single-precision arithmetic.
- `Math.Round` rounds halves to even, where JS `Math.round` rounds them up: JS gives 3 for 2.5 and -2 for -2.5.
- `Array.Sort` is unstable. Learn: "This implementation performs an unstable sort".
- `Array.Sort(float[])` orders NaN first (CompareTo makes NaN least). JS `Float32Array.sort()` orders NaN last: `[-0,0,1,3,NaN]`.
- `Dictionary` enumeration order is undefined. A JS Map keeps insertion order: `set` on an existing key keeps its place, while delete then set moves the key to the end.
- JS `1**NaN`, `(-1)**Infinity` and `1**Infinity` are NaN. IEEE `Math.Pow` returns 1.
- JS default sort compares UTF-16 code units: "B,Z,_x,a,b". C# default string comparison is culture-sensitive.
- Float-to-int conversion: JS `|0` wraps out-of-range values ((2^31+5)|0 = -2147483643). .NET 9+ saturates. NaN gives 0 in both.

The plan's list (line 49) is "Float32 storage with double arithmetic, no fused multiply-add contraction, and reductions in a fixed order". It covers the first item and none of the others. Places in the solver that depend on these:
- `atmosphere/base.ts:1002` sorts by height with no tie-break, so it relies on a stable sort.
- `sim/simulation.ts:1668-1669` uses delete then set to move a key to the end.
- `explain/engine.ts:202` uses the default string `sort()`.
- `fire/terrainFeatures.ts:455-457` and many grid indexers use `Math.round`, and exact halves are possible where grids are offset by half a cell.
- `atmosphere/grid.ts:353` and `fire/terrainFeatures.ts:476` sort typed arrays, which matters only if NaN is present.
Verdict: PARTLY     Severity: MAJOR     Change follows: yes
Evidence checked:
- `node k1.mjs`: "js checksum 2099675145 [= 0x7d268009, the pinned value in `src/ui/speedTest.test.ts:26`] float-op checksum 441721657 cells differing 26874 of 40500".
- `k1.mjs` faithfully replicates `src/ui/speedTestKernels.ts:58-96`.
- The source lines listed above.
- A JS semantics check with `node -e` (outputs quoted above).
- Learn Array.Sort ("unstable sort") and Learn "Floating point-to-integer conversions are saturating" (.NET 9; in .NET 11 extended to small types on CoreCLR and NativeAOT but not Mono).
Notes:
- The first "trap" is not beyond the plan's list. It is the plan's own item 1, which K1 shows matters (a good first C# gate).
- "Moves a re-set key to the end" is imprecise: plain `set` does not move a key, only delete then set does, and that is what `simulation.ts` does.
- Three of the eight differences (NaN sort order, `**` edge cases, saturation) are real, but I found no solver path where they would change a result. "Bite" is shown for about four of them.
- Rated MAJOR for this reason: the plan's fallback (line 134) moves to the loose ensemble bar if "the generator cannot be reproduced bit for bit". A sort, Map or round mismatch in ember or records code would change the draw order, so a fixable porting bug could push Gate 3 onto the weak bar. Written conventions with one test each (and K1 first) prevent this cheaply.

N-5. Own answer:
- The two 30-seed means are independent, so their difference has SE = cv·√(2/30) = 4.91 % (cv 19.0), 5.78 % (cv 22.4) or 7.00 % (cv 27.1).
- A correct port fails the 12 % bar 1.4 %, 3.8 % or 8.6 % of the time, respectively.
- A port with a true 10 % bias passes 65.8 %, 63.5 % or 61.2 % of the time. One with a true 20 % bias passes about 5 % (cv 19) to 13 % (cv 27).
- A 95 % chi-square interval on an sd from 6 runs is 0.62 to 2.45 times the estimate. From 4 runs it is 0.57 to 3.73 times.
- TOST with a 12 % margin and α = 0.05 needs about 43 to 87 runs per side for 80 % power, or 54 to 110 for 90 %.
- The variation is seed to seed: the same seed is deterministic (3a-reference, determinism check), and the app's default seed is fixed (`src/core/types.ts:672 seed: 1`).
Verdict: PARTLY     Severity: MINOR     Change follows: partly
Evidence checked:
- A python NormalDist computation (output: "cv 0.190: SE diff 4.91% correct port fails 1.4% 10% bias passes 65.8% ... cv 0.271: SE diff 7.00% ... fails 8.6% ... passes 61.2%").
- 3a-tier-difference.md:72-74 (cv 19.0, 22.4, 27.1 on 6, 4 and 4 seeds) and :116 ("standard error of about 6 %").
- Artifact: "results differ run to run by 20 to 50 % of burning cells".
Notes:
- All the arithmetic is right, and "run to run" should read "seed to seed".
- The claim is overstated in one respect. A true 10 % bias lies inside the 12 % equivalence margin, so passing it 61 to 66 % of the time is not, by itself, a failure of the bar. The real weaknesses are the noisy false-fail rate and the wide margin.
- The interval 0.62 to 2.45 fits the 6-run fast tier only. The 4-run tiers are wider.
- This bar is only the fallback (plan line 134), hence MINOR.
- What follows: distribution checks and the wording fix. An equivalence test sized for power fits the claim's 57 to 114 per side only roughly; my range is 43 to 110, depending on the chosen power.

N-6. Own answer: For the arrival-based bars, no. Seed 11's arrival.f32 at 1800 s is byte-identical to the embers-off run (`cmp` succeeds; differ 0, 630 against 630 cells). The ember code does run (572 active embers at 1800 s), but it lights nothing that matters. Its 2 "spot fires" also appear in the embers-off run, so they are not ember spot fires. Seeds 12 and 13 have 3 and 6 spot fires, 2 and 6 of them already by 900 s.
Verdict: PARTLY     Severity: MINOR     Change follows: yes
Evidence checked:
- `inspect.mjs` on snap-1800 and snap-900 of katoomba3-fast, -noembers, -seed12 and -seed13 (stats.spotFires 2/2/3/6; activeEmbers 572/0/587/688).
- `r3_diff.mjs` noembers against fast: `{"differPct":0,...,"cellsArrivalChanged":0}`.
- Plan line 45 ("seed 11") and line 122: "Seed 11 starts no effective spot fire, so it equals the no-embers run; seeds 12 and 13 exercise the ember code."
Notes:
- The facts are right. The plan already states the finding (line 122) and the 3a report recommends seed 13 or 12 (line 123). But the Gate 3 bars (line 126, "same tier, same seed") name no seed, and the 3a description of the fixtures (line 45) still says seed 11. The plan therefore partly handles this and does not bind the gate.
- "Does not test the ember code" holds for arrival rasters. Transport and draw order do run, and they would show in a hash or embers.data comparison.
- Running the thread-count test on seed 13 is sensible: ember-order effects only show where spot fires matter.

N-7. Own answer:
- Gate 3 compares at 900 s and 1800 s (plan line 126) on the 3a scenario only: Katoomba demo site, 3 km, start 2025-12-20 12:00, one 310 m line (3a caveat line 126: "One scenario, one site, one start time ... 30 min of fire").
- Users' runs default to 6 h (`src/ui/setupModel.ts:115 durationH: 6`; choices 1, 2, 3, 6, 9, 12 h at line 361).
- The validation suite's scenarios run 1 h to 14 h, several of them 6 h (`spread.test.ts:29,98`, `slope.test.ts:30`, `slope.test.ts:193` 14 h). README:1174: "SLOW=1 npx vitest run src/sim/validation # include the long §15 scenarios (night, 6 h runs)".
- So a 30-minute window never exercises wind changes, night or long ember chains.
Verdict: CONFIRMED     Severity: MAJOR     Change follows: yes
Evidence checked:
- The files and lines above.
- Plan 15e (`docs/plans/air-slice-wind-detail-honest-speed.md:1011,1016`): "Katoomba, 4 h ... 1,002, 1,881, 1,860 and 1,520 ha with embers off (the split appears after the wind change)".
- My N-1 runs: libm-sized noise gives 0 % at 900 s, at most 0.19 % at 1800 s and at most 0.56 % at 3600 s, with an extra spot fire by 2700 s.
Notes:
- One nuance: the 15e Katoomba split compares grid resolutions (30, 20, 15, 10 m), not repeat runs or engines. It shows that the wind-change regime separates results; it does not measure implementation noise.
- "Validation scenarios run 6 h" should be "1 to 14 h, many of them 6 h".
- The core point stands: the gate horizon is 1/12 of the default run and misses whole code paths.
- The proposed 4 h, 6 km run with the wind change is cheap on the TypeScript side (a 6 km fast run to 1800 s takes about 1.8 s), but it widens the C# slice to cover the wind-change path.

N-8. Own answer: The simulation does not use `Math.random`. It uses a seeded mulberry32 generator (`src/core/rng.ts:2-15`, `Rng`; `src/embers/sampling.ts:17-25`, `FastRng`, "mulberry32 identical to `Rng.next()`"), seeded from `so.seed` (+1, +2, +3 per stream; `simulation.ts:434-437`). It uses only `Math.imul`, xor, shifts and `>>> 0`, so C# can reproduce it bit for bit with `uint` arithmetic. `Math.random` appears only in UI element ids (`ui/screens/sim/timePopover.ts:41`, `speedControl.ts:59`, `datasets.ts:153`).
Verdict: REFUTED     Severity: NONE     Change follows: yes (no change is needed; the claim itself is false)
Evidence checked: `src/core/rng.ts` in full; `src/embers/sampling.ts:1-101`; `grep -rn "Math.random" src` (UI only).
Notes:
- One real caveat goes the other way. The derived variates use libm: Box-Muller uses `Math.log` and `Math.cos`/`sin`, and Poisson uses `Math.exp(-mean)` (`rng.ts:27-45`, `sampling.ts:42-51`). They can differ by an ulp between engines (N-2), and a Poisson count could in principle change the number of draws.
- The 4096-entry inverse-normal table (`sampling.ts:87`) can be shipped as data.

N-9. Own answer:
- The import closure from `src/sim/host.ts` is 117 files and 37,727 non-test lines with value imports (118 files and 37,810 lines if type-only imports are included). By lines:
  - fire 6,583; explain 6,551; atmosphere 5,986
  - fuel 4,698; embers 3,697; sim 3,616; core 3,425
  - terrain 1,699; scenario 1,389; data 83
- The plan's "about 25,000 and 15,000 tests" matches the five directories core, fire, embers, atmosphere and sim: 26,005 non-test and 14,098 test lines.
- Test lines that "go with" the closure depend on the definition: 10,686 (tests with the same base name as a closure file), 26,669 (all tests in the closure's directories) or 28,878 (all tests in the ten top-level folders).
- Stage 4 needs more than the slice:
  - Protocol 2 has `rewind`, `rewound`, `explain`, `edit`, `removeEdit`, `removeIgnition`, `setOption` and `setQuality` (`src/sim/protocol.ts`).
  - `e2e/desktop-real.spec.ts:378-446` marks a fire and a wind direction in the past: "marking in the past rewinds the host's run to a checkpoint and replays".
  - `desktop/engine.test.ts:156-166` requires equal rewound events, insights and "Why here?" explanations.
  - The stage 3 slice (line 46) is decode, grid and spread, fuel and moisture, embers.
Verdict: CONFIRMED     Severity: BLOCKER (stage 4 only; gates 1 to 3 are unaffected)     Change follows: yes
Evidence checked:
- My own closure walker (inline node; same result as `r3_closure.mjs`'s method).
- Line counts by `find ... | xargs cat | wc -l`.
- `src/sim/simulation.ts:95-115` (imports InsightEngine, records, windDirection, scenario/weather).
- The e2e and engine test lines above.
- Plan lines 46, 51 and 93.
Notes:
- 37,727 lines and 117 files reproduce exactly.
- "About 21,200 test lines" sits inside my definition-dependent range (10.7k to 28.9k), but I cannot reproduce that exact number.
- "None reusable" is overstated: the Vitest code does not carry over, but the scenarios and expected values do, as golden data.
- Stage 4 as written ("protocol 2 met", "page needs no change", a variant of desktop-real.spec) would fail by construction on the stage 3 slice, because no agent ports rewind, records, explain or insights (plan lines 59-72). It must be scoped down or given a porting stage.
- The cost line in section 7 is understated by about 50 %.

N-10. Own answer: No.
- In `auto`, the tier is chosen once, from the wall-clock times of the standard spin-up steps (`src/sim/simulation.ts:1182-1199`, `autoTuneDecide`: "The one decision that reads the wall clock"; `:429-430`: `tierReq = ... 'auto'`, built as standard).
- A faster engine (more threads) can keep the standard tier where a slower one switches to fast.
- Rule 4 ("Results never depend on speed ... identical results on 1, 2, 4 and 8 threads", plan line 12) therefore holds only with the tier pinned, or with the auto decision recorded and replayed.
Verdict: CONFIRMED     Severity: MINOR     Change follows: yes
Evidence checked: `simulation.ts:420-437` and `:1180-1199` (quoted above); plan line 12.
Notes:
- The stage 3 fixtures and bars already use explicit tiers (fast, standard, high, high30), so the thread-count test in practice runs pinned.
- The defect is in how rule 4 is worded, not in the gate. The TypeScript has the same property by design.

---

## Summary

| ID | Verdict | Severity |
|---|---|---|
| N-1 | PARTLY | MINOR |
| N-2 | CONFIRMED | MINOR |
| N-3 | CONFIRMED | NONE |
| N-4 | PARTLY | MAJOR |
| N-5 | PARTLY | MINOR |
| N-6 | PARTLY | MINOR |
| N-7 | CONFIRMED | MAJOR |
| N-8 | REFUTED | NONE |
| N-9 | CONFIRMED | BLOCKER (stage 4 only) |
| N-10 | CONFIRMED | MINOR |

## Sources used
- Repository (worktree agent-a7a4c695305c96b9b):
  - `docs/plans/dotnet-option-b-prototype.md` (lines 12, 36, 45-53, 59-72, 93, 122-134)
  - `prototypes/dotnet-b/reports/3a-tier-difference.md`, `3a-reference.md`; `prototypes/dotnet-b/ts-export/{export.ts,inspect.mjs,run.mjs}`
  - `src/sim/testing/hash.ts`, `src/core/types.ts`, `src/core/rng.ts`, `src/embers/sampling.ts`, `src/embers/EmberModel.ts`, `src/atmosphere/base.ts`, `src/atmosphere/grid.ts`, `src/fire/terrainFeatures.ts`, `src/fire/spread/levelSet.ts`, `src/explain/engine.ts`, `src/sim/simulation.ts`, `src/sim/protocol.ts`, `src/ui/setupModel.ts`, `src/ui/speedTestKernels.ts`, `src/ui/speedTest.test.ts`, `src/sim/validation/*.test.ts`
  - `README.md:1173-1174`, `desktop/engine.test.ts`, `e2e/desktop-real.spec.ts`, `e2e/robustness.spec.ts`, `docs/plans/air-slice-wind-detail-honest-speed.md:1011-1016`
- Artifact text: `.../scratchpad/firesim-dotnet.html` ("Results and validation" row).
- Fixtures: `.../scratchpad/dotnet-fixtures/` (base, seeds 12 to 16, noembers, pert1e-15/1e-12/1e-9, determinism-a/b).
- Reviewer tools, run by me with small runs: `r3_noise.mjs`, `r3_diff.mjs`, `r7/k1.mjs`, with the exporter bundle in worktree agent-a9f3f1dc95c9548c9 and FS_REPO_ROOT set to it.
- Local .NET SDK: `packs/Microsoft.Android.Sdk.Linux/{36.1.118,37.2.31}/targets/Microsoft.Android.Sdk.SupportedPlatforms.targets:13`.
- Microsoft Learn (fetched 2026-11-12):
  - https://learn.microsoft.com/dotnet/api/system.math.sin and https://learn.microsoft.com/dotnet/api/system.math.exp (updated 2026-10-16)
  - https://learn.microsoft.com/dotnet/maui/whats-new/dotnet-11 (ms.date 2026-09-10)
  - https://learn.microsoft.com/dotnet/api/system.array.sort
  - https://learn.microsoft.com/dotnet/core/compatibility/jit/9.0/fp-to-integer (updated 2026-09-14)
- V8 source (fetched 2026-11-12):
  - https://chromium.googlesource.com/v8/v8/+/refs/tags/12.4.254.21/src/base/ieee754.cc
  - https://chromium.googlesource.com/v8/v8/+/refs/branch-heads/14.9/src/base/ieee754.cc
  - https://chromium.googlesource.com/v8/v8/+/refs/branch-heads/15.0/src/base/ieee754.cc
  - https://chromium.googlesource.com/v8/v8/+/refs/heads/main/src/base/ieee754.cc
- Android bionic: https://android.googlesource.com/platform/bionic/+/refs/heads/main/libm/Android.bp (fetched 2026-11-12).
- Chrome 150 release notes: https://developer.chrome.com/release-notes/150 (stable 2026-06-30).
- Local measurements: Node v22.22.0 / V8 12.4.254.21 against glibc 2.39 (Python 3.11 math); python NormalDist power calculations.
