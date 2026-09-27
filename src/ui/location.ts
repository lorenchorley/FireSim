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

/** Summary of a fix for display: NSW check, poor-accuracy flag and a nearby demo site with bundled data. */
export function describeFix(p: LatLon, accuracy: number): { inNsw: boolean; poor: boolean; nearDemo: DemoSite | null; nearDemoDistance: number } {
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
  return { inNsw: isInNsw(p), poor: accuracy > 50, nearDemo: covers ? nearDemo : null, nearDemoDistance: best };
}
