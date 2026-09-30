/**
 * Working memory of a simulation run: how much the app holds while a scenario runs, worked out from the REAL grid sizes
 * of the scenario (pure; no DOM, no worker). Reported as {@link WorkingMemory} (core/datasets.ts) on
 * `ScenarioData.datasetSummary.workingMemory`, and recomputed by the Data sets screen when the tier, the display step or
 * the device's snapshot budget is known.
 *
 * Where the numbers come from
 *  - The scenario's own arrays (terrain, fuel, the 10 m DEM, fire history, places) are MEASURED: every typed array of the
 *    ScenarioData counted once ({@link scenarioArrayBytes}). The worker receives a structured-clone copy (sim/client.ts
 *    posts it without a transfer list), so the same bytes are held twice: main thread and worker.
 *  - The engine's arrays (fire spread, insight engine, fuel moisture, fuel copies, atmosphere, embers, checkpoints,
 *    per-cell rasters) are MODELLED from grid sizes with the coefficients in {@link ENGINE_BYTES}. The coefficients were
 *    measured on 2026-09-30 by walking every typed array of real `Simulation` instances (3 tiers x 6 grids of 10 000 to
 *    90 000 fire cells, 400 to 3 600 atmosphere columns, 1 000 to 4 000 embers) and fitted per part; the fits reproduce
 *    those runs within 2.5 % per part. memoryModel.test.ts re-measures a tiny run against `Simulation.memoryReport()` so
 *    the model cannot silently drift from the allocation code.
 *  - The snapshot history of the time scrubber (ui/snapshotStore.ts) is modelled from the keyframe and fire-array sizes
 *    of a snapshot and capped by the store's budget (ui/session.ts `defaultSnapshotBudget`: 6 % of device memory,
 *    48-160 MiB), which the caller passes in.
 *  - GPU memory is an ESTIMATE of the largest buffers (terrain mesh, shade and data textures, the aerial photo, tree
 *    instances); WebGL does not report bytes, so it is labelled as such.
 *
 * Live readings: {@link liveMemory} reads Chromium's `performance.memory` (the main thread's JS heap; Android WebView
 * has it) and says plainly when a device does not expose it.
 */
import { formatBytes, typedArrayFootprint, type LiveMemory, type MemoryWhere, type WorkingMemory, type WorkingMemoryItem } from '../core/datasets';
import type { QualityTier, ScenarioData } from '../core/types';
import { ATMOS_PARAMS, ATMOS_TIERS } from '../atmosphere/params';
import { SIM_PARAMS } from '../sim/params';

// ─────────────────────────────────────────────────────────────────────────────
// Coefficients (bytes), measured from the engine's allocations (see the header)
// ─────────────────────────────────────────────────────────────────────────────

interface PartCoeffs {
  /** Bytes per fire cell. */
  perCell: number;
  /** Bytes per atmosphere column (all levels). */
  perColumn: number;
  /** Bytes per ember of the particle budget. */
  perEmber: number;
  /** Fixed bytes. */
  fixed: number;
}

const C = (perCell: number, perColumn = 0, fixed = 0, perEmber = 0): PartCoeffs => ({ perCell, perColumn, perEmber, fixed });

/**
 * Engine bytes per part and tier. Per fire cell: fire spread 359 B (about 90 four-byte values: level set, arrival and
 * burn-out times, ROS, intensity, flame, spread direction, driver, masks and caches), insight engine 357 B, fuel moisture
 * 77 B, the worker's fuel copies 79 B, per-cell rasters of the orchestrator 107 B (wind, environment, sun, masks).
 * Atmosphere per column: fast 4.5 kB (the 20-level mass-consistent wind solver, about 56 values per level), standard
 * 11.9 kB (the 3-D model: winds, pressure, temperature, smoke, metric terms and multigrid levels, about 149 values per
 * level at 20 levels), high 14.2 kB (24 levels). Embers 107 B per particle of the budget. The t0 checkpoint keeps the
 * fire, moisture, atmosphere, ember and insight state: 95-105 B per cell plus 0.3-1.1 kB per column.
 */
