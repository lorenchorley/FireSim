# Prototype plan: option B, the solver in C# on .NET 11 (2026-11-12)

> **Superseded (2026-11-12) by `dotnet-option-b-plan.md` (revision 4), the plan to run; it applies the owner's answers to stage 0 and two independent reviews.** This file is kept as the record.
>
> **Read section 11 first.** Revision 3 (after a red team of seven review teams and ten verifiers) adds a stage 0, rebuilds Gates 1 and 2, changes the Gate 3 evidence and replaces sections 5 and 7 where they differ. Sections 1 to 10 are kept as the record; statements found wrong are listed in 11.1.

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

## 11. Revision 3: what the red team changed (2026-11-12)

Seven isolated review teams attacked this plan, the artifact and the premise behind both. They returned 55 findings, which were merged into 35. Each of the 35 was then checked by two independent verifiers, one Sonnet and one Opus. Planted true and false claims were mixed in to calibrate the verifiers. Method, tallies and every report: `docs/plans/dotnet-option-b-redteam.md` and `docs/plans/redteam/`. No finding was refuted outright, many were narrowed, and several factual errors in sections 3, 5 and 10 were found. Where this section differs from sections 3 to 7, this section applies.

### 11.1 Statements above that were wrong

| Where | Said | What is true | Finding |
|---|---|---|---|
| §2 | KVM "not checked" | There is no `/dev/kvm`: no emulator in this container | T-4 |
| §3 stage 2 | "real sizes (2.2 MB, 6.5 MB, 16 MB; measured in 0.9.0)" | Phone pictures at 30 m are about 0.7, 2.2 and 4.3 to 5.4 MB (3, 6 and 9 km). 6.5 MB is the one-off scenario message, not a picture. 16 MB is a 10 m picture from a synthetic scenario, and 10 m exists only at the desktop detail setting | G-10, S-8 |
| §3 stage 2 (c), stage 4 | "an in-app Kestrel server" | .NET 11 ships no ASP.NET Core runtime pack for Android (`RuntimePackExcludedRuntimeIdentifiers="android;linux-bionic"`, NuGet 404, dotnet/aspnetcore#35077 open). An in-app server must use `HttpListener` (present in the Android runtime pack, untested on a phone) or `TcpListener` with `WebSocket.CreateFromStream` | T-2 |
| §5 | "debug builds, sideload" | A Debug build runs unoptimised JIT code with no ReadyToRun, and its assemblies are not inside the APK (Fast Deployment), so a sideloaded Debug APK may not even start. Every APK whose numbers feed a gate is a Release build signed with the debug key | G-9 |
| §7 | "about 25,000 lines and 15,000 lines of tests" | That counts five folders. The runtime import closure from `src/sim/host.ts` is 37,727 non-test lines in 117 files (an upper bound: comments and blanks included) with 10,700 to 28,900 test lines depending on what is counted (the Vitest code does not carry over; its scenarios and expected values do, as golden data). Stage 4's page also needs rewind, checkpoints, records, insights and explain, which the slice omits, so stage 4 as written would fail by construction | N-9 |
| §10 item 1 | "So last-bit math differences are not the risk" | The 1e-15 runs barely reached the solver. The fire, air and moisture arrays were identical in all 31 snapshots; float32 storage absorbed the perturbation, and only 1 or 2 of about 4,000 ember floats moved. The hashes changed only because they include `stats.weather` and `stats.ffdi`, which echo the input. Noise the size of real V8-against-glibc differences, injected per call on fast seed 13, behaved like this: <br>• 900 s: nothing changed. <br>• 1800 s: burnt status flipped in 3 of 10 runs (at most 0.19 % of cells). <br>• 3600 s: it flipped in 5 or 6 of 10 runs (0.05 to 0.56 %), with an extra spot fire. <br>All of this stayed inside the bars, so the plan's ranking survives: the random stream matters more than libm. But last-bit maths does flip ember outcomes, and the effect grows with time. It is a real, second-order risk, not "about 0" | N-1 |
| Artifact | "the current 33 MB APK" | 33 MB is the budget (D37). The 0.8.0 APK is 30,417,340 bytes | S-8 |

### 11.2 New stage 0: the premise, the owner and the preconditions

Nothing below stage 0 starts until it is done. It costs about 15 minutes of the owner's time and very little agent time.

- **0a, three questions for the owner, in one message.**
  1. What do you want .NET for: a faster solver on the phone, .NET or C# as the language of the screens, one codebase, skills, or something else? (P-4)
  2. If the solver moves to C#, what runs the app with no .NET process: in a desktop browser and as a PWA, in the page a phone's browser opens from the desktop host, in "Continue on this device", and in the Node validation suite and the e2e tests? Either they keep the TypeScript solver, which means two solvers (D34's reason), or they are dropped. (P-5)
  3. Will you sideload test APKs and paste the results back within an agreed time, and does this come before or after the 0.9.0 release? (P-8)
- **0b, measure today's app on the owner's phone, with the current APK.**
  - Press *Run the speed test* and copy the result.
  - Read the debug statistics: Auto's decision and its median step.
  - Read the pace on the Standard and Detail tiers at 60x, 120x and 600x playback.
  - Record the phone model, Android version and WebView version.

  The one phone measured so far had 4.8 times headroom on Auto's tier choice. By inference from the 2.35 times phone-to-desktop ratio, its Detail tier may run below the default 60x. Only this measurement can settle that. (P-1)
- **0c, the signing key.** Both APKs on the owner's phone are signed with this container's debug key (`/root/.android/debug.keystore`, certificate SHA-256 `f7570f27…a862e7`). No other copy exists, and Android installs an update only if the certificates match. The key is backed up outside the container (never in this public repository), or the owner chooses a release key. (S-5)
  - Prototype APKs for stages 1, 2 and 4 use a separate application id (`au.firesim.proto`), so they cannot replace the owner's app or block 0.9.0 (versionCode 13) from installing.
  - Only stage 5's install-over test uses `au.firesim.app`, the saved key and a versionCode the owner agrees to, and only after the owner's saved data is exported.
  - This separation was added by the orchestrator, not by a review team.
- **0d, the build precondition.** At least 15 GB free and a Release APK built here and checked (`aapt2 dump badging`, `apksigner verify`). Otherwise the agents deliver source and an exact recipe for the owner to build. (T-4)
  - `TOOLCHAIN.md` records every version, URL, hash and licence accepted.
  - `env.sh` loses its hard-coded scratchpad path.
  - Package versions are locked. (S-7)
- **Stop rules.**
  - The owner's goal is not speed, and 0b shows the 3-D tiers keep the default playback speed: stop the solver port. If a .NET shell is wanted, run only stage 4-0 (below).
  - The owner will not run phone stages in the agreed time: the phone gates are *undecided*. Container stages may run, and nothing is reported as a pass.

### 11.3 Gate 1, rebuilt (was: all-core C# against one-thread TypeScript)

The old gate compared C# on all cores with TypeScript on one thread. Plan 15e's own Amdahl bounds (1.8 to 2.6 times on 4 cores) mean threads alone could pass it, and D34 already allows those threads in TypeScript. The old gate also measured one fast-tier kernel, while the app's default (Auto) builds the Standard tier, where the air takes about 61 to 69 % of the time. On the phone it had no TypeScript number to divide by. (G-1, G-2, G-4, G-5)

- **What is ported.**
  - The frozen speed-test kernel K1 (`src/ui/speedTestKernels.ts`). Its checksum `0x7d268009` is the first C# test, and it gives a same-phone baseline.
  - The hottest kernel of the tier the owner's phone runs: likely the air (`EllipticSolver.relax`, `gradient`, `divergence`, `dynamics.advect`) for Standard, and the level set for the fast tier.
- **A kernel counts only if all three hold** (G-6):
  - its outputs equal the TypeScript's bit for bit, which is possible where it uses only + − × ÷ and `sqrt`;
  - its results are identical on 1, 2, 4 and 8 threads;
  - its timing includes any random draws, in the TypeScript order. Faithful draw order keeps the ember and spread-breach code serial, which caps the fast tier near 1.3 times on 4 cores.
- **What is reported**, every time:
  - C# on one thread against TypeScript on one thread;
  - C#'s scaling curve over 1 to 8 threads;
  - all-core C# against TypeScript in Node `worker_threads` on the same partition;
  - the projected whole-step gain from the profile's phase shares (Amdahl), written beside each kernel ratio.
- **Bar (proposal).** The projected whole-step gain is at least 1.5 times the *best* TypeScript arm, on the desktop and on the phone.
- **Phone protocol** (G-7, G-9). One Release APK (`au.firesim.proto`) holds the C# kernels and the same TypeScript kernels running in a WebView worker.
  - Charge above 50 %, airplane mode, 5 minutes of cool-down.
  - Run A B B A three times: 30 s of warm-up and 60 s timed per run, then one sustained 10-minute run per engine.
  - Log the thermal headroom every 10 s (no more often).
  - Record the SoC's core types and a curve per thread count.
  - Split the work into many fixed chunks assigned dynamically. Determinism comes from fixed chunk boundaries and a fixed reduction order, not from a fixed thread assignment, so a big/little phone does not wait on its slowest core.
  - One *Copy* button produces one text block.
- **The status quo arm** (P-6). The same APK reports `crossOriginIsolated` and SharedArrayBuffer in its WebView, using the cross-origin-isolation allowlist that androidx.webkit 1.18.0 (2026-10-21) adds. If shared memory is available, TypeScript on several workers is measured as a further arm.

### 11.4 Gate 2, rebuilt

- **Five routes, not three** (T-1). Gate 2 stops only if none passes.
  - (a) BlazorWebView interop and (b) HybridWebView raw messages are baselines. Both carry bytes as a string that the page decodes on its main thread: the shipped `blazor.webview.js` uses `atob` and a per-byte loop, measured here at about 90 to 130 ms per 16 MB.
  - (c) A loopback WebSocket, served by `HttpListener` or `TcpListener` (11.1).
  - (d) A `fetch()` on the app's origin, answered through `WebResourceRequested` with a stream.
  - (e) AndroidX `WebMessageCompat(byte[])` ArrayBuffer messages (`WEB_MESSAGE_ARRAY_BUFFER`).
- **Main-thread time** includes the page's own decode.
- **Rates come from the phone, not from a list** (G-10).
  - The rate is the stage 1 solver speed divided by the display step (10 s and 60 s), at 0.7, 2.2 and about 5 MB, capped at 25 per second.
  - 16 MB is tested only for the desktop host.
- **Under load.** Every route is measured while the solver's load is present: a busy loop on N and on N − 1 cores.
- **Target SDK** (T-8). Every result records it.
  - The .NET 11 Android workload compiles against API 37, while the current app targets 36.
  - On Android 17, an app targeting 37 needs `ACCESS_LOCAL_NETWORK` for the Wi-Fi desktop link. Whether 127.0.0.1 counts is undocumented.
  - Routes (c) to (e) are built at 36 and at 37.

### 11.5 Gate 3, changes

- **Seeds** (N-6). Seed 11 starts no effective spot fire: its burnt area equals the embers-off run. Ember code still runs (572 embers in flight at 1800 s), but an ember-ignition error would not show. Gate 3 runs seeds 12, 13 and 14, and the thread-count test requires seed 13.
- **Horizons** (N-7). Gate 3 compares at 900 s and 1800 s on one 3 km scenario, while the validation suite runs 6 h and libm-sized noise first matters between 1800 s and 3600 s (N-1). Gate 3 adds two cases, each compared at 1, 2 and 4 h with the time of first divergence reported per seed:
  - a 4 h Katoomba 6 km run with the wind change, at seeds 12 and 13;
  - one run on a second site.
- **Maths** (N-1, N-2). .NET's `Math` calls the platform C library and may differ between operating systems. V8 12.4 (Node 22) uses its own fdlibm port, and V8 15.1 and later forward to LLVM libc, so the TypeScript reference itself changes across V8 versions.
  - Measured per-call mismatch of V8 12.4 against glibc 2.39: exp 9.7 %, pow 9.8 %, atan2 17.6 %, cbrt 47.8 %, sin and cos 3.3 %.
  - Every transcendental call in the port goes through one `FsMath` class. That makes a managed fdlibm port (the blind team's proposal) a one-file change if the bars fail. It also makes C# on the phone and C# on the desktop agree bit for bit.
  - Stage 4 adds one numeric check: C# on the phone, C# in the container, and TypeScript in the phone's WebView, on the same fixture.
- **Porting conventions, each with one test** (N-4). Applied by every port agent:
  - read float32 arrays into double locals;
  - a JavaScript-style round (halves up);
  - stable sorts or explicit tie-breaks, with NaN sorted last as typed arrays do;
  - insertion-ordered maps, where delete-then-set moves a key to the end (`src/sim/simulation.ts:1668`);
  - ordinal string comparison;
  - saturating casts checked.
  - These conventions matter beyond tidiness: a sort, map or rounding mismatch in the ember or records code changes the draw order, and that would push Gate 3 onto the weak fallback bar for a fixable bug. About four of the eight differences were shown to reach the solver. NaN ordering, `**` edge cases and saturating casts were not, and they are kept as cheap checks.
- **Bars.** The exact-port row's "expected difference about 0" is withdrawn. Before porting, a noise-injection control is run on the TypeScript at each gate horizon (900 s to 4 h; more seeds, three tiers). Each C# result is reported beside that noise floor. The bars stay where they are unless the control comes near them.
  - The 30-seed ensemble bar for a different random stream stays a last resort only. With a 19 to 27 % seed-to-seed variation it fails a correct port 1 to 9 % of the time, and passes a 10 % bias 61 to 66 % of the time (N-5).
- **Rule 4** (N-10). Bit-identical across thread counts *with the tier pinned explicitly*. Tier `auto` chooses from wall-clock timing, so a faster engine may choose differently.

### 11.6 Stage 4, changes

- **4-0, new, if the owner's goal includes a .NET shell** (P-4). The current app runs unchanged inside a MAUI HybridWebView: its TypeScript worker, no C#. The stage includes the origin and saved-data check. This is the route the artifact itself recommended, and no stage tested it.
- **Strike "the page needs no change"** (T-5). The page depends on Capacitor's native bridge in at least these places:
  - `CapacitorHttp`, which reaches services without CORS, including the canopy-height service;
  - Preferences, which falls back to localStorage;
  - Geolocation: MAUI's default `WebChromeClient` has no permission handler;
  - the desktop link's address shown only when `Capacitor.isNativePlatform()`;
  - the mixed-content setting the desktop link needs.

  Stage 4 writes a parity table with each one's MAUI replacement, and tests with Capacitor absent.
- **New rule 7, host parity** (S-1). Every refusal the Node host makes, the C# host makes.
  - The committed `Fs.Host` is the `dotnet new web` template. ASP.NET Core allows every WebSocket origin by default and has no pong timeout. The three Playwright specs named in §3 cover about 8 of the Node host's roughly 26 guards.
  - A protocol-level conformance suite runs against both hosts.
  - The C# host sets explicit allowed hosts, origins, keep-alive timeout, frame and decoder limits, and a memory bound.
- **A loopback link on the phone** (S-2). Every app on the phone connects from 127.0.0.1, so the Node host's per-address limits become global: five wrong hellos from any app lock the page out for 60 s. A fixed port can also be taken first by another app. If route (c) is kept, stage 4 adds:
  - a per-launch port;
  - a per-launch 128-bit secret passed over interop, not typed;
  - limits per connection or per secret;
  - a co-resident attacker test with a second test app.

  An Origin check stops only browser pages; a native app can forge it.
- **Lifecycle** (S-4). Android freezes cached apps about 10 s after they are cached and closes their TCP sockets once all their processes are frozen. Protocol 2 closes a link silent for 60 s and does not reconnect. Stage 4 therefore tests:
  - backgrounding for 30 s, 90 s and 5 minutes;
  - a process kill;
  - a 30-minute sustained run with thermal logging, for both engines.

  Whether to use a foreground service or a resumable protocol is the owner's decision, because of Play policy.
- **Scope** (N-9). The stage 4 page drives a slice without rewind, checkpoints, records, insights or explain, unless a stage 3f ports them. The desktop-host specs that need those features are listed as not run.

### 11.7 Stage 5, changes

- **The origin result is known in advance** (T-6).
  - HybridWebView serves from `https://0.0.0.1/`.
  - BlazorWebView serves from `https://0.0.0.1/` by default, or `0.0.0.0` with a switch.
  - The current app serves from `https://localhost`.

  Web storage is per origin, so a MAUI page cannot see the saved sites and runs. The exception would be a shell that serves `https://localhost` itself, for example a plain WebView with AndroidX `WebViewAssetLoader`; that is untested.
- **Stage 5 designs the migration.**
  - a last Capacitor release with export and import;
  - a native read of the `CapacitorStorage` preferences file, which is possible because an install-over keeps the same app user id.

  It then tests the migration once, with the key from 0c, `au.firesim.app` and a versionCode above the installed one (12 today, 13 after 0.9.0).
- **The WebView floor.** The current app refuses WebView versions below Chrome 108, and a MAUI shell has no such check. Stage 5 adds one (T-8).
- **Risks to record** (S-8).
  - MAUI 11 support ends on 2028-05-09, while the .NET 11 runtime is supported to 2028-11-14.
  - CoreCLR on Android is new in .NET 11. Microsoft reported start-up and size increases on larger apps.
  - dotnet/runtime#131370 (frame drops from the Java GC bridge, absent on Mono) is open, with its milestone moved to 12.0.0.
  - Mono is still reachable: the GA packs map `UseMonoRuntime=true` to MonoVM, and the .NET blog says the opt-out lasts through .NET 11 servicing. Microsoft Learn says Mono is not supported for MAUI apps that target .NET 11. Stage 5 measures Mono only if CoreCLR fails.

### 11.8 What each outcome means (replaces section 7)

| Result | Meaning |
|---|---|
| Stage 0: the goal is not speed, and the phone keeps the default playback speed on the 3-D tiers | Stop the solver port. If a .NET shell is wanted, run stage 4-0 only. |
| Phone numbers not returned in the agreed time | The phone gates are undecided. Container stages may run; nothing is called a pass. |
| Gate 1 fails (projected whole-step gain under the bar against the best TypeScript arm) | No speed argument for B. Stop. |
| Gate 1 passes, Gate 2 fails (none of the five routes) | B can only be a desktop-host design. |
| Gate 3 fails | Not a faithful port as built. The owner decides whether to accept a new reference or stop. |
| All pass | B is technically feasible. That alone does not reopen D34, which was decided on the cost of two solvers. Reopening it needs: (1) an answer to question 0a.2 (what runs with no .NET process) and the cost of keeping two solvers in agreement if any path keeps TypeScript; (2) B ahead of the best TypeScript arm on the phone; (3) the cost of revalidating the hashes and the validation suite; (4) the port at about 30,000 to 38,000 lines plus 10,000 to 29,000 test lines, with a stated freeze or drift plan for the TypeScript solver; (5) what the work displaces, starting with the 0.9.0 release. (P-3) |

### 11.9 Order and cost

1. **Stage 0.** The owner answers 0a and runs 0b; the orchestrator does 0c and 0d.
2. **Stages 1 and 2 in one phone APK.** Gates 1 and 2 are measured from one sideload, so each round with the owner yields both numbers. The container work for Gate 1 (the K1 checksum, the kernel and the TypeScript worker arm) can start while the owner answers.
3. **The noise-injection study** (11.5) on the TypeScript, before any stage 3 port.
4. **Stage 3**, then stage 4 (4-0 first if asked), then stage 5, then the verifier and the report.

Compared with section 8, stage 0 adds almost nothing, merging stages 1 and 2 saves a sideload round, and the noise-injection study adds one container run. The rule to stop at a failed gate stands.

### 11.10 What the red team checked and found sound

- The API 24 floor matches Microsoft Learn and the app's own `minSdkVersion`.
- CoreCLR is the default Android runtime and NativeAOT is experimental.
- The .NET 11 Android native libraries are 16 KB page-aligned.
- Comparing like with like (same tier, same seed) is right.
- The random generator (mulberry32) ports bit for bit with `uint` arithmetic.
- 3a's determinism holds: 31 hashes are identical across processes.
- The SDK tarball's SHA-512 matches `releases.json`.
- WebView debugging is enabled only in debug builds, the same as in Capacitor.
- The line counts for the solver folders alone are right.
- The prototype keeps D34 out of the app's code.

### 11.11 Not settled

- **P-1, whether a faster solver changes anything the user sees.** Both verifiers rated it *partly*. No shortfall has been measured, but almost nothing has been measured on a phone. Stage 0b decides it.
- **Mono on Android in .NET 11.** Two review teams said it was removed in Preview 6. One verifier found the GA packs still map `UseMonoRuntime=true` to MonoVM, and the orchestrator confirmed this in the installed packs. Microsoft's pages disagree on whether it is supported. Nothing was built.
- **Whether 127.0.0.1 counts as local network** under Android 17's permission. It is undocumented, and only a device test can tell.
- **Whether WebGPU works in Android WebView.** This rests on a Chromium intent-to-ship. Shared memory in WebView rests on androidx.webkit 1.18.0, which the app (1.14.0) does not use yet.
