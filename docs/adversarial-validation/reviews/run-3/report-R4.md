# R4 | plans / Alternatives

### R4.1 The Stage 1 speed gate has no defined TypeScript baseline and never tests the in-TypeScript speed routes D34 already allows
- Where: `docs/plans/dotnet-option-b-prototype.md:34` (Gate 1: "All-core C# is under 1.5× the TypeScript on desktop, or under 2.0× on the phone") and `:40` ("benchmark each against the TypeScript in Node on identical inputs"). Snapshot path: /tmp/claude-0/-home-user-FireSim/87003abe-40a8-5b42-ac05-c1f8b4f0083f/scratchpad/run3/snapshot/docs/plans/dotnet-option-b-prototype.md
- Evidence: D34 (`docs/plans/air-slice-wind-detail-honest-speed.md:121`) says "Speed beyond one core comes from threads, and from WebAssembly or WebGPU for one hot loop only if the measurement says so, within the TypeScript project." Section 15e (same file, around line 1014) gives Amdahl upper bounds for threads on 4 cores: 1.9x for the Standard air and 2.6x for the High air. A 1.5x bar for all-core C# is therefore within reach of an in-TypeScript route that the plan never measures. The plan does not say whether the TypeScript side is one thread or all cores; the Stage 1 text reads as one Node process. A grep of the plan finds no mention of WebAssembly, WebGPU or threads.
- Already covered?: no. Section 7 (`:90`) says "The Node host already gives the desktop its speed", which describes the current host. It does not test the in-TypeScript speed-up routes and does not fix the baseline.
- Severity: must-fix
- Confidence: medium (the omission is certain; whether it changes the outcome depends on the unstated baseline)
- Suggested change: State the TypeScript baseline (one thread and all cores, both reported). Add a Stage 1 arm that measures the D34-permitted route (worker threads, and a WebAssembly hot loop only if the first measurement justifies it) against the same bar, so a Gate 1 pass is read as "C# beats the best in-TypeScript route", not "C# beats TypeScript".

### R4.2 The plan does not name its alternatives or say why B beats them
- Where: `docs/plans/dotnet-option-b-prototype.md:3` ("Option B is described in the artifact ... https://claude.ai/artifact/VsrSVEJaknFbyWuQh7Svx9"). The plan never mentions option A or option C.
- Evidence: The artifact is unavailable to this review. The repo already lists the candidate alternatives in `docs/plans/air-slice-wind-detail-honest-speed.md` section 15e "Options, roughly cheapest first": a desktop shell (Electron or Tauri), more cores in JavaScript, WebAssembly, WebGPU, a native Rust or C++ solver, and remote compute. D34 (`:121`) also records that the .NET idea was "weighed with you and set aside". A reader of the plan alone cannot see what B is being compared with.
- Already covered?: no. The plan points to the artifact, but the artifact is outside the plan, and section 7 treats the "Node host" as the only fallback.
- Severity: should-fix
- Confidence: high
- Suggested change: Add a short table with each option (the current Node host, C#, and the 15e options 2 to 6 that remain open), its cost, its D34 status, and the stage at which it is tested or dismissed.

### R4.3 A native Rust or C++ core, or a native plugin inside the existing Capacitor app, is never considered
- Where: `docs/plans/dotnet-option-b-prototype.md:53` (Stage 5: "A MAUI shell serves from a different origin ... what a migration would take"). The plan has no mention of Rust or C++ anywhere.
- Evidence: Section 15e option 6 (`docs/plans/air-slice-wind-detail-honest-speed.md`) names "A native solver (Rust or C++)" as the fastest option, with the two-codebase drift risk. D34 rejects "native or third-language rewrite" for the same two-solver reason, and that reason applies to C# as much as to Rust or C++. So the plan needs its own case for C# over those options. The plan also spends a stage on origin and saved-data migration that a native module inside the existing Capacitor WebView might avoid. That claim is unverified here: the sources do not show whether a Capacitor native plugin keeps the `https://localhost` origin.
- Already covered?: no. The plan has no comparison of C# with Rust, C++, or a Capacitor native plugin.
- Severity: should-fix
- Confidence: medium (the omission is certain; the origin benefit is not verified)
- Suggested change: Add Rust or C++ (and the Capacitor native-module variant) as named alternatives with the same gates, or record in the plan why they are excluded and how that exclusion was decided.

### R4.4 The case against keeping one TypeScript solver rests on the speed gate alone; the parity cost D34 named is not weighed
- Where: `docs/plans/dotnet-option-b-prototype.md:93` ("All pass ... D34 would then be reopened by the owner") and `:97` (section 8, cost counted in agent runs only).
- Evidence: D34 (`docs/plans/air-slice-wind-detail-honest-speed.md:121`) says the .NET idea was set aside "to avoid maintaining two solvers". The plan's own Stage 3 bars (`:48` and `:128` to `:134`) make parity a standing obligation: the random stream and draw order must be ported exactly, and every later model change has to be re-checked against the bars. None of this recurring cost appears in sections 6 to 8. Section 7 mentions only the one-time port of about 25,000 lines.
- Already covered?: partly. Section 7 says the owner reopens D34 after the report, which leaves the decision to the owner, but the owner is not given the upkeep cost of the option the plan is testing.
- Severity: should-fix
- Confidence: high
- Suggested change: Add a line to section 8 and to the all-pass row of section 7 stating the ongoing cost of two engines: what each future model change would cost to port and re-check, and whether the parity tests would run in CI.

### R4.5 "No speed argument for B anywhere" overreaches the desktop-only failure case
- Where: `docs/plans/dotnet-option-b-prototype.md:90` (section 7: "Gate 1 fails | No speed argument for B anywhere. Stop."). Gate 1 at `:34` is a stop-if on either surface ("on desktop, or ... on the phone").
- Evidence: The Gate 1 stop line is stated per surface. A desktop-only failure therefore says nothing about the phone, yet the outcome row says "anywhere". The section 15e measurements support the desktop claim, and the plan has no row for "desktop fails, phone passes".
- Already covered?: no.
- Severity: nitpick
- Confidence: medium
- Suggested change: Split the Gate 1 outcome row by surface, or change "anywhere" to "on the desktop", and add the missing row.

Totals: 5 findings (must-fix 1, should-fix 3, nitpick 1)
Checked and found correct:
- D34 is still in force, and the plan changes no app source, `src/` or release (`dotnet-option-b-prototype.md:5` against D34 at `air-slice-wind-detail-honest-speed.md:121`).
- The desktop-speed claim in section 7 holds on the repo's own numbers: 10 m, 6 km, fast tier, 4 h in about 3 minutes on one thread (section 15e, around line 1009 of the master plan).
- The Amdahl bounds of 1.9x (Standard air) and 2.6x (High air) on 4 cores match the master plan's section 15e text (around line 1014).
- The WebAssembly SIMD gain of 1.5 to 3x in `docs/research/07-fire-atmosphere-coupling.md:1042` is labelled [H], a hypothesis, so the plan is not wrong to leave it out of the gates.
- Stage 5's note that the WebView origin is `https://localhost` under Capacitor is consistent with the 0.8.0 decision cited in that section.
Could not check:
- The artifact VsrSVEJaknFbyWuQh7Svx9, which the plan says describes options A and C. Whether it compares them is unknown.
- Whether the TypeScript side of Stage 1 runs on one thread or all cores. The plan text does not say, and the benchmark harness is not in the pack.
- Whether a Capacitor native plugin keeps the `https://localhost` origin. The sources do not cover it.
Verdict: Fix first
