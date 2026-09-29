/**
 * Dev-only style guide (src/ui/styleguide.html, not part of the production build).
 * Every primitive of the flat design system in every state, a mock map screen, the icon gallery and the type / colour /
 * spacing scales. Open:  /src/ui/styleguide.html?theme=light|dark&contrast=high
 * It is built with the same widgets and primitives the app uses (widgets.ts, primitives.ts), so it doubles as their smoke test.
 */
import '../styles/main.css';
import { contrastRatio } from './contrast';
import { h, svg, type Child } from './dom';
import { icon, ICON_ALIASES, ICON_NAMES, type IconName } from './icons';
import {
  badge,
  bar,
  bottomNav,
  bottomSheet,
  chip,
  fab,
  iconButton,
  kv,
  list,
  listRow,
  meter,
  originChip,
  sectionHeader,
  showSnackbar,
  sparkbar,
  stackedBar,
  stat,
  statRow,
  stepper,
  tile,
  tileGrid,
  topBar,
  type Origin,
} from './primitives';
import { applyAppearance, resolveAppearance, THEME_CHROME } from './settings';
import { button, compassRose, numberField, segmented, slider, toggle, windArrow } from './widgets';

const params = new URLSearchParams(location.search);
const themeParam = params.get('theme');
const contrastHigh = params.get('contrast') === 'high';

// ───────────────────────────── layout helpers ─────────────────────────────

function sec(id: string, title: string, intro: string | null, ...kids: Child[]): HTMLElement {
  return h('section', { class: 'sg-section', id }, [h('h2', null, title), intro ? h('p', { class: 't-secondary' }, intro) : null, ...kids]);
}

/** A labelled specimen on a surface. */
function demo(label: string, child: Child, cls = ''): HTMLElement {
  return h('div', { class: 'sg-demo' }, [h('div', { class: 'sg-label' }, label), h('div', { class: ['sg-stage', cls] }, child)]);
}

const cssVar = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** A button/chip/etc. forced into its pressed look. */
function pressed<T extends HTMLElement>(el: T): T {
  el.classList.add('sg-pressed');
  return el;
}
function focused<T extends HTMLElement>(el: T): T {
  el.classList.add('sg-focus');
  return el;
}

// ───────────────────────────── foundations ─────────────────────────────

const COLOUR_GROUPS: { title: string; tokens: string[] }[] = [
  { title: 'Surfaces', tokens: ['--bg', '--surface', '--surface-2', '--surface-3', '--surface-inverse', '--scrim'] },
  { title: 'Text and icons', tokens: ['--text', '--muted', '--icon'] },
  { title: 'Lines', tokens: ['--divider', '--outline', '--outline-variant'] },
  { title: 'Interactive (blue)', tokens: ['--primary', '--on-primary', '--primary-ink', '--primary-container', '--on-primary-container', '--focus'] },
  { title: 'Danger', tokens: ['--danger', '--on-danger', '--danger-bg', '--danger-ink'] },
  { title: 'Watch (amber)', tokens: ['--watch', '--on-watch', '--watch-bg', '--watch-ink'] },
  { title: 'OK (green)', tokens: ['--ok', '--on-ok', '--ok-bg', '--ok-ink'] },
  { title: 'Info', tokens: ['--info', '--on-info', '--info-bg', '--info-ink'] },
  { title: 'Fire (orange)', tokens: ['--fire', '--on-fire', '--fire-bg', '--fire-ink'] },
  { title: 'Fire-danger ratings', tokens: ['--rating-none', '--rating-moderate', '--rating-high', '--rating-extreme', '--rating-catastrophic'] },
  { title: 'Data series', tokens: ['--chart-wind', '--chart-temp', '--chart-rh', '--chart-moist', '--series-1', '--series-2', '--series-3', '--series-4', '--series-5', '--violet-bg', '--violet-ink'] },
  { title: 'Safety strip', tokens: ['--badge-bg', '--badge-ink'] },
];

function colours(): HTMLElement {
  return sec(
    'colour',
    'Colour tokens',
    'Live values of the current theme. Blue is the only interactive colour; orange, red and amber mean fire, danger and fire-danger; green means OK; data never uses the blue.',
    ...COLOUR_GROUPS.map((g) =>
      demo(
        g.title,
        h(
          'div',
          { class: 'sg-grid', style: 'width:100%' },
          g.tokens.map((t) => h('div', { class: 'sg-sw' }, [h('i', { style: `background:var(${t})` }), h('span', null, [h('code', null, t), h('small', null, cssVar(t))])])),
        ),
      ),
    ),
  );
}

const CONTRAST_PAIRS: [string, string, number][] = [
  ['--text', '--surface', 4.5],
  ['--muted', '--surface', 4.5],
  ['--muted', '--bg', 4.5],
  ['--on-primary', '--primary', 4.5],
  ['--primary-ink', '--surface', 4.5],
  ['--on-primary-container', '--primary-container', 4.5],
  ['--outline', '--surface', 3],
  ['--primary', '--surface', 3],
  ['--danger-ink', '--danger-bg', 4.5],
  ['--watch-ink', '--watch-bg', 4.5],
  ['--ok-ink', '--ok-bg', 4.5],
  ['--info-ink', '--info-bg', 4.5],
  ['--badge-ink', '--badge-bg', 7],
];

