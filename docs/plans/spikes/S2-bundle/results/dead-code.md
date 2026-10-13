Tree checked: the one given by --root; 245 application modules have code in the build; 0 differ from the build's embedded sources.

### Modules: reachability from `src/main.ts` and `src/sim/worker.ts`

465 files under src/ (the TypeScript program, tests included). Following run-time imports (static, `import()`, `import.meta.glob`; `import type` is not followed) reaches 259 modules from `src/main.ts` and 128 from `src/sim/worker.ts` (260 together). 245 of those have code in the build. Modules in the build that the graph did not reach: 0 (the graph is complete).

| Not reachable from the app | Files | Source kB | Examples |
| --- | ---: | ---: | --- |
| other | 7 | 33.8 | `src/core/places.ts`, `src/render/api.ts`, `src/scenario/request.ts`, `src/sim/protocol.ts`, `src/render/colourVision.ts`, `src/sim/validation/harness.ts` |
| test or test helper | 193 | 1919.3 | `src/atmosphere/testUtils.ts`, `src/atmosphere/atmosphere.test.ts`, `src/atmosphere/background.test.ts`, `src/atmosphere/diagnosticWind.test.ts`, `src/atmosphere/integration.test.ts`, `src/atmosphere/perf.test.ts` |
| dev page | 5 | 100.8 | `src/render/devScenario.ts`, `src/render/dev.ts`, `src/render/devTrees.ts`, `src/render/legendGallery.ts`, `src/ui/styleguide.ts` |

Files under `src/` that are not tests, not dev pages and not reachable from the entry points (they cost nothing in the bundle):

| File | Source kB |
| --- | ---: |
| `src/core/places.ts` | 3.0 |
| `src/render/api.ts` | 6.7 |
| `src/scenario/request.ts` | 3.8 |
| `src/sim/protocol.ts` | 4.1 |
| `src/render/colourVision.ts` | 3.0 |
| `src/sim/validation/harness.ts` | 12.0 |
| `src/ui/contrast.ts` | 1.2 |

Test helpers and dev pages that have code in the build: 0.

Reachable modules with run-time declarations but no bytes in any chunk (the bundler dropped everything in them): 2. They can still pull their imports into a bundle through top-level statements that the bundler must keep (see the worker section below).

| Module | Declarations | Source kB |
| --- | ---: | ---: |
| `src/fire/models/behaviour.ts` | 21 | 14.9 |
| `src/fuel/demo.ts` | 1 | 3.4 |

### Symbols in the build that nothing live reaches

Method: the TypeScript language service lists every reference to each of the 5269 top-level declarations and class members (functions, classes, variables, enums, methods, accessors, fields) of the 245 modules in the build. A reference counts when it is a run-time use (not an import, an export list, a type position or `implements`) inside code that is itself live. Roots: module top-level statements of the modules each bundle loads; for the main-thread bundle also the exports behind the three `import.meta.glob` modules; constructors and fields of live classes; protocol names (constructor, toString, toJSON, valueOf, ...) and members that override a library class. Everything else is dead. It is done twice, once for the main-thread chunks (entry `src/main.ts`) and once for the worker (entry `src/sim/worker.ts`), because a module bundled into both is live in one and may be dead in the other. Bytes are the generated code whose source map points inside the declaration, in the chunks of that bundle.

| Bundle | Dead declarations with code | Raw kB | gzip kB |
| --- | ---: | ---: | ---: |
| main-thread chunks | 103 | 11.01 | 3.20 |
| worker | 95 | 18.24 | 6.65 |

Total: 198 declarations, raw 29.25 kB, gzip 9.84 kB (class bodies count without their members).

| Bundle: kind | Count | Raw kB | gzip kB |
| --- | ---: | ---: | ---: |
| worker: function | 25 | 9.03 | 3.32 |
| worker: const | 38 | 5.96 | 2.30 |
| main: method | 57 | 7.53 | 2.18 |
| worker: method | 21 | 2.62 | 0.82 |
| main: getter | 38 | 1.98 | 0.58 |
| main: const | 6 | 1.22 | 0.33 |
| worker: getter | 11 | 0.63 | 0.20 |
| main: function | 2 | 0.28 | 0.11 |

By module (top 15 by gzip):

