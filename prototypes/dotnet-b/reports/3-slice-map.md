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

| what is cut | lines reachable without cuts | lines left | removed |
|---|---|---|---|
| explain engine (src/explain/): insights, cards, text; never read back by the physics | 2345 | 0 | 2345 |
| snapshot, checkpoint, engine-info, stats, view and performance bookkeeping in src/sim/ (simulation.ts remainder, stats.ts, engineInfo.ts, perfStats.ts, fireWindPublish.ts) | 1902 | 728 | 1174 |
| user edits: fuel edits, brush polygons, wind-direction edits, datasets | 425 | 0 | 425 |
| ember statistics, overlays, checkpoint (src/embers/stats.ts and EmberModel members) | 2297 | 1902 | 395 |
| spread-driver attribution (src/fire/spread/attribution.ts) | 32 | 0 | 32 |
| moisture breakdown (explain callback) | 692 | 644 | 48 |
| everything else (mostly pulled in only through the removed code, e.g. checkpoint members of FireSpreadModel and Atmosphere, MoistureModel) | 9708 | 8988 | 720 |
| total | 17401 | 12262 | 5139 |

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

| Math function | static sites | needs |
|---|---|---|
| max | 216 | Math.Max |
| min | 143 | Math.Min |
| exp | 91 | FsMath.Exp |
| sqrt | 70 | Math.Sqrt |
| floor | 56 | Math.Floor (then FsConv if used as an index) |
| sin | 51 | FsMath.Sin |
| round | 51 | FsConv.Round (JS half up) |
| cos | 44 | FsMath.Cos |
| log | 43 | FsMath.Log |
| ceil | 31 | Math.Ceiling (then FsConv) |
| hypot | 29 | FsMath.Hypot |
| const:PI | 29 | constant |
| abs | 24 | Math.Abs |
| pow | 15 | FsMath.Pow |
| imul | 12 | FsConv.Imul |
| atan | 10 | FsMath.Atan |
| cbrt | 9 | FsMath.Cbrt |
| atan2 | 8 | FsMath.Atan2 |
| const:SQRT2 | 6 | constant |
| tan | 5 | FsMath.Tan |
| acos | 4 | FsMath.Acos |
| log2 | 1 | FsMath.Log2 |
| fround | 1 | FsConv.Fround |
| asin | 1 | FsMath.Asin |
| const:LN2 | 1 | constant |

total call sites (excluding constants): 915

FsMath (non-exact) sites: 311

`FsMath` needs, by function: `Exp`, `Log`, `Pow`, `Sin`, `Cos`, `Tan`, `Atan`, `Atan2`, `Acos`, `Asin`, `Cbrt`, `Hypot` (all 29 sites have two arguments: the three-argument overload is not needed) and `Log2` (one site, `fire/models/common.ts:38`). **`Sinh`, `Log10` and `Math.sign` do not occur in the slice** (they occur nowhere in the runtime closure either); `Math.trunc` does not occur. 58 of the 311 sites are in `terrain/solar.ts` (run every 600 s, not hot); the hot ones are `EmberModel.advance` (4 `pow`, 4 `exp`, 1 `cbrt`), `sampling.ts` (`sampleClass`, `natureTauBDensity`, `proposalMeanTauB`: `exp` and `log`), `slopeFactor` and `vestaMk2Eval`. Table of the same sites by file:

| file | total | FsMath | floor/ceil/trunc/round/sign/fround/imul | abs/sqrt/min/max |
|---|---|---|---|---|
| atmosphere/atmosphere.ts | 52 | 5 | 6 | 41 |
| atmosphere/base.ts | 47 | 8 | 7 | 32 |
| atmosphere/diagnosticWind.ts | 14 | 1 | 3 | 10 |
| atmosphere/dynamics.ts | 19 | 0 | 0 | 19 |
| atmosphere/grid.ts | 36 | 3 | 13 | 20 |
| atmosphere/massConsistent.ts | 10 | 4 | 0 | 6 |
| atmosphere/plume.ts | 22 | 4 | 0 | 18 |
| atmosphere/profile.ts | 24 | 9 | 1 | 14 |
| atmosphere/pyrogenic.ts | 17 | 2 | 4 | 11 |
| atmosphere/solver.ts | 4 | 0 | 2 | 2 |
| atmosphere/surface.ts | 7 | 7 | 0 | 0 |
| atmosphere/weatherInterp.ts | 1 | 0 | 1 | 0 |
| core/grid.ts | 16 | 0 | 5 | 11 |
| core/physics.ts | 12 | 5 | 0 | 7 |
| core/rng.ts | 9 | 3 | 3 | 3 |
| core/units.ts | 8 | 7 | 1 | 0 |
| embers/EmberModel.ts | 106 | 36 | 25 | 45 |
| embers/fuelInfo.ts | 1 | 0 | 0 | 1 |
| embers/physics.ts | 14 | 6 | 0 | 8 |
| embers/plume.ts | 14 | 1 | 11 | 2 |
| embers/sampling.ts | 39 | 26 | 3 | 10 |
| fire/models/common.ts | 13 | 13 | 0 | 0 |
| fire/models/grass.ts | 2 | 2 | 0 | 0 |
| fire/models/heath.ts | 7 | 6 | 0 | 1 |
| fire/models/kernel.ts | 3 | 3 | 0 | 0 |
| fire/models/pine.ts | 5 | 4 | 0 | 1 |
| fire/models/shape.ts | 3 | 3 | 0 | 0 |
| fire/models/vestaMk2.ts | 9 | 9 | 0 | 0 |
| fire/spread/FireSpreadModel.ts | 55 | 19 | 10 | 26 |
| fire/spread/geometry.ts | 6 | 3 | 0 | 3 |
| fire/spread/levelSet.ts | 13 | 0 | 1 | 12 |
| fire/spread/math.ts | 30 | 18 | 0 | 12 |
| fire/spread/params.ts | 2 | 0 | 0 | 2 |
| fire/terrainFeatures.ts | 48 | 12 | 24 | 12 |
| fuel/catalogue.ts | 2 | 0 | 2 | 0 |
| fuel/fuelMap.ts | 2 | 0 | 0 | 2 |
| fuel/hazard.ts | 1 | 0 | 0 | 1 |
| fuel/moisture/afdrs.ts | 3 | 2 | 0 | 1 |
| fuel/moisture/air.ts | 2 | 0 | 0 | 2 |
| fuel/moisture/availability.ts | 2 | 2 | 0 | 0 |
| fuel/moisture/drought.ts | 12 | 3 | 0 | 9 |
| fuel/moisture/fastMath.ts | 7 | 5 | 1 | 1 |
| fuel/moisture/fuelPhysics.ts | 16 | 9 | 0 | 7 |
| fuel/moisture/model.ts | 33 | 6 | 2 | 25 |
| fuel/moisture/night.ts | 2 | 0 | 0 | 2 |
| scenario/weather.ts | 2 | 0 | 0 | 2 |
| sim/simulation.ts | 39 | 2 | 14 | 23 |
| sim/stats.ts | 4 | 0 | 4 | 0 |
| terrain/analysis.ts | 23 | 5 | 6 | 12 |
| terrain/solar.ts | 97 | 58 | 2 | 37 |

