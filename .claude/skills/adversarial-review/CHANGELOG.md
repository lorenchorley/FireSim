# Changelog

Entries name the run report items they came from on an `Implements:` line. The feedback index reads those lines.

## Version 3, revision 3 (2026-11-12)

Source: the first assessment of run 3 (benchmark baseline) and a reading of `addyosmani/adverse` for lens design.

- `ar.py report`: the summary line reads "not recorded" instead of "not recorded tokens"; the `Effort set` column says "pinned in script" for workflow runs; the digest's `Full ruling:` line is rewritten to the published path `reviews/run-N/ruling.md`; the benchmark answer key (`benchmarks/.*answer-key`) is always a forbidden pattern in the audit.
- `ar.py index`: a feedback item is shown as `closed` when a `Closed:` line names it.
- `lenses-extended.md` (new file, kept apart from `lenses.md` so default reviewers never read it): experimental set "Plans, extended" with three lenses written after the scoring of run 3 (claims against the repo, measurement method, operations and security parity), each with an explicit out-of-scope line so they stay orthogonal. Not part of the default run. They are tested against the benchmark before they join the `plans` set.
- `SKILL.md`: note that on Windows the script runs as `python`, not `python3`.
- Closed: SF-AR003-2, SF-AR003-3 (decision: not needed; the workflow keeps reports out of the main session and the digest is about 1,000 tokens).

## Version 3, revision 2 (2026-11-12)

Source: the feedback lines of run report AR-003.

- The isolation audit counts a path as listed when it sits under a directory the pack names. Helper agents (a scorer) are counted apart from the run's own tokens.
- Optional step: score a run against a known answer key, with `scoring-prompt.md`. `ar.py report` reads the recall figures from `scoring.md` into the report.
- Guidance on when the orchestrator's context reading means anything.
- The audit's forbidden patterns match case-insensitively and are also checked against every tool result, and the judge is audited too. Wall time counts only the reviewers and the judge.
- Implements: SF-AR003-1, SF-AR003-4, SF-AR003-5, SF-AR003-6
- Left open: SF-AR003-2 (cap the length of a finding), SF-AR003-3 (group Optional items in the digest). Neither has evidence yet that it improves a run.

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
