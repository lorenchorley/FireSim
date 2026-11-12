---
run_id: AR-004
date: 2026-11-12
work: docs/plans/dotnet-option-b-prototype.md (snapshot at commit 853f333)
work_slug: dotnet-option-b-prototype
lens_set: plans
lenses: Feasibility, Missing requirements, Failure modes and rollback, Alternatives, Cost and commitment
purpose_source: assumed
orchestration: manual
skill_version: 3
skill_commit: c126641
run_dir: reviews/run-4
reviewers: 5
reviewer_model: claude-haiku-5-5
reviewer_effort: high
judge_model: claude-sonnet-5-5
judge_effort: xhigh
findings_raised: 36
reviewer_must_fix: 8
ledger_items: 38
ledger_must_fix: 2
ledger_should_fix: 16
ledger_optional: 18
ledger_rejected: 2
overall_call: fix the must-fix items and resend
subagent_tokens: 726031
other_agent_tokens: 109478
wall_minutes: 11.2
orchestrator_context_delta: unknown
isolation: clean
write_refusals: 5
retries: 0
parse_warnings: 0
---

# AR-004 | 2026-11-12 | plans | dotnet-option-b-prototype

## Summary

- Overall call: fix the must-fix items and resend
- Reviewers filed 36 findings (8 must-fix). The judge's ledger has 38 items: 2 must fix, 16 should fix, 18 optional, 2 rejected.
- Severity at the source against the ruling: reviewers rated 8 must-fix, the judge kept 2.
- Isolation audit: clean.
- Subagent tokens: 726031. Wall time: 11.2 minutes. Orchestrator context change: not recorded.

## Settings observed

| Role | Agent | Model | Effort set | Effort observed | Tokens | Minutes | Tool calls | Writes refused |
|---|---|---|---|---|---|---|---|---|
| R1 | a4bc88e9 | claude-haiku-5-5 | high | high | 123299 | 3.1 | 18 | 1 |
| R2 | a60f2601 | claude-haiku-5-5 | high | high | 131791 | 3.4 | 18 | 1 |
| R3 | a2611586 | claude-haiku-5-5 | high | high | 104199 | 2.5 | 13 | 1 |
| R4 | a798f8dc | claude-haiku-5-5 | high | high | 102886 | 2.1 | 13 | 1 |
| R5 | ab314766 | claude-haiku-5-5 | high | high | 95831 | 2.2 | 14 | 1 |
| other | a7ac412d | claude-sonnet-5-5 | xhigh | xhigh | 109478 | 2.4 | 21 | 0 |
| judge | a884ea17 | claude-sonnet-5-5 | xhigh | xhigh | 168025 | 7.6 | 40 | 0 |

## Yield

| Reviewer | Raised | Must-fix | Should-fix | Nitpick | Ruled valid | Partly valid | Rejected | Only this reviewer | Report characters |
|---|---|---|---|---|---|---|---|---|---|
| R1 | 8 | 2 | 4 | 2 | 8 | 2 | 0 | 6 | 10971 |
| R2 | 8 | 3 | 4 | 1 | 10 | 4 | 1 | 8 | 11982 |
| R3 | 7 | 1 | 4 | 2 | 10 | 1 | 0 | 6 | 8999 |
| R4 | 5 | 1 | 3 | 1 | 5 | 2 | 0 | 5 | 6943 |
| R5 | 8 | 1 | 7 | 0 | 9 | 3 | 1 | 4 | 9597 |

Ruled counts come from the ledger rows that name the reviewer's finding ids. A finding the judge folded into another row is counted there once per row. 'Only this reviewer' counts valid rows raised by a single reviewer.

## Isolation audit

- R3: clean. Distinct paths outside the run directory and the skill: 22, of which not named in the pack: 5.
  - not in pack: /node_modules
  - not in pack: SDK/install
  - not in pack: flock/Kestrel/loopback
  - not in pack: reports/3a-reference.md
  - not in pack: scratch/fixtures/loose/bit
