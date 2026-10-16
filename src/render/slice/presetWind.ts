/**
 * The wind the "Along the wind" and "Across the wind" presets follow (pure; plan 8.3, 8.4): the model's own wind where the line
 * is centred, a little above the ground, with the forecast's 10 m direction as the fallback. The forecast says what the weather is
 * doing in general; the line is for looking at what the model's air does, and after a wind edit or in rough ground the two differ
 * (a 14 m/s wind from the east edited in at the fire gives 12.7 m/s from about 95 degrees at 30 m there, while the forecast still
 * says the weather file's north-westerly). A line along the model's wind is one the Along and Across chips mean something for.
 */
import { RAD, wrapDeg } from '../../core/units';
import type { SlicePoint } from './types';

/** The height above the ground (m) the preset's wind is read at: above the 10 m wind's own layer, below the first model level that is smoothed away. */
export const PRESET_WIND_AGL_M = 30;

/** Under this horizontal speed (m/s) a wind has no direction worth following (the same line as the probe's and the scene's calm). */
const CALM_MS = 0.2;

/** What the preset needs of the air: `AtmosphereSampler` has both (a view without a 3-D wind says so in `hasWind`). */
export interface PresetWindAir {
  readonly hasWind: boolean;
  wind(x: number, y: number, zAsl: number, aglHint: number, out: Float32Array | number[]): void;
}

const uvw = new Float32Array(3);

/**
 * The direction (degrees clockwise from north, FROM) the model's wind blows from at `centre`, `PRESET_WIND_AGL_M` above the ground
 * (`groundAsl`, m ASL, the 10 m ground of the slice), else `forecastFromDeg`. The forecast is used when the air holds no 3-D wind, or
 * when the model's wind there is calm (a sheltered pocket should not switch the presets off while the weather has a direction), and may
 * itself be null (a calm forecast): then there is no direction and the presets say so. Does not allocate.
 */
export function presetWindFromDeg(air: PresetWindAir, centre: SlicePoint, groundAsl: number, forecastFromDeg: number | null): number | null {
  if (air.hasWind && Number.isFinite(centre[0]) && Number.isFinite(centre[1]) && Number.isFinite(groundAsl)) {
    air.wind(centre[0], centre[1], groundAsl + PRESET_WIND_AGL_M, PRESET_WIND_AGL_M, uvw);
    const u = uvw[0]!;
    const v = uvw[1]!;
    if (Math.hypot(u, v) >= CALM_MS) return wrapDeg(Math.atan2(-u, -v) * RAD);
  }
  return forecastFromDeg;
}
