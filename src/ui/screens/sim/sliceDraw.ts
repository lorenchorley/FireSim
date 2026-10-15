/**
 * Canvas 2-D drawing of the side-view panel (Air Slice, plan §8.5). Every function takes the context and plain numbers, so a
 * test runs them against a stub context; none reads the DOM. The panel (slicePanel.ts) draws the still layers once per update
 * into a buffer (`paintStatic`), the streaks into a second buffer that fades (`fadeTrail`, `drawStreaks`), and puts the two
 * and the probe together every frame.
 */
import type { SliceData, SliceFieldId, SliceProbePos } from '../../../render/slice/types';
import { lutIndex, rasterBox, xOfS, yOfZ, type Lut, type PlotLayout, type Tick } from './slicePanelModel';

/** The 2-D context, whole: a stub in a test, the canvas's own in the app. */
export type Ctx = CanvasRenderingContext2D;

/** Token colours, read once per theme change by the panel (`getComputedStyle`), as in drawWeatherChart. */
export interface DrawColours {
  ink: string;
  muted: string;
  grid: string;
  surface: string;
  outline: string;
  /** The filled ground, opaque, and the earth tone laid over it. */
  ground: string;
  groundTint: string;
}

export interface DrawFont {
  /** A CSS font shorthand for the axis text, from --fs-xs and --font. */
  small: string;
  smallPx: number;
}

/** What the still layers need. `raster` is the lattice as an image (null before the first one is made). */
export interface StaticView {
  layout: PlotLayout;
  data: SliceData;
  field: SliceFieldId;
  colours: DrawColours;
  font: DrawFont;
  heightTicks: Tick[];
  distanceTicks: Tick[];
  raster: CanvasImageSource | null;
  /** Colours of the field, used for the model cells. */
  lut: Lut;
  /** Draw the model's own cells (nearest neighbour) instead of the smoothed lattice. */
  showCells: boolean;
}

const ok = (...v: number[]): boolean => v.every(Number.isFinite);

/** The ground under the line, as the model sees it and as the 10 m map has it, and the field between, clipped to the plot. */
export function paintStatic(ctx: Ctx, v: StaticView): void {
  const l = v.layout;
  ctx.clearRect(0, 0, l.width, l.height);
  ctx.save();
  ctx.beginPath();
  ctx.rect(l.plot.x, l.plot.y, l.plot.w, l.plot.h);
  ctx.clip();
  drawField(ctx, v);
  drawGround(ctx, v);
  ctx.restore();
  drawAxes(ctx, v);
}

/** The field: the smoothed lattice, or the model's own cells (or the lattice without smoothing when the line crosses none). */
export function drawField(ctx: Ctx, v: StaticView): void {
  const { layout: l, data } = v;
  if (v.showCells && data.cells && data.cells.count > 0) {
    drawCells(ctx, v);
    return;
  }
  if (!v.raster) return;
  const b = rasterBox(l, data.columns, data.rows);
  if (!ok(b.x, b.y, b.w, b.h)) return;
  ctx.imageSmoothingEnabled = !v.showCells;
  ctx.drawImage(v.raster, b.x, b.y, b.w, b.h);
}

