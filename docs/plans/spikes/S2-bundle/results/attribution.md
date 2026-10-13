kB = 1024 bytes. gzip kB is each module's share of the chunk's real gzip -9 size (bits of the compressed stream), so the shares add up to the totals of scripts/check-bundle.mjs.

### Top 40 modules, all chunks (by gzip bytes attributed)

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

### Packages and folders, all chunks together

| Group | Raw kB | gzip kB | % of all gzip | Modules | Where (gzip kB per chunk) |
| --- | ---: | ---: | ---: | ---: | --- |
| src/ui | 485.7 | 168.5 | 17.6 % | 69 | index 147.0, mocks 21.5 |
| three | 542.5 | 132.7 | 13.9 % | 3 | render 132.7 |
| src/render | 275.8 | 94.5 | 9.9 % | 37 | render 67.5, index 27.0 |
| src/explain | 242.4 | 83.5 | 8.7 % | 32 | worker 41.8, sim 41.7 |
| src/scenario | 212.5 | 75.3 | 7.9 % | 27 | estimate 32.4, weatherSources 12.0, datasetStats 8.3, openMeteo 5.2, index 5.1, scenario 3.9, replays 3.5, worker 2.1, weather 1.5, areaPack 1.3 |
| zstddec | 150.5 | 59.7 | 6.2 % | 2 | zstd 31.3, lerc 28.4 |
| src/fire | 155.9 | 57.9 | 6.1 % | 48 | worker 28.5, sim 27.3, index 1.9, mcarthur 0.2 |
| src/atmosphere | 153.6 | 55.5 | 5.8 % | 28 | worker 27.6, sim 26.7, catalogue 1.2 |
| src/fuel | 121.1 | 43.3 | 4.5 % | 40 | worker 19.2, sim 9.9, mcarthur 9.3, catalogue 3.3, weather 1.6 |
| src/embers | 100.9 | 35.3 | 3.7 % | 14 | worker 17.6, sim 16.3, index 1.4 |
| src/sim | 94.8 | 30.3 | 3.2 % | 14 | worker 14.6, sim 14.3, index 1.1, catalogue 0.3 |
| src/data | 73.3 | 28.8 | 3.0 % | 21 | data 11.3, storage 10.6, worker 5.0, datasetStats 1.3, weatherSources 0.6 |
| geotiff | 58.3 | 19.6 | 2.0 % | 25 | data 10.7, jpeg 3.9, globals 2.3, lzw 0.8, basedecoder 0.7, webimage 0.5, lerc 0.4, packbits 0.2, zstd 0.1, deflate 0.1, raw 0.1 |
| pako | 45.5 | 14.3 | 1.5 % | 1 | pako.esm 14.3 |
| src/terrain | 27.6 | 11.8 | 1.2 % | 5 | terrain 5.9, worker 5.5, hillshade 0.4 |
| src/core | 28.2 | 11.3 | 1.2 % | 13 | storage 4.6, worker 3.6, data 1.0, openMeteo 0.9, terrain 0.8, rng 0.3 |
| [bundler/glue] | 13.2 | 7.8 | 0.8 % | 33 | index 1.1, scenario 0.7, preload-helper 0.7, estimate 0.6, render 0.5, sim 0.5, mocks 0.5, globals 0.4, data 0.4, weatherSources 0.4, esm 0.3, mcarthur 0.2, areaPack 0.2, datasetStats 0.1, replays 0.1, lerc 0.1, openMeteo 0.1, storage 0.1, web 0.1, weather 0.1, deflate 0.1, terrain 0.1, worker 0.1, zstd 0.1, raw 0.1, jpeg 0.1, packbits 0.1, lzw 0.1, webimage 0.1, catalogue 0.1, hillshade 0.1 |
| lerc | 22.5 | 7.8 | 0.8 % | 1 | lerc 7.8 |
| @capacitor/core | 15.3 | 6.0 | 0.6 % | 2 | dist 3.0, worker 3.0 |
| fast-png | 13.5 | 4.0 | 0.4 % | 15 | data 3.9, worker 0.1 |
| fflate | 4.9 | 2.3 | 0.2 % | 1 | data 2.3 |
| iobuffer | 5.8 | 1.3 | 0.1 % | 4 | data 1.2, worker 0.1 |
| @petamoriken/float16 | 2.5 | 1.2 | 0.1 % | 4 | data 1.2 |
| src (root) | 2.1 | 0.9 | 0.1 % | 1 | index 0.9 |
| @capacitor/geolocation | 2.2 | 0.9 | 0.1 % | 2 | web 0.8, esm 0.1 |
| quick-lru | 3.3 | 0.9 | 0.1 % | 1 | data 0.9 |
| xml-utils | 1.6 | 0.6 | 0.1 % | 6 | data 0.6 |
| @capacitor/preferences | 1.3 | 0.6 | 0.1 % | 2 | web 0.5, esm 0.1 |
| @capacitor/synapse | 0.6 | 0.3 | 0.0 % | 1 | esm 0.3 |

Total: raw 2857.4 kB, gzip 956.7 kB.

### Application folders, one level down (top 25 by gzip)

