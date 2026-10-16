/**
 * The side-view panel's pure part (Air Slice, plan §8.1 and §8.5): where things go on the canvas and back again, the axis
 * ticks, the colouring of the field raster, and every sentence the panel writes (footer, chips, empty states, captions,
 * legend). No DOM and no canvas, so it is unit-tested in node; slicePanel.ts wires it and sliceDraw.ts paints with it.
 */
import { AIR_STALE_S } from '../../../core/airView';
import { rampLut, type Ramp } from '../../../render/palette';
import { SLICE_FIELDS, SLICE_KIND_LABEL, type SliceData, type SliceFieldId, type SliceFieldStatus, type SliceFooterInfo, type SliceProbePos, type SliceUpdate } from '../../../render/slice/types';
import { formatClock, formatDistance, formatNumber } from '../../format';
import { rampGradient, type ExternalLegend } from '../../legends';

// ─────────────────────────────────────────────────────────────────────────────
// Layout: the canvas is a fixed box, the picture inside it follows the vertical exaggeration where it fits
// ─────────────────────────────────────────────────────────────────────────────

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Everything drawing and hit testing need to agree on (CSS px). The plot is exactly the area the slice covers. */
export interface PlotLayout {
  width: number;
  height: number;
  plot: Box;
  /** The slice: metres along the line, and the height range in metres above sea level. */
  length: number;
  zMin: number;
  zMax: number;
  /** CSS px per metre along the line and per metre of height. */
  pxPerM: number;
  pxPerMZ: number;
  /** What the picture really shows: vertical over horizontal scale (1 is true scale). Never the slider's value when the box limits it. */
  ratio: number;
  /** The box was too short for the asked-for exaggeration, so the height was fitted to it. */
  fitted: boolean;
}

export interface LayoutInput {
  width: number;
  height: number;
  length: number;
  zMin: number;
  zMax: number;
  /** `LayerState.verticalExaggeration`, 1 to 3. */
  exaggeration: number;
  /** The canvas text size (CSS px): the margins grow with it. */
  smallPx: number;
  /** The measured width (CSS px) of the widest height label, so the left margin always holds it; absent: estimated from the text size. */
  labelW?: number;
}

const PAD_R = 12;
const PAD_T = 8;
/** The least canvas height worth drawing: a very long, low slice at true scale is a thin strip, and the rest of the box stays empty. */
const BOX_MIN = 120;
const EXAGGERATION_MIN = 1;
const EXAGGERATION_MAX = 3;

/** The room under the plot for the distance axis (tick marks and their labels). */
const axisHeight = (small: number): number => Math.ceil(small + 12);

const fin = (v: number, fallback: number): number => (Number.isFinite(v) ? v : fallback);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * The plot rectangle. The width always holds the whole line. The height is drawn at the TRUE ratio times the slider where it
 * fits in the box (anchored on the distance axis, so a short slice leaves empty room above it), else the whole box is used
 * and the picture is stretched less than asked: `ratio` says what is on screen, and the caption quotes it.
 */
export function plotLayout(i: LayoutInput): PlotLayout {
  const width = Math.max(1, fin(i.width, 1));
  const height = Math.max(1, fin(i.height, 1));
  const small = fin(i.smallPx, 12);
  const padL = Math.max(44, Math.ceil(fin(i.labelW ?? 0, 0)) + 10, Math.ceil(small * 4.2)); // room for "1,500 m" and a gap
  const axisH = axisHeight(small);
  const availW = Math.max(8, width - padL - PAD_R);
  const availH = Math.max(8, height - PAD_T - axisH);
  const length = Math.max(1, fin(i.length, 1));
  const zMin = fin(i.zMin, 0);
  const range = Math.max(1, fin(i.zMax, zMin + 1) - zMin);
  const ex = clamp(fin(i.exaggeration, 1), EXAGGERATION_MIN, EXAGGERATION_MAX);
  const pxPerM = availW / length;
  let pxPerMZ = pxPerM * ex;
  let h = range * pxPerMZ;
  let fitted = false;
  if (h > availH) {
    pxPerMZ = availH / range;
    h = availH;
    fitted = true;
  }
  return {
    width,
    height,
    plot: { x: padL, y: PAD_T + (availH - h), w: availW, h },
    length,
    zMin,
    zMax: zMin + range,
    pxPerM,
    pxPerMZ,
    ratio: pxPerMZ / pxPerM,
    fitted,
  };
}

