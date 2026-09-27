/**
 * Fuel-type catalogue and fuel classes (spec docs/research/00-synthesis.md §4.1, §4.2).
 *
 * - `FUEL_TYPES`: one row per FuelType (§4.1). Loads are steady-state fine fuel (t/ha, oven-dry) from the NSW RFS fuel
 *   LUT v4.02 rows named in the spec [V as parsed from PyroXL, doc 05 §3.2] unless the spec tags them [H]; the tags are
 *   repeated in the comments below. τ_f, receptivity and the colours are FireSim design values [H].
 * - `FUEL_CLASSES`: NSW LUT-like rows that override the type defaults. Index = class id (Uint8 `FuelMap.fuelClass`).
 *   Classes 0..12 are the generic classes of FuelType 0..12; 13..48 are the SVTM vegetation classes of §4.2.
 * - `resolveClass(id)`: the class merged onto its type row, precomputed once (used by every per-cell routine).
 *
 * The SVTM → heath / rainforest / grassland / wetland rows are [H] and need NSW RFS review (§16 item 5).
 */
import { FuelType, FUEL_TYPE_COUNT, type FuelClassInfo, type FuelTypeInfo, type GrassState, type LayerParams } from '../core/types';
import { fhsFromLoad } from './hazard';

const L = (load: number, k: number): LayerParams => ({ load, k });
const ZERO = L(0, 0);

