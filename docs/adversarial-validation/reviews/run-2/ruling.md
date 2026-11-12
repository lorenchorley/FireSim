JUDGE'S RULING on /home/user/FireSim/docs/adversarial-validation/ASSESSMENT-2026-11-12-v2.md (revision 2)

How I checked
- Read the pack, all five reports (R1 to R5, from the report files; each opens with a note that its own write was refused and that it returned the full text instead), the work, MISSION.md, the run-1 ruling, the run-1 record, README.md, and the v1 skill files (SKILL.md, reviewer-prompt.md, judge-prompt.md, lenses.md).
- Re-fetched the Europe PMC records for Kastner 2009 (PMID 18722088) and Stelfox 2013 (doi 10.1016/j.amjsurg.2012.11.017) directly. Every number, author, volume, issue, page and year in section 6.4 matches the abstracts.
- Fetched PMC2655834 and the Anthropic post through a summarising fetch tool. The 2007 paper's abstract gives the 68% figure; its Discussion (not its abstract) says the horizon estimation "has never been tested on a systematic review with >= 2 data sources". The Anthropic quotes (90.2%, Opus 4 lead with Sonnet 4 subagents, 80% of BrowseComp variance, 4x and 15x tokens, the "share the same context or involve many dependencies" limit, "not yet great at coordinating and delegating") all match. These came through a summary, so they are not verbatim reads of the page.
- Ran `npm view`: `@stryker-mutator/vitest-runner` 10.1.1 has peer `vitest >=2.0.0`; vitest on the registry is 5.1.0.
- Checked package.json (`"test": "vitest run"`, `"test:fast"`, `"vitest": "^5.0.2"`), `.gitignore` (`node_modules/`), and the suite header (`Runtime ≈ 2–3 min on one x86 core`).
- Compared revision 2 with revision 1 line by line (diff) to confirm what changed and that M1, M2 and S1 to S3 of the run-1 ruling are applied as the revision notes say.
- Could not check: the full texts of the two journal papers; the Agent tool's `isolation: "worktree"` option (the Agent tool is not in my toolset); whether the Agent tool reports token use; StrykerJS at runtime under Vitest 5; the claim in section 6.4 that the "about 80%" figure came from a search-tool summary (a statement about the author's process).

Run-1's two must-fix items are correctly applied. M1: the citations now match the abstracts, the unsupported 80% and "surgery" attribution are removed, and the formula is separated from the papers. M2: the seeded set is step 1 and is re-run in step 7. No new valid finding is wrong-as-stated or harmful if sent, so I have no must-fix item.

---

A. MUST-FIX

None.

---

B. SHOULD-FIX AND OPTIONAL

Should fix (ordered by damage if left in; most are one-sentence edits, so one pass covers them)

S1. The Q3 test has no token-matched control (R3.1, R5.1). Valid.
- Where: section 6.5 ("Run the proposed process and a plain single-agent search on each question, with the same stakes ... the tokens and time it used").
- Evidence: section 6.2 itself says token use "by itself explained 80% of the performance variance" and that this "does not show that parallel contexts are the cause". The test then compares a multi-agent run against a plain single-agent run at default budget, so a win cannot be told apart from extra spend. R3 rated this must-fix. I rate it should-fix: no statement in the document is false (Q3 is already answered "Probably, at a higher cost, but not shown yet"), and the test as written does answer "does it beat today's agent research, and at what cost". It cannot answer the mission's other Q3 criterion, "more efficient", and it cannot say whether the pipeline or just a larger budget gave the gain.
- Direction: add a third arm, a single agent with the same token budget (ideally with the same ledger and stopping rule run in sequence), and score yield per token as well as total yield.

