/**
 * Validation of fuel/ on the bundled real data (spec §4 plausibility; §15 V19 fuel part): fuel maps for Katoomba,
 * Grose and Thredbo must show heath on the sandstone ridges, rainforest / wet forest in the gullies, the alpine
 * complex above the snow-gum woodland, and time since fire from the NPWS history; replays exclude active fires.
 */
import { describe, expect, it } from 'vitest';
import { FireHistoryKind, FuelFlag, FuelType, Landform, type Terrain } from '../core/types';
import { resolveClass } from './catalogue';
import { buildDemoFuel, type DemoFuel } from './demo';
import { fuelParamsInto, makeCellFuelParams } from './fuelMap';
import { loadDemoFireTerrain } from './testing/demoTerrain';

const NOW = Date.parse('2026-09-27T00:00:00Z');

interface Stats {
  share: number;
  z: number;
  tpi: number;
  low: number;
  high: number;
}
/** Share of the domain, mean elevation, mean TPI and landform shares of the cells matching `pred`. */
function stats(t: Terrain, d: DemoFuel, pred: (type: FuelType, cls: number) => boolean): Stats {
  let n = 0, z = 0, tpi = 0, low = 0, high = 0;
  for (let k = 0; k < t.elevation.length; k++) {
    if (!pred(d.fuel.type[k] as FuelType, d.fuel.fuelClass![k]!)) continue;
    n++;
    z += t.elevation[k]!;
    tpi += t.tpi[k]!;
    const lf = t.landform[k]!;
    if (lf === Landform.Gully || lf === Landform.ValleyFloor || lf === Landform.LowerSlope) low++;
    if (lf === Landform.Ridge || lf === Landform.Peak || lf === Landform.Spur || lf === Landform.UpperSlope) high++;
  }
  return { share: n / t.elevation.length, z: z / n, tpi: tpi / n, low: low / n, high: high / n };
}
const isType = (...types: FuelType[]) => (t: FuelType): boolean => types.includes(t);

