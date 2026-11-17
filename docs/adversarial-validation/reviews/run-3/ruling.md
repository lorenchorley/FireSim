RULING on docs/plans/dotnet-option-b-prototype.md (lens set: plans; reviewers R1 Feasibility, R2 Missing requirements, R3 Failure modes and rollback, R4 Alternatives, R5 Cost and commitment)

How I checked. I read the pack, the plan (137 lines), all five reports, and the repository snapshot files the findings rest on. I ran read-only commands and list them where they settle a claim.
- Plan wording: grep -n -i "single|one thread|1 thread|all-core|thread" on the plan. It matched lines 12, 34, 36, 67 and 112 and none of them fixes the TypeScript thread count. A term grep for webassembly, webgpu, wasm, rust, c++, electron, tauri, ios, offline, licence, battery and backup matched only "airplane" (lines 37 and 51).
- RNG sites: grep of rng use in src/fire/spread/FireSpreadModel.ts. Draws are at lines 1207, 1504, 1954, 1976, 1981 and 1984. breachDraw is called at line 1381 under `breakW>0 && canBurn` with no embers or mountain guard. rollDebris (line 794) and VLS activation (line 1207) sit under mountainPhenomena, whose default is true (src/core/types.ts line 682). src/sim/simulation.ts lines 434-437 build separate streams: embers `seed`, fire `seed+1`, atmosphere `seed+3`.
- Line counts, same method as R1 (find, exclude *.test.ts and *.spec.ts, cat, wc -l). src/fire + embers + atmosphere + fuel + core + terrain printed 27586 non-test and 12868 test lines. fire + embers + atmosphere printed 17017 and 6844. All of src printed 121506 and 79856. src/sim alone is 5251 and 6000. A `python3 -I` search over directory combinations found 110 combinations within 10 % of 25,000 / 15,000. Examples: core+embers+fire+fuel+sim = 24754 / 15539 and atmosphere+core+embers+fuel+sim = 24285 / 14674.
- Standard-error arithmetic (python3 -I). For cv 19 / 22.4 / 27.1 %, the standard error of one 30-seed mean is 3.5 / 4.1 / 4.9 %. The standard error of the difference of two 30-seed means is 4.9 / 5.8 / 7.0 %. The 12 % bar is therefore 2.4 / 2.1 / 1.7 standard errors of the difference. Amdahl on 4 cores with a fire share of 0.58 gives 1.77x, and with 0.65 gives 1.95x.
- Rule 4 target: docs/plans/air-slice-wind-detail-honest-speed.md lines 128-130 are "## 4. Ground rules", rule 1 "Results never depend on speed...", rule 2 "No silent degradation".
- 3a reports: prototypes/dotnet-b/reports/3a-tier-difference.md lines 86-96 (perturbation test), 3a-reference.md (regeneration commands, "about 1 minute", 41 folders) and ts-export/README.md.
- Other greps and listings: `ls android ios` shows neither folder in the snapshot. scripts/check-android-apk.mjs, scripts/check-bundle.mjs and the "Performance budgets" table in docs/ARCHITECTURE.md (line 1718) exist. tsconfig.json include is src, tests, e2e, desktop and three root config files.
Could not check: the artifact VsrSVEJaknFbyWuQh7Svx9; the dotnet/skills clone and the Section 9 claims about it; the Section 2 container facts (proxy answers, the refused install script); the Vitest config (no vite.config.ts in the snapshot); the production Android application ID and signing key (no android/ folder); git history (the merge `095caf9` cannot be looked up).

## A. Must-fix list (ordered by damage if left in)

