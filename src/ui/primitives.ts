/**
 * Typed builders for the shared design-system primitives (docs/DESIGN.md, live gallery: src/ui/styleguide.html).
 * They only assemble markup with the classes from src/styles/{components,overlays,data}.css, so a screen never needs a
 * one-off style: build it with these (or write the same markup by hand) and it looks and behaves like the rest.
 *
 * Every builder returns a plain element. Accessibility is built in: buttons are <button>, toggles carry aria-pressed,
 * icon-only controls need `label` (it becomes aria-label), decorative icons are aria-hidden (see icons.ts).
 * The 44 px hit-area rule is in the CSS; nothing here can shrink it.
 */
import { append, h, type Child } from './dom';
import { icon, type IconName } from './icons';

// ───────────────────────────── pure helpers (unit-tested) ─────────────────────────────

/** A fraction (0..1) as a CSS percentage string clamped to 0..100 ("42%"); NaN and negatives give "0%". */
export function pct(fraction: number): string {
  if (!Number.isFinite(fraction) || fraction <= 0) return '0%';
  return `${Math.round(Math.min(1, fraction) * 1000) / 10}%`;
}

/** Position of `value` in [min, max] as 0..100 (the --pct of a range input). */
export function rangePercent(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || !(max > min)) return 0;
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}

/** Heights (0..1) for a sparkbar: scaled so the largest value is 1; an empty or all-zero series gives zeros. */
export function sparkHeights(values: readonly number[]): number[] {
  const max = values.reduce((m, v) => (Number.isFinite(v) && v > m ? v : m), 0);
  return values.map((v) => (max > 0 && Number.isFinite(v) && v > 0 ? v / max : 0));
}

/** Draw the active (blue) part of a range slider: keeps --pct in step with the value. widgets.slider() does this itself. */
export function rangeFill(input: HTMLInputElement): void {
  const min = input.min === '' ? 0 : Number(input.min);
  const max = input.max === '' ? 100 : Number(input.max);
  input.style.setProperty('--pct', `${rangePercent(Number(input.value), min, max)}%`);
}

// ───────────────────────────── buttons ─────────────────────────────

export interface IconButtonOptions {
  icon: IconName;
  /** Accessible name (required: an icon button has no visible text). */
  label: string;
  onClick?: (ev: MouseEvent) => void;
  /** 'plain' (default), 'tonal' (blue tint), 'filled' (solid blue). */
  variant?: 'plain' | 'tonal' | 'filled';
  /** Blue icon: the thing it controls is on. Also sets aria-pressed. */
  selected?: boolean;
  disabled?: boolean;
  testId?: string;
  class?: string;
}

/** 40 px round icon button with a 44 px hit area. */
export function iconButton(o: IconButtonOptions): HTMLButtonElement {
  return h(
    'button',
    {
      type: 'button',
      class: ['icon-btn', o.variant === 'tonal' && 'icon-btn-tonal', o.variant === 'filled' && 'icon-btn-filled', o.selected && 'is-selected', o.class],
      disabled: o.disabled ?? false,
      aria: { label: o.label, pressed: o.selected === undefined ? undefined : o.selected },
      dataset: o.testId ? { testid: o.testId } : undefined,
      on: o.onClick ? { click: o.onClick } : undefined,
    },
    icon(o.icon),
  );
}

export interface FabOptions {
  icon: IconName;
  /** Accessible name; also the visible text of an extended FAB. */
  label: string;
  onClick?: (ev: MouseEvent) => void;
  /** Extended pill with the label beside the icon (the Play / Directions pattern). */
  extended?: boolean;
  /** Solid blue (the one primary action of a screen). */
  primary?: boolean;
  /** 40 px instead of 48 px. */
  small?: boolean;
  /** Blue icon: a mode that is on (e.g. my-location following). Sets aria-pressed. */
  active?: boolean;
  disabled?: boolean;
  testId?: string;
  class?: string;
}

