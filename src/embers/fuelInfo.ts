/**
 * Per-cell fuel attributes the ember model needs (spec §4.1 catalogue columns "spot / bark", τ_f, R_fuel, H_o;
 * §2.1 `FuelFlag`, `CellFuelParams`).
 *
 * The rows are resolved from `FUEL_TYPES` + `FUEL_CLASSES` overrides (fuel/catalogue.ts, the location §2.1 names for
 * the catalogue data), once per class id. `EmberModel` accepts an optional `cellFuel(k)` resolver (the sim can pass
 * `fuelParamsAt`) that takes precedence, so user edits and class-level overrides flow through one path.
 */
import { FuelFlag, type BarkClass, type CellFuelParams, type FuelFamily, type FuelMap } from '../core/types';
import { FUEL_CLASSES, FUEL_TYPES } from '../fuel/catalogue';

/** The subset of `CellFuelParams` the ember model reads. */
export type EmberCellFuel = Pick<CellFuelParams, 'spotting' | 'barkClass' | 'tauF' | 'receptivity' | 'hOEff' | 'family' | 'flags'>;

interface ClassRow {
  spotting: boolean;
  barkClass: BarkClass;
  tauF: number;
  receptivity: number;
  hO: number;
  family: FuelFamily;
}

const ROWS: ClassRow[] = FUEL_CLASSES.map((c) => {
  const t = FUEL_TYPES[c.fuelType];
  const o = c.overrides;
  return {
    spotting: o.spotting ?? t.spotting,
    barkClass: o.barkClass ?? t.barkClass,
    tauF: o.flameResidence ?? t.flameResidence,
    receptivity: o.receptivity ?? t.receptivity,
    hO: o.canopyHeight ?? t.canopyHeight,
    family: o.family ?? t.family,
  };
});

/** Class row of cell k (fuelClass when present, else the generic class of the fuel type). */
function row(fuel: FuelMap, k: number): ClassRow {
  const id = fuel.fuelClass ? fuel.fuelClass[k]! : fuel.type[k]!;
  return ROWS[id] ?? ROWS[fuel.type[k]!] ?? ROWS[0]!;
}

/** Ember-relevant fuel attributes of cell k from the catalogue (fills `out`). */
export function catalogueCellFuel(fuel: FuelMap, k: number, out: EmberCellFuel): EmberCellFuel {
  const r = row(fuel, k);
  out.spotting = r.spotting;
  out.barkClass = r.barkClass;
  out.tauF = r.tauF > 0 ? r.tauF : 30;
  out.receptivity = r.receptivity;
  const chm = fuel.canopyHeight[k]!;
  out.hOEff = fuel.canopyHeightEff ? fuel.canopyHeightEff[k]! : Math.max(chm > 0 ? chm : 0, 0.8 * r.hO);
  out.family = r.family;
  out.flags = fuel.flags ? fuel.flags[k]! : 0;
  return out;
}

/** Receptivity R_fuel base of cell k (§9.5, × the family factor at landing). */
export function catalogueReceptivity(fuel: FuelMap, k: number): number {
  return row(fuel, k).receptivity;
}

/** Stringybark present (E1 flakes): FuelFlag.Stringybark or barkClass 'stringy' ('mixed' per params). */
export function hasStringybark(c: EmberCellFuel, mixedIsStringy: boolean): boolean {
  return (c.flags & FuelFlag.Stringybark) !== 0 || c.barkClass === 'stringy' || (mixedIsStringy && c.barkClass === 'mixed');
}

/** Ribbon bark present (E2 strips): FuelFlag.RibbonBark or barkClass 'ribbon' ('mixed' per params). */
export function hasRibbonBark(c: EmberCellFuel, mixedIsRibbon: boolean): boolean {
  return (c.flags & FuelFlag.RibbonBark) !== 0 || c.barkClass === 'ribbon' || (mixedIsRibbon && c.barkClass === 'mixed');
}
