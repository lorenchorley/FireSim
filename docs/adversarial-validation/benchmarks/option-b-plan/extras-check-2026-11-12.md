# Fact check of claims E1 to E19

PLAN = `docs/plans/dotnet-option-b-prototype.md` (line numbers are the plan's own). Other files are named relative to the snapshot folder.
"Matters" means the gap should be settled before the owner says go; "Minor" means it can be fixed or ignored without changing that decision.

## E1 Gate 1 rests on indicative container numbers, no repeat or confirmation rule
Rating: **Partly real**. Matters? **Minor**.
Evidence: PLAN line 11 (Rule 3) says container numbers "are desktop-class and noisy (4 shared cores, 16 GB) and are labelled *indicative*", and asks for "run count, median and spread", but nothing says a verdict near the bar is repeated or confirmed. Line 34 stops Gate 1 if C# is under 1.5x on desktop "or" under 2.0x on the phone, and line 88 turns that into "Stop". Only the desktop half rests on the container; the phone half is phone-measured ("Container, then phone"). The owner is told and decides at the stop (Rule 6, line 14; thresholds "proposals", line 29), and "timings on a quiet machine" are listed as still to run (line 136), so this softens it.

## E2 Owner's phone rounds not costed in the cost section
Rating: **Real**. Matters? **Minor**.
Evidence: Section 8 (line 97) counts only "agent runs" and "weekly budget". Section 5 (lines 74-78) says what the owner must do but not how many rounds or how long, and the stage table (lines 34-38) puts four stages on the phone (1, 2, 4, 5). Line 78: "If it fails, the agents write exact build instructions and the owner builds", which could be a large owner task, is not costed. It is disclosed in section 5, so the owner is not misled, only not given a number.

## E3 Section 3's bars and the Stage 3 gate row not marked as replaced by section 10
Rating: **Real**. Matters? **Minor**.
Evidence: Section 3 still carries "Agreement bars (proposed): ... at most 1% ... within 2% ... within 30 s" (line 48) and the gate row says "agreement outside the bars below" (line 36), with no pointer to section 10. The replacement is stated only from the other side: line 126 "Agreement bars for stage 3, replacing the proposal in section 3". A reader who stops at section 3 gets the old bars (and the old "no worse than the tier-to-tier difference" clause that line 123 says the fast tier misses by construction when tiers are mixed).

## E4 Section 10 names only the ember model as drawing on the random stream; the spread model also draws; 3b must list every draw site
Rating: **Partly real**. Matters? **Minor**.
Evidence: PLAN line 121: "The risk is the ember model's random stream and its draw order"; line 134 says the slice ports "the TypeScript random generator and its draw order exactly". Stage 3b (line 46) says only "read the code and decide the slice", with no draw-site list. In the source the spread model does draw: `src/fire/spread/FireSpreadModel.ts` lines 1207 (pulse period), 1504 (breach), 1954-1984 (debris spotting Poisson and path draws). The claim is wrong in one detail: these are separate streams, not one. `src/sim/simulation.ts` lines 35 and 434-437 give independent streams (embers seed, fire seed+1, explain seed+2, atmosphere seed+3); the ember model uses the embers stream, the spread model the fire stream. So the plan's "ember stream" is accurate for embers, but a bit-exact port (the "tight column") also needs the fire stream (and the atmosphere stream if the atmosphere is ported). P3a's own report hints at it: `prototypes/dotnet-b/reports/3a-tier-difference.md` line 108 "even in the turbulence draws", and lines 50-52 show a 0 to 1.9 % seed floor with embers off.

## E5 "under 1.5x the TypeScript" can be read either way
Rating: **Partly real**. Matters? **Minor**.
Evidence: Line 34: "All-core C# is under 1.5× the TypeScript on desktop, or under 2.0× on the phone". The ratio is not defined (TypeScript time divided by C# time, or the reverse; which statistic). Read as a time ratio it would invert the gate. The stage question "Is there a speed-up?" (line 34) and the outcome "No speed argument" (line 90) make the speed-up reading the obvious one, so the risk is small, but one defining sentence is missing.

## E6 Outcome table has no rows for a desktop-only or phone-only Gate 1 failure
Rating: **Real**. Matters? **Minor**.
Evidence: Gate 1 fails if either bar is missed (line 34, "or"), yet the table has one row: "Gate 1 fails | No speed argument for B anywhere. Stop." (line 90). If only the desktop bar fails the phone does have a speed argument, so "anywhere" is wrong; if only the phone bar fails, the desktop host (row 2, line 91) is not discussed. Rule 6 sends mixed cases to the owner, so it is a missing description, not a missing safeguard.

## E7 Order line still shows P3a as pending although section 10 reports it done
Rating: **Real**. Matters? **Minor**.
Evidence: Line 72: "S0 first. Then K1 and P3a in parallel with T2 (three agents)." Line 119: "Stage 3a (the TypeScript reference, agent P3a, merged as `095caf9`) delivered 41 fixture folders". Section 4 is not marked. S0 is also shown as first with no status although the skeleton exists in `prototypes/dotnet-b/`.

## E8 Section 8 cost estimate predates the revisions and has no retry allowance
Rating: **Real**. Matters? **Minor**.
Evidence: Line 97: "About ten to twelve agent runs if every gate passes, fewer if one fails early." It sits before sections 9 and 10 and is not updated. The agent table (lines 59-70) gives 12 runs with P3c-e as three areas. Section 10 adds work not in the count ("Still to run: 30-seed TypeScript ensembles, standard and high at 6 km, and timings on a quiet machine", line 136), section 9 adds a test project (line 112), and nothing allows for a failed build or a re-run (line 97 says only that Android builds are "expensive"). P3a being done removes one run, so the count is roughly right but not reconciled.

## E9 "Large use of the weekly budget" has no figure or source
Rating: **Real**. Matters? **Minor**.
Evidence: Line 97: "This is a large use of the weekly budget compared with the earlier lanes". No token, run-time or percentage figure and no reference to which earlier lanes. The owner can gauge it from their own usage and the gates limit exposure, so it does not block a staged start.

## E10 Offline rule and network-audit specs not mentioned for the new shell or HTTP client
Rating: **Real**. Matters? **Minor**.
Evidence: Grep of the plan finds "offline" nowhere and "airplane mode" only in the Stage 4 gate and test (lines 37, 51). Neither the app's ground rule 6 (`docs/plans/air-slice-wind-detail-honest-speed.md` line 135) nor the network audits (`e2e/debug-stats.spec.ts`, `e2e/speed-test.spec.ts`, `e2e/desktop-engine.spec.ts`, named at line 1636 there) appear. The new in-app loopback socket (line 51) is exactly the kind of change D34 says "must be reworded" (line 121 there). The HTTP client is not mentioned either: `src/data/http.ts` lines 3-8 depend on `CapacitorHttp`, which a MAUI shell does not have, while Stage 4 says "the page needs no change" (line 51). Partial cover: the airplane-mode run and the loopback-exposure write-up (line 51) touch the same ground. Nothing is released from this plan, so it bites at adoption, not at start.

## E11 Plan does not say Android-only; no iOS project exists
Rating: **Real**. Matters? **Minor**.
Evidence: The plan never says "Android only" or mentions iOS; it is Android in practice (APKs, "Android 7.0 (API 24) floor", lines 53, 76-77) but MAUI could target iOS. `README.md` line 1329-1330 confirms "the iOS project is not [committed] (it needs Xcode on macOS)", and `package.json` has `@capacitor/ios` and a `cap:ios` script but there is no `ios/` folder. One scope sentence would close it.

## E12 No licence or attribution check for the new shell and packages
Rating: **Real**. Matters? **Minor**.
Evidence: Grep of the plan for "licen", "attribution", "copyright" finds nothing. Section 9 adds BenchmarkDotNet, MSTest, MAUI workloads and Microsoft OpenJDK (line 108) with no licence check. The repository is MIT (`package.json` line 25) and the main plan says of another option "Licences were not checked" (line 1026 there), so the habit exists. Prototype code is not shipped (line 5), so this matters at adoption.

## E13 Battery and thermal behaviour on the phone not measured by any stage
Rating: **Real**. Matters? **Minor**.
Evidence: Grep of the plan for battery, thermal finds nothing. Stage 2 records memory, GC pauses and dropped frames (line 42); Stage 4's 10-minute run checks "no crash, picture cadence held, memory within a stated budget" (line 51); Stage 5 lists size, start-up, memory (line 53). Cadence over 10 minutes would show throttling indirectly, but nothing measures battery drain or temperature, and the Gate 1 phone number (short benchmark runs) is burst speed. The app already cares about battery (`README.md` line 172, idle stop).

## E14 Stage 5 does not list the existing release checks (check-android-apk, check:bundle) to retire or replace
Rating: **Real**. Matters? **Minor**.
Evidence: Stage 5 (line 53) lists size, start-up, memory, origin, runtime comparison and API floor only; neither name occurs in the plan. `scripts/check-android-apk.mjs` reads Capacitor's `assets/capacitor.config.json` and the Android network security config out of the APK, and `package.json` has `check:bundle`; a MAUI APK would carry neither in that form. Stage 5 is informational (line 38), so a list of checks to replace would fit its output.

## E15 Rust or C++ with a Capacitor native module not considered as alternatives
Rating: **Partly real**. Matters? **Minor**.
Evidence: The plan never mentions Rust, C++ or a Capacitor plugin; it starts from a chosen option B (line 3) and says what it does not decide (line 5). The main plan lists "A native solver (Rust or C++) driven by a desktop shell or a headless batch tool" (`docs/plans/air-slice-wind-detail-honest-speed.md` line 1030), but as a desktop idea, not a phone Capacitor native module, and D34 rules out "native or third-language rewrite" (line 121 there). Whether the artifact the plan cites (line 3, outside the snapshot) compares them: cannot be told from the snapshot.

## E16 Origin and saved-data test comes last and cannot stop the work
Rating: **Real**. Matters? **Minor**.
Evidence: Stage 5, last in the order (line 72), has the gate "Informational: produces the list the owner decides from" (line 38). The data risk is stated at line 53 ("A MAUI shell serves from a different origin") and the app's own test says changing the origin "loses every saved site and run" (`tests/build/androidNetwork.test.ts` line 11). The plan treats it as a cost: line 93 "the saved-data migration from stage 5". A cheap early probe would be possible with T2's MAUI test app, but it is a sequencing choice, not an error.

## E17 Install route changed after a refusal, no recorded owner OK
Rating: **Real**. Matters? **Matters**.
Evidence: Line 25: "Running the downloaded `dotnet-install.sh` was refused by the auto-mode classifier. The plan installs the SDK from the official tarball instead, verified against Microsoft's published SHA-512". Line 109 repeats it, and line 101 says "the toolchain download" was already done and "kept". The only owner step is for a second refusal: "If that is refused too, stage 0 stops and the owner decides." Nothing records the owner agreeing to the changed route after the first refusal, and the download seems to have happened before the plan was approved. One line of owner confirmation settles it.

## E18 "plan section 4" in Rule 4 is ambiguous within this document
Rating: **Real**. Matters? **Minor**.
Evidence: Line 12: "identical results on 1, 2, 4 and 8 threads (plan section 4, rules 1 and 2)". In this document section 4 is "Agents, scopes and order" (line 55), with no rules. The reference points to section 4 "Ground rules" of `docs/plans/air-slice-wind-detail-honest-speed.md` (line 128 there), whose rules 1 and 2 are about speed, display and silent degradation, not thread count, so it is a loose fit as well.

## E19 Section 10 item 1 calls a "correction" what the 3a reports confirm
Rating: **Real**. Matters? **Minor**.
Evidence: Line 121: "A correction to what I said earlier. I said last-bit differences ... would change the stored hashes ... no float32 arrival value moved". The 3a report says the opposite of a correction on the hashes: `prototypes/dotnet-b/reports/3a-tier-difference.md` line 95, "The snapshot hashes change at every time in every perturbed run ... the float32 arrival rasters did not move". So the earlier statement (hashes differ; section 3, line 48, "not the bar") stands; what is new is that the results are insensitive, so last-bit math is "not the risk". The label and the omission of the hash fact could confuse a reader, nothing more.

---
Counts
- Real: 15 (E2, E3, E6, E7, E8, E9, E10, E11, E12, E13, E14, E16, E17, E18, E19)
- Partly real: 4 (E1, E4, E5, E15)
- Not real: 0
- Cannot tell: 0
- Matters: 1 (E17)
