# R5 | plans / Cost and commitment

### R5.1 The plan has agents download toolchains and asks the owner to sideload APKs, with no ask-first step, although the owner's standing instructions forbid it without approval.
- Where: §2 Permission row: "Running the downloaded `dotnet-install.sh` was refused by the auto-mode classifier. The plan installs the SDK from the official tarball instead, verified against Microsoft's published SHA-512". §5: "Install the benchmark and transport APKs (debug builds, sideload)". §3 and §4 also add downloads of the Android SDK, MAUI workloads, Microsoft OpenJDK and NuGet packages.
- Evidence: The owner's global CLAUDE.md (in the session context, not in the pack) says the antivirus is not active, and until the owner says it is back, agents download only signed files from trustworthy sources and ask first for anything else. The SDK tarball is not individually signed, and its checksum comes from the same host. After the classifier refused one route, the plan takes another route for the same action instead of asking. The plan never mentions the antivirus restriction.
- Already covered?: no. §2 says "If that is refused too, stage 0 stops and the owner decides", which covers a second refusal only. It does not cover the owner's ask-first rule, and it says nothing about the Android SDK downloads or the sideloaded APKs.
- Severity: must-fix
- Confidence: high on the plan text; medium that the tarball falls outside the owner's signed-file exception.
- Suggested change: Require the owner's explicit approval before each download, install or sideload, cite the antivirus note, and treat a refused action as a stop rather than a reason to try another route.

### R5.2 Gate 3 depends on work that no stage or agent owns.
- Where: §10: "**Still to run** (not done by P3a): 30-seed TypeScript ensembles, standard and high at 6 km, and timings on a quiet machine." The loose bar in the §10 table: "the mean burnt area over 30 seeds within 12 % of the TypeScript mean".
- Evidence: The agent table in §4 and the stage table in §3 name no agent or stage for these runs, and §8 does not count them. The loose bar cannot be evaluated without the 30-seed ensembles.
- Already covered?: no. §10 records them as a note, not as a scheduled item.
- Severity: should-fix
- Confidence: high
- Suggested change: Give the ensembles and the quiet-machine timings a stage, an owner agent and a compute estimate before Gate 3 is set.

### R5.3 Gate 1 can stop the project on numbers the plan itself calls indicative.
- Where: §1 rule 3: "Container numbers are desktop-class and noisy (4 shared cores, 16 GB) and are labelled *indicative*." Stage 1 gate: "All-core C# is under 1.5× the TypeScript on desktop". §2: the machine is "shared with every agent".
- Evidence: The Gate 1 stop test uses container timings taken on a machine shared with other agents. The plan does not say which numbers decide the gate, and the only scheduled route to quiet timings is the unscheduled work in §10 (R5.2).
- Already covered?: partly. Rule 3 labels the numbers but does not say what the gate does with them.
- Severity: should-fix
- Confidence: medium
- Suggested change: State whether Gate 1 is decided on container or phone numbers, and state the noise margin a result must clear before it stops the project.

### R5.4 The cost estimate counts agent runs only, and it does not match the plan's own agent table.
- Where: §8: "About ten to twelve agent runs if every gate passes, fewer if one fails early. ... This is a large use of the weekly budget compared with the earlier lanes". §4 table: "P3c-e port | 3 | ... split by area"; §3: "3c to 3e".
- Evidence: §4 has 12 agent slots (S0, K1, T2, P3a, P3b, P3c, P3d, P3e, C3, I4, R5, V). With the port split as §3 says, the minimum is 12, so "ten" is below the plan's own count. The estimate has no allowance for retries, for the Android build fallback in §5, for the 30-seed ensembles (R5.2), or for compute time. The owner's phone time, which the stated purpose names as a decision cost, is not counted: §5 asks the owner to install, run and paste back results for K1, T2, Gate 1 and Gate 2, I4 and R5.
- Already covered?: no. "the gates exist so that a failed stage stops it early" limits spend on failure only; it gives no budget for the passing path.
- Severity: should-fix
- Confidence: high
- Suggested change: Count the 12 slots, add a retry allowance and the expected phone round trips, and give compute hours for the ensembles and benchmarks.

