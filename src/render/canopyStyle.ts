/**
 * Canopy styles, species rules and colour coding for the 3-D trees (pure; no Three.js).
 *
 *  - {@link barkKindOf}: which bark a tree gets from the fuel flags / bark hazard (the visual cue that teaches the
 *    ember-source hazard: stringybark = thick dark fibrous trunk, ribbon bark = pale trunk with hanging streamers, smooth
 *    gum = pale smooth trunk).
 *  - {@link canopyCodeScale} / {@link canopyCodeLegend}: the colours of the 'coded' style. They come from the SAME ramps as
 *    the matching heat maps (overlayScale / legendFor in legends.ts) so a tree and the ground heat map of the same data agree;
 *    while a heat map has no ramp yet (layer stubs) a local equivalent is used.
 *  - {@link swayParams}: how hard trees lean and sway for a wind speed.
 */
import { FuelFlag, FuelType } from '../core/types';
import type { OverlayKind } from './layers';
import { legendFor, overlayScale, type LegendSpec, type OverlayScale } from './legends';
import { hexToRgb, makeRamp, sampleClasses, sampleRamp, type Ramp, type Rgb } from './palette';

export type CanopyStyle = 'natural' | 'simple' | 'coded';
export type CanopyCode = 'height' | 'cover' | 'bark' | 'understorey';
export const CANOPY_STYLES: readonly CanopyStyle[] = ['natural', 'simple', 'coded'];
export const CANOPY_CODES: readonly CanopyCode[] = ['height', 'cover', 'bark', 'understorey'];

// ─────────────────────────────────────────────────────────────────────────────
// Bark
// ─────────────────────────────────────────────────────────────────────────────

export type BarkKind = 'stringy' | 'ribbon' | 'smooth';
/** Byte codes stored per tree (instance attribute). */
export const BARK_CODE: Record<BarkKind, number> = { smooth: 0, ribbon: 1, stringy: 2 };
export const BARK_OF_CODE: BarkKind[] = ['smooth', 'ribbon', 'stringy'];

/** Bark hazard (0–4) at and above which a tree is drawn as stringybark, and the lower bound for ribbon bark. */
export const STRINGY_MIN_HAZARD = 3;
export const RIBBON_MIN_HAZARD = 1.8;

/**
 * Bark of a eucalypt from the cell's fuel data. The catalogue's FuelFlag.Stringybark / FuelFlag.RibbonBark decide when set
 * (they mirror the fuel class's barkClass 'stringy' / 'ribbon'); otherwise (mixed and smooth classes, or no flags) the bark
 * hazard does: high = stringy, moderate = ribbon, low = smooth. `r` (0–1, per tree) blends the class boundaries so a stand
 * shows a natural mix instead of a hard edge at every cell border, and makes 'mixed' cells contain both.
 */
export function barkKindOf(flags: number | undefined, barkHazard: number, type: FuelType, r: number): BarkKind {
  const f = flags ?? 0;
  if ((f & FuelFlag.Stringybark) !== 0) return 'stringy';
  if ((f & FuelFlag.RibbonBark) !== 0) return 'ribbon';
  if (type === FuelType.Rainforest || type === FuelType.SnowGumWoodland) return 'smooth';
  const h = barkHazard + (r - 0.5) * 0.9;
  if (h >= STRINGY_MIN_HAZARD) return 'stringy';
  if (h >= RIBBON_MIN_HAZARD) return 'ribbon';
  return 'smooth';
}

// ─────────────────────────────────────────────────────────────────────────────
// Colour coding ('coded' style)
// ─────────────────────────────────────────────────────────────────────────────

/** The heat map whose colours a coded attribute shares. */
export function canopyCodeOverlay(code: CanopyCode): OverlayKind {
  switch (code) {
    case 'height':
      return 'canopyHeight';
    case 'cover':
      return 'canopyCover';
    case 'bark':
      return 'barkHazard';
    case 'understorey':
      return 'elevatedHazard';
  }
}

interface LocalCode {
  title: string;
  units: string;
  lo: number;
  hi: number;
  ramp: Ramp;
  classes: boolean;
  labels: { value: number; label: string }[];
  note: string;
}

