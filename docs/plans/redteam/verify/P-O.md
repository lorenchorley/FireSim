# Batch P, verifier O

Procedure note: BATCH-P.md is a single file, so Part 2 was visible when I opened it. I wrote each "own answer" from the sources I checked, not from the claim, and where my evidence disagrees with a claim I say so. Repository paths are relative to the worktree `/home/user/FireSim/.claude/worktrees/agent-a1b2095d2884e209f` (HEAD `05795ff`). "Plan" means `docs/plans/dotnet-option-b-prototype.md`, and "15e" means `docs/plans/air-slice-wind-detail-honest-speed.md` section 15e.

---

P-1. Own answer (before reading the claim): The repository has no measured user-visible shortfall. One phone was measured once: its 3-D air step took 41.1 ms (the mean of the warm-up steps) against Auto's 198.4 ms limit, which is 4.8 times headroom on the tier choice, and its fast tier ran at 871x. On the desktop, one thread runs the fast tier at 679x (30 m) and 77x (10 m), and the 3-D High tier at 10 m at 41x. My own inference, not measured: on that phone the 3-D tiers probably fall behind the playback speeds offered (Standard is about 173x/2.35 ≈ 74x and High about 75x/2.35 ≈ 32x, against a default of 60x and presets up to 3600x). A 2 to 3 times faster solver would therefore raise the speed at which the "Waiting" signal appears. That is a modest user-visible effect, but nobody has measured it.
Verdict: PARTLY     Severity: MAJOR     Change follows: partly
Evidence checked:
- README.md:405 "the limit is a step of 198.4 ms"; README.md:411-413 "Only one phone so far: on it the 3-D step took 41 ms ... the limit of about 198 ms is 4.8 times that". docs/ARCHITECTURE.md:425-427 says the same.
- 15e line 36: "41 ms is 2.35x this build machine's 17.5 ms" and "The fast tier runs at 871x on this phone: 14x headroom over the 60x playback setting".
- 15e line 1012: "10 m 47.0 s (77x)", "3-D tiers at 30 m: Standard 20.8 s per hour (173x), High 48.2 s (75x)". Line 1014: "Amdahl upper bounds on 4 cores: the air alone 1.9x (Standard) and 2.6x (High)" and "the speed the desktop already has is more than a 10 m run needs".
- `src/ui/screens/sim/speedModel.ts:4` SPEED_PRESETS `[... 60, 120, 300, 600, 1800, 3600]`; `src/ui/settings.ts:74` `defaultSpeed: 60`.
- README.md:395 "Detailed mode is allowed to be slower than playback" (the app already expects the 3-D tiers to lag).
- README.md:448 on the speed test: "Not measured: the test on a phone".
Notes: These figures are quoted correctly: 41 ms, 198.4 ms, 4.8x, and 77x for the fast tier at 10 m. "No measured shortfall" is true, but mostly because almost nothing has been measured on a phone. Two parts are overstated:
(a) "A 2 to 2.6 times gain crosses no speed step". By my inference from the measured 2.35x phone-to-desktop ratio, the High ("Detail") tier on the owner's phone runs below the default 60x, and Standard runs near it. A 2 to 2.6 times gain would cross the 60x and 120x presets for those tiers. It crosses no step only for Auto's tier choice on that one phone.
(b) 2 to 2.6x is the 15e Amdahl bound for JavaScript threads, not a measured expectation for C#. Gate 1 only requires at least 2.0x on the phone.
Also, the proposed stage 0 is "free" only in agent time: it depends on the owner using the phone (see P-8). And the speed test measures kernel throughput, not playback pace. The premise check itself is well founded: the plan states no user-visible outcome that B must change (plan lines 3 and 90 frame Gate 1 only as a speed-up ratio). The check should measure the pace on Standard and Detail at 60x, 120x and 600x (the debug statistics and the pace gauge), not only the Auto headroom. A phone measurement of 3-D pace showing the default speed held on both 3-D tiers would make me drop objection (a).

---

