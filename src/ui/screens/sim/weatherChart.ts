/**
 * Weather timeline (Weather tab): small multiples on a shared time axis — wind speed (with direction arrows),
 * temperature, relative humidity and dead fine fuel (litter) moisture — so each measure has its own single axis.
 * A "now" cursor and any upcoming wind change are drawn across all panels. Tap or drag to read values at a time.
 * Everything visual comes from the design tokens (font, type sizes and weights, --chart-* series colours, grid, danger,
 * surface and text), so the chart follows the light, dark and high-contrast themes and the text size.
 */
import type { WeatherHour, WeatherSeries } from '../../../core/types';
import { DEG, msToKmh } from '../../../core/units';
import { formatClock, localHour, compassName, type SpeedUnit } from '../../format';
import { deadFuelMoisture, moisturePeriod, type WindChange } from '../../weatherCalc';
import { sampleSeries, weatherAt } from '../../weatherSeries';

export interface ChartInput {
  series: WeatherSeries;
  /** Scenario start (unix ms) and duration (s). */
  start: number;
  duration: number;
  viewTime: number;
  tz: string;
  units: SpeedUnit;
  changes: WindChange[];
  /** Mean litter moisture from snapshots (model values). */
  moistureObs: { time: number; value: number }[];
  /** Time (s) the user is inspecting, or null. */
  inspect: number | null;
}

interface PanelDef {
  key: 'wind' | 'temp' | 'rh' | 'moist';
  title: string;
  unit: string;
  colourVar: string;
  value: (w: WeatherHour, t: number) => number;
  fixedMin?: number;
  fixedMax?: number;
}

const PAD_R = 12;
/** Plot height of each panel (CSS px). */
const PANEL_H = 60;
const GAP = 10;
const ARROW_H = 22;

/** Type the chart draws with, read from the tokens (so high contrast and a larger text size apply). */
interface ChartType {
  family: string;
  /** Titles: --fs-sm / --fw-medium. */
  title: string;
  /** Axis labels, readouts: --fs-xs / --fw-regular. */
  small: string;
  titlePx: number;
  smallPx: number;
}

