R5, lens: plans / Alternatives
Work: /home/user/FireSim/docs/adversarial-validation/ASSESSMENT-2026-11-12-v2.md (revision 2)
Note: a Write to REPORT_PATH was refused by the tool ("Subagents should return findings as text"), so the full report is below. Nothing else was written.

## Findings

R5.1
- Where: section 6.5, line 190: "Run the proposed process and a plain single-agent search on each question, with the same stakes." Related: section 6.2, lines 141 and 145.
- Problem: The Q3 comparison has no control for the simplest alternative, spending more tokens on one agent, even though the document's own source says token use explains most of the performance variance.
- Evidence: Line 141 reports that "token usage by itself explained 80% of the performance variance". Line 145 says the evidence "does not show that parallel contexts are the cause, since token use alone explained most of the variance." Section 6.5 compares only against a plain single-agent search, with no run that matches the proposed process's token spend. It scores tokens but does not hold them constant. The strongest alternative (one agent with the same budget, using the same ledger and stopping rule in sequence) is never tested, so the rule "earns its extra cost only if it finds materially more" cannot reject it. The plan names the confound and leaves it in the test.
- Severity: should-fix
- Confidence: high

R5.2
- Where: section 6.5, line 190 ("a plain single-agent search"); section 1, line 13 (Q3, "the current one"); section 7, line 198 ("they match how docs/plans and docs/research already work").
- Problem: The baseline for "better than the current process" is a plain single-agent search, but the repository already has a tagged, fact-checked research practice that the proposal never mentions as the current approach or as an alternative.
- Evidence: /home/user/FireSim/docs/research/00-synthesis.md section 0.1 defines the evidence tags [V], [K], [D], [H] and UNVERIFIED, and section 16 lists open issues. /home/user/FireSim/docs/research/02-mountain-meteorology.md line 89 refers to "the fact-check pass". /home/user/FireSim/docs/research/08b-live-endpoint-verification.md checks live endpoints against fetched fixtures. So the owner's research already includes verification passes, and a test against a plain search measures a weaker baseline than the owner uses. Caveat: I did not check how these documents were produced, so calling this "the current approach" is an inference.
- Severity: should-fix
- Confidence: medium

R5.3
- Where: section 5, lines 96 to 111 (one engine, five profiles, three new prompt files); section 7, step 2, line 197; section 1, line 12 (Q2).
- Problem: The plan compares one engine against four separate skills, but never compares the smallest option: keep version 1, add only the reference role and blind derivation, and reuse the lens sets that already exist.
- Evidence: /home/user/FireSim/.claude/skills/adversarial-review/lenses.md already has a Plans set (Feasibility, Missing requirements, Failure modes and rollback, Alternatives, Cost and commitment) and a Code set whose "Tests and regressions" lens asks for "tests that would still pass if the code were wrong", which is the core of UC1 as section 4 defines it. The Q2 argument (separate skills would drift) does not address this option. Overlap: ruling S6 on revision 1 raised the unused Plans and Code sets, and it is still unapplied. I count it here because the plan never states the minimal alternative or argues against it.
- Severity: should-fix
- Confidence: high

R5.4
- Where: section 6.2, line 138 ("The Workflow tool runs deterministic multi-agent orchestration, but only when the owner asks for it explicitly"); section 6.4, line 186 ("The budget is a hard cap: it ends a round whatever the other signals say"); section 5, line 100 (the engine).
- Problem: The plan requires hard budgets, fixed fan-out and isolation, but a prose skill cannot enforce any of them, and the one deterministic option is dismissed in one clause and never weighed as the engine.
- Evidence: The environment's skill list describes the Workflow tool as the way to run "a workflow the user already opted into". The explicit-request limit would also apply to the proposed deep-research skill, so by itself it does not rule the option out for the engine. Ruling O1 on revision 1 made this point and it is still unapplied. Revision 2 gives no mechanism for the hard cap, the round stop, or ledger writes.
- Severity: should-fix
- Confidence: medium

