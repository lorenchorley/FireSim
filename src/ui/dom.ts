/**
 * A tiny, typed DOM toolkit for FireSim's vanilla-TypeScript UI (no framework).
 *
 *   h('button', { class: 'btn', type: 'button', on: { click: go }, aria: { label: 'Play' } }, ['Play'])
 *
 * - `props` accepts any writable property of the element (`id`, `type`, `value`, `checked`, `disabled`, `title`, …),
 *   plus the extras in {@link ExtraProps}: `class` (string or list with falsy entries skipped), `style` (object or
 *   string), `dataset`, `attrs` (raw attributes; `null`/`false` removes), `aria` (→ `aria-*`), `on` (typed listeners)
 *   and `ref`.
 * - `children` is a node, a string/number (text), `null`/`undefined`/`false` (skipped) or a nested array of these.
 * - {@link svg} does the same for SVG elements (attributes only).
 */

export type Child = Node | string | number | null | undefined | false | readonly Child[];

type Listeners = { [E in keyof HTMLElementEventMap]?: (ev: HTMLElementEventMap[E]) => void };

export interface ExtraProps<E extends Element> {
  class?: string | readonly (string | false | null | undefined)[];
  style?: Partial<Record<keyof CSSStyleDeclaration, string>> | string;
  dataset?: Record<string, string | number | boolean | undefined>;
  attrs?: Record<string, string | number | boolean | null | undefined>;
  aria?: Record<string, string | number | boolean | null | undefined>;
  on?: Listeners;
  ref?: (el: E) => void;
}

type Writable<T> = { -readonly [P in keyof T]?: T[P] extends (...args: never[]) => unknown ? never : T[P] };
type ElementProps<K extends keyof HTMLElementTagNameMap> = Omit<
  Writable<HTMLElementTagNameMap[K]>,
  'style' | 'className' | 'dataset' | 'children' | 'classList' | 'attributes'
>;
export type HProps<K extends keyof HTMLElementTagNameMap> = ElementProps<K> & ExtraProps<HTMLElementTagNameMap[K]>;

const EXTRA_KEYS = new Set(['class', 'style', 'dataset', 'attrs', 'aria', 'on', 'ref']);

/** Append children (flattening arrays, skipping empty values). */
export function append(parent: Node, children: Child): void {
  if (children === null || children === undefined || children === false) return;
  if (Array.isArray(children)) {
    for (const c of children as readonly Child[]) append(parent, c);
    return;
  }
  if (children instanceof Node) parent.appendChild(children);
  else parent.appendChild(document.createTextNode(String(children)));
}

function setAttr(el: Element, name: string, v: string | number | boolean | null | undefined): void {
  if (v === null || v === undefined || v === false) el.removeAttribute(name);
  else el.setAttribute(name, v === true ? '' : String(v));
}

function classString(c: ExtraProps<Element>['class']): string {
  if (c === undefined) return '';
  if (typeof c === 'string') return c;
  return c.filter((x): x is string => typeof x === 'string' && x.length > 0).join(' ');
}

function applyExtras<E extends Element>(el: E, p: ExtraProps<E>): void {
  if (p.class !== undefined) el.setAttribute('class', classString(p.class));
  if (p.style !== undefined) {
    const s = (el as unknown as HTMLElement).style;
    if (typeof p.style === 'string') s.cssText = p.style;
    else for (const [k, v] of Object.entries(p.style)) if (v !== undefined) (s as unknown as Record<string, string>)[k] = v;
  }
  if (p.dataset) for (const [k, v] of Object.entries(p.dataset)) if (v !== undefined) (el as unknown as HTMLElement).dataset[k] = String(v);
  if (p.attrs) for (const [k, v] of Object.entries(p.attrs)) setAttr(el, k, v);
  if (p.aria) for (const [k, v] of Object.entries(p.aria)) setAttr(el, `aria-${k}`, typeof v === 'boolean' ? String(v) : v);
  if (p.on) for (const [type, fn] of Object.entries(p.on)) if (fn) el.addEventListener(type, fn as EventListener);
}

/** Create an HTML element. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: HProps<K> | null, children?: Child): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (EXTRA_KEYS.has(k) || v === undefined) continue;
      (el as unknown as Record<string, unknown>)[k] = v;
    }
    applyExtras(el, props as ExtraProps<HTMLElementTagNameMap[K]>);
  }
  if (children !== undefined) append(el, children);
  if (props?.ref) props.ref(el);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Create an SVG element; all props are attributes (except `on`, `class`, `style`, `aria`, `ref`). */
export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs?: (Record<string, string | number | boolean | null | undefined> & ExtraProps<SVGElementTagNameMap[K]>) | null,
  children?: Child,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (EXTRA_KEYS.has(k)) continue;
      setAttr(el, k, v as string | number | boolean | null | undefined);
    }
    applyExtras(el, attrs as ExtraProps<SVGElementTagNameMap[K]>);
  }
  if (children !== undefined) append(el, children);
  const ref = (attrs as ExtraProps<SVGElementTagNameMap[K]> | null | undefined)?.ref;
  if (ref) ref(el);
  return el;
}

/** Replace all children of `el`. */
export function setChildren(el: Node, children: Child): void {
  while (el.firstChild) el.removeChild(el.firstChild);
  append(el, children);
}

/** Events of elements, the document (e.g. `visibilitychange`) and the window (e.g. `popstate`). */
type AnyEventMap = HTMLElementEventMap & DocumentEventMap & WindowEventMap;

/** Add a typed event listener; returns a function that removes it. */
export function listen<K extends keyof AnyEventMap>(
  target: HTMLElement | Document | Window,
  type: K,
  fn: (ev: AnyEventMap[K]) => void,
  opts?: AddEventListenerOptions,
): () => void {
  target.addEventListener(type, fn as EventListener, opts);
  return () => target.removeEventListener(type, fn as EventListener, opts);
}

/** Show/hide with the `hidden` attribute (CSS may animate `[hidden]` via display: none). */
export function show(el: HTMLElement | SVGElement, visible: boolean): void {
  if (visible) el.removeAttribute('hidden');
  else el.setAttribute('hidden', '');
}

/** Toggle a class. */
export function cls(el: Element, name: string, on: boolean): void {
  el.classList.toggle(name, on);
}

/** Set text only when it changed (cheap to call every frame). */
export function text(el: Node, value: string): void {
  if (el.textContent !== value) el.textContent = value;
}

/** Generate a short unique id for DOM ids / edit ids. */
let uid = 0;
export function uniqueId(prefix = 'id'): string {
  uid += 1;
  return `${prefix}-${Date.now().toString(36)}-${uid.toString(36)}`;
}

/** True if the user asked the OS to reduce motion. */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Short haptic pulse where supported (Android WebView / Chrome; ignored elsewhere). */
export function vibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
  } catch {
    /* not allowed without a user gesture on some browsers */
  }
}