- R1: clean. Distinct paths outside the run directory and the skill: 25, of which not named in the pack: 2.
  - not in pack: src/fire/spotting.ts
  - not in pack: tsconfig/vitest
- R2: clean. Distinct paths outside the run directory and the skill: 17, of which not named in the pack: 2.
  - not in pack: __firesim/open
  - not in pack: docs/decisions
- R4: clean. Distinct paths outside the run directory and the skill: 11, of which not named in the pack: 0.
- judge: clean. Distinct paths outside the run directory and the skill: 46, of which not named in the pack: 9.
  - not in pack: ./reports/3a-results.json
  - not in pack: /g
  - not in pack: c/Math.sqrt
  - not in pack: cv/Math.sqrt
  - not in pack: reports/3a-reference.md
  - not in pack: reports/3a-results.json
- R5: clean. Distinct paths outside the run directory and the skill: 23, of which not named in the pack: 4.
  - not in pack: /outils.git/FireSim/.claude/worktrees/ar-benchmark-iteration/.claude/skills/adversarial-review/lenses.md
  - not in pack: ember/atmos
  - not in pack: src/moisture
  - not in pack: src/solver

The audit reads each reviewer's tool calls. It looks for other reviewers' reports, rulings the pack does not list, git history, and any pattern passed with --forbid. It shows what was touched, not what was read into the model's head, and the path matching for shell commands is a heuristic.

## Flags (automatic)

- FLAG-AR004-1 | 5 tool calls were refused with 'Subagents should return findings as text'. Reports were saved from the reviewers' final messages.
- FLAG-AR004-2 | Benchmark repeat of AR-003 by the manual path (launch messages hold only paths), after the workflow runs were withdrawn for a relay leak (see INCIDENT-2026-11-12-workflow-relay-leak.md). Scored over the fixed scope of 28 items (benchmarks/option-b-plan/scope.md). Orchestrator context change not separable: other work fell in the window, and all five reviewers' write was refused so their reports came back as text, about 22,000 tokens per run.

## Skill feedback

One line per item, in this exact form. Leave the line below as it is if there is nothing to add.

`- SF-AR004-1 | area: <reviewer-prompt|judge-prompt|skill|lenses|scripts|harness> | observation: <what happened> | proposal: <what to change> | evidence: <where>`

- SF-AR004-1 | area: reviewer-prompt | observation: reviewers used the owner's global CLAUDE.md as evidence, although the pack does not list it. Subagents inherit it from the harness. In the two clean runs, six of ten reviewers cited it (AR-004 R1.1, R2.3, R3.1, R5.1; AR-005 R1.6, R3.7), and the judge's top must-fix in each run (downloads without owner approval) rests on it. That finding is not in the answer key, so it inflates reviewer must-fix counts without affecting recall | proposal: add to the reviewer prompt and judge prompt that evidence must come from the pack's files, and that instructions or context from outside the pack (such as a CLAUDE.md the harness loads) are listed under Could not check and never filed as a finding. Test it as one experiment against this baseline | evidence: AR-004 and AR-005 reports R1.1, R2.3, R3.1, R5.1, R1.6, R3.7
- SF-AR004-2 | area: harness | observation: in manual runs on this machine every reviewer's write to its report path was refused (5 of 5 in each run), so the full reports came back as text into the orchestrating session, about 22,000 tokens per run. The workflow variant avoids that cost but relays the preceding assistant message to every agent (see INCIDENT-2026-11-12-workflow-relay-leak.md) | proposal: accept the context cost for runs scored against an answer key; for other runs, use the workflow variant only when the message before the user's go-ahead is neutral. Check whether a pre-approved write location removes the refusals | evidence: AR-004 and AR-005 write_refusals

<!-- SF-LINES -->

## Judge digest (verbatim)

