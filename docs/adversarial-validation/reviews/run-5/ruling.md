# Ruling: dotnet-option-b-prototype.md (five reviewers, R1 to R5)

Work: `scratchpad/bench/snapshot/docs/plans/dotnet-option-b-prototype.md` (137 lines). Sources: the rest of `scratchpad/bench/snapshot/`.

How I checked. I read the plan in full, all five reports, and opened the files each finding cites: `src/embers/EmberModel.ts`, `src/sim/simulation.ts`, `src/atmosphere/index.ts`, `diagnosticWind.ts`, `atmosphere.ts`, `docs/plans/air-slice-wind-detail-honest-speed.md` (D2, D34, 6.2, 15e), `docs/plans/0.9.0/CONTRACT-0.9.0.md`, `docs/plans/0.10.0/CONTRACT-0.10.0.md`, `docs/ARCHITECTURE.md`, `desktop/README.md`, `README.md`, `docs/research/09-mobile-tech-stack.md`, and `prototypes/dotnet-b/` (README, env.sh, SKILLS.md, ts-export/README.md, ts-export/scenarios.ts, reports/3a-*.md and 3a-results.json).

Commands I ran (read-only):
- `wc -l` on the ember, atmosphere and spread files printed 2271, 880, 1273 and 1991 lines; the sum of the non-test files under `src/atmosphere` is 6,260. These match R1's figures.
- `node -e "1/(0.42+0.58/3), 1/(0.42+0.58/1.5)"` printed 1.63 and 1.24. (`python3` is not installed here, so I used node.) R4's arithmetic holds.
- `grep -rn "Fs.Tests"` over the snapshot printed one hit, the plan's own line 112. `ls prototypes/dotnet-b` shows Fs.Bench, Fs.Compare, Fs.Host, Fs.Kernel and Fs.Transport, and no Fs.Tests.
- `grep -n "createAtmosphere" -A12 src/atmosphere/index.ts`: `createAtmosphere` returns `DiagnosticWind` when `tier === 'fast'`. The fast tier does not run the 3-D `Atmosphere` solver.
- `grep` of `ts-export/scenarios.ts` shows every fixture pins its tier. `grep` of `3a-results.json` shows seeds 12 to 16 of katoomba3-fast exist as fixtures.
- `grep` of `prototypes/dotnet-b/README.md` line 27 shows "benchmarks" are listed as heavy work under `flock`.
- `sed -n 1326,1332p README.md`: "the iOS project is not [committed] (it needs Xcode on macOS)".