/** Round (or extended) floating action button with elevation. */
export function fab(o: FabOptions): HTMLButtonElement {
  return h(
    'button',
    {
      type: 'button',
      class: ['fab', o.small && 'fab-sm', o.extended && 'fab-ext', o.primary && 'fab-primary', o.active && 'is-active', o.class],
      disabled: o.disabled ?? false,
      aria: { label: o.extended ? undefined : o.label, pressed: o.active === undefined ? undefined : o.active },
      dataset: o.testId ? { testid: o.testId } : undefined,
      on: o.onClick ? { click: o.onClick } : undefined,
    },
    [icon(o.icon), o.extended ? h('span', null, o.label) : null],
  );
}

// ───────────────────────────── chips, badges, origin chips ─────────────────────────────

export type Tone = 'neutral' | 'ok' | 'watch' | 'danger' | 'info' | 'fire';

export interface ChipOptions {
  label: string;
  icon?: IconName;
  /**
   * 'filter' (toggle with a check, default when onToggle is given), 'assist' (a plain action), 'input' (removable: shows a close icon),
   * 'status' (a static tinted label; not interactive).
   */
  kind?: 'filter' | 'assist' | 'input' | 'status';
  /** Tint of a status chip. */
  tone?: Tone;
  selected?: boolean;
  /** Elevated white chip for use over the map. */
  float?: boolean;
  disabled?: boolean;
  /** Filter chips: called with the new state after the chip flips itself. */
  onToggle?: (selected: boolean) => void;
  /** Assist and input chips. */
  onClick?: (ev: MouseEvent) => void;
  testId?: string;
}

const CHIP_TONE: Record<Tone, string> = { neutral: 'chip-neutral', ok: 'chip-ok', watch: 'chip-warn', danger: 'chip-danger', info: 'chip-info', fire: 'chip-warn' };

/** 32 px chip (44 px hit area when interactive). */
export function chip(o: ChipOptions): HTMLElement {
  const kind = o.kind ?? (o.onToggle ? 'filter' : o.onClick ? 'assist' : 'status');
  if (kind === 'status') {
    return h('span', { class: ['chip', CHIP_TONE[o.tone ?? 'neutral']], dataset: o.testId ? { testid: o.testId } : undefined }, [o.icon ? icon(o.icon) : null, o.label]);
  }
  const filter = kind === 'filter';
  const el = h(
    'button',
    {
      type: 'button',
      class: ['chip', o.float && 'chip-float', filter && o.selected && 'is-selected'],
      disabled: o.disabled ?? false,
      aria: { pressed: filter ? !!o.selected : undefined },
      dataset: o.testId ? { testid: o.testId } : undefined,
      on: {
        click: (ev) => {
          if (filter) {
            const next = el.getAttribute('aria-pressed') !== 'true';
            setChipSelected(el, next);
            o.onToggle?.(next);
          } else o.onClick?.(ev);
        },
      },
    },
    [
      filter ? icon('check', { class: 'chip-check' }) : null,
      !filter && o.icon ? icon(o.icon) : null,
      o.label,
      kind === 'input' ? icon('close') : null,
    ],
  );
  return el;
}

/** Set the selected state of a filter chip (class + aria-pressed). */
export function setChipSelected(el: HTMLElement, selected: boolean): void {
  el.classList.toggle('is-selected', selected);
  el.setAttribute('aria-pressed', String(selected));
}

export interface BadgeOptions {
  tone?: Tone;
  icon?: IconName;
  /** A coloured dot before the text. */
  dot?: boolean;
  /** Uppercase with tracking (rare: only for real badges such as "New"). */
  caps?: boolean;
}

const BADGE_TONE: Record<Tone, string | false> = { neutral: false, ok: 'badge-ok', watch: 'badge-watch', danger: 'badge-danger', info: 'badge-info', fire: 'badge-fire' };

/** 20 px status pill. */
export function badge(text: string, o: BadgeOptions = {}): HTMLSpanElement {
  return h('span', { class: ['badge', BADGE_TONE[o.tone ?? 'neutral'], o.dot && 'badge-dot', o.caps && 'badge-caps'] }, [o.icon ? icon(o.icon) : null, text]);
}

/** Where a piece of data came from. */
export type Origin = 'live' | 'saved' | 'bundled' | 'synthetic' | 'user';

