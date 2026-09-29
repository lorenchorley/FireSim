/**
 * Inline SVG icon set (24 × 24, stroke-based, 2.25 px strokes so they stay legible in sunlight and through smoke).
 * Icons are decorative (aria-hidden); every control that uses one also carries a visible text label or aria-label.
 */
import { svg } from './dom';

/** Path data; several subpaths are separated by '|' (each becomes its own element). */
const ICONS = {
  why: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z|M9.3 9.2a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2.4-2.7 4.1|M12 17.6v.1',
  flame:
    'M12 22c4.2 0 7-2.8 7-6.6 0-3.4-2.2-5.5-3.6-7.6-.5 1.6-1.4 2.6-2.6 3C13.4 7.6 12 4.6 9.6 2.5 9.8 6 7.8 8.2 6.3 10.2 5.4 11.5 5 13 5 15.4 5 19.2 7.8 22 12 22z|M12 22c-1.8 0-3-1.3-3-3 0-1.6 1.2-2.6 2-3.8.3.8.8 1.3 1.4 1.5.2-1.2.9-2.1 1.6-2.7.3 1.4 1 2.6 1 4 0 2.3-1.2 4-3 4z',
  brush: 'M14.5 4.5l5 5L11 18l-5-5z|M6 13l-2.3 2.3a2.5 2.5 0 0 0 0 3.5l1.5 1.5a2.5 2.5 0 0 0 3.5 0L11 18|M17 2l5 5',
  wind: 'M3 8h11a3 3 0 1 0-3-3|M3 12h16a3 3 0 1 1-3 3|M3 16h7a2.5 2.5 0 1 1-2.5 2.5',
  layers: 'M12 3l9 5-9 5-9-5z|M3 13l9 5 9-5|M3 17.5l9 5 9-5',
  whatif: 'M6 3v6|M6 21v-6|M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z|M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z|M18 9c0 5-12 3-12 6|M18 21v-6|M18 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  play: 'M7 4.5v15l12.5-7.5z',
  pause: 'M7.5 4.5v15|M16.5 4.5v15',
  speed: 'M4 6l7 6-7 6z|M13 6l7 6-7 6z',
  settings:
    'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z|M19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7.6 7.6 0 0 1-2.1 1.2L14.7 21h-4l-.3-2.4a7.6 7.6 0 0 1-2.1-1.2l-1.9.7-2-3.4 1.6-1.2a7.7 7.7 0 0 1 0-2.9L4.4 9.4l2-3.4 1.9.7a7.6 7.6 0 0 1 2.1-1.2L10.7 3h4l.3 2.4a7.6 7.6 0 0 1 2.1 1.2l1.9-.7 2 3.4-1.6 1.2a7.7 7.7 0 0 1 0 3z',
  close: 'M6 6l12 12|M18 6L6 18',
  back: 'M15 5l-7 7 7 7',
  chevronUp: 'M6 15l6-6 6 6',
  chevronDown: 'M6 9l6 6 6-6',
  chevronRight: 'M9 5l7 7-7 7',
  locate: 'M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14z|M12 2v3|M12 19v3|M2 12h3|M19 12h3|M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  pin: 'M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z|M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  check: 'M4.5 12.5l5 5L20 7',
  warning: 'M12 3L2 20.5h20z|M12 9.5v5|M12 17.6v.1',
  danger: 'M8.1 2.5h7.8l5.6 5.6v7.8l-5.6 5.6H8.1l-5.6-5.6V8.1z|M12 7.5v6|M12 16.6v.1',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z|M12 11v6|M12 7.5v.1',
  thermometer: 'M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0z|M12 17.5v-7',
  droplet: 'M12 2.8s6.5 7 6.5 11.7a6.5 6.5 0 0 1-13 0C5.5 9.8 12 2.8 12 2.8z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z|M12 7v5l3.5 2',
  top: 'M3 5l6-2 6 2 6-2v16l-6 2-6-2-6 2z|M9 3v16|M15 5v16',
  cube: 'M12 2.5l8.5 4.8v9.4L12 21.5l-8.5-4.8V7.3z|M3.5 7.3L12 12l8.5-4.7|M12 12v9.5',
  person: 'M12 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z|M8 22l1.5-7.5L7 16l-1-5 4-2h4l4 2-1 5-2.5-1.5L16 22',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z|M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z|M12 12.1v-.2',
  undo: 'M9 14L4 9l5-5|M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  trash: 'M4 7h16|M10 11v6|M14 11v6|M5.5 7l1 13h11l1-13|M9 7V4h6v3',
  plus: 'M12 5v14|M5 12h14',
  minus: 'M5 12h14',
  sun: 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z|M12 1.5v2.5|M12 20v2.5|M1.5 12H4|M20 12h2.5|M4.6 4.6l1.8 1.8|M17.6 17.6l1.8 1.8|M4.6 19.4l1.8-1.8|M17.6 6.4l1.8-1.8',
  moon: 'M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z',
  online: 'M2 8.8a15 15 0 0 1 20 0|M5 12.2a10.5 10.5 0 0 1 14 0|M8.5 15.6a5.5 5.5 0 0 1 7 0|M12 19.5v.1',
  offline: 'M2 8.8a15 15 0 0 1 4.5-2.9|M22 8.8a15 15 0 0 0-10.3-3.8|M5 12.2a10.5 10.5 0 0 1 3.2-2|M19 12.2a10.4 10.4 0 0 0-3-1.8|M8.5 15.6a5.5 5.5 0 0 1 7 0|M12 19.5v.1|M3 3l18 18',
  book: 'M4 19.5V5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2 2 2 0 0 0 2 2h14',
  list: 'M9 6h11|M9 12h11|M9 18h11|M4.5 6v.1|M4.5 12v.1|M4.5 18v.1',
  chart: 'M3 20h18|M5 16l4-5 4 3 6-8',
  stats: 'M4 20V10|M10 20V4|M16 20v-7|M22 20H2',
  help: 'M4 19.5V5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2 2 2 0 0 0 2 2h14|M9.8 8.3a2.3 2.3 0 0 1 4.4.9c0 1.5-2.2 1.9-2.2 3.3|M12 15.2v.1',
  crosshair: 'M12 2v7|M12 15v7|M2 12h7|M15 12h7',
  line: 'M4 18c3-8 6 2 9-6s5-4 7-8',
  point: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  compass: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z|M15.5 8.5l-2 5-5 2 2-5z',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z|M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  map: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z|M3 12h18|M12 3c2.5 2.7 3.5 5.7 3.5 9s-1 6.3-3.5 9c-2.5-2.7-3.5-5.7-3.5-9s1-6.3 3.5-9z',
  replay: 'M3 12a9 9 0 1 0 3-6.7|M3 3v5h5|M12 8v4l3 2',
  lock: 'M6 11h12v10H6z|M8.5 11V7.5a3.5 3.5 0 0 1 7 0V11',
  leaf: 'M5 20c0-9 5-15 15-15 0 10-6 15-15 15z|M5 20l8-8',
  ember: 'M12 12.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z|M18 7.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2z|M6.5 17.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2z|M17 18a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6z|M7 7.5a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6z',
  gps: 'M12 2l7.5 18-7.5-4-7.5 4z',
} as const;

export type IconName = keyof typeof ICONS;

/** Create an icon element. `filled` fills closed shapes (e.g. play, flame) with currentColor. */
export function icon(name: IconName, opts: { size?: number; filled?: boolean; class?: string } = {}): SVGSVGElement {
  const size = opts.size ?? 24;
  const filled = opts.filled ?? (name === 'play' || name === 'gps');
  const paths = ICONS[name].split('|').map((d) => svg('path', { d }));
  return svg(
    'svg',
    {
      viewBox: '0 0 24 24',
      width: size,
      height: size,
      fill: filled ? 'currentColor' : 'none',
      stroke: 'currentColor',
      'stroke-width': 2.25,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
      focusable: 'false',
      class: opts.class ? `icon ${opts.class}` : 'icon',
    },
    paths,
  );
}
