JUDGE'S RULING on /home/user/FireSim/docs/adversarial-validation/ASSESSMENT-2026-11-12.md

How I checked: I read the work, MISSION.md, the v1 skill files (SKILL.md, lenses.md, reviewer-prompt.md, judge-prompt.md), package.json, CONTRACT-0.10.0.md and 00-synthesis.md, and all five reports. I fetched the Kastner PMC page and the Anthropic post myself. I also pulled the Europe PMC record for the 2009 paper. core.ac.uk returned 403 to me and PubMed returned a cookie wall, so those two are unverified. The Anthropic post came through a summarising fetch tool, so its quotes were not read directly.

Confirmed correct, so no finding: Q1 to Q4, S4, K2 and P1 references; "test": "vitest run"; vitest ^5.0.2; the 1060 kB gzip budget and D39 in CONTRACT-0.10.0; §14 "Test vectors" in the synthesis; the 90.2%, 80% and 15x figures exist in the Anthropic post.

---

A. MUST-FIX (ordered by damage if left in)

M1. The Kastner citation is wrong and carries a [V] tag (R1.1, R3.1, R4.8 in part, R5.1)
- Passage (line 178): "A surgery review suggested, for example, searching until about 80% is captured. [V, Kastner et al. 2009, J Clin Epidemiol, PMC2655834; core.ac.uk/works/100848577]". This is the only empirical support offered for the secondary stopping signal in Q4.
- Evidence from my fetches:
  - PMC2655834 is the 2007 AMIA Annual Symposium paper (pp. 389-393). Its example is an osteoporosis clinical-decision-support review, not surgery.
  - That page says nothing about 80%. It reports the review "captured 68% of known articles" and says "more studies are needed to objectively define cutpoints".
  - It uses Poisson-regression capture-mark-recapture with confidence intervals, not Lincoln-Petersen. It also says the procedure "has never been tested on a systematic review with ≥ 2 data sources".
  - The 2009 J Clin Epidemiol paper does exist (Kastner, Straus, McKibbon, Goldsmith; 62(2):149-157; PMID 18722088), and it is probably what the core.ac.uk link points to. It uses the same osteoporosis review.
  - Its abstract (via Europe PMC) gives observed capture of 68% at the first screening level and 81% at full text, and concludes that more studies are needed.
  - Surgery appears nowhere. No 80% target appears in the abstract.
- Not settled: I could not read the 2009 full text or the core.ac.uk page, so I cannot rule out an 80% statement in the body. The nearest number I could see is an observed 81%, not a recommended cutoff.
- Direction for the fix: Cite the 2009 paper correctly and make each URL match the paper named. Remove or re-source "surgery" and "about 80%", unless the author can quote the passage. Describe what the papers show: one retrospective example, observed capture, no agreed cutoff. Keep the Lincoln-Petersen formula as the document's own [K] gloss, not as the cited method. Re-tag [V] only for what was actually read.
- Partly rejected: the reviewers' claim that "2009" and "J Clin Epidemiol" are wrong. That paper exists. The real mismatch is between the PMC URL (2007 AMIA) and the 2009 journal citation.

M2. The seeded set is built last, so the S1 baseline cannot exist (R2.2, R3.6, R4.1)
- Passage: §7 step 6 says "Build a small seeded set... Use it to measure S1 before and after each change". It comes after steps 1 to 5, which are the changes.
- MISSION S1 says the target "is set once a baseline has been measured".
- If the owner follows the order, nothing is measured before the engine is restructured. v1 is in git (commit 6ec7e70), but the order gives no reason to go back to it.
- Direction for the fix: Move the seeded set, or at least a minimal version, ahead of step 1. Run v1 on it for the baseline. The rest of the order can stay.

---

B. SHOULD-FIX AND OPTIONAL

Should fix

S1. "Confidence" is undefined, so the primary stopping rule cannot be applied (R2.4, R3.5, R4.7, R5.6)
- §6.4: "Stop when the last round changed neither the recommendation nor its confidence."
- No measure is given for confidence. The budget has no figure or owner. The saturation and capture-recapture signals have no thresholds. The text calls decision stability "primary" but does not say how the signals combine.
- As written, the rule falls back on the agent's own sense of confidence. MISSION R3 and S5 name that as the failure to avoid.
- Direction for the fix: Define how confidence is recorded and compared between rounds, or mark it as an open design item. Say who sets the budget and what the signal thresholds are.
- Rejected part: R3.5's claim that an owner checkpoint contradicts S5. The owner confirming a stop that a rule has signalled is not the agent "feeling done".