function contrastTable(): HTMLElement {
  const min = contrastHigh ? 7 : undefined;
  const rows: Child[] = [];
  for (const [fg, bg, need] of CONTRAST_PAIRS) {
    const need2 = min && need >= 4.5 ? min : need;
    let ratio = 0;
    try {
      ratio = contrastRatio(cssVar(fg), cssVar(bg));
    } catch {
      ratio = 0;
    }
    rows.push(
      h('span', null, [h('span', { style: `background:var(${bg});color:var(${fg});padding:2px 8px;border-radius:4px;margin-right:8px` }, 'Aa'), `${fg} on ${bg}`]),
      h('span', { class: 't-num' }, `${ratio.toFixed(2)}:1`),
      badge(ratio >= need2 ? `pass ${need2}` : `FAIL ${need2}`, { tone: ratio >= need2 ? 'ok' : 'danger' }),
    );
  }
  return demo(`Contrast (${contrastHigh ? 'high contrast: text pairs need 7:1' : 'text 4.5:1, boundaries and icons 3:1, strip 7:1'})`, h('div', { class: 'sg-ct', style: 'width:100%' }, rows));
}

function typeScale(): HTMLElement {
  const rows: [string, string, string][] = [
    ['t-display', '--fs-2xl / 700', '14:29'],
    ['t-headline', '--fs-xl 24 / 500', 'Screen title'],
    ['t-title', '--fs-lg 20 / 500', 'Section title'],
    ['t-subtitle', '--fs-md 16 / 500', 'Sub-heading, card title'],
    ['t-list', '--fs-md 16 / 400', 'List title and input text'],
    ['t-body', '--fs-sm 14 / 400', 'Body text, buttons, chips'],
    ['t-secondary', '--fs-sm 14 / 400 muted', 'Secondary text'],
    ['t-caption', '--fs-xs 12 / 400 muted', 'Caption and status line'],
  ];
  return sec(
    'type',
    'Type',
    'System font (Roboto on Android). Sizes 12 / 14 / 16 / 20 / 24; weights 400 and 500 (700 only for clock digits and ratings). Sentence case everywhere; numbers are tabular.',
    demo(
      'Roles',
      h(
        'div',
        { class: 'stack', style: '--gap:8px;width:100%' },
        rows.map(([cls, spec, text]) => h('div', null, [h('div', { class: 'sg-label' }, `.${cls}  ${spec}`), h('div', { class: cls }, text)])),
      ),
    ),
    demo('Tabular numerals', h('div', { class: 't-num' }, ['12:00  09:41  111:11', h('br'), '00:00  88:88  00:00'])),
  );
}

function scales(): HTMLElement {
  const sp = ['--sp-1', '--sp-2', '--sp-3', '--sp-4', '--sp-5', '--sp-6'];
  const r = ['--r-xs', '--r-sm', '--r-md', '--r-lg', '--r-xl'];
  return sec(
    'scales',
    'Space, shape, elevation, size',
    '4 px base. Card padding is --sp-3 (12), gaps between sections 8-12. Only things that float over the map or content get elevation.',
    demo(
      'Space --sp-1..6',
      h(
        'div',
        { class: 'stack', style: '--gap:4px;width:100%' },
        sp.map((t) => h('div', { class: 'sg-space' }, [h('i', { style: `width:var(${t})` }), h('span', { class: 't-caption' }, `${t} ${cssVar(t)}`)])),
      ),
    ),
    demo(
      'Radii',
      r.map((t) => h('div', { class: 'sg-box', style: `border-radius:var(${t})` }, `${t.slice(4)} ${cssVar(t)}`)),
    ),
    demo(
      'Elevation --elev-1..4',
      ['--elev-1', '--elev-2', '--elev-3', '--elev-4'].map((t) => h('div', { class: 'sg-elev', style: `box-shadow:var(${t})` }, t.slice(2))),
      'sg-bg',
    ),
    demo(
      'Sizes',
      h('div', { class: 'stack', style: '--gap:4px' }, [
        ...['--tap', '--ctl-h', '--ctl-h-sm', '--field-h', '--row-h', '--row-h-2', '--row-h-3', '--fab', '--bar-h', '--weather-h', '--nav-h', '--timeline-h', '--strip-h'].map((t) =>
          h('div', { class: 'sg-label' }, `${t}: ${cssVar(t)}`),
        ),
      ]),
    ),
  );
}

// ───────────────────────────── the mock map screen ─────────────────────────────

function mapArt(): SVGSVGElement {
  return svg('svg', { class: 'sg-map', viewBox: '0 0 390 640', preserveAspectRatio: 'xMidYMid slice', 'aria-hidden': 'true' }, [
    svg('rect', { width: 390, height: 640, fill: '#4a5a3c' }),
    svg('path', { d: 'M0 120 C80 90 140 150 220 120 S340 60 390 100 V0 H0Z', fill: '#3d4c31' }),
    svg('path', { d: 'M0 330 C60 300 120 360 200 330 S330 290 390 320 V420 C300 440 220 400 140 430 S40 450 0 430Z', fill: '#56683f' }),
    svg('path', { d: 'M-10 250 C70 210 120 280 190 240 S310 200 400 230', fill: 'none', stroke: '#8fb6c9', 'stroke-width': 10, 'stroke-linecap': 'round' }),
    svg('path', { d: 'M40 640 C90 520 60 430 150 350 S250 250 380 210', fill: 'none', stroke: '#d9d4c3', 'stroke-width': 4, 'stroke-linecap': 'round' }),
    svg('path', { d: 'M200 640 C210 560 260 520 300 470', fill: 'none', stroke: '#c9c3b0', 'stroke-width': 3, 'stroke-linecap': 'round' }),
    svg('path', { d: 'M150 300 C170 270 210 270 230 300 S220 350 180 350 130 330 150 300Z', fill: '#e8710a', 'fill-opacity': 0.85 }),
    svg('path', { d: 'M175 305 C185 290 205 292 212 308 S200 335 184 332 170 318 175 305Z', fill: '#f9ab00' }),
    ...[0, 1, 2, 3, 4].flatMap((r) => [0, 1, 2, 3].map((c) => svg('path', { d: 'M0 0l14 14m-5-1l5 1-1-5', transform: `translate(${34 + c * 90} ${200 + r * 78})`, fill: 'none', stroke: '#e8eaed', 'stroke-opacity': 0.75, 'stroke-width': 2, 'stroke-linecap': 'round' }))),
  ]);
}

