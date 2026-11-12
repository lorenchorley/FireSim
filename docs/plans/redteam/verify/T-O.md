# Batch T, verifier O (2026-11-12)

Plan read in full: `docs/plans/dotnet-option-b-prototype.md` (136 lines, sections 1 to 10), worktree at commit 05795ff.

T-1. Own answer (before reading the claim): (a) BlazorWebView: System.Text.Json turns the `byte[]` into a base64 string inside a `__bwv:` JSON message. On Android that string goes out through `WebView.PostWebMessage(new WebMessage(string))`, and the shipped `blazor.webview.js` decodes it on the page's main thread with `atob` and a per-byte `charCodeAt` loop. (b) In the shipped 11.0.0 package, HybridWebView has only `SendRawMessage(string)`, so the app has to encode the bytes itself, and the string reaches the page as a main-thread message event. Three other routes deliver real binary data: a fetch to the app origin answered by `WebResourceRequested` with a Stream (documented for HybridWebView), AndroidX `WebMessageCompat(byte[])` ArrayBuffer messages (webkit 1.8 or later, behind the `WEB_MESSAGE_ARRAY_BUFFER` feature check), and a loopback WebSocket. Stage 2 tests only the last of these, as route (c).
Verdict: PARTLY     Severity: MAJOR     Change follows: partly
Evidence checked:
- `android-t2/nuget/microsoft.aspnetcore.components.webview/11.0.0/staticwebassets/blazor.webview.js`. Grep output: `function jt(t,n){const r=zt(n);e.dispatcher.receiveByteArray(t,r)}function zt(e){const t=atob(e),n=t.length,r=new Uint8Array(n);for(let e=0;e<n;e++)r[e]=t.charCodeAt(e);return r}`.
- dotnet/aspnetcore main, `IpcSender.cs:90-92`: `SendByteArray(int id, byte[] data) => ...IpcCommon.Serialize(OutgoingMessageType.SendByteArrayToJS, id, data)`. `IpcCommon.cs`: `$"{_ipcMessagePrefix}{JsonSerializer.Serialize(...)}"`, with the prefix `"__bwv:"`.
- dotnet/maui main, `AndroidWebKitWebViewManager.cs:69-71`: `SendMessage(string message) { _webview.PostWebMessage(new WebMessage(message), AndroidAppOriginUri); }`. `MauiHybridWebView.cs:82-85`: `SendRawMessage(string rawMessage) { PostWebMessage(new WebMessage(rawMessage), ...) }`.
- Shipped `microsoft.maui.controls.core/11.0.0/lib/net11.0-android37.0/Microsoft.Maui.Controls.xml`: `HybridWebView.SendRawMessage(System.String)` is the only raw-send overload. `WebViewWebResourceRequestedEventArgs.SetResponse(Int32,String,String,System.IO.Stream)` and a `Task<Stream>` overload exist.
- Learn, HybridWebView (ms.date 2026-07-08, monikers include net-maui-11.0), section "Intercept web requests": "handle the `WebResourceRequested` event ... provide a response via `SetResponse(statusCode, statusDescription, contentType, streamOrTaskOfStream)`".
- developer.android.com, WebMessageCompat (read 2026-11-12): `WebMessageCompat(byte[] arrayBuffer)`, "Added in 1.8.0", `@RequiresFeature(name = WebViewFeature.WEB_MESSAGE_ARRAY_BUFFER ...)`. NuGet `xamarin.androidx.webkit` is at 1.17.1, so a .NET binding exists.
- Indicative cost of route (a) at 16 MB, measured with Node 22 on the container: `JSON.parse 23-46 ms; atob+loop 64-87 ms` per picture. The plan's bars are at most 8 ms of main-thread time per picture and no task over 50 ms. A phone will be slower.
- Plan line 35 (Gate 2): "No transport sustains the rates below on the phone". Plan line 42 lists (a), (b) and (c) only.
Notes: The mechanism is right on every point. Two parts are overstated:
1. Stage 2 already contains a binary route: (c), the loopback WebSocket. Gate 2 already stops only if none of the routes passes. So "stop only if none passes" is not a change, and Gate 2 stops B only if (c) also fails. That can happen: see T-2 (Kestrel cannot be built) and T-8 (local-network rules).
2. The part that matters most is not in the claim. Stage 4 (line 51) weighs loopback exposure "against the interop route that opens no socket". The measured decode cost means (a) and (b) will very likely fail at 16 MB, which leaves no socket-free route that works unless (d) or (e) are added.

