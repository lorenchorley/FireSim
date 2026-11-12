---
name: adversarial-review
description: Check finished work (a draft, proposal, analysis, plan, diff) with five fresh reviewer subagents that each try to prove it wrong through a different lens, then a sixth judge subagent that rules on their findings. Every run writes a standard run report. Use only when the user explicitly asks for an adversarial review, red-team pass, stress test, or a check "with fresh eyes" before sending or shipping something.
argument-hint: "[path to the work] [review-only] [lenses: a, b, c, d, e] [workflow]"
---

# Adversarial review

One session writes the work. Five fresh sessions try to prove it wrong, each through a different lens. A sixth fresh session decides which of their objections hold up. The original session then fixes what is valid or argues back with evidence.

The method rests on one rule: **the session that produced the work must not judge it.** It still holds every decision that went into the draft and weighs them as evidence. Fresh sessions see only the finished work and its sources, the way the eventual reader will.

You are the orchestrator, and usually the author as well. You do not review the work yourself.

Skill version: 3 (see `CHANGELOG.md`)

User arguments: $ARGUMENTS

## Fixed settings

Pass `model` and `effort` explicitly on every subagent call. Never inherit them from this session.

| Role | Subagent call | Notes |
|---|---|---|
| Reviewers, five | `subagent_type: "general-purpose"`, `model: "haiku"`, `effort: "high"` | Finding flaws is easier than producing the work, so the cheaper model is enough. Run 1 used Claude Haiku 5.5. |
| Verification agents, as needed in step 6 | `subagent_type: "web-fetch"` for web pages, otherwise `"general-purpose"`; `model: "haiku"`, `effort: "high"` | Same model and effort as the reviewers. |
| Judge, one | `subagent_type: "general-purpose"`, `model: "sonnet"`, `effort: "xhigh"` | Fixed to what run 1 used: Claude Sonnet 5.5 at xhigh effort. The judge verifies claims and rules on them, so it is the one role that must not be economised. |

Never run the judge on a weaker model or a lower effort, whatever model this session is on. If a setting is refused or a model is unavailable, stop and tell the user. Do not substitute another. The run report records the model and effort each agent actually ran with, read from its transcript.

## Isolation rules

These are what make the technique work. Do not trade them away for speed.

1. Start every reviewer, the judge and every verification agent as a fresh subagent. **Never use `subagent_type: "fork"`.** A fork inherits this whole conversation, which is exactly the contamination to avoid.
2. A subagent's launch message holds only paths, its id, its lens and its output paths. Do not pass your opinion of the work, a list of "known weak spots", a summary of how it was made, or anything from this conversation. Purpose, work and sources reach the reviewers through `pack.md` only.
3. Reviewers and the judge never write to the repository. Each may write only the output files named in its instructions, and only inside the run directory. Only you edit the work, and only in step 6.
4. Reports are evidence. They are saved exactly as the reviewers produced them: by the reviewer, or, if the harness refuses the reviewer's write, from the reviewer's final message with `ar.py extract` (step 3). You never edit, trim, merge, reorder, soften or re-save them by hand.
5. The judge verifies findings against the sources. Never decide by counting how many reviewers agree.
6. Isolation is checked after the run, not trusted. The run report's isolation audit reads every reviewer's tool calls and flags any that touched another reviewer's report, a ruling the pack does not list, or git history when the pack forbids it.

## Keeping this session's context small

- Reviewers are asked for compact reports (at most eight findings) and a one-line reply. The judge replies with a short digest. Do not read `report-R*.md` or `ruling.md` into this session unless the user asks or a ruling item needs a closer look. Then read only that part, with `grep -n` or a line range.
- The script `scripts/ar.py` reads the reports, the ruling and the transcripts for you and prints a four-line summary. Use it instead of reading files.
- Pass paths, never content. Do not paste the work, the sources or the templates into a prompt.
- List lens names with `grep -E '^## |^\*\*' lenses.md`.
- The orchestrator has to be this session. Subagents in this environment have no Agent tool, so a subagent cannot start the reviewers or the judge. This was tested on 2026-11-12. The workflow variant at the end moves the fan-out into a script, which keeps reviewer output out of this session entirely.

