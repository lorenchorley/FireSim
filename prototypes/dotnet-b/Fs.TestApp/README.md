# Fs.TestApp: the test APK (plan T0.5, section 5)

A .NET MAUI Android app, labelled as a test (**"FireSim TEST r<N>"**, id `au.firesim.proto.r<N>`), that runs a list of measurements by itself after a 10-second countdown,
saves a result document on the phone, sends it, shows a receipt, and offers *Uninstall*. Every phone round of the option B prototype is one build of this app with a different arm list.

Not in `FsProto.slnx` (it needs the `maui-android` workload). Everything that does not need Android is in `../Fs.TestApp.Core` (in the solution, unit-tested in `../Fs.Tests/TestApp`),
and `../Fs.TestApp.DryRun` runs the whole session logic in the container against a fake phone and a local endpoint.

| Folder | What |
|---|---|
| `../Fs.TestApp.Core` | arm interface, block runner and A B B A ordering, device gate (`IDeviceState`), result document, schema validator, save-then-send store, senders, retry, `TestSession` (countdown to Done) |
| `../Fs.TestApp.DryRun` | container dry run: 10 scenarios (happy path, lost answer, offline, pause, server errors, rejection, low battery, no endpoint, relaunch, Not now) |
| `Fs.TestApp.csproj`, `MauiProgram.cs`, `TestPage.cs` | the app, the one screen, the stub plan |
| `Platforms/Android/` | manifest, `MainActivity` (OnPause/OnResume), `AndroidDeviceState`, `AndroidRunEnvironment`, `AndroidPlatformActions` (Share, Uninstall, open URL), `IsolationAllowlist` |
| `WebHost/ArmHost.cs`, `Resources/Raw/wwwroot/` | the HybridWebView arm host: C# side and the page (`index.html`, `arm-host.js`) |

## Build a round

```bash
source prototypes/dotnet-b/env.sh                      # .NET 11.0.100, Microsoft JDK, Android SDK, NuGet cache (see ../TOOLCHAIN.md)
flock /tmp/firesim-heavy.lock \
  dotnet build prototypes/dotnet-b/Fs.TestApp -c Release \
    -p:AndroidPackageFormats=apk -p:EmbedAssembliesIntoApk=true -p:ProtoRound=1
# -> prototypes/dotnet-b/Fs.TestApp/bin/Release/net11.0-android/android-arm64/au.firesim.proto.r1-Signed.apk
```

`ProtoRound=N` sets, together: the application id `au.firesim.proto.rN`, the launcher title `FireSim TEST rN`, the version name `0.1.0-test.rN+<commit>`, the icon tint, and the round
number in the result document. `ProtoCommit` overrides the commit (default: `git rev-parse --short HEAD` at build time). The APK is signed with .NET's own default debug key
(`~/.local/share/Xamarin/Mono for Android/debug.keystore`, SHA-256 of the certificate `94aa0085...4da3`); no key material is printed, passed or committed. The build is arm64 only
(`RuntimeIdentifier` android-arm64; pass `-p:RuntimeIdentifier=android-x64` for an x86_64 emulator).
Release only: a Debug APK's numbers are not phone numbers (plan rule 4), and the document records `build.configuration`.

Check it: `aapt2 dump badging <apk>`, `apksigner verify --print-certs <apk>` (the checks of `../reports/0-apk-check.md`).

### The upload code, the endpoint and the results repository (never committed)

The only value baked into a test APK is the round's **upload code** (plan section 5: a low-value, per-round, revocable code the endpoint limits to three keys). Three build properties, all empty
by default (a build without them has no primary channel: the Done screen says so and keeps *Send with GitHub* and *Share*):

| Property | Meaning |
|---|---|
| `ProtoEndpoint` | https address of the results endpoint (T0.6a). Plain http is accepted only for a loopback address |
| `ProtoUploadCode` | the round's upload code |
| `ProtoGitHubRepo` | `owner/name` of the private results repository, for *Send with GitHub* (the prefilled-issue fallback). Empty: that button says there is none |

Give them with `-p:ProtoEndpoint=https://... -p:ProtoUploadCode=... -p:ProtoGitHubRepo=owner/name` on the command line, **or** as environment variables of the same names, **or** in
`Fs.TestApp/Local.props` (a normal MSBuild file with a `PropertyGroup`; ignored by git through `Fs.TestApp/.gitignore`). They are written into the app as assembly metadata
(`BuildConfig.cs` reads them), i.e. anyone can unzip the APK and read them; that is why the code is low-value. Never put a token, a key or a password in them.

## How the app runs

1. **First screen** (text exactly as in the plan, with the minutes computed from the arm list) and a **10-second countdown** with *Not now* (then a *Start* button).
   `DeviceDisplay.KeepScreenOn` is on until the Done screen.
2. **Gate before each block** (`DeviceGate`): charge above 50 % or charging (the sticky `ACTION_BATTERY_CHANGED` broadcast, no permission), and thermal status back to *none*
   (`PowerManager.CurrentThermalStatus`, API 29+) for at most 5 minutes; a status that will not cool is recorded and the block goes on. Below 50 % and not charging for 10 minutes the run stops (`aborted`).
   Thermal headroom (`GetThermalHeadroom`, API 30+, NaN becomes "absent") and battery are logged every 10 s.