| Folder | Raw kB | gzip kB | Modules | Where (gzip kB per chunk) |
| --- | ---: | ---: | ---: | --- |
| src/render (files) | 275.8 | 94.5 | 37 | render 67.5, index 27.0 |
| src/ui (files) | 245.1 | 87.1 | 37 | index 65.6, mocks 21.5 |
| src/ui/screens | 240.6 | 81.3 | 32 | index 81.3 |
| src/scenario (files) | 212.5 | 75.3 | 27 | estimate 32.4, weatherSources 12.0, datasetStats 8.3, openMeteo 5.2 |
| src/explain (files) | 167.3 | 58.4 | 22 | worker 29.2, sim 29.2 |
| src/atmosphere (files) | 153.6 | 55.5 | 28 | worker 27.6, sim 26.7, catalogue 1.2 |
| src/fire/spread | 102.0 | 36.4 | 16 | worker 18.2, sim 17.2, index 1.1 |
| src/embers (files) | 100.9 | 35.3 | 14 | worker 17.6, sim 16.3, index 1.4 |
| src/sim (files) | 94.8 | 30.3 | 14 | worker 14.6, sim 14.3, index 1.1, catalogue 0.3 |
| src/data (files) | 73.3 | 28.8 | 21 | data 11.3, storage 10.6, worker 5.0, datasetStats 1.3 |
| src/explain/rules | 75.1 | 25.1 | 10 | worker 12.6, sim 12.5 |
| src/fuel (files) | 70.0 | 22.9 | 18 | mcarthur 9.3, worker 9.2, catalogue 3.3, sim 1.1 |
| src/fuel/moisture | 51.1 | 20.5 | 22 | worker 10.0, sim 8.9, weather 1.6 |
| src/fire/models | 30.2 | 12.5 | 30 | worker 6.0, sim 5.4, index 0.9, mcarthur 0.2 |
| src/terrain (files) | 27.6 | 11.8 | 5 | terrain 5.9, worker 5.5, hillshade 0.4 |
| src/core (files) | 28.2 | 11.3 | 13 | storage 4.6, worker 3.6, data 1.0, openMeteo 0.9 |
| src/fire (files) | 23.6 | 9.0 | 2 | sim 4.7, worker 4.3 |
| src (root) | 2.1 | 0.9 | 1 | index 0.9 |

### Modules bundled into more than one chunk

111 modules appear in two chunks (the sim chunk and the worker bundle are built separately, so the engine is in both). The smaller copies add raw 475.2 kB, gzip 168.0 kB to the total.

| Module | Chunks | Extra copy raw kB | Extra copy gzip kB |
| --- | --- | ---: | ---: |
| `src/embers/EmberModel.ts` | sim + worker | 36.6 | 12.26 |
| `src/fire/spread/FireSpreadModel.ts` | worker + sim | 32.2 | 10.82 |
| `src/sim/simulation.ts` | sim + worker | 35.6 | 10.77 |
| `src/explain/text.ts` | sim + worker | 31.1 | 10.01 |
| `src/atmosphere/atmosphere.ts` | worker + sim | 19.6 | 6.28 |
| `src/fuel/moisture/model.ts` | sim + worker | 14.8 | 5.75 |
| `src/atmosphere/base.ts` | sim + worker | 15.9 | 5.51 |
| `src/explain/rules/weather.ts` | worker + sim | 13.7 | 4.29 |
| `src/fire/terrainFeatures.ts` | sim + worker | 11.8 | 4.28 |
| `src/atmosphere/solver.ts` | sim + worker | 10.3 | 3.92 |
| `src/explain/explainCell.ts` | worker + sim | 9.9 | 3.82 |
| `src/explain/rules/fire.ts` | worker + sim | 9.7 | 3.61 |
| `src/explain/rules/terrain.ts` | worker + sim | 10.5 | 3.27 |
| `node_modules/@capacitor/core/dist/index.js` | dist + worker | 7.7 | 2.97 |
| `src/terrain/solar.ts` | terrain + worker | 6.7 | 2.82 |

### Per chunk: groups, then the biggest modules

#### render-BcWIqPx6.js: raw 743.8 kB, gzip 200.8 kB

| Group | Raw kB | gzip kB | % of chunk gzip | Modules |
| --- | ---: | ---: | ---: | ---: |
| three | 542.5 | 132.7 | 66.1 % | 3 |
| src/render | 200.2 | 67.5 | 33.6 % | 28 |
| [bundler/glue] | 1.0 | 0.5 | 0.3 % | 1 |

| Module | Raw kB | gzip kB |
| --- | ---: | ---: |
| `node_modules/three/build/three.module.js` | 343.4 | 81.23 |
| `node_modules/three/build/three.core.js` | 179.7 | 47.48 |
| `src/render/SceneView.ts` | 25.7 | 8.01 |
| `src/render/terrainLayer.ts` | 25.3 | 7.77 |
| `src/render/placesLayer.ts` | 21.5 | 6.80 |
| `src/render/treeShaders.ts` | 17.0 | 6.14 |
| `src/render/treeModels.ts` | 12.5 | 4.57 |
| `node_modules/three/examples/jsm/controls/OrbitControls.js` | 19.4 | 4.01 |
| `src/render/vegetationPlacement.ts` | 10.4 | 3.76 |
| `src/render/treeTextures.ts` | 8.2 | 3.28 |
| `src/render/vegetationLayer.ts` | 9.4 | 3.11 |
| `src/render/cameraRig.ts` | 10.3 | 3.03 |