function chartType(el: Element): ChartType {
  const cs = getComputedStyle(el);
  const num = (name: string, fallback: number): number => {
    const v = parseFloat(cs.getPropertyValue(name));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  const family = cs.getPropertyValue('--font').trim() || 'system-ui, sans-serif';
  const titlePx = num('--fs-sm', 14);
  const smallPx = num('--fs-xs', 12);
  const medium = cs.getPropertyValue('--fw-medium').trim() || '500';
  const regular = cs.getPropertyValue('--fw-regular').trim() || '400';
  return { family, title: `${medium} ${titlePx}px ${family}`, small: `${regular} ${smallPx}px ${family}`, titlePx, smallPx };
}

/** Layout (CSS px) for a type size: a row for wind-change labels, then per panel a title row, (wind only) a direction-arrow
 * strip, and the plot; a gap between panels; the time axis at the bottom. Rows grow with the text. */
function chartLayout(t: Pick<ChartType, 'titlePx' | 'smallPx'>): { padL: number; changeRow: number; titleH: number; axisH: number; plotTop(i: number): number; height: number } {
  const changeRow = Math.ceil(t.smallPx + 12);
  const titleH = Math.ceil(t.titlePx + 8);
  const axisH = Math.ceil(t.smallPx + 10);
  const plotTop = (i: number): number => changeRow + titleH + ARROW_H + i * (PANEL_H + GAP + titleH);
  return { padL: Math.max(40, Math.ceil(t.smallPx * 3.3)), changeRow, titleH, axisH, plotTop, height: plotTop(3) + PANEL_H + axisH };
}

/** Height (CSS px) the chart needs with the current type size (read from `el`, else the document root). */
export function chartHeight(el?: Element): number {
  const root = el ?? (typeof document !== 'undefined' ? document.documentElement : null);
  return chartLayout(root ? chartType(root) : { titlePx: 14, smallPx: 12 }).height;
}

/** Litter-moisture estimate from the hourly weather (Matthews 2010; no terrain/aspect adjustment). */
export function litterEstimate(w: WeatherHour, tz: string): number {
  return deadFuelMoisture(w.temperature, w.relativeHumidity, moisturePeriod(localHour(w.time, tz), w.cloudCover ?? 0));
}

function css(el: Element, name: string, fallback: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}

/** Nice step for an axis range. */
function niceStep(range: number, target = 3): number {
  const raw = range / target;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

/** Draw the chart into `canvas` (sized to its CSS box). Returns the x→time mapping for hit testing. */
export function drawWeatherChart(canvas: HTMLCanvasElement, inp: ChartInput): { timeAt(clientX: number): number } {
  const rect = canvas.getBoundingClientRect();
  const W = Math.max(280, rect.width);
  const type = chartType(canvas);
  const L = chartLayout(type);
  const PAD_L = L.padL;
  const plotTop = L.plotTop;
  const H = L.height;
  const dpr = Math.min(3, globalThis.devicePixelRatio || 1);
  // Only reallocate the backing store when the size changes (the chart redraws a few times a second while playing).
  const bw = Math.round(W * dpr);
  const bh = Math.round(H * dpr);
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;
  if (canvas.style.height !== `${H}px`) canvas.style.height = `${H}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const ink = css(canvas, '--text', '#202124');
  const muted = css(canvas, '--muted', '#5f6368');
  const grid = css(canvas, '--grid', 'rgba(32,33,36,0.12)');
  const surface = css(canvas, '--surface', '#ffffff');
  const outline = css(canvas, '--outline', '#80868b');
  const danger = css(canvas, '--danger', '#d93025');
  const dangerInk = css(canvas, '--danger-ink', danger);
  const onDanger = css(canvas, '--on-danger', '#ffffff');
  const font = type.title;
  const fontSmall = type.small;

  const t0 = inp.start;
  const t1 = inp.start + inp.duration * 1000;
  const x = (ms: number): number => PAD_L + ((ms - t0) / (t1 - t0)) * (W - PAD_L - PAD_R);
  const n = Math.max(24, Math.min(160, Math.round(inp.duration / 600)));
  const samples = sampleSeries(inp.series, t0, t1, n);
  const kmh = (ms: number): number => (inp.units === 'kmh' ? msToKmh(ms) : ms);
  const panels: PanelDef[] = [
    { key: 'wind', title: 'Wind', unit: inp.units === 'kmh' ? 'km/h' : 'm/s', colourVar: '--chart-wind', value: (w) => kmh(w.windSpeed10), fixedMin: 0 },
    { key: 'temp', title: 'Temperature', unit: '°C', colourVar: '--chart-temp', value: (w) => w.temperature },
    { key: 'rh', title: 'Humidity', unit: '%', colourVar: '--chart-rh', value: (w) => w.relativeHumidity, fixedMin: 0, fixedMax: 100 },
    { key: 'moist', title: 'Litter moisture', unit: '%', colourVar: '--chart-moist', value: (w) => litterEstimate(w, inp.tz), fixedMin: 0 },
  ];

  const panelSpans: [number, number][] = [];
  panels.forEach((p, pi) => {
    const top = plotTop(pi);
    const bottom = top + PANEL_H;
    const titleY = (pi === 0 ? top - ARROW_H : top) - 7;
    const vals = samples.map((w) => p.value(w, w.time));
    if (p.key === 'moist') for (const o of inp.moistureObs) vals.push(o.value);
    let lo = p.fixedMin ?? Math.min(...vals);
    let hi = p.fixedMax ?? Math.max(...vals);
    if (p.fixedMax === undefined) hi = hi + Math.max(1, (hi - lo) * 0.15);
    if (p.fixedMin === undefined) lo = lo - Math.max(1, (hi - lo) * 0.15);
    const step = niceStep(hi - lo, 2.2);
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    const y = (v: number): number => bottom - ((v - lo) / (hi - lo || 1)) * PANEL_H;
    const colour = css(canvas, p.colourVar, ink);

    // Title (text ink) + unit.
    ctx.fillStyle = ink;
    ctx.font = font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`${p.title} (${p.unit})`, PAD_L, titleY);

    // Grid + y labels.
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = muted;
    ctx.font = fontSmall;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let v = lo; v <= hi + 1e-9; v += step) {
      const yy = Math.round(y(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(PAD_L, yy);
      ctx.lineTo(W - PAD_R, yy);
      ctx.stroke();
      ctx.fillText(String(Math.round(v)), PAD_L - 6, yy);
    }
    // Fire-danger band for litter moisture below 6 %, labelled inside the band.
    if (p.key === 'moist') {
      ctx.fillStyle = css(canvas, '--band-dry', 'rgba(201,42,42,0.10)');
      ctx.fillRect(PAD_L, y(Math.min(6, hi)), W - PAD_L - PAD_R, bottom - y(Math.min(6, hi)));
      ctx.fillStyle = dangerInk;
      ctx.font = fontSmall;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('very dry (< 6 %)', PAD_L + 6, bottom - 5);
      if (inp.moistureObs.length) {
        // Legend for the two encodings (line = estimate from the weather, dots = model mean over the area).
        ctx.fillStyle = muted;
        ctx.textAlign = 'right';
        ctx.fillText('● model mean', W - PAD_R, titleY);
      }
    }
    // Series line (2 px).
    ctx.strokeStyle = colour;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    samples.forEach((w, i) => {
      const xx = x(w.time);
      const yy = y(p.value(w, w.time));
      if (i) ctx.lineTo(xx, yy);
      else ctx.moveTo(xx, yy);
    });
    ctx.stroke();
    if (p.key === 'wind') {
      // Soft area under the wind line.
      ctx.lineTo(x(t1), bottom);
      ctx.lineTo(x(t0), bottom);
      ctx.closePath();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = colour;
      ctx.fill();
      ctx.globalAlpha = 1;
      // Direction arrows (pointing where the wind blows) every ~hour along the top of the panel.
      const every = Math.max(1, Math.round(inp.duration / 3600 / Math.max(4, Math.floor((W - PAD_L) / 46))));
      for (let hh = 0; hh <= inp.duration / 3600 + 1e-6; hh += every) {
        const ms = t0 + hh * 3600_000;
        const w = weatherAt(inp.series, ms);
        drawArrow(ctx, x(ms), top - ARROW_H / 2, w.windDir10, ink, surface);
      }
    }
    if (p.key === 'moist' && inp.moistureObs.length) {
      ctx.fillStyle = colour;
      ctx.strokeStyle = surface;
      ctx.lineWidth = 2;
      let lastX = -Infinity;
      for (const o of inp.moistureObs) {
        const xx = x(t0 + o.time * 1000);
        if (xx - lastX < 14) continue; // thin to ≥ 14 px apart
        lastX = xx;
        ctx.beginPath();
        ctx.arc(xx, y(o.value), 4, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
      }
    }
    panelSpans.push([top, bottom]);
  });

  // X axis: hour labels.
  const axisY = plotTop(3) + PANEL_H + L.axisH - 5;
  ctx.fillStyle = muted;
  ctx.font = fontSmall;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const hours = inp.duration / 3600;
  const hStep = hours <= 3 ? 1 : hours <= 6 ? 1 : hours <= 9 ? 2 : 3;
  const firstHour = Math.ceil(t0 / 3600_000) * 3600_000;
  for (let ms = firstHour; ms <= t1; ms += hStep * 3600_000) {
    const xx = x(ms);
    if (xx < PAD_L + 12 || xx > W - PAD_R - 12) continue;
    ctx.fillText(formatClock(ms, inp.tz), xx, axisY);
  }

  // Wind changes.
  const plotTopY = L.changeRow;
  const plotBottom = plotTop(3) + PANEL_H;
  void plotBottom;
  for (const c of inp.changes) {
    if (c.time < t0 || c.time > t1) continue;
    const xx = x(c.time);
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = danger;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [a, b] of panelSpans) {
      ctx.moveTo(xx, a);
      ctx.lineTo(xx, b);
    }
    ctx.stroke();
    ctx.restore();
    const label = `${compassName(c.toDir)} change ${formatClock(c.time, inp.tz)}`;
    ctx.font = fontSmall;
    const tw = ctx.measureText(label).width + 12;
    const lx = Math.min(W - PAD_R - tw, Math.max(PAD_L, xx - tw / 2));
    const lh = L.changeRow - 4;
    ctx.fillStyle = danger;
    roundRect(ctx, lx, 2, tw, lh, lh / 2);
    ctx.fill();
    ctx.fillStyle = onDanger;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, lx + 6, 2 + lh / 2 + 0.5);
  }

  // Now cursor.
  const nowX = x(t0 + inp.viewTime * 1000);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const [a, b] of panelSpans) {
    ctx.moveTo(nowX, a - (a === panelSpans[0]![0] ? ARROW_H : 0));
    ctx.lineTo(nowX, b);
  }
  ctx.stroke();

  // Inspect readout.
  if (inp.inspect !== null) {
    const ms = t0 + inp.inspect * 1000;
    const w = weatherAt(inp.series, ms);
    const xx = x(ms);
    ctx.strokeStyle = muted;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(xx, plotTopY);
    ctx.lineTo(xx, plotBottom);
    ctx.stroke();
    const lines = [
      formatClock(ms, inp.tz),
      `${compassName(w.windDir10)} ${Math.round(kmh(w.windSpeed10))} ${inp.units === 'kmh' ? 'km/h' : 'm/s'}`,
      `${Math.round(w.temperature)} °C · RH ${Math.round(w.relativeHumidity)}%`,
      `Litter ≈ ${litterEstimate(w, inp.tz).toFixed(1)}%`,
    ];
    ctx.font = fontSmall;
    const lh = Math.ceil(type.smallPx * 1.4);
    const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
    const bh = lines.length * lh + 10;
    const bx = xx + 10 + bw > W - PAD_R ? xx - 10 - bw : xx + 10;
    const by = plotTop(0) + 8;
    ctx.fillStyle = surface;
    ctx.strokeStyle = outline;
    ctx.lineWidth = 1;
    roundRect(ctx, bx, by, bw, bh, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = ink;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    lines.forEach((l, i) => ctx.fillText(l, bx + 8, by + 5 + i * lh));
  }

  return {
    timeAt(clientX: number): number {
      const r = canvas.getBoundingClientRect();
      const f = (clientX - r.left - PAD_L) / (r.width - PAD_L - PAD_R);
      return Math.max(0, Math.min(inp.duration, f * inp.duration));
    },
  };
}

function drawArrow(ctx: CanvasRenderingContext2D, cx: number, cy: number, dirFrom: number, ink: string, halo: string): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(dirFrom * DEG);
  // Arrow drawn pointing down (+y) = blowing south for a northerly, then rotated.
  const path = (): void => {
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(0, 7);
    ctx.moveTo(-5, 2);
    ctx.lineTo(0, 8);
    ctx.lineTo(5, 2);
  };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = halo;
  ctx.lineWidth = 5;
  path();
  ctx.stroke();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2.25;
  path();
  ctx.stroke();
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
