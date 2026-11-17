# Run 2

- Date: 2026-11-12
- Work: /home/user/FireSim/docs/adversarial-validation/ASSESSMENT-2026-11-12-v2.md
- Lenses: the same five as run 1, for comparison: prose / Facts and numbers, plans / Missing requirements, prose / Argument and logic, plans / Feasibility, plans / Alternatives
- Reviewers: subagent_type general-purpose, model haiku, effort high
- Judge: subagent_type general-purpose, model sonnet, effort xhigh
- Primary session context before the run: 319,428 tokens (get_session context_usage)

## Observed after the run

- Models and effort, read from the subagent transcripts: R1 to R5 claude-haiku-5-5 at high; judge claude-sonnet-5-5 at xhigh. Matches the settings above.
- Deviation 1: all five reviewers' writes to REPORT_PATH were refused by the harness ("Subagents should return findings as text, not write report files"). Each reviewer returned its full report as text. The orchestrator copied each report byte for byte from the reviewer's final hand-back message into report-RN.md with a script, so no report text passed through the orchestrator's own output. The reports in this directory are those copies.
- The judge could write files and wrote ruling.md and digest.md itself. Cause of the difference is unknown.
- Subagent tokens as reported by the harness: R1 106,086; R2 108,347; R3 106,317; R4 112,463; R5 108,499; judge 158,260. Total 699,972.
- Subagent durations: R1 120 s; R2 111 s; R3 140 s; R4 123 s; R5 100 s; judge 357 s.
- Primary session context (get_session context_usage): 319,428 before step 1 and 359,059 after the judge's digest, an increase of 39,631 tokens. The reviewers' reports arrived in the primary session as text, about 45,000 characters in all.
