import { DEG, RAD } from './units';

export interface LatLon {
  lat: number;
  lon: number;
}

/** Mean Earth radius (m). */
export const EARTH_RADIUS = 6371008.8;

/**
 * Local tangent-plane projection (equirectangular about an origin).
 * x = metres east of origin, y = metres north. Accurate to <0.1% over the ≤ 20 km domains used here.
 */
export class LocalProjection {
  readonly origin: LatLon;
  private readonly kx: number;
  private readonly ky: number;
  constructor(origin: LatLon) {
    this.origin = { ...origin };
    this.ky = EARTH_RADIUS * DEG;
    this.kx = EARTH_RADIUS * DEG * Math.cos(origin.lat * DEG);
  }
  toLocal(p: LatLon): [number, number] {
    return [(p.lon - this.origin.lon) * this.kx, (p.lat - this.origin.lat) * this.ky];
  }
  toLatLon(x: number, y: number): LatLon {
    return { lat: this.origin.lat + y / this.ky, lon: this.origin.lon + x / this.kx };
  }
}

/** Great-circle distance in metres. */
export function haversine(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(s)));
}

// ---- Web-Mercator slippy-map tile maths (used by terrain / imagery tile providers) ----

export interface TileXYZ {
  x: number;
  y: number;
  z: number;
}

/** Fractional tile coordinates of a lat/lon at zoom z. */
export function lonLatToTileFrac(lat: number, lon: number, z: number): [number, number] {
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const latR = lat * DEG;
  const y = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n;
  return [x, y];
}

/** Lat/lon of the north-west corner of fractional tile coords. */
export function tileFracToLonLat(x: number, y: number, z: number): LatLon {
  const n = 2 ** z;
  const lon = (x / n) * 360 - 180;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * RAD;
  return { lat, lon };
}

/** Ground resolution (m/pixel) of a 256-px Web-Mercator tile pyramid at latitude and zoom. */
export function metresPerPixel(lat: number, z: number, tileSize = 256): number {
  return (2 * Math.PI * 6378137 * Math.cos(lat * DEG)) / (tileSize * 2 ** z);
}

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Lat/lon bounding box of a square of side `sizeM` metres centred on `c`. */
export function bboxAround(c: LatLon, sizeM: number): BBox {
  const proj = new LocalProjection(c);
  const h = sizeM / 2;
  const sw = proj.toLatLon(-h, -h);
  const ne = proj.toLatLon(h, h);
  return { south: sw.lat, west: sw.lon, north: ne.lat, east: ne.lon };
}
