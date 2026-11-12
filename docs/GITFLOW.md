# Branching: gitflow

Adopted 2026-11-12. Before this the repository had no `main` and no `develop`. Its default branch was a long-running working branch, `claude/3d-fire-simulation-app-xoy1o6`.

## The branches

| Branch | Holds | Starts from | Merges into |
|---|---|---|---|
| `main` | Released code only. Every commit on it is a release and carries a tag `vX.Y.Z` | | |
| `develop` | The next release: everything merged and not yet released | | |
| `feature/<name>` | One piece of work | `develop` | `develop` |
| `release/X.Y.Z` | A release being stabilised: version bump, documentation, the release gate, blocker fixes only | `develop` | `main`, then back into `develop` |
| `hotfix/X.Y.Z` | An urgent fix to released code | `main` | `main`, then into `develop` |

**Session branches.** The tooling gives each agent session its own branch (`claude/<name>` or `ccr-<id>`) and tells the session to push only there. They cannot be renamed, so treat each one as a `feature/` branch: it is merged into `develop`, never directly into `main`.

## Rules

- No commits made directly on `main` or `develop`. Work reaches them by merge.
- Merge with merge commits, not squash and not rebase, so the branch shape stays visible. The history already does this (for example "Merge 0.9.0 lane T").
- Merging: a feature or session branch is merged into `develop` with a merge commit (`git merge --no-ff`), and the message says what the branch brings, so the history reads on its own. A release or hotfix branch is merged into `main`, then into `develop`. Pull requests are optional here, not required. Parallel tasks each work on their own branch and merge this way.
- A release is cut like this:
  1. `git switch -c release/0.9.0 develop`
  2. Bump `version` in `package.json` and the Android `versionCode`, run the release gate, fix only blockers on this branch.
  3. `git switch main && git merge --no-ff release/0.9.0`
  4. `git tag -a v0.9.0 -m "Release 0.9.0 (versionCode 13)"`
  5. `git switch develop && git merge --no-ff release/0.9.0`
  6. Push `main`, `develop` and the tag, then delete the release branch.
- A hotfix is the same, from `main`, with the patch version raised.

## What was set up on 2026-11-12

- `main` was created at the commit "Release 0.8.0: version bump (versionCode 12)", `7122c74` (7 November). It is the latest release in the history. The two documentation commits that follow it (the 0.8.0 gate results) are on `develop`, not `main`.
- `develop` was created at `972fab3`, the head of `claude/3d-fire-simulation-app-xoy1o6` at that moment. That is 62 commits after the 0.8.0 release: the unreleased 0.9.0 work and the option B prototype plan.
- The tag `v0.8.0` was created locally on `7122c74` but **could not be pushed** from the agent environment (branch pushes work, tag pushes are refused). Push it from a normal clone: `git fetch origin && git tag -a v0.8.0 7122c74 -m "Release 0.8.0 (versionCode 12)" && git push origin v0.8.0`.
- The earlier releases (0.7.0 and before) are not tagged. The history has commits named "Release X.Y.Z: ..." that can be tagged the same way if wanted.
- `ccr-7e5e3fd7-iqoqcn` (the adversarial-review skill, review runs, benchmark and this guide) was merged into `develop` the same day with a merge commit, `9df6606`. It was merged directly, without a pull request. The branch still exists.
- The other branches were left as they were:
  - `claude/3d-fire-simulation-app-xoy1o6` is still the GitHub default branch and still advancing. It is not yet merged into `develop`, so `develop` will fall behind it until it is merged.
  - `claude/firesim-live-fixtures` is 267 commits behind and holds 9 commits not in `develop`. Merge or retire it.

## What needs the repository owner

The agent environment has no access to the GitHub repository settings, so these are not done:

1. Settings, Branches: set the default branch to `develop`, so pull requests aim at it by default.
2. Branch protection (or a ruleset) on `main` and `develop`: require a pull request, block force pushes, block deletion. GitHub's basic rules cannot restrict which branch may merge into `main`, so keep to the rule above by hand.
3. Push the `v0.8.0` tag (above).
4. Decide when to merge `claude/3d-fire-simulation-app-xoy1o6` into `develop`.

## Local setup

`scripts/gitflow-config.sh` points the git-flow command line tool (git-flow-avh) at these branch names. Run it once per clone. The tool is optional: every step above works with plain `git`.
