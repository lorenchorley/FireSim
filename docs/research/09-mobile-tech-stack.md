# 09 — Mobile technology stack for a 3-D, compute-heavy, offline field app (2025–2026)

Status: research note for FireSim (Capacitor + TypeScript + Three.js + Web Workers). Written 2026-09-27.
Scope: framework choice; WebGL2/WebGPU in WKWebView and Android WebView; workers, transferables vs SharedArrayBuffer, WASM;
backgrounding, crashes, thermal/battery; Capacitor plugins and storage; build/test/PWA; field UI/UX; and concrete Three.js
techniques for a scene that is "better than a drape map".
Versions in this repo at time of writing: `@capacitor/*` 8.5.2 (filesystem 8.1.3, geolocation 8.2.2, preferences 8.0.1),
`three` 0.186.1 (r186), Vite 8.3, Vitest 5.0.2, Playwright 1.63, TypeScript 5.9.

## 0. Method and evidence tags

The web-search budget for this session ran out after 4 queries, and most documentation hosts were blocked by the sandbox
(capacitorjs.com, webkit.org, web.dev, MDN, caniuse, chromestatus, playwright.dev, vitest.dev). Most claims were therefore
checked against **primary artefacts that could be read directly**:

- the Capacitor 8.5.2 native sources and plugin READMEs shipped in `node_modules`;
- WebKit `main` sources (preferences YAML, `PlatformEnable.h`, `SecurityOrigin.cpp`, `CrossOriginOpenerPolicy.cpp`,
  `ProcessThrottler.cpp`, `AnimationFrameRate.*`);
- Chromium `main` sources (`android_webview/*`, `runtime_enabled_features.json5`, `gpu_finch_features.cc`);
- MDN browser-compat-data (BCD) JSON, the WebGPU spec source (`gpuweb/spec/index.bs`), and the three.js r186 source and examples;
- Apple developer documentation (JSON API), the App Store Review Guidelines, the Human Interface Guidelines (HIG),
  developer.android.com, and W3C WCAG source.

Tags:

- **[S]**: read in a primary source during this session (a quote or code location is given).
- **[K]**: established knowledge or literature that was not re-read in this session. Verify before relying on it.
- **[D]**: derived here (the arithmetic is shown).
- **[H]**: heuristic or engineering recommendation. Benchmark it on real devices and make it tunable.

> Source-code facts reflect `main` branches in September 2026. Shipping OS builds can lag or differ, so every
> capability must be **feature-detected at runtime**, never inferred from the OS version.

---

## 1. Executive summary: what matters most for FireSim

1. **Keep Capacitor 8 + WebView + Three.js.**
   - On iOS, WKWebView is the only place a third-party app gets a JIT-compiled JavaScript engine plus WebGL2/WebGPU [K].
   - React Native runs in Hermes, which uses AOT bytecode [S: Hermes README]. Its 3-D options are an incomplete WebGL2
     (`expo-gl`) [S] or a young WebGPU binding [S: npm].
   - Flutter's 3-D stack (`flutter_scene` on Flutter GPU) still needs an opt-in flag (`--enable-flutter-gpu`) [S].
   - None of these alternatives would let the TypeScript kernels be tested unchanged in Node and Chromium the way the
     current design does.
2. **Use WebGL2 as the production rendering baseline.**
   - WebGL2 is universal: Safari 15+ and Chrome Android 58+ [S: BCD]. three.js dropped WebGL 1 in r163 [S: `WebGLRenderer.js`].
   - WebGPU is on by default on iOS/iPadOS 26, including in WKWebView. The WebKit pref has no WebKit/WKWebView-specific
     default, and `ENABLE_WEBGPU_BY_DEFAULT` is set for `PLATFORM(IOS)` [S].
   - On Chrome Android, WebGPU needs version 121+ on Android 12+ with ARM/Qualcomm/Intel GPUs [S: gpuweb wiki].
   - **Android WebView support for WebGPU is unconfirmed.** BCD only "mirrors" Chrome Android here [S].
   - So treat WebGPU as an optional accelerator, used after `navigator.gpu.requestAdapter()` succeeds.
3. **Do not design around SharedArrayBuffer (SAB).**
   - BCD lists SAB and WASM threads as unsupported in Android WebView [S].
   - Chromium's new opt-in (`Profile#setCrossOriginIsolatedAllowlist` + `Document-Isolation-Policy`) first appeared in
     androidx.webkit **1.18.0-alpha01 (9 Sep 2026)** [S].
   - On iOS, WebKit would honour COOP/COEP on `capacitor://localhost` because scheme-handler origins count as
     "potentially trustworthy" [S]. But Capacitor never sends those headers, and its `loadView()` is `final` [S].
   - **Use transferable ArrayBuffers with a buffer pool.** SAB is a progressive enhancement.
4. **Mobile OSes will stop the simulation when the app is backgrounded, so checkpointing is mandatory.**
   - iOS gives `applicationDidEnterBackground` 5 s [S]. WebKit then asks the WebContent process to suspend, with a 20 s
     timeout [S: `ProcessThrottler.cpp`].
   - If the WebContent process is killed (for example by memory pressure), Capacitor iOS simply calls `webView.reload()` [S],
     so all in-memory state is lost.
   - On Android, an unhandled `onRenderProcessGone` crashes or kills the app [S].
   - Checkpoint the simulation every few simulated minutes and on the `pause` event.
5. **Thermal and power state are invisible to web code; add a ~50-line native plugin.**
   - iOS exposes `ProcessInfo.thermalState` (nominal/fair/serious/critical, each with Apple guidance) and Low Power Mode [S].
   - Android exposes `PowerManager.getCurrentThermalStatus()` and a listener (API 29), `getThermalHeadroom()` (API 30) and
     `isPowerSaveMode()` [S].
   - WebKit itself halves `requestAnimationFrame` from 60 to 30 fps under Low Power Mode or thermal mitigation [S].
6. **Store area packs as native files, not as IndexedDB blobs.**
   - Capacitor's own guide warns that iOS may reclaim IndexedDB [S].
   - WebKit caps embedded-WebView origins at about 15 % of disk (20 % overall) [S: MDN].
   - Lockdown Mode disables IndexedDB, WebGL and WebGPU entirely [S: WebKit prefs].
   - Read files back with `Capacitor.convertFileSrc()` + `fetch()`, which returns binary directly with no base64 bridge.
7. **CapacitorHttp patches only `window.fetch`/XHR on the main thread** [S: `native-bridge.js`]. Web Workers do not get the
   CORS bypass, so do network I/O on the main thread (or natively) and transfer the bytes to workers.
8. **"Better than a drape map" means data-driven shading plus true 3-D objects:**
   - a displaced terrain mesh with per-pixel DEM normals and triplanar texturing on cliffs;
   - analytic overlays computed in the fragment shader (slope, aspect vs wind, fuel strata, isochrones, the burning band);
   - instanced vegetation whose height and strata come from data;
   - flames as instanced billboards along the extracted front;
   - GPU wind-particle streaks, an optional raymarched plume volume, and additively blended embers.
   - Every one of these reads from a small data texture updated per snapshot, so no geometry is rebuilt.