export const ENGINE_BYTES: Readonly<Record<QualityTier, Readonly<Record<'fire' | 'explain' | 'moisture' | 'fuel' | 'rasters' | 'atmosphere' | 'embers' | 'checkpoint', PartCoeffs>>>> = Object.freeze({
  fast: {
    fire: C(359.4, 0, 57_000),
    explain: C(357.4, 60),
    moisture: C(77, 0, 8016),
    fuel: C(79),
    rasters: C(107),
    atmosphere: C(206.3, 4515.6, 16_200),
    embers: C(37, 20.7, 37_600, 107),
    checkpoint: C(105.1, 328, 3300),
  },
  standard: {
    fire: C(359.4, 0, 57_000),
    explain: C(357.4, 60),
    moisture: C(77, 0, 8016),
    fuel: C(79),
    rasters: C(107),
    atmosphere: C(248.5, 11_928.3, 31_700),
    embers: C(37, 20.7, 37_600, 107),
    checkpoint: C(95.1, 918.6, 5800),
  },
  high: {
    fire: C(359.4, 0, 57_000),
    explain: C(354.1, 121),
    moisture: C(77, 0, 8016),
    fuel: C(79),
    rasters: C(107),
    atmosphere: C(247.7, 14_230.5, 70_100),
    embers: C(37, 20.6, 37_800, 107),
    checkpoint: C(95.1, 1094.6, 6800),
  },
});

/** Extra bytes a ring checkpoint holds over the t0 one after 30 min of a test fire (sparse burning-cell state); bigger fires hold more. */
export const RING_CHECKPOINT_GROWTH_BYTES = 400_000;

/** Snapshot parts (ui/snapshotStore.ts): fire arrays 23 B per cell (arrival, burn state, ROS, intensity, flame, direction, driver, phase). */
export const SNAPSHOT_FIRE_BYTES_PER_CELL = 23;
/** Keyframe: moisture + 4 overlay rasters (vls, attach, trench, landing), 4 B each per cell. */
export const KEYFRAME_BYTES_PER_CELL = 20;
/** Keyframe atmosphere view per column: terrain height, surface u/v (12 B) plus, in the 3-D tiers, u, v, w, theta and smoke per level (20 B). */
export const KEYFRAME_COLUMN_BYTES = { surface: 12, perLevel: 20 };
/** Light frame kept per display step (stats, bookkeeping; ui/snapshotStore.ts FRAME_BYTES). */
export const FRAME_BYTES = 1024;
/** Ember particles kept per step after thinning (typical; at most 64 KB each). */
export const EMBER_FRAME_BYTES = 8_000;

/** Render mesh samples per side by render quality (render/SceneView.ts QUALITY). */
export const RENDER_MESH_N = { low: 224, medium: 320, high: 400 } as const;
/** Tree instances by render quality (render/SceneView.ts QUALITY.veg) and an estimated 80 B each (matrix + colour + extras). */
export const RENDER_TREE_INSTANCES = { low: 16_000, medium: 32_000, high: 48_000 } as const;
const TREE_INSTANCE_BYTES = 80;

// ─────────────────────────────────────────────────────────────────────────────
// Inputs
// ─────────────────────────────────────────────────────────────────────────────

