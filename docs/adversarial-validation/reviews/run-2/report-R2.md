R2 done. Report not written to REPORT_PATH: the Write call was refused with "Subagents should return findings as text, not write report files", so the full report is below instead. Findings: 7 (must-fix 0). Verdict: Fix first.

# R2. Lens: plans / Missing requirements

Work reviewed: /home/user/FireSim/docs/adversarial-validation/ASSESSMENT-2026-11-12-v2.md (revision 2)
Checked against: /home/user/FireSim/docs/adversarial-validation/MISSION.md (sections 1 to 9), /home/user/FireSim/docs/adversarial-validation/README.md, /home/user/FireSim/.claude/skills/adversarial-review/SKILL.md

Lens text: find requirements, stakeholders and constraints that the plan does not address or quietly assumes away.

## Findings

### R2.1
- Where: v2 section 5, "Each profile states the same five things" (lines 113 to 119; no cost item). Section 7, build order (lines 194 to 202; no cost step). Section 8, "Not done in this session" (lines 204 to 207; no cost item). Revision notes, line 221: "Not applied, left open: S4 (no cost or proportion mechanism)".
- Problem: The mission's cost requirements are not designed into the plan and are not listed among the things the plan leaves undone.
- Evidence: MISSION section 1: "Its cost must match the stakes of the work." MISSION P6: "Effort scales with the stakes." MISSION S6: "Each run reports what it cost: agents started and tokens used, where measurable." v2 mentions cost only in Q3 (line 13), section 6.2 (lines 141 to 145) and the section 6.5 comparison (line 190). None is a cost-tiering or cost-reporting rule for the review engine or its profiles. The revision notes record the gap, but section 8 does not, so a reader of section 8 would not see it.
- Severity: should-fix. Confidence: high.

### R2.2
- Where: v2 chain diagram, lines 22 to 25, where "UC2 does the plan answer the mission, and was it researched?" sits on the spec-to-plan arrow. Line 34: "Each use case checks one link: an artifact against the reference above it."
- Problem: The diagram and its sentence place UC2's reference at the spec, while the label and the mission place it at the mission statement, so the document contradicts itself on what UC2 checks.
- Evidence: MISSION section 4: "UC2. Plan against mission. Review a plan against the original mission statement." MISSION defines UC3 as checking "an implementation against its specification", but the diagram puts the plan above the implementation. v2 section 4, UC2 lens: "Interpretation fidelity: does the plan solve the problem the mission states?" uses the mission as reference, which agrees with MISSION and disagrees with the diagram. v2 never records that it redefines UC2 and UC3 in the chain, and MISSION section 9 requires a dated note for any change to the mission's definitions. MISSION S4 requires reference ambiguities to be raised for the owner and "never resolved silently". The judge's ruling on revision 1 also noted this mismatch, as optional.
- Severity: should-fix. Confidence: high.

### R2.3
- Where: v2 section 6.3, D4, "Ledger on disk" (lines 162 to 168). Its four fields (lines 163 to 166) are: claims with source and tag, sources seen, open sub-questions, a report per round. Revision notes, line 221: "S8 (ledger location and write permission)" listed as left open.
- Problem: The mission's continuation requirement has no stated home for the ledger, and the ledger has no field for sources that could not be read, although the work itself ran into such sources.
- Evidence: MISSION R3: research "can continue over several sessions." Line 168 says "The ledger makes research resumable across sessions," but names no location. A scratchpad, which the environment describes as session-specific, would not persist. MISSION K2 forbids reviewers and judges from writing to the main tree, and v2 does not say where a research skill may write. The work itself shows the gap: line 180 is tagged "[V] for the abstracts and records only; the full texts were not read", and line 182 says a link "could not be opened and is dropped". Neither state exists in D4's fields or in the tag scheme of line 5.
- Severity: should-fix. Confidence: high.

