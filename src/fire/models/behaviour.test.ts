/**
 * Object API (spec §6.1), dispatch by class family, spread-factor decomposition (§6.12, D45), validity flags, the
 * kernel ↔ object consistency and physical property tests (monotonicity, finiteness, R_w ≥ R0 for every family).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { FuelType, type CellFuelParams, type FireBehaviourInput } from '../../core/types';
import {
  cellParamsFromInput, defaultBehaviourInput, fireBehaviour, grassland, heath, heathModelSpread, mcArthurMk5Behaviour, pine, vesta2012Behaviour, vestaMk2,
} from './behaviour';
import { fuelAvailabilityMk2, slopeFactor } from './common';
import { createReferenceFactorsOut, referenceFactors } from './factors';
import { cellParamsFromRow, familyOf, fuelRow, genericCellParams, registerFuelCatalogue } from './fuelRef';
import { createHeadKernelOut, headRosKernel, KernelInvalid } from './kernel';
import { resetFireModelOptions, setFireModelOptions } from './params';
import { FUEL_TYPES } from '../../fuel/catalogue';
import { createEllipseCoeffs, ellipseCoefficients, ellipseSupportCos } from './shape';
import { expectVector } from './testUtil';

afterEach(() => resetFireModelOptions());

const dfsInput = (u10kmh: number, m: number, df: number, over: Partial<FireBehaviourInput> = {}): FireBehaviourInput => ({
  ...defaultBehaviourInput(FuelType.DryForestShrubby, { u10Ms: u10kmh / 3.6, mPct: m, df }),
  ...over,
});

describe('generic-fuel factor decomposition (spec §6.12, D45)', () => {
  // DryForestShrubby 2 yr after a p = 0.6 prescribed burn (spec §4.5: s ≈ 8.31, ns ≈ 1.09, FHS_el ≈ 2.63): the vector's
  // FL 9.40 and H_u 1.018 exactly (H_u = −0.1 + 0.06·FHS_el + 0.48·2.0 → FHS_el = 2.6333).
  const generic = genericCellParams(FuelType.DryForestShrubby);
  const burnt: CellFuelParams = { ...generic, surfaceLoad: 8.3114, nearSurfaceLoad: 1.0886, elevatedLoad: 3.915, fhsEl: (1.018 + 0.1 - 0.96) / 0.06 };
  const fa = fuelAvailabilityMk2(8);
  it('FA(DF 8) = 0.950', () => expectVector(fa, '0.950'));
  it('recent burn: base 15.43 m/h, wind 28.03, fuel 0.311, moisture 2.133, R_w 286.7 m/h', () => {
    const f = referenceFactors(burnt, 15, 8, fa, createReferenceFactorsOut());
    expectVector(f.base * 3600, '15.43');
    expectVector(f.wind, '28.03');
    expectVector(f.fuel, '0.311');
    expectVector(f.moisture, '2.133');
    expectVector(f.rw, '286.7', 1);
    expect(f.base * 3600 * f.wind * f.fuel * f.moisture).toBeCloseTo(f.rw, 8);
  });
  it('long-unburnt neighbour: fuel 1.000, moisture 1.281, R_w 554.3 m/h', () => {
    const f = referenceFactors(generic, 15, 8, fa, createReferenceFactorsOut());
    expectVector(f.fuel, '1.000');
    expectVector(f.moisture, '1.281');
    expectVector(f.rw, '554.3', 1);
  });
  it('product equals the head rate for every family and a range of conditions', () => {
    const types = [FuelType.DryForestShrubby, FuelType.WetForest, FuelType.Grassland, FuelType.GrassyWoodland, FuelType.Heath, FuelType.PinePlantation, FuelType.Urban];
    const k = createHeadKernelOut();
    for (const t of types)
      for (const u of [0, 3, 12, 40])
        for (const m of [4, 8, 14]) {
          const p = cellParamsFromRow(t, fuelRow(t));
          const f = referenceFactors(p, u, m, 0.8, createReferenceFactorsOut(), 8);
          headRosKernel(p, u, m, 0.8, k, 8);
          expect(f.rw).toBeCloseTo(k.rw, 9);
          const prod = f.base * 3600 * f.wind * f.fuel * f.moisture;
          expect(Math.abs(prod - k.rw)).toBeLessThanOrEqual(1e-6 * Math.max(1, k.rw));
        }
  });
  it('object API: factors multiply to rosHead (flat, slope, capped)', () => {
    for (const [u, slope] of [[15, 0], [30, 15], [60, -20], [80, 40]] as const) {
      const o = fireBehaviour(dfsInput(u, 5, 10, { slopeDeg: slope }));
      const f = o.factors;
      expect(f.base * f.wind * f.fuel * f.moisture * f.slope * f.terrain).toBeCloseTo(o.rosHead, 9);
      expect(f.slope).toBeCloseTo(slopeFactor(slope), 12);
    }
  });
});

describe('fireBehaviour dispatch (spec §6.1)', () => {
  it('family resolves from the class: Alpine Herbfields (39) → grass; bogs (35) → eaten-out grass; 48 → eaten-out', () => {
    expect(familyOf(FuelType.AlpineHeathGrass)).toBe('heath');
    expect(familyOf(FuelType.AlpineHeathGrass, 39)).toBe('grass');
    const base = defaultBehaviourInput(FuelType.AlpineHeathGrass, { u10Ms: 20 / 3.6, mPct: 8, df: 8 });
    expect(fireBehaviour(base).model).toMatch(/heath/);
    expect(fireBehaviour({ ...base, fuelClass: 39 }).model).toBe('CSIRO grassland');
    expect(cellParamsFromInput({ ...base, fuelClass: 35 }).grassState).toBe('eatenOut');
    expect(cellParamsFromInput({ ...defaultBehaviourInput(FuelType.Grassland, { u10Ms: 5, mPct: 8, df: 8 }), fuelClass: 48 }).grassState).toBe('eatenOut');
    expect(fireBehaviour({ ...base, fuelClass: 35 }).fbi).toBe(fireBehaviour({ ...base, fuelClass: 35 }).fbi); // deterministic
  });
  it('class overrides: 16 (Sydney Sand Flats DSF) does not spot; class WRF applies when the input gives none', () => {
    const b = dfsInput(40, 5, 10);
    expect(fireBehaviour(b).spottingDistance).toBeGreaterThan(1000);
    expect(fireBehaviour({ ...b, fuelClass: 16 }).spottingDistance).toBe(0);
    const w = defaultBehaviourInput(FuelType.WetForest, { u10Ms: 30 / 3.6, mPct: 8, df: 10 });
    delete w.wrf;
    expect(cellParamsFromInput(w).wrf).toBe(4.5);
    expect(cellParamsFromInput({ ...w, fuelClass: 22 }).wrf).toBe(4.0);
  });
  it('Mk2 vector through the object API: (30, 6, DF 10, FL 15, H_u 1.5; WRF 3) → 2114.2 m/h, phase 2', () => {
    // H_u 1.5 = −0.1 + 0.06·FHS_el + 0.48·H_el with H_el 2.0 → FHS_el 10.67 is outside 0–4, so use H_el 2.9 and FHS_el 3.5.
    const o = vestaMk2(dfsInput(30, 6, 10, { surfaceLoad: 13, nearSurfaceLoad: 2, elevatedHeight: 2.9, elevatedHazard: 3.5, wrf: 3 }));
    expectVector(o.rosHead * 3600, '2114.2', 1);
    expect(o.phase).toBe(2);
    expect(o.model).toBe('Vesta Mk2');
    expectVector(o.p3!, '0.466');
    expect(o.validated).toBe(true);
  });
  it('flat ground: R_B = max(cb·R_w, R0), R_F = h·R_w, and the ellipse ŝ reproduces them', () => {
    const o = fireBehaviour(dfsInput(30, 6, 10));
    const e = ellipseCoefficients(o.lengthBreadth, createEllipseCoeffs());
    expect(o.rosBack).toBeCloseTo(Math.max(e.cb * o.rosHead, o.ros0!), 12);
    expect(o.rosFlank).toBeCloseTo(e.h * o.rosHead, 12);
    expect(o.rosHead * ellipseSupportCos(e, -1)).toBeCloseTo(e.cb * o.rosHead, 12);
    expectVector(o.lengthBreadth, '3.843');
  });
  it('slope: head × SF(θ), back × SF(−θ) (Kataburn ≥ 0.5)', () => {
    const flat = fireBehaviour(dfsInput(10, 8, 10));
    const up = fireBehaviour(dfsInput(10, 8, 10, { slopeDeg: 20 }));
    expect(up.rosHead / flat.rosHead).toBeCloseTo(4, 9);
    expect(up.rosBack / flat.rosBack).toBeCloseTo(slopeFactor(-20), 9);
  });
  it('forest 15 km/h cap (D4): capped head, terrain factor < 1, validated false', () => {
    const o = fireBehaviour(dfsInput(60, 4, 10, { slopeDeg: 30 }));
    expect(o.rosHead * 3600).toBeCloseTo(15000, 6);
    expect(o.factors.terrain).toBeLessThan(1);
    expect(o.validated).toBe(false);
    // Grass and heath are exempt.
    const g = fireBehaviour({ ...defaultBehaviourInput(FuelType.Grassland, { u10Ms: 60 / 3.6, mPct: 4, df: 10 }), slopeDeg: 30 });
    expect(g.rosHead * 3600).toBeGreaterThan(15000);
  });
  it('validated = false outside data ranges: slope > 20° or < −30°, U10 < 5 km/h, M > 20 %, curing < 20 %', () => {
    expect(fireBehaviour(dfsInput(30, 6, 10, { slopeDeg: 19 })).validated).toBe(true);
    expect(fireBehaviour(dfsInput(30, 6, 10, { slopeDeg: 21 })).validated).toBe(false);
    expect(fireBehaviour(dfsInput(30, 6, 10, { slopeDeg: -31 })).validated).toBe(false);
    expect(fireBehaviour(dfsInput(4, 6, 10)).validated).toBe(false);
    expect(fireBehaviour(dfsInput(30, 21, 10)).validated).toBe(false);
    const g = defaultBehaviourInput(FuelType.Grassland, { u10Ms: 5, mPct: 8, df: 8, curing: 15 });
    expect(grassland(g).validated).toBe(false);
    const k = createHeadKernelOut();
    headRosKernel({ ...cellParamsFromRow(FuelType.Grassland, fuelRow(FuelType.Grassland)), curing: 15 }, 20, 8, 1, k);
    expect(k.invalid & KernelInvalid.Curing).toBeTruthy();
  });
  it('wet forest: FA from C1(KBDI, WRF)·DF; wrf outside [3, 5] flagged', () => {
    const w = defaultBehaviourInput(FuelType.WetForest, { u10Ms: 30 / 3.6, mPct: 8, df: 10 });
    const lo = fireBehaviour({ ...w, kbdi: 20 });
    const hi = fireBehaviour({ ...w, kbdi: 180 });
    expect(lo.fuelAvailability!).toBeLessThan(0.2);
    expect(hi.fuelAvailability!).toBeGreaterThan(0.9);
    expect(hi.rosHead).toBeGreaterThan(3 * lo.rosHead);
    expect(fireBehaviour({ ...w, kbdi: 180, wrf: 5.5 }).validated).toBe(false);
    // wetForest: false switches the wet submodel off (dry Mk2 availability).
    expect(fireBehaviour({ ...w, kbdi: 20, wetForest: false }).fuelAvailability).toBeCloseTo(fuelAvailabilityMk2(10), 12);
  });
  it('grass: 1854 m/h vector via the object API (natural, U 10, M 8, C 90); WAF under woodland', () => {
    const g = { ...defaultBehaviourInput(FuelType.Grassland, { u10Ms: 10 / 3.6, mPct: 8, df: 8, curing: 90 }), grassState: 'natural' as const };
    expectVector(fireBehaviour(g).rosHead * 3600, 1854, 1);
    const wood = defaultBehaviourInput(FuelType.GrassyWoodland, { u10Ms: 10 / 3.6, mPct: 8, df: 8, curing: 90 });
    const open = fireBehaviour({ ...wood, canopyCover: 0.2, grassState: 'natural' });
    const closed = fireBehaviour({ ...wood, canopyCover: 0.5, grassState: 'natural' });
    expectVector(open.rosHead * 3600, '927', 1);
    expect(closed.rosHead / open.rosHead).toBeCloseTo(0.6, 9);
    expect(open.spottingDistance).toBeGreaterThan(0); // GrassyWoodland spots (forest envelope)
    expect(fireBehaviour(g).spottingDistance).toBe(0);
  });
  it('heath refit default, v1.0 by option; model spread note (> 25 %)', () => {
    const h = defaultBehaviourInput(FuelType.Heath, { u10Ms: 30 / 3.6, mPct: 6, df: 10 });
    expectVector(heath(h).rosHead * 3600, '3860.6', 1);
    expectVector(heath(h, { heathModel: 'v1' }).rosHead * 3600, '3495.8', 1);
    expectVector(heath(h).intensity, 39892, 1);
    expectVector(heath(h).flameHeight, '12.99');
    expect(heathModelSpread(h).showSpread).toBe(false);
    expect(heathModelSpread({ ...h, windSpeed10: 5 / 3.6, deadFuelMoisture: 12 }).showSpread).toBe(true);
    expect(heath(h).spottingDistance).toBe(0);
  });
  it('pine vector through the object API (KBDI 100): ROS 1481, I 13 128', () => {
    const p = {
      ...defaultBehaviourInput(FuelType.PinePlantation, { u10Ms: 30 / 3.6, mPct: 4.3426 + 0.1188 * 20 - 0.0211 * 30, df: 10 }),
      kbdi: 100, surfaceLoad: 10, nearSurfaceLoad: 2, elevatedLoad: 2, canopyLoad: 10, elevatedHeight: 1.0, elevatedHazard: (1.0 + 0.1 - 0.48) / 0.06,
      canopyHeight: 20, canopyHeightEff: 20, wrf: 4,
    };
    // FHS_el 10.33 reproduces the vector's H_u 1.0 with H_el 1.0 (the vector gives H_u directly).
    const o = pine(p);
    expectVector(o.rosHead * 3600, 1481, 1);
    expectVector(o.intensity, 13128, 1);
    expectVector(o.flameHeight, '12.37');
    expect(o.model).toBe('AFDRS pine');
  });
  it('comparison models: Vesta 2012 vector 1402 m/h; Mk5 1105 m/h at FFDI 61.39, W 15', () => {
    const v = vesta2012Behaviour(dfsInput(30, 6, 10, { surfaceHazard: 3.5, nearSurfaceHazard: 3, nearSurfaceHeight: 0.2, fuelAvailability: 1, wrf: 3 }));
    expectVector(v.rosHead * 3600, 1402, 1);
    const mk = mcArthurMk5Behaviour(dfsInput(40, 6, 10, { temperature: 35, relativeHumidity: 15, fineFuelLoad: 15 }));
    expectVector(mk.rosHead * 3600, 1105, 1);
    expectVector(mk.spottingDistance, 3700, 10);
  });
  it('none family: all zero; loads scale from fineFuelLoad when layer loads are absent', () => {
    const w = fireBehaviour(defaultBehaviourInput(FuelType.Water, { u10Ms: 10, mPct: 5, df: 10 }));
    expect([w.rosHead, w.intensity, w.flameHeight, w.spottingDistance]).toEqual([0, 0, 0, 0]);
    const inp = dfsInput(20, 8, 8);
    delete inp.surfaceLoad;
    delete inp.nearSurfaceLoad;
    delete inp.elevatedLoad;
    const p = cellParamsFromInput({ ...inp, fineFuelLoad: 10.65 });
    expect(p.surfaceLoad + p.nearSurfaceLoad + p.elevatedLoad).toBeCloseTo(10.65, 9);
    expect(p.surfaceLoad / p.nearSurfaceLoad).toBeCloseTo(14.5 / 1.9, 9);
  });
  it('fresh burn scar (FL < 1 t/ha) does not spread (minFineLoad [H])', () => {
    const o = fireBehaviour(dfsInput(30, 6, 10, { surfaceLoad: 0.3, nearSurfaceLoad: 0.2 }));
    expect(o.rosHead).toBe(0);
  });
  it('rows come from fuel/ FUEL_TYPES; a substituted catalogue is used until reset', () => {
    expect(fuelRow(FuelType.DryForestShrubby)).toMatchObject({ s: 14.5, ns: 1.9, el: 4.9, fhsEl: 3.3, hEl: 2.0, wrf: 3.5 });
    try {
      const alt = { ...FUEL_TYPES, [FuelType.DryForestShrubby]: { ...FUEL_TYPES[FuelType.DryForestShrubby], wrf: 4 } };
      registerFuelCatalogue(alt);
      expect(genericCellParams(FuelType.DryForestShrubby).wrf).toBe(4);
    } finally {
      registerFuelCatalogue(null);
    }
    expect(genericCellParams(FuelType.DryForestShrubby).wrf).toBe(3.5);
  });
});

describe('physical properties', () => {
  const families = [FuelType.DryForestShrubby, FuelType.WetForest, FuelType.Grassland, FuelType.Heath, FuelType.PinePlantation, FuelType.Urban, FuelType.SnowGumWoodland];
  it('rw ≥ r0, non-decreasing in wind, non-increasing in moisture, finite for all families', () => {
    const k = createHeadKernelOut();
    for (const t of families) {
      const p = cellParamsFromRow(t, fuelRow(t));
      for (const m of [3, 6, 10, 16, 22, 30]) {
        let prev = 0;
        for (let u = 0; u <= 100; u += 0.5) {
          headRosKernel(p, u, m, 0.9, k, 9);
          expect(Number.isFinite(k.rw)).toBe(true);
          expect(k.rw).toBeGreaterThanOrEqual(k.r0);
          expect(k.rw).toBeGreaterThanOrEqual(prev - 1e-9);
          prev = k.rw;
        }
      }
      for (const u of [0, 5, 20, 50]) {
        let prev = Infinity;
        for (let m = 2; m <= 35; m += 0.25) {
          headRosKernel(p, u, m, 0.9, k, 9);
          expect(k.rw).toBeLessThanOrEqual(prev + 1e-9);
          prev = k.rw;
        }
      }
    }
  });
  it('drier drought (higher DF) never slows a forest fire; intensity rises with ROS', () => {
    let prev = 0;
    for (let df = 0; df <= 10; df += 0.5) {
      const o = fireBehaviour(dfsInput(25, 7, df));
      expect(o.rosHead).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = o.rosHead;
    }
    const a = fireBehaviour(dfsInput(10, 8, 9));
    const b = fireBehaviour(dfsInput(40, 8, 9));
    expect(b.intensity).toBeGreaterThan(a.intensity);
    expect(b.flameHeight).toBeGreaterThan(a.flameHeight);
    expect(b.spottingDistance).toBeGreaterThanOrEqual(a.spottingDistance);
  });
  it('fuzz: random inputs give finite, non-negative outputs', () => {
    let s = 12345;
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let n = 0; n < 3000; n++) {
      const t = Math.floor(rnd() * 13) as FuelType;
      const inp = defaultBehaviourInput(t, { u10Ms: rnd() * 30, mPct: 1 + rnd() * 40, df: rnd() * 10, curing: rnd() * 100 });
      inp.slopeDeg = (rnd() - 0.5) * 100;
      inp.kbdi = rnd() * 200;
      const o = fireBehaviour(inp);
      for (const v of [o.rosHead, o.rosBack, o.rosFlank, o.intensity, o.flameHeight, o.spottingDistance, o.lengthBreadth, o.fuelConsumed]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
      }
      expect(o.rosBack).toBeLessThanOrEqual(o.rosHead + 1e-12);
    }
  });
  it('mixing switch applies to the kernel (normalised ≤ coded)', () => {
    const p = { ...cellParamsFromRow(FuelType.WetForest, fuelRow(FuelType.WetForest)), surfaceLoad: 4, nearSurfaceLoad: 1, wrf: 5 };
    const k = createHeadKernelOut();
    headRosKernel(p, 30, 6, 1, k);
    const coded = k.rw;
    setFireModelOptions({ mk2Mixing: 'normalised' });
    headRosKernel(p, 30, 6, 1, k);
    expect(k.rw).toBeLessThan(coded);
  });
});
