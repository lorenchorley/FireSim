/**
 * Reusable, accessible field-UI controls. Every control has a hit area of at least 44 x 44 px (see the TAP RULE in
 * src/styles/components.css; the visual size is 32-48 px), is keyboard operable, labelled, and never relies on hover or
 * on colour alone. The newer primitives (chips, list rows, tiles, key-value lists...) are in ./primitives.ts.
 */
import { compassName, wrapDeg } from '../core/units';
import { pushBackLayer } from './backStack';
import { h, setChildren, svg, uniqueId, type Child } from './dom';
import { icon, type IconName } from './icons';
import { iconButton, rangeFill } from './primitives';

/**
 * primary = filled blue; tonal (alias accent) = blue tint; secondary (alias outlined, the default) = outlined pill;
 * ghost (alias text) = text button; danger = filled red.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'tonal' | 'text';

export interface ButtonOptions {
  label: string;
  icon?: IconName;
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  /** Full width. */
  block?: boolean;
  /** Hide the text visually (it stays as the accessible name). */
  iconOnly?: boolean;
  onClick?: (ev: MouseEvent) => void;
  class?: string;
  disabled?: boolean;
  testId?: string;
}

export function button(o: ButtonOptions): HTMLButtonElement {
  return h(
    'button',
    {
      type: 'button',
      class: ['btn', `btn-${o.variant ?? 'secondary'}`, o.size === 'lg' && 'btn-lg', o.size === 'sm' && 'btn-sm', o.block && 'btn-block', o.iconOnly && 'btn-icon', o.class],
      disabled: o.disabled ?? false,
      aria: o.iconOnly ? { label: o.label } : undefined,
      dataset: o.testId ? { testid: o.testId } : undefined,
      on: o.onClick ? { click: o.onClick } : undefined,
    },
    [o.icon ? icon(o.icon) : null, o.iconOnly ? null : h('span', { class: 'btn-text' }, o.label)],
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  sub?: string;
  icon?: IconName;
}

export interface Segmented<T extends string> {
  el: HTMLElement;
  set(v: T): void;
  get(): T;
}

/** Radio group styled as a segmented control (arrow keys move the selection). */
export function segmented<T extends string>(o: {
  label: string;
  options: SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  columns?: number;
  testId?: string;
  hideLabel?: boolean;
}): Segmented<T> {
  const name = uniqueId('seg');
  let value = o.value;
  const inputs: HTMLInputElement[] = [];
  const el = h(
    'fieldset',
    { class: ['segmented', o.options.some((x) => x.sub) && 'segmented-tall'], dataset: o.testId ? { testid: o.testId } : undefined },
    [
      h('legend', { class: o.hideLabel ? 'sr-only' : 'field-label' }, o.label),
      h(
        'div',
        { class: ['segmented-options', !!o.columns && 'segmented-grid'], style: o.columns ? { gridTemplateColumns: `repeat(${o.columns}, minmax(0, 1fr))` } : undefined },
        o.options.map((opt) => {
          const input = h('input', {
            type: 'radio',
            name,
            value: opt.value,
            checked: opt.value === value,
            on: {
              change: () => {
                value = opt.value;
                o.onChange(opt.value);
              },
            },
          });
          inputs.push(input);
          return h('label', { class: 'segmented-option', dataset: { value: opt.value } }, [
            input,
            h('span', { class: 'segmented-face' }, [
              icon('check', { class: 'segmented-check', size: 18 }),
              opt.icon ? icon(opt.icon) : null,
              h('span', { class: 'segmented-text' }, [h('span', { class: 'segmented-main' }, opt.label), opt.sub ? h('span', { class: 'segmented-sub' }, opt.sub) : null]),
            ]),
          ]);
        }),
      ),
    ],
  );
  return {
    el,
    get: () => value,
    set(v: T) {
      value = v;
      for (const i of inputs) i.checked = i.value === v;
    },
  };
}

export interface Toggle {
  el: HTMLElement;
  set(v: boolean): void;
  get(): boolean;
}

/** On/off switch (a checkbox with role="switch"). */
export function toggle(o: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void; icon?: IconName; testId?: string }): Toggle {
  const id = uniqueId('tg');
  const input = h('input', {
    type: 'checkbox',
    id,
    checked: o.checked,
    attrs: { role: 'switch' },
    on: { change: () => o.onChange(input.checked) },
  });
  const el = h('label', { class: 'toggle', htmlFor: id, dataset: o.testId ? { testid: o.testId } : undefined }, [
    o.icon ? icon(o.icon, { class: 'toggle-icon' }) : null,
    h('span', { class: 'toggle-text' }, [h('span', { class: 'toggle-label' }, o.label), o.description ? h('span', { class: 'toggle-desc' }, o.description) : null]),
    input,
    h('span', { class: 'toggle-track', aria: { hidden: true } }, h('span', { class: 'toggle-thumb' })),
  ]);
  return { el, get: () => input.checked, set: (v) => void (input.checked = v) };
}

