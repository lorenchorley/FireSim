/**
 * Step 1: one standard baseline run per bundled demo site, headless, fast tier, and the per-cell fields the quality map needs.
 *
 * The standard scenario (the same for every site, nothing tuned per site):
 *   - domain 6 km square, 30 m fire cells (200 x 200), bundled data only (offline), seed 1, fast tier (2-D diagnostic air), embers on
 *     (the fast tier's cap of 2000);
 *   - (scenario `std`; the variants are in lib/scenarios.ts) weather: the preset "hot-nw-sw-change" (36 C, 12 % RH, NW 35-45 km/h, a south-westerly change at 15:00 local mean solar time),
 *     started at its canonical 11:00 on 20 December 2026 (site longitude);
 *   - one point ignition (radius 30 m) at t = 0 on the flammable, gently sloping (slope30 < 10 deg) cell nearest to the point
 *     1500 m west and 1500 m north of the domain centre, so that the NW wind drives the fire across the domain;
 *   - run AQ_HOURS (default 8) simulated hours, polling the fire's internal state every 30 s of simulated time.
 * It records the static terrain measures that make up complexity, and from the run the arrival time, local spread rate, the
 * regime flags (junction boost, attachment A.E, active vorticity-lateral-spread zone), the insights, homes, and the engine's step data.
 *
 *   AQ_SITES=katoomba,grose AQ_SCN=std,mild AQ_HOURS=8 npx vitest run --config studies/adaptive-simulation-quality/vitest.config.ts 01_baseline
 */
import { mkdirSync } from 'node:fs';
import { it } from 'vitest';
import { createMemoryKV, DEMO_SITES, setDefaultCache } from '../../../src/data';
import { analyseSeries } from '../../../src/explain';
import { buildScenario } from '../../../src/scenario/build';
import { WEATHER_PRESETS } from '../../../src/scenario/presets';
import { BurnState, type Insight } from '../../../src/core/types';
import { Simulation } from '../../../src/sim/simulation';
import { saveFields } from './lib/io';
import { fieldsFile, SCENARIOS } from './lib/scenarios';
import { shape10 } from './lib/terrain10';

const SITES = (process.env.AQ_SITES ?? 'katoomba,grose,tomah,kanangra,thredbo,gospers,budawangs,barrington,warrumbungles').split(',');
const HOURS = Number(process.env.AQ_HOURS ?? 8);
const EXTENT = 6000;
const SCNS = (process.env.AQ_SCN ?? 'std').split(',');
const POLL_S = 30;
const OUT = new URL('../work/', import.meta.url).pathname;

const log = (s: string): void => {
  process.stderr.write(`[baseline] ${s}\n`);
};

/** Insight kinds that mark a change of behaviour regime (what the explain engine calls them). */
const REGIME_KINDS = new Set(['junction-zone', 'eruptive-slope', 'vorticity-lateral-spread', 'lee-slope-eddy', 'mass-spotting', 'crown-fire', 'plume-dominated', 'wind-change', 'fire-induced-wind', 'pyroconvection-risk']);

