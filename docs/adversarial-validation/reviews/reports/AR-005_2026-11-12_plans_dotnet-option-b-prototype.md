---
run_id: AR-005
date: 2026-11-12
work: docs/plans/dotnet-option-b-prototype.md (snapshot at commit 853f333)
work_slug: dotnet-option-b-prototype
lens_set: plans
lenses: Feasibility, Missing requirements, Failure modes and rollback, Alternatives, Cost and commitment
purpose_source: assumed
orchestration: manual
skill_version: 3
skill_commit: c126641
run_dir: reviews/run-5
reviewers: 5
reviewer_model: claude-haiku-5-5
reviewer_effort: high
judge_model: claude-sonnet-5-5
judge_effort: xhigh
findings_raised: 35
reviewer_must_fix: 4
ledger_items: 42
ledger_must_fix: 3
ledger_should_fix: 15
ledger_optional: 14
ledger_rejected: 10
overall_call: fix the must-fix items and resend
subagent_tokens: 727584
other_agent_tokens: 116672
wall_minutes: 11.5
orchestrator_context_delta: unknown
isolation: flags:1
write_refusals: 5
retries: 0
parse_warnings: 0
recall_strict_all: 9/35
recall_strict_in_scope: 9/28
recall_lenient_in_scope: 16/28
recall_reviewer_level_in_scope: 16/28
---

# AR-005 | 2026-11-12 | plans | dotnet-option-b-prototype

## Summary

- Overall call: fix the must-fix items and resend
- Reviewers filed 35 findings (4 must-fix). The judge's ledger has 42 items: 3 must fix, 15 should fix, 14 optional, 10 rejected.
- Severity at the source against the ruling: reviewers rated 4 must-fix, the judge kept 3.
- Isolation audit: flags:1.
- Subagent tokens: 727584. Wall time: 11.5 minutes. Orchestrator context change: not recorded.

## Settings observed

| Role | Agent | Model | Effort set | Effort observed | Tokens | Minutes | Tool calls | Writes refused |
|---|---|---|---|---|---|---|---|---|
| R1 | a85c1551 | claude-haiku-5-5 | high | high | 135939 | 3.8 | 22 | 1 |
| R2 | a0b510b1 | claude-haiku-5-5 | high | high | 121695 | 2.3 | 19 | 1 |
| R3 | a6219ecf | claude-haiku-5-5 | high | high | 110663 | 2.8 | 15 | 1 |
| R4 | a0f12524 | claude-haiku-5-5 | high | high | 116683 | 2.5 | 14 | 1 |
| R5 | af819d6a | claude-haiku-5-5 | high | high | 85739 | 1.8 | 9 | 1 |
| other | a1f8a546 | claude-sonnet-5-5 | xhigh | xhigh | 116672 | 3.1 | 24 | 0 |
| judge | a50097c4 | claude-sonnet-5-5 | xhigh | xhigh | 156865 | 7.5 | 43 | 0 |

## Yield

| Reviewer | Raised | Must-fix | Should-fix | Nitpick | Ruled valid | Partly valid | Rejected | Only this reviewer | Report characters |
|---|---|---|---|---|---|---|---|---|---|
| R1 | 8 | 2 | 5 | 1 | 9 | 6 | 3 | 4 | 11326 |
| R2 | 7 | 1 | 6 | 0 | 8 | 5 | 2 | 6 | 8581 |
| R3 | 7 | 0 | 6 | 1 | 7 | 6 | 1 | 5 | 8541 |
| R4 | 5 | 1 | 3 | 1 | 5 | 3 | 1 | 4 | 7569 |
| R5 | 8 | 0 | 8 | 0 | 9 | 4 | 3 | 5 | 10550 |

Ruled counts come from the ledger rows that name the reviewer's finding ids. A finding the judge folded into another row is counted there once per row. 'Only this reviewer' counts valid rows raised by a single reviewer.

## Isolation audit

