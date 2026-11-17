# Batch S, verifier O (2026-11-12)

Process note: the batch file shows each question and its claim together, so I saw the claims when I opened it. For every item I did the investigation first and wrote the "own answer" from what I found myself. Inference is labelled as such. I worked only in the repository at HEAD `05795ff`, the scratchpad paths the batch names, the installed SDK packs, and public primary sources.

---

S-1. Own answer (before reading the claim): The plan sets no rule that the C# host must be as strict as the Node host. Stage 4's gate is "protocol 2 not met", checked with a variant of `desktop-real.spec.ts`, the cross-origin and hostile-name specs, and the throttled-link tool. The committed `Fs.Host` is the bare `dotnet new web` template. ASP.NET Core's defaults allow every Origin, keep-alive pings go out every 2 min with no pong timeout, and host filtering with `"*"` accepts any non-empty Host (and an empty one). The named specs exercise roughly 8 of the Node host's roughly 26 guards.
Verdict: CONFIRMED     Severity: MAJOR     Change follows: partly
Evidence checked:
- `prototypes/dotnet-b/Fs.Host/Program.cs:1-6` is `app.MapGet("/", () => "Hello World!");`. `appsettings.json:8` is `"AllowedHosts": "*"`. The project has no WebSocket middleware.
- SDK ref docs, `packs/Microsoft.AspNetCore.App.Ref/11.0.0/ref/net11.0/Microsoft.AspNetCore.WebSockets.xml:139-170`:
  - KeepAliveInterval: "The default is two minutes."
  - KeepAliveTimeout: "Default value is InfiniteTimeSpan."
  - AllowedOrigins: "By default all Origins are allowed."
- `Microsoft.AspNetCore.HostFiltering.xml:58-80`: "A top level wildcard "*" allows all non-empty hosts" and "AllowEmptyHosts ... The default is true".
- Learn, https://learn.microsoft.com/aspnet/core/fundamentals/websockets (updated 2026-11-11): "By default, all origins are allowed", and KeepAliveTimeout "The default is Timeout.InfiniteTimeSpan (disabled)".
- Node host guards, `desktop/server.ts:150-470`:
  - Host allowlist (421), Origin (403), total and per-address pending caps (16 and 4, 503), 5 s hello timeout, 4 KB pre-hello frame limit, hello shape (4400).
  - 4426 for another protocol, a constant-time code check (4401), rate limit (4429), 4503 when no session is free.
  - 128 MiB frame limit (1009), binary only after the welcome, 20 pings/s and 1000 messages/s (1008), a 64 MiB queue held over 10 s (1008), heartbeat (60 s silent ends the session), hold at 8 MiB and release at 4 MiB.
  - From README item 4 and 7: decoder limits, the memory refusal, and messages dropped before `init`. Also static traversal, the `/__firesim/host` minimal answer with CORS, and `--open`.
- The three named specs cover the Host 421 (`host-browser.spec.ts:205`), Origin 403 and null (`desktop-real.spec.ts:581-582`), one bad-hello case (`:583` "no Origin and no code" gives 4400), wrong code, rate limit (`desktop-real.spec.ts:314`), CORS and `--open` (`host-browser.spec.ts:253,293`). The throttled-link tool covers the hold.
- None of the three specs mentions hello timeout, pending caps, 4426, 4503, 1008, 1009, the decoder limits or the memory refusal (grep for `4426|4503|1009|1008|503|hello time|TOO_BIG` over the three specs: only `desktop-real:583`). These are tested in `desktop/server.test.ts:125,515,610-707` and `desktop/engine.test.ts:472`.
Notes: Every part of the claim is literally true. One mitigation: the stage 4 gate "protocol 2 not met" could be read to include the limits, because `desktop/README.md` "The engine link" items 1-7 define protocol 2 with them. But the plan names no test that would check them, so a host that carries only the template defaults could pass stage 4. The rest of the change follows: a parity rule, plus making `server.test.ts`-style protocol tests runnable against any host URL. "Decoder limits and a memory bound in the stage 3 slice" does not follow, because stage 3 is about numerical agreement and these belong to stage 4. It would also help to add hardening the host to the "All pass" cost list in plan section 7.