/** §4.1 catalogue. Comments give the LUT row and the evidence tag of each non-[V] value. */
export const FUEL_TYPES: Record<FuelType, FuelTypeInfo> = {
  [FuelType.NonFuel]: {
    id: FuelType.NonFuel, name: 'Non-fuel (rock, cliff, road)', family: 'none', moistureFamily: 'none', afdrsType: 'Non-combustible',
    surface: ZERO, nearSurface: ZERO, elevated: ZERO, bark: ZERO, canopy: ZERO,
    fhsMax: { surface: 0, nearSurface: 0, elevated: 0 }, nearSurfaceHeight: 0, elevatedHeight: 0,
    canopyHeight: 0, canopyCover: 0, lai: 0, wrf: 1, wetSubmodel: false, spotting: false, barkClass: 'none',
    flameResidence: 0, receptivity: 0, moistureRefCanopy: 0, colour: '#9e9e9e',
  },
  [FuelType.Water]: {
    id: FuelType.Water, name: 'Water', family: 'none', moistureFamily: 'none', afdrsType: 'Non-combustible',
    surface: ZERO, nearSurface: ZERO, elevated: ZERO, bark: ZERO, canopy: ZERO,
    fhsMax: { surface: 0, nearSurface: 0, elevated: 0 }, nearSurfaceHeight: 0, elevatedHeight: 0,
    canopyHeight: 0, canopyCover: 0, lai: 0, wrf: 1, wetSubmodel: false, spotting: false, barkClass: 'none',
    flameResidence: 0, receptivity: 0, moistureRefCanopy: 0, colour: '#3b7dd8',
  },
  // LUT 58 Native grasslands (total 5.1, k 0.9); FHS 1/3/0, heights, τ_f [H].
  [FuelType.Grassland]: {
    id: FuelType.Grassland, name: 'Grassland', family: 'grass', moistureFamily: 'grass', afdrsType: 'Grassland',
    surface: L(1.0, 0.9), nearSurface: L(4.1, 0.9), elevated: ZERO, bark: ZERO, canopy: ZERO,
    fhsMax: { surface: 1, nearSurface: 3, elevated: 0 }, nearSurfaceHeight: 0.3, elevatedHeight: 0,
    canopyHeight: 0, canopyCover: 0, lai: 0, wrf: 1.2, grassWaf: 1.0, wetSubmodel: false, spotting: false, barkClass: 'none',
    tfi: { minSfaz: 2, minLmz: 3, max: 10 }, flameResidence: 10, receptivity: 1.0, moistureRefCanopy: 0, colour: '#e3c565',
  },
  // LUT 38 Southern tableland grassy woodlands; H_ns / H_el and τ_f [H]. grassWaf 0.5 (cover < 0.3) / 0.3 at build.
  [FuelType.GrassyWoodland]: {
    id: FuelType.GrassyWoodland, name: 'Grassy woodland', family: 'grass', moistureFamily: 'grass', afdrsType: 'Woodland',
    surface: L(8, 0.4), nearSurface: L(2, 0.4), elevated: L(0.5, 0.2), bark: L(2.11, 0.1), canopy: L(4.5, 0.3),
    fhsMax: { surface: 3.0, nearSurface: 2.6, elevated: 2.2 }, nearSurfaceHeight: 0.2, elevatedHeight: 1.0,
    canopyHeight: 15, canopyCover: 0.3, lai: 1.0, wrf: 2.5, grassWaf: 0.5, wetSubmodel: false, spotting: true, barkClass: 'mixed',
    tfi: { minSfaz: 5, minLmz: 8, max: 40 }, flameResidence: 15, receptivity: 0.9, moistureRefCanopy: 0.3, colour: '#b9c46a',
  },
  // LUT 30 Sydney montane DSF; H_o 20 [H], τ_f [H].
  [FuelType.DryForestShrubby]: {
    id: FuelType.DryForestShrubby, name: 'Dry forest (shrubby)', family: 'vesta2', moistureFamily: 'forest', afdrsType: 'Forest',
    surface: L(14.5, 0.17), nearSurface: L(1.9, 0.17), elevated: L(4.9, 0.2), bark: L(2.67, 0.1), canopy: L(3.5, 0.3),
    fhsMax: { surface: 3.4, nearSurface: 2.9, elevated: 3.3 }, nearSurfaceHeight: 0.2, elevatedHeight: 2.0,
    canopyHeight: 20, canopyCover: 0.6, lai: 1.5, wrf: 3.5, wetSubmodel: false, spotting: true, barkClass: 'stringy',
    tfi: { minSfaz: 7, minLmz: 10, max: 30 }, flameResidence: 45, receptivity: 1.0, moistureRefCanopy: 0.6, colour: '#6b8e3a',
  },
  // LUT 16 Central gorge DSF, near-surface and FHS blended with 32 [H]; heights, τ_f [H].
  [FuelType.DryForestGrassy]: {
    id: FuelType.DryForestGrassy, name: 'Dry forest (grassy)', family: 'vesta2', moistureFamily: 'forest', afdrsType: 'Forest',
    surface: L(11, 0.3), nearSurface: L(2.0, 0.3), elevated: L(2, 0.2), bark: L(3.0, 0.1), canopy: L(4.5, 0.3),
    fhsMax: { surface: 3.0, nearSurface: 2.8, elevated: 2.0 }, nearSurfaceHeight: 0.25, elevatedHeight: 1.0,
    canopyHeight: 20, canopyCover: 0.5, lai: 1.2, wrf: 3.0, wetSubmodel: false, spotting: true, barkClass: 'mixed',
    tfi: { minSfaz: 5, minLmz: 8, max: 50 }, flameResidence: 40, receptivity: 1.0, moistureRefCanopy: 0.5, colour: '#9aa84a',
  },
  // LUT 5 Southern escarpment WSF; H_o 35 [H], τ_f [H]. TFI = WSF shrubby (doc 05 §3.5).
  [FuelType.WetForest]: {
    id: FuelType.WetForest, name: 'Wet forest', family: 'vesta2', moistureFamily: 'wetForest', afdrsType: 'Wet Forest',
    surface: L(17, 0.35), nearSurface: L(2, 0.35), elevated: L(3, 0.15), bark: L(4.0, 0.1), canopy: L(6.9, 0.35),
    fhsMax: { surface: 3.7, nearSurface: 3.0, elevated: 3.1 }, nearSurfaceHeight: 0.2, elevatedHeight: 2.0,
    canopyHeight: 35, canopyCover: 0.8, lai: 2.5, wrf: 4.5, wetSubmodel: true, spotting: true, barkClass: 'mixed',
    tfi: { minSfaz: 25, minLmz: 30, max: 60 }, flameResidence: 60, receptivity: 0.5, moistureRefCanopy: 0.8, colour: '#2f7a4f',
  },
  // LUT 1 Rainforests; τ_f [H].
  [FuelType.Rainforest]: {
    id: FuelType.Rainforest, name: 'Rainforest', family: 'vesta2', moistureFamily: 'wetForest', afdrsType: 'Rainforest',
    surface: L(8, 0.75), nearSurface: L(1, 0.75), elevated: L(1, 0.3), bark: L(1, 0.1), canopy: L(8, 0.3),
    fhsMax: { surface: 2.8, nearSurface: 2.4, elevated: 2.6 }, nearSurfaceHeight: 0.2, elevatedHeight: 2.0,
    canopyHeight: 30, canopyCover: 0.95, lai: 4.0, wrf: 5.0, wetSubmodel: true, spotting: false, barkClass: 'smooth',
    tfi: 'avoid', flameResidence: 60, receptivity: 0.2, moistureRefCanopy: 0.95, colour: '#1b4d3e',
  },
  // AFDRS-RP generic heath (total 20, k 0.2, H_el 1.3) [V]; layer split, FHS, H_ns, τ_f [H]. Heath model uses s+ns+el.
  [FuelType.Heath]: {
    id: FuelType.Heath, name: 'Heath', family: 'heath', moistureFamily: 'heath', afdrsType: 'Shrubland',
    surface: L(5, 0.2), nearSurface: L(5, 0.2), elevated: L(10, 0.2), bark: ZERO, canopy: ZERO,
    fhsMax: { surface: 2.0, nearSurface: 3.5, elevated: 4.0 }, nearSurfaceHeight: 0.4, elevatedHeight: 1.3,
    canopyHeight: 3, canopyCover: 0.1, lai: 0.5, wrf: 1.5, wetSubmodel: false, spotting: false, barkClass: 'none',
    tfi: { minSfaz: 7, minLmz: 10, max: 30 }, flameResidence: 20, receptivity: 0.7, moistureRefCanopy: 0, colour: '#b07aa1',
  },
  // LUT 44 Montane & alpine heath (total 12.6, k 0.1, H_el 1.0); FHS, τ_f [H].
  [FuelType.AlpineHeathGrass]: {
    id: FuelType.AlpineHeathGrass, name: 'Alpine heath and grass', family: 'heath', moistureFamily: 'heath', afdrsType: 'Shrubland',
    surface: L(3, 0.1), nearSurface: L(4.6, 0.1), elevated: L(5, 0.1), bark: ZERO, canopy: ZERO,
    fhsMax: { surface: 2, nearSurface: 3, elevated: 3 }, nearSurfaceHeight: 0.3, elevatedHeight: 1.0,
    canopyHeight: 0, canopyCover: 0, lai: 0.3, wrf: 1.5, wetSubmodel: false, spotting: false, barkClass: 'none',
    tfi: 'avoid', flameResidence: 15, receptivity: 0.6, moistureRefCanopy: 0, colour: '#c9a0dc',
  },
  // LUT 39 Subalpine woodlands; H_o 12 [H], τ_f [H].
  [FuelType.SnowGumWoodland]: {
    id: FuelType.SnowGumWoodland, name: 'Snow gum woodland', family: 'vesta2', moistureFamily: 'forest', afdrsType: 'Forest',
    surface: L(15, 0.3), nearSurface: L(1, 0.3), elevated: L(2, 0.2), bark: L(1.0, 0.1), canopy: L(6.8, 0.3),
    fhsMax: { surface: 3.3, nearSurface: 2.8, elevated: 2.8 }, nearSurfaceHeight: 0.2, elevatedHeight: 2.0,
    canopyHeight: 12, canopyCover: 0.5, lai: 1.2, wrf: 2.5, wetSubmodel: false, spotting: true, barkClass: 'smooth',
    tfi: { minSfaz: 5, minLmz: 8, max: 40 }, flameResidence: 40, receptivity: 0.9, moistureRefCanopy: 0.5, colour: '#7fb3a3',
  },
  // No LUT row read [H] (all values). CBH 8 m (not a catalogue field). Pine FA uses the wet C1 (§5.9, moisture/).
  [FuelType.PinePlantation]: {
    id: FuelType.PinePlantation, name: 'Pine plantation', family: 'pine', moistureFamily: 'pine', afdrsType: 'Pine',
    surface: L(10, 0.2), nearSurface: L(2, 0.2), elevated: L(2, 0.2), bark: L(1, 0.1), canopy: L(10, 0.1),
    fhsMax: { surface: 3.5, nearSurface: 2.0, elevated: 2.0 }, nearSurfaceHeight: 0.1, elevatedHeight: 1.0,
    canopyHeight: 20, canopyCover: 0.8, lai: 3.0, wrf: 4.0, wetSubmodel: false, spotting: true, barkClass: 'mixed',
    flameResidence: 45, receptivity: 0.9, moistureRefCanopy: 0.8, colour: '#3e5f2b',
  },
  // AFDRS urban → eaten-out grass (doc 03 §3.11) [V]; loads, heights, τ_f [H]; WRF (table "—") 1.5 [H].
  [FuelType.Urban]: {
    id: FuelType.Urban, name: 'Urban / cleared', family: 'grass', moistureFamily: 'grass', afdrsType: 'Grassland (eaten out)',
    surface: L(2, 0.5), nearSurface: L(1, 0.5), elevated: L(1, 0.2), bark: ZERO, canopy: L(2, 0.3),
    fhsMax: { surface: 1, nearSurface: 1, elevated: 1 }, nearSurfaceHeight: 0.1, elevatedHeight: 1.0,
    canopyHeight: 8, canopyCover: 0.3, lai: 1.0, wrf: 1.5, grassWaf: 0.3, grassStateDefault: 'eatenOut',
    wetSubmodel: false, spotting: false, barkClass: 'none', flameResidence: 30, receptivity: 0.3, moistureRefCanopy: 0.3, colour: '#d17c5e',
  },
};