function mockScreen(): HTMLElement {
  const nav = bottomNav<'map' | 'insights' | 'weather' | 'data'>({
    label: 'Sections',
    selected: 'map',
    onSelect: () => undefined,
    items: [
      { id: 'map', label: 'Map', icon: 'map' },
      { id: 'insights', label: 'Insights', icon: 'flame', badge: 3 },
      { id: 'weather', label: 'Weather', icon: 'cloud' },
      { id: 'data', label: 'Data', icon: 'database' },
    ],
  });
  const sheet = bottomSheet({
    title: 'Coming up',
    onClose: () => undefined,
    body: list(
      [
        listRow({ icon: 'wind', title: 'Wind change at 16:00', sub: 'Forecast: NW 38 km/h swinging SW', chevron: true, onClick: () => undefined }),
        listRow({ icon: 'warning', title: 'Spotting across the gully', sub: 'Embers landing up to 600 m downwind', trailing: badge('Watch out', { tone: 'watch' }), onClick: () => undefined }),
        listRow({ icon: 'home', title: 'Homes in the run of the fire', sub: '12 homes within 2 km', chevron: true, onClick: () => undefined }),
      ],
      {},
    ),
  });
  const layers = fab({ icon: 'layers', label: 'Map layers' });
  const locate = fab({ icon: 'my-location', label: 'My location', active: true });
  return h('div', { class: 'sg-phone', dataset: { testid: 'sg-phone' } }, [
    mapArt(),
    topBar({
      leading: iconButton({ icon: 'menu', label: 'Menu' }),
      text: 'Narrow Neck · 14:29',
      trailing: [iconButton({ icon: 'search', label: 'Search' })],
      sub: [h('span', null, '35°'), h('span', null, '13%'), h('span', null, 'NW 38 km/h'), h('span', { class: 'rating-pill rating-extreme', style: 'min-height:16px;padding:0 8px;font-size:12px;line-height:16px' }, 'Extreme')],
    }),
    h('div', { class: 'chips chips-scroll sg-chips' }, [
      chip({ label: 'Roads', icon: 'road', kind: 'filter', selected: true, float: true }),
      chip({ label: 'Homes', icon: 'home', kind: 'filter', float: true }),
      chip({ label: 'Zones', icon: 'polygon', kind: 'filter', float: true }),
      chip({ label: 'Places', icon: 'text', kind: 'filter', float: true }),
      chip({ label: 'Trees', icon: 'tree', kind: 'filter', float: true }),
    ]),
    h('div', { class: 'fab-stack' }, [layers, locate]),
    h('div', { class: 'sg-fabext' }, fab({ icon: 'play', label: 'Play', extended: true, primary: true })),
    sheet,
    nav.el,
  ]);
}

// ───────────────────────────── primitives ─────────────────────────────

function buttons(): HTMLElement {
  const variants = [
    ['Filled', 'primary'],
    ['Tonal', 'tonal'],
    ['Outlined', 'secondary'],
    ['Text', 'ghost'],
    ['Delete', 'danger'],
  ] as const;
  const row = (label: string, make: (v: (typeof variants)[number]) => HTMLElement): HTMLElement => demo(label, variants.map(make));
  return sec(
    'buttons',
    'Buttons',
    '40 px pills (32 small, 48 large) with a 44 px hit area. One filled button per screen area; secondary actions are outlined or tonal; tertiary are text buttons.',
    row('Default', ([t, v]) => button({ label: t, variant: v })),
    row('Pressed', ([t, v]) => pressed(button({ label: t, variant: v }))),
    row('Focused', ([t, v]) => focused(button({ label: t, variant: v }))),
    row('Disabled', ([t, v]) => button({ label: t, variant: v, disabled: true })),
    row('With icon', ([t, v]) => button({ label: t, variant: v, icon: 'download' })),
    demo('Sizes: small 32 / default 40 / large 48', [
      button({ label: 'Small', variant: 'primary', size: 'sm' }),
      button({ label: 'Default', variant: 'primary' }),
      button({ label: 'Large', variant: 'primary', size: 'lg', icon: 'play' }),
    ]),
    demo('Block', button({ label: 'Build 3D model', variant: 'primary', size: 'lg', icon: 'cube', block: true })),
    demo('Icon buttons (40 px, 44 px hit area)', [
      iconButton({ icon: 'menu', label: 'Menu' }),
      iconButton({ icon: 'search', label: 'Search' }),
      iconButton({ icon: 'my-location', label: 'My location', selected: true }),
      iconButton({ icon: 'more-vert', label: 'More', variant: 'tonal' }),
      iconButton({ icon: 'plus', label: 'Add', variant: 'filled' }),
      pressed(iconButton({ icon: 'close', label: 'Close' })),
      focused(iconButton({ icon: 'settings', label: 'Settings' })),
      iconButton({ icon: 'trash', label: 'Delete', disabled: true }),
    ]),
    demo(
      'FABs: round 48, small 40, active, primary, extended',
      [
        fab({ icon: 'layers', label: 'Layers' }),
        fab({ icon: 'my-location', label: 'My location', active: true }),
        fab({ icon: 'plus', label: 'Zoom in', small: true }),
        fab({ icon: 'download', label: 'Download', primary: true }),
        fab({ icon: 'play', label: 'Play', extended: true, primary: true }),
        fab({ icon: 'route', label: 'Directions', extended: true }),
        fab({ icon: 'close', label: 'Off', disabled: true }),
      ],
      'sg-bg',
    ),
  );
}