S2. The primary stopping rule cannot tell stalling from convergence (R3.3, R3.5). Valid.
- Where: section 6.4, "Stop when a round changes no answer and no rating."
- Evidence: a round whose searchers repeat the same queries changes nothing, so it triggers the rule. A sub-question that sits at "low" is also unchanged and stops. The rule does not require that the stable round searched anything new, and nothing in 6.4 says low-rated sub-questions are reported as open when a stop is proposed (only the budget clause reports "sub-questions still open"). The overlap signal, the only one that sees correlated searching, can only veto a stop and is the one the document says overestimates coverage. MISSION R2 and R3 name "stops when the agent feels done" as the failure to avoid.
- Direction: require the stop proposal to list every sub-question's rating, treat a stable "low" as "stalled, needs a change of strategy or owner input" and not as "done", and require that a counted round used queries or strategies not used before.
- Partly mitigated: the owner confirms each stop, and the ratings are recorded. That is why this is should-fix and not must-fix.

S3. The "high" rating depends on the researching agent's own judgement (R3.4, R5.5). Valid.
- Where: section 6.4, "A rating is high only when at least two independent sources support the answer and a deliberate search for contradicting evidence found none."
- Evidence: the agent that writes the ledger decides whether two sources are independent and whether its own search was deliberate. The document says agents running similar queries are not independent (same section), so the agent is a poor judge of the property being tested. MISSION P1: "The producer of a piece of work does not judge it." The limit "a rating moves only when a ledger entry is added or changed" restricts when a rating can move, not who sets it. D5 reviews the synthesis but not the stop decision.
- Direction: say who rates. Options to weigh: a fresh agent rates from the ledger alone; the judge rates; or the mechanical part (source count, source type) is checked by a script or fresh agent and only the "contradicting evidence" part needs judgement.

S4. Cost has no mechanism, and the "hard cap" has none either (R2.1, R4.5, R4.2). Valid. Run-1 S4 and S5 were left open in revision 2.
- Where: sections 5 and 7 (no cost item); section 6.4 ("The budget is a hard cap"); section 4 UC1 and UC3 (runs "in a worktree").
- Evidence: MISSION section 1 ("Its cost must match the stakes of the work"), P6 and S6 ask for proportion and a per-run cost report. Revision 2 records the gap in section 9 but not in section 8, so a reader of section 8 does not see it. SKILL.md's settings table passes only `model` and `effort`, so nothing in the skill gives a budget or reads token use. The orchestrator can count subagents and rounds, so a cap on those is possible, but the document does not say which kind of cap it means. A fresh worktree has no `node_modules` (`node_modules/` is in `.gitignore`), the suite takes 2 to 3 minutes, and the plan sets no subset (`test:fast` exists), no mutant count and no per-run estimate.
- Direction: add a cost element to the profile contract (a tier per profile, and a cost line in the report as MISSION S6 allows, "where measurable"); say which kind of cap the research budget is and what enforces it; say how a worktree gets its dependencies, which test subset mutant runs use, and a cap on mutants per run.

S5. The information barriers the design depends on are stated as method, not mechanism (R4.4). Valid.
- Where: C3 ("one agent therefore sees only the reference"), UC3 ("read only the spec, never the code"), section 6.5 ("keep it out of the agents' reach"), section 7 step 1 ("the answer key stays outside the repository").
- Evidence: all agents work in one repository with file tools, so an agent told to read only the spec can still open `src/`. SKILL.md isolation rule 2 controls only what the launch message says. The document names no mechanism (a copy in a separate directory, a restricted path list, or a stated acceptance that blindness is by instruction and is measured by the seeded set).
- Own addition: the section 6.5 example ("sub-questions that `docs/research` settled with cited sources") draws the answer key from documents that sit in the same repository the agents can read, so the key and its sources are not out of reach.
- Direction: state how each barrier is enforced, or say it is by instruction only and add a check (for example the seeded set measures whether the blind agent used the artifact). Choose test questions whose sources are not in the repository, or exclude those paths.

