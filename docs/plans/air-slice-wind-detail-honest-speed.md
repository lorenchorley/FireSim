# Plan: night map lighting, picture quality, cliffs, icon taps, debug statistics, honest speed reporting, Air Slices and zoom-adaptive wind (0.3.0 to 0.5.0)

**Status: plan only. Nothing is built.** Branch `claude/3d-fire-simulation-app-xoy1o6`, written 2026-10-11 against HEAD `c5c2f44` (0.2.2).

**Inputs:** your requests in this conversation (slices, slow-run reporting, horizontal slice and zoom detail, debug statistics, night lighting, picture quality, cliff realism, icon taps); the "Engine right now" readout from the user's phone (Fast tier chosen by auto-tune, 41.1 ms per 3-D air step, fast tier computing at 871x real time); and four read-only surveys of the code (timeline and playback; slice UI and render integration; engine data plumbing and tests; wind glyphs and fine-scale wind); and, for the cliffs, direct reads of the terrain, mesh, shader and fire code with throwaway measurements of the four steepest bundled sites (the scripts stay in my scratchpad, not in the repo). File and line references below come from those surveys or from direct reads; `[est]` marks a number that is an estimate, not a measurement.

---

## 1. What this delivers

| You asked for | What you get | Workstream | Release |
|---|---|---|---|
| A copy button for the engine section, renamed "Simulation debug statistics", more cheap statistics, phone hardware and software facts, reachable directly under Settings | A full "Simulation debug statistics" screen: Copy as text, entry directly under Settings in the menu (and in Settings and Setup), speed history, where the time goes, memory, frame rate, recent events, phone model / Android / WebView / CPU / memory / GPU / graphics capabilities | **A** | 0.3.0 |
| Detailed (3-D) mode may fall behind real time; results matter more; report slowness subtly on the timeline; tap for a comprehensible explanation | Auto prefers the detailed 3-D air on any phone that can run it at all; never silently drops to the fast model; a small amber speed button appears at the end of the timeline only while playback is waiting for the simulation; tapping it opens a plain-language sheet | **B** | 0.3.0 |
| Vertical cross-sections of the air wherever you want, on mobile | Air Slice tool: place a line anywhere (crosshair Set A / Set B, or one-tap presets), a flat 2-D side-view panel with axes, terrain, colour chips, flow streaks and a touch probe, plus the 3-D curtain; works on every phone because the fast tier now publishes a diagnosed 3-D wind; exact near-ground sampling | **C**, **D** | 0.4.0 |
| A horizontal slice of wind; indicators that get more detailed as you zoom; curves that follow the wind when very close | "Arrows and flow lines" layer at a chosen height: sparse straight arrows far away, denser arrows closer, curved streamlines up close, seeded per screen area; height control; honest captions about what the model can resolve; optional 60 m "wind the fire feels" raster for close-up detail | **E** | 0.5.0 |
| Remove the day/night darkening of the terrain, in the Layers settings, because at night the terrain details are very hard to see | Layers, Map type, **Night lighting**: Realistic (today's look), Brighter, Daylight. The ground, trees and roads stay readable after dark, lit from a fixed north-west sun so relief shows; the sky, stars and the fire's glow still follow the clock; remembered between runs | **F** (section 9b) | 0.3.0, and independent, so it can ship first |
| Add the picture-quality tier and the history budget to the debug statistics, and a Picture quality override (Auto, Low, Medium, High) so Detail can force the best-looking view too | Settings, Simulation, **Picture quality**: Auto (the phone's guess; the Detail profile asks for High), Low, Medium, High; applies to the next model you build; the statistics screen shows the tier in use, why, what it sets, and the history budget | **G** (section 9c), plus A | 0.3.0 |
| More realistic cliffs: they are not vertical, have no features, and probably play little role in the simulation. Results may change; sharpened cliffs always on, not opt-in | Cliffs drawn near-vertical from the 10 m terrain (steepened in steep bands, a mesh that keeps the edge, lighting from the 10 m terrain) with ledges, joints, overhang bands, stains, scree and lip pavement, and no trees on bare faces. In the fire model a wall is bare rock and not just steep ground, part-rock cells slow the fire, vegetated chutes stay open, and the "Fire crossed the break" card covers rock bands | **H** (section 9d) | 0.3.0 for the drawing; the simulation lane moves to 0.3.1 (spike S6, D17) |
| When you tap an icon on the terrain it is hard to tell whether the app took the icon or the ground next to it; the icon and a word or two should be in the popup | Tap an icon and the Why here? panel opens with the icon as drawn on the map and its name in a word or two ("Spot fire", "Ignition point", "You are here", "Danger: Uphill run", "Home"); the question is about the icon's own spot and the ring jumps onto it; any tap within 22 px of an icon counts; tap the ground and there is no icon row | **I** (section 9e) | 0.3.0, and independent, so it can ship first as 0.2.3 |

Recommended order: **F, G, A, B, H and I first** (F, G and I are small and independent; A and B give every later release real phone data; H-look is independent and H-sim lands last), then **C + D**, then **E**. Each release is an installable APK with its own phone check-list (section 12).

**Stretch goal, in no version for now:** photo-informed cliffs (section 15b, D29), meaning photos of particular cliffs used to give those cliffs their own rock look and their own bare-rock and chute data. Nothing is scheduled or built for it, and the cliff work above (H) is unchanged for it. Whether the photo tools could run inside the app, offline, was looked at and is not recommended (section 15b).

**Stretch goal, in no version for now:** adaptive simulation quality (section 15c, D30), meaning more detail where the terrain is complex and where it matters to the fire. It is to be investigated later and not studied straight away; nothing is built or scheduled for it.

**Stretch goal, in no version for now:** checking the simulation's validity (section 15d, D31), meaning how to verify that it is valid: against a precomputed high-quality run of the same model, against other models, recorded fires and measurements, and with checks that need no reference. It is recorded only: nothing has been researched or studied, and nothing is built or scheduled for it.

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
- Bundle: all-JS gzip 956.7 kB of 1000 (lazy chunks count; `scripts/check-bundle.mjs`; spike S2 corrected the 953.8 first written here), entry 185.4 of 195, CSS 122.2 kB of 135 raw; Layers-panel DOM 914 of 1000 nodes. Headroom is thin.
- Vitest runs in `node` with no DOM; DOM builders are not unit-tested; logic must live in pure modules. There is no CI config in the repo; e2e runs a Pixel 7 profile on SwiftShader. Only one e2e spec forces a tier; the others run on Auto and branch on what the machine picks.
- The 3-D picture quality tier (terrain mesh 224 / 320 / 400, trees 16k / 32k / 48k, pixel-ratio cap 1.25 / 1.75 / 2) is chosen only by `guessQuality()` from cores and memory when the view is built (`src/render/SceneView.ts:77-90,230`); no setting reaches it, and `createSceneView(container)` takes no options (`src/ui/modules.ts:23,98`). The scrubber history budget is 6 % of the reported device memory clamped to 48-160 MB (`src/ui/session.ts:794`).

**Cliffs** (direct reads, plus throwaway measurements on the bundled 10 m terrain of Katoomba, Kanangra, Grose and Tomah; the scripts are in my scratchpad, not in the repo)
- **Where the cliff detail is lost, Katoomba:**

| Stage | Steepest slope | Area steeper than 70 degrees |
|---|---|---|
| Bundled 10 m terrain | 83 degrees | 0.52 % |
| 3-D mesh, High (22 m cells) | 76 | 0.13 % |
| 3-D mesh, Low (40 m cells) | 68 | 0 % |
| Fire grid (30 m cells) | 73 | 0.03 % |
| 3-D air model (150-200 m, after its 35 degree smoothing) | 30-33 | 0 % |

  Kanangra, Grose and Tomah follow the same pattern (Tomah's data tops out at 73.5 degrees and its Low mesh at 56).
- **The data is not vertical.** The bundled elevation model is the NSW 5 m model "derived from stereo imagery", bilinear-resampled to 10 m (`src/data/demoRasters.ts:1-9,39-46`); Katoomba's biggest face drops 306 m, about 180 m of it at roughly 77 degrees. LiDAR surfaces also fill gaps on steep faces (per NSW's product notes in a search result; I could not open the page to confirm the wording), so no source will give true verticals and the last step has to be procedural.
- **The mesh rounds it further.** `decimateGrid` box-blurs the 10 m terrain (radius `floor(ratio/2)`: 3x3 on High, 5x5 on Low for a 9 km area) before sampling at 22 to 40 m (`src/render/fields.ts:44-67`, used at `SceneView.ts:337`).
- **The lighting does not see the 10 m terrain.** The per-pixel normals, the slope that drives the strata and the photo replacement, and the rock tint all come from the 30 m (or 20 m) fire grid: `TerrainLayer` builds its gradient texture from `terrain.dzdx/dzdy` (`terrainLayer.ts:537-546`) and `setScenario` is given the fire-grid terrain (`src/ui/screens/sim/simScreen.ts:108`). The strata change colour only (`terrainLayer.ts:154-190`) and the rock tint ramps from 40 to 60 degrees of fire-grid slope (`fields.ts:159-191`). Cast shadows and sky view run on the render mesh (`SceneView.ts:343-348`).
- **Trees** are placed per fuel cell from canopy cover and height; only NonFuel and Water cells are skipped and there is no slope rule (`vegetationPlacement.ts:293-303`).
- **In the fire model a cliff is a wall decided by slope alone.** `cliff[k]` is `Landform.Cliff` (30 m mean slope over 45 degrees) or a 10 m sub-cell share over 60 degrees of 0.3 or more, or a P90 slope of 60 or more (`src/fire/terrainFeatures.ts:834`), and the spread model makes those cells `NonFlammable` whatever the fuel is (`FireSpreadModel.ts:536-548`, `src/fire/spread/params.ts:267`). Walls are 3.3 % of Katoomba, 4.3 % of Kanangra, 4.8 % of Grose and 2.8 % of Tomah at 30 m (3.1, 5.0, 4.5 and 3.5 % at 20 m), and almost all of it is the 45 degree landform rule (3.08 of 3.27 % at Katoomba), so steep forest is a wall as much as bare rock. Fuel inference does the same (`src/fuel/infer.ts:54-55`). A cell steeper than 40 degrees but under 45 burns at the capped slope factor of x16.
- **Nothing else knows about cliffs.** No ember, atmosphere or Insight-card code uses the cliff mask. The 3-D air is smoothed to 35 degrees at 150-200 m (`src/atmosphere/grid.ts:233-241`); rolling debris runs down faces unimpeded (`FireSpreadModel.ts:1939-1990`); the card for an ember crossing a break counts only NonFuel and Water cells, not cliffs (`src/explain/rules/fire.ts:447-448`).
- **Inputs for a better rule.** The bundled canopy raster is 20 m (`public/demo/*/canopy.json`: p90 height, mean height, cover at 2 m or more); the live Meta raster is 1 m aggregated to the fire grid and loaded only for areas up to 3 km (`src/data/canopy.ts:27`); the fire grid is built before the canopy loads (`src/scenario/build.ts:191,200`). The gully geometry the model already has (flow accumulation at 5 ha and the trench score) is computed in the worker (`terrainFeatures.ts:650-775`). The research notes say quantitative cliff-line fire behaviour for NSW sandstone was not found (`docs/research/10-firefighter-education.md:280`), so any new behaviour is rule of thumb.

## 3. Decisions to confirm (each has a default, so "go" accepts them all)

| # | Decision | Default | Effect if you change it |
|---|---|---|---|
| D1 | Release split | Three installable drops: 0.3.0 (F + G + A + B), 0.4.0 (C + D), 0.5.0 (E) | One big drop is possible but loses the early phone data and raises risk |
| D2 | Auto policy ceiling | Detailed unless the predicted compute time for a 6 h run exceeds **10 minutes** (cut-off about 198 ms per air step, about 4.8x slower than your phone), scaled by run length, floor 60 s | Smaller = more phones fall back to Fast; larger = more phones wait longer. Your phone gets Detailed either way |
| D3 | Timeline signal placement | A 44x44 speed button in the strip's right-hand column that exists only while behind (like Cancel does while seeking); **confirmed by spike S1 on 2026-10-13** (`docs/plans/spikes/S1-timeline-signal/`); fallback is a badge in the clock button plus an under-rail line | See 6.4 |
| D4 | Old "Engine right now" section | Moves into the new screen; the model card keeps a four-row summary and an "Open Simulation debug statistics" row | Keeping the full block in both places duplicates about 30 rows |
| D5 | Phone identity source | Web APIs only (User-Agent Client Hints, user agent), no new native plugin | `@capacitor/device` gives exact model and Android API level but adds a native dependency |
| D6 | Slice placement in 0.4.0 | Crosshair "Set A / Set B" and presets; draggable map handles later | Handles have no precedent in the codebase and conflict with one-finger pan (8.3) |
| D7 | Time-lapse recorder for a pinned line | Deferred to 0.4.1 (slices use the newest/keyframe air, labelled with its age) | Adds memory and five truncate sites to keep in step |
| D8 | Horizontal slice drawing | Draped on the ground (plan view) with a height label | True-height floating glyphs in orbit view are a later stretch |
| D9 | New glyph layer default | Opt-in in 0.5.0; the existing wind streaks stay the default | Making it the default changes every screenshot and e2e baseline |
| D10 | Bundle budget | Lazy-load the slice panel and glyph engine, run the trim pass now, and do not plan to raise the all-JS budget. **Spike S2 (`docs/plans/spikes/S2-bundle/`, measured by patched builds):** the safe set (the GeoTIFF decoders the app never reads, pako, one barrel line) frees 94.0 kB gzip, 956.7 to 862.7, so the estimated additions of 46 to 61 kB fit with 76 to 91 kB to spare. Raise the budget only if, after the safe set, the total is still above 950 kB at the end of 0.4.0, and ask you first. Two questions for you: may the APK build drop the in-thread engine fallback (140.6 kB) and the demo engine (15.0 kB)? | Lazy loading moves bytes and does not remove them; the entry (185.4 of 195, 9.6 kB of headroom) is the tighter budget, and a lazy model card frees 21.2 kB of it |
| D11 | Fire-felt wind raster | Int16, about 60 m cells, newest snapshot plus keyframes (0.5.0 stage E2) | Float32 at 30 m is 4-8x the memory |
| D12 | Names | "Detailed (3-D air)" = Standard and High tiers; "Fast (surface wind)" stays | Only labels change |
| D13 | Night lighting choices and default | Realistic (default), Brighter, Daylight; the default stays Realistic because the dark night is a deliberate training point (judging a fire at night) | Making Brighter the default changes the night screenshots and every night e2e baseline |
| D14 | When night lighting ships | With 0.3.0 | It is independent of everything else: I can ship it alone first as 0.2.3 if you need it sooner |
| D15 | Picture quality semantics | Auto = the phone's guess, except the Detail profile asks for High; Low, Medium and High always win; applies to the next model you build | "Apply now" needs a view rebuild; leaving Detail alone keeps today's behaviour |
| D16 | Adaptive pixel ratio | Stays on in every case as the safety valve (it only lowers the resolution while the frame rate stays under 30) | Pinning it would sharpen a forced High but can stutter or exhaust a small GPU |
| D17 | When cliffs ship | **Your decision:** the next release, 0.3.0. H-look and H-sim ship together; H-sim lands last behind its own gates and is the cut line: if its Katoomba chute test or spike S6 fails, it ships as 0.3.1 and I tell you. **Spike S6 did not pass its pre-written criteria (2026-10-13, `docs/plans/spikes/S6-rock-estimators/`), so by this rule H-sim moves to 0.3.1 and H-look ships in 0.3.0** | H-look never depends on H-sim |
| D18 | Sharpened cliffs | **Your decision:** always on, no setting, no data-faithful mode. Display only: the simulation, the slope overlay, the numbers and the cards use the unsharpened data; the Data sets Terrain card and Help say so | An opt-in or a data-faithful look would be a later, small change (the sharpening is one pure function) |
| D19 | Sharpening method | Steepen the 10 m terrain along the fall line in steep bands (gate 48 to 62 degrees, a 3-cell window, one pass, then a despike), a mesh that does not blur steep ground, lighting from the sharpened 10 m terrain. Spike S5 (done) confirms the look on the real renderer with two changes: the slope that picks strata and photo comes from the mesh, and the finished mesh is despiked. Weaker strength (0.6) is the fallback if the phone says terraces look wrong; the other rungs are not needed | Stronger is steeper but riskier for artifacts; steep-patch mesh refinement is not built for 0.3.0 (S5) |
| D20 | What a wall is in the fire model | Bare steep rock: the share of 10 m sub-cells at 55 degrees or more times (1 minus canopy cover); a wall at 0.5 or more unless the cell is a vegetated gully (drainage and trench score 0.3 or more); with no canopy data `rockFraction` stays undefined and the model keeps today's mask unchanged (S6: the 60 degree share with the new classes gives 1.30 % walls against today's 3.27 % at Katoomba, so it is not "as before"). S6 carries slope x (1 - canopy cover) forward and drops the aerial greenness index | Slope-only walls (today) are simpler but stop the fire on steep forest |
| D21 | Part-rock cells | Slow the fire: rate times (1 minus rock / 0.5), with a floor of 0.6 in vegetated chutes; no new random draws and no breach logic | A Wilson-style breach draw would double-count the spotting the ember model already does |
| D22 | Cards | No new card kind: the "Fire crossed the break" spot variant counts rock walls as breaks and says "rock band" | New cards (rock band reached, chute run, cliff above you) can follow once there is phone data; "Narrow gully" already covers chutes |
| D23 | Results and versions | **Your decision:** results may change near rock bands. No model-version constant exists and none is needed (the preferences hold only the notice, the settings and the last setup, so no run or checkpoint outlives a release; the first task confirms); the release notes say so; runs stay deterministic | Storing runs across releases would need a version stamp |
| D24 | Which icons count as tappable | The markers the map draws: you, ignition pin, spot fire, the three insight markers, and homes when the Homes layer is on. Not place names, roads, trails, the pending-ignition mark or the focus ring | Place names are text, not icons; they can follow |
| D25 | How near counts as a hit | Within 22 px of an icon's centre (a 44 px target; the icons are 22 to 40 px), or its own half-size if larger; homes 14 px; the nearest wins, ties go to you, ignition, spot fire, insight, home | A bigger radius misses less but takes more taps meant for the ground; tuned on your phone |
| D26 | What an icon tap asks about | The icon's own spot, not the ground under the finger, so the explanation and the ring match the thing you tapped | Keeping the finger's ground point would keep the offset for pins and for icons near the horizon |
| D27 | Where it applies | The Why here? panel only; the fire, fuel and wind tools keep placing and painting on the ground | Selecting an existing ignition with the fire tool is a different feature |
| D28 | When it ships | With 0.3.0 (it is small and independent, so it can ship first and alone as 0.2.3 if you want it sooner) | None |
| D29 | Photo-informed cliffs | **Your decision:** a stretch goal in no version for now: not in 0.3.0 to 0.5.0, not scheduled, and H is not changed for it (section 15b) | It becomes a workstream only when you say so, with its own release, size and place in section 10 |
| D30 | Adaptive simulation quality | **Your decision:** a stretch goal in no version for now, to be investigated later and not studied straight away: not in 0.3.0 to 0.5.0, not scheduled, nothing changes for it (section 15c) | It becomes a study, and later a workstream, only when you say so |
| D31 | Simulation validity checks | **Your decision:** a stretch goal in no version for now, recorded only (no research, no study): not in 0.3.0 to 0.5.0, not scheduled, nothing changes for it (section 15d) | It becomes a study, and later a workstream, only when you say so |

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
10. **Drawing may be stylised; numbers may not.** The sharpened cliff terrain is used only to draw. Anything the simulation reads, and any slope, elevation or card a person is shown, comes from the terrain as received, and the Data sets Terrain card says the drawing is sharpened.

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
| Memory | Engine measured total and top parts (exists, refreshed at most every 30 s), checkpoints held and bytes (exists), the **history budget** (6 % of the reported device memory clamped to 48-160 MB, with the memory class it came from; `defaultSnapshotBudget`, `src/ui/session.ts:794`) and what is held against it: bytes, full pictures, light frames and thinned frames (`snapshotStore.ts` getters), snapshot size last and mean, JS heap used / total / limit (`performance.memory`, reader at `src/scenario/memoryModel.ts:335`), storage used / quota (`src/data/storage.ts:78`) | mixed | C/D |
| Display (main thread) | Frame rate last 10 s (mean, 95th percentile frame ms, frames over 33 ms and over 100 ms); long tasks in the last 60 s (count, total ms; `PerformanceObserver('longtask')` where present); draw calls, triangles, textures (`renderer.info`); the **picture quality tier** (Low, Medium or High) and why (set by you, asked for by the Detail profile, or guessed from this phone's cores and memory, with those numbers) and what the tier sets (terrain mesh samples per side, tree budget, canopy triangle budget, pixel-ratio cap, flame and smoke caps; workstream G); pixel ratio used vs cap and how many times the adaptive ratio has lowered it; canvas size. The scene stops drawing while a full-screen screen is open (`src/render/api.ts:111`), so these are the last seconds before opening | `SceneView` ring + observer | H/D |
| Phone: hardware | Maker and model; Android version and API level; CPU cores, architecture, bitness; memory class (`deviceMemory`, a coarse bucket); screen px, CSS px, pixel ratio, refresh rate measured from 30 animation frames, touch points; battery level and charging where the API exists; storage | UA Client Hints `getHighEntropyValues`, user-agent fallback, `navigator.*`, `screen.*` | D |
| Phone: software and graphics | WebView / Chromium version and brands; raw user agent; WebGL2 vendor and renderer (`WEBGL_debug_renderer_info`), max texture size, float and half-float render targets, compressed textures; WebGPU present (adapter vendor and architecture within a 1 s timeout); WebAssembly, SIMD (`WebAssembly.validate` probe), `SharedArrayBuffer`, `crossOriginIsolated`; `OffscreenCanvas`, module workers; reduced motion, contrast and colour scheme | new `src/ui/deviceInfo.ts` (reuses probes in `src/ui/bootDiagnostics.ts:48-77`) | D |
| What this phone can do | Three measured sentences, never guesses: 3-D air step ms and speed if the 3-D tier ran; fast-tier speed if it ran; memory headroom (engine vs JS heap limit); graphics path | derived from the rows above | D |
| Recent events | Ring of the last 40: wall clock and run clock, kind, short text. Sources: tier chosen (with the timing), slow-run episodes (start, end, slowest ratio), app backgrounded / foregrounded and for how long (`simScreen.ts:857-862` already sees visibility), rewinds and edits, checkpoint restores, history thinning, long-step bursts, last 5 uncaught errors (`bootDiagnostics.ts:31-32`) | `src/ui/eventLog.ts` + worker events | H |

Optional **Speed test** (stretch, release 0.3.1): about 2 s in a throwaway worker on frozen kernels (45x45x20 stencil with trilinear gathers, a memory-copy loop), result shown against a reference measured by the same code in CI. Disabled while a run is playing ("Pause first so the test is fair"). It exists to compare phones before any run; the engine's own measured step is the better number once a run exists.

### 5.4 Design
- **Pure content, thin DOM.** `src/ui/debugStats.ts` (no DOM) builds a `DebugStats` object (groups of `{ id, label, value, note?, live? }`) from `{ engine, session, frames, store, device, events, now }` and exports `debugStatsToText`. `src/ui/screens/debugStats.ts` renders it with the existing primitives (`appBar`, `kv`, collapsible groups and the focus trap and in-place 1 Hz patching from `modelCard.ts:390-424`).
- **Worker side.** New `src/sim/perfStats.ts` holds the aggregates and rings, fed from the places that already time modules (`addPerf`, `autoTuneDecide`). It reports through a new `EngineInfo.perf` block (about 40 numbers, 20 speed samples, <= 8 events; well under the 2 KB EngineInfo note at `src/core/simTypes.ts:333-341`). New fields are `null`, never NaN (`engineInfo.test.ts:34` rule). Worker events (tier choice, long-step bursts) are drained into `perf.events` at `makeSnapshot` (each event has an increasing `seq`; the UI dedups), so **no new `SimController` method** is needed (hand-written fakes in `session.timeline.test.ts:69`, `review.test.ts:44`, `model.test.ts:175` and `mockSim.ts:190` would all break).
- **Main side.** `SceneView.frameStats()` as an optional `SceneViewApi` method (like `viewSection?`, `src/render/api.ts:52`; the mock stays valid) backed by a 120-entry ring in the render loop, which already times frames for `AdaptiveDpr` (`SceneView.ts:194,1170-1186`); it also reports the picture-quality facts (tier and source, and the values the tier sets); `src/ui/deviceInfo.ts` collects phone facts once and caches them (`deviceInfoNow()` for the synchronous part, `deviceInfoAsync()` for Client Hints, battery, storage, WebGPU adapter, refresh rate); `src/ui/eventLog.ts` is the event ring.
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
| **T1 (default, confirmed by S1)** | A 44x44 button using the strip's 4th grid column, present only while `behind` or `waiting` and hidden while a jump computes (the column Cancel uses while seeking). 20 px gauge glyph; faint outline when `behind`, a 3 px ring plus a short 3 px run under the rail that ends at the thumb when `waiting` (the stretch between thumb and head has no length while waiting, so a line there would not show). In the two light looks the ring and the run are drawn in `--watch-ink`: the amber `--watch` is only 1.93:1 against the strip | Literally "on the timeline", a real target, precedent in Cancel | The track shrinks 44 px (284 to 240 at 412 wide); the clock labels stay at 360 px wide and above and thin from four to three only at 320 px |
| T2 | Badge in the clock button's `.tb-state` slot ("Behind") that opens the time sheet with a new "Simulation speed" section; amber under-rail line for the eye | No layout shift, same slot as "Computing" and "Replay" | The tappable part is at the top, not on the timeline; the badge is not a separate 44 px target |
| T3 | Amber ring on the playhead thumb; a tap (no movement) on the thumb opens the sheet | No layout change at all | Not discoverable; non-standard affordance; needs a hidden focusable button for screen readers |

**Spike S1 (before building):** prototype all three behind a debug flag, run `scripts/audit-tap-targets.mjs` and `scripts/layout-budget.mjs`, screenshot at 412x915 and 844x390 in the four looks (light, dark, high contrast each), and pick on these criteria: target >= 44 px, strip height unchanged (so camera insets do not jump), slider taps not stolen, audits green, glyph <= 20 px, meaning not carried by colour alone, discoverable. T1 unless the spike says otherwise.

**Spike S1 result (done 2026-10-13, note in `docs/plans/spikes/S1-timeline-signal/`):** T1 is confirmed. All three candidates leave the strip at 64 px and the layout budget identical to today, and all pass the tap-target audit; T3 fails "slider taps not stolen" (a tap within 22 px of the thumb, up to 28 minutes of a 6 h run at 412 wide, would open the sheet instead of seeking) and is not discoverable; T2 works but its explanation sits below the fold at 844x390. Three things the plan had not said: the amber line must be a fixed run ending at the thumb; the amber ring needs `--watch-ink` in the light looks; and the sheet joins the top bar's popover group, so the strip is created first and its button handed to the top bar.

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
- **Sampler v2** (`src/render/atmosphereSampler.ts`, pure; spike S3 found that the API as written, `wind(x, y, zAsl, out)` with double arguments and a boxed result, is not garbage-free in V8: 48 bytes per call, so a glyph loop must use a scratch `Float64Array` or inline the sampler): per column of the 4-column stencil compute `zeta = (zAsl - baseM - h0) / J`, clamp to the first and last level (below the first level it clamps to level 0, like the engine; above the top it returns the top level as today), binary-search the level, interpolate linearly in zeta, then blend the 4 columns bilinearly. This is the same arithmetic as the fast tier's `sampleBg` (`diagnosticWind.ts:176-223`) and the 3-D tier's `sample` (`atmosphere.ts:1030-1075`). The flat path stays for legacy views. Cost: 4 searches instead of 1 per sample, about 143 ns per call on a desktop (S3); fine for 1300-2600 particles per frame (0.37 ms there), not for a glyph rebuild, which makes about 40,000 calls (9.3).
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
- **Lazy loading (D10):** the panel, `sliceField`, `flow2d` and the tool panel load as one dynamic chunk on first use (an `await import()` inside the tool's open handler; the pattern at `src/ui/modules.ts:76-84` requests its chunks at start-up in every mode, so it is not an on-first-use pattern); only the state, `sectionFromEndpoints` and the layer glue stay in the entry chunk [est 14-18 kB gzip for the chunk].

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
- **Output** is flat `Float32Array`s for the renderer; caps by quality tier 600 / 1200 / 2000 glyphs, at most 12 segments each. A portrait phone at the L3 lattice needs only about 300 to 620 glyphs (S3, arithmetic), so the larger caps matter for tablets, landscape, denser lattices and the High tier.
- **Field access (S3):** trace through a 2-D raster of (u, v) at the chosen height above the render DEM, at the model's column spacing (the 2x finer raster where one model cell is wider than about 60 px, the 12 km views), filled once per new snapshot and per height change (not per camera move) with sampler v2 (`zAsl = DEM(x, y) + h`, exact near the ground, workstream C; 0.3 to 0.5 ms to build, 1 to 2 ms for the 2x raster). Direct sampling through sampler v2 is the fallback and the test oracle: it costs 6.8 ms (hand-inlined) to 8.0 ms (plan API) per rebuild at 2000 x 10 on a desktop, 16 to 19 ms on the phone estimate, against 2.5 ms and 5.8 ms for the raster. The raster's end points differ from the direct trace by a mean of 0.5 px, with 2.3 % of glyphs over 3 px at a 60 px model cell (4.8 % at 1x in the 12 km views, 0.8 % at 2x). For `fire` height the raster is the fire-felt raster itself.

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
| Rebuild | <= 8 ms p95 **per slice** on the phone (about 3.4 ms on a desktop like the S3 machine; 8 ms there is 18.8 ms on the phone estimate, so the old "32 ms at 4x CPU throttle" is 1.7 times too lenient), a whole rebuild in 1 to 3 slices, >= 250 ms apart while moving | main thread already about 22 ms per drawn frame. Measured by S3 (a raster rebuild is 5.8 ms median, 7.3 ms p95 on the phone estimate at 2000 x 10; direct sampling is 15.9 ms median, 19.1 ms p95). Warm the tracer when the layer is created (the first rebuild costs 4 to 7 times a steady one) |
| GPU buffers | about 1.2 MB | fixed at construction |
| Memory (E2) | about +3 to +12 MB per 6 h run | shown in the debug statistics |

### 9.9 Tests and acceptance
- **Pure:** a steady-state rebuild allocates under 1 kB (S3: the plan's own sampler API allocates 48 bytes per call, so this test catches a regression to it; the harness `tests/spikes/glyphBench.spike.test.ts` shows how to measure it); the raster trace ends within 1 px on average of the direct trace (S3: 0.5 px at 1x); LOD thresholds and hysteresis; **pan invariance** (the same world seeds appear after a pan); determinism (same inputs, same arrays; no `Math.random`); tracing against analytic fields (uniform stays straight with curvature under 1e-6, solid-body rotation recovers the radius within 1 %, a saddle bends correctly); arc-length constancy; near-plane clipping; length rules; arrowhead direction; L1 and L2 glyphs are straight while L3 and L4 glyphs curve in a rotating field.
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
- **Lighting maths (pure, `src/render/sky.ts`; numbers and corrections from spike S4):** `mapLighting(real, look, realSunDir)` (S4: it needs the real sun's world direction, because `SkyLighting` has no azimuth; the elevation is already `real.sunElevation`). The weight is `w = m x smoothstep(8 deg, -2 deg, elevation)` with `m = 0, 0.3, 1` for Realistic, Brighter, Daylight (S4: 0.55 only gave an even spacing with the separate colour and intensity blend; with the product blend below, 0.3 puts Brighter 58 % and 62 % of the way from Realistic to Daylight in lightness at Katoomba and Thredbo), so with the sun above about 8 degrees nothing changes and the effect fades in through dusk (S4: the window is smooth and monotone, identical at 8 degrees and above). The target is `skyLighting(30 deg)` (S4: 40 was the plan; 30 gives +11 % and +25 % ground contrast on the Plain and fuel-colour maps, no change on the photo map, and 5 to 7 % less ground luma there, so it is a judgement call and 40 loses little; no cloud or smoke, because visibility is the goal) from a fixed cartographic sun direction (north-west, azimuth 315 degrees, which S4 found the best of eight at both sites). Three corrections: (1) **weight the sun direction by the light each sun carries**, `(1 - w) x real sun intensity` and `w x target intensity`, not by `w`: with plain vector blending the real sun below the horizon has no light but still pulls the direction by `1 - w`, so Brighter's light swings with the real azimuth all night; (2) **blend sun colour times intensity, and the ambient, as products** (and divide the blended intensity out again), because blending colour and intensity separately makes the sun's light go with `w` squared at night; (3) exposure is blended as before. With `m = 0` the output is bit-identical to today (test); in the real renderer Realistic matched an unpatched HEAD in 32 of 33 frames pixel for pixel (embers off) and differed in 86 of 377,000 pixels in the other, cause not found.
- **Uniform plumbing (`SceneView.applyLighting`, `SceneView.ts:1013-1042`):** the shared uniforms the map shaders already read now carry the **map lighting**; `uNight` stays the **real** night. A new `uMapNight = real night x (1 - w)` serves the sites that dim the map. The sky dome gets its **own** sun direction, colour, intensity and exposure from the real lighting (as it already has its own zenith and horizon), so a bright map never paints a sun disc into a night sky or changes the sky's brightness (S4: with the sky sharing the map's sun and exposure the standard sky region's mean luma drops from 33.75 to 25.30 and every pixel changes; with its own set the region is identical in all three looks). **The smoke body gets its own set of five lighting uniforms too, from the real lighting** (S4, below), and a new shared `uShadowGain = 1 - w` scales the terrain's cast shadows. `sunKey` is invalidated so a change applies at once, as `setStartTime` does (`:989-996`).
- **Shader audit and classification** (from a grep of `uNight`, `uExposure`, `uSunI` and `uAmbI` in `src/render`):

| Use | Sites | After the change |
|---|---|---|
| Map lighting (sun, ambient, exposure) | `terrainLayer.ts:62-63,204-218,383-397` (ground and photo); `treeShaders.ts:269-272,397-401`; `placesLayer.ts:296-309`; `glsl.ts:42-57`; `streaks.ts:132`, `crossSectionLayer.ts:81`, `fireLayer.ts:133` (exposure only) | Follow the blended map lighting; no shader change, they read the shared uniforms (S4: except the cast-shadow term, `terrainLayer.ts:205`, which gets one line for `uShadowGain`) |
| Dimming at night | `placesLayer.ts:226-227` (roads dim and cool), `:309` (ambient floor), `:352` (labels); `treeShaders.ts:409` (moonlight add) | Read `uMapNight` (added to the shared lists at `vegetationLayer.ts:127-131,514` and `placesLayer.ts:440`) |
| Emissive and atmosphere | `skyDome.ts:40-44` (sun disc, stars); `fireLayer.ts:91` (flame gain); `smokeLayer.ts:80` (fire light on smoke); `placesLayer.ts:313` (lit windows); `terrainLayer.ts:226` (zone glow); `SceneView.ts:1034` (`uGlowGain`); **`smokeLayer.ts:60,78` (the smoke body; S4 moved it here from the map-lighting row)** | Unchanged, real night |

  The sky dome reads the shared sun and exposure uniforms today (`skyDome.ts:24-25,68-70`), so it moves to its own, and so does the smoke body (S4). **S4 audit:** every site in the table is real and correctly placed apart from the smoke body; the table misses the cast-shadow term (`terrainLayer.ts:205`); `uExposure` has three jobs (the exposure of lit surfaces in `fsDisplay`, the exposure of emissive light in `fsTonemap`, and the fog colour via `fsFog`), blending it for all three is acceptable (in Daylight the emissive paths lose up to 37 % of their exposure, which shows as 10 to 30 % less bright-orange fire area and no change in contrast); "no shader change" is wrong for five shaders (terrain, road, house, label, tree: one to three lines each, for `uMapNight` and `uShadowGain`); and the shared-uniform contract test in `vegetationLayer.test.ts` needs `uMapNight` in its helper.
- **Shadows:** terrain cast shadows keep following the real sun (`updateShadows`, `SceneView.ts:1049-1054`, off below 0.5 degrees) **scaled by `1 - w`** (S4: unscaled they are shadows from the setting sun on a map lit from the north-west, and they switch off at +0.5 degrees with a step of 4.2 luma levels in Daylight, 0.8 when scaled; one uniform, one shader line), so at night relief comes from the fixed-direction light and the baked relief term, not from invented shadows, and there is no extra cost on phones.
- **Fog and fire:** the real dark fog colour stays so the horizon matches the dark sky; **S4: fog density stays as it is** (the dark fog takes at most 16 % off the far band in heavy smoke haze, so the cut by `w` is not needed, and the unchanged fog keeps the horizon coupled to the sky); flames, embers and smoke keep their night glow gain. The fire still stands out in Daylight about as well as it does by day (S4: Michelson contrast of the bright-orange pixels 0.37 to 0.48 at Katoomba and 0.25 to 0.37 at Thredbo, by day 0.35 to 0.45 and 0.17 to 0.27, Realistic at night 0.52 to 0.74 and 0.65 to 0.71), which is why Realistic stays the default (D13).
- **S4 result (done 2026-10-13, `docs/plans/spikes/S4-night-look/`, 14 screenshots, the measuring script and a throwaway patch).** The design is sound and works as built on the real renderer: by day all three looks are pixel-identical (18 frames), the sky region is identical between looks, draw calls, triangles, programs, geometries and textures do not change, a look change is uniforms only (0.007 ms) and the console stayed empty in the runs that checked it. Five corrections above (direction weight, smoke body, shadow fade, colour times intensity, signature) and Brighter `m = 0.3`; none changes the architecture and all are small. What will be seen on the phone: at -2 to -6 degrees the sky is still sunset or twilight while a Daylight map is fully lit (the fade makes it last about 55 minutes from +4 to -6 degrees); Daylight is not noon (the sun is at 30 degrees, so the flat ground has about half the noon sun term); the aerial photos' pale tiles, invisible in Realistic, show once the map is lit; the smoke is a dark veil over a lit map. Nothing was seen on a phone, with two sites, one date and a synthetic fire.

### 9b.4 UI
In the Layers panel's **Map type** section (`layersPanel.ts:272-325`), below the tile grid: a `segmented` control "Night lighting" with Realistic, Brighter and Daylight (test id `night-look`) and the hint "Realistic follows the clock. Brighter and Daylight light the ground, trees and roads after dark so terrain detail stays readable. The sky, stars and the fire's glow still follow the clock." About +12 DOM nodes against 86 spare; no CSS.

### 9b.5 Files, tests, acceptance
- **Files:** `src/render/sky.ts` (+ test), `SceneView.ts`, `api.ts`, `treeShaders.ts`, `vegetationLayer.ts`, `placesLayer.ts`, `skyDome.ts`, `src/ui/screens/sim/layersPanel.ts`, `layersPrefs.ts`, docs.
- **Pure tests:** `mapLighting`: `m = 0` equals `skyLighting` for a sweep of elevations, cloud and smoke values; every look is identical when the elevation is 8 degrees or more; `m = 1` at night equals the target; continuous and monotone through dusk; direction normalised; the `uMapNight` and real-night relationships; (S4) at night the direction of every look equals the target's for any real azimuth, and Brighter's sun light is `m` times Daylight's; `uMapNight` is added to the `vegetationLayer.test.ts` helper. `sanitizeLayerPrefs`: valid and invalid `nightLook`, version stays 1, unknown keys ignored. The panel row model.
- **E2E (real engine, night through the `setStartTime` debug path; `src/render/dev.ts:15` already has a night start for the dev page):** switch looks and assert, from screenshots decoded with `fast-png`, that the mean luminance of a ground region rises Realistic < Brighter < Daylight by a margin (S4, harness view, Katoomba 22:00: 10.0, 36.5, 54.9; Thredbo 17.0, 57.0, 83.6; assert `Brighter - Realistic >= 12` and `Daylight - Brighter >= 9` levels, and re-measure in the app's own view), a sky region does not change (S4: 0 differing pixels in the standard view; compare pixels, not just the mean) and no sun disc appears (look from eye level toward the north-west and up, and compare the region's mean luma, which the bug lifts from 21 to 90; a region at the foot of that view holds lit hills, which do differ); a reload keeps the choice; Reset returns to Realistic; no console errors; draw-call and triangle counts unchanged. Screenshots: night Realistic and night Daylight.
- **Acceptance on your phone:** at night, Layers, Map type, Night lighting, Daylight: relief, trees and roads read as by day; the sky stays dark with stars; the fire still glows; switching back restores; it is remembered next run.
- **Size:** S.

---

## 9c. Workstream G: Picture quality setting (0.3.0)

Small. Lets you choose the 3-D picture quality instead of leaving it to a guess from the phone, and makes the **Detail** performance profile ask for the best-looking view as well as the best simulation. It sits after F only to keep the other section numbers stable.

### 9c.1 What the user gets
- **Settings, Simulation, Picture quality** (under Performance): **Auto**, **Low**, **Medium**, **High**.
- **Auto** keeps today's behaviour (the phone's cores and memory decide), except under the **Detail** performance profile, where Auto means High. Saver and Balanced are unchanged. Low, Medium and High always win.
- Hint: "Auto picks from this phone's cores and memory; Detail also asks for High. High draws more terrain and trees and needs more memory; the picture still lowers its resolution by itself if the frame rate stays under 30. Applies to the next model you build." When High is chosen on a phone the guess calls Low, a non-blocking line adds: "This phone looks like a Low device (4 cores, 3 GB). High may run slowly or close the app."
- The debug statistics (workstream A) show the tier in use, why, and what it sets, next to the history budget.

### 9c.2 What a tier sets today (all in `src/render/SceneView.ts`)

| | Low | Medium | High |
|---|---|---|---|
| Terrain mesh (samples per side) | 224 | 320 | 400 |
| Tree instances | 16,000 | 32,000 | 48,000 |
| Canopy triangle budget | 100k | 170k | 250k |
| Pixel-ratio cap | 1.25 | 1.75 | 2 |
| Flame sites / smoke puffs | 2,500 / 800 | 5,000 / 1,500 | 5,000 / 1,500 |
| Tree sway by default | off | on | on |

`guessQuality()` (`SceneView.ts:83-90`): High at 8 or more cores and 6 GB or more, Low at 4 or fewer cores or 3 GB or less, otherwise Medium; a missing value counts as 4 cores and 4 GB, which gives Low. The tree-sway default already follows the view's resolved quality (`layersPrefs.ts:113`, `layersPanel.ts:752`), so it follows the override too.

### 9c.3 Design
- **Setting:** `pictureQuality: 'auto' | 'low' | 'medium' | 'high'` in `Settings` (`src/ui/settings.ts:18-70`, default `'auto'`), validated in `sanitise` (only those four values). Additive, so `SETTINGS_VERSION` stays 2.
- **Pure rule:** `resolveRenderQuality(pictureQuality, performance)` next to `performanceProfile` (`settings.ts:189`): an explicit value returns itself; `'auto'` returns `'high'` when `performance === 'quality'`, otherwise `undefined` (let `guessQuality()` decide). Unit-tested over all 4 x 3 combinations. `guessQuality` is exported (module-private today) so the statistics screen and the tests can show and check what Auto would pick.
- **Plumbing:** `createSceneView(container, opts?: { quality?: RenderQuality })` (`src/ui/modules.ts:23,98`; the mock ignores it) and `simScreen.ts:105` passes `resolveRenderQuality(...)`. `SceneView` already accepts `opts.quality` (`SceneView.ts:56,230`). A read-only `qualityInfo` (tier, `source: 'set' | 'guess'`, the guess inputs, the values the tier sets) feeds the statistics screen.
- **Applies to the next model you build,** like the Performance setting ("Applies to the next model you build", `src/ui/screens/settings.ts:281`): the terrain mesh decimation (`SceneView.ts:337`), the canopy budget (`:354`) and the pixel-ratio cap (`:231`; `AdaptiveDpr.maxDpr` is readonly) are fixed when the view is built, and switching live would mean rebuilding the terrain layer with its relief and sky-view shading (`:343-348`). An "apply now" is not planned.
- **Adaptive pixel ratio stays on in every case** as the safety valve: it lowers the ratio by 0.25 after 1.5 s under 30 fps (or 80 % of the frame-rate cap) and restores it after 5 s of headroom, never below 1 (`src/render/perf.ts:67-125`). The statistics show how many times it fired (D16).
- **Memory estimate:** `workingMemoryForScenario(s, { renderQuality })` (`src/scenario/memoryModel.ts:146,270,299`) assumes `'medium'` unless told. The Data sets screen (`src/ui/screens/datasets.ts:448`) passes the resolved quality so its estimate shows what High costs. The build-time estimate (`src/scenario/build.ts:393`) keeps its default, because passing it through the request would put a device setting into the scenario data; the first task checks this.

### 9c.4 Files, tests, acceptance
- **Files:** `src/ui/settings.ts`, `src/ui/screens/settings.ts` (the row and hint), `src/ui/modules.ts`, `src/ui/screens/sim/simScreen.ts`, `src/render/SceneView.ts` and `api.ts` (read-only facts, `guessQuality` export), `src/ui/screens/datasets.ts`, docs.
- **Tests:** the `resolveRenderQuality` table; `guessQuality` boundaries (8 cores / 6 GB, 4 / 3, missing values); settings default and sanitise (`src/ui/settings.test.ts`, `settingsScreen.test.ts` updates); the hint logic as a pure function. E2E: set High in Settings and start a run (a debug hook reads `view.renderQuality`, and the statistics screen says "High (set by you)"); the same for Low; Auto with Detail gives High; Auto with Balanced equals `guessQuality` of the page's own `navigator` values; tree sway defaults off on Low. Draw-call and triangle budgets are checked per tier.
- **Acceptance on your phone:** Settings, Picture quality, High; start a new model: visibly denser terrain and trees; the statistics screen says High (set by you) and shows the frame rate, ratio drops and memory; Auto returns to the guess.
- **Size:** S. Ships with 0.3.0 (the statistics screen shows its result), but it does not depend on A to work.

---

## 9d. Workstream H: Cliffs (0.3.0)

You asked for cliffs that look and behave more like cliffs: they are not vertical, they have no features, and you doubted they play a realistic role in the simulation. You then decided three things (D17, D18, D23): it goes in the **next release (0.3.0)**; **results may change**; and the **sharpened cliffs are always on** (no setting, no data-faithful mode). It has two lanes: **H-look** changes only what is drawn; **H-sim** changes what the fire does and lands last (9d.5). It sits after G only to keep the other section numbers stable.

### 9d.1 What the user gets
- **Cliff faces drawn near-vertical,** with a crisp lip and foot, lit from the 10 m terrain, with ledges that catch the light, vertical joints, dark overhang bands, water stains, scree below the face and bare pavement on top. Trees stand on gentle ground and ledges, not on bare faces. Always on, in every picture-quality tier (the tier only trims the detail). Vertical exaggeration still works.
- **In the fire model a cliff means bare rock, not just steep ground.** Steep forest (which burns, and fast) is no longer a wall. Part-rock cells slow the fire, mostly-rock cells stop creeping fire, and narrow vegetated gullies through a rock band stay open, so fire runs up chutes and not across faces. Embers still cross everything; the existing "Fire crossed the break" card now says so for rock bands.
- **Honesty, without a switch.** The simulation, the slope overlay, the elevation numbers and the cards always use the terrain as received. The Data sets Terrain card says "Cliff faces are drawn steeper than the data so they read as rock walls. Fire, wind and slope numbers use the data as received", and Help has an entry (ground rule 10).
- **Results change around cliffs** compared with 0.2.2 (the same seed spreads differently near rock bands). The release notes say so; runs stay deterministic.

### 9d.2 Why they look and behave as they do today
Section 2 ("Cliffs") has the measurements. In short: the data is a stereo-derived 10 m model whose faces are 60 to 80 degrees; the mesh blurs and decimates it to 22 to 40 m; the lighting and rock tint come from the 30 m fire grid; the strata change colour only; trees have no slope rule; the simulation turns slope over 45 degrees (30 m mean) into an impassable wall whether it is rock or forest; and nothing else (embers, air, cards) knows about cliffs.

### 9d.3 H-look design (display only; results unchanged)
1. **Sharpened terrain** (`src/render/cliffSharpen.ts`, pure, node-tested). Input: the scenario's 10 m terrain. Output: a sharpened copy used only for drawing (mesh, picking height field, cast shadows and sky view, lighting gradients, rock mask); the simulation never sees it. The rule, tuned in spike S5: (a) a weight per cell `w = smoothstep(48, 62, slope)` from the 3x3 Horn slope (the same operator as `src/terrain`), spread one cell outwards at 0.6 so the shoulders take part; (b) for cells with `w > 0`, sample the terrain along the fall line (the gradient direction) up to 3 cells each way (bilinear), take the minimum and maximum, and move the cell toward whichever is nearer in height by `w` times the distance, doing nothing when it sits within 0.5 m of the middle, so a straight ramp is left alone; (c) a despike pass pulls any cell that stands 10 m or more above or below all eight neighbours back to just past them. Moving along the fall line, not in a square window, keeps gullies as slots: a square 7x7 window did the same job on the prototype but overlapped the drainage network only 0.78 to 0.88, against 0.86 to 0.94 for the fall-line version.

   **Prototype on the four bundled sites** (throwaway script, whole grid, not yet optimised):

| Site | Steepest slope in the 10 m terrain, data to new | Area over 70 degrees, data to new | Mesh edges over 70 degrees, High, today to new | Steepest mesh edge, High, today to new | Steepest mesh edge, Low, today to new | Drainage overlap |
|---|---|---|---|---|---|---|
| Katoomba | 83.2 to 85.0 | 0.52 to 0.97 % | 0.12 to 0.60 % | 78.0 to 83.5 | 73.2 to 79.1 | 0.92 |
| Kanangra | 82.8 to 86.2 | 0.16 to 0.98 % | 0.02 to 0.47 % | 79.9 to 85.3 | 75.9 to 81.3 | 0.94 |
| Grose | 84.0 to 86.2 | 1.09 to 1.45 % | 0.44 to 0.87 % | 80.8 to 85.4 | 76.4 to 81.9 | 0.86 |
| Tomah | 73.5 to 81.7 | 0.02 to 0.79 % | 0.00 to 0.31 % | 67.3 to 79.2 | 60.7 to 72.3 | 0.91 |

   About 4 to 7 % of cells move, by 8 to 19 m on average (up to about 120 m where a face collapses to a step); the despike fixes 1 to 86 cells per site and none are left. It took 0.45 to 0.54 s in node for the unoptimised whole grid; gated to steep tiles it should be under 150 ms, about 400 ms on a phone `[est]`. **S5 (done 2026-10-13, `docs/plans/spikes/S5-cliff-look/`)** re-ran this table with the optimised function: every entry reproduces to the printed digit, and the optimised function differs from the probe by at most 1.2e-4 m in any cell. It takes 28 to 32 ms in node and about 65 ms cold in a desktop browser (a phone `[guess]`: about 180 to 330 ms at 2.7 to 5 times). Two entries sit slightly outside the ranges above (Grose's mean move is 20.9 m, Tomah's largest move is 54.5 m). The rule and its constants stay as written. Its side effect is terracing: faces that meet 55 degrees again within three cells below their foot go from 6 to 12 % of faces in the data to 19 to 23 %. Strength 0.6 brings that back to 6 to 9 % and costs steepness (Kanangra 0.29 and Tomah 0.13 against the 0.3 % acceptance number), so it is the fallback if the phone says terraces look wrong. No rung of the fallback ladder is needed once the slope comes from the mesh (9d.3.3).
2. **A mesh that keeps the edge** (`decimateTerrain`, in a new render-only file such as `src/render/terrainMesh.ts` and not next to `decimateGrid` in `fields.ts`, which is bundled in the entry chunk because the Data sets screen imports it: S2). Today the 10 m terrain is box-blurred and sampled at 22 to 40 m. New: the same blurred value on gentle ground, and the unblurred bilinear sample where the vertex's footprint is steep (blend `smoothstep(40, 55, max 10 m slope in the footprint)`), so a step stays a step between adjacent vertices. On ground under 40 degrees it returns exactly what `decimateGrid` returns for the same input (test). A face under about 60 m still reads as a ramp on a 22 or 40 m mesh (a resolution limit); the lighting and rock detail carry it. **S5 additions:** (1) a despike on the finished mesh, because the blend samples the unblurred terrain at single vertices and 13, 12, 20 and 1 vertices per site at High stand 10 m or more above or below all eight neighbours (up to 44 m; today 0): 10 m at High and Medium, 18 m at Low, 2 m margin, which removes them and leaves the edge statistics unchanged; (2) `decimateTerrain` takes 61 ms cold in a desktop browser against 24 ms for `decimateGrid` (about 165 to 305 ms on a phone `[guess]`; section 11 says 100 ms), so optimise its footprint scan or raise that budget. The mesh stays within 1 degree of the best any mesh can do across a step (4 degrees in the worst phase at 40 m). **Steep-patch refinement** (10 m triangles in steep zones) is **not built for 0.3.0** (S5): at 1100 m a 22 m mesh is as good as a 10 m mesh for tall faces; faces under 60 m are 30 to 55 % of the lips at Kanangra and Tomah and are not walls either way; the cost is +124,000 to +310,000 triangles at High (10 to 24 % of quads), 1.6 to 2 times the +50,000 to 150,000 estimated here, and its stitching is unbuilt. Revisit if phone check-list item 7 says short faces look wrong, as High only, quads at 55 degrees or more.
3. **Lighting from the 10 m terrain.** The shader's normals, slope and strata come from a gradient texture built from the fire grid (`terrainLayer.ts:537-546`), so faces are lit as gentler slopes than the mesh draws. New: build it from the sharpened 10 m terrain (`hornGradient`, `fields.ts:73`; RG16F, 3.2 MB for a 9 km area; `uGradXf` from that grid), with the fire-grid gradient kept as the fallback when a scenario has no 10 m terrain (the mock, synthetic terrain). Hillshade, sky view and cast shadows stay on the render mesh (`SceneView.ts:343-348`) but are now computed from the sharpened mesh, so cliff shadows sharpen too.
   **S5 correction: one texture must not do both jobs.** The 10 m sharpened gradient should give the normal (the relief, which is real: buttresses and gullies light up), but the `slope` that picks banded rock or photo (`steep = smoothstep(0.85, 1.6, slope)`) must come from the render mesh's own gradient (the one `lightTerrain` already computes for the hillshade; 400 x 400 RG16F, 0.64 MB at High, or a per-vertex attribute). With one texture the picture has serrated lips and feet wherever the aerial photo is on (dark teeth, icicles, slits and voids, spikes up to 40 % of the wall's height at Low), because the 10 m slope disagrees with a 22 or 40 m triangle by up to one vertex spacing and the photo-versus-rock switch draws the disagreement. The cost of the mesh slope is a wider rock band seen from above (60 to 70 m against 28 m on a sharpened face), a tuning of the smoothstep (set for a 30 m gradient). The 10 m lighting costs about 74 ms to build on a desktop (not in the CPU budget before) and 3.2 MB plus the 0.64 MB on the GPU. The rock mask below is classified at 10 m and drawn on the mesh, so it will have the same problem unless it agrees with the mesh (inference, not tested): build R from the mesh's slope, or widen it by one vertex spacing.
4. **Rock mask** (`src/render/rockMask.ts`, pure). An RGBA8 texture at 10 m: R = bare steep rock `smoothstep(52, 62, slope) x (1 - canopy cover)` (cover from the fuel map, bilinear), G = scree `(slope 22 to 40 degrees) x rock within 80 m uphill`, B = lip pavement `(slope under 15 degrees) x rock within 40 m`. It replaces the rock tint ramp of `groundColours` (`fields.ts:159-203`) for shading; the fire-grid albedo stays the base colour. About 3.2 MB on the GPU for a 9 km area plus a 0.8 MB CPU copy of R for tree placement.
5. **Rock detail in the terrain shader** (`terrainLayer.ts:141-192`, one new `uRock` sampler: 11 of the 16 fragment units). Evaluated only where R is above 0.25 and faded by the pixel-size terms the strata already use (`uPixelMetres x vDist`, `fwidth(vZ)`), so nothing shimmers in wide views: (a) ledges: a stepped profile of height on the existing 7 m and 25 m scales that perturbs the normal as well as the colour; (b) vertical joints: thin dark cracks from noise along the face; (c) overhang bands: darker ambient under each ledge; (d) water stains: noise stretched along height, ochre and dark; (e) scree (G): coarse grey-brown speckle; (f) lip pavement (B): pale rock patches with a heath tint. With imagery on, rock pixels blend the aerial photo with banded sandstone by the rock mask and not by the gradient, so photo smear never shows on a face. Tiers (from Picture quality, G): High has all six; Medium drops (b) and (c); Low keeps (a), (d) and (e). Under the Plain map type or a solo heat map the detail drops to normal-based lighting at about 40 % so overlays read. Budget: under 1.5 ms p95 added on the phone `[est]`, one more texture fetch per ground pixel.
6. **Trees off bare faces** (`vegetationPlacement.ts:293-303` and `SceneView.placeVegetation`). The CPU copy of R rejects a candidate position at 0.5 or more (a deterministic hash re-draw) and thins at 0.2 to 0.5; sparse shrubs on ledges use the existing Heath and Understorey families.
7. **Everything that follows the drawn ground** (`HeightField`, picking, the camera clamp, flames, smoke bases, places, the 3-D curtain) is built from the sharpened mesh, so it agrees with what is drawn. Numbers (slope overlay, explain cells, any elevation shown to a person, and the Air Slice panel's terrain silhouette in workstream D, which draws the 10 m terrain as received) keep using the unsharpened data. The fire, fuel and imagery textures stay on their own coordinates: only heights change, so nothing is shifted sideways, and the drawn lip and foot can sit up to about three cells (30 m) from the data's.
8. **Interactions.** Vertical exaggeration multiplies the sharpened heights as it does today. Night lighting (F) shades rock like any ground. Picture quality (G) sets the detail tier. The statistics screen (A) gets terrain rows: share of cells sharpened, sharpen and mask build times, mesh vertices and triangles, detail tier.

### 9d.4 H-sim design (results change)
1. **Bare-rock fraction per fire cell.** `Terrain.rockFraction?: Float32Array` (`src/core/types.ts:55-58`, next to `cliffFraction`). `fireTerrainFromHiRes` (`src/scenario/terrain.ts:68-129`) also counts the 10 m sub-cells at 55 degrees or more (`SCENARIO_PARAMS.rockSlopeDeg`, `src/scenario/params.ts`, `[H]`) and keeps the share as `steepFraction`; after the canopy step (`build.ts:198-202`; the fire grid is built first, at `:191`) `rockFraction = steepFraction x (1 - canopy cover)` using the fire-grid canopy cover. The bundled canopy is 20 m and the live raster is loaded only up to 3 km, so cover is coarse and heath under 2 m counts as bare. **S6 compared the estimators against the bundled aerial photos (done, 2026-10-13):** slope x (1 - canopy cover) is the one to carry forward (it calls 3 of 35 steep forest tiles walls, against 20 for slope alone and 35 for today's mask, though still 17 % of their cells against a ceiling of 10 %), the aerial greenness index cannot tell pale rock from forest and is dropped, and none passed, so H-sim moves to 0.3.1 (9d.5). **With no canopy data `rockFraction` is left undefined** and the model uses today's mask (`features.cliff` as now), so offline and synthetic terrains behave exactly as before; the dataset record says "Rock: slope only".
2. **Classification** in `computeTerrainFeatures` (`terrainFeatures.ts:814-835`). New fields on `TerrainFeatures` (`simTypes.ts:25-51`) and on `TerrainFeaturesData` (`terrainFeatures.ts:78-97`) are optional, so the test doubles (`src/atmosphere/testUtils.ts`, `src/explain/testing/simState.ts`) keep compiling: `rock[k]` (a copy of `rockFraction`), `chute[k] = drainage and trench >= 0.3 and rock >= 0.2` (the gully geometry the model already computes), and `cliff[k] = rock >= 0.5 and not chute`, the wall mask the spread model reads. Slope alone no longer makes a wall once rock data exists; `Landform.Cliff` stays a landform class and its legend label becomes "Cliff or very steep" (`palette.ts:520`, `src/ui/labels.ts:52`).
3. **Spread model** (`FireSpreadModel.refreshStaticFuel`, `:534-568`). Walls stay `NonFlammable`. A static `rockScale[k] = clamp(1 - rock / 0.5, 0, 1)` for cells with rock at 0.1 or more, floored at 0.6 in chute cells, multiplies the ellipse speeds and the VLS rate once, after `ellipseSpeeds` in `computeCell` (`:1370-1373`). No state arrays, no new random draws, nothing to checkpoint; `refreshFuel` (fuel edits) recomputes it. Steep forest now burns with the existing slope factor (capped at x16 from 40 degrees and flagged "beyond validated").
4. **Fuel inference and flags.** `infer.ts:54-55` rule 1 uses `rockFraction >= 0.5` when present (else today's rule); `fuelMap.ts:281-292` sets `FuelFlag.Cliff` from rock at 0.3 or more; `datasetStats.ts:192-241` shows "Bare rock" (and says "slope only" when that is the basis).
5. **Unchanged:** embers cross walls; rolling debris still runs down faces (`FireSpreadModel.ts:1939-1990`); the 3-D air is still smoothed to 35 degrees (`atmosphere/grid.ts:233-241`). Cliff-edge updraft and lee-separation terms are parked (section 15).
6. **Card wording.** The spot variant of "Fire crossed the break" (`src/explain/rules/fire.ts:435-461`) also treats cells where `features.cliff[k] === 1` as breaks, and the text (`src/explain/text.ts:745-767`) says "rock band" and "Rock stops creeping fire, not embers" when the longest run was rock. No new card kind (D22).
7. **Confidence.** Every new parameter is `[H]` with no published calibration; the cards keep 'rule-of-thumb'; the statistics screen shows wall, partial and chute counts and the estimator used, so your phone data can tune them.

### 9d.5 Order inside 0.3.0, spikes and the cut line
- **Spikes in M0 (section 10).** **S5**, sharpening and mesh on the real renderer: the four sites, each from an orbit view near the escarpment, top-down and eye level, screenshots reviewed for spikes, terraces, shimmer and odd lips, build timings, and the numbers in 9d.3 re-run (the measuring harness becomes a vitest file gated behind `FIRESIM_SPIKE=1`); fallback ladder: weaker gate, a one-cell window, lip-and-foot snapping only. **S6**, the rock estimator: three estimators (slope only; slope x (1 - canopy cover); slope with a greenness index from the bundled aerial photo) against about 20 hand-checked patches per site, reporting the wall, partial and chute shares.
- **S5 result (done 2026-10-13, `docs/plans/spikes/S5-cliff-look/`, 20 pictures, the numbers harness and a throwaway patch).** The table in 9d.3 reproduces on all four sites. Tall faces (160 to 190 m) read as straight steep walls with a crisp lip and foot at High and as softer walls at Low; the best picture is the 3 km view of Katoomba, a vertical cliff band where today there is a rounded curtain. Faces under about 60 m stay ramps (the mesh's limit). It is a wall, not yet rock: at 450 m and at eye level it is a plain striped sheet with the photo smeared down it, and rock detail (9d.3.5) was not in the spike. Two corrections (9d.3.2, 9d.3.3): despike the finished mesh, and take the slope for strata and photo from the mesh. Shimmer is not worse than today; no near-black pixels are added. One reviewer, still frames, software rendering, no phone.
- **S6 result (done 2026-10-13, `docs/plans/spikes/S6-rock-estimators/`).** Criteria were written and hashed before the first of 80 labels (one AI rater, 8 m photos). No estimator passed: slope only calls 20 of 35 steep forest tiles walls, slope x (1 - cover) 3 of 35 but 17 % of their cells (ceiling 10 %), and the greenness index catches none of the 5 rock tiles. Five rock tiles and no chute tile are too few to test wall recall or the chute rule, so the check is inconclusive as well as negative; top-down 8 m photos cannot see near-vertical faces. Before 0.3.1 the 80 tiles should be re-labelled by someone who knows the escarpments (a minute to re-score) and a second sample drawn from the cells the new rule would open.
- **Lane order.** H-look first (independent of results), H-sim last. H-sim's gates are the determinism spec (run against run), the chute tests (9d.6) and the slow suites; if the chute test or S6 misses its criteria, H-sim is held out of 0.3.0 and ships as 0.3.1 (D17), and H-look ships regardless.

### 9d.6 Files, tests, acceptance
- **Files, H-look:** new `src/render/cliffSharpen.ts` and `rockMask.ts` (+ tests); a new render-only `terrainMesh.ts` (`decimateTerrain`), `terrainLayer.ts` (constructor, shader, `uRock`), `SceneView.ts` (`setScenario` at `:333-348`, tree placement), `vegetationPlacement.ts`, `src/scenario/memoryModel.ts` (two GPU items and one main item, `:269-282`), `src/scenario/datasetRecords.ts` (Terrain note, `:93`), Help and Glossary. **H-sim:** `src/core/types.ts`, `src/core/simTypes.ts`, `src/scenario/params.ts`, `terrain.ts`, `build.ts`, `datasetStats.ts`, `src/fire/terrainFeatures.ts`, `src/fire/spread/FireSpreadModel.ts`, `src/fuel/infer.ts`, `fuelMap.ts`, `src/explain/rules/fire.ts`, `text.ts`, the landform labels.
- **Pure tests (node).** `cliffSharpen`: a 70 degree ramp with rounded shoulders becomes steeper and keeps its end heights; a straight ramp and all ground under 48 degrees are untouched bit for bit; a 15 m V-gully stays a slot (floor cell unchanged, drainage kept); no tower or pit of 10 m or more after the despike; bounded moves; deterministic; edges untouched; no NaN; a generous time guard. `decimateTerrain`: bit-identical to `decimateGrid` under 40 degrees; a 150 m step keeps at least 80 degrees between adjacent vertices on the 22 m mesh and at least 72 on the 40 m mesh (S5: 75.0 is the ideal for a step exactly between two vertices; the worst phase gives 72.7); after the mesh despike no vertex stands 10 m or more above or below all eight neighbours. `rockMask`: the three channels on synthetic faces; cover removes rock. `vegetationPlacement`: no tree where R is 0.5 or more; deterministic. `scenario/terrain` (`steepFraction`), `build` (`rockFraction` present and in range with canopy data, absent without it), `terrainFeatures` (wall, chute, rock), the spread model (a wall stops fire, part rock slows it by the scale, a chute passes it, determinism and checkpoint/restore bit-identical, `refreshFuel`), `infer`, `fuelMap`, `datasetStats`, the explain rules and text (rock-band wording), the memory model rows. Existing cliff tests keep passing because an absent `rockFraction` means today's rule (`terrainFeatures.test.ts`, `terrain.test.ts`, `build.test.ts`); new cases are added beside them.
- **Chute tests.** Fast suite: a synthetic escarpment (a 300 m plateau with a 60 m rock band and a 15 m vegetated gully through it), a point ignition at the foot, fixed weather and seed: the front reaches the top through the gully while at least 90 % of wall cells stay unburnt; with `rockFraction` removed the run equals today's. Slow suite: the same idea on Katoomba's steepest drained gully.
- **E2E (real engine).** Katoomba, orbit near the escarpment, on Low and High: screenshots decoded with `fast-png`: edge contrast on cliff pixels higher than today's (S5: weak, it rises 4 to 15 % in orbit views and not at eye level, and a serrated drawing passes it, so treat it as a necessary check only), no near-black or NaN pixels, draw calls unchanged, triangles within budget; the statistics screen shows the terrain rows; the Data sets Terrain card shows the disclosure; the determinism spec is unchanged; the heap-flat leak test and the console stay clean. New screenshots of the escarpment.
- **Acceptance numbers (from the prototype; S5 reproduced them, but they measure mesh edges and not the look, so a serrated drawing passes all of them; S6 re-checked the wall share):** on each of the four sites the High mesh has at least 0.3 % of its edges over 70 degrees (today 0 to 0.44 %) and its steepest edge is at least 79 degrees (today 67 to 81); no tower or pit of 10 m or more; drainage overlap at least 0.85; sharpen plus mask build at most 400 ms and 150 ms on the phone `[est]`; wall share at Katoomba about 0.5 % under slope x (1 - cover) (S6; today 3.3 %; the earlier "1.5 to 3.5 %" came from a slope-only rule), no wall cell with canopy cover above 0.6, and at least 90 % of steep drainage cells passable.
- **Acceptance on your phone:** check-list 1, item 7.
- **Size:** **L** (H-look) + **M** (H-sim).

---

## 9e. Workstream I: Tap on an icon (0.3.0)

Small and independent: it can ship first, even alone. It sits after H only to keep the other section numbers stable.

You said that when you tap an icon on the terrain it is hard to tell whether the app took the icon or you tapped the ground next to it and missed, and that the icon and a word or two about it should be in the popup.

### 9e.1 What the user gets
- **Tap an icon and the Why here? panel opens with a row at the top:** the icon exactly as drawn on the map, its name in a word or two, and one muted line of detail. Tap the ground and there is no such row, so the row's presence answers "did it take the icon?".
- **The question is about the icon's own spot.** The ring that marks the point being asked about jumps onto the icon. Today the point is wherever the finger's ray meets the ground, which for a pin standing above its tip, or an icon near the horizon, can be a long way from the icon.
- **Icons are easier to hit:** a tap within 22 px of an icon's centre counts (a 44 px target; the icons are 22 to 40 px).
- **Stacked icons:** the nearest wins and the row adds "+2 more icons here, zoom in to tell them apart".
- **The words:**

| Icon on the map | Name | Detail line |
|---|---|---|
| Blue dot with a white ring | You are here | Your phone's position |
| Red pin with a flame | Ignition point (or line, or area; the pin marks the first point) | Fire you marked, lit at 14:05 (+0 min); or Back-burn |
| Orange disc with a flame | Spot fire | Started by an ember at 14:32 (+1 h 12 min), 450 m ahead of the front; or Spot fire you marked |
| Red octagon with ! | Danger: Uphill run (the card's kind) | The card's title |
| Amber triangle with ! | Watch out: Ember shower | The card's title |
| Blue circle with i | Insight: Ridge top | The card's title |
| Small house (a dot when far) | Home | One marker per address |

### 9e.2 What happens today
- `onTap` (`src/ui/screens/sim/simScreen.ts:668-690`) calls `view.pickGround` and, in the Why tool, `askWhy` with that ground point. Nothing hit-tests an icon: `SceneViewApi` can only pick the ground and project a point (`src/render/api.ts:66-68`), and so can the 2-D mock (`src/ui/mockScene.ts:165,178`).
- The icons (`SceneView.refreshMarkers`, `SceneView.ts:796-839`) are screen-space sprites of constant pixel size, drawn without a depth test (`src/render/iconLayer.ts`): ignition pin 34 px, anchored at its tip so the picture stands above the point (`:171`); spot fire 26; insight marker 30 (40 when focused); you 22. All are under the 44 px the app uses for tap targets. Homes are small 3-D houses that become dots when far (`src/render/placesLayer.ts` header).
- The panel (`whyPanel.ts:100-165`) never mentions an icon: "Where you are" can say "Nearest home: right here" but not that a home was tapped. The point asked about lives in `WhyState` (`src/ui/screens/sim/context.ts:25-33`) and the ring is drawn at it (`simScreen.ts:810-813`).
- The words and shapes already exist: `SEVERITY_LABELS` (`src/ui/labels.ts:56-60`: Danger, Watch out, Insight) and `INSIGHT_KIND_LABELS` (`insightCard.ts:25-60`); the UI icon set has the same three shapes as the map markers, octagon, triangle and circle (`src/ui/icons.ts:86-88`), and a house (`:101`).

### 9e.3 Design
1. **Hit test (pure, `src/render/markerPick.ts`).** Candidates `{ marker, sx, sy, halfPx, rank }` in screen pixels. A tap hits when its distance to the centre is at most `max(halfPx, 22)` (homes 14); the nearest wins, ties by rank (you, ignition, spot fire, insight, home); it returns the marker and how many other candidates were also hit. A pin's visual centre is `sizePx / 2` above its anchor, because the shader anchors pins at their bottom centre.
2. **`SceneViewApi.pickMarker?(clientX, clientY): MapMarker | null`** (optional, so the hand-written fakes in tests keep compiling), implemented in `SceneView` from one list: `refreshMarkers` records, for every icon it draws, the `MapMarker` it stands for (ignitions, the last 48 spot fires, insights when the layer is on, you outside eye level), so what is drawn and what can be tapped cannot differ. Homes come from `contextLayers.homes` when the Homes layer is on, skipping homes hidden behind terrain with `lineOfSightClear` (the name labels use it). Projection is not clipped to the screen (an icon half off the edge can still be tapped) but excludes points behind the camera. `MapMarker` is `{ kind, x, y, time? }` plus what the words need: ignition shape and origin, spot fire (simulated or marked, distance from the front), insight (id, severity, kind, title). The mock gets the same method for its own markers (`mockScene.ts:573,609`).
3. **Tap flow** (`simScreen.ts:668-710`). In the Why tool: `marker = view.pickMarker?.(cx, cy)` and `p = marker ? [marker.x, marker.y] : view.pickGround(...)`, so an icon can be tapped even when the finger's ray misses the ground; the other tools keep the ground behaviour (D27). A pure `tapTarget(tool, marker, ground)` carries the rule and is tested. `WhyState.marker?: MapMarker | null`; `askWhy(p, refresh, marker)` keeps it through refreshes and drops a time-bound marker (ignition, spot fire, insight) when the view time goes back before it existed.
4. **The row** (`markerRow(marker)`, pure, `src/ui/screens/sim/markerWords.ts`): name and detail line per kind from the table in 9e.1, with the clock and elapsed time formatted as elsewhere in the panel; `whyPanel.render` puts it first in every state (loading, error, explanation). The picture is the map's own icon, so it cannot drift: the `Icon` enum and the atlas drawing move from `iconLayer.ts:12-155` into `src/render/iconAtlas.ts` (canvas and palette only, no three.js, so the UI can import it without pulling the 3-D code into the entry; `iconLayer.ts` re-exports them) and it exposes `iconGlyphUrl(icon, px)`, one cached data URL per icon. The home row uses the UI house icon (`icon('home')`) in the home marker's colour. The picture is decorative (`aria-hidden`); the words are the label.
5. **Style.** About ten CSS rules next to `.why-place` (`src/styles/sim.css:1525`); type from the existing tokens (no literal size under 14 px, `ui/styles.rules.test.ts`); no popup, toast or `role=alert` (the e2e popup watcher flags them).

### 9e.4 Files, tests, acceptance
- **Files:** new `src/render/markerPick.ts`, `src/render/iconAtlas.ts`, `src/ui/screens/sim/markerWords.ts` (+ tests); `src/render/iconLayer.ts`, `api.ts`, `SceneView.ts`; `src/ui/mockScene.ts`; `src/ui/screens/sim/context.ts`, `simScreen.ts`, `whyPanel.ts`; `src/styles/sim.css`; docs.
- **Pure tests.** `markerPick`: a tap inside the radius hits and just outside does not; icons under 44 px get the 22 px minimum; a pin hits on its body and its tip but not 30 px below the tip; nearest wins, ties by rank, the stacked count; a centre just off the screen can be hit and one behind the camera cannot; homes use 14 px and are skipped when the layer is off or the home is hidden by terrain. `markerRow`: name and detail for every kind and variant (ignition point, line and area, observed and back-burn; spot fire simulated and marked; every `InsightKind` and severity; home), the time formatting, the stacked line, the drop rule when the clock goes back. `tapTarget`: the marker wins in the Why tool and is ignored by the others, a marker works when the ground pick is null, and with neither it returns null. Every `Icon` has a glyph.
- **E2E (real engine).** `window.__firesim.view` is exposed in debug mode (`src/ui/app.ts:377`), so specs find an icon with `projectToScreen`. Mark an ignition with the fire tool and tap its icon (allowing for the pin's offset): the Why panel shows the row "Ignition point" and its point equals the icon's location, not the ray's. Tap 60 px away: no row and today's behaviour. Run to a time with insights and tap an insight marker: the row names its severity and kind. The other tools are unchanged; no popups flagged; a screenshot of the panel with an icon row.
- **Acceptance on your phone:** check-list 1, item 8.
- **Size:** **S**.

---

## 10. Releases, order and how the build would run

Sizes are relative single-builder effort: S under a day, M one to two days, L three to five days. With parallel agents the wall time is shorter.

| Release | Contents | Size | Done when |
|---|---|---|---|
| **M0 (before 0.3.0)** | Contracts commit (types only: `EngineInfo.perf`, `autoTune` fields, `SessionState.pace`, optional `AtmosphereView` fields, `airView.ts` helpers, optional `Terrain.rockFraction` and `TerrainFeatures.rock` / `chute`) so lanes can build in parallel; **spike S1** timeline signal placement (6.4); **spike S2** bundle baseline and trim candidates (dev-only code in the production bundle, dead code); **spike S3** a node micro-benchmark of the glyph generator (2000 glyphs x 10 segments through the sampler) to check the 8 ms estimate before workstream E is committed to; **spike S4** the night-lighting look tuned on the real renderer with screenshots (9b.3); **spike S5** cliff sharpening and mesh look on the real renderer; **spike S6** the bare-rock estimator against the aerial photos (both in 9d.5) | S | Spike notes committed; decisions D3, D10 and D19 to D21 informed |
| **0.3.0** (versionCode 6) | **F** night map lighting + **G** picture quality + **A** debug statistics + **B** honest speed + **H** cliffs (H-look, then H-sim last) + **I** tap on an icon | S + S + M + M + L + M + S | Section 12 gates green; phone check-list 1 (items 1 to 8) |
| **0.3.1** (optional) | Speed test button | S | Frozen kernels and CI reference |
| **0.4.0** (versionCode 7) | **C** air data foundation + **D** Air Slice side view | L + L | Gates green; oracle tests pass; phone check-list 2 |
| **0.4.1** (optional) | Time-lapse recorder for a pinned line | M | Memory within its 12 MB budget |
| **0.5.0** (versionCode 8) | **E1** glyph engine, height, Map view; **E1b** map colouring (optional); **E2** fire-felt raster (optional) | L (+ M for E2) | Gates green; phone check-list 3 |
| **No version (stretch goal)** | Photo-informed cliffs (section 15b, D29) | M, plus L for a photogrammetry patch `[est]` | Not scheduled; becomes a workstream only when you say so |
| **No version (stretch goal)** | Adaptive simulation quality (section 15c, D30) | not sized: a study comes first | Not scheduled; not to be studied straight away |
| **No version (stretch goal)** | Simulation validity checks (section 15d, D31) | not sized: recorded only, nothing researched | Not scheduled; becomes a study only when you say so |

**Dependencies:** B needs A's `EngineInfo.perf` (contract only, so they overlap); D needs C; E1 needs C; E2 is independent of E1 at the data level. H-look needs nothing (it reads G's resolved tier when present); H-sim needs S6 and the M0 contract types; I needs nothing; the Air Slice panel in D draws the terrain as received, not the sharpened drawing (9d.3).

**If you say "use a workflow"** each release runs like 0.2.0 to 0.2.2: a Build phase with lanes in parallel and clear file ownership, an independent Verify phase (a different agent per lane, re-measuring on the real app), a Fix loop, then Release (version bump in `package.json`, `package-lock.json` and `android/app/build.gradle`; `npm run build:cap`; `npx cap sync android`; debug APK; screenshots; docs; commit and push; APK handed to you).
- **0.3.0 lanes:** (1) worker and engine: `perfStats`, `simTypes`, `simulation`/`engineInfo`, auto-tune policy and its tests; (2) debug-statistics UI: screen, `deviceInfo`, `eventLog`, the three entry rows, `modelInfo` summary; (3) pace: `paceModel`, `paceSheet`, scrubber, top bar, transport CSS, session; (4) docs and e2e updates; (5) night lighting: `sky.ts` maths, uniforms, the shader sites and the Layers row (small and independent, so it can ship first); (6) picture quality: the setting, `resolveRenderQuality`, the view plumbing and the Settings row (small); (7) cliffs, look: `cliffSharpen`, `decimateTerrain`, the 10 m lighting data, `rockMask`, the shader detail, tree placement, the memory rows, the Terrain note and docs (after S5 and after lane 5's uniform work lands; it edits `terrainLayer.ts` and `SceneView.setScenario`); (8) cliffs, simulation: the rock fraction, the features, the spread scale, the fuel rules, the card wording and their tests (after S6 and lane 7's gates; lands last, and is the cut line, D17); (9) tap on an icon: `markerPick`, the `iconAtlas` split, the view method, the words and the Why row (small; it edits `simScreen.ts` and `whyPanel.ts`, so it starts after lane 6's one-line change to `simScreen.ts`). Lanes 2 and 3 start from the M0 contracts.
- **0.4.0 lanes:** (1) data first: sampler v2, layouts, flags, memory model, oracle tests (everything else waits for its tests to pass); then in parallel (2) slice model, panel and tool, (3) curtain refactor, gating and strings, (4) docs.
- **0.5.0 lanes:** (1) pure glyph engine and tests, (2) rendering, camera and layer wiring, (3) E2 data and memory, (4) UI and docs.

## 11. Budgets

**Bundle** (`scripts/check-bundle.mjs`, measured on `dist/` with `gzip -9`: all JS 956.7 kB of 1000, entry 185.4 of 195, CSS 122.2 kB of 135 raw; "kB" is 1024 bytes as the script prints it; spike S2 corrected the 953.8 and 184 first written here). The all-JS figure counts every `assets/*.js` including lazy chunks and the worker, so code splitting protects the entry budget but does not lower the total.

| Workstream | Estimated gzip added | Where it lives |
|---|---|---|
| A debug statistics | 6-8 kB | lazy chunk (screen, pure content, device info); about 1 kB of glue in the entry |
| B honest speed | 4-5 kB | pace model and scrubber glue in the entry (about 3 kB); the sheet is lazy |
| C air data | about 3 kB | entry (sampler) |
| D Air Slice | 14-18 kB | lazy chunk |
| E glyphs | 10-14 kB | lazy chunk |
| F night lighting | about 1 kB | entry (`sky.ts` maths, panel row) |
| G picture quality | under 1 kB | entry (settings, rule, Settings row) |
| H cliffs | 6-9 kB | the 3-D view's code (sharpening, mesh, rock mask, shader strings) lands in the lazy `render-*.js` chunk when only the 3-D view imports it; `decimateTerrain` therefore goes in a render-only file and not in `fields.ts`, which is in the entry because the Data sets screen imports it (S2); and about 2 kB in the worker (rock fraction, features, spread scale), which counts about 4 kB in all JS while the in-thread engine copy exists |
| I tap on an icon | about 2 kB | the pick logic, the words and the Why row in the entry (there is no sim-screen chunk: `simScreen.ts`, `whyPanel.ts`, `sheet.ts` and `insightCard.ts` are entry modules, S2); the view method in the render chunk; the atlas drawing only moves between modules |
| **Total** | **46-61 kB** | against **46 kB** of headroom |

Running total after each release [est, on the first-written baseline]: about 977 kB, 996 kB, 1008 kB. **Spike S2 result (2026-10-13):** on the measured baseline of 956.7 kB the same increments give 979.9, 998.9 and 1010.9 kB (high estimates 982.9, 1003.9 and 1017.9), which passes 1000 kB during 0.4.0; after the safe trim set (T1 GeoTIFF decoders 73.3 kB, T2 pako 13.9, T6 the fuel barrel 6.9; 94.0 kB measured, 956.7 to 862.7) they are 885.9, 904.9 and 916.9. So: lazy-load everything heavy, do the safe set as the first task of 0.3.0 (25 added lines in `vite.config.ts` and one deleted line; `check-bundle.mjs` fails if a decoder returns), and keep the decision rule of D10. Dropping the in-thread engine copy (T3b) and the demo engine (T4b) from the APK build would free 140.6 and 15.0 kB more; both are documented fallbacks, so they wait for your answer, and if the answer is no the lazy versions (T3a, T4a) free nothing but stop 425 kB of parsing at start-up. The entry budget is the tighter one: the entry-resident additions of this plan are about 11 to 17 kB against 9.6 kB of headroom, so take T5a (the model card loaded on first open, minus 21.2 kB of the entry) in 0.3.0. Every kB added to the engine counts twice while the in-thread copy exists. CSS: A 2 kB + B 1 kB + D 4 kB + E 2 kB + I 0.3 kB = about 9 kB against 12.8 kB (H adds none). Layers-panel DOM: +6 nodes from E and about +12 from F, against 86 spare (H adds none: there is no setting). Demo data and APK size are unaffected.

**Memory** (6 h run, per the survey's keyframe maths; the history store cap is 6 % of device memory, 48-168 MB):

| Item | Added | Notes |
|---|---|---|
| Fast-tier diagnosed volume | +0.49 MB per keyframe, about +35 MB | thinning starts earlier on small phones |
| Fire-felt raster (E2) | +3 to +12 MB | Int16, 60 m |
| Recorder (0.4.1) | <= 12 MB | thinned |
| Cliff drawing data (H) | about +4 MB main and +6 MB GPU for a 9 km area (about 1.8x at 12 km); about +10 MB peak while the scenario is set up | sharpened copy 3.2 MB and a 0.8 MB rock copy on the main thread; gradient and rock textures 3.2 MB each on the GPU, plus the mesh gradient 0.64 MB (S5); shown in the Data sets memory estimate (`memoryModel.ts`) |
| Debug statistics | < 16 KB worker, < 60 KB main | |

The debug statistics screen shows frames kept, thinned frames and the heap, so the real effect on your phone is visible in one copy.

**CPU:** slice update <= 8 ms p95; glyph rebuild <= 8 ms per slice (1 to 3 slices) and >= 250 ms apart while moving; pace model O(1) per frame; always-on statistics < 1 % of step time; cliffs (once per scenario load, on the phone `[est]`): sharpening at most 400 ms, rock mask at most 150 ms, mesh decimation at most 100 ms (S5: not met by the prototype, see 9d.3.2; the 10 m lighting gradient adds about 74 ms on a desktop). **Render:** section 9.8; cliff shader detail at most 1.5 ms p95 added, triangles inside the 1-1.5 M budget (steep patches are not built for 0.3.0, S5).

## 12. Verification and phone check-lists

**Per change (fast loop):** `npx tsc --noEmit -p .`, `npm run test:fast` (`FIRESIM_SKIP_SLOW=1` skips only `validation.test.ts` and `session.insights.sim.test.ts`), the e2e spec for the area by file name. **Per release:** full `npm test` and, because the tier policy and views change, the slow suites with `SLOW=1` (V6, V7, V20, V21 and the standard variants; `validation.test.ts` part A starts below the Narrow Neck cliffs on the production Katoomba scenario, so any change in its numbers from the cliff rules is explained and not silently re-baselined); the full e2e suite; `npm run check:bundle` on a `build:cap` build; `npm run check:contrast` (four looks); `scripts/audit-tap-targets.mjs` and `scripts/layout-budget.mjs`; the heap-flat leak test; the network audit; regenerated screenshots (`docs/screenshots`, 55 today). New specs pin their tier explicitly; the determinism spec keeps forcing Fast.

**Phone check-list 1 (0.3.0):**
1. Menu: "Simulation debug statistics" sits directly under Settings. Open it, tap Copy, paste into a message to me.
2. Start a run in Auto: the tier line says Detailed with the measured step and the minutes it should take.
3. Set playback to 600x or faster: within about 20 s a small amber button appears at the right end of the timeline; tap it, read the sheet; tap "Play at 30x" and watch it fade.
4. After about 5 minutes of play, copy the statistics again (speed history, where the time went, memory, frame rate, events).
5. At night (start a scenario in the evening, or scrub past dusk): Layers, Map type, Night lighting. Try Brighter and Daylight: the terrain, trees and roads should read as by day while the sky stays dark and the fire still glows. Reopen the app and check the choice is remembered.
6. Settings, Simulation, Picture quality: set High and start a new model (it applies to the next model you build): denser terrain and trees; the statistics screen says "High (set by you)" and shows the frame rate and memory. Set Auto again to return to the guess.
7. Cliffs: open Katoomba (or Kanangra or Grose), orbit to the escarpment. Faces should read as near-vertical rock with a crisp lip and foot, ledges and joints, scree below and no trees on bare faces; zoom from far to eye level and look for shimmer, spikes or stretched textures; try Picture quality Low and High. Start a fire at the foot of the escarpment and play: the front should climb through gullies and not cross bare faces, and when an ember lands beyond a rock band the "Fire crossed the break" card says "rock band". Data sets, Terrain: the sharpened-cliffs note and the bare-rock share are there. Copy the statistics and paste them (frame rate, memory, sharpening and mask times, wall / partial / chute counts).
8. Icons: tap the red pin of an ignition you marked, an orange spot fire, a triangle or octagon insight marker and, with Homes on, a house. Each should open Why here? with the same picture and a word or two at the top, and the ring on the map should jump onto the icon. Then tap the ground about 60 px beside an icon: there should be no icon row. In a dense town, check that taps meant for the ground are not kept taken by houses.

**Phone check-list 2 (0.4.0):** on both tiers, place a line with the crosshair and with a preset, read the probe at a ridge crest, switch chips, rotate to landscape, compare with the old curtain, scrub back and read "air from"; copy the statistics (memory, frames, thinned frames).

**Phone check-list 3 (0.5.0):** zoom from the whole area to a ridge and watch the ladder; try each height; check the captions; copy the statistics (frame rate, memory).

## 13. Docs, help and screenshots
README (feature list, "Controls", the transparency and performance sections, the numbers at 497-517 and 565-566), `docs/ARCHITECTURE.md` (new modules, `EngineInfo.perf`, the view layout and kinds, the pace model, budgets at 661-701; the "now" figures at 684-686 still show 2821 / 945 kB JS, 506 / 177 entry and 121.6 / 21.8 CSS, where the tree is 2857 / 956.7, 532 / 185.4 and 122.2 / 21.9: S2), `docs/DESIGN.md` (timeline signal, slice panel, glyph legend, screens table at 412-418), `docs/research/00-synthesis.md` mentions listed in 6.7 and 7.7, Help and Glossary entries (Night lighting, Picture quality, Cliffs and rock bands, Air slice, Diagnosed wind, Flow lines, Why is it slow?, Simulation debug statistics), the model card strings, release notes. Screenshots: refresh 05, add the debug statistics screen, the pace sheet, the night look (Realistic and Daylight), the slice panel (portrait, landscape, fast-tier diagnosed), the glyph zoom triplet. Cliffs (H): the `docs/ARCHITECTURE.md` terrain mesh paragraph (`:372-374`, which says cliffs are finer than the fire grid) and the new modules and rules; the README terrain and fire sections; `docs/research/01-terrain-fire-behaviour.md:299-300` (cliff cells as barriers) and `docs/research/06-embers-spotting.md` (the gorges-and-cliffs card) get a note on what is implemented; `docs/research/10-firefighter-education.md:277-280` keeps its literature-gap note; screenshots: refresh every one that shows cliffs and add an escarpment close-up. Icon taps (I): the README Controls section and the Help entry for Why here? ("tap an icon to ask about it"), `docs/DESIGN.md` (the panel's icon row), a Glossary entry "Map icons" with the words table from 9e.1, and a screenshot of the panel with an icon row.

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
| Glyph cost on a phone is estimated, not measured | Spike S3 measured it on a desktop: direct sampling misses 8 ms at 1200 and 2000 glyphs, the raster design fits every cap. What is left is the phone factor (one data point, 2.35); check by timing 100 rebuilds on the phone before the caps are frozen. Per-tier glyph caps, sliced rebuild, self-trim from `renderer.info`, fallback to straight arrows |
| A diagnosed slice mistaken for the fire's wind | Labelled on every slice, glyph and legend; the callout; night and valley caveat spelled out |
| Close-zoom curves read as more accurate than they are | Captions say "smooth fit through the model" or name the 60 m raster |
| Policy change alters results on phones that used Fast | Release notes and the reason line say so; users can pick Fast; results stay deterministic per tier |
| Clipboard refused by the WebView | Selectable-text fallback (tested) |
| `performance.memory`, long-task or battery APIs missing | Rows say "not available"; tested with stubs |
| Narrow phones (360 px) | Panel and sheet also checked at 360x640 |
| Test-suite runtime growth | New logic is pure and fast; slow suites stay gated |
| Night lighting touches shared uniforms and shaders used by the ground, trees, roads, smoke and the sky | Pure blending maths with a "Realistic is bit-identical to today" test; the shader audit table (9b.3, audited by S4); the sky dome and the smoke body move to their own uniforms; e2e luminance checks; spike S4 measured the look on the real renderer |
| Forcing High picture quality on a small phone makes the app slow or gets it killed by Android | Auto stays the default; a non-blocking hint when High is chosen on a phone the guess calls Low; the adaptive pixel ratio stays on as the safety valve; the statistics screen shows tier, memory, frame rate and ratio drops; it applies only to the next model |
| Sharpening creates spikes, terraces, shimmer or odd lips | A fall-line rule with bounded moves and a despike pass; the prototype leaves none of 10 m or more; spike S5 reviewed screenshots on four sites from three viewpoints: serrated lips and feet came from the lighting (fixed by taking the slope from the mesh), vertex spikes from the mesh (fixed by a despike), terracing doubles to triples (strength 0.6 is the fallback), shimmer is not worse; display only, so no result can be affected |
| The drawn cliff drifts from the simulation's cells at lips and feet (up to about 30 m) | Only heights change, never positions, so fire, fuel and imagery textures stay registered; rock cells cannot burn; every number uses the terrain as received; the Terrain card and Help say the drawing is sharpened |
| Mesh lips are quantised to the 22-40 m vertices and look jagged | The blend keeps blur on gentle ground only; the 10 m gradient lights the faces, the mesh gradient picks rock or photo; S5 found refinement not needed for 0.3.0 |
| Rock detail costs too much on a small phone | Detail only where the rock mask is set, pixel-size fade, tiers (Low keeps three effects), the statistics screen shows frame time, the pixel ratio stays adaptive |
| The bare-rock estimate misreads heath under 2 m, shadowed rock or coarse (20 m) canopy | S6 against the aerial photos; with no canopy data the rule is today's; wall, partial and chute counts and the estimator are in the statistics; parameters are `[H]` and the cards say rule of thumb |
| Results near rock bands change from 0.2.2 and nobody can compare | The release notes say so; runs stay deterministic; the determinism spec compares run with run; the chute tests pin the new behaviour; H-sim is the cut line and ships as 0.3.1 if its gates fail (D17) |
| Churn in tests and screenshots (e2e luminance checks, screenshot baselines, Katoomba-based suites) | An absent `rockFraction` keeps today's rule, so the many synthetic-terrain tests are untouched; new cases sit beside the old; screenshots regenerated; `validation.test.ts` part A changes are explained |
| Memory on small phones while the scenario is set up (+10 MB peak) | Shown in the Data sets estimate and the statistics; buffers released after upload; measured on your phone |
| Taps meant for the ground are taken by an icon (dense homes, stacked spot fires) | Homes use a smaller radius and only count when the layer is on and the house is not hidden; the nearest icon wins; the row names what was taken and a tap beside it gets the ground; radii tuned on your phone (check-list item 8) |
| The hit area drifts from the drawn icon (pins stand above their anchor; sizes live in two places) | One pure function with the pin offset and tests; `refreshMarkers` records the tappable list as it builds the icons, so drawn and tappable cannot differ; e2e taps on and beside each kind |
| The picture in the panel differs from the icon on the map | The picture is the map's own atlas drawing; a test checks every icon has a glyph |
| A row for a time-bound icon goes stale when the clock goes back | `askWhy` drops the marker when the view time is before the marker's time |
| Moving the atlas drawing pulls three.js into the entry chunk | `iconAtlas.ts` imports only the palette and the canvas; the bundle check and a dependency test guard it |

## 15. Later (deliberately not in this plan)
GPU or WebGPU solver and finer time-stepped grids; adaptive simulation quality, spending detail where the terrain is complex and the fire matters (a stretch goal with its own section, 15c); checking how far the simulation can be trusted, against a precomputed reference run, other models, recorded fires and measurements (a stretch goal with its own section, 15d); a finer diagnosed terrain-wind solve (65-100 m, hourly, so CPU-affordable) for the fast tier, which changes the wind the fire feels and needs re-validation; true-height floating glyphs in orbit view; draggable slice handles; retroactive worker-side replay for slices; several slices at once; wind and temperature profile at a point and a time-height diagram; an Android "Share to FireSim" target; a one-finger-rotate option; saving statistics to a file. Cliffs: instanced rock pieces (overhangs, alcoves, jagged lips) near the camera; cliff-edge updraft for ember lofting and a lee zone scaled to face height (uncalibrated); OpenStreetMap cliff lines (`natural=cliff`, top on the left, drop on the right) for crisp lips and for areas outside the bundled sites (coverage unchecked: I could not reach OpenStreetMap from the sandbox); LiDAR-derived cliff detail where ELVIS covers a site (Blue Mountains coverage unconfirmed), baked into small cliff-line files and not bundled as whole terrain models; re-fetching steep zones at the service's native 5 m; sub-cell chute connectivity at 10 m; new cards (rock band reached, chute run, cliff above you: no escape route); an opt-in or data-faithful cliff look if ever wanted; photo-informed cliffs (a stretch goal with its own section, 15b). Icon taps: a near-miss hint ("the nearest icon is a Danger marker just above"); tapping an insight icon also opening its card in the Insights list; the icons and their words in the map legend; place names as tappable targets; a long press to choose among stacked icons; ringing the tapped icon with the existing focus ring; selecting an existing ignition with the fire tool.

## 15b. Stretch goal: photo-informed cliffs (in no version for now)

**Status: a stretch goal (D29). It is in no release, nothing is scheduled or built for it, and H (section 9d) is unchanged for it.** It becomes a workstream only when you say so, and then it gets a letter, a release and a place in section 10. It comes from your question whether a photo of a particular cliff could improve that cliff's geometry.

**The idea.** For a cliff you have photos of, make that cliff look and behave like itself, not only like the generic procedural cliff of H.

**What one photo can give**
- **Rock character:** ledge spacing, joint direction, how much is overhung, colours, stains and scree. It would set a per-cliff rock style for the H-look shader.
- **Bare versus vegetated:** shrubs on ledges, hanging swamps and vegetated gullies through a wall. Top-down data (the 8 m aerial photo, the 20 m canopy raster) cannot see these, and H-sim's rule depends on them (bare rock stops creeping fire, a vegetated chute does not). It would override that cliff's rock share and chutes.
- **The profile, from a side-on photo:** vertical, stepped or undercut. It would set how steeply that cliff is sharpened and how benched it is drawn.

**What one photo cannot give**
- **Metres.** Depth from one photo is a plausible guess; ledges 1 to 5 m deep on a face a few hundred metres away are smaller than its error.
- **Overhangs.** The terrain holds one height per point, so it cannot contain one. H draws them as shading; true overhangs would need separate rock meshes (instanced rock pieces, section 15).
- **Anything the fire numbers use at the metre scale.** The fire grid is 20 to 30 m and the air grid 150 to 200 m, so ledge shape changes only the picture. Rock versus vegetation and chutes are what change the fire.
- **A texture pasted on the face.** It looks right only from where it was taken and smears from every other angle, the same reason H keeps the aerial photo off faces (9d.3 item 5).

**Routes to real geometry (each a larger step of its own)**
- A few dozen overlapping photos or a drone pass, reconstructed on a computer (photogrammetry), then an importer that merges a fine (about 0.5 to 1 m) height patch into the drawn terrain around that cliff. Overhangs still flatten to near-vertical, and it needs a much finer local mesh than the optional 10 m steep-patch refinement in 9d.3 item 2.
- NSW LiDAR where ELVIS covers the cliff (coverage unconfirmed; LiDAR surfaces reportedly fill gaps on steep faces). Already parked in section 15.

**Could the photo tools run inside the app, offline? (a desk look on 2026-10-12: nothing built, nothing measured on a phone) Not recommended.**
- **The ordinary code could.** Mesh building, alignment and export are array maths on a crop of about 700 x 450 pixels, and three.js is already in the app. It is a few kB, but the all-JS budget is nearly full (956.7 of 1000 kB gzip, section 2), so it would be a lazy-loaded chunk or a budget change, which I would ask you about first.
- **The depth networks are the problem.** The four models the study ran are 1.34 to 1.64 GB each, against an APK of about 30 MB (budget 33 MB). Phone-sized options exist, all listed as Apache-2.0 (training-data licences unchecked): Depth Anything V2 Small is 99 MB, or 19 to 50 MB as ONNX exports for Transformers.js (4-bit, int8 and fp16 variants); Depth Anything 3 Small is 137 MB and Base 542 MB. They need an ML runtime, which the app does not have: ONNX Runtime Web is a 14 MB WASM binary (28 MB for the WebGPU build) plus 3 to 6 MB of JS, so the smallest setup is about 35 MB uncompressed, about as much as today's whole APK.
- **Speed and memory are unmeasured.** Research note 09 lists WASM threads and SharedArrayBuffer as unsupported in Android WebView and WebGPU there as unconfirmed, so the likely path is single-threaded WASM. A guess: seconds to tens of seconds for a small model, and the Large models' weights would not fit beside the simulation. A native Android plugin would be faster but is new native code and was not evaluated. Offline delivery would follow the area-pack pattern (an optional one-time download kept in app storage) to keep the APK near 30 MB.
- **Quality of a small model on this photo is untested.** Study 01 found that even the Large models disagree on steepness by tens of degrees.
- **Why not.** The output is not measured geometry, so it cannot feed the fire numbers (ground rule 10) and would need a "guessed shape" label (rule 4). What this section wants from photos (rock style, bare versus vegetated, profile) is preparation work, shipped as a small bundled data file, which is offline by construction like the vegetation and aerial layers. A "learner takes a photo" feature would be a different product (picture only, labelled a guess, the photo never leaving the phone), size L `[est]`, and is not planned.
- The details and sources are in the topic page, [On the phone, offline?](../../studies/cliff-from-photo/README.md#on-the-phone-offline).

**Sketch, if it is ever built**
- A per-site `cliffs.geojson` beside `vegetation.geojson` in `public/demo/<site>/`: for each mapped cliff a line or polygon, an optional bare-rock share, optional vegetated chutes, a rock style and the photo credit. It overrides what H computes (`Terrain.rockFraction`, then `TerrainFeatures.rock` and `chute`, 9d.4). Those optional fields are where an override lands, and the rock mask's alpha channel is unused in H's design, so a style id has room. An override raster would have to travel with the terrain to the worker; nothing in H blocks that.
- Honesty: the Data sets Terrain card says "hand-mapped from photos for N cliffs"; each photo-derived file carries an attribution and capture-date record like the other bundled data (`attribution` and `capturedOn` in the site JSON files, listed in `public/demo/provenance.json`); results change where an override applies (D23).
- Scale: hand-mapping every cliff does not scale. The realistic shape is procedural cliffs everywhere (H), a style calibrated per site from a few photos, and overrides for a handful of landmark cliffs. Size `[est]`: M for the style and overrides, and a further L for a photogrammetry patch.
- Groundwork happens outside the app, in the ongoing topic folder [`studies/cliff-from-photo/`](../../studies/cliff-from-photo/) (study 01, single-photo depth, 2026-10-12): what one photo gives, what it cannot, and the open questions. Nothing there changes the app or any release.
- Photos you send before then are only a visual reference when reviewing S5's screenshots and phone check-list item 7. They add no deliverable and no acceptance criterion.

## 15c. Stretch goal: adaptive simulation quality (in no version for now)

**Status: a stretch goal (D30). It is in no release, it is not to be studied straight away, and nothing is built for it.** It becomes a study, and later a workstream, only when you say so. Your question: is it possible to increase the quality of the simulation according to the complexity of the terrain and its importance to the fire?

**Short answer, from reading the code (nothing tested): yes in principle.** The usual way is a finer mesh or a nested domain where it matters, which is what coupled fire models do (research note 07 section 2.1: the atmosphere at one resolution and the fire on a finer mesh; WRF-SFIRE and ACCESS-Fire nest their domains). Today the app has fixed levels and one global choice:
- **Fire grid:** one cell size over the whole domain, 30 m, or 20 m in the high-detail setting for extents up to 6 km (`src/scenario/params.ts:20-23`). The elevation data is 10 m, so a finer fire mesh would use data that already exists.
- **The level set is already narrow-band:** spread rates are computed only for the unburnt cells within 4 cells of the front, and the time step follows the fastest cell (`FireSpreadModel.ts:6,717-731,804`). The fire's cost already follows the front; its detail does not.
- **Air:** one grid of 150 to 200 m over the whole domain, in a tier chosen once per run (Fast 2-D diagnostic, or Standard or High 3-D), with an ember cap per tier of 2000, 4000 and 4000 (`src/sim/params.ts:47`).
- **Terrain complexity is already measured per cell:** landform, drainage and trench scores (`src/fire/terrainFeatures.ts`), slope P90 and cliff fraction (`src/scenario/terrain.ts`). Only steep cells are candidates for the lee-separation and VLS terms (`FireSpreadModel.ts:363`), so some physics is already gated by complexity.

**What could adapt, cheapest first**
1. Which physics runs where: expensive terms only near the front or in complex terrain (extends the steep-cell gate above).
2. Embers: more particles, or finer steps, near the front and near homes.
3. The fire mesh: 10 m cells in boxes around the front where the terrain is complex, 30 m elsewhere.
4. The air: a finer 3-D nest around the fire inside a coarse or 2-D outer domain. This is also the lever that could make the Detailed (3-D) mode affordable on more phones.

**Two scores per area decide where.** Complexity: slope variance, curvature, gully and cliff measures. Importance: time until the front arrives, predicted rate of spread, homes in the path, and places where the behaviour regime changes (junctions, eruptive thresholds).

**Why it is not trivial**
- **Ground rules 1, 2 and 4 apply.** Refinement has to follow the terrain and the fire, never the load: a decision made to "keep up" is what rule 2 forbids, and one that depends on speed or display breaks rule 1. It has to be a pure function of the simulation state, the refined state has to be in the checkpoints so rewind and the determinism spec still hold, and the map has to say where detail is raised.
- **Uniform-grid assumptions:** snapshots (about 2 MB each), the layers, the scrubber's history budget, the heat maps and Why here? all assume one grid.
- **Calibration:** the spread formulas and their caps were set against 30 m and 20 m cells, and the sub-cell terms (cliff fraction, slope P90) already stand in for finer terrain, so finer cells risk counting the same terrain twice.
- **Interfaces:** where fine meets coarse (fire mesh edges, air nest edges) values must pass across without making the front jump.
- **Phone budget:** one 3-D air step was measured at 41 ms on your phone (section 2), so every extra cell competes with that.

**First step when it is investigated (not now):** a desk analysis that changes nothing in the simulation. Build a quality map (complexity x importance) for the demo sites and see how much of each domain needs fine treatment during a typical run. That sizes the possible gain before any design. The topic page is [`studies/adaptive-simulation-quality/`](../../studies/adaptive-simulation-quality/).

## 15d. Stretch goal: checking the simulation's validity (in no version for now)

**Status: a stretch goal (D31). It is in no release, it is recorded only, and nothing has been researched, studied or built for it.** It becomes a study, and later a workstream, only when you say so. Your question: how can we verify the validity of the simulation, perhaps against a precomputed high-quality simulation, and what other ideas are there? What follows comes from general knowledge and from reading the repository; dataset and tool names are from memory, and their availability, access and licences are unchecked.

**Short answer: a precomputed reference run is a good check, but it answers one of three different questions.**
- **Is the code right?** (does it solve its own equations as written?) Compare with known answers. The repository already does this: the spec's scenarios V1 to V22 (`src/sim/validation/`, run headless in Node) check slope, wind, ridges, night, spotting, lee-slope spread, wind change, determinism and more against the specification's formulas and published rules of thumb.
- **Is the answer converged?** (does it change with a finer grid, a smaller step, more embers or a richer tier?) Compare with **the same model run with more detail, once, offline**, which is your idea. It measures numerical error, including how much the Fast tier loses against Detailed, for which I found no measurement in the repository. It cannot say the model is right, because errors both runs share cancel out.
- **Is the model right?** (does it match the real world, for what a training app is used for?) Compare with measurements, recorded fires, another model or experienced people.

**What none of today's checks does:** compare a result with a recorded fire's perimeter, with another model or with a finer run of itself. V19 checks the inputs of the 19 December 2019 Gospers Mountain replay preset and that the fire runs; V21 checks the wind scale over flat ground only. The app already says part of this in *How sure are we?* (evidence tags, the open issues of spec section 16, a validation summary with three known gaps, and "not validated" on steep heads). The research notes list gaps: the coupling factor and wind height (note 07), the ember generation rate (note 06) and the acceleration constant (note 03) are uncalibrated.

**Ideas, roughly cheapest first**
1. Properties that must hold, with no reference: rotate the terrain and the wind and the result rotates; more wind never slows the head; more moisture never speeds it; a firebreak never raises the burnt area. Extends V1 to V22.
2. A claims register: every number or behaviour the app shows, with its source, the check run on it, the known error and what it was checked against. It is ground rule 4 applied to validity and would extend *How sure are we?*.
3. Golden scenarios: a small fixed set whose summaries are compared at each release, so a change in results (D23) is measured and explained, not discovered. Determinism (V18) makes it cheap.
4. The reference run and a convergence ladder (tiers, 30, 20 and 10 m cells, step sizes, ember counts) on the bundled scenarios, stored as small summaries (arrival-time raster, perimeters at set times, head rate of spread, ember landing percentiles). It is the same experiment as question 2 of the adaptive-quality topic (D30), so it is done once.
5. Sensitivity and ensembles: many runs with plausible input errors (wind speed and direction, moisture, ignition place) to show how much each output moves and which are robust.
6. Wind and weather data: hill-flow field campaigns (note 02 names Askervein Hill) for the diagnostic and the 3-D wind, and Bureau of Meteorology station data for wind, temperature, humidity and moisture patterns (note 08: the ground truth, but awkward to get).
7. Other models on the same inputs: coupled fire-atmosphere models (WRF-SFIRE and ACCESS-Fire, note 07) and operational spread tools (FARSITE, ELMFIRE, Phoenix RapidFire and Spark are the ones I know of). Mostly useful on the air and plume side, where no formula exists.
8. Measured fire experiments (published grass, shrub and forest burns, also the sources of the spread formulas) and hindcasts of recorded fires, scored by overlap of burnt area, area ratio and arrival-time error.
9. Expert review: experienced fire behaviour analysts and instructors watch replays of the note 10 cases and say what is wrong or misleading. For a training app, "does it teach the right lesson?" is a validity question.

**Pitfalls**
- Agreement is not accuracy: a reference from the same code shares its formulas, and models of one lineage agree with each other (as in the cliff study). A reference run measures numerical error only.
- In a hindcast the inputs (weather, fuel, ignition time) usually matter more than the model, so one run says little; it needs idea 5.
- Fire models amplify small differences and embers are random draws, so compare statistics over several runs (percentiles, overlap), never one trajectory.
- Decide the pass marks before running a comparison, tied to what the app teaches: relative behaviour (upslope runs faster, the wind-change flank becomes the head, embers cross a gully) matters more than an exact perimeter.
- Choose cases with care: note 10 recommends analogue terrain, not the real site, for replays of fatal incidents. Which recorded fires crossed the bundled sites, and what perimeter data exist, is unchecked.
- The repository is public: record the source and licence of every dataset (the `studies/` rules).

**First step when it is investigated (not now):** a desk exercise that changes nothing in the app: the claims register with a pass mark for each claim, which shows where the evidence is thin before any run is made. The topic page is [`studies/simulation-validity/`](../../studies/simulation-validity/).

## 16. What I need from you
1. Confirm or change **D2** (Auto ceiling), **D3** (timeline button, which the spike confirms), **D6** (crosshair placement first), **D7** (recorder later), **D9** (glyph layer opt-in), **D10** (bundle approach), **D13** (night lighting default Realistic) and **D14** (night lighting with 0.3.0, or alone first as 0.2.3), **D15** (Picture quality: Auto follows the phone, Detail asks for High, applies to the next model), **D16** (adaptive pixel ratio stays on), **D19** (the sharpening method, which spike S5 confirms), **D20** (a wall is bare rock, not slope alone), **D21** (part-rock cells slow the fire), **D22** (no new cards, wording only), **D24** (which icons are tappable), **D25** (hit radius: 22 px, homes 14), **D26** (an icon tap asks about the icon's own spot), **D27** (the Why here? tool only) and **D28** (icon taps with 0.3.0, or alone first as 0.2.3). Silence means the defaults. D17 (cliffs in 0.3.0), D18 (sharpened, always on), D23 (results may change), D29 (photo-informed cliffs are a stretch goal in no version), D30 (adaptive simulation quality is a stretch goal in no version, not to be studied straight away) and D31 (checking the simulation's validity is a stretch goal in no version, recorded only, nothing researched) are your decisions and are recorded.
2. Say **"go"** for 0.3.0 (F + G + A + B + H + I), and whether to run it as a parallel multi-agent workflow ("use a workflow") or directly.
3. After 0.3.0, paste the debug statistics from your phone; the thresholds in B and the budgets in C to E are then tuned against real numbers.
