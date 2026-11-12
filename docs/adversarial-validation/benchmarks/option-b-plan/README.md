# Benchmark: the option B prototype plan, with a verified answer key

A work whose defects are known independently of the skill, so a change to the skill can be scored. The plan is the "option B" prototype plan (port FireSim's solver from TypeScript to C# on .NET 11) as it stood before an independent red team attacked it. That red team (seven isolated teams, anonymised claims, two verifiers per claim) produced 35 findings, none refuted. They are the answer key.

## Files

| File | What it is |
|---|---|
| `answer-key.md` | The 35 key items: verified verdicts and the narrowed outcome of each, and which teams found it. Controls are excluded. **Reviewers and the judge must never see this file.** |
| `make-snapshot.sh` | Rebuilds the folder reviewers read: the plan at commit `853f333` and the repository files it cites, without git history or media |

## How to run it

1. `git fetch origin claude/3d-fire-simulation-app-xoy1o6`, then `make-snapshot.sh <dir outside the repository>`.
2. Build the pack as in run 3 (`reviews/run-3/pack.md` is the template: purpose taken from the plan's own opening paragraph, the plan as the work, the snapshot as the sources, "Do not use git"). Use the five `plans` lenses.
3. Run the skill. Pass `--forbid 'benchmarks/'`, `--forbid 'answer-key'`, `--forbid 'redteam'` and `--forbid 'origin/claude'` to `ar.py report`, so the audit shows any touch of the key or the red team's files.
4. Score with `scoring-prompt.md` in the skill directory (`KEY_PATH` is `answer-key.md`). For a figure you will compare across runs, use two independent scorers and report both.

## The baseline: AR-003

Skill version 3, workflow variant, five Haiku reviewers at high effort and one Sonnet judge at xhigh, no web research mandated.

| Measure | Result |
|---|---|
| Key items a reviewer could reach from the snapshot (in scope) | 28 of 35. Six need web facts (current .NET, MAUI, Android, V8), one needs an artifact the reviewers could not read |
| Matched, strict, in scope | 7 of 28 (25 %), the same for both scorers |
| Matched or partly matched, in scope | 14 to 16 of 28 (50 to 57 %), two scorers. They agree on 31 of 35 results and on 33 of 35 for found or not |
| Raised by a reviewer but dropped by the judge | none, for the in-scope items |
| Ruled valid or partly valid with no key counterpart | 19 items (first scorer). Unverified: they may be true defects the red team missed, or noise |
| Cost | 738,609 subagent tokens for the run (about 13.7 minutes) and 266,848 for two scorers |

For comparison, the red team that made the key used about 3.8 M tokens and 56 minutes and had every team do at least 12 web lookups.

## Limits of this benchmark

- The key is what one team found and two verifiers confirmed. It is not the list of all defects, so recall is recall against that list, and the 19 extras cannot be called false positives.
- One plan, one set of lenses, one run. A single run's recall is a sample, not a rate. Repeat before reading small changes as real.
- Scoring is a model's judgement. The two scorers disagreed on four items, all borderline.
- The items cluster in a few areas (gates, numerics, platform, operations), so the figure says little about other kinds of work.
- Isolation was checked after the run, with the key, the red team's files, this repository's review documents and `origin/claude` as forbidden patterns, case-insensitive, against every tool call and every tool result of all six agents: no hit. The reviewers read the snapshot (32 calls) and the skill's own two prompt files; nothing in the live checkout. The audit reads tool calls and results, not what a model remembers from training.