### R5.5 Origin and saved-data risk is tested last, after the shell is built, and the test cannot stop the project.
- Where: §3 stage 5 detail: "the app's saved sites and runs live in the WebView origin, `https://localhost` under Capacitor ... A MAUI shell serves from a different origin. Test what survives an install over the current APK." Stage 5 gate: "Informational: produces the list the owner decides from". Stage 4 builds "MAUI shell + existing page".
- Evidence: The plan already states that the MAUI shell changes the origin, so saved data would not carry over without a migration. The stage 4 gate does not test it. §7 "All pass" then lists "the saved-data migration from stage 5" as remaining cost, with no measure, and stage 5 is informational, so it cannot stop the project.
- Already covered?: partly. Stage 5 names the risk, but its placement after the shell work and its non-gating status leave a possible migration blocker unbounded at the point where the owner decides.
- Severity: should-fix
- Confidence: high
- Suggested change: Move a data-survival check into stage 0 or stage 4 with a stop condition, or state that stage 4 is not built until it has run.

### R5.6 Fixtures and evidence live only in a session scratchpad.
- Where: §1 rule 2: "They are not committed (they are megabytes); the exporter is. They are kept in the scratchpad." Gate 3 bars (§10) compare against them, and §10 cites "41 fixture folders".
- Evidence: The session environment describes the scratchpad as session-specific. V must "re-run one number per stage" (§4), and C3 and P3c-e need the fixtures. The plan gives no way to rebuild the 41 folders in a later session except rerunning the exporter, and does not state that cost.
- Already covered?: no.
- Severity: should-fix
- Confidence: medium (depends on how long the scratchpad persists)
- Suggested change: Commit a manifest with file hashes and the exporter command, or keep the fixtures in a location the owner controls, and state the cost of regenerating them.

### R5.7 The exact random-stream decision carries a fallback that swaps the tight bar for a looser one, so a failed port passes instead of stopping.
- Where: §10: "**Decision taken for stage 3.** The slice ports the TypeScript random generator and its draw order exactly, so that the tight column applies. If the generator cannot be reproduced bit for bit, the loose ensemble bar applies and the report says so."
- Evidence: The exact port is the expensive path, and the plan pre-agrees that failing it moves to a bar that is met by a mean over 30 seeds, which needs the unscheduled ensembles (R5.2). The decision is recorded as taken by the plan's author, not the owner, although §3 says the owner may change thresholds before a stage starts.
- Already covered?: partly. The report must disclose the fallback, which is covered. The gate still passes by fallback, and nothing requires owner approval before it is used.
- Severity: should-fix
- Confidence: medium
- Suggested change: Require the owner's approval before the fallback bar is used, and say in the gate whether the tight bar is mandatory.

### R5.8 The loopback engine is built before the interop route is compared.
- Where: §4 I4: "The shell with loopback engine, the ASP.NET Core host, the conformance runs". §3 stage 4 detail: "Loopback exposure on a phone (other apps can reach 127.0.0.1) is measured and written up, against the interop route that opens no socket."
- Evidence: Stage 2 already tests the BlazorWebView JavaScript interop transport (option a), so comparison data exists before stage 4. Stage 4 still builds the loopback engine first and only then writes the comparison. If interop wins, that work is discarded. No step between stage 2 and stage 4 decides the transport.
- Already covered?: no.
- Severity: should-fix
- Confidence: medium
- Suggested change: Choose the transport at Gate 2 from the stage 2 numbers, before building the stage 4 shell.

Totals: 8 findings (must-fix 1, should-fix 7, nitpick 0)
Checked and found correct:
- §3 and §10 line counts match the snapshot: `src/fire/spread/FireSpreadModel.ts` 1,991; `src/embers/EmberModel.ts` 2,271; `src/atmosphere/solver.ts` 880.
- §4 "Order" matches the agent table: S0 first, then K1, P3a and T2 in parallel, then the gates.
- §7 outcomes match the §3 gates (Gate 1 fail stops; Gate 2 fail leaves a desktop-only design).
- The three-agent concurrency cap in §4 is stated and consistent with the §2 shared-machine note.
- §1 rule 6 (stop at a failed gate and wait for the owner) is stated and applies to every gate.
Could not check:
- "about 25,000 lines and 15,000 lines of tests" (§7): the plan does not list the folders. The snapshot's non-test sources in `src/fire`, `src/embers` and `src/atmosphere` total 17,017 lines, so 25,000 holds only if other folders are counted. The test total cannot be separated.
- The "weekly budget" in §8: the pack has no budget figures.
- Download sizes and times for the Android SDK, MAUI workloads and Microsoft OpenJDK: not in the pack, and no network check was run.

Verdict: Fix first
