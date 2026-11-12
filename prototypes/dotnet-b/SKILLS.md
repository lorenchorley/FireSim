# dotnet/skills: which skill each agent reads

Source: https://github.com/dotnet/skills . A shallow clone is at
`/tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/dotnet-skills/repo/` (paths below are relative to its `plugins/`). If the clone is gone, `git clone --depth 1 https://github.com/dotnet/skills.git` into a new empty directory. Read each `SKILL.md` in full and the `references/` it tells you to read; they correct outdated assumptions in training data. Report which ones you used.

| Agent | Read |
|---|---|
| K1 | `dotnet-diag/skills/microbenchmarking/SKILL.md` and all five `references/`; `dotnet-advanced/skills/vectorization/SKILL.md`; `dotnet-diag/skills/analyzing-dotnet-performance/SKILL.md`; `dotnet-diag/skills/dotnet-trace-collect/SKILL.md` if you profile the C# |
| T2 | `dotnet-maui/skills/dotnet-maui-doctor/SKILL.md` and its `references/` (Linux and the JDK, workload discovery, installation commands, troubleshooting); `dotnet/skills/setup-local-sdk/SKILL.md`; `dotnet-blazor/skills/use-js-interop/SKILL.md`; `dotnet-maui/skills/maui-app-lifecycle/SKILL.md` |
| P3a | none required; `dotnet-test/skills/run-tests/SKILL.md` if you run C# tests |
| P3b to P3e (port) | `dotnet-advanced/skills/vectorization/SKILL.md`, `dotnet-diag/skills/analyzing-dotnet-performance/SKILL.md`, `dotnet/skills/csharp-refactoring/SKILL.md` for any C# restructuring |
| C3 (comparison and tests) | `dotnet-test/skills/scaffold-dotnet-test-project/SKILL.md`, `code-testing`, `run-tests`, `test-anti-patterns`, `assertion-quality`; `dotnet-diag/skills/microbenchmarking` for any timing |
| I4 (integration, host) | `dotnet-aspnetcore/skills/dotnet-webapi/SKILL.md`; `dotnet-blazor/skills/use-js-interop/SKILL.md`; `dotnet-maui/skills/dotnet-maui-doctor/SKILL.md` |
| R5 (continuity) | `dotnet-maui/skills/maui-app-lifecycle/SKILL.md`; `dotnet-diag/skills/android-tombstone-symbolication/SKILL.md` if a crash needs reading |
| V (verifier) | the same skills as the stage being verified, to check the work against them |
