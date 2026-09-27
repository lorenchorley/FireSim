/**
 * Solar geometry, clear-sky irradiance, beam/diffuse decomposition and terrain insolation.
 *
 * Why it matters for fire in the NSW ranges: in the southern hemisphere north- and west-facing slopes receive far
 * more sun than south- and east-facing ones, so their litter dries faster, they carry drier and more flammable
 * vegetation, and they heat first in the morning, driving up-slope (anabatic) winds. Deep gorges stay shaded and
 * moist; after sunset slopes cool and drain cold air downhill (katabatic flow). This module provides the radiation
 * that the fuel-moisture model and the atmosphere's surface heat flux need.
 *
 * Contents
 *  - {@link solarPosition}: NOAA Solar Calculator algorithm (after Meeus 1998), ±0.01° for 1950–2050, with the
 *    NOAA atmospheric-refraction correction (the returned elevation is the APPARENT elevation).
 *  - {@link sunTimes}: sunrise / sunset / solar noon (zenith 90.833°: refraction + solar semi-diameter).
 *  - {@link clearSkyIrradiance}: Ineichen & Perez (2002) clear-sky GHI and DNI with Linke turbidity and altitude;
 *    {@link clearSkyGhiHaurwitz}: Haurwitz (1945) simple model.
 *  - {@link cloudAttenuation}: Kasten & Czeplak (1980) GHI reduction by total cloud cover.
 *  - {@link erbsDecomposition}: Erbs, Klein & Duffie (1982) diffuse fraction from the clearness index.
 *  - {@link insolation}: per-cell irradiance on the sloping surface = beam·cos(incidence)·(1 − shadow)
 *    + sky diffuse (Hay & Davies 1980: circumsolar part treated as beam, isotropic part × sky-view factor)
 *    + ground-reflected (albedo · GHI · (1 − sky-view factor)).
 *    Cast shadows come from an O(N) sweep of "digital lines" toward the sun (max-plus propagation of the shadow
 *    surface, no per-cell ray marching), cached per sun position.
 *  - {@link skyViewFactor}: Dozier & Frew (1990) sky-view factor from horizon angles in 16 directions, computed
 *    once per terrain with an O(N) convex-hull horizon algorithm (Dozier, Bruno & Downey 1981).
 *
 * Limitations: terrain outside the grid is unknown (cells at the sunward edge are never shaded by distant
 * mountains); Earth curvature (≈ 2 m drop at 5 km) is neglected; clear-sky irradiance uses one altitude for the
 * whole domain (its mean elevation).
 */
import type { LatLon } from '../core/geo';
import type { Terrain } from '../core/types';
import { DEG, RAD } from '../core/units';

/** Solar constant (W/m², Kopp & Lean 2011). */
export const SOLAR_CONSTANT = 1361;

// ─────────────────────────────────────────────────────────────────────────────
// Solar position
// ─────────────────────────────────────────────────────────────────────────────

export interface SolarPosition {
  /** Compass azimuth of the sun, clockwise from north (deg, [0, 360)). */
  azimuth: number;
  /** Apparent elevation above the horizon including refraction (deg; negative at night). */
  elevation: number;
  /** Geometric (unrefracted) elevation (deg). */
  trueElevation: number;
  /** Solar declination (deg). */
  declination: number;
  /** Equation of time (minutes): apparent − mean solar time. */
  equationOfTime: number;
  /** Local hour angle (deg, negative before solar noon). */
  hourAngle: number;
  /** Earth–Sun distance (AU). */
  distanceAU: number;
}

const DAY_MS = 86400000;