/** Fraction of the total fine load in each of surface / near-surface / elevated for "total k" classes [H split]. */
type Split3 = readonly [number, number, number];
const GRASS_SPLIT: Split3 = [1.0 / 5.1, 4.1 / 5.1, 0]; // Grassland row proportions: grass load = s + ns
const HEATH_SPLIT: Split3 = [0.25, 0.25, 0.5]; // generic heath 5/5/10
const ALPINE_SPLIT: Split3 = [3 / 12.6, 4.6 / 12.6, 5 / 12.6]; // LUT 44 3/4.6/5

/** Layer overrides for a class given only as "total t/ha, k" (heath and alpine rows of §4.2). */
function total(t: number, k: number, split: Split3): Pick<FuelTypeInfo, 'surface' | 'nearSurface' | 'elevated'> {
  const r = (v: number): number => Math.round(v * 1000) / 1000;
  return { surface: L(r(t * split[0]), k), nearSurface: L(r(t * split[1]), k), elevated: L(r(t * split[2]), k) };
}

/** TFI of the formations whose type row differs (doc 05 §3.5 [S]; additive to the §4.2 table, see the module doc). */
const TFI_WSF_GRASSY = { minSfaz: 10, minLmz: 15, max: 50 };
const TFI_FRESHWATER_WETLAND = { minSfaz: 6, minLmz: 10, max: 35 };
const TFI_FORESTED_WETLAND = { minSfaz: 7, minLmz: 10, max: 35 };

