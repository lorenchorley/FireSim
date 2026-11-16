# Phase 0, T0.5: the test-app shell and a proven Release APK

Date 2026-11-16. Machine: the build container (Linux x64, 4 shared cores, no `/dev/kvm`; other builders shared the cores and the heavy lock, so build times are **indicative**, one run each).
SDK 11.0.100, `maui-android` workload 11.0.0, Android SDK build-tools 37.0.0 (`../TOOLCHAIN.md`). The APKs were built from commit `d9248b4` of the T0.5 branch.

**What this proves and what it does not.** The APK was built, inspected, and its static properties checked. **Nothing in it has run**: there is no emulator or phone here. Section 5 lists
every runtime behaviour that is therefore unverified; round 0 (T0.6c) is its first test.

## 1. The build

```bash
source prototypes/dotnet-b/env.sh
flock /tmp/firesim-heavy.lock dotnet build prototypes/dotnet-b/Fs.TestApp -c Release \
  -p:AndroidPackageFormats=apk -p:EmbedAssembliesIntoApk=true -p:ProtoRound=0        # and =1
bash prototypes/dotnet-b/Fs.TestApp/check-apk.sh <apk> <round>                        # the checks below, as a script
```

| Round | Build | Result | APK |
|---|---|---|---|
| 0 | 1 min 33 s (MSBuild; plus about 11 min waiting for the heavy lock) | 0 warnings, 0 errors | `au.firesim.proto.r0-Signed.apk`, 18,554,217 bytes, SHA-256 `0fb1f8e4...32ce` |
| 1 | 41 s (incremental, same obj folder) | 0 warnings, 0 errors | `au.firesim.proto.r1-Signed.apk`, 18,558,313 bytes, SHA-256 `dbc6caf5...8f50` |

The APK hash changes with every build (the signature is not deterministic), so the hash identifies one built file, which is how the app uses it (it hashes the installed APK at run time).
The unsigned `au.firesim.proto.r<N>.apk` (about 18.4 MB) is also produced; only the `-Signed` one is for a phone.

## 2. Checks (all from `check-apk.sh`, which exits 1 on any failure; both rounds printed `ALL CHECKS PASSED`)

| Check | Round 0 | Round 1 |
|---|---|---|
| `aapt2 dump badging`: package | `au.firesim.proto.r0`, versionCode 1 | `au.firesim.proto.r1`, versionCode 1 |
| label | `FireSim TEST r0` | `FireSim TEST r1` |
| versionName | `0.1.0-test.r0+d9248b4` | `0.1.0-test.r1+d9248b4` |
| minSdk / targetSdk / compileSdk | 24 / 37 / 37 | same |
| native code | `arm64-v8a` only | same |
| debuggable | no (`application-debuggable` absent) | same |
| `uses-permission` | `INTERNET`, `ACCESS_NETWORK_STATE`, `REQUEST_DELETE_PACKAGES`, and `au.firesim.proto.r0.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` (see 3) | same with `r1` |
| FileProvider authority | `au.firesim.proto.r0.fileProvider` | `au.firesim.proto.r1.fileProvider` |
| `apksigner verify --print-certs` | verifies (v2 and v3 schemes; not v1, v3.1, v3.2, v4); one signer, `CN=Android Debug, O=Android, C=US`, RSA 3072, certificate SHA-256 `94aa0085fe7f7e899a2deb68684435d3f0bf654dfdc9d863d223c787239e4da3` | same |
| runtime in the APK | CoreCLR: `libcoreclr.so` (4.8 MB), `libclrjit.so` (2.8 MB), `libmonodroid.so` | same |
| assemblies inside the APK (no fast deployment) | `lib/arm64-v8a/libassembly-store.so` (5.3 MB) holds `Fs.TestApp.dll`, `Fs.TestApp.Core.dll`, `Microsoft.Maui.dll`, `System.Private.CoreLib.dll` (checked by name inside the store); there is no `assemblies/` folder in .NET 11 Android packaging and no fast-deploy marker | same |
| HybridWebView host page | `assets/wwwroot/index.html` (572 bytes), `assets/wwwroot/arm-host.js` (4.8 KB) | same |
| androidx.webkit 1.18 in the dex | `CROSS_ORIGIN_ISOLATED_ALLOWLIST` string found in `classes.dex` | same |
| two rounds differ | id, label, version name, FileProvider authority, provider authorities, icon tint (r0 blue-grey `#455A64`, r1 green `#1B5E20`) all change; the two APKs install side by side by construction (different ids) | |

