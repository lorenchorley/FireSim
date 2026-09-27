import { describe, expect, it } from 'vitest';
import { FuelType, FUEL_TYPE_COUNT } from '../core/types';
import { FUEL_CLASSES, FUEL_CLASS_COUNT, FUEL_TYPES, genericClassOf, resolveClass, tfiMinYears } from './catalogue';

describe('FUEL_TYPES (spec §4.1)', () => {
  it('has one well-formed row per FuelType', () => {
    for (let t = 0; t < FUEL_TYPE_COUNT; t++) {
      const r = FUEL_TYPES[t as FuelType];
      expect(r, `type ${t}`).toBeDefined();
      expect(r.id).toBe(t);
      for (const layer of [r.surface, r.nearSurface, r.elevated, r.bark, r.canopy]) {
        expect(layer.load).toBeGreaterThanOrEqual(0);
        expect(layer.k).toBeGreaterThanOrEqual(0);
      }
      for (const v of Object.values(r.fhsMax)) expect(v >= 0 && v <= 4).toBe(true);
      expect(r.colour).toMatch(/^#[0-9a-f]{6}$/);
      expect(Number.isFinite(r.wrf) && r.wrf > 0).toBe(true);
      expect(r.receptivity >= 0 && r.receptivity <= 1).toBe(true);
    }
  });

  it('matches the §4.1 table on key rows', () => {
    const d = FUEL_TYPES[FuelType.DryForestShrubby];
    expect([d.surface.load, d.surface.k, d.nearSurface.load, d.elevated.load, d.bark.load, d.canopy.load]).toEqual([14.5, 0.17, 1.9, 4.9, 2.67, 3.5]);
    expect(d.fhsMax).toEqual({ surface: 3.4, nearSurface: 2.9, elevated: 3.3 });
    expect([d.family, d.moistureFamily, d.wrf, d.barkClass]).toEqual(['vesta2', 'forest', 3.5, 'stringy']);
    const w = FUEL_TYPES[FuelType.WetForest];
    expect([w.moistureFamily, w.wetSubmodel, w.wrf, w.canopy.k]).toEqual(['wetForest', true, 4.5, 0.35]);
    const h = FUEL_TYPES[FuelType.Heath];
    expect(h.surface.load + h.nearSurface.load + h.elevated.load).toBe(20); // AFDRS-RP generic heath total [V]
    expect([h.elevatedHeight, h.family]).toEqual([1.3, 'heath']);
    const g = FUEL_TYPES[FuelType.Grassland];
    expect(g.surface.load + g.nearSurface.load).toBeCloseTo(5.1, 9);
    expect([g.grassWaf, g.wrf]).toEqual([1.0, 1.2]);
    expect(FUEL_TYPES[FuelType.Urban].grassStateDefault).toBe('eatenOut');
    expect(FUEL_TYPES[FuelType.Rainforest].tfi).toBe('avoid');
    expect(FUEL_TYPES[FuelType.NonFuel].family).toBe('none');
    expect(FUEL_TYPES[FuelType.Water].family).toBe('none');
  });
});

describe('FUEL_CLASSES (spec §4.2)', () => {
  it('index = id; 0..12 are the generic classes of FuelType 0..12; 13..48 exist', () => {
    expect(FUEL_CLASS_COUNT).toBe(49);
    FUEL_CLASSES.forEach((c, i) => expect(c.id).toBe(i));
    for (let t = 0; t < FUEL_TYPE_COUNT; t++) {
      expect(genericClassOf(t as FuelType)).toBe(t);
      expect(FUEL_CLASSES[t]!.fuelType).toBe(t);
      expect(FUEL_CLASSES[t]!.overrides).toEqual({});
    }
  });

  it('family and moistureFamily resolve from the class (35, 39, 48)', () => {
    for (const id of [35, 39, 48]) {
      const c = resolveClass(id);
      expect(c.family).toBe('grass');
      expect(c.moistureFamily).toBe('grass');
    }
    expect(resolveClass(35).grassStateFixed).toBe('eatenOut');
    expect(resolveClass(48).grassStateFixed).toBe('eatenOut');
    expect(resolveClass(39).grassStateFixed).toBeUndefined(); // natural/grazed by load
    expect(resolveClass(39).curingOffset).toBe(-15);
    expect(resolveClass(39).totalFineLoad).toBeCloseTo(5.8, 2);
    expect(resolveClass(35).totalFineLoad).toBeCloseTo(2.6, 2);
    expect(resolveClass(35).id).toBe(FuelType.AlpineHeathGrass);
  });

  it('class overrides inherit unlisted fields from the type row', () => {
    const c14 = resolveClass(14);
    expect(c14.bark.load).toBe(2.62);
    expect(c14.canopyHeight).toBe(25);
    expect(c14.surface).toEqual(FUEL_TYPES[FuelType.DryForestShrubby].surface);
    const c30 = resolveClass(30);
    expect([c30.surface.load, c30.surface.k, c30.nearSurface.load, c30.wrf, c30.barkClass]).toEqual([24, 0.2, 0, 3.5, 'ribbon']);
    expect(c30.fhsMax).toEqual({ surface: 4.0, nearSurface: 3.0, elevated: 2.8 });
    const c16 = resolveClass(16);
    expect([c16.spotting, c16.barkClass, c16.bark.load]).toEqual([false, 'smooth', 0.6]);
    expect(resolveClass(22).wrf).toBe(4.0);
    expect(resolveClass(47).wrf).toBe(4.0);
    expect(resolveClass(36).id).toBe(FuelType.Water);
    expect(resolveClass(36).family).toBe('none');
  });

  it('heath "total k" classes carry their loads, split and derived FHS', () => {
    const c32 = resolveClass(32);
    expect(c32.totalFineLoad).toBeCloseTo(11.8, 6);
    expect(c32.surface.k).toBe(0.6);
    expect(c32.elevatedHeight).toBe(1.5);
    const c33 = resolveClass(33);
    expect(c33.totalFineLoad).toBeCloseTo(36.9, 6);
    expect(c33.elevatedHeight).toBe(4.0);
    for (const id of [32, 33, 34, 35, 37, 39]) {
      const f = resolveClass(id).fhsMax;
      for (const v of Object.values(f)) expect(v >= 0 && v <= 4).toBe(true);
    }
    expect(resolveClass(34).moistureOffsetIfKbdiBelow).toEqual({ pp: 3, kbdi: 100 });
  });

  it('TFI minimum per class (doc 05 §3.5)', () => {
    expect(tfiMinYears(resolveClass(13), 'minSfaz', 50)).toBe(7);
    expect(tfiMinYears(resolveClass(13), 'minLmz', 50)).toBe(10);
    expect(tfiMinYears(resolveClass(31), 'minSfaz', 50)).toBe(50); // rainforest: 'avoid'
    expect(tfiMinYears(resolveClass(30), 'minSfaz', 50)).toBe(10); // grassy WSF
    expect(tfiMinYears(resolveClass(25), 'minSfaz', 50)).toBe(25); // shrubby WSF
    expect(Number.isNaN(tfiMinYears(resolveClass(FuelType.PinePlantation), 'minSfaz', 50))).toBe(true);
  });

  it('unknown class ids fall back to NonFuel', () => {
    expect(resolveClass(200).id).toBe(FuelType.NonFuel);
  });
});
