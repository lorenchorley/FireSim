/**
 * Layers panel (overlay chooser with legend, display toggles, wind particles, vertical cross-section with an
 * azimuth dial, vertical exaggeration) and What-if panel (coupling, embers, mountain phenomena → re-run from now).
 */
import { h, setChildren } from '../../dom';
import { icon } from '../../icons';
import { formatClock } from '../../format';
import { OVERLAY_OPTIONS, SNAPSHOT_LAYER_OVERLAYS, fromExternalLegend, legendFor, rampGradient, type Legend } from '../../legends';
import type { LayerState } from '../../../render/layers';
import { button, compassRose, segmented, slider, toggle } from '../../widgets';
import type { SimContext } from './context';

function shell(title: string, iconName: Parameters<typeof icon>[0], testId: string, onClose: () => void, body: HTMLElement, footer?: HTMLElement): HTMLElement {
  return h('section', { class: 'tool-panel', dataset: { testid: testId }, aria: { label: title } }, [
    h('header', { class: 'panel-head' }, [
      h('h2', { class: 'panel-title' }, [icon(iconName), title]),
      h('button', { type: 'button', class: 'btn btn-ghost btn-icon', aria: { label: 'Close' }, on: { click: onClose } }, icon('close')),
    ]),
    body,
    footer ? h('footer', { class: 'panel-foot' }, footer) : null,
  ]);
}

/** Legend element for an overlay (ramp bar with ticks, or class swatches with meanings). */
export function legendElement(l: Legend): HTMLElement {
  if (l.kind === 'ramp') {
    return h('div', { class: 'legend', dataset: { testid: 'legend' } }, [
      h('p', { class: 'legend-title' }, [h('strong', null, l.title), l.unit ? h('span', { class: 'legend-unit' }, ` (${l.unit})`) : null]),
      h('div', { class: 'legend-ramp', style: { background: l.gradient ?? rampGradient(l.stops) } }),
      h(
        'div',
        { class: 'legend-ticks' },
        l.stops.map((s) => h('span', null, s.label)),
      ),
      l.extra?.length
        ? h(
            'ul',
            { class: 'legend-classes legend-extra' },
            l.extra.map((c) => h('li', null, [h('span', { class: 'swatch', style: { background: c.colour } }), h('span', { class: 'legend-label' }, c.label)])),
          )
        : null,
      h('p', { class: 'legend-about' }, l.about),
    ]);
  }
  return h('div', { class: 'legend', dataset: { testid: 'legend' } }, [
    h('p', { class: 'legend-title' }, [h('strong', null, l.title), l.unit ? h('span', { class: 'legend-unit' }, ` (${l.unit})`) : null]),
    h(
      'ul',
      { class: 'legend-classes' },
      l.classes.map((c) => h('li', null, [h('span', { class: 'swatch', style: { background: c.colour } }), h('span', { class: 'legend-label' }, c.label), c.note ? h('span', { class: 'legend-note' }, c.note) : null])),
    ),
    h('p', { class: 'legend-about' }, l.about),
  ]);
}

