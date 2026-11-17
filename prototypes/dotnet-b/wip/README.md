# Work stopped before it finished (2026-11-16)

The owner stopped the session while two builders were mid-task. Their work was **not finished, not reviewed and not verified**, so it is kept here as patches rather than merged into the code, which keeps `develop` green. Each file is an mbox of the builder's commits (the last commit of each is `WIP`, its uncommitted files at the stop). Both applied without conflicts to `develop` at `3b6f509` in a scratch worktree.

| File | Task | Commits | What is in it | What is missing |
|---|---|---|---|---|
| `T1.4b.patch` | T1.4b, fast-tier kernels | 3 | `PyrogenicKernel` brought under the rules of plan 10.4 (the `Fs.Kernel/Pyrogenic/` analyzer exemption deleted, demo case 3 changed to fail the build, an exemption test); `LevelSetCore` (`evaluate`, `reinit`, the Heun sub-step) in three forms with a TypeScript capture of the real fast-tier calls, golden hashes, bit-equality tests on 9 forms, child-process checks and a mutation test; the start of `FastBench`, `FastMerge`, `Fs.Wasm/FastTierExports.cs`, `ts/fast/wasm-run.mjs` | The test run of the new classes had just started; no timing (BenchmarkDotNet, the Amdahl projection against the 1.2× fast-tier bar), no WebAssembly publish run, no allocation scan, no report `reports/1-fast-kernels.md` |

To resume: start a fresh builder for the card, tell it to `git am -3 prototypes/dotnet-b/wip/<file>.patch` on a branch of `develop`, to read the patch's commits first, then to finish the card's *done when*. Delete the patch from this folder in the commit that merges the finished work.
