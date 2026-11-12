# Prototype plan: option B, the solver in C# on .NET 11 (2026-11-12)

**What this is.** A staged prototype that answers one question before anyone commits to a rewrite: *would running FireSim's solver in .NET (MAUI on a phone, ASP.NET Core on a desktop) be fast enough, close enough to the TypeScript results, and practical to ship?* Option B is described in the artifact "FireSim on .NET" (https://claude.ai/artifact/VsrSVEJaknFbyWuQh7Svx9): Razor screens plus a C# solver in the .NET process, pictures crossing a message channel to the WebView where Three.js draws them.

**What this is not.** It does not decide the Razor screens (a known, large cost, separate from the risks here). It does not change the app, `src/`, `desktop/` or any release. Decision D34 (one solver, in TypeScript) stays in force until the owner says otherwise after the report. Nothing here is a release or a pull request.

## 1. Rules

1. **Prototype code lives only under `prototypes/dotnet-b/`.** `tsconfig.json` and the Vitest config do not include that folder, so the TypeScript gate is unaffected. The exception is read-only use of the TypeScript solver to produce fixtures.
2. **Fixtures are made by the TypeScript solver and read by the C# code.** They are not committed (they are megabytes); the exporter is. They are kept in the scratchpad.
3. **Every number carries its conditions**: machine, cores, run count, median and spread. Container numbers are desktop-class and noisy (4 shared cores, 16 GB) and are labelled *indicative*. Phone numbers come only from a phone.
4. **Results never depend on speed.** The C# solver must give identical results on 1, 2, 4 and 8 threads (plan section 4, rules 1 and 2). This is a hard requirement, not a tolerance.
5. **Nothing is called a pass that was not run.** A stage that cannot be run here says what it needs.
6. **Stop at a failed gate.** The orchestrator reports the gate and waits for the owner before starting the next stage.

## 2. What was checked about the environment (2026-11-12)

| Item | Finding |
|---|---|
| .NET SDK | Not installed. `builds.dotnet.microsoft.com` (SDK 11.0.100 tarball) answers 200 through the proxy; `dotnetcli.azureedge.net` does not. |
| NuGet, Maven, Gradle, Google Android repository | All reachable (200). |
| Java | Present (version not confirmed). No `adb`, no Android SDK, no `dotnet`. |
| KVM / emulator | Not checked. An Android emulator is not assumed; phone numbers need the owner's phone. |
| Machine | 4 cores, 16 GB, shared with every agent. Heavy work goes under `flock /tmp/firesim-heavy.lock`. |
| Permission | Running the downloaded `dotnet-install.sh` was refused by the auto-mode classifier. The plan installs the SDK from the official tarball instead, verified against Microsoft's published SHA-512, extracted into its own directory. If that is refused too, stage 0 stops and the owner decides. |

## 3. The stages and their gates

Thresholds are proposals. The owner may change any of them before a stage starts.

| Stage | Question | Output | Gate (stop if) | Where it runs |
|---|---|---|---|---|
| 0 | Can we build and measure here? | .NET SDK, solution skeleton, TypeScript fixture exporter, result schema | SDK cannot be installed | Container |
| 1 | Is there a speed-up? | The hottest kernel in C#, benchmarked against the TypeScript on the same data, 1 to 4 threads | All-core C# is under 1.5× the TypeScript on desktop, or under 2.0× on the phone | Container, then phone |
| 2 | Can pictures cross to the WebView? | A test app with three transports and an on-screen measurement page | No transport sustains the rates below on the phone | Build in container, run on phone |
| 3 | Can C# match the TypeScript and ignore thread count? | A vertical slice of the solver, a comparison report, a thread-count test | Any difference across 1, 2, 4, 8 threads, or agreement outside the bars below | Container |
| 4 | Does it work as one app and as a desktop host? | MAUI shell + existing page + C# engine over loopback; ASP.NET Core host speaking protocol 2 | Not standalone in airplane mode, or protocol 2 not met | Build in container, run on phone |
| 5 | Can it replace the current APK? | Size, start-up, memory, origin and saved-data findings, Android API floor | Informational: produces the list the owner decides from | Container + phone |

**Stage 1 detail.** Find the hottest kernel by profiling the TypeScript solver (`node --cpu-prof`) on the Katoomba 6 km fast-tier scenario. Likely candidates are the spread step in `src/fire/spread/FireSpreadModel.ts` (1,991 lines) and `levelSet.ts`, the ember model (2,271 lines) and the atmosphere solver (880 lines); the profile decides. Port the chosen kernel three ways (scalar, `Span<T>` with `Vector<T>`, `Parallel.For` with a fixed partition), and benchmark each against the TypeScript in Node on identical inputs read from fixtures.

