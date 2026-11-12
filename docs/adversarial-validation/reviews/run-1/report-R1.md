R1 report (lens: facts and numbers). Work: /home/user/FireSim/docs/adversarial-validation/ASSESSMENT-2026-11-12.md

R1.1
- Where: ASSESSMENT line 178: "Systematic-review methodology has proposed this as a stopping rule for literature searches. A surgery review suggested, for example, searching until about 80% is captured. [V, Kastner et al. 2009, J Clin Epidemiol, <https://pmc.ncbi.nlm.nih.gov/articles/PMC2655834>; <https://core.ac.uk/works/100848577>]"
- Problem: The citation is wrong and the "80%" figure is not in the source it is tagged [V] to.
- Evidence: The PMC page (PMC2655834, fetched this session) is Kastner et al., AMIA Annu Symp Proc 2007;2007:389-393, "Estimating the Horizon of Articles to Decide When to Stop Searching in Systematic Reviews: An Example Using a Systematic Review of RCTs Evaluating Osteoporosis Clinical Decision Support Tools". It is an osteoporosis review, not surgery, and not J Clin Epidemiol 2009. Its only figure is that the review "captured 68% of known articles"; I found no 80% threshold anywhere in the text. The core.ac.uk link returned a Cloudflare challenge, so the 2009 / J Clin Epidemiol / surgery attribution could not be checked at that link either and is unverified. The CMR-as-stopping-rule idea is supported by the PMC paper; the specific surgery and 80% claims are not.
- Severity: must-fix (a [V]-tagged citation with the wrong year, journal and field, and a number the source does not contain; this is the basis for the Q4 stopping rule).
- Confidence: high.

R1.2
- Where: ASSESSMENT line 142 tags the bullet "The same post puts multi-agent systems at about 15 times the tokens of a chat" as [V] to the primary post (line 139). Line 195 says: "Not checked: ... the 15-times token figure against the primary post (a secondary summary reports it)."
- Problem: The two statements contradict each other about whether the figure was checked, and line 195 is wrong.
- Evidence: The primary post (https://www.anthropic.com/engineering/multi-agent-research-system, fetched) says: "agents typically use about 4× more tokens than chat interactions, and multi-agent systems use about 15× more tokens than chats." The figure is correct, so line 195 is stale. Either the tag or the caveat should be fixed.
- Severity: should-fix.
- Confidence: high.

R1.3
- Where: ASSESSMENT lines 140-141: "A lead agent with parallel subagents outperformed a single agent by 90.2%..." and "Token usage alone explained 80% of the variance in performance."
- Problem: Both figures are stated more generally than the source supports, and the work then uses them to justify its research design.
- Evidence: The post says the 90.2% was Opus 4 lead with Sonnet 4 subagents against single-agent Opus 4, on Anthropic's internal research eval, and that multi-agent systems "excel especially for breadth-first queries". The 80% variance figure comes from the BrowseComp evaluation ("three factors explained 95% of the performance variance in the BrowseComp evaluation... token usage by itself explains 80% of the variance"). The work does not name BrowseComp and does not give the breadth-first limit.
- Severity: should-fix.
- Confidence: high.

R1.4
- Where: ASSESSMENT line 179: "It has been validated only in small, retrospective studies."
- Problem: Untagged claim about the literature that the work does not support with a source.
- Evidence: The cited PMC paper is a single retrospective example (it says so), which fits the claim, but the sentence is stated as a general literature finding with no tag or source beyond it. Unverified, not shown wrong.
- Severity: nitpick.
- Confidence: low.

R1.5
- Where: ASSESSMENT line 38: "C1. Two roles in the pack. Version 1 has "work" and "sources"."
- Problem: It omits the third item the v1 pack has, "Purpose".
- Evidence: /home/user/FireSim/.claude/skills/adversarial-review/SKILL.md step 1 builds the pack with Work, Sources and Purpose.
- Severity: nitpick.
- Confidence: high.

Checked and correct: MISSION Q1 to Q4 and S4, K2, P1 references; package.json "test": "vitest run" and vitest ^5.0.2; the CONTRACT-0.10.0.md "1060 kB gzip" budget and D39 reference; 00-synthesis.md §14 is "Test vectors"; five profiles listed in §5; the Lincoln-Petersen formula n1 x n2 / m; D1 to D5 and S1 to S6 counts.

Not checked: Web search "standard and extended modes" and the Agent tool's worktree isolation (tooling claims I cannot verify from here); the ISO 29148 claims (already tagged [K] and listed in §8).

Verdict: Fix first. R1.1 must be corrected or removed before the owner relies on Q4 (the stopping rule's empirical basis).
