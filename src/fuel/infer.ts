/**
 * Vegetation inference where SVTM is missing or "Not classified" (spec §4.3) [H rules, calibrated on the demo
 * statistics: "Not classified" cells have median CHM cover 0.05 and height ≈ 1 m, i.e. cleared land and towns].
 *
 * Rules in order, per cell:
 * 1. cliffFraction ≥ 0.5 or slope ≥ 55° → NonFuel (rock, cliff).
 * 2. With valid canopy data (CHM p90 height h, cover c):
 *    c < 0.15: h < 3 → Grassland (grazed; "cleared land or town? edit if urban"), else GrassyWoodland;
 *    c ≥ 0.15 and h < 6 → Heath (AlpineHeathGrass above 1500 m);
 *    0.15 ≤ c < 0.4 and h ≥ 6 → GrassyWoodland (SnowGumWoodland above 1500 m);
 *    c ≥ 0.4 and h ≥ 6 → SnowGumWoodland above 1500 m; WetForest in Gully/ValleyFloor/LowerSlope with a southern-half
 *    aspect (90° < a < 270°, false when NaN) and h ≥ 15; else DryForestShrubby.
 * 3. Without canopy data (or valid = 0): > 1850 m AlpineHeathGrass; > 1500 m SnowGumWoodland; Gully/ValleyFloor with
 *    slope < 30° and southern aspect → WetForest; else DryForestShrubby.
 * Urban land cannot be recognised from these layers: the user paints it (setType Urban).
 */
import { FuelType, Landform, type Terrain } from '../core/types';
import { resolveFuelParams, type FuelParams } from './params';

/** Canopy rasters on the fire grid (CHM p90 height m, cover 0–1, valid 0/1). */
export interface CanopyInput {
  height: Float32Array;
  cover: Float32Array;
  valid?: Uint8Array;
}

/** Southern half test of §4.3 (aspect = downhill azimuth; NaN on flat cells → false). */
export const southernAspect = (a: number): boolean => a > 90 && a < 270;

/**
 * Infer a FuelType for every cell from terrain and (optionally) canopy (§4.3). Returns FuelType codes (Uint8).
 * `mask` (optional): only cells with mask[k] ≠ 0 are evaluated; the others are left 0 (NonFuel).
 */
export function inferFuelTypes(terrain: Terrain, canopy?: CanopyInput | null, mask?: Uint8Array | null, params?: Partial<FuelParams>): Uint8Array {
  const P = resolveFuelParams(params);
  const n = terrain.elevation.length;
  const out = new Uint8Array(n);
  const z = terrain.elevation;
  const s = terrain.slopeDeg;
  const asp = terrain.aspectDeg;
  const lf = terrain.landform;
  const cliff = terrain.cliffFraction;
  const H = canopy?.height;
  const C = canopy?.cover;
  const V = canopy?.valid;
  for (let k = 0; k < n; k++) {
    if (mask && mask[k] === 0) continue;
    out[k] = inferCell(z[k]!, s[k]!, asp[k]!, lf[k]!, cliff ? cliff[k]! : 0, H && C && (!V || V[k] === 1) ? H[k]! : NaN, C ? C[k]! : NaN, P);
  }
  return out;
}

/** One cell of §4.3; h/c = NaN when there is no valid canopy value. */
export function inferCell(z: number, slope: number, aspect: number, landform: number, cliffFraction: number, h: number, c: number, P: FuelParams): FuelType {
  if (cliffFraction >= P.inferCliffFraction || slope >= P.inferCliffSlopeDeg) return FuelType.NonFuel;
  const alpine = z > P.inferAlpineTreelineM;
  if (Number.isFinite(h) && Number.isFinite(c)) {
    if (c < P.inferCoverOpen) return h < P.inferHeightShrubM ? FuelType.Grassland : FuelType.GrassyWoodland;
    if (h < P.inferHeightTreeM) return alpine ? FuelType.AlpineHeathGrass : FuelType.Heath;
    if (c < P.inferCoverForest) return alpine ? FuelType.SnowGumWoodland : FuelType.GrassyWoodland;
    if (alpine) return FuelType.SnowGumWoodland;
    const low = landform === Landform.Gully || landform === Landform.ValleyFloor || landform === Landform.LowerSlope;
    if (low && southernAspect(aspect) && h >= P.inferHeightWetForestM) return FuelType.WetForest;
    return FuelType.DryForestShrubby;
  }
  if (z > P.inferAlpineHeathM) return FuelType.AlpineHeathGrass;
  if (alpine) return FuelType.SnowGumWoodland;
  if ((landform === Landform.Gully || landform === Landform.ValleyFloor) && slope < P.inferWetGullyMaxSlopeDeg && southernAspect(aspect)) return FuelType.WetForest;
  return FuelType.DryForestShrubby;
}