describe('demo fuel maps on real NSW data', () => {
  it('Katoomba: heath on the sandstone ridges, rainforest / wet forest in the gullies, NPWS time since fire', async () => {
    const terrain = (await loadDemoFireTerrain('katoomba', 30))!;
    const t = performance.now();
    const d = await buildDemoFuel('katoomba', terrain, NOW);
    expect(performance.now() - t).toBeLessThan(2000); // loading + parsing + rasterising + building
    const f = d.fuel;
    expect(f.grid).toBe(terrain.grid);
    const heath = stats(terrain, d, isType(FuelType.Heath));
    const dsf = stats(terrain, d, isType(FuelType.DryForestShrubby));
    const wet = stats(terrain, d, isType(FuelType.Rainforest, FuelType.WetForest));
    const rf = stats(terrain, d, isType(FuelType.Rainforest));
    expect(heath.share).toBeGreaterThan(0.05);
    expect(heath.tpi).toBeGreaterThan(5);
    expect(heath.tpi).toBeGreaterThan(dsf.tpi);
    expect(heath.high).toBeGreaterThan(heath.low);
    expect(wet.share).toBeGreaterThan(0.03);
    expect(wet.tpi).toBeLessThan(-10);
    expect(wet.low).toBeGreaterThan(0.6);
    expect(rf.tpi).toBeLessThan(wet.tpi); // rainforest in the deepest gullies
    expect(heath.z - wet.z).toBeGreaterThan(200); // plateau heath vs valley forest
    // NPWS history: a large share of cells has a record; the 2019-20 fires are ≈ 6.6–6.9 yr ago.
    let rec = 0, burnt1920 = 0, post = 0;
    for (let k = 0; k < f.type.length; k++) {
      const tsf = f.timeSinceFire[k]!;
      if (tsf === tsf) rec++;
      if (tsf > 6.5 && tsf < 7.0 && f.lastFireKind[k] === FireHistoryKind.Wildfire) burnt1920++;
      if (f.flags![k]! & FuelFlag.PostFire) post++;
    }
    expect(rec / f.type.length).toBeGreaterThan(0.3);
    expect(burnt1920 / f.type.length).toBeGreaterThan(0.05);
    expect(post).toBeGreaterThan(0);
    expect(f.sources.join(' | ')).toMatch(/NPWS Fire History current to 2026-09-07/);
    expect(d.history.activeFires).toHaveLength(0);
    // Every cell resolves to finite hot-loop parameters (timeSinceFire NaN = no record).
    const p = makeCellFuelParams();
    for (let k = 0; k < f.type.length; k += 7) {
      fuelParamsInto(f, k, p);
      for (const [key, v] of Object.entries(p)) if (typeof v === 'number' && key !== 'timeSinceFire') expect(Number.isFinite(v), `${key} @${k}`).toBe(true);
      expect(p.wrf >= 1 && p.wrf <= 6).toBe(true);
      expect(p.hOEff).toBeGreaterThanOrEqual(0);
    }
  });

  it('Grose: wet forest and rainforest down in the gorge, heath and DSF on the plateau; Gospers Mountain active in the 2019-12-19 replay', async () => {
    const terrain = (await loadDemoFireTerrain('grose', 30))!;
    const d = await buildDemoFuel('grose', terrain, NOW);
    const heath = stats(terrain, d, isType(FuelType.Heath));
    const wet = stats(terrain, d, isType(FuelType.Rainforest, FuelType.WetForest));
    expect(wet.share).toBeGreaterThan(0.05);
    expect(heath.z - wet.z).toBeGreaterThan(200);
    expect(wet.tpi).toBeLessThan(-10);
    expect(heath.tpi).toBeGreaterThan(5);
    // The 2019-20 Gospers Mountain / Grose Valley fires burnt most of it.
    let burnt = 0;
    for (let k = 0; k < d.fuel.type.length; k++) if (d.fuel.timeSinceFire[k]! < 7.5) burnt++;
    expect(burnt / d.fuel.type.length).toBeGreaterThan(0.4);

    const replay = await buildDemoFuel('grose', terrain, Date.parse('2019-12-19T03:00:00Z'));
    expect(replay.history.activeFires.some((r) => r.name === 'Gospers Mountain')).toBe(true);
    expect(replay.warnings.join(' ')).toMatch(/Gospers Mountain/);
    for (const r of replay.history.included) expect(r.startDate === undefined || r.startDate <= '2019-12-19').toBe(true);
    // Before the 2019-20 season the same cells carry older fuel.
    let older = 0, n = 0;
    for (let k = 0; k < d.fuel.type.length; k++) {
      if (!(d.fuel.timeSinceFire[k]! < 7.5)) continue;
      n++;
      const tr = replay.fuel.timeSinceFire[k]!;
      if (!(tr < 0.5)) older++;
    }
    expect(older / n).toBeGreaterThan(0.95);
  });

  it('Thredbo: alpine complex above the snow-gum woodland, wet (alpine ash) forest lowest; Pilot Lookout active on 2020-01-02', async () => {
    const terrain = (await loadDemoFireTerrain('thredbo', 30))!;
    const d = await buildDemoFuel('thredbo', terrain, NOW);
    const alpine = stats(terrain, d, (_t, c) => [35, 37, 38, 39].includes(c));
    const snowGum = stats(terrain, d, isType(FuelType.SnowGumWoodland));
    const wet = stats(terrain, d, isType(FuelType.WetForest));
    expect(alpine.share).toBeGreaterThan(0.2);
    expect(snowGum.share).toBeGreaterThan(0.3);
    expect(alpine.z).toBeGreaterThan(snowGum.z + 150);
    expect(snowGum.z).toBeGreaterThan(wet.z);
    expect(alpine.z).toBeGreaterThan(1800);
    // Alpine herbfields and bogs run on the grass model; heaths and feldmark on the heath model.
    for (let k = 0; k < d.fuel.type.length; k++) {
      const c = d.fuel.fuelClass![k]!;
      if (c === 39 || c === 35) expect(resolveClass(c).family).toBe('grass');
      if (c === 38 || c === 37) expect(resolveClass(c).family).toBe('heath');
    }
    const replay = await buildDemoFuel('thredbo', terrain, Date.parse('2020-01-02T03:00:00Z'));
    expect(replay.history.activeFires.some((r) => r.name === 'Pilot Lookout')).toBe(true);
    // The 2003 Kosciuszko fire is in the record; the 1938-39 undated fire is included via its season mid-point.
    expect(replay.history.included.some((r) => r.name === 'Kosciuszko')).toBe(true);
    expect(replay.history.included.some((r) => r.season === 1938 && r.datesKnown === false)).toBe(true);
  });

  it('without SVTM the terrain + canopy inference still yields a plausible map (flagged)', async () => {
    const terrain = (await loadDemoFireTerrain('katoomba', 30))!;
    const d = await buildDemoFuel('katoomba', terrain, NOW, { noVegetation: true });
    const f = d.fuel;
    let inferred = 0;
    for (let k = 0; k < f.type.length; k++) if (f.flags![k]! & FuelFlag.InferredVegetation) inferred++;
    expect(inferred).toBe(f.type.length);
    expect(d.warnings.join(' ')).toMatch(/inferred/);
    const forest = stats(terrain, d, isType(FuelType.DryForestShrubby, FuelType.WetForest));
    const cleared = stats(terrain, d, isType(FuelType.Grassland));
    expect(forest.share).toBeGreaterThan(0.5);
    expect(cleared.share).toBeGreaterThan(0.02); // Katoomba / Leura town and cleared land
    const wet = stats(terrain, d, isType(FuelType.WetForest));
    expect(wet.low).toBeGreaterThan(0.9);
  });
});
