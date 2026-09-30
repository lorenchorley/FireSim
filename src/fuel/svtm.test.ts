import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LocalProjection } from '../core/geo';
import { makeGridSpec } from '../core/grid';
import { FuelType, type VegetationRecord } from '../core/types';
import { buildTerrain } from '../terrain';
import { plane, TEST_ORIGIN } from '../terrain/testing/synthetic';
import { CLASS_INFER, resolveClass } from './catalogue';
import { parseVegetation, rasteriseVegetation, svtmToClass } from './svtm';
import { loadDemoFireTerrain } from './testing/demoTerrain';

const DEMO = fileURLToPath(new URL('../../public/demo/', import.meta.url));

/** Local-metre polygon (rings of [x, y]) → a VegetationRecord with [lon, lat] rings about `origin`. */
function vegRecord(origin: { lat: number; lon: number }, rings: [number, number][][], formation: string, className: string): VegetationRecord {
  const proj = new LocalProjection(origin);
  return {
    formation,
    className,
    rings: rings.map((r) => {
      const closed = [...r, r[0]!];
      return closed.map(([x, y]) => {
        const ll = proj.toLatLon(x, y);
        return [ll.lon, ll.lat] as [number, number];
      });
    }),
  };
}
const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

describe('svtmToClass (spec §4.2)', () => {
  it('is total over every (vegForm, vegClass) pair of the eight demo files; only "Not classified" infers', () => {
    const pairs = new Map<string, [string, string]>();
    for (const site of readdirSync(DEMO, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
      const gj = JSON.parse(readFileSync(`${DEMO}${site}/vegetation.geojson`, 'utf8')) as { features: { properties: { vegForm: string; vegClass: string } }[] };
      for (const f of gj.features) pairs.set(`${f.properties.vegForm}|${f.properties.vegClass}`, [f.properties.vegForm, f.properties.vegClass]);
    }
    expect(pairs.size).toBe(43);
    for (const [form, cls] of pairs.values()) {
      const id = svtmToClass(form, cls, 800);
      if (cls === 'Not classified') expect(id).toBe(CLASS_INFER);
      else {
        expect(id, `${form} | ${cls}`).not.toBe(CLASS_INFER);
        expect(id).toBeGreaterThanOrEqual(13); // every named demo class has a specific row
      }
    }
  });

  it('maps the §4.9 vectors', () => {
    const c13 = svtmToClass('Dry Sclerophyll Forests (Shrubby sub-formation)', 'Sydney Montane Dry Sclerophyll Forests', 1000);
    expect(c13).toBe(13);
    expect(resolveClass(c13).id).toBe(FuelType.DryForestShrubby);
    const c39 = svtmToClass('Alpine Complex', 'Alpine Herbfields', 1900);
    expect(c39).toBe(39);
    expect(resolveClass(c39).family).toBe('grass');
    expect(resolveClass(c39).moistureFamily).toBe('grass');
    expect(resolveClass(svtmToClass('Freshwater Wetlands', 'Montane Lakes', 1000)).id).toBe(FuelType.Water);
  });

  it('is case-insensitive and trims', () => {
    expect(svtmToClass('  dry sclerophyll forests (shrubby sub-formation) ', '  SYDNEY MONTANE dry sclerophyll forests ', 0)).toBe(13);
  });

  it('formation fallbacks (§4.2 step 2), including 47/48 and the Freshwater Wetlands elevation split', () => {
    const f = (form: string): number => svtmToClass(form, 'Some Unlisted Class', 800);
    expect(f('Rainforests')).toBe(31);
    expect(f('Wet Sclerophyll Forests (Shrubby sub-formation)')).toBe(FuelType.WetForest);
    expect(f('Wet Sclerophyll Forests (Grassy sub-formation)')).toBe(47);
    expect(resolveClass(47).wrf).toBe(4.0);
    expect(f('Dry Sclerophyll Forests (Shrubby sub-formation)')).toBe(FuelType.DryForestShrubby);
    expect(f('Dry Sclerophyll Forests (Shrub/grass sub-formation)')).toBe(FuelType.DryForestGrassy);
    expect(f('Grassy Woodlands')).toBe(FuelType.GrassyWoodland);
    expect(f('Grasslands')).toBe(46);
    expect(f('Heathlands')).toBe(FuelType.Heath);
    expect(f('Alpine Complex')).toBe(38);
    expect(f('Forested Wetlands')).toBe(43);
    expect(f('Saline Wetlands')).toBe(48);
    expect(resolveClass(48).grassStateFixed).toBe('eatenOut');
    expect(f('Semi-arid Woodlands (Grassy sub-formation)')).toBe(45);
    expect(f('Arid Shrublands (Chenopod sub-formation)')).toBe(FuelType.Heath);
    expect(svtmToClass('Freshwater Wetlands', 'x', 1199)).toBe(34);
    expect(svtmToClass('Freshwater Wetlands', 'x', 1201)).toBe(35);
    expect(svtmToClass('Not classified', 'Not classified', 800)).toBe(CLASS_INFER);
    expect(svtmToClass('', '', 800)).toBe(CLASS_INFER);
    expect(svtmToClass('Martian Tundra', 'Unknown', 800)).toBe(CLASS_INFER);
    // Exact class names win over the formation.
    expect(svtmToClass('Freshwater Wetlands', 'Coastal Heath Swamps', 1500)).toBe(34);
    expect(svtmToClass('Grassy Woodlands', 'Subalpine Woodlands', 1500)).toBe(40);
    for (const rf of ['Cool Temperate Rainforests', 'Dry Rainforests', 'Subtropical Rainforests', 'Littoral Rainforests']) expect(svtmToClass('Rainforests', rf, 0)).toBe(31);
  });
});

describe('parseVegetation', () => {
  it('reads SVTM GeoJSON, splits MultiPolygons and fills fuelClass/fuelType', () => {
    const gj = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { PCTID: 3617, vegClass: 'Sydney Montane Heaths', vegForm: 'Heathlands' }, geometry: { type: 'Polygon', coordinates: [[[150, -33], [150.01, -33], [150.01, -33.01], [150, -33]]] } },
        {
          type: 'Feature',
          properties: { PCTID: 1, vegClass: 'Dry Rainforests', vegForm: 'Rainforests' },
          geometry: { type: 'MultiPolygon', coordinates: [[[[150, -33], [150.01, -33], [150.01, -33.01], [150, -33]]], [[[151, -33], [151.01, -33], [151.01, -33.01], [151, -33]]]] },
        },
        { type: 'Feature', properties: { vegClass: 'Not classified', vegForm: 'Not classified' }, geometry: null },
      ],
    };
    const recs = parseVegetation(gj);
    expect(recs).toHaveLength(3);
    expect(recs[0]!.fuelClass).toBe(32);
    expect(recs[0]!.fuelType).toBe(FuelType.Heath);
    expect(recs[0]!.pctId).toBe(3617);
    expect(recs[1]!.fuelClass).toBe(31);
    expect(recs[2]!.rings[0]![0]).toEqual([151, -33]);
    expect(parseVegetation(null)).toEqual([]);
  });
});