What I could not check:
- The artifact (https://claude.ai/artifact/VsrSVEJaknFbyWuQh7Svx9). Claims that rest only on it are unverified.
- The rule on downloads is in the owner's global CLAUDE.md, which is in my own instruction context. That file is outside the pack's listed sources, and the reviewers read it from outside the pack. Whether the rule covers the Linux container the plan runs in (paths `/tmp/claude-0/-home-user-FireSim/...`) cannot be settled from the pack.
- How the Android WebView treats loopback `ws://` under mixed-content rules.
- The built app's default tier. I took it from the main plan (D2: "Your phone gets Detailed either way"; 6.2), not from code.
- The `android/` project (not in the snapshot).

## A. Must-fix list, ordered by damage if left in

**M1. The verdict covers the fast tier only, but the phone's default tier is the 3-D air.** (R2.2; supported by my N1.)
- Problem: Stage 1 profiles "the Katoomba 6 km fast-tier scenario" (line 40) and Gate 1 (line 34) is decided on the kernel that profile picks. Stage 3's slice is also the fast tier (line 45, line 46). Nothing in the plan says the verdict is limited to that tier.
- Evidence: the main plan's Auto policy "prefers the detailed 3-D air on any phone that can run it" and "Your phone gets Detailed either way" (D2, line 89; line 14). Section 15e measured the compute split: fast tier fire 58 %, air 5 %; 3-D tiers air 63 % (Standard) and 82 % (High) (main plan line 1014). On the fast tier, the air is `DiagnosticWind` (330 lines plus the 1,109-line base), not the 3-D solver, so the profile can never select the 3-D solver. The phone half of Gate 1 (2.0×) is therefore measured on a kernel that the default phone tier does not spend most of its time in.
- Direction for the fix: profile and benchmark the Standard tier as well, or state in the gate and in section 7 that the verdict is for the fast tier only and that the 3-D air is neither measured nor ported. See S2 and N1.

**M2. Gate 1 does not say how many cores the TypeScript side uses, and its bar sits below the in-TypeScript ceiling the repo already records.** (R4.2, first half; R4.1 narrowed.)
- Problem: the gate compares "All-core C#" with "the TypeScript in Node" (lines 34, 40). The TypeScript side's core count is never stated. The repo's own D34 names threads as the in-TypeScript route to speed, and the 15e bounds put threads on the fire alone at 1.8 to 2.0× on 4 cores (main plan line 1014), above the 1.5× desktop bar.
- Evidence: line 40 gives "1 to 4 threads" for the C# arms only. 15e is an estimate (Amdahl upper bound), not a measurement. A desktop pass at 1.5× against single-thread TypeScript can still lie inside what TypeScript threads could reach, yet section 7 turns a full pass into "D34 would then be reopened".
- Direction for the fix: state the TypeScript core count in Gate 1. Then either add a TypeScript all-core arm for the desktop half, or write into section 7 that a pass is against single-thread TypeScript and that in-TypeScript threads are unmeasured. See S12 for the wider "alternatives" part, which I rule Should fix.

**M3. Downloads: the plan has no step that asks the owner, and it names a workaround for a refused install.** (R1.6, R3.7, R5.6 second half.)
- Problem: the owner's standing rule (while the antivirus is off, download only signed files from trustworthy sources, and always ask first before downloading or executing anything untrustworthy) is not mentioned. Line 25 records that the classifier refused the install script, substitutes the SDK tarball, and asks the owner only "if that is refused too". Stage 1 onward needs more downloads (BenchmarkDotNet, the Android SDK, Microsoft OpenJDK, MAUI workloads, Gradle and Maven fetches, lines 21, 108) with no ask.
- Evidence: the tarball is checked against a SHA-512 from the same publisher (README.md "SDK"). That is an integrity check, not a signature, and I could not verify that the tarball is signed. `env.sh` shows the SDK was already installed this way. The plan does not list each download's source and signature state.
- Narrower claim that holds: the source (Microsoft, Google) is a reputable one, the plan is open about the refusal, and the work runs in a Linux container where the rule's reach is unconfirmed (R1.6 itself rates its confidence "medium" for that reason). What cannot be left in is that the plan never asks the owner whether the rule applies to the container, and continues to fetch unsigned archives on the strength of "if refused, stop".
- Direction for the fix: add a stage 0 line that lists each download with source and signed or checksum-only, and gets the owner's yes (or a statement that the rule does not cover the container) before any further download. State plainly that the tarball is a different route after a refusal, and that the owner agreed to it.

## B. Should-fix and optional list

### Should fix

**S1. The embers fallback in stage 3b is underspecified for what the embers need.** (R1.1, partly valid.)
- Line 46 allows "the TypeScript's own wind rasters as input" with the atmosphere deferred; line 134 commits to an exact embers port. `EmberModel.step(dt, wind, turb, ...)` (line 649) samples 3-D wind at arbitrary heights and needs per-column turbulence from `atm.sampleTurb`; `simulation.ts` line 1371 passes both, and line 27 shows heat fed back into the atmosphere. Surface rasters cannot feed the embers. Overstated: R1 sizes the fix at the 6,260-line 3-D port. The fast-tier slice uses `DiagnosticWind` (330 lines plus `base.ts` 1,109), whose 3-D wind and turbulence come from the stamp pair and similarity, so a per-step export of 3-D wind and turbulence is a smaller and different decision.
- Direction: say what the fallback must export (3-D wind, turbulence, plume or fire-heat coupling), or drop the fallback for embers-on; size `DiagnosticWind` plus base before the stage 3b decision.

**S2. Gate 3 and section 7 do not carry the "atmosphere deferred" caveat into the verdict.** (R2.3, valid.)
- Line 46 says the report will say so; gate 3 (line 36) and the "All pass" row (line 93) do not. A pass would read as feasibility for a tier or part that was never ported. Relates to M1.
- Direction: the pass line and section 7 name the tiers and parts the pass covers.

**S3. Gate 1 is decided on one kernel, with no step from kernel speed-up to run speed-up.** (R1.2, R4.2 second half; partly valid.)
- Narrower claim: the stop direction is mostly sound, because the plan picks the hottest kernel and a run cannot do much better than its hottest part. The pass direction is the gap. With fire at 58 % of the fast tier (main plan line 1014), a kernel at 1.5× gives about 1.24× for the run and a kernel at 3× about 1.63× (I ran both; R4's figure holds). The plan never records the kernel's share or the implied run figure, and section 7 treats a pass as "a speed argument".
- Direction: record the profile share and the implied run speed-up as part of Gate 1.

**S4. Gate 1 can be decided on noisy numbers with no repeat count and no margin rule.** (R1.3, R3.3, R5.7; partly valid.)
- Line 11 labels container numbers "indicative"; the 3a reference run of katoomba3-fast gave 1050, 1099 and 1206 ms (`3a-reference.md`), a spread of about 15 %. Nothing says what to do when a ratio lies within the spread of its bar, or that Gate 1 waits for quiet-machine timings (line 136). The part of the finding that says the timing runs are not under the lock is rejected (X1).
- Direction: set a repeat count and a re-run rule when a ratio is within the measured spread of its bar.

**S5. The phone half of Gate 1 has no defined TypeScript baseline, and no explicit wait for the owner's phone.** (R1.4, valid for the baseline; partly valid for the wait.)
- The only comparator the plan defines is Node (line 40); a phone has no Node. Line 34 says "Container, then phone" and line 72 decides Gates 1 and 2 together from K1 and T2, so a wait on the phone is implied but not written. Pricing the owner's time is O13.
- Direction: name the phone baseline (the same kernel and inputs in the benchmark APK's JavaScript engine) and say Gate 1 waits for the owner's numbers.

**S6. `Fs.Tests` is required but owned by no agent.** (R1.5, valid.)
- Line 112 creates `Fs.Tests` for the thread-count and contract tests. S0's skeleton (line 61) does not list it, and the section 4 table gives the thread-count test to C3 in `Fs.Compare` (line 67). Line 57 scopes each agent to its own folder, so whoever creates `Fs.Tests` is out of scope at the scope check.
- Direction: put `Fs.Tests` in S0's skeleton or one agent's scope, and say which agent owns the thread-count test.

**S7. "The page needs no change" (line 51) is overconfident about origin and cleartext.** (R1.7, R2.5 first part; partly valid.)
- Verified: the host's handshake accepts its own origin, a listed origin, or none (CONTRACT-0.9.0 line 53; ARCHITECTURE line 1186 "HTTP 403"). A plain `ws://` from the app's `https://localhost` page needs the cleartext and mixed-content settings loosened (ARCHITECTURE line 1204; CONTRACT-0.9.0 line 70), and the docs call that the owner's decision. The plan lists the cross-origin spec but not the allowlist entry for the shell's origin, and does not say whether loopback `ws://` needs the cleartext decision. I could not check how the Android WebView treats loopback.
- Direction: state the shell's origin, the allowlist entry the C# host needs, and whether the cleartext decision is needed.

**S8. Sideloading test APKs on the owner's phone can cost saved data.** (R3.1, partly valid.)
- Plan line 53 says saved sites and runs live in the WebView origin and tests install "over the current APK". The current package is `au.firesim.app` (main plan line 1690). The plan names no applicationId for the test APKs and the shell, and no backup step. The harm needs a test APK to reuse that id with a different signature, which the plan does not say it will do.
- Direction: give each test APK its own applicationId, and ask the owner to export saved sites and runs before any install over the current app.

**S9. The stage 3 gate does not name the seeds, and seed 11 never exercises the embers.** (R5.3, valid.)
- Line 45 fixes seed 11; line 122 says seed 11 "starts no effective spot fire, so it equals the no-embers run". The tight embers-on column (line 131) and the decision at line 134 need seeds that fire spots, which the plan does not name. Fixtures for seeds 12 to 16 exist (`3a-results.json`), so this is a one-line fix.
- Direction: name the gate's seed set and require embers-on bars on seeds where embers fire.

**S10. The cost estimate counts twelve runs and leaves the "still to run" work unowned.** (R5.5, valid.)
- Counting section 4 rows, with the port split in three, gives 12 runs (the table has 10 rows, the port being one row of three areas). Line 136 lists the 30-seed ensembles, standard and high at 6 km, and quiet-machine timings as "still to run", with no agent. There is no retry allowance. The 30-seed ensembles are needed only if the loose embers bar applies.
- Direction: give each item an owner or mark it conditional, and add a retry allowance to line 97.

**S11a. Stale text from before the revisions is still in section 3 and its stage detail.** (R1.8, R5.2 second part; valid but minor.)
- Line 40 (`Span<T>` with `Vector<T>`) against line 106 ("`Vector<T>` is not the default"); line 48 bars against line 126 ("replacing the proposal in section 3"). Line 126 signposts the change, but agents who read section 3 first meet the old text.
- Direction: strike or update lines 40 and 48.

**S11b. Gate 1's wording and its split outcomes are undefined.** (R1.8 third part, partly valid; plus my N2.)
- "All-core C# is under 1.5× the TypeScript on desktop, or under 2.0× on the phone" reads as a stop if either half fails. Section 7 then says "Gate 1 fails: No speed argument for B anywhere". If desktop passes and the phone fails (or the reverse), that sentence is wrong, and the table has no row for it.
- Direction: write the comparison direction and give section 7 a row for each split.

**S12. The in-TypeScript alternatives are not measured, so section 7's "reopen D34" has no comparator.** (R4.1 and R4.3 narrowed; partly valid.)
- Narrower claim: the plan states its question as C# feasibility and need not measure every alternative. But D34 names threads and "WebAssembly or WebGPU for one hot loop" as the in-TypeScript route (main plan line 121); research note 09 (lines 107 to 115, 364 to 371) says Android WebView has no SharedArrayBuffer or WASM threads, and recommends single-thread WASM SIMD next, "at most about 4×". Section 7 recommends reopening D34 without saying the in-TypeScript route was not measured. R4 asked for the measurement before Gate 1 as a must-fix; that is too strong for a feasibility prototype.
- Direction: either add a single-thread WASM SIMD arm (phone) and a worker-thread arm (desktop) to stage 1, or say in section 7 what was not compared.

### Optional

- **O1. Stage 2 gate can pass while pictures are lost.** (R3.2, partly valid.) "Sustains the rates" does not say at which end the rate is counted, and there is no received-equals-sent or checksum check. Direction: count at the WebView and require received equals sent.
- **O2. Fixture-to-solver-commit guard.** (R3.4, partly valid; the regeneration-command part is rejected, X2.) Each fixture carries `meta.json.gitCommit` (`9bfcf24`), but no step has C3 refuse to compare when the solver has moved. Direction: C3 checks the commit.
- **O3. No rollback line.** (R3.5, valid but minor.) Rule 1 keeps everything under `prototypes/dotnet-b/`, so removal is the rollback; the plan never says so. Direction: one line.
- **O4. Stage 4 detail has no numbers.** (R3.6, partly valid; includes R1's note on protocol 2.) The gate on line 37 has only the airplane-mode and protocol 2 terms; the cadence and memory terms sit in the detail (line 51) without numbers, so they cannot fail anything. Protocol 2 is defined in code (`LINK_PROTOCOL = 2`, `src/sim/remote/wire.ts`) and `docs/ARCHITECTURE.md` line 1186 still shows `"protocol":1` in its example, so a link to the definition would help. Direction: give a memory ceiling and a minimum picture count, and link the definition.
- **O5. Auto tier choice is not mentioned.** (R2.1, partly valid.) The gates are unaffected, because fixtures pin the tier (X5). What holds: a faster C# engine would pick different tiers on the same phone under Auto, a point worth one line among the "remaining cost" items. Direction: one line in section 7.
- **O6. The verdict is for Android.** (R2.4, partly valid.) The iOS project is not committed (README lines 1328 to 1331), so the app does not ship on iOS today (X7). One line saying the verdict is Android only.
- **O7. Ongoing parity cost is not an owner input.** (R2.6, R5.4; partly valid.) D34's stated reason was two solvers; section 7 does not list the cost of keeping the C# port in step as the TypeScript solver changes, nor the draw-order coupling of the exact random-stream port. The prototype's port is reversible (X8); the cost belongs to the later decision. Direction: list it as an owner input in section 7.
- **O8. Rule 6 (offline) and a listening socket.** (R2.7, partly valid.) Line 51 already sets the interop route "that opens no socket" against loopback, so the choice is visible. Direction: say a shipped listening socket needs the owner's decision under rule 6.
- **O9. What the ASP.NET Core host gains over the Node host.** (R4.4, partly valid; "never mentions `desktop/`" is rejected, X6.) The plan gives no non-speed reason. Direction: one sentence, for example sharing the engine with the phone.
- **O10. Option A is not named.** (R4.5, valid but minor.) The plan points to the artifact for the comparison. One sentence naming A would help a reader without the artifact.
- **O11. The origin and saved-data finding could come earlier.** (R5.1, partly valid.) T2's MAUI test app already has a WebView, so the shell's origin could be read at stage 2. Nothing is committed at stage 4 (X3). Direction: add the origin check to stage 2.
- **O12. The owner's go-ahead for stages 0 and 3a is not recorded.** (R5.6 first part, valid but minor; cannot verify beyond the document.) Sections 9 and 10 show both done and merged. One line recording approval would settle it.
- **O13. Owner phone time is not priced.** (R5.8, valid but minor.) At least four phone rounds (stages 1, 2, 4, 5) and no rule if the numbers are late. Direction: an estimate per round and a rule for late numbers.
- **O14. Host features beyond protocol and origin.** (R2.5 second part, valid but minor.) Pairing lockout (5 wrong codes, 60 s), close 4426, `--lan` warning, Desktop detail (D35) are in `desktop/README.md` but not in stage 4's acceptance list. For a prototype this is optional.
- **N1 (own, Should fix).** Stage 1's candidate list (line 40) names the 3-D "atmosphere solver (880 lines)", but the profiled scenario is the fast tier, where `createAtmosphere` returns `DiagnosticWind`, so the profile cannot pick it. Direction: remove it from the list or add a Standard-tier profile (see M1).

## C. Rejected findings

- **X1.** (R1.3 part) "The plan does not say K1's timing runs take the lock." Line 24 says heavy work goes under `flock`, and `prototypes/dotnet-b/README.md` line 27 lists benchmarks as heavy work; `3a-reference.md` says the lock was held for every run. The noise point stands (S4).
- **X2.** (R3.4 part) "No regeneration command." `ts-export/README.md` gives `run.mjs export all --out $FIX` and the other commands.
- **X3.** (R5.1 part) "The commitment to the new origin is made in stage 4." Stage 4 builds a prototype under `prototypes/dotnet-b/`; section 1 rule 1 and "What this is not" commit nothing, and section 7 already lists the saved-data migration as a remaining cost. Only the scheduling point survives (O11).
- **X4.** (R5.2 part) "Bars were loosened without owner approval." Line 29 makes all thresholds proposals the owner may change before a stage starts, stage 3 has not started, section 10 shows the measured floor (0 to 1.9 %) behind the 2.5 % embers-off bars, the embers-on exact column keeps the original bars, and the added 95th-percentile bar is tighter. Only the stale line 48 survives (S11a).
- **X5.** (R2.1 part) "The stage 3 bars would compare different tiers." Fixtures pin the tier (`scenarios.ts`), and section 10 item 3 requires "the same tier".
- **X6.** (R4.4 part) "The plan never mentions `desktop/`." Line 5 does. The missing reason for the ASP.NET host stands (O9).
- **X7.** (R2.4 part) "The app also ships on iOS." The iOS project is not committed (README lines 1328 to 1331). The Android-only wording is O6.
- **X8.** (R5.4 part) "The exact random-stream port is hard to reverse." It lives in the prototype folder and is reversible. The cost belongs to the later decision (O7).
- **X9.** (R1.8 part) "P3a runs before Gate 1, so a Gate 1 stop wastes its work." Moot: section 10 says stage 3a is done and merged as `095caf9`, and it has no C# in it.
- **X10.** (R1.2 part) "A kernel missing 1.5× does not show that no part of the solver is faster." Mostly wrong for the stop direction: the plan picks the hottest kernel (line 40), so a failing hottest kernel is a fair stop signal. The pass-direction gap stands (S3).

## D. Ledger

| ID | Priority | Verdict | Reviewer ids | Claim |
|---|---|---|---|---|
| M1 | Must fix | Valid | R2.2 | Stage 1 profile and Gate 1 are on the fast tier only, but the phone's default tier is the 3-D air (63 to 82 % of compute); the verdict's scope is not stated |
| M2 | Must fix | Valid | R4.2, R4.1 | Gate 1 does not state the TypeScript core count, and its 1.5× bar sits below the 1.8 to 2.0× in-TypeScript ceiling the repo records |
| M3 | Must fix | Partly valid | R1.6, R3.7, R5.6 | No step asks the owner about downloads under the antivirus rule; line 25 substitutes a tarball route after a refusal; sources and signature state are not listed |
| S1 | Should fix | Partly valid | R1.1 | The raster fallback cannot feed the embers (3-D wind, turbulence, coupling); but the fast tier uses DiagnosticWind, not the 6,260-line 3-D port |
| S2 | Should fix | Valid | R2.3 | Gate 3 and the "All pass" row do not carry the "atmosphere deferred" caveat |
| S3 | Should fix | Partly valid | R1.2, R4.2 | Gate 1 has no kernel-to-run step; 1.5× on a 58 % kernel is about 1.24× on the run |
| S4 | Should fix | Partly valid | R1.3, R3.3, R5.7 | No repeat count or margin rule when a ratio is within the measured spread (about 15 %) of its bar |
| S5 | Should fix | Valid | R1.4 | The phone half of Gate 1 has no TypeScript baseline and no written wait for the owner's phone numbers |
| S6 | Should fix | Valid | R1.5 | `Fs.Tests` is required (line 112) but owned by no agent; C3 owns the thread-count test in `Fs.Compare` |
| S7 | Should fix | Partly valid | R1.7, R2.5 | "The page needs no change" ignores the origin allowlist entry and the cleartext decision for the shell |
| S8 | Should fix | Partly valid | R3.1 | No applicationId or backup step before sideloading and install-over tests on the owner's phone |
| S9 | Should fix | Valid | R5.3 | Stage 3 gate names no seed set; seed 11 never exercises embers |
| S10 | Should fix | Valid | R5.5 | "Still to run" items have no agent and the 12-run estimate has no retry allowance |
| S11a | Should fix | Valid but minor | R1.8, R5.2 | Stale `Vector<T>` text (line 40) and stale bars (line 48) remain beside the revisions |
| S11b | Should fix | Partly valid | R1.8 | Gate 1's comparison wording is unclear and split outcomes have no row in section 7 |
| S12 | Should fix | Partly valid | R4.1, R4.3 | In-TypeScript routes (threads, WASM SIMD) are not measured, so "reopen D34" has no comparator |
| N1 | Should fix | Valid | own | Stage 1 lists the 3-D atmosphere solver as a candidate, but the fast-tier profile cannot select it |
| N2 | Should fix | Valid | own | Section 7 maps any Gate 1 failure to "no speed argument anywhere", which is wrong if only the phone half fails |
| O1 | Optional | Partly valid | R3.2 | Stage 2 gate does not count pictures received against sent |
| O2 | Optional | Partly valid | R3.4 | No guard that the solver commit equals the fixture's gitCommit |
| O3 | Optional | Valid but minor | R3.5 | No one-line rollback statement |
| O4 | Optional | Partly valid | R3.6, R1 | Stage 4 cadence and memory terms have no numbers and sit outside the gate; protocol 2 definition not linked |
| O5 | Optional | Partly valid | R2.1 | Auto tier choice would differ on a faster engine; not mentioned |
| O6 | Optional | Partly valid | R2.4 | State that the verdict is for Android only |
| O7 | Optional | Partly valid | R2.6, R5.4 | Ongoing parity cost with the TypeScript solver is not listed as an owner input |
| O8 | Optional | Partly valid | R2.7 | A listening socket in the shipped phone app needs an owner decision under rule 6 |
| O9 | Optional | Partly valid | R4.4 | The plan does not say what an ASP.NET Core host gains over the Node host |
| O10 | Optional | Valid but minor | R4.5 | Option A is not named in the plan |
| O11 | Optional | Partly valid | R5.1 | The origin and saved-data finding could be taken at stage 2 |
| O12 | Optional | Valid but minor | R5.6 | The owner's go-ahead for stages 0 and 3a is not recorded in the document |
| O13 | Optional | Valid but minor | R5.8 | Owner phone time is not priced and there is no rule for late numbers |
| O14 | Optional | Valid but minor | R2.5 | Pairing lockout, close 4426 and Desktop detail are not in stage 4's acceptance list |
| X1 | None | Rejected | R1.3 | Timing runs are not covered by the heavy-work lock |
| X2 | None | Rejected | R3.4 | No regeneration command for the fixtures |
| X3 | None | Rejected | R5.1 | Stage 4 commits to the new origin before stage 5 tests it |
| X4 | None | Rejected | R5.2 | The orchestrator loosened the bars without owner approval |
| X5 | None | Rejected | R2.1 | Stage 3 bars would compare different tiers |
| X6 | None | Rejected | R4.4 | The plan never mentions `desktop/` |
| X7 | None | Rejected | R2.4 | The app also ships on iOS |
| X8 | None | Rejected | R5.4 | The exact random-stream port is hard to reverse |
| X9 | None | Rejected | R1.8 | P3a running before Gate 1 wastes work on a Gate 1 stop |
| X10 | None | Rejected | R1.2 | A failing hottest kernel does not show that the solver cannot be faster |

## E. Overall call

Fix the must-fix items and resend. The plan is well built (gates with numbers, scope per agent, honest labelling of indicative numbers, a prototype folder that cannot touch the app), and most reviewer findings are small. Three things must change before the owner decides on the spend. First, the verdict's scope: say the work covers the fast tier only, or profile the Standard tier (M1). Second, the Gate 1 baseline: say how many cores the TypeScript side uses, and carry the in-TypeScript caveat into section 7 (M2). Third, the owner's download rule: list each download and get a yes (M3). The Should-fix items are mostly one-line edits and can go in the same pass.