/** Local equivalents used until the shared heat-map ramps exist (same hue logic: sequential for measures, traffic-light for hazards). */
const HAZARD_STOPS = [
  { at: 0, colour: '#2f9e5b' },
  { at: 1, colour: '#a6cf4f' },
  { at: 2, colour: '#f2d33b' },
  { at: 3, colour: '#ee7d22' },
  { at: 4, colour: '#b3202a' },
];
const HAZARD_LABELS = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Low' },
  { value: 2, label: 'Moderate' },
  { value: 3, label: 'High' },
  { value: 4, label: 'Very high' },
];

const LOCAL_CODES: Record<CanopyCode, LocalCode> = {
  height: {
    title: 'Tree height',
    units: 'm',
    lo: 0,
    hi: 45,
    ramp: makeRamp([
      { at: 0, colour: '#f3e79b' },
      { at: 10, colour: '#9fd18b' },
      { at: 20, colour: '#3ea67a' },
      { at: 30, colour: '#217b8c' },
      { at: 45, colour: '#3b3f8f' },
    ]),
    classes: false,
    labels: [
      { value: 0, label: '0' },
      { value: 15, label: '15' },
      { value: 30, label: '30' },
      { value: 45, label: '45+' },
    ],
    note: 'Taller trees are darker blue-green; the shortest are pale yellow.',
  },
  cover: {
    title: 'Tree cover',
    units: '%',
    lo: 0,
    hi: 100,
    ramp: makeRamp([
      { at: 0, colour: '#f5f2b8' },
      { at: 30, colour: '#b4d880' },
      { at: 60, colour: '#4faa5b' },
      { at: 100, colour: '#0d6b3d' },
    ]),
    classes: false,
    labels: [
      { value: 0, label: '0' },
      { value: 50, label: '50' },
      { value: 100, label: '100' },
    ],
    note: 'How much of the ground the tree crowns shade. Darker green = closer canopy.',
  },
  bark: {
    title: 'Bark hazard',
    units: '',
    lo: 0,
    hi: 4,
    ramp: makeRamp(HAZARD_STOPS),
    classes: true,
    labels: HAZARD_LABELS,
    note: 'How many embers the trunks can throw. Stringybark is high; smooth gums are low.',
  },
  understorey: {
    title: 'Shrub (ladder fuel) hazard',
    units: '',
    lo: 0,
    hi: 4,
    ramp: makeRamp(HAZARD_STOPS),
    classes: true,
    labels: HAZARD_LABELS,
    note: 'How easily flames climb from the ground fuel into the crowns through shrubs.',
  },
};

export interface CanopyCodeScale {
  code: CanopyCode;
  /** Range of the attribute mapped onto the LUT (attribute units: m, %, or hazard 0–4). */
  lo: number;
  hi: number;
  /** 256 × 1 RGBA8 (sRGB) LUT. */
  lut: Uint8Array;
  /** 'shared' when the colours come from the matching heat map's scale, 'local' for the built-in equivalent. */
  source: 'shared' | 'local';
}

