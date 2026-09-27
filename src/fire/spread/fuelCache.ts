/**
 * Static per-cell fuel cache of the spread model (spec docs/research/00-synthesis.md §7.1 "static cache per cell
 * (built at init and after edits): CellFuelParams …").
 *
 * 90 000 `CellFuelParams` objects would cost ≈ 50 MB of V8 heap in the worker, so the resolved parameters
 * (`fuelParamsAt` of fuel/, with all its class/type fallbacks) are stored once as a struct of typed arrays and
 * re-materialised into one reusable scratch object on demand ({@link FuelCache.load}); the hot path only needs them
 * when the kernel is re-evaluated (R_w cache miss) and at arrival. Fields that no fire kernel reads (near-surface
 * hazard/height, bark load, LAI, c_ref, FA blend weight, moisture offset, time since fire) are not cached: `load`
 * leaves them at neutral values (the moisture model owns them; env.moisture/availability already include them).
 */
import { FuelType, type BarkClass, type CellFuelParams, type FuelFamily, type FuelMap, type GrassState, type MoistureFamily } from '../../core/types';
import { fuelParamsInto, makeCellFuelParams } from '../../fuel/fuelMap';
import { FIRE_MODEL_PARAMS } from '../models/params';

export const FAMILIES: readonly FuelFamily[] = ['none', 'vesta2', 'grass', 'heath', 'pine'];
export const MOISTURE_FAMILIES: readonly MoistureFamily[] = ['none', 'forest', 'wetForest', 'heath', 'grass', 'pine'];
export const GRASS_STATES: readonly GrassState[] = ['natural', 'grazed', 'eatenOut'];
export const BARK_CLASSES: readonly BarkClass[] = ['none', 'smooth', 'stringy', 'ribbon', 'mixed'];

export const FAM_NONE = 0;
export const FAM_VESTA2 = 1;
export const FAM_GRASS = 2;
export const FAM_HEATH = 3;
export const FAM_PINE = 4;

const codeOf = <T>(list: readonly T[], v: T): number => {
  const i = list.indexOf(v);
  return i < 0 ? 0 : i;
};

/** Struct-of-arrays copy of the resolved CellFuelParams of every fire-grid cell. */
export class FuelCache {
  readonly n: number;
  readonly type: Uint8Array;
  readonly fuelClass: Uint8Array;
  readonly family: Uint8Array;
  readonly moistureFamily: Uint8Array;
  readonly grassState: Uint8Array;
  readonly barkClass: Uint8Array;
  /** bit 0 underWoodland, 1 wetSubmodel, 2 spotting */
  readonly bits: Uint8Array;
  readonly flags: Uint16Array;
  readonly surfaceLoad: Float32Array;
  readonly nearSurfaceLoad: Float32Array;
  readonly elevatedLoad: Float32Array;
  readonly canopyLoad: Float32Array;
  readonly fhsS: Float32Array;
  readonly fhsEl: Float32Array;
  readonly barkHazard: Float32Array;
  readonly hEl: Float32Array;
  readonly hO: Float32Array;
  readonly hOEff: Float32Array;
  readonly cover: Float32Array;
  readonly wrf: Float32Array;
  readonly grassWaf: Float32Array;
  readonly curing: Float32Array;
  readonly tauF: Float32Array;
  readonly receptivity: Float32Array;
  /** 1 where the family has enough fine fuel to spread at all (FIRE_MODEL_PARAMS.minFineLoad). */
  readonly spreadable: Uint8Array;

  private readonly scratch: CellFuelParams = makeCellFuelParams();

  constructor(fuel: FuelMap) {
    const n = fuel.grid.nx * fuel.grid.ny;
    this.n = n;
    this.type = new Uint8Array(n);
    this.fuelClass = new Uint8Array(n);
    this.family = new Uint8Array(n);
    this.moistureFamily = new Uint8Array(n);
    this.grassState = new Uint8Array(n);
    this.barkClass = new Uint8Array(n);
    this.bits = new Uint8Array(n);
    this.flags = new Uint16Array(n);
    const f32 = (): Float32Array => new Float32Array(n);
    this.surfaceLoad = f32();
    this.nearSurfaceLoad = f32();
    this.elevatedLoad = f32();
    this.canopyLoad = f32();
    this.fhsS = f32();
    this.fhsEl = f32();
    this.barkHazard = f32();
    this.hEl = f32();
    this.hO = f32();
    this.hOEff = f32();
    this.cover = f32();
    this.wrf = f32();
    this.grassWaf = f32();
    this.curing = f32();
    this.tauF = f32();
    this.receptivity = f32();
    this.spreadable = new Uint8Array(n);
    for (let k = 0; k < n; k++) this.refresh(fuel, k);
  }

