/**
 * Ask Google where a short Maps link leads (maps.app.goo.gl/<id>, goo.gl/maps/<id>). A short link holds no coordinates, so this
 * is the one place the "paste a Google Maps link" feature uses the network, and only on the phone:
 *
 *   - Only a Google short link is ever requested (mapsLink.ts decides: nothing else pasted is fetched, ever). Where the link
 *     leads is followed by hand, a hop at a time, and only while it stays on Google's own hosts; any other address is refused.
 *   - On the phone the native HTTP stack is used (CapacitorHttp, no CORS) with `disableRedirects`: Google answers with ONE
 *     redirect straight to the place's address (a real link on 2026-10-07: 302 -> https://www.google.com/maps/place/<Name>/@..
 *     /data=..!3d<lat>!4d<lon>..), and that address is read from the `Location` header. The map page itself is not downloaded
 *     (it is 200 to 900 kB of script), unless the address holds no coordinates, in which case the page is read, capped, as a last
 *     resort.
 *   - Nothing identifying is sent: no custom headers, no cookies, no account; one request per hop, 15 s timeout, one retry.
 *   - In the plain web build the browser's CORS rules hide the redirect, so nothing is requested and the message says so.
 */
import { detectPlatform, HttpError, httpRequest, type RawResponse } from '../data/http';
import { cleanPlaceName, isGoogleFamilyHost, isGoogleHost, LOCATION_MESSAGES, MAX_PAGE_CHARS, parseLocationText, scanMapsPage, type LocationFound } from './mapsLink';

export type ShortLinkFailReason =
  /** Not a Google short link: nothing was requested. */
  | 'not-short-link'
  /** The plain web build cannot read the redirect: nothing was requested. */
  | 'web'
  | 'unreachable'
  | 'not-found'
  /** The link led somewhere that is not Google Maps and was not opened. */
  | 'refused'
  | 'no-coordinates'
  | 'route'
  | 'other'
  | 'aborted';

export interface ShortLinkFailed {
  ok: false;
  reason: ShortLinkFailReason;
  /** Plain English for the person who pasted the link ('' when they cancelled). */
  message: string;
  name?: string;
}

export type ShortLinkResult = LocationFound | ShortLinkFailed;

export const SHORT_LINK_MESSAGES = {
  web: 'Short links only work inside the Android app. Open the link in a browser and paste the long address, or paste the coordinates.',
  unreachable: 'Could not reach Google Maps. Check your connection, or paste the coordinates.',
  notFound: 'Google Maps does not know this short link any more. Ask for a new link, or paste the coordinates.',
  refused: 'This short link leads somewhere that is not Google Maps, so it was not opened. Paste the coordinates instead.',
  other: 'This short link did not lead to a place. Open it in Google Maps and share the place again, or paste the coordinates.',
} as const;

export interface ResolveOptions {
  signal?: AbortSignal;
  /** A place name from the text around the link (the link's own `/place/<name>/` is used when this is missing). */
  nameHint?: string;
  /** Timeout of each request (ms). Default 15 000. */
  timeoutMs?: number;
  /** Pause before the one retry (ms). Default 600. */
  retryDelayMs?: number;
}

const TIMEOUT_MS = 15_000;
const RETRY_DELAY_MS = 600;
/** Requests made by hand, one per hop: Google's own chain is one or two (short link, then maybe a page of the place). */
const MAX_HOPS = 5;

const fail = (reason: ShortLinkFailReason, message: string, name?: string): ShortLinkFailed => (name ? { ok: false, reason, message, name } : { ok: false, reason, message });

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

type Answer = { kind: 'response'; res: RawResponse } | { kind: 'failed'; failure: ShortLinkFailed };

/**
 * The address a request may go to: https on Google's own hosts (google.<tld> and its subdomains, goo.gl, maps.app.goo.gl), on the
 * default port, with no user name or password in it. A plain http address of Google is asked for over https instead (the short
 * link has to stay private on a shared network); anything else is refused. This is the one place a request is made, so nothing
 * that was pasted or that a redirect names can reach another host.
 */
function allowedAddress(url: string): string | null {
  try {
    const u = new URL(url);
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password || u.port || !isGoogleFamilyHost(u.hostname.replace(/\.$/, ''))) return null;
    u.protocol = 'https:';
    return u.href;
  } catch {
    return null;
  }
}

/** One GET with a timeout, no headers, and one retry of a transient failure. */
async function get(url: string, o: { redirect: 'manual' | 'follow'; signal: AbortSignal | undefined; timeoutMs: number; retryDelayMs: number }): Promise<Answer> {
  const target = allowedAddress(url);
  if (!target) return { kind: 'failed', failure: fail('refused', SHORT_LINK_MESSAGES.refused) };
  for (let attempt = 0; ; attempt++) {
    if (o.signal?.aborted) return { kind: 'failed', failure: fail('aborted', '') };
    try {
      const res = await httpRequest(target, { redirect: o.redirect, timeoutMs: o.timeoutMs, ...(o.signal ? { signal: o.signal } : {}), route: false });
      // A busy or failing server is worth one more try, like a lost connection.
      if ((res.status === 429 || res.status >= 500) && attempt < 1) {
        await sleep(o.retryDelayMs, o.signal);
        continue;
      }
      return { kind: 'response', res };
    } catch (e) {
      const err = e instanceof HttpError ? e : new HttpError('network', target, String(e), 0, e);
      if (err.kind === 'aborted' || o.signal?.aborted) return { kind: 'failed', failure: fail('aborted', '') };
      if (err.transient && attempt < 1) {
        await sleep(o.retryDelayMs, o.signal);
        continue;
      }
      return { kind: 'failed', failure: fail('unreachable', SHORT_LINK_MESSAGES.unreachable) };
    }
  }
}

