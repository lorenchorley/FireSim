/**
 * `buildDemoFuel(siteId, terrain, t0)`: the fuel map of a bundled demo site from its SVTM vegetation, NPWS fire
 * history and Meta/WRI canopy (public/demo/<site>/), for tests and dev harnesses. Runs in Node (the asset loader reads
 * public/) and in the browser / worker. The production path is scenario/ (spec §11.6), which calls the same functions.
 */
import { localDate } from '../core/physics';
import type { Terrain, VegetationRecord } from '../core/types';
import { loadCanopy, loadDemoFireHistoryGeoJson, loadDemoVegetationGeoJson, type CanopyResult } from '../data';
import { terrainDerived } from '../terrain';
import { buildFuelMap, type FuelMapExt } from './fuelMap';
import { emptyHistory, parseFireHistoryWithMeta, rasteriseFireHistory, type HistoryRaster } from './history';
import type { FuelParams } from './params';
import { parseVegetation, rasteriseVegetation } from './svtm';
import { CLASS_INFER } from './catalogue';

export interface DemoFuelOptions {
  /** Drought inputs (default: the §11.6 "drought defaults" DF 7, KBDI 60). */
  droughtFactor?: number;
  kbdi?: number;
  params?: Partial<FuelParams>;
  /** Skip the canopy raster (tests of the no-canopy inference path). */
  noCanopy?: boolean;
  /** Skip the SVTM vegetation (tests of inference). */
  noVegetation?: boolean;
  signal?: AbortSignal;
}

export interface DemoFuel {
  fuel: FuelMapExt;
  history: HistoryRaster;
  classId: Uint8Array;
  minorityWet: Uint8Array;
  vegetation: VegetationRecord[];
  canopy: CanopyResult | null;
  warnings: string[];
}

/** Load and build the demo site's fuel map on `terrain.grid` (the fire grid) at scenario start t0. */
export async function buildDemoFuel(siteId: string, terrain: Terrain, t0: number, opts: DemoFuelOptions = {}): Promise<DemoFuel> {
  const grid = terrain.grid;
  const n = grid.nx * grid.ny;
  const warnings: string[] = [];
  const [vegJson, fireJson, canopy] = await Promise.all([
    opts.noVegetation ? Promise.resolve(null) : loadDemoVegetationGeoJson(siteId, opts.signal),
    loadDemoFireHistoryGeoJson(siteId, opts.signal),
    opts.noCanopy ? Promise.resolve(null) : loadCanopy(grid, { demoSiteId: siteId, signal: opts.signal }),
  ]);
  const vegetation = vegJson ? parseVegetation(vegJson) : [];
  let classId: Uint8Array;
  let minorityWet: Uint8Array;
  if (vegetation.length) ({ classId, minorityWet } = rasteriseVegetation(grid, vegetation, terrain));
  else {
    classId = new Uint8Array(n).fill(CLASS_INFER);
    minorityWet = new Uint8Array(n);
    warnings.push('Vegetation inferred from terrain');
  }
  let history: HistoryRaster;
  if (fireJson) {
    const parsed = parseFireHistoryWithMeta(fireJson, opts.params);
    history = rasteriseFireHistory(grid, parsed.records, t0, { params: opts.params, verDate: parsed.verDate });
  } else history = emptyHistory(grid);
  warnings.push(...history.warnings);
  if (!canopy && !opts.noCanopy) warnings.push('Canopy unavailable (type defaults)');
  const fuel = buildFuelMap({
    terrain,
    derived: terrainDerived(terrain),
    classId,
    minorityWet,
    history,
    canopy: canopy ? { height: canopy.height, cover: canopy.cover, valid: canopy.valid } : null,
    t0,
    droughtFactor: opts.droughtFactor ?? 7,
    kbdi: opts.kbdi ?? 60,
    month: Number(localDate(t0).slice(5, 7)),
    ...(opts.params ? { params: opts.params } : {}),
  }) as FuelMapExt;
  return { fuel, history, classId, minorityWet, vegetation, canopy, warnings };
}