P-2. Own answer (before reading the claim): API 24 (Android 7.0). .NET 11 raised it from API 21 because CoreCLR, the default runtime on Android in .NET 11, needs API 24.
Verdict: CONFIRMED     Severity: NONE     Change follows: yes
Evidence checked:
- https://learn.microsoft.com/en-us/dotnet/core/compatibility/maui/11/android-minimum-api-level (ms.date 2026-11-10, updated 2026-11-11): "The minimum supported Android API level for .NET 11 has been raised from 21 (Android 5.0) to 24 (Android 7.0) ... .NET 11 uses CoreCLR by default, which requires Android API 24 or later."
- https://learn.microsoft.com/en-us/dotnet/maui/whats-new/dotnet-11 (ms.date 2026-09-10): "Starting in .NET 11 Preview 3, the minimum supported Android API level has been raised from 21 (Lollipop) to 24 (Nougat)."
- Local SDK: `scratchpad/dotnet-sdk/packs/Microsoft.Android.Sdk.Linux/37.2.31/targets/Microsoft.Android.Sdk.SupportedPlatforms.targets:13` `<AndroidMinimumSupportedApiLevel ...>24</AndroidMinimumSupportedApiLevel>` (the .NET 10 pack 36.1.118 still says 21).
Notes: The plan already uses this floor (plan line 53: "Android 7.0 (API 24) floor"). The current app also targets it (`android/variables.gradle` `minSdkVersion = 24`), so no device is lost. Nothing to change.

---

P-3. Own answer (before reading the claim): D34 set the .NET idea aside "because it means maintaining two solvers", so the reason is maintenance cost, not feasibility or speed. Section 7's "All pass" row says "B is technically feasible" and lists the remaining port, Razor and migration costs, then says "D34 would then be reopened by the owner". It never names the two-solver cost or any evidence that would justify reopening D34.
Verdict: CONFIRMED     Severity: MAJOR     Change follows: partly
Evidence checked:
- 15e decision table, line 121 (D34): "The .NET idea ... was weighed with you and set aside because it means maintaining two solvers". Line 1009: "a .NET back end was weighed and set aside to avoid maintaining two solvers".
- Line 126 (D39): "Threads, WebAssembly and WebGPU are weighed against the 15e measurement before anything is built (... D34 says one solver)".
- Plan line 93: "All pass | B is technically feasible. The remaining cost is the port of the rest of the solver (about 25,000 lines and 15,000 lines of tests by line count), the Razor screens if wanted, and the saved-data migration from stage 5. D34 would then be reopened by the owner."
- Plan line 5: "Decision D34 ... stays in force until the owner says otherwise after the report."
- Grep of the plan for "two solvers|second solver|retire": no match.
Notes: The claim is accurate. One qualification: the "All pass" row does list some costs, so it is not feasibility alone. But it omits the one cost D34 was decided on and gives no criterion for reopening D34. As written, an all-pass result reads as a case to reopen D34. I rate it MAJOR because section 7 is the decision rule the whole plan feeds; the fix is text only. The proposed list goes beyond P-3's evidence: "B beating TypeScript with workers/WASM/WebGPU" belongs to P-6 and "a user-visible benefit" to P-1. What follows directly from P-3 is an explicit criterion in section 7 that addresses the two-solver cost (whether TypeScript retires, and what keeping both in agreement costs) and the revalidation cost.

---

P-4. Own answer (before reading the claim): The plan does not record why the owner wants .NET. The only trace is D34, which says the earlier .NET idea was "an engine behind the existing engine protocol ... the air solver first", that is, a back end or solver. No stage tests a .NET shell around the unchanged TypeScript app. Stage 4 puts the existing page in a MAUI shell but always with the C# engine, and stage 2 uses synthetic buffers, not the app.
Verdict: PARTLY     Severity: MAJOR     Change follows: yes (the question); partly (stage 4-0)
Evidence checked:
- Plan lines 3-5: the question is speed, agreement and shipping. "It does not decide the Razor screens (a known, large cost, separate from the risks here)."
- Plan line 51 (stage 4): "The existing page ... in a MAUI shell, with the C# engine replacing the Node host and speaking protocol 2 over loopback". Plan line 42 (stage 2): synthetic buffers.
- Artifact text (`scratchpad/firesim-dotnet.html`, "My read"): "If you want .NET for the shell, wrap the current app with MAUI's HybridWebView and keep the solver as it is. It is the only route that leaves every existing test and hash valid."
- Line counts, run with find, cat and `wc -l`: `src/ui` .ts/.tsx/.css/.js = 59,597 lines, of which `*.test.ts` = 23,778; `e2e` .ts = 20,739. The claim's figures are right.
- 15e line 121 (D34): the earlier .NET idea was an engine or back end.
Notes: Three points are true: no motive is recorded, the HybridWebView-around-the-app route is tested by no stage, and the line counts are right. One point is overstated: "the costs that dominate B ... sit outside every gate" is true but is a declared exclusion (plan line 5 and line 93 "the Razor screens if wanted"), not something hidden. Saved-data migration is in stage 5 (informational, by design). Only "the browser path" is genuinely unmentioned, and that is P-5. "The plan may answer a different question" is reasonable but speculative: D34's record suggests the owner's earlier interest was a .NET engine, which the plan does test. Asking the owner one question about the goal follows directly from the evidence. A stage 4-0 is justified if the answer includes "a .NET shell". It is cheap to add, because stage 2 already builds a MAUI HybridWebView app and stage 5 already tests origin and saved data, so 4-0 can be a variant of those rather than a new lane.