  /** Re-resolve cell k from the fuel map (after an edit). */
  refresh(fuel: FuelMap, k: number): void {
    const p = fuelParamsInto(fuel, k, this.scratch);
    this.type[k] = p.type;
    this.fuelClass[k] = p.fuelClass;
    this.family[k] = codeOf(FAMILIES, p.family);
    this.moistureFamily[k] = codeOf(MOISTURE_FAMILIES, p.moistureFamily);
    this.grassState[k] = codeOf(GRASS_STATES, p.grassState);
    this.barkClass[k] = codeOf(BARK_CLASSES, p.barkClass);
    this.bits[k] = (p.underWoodland ? 1 : 0) | (p.wetSubmodel ? 2 : 0) | (p.spotting ? 4 : 0);
    this.flags[k] = p.flags;
    this.surfaceLoad[k] = p.surfaceLoad;
    this.nearSurfaceLoad[k] = p.nearSurfaceLoad;
    this.elevatedLoad[k] = p.elevatedLoad;
    this.canopyLoad[k] = p.canopyLoad;
    this.fhsS[k] = p.fhsS;
    this.fhsEl[k] = p.fhsEl;
    this.barkHazard[k] = p.barkHazard;
    this.hEl[k] = p.hEl;
    this.hO[k] = p.hO;
    this.hOEff[k] = p.hOEff;
    this.cover[k] = p.cover;
    this.wrf[k] = p.wrf;
    this.grassWaf[k] = p.grassWaf;
    this.curing[k] = p.curing;
    this.tauF[k] = p.tauF;
    this.receptivity[k] = p.receptivity;
    const min = FIRE_MODEL_PARAMS.minFineLoad;
    const fl = p.surfaceLoad + p.nearSurfaceLoad;
    let ok = false;
    switch (p.family) {
      case 'vesta2':
        ok = fl >= min.vesta2;
        break;
      case 'pine':
        ok = fl >= min.pine;
        break;
      case 'grass':
        ok = fl >= min.grass;
        break;
      case 'heath':
        ok = fl + p.elevatedLoad >= min.heath;
        break;
      default:
        ok = false;
    }
    this.spreadable[k] = ok && p.type !== FuelType.NonFuel && p.type !== FuelType.Water ? 1 : 0;
  }

  /** Family string of cell k. */
  familyOf(k: number): FuelFamily {
    return FAMILIES[this.family[k]!]!;
  }

  /** Fill `out` with the parameters of cell k (no allocation; uncached fields neutral, see the class note). */
  load(k: number, out: CellFuelParams): CellFuelParams {
    out.fhsNs = 0;
    out.barkLoad = 0;
    out.hNs = 0;
    out.lai = 0;
    out.cRef = 0;
    out.faBlendW = 0;
    out.moistureOffset = 0;
    out.timeSinceFire = NaN;
    out.type = this.type[k]! as FuelType;
    out.fuelClass = this.fuelClass[k]!;
    out.family = FAMILIES[this.family[k]!]!;
    out.moistureFamily = MOISTURE_FAMILIES[this.moistureFamily[k]!]!;
    out.surfaceLoad = this.surfaceLoad[k]!;
    out.nearSurfaceLoad = this.nearSurfaceLoad[k]!;
    out.elevatedLoad = this.elevatedLoad[k]!;
    out.canopyLoad = this.canopyLoad[k]!;
    out.fhsS = this.fhsS[k]!;
    out.fhsEl = this.fhsEl[k]!;
    out.barkHazard = this.barkHazard[k]!;
    out.hEl = this.hEl[k]!;
    out.hO = this.hO[k]!;
    out.hOEff = this.hOEff[k]!;
    out.cover = this.cover[k]!;
    out.wrf = this.wrf[k]!;
    out.grassState = GRASS_STATES[this.grassState[k]!]!;
    out.grassWaf = this.grassWaf[k]!;
    out.curing = this.curing[k]!;
    const b = this.bits[k]!;
    out.underWoodland = (b & 1) !== 0;
    out.wetSubmodel = (b & 2) !== 0;
    out.spotting = (b & 4) !== 0;
    out.barkClass = BARK_CLASSES[this.barkClass[k]!]!;
    out.tauF = this.tauF[k]!;
    out.receptivity = this.receptivity[k]!;
    out.flags = this.flags[k]!;
    return out;
  }
}
