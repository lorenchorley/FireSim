# D-CONTRACT-060-detail: wind detail icon (request 1) and detailed wind at the closest zoom (request 2)

Scout design for lanes D-engine, D-render, D-ui (base `489542c`). Facts are from the code unless marked [est] (estimate) or [open]. A throwaway prototype was looked at in the real renderer (software GL, no frame cost): `D-CONTRACT-060-detail.prototype.patch` (apply with `git apply`; not for merging), pictures in `/tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/lane-D-detail/shots/` (`shots/` below). Nothing was seen on a phone.

## 0. Decisions

1. **Level** = the 0.5.0 ladder (`planLod`, L0..L4 by pixels per model cell, edges 4/12/32/90, 15 % hysteresis). The icon shows the finest wind picture actually drawn as 0 to 4 pips plus words.
2. **The most detailed level (L4) changes what it draws**: from equal, parallel, straight flow lines to **GPU-animated detailed streaks** (tapered fading tails, random lifetimes, gust bands, eddy meander that gains octaves as you zoom, lift and lee from the 10 m ground). One draw call, zero JS per frame. Prototype result: section 8.
3. **Both switches feed it.** "Wind streaks" (`wind: 'surface'`, on by default: the owner's "wind streaks") and "Arrows and flow lines" show the same detailed picture at L4; the old particle layer is suppressed while it is drawn. `'volume'` streaks are untouched.
4. **Code home:** extend `WindGlyphLayer` (it owns plan, hysteresis, rebuild schedule, budget trim, stats; one owner, so chip and picture cannot disagree). New: pure builder `detailStreaks.ts` (fork of the glyph builder's seeding, longer trace, extra outputs), `detailBatch.ts` (shader), UI words and chip. No new layer class. Display only: nothing in the simulation changes.
5. **Icon:** a 44 px chip "Wind detail" with four pips, bottom-left, stacked directly above the legend card; a tap opens a bottom sheet of plain words (the slow-run sheet's pattern, in the top bar's popover group). Polled at 4 Hz, DOM touched only when the state changes.
6. **Honesty:** L4 adds eddies the model does not calculate; the sheet says so; colour stays the model's speed (legend unchanged); direction and speed along the flow are the model's.
7. **Reachability:** L4 is reached on both tiers and every size. The fast tier's cells are the same size as the standard tier's (`nTier` 45 for both; high 60), so nothing about the tier lowers the level; the tier only changes the words ("estimated, not simulated").

## 1. Facts

- Cell size `clamp(extent / nTier, 100, 270)` (`atmosphere/grid.ts`, `params.ts:22-33`): 133 m at 6 km, 267 m at 12 km (fast, standard); 100 m and 200 m (high). The fast tier's diagnosed view uses the same `grid.grid` (`diagnosticWind.ts` `view()`).
- Camera: fov 50 deg; minimum distance 40 m (orbit), 60 m (top), 0.5 m (eye level, nothing drawn) (`cameraRig.ts:131,163,288,310`). `cellPx = cellM x cssH / (2 tan 25 deg x d)` (node one-liner on those formulas).
- Pixels per model cell at the closest zoom, 6 km, 133 m cell: orbit 40 m: 3,270 (412x915), 2,290 (360x640), 1,390 (844x390); top 60 m: 2,180 / 1,525 / 929; smallest anywhere (100 m cell, 844x390, top) 697. L4 starts (103.5 px going up) at a camera distance of 1,264 m (412x915), 884 m (360x640), 539 m (844x390) for 133 m cells; 2,528 / 1,768 / 1,077 m for 267 m cells: L4 spans about 4.4 octaves of zoom, and at the closest zoom the whole screen (56 m tall) lies inside less than half a model cell, one smooth bilinear patch. That is why 0.5.0's L4 reads as a diagram (`shots/base-L4-120px.png`, `base-L4-900px.png`: parallel equal arrows).
- Old Wind streaks (`windLayer.ts`): 1,300 ('surface') or 2,600 ('volume') particles seeded over the WHOLE domain (`:67,89-91`), 12 m up, advected on the CPU every drawn frame; measured by a throwaway vitest on this machine: `animate()` median 0.55 ms (p95 0.92) for 1,300 surface particles, 1.58 ms (p95 2.67) for 2,600 volume, i.e. about 2 and 6 ms on the phone [est, 4x]. One particle per 28,000 m2 in a 6 km area: about 14 on screen at 1 km, 0.06 at 60 m (`shots/layout-412x915-streaks.png`: a handful of dashes). `layers.wind` defaults to `'surface'`, `windGlyphs` to false (`layers.ts:126-127`).
- Frame loop (`SceneView.ts`): `animating` includes `wind.currentMode !== 'off'` (`:1405-1411`), so the default app already draws continuously; pure animation is capped at 30 fps (`:1422-1423`); `dt` is capped at 0.1 s (`:1369`), so a hidden page resumes without a jump; `this.u.uClock` already accumulates that `dt`. No reduced-motion handling in `src/render` (`grep reducedMotion` is empty; `ui/dom.ts:154 prefersReducedMotion` exists).
- Reused as is: `planLod`/`visibleBox`, `rebuildReason`/`mayRebuild`, `SliceLog`, `HeightRaster`/`surfaceRaster`, `GLYPH_CAPS` 4,000/8,000/12,000 segments, `FRAME_TRIANGLE_LIMIT` 550,000. `StreakBatch` is NOT changed (embers, slice, glyphs share it).
- Budgets: entry 169.2 of 195 kB gzip, all JS 963.7 of 1,000. Layers panel DOM headroom 9 nodes: nothing new goes in that panel. Draw-call limit 25 is stale (16 to 29 before the glyphs).

## 2. Part A: the wind detail icon

### 2.1 State (pure `src/ui/screens/sim/windDetailState.ts`, entry chunk; imports only types of `render/api` and `render/wind/glyphTypes`, `core/airView`)

```ts
export type DetailKind = 'none' | 'arrows' | 'curves' | 'detailed' | 'overview' | 'volume';
export type DetailLimit = 'budget' | 'zoom' | 'cells' | 'estimated' | 'still';
export interface WindDetailInput { glyphsOn: boolean; streaks: 'off' | 'surface' | 'volume'; viewMode: 'orbit' | 'top' | 'ground'; stats: WindGlyphStats | null; air: AirKind; height: WindHeight }
export interface WindDetailState { visible: boolean; level: 0 | 1 | 2 | 3 | 4; kind: DetailKind; limits: DetailLimit[]; key: string }
export function windDetailState(i: WindDetailInput): WindDetailState;
```
Rules (one unit test each):
- `visible`: `stats` exists (3-D view) and (`glyphsOn` or `streaks !== 'off'`) and not (`viewMode === 'ground'` and `streaks === 'off'`) and not (`stats.idle === 'no-wind'` and `streaks === 'off'`). Glyphs on at L0 (a cell under 4 px) shows the chip with 0 pips: it says why nothing is drawn. The Wind speed map (`overlay: 'windSpeed'`) is not a wind mark here (follow-up).
- `level`/`kind`: glyphs drawn (`stats.active`): L1, L2 `arrows`; L3 `curves`; L4 `detailed` only when `stats.detail !== 'off'`. Streaks `'surface'` with nothing finer: `overview`, level 1 (moving streaks over the whole area that do not follow the zoom: honest, and it shows that zooming is what changes them). `'volume'`: `volume`, level 1. Both on: the finer. `idle: 'budget'`: level 0.
- `limits`, in this order: `budget` (idle budget); `zoom` (level < 4 and `kind` is arrows, curves or overview); `cells` (`stats.cellPx > 60`, the existing `GLYPH_SMOOTH_FIT_PX`, and always at `detailed`); `estimated` (`air === 'diagnosed'`); `still` (`stats.detail === 'still'`).
- `key` = `visible|level|kind|limits|height`: the DOM changes only when it does.

### 2.2 The words (pure `windDetailWords.ts`, loaded with the sheet on the first tap; the chip's label `chipLabel(level)` is in `windDetailState.ts`; exact strings; sentence case, "about" for numbers, no em dashes)
- Chip, visible text `Wind detail` (14 px) then four pips: filled circles for levels reached, rings for the rest (shape carries the level, not colour). Accessible name `Wind detail: level 3 of 4. Open the explanation.`; level 0: `Wind detail: not drawn yet. Open the explanation.` Icon `wind` (`icons.ts:25`) inside the pill.
- Sheet title `Wind detail`. Body, in order (only what applies):
  1. `Level 3 of 4: curved flow lines.` Names: 1 `straight arrows`; 2 `straight arrows, closer together`; 3 `curved flow lines`; 4 `detailed streaks`; overview `moving streaks over the whole area`; volume `moving streaks through the air`. Level 0: `Nothing is drawn at this zoom.`
  2. What and where: arrows, curves and detailed: height `fire` gives `Wind about 10 m above open ground.`, a number gives `Wind at about 100 m above the ground.` (`heightLabel`). Overview: `These streaks do not get more detailed as you zoom in, until the closest level.`
  3. `zoom`: `Zoom in for more detail.` (at `detailed`: `This is the most detailed level.`)
  4. `cells`: below L4: `The air model works on cells about 133 m wide. Between its points the wind is a smooth fit.` At `detailed`: `Direction and speed come from the air model, which works on cells about 133 m wide.` then `The small eddies are added for looks, from the shape of the ground. The streaks also move faster than the real wind so that you can see them.` (the number is `cellM` rounded; with none: `large cells`.)
  5. `budget`: `Not drawn here: this view already uses all the phone can draw. Zoom out or switch a layer off.` (`BUDGET_LINE`).
  6. `estimated`: `The fast tier's wind is estimated from the forecast and the shape of the ground. It is not simulated.`
  7. `still`: `Your phone is set to reduce motion, so the streaks stand still.`
- Truth tests: no em or en dash, no `!`, the eddies line exists whenever `kind === 'detailed'`, the sheet never says the eddies are the model's.

### 2.3 Where it sits and how it opens
- A `.wind-detail` chip in `simScreen.ts`'s root, positioned in `layoutInsets()` like the legend and credit: `left = colL + 12`, `bottom = legend.top + 8` (legend hidden: credit top + 8; both hidden: base + 12). It never touches the right-hand column, so `colH`, `fitsAt`, `fabs-crowded` and the Tools button are unchanged (a fourth round button would make the column 184 px and risk `fabs-crowded` hiding Layers and View at 844x390).
- **Measured with a stand-in chip (175 x 44 px)** at the three sizes: 412x915 [12,637,187,681] above the legend [12,689,..]; 360x640 [12,362,187,406] above [12,414,193,480] (weather chips end at y 112, right column from x 308); 844x390 [412,168,587,212] above [412,220,..] (top bar ends at 80). Overlaps with the pill, weather chips, round buttons, Tools, credit, dock and timeline: 0 at all three (`shots/chip-*-closed.png`).
- The explanation is a **bottom sheet** (`transportSheet({ title: 'Wind detail', testId: 'wind-detail-sheet', class: 'tp' })`) in the top bar's popover group, exactly as `paceSheet` hangs on the speed signal (`topBar.ts:102-157`): `topBar` takes an optional `windDetailButton`, adds `{ id: 'wind', button, panel, onOpen }`, loads `./windDetailSheet` on the first tap (so the words are not in the entry). Back, Escape, an outside tap, one popover at a time, `aria-expanded`, focus return and the landscape two columns come free. (A floating card was tried first and dropped: at 360x640 it needs 330 px and hits the weather chips and the right column; at 844x390 it has no room above the chip.)
- Hide rules as the legend: `.panel-open`, `.sheet-full`, `.drawing`, `.menu-open` hide the chip (CSS in `sim.css`). Tap target 44 x 44 (`chip chip-float`, `min-height: var(--tap)`); the sheet's close button is the shell's.

### 2.4 Render API (additive)
`WindGlyphStats` gains `detail: 'off' | 'moving' | 'still'` and `detailSegments: number`; `level` is now the zoom's level whenever the layer plans (glyph switch OR `wind === 'surface'`, not eye level), even if only the old streaks are on. No new accessor: the chip polls `view.windGlyphStats?.()`. `SceneViewApi.stats().windGlyphs` is unchanged.

### 2.5 DOM rate
`createWindDetail(ctx)` polls every 250 ms (`POLL_MS`) with `setInterval`, only while a wind layer is on, the screen is visible and the page not hidden (the `IntersectionObserver` + `visibilitychange` pattern of `windGlyphControls.ts:143-168`), and also on `layers.subscribe(['windGlyphs','wind','windHeight'])`, `ui.subscribe(['viewMode'])`, `session.state.subscribe(['snapshot'])`. It calls `windDetailState`, compares `key`, and touches the DOM (pips, labels, and the sheet if open) only when it changed: a still map costs one object read and one string compare four times a second; no `requestAnimationFrame`, no `aria-live`.

### 2.6 Tests (node)
`windDetailState`: every row of 2.1, plus a property test over {glyphsOn, streaks, viewMode, idle, level 0..4, air, cellPx in {2, 30, 61, 500}, detail} (`level <= 4`, hidden when nothing wind is on, `level === 4` iff `detail !== 'off'`); `windDetailWords` strings pinned exactly; `glyphWords.test.ts` for `LEVEL_LINE[4]`. e2e `wind-detail.spec.ts` (real engine: `?mock=1` has no 3-D view, so the layout and tap audits run here): chip shown with default layers at 412x915, 360x640, 844x390, at least 44 x 44, no overlap with `.map-fabs .fab`, `.menu-fab`, `.map-legend`, `.map-credit`, weather chips, dock, scrubber; the sheet opens by tap and closes by Escape, outside tap and Close; nothing opens by itself; no `role=alert`; a real pinch from 12 km walks the pips 1 to 4 with `stats.level`.

## 3. Part B: the most detailed level

### 3.1 The picture (five ingredients, each cheap)
1. **Streaks, not arrows:** a pulse travelling a traced line (the model's flow at the Wind height chip). Head thick and bright, tail fading and thinning (width x1 to x0.35, alpha 1 to 0); tail 24 to 90 px, longer when faster; no arrowhead (taper and motion give direction).
2. **Random lifetimes:** per line a cycle of +/-30 %, a random phase, a dead gap of 0 to 60 %, from an integer hash of the lattice cell.
3. **Gust bands:** a brightness envelope (x0.85 to x1.15) travelling along the flow (wavelength about 120 m), phase noised by position.
4. **Eddy meander:** time-varying noise displaces vertices sideways: scales 60 m (amplitude 20 m), 15 m (5 m), 4 m (1.2 m); an octave fades in only when its amplitude exceeds about 1 px, so **more detail appears the closer you zoom**. Amplitude x (0.25 + 0.75 `turb`), `turb` from the 10 m ground: rough ground and the lee of ridges meander more.
5. **Lift and lee:** the slope along the flow (10 m ground, over 30 m) gives `w = U . grad h` (not the model's w): windward lifts (alpha up to x1.12, drawn up to 3 m higher), lee sinks; in orbit view streaks rise over ridges. Above 10 m the ground terms scale by `exp(-h / 300)`.
Colour is `WIND_RAMP` by the model's speed (the glyphs' 64-bin table); the legend and `windGlyphLegend` are unchanged; an eddy never changes a colour. Drawn draped (D8: lift `max(1.5 m, 3 px)`, depth bias 40 m so canopy does not hide it): terrain-following; the Wind height chip sets where the wind is read, not where it is drawn (a 300 m stroke would sit above the camera).

### 3.2 Architecture (decided; alternatives rejected)
- **GPU-animated polylines.** The CPU builds lines only on a rebuild (the existing rules: pose change over `max(12 m, 10 %)`, new snapshot, height, level; at most 4 a second; never per frame). The animation is a pure function of the uniform `uTime` (= the shared `uClock`), so steady-state per-frame JS at L4 is zero (only `animating`). The layer passes `GlyphData.sliceGround` as `ground10` and `seed: 0`.
- `WindGlyphLayer` gains `setStreaksDetail(on)`, `setMotion(allowed)`, `get animating()`, `get detailShown()`. `tick` plans when `enabled || streaksDetail` (today it returns at `!enabled`) and builds glyphs only when `enabled`. At plan level 4 with detail wanted it runs the detail builder into `DetailBatch` and hides halo and colour; below 4 it is today's code. Triangle trim: `segmentCap` gets a `trianglesPerSegment` parameter (4 for the glyph pair, 2 for the detail batch).
- **Old streaks:** `WindLayer.setSuppressed(on)` (mesh hidden, `animate` skipped); `SceneView.frame` suppresses while `glyphs.detailShown && layers.wind === 'surface'` (so if detail is trimmed to nothing, the old streaks come back) and leaves it out of `animating`. `animating` gains `|| this.glyphs.animating`.
- Rejected: the old particle system with new parameters (CPU per frame, whole-domain seeding, one width, no taper, a noise per particle per frame); CPU particles with trails in the new layer (600 to 1,500 x 8 points x sampler, noise, ground: about 2 to 6 ms a frame on a desktop [est], 4x on the phone, against 22 ms the frame already costs); a second layer class (duplicates about 250 lines of pose, plan and schedule, and a second hysteresis state); `StreakBatch` alpha steps (quads overlap about 1 px per join, so translucent segments bead, and `uWidthPx` is per batch: no taper).

### 3.3 Batch and shader (`detailBatch.ts`; the prototype patch's `detailProto.ts` is the reference, constants are first guesses)
`DetailBatch`: its own `ShaderMaterial` on an instanced quad (the `StreakBatch` pattern), per-instance `aA`, `aB` (world ends, y exaggerated and lifted), `aC` (rgb display-linear, a = 1), `aD` (`s0`, `s1` arc length in px, `L` line length px, `seed` 0..1), `aE` (`speed` of the LINE m/s, `turb`, `lift`, `tail` px): 18 floats = 72 B a segment (864 kB at 12,000). Uniforms `uTime` (= shared `uClock`), `uMoving` (0 draws the frozen frame `t = 3.7`), `uFade`, `uWidthPx` (x dpr), `uPxPerM1` (`css.h / (2 tan(fov/2))`, set when the camera or size changes), `uViewport`, `uDepthBias` 40. `depthWrite` false, depth test on, normal blending, `renderOrder` 6.
Vertex: pulse `head = fract(t / T + h1) x (1 + gap) x (L + tail)`, `T = (L + tail) / vpx x (0.7 + 0.6 h2)`, `vpx = clamp(14 x speed, 40, 260)` px/s; per end `I = clamp(1 - (head - s) / tail, 0, 1)` for `s <= head`; both ends 0 drops the segment (fragment work about a third). Eddy offsets in the ground plane from value noise advected by `vpx`; `speed` is per line so neighbouring segments share their end offsets and the line stays joined (a per-segment speed would shear them). Width per end `0.5 uWidthPx mix(0.35, 1, I)`, quad half-extent +2 px; the fragment draws a core of the colour and a dark navy halo (`HALO_INK`, 0.6 alpha) like the glyphs; `discard` under 0.01; no fog, no tone mapping. Constant-bound loops compiled under ANGLE/SwiftShader; unroll if a device refuses. Tune on a phone: the prototype's 2.8 px core looked thin at dpr 1 (try 3.2 px, taper to 0.45); the halo reads on pale and dark ground.

### 3.4 The builder (`detailStreaks.ts`, pure: no Three, no DOM, no `Math.random`)
Input `DetailInput` (a `GlyphInput` plus `ground10`, the 10 m ground as received, and `seed`). A fork of `flowGlyphs.ts`'s lattice walk (`walk`, `candidate`, `store`: world lattice of `spacingM`, integer-hash jitter, orbit density, cap thinning by hash, clocked slices, typed scratch, allocation-free) with a different tracer: RK2 midpoint in equal steps of 9 px x `mppSeed`, `n = clamp(ceil(L / 9), 8, 24)`, `L = clamp(16 x speed, 90, 220)` px, stop at calm (< 0.3 m/s: no dot, no line), raster edge, near plane, the cliff rule. Per line from `ground10` (about 30 lookups): `rough`, `slope`, `lee`, `turb = clamp(0.25 + (0.5 rough + 0.5 lee) x g, 0, 1)`, `lift = clamp(speed x slope x g / 3, -1, 1)`, `g = exp(-h / 300)`; the baked y adds `3 m x lift`. Without `ground10`: `turb 0.5`, `lift 0`. `DETAIL_GEOMETRY` (C0) holds `spacingPx 40, jitter 0.35, minPx 90, maxPx 220, pxPerMs 16, stepPx 9`; `glyphLod.ts` `LEVEL_SPECS[4]` takes these when detail is on and keeps the 0.5.0 numbers when `detail: false` (so `flowGlyphs.test.ts` and `wind-glyphs.spec.ts` still pin the old L4). Output `DetailOutput`; deterministic (same input and seed, same bytes; time never enters). About 200 lines in view plus margin, 3,000 to 6,000 segments; the cap thins by hash (Low shows fewer lines).

### 3.5 Hand-over and flicker
Enter L4 at `cellPx >= 103.5`, leave below 78.3 (`planLod`, unchanged; no new threshold; lattice exponent keeps its 0.06 octave of give). The L3 picture drops at the swap of the L4 build and the detail fades in by `uFade` 0 to 1 over 400 ms (pulses are born at random phases, so it grows, not pops); leaving: 250 ms out while the L3 picture swaps in; `settle` (tests, screenshots) sets `uFade` 1. The old streaks are suppressed at the swap. `uFade` is the one per-frame JS (a small ramp, only while fading).

### 3.6 Frame policy
- `animating` is true only while detail is shown in motion. Streaks on (default): the CPU loop is replaced by a GPU one (saves about 0.55 ms desktop, 2 ms phone [est] a frame; the full-frame redraw at 30 fps was already paid). Streaks off, glyphs on: L4 starts animating where 0.5.0 sat still (L1 to L3 still never do): the one deliberate change to 20.3 item 1.
- 30 fps cap (existing); interaction uncapped as today.
- Reduced motion: `SceneView` reads `matchMedia('(prefers-reduced-motion: reduce)')` and its `change` event and calls `glyphs.setMotion(allowed)`; not allowed gives `detail: 'still'`, `uMoving 0`, the frozen frame (tapered, bright head, so direction still reads), no `animating`. (The old streaks ignore reduced motion today: existing gap, reported, not fixed.)
- Hidden page: rAF stops; on return `dt` is capped. A screen over the view draws nothing already. [open] stop after 60 s without a touch (question 3).

### 3.7 Cost (estimates unless a command is named; no phone)
| Item | 0.5.0 at L4 | New at L4 |
|---|---|---|
| Draw calls | glyph pair 2 (+ old streaks 1) | detail 1, others hidden: net -1 to -2, adds none |
| Triangles | up to 96,000 (two batches) | at most 24,000 (one batch) |
| JS per drawn frame | old streaks 0.55 ms (measured, desktop) | about 0 |
| JS per rebuild | 1.2 to 1.45 ms High cap (measured, plan 20.3 item 15) | 2 to 3 ms [est], 8 ms slices |
| Typed arrays | 1.45 MiB | + 864 kB batch + 864 kB builder output at High |
| Bundle | n/a | render chunk + about 5 to 6 kB gzip; entry + 1.5 to 2 (state, chip, CSS; words and sheet lazy). Lane budget: entry +2.5, all JS +8; no check raised. The render chunk is already lazy; a dynamic import of the detail code would not lower "all JS", so it is not done |
The prototype's build (12 to 27 ms for 12,000 segments, unoptimised, allocating) says nothing about the production builder's cost.

### 3.8 Determinism
Display only: the builder reads the glyphs' rasters and writes nothing to the snapshot, engine or history; `uTime` is the view's clock; same input, same arrays.

## 4. Lanes (disjoint files)

**C0 commit (orchestrator; types and stubs; tree compiles).**
- `render/wind/glyphTypes.ts` (additive): `export const DETAIL_LEVEL = 4 as const; export type DetailMotion = 'off' | 'moving' | 'still'; export const DETAIL_GEOMETRY = { spacingPx: 40, jitter: 0.35, minPx: 90, maxPx: 220, pxPerMs: 16, stepPx: 9, minSegments: 8, maxSegments: 24 } as const; export const DETAIL_FADE_IN_MS = 400; export const DETAIL_FADE_OUT_MS = 250; export interface DetailInput extends GlyphInput { ground10: GroundRaster; seed: number } export interface DetailOutput { a: Float32Array; b: Float32Array; c: Float32Array; d: Float32Array; e: Float32Array; lines: number; segments: number; dropped: number; calm: number; steep: number } export interface DetailBuilder { begin(input: DetailInput): void; step(budgetMs: number): boolean; readonly busy: boolean; readonly out: DetailOutput; cancel(): void }`
- `render/api.ts`: `WindGlyphStats.detail: DetailMotion; detailSegments: number`.
- `render/wind/detailStreaks.ts`: `export function createDetailBuilder(tier: GlyphTier): DetailBuilder` (a stub that finishes with zero lines).
- `render/wind/detailBatch.ts`: `export class DetailBatch { readonly mesh: THREE.Mesh; readonly a: Float32Array; readonly b: Float32Array; readonly c: Float32Array; readonly d: Float32Array; readonly e: Float32Array; readonly capacity: number; constructor(o: { capacity: number; widthPx: number; depthBiasM: number; shared: Record<string, THREE.IUniform> }); commit(n: number): void; setMoving(on: boolean): void; setFade(f: number): void; setPxPerM1(v: number): void; set widthPx(v: number); dispose(): void }` (a trivial `ShaderMaterial`).
- `windGlyphLayer.ts`: stubs `setStreaksDetail(on: boolean)`, `setMotion(allowed: boolean)`, `get animating(): boolean`, `get detailShown(): boolean`; `render/windLayer.ts`: `setSuppressed(on: boolean): void`.
- `ui/screens/sim/windDetailState.ts`: the types, `windDetailState` returning `visible: false`, `chipLabel(level: number): string`.
- `ui/screens/sim/windDetailWords.ts`: `export function windDetailWords(s: WindDetailState, o: { heightLabel: string; height: WindHeight; cellM: number | null }): { title: string; lines: string[] }` (stub). `windDetailSheet.ts`: `export function mountWindDetailSheet(ctx: SimContext, panel: HTMLElement, opts: { close(): void }): { refresh(): void; destroy(): void }` (stub).

**D-engine** owns `render/wind/detailStreaks.ts` (+ `.test.ts`, `.perf.test.ts`, `.alloc.test.ts`), `render/wind/glyphLod.ts` (`LEVEL_SPECS[4]` detail spec behind a flag, tests), `render/wind/glyphDeps.test.ts` (add the new files to `ENGINE`: no Three, no DOM, no `Math.random`).
**D-render** owns `render/wind/detailBatch.ts`, `windGlyphLayer.ts` (+ test), `glyphSchedule.ts` (`segmentCap` parameter, test), `windLayer.ts`, `SceneView.ts` (about 25 lines: `setStreaksDetail`, suppression, `animating`, `matchMedia`, `setPxPerM1`), `render/api.ts` fields, `e2e/wind-detail-render.spec.ts`.
**D-ui** owns `windDetailState.ts` (+ test), `windDetailWords.ts` (+ test), `windDetailSheet.ts` (thin DOM), `windDetailChip.ts` (new: chip, pips, poll), `simScreen.ts` (about 15 lines: create, append, `layoutInsets`, observe, destroy), `topBar.ts` (about 12 lines, mirroring `paceButton`), `styles/sim.css` (about 40 lines `.wind-detail*`; `layers.css`, `slice.css` untouched), `glyphWords.ts` (`LEVEL_LINE[4]`: `Showing moving streaks with small eddies. This is the most detailed level.`, and its test), `e2e/wind-detail.spec.ts`.
Shared and light: `SceneView.ts`, `api.ts`, `simScreen.ts`, `topBar.ts`. Nobody edits README, ARCHITECTURE, DESIGN, `content.ts`.

## 5. Test plan with numbers
- **Level and limits:** section 2.6 (about 40 rows plus the property test).
- **Builder:** same input and seed twice gives equal `a..e` bytes; pan invariance of seeds after a 1 km pan; one lattice per zoom from either side; cap respected at 4,000/8,000/12,000; `s1 > s0`, `s1 - s0 <= 12 px`, `L` equal along a line, `seed` in [0, 1), `tail` in [24, 90], `turb`, `lift` in range; calm draws nothing; a rotating analytic field turns the lines by at least 20 degrees, a uniform field gives straight ones; no step over 45 degrees; near-plane drop; ramp ground (slope 0.2): `lift > 0` up the slope and `< 0` down it, `lee > 0` only on the lee side, flat ground `turb 0.25`, terms shrunk by `g` at 300 m; no `Math.random`.
- **Perf (node, fake clock for slices as `flowGlyphs.perf.test.ts`):** a High-cap build (about 1,900 lines x 12 segments): median under 4 ms and slice p95 under 8 ms [est, set from the first runs]; steady-state allocation under 1 kB a rebuild; heap +30 kB at most over 3,000 rebuilds.
- **Layer (stub builder):** one plan; at L4 with detail the glyph batches are empty and the detail batch holds the segments, below L4 the reverse; `animating` only for `moving`; reduced motion gives `still`, `animating false`; the fade is 0 to 1 in 400 ms of capped `dt`; `setStreaksDetail(true)` with the glyph switch off draws nothing below L4 and detail at L4; budget idle still `'budget'`; `stats().level` is the zoom's with only streaks on; detail trimmed to nothing returns the old streaks.
- **Shader text (node):** no texture reads, every uniform of 3.3 present; a TS mirror `pulseIntensity(s, head, tail)` (exported from `detailStreaks.ts`) agrees with the GLSL formula at 12 points.
- **e2e (software GL):** a pinch walks L1 to L4 and the pips follow; at L4 draw calls at most those at L3 and triangles under 550,000; `emulateMedia({ reducedMotion: 'reduce' })` gives no frame in 3 s and `detail: 'still'`; two shots 500 ms apart differ (moving), two at a settled clock are byte-equal; streaks alone show detail at L4 and `scene.getObjectByName('wind').visible === false`; eye level hides the chip when streaks are off; 360x640 and 844x390 layout and tap audits as in 2.6.

## 6. Risks
1. **The look cannot be judged without a phone** (sunlight, dpr 3, halo, eddies as air or as wobble). Constants sit in `DETAIL_GEOMETRY` and one shader block; the still frame is a one-flag safe default.
2. **Continuous animation with the glyphs alone** is new (battery, heat): GPU only, 30 fps, replaces the CPU loop when the streaks are on, reduced motion honoured; question 3.
3. **Eddies are not model output:** a trainer could read a wiggle as a real gust. The sheet says so; amplitude is bounded; colour never changes (question 2).
4. **Displaced vertices and the 40 m depth bias** can show a stroke through a ridge by a few metres on steep ground; accepted at 20 m amplitude, the cliff rule limits it.
5. **Streaks-only users see 1 pip, then 4 at L4.** Honest; follow-up: seed the old particles in the view.
6. **`LEVEL_SPECS[4]`** is pinned by `flowGlyphs.test.ts` and `wind-glyphs.spec.ts`: keep the old numbers behind the `detail` flag; those tests run unchanged.
7. **Weak GPU / `highp` vertex:** the existing streak shader assumes it too; no texture reads; a shader that fails shows nothing, and the old streaks come back (suppressed only while `detailShown`); the phone is the check.
8. **Merge conflicts** in `SceneView.ts`, `simScreen.ts`, `topBar.ts` with the Wind direction lane: additive edits only.
9. Plan 20.3 item 1 (glyphs never animate) and the header of `windGlyphLayer.ts` ("nothing here moves") change for L4; the docs lane records it.

## 7. Questions only the owner can answer
1. Is "the wind streaks" the animated Wind streaks layer (on by default), as assumed, or the arrows and flow lines? (Both show the same detailed picture at L4, so both are covered; a "no" only changes the old layer's hand-over.)
2. May the closest zoom show eddies the model does not calculate (labelled in the sheet), or must every mark be model output? If the latter, drop ingredients 3 to 5: streaks and taper only, much less believable.
3. Stop the animation after about a minute without a touch to save battery (a touch restarts it), or run while the screen is on, as the old streaks do?
4. Should the chip also appear for the Wind speed map (a coloured map has no streaks)?

## 8. Prototype: what was seen (real renderer, software GL, 412x915, Katoomba 6 km fast tier)
`git apply D-CONTRACT-060-detail.prototype.patch` (a hack in `windGlyphLayer.ts` builds the streaks synchronously at L4; `glyphLod.ts` L4 spec; the two `e2e/zz-*` specs). Three heavy runs, one more than asked: a baseline (layout, 0.5.0 L4), a first prototype run that drew nothing (a hash helper returned an integer), and the one described here.
- `proto-d250-t1.png` and `-t3.png` (250 m, clock 1.0 s and 2.4 s): tapered streaks, varied lengths, visible meander, different positions at the two times; the L3-style parallel look is gone. `proto-d250-noeddy.png` (same, eddies off): straight parallel streaks, i.e. what the eddy ingredient buys. `proto-d70-t1.png` (closest zoom): swirling bundles. `-trees` shots: streaks stay visible over canopy with the depth bias. `proto-d250-still.png`: the reduced-motion frame reads as comet-shaped streaks. The cap (12,000) was hit at 250 m because the prototype does not thin by hash.
- Not learned: true frame cost, the look on a phone in sunlight, battery.

## 9. Docs notes
Help "Layers": the closest zoom of the wind marks is moving streaks; the Wind detail chip and sheet. Glossary: "Wind detail" (four pips), "Detailed streaks" (what is the model's, what is added). README and ARCHITECTURE: the L4 path, the batch, budgets. DESIGN: the chip in the bottom-left stack. Plan 20.3 items 1 and 6.

---
## Orchestrator's decisions on the scout's owner questions (settled)
1. "The wind streaks" = the old animated Wind streaks layer and the arrows and flow lines alike: at L4 both switches feed the same detailed picture, as the contract assumes.
2. The closest zoom MAY show eddies the model does not calculate; the info sheet says so in plain words (an honest label).
3. No idle stop for the animation in 0.6.0 (same policy as the existing Wind streaks layer: it runs while visible, is still under reduced motion, and pauses when the page is hidden). A "stop after a minute" option is a follow-up idea for the owner.
4. The chip does NOT appear for the Wind speed map: only while the arrows and flow lines or the Wind streaks are showing.
