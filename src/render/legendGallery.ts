/**
 * Legends gallery (development page, /src/render/legendGallery.html): renders the legend chip of every heat map and the
 * catalog row of every layer in the light and the dark theme, so the colours, words and notes can be checked by eye
 * (also as seen with colour blindness: ?cvd=deutan). Each chip shows the legend colours and, right under the bar or
 * next to each swatch, the colours the terrain shader's lookup table really paints for the same values.
 */
import { LAYER_CATALOG, LAYER_GROUPS, LAYER_GROUP_BLURBS, layersInGroup, type AvailabilityContext } from './layerCatalog';
import type { OverlayKind } from './layers';
import { LUT_SIZE, crossSectionLegend, legendFor, overlayColour, overlayScale, windLegend, type LegendContext, type LegendSpec } from './legends';

const q = new URLSearchParams(location.search);
const rangeParam = q.get('elev')?.split(',').map(Number);
const ctx: LegendContext = {
  arrivalMaxSeconds: 3 * 3600,
  isochroneMinutes: 30,
  elevationRange: rangeParam && rangeParam.length === 2 && rangeParam.every(Number.isFinite) ? ([rangeParam[0]!, rangeParam[1]!] as const) : ([312, 1047] as const),
};

const NONE: AvailabilityContext = { hasFire: false, has3dAtmosphere: false, hasContext: false, hasGrass: false, hasCanopyData: false, hasImagery: false };
const ALL: AvailabilityContext = { hasFire: true, has3dAtmosphere: true, hasContext: true, hasGrass: true, hasCanopyData: true, hasImagery: true };
const avail = q.get('ctx') === 'all' ? ALL : NONE;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const css = (c: [number, number, number, number]): string => `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${c[3]})`;

/** The strip of colours the shader paints across a continuous legend (256 texels of the LUT). */
function lutStrip(overlay: OverlayKind, spec: LegendSpec): HTMLCanvasElement | null {
  const scale = overlayScale(overlay, ctx);
  if (!scale || (scale.mode !== 'ramp' && scale.mode !== 'cyclic')) return null;
  const c = el('canvas', 'lut');
  c.width = LUT_SIZE;
  c.height = 1;
  const g = c.getContext('2d')!;
  for (let i = 0; i < LUT_SIZE; i++) {
    const lo = scale.log ? 10 ** scale.lo : scale.lo;
    const hi = scale.log ? 10 ** scale.hi : scale.hi;
    const t = (i + 0.5) / LUT_SIZE;
    const v = scale.mode === 'cyclic' ? t * 360 : scale.log ? 10 ** (scale.lo + (scale.hi - scale.lo) * t) : lo + (hi - lo) * t;
    const col = overlayColour(scale, v);
    g.fillStyle = col ? css(col) : 'transparent';
    g.fillRect(i, 0, 1, 1);
  }
  void spec;
  return c;
}

function chip(spec: LegendSpec): HTMLElement {
  const box = el('div', 'chip');
  const h = el('h3', undefined, spec.title);
  if (spec.units) h.append(' ', Object.assign(el('span', 'units'), { textContent: `(${spec.units})` }));
  box.append(h);
  const overlay = spec.overlay as OverlayKind;
  if ((spec.kind === 'continuous' || spec.kind === 'cyclic') && spec.gradient) {
    const bar = el('div', 'bar');
    bar.style.background = spec.gradient;
    box.append(bar);
    const strip = lutStrip(overlay, spec);
    if (strip) box.append(strip);
    const ticks = el('div', 'ticks');
    const step = Math.ceil(spec.entries.length / 6);
    spec.entries.forEach((e, i) => {
      if (spec.entries.length > 6 && i % step !== 0 && i !== spec.entries.length - 1) return;
      const s = el('span');
      s.append(Object.assign(el('b'), { textContent: e.label }));
      if (e.words) s.append(e.words);
      ticks.append(s);
    });
    box.append(ticks);
  } else {
    const scale = overlayScale(overlay, ctx);
    for (const e of spec.entries) {
      const item = el('div', 'item');
      const sw = el('span', 'sw');
      sw.style.background = e.colour;
      item.append(sw);
      if (scale && (scale.mode === 'classes' || scale.mode === 'categorical')) {
        // Where the class is wide, sample the middle of it; a category is sampled at its code.
        const idx = spec.entries.indexOf(e);
        const next = spec.entries[idx + 1]?.value ?? e.value * 1.5 + 1;
        const v = scale.mode === 'categorical' ? e.value : scale.log ? Math.sqrt(e.value * next) : (e.value + next) / 2;
        const col = overlayColour(scale, v);
        const l = el('span', 'sw lut');
        l.style.background = col ? css(col) : 'transparent';
        item.append(l);
      }
      const t = el('span', undefined, e.label);
      if (e.words) t.append(Object.assign(el('small'), { textContent: e.words }));
      item.append(t);
      box.append(item);
    }
  }
  if (spec.noData) {
    const item = el('div', 'item nodata');
    const sw = el('span', 'sw');
    sw.style.background = spec.noData.colour;
    item.append(sw, el('span', undefined, spec.noData.label));
    box.append(item);
  }
  if (spec.note) box.append(el('div', 'note', spec.note));
  return box;
}

function row(l: (typeof LAYER_CATALOG)[number]): HTMLElement {
  const box = el('div', 'row');
  const h = el('h3');
  h.append(el('span', 'badge', l.kind), l.title);
  box.append(h, el('p', undefined, l.what), el('p', 'why', l.why));
  const a = l.available(avail);
  if (!a.ok) box.append(el('p', 'unavailable', a.reason));
  box.append(el('p', 'meta', `${l.dimension} · ${l.source()} · ${l.resolution({ fireCellSize: 30 })}`));
  return box;
}

function theme(name: 'light' | 'dark'): HTMLElement {
  const root = el('div', `theme ${name}`);
  const cvd = q.get('cvd');
  if (cvd) root.style.filter = `url(#${cvd})`;
  root.append(el('h1', undefined, `Legends · ${name} theme${cvd ? ` · ${cvd}` : ''}`));
  const shown = new Set<string>();
  for (const g of LAYER_GROUPS) {
    root.append(el('h2', undefined, g));
    for (const l of layersInGroup(g)) {
      if (!l.heat) continue;
      const spec = legendFor(l.heat.overlay, ctx);
      if (spec) {
        root.append(chip(spec));
        shown.add(l.heat.overlay);
      }
    }
  }
  root.append(el('h2', undefined, 'Other legends'), chip(crossSectionLegend()), chip(windLegend('surface')), chip(windLegend('volume')));
  if (q.get('catalog') !== '0') {
    root.append(el('h2', undefined, 'Layer catalog'));
    for (const g of LAYER_GROUPS) {
      root.append(el('h2', undefined, g), el('p', 'note', LAYER_GROUP_BLURBS[g]));
      for (const l of layersInGroup(g)) root.append(row(l));
    }
  }
  return root;
}

const root = document.getElementById('root')!;
const which = q.get('theme') ?? 'both';
if (which !== 'dark') root.append(theme('light'));
if (which !== 'light') root.append(theme('dark'));
(window as unknown as { __gallery: boolean }).__gallery = true;
