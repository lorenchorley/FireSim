# Batch S: security, lifecycle and operations (8 items)

Follow VERIFY-COMMON.md. Do Part 1 for an item (investigate the question, write your own answer) before you read that item in Part 2. Useful local paths: `desktop/` (the Node host and its tests), `prototypes/dotnet-b/` (README, env.sh, global.json, Fs.Host), `.../scratchpad/android-t2/` (toolchain logs), `.../scratchpad/dotnet-sdk/`, the debug APKs `.../scratchpad/firesim-0.8.0-debug.apk` (if present) and `/root/.android/`. You may run `apksigner`/`keytool`-style read-only checks if available. Do not print or copy any private key material into your output; fingerprints are fine.

## Part 1: the questions

- **S-1.** Does the plan require an ASP.NET Core desktop host to be as hard as the current Node host? What are ASP.NET Core's defaults for allowed hosts, WebSocket origins and keep-alive, what does the committed `Fs.Host` do, and how many of the Node host's guards would the specs the plan names actually exercise?
- **S-2.** If the in-app engine link on the phone were protocol 2 over a 127.0.0.1 WebSocket, how do the Node host's pairing code, per-address rate limits and connection caps behave when every app on the phone shares the address 127.0.0.1? What is known about the exposure of loopback servers on Android?
- **S-3.** What is the minimum Android API level supported by .NET MAUI apps targeting .NET 11?
- **S-4.** Does the plan test what happens when the phone app is backgrounded, frozen or killed during a run, or under sustained load? What does Android do to cached apps, and what does protocol 2 do with a silent link?
- **S-5.** Where is the signing key of the APKs the owner has installed, is there any other copy, and what happens to future updates if the key is lost?
- **S-6.** How does FireSim's simulation generate its random numbers, and could the sequence be reproduced exactly in another language?
- **S-7.** Is the prototype's toolchain reproducible from what is committed (SDK version and hash, JDK, Android SDK packages, workload versions, package versions, licences)?
- **S-8.** Are these statements in the plan or the artifact accurate as written: "the current 33 MB APK"; "real sizes (2.2 MB, 6.5 MB, 16 MB; measured in 0.9.0)"; "last-bit math differences ... turned out not to matter (tested)"? What are the support end dates of .NET MAUI 11 and the .NET 11 runtime, and are there known regressions of CoreCLR on Android in .NET 11?

## Part 2: the claims (read each only after answering its question)

**S-1.**
Claim: The plan has no rule that the C# host may not be weaker than the Node host; the committed `Fs.Host` is the `dotnet new web` template (`AllowedHosts: "*"`, a Hello World endpoint); ASP.NET Core's WebSocket middleware allows every origin by default and has no keep-alive timeout by default; the three Playwright specs the plan names cover a minority of the Node host's guards (hello timeout, pre-hello caps, message-rate and queue closes, frame limit, decoder limits, memory refusal are tested only by Vitest).
Pointers: `prototypes/dotnet-b/Fs.Host/Program.cs`, `appsettings.json`; https://learn.microsoft.com/aspnet/core/fundamentals/websockets ("AllowedOrigins ... By default, all origins are allowed"); `desktop/server.test.ts`, `desktop/security.test.ts`, `desktop/openToken.test.ts`; `e2e/desktop-real.spec.ts`, `e2e/desktop-cross-origin.spec.ts`, `e2e/host-browser.spec.ts`; `desktop/README.md` "The engine link"; plan sections 1 and 3 stage 4.
Proposed change: a rule "host parity: every refusal the Node host makes, the C# host makes"; a protocol-level conformance suite run against both hosts; explicit hosts, origins, keep-alive and limits; decoder limits and a memory bound in the stage 3 slice.

**S-2.**
Claim: On a phone loopback socket every other app is "the same address": five wrong hellos from another app lock the page out for 60 s (repeatable), four silent sockets per address starve the page's own engine, the port is not secret, and the 8-character typed code cannot be typed or read inside the app. The Local Mess research (2025, USENIX Security 2026) documents apps abusing loopback sockets on Android. The plan only says loopback exposure "is measured and written up".
Pointers: `desktop/security.ts` (`addressKey`, `RateLimiter`); `desktop/server.test.ts` around 153 and 621; `desktop/README.md` "The pairing code"; https://localmess.github.io/; plan section 3 stage 4.
Proposed change: stage 2(c) passes only with an ephemeral per-launch port and a per-launch 128-bit secret delivered by interop, limits keyed by connection or secret, an Origin check, a loopback-only network config, and a co-resident attacker test.

