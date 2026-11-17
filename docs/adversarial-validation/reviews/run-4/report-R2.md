# R2 | plans / Missing requirements

(Not saved to REPORT_PATH: the write was refused, so this is the full report in the required layout.)

### R2.1 The page "needs no change" in a MAUI shell, but the page depends on Capacitor in 13 source files
- Where: plan line 51, "The existing page (TypeScript screens, Three.js map) in a MAUI shell, ... so the page needs no change."
- Evidence: `src/data/http.ts:111` routes requests through CapacitorHttp when `Capacitor.isNativePlatform()`. The repo says this is why "no service depends on CORS on device" (README.md, "Build the phone apps", Notes, about line 1346). `src/ui/location.ts:80` uses native geolocation on native. `src/ui/prefs.ts:28` returns null off native, so saved data takes another branch. `src/ui/desktop.ts:171` changes the typed-address flow on native. A MAUI shell does not provide the Capacitor bridge, so the page would take its browser branches: NSW, RFS and Open-Meteo calls become cross-origin, and location and saved data follow other code paths. The plan has no test of live fetch, location or saved data inside the shell. Stage 4's gate is airplane mode, which does not exercise live fetch.
- Already covered?: No for CORS, location and preferences. Stage 5 names the saved-data origin (`https://localhost`) as a stage-5 finding only. Stage 4 says the page needs no change and does not check it.
- Severity: must-fix
- Confidence: high on the dependency. Medium on the runtime effect, since no shell has been built.
- Suggested change: Before stage 4, list every Capacitor-dependent behaviour (data fetch, location, preferences, native address) with its MAUI replacement, and add gate checks for a live fetch, a location read and a saved-data round trip from the shell.

### R2.2 iOS is not mentioned, though the app ships on iOS
- Where: plan §3 stage 5 ("Can it replace the current APK?", "APK size against 33 MB", "Android 7.0 (API 24) floor") and §5 ("Install the benchmark and transport APKs"). The words iOS, Apple and App Store do not appear in the plan.
- Evidence: `docs/ARCHITECTURE.md` line 19: "Capacitor 8 (Android + iOS)". README.md, "Build the phone apps": the iOS project and the `NSLocationWhenInUseUsageDescription` key. `desktop/README.md`, "The Android and iOS apps": `--allow-app` admits `capacitor://localhost` (iOS). `docs/research/09-mobile-tech-stack.md` line 185 (iOS deployment target) and line 215 (App Store guideline 2.5.2 on downloaded code, which bears on any runtime that loads code). §7 "All pass: B is technically feasible" would read as a phone answer that leaves out iOS.
- Already covered?: No. Section 1 ("What this is not") does not exclude iOS.
- Severity: must-fix
- Confidence: high
- Suggested change: State in §1 whether iOS is in or out of scope. If out, say so in §7 and the report. If in, add an iOS build, lifecycle and App Store check to the stage 4 and 5 gates.

### R2.3 Downloads are planned without an owner approval step, and a refusal is routed around
- Where: plan §2, Permission row: "Running the downloaded `dotnet-install.sh` was refused by the auto-mode classifier. The plan installs the SDK from the official tarball instead ... If that is refused too, stage 0 stops and the owner decides." §2 also lists NuGet, Maven, Gradle and the Google Android repository as reachable, and stage 0 needs the SDK, Microsoft OpenJDK and Android SDK packages.
- Evidence: After one route was refused, the plan picks a second route for the same download. The stop fires only if that route is also refused, not when the owner's download rule says to ask first. The session's standing user instruction (in the session context, not in the pack; I did not open a file to check it) says that while the antivirus is off, only signed files from trusted sources may be downloaded, and the agent must ask before downloading or running anything untrusted. A SHA-512 checksum is not a signature check. §5 also has the owner sideload debug APKs built from those downloads, with no statement about how they are signed or verified.
- Already covered?: Partly. §2 names the refusal and a stop. It does not ask the owner for approval before each download class, and it does not mention the antivirus state.
- Severity: must-fix
- Confidence: high on the plan text. Medium on how strictly the owner's rule applies here.
- Suggested change: Add a gate before stage 0: the owner approves each download class (SDK, JDK, Android SDK, NuGet packages) and confirms the antivirus state. Remove the tarball fallback unless the owner approves it, and say how the debug APKs are signed.

### R2.4 Lifecycle, backgrounding, process death and thermal state are not in any gate
- Where: plan §3 stage 2 ("sustained for 60 s") and stage 4 ("A 10-minute run at 60× in airplane mode: no crash, picture cadence held, memory within a stated budget"). §5 lists the phone inputs. The words background, lifecycle, thermal and power do not appear in the plan.
- Evidence: `docs/research/09-mobile-tech-stack.md` lines 117-131 record risks the repo already found: iOS suspends JavaScript within seconds of backgrounding; a killed WebContent process reloads the page and loses in-memory state; an unhandled Android `onRenderProcessGone` crashes the app; thermal state is not visible to web code; WebKit halves the frame rate under Low Power Mode or aggressive thermal mitigation. The research recommends checkpoints. A MAUI engine meets the same conditions.
- Already covered?: No.
- Severity: should-fix
- Confidence: high
- Suggested change: Add to the stage 4 gate a screen-off or backgrounding run, a forced process kill with resume from checkpoint or a stated loss, and a record of thermal status and power-save state with every phone number (§1 rule 3).

