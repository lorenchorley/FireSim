/**
 * "Where you are" at a tapped point (pure model, no DOM): the nearest road with its name, class and surface, the nearest
 * RFS fire trail (named after the track that runs along it, when the road data name one), the nearest named place, the
 * land-use zone under the point, how many homes are within 500 m and 1 km and where the nearest one is, and the ground
 * (height, slope and the way it faces) in words. Everything is measured from the scenario's own data: the places context
 * (ScenarioData.context: bundled for the demo sites, an area pack or a live query elsewhere, so it works offline) and the
 * terrain grid. Coordinates are local metres (x east, y north) like every grid in the app.
 */
import type { ContextLayers, PlaceKind, RoadClass, RoadSurface, ZoneKind } from '../../../core/places';
import type { Terrain } from '../../../core/types';
import { sampleBilinear } from '../../../core/grid';
import { formatDistance, formatNumber } from '../../format';

/** Radii of the home counts (m); the row labels are worded from them. */
export const HOME_RADII = [500, 1000] as const;
/** Closer than this (m) to a road or trail counts as being on it. */
export const ON_LINE_M = 15;
/** A named road within this distance (m) of the nearest point of a fire trail names the trail. */
export const TRAIL_NAME_M = 20;

export interface NearestPoint {
  distanceM: number;
  /** Compass bearing from the tapped point to the nearest point (deg clockwise from north). */
  bearingDeg: number;
  /** 8-point compass abbreviation of the bearing ("NE"). */
  dir: string;
  x: number;
  y: number;
}

export interface RoadInfo extends NearestPoint {
  name?: string;
  cls: RoadClass;
  classWords: string;
  surface: RoadSurface;
  /** "sealed", "unsealed", "unsealed, 4WD only"; absent when unknown. */
  surfaceWords?: string;
}

export interface TrailInfo extends NearestPoint {
  /** Name of the track that runs along the trail (from the road data), when there is one. */
  name?: string;
}

export interface LocalityInfo {
  name: string;
  kind: PlaceKind;
  distanceM: number;
  dir: string;
}

export interface ZoneInfo {
  code: string;
  kind: ZoneKind;
  name: string;
}

export interface HomesInfo {
  /** Homes within HOME_RADII[0] and HOME_RADII[1]. */
  within: [number, number];
  nearest: { distanceM: number; dir: string } | null;
}

export interface GroundInfo {
  elevation: number;
  slopeDeg: number;
  /** NaN on flat ground. */
  aspectDeg: number;
  words: string;
}

export interface PlaceInfo {
  /** Roads, trails, homes, zones and names are known for this place. */
  hasContext: boolean;
  road: RoadInfo | null;
  fireTrail: TrailInfo | null;
  locality: LocalityInfo | null;
  zone: ZoneInfo | null;
  homes: HomesInfo | null;
  ground: GroundInfo | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Words
// ─────────────────────────────────────────────────────────────────────────────

const COMPASS8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
const COMPASS8_WORDS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'] as const;

const wrap = (deg: number): number => ((deg % 360) + 360) % 360;
export const compass8 = (deg: number): string => COMPASS8[Math.round(wrap(deg) / 45) % 8]!;
export const compass8Words = (deg: number): string => COMPASS8_WORDS[Math.round(wrap(deg) / 45) % 8]!;

export const ROAD_CLASS_WORDS: Readonly<Record<RoadClass, string>> = {
  motorway: 'motorway',
  primary: 'highway',
  arterial: 'main road',
  subarterial: 'main road',
  distributor: 'connecting road',
  local: 'local street',
  service: 'service road or lane',
  track: 'vehicle track',
  path: 'walking track',
};

export const SURFACE_WORDS: Readonly<Record<RoadSurface, string | undefined>> = { 0: undefined, 1: 'sealed', 2: 'unsealed', 3: 'unsealed, 4WD only' };

export const PLACE_KIND_WORDS: Readonly<Record<PlaceKind, string>> = { region: 'region', city: 'city', town: 'town', village: 'village', locality: 'locality', suburb: 'suburb' };

/** Plain words for the kinds of land-use zone (the zone's own name, e.g. "Low Density Residential", comes first). */
export const ZONE_KIND_WORDS: Readonly<Record<ZoneKind, string>> = {
  residential: 'houses',
  village: 'village',
  envLiving: 'large bush blocks',
  ruralSmall: 'small rural lots',
  commercial: 'shops and businesses',
  industrial: 'industry',
  tourist: 'tourist facilities',
};

// ─────────────────────────────────────────────────────────────────────────────
// Geometry
// ─────────────────────────────────────────────────────────────────────────────

/** Nearest point of a polyline [x0, y0, x1, y1, ...] to (x, y): squared distance and the point (written into `out`). */
function nearestOnLine(xy: Float32Array, x: number, y: number, out: { d2: number; x: number; y: number }): void {
  const n = xy.length >> 1;
  if (n === 1) {
    const d2 = (xy[0]! - x) ** 2 + (xy[1]! - y) ** 2;
    if (d2 < out.d2) {
      out.d2 = d2;
      out.x = xy[0]!;
      out.y = xy[1]!;
    }
    return;
  }
  for (let i = 0; i + 1 < n; i++) {
    const ax = xy[2 * i]!;
    const ay = xy[2 * i + 1]!;
    const bx = xy[2 * i + 2]!;
    const by = xy[2 * i + 3]!;
    const vx = bx - ax;
    const vy = by - ay;
    const len2 = vx * vx + vy * vy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / len2)) : 0;
    const px = ax + vx * t;
    const py = ay + vy * t;
    const d2 = (px - x) ** 2 + (py - y) ** 2;
    if (d2 < out.d2) {
      out.d2 = d2;
      out.x = px;
      out.y = py;
    }
  }
}

