/** Pure maths of the speed control (no DOM): presets, the logarithmic slider and the custom field. Tested in speedModel.test.ts. */

/** The preset buttons (simulated seconds per second); "as fast as possible" (Infinity) is offered separately. */
export const SPEED_PRESETS: readonly number[] = [0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600, 1800, 3600];

/** Range of the slider. */
export const SPEED_MIN = 0.25;
export const SPEED_MAX = 3600;
/** Range a typed custom speed is limited to (the settings store keeps at most this). */
export const CUSTOM_MIN = 0.1;
export const CUSTOM_MAX = 86400;

/** The slider has this many positions. */
export const SLIDER_STEPS = 1000;

const LOG_RANGE = Math.log(SPEED_MAX / SPEED_MIN);

/** Slider position (0 … SLIDER_STEPS) of a speed; speeds outside the range sit at its ends, "as fast as possible" at the top. */
export function speedToSlider(speed: number): number {
  if (!Number.isFinite(speed)) return SLIDER_STEPS;
  const v = Math.min(SPEED_MAX, Math.max(SPEED_MIN, speed));
  return Math.round((Math.log(v / SPEED_MIN) / LOG_RANGE) * SLIDER_STEPS);
}

/** A speed rounded to a value people can read: 0.05 below 1×, 0.1 below 10×, whole numbers below 100×, then 10 and 100. */
export function niceSpeed(x: number): number {
  if (x < 1) return Math.round(x * 20) / 20;
  if (x < 10) return Math.round(x * 10) / 10;
  if (x < 100) return Math.round(x);
  if (x < 1000) return Math.round(x / 10) * 10;
  return Math.round(x / 100) * 100;
}

/** The speed at a slider position: logarithmic, rounded to a readable value, and pulled onto a preset when within 4 % of it. */
export function sliderToSpeed(pos: number): number {
  const p = Math.min(SLIDER_STEPS, Math.max(0, pos)) / SLIDER_STEPS;
  const raw = SPEED_MIN * Math.exp(p * LOG_RANGE);
  for (const preset of SPEED_PRESETS) if (Math.abs(raw - preset) / preset < 0.04) return preset;
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, niceSpeed(raw)));
}

export type CustomUnit = 'x' | 'minps';

/** A typed custom speed in its unit (× = simulated seconds per second, min/s = simulated minutes per second) → ×; clamped, null if not a positive number. */
export function parseCustomSpeed(value: number, unit: CustomUnit): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const speed = unit === 'minps' ? value * 60 : value;
  return Math.min(CUSTOM_MAX, Math.max(CUSTOM_MIN, speed));
}

/** What to show in the custom field for a speed in a unit (no trailing zeros). */
export function customFieldValue(speed: number, unit: CustomUnit): string {
  if (!Number.isFinite(speed)) return '';
  const v = unit === 'minps' ? speed / 60 : speed;
  return String(Number(v.toFixed(3)));
}
