# R3 | plans / Failure modes and rollback

### R3.1 Test APK installs on the owner's phone can wipe saved sites and runs, with no way back
- Where: plan line 76 (section 5: "Install the benchmark and transport APKs (debug builds, sideload) and run their screens"); line 53 (stage 5: "the app's saved sites and runs live in the WebView origin ... Test what survives an install over the current APK").
- Evidence: The plan says saved data lives in the WebView origin, which is app-private storage. It never says whether the test APKs use the production application ID. If they do, and the signing key differs, Android refuses the install, and the only way forward is uninstalling, which deletes that storage. Stages 2, 4 and 5 give no backup step, no separate ID and no spare-device rule. The snapshot has no android/ folder, so the production ID could not be checked.
- Already covered?: No. Stage 5 measures what survives an install, but nothing precedes the install on the owner's phone.
- Severity: must-fix
- Confidence: medium (depends on the production ID and signing key, which I could not check)
- Suggested change: Give every test APK its own application ID, state that no stage installs over the production app, and require an export of saved sites and runs, or a spare phone, before stage 5.

### R3.2 Stage 3 bar was loosened after seeing the data, and the loose bar cannot catch moderate port bugs
- Where: line 122 ("burnt area has a coefficient of variation of 19 %" per seed); line 132 ("the mean burnt area over 30 seeds within 12 % of the TypeScript mean"); line 134 ("the loose ensemble bar applies and the report says so"); line 29 ("The owner may change any of them before a stage starts").
- Evidence: With a per-seed CV of 19 % over 30 seeds, the standard error of the mean is about 19/sqrt(30), roughly 3.5 %. A 12 % bar is about 3.4 standard errors, so a port whose burnt area is off by about 10 % would pass. The 30-seed ensembles that would show whether 12 % is reachable are listed as "still to run" (line 136). The change was made by the plan's author partway through stage 3, not by the owner before the stage started.
- Already covered?: Partly. Section 10 explains why per-seed bars cannot hold, so the change has a motive. It gives no reason why 12 % would detect a real defect, and the change is not put to the owner.
- Severity: should-fix
- Confidence: medium (the CV comes from six seeds, so the standard-error figure is rough)
- Suggested change: Fix the 12 % bar only after the 30-seed ensemble exists, or show it catches a known injected bug, and have the owner approve the loosened bar before stage 3 is judged.

### R3.3 Gate 1 direction and noise handling are undefined, so a noisy run can stop the whole programme
- Where: line 34 (stage 1 gate: "All-core C# is under 1.5× the TypeScript on desktop, or under 2.0× on the phone"); line 11 (rule 3: container numbers are "noisy"); line 24 (the machine is "shared with every agent"); line 14 (rule 6: stop at a failed gate).
- Evidence: "Under 1.5×" can mean a speed-up below 1.5 (stop) or a C# time below 1.5 times the TypeScript time (which passes when C# is slower). The stage's question, "Is there a speed-up?", suggests the first reading, but the gate does not say so. Nothing sets a number of repeats, a spread limit, or a rerun before a stop, and rule 6 stops the programme on a single result.
- Already covered?: No. Rule 3 labels the numbers as indicative, but gives no repeat or variance rule. The heavy-work lock (line 24) limits contention and does not add repeats.
- Severity: should-fix
- Confidence: medium-high
- Suggested change: State the ratio as TypeScript time over C# time with "stop if below 1.5", require a fixed number of runs reported as median and spread, and require a rerun before any stop.

### R3.4 Toolchain and fixtures live in session-scoped scratch folders, and env.sh points at another session's folder
- Where: line 10 (rule 2: fixtures "are kept in the scratchpad"); prototypes/dotnet-b/env.sh lines 2-3 (`DOTNET_ROOT=/tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/dotnet-sdk`); prototypes/dotnet-b/README.md line 18 ("extracted into the scratchpad").
- Evidence: The scratchpad is session-specific and may not survive the session. env.sh names the scratchpad of session 3863bd8b, not this run's 87003abe, so either the file was written elsewhere or it breaks here. The verifier V (line 70) must re-run numbers from the fixtures and the SDK, and neither is kept anywhere durable.
- Already covered?: Partly. Rule 2 says the exporter is committed, so fixtures can be regenerated, and env.sh says to reinstall from the README. Nothing requires the regenerated fixtures to match the stored ones, and the reinstall path is the one that was refused (R3.5).
- Severity: should-fix
- Confidence: medium-high on the path mismatch (visible in the file); impact depends on how the scratchpad is handled
- Suggested change: Record the fixture regeneration command, seeds and expected output checksums in committed reports, check that the SDK path in env.sh exists before each stage, and state what V does if the scratchpad is gone.

