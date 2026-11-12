# Adversarial validation: first assessment

**Status:** proposal, not a decision. This document answers the open questions Q1 to Q4 in `MISSION.md`. It is the kind of document UC2 is meant to review: check it against the mission before acting on it.

**Evidence tags** (the repo's convention): **[V]** verified this session against a source named here; **[K]** standard knowledge, not re-verified this session; **[D]** derived in this document.

---

## 1. Short answers

- **Q1. Is one process right for every use case?** The core holds for all four: fresh reviewers, different angles, a judge that verifies, and the owner sees the ruling first. Version 1 does not work as-is, though. It is tuned for one question: "is this deliverable ready to send?" UC1 to UC4 are a different kind of check. Each compares an artifact against a reference, so each needs a second input, a way to find what is missing, and in two cases permission to run code. Sections 3 and 4 give the details.
- **Q2. Separate skills?** Use one skill as the engine, with a profile file per use case. Four separate skills would copy the same orchestration and isolation rules four times, and the copies would drift (section 5).
- **Q3. A better research process?** Yes. Parallel searchers that each have their own strategy, citation-following, a ledger on disk that carries the research across sessions, and an adversarial check of the final synthesis. This should be its own skill (section 6).
- **Q4. When should research stop?** The main rule is decision stability: stop when another round does not change the answer or the confidence in it. Two signals support it: the rate of new findings, and the overlap between independent searchers. A budget caps each round, and the owner decides at each checkpoint (section 6.4).

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
- **Anthropic's account of Claude's Research feature** [V, <https://www.anthropic.com/engineering/multi-agent-research-system>]:
  - A lead agent with parallel subagents outperformed a single agent by 90.2% on Anthropic's internal research evaluation.
  - Token usage alone explained 80% of the variance in performance.
  - The same post puts multi-agent systems at about 15 times the tokens of a chat.

  The lesson [D]: depth costs tokens, and parallel fresh contexts are how to spend them productively.

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

- **Decision stability (primary).** Stop when the last round changed neither the recommendation nor its confidence. Research serves a decision, so this is the value-of-information view of when to stop. [D]
- **Saturation.** Track the share of each round's findings that are new to the ledger. Two rounds in a row that add nothing that changes a conclusion is the signal. Qualitative research calls this theoretical saturation. [K]
- **Overlap between independent searchers (capture-recapture).** Two searchers work the same sub-question independently. If they find *n1* and *n2* relevant sources, *m* of them shared, the total is about *n1 × n2 / m* (Lincoln–Petersen). Coverage is then roughly what was found divided by that estimate. [K]
  - Systematic-review methodology has proposed this as a stopping rule for literature searches. A surgery review suggested, for example, searching until about 80% is captured. [V, Kastner et al. 2009, J Clin Epidemiol, <https://pmc.ncbi.nlm.nih.gov/articles/PMC2655834>; <https://core.ac.uk/works/100848577>]
  - It has been validated only in small, retrospective studies.
  - It assumes the searchers are independent. Agents running similar queries are not independent, so it overestimates coverage. Use it as a signal, not a rule, and give the two searchers different strategies (D2).
- **Budget and checkpoint.** Each round has a hard budget. At each checkpoint, the skill reports what the round added (the marginal yield), and the owner decides whether to continue.

## 7. Suggested order of work

1. Restructure version 1 into the engine plus profiles, add C1 to C5, and move today's lenses into `profiles/deliverable.md`.
2. Add the plan and spec profiles first. They are reading-only, they are the most valuable, and they match how `docs/plans` and `docs/research` already work. Then dogfood: review this assessment against `MISSION.md`.
3. Add the implementation profile, with blind acceptance tests run in a worktree.
4. Add the tests profile, with requirement-targeted mutants, then StrykerJS if it is compatible with Vitest 5.
5. Build the `deep-research` skill with its ledger and stopping rules, and connect it to the research-depth lens of the plan profile.
6. Build a small seeded set: one artifact per use case with planted errors, omissions and misinterpretations. Use it to measure S1 before and after each change.

## 8. Not done in this session

- Nothing in section 3 or later has been built or run. The `adversarial-review` skill (version 1) has not been run end to end yet.
- Not checked: StrykerJS compatibility with Vitest 5, the ISO/IEC/IEEE 29148 characteristics against the standard's text, and the 15-times token figure against the primary post (a secondary summary reports it).
