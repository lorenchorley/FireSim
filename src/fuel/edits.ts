/**
 * Fuel edits `applyFuelEdit(fuel, edit, base, history, t0) → number` (spec §4.8).
 *
 * Cells = those whose centre lies in the BrushShape (circle test or even-odd polygon). Applied in this order:
 * 1. `setType` → class = the generic class of the type; §4.5 recomputed from the cell's records (history kept);
 * 2. `setTimeSinceFire = τ` → the cell's history becomes one synthetic record at t0 − τ·YEAR: a prescribed burn with
 *    p = 1 (full reset of s/ns; elevated and bark halved) [H], "completed back burn / burnt N years ago";
 * 3. hazard deltas: FHS = clamp(FHS + Δ, 0, 4), load = loadFromFhs(layer, FHS) (bark: barkLoad from the bark row);
 * 4. `elevatedHeight` → H_el;
 * 5. `moistureDelta` → moistureOffset += Δ, clamped to [−10, +40] pp.
 * Every cell the edit applies to gets FuelFlag.UserEdited and is counted in the return value; hazard / height edits on
 * non-fuel cells (rock, water, roads) change nothing and are not counted.
 *
 * Idempotence: the worker keeps an immutable base FuelMap (and base history) and re-applies the remaining edits in
 * order after `removeEdit` (use `cloneFuelMap(base)` for the working copy), so this function assumes `fuel` = base
 * plus the earlier edits. setTimeSinceFire overrides live in `fuel.syntheticBurnTime` (fuel-private, typed array).
 */
import { FuelFlag, FuelType, FUEL_TYPE_COUNT, type BrushShape, type FuelEdit, type FuelHistoryCompact, type FuelMap } from '../core/types';
import { clamp } from '../core/units';
import { localDate } from '../core/physics';
import { makeCellHistory, makeFuelState } from './accumulation';
import { genericClassOf, resolveClass } from './catalogue';
import {
  cellHistoryFor,
  classMoistureOffset,
  CTX_INFERRED,
  ensureFuelArrays,
  writeCell,
  type CellWriteEnv,
  type FuelBuildContext,
  type FuelMapExt,
} from './fuelMap';
import { loadFromFhs } from './hazard';
import { resolveFuelParams, YEAR_MS } from './params';
import { cellCentreLattice, pointInRings, ScanlineRasteriser } from './polygon';

/** Cell indices whose centres lie inside a brush shape (circle: distance ≤ r; polygon: even-odd). */
export function cellsInBrush(grid: FuelMap['grid'], shape: BrushShape): Int32Array {
  const out: number[] = [];
  const { nx, ny, cellSize: h, x0, y0 } = grid;
  if (shape.kind === 'circle') {
    const r = Math.max(0, shape.radius);
    const i0 = Math.max(0, Math.ceil((shape.x - r - x0) / h));
    const i1 = Math.min(nx - 1, Math.floor((shape.x + r - x0) / h));
    const j0 = Math.max(0, Math.ceil((shape.y - r - y0) / h));
    const j1 = Math.min(ny - 1, Math.floor((shape.y + r - y0) / h));
    const r2 = r * r;
    for (let j = j0; j <= j1; j++) {
      const dy = y0 + j * h - shape.y;
      for (let i = i0; i <= i1; i++) {
        const dx = x0 + i * h - shape.x;
        if (dx * dx + dy * dy <= r2) out.push(j * nx + i);
      }
    }
    return Int32Array.from(out);
  }
  const pts = shape.points;
  if (!pts || pts.length < 3) return new Int32Array(0);
  const ring = new Float64Array(pts.length * 2);
  for (let p = 0; p < pts.length; p++) {
    ring[2 * p] = pts[p]![0];
    ring[2 * p + 1] = pts[p]![1];
  }
  new ScanlineRasteriser().rasterise([ring], cellCentreLattice(grid), (j, a, b) => {
    for (let i = a; i <= b; i++) out.push(j * nx + i);
  });
  return Int32Array.from(out);
}

/** True when a cell centre (x, y) is inside the brush (single-point test, e.g. for the UI). */
export function brushContains(shape: BrushShape, x: number, y: number): boolean {
  if (shape.kind === 'circle') return (x - shape.x) ** 2 + (y - shape.y) ** 2 <= shape.radius ** 2;
  const ring = new Float64Array(shape.points.flat());
  return pointInRings(x, y, [ring]);
}

function contextOf(fuel: FuelMapExt, base: FuelMapExt, t0: number): FuelBuildContext {
  const bc = fuel.buildContext ?? base.buildContext;
  if (bc) return bc;
  // Maps from other producers: drought defaults of §11.6 (DF 7, KBDI 60) and the month of t0.
  return { t0, droughtFactor: 7, kbdi: 60, month: Number(localDate(t0).slice(5, 7)) };
}

/**
 * Apply one fuel edit in place (§4.8). `base` is the unedited map (context fallback and the vegetation-inference
 * test); `history` the base per-cell fire records. Returns the number of cells changed.
 */
