R3. Lens: prose / Argument and logic
(The report file could not be written: the environment refused a subagent report file, so this is the full report as text. Work reviewed: /home/user/FireSim/docs/adversarial-validation/ASSESSMENT-2026-11-12-v2.md. Line numbers refer to that file.)

R3.1
- Where: L190, section 6.5: "Run the proposed process and a plain single-agent search on each question, with the same stakes. Score each run on ... the tokens and time it used. The proposed process earns its extra cost only if it finds materially more of the listed sources."
- Problem: The test has no token-budget control, so it cannot tell whether a gain comes from the process's design or from the extra tokens it spends.
- Evidence: L141 says token usage "by itself explained 80% of the performance variance", and L145 says the evidence does not show parallel contexts are the cause. The doc names the confound and then designs a test that leaves it in place. A plain single-agent run at default budget is compared with a multi-agent run that spends several times more tokens, so a win could be spend, not design. The test cannot support the Q3 answer "Probably, at a higher cost" (L13) either way.
- Severity: must-fix. Confidence: high.

R3.2
- Where: L178, "Two searchers work the same sub-question independently." and L184, "give the two searchers different strategies (D2)", with D2 (L155-L160) splitting searchers by strategy, including a contrarian searcher.
- Problem: The remedy for correlated searchers (different strategies) breaks the population assumption of the estimator it feeds, and "relevant source" is never defined across strategies.
- Evidence: The estimate N about n1 x n2 / m (L178) assumes both samples draw from one target set with comparable catchability. A contrarian searcher and a primary-source searcher target different sets, so m falls for reasons unrelated to coverage, and the direction and size of the error cannot be stated. The doc calls the result a "signal" without saying what it signals once strategies differ.
- Severity: should-fix. Confidence: medium.

R3.3
- Where: L176, "Stop when a round changes no answer and no rating."
- Problem: The stop rule sets no confidence level, so a sub-question still rated "low" stops being researched once a round leaves it unchanged, and the doc never says low-rated questions must be reported as open.
- Evidence: Nothing in L176-L186 says sub-questions still at low confidence are reported at stop time. The budget clause (L185) reports "sub-questions still open" only when the budget ends a round. A stall with every question at "low" looks the same as a finished result, which is the outcome mission R2 and S5 are meant to prevent.
- Severity: should-fix. Confidence: high.

R3.4
- Where: L176, "A rating is high only when at least two independent sources support the answer and a deliberate search for contradicting evidence found none." and "so the agent cannot raise its own confidence without new evidence."
- Problem: The rating's evidence rule depends on the researching agent judging its own sources' independence and its own search's deliberateness, which is the self-judgment the mission and P1 rule out.
- Evidence: The agent that writes the ledger decides whether sources are independent and whether a search was deliberate. L178 says agents running similar queries are not independent, so the agent is the least reliable judge of the property the rule checks. The doc does not say who checks those labels. The ruling's S1 raised the same self-judgment problem.
- Severity: should-fix. Confidence: high.

R3.5
- Where: L176 and L177, "Two rounds in a row that add nothing that changes a conclusion is the signal."
- Problem: Decision stability cannot tell convergence from stalling, because a round whose searchers repeat the same queries also changes nothing.
- Evidence: The primary rule never checks that a round searched anything new. The only check that sees correlated searching is the overlap signal, which L184 says "overestimates coverage" when searchers are not independent. The doc still makes the primary rule the decider (L186), so the decider is the signal least able to detect the failure section 6.1 describes.
- Severity: should-fix. Confidence: medium.

R3.6
- Where: L176, "Research serves a decision, so this is the value-of-information view of when to stop."
- Problem: Stable answers and ratings are not a value-of-information criterion, which compares the expected gain from more evidence with its cost.
- Evidence: The rule computes neither expected gain nor cost. A decision can be unchanged by an answer that stays uncertain, and the rule stops there. The label gives the rule a justification it does not have.
- Severity: nitpick. Confidence: medium.

R3.7
- Where: L44 (C7), "Either way, the reviewers have reached noise."
- Problem: A round with no new must-fix findings, or a judge rejecting most findings, does not show that the reviewers have reached noise.
- Evidence: No argument is given for the step. The doc's own P1 and C3 concerns (shared blind spots) and the possibility of a wrong judge both fit the same observations. The ruling's O6 raised this and rev 2 left it unchanged. The loop-stop rule has the gap R3.5 describes.
- Severity: should-fix. Confidence: medium.

