# R3 | plans / Failure modes and rollback

Plan under review: C:/Users/lchorley/AppData/Local/Temp/claude/4968719846455d7e/62dbc2cd-27ae-4fdc-a848-1cc1ed2e5298/scratchpad/bench/snapshot/docs/plans/dotnet-option-b-prototype.md ("plan line N" below). Repository facts checked in the same snapshot folder.

### R3.1 Sideloading the test APKs on the owner's phone can wipe saved sites and runs
- Where: plan line 76, "Install the benchmark and transport APKs (debug builds, sideload) and run their screens." Plan line 53, "Test what survives an install over the current APK."
- Evidence: the current app is package `au.firesim.app` (docs/plans/air-slice-wind-detail-honest-speed.md, the 0.9.0 build note near line 1690: `aapt2 dump badging: package au.firesim.app`). Plan line 53 says saved sites and runs live in the WebView origin, so an uninstall deletes them. The plan names no applicationId for the test APKs or the Stage 4 shell, and it has no backup step. If a test APK reused that ID with a different signature, Android would refuse the install, and the usual next step is an uninstall.
- Already covered?: no. Stage 5 asks what survives, but nothing warns the owner before installing on their own phone.
- Severity: should-fix (becomes must-fix if the test APKs use `au.firesim.app`)
- Confidence: medium
- Suggested change: give each test APK its own applicationId, and state that the owner exports saved sites and runs before any install over the current app.

### R3.2 Stage 2 can pass while pictures are lost or corrupted
- Where: plan line 42, "sustained for 60 s, with no main-thread task over 50 ms and at most 8 ms of main-thread time per picture."
- Evidence: the gate measures rate and main-thread time only. It does not require the WebView to count pictures received against pictures sent, and it does not check bytes. Stage 3 has hashes; Stage 2 has none. Plan line 110 (`use-js-interop`) makes the wrapper catch `JSDisconnectedException` on teardown, which hides a failed call rather than counting it.
- Already covered?: no. Line 110 covers disposal only, not per-picture loss.
- Severity: should-fix
- Confidence: medium
- Suggested change: the gate requires received equal to sent for every run, and a checksum match on a sample of pictures.

### R3.3 Gates 1 and 2 can stop the project on noisy timings, with no re-measure rule
- Where: plan line 34, "All-core C# is under 1.5× the TypeScript on desktop, or under 2.0× on the phone"; plan line 11, "Container numbers are desktop-class and noisy"; plan line 72, "Gate 1 and Gate 2 are decided together from K1 and T2."
- Evidence: the heavy-work lock (prototypes/dotnet-b/README.md, rule 5) serialises heavy jobs, which helps. Light work by other agents and the shared host still add noise. The 3a reference run of katoomba3-fast gave 1050, 1099 and 1206 ms (reports/3a-reference.md line 62), a spread of about 15 %. Plan section 7 says a failed Gate 1 means stop, and Revision 2 (plan line 136) says timings on a quiet machine are still to run.
- Already covered?: partly. Plan line 11 requires median and spread, but nothing says what to do when the ratio sits inside that spread of its bar.
- Severity: should-fix
- Confidence: medium
- Suggested change: when a ratio is within the measured spread of its bar, re-run on a quiet machine or the phone before a stop is reported.

### R3.4 Fixtures and the SDK live only in one session's scratchpad, and recovery depends on a commit the plan does not pin
- Where: plan line 10, "They are not committed ... They are kept in the scratchpad." prototypes/dotnet-b/env.sh lines 2 to 3 (`DOTNET_ROOT` under `/tmp/claude-0/-home-user-FireSim/3863bd8b-.../scratchpad/dotnet-sdk`). reports/3a-reference.md line 8 (fixture folder under the same session path).
- Evidence: the fixture and SDK paths sit under one session's scratchpad, which is session-specific. env.sh itself says to reinstall if that path is gone, and a reinstall means another download (see R3.7). The 3a results record the solver commit (`reports/3a-results.json`, gitCommit `9bfcf24`), and reports/3a-reference.md line 77 says the exporter was uncommitted at that commit. The plan has no step that checks the solver is still at that commit before stage 3 compares against the fixtures. Other lanes work on the same repo (docs/plans/0.10.0/CONTRACT-0.10.0.md), so the solver can move.
- Already covered?: partly. The commit is recorded, and env.sh says to reinstall. Neither gives a regeneration command, and no gate checks the commit.
- Severity: should-fix
- Confidence: medium
- Suggested change: put the regeneration command and solver commit in the stage 3 report, and have C3 refuse to compare when the current solver commit differs from the fixture's gitCommit.