/** One block per model cell the line crosses and per model level, in the model's own value. Heights follow the terrain, so the steps differ column to column. */
export function drawCells(ctx: Ctx, v: StaticView): void {
  const { layout: l, data, field, lut } = v;
  const cells = data.cells;
  if (!cells) return;
  const values = cells.values[field];
  const per = cells.levels + 1;
  ctx.beginPath();
  for (let c = 0; c < cells.count; c++) {
    const x0 = xOfS(l, cells.edges[c]!);
    const x1 = xOfS(l, cells.edges[c + 1]!);
    for (let k = 0; k < cells.levels; k++) {
      const y1 = yOfZ(l, cells.zEdges[c * per + k]!); // the lower boundary: the larger pixel y
      const y0 = yOfZ(l, cells.zEdges[c * per + k + 1]!);
      const val = values[c * cells.levels + k]!;
      const idx = lutIndex(lut, val);
      if (idx < 0 || !ok(x0, x1, y0, y1)) continue;
      ctx.fillStyle = lut.styles[idx]!;
      ctx.fillRect(x0, y0, x1 - x0 + 0.5, y1 - y0 + 0.5);
      ctx.rect(x0, y0, x1 - x0, y1 - y0);
    }
  }
  ctx.strokeStyle = v.colours.ink;
  ctx.globalAlpha = 0.22;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** Path of the 10 m ground under the line: [x, y] pixels per column, skipping any that are not numbers. */
function groundPoints(l: PlotLayout, heights: Float32Array, columns: number): number[] {
  const pts: number[] = [];
  for (let c = 0; c < columns; c++) {
    const x = xOfS(l, (c / Math.max(1, columns - 1)) * l.length);
    const y = yOfZ(l, heights[c]!);
    if (ok(x, y)) pts.push(x, y);
  }
  return pts;
}

/** The filled ground (10 m map), its edge, and the model's own smoothed ground as a faint dashed line. */
export function drawGround(ctx: Ctx, v: StaticView): void {
  const { layout: l, data, colours } = v;
  const pts = groundPoints(l, data.ground, data.columns);
  const bottom = l.plot.y + l.plot.h + 2;
  if (pts.length >= 4) {
    ctx.beginPath();
    ctx.moveTo(pts[0]!, bottom);
    for (let i = 0; i < pts.length; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!);
    ctx.lineTo(pts[pts.length - 2]!, bottom);
    ctx.closePath();
    ctx.fillStyle = colours.ground;
    ctx.fill();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = colours.groundTint;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 2) {
      if (i === 0) ctx.moveTo(pts[0]!, pts[1]!);
      else ctx.lineTo(pts[i]!, pts[i + 1]!);
    }
    ctx.lineWidth = 1.75;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = colours.ink;
    ctx.stroke();
  }
  const model = groundPoints(l, data.modelGround, data.columns);
  if (model.length >= 4) {
    ctx.beginPath();
    for (let i = 0; i < model.length; i += 2) {
      if (i === 0) ctx.moveTo(model[0]!, model[1]!);
      else ctx.lineTo(model[i]!, model[i + 1]!);
    }
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = colours.ink;
    ctx.globalAlpha = 0.75;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  }
}

/** Height ticks and faint grid lines on the left, distance ticks, A and B along the bottom. */
export function drawAxes(ctx: Ctx, v: StaticView): void {
  const { layout: l, colours, font } = v;
  const right = l.plot.x + l.plot.w;
  const bottom = l.plot.y + l.plot.h;
  ctx.font = font.small;
  // Height ticks: a hairline across the plot, the label to the left.
  ctx.strokeStyle = colours.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const t of v.heightTicks) {
    if (!ok(t.pos)) continue;
    const y = Math.round(t.pos) + 0.5;
    ctx.moveTo(l.plot.x, y);
    ctx.lineTo(right, y);
  }
  ctx.stroke();
  ctx.fillStyle = colours.muted;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const t of v.heightTicks) if (ok(t.pos)) ctx.fillText(t.label, l.plot.x - 6, t.pos);
  // The distance axis: a line along the bottom with a tick and a label per step, then A and B at the ends.
  ctx.strokeStyle = colours.outline;
  ctx.beginPath();
  ctx.moveTo(l.plot.x, bottom + 0.5);
  ctx.lineTo(right, bottom + 0.5);
  for (const t of v.distanceTicks) {
    if (!ok(t.pos)) continue;
    ctx.moveTo(Math.round(t.pos) + 0.5, bottom);
    ctx.lineTo(Math.round(t.pos) + 0.5, bottom + 4);
  }
  ctx.stroke();
  ctx.fillStyle = colours.muted;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const t of v.distanceTicks) if (ok(t.pos)) ctx.fillText(t.label, t.pos, bottom + 5);
  ctx.fillStyle = colours.ink;
  ctx.textAlign = 'left';
  ctx.fillText('A', l.plot.x, bottom + 5);
  ctx.textAlign = 'right';
  ctx.fillText('B', right, bottom + 5);
}

/** The axis tag ("True scale", "Height x1.5"): a small label in the top-left corner of the plot, on the surface colour so it reads over any field colour. Drawn last, over the streaks. */
export function drawScaleTag(ctx: Ctx, l: PlotLayout, colours: DrawColours, font: DrawFont, label: string): boolean {
  const pad = 5;
  const h = Math.ceil(font.smallPx + 8);
  ctx.font = font.small;
  const w = ctx.measureText(label).width + pad * 2;
  if (!ok(w, l.plot.x, l.plot.y)) return false;
  ctx.save();
  ctx.globalAlpha = 0.88;
  ctx.fillStyle = colours.surface;
  ctx.fillRect(l.plot.x + 4, l.plot.y + 4, w, h);
  ctx.globalAlpha = 1;
  ctx.fillStyle = colours.ink;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, l.plot.x + 4 + pad, l.plot.y + 4 + h / 2 + 0.5);
  ctx.restore();
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Moving layers
// ─────────────────────────────────────────────────────────────────────────────