const bark = (load: number): { bark: LayerParams } => ({ bark: L(load, 0.1) });
const canopy = (load: number): { canopy: LayerParams } => ({ canopy: L(load, 0.3) });
const fhs = (s: number, ns: number, el: number): { fhsMax: FuelTypeInfo['fhsMax'] } => ({ fhsMax: { surface: s, nearSurface: ns, elevated: el } });

const generic: FuelClassInfo[] = [];
for (let t = 0; t < FUEL_TYPE_COUNT; t++) generic.push({ id: t, name: FUEL_TYPES[t as FuelType].name, fuelType: t as FuelType, overrides: {} });

/**
 * §4.2 fuel classes. Index = id. `lut` is the NSW LUT row the class follows (absent where the spec gives none).
 * Unlisted fields inherit the type row; `family`/`moistureFamily` resolve from the class (35, 39, 48).
 */
export const FUEL_CLASSES: FuelClassInfo[] = [
  ...generic,
  { id: 13, name: 'Sydney Montane Dry Sclerophyll Forests', fuelType: FuelType.DryForestShrubby, lut: 30, overrides: {} },
  { id: 14, name: 'Sydney Hinterland Dry Sclerophyll Forests', fuelType: FuelType.DryForestShrubby, lut: 24, overrides: { ...bark(2.62), canopyHeight: 25 } },
  { id: 15, name: 'Sydney Coastal Dry Sclerophyll Forests', fuelType: FuelType.DryForestShrubby, lut: 24, overrides: { ...bark(2.62) } }, // LUT [H]
  // LUT 24 + bark 0.6, spotting 0 [V partial, H]
  { id: 16, name: 'Sydney Sand Flats Dry Sclerophyll Forests', fuelType: FuelType.DryForestShrubby, lut: 24, overrides: { ...bark(0.6), spotting: false, barkClass: 'smooth' } },
  {
    id: 17, name: 'South East Dry Sclerophyll Forests', fuelType: FuelType.DryForestShrubby, lut: 27,
    overrides: { surface: L(10, 0.19), nearSurface: L(2, 0.19), elevated: L(5, 0.19), ...bark(3.4), ...canopy(2.7), ...fhs(3.4, 3.1, 2.5), nearSurfaceHeight: 0.32, elevatedHeight: 1.7, canopyHeight: 30 },
  },
  {
    id: 18, name: 'Southern Tableland Dry Sclerophyll Forests', fuelType: FuelType.DryForestShrubby, lut: 32,
    overrides: { surface: L(19, 0.15), nearSurface: L(1, 0.15), elevated: L(2.5, 0.15), ...bark(2.55), ...canopy(5.8), ...fhs(2.8, 2.8, 2.0), nearSurfaceHeight: 0.18, elevatedHeight: 0.9, wrf: 3 },
  },
  {
    id: 19, name: 'Western Slopes Dry Sclerophyll Forests', fuelType: FuelType.DryForestShrubby, lut: 33,
    overrides: { surface: L(12, 0.16), nearSurface: L(0.5, 0.16), elevated: L(2.5, 0.15), ...bark(0.86), ...canopy(2.7), ...fhs(3.2, 2.7, 3.0), wrf: 3, spotting: false },
  },
  { id: 20, name: 'Central Gorge Dry Sclerophyll Forests', fuelType: FuelType.DryForestGrassy, lut: 16, overrides: { nearSurface: L(1, 0.3), ...fhs(3.1, 2.7, 2.8) } },
  {
    id: 21, name: 'North-west Slopes Dry Sclerophyll Woodlands', fuelType: FuelType.DryForestGrassy, lut: 33, // LUT [H]
    overrides: { surface: L(12, 0.16), nearSurface: L(1, 0.16), elevated: L(2.5, 0.15), ...bark(0.86), ...fhs(3.2, 2.7, 3.0), wrf: 2.5 },
  },
  { id: 22, name: 'Northern Hinterland Wet Sclerophyll Forests', fuelType: FuelType.WetForest, lut: 4, overrides: { ...bark(4.5), canopyHeight: 40, wrf: 4.0, tfi: TFI_WSF_GRASSY } }, // LUT [H]
  { id: 23, name: 'North Coast Wet Sclerophyll Forests', fuelType: FuelType.WetForest, lut: 4, overrides: { ...bark(4.5) } }, // LUT [H]
  { id: 24, name: 'Northern Escarpment Wet Sclerophyll Forests', fuelType: FuelType.WetForest, lut: 4, overrides: { ...bark(4.5) } },
  { id: 25, name: 'Southern Escarpment Wet Sclerophyll Forests', fuelType: FuelType.WetForest, lut: 5, overrides: {} },
  { id: 26, name: 'South Coast Wet Sclerophyll Forests', fuelType: FuelType.WetForest, lut: 5, overrides: {} }, // LUT [H]
  { id: 27, name: 'Southern Lowland Wet Sclerophyll Forests', fuelType: FuelType.WetForest, lut: 5, overrides: { wrf: 4.0, tfi: TFI_WSF_GRASSY } }, // LUT [H]
  {
    id: 28, name: 'Southern Tableland Wet Sclerophyll Forests', fuelType: FuelType.WetForest, lut: 9,
    overrides: { surface: L(18, 0.35), nearSurface: L(0, 0.35), elevated: L(2, 0.15), ...bark(2.0), canopy: L(6.8, 0.35), ...fhs(3.6, 3.0, 2.8), wrf: 3.5, tfi: TFI_WSF_GRASSY },
  },
  {
    id: 29, name: 'Northern Tableland Wet Sclerophyll Forests', fuelType: FuelType.WetForest, lut: 8,
    overrides: { surface: L(18, 0.35), nearSurface: L(0, 0.35), elevated: L(2, 0.15), ...bark(3.43), canopy: L(6.8, 0.35), ...fhs(3.6, 3.0, 2.8), tfi: TFI_WSF_GRASSY },
  },
  {
    id: 30, name: 'Montane Wet Sclerophyll Forests', fuelType: FuelType.WetForest, lut: 10,
    overrides: { surface: L(24, 0.2), nearSurface: L(0, 0.2), elevated: L(2, 0.15), ...bark(2.6), canopy: L(8, 0.35), ...fhs(4.0, 3.0, 2.8), wrf: 3.5, barkClass: 'ribbon', tfi: TFI_WSF_GRASSY },
  },
  { id: 31, name: 'Rainforests', fuelType: FuelType.Rainforest, lut: 1, overrides: {} },
  { id: 32, name: 'Sydney Montane Heaths', fuelType: FuelType.Heath, lut: 43, overrides: { surface: L(3, 0.6), nearSurface: L(3.5, 0.6), elevated: L(5.3, 0.6), elevatedHeight: 1.5 } },
  { id: 33, name: 'Sydney Coastal Heaths', fuelType: FuelType.Heath, lut: 42, overrides: { surface: L(9, 0.07), nearSurface: L(10, 0.07), elevated: L(17.9, 0.07), elevatedHeight: 4.0 } },
  // Wet heath [H]: Blue Mountains upland "hanging" swamps.
  {
    id: 34, name: 'Coastal Heath Swamps', fuelType: FuelType.Heath, overrides: { ...total(12, 0.3, HEATH_SPLIT), elevatedHeight: 1.0, tfi: TFI_FRESHWATER_WETLAND },
    moistureOffsetIfKbdiBelow: { pp: 3, kbdi: 100 },
  },
  // LUT 56 → AFDRS low wetland = eaten-out grass.
  {
    id: 35, name: 'Montane and Alpine Bogs and Fens', fuelType: FuelType.AlpineHeathGrass, lut: 56,
    overrides: { family: 'grass', moistureFamily: 'grass', afdrsType: 'Low Wetland', ...total(2.6, 0.7, GRASS_SPLIT) }, grassState: 'eatenOut',
  },
  { id: 36, name: 'Montane Lakes', fuelType: FuelType.Water, overrides: {} },
  { id: 37, name: 'Alpine Fjaeldmarks', fuelType: FuelType.AlpineHeathGrass, lut: 45, overrides: { ...total(2.6, 0.15, ALPINE_SPLIT), elevatedHeight: 0.25 } },
  { id: 38, name: 'Alpine Heaths', fuelType: FuelType.AlpineHeathGrass, lut: 44, overrides: {} },
  // LUT 46 → grass model (natural/grazed by load).
  {
    id: 39, name: 'Alpine Herbfields', fuelType: FuelType.AlpineHeathGrass, lut: 46,
    overrides: { family: 'grass', moistureFamily: 'grass', afdrsType: 'Grassland', ...total(5.8, 0.2, GRASS_SPLIT) }, curingOffset: -15,
  },
  { id: 40, name: 'Subalpine Woodlands', fuelType: FuelType.SnowGumWoodland, lut: 39, overrides: {} },
  { id: 41, name: 'Southern Tableland Grassy Woodlands', fuelType: FuelType.GrassyWoodland, lut: 38, overrides: {} }, // [H] for non-ST members
  { id: 42, name: 'New England Grassy Woodlands', fuelType: FuelType.GrassyWoodland, lut: 37, overrides: { ...bark(3.3) } },
  { id: 43, name: 'Eastern Riverine Forests', fuelType: FuelType.WetForest, overrides: { wrf: 4.0, ...bark(3.0), tfi: TFI_FORESTED_WETLAND } }, // swamp/floodplain [H]
  { id: 44, name: 'Inland Riverine Forests', fuelType: FuelType.DryForestGrassy, overrides: { wrf: 2.5, tfi: TFI_FORESTED_WETLAND } }, // [H]
  { id: 45, name: 'Inland Rocky Hill Woodlands', fuelType: FuelType.GrassyWoodland, overrides: {} }, // [H]
  { id: 46, name: 'Temperate Montane Grasslands', fuelType: FuelType.Grassland, lut: 58, overrides: {} },
  { id: 47, name: 'Wet Sclerophyll Forests (Grassy sub-formation)', fuelType: FuelType.WetForest, overrides: { wrf: 4.0, tfi: TFI_WSF_GRASSY } }, // 4/5 [H]
  { id: 48, name: 'Saline Wetlands', fuelType: FuelType.Grassland, overrides: { family: 'grass', moistureFamily: 'grass' }, grassState: 'eatenOut' }, // [H]
];