export interface MemoryModelInput {
  /** The tier to model; 'auto' is modelled as 'standard' (the engine starts there and may drop to fast). */
  tier: QualityTier | 'auto';
  fireNx: number;
  fireNy: number;
  extentM: number;
  /** Ember budget; default the tier default (sim/params.ts maxEmbersByTier). */
  maxEmbers?: number;
  /** Simulated duration (s): sets the number of ring checkpoints and the snapshot history. */
  durationS: number;
  /** Display step (s); default 60. */
  snapshotIntervalS?: number;
  /** Measured typed-array bytes of the ScenarioData ({@link scenarioArrayBytes}); modelled from the grids when absent. */
  scenarioBytes?: number;
  /** 10 m grid (render mesh). */
  hiResNx?: number;
  hiResNy?: number;
  /** Aerial photo shown (texture). */
  imagery?: { width: number; height: number } | null;
  /** Render quality (mesh and tree budgets); default 'medium'. */
  renderQuality?: keyof typeof RENDER_MESH_N;
  /** The session's snapshot budget (bytes); default 150 MiB (the SnapshotStore default). */
  snapshotBudgetBytes?: number;
  /** Measurements that replace the model where known (from Simulation.memoryReport / SnapshotStore.totalBytes). */
  measured?: { checkpointBytes?: number; snapshotStoreBytes?: number };
}

const DEFAULT_SNAPSHOT_BUDGET = 150 * 1024 * 1024;

/** Atmosphere grid of a tier (atmosphere/grid.ts: Δx_a = clamp(extent / N_tier, 100 m, 270 m), levels per tier). */
export function atmosphereGrid(extentM: number, tier: QualityTier): { cellM: number; nx: number; ny: number; nz: number; columns: number } {
  const ts = ATMOS_TIERS[tier];
  const cellM = Math.min(ATMOS_PARAMS.maxCellSize, Math.max(ATMOS_PARAMS.minCellSize, extentM / ts.nTier));
  const n = Math.max(1, Math.round(extentM / cellM));
  return { cellM, nx: n, ny: n, nz: ts.levels, columns: n * n };
}

/** Typed-array bytes of a scenario (every buffer once: terrain, fuel, the 10 m DEM, fire history, places). */
export const scenarioArrayBytes = (s: ScenarioData): number => typedArrayFootprint(s).bytes;

/** Checkpoints a run of this length holds: the permanent t0 one plus one per 30 simulated minutes, up to the ring of 8. */
export const checkpointCount = (durationS: number): number => 1 + Math.min(SIM_PARAMS.checkpointRing, Math.max(0, Math.floor(durationS / SIM_PARAMS.checkpointIntervalS)));

const part = (c: PartCoeffs, cells: number, columns: number, embers: number): number => Math.round(c.perCell * cells + c.perColumn * columns + c.perEmber * embers + c.fixed);

const kb = (b: number): string => formatBytes(b);

// ─────────────────────────────────────────────────────────────────────────────
// The model
// ─────────────────────────────────────────────────────────────────────────────

