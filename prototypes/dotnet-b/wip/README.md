# Work stopped before it finished (2026-11-16)

The owner stopped the session while two builders were mid-task. Their work was **not finished, not reviewed and not verified**, so it is kept here as patches rather than merged into the code, which keeps `develop` green. Each file is an mbox of the builder's commits (the last commit of each is `WIP`, its uncommitted files at the stop). Both applied without conflicts to `develop` at `3b6f509` in a scratch worktree. **T1.4b was resumed and finished (`reports/1-fast-kernels.md`); its patch is gone from this folder.** One patch remains.

| File | Task | Commits | What is in it | What is missing |
|---|---|---|---|---|
| `T3.1bc.patch` | T3.1b and T3.1c, noise and engine floors | 2 | `ts-export/bars.mjs` (the metrics of plan 10.3 from two `arrival.f32` rasters, with `node --test` tests) and the first drafts of `floors.mjs` and `floors-run.mjs` | No run of the noise matrix (60 + 15 runs) or of the Chromium arm, no report `reports/3-floors.md` |

To resume: start a fresh builder for the card, tell it to `git am -3 prototypes/dotnet-b/wip/<file>.patch` on a branch of `develop`, to read the patch's commits first, then to finish the card's *done when*. Delete the patch from this folder in the commit that merges the finished work.