function toNearest(x: number, y: number, px: number, py: number, d2: number): NearestPoint {
  const bearing = wrap((Math.atan2(px - x, py - y) * 180) / Math.PI);
  return { distanceM: Math.sqrt(d2), bearingDeg: bearing, dir: compass8(bearing), x: px, y: py };
}

/** Even-odd point-in-polygon over all rings (the first is the boundary, the others holes). */
export function pointInRings(rings: readonly Float32Array[], x: number, y: number): boolean {
  let inside = false;
  for (const r of rings) {
    const n = r.length >> 1;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = r[2 * i]!;
      const yi = r[2 * i + 1]!;
      const xj = r[2 * j]!;
      const yj = r[2 * j + 1]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

// ─────────────────────────────────────────────────────────────────────────────
// The model
// ─────────────────────────────────────────────────────────────────────────────

export function nearestRoad(ctx: Pick<ContextLayers, 'roads'>, x: number, y: number): RoadInfo | null {
  let best = -1;
  const acc = { d2: Infinity, x: 0, y: 0 };
  let bx = 0;
  let by = 0;
  for (let i = 0; i < ctx.roads.length; i++) {
    const before = acc.d2;
    nearestOnLine(ctx.roads[i]!.xy, x, y, acc);
    if (acc.d2 < before) {
      best = i;
      bx = acc.x;
      by = acc.y;
    }
  }
  if (best < 0) return null;
  const r = ctx.roads[best]!;
  const out: RoadInfo = { ...toNearest(x, y, bx, by, acc.d2), cls: r.cls, classWords: ROAD_CLASS_WORDS[r.cls] ?? r.cls, surface: r.surface };
  if (r.name) out.name = r.name;
  const sw = SURFACE_WORDS[r.surface];
  if (sw) out.surfaceWords = sw;
  return out;
}

export function nearestFireTrail(ctx: Pick<ContextLayers, 'fireTrails' | 'roads'>, x: number, y: number): TrailInfo | null {
  const acc = { d2: Infinity, x: 0, y: 0 };
  for (const t of ctx.fireTrails) nearestOnLine(t.xy, x, y, acc);
  if (!Number.isFinite(acc.d2)) return null;
  const out: TrailInfo = toNearest(x, y, acc.x, acc.y, acc.d2);
  // RFS fire-trail lines carry no names; the vehicle track that runs along them usually does. The closest named road within
  // TRAIL_NAME_M of the trail's nearest point names it, a track counting as twice as close as a street (a trail that
  // starts at a street is named after its track).
  let bestScore = Infinity;
  const p = { d2: Infinity, x: 0, y: 0 };
  for (const r of ctx.roads) {
    if (!r.name) continue;
    p.d2 = Infinity;
    nearestOnLine(r.xy, acc.x, acc.y, p);
    if (p.d2 > TRAIL_NAME_M * TRAIL_NAME_M) continue;
    const score = r.cls === 'track' ? p.d2 / 4 : p.d2;
    if (score < bestScore) {
      bestScore = score;
      out.name = r.name;
    }
  }
  return out;
}

export function nearestLocality(ctx: Pick<ContextLayers, 'places'>, x: number, y: number): LocalityInfo | null {
  let best: LocalityInfo | null = null;
  for (const p of ctx.places) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (!best || d < best.distanceM) best = { name: p.name, kind: p.kind, distanceM: d, dir: compass8((Math.atan2(p.x - x, p.y - y) * 180) / Math.PI) };
  }
  return best;
}

export function zoneAt(ctx: Pick<ContextLayers, 'zones'>, x: number, y: number): ZoneInfo | null {
  for (const z of ctx.zones) if (pointInRings(z.rings, x, y)) return { code: z.code, kind: z.kind, name: z.name };
  return null;
}

export function homesNear(ctx: Pick<ContextLayers, 'homes'>, x: number, y: number): HomesInfo {
  const h = ctx.homes;
  const r0 = HOME_RADII[0] ** 2;
  const r1 = HOME_RADII[1] ** 2;
  let a = 0;
  let b = 0;
  let best = Infinity;
  let bx = 0;
  let by = 0;
  for (let i = 0; i + 1 < h.length; i += 2) {
    const dx = h[i]! - x;
    const dy = h[i + 1]! - y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= r1) {
      b++;
      if (d2 <= r0) a++;
    }
    if (d2 < best) {
      best = d2;
      bx = h[i]!;
      by = h[i + 1]!;
    }
  }
  return { within: [a, b], nearest: Number.isFinite(best) ? { distanceM: Math.sqrt(best), dir: compass8((Math.atan2(bx - x, by - y) * 180) / Math.PI) } : null };
}

