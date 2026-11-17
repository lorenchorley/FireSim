# R5 | plans / Cost and commitment

### R5.1 Stage 5 finds the saved-data and origin cost last, after the MAUI shell is built
- Where: line 53, "Stage 5 detail. Origin and saved data: the app's saved sites and runs live in the WebView origin, `https://localhost` ... A MAUI shell serves from a different origin." Stage 4 (line 51) builds the MAUI shell and its gate (line 37) checks only airplane mode and protocol 2. Stage 5 (line 38) is "Informational: produces the list the owner decides from."
- Evidence: The plan itself names the origin change as a data-loss risk for users' saved sites and runs. Nothing in the plan tests it before stage 4 commits the shell. Stage 5 is not a gate, so a finding that saved data cannot survive lands after the shell is already built.
- Already covered?: Partly. Section 7 (line 93) names "the saved-data migration from stage 5" as a remaining cost if all gates pass. That names the cost but not the sequencing: the commitment to the new origin is made in stage 4, before the answer exists.
- Severity: should-fix
- Confidence: high
- Suggested change: Move the origin and saved-data test ahead of stage 4, or add it as a stage 4 gate item.

### R5.2 Stage 3 agreement bars were loosened by the orchestrator after the yardstick was measured, with no owner decision recorded
- Where: line 48, "Agreement bars (proposed): ... at most 1% of ever-burning cells differ ... burnt area within 2%." Against that, line 128: "Embers off, any random stream: at most 2.5 % ... burnt area within 2.5 %, ... 95th percentile at most 60 s."
- Evidence: Line 122 reports that with embers off the seed-to-seed floor is 0 to 1.9 % of cells. Revision 2 then raises the embers-off bars from 1 % and 2 % to 2.5 % and 2.5 %, and adds a 95th-percentile bar. Line 29 says "Thresholds are proposals. The owner may change any of them before a stage starts." No owner approval of the new numbers appears in the plan. The old bars also remain in section 3 (line 48) with no strike-through, so the document holds two sets of bars.
- Already covered?: Partly. Line 126 says the new table replaces the section 3 proposal, and lines 121 to 122 disclose the measurement. Disclosure is not owner approval, and it does not remove the stale bars at line 48.
- Severity: should-fix
- Confidence: high
- Suggested change: Keep the owner-approved bars as the gate, present the loosened set as a proposal for the owner to accept, and strike or delete line 48.

### R5.3 Stage 3 may pass on a seed that never exercises the ember model
- Where: line 45, "produce fixtures for Katoomba 3 km, fast tier, seed 11." Line 122, "Seed 11 starts no effective spot fire, so it equals the no-embers run; seeds 12 and 13 exercise the ember code." Line 36 gives the stage 3 gate as "any difference across 1, 2, 4, 8 threads, or agreement outside the bars below."
- Evidence: The only seed the plan fixes for the stage 3 fixtures is seed 11, which the plan's own evidence says runs without embers. The embers-on column (line 131) and the decision at line 134 therefore have no named fixture that exercises them. The plan does not name seeds 12 or 13 as part of the gate set. A stage 3 pass could be earned entirely on the no-ember case.
- Already covered?: No. Line 122 states the seed fact, but nothing connects it to the stage 3 gate's seed set.
- Severity: should-fix
- Confidence: medium (the text does not say which seeds the gate uses; the risk follows if it reuses the seed 11 fixtures)
- Suggested change: Name the gate's seed set, include seeds 12 and 13, and require the embers-on bars to be run on seeds where embers fire.

### R5.4 The exact random-stream port is a hard-to-reverse commitment, chosen by the orchestrator and not priced
- Where: line 134, "The slice ports the TypeScript random generator and its draw order exactly, so that the tight column applies. If the generator cannot be reproduced bit for bit, the loose ensemble bar applies." Line 97, "The expensive parts are stage 3 (the port)."
- Evidence: Exact parity means the C# engine must mirror the TypeScript ember model's draw order. Any later TypeScript change to that order breaks parity, which couples the two engines for as long as D34 stands. The plan does not estimate what this costs. The fallback needs 30-seed TypeScript ensembles, which line 136 lists as still to run with no agent assigned.
- Already covered?: Partly. Line 134 states the decision and its fallback. It does not give the cost, the coupling, or who keeps the draw order in step if the TypeScript changes.
- Severity: should-fix
- Confidence: medium
- Suggested change: Record this as an owner decision with its estimated cost, and name who maintains the draw-order mirror.

