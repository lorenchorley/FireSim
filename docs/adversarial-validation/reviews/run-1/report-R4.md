R4 (Feasibility) review of /home/user/FireSim/docs/adversarial-validation/ASSESSMENT-2026-11-12.md. Read-only; no files changed.

R4.1
- Where: ASSESSMENT section 7 step 6 ("Build a small seeded set ... Use it to measure S1 before and after each change.") and section 4/6 references to S1.
- Problem: The plan asks for a baseline measurement of S1 before each change, but the seeded set that makes that measurement possible is the last step in the sequence.
- Evidence: Section 7 orders the work as steps 1 to 6 with the seeded set at step 6, after the engine, plan, spec, implementation, tests and deep-research changes. MISSION.md S1 says "The target rate is set once a baseline has been measured." So the baseline cannot exist before the changes it is meant to bracket.
- Severity: must-fix
- Confidence: high

R4.2
- Where: ASSESSMENT section 4, UC2 "Research depth" lens ("It needs the research process in section 6."), and section 7 step 2 ("Add the plan and spec profiles first") versus step 5 ("connect it to the research-depth lens of the plan profile").
- Problem: The plan profile is scheduled to ship and be dogfooded before the component its research-depth lens depends on.
- Evidence: Step 2 precedes step 5 in the same list. The UC2 lens text states the dependency explicitly. The dogfood review of the assessment in step 2 therefore runs without the lens the assessment itself names as part of UC2.
- Severity: should-fix
- Confidence: high

R4.3
- Where: ASSESSMENT section 7 step 1 ("add C1 to C5") and section 3 C6 ("never writes to the main tree"); the existing file .claude/skills/adversarial-review/reviewer-prompt.md line 25 ("Do not modify, create or delete any files. You are read-only.").
- Problem: C6 (worktree execution) is omitted from the step that restructures the engine, although steps 3 and 4 depend on it, and the reviewer template's absolute read-only rule would forbid the change C6 requires.
- Evidence: Step 1 lists C1 to C5 only. Steps 3 and 4 say "run in a worktree". Running vitest in a worktree writes caches and output, which reviewer-prompt.md line 25 forbids. Nothing in the sequence schedules rewriting that line.
- Severity: should-fix
- Confidence: high

R4.4
- Where: ASSESSMENT section 4, UC1 "Requirement-targeted mutants ... runs the suite in a worktree" and "Mechanical mutation for the whole suite"; section 6.2 and S6 (cost reporting).
- Problem: The mutation plan runs the test suite once per requirement or mutant, with no estimate of runtime or budget, though the suite is slow.
- Evidence: src/sim/validation.test.ts header: "Runtime ≈ 2–3 min on one x86 core. Set FIRESIM_SKIP_SLOW=1 to skip." The session sim tests each say "about 60 s". The synthesis has 52 numbered decisions (D1 to D51 plus later), so per-requirement mutants could mean dozens of multi-minute runs per review. The assessment never states which tests a mutant run would use or what a run costs.
- Severity: should-fix
- Confidence: high

R4.5
- Where: ASSESSMENT section 3, C6: "Reviewers may run code in an isolated worktree (the Agent tool's `isolation: \"worktree\"`)."
- Problem: The mechanism is stated as a fact, with no tag, and nothing in the work or the pack confirms that the parameter exists in this environment.
- Evidence: The existing SKILL.md, reviewer-prompt.md and judge-prompt.md never mention isolation or worktrees. The assessment's own section 8 says the version 1 skill has not been run end to end. I could not confirm the parameter from the material I was given.
- Severity: should-fix
- Confidence: medium

R4.6
- Where: ASSESSMENT section 6.3 D4: "The ledger makes research resumable across sessions, so it can run over days"; section 6.2 "a ledger on disk".
- Problem: The plan does not say where the ledger lives, and the obvious default would not persist.
- Evidence: The environment note says the scratchpad is "session-specific". A ledger there cannot carry research "across sessions" or over days. The location must be inside the repository or another durable store, and the assessment does not specify one.
- Severity: should-fix
- Confidence: medium

R4.7
- Where: ASSESSMENT section 6.4, "Decision stability (primary). Stop when the last round changed neither the recommendation nor its confidence."
- Problem: "Confidence" is not defined or made measurable, so the primary stopping rule cannot be applied as written.
- Evidence: No scale, threshold or procedure for confidence appears in sections 6.3 to 6.4 or elsewhere in the work. Without it, two rounds cannot be compared, which is the stated test.
- Severity: should-fix
- Confidence: medium

R4.8
- Where: ASSESSMENT section 6.4, capture-recapture bullet: "If they find n1 and n2 relevant sources, m of them shared, the total is about n1 × n2 / m ... Coverage is then roughly what was found divided by that estimate." Also the sentence "A surgery review suggested, for example, searching until about 80% is captured. [V, Kastner et al. 2009 ... PMC2655834]".
- Problem: The estimator needs assumptions the work states as settled (a closed population of relevant sources, and independent searchers), and the work's own next sentence says the independence assumption fails. The cited source also does not match the description.
- Evidence: The assessment says the searchers are not independent ("Agents running similar queries are not independent, so it overestimates coverage"), yet still gives the coverage formula as the stopping signal. A fetch of PMC2655834 found a retrospective horizon-estimation study of osteoporosis clinical decision support RCTs, not a surgery review. It reports an observed 68% capture and uses a 95% confidence interval as its stopping rule. It sets no 80% target. The "[V]" tag is therefore wrong for the 80% claim.
- Severity: should-fix (the source mismatch is a fidelity issue outside my lens; I raise it here because the stopping rule is built on it)
- Confidence: high for the source mismatch; medium for the feasibility consequence

Checked and found accurate (no finding): the Anthropic post figures (90.2%, 80% variance, about 15× tokens for multi-agent and about 4× for agents), which resolve the §8 "not checked" item; Vitest 5.0.2 in package.json; CONTRACT-0.10.0 D39 and the 1060 kB budget; synthesis §14 test vectors.

Overall: the sequencing defects (R4.1, R4.2, R4.3) and the uncosted mutation runs (R4.4) mean the plan cannot be carried out as written.

Fix first