| Module (bundle) | Dead declarations | Raw kB | gzip kB |
| --- | ---: | ---: | ---: |
| `src/data/storage.ts (worker)` | 10 | 4.79 | 1.87 |
| `src/data/cache.ts (worker)` | 15 | 3.62 | 1.15 |
| `src/core/datasets.ts (worker)` | 7 | 1.14 | 0.61 |
| `src/data/assets.ts (worker)` | 9 | 1.46 | 0.57 |
| `src/render/SceneView.ts (main)` | 18 | 2.20 | 0.57 |
| `src/fuel/svtm.ts (worker)` | 5 | 1.14 | 0.32 |
| `src/data/ledger.ts (worker)` | 3 | 0.54 | 0.30 |
| `src/render/placesLayer.ts (main)` | 7 | 0.89 | 0.29 |
| `src/fuel/moisture/cellParams.ts (worker)` | 1 | 1.12 | 0.27 |
| `src/fuel/moisture/cellParams.ts (main)` | 1 | 1.12 | 0.27 |
| `src/scenario/openMeteo.ts (worker)` | 5 | 0.58 | 0.24 |
| `src/sim/simulation.ts (worker)` | 9 | 0.71 | 0.21 |
| `src/sim/simulation.ts (main)` | 9 | 0.71 | 0.21 |
| `src/render/vegetationLayer.ts (main)` | 8 | 0.61 | 0.16 |
| `src/fire/terrainFeatures.ts (main)` | 2 | 0.62 | 0.16 |

The 40 biggest (own gzip bytes):

