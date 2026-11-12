# R3 | plans / Failure modes and rollback

### R3.1 The plan routes around a refused SDK install
- Where: Section 2, Permission row (line 25): "Running the downloaded `dotnet-install.sh` was refused by the auto-mode classifier. The plan installs the SDK from the official tarball instead ... If that is refused too, stage 0 stops and the owner decides."
- Evidence: A safety control refused a download. The plan keeps the same SDK, fetched by another route, and allows one more attempt before the owner is asked. The only integrity check is the SHA-512 from `releases.json` on the same host as the tarball (`prototypes/dotnet-b/README.md` lines 19-20), so it catches corruption, not a tampered host. The owner's global instructions (in this session's context, not re-read) say that while antivirus is off, only signed files from trusted sources may be downloaded and the owner must be asked first. The plan has no owner-approval step before stage 0, and none before the Android SDK, JDK, MAUI workloads or NuGet packages listed in Section 2 and Section 5.
- Already covered?: Partly. Line 25 makes the owner the fallback after a second refusal, which treats the refusal as an obstacle to route around, not as a stop.
- Severity: must-fix
- Confidence: high on the text; medium on the policy reading
- Suggested change: Make a refusal a stop, add "owner approves each download or install" to the stage 0 gate, and delete the tarball fallback unless the owner approves it.

### R3.2 Fixtures and toolchain live only in session scratch, under dead hard-coded paths
- Where: Rule 2 (line 10): "They are kept in the scratchpad." `prototypes/dotnet-b/env.sh` line 3 and `README.md` (SDK section) point at `/tmp/claude-0/-home-user-FireSim/3863bd8b-.../scratchpad/`; `reports/3a-reference.md` line 8 does the same for the 41 fixtures; `SKILLS.md` line 3 for the dotnet/skills clone.
- Evidence: The scratchpad is per session. The session id in those paths is not this run's session, so a later session finds the SDK, fixtures and clone missing. Recovery of fixtures is possible: the exporter regenerates them in about a minute (`3a-reference.md`, Commands). But `meta.gitCommit` is the solver HEAD before the exporter was committed (`3a-reference.md` line 77: "the exporter files were uncommitted then"), so regenerated fixtures are not checked against the ones the report was built on. Only the 15-hash anchor checks the solver path. SDK recovery means the download that R3.1 is about.
- Already covered?: No. "Reinstall, see README" (env.sh line 2) depends on that download, and no fixture manifest is kept in `reports/`.
- Severity: should-fix
- Confidence: high
- Suggested change: Commit a small manifest (SHA-256 of each fixture file, or the existing `hashes.json` per folder) under `reports/`, have `run.mjs verify` check against it, and state in the plan that the scratchpad is not durable.

### R3.3 Stage 2 opens a loopback socket on the owner's phone, but its exposure is only written up in Stage 4
- Where: Stage 2 detail (line 42), option (c): "a loopback WebSocket from an in-app Kestrel server". Stage 4 detail (line 51): "Loopback exposure on a phone (other apps can reach 127.0.0.1) is measured and written up".
- Evidence: Section 5 has the owner sideload and run the stage 2 APK. The exposure exists from stage 2, but the Stage 2 gate (line 35) has no security criterion, and the write-up comes three stages later.
- Already covered?: No. Stage 4 covers the design that ships, not the test app already on the phone.
- Severity: should-fix
- Confidence: high
- Suggested change: Add to the stage 2 gate that the listener is bound to 127.0.0.1 only, stopped after the run, and its exposure is written up before the owner installs the APK. Or drop option (c) from stage 2.

