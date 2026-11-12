# ts-export: TypeScript fixture exporter (stage 3a)

Runs the app's own solver on named scenarios and writes what a C# reader needs: the start message, every snapshot, the hashes, the final
arrival raster. It reads the app's code (`src/sim`, `src/scenario`, `src/core`) and never edits it. Fixtures are not committed; the exporter is.

## Commands (from the repository root; `node_modules` must exist: `npm ci`, or a link)

```
FIX=<scratchpad>/dotnet-fixtures          # any folder; git ignores prototypes/dotnet-b/fixtures only
flock /tmp/firesim-heavy.lock node prototypes/dotnet-b/ts-export/run.mjs export all --out $FIX           # every scenario below, one process each
flock /tmp/firesim-heavy.lock node prototypes/dotnet-b/ts-export/run.mjs export katoomba3-fast --out $FIX [--seed 12] [--to 900] [--dir name]
node prototypes/dotnet-b/ts-export/run.mjs determinism --out $FIX    # katoomba3-fast twice, separate processes, hashes compared (exit 1 if any differs)
node prototypes/dotnet-b/ts-export/run.mjs verify --out $FIX         # decode every file with the app's codec; check hashes.json and arrival.f32
node prototypes/dotnet-b/ts-export/run.mjs study --out $FIX --json study.json   # tier and seed difference study (markdown to stdout)
node prototypes/dotnet-b/ts-export/results.mjs --out $FIX --study study.json --to prototypes/dotnet-b/reports/3a-results.json
node prototypes/dotnet-b/ts-export/inspect.mjs $FIX/katoomba3-fast/snap-60.bin   # field list of a frame (paths, scalar values, typed arrays)
```

How it runs: the solver is TypeScript with extension-less imports that Node cannot load, so `run.mjs` builds `export.ts` and `verify.ts` with the
repository's own bundler (Vite, SSR build, as `desktop/build.mjs` does) into `prototypes/dotnet-b/fixtures/.build-ts-export` and starts them
with Node. The bundle does not sit beside `src/`, so `export.ts` points the app's asset loader at `<repo>/public` (`setNodePublicDir`); without
that the builder silently falls back to synthetic terrain (it did, in the first try; the regression anchor below caught it).

The `study.mjs` seed groups expect these extra fixtures (all produced by `export`): `katoomba3-{fast}-seed{12..16}`, `katoomba3-{standard,high30}-seed{12..14}`,
`katoomba3-high-seed12`, `katoomba3-{fast,standard,high30}-noembers[-seed12|13]`, `katoomba3-high-noembers`, and `determinism-a` / `determinism-b` (from `determinism`).

## Scenarios (`scenarios.ts`)

| name | what | fire grid | air grid (cell, levels) | embers cap | to |
|---|---|---|---|---|---|
| `katoomba3-fast` | Katoomba demo, 3 km, fast tier, seed 11, 310 m line (-570,-450) to (-350,-230) at t=0, civil start 2025-12-20 12:00, duration 3600 | 100x100 @ 30 m | 100 m, 20 | 2000 | 1800 s |
| `katoomba6-fast` | same at 6 km | 200x200 @ 30 m | 133 m, 20 | 2000 | 1800 s |
| `katoomba3-standard` | same as the first, standard tier (3-D air, 900 s spin-up) | 100x100 @ 30 m | 100 m, 20 | 4000 | 1800 s |
| `katoomba3-high` | same, high tier as the builder makes it | 150x150 @ **20 m** | 100 m, 24 | 4000 | 1800 s |
| `katoomba3-high30` | extra: high tier engine options on the 30 m grid (isolates the air model from the grid change) | 100x100 @ 30 m | 100 m, 24 | 4000 | 1800 s |
| `katoomba3-point` | point ignition (-800,300) radius 60, as `src/sim/desktopDetail.determinism.test.ts`, civil start 14:00, fast, seed 11 | 100x100 @ 30 m | 100 m, 20 | 2000 | 900 s |
| `anchor-080-katoomba6-point` | extra, regression anchor: the 0.8.0 test scenario (6 km, point (-2170,900)); its 15 hashes equal the published 0.8.0 ones | 200x200 @ 30 m | 133 m, 20 | 2000 | 900 s |
| `*-noembers` | extra: the same with the option `embers=false` | | | | 1800 s |

`high` was not capped: it runs in about 8 s here. Civil start is Australia/Sydney (AEDT, UTC+11): 12:00 is `startTimeUtcMs` 1766192400000.

## Fixture folder: `<FIX>/<name>/`

All integers and floats are little endian. Floats are IEEE 754.

### `init.bin` and `snap-<t>.bin`: codec frames

Both are one frame of `src/sim/remote/codec.ts`, the same bytes the desktop host sends and receives.
`init.bin` = `encodeMessage({ type: 'init', scenario: withoutContext(scenario) })` (what `SimClient.send` posts). `snap-<t>.bin` =
`encodeMessage({ type: 'snapshot', snapshot })`, the message the host posts for each snapshot.

