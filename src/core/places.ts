/**
 * "Places" context layers that help a user situate themselves on the map: roads and tracks, RFS-classified fire
 * trails, home addresses, residential/built-up land-use zones and place names. All coordinates are LOCAL metres
 * (x east, y north) from the scenario origin, like every other grid in the app (see core/geo.ts LocalProjection).
 * Data: NSW Spatial Services and NSW Planning (CC BY 4.0); see src/data/contextLayers.ts and
 * scripts/fetch-demo-context.mjs.
 */
import type { LatLon } from './geo';

/** Road hierarchy, from the NSW road-segment "function hierarchy" domain. */
export type RoadClass = 'motorway' | 'primary' | 'arterial' | 'subarterial' | 'distributor' | 'local' | 'service' | 'track' | 'path';

/** 0 unknown, 1 sealed, 2 unsealed, 3 unsealed 4WD only. */
export type RoadSurface = 0 | 1 | 2 | 3;

export interface RoadLine {
  cls: RoadClass;
  surface: RoadSurface;
  /** e.g. "Megalong Road" (absent for unnamed tracks). */
  name?: string;
  /** Polyline vertices [x0, y0, x1, y1, ...] in local metres. */
  xy: Float32Array;
  lengthM: number;
}

/** An RFS-classified fire trail (a vehicle access track maintained for firefighting). */
export interface FireTrailLine {
  xy: Float32Array;
  lengthM: number;
}

/** What a land-use zone means for who lives there (grouped from the NSW zone codes). */
export type ZoneKind = 'residential' | 'village' | 'envLiving' | 'ruralSmall' | 'commercial' | 'industrial' | 'tourist';

export interface ZonePolygon {
  /** NSW zone code, e.g. 'R2'. */
  code: string;
  kind: ZoneKind;
  /** e.g. 'Low Density Residential'. */
  name: string;
  /** Rings [x0, y0, x1, y1, ...] in local metres; the first ring is the outer boundary, the others are holes. */
  rings: Float32Array[];
}

export type PlaceKind = 'region' | 'city' | 'town' | 'village' | 'locality' | 'suburb';

export interface PlaceLabel {
  name: string;
  kind: PlaceKind;
  x: number;
  y: number;
}

/** Provenance of one context layer, shown in Settings → About and the model card. */
export interface ContextSource {
  id: 'roads' | 'fireTrails' | 'homes' | 'zones' | 'places';
  title: string;
  provider: string;
  layer: string;
  url: string;
  licence: string;
  attribution: string;
  /** ISO date the data were fetched. */
  fetched: string;
}

export interface ContextLayers {
  roads: RoadLine[];
  fireTrails: FireTrailLine[];
  zones: ZonePolygon[];
  /** Home address points [x0, y0, x1, y1, ...] in local metres (one per dwelling address, units share a point). */
  homes: Float32Array;
  places: PlaceLabel[];
  sources: ContextSource[];
  /** Where these data came from in this run. */
  origin: 'bundled' | 'live' | 'cache' | 'area-pack';
  fetched: string;
  /** Projection origin of the local coordinates. */
  projectionOrigin: LatLon;
}

export const EMPTY_CONTEXT = (projectionOrigin: LatLon): ContextLayers => ({
  roads: [],
  fireTrails: [],
  zones: [],
  homes: new Float32Array(0),
  places: [],
  sources: [],
  origin: 'bundled',
  fetched: '',
  projectionOrigin,
});
