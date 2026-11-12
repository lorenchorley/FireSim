---
name: adversarial-review
description: Check finished work (a draft, proposal, analysis, plan, diff) with five fresh reviewer subagents that each try to prove it wrong through a different lens, then a sixth judge subagent that rules on their findings. Use only when the user explicitly asks for an adversarial review, red-team pass, stress test, or a check "with fresh eyes" before sending or shipping something.
argument-hint: "[path to the work] [review-only] [lenses: a, b, c, d, e]"
---

# Adversarial review

One session writes the work. Five fresh sessions try to prove it wrong, each through a different lens. A sixth fresh session decides which of their objections hold up. The original session then fixes what is valid or argues back with evidence.

The method rests on one rule: **the session that produced the work must not judge it.** It still holds every decision that went into the draft and weighs them as evidence. Fresh sessions see only the finished work and its sources, the way the eventual reader will.

You are the orchestrator, and usually the author as well. You do not review the work yourself.

User arguments: $ARGUMENTS

## Isolation rules

These are what make the technique work. Do not trade them away for speed.

1. Start every reviewer and the judge as a fresh subagent: `subagent_type: "general-purpose"` or omitted. **Never use `"fork"`.** A fork inherits this whole conversation, which is exactly the contamination to avoid.
2. A subagent gets only its prompt: the review pack paths, the purpose, and its lens. Do not pass your opinion of the work, a list of "known weak spots", a summary of how it was made, or anything from this conversation beyond the purpose line.
3. Reviewers and the judge are read-only. Their prompts say so. Only you edit the work, and only in step 6.
4. Reports are evidence. Save them verbatim. Do not trim, merge, reorder or soften them before the judge reads them.
5. The judge verifies findings against the sources. Never decide by counting how many reviewers agree.

## Procedure

### 1. Build the review pack

Work out three things from the arguments and the conversation:

- **Work**: the file path(s) to review. If the work exists only in the conversation, write it to a file first so reviewers can read it by path.
- **Sources**: the files, URLs, data or briefs it was built from. If you cannot identify any, say so in the pack and continue. Reviewers then mark unsupported claims as unverified instead of guessing.
- **Purpose**: one or two lines on what the work is for and who will read or use it. Infer it from the conversation. If you cannot, write down your assumption and repeat it to the user in step 5.

Create a run directory outside the repository: the session scratchpad if the system prompt names one, otherwise `mktemp -d`. Write `pack.md` there with the purpose and the work and source paths. Do not put opinions in it.

### 2. Choose the lenses

Read `lenses.md` in this skill's directory. Pick the set that matches the work (prose, code or plans), or use lenses the user named. Five by default, but honor another count if the user asks. Overlapping lenses waste reviewers, so keep each one distinct.

### 3. Launch the reviewers

Read `reviewer-prompt.md` in this skill's directory. Fill its slots for each lens: `{REVIEWER_ID}` (`R1` to `R5`), `{LENS_NAME}`, `{LENS_TEXT}`, `{PACK_PATH}`, `{WORK}`, `{SOURCES}`, `{PURPOSE}`.

Start all reviewers in a single message so they run in parallel. Finding flaws is easier than producing the work, so a model one tier below yours is usually enough: set `model` accordingly when a cheaper tier exists, or follow the user's choice. Wait until every reviewer has reported before moving on.

Save each report as `report-R1.md` through `report-R5.md` in the run directory, unedited. If a reviewer failed or returned nothing, retry it once. If it still fails, continue without it and say so in step 5.

### 4. Launch the judge

Read `judge-prompt.md` in this skill's directory. Fill `{PACK_PATH}`, `{WORK}`, `{SOURCES}`, `{PURPOSE}` and `{REPORT_PATHS}`. Start one fresh subagent with it, on your own model with no override, since the judge has to verify claims. Save its answer as `ruling.md`.

### 5. Show the ruling

Present the judge's ruling to the user before changing anything: the must-fix list, the should-fix list, and the rejected findings with their reasons. Also say:

- which lenses ran and whether any reviewer failed,
- your assumed purpose, if you had to assume one,
- the run directory path, so the reports can be inspected.

### 6. Act on it

If the user asked for review only, or the work is not yours to change, stop after step 5.

Otherwise work through the must-fix items. For each one, either fix it or explain why you disagree, with evidence from the sources. Do not change anything the judge did not flag unless a fix forces it. Leave should-fix and optional items to the user. Finish with a short list of what you changed and what you contested.

Do not start a second round on your own. Offer one only if the must-fix changes were large enough to need fresh review.

## Cost and fit

A run uses six subagents. It pays off for work that is expensive to get wrong: proposals, announcements, customer messages, analyses, migrations, risky diffs. For editorial fact-checking alone, one agent asked to find a primary source for every number is enough. For quick drafts, skip this skill.
