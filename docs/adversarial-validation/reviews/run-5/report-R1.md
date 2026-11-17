# R1 | plans / Feasibility

### R1.1 The stage 3 fallback (TypeScript wind rasters in, atmosphere deferred) cannot drive the embers the plan has chosen to match
- Where: dotnet-option-b-prototype.md line 46: "If the atmosphere is the blocker, the slice may take the TypeScript's own wind rasters as input and defer the atmosphere port; the report then says so." Line 134: "**Decision taken for stage 3.** The slice ports the TypeScript random generator and its draw order exactly, so that the tight column applies."
- Evidence: src/embers/EmberModel.ts `step(dt, wind: WindFn, turb: TurbFn, ...)` (line 649) samples a 3-D wind at arbitrary heights (lines 657, 1263, 1472, 1807) and needs per-column turbulence scales (z_i, w*, u*) from the atmosphere each step (comment line 1430). src/sim/simulation.ts line 1371 passes `this.windFn, this.turbFn`, and line 1548 defines `turbFn = atm.sampleTurb`. Line 27 of the same file: "coupling > 0: atm.addFireHeat(...)" feeds fire heat back into the atmosphere. Surface wind rasters therefore cannot feed the embers, and rasters cannot reproduce the two-way coupling. Embers-on needs either the atmosphere port (src/atmosphere non-test: 6,260 lines; solver.ts 880, atmosphere.ts 1,273) or a per-step export of the 3-D wind and turbulence fields. The plan commits to the embers-on path (line 134) but does not size it.
- Already covered?: no. Line 46 presents the raster fallback as an option; line 134 requires the embers path that the fallback cannot serve. Section 4 leaves the atmosphere to "only if the slice needs it" without an estimate.
- Severity: must-fix
- Confidence: high
- Suggested change: State that embers-on needs the atmosphere wind and turbulence (port, or a per-step 3-D export and a coupling decision), drop the raster fallback for embers-on, and size the slice before the stage 3 decision is recorded.

### R1.2 Gate 1 measures one kernel, but its failure stops the whole programme
- Where: dotnet-option-b-prototype.md line 34: "All-core C# is under 1.5× the TypeScript on desktop, or under 2.0× on the phone". Line 90: "Gate 1 fails | No speed argument for B anywhere. Stop." Line 40: "Find the hottest kernel by profiling ... the profile decides."
- Evidence: The gate compares the chosen kernel alone (line 40: "benchmark each against the TypeScript in Node"). Nothing converts a kernel speed-up into a solver speed-up; the kernel's share of runtime is not a gate input. docs/plans/0.10.0/CONTRACT-0.10.0.md line 7 records "Amdahl bounds of about 1.8 to 2.6 times on four cores for the air alone, a few times at best with everything split", so the repo already holds evidence that parallel gains are capped at solver level. A kernel missing 1.5× does not show that no part of the solver is faster.
- Already covered?: no. Line 29 ("Thresholds are proposals") does not address the scope of the measurement.
- Severity: should-fix
- Confidence: high
- Suggested change: Record the profile share of the kernel and the solver-level speed-up it implies (Amdahl) as part of Gate 1, and word the stop as "this kernel route stops" unless the solver-level figure is also below target.

### R1.3 Gate 1 would be decided on numbers the plan itself calls indicative
- Where: dotnet-option-b-prototype.md line 11: "Container numbers are desktop-class and noisy (4 shared cores, 16 GB) and are labelled *indicative*." Line 34: "on desktop". Line 24: "shared with every agent". Line 72: "Then K1 and P3a in parallel with T2 (three agents)". Line 136: "**Still to run** ... timings on a quiet machine."
- Evidence: prototypes/dotnet-b/reports/3a-tier-difference.md line 4 labels the container timings "indicative for timing" on "one shared 4-core container". The plan schedules no quiet-machine run before Gate 1, and K1's benchmarks run beside T2's Android build and P3a's TypeScript runs. Line 24 says heavy work goes under the flock, but the plan does not say that K1's timing runs take it.
- Already covered?: no. Rule 3 (line 11) covers the labelling, not the gate decision made from those labelled numbers.
- Severity: should-fix
- Confidence: high
- Suggested change: Run the Gate 1 timings under the lock with no other heavy job and record the machine load, or mark the desktop half of Gate 1 provisional until a quiet-machine run confirms it.

