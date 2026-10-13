# Trim experiments

Each row is a real build of the 0.2.2 sources (commit `64c2133`) with one patch (or a set of patches) applied, built with `vite build --mode capacitor` and read with `scripts/check-bundle.mjs`. Sizes are kB (1024 bytes), gzip -9 per file. "Parsed at start-up" is the raw size of the main-thread chunks that load before the first screen (the entry and its static imports) or that `loadServices()` requests at start-up, from `attribute.mjs chunks` on the same build with source maps.

Rebuild the table: `docs/plans/spikes/S2-bundle/results/experiments/run.sh <scratch folder> [experiment ...]` (about 5 minutes; the baseline is always built first).

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

| ID | What the patch does | Patch |
| --- | --- | --- |
| T1 | `vite.config.ts` plugin: the GeoTIFF registry's `import('./lerc.js')`, `./zstd.js`, `./jpeg.js` and `./webimage.js` resolve to a stub that throws. The canopy source is Deflate | `T1-geotiff-decoders.patch` |
| T2 | adds to the same plugin: geotiff's `import { inflate } from 'pako'` resolves to a shim over fflate's `decompressSync(data).slice()` (fflate is already in the bundle for fast-png). Includes T1 | `T2-pako-to-fflate.patch` |
| T3a | `LocalSimController` moves to `src/sim/localController.ts` and is loaded with `import()` only when there is no `Worker`; `src/sim/index.ts` stops re-exporting the engine | `T3a-sim-fallback-lazy.patch` |
| T3b | `LocalSimController` throws instead of building an in-thread host; `src/sim/index.ts` stops re-exporting the engine (the engine copy disappears from the main-thread chunks) | `T3b-sim-fallback-removed.patch` |
| T4a | `src/ui/modules.ts` loads `./mockScene` at start-up and `./mocks` only for `?mock=1` or when a real module is missing | `T4a-mocks-lazy.patch` |
| T4b | `src/ui/modules.ts` loads only `./mockScene` when `import.meta.env.MODE === 'capacitor'` | `T4b-mocks-not-in-apk.patch` |
| T5, T5a, T5b | `src/ui/app.ts` loads the model card and the Data sets screen (T5a model card only, T5b Data sets only) with `import()` on first open | `T5*.patch` |
| T6 | `src/fuel/index.ts` no longer re-exports `buildDemoFuel` from `./demo` (a helper "for tests and dev harnesses"; its import keeps the data layer in the worker) | `T6-fuel-barrel.patch` |
| T7 | `src/scenario/index.ts` exports only `buildScenario` (and the request types) | `T7-scenario-barrel.patch` |
| T8 | `vite.config.ts`: `rolldownOptions.treeshake.manualPureFunctions: ['Object.freeze']` for the app and the worker | `T8-object-freeze-pure.patch` |
| T9 | removes `WindArrows`, `SceneView.setWindArrows` and the `window.__firesim` hook | `T9-wind-arrows-and-debug-hook.patch` |
| safe | T1 + T2 + T6 | |
| safe+T5a, safe+T4b, safe+T3b | safe plus one more patch | |
| all | T1 + T2 + T3b + T4b + T5 + T6 | |

Notes.

- T3a and T4a keep the code in the build, so the all-JS total does not fall (it rises by 0.8 and 1.2 kB). Their value is the start-up column: T3a leaves 385 kB raw of engine code unparsed at start-up. The start-up figure of T4a is wrong in this table: the script classes every `import()` in `src/ui/modules.ts` as start-up, and the condition cannot be seen; by `attribute.mjs cut` about 41 kB raw leaves the start-up set.
- T5 moves bytes: the entry falls by 60.0 kB and the total rises by 5.1 kB. It is for the entry budget, not the total.
- T2's patch is applied on top of T1's (both edit the same plugin); its own saving is T2 minus T1: 13.9 kB.
- T8 is mostly the same effect as T6 (the worker's data layer is kept alive by `Object.freeze(...)` at module top level): on top of T6 it saves 0.8 kB.
- The patches are crude and were not type-checked or tested. They measure what a change is worth; they are not the change.