### R2.5 Desktop host requirements beyond the three named checks are not carried into stage 4, and the desktop OS list is missing
- Where: plan §3 stage 4: "ASP.NET Core host speaking protocol 2"; "checked with a variant of `e2e/desktop-real.spec.ts`, the cross-origin and hostile-name specs, and the throttled-link tool"; gate: "protocol 2 not met".
- Evidence: `desktop/README.md` (sections "Start it", "The pairing code", "The Android and iOS apps", "Flags") documents more host behaviour than those checks name: a one-use `--open` link spent after 60 s (`desktop/openToken.ts`; `e2e/host-browser.spec.ts` references `__firesim/open`); a pairing code kept out of argument lists; 5 wrong codes before a 60 s refusal; a `Host` allowlist that answers 421; `--lan`, `--lan6` and `--bind` with the no-TLS warning; the Private Network Access header; a memory admission estimate that refuses a scenario before it is built (`desktop/sessionEstimate.ts`); a session cap (default `max(1, min(4, cores - 1))`); a 128 MiB frame limit that closes with 1009. The host's `--open` uses `xdg-open`, `open` and `cmd /c start`, so it targets Linux, macOS and Windows. The plan names no desktop OS and does not say how the .NET runtime reaches a user's desktop.
- Already covered?: Partly. The plan says the existing specs are the check, and they may cover more than the three named. The plan does not say the port must meet the rest, so a port could pass the named checks and still miss admission control, the open link, the lockout and the OS coverage.
- Severity: should-fix
- Confidence: medium. I confirmed the file names and the `__firesim/open` reference but did not read each test.
- Suggested change: List each `desktop/README.md` behaviour the port must keep, map it to an existing or new test, and name the desktop OSes and the delivery form for the stage 4 gate.

### R2.6 The offline data path for the phone and desktop engines is not specified
- Where: plan §3 stage 3b ("the slice may take the TypeScript's own wind rasters as input and defer the atmosphere port") and stage 4 ("airplane mode ... no crash").
- Evidence: README.md line 1566: "Weather and live data need the network (or an area pack)." README.md, the `offline-synthetic.json` note: a place with no signal uses substitutes. `docs/research/09-mobile-tech-stack.md`, item 6: "Store area packs as native files, not as IndexedDB blobs." The plan never says where the C# engine gets weather, terrain, canopy or area-pack data on each platform, or which scenario the airplane run uses. If the port must read area packs natively, that I/O path is not covered by the transport tests in stage 2.
- Already covered?: No.
- Severity: should-fix
- Confidence: medium
- Suggested change: Add a data-source table to §3 (bundled, area pack, live fetch, per platform) and make the airplane run name its scenario and data source.

### R2.7 The phone gate has no TypeScript comparator on the phone, and the phone conditions are incomplete
- Where: plan §3 table, stage 1 gate: "under 2.0× on the phone"; stage 1 detail: "benchmark each against the TypeScript in Node on identical inputs"; §1 rule 3: "machine, cores, run count, median and spread".
- Evidence: On the phone the shipped TypeScript runs in the WebView worker (Android System WebView, iOS WKWebView), not in Node (README.md, "Build the phone apps"). The 2.0× phone gate has no TypeScript number from the phone to compare with. The app already has an in-app speed test (`docs/DESIGN.md` around line 668, "The speed test (0.7.0)") that could provide one. §1 rule 3 omits thermal state, battery and charging, Low Power Mode and WebView version.
- Already covered?: No. §5 asks only for the phone model and Android version.
- Severity: should-fix
- Confidence: high on the text. Medium on the best fix.
- Suggested change: Define the phone baseline as the TypeScript run in the app's own worker on the same phone (the existing speed test is a candidate), and add thermal state, power mode and WebView version to the conditions in §1 rule 3.

### R2.8 The Android floor is already set in the repo, but stage 5 treats it as open
- Where: plan §3 stage 5: "Android 7.0 (API 24) floor" is listed among the findings to produce.
- Evidence: `docs/research/09-mobile-tech-stack.md` line 186: Capacitor 8 `minSdkVersion 24`. README.md, "Build the phone apps": "Android System WebView 108+, which `capacitor.config.ts` enforces". The plan does not mention WebView 108, and the page runs in the MAUI shell's WebView, so the same floor applies.
- Already covered?: No. Stage 5 asks the question, so a reader may take the floor as undecided.
- Severity: nitpick
- Confidence: high
- Suggested change: State that the floor is already API 24 with WebView 108, and that stage 5 checks the MAUI build against both.

Totals: 8 findings (must-fix 3, should-fix 4, nitpick 1)

Checked and found correct:
- §1 and §7 say D34 stays in force. This matches `desktop/README.md` ("One solver, no second implementation (plan decision D34)").
- The desktop host's loopback default (`127.0.0.1` unless `--lan`) matches the plan's loopback-exposure framing in stage 4.
- The Android minimum of API 24 in §3 stage 5 matches the Capacitor 8 minimum in `docs/research/09-mobile-tech-stack.md` line 186.
- The plan names its unknowns (Java version, KVM not checked, phone numbers need the owner's phone) rather than presenting them as facts.
- The plan says it does not change `src/`, `desktop/` or any release, and nothing in the pack contradicts that.

Could not check:
- The artifact https://claude.ai/artifact/VsrSVEJaknFbyWuQh7Svx9 is not available to me. Any requirement that exists only there (for example an iOS or lifecycle plan) is unverified.
- The owner's download rule in R2.3 comes from the session instructions, not from a file in the pack. I cite it as context and did not open any file to check it.
- I did not read every test in `desktop/*.test.ts` or the e2e specs, so R2.5 says which behaviours the plan leaves out of its named checks, not which tests cover them. The "33 MB" APK budget in stage 5 appears as a budget in `docs/plans/0.9.0/CONTRACT-0.9.0.md`, but I did not check it against a built APK, which is for the facts lens.

Verdict: Fix first
