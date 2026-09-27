/**
 * Fuel reference rows used by the point models (spec §4.1 steady-state rows, §4.2 class overrides, §6.1 dispatch,
 * §6.12 generic-fuel reference D45, §6.11 AFDRS-parity rows).
 *
 * The rows come from the authoritative catalogue `FUEL_TYPES` / `FUEL_CLASSES` of `src/fuel/catalogue.ts` (spec
 * §2.4). {@link registerFuelCatalogue} can substitute another catalogue (tests, what-if views); `null` restores it.
 */
import { FuelType, type BarkClass, type CellFuelParams, type FuelClassInfo, type FuelFamily, type FuelTypeInfo, type GrassState, type MoistureFamily } from '../../core/types';
import { FUEL_CLASSES, FUEL_TYPES } from '../../fuel/catalogue';
import { grassStateFromLoad } from './grass';
import { FIRE_MODEL_PARAMS } from './params';

/** The subset of a FuelTypeInfo row the models use (steady-state values). */
export interface ModelFuelRow {
  family: FuelFamily;
  moistureFamily: MoistureFamily;
  /** Steady-state layer loads (t/ha). */
  s: number;
  ns: number;
  el: number;
  bark: number;
  canopy: number;
  fhsS: number;
  fhsNs: number;
  fhsEl: number;
  /** Heights (m). */
  hNs: number;
  hEl: number;
  hO: number;
  cover: number;
  lai: number;
  wrf: number;
  grassWaf: number;
  grassState?: GrassState;
  wetSubmodel: boolean;
  spotting: boolean;
  barkClass: BarkClass;
  tauF: number;
  receptivity: number;
  cRef: number;
}

/** The model-relevant fields a FUEL_CLASSES row may override (spec §4.2). */
export interface ModelClassOverrides {
  family?: FuelFamily;
  moistureFamily?: MoistureFamily;
  grassState?: GrassState;
  curingOffset?: number;
  wrf?: number;
  spotting?: boolean;
}

let registeredTypes: Record<FuelType, FuelTypeInfo> = FUEL_TYPES;
let registeredClasses: FuelClassInfo[] = FUEL_CLASSES;
const rowCache = new Map<FuelType, ModelFuelRow>();
const classCache = new Map<number, ModelClassOverrides | null>();
const genericCache = new Map<FuelType, CellFuelParams>();

/** Substitute the fuel catalogue used for dispatch, generic reference and parity rows (`null` = fuel/ catalogue). */
export function registerFuelCatalogue(types: Record<FuelType, FuelTypeInfo> | null, classes: FuelClassInfo[] | null = null): void {
  registeredTypes = types ?? FUEL_TYPES;
  registeredClasses = classes ?? FUEL_CLASSES;
  rowCache.clear();
  classCache.clear();
  genericCache.clear();
}

function rowFromInfo(info: FuelTypeInfo): ModelFuelRow {
  const r: ModelFuelRow = {
    family: info.family, moistureFamily: info.moistureFamily, s: info.surface.load, ns: info.nearSurface.load, el: info.elevated.load,
    bark: info.bark.load, canopy: info.canopy.load, fhsS: info.fhsMax.surface, fhsNs: info.fhsMax.nearSurface, fhsEl: info.fhsMax.elevated,
    hNs: info.nearSurfaceHeight, hEl: info.elevatedHeight, hO: info.canopyHeight, cover: info.canopyCover, lai: info.lai, wrf: info.wrf,
    grassWaf: info.grassWaf ?? 1, wetSubmodel: info.wetSubmodel, spotting: info.spotting, barkClass: info.barkClass,
    tauF: info.flameResidence, receptivity: info.receptivity, cRef: info.moistureRefCanopy,
  };
  if (info.grassStateDefault) r.grassState = info.grassStateDefault;
  return r;
}

/** Steady-state row of a fuel type (unknown types resolve to NonFuel). */
export function fuelRow(type: FuelType): ModelFuelRow {
  let r = rowCache.get(type);
  if (!r) {
    r = rowFromInfo(registeredTypes[type] ?? registeredTypes[FuelType.NonFuel]);
    rowCache.set(type, r);
  }
  return r;
}