- R2: clean. Distinct paths outside the run directory and the skill: 15, of which not named in the pack: 0.
- R4: clean. Distinct paths outside the run directory and the skill: 19, of which not named in the pack: 0.
- judge: 1 flags. Distinct paths outside the run directory and the skill: 43, of which not named in the pack: 4.
  - FLAG: Bash used git although the pack forbids it: git -C . log -1 2>
  - not in pack: /Users/lchorley/AppData/Local/Temp/claude/4968719846455d7e/62dbc2cd-27ae-4fdc-a848-1cc1ed2e5298/scratchpad/runD/digest.md
  - not in pack: 0.58/1.5
  - not in pack: 0.58/3
  - not in pack: ts-export/README.md
- R3: clean. Distinct paths outside the run directory and the skill: 20, of which not named in the pack: 3.
  - not in pack: ../ts-export/README.md
  - not in pack: /tmp
  - not in pack: plan/prototype
- R1: clean. Distinct paths outside the run directory and the skill: 34, of which not named in the pack: 1.
  - not in pack: ./node_modules
- R5: clean. Distinct paths outside the run directory and the skill: 5, of which not named in the pack: 0.

The audit reads each reviewer's tool calls. It looks for other reviewers' reports, rulings the pack does not list, git history, and any pattern passed with --forbid. It shows what was touched, not what was read into the model's head, and the path matching for shell commands is a heuristic.

## Flags (automatic)

- FLAG-AR005-1 | 5 tool calls were refused with 'Subagents should return findings as text'. Reports were saved from the reviewers' final messages.
- FLAG-AR005-2 | Benchmark repeat of AR-003 by the manual path (launch messages hold only paths), after the workflow runs were withdrawn for a relay leak (see INCIDENT-2026-11-12-workflow-relay-leak.md). Scored over the fixed scope of 28 items (benchmarks/option-b-plan/scope.md). Orchestrator context change not separable: other work fell in the window, and all five reviewers' write was refused so their reports came back as text, about 22,000 tokens per run.
- FLAG-AR005-3 | isolation: judge: Bash used git although the pack forbids it: git -C . log -1 2>

## Scoring against an answer key

The run's ledger was scored against a known answer key by a separate agent. The full table is in `scoring.md` in the run directory.

- in scope: 28
- needs web: 6
- needs other source: 1
- Matched: 9 (of which in scope: 9)
- Partly matched: 8 (in scope: 7)
- Raised, not ruled: 0 (in scope: 0)
- Rejected: 0 (in scope: 0)
- Not found: 18 (in scope: 12)
- Recall strict, all items: 9 / 35
- Recall strict, in-scope items: 9 / 28
- Recall lenient, in-scope items: 16 / 28
- Reviewer-level recall, in-scope items: 16 / 28

## Skill feedback

One line per item, in this exact form. Leave the line below as it is if there is nothing to add.

`- SF-AR005-1 | area: <reviewer-prompt|judge-prompt|skill|lenses|scripts|harness> | observation: <what happened> | proposal: <what to change> | evidence: <where>`

- SF-AR005-1 | area: judge-prompt | observation: the judge ran a version-control log command although the pack says not to use that tool, and the isolation audit flagged it. It looks like a check of which snapshot it was reading, not a read of history that matters here, but the rule was not followed | proposal: repeat the pack's boundary line in the judge prompt next to the instruction to run commands, and say what to use instead to identify the snapshot (the pack names it) | evidence: AR-005 isolation audit, judge
- SF-AR005-2 | area: reviewer-prompt | observation: same as SF-AR004-1, seen again: reviewers cited the owner's global CLAUDE.md as evidence | proposal: see SF-AR004-1 | evidence: AR-005 R1.6, R3.7

<!-- SF-LINES -->

## Judge digest (verbatim)

