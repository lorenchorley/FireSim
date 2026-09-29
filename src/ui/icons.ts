/**
 * Inline SVG icon set: Material-like OUTLINED icons on a 24 x 24 grid, drawn with 2 px round strokes in currentColor
 * (so an icon takes the colour of its text, and the high-contrast variant needs no second set).
 * Icons are decorative (aria-hidden); every control that uses one also carries a visible text label or aria-label.
 *
 *   icon('layers')                          24 px
 *   icon('database', { size: 18 })          18 px (inside buttons and chips the CSS sets 18 px anyway)
 *   icon('play', { filled: true })          solid glyph
 *
 * Names are kebab-case (`my-location`); the older camelCase names (`chevronUp`) and a few synonyms (`delete`, `water-drop`,
 * `external-link`) are ALIASES of the same drawing, so both spellings work. The gallery in src/ui/styleguide.html shows all of them.
 */
import { svg } from './dom';

/**
 * Path data. Several subpaths are separated by '|' (each becomes its own element). A subpath that starts with '*' is
 * a small SOLID shape (a dot): it is filled with currentColor and not stroked.
 */
const ICONS = {
  // ── Fire, tools and simulation (the original set) ──
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
  ember: 'M12 12.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z|M18 7.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2z|M6.5 17.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2z|M17 18a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6z|M7 7.5a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6z',
  leaf: 'M5 20c0-9 5-15 15-15 0 10-6 15-15 15z|M5 20l8-8',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z|M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z|M12 12.1v-.2',
  crosshair: 'M12 2v7|M12 15v7|M2 12h7|M15 12h7',
  line: 'M4 18c3-8 6 2 9-6s5-4 7-8',
  point: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  person: 'M12 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z|M8 22l1.5-7.5L7 16l-1-5 4-2h4l4 2-1 5-2.5-1.5L16 22',
  undo: 'M9 14L4 9l5-5|M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  replay: 'M3 12a9 9 0 1 0 3-6.7|M3 3v5h5|M12 8v4l3 2',
  cube: 'M12 2.5l8.5 4.8v9.4L12 21.5l-8.5-4.8V7.3z|M3.5 7.3L12 12l8.5-4.7|M12 12v9.5',
  top: 'M3 5l6-2 6 2 6-2v16l-6 2-6-2-6 2z|M9 3v16|M15 5v16',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z|M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  'eye-off': 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z|M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z|M3 3l18 18',
  compass: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z|M15.5 8.5l-2 5-5 2 2-5z',
  gps: 'M12 2l7.5 18-7.5-4-7.5 4z',
  locate: 'M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14z|M12 2v3|M12 19v3|M2 12h3|M19 12h3|M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  pin: 'M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z|M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',

  // ── Navigation and actions ──
  'my-location': 'M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z|M12 2v3|M12 19v3|M2 12h3|M19 12h3|*M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  menu: 'M4 6.5h16|M4 12h16|M4 17.5h16',
  close: 'M6 6l12 12|M18 6L6 18',
  back: 'M15 5l-7 7 7 7',
  'arrow-back': 'M20 12H5|M11 6l-6 6 6 6',
  'arrow-forward': 'M4 12h15|M13 6l6 6-6 6',
  'arrow-up': 'M12 20V5|M6 11l6-6 6 6',
  'arrow-down': 'M12 4v15|M6 13l6 6 6-6',
  'chevron-up': 'M6 15l6-6 6 6',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-left': 'M15 5l-7 7 7 7',
  'chevron-right': 'M9 5l7 7-7 7',
  plus: 'M12 5v14|M5 12h14',
  minus: 'M5 12h14',
  check: 'M4.5 12.5l5 5L20 7',
  'check-circle': 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z|M8 12.5l3 3 5-6',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z|M15.5 15.5l5 5',
  'more-vert': '*M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4z|*M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z|*M12 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  'more-horiz': '*M5 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z|*M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z|*M19 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  'open-in-new': 'M14 4h6v6|M20 4l-9 9|M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10',
  copy: 'M9.5 8h9A1.5 1.5 0 0 1 20 9.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 8 18.5v-9A1.5 1.5 0 0 1 9.5 8z|M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8',
  edit: 'M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z|M14.5 6.5l3 3',
  share: 'M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z|M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z|M18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z|M8.6 10.5l6.8-4|M8.6 13.5l6.8 4',
  filter: 'M4 7h16|M7 12h10|M10 17h4',
  tune: 'M4 7h9|M17 7h3|M4 17h3|M11 17h9|M15 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z|M9 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  sync: 'M4 12a8 8 0 0 1 13.7-5.6L20 8.5|M20 4v4.5h-4.5|M20 12a8 8 0 0 1-13.7 5.6L4 15.5|M4 20v-4.5h4.5',
  history: 'M3.5 12a8.5 8.5 0 1 0 2.5-6|M3.5 4.5V9H8|M12 7.5V12l3.5 2',
  download: 'M12 4v11|M7.5 11l4.5 4.5 4.5-4.5|M4.5 20h15',
  upload: 'M12 16V5|M7.5 9L12 4.5 16.5 9|M4.5 20h15',
  trash: 'M4 7h16|M10 11v6|M14 11v6|M5.5 7l1 13h11l1-13|M9 7V4h6v3',
  settings:
    'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z|M19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7.6 7.6 0 0 1-2.1 1.2L14.7 21h-4l-.3-2.4a7.6 7.6 0 0 1-2.1-1.2l-1.9.7-2-3.4 1.6-1.2a7.7 7.7 0 0 1 0-2.9L4.4 9.4l2-3.4 1.9.7a7.6 7.6 0 0 1 2.1-1.2L10.7 3h4l.3 2.4a7.6 7.6 0 0 1 2.1 1.2l1.9-.7 2 3.4-1.6 1.2a7.7 7.7 0 0 1 0 3z',
  contrast: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z|*M12 3a9 9 0 0 1 0 18z',
  lock: 'M6 11h12v10H6z|M8.5 11V7.5a3.5 3.5 0 0 1 7 0V11',

  // ── Status ──
  warning: 'M12 3L2 20.5h20z|M12 9.5v5|M12 17.6v.1',
  danger: 'M8.1 2.5h7.8l5.6 5.6v7.8l-5.6 5.6H8.1l-5.6-5.6V8.1z|M12 7.5v6|M12 16.6v.1',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z|M12 11v6|M12 7.5v.1',
  'help-circle': 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z|M9.3 9.2a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2.4-2.7 4.1|M12 17.6v.1',
  help: 'M4 19.5V5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2 2 2 0 0 0 2 2h14|M9.8 8.3a2.3 2.3 0 0 1 4.4.9c0 1.5-2.2 1.9-2.2 3.3|M12 15.2v.1',
  online: 'M2 8.8a15 15 0 0 1 20 0|M5 12.2a10.5 10.5 0 0 1 14 0|M8.5 15.6a5.5 5.5 0 0 1 7 0|M12 19.5v.1',
  offline: 'M2 8.8a15 15 0 0 1 4.5-2.9|M22 8.8a15 15 0 0 0-10.3-3.8|M5 12.2a10.5 10.5 0 0 1 3.2-2|M19 12.2a10.4 10.4 0 0 0-3-1.8|M8.5 15.6a5.5 5.5 0 0 1 7 0|M12 19.5v.1|M3 3l18 18',

  // ── Data sets and layers ──
  database:
    'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z|M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6|M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  storage:
    'M5 4h14a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z|M5 14h14a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z|M8 7v.1|M8 17v.1',
  road: 'M8.5 3L4 21|M15.5 3L20 21|M12 5v3|M12 11v3|M12 17v3',
  route: 'M6 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4z|M18 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4z|M8 18h5a3.5 3.5 0 0 0 0-7h-2a3.5 3.5 0 0 1 0-5h5',
  home: 'M3 11.5L12 4l9 7.5|M5.5 10v10h13V10|M10 20v-5.5h4V20',
  tree: 'M12 21v-7|M12 17l3-3|M7.5 15a4.5 4.5 0 0 1-1-8.9A5.5 5.5 0 0 1 17 6.5 4.5 4.5 0 0 1 16.5 15z',
  terrain: 'M2.5 19.5L9 8l4.5 7.5 2.5-3.5 5.5 7.5z',
  satellite:
    'M8.3 12L12 8.3l3.7 3.7-3.7 3.7z|M2.4 16.8l3.4-3.4 4.8 4.8-3.4 3.4z|M13.4 5.8l3.4-3.4 4.8 4.8-3.4 3.4z|M8.2 15.8l2-2|M13.8 10.2l2-2',
  cloud: 'M7.5 19a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18.4 11.2 4 4 0 0 1 17.5 19z',
  'cloud-off': 'M7.5 19a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18.4 11.2 4 4 0 0 1 17.5 19z|M3 3l18 18',
  droplet: 'M12 2.8s6.5 7 6.5 11.7a6.5 6.5 0 0 1-13 0C5.5 9.8 12 2.8 12 2.8z',
  thermometer: 'M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0z|M12 17.5v-7',
  ruler: 'M3 8h18v8H3z|M6.5 8v3|M10 8v4.5|M13.5 8v3|M17 8v4.5',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z|M12 7v5l3.5 2',
  calendar:
    'M5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-12A1.5 1.5 0 0 1 5.5 5z|M4 10h16|M8 3v4|M16 3v4',
  sun: 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z|M12 1.5v2.5|M12 20v2.5|M1.5 12H4|M20 12h2.5|M4.6 4.6l1.8 1.8|M17.6 17.6l1.8 1.8|M4.6 19.4l1.8-1.8|M17.6 6.4l1.8-1.8',
  moon: 'M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z',
  map: 'M3.5 6.5L9 4.5l6 2 5.5-2v13l-5.5 2-6-2-5.5 2z|M9 4.5v13|M15 6.5v13',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z|M3 12h18|M12 3c2.5 2.7 3.5 5.7 3.5 9s-1 6.3-3.5 9c-2.5-2.7-3.5-5.7-3.5-9s1-6.3 3.5-9z',
  grid: 'M4 4h6.5v6.5H4z|M13.5 4H20v6.5h-6.5z|M4 13.5h6.5V20H4z|M13.5 13.5H20V20h-6.5z',
  image:
    'M5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4z|M4 16l4.5-4.5 4 4 3-3 4.5 4.5|*M8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  polygon: 'M12 3l8.5 6.2-3.2 10H6.7l-3.2-10z',
  text: 'M5 6.5V5h14v1.5|M12 5v14|M9 19h6',
  file: 'M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7z|M14 3v4h4|M9 12.5h6|M9 16.5h6',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1|M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  smartphone: 'M8 2.5h8a1 1 0 0 1 1 1v17a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-17a1 1 0 0 1 1-1z|M10.5 18.5h3',
  'bar-chart': 'M4.5 12h4v8h-4z|M10 4h4v16h-4z|M15.5 9h4v11h-4z',
  table:
    'M5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4z|M4 9.5h16|M4 14.5h16|M10 9.5V20',
  chart: 'M3 20h18|M5 16l4-5 4 3 6-8',
  stats: 'M4 20V10|M10 20V4|M16 20v-7|M22 20H2',
  list: 'M9 6h11|M9 12h11|M9 18h11|M4.5 6v.1|M4.5 12v.1|M4.5 18v.1',
  book: 'M4 19.5V5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2 2 2 0 0 0 2 2h14',
} as const;

