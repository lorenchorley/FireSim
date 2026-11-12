# Incident: the workflow harness relayed answer-key items to the reviewers

**Date:** 2026-11-12. **Status:** found, three benchmark runs withdrawn, tooling fixed, clean reruns not yet done.

## What happened

The three benchmark runs of the first iteration round (two repeats of run 3, and one run with three extended lenses) used the workflow variant of the `adversarial-review` skill. The harness gives every workflow agent the user's triggering request. It also gives them the assistant message that came just before that request, as "assistant context" (2,243 characters of it here, cut at the start).

That message was the orchestrator's own summary of what run 3 had missed. It named these answer-key items by id and short description:

- **N-10** [Rule 4 conflicts with the tier auto-tune]
- **G-7** [no phone measurement protocol]
- **N-7** [900 s and 1800 s runs on one site only]
- **S-1** [host-security parity]
- **S-4** [no background/kill test]

It also gave the three categories that the extended lenses were written for (claims against the repo, measurement method, operations and security).

Every reviewer and every judge of those runs read it. The existing audit did not catch it, for two reasons: it counted only the user's request (107 characters, "do all of this" and a link), and it scanned the forbidden patterns only in tool calls and tool results, not in the relayed text.

## Which runs are affected

| Run | Status |
|---|---|
| Repeat A (draft report AR-004) | Withdrawn. Not published. |
| Repeat B (draft report AR-005) | Withdrawn. Not published. |
| Extended-lens run X | Withdrawn, stopped mid-way. Doubly affected: its lenses came from the leaked text. |
| AR-003 (the baseline) | **Unknown.** Its transcripts are not available here. Its report counts only the triggering request (207 characters) and says that it did not mention the plan. Whether an assistant message was relayed to its agents was not checked. |
| Extras check of the 19 unmatched findings | Valid. It ran as a plain subagent, not through the workflow, and read neutral claims. |
| Scorers | Valid in method. They ran as plain subagents. Their figures for the withdrawn runs are void. |

For the record only, and not to be used: the scorers' figures for the withdrawn runs were strict 8 and 7 of 29, lenient 17 of 29 for both. Items named in the leak (**S-1**, **S-4**, **G-7**, **T-5** [the page "needs no change" claim]) moved from not found in run 3 to found in a withdrawn run, which is what a leak would produce, but the run-to-run variation was large anyway: 21 of the 28 in-scope items were found by at least one of the three runs and only 9 by all three. The data cannot separate the two causes.

## What was fixed

- `ar.py report` reads the relayed assistant message, flags it, scans it for forbidden patterns and marks the isolation audit `flags`.
- `SKILL.md` says the workflow variant must never be used for a run scored against an answer key.
- The workflow script retries a reviewer whose report holds no `Totals:` and `Verdict:` lines (three of eight reviewers in run X returned stubs).

## What is still open

- Clean reruns by the manual path (the orchestrator's launch message holds only paths).
- Whether AR-003 was affected. If its agents are found to have received a relayed message about the benchmark, its figures need the same flag.
- A fixed scope list for the benchmark. The scorers' split between in scope and needs web changed from 28 and 6 to 29 and 4 between runs, so recall figures used different denominators.

## Lesson

A flag that says "check that the request says nothing about the work" was not enough, because the part that leaked was not the request. Isolation has to be tested on everything the agent was given, including text the harness adds.
