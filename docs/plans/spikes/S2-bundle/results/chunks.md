kB = 1024 bytes, as in scripts/check-bundle.mjs. gzip -9 is zlib level 9 per file; brotli 11 is information only.

| Chunk | Raw kB | gzip -9 kB | brotli 11 kB | Loaded | Trigger (source file:line of the import) |
| --- | ---: | ---: | ---: | --- | --- |
| render-BcWIqPx6.js | 743.8 | 200.8 | 165.8 | boot (requested at start-up) | src/ui/modules.ts:51 |
| index-CAoD7JAE.js | 531.5 | 185.4 | 150.7 | entry | index.html `<script type=module>` |
| worker-D07vFJbS.js | 476.7 | 168.7 | 143.8 | worker | new Worker(new URL(...)) in src/sim/client.ts, made when the sim screen opens |
| sim--xMhWn_v.js | 389.2 | 136.8 | 118.3 | boot (requested at start-up) | src/ui/modules.ts:50 |
| lerc-QP1TA3MH.js | 94.7 | 36.6 | 30.7 | lazy | node_modules/geotiff/dist-module/compression/index.js:128 |
| data-Db-hA8NP.js | 99.7 | 33.5 | 29.9 | static (entry graph) | static import of areaPack, datasetStats, estimate and 12 more |
| estimate-BGrgvUwk.js | 103.0 | 33.0 | 28.5 | static (of a boot chunk) | src/ui/screens/datasets.ts:1100; src/ui/screens/setup.ts:853; static import of scenario |
| zstd-i4Jwubnx.js | 79.1 | 31.5 | 26.3 | lazy | node_modules/geotiff/dist-module/compression/index.js:147 |
| mocks-BF7hnoS_.js | 57.6 | 21.9 | 19.6 | boot (requested at start-up) | src/ui/modules.ts:79 |
| storage-DmfRc9Ip.js | 41.0 | 15.3 | 13.8 | static (entry graph) | static import of areaPack, data, datasetStats and 9 more |
| pako.esm-Ch1S5qKo.js | 45.5 | 14.3 | 12.9 | lazy | static import of deflate, lerc |
| weatherSources-HEvh1alG.js | 36.4 | 12.9 | 11.7 | static (of a boot chunk) | static import of areaPack, estimate, scenario |
| datasetStats-DI78qXyW.js | 22.8 | 9.7 | 8.7 | static (of a boot chunk) | static import of estimate, mocks |
| mcarthur-C5X5px3Q.js | 24.4 | 9.7 | 9.0 | static (of a boot chunk) | static import of datasetStats, estimate, sim |
| terrain-BwRlvvif.js | 15.6 | 6.8 | 6.1 | static (entry graph) | static import of catalogue, datasetStats, estimate and 7 more |
| openMeteo-BeFUAsqG.js | 15.3 | 6.3 | 5.7 | static (entry graph) | static import of areaPack, estimate, index and 6 more |
| catalogue-Dy7iKToi.js | 16.0 | 4.9 | 4.3 | static (entry graph) | static import of datasetStats, estimate, index and 2 more |
| scenario-CyVR7pfA.js | 10.0 | 4.6 | 4.1 | boot (requested at start-up) | src/ui/modules.ts:52 |
| jpeg-Di1AymDI.js | 10.6 | 3.9 | 3.5 | lazy | node_modules/geotiff/dist-module/compression/index.js:104 |
| replays-C-GuXc9P.js | 8.0 | 3.6 | 3.3 | static (entry graph) | static import of estimate, index, scenario and 1 more |
| weather-BCtPTOFV.js | 7.1 | 3.1 | 2.9 | static (of a boot chunk) | static import of scenario, sim, weatherSources |
| dist-C5Vgn5nD.js | 7.6 | 3.0 | 2.7 | static (entry graph) | static import of esm, esm, index and 3 more |
| globals-CCptAvKb.js | 7.4 | 2.7 | 2.3 | static (entry graph) | static import of data, index, lerc and 1 more |
| areaPack-BRTBKc0x.js | 3.2 | 1.5 | 1.3 | static (of a boot chunk) | src/ui/screens/setup.ts:922; static import of scenario |
| web-i9eqyzQd.js | 2.0 | 0.8 | 0.7 | lazy | node_modules/@capacitor/geolocation/dist/esm/index.js:4 |
| lzw-D2FslT4L.js | 1.4 | 0.8 | 0.7 | lazy | node_modules/geotiff/dist-module/compression/index.js:92 |
| basedecoder-BuG7fe0q.js | 1.3 | 0.7 | 0.6 | lazy | static import of deflate, jpeg, lerc and 5 more |
| preload-helper-uBIymjUX.js | 1.2 | 0.7 | 0.6 | static (entry graph) | static import of data, esm, esm and 2 more |
| web-C0xWYv7t.js | 1.2 | 0.5 | 0.4 | lazy | node_modules/@capacitor/preferences/dist/esm/index.js:3 |
| webimage-zQMH-_zR.js | 0.9 | 0.5 | 0.4 | lazy | node_modules/geotiff/dist-module/compression/index.js:157 |
| esm-B0sbNcPP.js | 1.0 | 0.5 | 0.5 | lazy | src/ui/location.ts:36 |
| hillshade-DiSI-VO3.js | 0.7 | 0.4 | 0.4 | static (of a boot chunk) | static import of mocks, render |
| rng-BnwdYkrg.js | 0.7 | 0.4 | 0.3 | static (of a boot chunk) | static import of mocks, sim |
| esm-C6kMOuIF.js | 0.4 | 0.2 | 0.2 | native boot | src/ui/prefs.ts:29 |
| packbits-DCimUQ1T.js | 0.3 | 0.2 | 0.2 | lazy | node_modules/geotiff/dist-module/compression/index.js:123 |
| deflate-DrpJyiUj.js | 0.2 | 0.2 | 0.1 | lazy | node_modules/geotiff/dist-module/compression/index.js:118 |
| raw-A-vJRPpa.js | 0.1 | 0.1 | 0.1 | lazy | node_modules/geotiff/dist-module/compression/index.js:86 |
| **All JS (37 files)** | **2857.4** | **956.7** | **811.3** |  |  |

### When the bytes are parsed

| Phase | Files | Raw kB | gzip -9 kB | brotli 11 kB |
| --- | ---: | ---: | ---: | ---: |
| 1. Before the first screen: the entry and its static imports (modulepreload in index.html) | 10 | 743.3 | 262.1 | 219.4 |
| 2. Requested at once by `loadServices()` (sim, render, scenario, mocks) with their static imports: also at start-up, on the main thread | 12 | 1398.8 | 434.9 | 370.6 |
| 3. The simulation worker (parsed in the worker thread when the sim screen opens) | 1 | 476.7 | 168.7 | 143.8 |
| 4. On demand (GeoTIFF decoders, geolocation, native preferences) | 14 | 238.6 | 91.0 | 77.4 |

Main-thread JavaScript parsed at start-up (phases 1 and 2): raw 2142.1 kB of 2857.4 kB (75.0 %). Phase 4 members: basedecoder-BuG7fe0q.js, deflate-DrpJyiUj.js, esm-B0sbNcPP.js, esm-C6kMOuIF.js, jpeg-Di1AymDI.js, lerc-QP1TA3MH.js, lzw-D2FslT4L.js, packbits-DCimUQ1T.js, pako.esm-Ch1S5qKo.js, raw-A-vJRPpa.js, web-C0xWYv7t.js, web-i9eqyzQd.js, webimage-zQMH-_zR.js, zstd-i4Jwubnx.js.
