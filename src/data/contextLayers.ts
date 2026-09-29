/**
 * Decoding and loading of the context layers (roads, fire trails, homes, zones, place names).
 *
 * File format `public/demo/<site>/context.json` (version 1, written by scripts/fetch-demo-context.mjs): coordinates are
 * integers in 1e-5° (~1 m) and DELTA-CODED as a flat [x0, y0, dx1, dy1, ...] array (x = longitude, y = latitude).
 * {@link decodeContext} projects them to local metres about the scenario origin.
 */
import { LocalProjection, type LatLon } from '../core/geo';
import type { ContextLayers, ContextSource, FireTrailLine, PlaceKind, PlaceLabel, RoadClass, RoadLine, RoadSurface, ZoneKind, ZonePolygon } from '../core/places';
import { loadAssetJson } from './assets';
import { DEMO_EXTENT_M, DEMO_SITES } from './demoSites';

const Q = 1e5;

/** The bundled JSON (version 1). */
export interface ContextFileV1 {
  version: 1;
  id: string;
  fetched: string;
  bbox: [number, number, number, number];
  sources: ContextSource[];
  roads: { c: RoadClass; s: number; n?: string; p: number[] }[];
  fireTrails: { p: number[] }[];
  zones: { z: string; k: ZoneKind; n: string; r: number[][] }[];
  homes: number[];
  places: { n: string; k: PlaceKind; x: number; y: number }[];
}

/** Decode a delta-coded line to local metres [x0, y0, x1, y1, ...] and its length. */
export function decodeLine(p: readonly number[], proj: LocalProjection): { xy: Float32Array; lengthM: number } {
  const n = p.length >> 1;
  const xy = new Float32Array(n * 2);
  let X = 0;
  let Y = 0;
  let len = 0;
  let px = 0;
  let py = 0;
  for (let i = 0; i < n; i++) {
    X += p[2 * i]!;
    Y += p[2 * i + 1]!;
    const [x, y] = proj.toLocal({ lat: Y / Q, lon: X / Q });
    xy[2 * i] = x;
    xy[2 * i + 1] = y;
    if (i > 0) len += Math.hypot(x - px, y - py);
    px = x;
    py = y;
  }
  return { xy, lengthM: len };
}

/** Project a version-1 file to local metres about `origin`. */
export function decodeContext(file: ContextFileV1, origin: LatLon, from: ContextLayers['origin'] = 'bundled'): ContextLayers {
  if (file.version !== 1) throw new Error(`context.json: unsupported version ${String(file.version)}`);
  const proj = new LocalProjection(origin);
  const roads: RoadLine[] = file.roads.map((r) => {
    const { xy, lengthM } = decodeLine(r.p, proj);
    const line: RoadLine = { cls: r.c, surface: (r.s >= 0 && r.s <= 3 ? r.s : 0) as RoadSurface, xy, lengthM };
    if (r.n) line.name = r.n;
    return line;
  });
  const fireTrails: FireTrailLine[] = file.fireTrails.map((t) => decodeLine(t.p, proj));
  const zones: ZonePolygon[] = file.zones.map((z) => ({ code: z.z, kind: z.k, name: z.n, rings: z.r.map((ring) => decodeLine(ring, proj).xy) }));
  const homes = decodeLine(file.homes, proj).xy;
  const places: PlaceLabel[] = file.places.map((p) => {
    const [x, y] = proj.toLocal({ lat: p.y, lon: p.x });
    return { name: p.n, kind: p.k, x, y };
  });
  return { roads, fireTrails, zones, homes, places, sources: file.sources, origin: from, fetched: file.fetched, projectionOrigin: { ...origin } };
}

/** Bundled demo site whose 9 km square (plus the context margin) contains the whole square around `centre`. */
export function demoSiteCovering(centre: LatLon, extentM: number): string | null {
  for (const s of DEMO_SITES) {
    const proj = new LocalProjection(s.centre);
    const [x, y] = proj.toLocal(centre);
    const half = DEMO_EXTENT_M / 2 + 300 - extentM / 2;
    if (Math.abs(x) <= half && Math.abs(y) <= half) return s.id;
  }
  return null;
}

/** Load the bundled context of a demo site, projected about `origin` (the scenario origin); null if not bundled. */
export async function loadBundledContext(siteId: string, origin: LatLon, signal?: AbortSignal): Promise<ContextLayers | null> {
  const file = await loadAssetJson<ContextFileV1>(`demo/${siteId}/context.json`, signal);
  if (!file || file.version !== 1) return null;
  return decodeContext(file, origin, 'bundled');
}

/** Total length (m) of the roads of each class, for summaries. */
export function roadLengthByClass(c: ContextLayers): Record<RoadClass, number> {
  const out = { motorway: 0, primary: 0, arterial: 0, subarterial: 0, distributor: 0, local: 0, service: 0, track: 0, path: 0 } as Record<RoadClass, number>;
  for (const r of c.roads) out[r.cls] += r.lengthM;
  return out;
}