N1. (my own) The deep-research skill cannot be "connected" to a reviewer lens as written. Valid. Should fix.
- Where: section 4 UC2 "Research depth ... This reviewer does its own short search ... It needs the research process in section 6", and section 7 step 6, "connect it to the research-depth lens of the plan profile".
- Evidence: SKILL.md (current text): "The orchestrator has to be this session. Subagents in this environment have no Agent tool, so a subagent cannot start the reviewers or the judge. This was tested on 2026-11-12." The deep-research process needs parallel searchers (D2) and an adversarial review of the synthesis (D5), so it cannot run inside a reviewer subagent. No reviewer raised this; R4 checked feasibility but did not meet the line. I confirmed in `git show bc8857c` that this line was added after revision 2 was committed (29b4837), so the author may not have had it when drafting.
- Direction: say that research runs at the orchestrator level as a pre-step (like C2 and C3) and hands its ledger to the research-depth reviewer, or that the lens stays a single-agent search. Say which.

S6. The section 2 chain diagram puts UC2 and UC3 on the wrong arrows (R1.2, R2.2, R3.8). Valid.
- Where: lines 18 to 34. UC2 ("does the plan answer the mission") is drawn on the spec-to-plan arrow. UC3 ("does the code do what the spec says") is drawn on the plan-to-implementation arrow. The next sentence says each use case checks "an artifact against the reference above it".
- Evidence: MISSION section 4 defines UC2 as plan against the mission statement and UC3 as implementation against its specification. Section 4 of the work uses those definitions. The diagram contradicts both the sentence under it and the work's own section 4. My run-1 ruling raised it as an optional observation, and revision 2 lists it as left open while still presenting the chain as settled ("The use cases form one chain [D]").
- Direction: redraw so each arrow matches its definition, or say that UC2 and UC3 reference two levels up and fix the sentence. Rejected part of R2.2: MISSION section 9 requires a dated note only when the mission itself changes, and revision 2 does not edit the mission, so no dated note is owed.

S7. "A planted bug that survives ... is a proven gap" is wrong as stated (R3.9). Valid. Run-1 S7, left open.
- Where: section 4 UC1: "A planted bug that survives (the suite still passes) is a proven gap. [K]" and "Each surviving mutant becomes a finding with its own proof attached."
- Evidence: a surviving mutant can be equivalent to the original or can change behaviour no requirement demands. That is standard mutation-testing knowledge, so the [K] tag is attached to a claim that standard knowledge contradicts. The pipeline's judge could catch such cases, but the text says the proof is attached.
- Direction: call a survivor a candidate gap that the judge confirms as non-equivalent and in scope.

S8. The seeded set (step 1) is under-specified for a baseline (R2.6, R3.10, R4.6 in part). Valid.
- Where: section 7 step 1.
- Evidence: the step requires that the person who plants the defects is not the person who runs the review, and that the answer key stays outside the repository. It names no planter (MISSION and the README name one owner), and gives no durable location for the key (the scratchpad is session-specific). "One artifact is enough to start" gives a baseline from one run of a model whose output varies, with no defect count, no repeat count and no threshold for what counts as a change in step 7. The suggested example, a copy of this assessment, already carries real defects that run-1 and run-2 found, which would count as false positives against the key.
- Direction: give a minimum defect count and a number of repeat runs per artifact, say who plants and where the key lives, and say how real defects in the source artifact are handled.

S9. The ledger has no durable location, no write rule, and no state for sources that could not be read (R2.3). Valid. Run-1 S8, left open.
- Where: D4 ("The ledger makes research resumable across sessions") and the tag scheme in line 5.
- Evidence: MISSION R3 needs research to continue over several sessions, and K2 bars reviewers and judges from writing to the main tree. The document names no location or permitted writer. The document's own section 6.4 needed a state ("[V for the abstracts and records only]", "could not be opened and is dropped") that D4's fields do not have.
- Direction: name a durable location and who may write to it consistently with K2, and add a "read in full / abstract only / could not open" field to the ledger.