#### index-CAoD7JAE.js: raw 531.5 kB, gzip 185.4 kB

| Group | Raw kB | gzip kB | % of chunk gzip | Modules |
| --- | ---: | ---: | ---: | ---: |
| src/ui | 428.8 | 147.0 | 79.3 % | 64 |
| src/render | 75.6 | 27.0 | 14.5 % | 9 |
| src/scenario | 14.0 | 5.1 | 2.8 % | 2 |
| src/fire | 3.6 | 1.9 | 1.0 % | 2 |
| src/embers | 3.0 | 1.4 | 0.7 % | 1 |
| src/sim | 2.4 | 1.1 | 0.6 % | 1 |
| [bundler/glue] | 2.0 | 1.1 | 0.6 % | 1 |
| src (root) | 2.1 | 0.9 | 0.5 % | 1 |

| Module | Raw kB | gzip kB |
| --- | ---: | ---: |
| `src/ui/modelInfo.ts` | 40.2 | 13.90 |
| `src/ui/screens/datasetsModel.ts` | 30.5 | 10.58 |
| `src/ui/screens/datasets.ts` | 29.0 | 8.66 |
| `src/ui/screens/setup.ts` | 26.5 | 8.57 |
| `src/ui/screens/sim/simScreen.ts` | 20.7 | 7.22 |
| `src/render/layerCatalog.ts` | 22.6 | 6.87 |
| `src/ui/screens/sim/sheet.ts` | 18.4 | 6.42 |
| `src/render/legends.ts` | 17.1 | 6.07 |
| `src/ui/screens/sim/layersPanel.ts` | 18.2 | 6.01 |
| `src/ui/mapsLink.ts` | 15.6 | 5.77 |
| `src/ui/content.ts` | 13.7 | 5.15 |
| `src/ui/legends.ts` | 15.7 | 4.86 |

#### worker-D07vFJbS.js: raw 476.7 kB, gzip 168.7 kB

| Group | Raw kB | gzip kB | % of chunk gzip | Modules |
| --- | ---: | ---: | ---: | ---: |
| src/explain | 121.6 | 41.8 | 24.8 % | 16 |
| src/fire | 78.0 | 28.5 | 16.9 % | 24 |
| src/atmosphere | 77.0 | 27.6 | 16.3 % | 14 |
| src/fuel | 55.3 | 19.2 | 11.4 % | 19 |
| src/embers | 50.8 | 17.6 | 10.4 % | 7 |
| src/sim | 45.7 | 14.6 | 8.7 % | 7 |
| src/terrain | 13.5 | 5.5 | 3.3 % | 2 |
| src/data | 13.0 | 5.0 | 3.0 % | 7 |
| src/core | 8.2 | 3.6 | 2.1 % | 6 |
| @capacitor/core | 7.7 | 3.0 | 1.8 % | 1 |
| src/scenario | 5.4 | 2.1 | 1.3 % | 3 |
| fast-png | 0.2 | 0.1 | 0.1 % | 4 |
| iobuffer | 0.3 | 0.1 | 0.1 % | 2 |
| [bundler/glue] | 0.1 | 0.1 | 0.0 % | 1 |

| Module | Raw kB | gzip kB |
| --- | ---: | ---: |
| `src/embers/EmberModel.ts` | 36.6 | 12.26 |
| `src/fire/spread/FireSpreadModel.ts` | 32.3 | 10.86 |
| `src/sim/simulation.ts` | 35.6 | 10.77 |
| `src/explain/text.ts` | 31.1 | 10.01 |
| `src/atmosphere/atmosphere.ts` | 19.7 | 6.33 |
| `src/fuel/moisture/model.ts` | 14.8 | 5.75 |
| `src/atmosphere/base.ts` | 15.9 | 5.51 |
| `src/explain/rules/weather.ts` | 13.8 | 4.31 |
| `src/fire/terrainFeatures.ts` | 11.8 | 4.28 |
| `src/atmosphere/solver.ts` | 10.3 | 3.92 |
| `src/explain/explainCell.ts` | 9.9 | 3.83 |
| `src/explain/rules/fire.ts` | 9.8 | 3.63 |

#### sim--xMhWn_v.js: raw 389.2 kB, gzip 136.8 kB

| Group | Raw kB | gzip kB | % of chunk gzip | Modules |
| --- | ---: | ---: | ---: | ---: |
| src/explain | 120.8 | 41.7 | 30.5 % | 16 |
| src/fire | 73.9 | 27.3 | 19.9 % | 21 |
| src/atmosphere | 74.4 | 26.7 | 19.5 % | 13 |
| src/embers | 47.1 | 16.3 | 11.9 % | 6 |
| src/sim | 46.2 | 14.3 | 10.5 % | 5 |
| src/fuel | 25.8 | 9.9 | 7.3 % | 9 |
| [bundler/glue] | 1.0 | 0.5 | 0.4 % | 1 |

