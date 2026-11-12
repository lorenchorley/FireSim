# Option B: executable prototype plan (revision 4, 2026-11-12)

**This document replaces `dotnet-option-b-prototype.md` as the plan to run.** That file stays as the record of revisions 1 to 3 and the red team. Everything here is self-contained: a builder agent reads this file, its task card and the files the card names, and nothing else.

**The question.** Can **one C# solver** run FireSim everywhere it runs today, *natively* where there is a .NET process (a MAUI app on Android, a desktop host) and *as WebAssembly* where there is only a browser (a desktop browser or PWA, a phone's browser, "Continue on this device"), while keeping the results faithful and making the app no slower, and ideally faster?

**What this is not.** It does not change the app, `src/`, `desktop/`, `android/` or any release. Decision D34 (one solver, in TypeScript) stays in force until the owner decides after the report (T7.3). No Razor screens are built; their cost is estimated only (T6.4). Nothing here is a pull request.

---

## 1. What the owner decided (2026-11-12)

| # | Question | Answer | What it changes |
|---|---|---|---|
| O-1 | What is .NET for? | Speed, **unified code**, the **same stack as the company's other products**, and more **deployment and delivery options** | Speed alone no longer decides. The old stop rule "the goal is not speed and the phone keeps up" is withdrawn. The aim is one C# solver that replaces the TypeScript one, not a second solver beside it. |
| O-2 | What runs where there is no .NET process? | **.NET everywhere, including WebAssembly in the browser** | A new gate, **Gate 1W**: the C# solver compiled to WebAssembly must run in a browser worker at a speed close to today's TypeScript in the same browser. If it cannot, "one solver" fails for the browser paths, and the owner chooses between a slower browser, two solvers, or stopping (8). |
| O-3 | Test APKs | Each test APK is **labelled as a test**, **runs and sends its numbers back by itself**, and **says on screen when it is done and that it can be uninstalled** | Every phone round is one self-running test APK with a results channel (T0.6) and a done screen with an uninstall button (5). No copy and paste. |
| O-4 | Before or after 0.9.0? | Not answered | Default until the owner says otherwise: the prototype never touches the app, uses its own application ids, and does not delay 0.9.0. Its container work can run alongside the 0.9.0 release work; phone rounds are scheduled with the owner. |

Still open for the owner, none blocking phase 0 or 1: the signing key (T0.3), the results channel's endpoint if a fully automatic one is wanted (T0.6), and the bars in 4, which are proposals.

---

## 2. Rules for every task

