/**
 * Sky and lighting keyed on the sun's elevation (pure). Colours are sRGB hex keyframes interpolated piecewise-linearly
 * in sun elevation: noon is neutral, the low sun warm and golden, twilight pink-violet and the night dark blue — dark
 * enough that a night fire's glow dominates the scene, which is exactly when trainees most often misjudge it.
 */
import { clamp, smoothstep } from '../core/units';
import type { NightLook } from './api';
import { sunDirectionWorld, type Vec3 } from './coords';
import { hexToRgb, mixRgb, rgbToLinear, type Rgb } from './palette';

export interface SkyLighting {
  /** Sun elevation used (deg). */
  sunElevation: number;
  /** Linear-light colours. */
  zenith: Rgb;
  horizon: Rgb;
  sunColour: Rgb;
  /** Direct sun strength (shader units, ≈ 1.4 at noon, 0 at night). */
  sunIntensity: number;
  skyAmbient: Rgb;
  groundAmbient: Rgb;
  ambientIntensity: number;
  /** Fog colour (linear) — the horizon colour darkened a little. */
  fog: Rgb;
  /** 0 day … 1 full night (for emissive boosts, star field, UI). */
  night: number;
  exposure: number;
}

interface Key {
  el: number;
  zenith: string;
  horizon: string;
  sun: string;
  sunI: number;
  ambSky: string;
  ambGround: string;
  ambI: number;
}

const KEYS: Key[] = [
  // Night: dark blue "moonlight" ambient, just bright enough that ridges and gullies still read around a glowing fire.
  { el: -18, zenith: '#02040c', horizon: '#0a1428', sun: '#000000', sunI: 0, ambSky: '#5270b8', ambGround: '#0e1018', ambI: 0.27 },
  { el: -8, zenith: '#0a1331', horizon: '#1c2a52', sun: '#000000', sunI: 0, ambSky: '#5a73b8', ambGround: '#101218', ambI: 0.29 },
  { el: -3, zenith: '#1b2b5c', horizon: '#b0707a', sun: '#ff7a3c', sunI: 0.08, ambSky: '#7482bb', ambGround: '#221c1c', ambI: 0.32 },
  { el: 2, zenith: '#34548f', horizon: '#f0a36b', sun: '#ff9a55', sunI: 0.55, ambSky: '#8ea3d4', ambGround: '#4a3a2c', ambI: 0.38 },
  { el: 10, zenith: '#3b69b0', horizon: '#f0cfa2', sun: '#ffcf96', sunI: 1.0, ambSky: '#a7bde4', ambGround: '#5a4c3a', ambI: 0.44 },
  { el: 30, zenith: '#3a6ec0', horizon: '#c5daee', sun: '#fff0da', sunI: 1.3, ambSky: '#b2c9ec', ambGround: '#5f5444', ambI: 0.48 },
  { el: 90, zenith: '#2e63b7', horizon: '#bad3ee', sun: '#fff9ee', sunI: 1.4, ambSky: '#bacff0', ambGround: '#62584a', ambI: 0.5 },
];

const lerpN = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Lighting for a sun elevation (deg). `cloudCover` (%) dims and greys the sun; `smoke` (0–1) adds an orange-brown
 * haze to sky and fog (heavy smoke days look like this).
 */