**Stage 2 detail.** Synthetic buffers at the real sizes (2.2 MB, 6.5 MB, 16 MB; measured in 0.9.0), sent three ways: (a) BlazorWebView JavaScript interop with a byte array; (b) HybridWebView raw messages; (c) a loopback WebSocket from an in-app Kestrel server speaking the existing binary codec. Baseline: today's worker `postMessage` with a transferred `ArrayBuffer`. Proposed rates: 2.2 MB pictures at 4 per second and 16 MB pictures at 1 per second, sustained for 60 s, with no main-thread task over 50 ms and at most 8 ms of main-thread time per picture. Also record memory in the WebView and the .NET process, garbage-collection pauses, and dropped frames of a running Three.js scene.

**Stage 3 detail.**
- *3a, TypeScript only (before any porting):* produce fixtures for Katoomba 3 km, fast tier, seed 11, a 310 m ignition line, pictures every 60 s to 1,800 s; and measure how different the TypeScript tiers are from each other on the same scenario. That difference is the yardstick for "close enough".
- *3b, dependency map:* read the code and decide the slice. The aim is the smallest port that runs a fire: decode the start message, the grid and spread step, fuel and moisture, embers if the fast tier needs them. If the atmosphere is the blocker, the slice may take the TypeScript's own wind rasters as input and defer the atmosphere port; the report then says so.
- *3c to 3e, the port,* split by area.
- Agreement bars (proposed): thread-count results bit-identical; versus the TypeScript, at most 1% of ever-burning cells differ in burnt status, burnt area within 2%, median arrival-time difference of cells burning in both within 30 s, and every one of these no worse than the TypeScript's own tier-to-tier difference from 3a. Bit-identical hashes with the TypeScript are *not* expected (V8 and .NET differ in the last bit of exp, pow and sin) and are not the bar.
- Also checked: `Float32` storage with double arithmetic, no fused multiply-add contraction, and reductions in a fixed order.

**Stage 4 detail.** The existing page (TypeScript screens, Three.js map) in a MAUI shell, with the C# engine replacing the Node host and speaking protocol 2 over loopback, so the page needs no change. A 10-minute run at 60× in airplane mode: no crash, picture cadence held, memory within a stated budget. Then an ASP.NET Core host with the same engine, checked with a variant of `e2e/desktop-real.spec.ts`, the cross-origin and hostile-name specs, and the throttled-link tool. Loopback exposure on a phone (other apps can reach 127.0.0.1) is measured and written up, against the interop route that opens no socket.

**Stage 5 detail.** Origin and saved data: the app's saved sites and runs live in the WebView origin, `https://localhost` under Capacitor (kept on purpose in 0.8.0). A MAUI shell serves from a different origin. Test what survives an install over the current APK and what a migration would take. Also: APK size against 33 MB, cold start, resident memory, CoreCLR against the experimental NativeAOT on Android, Android 7.0 (API 24) floor.

## 4. Agents, scopes and order

Every build agent is **Sonnet 5.5 at high effort** (`model: sonnet`, `effort: high`), in its own git worktree, scoped to its own subfolder of `prototypes/dotnet-b/`, never pushing, never touching the app source. Three agents at most at once. The orchestrator commits the contract first, scope-checks each diff, merges with `--no-ff`, and runs the gates.

| Agent | Stage | Scope (folder) | Deliverable |
|---|---|---|---|
| **S0** setup | 0 | `prototypes/dotnet-b/` skeleton, `ts-export/` | SDK install notes, solution and project skeletons (`Fs.Kernel`, `Fs.Bench`, `Fs.Compare`, `Fs.Transport`, `Fs.Host`), the fixture exporter, the result JSON schema, a README |
| **K1** kernel | 1 | `Fs.Kernel`, `Fs.Bench` | Profile of the TypeScript, the ported kernel in three forms, desktop benchmark results, a minimal Android benchmark app for the phone |
| **T2** transport | 2 | `Fs.Transport` | MAUI test app with the three transports and the measurement page, built to an APK if the Android build works here, plus the JavaScript side and a results export |
| **P3a** reference | 3a | `ts-export/`, `reports/` | Fixtures and the TypeScript tier-to-tier difference report |
| **P3b** slice map | 3b | `reports/` | The dependency map, the slice definition, the order of porting |
| **P3c-e** port | 3 | `Fs.Kernel` (split by area) | The C# slice and its tests: decoding, spread, moisture and embers, atmosphere only if the slice needs it |
| **C3** comparison | 3 | `Fs.Compare` | Comparison against the fixtures, the thread-count test, a report against the bars |
| **I4** integration | 4 | `Fs.Transport`, `Fs.Host` | The shell with loopback engine, the ASP.NET Core host, the conformance runs |
| **R5** continuity | 5 | `reports/` | The origin, data, size and start-up findings |
| **V** verifier | all | read-only, `reports/` | An independent re-run of one number per stage and a list of anything overstated |