M1. Gate 1 names no TypeScript baseline, so it can be passed by thread count alone (R4.1; the D39 figure part of R2.5 goes to O2).
- Problem: Stage 1 asks "Is there a speed-up?" and stops if "All-core C# is under 1.5x the TypeScript". It never says whether the TypeScript side is one thread or all cores. Line 40 says only "the TypeScript in Node". The TypeScript solver today runs one worker thread per session (master plan D34 update, line 121; "threads that split one run" are not built, line 1592).
- Evidence: the thread grep above. Master plan section 15e (line 1014) gives Amdahl bounds on 4 cores of 1.9x (Standard air), 2.6x (High air) and 1.8 to 2.0x for the fire step alone. My arithmetic gives 1.77x for a 0.58 fire share. A C# kernel with the same per-core speed as the TypeScript but split over 4 threads clears a 1.5x bar, and D34 and D39 already allow that same split inside TypeScript. Line 90 of the plan also says "The Node host already gives the desktop its speed", and 15e says the desktop already has more speed than a 10 m run needs, so the plan does not say what the desktop half of the gate decides.
- Why it is a must-fix: Gate 1 is the control that stops the expensive stage 3 spend. As written, a pass is read as "a speed argument for B" (Section 7 row 1 says the reverse of that for a fail), but it can pass without any language advantage. The owner then reopens D34 on that reading.
- Direction: state the TypeScript baseline for each surface. Report the C# per-core ratio and the all-core ratio against it. Say what a Gate 1 pass may and may not claim against the in-TypeScript routes D34 permits. Rewrite the sentence at the same time as the direction fix in O1.
- Reviewer suggestions kept apart: R4.1 asked to report one-thread and all-core TypeScript (this item), and to add an in-TypeScript speed arm (S1). R2.5 asked to cite the 2 to 2.6x figure (O2).

## B. Should-fix and optional list

Should fix, ordered by damage.

S1. Add an in-TypeScript speed arm (R4.1, partly). The narrower claim that holds: Stage 1 will already define a fixed partition for `Parallel.For`, so running the same partition on Node worker threads is cheap and makes the comparison fair. A full WebAssembly or WebGPU arm goes beyond a gate; D34 itself says those are tried "only if the measurement says so". Do not require them.

S2. Gate 1 can stop or pass on indicative numbers with no repeat rule (R1.3, R3.3). Narrower claim: Rule 3 already requires median and spread, Section 9 requires BenchmarkDotNet's default job for final numbers, and Rule 6 pauses for the owner rather than ending the project. What is missing is any rule that a stop from container-only desktop numbers is confirmed by repeat runs under the flock with load recorded. The plan itself says the machine is shared (Section 2) and lists "timings on a quiet machine" as not done (line 136). R3.3's "stops the programme on a single result" and R1.3's "can end the project" overstate Rule 6. Direction: add a confirmation rule for any Gate 1 verdict that rests on container timings, with the load recorded.

S3. Order and phone waiting (R1.4, R5.4). Narrower claim: Section 4 says "Gate 1 and Gate 2 are decided together" and Gate 2 needs the phone, which implies P3b waits. It does not say so, and Section 3 says Gate 1 is run "Container, then phone". It also gives no state for a phone result that never arrives. Rule 5 covers "cannot be run here, says what it needs" but not the owner's silence. Direction: state that P3b and later stages do not start until the phone halves of Gates 1 and 2 are in, and what happens if they do not arrive.

S4. Owner phone time is not costed (R5.3). Verified: the phone is named in Stage 1, 2, 4 and 5 (Section 3 table). Stages 1 and 2 are decided together, so the count is three to four rounds, plus one if the MAUI build fails (Section 5). R5.3's "at least four" is slightly high. Section 8 counts only agent runs, and the purpose line says the owner decides whether to spend "phone time". Direction: add the number of rounds and an owner-time estimate per round to Section 8.

S5. Superseded text is left unmarked (R3.7; R1.6 second half). Section 3 line 48 and the Stage 3 gate row ("the bars below") keep the 1 % / 2 % / 30 s / tier-to-tier set. Section 10 says it "replaces the proposal in section 3", but nothing in Section 3 points to Section 10. An agent reading Stage 3 first meets the tight bars for every case, including embers off with a different stream, where the 3a floor is 1.1 to 1.9 % (3a-tier-difference.md section 4). Direction: mark the Section 3 bars as replaced and point the gate row at Section 10.