/** Second spellings of the same drawing: the old camelCase names and common synonyms. */
const ALIASES = {
  chevronUp: 'chevron-up',
  chevronDown: 'chevron-down',
  chevronRight: 'chevron-right',
  'water-drop': 'droplet',
  delete: 'trash',
  'external-link': 'open-in-new',
  mountain: 'terrain',
  add: 'plus',
  remove: 'minus',
  public: 'globe',
} as const;

type CanonicalIconName = keyof typeof ICONS;
export type IconName = CanonicalIconName | keyof typeof ALIASES;

/** Every drawing once, in the order of the gallery (aliases are listed in {@link ICON_ALIASES}). */
export const ICON_NAMES = Object.keys(ICONS) as CanonicalIconName[];
export const ICON_ALIASES: Readonly<Record<string, string>> = ALIASES;

/** Icons that are drawn solid by default (a filled triangle reads better than an outlined one). */
const FILLED_BY_DEFAULT: ReadonlySet<string> = new Set(['play', 'gps']);

const resolve = (name: IconName): CanonicalIconName => (name in ALIASES ? ALIASES[name as keyof typeof ALIASES] : name) as CanonicalIconName;

export interface IconOptions {
  /** Pixel size (default 24). */
  size?: number;
  /** Fill closed shapes with currentColor (default: only play and gps). */
  filled?: boolean;
  /** Extra class on the <svg> (`icon` is always there). */
  class?: string;
  /** Stroke width in the 24 px grid (default 2). */
  strokeWidth?: number;
}

