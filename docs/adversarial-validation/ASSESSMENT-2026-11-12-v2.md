# Adversarial validation: first assessment (revision 2)

**Status:** proposal, not a decision. This is revision 2. Revision 1 (`ASSESSMENT-2026-11-12.md`) is kept unchanged. This document answers the open questions Q1 to Q4 in `MISSION.md`, and applies items M1, M2 and S1 to S3 of the judge's ruling on revision 1 (`reviews/run-1/ruling.md`; section 9 lists the changes). It is the kind of document UC2 is meant to review: check it against the mission before acting on it.

**Evidence tags** (the repo's convention): **[V]** verified this session against a source named here; **[K]** standard knowledge, not re-verified this session; **[D]** derived in this document.

---

## 1. Short answers

- **Q1. Is one process right for every use case?** The core holds for all four: fresh reviewers, different angles, a judge that verifies, and the owner sees the ruling first. Version 1 does not work as-is, though. It is tuned for one question: "is this deliverable ready to send?" UC1 to UC4 are a different kind of check. Each compares an artifact against a reference, so each needs a second input, a way to find what is missing, and in two cases permission to run code. Sections 3 and 4 give the details.
- **Q2. Separate skills?** Use one skill as the engine, with a profile file per use case. Four separate skills would copy the same orchestration and isolation rules four times, and the copies would drift (section 5).
- **Q3. A better research process?** Probably, at a higher cost, but not shown yet. Anthropic reports that a multi-agent setup beat a single agent on its own research evaluation while using about 15 times the tokens of a chat. No evidence compares the process proposed here with the one in use today. The proposal: parallel searchers that each have their own strategy, citation-following, a ledger on disk that carries the research across sessions, and an adversarial check of the final synthesis, as its own skill (section 6), tested against the current approach before it is relied on (section 6.5).
- **Q4. When should research stop?** The main rule is decision stability: stop when another round changes no answer and no recorded confidence rating. Two signals support it: the rate of new findings, and the overlap between independent searchers. A budget set by the owner caps each round, and the owner confirms each stop (section 6.4). The thresholds are open design items.

## 2. The use cases form one chain [D]

```
 mission / requirements
        │  UC4  is the spec complete, consistent, and does it answer the requirements?
        ▼
       spec
        │  UC2  does the plan answer the mission, and was it researched?
        ▼
       plan
        │  UC3  does the code do what the spec says?
        ▼
  implementation
        │  UC1  would the tests fail if the code were wrong?
        ▼
      tests
```

Each use case checks one link: an **artifact** against the **reference** above it. UC2 and UC4 also question the reference itself.

## 3. Changes every conformance use case needs

- **C1. Two roles in the pack.** Version 1 has "work" and "sources". UC1 to UC4 need a **reference**, which is the authority, and an **artifact**, which is under review. Every finding names the requirement it concerns and where the artifact meets it. If the artifact does not address the requirement, the finding says so.
- **C2. A requirement inventory written by a fresh agent.** Before any review starts, a subagent that sees only the reference extracts numbered, atomic requirements, plus the ambiguities it found. The reviewers then check coverage against that list. The orchestrator must not write the list itself. It is usually the author, and the inventory would carry the author's interpretation (P1).
- **C3. Blind derivation, the main tool for finding omissions.** Reviewers who read the artifact first anchor on what is there, and a gap is the hardest thing to notice. One agent therefore sees only the reference and writes what it would expect: the requirements a spec should cover, the outline of a plan, or the test cases a suite should contain. Comparing that with the artifact turns gaps and diverging interpretations into findings. This is the most direct answer to "has everything been considered?" (UC4) and "was the mission interpreted correctly?" (UC2).
- **C4. Tracing in both directions.** Forward: every requirement is covered by the artifact. Backward: every part of the artifact traces back to a requirement. A part that traces to nothing is either scope creep or a decision nobody recorded.
- **C5. A ruling for owner decisions.** Add a fifth ruling for the judge: **Needs owner decision**. It covers ambiguity in the reference and genuine trade-offs, and those findings go to the owner, not the author. Without this ruling, the judge has to force an arguable point into "must fix" or "rejected". This is how S4 gets met.
- **C6. Running code in an isolated copy.** In UC1 and UC3, the strongest evidence comes from running code. Reviewers may run code in an isolated worktree (the Agent tool's `isolation: "worktree"`), never in the main tree (K2). The version 1 rule "read-only" becomes "never writes to the main tree".
- **C7. When to stop iterating.** When the process runs in a loop, stop when a round produces no new must-fix findings, or when the judge rejects most of what the reviewers raise. Either way, the reviewers have reached noise.

## 4. Each use case

### UC1. Test adequacy

Reading tests is weak evidence of what they catch. The direct measure is **mutation testing**: plant a bug, run the suite, and see whether it fails. A planted bug that survives (the suite still passes) is a proven gap. [K]

- **Requirement-targeted mutants, written by agents.** For each requirement in the inventory (C2), a reviewer writes a plausible bug that breaks that requirement and runs the suite in a worktree. Each surviving mutant becomes a finding with its own proof attached. This ties gaps to requirements, which generic mutation tools do not do.
- **Mechanical mutation for the whole suite.** The repo runs Vitest (`"test": "vitest run"`). StrykerJS has a Vitest runner [K], but its compatibility with Vitest 5 must be checked first.
- **Lenses:**
  - requirement coverage
  - assertion strength (would the test fail if the result were wrong?)
  - edge cases and error paths
  - over-mocking (tests that only test their mocks)
  - determinism and flakiness
- **Coverage.** Line coverage is weak evidence: a line can run without anything checking its result. [K]

### UC2. Plan against mission

- **Blind derivation is the core step.** A fresh agent reads only the mission and writes two things: its interpretation (goals, constraints, success criteria, ambiguities) and the outline of the plan it would expect. Its differences from the actual plan are the findings about interpretation.
- **Lenses:**
  - **Interpretation fidelity:** does the plan solve the problem the mission states?
  - **Research depth:** are the plan's claims sourced, and were alternatives and prior art considered? This reviewer does its own short search on the plan's key decisions and reports what the plan missed. It needs the research process in section 6.
  - **Structure and sequencing:** dependencies, milestones, and steps that can each be verified, with exit criteria.
  - **Risks and unknowns.**
  - **Mission critique:** ambiguities, contradictions and missing success criteria in the mission itself, all ruled "Needs owner decision" (C5).
- **Recorded decisions.** This repo's plans record numbered decisions (for example D39 in `docs/plans/0.10.0/CONTRACT-0.10.0.md`). The plan reviewers should check the plan against those as well.

### UC3. Implementation against spec

- **Spec-derived acceptance tests, written blind.** An agent that has read only the spec, never the code, writes tests and runs them against the implementation in a worktree. Each failure is evidence, and the judge decides whether the code, the test or the spec is wrong. Where a spec already contains test vectors (as `docs/research/00-synthesis.md` §14 does), those are used directly.
- **Lenses:**
  - **Behavioural conformance.**
  - **Unrecorded decisions:** behaviour the spec leaves open but the code had to settle.
  - **Extra behaviour:** behaviour the spec does not ask for.
  - **Errors and edge cases, as the spec defines them.**
  - **Non-functional requirements:** performance, security and budgets, such as the 1060 kB gzip JavaScript budget in the 0.10.0 contract.

### UC4. Spec quality

- **Lenses** grounded in the requirement characteristics of ISO/IEC/IEEE 29148 [K]:
  - **Completeness against the requirements**, traced in both directions (C4).
  - **Internal consistency:** contradictions, terms that drift in meaning, and units and numbers that disagree between sections.
  - **Ambiguity and testability:** could two engineers build it differently, and can each requirement be verified?
  - **Edge cases and failure states.**
  - **Cross-cutting concerns,** from a checklist: security, privacy, accessibility, performance, offline behaviour, migration, observability and localisation.
- **Blind derivation:** from the requirements alone, an agent writes what an expert would expect the spec to cover.
- **No recorded requirements:** if none exist, the report says so. The reviewers then check the spec against its own stated goals, and the ruling states that tracing against requirements was not possible.

## 5. One engine, five profiles

The proposed layout:

```
.claude/skills/adversarial-review/
  SKILL.md               engine: pack, isolation, fan-out, judge, ruling, author's answer
  reviewer-prompt.md
  judge-prompt.md        gains "Needs owner decision" (C5) and requirement ids (C1)
  inventory-prompt.md    C2
  derivation-prompt.md   C3
  profiles/
    deliverable.md       UC0, today's prose lenses
    tests.md             UC1, worktree, targeted mutants
    plan.md              UC2
    implementation.md    UC3, worktree, blind acceptance tests
    spec.md              UC4
```

Each profile states the same five things:

1. the reference and the artifact
2. which pre-steps run (inventory, derivation, mutation)
3. the lenses
4. permissions (read-only, or a worktree)
5. any additions to the judge

The invocation would look like `/adversarial-review plan docs/plans/x.md --against docs/adversarial-validation/MISSION.md`.

**When to split.** The tests profile should become its own skill only if mutation tooling makes it large. Even then, it should reuse the engine's prompt files rather than copy them.

## 6. Research process (Q3, Q4)

### 6.1 Why agent research stays shallow [D]

1. It sends a few queries and stops at the first plausible answer.
2. One context window fills up as it reads, which pushes it to finish.
3. It has no map of the question, so it cannot tell what it has not covered.
4. Its queries are rephrasings of each other, so they return the same top-ranked pages.
5. It rarely follows references and citations, which is where people find the material that is not obvious.
6. Different communities use different names for the same idea, and a searcher using one vocabulary misses the others.

### 6.2 What exists

- **Tools in this environment.** Web search (standard and extended modes), a page-reading agent, parallel subagents, and the Workflow tool. The Workflow tool runs deterministic multi-agent orchestration, but only when the owner asks for it explicitly ("use a workflow").
- **Anthropic's account of Claude's Research feature** [V, <https://www.anthropic.com/engineering/multi-agent-research-system>, read through a fetch tool this session]:
  - A multi-agent system with Claude Opus 4 as lead agent and Claude Sonnet 4 subagents outperformed single-agent Claude Opus 4 by 90.2% on Anthropic's internal research eval. That eval is not a public benchmark.
  - In Anthropic's analysis of the BrowseComp evaluation, token usage by itself explained 80% of the performance variance. Tool calls and model choice were the other two factors.
  - Agents typically use about 4 times the tokens of a chat, and multi-agent systems about 15 times.
  - The post names limits. Domains that "require all agents to share the same context or involve many dependencies between agents" are "not a good fit for multi-agent systems today". LLM agents "are not yet great at coordinating and delegating to other agents in real time". The task's value also has to be high enough to pay for the extra cost.

  What this supports [D]: spending more tokens in parallel fresh contexts gave better results on research that splits into parallel parts. It does not show that the process proposed here beats the research process in use today, and it does not show that parallel contexts are the cause, since token use alone explained most of the variance. Parts of the proposed pipeline (inventory before review, derivation before comparison, ledger rounds) have the dependencies the post warns about. Section 6.5 therefore asks for a test before the skill is relied on.

### 6.3 Proposed `deep-research` skill

- **D1. Frame.**
  - the question
  - the decision it serves
  - what would change the answer
  - a tree of sub-questions
  - a budget per round
- **D2. Diverse searchers in parallel**, split by strategy as well as by sub-question:
  - primary sources: papers, standards, official documentation
  - practitioners: engineering blogs, issue trackers, talks, forums
  - contrarian: failures, critiques, negative results
  - adjacent fields and alternative vocabulary
  - recency: the last twelve months
- **D3. Snowballing.** From the best sources, follow references backwards, citations forwards, and the same authors.
- **D4. Ledger on disk.**
  - each claim with its source and an evidence tag ([V], [K] or [D], as in this repo)
  - every source already seen, to avoid duplicates
  - open sub-questions
  - a report for each round

  The ledger makes research resumable across sessions, so it can run over days, the way the owner researches by hand.
- **D5. Synthesis, then adversarial review of the synthesis.** Three lenses:
  - do the citations say what is claimed?
  - coverage, checked by blind derivation (C3)
  - a contrarian reading

### 6.4 Stopping rules (Q4)

- **Decision stability (primary).** At the end of each round, the skill records for every sub-question in the frame (D1) the current answer, a confidence rating of low, medium or high, and the ledger entries behind the rating, both for and against. A rating is high only when at least two independent sources support the answer and a deliberate search for contradicting evidence found none. Stop when a round changes no answer and no rating. A rating moves only when a ledger entry is added or changed, so the agent cannot raise its own confidence without new evidence. Research serves a decision, so this is the value-of-information view of when to stop. The rating scale and the two-source rule are starting values to calibrate (section 7, step 1). [D]
- **Saturation.** Track the share of each round's findings that are new to the ledger, and report the trend. Two rounds in a row that add nothing that changes a conclusion is the signal. The cutoff at which a falling share counts as saturation is an open design item. Qualitative research calls this theoretical saturation. [K]
- **Overlap between independent searchers (capture-recapture).** Two searchers work the same sub-question independently. If they find *n1* and *n2* relevant sources, *m* of them shared, the total is about *n1 × n2 / m* (Lincoln–Petersen). Coverage is then roughly what was found divided by that estimate. [K] This is the textbook two-sample estimator. The papers below use richer models with confidence intervals, so they support the idea, not this formula.
  - Systematic-review researchers have tested capture-recapture as a way to judge how close a literature search has come to the total. What the sources show [V for the abstracts and records only; the full texts were not read]:
    - Kastner M, Straus SE, McKibbon KA, Goldsmith CH. *J Clin Epidemiol* 2009;62(2):149-157, doi:10.1016/j.jclinepi.2008.06.001. On a review of osteoporosis decision-support tools, the model estimated 1,838 potential articles at the first screening level and 49 at full-text level. The four databases provided 68% of known articles at the first level and 81% at full text. The authors conclude that more studies are needed to determine its usefulness as a stopping rule. An earlier paper from the same group on the same kind of review (<https://pmc.ncbi.nlm.nih.gov/articles/PMC2655834>, *AMIA Annu Symp Proc* 2007) reports the 68% figure and says the method had not yet been tested on a review with two or more data sources.
    - Stelfox HT, Foster G, Niven D, Kirkpatrick AW, Goldsmith CH. *Am J Surg* 2013;206(3):439-440, doi:10.1016/j.amjsurg.2012.11.017. On a review of adult trauma-care quality indicators (40 included articles), the model suggested 3 articles were missed (95% CI 0 to 6), and the database search provided 93% of known articles (one-sided 95% CI at least 83%).
    - Neither abstract states a stopping threshold. Revision 1 gave "search until about 80% is captured" and tagged it [V]. That figure came from a search-tool summary of the surgery paper and was not read in a source, so it is removed. It may appear in the full text, which has not been read. The `core.ac.uk` link in revision 1 could not be opened and is dropped.
  - It has been validated only in small, retrospective studies.
  - It assumes the searchers are independent. Agents running similar queries are not independent, so it overestimates coverage. Use it as a signal, not a rule, and give the two searchers different strategies (D2). The coverage level at which this signal counts is an open design item.
- **Budget and checkpoint.** Each round has a hard budget, set by the owner when the question is framed (D1) as a cap on tokens, subagents or elapsed time. The value is an open design item. At each checkpoint, the skill reports what the round added (the marginal yield), and the owner confirms or overrides the proposed stop or continue.
- **How the signals combine.** Decision stability decides. The skill proposes stopping only when decision stability holds and the saturation and overlap signals do not show a recent surge of new sources. The budget is a hard cap: it ends a round whatever the other signals say, and the skill then reports the sub-questions still open. The owner's confirmation does not replace the rule. The skill has to bring a signal to the checkpoint, and with none it continues or says why it cannot.

### 6.5 Testing the research process [D]

The evidence in 6.2 does not show that this process beats the one in use today, so test it. Pick about five research questions whose good sources are already known, for example sub-questions that `docs/research` settled with cited sources. Write the list of key sources for each before any agent runs, and keep it out of the agents' reach. Run the proposed process and a plain single-agent search on each question, with the same stakes. Score each run on three things: how many of the listed key sources it found, how many of its claims a checker can trace to a source, and the tokens and time it used. The proposed process earns its extra cost only if it finds materially more of the listed sources at a cost the owner accepts. The same seeded-set and answer-key discipline as step 1 of section 7 applies.

## 7. Suggested order of work

Revision 2 moves the seeded set to the front, so a baseline exists before anything changes.

1. Build a small seeded set: one artifact per use case, with planted errors, omissions and misinterpretations. For UC2, include a plan with a planted misreading of the mission. A first version with one artifact is enough to start, for example a copy of this assessment with planted defects. The person who plants the defects is not the person who runs the review, and the answer key stays outside the repository. Run version 1 of the skill on the set and record the result. That sets the S1 target, since the mission says the target is set once a baseline has been measured.
2. Restructure version 1 into the engine plus profiles, add C1 to C5, and move today's lenses into `profiles/deliverable.md`.
3. Add the plan and spec profiles first. They are reading-only, they are the most valuable, and they match how `docs/plans` and `docs/research` already work. Then dogfood: review this assessment against `MISSION.md`.
4. Add the implementation profile, with blind acceptance tests run in a worktree.
5. Add the tests profile, with requirement-targeted mutants, then StrykerJS if it is compatible with Vitest 5.
6. Build the `deep-research` skill with its ledger and stopping rules, connect it to the research-depth lens of the plan profile, and run the comparison in section 6.5 before relying on it.
7. After each of steps 2 to 6, run the seeded set again and compare with the baseline.

## 8. Not done in this session

- Nothing in section 3 or later has been built or run. The `adversarial-review` skill (version 1) has not been run end to end yet.
- Not checked: StrykerJS compatibility with Vitest 5, the ISO/IEC/IEEE 29148 characteristics against the standard's text, and the full texts of the two capture-recapture papers in section 6.4 (only their abstracts and records were read).

## 9. Revision notes

**Revision 2 (2026-11-12).** Revision 1 is `ASSESSMENT-2026-11-12.md` and is kept unchanged. This revision applies items M1, M2 and S1 to S3 of the judge's ruling on revision 1. The review record (pack, five reviewer reports, ruling) is in `reviews/run-1/`.

| Ruling item | What changed |
|---|---|
| M1, citation | Section 6.4: the Kastner and Stelfox papers are cited with the details their abstracts give. The unsourced "about 80%" and the "surgery" attribution to Kastner are removed. The Lincoln–Petersen formula is marked as the document's own gloss. The full texts are listed as unread (section 8). |
| M2, baseline order | Section 7: the seeded set is now step 1, with a baseline run of version 1, and it is re-run after each later step (step 7). |
| S1, stopping rule | Section 6.4: confidence is a recorded low, medium or high rating per sub-question with a stated evidence rule. How the signals combine is stated and the budget owner is named. The remaining thresholds are marked as open design items. Section 1, Q4 updated. |
| S2, Q3 answer | Section 1, Q3 and section 6.2: the answer is "probably, at a higher cost, but not shown yet", and the evidence is stated with its scope and limits. New section 6.5 gives a test against the current approach, and section 7 step 6 refers to it. |
| S3, contradiction | Section 8: the stale clause about the 15-times figure is removed. |

**Not applied, left open:** S4 (no cost or proportion mechanism), S5 (mutation runs uncosted), S6 (the existing Plans and Code lens sets are not engaged), S7 (equivalent mutants), S8 (ledger location and write permission), the optional items O1 to O6, and the judge's own observation that the arrows in the section 2 diagram do not match the mission's definitions of UC2 and UC3.

**Changed because a fix required it:** the section 7 step numbers, the title and the status line.