---

P-5. Own answer (before reading the claim): Under B, every path without a .NET process would still need the TypeScript solver running as JavaScript:
- the app in a desktop browser or as a PWA;
- the page a phone's browser loads from the desktop host;
- "Continue on this device", which keeps an idle TypeScript worker fetched from the host;
- the page's own worker, in-thread and demo engines, which stay in the bundle even in stage 4's MAUI shell;
- the headless Node validation suite and benchmarks, and the e2e tests, which run the real engine.
Blazor WebAssembly in .NET 11 still runs on Mono, and its multithreading is experimental at best. So B means either two solvers or dropping those paths.
Verdict: CONFIRMED     Severity: MAJOR     Change follows: yes
Evidence checked:
- desktop/README.md:394-398: "So that *Continue on this device* can start the run on the phone with no host, the page ... makes this device's own engine, idle ... (one idle worker, whose script, 484,365 bytes or 170,621 gzipped, is fetched from the host then)".
- 15e line 1022: "the same `Simulation` runs headless in Node (the validation suite and the benchmarks do) ... The app already runs in a desktop browser and as a PWA". README.md:1567 "in the browser (including an installed PWA)". README.md:31: e2e on "the real engine".
- Artifact: "Desktop host (ASP.NET Core) ... same C# solver, Node host retired"; "Choose B only if you are ready to retire the TypeScript solver".
- https://devblogs.microsoft.com/dotnet/dotnet-maui-moves-to-coreclr-in-dotnet-11/ (2026-05-13): "Blazor WebAssembly is not affected. WASM continues to use Mono, and that is not changing in .NET 11."
- Threads in Blazor WASM: search summaries only (dotnet/runtime#129900, a fatal error in multithreaded WASM on 10.0.x; a MudBlazor#12387 thread quoting "Blazor does not support WasmEnableThreads"). I found no Microsoft Learn page saying it is supported.
- Plan grep for "browser|PWA|two solvers|retire": the only hits are on lines 51 and 90 (Node host), none about the browser path.
Notes: True as stated, and it goes to D34's own reason. The claim's "no real threads" is slightly strong: `WasmEnableThreads` exists but is experimental and unsupported for Blazor. That changes nothing here. Strictly, the e2e and Node suites are test infrastructure rather than product. They would keep the TypeScript solver alive or need re-pointing, which is the same cost. I did not rate it BLOCKER because no gate gives a wrong answer. It is a scope decision the owner should make before the expensive stage 3 port, so asking first is the right order.

---

P-6. Own answer (before reading the claim): Each item below is from a source I checked:
- androidx.webkit 1.18.0 (2026-10-21) adds `Profile#setCrossOriginIsolatedAllowlist`, which allows SharedArrayBuffer, and with it WebAssembly threads, for allow-listed origins that also send a `Document-Isolation-Policy` header.
- WebAssembly fixed-width SIMD has been on by default since Chrome 91; that it reached WebView with the same milestone is my inference.
- WebGPU on Android Chrome dates from Chrome 121; Chrome 146 added compatibility mode. Android WebView appears only in a blink-dev Intent to Ship (search summary).
- Plain multi-worker message passing needs nothing new.
- The 15c moving band is estimated at 1.2x and 2.7x the 30 m cost, against 27x for uniform 10 m (unmeasured).
The plan compares B against none of these. Gate 1's baseline is single-thread TypeScript in Node, while the C# side runs on all cores.
Verdict: CONFIRMED     Severity: MAJOR     Change follows: partly
Evidence checked:
- https://developer.android.com/jetpack/androidx/releases/webkit (read 2026-11-12): "1.18.0 ... October 21, 2026 ... Cross-Origin Isolation Management: Introduces new profile-level APIs (`Profile#setCrossOriginIsolatedAllowlist` ...) to allow the use of `SharedArrayBuffer` ... Web pages must also opt in by setting the `Document-Isolation-Policy` header". The app currently uses `androidxWebkitVersion = '1.14.0'` (`android/variables.gradle`).
- https://v8.dev/features/simd: "WebAssembly SIMD support is available by default from Chrome 91" (no WebView mention).
- https://developer.chrome.com/blog/new-in-webgpu-146 (2026-02-25): compatibility mode on Android. The page never mentions WebView. The blink-dev "Intent to Ship: WebGPU Compatibility mode" (search summary only, not opened) lists Android WebView, shipping in M146.
- 15e line 949: "uniform 10 m 27 times, a fixed top 20 % 1.5 and 6.2 times, the moving band 1.2 and 2.7 times" with "equal cost per cell-step assumed and not measured".
- Plan line 34 (Gate 1): "All-core C# is under 1.5x the TypeScript on desktop, or under 2.0x on the phone". Line 40: TypeScript "in Node on identical inputs".
- 15e line 1014: Amdahl bounds of 1.9x to 2.6x on 4 cores for the air alone.
Notes: The facts check out, with two weak spots: WebGPU in WebView rests on an intent-to-ship, and SIMD in WebView is inferred. "Cheaper" is the reviewer's inference. The thread routes still carry the same determinism work as the C# port, and the 15c band trades detail against cost rather than speeding the solver. The important consequence is one the claim implies but does not state: Gate 1 compares all-core C# with one-thread TypeScript. By 15e's own Amdahl bound, threading alone (1.9x to 2.6x on 4 cores) could pass the 1.5x desktop bar, and possibly the 2.0x phone bar, with no .NET-specific gain. So Gate 1 could credit .NET with a gain D34 already allows TypeScript to get. That is why I rate it MAJOR; the per-thread C# numbers are recorded, so the gate is not unrecoverable. On the proposed change: the status-quo arm is justified. Its cheapest form is the same kernel split over Node `worker_threads` in the stage 1 benchmark (container), plus a one-line `crossOriginIsolated` / SharedArrayBuffer check on the phone. A Capacitor multi-worker build can follow only if that arm looks competitive.

---

P-7. Own answer (before reading the claim): The simulation uses a seeded mulberry32 generator (`Rng` in `src/core/rng.ts`, and `FastRng` in `src/embers/sampling.ts`, "identical to `Rng.next()`"), never Math.random. The uniform stream uses only 32-bit integer operations and a division by 2^32, so C# can reproduce it bit for bit. The derived draws (Box-Muller normal, log-normal, Poisson via exp, and the 4,096-entry normal table built with sqrt) use transcendental functions. These could differ in the last bit between V8 and .NET unless the table is exported as data. The stage 3a test found that this kind of difference does not move results; the draw order is what matters.
Verdict: REFUTED     Severity: NONE     Change follows: yes (none needed)
Evidence checked:
- `src/core/rng.ts:2` "Small, fast, seedable PRNG (mulberry32) so simulations are reproducible"; `:12-15` `Math.imul` and `>>> 0` arithmetic.
- `src/embers/sampling.ts:15` "mulberry32 identical to `Rng.next()` (core/rng.ts)"; `:89-98` `NORMAL_TABLE` built from `inverseNormalCdf` and `Math.sqrt`.
- Grep for `Math\.random` in `src` (non-test): only DOM ids (`speedControl.ts:59`, `timePopover.ts:41`) and a dataset stamp (`datasets.ts:153`); several render files state "no Math.random".
- Plan lines 121 and 134: the slice "ports the TypeScript random generator and its draw order exactly".
Notes: The claim is false on both counts. The plan already handles reproduction, with the right caveat about the draw order (plan line 134 provides a fallback bar if bit-for-bit fails).

---

P-8. Own answer (before reading the claim): Gate 1's phone half, Gate 2, the airplane-mode half of Gate 4, and stage 5's start-up and memory checks all need the owner's phone. This container has no KVM, so no emulator. The plan's only cover for unreturned numbers is rule 5 ("Nothing is called a pass that was not run. A stage that cannot be run here says what it needs"). Section 7 has no "undecided" or "not returned" row and there is no time-box. Since "Gate 1 and Gate 2 are decided together", the plan would simply stall. The record shows formal phone check-lists 1 to 6 not done, and every release from 0.3.0 to 0.8.0 marked not seen on a phone. Only one early phone readout came back (41 ms and 871x). The plan mentions the weekly budget but not 0.9.0, whose lanes were merged on 2026-11-10 while the package is still 0.8.0 and the release gate has not been run.
Verdict: CONFIRMED     Severity: MAJOR     Change follows: yes
Evidence checked:
- Plan line 31-37 (the "Where it runs" column): stages 1, 2, 4 and 5 need the phone. Line 72: "Gate 1 and Gate 2 are decided together from K1 and T2. If both pass, P3b". Lines 13-14 (rules 5 and 6). Line 23: emulator "Not checked". Line 97: "a large use of the weekly budget". Grep of the plan for "0.9.0": only line 42 ("measured in 0.9.0").
- `ls /dev/kvm` reports "No such file or directory" (no emulator acceleration here).
- docs/plans/PROGRESS-2026-11-08.md:11 "Phone check-lists 5 and 6 are the owner's and not done." :59 "Phone check-lists 5, 6 and later 7 are the owner's."
- 15e lines 738-743: "phone check-list 1 not yet done" through "phone check-lists 1 to 4 not yet done".
- README.md:244-253 (release table): 0.3.0, 0.4.0, 0.4.1, 0.5.0, 0.6.0 and 0.7.0 "not seen on a phone"; 0.8.0 "not seen on a phone over Wi-Fi". README.md:448 on the speed test: "Not measured: the test on a phone".
- `git log --since=2026-11-07`: 0.9.0 lanes H, P, K, R and T merged on 2026-11-10; `package.json` "version": "0.8.0". Option B work began on 2026-11-12.
Notes: The claim is accurate. Two qualifications: the ASP.NET host half of Gate 4 can be decided in the container, and the owner did return one early phone readout (15e line 36) and tap tuning (D25), so "rarely", not "never". The owner stopped 0.9.0 and commissioned this plan, so the ordering is the owner's call. Even so, the plan should say what it displaces, because 0.9.0 is merged but has not been through its release gate. The proposed change is proportionate: one question to the owner, a section 7 row for "phone numbers not returned", and container-only work as the default.

---

## Summary

| ID | Verdict | Severity |
|---|---|---|
| P-1 | PARTLY | MAJOR |
| P-2 | CONFIRMED | NONE |
| P-3 | CONFIRMED | MAJOR |
| P-4 | PARTLY | MAJOR |
| P-5 | CONFIRMED | MAJOR |
| P-6 | CONFIRMED | MAJOR |
| P-7 | REFUTED | NONE |
| P-8 | CONFIRMED | MAJOR |

## Sources used

- Repository (worktree HEAD `05795ff`):
  - `docs/plans/dotnet-option-b-prototype.md` (all 136 lines).
  - `docs/plans/air-slice-wind-detail-honest-speed.md` lines 20-50, 89, 121-126, 738-743, 949 and 1000-1029.
  - `docs/plans/PROGRESS-2026-11-08.md`.
  - `README.md` lines 31, 240-253, 395-424, 448, 1563-1567 and 1611-1612.
  - `docs/ARCHITECTURE.md` lines 425-427.
  - `desktop/README.md` lines 388-402.
  - `src/core/rng.ts`, `src/embers/sampling.ts`, `src/ui/speedTest.ts`, `src/ui/screens/sim/speedModel.ts`, `src/ui/settings.ts:74`, `src/ui/session.chaos.test.ts:111`.
  - `android/variables.gradle`, `prototypes/dotnet-b/README.md`, `package.json`.
  - Line counts with find, cat and `wc -l`; `git log`.
- The artifact text, extracted to stdout: `/tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/firesim-dotnet.html`.
- Local .NET SDK: `packs/Microsoft.Android.Sdk.Linux/37.2.31/targets/Microsoft.Android.Sdk.SupportedPlatforms.targets:13`.
- https://learn.microsoft.com/en-us/dotnet/core/compatibility/maui/11/android-minimum-api-level (2026-11-10)
- https://learn.microsoft.com/en-us/dotnet/maui/whats-new/dotnet-11 (2026-09-10)
- https://devblogs.microsoft.com/dotnet/dotnet-maui-moves-to-coreclr-in-dotnet-11/ (2026-05-13)
- https://developer.android.com/jetpack/androidx/releases/webkit (1.18.0, 2026-10-21; read 2026-11-12)
- https://v8.dev/features/simd (updated 2022-11-06)
- https://developer.chrome.com/blog/new-in-webgpu-146 (2026-02-25)
- Search summaries only, not opened: blink-dev "Intent to Ship: WebGPU Compatibility mode"; https://github.com/dotnet/runtime/issues/129900; https://github.com/MudBlazor/MudBlazor/issues/12387
