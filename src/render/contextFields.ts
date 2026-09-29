/**
 * Rasters derived from the context layers, for the 'homeDensity' and 'roadAccess' heat maps (CONTRACT: implemented by the
 * places-layer builder; fields.ts calls this). Values are per fire-grid cell (row-major, j = 0 south).
 */
import type { GridSpec } from '../core/grid';
import type { ContextLayers } from '../core/places';

export type ContextFieldKind = 'homeDensity' | 'roadAccess';

/**
 * 'homeDensity': homes per hectare around each cell (address points counted in a ~150 m radius, divided by the area);
 * 'roadAccess': distance (m) from the cell centre to the nearest road, track or fire trail.
 * Cached by (context, grid) identity. PLACEHOLDER: returns zeros until implemented.
 */
export function contextFieldValues(_kind: ContextFieldKind, _context: ContextLayers, grid: GridSpec): Float32Array {
  return new Float32Array(grid.nx * grid.ny);
}