### R2.4
- Where: v2 section 6.4, lines 176 to 186. Line 176: "The rating scale and the two-source rule are starting values to calibrate." Line 177: "The cutoff ... is an open design item." Line 184: "The coverage level at which this signal counts is an open design item." Line 185: "The value is an open design item."
- Problem: The stopping rule the mission asks for is not yet a stated rule a run can apply, because the numbers that make it operational are all open.
- Evidence: MISSION S5: "the research stops under a stated rule." MISSION R3: stops "by a stated rule rather than when the agent feels done." The primary rule (line 176) depends on a confidence scale whose values are "starting values"; the saturation cutoff (line 177), the overlap level (line 184) and the budget value (line 185) are open. The work discloses these gaps, so this is a requirement not yet met, not a hidden defect.
- Severity: should-fix. Confidence: medium.

### R2.5
- Where: v2 section 7, step 1 (line 194 cites mission S1, "the target is set once a baseline has been measured") and section 5, C6 (line 43, cites K2). Status line 3 does not mention that mission sections 6 and 7 are unconfirmed.
- Problem: The plan treats the mission's success criteria and constraints as confirmed requirements, although the mission marks them as proposed.
- Evidence: MISSION status line 3: "Sections 6 and 7 are formulations proposed for the owner to confirm, and are marked (proposed)." MISSION section 6 is headed "What success looks like *(proposed)*" and section 7 "Constraints *(proposed)*". The owner could approve the plan without knowing its success criteria are still proposals.
- Severity: should-fix. Confidence: medium.

### R2.6
- Where: v2 section 7, step 1 (line 196): "The person who plants the defects is not the person who runs the review, and the answer key stays outside the repository."
- Problem: The step that gates the S1 baseline names no one to plant the defects and no location for the answer key.
- Evidence: Step 1 is the first step and must precede the others (line 194 and the ruling's M2 fix). Its text states two requirements, planter independence and a key outside the repository, but assigns neither. Section 8 (lines 204 to 207) does not list the seeded set as not yet done.
- Severity: should-fix. Confidence: medium.

### R2.7
- Where: v2 line 121: "The invocation would look like `/adversarial-review plan docs/plans/x.md --against docs/adversarial-validation/MISSION.md`." Compare SKILL.md argument-hint: "[path to the work] [review-only] [lenses: a, b, c, d, e]".
- Problem: The plan changes the skill's argument form and does not say whether the existing invocation still works for UC0.
- Evidence: The existing skill is committed (commit 6ec7e70, per MISSION). Section 5 lists the profile layout but says nothing about compatibility or the review-only and lens arguments.
- Severity: nitpick. Confidence: low.

## Checked and found correct
- MISSION Q1 to Q4 each get an answer (v2 lines 11 to 14).
- UC0 is covered by the deliverable profile (line 106). UC1 to UC4 each have a section (lines 48 to 91).
- K2 is handled: C6 (line 43) restricts runs to a worktree and never the main tree.
- P1 is applied through C2 (line 39), where the orchestrator does not write the inventory.
- S3 (finding what is missing) is addressed by blind derivation, C3 (line 40).
- S4 is partly addressed by C5, the "Needs owner decision" ruling (line 42). The gap in R2.2 is a separate case.
- S2 (must-fix findings cite checkable evidence) is supported by the evidence tags (line 5) and the reviewer report format in reviewer-prompt.md.
- The revision follows the README convention (new file, status line, last section lists changes and open items).
- P5 (owner sees the ruling before anything changes) is kept: the skill's step 5 shows the digest before step 6 edits.

## Could not check
- Factual claims and citations (Kastner, Stelfox, Anthropic figures). These belong to the facts lens.
- Whether the Agent tool's worktree isolation works as C6 assumes. This is a feasibility question.
- Whether the owner has confirmed mission sections 6 and 7. The repository holds no record, so R2.5 rests on the mission's own status line.
- The contents of the seeded set and the answer key. Neither exists in the repository yet.

Send as is / Fix first / Do not send: Fix first
