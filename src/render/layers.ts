/**
 * Display options for the 3-D scene. The UI owns a LayerState and passes partial updates to SceneView.setLayers.
 * Each key is either a layer switch (roads, imagery, flames, wind, ...) or a display setting (overlay, overlayOpacity,
 * canopyStyle, ...); layerCatalog.ts describes every layer and heat map in plain English and lists the settings
 * (LAYER_CATALOG, LAYER_SETTING_KEYS), and its test fails if a key or an OverlayKind is added without an entry.
 */
import { hasAirWind } from '../core/airView';
import type { SliceFieldId, SlicePresetId } from './slice/types';
import type { WindHeight } from './wind/glyphTypes';

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
  // ── Data layers that can be shown as a heat map on their own (layers rework; values in fields.ts, legends in legends.ts,
  //    colours in palette.ts, titles / units / plain-English descriptions in layerCatalog.ts) ──
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
  /** Wind arrows and flow lines drawn on the map at {@link windHeight}, zoom-adaptive (render/wind, 0.5.0). Opt-in. */
  windGlyphs: boolean;
  /** The height the wind glyphs show: `'felt'` (the wind the fire feels, 60 m cells, 0.7.0), `'fire'` (the model's 10 m wind over open ground) or metres above the ground. */
  windHeight: WindHeight;
  /**
   * Vertical cross-section of the atmosphere: the 3-D curtain, and the data of the Air slice side view (render/slice/types.ts;
   * plan §8.2). The line is the first of these that applies: `preset` (a live line, from the wind, the fire, the slope or the
   * phone), `a` and `b` both set (a hand-placed line, local metres), else the chord through `centre` along `azimuth` (the
   * original). Whoever writes `centre` or `azimuth` must also write `a: undefined, b: undefined, preset: null`, and whoever
   * writes `a` and `b` writes `preset: null`, or a stale higher rule hides the change. Not persisted (layersPrefs.ts).
   */
  crossSection: {
    enabled: boolean;
    /** azimuth of the section line through `centre` (deg) */
    azimuth: number;
    centre: [number, number];
    a?: [number, number];
    b?: [number, number];
    preset?: SlicePresetId | null;
    /**
     * What the section is coloured by. Absent keeps the original curtain's colouring: temperature where the air has it,
     * else wind speed. The Air slices tool writes 'speed' when it first places a line.
     */
    field?: SliceFieldId;
  };
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
  windGlyphs: false,
  windHeight: 'felt',
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

/**
 * The Wind height the Wind speed map follows (0.7.0, E1b): the height chosen for the arrows and flow lines while that layer is on, else `'fire'`
 * (the 10 m map, as before). One rule for the view, the legend and the Layers panel.
 */
export function windMapHeight(l: Pick<LayerState, 'windGlyphs' | 'windHeight'>): WindHeight {
  return l.windGlyphs ? l.windHeight : 'fire';
}

/**
 * The Wind height that is really drawn (0.7.0): `'felt'` needs the snapshot's `fireWind`; a picture without one (a replay recorded before it, an engine
 * that does not publish it) shows the 10 m wind, `'fire'`, and every caption and legend says that. Any other height is itself.
 */
export function shownWindHeight(h: WindHeight, haveFelt: boolean): WindHeight {
  return h === 'felt' && !haveFelt ? 'fire' : h;
}

/**
 * Whether the Wind speed map at the height really drawn has no data for this picture (0.7.0, raster verifier F1): a numeric Wind height reads the picture's 3-D
 * wind, and a picture without one (a scrubbed frame whose volume the history thinned away) has nothing at that height. The map is then EMPTY and the legend says so;
 * the 10 m wind under the title "Wind speed at 300 m" would be the wrong picture. The 10 m map and What the fire feels fall back to the surface wind instead, and
 * say that (`shownWindHeight`).
 */
export function windMapNoData(h: WindHeight, atm: Parameters<typeof hasAirWind>[0]): boolean {
  return typeof h === 'number' && !hasAirWind(atm);
}