| Module | Raw kB | gzip kB |
| --- | ---: | ---: |
| `src/embers/EmberModel.ts` | 36.0 | 12.30 |
| `src/sim/simulation.ts` | 35.5 | 10.83 |
| `src/fire/spread/FireSpreadModel.ts` | 32.2 | 10.82 |
| `src/explain/text.ts` | 31.1 | 10.02 |
| `src/atmosphere/atmosphere.ts` | 19.6 | 6.28 |
| `src/fuel/moisture/model.ts` | 14.7 | 5.75 |
| `src/atmosphere/base.ts` | 15.8 | 5.56 |
| `src/fire/terrainFeatures.ts` | 11.8 | 4.69 |
| `src/explain/rules/weather.ts` | 13.7 | 4.29 |
| `src/atmosphere/solver.ts` | 10.3 | 3.92 |
| `src/explain/explainCell.ts` | 9.9 | 3.82 |
| `src/explain/rules/fire.ts` | 9.7 | 3.61 |

#### lerc-QP1TA3MH.js: raw 94.7 kB, gzip 36.6 kB

| Group | Raw kB | gzip kB | % of chunk gzip | Modules |
| --- | ---: | ---: | ---: | ---: |
| zstddec | 71.5 | 28.4 | 77.5 % | 1 |
| lerc | 22.5 | 7.8 | 21.2 % | 1 |
| geotiff | 0.5 | 0.4 | 1.0 % | 1 |
| [bundler/glue] | 0.2 | 0.1 | 0.4 % | 1 |

| Module | Raw kB | gzip kB |
| --- | ---: | ---: |
| `node_modules/zstddec/dist/zstddec.modern.js` | 71.5 | 28.38 |
| `node_modules/lerc/LercDecode.js` | 22.5 | 7.78 |
| `node_modules/geotiff/dist-module/compression/lerc.js` | 0.5 | 0.35 |
| `[unmapped]` | 0.2 | 0.13 |

#### data-Db-hA8NP.js: raw 99.7 kB, gzip 33.5 kB

| Group | Raw kB | gzip kB | % of chunk gzip | Modules |
| --- | ---: | ---: | ---: | ---: |
| src/data | 29.3 | 11.3 | 33.7 % | 5 |
| geotiff | 36.5 | 10.7 | 31.9 % | 14 |
| fast-png | 13.2 | 3.9 | 11.5 % | 11 |
| fflate | 4.9 | 2.3 | 6.9 % | 1 |
| iobuffer | 5.5 | 1.2 | 3.7 % | 2 |
| @petamoriken/float16 | 2.5 | 1.2 | 3.6 % | 4 |
| src/core | 2.3 | 1.0 | 3.0 % | 3 |
| quick-lru | 3.3 | 0.9 | 2.6 % | 1 |
| xml-utils | 1.6 | 0.6 | 1.9 % | 6 |
| [bundler/glue] | 0.6 | 0.4 | 1.2 % | 1 |

| Module | Raw kB | gzip kB |
| --- | ---: | ---: |
| `src/data/canopy.ts` | 10.6 | 4.12 |
| `node_modules/geotiff/dist-module/geotiffimage.js` | 10.8 | 3.33 |
| `src/data/terrainTiles.ts` | 7.1 | 2.58 |
| `node_modules/fflate/esm/browser.js` | 4.9 | 2.33 |
| `src/data/nswContextCore.ts` | 5.5 | 2.20 |
| `node_modules/fast-png/lib/png_decoder.js` | 8.7 | 2.17 |
| `src/data/nswContext.ts` | 4.0 | 1.65 |
| `node_modules/geotiff/dist-module/imagefiledirectory.js` | 5.5 | 1.53 |
| `node_modules/geotiff/dist-module/geotiff.js` | 4.5 | 1.27 |
| `node_modules/iobuffer/lib/iobuffer.js` | 5.3 | 1.20 |
| `node_modules/geotiff/dist-module/source/blockedsource.js` | 3.0 | 0.91 |
| `node_modules/quick-lru/index.js` | 3.3 | 0.86 |

#### estimate-BGrgvUwk.js: raw 103.0 kB, gzip 33.0 kB

| Group | Raw kB | gzip kB | % of chunk gzip | Modules |
| --- | ---: | ---: | ---: | ---: |
| src/scenario | 101.9 | 32.4 | 98.2 % | 8 |
| [bundler/glue] | 1.1 | 0.6 | 1.8 % | 1 |

| Module | Raw kB | gzip kB |
| --- | ---: | ---: |
| `src/scenario/datasetRecords.ts` | 25.3 | 8.51 |
| `src/scenario/datasetRecordsPlaces.ts` | 18.7 | 6.09 |
| `src/scenario/datasetRecordsWeather.ts` | 22.1 | 6.09 |
| `src/scenario/estimate.ts` | 20.1 | 5.74 |
| `src/scenario/build.ts` | 6.8 | 2.52 |
| `src/scenario/terrain.ts` | 4.2 | 2.00 |
| `src/scenario/datasetAssembly.ts` | 3.5 | 0.98 |
| `[unmapped]` | 1.1 | 0.59 |
| `src/scenario/imagery.ts` | 1.2 | 0.47 |

