# Verifier S, batch S (security, lifecycle, operations)

S-1. Own answer (before reading the claim): No. The plan never says the C# host must match the Node host's refusals. ASP.NET Core WebSocket defaults are: all origins allowed, KeepAliveInterval 2 min, KeepAliveTimeout infinite. Fs.Host is the stock template. The named e2e specs exercise the page-facing guards (code, 5-wrong lockout, Origin, Host 421, kill mid-run) but not the transport-hardening ones.
Verdict: CONFIRMED     Severity: MAJOR     Change follows: partly
Evidence checked:
- `prototypes/dotnet-b/Fs.Host/Program.cs`: `app.MapGet("/", () => "Hello World!");` with no UseWebSockets. `appsettings.json`: `"AllowedHosts": "*"`.
- Grep of `docs/plans/dotnet-option-b-prototype.md` for parity/weaker/guard: no hits. Stage 4 (line 51) names only "a variant of `e2e/desktop-real.spec.ts`, the cross-origin and hostile-name specs, and the throttled-link tool".
- MS Learn WebSockets page (updated 2026-11-11): "KeepAliveInterval ... The default is two minutes." "KeepAliveTimeout ... The default is `Timeout.InfiniteTimeSpan` (disabled)." "AllowedOrigins ... By default, all origins are allowed."
- Node host guards, `desktop/server.ts` 67-80: helloTimeoutMs 5000, maxHelloBytes 4096, maxFrameBytes 128 MiB, maxPending 16 and 4 per address, maxBufferedBytes/maxBufferedMs, rate limit.
- grep of the three e2e specs: they cover 4400 for no Origin and no code (desktop-real:583), 4429 after 5 wrong codes (test 3), 421 hostile Host, 4401, `--allow-origin`, `--lan`, host killed mid-run. None covers the hello timeout, pending caps, message-rate or queue closes, frame limit, decoder limits, or the memory refusal (grep for helloTimeout, queue, memory, decoder, maxFrame gave nothing in e2e).
Notes: The facts are right. "Minority" is roughly fair: about half of the guard families are e2e-covered, so "about half" is also defensible. The `desktop/*.test.ts` Vitest files are unit tests against the Node server and do not run against a C# host. Severity: stage 4's pass condition "protocol 2 met" could pass with a host that has none of these limits. This is a prototype, so a full conformance suite for both hosts is more than the question needs. A rule that the host is not claimed equivalent until its refusals are listed, plus the decoder and memory bound in the slice, would be enough.

S-2. Own answer (before reading the claim): On the phone every local app connects from 127.0.0.1, so a limiter keyed by address treats them as one client. Five wrong codes from any app lock out the page's own correct code for 60 s (the host answers 4429 even to the right code). The pending cap of 4 per address can be filled by other apps. Loopback servers on Android are reachable by any app holding the INTERNET permission, and loopback abuse is documented.
Verdict: CONFIRMED     Severity: MAJOR     Change follows: partly
Evidence checked:
- `desktop/security.ts:122-125`: `addressKey` lower-cases the address and strips `::ffff:` only, so all local apps map to `127.0.0.1`.
- `desktop/security.ts:127-133`: max 5 wrong codes, blockMs 60 000.
- `desktop/README.md:153`: "that address is refused for 60 seconds (close code 4429), also with the right code." `desktop/server.ts:75-77`: maxPending default 16, 4 per address.
- `desktop/README.md:151`: the code is 8 characters, random. In the in-app design the page would have to receive it programmatically, which the plan does not describe.
- https://localmess.github.io/ (fetched): Meta and Yandex apps "silently listen on fixed local ports" and web scripts connect to them. The paper "Bridges to Self" is at USENIX Security '26. Meta stopped June 2025; Chrome 137 and Firefox 139 added countermeasures.
- Plan line 51: "Loopback exposure on a phone (other apps can reach 127.0.0.1) is measured and written up".
Notes: Slight overstatement: Local Mess is web-page-to-app tracking through localhost (apps listening, browsers connecting), not "apps abusing loopback sockets" generally. It still shows loopback ports are reachable and abused in practice. The plan already names the exposure as a stage-4 measurement, so "plan only says measured" is true but the plan does not ignore it. Making the 2(c) pass conditional on the whole list of mitigations goes beyond what the evidence forces; a per-launch secret and limits keyed by connection or secret follow directly.

