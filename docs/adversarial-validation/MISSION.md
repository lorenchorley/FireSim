# Adversarial validation: mission statement

**Status:** mission of record, revision 1 (2026-11-12). Written from the conversation that produced the `adversarial-review` skill (`.claude/skills/adversarial-review/`, commit `6ec7e70`). Sections 1 to 5 restate what the owner said. Sections 6 and 7 are formulations proposed for the owner to confirm, and are marked *(proposed)*.

**How to use it:** this is the reference for every later change to the validation process. A plan for changing the process is reviewed against this document, which is use case UC2 applied to the process itself. Change this document on purpose, with a dated note in section 9. Never edit it to fit a plan.

---

## 1. Mission

Give the owner a repeatable, agent-run way to find out whether a piece of work can be relied on, before relying on it.

The process must surface the defects, omissions and misreadings that the author missed. It must back every finding with evidence that someone else can check, and keep what is wrong apart from what is only arguable. Its cost must match the stakes of the work.

## 2. Origin

The method comes from Felix Rieseberg (engineering lead for Claude.ai, Cowork and Claude Code Desktop at Anthropic), interviewed on the Silicon Valley Girl channel in October 2026 (<https://youtu.be/D-SVFneJ_Nk>). This account comes from written summaries of the interview, not from the video itself.

- He rarely lets the session that produced the work judge it: "I rarely want the current session to judge itself." He calls self-judgment "still really iffy".
- He sends the work to several fresh sessions told to find what is wrong. For a blog post, he had Claude "fire off five threads".
- A separate session acts as judge and decides which criticisms are valid.
- Valid findings go back to the original session, which decides whether to act on them.
- Reviewers can use a model one step below the author's, because finding flaws is easier than producing the work.
- For plain fact-checking, one agent is enough ("find primary sources for every number I mentioned").

## 3. Principles

- **P1. Independence.** The producer of a piece of work does not judge it. Reviewers start from a fresh context that holds the work and its sources, never the author's reasoning.
- **P2. Adversarial angles.** Several independent reviewers try to prove the work wrong, each from a different angle.
- **P3. Verified rulings.** A separate judge checks each finding against the evidence and rules on it. Reviewers agreeing with each other proves nothing.
- **P4. Author's answer.** Valid findings go back to the author, who fixes them or argues back with evidence.
- **P5. Owner first.** The owner sees the ruling before anything changes.
- **P6. Proportion.** Effort scales with the stakes. A single checker is enough for simple fact-checking.

## 4. Use cases

- **UC0. Deliverable check.** Decide whether a finished deliverable is ready to send. This is the original scenario, and version 1 of the skill covers it.
- **UC1. Test adequacy.** Given an existing set of tests that pass, determine whether they test what needs to be tested.
- **UC2. Plan against mission.** Review a plan against the original mission statement. Determine whether the plan was researched enough and structured well, and whether the mission statement was interpreted correctly.
- **UC3. Implementation against spec.** Check an implementation against its specification.
- **UC4. Spec quality.** Check that a spec is well written, coherent and consistent, and that it answers the original requirements where they were recorded. Also check whether everything that needs to be considered has been.

## 5. Research

- **R1.** Much of the owner's work is research-based. Several of the use cases judge research directly: "sufficiently well researched" in UC2, and "everything has been considered" in UC4.
- **R2.** The problem: agent research today is fast and shallow, and takes only the first results. Researching a topic by hand, the owner can spend hours or days and still find new and interesting results, with diminishing returns. Knowing when to stop is the hard part.
- **R3.** The need: a research process that reaches past the first results, can continue over several sessions, and stops by a stated rule rather than when the agent feels done.

## 6. What success looks like *(proposed)*

- **S1.** On artifacts with planted defects (errors, omissions and misinterpretations), the process catches most must-fix defects. The target rate is set once a baseline has been measured.
- **S2.** Every must-fix finding cites evidence in the work or in its reference, and someone else can check it.
- **S3.** The process finds what is missing, not only what is wrong in what is present.
- **S4.** Ambiguities in the reference (mission, requirements, spec) are raised as questions for the owner. They are never resolved silently.
- **S5.** Each research round reports what it added, and the research stops under a stated rule.
- **S6.** Each run reports what it cost: agents started and tokens used, where measurable.

## 7. Constraints *(proposed)*

- **K1.** The process runs in Claude Code with subagents, and its skills live in this repository under `.claude/skills/`.
- **K2.** Reviewers and judges never write to the main working tree. Anything they need to run, they run in an isolated copy.
- **K3.** The work under review does not change until the owner has seen the ruling (P5).

## 8. Open questions

The owner asked these on 2026-11-12. The first answers are in `ASSESSMENT-2026-11-12.md`. They are proposals, not decisions.

- **Q1.** Is one process appropriate for all the use cases, or do some need specific customisation?
- **Q2.** Should there be skills specific to some or all of the use cases?
- **Q3.** Is there an agent research process that is more efficient, or gives better results, than the current one?
- **Q4.** How should research decide when to stop?

## 9. Revision notes

- **Revision 1 (2026-11-12):** first version.
