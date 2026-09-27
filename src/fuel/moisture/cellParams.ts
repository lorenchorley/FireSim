/**
 * Per-cell fuel parameters the moisture model needs (a subset of `CellFuelParams`, spec §2.1), resolved once at
 * initialisation and after fuel edits.
 *
 * The normative resolver is `fuelParamsAt(fuel, k)` of `fuel/` (spec §4.7), the MoistureModel default. The local
 * adapter {@link localMoistureCellParams} reads the FuelMap fields and falls back to the §4.1 catalogue defaults
 * below (moisture family by FuelType only: class overrides such as classes 35, 39, 48 of §4.2 need `fuelParamsAt`);
 * the model also uses the table for the reference-column LAI of open cells.
 */
import { FuelType, type CellFuelParams, type FuelFamily, type FuelMap, type MoistureFamily } from '../../core/types';

/** What the moisture model reads per cell. `CellFuelParams` satisfies it. */
export type MoistureCellParams = Pick<CellFuelParams, 'type' | 'family' | 'moistureFamily' | 'cover' | 'lai' | 'wrf' | 'cRef' | 'moistureOffset'>;

/** Resolver of a cell's parameters (normally `fuelParamsAt` from fuel/). */
export type MoistureCellResolver = (fuel: FuelMap, k: number) => MoistureCellParams;

interface TypeDefaults {
  family: FuelFamily;
  moistureFamily: MoistureFamily;
  cover: number;
  lai: number;
  wrf: number;
  cRef: number;
}

/** Moisture-relevant columns of the §4.1 FUEL_TYPES table (family, cover, LAI, WRF, c_ref). */
export const MOISTURE_TYPE_DEFAULTS: Readonly<Record<FuelType, TypeDefaults>> = Object.freeze({
  [FuelType.NonFuel]: { family: 'none', moistureFamily: 'none', cover: 0, lai: 0, wrf: 1, cRef: 0 },
  [FuelType.Water]: { family: 'none', moistureFamily: 'none', cover: 0, lai: 0, wrf: 1, cRef: 0 },
  [FuelType.Grassland]: { family: 'grass', moistureFamily: 'grass', cover: 0, lai: 0, wrf: 1.2, cRef: 0 },
  [FuelType.GrassyWoodland]: { family: 'grass', moistureFamily: 'grass', cover: 0.3, lai: 1.0, wrf: 2.5, cRef: 0.3 },
  [FuelType.DryForestShrubby]: { family: 'vesta2', moistureFamily: 'forest', cover: 0.6, lai: 1.5, wrf: 3.5, cRef: 0.6 },
  [FuelType.DryForestGrassy]: { family: 'vesta2', moistureFamily: 'forest', cover: 0.5, lai: 1.2, wrf: 3.0, cRef: 0.5 },
  [FuelType.WetForest]: { family: 'vesta2', moistureFamily: 'wetForest', cover: 0.8, lai: 2.5, wrf: 4.5, cRef: 0.8 },
  [FuelType.Rainforest]: { family: 'vesta2', moistureFamily: 'wetForest', cover: 0.95, lai: 4.0, wrf: 5.0, cRef: 0.95 },
  [FuelType.Heath]: { family: 'heath', moistureFamily: 'heath', cover: 0.1, lai: 0.5, wrf: 1.5, cRef: 0 },
  [FuelType.AlpineHeathGrass]: { family: 'heath', moistureFamily: 'heath', cover: 0, lai: 0.3, wrf: 1.5, cRef: 0 },
  [FuelType.SnowGumWoodland]: { family: 'vesta2', moistureFamily: 'forest', cover: 0.5, lai: 1.2, wrf: 2.5, cRef: 0.5 },
  [FuelType.PinePlantation]: { family: 'pine', moistureFamily: 'pine', cover: 0.8, lai: 3.0, wrf: 4.0, cRef: 0.8 },
  [FuelType.Urban]: { family: 'grass', moistureFamily: 'grass', cover: 0.3, lai: 1.0, wrf: 1.2, cRef: 0.3 },
});

/**
 * Local adapter: cell parameters from the FuelMap arrays (CHM cover, per-cell WRF, moisture offset) and the
 * type defaults; LAI scales with cover as LAI_type·c/c_type (spec §5.4).
 */
export function localMoistureCellParams(fuel: FuelMap, k: number): MoistureCellParams {
  const type = fuel.type[k]! as FuelType;
  const d = MOISTURE_TYPE_DEFAULTS[type] ?? MOISTURE_TYPE_DEFAULTS[FuelType.NonFuel];
  const cc = fuel.canopyCover?.[k];
  const cover = cc !== undefined && Number.isFinite(cc) ? Math.min(1, Math.max(0, cc)) : d.cover;
  const lai = d.cover > 0 ? (d.lai * cover) / d.cover : d.lai;
  const w = fuel.wrf?.[k];
  const off = fuel.moistureOffset?.[k];
  return {
    type,
    family: d.family,
    moistureFamily: d.moistureFamily,
    cover,
    lai,
    wrf: w !== undefined && w > 0 ? w : d.wrf,
    cRef: d.cRef,
    moistureOffset: off !== undefined && Number.isFinite(off) ? off : 0,
  };
}
