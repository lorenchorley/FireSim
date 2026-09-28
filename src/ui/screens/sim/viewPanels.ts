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
import { has3dAtmosphere, type SimContext } from './context';

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
  // The fast tier (auto-tune on slower devices) has no 3-D atmosphere: offer the switch where it matters.
  const need3d = h('div', { class: 'callout callout-info need-3d', hidden: true, dataset: { testid: 'need-3d' } });
  const renderNeed3d = (): void => {
    const l = layers.get();
    const snap = ctx.session.state.get().snapshot;
    const wants = l.crossSection.enabled || l.wind === 'volume';
    need3d.hidden = !wants || !snap || has3dAtmosphere(snap);
    if (need3d.hidden || need3d.childElementCount) return;
    setChildren(need3d, [
      icon('info'),
      h('div', null, [
        h('p', null, 'This run uses the fast surface-wind model (picked for this device’s speed), so there is no 3-D plume or cold air to slice through.'),
        button({
          label: 'Use the 3-D atmosphere',
          icon: 'cube',
          variant: 'secondary',
          testId: 'use-3d',
          onClick: () => {
            ctx.session.controller.setQuality('standard');
            setChildren(need3d, [icon('info'), h('p', null, 'Re-computing with the 3-D atmosphere from the last checkpoint… press Play to continue.')]);
            ctx.announce('Switching to the 3-D atmosphere. The simulation re-computes from the last checkpoint.');
          },
        }),
      ]),
    ]);
  };
  const csBox = h('div', { class: 'cs-box' });
  const csToggle = toggle({
    label: 'Vertical cross-section',
    description: 'Slice through the atmosphere: warm plume, cold air pools and wind arrows',
    checked: layers.get().crossSection.enabled,
    testId: 'cross-section',
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
      h('div', { class: 'row-actions' }, [
        button({ label: 'Centre on the fire', icon: 'target', variant: 'secondary', onClick: () => set({ crossSection: { ...layers.get().crossSection, centre: fireCentre(ctx) } }) }),
        ctx.view.viewSection
          ? button({
              label: 'View from the side',
              icon: 'eye',
              variant: 'secondary',
              testId: 'cs-view',
              onClick: () => {
                ctx.ui.set({ viewMode: 'orbit' });
                ctx.view.viewSection?.();
                ctx.announce('Looking at the cross-section from the side.');
              },
            })
          : null,
      ]),
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
    const l = currentLegend(ctx);
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
    need3d,
    csBox,
    vex.el,
  ]);
  const el = shell('Layers', 'layers', 'layers-panel', onClose, body);
  const unsub = layers.subscribe(render, ['overlay', 'isochroneMinutes']);
  const unsub3d = layers.subscribe(renderNeed3d, ['crossSection', 'wind']);
  const unsubSnap = ctx.session.state.subscribe(() => {
    const was = need3d.hidden;
    renderNeed3d();
    // Once the 3-D snapshots arrive, forget the old message so it can be shown again later if needed.
    if (need3d.hidden && !was) setChildren(need3d, null);
  }, ['snapshot']);
  render();
  renderCs();
  renderNeed3d();
  return {
    el,
    destroy() {
      unsub();
      unsub3d();
      unsubSnap();
    },
  };
}

/** Legend of the active overlay: the renderer's (exact colours and ranges) with the UI's teaching text, else the UI's. */
export function currentLegend(ctx: SimContext): Legend | null {
  const s = ctx.layers.get();
  const own = legendFor(s.overlay);
  if (ctx.legendProvider && s.overlay !== 'none') {
    try {
      const ext = ctx.legendProvider(s.overlay, { arrivalMaxSeconds: Math.max(1800, ctx.session.state.get().viewTime), isochroneMinutes: s.isochroneMinutes });
      if (ext) return fromExternalLegend(ext, own);
    } catch (e) {
      console.warn('[FireSim] renderer legend failed; using the built-in one', e);
    }
  }
  return own;
}

/**
 * Compact legend on the map while an overlay is shown (the full one with its explanation is in the Layers panel,
 * which a tap opens): title, the colour ramp with its end labels, or the first classes.
 */
export function createMapLegend(ctx: SimContext, onOpen: () => void): { el: HTMLElement; destroy(): void } {
  const el = h('button', { type: 'button', class: 'map-legend', hidden: true, dataset: { testid: 'map-legend' }, on: { click: onOpen } });
  let key = '';
  const render = (): void => {
    const s = ctx.layers.get();
    const vt = ctx.session.state.get().viewTime;
    // The arrival-time ramp grows with the elapsed time: refresh it every 30 simulated minutes.
    const k = `${s.overlay}|${s.isochroneMinutes}|${s.overlay === 'arrival' ? Math.floor(vt / 1800) : ''}|${s.crossSection.enabled}|${s.wind}`;
    if (k === key) return;
    key = k;
    // What is coloured on the map: the terrain overlay, else the cross-section curtain, else the wind streaks.
    const sl = ctx.sceneLegends;
    const l =
      s.overlay !== 'none'
        ? currentLegend(ctx)
        : sl && s.crossSection.enabled
          ? fromExternalLegend(sl.crossSection(), null)
          : sl && s.wind !== 'off'
            ? fromExternalLegend(sl.wind(s.wind), null)
            : null;
    el.hidden = !l;
    if (!l) {
      setChildren(el, null);
      return;
    }
    el.setAttribute('aria-label', `Legend: ${l.title}. Open layers.`);
    const title = h('span', { class: 'ml-title' }, [l.title, l.unit ? h('span', { class: 'ml-unit' }, ` (${l.unit})`) : null]);
    if (l.kind === 'ramp') {
      const first = l.stops[0]?.label ?? '';
      const last = l.stops[l.stops.length - 1]?.label ?? '';
      setChildren(el, [
        title,
        h('span', { class: 'ml-ramp', style: { background: l.gradient ?? rampGradient(l.stops) } }),
        h('span', { class: 'ml-ends' }, [h('span', null, first), h('span', null, last)]),
      ]);
    } else {
      const shown = l.classes.slice(0, 4);
      setChildren(el, [
        title,
        h(
          'span',
          { class: 'ml-classes' },
          shown.map((c) => h('span', { class: 'ml-class' }, [h('span', { class: 'swatch', style: { background: c.colour } }), c.label])),
        ),
        l.classes.length > shown.length ? h('span', { class: 'ml-more' }, `+${l.classes.length - shown.length} more`) : null,
      ]);
    }
  };
  const u1 = ctx.layers.subscribe(render, ['overlay', 'isochroneMinutes', 'crossSection', 'wind']);
  const u2 = ctx.session.state.subscribe(render, ['viewTime']);
  render();
  return {
    el,
    destroy() {
      u1();
      u2();
    },
  };
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