/** The page body as text, at most MAX_PAGE_CHARS bytes of it. */
function pageText(res: RawResponse): string {
  try {
    return new TextDecoder('utf-8').decode(new Uint8Array(res.data, 0, Math.min(res.data.byteLength, MAX_PAGE_CHARS)));
  } catch {
    return '';
  }
}

/** Where a 3xx answer says to go, as an absolute address (null: none, or not an address). */
function redirectTarget(res: RawResponse, from: string): string | null {
  if (res.status < 300 || res.status >= 400) return null;
  const loc = res.headers['location'];
  if (!loc) return null;
  try {
    return new URL(loc.trim(), from).href;
  } catch {
    return null;
  }
}

/**
 * Resolve a Google short link to a position. Never throws. `input` is the short link (or the share text around it); anything
 * that is not a Google short link comes back as `not-short-link` with no request made.
 */
export async function resolveMapsShortLink(input: string, opts: ResolveOptions = {}): Promise<ShortLinkResult> {
  try {
    return await resolve(input, opts);
  } catch {
    return fail('other', SHORT_LINK_MESSAGES.other);
  }
}

async function resolve(input: string, opts: ResolveOptions): Promise<ShortLinkResult> {
  const parsed = parseLocationText(input);
  // A link that already holds its coordinates needs no request at all.
  if (parsed.ok) return parsed;
  if (parsed.reason !== 'short-link-needs-network') return fail('not-short-link', parsed.message, parsed.name);
  if (detectPlatform() === 'browser') return fail('web', SHORT_LINK_MESSAGES.web, parsed.name);

  const hint = cleanPlaceName(opts.nameHint) ?? parsed.name;
  const q = { signal: opts.signal, timeoutMs: opts.timeoutMs ?? TIMEOUT_MS, retryDelayMs: opts.retryDelayMs ?? RETRY_DELAY_MS };
  const named = (r: LocationFound): LocationFound => (hint ? { ...r, name: hint } : r);
  const onGoogle = (address: string): boolean => allowedAddress(address) !== null;

  /** What an address Google handed over means: a position, a failure, the next short link, or a page to read. */
  const judge = (address: string): { done: ShortLinkResult } | { next: string } | { page: string } => {
    // Only an address on Google's own hosts is believed: a redirect that leaves Google is never opened or read for coordinates.
    if (!onGoogle(address)) return { done: fail('refused', SHORT_LINK_MESSAGES.refused, hint) };
    const r = parseLocationText(address);
    if (r.ok) return r.source === 'google-maps-link' ? { done: named(r) } : { done: fail('refused', SHORT_LINK_MESSAGES.refused, hint) };
    switch (r.reason) {
      case 'short-link-needs-network':
        return { next: r.url };
      case 'no-coordinates': {
        let host = '';
        try {
          host = new URL(address).hostname;
        } catch {
          /* not an address */
        }
        return isGoogleHost(host) ? { page: address } : { done: fail('no-coordinates', LOCATION_MESSAGES.noCoordinates, hint ?? r.name) };
      }
      case 'not-a-map-link':
        return { done: fail('refused', SHORT_LINK_MESSAGES.refused, hint) };
      case 'route':
        return { done: fail('route', r.message, hint) };
      default:
        return { done: fail('other', r.message, hint ?? r.name) };
    }
  };

  // One request per hop, every redirect followed BY HAND and only while it stays on Google: the platform is never allowed to
  // follow one to another site (its body would be downloaded and read). An address with no coordinates in it (`reading`) has its
  // page read, capped, as a last resort.
  let current = parsed.url;
  const seen = new Set<string>();
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    if (seen.has(current)) break;
    seen.add(current);
    const a = await get(current, { ...q, redirect: 'manual' });
    if (a.kind === 'failed') return a.failure;
    const { res } = a;
    const target = redirectTarget(res, current);
    if (target) {
      const v = judge(target);
      if ('done' in v) return v.done;
      current = 'next' in v ? v.next : v.page;
      continue;
    }
    if (res.status === 404 || res.status === 410) return fail('not-found', SHORT_LINK_MESSAGES.notFound, hint);
    if (res.status >= 400) return fail('unreachable', SHORT_LINK_MESSAGES.unreachable, hint);
    if (res.status >= 300) return fail('other', SHORT_LINK_MESSAGES.other, hint);
    // A 200: the platform followed the redirects anyway (or the link leads straight to a page). Its final address first, and
    // never the body of a page that is not Google's.
    if (res.finalUrl && res.finalUrl !== current) {
      const v = judge(res.finalUrl);
      if ('done' in v) return v.done;
      if ('next' in v) {
        current = v.next;
        continue;
      }
    }
    const found = scanMapsPage(pageText(res));
    return found ? named(found) : fail('no-coordinates', LOCATION_MESSAGES.noCoordinates, hint);
  }
  return fail('other', SHORT_LINK_MESSAGES.other, hint);
}