/** Declination (deg), equation of time (min) and Earth–Sun distance (AU) at a Unix time (NOAA / Meeus). */
function solarEphemeris(timeMs: number): { decl: number; eot: number; r: number } {
  const jd = timeMs / DAY_MS + 2440587.5;
  const T = (jd - 2451545) / 36525;
  const L0 = (((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360) + 360) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const Mr = M * DEG;
  const C =
    Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) + Math.sin(3 * Mr) * 0.000289;
  const trueLong = L0 + C;
  const v = (M + C) * DEG;
  const r = (1.000001018 * (1 - e * e)) / (1 + e * Math.cos(v));
  const omega = (125.04 - 1934.136 * T) * DEG;
  const lambda = (trueLong - 0.00569 - 0.00478 * Math.sin(omega)) * DEG;
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = (eps0 + 0.00256 * Math.cos(omega)) * DEG;
  const decl = Math.asin(Math.sin(eps) * Math.sin(lambda)) * RAD;
  const y = Math.tan(eps / 2) ** 2;
  const L0r = L0 * DEG;
  const eot =
    4 *
    RAD *
    (y * Math.sin(2 * L0r) -
      2 * e * Math.sin(Mr) +
      4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r) -
      0.5 * y * y * Math.sin(4 * L0r) -
      1.25 * e * e * Math.sin(2 * Mr));
  return { decl, eot, r };
}

/** NOAA atmospheric refraction correction (deg) for a geometric elevation (deg). */
function refraction(el: number): number {
  if (el > 85) return 0;
  const te = Math.tan(el * DEG);
  let arcsec: number;
  if (el > 5) arcsec = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
  else if (el > -0.575) arcsec = 1735 + el * (-518.2 + el * (103.4 + el * (-12.79 + el * 0.711)));
  else arcsec = -20.772 / te;
  return arcsec / 3600;
}

/**
 * Position of the sun at a Unix time (ms, UTC) seen from latitude / longitude (deg, east positive).
 * Azimuth is clockwise from north; elevation is the apparent (refracted) elevation.
 */
export function solarPosition(timeMs: number, lat: number, lon: number): SolarPosition {
  const { decl, eot, r } = solarEphemeris(timeMs);
  const minutesUtc = ((timeMs % DAY_MS) + DAY_MS) % DAY_MS / 60000;
  const tst = minutesUtc + eot + 4 * lon; // true solar time (min)
  let ha = tst / 4 - 180;
  ha = ((((ha + 180) % 360) + 360) % 360) - 180;
  const phi = lat * DEG;
  const d = decl * DEG;
  const H = ha * DEG;
  const cosZ = Math.min(1, Math.max(-1, Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(H)));
  const trueEl = 90 - Math.acos(cosZ) * RAD;
  let az = Math.atan2(-Math.sin(H) * Math.cos(d), Math.sin(d) * Math.cos(phi) - Math.cos(d) * Math.cos(H) * Math.sin(phi)) * RAD;
  if (az < 0) az += 360;
  return {
    azimuth: az >= 360 ? 0 : az,
    elevation: trueEl + refraction(trueEl),
    trueElevation: trueEl,
    declination: decl,
    equationOfTime: eot,
    hourAngle: ha,
    distanceAU: r,
  };
}

export interface SunTimes {
  /** Unix ms (UTC) of sunrise / solar noon / sunset for the solar day containing the query time; NaN in polar day/night. */
  sunrise: number;
  solarNoon: number;
  sunset: number;
  /** Hours between sunrise and sunset (0 in polar night, 24 in polar day). */
  dayLengthHours: number;
  /** Maximum (noon) apparent elevation of the day (deg). */
  noonElevation: number;
}

/**
 * Sunrise, solar noon and sunset (upper limb on the horizon, zenith 90.833°) for the LOCAL MEAN SOLAR day
 * (midnight to midnight at the given longitude) containing `timeMs`. In NSW that day starts ≈ 00:00–01:00 civil
 * time. Accurate to about a minute (one fixed-point iteration on declination and equation of time per event).
 * Useful for diurnal wind transitions: anabatic flow starts ~1–3 h after sunrise, katabatic flow near sunset.
 */