/**
 * The canvas height (CSS px) that holds the picture at the asked-for ratio with no empty band above it: the top margin, the plot
 * at `ratio = slider` and the distance axis. A long line, or a low slice, at true scale is shorter than the box. The panel sets
 * the canvas to this height and the stylesheet caps it at the full box, so where the box is the limit (a short line, a tall
 * range or a big slider) the cap applies and the picture is fitted to it as `plotLayout` says.
 */
export function naturalBoxHeight(i: Omit<LayoutInput, 'height'>): number {
  const tall = plotLayout({ ...i, height: 1e6 });
  return Math.max(BOX_MIN, Math.ceil(PAD_T + tall.plot.h + axisHeight(fin(i.smallPx, 12))));
}

/** Pixel of a distance from A (m) and of a height (m ASL). */
export const xOfS = (l: PlotLayout, s: number): number => l.plot.x + (s / l.length) * l.plot.w;
export const yOfZ = (l: PlotLayout, z: number): number => l.plot.y + l.plot.h - (z - l.zMin) * l.pxPerMZ;

/** The other way, clamped into the slice: a press outside the plot still reads the nearest edge. */
export const sOfX = (l: PlotLayout, x: number): number => clamp((x - l.plot.x) / l.plot.w, 0, 1) * l.length;
export const zOfY = (l: PlotLayout, y: number): number => clamp(l.zMin + (l.plot.y + l.plot.h - y) / l.pxPerMZ, l.zMin, l.zMax);