#### zstd-i4Jwubnx.js: raw 79.1 kB, gzip 31.5 kB

| Group | Raw kB | gzip kB | % of chunk gzip | Modules |
| --- | ---: | ---: | ---: | ---: |
| zstddec | 79.0 | 31.3 | 99.4 % | 1 |
| geotiff | 0.1 | 0.1 | 0.4 % | 1 |
| [bundler/glue] | 0.0 | 0.1 | 0.2 % | 1 |

| Module | Raw kB | gzip kB |
| --- | ---: | ---: |
| `node_modules/zstddec/dist/zstddec-stream.modern.js` | 79.0 | 31.32 |
| `node_modules/geotiff/dist-module/compression/zstd.js` | 0.1 | 0.11 |
| `[unmapped]` | 0.0 | 0.06 |

#### mocks-BF7hnoS_.js: raw 57.6 kB, gzip 21.9 kB

| Group | Raw kB | gzip kB | % of chunk gzip | Modules |
| --- | ---: | ---: | ---: | ---: |
| src/ui | 56.8 | 21.5 | 97.9 % | 5 |
| [bundler/glue] | 0.8 | 0.5 | 2.1 % | 1 |

| Module | Raw kB | gzip kB |
| --- | ---: | ---: |
| `src/ui/mockSim.ts` | 22.1 | 8.34 |
| `src/ui/mockScene.ts` | 16.7 | 5.79 |
| `src/ui/mockScenario.ts` | 7.7 | 2.95 |
| `src/ui/mockFire.ts` | 4.2 | 2.25 |
| `src/ui/mockDatasets.ts` | 6.1 | 2.16 |
| `[unmapped]` | 0.8 | 0.46 |

#### storage-DmfRc9Ip.js: raw 41.0 kB, gzip 15.3 kB

| Group | Raw kB | gzip kB | % of chunk gzip | Modules |
| --- | ---: | ---: | ---: | ---: |
| src/data | 27.7 | 10.6 | 69.2 % | 7 |
| src/core | 13.2 | 4.6 | 30.1 % | 1 |
| [bundler/glue] | 0.1 | 0.1 | 0.7 % | 1 |

| Module | Raw kB | gzip kB |
| --- | ---: | ---: |
| `src/core/datasets.ts` | 13.2 | 4.60 |
| `src/data/http.ts` | 8.9 | 3.38 |
| `src/data/storage.ts` | 5.2 | 1.97 |
| `src/data/cache.ts` | 5.5 | 1.92 |
| `src/data/ledger.ts` | 4.1 | 1.68 |

#### pako.esm-Ch1S5qKo.js: raw 45.5 kB, gzip 14.3 kB

| Group | Raw kB | gzip kB | % of chunk gzip | Modules |
| --- | ---: | ---: | ---: | ---: |
| pako | 45.5 | 14.3 | 99.9 % | 1 |

| Module | Raw kB | gzip kB |
| --- | ---: | ---: |
| `node_modules/pako/dist/pako.esm.mjs` | 45.5 | 14.28 |

#### weatherSources-HEvh1alG.js: raw 36.4 kB, gzip 12.9 kB

| Group | Raw kB | gzip kB | % of chunk gzip | Modules |
| --- | ---: | ---: | ---: | ---: |
| src/scenario | 34.7 | 12.0 | 92.7 % | 5 |
| src/data | 1.0 | 0.6 | 4.3 % | 1 |
| [bundler/glue] | 0.7 | 0.4 | 3.0 % | 1 |

| Module | Raw kB | gzip kB |
| --- | ---: | ---: |
| `src/scenario/weatherSources.ts` | 15.5 | 5.15 |
| `src/scenario/layers.ts` | 6.4 | 2.36 |
| `src/scenario/beltKit.ts` | 5.1 | 1.73 |
| `src/scenario/messages.ts` | 4.0 | 1.57 |
| `src/scenario/context.ts` | 3.7 | 1.14 |

#### datasetStats-DI78qXyW.js: raw 22.8 kB, gzip 9.7 kB

| Group | Raw kB | gzip kB | % of chunk gzip | Modules |
| --- | ---: | ---: | ---: | ---: |
| src/scenario | 20.1 | 8.3 | 85.0 % | 1 |
| src/data | 2.4 | 1.3 | 13.5 % | 1 |
| [bundler/glue] | 0.2 | 0.1 | 1.5 % | 1 |

| Module | Raw kB | gzip kB |
| --- | ---: | ---: |
| `src/scenario/datasetStats.ts` | 20.1 | 8.27 |
| `src/data/syntheticTerrain.ts` | 2.4 | 1.31 |
| `[unmapped]` | 0.2 | 0.15 |

#### mcarthur-C5X5px3Q.js: raw 24.4 kB, gzip 9.7 kB

| Group | Raw kB | gzip kB | % of chunk gzip | Modules |
| --- | ---: | ---: | ---: | ---: |
| src/fuel | 23.8 | 9.3 | 95.9 % | 7 |
| src/fire | 0.4 | 0.2 | 2.3 % | 1 |
| [bundler/glue] | 0.3 | 0.2 | 1.7 % | 1 |