export function createLayersPanel(ctx: SimContext, onClose: () => void): { el: HTMLElement; destroy(): void } {
  const { layers } = ctx;
  const set = (p: Partial<LayerState>): void => {
    layers.set(p);
    ctx.view.setLayers(p);
  };
  const groups = ['Fire', 'Fuel', 'Terrain', 'Mountain'] as const;
  const chooser = h('div', { class: 'overlay-chooser' }, [
    ...groups.map((g) =>
      h('div', { class: 'overlay-group' }, [
        h('span', { class: 'overlay-group-title' }, g),
        h(
          'div',
          { class: 'chip-row' },
          OVERLAY_OPTIONS.filter((o) => o.group === g).map((o) =>
            h('button', { type: 'button', class: 'chip-btn', dataset: { overlay: o.id, testid: `overlay-${o.id}` }, attrs: { 'aria-pressed': 'false' }, on: { click: () => set({ overlay: layers.get().overlay === o.id ? 'none' : o.id }) } }, o.label),
          ),
        ),
      ]),
    ),
  ]);
  const legendHost = h('div', { class: 'legend-host' });
  const opacity = slider({ label: 'Overlay strength', min: 0.2, max: 1, step: 0.05, value: layers.get().overlayOpacity, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => set({ overlayOpacity: v }) });
  const iso = segmented<'0' | '15' | '30' | '60'>({
    label: 'Arrival-time lines',
    options: [
      { value: '0', label: 'Off' },
      { value: '15', label: '15 min' },
      { value: '30', label: '30 min' },
      { value: '60', label: '1 h' },
    ],
    value: String(layers.get().isochroneMinutes) as '0' | '15' | '30' | '60',
    onChange: (v) => set({ isochroneMinutes: Number(v) }),
  });
  const showToggles = h('div', { class: 'toggle-list' }, [
    toggle({ label: 'Aerial imagery', checked: layers.get().imagery, icon: 'map', onChange: (v) => set({ imagery: v }) }).el,
    toggle({ label: 'Trees and shrubs', checked: layers.get().vegetation, icon: 'leaf', onChange: (v) => set({ vegetation: v }) }).el,
    toggle({ label: 'Flames', checked: layers.get().flames, icon: 'flame', onChange: (v) => set({ flames: v }) }).el,
    toggle({ label: 'Smoke', checked: layers.get().smoke, icon: 'wind', onChange: (v) => set({ smoke: v }) }).el,
    toggle({ label: 'Embers', checked: layers.get().embers, icon: 'ember', onChange: (v) => set({ embers: v }) }).el,
    toggle({ label: 'Insight markers', checked: layers.get().insightMarkers, icon: 'info', onChange: (v) => set({ insightMarkers: v }) }).el,
  ]);
  const wind = segmented<LayerState['wind']>({
    label: 'Wind particles',
    options: [
      { value: 'off', label: 'Off' },
      { value: 'surface', label: 'Surface' },
      { value: 'volume', label: 'Through the plume' },
    ],
    value: layers.get().wind,
    testId: 'wind-layer',
    onChange: (v) => set({ wind: v }),
  });
  const csBox = h('div', { class: 'cs-box' });
  const csToggle = toggle({
    label: 'Vertical cross-section',
    description: 'Slice through the atmosphere: warm plume, cold air pools and wind arrows',
    checked: layers.get().crossSection.enabled,
    onChange: (v) => {
      set({ crossSection: { ...layers.get().crossSection, enabled: v, centre: v ? fireCentre(ctx) : layers.get().crossSection.centre } });
      renderCs();
    },
  });
  const renderCs = (): void => {
    const cs = layers.get().crossSection;
    csBox.hidden = !cs.enabled;
    if (!cs.enabled || csBox.childElementCount) return;
    setChildren(csBox, [
      compassRose({ label: 'Section direction', mode: 'towards', value: cs.azimuth, size: 170, onChange: (d) => set({ crossSection: { ...layers.get().crossSection, azimuth: d } }) }).el,
      button({ label: 'Centre on the fire', icon: 'target', variant: 'secondary', onClick: () => set({ crossSection: { ...layers.get().crossSection, centre: fireCentre(ctx) } }) }),
    ]);
  };
  const vex = slider({
    label: 'Vertical exaggeration',
    min: 1,
    max: 3,
    step: 0.25,
    value: layers.get().verticalExaggeration,
    format: (v) => `×${v}`,
    hint: 'Heights are stretched to make the terrain easier to read. Slope numbers and fire speeds always use the true slope.',
    onInput: (v) => set({ verticalExaggeration: v }),
  });

  const render = (): void => {
    const s = layers.get();
    for (const b of chooser.querySelectorAll<HTMLButtonElement>('.chip-btn')) b.setAttribute('aria-pressed', String(b.dataset.overlay === s.overlay));
    const own = legendFor(s.overlay);
    let l = own;
    if (ctx.legendProvider && s.overlay !== 'none') {
      try {
        const ext = ctx.legendProvider(s.overlay, { arrivalMaxSeconds: Math.max(1800, ctx.session.state.get().viewTime), isochroneMinutes: s.isochroneMinutes });
        if (ext) l = fromExternalLegend(ext, own);
      } catch (e) {
        console.warn('[FireSim] renderer legend failed; using the built-in one', e);
      }
    }
    const missing = SNAPSHOT_LAYER_OVERLAYS.has(s.overlay) && !ctx.session.state.get().snapshot?.layers?.[s.overlay];
    setChildren(legendHost, [
      l ? legendElement(l) : h('p', { class: 'hint' }, 'Choose an overlay to colour the terrain. Tap again to turn it off.'),
      missing ? h('p', { class: 'callout callout-info' }, [icon('info'), h('span', null, 'The simulation computes this layer as the fire runs; it appears once there is fire and the engine provides it (not in the demo engine).')]) : null,
    ]);
    opacity.el.hidden = s.overlay === 'none';
    iso.el.hidden = s.overlay !== 'arrival';
  };
  const body = h('div', { class: 'panel-body' }, [
    legendHost,
    chooser,
    opacity.el,
    iso.el,
    h('h3', { class: 'sub-title' }, 'Show'),
    showToggles,
    wind.el,
    csToggle.el,
    csBox,
    vex.el,
  ]);
  const el = shell('Layers', 'layers', 'layers-panel', onClose, body);
  const unsub = layers.subscribe(render, ['overlay', 'isochroneMinutes']);
  render();
  renderCs();
  return { el, destroy: unsub };
}