/** Working memory of a run (see the file header for what is measured and what is modelled). */
export function workingMemory(i: MemoryModelInput): WorkingMemory {
  const tier: QualityTier = i.tier === 'auto' ? 'standard' : i.tier;
  const E = ENGINE_BYTES[tier];
  const cells = Math.max(0, Math.round(i.fireNx) * Math.round(i.fireNy));
  const atm = atmosphereGrid(i.extentM, tier);
  const embers = Math.max(1, Math.floor(i.maxEmbers ?? SIM_PARAMS.maxEmbersByTier[tier]));
  const step = i.snapshotIntervalS && i.snapshotIntervalS > 0 ? i.snapshotIntervalS : 60;
  const items: WorkingMemoryItem[] = [];
  const add = (id: string, label: string, where: MemoryWhere, bytes: number, formula: string, extra: { perCellBytes?: number; note?: string } = {}): void => {
    items.push({ id, label, where, bytes: Math.max(0, Math.round(bytes)), formula, ...(extra.perCellBytes !== undefined ? { perCellBytes: Math.round(extra.perCellBytes * 10) / 10 } : {}), ...(extra.note ? { note: extra.note } : {}) });
  };
  const cellsText = `${cells.toLocaleString('en-AU')} cells`;
  const colsText = `${atm.columns.toLocaleString('en-AU')} columns x ${atm.nz} levels`;

  // ── the scenario (measured when given): main thread + the worker's copy ──
  const scenarioBytes = i.scenarioBytes ?? Math.round(cells * 230 + (i.hiResNx ?? 0) * (i.hiResNy ?? 0) * 4);
  const measuredScenario = i.scenarioBytes !== undefined;
  add('scenario-main', 'Scenario data (terrain, fuel, 10 m ground, fire history, places)', 'main', scenarioBytes, measuredScenario ? `measured: every typed array of the scenario, ${kb(scenarioBytes)}` : `estimated: ${cellsText} x about 230 B + the 10 m grid x 4 B`, { perCellBytes: cells ? scenarioBytes / cells : 0 });
  add('scenario-worker', "The simulation worker's copy of the scenario", 'worker', scenarioBytes, 'the same bytes again: the scenario is copied (not moved) to the worker so the screen keeps its own');

  // ── engine (worker) ──
  const fire = part(E.fire, cells, atm.columns, embers);
  add('fire', 'Fire spread state', 'worker', fire, `${cellsText} x ${E.fire.perCell} B + ${kb(E.fire.fixed)} front bookkeeping`, { perCellBytes: E.fire.perCell, note: 'Grows a little with the burning front.' });
  const explain = part(E.explain, cells, atm.columns, embers);
  add('explain', 'Insight engine (why the fire does what it does)', 'worker', explain, `${cellsText} x ${E.explain.perCell} B + ${colsText.split(' x ')[0]} x ${E.explain.perColumn} B`, { perCellBytes: E.explain.perCell });
  const moisture = part(E.moisture, cells, atm.columns, embers);
  add('moisture', 'Fuel moisture model', 'worker', moisture, `${cellsText} x ${E.moisture.perCell} B`, { perCellBytes: E.moisture.perCell });
  const fuel = part(E.fuel, cells, atm.columns, embers);
  add('fuel', 'Working copies of the fuel map (edits apply to them)', 'worker', fuel, `${cellsText} x ${E.fuel.perCell} B`, { perCellBytes: E.fuel.perCell });
  const rasters = part(E.rasters, cells, atm.columns, embers);
  add('rasters', 'Wind, sun and environment rasters on the fire grid', 'worker', rasters, `${cellsText} x ${E.rasters.perCell} B`, { perCellBytes: E.rasters.perCell });
  const atmosphere = part(E.atmosphere, cells, atm.columns, embers);
  add(
    'atmosphere',
    tier === 'fast' ? 'Wind model (2-D, mass-consistent)' : `Atmosphere model (3-D, ${atm.nz} terrain-following levels)`,
    'worker',
    atmosphere,
    `${colsText} of ${Math.round(atm.cellM)} m: ${kb(E.atmosphere.perColumn)} per column + ${cellsText} x ${E.atmosphere.perCell} B`,
    { perCellBytes: cells ? atmosphere / cells : 0 },
  );
  const emberBytes = part(E.embers, cells, atm.columns, embers);
  add('embers', 'Ember particles and landing maps', 'worker', emberBytes, `${embers.toLocaleString('en-AU')} embers x ${E.embers.perEmber} B + ${cellsText} x ${E.embers.perCell} B`);
  const nCp = checkpointCount(i.durationS);
  const cp0 = part(E.checkpoint, cells, atm.columns, embers);
  const ring = Math.min(SIM_PARAMS.checkpointMaxBytes, (nCp - 1) * (cp0 + RING_CHECKPOINT_GROWTH_BYTES));
  const cpModel = cp0 + ring;
  const cpMeasured = i.measured?.checkpointBytes;
  add(
    'checkpoints',
    `Checkpoints for rewind (${nCp}: the start and every 30 min)`,
    'worker',
    cpMeasured ?? cpModel,
    cpMeasured !== undefined ? `measured: ${kb(cpMeasured)}` : `${nCp} x about ${kb(cp0)} (${cellsText} x ${E.checkpoint.perCell} B + ${atm.columns.toLocaleString('en-AU')} columns x ${E.checkpoint.perColumn} B), ring capped at ${kb(SIM_PARAMS.checkpointMaxBytes)}`,
    { note: 'Checkpoints taken while a large fire burns are bigger.' },
  );

  // ── snapshot history (main) ──
  const kfBytes = 256 + KEYFRAME_BYTES_PER_CELL * cells + atm.columns * (KEYFRAME_COLUMN_BYTES.surface + (tier === 'fast' ? 0 : atm.nz * KEYFRAME_COLUMN_BYTES.perLevel));
  const keyEvery = Math.max(300, step);
  const nKeys = Math.floor(i.durationS / keyEvery) + 1;
  const nFrames = Math.floor(i.durationS / step) + 1;
  const fireArrays = SNAPSHOT_FIRE_BYTES_PER_CELL * cells;
  const head = 2048 + fireArrays + kfBytes;
  const history = head + fireArrays * 3 + 4 * cells + nKeys * kfBytes + nFrames * (FRAME_BYTES + EMBER_FRAME_BYTES);
  const budget = i.snapshotBudgetBytes && i.snapshotBudgetBytes > 0 ? i.snapshotBudgetBytes : DEFAULT_SNAPSHOT_BUDGET;
  const snapMeasured = i.measured?.snapshotStoreBytes;
  add(
    'snapshots',
    'Time-scrubber history (fire front, keyframes every 5 min, one frame per step)',
    'main',
    snapMeasured ?? Math.min(budget, history),
    snapMeasured !== undefined
      ? `measured: ${kb(snapMeasured)} of a ${kb(budget)} budget`
      : `${nKeys} keyframes x ${kb(kfBytes)} + ${nFrames} frames x ${kb(FRAME_BYTES + EMBER_FRAME_BYTES)} + fire arrays; kept under ${kb(budget)} (older history is thinned)`,
  );

  // ── GPU (estimates) ──
  const q = i.renderQuality ?? 'medium';
  const hn = Math.max(i.hiResNx ?? 0, i.hiResNy ?? 0);
  const meshN = hn > 0 ? Math.min(hn, RENDER_MESH_N[q]) : RENDER_MESH_N[q];
  const meshBytes = meshN * meshN * 12 + (meshN - 1) * (meshN - 1) * 6 * (meshN * meshN > 65535 ? 4 : 2) + meshN * meshN * 4;
  add('gpu-terrain', 'Ground mesh and shading texture', 'gpu', meshBytes, `${meshN} x ${meshN} samples: positions 12 B + triangle indices + a 4 B shade texel each (estimate)`);
  const dataTex = cells * 16;
  add('gpu-data', 'Fire and heat-map textures on the fire grid', 'gpu', dataTex, `${cellsText} x about 16 B (about four float textures; estimate)`);
  if (i.imagery && i.imagery.width > 0 && i.imagery.height > 0) {
    const img = Math.round(i.imagery.width * i.imagery.height * 4 * (4 / 3));
    add('gpu-imagery', 'Aerial photo texture', 'gpu', img, `${i.imagery.width} x ${i.imagery.height} pixels x 4 B, plus a third for mipmaps (estimate)`);
  }
  const trees = RENDER_TREE_INSTANCES[q] * TREE_INSTANCE_BYTES;
  add('gpu-trees', 'Trees drawn in 3-D', 'gpu', trees, `up to ${RENDER_TREE_INSTANCES[q].toLocaleString('en-AU')} tree instances x about ${TREE_INSTANCE_BYTES} B (estimate)`);

  const sum = (w: MemoryWhere): number => items.filter((x) => x.where === w).reduce((a, x) => a + x.bytes, 0);
  const mainBytes = sum('main');
  const workerBytes = sum('worker');
  const gpuBytes = sum('gpu');
  const notes: string[] = [
    measuredScenario ? 'The scenario data are measured; the engine, the scrubber history and the GPU are modelled from the grid sizes.' : 'Every figure is modelled from the grid sizes.',
    `Engine figures reproduce measured runs within about 3 % (coefficients measured 2026-09-30 from the engine's own arrays).`,
    'GPU figures are estimates: WebGL does not report how much memory it uses.',
    'JavaScript objects (feature lists, labels, closures) are not counted: typed arrays hold nearly all the data.',
  ];
  if (i.tier === 'auto') notes.unshift('Auto tier: shown for Standard, where every run starts; the app may switch to Fast after timing this device, which uses less.');
  return { tier, items, totalBytes: mainBytes + workerBytes + gpuBytes, mainBytes, workerBytes, gpuBytes, cells, notes };
}