**Order.** S0 first. Then K1 and P3a in parallel with T2 (three agents). Gate 1 and Gate 2 are decided together from K1 and T2. If both pass, P3b, then P3c-e and C3, then Gate 3. Then I4, then R5, then V, then the report.

## 5. What needs the owner's phone

- Install the benchmark and transport APKs (debug builds, sideload) and run their screens. Each screen shows its numbers and has a "copy results" button; paste them back.
- Say which phone and Android version. A mid-range phone is more telling than a flagship.
- The MAUI Android build in this container is not guaranteed (it needs the Android SDK and the .NET Android workloads, all downloadable here, but heavy). If it fails, the agents write exact build instructions and the owner builds.

## 6. Deliverables

- `prototypes/dotnet-b/` (code, no fixtures), committed to the designated branch.
- `docs/plans/dotnet-option-b-report.md`: one table per gate (measured, bar, pass or stop, conditions), what was not measured, and a recommendation.
- An updated artifact for the owner to read on the phone.

## 7. What each outcome means

| Result | Meaning |
|---|---|
| Gate 1 fails | No speed argument for B anywhere. Stop. The Node host already gives the desktop its speed. |
| Gate 1 passes, Gate 2 fails | B can only be a desktop-host design (ASP.NET Core). A phone C# solver stops. |
| Gates 1 and 2 pass, Gate 3 fails | A C# solver is not a faithful port as built. The owner decides whether differences are acceptable as a new reference or stops. |
| All pass | B is technically feasible. The remaining cost is the port of the rest of the solver (about 25,000 lines and 15,000 lines of tests by line count), the Razor screens if wanted, and the saved-data migration from stage 5. D34 would then be reopened by the owner. |

## 8. Size and cost

About ten to twelve agent runs if every gate passes, fewer if one fails early. The expensive parts are stage 3 (the port) and any Android build. This is a large use of the weekly budget compared with the earlier lanes; the gates exist so that a failed stage stops it early.

## 9. Revision 1: what the dotnet/skills repository changed (2026-11-12)

The .NET team's skills (https://github.com/dotnet/skills, cloned and read) were applied to the plan. Each agent is told which `SKILL.md` files to read in full before it works; the map is in `prototypes/dotnet-b/SKILLS.md`. Work already started (the TypeScript profile, the fixtures, the toolchain download) was kept: the changes are in method, not scope.

