# Plan: night map lighting, debug statistics, honest speed reporting, Air Slices and zoom-adaptive wind (0.3.0 to 0.5.0)

**Status: plan only. Nothing is built.** Branch `claude/3d-fire-simulation-app-xoy1o6`, written 2026-10-11 against HEAD `c5c2f44` (0.2.2).

**Inputs:** your requests in this conversation (slices, slow-run reporting, horizontal slice and zoom detail, debug statistics, night lighting); the "Engine right now" readout from the user's phone (Fast tier chosen by auto-tune, 41.1 ms per 3-D air step, fast tier computing at 871x real time); and four read-only surveys of the code (timeline and playback; slice UI and render integration; engine data plumbing and tests; wind glyphs and fine-scale wind). File and line references below come from those surveys or from direct reads; `[est]` marks a number that is an estimate, not a measurement.

---

## 1. What this delivers

| You asked for | What you get | Workstream | Release |
|---|---|---|---|
| A copy button for the engine section, renamed "Simulation debug statistics", more cheap statistics, phone hardware and software facts, reachable directly under Settings | A full "Simulation debug statistics" screen: Copy as text, entry directly under Settings in the menu (and in Settings and Setup), speed history, where the time goes, memory, frame rate, recent events, phone model / Android / WebView / CPU / memory / GPU / graphics capabilities | **A** | 0.3.0 |
| Detailed (3-D) mode may fall behind real time; results matter more; report slowness subtly on the timeline; tap for a comprehensible explanation | Auto prefers the detailed 3-D air on any phone that can run it at all; never silently drops to the fast model; a small amber speed button appears at the end of the timeline only while playback is waiting for the simulation; tapping it opens a plain-language sheet | **B** | 0.3.0 |
| Vertical cross-sections of the air wherever you want, on mobile | Air Slice tool: place a line anywhere (crosshair Set A / Set B, or one-tap presets), a flat 2-D side-view panel with axes, terrain, colour chips, flow streaks and a touch probe, plus the 3-D curtain; works on every phone because the fast tier now publishes a diagnosed 3-D wind; exact near-ground sampling | **C**, **D** | 0.4.0 |
| A horizontal slice of wind; indicators that get more detailed as you zoom; curves that follow the wind when very close | "Arrows and flow lines" layer at a chosen height: sparse straight arrows far away, denser arrows closer, curved streamlines up close, seeded per screen area; height control; honest captions about what the model can resolve; optional 60 m "wind the fire feels" raster for close-up detail | **E** | 0.5.0 |
| Remove the day/night darkening of the terrain, in the Layers settings, because at night the terrain details are very hard to see | Layers, Map type, **Night lighting**: Realistic (today's look), Brighter, Daylight. The ground, trees and roads stay readable after dark, lit from a fixed north-west sun so relief shows; the sky, stars and the fire's glow still follow the clock; remembered between runs | **F** (section 9b) | 0.3.0, and independent, so it can ship first |

Recommended order: **F, A and B first** (F is small and independent; A and B give every later release real phone data), then **C + D**, then **E**. Each release is an installable APK with its own phone check-list (section 12).

## 2. What the phone and the code told us

**The phone readout**
- Auto-tune measured 41.1 ms per 3-D air step and predicted 124 s for a 6 h run against a 120 s budget, so it chose Fast. That is 3.6 % over the line (`autoTuneDecide`, `src/sim/simulation.ts:1037-1053`; constants `src/sim/params.ts:36-45`: x1.4 overhead, 10 s steps, budget `max(30 s, 120 s x duration / 6 h)`; the cut-off step time is 39.7 ms for runs of 1.5 h or more).
- The 41.1 ms is the mean of the **first 20 spin-up steps** (`simulation.ts:557-560`), the JIT warm-up window that the repo's own perf test throws away (`src/atmosphere/perf.test.ts:41`). Steady state is probably lower. Nobody had measured a phone before; 41 ms is 2.35x this build machine's 17.5 ms, inside the 2-3x the spec guessed.
- The fast tier runs at 871x on this phone: 14x headroom over the 60x playback setting.
- The only wall-clock-dependent decision in the engine is the auto-tune tier choice at start (`snapshotHash` skips `engine`, `src/sim/testing/hash.ts:31`). Everything else wall-clock is monitoring.

**Playback and "slow" today**
- The playhead waits when it reaches the newest snapshot (`advanceClock`, `src/ui/session.ts:99`); the worker looks ahead `max(3 x display step, speed x 30 s, 1800 s)` (`:87`). The only cue is a "Computing" badge after 800 ms of waiting (`src/ui/screens/sim/topBar.ts:157-168`), which resets whenever the clock moves more than 1 s, so chronic short stalls never trigger it.
- `run.simSecondsPerWallSecond` is cumulative, compute-only and includes warm-up; `workerSpeed` is an EMA of per-chunk compute speed (`session.ts:406`, shown only in the Stats tab). Neither says whether playback is actually keeping up. Per-module timings (`perfMods`) are collected in the worker and never sent to the UI.

**Air data**
- `DiagnosticWind.view()` returns `nz = 0` (`src/atmosphere/diagnosticWind.ts:229-253`) although its stamp pair holds a full 3-D wind (`bg.uc/vc/wc`, used for embers at `:176-223`).
- `has3dAtmosphere` is `nz > 0` in three places (`src/ui/screens/sim/context.ts:112`, `src/render/layerCatalog.ts:929`, `src/ui/screens/sim/layersModel.ts:244`): publishing a fast-tier volume would silently flip callouts, labels and availability.
- The 3-D view resamples the model's terrain-following grid onto flat levels and zeroes cells below terrain (`src/atmosphere/atmosphere.ts:1099-1116`); the sampler interpolates across the zeros (`src/render/atmosphereSampler.ts:94-100`). On a ridge 700 m above the lowest ground the first valid flat level is about 91 m above the ground, so near-ground values (the layer firefighters care about) read too low.
- `levels` already holds the model's terrain-following level centres (`atmosphere.ts:1092`), and `z = z_s + zeta x J`, `J = 1 - h0 / H'` (`src/atmosphere/grid.ts:11,279-285`). A terrain-following view therefore needs no extra arrays, and copying native arrays is cheaper than the current resample.
- Only keyframes (every 300 s) and the newest snapshot keep the view and rasters (`src/ui/snapshotStore.ts:18-35,361-374`), so scrubbed air can be up to 300 s stale.
- The fast tier's raw 3-D wind lacks kappa scaling, night decoupling, slope-flow top-up, lee blend and the fire's indraft (those exist only in the fire-grid 2-D wind). A diagnosed slice at night shows the forecast wind where the fire feels at most 30 % of it.

**Wind detail**
- Wind particles are seeded over the whole domain (1300 / 2600, `src/render/windLayer.ts:67,89-91`); no streamline or integrator code exists; arrows are a fixed 9x9 lattice with no UI switch (`windLayer.ts:186-243`, `SceneView.ts:658`).
- The fire-grid wind (`env.windU/V`) is persistent and can be copied in `makeSnapshot` (`simulation.ts:1612-1619`) but must never be recomputed there (`surfaceWindForFire` mutates `slopeFlow`, `uRidgeMedian`, `fireInfluence`, `src/atmosphere/base.ts:712-761`). It is the atmosphere field interpolated at >= 50 m plus cell-scale terms, not a resolved 30 m flow.
- Camera metres-per-pixel is private (`src/render/cameraRig.ts:288`); the closest LOD patterns to copy are `src/render/placesLayer.ts:542-574` (pose signature, >= 250 ms throttle, preallocated attributes) and `vegetationLayer.ts:393`.

**UI and budgets**
- The timeline strip is 64 px; its slider covers the strip; the free space is two 44x20 cells under the step buttons and a 4th grid column that appears only for Cancel while seeking (`src/ui/screens/sim/scrubber.ts`, `src/styles/transport.css:562-903`). Tap targets must be >= 44 px, layout-audit slack is about 20 px (`scripts/layout-budget.mjs:27-35`).
- `transportSheet()` + `createPopoverGroup()` (`src/ui/screens/sim/transportKit.ts:33,110`) are the right primitives for a tap-for-details sheet (dialog role, scrim, Escape, focus return, Back handling via `closeTopLayer`).
- Bundle: all-JS gzip 953.8 kB of 1000 (lazy chunks count; `scripts/check-bundle.mjs`), entry 184 of 195, CSS 122.2 kB of 135 raw; Layers-panel DOM 914 of 1000 nodes. Headroom is thin.
- Vitest runs in `node` with no DOM; DOM builders are not unit-tested; logic must live in pure modules. There is no CI config in the repo; e2e runs a Pixel 7 profile on SwiftShader. Only one e2e spec forces a tier; the others run on Auto and branch on what the machine picks.

## 3. Decisions to confirm (each has a default, so "go" accepts them all)

| # | Decision | Default | Effect if you change it |
|---|---|---|---|
| D1 | Release split | Three installable drops: 0.3.0 (F + A + B), 0.4.0 (C + D), 0.5.0 (E) | One big drop is possible but loses the early phone data and raises risk |
| D2 | Auto policy ceiling | Detailed unless the predicted compute time for a 6 h run exceeds **10 minutes** (cut-off about 198 ms per air step, about 4.8x slower than your phone), scaled by run length, floor 60 s | Smaller = more phones fall back to Fast; larger = more phones wait longer. Your phone gets Detailed either way |
| D3 | Timeline signal placement | A 44x44 speed button in the strip's right-hand column that exists only while behind (like Cancel does while seeking); a layout spike confirms it; fallback is a badge in the clock button plus an under-rail line | See 6.4 |
| D4 | Old "Engine right now" section | Moves into the new screen; the model card keeps a four-row summary and an "Open Simulation debug statistics" row | Keeping the full block in both places duplicates about 30 rows |
| D5 | Phone identity source | Web APIs only (User-Agent Client Hints, user agent), no new native plugin | `@capacitor/device` gives exact model and Android API level but adds a native dependency |
| D6 | Slice placement in 0.4.0 | Crosshair "Set A / Set B" and presets; draggable map handles later | Handles have no precedent in the codebase and conflict with one-finger pan (8.3) |
| D7 | Time-lapse recorder for a pinned line | Deferred to 0.4.1 (slices use the newest/keyframe air, labelled with its age) | Adds memory and five truncate sites to keep in step |
| D8 | Horizontal slice drawing | Draped on the ground (plan view) with a height label | True-height floating glyphs in orbit view are a later stretch |
| D9 | New glyph layer default | Opt-in in 0.5.0; the existing wind streaks stay the default | Making it the default changes every screenshot and e2e baseline |
| D10 | Bundle budget | Lazy-load the slice panel and glyph engine, run a trim pass; raise the all-JS budget only if measured need remains, and ask you first | Estimated additions are 40-50 kB gzip against 46 kB of headroom |
| D11 | Fire-felt wind raster | Int16, about 60 m cells, newest snapshot plus keyframes (0.5.0 stage E2) | Float32 at 30 m is 4-8x the memory |
| D12 | Names | "Detailed (3-D air)" = Standard and High tiers; "Fast (surface wind)" stays | Only labels change |
| D13 | Night lighting choices and default | Realistic (default), Brighter, Daylight; the default stays Realistic because the dark night is a deliberate training point (judging a fire at night) | Making Brighter the default changes the night screenshots and every night e2e baseline |
| D14 | When night lighting ships | With 0.3.0 | It is independent of everything else: I can ship it alone first as 0.2.3 if you need it sooner |

## 4. Ground rules (apply to every workstream)

1. **Results never depend on speed, display or statistics.** The only wall-clock decision stays the one Auto choice at the start. A test runs the same scenario at different playback speeds and with statistics perturbed and asserts identical snapshot hashes.
2. **No silent degradation.** Nothing changes the tier, step, embers or grid to "keep up". Only the user (or the one start-time Auto decision, shown with its numbers) does. A test asserts the tier never changes after the start decision.
3. **Display data is derived and pure.** `view()` stays pure and allocates fresh arrays per call (transfer detaches them); the fire-grid wind is copied, never recomputed.
4. **Honest labels.** Every slice and glyph says what it is: time-stepped or diagnosed, the model grid size, and the age of the air.
5. **Mobile ergonomics.** Targets >= 44 px, gloved-hand two-step placement, nothing pops up over the map by itself, no `role=alert` or toast (the e2e popup watcher flags them).
6. **Offline.** No network calls from any new code (the I4 audit stays green).
7. **Budgets measured every release** (section 11), including memory on the phone via the new statistics screen.
8. **Pure modules for logic.** Everything with arithmetic goes in a DOM-free `*Model.ts`-style module with node unit tests; DOM files stay thin.
9. **Numbers shown to people are measurements** and say so ("measured on this phone over the last 30 s").

---

## 5. Workstream A: Simulation debug statistics (0.3.0)

Renames "Engine right now", adds a Copy button for just this content, makes it reachable directly under Settings, adds cheap statistics, and adds phone hardware and software facts.

### 5.1 What the user gets
- **Name:** "Simulation debug statistics" everywhere. The title "Engine right now" is retired; tests, docs and screenshots follow.
- **Where to find it (one or two taps):**
  - **Main menu**, directly under Settings: the drawer list `app = [Settings, New scenario]` (`src/ui/screens/sim/topBar.ts:72`) becomes `[Settings, Simulation debug statistics, New scenario]` (test id `menu-debug-stats`, existing `speed` icon, sub-line "Speed, memory and what this phone can do").
  - **Settings, Data and transparency**, under "How this simulation works" (`src/ui/screens/settings.ts:161-168`, `settings-debug-stats`).
  - **Setup**, next to "How this simulation works" (`src/ui/screens/setup.ts:541-543`, `setup-debug-stats`). Before a run the run groups say "No run yet" and the phone groups are live, so a phone can be checked before building anything.
  - The slow-run sheet (workstream B) links to it as "All the numbers".
- **Copy:** an app-bar icon plus a labelled button, same pattern as the card's "Copy as text" (`src/ui/screens/modelCard.ts:85-106`, `copyText` in `src/ui/widgets.ts:500`), copying **only this screen** as plain text. Inline confirmation line ("Copied: these statistics as text, ready to paste."), no pop-up. If the phone refuses the clipboard, the text appears in a selectable box ("Touch and hold to select, then Copy."). Stretch: a small copy icon on each group header.
- **Privacy:** the copy never contains coordinates, a custom place name or any identifier (no serial, IMEI or advertising id). Under the button: "Copies this page as text. Nothing is sent anywhere." (same promise as `src/ui/screens/datasets.ts:774`).
- **Live:** refreshes once a second while open and updates cells in place (no DOM rebuild, so selection and scroll survive), skipping while the app is hidden, exactly like the card (`modelCard.ts:390-391`). When the run is paused or finished the header says so.
- **Copied text shape** (plain text, stable labels, ends with a marker so a truncated paste is obvious):
  ```
  FireSim: Simulation debug statistics
  Copied 2026-10-11 14:32:05 (UTC+11) | app 0.3.0 (build BX3k9aQz, capacitor) | run 01:32:10 | seed 1
  == Summary ==  ...
  == Speed ==  ...
  == Where the time goes ==  ...
  == Memory ==  ...
  == Phone: hardware ==  ...
  == Phone: software and graphics ==  ...
  == Recent events ==  ...
  -- end --
  ```

### 5.2 What happens to the old section
`engineFacts` (`src/ui/modelInfo.ts:867-941`, section registered at `:1060`) becomes a four-row live summary (tier and why, speed, memory, phone class) plus an "Open Simulation debug statistics" row; the card's own "Copy as text" (`cardToText`, `:1078`) keeps the summary rows only. Tests and docs that pin the old title or block are updated here: `e2e/model-card.spec.ts:198`, `src/ui/modelInfo.test.ts:85`, `e2e/gallery.spec.ts:173`, README:227, `docs/ARCHITECTURE.md:327`, `docs/DESIGN.md:412-418`.

### 5.3 Statistics catalogue
Cost classes: **S** static, **C** counter (one add per event), **R** running aggregate (O(1) per event), **H** small fixed ring (<= 128 numbers), **D** on demand (only when the screen opens or a button is pressed). Rule: always-on statistics are C, R or H only; no per-cell loops, no per-frame allocation, no per-step log.

| Group | Statistics | Source | Class |
|---|---|---|---|
| Summary | One headline sentence: tier, achieved vs wanted speed, engine memory, phone class | derived | D |
| Run | App version, build id, mode, platform; bundled site id or "custom place in NSW", area (km), fire cell (m), duration, start time, seed, deterministic flag; run clock, computed-to, wall time since run start and since boot | `src/ui/buildInfo.ts`, scenario, `EngineRunInfo` | S/D |
| Choices | Tier requested / in use / why, display step, solver limit, playback speed, coupling, embers, mountain phenomena | existing `EngineInfo` (`src/core/simTypes.ts:342-495`) | S |
| Grids | Atmosphere nx x ny x nz, spacing, first layer, top, stretch, spun-up, upper-air source, view decimated; fire nx x ny, cell, current sub-step | existing | S |
| Speed | Computing speed: last 10 s, last 60 s, run mean, best and worst 10 s window; wanted vs achieved playback speed and the share of time playback waited (workstream B) | worker perf + session | R |
| Speed history | 20 samples, one per 30 s, oldest first (text) plus a tiny sparkline | worker perf | H |
| Step | Outer step now / min / mean / max; steps taken; whole-step ms mean (exists), median, 95th percentile, max over the last 128; counts of steps over 100 ms and 250 ms | worker perf | R/H/C |
| Worker duty | Share of wall time the worker spent computing, last 10 s and 60 s: separates "flat out" from "waiting to be watched" | worker perf | R |
| Where the time goes | Per module: ms per step and share of busy time, since start and last 10 s: air step, fire spread, coupling (wind sampling, heat deposit), embers, moisture and sun, detectors and insight cards, picture build, checkpoints, other. `airAt` is nested inside `surfaceWind`, so it is excluded from shares | `Simulation.perfMods` (collected today, never sent) | R |
| Step quality | Share of air steps limited by horizontal CFL / vertical CFL / the 12 s cap / the user limit; run-max horizontal and vertical wind; pressure-projection corrections per step; 3-D spin-up wall time; fire sub-steps per outer step; burning cells | values the solvers already compute for the time step | R |
| Embers | Tracked / budget (exists); spawned and landed totals if the ember model already counts them | existing | C |
| Re-runs | Rewinds, sim-seconds recomputed, tier switches, checkpoint restores | session / worker | C |
| Memory | Engine measured total and top parts (exists, refreshed at most every 30 s), checkpoints held and bytes (exists), history store frames / keyframes / bytes against cap / thinned frames (`snapshotStore.ts` getters), snapshot size last and mean, JS heap used / total / limit (`performance.memory`, reader at `src/scenario/memoryModel.ts:335`), storage used / quota (`src/data/storage.ts:78`) | mixed | C/D |
| Display (main thread) | Frame rate last 10 s (mean, 95th percentile frame ms, frames over 33 ms and over 100 ms); long tasks in the last 60 s (count, total ms; `PerformanceObserver('longtask')` where present); draw calls, triangles, textures (`renderer.info`); pixel ratio used vs cap; canvas size. The scene stops drawing while a full-screen screen is open (`src/render/api.ts:111`), so these are the last seconds before opening | `SceneView` ring + observer | H/D |
| Phone: hardware | Maker and model; Android version and API level; CPU cores, architecture, bitness; memory class (`deviceMemory`, a coarse bucket); screen px, CSS px, pixel ratio, refresh rate measured from 30 animation frames, touch points; battery level and charging where the API exists; storage | UA Client Hints `getHighEntropyValues`, user-agent fallback, `navigator.*`, `screen.*` | D |
| Phone: software and graphics | WebView / Chromium version and brands; raw user agent; WebGL2 vendor and renderer (`WEBGL_debug_renderer_info`), max texture size, float and half-float render targets, compressed textures; WebGPU present (adapter vendor and architecture within a 1 s timeout); WebAssembly, SIMD (`WebAssembly.validate` probe), `SharedArrayBuffer`, `crossOriginIsolated`; `OffscreenCanvas`, module workers; reduced motion, contrast and colour scheme | new `src/ui/deviceInfo.ts` (reuses probes in `src/ui/bootDiagnostics.ts:48-77`) | D |
| What this phone can do | Three measured sentences, never guesses: 3-D air step ms and speed if the 3-D tier ran; fast-tier speed if it ran; memory headroom (engine vs JS heap limit); graphics path | derived from the rows above | D |
| Recent events | Ring of the last 40: wall clock and run clock, kind, short text. Sources: tier chosen (with the timing), slow-run episodes (start, end, slowest ratio), app backgrounded / foregrounded and for how long (`simScreen.ts:857-862` already sees visibility), rewinds and edits, checkpoint restores, history thinning, long-step bursts, last 5 uncaught errors (`bootDiagnostics.ts:31-32`) | `src/ui/eventLog.ts` + worker events | H |

Optional **Speed test** (stretch, release 0.3.1): about 2 s in a throwaway worker on frozen kernels (45x45x20 stencil with trilinear gathers, a memory-copy loop), result shown against a reference measured by the same code in CI. Disabled while a run is playing ("Pause first so the test is fair"). It exists to compare phones before any run; the engine's own measured step is the better number once a run exists.

### 5.4 Design
- **Pure content, thin DOM.** `src/ui/debugStats.ts` (no DOM) builds a `DebugStats` object (groups of `{ id, label, value, note?, live? }`) from `{ engine, session, frames, store, device, events, now }` and exports `debugStatsToText`. `src/ui/screens/debugStats.ts` renders it with the existing primitives (`appBar`, `kv`, collapsible groups and the focus trap and in-place 1 Hz patching from `modelCard.ts:390-424`).
- **Worker side.** New `src/sim/perfStats.ts` holds the aggregates and rings, fed from the places that already time modules (`addPerf`, `autoTuneDecide`). It reports through a new `EngineInfo.perf` block (about 40 numbers, 20 speed samples, <= 8 events; well under the 2 KB EngineInfo note at `src/core/simTypes.ts:333-341`). New fields are `null`, never NaN (`engineInfo.test.ts:34` rule). Worker events (tier choice, long-step bursts) are drained into `perf.events` at `makeSnapshot` (each event has an increasing `seq`; the UI dedups), so **no new `SimController` method** is needed (hand-written fakes in `session.timeline.test.ts:69`, `review.test.ts:44`, `model.test.ts:175` and `mockSim.ts:190` would all break).
- **Main side.** `SceneView.frameStats()` as an optional `SceneViewApi` method (like `viewSection?`, `src/render/api.ts:52`; the mock stays valid) backed by a 120-entry ring in the render loop, which already times frames for `AdaptiveDpr` (`SceneView.ts:194,1170-1186`); `src/ui/deviceInfo.ts` collects phone facts once and caches them (`deviceInfoNow()` for the synchronous part, `deviceInfoAsync()` for Client Hints, battery, storage, WebGPU adapter, refresh rate); `src/ui/eventLog.ts` is the event ring.
- **Opening.** `App.openDebugStats()` mirrors `openModelCard()` (`src/ui/app.ts:236-252`): overlay id `debug-stats`, a single instance, a back-stack entry, focus returns to the row that opened it. Rows added to the sim context (`context.ts`, `simScreen.ts:130-133`) and to Settings and Setup options.
- **No new native plugin (D5).** The app ships only core, filesystem, geolocation and preferences. Maker, model and Android version come from User-Agent Client Hints where the WebView offers them, else from the user agent; the raw user agent is always printed, so the first copy from a phone shows exactly what this WebView reports. Chromium's reduced user agent can hide model and OS ("Android 10; K"); if that is what arrives the row says "hidden by the WebView" rather than guessing.
- **Cost guardrails (acceptance, measured).** Always-on statistics add less than 1 % to whole-step time in the fast and standard tiers (a `perf.test.ts`-style comparison with them switched off), under 16 KB retained in the worker and under 60 KB on the main thread, no allocation per frame (reviewed, and checked by the heap-flat leak test in `e2e/robustness.spec.ts`), zero network calls.

### 5.5 Files
New: `src/ui/debugStats.ts`, `src/ui/deviceInfo.ts`, `src/ui/eventLog.ts`, `src/ui/screens/debugStats.ts`, `src/sim/perfStats.ts`, `src/styles/debugstats.css` (<= 2 KB), and their tests.
Changed: `src/core/simTypes.ts` (`EngineInfo.perf`), `src/sim/simulation.ts` and `src/sim/engineInfo.ts` (feed and report), `src/render/api.ts`, `SceneView.ts`, `src/ui/mockScene.ts` (`frameStats`), `src/ui/app.ts`, `src/ui/screens/sim/topBar.ts`, `simScreen.ts`, `context.ts`, `src/ui/screens/settings.ts`, `src/ui/screens/setup.ts`, `src/ui/modelInfo.ts` and its test, `src/ui/bootDiagnostics.ts` (export the error list, reuse probes), README, ARCHITECTURE, DESIGN, Help and Glossary, `e2e/model-card.spec.ts`, `e2e/gallery.spec.ts`.

### 5.6 Tests and acceptance
- **Unit (node):** `debugStats.test.ts` (every group renders with real and with missing data, never "undefined", "NaN" or "null"; stable titles and labels; header, timestamp and end marker present; no coordinates or custom name ever appear); `deviceInfo.test.ts` (stubbed `navigator`, `screen` and WebGL context; fixtures for a reduced user agent, a normal WebView user agent, no Client Hints, no battery API, no WebGPU, WebGL context creation failing); `perfStats.test.ts` (aggregates, ring wrap, 10 s and 60 s window maths with a fake clock); `eventLog.test.ts`; updated `modelInfo.test.ts`.
- **Determinism:** same scenario with statistics on and a perturbed clock gives identical snapshot hashes (extends the chunk-invariance tests in `simulation.test.ts:77,120,165`).
- **E2E (Pixel 7 profile, real engine):** the menu row is directly after Settings; opens from menu, Settings and Setup; Back and Escape close it and focus returns; live values change while playing; Copy with clipboard permission (text has group titles, end marker, no coordinates); Copy with `navigator.clipboard` rejected (fallback box); the four looks and `styles.rules.test.ts` (text >= 14 px, targets >= 44 px).
- **Acceptance:** two taps from the sim or Setup, Copy, paste into a message, and a developer can read tier and why, speed history, where the time went, memory, and the phone's model, Android and WebView versions, cores, memory class, GPU and graphics capabilities.

---

## 6. Workstream B: Honest speed reporting (0.3.0)

Detailed mode is allowed to be slower than playback. The app says so, subtly, and explains it on tap.

### 6.1 What the user gets
- **Auto prefers the detailed 3-D air** on any phone that can run it in a reasonable time, and never silently drops to the fast model. The reason line shows the measured numbers.
- **A small amber speed button at the right end of the timeline**, present only while the simulation is behind your playback speed. Nothing pops up, nothing vibrates, no toast.
- **Tap it** and a sheet explains in plain words: what you asked for, what the phone is doing, whether the result is affected (no), where the time goes, likely reasons, what you can do, and a link to all the numbers.
- **Max speed has no "wanted" speed**, so no signal there; the statistics screen still shows the computing speed.

### 6.2 Auto policy: detailed unless hopeless
Today (`src/sim/params.ts:36-45`, `src/sim/simulation.ts:1037-1053`): time the first 20 spin-up steps, predicted = 1.4 x mean step x (duration / 10 s), budget = `max(30 s, 120 s x duration / 6 h)`, Detailed only if predicted <= budget.

Change:
- **Sample steady state, not warm-up.** Time 30 steps, skip the first 10, take the **median** of steps 11-30 (new `autoTuneWarmupSteps: 10`, `autoTuneSteps: 30`). Report both numbers (warm-up mean, steady median) in `EngineInfo.autoTune` so we learn how much warm-up inflates the old reading. Cost: 10 extra spin-up steps (about 0.4 s on your phone), wasted only when Fast is chosen.
- **A much larger ceiling.** `autoTuneBudgetS: 600` (10 minutes for 6 hours of fire, scaled by duration) and `autoTuneMinBudgetS: 60`. The rule `predicted <= budget` is unchanged.
- **Reason text** (`tierReasonText`, `src/sim/engineInfo.ts:85-121`): "Detailed 3-D air: this phone takes about N ms per air step, so this run should compute in about M min (about X times real time). It can fall behind when you play faster than that; the timeline will say so." And for Fast: "Fast surface-wind model: the detailed air would take about M min on this phone, longer than the 10-minute limit. Switch in Settings, Performance, or Layers, Use the 3-D atmosphere."
- **No silent downgrade.** Confirmed in the code survey: mid-run tier changes happen only from the user's performance setting or "Use the 3-D atmosphere" (`simScreen.ts:847-853`, `layersPanel.ts:662-686`). A unit test pins that the tier never changes after the start decision, even with a clock that turns very slow mid-run.
- **High stays explicit** (Detail profile). `performanceProfile` mapping unchanged (Saver = fast, Balanced = auto, Detail = high; `src/ui/settings.ts:189`).

| Measured air step | Predicted compute for a 6 h run (`3.024 x ms`) | Old rule | New rule |
|---|---|---|---|
| 17.5 ms (this build machine) | 53 s | Detailed | Detailed |
| 41.1 ms (your phone, warm-up included) | 124 s | Fast (3.6 % over) | Detailed |
| 80 ms | 242 s | Fast | Detailed |
| 150 ms | 454 s | Fast | Detailed |
| 198 ms | 599 s | Fast | Detailed (cut-off) |
| 300 ms | 907 s | Fast | Fast |

The prediction is a rough guide, not a promise: on the build machine the whole engine for a big fire took 2-3.7x the atmosphere-only estimate, so large fires on slow phones will fall behind. That is exactly what the signal is for. The sheet therefore quotes **measured** speeds ("earlier in this run" vs "now"), never the start-time forecast.

Setup's "How this simulation works" preview stays honest: "Auto: decided when the run starts, from a short timing test on this phone."

### 6.3 What "slower than expected" means, and when we say so
Definitions (pure, in `src/ui/paceModel.ts`):
- **Wanted speed** W: the playback setting (simulated seconds per wall second). `Infinity` for Max: no signal.
- **Achieved speed**: clock movement per wall second while playing, over the last 10 s.
- **Waiting share**: the fraction of the last 10 s in which the clock was clamped at the newest snapshot (`viewTime >= headTime - 1 s`, the exact condition under which `advanceClock` refuses to move, `session.ts:99`).
- **Capacity**: the worker's windowed compute speed while busy (new `EngineInfo.perf.speed.s10`; the existing `workerSpeed` EMA is the fallback), and **duty** (share of wall time the worker is computing). A worker that is ahead goes idle: idle is not lag.
- **Buffer**: `(headTime - viewTime) / W` wall seconds already computed ahead (the worker looks ahead up to 30 minutes of fire).

States and hysteresis (constants in one `PACE` object, tuned in the spike):
- **`waiting`**: waiting share >= 15 % over 10 s, sustained 6 s. Leaves when the share stays under 5 % for 20 s.
- **`behind`** (early warning, before any stall): capacity < 90 % of W and duty >= 90 % for 10 s. Leaves when capacity >= 97 % of W or duty < 70 % for 10 s.
- **`ok`** otherwise. Nothing shows. A 15 s grace after play, seek or a speed change.

Always excluded (from the survey's gotchas): seeking and scrubbing, paused, app hidden (plus 5 s grace after returning; only `simScreen.ts:857-862` listens today, and it pauses), 3-D spin-up and `auto-pending` (looks like lag with the head at 0, `host.ts:112-115`), a tier switch re-spin, replay of history, the head moving backward (rewind or edit), Max speed. Never auto-change display step or solver step to "fix" lag: in the 3-D tiers that changes the trajectory (`cadence.test.ts:103-109`).

The legacy "Computing" badge (800 ms of waiting, `topBar.ts:157-168`) stays for seeks and stalls but is suppressed while the pace signal is active, so we never double-signal.

### 6.4 The timeline signal: where it sits
Constraints from the survey: the 64 px strip, the slider covering the strip, hit targets >= 44x44 with 12 px between 32 px controls (`docs/DESIGN.md:186-193`, `scripts/audit-tap-targets.mjs`), layout-audit free band >= 74 % (412x915) and >= 72 % (844x390) with about 20 px of slack, nothing pops up on its own (`DESIGN.md:33,434`).

| Candidate | What it is | For | Against |
|---|---|---|---|
| **T1 (default)** | A 44x44 button using the strip's 4th grid column, present only while `behind` or `waiting` (the column Cancel uses while seeking). 20 px gauge glyph; faint outline when `behind`, amber ring plus a 3 px amber line under the rail between thumb and head when `waiting` | Literally "on the timeline", a real target, precedent in Cancel | The track shrinks 284 to 240 px (412 wide) and tick labels re-thin while it is visible |
| T2 | Badge in the clock button's `.tb-state` slot ("Behind") that opens the time sheet with a new "Simulation speed" section; amber under-rail line for the eye | No layout shift, same slot as "Computing" and "Replay" | The tappable part is at the top, not on the timeline; the badge is not a separate 44 px target |
| T3 | Amber ring on the playhead thumb; a tap (no movement) on the thumb opens the sheet | No layout change at all | Not discoverable; non-standard affordance; needs a hidden focusable button for screen readers |

**Spike S1 (before building):** prototype all three behind a debug flag, run `scripts/audit-tap-targets.mjs` and `scripts/layout-budget.mjs`, screenshot at 412x915 and 844x390 in the four looks (light, dark, high contrast each), and pick on these criteria: target >= 44 px, strip height unchanged (so camera insets do not jump), slider taps not stolen, audits green, glyph <= 20 px, meaning not carried by colour alone, discoverable. T1 unless the spike says otherwise.

Anatomy and accessibility (any candidate): accessible name "Simulation is running slower than your playback speed. Show details." (`role=status`, polite, announced once on entering `waiting` and at most once every 2 minutes; never `role=alert`, no toast, no `.modal-scrim`, because the e2e popup watcher flags those); focusable; test id `pace-btn`; reduced-motion: no transition; high-contrast and forced-colour outlines. The sheet only opens on tap.

### 6.5 The details sheet
Built on `transportSheet()` + `createPopoverGroup()` (`src/ui/screens/sim/transportKit.ts:33,110`): dialog role, grab handle, title and Close, outside-tap scrim, one open at a time, Escape, focus in on open and back to the button on close, Back closes it first (`closeTopLayer`, `simScreen.ts:899-902`), `.tp-2col` on short landscape. Voice rules: plain words, "about" for numbers, sentence case (`src/ui/content.ts:1-5`).

Content (a pure `src/ui/paceSheetModel.ts` turns `PaceInfo`, `EngineInfo` and settings into rows, so every sentence is unit-tested):
```
Running slower than playback                                   [Close]
You asked for 60x (1 minute of fire every second). This phone is computing
about 38x right now, so playback waits for the simulation about 4 seconds in
every 10.

Does it change the result?   No. The same choices give the same fire at any
speed. It only takes longer to appear.

Where the time goes (last 10 s)
  3-D air flow     52 %   Fire spread     21 %
  Embers           12 %   Everything else 15 %        (bars)

Likely reasons                      (each shown only when the numbers support it)
  - The 3-D air flow is the heaviest part. The fast model skips it and is
    usually about three times faster, with less detail.
  - Slower than earlier in this run (55x in the first 2 minutes). The phone may
    be warm or in battery saver.
  - A big fire takes longer to compute; this eases as it burns out.

What you can do
  [Play at 30x]   [Use the fast model from here]
  Pausing lets the simulation get up to 30 minutes of fire ahead.

At this pace the end of the run is about 9 minutes away (6 at your speed).
All the numbers  >                       Measured on this phone, last 30 seconds.
```
- **`behind` wording:** "Computing about 38x; you asked for 60x. About 1 minute of fire is already computed; after that, playback will wait."
- **Actions:** "Play at N" sets the nearest preset at or below achieved speed (`speedModel.ts:4-8`); "Use the fast model from here" calls `setQuality('fast')` (existing path; the sheet notes "The fire from this moment on comes out a little different") and is hidden when already fast; Close. No "compute ahead" button: pausing already lets the worker look ahead.
- **Reasons logic:** air share of busy time > 40 % and tier is Standard or High; fire plus coupling > 40 %; speed now < 75 % of the median of the first four speed-history samples (throttling is only ever said as "may"); embers share > 25 %. If none applies the section is omitted.

### 6.6 Plumbing
- `src/ui/paceModel.ts` (pure tracker with 1-second bins over 30 s) is fed from the existing rAF loop in `SimSession.startLoop` (wanted `speed x dt` against actual advance, clamped frames) and from `EngineInfo.perf` (workstream A). It publishes `SessionState.pace: PaceInfo | null`. New session-state fields are safe; **no new `SimController` methods**.
- `src/ui/screens/sim/scrubber.ts` renders the button and the under-rail line from `session.state`; `transport.css` gets the 4th-column rules; `topBar.ts` registers the new popover in `createPopoverGroup` and gates the legacy badge.
- Episodes are written to the event log: start, end, slowest ratio, and the leading reason.
- A debug hook (`?debug` or DEV only) forces `pace` levels for screenshots and layout audits.

### 6.7 Files, tests, acceptance
New: `src/ui/paceModel.ts`, `src/ui/paceSheetModel.ts`, `src/ui/screens/sim/paceSheet.ts`, tests. Changed: `src/sim/params.ts`, `simulation.ts`, `engineInfo.ts`, `src/core/simTypes.ts` (`autoTune` fields), `src/ui/session.ts`, `scrubber.ts`, `topBar.ts`, `transport.css`, texts in `modelInfo.ts:532,535,854-865,957,986`, `setupModel.ts:334-342`, `setup.ts:539`, `datasetsModel.ts:458-472,497`, `memoryModel.ts:294`, `layersPanel.ts:673`, README (69, 512-514, 565-566), ARCHITECTURE (260, 313, 586-587, 671), spec `docs/research/00-synthesis.md` (2208-2224, 1673-1674, 2246-2253). The README and card sentence "most phones are expected to be too slow" is replaced with measured wording ("on the one phone measured so far, the 3-D step took 41 ms").

Tests to update because they pin the old policy: `src/sim/engineInfo.test.ts:211-228,250-254`, `src/ui/modelInfo.test.ts:168-170,223`, `src/ui/setupModel.test.ts:27-70` (exact `windHint` strings), `src/ui/screens/datasetsModel.test.ts:230-248`, `src/scenario/memoryModel.test.ts:68-93`, default `'auto'` in `build.test.ts:93,179` and `model.test.ts:46`; e2e `truth.spec.ts:39,51,70`, `model-card.spec.ts:163-189,242`, `robustness.spec.ts:1177-1206`, `app.spec.ts:233` (the determinism spec at `robustness.spec.ts:374-417` already forces Fast and stays).

New tests: `paceModel.test.ts` (fake clock: steady ok; capacity drop to `behind`; clamp episodes to `waiting`; hysteresis; every exclusion; Max speed; speed change mid-window; head moving backward), `paceSheetModel.test.ts` (strings for each scenario, rounding, no NaN, voice rules), auto-tune tests (warm-up skipped: slow first 10 steps then fast gives Detailed; median resists one outlier; ceiling arithmetic; "no downgrade after start"), and an e2e that plays at 3600x so the engine cannot keep up (the signal appears; the sheet shows the sections; "Play at 30x" clears it; no `role=alert`; layout and tap audits pass with the button visible).

**Acceptance:** on your phone, Auto reports Detailed with the measured step; at 600x or faster the button appears within about 20 s of play and the sheet's numbers match the debug statistics; it disappears after slowing down; results are bit-identical across playback speeds (hash test).

---

## 7. Workstream C: Air data foundation (0.4.0)

Makes the air data trustworthy and available on every tier, so slices and glyphs stand on solid ground. No new user-facing screen; it removes the near-ground bias, publishes the fast tier's 3-D wind, and adds honest capability flags.

### 7.1 Goals
1. Every tier publishes a 3-D wind that slices can sample (the fast tier as a **diagnosed** field).
2. Exact near-ground sampling: no zero contamination, no flat-level resampling loss.
3. Capability flags instead of `nz > 0` meaning "3-D air" in three places.
4. The air's own time travels with the data, so every picture can say "air from 14:05".

### 7.2 A terrain-following view (replaces the flat view and its zeros)
Today `Atmosphere.view()` resamples native fields onto flat levels with a binary-search lookup per cell and zeroes cells below terrain (`atmosphere.ts:1099-1116`). Instead the view ships the **native arrays** and lets the sampler do what the engine's own `sample()` does.
- New optional `AtmosphereView` fields (`src/core/types.ts:759-777`): `layout?: 'flat' | 'terrain-following'` (undefined means flat, so literal views in `render/devScenario.ts:766`, `render/misc.test.ts:31` and `ui/snapshotStore.test.ts:47` keep compiling), `kind?: 'prognostic' | 'diagnosed'` (undefined means `nz > 0 ? 'prognostic' : 'surface'`), `topM` (H'), `baseM` (the ASL datum, zMin) and `time` (simulation time the view was produced, stamped in `makeSnapshot`, `simulation.ts:1620`).
- In the terrain-following layout `levels` keeps the same numbers (they are already the model's zeta centres, `atmosphere.ts:1092`), `terrainHeight` is `h0`, and `u, v, w, thetaAnomaly, smoke` are copies of `uc, vc, wc, th, sm` (index `k x plane + column`). Height above the datum is `h0 + zeta x J` with `J = 1 - h0 / topM` (`grid.ts:11,279-285`). No extra arrays.
- **Sampler v2** (`src/render/atmosphereSampler.ts`, still pure and garbage-free): per column of the 4-column stencil compute `zeta = (zAsl - baseM - h0) / J`, clamp to the first and last level (below the first level it clamps to level 0, like the engine; above the top it returns the top level as today), binary-search the level, interpolate linearly in zeta, then blend the 4 columns bilinearly. This is the same arithmetic as the fast tier's `sampleBg` (`diagnosticWind.ts:176-223`) and the 3-D tier's `sample` (`atmosphere.ts:1030-1075`). The flat path stays for legacy views. Cost: 4 searches instead of 1 per sample; fine for 1300-2600 particles per frame [est: well under 1 ms].
- **Guards:** `airHas(view, 'wind' | 'theta' | 'smoke')` (array length), so an empty array never reaches an interpolation (today a fast-tier `theta()` or `smoke()` reads NaN). `SceneView.estimateAtmBase` (`SceneView.ts:562-576`) is replaced by `view.baseM` when present.
- **Consumers:** everything that samples goes through the sampler. The one direct reader is `smokeLayer.ts` (puff positions from cells above 2 % of max), which needs `cellHeightAsl(view, column, level)` for both layouts. A consumer audit is the first task of this workstream: grep `\.levels\b` and `atmosphere\.(u|v|w|thetaAnomaly|smoke)\b` in `src` (non-test) and list every reader before changing anything.
- `decimateView` (`simulation.ts:1943-1991`) and `snapshotTransferables` (`sim/host.ts:41-56`) list fields by hand: copy the new scalars and keep fresh arrays per call.

### 7.3 Publishing the fast tier's diagnosed wind
`DiagnosticWind.view()` (`diagnosticWind.ts:229-253`) returns `nz: 0` today. It will return the terrain-following layout with `u, v, w = (1 - a) x A.bg + a x B.bg` (the same stamp blend `sampleBg` uses, `wgt`), `thetaAnomaly` and `smoke` empty, `kind: 'diagnosed'`, `nz = grid nz`, `levels`, `topM`, `baseM`, `time`, and the existing `surfaceU/V`.
- **Cost [est, measured in the new perf test]:** about 0.5 ms per snapshot (3 x 40,500 blended floats, three 162 kB allocations); the terrain-following layout removes the 40,500-iteration binary-search resample the flat layout would have needed. Published on **every** emitted snapshot, so there is no lazy flag, no cadence trick and no new option plumbing. Memory: +486 kB per keyframe at 45 x 45 columns, about +35 MB over a 6 h run's 72 keyframes (`snapshotStore.ts:361-374`; `keyframeBytes` counts real byte lengths, so the 6 %-of-device-memory budget self-adjusts and thinning simply starts a little earlier).
- **What a diagnosed field is, and is not** (from the survey): the forecast profile fitted to the terrain by the mass-consistent solve, with stability weighting and the user's wind edits (edits reach only stamps at or after the edit time, Gaussian in radius, fading to zero by 300 m AGL, so they ramp in over the hour). It has **no** night-time decoupling, slope-flow top-up, lee-side blend, kappa scaling or fire indraft (those exist only in the fire-grid 2-D wind), no plume and no thermal winds. At night or in valleys a slice shows the forecast wind where the fire feels at most 30 % of it. Every slice and glyph on a diagnosed field says so.
- `memoryModel.ts:250` currently gives the fast tier `0` per level; it becomes `nz x 12` bytes per column (and the label at `:227` "only the surface wind is used" changes). `memoryModel.test.ts:36-62` only checks worker parts, so a new test compares `keyframeBytes` with the model for each tier.

### 7.4 Capability flags and gating
New pure helpers in `src/core/airView.ts`: `airKind`, `airLayout`, `airHas`, `hasAirWind`, `cellHeightAsl`. `has3dAtmosphere` becomes `airKind(view) === 'prognostic'` in all three places (`context.ts:112`, `layerCatalog.ts:929`, `layersModel.ts:244`); the **per-view** kind is preferred to `EngineInfo.atmosphere.kind` because composed history pictures carry the newest engine info (`snapshotStore.ts:99-101,301`).

| Feature | Needs | Behaviour on a diagnosed (fast) field |
|---|---|---|
| Air Slice (side view), speed, along-line, across-line, up/down chips | air wind | Available, labelled "diagnosed" |
| Temperature and smoke chips | prognostic | Disabled with the reason and the "Use the 3-D atmosphere" button |
| Wind streaks "Through the plume" | prognostic | Unavailable (its colour is updraft and the name says plume) |
| Wind speed heat map (bonus) | surface wind | Becomes available in the fast tier from `surfaceU/V` (a report-only item from earlier), labelled "10 m wind from the terrain fit" |
| Insight cards that need inversions or the plume | prognostic | Unchanged (`src/explain/rules/weather.ts:316,407`) |

Strings that must follow: `layerCatalog.ts:800-850,891` (availability and source text, the "3-D objects" group), `layersPanel.ts:196,662-686` (the need-3d callout: for the slice it becomes an info callout, "This section shows the diagnosed wind (terrain effects only). Use the 3-D atmosphere to see the plume, temperature and smoke."), `sheet.ts:414` (the "Wind model" row), `context.ts:108-111`, `legendGallery.ts:19-20`, the `diagnosticWind.ts:1-7` header, `modelInfo.ts` rows that read `kind` (`:346,802,826`), and the README / ARCHITECTURE / spec passages listed in 7.7.

### 7.5 Build order inside the workstream (each step green before the next)
1. Types, `airView.ts`, sampler v2 (flat and terrain-following paths) and the oracle tests. No behaviour change: flat stays the default.
2. The 3-D tier emits the terrain-following layout; consumers move over (audit list); existing tests and screenshot 05 compared.
3. The fast tier emits the diagnosed volume; gating helpers replace `nz > 0`; strings, memory model, catalog availability; e2e fixes.
4. Bonus: the wind speed heat map in the fast tier.

### 7.6 Tests
- **Oracle (the important one):** on a small synthetic DEM, run the real `Atmosphere` for a short spin-up and assert `sampler.wind(...)` on the published view equals the engine's own `atm.sample(...)` at random points above ground to 1e-3 m/s (same arithmetic, so differences are rounding). Same for `DiagnosticWind` including the stamp blend. A regression test shows the old flat view reads more than 30 % low at 30 m above a 700 m ridge and the new one does not.
- **Layout and flags:** view layout, `kind`, `airHas`, `cellHeightAsl`; `decimateView` with partially empty arrays; the transfer list (`client.test.ts:137` count); idempotence (two `view()` calls give identical bytes, and interleaved calls leave later hashes unchanged, since `view()` must stay pure, `simulation.ts:1244-1254`); a restored checkpoint gives bitwise-identical view arrays; wind edits visible in the diagnosed field only for stamps at or after the edit time.
- **Update:** `atmosphere/diagnosticWind.test.ts:237-238` (nz 0 becomes 20; it fails today), `e2e/app.spec.ts:231-243` and screenshot 05 (the e2e no longer needs the tier switch for the slice), `layersModel.test.ts:168-170`, `layerCatalog.test.ts:236-237,296-307`, `robustness.spec.ts:177-183`, `engineInfo.test.ts:62-66,190-197`, `snapshotStore.sim.test.ts` (fast tier, 6 h, 64 MB; ARCHITECTURE:520-521 numbers). Snapshot hashes compare run against run only (no golden constants found), so they stay valid if `view()` is deterministic; the e2e composed-hash checks (`robustness.spec.ts:339-371`) depend on keyframe thinning, which becomes slightly likelier, so they are re-run and re-baselined deliberately if needed.
- **Perf:** a `perf.test.ts`-style timing of `view()` per tier, recorded in the log like `[atmos perf]`.

### 7.7 Docs and strings to update
README 26-27, 76, 376, 497-510, 515, 517, 565; ARCHITECTURE 54, 99-116, 368 ("3-D view only"), 510-521, 661-672, 694-695; `docs/research/00-synthesis.md` 372, 418-421, 1667-1671 (section 8.9 "zero 3-D volume"), 2150; `src/ui/modelInfo.ts` 19, 187, 219, 514-515, 532-537, 555-556, 612-615, 741, 751, 957, 985-986.

---

## 8. Workstream D: Air Slice, side view (0.4.0)

A user-placed vertical cross-section of the air, on every tier, with a flat 2-D panel next to the existing 3-D curtain. Built on workstream C.

### 8.1 What the user gets
- A new tool, **Air slices** (Tools dock). Its **Side view** tab is this workstream; its **Map view** tab is workstream E (height chips and wind-glyph style).
- **Place the line anywhere:** "Set start (A)" shows the crosshair, you pan the map under it and tap "Place A here"; same for B. Or one tap on a preset: **Along the wind**, **Across the wind**, **Up the slope** (each through the fire, or the map centre if there is no fire yet) and **Me to fire** (only when the Setup GPS fix exists and lies in the model area; otherwise disabled with the reason). A and B can be moved again at any time; "Swap" flips left and right.
- **A flat side-view panel** (portrait, above the timeline):
  ```
  Air slice | Side view                                        [Close]
  +----------------------------------------------------------------+
  | 1500 m                                                         |
  |  height   field colours, flow streaks, terrain fill            |  about 230 px
  |   0 m  ___________________________________________            |
  |        A                    3 km                    B          |
  +----------------------------------------------------------------+
  [Speed] [Along] [Up/down] [Across] [Temp] [Smoke]      (chips)
  0 ----------------- 90 km/h                                (legend)
  [Set start A] [Set end B] [Swap] [Presets v]
  Diagnosed wind | model grid 133 m | air from 14:05
  ```
  In short landscape (844x390) the panel is the existing side column (388 px wide, about 180-230 px tall): the canvas stays pinned at the top, chips scroll horizontally, controls scroll inside the panel.
- **Colour chips:** Speed (horizontal wind), Along the line, Up/down, Across the line, Temperature (vs the area at that height), Smoke. Temperature and smoke are disabled on the fast tier with the reason and the "Use the 3-D atmosphere" button.
- **Flow streaks** in the plane (along-line wind and vertical motion) so rotors, lee eddies and the fire's indraft visibly move; static arrows under reduced motion.
- **Touch probe:** tap or drag on the panel for a readout chip (for example "Wind 32 km/h from the northwest, along the line 28 km/h, up 1.4 m/s, 60 m above ground, 3 K warmer than the area") and a pin on the map at that point. The canvas is keyboard-focusable and arrow keys move the probe.
- **Honest footer always visible:** kind ("3-D time-stepped" or "Diagnosed wind: terrain effects only"), model grid size, and "air from HH:MM" (with "N min before the time shown" when older than 90 s).
- **"Show model cells"** switch draws the real grid cells (nearest-neighbour), default off.
- The 3-D **curtain** stays in the scene and uses the same field chip.

### 8.2 State
- `LayerState.crossSection` (`src/render/layers.ts:59`) gains **nested** fields (so no new top-level key; `layerCatalog.test.ts:63` only fails on a new top-level key): `a?`, `b?` (local metres from the domain origin; when set they override `centre`/`azimuth`), `preset?: 'along' | 'across' | 'slope' | 'me' | null`, `field: SliceFieldId`. `azimuth`/`centre` stay so the existing "Show me" (`src/ui/showMe.ts:57-67`) and the compass controls keep working.
- Not render state (kept in the tool's own state): probe position, streaks, model cells, which tab, placement step. Not persisted: position belongs to one scenario (`layersPrefs.ts:8-9`), so `PERSISTED_LAYER_KEYS` and `LAYER_PREFS_VERSION` (bumping it wipes everyone's remembered layers) are untouched.
- Places to update for the new nested fields: `SceneView.applyLayers` field-by-field comparison (`SceneView.ts:650-653`), `setLayers` merge (`:605`), `src/ui/screens/sim/layersPanel.ts:688-724,755`, `showMe.ts:63-66`, `mapLegend.ts:31`, `simScreen.ts:107`, `layersPrefs.ts:109`, the 2-D mock (`src/ui/mockScene.ts:140,759-770`), and the exact-shape tests `layerCatalog.test.ts:339-340`, `layersModel.test.ts:93`, `review.test.ts:249`. New `SceneViewApi` methods are **optional** (like `viewSection?`, `api.ts:52`).
- **Line producers (pure):** `sectionFromEndpoints(a, b, grid)` (clip to the model rectangle, minimum length two model cells about 270 m, reversal) next to the existing `sectionLine(centre, azimuth)` (`atmosphereSampler.ts:185-209`); `resolveSlice(crossSection, ctx)` returns the effective `SectionLine` and resolves presets from live data (wind direction at the viewed time, fire centroid held by `SceneView` at `:552`, DEM aspect from `HeightField`, `ctx.user`).

### 8.3 Placement flow and where it plugs in
Chosen: **crosshair "Set A / Set B"**, not draggable handles (D6). The survey found: the wind tool already does tap or crosshair placement with a two-step confirm for wet screens and gloves (`simScreen.ts:668-690`, `editPanels.ts:37-49,329-349`, `pickCrosshair` at `simScreen.ts:142-145`); camera gestures stay enabled so one-finger pan moves the map under the crosshair; no 3-D object is tappable today, `projectToScreen` projects ground points only and returns null off-frustum, `pickGround` returns null at sky, a handle drag would need `setInteractionEnabled(false)` (and a second finger would then pan the camera under a dragged handle), and there is no precedent (`SceneView.ts:845-867`, `cameraRig.ts:277-281`, `panGesture.ts:100-110`). Handles stay a stretch goal (S1), with a >= 44 px hit radius in a `sceneHost` capture listener.
- **Tool registration:** a new `ToolId 'air'` needs the union (`src/ui/screens/sim/context.ts:11`), the factory map (`simScreen.ts:574`), the crosshair condition (`:584-585`, extended to "air tool and placing"), the `onTap` switch (`:674-689`; a map tap also sets the active point), and the Tools list entry (located in the first task). The panel is a factory `(ctx, onClose) => { el, destroy }` in `.panel-host` (`editPanels.ts:24-35`, `sim.css:1264-1283`, max height `min(52vh, ...)`).
- **Marks on the map:** the `.annotations` SVG (pointer-events none, re-projected per frame only while something is pending, `simScreen.ts:773-822`) gets kinds `sliceA`, `sliceB`, `slice` (line) and `probe`. It re-projects per frame only while the slice is shown.
- **Edge cases:** crosshair over sky or outside the model area disables "Place" with "Move the cross over the map"; line shorter than 300 m says "Make the line longer than 300 m"; a line crossing the edge is clipped with "Shown to the edge of the model area"; no fire yet says "No fire yet: centred on the map"; presets that cannot resolve say why.

### 8.4 Sampling (pure; `src/render/slice/`)
- `sampleSlice(sampler, heightField, spec, out?) -> SliceData`: columns `clamp(round(length / (0.5 x model spacing)), 48, 192)` (about 90 across 6 km), 48-56 rows linear in height from the lowest terrain on the line minus 50 m to `min(highest terrain + 2000 m, model top)`; fields `uAlong`, `uAcross`, `w`, `speed`, `theta`, `smoke` as `Float32Array`; `ground` (DEM) and `modelGround` per column; a validity mask (above the model's own ground and below the top); `kind`, `airTime`. Arrays are reused between updates.
- **Conventions (unit-tested):** `along = u dx + v dy` along A to B; `across = u dy - v dx`, positive to the **right** of A to B; vertical is `w`; speed is horizontal; wind direction is reported "from" with a compass word, like the rest of the app.
- **Temperature chip:** "warmer or cooler than the area average at that height" (subtract the per-level mean over valid cells), because the raw perturbation includes the night cold-pool template and the area-wide daytime warming the model relaxes over 1800 s. The legend changes from "Air temperature vs surroundings" accordingly (`legends.ts:701-712`). Prognostic only.
- **Terrain:** the panel draws the 10 m DEM as the filled silhouette and the model's smoothed terrain as a faint dashed line, so cliffs removed by the 35 degree smoothing are visible and explained in the caption.
- **Cost [est]:** about 90 x 50 x 6 fields of lookups, around 1 ms; updated on snapshot arrival (<= 6 per second while playing at 60x, throttled to >= 250 ms) and on line edits; the probe reads the stored arrays without resampling.
- A single `SliceUpdater` computes `SliceData` once per update for **both** the curtain and the panel (today the curtain samples theta and smoke itself, `crossSectionLayer.ts:148-149`).

### 8.5 The panel (Canvas 2D, `src/ui/screens/sim/slicePanel.ts`)
- Layers drawn: field raster (an `ImageData` of the slice, drawn smoothed, or nearest-neighbour with "Show model cells"), terrain fill and dashed model-terrain line, axes (height in metres above sea level every 500 m, distance in km or m; a pure `niceTicks`), flow streaks (pure `flow2d.ts`, about 300 particles advected through `uAlong` and `w x exaggeration`, 24 fps cap, paused when hidden, static arrow lattice under `prefersReducedMotion()` from `src/ui/dom.ts:153`; nothing in `src/render` checks it today, so the panel checks it itself), probe crosshair, legend.
- Reuse and conventions from `drawWeatherChart` (`src/ui/screens/sim/weatherChart.ts:57,92,104,112-120`): token colours via `getComputedStyle`, pixel ratio `min(3, devicePixelRatio)` with `setTransform`, a returned `xAt(clientX)` for the probe, and the tap-or-drag probe wiring with pointer capture and no touch-hover moves (`sheet.ts:383-389`). Canvas axis text no smaller than the weather chart's; chips and the readout are DOM text at >= 14 px.
- **Colour ramps:** speed uses `WIND_RAMP` (`palette.ts:400`, legend 0-90 km/h), up/down uses `UPDRAFT_RAMP`, temperature `THETA_RAMP`; along and across use a **new** diverging `ALONG_RAMP` (luminance-ordered, symmetric, added to `palette.ts` with a Machado colour-vision test; the existing `THETA_RAMP` and `UPDRAFT_RAMP` are not covered by `palette.test.ts:50-75` today and get covered at the same time). `crossSectionLegend` (`legends.ts:702`, temperature only) becomes `sliceLegend(field)`.
- **Vertical exaggeration** shares the existing x1-3 slider (`layersPanel.ts:732-742`).
- **Lazy loading (D10):** the panel, `sliceField`, `flow2d` and the tool panel load as one dynamic chunk on first use (pattern: `src/ui/modules.ts:76-84`); only the state, `sectionFromEndpoints` and the layer glue stay in the entry chunk [est 14-18 kB gzip for the chunk].

### 8.6 The curtain and the time shown
- `crossSectionLayer.ts` (128 x 48 lattice rebuilt on every update, `:73-74,172-195`) takes `SliceData` and the field chip instead of sampling theta and smoke itself; its arrows keep using `sampler.wind` (15 columns by heights 30-2200 m above ground, `:198-226`); the reverse-flow cyan rule (`:245`) stays for the prognostic tier.
- Air time: `view.time` (workstream C). Scrubbing back composes the keyframe at or before the time (up to 300 s older); the footer says so.
- **Time-lapse recorder (0.4.1, D7):** a `SliceRecorder` hooked into `Session.onSnapshot` (`session.ts:596`) keeps tiny Int16 slices of the pinned line (5 fields at 80 x 32 is about 25 KB per sample) at every display step within a 12 MB budget with thinning, tagged with `kind`. Rewinds and edits invalidate by time order: the five truncate sites (`session.ts:436,487,508,531,588`) are funnelled through one helper that the store and the recorder both use. Retroactive placement by replaying from a checkpoint is out of scope: checkpoints and the ring are private and a replay needs a second `Simulation` instance.

### 8.7 Files
New: `src/render/slice/sliceField.ts`, `sectionLine.ts` (endpoints, presets), `flow2d.ts`, `niceTicks.ts`; `src/ui/screens/sim/sliceTool.ts` (tool panel), `slicePanel.ts` (canvas), `sliceToolModel.ts` (pure state machine), `src/styles/slice.css` (<= 4 KB); tests for each.
Changed: `src/render/layers.ts`, `SceneView.ts`, `crossSectionLayer.ts`, `palette.ts`, `legends.ts`, `layerCatalog.ts`, `src/ui/screens/sim/context.ts`, `simScreen.ts`, `layersPanel.ts`, `showMe.ts`, `src/ui/icons.ts` (reuse `line`; add a path only if needed), `src/ui/mockScene.ts`, docs and the screenshot scripts.

### 8.8 Tests
- **Pure:** `sectionFromEndpoints` (clip, minimum length, reversal), preset geometry from fixtures; `sampleSlice` (uniform field gives a constant; linear shear is exact; the validity mask; the along and across sign conventions on a rotated line; units; the **oracle** that a slice sample equals the engine's native `sample()`); `niceTicks`; probe maths; ramp CVD and luminance; `flow2d` against analytic fields; the tool state machine (placing, preset availability, disabled reasons).
- **Draw functions** against a stub 2-D context: no throw, expected call counts, no NaN coordinates.
- **E2E (real engine, Pixel 7 profile, both tiers):** place A and B with the crosshair (real touch pan, then tap), presets, chips (temperature and smoke disabled on fast with the callout), probe readout changes on tap, model cells, landscape (844x390: canvas visible, controls scroll), reduced motion, Back / Escape / focus return; the existing gesture specs stay green (the tool must not break one-finger pan or the third-finger rule); `layers.spec.ts` for the curtain; screenshot 05 refreshed and new shots (portrait, landscape, fast-tier diagnosed).
- **Perf:** slice update <= 8 ms p95 at 4x CPU throttle; no allocation beyond the reused arrays (heap-flat leak test).

### 8.9 Acceptance
On your phone, on both tiers: a line placed in at most four taps (two with a preset); the speed at a ridge crest 30 m above the ground is plausible against the surface wind; the slice follows playback; footer labels are right; frame rate in the debug statistics shows no new jank.

---

## 9. Workstream E: Horizontal wind slice and zoom-adaptive wind glyphs (0.5.0)

A plan-view slice of the wind at a chosen height, drawn with indicators that get more detailed as you zoom: straight arrows far away, denser arrows closer, curved streamlines up close. Built on workstream C. Stages: **E1** glyph engine, height control and Map view on the atmosphere data; **E1b** optional speed colouring of the map; **E2** the optional 60 m "wind the fire feels" raster.

### 9.1 Why the current wind layer cannot do this
Wind particles are seeded uniformly over the **whole domain** (1300 surface / 2600 volume, `src/render/windLayer.ts:67,89-91`), so zooming in shows the same few; there is no integrator or streamline code anywhere in `src/render` or `src/ui`; the arrows are a fixed 9 x 9 lattice over the whole domain with no UI switch (`windLayer.ts:186-243`, only `?arrows=1` or `SceneView.setWindArrows`, `SceneView.ts:658`); and `animating` is true whenever wind is on, so the scene redraws continuously (`SceneView.ts:1112`).

### 9.2 What the user gets
- **Layers, Wind and air:** a switch **"Arrows and flow lines"** and, when on, a **Wind height** row: *What the fire feels* (default), 10 m, 50 m, 100 m, 300 m, 1 km, 2 km above ground. The same controls appear in the **Air slices** tool's **Map view** tab. The existing "Wind streaks" control is unchanged. The new layer is opt-in in 0.5.0 (D9).
- **Detail follows zoom** (the ladder below), measured by how many screen pixels one model cell covers (`cellPx = model cell metres / metres per pixel at the screen centre`), with +/-15 % hysteresis so levels do not flicker:

| Level | One model cell on screen | What is drawn | Seeds | Data |
|---|---|---|---|---|
| L0 | under 4 px | no glyphs (the speed heat map still works) | none | none |
| L1 | 4-12 px | straight arrows | lattice about 56 px apart (every 5-14 cells), length proportional to speed, at most 0.8 of the spacing | wind at the chosen height |
| L2 | 12-32 px | straight arrows, denser | about 40 px | same |
| L3 | 32-90 px | **curved streamlets** with arrowheads, 6-10 segments, 28-56 px long (longer when faster) | jittered lattice about 36 px | same field, traced through it |
| L4 | over 90 px | **longer flow lines** (90-140 px), optional moving dots | about 56 px | the 60 m "wind the fire feels" raster at the surface height (E2), else the same field |

  With a 133 m model cell on a 412 px wide screen, curves begin at about 1.7 km across the screen and long flow lines at about 600 m [est from the formula].
- **Truth in captions.** The legend line names the source and the model grid: "Wind at 100 m above the ground | model grid 133 m | wind from 14:05". When one model cell covers more than 60 px and the source is the atmosphere field it adds: "Closer than this the curves are a smooth fit through the model, not new detail." The "wind the fire feels" source says "60 m, includes slope and lee effects".
- **Glyphs are static** unless "Moving dots" is on and reduced motion is off. A real legend (km/h) is shown for the glyphs; today `windLegend()` has no production caller (`legends.ts:715`), so streaks and arrows have none.

### 9.3 The glyph engine (pure, `src/render/wind/flowGlyphs.ts`, shares `flow2d.ts` with workstream D)
- **LOD planner:** `planLod(cellPx, previous)` with hysteresis.
- **Seeds are anchored to a world lattice** at power-of-two spacings per level and then culled to the view, so panning never reshuffles them and zooming changes spacing in steps; jitter comes from an integer hash of lattice indices, never `Math.random` (the private `Lcg` in `windLayer.ts:20` is not reused as is). Level changes cross-fade over 250 ms.
- **Visible region:** top view: ground footprint from `pickGround` at the corners; orbit view: ground points from rays at the corners and edge midpoints (`SceneView.ts:845-859`), rays that miss terrain (sky) skipped, bounding box plus 25 % margin.
- **Tracing:** RK2 midpoint through the 2-D field at the chosen height, arc-length parameterised; calm cells (under 0.3 m/s) draw a dot; tracing stops at the domain edge. Screen-constant length: world step = `lengthPx x metresPerPixelAtSeed / segments`, where metres per pixel at the seed is `distance(camera, seed) x uPixelMetres` (`SceneView.ts:1156`); orbit-view glyphs therefore keep their pixel size with depth. Length in pixels is `clamp(4 px per m/s x speed, 8, max)`, capped in **screen pixels** because the existing trails are 16.5 s long (165 m at 10 m/s), longer than a screen at close zoom.
- **Output** is flat `Float32Array`s for the renderer; caps by quality tier 600 / 1200 / 2000 glyphs, at most 12 segments each.
- **Field access:** `windAt(x, y)` over the sampler at the chosen height above the render DEM: `zAsl = DEM(x, y) + h` through sampler v2 (exact near the ground, workstream C), or bilinear over the fire-felt raster.

### 9.4 Rendering and camera
- **Two `StreakBatch` instances** (halo underlay plus colour; `src/render/streaks.ts`: one instanced quad per segment, constant pixel width, optional head `uHeadPx`, fixed capacity, `commit(n)` without allocation, `:122-165`): +2 draw calls. Alpha stays 1 (segments overlap about 1 px, so translucency would darken the joins). Segments with an endpoint behind the near plane are dropped whole (`:24-27`), so the generator clips polylines at the near plane first. Widths are baked per batch and rebuilt on pixel-ratio change (`SceneView.ts:1183`).
- **Lift above ground** is `max(1.5 m, 3 px x metres per pixel)` times the vertical exaggeration (world y = z x exaggeration), so glyphs never float visibly at close zoom (the old arrows sit 30 m up).
- **Rebuild rules:** on a new snapshot, on a level change, when the camera moves by more than `max(12 m, 10 % of distance)` or the view leaves the built region (the `vegetationLayer.updateLod` threshold, `:393`), and on height or style change; throttled to >= 250 ms with a pose signature in preallocated arrays (the `placesLayer.ts:542-574` pattern, the closest precedent for screen-area seeding), staged so no frame exceeds about 8 ms of rebuild work. The layer must **not** switch `animating` on (`SceneView.ts:1112`).
- **No camera-change callback exists** (`cameraState()` is poll-only, `cameraRig.ts:624`; the frame loop detects motion by pose delta, `SceneView.ts:1084-1088`), so the layer lives inside the frame loop like the labels do. `CameraRig.metresPerPixel()` is private (`cameraRig.ts:288`); the plan exposes it (or the seed-local formula above) without changing gestures.
- This layer **replaces `WindArrows`** (dev-only, fixed lattice) so there is one arrow system; `?arrows=1` maps to it.

### 9.5 Height, data and honesty
- **Heights** are metres above ground relative to the render DEM; sampled with sampler v2, which is exact on the model's terrain-following grid (this removes the near-ground bias that would make 10, 50 and 100 m slices read low over ridges).
- **Draped, not floating (D8):** glyphs are drawn on the map at the chosen height's wind, with the height named in the caption; in plan view the vertical position carries no information. True-height floating glyphs in orbit view are a later stretch.
- **Fast tier:** 10 m and above use the diagnosed field (labelled); "What the fire feels" uses the fire-felt raster once E2 ships and `surfaceU/V` (the 10 m open-equivalent wind) until then.
- **Staleness:** the field is frozen between snapshots (about 6 per second while playing at 60x), so shapes change in small steps; scrubbed pictures use the keyframe air (up to 300 s old), stated in the legend ("wind from 14:05").
- **E1b (optional): colour the map by speed** at the chosen height: a new `OverlayKind` in `OVERLAY_KIND_SET` (`layerCatalog.ts:201`) drawn through the single R32F overlay texture (`terrainLayer.ts:57-120,669-683`; one heat map at a time and the solo-heat rule hides imagery and canopy by design), with a km/h legend.

### 9.6 E2: the 60 m "wind the fire feels" raster (D11)
- **What it is:** the fire-grid wind `env.windU/V` (`surfaceWindForFire`, `src/atmosphere/base.ts:670-776`) is the atmosphere field interpolated at >= 50 m plus kappa scaling, the sub-grid slope-flow top-up (cap 3 m/s), the lee blend and (fast tier) the pyrogenic indraft with its head correction. It is what drives the fire, and it has real structure finer than the 100-270 m atmosphere columns, but it is **not** a resolved 30 m flow, so close-zoom curvature is only partly new information (the captions say so).
- **Publication:** copy `env.windU/V` in `makeSnapshot` (`simulation.ts:1612-1619`) as `layers.fireWindU` and `fireWindV`, **Int16 at 0.01 m/s, decimated to about 60 m** (every 2nd cell at 30 m, every 3rd at 20 m). It is a pure read of persistent arrays; **never call `surfaceWindForFire` there** (it mutates `slopeFlow`, `uRidgeMedian` and `fireInfluence`, `base.ts:712-761`, checkpointed at `:985,1033`). `snapshotTransferables` moves every `layers` value automatically (`host.ts:54`).
- **Cost [est]:** 40 kB per snapshot for a 6 km area at 30 m up to 160 kB for 12 km; kept in keyframes plus the newest (`snapshotStore.ts:299,370,522`), so about +2.9 to +11.5 MB over a 6 h run (Float32 at 30 m would be 4-8x that). The fast tier recomputes this wind only every 60 s (`src/sim/params.ts:30`), so short display steps repeat values; harmless.
- **Determinism:** `hash.ts:40` hashes every `layers.<key>`, so snapshot hashes change but stay run-for-run identical. A test asserts that publishing does not perturb later results.
- Can be cut or postponed without breaking E1.

### 9.7 UI and catalog wiring
- Two new **flat** layer keys: `windGlyphs: 'off' | 'on'` and `windHeight: 'fire' | 10 | 50 | 100 | 300 | 1000 | 2000`. They must be classified in `LAYER_STATE_ROLE` (`layerCatalog.ts:169`, compile-time complete), added to `PERSISTED_LAYER_KEYS` (`layersPrefs.ts:24`, `satisfies`) with a sanitizer branch (`:63-98`); additive keys keep `LAYER_PREFS_VERSION` at 1 so nobody's remembered layers are wiped.
- Layers panel: one `toggle` and one chip row in "Wind and air" (+4-6 DOM nodes against 86 of headroom). The existing three-option `wind-layer` control stays as it is (`robustness.spec.ts:231` picks one of options 0-2).
- Catalog entry with honest availability and source strings (`layerCatalog.ts:819-850` neighbours).

### 9.8 Budgets
| Item | Budget | Note |
|---|---|---|
| Draw calls | +2 (all layers 19 to 21, high 20 to 22; limit 25) | `ARCHITECTURE.md:697-699` |
| Triangles | <= 48k (2000 glyphs x 12 segments x 2) | high tier 495k + 48k = 543k of 550k: the layer trims its own cap from `renderer.info` so the limit is never crossed |
| Rebuild | <= 8 ms p95 (<= 32 ms at 4x CPU throttle), >= 250 ms apart while moving | main thread already about 22 ms per drawn frame |
| GPU buffers | about 1.2 MB | fixed at construction |
| Memory (E2) | about +3 to +12 MB per 6 h run | shown in the debug statistics |

### 9.9 Tests and acceptance
- **Pure:** LOD thresholds and hysteresis; **pan invariance** (the same world seeds appear after a pan); determinism (same inputs, same arrays; no `Math.random`); tracing against analytic fields (uniform stays straight with curvature under 1e-6, solid-body rotation recovers the radius within 1 %, a saddle bends correctly); arc-length constancy; near-plane clipping; length rules; arrowhead direction; L1 and L2 glyphs are straight while L3 and L4 glyphs curve in a rotating field.
- **E2 data:** Int16 error <= 0.005 m/s, decimation index maths, hash determinism, per-keyframe bytes against the memory model, and the pure-read guarantee (calling `makeSnapshot` does not change a later run's hash).
- **E2E:** a real pinch zoom (CDP touch, the `Hand` helper that is duplicated in `gestures.spec.ts:130-155` and `gestures-edge.spec.ts:79-102` is first moved into `helpers.ts`) with a debug stats hook `view.stats().windGlyphs = { level, count }` to assert level changes at the expected zooms; screenshots at three zooms and two heights; draw-call and triangle budget checks; reduced motion; Layers-panel DOM <= 1000 nodes; `robustness.spec.ts` random layer toggles include the new switch.
- **Acceptance on your phone:** zoom from the whole area to a ridge and watch arrows, then denser arrows, then curved streamlines, then long flow lines; height chips change the picture; captions are truthful; frame stats show no new jank; memory in the debug statistics stays inside its cap.

---

## 9b. Workstream F: Night map lighting (0.3.0)

Small and independent: it can ship first, even alone. It sits after E only to keep the other section numbers stable.

I read "day night terrain modifier" as the automatic day/night lighting of the 3-D map: after dark the ground, photo, trees and roads are dimmed and tinted blue, so relief is hard to read. Tell me if you meant something else.

### 9b.1 What the user gets
- **Layers, Map type, Night lighting:** three choices, **Realistic** (today's look, the default), **Brighter** and **Daylight**. Brighter and Daylight light the ground (photo, terrain colours or plain), trees, roads and labels after dark from a fixed north-west sun, so slopes show their shape. The sky, stars, the fire's glow, lit windows and the fire light on smoke still follow the clock. By day nothing changes.
- It applies instantly (uniform updates only: no rebuild, no pause), is remembered between runs, and "Reset layers" returns it to Realistic.

### 9b.2 Why the terrain is hard to read at night today
`skyLighting` (`src/render/sky.ts:39-48`) has no direct sun below about -3 degrees (sun intensity 0) and an ambient of 0.27-0.32 against 0.5 at noon, tinted dark blue, with exposure raised by up to 60 % (`:100`). The terrain shader's direct-sun term (`src/render/terrainLayer.ts:204-206`) therefore vanishes and only the dim ambient with the baked relief term is left; the aerial photo is scaled by a reference light that follows the same dim ambient (`:212-218`). The darkness is deliberate (the header says "dark enough that a night fire's glow dominates the scene, which is exactly when trainees most often misjudge it", `sky.ts:3-4`), which is why Realistic stays the default (D13).

### 9b.3 Design
- **A view setting, like the Plain map type** (not a `LayerState` key): `SceneViewApi.setNightLook?(look)` and `readonly nightLook?` next to `setPlainGround?` (`src/render/api.ts:101-103`); persisted as `LayerPrefs.nightLook?` with a sanitizer branch (`src/ui/screens/sim/layersPrefs.ts:54,91`), saved through `rememberLayerChoice` (`:162-171`), restored in `restoreLayerPrefs` (`:232`) and reset in the panel's reset action (`layersPanel.ts:759`). Nothing changes in `LAYER_STATE_ROLE`, no exact-shape test changes, and `LAYER_PREFS_VERSION` stays 1. The row is hidden when the view has no such method (the 2-D mock), exactly as `canPlain` does (`layersPanel.ts:186-188`).
- **Lighting maths (pure, `src/render/sky.ts`):** `mapLighting(real, look, sunElevation)`. The weight is `w = m x smoothstep(8 deg, -2 deg, elevation)` with `m = 0, 0.55, 1` for Realistic, Brighter, Daylight, so with the sun above about 8 degrees nothing changes and the effect fades in through dusk. The target is `skyLighting(40 deg)` (no cloud or smoke, because visibility is the goal) from a fixed cartographic sun direction (north-west, azimuth 315 degrees, 40 degrees up). Sun direction (blended as vectors and renormalised), sun colour and intensity, sky and ground ambient, ambient intensity and exposure are the real values blended toward the target by `w` in linear colour. With `m = 0` the output is bit-identical to today (test).
- **Uniform plumbing (`SceneView.applyLighting`, `SceneView.ts:1013-1042`):** the shared uniforms the map shaders already read now carry the **map lighting**; `uNight` stays the **real** night. A new `uMapNight = real night x (1 - w)` serves the sites that dim the map. The sky dome gets its **own** sun direction, colour, intensity and exposure from the real lighting (as it already has its own zenith and horizon), so a bright map never paints a sun disc into a night sky or changes the sky's brightness. `sunKey` is invalidated so a change applies at once, as `setStartTime` does (`:989-996`).
- **Shader audit and classification** (from a grep of `uNight`, `uExposure`, `uSunI` and `uAmbI` in `src/render`):

| Use | Sites | After the change |
|---|---|---|
| Map lighting (sun, ambient, exposure) | `terrainLayer.ts:62-63,204-218,383-397` (ground and photo); `treeShaders.ts:269-272,397-401`; `placesLayer.ts:296-309`; `smokeLayer.ts:60,78`; `glsl.ts:42-57`; `streaks.ts:132`, `crossSectionLayer.ts:81`, `fireLayer.ts:133` (exposure only) | Follow the blended map lighting; no shader change, they read the shared uniforms |
| Dimming at night | `placesLayer.ts:226-227` (roads dim and cool), `:309` (ambient floor), `:352` (labels); `treeShaders.ts:409` (moonlight add) | Read `uMapNight` (added to the shared lists at `vegetationLayer.ts:127-131,514` and `placesLayer.ts:440`) |
| Emissive and atmosphere | `skyDome.ts:40-44` (sun disc, stars); `fireLayer.ts:91` (flame gain); `smokeLayer.ts:80` (fire light on smoke); `placesLayer.ts:313` (lit windows); `terrainLayer.ts:226` (zone glow); `SceneView.ts:1034` (`uGlowGain`) | Unchanged, real night |

  The sky dome reads the shared sun and exposure uniforms today (`skyDome.ts:24-25,68-70`), so it is the one consumer that must move to its own.
- **Shadows:** terrain cast shadows keep following the real sun (`updateShadows`, `SceneView.ts:1049-1054`, off below 0.5 degrees), so at night relief comes from the fixed-direction light and the baked relief term, not from invented shadows, and there is no extra cost on phones.
- **Fog and fire:** the real dark fog colour stays so the horizon matches the dark sky, with fog density reduced by `w` so distant ridges are not swallowed; flames, embers and smoke keep their night glow gain. Both are tuned in **spike S4** (section 10), which also checks that the fire still stands out in Daylight, since judging fires at night is a training point.

### 9b.4 UI
In the Layers panel's **Map type** section (`layersPanel.ts:272-325`), below the tile grid: a `segmented` control "Night lighting" with Realistic, Brighter and Daylight (test id `night-look`) and the hint "Realistic follows the clock. Brighter and Daylight light the ground, trees and roads after dark so terrain detail stays readable. The sky, stars and the fire's glow still follow the clock." About +12 DOM nodes against 86 spare; no CSS.

### 9b.5 Files, tests, acceptance
- **Files:** `src/render/sky.ts` (+ test), `SceneView.ts`, `api.ts`, `treeShaders.ts`, `vegetationLayer.ts`, `placesLayer.ts`, `skyDome.ts`, `src/ui/screens/sim/layersPanel.ts`, `layersPrefs.ts`, docs.
- **Pure tests:** `mapLighting`: `m = 0` equals `skyLighting` for a sweep of elevations, cloud and smoke values; every look is identical when the elevation is 8 degrees or more; `m = 1` at night equals the target; continuous and monotone through dusk; direction normalised; the `uMapNight` and real-night relationships. `sanitizeLayerPrefs`: valid and invalid `nightLook`, version stays 1, unknown keys ignored. The panel row model.
- **E2E (real engine, night through the `setStartTime` debug path; `src/render/dev.ts:15` already has a night start for the dev page):** switch looks and assert, from screenshots decoded with `fast-png`, that the mean luminance of a ground region rises Realistic < Brighter < Daylight by a margin, a sky region does not change, and no sun disc appears; a reload keeps the choice; Reset returns to Realistic; no console errors; draw-call and triangle counts unchanged. Screenshots: night Realistic and night Daylight.
- **Acceptance on your phone:** at night, Layers, Map type, Night lighting, Daylight: relief, trees and roads read as by day; the sky stays dark with stars; the fire still glows; switching back restores; it is remembered next run.
- **Size:** S.

---

## 10. Releases, order and how the build would run

Sizes are relative single-builder effort: S under a day, M one to two days, L three to five days. With parallel agents the wall time is shorter.

| Release | Contents | Size | Done when |
|---|---|---|---|
| **M0 (before 0.3.0)** | Contracts commit (types only: `EngineInfo.perf`, `autoTune` fields, `SessionState.pace`, optional `AtmosphereView` fields, `airView.ts` helpers) so lanes can build in parallel; **spike S1** timeline signal placement (6.4); **spike S2** bundle baseline and trim candidates (dev-only code in the production bundle, dead code); **spike S3** a node micro-benchmark of the glyph generator (2000 glyphs x 10 segments through the sampler) to check the 8 ms estimate before workstream E is committed to; **spike S4** the night-lighting look tuned on the real renderer with screenshots (9b.3) | S | Spike notes committed; decisions D3 and D10 informed |
| **0.3.0** (versionCode 6) | **F** night map lighting + **A** debug statistics + **B** honest speed | S + M + M | Section 12 gates green; phone check-list 1 |
| **0.3.1** (optional) | Speed test button | S | Frozen kernels and CI reference |
| **0.4.0** (versionCode 7) | **C** air data foundation + **D** Air Slice side view | L + L | Gates green; oracle tests pass; phone check-list 2 |
| **0.4.1** (optional) | Time-lapse recorder for a pinned line | M | Memory within its 12 MB budget |
| **0.5.0** (versionCode 8) | **E1** glyph engine, height, Map view; **E1b** map colouring (optional); **E2** fire-felt raster (optional) | L (+ M for E2) | Gates green; phone check-list 3 |

**Dependencies:** B needs A's `EngineInfo.perf` (contract only, so they overlap); D needs C; E1 needs C; E2 is independent of E1 at the data level.

**If you say "use a workflow"** each release runs like 0.2.0 to 0.2.2: a Build phase with lanes in parallel and clear file ownership, an independent Verify phase (a different agent per lane, re-measuring on the real app), a Fix loop, then Release (version bump in `package.json`, `package-lock.json` and `android/app/build.gradle`; `npm run build:cap`; `npx cap sync android`; debug APK; screenshots; docs; commit and push; APK handed to you).
- **0.3.0 lanes:** (1) worker and engine: `perfStats`, `simTypes`, `simulation`/`engineInfo`, auto-tune policy and its tests; (2) debug-statistics UI: screen, `deviceInfo`, `eventLog`, the three entry rows, `modelInfo` summary; (3) pace: `paceModel`, `paceSheet`, scrubber, top bar, transport CSS, session; (4) docs and e2e updates; (5) night lighting: `sky.ts` maths, uniforms, the shader sites and the Layers row (small and independent, so it can ship first). Lanes 2 and 3 start from the M0 contracts.
- **0.4.0 lanes:** (1) data first: sampler v2, layouts, flags, memory model, oracle tests (everything else waits for its tests to pass); then in parallel (2) slice model, panel and tool, (3) curtain refactor, gating and strings, (4) docs.
- **0.5.0 lanes:** (1) pure glyph engine and tests, (2) rendering, camera and layer wiring, (3) E2 data and memory, (4) UI and docs.

## 11. Budgets

**Bundle** (`scripts/check-bundle.mjs`, measured on `dist/` at HEAD with `gzip -9`: all JS 953.8 kB of 1000, entry 184 of 195, CSS 122.2 kB of 135 raw). The all-JS figure counts every `assets/*.js` including lazy chunks and the worker, so code splitting protects the entry budget but does not lower the total.

| Workstream | Estimated gzip added | Where it lives |
|---|---|---|
| A debug statistics | 6-8 kB | lazy chunk (screen, pure content, device info); about 1 kB of glue in the entry |
| B honest speed | 4-5 kB | pace model and scrubber glue in the entry (about 3 kB); the sheet is lazy |
| C air data | about 3 kB | entry (sampler) |
| D Air Slice | 14-18 kB | lazy chunk |
| E glyphs | 10-14 kB | lazy chunk |
| F night lighting | about 1 kB | entry (`sky.ts` maths, panel row) |
| **Total** | **38-49 kB** | against **46 kB** of headroom |

Running total after each release [est]: about 966 kB, 986 kB, 998 kB. This is at the limit, so: lazy-load everything heavy, run the trim pass (spike S2), and **decide at the end of 0.4.0 with real numbers** whether to raise the all-JS budget (D10); I will ask you before changing a budget. Entry chunk additions are kept under about 5 kB. CSS: A 2 kB + B 1 kB + D 4 kB + E 2 kB = 9 kB against 12.8 kB. Layers-panel DOM: +6 nodes from E and about +12 from F, against 86 spare. Demo data and APK size are unaffected.

**Memory** (6 h run, per the survey's keyframe maths; the history store cap is 6 % of device memory, 48-168 MB):

| Item | Added | Notes |
|---|---|---|
| Fast-tier diagnosed volume | +0.49 MB per keyframe, about +35 MB | thinning starts earlier on small phones |
| Fire-felt raster (E2) | +3 to +12 MB | Int16, 60 m |
| Recorder (0.4.1) | <= 12 MB | thinned |
| Debug statistics | < 16 KB worker, < 60 KB main | |

The debug statistics screen shows frames kept, thinned frames and the heap, so the real effect on your phone is visible in one copy.

**CPU:** slice update <= 8 ms p95; glyph rebuild <= 8 ms and >= 250 ms apart while moving; pace model O(1) per frame; always-on statistics < 1 % of step time. **Render:** section 9.8.

## 12. Verification and phone check-lists

**Per change (fast loop):** `npx tsc --noEmit -p .`, `npm run test:fast` (`FIRESIM_SKIP_SLOW=1` skips only `validation.test.ts` and `session.insights.sim.test.ts`), the e2e spec for the area by file name. **Per release:** full `npm test` and, because the tier policy and views change, the slow suites with `SLOW=1` (V6, V7, V20, V21 and the standard variants); the full e2e suite; `npm run check:bundle` on a `build:cap` build; `npm run check:contrast` (four looks); `scripts/audit-tap-targets.mjs` and `scripts/layout-budget.mjs`; the heap-flat leak test; the network audit; regenerated screenshots (`docs/screenshots`, 55 today). New specs pin their tier explicitly; the determinism spec keeps forcing Fast.

**Phone check-list 1 (0.3.0):**
1. Menu: "Simulation debug statistics" sits directly under Settings. Open it, tap Copy, paste into a message to me.
2. Start a run in Auto: the tier line says Detailed with the measured step and the minutes it should take.
3. Set playback to 600x or faster: within about 20 s a small amber button appears at the right end of the timeline; tap it, read the sheet; tap "Play at 30x" and watch it fade.
4. After about 5 minutes of play, copy the statistics again (speed history, where the time went, memory, frame rate, events).
5. At night (start a scenario in the evening, or scrub past dusk): Layers, Map type, Night lighting. Try Brighter and Daylight: the terrain, trees and roads should read as by day while the sky stays dark and the fire still glows. Reopen the app and check the choice is remembered.

**Phone check-list 2 (0.4.0):** on both tiers, place a line with the crosshair and with a preset, read the probe at a ridge crest, switch chips, rotate to landscape, compare with the old curtain, scrub back and read "air from"; copy the statistics (memory, frames, thinned frames).

**Phone check-list 3 (0.5.0):** zoom from the whole area to a ridge and watch the ladder; try each height; check the captions; copy the statistics (frame rate, memory).

## 13. Docs, help and screenshots
README (feature list, "Controls", the transparency and performance sections, the numbers at 497-517 and 565-566), `docs/ARCHITECTURE.md` (new modules, `EngineInfo.perf`, the view layout and kinds, the pace model, budgets at 661-701), `docs/DESIGN.md` (timeline signal, slice panel, glyph legend, screens table at 412-418), `docs/research/00-synthesis.md` mentions listed in 6.7 and 7.7, Help and Glossary entries (Night lighting, Air slice, Diagnosed wind, Flow lines, Why is it slow?, Simulation debug statistics), the model card strings, release notes. Screenshots: refresh 05, add the debug statistics screen, the pace sheet, the night look (Realistic and Daylight), the slice panel (portrait, landscape, fast-tier diagnosed), the glyph zoom triplet.

## 14. Risk register

| Risk | Mitigation |
|---|---|
| The terrain-following view touches many consumers | Consumer audit first; sampler v2 keeps the flat path; oracle tests against the engine's own `sample()`; staged build order (7.5) |
| Bundle budget | Lazy chunks, trim spike, decision with measured numbers; I ask before changing a budget |
| Timeline layout shift or tap-target audit failure | Spike S1 with three candidates and explicit criteria; fallbacks T2 and T3 |
| More phones run Detailed (heat, battery, longer waits) | The signal and sheet; "Use the fast model from here"; Saver profile; event log and speed history; check on your phone |
| WebView hides the phone model (reduced user agent) | Client Hints; raw user agent always printed; "hidden by the WebView" wording; D5 |
| e2e specs branch on whichever tier the machine picks | New specs pin the tier; the determinism spec stays Fast; branching specs updated |
| Hash and regression tests | They compare run with run (no golden constants); thinning-dependent composed-hash checks re-run and re-baselined deliberately |
| Memory growth on small phones | Measured via the statistics screen; Int16 at 60 m; recorder lazy and budgeted; thinning is graceful |
| Glyph cost on a phone is unmeasured | Spike S3, per-tier glyph caps, self-trim from `renderer.info`, fallback to straight arrows |
| A diagnosed slice mistaken for the fire's wind | Labelled on every slice, glyph and legend; the callout; night and valley caveat spelled out |
| Close-zoom curves read as more accurate than they are | Captions say "smooth fit through the model" or name the 60 m raster |
| Policy change alters results on phones that used Fast | Release notes and the reason line say so; users can pick Fast; results stay deterministic per tier |
| Clipboard refused by the WebView | Selectable-text fallback (tested) |
| `performance.memory`, long-task or battery APIs missing | Rows say "not available"; tested with stubs |
| Narrow phones (360 px) | Panel and sheet also checked at 360x640 |
| Test-suite runtime growth | New logic is pure and fast; slow suites stay gated |
| Night lighting touches shared uniforms and shaders used by the ground, trees, roads, smoke and the sky | Pure blending maths with a "Realistic is bit-identical to today" test; the shader audit table (9b.3); the sky dome moves to its own uniforms; e2e luminance checks; spike S4 for the look |

## 15. Later (deliberately not in this plan)
GPU or WebGPU solver and finer time-stepped grids; a finer diagnosed terrain-wind solve (65-100 m, hourly, so CPU-affordable) for the fast tier, which changes the wind the fire feels and needs re-validation; true-height floating glyphs in orbit view; draggable slice handles; retroactive worker-side replay for slices; several slices at once; wind and temperature profile at a point and a time-height diagram; an Android "Share to FireSim" target; a one-finger-rotate option; saving statistics to a file.

## 16. What I need from you
1. Confirm or change **D2** (Auto ceiling), **D3** (timeline button, which the spike confirms), **D6** (crosshair placement first), **D7** (recorder later), **D9** (glyph layer opt-in), **D10** (bundle approach), **D13** (night lighting default Realistic) and **D14** (night lighting with 0.3.0, or alone first as 0.2.3). Silence means the defaults.
2. Say **"go"** for 0.3.0 (F + A + B), and whether to run it as a parallel multi-agent workflow ("use a workflow") or directly.
3. After 0.3.0, paste the debug statistics from your phone; the thresholds in B and the budgets in C to E are then tuned against real numbers.
