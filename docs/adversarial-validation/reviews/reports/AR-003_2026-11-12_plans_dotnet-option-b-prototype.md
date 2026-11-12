---
run_id: AR-003
date: 2026-11-12
work: docs/plans/dotnet-option-b-prototype.md@853f333
work_slug: dotnet-option-b-prototype
lens_set: plans
lenses: Feasibility; Missing requirements; Failure modes and rollback; Alternatives; Cost and commitment
purpose_source: assumed
orchestration: workflow
skill_version: 3
skill_commit: 80c9db9+uncommitted
run_dir: reviews/run-3
reviewers: 5
reviewer_model: claude-haiku-5-5
reviewer_effort: high
judge_model: claude-sonnet-5-5
judge_effort: xhigh
findings_raised: 35
reviewer_must_fix: 3
ledger_items: 42
ledger_must_fix: 1
ledger_should_fix: 9
ledger_optional: 24
ledger_rejected: 8
overall_call: fix the must-fix items and resend
subagent_tokens: 738609
other_agent_tokens: 266848
wall_minutes: 13.7
orchestrator_context_delta: unknown
isolation: clean
write_refusals: 0
retries: 0
parse_warnings: 0
recall_strict_all: 7/35
recall_strict_in_scope: 7/28
recall_lenient_in_scope: 14/28
recall_reviewer_level_in_scope: 14/28
---

# AR-003 | 2026-11-12 | plans | dotnet-option-b-prototype

## Summary

- Overall call: fix the must-fix items and resend
- Reviewers filed 35 findings (3 must-fix). The judge's ledger has 42 items: 1 must fix, 9 should fix, 24 optional, 8 rejected.
- Severity at the source against the ruling: reviewers rated 3 must-fix, the judge kept 1.
- Isolation audit: clean.
- Subagent tokens: 738609. Wall time: 13.7 minutes. Orchestrator context change: not recorded tokens.

## Settings observed

| Role | Agent | Model | Effort set | Effort observed | Tokens | Minutes | Tool calls | Writes refused |
|---|---|---|---|---|---|---|---|---|
| R1 | a2149a51 | claude-haiku-5-5 | ? | high | 109923 | 2.2 | 13 | 0 |
| R2 | aa784e24 | claude-haiku-5-5 | ? | high | 120452 | 2.2 | 11 | 0 |
| R3 | a8d8282d | claude-haiku-5-5 | ? | high | 104416 | 1.9 | 8 | 0 |
| R4 | ad3a417d | claude-haiku-5-5 | ? | high | 102592 | 1.6 | 7 | 0 |
| R5 | a3ff87aa | claude-haiku-5-5 | ? | high | 104127 | 2.1 | 8 | 0 |
| other | a756179f | claude-sonnet-5-5 | xhigh | xhigh | 132690 | 2.9 | 21 | 0 |
| other | af1376de | claude-sonnet-5-5 | xhigh | xhigh | 134158 | 3.3 | 22 | 0 |
| judge | a095664f | claude-sonnet-5-5 | ? | xhigh | 197099 | 7.8 | 31 | 0 |

## Yield

| Reviewer | Raised | Must-fix | Should-fix | Nitpick | Ruled valid | Partly valid | Rejected | Only this reviewer | Report characters |
|---|---|---|---|---|---|---|---|---|---|
| R1 | 6 | 0 | 5 | 1 | 8 | 4 | 2 | 4 | 8959 |
| R2 | 8 | 1 | 7 | 0 | 10 | 5 | 0 | 7 | 9374 |
| R3 | 8 | 1 | 6 | 1 | 9 | 6 | 4 | 4 | 9980 |
| R4 | 5 | 1 | 3 | 1 | 6 | 3 | 0 | 5 | 7760 |
| R5 | 8 | 0 | 8 | 0 | 8 | 6 | 2 | 5 | 9802 |

Ruled counts come from the ledger rows that name the reviewer's finding ids. A finding the judge folded into another row is counted there once per row. 'Only this reviewer' counts valid rows raised by a single reviewer.

## Isolation audit

- judge: clean. Distinct paths outside the run directory and the skill: 36, of which not named in the pack: 11.
  - not in pack: 12/se_diff
  - not in pack: 2/30
  - not in pack: Fs.Bench/Fs.Bench.csproj
  - not in pack: cv/math.sqrt
  - not in pack: docs/research/09
  - not in pack: prototypes/dotnet-b/ts-export/tsconfig.json
- R1: clean. Distinct paths outside the run directory and the skill: 21, of which not named in the pack: 2.
  - not in pack: throttle/hostile
  - not in pack: tsconfig/vitest