3. **Pauses**: `OnPause`/`OnResume`, screen off, and the page's `visibilitychange` all count. The running arm is cancelled, the block is re-run after the app returns (up to 3 tries),
   and every transition is in `logs.pauses`. Blocks and arms keep one record per attempt; only `ok` blocks are to be used.
4. **Save, then send**: the document is written (temp file, rename, read back) to the app's private storage, then sent with `Idempotency-Key = <apk sha-256>:<run id>`. No network:
   *Turn the network back on to send the results.* and it sends on the connectivity event. Failures retry with back-off.
5. **Done screen**: *Done. Results sent at HH:mm (receipt: issue 17). You can uninstall this test app now.* with **Uninstall** (`ACTION_DELETE` on `package:<id>`, falling back to the App info page;
   the outcome is saved and shown on the next launch). Until a receipt arrives: **Send now**, **Send with GitHub** (prefilled issue address, at most 6 KB after percent-encoding) and **Share**
   (the saved file, through MAUI Essentials' FileProvider whose authority is `${applicationId}.fileProvider`).
6. Opening the app again after a finished run shows the Done screen again; it never runs twice.

Every Android call is guarded: a failure becomes a record in the document's `errors`, not a crash.

## Add an arm

An arm is a class implementing `FsTestApp.Arms.IArm` (`Name`, `EstimatedSeconds`, optionally `Runtime`, and `Task<JsonNode> RunAsync(IProgress<ArmProgress>, CancellationToken)`).
It must be re-entrant, report progress, and stop promptly when the token is cancelled (a pause does that). Warm-up and timed phases are the arm's own; put them in the result.

1. **Native arm** (C# in the app or a library it references): write the class, add it to the plan in `TestPage.cs` (`StubPlan.Build`; round builders replace it with their own `TestPlan`).
   The `Runtime` is `coreclr` by default.
2. **Browser arm** (runs in the WebView, V8): add an async function to `window.fsArms` in `Resources/Raw/wwwroot/arm-host.js`
   (`async (args, ctx) => ({...})`; `ctx.progress(fraction, text)`; check `ctx.cancelled()` at each yield), then list `new WebArm(host, "<name>", <estimated seconds>)` in the plan.
   Extra files the page needs (bundles, `.wasm`) go under `Resources/Raw/wwwroot/` and their paths must be added to the list passed to `new ArmHost(...)`, because the app serves only listed files,
   with the isolation header. Round 0's TypeScript kernels and round 1's `Fs.Wasm` bundles are added that way.
3. **Order**: `BlockPlan.AbBa(a, b, repeats)` gives A B, B A, ...; `BlockPlan.Counterbalanced(arms, blocks)` rotates and reverses for more than two arms. The gate runs before each block.
4. Result: whatever JSON the arm returns is stored in `arms[].result`; the document must stay under 64 KB for the primary send (the sender thins the logs of the sent copy if not), so keep arm results to
   summaries (medians, spreads, checksums), not raw samples.
5. Test the new arm's logic in the container where it has any (a unit test in `../Fs.Tests`), and run `dotnet run --project Fs.TestApp.DryRun` (in `..`) with the arm listed.

## The WebView host and cross-origin isolation

MAUI's `HybridWebView` serves `Resources/Raw/wwwroot` from `https://0.0.0.1/`. MAUI's own asset path sets only `Content-Type`, so `ArmHost` answers requests for the files it was given
(`index.html`, `arm-host.js` by default) from the control's `WebResourceRequested` event (MAUI 11: it runs after the framework's own bridge paths and before asset serving, so `_framework/hybridwebview.js`
and the invoke/message endpoints are untouched) with `Document-Isolation-Policy: isolate-and-require-corp`. The AndroidX WebKit 1.18 allowlist
(`Profile.setCrossOriginIsolatedAllowlist({"https://0.0.0.1"})`, when `WebViewFeature.CROSS_ORIGIN_ISOLATED_ALLOWLIST` is supported) is set from the control's `WebViewInitialized` event,
before the page loads. No NuGet binding of androidx.webkit 1.18 exists (Xamarin.AndroidX.Webkit stops at 1.17.1), so the csproj adds the Google Maven artifact
`androidx.webkit:webkit:1.18.0` as an unbound Java library and `IsolationAllowlist.cs` calls it by Java reflection. The result document says what happened (`webView.crossOriginIsolated`,
`sharedArrayBuffer`, `isolationHeaderSent`, `allowlist.*`, `extra.headerSeenByPage`). **None of this has run on a phone**; round 0 is its first test.

## Tests and the dry run

```bash
source prototypes/dotnet-b/env.sh
dotnet test --project prototypes/dotnet-b/Fs.Tests                      # all tests, including the TestApp ones and the dry-run scenarios
dotnet run  --project prototypes/dotnet-b/Fs.TestApp.DryRun             # the dry run alone, with a printed checklist (add: -- --out DIR to keep the documents)
```
