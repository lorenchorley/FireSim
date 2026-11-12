# Benchmark: the option B prototype plan, with a verified answer key

A work whose defects are known independently of the skill, so a change to the skill can be scored. The plan is the "option B" prototype plan (port FireSim's solver from TypeScript to C# on .NET 11) as it stood before an independent red team attacked it. That red team (seven isolated teams, anonymised claims, two verifiers per claim) produced 35 findings, none refuted. They are the answer key.

## Files

| File | What it is |
|---|---|
| `answer-key.md` | The 35 key items: verified verdicts and the narrowed outcome of each, and which teams found it. Controls are excluded. **Reviewers and the judge must never see this file.** |
| `make-snapshot.sh` | Rebuilds the folder reviewers read: the plan at commit `853f333` and the repository files it cites, without git history or media |

## How to run it

**Use the manual path, never the workflow variant.** The workflow harness relays the assistant message that preceded the user's go-ahead to every agent, and a run of this benchmark was withdrawn for it (`../../INCIDENT-2026-11-12-workflow-relay-leak.md`). The launch message of a manual run holds only paths.

1. `git fetch origin claude/3d-fire-simulation-app-xoy1o6` if the commit is not in your clone (`git cat-file -t 853f333`), then `make-snapshot.sh <dir outside the repository>`.
2. Build the pack as in run 3 (`reviews/run-3/pack.md` is the template: purpose taken from the plan's own opening paragraph, the plan as the work, the snapshot as the sources, "Do not use git"). Use the five `plans` lenses.
3. Run the skill. Pass `--forbid 'benchmarks/'`, `--forbid 'answer-key'`, `--forbid 'redteam'` and `--forbid 'origin/claude'` to `ar.py report`, so the audit shows any touch of the key or the red team's files.
4. Score with `scoring-prompt.md` in the skill directory (`KEY_PATH` is `answer-key.md`, `SCOPE_PATH` is `scope.md`, so every run is scored over the same 28 in-scope items). For a figure you will compare across runs, use two independent scorers and report both.

## The baseline: AR-003

Skill version 3, workflow variant, five Haiku reviewers at high effort and one Sonnet judge at xhigh, no web research mandated.

**Caveat found later:** the workflow variant also relays the preceding assistant message to every agent. Its report counted only the triggering request, so whether AR-003's agents received any text about the benchmark was not checked, and cannot be checked from the files kept. Treat this baseline as unconfirmed until a clean manual rerun reproduces it.

| Measure | Result |
|---|---|
| Key items a reviewer could reach from the snapshot (in scope) | 28 of 35. Six need web facts (current .NET, MAUI, Android, V8), one needs an artifact the reviewers could not read |
| Matched, strict, in scope | 7 of 28 (25 %), the same for both scorers |
| Matched or partly matched, in scope | 14 to 16 of 28 (50 to 57 %), two scorers. They agree on 31 of 35 results and on 33 of 35 for found or not |
| Raised by a reviewer but dropped by the judge | none, for the in-scope items |
| Ruled valid or partly valid with no key counterpart | 19 items (first scorer). Unverified: they may be true defects the red team missed, or noise |
| Cost | 738,609 subagent tokens for the run (about 13.7 minutes) and 266,848 for two scorers |

**Precision of the extras (2026-11-12).** One independent checker (Sonnet, xhigh) read 19 neutral claims, with no judge verdicts and no key, against the plan and snapshot: 15 Real, 4 Partly real, 0 Not real, 0 Cannot tell, and 1 that matters for the decision to start (**E17** [install route changed after a refusal, no recorded owner OK]). So the judge's unmatched findings are mostly true but minor defects, and the key is not a full defect list. One model's check, not a second opinion. See `extras-check-2026-11-12.md`.

For comparison, the red team that made the key used about 3.8 M tokens and 56 minutes and had every team do at least 12 web lookups.

## Repeats and the noise floor (2026-11-12)

Two clean repeats by the manual path (reports `AR-004` and `AR-005`, same pack, lenses, models and efforts as AR-003), scored by one scorer each over the fixed scope of 28 items. Two earlier repeats by the workflow variant were withdrawn for a relay leak (`../../INCIDENT-2026-11-12-workflow-relay-leak.md`); their figures on the same scope are listed for reference only.

| Run | Path | Strict, in scope (of 28) | Lenient, in scope (of 28) | Status |
|---|---|---|---|---|
| AR-003 | workflow | 7 | 14 to 16 (two scorers) | unconfirmed (relay not checked) |
| AR-004 | manual | 8 | 18 | clean |
| AR-005 | manual | 9 | 16 | clean (the judge ran a forbidden git command, flagged) |
| withdrawn A | workflow | 7 | 16 | leaked |
| withdrawn B | workflow | 6 | 16 | leaked |

What this shows:

- **Totals are stable to about three items.** Strict ranged 6 to 9 and lenient 14 to 18 over five runs. The leaked runs did not score above the clean ones.
- **Which items are found is not stable.** 24 of the 28 in-scope items were found (matched or partly matched) by at least one of the five runs, and only 6 by all five. The clean run AR-004 found **S-1** [host-security parity], **S-4** [no background/kill test] and **T-5** [page "needs no change"] strictly, which AR-003 had missed, so those misses were chance, not limits of the method.
- **Four items were never found in any run:** **G-9** [debug builds distort phone timing], **G-10** [stage 2 rates asserted without basis], **N-4** [JavaScript/C# semantic traps] and **N-7** [900 s and 1800 s runs on one site]. These are the real gaps.
- **One run is a sample.** A change to the skill counts as an improvement only if one run exceeds the clean range by more than the spread (strict 12 or more, lenient 21 or more of 28), or if the mean of at least three runs does. Smaller moves are noise.
- **Precision is separate.** Extras are mostly true (see above), so recall is the number to move, with the must-fix count watched for inflation: reviewers cited text from outside the pack (the owner's CLAUDE.md), see `SF-AR004-1`.

## Limits of this benchmark

- The key is what one team found and two verifiers confirmed. It is not the list of all defects, so recall is recall against that list, and the 19 extras cannot be called false positives.
- One plan, one set of lenses, one run. A single run's recall is a sample, not a rate. Repeat before reading small changes as real.
- Scoring is a model's judgement. The two scorers disagreed on four items, all borderline.
- The items cluster in a few areas (gates, numerics, platform, operations), so the figure says little about other kinds of work.
- Isolation was checked after the run, with the key, the red team's files, this repository's review documents and `origin/claude` as forbidden patterns, case-insensitive, against every tool call and every tool result of all six agents: no hit. The reviewers read the snapshot (32 calls) and the skill's own two prompt files; nothing in the live checkout. The audit reads tool calls and results, not what a model remembers from training.