export interface Slider {
  el: HTMLElement;
  input: HTMLInputElement;
  set(v: number): void;
  get(): number;
}

/** Labelled range slider with a live value readout. */
export function slider(o: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (v: number) => string;
  onInput?: (v: number) => void;
  onChange?: (v: number) => void;
  testId?: string;
  hint?: string;
}): Slider {
  const id = uniqueId('sl');
  const out = h('output', { class: 'slider-value', attrs: { for: id } }, o.format(o.value));
  const input = h('input', {
    type: 'range',
    id,
    min: String(o.min),
    max: String(o.max),
    step: String(o.step),
    value: String(o.value),
    dataset: o.testId ? { testid: o.testId } : undefined,
    on: {
      input: () => {
        const v = Number(input.value);
        out.textContent = o.format(v);
        input.setAttribute('aria-valuetext', o.format(v));
        rangeFill(input);
        o.onInput?.(v);
      },
      change: () => o.onChange?.(Number(input.value)),
    },
  });
  input.setAttribute('aria-valuetext', o.format(o.value));
  rangeFill(input);
  const el = h('div', { class: 'slider' }, [
    h('div', { class: 'slider-head' }, [h('label', { class: 'field-label', htmlFor: id }, o.label), out]),
    input,
    o.hint ? h('p', { class: 'hint' }, o.hint) : null,
  ]);
  return {
    el,
    input,
    get: () => Number(input.value),
    set(v: number) {
      input.value = String(v);
      out.textContent = o.format(v);
      input.setAttribute('aria-valuetext', o.format(v));
      rangeFill(input);
    },
  };
}

/** Labelled numeric input (big, decimal keypad). */
export function numberField(o: {
  label: string;
  value: number;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  onInput: (v: number) => void;
  testId?: string;
}): { el: HTMLElement; input: HTMLInputElement; set(v: number): void } {
  const id = uniqueId('nf');
  const input = h('input', {
    type: 'number',
    id,
    inputMode: 'decimal',
    value: Number.isFinite(o.value) ? String(o.value) : '',
    min: o.min !== undefined ? String(o.min) : '',
    max: o.max !== undefined ? String(o.max) : '',
    step: String(o.step ?? 'any'),
    dataset: o.testId ? { testid: o.testId } : undefined,
    on: { input: () => o.onInput(input.value === '' ? Number.NaN : Number(input.value)) },
  });
  const el = h('div', { class: 'field' }, [
    h('label', { class: 'field-label', htmlFor: id }, o.label),
    h('div', { class: 'input-wrap' }, [input, o.unit ? h('span', { class: 'input-unit', aria: { hidden: true } }, o.unit) : null]),
  ]);
  return { el, input, set: (v) => void (input.value = Number.isFinite(v) ? String(v) : '') };
}

/** Collapsible card section. */
export function section(title: string, children: Child, opts: { icon?: IconName; class?: string; id?: string } = {}): HTMLElement {
  return h('section', { class: ['card', opts.class], id: opts.id, aria: { labelledby: opts.id ? `${opts.id}-h` : undefined } }, [
    h('h2', { class: 'card-title', id: opts.id ? `${opts.id}-h` : undefined }, [opts.icon ? icon(opts.icon) : null, title]),
    children,
  ]);
}