```
Overall call: fix the must-fix items and resend
Checked: read the plan and all five reports; opened the cited source, docs and 3a reports; ran greps, line counts and a node power calculation (no python3 here). Could not check: the artifact, MAUI WebView behaviour, Android/MAUI builds, the Vitest config (not in the snapshot).
Must fix:
- M1 Downloads (SDK, JDK, Android SDK, workloads, NuGet) have no owner approval step, ignore the antivirus/signed-files rule, and a refused action gets a second route (R1.1, R2.3, R3.1, R5.1). Evidence: grep for antivirus/signed finds nothing in the plan; section 2 Permission row; checksum comes from the tarball's own host.
  Fix direction: owner approval list before stage 0 (URL, size, signature or checksum, antivirus state); refusal means stop and ask; record what was already downloaded.
- M2 Gate 1 compares all-core C# with one-thread TypeScript, so threading alone can pass it (R4.1). Evidence: air-slice plan line 1014 and D39 estimate 1.8x to 2.6x on 4 cores, above the 1.5x gate; D34 allows TypeScript threads.
  Fix direction: decide Gate 1 on one-thread C# against one-thread TypeScript; report the threading gain as a separate number.
Should fix:
- S1 "Page needs no change" ignores Capacitor use in 9 non-test files (14 with tests); the stage 4 gate does not test live fetch, location or saved data (R2.1). Reword and add checks.
- S2 Loopback ws:// from the MAUI page: cleartext, mixed-content and D36 origin prerequisites unnamed (R1.3). Name them as owner decisions.
- S3 Phone half of Gate 1 has no TypeScript baseline on the phone (R2.7). Use the app's worker or in-app speed test.
- S4 Gate 1 can stop the plan on indicative shared-machine numbers (15 % spread in 3 runs) (R3.5, R5.3). Say what decides; repeat before a stop.
- S5 Parallel.For cannot keep RNG draw order for breach, debris and ember draws; level-set loops and atmosphere solver are RNG-free (R1.2). State per kernel.
- S6 Fs.Tests has no owner or scope; thread-count test placed in both C3 and Fs.Tests (R1.5). Add to S0 and name an owner.
- S7 Fixtures and SDK sit under another session's scratchpad path, no regeneration command or hash manifest (R1.8, R3.2, R5.6). Name command and path; commit a manifest.
- S8-S10b 30-seed ensembles and quiet timings unowned; the 12 % loose bar passes a port 10 % off about 63 % of the time; the fallback trigger and its owner approval are undefined (R5.2, R3.4, R5.7). Schedule, size the bar, name who decides.
- S11 Gate 2 passes on any transport but stage 4 builds loopback regardless (R5.8). Let Gate 2 pick the transport.
- S12 Report omits the two-solver maintenance cost D34 was based on (R4.4). Add a line.
- S13 iOS is not mentioned; no iOS project is committed (R2.2, partly). State it out of scope.
- S14 Section 8 omits owner phone round trips, retries and compute (R5.4, partly). Add them.
Optional:
- O1-O4 lifecycle/thermal gate, desktop host behaviours and OS list, Capacitor-plus-native-library shell, WebAssembly/TypeScript-threads alternatives (R2.4, R2.5, R4.3, R4.2).
- O5-O6 existing profile not cited; saved-data origin check is late (R4.5, R5.5).
- O7-O9 desktop parts while waiting on phone, no wait limit, lock serialises heavy steps, no branch/undo line (R1.4, R3.7, R1.6, R3.6).
- O10-O11 Gate 1 ratio wording; WebView 108 floor unstated (R1.7, R2.8).
- O12-O16 stage 2 loopback listener, gitCommit predates exporter, airplane scenario unnamed, APK provenance, phone conditions list (R3.3, R3.2, R2.6, R2.3, R2.4).
Rejected:
- X1 Engine data path unspecified (R2.6): the protocol 2 start message carries terrain, fuel and weather; plan 3b decodes it.
- X2 "Ten agent runs is below the plan's 12" (R5.4): section 8 says ten to twelve, which is one or three port agents.
Own observations:
- N1 Section 2 says the SDK is not installed; section 9, env.sh and README say it was installed, so the plan cannot show what is already downloaded.
- N2 Rule 4 cites "plan section 4, rules 1 and 2", which belong to the air-slice plan, not this plan's section 4.
Full ruling: reviews/run-4/ruling.md
```