```
offset 0      u32   H, the length of the header in bytes
offset 4      H     the header: UTF-8 JSON of the message (no BOM)
offset 4+H    0..7  zero bytes, so that the body starts at B = ceil((4 + H) / 8) * 8
offset B      the body: the bytes of the typed arrays, back to back, each starting at a multiple of 8 from B, zero padded between
```

In the header JSON every typed array is replaced by `{"$ta":"<kind>","o":<offset>,"n":<count>}`: `n` elements of kind `<kind>`, found at byte
`B + o` of the file (`o` is a multiple of 8 and counts from B, not from the start of the file), `n * size` bytes long. Kinds and element sizes:
`f32` 4, `f64` 8, `i8` 1, `u8` 1, `u8c` 1, `i16` 2, `u16` 2, `i32` 4, `u32` 4, `i64` 8, `u64` 8. Arrays never overlap. A number JSON cannot carry
is `{"$num":"NaN"}`, `{"$num":"Infinity"}`, `{"$num":"-Infinity"}` or `{"$num":"-0"}`. An object field that was `undefined` is absent. Every other
JSON value is as it was. File lengths: `init.bin` = B + body; the body of `katoomba3-fast` is 1,660,440 bytes at B = 115,992.

`node inspect.mjs FILE` prints every field path with its value or typed array (kind, count, offset). Fields of the two messages, as of this commit
(sizes for `katoomba3-fast`, N = nx*ny = 10,000 fire cells; the field list is that of `ScenarioData` / `SimSnapshot` in `src/core/types.ts`):

`init`: `scenario` = `{ id, name, origin{lat,lon}, extent, terrain, fuel, weather, startTime, duration, ignitions[], edits[], options, terrainHiRes, fuelHistory, activeFires[], datasets[], datasetSummary }`
(`context`, the display layers, is stripped).
- `terrain`: `grid{nx,ny,cellSize,x0,y0,origin}` (cell (i,j) has its centre at x0+i*cellSize, y0+j*cellSize; index k = j*nx + i; y north), `elevation f32[N]`, `slopeDeg f32`, `aspectDeg f32`, `dzdx f32`, `dzdy f32`, `tpi f32`, `curvature f32`, `landform u8`, `minElevation`, `maxElevation`, `source`, `slopeP90Deg f32`, `cliffFraction f32`.
- `fuel`: `grid`, `type u8` (FuelType), `surfaceHazard f32`, `nearSurfaceHazard f32`, `nearSurfaceHeight f32`, `elevatedHazard f32`, `elevatedHeight f32`, `barkHazard f32`, `surfaceLoad f32`, `nearSurfaceLoad f32`, `elevatedLoad f32`, `barkLoad f32`, `canopyHeight f32`, `canopyCover f32`, `curing f32`, `timeSinceFire f32`, `lastFireKind u8`, `sources[]`, `fuelClass u8`, `wrf f32`, `canopyLoad f32`, `canopyHeightEff f32`, `flags u16`, `moistureOffset f32`, `fireCount30 u8`, `fireCountTfi u8`, `breakWidth f32`, `faBlendW f32`, `cellContext u8`, `buildContext{t0,droughtFactor,kbdi,month}`; every array has N elements.
- `weather`: `kind:"preset"`, `hours[82]` of `{time(ms UTC), temperature, relativeHumidity, dewPoint, windSpeed10, windDir10, windGust10, cloudCover, precipitation, pressureLevels[3]{hPa,height,temperature,relativeHumidity,dewPoint,windSpeed,windDir}}`, `droughtFactor`, `kbdi`, `rainLast20[20]`, `sourceElevation`, `timezone`, `location`, ... .
- `options`: `{seed, fireCellSize, atmosCellSize, atmosLevels, atmosTop, atmosDz1, tier, coupling, embers, maxEmbers, mountainPhenomena, snapshotInterval, maxStepS}`.
- `terrainHiRes`: `grid` (300x300 @ 10 m) and `elevation f32[90000]`. `fuelHistory`: `recStart u32[N+1]`, `recIndex u32[...]`, `tb f64[...]`, `kind u8[...]`.
- `datasets[]` and `datasetSummary` are provenance text for the UI. `datasetSummary.builtAt` and `buildDurationMs` are wall-clock values: **`init.bin` is not byte-identical between two exports of the same scenario** (the solver's inputs are; the hashes show it).

`snapshot`: `snapshot` = `{ time, fire, moisture, atmosphere?, embers, spotFires[], stats, insights[], layers?, fireWind?, engine? }`.
- `fire`: `grid` and, each `[N]`, `arrivalTime f32` (seconds from scenario start; **+Infinity if not burnt**, as the IEEE bytes 00 00 80 7F), `burnState u8`, `ros f32` (m/s), `intensity f32` (kW/m), `flameHeight f32` (m), `spreadDir f32` (degrees), `driver u8`, `phase u8`.
- `moisture f32[N]` (dead fuel moisture, percent, e.g. 4.5). `embers`: `count`, `data f32[4*count]` (x, y, z m ASL, temperature fraction). `spotFires[]`: `{id,x,y,time,distance,travel,...}`.
- `atmosphere` (grid 30x30 @ 100 m in the 3 km case, `nz` 20): `grid`, `nz`, `levels f32[nz]`, `terrainHeight f32[nx*ny]`, `layout`, `kind` ("diagnosed" fast tier, "prognostic" 3-D tiers), `topM`, `baseM`, `surfaceU/surfaceV f32[nx*ny]`, `u,v,w f32[nx*ny*nz]`, `thetaAnomaly`, `smoke` (`f32[nx*ny*nz]` on the 3-D tiers, empty on the fast tier), `time`.
- `stats`: `{time, burntAreaHa, burningCells, perimeterKm, maxRos, maxIntensity, headDir, headRos, activeEmbers, spotFires, embersLeftDomain, convectiveNumber, weather{...}, deadFuelMoistureMean, ffdi, fireDangerRating, msPerSimMinute}` (`msPerSimMinute` is wall time, and is left out of the hash).
- `layers`: `vls, attach, trench, landing` (`f32[N]`). `fireWind`: `grid` (50x50 @ 60 m), `u, v i16[nx*ny]`, `block`, `time`. `engine`: the transparency-card record (tier, grids, step times, memory): measured on the machine, **not** simulation state, and left out of the hash.
- `snap-0.bin` is the picture the host posts at init (before the 3-D spin-up); `snap-60.bin` ... are the cadence snapshots, 60 s apart, every one a copy of the state at exactly that time.

### `hashes.json`

`{"0": <u32>, "60": <u32>, ..., "1800": <u32>}`: `snapshotHash(snapshot)` (`src/sim/testing/hash.ts`) of each snapshot, as a decimal number, keyed by simulated seconds. The hash is
FNV-1a, 32 bit (offset 0x811C9DC5, prime 16777619, state kept as u32), over a depth-first walk of the snapshot where
a typed array contributes its raw bytes; any other leaf (number, string, boolean, null) contributes the UTF-8 bytes of `"<path>=<value>;"` with `<value>` = `String(number)` (`-0` for negative zero) or the JSON text of a string / boolean / null; an array visits element i with path `<path>[i]`;
an object visits its keys sorted by UTF-16 code unit with path `<path>.<key>` (just `<key>` at the top). Skipped: the paths `stats.msPerSimMinute` and `engine`.
`verify` shows that decoding `snap-<t>.bin` with the TypeScript codec and hashing gives exactly these numbers. C# is **not** expected to reproduce these hashes
for its own results (V8 and .NET differ in the last bit of exp, pow and sin); they exist to prove a C# decoder reads the file right (e.g. by hashing the
decoded arrays) and as the TypeScript's own determinism record.