S10. Version 1's existing lens sets, and the smallest alternative, are not weighed (R5.3). Valid. Run-1 S6, left open.
- Where: section 5 ("deliverable.md UC0, today's prose lenses"); section 1 Q1/Q2.
- Evidence: `lenses.md` has three sets (prose, code, plans). The Plans set already holds Feasibility, Missing requirements, Failure modes and rollback, Alternatives and Cost and commitment; the Code set's "Tests and regressions" lens targets "tests that would still pass if the code were wrong", which is the core of UC1. Run-1 itself used a mix of prose and plans lenses on revision 1. The section 5 argument against four separate skills holds, but the smaller option (keep version 1, add a reference role and blind derivation, reuse the existing lens sets) is never stated or argued against.
- Direction: say what version 1 and its three lens sets already cover and where each set lands in the profiles, and state why that smaller option is not enough.

S11. Section 8 says version 1 "has not been run end to end yet", which conflicts with the review record (R1.3). Valid.
- Where: section 8 line 1 versus section 9 ("The review record (pack, five reviewer reports, ruling) is in `reviews/run-1/`").
- Evidence: `reviews/run-1/` holds a pack, five reports and a ruling, and SKILL.md refers to "run 1". That is an end-to-end run of version 1. The sentence may mean "not run on this proposal", but as written it contradicts section 9, and run-1 S3 ruled a similar contradiction should-fix.
- Direction: say what has and has not been run (for example, run once on revision 1, not yet on the seeded set).

Optional

O1. The 2007 paper's "never been tested on ... two or more data sources" statement comes from its Discussion, but the tag says "abstracts and records only" (R1.1). Valid but minor. The claim is accurate and section 8 refers only to "the two" journal papers. Direction: add the 2007 paper to the "read beyond its abstract" note or drop the clause.

O2. Revision log row M1 says the formula "is marked as the document's own gloss", but the text tags it [K] and calls it "the textbook two-sample estimator" (R1.4). Valid but minor. The substance matches what run-1 asked for (the formula is separated from the cited papers). Direction: make the log say what the text says.

O3. C6: the quoted v1 rule "read-only" is not in the current skill files, and no build step applies C6 (R1.5, R4.1). Valid but minor. Current wording is reviewer-prompt.md line 21 ("Do not modify, create or delete any file except REPORT_PATH") and SKILL.md isolation rule 3 ("never write to the repository"). The quote is from the earlier text that run-1's ruling cited; `git show bc8857c` shows that commit removed "Reviewers and the judge are read-only" after revision 2 was committed. Step 2 adds "C1 to C5", and step 4 needs C6. Direction: quote the current rule, and add C6 to step 2 or step 4. Run-1 O3.

O4. The plan profile ships in step 3 but its research-depth lens "needs the research process" built in step 6 (R4.3). Valid but minor. It is a staged build and step 6 connects them. Direction: say the lens ships as a single-agent search first and that the step 3 dogfood runs with it in that form. Run-1 O2.

O5. The work cites mission S1 and K2 without saying sections 6 and 7 of the mission are still "proposed" (R2.5). Valid but minor. MISSION's status line and revision notes still show them unconfirmed. Direction: one clause in the status line.

O6. The new invocation form (`/adversarial-review plan ... --against ...`) does not say whether the existing arguments (`review-only`, `lenses:`) still work (R2.7). Valid but minor. Direction: one sentence on compatibility.

O7. The overlap signal assumes equal catchability, and giving the searchers different strategies changes the bias in a direction the document does not state (R3.2, R4.7, R5.6). Valid but minor. Line 186 lets the overlap signal only veto a stop, so a biased estimate costs extra rounds (bounded by the budget) and cannot end research early. Direction: say that the sign of the bias is unknown under different strategies, define "relevant source" across strategies, and plan to calibrate the signal in the 6.5 test.

O8. "This is the value-of-information view of when to stop" overstates decision stability, which compares no expected gain with cost (R3.6). Valid but minor. Direction: say "a practical proxy for".

O9. C7: "Either way, the reviewers have reached noise" is asserted without argument (R3.7). Valid but minor. A round with no new must-fix findings is also what a shared blind spot looks like. Run-1 O6. Direction: say "may have reached noise" and name what else would be checked.

