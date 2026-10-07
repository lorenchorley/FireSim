/**
 * Live context feeds (spec §11.7, P1) [V doc 08b §8–9]. Context only: nothing here is ever used as an ignition
 * without user confirmation, and nothing auto-ignites.
 *
 * - NSW RFS major incidents (`feeds/majorIncidents.json`, ACAO *, D36): FeatureCollection whose geometry is a Point or
 *   a GeometryCollection[Point, GeometryCollection[Polygon…]]; `pubDate` 'dd/mm/yyyy h:mm:ss AM|PM' in local civil
 *   time (Australia/Sydney); `category` = alert level; `description` "KEY: value <br />…" with STATUS, TYPE, SIZE.
 * - NSW RFS fire danger / fire ban (`feeds/fdrToban.xml`): <District><Name/><Councils/>(';'-separated)
 *   <DangerLevelToday/><FireBanToday/>…; pick the district whose council list contains the site's council (or the
 *   nearest name) → "Official rating today" chip beside the model's AFDRS-parity rating. Parsed without DOMParser
 *   (absent in Web Workers and Node).
 * - DEA hotspots (WFS `public:hotspots_three_days`, GeoJSON): bbox in lon,lat order WITH the EPSG:4326 suffix (else 0
 *   features); properties datetime, power, confidence, satellite, hours_since_hotspot → markers with age.
 */
import type { Incident, LatLon } from '../core/types';
import { haversine, LocalProjection } from '../core/geo';
import { fetchJson, fetchText, isHttpError, serviceUrl, SERVICES } from '../data';
import { SCENARIO_PARAMS } from './params';
import { civilToUtc } from './time';

// ─────────────────────────────────────────────────────────────────────────────
// RFS major incidents
// ─────────────────────────────────────────────────────────────────────────────

/** Parse 'dd/mm/yyyy h:mm:ss AM|PM' (Australia/Sydney civil time) → unix ms (NaN when malformed). */
export function parseRfsPubDate(s: string): number {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?\s*$/i.exec(s ?? '');
  if (!m) return NaN;
  let h = Number(m[4]);
  const ap = m[7]?.toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return civilToUtc(Number(m[3]), Number(m[2]), Number(m[1]), h, Number(m[5]), Number(m[6] ?? 0), SCENARIO_PARAMS.timezone);
}

/** "KEY: value <br />KEY: value" → record of upper-case keys. */
export function parseRfsDescription(desc: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (desc ?? '').split(/<br\s*\/?>/i)) {
    const i = part.indexOf(':');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim().toUpperCase();
    const v = part
      .slice(i + 1)
      .replace(/<[^>]*>/g, '')
      .trim();
    if (k) out[k] = v;
  }
  return out;
}

type Geo = { type: string; coordinates?: unknown; geometries?: Geo[] };

function collect(g: Geo | null | undefined, points: [number, number][], rings: [number, number][][]): void {
  if (!g) return;
  switch (g.type) {
    case 'Point':
      if (Array.isArray(g.coordinates)) points.push([Number((g.coordinates as number[])[0]), Number((g.coordinates as number[])[1])]);
      break;
    case 'MultiPoint':
      for (const c of (g.coordinates as number[][]) ?? []) points.push([Number(c[0]), Number(c[1])]);
      break;
    case 'Polygon':
      for (const r of (g.coordinates as number[][][]) ?? []) rings.push(r.map((c) => [Number(c[0]), Number(c[1])] as [number, number]));
      break;
    case 'MultiPolygon':
      for (const poly of (g.coordinates as number[][][][]) ?? []) for (const r of poly) rings.push(r.map((c) => [Number(c[0]), Number(c[1])] as [number, number]));
      break;
    case 'GeometryCollection':
      for (const s of g.geometries ?? []) collect(s, points, rings);
      break;
  }
}

