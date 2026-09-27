/**
 * The only place explain/ imports other simulation modules (spec §2.4 signatures). If a producer moves or renames a
 * function, this adapter is the one file to change. Everything imported here is a pure function of its arguments.
 *
 * - fuel/ (§4.1–4.2): FUEL_TYPES, resolveClass (class → merged type row).
 * - fuel/moisture (§5.3): afdrsMoisture (AFDRS-equivalent M_A per moisture family).
 * - fire/models (§6.4, §6.8, §6.10, §6.11): ffdi, mk5 (flat ROS for the DMZ estimate), lengthToBreadth + ellipse
 *   coefficients, spottingEnvelope, afdrsFbi (S13 "FBI ≥ 50" branch).
 * - fuel/fuelMap (§4.7): fuelSummary (the "Why here?" fuel line).
 */
import { FuelType, type FuelFamily, type FuelMap, type MoistureFamily } from '../core/types';
import { FUEL_TYPES, resolveClass } from '../fuel/catalogue';

export { FUEL_TYPES, resolveClass };
export { afdrsMoisture } from '../fuel/moisture/afdrs';
export { ffdi, mk5 } from '../fire/models/mcarthur';
export { lengthToBreadth, ellipseCoefficients, createEllipseCoeffs } from '../fire/models/shape';
export type { EllipseCoeffs } from '../fire/models/shape';
export { spottingEnvelope } from '../fire/models/spotting';
export { afdrsFbi } from '../fire/models/fbi';
export { fuelSummary } from '../fuel/fuelMap';

/** Class-resolved fuel family of cell k (class overrides the type, e.g. Alpine Herbfields → grass). */
export function familyAt(fuel: FuelMap, k: number): FuelFamily {
  const cls = fuel.fuelClass?.[k];
  if (cls !== undefined && cls !== 255) return resolveClass(cls).family;
  return FUEL_TYPES[fuel.type[k] as FuelType]?.family ?? 'none';
}

/** Class-resolved moisture family of cell k. */
export function moistureFamilyAt(fuel: FuelMap, k: number): MoistureFamily {
  const cls = fuel.fuelClass?.[k];
  if (cls !== undefined && cls !== 255) return resolveClass(cls).moistureFamily;
  return FUEL_TYPES[fuel.type[k] as FuelType]?.moistureFamily ?? 'none';
}

/** Plain name of the cell's fuel (class name when a class is set). */
export function fuelNameAt(fuel: FuelMap, k: number): string {
  const cls = fuel.fuelClass?.[k];
  const t = FUEL_TYPES[fuel.type[k] as FuelType];
  if (cls !== undefined && cls !== 255 && cls > 12) return resolveClass(cls).className;
  return t?.name ?? 'Unknown fuel';
}

/** H_o,eff (m) of cell k: the fuel map value, else max(canopy height, 0.8 × type default) (spec §4.7). */
export function canopyHeightEffAt(fuel: FuelMap, k: number): number {
  const v = fuel.canopyHeightEff?.[k];
  if (v !== undefined && Number.isFinite(v)) return v;
  const t = FUEL_TYPES[fuel.type[k] as FuelType];
  const fam = t?.family ?? 'none';
  if (fam === 'grass' || fam === 'heath' || fam === 'none') return 0;
  return Math.max(fuel.canopyHeight[k] ?? 0, 0.8 * (t?.canopyHeight ?? 0));
}

/** True for fuel types that cannot carry fire (rock, water). */
export const isNonFuel = (type: number): boolean => type === FuelType.NonFuel || type === FuelType.Water;
