# Option B prototype: the solver in C# on .NET 11

Plan: `docs/plans/dotnet-option-b-prototype.md` (read it first: stages, gates, rules). Decision D34 stays in force: this folder is a prototype and
changes nothing in the app.

## Layout (each agent owns its own folder)
| Folder | Owner | What |
|---|---|---|
| `Fs.Kernel/` | K1, then P3c-e | the C# solver code (class library) |
| `Fs.Bench/` | K1 | console benchmarks (desktop) |
| `Fs.Compare/` | C3 | reads TypeScript fixtures, compares, thread-count test |
| `Fs.Host/` | I4 | ASP.NET Core desktop host |
| `Fs.Transport/` | T2, I4 | MAUI Android test app (create the project here) |
| `ts-export/` | P3a | TypeScript fixture exporter and difference study (reads the app's solver, never edits it) |
| `reports/` | all | one markdown report per stage; machine-readable results as JSON (see `reports/RESULTS-SCHEMA.md`) |

## SDK
`source prototypes/dotnet-b/env.sh`. The .NET 11.0.100 SDK was installed from Microsoft's official tarball
(`https://builds.dotnet.microsoft.com/dotnet/Sdk/11.0.100/dotnet-sdk-11.0.100-linux-x64.tar.gz`), SHA-512 checked against
`https://builds.dotnet.microsoft.com/dotnet/release-metadata/11.0/releases.json`, extracted into the scratchpad. Never run downloaded install scripts.

## Rules
- Only touch your own folder (plus `reports/<your stage>-*`). Do not edit `src/`, `desktop/`, `e2e/` or any release file.
- `fixtures/` is gitignored (megabytes). Keep fixtures in the scratchpad path the lane brief names.
- Numbers carry conditions (machine, cores, runs, median and spread). Container numbers are indicative only.
- Results must not depend on thread count: identical output on 1, 2, 4 and 8 threads.
- Heavy work (builds of MAUI or Android, benchmarks, anything over a minute) under `flock /tmp/firesim-heavy.lock`.
