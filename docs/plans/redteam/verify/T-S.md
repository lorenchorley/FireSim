# Batch T, verifier S

T-1. Own answer: Both Blazor interop and HybridWebView raw messages go to the page as strings via WebView.PostWebMessage(new WebMessage(string)); the page decodes base64 in JS. Binary-capable routes exist (intercepted fetch via WebResourceRequested streams; AndroidX WebMessageCompat ArrayBuffer; loopback socket). Plan stage 2 lists only (a), (b), (c).
Verdict: CONFIRMED     Severity: MAJOR     Change follows: yes
Evidence checked: shipped 11.0.0 blazor.webview.js (android-t2 nuget cache): `function jt(t,n){const r=zt(n);e.dispatcher.receiveByteArray(t,r)}function zt(e){const t=atob(e),n=t.length,r=new Uint8Array(n);for(let e=0;e<n;e++)r[e]=t.charCodeAt(e);return r}`. dotnet/maui main AndroidWebKitWebViewManager.cs: `_webview.PostWebMessage(new WebMessage(message), AndroidAppOriginUri)`; MauiHybridWebView.cs: `SendRawMessage(string)` -> `PostWebMessage(new WebMessage(rawMessage), AndroidAppOriginUri)`, no WebMessageCompat. Learn HybridWebView "Intercept web requests": `e.SetResponse(200,"OK",contentType, Stream or Task<Stream>)`. developer.android.com WebMessageCompat: `WebMessageCompat(byte[] arrayBuffer)` requires WebViewFeature.WEB_MESSAGE_ARRAY_BUFFER, added in androidx.webkit 1.8.0. Plan line 42 lists (a),(b),(c) only.
Notes: The decode runs in the page on the main thread (true for blazor.webview.js; for HybridWebView the string reaches page JS and the user's own code decodes, inference). Whether the Android WebView supports ArrayBuffer messages on the target phone, and whether the MAUI handlers expose a hook for (e) without custom native code, was not verified; (d) is documented. "Gate 2 could stop B because of routes chosen" is a fair risk because the gate says stop if no transport sustains the rates (plan line 35); (c) loopback would probably pass anyway, so MAJOR not BLOCKER. Adding (d), (e) is cheap and follows.

T-2. Own answer: No. The SDK's KnownFrameworkReference for Microsoft.AspNetCore.App (net11.0) excludes android and linux-bionic runtime packs, so Kestrel cannot be supported in a MAUI Android app. A loopback WebSocket server would be hand-built on TcpListener plus WebSocket.CreateFromStream.
Verdict: CONFIRMED     Severity: MAJOR     Change follows: yes
Evidence checked: dotnet-sdk/sdk/11.0.100/Microsoft.NETCoreSdk.BundledVersions.props lines 151-160: Microsoft.AspNetCore.App net11.0 ... `RuntimePackExcludedRuntimeIdentifiers="android;linux-bionic"` (the Microsoft.NETCore.App entries do list android-*). `curl https://api.nuget.org/v3-flatcontainer/microsoft.aspnetcore.app.runtime.android-arm64/index.json` returned HTTP 404; `...runtime.linux-bionic-arm64` returned BlobNotFound; `...runtime.linux-arm64` exists (11.0.0). dotnet/aspnetcore #35077 "Support for MAUI runtimes in ASP.NET Core?": Open, milestone Backlog, last activity 2026-05-01.
Notes: "cannot be built with supported means" is right as stated; unsupported hacks (individual Kestrel assemblies) were not tested and are not needed. TcpListener plus WebSocket.CreateFromStream is a standard BCL route (not tested here). The plan's stage 4 desktop host runs on linux/win RIDs where Kestrel exists, so only the in-app part is affected.

T-3. Own answer: 24 (Android 7.0).
Verdict: CONFIRMED     Severity: NONE     Change follows: yes (none proposed)
Evidence checked: learn.microsoft.com/dotnet/maui/supported-platforms (net-maui-11.0 moniker, updated 2026-09-16): "Android 7.0 (API 24) or higher is required... apps that target .NET 11 require Android API level 24 or higher". What's-new-in-.NET-11: "minimum supported Android API level has been raised from 21 to 24". Template csproj in doctor-verify: SupportedOSPlatformVersion 24.0 for android. Matches the app's own minSdk 24 (android/variables.gradle:2).
Notes: Plan's "API 24 floor" is consistent; no issue.

T-4. Own answer: Not reliably. The earlier workload install ran out of disk; the doctor build made DLLs only; no /dev/kvm; Microsoft documents Visual Studio / VS Code on Windows and macOS.
Verdict: CONFIRMED     Severity: MAJOR     Change follows: yes
Evidence checked: android-t2/wl2.log: "Workload installation failed: ... (No space left on device : '/tmp/I74uLT/dotnet-sdk-advertising-temp/microsoft.netcore.app.runtime.aot.linux-x64.cross.android-arm64/...')"; wl.log ends with maui-android 11.0.0/11.0.100 listed then DONE. doctor-build.log last lines: only `MauiTest -> .../MauiTest.dll`; the bin folder has MauiTest.dll/.pdb/.xml and no .apk. `ls /dev/kvm`: No such file. `df -h /` now: 252G size, 7.2G free (82%); during the attempt it showed 1.5G free at 97%. Learn supported-platforms (2026-09-16): apps "can be built in Visual Studio"; Windows and macOS for VS Code with the MAUI extension. Linux is not listed as a build host.
Notes: The disk need was not measured by me; "10 to 15 GB" is a reasonable inference. The plan section 5 already says "not guaranteed... If it fails, the agents write exact build instructions and the owner builds" (line 77), so the fallback is stated; "effectively the plan" is rhetoric. A stage 0 gate is sensible. The workloads did install on Linux, so "not supported" means undocumented, not demonstrably impossible.

T-5. Own answer: Yes: CapacitorHttp for non-CORS services, @capacitor/preferences, @capacitor/geolocation, and isNativePlatform branches (desktop typed address, HTTP platform detection). Inside a MAUI WebView without Capacitor, isNativePlatform() is false, so browser paths apply.
Verdict: CONFIRMED     Severity: MAJOR     Change follows: yes
Evidence checked: src/data/http.ts:20-21 imports Capacitor/CapacitorHttp; :111 `if (Capacitor.isNativePlatform()) return 'native'`; :532 `CapacitorHttp.request(o)`; header comment says the canopy-height bucket has no CORS and goes through the dev-server `/proxy/<service>`. src/ui/prefs.ts:28 `if (!Capacitor.isNativePlatform()) return null; ... import('@capacitor/preferences')`, comment: survives WebView storage eviction. src/ui/location.ts:35,80 `@capacitor/geolocation` under isNativePlatform. src/ui/desktop.ts:171 `const typed = Capacitor.isNativePlatform() || params.get('desktopaddr') === '1'`; src/main.ts:42 gates startDesktop on isNativePlatform or http(s). mapsShortLink.ts:7 uses CapacitorHttp. capacitor.config.ts: `CapacitorHttp: { enabled: true }`. Plan stage 4 (line 51): "so the page needs no change"; grep of the plan for capacitor/preferences/geoloc/CORS finds no cost line.
Notes: Slight overstatement: "browser paths that do not work". CORS-enabled services (Open-Meteo, terrain tiles, NSW feeds) are documented as working from a browser; the failing ones are the non-CORS ones (canopy bucket, Maps short-link redirects), and geolocation depends on the shell granting the WebView permission. Preferences fall back to localStorage (degraded, not broken). The loss is partial, but "needs no change" is still false. The parity table follows.

T-6. Own answer: Capacitor serves https://localhost; HybridWebView serves https://0.0.0.1/ (https scheme on Android, "app" on iOS); BlazorWebView serves https://<AppHostAddress>/ (0.0.0.0 historically, 0.0.0.1 after a Chrome-129-related change). Different origin means separate storage. An in-place upgrade needs the same application id, same signing key, higher versionCode.
Verdict: PARTLY     Severity: MINOR     Change follows: partly
Evidence checked: dotnet/maui HybridWebViewHandler.cs: `AppHostAddress = "0.0.0.1"`, `AppOrigin = $"{AppHostScheme}://{AppHostAddress}/"`, scheme https except iOS/MacCatalyst "app". AndroidWebKitWebViewManager.cs: `AppOrigin = $"https://{BlazorWebView.AppHostAddress}/"`. The 0.0.0.0/0.0.0.1 switch comes from a web search of dotnet/maui PR #23906 (default changed to 0.0.0.1) and source.dot.net `HostAddressHelper.GetAppHostAddress()`; I did not read the helper itself (raw URL 404). capacitor.config.ts: "The scheme above must stay https (it is the page's origin and the key of every saved site and run)"; android/app/build.gradle:7,10 applicationId "au.firesim.app", versionCode 12. Plan line 53 and line 93.
Notes: The technical facts are true. Overstated: "the real work is in no stage". Plan line 53 says stage 5 will "Test what survives an install over the current APK and what a migration would take", and line 93 lists "the saved-data migration from stage 5" as a remaining cost, so migration is scoped as a finding, not built. The outcome is known by construction (different origin, per-origin storage), so the test is partly redundant, but the plan does not state the id/signing-key/versionCode prerequisites. Signing config was not inspected. Moving an origin check into the first hello APK is cheap and sound.

T-7. Own answer: It uses a seeded PRNG (mulberry32) built for reproducibility, and it is easily reproduced in any language with 32-bit integer arithmetic.
Verdict: REFUTED     Severity: NONE     Change follows: n/a (claim wrong; no change proposed)
Evidence checked: src/core/rng.ts:1-24: "Small, fast, seedable PRNG (mulberry32) so simulations are reproducible: the same scenario + seed gives the same embers and spot fires.", using `Math.imul` and `>>> 0`; normal() is Box-Muller, poisson is Knuth. `grep Math.random src`: only UI element ids (timePopover.ts:41, speedControl.ts:59), a cache stamp (screens/datasets.ts:153), and comments saying not to use it; none in src/core.
Notes: Exact reproduction of derived draws needs care with Math.log/cos/exp (libm ulp differences). That affects the "draw order ported exactly" bar (plan line 131) but not the integer stream.

T-8. Own answer: The Android workload in the installed SDK ships only the API 37 reference pack, so template apps target 37 (no targetSdk in the manifest). The current app targets 36 and enforces a Chrome 108 WebView floor. Android 17 gates LAN access behind ACCESS_LOCAL_NETWORK for apps targeting 37.
Verdict: CONFIRMED     Severity: MAJOR     Change follows: yes
Evidence checked: dotnet-sdk/packs contains only Microsoft.Android.Ref.37 (and Runtime.*.37.*); android workload manifest 37.2.31 references only `Microsoft.Android.Ref.37`; template Platforms/Android/AndroidManifest.xml has no targetSdkVersion; android/variables.gradle:3-4 compileSdk 36, targetSdk 36; capacitor.config.ts `minWebViewVersion: 108`. developer.android.com/privacy-and-security/local-network-permission: "Starting in Android 17 (API level 37), local network protections are enforced for apps targeting Android 17 or higher"; "Making an outgoing TCP connection: yes"; "Traffic originating from Android Webviews that require local network access will inherit permission state from the host app"; TCP failures "typically result in a timeout error"; apps targeting below 37 get an implicit grant. The page says nothing about 127.0.0.1 or loopback.
Notes: Whether a MAUI app can target 36 with only the 37 reference pack was not tested (inference: yes via a manifest/targetSdk override), so "build at 36 and 37" is plausible but unproven. "A MAUI shell does not enforce the WebView floor" is inference (no such setting seen). MAJOR because the 0.9.0 Wi-Fi link would silently time out at target 37.

T-9. Own answer: 4.0.13, targeting net8.0 and net9.0.
Verdict: CONFIRMED     Severity: MINOR     Change follows: yes
Evidence checked: api.nuget.org/v3-flatcontainer/photino.blazor/index.json: last version "4.0.13". Its nuspec has dependency groups net8.0 (Microsoft.AspNetCore.Components.WebView 8.0.12, Photino.NET 4.0.16) and net9.0 (WebView 9.0.1) only. Artifact firesim-dotnet.html row "Desktop windows": "Linux is not a MAUI platform; Photino.Blazor (a community project) or the current Node host would cover it."
Notes: The artifact lists Photino.Blazor as one option next to the Node host, so "would cover" is soft. A net9.0 package may still restore on net11 but with old WebView component versions (inference; untested), so "not established" is fair. A rewording such as "targets .NET 8 and 9; .NET 11 untested" is enough.

## Summary
| ID | Verdict | Severity |
|---|---|---|
| T-1 | CONFIRMED | MAJOR |
| T-2 | CONFIRMED | MAJOR |
| T-3 | CONFIRMED | NONE |
| T-4 | CONFIRMED | MAJOR |
| T-5 | CONFIRMED | MAJOR |
| T-6 | PARTLY | MINOR |
| T-7 | REFUTED | NONE |
| T-8 | CONFIRMED | MAJOR |
| T-9 | CONFIRMED | MINOR |

## Sources used
- Repo: capacitor.config.ts, android/app/build.gradle, android/variables.gradle, src/core/rng.ts, src/data/http.ts, src/ui/prefs.ts, location.ts, desktop.ts, mapsShortLink.ts, src/main.ts, docs/plans/dotnet-option-b-prototype.md
- Scratchpad: dotnet-sdk BundledVersions.props, packs listing, android workload manifest; android-t2 logs (wl.log, wl2.log, doctor-build.*), nuget blazor.webview.js, doctor-verify template; firesim-dotnet.html
- https://raw.githubusercontent.com/dotnet/maui/main/src/Core/src/Handlers/HybridWebView/HybridWebViewHandler.cs, .../Platform/Android/MauiHybridWebView.cs, .../BlazorWebView/src/Maui/Android/AndroidWebKitWebViewManager.cs (fetched 2026-11-12)
- https://learn.microsoft.com/en-us/dotnet/maui/supported-platforms ; .../whats-new/dotnet-11 ; .../user-interface/controls/hybridwebview (fetched 2026-11-12)
- https://developer.android.com/reference/androidx/webkit/WebMessageCompat ; https://developer.android.com/privacy-and-security/local-network-permission
- https://github.com/dotnet/aspnetcore/issues/35077 ; https://api.nuget.org/v3-flatcontainer/ (photino.blazor, microsoft.aspnetcore.app.runtime.*)
- Web search on dotnet/maui PR #23906 (BlazorWebView host 0.0.0.1)
