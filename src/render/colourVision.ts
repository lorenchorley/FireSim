/**
 * Colour-vision-deficiency simulation and colour distance (pure). Used by palette.test.ts to prove that the heat-map
 * palettes stay distinguishable for red-green and blue-yellow colour blindness, and by the legends gallery page
 * (legendGallery.html?cvd=deutan) to look at them that way.
 *
 * Simulation: Machado, Oliveira & Fernandes (2009), full severity, applied in linear RGB. Distance: CIE76 ΔE in CIELAB (D65).
 */
import { hexToRgb, linearToSrgb, rgbToHex, srgbToLinear, type Rgb } from './palette';

export type VisionType = 'normal' | 'protan' | 'deutan' | 'tritan';
export const VISION_TYPES: readonly VisionType[] = ['normal', 'protan', 'deutan', 'tritan'];

const MATRIX: Record<VisionType, readonly number[]> = {
  normal: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  protan: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deutan: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritan: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** How an sRGB colour (0–1) looks to a viewer with the given deficiency. */
export function simulateVision(c: Rgb, type: VisionType): Rgb {
  const m = MATRIX[type];
  const r = srgbToLinear(c[0]);
  const g = srgbToLinear(c[1]);
  const b = srgbToLinear(c[2]);
  return [
    linearToSrgb(clamp01(m[0]! * r + m[1]! * g + m[2]! * b)),
    linearToSrgb(clamp01(m[3]! * r + m[4]! * g + m[5]! * b)),
    linearToSrgb(clamp01(m[6]! * r + m[7]! * g + m[8]! * b)),
  ];
}

/** Hex colour as seen with a deficiency. */
export const simulateVisionHex = (hex: string, type: VisionType): string => rgbToHex(simulateVision(hexToRgb(hex), type));

/** CIELAB (D65) of an sRGB colour (0–1). */
export function toLab(c: Rgb): [number, number, number] {
  const r = srgbToLinear(c[0]);
  const g = srgbToLinear(c[1]);
  const b = srgbToLinear(c[2]);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** Perceptual distance (CIE76 ΔE) between two sRGB colours (0–1); about 2.3 is a just-noticeable difference, above 10 is easy. */
export function deltaE(a: Rgb, b: Rgb): number {
  const p = toLab(a);
  const q = toLab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** Smallest ΔE between any two of the colours (hex) as seen with a deficiency. */
export function minPairDistance(hexes: readonly string[], type: VisionType): number {
  const seen = hexes.map((h) => simulateVision(hexToRgb(h), type));
  let min = Infinity;
  for (let i = 0; i < seen.length; i++) for (let j = i + 1; j < seen.length; j++) min = Math.min(min, deltaE(seen[i]!, seen[j]!));
  return min;
}
