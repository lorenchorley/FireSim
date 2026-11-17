# 3-slice-map: the smallest port that runs the two gate tiers (card T3.3)

Stage 3, builder T3.3, option B prototype. Analysis only: nothing was built or run except the analysis scripts below and `node`'s own file reads. `src/` was not edited.
Companion files: `reports/3-slice-sites.md` (every site, file:line, generated), `reports/3-slice-map/` (scripts and `areas.json`).

**Conditions.** Repository commit `0cc17cc` (the session branch after the merge of T1.3), TypeScript 5.9.3 (`node_modules/typescript` of the main checkout, read only), Node v22.22.0, the shared container (4 cores; each script runs in about 6 s, no heavy lock needed). "Lines" are **function span lines**: the first to the last line of a function as the TypeScript parser sees it (comments and blanks inside included, the JSDoc above it not), nested functions counted once; `wc -l` gives the whole-file figures. The slice is computed, not read by eye: `slice.mjs` follows every identifier that resolves to a function, method, accessor or constructor (calls, `new`, callbacks handed over by value, getters), interface methods to every implementing class and base methods to every override. That **over-approximates** (a branch a tier never takes is still followed), so every figure below is an upper bound for "what must be ported", except where a section says it was trimmed by hand. Cut points are regular expressions in `run-slice.sh`; each is a statement in section 1.3 that the physics never reads what it removes.

## 0. Result in numbers

| | |
|---|---|
| import closure of `src/sim/host.ts` (runtime imports, my rule) | 37,518 lines in 116 files (plan section 3: 37,727 in 117) |
| functions reachable from `Simulation`'s constructor, `spinUp` and `advance`, no cuts | 17,401 span lines in 87 files, 1,110 functions |
| **the slice, after the cuts of section 1.3** (union of both gate tiers) | **12,262 span lines in 61 files, 755 functions** (+ 61 module-level initialisers) |
| fast tier alone / standard tier alone | 10,944 / 11,912 lines (shared 10,835; fast only 351; standard only 1,345) |
| constant tables the functions read (params, fuel catalogue, ember classes) | about 1,470 code lines |
| shared types (`core/types.ts`, `core/simTypes.ts`) | 37 types, 436 members; 121 types in all |
| static `Math.*` call sites in the slice | 915 (311 need `FsMath`; plus 23 `**` that need `FsMath.Pow` and 12 squares) |
| float-to-integer sites | 31 double-to-int `\| 0`, 138 `floor`/`ceil`/`round`, 12 `imul`, 1 `fround`; no `Int16Array` or `Uint8ClampedArray` store at all |
| estimated new C# | **about 24,300 lines in 17 areas** (ratio 1.7, section 3.1); about 21,800 for the fast tier alone |

## 1. The smallest port

### 1.1 What one run needs, in order

