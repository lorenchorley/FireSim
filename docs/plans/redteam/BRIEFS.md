# The briefs given to each agent (verbatim)

Copied from the session record. Each red team also read `teams/COMMON.md`; each verifier read `verify/VERIFY-COMMON.md` and its `BATCH-*.md`. Every agent ran in its own git worktree at commit 05795ff, in the background, with the session's reasoning effort (no override). Paths under `/tmp/claude-0/...` were this session's scratchpad and do not exist outside it.

## R1 red team: platform claims | model=sonnet effort=None isolation=worktree type=None

You are red team R1, the PLATFORM reviewer. First read /tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/redteam/COMMON.md completely and follow it exactly. Your TEAM id for the report file is R1.

Your lens: are the platform claims in the plan and the artifact TRUE, and can the prototype be built and run as planned? Attack these, and anything else you find (starting points, not limits):
- .NET 11 MAUI on Android: minimum API, the Android 15/16 requirement that native libraries support 16 KB memory page sizes (Google Play deadline and whether .NET 11 / MAUI 11 / CoreCLR on Android meet it), target SDK requirements, CoreCLR (now default) start-up, size and memory on mid-range phones, NativeAOT on Android being experimental.
- BlazorWebView and HybridWebView on Android: how a byte[] actually crosses (base64 over a string message? size limits? known performance issues or open GitHub issues with large payloads), what origin the pages are served from, whether Web Workers, SharedArrayBuffer, WebGL and long-running requestAnimationFrame behave normally inside them, mixed-content and cleartext rules for a loopback ws:// from an https page and the narrowest working configuration, Android System WebView version dependence.
- Whether `dotnet workload install maui-android` plus the Android SDK can really build an APK on a Linux x64 container (read the dotnet-maui-doctor skill and the dotnet/maui issues), and any claim in the plan that this is "downloadable here" or "feasible".
- Whether the claims in the artifact about Blazor Server, Blazor WebAssembly on .NET 11 (Mono, no threads, web worker template), Photino.Blazor, Avalonia, MAUI platforms and the Linux gap are accurate and current.
- Whether the plan's stage 2 transports (a) JS interop byte[], (b) HybridWebView raw messages, (c) loopback WebSocket from an in-app Kestrel are the real options, and whether a better or a forbidden one exists (for example custom URL scheme or WebViewAssetLoader-style interception).
Return your report as specified.


## R2 red team: method and gates | model=opus effort=None isolation=worktree type=None

You are red team R2, the METHOD reviewer. First read /tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/redteam/COMMON.md completely and follow it exactly. Your TEAM id for the report file is R2.

Your lens: can a gate PASS when option B is actually bad, or STOP when B is actually good? Attack the measurement design, and anything else you find (starting points, not limits):
- Stage 1: the baseline is TypeScript in Node on desktop, but the phone runs TypeScript in the WebView's V8 worker; is there a phone baseline at all? Kernel speed-up versus whole-run speed-up (Amdahl), the choice of the 1.5x and 2.0x thresholds, warm-up and JIT tiering in V8 and in .NET (tiered compilation, PGO, ReadyToRun on Android), BenchmarkDotNet in a shared 4-core container with steal time, thermal throttling and big.LITTLE scheduling on phones, Parallel.For overhead on small grids, memory-bandwidth limits, whether a 3 km fast-tier run (about 1 s of TypeScript) is representative of what the owner cares about.
- Stage 2: where the proposed rates (2.2 MB at 4/s, 6.5 MB at 2/s, 16 MB at 1/s) come from and whether they match what a phone needs; synthetic buffers versus real decode and GPU upload; whether main-thread time per picture and long tasks are the right measures; one phone being asked to speak for all phones.
- Stage 3: agreement bars derived from only six seeds; the 30-seed ensemble bar of 12 % (power, variance, whether it can ever fail); using seed 11 (no effective spot fire) as the primary fixture; bit-exact porting of a random stream as a precondition; comparing a C# port that is not finished against a final TypeScript model.
- The gates' logic as a whole: ordering, correlated failures, kill criteria that cannot distinguish "B is slow" from "my port is naive", what a "pass" would still not prove about shipping B, and what would be the cheapest experiment that would change the owner's decision that the plan does not contain.
Return your report as specified.