function chipsSection(): HTMLElement {
  return sec(
    'chips',
    'Chips, badges, provenance',
    'Chips are 32 px pills. Selected chips are tinted blue and show a check. Status chips and badges are tinted by meaning and always carry a word.',
    demo('Filter chips (tap to toggle)', [
      chip({ label: 'Roads', kind: 'filter', selected: false, onToggle: () => undefined }),
      chip({ label: 'Homes', kind: 'filter', selected: true, onToggle: () => undefined }),
      pressed(chip({ label: 'Zones', kind: 'filter', selected: false, onToggle: () => undefined })),
      focused(chip({ label: 'Places', kind: 'filter', selected: true, onToggle: () => undefined })),
      chip({ label: 'Trees', kind: 'filter', disabled: true }),
    ]),
    demo('Assist and input chips', [
      chip({ label: 'Add fire', icon: 'flame', kind: 'assist', onClick: () => undefined }),
      chip({ label: 'Set wind', icon: 'wind', kind: 'assist', onClick: () => undefined }),
      chip({ label: 'Katoomba', kind: 'input', onClick: () => undefined }),
    ]),
    demo(
      'Floating chips over the map',
      [chip({ label: 'Roads', icon: 'road', kind: 'filter', selected: true, float: true }), chip({ label: 'Homes', icon: 'home', kind: 'filter', float: true })],
      'sg-bg',
    ),
    demo('Status chips', [
      chip({ label: 'Loaded', kind: 'status', tone: 'ok', icon: 'check' }),
      chip({ label: 'Stale', kind: 'status', tone: 'watch', icon: 'warning' }),
      chip({ label: 'Failed', kind: 'status', tone: 'danger', icon: 'close' }),
      chip({ label: '1.2 GB', kind: 'status', tone: 'info', icon: 'storage' }),
      chip({ label: 'Neutral', kind: 'status' }),
    ]),
    demo('Badges', [
      badge('Neutral'),
      badge('OK', { tone: 'ok', dot: true }),
      badge('Watch', { tone: 'watch', dot: true }),
      badge('Danger', { tone: 'danger', dot: true }),
      badge('Info', { tone: 'info', icon: 'info' }),
      badge('Fire', { tone: 'fire', icon: 'flame' }),
      badge('New', { caps: true, tone: 'info' }),
    ]),
    demo(
      'Fire-danger ratings',
      ['No rating', 'Moderate', 'High', 'Extreme', 'Catastrophic'].map((t) => h('span', { class: `rating-pill rating-${t.toLowerCase().replace(' ', '-')}` }, t)),
    ),
    demo(
      'Origin chips: where the data came from',
      (['live', 'saved', 'bundled', 'synthetic', 'user'] as Origin[]).map((o) => originChip(o)),
    ),
    demo('Legend chips', h('div', { class: 'chips' }, [legend('#62b346', 'Moderate'), legend('#ffd23f', 'High'), legend('#f47b20', 'Extreme'), legend('#9e1b1b', 'Catastrophic')])),
  );
}

function legend(colour: string, label: string): HTMLElement {
  return h('span', { class: 'legend-chip' }, [h('span', { class: 'swatch', style: `background:${colour}` }), label]);
}

function fields(): HTMLElement {
  const text = (label: string, value: string, extra: { disabled?: boolean; error?: boolean; focus?: boolean; placeholder?: string } = {}): HTMLElement => {
    const input = h('input', { type: 'text', value, disabled: extra.disabled ?? false, placeholder: extra.placeholder ?? '', id: `f-${label}` });
    if (extra.focus) input.setAttribute('style', 'border-color:var(--primary);box-shadow:inset 0 0 0 1px var(--primary)');
    return h('div', { class: 'field' }, [h('label', { class: 'field-label', htmlFor: `f-${label}` }, label), h('div', { class: ['input-wrap', extra.error && 'has-error'] }, input), extra.error ? h('p', { class: 'field-error' }, [icon('warning', { size: 16 }), 'Enter a latitude between -90 and 90']) : null]);
  };
  const select = h('div', { class: 'field' }, [
    h('label', { class: 'field-label', htmlFor: 'sg-sel' }, 'Weather source'),
    h('div', { class: 'input-wrap' }, h('select', { id: 'sg-sel' }, [h('option', null, 'Forecast (Open-Meteo)'), h('option', null, 'Past weather'), h('option', null, 'Typed in by hand')])),
  ]);
  return sec(
    'fields',
    'Fields',
    'Text fields are 44 px with a 3:1 outline, blue 2 px on focus. Numbers use tabular figures.',
    demo('Text field states', [text('Empty', '', { placeholder: 'Latitude, longitude' }), text('Filled', '-33.715, 150.285'), text('Focused', '-33.715', { focus: true }), text('Error', '95', { error: true }), text('Disabled', 'Locked', { disabled: true })], 'sg-col'),
    demo('Select', select, 'sg-col'),
    demo('Number with unit', numberField({ label: 'Wind speed', unit: 'km/h', value: 38, min: 0, max: 150, step: 1, onInput: () => undefined }).el, 'sg-col'),
    demo('Number stepper', [stepper({ label: 'Duration hours', value: 6, min: 1, max: 24, onChange: () => undefined }).el, stepper({ label: 'Fires', value: 1, min: 1, max: 5, onChange: () => undefined }).el]),
  );
}