The signing key: the fingerprint is the one `../TOOLCHAIN.md` 3.2 records (`94aa0085...4da3`), .NET Android's own default debug key. No password, keystore path argument or key material was printed or passed; the script
filters those words from the `apksigner` output. This key is not the real app's key (`f7570f27...a862e7`), which is the intended arrangement (plan section 1, O-5).

The icon (viewed from the generated `mipmap-xxhdpi/appicon.png` and `appicon_foreground.png`): the flame and a red diagonal band with white block letters **TEST** across the whole icon, on a tinted background.
The letters are drawn as rectangles so the result does not depend on a font in the build container. How it looks in a launcher (adaptive-icon masks) is unverified.

## 3. Permissions: what the libraries add, and what was done

Plan section 5 allows `INTERNET`, `ACCESS_NETWORK_STATE`, `REQUEST_DELETE_PACKAGES` and no others. The hello APK (T0.4) also had `USE_BIOMETRIC`, `USE_FINGERPRINT` and
`<package>.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`. Where they come from (from `hello/maui-android/packages.lock.json` and the merged manifest):

- `USE_BIOMETRIC` and `USE_FINGERPRINT`: **androidx.biometric** (`Xamarin.AndroidX.Biometric` 1.1.0.33), a dependency of **Xamarin.AndroidX.Credentials**, which the MAUI libraries pull in. This app uses neither.
  **Removed**: `<uses-permission ... tools:node="remove" />` in `Platforms/Android/AndroidManifest.xml`; .NET Android merges manifests with the Android `manifestmerger.jar`, which honours it.
  The compiled APK has neither.
- `au.firesim.proto.r<N>.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`: **androidx.core** declares a signature-level permission of the app's own and requests it, so that receivers registered as "not exported" by
  `ContextCompat.registerReceiver` can be sent broadcasts by the app itself on Android 12 and below. **Not removed, on purpose**: an app does not hold its own permission unless it requests it, so
  removing the request could silently stop a library's receiver from getting broadcasts. It is the app's own, grants access to nothing, and shows no prompt. **So the APK has four `uses-permission` lines, not three;
  the fourth is inert and cannot be dropped without a risk this card cannot test.** `check-apk.sh` allows exactly this one extra line and fails on any other. If the owner wants three strictly, the way is
  `tools:node="remove"` on it plus a runtime test on an Android 12 phone; that is a decision for the orchestrator.
- `BATTERY_STATS` is not used anywhere: charge is read from the sticky `ACTION_BATTERY_CHANGED` broadcast (`RegisterReceiver(null, filter)`).

## 4. The container dry run and the tests

`dotnet test --project Fs.Tests`: **150 tests, all passed** (75 from T0.4, 75 new in `Fs.Tests/TestApp/`), 12.8 s. `dotnet run --project Fs.TestApp.DryRun`: **10 of 10 scenarios passed**.
The dry run drives the same `TestSession`, `BlockRunner`, `DeviceGate`, `FileResultStore`, `HttpResultsSender` and `ResultsDelivery` code that the phone runs, with a simulated phone, stub arms and an in-process
`HttpListener` that plays the results endpoint (checks the upload code, the key, the size and the schema; stores one result per key).

| Scenario | What it shows |
|---|---|
| a-happy-path | stub arms in an A B B A plan plus a block that heats the simulated phone: the gate before the next block waited 257 ms for the thermal status to return to none; saved document is schema-valid (5,933 bytes, 3 blocks, 5 arms, 25 thermal samples, 3 gate events); receipt `issue 17`; done line `Done. Results sent at HH:mm (receipt: issue 17). You can uninstall this test app now.`; the endpoint holds exactly one result under key `<apk sha>:<run id>` |
| b-lost-answer | the endpoint stores the result and never answers; the client times out, retries with the same key, gets `duplicate: true` with the original issue; still one stored result; attempts on record: Retry (no status), Sent |
| c-offline-then-online | no network at the end of the run: *Turn the network back on to send the results.*, nothing sent, document saved; sends when the network returns |
| d-pause-reruns-block | the app goes to the background in the middle of a block: arm cancelled and recorded `paused`, block attempt 1 `paused`, attempt 2 `ok`, pause and resume logged, final status complete |
| e-server-errors-then-ok | 500, 429, then 201: three attempts, back-off between them, one stored result |
| f-rejected-then-fallbacks | wrong upload code: one attempt, 401, not retried; the upload code appears in no recorded detail; the GitHub address is 1,162 characters (cap 6,144) and carries the key; Share, GitHub-opened and Uninstall outcomes are recorded in the state file |
| g-low-battery-aborts | 30 % and not charging: gate waits, then the run stops; both blocks `skipped`, status `aborted`, still valid and still sent |
| h-no-endpoint | the default build (no endpoint, no repository): saved, not sent, says so; no GitHub address |
| i-relaunch-resumes | opening the app after a finished run shows Done with the receipt; no second run, no second send |
| j-not-now | *Not now* stops the countdown; *Start* runs through to a receipt |