### R3.5 After a permission refusal, the plan picks a near-equivalent route without asking the owner
- Where: line 25 (section 2, Permission row: "Running the downloaded `dotnet-install.sh` was refused by the auto-mode classifier. The plan installs the SDK from the official tarball instead ... If that is refused too, stage 0 stops and the owner decides.").
- Evidence: The refusal was a permission decision about running a script. The plan treats the tarball as an acceptable substitute and only escalates if that is refused as well. Later toolchain steps (section 9, the dotnet-maui-doctor row) build on the same route.
- Already covered?: Partly. The difference is recorded and a second refusal stops the stage, but the owner is not asked before the workaround runs.
- Severity: should-fix
- Confidence: medium
- Suggested change: Make the owner choose the install route before stage 0 runs, and state that a permission refusal is not a problem to route around.

### R3.6 The loopback server on the owner's phone has no stop rule
- Where: line 51 (stage 4: "Loopback exposure on a phone (other apps can reach 127.0.0.1) is measured and written up, against the interop route that opens no socket.").
- Evidence: The plan records that other apps on the phone can reach the server, then treats that as a measurement to write up. It does not say the server must be off by default, must stop when the page closes, or must be kept out of any build that reaches the owner. Stage 4 includes a 10-minute run on the owner's phone.
- Already covered?: Partly. The write-up compares the server with the interop route. No default-off, teardown or exclusion rule exists.
- Severity: should-fix
- Confidence: medium
- Suggested change: State that the host is off unless a test starts it, stops on exit, and is excluded from any APK that reaches the owner.

### R3.7 Section 3 keeps the superseded stage 3 bars beside the new ones
- Where: line 48 ("Agreement bars (proposed): at most 1% of ever-burning cells differ ... every one of these no worse than the TypeScript's own tier-to-tier difference from 3a") against line 126 ("Agreement bars for stage 3, replacing the proposal in section 3") and the table at lines 128-132.
- Evidence: Two bar sets are present. The section 3 set requires 1 % and 2 % for every case and the "no worse than tier-to-tier" clause, and the section 10 table drops both. An agent reading top to bottom meets the tight bars first and could apply them to the embers-off and different-stream cases.
- Already covered?: Partly. Line 126 says "replacing", but the superseded text is not struck or marked, and the section 3 gate row still says "the bars below".
- Severity: should-fix
- Confidence: high
- Suggested change: Delete the section 3 bars, or mark them "superseded by section 10" with a pointer, and change the section 3 gate row to point to section 10.

### R3.8 Dangling cross-reference in rule 4
- Where: line 12 (rule 4: "(plan section 4, rules 1 and 2)").
- Evidence: Section 4 ("Agents, scopes and order") has no numbered rules. The phrase matches the speed-test section of the repository README, which refers to a different plan's section 4, so it was probably copied. An agent following the reference finds no rule where the hard requirement is supposed to be justified.
- Already covered?: No.
- Severity: nitpick
- Confidence: high
- Suggested change: Point rule 4 at the rules in section 1 or remove the reference.

Totals: 8 findings (must-fix 1, should-fix 6, nitpick 1)
Checked and found correct:
- The TypeScript gate is isolated. tsconfig.json includes only "src", "tests", "e2e", "desktop" and three config files, so prototypes/dotnet-b/ is outside `tsc`, and a stopped run is undone by deleting that folder. This supports rule 1 and the "nothing here is a release" claim.
- The heavy-work lock (line 24) is the repository's existing convention. The speed-test reference was measured under the same lock, which covers contention for stage 1 timings if every benchmark takes it.
- Each stage has a named stop condition (table, section 3), and stage 0 has its own stop if the SDK cannot be installed.
- The stage 3 thread-count requirement is a deterministic equality check, not a tolerance, so it cannot pass on noise.
- Section 10 retracts the earlier claim that last-bit math differences would change the hashes, and the retraction is backed by P3a's perturbation data.
Could not check:
- The production Android application ID and signing key (no android/ folder in the snapshot), which decides R3.1.
- The "designated branch" the plan commits to and what it deploys, since the pack does not include the branch definition.
- The artifact at https://claude.ai/artifact/VsrSVEJaknFbyWuQh7Svx9, which the pack says is not available to me.

Verdict: Fix first