The module-level initialisers call `FsMath` too and must go through it, because a one-bit difference in a table entry changes every draw that indexes it: `fuel/moisture/fastMath.ts:52-56` (`h ** 0.679`, `r ** 1.7`, `r ** 8`, 4 `exp`), the 4096-entry `NORMAL_TABLE` of `embers/sampling.ts:87-96` (`inverseNormalCdf`, `Math.sqrt`), `fire/models/fuelRef.ts:55-57`.

**Powers.** `**` and `Math.pow` are 35 + 15 = 50 sites; 12 are squares (`x ** 2`, becomes `x * x`), 23 are other exponents (constants 0.25, 1.3, 1.7, 3, 3.4, 4.3, 5, 5.25588, 0.679, 8; or variable) and need `FsMath.Pow`, with the 15 `Math.pow`: 38 `FsMath.Pow` sites. The plan's "42 `**` sites" (section 10.4) is the count over the closure's files; 35 are in reachable functions. The plan's "the standard tier's air solve makes 72,001 squares per step" is `Smagorinsky` in `atmosphere/dynamics.ts:244-281` (5 squares in the per-cell loop), not the elliptic solver.

| file:line | function | kind | text |
|---|---|---|---|
| atmosphere/atmosphere.ts:315 | sp | square | `Math.sin((Math.PI / 2) * ((z - zb) / P.spongeDepth)) ** 2` |
| atmosphere/dynamics.ts:244 | smagorinsky | square | `(P.smagCs * dx) ** 2` |
| atmosphere/dynamics.ts:276 | smagorinsky | square | `(uy + vx) ** 2` |
| atmosphere/dynamics.ts:276 | smagorinsky | square | `(uz + wx) ** 2` |
| atmosphere/dynamics.ts:276 | smagorinsky | square | `(vz + wy) ** 2` |
| atmosphere/dynamics.ts:281 | smagorinsky | square | `(P.smagCs * dz) ** 2` |
| atmosphere/grid.ts:87 | sum | variable | `r ** levels` |
| atmosphere/grid.ts:113 | canopyDrag | square | `(KAPPA_VK / Math.log(zEff / z0)) ** 2` |
| atmosphere/grid.ts:259 | buildAtmosGrid | variable | `r ** k` |
| atmosphere/massConsistent.ts:144 | blend | square | `(d / e.radius) ** 2` |
| atmosphere/plume.ts:30 | briggsRise | const 0.25 | `F ** 0.25` |
| atmosphere/plume.ts:30 | briggsRise | variable | `N ** -0.75` |
| atmosphere/plume.ts:208 | pyroFirepowerThreshold | square | `(zfcAGL / 1000) ** 2` |
| atmosphere/profile.ts:114 | buildProfile | variable | `(P.synthTopAGL / top[0]) ** P.synthExponent` |
| atmosphere/profile.ts:118 | buildProfile | variable | `(z / top[0]) ** P.synthExponent` |
| atmosphere/pyrogenic.ts:30 | Dst.constructor | square | `Math.sin((Math.PI * (p + 1)) / (2 * n)) ** 2` |
| atmosphere/solver.ts:798 | EllipticSolver.solve | variable | `(rel / first) ** (1 / it)` |
| atmosphere/solver.ts:851 | EllipticSolver.pcg | variable | `(rel / first) ** (1 / total)` |
| core/physics.ts:31 | pressureIsa | const 5.25588 | `(1 - 2.25577e-5 * zM) ** 5.25588` |
| core/physics.ts:33 | exner | variable | `(pHpa / 1000) ** RCP` |
| fuel/moisture/drought.ts:85 | rainRecencyX | const 1.3 | `nDays ** 1.3` |
| fuel/moisture/fuelPhysics.ts:19 | vanWagnerEd | const 0.679 | `h ** 0.679` |
| fuel/moisture/fuelPhysics.ts:34 | vanWagnerRate | const 1.7 | `r ** 1.7` |
| fuel/moisture/fuelPhysics.ts:170 | ignitionProbability | const 4.3 | `x ** 4.3` |
| terrain/solar.ts:81 | solarEphemeris | square | `Math.tan(eps / 2) ** 2` |
| terrain/solar.ts:99 | refraction | const 3 | `te ** 3` |
| terrain/solar.ts:99 | refraction | const 5 | `te ** 5` |
| terrain/solar.ts:192 | airMass | variable | `(96.07995 - z) ** -1.6364` |
| terrain/solar.ts:239 | cloudAttenuation | const 3.4 | `Math.min(1, Math.max(0, cloudCover / 100)) ** 3.4` |
| terrain/solar.ts:252 | erbsDecomposition | square | `kt ** 2` |
| terrain/solar.ts:252 | erbsDecomposition | const 3 | `kt ** 3` |
| terrain/solar.ts:252 | erbsDecomposition | const 4 | `kt ** 4` |
| fuel/moisture/fastMath.ts:52 | <module> | const 0.679 | `h ** 0.679` |
| fuel/moisture/fastMath.ts:55 | <module> | const 1.7 | `r ** 1.7` |
| fuel/moisture/fastMath.ts:56 | <module> | const 8 | `r ** 8` |

count: 35  squares: 12  other: 23

### 2.2 Float-to-integer conversions and typed-array stores (`FsConv`)

