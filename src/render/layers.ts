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
  | 'landing' // ember landing density
  // ── Data layers that can be shown as a heat map on their own (CONTRACT for the layers rework; implemented in
  //    fields.ts / legends.ts / palette.ts, see layerCatalog.ts for titles, units and descriptions) ──
  | 'elevation' // ground height (m)
  | 'landform' // ridge / spur / slope / gully / valley / saddle / cliff classes (categorical)
  | 'canopyHeight' // tree canopy height (m), from the Meta/WRI canopy-height map
  | 'canopyCover' // tree canopy cover (%)
  | 'elevatedHazard' // understorey (shrub) fuel hazard 0–4
  | 'elevatedHeight' // understorey height (m)
  | 'surfaceHazard' // leaf-litter / surface fuel hazard 0–4
  | 'nearSurfaceHazard' // near-surface (grass, low shrubs, bark on ground) fuel hazard 0–4
  | 'barkHazard' // bark hazard 0–4: how many embers the trees can throw (stringybark high, smooth gums low)
  | 'grassCuring' // grass curing (%), grass and grassy fuel types only
  | 'fireHistoryKind' // last recorded fire: wildfire vs prescribed burn vs none (categorical)
  | 'homeDensity' // homes per hectare (from address points)
  | 'roadAccess' // distance to the nearest road or fire trail (m)
  | 'windSpeed'; // near-surface wind speed now (m/s), from the simulation snapshot

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

  // ── layers rework (CONTRACT; each is an independent on/off layer, see layerCatalog.ts) ──
  /** Roads and tracks, styled by class (highway … track, path). */
  roads: boolean;
  /** RFS-classified fire trails, highlighted on top of the roads. */
  fireTrails: boolean;
  /** Home addresses (one small house marker per dwelling address). */
  homes: boolean;
  /** Residential and built-up land-use zones (filled areas). */
  zones: boolean;
  /** Suburb / town names and major road names. */
  placeNames: boolean;
  /** Understorey shrubs drawn among the trees (the ladder fuel), at their real height. */
  understorey: boolean;
  /**
   * How the 3-D canopy is drawn: 'natural' = species-shaped trees and bark; 'simple' = clean uniform shapes (easiest to
   * read); 'coded' = simple shapes coloured by the attribute in {@link canopyCode}.
   */
  canopyStyle: 'natural' | 'simple' | 'coded';
  /** Attribute that colours the trees when canopyStyle is 'coded'. */
  canopyCode: 'height' | 'cover' | 'bark' | 'understorey';
  /** Trees sway with the wind (amplitude follows the wind speed). */
  windSway: boolean;
  /** A heat map hides the aerial photo and the 3-D canopy so its colours stand alone (places layers stay as toggled). */
  soloHeat: boolean;
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
  roads: true,
  fireTrails: true,
  homes: false,
  zones: false,
  placeNames: true,
  understorey: true,
  canopyStyle: 'natural',
  canopyCode: 'height',
  windSway: true,
  soloHeat: true,
};