describe('rasteriseVegetation (spec §4.2)', () => {
  const grid = makeGridSpec(TEST_ORIGIN, 6000, 30);
  const terrain = buildTerrain(grid, plane(grid, 0, 0.1, 1200), 'plane'); // 1200 m at y = 0, rising north at 10 %

  it('a 1 km × 1 km square on a 30 m grid covers 1111 ± 67 cells', () => {
    const rec = vegRecord(grid.origin, [rect(-500, -500, 500, 500)], 'Heathlands', 'Sydney Montane Heaths');
    const { classId, minorityWet } = rasteriseVegetation(grid, [rec], terrain);
    let n = 0;
    for (const c of classId) if (c === 32) n++;
    expect(Math.abs(n - 1111)).toBeLessThanOrEqual(67);
    expect(minorityWet.every((v) => v === 0)).toBe(true);
    // Outside the polygon: no class → inference.
    expect(classId[0]).toBe(CLASS_INFER);
  });

  it('honours holes (even-odd over all rings)', () => {
    const rec = vegRecord(grid.origin, [rect(-600, -600, 600, 600), rect(-300, -300, 300, 300)], 'Heathlands', 'Sydney Montane Heaths');
    const { classId } = rasteriseVegetation(grid, [rec], terrain);
    const at = (x: number, y: number): number => classId[Math.round((y - grid.y0) / 30) * grid.nx + Math.round((x - grid.x0) / 30)]!;
    expect(at(0, 0)).toBe(CLASS_INFER);
    expect(at(-450, 0)).toBe(32);
    expect(at(450, 450)).toBe(32);
    expect(at(700, 0)).toBe(CLASS_INFER);
  });

  it('evaluates the elevation-dependent Freshwater Wetlands fallback per sub-point', () => {
    const rec = vegRecord(grid.origin, [rect(-500, -1000, 500, 1000)], 'Freshwater Wetlands', 'An unlisted swamp');
    const { classId } = rasteriseVegetation(grid, [rec], terrain);
    const at = (x: number, y: number): number => classId[Math.round((y - grid.y0) / 30) * grid.nx + Math.round((x - grid.x0) / 30)]!;
    expect(at(0, -600)).toBe(34); // 1140 m
    expect(at(0, 600)).toBe(35); // 1260 m
  });

  it('mode ties go to the wetter type; drier modes with wet sub-points set minorityWet', () => {
    // Cell centred at (x0 + 100·30, y0 + 100·30) = (15, 15); sub-points at x = 5, 15, 25 (±Δx/3 = 10 m).
    const cx = grid.x0 + 100 * 30;
    const cy = grid.y0 + 100 * 30;
    const k = 100 * grid.nx + 100;
    // Rainforest on the west column, DSF on the east column, nothing in the middle: 3 / 3 / 3 → Rainforest.
    const rf = vegRecord(grid.origin, [rect(cx - 16, cy - 16, cx - 4, cy + 16)], 'Rainforests', 'Dry Rainforests');
    const dsf = vegRecord(grid.origin, [rect(cx + 4, cy - 16, cx + 16, cy + 16)], 'Dry Sclerophyll Forests (Shrubby sub-formation)', 'Sydney Montane Dry Sclerophyll Forests');
    let r = rasteriseVegetation(grid, [rf, dsf], terrain);
    expect(r.classId[k]).toBe(31);
    expect(r.minorityWet[k]).toBe(0);
    // Wet forest on the west column only, DSF on the rest: mode DSF, minorityWet = 1.
    const wsf = vegRecord(grid.origin, [rect(cx - 16, cy - 16, cx - 4, cy + 16)], 'Wet Sclerophyll Forests (Shrubby sub-formation)', 'Southern Escarpment Wet Sclerophyll Forests');
    const dsf2 = vegRecord(grid.origin, [rect(cx - 4, cy - 16, cx + 16, cy + 16)], 'Dry Sclerophyll Forests (Shrubby sub-formation)', 'Sydney Montane Dry Sclerophyll Forests');
    r = rasteriseVegetation(grid, [wsf, dsf2], terrain);
    expect(r.classId[k]).toBe(13);
    expect(r.minorityWet[k]).toBe(1);
  });

  it('rasterises the real Katoomba SVTM (3059 polygons) at 30 m within the §4.2 budget (< 300 ms)', async () => {
    const t = (await loadDemoFireTerrain('katoomba', 30))!;
    const gj = JSON.parse(readFileSync(`${DEMO}katoomba/vegetation.geojson`, 'utf8'));
    const recs = parseVegetation(gj);
    expect(recs.length).toBeGreaterThan(3059);
    rasteriseVegetation(t.grid, recs, t); // warm-up (JIT)
    const t0 = performance.now();
    const r = rasteriseVegetation(t.grid, recs, t);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(300);
    let mapped = 0;
    for (const c of r.classId) if (c !== CLASS_INFER) mapped++;
    expect(mapped / r.classId.length).toBeGreaterThan(0.7);
  });
});