export function skyLighting(sunElevation: number, opts: { cloudCover?: number; smoke?: number } = {}): SkyLighting {
  const el = clamp(sunElevation, KEYS[0]!.el, KEYS[KEYS.length - 1]!.el);
  let s = 0;
  while (s < KEYS.length - 2 && el > KEYS[s + 1]!.el) s++;
  const a = KEYS[s]!;
  const b = KEYS[s + 1]!;
  const t = (el - a.el) / (b.el - a.el);
  const mix = (x: string, y: string): Rgb => mixRgb(hexToRgb(x), hexToRgb(y), t);
  let zenith = mix(a.zenith, b.zenith);
  let horizon = mix(a.horizon, b.horizon);
  let sunColour = mix(a.sun, b.sun);
  let sunIntensity = lerpN(a.sunI, b.sunI, t);
  const skyAmbient = mix(a.ambSky, b.ambSky);
  const groundAmbient = mix(a.ambGround, b.ambGround);
  let ambientIntensity = lerpN(a.ambI, b.ambI, t);

  const cloud = clamp((opts.cloudCover ?? 0) / 100, 0, 1);
  if (cloud > 0) {
    const grey: Rgb = [0.72, 0.74, 0.78];
    sunIntensity *= 1 - 0.75 * cloud ** 1.5;
    ambientIntensity *= 1 + 0.25 * cloud;
    zenith = mixRgb(zenith, [zenith[0] * 0.5 + grey[0] * 0.5, zenith[1] * 0.5 + grey[1] * 0.5, zenith[2] * 0.5 + grey[2] * 0.5], cloud * 0.8);
    horizon = mixRgb(horizon, grey, cloud * 0.5 * (sunElevation > 0 ? 1 : 0.2));
  }
  const smoke = clamp(opts.smoke ?? 0, 0, 1);
  if (smoke > 0) {
    const haze: Rgb = [0.78, 0.55, 0.35];
    horizon = mixRgb(horizon, [horizon[0] * 0.4 + haze[0] * 0.6, horizon[1] * 0.4 + haze[1] * 0.6, horizon[2] * 0.4 + haze[2] * 0.6], smoke * (sunElevation > -4 ? 1 : 0.3));
    sunColour = mixRgb(sunColour, [1, 0.55, 0.3], smoke * 0.6);
    sunIntensity *= 1 - 0.4 * smoke;
  }
  const night = clamp((-sunElevation - 2) / 10, 0, 1);
  const fogS = mixRgb(horizon, zenith, 0.25);
  return {
    sunElevation,
    zenith: rgbToLinear(zenith),
    horizon: rgbToLinear(horizon),
    sunColour: rgbToLinear(sunColour),
    sunIntensity,
    skyAmbient: rgbToLinear(skyAmbient),
    groundAmbient: rgbToLinear(groundAmbient),
    ambientIntensity,
    fog: rgbToLinear(fogS),
    night,
    exposure: 1 + 0.6 * night,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Map lighting (Layers, Map type, Night lighting; docs/plans/air-slice-wind-detail-honest-speed.md section 9b)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The three looks in the order the Layers panel lists them. */
export const NIGHT_LOOKS: readonly NightLook[] = ['realistic', 'brighter', 'daylight'];

/** How far each look goes towards the fixed sun after dark: 0 is today's lighting, 1 the whole way (spike S4 tuned Brighter). */
export const NIGHT_LOOK_MIX: Readonly<Record<NightLook, number>> = { realistic: 0, brighter: 0.3, daylight: 1 };

/** The fixed map sun of Brighter and Daylight: north-west (the best of eight at both spike sites), 30 degrees up. */
export const MAP_SUN = { azimuth: 315, elevation: 30 } as const;

/** The look is off with the real sun at or above `FADE_HIGH` degrees and at full strength at or below `FADE_LOW`. */
const FADE_HIGH = 8;
const FADE_LOW = -2;

/** The lighting the map (ground, photo, trees, roads, labels) is drawn with. */
export interface MapLighting {
  /** Share of the fixed sun in the map lighting: the look's mix times the dusk fade (0 = exactly the real lighting). */
  weight: number;
  /** Unit vector towards the light, world frame. */
  sunDir: Vec3;
  sunColour: Rgb;
  sunIntensity: number;
  skyAmbient: Rgb;
  groundAmbient: Rgb;
  ambientIntensity: number;
  exposure: number;
  /** Night as the things that dim the map see it (roads, labels, tree moonlight): the real night times (1 - weight). */
  mapNight: number;
  /** Scale of the terrain's cast shadows, which follow the real sun: 1 - weight. */
  shadowGain: number;
}

let target: SkyLighting | null = null;

/** The lighting of the fixed sun by day: no cloud and no smoke, because seeing the ground is the point. */
function mapTarget(): SkyLighting {
  return (target ??= skyLighting(MAP_SUN.elevation));
}

/** Colour times intensity is what the shaders use, so blend that and divide the blended intensity out again. */
function blendLight(real: Rgb, realI: number, tgt: Rgb, tgtI: number, w: number, i: number): Rgb {
  if (!(i > 1e-9)) return [tgt[0], tgt[1], tgt[2]];
  const a = (1 - w) * realI;
  const b = w * tgtI;
  return [(real[0] * a + tgt[0] * b) / i, (real[1] * a + tgt[1] * b) / i, (real[2] * a + tgt[2] * b) / i];
}

/**
 * The lighting the map uses for a look. With the look Realistic, or the sun at 8 degrees or more, it is `real` itself (the
 * same objects, no arithmetic). As the sun sets the real lighting fades into the daylight of a fixed north-west sun
 * (`MAP_SUN`) by `weight = mix[look] x smoothstep(8, -2, elevation)`. The direction is weighted by the light each sun
 * carries (a sun below the horizon has none, so at night every look is lit from the fixed sun whatever the real azimuth
 * does); the sun's light and the ambient are blended as colour times intensity; the exposure is blended as it is.
 * `realSunDir` is the real sun's world direction (`SkyLighting` has no azimuth).
 */
export function mapLighting(real: SkyLighting, look: NightLook, realSunDir: Vec3): MapLighting {
  const w = NIGHT_LOOK_MIX[look] * smoothstep(FADE_HIGH, FADE_LOW, real.sunElevation);
  if (!(w > 0)) {
    return {
      weight: 0,
      sunDir: realSunDir,
      sunColour: real.sunColour,
      sunIntensity: real.sunIntensity,
      skyAmbient: real.skyAmbient,
      groundAmbient: real.groundAmbient,
      ambientIntensity: real.ambientIntensity,
      exposure: real.exposure,
      mapNight: real.night,
      shadowGain: 1,
    };
  }
  const t = mapTarget();
  const td = sunDirectionWorld(MAP_SUN.azimuth, MAP_SUN.elevation);
  const a = (1 - w) * real.sunIntensity;
  const b = w * t.sunIntensity;
  const vx = realSunDir[0] * a + td[0] * b;
  const vy = realSunDir[1] * a + td[1] * b;
  const vz = realSunDir[2] * a + td[2] * b;
  const len = Math.hypot(vx, vy, vz) || 1;
  const sunIntensity = lerpN(real.sunIntensity, t.sunIntensity, w);
  const ambientIntensity = lerpN(real.ambientIntensity, t.ambientIntensity, w);
  return {
    weight: w,
    sunDir: [vx / len, vy / len, vz / len],
    sunColour: blendLight(real.sunColour, real.sunIntensity, t.sunColour, t.sunIntensity, w, sunIntensity),
    sunIntensity,
    skyAmbient: blendLight(real.skyAmbient, real.ambientIntensity, t.skyAmbient, t.ambientIntensity, w, ambientIntensity),
    groundAmbient: blendLight(real.groundAmbient, real.ambientIntensity, t.groundAmbient, t.ambientIntensity, w, ambientIntensity),
    ambientIntensity,
    exposure: lerpN(real.exposure, t.exposure, w),
    mapNight: real.night * (1 - w),
    shadowGain: 1 - w,
  };
}