/** Default wording and icon of each origin (screens may pass their own text, e.g. "Live · 12 min ago"). */
export const ORIGIN_INFO: Readonly<Record<Origin, { label: string; icon: IconName; description: string }>> = {
  live: { label: 'Live', icon: 'cloud', description: 'Fetched from the internet just now' },
  saved: { label: 'Saved on device', icon: 'smartphone', description: 'Downloaded earlier and stored on this device' },
  bundled: { label: 'Built in', icon: 'database', description: 'Ships inside the app' },
  synthetic: { label: 'Estimated', icon: 'tune', description: 'Generated or estimated by the app, not measured' },
  user: { label: 'Entered by you', icon: 'edit', description: 'Typed, drawn or chosen by the user' },
};

/** Provenance chip: colour, icon and word all say where the data came from. */
export function originChip(origin: Origin, text?: string): HTMLSpanElement {
  const info = ORIGIN_INFO[origin];
  return h('span', { class: ['origin-chip', `origin-${origin}`], attrs: { title: info.description } }, [icon(info.icon), text ?? info.label]);
}

// ───────────────────────────── lists ─────────────────────────────

export interface ListRowOptions {
  title: string;
  sub?: string;
  /** Third line (makes it a 72 px row). */
  sub2?: string;
  icon?: IconName;
  /** Trailing content: a value string, an element (badge, switch), or nothing. */
  trailing?: Child;
  /** Show a chevron after the trailing content (navigates somewhere). */
  chevron?: boolean;
  onClick?: (ev: MouseEvent) => void;
  href?: string;
  testId?: string;
  /** Truncate title/sub to one line each. */
  truncate?: boolean;
}

/** One list row: <button>/<a> when it does something, <div> otherwise. Put rows in {@link list}. */
export function listRow(o: ListRowOptions): HTMLElement {
  const lines = o.sub2 ? 'three-line' : o.sub ? 'two-line' : false;
  const trail =
    o.trailing !== undefined || o.chevron ? h('span', { class: 'list-trail' }, [o.trailing, o.chevron ? icon('chevron-right') : null]) : null;
  const body = [
    o.icon ? h('span', { class: 'list-lead' }, icon(o.icon)) : null,
    h('span', { class: 'list-body' }, [
      h('span', { class: ['list-title', o.truncate && 'is-truncate'] }, o.title),
      o.sub ? h('span', { class: ['list-sub', o.truncate && 'is-truncate'] }, o.sub) : null,
      o.sub2 ? h('span', { class: ['list-sub', o.truncate && 'is-truncate'] }, o.sub2) : null,
    ]),
    trail,
  ];
  const cls: (string | false)[] = ['list-row', lines, !o.icon && 'no-lead'];
  const dataset: Record<string, string> = o.testId ? { testid: o.testId } : {};
  if (o.href) {
    // h('a') does not type-check (HTMLAnchorElement.toString), so the anchor is made by hand.
    const a = document.createElement('a');
    a.className = cls.filter(Boolean).join(' ');
    a.href = o.href;
    if (o.testId) a.dataset.testid = o.testId;
    append(a, body);
    return a;
  }
  if (o.onClick) return h('button', { type: 'button', class: cls, dataset, on: { click: o.onClick } }, body);
  return h('div', { class: cls, dataset }, body);
}

/** A <ul class="list"> of rows. `noLead` when no row has a leading icon (the dividers then start at the text). */
export function list(rows: readonly HTMLElement[], o: { noLead?: boolean; label?: string } = {}): HTMLUListElement {
  return h(
    'ul',
    { class: ['list', o.noLead && 'no-lead'], aria: { label: o.label } },
    rows.map((r) => h('li', null, r)),
  );
}

/** Small grey group header above rows, with an optional text action on the right. */
export function sectionHeader(text: string, action?: Child): HTMLElement {
  return h('h3', { class: 'section-header' }, [h('span', null, text), action]);
}

// ───────────────────────────── data-sheet primitives ─────────────────────────────

export interface KvRow {
  key: string;
  value: Child;
}