| Module | Raw kB | gzip kB |
| --- | ---: | ---: |
| `src/fuel/fuelMap.ts` | 9.3 | 3.31 |
| `src/fuel/history.ts` | 4.7 | 1.97 |
| `src/fuel/svtm.ts` | 3.3 | 1.23 |
| `src/fuel/polygon.ts` | 2.1 | 1.02 |
| `src/fuel/accumulation.ts` | 2.2 | 0.81 |

#### terrain-BwRlvvif.js: raw 15.6 kB, gzip 6.8 kB

| Group | Raw kB | gzip kB | % of chunk gzip | Modules |
| --- | ---: | ---: | ---: | ---: |
| src/terrain | 13.5 | 5.9 | 87.3 % | 2 |
| src/core | 1.9 | 0.8 | 11.6 % | 1 |
| [bundler/glue] | 0.1 | 0.1 | 1.2 % | 1 |

| Module | Raw kB | gzip kB |
| --- | ---: | ---: |
| `src/terrain/solar.ts` | 6.7 | 3.01 |
| `src/terrain/analysis.ts` | 6.8 | 2.91 |
| `src/core/types.ts` | 1.9 | 0.79 |
| `[unmapped]` | 0.1 | 0.08 |

#### openMeteo-BeFUAsqG.js: raw 15.3 kB, gzip 6.3 kB

| Group | Raw kB | gzip kB | % of chunk gzip | Modules |
| --- | ---: | ---: | ---: | ---: |
| src/scenario | 13.2 | 5.2 | 83.2 % | 3 |
| src/core | 1.9 | 0.9 | 15.1 % | 1 |
| [bundler/glue] | 0.1 | 0.1 | 1.7 % | 1 |

| Module | Raw kB | gzip kB |
| --- | ---: | ---: |
| `src/scenario/openMeteo.ts` | 9.8 | 3.71 |
| `src/scenario/params.ts` | 2.0 | 0.99 |
| `src/core/physics.ts` | 1.9 | 0.95 |
| `src/scenario/time.ts` | 1.4 | 0.51 |
| `[unmapped]` | 0.1 | 0.11 |

#### catalogue-Dy7iKToi.js: raw 16.0 kB, gzip 4.9 kB

| Group | Raw kB | gzip kB | % of chunk gzip | Modules |
| --- | ---: | ---: | ---: | ---: |
| src/fuel | 13.1 | 3.3 | 68.0 % | 2 |
| src/atmosphere | 2.3 | 1.2 | 25.1 % | 1 |
| src/sim | 0.6 | 0.3 | 5.9 % | 1 |
| [bundler/glue] | 0.0 | 0.1 | 1.1 % | 1 |

| Module | Raw kB | gzip kB |
| --- | ---: | ---: |
| `src/fuel/catalogue.ts` | 12.1 | 2.81 |
| `src/atmosphere/params.ts` | 2.3 | 1.22 |
| `src/fuel/hazard.ts` | 1.0 | 0.49 |
| `src/sim/params.ts` | 0.6 | 0.28 |
| `[unmapped]` | 0.0 | 0.05 |

#### scenario-CyVR7pfA.js: raw 10.0 kB, gzip 4.6 kB

| Group | Raw kB | gzip kB | % of chunk gzip | Modules |
| --- | ---: | ---: | ---: | ---: |
| src/scenario | 8.6 | 3.9 | 85.2 % | 1 |
| [bundler/glue] | 1.4 | 0.7 | 14.8 % | 1 |

| Module | Raw kB | gzip kB |
| --- | ---: | ---: |
| `src/scenario/feeds.ts` | 8.6 | 3.95 |
| `[unmapped]` | 1.4 | 0.68 |

#### jpeg-Di1AymDI.js: raw 10.6 kB, gzip 3.9 kB

| Group | Raw kB | gzip kB | % of chunk gzip | Modules |
| --- | ---: | ---: | ---: | ---: |
| geotiff | 10.5 | 3.9 | 98.6 % | 1 |
| [bundler/glue] | 0.0 | 0.1 | 1.4 % | 1 |

| Module | Raw kB | gzip kB |
| --- | ---: | ---: |
| `node_modules/geotiff/dist-module/compression/jpeg.js` | 10.5 | 3.88 |
| `[unmapped]` | 0.0 | 0.06 |

#### replays-C-GuXc9P.js: raw 8.0 kB, gzip 3.6 kB

| Group | Raw kB | gzip kB | % of chunk gzip | Modules |
| --- | ---: | ---: | ---: | ---: |
| src/scenario | 7.8 | 3.5 | 96.4 % | 2 |
| [bundler/glue] | 0.2 | 0.1 | 3.6 % | 1 |

| Module | Raw kB | gzip kB |
| --- | ---: | ---: |
| `src/scenario/presets.ts` | 4.7 | 2.20 |
| `src/scenario/replays.ts` | 3.1 | 1.31 |
| `[unmapped]` | 0.2 | 0.13 |

#### weather-BCtPTOFV.js: raw 7.1 kB, gzip 3.1 kB

