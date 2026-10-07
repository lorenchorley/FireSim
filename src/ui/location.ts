/**
 * "Use my location" for the setup screen: Capacitor Geolocation on device (with permission request and graceful
 * denial), then the browser's navigator.geolocation, else the caller offers manual lat/lon entry.
 *
 * In steep country the GPS fix can be slow and poor (multipath off cliffs, little sky in gorges): a 30 s timeout and
 * high accuracy are requested, and the accuracy is always shown (doc 09 §6.3).
 */
import { Capacitor } from '@capacitor/core';
import { haversine, type LatLon } from '../core/geo';
import { DEMO_EXTENT_M, DEMO_SITES, type DemoSite } from '../data';
import { isInNsw } from './nsw';

export interface LocationFix {
  position: LatLon;
  /** Horizontal accuracy (m, 95 %-ish as reported by the platform). */
  accuracy: number;
  /** Compass heading (deg) if moving / available. */
  heading: number | null;
  time: number;
  source: 'device' | 'browser' | 'manual';
}

export class LocationError extends Error {
  constructor(
    message: string,
    readonly reason: 'denied' | 'unavailable' | 'timeout' | 'unsupported',
  ) {
    super(message);
    this.name = 'LocationError';
  }
}

const TIMEOUT_MS = 30_000;

async function fromCapacitor(): Promise<LocationFix> {
  const { Geolocation } = await import('@capacitor/geolocation');
  let perm = await Geolocation.checkPermissions();
  if (perm.location !== 'granted') perm = await Geolocation.requestPermissions({ permissions: ['location'] });
  if (perm.location === 'denied') throw new LocationError('Location permission was denied. You can allow it in the phone settings, or pick a demo site or enter coordinates.', 'denied');
  const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: TIMEOUT_MS, maximumAge: 30_000 });
  return {
    position: { lat: p.coords.latitude, lon: p.coords.longitude },
    accuracy: p.coords.accuracy,
    heading: p.coords.heading ?? null,
    time: p.timestamp,
    source: 'device',
  };
}

function fromBrowser(): Promise<LocationFix> {
  return new Promise((resolve, reject) => {
    const geo = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
    if (!geo) return reject(new LocationError('This device has no location service. Pick a demo site or enter coordinates.', 'unsupported'));
    geo.getCurrentPosition(
      (p) =>
        resolve({
          position: { lat: p.coords.latitude, lon: p.coords.longitude },
          accuracy: p.coords.accuracy,
          heading: Number.isFinite(p.coords.heading) ? p.coords.heading : null,
          time: p.timestamp,
          source: 'browser',
        }),
      (e) => {
        const reason = e.code === e.PERMISSION_DENIED ? 'denied' : e.code === e.TIMEOUT ? 'timeout' : 'unavailable';
        const msg =
          reason === 'denied'
            ? 'Location permission was denied. Pick a demo site or enter coordinates.'
            : reason === 'timeout'
              ? 'No GPS fix within 30 s (common in gorges). Try again in the open, or enter coordinates.'
              : 'Location is unavailable right now. Pick a demo site or enter coordinates.';
        reject(new LocationError(msg, reason));
      },
      { enableHighAccuracy: true, timeout: TIMEOUT_MS, maximumAge: 30_000 },
    );
  });
}

/** Get the current position: native plugin → browser → LocationError (caller shows manual entry). */
export async function getLocation(): Promise<LocationFix> {
  if (Capacitor.isNativePlatform()) {
    try {
      return await fromCapacitor();
    } catch (e) {
      if (e instanceof LocationError && e.reason === 'denied') throw e;
      console.warn('[FireSim] native geolocation failed, trying the browser API', e);
    }
  }
  return fromBrowser();
}

/**
 * Where a position is, for the result rows of Setup (the GPS fix and a pasted place): inside NSW or not, and the bundled demo site
 * that has data for it (the position lies well inside the site's 9 km square). `southHint` is true for a position that is in NSW
 * once its latitude is made negative ("33.7, 150.3" typed without the minus sign), so the screen can say so.
 */
export function describePlace(p: LatLon): { inNsw: boolean; nearDemo: DemoSite | null; nearDemoDistance: number; southHint: boolean } {
  let nearDemo: DemoSite | null = null;
  let best = Infinity;
  for (const s of DEMO_SITES) {
    const d = haversine(p, s.centre);
    if (d < best) {
      best = d;
      nearDemo = s;
    }
  }
  // A demo site "covers" the location when the location lies well inside its bundled 9 km square.
  const covers = best < DEMO_EXTENT_M / 2 - 1500;
  const inNsw = isInNsw(p);
  return { inNsw, nearDemo: covers ? nearDemo : null, nearDemoDistance: best, southHint: !inNsw && p.lat > 0 && isInNsw({ lat: -p.lat, lon: p.lon }) };
}

/** Summary of a fix for display: NSW check, poor-accuracy flag and a nearby demo site with bundled data. */
export function describeFix(p: LatLon, accuracy: number): { inNsw: boolean; poor: boolean; nearDemo: DemoSite | null; nearDemoDistance: number } {
  const d = describePlace(p);
  return { inNsw: d.inNsw, poor: accuracy > 50, nearDemo: d.nearDemo, nearDemoDistance: d.nearDemoDistance };
}

/** What reading the clipboard gave: the text, or why not (with what to say to the person). */
export type ClipboardRead = { ok: true; text: string } | { ok: false; reason: 'empty' | 'blocked'; message: string };

/**
 * The text on the clipboard for the Paste button of Setup. The browser API only (the phone's WebView asks first or refuses; no
 * Capacitor clipboard plugin is installed, and none is added for this): when it is missing or refused the message tells the person
 * to touch and hold the box and choose Paste, which always works. Never throws.
 */
export async function readClipboardText(): Promise<ClipboardRead> {
  const blocked: ClipboardRead = { ok: false, reason: 'blocked', message: 'The phone did not let the app read the clipboard. Touch and hold the box, then choose Paste.' };
  try {
    const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (!clip || typeof clip.readText !== 'function') return blocked;
    const text = await clip.readText();
    if (typeof text !== 'string' || text.trim() === '') return { ok: false, reason: 'empty', message: 'The clipboard is empty. Copy a link in Google Maps first (Share, then Copy).' };
    return { ok: true, text };
  } catch {
    return blocked;
  }
}