/** Parse the RFS majorIncidents FeatureCollection into {@link Incident}s (features without a location are skipped). */
export function parseMajorIncidents(json: unknown): Incident[] {
  const feats = (json as { features?: { geometry?: Geo; properties?: Record<string, unknown> }[] } | null)?.features;
  if (!Array.isArray(feats)) return [];
  const out: Incident[] = [];
  for (const f of feats) {
    const p = (f?.properties ?? {}) as Record<string, string | undefined>;
    const points: [number, number][] = [];
    const rings: [number, number][][] = [];
    collect(f?.geometry, points, rings);
    let loc: [number, number] | undefined = points[0];
    if (!loc && rings.length) {
      // Centroid of the first ring's vertices.
      const r = rings[0]!;
      loc = [r.reduce((s, c) => s + c[0], 0) / r.length, r.reduce((s, c) => s + c[1], 0) / r.length];
    }
    if (!loc || !Number.isFinite(loc[0]) || !Number.isFinite(loc[1])) continue;
    const d = parseRfsDescription(p.description ?? '');
    const guid = String(p.guid ?? p.link ?? `${p.title}-${p.pubDate}`);
    const inc: Incident = {
      id: guid.split('/').filter(Boolean).pop() ?? guid,
      title: String(p.title ?? d['LOCATION'] ?? 'Incident'),
      alertLevel: String(p.category ?? d['ALERT LEVEL'] ?? 'Not Applicable'),
      status: d['STATUS'] ?? '',
      updated: parseRfsPubDate(String(p.pubDate ?? '')),
      location: { lat: loc[1], lon: loc[0] },
    };
    const size = /([\d.,]+)\s*ha/i.exec(d['SIZE'] ?? '');
    if (size) inc.sizeHa = Number(size[1]!.replace(/,/g, ''));
    if (rings.length) inc.rings = rings;
    const desc = [d['TYPE'], d['COUNCIL AREA'] ? `Council: ${d['COUNCIL AREA']}` : '', d['RESPONSIBLE AGENCY'] ?? ''].filter(Boolean).join(' · ');
    if (desc) inc.description = desc;
    out.push(inc);
  }
  return out;
}

/** Incidents within `radiusM` of `centre`, nearest first. */
export function incidentsNear(list: Incident[], centre: LatLon, radiusM: number = SCENARIO_PARAMS.contextRadiusM): Incident[] {
  return list
    .map((i) => ({ i, d: haversine(centre, i.location) }))
    .filter((x) => x.d <= radiusM)
    .sort((a, b) => a.d - b.d)
    .map((x) => x.i);
}

/** Incident rings in local metres of a domain (for drawing "burning now" outlines). */
export function incidentRingsLocal(inc: Incident, origin: LatLon): [number, number][][] {
  const p = new LocalProjection(origin);
  return (inc.rings ?? []).map((r) => r.map(([lon, lat]) => p.toLocal({ lat, lon })));
}

// ─────────────────────────────────────────────────────────────────────────────
// RFS fire danger ratings / fire bans
// ─────────────────────────────────────────────────────────────────────────────

export interface FireDangerDistrict {
  name: string;
  regionNumber?: number;
  councils: string[];
  dangerLevelToday: string;
  dangerLevelTomorrow?: string;
  fireBanToday: boolean;
  fireBanTomorrow?: boolean;
}

const decodeXml = (s: string): string =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();

function tag(block: string, name: string): string | undefined {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m ? decodeXml(m[1]!) : undefined;
}

/** Parse fdrToban.xml (regex-based; the document is flat and machine-generated). */
export function parseFdrToban(xml: string): FireDangerDistrict[] {
  const out: FireDangerDistrict[] = [];
  const re = /<District\b[^>]*>([\s\S]*?)<\/District>/gi;
  for (let m = re.exec(xml ?? ''); m; m = re.exec(xml)) {
    const b = m[1]!;
    const name = tag(b, 'Name');
    if (!name) continue;
    const yes = (v: string | undefined): boolean => /^y(es)?$/i.test(v ?? '');
    const d: FireDangerDistrict = {
      name,
      councils: (tag(b, 'Councils') ?? '')
        .split(';')
        .map((c) => c.trim())
        .filter(Boolean),
      dangerLevelToday: tag(b, 'DangerLevelToday') ?? '',
      fireBanToday: yes(tag(b, 'FireBanToday')),
    };
    const rn = Number(tag(b, 'RegionNumber'));
    if (Number.isFinite(rn)) d.regionNumber = rn;
    const tm = tag(b, 'DangerLevelTomorrow');
    if (tm !== undefined) d.dangerLevelTomorrow = tm;
    const bt = tag(b, 'FireBanTomorrow');
    if (bt !== undefined) d.fireBanTomorrow = yes(bt);
    out.push(d);
  }
  return out;
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z]/g, '');