| Group | Raw kB | gzip kB | % of chunk gzip | Modules |
| --- | ---: | ---: | ---: | ---: |
| src/fuel | 3.1 | 1.6 | 50.4 % | 3 |
| src/scenario | 3.9 | 1.5 | 46.9 % | 1 |
| [bundler/glue] | 0.1 | 0.1 | 2.7 % | 1 |

| Module | Raw kB | gzip kB |
| --- | ---: | ---: |
| `src/scenario/weather.ts` | 3.9 | 1.47 |
| `src/fuel/moisture/drought.ts` | 1.9 | 0.94 |
| `src/fuel/moisture/params.ts` | 0.9 | 0.50 |
| `src/fuel/moisture/air.ts` | 0.4 | 0.14 |
| `[unmapped]` | 0.1 | 0.09 |

#### dist-C5Vgn5nD.js: raw 7.6 kB, gzip 3.0 kB

| Group | Raw kB | gzip kB | % of chunk gzip | Modules |
| --- | ---: | ---: | ---: | ---: |
| @capacitor/core | 7.6 | 3.0 | 99.4 % | 1 |

| Module | Raw kB | gzip kB |
| --- | ---: | ---: |
| `node_modules/@capacitor/core/dist/index.js` | 7.6 | 3.00 |

#### globals-CCptAvKb.js: raw 7.4 kB, gzip 2.7 kB

| Group | Raw kB | gzip kB | % of chunk gzip | Modules |
| --- | ---: | ---: | ---: | ---: |
| geotiff | 6.8 | 2.3 | 85.3 % | 1 |
| [bundler/glue] | 0.7 | 0.4 | 14.7 % | 1 |

| Module | Raw kB | gzip kB |
| --- | ---: | ---: |
| `node_modules/geotiff/dist-module/globals.js` | 6.8 | 2.33 |
| `[unmapped]` | 0.7 | 0.40 |

#### areaPack-BRTBKc0x.js: raw 3.2 kB, gzip 1.5 kB

| Group | Raw kB | gzip kB | % of chunk gzip | Modules |
| --- | ---: | ---: | ---: | ---: |
| src/scenario | 3.0 | 1.3 | 88.7 % | 1 |
| [bundler/glue] | 0.3 | 0.2 | 11.3 % | 1 |

| Module | Raw kB | gzip kB |
| --- | ---: | ---: |
| `src/scenario/areaPack.ts` | 3.0 | 1.31 |
| `[unmapped]` | 0.3 | 0.17 |

#### web-i9eqyzQd.js: raw 2.0 kB, gzip 0.8 kB

| Group | Raw kB | gzip kB | % of chunk gzip | Modules |
| --- | ---: | ---: | ---: | ---: |
| @capacitor/geolocation | 2.0 | 0.8 | 94.2 % | 1 |
| [bundler/glue] | 0.0 | 0.0 | 5.8 % | 1 |

| Module | Raw kB | gzip kB |
| --- | ---: | ---: |
| `node_modules/@capacitor/geolocation/dist/esm/web.js` | 2.0 | 0.78 |
| `[unmapped]` | 0.0 | 0.05 |

#### lzw-D2FslT4L.js: raw 1.4 kB, gzip 0.8 kB

| Group | Raw kB | gzip kB | % of chunk gzip | Modules |
| --- | ---: | ---: | ---: | ---: |
| geotiff | 1.4 | 0.8 | 93.3 % | 1 |
| [bundler/glue] | 0.0 | 0.1 | 6.7 % | 1 |

| Module | Raw kB | gzip kB |
| --- | ---: | ---: |
| `node_modules/geotiff/dist-module/compression/lzw.js` | 1.4 | 0.75 |
| `[unmapped]` | 0.0 | 0.05 |

#### basedecoder-BuG7fe0q.js: raw 1.3 kB, gzip 0.7 kB

| Group | Raw kB | gzip kB | % of chunk gzip | Modules |
| --- | ---: | ---: | ---: | ---: |
| geotiff | 1.3 | 0.7 | 97.4 % | 2 |

| Module | Raw kB | gzip kB |
| --- | ---: | ---: |
| `node_modules/geotiff/dist-module/predictor.js` | 0.9 | 0.48 |
| `node_modules/geotiff/dist-module/compression/basedecoder.js` | 0.3 | 0.19 |

#### preload-helper-uBIymjUX.js: raw 1.2 kB, gzip 0.7 kB

| Group | Raw kB | gzip kB | % of chunk gzip | Modules |
| --- | ---: | ---: | ---: | ---: |
| [bundler/glue] | 1.2 | 0.7 | 100.0 % | 1 |

| Module | Raw kB | gzip kB |
| --- | ---: | ---: |
| `[unmapped]` | 1.2 | 0.67 |

#### web-C0xWYv7t.js: raw 1.2 kB, gzip 0.5 kB

| Group | Raw kB | gzip kB | % of chunk gzip | Modules |
| --- | ---: | ---: | ---: | ---: |
| @capacitor/preferences | 1.1 | 0.5 | 90.8 % | 1 |
| [bundler/glue] | 0.0 | 0.0 | 9.2 % | 1 |