---

S-2. Own answer: Every connection from another app on the phone arrives from 127.0.0.1, so the Node host's per-address controls become global. Five wrong hellos from any app put `127.0.0.1` in the 60 s block (the page is then refused even with the right code), and 4 pending sockets from 127.0.0.1 fill the per-address cap, so the page's handshake gets 503. Both can be repeated. On Android any app with INTERNET permission in the same profile can reach a loopback port. Android 17 blocks only cross-profile loopback by default. Local Mess (disclosed June 2025, to appear at USENIX Security 2026) showed Meta and Yandex apps listening on fixed localhost ports, plus a squatting/eavesdropping PoC.
Verdict: CONFIRMED     Severity: MINOR (for this prototype; MAJOR for a shipped design)     Change follows: partly
Evidence checked:
- `desktop/security.ts:122-125`: `addressKey` turns `::ffff:127.0.0.1` into `127.0.0.1`.
- `security.ts:146-169`: `RateLimiter` defaults to max 5 and blockMs 60 000.
- `desktop/server.ts:262`: `(pendingBy.get(address) ?? 0) >= maxPendingPerAddress` is refused with 503 (default 4, `:159`). `server.ts:306`: a blocked address is refused before the code is compared.
- `server.test.ts:153` "after 5 wrong codes from one address that address is refused with 4429, even with the right code, for 60 s". `:621` "16 silent connections from one address take 4 slots".
- Plan `docs/plans/dotnet-option-b-prototype.md:51`: "Loopback exposure on a phone (other apps can reach 127.0.0.1) is measured and written up, against the interop route that opens no socket." That is the only handling, so the claim's last sentence is accurate.
- https://localmess.github.io/ (fetched 2026-11-12):
  - Facebook, Instagram and Yandex apps "silently listen on fixed local ports".
  - A PoC showed another app on those ports could see visited sites.
  - The paper "Bridges to Self" is to appear at the 35th USENIX Security Symposium.
- https://developer.android.com/about/versions/17/behavior-changes-all: "cross-profile loopback traffic is no longer permitted by default. Loopback traffic within the same profile is not affected."
Notes:
- Each mechanism is correct as a reading of the Node code, which is what "protocol 2" would carry over.
- Inference: it needs a targeted co-resident app. A port scanner's bare TCP connect or HTTP GET does not count, because a slot is taken only after a WebSocket upgrade (`server.ts:263-269`) and only a well-formed hello counts as a wrong code (`:316-321`). So the realistic impact is an availability attack on one app.
- "Cannot be typed or read inside the app" is really a design remark: the shell would have to hand the code to the page itself, by interop or URL fragment.
- An extra risk the claim does not name: with a fixed port, another app can bind it first and receive the page's hello and scenario (the Local Mess squatting case). A per-launch port told to the page by interop prevents this.
- The proposed controls (per-launch port and secret by interop, per-connection limits, a co-resident attacker test) are right, but they belong in stage 4 or the design write-up, not as a pass condition of stage 2(c), which measures throughput. An Origin check only stops browser pages; native apps can forge it. "Loopback-only network config" should mean binding to 127.0.0.1, which Android's network security config does not control.

---

S-3. Own answer: API 24 (Android 7.0). .NET 11 raised the Android floor from 21 to 24, and the installed .NET 11 Android workload defaults to 24.
Verdict: CONFIRMED     Severity: NONE     Change follows: yes
Evidence checked:
- https://learn.microsoft.com/dotnet/core/compatibility/maui/11/android-minimum-api-level (ms.date 2026-11-10): "The minimum supported Android API level for .NET 11 has been raised from 21 (Android 5.0) to 24 (Android 7.0)."
- `packs/Microsoft.Android.Sdk.Linux/37.2.31/targets/Microsoft.Android.Sdk.SupportedPlatforms.targets:13`: `<AndroidMinimumSupportedApiLevel ...>24</...>`.
- The plan already says this at `dotnet-option-b-prototype.md:53` ("Android 7.0 (API 24) floor"). The current app is also `minSdkVersion = 24` (`android/variables.gradle:2`), so the floor costs nothing.
Notes: The pointer's title ("What's new in .NET MAUI for .NET 11") is not the page I used. The breaking-change page and the SDK pack settle the question.

