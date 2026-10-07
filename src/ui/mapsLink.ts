/**
 * "Where is this?" from whatever the user pastes (pure, DOM-free, never throws): plain coordinates in the usual styles, a
 * Google Maps link in any of its forms, the text Google Maps' Share button makes (a place name, then the link), a geo: link,
 * an OpenStreetMap link and the wrapper links Google puts around a Maps address.
 *
 * What the real links look like (checked against live maps.app.goo.gl links on 2026-10-07):
 *   - A shared place is ONE redirect to  https://www.google.com/maps/place/<Name>/@<view lat>,<view lon>,<zoom>z/data=...!3d<lat>!4d<lon>...
 *     The `@` pair is where the map was centred when the link was made, NOT the place (4 km apart in one real link), so the
 *     `!3d…!4d…` pin always wins.
 *   - A dropped pin is  /maps/search/<lat>,+<lon>  (the `+` is a space, and the longitude can follow it with its own minus).
 *   - Some place links (a business reached by its place id) carry NO coordinates at all; the page does not either. They are
 *     refused with a plain message instead of being guessed.
 *   - A short link (maps.app.goo.gl/<id>, goo.gl/maps/<id>) holds nothing: the caller has to ask Google where it leads
 *     (src/data/mapsShortLink.ts). This module only recognises it.
 *
 * Coordinates are validated (finite, latitude -90..90, longitude -180..180, not 0, 0). A place outside NSW is still
 * accepted: the Setup screen says "Outside NSW" itself.
 */
import type { LatLon } from '../core/geo';

// ───────────── result types ─────────────

/** Where the position came from. */
export type LocationSource = 'coordinates' | 'google-maps-link' | 'geo-link' | 'openstreetmap-link';

/** A position was found. `note` is a plain-English remark the screen shows under the result. */
export interface LocationFound {
  ok: true;
  position: LatLon;
  /** Suggested scenario name (a place name from the share text or the link). */
  name?: string;
  source: LocationSource;
  note?: string;
}

/** A Google short link: it holds no coordinates, so the caller must ask Google where it leads (only on the phone). */
export interface LocationNeedsNetwork {
  ok: false;
  reason: 'short-link-needs-network';
  message: string;
  /** The short link, cleaned (no angle brackets, no trailing punctuation) and always https: a pasted http:// one is asked for over https. */
  url: string;
  name?: string;
}

export type FailReason = 'empty' | 'not-recognised' | 'comma-decimals' | 'out-of-range' | 'zero' | 'route' | 'knowledge-panel' | 'no-coordinates' | 'not-a-map-link';

export interface LocationFailed {
  ok: false;
  reason: FailReason;
  /** Plain English for the person who pasted it. */
  message: string;
  name?: string;
}

export type ParsedLocation = LocationFound | LocationNeedsNetwork | LocationFailed;

/** The plain-English messages (one place, so the tests and the screen agree). */
export const LOCATION_MESSAGES = {
  empty: 'Paste a Google Maps link, or type coordinates such as -33.715, 150.285.',
  notRecognised: 'Not recognised yet. Paste a Google Maps link, or type coordinates such as -33.715, 150.285.',
  commaDecimals: 'Use a dot for decimals, like -33.5447, 150.4097.',
  outOfRange: 'Latitude must be between -90 and 90, and longitude between -180 and 180. Check the numbers.',
  zero: 'Latitude 0, longitude 0 is a spot in the ocean off Africa. Check the numbers.',
  route: 'This link is a route. Open the place and share that.',
  knowledgePanel: 'This is a Google search link, not a Maps link. Open the place in Google Maps and share that.',
  noCoordinates: 'This link names a place but does not say where it is. Open it in Google Maps, touch and hold the spot to drop a pin, then share that.',
  notMapLink: 'That link is not from Google Maps. Open the place in Google Maps and share that link, or paste coordinates.',
  shortLink: 'This is a short Google Maps link. The app has to ask Google where it leads.',
  swapped: 'These looked like longitude first, so they were swapped.',
  routeEnd: 'This link is a route. The point it names was used.',
  viewCentre: 'The link has no exact pin, so the middle of the map view was used.',
} as const;

// ───────────── small helpers ─────────────

const fail = (reason: FailReason, message: string, name?: string): LocationFailed => (name ? { ok: false, reason, message, name } : { ok: false, reason, message });

/** Decode percent-escapes without ever throwing (a bad escape is left as typed). */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s.replace(/%([0-9a-f]{2})/gi, (m, h: string) => {
      const c = parseInt(h, 16);
      return c < 0x80 ? String.fromCharCode(c) : m;
    });
  }
}

/** Zero-width and direction marks that copy-and-paste carries along are removed; every kind of space becomes a plain one. */
function stripInvisible(s: string): string {
  return s
    .replace(/[\u{200B}-\u{200F}\u{202A}-\u{202E}\u{2060}-\u{2064}\u{FEFF}\u{00AD}]/gu, '')
    .replace(/[\u{00A0}\u{1680}\u{2000}-\u{200A}\u{202F}\u{205F}\u{3000}]/gu, ' ');
}

