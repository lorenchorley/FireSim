# R1 | plans / Feasibility

(REPORT_PATH could not be written: the harness refused the file write, so the full report follows here.)

### R1.1 Stage 0 depends on downloads the owner has not approved, and on a workaround for a refused action
- Where: plan section 2, row "Permission": "Running the downloaded `dotnet-install.sh` was refused by the auto-mode classifier. The plan installs the SDK from the official tarball instead, verified against Microsoft's published SHA-512 ... If that is refused too, stage 0 stops and the owner decides." Section 4 and the SKILLS.md clone note ("If the clone is gone, `git clone --depth 1 https://github.com/dotnet/skills.git`") add more downloads: SDK, Android SDK, Microsoft OpenJDK, Maven/Gradle, NuGet, MAUI workloads, the dotnet/skills repository.
- Evidence: The owner's standing instructions in the session (global CLAUDE.md, "Extremely important") say the antivirus is not active, that nothing may be downloaded except signed files from trustworthy sources, and that the owner must be asked before any download. The plan has no owner-approval step for any download. A Microsoft SDK tarball is checksummed, not signed. The fallback after a refused action is a different route to the same download, not a question to the owner.
- Already covered?: No. Section 5 lists what needs the owner's phone, not the owner's approval for downloads. The owner's rule is not mentioned anywhere in the plan.
- Severity: must-fix
- Confidence: high
- Suggested change: Stage 0 starts with one request to the owner listing each download (URL, size, what verifies it), and waits for approval. Drop the "official tarball instead" route for an action the classifier refused.

### R1.2 The Parallel.For form of the stage 1 kernel cannot keep the draw order or update order the plan requires
- Where: plan section 3, stage 1 detail: "Port the chosen kernel three ways (scalar, `Span<T>` with `Vector<T>`, `Parallel.For` with a fixed partition)". Rule 4 of section 1: "The C# solver must give identical results on 1, 2, 4 and 8 threads ... This is a hard requirement."
- Evidence: `src/fire/spread/FireSpreadModel.ts` line 33: "all randomness from the fire RNG stream". `breachDraw` draws `this.rng.next()` per front cell (about line 1504). The debris loop draws `this.rng.poisson`, `this.rng.next()` and `this.rng.range` per burning cell in list order (lines 1954 to 1984). `src/fire/spread/levelSet.ts` lines 392 and 534: hooks run "in band order after the update", and the band is rebuilt in index order; reinitialisation uses fast sweeping in four orderings. `src/embers/EmberModel.ts` line 8 and line 412: one stream-0 `Rng` is copied into a local state and drawn from particle by particle. A fixed-partition `Parallel.For` over these kernels can do one of three things: serialise the draws (then the kernel gains nothing), give each partition its own stream (then it is not the TypeScript stream, and the stage 3 "draw order ported exactly" decision fails), or use double buffering (a different update rule from the in-place TypeScript order). The plan does not say which.
- Already covered?: No. Revision 1 covers vectorisation only ("A narrow-band, branchy spread kernel may not vectorise"). Stage 3's "reductions in a fixed order" does not cover RNG draws or in-place update order.
- Severity: must-fix
- Confidence: high
- Suggested change: For each candidate kernel, state how the parallel form keeps the RNG draws and the update order, or drop the parallel form for stream-consuming kernels. `src/atmosphere/solver.ts` (880 lines, as the plan says) has no RNG calls, so it is the natural candidate for the parallel form.

