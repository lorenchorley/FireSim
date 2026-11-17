# R5 | plans / Cost and commitment

### R5.1 Section 8's cost estimate predates Revisions 1 and 2 and counts only agent runs
- Where: docs/plans/dotnet-option-b-prototype.md line 97: "About ten to twelve agent runs if every gate passes, fewer if one fails early."
- Evidence: Section 4 has 10 rows, and P3c-e is "split by area" (three agents, per "3c to 3e" in section 3), so 12 is the floor before any retry. The estimate leaves out gate-failure reruns; the V verifier's re-runs (V is "all" stages); the 30-seed TypeScript ensembles and the 6 km high-tier runs that Revision 2 lists as "still to run" (line 136); the compute time for those on a 4-core shared machine (section 2, line 24); and the exact random-stream and ember port that Revision 2 made the default for stage 3 (line 134), the largest single item in the plan. Section 8 sits above both revisions and was not updated.
- Already covered?: Partly. Section 8 names stage 3 and the Android build as expensive and says "fewer if one fails early". That gives direction, not the omitted items, so the figure the owner reads is not the real cost.
- Severity: should-fix
- Confidence: high
- Suggested change: Re-estimate per stage after Revisions 1 and 2, with a retry allowance and the TypeScript compute hours for the 30-seed runs, and state the figure as agent runs plus compute.

### R5.2 "A large use of the weekly budget compared with the earlier lanes" has no figure behind it
- Where: line 97: "This is a large use of the weekly budget compared with the earlier lanes; the gates exist so that a failed stage stops it early."
- Evidence: The pack names no budget and no earlier-lane run counts. A search of every .md file in the snapshot for "weekly budget" and "earlier lanes" finds nothing; the only "budget" hits are render and triangle budgets. The comparison cannot be checked, yet the owner is asked to weigh it.
- Already covered?: No. The sentence states a conclusion and gives no baseline.
- Severity: should-fix
- Confidence: high
- Suggested change: Give the budget and the earlier lanes' run counts with a source, or drop the comparison and state the agent-run and compute numbers from R5.1.

### R5.3 Owner phone rounds gate the schedule and are not costed
- Where: section 5 (lines 74-78): install and run the APKs, "paste them back", "If it fails, the agents write exact build instructions and the owner builds"; section 3 gates: Stage 1 "Container, then phone", Stage 2 "Build in container, run on phone", Stage 4 "run on phone" with a 10-minute run, Stage 5 "Container + phone".
- Evidence: The pack's purpose says the owner decides whether agents spend "the owner's phone time". That is at least four phone rounds, and one more if the MAUI Android build fails and the owner must build. Section 8 counts only agent runs. Section 4's order has no phone step, and the plan does not say how long a stage waits for the owner.
- Already covered?: No. Section 5 lists the tasks, not what they cost the owner or how the schedule absorbs the wait.
- Severity: should-fix
- Confidence: high
- Suggested change: Add a phone-round count and owner time per round to section 8, and place the phone steps in the section 4 order.

### R5.4 Gate 1 decides entry into stage 3 from numbers that rule 3 calls indicative
- Where: section 1 rule 3 (line 11): "Container numbers are desktop-class and noisy (4 shared cores, 16 GB) and are labelled *indicative*." Section 3, Stage 1 gate (line 34) "Container, then phone"; section 4 (line 72): "Gate 1 and Gate 2 are decided together from K1 and T2. If both pass, P3b, then P3c-e and C3, then Gate 3."
- Evidence: Section 4 does not say whether the phone numbers must exist before P3b starts, so a container-only pass could start stage 3, which is the bulk of the cost (section 8). Revision 2 still lists "timings on a quiet machine" as not done (line 136), and section 2 says the machine is shared with every agent.
- Already covered?: Partly. Rule 3 labels the numbers, but nothing ties that label to the gate decision.
- Severity: should-fix
- Confidence: medium
- Suggested change: State that stage 3 does not start until the phone side of Gate 1 is in; or mark a container-only pass as provisional and allow stage 3 only after a quiet-machine re-run.