9. **Performance cost scales as (L/Δx)³ for the atmosphere** [D]. Halving Δx costs 8×. Hold the phone atmosphere grid at
   about 50–60 k cells (the architecture's 48×48×24) and spend extra budget on the fire grid and rendering instead.
10. **Field UX**:
    - Primary controls at least 64 pt [H] (platform floors are 44 pt on iOS and 48 dp on Android [S]).
    - Text contrast 7:1 [S: HIG "strive for"], because sunlight mutes colours [S: HIG].
    - No gesture-only functions [S: HIG]; one-thumb bottom-sheet layout; a crosshair "mark fire here" instead of precise taps.
    - Insight cards that never auto-dismiss [S: HIG].
    - Data freshness badges for offline use.

---

## 2. Framework choice (2025–2026)

### 2.1 Comparison

| Criterion | **Capacitor 8** (chosen) | **React Native 0.87 + expo-gl / react-native-wgpu** | **Flutter + flutter_scene** |
|---|---|---|---|
| JS/compute engine | WKWebView JavaScriptCore with JIT; Android WebView V8 with JIT [K] | Hermes: "ahead-of-time static optimization and compact bytecode" [S]; no third-party JIT on iOS [K] | Dart AOT native code and isolates (good for numeric kernels) [K] |
| 3-D API | Full WebGL2; WebGPU on iOS 26 and Chrome-based Android where available [S] | expo-gl is "a WebGL2 subset": fences/sync, `getBufferSubData`, compressed 3-D textures and `renderbufferStorageMultisample` are unimplemented; no argument checking, so bad arguments "may cause a native crash" [S]. react-native-wgpu 0.5.17 (Dawn, RN ≥ 0.81) [S: npm] | flutter_scene 0.23 (Aug 2026), which requires the `--enable-flutter-gpu` flag on every native platform [S]; no Three.js ecosystem |
| Three.js | Native, all addons | Via expo-three/WebGPU; Three.js cannot run inside worklets [S: Expo docs] | No |
| Workers | Standard module workers [S] | Worklets/JSI; not Web Workers | Isolates |
| Same code in Node/Chromium tests | Yes | Partly | No (Dart) |
| PWA fallback | Same bundle | Separate (RN-web) | Flutter web (WebGL2 backend) [S] |

**Recommendation [H]:**

- Stay on Capacitor.
- Revisit a native (Swift/Kotlin or C++) solver only if device benchmarks show that the TypeScript/WASM atmosphere
  cannot meet the 1–2 min budget.
- Keep the solver behind the existing `Simulation`/`SimClient` contract (ARCHITECTURE.md), so it can be swapped for a
  WASM or native module without touching the UI.

### 2.2 Capacitor 8 platform facts [S: capacitor-docs `updating/8-0.md`; Capacitor sources]

- **Tooling and minimums:**
  - iOS deployment target 15.0; Xcode 26.0+; Swift Package Manager is the default for new iOS projects.
  - Android: `minSdkVersion 24`, `compileSdk/targetSdk 36`; Android Studio Otter 2025.2.1+; `androidxWebkitVersion 1.14.0`.
  - Node 22+.
- **Edge-to-edge:** `android.adjustMarginsForEdgeToEdge` was removed in favour of the SystemBars core plugin and CSS
  `env(safe-area-inset-*)`. Android 15 enforces edge-to-edge for apps targeting it [S: Android 15 behaviour changes].
  Every overlay must honour safe-area insets.
- **Origins:** the app is served from `https://localhost` on Android (`androidScheme` default `https`) and from
  `capacitor://localhost` on iOS. Changing Android to a non-http(s) scheme breaks routing since WebView 117 [S: config reference].
- **WebView version:** `android.minWebViewVersion` defaults to 60 (the minimum allowed is 55) [S: `Bridge.java`].
  For FireSim, raise it to ≥ 91 [H] so module workers (Chrome 80), WASM SIMD (91) and WebGL2-in-OffscreenCanvas (69)
  are guaranteed [S: BCD].
- **WASM MIME types:** both local servers serve `.wasm` as `application/wasm` (`WebViewLocalServer.getMimeType`, iOS
  `mimeTypes["wasm"]`) [S], so `WebAssembly.instantiateStreaming` works.

### 2.3 Store constraints that shape the design

- **Apple 2.4.2:** apps "should not rapidly drain battery, generate excessive heat, or put unnecessary strain on device
  resources" [S]. So duty-cycle the solver and throttle when hot.
- **Apple 2.5.9:** apps may not "alter or disable the functions of standard switches, such as the Volume Up/Down" [S].
  Hardware-button shortcuts for gloved use are therefore not an option on iOS.
- **Apple 4.2:** apps must be "beyond a repackaged website" [S]. Offline packs, GPS, native HTTP and thermal adaptation satisfy this.
- **Google Play:** apps targeting Android 14+ must declare foreground-service types in Play Console [S]. `specialUse`
  justifications are reviewed [S].

---

## 3. Graphics in mobile WebViews

### 3.1 WebGL2 baseline and extension gotchas

| Feature | Safari/iOS | Chrome/Android WebView | FireSim consequence |
|---|---|---|---|
| WebGL2 | 15 | 58 | Baseline [S: BCD] |
| `EXT_color_buffer_float` (render to float) | 15 | 56 | GPU particle ping-pong is OK [S] |
| `EXT_color_buffer_half_float` | 14 | 63 | Preferred [S] |
| `OES_texture_float_linear` | 8, "**Only supported on iPadOS**" | 29 | **iPhones cannot linearly filter float32 textures.** Store volumes and velocity fields as `HalfFloatType` (RGBA16F), or filter manually [S] |
| `WEBGL_multi_draw` | 15 | 86 | three.js `BatchedMesh` uses it [S: `WebGLIndexedBufferRenderer.js`] |
| `EXT_disjoint_timer_query_webgl2` | No | No on Chrome Android | No GPU timers on device; measure frame times on the CPU [S] |
| ASTC / ETC2 compressed textures | 12 / 13.1 | 47 / 63 | Use KTX2 + Basis transcoding (`KTX2Loader`) [S/K] |
| `KHR_parallel_shader_compile` | 14.1 | 76 | Compile shaders asynchronously to avoid startup hitches (`renderer.compileAsync`) [S/K] |
| OffscreenCanvas WebGL2 in a worker | 17 | 69 | A render worker is possible but not needed (§4.6) [S] |

### 3.2 WebGPU status

- **iOS/iPadOS 26:**
  - "In macOS Tahoe 26, iOS 26, iPadOS 26, and visionOS 26, WebGPU is supported and enabled by default" [S: gpuweb wiki].
  - In WebKit, `WebGPUEnabled.defaultValue = ENABLE(WEBGPU_BY_DEFAULT)`, with no separate `WebKit:` (WKWebView) default.
    `PlatformEnable.h` defines `ENABLE_WEBGPU_BY_DEFAULT 1` for `PLATFORM(IOS)` [S]. **Inference:** Capacitor iOS apps on
    iOS 26 get `navigator.gpu`. Confirm on device.
  - WebGPU is also exposed in workers (`WorkerNavigator.gpu`, Safari 26) [S: BCD].
- **Lockdown Mode (iOS):** `WebGLEnabled`, `WebGPUEnabled`, `IndexedDBAPIEnabled` and `FileSystemEnabled` all carry
  `disableInLockdownMode: true` [S]. Detect "no WebGL" and show a message to add a Lockdown Mode exclusion for the app
  (the exact Settings path is not verified here [K]).
- **Chrome Android:** WebGPU 121+ on ARM/Qualcomm/Intel with Android 12+. Imagination GPUs need Android 16+ (139).
  Samsung Xclipse is "probably 154" (in progress) [S: gpuweb wiki]. `kAAPMBlocksWebGPU` blocks WebGPU under Android
  Advanced Protection Mode [S: `gpu_finch_features.cc`].
- **Android WebView:** BCD marks `GPU` as a "mirror" of Chrome Android, which is auto-derived and not verified. No
  WebView-specific disable was found in `aw_field_trials.cc` [S]. **Status is unverified. Detect at runtime.**
- **Spec default limits** [S: WebGPU spec]:
  - `maxTextureDimension3D` 2048;
  - `maxStorageBufferBindingSize` 128 MiB;
  - `maxBufferSize` 256 MiB;
  - `maxComputeInvocationsPerWorkgroup` 256 (128 in compatibility mode);
  - `maxComputeWorkgroupStorageSize` 16 384 B;
  - `maxStorageBuffersPerShaderStage` 8.
  - Float32 textures are only filterable with the optional `float32-filterable` feature, so use `rgba16float` for anything sampled.

### 3.3 Renderer recommendation [H]

- **v1: `WebGLRenderer`** (mature; all addons work, e.g. `@three.ez/instanced-mesh`, `three-mesh-bvh`, CSM). Write custom
  shaders in GLSL ES 3.00.
- **Keep the render module independent** of these choices so a `WebGPURenderer` + TSL path can be added later.
  r186's `WebGPURenderer` automatically falls back to a WebGL2 backend ("WebGPU is not available, running under WebGL2
  backend") and has `forceWebGL` [S]. Its `outputBufferType` defaults to `HalfFloatType`. On phones, consider
  `UnsignedByteType` to save bandwidth [S].
- **WebGPU compute for the atmosphere** (v2) is the bigger win. r186's `webgpu_volume_fire` example runs a
  100×100×200 = 2 M-cell stable-fluids solver on the GPU, with 2 Jacobi iterations and a 16-step `VolumeNodeMaterial` [S].
  That is about 35× FireSim's atmosphere cell count, but it is a visual effect, not a validated solver.

### 3.4 Frame pacing

- WebKit throttles `requestAnimationFrame` to 30 fps when `LowPowerMode` or `ThermalMitigation` throttling reasons are
  active (`HalfSpeedThrottlingFramesPerSecond = 30`) [S: `AnimationFrameRate.h/.cpp`].
- Design every animation to be time-based, not frame-based.
- Render on demand: redraw only when the camera moves, a snapshot arrives, or an animation is playing [K: three.js
  "rendering on demand"].
- Cap playback at 30 fps and interaction at 60 fps [H].

---

## 4. Compute: workers, memory sharing, WASM

### 4.1 Workers under Vite + Capacitor

- **Creating workers:** use `new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' })`. Vite detects a
  worker "only … if the `new URL()` constructor is used directly inside the `new Worker()` declaration" and requires static
  option literals [S: Vite docs]. The repo already sets `worker.format: 'es'` and `base: './'`.
- **Browser support:** module workers need Safari 15 (nested workers 15.5, script loading in nested workers 16.4) and Chrome 80 [S: BCD].
- **Core counts:** Safari clamps `navigator.hardwareConcurrency` to **4 or 8** "to prevent device fingerprinting" [S: BCD],
  and `navigator.deviceMemory` does not exist in Safari [S]. Use `Device.getInfo()` (`model`, `memUsed`, `webViewVersion`) [S]
  plus a first-run micro-benchmark to pick a quality tier.

### 4.2 Transferables vs SharedArrayBuffer

| Platform | `crossOriginIsolated` / SAB | Evidence |
|---|---|---|
| Android WebView | SAB `false` in BCD; WASM threads `false` in BCD. "Android WebView exposes SharedArrayBuffer but is never cross-origin isolated (COOP/COEP have no effect)" (Chromium issue 40914606, search snippet only) | [S: BCD]; [K: issue not readable] |
| Android WebView (new) | `AwBrowserContext.setCrossOriginIsolatedAllowList()` → `OriginSupportsConcreteCrossOriginIsolation()`. The error text says: "consider allowing your origin with `Profile#setCrossOriginIsolatedAllowlist()`, and add the Document-Isolation-Policy header". Shipped in androidx.webkit **1.18.0-alpha01** (9 Sep 2026). A 25 Sep 2026 open-source app still found DIP "unsupported by Android WebView" | [S: Chromium `AwContents.java`, `aw_browser_context.cc`; Android release notes; cmer81/maps PR #128] |
| iOS WKWebView | Scheme-handler schemes are potentially trustworthy (`schemeIsHandledBySchemeHandler` → true). COOP is parsed only for trustworthy origins, and `same-origin` + COEP `require-corp` → `SameOriginPlusCOEP`. Capacitor's `WebViewAssetHandler` sends only `Content-Type`/`Cache-Control` (plus CORS for live reload), and `CAPBridgeViewController.loadView()` is `final` with a `private prepareWebView`. **Enabling isolation needs a patch to `@capacitor/ios`**; unverified on device (Capacitor issue #6182) | [S: `SecurityOrigin.cpp` L90–105, `CrossOriginOpenerPolicy.cpp` L212–247, Capacitor iOS sources] |

**Design [H]:**

1. **Worker ownership.** The worker owns all simulation state. It sends a `SimSnapshot` by `postMessage(msg, [buffers])`.
   Transfer moves ownership with zero copy [K]. Keep a **pool of 2–3 buffers per field**; the main thread returns each
   buffer after `texSubImage` upload, so the steady state allocates nothing.
2. **Commands to the worker** (`ignite`, `edit`, `pause`) are tiny structured clones.
   - `advance()` must yield about every 20–50 ms of wall time so messages are delivered, e.g. with `await` on a
     `MessageChannel` ping. Otherwise a pause request waits for the whole run.
   - If `crossOriginIsolated` is true, a 4-byte SAB control word with `Atomics.load` gives instant pause.
3. **Snapshot sizes [D]:**
   - Fire arrival time T_a, 200×200 Float32 → 160 kB. At 20 m over 10 km (500×500) → 1.0 MB.
   - Atmosphere view, 48×48×24 × 4 channels × 2 B (half float) → 0.44 MB.
   - 4 000 embers × 7 floats × 4 B → 112 kB.
   - At one snapshot per 5 simulated minutes (72 per 6 h), total traffic is under 150 MB even at the larger grid.

### 4.3 WASM

- **Fixed-width SIMD:** Safari 16.4, Chrome 91 [S: BCD]. **Relaxed SIMD:** not in Safari ("preview") [S].
  **Threads/atomics:** need SAB, so they are unavailable in Android WebView [S].
- **Guidance [H]:**
  - Start in TypeScript on `Float32Array`s: it is testable and the engines JIT it well.
  - Port only the measured hot loop to WASM SIMD (Rust `+simd128`, or AssemblyScript). The pressure/Poisson solve is
    typically the hot loop [K].
  - Expect at most about 4× on float32 SIMD lanes, and less in practice due to memory bandwidth [K]. Benchmark it.

### 4.4 Budget arithmetic [D]

**Work** W = N_x·N_y·N_z · N_steps · c, where c = seconds per cell-update.

**Steps and timestep:**

- N_steps = T_sim/Δt, with Δt ≤ C·Δx/U_max (advective CFL; C ≈ 1).
- Semi-Lagrangian advection removes the stability limit but not the accuracy limit [K].
- At Δx = 150 m and U_max = 15 m/s, Δt ≈ 10 s, so N_steps = 21 600 s / 10 s = 2 160 for 6 h.

**Architecture budget check:** the architecture budget is 10–25 ms per step for 48×48×24 = 55 296 cells, i.e. 22–54 s for 6 h.
This implies c ≈ 0.18–0.45 µs per cell-update including the pressure solve. That is plausible for JIT-compiled typed-array
code on a 2023+ phone core, but it must be benchmarked.

**Scaling law:** with N_z fixed, W ∝ (L/Δx)²·(1/Δx) = L²/Δx³. Going from 150 m to 100 m costs (1.5)³ ≈ 3.4×, i.e. 75–180 s.
That breaks the 1–2 min budget on the CPU. **Keep ≤ 60 k atmosphere cells on the CPU tier.** Offer 100 m only on a
WebGPU tier after benchmarking.

**Fire grid:** the level-set cost is ∝ cells × sub-steps, with Δt_f ≤ 0.5·Δx/ROS_max.

- At Δx = 20 m and ROS_max = 3 m/s (about 11 km/h, extreme forest), Δt_f ≤ 3.3 s.
- 250 k cells × 6 500 sub-steps ≈ 1.6×10⁹ updates over 6 h.
- Recommend a narrow-band update (only cells within a few cells of the front) and adaptive Δt from the current ROS_max [H/K].

### 4.5 Worker topology [H]

- **Worker A, "sim":** atmosphere, fire, embers and moisture, coupled as in ARCHITECTURE.md. Coupling fields stay in one
  heap, which avoids halo exchange across `postMessage`. That exchange is prohibitive without SAB.
- **Worker B, "prep"** (short-lived): DEM decode (`geotiff`/`fast-png`), slope/aspect/TPI, Poisson-disk tree placement,
  and marching-squares contours for rendering.
- **Main thread:** UI, Three.js, network (CapacitorHttp).
- **Optional Worker C, "gpu-compute":** once WebGPU is detected, run the atmosphere on `WorkerNavigator.gpu`. The same
  interface returns the same `AtmosphereView`.
- **Determinism:** ECMAScript leaves `Math.exp`, `Math.pow` and similar "implementation-approximated" [K], so V8 and JSC
  can differ in the last bits. Unit tests must use tolerances, and golden files should be per-engine or rounded.

---

## 5. Lifecycle: backgrounding, crashes, thermal, battery

### 5.1 iOS

- **Background time:** `applicationDidEnterBackground` "has five seconds to perform any tasks and return. Shortly after …
  the system puts your app into the suspended state". `beginBackgroundTask` adds limited extra time
  (`backgroundTimeRemaining`) [S: Apple].
- **WebKit suspension:** WebKit sends the WebContent process "PrepareToSuspend" and allows `processSuspensionTimeout = 20 s`
  before dropping its assertion [S: `ProcessThrottler.cpp`]. After that, JavaScript and workers stop.
- **iOS 26 `BGContinuedProcessingTask`:** must start "in response to someone's action, such as tapping a button". It shows a
  Live Activity with progress, the user can cancel it, and the system "prioritizes the termination of tasks that reflect
  minimal … progress". GPU access in the background needs the `com.apple.developer.background-tasks.continued-processing.gpu`
  entitlement and device support [S]. **Unknown:** whether WKWebView JavaScript keeps running under such a task. This is
  documented for native work, so assume it does not.
- **WebContent termination:** if the WebContent process dies, Capacitor's `webViewWebContentProcessDidTerminate` runs
  `bridge?.reset(); webView.reload()` [S]. The app restarts from scratch, so restore from the last checkpoint and offer
  "Resume scenario?".

### 5.2 Android

- **Timers:** Capacitor's `KeepRunning` preference defaults to `true`, so WebView JS timers are *not* paused on `onPause` [S: `Bridge.java`].
  But the OS may still freeze or kill a backgrounded process [K].
- **Foreground-service options:**

  | Type | Limit |
  |---|---|
  | `shortService` | About 3 min [S] |
  | `dataSync` and `mediaProcessing` | 6 h per 24 h for apps targeting Android 15, shared across services of that type; reset when the user foregrounds the app; `onTimeout()` → `stopSelf()` within seconds, or a `RemoteServiceException` [S] |
  | `specialUse` | Play review of the declared subtype [S] |

  A notification-backed FGS can keep the WebView's worker alive for a user-started "finish this 6-h run". Whether the
  WebView renderer keeps its priority under an FGS is not verified [K]. **Treat it as optional.**
- **`onRenderProcessGone`:** returns "true if the host application handled the situation … otherwise, application will
  crash if render process crashed, or be killed if render process was killed by the system" [S]. Capacitor forwards it to
  `WebViewListener`s [S]. **Register a listener** that destroys and recreates the WebView, then restores the checkpoint.
- **`@capacitor/background-runner`:** not a WebView ("DOM APIs" unavailable). It has about 30 s per invocation on iOS, a
  10-min maximum on Android, and a ≥ 15-min repeat interval [S]. It is useful for prefetching forecasts, not for the solver.

### 5.3 Thermal, power, battery

- **Web APIs are unavailable:** `PressureObserver` is not on Chrome Android or Safari, and `BatteryManager` is not in Safari [S: BCD].
- **Native signals:**
  - iOS `ProcessInfo.thermalState`:
    - `.fair` → "reduce or defer background work";
    - `.serious` → "reduce CPU and GPU usage by stopping or deferring work" and "reduce the requested level of accuracy for location";
    - `.critical` → reduce to "the minimum level required for user interaction" [S].
  - `isLowPowerModeEnabled` means the system is "reducing CPU and GPU performance" [S].
  - Android: `getCurrentThermalStatus()`/`addThermalStatusListener()` (API 29), with `THERMAL_STATUS_NONE…SHUTDOWN` = 0–6.
    `getThermalHeadroom(forecastSeconds)` (API 30): calling it "more frequently than about once per second" may return `NaN` [S].
  - `isPowerSaveMode()` (API 21) [S].
  - `Device.getBatteryInfo()` → `batteryLevel` (0–1), `isCharging` [S].
- **Policy [H]:**

| Signal | Render | Sim worker | GPS |
|---|---|---|---|
| Nominal, or charging | DPR ≤ 2, 60/30 fps, plume volume on | Full speed | `watchPosition` 5 s |
| iOS `.fair` / Android LIGHT(1) / headroom > 0.7 | DPR 1.5, no volume, 30 fps | Full | 10 s |
| `.serious` / MODERATE–SEVERE(2–3) / Low Power / battery < 20 % | DPR 1.25, particles ÷ 2, shadows off, render on demand only | Yield 30 % duty cycle | 30 s, coarse |
| `.critical` / CRITICAL+(≥ 4) | Static frame; UI only | Pause and checkpoint; tell the user why | Off |

Also track the simulation's own seconds-per-step. A sustained rise of more than 30 % against the first-minute baseline
means throttling, even when no OS signal has fired [H].

---

## 6. Data, storage, networking, location

### 6.1 CapacitorHttp in detail [S: `@capacitor/core` 8.5.2 `native-bridge.js`, `http.md`]

- It is enabled by `plugins.CapacitorHttp.enabled` (already set in `capacitor.config.ts`) and patches `window.fetch` and
  `window.XMLHttpRequest`. **Workers are not patched.**
- **Request routing:**
  - GET/HEAD/OPTIONS/TRACE are rewritten to `${serverUrl}/_capacitor_http_interceptor_?u=<url>`, fetched natively, and
    streamed back through the local server, so binary bodies are fine.
  - Other methods go through the JSON bridge.
  - Requests to the app's own origin bypass the patch.
- **Downloads:** "parsing and transferring large amount of data from native to the web can cause issues". Use
  `@capacitor/file-transfer` for large downloads, directly to disk [S].
- **Worker trick [H]:** a worker could fetch the same-origin interceptor URL itself. This is **undocumented internal API**
  and may change, so don't rely on it.

### 6.2 Storage options

| Store | Capacity and persistence | Use in FireSim |
|---|---|---|
| `@capacitor/preferences` | UserDefaults / SharedPreferences. "Not meant to be used as a local database" [S] | Settings, last location, UI state |
| IndexedDB | WebKit: embedded apps about 15 % of disk per origin and 20 % overall. Chromium: 60 % per origin. Safari proactive 7-day eviction applies to Safari's tracking prevention [S: MDN]. Capacitor: "IndexedDB at least on iOS" must be considered transient [S] | Cache index, small scenario JSON, checkpoints (duplicated to a file) |
| OPFS (`navigator.storage.getDirectory`, `FileSystemSyncAccessHandle` in workers) | Safari 15.2, Chrome Android 109 [S]; same eviction class as IndexedDB; disabled in Lockdown Mode [S] | Fast checkpoint writes from the worker (optional) |
| `@capacitor/filesystem` | `LibraryNoCloud` = iOS Library without iCloud backup; `Data` = app files on Android; `Cache` "can be deleted in cases of low memory" [S] | **Area packs** (DEM, canopy, fuel, fire history, weather), checkpoints |
| `@capacitor-community/sqlite` 8.1.1 | Native SQLite; uses SQLCipher "even for unencrypted databases", which may trigger US encryption export reporting [S] | Optional observation log / pack index; a simple JSON manifest is enough for v1 |

- **Reading packs [H]:** `const url = Capacitor.convertFileSrc((await Filesystem.getUri({path, directory: Directory.LibraryNoCloud})).uri); const buf = await (await fetch(url)).arrayBuffer();`.
  This serves the file through `/_capacitor_file_` [S] with no base64, and a worker can do the same fetch because the URL
  is same-origin.
- **Writing** through `Filesystem.writeFile` is base64 over the bridge [S], which is fine for MB-scale checkpoints. Use
  `FileTransfer.downloadFile` for pack downloads.
- **Call `navigator.storage.persist()`** anyway (Safari 15.2+, Chrome 55+) [S]. It is harmless.

### 6.3 Location

- `@capacitor/geolocation` 8.2.2: `enableHighAccuracy` (default `false`; ignored on Android 12+ if only coarse location was
  granted); `timeout` 10 000 ms by default; `maximumAge` 0.
- Android-only options: `interval`/`minimumUpdateInterval` (5 000 ms), and `enableLocationFallback` (default `true`, uses
  `LocationManager`/GPS-only in airplane mode, "may take longer … you may need to provide a higher timeout") [S].
- iOS needs both `NSLocationWhenInUseUsageDescription` and `NSLocationAlwaysAndWhenInUseUsageDescription` strings [S].
- **In the mountains:**
  - Use `coords.accuracy` to draw an uncertainty circle.
  - Take elevation from the DEM, not from `coords.altitude` (GPS vertical error is typically worse than horizontal [K]).
  - Use `timeout ≥ 30 s` in gorges with poor sky view [H].

### 6.4 Low connectivity [H]

- **Offline-first:** a scenario must build entirely from an area pack or the bundled demo sites.
- **Pack download:** download "area packs" on Wi-Fi before deployment. For example, 10×10 km of DEM at 5 m in Int16 is
  2 001² × 2 B ≈ 8 MB raw [D]; the 30 m SRTM equivalent is ~0.2 MB.
- **Freshness:** every layer carries a `fetchedAt`, and the UI shows badges like "Weather: forecast issued 06:00, 7 h old".
- **Manual entry:** belt-weather-kit entry (T, RH, wind speed and direction, time) is always available and overrides the forecast.
- **Connectivity events:** `Network.getStatus()` / `networkStatusChange` (`connectionType: 'none'`) [S] drive retries.
  Never block the UI on the network.

---

## 7. Build, test, ship

### 7.1 Build [S/K]

- `npm run build` (tsc + Vite 8) → `dist/` → `npx cap sync`.
- iOS: SPM project; set `ios.webContentsDebuggingEnabled` for dev builds (maps to WKWebView `isInspectable`).
- Android: `minWebViewVersion`, a WebViewListener for render-process crashes, and an FGS declaration if used.
- Live reload: `server.url` (dev only; "not intended for use in production" [S]).
- Ship the WASM kernels and data as assets. `webDir` content is served with correct MIME types [S].

### 7.2 Test pyramid

| Layer | Tool | Notes |
|---|---|---|
| Numerical kernels | Vitest (`environment: 'node'`) | Already configured. Deterministic seeded RNG (`src/core/rng.ts`) |
| Worker protocol, WebGL shaders | Vitest browser mode with `@vitest/browser-playwright` [S] | Real Chromium and WebKit engines; the `preview` provider "relies on simulating events", so use playwright in CI [S] |
| App e2e | Playwright 1.63, Pixel 7 profile, SwiftShader WebGL (existing config) | Add a WebKit project for iOS-like JS/CSS behaviour. It is not a true WKWebView (different GPU path) [K] |
| On-device Android WebView | Playwright `_android` (**experimental**): "This includes Chrome for Android and Android WebView". Needs ADB and Chrome 87+; "not everything works" [S] | Nightly perf test: run a 6-h scenario and record wall time, fps and thermal status |
| On-device iOS | Safari Web Inspector (inspectable WKWebView) + XCUITest/Appium [K] | Manual perf runs on the oldest supported iPhone |

### 7.3 PWA fallback [S/K]

- Build it with `vite-plugin-pwa` 1.3.0 [S: npm]. The same bundle serves as a PWA.
- **Limits** compared with the native app:
  - no CapacitorHttp, so CORS-less services need a proxy;
  - no background execution or native thermal signal;
  - storage: a Home-Screen web app gets the browser-app quota (about 60 % of disk) [S: MDN];
  - Screen Wake Lock on iOS is full only from 18.4, and "does not work in standalone Home Screen Web Apps" before that [S: BCD];
  - WebGPU works in Safari 26 [S].
- The native app should use `@capacitor-community/keep-awake` [S] during a run.

---

## 8. Rendering "better than a drape map": concrete Three.js techniques

A drape map pastes imagery onto a heightfield. Cliffs smear, fuel is invisible, and nothing explains the fire.
FireSim's scene should instead be **data-driven**: every pixel knows its slope, aspect, fuel strata, moisture and
arrival time.

### 8.1 Budget (heuristics for a 2022+ mid-range phone) [H]

| Item | Target |
|---|---|
| Draw calls | ≤ 100–150 |
| Visible triangles | ≤ 1–1.5 M |
| Device pixel ratio | cap 1.5–2 |
| Shadows | 1 directional light, 2048² map, 2 cascades (high tier) or baked hillshade (low tier) |
| Transparent overdraw | Smoke and embers at half resolution where possible |
| Frame rate | 30 fps playback, 60 fps interaction, on demand otherwise |

**Pixel arithmetic [D]:** a 393×852-pt iPhone at DPR 3 renders 1179×2556 = 3.0 MP. DPR 2 gives 1.34 MP (−56 %) and
DPR 1.5 gives 0.75 MP (−75 %). Fragment-heavy effects (raymarching, soft particles) scale with this number.

Mobile GPUs are tile-based. Avoid extra full-screen passes. MSAA via `antialias: true` is relatively cheap on tilers [K],
while post-process chains are expensive.

### 8.2 Terrain

**Mesh:**

- Chunks of 129² or 257² vertices with skirts, and LOD by screen-space error:
  - CDLOD (Strugar 2009) [K];
  - or fixed-error RTIN meshes via MARTINI, "(2^k+1)×(2^k+1) grid … hierarchy of triangular meshes … in milliseconds"
    (`tile.getMesh(maxErrorMetres)`) [S].
- **Size [D]:** a full 10 km × 10 km mesh at 10 m is 1 001² ≈ 1.0 M vertices and 2.0 M triangles, about 56 MB with
  position, normal, uv and 32-bit indices. Instead:
  - render the mesh at 20–30 m or with RTIN error ≈ 1–2 m;
  - carry the fine DEM detail in a **normal map** (below).

**Normals** from the finest DEM, by central differences [K/Horn 1981]:

```
∂z/∂x ≈ (z_{i+1,j} − z_{i−1,j}) / (2Δx)
∂z/∂y ≈ (z_{i,j+1} − z_{i,j−1}) / (2Δy)
n = normalize(−∂z/∂x, −∂z/∂y, 1)
```

Store them as an RG8 or RGBA8 normal texture. Lighting then shows gullies finer than the mesh.

**Triplanar texturing on steep faces** (sandstone cliffs of the Blue Mountains, Budawangs and Warrumbungles) [K]:

```
w_k = |n_k|^m / Σ_j |n_j|^m     (m ≈ 4)
```

This blends the XZ, YZ and XY projections, so escarpments show rock strata instead of stretched pixels.

**Shader overlays:** layers are uniforms and textures in one terrain material, so toggling them costs nothing.

- Slope classes, e.g. < 10°, 10–20°, **> 20° "beyond validated model"** (see 01-terrain-fire-behaviour.md).
- Aspect-vs-wind alignment.
- Fuel hazard per stratum, time since fire, dead fuel moisture, and arrival-time isochrones.
- **Contours** with constant pixel width, using WebGL2 derivatives [K]:

  ```
  f = fract(z/Δz_c)
  line = 1 − smoothstep(0, k·fwidth(z/Δz_c), min(f, 1−f))
  ```

- **Hillshade** as the existing `src/terrain/hillshade.ts` does (multi-directional; Lambertian `n̂·ŝ`). Use it as baked
  ambient on the low tier, and use real sun position (`terrain/solar.ts`) on the high tier.

**Vertical exaggeration:** 1× by default, with an optional 1.5–2× that is always labelled [H]. Exaggeration visually
steepens slopes and could mis-teach the slope effect.

### 8.3 Vegetation and fuel strata

The strata follow the Overall Fuel Hazard Guide: surface, near-surface, elevated, bark and canopy (Hines et al. 2010) [K].

- **Placement.** Place trees by seeded Poisson-disk sampling in the prep worker. Density follows canopy cover and height
  follows the canopy-height raster. Visual stems are representative, not a census: 1 crown per ~15–25 m [H].
- **Instancing and LOD.**
  - Use one `InstancedMesh` per species group × LOD, in spatial tiles about 500 m square. Core `InstancedMesh` culls only
    as a whole via its bounding sphere [S: `InstancedMesh.js`], so tiling is needed.
  - Alternatives:
    - `BatchedMesh`, with `perObjectFrustumCulled`, `sortObjects`, `setVisibleAt`, `addInstance` and multi-draw [S];
    - `@three.ez/instanced-mesh` (InstancedMesh2): per-instance culling, dynamic BVH, LOD and shadow LOD [S].
      Its README does not claim `WebGPURenderer` support.
  - r186's `webgl_batch_lod_bvh` example shows 5 LODs via meshoptimizer, BVH culling and a radix sort, using
    `@three.ez/batched-mesh-extensions` [S].
  - LOD bands [H]: near (< 300 m) a 200–600-triangle eucalypt with open, clumped crowns and a visible trunk; mid
    (300–1 500 m) crossed quads or impostors; far: canopy tint in the terrain shader.
  - Memory: 64 B per instance matrix, so 50 k instances ≈ 3.2 MB [D].
- **Per-instance state attribute** (`InstancedBufferAttribute`, Uint8), updated per snapshot: unburnt, scorched crown,
  crown fire, burnt trunk only. The shader selects colour and emissive flicker, so no meshes are rebuilt.
- **Elevated and near-surface fuel.** Draw instanced shrub clumps (2–20 tris) whose density comes from the elevated-fuel
  hazard score. Grass tufts follow the near-surface score.
- **Surface litter.** Litter is a terrain-shader layer:
  - procedural leaf and twig noise whose coverage ∝ litter load (t/ha);
  - darkening ∝ fuel moisture (wet litter looks darker), which gives a visible cue for the moisture model.
- **Bark hazard.** Show stringybark as a fibrous trunk texture variant plus an optional "ember source" glyph.
- **Edits are visible instantly.** Brushing "more litter" or "developed understorey" changes the fuel texture, and the
  shader and instance density respond in the same frame.

### 8.4 Fire front, flames, isochrones

The arrival-time texture T_a(x,y) (R32F or R16F; seconds since start, +∞ if unburnt) is the single source of truth.

- **Burning band in the terrain shader.**
  - Flaming if 0 ≤ t − T_a ≤ τ_r.
  - Glowing or smouldering if τ_r < t − T_a ≤ τ_s.
  - Otherwise burnt (black and ash).
  - Here τ_r is the flame residence time. Flame depth is D = R·τ_r (Byram 1959) [K].
- **Front line.** Draw it with the isoline trick on T_a − t.
- **Hourly isochrones.** Use `fract(T_a/3600 s)`, with a perceptually ordered, colour-blind-safe ramp.
- **Flames.**
  - The prep or sim worker extracts the front polyline with marching squares on T_a = t each snapshot.
  - The main thread places up to ~2 000 instanced camera-facing flame quads along it, with additive blending and animated noise.
  - Height follows Byram's flame length, L = 0.0775·I^0.46 (L in m, I in kW/m), where I = H·w·R. Here H is the heat of
    combustion (kJ/kg), w the fuel consumed (kg/m²) and R the ROS (m/s) (Byram 1959; reviewed by Alexander & Cruz 2012) [K].
  - This is **for display only**. Eucalypt-forest flame heights with elevated fuels differ, so take the physics from the
    fire module.
- **ROS arrows** at the head and flanks, as instanced cones with length ∝ ROS. Tapping one opens "Why here?".

### 8.5 Smoke and plume

- **Low tier:** soft-particle billboards (depth-fade; r186 `webgpu_particles_soft` shows the technique). They are emitted
  at active cells and advected by the worker's wind, up to about 1–3 k particles at half resolution [H].
- **High tier:** raymarch the atmosphere's smoke and temperature-anomaly fields.
  - Upload them as a `Data3DTexture` (RGBA16F, 48×48×24 × 8 B ≈ 0.44 MB) [D].
  - Step count: r186's `webgl_volume_cloud` defaults to 100 steps on a 128³ texture; `webgpu_volume_fire` uses 16 [S].
    On phones, use 24–32 steps at ¼–½ resolution with blue-noise jitter, then upsample [H].
  - Cost ≈ pixels × steps. At ½-res DPR 1.5 that is 0.19 MP × 32 ≈ 6 M samples per frame [D].
- **Plume core:** show an isosurface of the temperature anomaly ΔT above a threshold (for example +2 K, user-tunable) with
  `MarchingCubes` on the coarse grid [S: r186 addon]. This lets trainees *see* the column tilt with wind.

### 8.6 Wind (the most important "why" visual in mountains)

- **Surface-flow particles.** Use 8–32 k particles advected through the 10 m-AGL wind texture, drawn as short streaks.
  - Update rule (Euler, or RK2 on the high tier): x_{n+1} = x_n + u(x_n)·Δt_vis.
  - Streak length ℓ = |u|·Δt_trail.
  - WebGL2 implementation: ping-pong RGBA16F position textures (render-to-float is supported [S]) and draw with
    `gl_VertexID` lookup.
  - Colour: speed, or **alignment with upslope**.
- **3-D streamlines** from the worker (RK2 through the 3-D field) are seeded upwind at 10, 100 and 500 m AGL and rendered
  as fat lines (`Line2`/`LineMaterial` addon [S]). They show plume indraft, updraft and lee-side separation.
- **Vertical cross-section.** Show a plane through the fire along the wind, textured with w (red = rising warm air, blue =
  sinking cool air) and potential temperature. This is the clearest way to show "hot and cold air movements".
- **Time-of-day flow.** At night, animate the particles at katabatic heights so trainees see drainage winds down gullies
  (see 02-mountain-meteorology.md).

### 8.7 Embers

- The worker posts the ember state (x, y, z, vx, vy, vz, age) per snapshot.
- Between snapshots, interpolate in the vertex shader: `x(t) = x_k + (t − t_k)/(t_{k+1} − t_k)·(x_{k+1} − x_k)`.
  Snapshots at 5-min spacing are too coarse for trajectories, so also post a **short ember-track buffer** (last ~30 s of
  positions at 1 s) for the 100–300 most significant embers [H].
- Render velocity-aligned instanced quads with additive blending. Colour runs from white-yellow through orange to dull red
  with age and cooling (blackbody-like ramp) [K]. Size attenuates, with a minimum of 2 px so embers stay visible in sunlight.
- **Landing markers.** A ring's radius and opacity follow ignition probability. When a spot fire ignites, a pulsing marker
  appears and a "Spot fire" card is shown. Also draw a **max-spotting-distance arc** downwind.

### 8.8 Picking and "Why here?"

- Raymarch the heightfield on the CPU from the camera ray (fast and exact on a DEM), or use `three-mesh-bvh` on the terrain mesh [S: npm 0.9.15].
- Send `explain(x, y)` to the worker. The response lists the factor decomposition (slope, wind, fuel, moisture, phenomenon
  multipliers) from the fire module.

---

## 9. Field UI/UX for gloves, sun and one hand

| Need | Evidence | FireSim rule |
|---|---|---|
| Touch targets | iOS: "hit region of at least 44x44 pt" [S: HIG]. Android: "at least 48dp×48dp. Larger is even better" [S]. WCAG 2.2 AA 24×24 CSS px; AAA 44×44 [S] | **Primary actions ≥ 64×64 pt with ≥ 12 pt gaps; secondary actions ≥ 48** [H]. Gloved fingertips are larger and less precise, and many firefighting gloves are not capacitive [K]. Field-trial with RFS-issue gloves |
| Gestures | "Offer alternatives to gestures… avoid custom multifinger" [S: HIG] | Every pinch, rotate or tilt also has buttons: ＋/－ zoom, "Look uphill", "Look downwind", "Plan view", "My position". Two-finger tilt is optional |
| Precise placement | [H] | **Crosshair placement:** drag the map under a fixed centre reticle and press the big "Mark fire here" button. "Mark at my GPS position" and "Mark at bearing + distance" (compass) are alternatives. Haptic confirmation (`@capacitor/haptics`) |
| Sunlight | "In bright surroundings, colors look darker and more muted" [S: HIG]. Contrast ≥ 4.5:1; "strive for … 7:1, especially in small text" [S: HIG] | "Sun" theme: near-black text on white or pale backgrounds, 7:1 minimum, heavy weights, no thin lines. Map overlays get 2-px dark outlines. Body text ≥ 17 pt (the iOS default) [S] |
| Night and smoke | [H] | "Night" theme: dark UI with dimmed map and no pure-white panels. Respect the system dark mode, and allow manual override |
| Colour vision | About 8 % of men of European ancestry have red–green deficiency (Birch 2012) [K] | Fire, burnt and unburnt are never shown by red/green alone. Add patterns (hatching), labels and a luminance-ordered ramp |
| One-handed | [H] | Bottom sheet with 3 detents. The primary action and timeline scrubber sit in the thumb zone. Nothing critical in the top 25 % of the screen |
| Interruptions | "Minimize use of time-boxed interface elements… Prefer dismissing views with an explicit action" [S: HIG] | Insight cards persist in a list, with no auto-dismiss toasts |
| Wet screens | [K] | Water causes phantom touches. Add a "lock interaction" toggle, and confirm destructive actions |
| Safety framing | [H] | A persistent "Training aid — not an operational prediction" banner. Follow the IC and NSW RFS procedures |

---

## 10. Implementation recommendations (consolidated)

### 10.1 Do now (v1)

1. **Capability probe at start-up (`src/platform/capabilities.ts`):**
   - `webgl2`;
   - extension set (`OES_texture_float_linear`, `EXT_color_buffer_float`, `WEBGL_multi_draw`);
   - `navigator.gpu?.requestAdapter()` and its limits;
   - `crossOriginIsolated`;
   - WASM SIMD, by validating a tiny SIMD module;
   - `Device.getInfo()`;
   - a 1.5 s micro-benchmark: one atmosphere step on 48×48×24, plus 60 frames of the terrain scene.
   - Output: tier `low | mid | high`, persisted in Preferences and re-measured after OS or WebView updates.
2. **Renderer:** `WebGLRenderer`.
   - `powerPreference: 'high-performance'`, `antialias: true` on mid and high tiers.
   - DPR cap per tier (1.25 / 1.5 / 2).
   - Render on demand.
   - Time-based animation.
   - `webglcontextlost` → show a message; on `webglcontextrestored` → rebuild GPU resources from CPU copies.
3. **Textures:** half-float for all sampled scalar and vector fields, which also covers iPhone float-linear filtering; KTX2
   for imagery and vegetation atlases.
4. **Worker protocol:** transferable buffer pool; yield every ≤ 50 ms; checkpoint every 10 simulated minutes and on
   `App.addListener('pause')`; restore on launch.
5. **Native glue (small custom plugin):** `thermal` (state + events), `lowPower`, and an Android `WebViewListener` for
   `onRenderProcessGone`. Add `@capacitor/app`, `@capacitor/network`, `@capacitor/device`, `@capacitor/haptics` and
   `@capacitor-community/keep-awake`.
6. **Storage:** area packs in `Directory.LibraryNoCloud` as files plus a JSON manifest; IndexedDB only as a cache index;
   `navigator.storage.persist()`.
7. **Network:** all fetches on the main thread through the existing `data/http.ts`; bytes are transferred to workers.
8. **Tests:** add a Vitest browser-mode project (Chromium + WebKit) for the worker protocol and shader compile; a
   Playwright Android WebView perf job on one physical device; and an iOS manual perf checklist.

### 10.2 Later (v2)

- WebGPU compute atmosphere behind `navigator.gpu` (iOS 26+, Chrome-based Android where available).
- SAB fast path when `crossOriginIsolated`:
  - iOS needs a `patch-package` patch adding `Cross-Origin-Opener-Policy: same-origin` and
    `Cross-Origin-Embedder-Policy: require-corp` to `WebViewAssetHandler`, which then requires CORP or CORS on every
    subresource;
  - Android needs androidx.webkit ≥ 1.18 with the allowlist and `Document-Isolation-Policy`, once stable.
- Optional Android `dataSync`/`specialUse` FGS and iOS `BGContinuedProcessingTask` experiments for background completion.

### 10.3 Simplifications and their consequences

| Simplification | Consequence | Mitigation |
|---|---|---|
| Atmosphere ≤ 60 k cells (150 m) on CPU tier | Cannot resolve VLS or gully-scale flows (needs ≤ 80 m [01]) | Parameterised mountain phenomena; label "sub-grid" in cards |
| Snapshots every 5 sim-min | Jerky ember and plume motion | Interpolation + short ember tracks |
| Representative trees, not a census | Visual density ≠ stems/ha | The fuel model uses rasters, not visuals; say so in the legend |
| Half-float fields | ~3 significant digits | Fine for display; the simulation stays Float32/64 in the worker |
| No background execution guarantee | Long runs stop when the phone locks | Checkpoint/resume; keep-awake during runs; progress in simulated time |
| Byram flame length for display | Can mismatch the model's flame height | Use the fire module's flame height when available |

### 10.4 User-editable inputs (technical side)

- Quality tier (auto/low/mid/high).
- Vertical exaggeration.
- Layer toggles.
- Particle counts.
- Smoke volume on/off.
- Snapshot interval (1–10 min).
- Theme (sun/night/system).
- Units.
- "Continue in background" (Android FGS, if implemented).
- Pack management (download, update, delete).
- GPS mode (precise/approximate).

Physical inputs (fuel strata, moisture, wind override, spot fires) are specified in the fuel, fire and weather documents.

---

## 11. Explaining it to a beginner firefighter: insight-card delivery and detection

### 11.1 Card anatomy and delivery rules [H, using S where cited]

- **Content:** title (≤ 6 words); one-sentence **why**; **what to watch for**; a **confidence/validity badge**
  ("Model OK", "Beyond validated slope", "Sub-grid estimate"); a **Show me** button; and **Why here?** for the cell.
  - Show me flies the camera, turns on the relevant overlay (slope arrows, wind streaks, cross-section) and pauses playback.
- **No auto-dismiss** [S: HIG]. At most 1 new card per 20 s of wall time. Order by severity: safety-critical, then
  behaviour change, then explanatory.
- **Accessibility:** cards are read by VoiceOver/TalkBack; the text is ≥ 17 pt; the icon and pattern encode severity, not only colour.

### 11.2 Fire-behaviour cards

Thresholds come from 01-terrain-fire-behaviour.md and 02-mountain-meteorology.md, which carry the primary citations.

| Card | Detection (evaluated by `explain/` every ~60 s simulated) | Text |
|---|---|---|
| **Running uphill** | Slope component along the spread direction θ_d ≥ 10° at an active head-fire cell | "The fire is climbing a {θ_d}° slope. Uphill, flames lean into unburnt fuel and pre-heat it, so spread roughly doubles every 10° (about ×{2^(θ_d/10)} here)." (Noble et al. 1980 via [01]) |
| **Beyond the model** | θ_d > 20° | "Above ~20° slopes, flames can attach to the ground and all standard models under-predict. Treat this run as possibly faster than shown." [01] |
| **Slow downhill, but it still moves** | θ_d ≤ −10° | "Going downhill the fire slows, but not much, and rarely below half its flat-ground speed. A backing fire can still reach you." (kataburn, via [01]) |
| **Gully / chimney** | Head cell in a channel (TPI and curvature concave) with along-axis slope near 25–30° and side walls about 20° | "This gully acts like a chimney. Hot air and flame are funnelled up it and the run can accelerate suddenly. Never be above a fire in a gully." (Xie et al. 2017; Viegas via [01]) |
| **Lee-slope sideways run (VLS)** | Lee slope > ~20°, aspect within ~30–40° of the wind-to direction, ridge wind > ~20–25 km/h, active fire on that slope | "Wind rolling over the ridge makes a spinning eddy on this steep lee slope. Fire can run *sideways* along it and throw embers far downwind." (Sharples et al. 2012 via [01][02]; sub-grid estimate) |
| **Wind change coming** | Forecast direction change ≥ 45° within 2 h over the scenario window [H] | "At {time} the wind swings to {dir}. Today's long flank becomes the head fire, with a much wider front." |
| **Upslope day / downslope night** | Local solar time and insolation on the slope (see [02]) | "Sun on this slope is driving air uphill, and the fire rides it." / "After dark, cool air drains down the gullies and pushes fire downhill." |
| **Spotting** | An ember lands > 100 m ahead of the front with ignition probability > 0.3 [H] | "Embers are landing {d} m ahead in dry fuel. New fires can start in front of you, not just at the edge." |
| **Fire makes its own wind** | Surface wind within 300 m of the fire deviates > 45° from ambient, or \|Δu\| > 30 % of ambient, toward the fire [H] | "Air is being sucked into the fire's rising column. Near the fire, the wind you feel is not the forecast wind." |

### 11.3 System and technology cards

| Card | Detection | Text |
|---|---|---|
| Paused in background | `App` `pause` while running | "The phone paused the simulation to save battery. It resumes where it left off." |
| Device hot | iOS `.serious`+, Android ≥ MODERATE, or step time +30 % | "Your phone is hot, so detail is reduced to keep it working. The fire physics are unchanged." |
| Restored after crash | Launched with an unfinished checkpoint | "The app restarted. Your scenario was restored to {simulated time}." |
| Offline data | Any layer older than its TTL, or `connectionType: 'none'` | "No signal: using weather from {issued} ({age} old). Enter belt-weather readings to update." |
| Poor GPS | `accuracy` > 50 m [H] | "GPS is uncertain (±{acc} m) in this valley. Check your position on the map before marking the fire." |
| Graphics limited | No WebGL2 (e.g. Lockdown Mode) | "3-D view unavailable on this device setting. Simulation results are still shown in 2-D." |

---

## 12. Open questions and uncertainties

1. **WebGPU in Android WebView** (not Chrome) on 2024–2026 devices. BCD only mirrors Chrome; test on Pixel (Mali/Tensor),
   Samsung (Xclipse is "probably 154"), and Snapdragon.
2. **Is `crossOriginIsolated` actually true** in WKWebView with patched COOP/COEP on `capacitor://`? The source analysis
   says yes. Also check whether androidx.webkit 1.18's allowlist works with Capacitor's `https://localhost` + DIP.
3. **Whether WKWebView JavaScript keeps running** under a `BGContinuedProcessingTask`, and whether Android WebView stays
   runnable under an FGS.
4. **Real per-cell cost c on target phones**, and sustained-vs-burst throttling over a 2-min solve.
5. **WebContent memory ceilings** (jetsam) on 4–6 GB iPhones. Apple does not publish them. Measure with `memUsed` and Instruments.
6. **Glove usability** of 64-pt targets with RFS-issue gloves. This needs field trials, since no primary standard exists for gloved touch.
7. **Lockdown Mode exclusion UX**: confirm the per-app exclusion flow on iOS 26.

---

## 13. References

**Capacitor and plugins**

1. Ionic. *Updating from Capacitor 7 to Capacitor 8*. https://capacitorjs.com/docs/updating/8-0 (source: https://github.com/ionic-team/capacitor-docs/blob/main/docs/main/updating/8-0.md)
2. Ionic. *Capacitor Configuration*, and *Data Storage in Capacitor*. https://capacitorjs.com/docs/config ; https://capacitorjs.com/docs/guides/storage
3. Ionic. Capacitor 8.5.2 sources:
   - `core/http.md` and `native-bridge.js`;
   - Android `Bridge.java`, `CapConfig.java`, `WebViewLocalServer.java`, `BridgeWebViewClient.java`;
   - iOS `WebViewAssetHandler.swift`, `CAPBridgeViewController.swift`, `WebViewDelegationHandler.swift`.
   https://github.com/ionic-team/capacitor
4. Ionic. Plugin READMEs: `@capacitor/geolocation` 8.2.2, `filesystem` 8.1.3, `preferences` 8.0.1, `device`, `app`, `network`. https://github.com/ionic-team/capacitor-plugins ; https://capacitorjs.com/docs/apis
5. Ionic. *Capacitor Background Runner* README. https://github.com/ionic-team/capacitor-background-runner
6. Capacitor issue #6182, "bug: SharedArrayBuffer support". https://github.com/ionic-team/capacitor/issues/6182
7. capacitor-community/sqlite README. https://github.com/capacitor-community/sqlite

**WebKit, Chromium and web platform**

8. WebKit. Source files on `main`:
   - `Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml`;
   - `Source/WTF/wtf/PlatformEnable.h`;
   - `Source/WebCore/page/SecurityOrigin.cpp`;
   - `Source/WebCore/loader/CrossOriginOpenerPolicy.cpp`;
   - `Source/WebKit/UIProcess/ProcessThrottler.cpp`;
   - `Source/WebCore/platform/graphics/AnimationFrameRate.{h,cpp}`.
   https://github.com/WebKit/WebKit
9. Chromium. Source files on `main`:
   - `android_webview/common/aw_features.cc`;
   - `android_webview/browser/aw_field_trials.cc`, `aw_browser_context.cc`, `aw_content_browser_client.cc`;
   - `android_webview/java/.../AwContents.java`, `AwBrowserContext.java`;
   - `gpu/config/gpu_finch_features.cc`;
   - `third_party/blink/renderer/platform/runtime_enabled_features.json5`.
   https://github.com/chromium/chromium
10. Android Developers. *AndroidX WebKit release notes* (1.18.0-alpha01, 9 Sep 2026). https://developer.android.com/jetpack/androidx/releases/webkit
11. Chromium issue 40914606, "SharedArrayBuffer is unavailable in Android WebView because crossOriginIsolated is false". https://issues.chromium.org/issues/40914606 (not readable here; search snippet only)
12. cmer81/maps PR #128, "fallback sans SharedArrayBuffer (WebView Android)", merged 25 Sep 2026. https://github.com/cmer81/maps/pull/128
13. GPU for the Web CG. *WebGPU Implementation Status*. https://github.com/gpuweb/gpuweb/wiki/Implementation-Status
14. W3C. *WebGPU* (spec source `spec/index.bs`: limits and `float32-filterable`). https://www.w3.org/TR/webgpu/ ; https://github.com/gpuweb/gpuweb
15. MDN. browser-compat-data (`api/GPU`, `WorkerNavigator`, `OffscreenCanvas`, `Worker`, `StorageManager`,
    `FileSystemSyncAccessHandle`, `WakeLock`, `BatteryManager`, `PressureObserver`, `Navigator`, WebGL extensions;
    `javascript/builtins/SharedArrayBuffer`; `webassembly/*`). https://github.com/mdn/browser-compat-data
16. MDN. *Storage quotas and eviction criteria*. https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria

**Apple and Android platform documentation**

17. Apple. *Extending your app's background execution time*. https://developer.apple.com/documentation/uikit/extending-your-app-s-background-execution-time
18. Apple. *Performing long-running tasks on iOS and iPadOS*, `BGContinuedProcessingTask(Request)`. https://developer.apple.com/documentation/backgroundtasks/performing-long-running-tasks-on-ios-and-ipados
19. Apple. `ProcessInfo.thermalState`, `ProcessInfo.ThermalState`, `isLowPowerModeEnabled`, and `WKNavigationDelegate.webViewWebContentProcessDidTerminate(_:)`. https://developer.apple.com/documentation/foundation/processinfo/thermalstate-swift.enum
20. Apple. *App Store Review Guidelines* (2.4.2, 2.5.2, 2.5.6, 2.5.9, 4.2). https://developer.apple.com/app-store/review/guidelines/
21. Apple. *Human Interface Guidelines*: Buttons, Accessibility, Dark Mode, Color. https://developer.apple.com/design/human-interface-guidelines/
22. Android Developers. *Foreground service types*; *Behavior changes: Android 15*. https://developer.android.com/develop/background-work/services/fgs/service-types ; https://developer.android.com/about/versions/15/behavior-changes-15
23. Android Developers. `PowerManager` and `WebViewClient` references. https://developer.android.com/reference/android/os/PowerManager ; https://developer.android.com/reference/android/webkit/WebViewClient
24. Android Developers. *Make apps more accessible*. https://developer.android.com/guide/topics/ui/accessibility/apps
25. W3C. *Understanding SC 2.5.8 Target Size (Minimum)*; *2.5.5 Target Size (Enhanced)*. https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html ; https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html

**Three.js, terrain and graphics**

26. three.js r186:
    - `WebGPURenderer.js`, `WebGLRenderer.js`, `InstancedMesh.js`, `BatchedMesh.js`;
    - examples `webgl_batch_lod_bvh`, `webgl_volume_cloud`, `webgpu_volume_fire`, `webgpu_particles_soft`.
    https://github.com/mrdoob/three.js/tree/r186
27. agargaro. *InstancedMesh2* (`@three.ez/instanced-mesh`). https://github.com/agargaro/instanced-mesh
28. Mapbox. *MARTINI* README. https://github.com/mapbox/martini
    - Algorithm: Evans W., Kirkpatrick D., Townsend G. (2001), *Right-triangulated irregular networks*, Algorithmica 30:264–286 [K].
29. Strugar F. (2009). *Continuous distance-dependent level of detail for rendering heightmaps*. J. Graphics, GPU & Game Tools 14(4):57–74 [K].
30. Losasso F., Hoppe H. (2004). *Geometry clipmaps: terrain rendering using nested regular grids*. ACM Trans. Graphics 23(3):769–776 [K].
31. Horn B.K.P. (1981). *Hill shading and the reflectance map*. Proc. IEEE 69(1):14–47 [K].

**Alternative frameworks and tooling**

32. Expo. *GLView* docs. https://docs.expo.dev/versions/latest/sdk/gl-view/ (source: https://github.com/expo/expo/blob/main/docs/pages/versions/unversioned/sdk/gl-view.mdx)
33. react-native-wgpu 0.5.17 (npm, 8 Jul 2026). https://github.com/wcandillon/react-native-webgpu
34. Meta. *Hermes* README. https://github.com/facebook/hermes
35. flutter_scene 0.23.0 README (pub.dev, 25 Aug 2026). https://github.com/bdero/flutter_scene
36. Vite. *Features: Web Workers*. https://vite.dev/guide/features#web-workers
37. Vitest. *Browser Mode*. https://vitest.dev/guide/browser/
38. Playwright. *Android* (experimental), per `playwright-core` 1.63 type docs. https://playwright.dev/docs/api/class-android
39. vite-plugin-pwa 1.3.0. https://github.com/vite-pwa/vite-plugin-pwa

**Fire science and human factors**

40. Byram G.M. (1959). Combustion of forest fuels. In Davis K.P. (ed.), *Forest Fire: Control and Use*, McGraw-Hill, pp. 61–89 [K].
41. Alexander M.E., Cruz M.G. (2012). Interdependencies between flame length and fireline intensity in predicting crown fire initiation and crown scorch height. IJWF 21:95–113. https://doi.org/10.1071/WF11001 [K]
42. Noble I.R., Bary G.A.V., Gill A.M. (1980). McArthur's fire-danger meters expressed as equations. Aust. J. Ecology 5:201–203. https://doi.org/10.1111/j.1442-9993.1980.tb01243.x [via 01]
43. Sharples J.J., McRae R.H.D., Wilkes S.R. (2012). Wind–terrain effects on the propagation of wildfires in rugged terrain: fire channelling. IJWF 21:282–296. https://doi.org/10.1071/WF10055 [via 01/02]
44. Hines F., Tolhurst K.G., Wilson A.A.G., McCarthy G.J. (2010). *Overall Fuel Hazard Assessment Guide*, 4th edn. Fire and Adaptive Management Report 82, Victorian DSE [K].
45. Birch J. (2012). Worldwide prevalence of red–green color deficiency. J. Opt. Soc. Am. A 29(3):313–320 [K].
46. FireSim internal: `docs/ARCHITECTURE.md`; `docs/research/01-terrain-fire-behaviour.md`; `docs/research/02-mountain-meteorology.md`.
