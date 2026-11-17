# R2 | plans / Missing requirements

### R2.1 The plan never mentions the project's offline and network-audit rules, which a MAUI shell or a .NET HTTP client would touch
- Where: The plan has no occurrence of "offline", "network" or "audit". Stage 4 (plan line 51) gates only "Not standalone in airplane mode" and "protocol 2 not met".
- Evidence: `docs/plans/air-slice-wind-detail-honest-speed.md` line 1636 keeps ground rule 6, "Offline. No network calls from any new code", with two web-only exceptions. `README.md` line 281 documents what the Android app sends: "No account and no custom header is sent". The 0.8.0 J contract names a network-audit e2e spec. A new .NET shell or HttpClient is new code that makes requests, and the plan does not say how it passes the audit or keeps that header promise.
- Already covered?: No. Stage 4's airplane-mode test shows the engine runs offline. It does not check that the shell's network footprint matches the current app's.
- Severity: should-fix
- Confidence: high
- Suggested change: Add the network-audit spec and a request-footprint check (URLs, headers, User-Agent) to the Stage 4 gate, and state whether ground rule 6 applies to the prototype.

### R2.2 "Practical to ship" is answered for Android only, and the plan never says iOS is out of scope
- Where: Purpose (pack): "practical to ship". Plan line 38: "Can it replace the current APK?". Plan line 53: "`https://localhost` under Capacitor". Section 7 line 93: "All pass | B is technically feasible."
- Evidence: `README.md` line 1328 says "`@capacitor/ios` installed", lines 1338-1339 describe the iOS project, and line 1348 gives "iOS 16+". On iOS the origin is `capacitor://localhost` (`README.md` line 1346; `desktop/README.md` line 90). The plan's gates, API floor and origin discussion all cover Android only.
- Already covered?: No. Nothing in the plan says iOS is out of scope.
- Severity: must-fix
- Confidence: high
- Suggested change: State that the question is Android-only and that "All pass" means Android only, or add an iOS row to Stage 5 (MAUI iOS build, WKWebView origin, saved-data survival).

### R2.3 The plan drops the repo's licence and attribution duties for a new shell and new packages
- Where: Section 6 (Deliverables) and the Stage 5 row (plan lines 38 and 53) list no credits, licence or attribution item.
- Evidence: `README.md` line 1640: "Bundled data keep their own licences ... CC BY 4.0 requires attribution". The app shows these on Settings, "Data and licences", from `ATTRIBUTIONS` in `src/ui/content.ts` line 438, and a test pins them (`src/ui/settingsScreen.test.ts` line 18). The plan adds a MAUI shell and NuGet packages (BenchmarkDotNet, MSTest, MAUI) and has no licence check for any of them.
- Already covered?: No. Rule 1 (plan line 9) is a folder-scope rule, not a licence rule.
- Severity: should-fix
- Confidence: high
- Suggested change: Add to Stage 5 that a shipped shell carries the same credit lines and that each new package has a licence check.

### R2.4 The owner's stated reason for one solver is not carried into the cost of a second solver
- Where: Plan line 5: "Decision D34 (one solver, in TypeScript) stays in force until the owner says otherwise after the report." Section 7 line 93: "The remaining cost is the port of the rest of the solver ..., the Razor screens if wanted, and the saved-data migration from stage 5."
- Evidence: The D34 row in `docs/plans/air-slice-wind-detail-honest-speed.md` line 121 says the .NET idea was "set aside because it means maintaining two solvers". The TypeScript solver keeps changing (plans exist for 0.6.0 to 0.10.0). The agreement bars (plan lines 48 and 128-132) are set against one snapshot. Nothing says who keeps the C# solver matched to later TypeScript changes, or what that costs.
- Already covered?: No. Section 7 names the one-off port cost, not the upkeep cost, and the plan's answer to D34 is only that the owner reopens it.
- Severity: should-fix
- Confidence: high
- Suggested change: Add a "parity upkeep" line to section 7: the cost per TypeScript release to re-run the fixture comparison, and who owns it, so the owner decides with the second-solver cost in view.

### R2.5 "Fast enough" has no stated target, and the Stage 1 bar can be read in either direction
- Where: Plan line 34, Stage 1 gate: "All-core C# is under 1.5× the TypeScript on desktop, or under 2.0× on the phone". Purpose (pack): "fast enough".
- Evidence: The gate does not say whether 1.5× is a speed-up or a time ratio. No user-facing target (run time, time per simulated minute, battery) is given. `docs/plans/air-slice-wind-detail-honest-speed.md` line 126 (D39) says threads reach "about 2 to 2.6 times on four cores at best", the bar a C# port would have to beat, and the plan does not mention it.
- Already covered?: No. Section 3 says "Thresholds are proposals", but not what they are measured against.
- Severity: should-fix
- Confidence: medium. The ambiguity is my reading of the wording; the missing baseline is firm.
- Suggested change: Write the Stage 1 gate as a speed-up ("at least 1.5× faster than the TypeScript, C# time at most 1/1.5 of TypeScript time") and name the 2 to 2.6× thread figure as the comparison the owner should weigh.