/** Create an icon element. */
export function icon(name: IconName, opts: IconOptions = {}): SVGSVGElement {
  const size = opts.size ?? 24;
  const filled = opts.filled ?? FILLED_BY_DEFAULT.has(resolve(name));
  const paths = ICONS[resolve(name)].split('|').map((d) =>
    d.startsWith('*') ? svg('path', { d: d.slice(1), fill: 'currentColor', stroke: 'none' }) : svg('path', { d }),
  );
  return svg(
    'svg',
    {
      viewBox: '0 0 24 24',
      width: size,
      height: size,
      fill: filled ? 'currentColor' : 'none',
      stroke: 'currentColor',
      'stroke-width': opts.strokeWidth ?? 2,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
      focusable: 'false',
      class: opts.class ? `icon ${opts.class}` : 'icon',
    },
    paths,
  );
}

/** The same icon as an SVG markup string (for innerHTML templates and data URIs). */
export function iconMarkup(name: IconName, opts: IconOptions = {}): string {
  const size = opts.size ?? 24;
  const filled = opts.filled ?? FILLED_BY_DEFAULT.has(resolve(name));
  const paths = ICONS[resolve(name)]
    .split('|')
    .map((d) => (d.startsWith('*') ? `<path d="${d.slice(1)}" fill="currentColor" stroke="none"/>` : `<path d="${d}"/>`))
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="${opts.strokeWidth ?? 2}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" class="${opts.class ? `icon ${opts.class}` : 'icon'}">${paths}</svg>`;
}