export function sunTimes(timeMs: number, lat: number, lon: number): SunTimes {
  const lonMin = 4 * lon;
  const day = Math.floor((timeMs / 60000 + lonMin) / 1440);
  const dayStartUtc = day * DAY_MS; // UTC midnight of the calendar date of local mean solar time
  let noon = dayStartUtc + (720 - lonMin) * 60000;
  for (let it = 0; it < 2; it++) noon = dayStartUtc + (720 - lonMin - solarEphemeris(noon).eot) * 60000;
  const noonEl = solarPosition(noon, lat, lon).elevation;
  const phi = lat * DEG;
  const cosZs = Math.cos(90.833 * DEG);
  const event = (sign: -1 | 1): number => {
    let t = noon;
    for (let it = 0; it < 3; it++) {
      const eph = solarEphemeris(t);
      const d = eph.decl * DEG;
      const c = (cosZs - Math.sin(phi) * Math.sin(d)) / (Math.cos(phi) * Math.cos(d));
      if (c > 1 || c < -1) return c > 1 ? -Infinity : Infinity; // polar night / polar day
      const haDeg = Math.acos(c) * RAD;
      const eventNoon = dayStartUtc + (720 - lonMin - eph.eot) * 60000;
      t = eventNoon + sign * haDeg * 4 * 60000;
    }
    return t;
  };
  const rise = event(-1);
  const set = event(1);
  if (!Number.isFinite(rise) || !Number.isFinite(set)) {
    const polarDay = rise === Infinity || set === Infinity;
    return { sunrise: NaN, sunset: NaN, solarNoon: noon, dayLengthHours: polarDay ? 24 : 0, noonElevation: noonEl };
  }
  return { sunrise: rise, sunset: set, solarNoon: noon, dayLengthHours: (set - rise) / 3600000, noonElevation: noonEl };
}

// ─────────────────────────────────────────────────────────────────────────────
// Irradiance models
// ─────────────────────────────────────────────────────────────────────────────

/** Extraterrestrial normal irradiance (W/m²) at an Earth–Sun distance (AU). */
export const extraterrestrial = (distanceAU: number): number => SOLAR_CONSTANT / (distanceAU * distanceAU);

/** Kasten & Young (1989) relative optical air mass for an apparent elevation (deg). Infinity below the horizon. */
export function airMass(elevationDeg: number): number {
  if (elevationDeg <= 0) return Infinity;
  const z = 90 - elevationDeg;
  return 1 / (Math.cos(z * DEG) + 0.50572 * (96.07995 - z) ** -1.6364);
}

/** Haurwitz (1945) clear-sky GHI (W/m²): 1098·cosZ·exp(−0.057/cosZ). */
export function clearSkyGhiHaurwitz(elevationDeg: number): number {
  if (elevationDeg <= 0) return 0;
  const cz = Math.sin(elevationDeg * DEG);
  return 1098 * cz * Math.exp(-0.057 / cz);
}

export interface Irradiance {
  /** Global horizontal (W/m²). */
  ghi: number;
  /** Direct normal (W/m²). */
  dni: number;
  /** Diffuse horizontal (W/m²). */
  dhi: number;
}

/**
 * Ineichen & Perez (2002) clear-sky irradiance.
 * @param elevationDeg     apparent solar elevation
 * @param altitude         site altitude (m ASL)
 * @param linkeTurbidity   Linke turbidity (≈ 2 very clean, 3 typical rural NSW, 4–6 hazy / smoky)
 * @param distanceAU       Earth–Sun distance
 */
