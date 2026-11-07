/**
 * Heat-map pictures of the fire-grid fields: panels side by side, north up, written with fast-png (already a dependency of the
 * app: nothing is added). Colours: a viridis-like ramp (dark = 0, yellow = 1), non-flammable cells darkened, optional contours
 * of the arrival time (black), homes (white dots) and the ignition (red cross). Each panel carries a colour bar underneath.
 */
import { writeFileSync } from 'node:fs';
import { encode } from 'fast-png';

const STOPS: [number, number, number][] = [
  [68, 1, 84],
  [72, 40, 120],
  [62, 74, 137],
  [49, 104, 142],
  [38, 130, 142],
  [31, 158, 137],
  [53, 183, 121],
  [110, 206, 88],
  [181, 222, 43],
  [253, 231, 37],
];

export function viridis(v: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, v)) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(x));
  const f = x - i;
  const a = STOPS[i]!;
  const b = STOPS[i + 1]!;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export interface Panel {
  /** Values in [0, 1] (NaN draws as mid grey) on the nx x ny grid. */
  values: ArrayLike<number>;
  /** 1 on cells to draw dimmed (e.g. cells that cannot burn). */
  dim?: ArrayLike<number>;
  /** Categorical panel: colour by the integer code instead of the ramp. */
  categories?: [number, number, number][];
  /** Arrival-time contour levels (s) to draw on this panel, with the arrival raster. */
  contours?: { arrival: ArrayLike<number>; levelsS: number[] };
  homes?: { x: number[]; y: number[] };
  mark?: { x: number; y: number };
}

export interface GridLite {
  nx: number;
  ny: number;
  cellSize: number;
  x0: number;
  y0: number;
}

export function writePanels(path: string, g: GridLite, panels: Panel[], scale = 2, gap = 6, bar = 10): number {
  const pw = g.nx * scale;
  const ph = g.ny * scale;
  const W = panels.length * pw + (panels.length - 1) * gap;
  const H = ph + gap + bar;
  const rgb = new Uint8Array(W * H * 3).fill(255);
  const put = (x: number, y: number, c: [number, number, number]): void => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 3;
    rgb[o] = c[0];
    rgb[o + 1] = c[1];
    rgb[o + 2] = c[2];
  };
  panels.forEach((p, pi) => {
    const ox = pi * (pw + gap);
    for (let j = 0; j < g.ny; j++) {
      for (let i = 0; i < g.nx; i++) {
        const k = j * g.nx + i;
        const v = p.values[k]!;
        let c: [number, number, number];
        if (p.categories) c = p.categories[Math.max(0, Math.min(p.categories.length - 1, Math.round(v)))]!;
        else c = Number.isFinite(v) ? viridis(v) : [128, 128, 128];
        if (p.dim?.[k]) c = [c[0] * 0.45, c[1] * 0.45, c[2] * 0.45];
        for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) put(ox + i * scale + sx, (g.ny - 1 - j) * scale + sy, c);
      }
    }
    if (p.contours) {
      const { arrival, levelsS } = p.contours;
      for (const L of levelsS) {
        for (let j = 0; j < g.ny - 1; j++) {
          for (let i = 0; i < g.nx - 1; i++) {
            const k = j * g.nx + i;
            const a = arrival[k]! <= L;
            if (a !== arrival[k + 1]! <= L || a !== arrival[k + g.nx]! <= L) put(ox + i * scale + (scale >> 1), (g.ny - 1 - j) * scale + (scale >> 1), [0, 0, 0]);
          }
        }
      }
    }
    if (p.homes) {
      for (let q = 0; q < p.homes.x.length; q++) {
        const i = (p.homes.x[q]! - g.x0) / g.cellSize;
        const j = (p.homes.y[q]! - g.y0) / g.cellSize;
        put(ox + Math.round(i * scale), Math.round((g.ny - 1 - j) * scale), [255, 255, 255]);
      }
    }
    if (p.mark) {
      const i = Math.round(((p.mark.x - g.x0) / g.cellSize) * scale);
      const j = Math.round((g.ny - 1 - (p.mark.y - g.y0) / g.cellSize) * scale);
      for (let d = -5; d <= 5; d++) {
        put(ox + i + d, j, [255, 30, 30]);
        put(ox + i, j + d, [255, 30, 30]);
      }
    }
    // Colour bar (or the category swatches).
    for (let x = 0; x < pw; x++) {
      const c = p.categories ? p.categories[Math.min(p.categories.length - 1, Math.floor((x / pw) * p.categories.length))]! : viridis(x / (pw - 1));
      for (let y = 0; y < bar; y++) put(ox + x, ph + gap + y, c);
    }
  });
  const png = encode({ width: W, height: H, data: rgb, channels: 3, depth: 8 });
  writeFileSync(path, png);
  return png.length;
}