/** Typographic minus, degree, minute and second marks → plain ASCII ones. Full-width digits and punctuation too. */
function plainMarks(s: string): string {
  const t = s
    // hyphens, minus sign, en and em dashes → "-"
    .replace(/[\u{2010}-\u{2015}\u{2212}\u{FE63}\u{FF0D}]/gu, '-')
    // º (ordinal), ˚ (ring), ᵒ, ⁰ → °
    .replace(/[\u{00BA}\u{02DA}\u{1D52}\u{2070}]/gu, '\u{00B0}')
    // two apostrophes, ″ ” “ „ → "
    .replace(/(?:['\u{2018}\u{2019}\u{2032}\u{02B9}\u{00B4}\u{02BC}]){2}|[\u{2033}\u{201C}\u{201D}\u{201E}\u{02BA}\u{301E}\u{FF02}]/gu, '"')
    // ’ ‘ ′ ʹ ´ ʼ ˈ → '
    .replace(/[\u{2018}\u{2019}\u{2032}\u{02B9}\u{00B4}\u{02BC}\u{02C8}]/gu, "'");
  // full-width digits and punctuation (and a few look-alikes) become the plain ones
  return t.normalize('NFKC');
}

const isFiniteNum = (n: number): boolean => Number.isFinite(n);

/** Validate a lat/lon pair: finite, in range, not 0, 0. */
function checkPair(lat: number, lon: number): 'ok' | 'range' | 'zero' {
  if (!isFiniteNum(lat) || !isFiniteNum(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return 'range';
  if (lat === 0 && lon === 0) return 'zero';
  return 'ok';
}

function found(lat: number, lon: number, source: LocationSource, name?: string, note?: string): LocationFound | LocationFailed {
  const c = checkPair(lat, lon);
  if (c === 'range') return fail('out-of-range', LOCATION_MESSAGES.outOfRange, name);
  if (c === 'zero') return fail('zero', LOCATION_MESSAGES.zero, name);
  const out: LocationFound = { ok: true, position: { lat, lon }, source };
  if (name) out.name = name;
  if (note) out.note = note;
  return out;
}

/** "Mount Tomah Botanic Garden" for a place name: single spaces, no control characters, no coordinates, at most 60 characters. */
export function cleanPlaceName(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  // eslint-disable-next-line no-control-regex
  let n = stripInvisible(raw).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  n = n.replace(/^[\s\-–—:|·•,;]+|[\s\-–—:|·•,;]+$/g, '').trim();
  if (n.length < 2) return undefined;
  // A "name" that is really a coordinate pair (a dropped pin's address bar text) or only numbers is no name.
  if (/^[-+]?\d/.test(n) && parseCoordinates(n)) return undefined;
  if (!/\p{L}/u.test(n)) return undefined;
  if (/^https?:|^www\./i.test(n)) return undefined;
  if (n.length > 60) {
    const cut = n.slice(0, 60);
    const comma = cut.lastIndexOf(',');
    n = comma >= 20 ? cut.slice(0, comma) : `${cut.slice(0, 59).trimEnd()}…`;
  }
  return n;
}

/** "Name, 12 Some Street, Town" → "Name" (Google puts the address after the name in the same segment). */
function firstPart(name: string): string {
  const i = name.indexOf(',');
  return i >= 3 ? name.slice(0, i).trim() : name;
}

// ───────────── plain coordinates ─────────────

type Tok =
  | { t: 'num'; v: number; neg: boolean; mark: '' | '°' | "'" | '"'; plus: boolean }
  | { t: 'hemi'; h: 'N' | 'S' | 'E' | 'W' }
  | { t: 'label'; axis: 'lat' | 'lon' };

const NUM_RE = /^([-+])?\s*(\d+(?:\.\d+)?|\.\d+)\s*(°|'|")?/;
const WORD_RE = /^[a-z]+/i;
const SEP_RE = /^[\s,;/|:=()[\]{}<>"'_*#]+/;
const FILLER = new Set(['coordinates', 'coordinate', 'coords', 'coord', 'gps', 'location', 'position', 'pos', 'latlon', 'latlong', 'latlng', 'at', 'is', 'are', 'about', 'approx', 'deg', 'degrees', 'd', 'my', 'the', 'here', 'me', 'dd', 'dms']);

/** Tokenise coordinate text; null when anything else is in it (words, stray symbols). */
function tokenise(s: string): Tok[] | null {
  const toks: Tok[] = [];
  let i = 0;
  let guard = 0;
  while (i < s.length) {
    if (++guard > 400) return null;
    const rest = s.slice(i);
    const num = NUM_RE.exec(rest);
    if (num && num[0].length > 0) {
      const mark = (num[3] ?? '') as '' | '°' | "'" | '"';
      toks.push({ t: 'num', v: Number(num[2]), neg: num[1] === '-', mark, plus: num[1] === '+' });
      i += num[0].length;
      continue;
    }
    const sep = SEP_RE.exec(rest);
    if (sep) {
      i += sep[0].length;
      continue;
    }
    if (rest[0] === '°' || rest[0] === '.') {
      // a stray degree sign (after a letter) or full stop
      i += 1;
      continue;
    }
    const w = WORD_RE.exec(rest);
    if (w) {
      const word = w[0].toLowerCase();
      i += w[0].length;
      if (word.length === 1 && 'nsew'.includes(word)) toks.push({ t: 'hemi', h: word.toUpperCase() as 'N' | 'S' | 'E' | 'W' });
      else if (word === 'north') toks.push({ t: 'hemi', h: 'N' });
      else if (word === 'south') toks.push({ t: 'hemi', h: 'S' });
      else if (word === 'east') toks.push({ t: 'hemi', h: 'E' });
      else if (word === 'west') toks.push({ t: 'hemi', h: 'W' });
      else if (word === 'lat' || word === 'latitude') toks.push({ t: 'label', axis: 'lat' });
      else if (word === 'lon' || word === 'lng' || word === 'long' || word === 'longitude') toks.push({ t: 'label', axis: 'lon' });
      else if (FILLER.has(word)) continue;
      else return null;
      continue;
    }
    return null;
  }
  return toks;
}

interface Group {
  nums: Extract<Tok, { t: 'num' }>[];
  hemi?: 'N' | 'S' | 'E' | 'W';
  label?: 'lat' | 'lon';
}

/** Degrees (+ minutes + seconds) of one group, signed; null when the parts do not make sense. */
function groupValue(g: Group): number | null {
  const n = g.nums;
  if (n.length === 0 || n.length > 3) return null;
  const marked = n.some((x) => x.mark !== '');
  let deg: number;
  let min = 0;
  let sec = 0;
  if (marked) {
    // The marks say which part each number is: ° ' ". A number without a mark is the degrees when it comes first.
    let d: number | undefined;
    let m: number | undefined;
    let s: number | undefined;
    for (const [idx, x] of n.entries()) {
      if (x.mark === '°' || (x.mark === '' && idx === 0)) {
        if (d !== undefined) return null;
        d = x.v;
      } else if (x.mark === "'") {
        if (m !== undefined) return null;
        m = x.v;
      } else if (x.mark === '"') {
        if (s !== undefined) return null;
        s = x.v;
      } else return null;
    }
    if (d === undefined) return null;
    deg = d;
    min = m ?? 0;
    sec = s ?? 0;
    if (s !== undefined && m === undefined) return null;
  } else {
    deg = n[0]!.v;
    if (n[1]) min = n[1].v;
    if (n[2]) sec = n[2].v;
  }
  if (min >= 60 || sec >= 60) return null;
  if ((n.length > 1 || min > 0 || sec > 0) && !Number.isInteger(deg)) return null; // 33.5° 30' is not a thing
  if (sec > 0 && !Number.isInteger(min)) return null;
  const mag = deg + min / 60 + sec / 3600;
  return n[0]!.neg ? -mag : mag;
}

/** Pairs of coordinate numbers found in plain text (see parseCoordinates for the accepted styles). */
interface Coords {
  lat: number;
  lon: number;
  swapped: boolean;
}

function coordsFromTokens(toks: Tok[]): Coords | 'range' | 'zero' | null {
  if (toks.length === 0) return null;
  const hasHemi = toks.some((t) => t.t === 'hemi');
  const hasDeg = toks.some((t) => t.t === 'num' && t.mark === '°');
  const groups: Group[] = [];
  let cur: Group = { nums: [] };
  const push = (): void => {
    if (cur.nums.length || cur.hemi || cur.label) groups.push(cur);
    cur = { nums: [] };
  };
  if (hasHemi) {
    // Letters delimit the groups: "S 33 32.7 E 150 24.6" (a letter opens a group) or "33°32'44"S 150°24'35"E" (a letter closes one).
    const prefix = toks[0]!.t === 'hemi';
    for (const t of toks) {
      if (t.t === 'num') cur.nums.push(t);
      else if (t.t === 'hemi') {
        if (prefix) {
          if (cur.nums.length || cur.hemi) push();
          cur.hemi = t.h;
        } else {
          if (cur.hemi) return null;
          cur.hemi = t.h;
          push();
        }
      } else return null; // letters and labels do not mix
    }
    if (cur.nums.length) push();
    else if (cur.hemi) push();
  } else {
    // No letters. Degree signs (if any) start the groups, otherwise each number is a group; labels (if any) name the axes:
    // "lat -33.5 lon 150.4" (a label comes before its number) or "lat/lon -33.5, 150.4" (the labels first, the numbers in the same order).
    const labelAt: { axis: 'lat' | 'lon'; at: number }[] = [];
    for (const t of toks) {
      if (t.t === 'label') labelAt.push({ axis: t.axis, at: groups.length + (cur.nums.length ? 1 : 0) });
      else if (t.t === 'num') {
        if (hasDeg) {
          if (t.mark === '°' && cur.nums.length) push();
          cur.nums.push(t);
        } else {
          cur.nums.push(t);
          push();
        }
      } else return null;
    }
    push();
    if (labelAt.length === 1 && groups.length >= 1) groups[Math.min(labelAt[0]!.at, groups.length - 1)]!.label = labelAt[0]!.axis;
    else if (labelAt.length > 1) {
      if (labelAt.length !== groups.length) return null;
      labelAt.forEach((l, k) => (groups[k]!.label = l.axis));
    }
  }
  if (groups.length !== 2) return null;
  const [a, b] = groups as [Group, Group];
  const va = groupValue(a);
  const vb = groupValue(b);
  if (va === null || vb === null) return null;
  const axisOf = (g: Group): 'lat' | 'lon' | null => (g.hemi === 'N' || g.hemi === 'S' ? 'lat' : g.hemi === 'E' || g.hemi === 'W' ? 'lon' : (g.label ?? null));
  let axA = axisOf(a);
  let axB = axisOf(b);
  if (axA && axB && axA === axB) return null;
  if (axA && !axB) axB = axA === 'lat' ? 'lon' : 'lat';
  if (axB && !axA) axA = axB === 'lat' ? 'lon' : 'lat';
  // A minus sign next to N or E (or a plus next to S / W is fine) contradicts the letter: not coordinates.
  const signed = (g: Group, v: number): number | null => {
    if (g.hemi === 'N' || g.hemi === 'E') return g.nums[0]!.neg ? null : Math.abs(v);
    if (g.hemi === 'S' || g.hemi === 'W') return -Math.abs(v);
    return v;
  };
  const sa = signed(a, va);
  const sb = signed(b, vb);
  if (sa === null || sb === null) return null;
  let lat: number;
  let lon: number;
  let swapped = false;
  if (axA === 'lon') {
    lon = sa;
    lat = sb;
  } else if (axA === 'lat') {
    lat = sa;
    lon = sb;
  } else {
    lat = sa;
    lon = sb;
    // Longitude first: the first number cannot be a latitude but the second can.
    if (Math.abs(lat) > 90 && Math.abs(lon) <= 90) {
      [lat, lon] = [lon, lat];
      swapped = true;
    }
  }
  const c = checkPair(lat, lon);
  if (c !== 'ok') return c;
  return { lat, lon, swapped };
}

/**
 * Coordinates from plain text: "-33.5447, 150.4097", "-33.5447 150.4097", "-33.5447,150.4097", "(−33.5447, 150.4097)",
 * "33.5447° S, 150.4097° E", "S 33.5447 E 150.4097", "lat -33.5447 lon 150.4097", "33°32'44.2"S 150°24'35.1"E" (with any of the
 * ' ′ ’ and " ″ ” marks), "S33 32.737 E150 24.585". A longitude-first pair is swapped (and says so). Null if the text is
 * anything else; a comma used as a decimal point is NOT supported.
 */
export function parseCoordinates(text: string): (LocationFound & { source: 'coordinates' }) | LocationFailed | null {
  if (typeof text !== 'string' || text.length === 0 || text.length > 300) return null;
  const s = plainMarks(stripInvisible(text)).trim();
  if (!/\d/.test(s)) return null;
  const toks = tokenise(s);
  if (!toks) return null;
  const c = coordsFromTokens(toks);
  if (c === null) {
    // "-33,5447 150,4097": commas as decimal points
    if (!/\./.test(s) && /\d,\d/.test(s) && toks.filter((t) => t.t === 'num').length >= 3) return fail('comma-decimals', LOCATION_MESSAGES.commaDecimals);
    return null;
  }
  if (c === 'range') return fail('out-of-range', LOCATION_MESSAGES.outOfRange);
  if (c === 'zero') return fail('zero', LOCATION_MESSAGES.zero);
  const out: LocationFound & { source: 'coordinates' } = { ok: true, position: { lat: c.lat, lon: c.lon }, source: 'coordinates' };
  if (c.swapped) out.note = LOCATION_MESSAGES.swapped;
  return out;
}

// ───────────── URLs ─────────────

/** A link without the punctuation that follows it in a sentence; a ")" stays when the link has its own "(". Linear in the length. */
function trimUrl(raw: string): string {
  let open = 0;
  let close = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c === 40) open++;
    else if (c === 41) close++;
  }
  let end = raw.length;
  while (end > 0) {
    const last = raw.charAt(end - 1);
    if (last === ')') {
      if (close <= open) break;
      close--;
    } else if (!/[.,;:!?\]}>'"”’»…]/.test(last)) break;
    end--;
  }
  return raw.slice(0, end);
}

/** Text → the links in it, in order of appearance (Google Maps ones, and others so that "not a map link" can be said). */
function findUrls(text: string): { url: string; start: number; end: number }[] {
  const out: { url: string; start: number; end: number }[] = [];
  const add = (raw: string, start: number): void => {
    const u = trimUrl(raw);
    if (u.length > 7) out.push({ url: u, start, end: start + raw.length });
  };
  // No look-behind in these patterns: Safari before 16.4 (iOS 16.0-16.3) cannot even load a script that has one.
  const withScheme = /(https?:\/\/|geo:)[^\s<>"“”«»]+/gi;
  let m: RegExpExecArray | null;
  while ((m = withScheme.exec(text))) {
    if (m[1]!.toLowerCase() === 'geo:' && /[a-z0-9]/i.test(text.charAt(m.index - 1))) continue; // "…geo:" inside a word
    add(m[0], m.index);
  }
  // links pasted without https:// (a share app that drops it, or typed by hand)
  const bare = /(^|[^\w./@:-])((?:(?:www\.|maps\.|m\.)?google\.[a-z]{2,3}(?:\.[a-z]{2})?\/(?:maps|url)|maps\.google\.[a-z]{2,3}(?:\.[a-z]{2})?\/|(?:www\.)?goo\.gl\/maps\/|maps\.app\.goo\.gl\/|g\.co\/kgs\/|(?:www\.)?openstreetmap\.org\/)[^\s<>"“”«»]*)/gi;
  while ((m = bare.exec(text))) {
    const at = m.index + m[1]!.length;
    if (out.some((o) => at >= o.start && at < o.end)) continue;
    add(m[2]!, at);
  }
  out.sort((x, y) => x.start - y.start);
  return out;
}

const GOOGLE_HOST = /^(?:[a-z0-9-]+\.)*google\.(?:com?\.[a-z]{2}|[a-z]{2,3})$/;

/** A Google host (google.com, maps.google.com.au, www.google.co.uk, consent.google.de …); "google.com.evil.example" is not. */
export function isGoogleHost(host: string): boolean {
  return GOOGLE_HOST.test(host.toLowerCase());
}

/** Hosts a Google short link may hand over to (the short-link resolver follows nothing else). */
export function isGoogleFamilyHost(host: string): boolean {
  const h = host.toLowerCase();
  return isGoogleHost(h) || h === 'goo.gl' || h === 'maps.app.goo.gl';
}

/** True for a Google short link that holds no coordinates (maps.app.goo.gl/<id>, goo.gl/maps/<id>). */
export function isMapsShortLink(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const host = u.hostname.toLowerCase();
  if (host === 'maps.app.goo.gl') return u.pathname.replace(/\//g, '').length > 0;
  if (host === 'goo.gl' || host === 'www.goo.gl') return /^\/maps\/[^/]+/i.test(u.pathname);
  return false;
}

const NUM = '-?\\d{1,3}(?:\\.\\d+)?';
const PIN_RE = new RegExp(`!3d(${NUM})!4d(${NUM})`);
const EMBED_RE = new RegExp(`!2d(${NUM})!3d(${NUM})`);
const AT_RE = new RegExp(`@(${NUM}),(${NUM})(?=[,/?#&]|$)`);

/** "-33.5, 150.4", "loc:-33.5,150.4", "-33.5,150.4(Label)", "Place Name@-33.5,150.4" → { lat, lon, name? } or null. */
function fromQueryValue(v: string): { lat: number; lon: number; name?: string } | LocationFailed | null {
  let q = plainMarks(stripInvisible(v)).trim();
  if (!q) return null;
  q = q.replace(/^loc:\s*/i, '');
  let name: string | undefined;
  const label = /^(.*?)\(([^()]{1,80})\)\s*$/.exec(q);
  if (label && parseCoordinates(label[1]!)) {
    name = cleanPlaceName(label[2]);
    q = label[1]!;
  }
  const at = /^(.*)@(.+)$/.exec(q);
  if (at && parseCoordinates(at[2]!)) {
    name = cleanPlaceName(firstPart(at[1]!)) ?? name;
    q = at[2]!;
  }
  const c = parseCoordinates(q);
  if (!c) return null;
  if (!c.ok) return c;
  return name ? { lat: c.position.lat, lon: c.position.lon, name } : { lat: c.position.lat, lon: c.position.lon };
}

const CURRENT_LOCATION = /^(?:my|your|current)\s*location$|^here$/i;

/** The place name in /maps/place/<Name>/ or /maps/search/<Name>/. */
function pathName(segs: string[], at: number): string | undefined {
  const raw = segs[at];
  if (!raw || raw.startsWith('@') || raw.startsWith('data=')) return undefined;
  return cleanPlaceName(firstPart(raw));
}

/** One Google Maps address (a URL object). `depth` stops a wrapper that wraps itself. */
function parseGoogleUrl(u: URL, depth: number): LocationFound | LocationFailed | LocationNeedsNetwork {
  const host = u.hostname.toLowerCase();
  const path = u.pathname;
  const lowPath = path.toLowerCase();
  const sp = u.searchParams;

  // consent.google.com/m?continue=<the real address>, google.com/url?q=<the real address>
  const isConsent = host.startsWith('consent.') || host.startsWith('consent-');
  if (isConsent || lowPath === '/url' || lowPath.startsWith('/url/')) {
    if (depth > 3) return fail('not-recognised', LOCATION_MESSAGES.notRecognised);
    for (const key of ['continue', 'url', 'q', 'u', 'dest']) {
      const raw = sp.get(key);
      if (!raw) continue;
      let target = raw.trim();
      for (let k = 0; k < 2 && !/^https?:\/\//i.test(target); k++) target = safeDecode(target);
      if (!/^https?:\/\//i.test(target)) continue;
      try {
        const inner = new URL(target);
        return classifyUrl(inner, depth + 1);
      } catch {
        /* try the next key */
      }
    }
    return fail('not-a-map-link', LOCATION_MESSAGES.notMapLink);
  }

  const onMapsHost = host.startsWith('maps.') || host === 'maps.google.com';
  if (!onMapsHost && !lowPath.startsWith('/maps') && lowPath !== '/m') return fail('not-a-map-link', LOCATION_MESSAGES.notMapLink);

  const segs = path.split('/').map((x) => safeDecode(x.replace(/\+/g, ' ')));
  // [ '', 'maps', 'place', 'Name', '@..', 'data=..' ]
  const mi = segs.findIndex((s) => s.toLowerCase() === 'maps');
  const kind = (segs[mi + 1] ?? '').toLowerCase();
  const decodedAll = safeDecode(path + u.search + u.hash);

  // ── a route: one point is fine, a real route is refused ──
  if (kind === 'dir' || sp.has('daddr') || sp.has('destination') || sp.get('map_action') === 'dir' || sp.get('dir_action') === 'navigate') {
    return parseRoute(u, segs, mi, kind);
  }

  // ── 1. the pin: !3d<lat>!4d<lon> ──
  const pin = PIN_RE.exec(decodedAll);
  const name = kind === 'place' || kind === 'search' ? pathName(segs, mi + 2) : undefined;
  if (pin) return found(Number(pin[1]), Number(pin[2]), 'google-maps-link', name);

  // ── 2. an embed address: !2d<lon>!3d<lat> ──
  const emb = EMBED_RE.exec(decodedAll);
  if (emb && (kind === 'embed' || sp.has('pb'))) return found(Number(emb[2]), Number(emb[1]), 'google-maps-link', name);

  // ── 3. the place or search words in the path are themselves coordinates: /maps/search/5.8,+-55.1 or /maps/place/33°32'44"S+150°24'35"E ──
  if ((kind === 'place' || kind === 'search') && segs[mi + 2]) {
    const c = parseCoordinates(segs[mi + 2]!);
    if (c) {
      if (!c.ok) return c;
      return found(c.position.lat, c.position.lon, 'google-maps-link');
    }
  }

  // ── 4. the query: q=, query=, then ll= and the other map centres ──
  let qName: string | undefined;
  for (const key of ['q', 'query']) {
    const v = sp.get(key);
    if (!v) continue;
    const r = fromQueryValue(v);
    if (r && 'ok' in r) return r;
    if (r) return found(r.lat, r.lon, 'google-maps-link', cleanPlaceName(r.name) ?? name);
    qName ??= cleanPlaceName(firstPart(v));
  }
  for (const key of ['ll', 'center', 'sll', 'cbll', 'viewpoint']) {
    const v = sp.get(key);
    if (!v) continue;
    const c = parseCoordinates(v);
    if (c) {
      if (!c.ok) return c;
      return found(c.position.lat, c.position.lon, 'google-maps-link', name ?? qName, key === 'll' || key === 'center' || key === 'sll' ? (qName || name ? LOCATION_MESSAGES.viewCentre : undefined) : undefined);
    }
  }

  // ── 5. the map view: @<lat>,<lon>,<zoom>z ──
  const at = AT_RE.exec(decodedAll);
  if (at) return found(Number(at[1]), Number(at[2]), 'google-maps-link', name ?? qName, name ?? qName ? LOCATION_MESSAGES.viewCentre : undefined);

  return fail('no-coordinates', LOCATION_MESSAGES.noCoordinates, name ?? qName);
}

/** A directions link: use the point only when it is the one clear answer. */
function parseRoute(u: URL, segs: string[], mi: number, kind: string): LocationFound | LocationFailed {
  const sp = u.searchParams;
  const refuse = fail('route', LOCATION_MESSAGES.route);
  const points: string[] = [];
  if (kind === 'dir') {
    // /maps/dir/<from>/<to>/<…more>/@view/data=…  ("dir//<to>" has an empty "from": the phone's own position)
    const rest = segs.slice(mi + 2);
    for (const s of rest) {
      if (s.startsWith('@') || s.startsWith('data=')) break;
      points.push(s.trim());
    }
    while (points.length && points[points.length - 1] === '') points.pop();
  }
  const dest = sp.get('destination') ?? sp.get('daddr');
  const origin = sp.get('origin') ?? sp.get('saddr');
  if (dest) {
    points.length = 0;
    if (origin) points.push(origin);
    points.push(dest);
  }
  const named = points.filter((p) => p !== '' && !CURRENT_LOCATION.test(p));
  if (named.length !== 1) return refuse;
  const c = parseCoordinates(named[0]!);
  if (c) return c.ok ? found(c.position.lat, c.position.lon, 'google-maps-link', undefined, LOCATION_MESSAGES.routeEnd) : c;
  // One named place ("dir//Mount+Tomah…"): its waypoint is in the data part as !2m2!1d<lon>!2d<lat>; exactly one is the clear answer.
  const wp = [...safeDecode(u.pathname).matchAll(new RegExp(`!2m2!1d(${NUM})!2d(${NUM})`, 'g'))];
  if (wp.length === 1) return found(Number(wp[0]![2]), Number(wp[0]![1]), 'google-maps-link', cleanPlaceName(firstPart(named[0]!)), LOCATION_MESSAGES.routeEnd);
  return refuse;
}

function parseOsmUrl(u: URL): LocationFound | LocationFailed {
  const sp = u.searchParams;
  const mlat = sp.get('mlat');
  const mlon = sp.get('mlon');
  if (mlat !== null && mlon !== null && mlat !== '' && mlon !== '') return found(Number(mlat), Number(mlon), 'openstreetmap-link');
  const hashSearch = new URLSearchParams(u.hash.replace(/^#/, ''));
  const hm = new RegExp(`^(\\d{1,2}(?:\\.\\d+)?)/(${NUM})/(${NUM})$`).exec(hashSearch.get('map') ?? '');
  if (hm) return found(Number(hm[2]), Number(hm[3]), 'openstreetmap-link');
  const lat = sp.get('lat');
  const lon = sp.get('lon');
  if (lat !== null && lon !== null && lat !== '' && lon !== '') return found(Number(lat), Number(lon), 'openstreetmap-link');
  return fail('no-coordinates', LOCATION_MESSAGES.noCoordinates);
}

function parseGeoUri(raw: string): LocationFound | LocationFailed {
  const body = raw.replace(/^geo:/i, '');
  const qi = body.indexOf('?');
  const head = (qi >= 0 ? body.slice(0, qi) : body).split(';')[0]!;
  const query = qi >= 0 ? new URLSearchParams(body.slice(qi + 1)) : new URLSearchParams();
  const parts = head.split(',');
  const lat = parts[0] !== undefined && parts[0].trim() !== '' ? Number(parts[0]) : NaN;
  const lon = parts[1] !== undefined && parts[1].trim() !== '' ? Number(parts[1]) : NaN;
  const q = query.get('q') ?? '';
  const fromQ = q ? fromQueryValue(q) : null;
  const lbl = /\(([^()]{1,80})\)\s*$/.exec(q);
  const qLabel = cleanPlaceName(lbl?.[1]) ?? (fromQ && 'lat' in fromQ ? cleanPlaceName(fromQ.name) : undefined);
  if (Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0)) return found(lat, lon, 'geo-link', qLabel);
  if (fromQ) {
    if ('ok' in fromQ) return fromQ;
    return found(fromQ.lat, fromQ.lon, 'geo-link', qLabel);
  }
  // geo:0,0?q=Mount+Tomah is how an app asks "find this place": it holds a name, not coordinates
  if (!q && Number.isFinite(lat) && Number.isFinite(lon)) return fail('zero', LOCATION_MESSAGES.zero);
  return fail('no-coordinates', LOCATION_MESSAGES.noCoordinates, cleanPlaceName(firstPart(q)));
}

/** Classify and parse a parsed URL. */
function classifyUrl(u: URL, depth: number): LocationFound | LocationFailed | LocationNeedsNetwork {
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  const proto = u.protocol.toLowerCase();
  if (proto === 'geo:') return parseGeoUri(u.href);
  if (proto !== 'https:' && proto !== 'http:') return fail('not-a-map-link', LOCATION_MESSAGES.notMapLink);
  if (host === 'g.co' && /^\/kgs(\/|$)/i.test(u.pathname)) return fail('knowledge-panel', LOCATION_MESSAGES.knowledgePanel);
  if (host === 'maps.app.goo.gl' && depth < 3) {
    // maps.app.goo.gl/?link=<the real address> carries the address in the link itself
    const inner = u.searchParams.get('link');
    if (inner && /^https?:\/\//i.test(inner)) {
      try {
        return classifyUrl(new URL(inner), depth + 1);
      } catch {
        /* fall through */
      }
    }
  }
  if (isMapsShortLink(u.href)) return { ok: false, reason: 'short-link-needs-network', message: LOCATION_MESSAGES.shortLink, url: `https://${host}${u.pathname}${u.search}` };
  if (host === 'openstreetmap.org' || host === 'www.openstreetmap.org' || host === 'osm.org' || host === 'www.osm.org') return parseOsmUrl(u);
  if (isGoogleHost(host)) return parseGoogleUrl(u, depth);
  return fail('not-a-map-link', LOCATION_MESSAGES.notMapLink);
}

// ───────────── the text around a link ─────────────

/** The place name from the text before the link in a Google Maps share ("Mount Tomah Botanic Garden\nhttps://…"). */
function nameBefore(before: string): string | undefined {
  const lines = before
    .split(/[\r\n]+/)
    .map((l) => stripInvisible(l).trim())
    .filter((l) => l && !/^https?:/i.test(l));
  for (const line of lines) {
    // coordinates written above a link are not a place name
    if (parseCoordinates(line)) continue;
    // share boilerplate is not a place name
    if (/google maps|maps\.google|^(?:see|check out|take a look|look at|here is|here's|i'?m at|meet|location|map)\b/i.test(line)) continue;
    const n = cleanPlaceName(firstPart(line.replace(/[:\-–—|·]+\s*$/, '')));
    if (n) return n;
  }
  return undefined;
}

/**
 * Whatever the user pasted → a position, or a plain-English reason why not. Never throws. The first Google-Maps-like link in
 * the text is used (angle brackets, trailing punctuation, zero-width characters and line breaks around it are ignored); a link
 * with no link around it is read as coordinates. A short link comes back as `short-link-needs-network`.
 */
export function parseLocationText(text: string): ParsedLocation {
  try {
    return parseInner(typeof text === 'string' ? text : '');
  } catch {
    return fail('not-recognised', LOCATION_MESSAGES.notRecognised);
  }
}

function parseInner(input: string): ParsedLocation {
  const text = stripInvisible(input).slice(0, 4000).trim();
  if (!text) return fail('empty', LOCATION_MESSAGES.empty);
  const urls = findUrls(text);
  if (urls.length === 0) {
    const c = parseCoordinates(text);
    return c ?? fail('not-recognised', LOCATION_MESSAGES.notRecognised);
  }
  let firstFailure: LocationFailed | LocationNeedsNetwork | null = null;
  for (const [idx, { url, start, end }] of urls.entries()) {
    const before = text.slice(idx === 0 ? 0 : urls[idx - 1]!.end, start);
    const hint = nameBefore(before);
    let u: URL;
    try {
      u = new URL(/^(?:https?:|geo:)/i.test(url) ? url : `https://${url}`);
    } catch {
      continue;
    }
    const r = classifyUrl(u, 0);
    if (r.ok) {
      const name = hint ?? r.name;
      // a name written above the link is the person's own wording; the link's /place/<name>/ is Google's
      return name ? { ...r, name } : r;
    }
    if (r.reason === 'short-link-needs-network') {
      // Coordinates written beside a short link beat a network round trip.
      const rest = `${text.slice(0, start)} ${text.slice(end)}`;
      const c = parseCoordinates(rest);
      if (c && c.ok) return hint ? { ...c, name: hint } : c;
    }
    const withName = hint && !r.name ? { ...r, name: hint } : r;
    if (!firstFailure || (firstFailure.reason === 'not-a-map-link' && r.reason !== 'not-a-map-link')) firstFailure = withName;
  }
  return firstFailure ?? fail('not-recognised', LOCATION_MESSAGES.notRecognised);
}

// ───────────── the page behind a link (short-link fallback) ─────────────

/** Google's own default map (the middle of the USA at zoom 4): what its static-map picture shows when no place is known. */
const isGenericCentre = (lat: number, lon: number): boolean => Math.abs(lat - 37.0625) < 1e-3 && Math.abs(lon + 95.677068) < 1e-2;

/** At most this much of a page is read (a Google Maps page is 200 to 900 kB of script). */
export const MAX_PAGE_CHARS = 512 * 1024;

/**
 * Last resort for a Google page that was reached through a short link but whose address holds no coordinates: look in the
 * page for the address it names itself (canonical link, og:url), a `!3d<lat>!4d<lon>` pin, an `@lat,lon,<zoom>z` view or the
 * static map picture of its og:image (`center=` or `markers=` with a zoom of 8 or more). Google's own default picture (the
 * middle of the USA at zoom 4) is NOT a place and is refused. In practice Google's pages come as a bare app shell with none of
 * these (checked on 2026-10-07), so this usually finds nothing and the caller says so.
 */
export function scanMapsPage(html: string): LocationFound | null {
  try {
    const page = html.slice(0, MAX_PAGE_CHARS);
    const decoded = page.replace(/&amp;/g, '&');
    // Every scan below is linear in the page: a page is somebody else's text (Google's, or whatever a redirect ended on), so no
    // pattern may backtrack over it. Tags and addresses are cut out with bounded runs, and the number of candidates is capped.
    // 1. the page's own address
    let tags = 0;
    for (const m of decoded.matchAll(/<(?:link|meta)\b[^<>]{0,2000}>/gi)) {
      if (++tags > 400) break;
      const tag = m[0];
      const value = /\brel=["']canonical["']/i.test(tag) ? /\bhref=["']([^"']+)["']/i.exec(tag)?.[1] : /\bproperty=["']og:url["']/i.test(tag) ? /\bcontent=["']([^"']+)["']/i.exec(tag)?.[1] : undefined;
      if (!value) continue;
      const r = parseLocationText(value);
      if (r.ok) {
        const { note: _note, ...rest } = r;
        return rest;
      }
    }
    // 2. a pin
    let pins = 0;
    for (const m of decoded.matchAll(new RegExp(PIN_RE.source, 'g'))) {
      if (++pins > 200) break;
      const lat = Number(m[1]);
      const lon = Number(m[2]);
      if (checkPair(lat, lon) === 'ok' && !isGenericCentre(lat, lon)) return { ok: true, position: { lat, lon }, source: 'google-maps-link' };
    }
    // 3. the static map picture: a marker, or a centre at a close zoom
    const lower = decoded.toLowerCase();
    const delimiter = (c: number): boolean => c <= 32 || c === 34 || c === 39 || c === 60 || c === 62;
    let at = 0;
    for (let tries = 0; tries < 100; tries++) {
      const i = lower.indexOf('staticmap', at);
      if (i < 0) break;
      at = i + 9;
      let a = i;
      for (const lo = Math.max(0, i - 400); a > lo && !delimiter(decoded.charCodeAt(a - 1)); a--);
      let b = at;
      for (const hi = Math.min(decoded.length, at + 2000); b < hi && !delimiter(decoded.charCodeAt(b)); b++);
      const address = decoded.slice(a, b);
      if (!/^https?:\/\//i.test(address)) continue;
      let q: URLSearchParams;
      try {
        q = new URL(address).searchParams;
      } catch {
        continue;
      }
      const zoom = Number(q.get('zoom') ?? '0');
      const mk = q.get('markers');
      const mp = mk ? parseCoordinates((mk.split('|').pop() ?? '').replace(/^.*:/, '')) : null;
      if (mp && mp.ok && !isGenericCentre(mp.position.lat, mp.position.lon)) return { ok: true, position: mp.position, source: 'google-maps-link' };
      const cp = q.get('center') ? parseCoordinates(q.get('center')!) : null;
      if (cp && cp.ok && zoom >= 8 && !isGenericCentre(cp.position.lat, cp.position.lon)) return { ok: true, position: cp.position, source: 'google-maps-link', note: LOCATION_MESSAGES.viewCentre };
    }
    // 4. a view in a Maps path: /maps/place/<name>/@lat,lon,<zoom>z (the "/maps/" is at most 400 characters before the "@", with no break between)
    let views = 0;
    for (const m of decoded.matchAll(/@(-?\d{1,3}\.\d{3,}),(-?\d{1,3}\.\d{3,}),\d+(?:\.\d+)?[zma]/g)) {
      if (++views > 50) break;
      const before = decoded.slice(Math.max(0, m.index - 400), m.index);
      const k = before.lastIndexOf('/maps/');
      if (k < 0 || /[\s"'<>]/.test(before.slice(k))) continue;
      const lat = Number(m[1]);
      const lon = Number(m[2]);
      if (checkPair(lat, lon) === 'ok' && !isGenericCentre(lat, lon)) return { ok: true, position: { lat, lon }, source: 'google-maps-link', note: LOCATION_MESSAGES.viewCentre };
    }
    return null;
  } catch {
    return null;
  }
}

// ───────────── what the Setup box stores ─────────────

/** "-33.54470, 150.40970": the normalised text kept in the Setup form and in the remembered last setup (5 decimals, about 1 m). */
export function formatCoordinateText(p: LatLon): string {
  return `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
}

/**
 * The text of the Setup box that is safe to remember: coordinates only. What was typed as plain coordinates is kept as typed
 * (a box that was "-33.70, 149.86" comes back as that); anything with a link in it becomes the normalised "lat, lon", and
 * anything else (a short link not yet resolved, junk) is dropped, so a pasted share link, which carries a place id, is never stored.
 */
export function rememberableText(text: string): string {
  if (typeof text !== 'string') return '';
  const t = text.trim();
  if (!t) return '';
  const r = parseLocationText(t);
  if (!r.ok) return '';
  if (r.source === 'coordinates' && t.length <= 80 && !/[:/]|goo\.gl/i.test(t)) return t.replace(/\s+/g, ' ');
  return formatCoordinateText(r.position);
}