/** Ground height, slope and the way it faces at a point of the terrain grid (null outside it). */
export function groundAt(t: Pick<Terrain, 'grid' | 'elevation' | 'slopeDeg' | 'aspectDeg'>, x: number, y: number): GroundInfo | null {
  const g = t.grid;
  const i = Math.round((x - g.x0) / g.cellSize);
  const j = Math.round((y - g.y0) / g.cellSize);
  if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) return null;
  const k = j * g.nx + i;
  const elevation = sampleBilinear(g, t.elevation, x, y);
  const slope = t.slopeDeg[k] ?? 0;
  const aspect = t.aspectDeg[k] ?? Number.NaN;
  const slopeWords = slope < 2 || !Number.isFinite(aspect) ? 'flat ground' : `a ${formatNumber(Math.round(slope))}° slope facing ${compass8Words(aspect)}`;
  return { elevation, slopeDeg: slope, aspectDeg: aspect, words: `${formatNumber(Math.round(elevation))} m above sea level, on ${slopeWords}` };
}

/** Everything "Where you are" shows for a tapped point. */
export function placeInfo(x: number, y: number, input: { context?: ContextLayers | null; terrain?: Pick<Terrain, 'grid' | 'elevation' | 'slopeDeg' | 'aspectDeg'> | null }): PlaceInfo {
  const c = input.context ?? null;
  const ground = input.terrain ? groundAt(input.terrain, x, y) : null;
  if (!c) return { hasContext: false, road: null, fireTrail: null, locality: null, zone: null, homes: null, ground };
  return {
    hasContext: true,
    road: nearestRoad(c, x, y),
    fireTrail: nearestFireTrail(c, x, y),
    locality: nearestLocality(c, x, y),
    zone: zoneAt(c, x, y),
    homes: homesNear(c, x, y),
    ground,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rows (for the .kv list of the "Why here?" panel)
// ─────────────────────────────────────────────────────────────────────────────

export interface PlaceRow {
  key: string;
  value: string;
  /** Stable id for tests. */
  id: 'road' | 'trail' | 'place' | 'zone' | 'homes' | 'nearestHome' | 'ground' | 'none';
}

const where = (p: { distanceM: number; dir: string }): string => (p.distanceM < ON_LINE_M ? 'right here' : `${formatDistance(p.distanceM)} ${p.dir}`);

/** The rows, in reading order. With no context: one "not available for this place" row (and the ground, which the terrain always gives). */
export function placeRows(info: PlaceInfo): PlaceRow[] {
  const rows: PlaceRow[] = [];
  if (!info.hasContext) {
    rows.push({ id: 'none', key: 'Roads, trails and homes', value: 'Not available for this place' });
  } else {
    const r = info.road;
    if (r) {
      const kind = r.surfaceWords ? `${r.classWords}, ${r.surfaceWords}` : r.classWords;
      rows.push({ id: 'road', key: 'Nearest road', value: `${r.name ? `${r.name} (${kind})` : `Unnamed ${kind}`} · ${where(r)}` });
    } else rows.push({ id: 'road', key: 'Nearest road', value: 'None in the map area' });
    const t = info.fireTrail;
    rows.push(t ? { id: 'trail', key: 'Nearest fire trail', value: `${where(t)}${t.name ? ` — ${t.name}` : ''}` } : { id: 'trail', key: 'Nearest fire trail', value: 'None in the map area' });
    const l = info.locality;
    if (l) rows.push({ id: 'place', key: 'Nearest named place', value: `${l.name} (${PLACE_KIND_WORDS[l.kind] ?? l.kind}) · ${formatDistance(l.distanceM)} ${l.dir}` });
    const z = info.zone;
    rows.push({ id: 'zone', key: 'Land use here', value: z ? `${z.name} (zone ${z.code}: ${ZONE_KIND_WORDS[z.kind] ?? z.kind})` : 'Outside the residential and built-up zones' });
    const h = info.homes;
    if (h) {
      rows.push({ id: 'homes', key: 'Homes nearby', value: `${formatNumber(h.within[0])} within ${formatDistance(HOME_RADII[0])} · ${formatNumber(h.within[1])} within ${formatDistance(HOME_RADII[1])}` });
      rows.push({ id: 'nearestHome', key: 'Nearest home', value: h.nearest ? where(h.nearest) : 'None in the map area' });
    }
  }
  if (info.ground) rows.push({ id: 'ground', key: 'Ground', value: info.ground.words });
  return rows;
}