- R5: clean. Distinct paths outside the run directory and the skill: 16, of which not named in the pack: 4.
  - not in pack: /node_modules
  - not in pack: SKILLS/README
  - not in pack: budget/lane
  - not in pack: weekly/budget
- R3: clean. Distinct paths outside the run directory and the skill: 6, of which not named in the pack: 2.
  - not in pack: .github/workflows
  - not in pack: android/app/build.gradle
- R2: clean. Distinct paths outside the run directory and the skill: 15, of which not named in the pack: 7.
  - not in pack: ARCH/README
  - not in pack: D33/D34
  - not in pack: battery/thermal
  - not in pack: docs/decisions
  - not in pack: licence/attribution
  - not in pack: network/offline/audit/iOS/attribution/licence
- R4: clean. Distinct paths outside the run directory and the skill: 2, of which not named in the pack: 0.

The audit reads each reviewer's tool calls. It looks for other reviewers' reports, rulings the pack does not list, git history, and any pattern passed with --forbid. It shows what was touched, not what was read into the model's head, and the path matching for shell commands is a heuristic.

## Flags (automatic)

- FLAG-AR003-1 | the workflow harness gave every agent the user's triggering request verbatim (207 characters). Check that it says nothing about the work under review.
- FLAG-AR003-2 | The orchestrator context change is not separable for this run: the window between launch and completion (194,684 to 361,620 tokens) also held unrelated work. What the run itself put into the main session was the launch call, the completion notice with the digest, and short script output, which I estimate at 3,000 to 4,000 tokens (derived, not measured). Run 2 measured +39,631.
- FLAG-AR003-3 | Subject of the run: the option B prototype plan at commit 853f333, exported to a clean folder without git or media. It is also the test case for scoring against an answer key: two independent scorers (Sonnet, xhigh), whose tokens are in other_agent_tokens. See scoring.md, scoring-2.md and scoring-agreement.md.

## Scoring against an answer key

The run's ledger was scored against a known answer key by a separate agent. The full table is in `scoring.md` in the run directory.

- in scope: 28
- needs web: 6
- needs artifact: 1
- Matched: 7 (of which in scope: 7)
- Partly matched: 8 (in scope: 7)
- Raised, not ruled: 0 (in scope: 0)
- Rejected: 0 (in scope: 0)
- Not found: 20 (in scope: 14)
- Recall strict, all items: 7 / 35
- Recall strict, in-scope items: 7 / 28
- Recall lenient, in-scope items: 14 / 28
- Reviewer-level recall, in-scope items: 14 / 28
- A second independent scorer, with the first scoring out of its reach, found the same scope split and the same strict figure (7 / 28) and a lenient figure of 16 / 28. The two agree on 31 of 35 results and on 33 of 35 for found or not. See `scoring-agreement.md`. Treat the lenient recall as a range, 14 to 16 of 28.

## Skill feedback

One line per item, in this exact form. Leave the line below as it is if there is nothing to add.

`- SF-AR003-1 | area: <reviewer-prompt|judge-prompt|skill|lenses|scripts|harness> | observation: <what happened> | proposal: <what to change> | evidence: <where>`

- SF-AR003-1 | area: scripts | observation: the isolation audit listed about 60 paths as "not named in the pack", nearly all of them ordinary files under the snapshot directory the pack names, so the list hid anything real | proposal: count a path as listed when it sits under a directory the pack names (done in this version of ar.py) | evidence: AR-003 Isolation audit, first draft
- SF-AR003-2 | area: reviewer-prompt | observation: the cap of eight findings limited the count but not the length: five reports of 7,800 to 10,000 characters each, 45,900 in total, against about 45,000 for run 2 (a different work, so only a rough comparison) | proposal: cap the length of a finding as well (for example 600 characters per finding, 5,000 per report), or accept the size, since the workflow variant keeps reports out of the main session | evidence: AR-003 and AR-002 Yield tables
- SF-AR003-3 | area: judge-prompt | observation: splitting compound items turned 35 reviewer findings into a ledger of 42 items, 24 of them Optional, and the digest reached 3,500 characters | proposal: let the digest group Optional items on one line each and keep one line per Must fix and Should fix item | evidence: AR-003 ledger and digest
- SF-AR003-4 | area: scripts | observation: the report takes the orchestrator's context change as a number, but in a long session other work falls inside the launch-to-completion window, so the number cannot be attributed to the run | proposal: record the reading only when nothing else is done between launch and completion, otherwise leave it unknown and give an estimate of what the run itself put into the session | evidence: AR-003 flag FLAG-AR003-4
- SF-AR003-5 | area: skill | observation: scoring a run against an answer key needed a role and a prompt that live outside the skill, and the recall figures were not in the report | proposal: add the scoring prompt to the skill as an optional step for works with a known answer key, and read its counts into the report's front matter | evidence: AR-003 scoring.md
- SF-AR003-6 | area: scripts | observation: forbidden patterns were case-sensitive and checked only what an agent did, so a search that returned forbidden text, or a pattern written in the wrong case (REDTEAM against redteam), would have passed the audit as clean | proposal: match patterns case-insensitively and also against every tool result, and audit the judge as well (done in this version of ar.py, checked with a planted forbidden string) | evidence: AR-003 audit review, TOOLING-TESTS note

