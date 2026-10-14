/**
 * The drawing of the map's icons (user position, ignition pin, spot fire, insight markers by severity, focus halo): the
 * `Icon` list and the atlas the 3-D icon layer samples, on a plain canvas with the scene palette. Nothing here imports
 * three.js, so the UI can show the very same picture in the "Why here?" row (`iconGlyphUrl`) without pulling the 3-D
 * code into the first screen's bundle (iconAtlas.test.ts walks the imports to keep it so).
 */
import type { InsightSeverity } from '../core/types';
import { MARKER_COLOURS, SEVERITY_COLOURS } from './palette';

export enum Icon {
  User = 0,
  Ignition = 1,
  Spot = 2,
  Info = 3,
  Watch = 4,
  Danger = 5,
  Focus = 6,
}
export const ICON_SLOTS = 8;
export const ICON_CELL = 128;

export const severityIcon = (s: InsightSeverity): Icon => (s === 'danger' ? Icon.Danger : s === 'watch' ? Icon.Watch : Icon.Info);

/**
 * The square of an icon's cell that holds its art, as [centre x, centre y, half the side] in cell pixels (the shadow
 * included): the picture in the panel is cut out of the atlas along it, so a small dot is not drawn tiny in a big square.
 * Keep it in step with `paintAtlas` when an icon's drawing changes.
 */
export const ICON_ART: Readonly<Record<Icon, readonly [number, number, number]>> = {
  [Icon.User]: [64, 64, 36],
  [Icon.Ignition]: [64, 64, 64],
  [Icon.Spot]: [64, 64, 46],
  [Icon.Info]: [64, 64, 48],
  [Icon.Watch]: [64, 62, 54],
  [Icon.Danger]: [64, 64, 50],
  [Icon.Focus]: [64, 64, 62],
};

