/**
 * NSW State Vegetation Type Map (SVTM) → fuel classes, and rasterisation onto the fire grid (spec §4.2).
 *
 * - `svtmToClass(vegForm, vegClass, elevationM)`: exact `vegClass` match (case-insensitive, trimmed), else the
 *   `vegForm` fallback, else 255 (= infer, §4.3). "Not classified" → 255.
 * - `parseVegetation(geojson)`: SVTM GeoJSON (layer 3, fields `vegForm`, `vegClass`, `PCTID`) → VegetationRecord[]
 *   (one record per polygon part; `formation ← vegForm`, `className ← vegClass`, `pctId ← PCTID`).
 * - `rasteriseVegetation(grid, recs, terrain)`: 3×3 sub-points per fire cell (offsets ±Δx/3), even-odd point-in-polygon
 *   over all rings, `svtmToClass` per sub-point with the bilinear terrain elevation there (only the Freshwater Wetlands
 *   fallback depends on it), mode class per cell with ties → Rainforest > WetForest > others, and `minorityWet = 1`
 *   where a Rainforest/WetForest sub-point exists but the mode is drier (sub-cell gully strips, doc 05 §4.2) [H].
 */
import { LocalProjection } from '../core/geo';
import { sampleBilinear, type GridSpec } from '../core/grid';
import { FuelType, type Terrain, type VegetationRecord } from '../core/types';
import { CLASS_INFER, FUEL_CLASSES, resolveClass } from './catalogue';
import { FUEL_PARAMS } from './params';
import { projectRings, ScanlineRasteriser, subPointLattice, type LocalRings } from './polygon';

/** Provenance string of SVTM-derived vegetation (spec §4.7 `sources`). */
export const SVTM_SOURCE = 'SVTM C2.0 via NSW DCCEEW (CC BY 4.0)';

const norm = (s: string | null | undefined): string => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Exact vegClass names (normalised) → class id (§4.2 table; class 31 takes every rainforest class). */
const VEG_CLASS_TO_ID: ReadonlyMap<string, number> = (() => {
  const m = new Map<string, number>();
  for (const c of FUEL_CLASSES) if (c.id >= 13 && c.id <= 46) m.set(norm(c.name), c.id);
  // Multi-name rows of §4.2.
  const extra: [string, number][] = [
    ['Cool Temperate Rainforests', 31],
    ['Dry Rainforests', 31],
    ['Northern Warm Temperate Rainforests', 31],
    ['Southern Warm Temperate Rainforests', 31],
    ['Subtropical Rainforests', 31],
    ['Littoral Rainforests', 31],
    ['Montane Bogs and Fens', 35],
    ['Alpine Bogs and Fens', 35],
    ['Coastal Valley Grassy Woodlands', 41],
    ['Tableland Clay Grassy Woodlands', 41],
    ['Western Slopes Grassy Woodlands', 41],
    ['Coastal Floodplain Wetlands', 43],
  ];
  for (const [n, id] of extra) m.set(norm(n), id);
  m.delete(norm('Rainforests'));
  m.delete(norm('Montane and Alpine Bogs and Fens'));
  return m;
})();

/** vegForm fallback (§4.2 step 2). Freshwater Wetlands depends on elevation and is handled in code. */
const VEG_FORM_TO_ID: ReadonlyMap<string, number> = new Map([
  [norm('Rainforests'), 31],
  [norm('Wet Sclerophyll Forests (Shrubby sub-formation)'), FuelType.WetForest],
  [norm('Wet Sclerophyll Forests (Grassy sub-formation)'), 47],
  [norm('Dry Sclerophyll Forests (Shrubby sub-formation)'), FuelType.DryForestShrubby],
  [norm('Dry Sclerophyll Forests (Shrub/grass sub-formation)'), FuelType.DryForestGrassy],
  [norm('Grassy Woodlands'), FuelType.GrassyWoodland],
  [norm('Grasslands'), 46],
  [norm('Heathlands'), FuelType.Heath],
  [norm('Alpine Complex'), 38],
  [norm('Forested Wetlands'), 43],
  [norm('Saline Wetlands'), 48],
]);
const FRESHWATER = norm('Freshwater Wetlands');
const NOT_CLASSIFIED = norm('Not classified');

/**
 * Fuel class of an SVTM polygon (§4.2). 255 (`CLASS_INFER`) = no class: infer from terrain and canopy (§4.3).
 * Total: never throws, whatever the strings.
 */
export function svtmToClass(vegForm: string, vegClass: string, elevationM: number): number {
  const c = norm(vegClass);
  if (c && c !== NOT_CLASSIFIED) {
    const id = VEG_CLASS_TO_ID.get(c);
    if (id !== undefined) return id;
  }
  const f = norm(vegForm);
  if (!f || f === NOT_CLASSIFIED) return CLASS_INFER;
  const id = VEG_FORM_TO_ID.get(f);
  if (id !== undefined) return id;
  if (f === FRESHWATER) return elevationM < FUEL_PARAMS.freshwaterWetlandSplitM ? 34 : 35; // [H]
  if (f.startsWith('semi-arid woodlands')) return 45;
  if (f.startsWith('arid shrublands')) return FuelType.Heath; // [H]
  return CLASS_INFER;
}

/** True when `svtmToClass(vegForm, vegClass, z)` depends on z (only the Freshwater Wetlands fallback). */
function elevationDependent(vegForm: string, vegClass: string): boolean {
  return svtmToClass(vegForm, vegClass, -1e4) !== svtmToClass(vegForm, vegClass, 1e4);
}

interface SvtmFeature {
  properties?: { vegForm?: string | null; vegClass?: string | null; PCTID?: number | null } | null;
  geometry?: { type: string; coordinates: unknown } | null;
}