R5.5
- Where: section 6.4, line 176: "the skill records ... a confidence rating ... A rating moves only when a ledger entry is added or changed, so the agent cannot raise its own confidence without new evidence."
- Problem: The primary stopping rule has the research agent set its own confidence ratings, which contradicts the plan's own principle P1, and the alternative of an independent rater is not considered.
- Evidence: /home/user/FireSim/docs/adversarial-validation/MISSION.md P1: "The producer of a piece of work does not judge it." The research skill produces the answer and also sets the ratings that decide when it stops. The rule limits when a rating can change, not who sets it. The plan applies adversarial review to the synthesis (D5) but not to the stopping decision. Options such as a fresh agent that rates from the ledger, or the judge, are not weighed. Part of the rule can be mechanical (the two-source count), but "contradicting evidence found none" needs judgment.
- Severity: should-fix
- Confidence: medium

R5.6
- Where: section 6.4, line 184 ("Agents running similar queries are not independent, so it overestimates coverage") and line 186 (the saturation and overlap signals).
- Problem: The plan keeps the overlap signal while stating that its key assumption fails for the agents it proposes, and it does not weigh dropping the signal.
- Evidence: Line 184 says the estimate overestimates coverage when searchers are not independent. Section D2 gives the searchers different strategies, but they remain the same model with similar prompts. Line 186 lets the signal block a stop but never trigger one. The only case for keeping it is "use it as a signal, not a rule". The simpler alternative (decision stability plus the budget, without an overlap estimate) is not compared, and the plan does not say what the signal adds.
- Severity: nitpick
- Confidence: medium

R5.7
- Where: section 4, UC1, lines 50 to 53: "Requirement-targeted mutants, written by agents" is listed before "Mechanical mutation for the whole suite".
- Problem: The plan puts agent-written mutants first without comparing them with the deterministic option, and it does not consider running mechanical mutation and mapping each surviving mutant to a requirement.
- Evidence: Line 50 calls mutation testing the direct measure. Line 53 defers the mechanical option to a compatibility check (StrykerJS with Vitest 5). /home/user/FireSim/package.json has "vitest": "^5.0.2" and "test": "vitest run". The only stated reason for agent-written mutants is traceability to requirements, and mapping survivors to requirements gives that without agent-written code. Agent mutants also need the judge to decide equivalence (ruling S7). The plan gives no case against the deterministic-first option. The suite's runtime (about 2 to 3 minutes per the ruling's S5) affects both options equally, so it does not separate them.
- Severity: should-fix
- Confidence: medium

## Checked and found correct, under this lens

- Section 5's rejection of four separate skills: the drift argument holds against that alternative.
- Section 6.2's figures (90.2%, the 80% token-variance share, about 4x and 15x tokens, and the two poor-fit conditions): the ruling reports they match the Anthropic post. I did not re-read the post, so this rests on the ruling, not on my own check.
- The Plans lens set and its Alternatives lens exist in lenses.md. The Code set's "Tests and regressions" lens matches the UC1 description.
- StrykerJS and the Vitest 5 dependency are as stated in package.json.
- The description of the Workflow tool matches the skill list in this environment.

## Could not check

- The Anthropic post itself (not re-fetched by me).
- How the documents in docs/research were produced (R5.2 is an inference).
- Whether the Workflow tool can enforce a token or round budget (not tested).
- StrykerJS compatibility with Vitest 5 (not tested).
- The two capture-recapture papers (outside this lens; covered by the ruling).

Fix first

R5 done. Report: /tmp/claude-0/-home-user-FireSim/87003abe-40a8-5b42-ac05-c1f8b4f0083f/scratchpad/adversarial-review/run-2/report-R5.md (not written; full text in this handback). Findings: 7 (must-fix 0). Verdict: Fix first.