/** Key-value list: grey key left, tabular value right. `layout: 'left'` left-aligns long values; 'stack' puts the value under the key. */
export function kv(rows: readonly KvRow[], o: { layout?: 'right' | 'left' | 'stack'; dense?: boolean; label?: string } = {}): HTMLDListElement {
  return h(
    'dl',
    { class: ['kv', o.layout === 'left' && 'kv-left', o.layout === 'stack' && 'kv-stack', o.dense && 'kv-dense'], aria: { label: o.label } },
    rows.map((r) => h('div', { class: 'kv-row' }, [h('dt', { class: 'kv-key' }, r.key), h('dd', { class: 'kv-val' }, r.value)])),
  );
}

/** Big number with an optional unit and a caption underneath. */
export function stat(o: { value: string | number; unit?: string; caption: string; large?: boolean }): HTMLElement {
  return h('div', { class: ['stat', o.large && 'stat-lg'] }, [
    h('span', { class: 'stat-num' }, [String(o.value), o.unit ? h('span', { class: 'stat-unit' }, o.unit) : null]),
    h('span', { class: 'stat-cap' }, o.caption),
  ]);
}

/** Several stats in equal columns. */
export function statRow(stats: readonly HTMLElement[]): HTMLElement {
  return h('div', { class: 'stat-row' }, stats);
}

export type BarColour = 'neutral' | 'ok' | 'watch' | 'danger' | 'fire' | 's1' | 's2' | 's3' | 's4' | 's5';

/** Inline proportion bar (6 px). `fraction` is 0..1; `label` is the accessible description ("38 % of the total"). */
export function bar(fraction: number, o: { colour?: BarColour; label: string; large?: boolean }): HTMLSpanElement {
  return h(
    'span',
    { class: ['bar', o.large && 'bar-lg', o.colour && o.colour !== 'neutral' && `bar-${o.colour}`], style: `--v:${pct(fraction)}`, attrs: { role: 'img', 'aria-label': o.label } },
    h('span', { class: 'bar-fill' }),
  );
}

/** One stacked bar made of weighted segments (sizes of several data sets, say). Weights are relative. */
export function stackedBar(segments: readonly { weight: number; colour: BarColour; label: string }[], o: { label: string; large?: boolean }): HTMLSpanElement {
  return h(
    'span',
    { class: ['bar', 'bar-stack', o.large && 'bar-lg'], attrs: { role: 'img', 'aria-label': o.label } },
    segments.map((s) => h('span', { class: ['bar-seg', s.colour !== 'neutral' && `bar-${s.colour}`], style: `--v:${Math.max(0, s.weight)}`, attrs: { title: s.label } })),
  );
}

