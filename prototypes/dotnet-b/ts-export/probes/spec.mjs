/**
 * What the call recorders record: one row per boundary function, grouped by the areas of reports/3-slice-map.md section 3.3 (A1 to A17).
 * Data only; read by plugin.mjs (module functions are wrapped at build time), by install.ts (methods are wrapped on their prototypes at start)
 * and by run-probes.mjs (the report of which probe proves which area).
 *
 * A row is [area, file, name, opts]. `name` is `fn` for a module function (a top-level `function` or `const f = () =>` of `file`) or `Class.method`
 * for a method. Options (see ProbeOpts in core.ts): first / stride / max (which calls of a window are recorded), raw (calls per window that also
 * write a raw codec frame), rawMaxBytes, state ('own', 'fire', 'ember', 'atm', 'moist' or field names: a digest of `this` before and after),
 * skipArgs, seq (the call goes into the in-window call sequence), label (draw label).
 * Windows: `init` (the constructor, the t0 snapshot), `spin` (spinUp), `w0` (steps starting before t = 120 s), `w600` (steps starting in [595, 625) s: the
 * 600 s moisture update), `w900` (steps starting in [880, 960) s). Raw frames are written in init, spin, w0 and w900 unless a row says `rawIn`.
 * A probe whose function is never called in a scenario has count 0 there; the index says so.
 */
const STEP = { first: 40, seq: true };
const ONCE = { first: 8 };
const HOT = { first: 10, stride: 997, max: 30 };
const MID = { first: 16, stride: 97, max: 30 };
const MB = 1024 * 1024;
/** The state of a MoistureModel that an update reads and writes (per-cell arrays and the scalars and rain list). */
const MOIST = ['field', 'afdrs', 'anomaly', 'fuelTemp', 'airT', 'airRH', 'availability', 'zS', 'tLastRain', 'kbdi', 'df', 'lastTime', 'initialised', 'airOffsetT', 'airOffsetTd', 'rain'];
/** What an EllipticSolver's operators are built from (its grid is the A12 grid). */
const ELL = ['Rh', 'Rv', 'masks', 'singular'];