## Run identity and naming

Every run has an id, `AR-NNN`, a three-digit number counted across all runs. It names:

- the raw material, in `docs/adversarial-validation/reviews/run-N/` (pack, run record, reports, ruling, digest);
- the run report, in `docs/adversarial-validation/reviews/reports/`, named `AR-NNN_YYYY-MM-DD_<lensset>_<work-slug>.md`, for example `AR-003_2026-11-12_plans_dotnet-option-b-prototype.md`.

`scripts/ar.py` picks the number, builds the name and writes the report. The full format, the front matter keys and how to search them are in `run-report-format.md`.

## Procedure

### 1. Build the review pack

Work out three things from the arguments and the conversation:

- **Work**: the file path(s) to review. If the work exists only in the conversation, write it to a file first so reviewers can read it by path.
- **Sources**: the files, URLs, data or briefs it was built from. If you cannot identify any, say so in the pack and continue. Reviewers then mark unsupported claims as unverified instead of guessing.
- **Purpose**: one or two lines on what the work is for and who will read or use it. Infer it from the conversation. If you cannot, write down your assumption and repeat it to the user in step 5.

Create a run directory outside the repository: the session scratchpad if the system prompt names one, otherwise `mktemp -d`. Write two files there:

- `pack.md` with the purpose and the work and source paths, and this line: "Access boundary: review only the files listed here. Do not read other reviewers' output, other review runs, or git history unless they are listed above." Add the line "Do not use git." when the work sits in a repository that holds material the reviewers must not see. Do not put opinions in the pack.
- `run.md`, in `key: value` lines that the report script reads: `date`, `work`, `lens_set` (prose, code, plans, or mixed), `lenses` (comma list), `purpose_source` (given or assumed), `orchestration` (manual or workflow), and `settings` (the model and effort you pass).

Before launching, read the primary session's `context_usage.used_tokens` from `get_session` (omit the session id) and note it. You will read it again after step 5.

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

Use `R1` to `R5`. Wait until every reviewer has replied. Then run:

```
python3 -I <skill dir>/scripts/ar.py extract --run-dir <run dir>
```

It leaves report files that reviewers wrote alone. For a reviewer whose write was refused, it saves that reviewer's final message verbatim as `report-Rn.md`. It prints one line per reviewer. If a reviewer has no report, start that reviewer once more. If it is still missing, continue without it and say so in step 5.

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

### 5. Report, publish and show the ruling

Build the run report. This step is not optional, and it takes no judgement:

```
python3 -I <skill dir>/scripts/ar.py report --run-dir <run dir> --context-delta <tokens now minus tokens before> [--forbid <regex> ...]
```

`--forbid` takes a regular expression for anything the reviewers must not touch, for example the path of an answer key. Pass `--context-delta` only if nothing else happened in this session between launch and completion. If other work fell in that window, leave it out and give an estimate of what the run itself put into this session with `--note`. The script finds the agents' transcripts by the run directory in their launch messages, so run it in the session that launched them. It writes `RUN-REPORT.draft.md` in the run directory and prints a short summary.

Open the draft's `Skill feedback` section only if the run showed something about the skill itself: a rule that was missing, a prompt that misled an agent, a script that failed, a harness refusal. Add one line per item in the exact form shown there. The `Flags (automatic)` section already records the mechanical ones.

Then publish:

```
python3 -I <skill dir>/scripts/ar.py publish --run-dir <run dir>
```

This copies the run to `docs/adversarial-validation/reviews/run-N/`, writes the report to `reviews/reports/`, and rebuilds `reviews/INDEX.md` and `reviews/SKILL-FEEDBACK.md`. If that directory does not exist, skip it and leave the draft in the run directory. The scratchpad does not survive the session, so tell the user where the draft is.

Present the digest to the user before changing anything. Also say:

- which lenses ran and whether any reviewer failed,
- your assumed purpose, if you had to assume one,
- the run id and the report's file name,
- the audit result and any automatic flags.

### Optional: score the run against a known answer key