### R2.6 The fixtures live only in the scratchpad, which is per session, and nothing names a durable home for the gate evidence
- Where: Plan line 10: "They are not committed (they are megabytes); the exporter is. They are kept in the scratchpad." Also `prototypes/dotnet-b/README.md`: "Keep fixtures in the scratchpad path the lane brief names."
- Evidence: The environment note says the scratchpad is session-specific. Section 4 puts agents in separate git worktrees, and the verifier V must "re-run one number per stage" (plan line 70), which needs the same fixtures. The 41 fixture folders (line 119) and the 30-seed ensembles (line 136) have no stated location, seed list or content hash.
- Already covered?: Partly. The exporter is committed (rule 2), so regeneration is possible in principle. The plan does not pin the exporter's inputs (scenarios, seeds, tiers) or say how the owner re-runs a gate after the session ends.
- Severity: should-fix
- Confidence: medium
- Suggested change: Name a durable, git-ignored fixture location outside any session, and commit a manifest per fixture folder with scenario, seed, tier and content hash.

### R2.7 The phone budgets the repo already tracks, including battery, are not gates
- Where: Plan line 38 (Stage 5): "Informational: produces the list the owner decides from". Plan line 42 (Stage 2) measures memory, GC pauses and dropped frames, but no battery or heat.
- Evidence: `docs/ARCHITECTURE.md` line 1718 is headed "Performance budgets (phone, battery, APK size)" and sets budgets such as "Setup <= 350 (1x)", "Scenario build to first frame ... <= 3500" and "debug APK ... <= 33". `README.md` line 172 treats battery as a design goal ("to save battery"). Research note 09 (line 125) covers iOS thermal state. None of these is a plan gate. Only APK size is carried into Stage 5 (line 53).
- Already covered?: Partly. APK size (Stage 5) and memory (Stage 2) are covered. Battery, heat, start-up and scenario-build budgets are not.
- Severity: should-fix
- Confidence: medium
- Suggested change: Add a phone battery and thermal measurement under a fixed run to Stage 2 or 4, and reuse the existing start and scenario-build budgets as ship bars in Stage 5.

### R2.8 The release checks that gate the current APK are not mentioned, so a replacement has no stated path through them
- Where: Plan line 38 (Stage 5) and line 53 list APK size, start-up, memory, origin and API floor only.
- Evidence: `scripts/build-android-apk.sh` runs `scripts/check-android-apk.mjs` last. That script checks the network security config and the Capacitor config, and its header says a manifest or sync change "fails the build". `npm run check:bundle` enforces the 1060 kB gzip JS budget (D37, `docs/plans/air-slice-wind-detail-honest-speed.md` line 124). A MAUI APK would fail or skip these checks, and the plan does not say whether they are replaced or retired.
- Already covered?: No. Stage 5 is informational.
- Severity: should-fix
- Confidence: medium
- Suggested change: List in Stage 5 which repo release checks a replacement must pass and which it replaces, with the owner's decision on each.

Totals: 8 findings (must-fix 1, should-fix 7, nitpick 0)
Checked and found correct:
- The Stage gates in section 3 and the outcome table in section 7 agree: each gate failure has a stated consequence.
- Plan line 5 on D34 matches the D34 row in `docs/plans/air-slice-wind-detail-honest-speed.md` line 121.
- The 33 MB APK figure matches `docs/ARCHITECTURE.md` and D37.
- The `https://localhost` origin for Android (plan line 53) matches `desktop/README.md` line 90.
- The folders in the `prototypes/dotnet-b/README.md` layout table (Fs.Compare, Fs.Bench, Fs.Host, Fs.Transport, ts-export) exist in the snapshot.
Could not check:
- The "FireSim on .NET" artifact (https://claude.ai/artifact/VsrSVEJaknFbyWuQh7Svx9) is not available to this review.
- Whether `tsconfig.json` and the Vitest config exclude `prototypes/dotnet-b/` (rule 1) was not read.
- Whether an iOS project exists in the repo: the snapshot has no `ios/` folder, and the README says it is created on macOS.
Verdict: Fix first