S2. The Q3 "Yes" is stated more strongly than the evidence supports (R1.3, R3.2, R5.5, R2.3)
- Q3 is answered "Yes", and §6.2 uses the Anthropic figures as support.
- The 90.2% is Opus 4 lead with Sonnet 4 subagents against single-agent Opus 4, on Anthropic's internal eval. The 80% variance figure is from BrowseComp. The work names neither.
- It also leaves out the post's stated poor-fit conditions: tasks that "require all agents to share the same context or involve many dependencies between agents". The proposed pipeline has such dependencies (inventory, then derivation, then comparison; ledger rounds).
- The work gives no way to test whether the proposed `deep-research` skill beats the current process. §7 step 6 measures review (S1), not research.
- The "token usage explains variance" and "parallel fresh contexts" lesson is a fair reading of the post. R3's point that the mechanism is not shown is weak on that count.
- Direction for the fix: State the scope of the evidence and the cost. Say that "better results at about 15x tokens" is what is supported, and that the specific skill is untested. Add a way to compare it with the current approach.

S3. The §8 caveat contradicts the [V] tag (R1.2, R3.9, R5.2)
- §8 says the 15x figure was "not checked... against the primary post (a secondary summary reports it)". §6.2 tags it [V] to that post.
- The primary post does say about 15x. The figure is right and §8 is stale. §8 is the document's honesty list, so the contradiction weakens trust in the tags.
- Direction for the fix: Delete the §8 clause or change the tag. Both statements cannot stand.

S4. The proposal has no cost or proportion mechanism (R2.1)
- MISSION §1, P6 and S6 require cost to match stakes and each run to report agents and tokens.
- The assessment never mentions P6 or S6, and its only cost reference is line 144 ("depth costs tokens"). A UC2 run would stack an inventory agent, a derivation agent, five reviewers, research searches and a judge. §6.2 cites the roughly 15x cost, but the proposal adds no tiering or reporting.
- Direction for the fix: Add a cost-tiering and cost-reporting element to the profiles and the research process, tied to P6 and S6.

S5. Mutation runs are uncosted (R4.4)
- src/sim/validation.test.ts states "Runtime ≈ 2–3 min on one x86 core", with `FIRESIM_SKIP_SLOW=1` to skip, and package.json has `test:fast`.
- Per-requirement mutants multiply that. The work does not say which suite subset a mutant run uses or what it costs.
- I did not verify R4's "52 numbered decisions" figure. The slow-test fact is enough on its own.
- Direction for the fix: Say which test subset mutant runs use and give a rough cost per run.

S6. v1's existing Plans and Code lens sets are not engaged (R5.3)
- lenses.md already has three sets: prose, code and plans. The Plans set includes Missing requirements and Alternatives. The Code set's "Tests and regressions" lens already targets "tests that would still pass if the code were wrong", which is the core of UC1.
- The work calls the v1 lenses "today's prose lenses" and never tests v1 plus the Plans set plus MISSION.md as the baseline for Q1.
- The conclusion that v1 needs changes survives. The real gaps are the missing reference role, no blind derivation, no owner-decision ruling and no worktree. The baseline is still mischaracterised.
- Direction for the fix: Describe what v1 already covers, and say where each existing lens set lands in the profiles.

S7. "A planted bug that survives... is a proven gap" is overstated (R3.4)
- Surviving mutants can be equivalent to the original, or can change behaviour the requirement does not demand. This is standard mutation-testing knowledge.
- It matters most for mechanical mutants, though agent-written ones can also be wrong.
- Direction for the fix: Say a surviving mutant is a candidate gap that the judge must confirm is non-equivalent and in scope.

S8. The ledger's location and write permission are unspecified (R2.5, R4.6)
- D4 says the ledger makes research "resumable across sessions... over days", but does not say where it lives. The scratchpad is session-specific, so it would not persist.
- K2 forbids reviewer and judge writes to the main tree, and C6 relaxes the v1 read-only rule without naming a permitted write location. The research-depth lens uses the research process.
- R4.6's scratchpad premise comes from the environment note, not the work. The valid point is that the location is unstated.
- Direction for the fix: Name a durable location and say who may write to it, consistent with K2.

Optional

O1. The Workflow tool is dismissed in one clause and never weighed as an engine for the fixed pipeline (R5.4)
- The statement itself is accurate. The "explicit request only" limit also applies to v1, so it does not discriminate between the options.

O2. The plan profile ships before the research process its research-depth lens depends on (R4.2)
- This is a deliberate phasing, since step 5 connects them. It would help to say the lens ships in a reduced form and the dogfood runs without it.

O3. C6 is not in step 1 (R4.3)
- C6 is implied by steps 3 and 4. The rewrite of reviewer-prompt.md line 25 ("You are read-only") is not scheduled anywhere.