O10. Section 6.1 is tagged [D] but the six causes are asserted behaviours (R3.11). Valid but minor. Run-1 O5. Direction: tag [K] or call them hypotheses.

O11. The StrykerJS check is open, but the registry already shows peer range `vitest >=2.0.0` for `@stryker-mutator/vitest-runner` 10.1.1 (R4.8). Valid but minor; I confirmed the fact. It does not make the "not checked" line false. Direction: cite the peer range as [V] and keep the runtime check as the step 5 gate.

O12. The Workflow tool is dismissed in one clause and not weighed as the engine for the fixed pipeline (R5.4). Valid but minor. The "owner must ask for it" limit is real (the skill list says "a workflow the user already opted into"), but it applies to the proposed research skill too. Run-1 O1. R5's claim that a prose skill cannot enforce any cap is too strong (see S4: the orchestrator can count subagents and rounds). Direction: one sentence weighing it.

O13. Agent-written mutants come before mechanical mutation, with no case against mechanical-first plus mapping survivors to requirements (R5.7). Valid but minor. The document does give a reason (requirement traceability), and whole-suite mechanical runs on a 2 to 3 minute suite are costly, which the document does not say. Direction: add the comparison in a sentence.

O14. (my own) Section 6.4 quotes revision 1 as "search until about 80% is captured"; revision 1 reads "searching until about 80% is captured". Trivial wording slip inside quotation marks. Direction: copy the quote exactly.

---

C. REJECTED

