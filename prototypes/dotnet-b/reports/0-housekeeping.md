# Housekeeping log (plan task T0.2, 2026-11-16)

## Worktrees
- 52 agent worktrees under `.claude/worktrees/` (7.2 GB) surveyed. 47 had no uncommitted changes and were removed with
  `git worktree remove` (no `--force`). Their branches (`worktree-agent-*`) were left, so every commit is still reachable.
- Four of the removed worktrees' branches hold commits not in `develop` (0.10.0 validity work, a grid-difference study,
  camera-rig and cliff e2e tests, all stopped earlier); they are untouched and still exist as branches.
- Kept because they hold uncommitted changes, until their work is taken:
  `agent-afd949a55c8e205d1` (K1: pyrogenic kernel port + bench, T0.7),
  `agent-af4301a383218d8d9` (T2: MAUI transport app start, T0.7),
  `agent-a770f1f8ebedb0738` (wind-detail scouting files),
  `agent-a75071579e851e934` (0.9.0 verification files),
  `agent-a9440210b766a9021` (a stopped 0.10.0 validity lane's result file).

## Scratchpad
- Removed: the 40 `lane-*` working folders and `vN-out` (2.2 GB, outputs of merged lanes), `dotnet-try/`,
  `FireSim-0.6.0-debug.apk`.
- Kept: the .NET SDK, `android-t2/` (JDK, Android SDK, NuGet cache), `dotnet-fixtures/` (41 fixture folders), the
  installed `firesim-0.8.0-debug.apk`, the debug keystore (`/root/.android/`).

## Result
Free disk went from 8 GB to 17 GB (`df -BG`); the plan's bar is at least 15 GB.

## T0.7 salvage (2026-11-16)
Both stopped lanes' uncommitted work was copied as-is into the repository (build output excluded). It is **unreviewed**:
- **K1** (`agent-afd949a55c8e205d1`): `Fs.Kernel/Pyrogenic/PyrogenicKernel.cs` (446 lines, the C# port of `src/atmosphere/pyrogenic.ts`
  `PyrogenicPotential.solve`), `Fs.Bench/` (BenchmarkDotNet, a Node harness in `ts/`, `run-bench.sh`, `PhoneBench.cs`),
  `reports/1-kernel-results.json` (indicative desktop numbers, container, 4 shared cores). `Fs.Bench` builds in Release.
  This is **not a gate kernel**: the gate kernels are T1.2 (frozen speed-test kernels) and T1.4 (hottest kernel per tier).
  T1.2 and T1.4 may reuse its structure; it does not follow the rule-5 coding rules of the plan (it calls `System.Math`) until T0.4's analyzers are applied.
- **T2** (`agent-af4301a383218d8d9`): `Fs.Transport/` (a MAUI project that compiled in Debug, `HostApi.cs`, `Bench/BenchCore.cs`,
  `Bench/LoopbackWsServer.cs`, `env-android.sh`). Reusable for T0.5 (`Fs.TestApp`) and T5.1 (picture routes). It is not in `FsProto.slnx`.
  `env-android.sh` is the Android build environment (Microsoft JDK, Android SDK, NuGet cache in the scratchpad).
- The two worktrees are removed; their branches remain.