R3.8
- Where: L23-L26 (diagram) and L34: "Each use case checks one link: an **artifact** against the **reference** above it."
- Problem: The diagram places UC2 and UC3 on the wrong links, so the sentence is false for them as the doc defines them.
- Evidence: Section 4 defines UC2 as plan against mission (L62) and UC3 as implementation against spec (L73). The diagram puts UC2 on the spec-to-plan arrow and UC3 on the plan-to-implementation arrow, so UC3's reference is drawn as the plan. The ruling raised this as its own observation, and rev 2 lists it as open (L221), yet L16 still presents the chain as settled ("The use cases form one chain [D]").
- Severity: should-fix. Confidence: high.

R3.9
- Where: L50, "A planted bug that survives (the suite still passes) is a proven gap. [K]" and L52, "Each surviving mutant becomes a finding with its own proof attached."
- Problem: A surviving mutant is not proof of a gap; it may be equivalent to the original or change behaviour the requirement does not demand.
- Evidence: The step from "the suite did not fail" to "a gap exists" is unjustified. Equivalent mutants are S7 in the revision notes and remain open (L221), so "proven" stays in the design. The ruling's S7 fix (a candidate the judge must confirm as non-equivalent and in scope) is not applied. The UC1 design turns each surviving mutant into a finding without that check, which breaks the mission's rule to keep what is wrong apart from what is arguable.
- Severity: should-fix. Confidence: high.

R3.10
- Where: L196 (section 7, step 1), "A first version with one artifact is enough to start".
- Problem: One artifact gives too few planted defects to set the S1 target or to show that later steps changed the rate.
- Evidence: L196 sets the S1 target from this baseline, and step 7 (L202) compares later runs with it. One artifact, few defects, and one run of an LLM review that varies between runs gives a rate with a very wide range. The doc gives no run count, no defect count and no threshold for what counts as a change, so the comparison in step 7 has no noise estimate.
- Severity: should-fix. Confidence: medium.

R3.11
- Where: L127-L136, section 6.1, tagged [D].
- Problem: The six causes are tagged derived but are asserted behaviours with no premises shown.
- Evidence: The doc's tag definition (L5) says [D] is "derived in this document", and nothing in 6.1 derives the causes from a source or from the doc's own reasoning. The design in 6.3 responds to them. The ruling's O5 raised this and it is unchanged.
- Severity: nitpick. Confidence: medium.

R3.12
- Where: L12, "Four separate skills would copy the same orchestration and isolation rules four times".
- Problem: The count is four, but section 5 lists five profiles (UC0 to UC4).
- Evidence: L99-L111 list deliverable, tests, plan, implementation and spec. The argument holds with five, but the number is wrong.
- Severity: nitpick. Confidence: high.

R3.13
- Where: L176 ("a round changes no answer") and L177 ("Two rounds in a row").
- Problem: The doc gives two stop conditions, one round and two rounds, without saying which governs.
- Evidence: L186 says "Decision stability decides", which implies one round. The two-round saturation signal is never said to be a gate or only a check, and "recent surge" (L186) is undefined, so the combined rule cannot be applied as written.
- Severity: nitpick. Confidence: low.

Checked and found correct under this lens:
- The Lincoln-Petersen formula (L178) is stated correctly, and the overestimate direction for correlated searchers (L184) is right.
- The L145 hedge correctly says the token-variance finding does not isolate parallel contexts as the cause.
- The Q1 and Q2 chain (L11-L12) follows from sections 3 to 5, subject to R3.12.
- Rev 2 applies the ruling's M2 (seeded set first, L196), defines the confidence rating (L176), and removes the stale 15x clause from section 8 (L204-L208).
- C6 (L43) follows from K2 in the mission.

Not checked:
- Facts in the cited sources (Kastner and Stelfox numbers, Anthropic figures). These belong to the facts lens; I used the ruling's account of the Anthropic post and did not re-fetch.
- Whether the v1 skill's "read-only" wording matches what C6 assumes.
- Whether the Agent tool's worktree isolation exists as described (ruling O4).
- StrykerJS and Vitest 5 compatibility; the full texts of the two capture-recapture papers.

Totals: 13 findings (must-fix 1: R3.1; should-fix 8: R3.2 to R3.5, R3.7 to R3.10; nitpick 4: R3.6, R3.11 to R3.13).

Verdict: Fix first.