// §4.2: "FHS maxima are part of every class that changes loads", so the (FHS, load) pairs stay consistent for every
// consumer that reads `FUEL_CLASSES[c].overrides.fhsMax ?? FUEL_TYPES[type].fhsMax` (fire/models, embers, explain),
// not only for resolveClass(). The heath / alpine / wetland rows give loads without FHS maxima: derive them from the
// §4.6 polyline (fhsFromLoad) [H] and store them in the row's overrides.
for (const c of FUEL_CLASSES) {
  const o = c.overrides;
  if (o.fhsMax !== undefined || (o.surface === undefined && o.nearSurface === undefined && o.elevated === undefined)) continue;
  const t = FUEL_TYPES[c.fuelType];
  const r = (v: number): number => Math.round(v * 100) / 100;
  o.fhsMax = {
    surface: r(fhsFromLoad('surface', (o.surface ?? t.surface).load)),
    nearSurface: r(fhsFromLoad('nearSurface', (o.nearSurface ?? t.nearSurface).load)),
    elevated: r(fhsFromLoad('elevated', (o.elevated ?? t.elevated).load)),
  };
}

/** Class id meaning "no vegetation class: infer" (rasteriseVegetation, svtmToClass). */
export const CLASS_INFER = 255;

/** A fuel class merged onto its type row, plus the class-only extras. `id` is the FuelType. */
export interface ResolvedFuelClass extends FuelTypeInfo {
  classId: number;
  className: string;
  lut?: number;
  curingOffset: number;
  moistureOffsetIfKbdiBelow?: { pp: number; kbdi: number };
  /** Forced grass state (class or type default); undefined = from the grass load. */
  grassStateFixed?: GrassState;
  /** Steady-state total fine load s + ns + el (t/ha). */
  totalFineLoad: number;
}