Unit tests (the card's list): gating (50 % is not enough, charging passes, five-minute thermal cap, unreadable thermal, plug-in while waiting), **the 6 KB cap on the percent-encoded address**
(a document whose plain summary is smaller than 6,144 characters but whose encoding is larger; every level of degradation; hard cut; fence cannot be broken; repository name checked), **idempotency key stability**,
**retry after a lost answer does not create a second result** (with a deduplicating fake sender, and with the real `HttpResultsSender` against the in-process endpoint including a timeout),
back-off growth and cap, the 64 KB limit and log thinning, schema validation (valid, optional parts, every kind of violation, unsupported keywords refused, the two existing container result files still valid),
the block runner (ordering helpers, arm errors, pause cancels and re-runs, pause that the arm ignores, give-up limit, page hidden, screen off, low battery, cancellation), store round trips, and the fixed screen texts.

## 5. Not verified: everything that runs on Android

There is no emulator or phone in this container. The following were written carefully (documented calls, each inside try/catch that records the failure in the result document) but **have never run**.
Round 0 (T0.6c) will test them; a failure of any of them shows in the document, not as a crash, unless it happens before the document exists.

**App start**: that the Release APK installs on the phone (v2/v3 signature only, minSdk 24), starts, and survives the first screen (CoreCLR, assembly store, ReadyToRun image, trimming of the app assembly).
**Labelling**: how the icon and the label look in the launcher; that `AppInfo.VersionString` returns the version name with `+<commit>` (the commit in the document is parsed from it).
**Screen**: the first-screen text and the countdown rendering; `DeviceDisplay.KeepScreenOn`; the Not now button; the Done screen with its four buttons.
**Device state** (`AndroidDeviceState`): the sticky battery broadcast (`RegisterReceiver(null, filter)` on target SDK 37); `BatteryManager` charge counter units and availability; `PowerManager.CurrentThermalStatus` (API 29+) and
`GetThermalHeadroom` (API 30+, cached 1.5 s, NaN becomes absent); `Settings.Global.AirplaneModeOn`; `Connectivity` and its change event; `OnPause`/`OnResume` events reaching the pause monitor; screen-off via `OnPause` only.
**Run facts** (`AndroidRunEnvironment`): reading the installed APK for the SHA-256 (`ApplicationInfo.SourceDir`); `Build.SocModel`; the `/sys/devices/system/cpu/*/cpufreq` read (newer Android may refuse it: then `cpuCores` is simply absent);
`WebView.CurrentWebViewPackage`; memory info.
**WebView host**: that `HybridWebView` loads `https://0.0.0.1/index.html`; that `WebResourceRequested` fires for the page files, that `SetResponse(...)` with headers and a `Task<Stream>` body works and the page and script load from it;
that `_framework/hybridwebview.js` still loads (the framework serves it); `InvokeJavaScriptAsync` with the global function names and string arguments; `SendRawMessage` reaching `RawMessageReceived`; progress and cancellation across the bridge;
the page's `visibilitychange`; the page-ready timeout (20 s).
**Cross-origin isolation**: whether the WebView honours `Document-Isolation-Policy: isolate-and-require-corp` on this WebView version; whether the Java-reflection calls (`WebViewFeature.isFeatureSupported`, `WebViewCompat.getProfile`,
`Profile.setCrossOriginIsolatedAllowlist(Set<String>)`) find their classes and methods in the dex and run; whether `"https://0.0.0.1"` is the right origin string for the allowlist; whether `WebViewFeature.MULTI_PROFILE` is needed and present.
The document records every step (`webView.allowlist`, `webView.isolationHeaderSent`, `webView.extra.headerSeenByPage`, `crossOriginIsolated`, `sharedArrayBuffer`), so round 0 shows which one failed if shared memory is not obtained.
**Sending**: the HTTPS POST from the phone (TLS, proxies, the connectivity events); the 6 KB GitHub address opening in the phone's browser; labels prefilled only for a user with write access (the owner).
**Share**: `Share.Default.RequestAsync` with a file from the cache directory through MAUI Essentials' FileProvider (the authority was checked in the manifest; whether the file path is covered by the provider's path configuration is not).
**Uninstall**: `ACTION_DELETE` on `package:<id>` on target SDK 37, whether `REQUEST_DELETE_PACKAGES` is enforced for it, the fallback to the App info page, and the "tried to uninstall" note on the next launch.
**Lifecycle**: a relaunch over the same id with saved data (the resume path); the pause re-run with a real background WebView; behaviour when Android freezes or kills the app mid-run (the run is not resumable: the app starts a new run, and the old document, if saved, is shown instead).