Typed-array stores in the slice, by array kind (stores of `Float64Array` need nothing; `Float32Array` stores round to float32 like a C# `(float)` cast and must keep float32 storage, because the TypeScript's state is float32 between steps, for example the 23 particle arrays of `EmberModel`):

| file | Float32 | Float64 | Int8 | Uint8 | Uint8Clamped | Int16 | Uint16 | Int32 | Uint32 |
|---|---|---|---|---|---|---|---|---|---|
| atmosphere/atmosphere.ts | 70 | 8 |  | 4 |  |  | 1 |  |  |
| atmosphere/base.ts | 40 | 2 |  |  |  |  |  | 4 |  |
| atmosphere/diagnosticWind.ts | 10 |  |  |  |  |  |  |  |  |
| atmosphere/dynamics.ts | 21 | 8 |  |  |  |  |  | 2 |  |
| atmosphere/grid.ts | 5 | 18 |  |  |  |  |  | 1 |  |
| atmosphere/massConsistent.ts | 10 |  |  |  |  |  |  |  |  |
| atmosphere/plume.ts |  | 17 |  |  |  |  |  |  |  |
| atmosphere/profile.ts | 14 | 11 |  |  |  |  |  |  |  |
| atmosphere/pyrogenic.ts | 2 | 13 |  | 1 |  |  |  |  |  |
| atmosphere/solver.ts | 19 | 40 |  |  |  |  |  | 8 |  |
| core/grid.ts | 2 |  |  |  |  |  |  |  |  |
| embers/EmberModel.ts | 103 | 34 |  | 20 |  |  |  | 6 | 1 |
| embers/plume.ts | 2 | 7 |  |  |  |  |  |  |  |
| embers/sampling.ts |  | 1 |  |  |  |  |  |  |  |
| fire/spread/FireSpreadModel.ts | 82 | 13 |  | 32 |  |  |  | 13 |  |
| fire/spread/fuelCache.ts | 16 |  |  | 8 |  |  | 1 |  |  |
| fire/spread/geometry.ts | 1 | 11 |  |  |  |  |  | 13 |  |
| fire/spread/levelSet.ts | 16 | 13 |  | 9 |  |  |  | 4 |  |
| fire/terrainFeatures.ts | 21 | 8 |  | 9 |  |  |  | 27 |  |
| fuel/moisture/fastMath.ts |  | 12 |  |  |  |  |  |  |  |
| fuel/moisture/model.ts | 37 | 5 |  | 2 |  |  |  | 1 |  |
| sim/simulation.ts | 1 | 1 |  | 1 |  |  |  |  |  |
| sim/stats.ts | 1 |  |  |  |  |  |  |  |  |
| terrain/analysis.ts | 31 |  |  | 7 |  |  |  | 5 |  |
| terrain/solar.ts | 7 | 4 |  | 1 |  |  |  | 3 |  |

totals: {"Float64Array":226,"Float32Array":511,"Uint16Array":2,"Uint8Array":94,"Int32Array":87,"Uint32Array":1}

- **No `Int16Array`, `Int8Array` or `Uint8ClampedArray` store exists in the slice** (`grep` shows them only in `src/sim/fireWindPublish.ts:33-34`, cut, in `core/airPack.ts` and `core/sliceRecording.ts`, not reachable, and in `codec.ts`, a byte copy). `FsConv`'s clamping and `Int16` wrapping (T4.1) are not needed by the slice; the T4.1 tests for them are harmless but not on the critical path.
- 131 of the 184 `Uint8Array`/`Int32Array`/`Uint16Array`/`Uint32Array` stores are not trivial literals, and every one stores an **integer-valued** quantity (cell indices, flags, counts, enum codes). Only one converts a float: `atmosphere/atmosphere.ts:332` (`this.bin[o] = Math.min(nBins - 1, Math.max(0, Math.floor(...)))`, a `Uint16Array`). In C# they are int/byte/ushort arrays and plain assignments; the conversion lives in the expression that computes the index.
- **Double-to-int truncations written `x | 0`** (truncation toward zero, not floor: `-0.3 | 0` is 0 while `Math.floor(-0.3)` is -1; this matters for positions west or south of a grid): 31 sites: `dynamics.ts:96,98,100,187,189,191`; `EmberModel.ts:1479,1480,1504,1685,1686,1728,1729,2012,2013`; `embers/plume.ts:189-191`; `embers/sampling.ts:101,131`; `fuel/moisture/model.ts:493-593` (10 sites, the look-up table index in `advance`); `fastMath.ts:15`. Another 6 are `(k / nx) | 0` on integers (`analysis.ts:284,294,321,353`, `solar.ts:370,428`): integer division in C#.
- `>>> 0` on `uint32` state (the generators): `core/rng.ts:8,12,15,52`, `embers/sampling.ts:19,22,25`, the inline copy in `EmberModel.advance` `:1602-1657`, `EmberModel.ts:651,2246`: use `uint` arithmetic (`unchecked`), not `FsConv`. `Math.imul`: 12 sites, all in these generators (`rng.ts:13-14`, `sampling.ts:23-24`, `EmberModel.ts:1603-1656` 8 sites).
- `Math.floor`/`ceil` sites (56 + 31) that end as an index or a count: each C# `(int)` of the result is a float-to-int cast the analyzer FS0001 will stop; audit set in `reports/3-slice-sites.md` ("Math.* calls"). Only 7 element-access expressions contain the rounding call inline (`grid.ts:354`, `units.ts:65`, `sampling.ts:101,131`, `EmberModel.ts:1605,1609,1621`); the rest go through a local.
- **`Math.round` (51 sites, JavaScript rounds halves toward +infinity) is exercised on exact halves in the gate scenarios:** `atmosphere/grid.ts:316,318` rounds `(fg.x0 + i * fg.cellSize - grid.x0) / dx` for a 30 m fire grid inside a 100 m air grid, which produces `.5` for some `i`; `core/grid.ts:41-42` (`cellAt`), `terrainFeatures.ts:587-588,882-883`, `EmberModel.ts:2028-2029`, `embers/plume.ts:151-154`. C#'s `Math.Round` (half to even) and `MidpointRounding.AwayFromZero` (half away from zero, wrong for negative halves) both differ; `FsConv.Round` only. The wall-clock-sized one is `weatherInterp.ts:24` (`Math.round(lerp(a.time, b.time, f))`, milliseconds near 1.7e12).
- `Math.fround`: one site (`terrain/analysis.ts:478`, applied before the `>= 360` wrap test: "359.99999999 would otherwise be stored as 360").

**Bit operations (ToInt32 / ToUint32), by file:**

total 190  `| 0` / `>>> 0` / `>> 0` style (right operand 0): 54  others (masks, shifts, xor): 136

| file | `x op 0` | other bit ops |
|---|---|---|
| atmosphere/atmosphere.ts | 0 | 4 |
| atmosphere/base.ts | 0 | 5 |
| atmosphere/diagnosticWind.ts | 0 | 4 |
| atmosphere/dynamics.ts | 6 | 0 |
| atmosphere/grid.ts | 0 | 1 |
| atmosphere/pyrogenic.ts | 0 | 2 |
| atmosphere/solver.ts | 0 | 3 |
| core/rng.ts | 4 | 9 |
| embers/EmberModel.ts | 19 | 67 |
| embers/fuelInfo.ts | 0 | 2 |
| embers/plume.ts | 3 | 0 |
| embers/sampling.ts | 5 | 11 |
| fire/models/kernel.ts | 0 | 7 |
| fire/spread/FireSpreadModel.ts | 0 | 3 |
| fire/spread/fuelCache.ts | 0 | 5 |
| fire/spread/levelSet.ts | 0 | 6 |
| fire/terrainFeatures.ts | 0 | 1 |
| fuel/fuelMap.ts | 0 | 3 |
| fuel/moisture/air.ts | 0 | 1 |
| fuel/moisture/fastMath.ts | 1 | 0 |
| fuel/moisture/model.ts | 10 | 0 |
| fuel/moisture/weather.ts | 0 | 1 |
| scenario/weather.ts | 0 | 1 |
| terrain/analysis.ts | 4 | 0 |
| terrain/solar.ts | 2 | 0 |

index expressions containing Math.floor/ceil/round/trunc or `| 0`: 7

sorts 15 Map/Set constructions 19 Map/Set iterations 6 Object.* key walks 5 string-key sites 26 number truthiness 99 NaN compares 0 number checks 94 Date 11 string/number formatting 20 rng calls 11 coercions 1

### 2.3 Order and tie-breaking

**Sorts (15).** V8's `Array.prototype.sort` is stable; `Array.Sort` in C# is not. Typed-array `.sort()` without a comparator is numeric ascending with NaN last; C# `Array.Sort(double[])` puts NaN first. Sites, and what each needs:

- atmosphere/atmosphere.ts:555 | Atmosphere.addFireHeat | `Array.from(cols).sort((a, b) => a - b)`
- atmosphere/base.ts:1002 | AtmosBase.medianColumn | `Array.from({ length: g.plane }, (_, c) => c).sort((a, b) => g.zs[a]! - g.zs[b]!)`
- atmosphere/grid.ts:353 | buildAtmosGrid | `Float32Array.from(terrain.elevation).sort()`
- atmosphere/profile.ts:107 | buildProfile | `samples.sort((a, b) => a[0] - b[0])`
- atmosphere/profile.ts:151 | buildProfile | `tSamples.sort((a, b) => a[0] - b[0])`
- embers/EmberModel.ts:1208 | EmberModel.buildVictims | `pri.sort((a, b) => this.age[a]! - this.age[b]! || b - a)`
- embers/EmberModel.ts:2083 | EmberModel.rebuildProfile | `pts.sort((a, b) => a[0] - b[0])`
- embers/sampling.ts:170 | medianTauB | `[...p.ribbonTauB.means].sort((a, b) => a - b)`
- fire/spread/levelSet.ts:191 | LevelSetCore.commitInserts | `this.band.subarray(0, this.bandCount).sort()`
- fire/terrainFeatures.ts:476 | subCellSlopeStats | `vals.subarray(a, b).sort()`
- fuel/moisture/air.ts:79 | medianOf | `Float64Array.from(a as ArrayLike<number>).filter(Number.isFinite).sort()`
- fuel/moisture/model.ts:863 | MoistureModel.seedRainHistory | reverse: `days.reverse()`
- fuel/moisture/model.ts:872 | MoistureModel.seedRainHistory | `this.rain.sort((a, b) => a.t - b.t)`
- sim/simulation.ts:455 | Simulation.constructor | `[...this.records.values()].sort(recordOrder)`
- sim/simulation.ts:938 | Simulation.applyDueRecords | `due.sort(recordOrder)`

- Comparators with possible ties and no tie-break: `base.ts:1002` (`medianColumn`: columns with equal terrain height keep index order), `profile.ts:107,151` and `EmberModel.ts:2083` (pressure-level samples by height), `fuel/moisture/model.ts:872` (rain by time). Port with an explicit index tie-break (or a stable sort).
- With a tie-break already: `EmberModel.ts:1208` (`age` then `b - a`), `records.ts:26` (`time` then `seq`), `atmosphere.ts:555` (unique ints).
- Typed sorts: `grid.ts:353` (`Float32Array.from(elevation).sort()`, then `sorted[Math.min(n - 1, Math.floor(0.9 * n))]`, a 90th percentile), `levelSet.ts:191` (an `Int32Array` band), `terrainFeatures.ts:476`, `air.ts:79` (`filter(Number.isFinite)` first). No NaN reaches them (elevation is sanitised, `air.ts` filters), but state it in the test.

**Maps and sets (19 constructions, 6 iterations).** Only these iterate:

- atmosphere/atmosphere.ts:554 | Atmosphere.addFireHeat | for-of Set: `cols`
- atmosphere/atmosphere.ts:555 | Atmosphere.addFireHeat | Array.from(Map|Set): `Array.from(cols)`
- sim/simulation.ts:455 | Simulation.constructor | Map.values: `this.records.values()`
- sim/simulation.ts:934 | Simulation.applyDueRecords | for-of MapIterator: `this.records.values()`
- sim/simulation.ts:934 | Simulation.applyDueRecords | Map.values: `this.records.values()`
- terrain/solar.ts:385 | castShadows | Map.keys: `cache.shadows.keys()`

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

- core/rng.ts:18 | Rng.range | `this.next()`
- core/rng.ts:26 | Rng.normal | `this.next()`
- core/rng.ts:27 | Rng.normal | `this.next()`
- core/rng.ts:37 | Rng.poisson | `this.normal()`
- core/rng.ts:43 | Rng.poisson | `this.next()`
- fire/spread/FireSpreadModel.ts:1207 | FireSpreadModel.updateVlsActivation | `this.rng.range(VP.periodMinS, VP.periodMaxS)`
- fire/spread/FireSpreadModel.ts:1504 | FireSpreadModel.breachDraw | `this.rng.next()`
- fire/spread/FireSpreadModel.ts:1954 | FireSpreadModel.rollDebris | `this.rng.poisson(lambda)`
- fire/spread/FireSpreadModel.ts:1976 | FireSpreadModel.rollDebris | `this.rng.next()`
- fire/spread/FireSpreadModel.ts:1981 | FireSpreadModel.rollDebris | `this.rng.next()`
- fire/spread/FireSpreadModel.ts:1984 | FireSpreadModel.rollDebris | `this.rng.range(DP.delayMinS, DP.delayMaxS)`

and the ember transport and emission draws that the `Rng`-typed search does not see because they go through `this.r` (`FastRng`) or the inline copy: `EmberModel.emit` `:629-630` (`this.r.poisson(dN / this.wC[c])` per active cell in `aCell` order and class order, then `this.r.next()` per particle), `spawn`/`sampleClass` (`sampling.ts`, 38 lines; `normal()` keeps a cached second variate, cleared by `syncIn`, `EmberModel.ts:2247`), `advance` (`:1602-1657`: two draws for the horizontal Ornstein-Uhlenbeck update when `su > 0`, one for the vertical when `sw > 0`, one for re-flaming when `reflame > 0 && age >= flameEnd`: **the number of draws per particle depends on branch conditions, so one wrong comparison shifts the stream for every later particle**), `processIgnitions`. The order of the active-cell list is the order of `fire.frontCells()` (`EmberModel.ts:516-530`) and of swap-removal (`removeActive`, `removeAt`): lists of cell indices must be kept in the same order, not as sets. Normal draws use `NORMAL_TABLE[(r.next() * 4096) | 0]` and `nt[... >>> 20]`.

## 3. Areas

### 3.1 Sizes and the ratio

New C# lines per area = ratio x TypeScript function lines + constant tables + types (members + 3 per type) + extra. **Ratio 1.7, from one measured sample:** `Fs.Kernel/Pyrogenic/PyrogenicKernel.cs` is 446 lines against `src/atmosphere/pyrogenic.ts` 213 (2.09x; 1.96x by code lines), but 5 SIMD and parallel forms are in it. The scalar-only subset (constructor and fields, `BuildDst`, `AnySource`, `ClearOutputs`, the six phases, `AccumRows` and `AccumAxpy`, one serial `Run`; lines 22-111, 161-342 and about 15 of 112-160) is 287 lines against the 4 reachable functions of the TypeScript, 166 lines: **1.73**. By code lines (blank and comment lines out): 231 against 185 for the whole file (1.25). I use the span ratio because the areas below are measured in span lines; a span ratio overstates for dense numeric code and understates for object-heavy code (`FireSpreadModel`, `EmberModel`, which need declared fields and records), so 1.7 is neither a floor nor a ceiling: at 1.35 the total is 20,000 lines, at 2.1 it is 29,000, and the areas that sit above 1,700 estimated lines (3, 4, 12, 14, 1) would pass 2,000 first. The measuring commands are at the end. The existing `PyrogenicKernel.cs` is reusable as it is for `PyrogenicPotential.solve` (saves about 280 lines in area 14: estimate 1,590 instead of 1,872).

Files and functions per area, with TypeScript span lines (functions nested in a listed function are not listed again, but their lines are inside its figure):

| area | needs | files | functions | TS function lines | tables | types | est. C# lines |
|---|---|---|---|---|---|---|---|
| A1 Shared types, decode, generator, weather series, drought and stable night, numeric helpers | - | 9 | 79 | 694 | 35 | 555 | 1770 |
| A2 Terrain: derived fields, solar geometry and insolation | A1 | 2 | 29 | 805 | 0 | 97 | 1466 |
| A3 Terrain features (ridges, drainage, crests) and the fuel map | A1, A2 | 4 | 50 | 817 | 312 | 66 | 1767 |
| A4 Dead-fuel moisture model, availability, AFDRS moisture, fuel parameters | A1, A2, A3 | 8 | 65 | 803 | 246 | 175 | 1786 |
| A5 Fire behaviour models, fuel reference rows and spread-direction maths | A1, A3 | 11 | 77 | 602 | 220 | 129 | 1372 |
| A6 Level set, distance transform, fuel cache, spread parameters | A1, A3, A5 | 5 | 27 | 704 | 163 | 17 | 1377 |
| A7 FireSpreadModel part 1: construction, masks, prepare, cell speed, step | A2, A3, A4, A5, A6 | 1 | 39 | 865 | 0 | 57 | 1528 |
| A8 FireSpreadModel part 2: ignition, arrival, front, heat, junctions, debris | A7 | 1 | 17 | 445 | 0 | 0 | 757 |
| A9 Embers, leaf modules: parameters, sampling, physics, plume field, cell fuel | A1, A3 | 5 | 42 | 453 | 343 | 65 | 1178 |
| A10 EmberModel part 1: construction, emission, weights, spawn, particle store | A9 | 1 | 30 | 718 | 0 | 78 | 1299 |
| A11 EmberModel part 2: transport loop, landing, ignitions, ground and profile lookups | A10 | 1 | 18 | 731 | 0 | 0 | 1243 |
| A12 Air, shared support: grid, profile, plume, wind interpolation, surface fluxes, mass-consistent wind | A1, A2, A3 | 7 | 53 | 978 | 148 | 133 | 1944 |
| A13 Air, elliptic (Poisson) solver | A1 | 1 | 25 | 700 | 0 | 38 | 1228 |
| A14 Air, common base and the fast tier: AtmosBase, DiagnosticWind, PyrogenicPotential | A12, A13, A2 | 3 | 60 | 1089 | 0 | 21 | 1872 |
| A15 Simulation: constructor, stepOnce, spin-up, records, coupling, host harness | A4, A8, A11, A14 | 2 | 34 | 727 | 0 | 14 | 1500 |
| A16 Standard tier air: Atmosphere (3-D Boussinesq step, sponge, projection, fire heat) | A14, A12, A13 | 1 | 39 | 890 | 0 | 0 | 1513 |
| A17 Standard tier air: 3-D dynamics operators (advection, diffusion, Smagorinsky, collocation) | A12, A13 | 1 | 8 | 395 | 0 | 7 | 679 |
| total | | | 692 | 12416 | 1467 | 1452 | 24279 |
entries in the union slice: 692  union span lines (whole slice, nested once): 12262

#### A1 Shared types, decode, generator, weather series, drought and stable night, numeric helpers
- `src/core/rng.ts` (36 lines): constructor 3, next 6, range 3, normal 6, poisson 12, get state 3, set state 3
- `src/core/grid.ts` (55 lines): makeGridSpec 5, cellCount 1, idx 1, cellX 1, cellY 1, inside 1, cellAt 5, sampleBilinear 16, boxBlur 24
- `src/core/units.ts` (29 lines): kmhToMs 1, msToKmh 1, msToMh 1, mhToMs 1, clamp 1, lerp 1, smoothstep 4, wrapDeg 1, angleDiffDeg 5, windToUV 4, uvToWind 5, vectorAzimuthDeg 1, azimuthToUnit 1, compassName 1, celsiusToKelvin 1
- `src/core/physics.ts` (73 lines): esat 1, rhFromTd 1, dewPointC 4, pressureIsa 1, exner 1, theta 1, airDensity 1, logistic 1, vpdKpa 1, lmstHour 1, initialStableNight 12, stableNightGate 6, nightRelax 8, stableNight 34
- `src/scenario/weather.ts` (131 lines): stampIndex 12, lin 2, windMix 6, profileMix 11, levelsMix 15, precipWindow 3, precipAt 8, clearnessAt 15, ghiAt 5, weatherAt 46, seriesSpan 4, seriesCovers 4
- `src/fuel/moisture/weather.ts` (70 lines): stampIndex 12, lin 2, seriesWeatherAt 36, clearnessAt 14, rainBefore 6
- `src/sim/records.ts` (1 lines): recordOrder 1
- `src/fuel/moisture/drought.ts` (84 lines): kbdiIncrement 5, kbdiPass 17, kbdiSeries 5, droughtXLimit 1, droughtFactorFromX 4, rainRecencyX 23, droughtFactor 10, droughtState 19
- `src/fuel/moisture/night.ts` (61 lines): hoursSinceSunrise 6, stableNightInputAt 12, integrateStableNight 26, horizonCrossing 10, spinUpStableNight 7
- src/sim/remote/codec.ts decode path: lines 34-90 (KINDS, NON_FINITE, limits, align8) and 198-294 (Decoder, decodeValue, decodeMessage) (154 lines, not in the TS closure of host.ts)

#### A2 Terrain: derived fields, solar geometry and insolation
- `src/terrain/analysis.ts` (438 lines): padOdd 33, slidingMinMax 42, sanitiseElevation 113, stdDev 11, clampNum 1, buildTerrain 153, classifyLandforms 76, terrainDerived 9
- `src/terrain/solar.ts` (367 lines): solarEphemeris 29, refraction 9, solarPosition 23, sunTimes 30, extraterrestrial 1, airMass 5, clearSkyIrradiance 19, cloudAttenuation 1, erbsDecomposition 13, forEachDigitalLine 32, cacheFor 8, castShadows 53, skyViewFactor 66, meanElevation 10, erbsDiffuseFraction 4, splitGhi 11, horizontalIrradiance 12, insolation 41

#### A3 Terrain features (ridges, drainage, crests) and the fuel map
- `src/fire/terrainFeatures.ts` (648 lines): clamp01 1, wrap360 1, constructor 4, push 14, pop 21, zAt 13, priorityFloodFill 48, d8Receivers 25, flowAccumulation 25, ascentPointers 25, stepDist 5, pathEnds 44, hornSlope 16, slopeAtScale 27, subCellSlopeStats 39, constructor 20, useSector 18, search 33, crestInto 20, crest 4, computeTerrainFeatures 245
- `src/fuel/catalogue.ts` (32 lines): L 1, total 4, bark 1, canopy 1, fhs 1, r 1, resolve 18, resolveClass 3, genericClassOf 1, fuelColour 1
- `src/fuel/fuelMap.ts` (101 lines): grassStateFromLoad 1, canopyHeightEffFor 14, ensureFuelArrays 12, makeCellFuelParams 10, fin 1, fuelParamsInto 48, fuelParamsAt 3, shortClass 5, cloneFuelMap 7
- `src/fuel/hazard.ts` (36 lines): polyline 13, interp 9, fhsFromLoad 6, barkHazardFromLoad 7, loadFromLitterDepthMm 1

#### A4 Dead-fuel moisture model, availability, AFDRS moisture, fuel parameters
- `src/fuel/moisture/model.ts` (644 lines): newUnits 29, constructor 32, refreshFuel 7, resolveCell 42, computeAvailability 7, addRain 11, rain48 6, hoursSinceRain 3, advance 235, baseForcing 33, update 25, initialise 94, calibrationDeviation 27, seedRainHistory 34, buildLut 46, copyLutToCells 10, localSolarDate 3
- `src/fuel/moisture/afdrs.ts` (39 lines): familyCode 1, familyName 1, isSummerHalf 1, isAfdrsNight 1, forestPeriod 5, forestMoisture 5, wetForestMoisture 1, heathMc1 1, rainMemoryMc2 5, grassMoisture 1, pineMoisture 1, afdrsMoistureCode 16
- `src/fuel/moisture/air.ts` (14 lines): lapseRate 7, isThermalBelt 1, medianOf 6
- `src/fuel/moisture/availability.ts` (31 lines): fuelAvailabilityMk2 1, wetForestC1 4, fuelAvailabilityWet 2, wetForestValidated 1, faBlendWeight 5, cellAvailability 18
- `src/fuel/moisture/fastMath.ts` (14 lines): lerpTable 8, esatFast 1, rateTempFast 1, expNegFast 1, fillExpTable 3
- `src/fuel/moisture/fuelPhysics.ts` (55 lines): vanWagnerEd 3, vanWagnerRate 5, referenceRate 3, beamTransmittance 4, diffuseTransmittance 3, longwaveCooling 4, litterWind 1, fuelTemperature 3, fuelHumidity 1, columnEmc 8, droughtDamping 2, gullyOffsetBase 2, gullyKbdiFade 2, interceptionCapacity 1, dryingClockRate 2, rainMemory 2, dewTerm 1, ignitionProbability 8
- `src/fuel/moisture/params.ts` (3 lines): moistureParams 3
- `src/fuel/params.ts` (3 lines): resolveFuelParams 3

#### A5 Fire behaviour models, fuel reference rows and spread-direction maths
- `src/fire/models/common.ts` (21 lines): powPos 1, byramIntensity 1, slopeFactor 11, slopeFactorCapped 1, wetC1OutOfDomain 1, flameHeightVesta 2, flameHeightShrub 1, flameHeightGrass 2, byramFlameLength 1
- `src/fire/models/factors.ts` (20 lines): createReferenceFactorsOut 1, referenceFactors 19
- `src/fire/models/grass.ts` (17 lines): grassPhiM 4, grassPhiC 1, grassStateFromLoad 2, grassWindRate 7, grassRos 3
- `src/fire/models/heath.ts` (18 lines): heathWaf 1, heathRefitRos 8, heathV1Damping 1, heathV1Ros 6, heathRos 2
- `src/fire/models/kernel.ts` (170 lines): createHeadKernelOut 1, zero 13, mk2Invalid 7, mk2ToOut 13, headRosKernel 79, createIntensityOut 1, intensityKernel 56
- `src/fire/models/pine.ts` (54 lines): pineLitterMoisture 1, pineFoliarMoisture 1, pineCriticalIntensity 4, pineStandWind 4, pineActiveCrownRos 2, createPineOut 4, pineSurfaceFuel 3, pineCfb 5, pineCore 30
- `src/fire/models/shape.ts` (22 lines): lbForest 10, lbGrass 6, lengthToBreadth 5, createEllipseCoeffs 1
- `src/fire/models/vestaMk2.ts` (65 lines): createMk2Out 1, mk2PhiM 6, understoreyHeight 4, sat 1, vestaMk2Eval 47, vestaMk2Core 6
- `src/fire/models/params.ts` (3 lines): getFireModelOptions 3
- `src/fire/spread/math.ts` (165 lines): azimuthOf 4, angleBetweenDeg 4, createHybridOut 1, hybridHead 38, finishHybrid 9, gullySteer 13, createEllipseSpeedsOut 1, ellipseSpeeds 27, offsetEllipseSpeed 6, logisticS 1, alignmentWeight 5, attachmentScore 2, amplifierGain 1, relaxEngagement 1, buildFraction 5, lineIgnitionOrigin 4, leeAlignment 1, vlsScore 10, leeSeparation 8, vlsLateralRate 6, junctionGeometric 1, junctionBoost 4, breachProbability 4, byramConvectiveNumber 9
- `src/fire/models/fuelRef.ts` (47 lines): rowFromInfo 11, fuelRow 8, grassWafFor 7, cellParamsFromRow 13, genericCellParams 8

#### A6 Level set, distance transform, fuel cache, spread parameters
- `src/fire/spread/levelSet.ts` (401 lines): constructor 40, get far 3, lowerPhi 17, commitInserts 11, evaluate 157, ensureScratch 13, advance 9, apply 35, reinit 116
- `src/fire/spread/geometry.ts` (160 lines): distToSegment 10, distToPolyline 11, pointInPolygon 11, signedDistToPolygon 9, polylineLength 6, constructor 8, compute 28, dt1 42, labelComponents4 35
- `src/fire/spread/fuelCache.ts` (123 lines): codeOf 4, constructor 31, refresh 47, familyOf 3, load 38
- `src/fire/spread/stateRegistry.ts` (8 lines): touched 4, full 4
- `src/fire/spread/params.ts` (12 lines): resolveSpreadParams 12

#### A7 FireSpreadModel part 1: construction, masks, prepare, cell speed, step
- `src/fire/spread/FireSpreadModel.ts` (865 lines): makePrep 6, constructor 154, initStatic 43, refreshStaticFuel 35, setTime 3, refreshMoistureCache 5, refreshMasks 48, prepare 29, step 20, minuteTasks 16, aux 8, heatRelease 3, crownShare 3, frontCells 3, firePowerW 3, headCells 39, syncClock 4, mountainOn 3, windFrom 11, computeCrests 23, ensureZoneCapacity 15, relabelZones 36, updateVlsActivation 57, upwindMaxIntensity 27, vlsRateAt 3, zeroSpeed 11, holding 3, computeCell 93, prepareCell 51, maxNbr 17, maxBurntNbr 18, originEstimate 25, breachDraw 12, hasBurntNbr 16, isValidated 7, factorsFor 15

#### A8 FireSpreadModel part 2: ignition, arrival, front, heat, junctions, debris
- `src/fire/spread/FireSpreadModel.ts` (445 lines): ignite 28, igniteAt 7, takeDebrisIgnitions 5, takeBreachEvents 5, recordArrival 68, originEstimateAtArrival 20, propagateOrigin 21, igniteGeometry 32, processPendingIgnitions 14, applyDueDebris 10, updateHeat 32, updateFront 71, refreshFrontDist 7, decayJunctions 18, detectJunctions 55, rollDebris 52

#### A9 Embers, leaf modules: parameters, sampling, physics, plume field, cell fuel
- `src/embers/params.ts` (33 lines): deepFreeze 7, emberParams 3, merge 11, isPlain 3, clone 9
- `src/embers/sampling.ts` (160 lines): constructor 3, next 6, range 3, normal 14, poisson 12, inverseNormalCdf 19, tableNormal 1, lnPdf 1, luPdf 1, natureTauBDensity 11, sampleNature 16, proposalMeanTauB 23, medianTauB 12, sampleClass 38
- `src/embers/physics.ts` (74 lines): albiniBurnoutTime 1, albiniFallHeight 1, powN1 7, floorRatio 10, fallIntegral 19, fallTime 20, burnoutFallCoefficient 1, lineBuoyancyFlux 3, briggsPlumeRise 9, heatPerArea 1, loadFromIntensity 2
- `src/embers/plume.ts` (161 lines): clear 3, push 10, grow 12, constructor 1, build 100, sample 35
- `src/embers/fuelInfo.ts` (25 lines): row 4, catalogueCellFuel 12, catalogueReceptivity 3, hasStringybark 3, hasRibbonBark 3

#### A10 EmberModel part 1: construction, emission, weights, spawn, particle store
- `src/embers/EmberModel.ts` (718 lines): constructor 62, setEnvironment 13, emit 141, step 33, cellFuel 3, addCell 52, ensureActive 35, removeActive 15, lifeEstimate 4, updateWeights 52, spawn 51, initParticle 31, acquireSlot 9, buildVictims 10, crestHeight 18, sourceClassCode 11, diagnosePlumeTop 19, loft 32, riseStep 48, allocParticles 32, removeAt 33, recordResidence 6, syncIn 4, syncOut 3, clamp01 1

#### A11 EmberModel part 2: transport loop, landing, ignitions, ground and profile lookups
- `src/embers/EmberModel.ts` (731 lines): advance 358, turbColumn 18, leeEddy 17, storeState 15, exitDomain 29, land 103, provenance 23, schedule 6, processIgnitions 39, ground 23, cellIndex 5, reliefAt 10, rhoAt 5, rebuildDensity 7, densAt 7, rebuildProfile 28, profileAt 24, profileMean 14

#### A12 Air, shared support: grid, profile, plume, wind interpolation, surface fluxes, mass-consistent wind
- `src/atmosphere/grid.ts` (311 lines): stretchRatio 13, atmosCellSize 3, canopyDrag 8, blockAverage 21, maxSlope 17, gaussPass 15, buildAtmosGrid 217, aglOf 1, levelFrac 16
- `src/atmosphere/profile.ts` (268 lines): sCoord 5, mixingRatio 4, pressureAt 3, buildProfile 160, profileWind 21, interpT 8, thetaRaw 1, thetaEnv 1, mixingRatioAt 1, dThetaEnvDz 3, logLawKappa 4, kappaTable 46, kappaLookup 7, alphaVRatio 4
- `src/atmosphere/plume.ts` (155 lines): cHaines 6, buoyancyFlux 1, briggsRise 8, plumeColumn 106, pyroFirepowerThreshold 34
- `src/atmosphere/weatherInterp.ts` (56 lines): lerpOpt 5, lerpWind 5, interpolateHour 46
- `src/atmosphere/surface.ts` (29 lines): netRadiation 6, sensibleHeatFlux 5, anabaticSpeed 4, katabaticSpeed 7, expLayerFraction 3, crownLayerFraction 4
- `src/atmosphere/massConsistent.ts` (144 lines): resolveWindEdits 3, setGroundW 12, facesToCentres 16, constructor 34, firstGuess 47, solve 13, configure 9, finish 10
- `src/atmosphere/index.ts` (15 lines): createAtmosphere 15

#### A13 Air, elliptic (Poisson) solver
- `src/atmosphere/solver.ts` (700 lines): allLateralActive 3, constructor 20, reconfigure 6, build 68, allocLevel 20, transfer 45, sideDirichlet 19, coarsen 54, finishLevel 27, gradient 100, divergence 55, applyFull 5, correct 9, relax 45, residual7 29, restrict 37, prolongAdd 26, vcycle 20, precondition 8, smoothOnly 8, solve 43, pcg 37, norm2 5, dot 5, removeMean 6

#### A14 Air, common base and the fast tier: AtmosBase, DiagnosticWind, PyrogenicPotential
- `src/atmosphere/base.ts` (739 lines): stampKey 2, median 32, constructor 66, setNightState 7, get spunUp 3, setAmbient 16, makeStamp 3, setTime 16, ensureSolved 11, deriveStamp 27, onStampDerived 1, onTimeChanged 1, get stampA 3, get stampB 3, get ambient 3, buildStencil 42, verticalStencil 20, sampleFire 41, sampleFire1 15, setSurfaceHeating 28, updateSlopeFlowSpeeds 21, accumulateHeating 4, onHeatingChanged 1, templateAirT 22, airAt 10, addAirAnomaly 1, checkFireGrid 3, blendBgFire 13, crestCells 11, fireWindTier 12, surfaceWindForFire 107, fireTotals 28, windAt 1, sampleTurb 21, sunNow 9, columnAt 6, groundAt 3, thetaAt 1, plume 7, commonDiagnostics 105, kappaNow 6, medianColumn 7
- `src/atmosphere/diagnosticWind.ts` (184 lines): constructor 16, get spunUp 3, wNight 6, fireWindTier 68, addFireHeat 20, step 3, maxStableDt 3, windAt 3, sampleBg 48, sample 3, thetaAt 7, diagnostics 4
- `src/atmosphere/pyrogenic.ts` (166 lines): constructor 11, constructor 19, solve 93, gradientToFire 43

#### A15 Simulation: constructor, stepOnce, spin-up, records, coupling, host harness
- `src/sim/simulation.ts` (694 lines): cloneProv 1, cloneSpot 1, constructor 146, spinUp 28, advance 11, snapshotStep 4, nextSnapshotAfter 4, addRecordRaw 5, addRecord 3, markApplied 4, applyDueRecords 9, applyRecord 38, weatherNow 9, updatePyrogenic 6, buildAtmosphere 21, buildEmbers 6, emberEnv 16, finishSpinUp 5, stepOnce 200, fireWinds 32, plumeTop 12, moistureCtx 24, u10Now 13, solarAt 11, windFn 1, turbFn 1, igniteFn 3, landingFn 47, applyPendingSpots 6, addSpot 24, clamp01 3
- `src/sim/stats.ts` (33 lines): frontRosBlocks 15, frontRosAt 18

#### A16 Standard tier air: Atmosphere (3-D Boussinesq step, sponge, projection, fire heat)
- `src/atmosphere/atmosphere.ts` (890 lines): constructor 184, get spunUp 3, onStampDerived 23, onTimeChanged 3, onHeatingChanged 3, updateNightFields 59, refreshBlend 28, updateMasks 23, initialiseState 11, addFireHeat 29, maxStableDt 6, stepLimit 5, get maxWindH 3, get maxWindV 3, step 206, sponge 24, project 35, divergenceOf 9, davies 38, bandMeans 10, meanThetaControl 10, fireWindTier 73, addAirAnomaly 13, sampleAt 32, sample 13, windAt 3, thetaAt 14, diagnostics 6, removeMeanF64 6, mulInto 3, subInPlace 3, addInPlace 3, nudge 6

#### A17 Standard tier air: 3-D dynamics operators (advection, diffusion, Smagorinsky, collocation)
- `src/atmosphere/dynamics.ts` (395 lines): collocate 56, displacements 54, advect 79, smagorinsky 71, diffuseH 39, columnMap 21, diffuseVLevels 42, diffuseVW 33

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