### `arrival.f32`

The final arrival raster (the last snapshot's `fire.arrivalTime`): `nx*ny` float32, row-major, index = j*nx + i (i east, j north, as in `FireField`), seconds from scenario start,
**-1 for a cell not burnt** (the snapshots carry +Infinity). The grid is `meta.fireGrid`. Size = 4*nx*ny bytes (40,000 for 100x100).

### `ignitions.json`

The `scenario.ignitions` array as given to the solver: `[{ "id", "kind":"line"|"point", "points":[[x,y],...] (local metres east/north of the origin), "time": 0, "radius"?: m (points), "origin":"observed" }]`.

### `meta.json`

`fixture`, `scenario`, `description`, `exportedAt` (ISO), `gitCommit` (the repository HEAD at export), `node`, `machine{cpu,cores,os}`, `seed`, `tier`, `tierRunning` (what `Simulation.tier` reports), `gridMode` ("builder" or "tier-only"),
`extentM`, `startCivil`, `startTimeUtcMs`, `durationS`, `runToS`, `snapshotIntervalS`, `snapshotTimesS[]`, `fireGrid{nx,ny,cellSize,x0,y0,origin}`, `terrainGridMatchesFireGrid`, `options` (the full `SimOptions` of the run),
`ignitions`, `arrival{file,encoding,cells,burntCells,burntAreaM2,atTimeS}`, `sizesBytes{initBin,snapshot60,snapshots{t:bytes}}`,
`timingMs{scenarioBuild,simConstruct,spinUp,advance,spinUpPlusAdvance,snapshotEncodeAndWrite,processTotal,note}` (wall clock, one shared container: indicative), and, for the anchor, `expectedHashCheck{expected,actual,equal}`.

## How the run is driven

`new Simulation(scenario, { minSnapshotWallMs: 0, hooks: { snapshot } })`, then `snapshot()` once (what `SimHost.init` posts), `spinUp()`, `advance(runTo)`, `emitRunEnd()`:
exactly the calls `src/sim/desktopDetail.determinism.test.ts` makes (plus the t0 snapshot), with no wall-clock coalescing, so every cadence snapshot is delivered.
`anchor-080-katoomba6-point` proves it: its 15 hashes are those the 0.8.0 tree gave.
