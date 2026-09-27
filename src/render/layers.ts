/** Display options for the 3-D scene. The UI owns a LayerState and passes partial updates to SceneView.setLayers. */

export type OverlayKind =
  | 'none'
  | 'arrival' // fire arrival time (isochrone colours)
  | 'ros' // spread rate at arrival
  | 'intensity' // fireline intensity at arrival
  | 'driver' // dominant spread driver (wind / slope / spotting / VLS …)
  | 'moisture' // dead fine fuel (litter) moisture now
  | 'fuelLoad' // total fine fuel load
  | 'fuelType'
  | 'timeSinceFire'
  | 'slope'
  | 'aspect'
  | 'insolation'
  // Mountain-phenomena rasters from SimSnapshot.layers (spec §2.3)
  | 'vls' // vorticity-driven lateral spread potential
  | 'attach' // flame attachment / eruptive potential
  | 'trench' // gully / chimney (trench) score
  | 'dmz' // dead man zone (flank that becomes a head after the forecast wind change)
  | 'landing'; // ember landing density

export interface LayerState {
  overlay: OverlayKind;
  /** Overlay opacity 0–1. */
  overlayOpacity: number;
  /** Draw arrival-time contour lines every N minutes (0 = off). */
  isochroneMinutes: number;
  vegetation: boolean;
  /** Aerial imagery texture on the terrain when available. */
  imagery: boolean;
  flames: boolean;
  smoke: boolean;
  embers: boolean;
  /** Animated wind particles: off, near the surface, or through the plume/boundary layer. */
  wind: 'off' | 'surface' | 'volume';
  /** Vertical cross-section of the atmosphere (temperature anomaly + wind vectors). */
  crossSection: { enabled: boolean; /** azimuth of the section line through `centre` (deg) */ azimuth: number; centre: [number, number] };
  insightMarkers: boolean;
  /** Vertical exaggeration of the terrain (1 = true scale). */
  verticalExaggeration: number;
  /** Show the fire-behaviour legend for the active overlay. */
  legend: boolean;
}

export const DEFAULT_LAYERS: LayerState = {
  overlay: 'none',
  overlayOpacity: 0.7,
  isochroneMinutes: 30,
  vegetation: true,
  imagery: true,
  flames: true,
  smoke: true,
  embers: true,
  wind: 'surface',
  crossSection: { enabled: false, azimuth: 0, centre: [0, 0] },
  insightMarkers: true,
  verticalExaggeration: 1,
  legend: true,
};