/**
 * The district for a site: the one whose council list contains `council` (case/punctuation-insensitive), else the one
 * whose name best contains `nameHint` (e.g. "Greater Sydney"), else undefined.
 */
export function districtFor(districts: FireDangerDistrict[], council?: string, nameHint?: string): FireDangerDistrict | undefined {
  if (council) {
    const c = norm(council);
    const hit = districts.find((d) => d.councils.some((x) => norm(x) === c)) ?? districts.find((d) => d.councils.some((x) => norm(x).includes(c) || c.includes(norm(x))));
    if (hit) return hit;
  }
  if (nameHint) {
    const h = norm(nameHint);
    return districts.find((d) => norm(d.name) === h) ?? districts.find((d) => norm(d.name).includes(h) || h.includes(norm(d.name)));
  }
  return undefined;
}

/** Councils (and districts) of the demo sites, for the official-rating chip. [K: RFS district council lists] */
export const DEMO_SITE_COUNCILS: Readonly<Record<string, string>> = Object.freeze({
  katoomba: 'Blue Mountains',
  grose: 'Blue Mountains',
  tomah: 'Blue Mountains',
  kanangra: 'Oberon',
  thredbo: 'Snowy Monaro',
  gospers: 'Lithgow',
  budawangs: 'Shoalhaven',
  barrington: 'Mid-Coast',
  warrumbungles: 'Warrumbungle',
});