/** Labelled gauge. `tone` colours the fill (ok / watch / danger); omit for neutral grey. */
export function meter(o: { label: string; valueText: string; fraction: number; tone?: 'ok' | 'watch' | 'danger' }): HTMLElement {
  const value = Math.round(Math.max(0, Math.min(1, o.fraction)) * 100);
  return h(
    'div',
    {
      class: ['meter', o.tone && `meter-${o.tone}`],
      style: `--v:${pct(o.fraction)}`,
      attrs: { role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': value, 'aria-valuetext': o.valueText, 'aria-label': o.label },
    },
    [
      h('div', { class: 'meter-head' }, [h('span', null, o.label), h('span', { class: 'meter-value' }, o.valueText)]),
      h('div', { class: 'meter-track' }, h('div', { class: 'meter-fill' })),
    ],
  );
}

/** Tiny histogram from numbers (24 px high). `label` describes it for screen readers. */
export function sparkbar(values: readonly number[], o: { label: string; colour?: string }): HTMLSpanElement {
  return h(
    'span',
    { class: 'sparkbar', style: o.colour ? `--spark-color:${o.colour}` : undefined, attrs: { role: 'img', 'aria-label': o.label } },
    sparkHeights(values).map((v) => h('i', { style: `--h:${Math.round(v * 100)}%` })),
  );
}

// ───────────────────────────── tiles (layer picker) ─────────────────────────────

export interface TileOptions {
  label: string;
  /** Icon in the thumb, or an image URL. */
  icon?: IconName;
  image?: string;
  /** Small status line under the label ("Loaded", "Not downloaded"). */
  caption?: string;
  selected?: boolean;
  disabled?: boolean;
  /** 'toggle' (aria-pressed, layers you switch on and off; default), 'radio' (one of a set, e.g. map type), 'action'. */
  mode?: 'toggle' | 'radio' | 'action';
  onClick?: (selected: boolean) => void;
  testId?: string;
}

/** One square tile with the label under it. Selected: blue frame + check + blue label. */
export function tile(o: TileOptions): HTMLButtonElement {
  const mode = o.mode ?? 'toggle';
  const el = h(
    'button',
    {
      type: 'button',
      class: ['tile', o.selected && 'is-selected'],
      disabled: o.disabled ?? false,
      attrs: mode === 'radio' ? { role: 'radio', 'aria-checked': String(!!o.selected) } : mode === 'toggle' ? { 'aria-pressed': String(!!o.selected) } : {},
      dataset: o.testId ? { testid: o.testId } : undefined,
      on: {
        click: () => {
          if (mode === 'toggle') setTileSelected(el, el.getAttribute('aria-pressed') !== 'true');
          else if (mode === 'radio') setTileSelected(el, true);
          o.onClick?.(el.classList.contains('is-selected'));
        },
      },
    },
    [
      h('span', { class: 'tile-thumb' }, o.image ? h('img', { src: o.image, alt: '' }) : o.icon ? icon(o.icon) : null),
      h('span', { class: 'tile-label' }, o.label),
      o.caption ? h('span', { class: 'tile-cap' }, o.caption) : null,
    ],
  );
  return el;
}

/** Set a tile's selected state (class + the right ARIA attribute). */
export function setTileSelected(el: HTMLElement, selected: boolean): void {
  el.classList.toggle('is-selected', selected);
  if (el.getAttribute('role') === 'radio') el.setAttribute('aria-checked', String(selected));
  else if (el.hasAttribute('aria-pressed')) el.setAttribute('aria-pressed', String(selected));
}

/** Grid of tiles: 3 or 4 columns. `radio` makes it a radio group whose tiles deselect each other. */
export function tileGrid(tiles: readonly HTMLElement[], o: { cols?: 3 | 4; label: string; radio?: boolean }): HTMLElement {
  const el = h('div', { class: 'tile-grid', style: `--cols:${o.cols ?? 3}`, attrs: { role: o.radio ? 'radiogroup' : 'group', 'aria-label': o.label } }, tiles);
  if (o.radio) {
    el.addEventListener('click', (ev) => {
      const hit = (ev.target as Element).closest('.tile');
      if (!hit) return;
      for (const t of tiles) if (t !== hit) setTileSelected(t, false);
    });
  }
  return el;
}

// ───────────────────────────── inputs ─────────────────────────────

export interface StepperOptions {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  onChange: (value: number) => void;
  testId?: string;
}

/** [-] value [+] : both buttons are 44 x 44 px. Returns the element and a setter. */
export function stepper(o: StepperOptions): { el: HTMLElement; set(v: number): void; get(): number } {
  const step = o.step ?? 1;
  const min = o.min ?? -Infinity;
  const max = o.max ?? Infinity;
  let value = o.value;
  const input = h('input', { class: 'stepper-input', type: 'number', inputMode: 'decimal', value: String(value), aria: { label: o.label }, dataset: o.testId ? { testid: o.testId } : undefined });
  const dec = h('button', { type: 'button', class: 'stepper-btn', aria: { label: `Decrease ${o.label}` } }, icon('minus'));
  const inc = h('button', { type: 'button', class: 'stepper-btn', aria: { label: `Increase ${o.label}` } }, icon('plus'));
  const commit = (v: number): void => {
    value = Math.min(max, Math.max(min, Number.isFinite(v) ? v : value));
    input.value = String(value);
    dec.disabled = value <= min;
    inc.disabled = value >= max;
    o.onChange(value);
  };
  dec.addEventListener('click', () => commit(value - step));
  inc.addEventListener('click', () => commit(value + step));
  input.addEventListener('change', () => commit(Number(input.value)));
  dec.disabled = value <= min;
  inc.disabled = value >= max;
  return {
    el: h('div', { class: 'stepper', attrs: { role: 'group', 'aria-label': o.label } }, [dec, input, inc]),
    get: () => value,
    set(v: number) {
      value = v;
      input.value = String(v);
      dec.disabled = value <= min;
      inc.disabled = value >= max;
    },
  };
}

// ───────────────────────────── bars, sheets, feedback ─────────────────────────────

export interface NavItem<T extends string> {
  id: T;
  label: string;
  icon: IconName;
  /** Count shown on the icon (0 or undefined = none). */
  badge?: number;
}

/** Bottom navigation: icon over label, the selected item gets a pale-blue pill and blue text. */
export function bottomNav<T extends string>(o: { items: readonly NavItem<T>[]; selected: T; label: string; onSelect: (id: T) => void }): { el: HTMLElement; select(id: T): void } {
  const buttons = new Map<T, HTMLButtonElement>();
  const el = h('nav', { class: 'bottom-nav', aria: { label: o.label } });
  const select = (id: T): void => {
    for (const [k, b] of buttons) {
      if (k === id) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    }
  };
  for (const it of o.items) {
    const b = h(
      'button',
      { type: 'button', class: 'nav-item', dataset: { id: it.id, testid: `nav-${it.id}` }, on: { click: () => (select(it.id), o.onSelect(it.id)) } },
      [
        h('span', { class: 'nav-icon' }, [icon(it.icon), it.badge ? h('span', { class: 'nav-badge' }, it.badge > 9 ? '9+' : String(it.badge)) : null]),
        h('span', { class: 'nav-label' }, it.label),
      ],
    );
    buttons.set(it.id, b);
    el.appendChild(b);
  }
  select(o.selected);
  return { el, select };
}

/** Floating pill top bar (search-bar pattern): leading control, text, trailing controls; optional compact line under it. */
export function topBar(o: { leading?: HTMLElement; text: string; placeholder?: boolean; trailing?: readonly HTMLElement[]; sub?: Child; onTextClick?: () => void }): HTMLElement {
  const text = o.onTextClick
    ? h('button', { type: 'button', class: ['search-bar-text', o.placeholder && 'is-placeholder'], on: { click: o.onTextClick } }, o.text)
    : h('div', { class: ['search-bar-text', o.placeholder && 'is-placeholder'] }, o.text);
  return h('div', { class: 'top-bar' }, [h('div', { class: 'search-bar' }, [o.leading, text, ...(o.trailing ?? [])]), o.sub ? h('div', { class: 'top-bar-sub' }, o.sub) : null]);
}

/** Bottom-sheet shell (white, 20 px top radius, grab handle). Position it where it is used. */
export function bottomSheet(o: { title: string; body: Child; onClose?: () => void; onGrab?: () => void }): HTMLElement {
  return h('div', { class: 'bottom-sheet', attrs: { role: 'dialog', 'aria-label': o.title } }, [
    h('button', { type: 'button', class: 'bottom-sheet-grab', aria: { label: 'Resize panel' }, on: o.onGrab ? { click: o.onGrab } : undefined }),
    h('div', { class: 'bottom-sheet-head' }, [
      h('h2', { class: 'bottom-sheet-title' }, o.title),
      o.onClose ? iconButton({ icon: 'close', label: `Close ${o.title}`, onClick: o.onClose }) : null,
    ]),
    h('div', { class: 'bottom-sheet-body' }, o.body),
  ]);
}

export interface SnackbarOptions {
  /** Text action on the right ("Undo"). */
  action?: { label: string; onClick: () => void };
  /** Milliseconds before it goes away by itself (default 4000; 0 = stays until dismissed). */
  durationMs?: number;
}

/**
 * Show a dark snackbar at the bottom of `host` and return a dismiss function. Use it only as feedback to something the user
 * just did; the simulation never toasts (project rule: nothing pops up on its own).
 */
export function showSnackbar(host: HTMLElement, text: string, o: SnackbarOptions = {}): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const el = h('div', { class: 'snackbar', attrs: { role: 'status' } }, [
    h('span', { class: 'snackbar-text' }, text),
    o.action
      ? h('button', { type: 'button', class: 'snackbar-action', on: { click: () => (o.action!.onClick(), dismiss()) } }, o.action.label)
      : null,
  ]);
  function dismiss(): void {
    if (timer) clearTimeout(timer);
    el.remove();
  }
  host.appendChild(el);
  const ms = o.durationMs ?? 4000;
  if (ms > 0) timer = setTimeout(dismiss, ms);
  return dismiss;
}