### R5.5 The origin and saved-data cost is measured last and cannot stop the work
- Where: section 3 table, Stage 5 (line 38): "Informational: produces the list the owner decides from"; section 3 Stage 5 detail (line 53): saved sites and runs "live in the WebView origin, `https://localhost` under Capacitor (kept on purpose in 0.8.0). A MAUI shell serves from a different origin."; section 7 (line 93): "All pass | B is technically feasible."
- Evidence: The plan itself says the origin change would move where saved data lives, and that the origin was kept on purpose in 0.8.0. Stage 4 builds the MAUI shell, which serves from the different origin, before stage 5 measures what survives. Stage 5 cannot fail a gate, so all five gates can pass and section 7 still reads "B is technically feasible" while the migration cost is open. Section 7 does list "the saved-data migration from stage 5" as remaining cost, so the risk is named but not gated.
- Already covered?: Partly. Section 7 names the migration as remaining cost. It does not say the owner should decide on it before the stage 4 spend.
- Severity: should-fix
- Confidence: high
- Suggested change: Move the origin and data-survival test before stage 4 as a gate, or change section 7's "All pass" row to say that feasibility excludes the migration.

### R5.6 Stage 0 is planned around a refused action, and the owner is not asked before the workaround
- Where: section 2, line 25: "Running the downloaded `dotnet-install.sh` was refused by the auto-mode classifier. The plan installs the SDK from the official tarball instead."; section 9, line 109 repeats it.
- Evidence: The refusal is recorded as a fact, and the first move is a different route to the same install. Only if that route is also refused does stage 0 stop for the owner. The plan does not establish whether the classifier's refusal was a glitch or a policy decision, and it does not ask before trying the alternate route.
- Already covered?: Partly. The plan records the difference and the fallback stop, but not the owner's sign-off before the workaround.
- Severity: should-fix
- Confidence: medium
- Suggested change: Ask the owner before stage 0 runs the tarball route, or record the refusal's reason first and continue only if it was not a policy decision.

### R5.7 Toolchain and fixtures live in session scratchpads, not in the repository
- Where: section 1 rule 2 (line 10): fixtures "are not committed ... They are kept in the scratchpad." prototypes/dotnet-b/README.md line 24: "Keep fixtures in the scratchpad path the lane brief names." prototypes/dotnet-b/env.sh lines 2-3: `DOTNET_ROOT=/tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/dotnet-sdk`.
- Evidence: The SDK path in env.sh is in a different session's scratchpad (3863bd8b...) from this review's (87003abe...). Either it is a stale copy or a path a later session will not have. Either way, a new session must reinstall the SDK and rerun the 41 TypeScript fixture folders and the 30-seed ensembles before stage 1, stage 3 or the verifier's re-run can start. None of that compute appears in section 8.
- Already covered?: Partly. The plan says fixtures are not committed and names the scratchpad. It does not cost regeneration or say what happens when the scratchpad is gone.
- Severity: should-fix
- Confidence: medium
- Suggested change: Record in the plan how a new session rebuilds the SDK and fixtures (exporter command and compute time), and have env.sh take its path from setup rather than a hard-coded session.

### R5.8 Toolchain versions are unpinned, so the numbers may not be reproducible
- Where: prototypes/dotnet-b/global.json: `"rollForward": "latestFeature"`; section 9, line 108: "`dotnet add package BenchmarkDotNet` without a version"; section 1 rule 3 (line 11).
- Evidence: Rule 3 lists the conditions to record: machine, cores, run count, median and spread. It does not list the SDK patch version or the package versions. With latestFeature roll-forward and an unversioned BenchmarkDotNet, a later run (the V verifier's re-run in section 4, or a stage 3 comparison against stage 1 numbers) can use a different toolchain and produce different numbers with no record of the change.
- Already covered?: No. Rule 3 covers machine conditions only.
- Severity: should-fix
- Confidence: low
- Suggested change: Pin the SDK patch in global.json and the BenchmarkDotNet version in the project, and record both in every results file.

Totals: 8 findings (must-fix 0, should-fix 8, nitpick 0)
Checked and found correct:
- FireSpreadModel.ts is 1,991 lines, as section 3 says.
- global.json is under prototypes/dotnet-b/, so the section 1 rule 1 scope holds for that file; there is no repository-root global.json.
- No package versions are pinned in any csproj yet, so nothing unversioned has been committed.
- The scope statement (the "what this is not" paragraph and section 1 rule 1) matches the prototype README's rules.
- The three named solver modules (fire, embers, atmosphere) total 17,017 non-test source lines and 6,844 test lines, so the plan's sizes are plausible in order of magnitude.
Could not check:
- The "FireSim on .NET" artifact (not available to this review); claims that rest only on it are unverified.
- The earlier lanes' run counts and any weekly budget (not in the pack or the snapshot).
- The "about 25,000 lines and 15,000 lines of tests" port figure: the plan does not state which modules count as "the solver", so the figure cannot be reproduced.
Verdict: Fix first