### R3.4 The Stage 3 fallback bar is weak, and its trigger is undefined
- Where: Section 10 table (line 132): "the mean burnt area over 30 seeds within 12 % of the TypeScript mean". Decision (line 134): "If the generator cannot be reproduced bit for bit, the loose ensemble bar applies and the report says so."
- Evidence: `reports/3a-tier-difference.md` line 116 gives a per-run CV of 19 to 27 % and a standard error of about 6 % for the difference of two 30-seed means. By the report's own figures, 12 % is two standard errors. A correct port fails about 5 % of the time, and a port 10 % off in burnt area passes about 60 % of the time (approximate normal calculation). The 30-seed ensembles are "still to run" (line 136), so this bar has never been applied to anything. Nothing defines "cannot be reproduced", and the port agent, who is trying to meet the tight bar, is the one who would make that call.
- Already covered?: Partly. Line 134 requires the report to say so, and Section 7 gives the owner the Gate 3 decision. The owner is not given the power figures, and nothing limits the switch to a named decision point.
- Severity: should-fix
- Confidence: medium (the power figures are my approximation from the report's standard error)
- Suggested change: Define the reproducibility check before the port starts, have the orchestrator decide it, run the 30-seed ensembles before porting, and put the loose bar's detection power in the report.

### R3.5 A stop at Gate 1 or Gate 2 rests on single noisy container runs, with no re-measure rule
- Where: Section 3, Stage 1 gate (line 34): "stop if All-core C# is under 1.5× the TypeScript on desktop, or under 2.0× on the phone". Rule 6 (line 14): "Stop at a failed gate." Rule 3 (line 11): container numbers are "indicative".
- Evidence: `3a-reference.md` line 76: no run on a quiet machine or a phone, and no repeat count above 3. Repeats of the same `katoomba3-fast` run gave 1050, 1099 and 1206 ms, a spread of about 15 %. Gate 1 is a single ratio from that container, and a ratio near 1.5 can cross it on ordinary noise. Section 4 (line 72) decides Gates 1 and 2 from one K1 and one T2 pass.
- Already covered?: Rule 3 labels the numbers as indicative, but the plan never says a fail must be confirmed before a stop is reported, so the label does not change the stop decision.
- Severity: should-fix
- Confidence: medium-high
- Suggested change: A failed gate is re-measured with repeats, in a quiet window under the lock, before the orchestrator reports a stop. The report gives the spread next to each ratio.

### R3.6 No target branch and no revert path for stage merges
- Where: Section 4 (line 57): "merges with `--no-ff`". Section 6 (line 82): "committed to the designated branch". The plan never names the branch.
- Evidence: Rule 1 (line 9) limits the blast radius to `prototypes/dotnet-b/`, and line 5 says the app is untouched. The plan does not say how a stage is undone: deleting the folder, or reverting the stage merge.
- Already covered?: Partly, by rule 1 and line 5.
- Severity: nitpick
- Confidence: medium
- Suggested change: One line naming the target branch and the undo for a stage (revert the merge, or delete `prototypes/dotnet-b/`).

### R3.7 No end state when the owner's phone never returns numbers
- Where: Section 5 (line 76), and the phone-dependent gates at lines 34, 35 and 37. Section 8 (line 97) gives a cost estimate with no cap.
- Evidence: Gate 1 (phone, 2.0×) and Gate 2 can only be decided from the owner's phone. Rule 6 says the orchestrator waits. No time limit, default or budget stop is given, and the material the work depends on sits in session scratch (R3.2), which may be gone when the numbers arrive.
- Already covered?: Partly, by "waits for the owner" (rule 6). There is no timeout.
- Severity: nitpick
- Confidence: medium
- Suggested change: State how long a stage may wait for phone numbers and what is kept (the R3.2 manifest) if the session ends in the meantime.

Totals: 7 findings (must-fix 1, should-fix 4, nitpick 2)
Checked and found correct:
- `tsconfig.json` `include` is `src, tests, e2e, desktop, vite.config.ts, playwright.config.ts, capacitor.config.ts`, so `prototypes/` is outside `tsc --noEmit`, which `npm run typecheck` and `build` run. Rule 1's TypeScript-gate claim holds for that gate.
- `Directory.Build.props` is only in `prototypes/dotnet-b/`, and the snapshot has no root `Directory.Build.props`, so the C# settings do not leak into the app.
- The exporter reproduces the 15 anchor hashes exactly (`3a-reference.md`, regression anchor), so a regeneration fault would show on that scenario.
- The 3a determinism check (three processes, 31 identical hashes each) shows the thread-count and run-to-run test can detect the failure it targets.
- Section 7 maps each gate outcome to a decision, so a failed gate has a defined consequence.
Could not check:
- No `vitest.config.*` or `vite.config.*` is in the snapshot, so the claim that Vitest does not pick up `prototypes/` is unverified.
- The lane briefs that `README.md` line 24 says hold the fixture path were not in the pack.
- Whether the MAUI and Android builds work here. The plan concedes this (Section 5).
Verdict: Fix first