### R1.3 Stage 4 "the page needs no change" over loopback assumes a cleartext and origin decision that the repository says is the owner's
- Where: plan section 3, stage 4 detail: "The existing page ... in a MAUI shell, with the C# engine replacing the Node host and speaking protocol 2 over loopback, so the page needs no change." Stage 2 transport (c): "a loopback WebSocket from an in-app Kestrel server".
- Evidence: `docs/ARCHITECTURE.md` line 1204: "a plain `ws://` socket from the app's `https://localhost` WebView page needs the cleartext and mixed-content settings loosened: the owner's decision". `docs/plans/0.9.0/CONTRACT-0.9.0.md` line 70 says the same. The plan's own stage 5 says a MAUI shell "serves from a different origin". `CONTRACT-0.9.0.md` line 53 (D36): the host accepts only its own origin, a listed origin, or no Origin. A MAUI shell origin is none of these unless the C# host adds it, which the plan does not mention.
- Already covered?: No. The stage 4 gate covers loopback exposure only.
- Severity: should-fix
- Confidence: medium (the repository's statement is about the Capacitor origin; MAUI WebView behaviour is not checked here)
- Suggested change: Name the cleartext and origin prerequisites for transport (c) and stage 4 as owner decisions, and give the C# host the same origin rule as D36, or choose the interop route for the page.

### R1.4 Stage 3, the largest and most expensive stage, waits on owner phone steps of unstated length, though part of its gate is desktop-only
- Where: plan section 4, "Order": "Gate 1 and Gate 2 are decided together from K1 and T2. If both pass, P3b, then P3c-e and C3, then Gate 3." Section 5: "If it fails, the agents write exact build instructions and the owner builds." Rule 6: the orchestrator "waits for the owner before starting the next stage".
- Evidence: Gate 1 (phone, under 2.0x) and Gate 2 (phone) need phone numbers, which "come only from a phone" (rule 3). Section 2 states no `adb`, no Android SDK and no `dotnet` are present, and section 5 says the Android build "is not guaranteed". The plan gives no timeout and no fallback if the owner's phone step does not happen, and does not say whether the desktop parts of Gate 1 and Gate 3 may run first.
- Already covered?: Partly. Section 5 says what the owner must do, not what the plan does while waiting.
- Severity: should-fix
- Confidence: high
- Suggested change: Let the desktop-only parts of Gate 1 and Gate 3 run while phone results are pending, and state whether stage 3 proceeds on the desktop result alone.

### R1.5 Fs.Tests has no owning agent
- Where: plan section 9 (Revision 1), dotnet-test row: "Stage 3 gets a real test project, `Fs.Tests` ... wired into the solution, for the thread-count test and the contract tests." Section 4 table: S0 scope is the skeleton with five projects (`Fs.Kernel`, `Fs.Bench`, `Fs.Compare`, `Fs.Transport`, `Fs.Host`); P3c-e scope is `Fs.Kernel`; C3 scope is `Fs.Compare`. `prototypes/dotnet-b/README.md`: "Only touch your own folder".
- Evidence: `prototypes/dotnet-b/` contains `Fs.Bench`, `Fs.Compare`, `Fs.Host`, `Fs.Kernel` and `Fs.Transport`, and no `Fs.Tests`. The thread-count test is a stage 3 gate, and `SKILLS.md` gives C3 "comparison and tests", but C3's scope is `Fs.Compare` only.
- Already covered?: No.
- Severity: should-fix
- Confidence: high
- Suggested change: Add `Fs.Tests` to the S0 skeleton and assign it to one named agent (C3 or P3c-e) in the scope table.

### R1.6 Parallel stages do not run in parallel for heavy work
- Where: plan section 4, "Order": "Then K1 and P3a in parallel with T2 (three agents)." Section 2: "Heavy work goes under `flock /tmp/firesim-heavy.lock`." Revision 2: "timings on a quiet machine" is still to run.
- Evidence: K1 benchmarks, P3a fixture generation (41 folders by the plan's own count) and T2 Android or MAUI builds are all heavy and all under the same lock on a 4-core shared machine. The lock serialises them, so the three-agent order is not a time saving for heavy work, and the all-core gate numbers (K1) are only quiet if no other agent holds the lock at the same time.
- Already covered?: No. Section 8 gives run counts, not wall-clock time or lock waiting.
- Severity: should-fix
- Confidence: medium
- Suggested change: Say which steps are heavy, and either estimate the serialised time or run the all-core benchmark in a window with no other heavy work.

### R1.7 Gate 1 wording can be read as the reverse of what is meant
- Where: plan section 3 table, stage 1 gate: "stop if: All-core C# is under 1.5× the TypeScript on desktop, or under 2.0× on the phone".
- Evidence: as written, "C# is under 1.5× the TypeScript" can mean either a time ratio or a speed ratio. Stage 1's question is "Is there a speed-up?", so the intent is a speed-up (TypeScript time divided by C# time) below 1.5.
- Already covered?: No.
- Severity: nitpick
- Confidence: high
- Suggested change: Write the gate as "speed-up (TypeScript time / C# time) below 1.5× on desktop, below 2.0× on the phone".

### R1.8 Fixtures live in a session-scoped scratchpad with no regeneration target
- Where: plan section 1, rule 2: "They are not committed (they are megabytes); the exporter is. They are kept in the scratchpad." `prototypes/dotnet-b/SKILLS.md` gives a clone at `/tmp/claude-0/-home-user-FireSim/.../scratchpad/dotnet-skills/` as the path to read.
- Evidence: the session's scratchpad is session-specific. Stage 3 and the phone steps span days. The stated fallback path points at a different machine's layout (`/home/user/FireSim`). The plan does not say which command regenerates fixtures, or in which folder.
- Already covered?: Partly. The exporter is committed, so regeneration is possible, but the plan does not say how.
- Severity: nitpick
- Confidence: medium
- Suggested change: Name the regeneration command and a fixed fixture location that a later session can find.

Totals: 8 findings (must-fix 2, should-fix 4, nitpick 2)
Checked and found correct:
- Line counts in the plan match the snapshot: `src/fire/spread/FireSpreadModel.ts` 1,991; `src/embers/EmberModel.ts` 2,271; `src/atmosphere/solver.ts` 880.
- `src/core/rng.ts` is mulberry32 on 32-bit integers (`Math.imul`, `>>> 0`), so a bit-exact C# port of the uniform draw is feasible. Only `normal()` (Box-Muller, `Math.log` and `Math.cos`) and the large-mean Poisson path use non-integer math.
- D34 ("one solver") exists in `docs/ARCHITECTURE.md` and the 0.8.0 contract, as the plan says.
- Scenario and snapshot sizes (6.5 MB scenario, 2.2 MB snapshot, about 27 MB/s on loopback) and the 33 MB APK budget match `docs/ARCHITECTURE.md` and `docs/plans/air-slice-wind-detail-honest-speed.md`.
- `tsconfig.json` `include` does not list `prototypes/`, so rule 1's claim that the TypeScript gate is unaffected holds.
Could not check:
- "About 25,000 lines and 15,000 lines of tests" (section 7): the plan does not say which folders make up "the solver", and the folder sums in the snapshot do not settle it.
- Section 2 environment facts (`builds.dotnet.microsoft.com` answers 200 through the proxy; no `adb`; Java version): not in the snapshot.
- The Option B artifact (https://claude.ai/artifact/VsrSVEJaknFbyWuQh7Svx9) is not available. Section 1 "What this is" and the Option B description rest on it.

Verdict: Fix first