function fireCentre(ctx: SimContext): [number, number] {
  const ign = ctx.session.state.get().ignitions;
  if (!ign.length) return [0, 0];
  const p = ign[ign.length - 1]!.points[0]!;
  return [p[0], p[1]];
}

export function createWhatIfPanel(ctx: SimContext, onClose: () => void): { el: HTMLElement; destroy(): void } {
  const { session } = ctx;
  const draft = { ...session.state.get().options };
  const tCoupling = toggle({
    label: 'Fire–atmosphere feedback',
    description: 'The fire’s heat drives its own winds (indraft, plume). Off = wind unaffected by the fire.',
    checked: draft.coupling > 0,
    testId: 'whatif-coupling',
    onChange: (v) => (draft.coupling = v ? 1 : 0),
  });
  const tEmbers = toggle({ label: 'Embers and spotting', description: 'Firebrands lofted by the plume start spot fires ahead.', checked: draft.embers, testId: 'whatif-embers', onChange: (v) => (draft.embers = v) });
  const tMountain = toggle({
    label: 'Mountain phenomena',
    description: 'Lee-slope sideways runs (VLS) and eruptive fire in steep gullies.',
    checked: draft.mountainPhenomena,
    testId: 'whatif-mountain',
    onChange: (v) => (draft.mountainPhenomena = v),
  });
  const note = h('p', { class: 'hint' });
  const renderNote = (): void => {
    const s = session.state.get();
    note.textContent = `Re-runs the simulation from ${formatClock(ctx.absTime(s.viewTime), ctx.tz)} with these settings. The Insights and Stats tabs then compare the new run with the one before.`;
  };
  const rerun = button({
    label: 'Re-run from now',
    icon: 'replay',
    variant: 'primary',
    size: 'lg',
    testId: 'whatif-rerun',
    onClick: () => {
      const cur = session.state.get().options;
      const parts: string[] = [];
      if ((draft.coupling > 0) !== (cur.coupling > 0)) parts.push(`feedback ${draft.coupling > 0 ? 'on' : 'off'}`);
      if (draft.embers !== cur.embers) parts.push(`embers ${draft.embers ? 'on' : 'off'}`);
      if (draft.mountainPhenomena !== cur.mountainPhenomena) parts.push(`mountain effects ${draft.mountainPhenomena ? 'on' : 'off'}`);
      session.rerunWith({ ...draft }, parts.length ? parts.join(', ') : 'same settings');
      onClose();
    },
  });
  const body = h('div', { class: 'panel-body' }, [
    h('p', null, 'Switch parts of the physics off to see how much each one matters. Predict first: will the fire be bigger or smaller?'),
    h('div', { class: 'toggle-list' }, [tCoupling.el, tEmbers.el, tMountain.el]),
    note,
  ]);
  const el = shell('What if…', 'whatif', 'whatif-panel', onClose, body, rerun);
  const unsub = session.state.subscribe(renderNote, ['viewTime']);
  renderNote();
  return { el, destroy: unsub };
}