/** Particles as the flow module keeps them (src/render/slice/flow2d.ts FlowParticles). */
export interface Streaks {
  count: number;
  s: ArrayLike<number>;
  z: ArrayLike<number>;
  ps: ArrayLike<number>;
  pz: ArrayLike<number>;
}

/** Fade what the trail buffer holds a little, so a streak is a tail of its last few steps. */
export function fadeTrail(ctx: Ctx, width: number, height: number, alpha = 0.14): void {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

/** A particle that jumps further than this in one step was re-seeded: no streak across the plot. */
const MAX_STEP_PX = 40;

/** This step of every particle, from where it was to where it is, ink over a halo of the surface colour so it reads on any field colour. */
export function drawStreaks(ctx: Ctx, l: PlotLayout, f: Streaks, colours: DrawColours): number {
  ctx.save();
  ctx.beginPath();
  ctx.rect(l.plot.x, l.plot.y, l.plot.w, l.plot.h);
  ctx.clip();
  ctx.lineCap = 'butt'; // round caps would double the colour where one step's segment meets the next
  ctx.beginPath();
  let n = 0;
  for (let i = 0; i < f.count; i++) {
    const x0 = xOfS(l, f.ps[i]!);
    const y0 = yOfZ(l, f.pz[i]!);
    const x1 = xOfS(l, f.s[i]!);
    const y1 = yOfZ(l, f.z[i]!);
    if (!ok(x0, y0, x1, y1) || Math.hypot(x1 - x0, y1 - y0) > MAX_STEP_PX) continue;
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    n++;
  }
  ctx.strokeStyle = colours.surface;
  ctx.globalAlpha = 0.4;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.strokeStyle = colours.ink;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();
  return n;
}

/** The lattice of arrows under reduced motion (flowArrows of flow2d): length from 10 px in a light wind to 18 px in a strong one. */
export interface Arrows {
  count: number;
  s: ArrayLike<number>;
  z: ArrayLike<number>;
  angle: ArrayLike<number>;
  speed: ArrayLike<number>;
}

export function drawArrows(ctx: Ctx, l: PlotLayout, a: Arrows, colours: DrawColours): number {
  const HEAD = 4.5;
  ctx.save();
  ctx.beginPath();
  ctx.rect(l.plot.x, l.plot.y, l.plot.w, l.plot.h);
  ctx.clip();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  let n = 0;
  for (let i = 0; i < a.count; i++) {
    const cx = xOfS(l, a.s[i]!);
    const cy = yOfZ(l, a.z[i]!);
    const ang = a.angle[i]!;
    if (!ok(cx, cy, ang)) continue;
    const half = (10 + Math.min(8, Math.max(0, a.speed[i] ?? 0) * 0.7)) / 2;
    const dx = Math.cos(ang); // screen y points down, the angle runs anticlockwise from +s
    const dy = -Math.sin(ang);
    const tx = cx + dx * half;
    const ty = cy + dy * half;
    ctx.moveTo(cx - dx * half, cy - dy * half);
    ctx.lineTo(tx, ty);
    for (const side of [-1, 1]) {
      const back = ang + Math.PI + side * 0.5;
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx + Math.cos(back) * HEAD, ty - Math.sin(back) * HEAD);
    }
    n++;
  }
  ctx.strokeStyle = colours.surface;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.strokeStyle = colours.ink;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 1.75;
  ctx.stroke();
  ctx.restore();
  return n;
}

/** The probe: dotted guides to both axes and a ring with a halo. `pos` is the position the reading came back with (clamped into the slice). */
export function drawProbe(ctx: Ctx, l: PlotLayout, pos: SliceProbePos, colours: DrawColours): boolean {
  const x = xOfS(l, pos.s);
  const y = yOfZ(l, pos.z);
  if (!ok(x, y)) return false;
  const bottom = l.plot.y + l.plot.h;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = colours.ink;
  ctx.globalAlpha = 0.6;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, bottom);
  ctx.moveTo(x, y);
  ctx.lineTo(l.plot.x, y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, 2 * Math.PI);
  ctx.strokeStyle = colours.surface;
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.strokeStyle = colours.ink;
  ctx.lineWidth = 2.25;
  ctx.stroke();
  ctx.restore();
  return true;
}
