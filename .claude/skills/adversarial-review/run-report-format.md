# Run report format

`scripts/ar.py report` writes one report per run. This file says what the names and fields are, so reports can be found and compared reliably.

## Names

| Thing | Format | Example |
|---|---|---|
| Run id | `AR-NNN`, three digits, counted over all runs | `AR-003` |
| Run directory | `docs/adversarial-validation/reviews/run-N/` (N is the run number without zeros) | `run-3` |
| Report file | `docs/adversarial-validation/reviews/reports/AR-NNN_YYYY-MM-DD_<lensset>_<work-slug>.md` | `AR-003_2026-11-12_plans_dotnet-option-b-prototype.md` |
| Skill feedback id | `SF-ARNNN-k` (k counts from 1 inside the report) | `SF-AR003-2` |
| Automatic flag id | `FLAG-ARNNN-k` | `FLAG-AR003-1` |

The file name matches `^AR-(\d{3})_(\d{4}-\d{2}-\d{2})_([a-z]+)_([a-z0-9-]+)\.md$`. The lens set is `prose`, `code`, `plans` or `mixed`. The slug is the work file's name without extension, lowercased, with anything but letters and digits turned into hyphens, cut at 40 characters.

Runs 1 and 2 happened before this format. Their reports were produced afterwards from the saved runs (`AR-001`, `AR-002`) and say so in the `Flags` section.

## Front matter

Flat `key: value` lines between two `---` lines, so `grep` finds them.

| Key | Meaning |
|---|---|
| `run_id`, `date`, `work`, `work_slug`, `lens_set`, `lenses` | what was reviewed and how |
| `purpose_source` | `given` by the user or `assumed` by the orchestrator |
| `orchestration` | `manual` (Agent calls) or `workflow` (the script) |
| `skill_version`, `skill_commit` | the skill version number and the last commit touching the skill directory, `+uncommitted` if the skill had changes not yet committed |
| `run_dir` | where the raw material is |
| `reviewers`, `reviewer_model`, `reviewer_effort`, `judge_model`, `judge_effort` | read from the agents' own records, not from what was asked |
| `findings_raised`, `reviewer_must_fix` | what the reviewers filed |
| `ledger_items`, `ledger_must_fix`, `ledger_should_fix`, `ledger_optional`, `ledger_rejected` | what the judge ruled |
| `overall_call` | the judge's call |
| `subagent_tokens`, `other_agent_tokens`, `wall_minutes`, `orchestrator_context_delta` | cost. `subagent_tokens` counts the reviewers and the judge. `other_agent_tokens` counts helper agents that match the run (a scorer, say). Tokens per agent are the size of its last turn's context plus output, about 8 % above the harness's own figure on workflow runs |
| `recall_strict_all`, `recall_strict_in_scope`, `recall_lenient_in_scope`, `recall_reviewer_level_in_scope` | only when the run was scored against an answer key (`scoring.md`): matched over total, as `n/m` |
| `isolation` | `clean`, `flags:N`, or `not audited` |
| `write_refusals`, `retries`, `parse_warnings` | how the run went |

## Sections

1. `Summary`: the numbers in words, one line each.
2. `Settings observed`: one row per agent: model, effort set, effort observed, tokens, minutes, tool calls, writes refused.
3. `Yield`: per reviewer, findings raised, severity at the source, how many the judge ruled valid, partly valid and rejected, how many only that reviewer raised, and the report's size.
4. `Isolation audit`: per reviewer, flags and the paths read outside the run directory and the skill, with those the pack does not name.
5. `Flags (automatic)`: refused writes, retries, missing reports, reports over the cap, ledger problems, isolation flags, severity deflation.
6. `Scoring against an answer key`, only when `scoring.md` exists: the scorer's counts.
7. `Skill feedback`: lines added by the orchestrator, one per item:
   `- SF-ARNNN-k | area: <reviewer-prompt|judge-prompt|skill|lenses|scripts|harness> | observation: ... | proposal: ... | evidence: ...`
8. `Judge digest (verbatim)`: so the findings themselves are searchable from the report.

## Inputs the script reads

- `run.md` in `key: value` lines (see SKILL.md step 1), `pack.md`, `report-R*.md`, `ruling.md`, `digest.md`.
- Reviewer reports in the layout of `reviewer-prompt.md`. Older layouts are read on a best-effort basis.
- The judge's ledger as the table in `judge-prompt.md` (`## D. Ledger`). The older free-form ledger is read on a best-effort basis.
- The subagent transcripts, found by the run directory in each agent's launch message. If they are missing the report says so and leaves those fields `unknown`.

## Generated indexes

`reviews/INDEX.md` has one row per report. `reviews/SKILL-FEEDBACK.md` has one row per `SF-` line, `applied` when `CHANGELOG.md` names it on an `Implements:` line, otherwise `open`. Both are rebuilt by `ar.py index` and are never edited by hand.