What follows: add (d) and (e), and state that the main-thread budget includes the page-side parse and decode. "Five routes" is fine. The stop rule needs no change.

T-2. Own answer (before reading the claim): No. In the installed SDK, `Microsoft.AspNetCore.App` for net11.0 sets `RuntimePackExcludedRuntimeIdentifiers="android;linux-bionic"`, and NuGet has no android runtime pack. Kestrel is therefore not available to a MAUI Android app by supported means. The .NET 11 Android runtime pack does ship a real `System.Net.HttpListener`, which has `AcceptWebSocketAsync`. With it, or with a `TcpListener` plus `WebSocket.CreateFromStream`, an in-app loopback WebSocket server can be built.
Verdict: CONFIRMED     Severity: MAJOR     Change follows: yes
Evidence checked:
- `dotnet-sdk/sdk/11.0.100/Microsoft.NETCoreSdk.BundledVersions.props:151-161`: the net11.0 `Microsoft.AspNetCore.App` entry lists `RuntimePackRuntimeIdentifiers="win-x64;...;linux-musl-loongarch64"`, with no android, and `RuntimePackExcludedRuntimeIdentifiers="android;linux-bionic"`.
- `curl https://api.nuget.org/v3-flatcontainer/<id>/index.json` returned 404 for `microsoft.aspnetcore.app.runtime.android-arm64`, 404 for `...linux-bionic-arm64`, and 200 for `...linux-arm64` as a control.
- github.com/dotnet/aspnetcore/issues/35077, read 2026-11-12: "Support for MAUI runtimes in ASP.NET Core?", state Open, milestone Backlog, labels area-networking and enhancement.
- `dotnet-sdk/packs/Microsoft.NETCore.App.Ref/.../System.Net.WebSockets.xml` contains `WebSocket.CreateFromStream(Stream,Boolean,String,TimeSpan)` and a `WebSocketCreationOptions` overload.
- Alternative route: `android-t2/nuget/microsoft.netcore.app.runtime.android-arm64/11.0.0/runtimes/android-arm64/lib/net11.0/System.Net.HttpListener.dll` is 326,440 bytes and contains no "platform is not supported" string, so it is not a stub. In dotnet/runtime, the `System.Net.HttpListener` ref has no `UnsupportedOSPlatform` attribute and exposes `AcceptWebSocketAsync`.
Notes:
- Only stage 2 literally says "in-app Kestrel" (plan line 42). Stage 4 (line 51) says "over loopback" and does not name a server, although it needs the same thing.
- `HttpListener` is a simpler supported route than a hand-written HTTP upgrade. This is inference: it has not been run on Android.
- The "loopback configuration matrix" is reasonable but follows less directly from this evidence; T-8 is the better reason for it.

T-3. Own answer (before reading the claim): API 24 (Android 7.0). It was raised from 21 in .NET 11 Preview 3, and the .NET 11 Android SDK's default `AndroidMinimumSupportedApiLevel` is 24.
Verdict: CONFIRMED     Severity: NONE     Change follows: yes (none needed)
Evidence checked:
- Learn, "What's new in .NET MAUI for .NET 11" (ms.date 2026-09-10): "Starting in .NET 11 Preview 3, the minimum supported Android API level has been raised from 21 (Lollipop) to 24 (Nougat). This means that .NET MAUI apps in .NET 11 require Android 7.0 or higher."
- Learn, Supported platforms (ms.date 2026-09-08), net-maui-11.0 range: "Android 7.0 (API 24) or higher is required."
- `dotnet-sdk/packs/Microsoft.Android.Sdk.Linux/37.2.31/targets/Microsoft.Android.Sdk.SupportedPlatforms.targets:13`: `<AndroidMinimumSupportedApiLevel ...>24</AndroidMinimumSupportedApiLevel>`. The .NET 10 pack, 36.1.118, says 21.
Notes: The plan already uses this floor at line 53: "Android 7.0 (API 24) floor". The current app also has `minSdkVersion = 24` (`android/variables.gradle:2`).