| Skill | What it changed |
|---|---|
| `dotnet-diag/microbenchmarking` | All C# timings use **BenchmarkDotNet**, not a home-made harness: `dotnet add package BenchmarkDotNet` without a version, `--job Dry` then `Short` while developing and the default job for final numbers, a marked baseline, `[GlobalSetup]` to load fixtures, results returned so nothing is optimised away, output redirected to a file. The TypeScript side stays a Node harness (it cannot be in BenchmarkDotNet) and the two are compared on identical inputs. |
| `dotnet-advanced/vectorization` | Name the framework APIs considered first (`Span`, `TensorPrimitives`), start explicit SIMD at `Vector128<T>`, keep the scalar contract, test each width and the scalar path in separate processes (`DOTNET_EnableHWIntrinsic=0`, `DOTNET_EnableAVX2=0`), cover every tail length. A narrow-band, branchy spread kernel may not vectorise: that is a valid stage 1 result, and `Vector<T>` is not the default because its width varies. |
| `dotnet-diag/analyzing-dotnet-performance` | The C# port is scanned for allocation, LINQ and collection anti-patterns before benchmarking. |
| `dotnet-maui/dotnet-maui-doctor` | **Only Microsoft OpenJDK is supported** (the system Java is not used), its version taken from the workload's `WorkloadDependencies.json`; requirements (Android SDK packages, build tools, API level) are discovered from NuGet, not hard-coded; on Linux the workloads are `maui-android` and `android` (the `maui` meta-workload does not exist there); install them with the local `dotnet` and an explicit `--version`, never `workload update` or `repair`; `JAVA_HOME` is not set (tools auto-detect), unless this sandbox's non-standard path forces a documented property; finish with `dotnet new maui` and a build. |
| `dotnet/setup-local-sdk` | `global.json` pins the SDK (11.0.100, roll forward to the latest feature band). The skill's own route runs the downloaded install script, which this environment refuses; the checksummed official tarball is used instead and the difference is recorded. |
| `dotnet-blazor/use-js-interop` | The BlazorWebView transport follows the skill: collocated `.razor.js` modules with `export`, interop only in `OnAfterRenderAsync` or event handlers, one typed wrapper class with constants, `IAsyncDisposable` catching `JSDisconnectedException`, `DotNetObjectReference` disposed, public `[JSInvokable]` methods, and one coarse call per picture rather than many fine ones. |
| `dotnet-aspnetcore/dotnet-webapi` | The ASP.NET Core desktop host (stage 4) follows its endpoint, error-handling and OpenAPI conventions for the HTTP side; the WebSocket engine link is the existing protocol. |
| `dotnet-test` (`scaffold-dotnet-test-project`, `code-testing`, `run-tests`, `test-anti-patterns`, `assertion-quality`) | Stage 3 gets a real test project, `Fs.Tests` (MSTest on Microsoft.Testing.Platform), wired into the solution, for the thread-count test and the contract tests; `Fs.Compare` stays the fixture comparison tool. Test commands are chosen with the `run-tests` skill. |
| `dotnet-msbuild/directory-build-organization`, `dotnet-nuget/convert-to-cpm` | `Directory.Build.props` is already shared. Central package management is deliberately not adopted yet: each package belongs to one project, so there is no repeated version to centralise. |

**Not applied.** The skills are written as Claude Code or Copilot plugins (`/plugin marketplace add dotnet/skills`). This session cannot install plugins, so the `SKILL.md` files are read directly from the clone and given to the agents by path. The `dotnet11` plugin (System.Text.Json and Process API changes) and the `dotnet-ai` plugin do not touch this prototype.

## 10. Revision 2: what stage 3a found (2026-11-12)

Stage 3a (the TypeScript reference, agent P3a, merged as `095caf9`) delivered 41 fixture folders and the yardstick. Full tables: `prototypes/dotnet-b/reports/3a-tier-difference.md`. What it changes in this plan:

1. **A correction to what I said earlier.** I said last-bit differences in exp, pow and sin between JavaScript and .NET would change the stored hashes. P3a perturbed the wind and temperature by 1e-15 relative (about 4.5 ulp): no float32 arrival value moved in 8 runs, and at 1e-9 the largest change was 1.2 ms. So last-bit math differences are not the risk. **The risk is the ember model's random stream and its draw order.**
2. **What drives the noise.** Over six fast-tier seeds, 1800 s pairs differ by 20 to 50 % of ever-burning cells and burnt area has a coefficient of variation of 19 %. With embers off the seed-to-seed floor is 0 to 1.9 %. Seed 11 starts no effective spot fire, so it equals the no-embers run; seeds 12 and 13 exercise the ember code.
3. **The fast tier is a different model.** Fast against standard differs by 34 % of cells with a median arrival-time difference of 204 s. Standard against high (30 m grid) differs by 6.7 % with a median of 11.5 s. A C# port must be compared with the TypeScript of the **same tier**; the fast tier against the standard tier misses every bar by construction.
4. **The high tier uses 20 m cells** up to 6 km, not 30 m; a reader must take the grid from the file.

**Agreement bars for stage 3, replacing the proposal in section 3** (same tier, same seed, 900 s and 1800 s):

| Case | Bars |
|---|---|
| Embers off, any random stream | at most 2.5 % of ever-burning cells differ, burnt area within 2.5 %, median arrival difference at most 30 s, 95th percentile at most 60 s |
| Embers on, TypeScript random generator and draw order ported exactly | the original bars: 1 %, 2 %, 30 s median (expected difference about 0) |
| Embers on, a different random stream | no per-seed bar; the mean burnt area over 30 seeds within 12 % of the TypeScript mean |

**Decision taken for stage 3.** The slice ports the TypeScript random generator and its draw order exactly, so that the tight column applies. If the generator cannot be reproduced bit for bit, the loose ensemble bar applies and the report says so.

**Still to run** (not done by P3a): 30-seed TypeScript ensembles, standard and high at 6 km, and timings on a quiet machine.