/** A press at canvas pixel (x, y) as a probe position. */
export function pickPos(l: PlotLayout, x: number, y: number): SliceProbePos {
  return { s: sOfX(l, x), z: zOfY(l, y) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Axes
// ─────────────────────────────────────────────────────────────────────────────

export interface Tick {
  value: number;
  /** Pixel position along its axis (x for distance, y for height). */
  pos: number;
  label: string;
}

/** `niceTicks` of src/render/slice/niceTicks.ts (passed in, so this file has no value import from another lane). */
export type TickFn = (lo: number, hi: number, target?: number) => { values: number[]; step: number };

/**
 * Height ticks (m above sea level) and distance ticks (m or km from A). Distance labels within 22 px of an end are left out:
 * the ends carry the letters A and B instead.
 */
export function axisTicks(l: PlotLayout, ticks: TickFn, smallPx: number): { height: Tick[]; distance: Tick[] } {
  const height = ticks(l.zMin, l.zMax, clamp(Math.round(l.plot.h / (smallPx * 3.2)), 2, 6)).values.map((v) => ({ value: v, pos: yOfZ(l, v), label: `${formatNumber(v)} m` }));
  const edge = 22;
  const distance = ticks(0, l.length, clamp(Math.round(l.plot.w / 64), 2, 6))
    .values.map((v) => ({ value: v, pos: xOfS(l, v), label: formatDistance(v) }))
    .filter((t) => t.pos - l.plot.x >= edge && l.plot.x + l.plot.w - t.pos >= edge);
  return { height, distance };
}

/** The words for the scale actually drawn (the ratio is what is on screen, not what the slider asks): for the caption and the screen reader. */
export function scaleCaption(ratio: number): string {
  const r = fin(ratio, 1);
  if (r >= 1.05) return `Heights are above sea level and stretched about ${formatNumber(r, 1)} times.`;
  if (r <= 0.95) return `Heights are above sea level and squashed to about ${formatNumber(r, 1)} of true scale.`;
  return 'Heights are above sea level, to the same scale as distance.';
}

/** The small tag on the height axis: "True scale", or "Height x1.5" (the stretch, or the squash below 1). */
export function scaleTag(ratio: number): string {
  const r = fin(ratio, 1);
  return r >= 1.05 || r <= 0.95 ? `Height ×${formatNumber(r, 1)}` : 'True scale';
}

/** What the dashed line is, and why the filled ground can show cliffs the dashed one does not. */
export const TERRAIN_CAPTION = 'Dashed line: the ground as the model sees it. Cliffs it smooths away show only in the filled ground.';

/** The tag needs room: it is left out of a plot too small to carry it (the short landscape panel). */
export function showsScaleTag(l: PlotLayout): boolean {
  return l.plot.h >= 100 && l.plot.w >= 200;
}

// ─────────────────────────────────────────────────────────────────────────────
// Colour: the field raster and the model cells
// ─────────────────────────────────────────────────────────────────────────────

/** What `sliceFieldScale(field)` of render/palette.ts gives (the panel's raster and the curtain colour with the same one). */
export interface ColourScale {
  ramp: Ramp;
  lo: number;
  hi: number;
}

export interface Lut {
  /** RGBA bytes, `size` entries. */
  rgba: Uint8Array;
  /** The same colours as CSS strings, for fillStyle. */
  styles: string[];
  lo: number;
  hi: number;
  size: number;
}

export function makeLut(scale: ColourScale, size = 256): Lut {
  const rgba = rampLut(scale.ramp, scale.lo, scale.hi, size);
  const styles: string[] = [];
  for (let i = 0; i < size; i++) styles.push(`rgb(${rgba[i * 4]},${rgba[i * 4 + 1]},${rgba[i * 4 + 2]})`);
  return { rgba, styles, lo: scale.lo, hi: scale.hi, size };
}

/** Entry of a LUT for a value, clamped to the ends; -1 for a value that is not a number. */
export function lutIndex(lut: Lut, v: number): number {
  if (!Number.isFinite(v)) return -1;
  const span = lut.hi - lut.lo;
  const f = span > 0 ? (v - lut.lo) / span : 0;
  return Math.round(clamp(f, 0, 1) * (lut.size - 1));
}

export interface Raster {
  width: number;
  height: number;
  /** RGBA, image row 0 at the TOP (the highest lattice row). Cells outside the model are transparent. */
  rgba: Uint8ClampedArray;
}

/** The lattice of one field as an image, coloured by the LUT. `out` of the same size is refilled. */
export function rasterize(data: SliceData, field: SliceFieldId, lut: Lut, out?: Raster | null): Raster {
  const { columns, rows } = data;
  const r = out && out.width === columns && out.height === rows ? out : { width: columns, height: rows, rgba: new Uint8ClampedArray(columns * rows * 4) };
  const values = data.values[field];
  const valid = data.valid;
  for (let row = 0; row < rows; row++) {
    const imgRow = rows - 1 - row;
    for (let c = 0; c < columns; c++) {
      const k = row * columns + c;
      const o = (imgRow * columns + c) * 4;
      const idx = valid[k] ? lutIndex(lut, values[k]!) : -1;
      if (idx < 0) {
        r.rgba[o + 3] = 0;
        continue;
      }
      r.rgba[o] = lut.rgba[idx * 4]!;
      r.rgba[o + 1] = lut.rgba[idx * 4 + 1]!;
      r.rgba[o + 2] = lut.rgba[idx * 4 + 2]!;
      r.rgba[o + 3] = 255;
    }
  }
  return r;
}

/**
 * Where the raster goes: each lattice point is the CENTRE of its pixel, so the image reaches half a lattice step beyond the
 * line's ends and the first and last heights, and the plot clips it.
 */
export function rasterBox(l: PlotLayout, columns: number, rows: number): Box {
  const dx = columns > 1 ? l.plot.w / (columns - 1) : l.plot.w;
  const dy = rows > 1 ? l.plot.h / (rows - 1) : l.plot.h;
  return { x: l.plot.x - dx / 2, y: l.plot.y - dy / 2, w: dx * columns, h: dy * rows };
}

// ─────────────────────────────────────────────────────────────────────────────
// Streaks and arrows
// ─────────────────────────────────────────────────────────────────────────────

/** About 300 particles, drawn at most 24 times a second (plan §8.5). */
export const FLOW_COUNT = 300;
export const FLOW_FRAME_S = 1 / 24;
/** A display frame may come this early (the clock is rounded to a tenth of a millisecond) and still count as the next streak frame. */
const FLOW_FRAME_SLACK_S = 0.0005;

/** The streaks' clock: the time of the last display frame and the seconds gathered since the last streak frame was drawn. */
export interface FlowClock {
  last: number;
  acc: number;
}

/**
 * One display frame at `tMs` (the `requestAnimationFrame` time): the seconds to step the particles by when it is time for the next streak
 * frame, else 0 (skip it). At most 24 streak frames a second on any display (60 Hz draws 20, 144 Hz and 120 Hz 24). A skipped frame keeps
 * its time, so a frame that is drawn steps by all of it (at most 0.1 s, so a tab that was away does not fling the particles).
 */
export function flowTick(c: FlowClock, tMs: number): number {
  c.acc += c.last ? (tMs - c.last) / 1000 : 0;
  c.last = tMs;
  if (c.acc < FLOW_FRAME_S - FLOW_FRAME_SLACK_S) return 0;
  const dt = Math.min(c.acc, 0.1);
  c.acc = 0;
  return dt;
}
/** A particle lives this many seconds of the panel's clock before it is re-seeded: longer than the 8 s a 10 m/s wind takes to cross the line (`flowTimeScale`). */
export const FLOW_LIFE_S = 12;

/** Streaks for a plot: 300 on a full portrait panel, fewer on a small one (about one per 190 square px), never fewer than 60. */
export function flowCount(l: PlotLayout): number {
  return Math.min(FLOW_COUNT, Math.max(60, Math.round((l.plot.w * l.plot.h) / 190)));
}

/** Air seconds per real second: a particle in a 10 m/s wind crosses the whole line in about 8 s, whatever the line's length. */
export function flowTimeScale(lengthM: number): number {
  return Math.max(1, fin(lengthM, 0) / 80);
}

/**
 * The `exaggeration` handed to `stepFlow`. The particles live in metres (s, z) and the plot draws a metre of height
 * `ratio` times as long as a metre of distance, so a parcel that rises `w` metres while it moves `u` metres along already
 * appears on screen with the slope `ratio * w / u`, which is the slope of the exaggerated ground it flows over. The on-screen
 * ratio therefore goes into the DRAWING (yOfZ), and the particles take 1: giving `stepFlow` the ratio as well would count it
 * twice and make streaks climb `ratio` times steeper than the ground they follow (checked in slicePanelFlow.test.ts).
 */
export function streakExaggeration(_l: PlotLayout): number {
  return 1;
}

/** What the streaks need of a slice to tell "the same picture a moment later" from "another line": the lattice, the ends of the line and the height range. */
export interface FlowSlice {
  columns: number;
  rows: number;
  a: [number, number];
  b: [number, number];
  zMin: number;
  zMax: number;
}

export function flowSlice(data: SliceData): FlowSlice {
  return { columns: data.columns, rows: data.rows, a: [data.line.a[0], data.line.a[1]], b: [data.line.b[0], data.line.b[1]], zMin: data.zMin, zMax: data.zMax };
}

/** The ends of a line may move this far (a share of its length) from one update to the next and the particles still go on: a live preset follows the fire. */
const FLOW_DRIFT_SHARE = 0.1;
/** The height range may move this far (m) in the same way (the lowest and highest ground under a sliding line change). */
const FLOW_DRIFT_Z_M = 150;

/**
 * Same lattice, ends within a tenth of the line and heights within 150 m of the last update: the particles keep going through the new
 * air. Anything else (nothing before, another lattice, a line put somewhere else) is seeded afresh. The particles live in slice
 * coordinates, so a few metres of drift costs nothing, while seeding at every update would restart the streaks up to four times a second
 * whenever "Along the wind" or "Me to fire" follows a moving fire.
 */
export function sameFlowSlice(prev: FlowSlice | null, now: FlowSlice): boolean {
  if (!prev || prev.columns !== now.columns || prev.rows !== now.rows) return false;
  const length = Math.hypot(now.b[0] - now.a[0], now.b[1] - now.a[1]);
  const reach = FLOW_DRIFT_SHARE * length;
  return (
    Math.hypot(now.a[0] - prev.a[0], now.a[1] - prev.a[1]) <= reach &&
    Math.hypot(now.b[0] - prev.b[0], now.b[1] - prev.b[1]) <= reach &&
    Math.abs(now.zMin - prev.zMin) <= FLOW_DRIFT_Z_M &&
    Math.abs(now.zMax - prev.zMax) <= FLOW_DRIFT_Z_M
  );
}

/** The static arrow lattice used under reduced motion: about one arrow per 34 x 30 px. */
export function arrowGrid(l: PlotLayout): { cols: number; rows: number } {
  return { cols: Math.max(2, Math.round(l.plot.w / 34)), rows: Math.max(2, Math.round(l.plot.h / 30)) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Words
// ─────────────────────────────────────────────────────────────────────────────

/** "air from 14:05", and how much older than the picture it is once that passes `AIR_STALE_S` ("4 min before the time shown"). */
export function airFromText(airTime: number | null, shownTime: number, tz: string, absTime: (t: number) => number): string {
  if (airTime === null || !Number.isFinite(airTime)) return 'air time not recorded';
  const base = `air from ${formatClock(absTime(airTime), tz)}`;
  const age = Math.max(0, shownTime - airTime);
  return age > AIR_STALE_S ? `${base} (${Math.max(1, Math.round(age / 60))} min before the time shown)` : base;
}

/** The footer, as its three parts: the kind of air, the model grid and the age of the air (§8.1 "Honest footer"). */
export function footerParts(info: SliceFooterInfo, tz: string, absTime: (t: number) => number): [string, string, string] {
  return [SLICE_KIND_LABEL[info.kind], `model grid ${formatNumber(Math.round(info.cellSizeM))} m`, airFromText(info.airTime, info.shownTime, tz, absTime)];
}

export function footerText(info: SliceFooterInfo, tz: string, absTime: (t: number) => number): string {
  return footerParts(info, tz, absTime).join(' · ');
}

/** A piece of the footer; `keep: false` pieces are the ones a one-line footer on a short screen drops (CSS hides them). */
export interface FooterRun {
  text: string;
  keep: boolean;
}

/** The footer as runs: the same words as `footerText`, with the explanations that can go marked, so a short screen still says kind, grid and age. */
export function footerRuns(info: SliceFooterInfo, tz: string, absTime: (t: number) => number): FooterRun[] {
  const [kind, grid, air] = footerParts(info, tz, absTime);
  const [head, more] = splitKindLabel(kind);
  const gridWords = grid.startsWith('model ') ? ['model ', grid.slice(6)] : ['', grid];
  const runs: FooterRun[] = [
    { text: head, keep: true },
    { text: more, keep: false },
    { text: ' · ', keep: true },
    { text: gridWords[0]!, keep: false },
    { text: gridWords[1]!, keep: true },
    { text: ' · ', keep: true },
    { text: air, keep: true },
  ];
  return runs.filter((r) => r.text !== '');
}

/** The kind of air in two parts, "Diagnosed wind" and ": terrain effects only", so a short landscape screen can keep the first on one line. */
export function splitKindLabel(label: string): [string, string] {
  const i = label.indexOf(':');
  return i < 0 ? [label, ''] : [label.slice(0, i), label.slice(i)];
}

export interface ChipView {
  id: SliceFieldId;
  label: string;
  name: string;
  selected: boolean;
  available: boolean;
  /** The words of a chip that cannot be used (verbatim from the scene), else null. */
  reason: string | null;
  use3d: boolean;
}

/** The six chips in their order, each with whether it can be used on this air. No status yet means every chip is open. */
export function chipModel(fields: Record<SliceFieldId, SliceFieldStatus> | null | undefined, selected: SliceFieldId): ChipView[] {
  return SLICE_FIELDS.map((f) => {
    const st = fields?.[f.id];
    const off = st && !st.ok ? st : null;
    return { id: f.id, label: f.label, name: f.name, selected: f.id === selected, available: !off, reason: off ? off.reason : null, use3d: off?.action === 'use-3d' };
  });
}

export interface DisabledNote {
  /** The scene's words for why chips are off, verbatim (they already name the field). */
  reason: string;
  /** The chips they are about, by label (for tests and the screen reader's description). */
  labels: string[];
  use3d: boolean;
}

/** One note per distinct reason, in chip order, each shown as the scene wrote it. */
export function disabledNotes(chips: readonly ChipView[]): DisabledNote[] {
  const notes: DisabledNote[] = [];
  for (const c of chips) {
    if (c.available || !c.reason) continue;
    const same = notes.find((n) => n.reason === c.reason);
    if (same) {
      same.labels.push(c.label);
      same.use3d = same.use3d || c.use3d;
    } else notes.push({ reason: c.reason, labels: [c.label], use3d: c.use3d });
  }
  return notes;
}

export type EmptyKind = 'no-line' | 'too-short' | 'outside' | 'no-wind';

/** What the canvas says when there is nothing to draw, or null when there is a slice. */
export function emptyState(update: SliceUpdate | null): { kind: EmptyKind; text: string } | null {
  if (update?.data) return null;
  if (!update || !update.resolved.line) {
    const issue = update?.resolved.issue;
    if (issue === 'too-short') return { kind: 'too-short', text: 'That line is too short to show.' };
    if (issue === 'outside-model') return { kind: 'outside', text: 'That line is outside the model area.' };
    return { kind: 'no-line', text: 'Choose a preset, or set A and B.' };
  }
  return { kind: 'no-wind', text: 'There is no 3-D wind to show yet. The air picture appears once the simulation has run a few steps.' };
}

/** The canvas's text alternative (a screen reader hears this, then the readout when there is a probe). */
export function canvasLabel(data: SliceData | null, fieldName: string): string {
  if (!data) return 'Side view of the air. There is no slice to show yet.';
  return `Side view of the air along a ${formatDistance(data.line.length)} line from A to B, coloured by ${fieldName.toLowerCase()}. The arrow keys move a probe that reads the air at a point; Escape clears it.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Legend
// ─────────────────────────────────────────────────────────────────────────────

export interface LegendView {
  title: string;
  /** A CSS gradient for a continuous legend, else null. */
  gradient: string | null;
  /** Labels along the bar (continuous), spread evenly. */
  ends: string[];
  /** Swatches (classes). */
  classes: { colour: string; label: string }[];
}

/** Up to `max` labels spread over the entries, always the first and the last. */
export function spreadLabels(labels: readonly string[], max: number): string[] {
  const n = labels.length;
  if (n <= max) return [...labels];
  const out: string[] = [];
  for (let i = 0; i < max; i++) out.push(labels[Math.round((i * (n - 1)) / (max - 1))]!);
  return out;
}

/** The compact legend of a chip: a bar with its labels, or swatches. null when the scene gave none. */
export function legendView(ext: ExternalLegend | null | undefined): LegendView | null {
  if (!ext || !ext.entries.length) return null;
  const title = ext.units ? `${ext.title} (${ext.units})` : ext.title;
  if (ext.kind === 'continuous') {
    return { title, gradient: ext.gradient ?? rampGradient(ext.entries), ends: spreadLabels(ext.entries.map((e) => e.label), 5), classes: [] };
  }
  const classes = ext.entries.map((e) => ({ colour: e.colour, label: e.label }));
  if (ext.noData) classes.push({ colour: ext.noData.colour, label: ext.noData.label });
  return { title, gradient: null, ends: [], classes };
}
