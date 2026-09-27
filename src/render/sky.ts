/**
 * Sky and lighting keyed on the sun's elevation (pure). Colours are sRGB hex keyframes interpolated piecewise-linearly
 * in sun elevation: noon is neutral, the low sun warm and golden, twilight pink-violet and the night dark blue — dark
 * enough that a night fire's glow dominates the scene, which is exactly when trainees most often misjudge it.
 */
import { clamp } from '../core/units';
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
