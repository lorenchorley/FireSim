R3 (argument and logic) report on ASSESSMENT-2026-11-12.md. I read the work, MISSION.md, the adversarial-review SKILL.md, CONTRACT-0.10.0.md, and checked the three external sources with WebFetch. Synthesis §14 exists as cited and D39 is the contract's title decision, so those references hold. Nothing was modified.

R3.1
- Where: ASSESSMENT-2026-11-12.md line 178: "A surgery review suggested, for example, searching until about 80% is captured. [V, Kastner et al. 2009, J Clin Epidemiol, <https://pmc.ncbi.nlm.nih.gov/articles/PMC2655834>; <https://core.ac.uk/works/100848577>]"
- Problem: The source does not give an 80% target, and the work tags this [V] (verified) when it was not checked against the source.
- Evidence: Fetched PMC2655834. The paper reports that the review "captured 68% of known articles" and "sets no target for this figure". It is one retrospective example (14 RCTs, 4 databases), and it says the procedure "has never been tested on a systematic review with ≥ 2 data sources". It also uses Poisson regression and a confidence interval, not the Lincoln–Petersen estimator the assessment describes in line 177. The paper's own framing is that "researchers have no rational search stopping rule".
- Severity: must-fix
- Confidence: high

R3.2
- Where: line 14: "**Q3. A better research process?** Yes." and lines 140 to 144: "A lead agent with parallel subagents outperformed a single agent by 90.2%... Token usage alone explained 80% of the variance in performance... The lesson [D]: depth costs tokens, and parallel fresh contexts are how to spend them productively."
- Problem: The answer "Yes, better" to "is there a more efficient or better process than the current one?" is not supported by the evidence cited, and the lesson draws a mechanism the source does not show.
- Evidence: The 90.2% compares a multi-agent system with a single-agent Opus 4, in Anthropic's internal research eval. It is not a comparison with this repository's current research process, which the assessment never describes or measures (grep finds no agent research skill in .claude or docs). The 80% figure is for BrowseComp, which the work does not say, and it shows that token usage correlates with performance. It does not show that parallel fresh contexts are the mechanism. The same post says multi-agent systems fit poorly where "all agents share the same context", a caveat the work omits (see R3.9).
- Severity: must-fix
- Confidence: high

R3.3
- Where: line 127: "### 6.1 Why agent research stays shallow [D]", followed by six causes (lines 128 to 134).
- Problem: The tag [D] means "derived in this document", but the six causes are asserted about agent behaviour and are not derived from any source or argument in the document.
- Evidence: The section gives no citation or derivation for any of the six causes, and §8 does not list them as unverified. Under the work's own tag convention they should be [K] or unverified, not [D].
- Severity: should-fix
- Confidence: high

R3.4
- Where: line 50: "A planted bug that survives (the suite still passes) is a proven gap."
- Problem: A surviving mutant shows only that the suite does not kill that mutant. It does not prove a coverage gap, because the mutant may be equivalent to the original or may change behaviour the requirement does not demand.
- Evidence: The same section relies on agent-written mutants (lines 52 to 53), which are the case most prone to equivalent mutants. The equivalent-mutant problem is standard mutation-testing knowledge [K], and the work does not mention it.
- Severity: should-fix
- Confidence: high

R3.5
- Where: lines 173 to 175: "**Decision stability (primary).** Stop when the last round changed neither the recommendation nor its confidence." and line 181: "the owner decides whether to continue."
- Problem: The Q4 answer names four stopping rules but never says how "confidence" is measured or which rule governs when they disagree, and the final checkpoint leaves the stop decision to the owner, which does not meet the mission's requirement (S5, line 55 of MISSION.md) that research "stops under a stated rule".
- Evidence: "Confidence" appears only in lines 175 and 14 and is never defined. The saturation, capture-recapture and budget rules (lines 176 to 181) have no stated precedence. The mission's S5 says the stop must be by a stated rule "rather than when the agent feels done", and the owner-decides checkpoint is the human judgment that S5 replaces.
- Severity: should-fix
- Confidence: high

R3.6
- Where: §7, step 6 (line 190): "Build a small seeded set... Use it to measure S1 before and after each change."
- Problem: The order puts the baseline measurement last, after every change in steps 1 to 5, so the "before" measurement the text asks for is never taken before the changes it is meant to judge.
- Evidence: MISSION.md §6 S1 says the target "is set once a baseline has been measured". Step 6 is listed after steps 1 to 5 and the work says "Nothing in section 3 or later has been built or run" (line 194).
- Severity: should-fix
- Confidence: high

R3.7
- Where: line 44 (C7): "stop when a round produces no new must-fix findings, or when the judge rejects most of what the reviewers raise. Either way, the reviewers have reached noise."
- Problem: A round with no new must-fix findings does not show that the reviewers are exhausted, and a judge rejecting most findings shows that the reviewers' findings were weak, not that the work has no remaining defects.
- Evidence: The text states the conclusion ("reached noise") without an argument linking the two signals to it. The same weakness applies to the research stopping rules in R3.5.
- Severity: should-fix
- Confidence: medium

R3.8
- Where: line 176: "Qualitative research calls this theoretical saturation. [K]"
- Problem: The analogy is weak, because theoretical saturation in grounded-theory interview research refers to codes or categories stopping yielding new themes, not to search-result novelty.
- Evidence: The sentence is tagged [K] but the analogy is offered as support for a search stopping rule without any argument for the transfer.
- Severity: nitpick
- Confidence: low

R3.9
- Where: line 141 onward (§6.2), and line 195 (§8): "the 15-times token figure against the primary post (a secondary summary reports it)" listed as not checked.
- Problem: §8 says the 15x figure was not checked against the primary post, but the figure is in the primary post, and §6.2 tags it [V]. The two statements contradict each other.
- Evidence: The fetched post says "multi-agent systems use about 15× more tokens than chats." The same post's caveat that multi-agent systems are poor fits where agents "share the same context" is also omitted from §6.2.
- Severity: nitpick
- Confidence: high

Unverified, not checked by me: the ISO/IEC/IEEE 29148 characteristics (line 85, tagged [K]), StrykerJS's Vitest 5 compatibility (line 53), and the claim that the Rieseberg interview (MISSION.md §2) is accurately summarised. I did not check these against any source.

Verdict: Fix first. The §6.4 citation misstates its source (R3.1) and the Q3 answer does not follow from the evidence (R3.2). Both must be fixed before the owner decides what to build from the proposal.