/** Model-relevant class overrides for a fuel class id (null for generic classes 0–12 and unknown ids). */
export function classOverrides(fuelClass: number | undefined): ModelClassOverrides | null {
  if (fuelClass === undefined || fuelClass < 13) return null;
  let o = classCache.get(fuelClass);
  if (o === undefined) {
    const c = registeredClasses[fuelClass];
    if (!c) o = null;
    else {
      const r: ModelClassOverrides = {};
      if (c.overrides.family) r.family = c.overrides.family;
      if (c.overrides.moistureFamily) r.moistureFamily = c.overrides.moistureFamily;
      const gs = c.grassState ?? c.overrides.grassStateDefault;
      if (gs) r.grassState = gs;
      if (c.curingOffset !== undefined) r.curingOffset = c.curingOffset;
      if (c.overrides.wrf !== undefined) r.wrf = c.overrides.wrf;
      if (c.overrides.spotting !== undefined) r.spotting = c.overrides.spotting;
      o = r;
    }
    classCache.set(fuelClass, o);
  }
  return o;
}

/** Model family of a (type, class) pair: `FUEL_CLASSES[c].overrides.family ?? FUEL_TYPES[type].family` (spec §4.2, §6.1). */
export function familyOf(type: FuelType, fuelClass?: number): FuelFamily {
  return classOverrides(fuelClass)?.family ?? fuelRow(type).family;
}

/** Moisture family of a (type, class) pair. */
export function moistureFamilyOf(type: FuelType, fuelClass?: number): MoistureFamily {
  return classOverrides(fuelClass)?.moistureFamily ?? fuelRow(type).moistureFamily;
}

/** Grass WAF of a type row for an overstorey cover (GrassyWoodland: 0.5 below 30 % cover, else 0.3). */
export function grassWafFor(type: FuelType, cover: number): number {
  if (type === FuelType.GrassyWoodland) {
    const g = FIRE_MODEL_PARAMS.grass;
    return cover < g.woodlandCoverSplit ? g.woodlandWafOpen : g.woodlandWafClosed;
  }
  return fuelRow(type).grassWaf;
}

/** CellFuelParams of a steady-state type row (generic class = type id; grass reference: natural state at curing 100). */
export function cellParamsFromRow(type: FuelType, row: ModelFuelRow, grassReference = false): CellFuelParams {
  const barkHazard = row.bark <= 0 ? 0 : row.bark <= 1 ? 1 : row.bark <= 2 ? 2 : row.bark <= 5 ? 3 : 4; // §4.5 step table
  return {
    type, fuelClass: type, family: row.family, moistureFamily: row.moistureFamily,
    surfaceLoad: row.s, nearSurfaceLoad: row.ns, elevatedLoad: row.el, barkLoad: row.bark, canopyLoad: row.canopy,
    fhsS: row.fhsS, fhsNs: row.fhsNs, fhsEl: row.fhsEl, barkHazard, hNs: row.hNs, hEl: row.hEl, hO: row.hO, hOEff: row.hO,
    cover: row.cover, lai: row.lai, wrf: row.wrf,
    grassState: grassReference ? 'natural' : (row.grassState ?? grassStateFromLoad(row.s + row.ns)),
    grassWaf: grassWafFor(type, row.cover), curing: 100, underWoodland: false, wetSubmodel: row.wetSubmodel,
    spotting: row.spotting, barkClass: row.barkClass, tauF: row.tauF, receptivity: row.receptivity, cRef: row.cRef,
    faBlendW: 0, moistureOffset: 0, flags: 0, timeSinceFire: NaN,
  };
}

/**
 * Generic-fuel reference of spec §6.12 (D45): the steady-state type row (generic class, type WRF; grass: natural
 * state at curing 100). Cached per type; do not mutate.
 */
export function genericCellParams(type: FuelType): CellFuelParams {
  let g = genericCache.get(type);
  if (!g) {
    g = cellParamsFromRow(type, fuelRow(type), true);
    genericCache.set(type, g);
  }
  return g;
}
