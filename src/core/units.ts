/**
 * Unit conventions used throughout FireSim.
 *
 * Internal interfaces are SI unless a name says otherwise:
 *   distance m, time s, speed m/s, temperature °C, humidity %, fuel load t/ha,
 *   fire intensity kW/m, heat flux kW/m², angles in degrees at API boundaries
 *   and radians inside numerical kernels.
 * Directions: compass azimuth in degrees clockwise from north.
 *   - Wind direction is meteorological (the direction the wind blows FROM).
 *   - Spread / flow directions are the direction something moves TOWARDS.
 * Australian empirical fire models are published in km/h; convert at the model boundary.
 */

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export const kmhToMs = (kmh: number): number => kmh / 3.6;
export const msToKmh = (ms: number): number => ms * 3.6;
/** m/s → m/h */
export const msToMh = (ms: number): number => ms * 3600;
/** m/h → m/s */
export const mhToMs = (mh: number): number => mh / 3600;

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Normalise an angle in degrees to [0, 360). */
export const wrapDeg = (d: number): number => ((d % 360) + 360) % 360;

/** Smallest signed difference a - b in degrees, in (-180, 180]. */
export const angleDiffDeg = (a: number, b: number): number => {
  let d = wrapDeg(a - b);
  if (d > 180) d -= 360;
  return d;
};

/**
 * Meteorological wind (speed, direction FROM, degrees) → vector components (u east, v north)
 * of the air motion. A northerly (from 0°) blows towards the south: v < 0.
 */
export const windToUV = (speed: number, dirFromDeg: number): [number, number] => {
  const r = dirFromDeg * DEG;
  return [-speed * Math.sin(r), -speed * Math.cos(r)];
};

/** Vector (u east, v north) → [speed, meteorological direction FROM in degrees]. */
export const uvToWind = (u: number, v: number): [number, number] => {
  const speed = Math.hypot(u, v);
  if (speed < 1e-9) return [0, 0];
  return [speed, wrapDeg(Math.atan2(-u, -v) * RAD)];
};

/** Vector (u east, v north) → azimuth the vector points TOWARDS, degrees clockwise from north. */
export const vectorAzimuthDeg = (u: number, v: number): number => wrapDeg(Math.atan2(u, v) * RAD);

/** Azimuth (towards) → unit vector (east, north). */
export const azimuthToUnit = (azDeg: number): [number, number] => [Math.sin(azDeg * DEG), Math.cos(azDeg * DEG)];

const COMPASS16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
/** 16-point compass name for an azimuth in degrees. */
export const compassName = (azDeg: number): string => COMPASS16[Math.round(wrapDeg(azDeg) / 22.5) % 16]!;

export const celsiusToKelvin = (c: number): number => c + 273.15;