T-4. Own answer (before reading the claim):
- Not proven either way. The SDK, the `maui-android` workload, Microsoft OpenJDK 21.0.9 and the Android SDK (platform 37, build-tools 37) are installed. A `dotnet new maui` Debug build reached dex generation and then stopped without an exit line, and no APK exists anywhere on the disk.
- The first workload install succeeded. The second, explicit-version install failed with "No space left on device" at about 1.5 GB free.
- There is no `/dev/kvm`. Free disk is now about 6.9 to 7.2 GB; the toolchain uses about 3.6 GB.
- Microsoft's installation page does list Linux as a host for the Android target (`dotnet workload install maui-android`). The supported-platforms page does not mention Linux.
Verdict: PARTLY     Severity: MINOR     Change follows: partly
Evidence checked:
- `wl.log`: "Successfully installed workload(s) maui-android. EXIT 0".
- `wl2.log`: "Workload installation failed: ... (No space left on device : '/tmp/I74uLT/.../microsoft.netcore.app.runtime.aot.linux-x64.cross.android-arm64.11.0.0.nupkg') EXIT 1", followed by `/dev/vda 252G 38G 1.5G 97% /`.
- `restore-tpl.log`: 1.3G available.
- `doctor-build.log` is 376 bytes. It ends at "MauiTest -> .../MauiTest.dll", with no `BUILD-EXIT`, no `ls` output and no `DONE`. In `obj/.../android-arm64/android/bin/`, `classes.dex` and `classes2.dex` are dated 06:12:24, the build started at 06:11:21, and there is no `.apk`. `find / -xdev -name '*.apk'` (newer than wl.sh) returned nothing.
- `ls /dev/kvm`: "No such file or directory".
- `df -h /` now shows 6.9 to 7.2G available. `du`: dotnet-sdk 1.6G, android-t2 2.0G (sdk 505M, nuget 870M, msjdk 346M).
- Learn, installation (ms.date 2026-06-15), Visual Studio Code tab: "To start developing native, cross-platform .NET MAUI apps on Windows, macOS, or Linux", a table row "Linux | Android", and "In the terminal on Linux, run ... dotnet workload install maui-android".
- Learn, supported-platforms (ms.date 2026-09-08) mentions only Visual Studio on Windows, and VS Code on Windows and macOS.
- Plan line 78: "all downloadable here, but heavy ... If it fails, the agents write exact build instructions and the owner builds".
Notes:
- True: the second install hit "No space left"; the first succeeded; the build produced no APK; there is no KVM.
- Not supported by the evidence:
  - "Cannot reliably build". The build was cut off after dexing with no recorded exit code. That looks like an interruption, possibly low disk, and is not a demonstrated build failure.
  - "0.3 to 0.6 GB". The logs show 1.3 to 1.5 GB, and I did not see the lower figure.
  - "Linux not a supported host". Microsoft's installation page lists Linux, with Android as the target. Only the supported-platforms page omits it.
- The plan already has a conditional route: line 78 (owner builds), and T2 is "built to an APK if the Android build works here" (line 63).
- Two small factual updates for plan section 2: KVM is now checked and absent, and the toolchain is installed.
- What follows: a cheap stage-0 smoke gate (one hello APK, built and checked with aapt2). The 10 to 15 GB threshold is not grounded in this evidence.

T-5. Own answer (before reading the claim): Yes. `@capacitor/core` is used for:
- native HTTP: `CapacitorHttp` bypasses CORS, and the non-CORS canopy-height service (`chm`) and Google short links depend on it;
- Preferences: SharedPreferences that survive WebView storage eviction;
- Geolocation;
- the desktop link: the typed desktop address shown when `isNativePlatform()`, plus `allowMixedContent` and the cleartext config that let `ws://` to the LAN through.