---

S-4. Own answer: No. Stage 4's only lifecycle check is "a 10-minute run at 60× in airplane mode", and nothing covers backgrounding, freezing, a kill or sustained heat. On Android 14+ cached processes are frozen 10 s after becoming cached. When all of an app's processes are frozen, the system terminates the app's TCP sockets. Protocol 2 closes a session silent for 60 s and has no reconnect. A loopback-link engine is therefore likely to lose the run after a background stay that today's in-page worker survives. Gate 1's short benchmark cannot show sustained thermal throttling of an all-core solver.
Verdict: CONFIRMED     Severity: MAJOR     Change follows: yes (mostly)
Evidence checked:
- Plan `:51` (the 10-minute run is the only lifecycle item), `:34` (Gate 1: 2.0× on the phone from K1's "minimal Android benchmark app", `:62`).
- https://source.android.com/docs/core/perf/cached-apps-freezer (fetched 2026-11-12):
  - "App processes in the cached state are frozen 10 seconds after entering the cached state" (Android 14+).
  - "If all processes for a particular app are frozen, the system terminates any active TCP sockets maintained by the app."
  - "repetitive tasks ... are suspended while the process is frozen".
- `desktop/server.ts:155,445-452`: deadAfterMs 60 000; the heartbeat runs `if (t - s.lastSeen > deadAfterMs) s.ws.terminate()`.
- `src/sim/remote/RemoteSimController.ts:5`: "no reconnect in this release". `desktop/README.md:388-389`: "a reconnect after a lost link (the session goes with its worker)" is not there.
- https://developer.android.com/games/optimize/adpf/thermal: "Devices can only maintain a high level of performance for a limited amount of time before being thermally throttled."
Notes:
- The claim's "~70 s" may be too generous. Inference: if the whole app is frozen, the socket-termination rule could cut the loopback link about 10 s after the app becomes cached, before the 60 s heartbeat matters.
- Not verified: when a just-backgrounded app counts as "cached" (the previous app has a higher priority), and whether the WebView renderer's isolated process counts as one of "the app's processes".
- "Today's in-page worker resumes" is inference (no socket is involved). It is not tested here.
- The proposed tests (30 s, 90 s and 5 min backgrounds, a kill, a 30-minute run with thermal status for both engines) follow. Choosing a foreground service is an owner decision with Play-policy costs (foreground-service types), so the report should present it as an option.

---

S-5. Own answer: Both APKs in the scratchpad (0.6.0, 30,407,436 bytes; 0.8.0, 30,417,340 bytes) are v2-signed by "C=US, O=Android, CN=Android Debug". The certificate SHA-256 is f7570f27…a862e7, which is the key in `/root/.android/debug.keystore`, created 2026-10-30. A filesystem search of the container found no other copy, and none is in git. Android allows an update only when the certificates match, so losing that file means the owner must uninstall to install a newer build, and that wipes the app's data (sites and runs in the WebView origin). .NET for Android generates its own debug keystore in its own settings folder when none exists, so a default MAUI build would carry a different certificate.
Verdict: CONFIRMED     Severity: MAJOR     Change follows: yes
Evidence checked:
- `apksigner verify --print-certs` on both APKs: "Signer #1 certificate DN: C=US, O=Android, CN=Android Debug", "SHA-256 digest: f7570f27329a8569200885b4666781e7ce564b8201369cbae0904fa2b7a862e7" (identical for both).
- `keytool -list -v -keystore /root/.android/debug.keystore`: "Creation date: Oct 30, 2026", "SHA256: F7:57:0F:27:...:62:E7".
- `ls -la /root/.android/`: `debug.keystore` 2618 bytes, Oct 30 20:53.
- `find / -xdev` (repository pruned) for `*.keystore`, `*.jks`, `*.p12` and `*.pfx`: only `/root/.android/debug.keystore` matches for Android. `git ls-files | grep -i keystore`: nothing.
- https://developer.android.com/studio/publish/app-signing: "The system allows the update if the certificates match", and "If you lose or misplace your key, you will not be able to publish updates to your existing app."
- `.NET Android 37.2.31 tools/Xamarin.Android.Common.targets:702`: `_ApkDebugKeyStore = $(_AppSettingsDirectory)debug.keystore`. Target `_CreateAndroidDebugSigningKey` (`:2574-2589`) runs `-genkeypair` if that file does not exist. `/root/.local/share/Xamarin/Mono for Android/` does not exist yet.
- `android/app/build.gradle:7,10`: `applicationId "au.firesim.app"`, `versionCode 12`.
Notes:
- I could not check what is on the owner's phone or any copy outside the container, so "no other copy" holds for this container only.
- `android:allowBackup="true"` (`AndroidManifest.xml:7`): Android Auto Backup might restore some data after a reinstall, but that is not dependable for WebView storage. Inference.
- This matters to the plan directly. Stage 5 (`:53`) tests "what survives an install over the current APK". A MAUI APK signed with the .NET default debug key fails that install with a signature mismatch, which could be mistaken for an origin or data finding. If the keystore is lost, the test cannot be run at all.

---

S-6. Own answer: The simulation uses its own seeded generator, `Rng` in `src/core/rng.ts`. It is mulberry32: 32-bit integer arithmetic (`Math.imul`, shifts, xors) divided by 2^32. The uniform stream can be reproduced bit for bit in any language with 32-bit unsigned integers. `Math.random()` appears only in UI element ids and a dataset timestamp. The derived variates (`normal`, `logNormal`, `poisson`) go through `Math.log`, `cos` and `exp`, which may differ in the last bit between V8 and .NET. That is a separate, smaller issue.
Verdict: REFUTED     Severity: NONE     Change follows: no (nothing follows from a false claim; the plan's section 10 decision to port the generator exactly is feasible)
Evidence checked:
- `src/core/rng.ts:1-16`: "Small, fast, seedable PRNG (mulberry32) so simulations are reproducible", with `next()` using `Math.imul` and `>>> 0`.
- Grep `Math\.random\(` in `src/`: only `ui/screens/sim/speedControl.ts:59`, `ui/screens/sim/timePopover.ts:41` and `ui/screens/datasets.ts:153`.
- `node --experimental-strip-types` on `rng.ts` with seed 11 and an independent Python port both print `0.5115870486479253 0.5299464082345366 0.6081185641232878 0.5901576359756291` (identical).
Notes: Exact reproduction also needs the same draw order and count, which the plan already requires (`:134`).

---

S-7. Own answer: Partly. The SDK URL and the source of its SHA-512 (`releases.json`) are committed in the README, but the hash value itself is not. `env.sh` hard-codes this session's scratchpad path. `global.json` is `11.0.100` with `rollForward: latestFeature`. At HEAD no package has been added yet, so there is no lock file. The Microsoft OpenJDK version (21.0.9+10, checked against its sha256 file), the Android command-line tools (23.0.0 latest, plus a 21.0 install), platform-tools 37.0.1, build-tools 37.0.0, platform 37.0, and workload set 11.0.100.1 are recorded only in scratchpad logs and in T2's uncommitted worktree. SDK licences were accepted with `yes | sdkmanager --licenses` (the tool answered "The --licenses option is no longer needed"), and 8 licence files exist, preview licences among them. The repository's own committed `scripts/build-android-apk.sh` already does the same.
Verdict: PARTLY     Severity: MINOR     Change follows: partly
Evidence checked:
- `prototypes/dotnet-b/env.sh:3`: the hard-coded `/tmp/claude-0/.../scratchpad/dotnet-sdk`.
- `README.md:18-20`: URL plus "SHA-512 checked against .../11.0/releases.json".
- `global.json:3-4`: `"version": "11.0.100", "rollForward": "latestFeature"`.
- `cat */*.csproj | grep PackageReference`: none.
- `android-t2/jdk-install.sh` (V=21.0.9, `sha256sum -c`).
- `sdk-install.log`: build-tools 37.0.0, platform-tools 37.0.1, cmdline-tools 23.0.0, and "Warning: The --licenses option is no longer needed."
- `wl2.log`: "Workload version: 11.0.100.1". It also shows the explicit-version install failing with "No space left on device".
- `sdk-install2.sh:1` sources `.../worktrees/agent-af4301a383218d8d9/prototypes/dotnet-b/Fs.Transport/env-android.sh`, which is not in this tree (`Fs.Transport/` is empty at HEAD).
- `ls android-t2/sdk/licenses`: 8 files, including `android-sdk-preview-license`.
- `scripts/build-android-apk.sh:24`: `yes | "$SDKMANAGER" --licenses`.
Notes:
- Overstated: "BenchmarkDotNet to be added without a version" (plan `:105`). `dotnet add package X` without `--version` writes the resolved version into the csproj, so the version is recorded once committed. NuGet resolution is deterministic for fixed direct versions, so the missing lock file is a small point.
- The SHA-512 can be re-derived from the named `releases.json`.
- `latestFeature` rolls only to SDKs that are installed, and the plan states it openly (`:109`).
- Asking the owner to accept "on their behalf" licences is reasonable, but it is the project's existing practice, not something new to this plan.
- A TOOLCHAIN.md with the versions and hashes, and replacing the hard-coded path, do follow. They matter mainly for verifier V and for section 5's "the owner builds" fallback.

---

S-8. Own answer:
1. "The current 33 MB APK" (artifact) is wrong. 33 MB is the budget, the measured 0.3.0 debug APK was 27.6 MB, and the 0.8.0 APK is 30,417,340 bytes.
2. 2.2 MB and 6.5 MB are MiB figures from `desktop/README.md`. 16 MB is the 10 m synthetic scenario's snapshot (15.3 to 16.5 MiB). 3a's real files are 2,283,808 and 6,804,984 bytes.
3. "Turned out not to matter (tested)" overstates 3a. It multiplied the wind and temperature inputs by (1+eps) and did not change exp, pow or sin.
4. MAUI 11 support ends 2028-05-09 and .NET 11 (STS) ends 2028-11-14.
5. Microsoft acknowledges community reports of larger apps with slower start-up or bigger size under CoreCLR. dotnet/runtime#131370 (CoreCLR frame drops traced to the Java GC bridge, which the reporter did not see on Mono in .NET 10) is open with milestone 12.0.0. But Mono is still selectable in .NET 11 (`UseMonoRuntime=true`).
Verdict: PARTLY     Severity: MINOR     Change follows: partly
Evidence checked:
1. `docs/ARCHITECTURE.md:1739`: "Debug APK ... 27.6 | <= 33". D37 (`air-slice-wind-detail-honest-speed.md:124`): "the APK (33 MB) are unchanged" (a budget). `ARCHITECTURE.md:906`: "an APK of about 30 MB (budget 33 MB)". `ls -l`: 30,417,340 bytes. Artifact: "next to the current 33 MB APK".
2. `desktop/README.md:201-211` (10 m rows are `syntheticScenario`, sizes in MiB). `reports/3a-reference.md:15`: `katoomba6-fast` init.bin 6,804,984, snap-60.bin 2,283,808.
3. `reports/3a-tier-difference.md:85`: "I multiplied the 10 m wind speed and the temperature of every weather hour by (1 + eps)". The artifact says "turned out not to matter (tested)".
4. https://dotnet.microsoft.com/platform/support/policy/maui: ".NET MAUI 11 | November 10, 2026 | 11.0.0 | May 9, 2028". `builds.dotnet.microsoft.com/.../releases-index.json`: `11.0 sts active 2028-11-14`.
5. https://devblogs.microsoft.com/dotnet/dotnet-maui-moves-to-coreclr-in-dotnet-11/ (2026-05-13): "community reports of regressions in larger, more complex applications on Android ... startup time or app size increased". The same post says "The opt-out to Mono is available through .NET 11 servicing". https://github.com/dotnet/runtime/issues/131370: open, labels area-GC-coreclr and os-android, milestone 12.0.0. Partial fixes landed (#131952 on 2026-09-28), and the workaround is `DOTNET_GCgen0size`. Installed GA pack `Microsoft.Android.Sdk.DefaultProperties.targets:34`: `<_AndroidRuntime Condition="... '$(UseMonoRuntime)' == 'true'">MonoVM</_AndroidRuntime>`, and `packs/Microsoft.Android.Runtime.Mono.37.android-arm64` is installed.
Notes:
- Parts 1 to 4 are correct.
- Part 2 is a minor units point (4 to 5 %), irrelevant to a transport rate test.
- Part 3 is right that "tested" overstates. Inference: the 1e-9 result (0.6 to 1.2 ms, no ember flip) makes a material effect unlikely, but the true test is the C# port itself. Rng.normal's `Math.log` and `cos` are a place last-bit differences can enter even with the generator ported exactly.
- Part 5's "Mono is no longer an option" is false for .NET 11. That matters: Mono is a fallback stage 5 could measure next to CoreCLR, alongside NativeAOT.
- Add to the risks: MAUI 11's 2028-05-09 end (a move to MAUI 12 within 18 months) and #131370. Do not drop Mono.

---

## Summary

| ID | Verdict | Severity |
|---|---|---|
| S-1 | CONFIRMED | MAJOR |
| S-2 | CONFIRMED | MINOR (prototype) / MAJOR (shipped design) |
| S-3 | CONFIRMED | NONE |
| S-4 | CONFIRMED | MAJOR |
| S-5 | CONFIRMED | MAJOR |
| S-6 | REFUTED | NONE |
| S-7 | PARTLY | MINOR |
| S-8 | PARTLY | MINOR |

## Sources used
- Repository (HEAD 05795ff):
  - The plan: `docs/plans/dotnet-option-b-prototype.md:34,42,51,53,62,105,109,121,134`.
  - Prototype: `prototypes/dotnet-b/{Fs.Host/*, env.sh, global.json, README.md, reports/3a-reference.md, reports/3a-tier-difference.md}`.
  - Desktop host: `desktop/{server.ts, security.ts, memoryBound.ts, README.md, server.test.ts}`.
  - E2E specs: `e2e/{desktop-real,desktop-cross-origin,host-browser}.spec.ts`.
  - App: `src/core/rng.ts`, `src/sim/remote/RemoteSimController.ts`, `docs/ARCHITECTURE.md:906,1739`, `docs/plans/air-slice-wind-detail-honest-speed.md:124`, `android/app/build.gradle`, `android/app/src/main/AndroidManifest.xml`, `android/variables.gradle`, `scripts/build-android-apk.sh`.
- Scratchpad: `firesim-dotnet.html`; `android-t2/{sdk-install.sh, sdk-install2.sh, jdk-install.sh, wl.sh, wl2.sh, *.log, sdk/licenses}`.
- Installed SDK packs:
  - ASP.NET Core ref XML docs: `Microsoft.AspNetCore.App.Ref/11.0.0` (WebSockets, HostFiltering).
  - .NET Android SDK `Microsoft.Android.Sdk.Linux/37.2.31` targets and build-task strings.
- Commands: `apksigner verify --print-certs`, `keytool -list -v`, `ls -la /root/.android`, `find / -xdev` for keystores, node versus python mulberry32, python Patch-Tuesday dates, releases-index.json via curl.
- Web (fetched 2026-11-12):
  - https://learn.microsoft.com/aspnet/core/fundamentals/websockets (updated 2026-11-11)
  - https://learn.microsoft.com/dotnet/core/compatibility/maui/11/android-minimum-api-level (2026-11-10)
  - https://dotnet.microsoft.com/platform/support/policy/maui
  - https://builds.dotnet.microsoft.com/dotnet/release-metadata/releases-index.json
  - https://devblogs.microsoft.com/dotnet/dotnet-maui-moves-to-coreclr-in-dotnet-11/ (2026-05-13)
  - https://github.com/dotnet/runtime/issues/131370
  - https://localmess.github.io/
  - https://developer.android.com/about/versions/17/behavior-changes-all
  - https://developer.android.com/about/versions/17/behavior-changes-17
  - https://developer.android.com/privacy-and-security/local-network-permission
  - https://source.android.com/docs/core/perf/cached-apps-freezer
  - https://developer.android.com/games/optimize/adpf/thermal
  - https://developer.android.com/studio/publish/app-signing
