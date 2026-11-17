# Ruling on the adversarial review of `docs/plans/dotnet-option-b-prototype.md`

Judge's notes on method. I read the pack, the five reports (R1 to R5) and the plan. I then opened the files the findings rest on, in the snapshot under `scratchpad/bench/snapshot/`. Where a command could settle a claim I ran it; the commands and what they printed are listed in each item and again in "Commands run" at the end. The owner's download rule (finding M1) is not in the pack. It is in the owner's standing instructions that I was given, so I checked it there. I could not read the artifact `https://claude.ai/artifact/VsrSVEJaknFbyWuQh7Svx9`, and no claim here rests on it. The sandbox has no `python3`; I used `node` for arithmetic.

## A. Must-fix list (ordered by damage if left in)

### M1. The plan has agents download and install toolchains with no owner approval step, and it handles a refused action by taking another route (R1.1, R2.3, R3.1, R5.1). Verdict: Valid.
- Problem: the owner's standing instruction says the antivirus is off, that only signed files from trustworthy sources may be downloaded, and that the owner must be asked first for anything else. The plan puts a download in front of every stage: the SDK (stage 0), Microsoft OpenJDK, the Android SDK packages, the MAUI workloads and NuGet packages (section 2, section 3 stages 2 and 4, section 5, section 9 row `dotnet-maui-doctor`), and the dotnet/skills clone (`SKILLS.md`). Nowhere does it ask the owner to approve them or mention the antivirus state. After the auto-mode classifier refused running `dotnet-install.sh`, section 2 picks a second route to the same SDK (the tarball) and stops only "if that is refused too".
- Evidence:
  - I ran `grep -n -i -E "ios|apple|app store|antivirus|signed|signature"` on the plan: it printed nothing. The plan never mentions the antivirus or signatures.
  - Section 2, Permission row, reads: "The plan installs the SDK from the official tarball instead, verified against Microsoft's published SHA-512 ... If that is refused too, stage 0 stops and the owner decides."
  - `prototypes/dotnet-b/README.md` (SDK section) says the checksum comes from `releases.json` on `builds.dotnet.microsoft.com`, the host that also serves the tarball. That catches corruption, not a tampered host, and is not a signature check.
  - Narrowing: the refused action was running a downloaded script, and the tarball is a different action. The plan is open about the route. Whether a checksummed Microsoft tarball meets the owner's "signed" exception is the owner's call, but the plan should put that call to the owner and not take it.
  - A related fact: the plan's own section 9 says "the toolchain download" was already done, and `env.sh` says the SDK "was installed". I cannot tell from the pack whether the owner approved that. See N1.
- Direction for the fix: add an owner approval step before stage 0 that lists each download (URL, size, what verifies it: signature or checksum) and the antivirus state, and waits. Turn "refused" into "stop and ask", not "try the other route". Record in the plan what was already downloaded and on whose approval.

### M2. Gate 1 cannot tell a C# speed-up from a threading speed-up, and TypeScript can also use threads (R4.1). Verdict: Valid.
- Problem: stage 1 stops only if "all-core C# is under 1.5x the TypeScript". The TypeScript baseline is one thread on desktop. The repository's own estimate of what threads alone could give in TypeScript is above the gate, so C# could pass Gate 1 with a language that is no faster per thread. A pass then releases the most expensive part of the plan (the stage 3 port) on a case that does not support C#.
- Evidence:
  - `docs/plans/air-slice-wind-detail-honest-speed.md` line 1014: "Amdahl upper bounds on 4 cores: the air alone 1.9x (Standard) and 2.6x (High); the fire alone 1.8 to 2.0x". Line 126 (D39): "about 2 to 2.6 times on four cores at best". These are estimates, not measurements, but all sit above 1.5.
  - D34 (line 121) says speed beyond one core "comes from threads, and from WebAssembly or WebGPU ... within the TypeScript project". So threads in TypeScript are an allowed route.
  - The plan does record "1 to 4 threads" for C# (stage 1 output), so the data to separate the effects will exist. The gate rule just does not use it.
