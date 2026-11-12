# Changelog

Entries name the run report items they came from on an `Implements:` line. The feedback index reads those lines.

## Version 3 (2026-11-12)

Source: the review of another session's red-team process (`docs/adversarial-validation/REVIEW-OF-REDTEAM-SESSION-2026-11-12.md`, items 1, 2, 3, 4 and 6) and the run 2 findings.

- Reviewer format: at most eight findings, most damaging first, "nothing found" allowed; each finding has an `Already covered?` field that cites the section; the layout is fixed so a script can read it; reviewers read only the pack's files. If a reviewer's write is refused, it replies with the full report and does not look for another way to save it.
- Judge: new verdict `Partly valid` with the narrower claim that holds; compound items are split and each reviewer's suggested change is kept; claims a command can settle are checked by running it; the ledger is a fixed table.
- Run report: every run ends with `scripts/ar.py report` and `publish`. Names follow `AR-NNN_YYYY-MM-DD_<lensset>_<work-slug>.md`. The report holds the settings the agents actually ran with, yield per reviewer, severity at the source against the ruling, tokens and minutes, an isolation audit from the transcripts, automatic flags, and a `Skill feedback` section.
- `ar.py extract` saves reviewers' final messages when the harness refuses their writes. `ar.py index` builds `INDEX.md` and `SKILL-FEEDBACK.md`.
- Pack: carries an access boundary line. `run.md` is `key: value` lines.
- Workflow variant (`workflow/adversarial-review.workflow.js`): reviewers and judge run from one script, return their text as structured output, and `ar.py` saves it from the agents' records. Reviewer output does not enter the main session. The harness gives each workflow agent the user's request verbatim, which the report flags.
- Step 6: a verification agent that contradicts an expected source is checked by a second look before acting.
- Implements: none yet (no run report existed before this version).

## Version 2 (commit bc8857c)

Fixed model and effort settings (reviewers and verification agents on Haiku at high, judge on Sonnet at xhigh), reviewers and the judge write files and reply in one line, never fork.

## Version 1 (commit 6ec7e70)

First version: five lenses, a judge, three lens sets.