### R1.4 The phone half of Gate 1 has no defined baseline
- Where: dotnet-option-b-prototype.md line 34: "or under 2.0× on the phone". Line 40: "benchmark each against the TypeScript in Node on identical inputs read from fixtures."
- Evidence: The only TypeScript comparator the plan defines is Node. A phone has no Node, so the 2.0× phone ratio has no defined TypeScript side (the same JavaScript in the benchmark APK's WebView, for example). Section 5 (lines 74 to 78) lists the owner's phone tasks, but the order (line 72) has no point where work waits for the owner before Gate 1 is decided.
- Already covered?: no. Section 5 names the phone runs but not the baseline they are compared against.
- Severity: should-fix
- Confidence: high
- Suggested change: Name the phone TypeScript baseline (the same kernel and inputs run in the benchmark APK's JavaScript engine) and add an explicit owner wait point before Gate 1.

### R1.5 Fs.Tests is required by the plan but no agent owns it
- Where: dotnet-option-b-prototype.md line 112: "Stage 3 gets a real test project, `Fs.Tests` (MSTest on Microsoft.Testing.Platform), wired into the solution, for the thread-count test and the contract tests". Line 61 (S0): "solution and project skeletons (`Fs.Kernel`, `Fs.Bench`, `Fs.Compare`, `Fs.Transport`, `Fs.Host`)". Section 4 table, lines 59 to 70. Line 57: "scoped to its own subfolder".
- Evidence: No row of the section 4 table names Fs.Tests. S0 does not create it. P3c-e's scope is `Fs.Kernel` and C3's is `Fs.Compare`. prototypes/dotnet-b has no Fs.Tests folder (its project folders are Fs.Bench, Fs.Compare, Fs.Host, Fs.Kernel, Fs.Transport). An agent that creates Fs.Tests would be outside its scope under line 57.
- Already covered?: no.
- Severity: should-fix
- Confidence: high
- Suggested change: Add Fs.Tests to the S0 skeleton list or to P3c-e's scope, and name the agent that owns the thread-count test.

### R1.6 Stage 0 downloads, and a fallback that works round a refused install
- Where: dotnet-option-b-prototype.md line 25: "Running the downloaded `dotnet-install.sh` was refused by the auto-mode classifier. The plan installs the SDK from the official tarball instead, verified against Microsoft's published SHA-512 ... If that is refused too, stage 0 stops and the owner decides."
- Evidence: The owner's standing instructions (C:\Users\lchorley\.claude\CLAUDE.md, "Extremely important") say that while the antivirus is not activated, agents may download only signed files from trustworthy sources and must ask first before downloading anything else. The SDK tarball, the Android SDK and the Gradle and Maven fetches (line 21, line 78) are not shown to be signed, and the plan does not ask the owner. A SHA-512 published beside the file is an integrity check, not a signature. The fallback is a route round a permission refusal, and the owner is asked only if that route is refused too. The plan also does not say which machine the downloads land on: line 24 names a `/tmp` lock, while the review pack's paths are under the owner's Windows profile.
- Already covered?: partly. Line 25 has a stop-if-refused step, but it expects the refusal to be worked round and does not mention the owner's rule on downloads.
- Severity: must-fix
- Confidence: medium (I cannot confirm which machine stage 0 runs on)
- Suggested change: Stage 0 asks the owner before any download, the tarball fallback is removed, and the plan states for each download its source and whether it is signed.

### R1.7 Stage 4 says the page needs no change, but the origin and cleartext rules do change
- Where: dotnet-option-b-prototype.md line 51: "so the page needs no change." Line 53: "A MAUI shell serves from a different origin."
- Evidence: The desktop handshake accepts the host's own origin, an origin on the `--allow-origin` list, or no Origin; any other page is refused (docs/plans/0.9.0/CONTRACT-0.9.0.md line 53; docs/ARCHITECTURE.md line 1186, "A page whose origin is not the host's gets HTTP 403"). A C# host therefore needs an allowlist entry for the shell's origin, which the plan does not mention. docs/ARCHITECTURE.md line 1204 and CONTRACT-0.9.0.md line 70 say a plain ws:// from the app's https://localhost page needs the cleartext and mixed-content settings loosened, which the docs treat as the owner's decision. The plan does not say whether loopback ws:// needs the same change.
- Already covered?: partly. The stage 4 cross-origin spec would catch a refused origin, but the plan does not require the allowlist entry or the cleartext decision.
- Severity: should-fix
- Confidence: medium (I did not verify how the Android WebView treats loopback under mixed-content rules)
- Suggested change: State the shell's origin, the allowlist entry the C# host needs, and whether loopback ws:// requires the owner's cleartext decision.

### R1.8 Stale text and sequencing contradictions
- Where: dotnet-option-b-prototype.md line 40: "`Span<T>` with `Vector<T>`" against line 106: "`Vector<T>` is not the default because its width varies". Line 48 (old agreement bars) against line 126 ("replacing the proposal in section 3"). Line 34: "under 1.5× ... or under 2.0×" reads both ways. Line 72: "Then K1 and P3a in parallel with T2" against line 14 (rule 6, "Stop at a failed gate") and line 90 (Gate 1 fails: stop).
- Evidence: The texts as quoted. P3a runs before Gate 1 is decided, so a Gate 1 stop wastes its work, which rule 6 and section 7 do not allow for.
- Already covered?: partly. Line 126 signposts the bar change, but the old text is not struck.
- Severity: nitpick
- Confidence: high
- Suggested change: Bring the stage 1 and stage 3 detail into line with revisions 1 and 2, write the gate comparison direction explicitly, and say P3a runs at its own risk before Gate 1.

Totals: 8 findings (must-fix 2, should-fix 5, nitpick 1)
Checked and found correct:
- Line counts: src/fire/spread/FireSpreadModel.ts 1,991, src/embers/EmberModel.ts 2,271 and src/atmosphere/solver.ts 880 match the plan's figures.
- Rule 1: the root tsconfig.json `include` list has no `prototypes/` entry, so the TypeScript gate is unaffected.
- The random generator is mulberry32 (src/core/rng.ts) and src/embers/sampling.ts `FastRng` uses the same stream, so an exact port of the generator is possible in principle.
- "Protocol 2" matches code (LINK_PROTOCOL = 2 in src/sim/remote/wire.ts). docs/ARCHITECTURE.md line 1186 shows `"protocol":1` in its hello example, so the doc and the code disagree; the plan should name which one the C# host speaks.
- D34 (one solver) and the 33 MB APK budget are present in the docs as cited.
Could not check:
- Whether builds.dotnet.microsoft.com or the .NET 11 SDK is reachable, or how much disk the container has; I made no network calls and the plan gives no disk figure.
- Whether the Android WebView exempts loopback from its cleartext and mixed-content rules.
- Whether the 30-seed TypeScript ensembles and the 6 km runs fit the time budget; the plan gives no time estimate.
Verdict: Fix first