export const SPEC = [
  // ── A1 shared types, decode, generator, weather series, drought and stable night ─────────────────────────────────────────────
  ['A1', 'src/scenario/weather.ts', 'weatherAt', { ...MID, raw: 2 }],
  ['A1', 'src/scenario/weather.ts', 'ghiAt', MID],
  ['A1', 'src/scenario/weather.ts', 'clearnessAt', MID],
  ['A1', 'src/fuel/moisture/weather.ts', 'seriesWeatherAt', { ...MID, raw: 2 }],
  ['A1', 'src/fuel/moisture/weather.ts', 'rainBefore', MID],
  ['A1', 'src/core/physics.ts', 'stableNight', { ...STEP, raw: 2, seq: false }],
  ['A1', 'src/core/physics.ts', 'initialStableNight', { ...ONCE, raw: 1 }],
  ['A1', 'src/fuel/moisture/drought.ts', 'droughtState', { ...ONCE, raw: 1 }],
  ['A1', 'src/fuel/moisture/drought.ts', 'droughtFactor', ONCE],
  ['A1', 'src/fuel/moisture/drought.ts', 'kbdiSeries', { ...ONCE, raw: 1 }],
  ['A1', 'src/fuel/moisture/night.ts', 'spinUpStableNight', { ...ONCE, raw: 1 }],
  ['A1', 'src/fuel/moisture/night.ts', 'stableNightInputAt', { ...MID, raw: 2 }],

  // ── A2 terrain derived fields, solar geometry, insolation ───────────────────────────────────────────────────────────────────
  ['A2', 'src/terrain/analysis.ts', 'buildTerrain', { ...ONCE, raw: 1, rawMaxBytes: 32 * MB }],
  ['A2', 'src/terrain/analysis.ts', 'terrainDerived', { ...ONCE, raw: 1, rawMaxBytes: 32 * MB }],
  ['A2', 'src/terrain/analysis.ts', 'sanitiseElevation', { ...ONCE, raw: 1, rawMaxBytes: 32 * MB }],
  ['A2', 'src/terrain/analysis.ts', 'classifyLandforms', { ...ONCE, raw: 1, rawMaxBytes: 32 * MB }],
  ['A2', 'src/terrain/solar.ts', 'solarPosition', { ...MID, raw: 2 }],
  ['A2', 'src/terrain/solar.ts', 'sunTimes', ONCE],
  ['A2', 'src/terrain/solar.ts', 'insolation', { first: 6, raw: 1, rawMaxBytes: 16 * MB }],
  ['A2', 'src/terrain/solar.ts', 'castShadows', { first: 6, raw: 1, rawMaxBytes: 16 * MB }],
  ['A2', 'src/terrain/solar.ts', 'skyViewFactor', { ...ONCE, raw: 1, rawMaxBytes: 16 * MB }],

  // ── A3 terrain features and the fuel map ──────────────────────────────────────────────────────────────────────────────────────
  ['A3', 'src/fire/terrainFeatures.ts', 'computeTerrainFeatures', { ...ONCE, raw: 1, rawMaxBytes: 48 * MB }],
  ['A3', 'src/fuel/fuelMap.ts', 'fuelParamsInto', { first: 10, stride: 1999, max: 30, raw: 3, rawMaxBytes: 16 * MB }],
  ['A3', 'src/fuel/fuelMap.ts', 'ensureFuelArrays', ONCE],
  ['A3', 'src/fuel/fuelMap.ts', 'cloneFuelMap', ONCE],
  ['A3', 'src/fuel/hazard.ts', 'fhsFromLoad', HOT],
  ['A3', 'src/fuel/hazard.ts', 'barkHazardFromLoad', HOT],
  // TerrainFeaturesImpl is not exported: its prototype is taken from the first Simulation's `features`
  ['A3', 'src/fire/terrainFeatures.ts', 'TerrainFeaturesImpl.crest', { first: 12, stride: 97, max: 30, raw: 3 }],
  ['A3', 'src/fire/terrainFeatures.ts', 'TerrainFeaturesImpl.crestInto', { first: 12, stride: 97, max: 30 }],

  // ── A4 dead-fuel moisture, availability, AFDRS moisture ───────────────────────────────────────────────────────────────
  ['A4', 'src/fuel/moisture/model.ts', 'MoistureModel.initialise', { ...ONCE, state: MOIST, raw: 1, rawMaxBytes: 32 * MB }],
  ['A4', 'src/fuel/moisture/model.ts', 'MoistureModel.update', { first: 4, state: MOIST, raw: 3, rawIn: ['w0', 'w600', 'w900'], rawMaxBytes: 32 * MB, seq: true }],
  ['A4', 'src/fuel/moisture/model.ts', 'MoistureModel.advance', { first: 4, state: MOIST, raw: 1, rawIn: ['w0', 'w600'], rawMaxBytes: 32 * MB }],
  ['A4', 'src/fuel/moisture/model.ts', 'MoistureModel.buildLut', { ...ONCE, state: MOIST }],
  ['A4', 'src/fuel/moisture/model.ts', 'MoistureModel.seedRainHistory', { ...ONCE, state: MOIST }],
  ['A4', 'src/fuel/moisture/model.ts', 'MoistureModel.computeAvailability', { first: 4, state: MOIST }],
  ['A4', 'src/fuel/moisture/afdrs.ts', 'afdrsMoistureCode', HOT],
  ['A4', 'src/fuel/moisture/availability.ts', 'cellAvailability', HOT],

  // ── A5 fire behaviour models and spread-direction maths ─────────────────────────────────────────────────────────────────
  ['A5', 'src/fire/models/kernel.ts', 'headRosKernel', { ...HOT, raw: 2 }],
  ['A5', 'src/fire/models/kernel.ts', 'intensityKernel', { ...HOT, raw: 2 }],
  ['A5', 'src/fire/models/vestaMk2.ts', 'vestaMk2Eval', { ...HOT, raw: 1 }],
  ['A5', 'src/fire/models/pine.ts', 'pineCore', { ...HOT, raw: 1 }],
  ['A5', 'src/fire/models/grass.ts', 'grassRos', HOT],
  ['A5', 'src/fire/models/heath.ts', 'heathRos', HOT],
  ['A5', 'src/fire/models/shape.ts', 'lengthToBreadth', HOT],
  ['A5', 'src/fire/models/factors.ts', 'referenceFactors', { ...HOT, raw: 1 }],
  ['A5', 'src/fire/models/fuelRef.ts', 'fuelRow', HOT],
  ['A5', 'src/fire/models/fuelRef.ts', 'cellParamsFromRow', HOT],
  ['A5', 'src/fire/spread/math.ts', 'hybridHead', { ...HOT, raw: 2 }],
  ['A5', 'src/fire/spread/math.ts', 'ellipseSpeeds', { ...HOT, raw: 2 }],
  ['A5', 'src/fire/spread/math.ts', 'leeSeparation', HOT],
  ['A5', 'src/fire/spread/math.ts', 'vlsScore', HOT],
  ['A5', 'src/fire/spread/math.ts', 'junctionBoost', HOT],
  ['A5', 'src/fire/spread/math.ts', 'breachProbability', HOT],
  ['A5', 'src/fire/spread/math.ts', 'gullySteer', HOT],
  ['A5', 'src/fire/spread/math.ts', 'byramConvectiveNumber', HOT],
  ['A5', 'src/fire/spread/math.ts', 'offsetEllipseSpeed', HOT],
  ['A5', 'src/fire/spread/math.ts', 'vlsLateralRate', HOT],
  ['A5', 'src/fire/spread/math.ts', 'buildFraction', HOT],

  // ── A6 level set, distance transform, fuel cache ────────────────────────────────────────────────────────────────────────────
  ['A6', 'src/fire/spread/levelSet.ts', 'LevelSetCore.evaluate', { first: 12, state: 'own', raw: 1, rawMaxBytes: 16 * MB }],
  ['A6', 'src/fire/spread/levelSet.ts', 'LevelSetCore.reinit', { first: 12, state: 'own', raw: 1, rawMaxBytes: 16 * MB }],
  ['A6', 'src/fire/spread/levelSet.ts', 'LevelSetCore.advance', { first: 40, state: 'own', raw: 1, rawMaxBytes: 16 * MB }],
  ['A6', 'src/fire/spread/levelSet.ts', 'LevelSetCore.apply', { first: 40, state: 'own' }],
  ['A6', 'src/fire/spread/levelSet.ts', 'LevelSetCore.commitInserts', { first: 40, state: 'own' }],
  ['A6', 'src/fire/spread/levelSet.ts', 'LevelSetCore.lowerPhi', HOT],
  ['A6', 'src/fire/spread/geometry.ts', 'DistanceTransform.compute', { first: 8, raw: 2, rawMaxBytes: 16 * MB }],
  ['A6', 'src/fire/spread/geometry.ts', 'labelComponents4', { first: 8, raw: 1 }],
  ['A6', 'src/fire/spread/fuelCache.ts', 'FuelCache.refresh', { ...HOT, state: 'own' }],
  ['A6', 'src/fire/spread/fuelCache.ts', 'FuelCache.load', { ...HOT, raw: 2 }],

  // ── A7 FireSpreadModel part 1 (the fire step) ──────────────────────────────────────────────────────────────────────────
  ['A7', 'src/fire/spread/FireSpreadModel.ts', 'FireSpreadModel.prepare', { ...STEP, state: 'fire', raw: 1, rawMaxBytes: 32 * MB }],
  ['A7', 'src/fire/spread/FireSpreadModel.ts', 'FireSpreadModel.step', { ...STEP, state: 'fire', raw: 1, rawMaxBytes: 32 * MB }],
  ['A7', 'src/fire/spread/FireSpreadModel.ts', 'FireSpreadModel.refreshMasks', { first: 12, state: 'fire', seq: true }],
  ['A7', 'src/fire/spread/FireSpreadModel.ts', 'FireSpreadModel.refreshMoistureCache', { first: 12, state: 'fire', seq: true }],
  ['A7', 'src/fire/spread/FireSpreadModel.ts', 'FireSpreadModel.minuteTasks', { first: 12, state: 'fire', seq: true }],
  ['A7', 'src/fire/spread/FireSpreadModel.ts', 'FireSpreadModel.headCells', { first: 40 }],
  ['A7', 'src/fire/spread/FireSpreadModel.ts', 'FireSpreadModel.computeCrests', { first: 12 }],
  ['A7', 'src/fire/spread/FireSpreadModel.ts', 'FireSpreadModel.relabelZones', { first: 12 }],
  ['A7', 'src/fire/spread/FireSpreadModel.ts', 'FireSpreadModel.updateVlsActivation', { first: 40, label: 'updateVlsActivation' }],
  ['A7', 'src/fire/spread/FireSpreadModel.ts', 'FireSpreadModel.computeCell', { ...HOT, raw: 1 }],
  ['A7', 'src/fire/spread/FireSpreadModel.ts', 'FireSpreadModel.prepareCell', { ...HOT, raw: 1 }],

  // ── A8 FireSpreadModel part 2 (ignition, arrival, front, heat, junctions, debris) ────────────────────────────────────
  ['A8', 'src/fire/spread/FireSpreadModel.ts', 'FireSpreadModel.ignite', { first: 8, state: 'fire' }],
  ['A8', 'src/fire/spread/FireSpreadModel.ts', 'FireSpreadModel.igniteAt', { first: 8, state: 'fire' }],
  ['A8', 'src/fire/spread/FireSpreadModel.ts', 'FireSpreadModel.igniteGeometry', { first: 8 }],
  ['A8', 'src/fire/spread/FireSpreadModel.ts', 'FireSpreadModel.recordArrival', { ...MID, raw: 1 }],
  ['A8', 'src/fire/spread/FireSpreadModel.ts', 'FireSpreadModel.updateFront', { first: 40, state: 'fire' }],
  ['A8', 'src/fire/spread/FireSpreadModel.ts', 'FireSpreadModel.updateHeat', { first: 40 }],
  ['A8', 'src/fire/spread/FireSpreadModel.ts', 'FireSpreadModel.detectJunctions', { first: 12 }],
  ['A8', 'src/fire/spread/FireSpreadModel.ts', 'FireSpreadModel.rollDebris', { first: 40, label: 'rollDebris' }],
  ['A8', 'src/fire/spread/FireSpreadModel.ts', 'FireSpreadModel.breachDraw', { ...MID, label: 'breachDraw' }],
  ['A8', 'src/fire/spread/FireSpreadModel.ts', 'FireSpreadModel.processPendingIgnitions', { first: 40 }],
  ['A8', 'src/fire/spread/FireSpreadModel.ts', 'FireSpreadModel.applyDueDebris', { first: 40 }],
  ['A8', 'src/fire/spread/FireSpreadModel.ts', 'FireSpreadModel.propagateOrigin', MID],
  ['A8', 'src/fire/spread/FireSpreadModel.ts', 'FireSpreadModel.takeDebrisIgnitions', { first: 40 }],

  // ── A9 embers, leaf modules ───────────────────────────────────────────────────────────────────────────────────────────────────
  ['A9', 'src/embers/sampling.ts', 'sampleClass', { first: 12, stride: 211, max: 30, raw: 3, label: 'sampleClass' }],
  ['A9', 'src/embers/sampling.ts', 'sampleNature', { ...HOT, label: 'sampleNature' }],
  ['A9', 'src/embers/physics.ts', 'fallTime', HOT],
  ['A9', 'src/embers/physics.ts', 'fallIntegral', HOT],
  ['A9', 'src/embers/physics.ts', 'briggsPlumeRise', MID],
  ['A9', 'src/embers/physics.ts', 'lineBuoyancyFlux', MID],
  ['A9', 'src/embers/physics.ts', 'loadFromIntensity', MID],
  ['A9', 'src/embers/physics.ts', 'albiniFallHeight', MID],
  ['A9', 'src/embers/fuelInfo.ts', 'catalogueCellFuel', MID],
  ['A9', 'src/embers/plume.ts', 'PlumeField.build', { first: 6, state: 'own', raw: 1, rawMaxBytes: 16 * MB }],
  ['A9', 'src/embers/plume.ts', 'PlumeField.sample', HOT],

  // ── A10 EmberModel part 1 (construction, emission, weights, spawn) ───────────────────────────────────────────────────
  ['A10', 'src/embers/EmberModel.ts', 'EmberModel.emit', { first: 40, state: 'ember', raw: 14, rawMaxBytes: 32 * MB, label: 'emit', seq: true }],
  ['A10', 'src/embers/EmberModel.ts', 'EmberModel.step', { first: 40, state: 'ember', raw: 3, rawMaxBytes: 32 * MB, seq: true }],
  ['A10', 'src/embers/EmberModel.ts', 'EmberModel.updateWeights', { first: 40, label: 'updateWeights' }],
  ['A10', 'src/embers/EmberModel.ts', 'EmberModel.addCell', MID],
  ['A10', 'src/embers/EmberModel.ts', 'EmberModel.spawn', { first: 12, stride: 211, max: 30, label: 'spawn' }],
  ['A10', 'src/embers/EmberModel.ts', 'EmberModel.initParticle', { first: 12, stride: 211, max: 30, raw: 2 }],
  ['A10', 'src/embers/EmberModel.ts', 'EmberModel.loft', { first: 12, stride: 211, max: 30, raw: 2 }],
  ['A10', 'src/embers/EmberModel.ts', 'EmberModel.riseStep', { first: 12, stride: 211, max: 30 }],
  ['A10', 'src/embers/EmberModel.ts', 'EmberModel.removeAt', { first: 12, stride: 211, max: 30 }],
  ['A10', 'src/embers/EmberModel.ts', 'EmberModel.buildVictims', { first: 12 }],
  ['A10', 'src/embers/EmberModel.ts', 'EmberModel.diagnosePlumeTop', { first: 12 }],
  ['A10', 'src/embers/EmberModel.ts', 'EmberModel.setEnvironment', { first: 12, seq: true, raw: 3, rawMaxBytes: 32 * MB }],

  // ── A11 EmberModel part 2 (transport, landing, ignitions) ───────────────────────────────────────────────────────────
  ['A11', 'src/embers/EmberModel.ts', 'EmberModel.advance', { first: 12, stride: 499, max: 30, raw: 2, label: 'advance', skipArgs: [3, 4, 5] }],
  ['A11', 'src/embers/EmberModel.ts', 'EmberModel.land', { first: 12, stride: 29, max: 30, raw: 2, skipArgs: [7], label: 'land' }],
  ['A11', 'src/embers/EmberModel.ts', 'EmberModel.exitDomain', { first: 12, skipArgs: [5] }],
  ['A11', 'src/embers/EmberModel.ts', 'EmberModel.processIgnitions', { first: 40, skipArgs: [1, 2] }],
  ['A11', 'src/embers/EmberModel.ts', 'EmberModel.turbColumn', { ...HOT, skipArgs: [2] }],
  ['A11', 'src/embers/EmberModel.ts', 'EmberModel.leeEddy', { ...HOT, skipArgs: [7] }],
  ['A11', 'src/embers/EmberModel.ts', 'EmberModel.profileAt', HOT],
  ['A11', 'src/embers/EmberModel.ts', 'EmberModel.rebuildProfile', { first: 12 }],
  ['A11', 'src/embers/EmberModel.ts', 'EmberModel.storeState', HOT],
  ['A11', 'src/embers/EmberModel.ts', 'EmberModel.ground', HOT],
  ['A11', 'src/embers/EmberModel.ts', 'EmberModel.provenance', { first: 12, stride: 29, max: 30 }],
  ['A11', 'src/embers/EmberModel.ts', 'EmberModel.recordResidence', HOT],

  // ── A12 air: grid, profile, plume, wind interpolation, surface fluxes, mass-consistent wind ───────────────────────
  ['A12', 'src/atmosphere/grid.ts', 'buildAtmosGrid', { ...ONCE, raw: 1, rawMaxBytes: 64 * MB }],
  ['A12', 'src/atmosphere/grid.ts', 'blockAverage', { ...ONCE, raw: 1, rawMaxBytes: 32 * MB }],
  ['A12', 'src/atmosphere/grid.ts', 'canopyDrag', HOT],
  ['A12', 'src/atmosphere/grid.ts', 'levelFrac', HOT],
  ['A12', 'src/atmosphere/profile.ts', 'buildProfile', { first: 6, stride: 3, max: 12, raw: 2, rawMaxBytes: 8 * MB }],
  ['A12', 'src/atmosphere/profile.ts', 'profileWind', HOT],
  ['A12', 'src/atmosphere/profile.ts', 'kappaTable', { first: 6, raw: 1 }],
  ['A12', 'src/atmosphere/profile.ts', 'kappaLookup', HOT],
  ['A12', 'src/atmosphere/plume.ts', 'plumeColumn', { ...MID, raw: 2 }],
  ['A12', 'src/atmosphere/plume.ts', 'pyroFirepowerThreshold', MID],
  ['A12', 'src/atmosphere/plume.ts', 'briggsRise', MID],
  ['A12', 'src/atmosphere/plume.ts', 'cHaines', MID],
  ['A12', 'src/atmosphere/weatherInterp.ts', 'interpolateHour', { ...MID, raw: 2 }],
  ['A12', 'src/atmosphere/surface.ts', 'netRadiation', MID],
  ['A12', 'src/atmosphere/surface.ts', 'sensibleHeatFlux', MID],
  ['A12', 'src/atmosphere/surface.ts', 'anabaticSpeed', MID],
  ['A12', 'src/atmosphere/surface.ts', 'katabaticSpeed', MID],
  ['A12', 'src/atmosphere/massConsistent.ts', 'MassConsistentSolver.solve', { first: 6, state: 'own', raw: 1, rawMaxBytes: 32 * MB }],
  ['A12', 'src/atmosphere/massConsistent.ts', 'MassConsistentSolver.firstGuess', { first: 6, raw: 1, rawMaxBytes: 32 * MB }],
  ['A12', 'src/atmosphere/massConsistent.ts', 'MassConsistentSolver.configure', { first: 6 }],
  ['A12', 'src/atmosphere/massConsistent.ts', 'MassConsistentSolver.finish', { first: 6, raw: 1, rawMaxBytes: 32 * MB }],
  ['A12', 'src/atmosphere/massConsistent.ts', 'facesToCentres', { first: 6, raw: 1, rawMaxBytes: 32 * MB }],
  ['A12', 'src/atmosphere/massConsistent.ts', 'setGroundW', { first: 6 }],

  // ── A13 air: the elliptic solver ───────────────────────────────────────────────────────────────────────────────────────────────
  ['A13', 'src/atmosphere/solver.ts', 'EllipticSolver.solve', { first: 6, stride: 7, max: 20, state: ELL, raw: 2, rawMaxBytes: 32 * MB }],
  ['A13', 'src/atmosphere/solver.ts', 'EllipticSolver.pcg', { first: 6, stride: 7, max: 20, state: ELL, raw: 1, rawMaxBytes: 32 * MB }],
  ['A13', 'src/atmosphere/solver.ts', 'EllipticSolver.vcycle', { first: 6, stride: 53, max: 20 }],
  ['A13', 'src/atmosphere/solver.ts', 'EllipticSolver.build', { first: 6, state: ELL, raw: 2, rawMaxBytes: 32 * MB }],
  ['A13', 'src/atmosphere/solver.ts', 'EllipticSolver.gradient', { first: 6, stride: 7, max: 20, raw: 1, rawMaxBytes: 32 * MB }],
  ['A13', 'src/atmosphere/solver.ts', 'EllipticSolver.divergence', { first: 6, stride: 7, max: 20, raw: 1, rawMaxBytes: 32 * MB }],
  ['A13', 'src/atmosphere/solver.ts', 'EllipticSolver.relax', { first: 6, stride: 97, max: 20 }],
  ['A13', 'src/atmosphere/solver.ts', 'EllipticSolver.residual7', { first: 6, stride: 97, max: 20 }],
  ['A13', 'src/atmosphere/solver.ts', 'EllipticSolver.reconfigure', { first: 6 }],

  // ── A14 air: common base and the fast tier (AtmosBase, DiagnosticWind, PyrogenicPotential) ────────────────────────
  ['A14', 'src/atmosphere/base.ts', 'AtmosBase.setAmbient', { first: 12, seq: true }],
  ['A14', 'src/atmosphere/base.ts', 'AtmosBase.setTime', { first: 40, seq: true }],
  ['A14', 'src/atmosphere/base.ts', 'AtmosBase.setNightState', { first: 40, seq: true }],
  ['A14', 'src/atmosphere/base.ts', 'AtmosBase.setSurfaceHeating', { first: 12, seq: true, raw: 2, rawMaxBytes: 16 * MB }],
  ['A14', 'src/atmosphere/base.ts', 'AtmosBase.ensureSolved', { first: 6 }],
  ['A14', 'src/atmosphere/base.ts', 'AtmosBase.deriveStamp', { first: 6 }],
  ['A14', 'src/atmosphere/base.ts', 'AtmosBase.updateSlopeFlowSpeeds', { first: 12 }],
  ['A14', 'src/atmosphere/base.ts', 'AtmosBase.accumulateHeating', { first: 40 }],
  ['A14', 'src/atmosphere/base.ts', 'AtmosBase.surfaceWindForFire', { first: 40, seq: true, raw: 40, rawMaxBytes: 16 * MB }],
  ['A14', 'src/atmosphere/base.ts', 'AtmosBase.airAt', { first: 40, seq: true, raw: 1 }],
  ['A14', 'src/atmosphere/base.ts', 'AtmosBase.blendBgFire', { first: 40 }],
  ['A14', 'src/atmosphere/base.ts', 'AtmosBase.sampleFire', { ...HOT, raw: 1 }],
  ['A14', 'src/atmosphere/base.ts', 'AtmosBase.sampleFire1', HOT],
  ['A14', 'src/atmosphere/base.ts', 'AtmosBase.fireTotals', { first: 40 }],
  ['A14', 'src/atmosphere/base.ts', 'AtmosBase.commonDiagnostics', { first: 12, raw: 2 }],
  ['A14', 'src/atmosphere/base.ts', 'AtmosBase.sampleTurb', { ...HOT, skipArgs: [3] }],
  ['A14', 'src/atmosphere/base.ts', 'AtmosBase.medianColumn', { first: 12 }],
  ['A14', 'src/atmosphere/base.ts', 'AtmosBase.templateAirT', { first: 12 }],
  ['A14', 'src/atmosphere/base.ts', 'AtmosBase.columnAt', HOT],
  ['A14', 'src/atmosphere/diagnosticWind.ts', 'DiagnosticWind.step', { first: 40, seq: true }],
  ['A14', 'src/atmosphere/diagnosticWind.ts', 'DiagnosticWind.addFireHeat', { first: 40, seq: true, raw: 40 }],
  ['A14', 'src/atmosphere/diagnosticWind.ts', 'DiagnosticWind.fireWindTier', { first: 40, raw: 1, rawMaxBytes: 16 * MB }],
  ['A14', 'src/atmosphere/diagnosticWind.ts', 'DiagnosticWind.sample', HOT],
  ['A14', 'src/atmosphere/diagnosticWind.ts', 'DiagnosticWind.sampleBg', HOT],
  ['A14', 'src/atmosphere/diagnosticWind.ts', 'DiagnosticWind.diagnostics', { first: 12 }],
  ['A14', 'src/atmosphere/diagnosticWind.ts', 'DiagnosticWind.wNight', HOT],
  ['A14', 'src/atmosphere/pyrogenic.ts', 'PyrogenicPotential.solve', { first: 12, raw: 2, rawMaxBytes: 16 * MB }],
  ['A14', 'src/atmosphere/pyrogenic.ts', 'PyrogenicPotential.gradientToFire', { first: 12, raw: 1, rawMaxBytes: 16 * MB }],

  // ── A15 Simulation (constructor, stepOnce, spin-up, records, coupling) ─────────────────────────────────────────────
  ['A15', 'src/sim/simulation.ts', 'Simulation.stepOnce', { first: 100, seq: true }],
  ['A15', 'src/sim/simulation.ts', 'Simulation.spinUp', { first: 4 }],
  ['A15', 'src/sim/simulation.ts', 'Simulation.advance', { first: 4 }],
  ['A15', 'src/sim/simulation.ts', 'Simulation.finishSpinUp', { first: 4 }],
  ['A15', 'src/sim/simulation.ts', 'Simulation.applyDueRecords', { first: 100, seq: true }],
  ['A15', 'src/sim/simulation.ts', 'Simulation.applyPendingSpots', { first: 100, seq: true }],
  ['A15', 'src/sim/simulation.ts', 'Simulation.applyRecord', { first: 12 }],
  ['A15', 'src/sim/simulation.ts', 'Simulation.fireWinds', { first: 40, seq: true }],
  ['A15', 'src/sim/simulation.ts', 'Simulation.moistureCtx', { first: 12, raw: 1 }],
  ['A15', 'src/sim/simulation.ts', 'Simulation.plumeTop', { first: 40 }],
  ['A15', 'src/sim/simulation.ts', 'Simulation.emberEnv', { first: 40 }],
  ['A15', 'src/sim/simulation.ts', 'Simulation.solarAt', { first: 12 }],
  ['A15', 'src/sim/simulation.ts', 'Simulation.weatherNow', MID],
  ['A15', 'src/sim/simulation.ts', 'Simulation.u10Now', { first: 12 }],
  ['A15', 'src/sim/simulation.ts', 'Simulation.addSpot', { first: 12 }],
  ['A15', 'src/sim/stats.ts', 'frontRosBlocks', { first: 12, raw: 1 }],
  ['A15', 'src/sim/stats.ts', 'frontRosAt', { ...HOT, raw: 1 }],

  // ── A16 standard-tier air: Atmosphere ─────────────────────────────────────────────────────────────────────────────────────────
  ['A16', 'src/atmosphere/atmosphere.ts', 'Atmosphere.step', { first: 100, state: 'atm', raw: 2, rawMaxBytes: 32 * MB, seq: true }],
  ['A16', 'src/atmosphere/atmosphere.ts', 'Atmosphere.project', { first: 12, stride: 11, max: 24, state: 'atm', raw: 1, rawMaxBytes: 32 * MB }],
  ['A16', 'src/atmosphere/atmosphere.ts', 'Atmosphere.davies', { first: 12, stride: 11, max: 24, state: 'atm' }],
  ['A16', 'src/atmosphere/atmosphere.ts', 'Atmosphere.sponge', { first: 12, stride: 11, max: 24, state: 'atm' }],
  ['A16', 'src/atmosphere/atmosphere.ts', 'Atmosphere.addFireHeat', { first: 40, seq: true, raw: 40 }],
  ['A16', 'src/atmosphere/atmosphere.ts', 'Atmosphere.fireWindTier', { first: 40, raw: 1, rawMaxBytes: 16 * MB }],
  ['A16', 'src/atmosphere/atmosphere.ts', 'Atmosphere.updateNightFields', { first: 12 }],
  ['A16', 'src/atmosphere/atmosphere.ts', 'Atmosphere.initialiseState', { first: 4, state: 'atm' }],
  ['A16', 'src/atmosphere/atmosphere.ts', 'Atmosphere.refreshBlend', { first: 12 }],
  ['A16', 'src/atmosphere/atmosphere.ts', 'Atmosphere.updateMasks', { first: 12 }],
  ['A16', 'src/atmosphere/atmosphere.ts', 'Atmosphere.sampleAt', HOT],
  ['A16', 'src/atmosphere/atmosphere.ts', 'Atmosphere.sample', HOT],
  ['A16', 'src/atmosphere/atmosphere.ts', 'Atmosphere.diagnostics', { first: 12, raw: 1 }],
  ['A16', 'src/atmosphere/atmosphere.ts', 'Atmosphere.maxStableDt', { first: 40 }],
  ['A16', 'src/atmosphere/atmosphere.ts', 'Atmosphere.onStampDerived', { first: 6 }],

  // ── A17 standard-tier air: 3-D dynamics operators ────────────────────────────────────────────────────────────────────
  ['A17', 'src/atmosphere/dynamics.ts', 'collocate', { first: 6, stride: 29, max: 12, raw: 1, rawMaxBytes: 32 * MB }],
  ['A17', 'src/atmosphere/dynamics.ts', 'displacements', { first: 6, stride: 29, max: 12, raw: 1, rawMaxBytes: 32 * MB }],
  ['A17', 'src/atmosphere/dynamics.ts', 'advect', { first: 6, stride: 53, max: 12, raw: 1, rawMaxBytes: 32 * MB }],
  ['A17', 'src/atmosphere/dynamics.ts', 'smagorinsky', { first: 6, stride: 11, max: 12, raw: 1, rawMaxBytes: 32 * MB }],
  ['A17', 'src/atmosphere/dynamics.ts', 'diffuseH', { first: 6, stride: 29, max: 12, raw: 1, rawMaxBytes: 32 * MB }],
  ['A17', 'src/atmosphere/dynamics.ts', 'columnMap', { first: 6 }],
  ['A17', 'src/atmosphere/dynamics.ts', 'diffuseVLevels', { first: 6, stride: 29, max: 12, raw: 1, rawMaxBytes: 32 * MB }],
  ['A17', 'src/atmosphere/dynamics.ts', 'diffuseVW', { first: 6, stride: 11, max: 12, raw: 1, rawMaxBytes: 32 * MB }],
];

export const isMethod = (name) => name.includes('.');

/** Rows with their ids: `A5/headRosKernel`, `A7/FireSpreadModel.step`. */
export function rows() {
  const seen = new Set();
  return SPEC.map(([area, file, name, opts]) => {
    const id = `${area}/${name}`;
    if (seen.has(id)) throw new Error(`duplicate probe id ${id}`);
    seen.add(id);
    return { id, area, file, name, opts: opts ?? {} };
  });
}

/** Module functions by file, for the build plugin: { 'src/x.ts': [{ name, id }] }. */
export function moduleFunctionsByFile() {
  const out = {};
  for (const r of rows()) if (!isMethod(r.name)) (out[r.file] ??= []).push({ name: r.name, id: r.id });
  return out;
}
