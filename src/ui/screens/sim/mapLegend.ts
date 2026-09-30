/**
 * The legend on the map, Google-Maps style: a small white card at the bottom of the visible map that collapses to a chip.
 * It shows what is coloured on the map right now — the heat map, else the colour-coded trees, else the cross-section
 * curtain, else the wind streaks — with the site's own ground-height range and the plain-English words of each stop or
 * class (LegendEntry.words). Tap the card to open the Layers panel (the full legend and its explanation are there);
 * the chevron makes it a chip, a tap on the chip brings the card back. Never opens by itself over anything else.
 */
import { h, setChildren } from '../../dom';
import { icon } from '../../icons';
import { fromExternalLegend, overlayLegend, rampGradient, stopWords, type ExternalLegend, type Legend } from '../../legends';
import type { SimContext } from './context';

/** Classes listed on the card; the rest are in the Layers panel. */
const MAX_CLASSES = 4;

/** What is coloured on the map now (pure apart from the providers it is given). */
export function currentMapLegend(ctx: Pick<SimContext, 'layers' | 'legendProvider' | 'sceneLegends' | 'scenario' | 'view'>, viewTime: number): Legend | null {
  const s = ctx.layers.get();
  if (s.overlay !== 'none') {
    const t = ctx.scenario.terrain;
    return overlayLegend(s.overlay, ctx.legendProvider, {
      arrivalMaxSeconds: Math.max(1800, viewTime),
      isochroneMinutes: s.isochroneMinutes,
      ...(Number.isFinite(t.minElevation) && Number.isFinite(t.maxElevation) ? { elevationRange: [t.minElevation, t.maxElevation] as const } : {}),
    });
  }
  // The colour-coded trees (canopy style 'coded'): the renderer describes its own code.
  const coded = s.vegetation && s.canopyStyle === 'coded' ? (ctx.view as { canopyLegend?(): ExternalLegend | null }).canopyLegend?.() : null;
  if (coded) return fromExternalLegend(coded, null);
  const sl = ctx.sceneLegends;
  if (sl && s.crossSection.enabled) return fromExternalLegend(sl.crossSection(), null);
  if (sl && s.wind !== 'off') return fromExternalLegend(sl.wind(s.wind), null);
  return null;
}

export function createMapLegend(ctx: SimContext, onOpenLayers: () => void): { el: HTMLElement; destroy(): void } {
  const el = h('div', { class: 'map-legend', hidden: true, dataset: { testid: 'map-legend', state: 'card' } });
  let collapsed = false;
  let key = '';
  const render = (force = false): void => {
    const s = ctx.layers.get();
    const vt = ctx.session.state.get().viewTime;
    // The arrival-time ramp grows with the elapsed time: refresh it every 30 simulated minutes.
    const k = `${collapsed}|${s.overlay}|${s.isochroneMinutes}|${s.overlay === 'arrival' ? Math.floor(vt / 1800) : ''}|${s.crossSection.enabled}|${s.wind}|${s.vegetation}|${s.canopyStyle}|${s.canopyCode}`;
    if (k === key && !force) return;
    key = k;
    const l = currentMapLegend(ctx, vt);
    el.hidden = !l;
    el.dataset.state = collapsed ? 'chip' : 'card';
    if (!l) {
      setChildren(el, null);
      return;
    }
    const title = [l.title, l.unit ? h('span', { class: 'ml-unit' }, ` (${l.unit})`) : null];
    if (collapsed) {
      const sample =
        l.kind === 'ramp'
          ? h('span', { class: 'ml-chip-ramp', style: { background: l.gradient ?? rampGradient(l.stops) } })
          : h(
              'span',
              { class: 'ml-chip-swatches' },
              l.classes.slice(0, 3).map((c) => h('span', { class: 'swatch', style: { background: c.colour } })),
            );
      setChildren(
        el,
        h(
          'button',
          { type: 'button', class: 'chip chip-float ml-chip', aria: { label: `Legend: ${l.title}. Show the legend.`, expanded: false }, on: { click: () => setCollapsed(false) } },
          [sample, h('span', { class: 'ml-chip-title' }, l.title), icon('chevron-up')],
        ),
      );
      return;
    }
    let body: HTMLElement[];
    if (l.kind === 'ramp') {
      const first = l.stops[0];
      const last = l.stops[l.stops.length - 1];
      const fw = first ? stopWords(first) : '';
      const lw = last ? stopWords(last) : '';
      body = [
        h('span', { class: 'ml-ramp', style: { background: l.gradient ?? rampGradient(l.stops) } }),
        h('span', { class: 'ml-ends' }, [h('span', null, first?.label ?? ''), h('span', null, last?.label ?? '')]),
        fw || lw ? h('span', { class: 'ml-words' }, [h('span', null, fw), h('span', null, lw)]) : null,
      ].filter((x): x is HTMLElement => !!x);
    } else {
      const shown = l.classes.slice(0, MAX_CLASSES);
      body = [
        h(
          'span',
          { class: 'ml-classes' },
          shown.map((c) => {
            const words = stopWords(c);
            return h('span', { class: 'ml-class' }, [h('span', { class: 'swatch', style: { background: c.colour } }), h('span', { class: 'ml-class-label' }, c.label), words && words !== c.label ? h('span', { class: 'ml-class-words' }, words) : null]);
          }),
        ),
      ];
      if (l.classes.length > shown.length) body.push(h('span', { class: 'ml-more' }, `+${l.classes.length - shown.length} more in Layers`));
    }
    setChildren(el, [
      h('button', { type: 'button', class: 'ml-open', aria: { label: `Legend: ${l.title}. Open layers.` }, on: { click: onOpenLayers } }, [h('span', { class: 'ml-title' }, title), ...body]),
      h('button', { type: 'button', class: 'icon-btn ml-collapse', aria: { label: 'Make the legend smaller', expanded: true }, on: { click: () => setCollapsed(true) } }, icon('chevron-down')),
    ]);
  };
  const setCollapsed = (v: boolean): void => {
    collapsed = v;
    render();
    // Keep the focus on the legend for keyboard users (the button they pressed was replaced).
    (el.querySelector('button') as HTMLButtonElement | null)?.focus({ preventScroll: true });
  };
  const u1 = ctx.layers.subscribe(() => render(), ['overlay', 'isochroneMinutes', 'crossSection', 'wind', 'vegetation', 'canopyStyle', 'canopyCode']);
  const u2 = ctx.session.state.subscribe(() => render(), ['viewTime']);
  render();
  return {
    el,
    destroy() {
      u1();
      u2();
    },
  };
}
