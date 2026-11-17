# Batch P: premise and decision (8 items)

Follow VERIFY-COMMON.md. Do Part 1 for an item (investigate the question, write your own answer) before you read that item in Part 2.

## Part 1: the questions

- **P-1.** Is there any measured, user-visible limit in the current app (phone or desktop) that a 2 to 3 times faster solver would remove? What do the repository's measurements say about phone and desktop headroom?
- **P-2.** What is the minimum Android API level supported by .NET MAUI apps targeting .NET 11?
- **P-3.** What reason did decision D34 give for keeping one solver in TypeScript, and does the prototype plan's section 7 say what evidence would justify reopening D34?
- **P-4.** Does the plan record why the owner wants .NET (UI language, one codebase, packaging, skills, speed)? Does any stage test a .NET shell around the existing TypeScript app (no solver port)?
- **P-5.** Under option B, which parts of the product would still need a solver that runs as JavaScript in a browser or in Node?
- **P-6.** As of November 2026, what routes to more compute exist for the TypeScript app inside an Android WebView without porting the solver (threads with SharedArrayBuffer, WebAssembly SIMD or threads, WebGPU, algorithmic changes), and does the plan compare B against any of them?
- **P-7.** How does FireSim's simulation generate its random numbers, and could the sequence be reproduced exactly in another language?
- **P-8.** What does the plan do if the owner does not run the phone stages or does not send the numbers back? What is the record of phone checks being returned in this project, and does the plan weigh its cost against the pending 0.9.0 release?

## Part 2: the claims (read each only after answering its question)

**P-1.**
Claim: No measured shortfall exists that a faster solver would fix: on the only phone measured, the 3-D step took 41 ms against the 198.4 ms limit (4.8 times headroom), and one desktop thread already runs 10 m cells at 77 times real time. A 2 to 2.6 times gain crosses no speed step. A free stage 0 (the owner runs the app's built-in speed test and reads the debug statistics on the current APK) could end the question before any port.
Pointers: `README.md` around lines 400-413 ("Only one phone so far ... 41 ms ... 4.8 times"); `docs/ARCHITECTURE.md` around 424-427; `docs/plans/air-slice-wind-detail-honest-speed.md` around lines 1012-1018 ("10 m 47.0 s (77x)", "the speed the desktop already has is more than a 10 m run needs"); `src/ui/session.chaos.test.ts:111` speeds `[1, 60, 600, 3600, Infinity]`; `src/ui/speedTest.ts`.
Proposed change: add a stage 0 premise check: name the user-visible outcome B must change, have the owner run the speed test now, and stop if the phone has ample headroom and no other reason is given.

**P-2.**
Claim: The minimum Android API level for .NET MAUI apps targeting .NET 11 is 24 (Android 7.0).
Pointers: Microsoft Learn, "What's new in .NET MAUI for .NET 11".
Proposed change: none.

**P-3.**
Claim: D34 was decided on cost (maintaining two solvers), not on feasibility, so section 7's "All pass: B is technically feasible ... D34 would then be reopened" treats feasibility as a reason to reopen, without stating what evidence about that cost would justify it.
Pointers: `docs/plans/air-slice-wind-detail-honest-speed.md` D34 (around line 121) and D39 (around 126); plan section 7, "All pass" row.
Proposed change: add "evidence needed to reopen D34": a user-visible benefit, B beating TypeScript with workers/WASM/WebGPU on a mid-range phone, an answer to the two-solver question, the cost of revalidation, and the opportunity cost.

**P-4.**
Claim: The owner's reason for wanting .NET is not recorded, so the plan may answer a different question; the costs that dominate B (Razor screens: `src/ui` about 59,600 lines including 23,800 of tests; 20,700 lines of Playwright e2e; the browser path; data migration) sit outside every gate; and the cheap route the artifact itself recommended (MAUI HybridWebView around the unchanged app, solver untouched) is tested by no stage, because stage 4 combines the shell with the C# engine.
Pointers: plan section 1 ("What this is not"), section 3 stage 4, section 7; artifact "My read" section; line counts with `wc -l` over `src/ui` and `e2e`.
Proposed change: ask the owner one question (which goal); add a stage 4-0: the current app unchanged inside a MAUI HybridWebView with its TypeScript worker and the saved-data check.

**P-5.**
Claim: Under B the TypeScript solver cannot retire: the app in a desktop browser and as a PWA, the page a phone's browser opens from the desktop host, the preloaded engine behind "Continue on this device", the Node validation suite and the Playwright e2e all run the TypeScript solver; a .NET process exists only in the MAUI shell and the ASP.NET host, and Blazor WebAssembly in .NET 11 runs on Mono with no real threads and unmeasured speed. So B means two solvers for good (the cost D34 avoided) or dropping those paths, and the plan's section 7 mentions neither.
Pointers: `desktop/README.md` around 396-398 (the idle worker script fetched from the host); `docs/plans/air-slice-wind-detail-honest-speed.md` around 1009 and 1022 (browser, PWA, headless Node); D34; the artifact (Node host "retired").
Proposed change: before any further port, a required owner decision on what runs where without a .NET process, with the cost of keeping two solvers in agreement if any path keeps TypeScript.

**P-6.**
Claim: Cheaper routes inside D34 now exist and the plan compares none: androidx.webkit 1.18.0 (2026-10-21) adds a profile-level cross-origin-isolated allowlist that enables SharedArrayBuffer (and WASM threads) in Android WebView; fixed-width WASM SIMD has followed Chrome in WebView since Chrome 91; WebGPU is reported in WebView around Chrome 146; and the 15c moving-band refinement is estimated at 2.7 times today's 30 m cost against 27 times for uniform 10 m.
Pointers: https://developer.android.com/jetpack/androidx/releases/webkit (1.18.0); plan 15c around line 948 of `docs/plans/air-slice-wind-detail-honest-speed.md`; Chrome WebGPU 146 blog.
Proposed change: a "status quo arm" before or beside the kernel benchmark: split the 3-D air step over 2 to 4 Web Workers in a Capacitor test build, check `crossOriginIsolated` on the owner's phone, report beside the C# numbers.

**P-7.**
Claim: FireSim's simulation draws its random numbers from Math.random(), so the sequence cannot be reproduced in another language.
Pointers: `src/core/rng.ts`, `src/embers/sampling.ts`.
Proposed change: none.

**P-8.**
Claim: Gates 1 (phone half), 2 and 4 can only be decided from the owner's phone, the plan has no "undecided" outcome or time-box, and the record suggests phone results rarely come back: phone check-lists 5 and 6 are not done, releases 0.3.0 to 0.8.0 are "not seen on a phone", and the shipped speed test has not been run on a phone. The plan also does not weigh its spend against the paused 0.9.0 release.
Pointers: `docs/plans/PROGRESS-2026-11-08.md` lines 11 and 59; `README.md` release table and "Not measured: the test on a phone"; plan sections 1 (rule 6), 5 and 8.
Proposed change: ask the owner once whether they will sideload and report this week; otherwise mark phone gates "undecided" and restrict to container work; add a section 7 row for "phone numbers not returned"; agree the order against the 0.9.0 release.
