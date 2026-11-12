# R4 | plans / Alternatives

### R4.1 Gate 1 credits a language speed-up that threading alone could supply
- Where: Section 3 table, Stage 1 row: "All-core C# is under 1.5× the TypeScript on desktop, or under 2.0× on the phone". Stage 1 detail: "benchmark each against the TypeScript in Node on identical inputs". No multi-threaded TypeScript arm.
- Evidence: The TypeScript desktop solver runs on one thread. The stretch-goal section of `docs/plans/air-slice-wind-detail-honest-speed.md` says so in "What exists today" and in the "Where the time goes" bullet (about line 1014). That bullet gives Amdahl upper bounds on 4 cores of 1.8 to 2.0x for the fire, 1.9x for the Standard air and 2.6x for the High air. These are estimates, not measurements, but they sit above the 1.5x gate. So a TypeScript build with worker threads could pass Gate 1 without any C#. The gate compares all-core C# with single-thread TypeScript, so it cannot separate a language gain from a threading gain.
- Already covered?: no. Section 1 rule 4 covers thread-count determinism of the C# solver only.
- Severity: must-fix
- Confidence: high
- Suggested change: Gate 1 compares single-thread C# with single-thread TypeScript (the language effect). Report the threading gain as a separate arm, measured against TypeScript with worker threads.

### R4.2 WebAssembly for the hot kernel is not weighed, though it is the cheapest route to the same kernel speed-up
- Where: Section 3, Stage 1 detail: "Port the chosen kernel three ways (scalar, `Span<T>` with `Vector<T>`, `Parallel.For` with a fixed partition)". No WebAssembly arm anywhere in the plan.
- Evidence: `air-slice-wind-detail-honest-speed.md` option 4 ("WebAssembly with threads and SIMD for the hot loops, the 3-D air solver first") and the D34 text (line 121) both allow "WebAssembly ... for one hot loop only if the measurement says so, within the TypeScript project". The app already ships WebAssembly strings (`docs/plans/spikes/S2-bundle/README.md` line 11), so the phone's WebView runs WASM with no new runtime. A WASM kernel would keep the Capacitor shell, the origin and the saved data (the Stage 5 cost), and the existing protocol. On the desktop, the existing Node host (`desktop/`, one worker per session, `docs/ARCHITECTURE.md` line 22) would keep its role. The ASP.NET Core host in Stage 4 is justified only if C# wins, and R4.1 shows that is not yet measured.
- Already covered?: no. The plan names D34 as the status quo but not the WebAssembly option that D34 itself allows.
- Severity: should-fix
- Confidence: high
- Suggested change: Add one WebAssembly arm to Stage 1, on the same kernel and fixtures, or write a short paragraph that says why C# beats it. State the phone cost of each route.

### R4.3 Keeping the Capacitor shell is not weighed; the MAUI origin cost is measured after the choice is made
- Where: Section 3, Stage 4: "MAUI shell + existing page + C# engine over loopback". Stage 5 detail: "A MAUI shell serves from a different origin. Test what survives an install over the current APK and what a migration would take."
- Evidence: Stage 5 itself says the `https://localhost` origin under Capacitor was "kept on purpose in 0.8.0". The plan then takes the MAUI shell as given and asks only what a migration would cost. Stage 5 is informational and cannot stop the plan.
- Already covered?: partly. Stage 5 measures the migration cost, but nothing asks whether MAUI is needed for the C# engine to be tested on the phone.
- Severity: should-fix
- Confidence: medium (I did not check whether a C# engine can sit behind Capacitor without MAUI)
- Suggested change: Before Stage 4 is built, list the shell options (MAUI; Capacitor with a native library behind a plugin) with what each keeps and loses for origin, saved data and build risk.

### R4.4 The two-solver cost that made the owner set .NET aside is missing from what the report brings the owner
- Where: Section 7, "All pass": "The remaining cost is the port of the rest of the solver ... D34 would then be reopened by the owner." Section 6 lists the report contents: one table per gate, what was not measured, and a recommendation.
- Evidence: D34 (`air-slice-wind-detail-honest-speed.md` line 121): the .NET idea "was weighed with you and set aside because it means maintaining two solvers". The agreement bars in Section 10 would have to be re-run on every TypeScript change, and no line of the report template covers that ongoing cost.
- Already covered?: partly. Section 1 keeps D34 in force until the owner decides. The cost the owner named is not in the report.
- Severity: should-fix
- Confidence: high
- Suggested change: Add a "cost of keeping two solvers" section to the report: who keeps the bars green on each TypeScript change, and how often the fixtures and bars are re-run.

### R4.5 Stage 1 re-profiles the scenario the repository has already profiled
- Where: Section 3, Stage 1 detail: "Find the hottest kernel by profiling the TypeScript solver (`node --cpu-prof`) on the Katoomba 6 km fast-tier scenario ... the profile decides."
- Evidence: The stretch-goal section already records the split for the same scenario family: fast tier at 30 m, fire 58 %, embers 13 %, coupling 11 %, air 5 %; Standard 3-D air 63 %; High 82 % (the "Measured" and "Where the time goes" bullets). The plan does not cite it, and its candidate list does not mention the 3-D air as the main cost.
- Already covered?: no.
- Severity: nitpick
- Confidence: medium
- Suggested change: Cite the 2026-11-07 split and say what the new profile adds (for example the phone, or the Katoomba 6 km scenario in the 3-D tiers).

Totals: 5 findings (must-fix 1, should-fix 3, nitpick 1)
Checked and found correct:
- D34 is quoted correctly in the plan's opening section ("one solver, in TypeScript"). The owner's decision text (`air-slice-wind-detail-honest-speed.md` line 121) says the same.
- The desktop host that the Gate 1 fail line relies on exists: `desktop/` runs `SimHost` with one worker per session (`docs/ARCHITECTURE.md` line 22).
- The single-thread claim for the TypeScript desktop solver matches the stretch-goal section's "What exists today" paragraph.
- The phone bundle already contains WebAssembly strings (`docs/plans/spikes/S2-bundle/README.md` line 11).
- Stage 1 and Stage 3 bars are named in the plan's own sections with matching numbers (Section 10). I did not recompute them.

Could not check:
- The artifact "FireSim on .NET" (https://claude.ai/artifact/VsrSVEJaknFbyWuQh7Svx9). The Option B description rests on it, and it is not available to me.
- The claim that the Capacitor origin was "kept on purpose in 0.8.0" (Stage 5). I did not trace it to a decision record.
- Whether a C# engine can run behind Capacitor without MAUI (R4.3 depends on this).

Verdict: Fix first

Note: the write to REPORT_PATH was refused (subagents return findings as text), so this message is the report. Nothing was saved to disk.