S-3. Own answer (before reading the claim): 24 (Android 7.0). MS Learn says MAUI 11 raised the floor from 21.
Verdict: CONFIRMED     Severity: NONE     Change follows: yes (none proposed)
Evidence checked:
- MS Learn "Supported platforms" (net-maui-11.0 moniker, updated 2026-09-16): "Android 7.0 (API 24) or higher is required. ... .NET MAUI apps that target .NET 11 require Android API level 24 or higher."
- "What's new in .NET MAUI for .NET 11": "Starting in .NET 11 Preview 3, the minimum supported Android API level has been raised from 21 (Lollipop) to 24 (Nougat)." The plan's "Android 7.0 (API 24) floor" (line 53) matches.
Notes: None.

S-4. Own answer (before reading the claim): No. The plan's only runtime test is a 10-minute foreground run in airplane mode (stage 4); a grep for background, thermal, sustain, freeze, kill, lifecycle and foreground in the plan returns nothing. Android freezes cached apps about 10 s after they become cached and then closes their TCP sockets. Protocol 2 closes a link silent for 60 s and has no reconnect.
Verdict: CONFIRMED     Severity: MAJOR     Change follows: yes
Evidence checked:
- Plan line 51: "A 10-minute run at 60× in airplane mode: no crash, picture cadence held, memory within a stated budget". No other lifecycle test anywhere in the plan.
- https://source.android.com/docs/core/perf/cached-apps-freezer (fetched): "App processes in the cached state are frozen 10 seconds after entering the cached state." "If all processes for a particular app are frozen, the system terminates any active TCP sockets maintained by the app."
- `desktop/README.md:336`: "the host pings every 20 s and closes a connection that has been silent for 60 s". `desktop/README.md:388` lists "a reconnect after a lost link" under what is not there.
Notes: "Probably returns to a closed link" is an inference, but a well-grounded one: the freezer closes sockets, and the 60 s silence check would fire on thaw. Whether a loopback socket is among the "active TCP sockets" is not stated on the page (inference: yes). Today's in-page worker is frozen and thawed with the page, so it does resume; the comparison is fair. The thermal point is reasonable (a short burst cannot show throttling) but I did not verify the ADPF page. The 30 s, 90 s, 5 min and kill tests follow; a foreground service is one design option, not a certainty.