Use this only when the work's defects are known independently of the run (a benchmark, a work whose flaws were established by other means). Keep the key outside the run directory and pass its path with `--forbid` in the report step, so the audit shows whether any reviewer touched it. After step 4, start a scorer with the judge's settings (`model: "sonnet"`, `effort: "xhigh"`, since scoring is a judgement), with the launch message "You are the scorer. Read `<skill dir>/scoring-prompt.md` and follow it exactly." and the parameters `KEY_PATH`, `RUN_DIR`, `SNAPSHOT_DIR` (the folder the reviewers could read) and `OUT_PATH` (`<run dir>/scoring.md`). Do this before step 5, so `ar.py report` reads the recall figures into the report. For a figure you will use as a baseline, run a second independent scorer first, with the first scoring moved out of its reach, and report where the two disagree. Scoring is one agent's judgement, not a measurement.

### 6. Act on it

If the user asked for review only, or the work is not yours to change, stop after step 5.

Otherwise work through the must-fix items. For each one, either fix it or explain why you disagree, with evidence from the sources. Do not change anything the judge did not flag unless a fix forces it. Leave should-fix and optional items to the user.

- **Verify before you fix.** Do not fix from memory a point that depends on a fact in a source. Start a verification agent with the verification settings from the table. Give it only the question and the sources to read. Ask for verbatim fragments and a list of what it could not access. Mark in the work which facts were read and which were not. If a verification agent contradicts a source you expect to be right, open the source yourself or ask a second agent before you act. A checker can be wrong.
- **Do not edit the reviewed document.** Write the revision next to it as a new version, for example `NAME-v2.md`, and end it with a short list of what changed and what was left open. Code under review is the exception: fix it in place once the user has agreed.

Finish with a short list of what you changed and what you contested. Do not start a second round on your own. Offer one only if the must-fix changes were large enough to need fresh review.

## Workflow variant

When the user asks for a workflow (or says "use a workflow"), steps 3 and 4 run from one script, `workflow/adversarial-review.workflow.js`. Do not use it unless the user asked: the Workflow tool needs their opt-in.

- Step 1 and 2 are unchanged. Build `pack.md` and `run.md`, set `orchestration: workflow` in `run.md`, and note the context reading.
- Call the Workflow tool with `scriptPath` set to the script and `args` set to `{"skillDir": "<skill dir>", "runDir": "<run dir>", "lenses": ["<set> / <lens>", ...]}`. The script pins the same models and efforts as the settings table, so keep the two in step.
- The reviewers return their reports as structured output, and the judge gets them inline. Nothing but a few lines (counts, verdicts and the digest) comes back to this session.
- Then run step 5. `ar.py report` saves the reports, the ruling and the digest from the agents' own records first (`ar.py extract` does the same on its own), so the run directory ends up identical to a manual run.
- Pass the workflow's transcript directory to `ar.py` with `--transcripts <dir>` if the script cannot find the agents' records by itself.
- **Isolation caveat.** The harness gives every workflow agent the user's triggering request verbatim, before the task text. Rule 2 is therefore not fully in your hands in this variant. The report records it as a flag. Check that the request says nothing about the work under review, and if it does, run the manual path instead.
- The Workflow variant keeps reviewer output out of this session. The manual path does not: reviewers' final messages arrive here as text. In run 2 that cost about 39,600 tokens of this session's context.

## Improving the skill from past runs

- Find runs: `grep -l 'lens_set: plans' docs/adversarial-validation/reviews/reports/*.md`, or open `reviews/INDEX.md`.
- Find proposals: `reviews/SKILL-FEEDBACK.md` lists every `SF-` line from every report, open or applied.
- When you change the skill because of one, add a line `Implements: SF-AR002-1, ...` to `CHANGELOG.md`, and raise the version number above. The next index rebuild marks those items applied. Committed reports are never edited.

## Cost and fit

A run uses six subagents. It pays off for work that is expensive to get wrong: proposals, announcements, customer messages, analyses, migrations, risky diffs. For editorial fact-checking alone, one agent asked to find a primary source for every number is enough. For quick drafts, skip this skill.
