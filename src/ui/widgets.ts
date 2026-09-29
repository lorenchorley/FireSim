/**
 * Reusable, accessible field-UI controls. Every control has a hit area of at least 44 x 44 px (see the TAP RULE in
 * src/styles/components.css; the visual size is 32-48 px), is keyboard operable, labelled, and never relies on hover or
 * on colour alone. The newer primitives (chips, list rows, tiles, key-value lists...) are in ./primitives.ts.
 */
import { compassName, wrapDeg } from '../core/units';
import { h, svg, uniqueId, type Child } from './dom';
import { icon, type IconName } from './icons';
import { rangeFill } from './primitives';

/**
 * primary = filled blue; tonal (alias accent) = blue tint; secondary (alias outlined, the default) = outlined pill;
 * ghost (alias text) = text button; danger = filled red.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent' | 'tonal' | 'outlined' | 'text';

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