1. **Scope.** Prototype code lives only under `prototypes/dotnet-b/`. The app's TypeScript is read, never edited. `tsconfig.json` and the Vitest config do not include that folder. Fixtures are generated, never committed (megabytes); their exporters are committed.
2. **Builders.** Every build task is run by a **Sonnet 5.5 agent at high effort** (the owner's instruction), in its own git worktree, touching only the folders its card names, never pushing. At most three builders at once. The orchestrator scope-checks each diff, merges with `--no-ff` and pushes to `claude/3d-fire-simulation-app-xoy1o6`.
3. **Skills.** Each card names the dotnet/skills `SKILL.md` files to read in full first (map: `prototypes/dotnet-b/SKILLS.md`; key rules in 9).
4. **Numbers carry conditions**: machine, cores, runtime version, runs, median and spread. Container numbers are *indicative* (4 shared cores). Phone numbers come only from a phone, from a **Release** build.
5. **Determinism is a requirement, not a tolerance.** With the tier pinned explicitly (never `auto`, which picks from wall-clock timing), the C# solver gives bit-identical results on 1, 2, 4 and 8 threads, and (from phase 3) bit-identical results on every runtime: native x64, native arm64 and WebAssembly.
6. **Nothing is called a pass that was not run.** A task that cannot run here says what it needs.
7. **Stop at a failed gate.** The orchestrator reports the gate and waits for the owner.
8. **Host parity.** Every refusal the Node desktop host makes, a C# host makes (T5.3).
9. **Heavy work** (Android or WebAssembly builds, benchmarks, anything over a minute) runs under `flock /tmp/firesim-heavy.lock`.
10. **Security.** No signing key, private key, token or secret is ever committed (fingerprints only). Downloaded install scripts are never run; SDKs come from checksummed official archives or NuGet. No test APK contains a secret.
11. **Results files.** Every measurement is also written as JSON (`prototypes/dotnet-b/reports/RESULTS-SCHEMA.md`), extended in T0.5 with `runtime` (`coreclr`, `mono`, `wasm-aot`, `wasm-interp`, `v8`) and `build` (`Release`, the commit and the APK's SHA-256).

---

## 3. Where things stand (checked 2026-11-12)

| Item | State |
|---|---|
| .NET SDK | 11.0.100, installed from the checksummed official tarball in the scratchpad (`env.sh`). Android workloads and packs for API 37 (CoreCLR, Mono, NativeAOT) installed. **No WebAssembly workload installed yet** (`wasm-tools`): T0.4. |
| Android build | A MAUI template **Debug** build compiled here. **No Release APK has been built or installed yet** (T0.5). No `/dev/kvm`, so no emulator: every phone number needs the owner's phone. |
| Disk | **8 GB free**; Android and WebAssembly builds need about 15 GB. 55 agent worktrees take 7.2 GB (T0.2). |
| Committed prototype | `prototypes/dotnet-b/`: solution skeleton, `ts-export/` (fixture exporter), 3a reports (the TypeScript yardstick, 41 fixture folders in the scratchpad). |
| Stopped work, not committed | K1 (worktree `agent-afd949a55c8e205d1`): a C# port and BenchmarkDotNet bench of `PyrogenicPotential.solve`, with desktop numbers. T2 (worktree `agent-af4301a383218d8d9`): the start of the MAUI transport test app. Both are salvaged in T0.7. |
| Signing | The installed FireSim app (0.8.0, versionCode 12) is signed with this container's debug key, SHA-256 `f7570f27…a862e7`. No other copy exists (T0.3). |
| App facts the plan leans on | Speed-test kernel `src/ui/speedTestKernels.ts` (checksum `0x7d268009`); random generator mulberry32 (`src/core/rng.ts`); the Node desktop host `desktop/`; validation tests `src/sim/validation/`; e2e specs `e2e/`; "Continue on this device" (`src/ui/desktopHost.ts`). Runtime import closure from `src/sim/host.ts`: 37,727 lines in 117 files. |

---

## 4. Gates

Bars are proposals; the owner can change any bar before its phase starts.

| Gate | Question | Measured where | Bar (proposal) | If it fails |
|---|---|---|---|---|
| **1** native speed | Is native C# faster than the best TypeScript? | Container, then phone (round 1) | Projected whole-step gain ≥ 1.5× the **best** TypeScript arm (one worker, or several workers where shared memory exists), on the desktop and on the phone | No speed case. Unified code and same stack can still justify the port; the owner decides whether to continue (8). |
| **1W** browser speed | Is C# as WebAssembly close to today's TypeScript in the same browser engine? | Container (Chromium), then phone (WebView, round 1) | Whole-step time of C#-WebAssembly (AOT, SIMD, one thread) ≤ 1.25× the TypeScript's, on desktop Chromium and on the phone's WebView; download added ≤ an owner-set budget (reported, proposal 6 MB compressed) | "One solver everywhere" fails for the browser paths. Owner chooses: accept slower browser runs, keep TypeScript in browsers (two solvers), or stop. |
| **2** pictures | Can pictures cross from a native C# solver to the WebView fast enough? | Phone (round 1) | At least one of five routes sustains the phone's own picture rate at 0.7, 2.2 and 5 MB for 60 s, under solver load, with no main-thread task over 50 ms and ≤ 8 ms of main-thread time per picture including the page's decode | Native C# on the phone needs another design (for example C#-WebAssembly inside the WebView, which Gate 1W measures). |
| **3** fidelity | Does the C# slice match the TypeScript, and match itself everywhere? | Container, then phone (round 2) | The agreement bars of 10.3; bit-identical across 1, 2, 4, 8 threads; bit-identical hashes across native x64, native arm64 and WebAssembly | Owner decides: accept the C# as a new reference, fix and re-run, or stop. |
| **4** one app | Does it work as one standalone phone app, in a browser, and as a desktop host? | Phone (round 2), container | 10-minute airplane-mode run without a crash and with the picture cadence held; lifecycle tests pass (T5.5); the browser page runs the C#-WebAssembly engine; the C# desktop host passes the conformance suite | The failing piece is reported with what it would take. |
| **5** continuity | Can it replace the current app? | Container, phone (round 3) | Informational: size, start-up, memory, saved-data migration, WebView floor, deployment matrix | The list the owner decides from. |

---

## 5. The test APKs and the results channel (owner's requirement O-3)

Every phone round is **one** test APK. The owner installs it, opens it, puts the phone down and later uninstalls it. Nothing is copied by hand.

**Labelling.**
- Application id `au.firesim.proto.r<round>` (for example `au.firesim.proto.r1`). It never replaces or touches the real app (`au.firesim.app`), and the real app's updates are never blocked by it.
- Launcher name **"FireSim TEST r1"**; the icon carries a red diagonal **TEST** band; version name `proto-r1+<commit>`.
- The first screen says, in large type: *This is a test build of FireSim. It measures this phone and sends the numbers to the developer. It does not change your FireSim app. It takes about N minutes.*

**Running.**
- The run **starts by itself** when the app opens, after a 10-second countdown with a *Not now* button; the screen stays on (`DeviceDisplay.KeepScreenOn`).
- Before starting, the app checks charge (> 50 % or charging) and thermal status, waits out a 5-minute cool-down if needed, and records the network state. Airplane mode is asked for but not required; the result records which.
- A progress line shows the arm being run and the time left. If the owner leaves the app, the run pauses and the screen says so on return (Android throttles a background WebView), and the pause is recorded.

**Sending.**
- At the end the app sends one JSON document over the results channel (below). If there is no network (airplane mode), it says *Turn the network back on to send the results* and sends as soon as connectivity returns (`Connectivity.ConnectivityChanged`), retrying with back-off.
- The document carries: round, commit, APK SHA-256, device model, SoC, cores and their types, Android and WebView versions, every measurement, thermal and battery log, any error with its stack.
- The app keeps the document on the device until the send is acknowledged, and also offers **Share** (Android share sheet) as a manual fallback.

**Done.**
- The final screen says: *Done. The results were sent at 14:32 (receipt 7F3A). You can uninstall this test app now.* with an **Uninstall** button (`Intent.ActionDelete` on `package:au.firesim.proto.r1`, which needs the `REQUEST_DELETE_PACKAGES` permission in the manifest; Android then shows its own confirmation). If the send failed, it says so and keeps the Share button.

**The results channel** (T0.6 builds it and proves it with round 0 before any real benchmark):
This container accepts no incoming connections, so the numbers must land somewhere it can read. It can read GitHub. The channel therefore ends in a **GitHub issue**, and no GitHub token is ever inside an APK (anyone can unzip an APK; a token there would let anyone write to the repository).

- **Primary, zero taps: a small results endpoint the owner runs.** An Azure Function in C# (the company's stack; a Cloudflare Worker would also do, and both are free at this volume), written here as `Fs.Results/` and deployed by the owner.
  - The app POSTs its JSON (at most 64 KB) over HTTPS with the round's **upload code**: a random value baked into that APK, accepted at most three times, expiring 14 days after the build. A stolen code can submit at most three junk results for one round and nothing else.
  - The function checks the schema and size, then opens an issue labelled `bench-result` using a token it holds on the server (a GitHub App installation or a fine-grained token with *Issues: write* on one repository only). It answers with the issue number, which the done screen shows as the receipt.
  - The orchestrator reads the issue through its GitHub tool. Nothing new is needed in the container.
  - **Where the issues go.** The repository `lorenchorley/firesim` is public, so its issues are public: device model, Android and WebView versions, timings and temperatures, nothing personal. If the owner prefers, the function writes to a private repository (for example `firesim-results`) that this session is then given access to.
  - **Owner setup** (T0.6, about 30 minutes): create the Function app, set two secrets (the GitHub token and the list of upload codes), deploy `Fs.Results/` with the steps in its README.
- **Fallback, one tap, works with no setup: a prefilled GitHub issue.** The done screen's **Send with GitHub** button opens `https://github.com/lorenchorley/firesim/issues/new?title=…&labels=bench-result&body=…` in the phone's browser, with a compact summary (at most 6 KB, because GitHub refuses long addresses). The owner taps *Submit* while signed in to GitHub. The full JSON goes by **Share** (a file through the Android share sheet).
- **Rejected:** a token in the APK (anyone could extract it); public topic services such as ntfy.sh (the topic name is the only password, and it would be in a public APK); paste sites (public and unreliable); a claude.ai artifact database (it accepts writes only from signed-in viewers inside claude.ai).
- **Until the endpoint exists**, rounds use the fallback. Round 0 proves whichever is ready, and the plan does not wait for the endpoint.
- **Permissions in every test APK, and no others:** `INTERNET`, `ACCESS_NETWORK_STATE`, `BATTERY_STATS` (battery level), `REQUEST_DELETE_PACKAGES` (the Uninstall button). If the uninstall screen cannot open, the button opens the app's *App info* page instead (`Settings.ActionApplicationDetailsSettings`).
- **The result is saved before any send**, so a failed send loses nothing; *Send now* and *Share* stay on the done screen until a receipt arrives.

**Rounds** (the owner's time is the install, one tap and the uninstall; the phone runs unattended):

| Round | APK | Owner time | Phone time | Measures | After task |
|---|---|---|---|---|---|
| 0 | `au.firesim.proto.r0` "link check" | 2 min | 1 min | Sideload of a Release MAUI APK works; device facts; WebView version, `crossOriginIsolated`, SharedArrayBuffer, WebAssembly SIMD and threads support; the speed-test kernel in TypeScript in the WebView (a same-phone baseline); the results channel end to end; the uninstall button | T0.6 |
| 1 | `…r1` "speed and pictures" | 3 min | about 25 min | Gates 1, 1W and 2 | T4.4 |
| 2 | `…r2` "one app" | 10 min (it asks the owner to leave and reopen the app at set times) | about 45 min | Gates 3 (on the phone) and 4 | T5.6 |
| 3 | `…r3` "saved data" | 10 min | 5 min | The saved-data migration (Gate 5), on a test id, never on the real app | T6.2 |

---

## 6. The tasks

Format of each card: **who** (builder = Sonnet 5.5 high agent in a worktree; orchestrator = this session; **owner** = you), **needs** (tasks that must be done first), **reads**, **steps**, **done when** (checkable), **out** (files). Paths are relative to `prototypes/dotnet-b/` unless they start with `src/`, `docs/`, `e2e/` or `desktop/`.

### Phase 0: preconditions

#### T0.1 Record the decisions
- **Who:** orchestrator. **Needs:** nothing.
- **Steps:** 1. Add a banner to `docs/plans/dotnet-option-b-prototype.md` pointing here. 2. Commit this plan.
- **Done when:** both files are committed and pushed.

#### T0.2 Free the disk
- **Who:** orchestrator. **Needs:** nothing.
- **Steps:**
  1. For each of the 55 worktrees under `.claude/worktrees/`: list uncommitted changes and commits not reachable from the branch. Keep the four that hold unmerged work (K1, T2, and the two with 0.9.0 verification and wind-detail scouting files) until T0.7 and the 0.9.0 work have taken what they need; remove the rest with `git worktree remove` (never `--force` on one with changes).
  2. Remove from the scratchpad the build outputs that can be regenerated (`bin/`, `obj/`, old APKs that are not the installed 0.8.0, the demo frames), never the SDK, the keystore or the fixtures.
- **Done when:** `df` shows ≥ 15 GB free, and a list of what was removed and kept is in `reports/0-housekeeping.md`.

#### T0.3 The signing key (owner decision)
- **Who:** owner, then orchestrator.
- **Steps:**
  1. **Owner:** choose (a) keep the debug key: the orchestrator sends `/root/.android/debug.keystore` to you privately (a file sent in this conversation, never committed), and you store it somewhere safe; or (b) create a release key now for the real app, and accept that the next real release must be installed after an uninstall (losing saved data unless exported first).
  2. **Orchestrator:** record the choice and the certificate fingerprint in `TOOLCHAIN.md`.
- **Done when:** the key exists outside the container, or the owner has chosen (b). Test APKs are signed with the debug key either way; their ids differ from the real app's, so they never conflict with it.

#### T0.4 Toolchain record and the WebAssembly workload
- **Who:** builder. **Needs:** T0.2. **Reads:** `dotnet/setup-local-sdk`, `dotnet-maui/dotnet-maui-doctor`.
- **Steps:**
  1. Write `TOOLCHAIN.md`: every SDK, workload, pack, JDK and Android SDK package with version, source URL, SHA-256 or SHA-512, and the licences accepted (Android SDK licence).
  2. Make `env.sh` find the SDK from a variable (`FIRESIM_DOTNET_ROOT`, default the current scratchpad path) instead of a hard-coded path.
  3. Install the `wasm-tools` workload with the local `dotnet` and an explicit `--version` matching 11.0.100 (NuGet, no script). Record it.
  4. Lock package versions (`packages.lock.json` with `RestorePackagesWithLockFile`).
  5. Build three hello-world checks: a console app (`net11.0`), a `wasmbrowser` app with `RunAOTCompilation=true`, and the MAUI template for `net11.0-android`.
  6. Build the MAUI template once more with `-p:UseMonoRuntime=true` and record whether NETSDK1242 stops it (it settles revision 3's open Mono question).
- **Done when:** all three build from a clean clone with `source env.sh`, and `TOOLCHAIN.md` lists everything installed.
- **Out:** `TOOLCHAIN.md`, `env.sh`, `global.json`, lock files.

#### T0.5 A Release APK, proven
- **Who:** builder. **Needs:** T0.4. **Reads:** `dotnet-maui/dotnet-maui-doctor`, section 5 of this plan.
- **Steps:**
  1. Create `Fs.TestApp/` (the shared shell for every round): a MAUI app with the labelling, start, progress, send, done and uninstall screens of section 5, and a pluggable list of "arms" (each arm: name, estimated time, `RunAsync(IProgress, CancellationToken)` returning a JSON node).
  2. Build `Release`, `AndroidPackageFormat=apk`, `EmbedAssembliesIntoApk=true`, signed with the debug key, application id from an MSBuild property (`-p:ProtoRound=0`).
  3. Check it: `aapt2 dump badging` (id, label, versionName, targetSdk, permissions), `apksigner verify --print-certs` (fingerprint), size.
  4. Extend `reports/RESULTS-SCHEMA.md` with `runtime` and `build`.
- **Done when:** the APK passes both checks and contains its assemblies (no Fast Deployment).
- **Out:** `Fs.TestApp/`, `reports/0-apk-check.md`.

#### T0.6 The results channel and round 0
- **Who:** orchestrator (channel), builder (round 0 arms), owner (install). **Needs:** T0.5.
- **Steps:**
  1. Write `Fs.Results/` (an Azure Function in C#, isolated worker: one POST endpoint, schema and size check, upload-code check, issue creation with a server-side token, a README with the deploy steps) and its tests. Write the fallback (the prefilled issue link and Share) into `Fs.TestApp`. **Owner, optional:** deploy `Fs.Results/` and say where the issues should go; round 0 does not wait for it.
  2. Round 0 arms: device facts (model, SoC, core types from `/sys/devices/system/cpu/*/cpufreq`, Android and WebView versions); WebView capabilities (`crossOriginIsolated`, `SharedArrayBuffer`, WebAssembly SIMD and threads feature tests, WebGPU adapter); the frozen speed-test kernel in a WebView worker (checksum `0x7d268009` must match).
  3. Send the APK to the owner (a file in this conversation) with three lines of instructions.
  4. **Owner:** install, open, tap Start, wait for "Done", tap Uninstall.
  5. Read the results back and check them against the schema.
- **Done when:** a round-0 document from the owner's phone has been received and read back, its checksum matches, and the uninstall worked.
- **Out:** `reports/r0-phone.json`, `reports/r0-phone.md`.

#### T0.7 Salvage the stopped work
- **Who:** orchestrator. **Needs:** T0.2.
- **Steps:**
  1. K1: review the pyrogenic kernel port and its BenchmarkDotNet bench; merge what follows rule 2 and the skills into `Fs.Kernel/Pyrogenic/` and `Fs.Bench/` as a first data point, marked as "a kernel the gate does not use" (the gate uses T1.2 and T1.3).
  2. T2: move what is reusable (the HybridWebView page host, the bench page) into `Fs.TestApp/` or `Fs.Transport/`.
  3. Remove both worktrees.
- **Done when:** both are merged or dropped with a line in `reports/0-housekeeping.md` saying which.

### Phase 1: profile and the TypeScript references

#### T1.1 Profile every tier
- **Who:** builder. **Needs:** T0.1. **Reads:** `docs/plans/air-slice-wind-detail-honest-speed.md` (15e's Amdahl bounds), `prototypes/dotnet-b/reports/3a-reference.md`.
- **Steps:**
  1. Run the TypeScript solver under `node --cpu-prof` on Katoomba 6 km at the **fast** and **standard** tiers (pinned, seed 13), 1,800 s simulated.
  2. Group self-time by phase: air (`EllipticSolver.relax`, `gradient`, `divergence`, `dynamics.advect`), level set, embers, moisture, picture encoding, other.
  3. Name the hottest kernel per tier and its share of the step.
- **Done when:** a table of phase shares per tier, three runs each, with spread.
- **Out:** `reports/1-profile.md`, `reports/1-profile.json`.

#### T1.2 The speed-test kernel in C#
- **Who:** builder. **Needs:** T0.4. **Reads:** `src/ui/speedTestKernels.ts`, `dotnet-diag/microbenchmarking`, `dotnet-advanced/vectorization`.
- **Steps:**
  1. Port the frozen kernel to `Fs.Kernel/SpeedTest/`. Float32 storage, double arithmetic where the TypeScript does, no fused multiply-add.
  2. First test (`Fs.Tests`): checksum `0x7d268009`.
  3. Bench it with BenchmarkDotNet against the TypeScript in Node on the same input (the Node harness stays outside BenchmarkDotNet).
- **Done when:** the checksum test passes on `linux-x64` and in the `wasmbrowser` build (T1.5), and the bench has numbers.

#### T1.3 The hottest kernel of each tier in C#
- **Who:** builder (one per tier if both are large). **Needs:** T1.1, T1.2. **Reads:** the TypeScript files T1.1 names, `dotnet-advanced/vectorization`, `dotnet-diag/analyzing-dotnet-performance`.
- **Steps:**
  1. Port the kernel three ways: scalar, `Vector128<T>` where it vectorises, and `Parallel.For` over **many fixed chunks assigned dynamically** with a fixed reduction order (determinism from the chunk boundaries, not the thread assignment).
  2. A kernel counts only if: its outputs equal the TypeScript's bit for bit on fixtures (possible where it uses only + − × ÷ and `sqrt`); its results are identical on 1, 2, 4 and 8 threads; any random draws it makes are timed, in the TypeScript order.
  3. Scan for allocation and LINQ anti-patterns before timing.
- **Done when:** the three tests (bits, threads, draws) pass, and the kernel builds for `linux-x64`, `android-arm64` and `browser-wasm`.

#### T1.4 The TypeScript arms
- **Who:** builder. **Needs:** T1.3. **Reads:** the kernels' TypeScript.
- **Steps:**
  1. The kernels in a single Node worker (one thread) and split over Node `worker_threads` with SharedArrayBuffer on the same chunks.
  2. The same kernels bundled for a browser Web Worker (one worker, and several workers when `crossOriginIsolated`), used by T1.5 and by round 1.
- **Done when:** all arms produce the same bits as T1.3's reference outputs.

#### T1.5 The WebAssembly arm
- **Who:** builder. **Needs:** T1.2 for a first run, T1.3 for the full run, T0.4. **Reads:** the research notes in 10.2, `dotnet-blazor/use-js-interop` (the `[JSExport]` parts).
- **Steps:**
  1. Build `Fs.Wasm/`: `Microsoft.NET.Sdk.WebAssembly`, `OutputType=Library` (the shape of the `blazorwebworker` template, without Blazor), the kernels behind `[JSExport]` entry points, published with `RunAOTCompilation=true` (SIMD and exception handling are on by default), trimmed, loaded with `dotnet.create()` from `_framework/dotnet.js` **inside a Web Worker**. Large inputs and outputs cross as `Span<T>` or `ArraySegment<T>` views (no copy; float views are new in .NET 11); a picture leaves the worker as one copy into a transferred `ArrayBuffer`.
  2. Variants: AOT one thread (the gate arm); interpreter one thread (what AOT buys); **multithreaded only as a labelled experiment** (`WasmEnableThreads`, the `wasm-experimental` workload, a cross-origin-isolated page), never a gate arm (10.2).
  3. **Early reading:** as soon as T1.2 is done, run its speed-test kernel through steps 1, 2 and 4 and send the ratio to the owner. It is the plan's riskiest unknown and costs one builder hour.
  4. A harness page that runs the TypeScript worker arm (T1.4) and the WebAssembly arm on the same input in the same browser, A B B A.
  5. Run it in the container's Chromium (Playwright), and the same bits under Node with the `wasmconsole` shape (the future CI path).
  6. Record download size (compressed and not), start-up time to first result, and the cost of moving one 5 MB picture out of the worker.
- **Done when:** checksums and bits match T1.3 in Chromium and Node; numbers for every arm; sizes.
- **Out:** `Fs.Wasm/`, `harness/`, `reports/1w-desktop.md`.

#### T1.6 Desktop gate report
- **Who:** builder. **Needs:** T1.2 to T1.5.
- **Steps:** report, per tier: C# one thread against TypeScript one thread; C#'s curve over 1 to 8 threads; all-core C# against TypeScript `worker_threads` on the same chunks; C#-WebAssembly against the TypeScript worker in Chromium; the projected whole-step gain from the T1.1 shares beside every kernel ratio.
- **Done when:** Gates 1 and 1W have *indicative* desktop results.
- **Out:** `reports/1-desktop.md`, `reports/1-desktop.json`.

### Phase 2: the fidelity yardstick (TypeScript only, can run alongside phase 1)

#### T2.1 The noise floor
- **Who:** builder. **Needs:** T0.1. **Reads:** plan revision 3 §11.1 (the noise results), `ts-export/`.
- **Steps:**
  1. Inject per-call noise of the size of real libm differences into `Math.exp/pow/sin/cos/atan2/cbrt` (a wrapper used only by the exporter, never the app).
  2. Run at 900 s, 1,800 s, 1 h, 2 h and 4 h; seeds 12, 13, 14; three tiers; Katoomba 3 km and 6 km with the wind change; ten noise draws each.
  3. Report the spread of every bar's metric: this is the noise floor each C# result is compared with.
- **Done when:** a noise-floor table per bar, horizon and tier.
- **Out:** `reports/2-noise-floor.md` and `.json`.

#### T2.2 The fixtures for phase 3
- **Who:** builder. **Needs:** T0.2.
- **Steps:** export fixtures for: Katoomba 3 km (seeds 12, 13, 14; 900 s and 1,800 s), Katoomba 6 km with the wind change (seeds 12, 13; 1, 2 and 4 h), and one second site from the bundled demo sites, every tier the gate uses, embers on and off.
- **Done when:** every fixture loads in `ts-export/inspect.mjs`, and its hashes repeat across two processes.
- **Out:** the exporter changes; the fixtures stay in the scratchpad.

#### T2.3 The slice map
- **Who:** builder. **Needs:** T1.1. **Reads:** `src/sim/host.ts` and its imports.
- **Steps:**
  1. The smallest port that runs a fire at the gate's tiers: start-message decode, grid and level set, fuel and moisture, embers and the random generator in the TypeScript draw order, the air if the tier needs it (or the TypeScript's own wind rasters as input, said so).
  2. Every transcendental call site, for `FsMath` (T3.1).
  3. Every place where JavaScript semantics matter (the conventions of 10.4).
  4. An order of porting, split into three areas a builder each can take.
- **Done when:** a list of files and functions with line counts per area.
- **Out:** `reports/2-slice-map.md`.

### Phase 3: the solver slice in C#

#### T3.1 `FsMath`
- **Who:** builder. **Needs:** T2.3.
- **Steps:**
  1. One class through which every transcendental call goes.
  2. Three implementations behind one switch, all managed except the first:
     - the platform `Math`: native .NET calls the operating system's C library (bionic, glibc, UCRT) and WebAssembly calls musl compiled into the runtime, so it can differ between every runtime;
     - a **managed port of fdlibm** using only IEEE basic operations and `Sqrt`: the same bits on every runtime, and the same bits as Node 22's V8 12.4 (an fdlibm port) where the algorithms match;
     - **CoreMathSharp** (MIT, a C# port of CORE-MATH, correctly rounded): the same bits on every runtime by construction, and possibly the same bits as current Chrome, whose V8 15.1+ forwards to LLVM libc (to be measured, not assumed).
  3. Tests: reference values; each implementation on 10⁶ random inputs per function against Node 22's `Math` and against current Chromium's `Math` (count mismatches); speed of each.
  4. Choose the default: the managed implementation with the fewest mismatches against the TypeScript reference that Gate 3 compares with, at an acceptable speed.
- **Done when:** the chosen managed implementation gives identical bits on `linux-x64` and `browser-wasm` (and on `android-arm64` in round 2), and the mismatch and speed table is reported.

#### T3.2 to T3.4 The port, in three areas
- **Who:** three builders, one per area of T2.3. **Needs:** T2.3, T3.1. **Reads:** the slice map, 10.4, `dotnet-test` skills.
- **Steps per area:** port; one unit test per convention of 10.4; contract tests on fixture inputs; no allocation in the step loop.
- **Done when:** the slice runs a fire from a fixture's start message to 1,800 s in `Fs.Tests`, on 1 and 4 threads with identical output.

#### T3.5 Compare
- **Who:** builder. **Needs:** T3.2 to T3.4, T2.1, T2.2.
- **Steps:**
  1. `Fs.Compare` reads each fixture, runs the C# slice and reports every bar of 10.3 beside the noise floor of T2.1, with the time of first divergence per seed.
  2. Thread-count test: seed 13, bit-identical on 1, 2, 4 and 8 threads.
  3. Runtime test: the same fixtures in `browser-wasm` (Chromium or Node), bit-identical hashes with `linux-x64`.
- **Done when:** a report against every bar of Gate 3 with pass or stop.
- **Out:** `reports/3-fidelity.md` and `.json`.

### Phase 4: the phone round for speed and pictures (round 1)

#### T4.1 Picture routes
- **Who:** builder. **Needs:** T0.5, T0.7. **Reads:** `dotnet-blazor/use-js-interop`, the T2 salvage.
- **Steps:** five routes in `Fs.Transport/`, each sending synthetic pictures at 0.7, 2.2 and 5 MB from C# to a Three.js page with a running scene:
  (a) BlazorWebView interop with a byte array; (b) HybridWebView raw messages (both decode on the page's main thread: count it); (c) a loopback WebSocket from `HttpListener` or `TcpListener` with `WebSocket.CreateFromStream` (no Kestrel on Android), per-launch port and secret; (d) `fetch()` on the app's origin answered with a stream through `WebResourceRequested`; (e) AndroidX `WebMessageCompat` with an ArrayBuffer.
  Rates: the phone's solver speed from T4.2's arm divided by the display step (10 s and 60 s), capped at 25 per second, measured idle and under a busy loop on N and N − 1 cores. Built at target SDK 36 and 37.
- **Done when:** all five run in the container's build and report main-thread time including decode, long tasks, dropped frames and memory.

#### T4.2 Round 1 arms
- **Who:** builder. **Needs:** T1.6, T4.1.
- **Steps:** in `Fs.TestApp` round 1:
  1. Native C# kernels (CoreCLR), curve over 1 to 8 threads.
  2. The TypeScript kernels in a WebView worker (one worker; several if `crossOriginIsolated`).
  3. C#-WebAssembly kernels in a WebView worker (AOT; threads if available).
  4. The **whole TypeScript solver** (the app's worker bundle) on a pinned Standard and fast scenario, giving the phone's real step time (this replaces revision 3's manual speed test, 0b).
  5. The five picture routes.
  Protocol: A B B A three times, 30 s warm-up and 60 s timed per run, then 10 minutes sustained per engine, thermal headroom every 10 s, core types recorded.
- **Done when:** the APK passes T0.5's checks and a dry run in the container (the C# arms on `linux-x64`) completes.

#### T4.3 Owner runs round 1
- **Who:** owner. **Needs:** T4.2.
- **Steps:** install `FireSim TEST r1`, open, Start, leave the phone on a table (charging is fine) for about 25 minutes, uninstall when it says Done.

#### T4.4 Gates 1, 1W and 2 decided
- **Who:** orchestrator, then owner. **Needs:** T4.3.
- **Steps:** write the phone columns of `reports/1-desktop.md` into `reports/r1-gates.md`; decide each gate against section 4; **stop and ask the owner** if any fails.

### Phase 5: one app (round 2)

#### T5.1 The current app in a MAUI shell (stage 4-0)
- **Who:** builder. **Needs:** T0.5. **Reads:** `capacitor.config.ts`, `src/` uses of `@capacitor/*`.
- **Steps:**
  1. The app's built web bundle inside a MAUI HybridWebView, with its TypeScript worker, no C#.
  2. A parity table for every Capacitor dependency: `CapacitorHttp` (no-CORS requests, including the canopy-height service), Preferences, Geolocation (MAUI's default `WebChromeClient` has no permission handler), `Capacitor.isNativePlatform()` uses, the mixed-content setting for the desktop link; each with its MAUI replacement, built.
  3. The page runs with Capacitor absent.
- **Done when:** a demo site builds and runs in the shell in the container's build, with every parity row implemented or listed as not done.
- **Out:** `Fs.Shell/`, `reports/5-shell-parity.md`.

#### T5.2 The C# engine in the shell
- **Who:** builder. **Needs:** T5.1, T3.5, T4.4 (the route chosen by Gate 2).
- **Steps:** the C# slice runs natively and sends pictures to the page over the chosen route; the page drives it. The slice has no rewind, checkpoints, records, insights or explain; the page hides them.
- **Done when:** a fire from the fixture start message runs in the shell, and its hashes equal `linux-x64`'s.

#### T5.3 The C# desktop host
- **Who:** builder. **Needs:** T3.5. **Reads:** `desktop/server.ts`, `desktop/security.ts`, `desktop/holdGate.ts`, `desktop/memoryBound.ts`, `dotnet-aspnetcore/dotnet-webapi`.
- **Steps:**
  1. A protocol-level conformance suite (in `Fs.Tests` or Node) run against **both** hosts: every guard of the Node host (about 26), including allowed hosts and origins, keep-alive and pong timeout, frame and decoder limits, the memory bound, per-address limits.
  2. `Fs.Host`: ASP.NET Core with the C# slice, explicit allowed hosts and origins, the timeouts and limits above.
  3. Run `e2e/desktop-real.spec.ts`, `e2e/desktop-cross-origin.spec.ts` and the hostile-name spec against it, listing the specs that need features the slice omits as not run.
- **Done when:** the conformance suite passes on both hosts.
- **Out:** `Fs.Host/`, `reports/5-host-parity.md`.

#### T5.4 The browser path in C#-WebAssembly
- **Who:** builder. **Needs:** T3.5, T1.5.
- **Steps:**
  1. A copy of the app's web build (under `prototypes/dotnet-b/web/`, never `src/`) whose worker loads the C# slice as WebAssembly instead of the TypeScript solver, for a demo site.
  2. Run it in Chromium: the fire, the pictures, "Continue on this device" from a stand-in desktop host.
  3. The hashes equal `linux-x64`'s.
- **Done when:** the run completes in Chromium with equal hashes, its step time and download size are reported.

#### T5.5 Lifecycle and loopback tests
- **Who:** builder. **Needs:** T5.2.
- **Steps:** in round 2's arms, the app tells the owner when to leave it and come back: background for 30 s, 90 s and 5 minutes; a process kill (the app asks the owner to swipe it away, then reopen); a 30-minute sustained run with thermal logging per engine. If route (c) is used: a co-resident attacker test from a second test APK (`au.firesim.proto.r2x`) trying the port and the secret.
- **Done when:** the arms exist and run in a container dry run.

#### T5.6 Round 2
- **Who:** builder (APK), owner (run), orchestrator (gates). **Needs:** T5.2, T5.5, T3.1.
- **Steps:**
  1. Round 2 arms: the 10-minute airplane-mode run at 60×; the lifecycle tests; the numeric check (the C# slice on the phone against `linux-x64` on the same fixture: identical hashes; and the TypeScript in the phone's WebView on the same fixture: inside the bars).
  2. **Owner:** install, Start, follow the on-screen prompts (about 10 minutes of attention spread over 45), uninstall.
  3. Decide Gates 3 (phone part) and 4.
- **Out:** `reports/r2-gates.md`.

### Phase 6: continuity and the cost of the rest

#### T6.1 Size, start-up and memory
- **Who:** builder. **Needs:** T5.2.
- **Steps:** APK size against the 33 MB budget (the 0.8.0 APK is 30.4 MB); cold start; resident memory; CoreCLR (Mono is not an option for these apps: the 11.0.100 SDK carries the error NETSDK1242, "Building {0} projects with the Mono runtime is not supported in .NET 11.0 and later. Use the CoreCLR runtime or target .NET 10.0"; T0.4 confirms with a one-line build that it fires for a MAUI Android project, and if CoreCLR fails here the fallback is .NET 10 (LTS) with Mono, recorded as a risk); a WebView floor check like the current app's (Chrome 108); the WebAssembly download size against the budget of Gate 1W. Collected in round 2 where they need the phone.

#### T6.2 Saved data (round 3)
- **Who:** builder, owner. **Needs:** T5.1.
- **Steps:**
  1. Build the current Capacitor app under a **test id**, `au.firesim.proto.r3` (served from `https://localhost` like the real app).
  2. **Owner:** install it, save two sites and one run.
  3. Install the MAUI shell over it with the same test id and key, a higher versionCode, and a migration that reads the Capacitor storage (the `CapacitorStorage` preferences file and the WebView origin's IndexedDB/localStorage, which an install-over keeps because the app's user id is the same) and writes it to the shell's origin (`https://0.0.0.1`).
  4. The test app checks what survived and sends the result.
  5. **Owner:** uninstall.
- **Done when:** a report of what survived, what the migration moved, and what a real release would need (a last Capacitor release with export, or the native read).
- **Out:** `reports/r3-saved-data.md`.

#### T6.3 Deployment matrix
- **Who:** builder (research and builds that can run here). **Needs:** T5.4.
- **Steps:** for each target (Android, iOS, Windows, macOS, Linux desktop, browser and PWA, the desktop host): how the C# solver runs (native or WebAssembly), the shell (MAUI, browser), what builds here and what needs a Mac or Windows, support end dates (.NET 11 to 2028-11-14; MAUI 11 to 2028-05-09; .NET 12 LTS expected November 2027), and the risks recorded in revision 3 §11.7.
- **Out:** `reports/6-deployment.md`.

#### T6.4 The cost of the rest
- **Who:** builder. **Needs:** T3.5, T2.3.
- **Steps:** the port of the remaining solver (37,727 lines in the import closure, minus the slice) and of its tests (10,700 to 28,900 lines; the Vitest code does not carry over, its scenarios and expected values do, as golden data); the validation suite moved to `dotnet test`; a freeze or drift plan for the TypeScript solver while the port runs; the Razor screens estimated, not built; what the work displaces.
- **Out:** `reports/6-cost.md`.

### Phase 7: verify and report

#### T7.1 Independent verification
- **Who:** one fresh agent, read-only, not a builder. **Needs:** all gates run.
- **Steps:** re-run one number per gate from the committed code; list anything overstated or not run.

#### T7.2 The report
- **Who:** orchestrator. **Out:** `docs/plans/dotnet-option-b-report.md` (one table per gate: measured, bar, result, conditions; not measured; recommendation) and an updated artifact.

#### T7.3 The owner's decision
- **Who:** owner. Keep D34, or replace it with "one solver, in C#" (and on what conditions).

---

## 7. Order, parallelism and cost

```
Phase 0  T0.1 ─ T0.2 ─┬─ T0.4 ─ T0.5 ─ T0.6 (round 0, owner)
                      ├─ T0.7
         T0.3 (owner, any time before round 1)
Phase 1  T0.4 ─ T1.2 ─ T1.5 early reading (to the owner)
         T1.1 ─ T1.3 ─ T1.4 ─ T1.5 full ─ T1.6
Phase 2  T2.1, T2.2 (alongside phase 1); T2.3 after T1.1
Phase 3  T3.1 ─ T3.2..T3.4 (three builders) ─ T3.5
Phase 4  T4.1 ─ T4.2 ─ T4.3 (round 1, owner) ─ T4.4 (gates 1, 1W, 2)
Phase 5  T5.1 ─ T5.2 ─ T5.5 ─ T5.6 (round 2, owner);  T5.3, T5.4 after T3.5
Phase 6  T6.1, T6.2 (round 3, owner), T6.3, T6.4
Phase 7  T7.1 ─ T7.2 ─ T7.3 (owner)
```

- Phases 1 and 2 run together (at most three builders). Phase 3 starts only after Gate 1W's desktop result: if WebAssembly is far off the bar in Chromium, the owner is asked before the port.
- **Stop points that need the owner:** T0.3, round 0, T4.4, T5.6, T6.2, T7.3, and any failed gate.
- **Cost.** About 20 builder runs if every gate passes, most of it phase 3 and the Android builds, and four phone rounds of a few minutes of the owner's time each. This is a large share of the weekly budget; the gates exist to stop early.

---

## 8. What each outcome means

| Result | Meaning |
|---|---|
| Gate 1 fails, 1W passes | No speed gain, but one solver everywhere is possible. The owner decides whether unified code and the same stack justify the port. |
| Gate 1W fails | One C# solver cannot serve the browser at today's speed. Options: accept slower browser runs; keep the TypeScript solver in browsers (two solvers, the cost D34 was decided on); or stop. |
| Gate 2 fails, 1W passes | Native C# on the phone cannot feed the WebView; the phone could run C#-WebAssembly inside the WebView instead (one solver, no native speed-up on the phone). |
| Gate 3 fails | Not a faithful port as built. Fix and re-run, accept a new reference (the validation suite then re-baselines), or stop. |
| Gate 4 fails | The failing piece (shell parity, lifecycle, host parity, browser path) is reported with what it would take. |
| All pass | One C# solver is technically feasible everywhere. The decision then rests on T6.4's cost and what it displaces, starting with 0.9.0 and 0.10.0. |

---

## 9. Skills each builder reads

| Skill (`dotnet/skills`) | Applied to |
|---|---|
| `dotnet-diag/microbenchmarking` | All C# timings use BenchmarkDotNet (marked baseline, `[GlobalSetup]`, results returned, `--job Dry` then `Short` while developing, default job for final numbers). Phone and browser timings use the test app's own A B B A harness. |
| `dotnet-advanced/vectorization` | Framework APIs first (`Span`, `TensorPrimitives`), explicit SIMD from `Vector128<T>`, scalar contract kept, each width tested in its own process, every tail length covered. A kernel that does not vectorise is a valid result. |
| `dotnet-diag/analyzing-dotnet-performance` | Allocation and LINQ scan before any timing. |
| `dotnet-maui/dotnet-maui-doctor` | Microsoft OpenJDK only; requirements from the workload's dependencies; `maui-android` and `android` workloads with an explicit `--version`; never `workload update` or `repair`. |
| `dotnet/setup-local-sdk` | `global.json` pins 11.0.100; the SDK comes from the checksummed tarball, not the install script. |
| `dotnet-blazor/use-js-interop` | Interop in `OnAfterRenderAsync` or event handlers, one typed wrapper, `IAsyncDisposable`, one coarse call per picture. The `[JSExport]` parts apply to `Fs.Wasm`. |
| `dotnet-aspnetcore/dotnet-webapi` | The desktop host's HTTP side. |
| `dotnet-test/*` | `Fs.Tests` on MSTest with Microsoft.Testing.Platform; assertion quality; no test anti-patterns. |

---

## 10. Reference

### 10.1 What the red team established (kept from revision 3)

- Gate 1 must compare like with like: the best TypeScript arm, the whole step, the tier the phone runs (G-1, G-2, G-4, G-5).
- Faithful random draw order keeps embers and spread-breach serial: the fast tier's native gain is capped near 1.3× on 4 cores (G-6).
- Phone numbers come from Release builds only; a Debug APK may not even start when sideloaded (G-9).
- No ASP.NET Core runtime for Android: an in-app server means `HttpListener` or `TcpListener` (T-2).
- The page depends on Capacitor's native bridge (T-5).
- MAUI's WebViews serve from `https://0.0.0.1`, the current app from `https://localhost`; saved data does not follow without a migration (T-6).
- Target SDK 37 and Android 17's local network permission; whether 127.0.0.1 counts is undocumented (T-8).
- On a phone every app shares 127.0.0.1: per-address limits become global, a fixed port can be taken, an Origin check stops only browser pages (S-2).
- Android freezes cached apps and closes their sockets; protocol 2 does not reconnect (S-4).
- Last-bit maths flips ember outcomes after about 1,800 s; a small, growing, second-order effect (N-1). .NET's `Math` follows the platform C library (N-2).
- JavaScript-to-C# traps: rounding, sort stability and ties, NaN order, insertion-ordered maps, ordinal strings, saturating casts (N-4).
- Full details: `docs/plans/dotnet-option-b-prototype.md` §11 and `docs/plans/redteam/`.

### 10.2 WebAssembly facts (.NET 11)

Researched 2026-11-12 from Microsoft Learn, the dotnet/runtime and dotnet/aspnetcore trackers, the .NET blog and the local 11.0.100 SDK manifests. Confidence high unless marked.

| Fact | Consequence for the plan |
|---|---|
| WebAssembly in .NET 11 still runs on **Mono** ("WebAssembly continues to use Mono… not changing in .NET 11", .NET blog 2026-07-14). CoreCLR on WebAssembly is a preview, aimed at .NET 12. MAUI on Android is CoreCLR only. | The solver runs on two runtimes: CoreCLR natively, Mono in browsers. Gate 3's cross-runtime identity test covers both. |
| Workloads in 11.0.100: `wasm-tools` (runtime packs, the AOT compiler, Emscripten 6.0.2) and `wasm-experimental` (templates and the multithreaded runtime pack). | T0.4 installs `wasm-tools`; `wasm-experimental` only for the threads experiment. |
| Browser threads (`WasmEnableThreads`) are **experimental**: they need cross-origin isolation, the tracking issue's milestone is "Future", blocking the main thread is unsupported, `[JSExport]` calls stay on one thread, and Blazor WebAssembly does not support them at all. Without threads, `Parallel.For` runs serially (medium). | Gate 1W measures **one thread**. Native C# keeps its threads; in a browser the C# solver is single-threaded, like today's TypeScript worker. |
| AOT (`RunAOTCompilation`, publish only) roughly doubles the download; IL is stripped after AOT by default; SIMD and exception handling are on by default. | T1.5 reports the download size; Gate 1W's size budget is the owner's. |
| No published benchmark compares .NET WebAssembly AOT with V8 on numeric loops. | Gate 1W's ratio is unknown until T1.5 measures it; this is the highest-risk number in the plan, so it comes first. |
| `[JSExport]` passes `Span<T>` and `ArraySegment<T>` of byte, int, double and (new in .NET 11) float as `MemoryView`s without a copy; arrays are copied; the WebAssembly heap cannot be transferred. | Pictures leave the worker with one copy into a transferred buffer. |
| .NET runs in a Web Worker without Blazor (`dotnet.create()`; a `blazorwebworker` template is new in .NET 11). The `wasmconsole` template runs the same build under Node (templates experimental, APIs supported). | The app's worker can host the C# solver (T5.4); CI and the validation suite can run the WebAssembly build under Node. |
| Native .NET `Math` calls the platform C library and "may differ between operating systems or architectures" (Learn, 2026-10-16). The WebAssembly runtime calls musl's libm, not JavaScript's `Math` (medium-high). There is no official .NET guidance on deterministic floating point. | `FsMath` with a managed implementation is required, not optional, for one solver with one set of results (T3.1). |
| Android WebView can get SharedArrayBuffer only through androidx.webkit 1.18.0's cross-origin-isolated allowlist plus a `Document-Isolation-Policy` header, off by default. | Threads in the phone's WebView are a measured capability (round 0), not an assumption. |
| MAUI 11 targets Android (API 24+), iOS 12.2+ (built on a networked Mac), Mac Catalyst, Windows; Linux only through Avalonia's third-party backend (medium). | T6.3's matrix; iOS cannot be built here. |
| Support: .NET 11 (STS) to 2028-11-14, the same day as .NET 10 LTS; MAUI 11 to 2028-05-09; .NET 12 LTS expected November 2027. | A move to .NET 12 within about a year of starting is part of T6.4's cost. |
| Mono for MAUI on Android: the 11.0.100 SDK carries NETSDK1242 ("…not supported in .NET 11.0 and later. Use the CoreCLR runtime or target .NET 10.0"). | Settled by T0.4 step 6; recorded as a risk if CoreCLR misbehaves. |

**Not verified:** relaxed SIMD support; `Parallel.For` behaviour under browser threads in .NET 11; whether bionic, glibc and musl agree bit for bit; CoreMathSharp on WebAssembly; the minimum WebView version for the cross-origin-isolated allowlist.

### 10.3 Agreement bars for Gate 3

Same tier, same seed, at every horizon of T2.2:

| Case | Bars |
|---|---|
| Embers off | ≤ 2.5 % of ever-burning cells differ in burnt status; burnt area within 2.5 %; median arrival difference ≤ 30 s; 95th percentile ≤ 60 s |
| Embers on, generator and draw order ported exactly (the plan) | ≤ 1 % of cells; burnt area within 2 %; median ≤ 30 s; each reported beside T2.1's noise floor, and the bars stay unless the floor comes near them |
| Embers on, a different random stream (last resort) | Mean burnt area over 30 seeds within 12 % of the TypeScript mean (weak: it fails a correct port 1 to 9 % of the time and passes a 10 % bias 61 to 66 % of the time) |
| C# against C# (threads, runtimes) | Bit-identical hashes |

### 10.4 Porting conventions

Each with one unit test: float32 arrays read into double locals; a JavaScript-style round (halves up); stable sorts or explicit tie-breaks, NaN last as typed arrays sort; insertion-ordered maps where delete-then-set moves a key to the end (`src/sim/simulation.ts:1668`); ordinal string comparison; saturating casts checked; every transcendental call through `FsMath`.