export interface CompassRose {
  el: HTMLElement;
  set(deg: number): void;
  get(): number;
}

/**
 * Direction dial. The user drags (or taps) where the wind comes FROM; arrow keys step 5°, Page keys 45°.
 * `mode: 'from'` draws a wind arrow blowing from the rim towards the centre; 'towards' draws a bearing needle.
 */
export function compassRose(o: { label: string; value: number; onChange: (deg: number) => void; mode?: 'from' | 'towards'; size?: number; testId?: string }): CompassRose {
  const size = o.size ?? 220;
  const mode = o.mode ?? 'from';
  let value = wrapDeg(o.value);
  // Dial: face r = 74, ticks 66–74, labels outside at r ≈ 88, arrow inside (so it never hides a label).
  const ticks: SVGElement[] = [];
  for (let d = 0; d < 360; d += 22.5) {
    const major = d % 90 === 0;
    const a = (d * Math.PI) / 180;
    const r0 = major ? 62 : 67;
    ticks.push(svg('line', { x1: 100 + r0 * Math.sin(a), y1: 100 - r0 * Math.cos(a), x2: 100 + 74 * Math.sin(a), y2: 100 - 74 * Math.cos(a), class: major ? 'rose-tick major' : 'rose-tick' }));
  }
  const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].map((t, i) => {
    const a = (i * 45 * Math.PI) / 180;
    const r = i % 2 === 0 ? 88 : 90;
    return svg('text', { x: 100 + r * Math.sin(a), y: 100 - r * Math.cos(a) + 6, class: i % 2 === 0 ? 'rose-label major' : 'rose-label', 'text-anchor': 'middle' }, t);
  });
  const arrow = svg('g', { class: 'rose-arrow' }, [
    mode === 'from'
      ? svg('path', { d: 'M100 36 L100 70 M100 84 L89 64 L111 64 Z', class: 'rose-arrow-shape' })
      : svg('path', { d: 'M100 30 L111 58 L100 52 L89 58 Z M100 52 L100 100', class: 'rose-arrow-shape' }),
  ]);
  const readout = h('output', { class: 'rose-readout-text' });
  const face = svg('svg', { viewBox: '0 0 200 200', width: size, height: size, class: 'rose-svg', 'aria-hidden': 'true' }, [
    svg('circle', { cx: 100, cy: 100, r: 74, class: 'rose-face' }),
    ...ticks,
    ...labels,
    arrow,
    svg('circle', { cx: 100, cy: 100, r: 10, class: 'rose-hub' }),
  ]);
  const dial = h('div', {
    class: 'rose',
    tabIndex: 0,
    attrs: { role: 'slider', 'aria-valuemin': 0, 'aria-valuemax': 359, 'aria-label': o.label },
    dataset: o.testId ? { testid: o.testId } : undefined,
  }, face);
  const render = (): void => {
    arrow.setAttribute('transform', `rotate(${value} 100 100)`);
    readout.textContent = `${mode === 'from' ? 'From ' : 'Towards '}${compassName(value)} · ${Math.round(value)}°`;
    dial.setAttribute('aria-valuenow', String(Math.round(value)));
    dial.setAttribute('aria-valuetext', `${mode === 'from' ? 'from ' : 'towards '}${compassName(value)}, ${Math.round(value)} degrees`);
  };
  const setFromPointer = (e: PointerEvent): void => {
    const r = face.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) < r.width * 0.08) return;
    value = wrapDeg(Math.round((Math.atan2(dx, -dy) * 180) / Math.PI / 5) * 5);
    render();
    o.onChange(value);
  };
  let dragging = false;
  dial.addEventListener('pointerdown', (e) => {
    dragging = true;
    dial.setPointerCapture?.(e.pointerId);
    setFromPointer(e);
    e.preventDefault();
  });
  dial.addEventListener('pointermove', (e) => dragging && setFromPointer(e));
  dial.addEventListener('pointerup', () => (dragging = false));
  dial.addEventListener('pointercancel', () => (dragging = false));
  dial.addEventListener('keydown', (e) => {
    const step = e.key === 'PageUp' || e.key === 'PageDown' ? 45 : 5;
    let d = 0;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'PageUp') d = step;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'PageDown') d = -step;
    else return;
    e.preventDefault();
    value = wrapDeg(Math.round((value + d) / 5) * 5);
    render();
    o.onChange(value);
  });
  render();
  const el = h('div', { class: 'rose-wrap' }, [h('span', { class: 'field-label' }, o.label), dial, readout]);
  return {
    el,
    get: () => value,
    set(v: number) {
      value = wrapDeg(v);
      render();
    },
  };
}

