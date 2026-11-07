/**
 * Step 2: from the fields of step 1 (no simulation here) build the quality map and the sizing numbers per site, the figures,
 * `data/summary.json` (one line per site and scenario) and a small `data/<site>.quality.gz` (u8 complexity, importance, arrival in 5 min).
 *
 *   npx vitest run --config studies/adaptive-simulation-quality/vitest.config.ts 02_analyse
 *   AQ_SITES=katoomba,grose to limit the sites; AQ_FIGS=katoomba,grose to limit the figures.
 *
 * Definitions are in lib/analysis.ts. All costs are in CELLS and CELL-STEPS with an assumed cost per cell-step of 1 and an assumed
 * level-set sub-step proportional to the cell size (CFL); the 30 m sub-step is read from the baseline run. Nothing here is measured wall time.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { complexity, count, countAnd, distanceAhead, distanceToFeature, frontMask, importance, jaccard, topShare, type Fields, type Meta } from './lib/analysis';
import { loadFields, saveFields } from './lib/io';
import { writePanels, type Panel } from './lib/png';
import { fieldsFile } from './lib/scenarios';

const SITES = (process.env.AQ_SITES ?? 'katoomba,grose,tomah,kanangra,thredbo,gospers,budawangs,barrington,warrumbungles').split(',');
const SCNS = (process.env.AQ_SCN ?? 'std').split(',');
const FIGS = new Set((process.env.AQ_FIGS ?? 'katoomba,grose,thredbo,warrumbungles').split(','));
const WORK = new URL('../work/', import.meta.url).pathname;
const DATA = new URL('../data/', import.meta.url).pathname;
const FIG = new URL('../figures/', import.meta.url).pathname;
const DT_S = 300; // sampling of the front through the run
const TOP = [0.1, 0.2, 0.3] as const;
const BANDS = [4, 10, 20] as const; // cells; 4 = the prepared set of the level set (SPREAD_PARAMS.levelSet.prepareCells)
const HORIZON_MIN = [15, 30, 60] as const;
const WINDOWS_H = [2, 4, 8] as const;
const R_FINE = [20, 10] as const;
const AIR_D_M = [500, 1000, 2000] as const;
const AIR_DX_M = [133.33, 150, 200] as const; // the run's own air grid at 6 km, then the two ends of "150 to 200 m"

const log = (s: string): void => {
  process.stderr.write(`[analyse] ${s}\n`);
};
const r3 = (x: number): number => Math.round(x * 1000) / 1000;
const r1 = (x: number): number => Math.round(x * 10) / 10;
const mean = (a: number[]): number => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const max = (a: number[]): number => (a.length ? Math.max(...a) : 0);

interface RuleStats {
  /** live fine cells at each sample (all cells of the rule's set at that time) */
  live: number[];
  liveAndTop20: number[];
  liveAndSteep: number[];
  unionCells: number;
  unionAndTop20: number;
  /** cells of the union that the front reached (flammable, burnt by the end of the run) */
  unionReached: number;
  unionAndTop20Reached: number;
}