export function clearSkyIrradiance(elevationDeg: number, altitude = 0, linkeTurbidity = 3, distanceAU = 1): Irradiance {
  if (elevationDeg <= 0) return { ghi: 0, dni: 0, dhi: 0 };
  const cz = Math.sin(elevationDeg * DEG);
  // Absolute (pressure-corrected) air mass, standard atmosphere scale height 8434.5 m (as in pvlib).
  const am = airMass(elevationDeg) * Math.exp(-altitude / 8434.5);
  const i0 = extraterrestrial(distanceAU);
  const tl = linkeTurbidity;
  const fh1 = Math.exp(-altitude / 8000);
  const fh2 = Math.exp(-altitude / 1250);
  const cg1 = 5.09e-5 * altitude + 0.868;
  const cg2 = 3.92e-5 * altitude + 0.0387;
  const ghi = Math.max(0, cg1 * i0 * cz * Math.exp(-cg2 * am * (fh1 + fh2 * (tl - 1))));
  const b = 0.664 + 0.163 / fh1;
  const dni1 = Math.max(0, b * i0 * Math.exp(-0.09 * am * (tl - 1)));
  // Second beam estimate from the global (Ineichen & Perez 2002, eq. 9) keeps DNI consistent with GHI at low sun.
  const dni2 = (ghi * Math.max(0, 1 - (0.1 - 0.2 * Math.exp(-tl)) / (0.1 + 0.882 / fh1))) / cz;
  const dni = Math.min(dni1, dni2);
  return { ghi, dni, dhi: Math.max(0, ghi - dni * cz) };
}

/** Kasten & Czeplak (1980): GHI / GHI_clear = 1 − 0.75·(cloud fraction)^3.4. `cloudCover` in %. */
export const cloudAttenuation = (cloudCover: number): number => 1 - 0.75 * Math.min(1, Math.max(0, cloudCover / 100)) ** 3.4;

/**
 * Erbs et al. (1982) decomposition of GHI into DNI and DHI from the clearness index kt = GHI / (I0·cosZ).
 * Beam is limited at very low sun (cosZ < 0.065) where the model is ill-conditioned.
 */
export function erbsDecomposition(ghi: number, elevationDeg: number, distanceAU = 1): Irradiance {
  if (elevationDeg <= 0 || ghi <= 0) return { ghi: Math.max(0, ghi), dni: 0, dhi: Math.max(0, ghi) };
  const cz = Math.sin(elevationDeg * DEG);
  const i0h = extraterrestrial(distanceAU) * Math.max(cz, 0.065);
  const kt = Math.min(1, ghi / i0h);
  let kd: number;
  if (kt <= 0.22) kd = 1 - 0.09 * kt;
  else if (kt <= 0.8) kd = 0.9511 - 0.1604 * kt + 4.388 * kt ** 2 - 16.638 * kt ** 3 + 12.336 * kt ** 4;
  else kd = 0.165;
  const dhi = kd * ghi;
  const dni = Math.min((ghi - dhi) / Math.max(cz, 0.065), extraterrestrial(distanceAU));
  return { ghi, dni: Math.max(0, dni), dhi };
}

