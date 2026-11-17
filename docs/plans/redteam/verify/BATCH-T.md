# Batch T: platform, transports and build (9 items)

Follow VERIFY-COMMON.md. Do Part 1 for an item (investigate the question, write your own answer) before you read that item in Part 2. Useful local files: the installed SDK `.../scratchpad/dotnet-sdk/` (for example `sdk/11.0.100/Microsoft.NETCoreSdk.BundledVersions.props`); a NuGet cache and logs from an earlier toolchain attempt in `.../scratchpad/android-t2/` (logs `*.log`, packages under its NuGet folder). Do not build.

## Part 1: the questions

- **T-1.** In .NET 11 MAUI on Android, how does a byte array travel from .NET to the page through (a) BlazorWebView JS interop and (b) HybridWebView raw messages, and where is it decoded? What other routes can deliver binary data to the page without a string encoding, and does the plan's stage 2 test them?
- **T-2.** Can a .NET 11 MAUI Android app host ASP.NET Core Kestrel (is there a `Microsoft.AspNetCore.App` runtime pack for android RIDs)? If not, how could an in-app loopback WebSocket server be built?
- **T-3.** What is the minimum Android API level supported by .NET MAUI apps targeting .NET 11?
- **T-4.** Can this container build an installable MAUI Android APK today? What happened in the earlier attempt, how much disk does it need, is there KVM, and does Microsoft list Linux as a supported build host for MAUI Android?
- **T-5.** Does the current web page depend on Capacitor's native bridge (plugins, `Capacitor.isNativePlatform()` branches)? What would stop working if the same page ran inside a MAUI WebView with no Capacitor?
- **T-6.** What origin do BlazorWebView and HybridWebView serve pages from on Android, what origin does the current app use, and what would it take for saved sites and runs to survive installing a MAUI build over the current APK (application id, signing certificate, version code)?
- **T-7.** How does FireSim's simulation generate its random numbers, and could the sequence be reproduced exactly in another language?
- **T-8.** What target SDK does a .NET 11 Android project use by default, what does the current app target, and what changes on Android 17 for local network connections when an app targets API 37? What WebView version floor does the current app enforce?
- **T-9.** Which .NET versions does the latest Photino.Blazor NuGet package target?

## Part 2: the claims (read each only after answering its question)

**T-1.**
Claim: Routes (a) and (b) both carry a byte array as a base64 or JSON string through `WebView.PostWebMessage(new WebMessage(string))`, decoded on the page's main thread (the shipped 11.0.0 `blazor.webview.js` decodes with `atob` and a per-byte loop). Two binary routes are missing from stage 2: (d) a `fetch()` on the app origin answered through `WebResourceRequested` with a stream, and (e) AndroidX WebKit's `WebMessageCompat(byte[])` ArrayBuffer messages (feature `WEB_MESSAGE_ARRAY_BUFFER`). So Gate 2 could stop B because of the routes chosen.
Pointers: `.../scratchpad/android-t2/` NuGet cache, `microsoft.aspnetcore.components.webview/11.0.0/staticwebassets/blazor.webview.js` (grep `atob`); dotnet/maui `AndroidWebKitWebViewManager.cs` and `MauiHybridWebView.cs` (main); dotnet/aspnetcore `IpcSender.cs`, `IpcCommon.cs`; https://learn.microsoft.com/dotnet/maui/user-interface/controls/hybridwebview ("Intercept web requests"); https://developer.android.com/reference/androidx/webkit/WebMessageCompat and WebViewFeature; plan section 3 stage 2 and section 7.
Proposed change: five routes in stage 2 ((a) and (b) as baselines, (c) loopback, (d) intercepted fetch, (e) ArrayBuffer messages), stop only if none passes; count the page's decode in the main-thread time.

