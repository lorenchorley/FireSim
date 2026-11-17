Review R2 (missing requirements) of /home/user/FireSim/docs/adversarial-validation/ASSESSMENT-2026-11-12.md. Read-only; no files changed.

R2.1
- Where: ASSESSMENT lines 113-119 (section 5 profiles), line 144 ("The lesson [D]: depth costs tokens, and parallel fresh contexts are how to spend them productively."), and section 7 lines 183-190. No cost mechanism appears in the plan.
- Problem: The plan adds several subagent stages per run and never ties their cost to the stakes, and it has no cost reporting.
- Evidence: MISSION.md line 13 says "Its cost must match the stakes of the work." P6 (line 33): "Effort scales with the stakes... A single checker is enough for simple fact-checking." S6 (line 56): each run reports agents started and tokens used. A UC2 run would stack an inventory agent, a blind-derivation agent, five reviewers, a research-depth reviewer with its own searches, and a judge. Section 6.2 cites the roughly 15x token cost of multi-agent systems but the plan adds no tiering, cap, or reporting. P6 and S6 are never mentioned in the assessment. Existing SKILL.md "Cost and fit" covers only the six-subagent case.
- Severity: should-fix. Confidence: high.

R2.2
- Where: ASSESSMENT line 190 (section 7 step 6): "Build a small seeded set... Use it to measure S1 before and after each change." It is ordered last, after the steps that make the changes.
- Problem: The order makes a before-and-after S1 measurement impossible, because the baseline is built after every change.
- Evidence: MISSION.md line 51: the S1 target "is set once a baseline has been measured." Section 7 puts the seeded set last, so no baseline exists when steps 1-5 change the process. The plan's own wording at line 190 contradicts that order.
- Severity: should-fix. Confidence: high.

R2.3
- Where: ASSESSMENT line 13: "Q3. A better research process? Yes." Also section 6.3 and section 8 (lines 192-195).
- Problem: Q3 is answered "Yes" with no defined efficiency or quality comparison against the current process.
- Evidence: MISSION.md line 70 asks whether a process is "more efficient, or gives better results, than the current one." The plan proposes no baseline, metric, or test for either. Its only evidence is Anthropic's internal evaluation (line 140, tagged [V]). Section 8 lists what was not done but omits any efficiency or quality comparison.
- Severity: should-fix. Confidence: high.

R2.4
- Where: ASSESSMENT line 175 ("stop when the last round changed neither the recommendation nor its confidence"), line 181 ("Each round has a hard budget."), and line 14 ("A budget caps each round") with no figure.
- Problem: The stopping rule depends on "confidence" and a "hard budget", neither defined with a unit or value, so the rule cannot be applied as written.
- Evidence: MISSION.md line 55 (S5) requires "the research stops under a stated rule." The plan does not say how confidence is measured, what the budget is, or who sets it. The saturation signal (line 176) and capture-recapture estimate (line 177) have no threshold.
- Severity: should-fix. Confidence: medium.

R2.5
- Where: ASSESSMENT line 161 ("D4. Ledger on disk."), line 67 (research-depth lens "needs the research process in section 6"), and line 43 (C6 changes v1's "read-only" rule to "never writes to the main tree").
- Problem: The plan does not say where the on-disk research ledger lives or whether reviewers may write to it, which may conflict with the isolation rule.
- Evidence: MISSION.md line 61 (K2): "Reviewers and judges never write to the main working tree." The UC2 research-depth reviewer uses the ledger (line 67), but its path and ownership are not stated. C6 relaxes the v1 rule without saying which location reviewers may write to or who cleans it up.
- Severity: should-fix. Confidence: medium.

R2.6
- Where: ASSESSMENT lines 150 and 153-157 (D1 "the decision it serves" and "a tree of sub-questions"), and D2 (line 154) with its web-search searchers.
- Problem: The plan sends the decision context and sub-questions to outside search services with no rule about what may leave the repository.
- Evidence: The plan has no stated constraint on research query content. The environment instructions say not to include the user's project details in requests to outside services. This is unverified as a real defect, since the owner may consider the research questions non-sensitive.
- Severity: should-fix. Confidence: low.

Checked and addressed: independence (P1, C2, C3), owner-first and no silent resolution of ambiguity (P5, S4, C5), the rule that reviewers do not write to the main tree (K2, C6 subject to R2.5), and the 1060 kB budget and D39 references, which match CONTRACT-0.10.0.md. The stopping rule's ledger and per-round reporting cover S5 apart from R2.4.

Verdict: Fix first