One gate run is `new Simulation(scenario)`, `spinUp()` (standard tier only: 900 s of 3-D air, no fire), `advance(t)`; `SimHost` (`src/sim/host.ts:174-191`, `212-253`) only wraps that in a message loop, so **the host is not part of the slice** (its queue, status, rewind and `explain` messages are out). **`codec.ts` is not imported by `host.ts`** (the host receives an already decoded object); the decode is area 1 and is ported from `src/sim/remote/codec.ts:34-90, 198-294` (the encoder, lines 91-197, is not needed: C# only reads `init.bin` and `snap-<t>.bin`). The step order is fixed by the comment at `src/sim/simulation.ts:20-31` ("never reorder, the determinism test depends on it").

1. **Decode** the start message (`init.bin`; format in `ts-export/README.md`): the frame (u32 header length, JSON header, 8-aligned body), `$ta` placeholders to the array kinds that occur (`init.bin`: `f32`, `f64`, `u8`, `u16`, `u32`; snapshots: `f32`, `u8`, `i16`; the codec also knows `i8`, `u8c`, `i32`, `i64` and `u64`, which no fixture uses), `$num` (`NaN`, `±Infinity`, `-0`), absent = `undefined` (so every optional field is nullable in C#: `w.boundaryLayerHeight`, `w.surfacePressure`, `series.daily`, `fuel.fuelClass`, ...). Fields the slice reads: `terrain` (all arrays), `fuel` (all arrays, `buildContext`), `weather` (`hours[82]` with `pressureLevels[3]`, `kbdi`, `droughtFactor`, `rainLast20`, `annualRainfall`), `options`, `ignitions`, `terrainHiRes` (300 x 300 at 10 m), `startTime`, `duration`, `extent`, `origin`; `edits` and `activeFires` are empty in every fixture (assert it). **Decoded and then ignored:** `fuelHistory` (only the cut fuel-edit path reads it), `datasets`, `datasetSummary`, `id`, `name`.
2. **Terrain**: `terrainDerived(terrain)` (`src/terrain/analysis.ts:655`) **recomputes the derived fields from the elevation with `buildTerrain`** whenever the `Terrain` object is not one the builder made, which is every terrain that came through the codec. `TerrainDerived` has `tpiSmall`, `planCurvature`, `profileCurvature`, `hxx`, `hyy`, `hxy`, `relPos`, `localRelief`, `heightAboveValley`, `thresholds` (analysis.ts:125-); **none of them is in the start message**, and `heightAboveValley` is read by the moisture model, the atmosphere base and `DiagnosticWind` (`fuel/moisture/model.ts:283`, `atmosphere/base.ts:591`, `atmosphere/diagnosticWind.ts:70`). So `buildTerrain` (153 lines plus `sanitiseElevation` 113, `classifyLandforms` 76, `padOdd`, `slidingMinMax`, `stdDev`) is in the slice. Its seven outputs that *are* in the start message (`slopeDeg`, `aspectDeg`, `dzdx`, `dzdy`, `tpi`, `curvature`, `landform`) are a direct test. Then `computeTerrainFeatures` (`src/fire/terrainFeatures.ts:653-897`, 245 lines in one function plus flood fill, flow accumulation, ridge and crest search) and the solar geometry and insolation (`src/terrain/solar.ts`: `solarPosition`, `insolation`, `castShadows`, `skyViewFactor`).
3. **Fuel and moisture**: `cloneFuelMap`, `ensureFuelArrays`, `fuelParamsInto` (the per-cell parameter record), the catalogue; the moisture model (`MoistureModel`: `initialise` with the stable-night and drought spin-up, `update` every 600 s, `advance` 235 lines), AFDRS moisture, `stableNight`.
4. **Fire**: `FireSpreadModel` (constructor 154 lines, masks, `prepare`, `computeCell`, `step`, front, heat, junctions, debris), the level set (`levelSet.ts`, `evaluate` 157 and `reinit` 116 lines), the distance transform, the fuel cache, the behaviour models (`headRosKernel`, `intensityKernel`, Vesta Mk2, pine, grass, heath), the spread-direction maths (`hybridHead`, `ellipseSpeeds`, lee separation, junction boost).
5. **Air, both tiers**: `AtmosBase` (stamps, surface wind for the fire, diagnostics, `sampleTurb`), the grid and profile builders, the 1-D plume, `weatherInterp`, the elliptic (multigrid and PCG) solver, the mass-consistent wind. **Fast tier**: `DiagnosticWind` and `PyrogenicPotential` (the coupling: `src/atmosphere/pyrogenic.ts`; `Fs.Kernel/Pyrogenic/PyrogenicKernel.cs` already is a C# port of its `solve`, T1.4). **Standard tier**: `Atmosphere` (3-D Boussinesq step, sponge, Davies boundary, projection, fire heat) and `dynamics.ts` (advection, diffusion, Smagorinsky).
6. **Embers and the random generators**: `EmberModel` (emit, spawn, the transport loop `advance` 358 lines, landing, ignitions), `FastRng` and `sampleClass`, the 4096-entry normal table, `PlumeField` (standard tier only, `EmberModel.ts:429`: the fast tier lofts by Briggs).
7. **Orchestration**: `Simulation` constructor, `stepOnce`, `spinUp`, due records (ignitions), `fireWinds`, `moistureCtx`, `landingFn`, spot fires.

### 1.2 The air: it must be ported, in both tiers

The card allowed "the air, or the TypeScript's own wind rasters as input; say which and why". **Ported, both tiers; the rasters cannot stand in**, for four reasons that come from the code and the fixtures:

- **The coupling is two-way and per step.** `stepOnce` (`simulation.ts:1356-1365`) adds the fire heat of the previous step to the air, steps the air, and the next step's fire wind (`fireWinds`, `:1446-1477`) reads the result; embers read the 3-D wind at every particle sub-step (`windFn` `:1547`). A raster input cannot answer a different fire.
- **The fixtures hold the air only at snapshot times**: every 60 s (3a fixtures) or 300 s (the `-4h` ones), against a step of 9.5 s (standard) or 10 s (fast); `atmosphere.u/v/w` on the air grid, and `fireWind.u/v` as `Int16` quantised on a 60 m grid (`snap-<t>.bin`; `ts-export/README.md`). No per-step wind exists.
- **Even the fast tier needs the elliptic solver**: `MassConsistentSolver` (`massConsistent.ts`) uses `EllipticSolver` (`solver.ts`, 700 lines) to make the background wind of each weather stamp. Its `Math` content is tiny (4 sites) but its iteration counts depend on residual tests, so it must be bit-exact (risk R3).
- The standard tier's air is 63.5 % of its step loop (`1-profile.md`), which is the thing Gate 1 times.

A **first milestone without any of it for embers** exists, though: `-noembers` fixtures (T3.2 exports them) take areas 9 to 11 (3,720 estimated lines) off the critical path. With `embers=false` the simulation never calls `emit` or `step` of the ember model (`simulation.ts:1368-1373`), so the first end-to-end fire is areas 1-8, 12-15 (fast tier, embers off, bars of 10.3 first row); a null `EmberModel` that returns the initial `plumeTop` is enough (check what `plumeTop()` returns in that case, `simulation.ts:1480-1491`, before relying on it).

### 1.3 What is left out, and why

{{WATERFALL}}

Reasons, each checked in the code:

- **The explain engine ("detectors": insights, cards, forecast, text; `src/explain/`) is never read by the physics.** `explain/deps.ts:1-5` says it imports only pure functions; no `Rng` is used in `src/explain/` (`grep -rn "Rng\|Math.random" src/explain` finds nothing outside tests; the `seed + 2` stream is "reserved", `simulation.ts:269`); `stepOnce` only appends its output to `pendingInsights` (`:1385-1386`). The profile's "detectors" phase (8.9 % of the fast tier) is this plus `atm.diagnostics()`; **`atm.diagnostics()` stays in** (it feeds `nSquared` and the plume top of the embers, `simulation.ts:1176`, and `ctx.plumeTopAGL`, `:1453`): `AtmosBase.commonDiagnostics`, 105 lines, area 14.
- Snapshot assembly, checkpoints, rewind, `engineInfo`, `PerfStats`, `view`, `makeStats`, `publishFireWind`: outputs and bookkeeping. **Two things look like bookkeeping and are physics**: the checkpoint *boundary* (`simulation.ts:1318-1319`: the fast tier recomputes the wind for the fire at every 1,800 s boundary, "both runs recompute it"), and the step length's dependence on the display step (`snapshotStep()`, `:1332-1340`; identical for 60 s and 300 s because both are multiples of 60 s). Keep both; drop the checkpoint objects.
- User edits (fuel edits, brush polygons, wind-direction edits, `setOption`, `setQuality`, rewind): every fixture has `edits: []` and one ignition at t = 0; only the `ignite` record path of `applyRecord` is kept (`records` becomes a list sorted by `(time, seq)`, `records.ts:26`).
- Ember statistics: `RollingWindow` and `DecayRaster` (`embers/stats.ts`) feed only `stats()` and the `layers.landing` raster (`EmberModel.ts:1795-1991`, `:734`); the residence estimates `lifeS`/`lifeN` are physics and stay (`recordResidence`, `:2238-2243`).
- Spread-driver attribution (`attributeDriver`, 32 lines) writes the `driver` raster only; optional, add it if `driver` is to be compared.
- **Optional later, not cut:** `subCellSlopeStats` (39 lines, `terrainFeatures.ts:448`) runs only if `terrain.slopeP90Deg` and `cliffFraction` are absent (`:821`); the fixtures carry them, so it can be skipped. `publishFireWind` (57 lines, the only `Int16Array` store) would let the per-snapshot `fireWind` raster test `surfaceWindForFire`.

## 2. The JavaScript-semantics sites

All counts are static sites in the 755 functions and 61 module initialisers of the slice; the exhaustive list with file:line and the code text of each site is `reports/3-slice-sites.md` (sections in the same order as below). A site in a loop that runs a million times is one line here, which is why the run-time counts of `1-profile.md` (about 21,000 transcendental calls per step, almost all from `exp` in `EmberModel.advance`, `slopeFactor`, and `cos` in the fire phase) say where speed matters and this section says where correctness does.

### 2.1 `Math.*` and `FsMath`

{{MATH_FN}}

`FsMath` needs, by function: `Exp`, `Log`, `Pow`, `Sin`, `Cos`, `Tan`, `Atan`, `Atan2`, `Acos`, `Asin`, `Cbrt`, `Hypot` (all 29 sites have two arguments: the three-argument overload is not needed) and `Log2` (one site, `fire/models/common.ts:38`). **`Sinh`, `Log10` and `Math.sign` do not occur in the slice** (they occur nowhere in the runtime closure either); `Math.trunc` does not occur. 58 of the 311 sites are in `terrain/solar.ts` (run every 600 s, not hot); the hot ones are `EmberModel.advance` (4 `pow`, 4 `exp`, 1 `cbrt`), `sampling.ts` (`sampleClass`, `natureTauBDensity`, `proposalMeanTauB`: `exp` and `log`), `slopeFactor` and `vestaMk2Eval`. Table of the same sites by file:

{{MATH_FILE}}

The module-level initialisers call `FsMath` too and must go through it, because a one-bit difference in a table entry changes every draw that indexes it: `fuel/moisture/fastMath.ts:52-56` (`h ** 0.679`, `r ** 1.7`, `r ** 8`, 4 `exp`), the 4096-entry `NORMAL_TABLE` of `embers/sampling.ts:87-96` (`inverseNormalCdf`, `Math.sqrt`), `fire/models/fuelRef.ts:55-57`.

**Powers.** `**` and `Math.pow` are 35 + 15 = 50 sites; 12 are squares (`x ** 2`, becomes `x * x`), 23 are other exponents (constants 0.25, 1.3, 1.7, 3, 3.4, 4.3, 5, 5.25588, 0.679, 8; or variable) and need `FsMath.Pow`, with the 15 `Math.pow`: 38 `FsMath.Pow` sites. The plan's "42 `**` sites" (section 10.4) is the count over the closure's files; 35 are in reachable functions. The plan's "the standard tier's air solve makes 72,001 squares per step" is `Smagorinsky` in `atmosphere/dynamics.ts:244-281` (5 squares in the per-cell loop), not the elliptic solver.

{{POW}}

### 2.2 Float-to-integer conversions and typed-array stores (`FsConv`)

Typed-array stores in the slice, by array kind (stores of `Float64Array` need nothing; `Float32Array` stores round to float32 like a C# `(float)` cast and must keep float32 storage, because the TypeScript's state is float32 between steps, for example the 23 particle arrays of `EmberModel`):

{{TA}}

- **No `Int16Array`, `Int8Array` or `Uint8ClampedArray` store exists in the slice** (`grep` shows them only in `src/sim/fireWindPublish.ts:33-34`, cut, in `core/airPack.ts` and `core/sliceRecording.ts`, not reachable, and in `codec.ts`, a byte copy). `FsConv`'s clamping and `Int16` wrapping (T4.1) are not needed by the slice; the T4.1 tests for them are harmless but not on the critical path.
- 131 of the 184 `Uint8Array`/`Int32Array`/`Uint16Array`/`Uint32Array` stores are not trivial literals, and every one stores an **integer-valued** quantity (cell indices, flags, counts, enum codes). Only one converts a float: `atmosphere/atmosphere.ts:332` (`this.bin[o] = Math.min(nBins - 1, Math.max(0, Math.floor(...)))`, a `Uint16Array`). In C# they are int/byte/ushort arrays and plain assignments; the conversion lives in the expression that computes the index.
- **Double-to-int truncations written `x | 0`** (truncation toward zero, not floor: `-0.3 | 0` is 0 while `Math.floor(-0.3)` is -1; this matters for positions west or south of a grid): 31 sites: `dynamics.ts:96,98,100,187,189,191`; `EmberModel.ts:1479,1480,1504,1685,1686,1728,1729,2012,2013`; `embers/plume.ts:189-191`; `embers/sampling.ts:101,131`; `fuel/moisture/model.ts:493-593` (10 sites, the look-up table index in `advance`); `fastMath.ts:15`. Another 6 are `(k / nx) | 0` on integers (`analysis.ts:284,294,321,353`, `solar.ts:370,428`): integer division in C#.
- `>>> 0` on `uint32` state (the generators): `core/rng.ts:8,12,15,52`, `embers/sampling.ts:19,22,25`, the inline copy in `EmberModel.advance` `:1602-1657`, `EmberModel.ts:651,2246`: use `uint` arithmetic (`unchecked`), not `FsConv`. `Math.imul`: 12 sites, all in these generators (`rng.ts:13-14`, `sampling.ts:23-24`, `EmberModel.ts:1603-1656` 8 sites).
- `Math.floor`/`ceil` sites (56 + 31) that end as an index or a count: each C# `(int)` of the result is a float-to-int cast the analyzer FS0001 will stop; audit set in `reports/3-slice-sites.md` ("Math.* calls"). Only 7 element-access expressions contain the rounding call inline (`grid.ts:354`, `units.ts:65`, `sampling.ts:101,131`, `EmberModel.ts:1605,1609,1621`); the rest go through a local.
- **`Math.round` (51 sites, JavaScript rounds halves toward +infinity) is exercised on exact halves in the gate scenarios:** `atmosphere/grid.ts:316,318` rounds `(fg.x0 + i * fg.cellSize - grid.x0) / dx` for a 30 m fire grid inside a 100 m air grid, which produces `.5` for some `i`; `core/grid.ts:41-42` (`cellAt`), `terrainFeatures.ts:587-588,882-883`, `EmberModel.ts:2028-2029`, `embers/plume.ts:151-154`. C#'s `Math.Round` (half to even) and `MidpointRounding.AwayFromZero` (half away from zero, wrong for negative halves) both differ; `FsConv.Round` only. The wall-clock-sized one is `weatherInterp.ts:24` (`Math.round(lerp(a.time, b.time, f))`, milliseconds near 1.7e12).
- `Math.fround`: one site (`terrain/analysis.ts:478`, applied before the `>= 360` wrap test: "359.99999999 would otherwise be stored as 360").

{{BITS}}

### 2.3 Order and tie-breaking

**Sorts (15).** V8's `Array.prototype.sort` is stable; `Array.Sort` in C# is not. Typed-array `.sort()` without a comparator is numeric ascending with NaN last; C# `Array.Sort(double[])` puts NaN first. Sites, and what each needs:

{{SORTS}}

- Comparators with possible ties and no tie-break: `base.ts:1002` (`medianColumn`: columns with equal terrain height keep index order), `profile.ts:107,151` and `EmberModel.ts:2083` (pressure-level samples by height), `fuel/moisture/model.ts:872` (rain by time). Port with an explicit index tie-break (or a stable sort).
- With a tie-break already: `EmberModel.ts:1208` (`age` then `b - a`), `records.ts:26` (`time` then `seq`), `atmosphere.ts:555` (unique ints).
- Typed sorts: `grid.ts:353` (`Float32Array.from(elevation).sort()`, then `sorted[Math.min(n - 1, Math.floor(0.9 * n))]`, a 90th percentile), `levelSet.ts:191` (an `Int32Array` band), `terrainFeatures.ts:476`, `air.ts:79` (`filter(Number.isFinite)` first). No NaN reaches them (elevation is sanitised, `air.ts` filters), but state it in the test.

**Maps and sets (19 constructions, 6 iterations).** Only these iterate:

{{MAPITER}}

- `Simulation.records` (`simulation.ts:340,455,934`): a `Map<number, SimRecord>` keyed by an increasing `seq`, iterated then sorted by `(time, seq)` (a total order): a `List` sorted the same way gives the same result. The plan's "delete-then-set moves a key to the end (`simulation.ts:1668`)" is `windKnown`, **explain-only and outside the slice**; `undoRecords` (`:673-678`, the other `delete`) is a user-edit path, cut.
- `Atmosphere.addFireHeat` (`atmosphere.ts:539-556`): a `Set<number>` of columns, then `Array.from(cols).sort((a, b) => a - b)`: insertion order is irrelevant after the sort; use a sorted list or a bit set.
- **`castShadows`' cache** (`terrain/solar.ts:337-345` and `:384-385`): an LRU `Map<string, Float32Array>` of 12, **keyed by `` `${sunAzimuth.toFixed(2)}|${sunElevation.toFixed(2)}` ``**: a hit returns the array computed for a sun position up to 0.005 degrees away, and `delete`+`set` refreshes the order, the first key is evicted. In the gate scenarios the hits are repeats of the same instant (the t = 0 spin-up call and the t = 0 step call), so an exact-key cache gives the same bits, but the C# must key on the same rounding (`toFixed(2)` is the exact decimal expansion rounded half up; ordinal strings or `(round(az * 100), round(el * 100))` through `FsConv.Round`) or it will diverge the first time two sun positions fall within 0.01 degree (near solar noon at the solstice with a short step). The returned array is shared and read-only.
- **`stampKey`** (`atmosphere/base.ts:61-62`): `` `${w.time}|${w.windSpeed10.toFixed(4)}|${w.windDir10.toFixed(3)}|${w.temperature.toFixed(3)}|${n}` `` identifies weather stamps for reuse in `setAmbient` (`:284-287`): two hours equal to those decimals share one solved stamp. Same remedy. `refreshBlend`'s key (`atmosphere.ts:462`, `` `${A.hour.time}|${B.hour.time}|${this.wgt}` ``) is `String(number)`, which is equal exactly when the doubles are (and `-0` equals `0`): a tuple compare.

**String-keyed objects (26 sites) and `Object.*` (5).** `ATMOS_TIERS[tier]`, `SPREAD_PARAMS[key]`, `RATING_LOAD[layer]`, `FAMILY_CODE[f]`, `SIM_PARAMS.maxEmbersByTier[...]`: constant tables, become enum-indexed arrays. The generic walkers (`embers/params.ts:422-455` `deepFreeze`, `merge`, `clone`; `fire/spread/params.ts:287-292` `resolveSpreadParams`; `fuel/fuelMap.ts:494-496` `cloneFuelMap`; `weatherInterp.ts:32-33` `a[key]` over an optional-key list) copy or merge by key with no order dependence: replace them with typed copies. `scenario/weather.ts:148` writes through `Record<string, number>`.

**Dates (11).** `new Date(x).getUTCMonth()` and `toISOString()`: `fuel/moisture/model.ts:754,858,860,867,1015`, `simulation.ts:1501`. The argument is a non-integer double (`t + (lon / 15) * HOUR_MS`), which `Date` truncates toward zero to whole milliseconds; the C# needs `FsConv`'s truncation before building a `DateTimeOffset`. `Date.now()` at `:394` is the cut perf clock.

### 2.4 JavaScript truthiness, `NaN`, optional values

- **Truthiness of numbers (99 sites, mostly `arr.length`, flags and `Uint8` values)**; the ones where 0 and `NaN` and `undefined` coincide: `core/rng.ts:8` (`seed >>> 0 || 0x9e3779b9`: seed 0 becomes the constant), `EmberModel.ts:651` (`(stepId + 1) >>> 0 || 1`: wraps 0 to 1), `atmosphere/grid.ts:150-151,290-291` (`ir - il || 1`), `EmberModel.ts:1208` (`a - b || b - a`), `fuel/moisture/model.ts:303,315,316` (`p.cover || 0`), `terrain/solar.ts:540` (`ghi || 0`), `atmosphere/base.ts:587,826` and `profile.ts:136,141` (`w.boundaryLayerHeight && w.boundaryLayerHeight > 0`, `w.surfacePressure && ...`: absent, 0 and NaN are all false).
- **NaN as a value**: `aspectDeg` is `NaN` on flat cells (`analysis.ts:472`), `env.uRidge` starts `NaN` (`simulation.ts:495`), `arrivalTime` is `+Infinity` when unburnt, `plumeTopAGL = NaN`. 94 `Number.isFinite`/`isNaN`/`parse` sites map to `double.IsFinite`/`double.IsNaN`. The self-comparison idiom `x === x` as a NaN test appears at `EmberModel.ts:1759` (`!(ur === ur)`) and in the particle test `!(x === x && y === y && z === z)` (`:1663`), `embers/sampling.ts:35`, `fire/spread/FireSpreadModel.ts:1336,1580,1815,1816`; no `=== NaN` comparison exists. Port as `double.IsNaN`.
- **`Math.min`/`Math.max`: 359 sites (216 `max`, 143 `min`), none with a spread argument, 6 with three or four arguments** (`atmosphere.ts:213,294`, `base.ts:414`, `drought.ts:106`, `simulation.ts:592`, `analysis.ts:413`). JavaScript propagates NaN and orders -0 below +0; so does C# `Math.Min`/`Math.Max` for `double`. Port literally (a `Math.max(a, Math.min(b, c))` clamp stays a call; a ternary clamp such as `v < 0 ? 0 : v > 1 ? 1 : v` stays a ternary, `EmberModel.ts:2261`, because it returns NaN for NaN and the call does not differ only by luck). The full list with file:line is the last section of `3-slice-sites.md`.

### 2.5 The random generators and the draw order

Three generators, one algorithm (mulberry32, `core/rng.ts:11-16`): `Rng` (`core/rng.ts`), `FastRng` (`embers/sampling.ts:16-60`, same stream, state copied in and out of the ember `Rng` at every public call, `EmberModel.ts:2245-2252`), and four inline copies of the step inside `EmberModel.advance` (`:1602-1657`). Streams: embers = seed, fire = seed + 1, explain = seed + 2 and atmosphere = seed + 3 are **never drawn from** (the atmosphere stores its `Rng` and checkpoints its state only: `base.ts:184,1037,1069`). Consumers of the `Rng` type (found by type, not in step order; the step order is `simulation.ts:20-31`):

{{RNG}}

and the ember transport and emission draws that the `Rng`-typed search does not see because they go through `this.r` (`FastRng`) or the inline copy: `EmberModel.emit` `:629-630` (`this.r.poisson(dN / this.wC[c])` per active cell in `aCell` order and class order, then `this.r.next()` per particle), `spawn`/`sampleClass` (`sampling.ts`, 38 lines; `normal()` keeps a cached second variate, cleared by `syncIn`, `EmberModel.ts:2247`), `advance` (`:1602-1657`: two draws for the horizontal Ornstein-Uhlenbeck update when `su > 0`, one for the vertical when `sw > 0`, one for re-flaming when `reflame > 0 && age >= flameEnd`: **the number of draws per particle depends on branch conditions, so one wrong comparison shifts the stream for every later particle**), `processIgnitions`. The order of the active-cell list is the order of `fire.frontCells()` (`EmberModel.ts:516-530`) and of swap-removal (`removeActive`, `removeAt`): lists of cell indices must be kept in the same order, not as sets. Normal draws use `NORMAL_TABLE[(r.next() * 4096) | 0]` and `nt[... >>> 20]`.

## 3. Areas

### 3.1 Sizes and the ratio

New C# lines per area = ratio x TypeScript function lines + constant tables + types (members + 3 per type) + extra. **Ratio 1.7, from one measured sample:** `Fs.Kernel/Pyrogenic/PyrogenicKernel.cs` is 446 lines against `src/atmosphere/pyrogenic.ts` 213 (2.09x; 1.96x by code lines), but 5 SIMD and parallel forms are in it. The scalar-only subset (constructor and fields, `BuildDst`, `AnySource`, `ClearOutputs`, the six phases, `AccumRows` and `AccumAxpy`, one serial `Run`; lines 22-111, 161-342 and about 15 of 112-160) is 287 lines against the 4 reachable functions of the TypeScript, 166 lines: **1.73**. By code lines (blank and comment lines out): 231 against 185 for the whole file (1.25). I use the span ratio because the areas below are measured in span lines; a span ratio overstates for dense numeric code and understates for object-heavy code (`FireSpreadModel`, `EmberModel`, which need declared fields and records), so 1.7 is neither a floor nor a ceiling: at 1.35 the total is 20,000 lines, at 2.1 it is 29,000, and the areas that sit above 1,700 estimated lines (3, 4, 12, 14, 1) would pass 2,000 first. The measuring commands are at the end. The existing `PyrogenicKernel.cs` is reusable as it is for `PyrogenicPotential.solve` (saves about 280 lines in area 14: estimate 1,590 instead of 1,872).

Files and functions per area, with TypeScript span lines (functions nested in a listed function are not listed again, but their lines are inside its figure):

{{AREA_TABLE}}

Fast tier complete (areas 1-15 without 16 and 17, plus the pyrogenic reuse): about 21,800 lines. Standard tier adds areas 16 and 17 (2,190). Embers (areas 9-11, 3,720) can be left to the second milestone.

### 3.2 Order

```
A1 ──► A2 ──► A3 ──┬─► A4 ──────────────────────────────┐
 │                 ├─► A5 ──► A6 ──► A7 ──► A8 ─────────┤
 │                 ├─► A9 ──► A10 ──► A11 ──────────────┤
 │                 └─► A12 ──┬────────────► A14 ────────┼──► A15 ──► (standard) A16, A17
 └────────────► A13 ─────────┘                          │
```
(A13 needs only A1; A14 needs A12, A13, A2; A15 needs A4, A8, A11, A14; A16 needs A14, A12, A13; A17 needs A12, A13.) With at most three builders at once: **wave 1** A1; **wave 2** A2, A13; **wave 3** A3 (A13 may still run); **wave 4** A4, A5, A12; **wave 5** A6, A9, A14; **wave 6** A7, A10, A16; **wave 7** A8, A11, A17; **wave 8** A15, then the acceptance run. Milestones: **M1** embers off, fast tier: after A15 without 9-11 (areas 1-8, 12-15); **M2** embers on, fast tier (adds 9-11); **M3** standard tier (adds 16, 17). `FireSpreadModel` and `EmberModel` are one class each in the TypeScript: in C# they are `partial` classes, one file per area, so that areas 7 and 8 (and 10 and 11) can be built by different builders; the first of the two fixes the field list.

### 3.3 What proves each area, and its risks

The fixtures are end to end: `init.bin` (inputs) and `snap-<t>.bin` (outputs every 60 s, or 300 s). They hold **no intermediate**. What a snapshot carries: `fire.{arrivalTime, burnState, ros, intensity, flameHeight, spreadDir, driver, phase}`, `moisture`, `atmosphere.{levels, terrainHeight, surfaceU, surfaceV, u, v, w, thetaAnomaly, smoke}`, `embers.{count, data}`, `layers.{vls, attach, trench, landing}`, `fireWind.{u, v}` (Int16), `spotFires`, `stats`. So the areas that can be compared directly are: A1 (decode), A2 (the seven terrain arrays), A4 at t = 0 (`moisture` of `snap-0`), A12/A14 for the fast tier at t = 0 (`atmosphere.levels`, `terrainHeight`, `u/v/w`), and A15. **Everything between needs an intermediate.** Recommendation for the orchestrator (question Q1): a TypeScript-only card **T3.4 "probes"** before T4.2, in `ts-export/`, that (a) records the **environment tape**: `SpreadEnvironment` (`windU/V`, `windBgU/V`, `fireIndU/V`, `uRidge`, `airT`, `airRho`, `moisture`, `availability`, `fuelTempC` and the scalars) at each fire step for the first 600 s (about 60 steps; 26 MB for the 3 km grid, 106 MB for 6 km), which lets areas 5-8 be tested bit for bit before any air exists; (b) the **air tape**: the 3-D `u, v, w` at each step for the ember area (87 MB for 180 fast steps); (c) **call recorders** (like `profile/mathwrap.ts`) for 1,000 calls of `headRosKernel`, `intensityKernel`, `ellipseSpeeds`, `hybridHead`, `DistanceTransform.compute`, `sampleClass`, `weatherAt`, `solarPosition`; (d) dumps of `computeTerrainFeatures`' arrays and `fuelParamsInto` for 20 cells; (e) golden draws of `Rng`/`FastRng` and the `NORMAL_TABLE`. Estimated 300 lines of TypeScript, no `src/` edit.

| area | direct proof from the fixtures | proof that needs a probe | risks (all with the section that quotes the site) |
|---|---|---|---|
| A1 | every `init.bin` and `snap-<t>.bin` decodes; counts and values equal `inspect.mjs`; `arrival.f32` equals `fire.arrivalTime` of the last snapshot (+Infinity is -1); `hashes.json` entry of a NaN-free snapshot with T4.1's hash | `Rng`, `weatherAt`, `stableNight` golden values | optional fields (nullable); `-0`; `Rng` seed 0 (2.4); two near-duplicate weather interpolators (`scenario/weather.ts` `weatherAt` 46 lines and `fuel/moisture/weather.ts` `seriesWeatherAt` 36 lines, "a local adapter"): port both until a TypeScript check proves them identical for the slice |
| A2 | `slopeDeg`, `aspectDeg` (NaN where flat), `dzdx`, `dzdy`, `tpi`, `curvature` (float32, within `FsMath` ULP), `landform` (exact) vs `buildTerrain(elevation)` | `solarPosition`, `insolation` arrays | `atan`, `atan2`, `hypot`; `Math.fround` (`analysis.ts:478`); `sanitiseElevation` queue code; 97 `Math` sites in `solar.ts`, 58 of them `FsMath`; the `castShadows` cache (2.3) |
| A3 | none | `computeTerrainFeatures` arrays, `fuelParamsInto` rows | `MinHeap` (`terrainFeatures.ts:129-170`, keyed by elevation: equal keys pop in the order the sift gives, so port the sift literally); 27 `Int32Array` stores in work queues; typed sort `terrainFeatures.ts:476`; 24 floor/round sites; the catalogue's string classes become enums |
| A4 | `moisture` at t = 0 (after `initialise`, needs A1-A3 only) | `moisture` at 600, 1200, 1800 s needs the 10 m wind of the air: the environment tape | `advance` (235 lines) with 10 `x \| 0` look-up indices; `Date` arguments (2.3); module tables through `FsMath`; `seedRainHistory` sort ties; float32 `field` arrays |
| A5 | none (fire arrays only through A6-A8) | call recorders | `Math.acos(Math.max(-1, Math.min(1, x)))` clamps; `Math.pow` with `n + 1`; out-parameter objects (`HeadKernelOut`) reused across calls: classes with preallocated fields, no allocation in the step loop |
| A6 | none | `DistanceTransform.compute` golden | `reinit` (116 lines) bit flags; `commitInserts` sorts the band (typed sort, ints); `evaluate` (157 lines, the hottest fast-tier kernel at 4 h); the file has 16 `Float32Array` and 9 `Uint8Array` stores; `subCount` cadence of re-initialisation |
| A7 | with the environment tape: `arrivalTime`, `burnState`, `ros`, `intensity`, `flameHeight`, `spreadDir`, `phase`, `layers.vls/attach/trench` for the taped steps | the tape | `frontCells()` order drives the ember draw order (2.5); `refreshMasks` and `Math.round(from / secW)` sector halves (`FireSpreadModel.ts:686`); `Rng` draws at `:1207,1504` |
| A8 | same | same | `rollDebris` Poisson and `next` order (`:1954-1984`); `recordArrival` writes 8 rasters; origin propagation order |
| A9 | none | `sampleClass`, `NORMAL_TABLE`, `FastRng` vs `Rng` golden | `NORMAL_TABLE` built at load through `inverseNormalCdf`; `PlumeField` is standard-tier only (161 TS lines, ~270 C#: build it in M3); `merge`/`clone` generic code replaced by typed params |
| A10 | `embers.count`/`data` at the first snapshots with the air tape | the air tape | 23 `Float32Array` particle arrays (state is float32 between steps); swap-remove order; Poisson draws per active cell; `buildVictims` sort; `syncIn`/`syncOut` |
| A11 | `embers.data`, `spotFires` over 1,800 s with the air tape | the air tape | the inline generator and the branch-dependent draw count (2.5); `x === x` tests; `Math.pow(r1, n + 1)`; `storeState` writes the double state back into float32 arrays (`:1769-1783`); `land` (103 lines) |
| A12 | fast tier t = 0: `atmosphere.levels`, `terrainHeight`, `baseM`, `topM` | `buildProfile`, `buildAtmosGrid` | `grid.ts:316,318` `Math.round` halves (2.2); `r ** k` variable powers (`grid.ts:87,259`); the `Float32Array.sort` percentile (`:353-354`); `profile.ts:107,151` sort ties; `interpolateHour` string keys |
| A13 | indirectly: fast `atmosphere.u/v/w` at t = 0 (mass-consistent wind of stamp 0) | recorded right-hand side and solution | iteration counts follow residual tests (`(rel / first) ** (1 / it)`, `solver.ts:798,851`): a one-ULP residual can change the count; keep every reduction (`dot`, `norm2`, `removeMean`) in the TypeScript's order and single-threaded; 40 `Float64Array` stores |
| A14 | fast tier: `atmosphere.u/v/w` at t = 0, 60, 120 s (diagnosed wind); `fireWind` if `publishFireWind` is added | the tape | `stampKey` `toFixed` (2.3); `median`/quickselect; `medianColumn` sort ties (`base.ts:1002`); `surfaceWindForFire` (107) with `Math.round(windFromDeg / 22.5)`; `commonDiagnostics` (105); `setAmbient` sub-stamps; pyrogenic reuse |
| A15 | `arrival.f32`, all fire rasters, `moisture`, `embers.data` for `katoomba6-fast` and `katoomba3-fast`; 1 vs 4 threads bit-identical; then `-4h` | | step order (`:20-31`); `cpBoundary` (`:1318`); `Math.round(wrapDeg(windDir10) / sectorDeg)` (`:1309`); `new Date(...).getUTCMonth()` (`:1501`); `landingFn`'s `frontRosAt`; `EPS` handling; the embers-off stub |
| A16 | `katoomba3-standard`: `atmosphere.u/v/w/thetaAnomaly/smoke` (18,000 floats each) and `surfaceU/V` after the 900 s spin-up (the t = 0 snapshot is *before* the spin-up, so it is the fast-tier-like state) | air tape | `Atmosphere.step` (206 lines), `project` (PCG), `davies`, `sponge` (`sp` has `Math.sin(...) ** 2`, `:315`); 76 spin-up steps then 189; `fireWindTier` (73) |
| A17 | indirectly through A16 | air tape | 72,001 squares per step in `smagorinsky` (`dynamics.ts:244-281`): `x * x`; 6 `x \| 0` indices in `displacements`/`advect` (`:96-100,187-191`); the hottest standard-tier kernels after the solver (`advect` 9.3 %, `diffuseVLevels` 4.1, `diffuseH` 3.3 of the step loop) |

**Where the code goes.** New project `Fs.Solver` (net11.0, references `Fs.Kernel` for `FsMath`/`FsConv`/`Hash`), one namespace and one folder per area. It is a solver project (banned APIs, FS0001), so the orchestrator adds, at merge time: in `FsProto.slnx` `<Project Path="Fs.Solver/Fs.Solver.csproj" />`; in `Directory.Build.props` `Fs.Solver;` to `<FsSolverProjects>` (now `;Fs.Kernel;Fs.Wasm;`). A1's JSON decode uses `System.Text.Json` (`double` parsing is correctly rounded, so JavaScript's shortest round-trip text gives the same bits); it is in the same project because `Fs.Tests` references one project.

## 4. What the orchestrator needs for T4.2's area cards

Each card is the template below filled from sections 3.1 (function list), 2 (sites of the area's files, from `3-slice-sites.md` filtered by file), and 3.3 (proof, risks). The template, filled for **area 1** as the example:

> **T4.2-A1 Shared types, decode, generator, weather series, drought and stable night, numeric helpers**
> - **Who:** builder (Sonnet 5.5, high effort), own worktree. **Needs:** T4.1 (`FsConv`, `Hash`), T3.2 fixtures, T3.3. **Reads:** plan sections 2, 9, 10.4; `reports/3-slice-map.md` section 2.5 and 3; `ts-export/README.md` ("Fixture folder"); `dotnet-test` skills (`run-tests`, `assertion-quality`, `test-anti-patterns`); `csharp-refactoring` skill.
> - **Scope (In):** `prototypes/dotnet-b/Fs.Solver/` (`Decode/`, `Types/`, `Core/`, `Weather/`) and its tests in `Fs.Tests/Solver/A1/`. **Out:** every other folder; `FsProto.slnx` and `Directory.Build.props` (list the lines to add in the report); `src/`.
> - **Port, in this order** (TypeScript function: lines): `codec.ts` decode path 34-90, 198-294 (154) to `Decode/FrameReader`; the 37 types and 436 members of `core/types.ts` and `core/simTypes.ts` that the slice names (`reports/3-slice-map/typecount.mjs --list`) to `Types/`; `core/rng.ts` (36) to `Core/Rng`; `core/grid.ts` (55), `core/units.ts` (29), `core/physics.ts` (73); `scenario/weather.ts` (131), `fuel/moisture/weather.ts` (70); `fuel/moisture/drought.ts` (84), `fuel/moisture/night.ts` (61); `sim/records.ts` `recordOrder`; `SIM_PARAMS` (`sim/params.ts`, 35 code lines). 694 function lines in 9 files (the listing is in section 3.1), estimate 1,770 lines.
> - **Conventions to test (one test each, from this area's sites):** `Rng`: seed 0 gives `0x9e3779b9` (`rng.ts:8`), uint32 wrap, `next`/`poisson`/`normal` golden draws from the TypeScript for seeds 11, 12, 13 (T3.4 (e) or `node` one-liner over `core/rng.ts`); `FsMath` for `Rng.normal` (`log`, `cos`), `windToUV` (`sin`, `cos`), `dewPointC`, `pressureIsa` (`**`: `FsMath.Pow`), `exner`; `Math.round` halves in `cellAt` (`core/grid.ts:41-42`: x exactly on a cell edge) and `makeGridSpec` (`:23`); `Math.min`/`max` NaN propagation in `clamp`; the decoder's refusals as in `codec.ts:216-261` (malformed array, outside body, shared bytes, `__proto__`, depth 128, 4,096 arrays, 8 MiB header); `$num` `-0` and `+Infinity` round trip; optional field absent = null; typed arrays copied to aligned arrays.
> - **Contract tests on fixture inputs:** decode `init.bin` of `katoomba3-fast`, `katoomba3-standard`, `katoomba6-fast`; field list equals `inspect.mjs` output; `terrain.elevation` length 10,000/40,000; `weather.hours.Length == 82` with 3 pressure levels; `ignitions[0].points`; `options.seed == 11`; `edits` and `activeFires` empty; decode every `snap-<t>.bin`; `arrival.f32` equals the last snapshot's `fire.arrivalTime` (+Infinity is -1); the T4.1 hash of a NaN-free snapshot equals `hashes.json`. Weather: `weatherAt` at 20 times against a TypeScript golden from T3.4 (c).
> - **Done when:** the tests above pass on x64 and on WebAssembly (T4.1's runner), the analyzers are clean (`Fs.Solver` is a solver project), no allocation in `Rng.Next`/`WeatherAt` (BenchmarkDotNet allocation column 0 or an `GC.GetAllocatedBytesForCurrentThread` test), and the report lists the TypeScript functions not ported and why.
> - **Risks to watch:** section 3.3 row A1. **Budget:** about 1,800 C# lines; if it passes 2,000, the orchestrator splits `Types/` from `Decode/`.
> - **Return:** the four items of `BUILDER.md`, plus the C# line count per file against the estimate (to refine the ratio for the later cards).

Fill-in rules for the other cards: *Needs* from section 3.2; *Port* from section 3.1's function list for the area (the same file:function:lines); *Conventions* = the rows of section 2 whose file is in the area (`grep "^- <file>" reports/3-slice-sites.md`); *Proof* from section 3.3; *Done when* adds, for A7/A8, A10/A11 and A15, "identical output on 1 and 4 threads" (plan T4.2).

## 5. Where the code contradicts the plan, and questions

**Contradictions.**
1. **Plan section 6 T3.3 step 1 and section 3**: the list of what the slice needs omits `buildTerrain`: the derived terrain fields are recomputed on the host and are not in the start message (section 1.1 item 2; `terrain/analysis.ts:655-663`). 438 TypeScript lines, about 740 C#.
2. **Plan section 3, "Size of the solver"**: the `Math` counts (max 356, abs 247, ..., hypot 91, tan 62, cos 113) **include test files**: for the same directories without `*.test.ts` and `testing/`, `grep -rho "Math\.<f>(" ...` gives max 245, abs 44, min 172, floor 79, round 90, cos 62, exp 77, sin 61, sqrt 82, hypot 35, tan 7, log 54, ceil 41, pow 27, imul 12, atan 15; the slice has 915 call sites in all, hypot 29, tan 5. The conclusion (about 21,000 transcendental calls per step, `exp` first) comes from `1-profile.md`'s counting run and is unaffected. The 37,727 lines in 117 files is 37,518 in 116 by my rule (a runtime-import closure that skips `import type`); not a contradiction, a 0.6 % difference.
3. **Plan section 10.4, Order**: "insertion-ordered maps, where delete-then-set moves a key to the end (`src/sim/simulation.ts:1668`)": that code is `windKnown`, explain-only, outside the slice. The hazards the slice does have are the `castShadows` LRU keyed by `toFixed(2)` strings (`terrain/solar.ts:337-385`) and the `stampKey` `toFixed` keys (`base.ts:62`); neither is in the plan's list.
4. **Plan section 10.4, Conversions and T4.1**: `Int16Array` wrapping stores and `Uint8ClampedArray` clamping stores do not occur in the slice (only in `fireWindPublish.ts`, display). The T4.1 steps for them can wait. Conversely **`Math.round` on exact halves does occur** in the gate scenarios (`grid.ts:316,318`).
5. **Plan section 10.4, Powers**: "the solver has 42 `**` sites, the air solve makes 72,001 squares per step": 35 reachable `**` sites (39 lines in the closure's files; the plan's count is by occurrence over the bundle) and the squares are `smagorinsky`, not the elliptic solver; and the solver's iteration test `(rel / first) ** (1 / it)` (`solver.ts:798,851`) is a variable power that needs `FsMath.Pow` and influences iteration counts.
6. **Plan section 2 rule 5 / Gate 3 "ported exactly"**: two further numerical inputs the plan does not name are built at load time and must be bit exact: `NORMAL_TABLE` (4096 values) and the moisture tables (`fastMath.ts`), both through `FsMath`.
7. **Plan T3.3 step 1 "the air if the tier needs it (or the TypeScript's own wind rasters)"**: both tiers need the air, including the fast tier's elliptic solver; the rasters cannot be used (section 1.2).

**Questions for the orchestrator.**
- **Q1.** Add a TypeScript-only card T3.4 "probes" (environment tape, air tape, call recorders, golden draws; section 3.3) before T4.2? Without it, areas 3, 5, 6, 7, 8, 9, 10, 11, 13 have only end-to-end proof, i.e. a bug is found at A15 and located by bisecting.
- **Q2.** Accept the ratio 1.7 (24,300 lines, 17 areas)? If the T4.2 builders' first areas come in at another ratio, re-run `areas.mjs --json` with `areas.json` `ratio` changed: the table recomputes.
- **Q3.** Fast tier first, embers second, standard tier last (milestones M1 to M3)? The plan's Gate 1 needs timings of both tiers, so M3 is on the critical path for the verdict but not for the first fire.
- **Q4.** New project `Fs.Solver` rather than growing `Fs.Kernel`? (`Fs.Kernel` already is a solver project, with the exempt `Pyrogenic/` folder and a `System.Numerics.Tensors` reference; a separate project keeps the 24,000 lines out of the speed-test and FsMath project.) Lines to add are in section 3.3.
- **Q5.** May the C# port omit the explain engine, `driver`, `layers.landing`, `fireWind`, `stats` and `insights` from its output (compare `fire.*` arrays, `moisture`, `embers.data`, `atmosphere.*`)? Section 1.3 says the physics never reads them.
- **Q6.** The 4 h scenarios start at 14:00 and the wind turns at about 2 h (`3-scenarios.md`): no extra code (`setAmbient` sub-stamps and `interpolateHour` are in areas 12 and 14), but T3.1b's floors apply to the bars of 10.3; is a pinned `tier` (never `auto`) assumed for the C#? (`autoTuneDecide` is cut: it reads the wall clock, `simulation.ts:1187`.)

## 6. Commands that give every number

From the repository root (`prototypes/dotnet-b/reports/3-slice-map/`; `TS_PATH` is the directory of the TypeScript package if there is no `node_modules`; scratch folder `$FIRESIM_SCRATCH/T3.3` after `source prototypes/dotnet-b/env.sh`):

```
git rev-parse --short HEAD                                    # 0cc17cc
wc -l src/sim/host.ts src/sim/remote/codec.ts src/sim/simulation.ts src/atmosphere/pyrogenic.ts   # 271 294 2213 213
node prototypes/dotnet-b/reports/3-slice-map/closure.mjs src/sim/host.ts | tail -1                # 37518 total 116 files
export TS_PATH=<main checkout>/node_modules/typescript
prototypes/dotnet-b/reports/3-slice-map/run-slice.sh          # slice-union|fast|std|all .json and .txt in the scratch folder (6 s each)
D=$FIRESIM_SCRATCH/T3.3
node prototypes/dotnet-b/reports/3-slice-map/tiers.mjs $D                       # lines by tier
node prototypes/dotnet-b/reports/3-slice-map/waterfall.mjs $D                   # section 1.3 table
node prototypes/dotnet-b/reports/3-slice-map/summarize.mjs $D --sites prototypes/dotnet-b/reports/3-slice-sites.md   # section 2 tables and the site list
node prototypes/dotnet-b/reports/3-slice-map/areas.mjs $D --functions           # section 3.1 (areas.json: selectors, tables, types, ratio)
node prototypes/dotnet-b/reports/3-slice-map/typecount.mjs $D/slice-union.json --list   # 37 types, 436 members
# this report: the narrative is reports/3-slice-map/report-template.md, the tables are the outputs above (summarize.mjs, areas.mjs --functions, waterfall.mjs saved as $D/summary.md, areas.md, waterfall.md):
python3 prototypes/dotnet-b/reports/3-slice-map/assemble.py prototypes/dotnet-b/reports/3-slice-map/report-template.md $D prototypes/dotnet-b/reports/3-slice-map.md
F=prototypes/dotnet-b/Fs.Kernel/Pyrogenic/PyrogenicKernel.cs; C=prototypes/dotnet-b/reports/3-slice-map/codelines.mjs
for r in "1 19" "22 111" "112 160" "161 306" "307 342" "343 446" "1 446"; do node $C $F $r; done   # the 1.73 sample: 22-111 + 161-342 + ~15 = 287
for r in "14 34" "35 74" "75 169" "170 213" "1 213"; do node $C src/atmosphere/pyrogenic.ts $r; done
node $C src/sim/params.ts 1 9999   # and the other params.ts, catalogue.ts, fuelRef.ts, hazard.ts: the "tables" column (35, 148, 343, 163, 96, 123, 123, 236, 124, 73)
# plan section 3 counts without tests:
for f in max abs min floor round cos exp sin sqrt hypot tan log ceil pow imul atan; do printf "%s=%s " $f "$(grep -rho "Math\.$f(" src/sim src/fire src/embers src/atmosphere src/terrain src/core --include=*.ts --exclude=*.test.ts --exclude-dir=testing | wc -l)"; done
```
Why-is-it-in queries: `slice.mjs --why 'file:Function'` prints the path from `Simulation.advance` to a function. The scripts read `src/` and write only to the scratch folder, except `--sites`.

**Limits of this analysis.** The call graph is static and by name for interface and override dispatch; a function reached only through a dynamic property name would be missed (none found: the string-key sites are constant tables). The sites are found by the TypeScript checker on types, so a `number` inferred as `any` would be missed (the code is `strict`). `typed-array store` counts see element assignments and `++`/`--` only (not `.set`/`.fill`, listed separately in the sites file). The ratio rests on one sample. Run-time counts per function come from `1-profile.md`, not from this report. Nothing in this report was run on the C# side.