```
Overall call: fix the must-fix items and resend
Checked: read the plan and all 5 reports; opened the cited source and docs; ran wc -l, grep, ls and a node one-liner (1.63x and 1.24x). Could not check the artifact, whether the owner's download rule covers the Linux container, Android WebView loopback rules, or the built app's default tier (taken from the main plan).
Must fix:
- M1 Stage 1 profile and Gate 1 are fast-tier only, but the phone default is the 3-D air (63 to 82 % of compute) (R2.2). Evidence: main plan D2 line 89 and 15e line 1014; fast tier runs DiagnosticWind. Fix direction: profile Standard too, or state the verdict is fast-tier only.
- M2 Gate 1 does not state the TypeScript core count; the 1.5x bar sits below the 1.8 to 2.0x in-TypeScript ceiling (R4.2, R4.1 narrowed). Evidence: plan lines 34, 40; main plan line 1014. Fix direction: state the baseline, add an all-core TypeScript arm or caveat section 7.
- M3 No step asks the owner about downloads; line 25 substitutes a tarball route after a refusal (R1.6, R3.7, R5.6). Evidence: plan line 25, README "SDK" (checksum, not signature); applicability to the container unverified. Fix direction: list each download with source and signature state, get the owner's yes first.
Should fix:
- S1 Raster fallback cannot feed the embers; but the fast tier uses DiagnosticWind, not the 6,260-line port (R1.1). Say what to export, or drop the fallback for embers-on.
- S2 Gate 3 and the "All pass" row omit the "atmosphere deferred" caveat (R2.3). Name the tiers and parts a pass covers.
- S3 Gate 1 has no kernel-to-run step: 1.5x on a 58 % kernel is about 1.24x on the run (R1.2, R4.2). Record kernel share and implied run speed-up.
- S4 No repeat count or margin rule inside the roughly 15 % measured spread (R1.3, R3.3, R5.7). Add a re-run rule.
- S5 Phone half of Gate 1 has no TypeScript baseline and no written wait for the owner's phone (R1.4). Name the baseline, add the wait.
- S6 Fs.Tests is required (line 112) but unowned; C3 owns the thread-count test in Fs.Compare (R1.5). Assign it.
- S7 "Page needs no change" ignores the shell's origin allowlist entry and the cleartext decision (R1.7, R2.5). State both.
- S8 No applicationId or backup step before sideloading and install-over tests (R3.1). Own id per APK; owner exports data first.
- S9 Stage 3 gate names no seeds; seed 11 never fires embers (R5.3). Name seeds 12 and 13 (fixtures exist).
- S10 "Still to run" items have no agent; the 12-run estimate has no retries (R5.5). Assign or mark conditional.
- S11a Stale Vector<T> text (line 40) and bars (line 48) (R1.8, R5.2). S11b Gate 1 wording and split outcomes unclear (R1.8, N2). Fix both.
- S12 In-TypeScript routes (threads, WASM SIMD) unmeasured, so "reopen D34" has no comparator (R4.1, R4.3). Add arms or state it.
Optional:
- O1 Stage 2 does not count received against sent (R3.2). O2 no solver-commit guard in C3 (R3.4). O3 no rollback line (R3.5).
- O4 Stage 4 cadence and memory have no numbers (R3.6). O5 Auto tier not mentioned (R2.1). O6 verdict is Android only (R2.4).
- O7 parity cost with TypeScript not an owner input (R2.6, R5.4). O8 listening socket vs rule 6 (R2.7). O9 ASP.NET vs Node host (R4.4).
- O10 option A not named (R4.5). O11 origin check could move to stage 2 (R5.1). O12 owner go-ahead for stages 0 and 3a not recorded (R5.6).
- O13 owner phone time not priced (R5.8). O14 pairing lockout, close 4426, Desktop detail not in stage 4 acceptance (R2.5).
Rejected:
- X1 timing runs not under the lock (R1.3): README rule 5 lists benchmarks. X2 no fixture regeneration command (R3.4): ts-export/README.md has it.
- X3 stage 4 commits to the origin (R5.1): prototype only. X4 bars loosened without approval (R5.2): proposals; floor measured; embers-on bars unchanged.
- X5 bars compare different tiers (R2.1): fixtures pin the tier. X6 plan never mentions desktop/ (R4.4): line 5 does. X7 ships on iOS (R2.4): no iOS project.
- X8 port is hard to reverse (R5.4): prototype folder. X9 P3a work wasted by a stop (R1.8): already merged. X10 hottest-kernel failure proves nothing (R1.2): fair stop signal.
Own observations:
- N1 Stage 1 lists the 3-D atmosphere solver as a candidate, but the fast-tier profile cannot select it (DiagnosticWind runs instead).
- N2 Section 7 maps any Gate 1 failure to "no speed argument anywhere", which is wrong if only the phone half fails.
Full ruling: reviews/run-5/ruling.md
```
