# S2: bundle baseline and trim candidates

Spike S2 of [the plan](../../air-slice-wind-detail-honest-speed.md), section 10 (M0). Nothing in the app was changed. Everything below was measured on commit `64c2133` (release 0.2.2, 2026-10-12) with Node 22.22.2, Vite 8.3.1 (Rolldown 1.2.11) and `--mode capacitor`, in scratch folders outside the repository.

Units: "kB" is 1024 bytes, as `scripts/check-bundle.mjs` prints it, so its "1000 kB" budget is 1,024,000 bytes. "gzip" is `gzip -9` of each file. A number marked [guess] was not measured.

## Summary

1. **Baseline.** All JS is 956.7 kB gzip of 1000 (the plan says 953.8), the entry chunk is 185.4 of 195 (plan: 184), CSS is 122.2 of 135 raw (plan: 122.2, correct). The headroom is 43.3 kB for all JS and 9.6 kB for the entry, not 46.2 and 11. There are 37 JS files, 2857.4 kB raw. The repository's own `dist/` from the 0.2.2 release is byte-identical to a fresh build, so the baseline is reproducible.
2. **Where the 3-D view is.** `SceneView.ts`, `terrainLayer.ts`, the tree and places layers and three.js are in `render-*.js`: 743.8 kB raw, 200.8 kB gzip. It is lazy (not in the entry's static imports) but it is requested at every start-up (`src/ui/modules.ts:51`). Nine other `src/render` modules (27.0 kB gzip) are in the **entry**, among them `fields.ts` with `decimateGrid`, `hornGradient` and `groundColours`, because the Data sets screen imports it. New cliff code lands in the render chunk when only the 3-D view imports it. `decimateTerrain` "next to `decimateGrid`" would land in the entry.
3. **Biggest modules (gzip).** `three.module.js` 81.2 kB and `three.core.js` 47.5; the two zstd WebAssembly strings 31.3 and 28.4; `pako` 14.3; `src/ui/modelInfo.ts` 13.9 (the biggest app module, in the entry); the engine, each module twice: `EmberModel.ts` 12.3, `FireSpreadModel.ts` 10.8, `simulation.ts` 10.8, `explain/text.ts` 10.0; `datasetsModel.ts` 10.6. Packages and folders: `src/ui` 168.5, `three` 132.7, `src/render` 94.5, `src/explain` 83.5, `src/scenario` 75.3, `zstddec` 59.7. String and template literals are 28 % of all JS gzip.
4. **The bytes are not in dev-only or dead code.** Dev pages and test helpers are not in the bundle at all. Statically dead declarations total 9.8 kB gzip (3.2 main thread, 6.7 worker). The mock engine is 21.9 kB (15.7 without the 2-D map). The one dev-helper leak that matters is `buildDemoFuel`: its re-export in `src/fuel/index.ts` keeps the data layer alive in the worker (6.9 kB gzip, one line).
5. **The bytes are in duplicates and unused library features.** The simulation engine is bundled twice: 168.7 kB in the worker and 136.8 kB in a main-thread copy that only runs when there is no Web Worker. The GeoTIFF library ships decoders the app never needs: LERC and ZSTD (two base64 WebAssembly strings, 58.4 kB gzip), JPEG and WebP, 73.3 kB in all, plus pako (14 kB) that fast-png's fflate can replace. The canopy source is Deflate (read from the live file today).
6. **Trims, measured by building patched copies** (`results/experiments/`): the safe set (decoders, pako, fuel barrel) frees **94.0 kB** gzip: 956.7 to 862.7. Removing the mock engine from the APK build frees 15.0 more. Removing the main-thread engine copy from the APK build frees 140.6. Everything together is 709.8.
7. **D10.** Lazy-loading cannot meet the budget by itself, because it moves bytes and does not remove them (lazy model card and Data sets: entry minus 60.0, all JS plus 5.1). Trimming can. The plan's additions of 46 to 61 kB fit after the safe set with 76 to 91 kB to spare, so **D10 should be "lazy-load and trim; do not plan to raise the all-JS budget"**. The entry budget is the tighter one: the plan's own entry-resident additions add up to about 11 kB against 9.6 kB of headroom. A lazy model card (minus 21.2 kB) fixes that.
8. **The plan needs seven corrections** (section "Corrections to the plan"), none of them changing a decision.

## Question

The bundle is at its limit (all JS 953.8 kB of 1000, entry 184 of 195, CSS 122.2 of 135 raw according to the plan). The plan adds an estimated 46 to 61 kB gzip and decision D10 says: lazy-load, trim, and decide at the end of 0.4.0 whether to ask for a bigger budget. S2 gives the baseline, finds the trim candidates (dev-only code in the production bundle, dead code, and whatever else turns up), says which chunk the cliff work will land in, and says what D10 should be.

## Method

- **Builds.** The APK build and the same build with source maps (the JS is identical):
  - `nice -n 10 npx vite build --mode capacitor --outDir $S/dist --emptyOutDir`, then `node scripts/check-bundle.mjs --dist $S/dist`.
  - `nice -n 10 npx vite build --mode capacitor --sourcemap --outDir $S/dist-map --emptyOutDir`.
  - `node docs/plans/spikes/S2-bundle/attribute.mjs compare --dist $S/dist --other $S/dist-map`: all 38 JS and CSS files have the same names and the same content, apart from the `//# sourceMappingURL=` line that 36 of them get. The page `index.html` is identical.
  - Both builds ran with a clean working tree (`git status` was empty before and after each). The repository's `dist/` (built 2026-10-07 for the release) is also byte-identical (`diff -rq dist/assets $S/dist/assets`).
  - Work in the same tree then began changing `src/`, so every later step used `git archive 64c2133` extracted into the scratch folder. A build of that snapshot is byte-identical to the first build. The M0 contracts commit that landed meanwhile (`ca8e637`, in HEAD `85160c6`) changes the build by 1 byte of gzip (956.75 kB both before and after; the entry 185.35 and 185.36), so the figures hold for either commit.
- **Attribution** (`attribute.mjs`). It decodes the source maps itself (base64 VLQ). Every stretch of a generated chunk is given to the original module the map points at (the method of source-map-explorer). Stretches without a mapping are `[unmapped]` (import lines, runtime glue: 13.2 kB raw, 7.8 kB gzip in all, 0.8 %). Multi-line template literals (shaders, help text) are given to the module that starts them. Gzip shares are not a ratio of raw sizes: the chunk is compressed with `gzip -9`, the compressed stream is decoded again by a small inflate that counts the bits each output byte cost, and the bits are summed per module. The shares add up exactly to the chunk's gzip size, so the tables add up to what `check-bundle.mjs` counts. The share of a module that repeats earlier text depends on the order in the chunk. For "what does deleting this save" the `cut` command deletes the bytes and compresses again.
- **Packages and folders.** `node_modules/<name>` is a package (`three`, `geotiff`, `pako`, `@capacitor/*`, ...); `src/<folder>` is a folder; the rest is `[bundler/glue]`.
- **Dead code.** The TypeScript language service (from `node_modules`, nothing installed) lists every reference to each of the 5269 top-level declarations and class members of the 245 modules that have code in the build. Liveness is computed twice, once for the main-thread chunks (entry `src/main.ts`) and once for the worker (entry `src/sim/worker.ts`). Details under "Dead code".
- **Experiments.** Each trim candidate is a small patch to a copy of the snapshot (`results/experiments/T*.patch`), built the same way as the APK build and read with `check-bundle.mjs`. The patches are measurements, not proposals: they may break types or behaviour.
- **Not done.** No device or WebView measurement, no test run (as instructed), no budget changed.

## Baseline

| Figure | Plan | Measured | Budget | Headroom | Command |
| --- | ---: | ---: | ---: | ---: | --- |
| All JS gzip -9, kB | 953.8 | **956.7** | 1000 | 43.3 (plan: 46.2) | `node scripts/check-bundle.mjs --dist $S/dist` |
| Entry `index-*.js` gzip -9, kB | 184 | **185.4** | 195 | 9.6 (plan: 11) | same |
| CSS raw, kB | 122.2 | **122.2** | 135 | 12.8 | same |
| CSS gzip, kB | | 21.9 | 25 | 3.1 | same |
| All JS raw, kB | | 2857.4 | | | `attribute.mjs chunks` |
| Worker `worker-*.js` raw / gzip, kB | | 476.7 / 168.7 | | | same |
| All JS brotli 11, kB (information only) | | 811.3 (15.2 % under gzip) | | | same |

The plan's 953.8 and 184 do not reproduce. I tried zlib levels 6 and 9, raw deflate and 1000-byte units: none gives 953.8 (level 9 gives 956.7, level 6 959.0). Because the repository's own `dist/` from the release gives 956.7 as well, the plan's figures probably came from an earlier tree [guess]. The CSS figure is exact.

**Brotli.** Brotli would shrink all JS to 811.3 kB, the entry to 150.7 and the worker to 143.8. It does not change which chunks matter. It would not help here: the APK is a zip (deflate), the WebView reads the files uncompressed, and the budget is defined on gzip -9. It would only matter for a web host.

**Build time.** Vite reports 3.2 s for the first build, 2.4 s with maps and 1.7 s for the snapshot build (2.4 to 4.9 s wall, with `npx`); builds of the patched copies took 1 to 8 s as the shared 4-core machine went from load 2 to 9. `tsc --noEmit -p .` takes 17.8 s wall (23.9 s CPU), so `npm run build:cap` is about 21 s. The bundler is cheap enough to run `check-bundle` and `attribute.mjs chunks` (about 8 s) on every release.

**Start-up versus lazy.** `loadServices()` (`src/ui/modules.ts:78-83`) requests the sim, render, scenario and mock chunks at once, in every mode, so they are parsed at start-up on the main thread.

| Phase | Files | Raw kB | gzip kB |
| --- | ---: | ---: | ---: |
| 1. Entry and its static imports (modulepreload in `index.html`) | 10 | 743.3 | 262.1 |
| 2. Requested at start-up by `loadServices()` with their static imports | 12 | 1398.8 | 434.9 |
| **Main-thread JS parsed at start-up (1 + 2)** | 22 | **2142.1 (75 %)** | 697.0 |
| 3. Worker, parsed in the worker thread when the sim screen opens | 1 | 476.7 | 168.7 |
| 4. On demand (GeoTIFF decoders, geolocation, native preferences) | 14 | 238.6 | 91.0 |

For scale: V8 parses and lazily compiles the phase 1 and 2 chunks in 56 to 81 ms (two runs) and the worker in 14 ms on this machine (`node --experimental-vm-modules attribute.mjs compile`, `new vm.SourceTextModule`, median of 5). A phone is probably 3 to 6 times slower [guess]. The 350 ms Setup budget in ARCHITECTURE.md includes that.

### Every JS chunk

| Chunk | Raw kB | gzip -9 kB | Loaded | What it holds and what loads it |
| --- | ---: | ---: | --- | --- |
| render-BcWIqPx6.js | 743.8 | 200.8 | lazy, requested at start-up | 3-D view: three.js and 28 `src/render` modules. Requested at start-up (`import.meta.glob`, `src/ui/modules.ts:51`) |
| index-CAoD7JAE.js | 531.5 | 185.4 | entry | The entry: Setup, the sim screen, Settings, Data sets, model card, help, the layer catalogue (script tag in `index.html`) |
| worker-D07vFJbS.js | 476.7 | 168.7 | worker | The simulation engine in a Web Worker. Made by `new Worker(new URL(...))` in `src/sim/client.ts` when the sim screen opens (`simScreen.ts:114`) |
| sim--xMhWn_v.js | 389.2 | 136.8 | lazy, requested at start-up | The same engine again on the main thread (`SimClient` and the in-thread fallback `LocalSimController`). Requested at start-up (`modules.ts:50`) |
| lerc-QP1TA3MH.js | 94.7 | 36.6 | lazy, on demand | GeoTIFF LERC decoder and a zstd WebAssembly (base64 text). Loaded only for a TIFF with compression 34887 |
| data-Db-hA8NP.js | 99.7 | 33.5 | static, in the entry graph | `src/data`, geotiff core, fast-png, fflate; imported by the entry and by most chunks |
| estimate-BGrgvUwk.js | 103.0 | 33.0 | static import of a start-up chunk | Data-set inventory text, estimates, scenario build (`build.ts`, `terrain.ts`). The scenario chunk imports it statically, so it loads at start-up (`setup.ts:853` and `datasets.ts:1100` import it a second time) |
| zstd-i4Jwubnx.js | 79.1 | 31.5 | lazy, on demand | GeoTIFF ZSTD decoder, WebAssembly as base64 text. Only for compression 50000 |
| mocks-BF7hnoS_.js | 57.6 | 21.9 | lazy, requested at start-up | Mock simulation, mock builder, mock data and the 2-D map. Requested at start-up (`modules.ts:79`) in every mode |
| storage-DmfRc9Ip.js | 41.0 | 15.3 | static, in the entry graph | `src/data` storage, cache, http, ledger and `core/datasets`; imported by the entry |
| pako.esm-Ch1S5qKo.js | 45.5 | 14.3 | lazy, on demand | pako (inflate), imported only by the geotiff deflate and LERC decoders |
| weatherSources-HEvh1alG.js | 36.4 | 12.9 | static import of a start-up chunk | Weather sources, layers, belt kit, messages (`src/scenario`); imported by the scenario chunk |
| datasetStats-DI78qXyW.js | 22.8 | 9.7 | static import of a start-up chunk | `src/scenario/datasetStats`; imported by estimate and mocks |
| mcarthur-C5X5px3Q.js | 24.4 | 9.7 | static import of a start-up chunk | `src/fuel` fuel map, history, svtm, polygon; imported by estimate, datasetStats and sim |
| terrain-BwRlvvif.js | 15.6 | 6.8 | static, in the entry graph | `src/terrain` analysis and solar; imported by the entry |
| openMeteo-BeFUAsqG.js | 15.3 | 6.3 | static, in the entry graph | `src/scenario/openMeteo`, params, time; imported by the entry |
| catalogue-Dy7iKToi.js | 16.0 | 4.9 | static, in the entry graph | `src/fuel/catalogue`, hazard; imported by the entry |
| scenario-CyVR7pfA.js | 10.0 | 4.6 | lazy, requested at start-up | `src/scenario/feeds.ts`, the one module of the barrel loaded with `import.meta.glob` (`modules.ts:52`) |
| jpeg-Di1AymDI.js | 10.6 | 3.9 | lazy, on demand | GeoTIFF JPEG decoder. Compression 7 only |
| replays-C-GuXc9P.js | 8.0 | 3.6 | static, in the entry graph | Presets and replays; imported by the entry |
| weather-BCtPTOFV.js | 7.1 | 3.1 | static import of a start-up chunk | `src/scenario/weather` and moisture drought; imported by scenario and sim |
| dist-C5Vgn5nD.js | 7.6 | 3.0 | static, in the entry graph | @capacitor/core; imported by the entry |
| globals-CCptAvKb.js | 7.4 | 2.7 | static, in the entry graph | geotiff globals; imported by the entry |
| areaPack-BRTBKc0x.js | 3.2 | 1.5 | static import of a start-up chunk | Area-pack download (`setup.ts:922`); the scenario chunk imports it too |
| web-i9eqyzQd.js | 2.0 | 0.8 | lazy, on demand | @capacitor/geolocation web fallback; loaded by `esm-B0sbNcPP` when the user taps the location button |
| lzw-D2FslT4L.js | 1.4 | 0.8 | lazy, on demand | GeoTIFF LZW decoder. Compression 5 only |
| basedecoder-BuG7fe0q.js | 1.3 | 0.7 | lazy, on demand | geotiff base class of every decoder |
| preload-helper-uBIymjUX.js | 1.2 | 0.7 | static, in the entry graph | Vite dynamic-import helper; imported by the entry |
| web-C0xWYv7t.js | 1.2 | 0.5 | lazy, on demand | @capacitor/preferences web fallback (`registerPlugin`) |
| webimage-zQMH-_zR.js | 0.9 | 0.5 | lazy, on demand | GeoTIFF WebP decoder. Compression 50001 only |
| esm-B0sbNcPP.js | 1.0 | 0.5 | lazy, on demand | @capacitor/geolocation; loaded when the user taps the location button (`src/ui/location.ts:36`) |
| hillshade-DiSI-VO3.js | 0.7 | 0.4 | static import of a start-up chunk | `src/terrain/hillshade`; imported by render and mocks |
| rng-BnwdYkrg.js | 0.7 | 0.4 | static import of a start-up chunk | `src/core/rng`; imported by sim and mocks |
| esm-C6kMOuIF.js | 0.4 | 0.2 | lazy, at start-up on Android | @capacitor/preferences; loaded at start-up on Android only (`src/ui/prefs.ts:29`) |
| packbits-DCimUQ1T.js | 0.3 | 0.2 | lazy, on demand | GeoTIFF PackBits decoder. Compression 32773 only |
| deflate-DrpJyiUj.js | 0.2 | 0.2 | lazy, on demand | GeoTIFF Deflate decoder: the one the canopy source needs (compression 8) |
| raw-A-vJRPpa.js | 0.1 | 0.1 | lazy, on demand | GeoTIFF uncompressed decoder |
| **All JS, 37 files** | **2857.4** | **956.7** | | |

"Static import of a start-up chunk" means the chunk is not in the entry's own import graph but a chunk that `loadServices()` loads imports it, so it is parsed at start-up. `estimate-*.js` shows the effect: `setup.ts:853` and `datasets.ts:1100` import it "lazily", but `scenario-*.js` imports it statically (the `import.meta.glob` barrel `src/scenario/index.ts` exports `estimateScenarioData`), so it is already loaded.

## Attribution

### Top 40 modules (all chunks, gzip shares)

| # | Module | Chunk | Raw kB | gzip kB | Group |
| --- | --- | --- | ---: | ---: | --- |
| 1 | `node_modules/three/build/three.module.js` | render | 343.4 | 81.23 | three |
| 2 | `node_modules/three/build/three.core.js` | render | 179.7 | 47.48 | three |
| 3 | `node_modules/zstddec/dist/zstddec-stream.modern.js` | zstd | 79.0 | 31.32 | zstddec |
| 4 | `node_modules/zstddec/dist/zstddec.modern.js` | lerc | 71.5 | 28.38 | zstddec |
| 5 | `node_modules/pako/dist/pako.esm.mjs` | pako.esm | 45.5 | 14.28 | pako |
| 6 | `src/ui/modelInfo.ts` | index | 40.2 | 13.90 | src/ui |
| 7 | `src/embers/EmberModel.ts` | sim | 36.0 | 12.30 | src/embers |
| 8 | `src/embers/EmberModel.ts` | worker | 36.6 | 12.26 | src/embers |
| 9 | `src/fire/spread/FireSpreadModel.ts` | worker | 32.3 | 10.86 | src/fire |
| 10 | `src/sim/simulation.ts` | sim | 35.5 | 10.83 | src/sim |
| 11 | `src/fire/spread/FireSpreadModel.ts` | sim | 32.2 | 10.82 | src/fire |
| 12 | `src/sim/simulation.ts` | worker | 35.6 | 10.77 | src/sim |
| 13 | `src/ui/screens/datasetsModel.ts` | index | 30.5 | 10.58 | src/ui |
| 14 | `src/explain/text.ts` | sim | 31.1 | 10.02 | src/explain |
| 15 | `src/explain/text.ts` | worker | 31.1 | 10.01 | src/explain |
| 16 | `src/ui/screens/datasets.ts` | index | 29.0 | 8.66 | src/ui |
| 17 | `src/ui/screens/setup.ts` | index | 26.5 | 8.57 | src/ui |
| 18 | `src/scenario/datasetRecords.ts` | estimate | 25.3 | 8.51 | src/scenario |
| 19 | `src/ui/mockSim.ts` | mocks | 22.1 | 8.34 | src/ui |
| 20 | `src/scenario/datasetStats.ts` | datasetStats | 20.1 | 8.27 | src/scenario |
| 21 | `src/render/SceneView.ts` | render | 25.7 | 8.01 | src/render |
| 22 | `node_modules/lerc/LercDecode.js` | lerc | 22.5 | 7.78 | lerc |
| 23 | `src/render/terrainLayer.ts` | render | 25.3 | 7.77 | src/render |
| 24 | `src/ui/screens/sim/simScreen.ts` | index | 20.7 | 7.22 | src/ui |
| 25 | `src/render/layerCatalog.ts` | index | 22.6 | 6.87 | src/render |
| 26 | `src/render/placesLayer.ts` | render | 21.5 | 6.80 | src/render |
| 27 | `src/ui/screens/sim/sheet.ts` | index | 18.4 | 6.42 | src/ui |
| 28 | `src/atmosphere/atmosphere.ts` | worker | 19.7 | 6.33 | src/atmosphere |
| 29 | `src/atmosphere/atmosphere.ts` | sim | 19.6 | 6.28 | src/atmosphere |
| 30 | `src/render/treeShaders.ts` | render | 17.0 | 6.14 | src/render |
| 31 | `src/scenario/datasetRecordsPlaces.ts` | estimate | 18.7 | 6.09 | src/scenario |
| 32 | `src/scenario/datasetRecordsWeather.ts` | estimate | 22.1 | 6.09 | src/scenario |
| 33 | `src/render/legends.ts` | index | 17.1 | 6.07 | src/render |
| 34 | `src/ui/screens/sim/layersPanel.ts` | index | 18.2 | 6.01 | src/ui |
| 35 | `src/ui/mockScene.ts` | mocks | 16.7 | 5.79 | src/ui |
| 36 | `src/ui/mapsLink.ts` | index | 15.6 | 5.77 | src/ui |
| 37 | `src/fuel/moisture/model.ts` | sim | 14.7 | 5.75 | src/fuel |
| 38 | `src/fuel/moisture/model.ts` | worker | 14.8 | 5.75 | src/fuel |
| 39 | `src/scenario/estimate.ts` | estimate | 20.1 | 5.74 | src/scenario |
| 40 | `src/atmosphere/base.ts` | sim | 15.8 | 5.56 | src/atmosphere |

111 modules are bundled into two chunks. The smaller copies add 168.0 kB gzip, nearly all of it the engine (`EmberModel.ts`, `FireSpreadModel.ts`, `simulation.ts`, `explain/*`, `atmosphere/*` in both `sim-*.js` and `worker-*.js`; `results/attribution.md`).

### Packages and folders, all chunks together

| Group | Raw kB | gzip kB | % of all gzip | Modules | Where (gzip kB per chunk) |
| --- | ---: | ---: | ---: | ---: | --- |
| src/ui | 485.7 | 168.5 | 17.6 % | 69 | index 147.0, mocks 21.5 |
| three | 542.5 | 132.7 | 13.9 % | 3 | render 132.7 |
| src/render | 275.8 | 94.5 | 9.9 % | 37 | render 67.5, index 27.0 |
| src/explain | 242.4 | 83.5 | 8.7 % | 32 | worker 41.8, sim 41.7 |
| src/scenario | 212.5 | 75.3 | 7.9 % | 27 | estimate 32.4, weatherSources 12.0, datasetStats 8.3, openMeteo 5.2, index 5.1 ... |
| zstddec | 150.5 | 59.7 | 6.2 % | 2 | zstd 31.3, lerc 28.4 |
| src/fire | 155.9 | 57.9 | 6.1 % | 48 | worker 28.5, sim 27.3, index 1.9, mcarthur 0.2 |
| src/atmosphere | 153.6 | 55.5 | 5.8 % | 28 | worker 27.6, sim 26.7, catalogue 1.2 |
| src/fuel | 121.1 | 43.3 | 4.5 % | 40 | worker 19.2, sim 9.9, mcarthur 9.3, catalogue 3.3, weather 1.6 |
| src/embers | 100.9 | 35.3 | 3.7 % | 14 | worker 17.6, sim 16.3, index 1.4 |
| src/sim | 94.8 | 30.3 | 3.2 % | 14 | worker 14.6, sim 14.3, index 1.1, catalogue 0.3 |
| src/data | 73.3 | 28.8 | 3.0 % | 21 | data 11.3, storage 10.6, worker 5.0, datasetStats 1.3, weatherSources 0.6 |
| geotiff | 58.3 | 19.6 | 2.0 % | 25 | data 10.7, jpeg 3.9, globals 2.3, lzw 0.8, basedecoder 0.7 ... |
| pako | 45.5 | 14.3 | 1.5 % | 1 | pako.esm 14.3 |
| src/terrain | 27.6 | 11.8 | 1.2 % | 5 | terrain 5.9, worker 5.5, hillshade 0.4 |
| src/core | 28.2 | 11.3 | 1.2 % | 13 | storage 4.6, worker 3.6, data 1.0, openMeteo 0.9, terrain 0.8 ... |
| lerc | 22.5 | 7.8 | 0.8 % | 1 | lerc 7.8 |
| @capacitor/core | 15.3 | 6.0 | 0.6 % | 2 | dist 3.0, worker 3.0 |
| fast-png | 13.5 | 4.0 | 0.4 % | 15 | data 3.9, worker 0.1 |
| fflate | 4.9 | 2.3 | 0.2 % | 1 | data 2.3 |
| iobuffer | 5.8 | 1.3 | 0.1 % | 4 | data 1.2, worker 0.1 |
| @petamoriken/float16 | 2.5 | 1.2 | 0.1 % | 4 | data 1.2 |
| src (root) | 2.1 | 0.9 | 0.1 % | 1 | index 0.9 |
| @capacitor/geolocation | 2.2 | 0.9 | 0.1 % | 2 | web 0.8, esm 0.1 |

Not shown: `[bundler/glue]` 7.8 kB, `quick-lru` 0.9, `xml-utils` 0.6, `@capacitor/preferences` 0.6, `@capacitor/synapse` 0.3. The full lists are `results/packages.csv` (group by chunk) and `results/modules.csv` (every module in every chunk, raw and gzip, and its string bytes).

### What each big chunk is made of

| Chunk | Raw kB | gzip kB | What the gzip kB are made of |
| --- | ---: | ---: | --- |
| render | 743.8 | 200.8 | three 132.7, src/render 67.5, [bundler/glue] 0.5 |
| index | 531.5 | 185.4 | src/ui 147.0, src/render 27.0, src/scenario 5.1, src/fire 1.9, src/embers 1.4, src/sim 1.1 |
| worker | 476.7 | 168.7 | src/explain 41.8, src/fire 28.5, src/atmosphere 27.6, src/fuel 19.2, src/embers 17.6, src/sim 14.6 |
| sim | 389.2 | 136.8 | src/explain 41.7, src/fire 27.3, src/atmosphere 26.7, src/embers 16.3, src/sim 14.3, src/fuel 9.9 |
| lerc | 94.7 | 36.6 | zstddec 28.4, lerc 7.8, geotiff 0.4, [bundler/glue] 0.1 |
| data | 99.7 | 33.5 | src/data 11.3, geotiff 10.7, fast-png 3.9, fflate 2.3, iobuffer 1.2, @petamoriken/float16 1.2 |
| estimate | 103.0 | 33.0 | src/scenario 32.4, [bundler/glue] 0.6 |
| zstd | 79.1 | 31.5 | zstddec 31.3, geotiff 0.1, [bundler/glue] 0.1 |
| mocks | 57.6 | 21.9 | src/ui 21.5, [bundler/glue] 0.5 |
| storage | 41.0 | 15.3 | src/data 10.6, src/core 4.6, [bundler/glue] 0.1 |
| pako.esm | 45.5 | 14.3 | pako 14.3 |
| weatherSources | 36.4 | 12.9 | src/scenario 12.0, src/data 0.6, [bundler/glue] 0.4 |

`three` is 132.7 kB gzip (13.9 % of all JS) and cannot be tree-shaken further by us: `ShaderChunk` (the GLSL library) is 145.6 kB raw, 26.0 kB gzip; `WebGLRenderer` 9.6; `WebGLTextures` 6.6; and about 14 kB gzip are code the app never calls but that stays because it is a class method or is built by the renderer (WebXR 3.9, PMREM and its shaders 3.4, JSON serialisation 3.9, animation tracks and bindings 3.0) [guess: sizes are from the symbol table, not from a build without them].

### Big text blobs

String and template literals are 815 kB raw and **271 kB gzip, 28 % of all JS**. 91 literals of 600 characters or more are 343 kB raw, 103 kB gzip (`results/blobs.md`).

| Text | Where | Raw kB | gzip kB | Note |
| --- | --- | ---: | ---: | --- |
| zstd WebAssembly, base64 | `zstd-*.js` (`zstddec-stream.modern.js`) | 77.2 | 30.4 | one string, never used by the app |
| zstd WebAssembly, base64 | `lerc-*.js` (`zstddec.modern.js`) | 70.8 | 28.0 | a second build of the same decoder |
| three.js GLSL chunks | `render-*.js` (`three.module.js`) | 168.0 | 32.5 | needed by `WebGLRenderer` |
| Model card text | entry (`src/ui/modelInfo.ts`) | 29.1 | 10.5 | the largest module of the entry |
| Explanation card text | sim and worker (`src/explain/text.ts`) | 25.6 | 8.7 each | two copies |
| Data-set records (provenance text) | `estimate-*.js` (`datasetRecords*.ts`) | 40.5 | 13.8 | |
| Shaders written by us | `render-*.js` (`terrainLayer`, `treeShaders`, `placesLayer`, `glsl`, `fireLayer`, `streaks`, ...) | 64.5 (all string text of `src/render` in the chunk) | 21.3 | `terrainLayer.ts` shader text: 17.3 kB raw, 5.3 gzip |
| Help and glossary | entry (`src/ui/content.ts`) | 11.9 | 4.7 | |
| Data sets screen text | entry (`datasetsModel.ts`, `datasets.ts`) | 27.4 | 8.9 | |
| Layer catalogue text | entry (`src/render/layerCatalog.ts`) | 15.9 | 5.2 | |
| Icon paths | entry (`src/ui/icons.ts`) | 7.9 | 3.0 | |

New Help, Glossary, model-card and Data-sets strings (plan section 13) go into these entry modules unless the screens are made lazy.

### Where the 3-D view code and the cliff work will be bundled

| Code | Chunk | Why |
| --- | --- | --- |
| `SceneView.ts`, `terrainLayer.ts`, `vegetationPlacement.ts`, `treeShaders.ts`, `placesLayer.ts`, `cameraRig.ts`, three.js (28 `src/render` modules, 67.5 kB gzip) | `render-*.js` | imported only by the 3-D view; loaded at start-up through `import.meta.glob('../render/index.ts')` |
| `layerCatalog.ts`, `legends.ts`, `palette.ts`, `fields.ts`, `contextFields.ts`, `placesGeometry.ts`, `canopyStyle.ts`, `placesLegend.ts`, `layers.ts` (9 modules, 27.0 kB gzip) | entry | the UI imports them; `fields.ts` is imported by `src/ui/screens/datasetViz.ts` |
| New `cliffSharpen.ts`, `rockMask.ts`, the six shader effects in `terrainLayer.ts`, rock rejection in `vegetationPlacement.ts` | `render-*.js` | only the 3-D view imports them |
| New `decimateTerrain` in `fields.ts` (about 0.5 kB gzip [guess]) | **entry** | `fields.ts` is in the entry. Put it in a render-only file instead |
| `memoryModel.ts` rows, Help and Glossary text | entry | `memoryModel.ts` and `content.ts` are entry modules |
| Terrain note in `datasetRecords.ts`, `terrain.ts` and `build.ts` (`rockFraction`), `datasetStats.ts` | `estimate-*.js`, `datasetStats-*.js` | start-up chunks through the scenario barrel |
| H-sim: `terrainFeatures.ts`, `FireSpreadModel.ts`, `infer.ts`, `fuelMap.ts`, explain rules | `worker-*.js` **and** `sim-*.js` | the engine is bundled twice (about 2 kB in the worker is about 4 kB in all JS until T3 is done) |

Rules of thumb from the build graph: a module imported by the entry and by a lazy chunk goes into the entry; a module imported by two lazy chunks goes into a third, shared chunk; every export of `src/sim/index.ts`, `src/render/index.ts` and `src/scenario/index.ts` stays in its start-up chunk, because `import.meta.glob` hands the whole module object to `modules.ts`.

## Dev-only code in the production bundle

| Candidate | In the bundle? | Cost, gzip | Can a production user reach it? | Notes |
| --- | --- | --- | --- | --- |
| Dev pages `src/render/dev.ts` (11.8 kB source), `devScenario.ts` (29.4), `devTrees.ts` (14.5), `legendGallery.ts` (6.6), `src/ui/styleguide.ts` (38.5) and their HTML | No | 0 | No: separate HTML pages, served by the dev server; `check-bundle.mjs` fails on a second page | nothing to trim |
| Test helpers (`testUtils.ts`, `testing.ts`, `*/testing/*`, `nswContextTesting.ts`, `sim/validation/harness.ts`, `fire/models/testUtil.ts`) | No: none of the 245 modules with code is a test or helper | 0 | No | |
| Mock engine `mocks-*.js`: `mockSim.ts` 8.3, `mockScenario.ts` 3.0, `mockFire.ts` 2.3, `mockDatasets.ts` 2.2 | **Yes**, loaded at every start (`modules.ts:79` is inside `Promise.all`, even when the real modules load) | 15.7 (`cut`: 15.3; T4b: 15.0 in all JS and 4.9 in the entry) | `?mock=1` on a web build. An APK has no way to add a query string [guess]. Also the documented fallback when the sim, render or scenario module fails to load, with a "Demo engine" banner (README.md:239, ARCHITECTURE.md:85-88) | a documented fallback, so an owner decision |
| 2-D map `mockScene.ts` | Yes | 5.8 | Yes: it is the picture when WebGL2 is missing | product path, keep |
| `window.__firesim` hook (`app.ts:377`, `?debug` or `?mock`) | Yes | 0.04 (0.14 kB raw) | `?debug=1` on a web build | the e2e specs use it, keep |
| `WindArrows` (`windLayer.ts`) and `SceneView.setWindArrows` | Yes | 0.4 (T9, with the hook removed too) | No: only `src/render/dev.ts:71` (`?arrows=1`) turns it on and that page is not built; nothing calls `setWindArrows` | one invisible mesh is still built per 3-D view |
| `import.meta.env.DEV` branches | 2 uses (`app.ts:377`, `buildInfo.ts`) | 0 | both fold to a constant | no dev-only block survives |
| Console diagnostics | 61 `console.*` calls (38 app, 23 library) | 1.31 (app 0.8) | Yes, they are the app's own warnings | keep |
| `buildDemoFuel` ("for tests and dev harnesses", `src/fuel/demo.ts`) re-exported by `src/fuel/index.ts`, which `simulation.ts` imports | Its own code is dropped (0 bytes), but the import keeps `src/data/*`, `@capacitor/core` and `fast-png` code in the worker (8.3 kB gzip by `cut`) | **6.9** saved by T6 (a one-line change; tests import `./demo` directly) | No | the largest real "dev code in production" case |
| Methods without a caller (`SceneView.diagnostics`, `Simulation.perf`, `EmberModel.injectParticle`, ...) | Yes | 3.2 main, 6.7 worker (see Dead code) | No | most are named in tests |

Two more things ship that no APK user reaches, though they are not dev code: the in-thread engine (136.8 kB, reached only when `Worker` is undefined or its constructor throws; `capacitor.config.ts` requires WebView 108, which has module workers) and the GeoTIFF decoders (73.3 kB, reached only by a TIFF with that compression).

## Dead code

**Method.** Module level: the import graph from `src/main.ts` and `src/sim/worker.ts` by the TypeScript compiler (static imports, `import()`, `import.meta.glob`; `import type` not followed), checked against the modules that have code in the build. Symbol level: the language service's find-references on every function, class, variable, enum, method, accessor and initialised field of the 245 bundled modules. A reference counts when it is a run-time use (not an import, an export list, a type position, `implements`, or a `{@link}` in a comment) inside code that is itself live. Roots are module top-level statements, the exports behind the three `import.meta.glob` modules (main bundle only), constructors and fields of live classes, protocol names (`toString`, `then`, ...) and members that override a library class (three.js calls them). The result is a liveness fixpoint, so a function used only by dead functions is dead. Bytes come from the source maps: the generated code that maps into the declaration.

**Module level (`results/dead-code.md`).**

- `src/` has 465 TypeScript files (178 are tests). From `src/main.ts` the graph reaches 259 modules and from `src/sim/worker.ts` 128 (260 together). 245 of them have code in the build, and no module in the build lies outside the graph (0 mismatches).
- Not reachable and not a test or dev page: 7 files, 33.8 kB of source, 0 bytes in the build. Three are types only (`render/api.ts`, `scenario/request.ts`, `sim/protocol.ts`) and `core/places.ts` has one small constant; `render/colourVision.ts` is used only by `palette.test.ts`; `sim/validation/harness.ts` by tests; `ui/contrast.ts` by the style guide and tests.
- Reachable but the bundler dropped all of it: `fire/models/behaviour.ts` (14.9 kB of source, 21 declarations; re-exported by a barrel, called only by tests) and `fuel/demo.ts` (3.4 kB). Neither costs a byte by itself, but `fuel/demo.ts` costs 6.9 kB indirectly (below).
- The 5 dev pages (100.8 kB of source) and 193 test files and helpers (1919 kB of source) are not reachable: 0 bytes.


**Symbol level.**

- 198 declarations with code are not reached by anything live: 103 in the main-thread chunks (11.0 kB raw, 3.2 kB gzip) and 95 in the worker (18.2 kB raw, 6.7 kB gzip). Together 9.8 kB gzip.
- **Worker, 6.7 kB: the data layer.** `storage.ts`, `cache.ts`, `assets.ts`, `ledger.ts`, `core/datasets.ts` and some `svtm.ts` and `openMeteo.ts` tables are in the worker and nothing there calls them. The chain is `worker.ts` to `host.ts` to `simulation.ts` to `fuel/index.ts` to `fuel/demo.ts` to `data/index.ts`. The code of `buildDemoFuel` is dropped, but those modules are kept alive by top-level initialisers that a bundler cannot prove pure: `export const storage = Object.freeze({ report: storageReport, ... })` (`storage.ts:244`), `Object.freeze` tables in `core/datasets.ts:118-143`, an immediately invoked function in `svtm.ts:26`, an array spread in `openMeteo.ts:54`. Deleting the re-export (T6) removes the whole chain: measured 6.9 kB. Treating `Object.freeze` as pure (T8) recovers 4.9 of it, so `Object.freeze` is most of the cause.
- **Main thread, 3.2 kB:** 103 methods, getters and constants, the largest 0.18 kB gzip. They are diagnostics and test hooks: `SceneView.diagnostics`, `PlacesLayer.stats`, `EmberModel.injectParticle` and `Simulation.perf` (each also in the engine copy), `Atmosphere.divergenceMetric`, `TerrainFeaturesImpl.data`, `LevelSetCore.stepFixed`. 93 of the 103 are named in a unit test, e2e spec or script; 16 (for instance `Atmosphere.divergenceMetric`, `SceneView.setSunTime`, `SceneView.setWindArrows`, `rampLut`, `linearToSrgb`) in none (10 names are too short to count). 1.3 kB of the 3.2 is the engine copy in `sim-*.js`, which T3b removes anyway.


**Reliability.** The module graph is complete: every module with code in the build is reached (0 mismatches), which tests it. Symbol references are exact for static references. Use of a name through a string (`obj['name']`, `Reflect`, `window.__firesim` from Playwright) is invisible, so a few "dead" members may be used by e2e specs; the `Named in` column of `results/dead-code.md` counts test, e2e and script files that mention the name (a text count, generic names over-count). Object-literal properties are not analysed separately (they count with their `const`), and `Object.freeze(...)` or other calls the bundler cannot prove pure keep code alive that this analysis calls dead; that is how the worker's data layer shows up. I checked by hand: the generated worker code that comes from `storage.ts` (a top-level `Object.freeze` object and the report functions behind it), the import path from `worker.ts` to `data/index.ts` (a small import-graph trace), `setWindArrows` (no caller in `src`, `e2e` or `tests`), and then confirmed the whole data-layer finding by building without the re-export (T6).

**Reading.** Statically dead code is small: 9.8 kB gzip over all chunks, 6.7 of it the worker's data layer. The rest is 103 test hooks and diagnostics, each under 0.2 kB. This is not where the budget is.

## Trim list

Measured by building each patch (`results/experiments/run.sh`; table below). "All JS" is the `check-bundle.mjs` figure. The ranking is by all-JS saving; the entry column and the start-up column matter for different budgets.

| Rank | Candidate | All JS saved, kB gzip | Entry, kB | Parsed at start-up, raw kB | Risk | How | Release |
| ---: | --- | ---: | ---: | ---: | --- | --- | --- |
| 1 | **T3b** Main-thread engine copy out of the APK build (the `sim-*.js` chunk) | **140.6** | -6.1 | -397.0 | Medium: removes the documented in-thread fallback (ARCHITECTURE.md:275) for the APK only; WebView 108 has module workers. The e2e suite builds in mode `production` (`playwright.config.ts`), so it would not exercise this gated build: add one smoke run of the capacitor build. Owner decision | `src/sim/index.ts` stops re-exporting `Simulation` and `SimHost`; `LocalSimController` moves to its own file used by tests and by a branch that is off when `import.meta.env.MODE === 'capacitor'` | M0 or 0.3.0 lane 1 |
| | T3a Same, but lazy (not removed) | +0.8 | 0 | -384.7 | Low | `LocalSimController` loaded with `import()` only when `Worker` is missing | 0.3.0 (start-up gain only) |
| 2 | **T1** GeoTIFF decoders LERC, ZSTD, JPEG, WebP not shipped | **73.3** | -0.2 | -1.0 | Low: only `src/data/canopy.ts` reads TIFFs, and the Meta canopy COG is Deflate (tag 259 = 8, predictor 2, read from the live file) | a 22-line Vite plugin in `vite.config.ts` (`results/experiments/T1-geotiff-decoders.patch`; add `apply: 'build'` so the dev server and vitest are untouched) | 0.3.0, config only |
| 3 | **T4b** Mock simulation, mock builder and mock data not in the APK build (2-D map kept) | **15.0** | -4.9 | -40.8 | Medium: removes the "Demo engine" fallback for the APK (same e2e caveat as T3b); owner decision | gate `import('./mocks')` in `modules.ts` on `import.meta.env.MODE !== 'capacitor'`; import `mockScene` alone | 0.3.0 |
| | T4a Same, but lazy | +1.2 | 0 | about -41 [by `cut`, the script cannot see the condition] | Low | load `./mocks` only for `?mock=1` or a failed module | 0.3.0 |
| 4 | **T2** pako replaced by fflate (already in the bundle for fast-png) | **13.9** (T1 + T2 = 87.2) | -0.1 | -0.4 | Low to medium: same output on 12 test streams; vitest probably uses the real pako (node_modules are not transformed) [guess], so the shim needs its own test or an e2e read of one real Deflate COG | alias inside the same plugin, `decompressSync(data).slice()` | 0.3.0 |
| 5 | **T6** Drop `buildDemoFuel` from the `fuel` barrel | **6.9** | -0.1 | +0.4 | Low: no test or app imports it through the barrel | delete line 86 of `src/fuel/index.ts` | M0 |
| 6 | T8 `Object.freeze` marked pure (`manualPureFunctions`) | 4.9 alone, 0.8 on top of T6 | 0 | -1.0 | Low | 2 lines in `vite.config.ts` | skip |
| 7 | T7 Scenario barrel exports only `buildScenario` | 4.8 | -0.1 | -36.9 | Low | trim `src/scenario/index.ts` (the glob consumer needs one export) | 0.3.0, start-up |
| 8 | Dead declarations (this note) | about 3 [guess; 9.8 counts the T6 part and engine duplicates] | | | Low | delete the unused methods (103 in the main-thread chunks), one by one, after checking tests | any |
| 9 | T9 `WindArrows` and `__firesim` hook | 0.4 | -0.1 | -1.6 | Low | not worth it; the hook is used by e2e | skip |
| 10 | three.js internals (WebXR, PMREM, serialisation, animation) | up to about 14 [guess] | | | High | needs a patched or aliased three | not recommended |

Entry relief (the entry budget, not the total):

| Candidate | Entry, kB | All JS, kB | Parsed at start-up, raw kB | Risk | How |
| --- | ---: | ---: | ---: | --- | --- |
| **T5a** Model card loaded on first open | **-21.2** | +2.1 | -48.2 | Low | `openModelCard()` in `src/ui/app.ts` awaits `import('./screens/modelCard')`; e2e waits for the screen |
| T5b Data sets screen loaded on first open | -55.2 | +4.4 | -61.5 | Low | same for `openDatasets()` (`e2e/datasets.spec.ts:19` calls it through `__firesim`) |
| T5 Both | -60.0 | +5.1 | -111.1 | Low | |

All 19 builds (`results/experiments.md`, same figures, with what each patch does):

| Experiment | All JS gzip kB | vs baseline | Entry gzip kB | vs baseline | All JS raw kB | Parsed at start-up, raw kB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | 956.7 | +0.0 | 185.4 | +0.0 | 2857 | 2142.1 |
| T1 | 883.4 | -73.3 | 185.2 | -0.2 | 2671 | 2141.1 |
| T2 | 869.5 | -87.2 | 185.3 | -0.1 | 2626 | 2141.7 |
| T3a | 957.5 | +0.8 | 185.4 | +0.0 | 2858 | 1757.4 |
| T3b | 816.1 | -140.6 | 179.3 | -6.1 | 2460 | 1745.1 |
| T4a | 957.9 | +1.2 | 185.4 | +0.0 | 2858 | 2142.8 |
| T4b | 941.7 | -15.0 | 180.5 | -4.9 | 2817 | 2101.3 |
| T5 | 961.8 | +5.1 | 125.4 | -60.0 | 2860 | 2031.0 |
| T5a | 958.8 | +2.1 | 164.2 | -21.2 | 2858 | 2093.9 |
| T5b | 961.1 | +4.4 | 130.2 | -55.2 | 2861 | 2080.6 |
| T6 | 949.8 | -6.9 | 185.3 | -0.1 | 2838 | 2142.5 |
| T7 | 951.9 | -4.8 | 185.3 | -0.1 | 2844 | 2105.2 |
| T8 | 951.8 | -4.9 | 185.4 | +0.0 | 2844 | 2141.1 |
| T9 | 956.3 | -0.4 | 185.3 | -0.1 | 2856 | 2140.5 |
| safe | 862.7 | -94.0 | 185.3 | -0.1 | 2607 | 2142.1 |
| safe+T5a | 864.7 | -92.0 | 164.2 | -21.2 | 2608 | 2093.7 |
| safe+T4b | 847.5 | -109.2 | 180.5 | -4.9 | 2566 | 2101.3 |
| safe+T3b | 721.4 | -235.3 | 179.3 | -6.1 | 2210 | 1744.7 |
| all | 709.8 | -246.9 | 123.4 | -62.0 | 2171 | 1586.2 |

Not built, start-up only: the render chunk (743.8 kB raw, 35 % of the start-up parse) is requested at start-up, but the UI reads its legends only inside the sim screen (`layersPanel.ts`, `simScreen.ts`), so `loadServices()` could hand it over when the first model is built [guess: about 35 % less start-up parse; it changes `Services`, and the Setup screen must not need `sources.scene`]. It would not change the all-JS total.

The plan lists "dev-only code and dead code" as the trim candidates. Together they are worth about 26 kB (mocks 15.7, fuel barrel 6.9, dead declarations about 3, arrows and hook 0.4). The two items that decide D10 are not in that list: the duplicate engine and the unused GeoTIFF decoders.

### How much can safe trims free?

"Safe" here means no behaviour an APK user can reach changes: T1, T2 and T6. Built together (`safe` row): **94.0 kB**, 956.7 to 862.7. T4b and T3b change documented fallbacks (a decision for the owner) and are listed with their own rows (`safe+T4b` 847.5, `safe+T3b` 721.4, `all` 709.8).

| Release | Plan's estimate (baseline 953.8) | Same increments on the measured baseline 956.7 | After the safe set (862.7) |
| --- | ---: | ---: | ---: |
| 0.3.0 | 977 (high 980) | 979.9 (982.9) | 885.9 (888.9) |
| 0.4.0 | 996 (high 1001) | 998.9 (1003.9) | 904.9 (909.9) |
| 0.5.0 | 1008 (high 1015) | 1010.9 (1017.9) | 916.9 (923.9) |

The plan's additions do not count the engine copy: every kB added to the engine counts twice while `sim-*.js` exists (the plan puts H-sim at "about 2 kB in the worker"; it is 4 kB in all JS) [estimate: 4 to 5 kB over the whole plan].

## Recommendation for D10

**D10 should be: lazy-load everything heavy as planned, run the trim pass now, and do not plan to raise the all-JS budget.**

1. Do the safe set (T1, T2, T6) in M0 or as the first task of 0.3.0. It is 25 added lines in `vite.config.ts` (T1 22, T2 3) and one deleted line (T6), it frees 94.0 kB, and `check-bundle.mjs` will fail if a decoder comes back. After it the plan's additions fit with 76 to 91 kB spare at the end of 0.5.0.
2. Ask the owner two questions now, not at the end of 0.4.0: whether the APK build may drop the in-thread engine copy (T3b, 140.6 kB, also 397 kB less to parse at start-up) and the mock engine (T4b, 15.0 kB). Both are documented fallbacks. If the answer is no, take the lazy versions (T3a, T4a): they free nothing but they stop parsing 425 kB at start-up.
3. Make the entry budget safe in 0.3.0: take T5a (lazy model card). Without it the entry passes 195 kB around 0.3.0 or 0.4.0: the plan's entry-resident additions are A 1 + B 3 + C 3 + F 1 + G 1 + I 2 = 11 kB (I is in the entry, see below) plus D, E and H glue [guess: 13 to 17 kB in all] against 9.6 kB of headroom.
4. Keep the decision rule: ask for a bigger all-JS budget only if, after the safe set, the measured total at the end of 0.4.0 is above 950 kB. By the numbers above it should be about 905 to 910.
5. Re-run `attribute.mjs chunks` (8 s) and `check-bundle.mjs` at the end of each release, and put new lazy code in its own file: a module imported from the entry lands in the entry.

Context for the budget size: the debug APK is 27.6 MB (ARCHITECTURE.md), so 100 kB more JS would add 0.4 % to it. The cost of JS is the parse at start-up (phases 1 and 2), not the all-JS total. A raise would be cheap in size and would not be a start-up problem if the added code is lazy.

## Corrections to the plan

1. Section 11 and the budget risk row: all JS is 956.7 kB, not 953.8 (headroom 43.3, not 46.2); the entry is 185.4, not 184 (headroom 9.6, not 11). "kB" in `check-bundle.mjs` is 1024 bytes.
2. D10 says "Estimated additions are 40-50 kB gzip"; section 11 says 46 to 61. They should agree.
3. Section 11, row I: "the pick logic, the words and the Why row in the sim-screen chunk". There is no sim-screen chunk. `simScreen.ts`, `whyPanel.ts`, `sheet.ts`, `insightCard.ts` are in the entry, so row I is an entry cost.
4. Section 11: "Entry chunk additions are kept under about 5 kB". The entry-resident rows of its own table already add up to 11 kB (see D10 recommendation, point 3).
5. Section 11, row H: "about 2 kB in the worker" counts twice while the engine copy `sim-*.js` exists (same for the engine parts of A, C and H-sim).
6. Section 8.5: the "pattern: `src/ui/modules.ts:76-84`" for lazy loading on first use loads the chunks at start-up, in every mode. An on-first-use pattern is `await import(...)` inside a handler. Note that `src/ui/screens/setup.ts:853` looks like one but is not, because the scenario barrel already imports `estimate` statically.
7. `docs/ARCHITECTURE.md` "Performance budgets" (lines 684 to 686) still shows 2821 / 945 kB (JS), 506 / 177 (entry) and 121.6 / 21.8 (CSS) as "now"; the 0.2.2 tree is 2857 / 956.7, 532 / 185.4 and 122.2 / 21.9.

## Limits

- One commit, one build configuration, one machine (4 shared cores, load 2 to 9, so timings are rough). The numbers move when the M0 lanes land types and other spikes land code.
- Gzip shares per module are bit costs in the real stream, not a property of the module: a module that repeats earlier text pays less. `cut` is the right figure for "what does deleting save" and it deletes bytes without re-minifying, so it can be a little low or high. The experiments (real builds) are the reference where both exist.
- The experiment patches are crude. They were not type-checked, linted or tested. They show what a change is worth, not that it is correct. T2 changes the inflate used for the canopy COG and needs a test that reads one. T3b and T4b need decisions, and because they are gated on `import.meta.env.MODE === 'capacitor'` the e2e suite (which runs on `npm run build`, mode `production`) would not see them. T5 makes two overlay openers asynchronous, which the e2e specs must wait for.
- The dead-code method misses uses through strings and may call live code dead when only a test calls it (the `Named in` column helps). It does not look inside object literals, comments or CSS.
- The CSS check is a text heuristic (`attribute.mjs css`): 54 of 1292 rules (2.8 kB of 122.2 kB) name a class that appears in no source file, mostly classes built at run time (`origin-${origin}`, `sev-${severity}`, `tl-mark-${severity}`); about 0.5 kB is probably really unused (`.btn-danger`, `.card-tap`, `.divider-inset`). Not a candidate.
- The canopy compression was read from one tile (`311230121`, Katoomba) on 2026-10-13. Other tiles come from the same pipeline [guess].
- "An APK has no way to add a query string" and "WebView 108 supports module workers" are from reading `capacitor.config.ts` and general knowledge; I did not test them on a device.
- V8 parse times are for this machine only. Phone figures are guesses.
- The estimates for the plan's additions (46 to 61 kB) are the plan's, not mine.

## How to reproduce

Run these from a clean checkout of `64c2133` (or any tree where `git status` is clean for `src/`). `S` is a scratch folder outside the repo; delete `$S` afterwards (each `dist` holds the 35 MB demo data).

```
S=/tmp/s2; mkdir -p $S
# 1. Baseline, the way the APK build does it, and its figures
nice -n 10 npx vite build --mode capacitor --outDir $S/dist --emptyOutDir
node scripts/check-bundle.mjs --dist $S/dist
# 2. The same build with source maps, and the proof that the JS is the same
nice -n 10 npx vite build --mode capacitor --sourcemap --outDir $S/dist-map --emptyOutDir
node docs/plans/spikes/S2-bundle/attribute.mjs compare --dist $S/dist --other $S/dist-map
# 3. A snapshot of the build's sources for the source-level steps (other work may be going on in the tree)
mkdir -p $S/snap && git archive 64c213354dbe85cd94abf324639af1fdd08b87ff | tar -x -C $S/snap && ln -s "$PWD/node_modules" $S/snap/node_modules
# 4. Every table in results/ (about 2.5 minutes; the dead-code step is most of it)
nice -n 10 node docs/plans/spikes/S2-bundle/attribute.mjs all --dist $S/dist-map --root $S/snap --out docs/plans/spikes/S2-bundle/results
# 5. One table at a time
node docs/plans/spikes/S2-bundle/attribute.mjs chunks  --dist $S/dist-map
node docs/plans/spikes/S2-bundle/attribute.mjs modules --dist $S/dist-map --top 40
node docs/plans/spikes/S2-bundle/attribute.mjs blobs   --dist $S/dist-map
node docs/plans/spikes/S2-bundle/attribute.mjs cut     --dist $S/dist-map --match 'node_modules/(zstddec|lerc)/'
node docs/plans/spikes/S2-bundle/attribute.mjs symbols --dist $S/dist-map --match 'src/render/windLayer.ts'
node docs/plans/spikes/S2-bundle/attribute.mjs range   --dist $S/dist-map --file src/ui/app.ts --grep __firesim
node docs/plans/spikes/S2-bundle/attribute.mjs dead    --dist $S/dist-map --root $S/snap
node docs/plans/spikes/S2-bundle/attribute.mjs css     --dist $S/dist --root $S/snap
node --experimental-vm-modules --no-warnings docs/plans/spikes/S2-bundle/attribute.mjs compile --dist $S/dist-map
# 6. The trim experiments (about 5 minutes on a busy machine): each patch applied to a copy of the snapshot, built, measured
docs/plans/spikes/S2-bundle/results/experiments/run.sh $S/exp
# 7. The canopy compression, read from the live file (HTTP range request, then TIFF tag 259 and 317)
curl -s -r 0-65535 -o $S/chm-head.bin https://dataforgood-fb-data.s3.amazonaws.com/forests/v1/alsgedi_global_v6_float/chm/311230121.tif
node -e "const b=require('fs').readFileSync(process.argv[1]);const p=Number(b.readBigUInt64LE(8));const n=Number(b.readBigUInt64LE(p));for(let i=0;i<n;i++){const e=p+8+i*20,t=b.readUInt16LE(e);if(t===259||t===317)console.log('tag',t,'=',b.readUInt16LE(e+12))}" $S/chm-head.bin
# 8. pako and fflate give the same bytes (used by T2)
node -e "const p=require('pako'),f=require('fflate'),z=require('zlib');const x=Buffer.alloc(70000,7);for(const c of [z.deflateSync(x),z.gzipSync(x)])console.log(Buffer.compare(Buffer.from(p.inflate(c)),Buffer.from(f.decompressSync(c)))===0)"
```

Step 7 assumes a BigTIFF header (the tile is one: magic 43); the script prints `tag 259 = 8` (Deflate) and `tag 317 = 2` (predictor). Step 4 needs the language service of `typescript` from `node_modules`; nothing is installed.

## Files

| File | What it is |
| --- | --- |
| `README.md` | this note |
| `attribute.mjs` | the reusable tool: `chunks`, `modules`, `blobs`, `cut`, `symbols`, `range`, `css`, `compare`, `compile`, `dead`, `all` (usage at the top of the file) |
| `results/chunks.md`, `chunks.csv` | every chunk: size, load path, trigger, start-up phases |
| `results/attribution.md` | top modules, packages, folders, duplicates, and the groups and biggest modules of every chunk |
| `results/modules.csv` | every module in every chunk: raw, gzip, string bytes |
| `results/packages.csv` | package or folder by chunk |
| `results/blobs.md` | big string literals, text-heavy modules, console calls |
| `results/dead-code.md`, `dead-code.csv` | module reachability and the dead declarations, per bundle |
| `results/css.md` | the CSS heuristic |
| `results/experiments.md` | the experiment table (19 rows) and what each patch does |
| `results/experiments/T*.patch`, `run.sh` | one patch per trim candidate and the script that rebuilds the table |