export function applyFuelEdit(fuel: FuelMap, edit: FuelEdit, base: FuelMap, history: FuelHistoryCompact, t0: number): number {
  const f = fuel as FuelMapExt;
  const b = base as FuelMapExt;
  const cells = cellsInBrush(f.grid, edit.shape);
  if (cells.length === 0) return 0;
  const bc = contextOf(f, b, t0);
  const P = resolveFuelParams(bc.params);
  const a = ensureFuelArrays(f);
  if (!f.cellContext && b.cellContext && b.cellContext.length === f.type.length) f.cellContext = b.cellContext.slice();
  if (!f.faBlendW && b.faBlendW) f.faBlendW = b.faBlendW.slice();
  const env: CellWriteEnv = { P, t0, droughtFactor: bc.droughtFactor, kbdi: bc.kbdi, month: bc.month, state: makeFuelState() };
  const hist = makeCellHistory();

  const setType = edit.setType !== undefined && edit.setType >= 0 && edit.setType < FUEL_TYPE_COUNT ? (edit.setType as FuelType) : undefined;
  const tau = edit.setTimeSinceFire !== undefined && Number.isFinite(edit.setTimeSinceFire) ? Math.max(0, edit.setTimeSinceFire) : undefined;
  if (tau !== undefined && !f.syntheticBurnTime) f.syntheticBurnTime = new Float64Array(f.type.length).fill(NaN);
  const finiteOr0 = (v: number | undefined): number => (v !== undefined && Number.isFinite(v) ? v : 0);
  const dS = finiteOr0(edit.surfaceHazardDelta);
  const dNs = finiteOr0(edit.nearSurfaceHazardDelta);
  const dEl = finiteOr0(edit.elevatedHazardDelta);
  const dB = finiteOr0(edit.barkHazardDelta);
  const hEl = edit.elevatedHeight !== undefined && Number.isFinite(edit.elevatedHeight) ? Math.max(0, edit.elevatedHeight) : undefined;
  const dM = finiteOr0(edit.moistureDelta);
  const baseClass = b.fuelClass ?? b.type;

  let changed = 0;
  for (let q = 0; q < cells.length; q++) {
    const k = cells[q]!;
    const oldClass = a.fuelClass[k]!;
    let classId = oldClass;
    let recompute = false;
    if (setType !== undefined) {
      classId = genericClassOf(setType);
      recompute = true;
    }
    if (tau !== undefined) {
      f.syntheticBurnTime![k] = t0 - tau * YEAR_MS;
      recompute = true;
    }
    if (recompute) {
      cellHistoryFor(f, history, k, hist);
      // Still "inferred" only while the user has not asserted a type (setType) and the class is the inferred one.
      const inferred = setType === undefined && f.cellContext !== undefined && (f.cellContext[k]! & CTX_INFERRED) !== 0 && classId === baseClass[k];
      writeCell(f, k, classId, hist, env, inferred);
      if (classId !== oldClass) {
        const off = a.moistureOffset[k]! - classMoistureOffset(resolveClass(oldClass), bc.kbdi) + classMoistureOffset(resolveClass(classId), bc.kbdi);
        a.moistureOffset[k] = clamp(off, P.moistureOffsetMin, P.moistureOffsetMax);
      }
    }
    const burnable = resolveClass(classId).family !== 'none';
    // Hazard and height edits do nothing on non-fuel cells (rock, water, roads): such cells are not "changed".
    const fuelEdit = burnable && (dS !== 0 || dNs !== 0 || dEl !== 0 || dB !== 0 || hEl !== undefined);
    if (!recompute && !fuelEdit && !dM) continue;
    if (fuelEdit) {
      if (dS) {
        const v = clamp(f.surfaceHazard[k]! + dS, 0, 4);
        f.surfaceHazard[k] = v;
        f.surfaceLoad[k] = loadFromFhs('surface', v);
      }
      if (dNs) {
        const v = clamp(f.nearSurfaceHazard[k]! + dNs, 0, 4);
        f.nearSurfaceHazard[k] = v;
        f.nearSurfaceLoad[k] = loadFromFhs('nearSurface', v);
      }
      if (dEl) {
        const v = clamp(f.elevatedHazard[k]! + dEl, 0, 4);
        f.elevatedHazard[k] = v;
        f.elevatedLoad[k] = loadFromFhs('elevated', v);
      }
      if (dB) {
        const v = clamp(f.barkHazard[k]! + dB, 0, 4);
        f.barkHazard[k] = v;
        f.barkLoad[k] = loadFromFhs('bark', v);
      }
      if (dS || dB) {
        const heavy = f.surfaceHazard[k]! >= P.heavyFuelFhsS || f.barkHazard[k]! >= P.heavyFuelBarkHazard;
        a.flags[k] = heavy ? a.flags[k]! | FuelFlag.HeavyFuel : a.flags[k]! & ~FuelFlag.HeavyFuel;
      }
      if (hEl !== undefined) f.elevatedHeight[k] = hEl;
    }
    if (dM) a.moistureOffset[k] = clamp(a.moistureOffset[k]! + dM, P.moistureOffsetMin, P.moistureOffsetMax);
    a.flags[k] = a.flags[k]! | FuelFlag.UserEdited;
    changed++; // cells the edit applies to (§4.8 return value)
  }
  return changed;
}
