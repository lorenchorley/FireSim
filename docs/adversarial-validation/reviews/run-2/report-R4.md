R4 done. Report: not written to REPORT_PATH (the write was refused: subagents return findings as text). Full report follows.

# R4. Lens: plans / Feasibility

Work: /home/user/FireSim/docs/adversarial-validation/ASSESSMENT-2026-11-12-v2.md (revision 2)
Checked against: MISSION.md, the v1 skill files (SKILL.md, reviewer-prompt.md, lenses.md), package.json, the repo tree (node_modules, .gitignore, worktrees, docs/research), the judge ruling on revision 1 (reviews/run-1/ruling.md), and the npm registry (read-only `npm view`).

## Findings

**R4.1. Worktree execution (C6) is not scheduled, and the reviewer and skill rules it needs to change still forbid it.** [should-fix, high]
- Where: v2 line 43 (C6: "Reviewers may run code in an isolated worktree"); line 197 (step 2: "add C1 to C5"); line 199 (step 4: "blind acceptance tests run in a worktree"); line 52 (UC1 mutants "runs the suite in a worktree"); section 5 layout, which lists `reviewer-prompt.md` unchanged.
- Problem: Steps 4 and 5 cannot run as written, because the step that adds C6 is not in the order and no step rewrites the rules that forbid it.
- Evidence: `reviewer-prompt.md` line 21: "Do not modify, create or delete any file except REPORT_PATH." `SKILL.md` isolation rule 3: "Reviewers and the judge never write to the repository. Each may write only the output files named in its instructions." Running vitest in a worktree writes caches and output, so either rule blocks step 4. Step 2 adds C1 to C5 only. Ruling run-1 O3 raised this and v2 did not apply it (v2 section 9 lists it as left open).

**R4.2. Worktree test runs have no dependencies installed, and the cost of per-requirement mutants is unbounded.** [should-fix, high]
- Where: v2 line 52 ("For each requirement in the inventory (C2), a reviewer writes a plausible bug ... and runs the suite in a worktree"); line 53 (Stryker); line 75 (UC3 acceptance tests "in a worktree").
- Problem: The plan assumes a worktree can run the suite, but a fresh worktree has no `node_modules`, and the plan says nothing about installing it or what a run costs.
- Evidence: `/home/user/FireSim/node_modules` does not exist in the main tree. `.gitignore` lists `node_modules/`, so git does not carry it into a worktree. Each mutant run would need an install (for example `npm ci`) or a link. The suite's own header says "Runtime ≈ 2–3 min on one x86 core" (`src/sim/validation.test.ts` line 16), with `test:fast` in package.json. The plan does not say whether mutant runs use a subset. One reviewer per requirement, each running the suite, means subagent count and test minutes scale with the requirement count, and the plan gives no estimate. Ruling S5 (mutation runs uncosted) was left open in v2 (section 9).

**R4.3. The plan profile ships before the research process its lens depends on.** [should-fix, high]
- Where: v2 line 67 ("Research depth ... This reviewer does its own short search ... It needs the research process in section 6."); line 198 (step 3: "Add the plan and spec profiles first"); line 201 (step 6: "Build the deep-research skill ... connect it to the research-depth lens of the plan profile").
- Problem: Step 3 delivers a profile with a lens that cannot work until step 6, so the profile the plan calls "most valuable" is not usable at the point the order places it.
- Evidence: The plan states the dependency itself at line 67. Ruling O2 asked for the plan to say that the lens ships in reduced form, or that dogfooding runs without it. v2 does neither, and it is not in the "Not applied" list in section 9.

**R4.4. The information barriers the design depends on are not enforceable in this repository as described.** [should-fix, high]
- Where: v2 line 40 (C3: blind derivation, "one agent therefore sees only the reference"); line 75 (UC3: "An agent that has read only the spec, never the code"); line 190 (6.5: "keep it out of the agents' reach"); line 196 (step 1: "the answer key stays outside the repository").
- Problem: Each barrier is stated as a method, but the plan does not say how it is enforced, and the default setup would not enforce it.
- Evidence: The repository is one working tree, and any subagent started in it with file tools can read every file in it, including `src/` (for the spec-only agent), `docs/research/00-synthesis.md` section 14 (test vectors, line 2268), and `reviews/run-1/ruling.md`. The existing `SKILL.md` isolation rule 2 controls only what the launch message names, not what an agent can open. Section 6.5 keeps the answer key "out of the agents' reach" but names no location. The scratchpad the skill uses for run directories is session-specific (ruling S8, not applied). A design that depends on blindness needs a mechanism: a copy of the spec in a separate directory, a tool restriction, or a path outside the repo that the agent is told to use.