/**
 * SVTM GeoJSON → VegetationRecord[] (one per polygon part; features without geometry are skipped). Records keep
 * "Not classified" polygons (they map to inference). `fuelClass`/`fuelType` are filled where they do not depend on
 * elevation.
 */
export function parseVegetation(geojson: unknown): VegetationRecord[] {
  const feats = (geojson as { features?: SvtmFeature[] } | null)?.features;
  if (!Array.isArray(feats)) return [];
  const out: VegetationRecord[] = [];
  for (const f of feats) {
    const g = f?.geometry;
    if (!g || !g.coordinates) continue;
    const p = f.properties ?? {};
    const formation = (p.vegForm ?? 'Not classified').trim();
    const className = (p.vegClass ?? '').trim();
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? (g.coordinates as unknown[]) : [];
    for (const poly of polys) {
      if (!Array.isArray(poly) || poly.length === 0) continue;
      // First ring = outer: without a usable outer ring the holes would be filled as polygons (even-odd), so skip.
      const outer = poly[0] as unknown;
      if (!Array.isArray(outer) || outer.length < 4) continue;
      const rings = (poly as [number, number][][]).filter((r) => Array.isArray(r) && r.length >= 4);
      const rec: VegetationRecord = { formation, className, rings };
      if (typeof p.PCTID === 'number') rec.pctId = p.PCTID;
      if (!elevationDependent(formation, className)) {
        const id = svtmToClass(formation, className, 0);
        if (id !== CLASS_INFER) {
          rec.fuelClass = id;
          rec.fuelType = resolveClass(id).id;
        }
      }
      out.push(rec);
    }
  }
  return out;
}

/** Wetness rank of a class for mode ties (§4.2: Rainforest > WetForest > others; 255 lowest). */
function wetRank(classId: number): number {
  if (classId === CLASS_INFER) return -1;
  const t = resolveClass(classId).id;
  return t === FuelType.Rainforest ? 2 : t === FuelType.WetForest ? 1 : 0;
}
const WET_RANK = new Int8Array(256);
for (let c = 0; c < 256; c++) WET_RANK[c] = wetRank(c);

export interface VegetationRaster {
  /** Fuel class per fire cell; 255 = none (infer). */
  classId: Uint8Array;
  /** 1 where a Rainforest/WetForest sub-point exists but the mode class is drier. */
  minorityWet: Uint8Array;
}

/**
 * Rasterise SVTM polygons onto the fire grid (§4.2). Later records overwrite earlier ones where polygons overlap.
 * Cost: one scanline pass per polygon on the 3× sub-point lattice (Katoomba 3059 polygons at 30 m: see tests).
 */
export function rasteriseVegetation(grid: GridSpec, recs: VegetationRecord[], terrain: Terrain): VegetationRaster {
  const S = 3;
  const lat = subPointLattice(grid, S);
  const sub = new Uint8Array(lat.nx * lat.ny).fill(CLASS_INFER);
  const proj = new LocalProjection(grid.origin);
  const ras = new ScanlineRasteriser();
  const tg = terrain.grid;
  const elev = terrain.elevation;
  const snx = lat.nx;
  for (const rec of recs) {
    const rings: LocalRings = projectRings(rec.rings, proj, 4);
    if (rings.length === 0) continue;
    const form = rec.formation ?? '';
    const cls = rec.className ?? '';
    if (elevationDependent(form, cls)) {
      // Only the Freshwater Wetlands fallback depends on elevation: two candidates split at one height.
      const lo = svtmToClass(form, cls, -1e4);
      const hi = svtmToClass(form, cls, 1e4);
      const zSplit = FUEL_PARAMS.freshwaterWetlandSplitM;
      ras.rasterise(rings, lat, (j, i0, i1) => {
        const y = lat.y0 + j * lat.step;
        const row = j * snx;
        for (let i = i0; i <= i1; i++) sub[row + i] = sampleBilinear(tg, elev, lat.x0 + i * lat.step, y) < zSplit ? lo : hi;
      });
    } else {
      const id = rec.fuelClass ?? svtmToClass(form, cls, 0);
      ras.rasterise(rings, lat, (j, i0, i1) => sub.fill(id, j * snx + i0, j * snx + i1 + 1));
    }
  }

  // Mode per cell over its S×S sub-points.
  const { nx, ny } = grid;
  const classId = new Uint8Array(nx * ny);
  const minorityWet = new Uint8Array(nx * ny);
  const counts = new Uint8Array(256);
  const seen = new Uint8Array(S * S);
  const centreOff = (S - 1) >> 1;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      let nSeen = 0;
      let anyWet = false;
      for (let b = 0; b < S; b++) {
        const row = (j * S + b) * snx + i * S;
        for (let a = 0; a < S; a++) {
          const c = sub[row + a]!;
          if (counts[c] === 0) seen[nSeen++] = c;
          counts[c]!++;
          if (WET_RANK[c]! > 0) anyWet = true;
        }
      }
      const centre = sub[(j * S + centreOff) * snx + i * S + centreOff]!;
      let best = seen[0]!;
      for (let q = 1; q < nSeen; q++) {
        const c = seen[q]!;
        const dc = counts[c]! - counts[best]!;
        if (dc > 0) best = c;
        else if (dc === 0) {
          const dw = WET_RANK[c]! - WET_RANK[best]!;
          if (dw > 0 || (dw === 0 && (c === centre || (best !== centre && c < best)))) best = c;
        }
      }
      for (let q = 0; q < nSeen; q++) counts[seen[q]!] = 0;
      const k = j * nx + i;
      classId[k] = best;
      if (anyWet && WET_RANK[best]! <= 0) minorityWet[k] = 1;
    }
  }
  return { classId, minorityWet };
}