function controls(): HTMLElement {
  const seg3 = segmented({ label: 'Theme', options: [{ value: 'a', label: 'Auto' }, { value: 'l', label: 'Light', icon: 'sun' }, { value: 'd', label: 'Night', icon: 'moon' }], value: 'l', onChange: () => undefined });
  const seg2 = segmented({ label: 'Wind speed units', options: [{ value: 'k', label: 'km/h' }, { value: 'm', label: 'm/s' }], value: 'k', onChange: () => undefined });
  const segGrid = segmented({
    label: 'Picture interval',
    columns: 3,
    options: [10, 30, 60, 120, 300, 600].map((s) => ({ value: String(s), label: s < 60 ? `${s} s` : `${s / 60} min` })),
    value: '60',
    onChange: () => undefined,
  });
  const segSub = segmented({
    label: 'Performance',
    options: [
      { value: 's', label: 'Saver', sub: 'Battery' },
      { value: 'b', label: 'Balanced', sub: 'Default' },
      { value: 'q', label: 'Detail', sub: 'Warm phone' },
    ],
    value: 'b',
    onChange: () => undefined,
  });
  const sw = (label: string, checked: boolean, disabled = false, description?: string): HTMLElement => {
    const t = toggle({ label, checked, onChange: () => undefined, ...(description ? { description } : {}) });
    (t.el.querySelector('input') as HTMLInputElement).disabled = disabled;
    return t.el;
  };
  const check = (label: string, checked: boolean, disabled = false, radio = false): HTMLElement =>
    h('label', { class: radio ? 'radio' : 'check' }, [h('input', { type: radio ? 'radio' : 'checkbox', name: radio ? 'sg-radio' : undefined, checked, disabled }), h('span', null, label)]);
  const sl = slider({ label: 'Wind speed', min: 0, max: 100, step: 1, value: 38, format: (v) => `${v} km/h` });
  const sl0 = slider({ label: 'Speed', min: 0, max: 100, step: 1, value: 0, format: (v) => `${v}×` });
  const sl100 = slider({ label: 'Opacity', min: 0, max: 100, step: 1, value: 100, format: (v) => `${v} %` });
  const slOff = slider({ label: 'Disabled', min: 0, max: 100, step: 1, value: 60, format: (v) => `${v}` });
  slOff.input.disabled = true;
  return sec(
    'controls',
    'Segmented, switches, checkboxes, sliders',
    'A selected segment is tinted and shows a check. Switches are Material 3: blue track and white thumb when on. The whole row is the tap target.',
    demo('Segmented (3, with icons)', seg3.el, 'sg-col'),
    demo('Segmented (2)', seg2.el, 'sg-col'),
    demo('Segmented with sub-labels', segSub.el, 'sg-col'),
    demo('Segmented grid (tiles)', segGrid.el, 'sg-col'),
    demo(
      'Switches: off / on / disabled',
      h('div', { class: 'toggle-list', style: 'width:100%' }, [sw('Vibrate on new Danger cards', false, false, 'Off by default'), sw('Pause on Danger', true), sw('High contrast (bright sun)', false, true)]),
      'sg-col',
    ),
    demo('Checkboxes and radios', [check('Roads', false), check('Homes', true), check('Locked', true, true), check('Metric', true, false, true), check('Imperial', false, false, true)], 'sg-col'),
    demo('Sliders: 38 % / 0 % / 100 % / disabled', [sl.el, sl0.el, sl100.el, slOff.el], 'sg-col'),
  );
}

function listsAndCards(): HTMLElement {
  const rows = list([
    listRow({ icon: 'terrain', title: 'Terrain', trailing: '12 MB', chevron: true, onClick: () => undefined }),
    listRow({ icon: 'satellite', title: 'Satellite imagery', sub: 'ESRI World Imagery · saved on device', trailing: originChip('saved'), onClick: () => undefined }),
    listRow({ icon: 'road', title: 'Roads and trails', sub: 'NSW Spatial Services and RFS', sub2: 'Updated 3 days ago · 4.1 MB', chevron: true, onClick: () => undefined }),
    listRow({ icon: 'cloud-off', title: 'Available offline', trailing: badge('On', { tone: 'ok' }) }),
  ]);
  const noLead = list([listRow({ title: 'Units', sub: 'km/h', onClick: () => undefined }), listRow({ title: 'Theme', sub: 'Follow the phone', onClick: () => undefined }), listRow({ title: 'About', chevron: true, onClick: () => undefined })], { noLead: true });
  return sec(
    'lists',
    'Cards and lists',
    'Cards are flat white on the grey background (12 px padding, 12 px radius). List rows are 48 / 52 / 72 px with a 24 px leading icon and 1 px inset dividers.',
    demo(
      'Card',
      h('section', { class: 'card', style: 'width:100%;margin:0' }, [h('h3', { class: 'card-title' }, [icon('flame'), 'Where']), h('p', { class: 't-secondary' }, 'Choose a demo site or use your location.'), h('div', { class: 'row-actions' }, [button({ label: 'Use my location', variant: 'primary', icon: 'my-location' }), button({ label: 'Pick a site', variant: 'secondary' })])]),
      'sg-bg sg-col',
    ),
    demo('List: 1, 2 and 3 lines, trailing value / chip / chevron / badge', h('div', { style: 'width:100%' }, [sectionHeader('Data sets', h('button', { type: 'button', class: 'btn btn-text btn-sm' }, 'See all')), rows]), 'sg-flush sg-col'),
    demo('List without leading icons', noLead, 'sg-flush sg-col'),
    demo('Divider', h('div', { style: 'width:100%' }, [h('p', null, 'Above'), h('hr', { class: 'divider' }), h('p', null, 'Below')]), 'sg-col'),
    demo(
      'Accordion',
      h('details', { style: 'width:100%' }, [h('summary', null, 'Where does this come from?'), h('p', { class: 't-secondary' }, 'Terrain is 1 m LiDAR from NSW Spatial Services.')]),
      'sg-col',
    ),
  );
}