O4. The `isolation: "worktree"` mechanism in C6 is untagged and not listed in §8 (R4.5)
- Cannot verify from my tools. Check the Agent tool schema in the author's session or the Claude Code docs, then tag it.

O5. §6.1 is tagged [D], but its six causes are asserted behaviours of agents (R3.3)
- They are plausible and partly backed by the mission and the Anthropic post. [K] or an explicit "hypothesis" would be more honest.

O6. C7 states "the reviewers have reached noise" without argument (R3.7)
- A round with no new must-fix findings, or a judge rejecting most findings, may also mean the reviewers are weak or share a blind spot.

My own observation, not raised by any reviewer (Optional)
- The §2 chain diagram's labels do not match the mission's UC definitions.
- UC2 is defined against the mission but drawn on the spec to plan arrow.
- UC3 is defined against the spec but drawn on the plan to implementation arrow.
- The sentence "Each use case checks one link: an artifact against the reference above it" therefore fails for UC2 and UC3 as the mission defines them.
- It does not affect later sections, but it could confuse the owner.

---

C. REJECTED

- R1.4 (untagged "validated only in small, retrospective studies"): consistent with both Kastner papers, which are retrospective tests on a single review. The claim sits under the bullet's tag. The reviewer did not show it wrong.
- R1.5 (v1 pack also has "Purpose"): true but immaterial. C1 is about material roles (artifact and reference), and Purpose is not one.
- R2.6 (research queries could leak project context): the basis is this agent's environment rules, not a requirement in the mission, the sources or the repository. The reviewer rated it low confidence.
- R3.8 (theoretical saturation is a weak analogy): the work's paraphrase, "add nothing that changes a conclusion", matches saturation as used in qualitative research. The reviewer rated it low confidence.
- R3.5 sub-claim (owner checkpoint contradicts S5): see S1.
- R1.1 sub-claim ("2009" and "J Clin Epidemiol" are wrong): the 2009 paper exists. See M1.

---

D. LEDGER

| # | Finding | Reviewer ids | Ruling | Priority |
|---|---|---|---|---|
| M1 | Kastner citation: surgery, 80%, [V], URL mismatch | R1.1, R3.1, R4.8 (part), R5.1 | Valid (year and journal sub-claim rejected) | Must fix |
| M2 | Seeded set ordered last, so no S1 baseline | R2.2, R3.6, R4.1 | Valid | Must fix |
| S1 | "Confidence" undefined; no thresholds, budget or precedence | R2.4, R3.5, R4.7, R5.6 | Valid | Should fix |
| S2 | Q3 "Yes" overstated; source scope and limits omitted; no comparison test | R1.3, R3.2, R5.5, R2.3 | Valid | Should fix |
| S3 | §8 "15x not checked" contradicts the [V] tag | R1.2, R3.9, R5.2 | Valid | Should fix |
| S4 | No cost, proportion or reporting (P6, S6) | R2.1 | Valid | Should fix |
| S5 | Mutation runs uncosted; slow suite | R4.4 | Valid | Should fix |
| S6 | v1's Plans and Code lens sets not engaged; Q1 baseline | R5.3 | Valid | Should fix |
| S7 | "Proven gap" ignores equivalent mutants | R3.4 | Valid | Should fix |
| S8 | Ledger location and write rule unspecified | R2.5, R4.6 | Valid | Should fix |
| O1 | Workflow tool alternative unweighed | R5.4 | Valid but minor | Optional |
| O2 | Plan profile before research process | R4.2 | Valid but minor | Optional |
| O3 | C6 not scheduled in step 1; read-only rewrite | R4.3 | Valid but minor | Optional |
| O4 | Worktree isolation claim untagged | R4.5 | Cannot verify | Optional |
| O5 | §6.1 [D] tag | R3.3 | Valid but minor | Optional |
| O6 | C7 "noise" reasoning | R3.7 | Valid but minor | Optional |
| X1 | Untagged "small retrospective studies" | R1.4 | Rejected | none |
| X2 | Pack also has Purpose | R1.5 | Rejected | none |
| X3 | Query privacy | R2.6 | Rejected | none |
| X4 | Saturation analogy | R3.8 | Rejected | none |

---

E. OVERALL CALL

Fix the two must-fix items and resend. Preferably also fix S1 to S3 in the same pass, since they are small edits to the same sections.

No valid finding undermines the core proposal: one engine with five profiles, a blind-derivation step, an owner-decision ruling and a worktree rule. The defects are one mis-cited, [V]-tagged source in the Q4 section, one contradictory work order, an under-specified primary stopping rule, and an overconfident Q3 answer. Rethinking is not warranted.