### R5.5 The run-count estimate has no room for retries or for the work still to run
- Where: line 97, "About ten to twelve agent runs if every gate passes." Table lines 59 to 70. Line 66 splits the port "by area." Line 136, "Still to run ... 30-seed TypeScript ensembles, standard and high at 6 km, and timings on a quiet machine."
- Evidence: Counting the section 4 rows, with the port split into the three areas named (decoding; spread, moisture and embers; atmosphere if needed), gives 12 agent runs before any retry. The still-to-run items have no agent in the table. The 30-seed ensembles are needed for the loose fallback (line 134), and the quiet-machine timings are needed for Gate 1 (line 34). The estimate gives no tokens, time or per-agent scope for a port of about 25,000 lines (line 93).
- Already covered?: Partly. Line 97 says "fewer if one fails early" and acknowledges the weekly budget. It says nothing about retries or unowned runs.
- Severity: should-fix
- Confidence: high on the count and the missing owners; medium on the size of the port
- Suggested change: Add an agent to each still-to-run item, add a retry allowance to the estimate, and give the port's cost as runs per area.

### R5.6 The owner go-ahead is not recorded, and stage 0 moved to a second route after a refusal
- Where: line 25, "Running the downloaded `dotnet-install.sh` was refused by the auto-mode classifier. The plan installs the SDK from the official tarball instead ... If that is refused too, stage 0 stops and the owner decides." Line 119, "Stage 3a ... merged as `095caf9`." Pack purpose: "The owner reads it and decides whether agents spend runs."
- Evidence: Stage 0 and stage 3a have already run and been merged, and the document records no owner decision to start them. Rule 6 (line 14) says the orchestrator waits for the owner before starting the next stage. After a refused install, the plan picks a different download route and asks the owner only if that is refused too.
- Already covered?: No. Line 102, "Work already started ... was kept," describes continuing the work, not owner approval.
- Severity: should-fix
- Confidence: medium (the owner may have approved outside this document, and the pack does not show it)
- Suggested change: Record the owner's go-ahead for stage 0 and stage 3a, and ask the owner before any further download that follows a refusal.

### R5.7 Gate 1 is decided on container numbers that the plan itself calls indicative
- Where: line 34, "All-core C# is under 1.5× the TypeScript on desktop" (gate), run "Container, then phone." Line 11, "Container numbers are desktop-class and noisy (4 shared cores, 16 GB) and are labelled *indicative*." Line 24, "4 cores, 16 GB, shared with every agent." Line 136, "timings on a quiet machine" still to run.
- Evidence: A hard stop gate is set at 1.5× on a number that the plan calls noisy and indicative, taken on a machine shared with up to two other agents (line 58). The gate states no noise margin and no repeat count. The `flock` rule (line 24) is not said to cover the timing runs, and the plan does not say Gate 1 waits for the quiet-machine timings.
- Already covered?: Partly. Line 11 labels the numbers, and line 136 notes that quiet-machine timings are still to run. Neither says whether Gate 1 waits for them.
- Severity: should-fix
- Confidence: medium
- Suggested change: Decide Gate 1 only from quiet-machine runs, or state the margin and the repeat count, and say that Gate 1 waits for them.

### R5.8 Owner phone time recurs, is not priced, and has no fallback
- Where: line 76 to 78, "Install the benchmark and transport APKs (debug builds, sideload) ... paste them back" and "If it fails, the agents write exact build instructions and the owner builds." Phone runs are needed at stage 1 (line 40, "Container, then phone"), stage 2 (line 35), stage 4 (line 37) and stage 5 (line 38). Gate 1's phone threshold of 2.0× (line 34) depends on those numbers.
- Evidence: The owner is asked for at least four rounds of sideloaded debug builds, and possibly the Android build itself. The plan gives no estimate of that time and no rule for what happens if the owner's phone is not available or the numbers arrive late. Gate 1 cannot close on the phone threshold until the owner has run a build.
- Already covered?: Partly. Section 5 (lines 74 to 78) lists what is needed from the owner. It does not price the time or say what the orchestrator does while it waits.
- Severity: should-fix
- Confidence: medium
- Suggested change: Estimate the owner time per round, and state what proceeds or stops if the phone numbers are late.

Totals: 8 findings (must-fix 0, should-fix 8, nitpick 0)
Checked and found correct:
- The Gate 1 threshold (1.5× desktop, 2.0× phone) matches between section 3 (line 34) and section 7 (line 90).
- The stage table in section 3 and the agent table in section 4 cover the same stages and deliverables, with the same gate order.
- Rule 1 (line 9) and the agent scopes (line 58 and the table in section 4) keep prototype code under `prototypes/dotnet-b/`, consistent with the "What this is not" paragraph (line 5).
- The Stage 1 gate in section 3 and the "what each outcome means" table in section 7 give the same outcomes for a Gate 1 failure.
- The section 10 correction (line 121) is internally consistent: it says last-bit math is not the risk and points to the random stream, which matches the bars in section 10.
Could not check:
- The 3a tier-difference report (prototypes/dotnet-b/reports/3a-tier-difference.md) and the numbers in section 10. They are not in the pack.
- Any owner approval given outside this document, including the approval to start stage 0 and stage 3a.
- The artifact at https://claude.ai/artifact/VsrSVEJaknFbyWuQh7Svx9, which the plan relies on for option B's description.
Verdict: Fix first