for (const scnId of SCNS) for (const siteId of SITES) {
  it(`baseline ${siteId} ${scnId}`, async () => {
    const scn = SCENARIOS[scnId];
    if (!scn) throw new Error(`unknown scenario ${scnId}`);
    const PRESET = scn.preset;
    const IGN_TARGET = scn.ignitionTarget;
    const extent = scn.extent ?? EXTENT;
    const tier = scn.tier ?? 'fast';
    mkdirSync(OUT, { recursive: true });
    setDefaultCache(createMemoryKV());
    const site = DEMO_SITES.find((s) => s.id === siteId);
    if (!site) throw new Error(`unknown site ${siteId}`);
    const t0 = performance.now();
    const start = WEATHER_PRESETS[PRESET].canonicalStart(site.centre.lon, 2026);
    const scenario = await buildScenario({
      centre: site.centre,
      extent,
      demoSiteId: siteId,
      weather: { kind: 'preset', presetId: PRESET, start },
      duration: HOURS * 3600,
      online: false,
      options: { tier, seed: 1 },
    });
    const buildS = (performance.now() - t0) / 1000;
    const g = scenario.terrain.grid;
    const n = g.nx * g.ny;
    if (!scenario.terrainHiRes) throw new Error('no 10 m DEM in the scenario');

    const insights: Insight[] = [];
    const engineSamples: { t: number; outerS: number | null; subS: number | null; fireMsPerOuter: number | null; subStepsPerOuter: number | null; burning: number | null }[] = [];
    const sim = new Simulation(scenario, {
      tier,
      hooks: {
        snapshot: (s) => {
          for (const i of s.insights) insights.push(i);
          if (Math.round(s.time) % 900 === 0) {
            const perf = s.engine?.perf;
            const fireMod = perf?.modules.find((m) => m.id === 'fire');
            engineSamples.push({
              t: s.time,
              outerS: s.engine?.atmosphere.currentStepS ?? null,
              subS: s.engine?.fire.currentSubStepS ?? null,
              fireMsPerOuter: fireMod?.ms ?? null,
              subStepsPerOuter: perf?.quality.fireSubSteps ?? null,
              burning: perf?.quality.burningCells ?? null,
            });
          }
        },
      },
    });

    const v0 = sim.stateView();
    const flammable = new Uint8Array(n);
    for (let k = 0; k < n; k++) flammable[k] = v0.fire.burnState[k] === BurnState.NonFlammable ? 0 : 1;
    const feats = v0.features;
    const terr = v0.terrain;

    // Ignition: the nearest flammable cell with slope30 < 10 deg to the target point.
    let best = -1;
    let bestD = Infinity;
    for (let j = 0; j < g.ny; j++) {
      for (let i = 0; i < g.nx; i++) {
        const k = j * g.nx + i;
        if (!flammable[k] || feats.slope30[k]! >= 10) continue;
        const d = Math.hypot(g.x0 + i * g.cellSize - IGN_TARGET[0], g.y0 + j * g.cellSize - IGN_TARGET[1]);
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      }
    }
    if (best < 0) throw new Error('no ignition cell');
    const ign = { x: g.x0 + (best % g.nx) * g.cellSize, y: g.y0 + Math.floor(best / g.nx) * g.cellSize };
    sim.ignite({ id: 'baseline', kind: 'point', points: [[ign.x, ign.y]], time: 0, radius: 30, origin: 'observed' });

    // Run, polling the regime state.
    const junMax = new Float32Array(n).fill(1);
    const aeMax = new Float32Array(n);
    const vlsEver = new Uint8Array(n);
    const series: { t: number; burntHa: number; burning: number; perimeterKm: number; headRos: number; maxRos: number; spots: number; front: number; wallS: number }[] = [];
    const tRun = performance.now();
    for (let t = POLL_S; t <= HOURS * 3600 + 1e-6; t += POLL_S) {
      sim.advance(t);
      const aux = sim.stateView().aux;
      for (let k = 0; k < n; k++) {
        const j = aux.junction[k]!;
        if (j > junMax[k]!) junMax[k] = j;
        const a = aux.attach[k]!;
        if (a > aeMax[k]!) aeMax[k] = a;
        if (aux.vlsActive[k]) vlsEver[k] = 1;
      }
      if (t % 300 === 0) {
        const st = sim.stats();
        series.push({ t, burntHa: st.burntAreaHa, burning: st.burningCells, perimeterKm: st.perimeterKm, headRos: st.headRos, maxRos: st.maxRos, spots: st.spotFires, front: aux.front.length, wallS: (performance.now() - tRun) / 1000 });
      }
    }
    const runS = (performance.now() - tRun) / 1000;
    const vEnd = sim.stateView();
    const fire = vEnd.fire;

    const sh = shape10(g, scenario.terrainHiRes);
    const winds = analyseSeries(scenario.weather, scenario.startTime, HOURS * 3600, g.origin.lon).changes.map((c) => ({ tS: (c.time - scenario.startTime) / 1000, fromDir: c.fromDir, toDir: c.toDir, shift: c.shift, postSpeed: c.postSpeed }));

    const kinds: Record<string, number> = {};
    for (const i of insights) kinds[i.kind] = (kinds[i.kind] ?? 0) + 1;
    const regimeInsights = insights.filter((i) => REGIME_KINDS.has(i.kind) && i.kind !== 'wind-change').map((i) => [i.kind, Math.round(i.time), Math.round(i.x), Math.round(i.y)]);

    const homes = scenario.context?.homes ?? new Float32Array(0);
    const homesIn: number[] = [];
    const half = (g.nx * g.cellSize) / 2;
    for (let q = 0; q < homes.length; q += 2) if (Math.abs(homes[q]!) <= half && Math.abs(homes[q + 1]!) <= half) homesIn.push(homes[q]!, homes[q + 1]!);

    const lastRos = vEnd.fire.ros;
    const meta = {
      site: siteId,
      scenario: scnId,
      name: site.name,
      centre: site.centre,
      grid: { nx: g.nx, ny: g.ny, cellSize: g.cellSize, x0: g.x0, y0: g.y0 },
      hiResCell: scenario.terrainHiRes.grid.cellSize,
      preset: PRESET,
      startMs: scenario.startTime,
      hours: HOURS,
      seed: 1,
      ignition: ign,
      ignitionTargetDistM: bestD,
      windChanges: winds,
      air: { nx: sim.snapshot().engine?.atmosphere.nx ?? 0, ny: sim.snapshot().engine?.atmosphere.ny ?? 0, dxM: sim.snapshot().engine?.atmosphere.dxM ?? 0, kind: sim.snapshot().engine?.atmosphere.kind ?? '' },
      terrainSource: terr.source,
      series,
      engineSamples,
      insightKinds: kinds,
      regimeInsights,
      homesInDomain: homesIn.length / 2,
      homesTotal: homes.length / 2,
      wall: { buildS, runS },
      modulesEnd: sim.snapshot().engine?.perf?.modules.map((m) => ({ id: m.id, ms: m.ms, share: m.share })) ?? [],
      embersSpawned: sim.snapshot().engine?.perf?.embers ?? null,
      terrainFeatureParams: { steepGateDeg: 15 },
    };
    const bytes = saveFields(fieldsFile(OUT, siteId, scnId), meta, {
      // static terrain measures
      slope30: Float32Array.from(feats.slope30),
      slopeP90: Float32Array.from(terr.slopeP90Deg ?? new Float32Array(n)),
      cliffFrac: Float32Array.from(terr.cliffFraction ?? new Float32Array(n)),
      landform: Uint8Array.from(terr.landform),
      drainage: Uint8Array.from(feats.drainage),
      trench: Float32Array.from(feats.trench),
      curv30: Float32Array.from(terr.curvature),
      slope10Max: sh.slope10Max,
      rough10: sh.rough10,
      curv10: sh.curv10,
      flammable,
      // run
      arrival: Float32Array.from(fire.arrivalTime),
      ros: Float32Array.from(lastRos),
      intensity: Float32Array.from(fire.intensity),
      junMax,
      aeMax,
      vlsEver,
      homes: Float32Array.from(homesIn),
    });
    const last = series[series.length - 1]!;
    log(`${siteId} ${scnId}: build ${buildS.toFixed(1)} s, run ${runS.toFixed(1)} s, burnt ${last.burntHa.toFixed(0)} of ${((n * g.cellSize ** 2) / 1e4).toFixed(0)} ha, spots ${last.spots}, homes in domain ${homesIn.length / 2}, ignition (${ign.x}, ${ign.y}), air ${meta.air.nx}x${meta.air.ny} @ ${meta.air.dxM} m, ${(bytes / 1024).toFixed(0)} kB`);
    log(`${siteId} ${scnId}: insight kinds ${JSON.stringify(kinds)}`);
  }, 1_800_000);
}
