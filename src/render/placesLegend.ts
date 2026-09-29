/**
 * Legend entries for the places layers (roads, fire trails, homes, zones, names), so the layers panel and the map legend
 * can explain what the colours on the map mean in plain English. Colours come from the same style table the shaders use
 * (placesGeometry.STYLES / ZONE_PAINT), so the legend can never drift from the map.
 */
import type { ContextLayers, ZoneKind } from '../core/places';
import { FIRE_TRAIL_STYLE, ZONE_KINDS, ZONE_PAINT, roadStyleIndex, STYLES } from './placesGeometry';

export type PlacesLayerId = 'roads' | 'fireTrails' | 'homes' | 'zones' | 'placeNames';

/** How to draw the swatch: a solid or dashed or dotted line, a translucent area, a house, or the text sample. */
export type PlacesSwatch = 'line' | 'dashed' | 'dotted' | 'area' | 'house' | 'text';

export interface PlacesLegendEntry {
  /** Plain-English label, e.g. "Fire trail (RFS classified)". */
  label: string;
  /** CSS colour of the swatch (the fill of a line / the area colour). */
  colour: string;
  /** Casing / halo colour of a line swatch (a white halo for fire trails). */
  outline?: string;
  swatch: PlacesSwatch;
  /** Area swatches: opacity on the map (0–1). */
  opacity?: number;
}

export interface PlacesLegendGroup {
  layer: PlacesLayerId;
  /** Short layer title. */
  title: string;
  entries: PlacesLegendEntry[];
}

const ZONE_LABEL: Record<ZoneKind, string> = {
  residential: 'Residential (houses)',
  village: 'Village',
  envLiving: 'Environmental living (large bush blocks)',
  ruralSmall: 'Small rural lots',
  commercial: 'Shops and businesses',
  industrial: 'Industrial',
  tourist: 'Tourist',
};

const css = (rgb: [number, number, number]): string => `rgb(${Math.round(rgb[0] * 255)}, ${Math.round(rgb[1] * 255)}, ${Math.round(rgb[2] * 255)})`;

/**
 * Legend groups for the layers that are on. With `context`, only the kinds that occur in this scenario are listed
 * (e.g. no "Industrial" where there is none), so the legend stays short.
 */
export function placesLegend(on: Partial<Record<PlacesLayerId, boolean>>, context?: ContextLayers | null): PlacesLegendGroup[] {
  const out: PlacesLegendGroup[] = [];
  const st = (i: number) => STYLES[i]!;
  if (on.roads) {
    const has = (pred: (c: ContextLayers['roads'][number]) => boolean): boolean => !context || context.roads.some(pred);
    const entries: PlacesLegendEntry[] = [];
    if (has((r) => ['motorway', 'primary', 'arterial', 'subarterial', 'distributor'].includes(r.cls))) {
      entries.push({ label: 'Main road', colour: st(roadStyleIndex('subarterial')).fill, outline: st(roadStyleIndex('subarterial')).casing, swatch: 'line' });
    }
    if (has((r) => r.cls === 'local' || r.cls === 'service')) {
      entries.push({ label: 'Street or local road', colour: st(roadStyleIndex('local')).fill, outline: st(roadStyleIndex('local')).casing, swatch: 'line' });
    }
    if (has((r) => r.cls === 'track' || ((r.cls === 'local' || r.cls === 'service') && r.surface >= 2))) {
      entries.push({ label: 'Unsealed road or vehicle track (dashed)', colour: st(roadStyleIndex('track')).fill, outline: st(roadStyleIndex('track')).casing, swatch: 'dashed' });
    }
    if (has((r) => r.cls === 'path')) {
      entries.push({ label: 'Walking track (dotted)', colour: st(roadStyleIndex('path')).fill, outline: st(roadStyleIndex('path')).casing, swatch: 'dotted' });
    }
    out.push({ layer: 'roads', title: 'Roads', entries });
  }
  if (on.fireTrails && (!context || context.fireTrails.length > 0)) {
    const s = st(FIRE_TRAIL_STYLE);
    out.push({ layer: 'fireTrails', title: 'Fire trails', entries: [{ label: 'Fire trail (RFS classified)', colour: s.fill, outline: s.casing, swatch: 'dashed' }] });
  }
  if (on.homes && (!context || context.homes.length > 0)) {
    out.push({ layer: 'homes', title: 'Homes', entries: [{ label: 'Home (one marker per address)', colour: '#b9532a', outline: '#f1e3c4', swatch: 'house' }] });
  }
  if (on.zones) {
    const present = new Set(context?.zones.map((z) => z.kind));
    const entries = ZONE_KINDS.filter((k) => !context || present.has(k)).map((k): PlacesLegendEntry => ({ label: ZONE_LABEL[k], colour: css(ZONE_PAINT[k].rgb), outline: ZONE_PAINT[k].edge, swatch: 'area', opacity: ZONE_PAINT[k].alpha }));
    if (entries.length > 0) out.push({ layer: 'zones', title: 'Land use', entries });
  }
  if (on.placeNames && (!context || context.places.length > 0 || context.roads.some((r) => r.name))) {
    out.push({ layer: 'placeNames', title: 'Names', entries: [{ label: 'Suburb, town and main road names', colour: '#ffffff', outline: '#08101a', swatch: 'text' }] });
  }
  return out;
}