/** The chip text "Official rating today: {DangerLevelToday}" (plus the fire ban), or null. */
export function officialRatingChip(d: FireDangerDistrict | undefined): string | null {
  if (!d || !d.dangerLevelToday) return null;
  const level = d.dangerLevelToday.charAt(0) + d.dangerLevelToday.slice(1).toLowerCase();
  return `Official rating today: ${level}${d.fireBanToday ? ' · Total Fire Ban' : ''} (${d.name})`;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEA hotspots
// ─────────────────────────────────────────────────────────────────────────────

export interface Hotspot {
  id: string;
  location: LatLon;
  /** Unix ms of the observation. */
  time: number;
  /** Fire radiative power (MW) when given. */
  power?: number;
  /** 0–100 */
  confidence?: number;
  satellite: string;
  /** Hours since the observation at the feed time. */
  hoursSince?: number;
}

export const DEA_WFS = 'https://hotspots.dea.ga.gov.au/geoserver/public/wfs';

/** WFS GetFeature URL for hotspots in a lon/lat bbox (lon,lat order + the EPSG:4326 suffix, doc 08b §9). */
export function hotspotsUrl(bbox: [number, number, number, number], maxFeatures: number = SCENARIO_PARAMS.hotspotsMaxFeatures): string {
  const b = bbox.map((v) => v.toFixed(4)).join(',');
  return `${DEA_WFS}?service=WFS&version=1.1.0&request=GetFeature&typeName=public:hotspots_three_days&outputFormat=application/json&maxFeatures=${maxFeatures}&bbox=${b},EPSG:4326`;
}

export function parseHotspots(json: unknown): Hotspot[] {
  const feats = (json as { features?: { id?: string; geometry?: Geo; properties?: Record<string, unknown> }[] } | null)?.features;
  if (!Array.isArray(feats)) return [];
  const out: Hotspot[] = [];
  for (const f of feats) {
    const p = f.properties ?? {};
    const pts: [number, number][] = [];
    collect(f.geometry, pts, []);
    const lon = pts[0]?.[0] ?? Number(p['longitude']);
    const lat = pts[0]?.[1] ?? Number(p['latitude']);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const time = Date.parse(String(p['datetime'] ?? p['start_dt'] ?? ''));
    const h: Hotspot = { id: String(f.id ?? p['id'] ?? `${lat},${lon},${time}`), location: { lat, lon }, time, satellite: String(p['satellite'] ?? 'unknown') };
    const num = (k: string): number | undefined => (typeof p[k] === 'number' && Number.isFinite(p[k]) ? (p[k] as number) : undefined);
    const pw = num('power');
    if (pw !== undefined) h.power = pw;
    const c = num('confidence');
    if (c !== undefined) h.confidence = c;
    const hs = num('hours_since_hotspot');
    if (hs !== undefined) h.hoursSince = hs;
    out.push(h);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetching (never throws; returns what it could get)
// ─────────────────────────────────────────────────────────────────────────────

/** GET JSON directly (the RFS feeds send ACAO *, D36), falling back to the routed URL (dev proxy / native). */
async function directThenRouted<T>(abs: string, routed: string, kind: 'json' | 'text', signal?: AbortSignal): Promise<T> {
  const get = (u: string, route: boolean): Promise<T> =>
    (kind === 'json' ? fetchJson<T>(u, { route, ...(signal ? { signal } : {}) }) : (fetchText(u, { route, ...(signal ? { signal } : {}) }) as Promise<T>));
  try {
    return await get(abs, false);
  } catch (e) {
    if (signal?.aborted || (isHttpError(e) && e.kind === 'aborted')) throw e;
    if (routed === abs) throw e;
    return get(routed, false);
  }
}

export async function fetchMajorIncidents(signal?: AbortSignal): Promise<Incident[]> {
  const path = '/feeds/majorIncidents.json';
  return parseMajorIncidents(await directThenRouted<unknown>(SERVICES.rfs.base + path, serviceUrl('rfs', path), 'json', signal));
}

export async function fetchFdrToban(signal?: AbortSignal): Promise<FireDangerDistrict[]> {
  const path = '/feeds/fdrToban.xml';
  return parseFdrToban(await directThenRouted<string>(SERVICES.rfs.base + path, serviceUrl('rfs', path), 'text', signal));
}

export async function fetchHotspots(centre: LatLon, radiusM: number = SCENARIO_PARAMS.contextRadiusM, signal?: AbortSignal): Promise<Hotspot[]> {
  const p = new LocalProjection(centre);
  const sw = p.toLatLon(-radiusM, -radiusM);
  const ne = p.toLatLon(radiusM, radiusM);
  return parseHotspots(await fetchJson<unknown>(hotspotsUrl([sw.lon, sw.lat, ne.lon, ne.lat]), signal ? { signal } : {}));
}

export interface LiveContext {
  incidents: Incident[];
  hotspots: Hotspot[];
  district?: FireDangerDistrict;
  officialRating: string | null;
  warnings: string[];
}

/**
 * All live context for a site (P1): incidents and hotspots near the centre, the official rating of its district.
 * Never throws (except on abort); a failed feed adds a warning.
 */
export async function loadLiveContext(o: { centre: LatLon; demoSiteId?: string; council?: string; districtHint?: string; radiusM?: number; signal?: AbortSignal }): Promise<LiveContext> {
  const warnings: string[] = [];
  const radius = o.radiusM ?? SCENARIO_PARAMS.contextRadiusM;
  const guard = async <T>(label: string, f: () => Promise<T>, fb: T): Promise<T> => {
    try {
      return await f();
    } catch (e) {
      if (o.signal?.aborted) throw e;
      warnings.push(`${label} unavailable (${e instanceof Error ? e.message : String(e)}).`);
      return fb;
    }
  };
  const [inc, hot, fdr] = await Promise.all([
    guard('RFS incidents', () => fetchMajorIncidents(o.signal), [] as Incident[]),
    guard('Satellite hotspots', () => fetchHotspots(o.centre, radius, o.signal), [] as Hotspot[]),
    guard('RFS fire danger ratings', () => fetchFdrToban(o.signal), [] as FireDangerDistrict[]),
  ]);
  const council = o.council ?? (o.demoSiteId ? DEMO_SITE_COUNCILS[o.demoSiteId] : undefined);
  const district = districtFor(fdr, council, o.districtHint);
  const out: LiveContext = { incidents: incidentsNear(inc, o.centre, radius), hotspots: hot, officialRating: officialRatingChip(district), warnings };
  if (district) out.district = district;
  return out;
}