In a MAUI WebView, `isNativePlatform()` is false. Preferences fall back to localStorage and still work, but less durably. Services that send CORS headers still work. `chm` goes to a `/proxy/` path that does not exist there. Short links show the "web build" message. Browser geolocation needs a WebChromeClient prompt handler that MAUI's default does not override (inference). The desktop link loses its typed address, and `ws://` is blocked as mixed content unless the shell sets it.
Verdict: PARTLY     Severity: MAJOR     Change follows: yes
Evidence checked:
- `src/data/http.ts:4-14`: "Capacitor native ... requests go through the native HTTP stack (`CapacitorHttp`), which is not subject to CORS ... the one service without CORS headers (the Meta canopy-height bucket) is routed through the dev-server proxy".
- `src/data/http.ts:54`: `chm: { base: 'https://dataforgood-fb-data.s3.amazonaws.com', cors: false }`. `http.ts:111`: `if (Capacitor.isNativePlatform()) return 'native';`.
- `src/ui/prefs.ts:4-5`: "On device this uses @capacitor/preferences (UserDefaults / SharedPreferences, which survive WebView storage eviction); in a browser ... falls back to localStorage". `prefs.ts:28`: `if (!Capacitor.isNativePlatform()) return null;`.
- `src/ui/location.ts:36`: `await import('@capacitor/geolocation')`. `location.ts:80`: `if (Capacitor.isNativePlatform())`.
- `src/ui/desktop.ts:171`: `const typed = Capacitor.isNativePlatform() || params.get('desktopaddr') === '1';`.
- `src/ui/mapsShortLink.ts:7-13`: "On the phone the native HTTP stack is used (CapacitorHttp ...) ... In the plain web build the browser's CORS rules hide the redirect, so nothing is requested".
- `capacitor.config.ts`: `allowMixedContent: true` (comment: the desktop link's `ws://` "is blocked as mixed content unless ...") and `CapacitorHttp: { enabled: true }`.
- dotnet/maui main, `MauiWebChromeClient.cs`: the only overrides are `OnShowFileChooser`, `OnShowCustomView` and `OnHideCustomView`; there is no `OnGeolocationPermissionsShowPrompt`.
- Plan line 51: "speaking protocol 2 over loopback, so the page needs no change". Plan line 93's cost list names the solver port, the Razor screens and the saved-data migration, and no native-services layer.
Notes:
- The four dependencies and the conclusion are right. "The page needs no change" holds only for the protocol, not for the page's platform branches. The cost list misses this layer.
- Overstated: "these take browser paths that do not work".
  - Preferences still work through localStorage. What is lost is the eviction-proof store and the existing native values.
  - CORS-enabled services (Open-Meteo, terrain tiles, NSW feeds) still work.
  - What fails: `chm`, short links, geolocation (unless the shell adds a prompt handler and the location permission), and the desktop link (no typed address; `ws://` blocked as mixed content).
- Missed by the claim: the mixed-content and cleartext settings, which are part of the Capacitor shell's config and not of a plugin.

T-6. Own answer (before reading the claim):
- HybridWebView on Android serves from a hard-coded `https://0.0.0.1/`. BlazorWebView defaults to `https://0.0.0.1/`; the AppContext switch `BlazorWebView.AppHostAddressAlways0000` makes it `0.0.0.0`. The current app serves from `https://localhost`. Web storage is keyed by origin, so a HybridWebView or BlazorWebView page cannot see saved sites and runs.
- A plain MAUI WebView that intercepts `https://localhost` the way Capacitor does would keep the origin. One example is AndroidX `WebViewAssetLoader` with `setDomain("localhost")`.
- An install-over needs the same applicationId (`au.firesim.app`), the same signing certificate, and a versionCode no lower than 12. Because the README's APK is debug-signed, the same signing certificate means the same debug keystore.
Verdict: PARTLY     Severity: MAJOR     Change follows: partly
Evidence checked:
- dotnet/maui main, `HybridWebViewHandler.cs:46`: `private static readonly string AppHostAddress = "0.0.0.1";`. Line 56: "Defaults to https://0.0.0.1/ on Windows and Android".
- dotnet/maui main, `src/BlazorWebView/src/SharedSource/HostAddressHelper.cs`: `GetAppHostAddress() => IsAppHostAddressAlways0000Enabled ? "0.0.0.0" : "0.0.0.1"`. The shipped `microsoft.aspnetcore.components.webview.maui/.../net11.0-android37.0` DLL contains the strings `BlazorWebView.AppHostAddressAlways0000`, `0.0.0.1` and `0.0.0.0`.
- `capacitor.config.ts`: "served by Capacitor from https://localhost ... The scheme above must stay https (it is the page's origin and the key of every saved site and run)".
- `android/app/build.gradle:7,10-11`: `applicationId "au.firesim.app"`, `versionCode 12`, `versionName "0.8.0"`. There is no signingConfig.
- README lines 1316-1320: the APK is "signed with the Android *debug* key".
- developer.android.com, app-signing: "When the system is installing an update to an app, it compares the certificate(s) ... The system allows the update if the certificates match. If you sign the new version with a different certificate, you must assign a different package name".
- developer.android.com, `WebViewAssetLoader.Builder.setDomain`: "Set the domain under which app assets can be accessed. The default domain is appassets.androidplatform.net".
- Plan line 53: "A MAUI shell serves from a different origin. Test what survives ... and what a migration would take". Plan line 93: "the saved-data migration from stage 5".
Notes:
- Correct:
  - The HybridWebView origin is fixed.
  - Storage is per origin.
  - Application id and certificate must match, and the versionCode is 12.
  - The debug-key point means a container-built MAUI APK cannot be installed over the owner's current APK unless it is built with the owner's keystore. That is a real gap in stage 5.
- Wrong or overstated:
  - BlazorWebView's default is the reverse of what the claim says: 0.0.0.1 by default, 0.0.0.0 with the switch.
  - "Invisible by construction" is true only for HybridWebView and BlazorWebView. A plain-WebView shell can keep `https://localhost` and the same `app_webview` data directory (inference, not tested), which could make the migration trivial. It would cost the built-in messaging of routes (a) and (b).
  - "The real work is in no stage": the plan already makes the migration a stage-5 finding and a listed remaining cost (line 93). Building it is out of scope for a prototype, which is reasonable.
  - "Higher versionCode": strictly, an equal versionCode is accepted for sideloading; a lower one is rejected. This is from knowledge and was not re-checked.
- What follows: move the origin test into the first hello APK, and build it with the same id and key. Add the "same-origin plain WebView" option to stage 5. "Export release" is only one option among several.

T-7. Own answer (before reading the claim): The simulation uses a seeded mulberry32 generator (`class Rng`, `src/core/rng.ts`). `src/sim/simulation.ts:434-437` creates separate streams from `so.seed`, `seed+1`, `seed+2` and `seed+3`. It uses only 32-bit integer operations (`Math.imul`, `>>>`) and one division by 2^32, so the uniform stream can be reproduced bit for bit in C# or any other language. `normal()` and `logNormal()` use `Math.log`, `cos` and `exp`, which could differ in the last bit; the draw order must also be matched.
Verdict: REFUTED     Severity: NONE     Change follows: yes (no change; plan section 10's "ports the TypeScript random generator and its draw order exactly" stands)
Evidence checked:
- `src/core/rng.ts:1-3`: "Small, fast, seedable PRNG (mulberry32) so simulations are reproducible". Lines 11-16 are the integer-only `next()`.
- Grep of `Math\.random` in `src` finds only UI element ids (`speedControl.ts:59`, `timePopover.ts:41`, `datasets.ts:153`) and comments that say "never Math.random".
- `src/sim/simulation.ts:434-437`: `new Rng(so.seed)`, `new Rng(so.seed + 1)`, `new Rng(so.seed + 3)`, and `new Rng(so.seed + 2)` for `explain`.
- Cross-language check: Node and Python (`python3 -I`, integer arithmetic) both print `0.5115870486479253 0.5299464082345366 0.6081185641232878 0.5901576359756291 0.8507766961120069` for seed 11, identical.
Notes: The claim is false. The only real porting risks are the transcendental helpers (`normal`, `logNormal`, `poisson` above a mean of 30) and the draw order. The plan's section 10 already handles both.

T-8. Own answer (before reading the claim):
- The .NET 11 Android SDK (37.2.31) supports compiling only against API levels 37, 37.1 and 37.2. `TargetPlatformVersion` defaults to 37.0, so a template targets 37. `android:targetSdkVersion` can still be set lower (36) in the manifest. The current app has compileSdk 36, targetSdk 36 and minSdk 24.
- On Android 17, an app targeting 37 needs `ACCESS_LOCAL_NETWORK`; without it, outgoing TCP to the LAN typically times out, and WebView traffic inherits the host app's permission state. Loopback is not mentioned in Google's documentation.
- The current app sets `minWebViewVersion: 108`, Capacitor's floor; a MAUI shell has no equivalent built in.
Verdict: CONFIRMED     Severity: MINOR     Change follows: yes
Evidence checked:
- `dotnet-sdk/packs/` contains only `Microsoft.Android.Ref.37` (37.2.31). `Microsoft.Android.Sdk.Linux/37.2.31/targets/Microsoft.Android.Sdk.BundledVersions.targets:13-15`: `_AndroidLatestStableApiLevel 37` and `_AndroidSupportedApiLevels ,37,37.1,37.2,`. `SupportedPlatforms.targets:12`: `TargetPlatformVersion ... 37.0`.
- `android-t2/disc/android-WorkloadDependencies.json`: `platforms;android-37.0`, `build-tools;37.0.0`, jdk `[21.0,26.0)`.
- `android/variables.gradle:2-4`: `minSdkVersion = 24`, `compileSdkVersion = 36`, `targetSdkVersion = 36`.
- developer.android.com, local-network-permission (read 2026-11-12):
  - "Starting in Android 17 (API level 37), local network protections are enforced for apps targeting Android 17 or higher".
  - The table shows "Making an outgoing TCP connection | yes".
  - "Traffic originating from Android Webviews that require local network access will inherit permission state from the host app".
  - "TCP Connections will typically result in a timeout error".
  - "If your app targets SDK 36 or lower, local network access is implicitly granted".
  - Loopback or 127.0.0.1 is not mentioned anywhere on the page.
- `capacitor.config.ts`: `minWebViewVersion: 108`.
- The plan's stage 5 (line 53) mentions only the API 24 floor.
Notes:
- Everything stated is true.
- Two nuances:
  - "Build at 36" can only mean a manifest `targetSdkVersion` of 36. TargetPlatformVersion 36 is rejected by .NET 11's supported list.
  - The local-network problem is not specific to option B. The Capacitor app hits the same wall when it moves to target 37. That is why I rate it MINOR, not MAJOR.

T-9. Own answer (before reading the claim): The latest Photino.Blazor on NuGet is 4.0.13, published 2025-01-23. Its nuspec has dependency groups for net8.0 (WebView 8.0.12) and net9.0 (WebView 9.0.1) only. A net11.0 app can still restore it through NuGet's nearest-framework rule, but no build for .NET 10 or 11 has been published and none has been tested.
Verdict: CONFIRMED     Severity: MINOR     Change follows: yes
Evidence checked:
- `https://api.nuget.org/v3-flatcontainer/photino.blazor/index.json`: 22 versions, the last being `4.0.13`.
- `.../4.0.13/photino.blazor.nuspec`: `<group targetFramework="net8.0">` (Microsoft.AspNetCore.Components.WebView 8.0.12) and `<group targetFramework="net9.0">` (9.0.1).
- NuGet registration: 4.0.13 published `2025-01-23T18:08:12Z`.
- Artifact `firesim-dotnet.html:238`: "Linux is not a MAUI platform; Photino.Blazor (a community project) or the current Node host would cover it."
Notes: "Not established" is the right strength. It is unverified rather than excluded, because a net11.0 project can consume net9.0 assets. Whether it works with WebView 11.0.0 is untested. A reword such as "might cover, untested on .NET 11" is enough.

## Summary

| ID | Verdict | Severity |
|---|---|---|
| T-1 | PARTLY | MAJOR |
| T-2 | CONFIRMED | MAJOR |
| T-3 | CONFIRMED | NONE |
| T-4 | PARTLY | MINOR |
| T-5 | PARTLY | MAJOR |
| T-6 | PARTLY | MAJOR |
| T-7 | REFUTED | NONE |
| T-8 | CONFIRMED | MINOR |
| T-9 | CONFIRMED | MINOR |

## Sources used

Local files:
- Repo files:
  - `docs/plans/dotnet-option-b-prototype.md` (lines 35, 42, 51, 53, 63, 78, 93)
  - `capacitor.config.ts`
  - `android/app/build.gradle`
  - `android/variables.gradle`
  - `README.md` (1313-1324)
  - `src/core/rng.ts`
  - `src/sim/simulation.ts:434-437`
  - `src/data/http.ts`
  - `src/ui/prefs.ts`
  - `src/ui/location.ts`
  - `src/ui/desktop.ts`
  - `src/ui/mapsShortLink.ts`
- Artifact HTML: `.../scratchpad/firesim-dotnet.html:238`.
- Installed SDK: `dotnet-sdk/sdk/11.0.100/Microsoft.NETCoreSdk.BundledVersions.props`, `dotnet-sdk/packs/Microsoft.Android.Sdk.Linux/{36.1.118,37.2.31}/targets/*`, `dotnet-sdk/packs/Microsoft.NETCore.App.Ref/.../System.Net.WebSockets.xml`.
- `android-t2/` logs: `wl.log`, `wl2.log`, `doctor-build.log`, `doctor-build.sh`, `restore-tpl.log`, `sdk-install2.log`, `sdk-verify.log`, `disc/android-WorkloadDependencies.json`; also the doctor-verify obj and bin folders.
- `android-t2/nuget` (11.0.0 packages): `blazor.webview.js`, `Microsoft.Maui.Controls.xml`, `Microsoft.Maui.xml`, the `Microsoft.AspNetCore.Components.WebView.Maui.dll` strings, and the android-arm64 `System.Net.HttpListener.dll`.

Source code on GitHub (raw files, main branch, fetched 2026-11-12):
- dotnet/aspnetcore: `IpcSender.cs`, `IpcCommon.cs`
- dotnet/maui: `AndroidWebKitWebViewManager.cs`, `MauiHybridWebView.cs`, `HybridWebViewHandler.cs`, `BlazorWebView.cs`, `SharedSource/HostAddressHelper.cs`, `MauiWebChromeClient.cs`
- dotnet/runtime: the `System.Net.HttpListener` csproj and ref

Web pages (read 2026-11-12):
- GitHub issue: https://github.com/dotnet/aspnetcore/issues/35077
- NuGet flat container: `microsoft.aspnetcore.app.runtime.{android-arm64,linux-bionic-arm64,linux-arm64}`, `photino.blazor` (index, 4.0.13 nuspec, registration), `xamarin.androidx.webkit`
- Microsoft Learn:
  - https://learn.microsoft.com/dotnet/maui/whats-new/dotnet-11 (ms.date 2026-09-10)
  - https://learn.microsoft.com/dotnet/maui/supported-platforms (ms.date 2026-09-08)
  - https://learn.microsoft.com/dotnet/maui/get-started/installation (ms.date 2026-06-15)
  - https://learn.microsoft.com/dotnet/maui/user-interface/controls/hybridwebview (ms.date 2026-07-08)
- Android developers:
  - https://developer.android.com/reference/androidx/webkit/WebMessageCompat
  - https://developer.android.com/reference/androidx/webkit/WebViewAssetLoader.Builder
  - https://developer.android.com/privacy-and-security/local-network-permission
  - https://developer.android.com/studio/publish/app-signing

Commands run:
- `ls /dev/kvm`
- `df -h /`
- `du -sh` on the toolchain folders
- `find / -xdev -name '*.apk'`
- Node 22 timing of a 16 MB JSON parse and base64 decode
- Node versus Python mulberry32 stream comparison