**R4.5. The "hard cap" budget and the token and time measurements have no mechanism, and agent capacity is not bounded.** [should-fix, medium]
- Where: v2 line 185 ("Each round has a hard budget ... as a cap on tokens, subagents or elapsed time"); line 186 ("The budget is a hard cap: it ends a round whatever the other signals say"); line 190 (6.5: "the tokens and time it used").
- Problem: The plan calls the budget a hard cap, but no step enforces it, and the plan does not say how the tokens or time in section 6.5 are measured.
- Evidence: The `SKILL.md` fixed-settings table passes only `model` and `effort` to each subagent call. It has no budget parameter, and the orchestrator has no stated way to read token use. I could not verify from my tools whether the Agent tool reports token use, and the plan does not say, so the cap and the S6 cost report (MISSION S6) rest on an unstated capability. Separately, the plan sets no subagent count per run. Under v2, one UC1 run starts an inventory agent, a derivation agent, one mutant agent per requirement, verification agents, and a judge. No cap is given for these, and ruling S4 (no cost or proportion mechanism) was left open.

**R4.6. The seeded-set step contradicts itself, names no one to plant defects, and stores the answer key where it will not persist.** [should-fix, medium]
- Where: v2 line 196 (step 1: "Build a small seeded set: one artifact per use case ... A first version with one artifact is enough to start ... The person who plants the defects is not the person who runs the review, and the answer key stays outside the repository.").
- Problem: The step asks for five artifacts and also accepts one; it requires two different people, but the plan names only the owner; and the answer key has no durable home.
- Evidence: MISSION section 2 and the adversarial-validation README name one owner, and nothing in the plan assigns the planting role. The answer key is to stay "outside the repository", but the only writable location the plan names is the session scratchpad, which does not survive the session (ruling S8). A baseline from a single artifact cannot set an S1 target that means anything. The baseline also runs version 1, which has only the deliverable (UC0) lenses, against UC1 to UC4 artifacts, so it measures a different task from the one the profiles will perform. The plan does not say this.

**R4.7. The overlap signal assumes equal catchability, which the plan's own change to D2 breaks, and the direction of the resulting bias is not stated.** [should-fix, medium]
- Where: v2 line 178 ("Two searchers work the same sub-question independently ... n1 × n2 / m"); lines 155 to 158 (D2: searchers "split by strategy as well as by sub-question"); line 184 ("give the two searchers different strategies (D2)").
- Problem: The estimator needs two searchers with the same chance of finding each source, but line 184 tells the design to make them differ, so the estimate is no longer the coverage the plan says it gives.
- Evidence: The plan's own reason for the change is that similar searchers overlap and "overestimate coverage" (line 184), so the change moves the overlap count the other way. The plan does not say which bias remains or how the signal is read after the change. As written, the stopping signal in section 6.4 cannot be computed as described.

**R4.8. The StrykerJS and Vitest 5 check is partly answered already, and the plan should say so.** [nitpick; high confidence in the fact, medium in the implication]
- Where: v2 line 53 ("StrykerJS has a Vitest runner [K], but its compatibility with Vitest 5 must be checked first."); line 207 ("Not checked: StrykerJS compatibility with Vitest 5").
- Problem: The plan lists this as an unchecked blocker for step 5, but the registry already holds a relevant fact that the plan does not mention.
- Evidence: `npm view @stryker-mutator/vitest-runner` returns version 10.1.1 with peerDependencies `vitest: '>=2.0.0'` and `@stryker-mutator/core: '10.1.1'`. The repo pins `"vitest": "^5.0.2"` (package.json line 46), and `npm view vitest version` returns 5.1.0. The peer range accepts Vitest 5, but that is not a runtime test. The plan should cite the peer range as [V], keep the runtime check open, and mark it as the step 5 gate.

## Checked and found correct (feasibility)

- Vitest is the repo's runner: `"test": "vitest run"` and `"vitest": "^5.0.2"` (package.json).
- The judge settings and reviewer count in the v2 layout match the existing skill's table (`SKILL.md`), so the step 2 engine change is a restructure, not a new mechanism.
- The v2 order puts the seeded set first, as ruling M2 asked.
- The Kastner and Stelfox references are described at the level their abstracts support (section 6.4). That is outside my lens, and I did not re-check the citations.

## Could not check

- Whether the Agent tool accepts `isolation: "worktree"` (v2 line 43). My tool set has no Agent tool, so I could not read its schema. Ruling O4 also could not verify it. Until it is checked, C6 rests on an unverified parameter.
- Whether the Agent tool reports token use per subagent (R4.5).
- The environment claims in section 6.2 (web search "standard and extended modes", "a page-reading agent") and the Workflow tool's behaviour. Not tested.
- Whether StrykerJS runs under Vitest 5 at runtime (R4.8). Only the peer range was checked.
- The number of requirements the inventory would produce, so the mutant cost in R4.2 is an order of magnitude only.

## Verdict

No must-fix findings under this lens: nothing in the work is false as stated. The findings are feasibility gaps. The order cannot be followed as written (R4.1, R4.3), the isolation the design relies on is not enforced (R4.4), and the cost and cap claims have no mechanism (R4.2, R4.5). Fix these before the owner acts on the plan.

Verdict: Fix first.

Findings: 8 (must-fix 0).