function localLut(c: LocalCode): Uint8Array {
  const out = new Uint8Array(256 * 4);
  const rgb: Rgb = [0, 0, 0];
  for (let i = 0; i < 256; i++) {
    const v = c.lo + ((c.hi - c.lo) * (i + 0.5)) / 256;
    if (c.classes) sampleClasses(c.ramp, Math.floor(v + 1e-6), rgb);
    else sampleRamp(c.ramp, v, rgb);
    out[i * 4] = Math.round(rgb[0] * 255);
    out[i * 4 + 1] = Math.round(rgb[1] * 255);
    out[i * 4 + 2] = Math.round(rgb[2] * 255);
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** True once the heat-map builder has real legends for a data layer (the layer stubs return null until then). */
function sharedLegend(code: CanopyCode): LegendSpec | null {
  return legendFor(canopyCodeOverlay(code)) ?? null;
}

/**
 * The colour scale of a coded attribute: the matching heat map's LUT when it exists (identical colours), else the local
 * equivalent. Tree value → LUT texel: u = (value − lo) / (hi − lo).
 */
export function canopyCodeScale(code: CanopyCode): CanopyCodeScale {
  if (sharedLegend(code)) {
    const s: OverlayScale | null = overlayScale(canopyCodeOverlay(code));
    if (s && !s.log && s.mode !== 'categorical' && s.mode !== 'cyclic') return { code, lo: s.lo, hi: s.hi, lut: s.lut, source: 'shared' };
  }
  const c = LOCAL_CODES[code];
  return { code, lo: c.lo, hi: c.hi, lut: localLut(c), source: 'local' };
}

/** Legend of a coded attribute (for the UI): the heat map's own legend when available, otherwise the local one. */
export function canopyCodeLegend(code: CanopyCode): LegendSpec {
  const shared = sharedLegend(code);
  if (shared) return shared;
  const c = LOCAL_CODES[code];
  const hex = (v: number): string => {
    const rgb = c.classes ? sampleClasses(c.ramp, v) : sampleRamp(c.ramp, v);
    const h = (x: number): string => Math.round(x * 255).toString(16).padStart(2, '0');
    return `#${h(rgb[0])}${h(rgb[1])}${h(rgb[2])}`;
  };
  const entries = c.labels.map((l) => ({ value: l.value, colour: hex(l.value), label: l.label }));
  const stops = c.ramp.stops.map((s) => `${s.colour} ${(((s.at - c.lo) / (c.hi - c.lo)) * 100).toFixed(0)}%`).join(', ');
  return {
    overlay: canopyCodeOverlay(code),
    title: c.title,
    units: c.units,
    kind: c.classes ? 'classes' : 'continuous',
    entries,
    gradient: c.classes ? undefined : `linear-gradient(90deg, ${stops})`,
    note: c.note,
  };
}

/** sRGB (0–1) colour a coded tree gets for an attribute value. */
export function canopyCodeColour(scale: CanopyCodeScale, value: number, out: Rgb = [0, 0, 0]): Rgb {
  const u = Math.min(0.99999, Math.max(0, (value - scale.lo) / (scale.hi - scale.lo)));
  const t = Math.floor(u * 256);
  out[0] = scale.lut[t * 4]! / 255;
  out[1] = scale.lut[t * 4 + 1]! / 255;
  out[2] = scale.lut[t * 4 + 2]! / 255;
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Wind sway
// ─────────────────────────────────────────────────────────────────────────────

export interface SwayParams {
  /** Steady lean of a crown top, as a fraction of the tree height. */
  lean: number;
  /** Oscillation amplitude around the lean (fraction of the height at the top). */
  amp: number;
  /** Leaf and streamer flutter (fraction of the crown width). */
  flutter: number;
}

/** Wind speed (m/s) at and above which the effect stops growing. */
export const SWAY_MAX_SPEED = 24;

/**
 * Lean and sway for a near-surface wind speed (m/s). Cheap, monotonic and capped: calm air gives none, a strong bushfire
 * wind (15–20 m/s) a clearly visible lean (≈ 10–12 % of the height at the top) with gusty oscillation.
 */
export function swayParams(speed: number): SwayParams {
  const s = Math.min(SWAY_MAX_SPEED, Math.max(0, Number.isFinite(speed) ? speed : 0));
  const k = s / SWAY_MAX_SPEED;
  return { lean: 0.14 * Math.pow(k, 0.85), amp: 0.05 * Math.pow(k, 0.9), flutter: 0.04 * Math.pow(k, 0.8) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Palettes
// ─────────────────────────────────────────────────────────────────────────────

/** Foliage tints (sRGB) of the natural style. */
export const FOLIAGE = {
  stringy: hexToRgb('#43562f'),
  ribbon: hexToRgb('#5a6f3b'),
  smooth: hexToRgb('#5f7b55'),
  tallGum: hexToRgb('#3a5f34'),
  rainforest: hexToRgb('#24502c'),
  snowGum: hexToRgb('#6f866a'),
  conifer: hexToRgb('#213f27'),
  heath: hexToRgb('#6b7550'),
  understoreyDry: hexToRgb('#5f6c3f'),
  understoreyLush: hexToRgb('#34702f'),
  grassGreen: hexToRgb('#7f9a45'),
  grassCured: hexToRgb('#c9b06a'),
};

/** The restrained palette of the simple style (one calm tone per shape). */
export const SIMPLE = {
  crown: hexToRgb('#5f8f56'),
  cone: hexToRgb('#3d6b45'),
  shrub: hexToRgb('#7ea060'),
  grass: hexToRgb('#a2b56a'),
  trunk: hexToRgb('#6b5a48'),
};
