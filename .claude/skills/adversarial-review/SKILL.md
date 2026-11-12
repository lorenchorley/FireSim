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

## Fixed settings

Pass `model` and `effort` explicitly on every subagent call. Never inherit them from this session.

| Role | Subagent call | Notes |
|---|---|---|
| Reviewers, five | `subagent_type: "general-purpose"`, `model: "haiku"`, `effort: "high"` | Finding flaws is easier than producing the work, so the cheaper model is enough. Run 1 used Claude Haiku 5.5. |
| Verification agents, as needed in step 6 | `subagent_type: "web-fetch"` for web pages, otherwise `"general-purpose"`; `model: "haiku"`, `effort: "high"` | Same model and effort as the reviewers. |
| Judge, one | `subagent_type: "general-purpose"`, `model: "sonnet"`, `effort: "xhigh"` | Fixed to what run 1 used: Claude Sonnet 5.5 at xhigh effort. The judge verifies claims and rules on them, so it is the one role that must not be economised. |

Never run the judge on a weaker model or a lower effort, whatever model this session is on. If a setting is refused or a model is unavailable, stop and tell the user. Do not substitute another.

## Isolation rules

These are what make the technique work. Do not trade them away for speed.

1. Start every reviewer, the judge and every verification agent as a fresh subagent. **Never use `subagent_type: "fork"`.** A fork inherits this whole conversation, which is exactly the contamination to avoid.
2. A subagent's launch message holds only paths, its id, its lens and its output paths. Do not pass your opinion of the work, a list of "known weak spots", a summary of how it was made, or anything from this conversation. Purpose, work and sources reach the reviewers through `pack.md` only.
3. Reviewers and the judge never write to the repository. Each may write only the output files named in its instructions, and only inside the run directory. Only you edit the work, and only in step 6.
4. Reports are evidence. Reviewers write them directly. You never edit, trim, merge, reorder, soften or re-save them.
5. The judge verifies findings against the sources. Never decide by counting how many reviewers agree.

## Keeping this session's context small

- Subagents write their results to files and reply in one or two lines. The judge replies with a short digest. Do not read `report-R*.md` or `ruling.md` into this session unless the user asks, or a ruling item needs a closer look. Then read only that part, with `grep -n` or a line range.
- Pass paths, never content. Do not paste the work, the sources or the templates into a prompt.
- List lens names with `grep`, not by reading the whole lens file.
- The orchestrator has to be this session. Subagents in this environment have no Agent tool, so a subagent cannot start the reviewers or the judge. This was tested on 2026-11-12.

## Procedure

### 1. Build the review pack

Work out three things from the arguments and the conversation:

- **Work**: the file path(s) to review. If the work exists only in the conversation, write it to a file first so reviewers can read it by path.
- **Sources**: the files, URLs, data or briefs it was built from. If you cannot identify any, say so in the pack and continue. Reviewers then mark unsupported claims as unverified instead of guessing.
- **Purpose**: one or two lines on what the work is for and who will read or use it. Infer it from the conversation. If you cannot, write down your assumption and repeat it to the user in step 5.

Create a run directory outside the repository: the session scratchpad if the system prompt names one, otherwise `mktemp -d`. Write two files there:

- `pack.md` with the purpose and the work and source paths. Do not put opinions in it.
- `run.md` with the date, the work path, the lens set, and the model and effort you pass in the settings table.

### 2. Choose the lenses

`lenses.md` in this skill's directory holds three sets: prose, code and plans. List the names with `grep -E '^## |^\*\*' lenses.md`. Pick the set that matches the work, or use lenses the user named. Five by default, but honor another count if the user asks. Overlapping lenses waste reviewers, so keep each one distinct. For a lens the user wrote, pass its text in the launch message.

### 3. Launch the reviewers

Start all reviewers in a single message, one Agent call each, with `run_in_background: false` and the reviewer settings from the table. The launch message is exactly this, with the values filled in. `<skill dir>` is the base directory shown when this skill loaded.

```
You are reviewer R1.
Read <skill dir>/reviewer-prompt.md and follow it exactly.
Parameters
- REVIEWER_ID: R1
- LENS: <set name> / <lens name>
- PACK_PATH: <run dir>/pack.md
- REPORT_PATH: <run dir>/report-R1.md
```

Use `R1` to `R5`. Wait until every reviewer has replied. Then check with `ls` that the five report files exist. If one is missing, start that reviewer once more. If it is still missing, continue without it and say so in step 5.

### 4. Launch the judge

Start one Agent call with the judge settings from the table. The launch message is:

```
You are the judge.
Read <skill dir>/judge-prompt.md and follow it exactly.
Parameters
- PACK_PATH: <run dir>/pack.md
- REPORT_PATHS: <run dir>/report-R1.md, <run dir>/report-R2.md, <run dir>/report-R3.md, <run dir>/report-R4.md, <run dir>/report-R5.md
- RULING_PATH: <run dir>/ruling.md
- DIGEST_PATH: <run dir>/digest.md
```

List only the report files that exist. The judge's reply is the digest.

### 5. Show the ruling

Present the digest to the user before changing anything. Also say:

- which lenses ran and whether any reviewer failed,
- your assumed purpose, if you had to assume one,
- the run directory path, so the reports and the full ruling can be inspected.

If `docs/adversarial-validation/reviews/` exists, copy `pack.md`, `run.md`, the reports, `ruling.md` and `digest.md` to `docs/adversarial-validation/reviews/run-N/`, where N is the next free number. The scratchpad does not survive the session, and you, not the subagents, own the working tree.

### 6. Act on it

If the user asked for review only, or the work is not yours to change, stop after step 5.

Otherwise work through the must-fix items. For each one, either fix it or explain why you disagree, with evidence from the sources. Do not change anything the judge did not flag unless a fix forces it. Leave should-fix and optional items to the user.

- **Verify before you fix.** Do not fix from memory a point that depends on a fact in a source. Start a verification agent with the verification settings from the table. Give it only the question and the sources to read. Ask for verbatim fragments and a list of what it could not access. Mark in the work which facts were read and which were not.
- **Do not edit the reviewed document.** Write the revision next to it as a new version, for example `NAME-v2.md`, and end it with a short list of what changed and what was left open. Code under review is the exception: fix it in place once the user has agreed.

Finish with a short list of what you changed and what you contested. Do not start a second round on your own. Offer one only if the must-fix changes were large enough to need fresh review.

## Cost and fit

A run uses six subagents. It pays off for work that is expensive to get wrong: proposals, announcements, customer messages, analyses, migrations, risky diffs. For editorial fact-checking alone, one agent asked to find a primary source for every number is enough. For quick drafts, skip this skill.