function resolve(c: FuelClassInfo): ResolvedFuelClass {
  const t = FUEL_TYPES[c.fuelType];
  const o = c.overrides;
  // Every class that changes loads carries its FHS maxima in `overrides` (derived above where the LUT gives none).
  const merged: FuelTypeInfo = { ...t, ...o, id: t.id };
  const out: ResolvedFuelClass = {
    ...merged,
    classId: c.id,
    className: c.name,
    curingOffset: c.curingOffset ?? 0,
    totalFineLoad: merged.surface.load + merged.nearSurface.load + merged.elevated.load,
  };
  if (c.lut !== undefined) out.lut = c.lut;
  if (c.moistureOffsetIfKbdiBelow) out.moistureOffsetIfKbdiBelow = c.moistureOffsetIfKbdiBelow;
  const gs = c.grassState ?? t.grassStateDefault;
  if (gs) out.grassStateFixed = gs;
  return Object.freeze(out);
}

const RESOLVED: readonly ResolvedFuelClass[] = FUEL_CLASSES.map((c, i) => {
  if (c.id !== i) throw new Error(`FUEL_CLASSES[${i}] has id ${c.id}`);
  return resolve(c);
});

/** Number of fuel classes (valid ids are 0 .. FUEL_CLASS_COUNT − 1). */
export const FUEL_CLASS_COUNT = RESOLVED.length;

/** The merged class row of a class id; unknown ids fall back to the NonFuel generic class. */
export function resolveClass(classId: number): ResolvedFuelClass {
  return RESOLVED[classId] ?? RESOLVED[0]!;
}

/** Generic class id of a FuelType (spec: class 0..12 = FuelType 0..12). */
export const genericClassOf = (type: FuelType): number => type;

/** Legend colour of a fuel type. */
export const fuelColour = (type: FuelType): string => FUEL_TYPES[type]?.colour ?? '#9e9e9e';

/** TFI minimum interval (years) of a class for `fireCountTfi`; NaN when the class has no TFI (pine, urban, none). */
export function tfiMinYears(cls: ResolvedFuelClass, threshold: 'minSfaz' | 'minLmz', avoidYears: number): number {
  const t = cls.tfi;
  if (t === undefined) return NaN;
  if (t === 'avoid') return avoidYears;
  return t[threshold];
}
