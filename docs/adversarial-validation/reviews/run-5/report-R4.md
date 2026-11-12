# R4 | plans / Alternatives

### R4.1 The plan never measures the in-TypeScript route that D34 names as the first step
- Where: `docs/plans/dotnet-option-b-prototype.md` line 5 ("Decision D34 (one solver, in TypeScript) stays in force"). No alternative appears anywhere in the plan: no WebAssembly, no TypeScript threads, no comparison row in section 7. Gate 1 (line 34) and Stage 1 (line 40) compare only C# with TypeScript.
- Evidence: `docs/plans/air-slice-wind-detail-honest-speed.md`, D34 (line 121): "Speed beyond one core comes from threads, and from WebAssembly or WebGPU for one hot loop only if the measurement says so, within the TypeScript project." `docs/research/09-mobile-tech-stack.md` section 4.3 (lines 367-371): "Start in TypeScript on `Float32Array`s ... Port only the measured hot loop to WASM SIMD ... Expect at most about 4x." `docs/research/00-synthesis.md` line 2260 gives WASM SIMD as "1.5-3x". The TypeScript kernels already use typed arrays (`FireSpreadModel.ts`: 77 `Float32Array` references; `levelSet.ts`: 31), so the in-TypeScript route is cheap to try. Section 7 ("All pass: B is technically feasible ... D34 would then be reopened") makes B the answer without ranking it against this route.
- Already covered?: No. Line 90 says the Node host "already gives the desktop its speed", but that is the consequence of Gate 1 failing. It does not address the measured in-TypeScript alternatives. The work could say the plan is a feasibility question by design. That does not cover the reopen recommendation in section 7.
- Severity: must-fix
- Confidence: high
- Suggested change: Before Gate 1, measure TypeScript on all cores (worker threads) and a WASM SIMD version of the same hot loop on the same fixture, and report B against the best of those, not against single-thread TypeScript.

### R4.2 Gate 1 does not say how many cores the TypeScript side uses, and its bar sits inside the threading ceiling the repo already measured
- Where: Gate 1 (line 34): "All-core C# is under 1.5x the TypeScript on desktop, or under 2.0x on the phone". Stage 1 (line 40): "benchmark each against the TypeScript in Node".
- Evidence: `docs/plans/air-slice-wind-detail-honest-speed.md` section 15e (line 1014): "Amdahl upper bounds on 4 cores: the air alone 1.9x (Standard) and 2.6x (High); the fire alone 1.8 to 2.0x". Line 1018: threads "would help the 3-D air by at most about 2 to 2.6x on 4 cores". Read as single-thread TypeScript (the plan does not say otherwise), the gate compares C# on four cores with TypeScript on one, so a pass at 1.5x can still sit below what TypeScript on four cores could reach. The gate also measures one kernel, not the run. The fire is 58 % of fast-tier time (line 1014), so a 3x faster fire kernel gives about 1.6x for the whole run (my arithmetic: 1 / (0.42 + 0.58 / 3)).
- Already covered?: No. Stage 1 gives "1 to 4 threads" for the C# arms only.
- Severity: should-fix
- Confidence: high
- Suggested change: State the TypeScript core count in Gate 1, add a TypeScript all-core arm, and gate on whole-run speed-up as well as on the kernel.

### R4.3 The phone case for C# does not weigh the in-app alternatives against the origin and saved-data cost the plan itself lists
- Where: Stage 5 (line 53): "A MAUI shell serves from a different origin. Test what survives an install over the current APK." Gate 1 phone bar (line 34): "under 2.0x on the phone". No phone alternative is named.
- Evidence: `docs/research/09-mobile-tech-stack.md` lines 107-115 and 341: SharedArrayBuffer and WASM threads are unsupported in Android WebView, so a threaded in-app route is closed. Single-thread WASM SIMD on the existing Capacitor origin is the repo's own recommended next step (lines 368-371). `docs/plans/air-slice-wind-detail-honest-speed.md` line 907: "A native Android plugin would be faster but is new native code and was not evaluated." Neither the WASM SIMD route nor a native Android kernel appears in the plan. The WASM route keeps the origin and the saved sites, which is the cost Stage 5 spends most of its effort on.
- Already covered?: No. Stage 5 lists the origin change as a cost of B, but nothing says that cost could be avoided.
- Severity: should-fix
- Confidence: medium (the WASM SIMD gain on the phone is unmeasured; the research gives estimates only)
- Suggested change: Add a single-thread WASM SIMD hot loop in the existing WebView as a phone arm of Stage 1, measured on the phone, and state what B gains over it.

### R4.4 The desktop case for an ASP.NET Core host does not say what it gains over the Node host already built
- Where: Stage 4 (line 51): "with the C# engine replacing the Node host". Section 7 (line 91): "B can only be a desktop-host design (ASP.NET Core)". Line 90: "The Node host already gives the desktop its speed."
- Evidence: `docs/ARCHITECTURE.md` line 22 records the Node desktop host (0.8.0): one `worker_threads` worker per session running the same `SimHost`, with a pairing code and `--lan`. Its source is in `desktop/` (`main.ts`, `engine.ts`, `lan.ts`). The plan never mentions `desktop/` and does not say why an ASP.NET host beats extending it.
- Already covered?: Partly. Line 90 treats the Node host only as a speed baseline, and the speed comparison in Gate 1 is with single-thread TypeScript, not the Node host with threads. No non-speed reason is given.
- Severity: should-fix
- Confidence: high
- Suggested change: Name what an ASP.NET host offers that the Node host cannot (deployment, shared code with the phone, or a stated cost), or compare with the Node host using worker threads.

### R4.5 The plan does not name option A or say what B is being chosen over
- Where: line 3: "Option B is described in the artifact 'FireSim on .NET' (https://claude.ai/artifact/VsrSVEJaknFbyWuQh7Svx9)". The plan never names option A or any other option.
- Evidence: The pack says the artifact is not available to this review, so its content is unverified. A grep of the snapshot docs for "option a" found nothing, so the comparison is not written anywhere I can read.
- Already covered?: Partly. Line 3 points to the artifact, which the owner has read. A reader of the plan alone cannot see the comparison.
- Severity: nitpick
- Confidence: medium
- Suggested change: One sentence naming option A and the reason B was chosen over it, or a pointer to the artifact section that makes that case.

Totals: 5 findings (must-fix 1, should-fix 3, nitpick 1)
Checked and found correct:
- The TypeScript baseline is not naive: `FireSpreadModel.ts` and `levelSet.ts` already use `Float32Array`, so data layout alone is unlikely to be the main gap.
- The plan's D34 status (line 5) matches the D34 entry in `docs/plans/air-slice-wind-detail-honest-speed.md` (line 121): one TypeScript solver, no C# port.
- The plan's machine (4 cores, 16 GB, line 24) matches the 15e measurement machine (one 4-vCPU shared machine), so the 15e Amdahl figures apply to this container.
- The plan does not rely on WASM threads on the phone, so it does not depend on the Android WebView gap that research note 09 records.
- The Gate 2 and Gate 3 outcomes in section 7 follow from the gates as written.
Could not check:
- The artifact "FireSim on .NET", which holds option A and the case for B. It is not available to this review.
- Whether WASM SIMD runs in the Android WebView the app uses. Research note 09 (line 364) lists Chrome 91 and does not name Android WebView.
- Whether the owner weighed the in-TypeScript route outside the snapshot. Only the snapshot was read; no git history.
Verdict: Fix first