## R3 red team: port fidelity and numerics | model=sonnet effort=None isolation=worktree type=None

You are red team R3, the PORT FIDELITY reviewer. First read /tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/redteam/COMMON.md completely and follow it exactly. Your TEAM id for the report file is R3.

Your lens: could a C# port of this solver ever match the TypeScript, be deterministic across threads and machines, and be built in the size the plan implies? You must READ THE SOLVER SOURCE (src/fire/spread/FireSpreadModel.ts, levelSet.ts, src/embers/EmberModel.ts, src/atmosphere/solver.ts, src/sim/simulation.ts, src/core, src/sim/testing/hash.ts and the random-number code) and look up how V8 and .NET differ. Attack these, and anything else you find (starting points, not limits):
- The plan's claim (revision 2, from stage 3a) that last-bit math differences do not matter because a 4.5-ulp perturbation moved no float32 value in 8 runs of one scenario. Is that enough evidence? A level-set or threshold-driven front can amplify tiny differences. Find the code that thresholds or branches on float comparisons.
- Cross-platform determinism: V8 implements Math.exp, log, pow, sin, cos in its own software (an fdlibm port) so JavaScript gives the same results on every device, whereas .NET calls the platform C library (glibc, bionic, the Windows CRT), so the SAME C# could give different results on an Android phone, a Linux desktop host and a Windows host. The app has "Continue on this device" and a desktop-to-phone handover; research this and decide whether it breaks consistency, validation hashes or the Node-versus-browser reproducibility already tested. Check what the .NET runtime actually does for Math.* on each platform in .NET 11 (primary sources).
- Random streams and ordering: how the TypeScript seeds and draws random numbers, whether the draw order depends on iteration order of Map, Set, object keys, array sort stability or typed-array layout, and what would be needed to reproduce it exactly in C# and still run on several threads deterministically.
- JavaScript-isms that C# does not have: Float32Array storage rounding of intermediates, Math.fround, `|0` and `>>>` integer semantics, NaN and Infinity handling, -0, integer overflow, sparse arrays, closures over loop variables, Array methods with holes, Date and time handling.
- The size and shape of the port: the plan says about 25,000 lines of solver code and 15,000 lines of tests; check this by reading what the solver actually imports, whether the scenario builder, data loading, fuel and terrain code are on the runtime path, and what is missing from the stage 3 slice.
Return your report as specified.


## R4 red team: steelman the status quo | model=opus effort=None isolation=worktree type=None

You are red team R4, the STATUS QUO reviewer. First read /tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/redteam/COMMON.md completely and follow it exactly. Your TEAM id for the report file is R4.

Your lens: steelman NOT doing option B. Is the premise sound, and are there cheaper ways to reach whatever the owner actually wants? Attack these, and anything else you find (starting points, not limits):
- The evidence for the speed-up: plan 15e (`docs/plans/air-slice-wind-detail-honest-speed.md`, `studies/desktop-simulation/`) said about 2 to 2.6 times on four cores at best; read it and decide whether that supports B, and what a phone with 6 to 8 mixed big/little cores would really give. Is solver speed even the bottleneck for the owner's users (look at the tiers, the pace sheet, the Desktop detail setting, the 15c study)? What problem does B solve that is not already solved by the Node desktop host?
- Cheaper routes to more compute or more reach, with real evidence from 2026: JavaScript worker pools with SharedArrayBuffer and Atomics (cross-origin isolation inside Android WebView and Capacitor), WebAssembly (Rust or C++) with threads and SIMD, WebGPU compute, algorithmic changes (adaptive refinement, coarser tiers), keeping TypeScript but packaging it differently for desktop (Electron, Tauri 2 including mobile, Capacitor on desktop), .NET only for the desktop host, a MAUI HybridWebView wrapper only.
- Whether the owner's original question ("Blazor in .NET for this desktop and mobile app") was about the solver at all, or about UI technology, packaging, team skills or a single codebase, and whether the plan answers a different question than the one asked.
- The full cost: the 25,000-line port, 15,000 lines of tests, two solvers during transition, validation restarted on a new baseline, a Razor rewrite of about 36,000 lines of UI if wanted, the loss of the existing 5,900 unit tests' protection, maintenance by one owner, and the opportunity cost against the work already planned (0.9.0 release, 0.10.0 list).
- Decision D34 and the history behind it (docs/plans, the conversation record in the plan): does the new plan quietly reopen it, and does the report say what evidence would be needed to reopen it responsibly?
Return your report as specified.


