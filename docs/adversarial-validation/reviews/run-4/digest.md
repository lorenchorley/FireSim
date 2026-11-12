Overall call: fix the must-fix items and resend
Checked: read the plan and all five reports; opened the cited source, docs and 3a reports; ran greps, line counts and a node power calculation (no python3 here). Could not check: the artifact, MAUI WebView behaviour, Android/MAUI builds, the Vitest config (not in the snapshot).
Must fix:
- M1 Downloads (SDK, JDK, Android SDK, workloads, NuGet) have no owner approval step, ignore the antivirus/signed-files rule, and a refused action gets a second route (R1.1, R2.3, R3.1, R5.1). Evidence: grep for antivirus/signed finds nothing in the plan; section 2 Permission row; checksum comes from the tarball's own host.
  Fix direction: owner approval list before stage 0 (URL, size, signature or checksum, antivirus state); refusal means stop and ask; record what was already downloaded.
- M2 Gate 1 compares all-core C# with one-thread TypeScript, so threading alone can pass it (R4.1). Evidence: air-slice plan line 1014 and D39 estimate 1.8x to 2.6x on 4 cores, above the 1.5x gate; D34 allows TypeScript threads.
  Fix direction: decide Gate 1 on one-thread C# against one-thread TypeScript; report the threading gain as a separate number.
Should fix:
- S1 "Page needs no change" ignores Capacitor use in 9 non-test files (14 with tests); the stage 4 gate does not test live fetch, location or saved data (R2.1). Reword and add checks.
- S2 Loopback ws:// from the MAUI page: cleartext, mixed-content and D36 origin prerequisites unnamed (R1.3). Name them as owner decisions.
- S3 Phone half of Gate 1 has no TypeScript baseline on the phone (R2.7). Use the app's worker or in-app speed test.
- S4 Gate 1 can stop the plan on indicative shared-machine numbers (15 % spread in 3 runs) (R3.5, R5.3). Say what decides; repeat before a stop.
- S5 Parallel.For cannot keep RNG draw order for breach, debris and ember draws; level-set loops and atmosphere solver are RNG-free (R1.2). State per kernel.
- S6 Fs.Tests has no owner or scope; thread-count test placed in both C3 and Fs.Tests (R1.5). Add to S0 and name an owner.
- S7 Fixtures and SDK sit under another session's scratchpad path, no regeneration command or hash manifest (R1.8, R3.2, R5.6). Name command and path; commit a manifest.
- S8-S10b 30-seed ensembles and quiet timings unowned; the 12 % loose bar passes a port 10 % off about 63 % of the time; the fallback trigger and its owner approval are undefined (R5.2, R3.4, R5.7). Schedule, size the bar, name who decides.
- S11 Gate 2 passes on any transport but stage 4 builds loopback regardless (R5.8). Let Gate 2 pick the transport.
- S12 Report omits the two-solver maintenance cost D34 was based on (R4.4). Add a line.
- S13 iOS is not mentioned; no iOS project is committed (R2.2, partly). State it out of scope.
- S14 Section 8 omits owner phone round trips, retries and compute (R5.4, partly). Add them.
Optional:
- O1-O4 lifecycle/thermal gate, desktop host behaviours and OS list, Capacitor-plus-native-library shell, WebAssembly/TypeScript-threads alternatives (R2.4, R2.5, R4.3, R4.2).
- O5-O6 existing profile not cited; saved-data origin check is late (R4.5, R5.5).
- O7-O9 desktop parts while waiting on phone, no wait limit, lock serialises heavy steps, no branch/undo line (R1.4, R3.7, R1.6, R3.6).
- O10-O11 Gate 1 ratio wording; WebView 108 floor unstated (R1.7, R2.8).
- O12-O16 stage 2 loopback listener, gitCommit predates exporter, airplane scenario unnamed, APK provenance, phone conditions list (R3.3, R3.2, R2.6, R2.3, R2.4).
Rejected:
- X1 Engine data path unspecified (R2.6): the protocol 2 start message carries terrain, fuel and weather; plan 3b decodes it.
- X2 "Ten agent runs is below the plan's 12" (R5.4): section 8 says ten to twelve, which is one or three port agents.
Own observations:
- N1 Section 2 says the SDK is not installed; section 9, env.sh and README say it was installed, so the plan cannot show what is already downloaded.
- N2 Rule 4 cites "plan section 4, rules 1 and 2", which belong to the air-slice plan, not this plan's section 4.
Full ruling: C:/Users/lchorley/AppData/Local/Temp/claude/4968719846455d7e/62dbc2cd-27ae-4fdc-a848-1cc1ed2e5298/scratchpad/runC/ruling.md