| Declaration | Module | Kind | Bundle | Raw kB | gzip kB | Why dead | Named in |
| --- | --- | --- | --- | ---: | ---: | --- | --- |
| storageReport | `src/data/storage.ts` | function | worker | 2.64 | 1.02 | only used by dead code: storage | 1 test/dev files, 0 e2e |
| createIndexedDbKV | `src/data/cache.ts` | function | worker | 1.82 | 0.57 | only used by dead code: openCache | 1 test/dev files, 0 e2e |
| STORAGE_KINDS | `src/data/storage.ts` | const | worker | 0.89 | 0.39 | only used by dead code: storageReport, kindOfKey | 0 test/dev files, 0 e2e |
| MOISTURE_TYPE_DEFAULTS | `src/fuel/moisture/cellParams.ts` | const | worker | 1.12 | 0.27 | used only from code that is not in this bundle | 1 test/dev files, 0 e2e |
| MOISTURE_TYPE_DEFAULTS | `src/fuel/moisture/cellParams.ts` | const | main | 1.12 | 0.27 | used only from code that is not in this bundle | 1 test/dev files, 0 e2e |
| ROLE_TITLES | `src/core/datasets.ts` | const | worker | 0.32 | 0.22 | used only from code that is not in this bundle | 0 test/dev files, 0 e2e |
| PlacesLayer.stats | `src/render/placesLayer.ts` | method | main | 0.47 | 0.18 | only used by dead code: SceneView.diagnostics, SceneView.placesStats | 40 test/dev files, 6 e2e |
| VEG_CLASS_TO_ID | `src/fuel/svtm.ts` | const | worker | 0.61 | 0.18 | used only from code that is not in this bundle | 0 test/dev files, 0 e2e |
| SceneView.diagnostics | `src/render/SceneView.ts` | method | main | 0.60 | 0.17 | no reference in the bundled code | 8 test/dev files, 0 e2e |
| endpointOf | `src/data/ledger.ts` | function | worker | 0.32 | 0.17 | only used by dead code: loadAsset | 1 test/dev files, 0 e2e |
| OM_SURFACE_VARS | `src/scenario/openMeteo.ts` | const | worker | 0.42 | 0.17 | only used by dead code: OM_HOURLY_VARS | 0 test/dev files, 0 e2e |
| placeOfKey | `src/data/storage.ts` | function | worker | 0.46 | 0.16 | only used by dead code: storageReport | 1 test/dev files, 0 e2e |
| EmberModel.injectParticle | `src/embers/EmberModel.ts` | method | worker | 0.33 | 0.14 | no reference in the bundled code | 3 test/dev files, 0 e2e |
| EmberModel.injectParticle | `src/embers/EmberModel.ts` | method | main | 0.33 | 0.14 | no reference in the bundled code | 3 test/dev files, 0 e2e |
| resolveAssetBase | `src/data/assets.ts` | function | worker | 0.33 | 0.13 | only used by dead code: browserLoader | 1 test/dev files, 0 e2e |
| B64_LOOKUP | `src/data/http.ts` | const | worker | 0.19 | 0.12 | used only from code that is not in this bundle | 0 test/dev files, 0 e2e |
| createMemoryKV | `src/data/cache.ts` | function | worker | 0.36 | 0.12 | only used by dead code: createIndexedDbKV, openCache | 11 test/dev files, 0 e2e |
| formatBytes | `src/core/datasets.ts` | function | worker | 0.22 | 0.12 | only used by dead code: storageReport | 5 test/dev files, 1 e2e |
| placeLabel | `src/data/storage.ts` | function | worker | 0.25 | 0.12 | only used by dead code: storageReport | 1 test/dev files, 0 e2e |
| ORIGIN_TITLES | `src/core/datasets.ts` | const | worker | 0.25 | 0.10 | used only from code that is not in this bundle | 0 test/dev files, 0 e2e |
| browserLoader | `src/data/assets.ts` | const | worker | 0.27 | 0.10 | only used by dead code: defaultLoader | 0 test/dev files, 0 e2e |
| loadAsset | `src/data/assets.ts` | function | worker | 0.23 | 0.10 | only used by dead code: loadAssetJson | 2 test/dev files, 0 e2e |
| Atmosphere.divergenceMetric | `src/atmosphere/atmosphere.ts` | method | worker | 0.32 | 0.09 | no reference in the bundled code | 0 test/dev files, 0 e2e |
| Atmosphere.divergenceMetric | `src/atmosphere/atmosphere.ts` | method | main | 0.32 | 0.09 | no reference in the bundled code | 0 test/dev files, 0 e2e |
| TerrainFeaturesImpl.data | `src/fire/terrainFeatures.ts` | method | main | 0.34 | 0.09 | no reference in the bundled code | ? |
| LevelSetCore.stepFixed | `src/fire/spread/levelSet.ts` | method | main | 0.26 | 0.09 | only used by dead code: FireSpreadModel.stepFixed | 2 test/dev files, 0 e2e |
| TerrainFeaturesImpl.data | `src/fire/terrainFeatures.ts` | method | worker | 0.34 | 0.09 | no reference in the bundled code | ? |
| LevelSetCore.stepFixed | `src/fire/spread/levelSet.ts` | method | worker | 0.26 | 0.09 | only used by dead code: FireSpreadModel.stepFixed | 2 test/dev files, 0 e2e |
| VEG_FORM_TO_ID | `src/fuel/svtm.ts` | const | worker | 0.42 | 0.09 | used only from code that is not in this bundle | 0 test/dev files, 0 e2e |
| CameraRig.cameraState | `src/render/cameraRig.ts` | method | main | 0.28 | 0.08 | only used by dead code: SceneView.cameraState | 3 test/dev files, 3 e2e |
| traceRead | `src/data/ledger.ts` | function | worker | 0.16 | 0.08 | only used by dead code: loadAsset | 1 test/dev files, 0 e2e |
| STATUS_TITLES | `src/core/datasets.ts` | const | worker | 0.15 | 0.08 | used only from code that is not in this bundle | 0 test/dev files, 0 e2e |
| rampLut | `src/render/palette.ts` | function | main | 0.21 | 0.08 | no reference in the bundled code | 0 test/dev files, 0 e2e |
| HeightField.decimation | `src/render/heightfield.ts` | method | main | 0.17 | 0.07 | no reference in the bundled code | 2 test/dev files, 0 e2e |
| approxBytes | `src/data/cache.ts` | function | worker | 0.26 | 0.07 | only used by dead code: storedBytes | 0 test/dev files, 0 e2e |
| TerrainLayer.setZones | `src/render/terrainLayer.ts` | method | main | 0.23 | 0.07 | no reference in the bundled code | 1 test/dev files, 0 e2e |
| nodeLoader | `src/data/assets.ts` | const | worker | 0.19 | 0.07 | only used by dead code: defaultLoader | 0 test/dev files, 0 e2e |
| SceneView.renderNow | `src/render/SceneView.ts` | method | main | 0.32 | 0.07 | no reference in the bundled code | 1 test/dev files, 4 e2e |
| TerrainFeaturesImpl.crestSector | `src/fire/terrainFeatures.ts` | method | main | 0.28 | 0.07 | no reference in the bundled code | 1 test/dev files, 0 e2e |
| TerrainFeaturesImpl.crestSector | `src/fire/terrainFeatures.ts` | method | worker | 0.28 | 0.07 | no reference in the bundled code | 1 test/dev files, 0 e2e |