**T-2.**
Claim: `Microsoft.AspNetCore.App` has no runtime pack for `android-*` or `linux-bionic-*` in .NET 11 (the SDK's bundled versions list none; NuGet returns 404 for `microsoft.aspnetcore.app.runtime.android-arm64`), and dotnet/aspnetcore issue 35077 (MAUI runtimes) is still open in Backlog. So "in-app Kestrel" in stages 2 and 4 cannot be built with supported means; a `TcpListener` with a hand-written upgrade and `WebSocket.CreateFromStream` can.
Pointers: `.../scratchpad/dotnet-sdk/sdk/11.0.100/Microsoft.NETCoreSdk.BundledVersions.props`; https://api.nuget.org/v3-flatcontainer/microsoft.aspnetcore.app.runtime.android-arm64/index.json; https://github.com/dotnet/aspnetcore/issues/35077; Learn `WebSocket.CreateFromStream`.
Proposed change: replace "in-app Kestrel" with a TcpListener-based server and add a loopback configuration matrix.

**T-3.**
Claim: The minimum Android API level for .NET MAUI apps targeting .NET 11 is 24 (Android 7.0).
Pointers: Microsoft Learn, "What's new in .NET MAUI for .NET 11".
Proposed change: none.

**T-4.**
Claim: The container cannot reliably build an APK: the second workload install failed with "No space left on device" (the first succeeded); the doctor build produced only DLLs and no APK; there is no `/dev/kvm`; disk was down to about 0.3 to 0.6 GB; Microsoft's supported-platforms page does not list Linux as a MAUI build host. The plan's section 5 says the build is "downloadable here, but heavy" and its fallback (the owner builds) is effectively the plan.
Pointers: `.../scratchpad/android-t2/wl.log`, `wl2.log`, `doctor-build.log`, `doctor-build.sh`; `ls /dev/kvm`; `df -h /` (note: an orchestrator has since freed space; record what you see now); https://learn.microsoft.com/dotnet/maui/supported-platforms and .../get-started/installation; plan sections 2 and 5.
Proposed change: a stage 0 gate (at least 10 to 15 GB free; a Release APK built and checked with aapt2) before any phone stage; otherwise the agents deliver source and an owner build recipe.

**T-5.**
Claim: The page depends on Capacitor's native bridge in at least four places: native HTTP (`CapacitorHttp`, CORS-free services, the canopy-height service otherwise routed through a dev-server proxy), Preferences (`@capacitor/preferences`, survives WebView storage clearing), Geolocation, and the typed desktop address shown only when `Capacitor.isNativePlatform()`. In a MAUI WebView these take browser paths that do not work, so stage 4's "so the page needs no change" is false and section 7's cost list misses a native-services layer.
Pointers: `src/data/http.ts` (around 4-14, 21, 111, 532); `src/ui/prefs.ts` (4-9, 28); `src/ui/location.ts` (35-36, 80); `src/ui/desktop.ts:171`; `src/ui/mapsShortLink.ts`; `capacitor.config.ts`; plan section 3 stage 4 and 5.
Proposed change: a parity table per Capacitor plugin with its MAUI replacement; strike "the page needs no change"; test with Capacitor absent.

**T-6.**
Claim: HybridWebView serves from a fixed `https://0.0.0.1/` and BlazorWebView from `https://0.0.0.0/` (or 0.0.0.1 depending on a switch), the current app from `https://localhost`; web storage is per origin, so saved sites and runs are invisible to a MAUI page by construction. Installing over the current APK also needs the same application id, the same signing certificate and a higher version code (the app is at versionCode 12). So stage 5's "test what survives" has a known answer, and the real work (a last Capacitor release with export, and a native read of the Capacitor preferences file) is in no stage.
Pointers: dotnet/maui `HybridWebViewHandler.cs` (`AppHostAddress = "0.0.0.1"`), `BlazorWebView .../HostAddressHelper.cs`; `capacitor.config.ts` (scheme comment); `android/app/build.gradle` (versionCode); https://developer.android.com/studio/publish/app-signing; plan section 3 stage 5.
Proposed change: state the known result, design the migration (export release, native preference read), move the origin test into the first hello APK, build it with the same id, key and a higher version code.

**T-7.**
Claim: FireSim's simulation draws its random numbers from Math.random(), so the sequence cannot be reproduced in another language.
Pointers: `src/core/rng.ts`.
Proposed change: none.

**T-8.**
Claim: The .NET 11 Android workload ships only API 37 reference packs, so a template project targets API 37, while the current app targets 36. Android 17 enforces local network protection for apps targeting 37 (outgoing TCP to the local network times out without `ACCESS_LOCAL_NETWORK`, and WebView traffic inherits the app's permission), so the 0.9.0 Wi-Fi desktop link would fail in a MAUI build at 37 without a permission flow; whether 127.0.0.1 counts is undocumented. The current app also enforces a WebView floor (Chrome 108) that a MAUI shell does not.
Pointers: `.../scratchpad/dotnet-sdk/packs/` (Microsoft.Android.Ref.*); `WorkloadDependencies.json` under `.../scratchpad/android-t2/`; `android/variables.gradle`; https://developer.android.com/privacy-and-security/local-network-permission; `capacitor.config.ts` (`minWebViewVersion`); plan section 3 stage 5.
Proposed change: record targetSdk in every result; build at 36 and 37; test both links on an Android 17 device; add the WebView floor to stage 5.

**T-9.**
Claim: The latest Photino.Blazor package (4.0.13) targets net8.0 and net9.0 only, so the artifact's line that it "would cover" Linux for a .NET 11 Blazor app is not established.
Pointers: https://api.nuget.org/v3-flatcontainer/photino.blazor/4.0.13/photino.blazor.nuspec; artifact table row "Desktop windows".
Proposed change: reword the artifact.