## R5 red team: security and operations | model=sonnet effort=None isolation=worktree type=None

You are red team R5, the SECURITY AND OPERATIONS reviewer. First read /tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/redteam/COMMON.md completely and follow it exactly. Your TEAM id for the report file is R5.

Your lens: what goes wrong when this is shipped and operated, and what the prototype's own process gets wrong. Attack these, and anything else you find (starting points, not limits):
- Security: the loopback WebSocket in stage 2 and 4 (other apps on the phone can reach 127.0.0.1; Android 17 local-network changes; the pairing code; cleartext allowed to 127.0.0.1 only versus app-wide as lane A did in 0.9.0), MIXED_CONTENT_ALWAYS_ALLOW scope, WebView debugging, JS interop attack surface, an ASP.NET Core desktop host's exposure compared with the current Node host's hardening (Host allowlist, origin checks, one-use --open link, memory bound), OWASP MASVS or MASTG guidance for WebViews. Does the plan keep the rule that host security must not get weaker?
- Stores and platform policy: Google Play target API level deadlines, the 16 KB page-size requirement, Data safety and WebView policies, app bundle size limits, minimum API 24 versus the current minSdk, what changes for sideloaded debug APKs versus store builds.
- Saved-data continuity: the current app keeps saved sites and runs in the Capacitor WebView origin (`https://localhost`, deliberately unchanged in 0.8.0). What origin do BlazorWebView and HybridWebView use, what survives an install over the current APK, Android auto-backup and WebView storage clearing, and whether the plan's stage 5 test is enough.
- Lifecycle and resources: Android process death and backgrounding, a C# solver on native threads versus a Web Worker when the app is paused, thermal and battery cost of all-core native threads on a phone, memory limits (the 10 m grid peaked near 1.9 GB on desktop), start-up time of CoreCLR versus the WebView, crash reporting and symbolication.
- The prototype's own process: SDK and toolchain provenance (the tarball with checksum, the Android command-line tools, NuGet workloads, Microsoft OpenJDK), licences of every component, the risk of the long unattended downloads, reproducibility if the container is reclaimed, and anything in `prototypes/dotnet-b/` or the plan that would mislead a reader (claims stated as measured that were not).
Return your report as specified.


## R6 red team: pre-mortem and assumptions | model=sonnet effort=None isolation=worktree type=None

You are red team R6, the PRE-MORTEM and ASSUMPTIONS reviewer. First read /tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/redteam/COMMON.md completely and follow it exactly. Your TEAM id for the report file is R6.