## 6. Findings worth the orchestrator's attention

1. **androidx.webkit 1.18 has no NuGet binding.** `Xamarin.AndroidX.Webkit` stops at 1.17.1 (checked on nuget.org), and MAUI does not reference it. 1.18.0 exists on Google Maven (checked: `maven-metadata.xml`, SHA-1 matches the `.sha1`).
   I added it as `<AndroidMavenLibrary Include="androidx.webkit:webkit" Version="1.18.0" Repository="Google" Bind="false" />` (the classes go into the dex, no C# binding) and call the three needed members through Java reflection; the build compares
   the downloaded AAR with SHA-256 `f15a0bd7d51f4bb8dffdd3a2cf5829f9a7de9ad4ba2682fa85d619032050581f` and fails on a difference. The first build needs network access to `dl.google.com` (the cache is `~/.cache/dotnet-android/MavenCacheDirectory`).
   From the 1.18.0 AAR (read with `javap`): the allowlist is `Profile.setCrossOriginIsolatedAllowlist(Set<String>)` / `getCrossOriginIsolatedAllowlist()`, with the profile from `WebViewCompat.getProfile(WebView)`; the feature constant is
   `WebViewFeature.CROSS_ORIGIN_ISOLATED_ALLOWLIST`. The plan names only the constant. Reading the Java side has not told me the exact origin format the allowlist wants; `https://0.0.0.1` is a guess from the other origin-rule APIs.
2. **Response headers on MAUI's asset path.** MAUI's default asset response carries only `Content-Type`, so `Document-Isolation-Policy` cannot be added by configuration. The way is the `HybridWebView.WebResourceRequested` event (new in .NET 10/11) with
   `SetResponse(code, reason, headers, Task<Stream>)`, answering only listed files. The ordering of that event against the framework's internal paths was read from the MAUI **`main`** branch source on GitHub
   (`MauiHybridWebViewClient.ShouldInterceptRequest`: internal bridge first, then `WebResourceRequested`, then framework assets), not from the 11.0.0 release tag; the signatures were checked against the shipped 11.0.0 XML documentation.
   If 11.0.0 differs, the page still loads (the handler returns without handling on any exception) but without the header, and the document says so.
3. **Assemblies are in `libassembly-store.so`.** The T0.5 card says "assemblies inside the APK (no fast deployment)"; in .NET 11 Android that is the assembly store, not an `assemblies/` folder.
4. The upload endpoint's contract (headers `Idempotency-Key` and `X-Upload-Code`, answer `{"issue","url","duplicate"}`, status handling) is **defined here** (`RESULTS-SCHEMA.md`, `Senders.cs`) because T0.6a does not exist yet; the in-process endpoint of the dry run implements it. T0.6a must match it or change it.
5. **`ProtoGitHubRepo` is empty by default**, because the results repository name is still open (plan O-6). Until it is given at build time, *Send with GitHub* says there is no repository and *Share* is the only fallback.
6. A finding from building the dry run: `HttpListener.Response.Abort()` before any byte is written makes .NET's managed listener answer `200` with an empty body, which is not a lost answer; the fake endpoint therefore stays silent past the client's timeout instead.
7. The APK is not reproducible bit for bit (the signature varies), so two builds of one commit have different SHA-256; the idempotency key uses the hash of the file that is installed.
