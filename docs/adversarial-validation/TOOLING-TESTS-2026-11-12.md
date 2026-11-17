# Tooling tests for skill version 3 (revision 1)

Date: 2026-11-12. These are tests of the run report script, the isolation audit, `SendMessage` and the workflow variant, done before run 3. Evidence tags: **[V]** measured here, **[D]** derived.

## 1. The run report script on real data

`scripts/ar.py report` was run on the saved runs 1 and 2, whose reports and rulings are in the older layouts. The first pass found four problems, all in the script, all fixed:

| Problem | Cause | Fix |
|---|---|---|
| Rejected items were missing from the ledger | The older ledger's first column is `#`, and the parser looked for a column named id | The id is always the first column |
| One reviewer's severities were all zero | Its report wrote `[should-fix, high]` in brackets | The bracket form is read too |
| The judge showed two "writes refused" | The counter matched the phrase inside report files the judge had only read | Only refused Write and Edit calls count |
| A reviewer was flagged for "git history" | The pattern matched `git worktree list` and `git status` | Git use is flagged only when the pack says not to use git |

After the fixes the script reproduces the judge's own tallies **[V]**: run 1, 20 items (2 must fix, 8 should fix, 6 optional, 4 rejected) and 549,510 subagent tokens; run 2, 31 items (0, 12, 14, 5) and 699,972 tokens. Both match the figures measured by hand earlier. Reports `AR-001` and `AR-002` were backfilled from these, with a flag saying so.

Model names differed between runs (an alias from the agent's `meta.json` in one, the full id in the other). The report now prefers the model id seen in the transcript.

## 2. The isolation audit

- **Negative control.** Runs 1 and 2: no reviewer's tool calls touch another reviewer's report. Audit says clean **[V]**.
- **Positive control.** A throwaway agent was told to open a fake `report-R2.md` as if it were another reviewer's. The audit flagged `Read touched report-R2` and nothing else **[V]**.
- **What it cannot show.** It reads tool calls, not what a model remembers. It does not see a prompt's content. The path matching for shell commands is a heuristic. In a workflow run it cannot see what the harness injects (section 4).

## 3. Answer first, in two messages

A test agent was given three questions in its launch message and no claim. It answered. A second message, sent with `SendMessage` to the same agent id, then gave a claim about the work and asked it to repeat an earlier answer **[V]**:

- The agent kept its earlier context: it repeated the answer "Everybody" word for word and judged the claim false against the file.
- The transcript shows the first prompt, then the claim arriving as a later message, so the order is checkable from timestamps. The second round took about 3 seconds and 0.7k extra tokens.
- This shows the mechanism works and the order is auditable. It does not stop an agent from finding the claim elsewhere, so a real use still needs the claim kept out of every file the agent can read until the second message is sent.

The skill does not use this yet. No step of it has an answer-first stage.

## 4. The workflow variant

A smoke test with two reviewers and a judge on five invented lines, then run 3 **[V]**:

- Reviewers and the judge returned structured output. Only the counts and the digest reached the main session.
- `ar.py extract` saved the reports, the ruling and the digest from the agents' own records, in the layout the prompts ask for.
- Models and efforts read from the records: reviewers `claude-haiku-5-5` at high, judge `claude-sonnet-5-5` at xhigh. The script passes them per call, and nothing was inherited.
- The agents' records sit in `subagents/workflows/<run id>/`, and their first user message is not the task. The harness puts a relay of the user's triggering request first and the computed task second. The script now reads the first three user messages.
- **A new isolation fact.** The relay carries the user's request verbatim into every agent. For these runs it said nothing about the work, but the skill's rule 2 (nothing from this conversation reaches a reviewer) cannot be held in this variant. The skill now says so and the report flags it every time.
- Token figures differ a little by method: the harness reported 178,566 for the smoke test and the script, which uses each agent's last-turn context plus output, reported 192,993 (about 8 % more). On Agent-tool runs the two agreed exactly (judge, run 2: 158,260). Treat tokens from workflow runs as approximate.

## 5. What these tests did not cover

- The script was tested on runs from one session of one environment. Transcript locations are harness internals and may move. If the script cannot find the records it leaves those fields `unknown` and says so.
- `ar.py publish` was used report-only for the two backfills. The full copy path is first exercised by run 3.