| Module | Raw kB | gzip kB |
| --- | ---: | ---: |
| `node_modules/@capacitor/preferences/dist/esm/web.js` | 1.1 | 0.48 |
| `[unmapped]` | 0.0 | 0.05 |

#### webimage-zQMH-_zR.js: raw 0.9 kB, gzip 0.5 kB

| Group | Raw kB | gzip kB | % of chunk gzip | Modules |
| --- | ---: | ---: | ---: | ---: |
| geotiff | 0.9 | 0.5 | 89.7 % | 1 |
| [bundler/glue] | 0.0 | 0.1 | 10.3 % | 1 |

| Module | Raw kB | gzip kB |
| --- | ---: | ---: |
| `node_modules/geotiff/dist-module/compression/webimage.js` | 0.9 | 0.46 |
| `[unmapped]` | 0.0 | 0.05 |

#### esm-B0sbNcPP.js: raw 1.0 kB, gzip 0.5 kB

| Group | Raw kB | gzip kB | % of chunk gzip | Modules |
| --- | ---: | ---: | ---: | ---: |
| @capacitor/synapse | 0.6 | 0.3 | 54.4 % | 1 |
| [bundler/glue] | 0.2 | 0.1 | 28.8 % | 1 |
| @capacitor/geolocation | 0.2 | 0.1 | 16.9 % | 1 |

| Module | Raw kB | gzip kB |
| --- | ---: | ---: |
| `node_modules/@capacitor/synapse/dist/synapse.mjs` | 0.6 | 0.27 |
| `[unmapped]` | 0.2 | 0.14 |
| `node_modules/@capacitor/geolocation/dist/esm/index.js` | 0.2 | 0.08 |

#### hillshade-DiSI-VO3.js: raw 0.7 kB, gzip 0.4 kB

| Group | Raw kB | gzip kB | % of chunk gzip | Modules |
| --- | ---: | ---: | ---: | ---: |
| src/terrain | 0.6 | 0.4 | 88.1 % | 1 |
| [bundler/glue] | 0.0 | 0.1 | 11.9 % | 1 |

| Module | Raw kB | gzip kB |
| --- | ---: | ---: |
| `src/terrain/hillshade.ts` | 0.6 | 0.38 |
| `[unmapped]` | 0.0 | 0.05 |

#### rng-BnwdYkrg.js: raw 0.7 kB, gzip 0.4 kB

| Group | Raw kB | gzip kB | % of chunk gzip | Modules |
| --- | ---: | ---: | ---: | ---: |
| src/core | 0.7 | 0.3 | 94.9 % | 1 |

| Module | Raw kB | gzip kB |
| --- | ---: | ---: |
| `src/core/rng.ts` | 0.7 | 0.34 |

#### esm-C6kMOuIF.js: raw 0.4 kB, gzip 0.2 kB

| Group | Raw kB | gzip kB | % of chunk gzip | Modules |
| --- | ---: | ---: | ---: | ---: |
| [bundler/glue] | 0.2 | 0.2 | 62.4 % | 1 |
| @capacitor/preferences | 0.2 | 0.1 | 37.6 % | 1 |

| Module | Raw kB | gzip kB |
| --- | ---: | ---: |
| `[unmapped]` | 0.2 | 0.16 |
| `node_modules/@capacitor/preferences/dist/esm/index.js` | 0.2 | 0.09 |

#### packbits-DCimUQ1T.js: raw 0.3 kB, gzip 0.2 kB

| Group | Raw kB | gzip kB | % of chunk gzip | Modules |
| --- | ---: | ---: | ---: | ---: |
| geotiff | 0.3 | 0.2 | 77.5 % | 1 |
| [bundler/glue] | 0.0 | 0.1 | 22.5 % | 1 |

| Module | Raw kB | gzip kB |
| --- | ---: | ---: |
| `node_modules/geotiff/dist-module/compression/packbits.js` | 0.3 | 0.19 |
| `[unmapped]` | 0.0 | 0.06 |

#### deflate-DrpJyiUj.js: raw 0.2 kB, gzip 0.2 kB

| Group | Raw kB | gzip kB | % of chunk gzip | Modules |
| --- | ---: | ---: | ---: | ---: |
| [bundler/glue] | 0.1 | 0.1 | 52.1 % | 1 |
| geotiff | 0.1 | 0.1 | 47.9 % | 1 |

| Module | Raw kB | gzip kB |
| --- | ---: | ---: |
| `[unmapped]` | 0.1 | 0.08 |
| `node_modules/geotiff/dist-module/compression/deflate.js` | 0.1 | 0.08 |

#### raw-A-vJRPpa.js: raw 0.1 kB, gzip 0.1 kB

| Group | Raw kB | gzip kB | % of chunk gzip | Modules |
| --- | ---: | ---: | ---: | ---: |
| [bundler/glue] | 0.0 | 0.1 | 52.7 % | 1 |
| geotiff | 0.1 | 0.1 | 47.3 % | 1 |

| Module | Raw kB | gzip kB |
| --- | ---: | ---: |
| `[unmapped]` | 0.0 | 0.06 |
| `node_modules/geotiff/dist-module/compression/raw.js` | 0.1 | 0.06 |