it('analyse all sites', () => {
  mkdirSync(DATA, { recursive: true });
  mkdirSync(FIG, { recursive: true });
  const all: Record<string, unknown> = {};
  for (const scnId of SCNS) for (const siteId of SITES) {
    const path = fieldsFile(WORK, siteId, scnId);
    const key = scnId === 'std' ? siteId : `${siteId}.${scnId}`;
    if (!existsSync(path)) {
      log(`${key}: no fields file, skipped`);
      continue;
    }
    const { meta, a } = loadFields<Meta>(path);
    const f = a as unknown as Fields;
    const { nx, ny, cellSize } = meta.grid;
    const n = nx * ny;
    const haCell = (cellSize * cellSize) / 1e4;
    const T = meta.hours * 3600;
    const comp = complexity(f);
    const imp = importance(f, meta);
    const quality = new Float32Array(n);
    for (let k = 0; k < n; k++) quality[k] = comp.mean[k]! * imp.mean[k]!;

    // ── 1. terrain: complexity ──
    const flammable = count(f.flammable);
    const steep = count(comp.steep);
    const levels = (s: Float32Array, lv: number[]): number[] => lv.map((x) => r3(count(Array.from(s, (v) => (v >= x ? 1 : 0))) / n));
    const top = Object.fromEntries(TOP.map((p) => [p, topShare(comp.mean, p)])) as Record<number, Uint8Array>;
    const topMax20 = topShare(comp.max, 0.2);
    const topNoL20 = topShare(comp.meanNoL, 0.2);
    const groups = { S: comp.S, C: comp.C, G: comp.G, L: comp.L, R: comp.R } as const;
    const terrain = {
      cells: n,
      cellM: cellSize,
      areaHa: r1(n * haCell),
      flammableShare: r3(flammable / n),
      steepGateShare: r3(steep / n),
      complexityMeanOfCells: r3(mean(Array.from(comp.mean))),
      complexityAbove: { '0.2': levels(comp.mean, [0.2])[0], '0.4': levels(comp.mean, [0.4])[0], '0.6': levels(comp.mean, [0.6])[0] },
      groupShareAtLeastHalf: Object.fromEntries(Object.entries(groups).map(([k, s]) => [k, levels(s, [0.5])[0]])),
      topSetsOverlap: {
        'mean20_vs_max20': r3(jaccard(top[0.2]!, topMax20)),
        'mean20_vs_meanNoL20': r3(jaccard(top[0.2]!, topNoL20)),
        ...Object.fromEntries(Object.entries(groups).map(([k, s]) => [`mean20_vs_${k}20`, r3(jaccard(top[0.2]!, topShare(s, 0.2)))])),
        mean20_vs_steepGate: r3(jaccard(top[0.2]!, comp.steep)),
        top20ShareInSteepGate: r3(countAnd(top[0.2]!, comp.steep) / count(top[0.2]!)),
        steepGateShareInTop20: r3(countAnd(top[0.2]!, comp.steep) / Math.max(1, count(comp.steep))),
      },
    };

    // ── 2. the run: importance ──
    const reachedBy = (h: number): number => {
      let c = 0;
      for (let k = 0; k < n; k++) if (f.flammable[k] && f.arrival[k]! <= h * 3600) c++;
      return c;
    };
    const reached = Object.fromEntries(WINDOWS_H.filter((h) => h <= meta.hours).map((h) => [`${h}h`, { cells: reachedBy(h), shareOfDomain: r3(reachedBy(h) / n), shareOfFlammable: r3(reachedBy(h) / flammable) }]));
    /** Flagged cells inside / outside the complex set, and how much likelier a flag is inside it (null when either side has none). */
    const flagAndTop = (m: Uint8Array, t: Uint8Array, within?: Uint8Array): { inSet: number; outOfSet: number; lift: number | null } => {
      let inSet = 0;
      let outSet = 0;
      let nIn = 0;
      let nOut = 0;
      for (let k = 0; k < n; k++) {
        if (within && !within[k]) continue;
        if (t[k]) {
          nIn++;
          if (m[k]) inSet++;
        } else {
          nOut++;
          if (m[k]) outSet++;
        }
      }
      return { inSet, outOfSet: outSet, lift: inSet > 0 && outSet > 0 ? r3(inSet / nIn / (outSet / nOut)) : null };
    };
    const reachedAll = new Uint8Array(n);
    for (let k = 0; k < n; k++) reachedAll[k] = f.flammable[k] && Number.isFinite(f.arrival[k]!) ? 1 : 0;
    const FLAGS = ['junction', 'eruptive', 'vls', 'windChange', 'any'] as const;
    const regime = {
      cells: Object.fromEntries(FLAGS.map((k) => [k, count(imp.flags[k])])),
      shareOfDomain: Object.fromEntries(FLAGS.map((k) => [k, r3(count(imp.flags[k]) / n)])),
      anyShareOfReached: r3(count(imp.flags.any) / Math.max(1, count(reachedAll))),
      // Does the complexity score point at where the code's regimes fire? Over all cells, and over the cells the front reached only
      // (a cell the front never reached cannot carry a flag, so the second is the fair one).
      inTop20: Object.fromEntries(FLAGS.map((k) => [k, flagAndTop(imp.flags[k], top[0.2]!)])),
      inTop20ReachedOnly: Object.fromEntries(FLAGS.map((k) => [k, flagAndTop(imp.flags[k], top[0.2]!, reachedAll)])),
      windChanges: meta.windChanges,
      insightKinds: meta.insightKinds,
    };
    // Homes in the path: a burnt flammable cell within R m of the address by time T.
    const homesN = f.homes.length / 2;
    const nearest = (radM: number): Float32Array => {
      const rc = Math.round(radM / cellSize);
      const out = new Float32Array(homesN).fill(Infinity);
      for (let q = 0; q < homesN; q++) {
        const ci = Math.round((f.homes[2 * q]! - meta.grid.x0) / cellSize);
        const cj = Math.round((f.homes[2 * q + 1]! - meta.grid.y0) / cellSize);
        let best = Infinity;
        for (let dj = -rc; dj <= rc; dj++) {
          for (let di = -rc; di <= rc; di++) {
            if (di * di + dj * dj > rc * rc) continue;
            const i = ci + di;
            const j = cj + dj;
            if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
            const k = j * nx + i;
            if (f.flammable[k] && f.arrival[k]! < best) best = f.arrival[k]!;
          }
        }
        out[q] = best;
      }
      return out;
    };
    const homes = { inDomain: homesN, within100m: {} as Record<string, number>, within500m: {} as Record<string, number> };
    for (const [rad, key] of [[100, 'within100m'], [500, 'within500m']] as const) {
      const arr = nearest(rad);
      for (const h of WINDOWS_H.filter((x) => x <= meta.hours)) homes[key][`${h}h`] = arr.reduce((s, v) => s + (v <= h * 3600 ? 1 : 0), 0);
    }
    const homeCells = (() => {
      let c = 0;
      for (let k = 0; k < n; k++) if (imp.homeDistM[k]! <= 300) c++;
      return c;
    })();
    const importanceSummary = {
      reached,
      reachedEver: { cells: count(reachedAll), shareOfDomain: r3(count(reachedAll) / n) },
      meanImportanceOverReached: r3(mean(Array.from(imp.mean).filter((_, k) => reachedAll[k]))),
      cellsWithin300mOfHome: { cells: homeCells, shareOfDomain: r3(homeCells / n) },
      homes,
      regime,
      qualityAtLeast: Object.fromEntries([0.1, 0.2, 0.3].map((x) => [String(x), r3(count(Array.from(quality, (v) => (v >= x ? 1 : 0))) / n)])),
    };

    // ── 3. sizing: the static sets and the key number (what the front reaches) ──
    const staticSets = TOP.map((p) => {
      const set = top[p]!;
      const m = count(set);
      const row: Record<string, unknown> = { topShare: p, cells: m, shareOfCells: r3(m / n), areaHa: r1(m * haCell), flammableShare: r3(countAnd(set, f.flammable) / m) };
      for (const h of WINDOWS_H.filter((x) => x <= meta.hours)) {
        let c = 0;
        for (let k = 0; k < n; k++) if (set[k] && f.flammable[k] && f.arrival[k]! <= h * 3600) c++;
        row[`reachedBy${h}h`] = r3(c / m);
      }
      return row;
    });

    // ── 4. sizing: the band around the front through the run ──
    const times: number[] = [];
    for (let t = DT_S; t <= T + 1e-6; t += DT_S) times.push(t);
    const top20 = top[0.2]!;
    // How much the answer depends on the definition of complexity: the top 20 % by each alternative score.
    const altScores: Record<string, Float32Array> = { mean: comp.mean, max: comp.max, meanNoLandform: comp.meanNoL, steepnessS: comp.S, cliffC: comp.C, gullyG: comp.G, landformL: comp.L, reliefR: comp.R };
    const altSets = Object.fromEntries(Object.entries(altScores).map(([k, v]) => [k, topShare(v, 0.2)])) as Record<string, Uint8Array>;
    const altLive: Record<string, number[]> = Object.fromEntries(Object.keys(altSets).map((k) => [k, []]));
    const mkStats = (): RuleStats & { seen: Uint8Array } => ({ live: [], liveAndTop20: [], liveAndSteep: [], unionCells: 0, unionAndTop20: 0, unionReached: 0, unionAndTop20Reached: 0, seen: new Uint8Array(n) });
    const bandStats: Record<string, RuleStats & { seen: Uint8Array }> = {};
    for (const w of BANDS) bandStats[`ahead${w}`] = mkStats();
    for (const hm of HORIZON_MIN) bandStats[`horizon${hm}min`] = mkStats();
    // air columns
    const airGrids = AIR_DX_M.map((dx) => ({ dx, nc: Math.max(2, Math.round((nx * cellSize) / dx)) }));
    const airInst: Record<string, number[]> = {};
    const airSeen: Record<string, Uint8Array> = {};
    for (const gA of airGrids) for (const D of AIR_D_M) {
      airInst[`${gA.dx}_${D}`] = [];
      airSeen[`${gA.dx}_${D}`] = new Uint8Array(gA.nc * gA.nc);
    }
    for (const t of times) {
      const dAhead = distanceAhead(f.arrival, t, nx, ny);
      const push = (name: string, sel: Uint8Array): void => {
        const s = bandStats[name]!;
        s.live.push(count(sel));
        s.liveAndTop20.push(countAnd(sel, top20));
        s.liveAndSteep.push(countAnd(sel, comp.steep));
        for (let k = 0; k < n; k++) if (sel[k]) s.seen[k] = 1;
      };
      for (const w of BANDS) {
        const sel = new Uint8Array(n);
        for (let k = 0; k < n; k++) sel[k] = dAhead[k]! > 0 && dAhead[k]! <= w ? 1 : 0;
        push(`ahead${w}`, sel);
        if (w === 10) for (const [k, set] of Object.entries(altSets)) altLive[k]!.push(countAnd(sel, set));
      }
      for (const hm of HORIZON_MIN) {
        const sel = new Uint8Array(n);
        for (let k = 0; k < n; k++) sel[k] = f.arrival[k]! > t && f.arrival[k]! <= t + hm * 60 ? 1 : 0;
        push(`horizon${hm}min`, sel);
      }
      // air columns within D of the front (either side of it)
      const dFront = distanceToFeature(frontMask(f.arrival, t, nx, ny), nx, ny);
      for (const gA of airGrids) {
        for (const D of AIR_D_M) {
          let c = 0;
          const seen = airSeen[`${gA.dx}_${D}`]!;
          for (let cj = 0; cj < gA.nc; cj++) {
            for (let ci = 0; ci < gA.nc; ci++) {
              const x = -(nx * cellSize) / 2 + (ci + 0.5) * ((nx * cellSize) / gA.nc);
              const y = -(ny * cellSize) / 2 + (cj + 0.5) * ((ny * cellSize) / gA.nc);
              const i = Math.min(nx - 1, Math.max(0, Math.round((x - meta.grid.x0) / cellSize)));
              const j = Math.min(ny - 1, Math.max(0, Math.round((y - meta.grid.y0) / cellSize)));
              if (dFront[j * nx + i]! * cellSize <= D) {
                c++;
                seen[cj * gA.nc + ci] = 1;
              }
            }
          }
          airInst[`${gA.dx}_${D}`]!.push(c);
        }
      }
    }
    const win = (a: number[], h: number): number[] => a.slice(0, Math.min(a.length, Math.round((h * 3600) / DT_S)));
    const bandOut: Record<string, unknown> = {};
    for (const [name, s] of Object.entries(bandStats)) {
      s.unionCells = count(s.seen);
      s.unionAndTop20 = countAnd(s.seen, top20);
      s.unionReached = countAnd(s.seen, reachedAll);
      s.unionAndTop20Reached = (() => {
        let c = 0;
        for (let k = 0; k < n; k++) if (s.seen[k] && top20[k] && reachedAll[k]) c++;
        return c;
      })();
      const row: Record<string, unknown> = {};
      for (const h of [2, 4, meta.hours] as const) {
        const L = win(s.live, h);
        const LT = win(s.liveAndTop20, h);
        const LS = win(s.liveAndSteep, h);
        row[`window${h}h`] = {
          liveMean: r1(mean(L)),
          liveMax: max(L),
          shareOfCellsMean: r3(mean(L) / n),
          shareOfCellsMax: r3(max(L) / n),
          andTop20Mean: r1(mean(LT)),
          andTop20Max: max(LT),
          andTop20ShareOfCellsMean: r3(mean(LT) / n),
          shareOfBandThatIsTop20: r3(mean(LT) / Math.max(1e-9, mean(L))),
          andSteepMean: r1(mean(LS)),
          shareOfBandThatIsSteep: r3(mean(LS) / Math.max(1e-9, mean(L))),
        };
      }
      row['union'] = {
        cells: s.unionCells,
        shareOfCells: r3(s.unionCells / n),
        shareOfUnionReached: r3(s.unionReached / Math.max(1, s.unionCells)),
        andTop20: s.unionAndTop20,
        andTop20ShareOfCells: r3(s.unionAndTop20 / n),
        andTop20Reached: s.unionAndTop20Reached,
        andTop20ShareReached: r3(s.unionAndTop20Reached / Math.max(1, s.unionAndTop20)),
      };
      // How much of a STATIC top-20 % refinement is "live" (inside this band) on average: the share of refined-cell-time that is near the front.
      row['staticTop20Utilisation'] = r3(mean(win(s.liveAndTop20, meta.hours)) / count(top20));
      bandOut[name] = row;
    }

    const definitions = Object.fromEntries(
      Object.entries(altSets).map(([k, set]) => {
        const m = count(set);
        const reachedIn = (h: number): number => {
          let c = 0;
          for (let q = 0; q < n; q++) if (set[q] && f.flammable[q] && f.arrival[q]! <= h * 3600) c++;
          return r3(c / Math.max(1, m));
        };
        return [k, { cells: m, shareOfCells: r3(m / n), jaccardWithMean: r3(jaccard(set, altSets['mean']!)), flammableShare: r3(countAnd(set, f.flammable) / Math.max(1, m)), reachedBy4h: reachedIn(4), reachedBy8h: reachedIn(meta.hours), band10MeanShareOfCells: r3(mean(win(altLive[k]!, meta.hours)) / n) }];
      }),
    );

    // ── 5. cost in cells and cell-steps (assumed per-cell cost; sub-step proportional to the cell size) ──
    const lastSub = [...meta.engineSamples].reverse().find((e) => e.subStepsPerOuter !== null && e.outerS);
    const outerS = lastSub?.outerS ?? 10;
    // The engine's own mean of level-set sub-steps per outer step over the run so far (EnginePerfInfo.quality.fireSubSteps), per simulated hour.
    const steps30PerH = (lastSub?.subStepsPerOuter ?? 1) * (3600 / outerS);
    const stepsPerH = (cell: number): number => (steps30PerH * cellSize) / cell;
    const unif = (cell: number): { cells: number; cellStepsPerHM: number; vsUniform30: number } => {
      const cells = n * (cellSize / cell) ** 2;
      return { cells, cellStepsPerHM: r3((cells * stepsPerH(cell)) / 1e6), vsUniform30: r3((cells * stepsPerH(cell)) / (n * steps30PerH)) };
    };
    const refined = (mCells: number): Record<string, unknown> => {
      const o: Record<string, unknown> = {};
      for (const r of R_FINE) {
        const g = (cellSize / r) ** 2;
        const cells = n - mCells + mCells * g;
        const csLocal = (n - mCells) * steps30PerH + mCells * g * stepsPerH(r);
        const csGlobal = (n - mCells + mCells * g) * stepsPerH(r);
        o[`to${r}m`] = { cells: Math.round(cells), cellsVsUniform: r3(cells / (n * (cellSize / r) ** 2)), cellStepsPerHM_localDt: r3(csLocal / 1e6), vsUniform30_localDt: r3(csLocal / (n * steps30PerH)), vsUniformFine_localDt: r3(csLocal / (n * (cellSize / r) ** 2 * stepsPerH(r))), vsUniformFine_globalDt: r3(csGlobal / (n * (cellSize / r) ** 2 * stepsPerH(r))) };
      }
      return o;
    };
    const costRows: Record<string, unknown> = {
      assumptions: { perCellStepCost: 1, subStepProportionalToCellSize: true, outerStepS: outerS, meanSubStepsPerOuterStep: r3(lastSub?.subStepsPerOuter ?? 1), steps30PerSimHour: Math.round(steps30PerH), denseAccounting: 'every cell of the domain is touched at every sub-step (memory, moisture, fuel, layers, snapshots; NOT how the level set works today)' },
      uniform30: unif(cellSize),
      uniform20: unif(20),
      uniform10: unif(10),
      static: Object.fromEntries(TOP.map((p) => [`top${p * 100}pct`, refined(count(top[p]!))])),
      dynamic: Object.fromEntries(
        Object.entries(bandStats).map(([name, s]) => {
          const L = win(s.live, meta.hours);
          const LT = win(s.liveAndTop20, meta.hours);
          return [name, { liveMean: refined(mean(L)), liveMax: refined(max(L)), andTop20Mean: refined(mean(LT)), andTop20Max: refined(max(LT)) }];
        }),
      ),
    };

    // ── 6. the air grid ──
    const airOut: Record<string, unknown> = {};
    for (const gA of airGrids) {
      const cols = gA.nc * gA.nc;
      for (const D of AIR_D_M) {
        const key = `${gA.dx}_${D}`;
        const ser = airInst[key]!;
        airOut[key] = {
          columns: cols,
          dxM: r1((nx * cellSize) / gA.nc),
          withinMeanShare: r3(mean(ser) / cols),
          withinMaxShare: r3(max(ser) / cols),
          within2hMeanShare: r3(mean(win(ser, 2)) / cols),
          within4hMeanShare: r3(mean(win(ser, 4)) / cols),
          unionShareOverRun: r3(count(airSeen[key]!) / cols),
        };
      }
    }

    // ── 7. write the summary, the quantised rasters and the figures ──
    const series = meta.series.filter((s) => s.t % 3600 === 0).map((s) => ({ h: s.t / 3600, burntHa: Math.round(s.burntHa), perimeterKm: r1(s.perimeterKm), headRosMs: r3(s.headRos), maxRosMs: r3(s.maxRos), spots: s.spots, frontCells: s.front }));
    const arrivalChecksum = (() => {
      let sum = 0;
      let c = 0;
      for (let k = 0; k < n; k++) if (Number.isFinite(f.arrival[k]!)) { sum += f.arrival[k]!; c++; }
      return { reachedCells: c, sumArrivalS: Math.round(sum) };
    })();
    const summary = { site: meta.site, scenario: scnId, arrivalChecksum, name: meta.name, hours: meta.hours, ignition: meta.ignition, air: meta.air, wall: meta.wall, modulesEnd: (meta as unknown as { modulesEnd: unknown }).modulesEnd, runSeries: series, terrain, importance: importanceSummary, staticSets, definitions, bands: bandOut, cost: costRows, air_: airOut };
    all[key] = summary;
    const q8 = (s: Float32Array, scale = 255): Uint8Array => Uint8Array.from(s, (v) => Math.round(Math.min(1, Math.max(0, v)) * scale));
    const arr5 = Uint8Array.from(f.arrival, (v) => (Number.isFinite(v) ? Math.min(254, Math.round(v / 300)) : 255));
    const bytes = scnId !== 'std' ? 0 : saveFields(`${DATA}${key}.quality.gz`, { site: siteId, grid: meta.grid, note: 'u8 rasters, north up = j increasing; complexity and importance in 1/255, arrival in 5 min steps (255 = never reached in the run)' }, { complexity: q8(comp.mean), importance: q8(imp.mean), arrival5min: arr5, flammable: f.flammable });
    let figBytes = 0;
    if (scnId === 'std' && FIGS.has(siteId)) {
      const hx: number[] = [];
      const hy: number[] = [];
      for (let q = 0; q < f.homes.length; q += 2) {
        hx.push(f.homes[q]!);
        hy.push(f.homes[q + 1]!);
      }
      const dim = Uint8Array.from(f.flammable, (v) => (v ? 0 : 1));
      const cat = new Float32Array(n);
      for (let k = 0; k < n; k++) {
        if (!top20[k]) cat[k] = 0;
        else if (!f.flammable[k]) cat[k] = 1;
        else if (!Number.isFinite(f.arrival[k]!)) cat[k] = 2;
        else if (f.arrival[k]! > 4 * 3600) cat[k] = 3;
        else cat[k] = 4;
      }
      const qScaled = Float32Array.from(quality, (v) => Math.min(1, v / 0.5));
      const contours = { arrival: f.arrival, levelsS: [3600, 2 * 3600, 4 * 3600] };
      const panels: Panel[] = [
        { values: comp.mean, dim, mark: meta.ignition },
        { values: imp.mean, dim, contours, mark: meta.ignition, homes: { x: hx, y: hy } },
        { values: qScaled, dim, contours, mark: meta.ignition },
        { values: cat, categories: [[40, 40, 40], [20, 20, 90], [60, 110, 220], [245, 160, 40], [225, 40, 40]] },
      ];
      figBytes = writePanels(`${FIG}${siteId}-quality-map.png`, meta.grid, panels, 2);
    }
    log(`${key}: flammable ${terrain.flammableShare}, steep gate ${terrain.steepGateShare}, reached by ${meta.hours} h ${importanceSummary.reachedEver.shareOfDomain}, top20 reached 8h ${String(staticSets[1]!['reachedBy8h'])}, quality.gz ${(bytes / 1024).toFixed(0)} kB, figure ${(figBytes / 1024).toFixed(0)} kB`);
  }
  const summaryPath = `${DATA}summary.json`;
  const merged = existsSync(summaryPath) ? { ...(JSON.parse(readFileSync(summaryPath, 'utf8')) as Record<string, unknown>), ...all } : all;
  // one line per site and scenario: diffs stay readable and the file stays small
  writeFileSync(summaryPath, `{\n${Object.entries(merged).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')}\n}\n`);
}, 1_800_000);
