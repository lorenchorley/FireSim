/**
 * Display copy of the fuel map with the user's fuel-brush edits applied, for SceneViewApi.refreshFuel: trees vanish
 * from a painted fire trail, the fuel-type / fuel-load / time-since-fire overlays change, denser understorey shows.
 *
 * The simulation worker applies the authoritative edit (src/fuel) when it receives the FuelEdit; this is a visual
 * approximation made on the main thread so the trainee sees the brush take effect straight away. Hazard scores are
 * changed exactly as the edit says (clamped 0–4); fine fuel loads are rescaled in proportion to their layer's score
 * (or set from a typical load per score where there was none). Moisture deltas have no fuel-map field and are
 * ignored here (the engine's litter-moisture overlay shows them).
 */
import { FireHistoryKind, FuelType, type FuelEdit, type FuelMap, type ScenarioEdit } from '../core/types';
import { pointInRing, type Pt } from './brushGeometry';

/** Typical fine fuel load (t/ha) per hazard score point, by layer (OFHAG / Vesta Mk2 look-up tables, rounded). */
const LOAD_PER_SCORE = { surface: 4.5, nearSurface: 1.5, elevated: 2, bark: 1.2 } as const;

/** Deep copy of a fuel map: every typed-array layer is copied (including optional layers added by src/fuel). */
export function cloneFuel(f: FuelMap): FuelMap {
  const out: Record<string, unknown> = { ...f, grid: { ...f.grid, origin: { ...f.grid.origin } }, sources: [...f.sources] };
  for (const [k, v] of Object.entries(f)) {
    if (ArrayBuffer.isView(v) && !(v instanceof DataView)) out[k] = (v as Float32Array | Uint8Array | Uint16Array).slice();
  }
  return out as unknown as FuelMap;
}

/** Cell indices whose centres lie inside a brush shape. */
export function cellsInShape(f: FuelMap, shape: FuelEdit['shape']): number[] {
  const g = f.grid;
  const ring: readonly Pt[] = shape.kind === 'polygon' ? shape.points : [];
  let x0: number, x1: number, y0: number, y1: number;
  if (shape.kind === 'circle') {
    x0 = shape.x - shape.radius;
    x1 = shape.x + shape.radius;
    y0 = shape.y - shape.radius;
    y1 = shape.y + shape.radius;
  } else {
    if (ring.length < 3) return [];
    x0 = Math.min(...ring.map((p) => p[0]));
    x1 = Math.max(...ring.map((p) => p[0]));
    y0 = Math.min(...ring.map((p) => p[1]));
    y1 = Math.max(...ring.map((p) => p[1]));
  }
  const i0 = Math.max(0, Math.ceil((x0 - g.x0) / g.cellSize));
  const i1 = Math.min(g.nx - 1, Math.floor((x1 - g.x0) / g.cellSize));
  const j0 = Math.max(0, Math.ceil((y0 - g.y0) / g.cellSize));
  const j1 = Math.min(g.ny - 1, Math.floor((y1 - g.y0) / g.cellSize));
  const out: number[] = [];
  for (let j = j0; j <= j1; j++) {
    const y = g.y0 + j * g.cellSize;
    for (let i = i0; i <= i1; i++) {
      const x = g.x0 + i * g.cellSize;
      const inside = shape.kind === 'circle' ? (x - shape.x) ** 2 + (y - shape.y) ** 2 <= shape.radius ** 2 : pointInRing(x, y, ring);
      if (inside) out.push(j * g.nx + i);
    }
  }
  return out;
}

const clamp4 = (v: number): number => (v < 0 ? 0 : v > 4 ? 4 : v);

/** New load after a hazard score change: proportional to the score, or a typical load where there was none. */
function rescale(load: number, before: number, after: number, perScore: number): number {
  if (after <= 0) return 0;
  if (before > 0 && load > 0) return (load * after) / before;
  return after * perScore;
}

/** Apply one fuel edit to `f` in place; returns the number of cells changed. */
export function applyFuelEdit(f: FuelMap, e: FuelEdit): number {
  const cells = cellsInShape(f, e.shape);
  for (const k of cells) {
    if (e.setType !== undefined) {
      f.type[k] = e.setType;
      if (e.setType === FuelType.NonFuel || e.setType === FuelType.Water) {
        f.surfaceHazard[k] = f.nearSurfaceHazard[k] = f.elevatedHazard[k] = f.barkHazard[k] = 0;
        f.surfaceLoad[k] = f.nearSurfaceLoad[k] = f.elevatedLoad[k] = f.barkLoad[k] = 0;
        f.nearSurfaceHeight[k] = f.elevatedHeight[k] = 0;
        f.canopyCover[k] = 0;
        f.canopyHeight[k] = 0;
      }
    }
    const layer = (hazard: Float32Array, load: Float32Array, delta: number | undefined, perScore: number): void => {
      if (!delta) return;
      const before = hazard[k]!;
      const after = clamp4(before + delta);
      hazard[k] = after;
      load[k] = rescale(load[k]!, before, after, perScore);
    };
    layer(f.surfaceHazard, f.surfaceLoad, e.surfaceHazardDelta, LOAD_PER_SCORE.surface);
    layer(f.nearSurfaceHazard, f.nearSurfaceLoad, e.nearSurfaceHazardDelta, LOAD_PER_SCORE.nearSurface);
    layer(f.elevatedHazard, f.elevatedLoad, e.elevatedHazardDelta, LOAD_PER_SCORE.elevated);
    layer(f.barkHazard, f.barkLoad, e.barkHazardDelta, LOAD_PER_SCORE.bark);
    if (e.elevatedHeight !== undefined) f.elevatedHeight[k] = e.elevatedHeight;
    if (e.setTimeSinceFire !== undefined) {
      f.timeSinceFire[k] = e.setTimeSinceFire;
      f.lastFireKind[k] = FireHistoryKind.PrescribedBurn;
    }
  }
  return cells.length;
}

/**
 * The base fuel map with all fuel edits applied (in order), as a new map; the base is not modified. Returns the base
 * itself when there are no fuel edits, and null if the base arrays are unusable (e.g. detached by a transfer).
 */
export function fuelWithEdits(base: FuelMap, edits: readonly ScenarioEdit[]): FuelMap | null {
  const fuelEdits = edits.filter((e): e is FuelEdit => e.kind === 'fuel');
  if (base.type.length !== base.grid.nx * base.grid.ny) return null;
  if (!fuelEdits.length) return base;
  const f = cloneFuel(base);
  for (const e of fuelEdits) applyFuelEdit(f, e);
  return f;
}