S6. The cost of two solvers is not weighed (R2.4, R4.4). The plan's own opening paragraph (line 5) keeps D34 in force, and D34 (master plan line 121) was set because ".NET ... means maintaining two solvers". Section 7 "All pass" names the one-off port, the Razor screens and migration, and not the recurring cost of keeping a C# solver matched to the TypeScript through later releases (the master plan has releases 0.6.0 to 0.10.0 planned). The plan also does not say whether B keeps the TypeScript solver for the web build and the desktop host, which decides whether there are two solvers at all. Direction: have the report state who owns parity upkeep and what a release costs, and say whether B retains the TypeScript solver.

S7. Stage 5 can wipe the owner's saved data (R3.1, partly). The narrower claim: Stage 5 deliberately installs "over the current APK" and says the saved sites and runs live in the WebView origin (line 53). If the signing key differs, Android refuses the update and the only way forward is an uninstall, which deletes that storage. The plan gives no precaution. Stages 1, 2 and 4 use test apps; a MAUI template does not reuse the production application ID by default, so the risk there is not shown. I could not check the production ID (no android/ folder). Direction: require a separate application ID for every test APK, and an export of saved sites and runs or a spare phone before any install over the production app.

S8. The plan frames the random-stream risk as the ember model only (R1.1, partly). Narrower claim: the spread model also draws from the fire stream (seed+1): the breach draw is not guarded by embers or mountain, and the VLS period and debris draws are guarded by mountainPhenomena, which defaults to true. The streams are separate (embers seed, fire seed+1, atmosphere seed+3 per simulation.ts lines 434-437), so R1.1's "same stream" is wrong. The Section 10 decision ("ports the TypeScript random generator and its draw order exactly") already covers all streams the slice uses, and 3a measured an embers-off seed floor of 0 to 1.9 % over the same code. The gap is that Section 10 item 1 names only the ember model, and the tight 1 % column needs every stream the slice uses to be exact. Direction: have 3b list every draw site per stream and make the exact-port decision on that list.

N1 (own, Should fix). The Stage 1 phone gate (2.0x) needs a TypeScript timing on the same phone, and the plan does not say how it is taken. K1's deliverable is "a minimal Android benchmark app" (C# only, Section 4). The repository already has a TypeScript speed test with frozen kernels (src/ui/speedTest.ts, speedTestKernels.ts; README line 448), which the plan does not mention. Direction: state how the TypeScript kernel is timed on the phone and whether the existing speed-test harness is used.

