# Repository management

**The owner takes no part in managing this repository. Agents manage all of it, autonomously.** That covers branching, merging, conflict resolution, releases and tags, the housekeeping of old branches, and keeping `docs/GITFLOW.md` true. An agent never asks the owner to merge, review, approve, tag, release, clean up, or change a repository setting, and never leaves such a job as "for the owner". If an agent cannot do one of these from its environment, it records what it could not do under "Gaps" in `docs/GITFLOW.md` and a later agent with the access does it. It is not handed to the owner.

This covers the repository only. Decisions about what the app should do are not part of it.

The branch model is gitflow. The full rules, the release procedure and the current state are in `docs/GITFLOW.md`. In short:

- `main` holds releases only. `develop` is the next release. Work happens on a branch of its own: `feature/<name>`, or the `claude/…` or `ccr-…` branch the session was given.
- **Merge your finished work into `develop` yourself**, with a merge commit (`git merge --no-ff`) whose message says what the branch brings. Do not wait to be asked, and do not open a pull request. Merge progressively, not in one lump at the end.
- **Sweep at the start and the end of every session:** `git fetch origin && git branch -r --no-merged origin/develop`. Merge every branch listed whose work is finished and whose last commit is over an hour old. Record a branch that is superseded with `git merge -s ours`. Nothing may sit unmerged because nobody was asked.
- **Gate:** if a merge into `develop` changes `src/`, `tests/`, `desktop/`, `e2e/` or a config file, `npm run typecheck` and `npm run test:fast` must pass first. Docs-only merges need no gate. If the environment cannot run them, say so in the merge message.
- If a push to `develop` is rejected because it moved, fetch, merge again, repeat the gate if code changed, and push again.
- Never force-push, never rewrite history, never delete a branch, never commit directly to `main` or `develop`.