### R3.5 Stopping at a failed gate leaves merged code, and the plan gives no rollback step
- Where: plan line 14, "Stop at a failed gate. The orchestrator reports the gate and waits"; plan line 57, "merges with `--no-ff`"; plan line 82, "committed to the designated branch."
- Evidence: the plan does not name the branch, does not say whether code from passed stages stays or goes after a stop, and does not say how to revert a `--no-ff` merge. The mitigation is plan line 9, which keeps all prototype code in `prototypes/dotnet-b/`, so removing that folder is the rollback. The plan never says so.
- Already covered?: partly, by rule 1 on line 9.
- Severity: nitpick
- Confidence: high
- Suggested change: name the branch, and add one line saying a stop is undone by reverting the stage merges (`git revert -m 1`) or removing `prototypes/dotnet-b/`.

### R3.6 The Stage 4 gate has terms that cannot fail as written
- Where: plan line 37, "Not standalone in airplane mode, or protocol 2 not met"; plan line 51, "picture cadence held, memory within a stated budget."
- Evidence: the plan gives no memory budget number, does not define "picture cadence held", and does not define protocol 2 or say where it is defined. Every other gate in section 3 has a number.
- Already covered?: no.
- Severity: should-fix
- Confidence: high
- Suggested change: give the memory ceiling in MB, a minimum picture count for the 10-minute run, and a link to the protocol 2 definition.

### R3.7 No step checks the owner's antivirus condition before downloads and installs
- Where: plan line 25 (the "Permission" row, and the tarball fallback), plan line 33 (Stage 0, SDK install), plan line 108 (`dotnet-maui-doctor`, Android SDK and JDK).
- Evidence: the owner's standing instruction (CLAUDE.md, "Extremely important") says that while antivirus is off, downloads must be signed files from trustworthy sources, and the owner must be asked before downloading or executing anything untrustworthy. The stage 0 fallback is the SDK tarball, whose only check is a SHA-512 from the same host (prototypes/dotnet-b/README.md, the releases.json link). That confirms the file is intact, not who published it, and the tarball is not signed. The plan also installs the Android SDK and Microsoft OpenJDK and sideloads APKs. None of these steps has a stop for the antivirus condition.
- Already covered?: no. The plan's only permission check is the classifier refusal in line 25.
- Severity: should-fix
- Confidence: medium
- Suggested change: add a stop before stage 0 that waits for the owner to confirm the antivirus state, and list which downloads are signed and which rely on the checksum alone.

Totals: 7 findings (must-fix 0, should-fix 6, nitpick 1)
Checked and found correct:
- tsconfig.json `include` lists src, tests, e2e, desktop and the config files, and not prototypes/, so plan rule 1's TypeScript-gate claim holds for tsconfig.
- No package.json script and no file outside prototypes/ refers to prototypes/ (grep over the snapshot).
- The 3a reference records its solver commit (reports/3a-results.json, gitCommit 9bfcf24).
- The heavy-work lock is written into prototypes/dotnet-b/README.md (rule 5), so benchmarks are serialised against other heavy jobs.
- The fixture folder is outside git, and the exporter is committed (ts-export/README.md line 4), as plan rule 2 says.
Could not check:
- The root vitest/vite config and capacitor.config.ts (named in tsconfig.json) are not in the snapshot, so the Vitest half of plan rule 1 is unverified.
- The applicationId of the planned MAUI test APKs and the Stage 4 shell is in neither the plan nor the snapshot (R3.1 depends on it).
- Whether the artifact the plan updates (line 84) keeps earlier versions. The artifact is not available to me.
Verdict: Fix first