<!-- SF-LINES -->

## Judge digest (verbatim)

```
Overall call: fix the must-fix items and resend
Checked: read plan and 5 reports; ran greps (plan terms, RNG sites, rule 4 target), line counts, SE arithmetic, 3a report reads; not checked: artifact, dotnet/skills clone, container facts, Vitest config, production app ID.
Must fix:
- M1 Gate 1 names no TypeScript baseline (threads, one core or all) (raised by R4.1). Evidence: plan l.34/40 silent; master plan 15e l.1014 gives 1.8-2.0x on 4 cores for the fire step, so a parallel split alone clears 1.5x.
  Fix direction: state the baseline, report per-core and all-core ratios, say what a pass may claim against D34's in-TypeScript routes.
Should fix:
- S1 Add a worker-split TypeScript arm of the same partition to Stage 1 (R4.1). Full WebAssembly/WebGPU arm is not needed for a gate.
- S2 Gate 1 verdicts rest on indicative container numbers, no repeat or quiet-run confirmation (R1.3, R3.3). Add a confirmation rule; Rule 6 already pauses for the owner.
- S3 Section 4 does not say P3b waits for phone numbers, nothing covers owner silence (R1.4, R5.4). State the wait and the default.
- S4 Owner phone rounds (3 to 4, +1 if MAUI build fails) not costed in Section 8 (R5.3). Add rounds and owner time.
- S5 Section 3 bars and Stage 3 gate row not marked as replaced by Section 10 (R3.7, R1.6). Mark them and point to Section 10.
- S6 Recurring cost of two solvers, and whether B keeps the TypeScript solver, not stated (R2.4, R4.4). Add parity upkeep and owner to the report.
- S7 Stage 5 install over the current APK can wipe saved data (R3.1, narrowed). Separate app IDs for test APKs; export or spare phone first.
- S8 Section 10 names only the ember model; spread model also draws on the fire stream (R1.1, narrowed; streams are separate). 3b lists every draw site.
Optional:
- O1-O3 Gate 1 direction wording, D39 2-2.6x figure, no absolute speed target (R1.3, R2.5, R3.3); O4 no mixed-outcome rows (R4.5).
- O5-O8 P3a still pending in order, stale Section 8 estimate, unsupported budget claim, size figure scope (R1.6, R5.1, R5.2, R1.5).
- O9-O11 targeted ulp check, 12 % bar power (SE of difference 4.9-7.0 %), loopback containment (R1.2, R3.2, R3.6).
- O12-O16 offline audit, iOS scope, licences, battery, release checks for a replacement (R2.1, R2.2, R2.3, R2.7, R2.8).
- O17-O19 alternatives not named, Rust/C++/native module, origin test ordering (R4.2, R4.3, R5.5).
- O20-O23 scratchpad durability, version pinning, install route after refusal, ambiguous "plan section 4" (R2.6, R3.4, R5.7, R5.8, R3.5, R5.6, R3.8).
Rejected:
- X1 Dangling rule 4 reference (R3.8): resolves to master plan Section 4 ground rules 1 and 2.
- X2 env.sh other session's folder (R3.4): authoring session's, has reinstall note. X3 Regeneration uncosted (R5.7): about 1 minute.
- X4 No fallback for Android build failure (R1.4): Section 5 gives one. X5 Compute hours, RNG port biggest item (R5.1): 3a gives seconds per run.
- X6 Perturbation test misses ember math (R1.2): embers-on seeds 11-14 included, no ember decision flipped. X7a 3.4 SE arithmetic (R3.2): it is 1.7-2.4 SE of the difference. X7b Not put to owner (R3.2): it is in the plan.
Own observations:
- N1 Stage 1 phone gate has no stated way to time the TypeScript on the same phone; repo has a speed-test harness (src/ui/speedTest*.ts) the plan ignores.
- N2 Section 10 item 1 calls a "correction" what 3a confirms: hashes did change in perturbed runs; only results are insensitive.
Full ruling: /tmp/claude-0/-home-user-FireSim/87003abe-40a8-5b42-ac05-c1f8b4f0083f/scratchpad/run3/ruling.md
```