Your lens, two tasks:
1. PRE-MORTEM (prospective hindsight). It is May 2027. The option B effort either (a) was abandoned after months of spend, (b) shipped and the owner regrets it, or (c) passed every gate and was still the wrong decision. Write the twelve most plausible, specific causes, each tied to a stage, gate or claim in the plan, ranked by likelihood times cost. A cause is only worth listing if you can point at evidence that makes it plausible (a source, a measured number in the 3a report, a line in the plan or the code); generic "scope creep" or "unexpected complexity" does not count. For each, say whether the plan already guards against it.
2. ASSUMPTIONS REGISTER. List every assumption the plan, the artifact and the conversation claims behind them rely on, explicit and implicit (for example: that results must be bit-for-bit hash-stable, that phone speed matters, that the owner's phone is representative, that the Capacitor origin must be kept, that the TypeScript solver is the reference, that fast tier is what would be ported, that a Razor UI is wanted, that the owner will act on the gates, that the container can build Android). For each: how critical it is (what breaks if false), how well it is evidenced now (none, secondary, primary, measured), and the cheapest test. Report the ten most critical assumptions with the weakest evidence as findings in the standard format; put the full register in a table after the findings.
Use research to check the evidence status of the assumptions that depend on external facts. Return your report as specified.


## R7 blind red team: independent plan | model=opus effort=None isolation=worktree type=None

You are red team R7, the BLIND reviewer. This brief differs from the others: DO NOT read `docs/plans/dotnet-option-b-prototype.md`, `docs/plans/dotnet-option-b-redteam.md`, anything under `prototypes/dotnet-b/`, or `firesim-dotnet.html`. You have not been shown our plan on purpose. If you see any of those files, do not open them, and say at the end that you did not. Everything else in the repository is fair to read.

Read /tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/redteam/COMMON.md for the rules (research, format, evidence, report location; your TEAM id is R7) but ignore its description of "the plan".

The situation: FireSim is a Capacitor/Android WebView 3-D bushfire training app (TypeScript, Vite, Three.js; the simulation runs in a Web Worker; a Node desktop host runs the same solver and the page can connect to it). A decision (D34 in `docs/plans/air-slice-wind-detail-honest-speed.md`) keeps one solver, in TypeScript. The owner asked whether a .NET version of the app, using Blazor and MAUI for desktop and mobile, would be possible, and then whether a variant in which the solver itself is ported to C# and run in the .NET process (instead of a TypeScript Web Worker or the Node host) would be worthwhile. Assume a Linux x64 container with 4 cores and 16 GB, the .NET 11 SDK, the Android SDK and workloads downloadable, no phone access except that the owner can install a sideloaded APK and report numbers.

Your tasks:
1. Design the cheapest PROTOTYPE PLAN that would let the owner decide whether to pursue the C# solver, as if you were the engineer who has to live with the decision: stages, what each measures, the pass/stop criteria with numbers and reasons, what runs where, the risks of each stage, and the order that kills a bad idea soonest. Be specific (name the kernels, the measurements, the sizes, the rates).
2. List the TEN most likely ways such a plan, or the decision, FAILS, each with evidence from research and from the repository.
3. State what you would check FIRST, and why.
Report items 2 and 3 as findings in the standard format where they are falsifiable claims about the situation (the "plan change" field then says what your own plan does about it). Put your prototype plan in full after the findings in a section "Independent plan". Use the research obligations in COMMON.md. Return your report as specified.


## Verifier P-Sonnet: premise batch | model=sonnet effort=None isolation=worktree type=None

You are an independent verifier, ID "S". Read these two files completely and follow them exactly: /tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/redteam/verify/VERIFY-COMMON.md and then your batch /tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/redteam/verify/BATCH-P.md. Your BATCH is P; write your output to /tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/redteam/verify/P-S.md and return the same text as your final message. Use WebSearch (load it with ToolSearch "select:WebSearch" if needed) for external facts. Anything CPU-heavy over a minute goes through `flock /tmp/firesim-heavy.lock`. Read nothing else in the scratchpad's redteam folders.


## Verifier P-Opus: premise batch | model=opus effort=None isolation=worktree type=None

You are an independent verifier, ID "O". Read these two files completely and follow them exactly: /tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/redteam/verify/VERIFY-COMMON.md and then your batch /tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/redteam/verify/BATCH-P.md. Your BATCH is P; write your output to /tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/redteam/verify/P-O.md and return the same text as your final message. Use WebSearch (load it with ToolSearch "select:WebSearch" if needed) for external facts. Anything CPU-heavy over a minute goes through `flock /tmp/firesim-heavy.lock`. Read nothing else in the scratchpad's redteam folders.


## Verifier G-Sonnet: gates batch | model=sonnet effort=None isolation=worktree type=None

You are an independent verifier, ID "S". Read these two files completely and follow them exactly: /tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/redteam/verify/VERIFY-COMMON.md and then your batch /tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/redteam/verify/BATCH-G.md. Your BATCH is G; write your output to /tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/redteam/verify/G-S.md and return the same text as your final message. Use WebSearch (load it with ToolSearch "select:WebSearch" if needed) for external facts. Anything CPU-heavy over a minute goes through `flock /tmp/firesim-heavy.lock`. Read nothing else in the scratchpad's redteam folders.


## Verifier G-Opus: gates batch | model=opus effort=None isolation=worktree type=None

You are an independent verifier, ID "O". Read these two files completely and follow them exactly: /tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/redteam/verify/VERIFY-COMMON.md and then your batch /tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/redteam/verify/BATCH-G.md. Your BATCH is G; write your output to /tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/redteam/verify/G-O.md and return the same text as your final message. Use WebSearch (load it with ToolSearch "select:WebSearch" if needed) for external facts. Anything CPU-heavy over a minute goes through `flock /tmp/firesim-heavy.lock`. Read nothing else in the scratchpad's redteam folders.


## Verifier N-Sonnet: numerics batch | model=sonnet effort=None isolation=worktree type=None

You are an independent verifier, ID "S". Read these two files completely and follow them exactly: /tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/redteam/verify/VERIFY-COMMON.md and then your batch /tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/redteam/verify/BATCH-N.md. Your BATCH is N; write your output to /tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/redteam/verify/N-S.md and return the same text as your final message. Use WebSearch (load it with ToolSearch "select:WebSearch" if needed) for external facts. Anything CPU-heavy over a minute goes through `flock /tmp/firesim-heavy.lock`. Read nothing else in the scratchpad's redteam folders.


## Verifier N-Opus: numerics batch | model=opus effort=None isolation=worktree type=None

You are an independent verifier, ID "O". Read these two files completely and follow them exactly: /tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/redteam/verify/VERIFY-COMMON.md and then your batch /tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/redteam/verify/BATCH-N.md. Your BATCH is N; write your output to /tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/redteam/verify/N-O.md and return the same text as your final message. Use WebSearch (load it with ToolSearch "select:WebSearch" if needed) for external facts. Anything CPU-heavy over a minute goes through `flock /tmp/firesim-heavy.lock`. Read nothing else in the scratchpad's redteam folders.


## Verifier T-Sonnet: platform batch | model=sonnet effort=None isolation=worktree type=None

You are an independent verifier, ID "S". Read these two files completely and follow them exactly: /tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/redteam/verify/VERIFY-COMMON.md and then your batch /tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/redteam/verify/BATCH-T.md. Your BATCH is T; write your output to /tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/redteam/verify/T-S.md and return the same text as your final message. Use WebSearch (load it with ToolSearch "select:WebSearch" if needed) for external facts. Anything CPU-heavy over a minute goes through `flock /tmp/firesim-heavy.lock`. Read nothing else in the scratchpad's redteam folders.


## Verifier T-Opus: platform batch | model=opus effort=None isolation=worktree type=None

You are an independent verifier, ID "O". Read these two files completely and follow them exactly: /tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/redteam/verify/VERIFY-COMMON.md and then your batch /tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/redteam/verify/BATCH-T.md. Your BATCH is T; write your output to /tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/redteam/verify/T-O.md and return the same text as your final message. Use WebSearch (load it with ToolSearch "select:WebSearch" if needed) for external facts. Anything CPU-heavy over a minute goes through `flock /tmp/firesim-heavy.lock`. Read nothing else in the scratchpad's redteam folders.


## Verifier S-Sonnet: security batch | model=sonnet effort=None isolation=worktree type=None

You are an independent verifier, ID "S". Read these two files completely and follow them exactly: /tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/redteam/verify/VERIFY-COMMON.md and then your batch /tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/redteam/verify/BATCH-S.md. Your BATCH is S; write your output to /tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/redteam/verify/S-S.md and return the same text as your final message. Use WebSearch (load it with ToolSearch "select:WebSearch" if needed) for external facts. Anything CPU-heavy over a minute goes through `flock /tmp/firesim-heavy.lock`. Read nothing else in the scratchpad's redteam folders.


## Verifier S-Opus: security batch | model=opus effort=None isolation=worktree type=None

You are an independent verifier, ID "O". Read these two files completely and follow them exactly: /tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/redteam/verify/VERIFY-COMMON.md and then your batch /tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/redteam/verify/BATCH-S.md. Your BATCH is S; write your output to /tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/redteam/verify/S-O.md and return the same text as your final message. Use WebSearch (load it with ToolSearch "select:WebSearch" if needed) for external facts. Anything CPU-heavy over a minute goes through `flock /tmp/firesim-heavy.lock`. Read nothing else in the scratchpad's redteam folders.