Optional.
O1. Gate 1 direction is ambiguous (R1.3, R2.5, R3.3). "Under 1.5x the TypeScript" can be read either way, but the stage question ("Is there a speed-up?") and prototypes/dotnet-b/reports/RESULTS-SCHEMA.md ("all-core C# >= 1.5x TypeScript") settle it. Valid but minor; fold into the M1 rewrite.
O2. The plan does not cite D39's "about 2 to 2.6 times on four cores" as the figure the C# result is weighed against (R2.5). Verified at master plan line 126. Fold into M1.
O3. "Fast enough" has no absolute target such as run time per simulated minute (R2.5). Partly valid: the gates are relative by design, and Section 3 calls them proposals.
O4. Gate 1 has no outcome rows for a desktop-only or phone-only fail (R4.5). Partly valid: Rule 6 sends every failed gate to the owner. Section 7 row 1 says "anywhere" and row 2 describes a desktop-host design, which a phone-only fail would contradict.
O5. The order line still shows P3a as pending (R1.6). Valid but minor; Section 10 says it is merged.
O6. Section 8's "ten to twelve agent runs" predates both revisions and has no retry allowance (R5.1, partly). The count itself matches the table: 10 rows, 12 if P3c-e is three agents.
O7. "A large use of the weekly budget compared with the earlier lanes" has no figure behind it (R5.2). grep -rIl "weekly budget" over the snapshot finds only this plan. Valid but minor.
O8. The "about 25,000 lines and 15,000 lines of tests" figure has no stated scope (R1.5). Partly valid. R1 said the test figure was larger than the solver directories; that depends on the set. With src/sim included, many combinations reproduce both figures (see counts above). The scope and counting method are still unstated.
O9. The 1e-15 perturbation test changes inputs, not the libm functions themselves (R1.2, residual). A targeted few-ulp perturbation of the ember model's exp and pow would add evidence. Partly valid; the existing evidence is strong (see X6).
O10. The 12 % loose bar is low in power (R3.2, residual). With a standard error of the difference of 4.9 to 7.0 %, a true 10 % bias passes in roughly 60 % of ensembles by my arithmetic. It is a fallback bar and was set before the 30-seed ensembles ran. Fix it only after the ensemble exists, or show it catches an injected defect.
O11. The loopback server on a phone has no containment rule (R3.6). Partly valid: Stage 4 measures the exposure, but nothing says the host is off by default, stops on exit, or stays out of builds the owner keeps.
O12. The offline rule and network audit are not mentioned (R2.1). Partly valid: master plan ground rule 6 applies to new app code, and this prototype changes no app code. Stage 4's airplane-mode test checks function, not request footprint. Stage 5 could list the audit specs for a replacement.
O13. iOS is not mentioned (R2.2). Partly valid. The README says Capacitor-ready for iOS, but the iOS project is not committed (README line 1329; no ios/ in the snapshot), and the plan's question is replacing "the current APK". A one-line scope note would do; it is not a must-fix.
O14. No licence or attribution check for the shell and new packages (R2.3). Valid but minor; README line 1640 and src/ui/content.ts line 438 confirm the existing duty.
O15. Battery and thermal are not measured (R2.7). Partly valid: Stage 5 already measures APK size, cold start and memory. The ARCHITECTURE "Performance budgets" table has start-up and scenario-build budgets but no battery number.
O16. Stage 5 does not list which release checks a replacement must pass or retire (R2.8). Verified: scripts/build-android-apk.sh line 38 runs check-android-apk.mjs, and `npm run check:bundle` exists. Both are Capacitor-specific, so a replacement retires them; the owner should be told which ones.
O17. The plan names no alternatives to B (R4.2). Partly valid: grep finds none. Whether the artifact does is not known.
O18. Rust or C++ and a Capacitor native module are not considered (R4.3). Partly valid: D34 rules out "native or third-language rewrite" on the same two-solver grounds, and the plan's scope is the option the owner chose. The origin benefit of a native module is unverified.
O19. The origin and saved-data test comes last and cannot stop the work (R5.5). Partly valid: Section 7 already lists the migration among remaining costs. A cheap early origin check in the Stage 2 test app is a judgment call.
O20. Fixtures and the SDK live in a session scratchpad (R2.6, R3.4, R5.7). Partly valid. The exporter, scenarios and seeds are committed (ts-export/README.md), regeneration of everything takes "about 1 minute" (3a-reference.md), each fixture has hashes.json and the regression anchor matches the published 0.8.0 hashes. What is lost is the location: 3a-reference.md hard-codes the authoring session's path.
O21. SDK and package versions are not pinned or recorded (R5.8). Partly valid. global.json rolls forward to the latest feature band, and RESULTS-SCHEMA.md records `runtime` but not the SDK patch or the BenchmarkDotNet version. `dotnet add package` writes the resolved version into the csproj. Low confidence from the reviewer is fair.
O22. The install route was changed after a refusal (R3.5, R5.6). Partly valid. The plan discloses it in Sections 2 and 9, and the owner's approval of the plan covers it. The toolchain was already installed (env.sh, README "SDK", Section 9 "toolchain download ... kept"). The plan does not record why the script was refused or ask for an explicit OK.
O23. "(plan section 4, rules 1 and 2)" in Rule 4 can be misread (R3.8, narrower). It points at the master plan's Section 4 ground rules, but this document has its own Section 4. Name the file.
N2 (own). Section 10 item 1 calls a correction something the 3a data confirm. The earlier claim was that last-bit differences "would change the stored hashes". 3a-tier-difference.md line 95 says "The snapshot hashes change at every time in every perturbed run". What the data refute is that results would move. Section 3's "Bit-identical hashes with the TypeScript are not expected" is therefore still right. Direction: reword the correction so it is about results, not hashes.