/** Small arrow icon rotated to point the way the wind BLOWS (towards), for chips and lists. */
export function windArrow(dirFrom: number, size = 22): SVGSVGElement {
  return svg(
    'svg',
    { viewBox: '0 0 24 24', width: size, height: size, class: 'wind-arrow', 'aria-hidden': 'true' },
    svg('path', { d: 'M12 3v15M6.5 13l5.5 7 5.5-7', transform: `rotate(${wrapDeg(dirFrom)} 12 12)`, fill: 'none', stroke: 'currentColor', 'stroke-width': 2.75, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
  );
}

/* === additions from the screens phase === */
// Builders the Setup, Building and Settings screens needed that the design system did not have yet (docs/DESIGN.md §8):
//  - chipChoice()   a single-choice radio group drawn as a row of chips (area, detail, weather source, duration)
//  - appBar()       the Maps top app bar of a full screen: back arrow icon button + left-aligned title + trailing actions
//  - confirmDialog() the confirmation dialog every destructive action asks first with (Back / Escape cancel it)
//  - copyText()     tap-to-copy (licence and provider links: the app never opens an external page by itself)

/**
 * Choice chips: a radio group drawn as chips (CSS `.chip-choice`, components.css). Same keyboard behaviour as any radio
 * group (arrow keys move the selection); the selected chip is tinted and shows a check that replaces its icon, so the
 * choice is never shown by colour alone. Each chip is a <label class="chip"> around a real radio input, so
 * getByRole('radio', { name }) finds it and the hit area is 44 x 44 px (label.chip::after). `scroll` keeps the chips on
 * one horizontally scrolling row (for long option lists on narrow phones).
 */
export function chipChoice<T extends string>(o: {
  label: string;
  options: { value: T; label: string; icon?: IconName }[];
  value: T;
  onChange: (v: T) => void;
  testId?: string;
  hideLabel?: boolean;
  scroll?: boolean;
}): Segmented<T> & { setOptions(options: { value: T; label: string; icon?: IconName }[]): void } {
  const name = uniqueId('chips');
  let value = o.value;
  const row = h('div', { class: ['chips', o.scroll && 'chips-scroll'] });
  const el = h('fieldset', { class: 'chip-choice', dataset: o.testId ? { testid: o.testId } : undefined }, [h('legend', { class: o.hideLabel ? 'sr-only' : 'field-label' }, o.label), row]);
  const mark = (): void => {
    let chosen: HTMLElement | null = null;
    for (const l of row.querySelectorAll<HTMLLabelElement>('label.chip')) {
      const input = l.querySelector('input')!;
      input.checked = input.value === value;
      l.classList.toggle('is-selected', input.checked);
      if (input.checked) chosen = l;
    }
    // A scrolling row keeps the chosen chip in view (sideways only: the page itself never jumps).
    if (o.scroll && chosen) {
      const c = chosen;
      requestAnimationFrame(() => {
        const pad = 12;
        if (c.offsetLeft - pad < row.scrollLeft) row.scrollLeft = c.offsetLeft - pad;
        else if (c.offsetLeft + c.offsetWidth + pad > row.scrollLeft + row.clientWidth) row.scrollLeft = c.offsetLeft + c.offsetWidth + pad - row.clientWidth;
      });
    }
  };
  let shown = '';
  const render = (options: { value: T; label: string; icon?: IconName }[]): void => {
    // Same options: keep the chips (and the keyboard focus on them); only the selection is updated.
    const key = JSON.stringify(options.map((x) => [x.value, x.label, x.icon ?? '']));
    if (key === shown) return mark();
    shown = key;
    const focused = row.contains(document.activeElement) ? (document.activeElement as HTMLInputElement).value : null;
    setChildren(
      row,
      options.map((opt) =>
        h('label', { class: 'chip chip-radio', dataset: { value: opt.value } }, [
          h('input', {
            type: 'radio',
            name,
            value: opt.value,
            checked: opt.value === value,
            on: {
              change: () => {
                value = opt.value;
                mark();
                o.onChange(opt.value);
              },
            },
          }),
          icon('check', { class: 'chip-check' }),
          opt.icon ? icon(opt.icon) : null,
          h('span', { class: 'chip-text' }, opt.label),
        ]),
      ),
    );
    mark();
    if (focused !== null) row.querySelector<HTMLInputElement>(`input[value="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
  };
  render(o.options);
  return {
    el,
    get: () => value,
    set(v: T) {
      value = v;
      mark();
    },
    setOptions(options) {
      render(options);
    },
  };
}

/**
 * Top app bar of a full screen (Maps pattern): back-arrow icon button, left-aligned title, optional trailing controls.
 * The back button's accessible name is `backLabel` (default "Back").
 */
export function appBar(o: { title: string; titleId?: string; onBack?: () => void; backLabel?: string; backTestId?: string; trailing?: Child; class?: string }): HTMLElement {
  return h('header', { class: ['app-bar', o.class] }, [
    o.onBack ? iconButton({ icon: 'arrow-back', label: o.backLabel ?? 'Back', onClick: () => o.onBack!(), ...(o.backTestId ? { testId: o.backTestId } : {}) }) : null,
    h('h1', { class: 'app-bar-title', id: o.titleId, tabIndex: -1 }, o.title),
    o.trailing ?? null,
  ]);
}

/**
 * Ask before a destructive action. Resolves true on the confirm button, false on Cancel, Escape, Back or a tap on the
 * scrim. Opened only by a tap (nothing pops up on its own). Focus moves to Cancel (the safe choice) and returns to the
 * control that was focused before. Registered with the app's Back stack, so Android Back cancels it first.
 */
export function confirmDialog(o: { title: string; body: Child; confirmLabel: string; cancelLabel?: string; danger?: boolean; host?: HTMLElement; testId?: string }): Promise<boolean> {
  return new Promise((resolve) => {
    const previous = document.activeElement as HTMLElement | null;
    const titleId = uniqueId('dlg');
    let done = false;
    let removeLayer = (): void => undefined;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      removeLayer();
      scrim.remove();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
      resolve(ok);
    };
    const cancel = button({ label: o.cancelLabel ?? 'Cancel', variant: 'ghost', testId: 'confirm-cancel', onClick: () => finish(false) });
    const ok = button({ label: o.confirmLabel, variant: o.danger ? 'danger' : 'primary', testId: 'confirm-ok', onClick: () => finish(true) });
    const dialog = h('div', { class: 'modal confirm-dialog', attrs: { role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': titleId } }, [
      h('h2', { class: 'dialog-title', id: titleId }, o.title),
      h('div', { class: 'dialog-body' }, o.body),
      h('div', { class: 'dialog-actions' }, [cancel, ok]),
    ]);
    const scrim = h('div', { class: 'modal-scrim', dataset: { testid: o.testId ?? 'confirm-dialog' } }, dialog);
    scrim.addEventListener('click', (e) => {
      if (e.target === scrim) finish(false);
    });
    scrim.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      } else if (e.key === 'Tab') {
        // Two buttons: keep the focus inside the dialog.
        e.preventDefault();
        (document.activeElement === cancel ? ok : cancel).focus();
      }
    });
    (o.host ?? document.getElementById('app') ?? document.body).appendChild(scrim);
    removeLayer = pushBackLayer({ id: 'confirm', close: () => finish(false) });
    cancel.focus();
  });
}

/**
 * Copy a text (a link) to the clipboard. Resolves true when it was copied. Uses the async Clipboard API, else a hidden
 * textarea and execCommand (older WebViews). Never opens the link.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the textarea path */
  }
  try {
    const ta = h('textarea', { value: text, readOnly: true, style: 'position:fixed;left:-9999px;top:0;opacity:0' });
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