/** Paint every icon into its cell of the atlas (ICON_SLOTS cells of ICON_CELL px side by side). */
export function paintAtlas(g: CanvasRenderingContext2D): void {
  const CELL = ICON_CELL;
  const c = CELL / 2;
  const at = (slot: number, fn: () => void): void => {
    g.save();
    g.translate(slot * CELL, 0);
    fn();
    g.restore();
  };
  const shadow = (): void => {
    g.shadowColor = 'rgba(0,0,0,0.55)';
    g.shadowBlur = 8;
    g.shadowOffsetY = 2;
  };
  const noShadow = (): void => {
    g.shadowColor = 'transparent';
  };
  const flame = (cx: number, cy: number, s: number, fill: string): void => {
    g.beginPath();
    g.moveTo(cx, cy - s);
    g.bezierCurveTo(cx + s * 0.9, cy - s * 0.2, cx + s * 0.75, cy + s * 0.75, cx, cy + s * 0.8);
    g.bezierCurveTo(cx - s * 0.75, cy + s * 0.75, cx - s * 0.9, cy - s * 0.1, cx - s * 0.15, cy - s * 0.45);
    g.bezierCurveTo(cx - s * 0.1, cy - s * 0.1, cx + s * 0.15, cy - s * 0.3, cx, cy - s);
    g.fillStyle = fill;
    g.fill();
  };
  // User: blue dot with white ring.
  at(Icon.User, () => {
    shadow();
    g.beginPath();
    g.arc(c, c, 30, 0, Math.PI * 2);
    g.fillStyle = '#ffffff';
    g.fill();
    noShadow();
    g.beginPath();
    g.arc(c, c, 22, 0, Math.PI * 2);
    g.fillStyle = MARKER_COLOURS.user;
    g.fill();
  });
  // Ignition: red map pin with a flame.
  at(Icon.Ignition, () => {
    shadow();
    g.beginPath();
    g.moveTo(c, CELL - 4);
    g.bezierCurveTo(c - 10, CELL - 30, c - 38, 70, c - 38, 44);
    g.arc(c, 44, 38, Math.PI, 0);
    g.bezierCurveTo(c + 38, 70, c + 10, CELL - 30, c, CELL - 4);
    g.fillStyle = MARKER_COLOURS.ignition;
    g.fill();
    noShadow();
    g.lineWidth = 5;
    g.strokeStyle = '#ffffff';
    g.stroke();
    flame(c, 46, 22, '#ffffff');
  });
  // Spot fire: orange disc with white flame.
  at(Icon.Spot, () => {
    shadow();
    g.beginPath();
    g.arc(c, c, 36, 0, Math.PI * 2);
    g.fillStyle = MARKER_COLOURS.spot;
    g.fill();
    noShadow();
    g.lineWidth = 6;
    g.strokeStyle = '#ffffff';
    g.stroke();
    flame(c, c + 2, 22, '#ffffff');
  });
  const letterBadge = (slot: Icon, fill: string, glyph: string, shape: 'circle' | 'triangle' | 'octagon'): void =>
    at(slot, () => {
      shadow();
      g.beginPath();
      if (shape === 'circle') g.arc(c, c, 38, 0, Math.PI * 2);
      else if (shape === 'triangle') {
        g.moveTo(c, 12);
        g.lineTo(c + 46, CELL - 22);
        g.lineTo(c - 46, CELL - 22);
        g.closePath();
      } else {
        for (let s = 0; s < 8; s++) {
          const a = Math.PI / 8 + (s * Math.PI) / 4;
          const px = c + Math.cos(a) * 42;
          const py = c + Math.sin(a) * 42;
          if (s === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.closePath();
      }
      g.fillStyle = fill;
      g.fill();
      noShadow();
      g.lineWidth = 6;
      g.strokeStyle = '#ffffff';
      g.stroke();
      g.fillStyle = shape === 'triangle' ? '#1a1a1a' : '#ffffff';
      g.font = 'bold 54px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(glyph, c, shape === 'triangle' ? c + 12 : c + 3);
    });
  letterBadge(Icon.Info, SEVERITY_COLOURS.info, 'i', 'circle');
  letterBadge(Icon.Watch, SEVERITY_COLOURS.watch, '!', 'triangle');
  letterBadge(Icon.Danger, SEVERITY_COLOURS.danger, '!', 'octagon');
  // Focus: white ring.
  at(Icon.Focus, () => {
    shadow();
    g.beginPath();
    g.arc(c, c, 52, 0, Math.PI * 2);
    g.lineWidth = 9;
    g.strokeStyle = '#ffffff';
    g.stroke();
  });
}

let atlasCanvas: HTMLCanvasElement | null = null;

/**
 * The icon atlas, drawn once (browser only: null without a document or a 2-D canvas). The 3-D icon layer uploads this
 * canvas as its texture and the panel's pictures are cut from it, so the two cannot differ.
 */
export function iconAtlasCanvas(): HTMLCanvasElement | null {
  if (atlasCanvas) return atlasCanvas;
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = ICON_CELL * ICON_SLOTS;
  cv.height = ICON_CELL;
  const g = cv.getContext('2d');
  if (!g) return null;
  paintAtlas(g);
  atlasCanvas = cv;
  return cv;
}

const glyphUrls = new Map<string, string>();

/**
 * One icon as the map draws it, as a PNG data URL of `px` x `px` device pixels (cached: one string per icon and size).
 * Empty where there is no canvas (node tests, a browser without 2-D canvas).
 */
export function iconGlyphUrl(icon: Icon, px = 96): string {
  const key = `${icon}:${px}`;
  const known = glyphUrls.get(key);
  if (known !== undefined) return known;
  let url = '';
  const atlas = iconAtlasCanvas();
  const art = ICON_ART[icon];
  if (atlas && art) {
    const cv = document.createElement('canvas');
    cv.width = px;
    cv.height = px;
    const g = cv.getContext('2d');
    if (g) {
      g.drawImage(atlas, icon * ICON_CELL + art[0] - art[2], art[1] - art[2], art[2] * 2, art[2] * 2, 0, 0, px, px);
      url = cv.toDataURL('image/png');
    }
  }
  if (url) glyphUrls.set(key, url);
  return url;
}