**S-3.**
Claim: The minimum Android API level for .NET MAUI apps targeting .NET 11 is 24 (Android 7.0).
Pointers: Microsoft Learn, "What's new in .NET MAUI for .NET 11".
Proposed change: none.

**S-4.**
Claim: Stage 4's only lifecycle test is a 10-minute foreground run. Android freezes cached apps about 10 s after they become cached; protocol 2 closes a link silent for 60 s and has no reconnect; so a phone backgrounded for more than about 70 s probably returns to a closed link and a lost run with a C# engine behind a link, where today's in-page worker resumes. Gate 1's short burst cannot show sustained thermal throttling of an all-core solver.
Pointers: https://source.android.com/docs/core/perf/cached-apps-freezer; `desktop/README.md` "The engine link" item 4 and "What is not here"; https://developer.android.com/games/optimize/adpf/thermal; plan section 3 stage 4.
Proposed change: background tests at 30 s, 90 s and 5 min, a process kill, a 30-minute sustained run with thermal status for both engines; decide on a foreground service or a resumable protocol.

**S-5.**
Claim: Both installed debug APKs (0.6.0 and 0.8.0) are signed with "CN=Android Debug" from `/root/.android/debug.keystore`, created 2026-10-30, with no other copy; Android only allows an update if certificates match, so if this container is reclaimed the next APK cannot install over the owner's app, and uninstalling first deletes saved sites and runs. .NET for Android signs with its own debug key by default.
Pointers: `apksigner verify --print-certs` on the APKs; `ls -la /root/.android/`; https://developer.android.com/studio/publish/app-signing; `scripts/build-android-apk.sh`.
Proposed change: back up the keystore outside the container (not in the public repository) or choose a proper release key; build any MAUI test APK with that key, the same application id and a higher version code.

**S-6.**
Claim: FireSim's simulation draws its random numbers from Math.random(), so the sequence cannot be reproduced in another language.
Pointers: `src/core/rng.ts`.
Proposed change: none.

**S-7.**
Claim: Toolchain provenance lives only in scratchpad logs: `env.sh` hard-codes this session's scratchpad path; the README gives the SDK URL but not its SHA-512; the JDK, Android command-line tools, build-tools, platform, workload set and Android pack versions appear only in logs; BenchmarkDotNet is to be added "without a version" with no lock file; `global.json` rolls forward; Android SDK licences were accepted with `yes | sdkmanager --licenses` on the owner's behalf with no licence list.
Pointers: `prototypes/dotnet-b/env.sh`, `README.md`, `global.json`; `.../scratchpad/android-t2/*.log` and `sdk-install.sh`; plan section 9.
Proposed change: commit a TOOLCHAIN.md with every version, URL and hash and a licence list; lock files; replace the hard-coded path; ask the owner to confirm the licence acceptance.

**S-8.**
Claim: (1) 33 MB is the APK budget, not a measurement; the 0.8.0 debug APK is 30,417,340 bytes. (2) The 16 MB figure comes from a synthetic 10 m scenario and the units mix MB and MiB; 3a's real files are 2.28 MB and 6.80 MB. (3) "turned out not to matter (tested)" overstates 3a, which perturbed inputs and did not make exp, pow or sin differ. (4) .NET MAUI 11 support ends 2028-05-09 while the .NET 11 runtime runs to 2028-11-14. (5) CoreCLR on Android is new: Microsoft reported larger apps saw start-up or size increases, and dotnet/runtime issue 131370 (frame drops from the Java GC bridge, absent on Mono) is open with its milestone moved to 12.0.0; Mono is no longer an option.
Pointers: `docs/ARCHITECTURE.md` around 1739; D37; `ls -l` of the APK; `desktop/README.md`; `prototypes/dotnet-b/reports/3a-reference.md`; artifact; https://dotnet.microsoft.com/platform/support/policy/maui; https://devblogs.microsoft.com/dotnet/dotnet-maui-moves-to-coreclr-in-dotnet-11/; https://github.com/dotnet/runtime/issues/131370.
Proposed change: correct each statement; add MAUI 11's support end and the CoreCLR items to the risks.
