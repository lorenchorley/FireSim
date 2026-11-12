# Branching: gitflow, managed by agents

Adopted 2026-11-12. Before this the repository had no `main` and no `develop`. Its default branch was a long-running working branch, `claude/3d-fire-simulation-app-xoy1o6`.

## Who manages this repository

**The owner takes no part in managing this repository. Agents manage all of it, autonomously.** That means every agent session, not one in particular: branching, merging, resolving conflicts, cutting releases and recording them, retiring old branches, and keeping this guide true. No step in this guide is waiting on the owner, and none may be handed to the owner.

- An agent never asks the owner to merge, review, approve, tag, release, clean up or change a repository setting.
- An agent never leaves a repository job as "for the owner". If it cannot do a job from its environment, it records the job under "Gaps" below, with what blocked it, and carries on. A later agent with the access does it.
- This covers the repository only. Decisions about what the app should do are not part of it.

The same statement is in `CLAUDE.md` at the root, which Claude Code agent sessions load when they start in this repository.

## The branches

| Branch | Holds | Starts from | Merges into |
|---|---|---|---|
| `main` | Released code only. Every commit on it is a release, recorded in `RELEASES.md` | | |
| `develop` | The next release: everything merged and not yet released | | |
| `feature/<name>` | One piece of work | `develop` | `develop` |
| `release/X.Y.Z` | A release being stabilised: version bump, documentation, the release gate, blocker fixes only | `develop` | `main`, then back into `develop` |
| `hotfix/X.Y.Z` | An urgent fix to released code | `main` | `main`, then into `develop` |

**Session branches.** The tooling gives each agent session its own branch (`claude/<name>` or `ccr-<id>`) and tells the session to push only there. They cannot be renamed, so each one is treated as a `feature/` branch: it is merged into `develop`, never directly into `main`.

## How agents run it

1. **Merge your own finished work into `develop`, without being asked.** Use a merge commit (`git merge --no-ff`, never squash or rebase) whose message says what the branch brings, so the history reads on its own. No pull request is needed. Merge progressively: each coherent piece of finished work, not one lump at the end. Before merging, merge `develop` into your branch so the merge back is clean.
2. **Sweep at the start and the end of every session:** `git fetch origin && git branch -r --no-merged origin/develop`. For each branch listed:
   - Its last commit is under an hour old: leave it. Its session may still be working.
   - Its work is finished and the gate passes: merge it into `develop`.
   - Its work is unfinished and old: merge it anyway if it is coherent and passes the gate, otherwise leave a note in `develop`'s next merge message naming the branch and why it was left.
   - It is superseded (everything on it already exists in `develop`): record it with `git merge -s ours --allow-unrelated-histories` if its history is unrelated, or `git merge -s ours` if related. This marks it integrated, keeps its commits reachable, and changes no files.
3. **The gate.** If a merge into `develop` changes `src/`, `tests/`, `desktop/`, `e2e/` or a config file, `npm run typecheck` and `npm run test:fast` must pass first (run `npm ci` if `node_modules` is missing). A docs-only merge needs no gate. If the environment cannot run the gate, say so in the merge message.
4. **Concurrency.** Sessions run in parallel. If a push to `develop` is rejected because it moved, fetch, merge again, repeat the gate if code changed, and push again. Never force.
5. **Conflicts.** The agent doing the merge resolves them. Keep the work of both sides. If two changes cannot both stand, keep the one on `develop` and put the other in a new commit on a branch of its own, named in the merge message.
6. **Releases** follow the release plan of the version (`docs/plans/<version>/`) and are cut by the agent that completes that version's gate:
   1. `git switch -c release/0.9.0 develop`
   2. Bump `version` in `package.json` and the Android `versionCode`, run the release gate, fix only blockers on this branch.
   3. `git switch main && git merge --no-ff release/0.9.0`
   4. Add the row to `RELEASES.md`, and tag `v0.9.0` if the environment can push tags.
   5. `git switch develop && git merge --no-ff release/0.9.0`
   6. Push `main` and `develop`.
7. A hotfix is the same, from `main`, with the patch version raised.

**What agents never do:** force-push, rewrite history, delete a branch, or commit directly on `main` or `develop`. `main` changes only by a release or a hotfix merge.

## State on 2026-11-12

- `main` was created at "Release 0.8.0: version bump (versionCode 12)", `7122c74` (7 November), the latest release in the history. The two documentation commits that follow it (the 0.8.0 gate results) are on `develop`.
- `develop` was created at `972fab3`, the head of `claude/3d-fire-simulation-app-xoy1o6` at that moment: 62 commits after the 0.8.0 release.
- Merged into `develop` by merge commit, with no pull requests:
  - `ccr-7e5e3fd7-iqoqcn` (the adversarial-review skill, review runs, benchmark and this guide): `9df6606`, then `31a2479` for a correction.
  - `claude/3d-fire-simulation-app-xoy1o6` (the option B plan, revision 4): `d861fd0`, merged by its own session, following this guide.
  - `claude/firesim-live-fixtures` (`27140bb`): recorded as integrated with an `ours` merge and no files taken. It is a separate early history from 2026-09-27 with no common ancestor with `develop`. All 230 of its files already exist in `develop` at the same paths, 156 identical and 74 differing, where `develop` holds the later versions.
- After these merges no remote branch has work missing from `develop`.
- The branch `claude/3d-fire-simulation-app-xoy1o6` is still the GitHub default branch (see "Gaps").

## Gaps

Jobs no agent could do from the environment where this was set up. They belong to the agents, not the owner. Any agent session that has the access does them, then deletes the entry here.

| Gap | What blocked it | What to do |
|---|---|---|
| Tags are not on the remote | The git proxy refuses pushes of tags (branch pushes work). `v0.8.0` exists locally only | From a session that can push tags: create annotated `vX.Y.Z` tags on the commits in `RELEASES.md` and push them |
| The default branch is `claude/3d-fire-simulation-app-xoy1o6` | No agent tool changes repository settings | Set the default branch to `develop` in the repository settings |
| `main` and `develop` are not protected | Same | Add branch protection or a ruleset: no force pushes, no deletion. Do not require pull requests, since agents merge directly |

Until the protection exists, the rules above are held by agent discipline only.

## Local setup

`scripts/gitflow-config.sh` points the git-flow command line tool (git-flow-avh) at these branch names. Run it once per clone. The tool is optional: every step above works with plain `git`.