## C. Rejected findings

X1 (R3.8, "dangling cross-reference"). The reference resolves to master plan Section 4, ground rules 1 and 2 (lines 128-130), and is not copied from the README speed-test section. See O23 for the narrow point.
X2 (R3.4, "env.sh points at another session's folder"). It is the authoring session's scratchpad where the SDK was installed. env.sh says "If that path is gone, reinstall: see README.md SDK".
X3 (R5.7, regeneration compute not costed). 3a-reference.md gives "about 1 minute" for the full export, and the SDK is a tarball download.
X4 (R1.4, no fallback if the Android build fails). Section 5 bullet 3 gives it: the agents write exact build instructions and the owner builds.
X5 (R5.1, "TypeScript compute hours" for the 30-seed ensembles and "largest single item" for the exact RNG port). 3a says the ensemble is "about 1.3 s a fast-tier run, 5 s standard". The generator is mulberry32 (src/core/rng.ts), which is short; the draw order is the work, and that is part of the slice.
X6 (R1.2, "the test does not exercise the ember model's math and one flip shifts every later draw"). The perturbation runs included embers-on seeds 11 to 14, and at 1e-9 seeds 13 and 14 (many spot fires) moved no arrival by more than 1.2 ms with "no ember decision flipped" (3a-tier-difference.md section 3). The spread breach test consumes one draw whether or not it is breached (line 1504). A flip needs a value within an ulp of a threshold, which is about 1e-16 per comparison.
X7a (R3.2, "12 % is about 3.4 standard errors"). That uses the standard error of one mean; the bar compares two ensembles, and 12 % is 1.7 to 2.4 standard errors of the difference (3a states "two of them"). The power concern stands as O10.
X7b (R3.2, "the change was not put to the owner"). The revision is in the plan the owner reads, and line 29 lets the owner change any threshold before a stage starts.