S-5. Own answer (before reading the claim): The installed APKs are debug-signed with the container's `/root/.android/debug.keystore`. I found no other copy. Android refuses an update signed with a different certificate, and uninstalling first removes the app's data.
Verdict: CONFIRMED     Severity: MAJOR     Change follows: yes
Evidence checked:
- `apksigner verify --print-certs` on `FireSim-0.6.0-debug.apk` and `firesim-0.8.0-debug.apk`: both "C=US, O=Android, CN=Android Debug", SHA-256 `f7570f27329a8569200885b4666781e7ce564b8201369cbae0904fa2b7a862e7`.
- `keytool -list -v` on `/root/.android/debug.keystore`: alias androiddebugkey, created Oct 30, 2026, SHA-256 `F7:57:0F:27:...:A8:62:E7`, which matches.
- `ls -la /root/.android/`: keystore dated Oct 30 20:53, 2618 bytes. `git ls-files` for keystore, jks or signing: nothing. No `*.keystore` in the worktree or repo root. The container is the only copy I can see (I cannot see the owner's own machine).
- `scripts/build-android-apk.sh:6`: "signed with the Android debug key — for testing only".
Notes: "No other copy" is limited to what I could look at. The update-signature rule and data deletion on uninstall are standard Android behaviour (not looked up here). That .NET for Android signs with its own separate debug key is from my knowledge, not checked (inference). If true, a MAUI test APK would not install over the owner's app either, which matters for stage 5's "install over the current APK" test; the proposed "same key, same application id, higher version code" is the right condition.

S-6. Own answer (before reading the claim): The simulation uses a seeded mulberry32 generator (the `Rng` class), not `Math.random`. The sequence is exactly reproducible in any language with 32-bit integer maths.
Verdict: REFUTED     Severity: NONE     Change follows: no
Evidence checked:
- `src/core/rng.ts:1-20`: "Small, fast, seedable PRNG (mulberry32) so simulations are reproducible: the same scenario + seed gives the same embers and spot fires."
- `src/sim/simulation.ts:434-437`: `new Rng(so.seed)`, `seed + 1`, `seed + 3`, `seed + 2` for embers, fire, atmosphere and explain.
- Grep for `Math.random` in `src` (non-test): only `src/ui/*` and `src/render/*` files (speedTestKernels, speedControl, timePopover, flowGlyphs, datasets, detailStreaks, detailObstacles, slice/types, flow2d). None in `src/sim`, `src/fire`, `src/core`, `src/embers`.
Notes: The claim is false for the solver. The Rng's `normal`, `logNormal` and `poisson` use `Math.log`, `sqrt`, `cos`, `exp`, so the raw stream is bit-reproducible but transformed draws can differ in the last bits across runtimes (consistent with what 3a perturbed). The plan's stance that the random stream and draw order must be reproduced exactly is achievable.

S-7. Own answer (before reading the claim): Not reproducible from the repo alone. The SDK version and download URL are committed, but the env path is session-specific and the JDK, Android SDK and workload versions are only in scratchpad logs.
Verdict: CONFIRMED     Severity: MINOR     Change follows: yes
Evidence checked:
- `prototypes/dotnet-b/env.sh`: `export DOTNET_ROOT=/tmp/claude-0/-home-user-FireSim/3863bd8b-.../scratchpad/dotnet-sdk` (hard-coded).
- `prototypes/dotnet-b/README.md:19-20`: gives the SDK URL and says the hash was checked "against .../releases.json"; the SHA-512 itself is not written down (it can be re-fetched from that URL, a partial mitigation). No JDK, build-tools, platform or workload versions (grep).
- `global.json`: `"version": "11.0.100", "rollForward": "latestFeature"`. `Directory.Build.props` has no package versions. Android tooling appears only in the scratchpad (`android-t2/jdk-install.sh` uses a `$V` variable plus a checksum file; `sdk-install.sh:6` is `yes | $SM --sdk_root=$ANDROID_HOME --licenses`).
- Plan line 105: "`dotnet add package BenchmarkDotNet` without a version". `reports/` holds only the 3a files and a schema; no TOOLCHAIN file in `prototypes`.
Notes: All sub-claims check out. Weight is low: it affects reproducing the prototype, not any gate. The licence point is real (`yes |` accepts all SDK licences with no list), though the work was delegated. A TOOLCHAIN.md with versions, URLs and hashes is the right fix; lock files matter less for a throwaway prototype.

S-8. Own answer (before reading the claim): (1) 33 MB is the budget in D37 and the architecture table; the measured debug APKs are about 30.4 MB. (2) 2.2 and 6.5 are the 30 m Katoomba numbers from the desktop README; 16 MB comes from a 10 m 6 km study scenario. (3) 3a perturbed inputs by about 4.5 ulp; it did not substitute different exp/pow/sin. (4) and (5) from the Microsoft pages below.
Verdict: PARTLY (items 1, 4 and 5 confirmed; 2 and 3 true but small)     Severity: MINOR (item 5 as a risk-list entry: MAJOR)     Change follows: yes
Evidence checked:
- (1) `docs/plans/air-slice-wind-detail-honest-speed.md:124` (D37): "the APK (33 MB) are unchanged". `docs/ARCHITECTURE.md` table near 1739: "Debug APK ... <= 33 (was 30 before Mount Tomah)", measured 27.6. `ls -l`: `firesim-0.8.0-debug.apk` 30,417,340 bytes, `FireSim-0.6.0-debug.apk` 30,407,436. The artifact says "next to the current 33 MB APK", treating the budget as a measurement. The plan itself (line 53) says "APK size against 33 MB", fine as a budget.
- (2) `desktop/README.md:188`: "6.5 MB on the wire and one snapshot about 2.2 MB" (30 m Katoomba 6 km). 16 MB: `studies/desktop-simulation/README.md:203` "fast, 10 m, 6 km ... 16.0 MB" snapshot; `desktop/README.md:241-242` "synthetic10 ... snapshots of 15.3 MiB". 3a: `3a-reference.md:15` init.bin 6,804,984 bytes, snap-60.bin 2,283,808 bytes (the claim's 6.80 and 2.28 MB). In MiB these are 6.49 and 2.18, so the plan's 6.5 is MiB-like and 2.2 is MiB-like too; units are mixed in the README but differences are under 5%. The 16 MB is a study scenario the app does not ship; "measured in 0.9.0" is loose.
- (3) `reports/3a-tier-difference.md:85`: "I multiplied the 10 m wind speed and the temperature of every weather hour by (1 + eps) and re-ran (1e-15 is about 4.5 ulp of a double)"; lines 95-96: "no ember decision flipped. A numerical difference of a few ulps is not the risk." The artifact says "turned out not to matter (tested)". It is a proxy test of last-bit sensitivity, not a V8-versus-.NET comparison, so "overstates" is fair as wording; the substance is supported, and the plan's bars do not rely on it.
- (4) https://dotnet.microsoft.com/platform/support/policy/maui: ".NET MAUI 11 | November 10, 2026 | 11.0.0 | ... | May 9, 2028". https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core: ".NET 11 | STS | End of support November 14, 2028". Both dates correct; the six-month gap is real and absent from the plan.
- (5) https://devblogs.microsoft.com/dotnet/dotnet-maui-moves-to-coreclr-in-dotnet-11/ : "we have seen community reports of regressions in larger, more complex applications on Android ... dotnet/android#10588 and #10914 ... startup time or app size increased." https://github.com/dotnet/runtime/issues/131370 (fetched): open, labels area-GC-coreclr and os-android, milestone 12.0.0 (moved from 11.0.0 on 2026-08-24), roughly 60 to 54 FPS drops from the Android GC bridge, regression against Mono on .NET 10; a fix removed the regular drops in the repro but the issue stays open. The blog's "opt out to Mono is available" is stale: https://learn.microsoft.com/en-us/dotnet/core/tools/sdk-errors/netsdk1242 (2026-06-16) says the Mono runtime "is no longer supported for that platform" on .NET 11 (applies to android); the only Mono route is targeting net10.0-android.
Notes: "Mono is no longer an option" is right for net11, but Mono remains available by staying on .NET 10 (MAUI 10 support ends 2027-05-11 per the same policy page), which matters to the owner's choice. The issue's repro is a SkiaSharp game; its relevance to a Three.js WebView plus C# engine is uncertain (inference).

## Summary
| ID | Verdict | Severity |
|----|---------|----------|
| S-1 | CONFIRMED | MAJOR |
| S-2 | CONFIRMED | MAJOR |
| S-3 | CONFIRMED | NONE |
| S-4 | CONFIRMED | MAJOR |
| S-5 | CONFIRMED | MAJOR |
| S-6 | REFUTED | NONE |
| S-7 | CONFIRMED | MINOR |
| S-8 | PARTLY | MINOR (item 5 as a risk entry: MAJOR) |

## Sources used
- Repo (worktree): `prototypes/dotnet-b/{Fs.Host/Program.cs,Fs.Host/appsettings.json,env.sh,global.json,README.md,Directory.Build.props,reports/3a-reference.md,reports/3a-tier-difference.md}`; `docs/plans/dotnet-option-b-prototype.md`; `desktop/{server.ts,security.ts,README.md}`; `e2e/{desktop-real,desktop-cross-origin,host-browser}.spec.ts`; `src/core/rng.ts`; `src/sim/simulation.ts`; `docs/ARCHITECTURE.md`; `docs/plans/air-slice-wind-detail-honest-speed.md`; `studies/desktop-simulation/README.md`; `scripts/build-android-apk.sh`.
- Artifact `firesim-dotnet.html` (grep for the quoted statements); the two APKs and `/root/.android/debug.keystore` (`apksigner verify --print-certs`, `keytool -list -v`; no key material printed); `android-t2/*.sh`.
- https://learn.microsoft.com/en-us/aspnet/core/fundamentals/websockets?view=aspnetcore-10.0 (updated 2026-11-11)
- https://learn.microsoft.com/en-us/dotnet/maui/supported-platforms?view=net-maui-11.0 (2026-09-16); https://learn.microsoft.com/en-us/dotnet/maui/whats-new/dotnet-11
- https://dotnet.microsoft.com/platform/support/policy/maui ; https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core
- https://devblogs.microsoft.com/dotnet/dotnet-maui-moves-to-coreclr-in-dotnet-11/ ; https://github.com/dotnet/runtime/issues/131370 ; https://learn.microsoft.com/en-us/dotnet/core/tools/sdk-errors/netsdk1242
- https://source.android.com/docs/core/perf/cached-apps-freezer ; https://localmess.github.io/
