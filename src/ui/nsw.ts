/**
 * "Is this location in NSW?" for the setup screen. FireSim's fuel types, fire-history and vegetation sources and its
 * teaching content are specific to New South Wales, so the UI tells the user when a GPS fix is outside it.
 *
 * The outline is a coarse (~5–20 km) polygon of the NSW border (including the ACT, which it surrounds): the 29° S
 * line and the Dumaresq/McPherson ranges to Point Danger in the north, the coast, the straight Cape Howe – Murray
 * source line and the Murray River in the south, and the 141° E line in the west. Good enough for a hint; not a
 * legal boundary.
 */
import type { LatLon } from '../core/geo';

/** [lon, lat] vertices, clockwise from the north-west corner. */
export const NSW_OUTLINE: readonly [number, number][] = [
  [141.0, -29.0], // Cameron Corner
  [148.95, -28.999],
  [149.6, -28.6],
  [150.35, -28.55], // Goondiwindi (Macintyre River)
  [151.0, -28.8],
  [151.95, -28.95], // Tenterfield area
  [152.5, -28.3],
  [153.2, -28.25],
  [153.55, -28.16], // Point Danger
  [153.64, -28.64], // Cape Byron
  [153.37, -29.4],
  [153.2, -30.0],
  [153.15, -30.35], // Coffs Harbour
  [152.95, -31.45], // Port Macquarie
  [152.55, -32.3],
  [151.8, -32.95], // Newcastle
  [151.35, -33.55],
  [151.3, -33.95], // Sydney
  [150.95, -34.45], // Wollongong
  [150.85, -34.95],
  [150.8, -35.15], // Jervis Bay
  [150.2, -35.75], // Batemans Bay
  [150.05, -36.4],
  [149.95, -37.07], // Eden
  [149.98, -37.51], // Cape Howe
  [148.2, -36.8], // Murray source (straight border)
  [147.7, -36.0],
  [146.9, -36.07], // Albury
  [146.35, -36.0], // Corowa
  [145.55, -35.8], // Tocumwal
  [144.75, -36.1], // Echuca / Moama
  [144.0, -35.6],
  [143.55, -35.33], // Swan Hill
  [142.8, -34.6], // Robinvale
  [142.2, -34.15], // Mildura (NSW is the north bank)
  [141.0, -34.0],
];

/** Ray-casting point-in-polygon on [x, y] vertices. */
export function pointInPolygon(x: number, y: number, poly: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** True when the location is inside the (coarse) NSW/ACT outline. */
export function isInNsw(p: LatLon): boolean {
  return pointInPolygon(p.lon, p.lat, NSW_OUTLINE);
}

/** Valid-looking coordinates (manual entry validation). */
export function isValidLatLon(p: { lat: number; lon: number }): boolean {
  return Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
}

/**
 * Parse free-text coordinates: "-33.715, 150.285", "33.715 S 150.285 E", "33°42.9'S 150°17.1'E".
 * Returns null if it cannot be parsed. Southern/western hemispheres from signs or S/W letters.
 */
export function parseLatLon(input: string): LatLon | null {
  const s = input.trim().toUpperCase().replace(/[,;]/g, ' ');
  // Degrees[°] [minutes['] [seconds["]]] [NSEW]
  // Minutes and seconds need their ′ / ″ marks, so "-33.7 150.2" is read as two plain decimal degrees.
  const re = /(-?\d+(?:\.\d+)?)\s*°?\s*(?:(\d+(?:\.\d+)?)\s*['′]\s*)?(?:(\d+(?:\.\d+)?)\s*["″]\s*)?([NSEW])?/g;
  const vals: { v: number; h: string | undefined }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) && vals.length < 2) {
    const deg = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    const sec = m[3] ? Number(m[3]) : 0;
    const sign = deg < 0 || m[1]!.startsWith('-') ? -1 : 1;
    vals.push({ v: sign * (Math.abs(deg) + min / 60 + sec / 3600), h: m[4] });
  }
  if (vals.length !== 2) return null;
  let [a, b] = vals as [{ v: number; h: string | undefined }, { v: number; h: string | undefined }];
  // Hemisphere letters decide order and sign.
  if (a.h === 'E' || a.h === 'W') [a, b] = [b, a];
  let lat = a.v;
  let lon = b.v;
  if (a.h === 'S') lat = -Math.abs(lat);
  if (a.h === 'N') lat = Math.abs(lat);
  if (b.h === 'W') lon = -Math.abs(lon);
  if (b.h === 'E') lon = Math.abs(lon);
  const p = { lat, lon };
  return isValidLatLon(p) ? p : null;
}