function feedback(): HTMLElement {
  const callout = (cls: string, ic: IconName, title: string, body: string): HTMLElement => h('div', { class: `callout ${cls}`, attrs: { role: 'note' } }, [icon(ic), h('div', null, [h('strong', { class: 't-medium' }, title), h('p', { class: 't-body', style: 'margin:0' }, body)])]);
  const banner = h('div', { class: 'banner banner-warn', attrs: { role: 'status' } }, [icon('cloud-off'), h('span', { class: 'banner-text' }, 'You are offline. Saved data is used.'), button({ label: 'Retry', variant: 'text', size: 'sm' })]);
  const snack = h('div', { class: 'snackbar sg-static', attrs: { role: 'status' } }, [h('span', { class: 'snackbar-text' }, 'Saved on this device'), h('button', { type: 'button', class: 'snackbar-action' }, 'Undo')]);
  const holder = h('div', { style: 'width:100%' });
  const showBtn = button({ label: 'Show a real snackbar', variant: 'secondary', size: 'sm', onClick: () => showSnackbar(document.body, 'Copied to clipboard', { durationMs: 2500 }) });
  return sec(
    'feedback',
    'Callouts, banners, progress, snackbars',
    'Tinted and borderless. A snackbar is feedback to something the user just did; the simulation never toasts.',
    demo(
      'Callouts',
      [callout('callout-info', 'info', 'Good to know', 'Heat maps use the data of the current time.'), callout('callout-warn', 'warning', 'Watch out', 'Wind change at 16:00.'), callout('callout-danger', 'danger', 'Danger', 'Embers can reach the road.'), callout('callout-ok', 'check-circle', 'Ready', 'All data sets are on the device.')],
      'sg-col sg-bg',
    ),
    demo('Banner', h('div', { style: 'width:100%' }, banner), 'sg-flush'),
    demo(
      'Progress: determinate, indeterminate, spinner',
      h('div', { class: 'stack', style: 'width:100%' }, [
        h('div', { class: 'progress', attrs: { role: 'progressbar', 'aria-valuenow': 40, 'aria-valuemin': 0, 'aria-valuemax': 100 } }, h('div', { class: 'progress-fill', style: 'width:40%' })),
        h('div', { class: 'progress progress-indeterminate', attrs: { role: 'progressbar', 'aria-label': 'Loading' } }, h('div', { class: 'progress-fill' })),
        h('span', { class: 'cluster' }, [h('span', { class: 'spinner', style: 'color:var(--primary)' }), h('span', { class: 't-secondary' }, 'Fetching tiles…')]),
      ]),
      'sg-col',
    ),
    demo(
      'Skeleton (flat pulse)',
      h('div', { style: 'width:100%' }, [h('span', { class: 'skeleton skeleton-line', style: 'width:60%' }), h('span', { class: 'skeleton skeleton-line', style: 'width:90%' }), h('span', { class: 'skeleton skeleton-block', style: 'width:100%;height:64px' })]),
      'sg-col',
    ),
    demo('Snackbar', [holder, snack, showBtn].map((x) => x), 'sg-col sg-bg'),
    demo('Empty state', h('div', { class: 'empty', style: 'width:100%' }, [icon('cloud-off', { size: 32 }), h('div', { class: 'empty-title' }, 'Nothing saved yet'), h('p', null, 'Download a site to use it without a signal.')]), 'sg-col'),
  );
}

function navigation(): HTMLElement {
  const nav = bottomNav<'a' | 'b' | 'c' | 'd'>({
    label: 'Demo',
    selected: 'b',
    onSelect: () => undefined,
    items: [
      { id: 'a', label: 'Map', icon: 'map' },
      { id: 'b', label: 'Insights', icon: 'flame', badge: 12 },
      { id: 'c', label: 'Weather', icon: 'cloud' },
      { id: 'd', label: 'Data', icon: 'database' },
    ],
  });
  const appBar = h('header', { class: 'app-bar' }, [iconButton({ icon: 'arrow-back', label: 'Back' }), h('h1', { class: 'app-bar-title' }, 'Data sets'), iconButton({ icon: 'more-vert', label: 'More' })]);
  const search = h('div', { style: 'width:100%;padding:12px;background:var(--bg)' }, topBar({ leading: iconButton({ icon: 'menu', label: 'Menu' }), text: 'Search a place', placeholder: true, trailing: [iconButton({ icon: 'my-location', label: 'My location' })], sub: '35° · 13% · NW 38 km/h' }));
  search.querySelector('.top-bar')?.classList.add('sg-static');
  (search.querySelector('.top-bar') as HTMLElement).style.position = 'static';
  const sheet = bottomSheet({ title: 'Layers', onClose: () => undefined, body: h('p', { class: 't-secondary', style: 'padding:0 16px' }, 'Sheet content goes here.') });
  sheet.classList.add('sg-static');
  const dialog = h('div', { class: 'modal', style: 'max-width:340px;margin:0 auto', attrs: { role: 'dialog', 'aria-label': 'Delete saved site' } }, [
    h('h2', { class: 'dialog-title' }, 'Delete saved site?'),
    h('div', { class: 'dialog-body' }, 'Katoomba (48 MB) will be removed from this device. You can download it again.'),
    h('div', { class: 'dialog-actions' }, [button({ label: 'Cancel', variant: 'text' }), button({ label: 'Delete', variant: 'danger' })]),
  ]);
  const pop = h('div', { class: 'popover sg-static', style: 'position:static' }, list([listRow({ icon: 'copy', title: 'Copy link', onClick: () => undefined }), listRow({ icon: 'share', title: 'Share', onClick: () => undefined }), listRow({ icon: 'trash', title: 'Delete', onClick: () => undefined })]));
  return sec(
    'nav',
    'Bars, sheets, dialogs, popovers',
    'Only floating things carry elevation. Bottom navigation is icon over label; the selected item has a pale-blue pill behind the icon and blue text.',
    demo('Floating top bar (48 px pill + 20 px weather line)', search, 'sg-flush'),
    demo('Top app bar', h('div', { style: 'width:100%' }, appBar), 'sg-flush'),
    demo('Bottom navigation (56 px)', h('div', { style: 'width:100%' }, nav.el), 'sg-flush'),
    demo('Bottom sheet', h('div', { style: 'width:100%;background:var(--bg);padding-top:24px' }, sheet), 'sg-flush'),
    demo('Dialog', h('div', { style: 'width:100%;padding:16px;background:var(--scrim)' }, dialog), 'sg-flush'),
    demo('Popover', h('div', { style: 'width:100%;padding:12px;background:var(--bg)' }, pop), 'sg-flush'),
  );
}