- Direction for the fix: decide Gate 1 on the language effect (one-thread C# against one-thread TypeScript, on the same kernel and inputs) and report the threading gain as a second, separate number. State what the owner should conclude if only the threading number clears 1.5x.

## B. Should-fix and optional list

### Should fix

**S1. "The page needs no change" in the MAUI shell is overstated (R2.1). Partly valid.** `Capacitor` is used in 14 files under `src/`, of which 9 are not tests (`main.ts`, `ui/app.ts`, `ui/bootDiagnostics.ts`, `ui/desktop.ts`, `ui/deviceInfo.ts`, `ui/location.ts`, `ui/prefs.ts`, `ui/screens/notice.ts`, `data/http.ts`; R2.1 said "13 source files", which is not exact). The code checks it directly: `http.ts` line 111 switches to CapacitorHttp when `Capacitor.isNativePlatform()`; `location.ts` line 80 uses the native location plugin; `prefs.ts` line 28 returns null off native; `desktop.ts` line 171 changes the typed-address flow. README line 1347 says CapacitorHttp is why "no service depends on CORS on device". In a MAUI shell without the bridge, the page takes its browser branches. Whether live fetch fails there is not verified (the runtime effect depends on the shell). The stage 4 gate is airplane mode, which does not exercise any of these paths. Direction: reword the sentence, list the Capacitor-dependent behaviours with a replacement or a decision for each, and add a live-fetch, location and saved-data check to the stage 4 gate.

**S2. The loopback `ws://` route from the MAUI page has unstated cleartext, mixed-content and origin prerequisites (R1.3). Partly valid.** `docs/ARCHITECTURE.md` line 1204 says a plain `ws://` socket from the app's `https://localhost` page needs cleartext and mixed-content settings loosened, "the owner's decision". `docs/plans/0.9.0/CONTRACT-0.9.0.md` section 4.2 item 2 (D36) says the host accepts only its own origin, a listed origin, or no Origin. Narrowing: the ARCHITECTURE sentence is about a LAN desktop address from the Capacitor page, not loopback inside a MAUI WebView, and I could not check how a MAUI WebView treats `ws://127.0.0.1`. What holds is that the plan assumes the loopback route works unchanged and names no prerequisite or origin rule for the in-app Kestrel host. Direction: name the prerequisites as owner decisions and give the C# host the D36 origin rule, or choose the interop route for the page.

**S3. The phone half of Gate 1 has no TypeScript comparator (R2.7). Valid.** Stage 1 benchmarks "against the TypeScript in Node". Section 5 and the K1 deliverable give the phone a C# benchmark app only. On a phone the shipped TypeScript runs in the WebView worker, not in Node, so "under 2.0x on the phone" has nothing to divide by. The app already has an in-app speed test (`docs/DESIGN.md` line 668, "The speed test (0.7.0)") that could be the baseline. Direction: define the phone baseline as the TypeScript engine in the app's own worker on the same phone, or say how the ratio is formed.

**S4. A failed Gate 1 on desktop can be decided from indicative, shared-machine numbers with no margin or re-measure rule (R3.5, R5.3). Valid.** Rule 3 calls container numbers "indicative" and section 2 says the machine is "shared with every agent". `reports/3a-reference.md` shows three runs of `katoomba3-fast` at 1050, 1099 and 1206 ms (a spread of about 15 % of the fastest) even with the heavy-work lock held, and "no repeat count above 3". Nothing says which numbers decide the gate or what must be repeated before a stop is reported. The owner does decide after a stop (rule 6), which limits the damage. Direction: say which numbers decide Gate 1, require repeats in a quiet window under the lock before a stop is reported, and give the spread next to each ratio.

**S5. The plan does not say how a `Parallel.For` form keeps the RNG draw order for kernels that draw random numbers (R1.2). Partly valid.** True for the RNG-consuming parts: `FireSpreadModel.ts` draws in `breachDraw` (line 1504), the debris loop (lines 1954 to 1984) and the VLS periods (line 1207), and the file header (line 33) says "all randomness from the fire RNG stream"; `EmberModel.ts` copies one stream into a local state (lines 411 to 412, 2246 to 2251). The plan's section 10 decision ports that draw order exactly, so those loops must stay in sequence and cap the parallel share. Overstated for the level-set advance: `levelSet.ts` has no RNG (grep printed nothing) and `apply` (lines 417 to 424) computes `tend1`, then writes `phiS`, then reads it again; each band cell depends only on read-only arrays, so it is parallel-friendly. Only the arrival hooks (band order) and `reinit` (fast sweeping, line 456 onwards) are inherently sequential. `atmosphere/solver.ts` has no RNG either. Direction: for each candidate kernel, say whether it draws, and drop or restrict the parallel form for the ones that do; note that the draw-exact decision limits the speed-up the whole solver can reach.

**S6. `Fs.Tests` has no owner and the thread-count test is placed in two places (R1.5). Valid.** Section 9 (dotnet-test row) adds `Fs.Tests` "for the thread-count test and the contract tests", but section 4 gives S0 five projects (no `Fs.Tests`), gives C3 the thread-count test with scope `Fs.Compare` only, and P3c-e scope `Fs.Kernel`. `prototypes/dotnet-b/` has no `Fs.Tests` (listing checked; `grep -rn "Fs.Tests"` finds only plan line 112). README says "Only touch your own folder", so no agent may create it. `SKILLS.md` gives C3 "comparison and tests". Direction: add `Fs.Tests` to the S0 skeleton and name one owner in the scope table; say whether the thread-count test lives there or in `Fs.Compare`.

**S7. Fixtures and the toolchain live only in a session scratchpad under hard-coded paths of another session, with no manifest (R1.8, R3.2, R5.6). Valid.** Rule 2 says fixtures "are kept in the scratchpad". `env.sh` line 3, `SKILLS.md` line 3 and `reports/3a-reference.md` line 8 all point to `/tmp/claude-0/-home-user-FireSim/3863bd8b-.../scratchpad/`, a different session's path. Stage 3, the phone steps and the verifier V span more than one session. Regeneration is possible (the exporter is committed and, per `3a-reference.md`, takes about a minute) but the plan does not name the command or a stable location, and the 3a files hold no fixture hash manifest (a node scan of `3a-results.json` found one hash-like string). Direction: name the regeneration command and a fixed fixture path in the plan, and commit a small hash manifest under `reports/` so a regenerated set can be checked.

**S8. The 30-seed TypeScript ensembles and the quiet-machine timings are needed but have no stage, agent or compute estimate (R5.2, R3.4). Valid.** Section 10 says "Still to run (not done by P3a): 30-seed TypeScript ensembles, standard and high at 6 km, and timings on a quiet machine." `3a-reference.md` confirms only 6, 4 and 2 seeds were run. Neither the section 3 stage table nor the section 4 agent table assigns them, and section 8 does not count them. The loose bar cannot be applied without them, and the quiet-machine timings are what S4 needs. Direction: give them a stage and an owner, and run the ensembles before the port starts, so the bar and its power are known first.

**S9. The loose bar (mean burnt area within 12 % over 30 seeds) has little power (R3.4). Valid.** The plan's own source `reports/3a-tier-difference.md` line 116 says the per-run cv is 19 to 27 %, the standard error of a difference of two 30-seed means "about 6 %", and "12 % is two of them". I ran a node calculation (details below). At cv 0.23 the standard error is 5.9 %, a correct port fails about 4 % of the time, and a port whose burnt area is 10 % off passes about 63 % of the time (61 to 66 % over cv 0.27 to 0.19). Direction: put the power figures in the report, or tighten the bar (more seeds, or a paired design), before it is allowed to stand in for the tight bar.

**S10a. "If the generator cannot be reproduced bit for bit" has no test and no named decision point (R3.4). Valid.** Section 10, last decision paragraph. Nothing defines the check, and the agent trying to meet the tight bar would be the one to say it failed. Direction: define the reproducibility check up front and have the orchestrator, not the port agent, make the call at a named point.

**S10b. Switching to the loose bar is taken as agreed, with no owner approval (R5.7). Partly valid.** R5.7 says a failed port "passes instead of stopping". That overstates it: the report must say so, and section 7 gives the owner the Gate 3 decision. What holds: section 3 says the owner may change thresholds "before a stage starts", while the fallback swaps the bar during stage 3 on the author's decision. Direction: say that the switch needs the owner's approval, or that Gate 3 reports against the tight bar first and the loose bar only as a second row.

**S11. Gate 2 passes if any transport works, but stage 4 builds the loopback route regardless (R5.8). Valid.** Stage 2 gate: "no transport sustains the rates". Stage 4: "the C# engine ... over loopback, so the page needs no change"; section 4 I4 builds "the shell with loopback engine". If only the interop route passes, stage 4 as written is not the design that passed. Stage 4 does compare against "the interop route that opens no socket", but nothing selects the transport. Direction: let Gate 2 name the transport that stage 4 builds, and say what happens if only one passes.

**S12. The report template omits the cost the owner named when D34 set .NET aside: two solvers to maintain (R4.4). Valid.** D34 (line 121): the .NET idea "was weighed with you and set aside because it means maintaining two solvers". Section 6 lists "one table per gate, what was not measured, and a recommendation"; section 7 says only that D34 "would then be reopened". Direction: add a short "cost of keeping two solvers" line to the report: who keeps the Gate 3 bars green on each TypeScript change, and how often fixtures and bars are re-run.

**S13. The plan is silent on iOS (R2.2). Partly valid.** The plan contains no mention of iOS (grep above). The repository's declared shell is "Capacitor 8 (Android + iOS)" (`docs/ARCHITECTURE.md` line 19) and the desktop host admits `capacitor://localhost`. Narrowing: README line 1329 says the iOS project "is not committed (it needs Xcode on macOS)", so the app does not ship on iOS today and "ships on iOS" in R2.2 is too strong. Even so, "practical to ship on a phone" will read as covering both unless the plan says otherwise. Direction: one line in section 1 and section 7 stating that iOS is out of scope and not measured.

**S14. Section 8 counts agent runs only (R5.4). Partly valid.** The owner's phone time is named in the pack's purpose as a decision cost, and section 5 lists several installs and paste-backs, but section 8 gives no count. It also gives no retry allowance and no compute time for the ensembles (S8) and benchmarks. The R5.4 claim that "ten" is below the plan's count is rejected (X2). Direction: add the expected phone round trips, a retry allowance and the heavy compute hours to section 8.

**N1 (own). The plan's environment table is stale against the repository (own). Valid.** Section 2 says the SDK is "Not installed" and "The plan installs the SDK from the official tarball". Section 9 says "the toolchain download" was already done, `env.sh` says "the .NET 11 SDK was installed (official tarball, SHA-512 checked)", and README (SDK section) gives the same. A reader cannot tell what is already on the machine, which makes M1 harder to act on. Direction: bring section 2 up to date with what has been downloaded and what has not.

### Optional

**O1. Lifecycle, backgrounding, process death and thermal state are in no gate (R2.4). Partly valid.** `docs/research/09-mobile-tech-stack.md` lines 112 to 131 record these risks for the current app. They hold for a C# engine too, but they are parity risks, not new ones, and a 10-minute foreground run is a proportionate prototype test. Direction: add a screen-off check to stage 4 if the owner wants it.

**O2. Desktop host requirements beyond the three named checks, and no desktop OS list (R2.5). Partly valid.** `desktop/` contains `openToken.ts`, `security.ts`, `lan.ts`, `sessionEstimate.ts`, `holdGate.ts` and the named e2e specs exist (`e2e/desktop-real.spec.ts`, `desktop-cross-origin.spec.ts`, `host-browser.spec.ts`, `desktop/link.mjs`). A prototype need not reproduce every host feature, but "protocol 2 met" is undefined for them. Direction: say which host behaviours the prototype must keep, and name the desktop OS and delivery form.

**O3. The Capacitor-plus-native-library shell is not weighed (R4.3). Partly valid.** Stage 5 lists "CoreCLR against the experimental NativeAOT on Android", so a native library is half-considered, but the plan never asks whether MAUI is needed. I did not verify that a C# engine can run behind Capacitor. Direction: one paragraph on the shell options in stage 4 or the report.

**O4. WebAssembly in the TypeScript project, and worker threads, are not weighed against C# (R4.2). Partly valid.** D34 and `air-slice-wind-detail-honest-speed.md` option 4 (line 1028) leave WebAssembly open for one hot loop. M2 covers threads. The plan's question is about B only, so a WebAssembly arm is scope growth. Direction: state in the report and section 7 that a Gate 1 pass does not rule out cheaper in-TypeScript routes.

**O5. Stage 1 re-profiles a scenario the repository has already profiled (R4.5). Valid but minor.** Line 1014 gives the fast-tier split (fire 58 %, embers 13 %, coupling 11 %, air 5 %) and the 3-D tiers (air 63 % and 82 %). A new profile is still useful for the 6 km scenario and for what the C# port will cover. Direction: cite the existing split and say what the new profile adds.

**O6. The saved-data origin check comes after the shell is built and cannot stop the project (R5.5). Partly valid.** Stage 5 is "Informational" and section 7 lists "the saved-data migration from stage 5" as remaining cost, so the owner is told. The loss of saved data under a new origin is close to certain (the 0.9.0 contract line 4.4 says changing the scheme "loses every saved site and run"), so an earlier check changes little. Direction: if the owner wants it as a stop condition, move it to stage 4.

**O7a. Gate 1 and Gate 3 desktop parts could run while phone results are pending (R1.4). Valid but minor.** Section 4 "Order" decides Gates 1 and 2 together and rule 6 waits for the owner. The owner controls the pace. Direction: say which desktop parts may proceed.

**O7b. No end state if the phone numbers never arrive (R3.7). Valid but minor.** No timeout or budget stop is given; note S7 (what is kept if the session ends). Direction: one line on how long a stage may wait.

**O8. The shared heavy-work lock serialises K1, P3a and T2 builds and benchmarks (R1.6). Valid but minor.** README says benchmarks and builds go under `flock`, so the "three agents in parallel" order gives little time saving for heavy work (P3a is already done by section 10). The lock does help K1's timings. Direction: say which steps are heavy.

**O9. No target branch or undo for a stage merge is named (R3.6). Valid but minor.** Section 4 says "merges with `--no-ff`", section 6 says "the designated branch". Rule 1 limits changes to `prototypes/dotnet-b/`, so undo is simple. Direction: one line.

**O10. Gate 1 wording can be read as a time ratio or a speed ratio (R1.7). Valid but minor.** "All-core C# is under 1.5x the TypeScript" is probably meant as a speed-up. Direction: write it as "speed-up (TypeScript time over C# time) below 1.5x"; do this with M2.

**O11. The Android floor is already fixed in the repository (R2.8). Valid but minor.** README line 1348 and `09-mobile-tech-stack.md` line 186 give WebView 108 and API 24. Stage 5 lists "Android 7.0 (API 24) floor" as something to check, which matches, but does not mention WebView 108. Direction: add it.

**O12. The stage 2 test app opens a loopback socket on the owner's phone before the exposure is written up in stage 4 (R3.3). Partly valid.** The buffers are synthetic, so the risk is low. Direction: bind the listener to 127.0.0.1 only and stop it after the run.

**O13. `meta.gitCommit` of the fixtures predates the exporter's commit (R3.2). Valid but minor.** `3a-reference.md` line 77 confirms it. The 15-hash anchor and the three-process determinism check cover the solver path. Direction: covered by the S7 manifest.

**O14. The airplane-mode run names no scenario (R2.6). Valid but minor.** Direction: name the scenario in the stage 4 gate.

**O15. How the owner's sideloaded APKs are signed and delivered is not stated (R2.3, R5.1). Valid but minor.** Debug builds are signed with a local debug key. Direction: say how the owner receives and checks the APK; do this with M1.

**O16. The phone conditions in rule 3 omit thermal state, power mode and WebView version (R2.4, R2.7). Valid but minor.** `09-mobile-tech-stack.md` item 5 says thermal and power state are invisible to web code and WebKit halves the frame rate under Low Power Mode. Direction: add them to rule 3 for phone numbers.

**N2 (own). Rule 4 cites "plan section 4, rules 1 and 2", which is not this plan's section 4 (own). Valid but minor.** This plan's section 4 is "Agents, scopes and order". The reference points to `docs/plans/air-slice-wind-detail-honest-speed.md` section 4, "Ground rules", rules 1 ("Results never depend on speed ...") and 2 ("No silent degradation"). The "1, 2, 4 and 8 threads" requirement is not in those rules in those words. Direction: name the file.

## C. Rejected findings

- **X1 (R2.6, first part: "the plan never says where the C# engine gets weather, terrain, canopy or area-pack data").** Rejected. The engine takes its data from the protocol 2 start message. `ts-export/README.md` lists the `init` message fields (`terrain`, `fuel`, `weather`, `terrainHiRes`, `fuelHistory`); section 3 stage 3b says "decode the start message"; the page builds that message. Area packs are page-side, so the transport tests do not need a native read path. (The unnamed airplane scenario is kept as O14.)
- **X2 (R5.4, first part: "ten is below the plan's own count of 12").** Rejected. Section 8 says "about ten to twelve", and the section 4 table gives ten rows, so the count is ten if P3c-e is one agent and twelve if it is split into three (section 3, "3c to 3e"). The range matches both.

## D. Ledger
| ID | Priority | Verdict | Reviewer ids | Claim |
|---|---|---|---|---|
| M1 | Must fix | Valid | R1.1, R2.3, R3.1, R5.1 | The plan downloads toolchains with no owner approval step, ignores the owner's antivirus and signed-files rule, and takes a second route after a refusal |
| M2 | Must fix | Valid | R4.1 | Gate 1 compares all-core C# with one-thread TypeScript, so threading alone (1.8x to 2.6x estimated) can pass it |
| S1 | Should fix | Partly valid | R2.1 | "The page needs no change" ignores Capacitor use in 9 non-test files (14 with tests); stage 4 gate does not test live fetch, location or saved data |
| S2 | Should fix | Partly valid | R1.3 | Loopback ws:// from the MAUI page has cleartext, mixed-content and origin prerequisites that the plan does not name; shell behaviour not checked |
| S3 | Should fix | Valid | R2.7 | The phone half of Gate 1 has no TypeScript baseline measured on the phone |
| S4 | Should fix | Valid | R3.5, R5.3 | Gate 1 can stop the plan on indicative shared-machine numbers with no margin or re-measure rule |
| S5 | Should fix | Partly valid | R1.2 | Parallel.For form cannot keep RNG draw order for the draw-consuming code; the level-set loops and atmosphere solver are RNG-free |
| S6 | Should fix | Valid | R1.5 | Fs.Tests has no owner or scope, and the thread-count test is placed in both C3 and Fs.Tests |
| S7 | Should fix | Valid | R1.8, R3.2, R5.6 | Fixtures and toolchain sit in another session's scratchpad path, with no regeneration command or hash manifest |
| S8 | Should fix | Valid | R5.2, R3.4 | The 30-seed ensembles and quiet-machine timings are needed but have no stage, owner or cost |
| S9 | Should fix | Valid | R3.4 | The 12 % loose bar has low power: about 4 % false fail and about 63 % pass for a port 10 % off |
| S10a | Should fix | Valid | R3.4 | "Cannot be reproduced bit for bit" has no test and no named decision point |
| S10b | Should fix | Partly valid | R5.7 | Switching to the loose bar needs the owner's approval or a second report row; "passes instead of stopping" is overstated |
| S11 | Should fix | Valid | R5.8 | Gate 2 passes on any transport but stage 4 builds the loopback route regardless |
| S12 | Should fix | Valid | R4.4 | The report omits the two-solver maintenance cost the owner named in D34 |
| S13 | Should fix | Partly valid | R2.2 | The plan is silent on iOS; no iOS project is committed, so state it out of scope |
| S14 | Should fix | Partly valid | R5.4 | Section 8 omits owner phone round trips, retries and compute for ensembles and benchmarks |
| N1 | Should fix | Valid | own | Section 2 says the SDK is not installed; section 9, env.sh and README say it was installed |
| O1 | Optional | Partly valid | R2.4 | Lifecycle, backgrounding and thermal checks are in no gate (parity risks with the current app) |
| O2 | Optional | Partly valid | R2.5 | Desktop host safety behaviours and OS list are not carried into "protocol 2 met" |
| O3 | Optional | Partly valid | R4.3 | A Capacitor shell with a native library is not weighed; feasibility not verified |
| O4 | Optional | Partly valid | R4.2 | WebAssembly in TypeScript and worker threads are not weighed against C# |
| O5 | Optional | Valid but minor | R4.5 | Stage 1 re-profiles a scenario whose split is already recorded |
| O6 | Optional | Partly valid | R5.5 | The saved-data origin check is late and informational; loss is near certain anyway |
| O7a | Optional | Valid but minor | R1.4 | Desktop-only parts of Gates 1 and 3 could run while phone results are pending |
| O7b | Optional | Valid but minor | R3.7 | No timeout or end state if the owner's phone numbers never arrive |
| O8 | Optional | Valid but minor | R1.6 | The heavy-work lock serialises the parallel stages for heavy steps |
| O9 | Optional | Valid but minor | R3.6 | No target branch or stage undo is named |
| O10 | Optional | Valid but minor | R1.7 | Gate 1 wording is ambiguous between time ratio and speed ratio |
| O11 | Optional | Valid but minor | R2.8 | WebView 108 floor is not mentioned next to the API 24 floor |
| O12 | Optional | Partly valid | R3.3 | The stage 2 app opens a loopback socket on the phone before exposure is written up (synthetic data only) |
| O13 | Optional | Valid but minor | R3.2 | Fixture meta.gitCommit predates the exporter commit |
| O14 | Optional | Valid but minor | R2.6 | The airplane-mode run names no scenario |
| O15 | Optional | Valid but minor | R2.3, R5.1 | How the sideloaded debug APKs are signed and delivered is not stated |
| O16 | Optional | Valid but minor | R2.4, R2.7 | Phone conditions in rule 3 omit thermal state, power mode and WebView version |
| N2 | Optional | Valid but minor | own | Rule 4 cites "plan section 4, rules 1 and 2", which is another plan's section |
| X1 | None | Rejected | R2.6 | The plan never says where the C# engine gets its terrain, weather and fuel data |
| X2 | None | Rejected | R5.4 | The estimate "ten" is below the plan's own count of 12 agent slots |

## E. Overall call

Fix the must-fix items and resend. Two items block a decision: the download and approval handling (M1), and Gate 1 as a test of C# (M2). The should-fix list is mostly one-sentence edits to scope, ownership and gate wording; S1, S3 to S5 and S8 to S11 are the ones that most change what the owner reads as "pass". The plan's structure (stages, gates, rule 6 stop, a bounded folder) is sound and no reviewer found a reason to rethink it.

## Commands run

- `grep -n -i -E "ios|apple|app store|antivirus|signed|signature" docs/plans/dotnet-option-b-prototype.md`: printed nothing. `grep -c -i capacitor` on the plan: 1 (stage 5 only).
- `grep -rln -E "@capacitor|Capacitor\." src`: 14 files; 9 are not test files (list in S1).
- `wc -l` on `FireSpreadModel.ts`, `EmberModel.ts`, `solver.ts`: 1991, 2271, 880 (the plan's figures are right).
- `grep -n -E "rng\.(next|poisson|range|normal)" src/fire/spread/FireSpreadModel.ts`: lines 1207, 1504, 1954, 1976, 1981, 1984. The same pattern on `levelSet.ts` and `atmosphere/solver.ts`: no matches.
- Line count of `.ts` under `src/sim`, `src/fire`, `src/embers`, `src/atmosphere`, `src/core`: 26,005 lines outside test files and 14,098 in test files. That is close to the plan's "about 25,000 lines and 15,000 lines of tests" for those folders, though the plan does not name the folders (R1 and R5 could not check this; it is a corroboration, not a finding).
- `ls prototypes/dotnet-b` and `grep -rn "Fs.Tests" prototypes docs/plans/dotnet-option-b-prototype.md`: no `Fs.Tests` folder; the only hit is plan line 112.
- `node` arithmetic for S9, standard error = sqrt(2) * cv / sqrt(30): cv 0.19, 0.23, 0.27 gave standard errors of 4.9, 5.9, 7.0 %; false-fail rate for a 12 % bar of 0.014, 0.043, 0.085; chance a port 10 % off passes 0.66, 0.63, 0.61.
- `grep` of the 3a files for the three repeat timings: 1050, 1099, 1206 ms at `3a-reference.md` line 62.

I could not check: the artifact; MAUI WebView behaviour for `ws://127.0.0.1` or for the Capacitor-dependent code paths; whether the Android or MAUI builds work; the Vitest configuration (`vite.config.ts` is named by `tsconfig.json` but is not in the snapshot, so rule 1's Vitest claim stays unverified; `prototypes/` holds no `*.test.*` or `*.spec.*` file today); download sizes or network access.