/** The working memory of a built scenario (its own grids, options and duration). */
export function workingMemoryForScenario(s: ScenarioData, o: Partial<Pick<MemoryModelInput, 'tier' | 'renderQuality' | 'snapshotBudgetBytes' | 'measured' | 'imagery'>> = {}): WorkingMemory {
  const g = s.terrain.grid;
  const tier = o.tier ?? s.options.tier ?? 'auto';
  const concrete: QualityTier = tier === 'auto' ? 'standard' : tier;
  // The engine uses the scenario's ember budget when it differs from the tier default (sim/simulation.ts).
  const maxEmbers = s.options.maxEmbers ?? SIM_PARAMS.maxEmbersByTier[concrete];
  return workingMemory({
    tier,
    fireNx: g.nx,
    fireNy: g.ny,
    extentM: s.extent,
    maxEmbers,
    durationS: s.duration,
    snapshotIntervalS: s.options.snapshotInterval,
    scenarioBytes: scenarioArrayBytes(s),
    ...(s.terrainHiRes ? { hiResNx: s.terrainHiRes.grid.nx, hiResNy: s.terrainHiRes.grid.ny } : {}),
    ...(o.imagery !== undefined ? { imagery: o.imagery } : {}),
    ...(o.renderQuality ? { renderQuality: o.renderQuality } : {}),
    ...(o.snapshotBudgetBytes ? { snapshotBudgetBytes: o.snapshotBudgetBytes } : {}),
    ...(o.measured ? { measured: o.measured } : {}),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Live reading
// ─────────────────────────────────────────────────────────────────────────────

interface PerfMemory {
  usedJSHeapSize?: number;
  totalJSHeapSize?: number;
  jsHeapSizeLimit?: number;
}

/**
 * The main thread's JavaScript heap from Chromium's non-standard `performance.memory` (Android WebView and Chrome
 * have it; Safari and Firefox do not). It covers the main thread only: the worker's and the GPU's memory are not in it.
 * Never throws; `available: false` with a plain note when the device does not tell.
 */
export function liveMemory(perf: unknown = (globalThis as { performance?: unknown }).performance, nowMs: number = Date.now()): LiveMemory {
  try {
    const m = (perf as { memory?: PerfMemory } | undefined)?.memory;
    const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
    if (!m || !ok(m.usedJSHeapSize)) return { available: false, note: 'Not available on this device: its browser engine does not report memory use.' };
    const out: LiveMemory = {
      available: true,
      usedJSHeapBytes: m.usedJSHeapSize,
      note: 'JavaScript heap of the screen thread only (the simulation worker and the graphics memory are not included); the browser rounds it.',
      measuredAt: nowMs,
    };
    if (ok(m.totalJSHeapSize)) out.totalJSHeapBytes = m.totalJSHeapSize;
    if (ok(m.jsHeapSizeLimit)) out.limitBytes = m.jsHeapSizeLimit;
    return out;
  } catch {
    return { available: false, note: 'Not available on this device: reading memory use failed.' };
  }
}