function tiles(): HTMLElement {
  const mapType = tileGrid(
    [
      tile({ label: 'Satellite', icon: 'satellite', selected: true, mode: 'radio' }),
      tile({ label: 'Terrain', icon: 'terrain', mode: 'radio' }),
      tile({ label: 'Plain', icon: 'map', mode: 'radio' }),
    ],
    { cols: 3, label: 'Map type', radio: true },
  );
  const details = tileGrid(
    [
      tile({ label: 'Roads', icon: 'road', selected: true, caption: 'Loaded' }),
      tile({ label: 'Homes', icon: 'home', caption: 'Saved on device' }),
      tile({ label: 'Zones', icon: 'polygon', caption: 'Not downloaded' }),
      tile({ label: 'Trees', icon: 'tree', selected: true, caption: 'Built in' }),
      tile({ label: 'Places', icon: 'text', caption: 'Loaded' }),
      tile({ label: 'Heat', icon: 'flame', caption: 'Needs a run', disabled: true }),
      tile({ label: 'Wind', icon: 'wind', selected: true }),
      tile({ label: 'Fuel', icon: 'leaf' }),
    ],
    { cols: 4, label: 'Map details' },
  );
  return sec(
    'tiles',
    'Tile grid (layer picker)',
    'The Maps "Map type / Map details" pattern: square icon tiles with the label under each; selected = blue frame + check + blue label; disabled = faded; an optional caption line for status.',
    demo('Map type: pick one (3 columns)', mapType, 'sg-flush'),
    demo('Map details: switch on and off (4 columns, captions, one disabled)', details, 'sg-flush'),
  );
}

function dataSheet(): HTMLElement {
  const rows = kv([
    { key: 'Resolution', value: '1 m' },
    { key: 'Coverage', value: '6 × 6 km' },
    { key: 'Size on device', value: [bar(0.42, { label: '42 % of the total', colour: 's1' }), ' 12.4 MB'] },
    { key: 'Origin', value: originChip('live', 'Live · 12 min ago') },
    { key: 'Licence', value: 'CC BY 4.0' },
    { key: 'File', value: h('code', null, 'lidar_-33.71_150.30.tif') },
  ]);
  const table = h('div', { class: 'table-wrap' }, [
    h('table', { class: 'data-table' }, [
      h('thead', null, h('tr', null, [h('th', null, 'Data set'), h('th', { class: 'num' }, 'Size'), h('th', null, 'Share')])),
      h(
        'tbody',
        null,
        [
          ['Terrain', '12.4 MB', 0.42, 's1'],
          ['Imagery', '9.8 MB', 0.33, 's2'],
          ['Roads', '4.1 MB', 0.14, 's3'],
          ['Homes', '3.3 MB', 0.11, 's5'],
        ].map(([n, s, f, c]) => h('tr', null, [h('td', null, String(n)), h('td', { class: 'num' }, String(s)), h('td', { style: 'width:34%' }, bar(f as number, { label: `${Math.round((f as number) * 100)} %`, colour: c as 's1' }))])),
      ),
    ]),
  ]);
  return sec(
    'data',
    'Data-sheet primitives',
    'Key-value rows, big numbers, bars, meters, sparkbars, tables and provenance chips for the data-set information screens.',
    demo('Key-value list', h('div', { style: 'width:100%' }, rows), 'sg-col'),
    demo('Stats', statRow([stat({ value: '46.5', unit: 'MB', caption: 'On this device' }), stat({ value: 7, caption: 'Data sets' }), stat({ value: '3 d', caption: 'Oldest download' })]), 'sg-col'),
    demo('Big stat', stat({ value: '14:29', caption: 'Simulated time', large: true })),
    demo(
      'Bars: neutral, status, stacked',
      h('div', { class: 'stack', style: 'width:100%;--gap:8px' }, [
        bar(0.6, { label: '60 %' }),
        bar(0.3, { label: '30 %', colour: 'ok' }),
        bar(0.75, { label: '75 %', colour: 'watch' }),
        bar(0.9, { label: '90 %', colour: 'danger', large: true }),
        stackedBar(
          [
            { weight: 12.4, colour: 's1', label: 'Terrain' },
            { weight: 9.8, colour: 's2', label: 'Imagery' },
            { weight: 4.1, colour: 's3', label: 'Roads' },
            { weight: 3.3, colour: 's5', label: 'Homes' },
          ],
          { label: 'Terrain 42 %, imagery 33 %, roads 14 %, homes 11 %', large: true },
        ),
      ]),
      'sg-col',
    ),
    demo('Meters', h('div', { class: 'stack', style: 'width:100%;--gap:12px' }, [meter({ label: 'Cache used', valueText: '62 %', fraction: 0.62 }), meter({ label: 'Free space', valueText: '4 %', fraction: 0.04, tone: 'danger' }), meter({ label: 'Downloaded', valueText: '9 of 10', fraction: 0.9, tone: 'ok' })]), 'sg-col'),
    demo('Sparkbar', [sparkbar([2, 5, 9, 4, 12, 7, 3, 8, 10, 6], { label: 'Tile sizes' }), sparkbar([1, 1, 2, 3, 5, 8, 13, 21], { label: 'Growth', colour: 'var(--series-2)' })]),
    demo('Table', table, 'sg-col'),
    demo('Code', h('div', null, ['File ', h('code', null, 'tile_-33.7_150.3.png'), h('pre', { class: 'code-block' }, 'GET /proxy/nswenv/arcgis/rest/services\n  ?f=json&where=1%3D1')]), 'sg-col'),
    demo('Wind arrow and dial', [windArrow(315, 28), h('div', { style: 'width:100%' }, compassRose({ label: 'Wind from', value: 315, size: 160, onChange: () => undefined }).el)]),
  );
}

