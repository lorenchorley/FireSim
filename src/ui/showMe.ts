/**
 * "Show me" for an insight card: the display layers that make its mechanism visible (doc 09 §11.4; synthesis §10.2
 * mapping table). The engine lists render layer ids in `Insight.showLayers`; without them (older engines, the mock)
 * a per-kind default is used. Pure and unit-tested.
 */
import type { Insight, InsightKind } from '../core/types';
import type { LayerState, OverlayKind } from '../render/layers';

/** Layer id → overlay, in the spec's mapping. The first id in `showLayers` that maps to an overlay wins. */
const OVERLAY_OF: Record<string, OverlayKind> = {
  slope: 'slope',
  spread: 'arrival',
  sun: 'insolation',
  moisture: 'moisture',
  fuel: 'fuelLoad',
  history: 'timeSinceFire',
  intensity: 'intensity',
  embers: 'landing',
  trench: 'trench',
  attach: 'attach',
  vls: 'vls',
  dmz: 'dmz',
  debris: 'driver',
};

/** Per-kind defaults when the engine gives no `showLayers` (overlays the mock and every engine can draw). */
const BY_KIND: Partial<Record<InsightKind, Partial<LayerState>>> = {
  'upslope-run': { overlay: 'slope' },
  'eruptive-slope': { overlay: 'slope' },
  'gully-chimney': { overlay: 'slope' },
  'ridge-crest': { overlay: 'slope' },
  'moist-gully': { overlay: 'moisture' },
  'aspect-dry-fuel': { overlay: 'moisture' },
  spotting: { embers: true },
  'spot-fire': { embers: true },
  'mass-spotting': { embers: true },
  'wind-change': { wind: 'surface' },
  'dead-man-zone': { overlay: 'arrival', wind: 'surface' },
  'plume-dominated': { wind: 'volume' },
  'fire-induced-wind': { wind: 'volume' },
  'recent-burn': { overlay: 'timeSinceFire' },
  'heavy-fuel': { overlay: 'fuelLoad' },
  'crown-fire': { overlay: 'intensity' },
};

/**
 * Layer changes for "Show me" on an insight. `windToDeg` is the direction the wind blows TOWARDS at the card's time
 * (for a cross-section along the plume).
 */
export function showMePatch(insight: Pick<Insight, 'kind' | 'x' | 'y' | 'showLayers'>, windToDeg: number): Partial<LayerState> {
  const ids = insight.showLayers;
  if (!ids || ids.length === 0) return { ...(BY_KIND[insight.kind] ?? {}) };
  const patch: Partial<LayerState> = {};
  for (const id of ids) {
    const overlay = OVERLAY_OF[id];
    if (overlay && patch.overlay === undefined) patch.overlay = overlay;
    switch (id) {
      case 'wind':
        if (patch.wind !== 'volume') patch.wind = 'surface';
        break;
      case 'plume':
        patch.wind = 'volume';
        patch.crossSection = { enabled: true, azimuth: windToDeg, centre: [insight.x, insight.y] };
        break;
      case 'temperature':
        patch.crossSection = { enabled: true, azimuth: patch.crossSection?.azimuth ?? windToDeg, centre: [insight.x, insight.y] };
        break;
      case 'smoke':
        patch.smoke = true;
        break;
      case 'embers':
        patch.embers = true;
        break;
      default:
        break;
    }
  }
  return patch;
}