- R2.4 (stopping rule "not yet a stated rule"): section 6.4 states a rule that can be applied (record answer and rating per sub-question, stop when a round changes neither) and run-1 S1 asked for exactly this, or for the open items to be marked. The remaining numbers are disclosed as open design items. MISSION R3 asks for a stated rule, not calibrated values.
- R3.12 ("four separate skills" but five profiles): Q2 concerns skills for the four new use cases UC1 to UC4. UC0 already has the existing skill. The count is right.
- R5.2 (baseline ignores the repo's own research practice): MISSION Q3 asks about "the current" agent research process, and MISSION R2 describes it as "fast and shallow". `docs/research` holds outputs and a tag convention, not an agent research process. R5 says its reading is an inference. The tagging and fact-check passes verify results; they are not a search method to compare against.
- R3.13 (one round or two rounds governs): line 186 says "Decision stability decides"; the two-round rule defines the saturation signal, which only vetoes. The undefined "recent surge" is the disclosed open cutoff in line 177.
- R4.6 in part ("the step contradicts itself" and "the baseline measures a different task"): "A first version with one artifact" scopes the first pass and does not contradict "one artifact per use case". Running version 1 on UC1 to UC4 artifacts is the baseline S1 asks for. The rest of R4.6 stands as S8.
- R2.2 in part (a dated note under MISSION section 9, and S4 "never resolved silently" breached): the mission is not edited, and S4 concerns ambiguity in a reference that the work reviews, not the work's own diagram. The diagram error itself stands as S6.

---

D. LEDGER

| # | Finding | Reviewer ids | Ruling | Priority |
|---|---|---|---|---|
| S1 | Q3 test has no token-matched control | R3.1, R5.1 | Valid (R3 rated must-fix; I rate should-fix) | Should fix |
| S2 | Stop rule cannot tell stall from convergence; stable "low" stops silently | R3.3, R3.5 | Valid | Should fix |
| S3 | "High" rating set by the researching agent (P1) | R3.4, R5.5 | Valid | Should fix |
| S4 | No cost mechanism; "hard cap" unspecified; worktree runs uncosted | R2.1, R4.5, R4.2 | Valid | Should fix |
| S5 | Information barriers and answer key not enforceable as described | R4.4 (+ own addition on 6.5) | Valid | Should fix |
| N1 | Research skill cannot run inside a reviewer lens (no nested subagents) | own | Valid | Should fix |
| S6 | Section 2 diagram: UC2 and UC3 on wrong arrows | R1.2, R2.2, R3.8 | Valid (dated-note sub-claim rejected) | Should fix |
| S7 | "Proven gap" ignores equivalent mutants | R3.9 | Valid | Should fix |
| S8 | Seeded set under-specified for a baseline | R2.6, R3.10, R4.6 (part) | Valid | Should fix |
| S9 | Ledger location, write rule, unread-source state | R2.3 | Valid | Should fix |
| S10 | v1 lens sets and the smallest alternative not weighed | R5.3 | Valid | Should fix |
| S11 | Section 8 "not run end to end" contradicts section 9 | R1.3 | Valid | Should fix |
| O1 | 2007 paper statement is from the Discussion; tag says abstracts only | R1.1 | Valid but minor | Optional |
| O2 | Log says "own gloss"; text says "textbook" | R1.4 | Valid but minor | Optional |
| O3 | C6: stale "read-only" quote; no step applies C6 | R1.5, R4.1 | Valid but minor | Optional |
| O4 | Plan profile before the research process it needs | R4.3 | Valid but minor | Optional |
| O5 | Mission sections 6 and 7 still "proposed" | R2.5 | Valid but minor | Optional |
| O6 | Invocation compatibility | R2.7 | Valid but minor | Optional |
| O7 | Overlap estimator under different strategies | R3.2, R4.7, R5.6 | Valid but minor | Optional |
| O8 | "Value of information" label | R3.6 | Valid but minor | Optional |
| O9 | C7 "reached noise" | R3.7 | Valid but minor | Optional |
| O10 | Section 6.1 [D] tag | R3.11 | Valid but minor | Optional |
| O11 | Cite the Stryker peer range | R4.8 | Valid but minor | Optional |
| O12 | Workflow tool not weighed | R5.4 | Valid but minor | Optional |
| O13 | Mechanical mutation not compared | R5.7 | Valid but minor | Optional |
| O14 | Misquote of revision 1 wording | own | Valid but minor | Optional |
| X1 | Stopping rule not a stated rule | R2.4 | Rejected | none |
| X2 | "Four skills" vs five profiles | R3.12 | Rejected | none |
| X3 | Baseline should be the repo's research practice | R5.2 | Rejected | none |
| X4 | One round vs two rounds | R3.13 | Rejected | none |
| X5 | Step 1 contradicts itself; baseline is a different task | R4.6 (part) | Rejected | none |

Every finding id from R1.1 to R5.7 appears above: R1.1 O1; R1.2 S6; R1.3 S11; R1.4 O2; R1.5 O3; R2.1 S4; R2.2 S6; R2.3 S9; R2.4 X1; R2.5 O5; R2.6 S8; R2.7 O6; R3.1 S1; R3.2 O7; R3.3 S2; R3.4 S3; R3.5 S2; R3.6 O8; R3.7 O9; R3.8 S6; R3.9 S7; R3.10 S8; R3.11 O10; R3.12 X2; R3.13 X4; R4.1 O3; R4.2 S4; R4.3 O4; R4.4 S5; R4.5 S4; R4.6 S8 and X5; R4.7 O7; R4.8 O11; R5.1 S1; R5.2 X3; R5.3 S10; R5.4 O12; R5.5 S3; R5.6 O7; R5.7 O13.

---

E. OVERALL CALL

Ready to send as a proposal. No finding is wrong-as-stated or harmful if sent, and the two run-1 must-fix items are fixed and checked against their sources. The document also states its own open items in section 9, so the owner is not misled about what is unfinished.

I recommend one more pass over the should-fix list before the owner decides what to build, because most items are one-sentence edits and three of them change what the owner would build: S1 (the Q3 test design), S2 and S3 (the primary stopping rule), and N1 (how research connects to the plan profile). S6, S7 and S11 are plain inconsistencies in the text. S4, S8, S9 and S10 repeat run-1 items the author chose to leave open (S4, S5, S6, S8) or add specifics to them; if the owner wants them left open again, section 8 should say so as well as section 9.