## D. Ledger
| ID | Priority | Verdict | Reviewer ids | Claim |
|---|---|---|---|---|
| M1 | Must fix | Valid | R4.1 | Gate 1 names no TypeScript baseline; all-core C# against one-thread TypeScript can clear 1.5x from a parallel split alone, which D34 also allows in TypeScript |
| S1 | Should fix | Partly valid | R4.1 | Add a worker-split TypeScript arm of the same partition to Stage 1; a full WebAssembly or WebGPU arm is more than a gate needs |
| S2 | Should fix | Partly valid | R1.3, R3.3 | Gate 1 verdicts rest on indicative container numbers with no repeat or confirmation rule (Rule 6 pauses for the owner rather than ending the project) |
| S3 | Should fix | Partly valid | R1.4, R5.4 | Section 4 does not state that P3b waits for phone numbers, and nothing covers a phone result that never arrives |
| S4 | Should fix | Valid | R5.3 | Owner phone rounds (three to four, plus one if the MAUI build fails) are not costed in Section 8 |
| S5 | Should fix | Valid | R3.7, R1.6 | Section 3 bars and the Stage 3 gate row are not marked as replaced by Section 10 |
| S6 | Should fix | Valid | R2.4, R4.4 | Recurring cost of keeping a second solver in step, and whether B keeps the TypeScript solver, are not stated |
| S7 | Should fix | Partly valid | R3.1 | Stage 5 install over the current APK can wipe saved data; no separate application ID or backup rule is stated |
| S8 | Should fix | Partly valid | R1.1 | Section 10 names only the ember model; the spread model also draws on the separate fire stream, so 3b must list every draw site |
| N1 | Should fix | Valid | own | Stage 1 phone gate has no stated method for timing the TypeScript on the same phone |
| O1 | Optional | Valid but minor | R1.3, R2.5, R3.3 | "Under 1.5x the TypeScript" can be read either way; RESULTS-SCHEMA.md and the stage question settle it |
| O2 | Optional | Valid but minor | R2.5 | D39's 2 to 2.6x four-core figure is not named as the comparison |
| O3 | Optional | Partly valid | R2.5 | No absolute "fast enough" target; the gates are relative by design |
| O4 | Optional | Valid but minor | R4.5 | Section 7 has no rows for a desktop-only or phone-only Gate 1 fail |
| O5 | Optional | Valid but minor | R1.6 | Order line still shows P3a as pending |
| O6 | Optional | Partly valid | R5.1 | Section 8 estimate predates the revisions and has no retry allowance; the 10 to 12 count matches the table |
| O7 | Optional | Valid but minor | R5.2 | Weekly-budget comparison has no figure or source |
| O8 | Optional | Valid but minor | R1.5 | Port-size figure has no stated directories or counting method |
| O9 | Optional | Partly valid | R1.2 | Perturbation test changes inputs, not libm; a targeted ulp check would add evidence |
| O10 | Optional | Partly valid | R3.2 | The 12 % ensemble bar has low power and was set before the 30-seed ensembles ran |
| O11 | Optional | Partly valid | R3.6 | No default-off, teardown or exclusion rule for the loopback server on a phone |
| O12 | Optional | Partly valid | R2.1 | Offline rule and network-audit specs are not mentioned for the shell or HTTP client |
| O13 | Optional | Partly valid | R2.2 | Plan does not say it is Android-only; no iOS project exists in the repository |
| O14 | Optional | Valid but minor | R2.3 | No licence or attribution check for the shell and new packages |
| O15 | Optional | Partly valid | R2.7 | Battery and thermal are not measured; start-up, memory and APK size are in Stage 5 |
| O16 | Optional | Valid but minor | R2.8 | Stage 5 does not list release checks (check-android-apk, check:bundle) to retire or replace |
| O17 | Optional | Partly valid | R4.2 | Plan names no alternatives to B; the artifact may |
| O18 | Optional | Partly valid | R4.3 | Rust or C++ and a Capacitor native module are not considered; D34 already excludes native rewrites |
| O19 | Optional | Partly valid | R5.5 | Origin and saved-data test comes last and cannot stop the work; Section 7 lists the migration cost |
| O20 | Optional | Partly valid | R2.6, R3.4, R5.7 | Fixtures and SDK live in a session scratchpad; regeneration is committed and quick |
| O21 | Optional | Partly valid | R5.8 | SDK patch and package versions are not recorded in results |
| O22 | Optional | Partly valid | R3.5, R5.6 | Install route changed after a refusal; disclosed in the plan, no recorded owner OK |
| O23 | Optional | Valid but minor | R3.8 | "plan section 4" in Rule 4 is ambiguous within this document |
| N2 | Optional | Valid but minor | own | Section 10 item 1 "correction" conflates hashes with results; hashes did change in the 3a runs |
| X1 | None | Rejected | R3.8 | Rule 4 cross-reference is dangling; it resolves to master plan Section 4 |
| X2 | None | Rejected | R3.4 | env.sh points at another session's folder; it is the authoring session's, with reinstall instructions |
| X3 | None | Rejected | R5.7 | Regeneration compute is not costed; it is about 1 minute |
| X4 | None | Rejected | R1.4 | No fallback if the Android build fails; Section 5 gives one |
| X5 | None | Rejected | R5.1 | 30-seed ensembles cost compute hours and the exact RNG port is the largest item; 3a gives seconds per run |
| X6 | None | Rejected | R1.2 | Perturbation test does not reach the ember model and a flip shifts the stream; embers-on runs were included and draws are one per call |
| X7a | None | Rejected | R3.2 | 12 % is about 3.4 standard errors; it is 1.7 to 2.4 of the difference of two means |
| X7b | None | Rejected | R3.2 | Loosened bar was not put to the owner; it is in the plan the owner reads |

## E. Overall call
Fix the must-fix item and resend. One must-fix item stands (M1, the Gate 1 baseline), and eight should-fix items, mostly stale or missing statements that a short edit pass will settle. The reviewers' five "Fix first" verdicts are broadly right on direction. After checking sources I cut R2.2 and R3.1 from must-fix to optional and should-fix, and rejected eight claims or parts of claims. The staged design, the gate-and-stop structure, the scope rules and the Section 10 handling of the random stream hold up against the repository.