function iconGallery(): HTMLElement {
  const aliasOf = new Map<string, string[]>();
  for (const [a, c] of Object.entries(ICON_ALIASES)) aliasOf.set(c, [...(aliasOf.get(c) ?? []), a]);
  return sec(
    'icons',
    `Icons (${ICON_NAMES.length})`,
    'Outlined, 24 px grid, 2 px round strokes, currentColor. Aliases in grey are second spellings of the same drawing.',
    demo(
      'Sizes 18 / 24 / 32 and colours',
      [icon('flame', { size: 18 }), icon('flame'), icon('flame', { size: 32 }), h('span', { style: 'color:var(--primary)' }, icon('layers')), h('span', { style: 'color:var(--danger-ink)' }, icon('danger')), h('span', { style: 'color:var(--ok-ink)' }, icon('check-circle')), h('span', { style: 'color:var(--muted)' }, icon('info'))],
    ),
    h('div', { class: 'sg-icons', dataset: { testid: 'icon-gallery' } }, ICON_NAMES.map((n) => h('div', null, [icon(n), h('span', null, n), aliasOf.has(n) ? h('small', null, aliasOf.get(n)!.join(' · ')) : null]))),
  );
}

// ───────────────────────────── page ─────────────────────────────

function header(): HTMLElement {
  const link = (label: string, q: string, current: boolean): HTMLElement => {
    const a = document.createElement('a');
    a.className = current ? 'chip is-selected' : 'chip';
    a.href = `?${q}`;
    a.textContent = label;
    return a;
  };
  const t = document.documentElement.dataset['theme'] === 'dark' ? 'dark' : 'light';
  return h('div', { class: 'sg-head' }, [
    h('h1', null, 'FireSim style guide'),
    h('div', { class: 'chips', style: 'margin:4px 0 0' }, [
      link('Light', 'theme=light', t === 'light' && !contrastHigh),
      link('Night', 'theme=dark', t === 'dark' && !contrastHigh),
      link('Bright sun (light)', 'theme=light&contrast=high', t === 'light' && contrastHigh),
      link('Bright sun (night)', 'theme=dark&contrast=high', t === 'dark' && contrastHigh),
    ]),
    h('p', { class: 't-caption', style: 'margin:4px 0 0' }, `Theme ${t}${contrastHigh ? ' + high contrast' : ''} · status bar ${THEME_CHROME[t].statusBar} · navigation bar ${THEME_CHROME[t].navigationBar}`),
  ]);
}

function build(): void {
  const root = document.getElementById('sg');
  if (!root) return;
  const mq = matchMedia('(prefers-color-scheme: dark)');
  applyAppearance(resolveAppearance({ theme: themeParam === 'light' || themeParam === 'dark' ? themeParam : 'system', highContrast: contrastHigh }, mq.matches), { root: document.documentElement, meta: document.querySelector('meta[name="theme-color"]') });
  if (import.meta.env?.PROD) {
    root.textContent = 'The style guide is a development page and is not part of the production build.';
    return;
  }
  const strip = h('div', { class: 'training-badge', attrs: { role: 'note' } }, [icon('warning'), h('span', { class: 'badge-full' }, 'Training aid · not for operational use'), h('span', { class: 'badge-short' }, 'Training aid only')]);
  const page = h('div', null, [
    header(),
    sec('composite', 'Map screen (composite)', 'Floating top bar, chips, FABs, a bottom sheet and bottom navigation over a map. The training strip stays above everything.', demo('390 × 640', mockScreen(), 'sg-flush')),
    colours(),
    contrastTable(),
    typeScale(),
    scales(),
    buttons(),
    chipsSection(),
    fields(),
    controls(),
    listsAndCards(),
    feedback(),
    navigation(),
    tiles(),
    dataSheet(),
    iconGallery(),
  ]);
  root.replaceChildren(page);
  document.body.insertBefore(strip, root);
  document.documentElement.classList.add('booted');
}

build();