// ─────────────────────────────────────────────────────────────────────────────
// Digital-line traversal (shared by shadows and horizons)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Partition the grid into parallel "digital lines" with direction (ux, uy) and call `cb` for each with its cell
 * indices ordered ALONG +u. Every cell belongs to exactly one line. A line's cells deviate at most half a cell
 * (across the line's minor axis) from an exact straight line; `shift[t]` is the displacement (m) from cell t's
 * centre to that exact line along the minor axis (x when `minorIsX`, else y). Callers evaluate the terrain at the
 * exact line with a first-order correction z + ∇z·shift, which makes planes exact and removes the jagged
 * artefacts a pure cell walk produces on steep side-slopes. Offsets are rounded from the exact line (no drift).
 */
type LineCallback = (buf: Int32Array, shift: Float64Array, len: number, minorIsX: boolean) => void;
function forEachDigitalLine(nx: number, ny: number, h: number, ux: number, uy: number, buf: Int32Array, shift: Float64Array, cb: LineCallback): void {
  const rowMajor = Math.abs(uy) >= Math.abs(ux); // step one row at a time; minor axis = x
  const nMajor = rowMajor ? ny : nx;
  const nMinor = rowMajor ? nx : ny;
  const m = rowMajor ? ux / uy : uy / ux;
  const off = new Int32Array(nMajor);
  const frac = new Float64Array(nMajor);
  let omin = 0;
  let omax = 0;
  for (let a = 0; a < nMajor; a++) {
    const exact = a * m;
    const o = Math.round(exact);
    off[a] = o;
    frac[a] = (exact - o) * h; // exact − rounded, in metres along the minor axis
    if (o < omin) omin = o;
    if (o > omax) omax = o;
  }
  const forward = rowMajor ? uy > 0 : ux > 0;
  for (let L = -omax; L <= nMinor - 1 - omin; L++) {
    let len = 0;
    for (let aa = 0; aa < nMajor; aa++) {
      const a = forward ? aa : nMajor - 1 - aa;
      const b = L + off[a]!;
      if (b >= 0 && b < nMinor) {
        buf[len] = rowMajor ? a * nx + b : b * nx + a;
        shift[len] = frac[a]!;
        len++;
      }
    }
    if (len) cb(buf, shift, len, rowMajor);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cast shadows
// ─────────────────────────────────────────────────────────────────────────────

interface TerrainSolarCache {
  shadows: Map<string, Float32Array>;
  svf: Map<number, Float32Array>;
}
const solarCache = new WeakMap<Terrain, TerrainSolarCache>();
const MAX_SHADOW_CACHE = 12;

function cacheFor(terrain: Terrain): TerrainSolarCache {
  let c = solarCache.get(terrain);
  if (!c) {
    c = { shadows: new Map(), svf: new Map() };
    solarCache.set(terrain, c);
  }
  return c;
}

/**
 * Cast-shadow fraction per cell (0 sunlit … 1 fully in the shadow of other terrain) for a sun at azimuth /
 * elevation (deg). Self-shading (slopes facing away from the sun) is NOT included — it follows from cos(incidence).
 *
 * Algorithm: lines parallel to the sun azimuth are swept from the sunward edge; along each line the shadow
 * surface S = max(z, S_upstream − d·tan(elevation)) is propagated (d = distance toward the sun between successive
 * cells). A cell is in shadow where S_upstream − d·tan(e) > z; the fraction ramps over half a cell's sun-ray drop
 * to anti-alias shadow edges. O(N); results are cached per terrain and sun position (0.01°), so treat the returned
 * array as read-only (it is shared between calls).
 */
export function castShadows(terrain: Terrain, sunAzimuth: number, sunElevation: number): Float32Array {
  const cache = cacheFor(terrain);
  const key = `${sunAzimuth.toFixed(2)}|${sunElevation.toFixed(2)}`;
  const hit = cache.shadows.get(key);
  if (hit) {
    cache.shadows.delete(key); // LRU refresh
    cache.shadows.set(key, hit);
    return hit;
  }
  const { grid, elevation: z } = terrain;
  const { nx, ny, cellSize: h, x0, y0 } = grid;
  const n = nx * ny;
  const out = new Float32Array(n);
  if (sunElevation <= 0) out.fill(1);
  else if (sunElevation < 89.9) {
    const a = sunAzimuth * DEG;
    const sx = Math.sin(a); // horizontal unit vector TOWARD the sun
    const sy = Math.cos(a);
    const tanE = Math.tan(sunElevation * DEG);
    // Soft shadow edge: the fraction ramps from 0 where the shadow surface just touches the ground to 1 half a
    // cell's sun-ray drop below it (anti-aliasing; lit cells stay exactly 0).
    const invBand = 1 / (0.5 * h * tanE + 0.05);
    const buf = new Int32Array(Math.max(nx, ny));
    const shift = new Float64Array(Math.max(nx, ny));
    const { dzdx, dzdy } = terrain;
    // Lines ordered ALONG +(sx, sy) go toward the sun; sweep them from the sun end backwards. Heights and
    // positions are evaluated on the exact line (first-order correction with the local gradient).
    forEachDigitalLine(nx, ny, h, sx, sy, buf, shift, (line, sh, len, minorIsX) => {
      let S = -Infinity;
      let sPrev = 0;
      for (let t = len - 1; t >= 0; t--) {
        const k = line[t]!;
        const ex = minorIsX ? sh[t]! : 0;
        const ey = minorIsX ? 0 : sh[t]!;
        const zk = z[k]! + dzdx[k]! * ex + dzdy[k]! * ey;
        const s = (x0 + (k % nx) * h + ex) * sx + (y0 + ((k / nx) | 0) * h + ey) * sy;
        if (t === len - 1) {
          out[k] = 0;
          S = zk;
        } else {
          const up = S - (sPrev - s) * tanE;
          const f = (up - zk) * invBand;
          out[k] = f <= 0 ? 0 : f >= 1 ? 1 : f;
          S = up > zk ? up : zk;
        }
        sPrev = s;
      }
    });
  }
  cache.shadows.set(key, out);
  if (cache.shadows.size > MAX_SHADOW_CACHE) cache.shadows.delete(cache.shadows.keys().next().value!);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sky-view factor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sky-view factor per cell (0–1): the fraction of diffuse sky radiation an (inclined) cell receives relative to an
 * unobstructed horizontal surface (Dozier & Frew 1990):
 *   V = (1/2π) ∫ [cos S · sin²H(φ) + sin S · cos(φ − A) · (H − sin H cos H)] dφ,
 * with H(φ) the zenith angle of the horizon, limited by the local slope plane and by the horizontal (terrain below
 * the horizontal is ground, not sky). An unobstructed plane of slope S gets (1 + cos S)/2; a gorge floor much less.
 * Horizons along each of `directions` azimuths come from an upper-convex-hull scan of every digital line
 * (exact along the line, O(N) per direction). Computed once per terrain and cached (treat as read-only).
 */
export function skyViewFactor(terrain: Terrain, directions = 16): Float32Array {
  const cache = cacheFor(terrain);
  const hit = cache.svf.get(directions);
  if (hit) return hit;
  const { grid, elevation: z, dzdx, dzdy } = terrain;
  const { nx, ny, cellSize: h, x0, y0 } = grid;
  const n = nx * ny;
  const acc = new Float32Array(n);
  const cosS = new Float32Array(n);
  for (let k = 0; k < n; k++) cosS[k] = 1 / Math.sqrt(1 + dzdx[k]! * dzdx[k]! + dzdy[k]! * dzdy[k]!);
  const buf = new Int32Array(Math.max(nx, ny));
  const shift = new Float64Array(Math.max(nx, ny));
  const pos = new Float64Array(Math.max(nx, ny));
  const zl = new Float64Array(Math.max(nx, ny));
  const stack = new Int32Array(Math.max(nx, ny));
  const HALF_PI = Math.PI / 2;
  for (let d = 0; d < directions; d++) {
    const phi = (d * 2 * Math.PI) / directions;
    const ux = Math.sin(phi);
    const uy = Math.cos(phi);
    forEachDigitalLine(nx, ny, h, ux, uy, buf, shift, (line, sh, len, minorIsX) => {
      // Positions along the look direction and heights, both on the exact straight line.
      for (let t = 0; t < len; t++) {
        const k = line[t]!;
        const ex = minorIsX ? sh[t]! : 0;
        const ey = minorIsX ? 0 : sh[t]!;
        pos[t] = (x0 + (k % nx) * h + ex) * ux + (y0 + ((k / nx) | 0) * h + ey) * uy;
        zl[t] = z[k]! + dzdx[k]! * ex + dzdy[k]! * ey;
      }
      // Scan from the far end (largest s along the look direction) back to the start, maintaining the upper
      // convex hull of the points ahead; the hull vertex adjacent to the current point gives its horizon.
      let top = 0;
      for (let t = len - 1; t >= 0; t--) {
        const k = line[t]!;
        const zk = zl[t]!;
        const sk = pos[t]!;
        while (top >= 2) {
          const a = stack[top - 1]!;
          const b = stack[top - 2]!;
          // Pop a if b subtends at least as high an angle as a, seen from the current point.
          if ((zl[b]! - zk) * (pos[a]! - sk) >= (zl[a]! - zk) * (pos[b]! - sk)) top--;
          else break;
        }
        const gu = dzdx[k]! * ux + dzdy[k]! * uy; // slope of the local plane along the look direction
        let tanH = gu > 0 ? gu : 0; // horizon never below the horizontal or the local plane
        if (top > 0) {
          const q = stack[top - 1]!;
          const tq = (zl[q]! - zk) / (pos[q]! - sk);
          if (tq > tanH) tanH = tq;
        }
        stack[top++] = t;
        // Horizon elevation h = atan(tanH). With H = π/2 − h: sin²H = cos²h = 1/(1 + tan²h),
        // H − sinH·cosH = π/2 − h − tanh·cos²h, and sin S·cos(φ − A) = −cos S·(∇z·u).
        const c2 = 1 / (1 + tanH * tanH);
        acc[k] += cosS[k]! * (c2 - gu * (HALF_PI - Math.atan(tanH) - tanH * c2));
      }
    });
  }
  const inv = 1 / directions;
  for (let k = 0; k < n; k++) {
    const v = acc[k]! * inv;
    acc[k] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  cache.svf.set(directions, acc);
  return acc;
}

// ─────────────────────────────────────────────────────────────────────────────
// Insolation
// ─────────────────────────────────────────────────────────────────────────────

export interface InsolationOptions {
  /** Measured / forecast global horizontal irradiance (W/m²). When given it overrides the clear-sky model and
   *  cloud cover, and is split into beam and diffuse with the Erbs model. */
  ghi?: number;
  /** Total cloud cover (%), used with the clear-sky model when `ghi` is not given. */
  cloudCover?: number;
  /** Ground albedo for terrain-reflected radiation (default 0.15, eucalypt forest ≈ 0.12–0.18). */
  albedo?: number;
  /** Linke turbidity for the clear-sky model (default 3). Raise to 5–8 for heavy smoke. */
  linkeTurbidity?: number;
  /** Observer location for the sun position (default: the grid origin). */
  location?: LatLon;
}

export interface InsolationResult {
  /** Total shortwave irradiance on the sloping surface (W/m² of surface). */
  total: Float32Array;
  /** Beam (direct) component on the sloping surface (W/m²). */
  direct: Float32Array;
  /** 1 where the cell receives no direct sun (cast shadow, facing away, or sun below the horizon). */
  shaded: Uint8Array;
  sunAzimuth: number;
  sunElevation: number;
  /** Horizontal irradiance used (W/m²). */
  ghi: number;
  dni: number;
  dhi: number;
}

/** Mean elevation of the terrain (cached by object identity). */
const meanElevationCache = new WeakMap<Terrain, number>();
function meanElevation(t: Terrain): number {
  let m = meanElevationCache.get(t);
  if (m === undefined) {
    let s = 0;
    for (let k = 0; k < t.elevation.length; k++) s += t.elevation[k]!;
    m = s / t.elevation.length;
    meanElevationCache.set(t, m);
  }
  return m;
}

/** Horizontal irradiance components for a sun position and options (clear sky → cloud → decomposition). */
export function horizontalIrradiance(sun: SolarPosition, altitude: number, opts: InsolationOptions = {}): Irradiance {
  const el = sun.elevation;
  if (el <= 0) return { ghi: 0, dni: 0, dhi: 0 };
  if (opts.ghi !== undefined && Number.isFinite(opts.ghi)) return erbsDecomposition(Math.max(0, opts.ghi), el, sun.distanceAU);
  const clear = clearSkyIrradiance(el, altitude, opts.linkeTurbidity ?? 3, sun.distanceAU);
  if (opts.cloudCover !== undefined && Number.isFinite(opts.cloudCover) && opts.cloudCover > 0) {
    return erbsDecomposition(clear.ghi * cloudAttenuation(opts.cloudCover), el, sun.distanceAU);
  }
  return clear;
}

/**
 * Shortwave irradiance on every cell's sloping surface at a time.
 *   total = beam·cos(i)·(1 − shadow) + DHI·[Ai·Rb·(1 − shadow) + (1 − Ai)·V] + albedo·GHI·(1 − V)
 * with cos(i) the cosine of the incidence angle on the slope, Ai = DNI/I0 the Hay–Davies anisotropy index,
 * Rb = cos(i)/cos(Z), and V the sky-view factor. O(N) per call after the one-off sky-view computation.
 */
export function insolation(terrain: Terrain, timeMs: number, opts: InsolationOptions = {}): InsolationResult {
  const loc = opts.location ?? terrain.grid.origin;
  const sun = solarPosition(timeMs, loc.lat, loc.lon);
  const n = terrain.elevation.length;
  const total = new Float32Array(n);
  const direct = new Float32Array(n);
  const shaded = new Uint8Array(n);
  const irr = horizontalIrradiance(sun, meanElevation(terrain), opts);
  const base = { sunAzimuth: sun.azimuth, sunElevation: sun.elevation, ghi: irr.ghi, dni: irr.dni, dhi: irr.dhi };
  if (sun.elevation <= 0) {
    shaded.fill(1);
    return { total, direct, shaded, ...base };
  }
  const svf = skyViewFactor(terrain);
  const shadow = castShadows(terrain, sun.azimuth, sun.elevation);
  const albedo = opts.albedo ?? 0.15;
  const a = sun.azimuth * DEG;
  const e = sun.elevation * DEG;
  const lx = Math.sin(a) * Math.cos(e);
  const ly = Math.cos(a) * Math.cos(e);
  const lz = Math.sin(e);
  const cosZ = Math.max(lz, 0.087); // Rb floor at 85° zenith (Hay–Davies)
  const ai = Math.min(1, irr.dni / extraterrestrial(sun.distanceAU));
  const dhiIso = irr.dhi * (1 - ai);
  const dhiCirc = irr.dhi * ai;
  const refl = albedo * irr.ghi;
  const { dzdx, dzdy } = terrain;
  for (let k = 0; k < n; k++) {
    const p = dzdx[k]!;
    const q = dzdy[k]!;
    const cosi = (lz - p * lx - q * ly) / Math.sqrt(1 + p * p + q * q);
    const lit = cosi > 0 ? 1 - shadow[k]! : 0;
    const beam = cosi > 0 ? irr.dni * cosi * lit : 0;
    const v = svf[k]!;
    direct[k] = beam;
    total[k] = beam + (cosi > 0 ? (dhiCirc * cosi * lit) / cosZ : 0) + dhiIso * v + refl * (1 - v);
    shaded[k] = lit < 0.5 ? 1 : 0;
  }
  return { total, direct, shaded, ...base };
}

export interface DailyInsolation {
  /** Daily shortwave energy on each sloping cell (MJ/m²). */
  energy: Float32Array;
  /** Hours of direct sun per cell. */
  sunHours: Float32Array;
}

/**
 * Integrate {@link insolation} over the local-mean-solar day containing `dayTimeMs` (trapezoid rule, default 30 min
 * steps between sunrise and sunset). Handy for aspect-driven fuel dryness maps and teaching overlays.
 */
export function dailyInsolation(terrain: Terrain, dayTimeMs: number, opts: InsolationOptions & { stepMinutes?: number } = {}): DailyInsolation {
  const loc = opts.location ?? terrain.grid.origin;
  const st = sunTimes(dayTimeMs, loc.lat, loc.lon);
  const n = terrain.elevation.length;
  const energy = new Float32Array(n);
  const sunHours = new Float32Array(n);
  if (!Number.isFinite(st.sunrise)) return { energy, sunHours };
  const stepS = (opts.stepMinutes ?? 30) * 60;
  const steps = Math.max(1, Math.ceil((st.sunset - st.sunrise) / 1000 / stepS));
  const dt = (st.sunset - st.sunrise) / 1000 / steps;
  for (let s = 0; s <= steps; s++) {
    const w = (s === 0 || s === steps ? 0.5 : 1) * dt;
    const r = insolation(terrain, st.sunrise + s * dt * 1000, opts);
    for (let k = 0; k < n; k++) {
      energy[k] += r.total[k]! * w * 1e-6;
      if (!r.shaded[k]) sunHours[k] += w / 3600;
    }
  }
  return { energy, sunHours };
}
