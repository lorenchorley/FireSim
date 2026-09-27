/**
 * Tool panels that change the scenario: Mark fire (point / finger-drawn line; current fire, spot fire ahead, back
 * burn), Fuel brush (plain-language presets, radius, tap or paint) and Local wind (point + direction dial + speed).
 * Placement is two-step (place → confirm) because wet screens and gloves cause phantom touches (doc 09 §9);
 * every tool also works from the screen-centre crosshair for gloved hands.
 */
import type { Ignition, WindEdit } from '../../../core/types';
import { kmhToMs } from '../../../core/units';
import { h, setChildren, uniqueId } from '../../dom';
import { icon } from '../../icons';
import { polygonArea, polylineLength, strokeToPolygon } from '../../brushGeometry';
import { formatArea, formatClock, formatDistance, formatElapsedShort, formatWind, compassName } from '../../format';
import { FUEL_PRESETS, fuelEditFor, presetById } from '../../fuelPresets';
import { button, compassRose, segmented, slider } from '../../widgets';
import type { SimContext } from './context';

const ORIGIN_LABEL: Record<Ignition['origin'], string> = { observed: 'Current fire', spot: 'Spot fire ahead', backburn: 'Back burn' };

/**
 * Panel frame: header, scrolling body, and a fixed action bar (`actions`) that holds the confirm / clear buttons for
 * whatever is being placed. The bar sits outside the scroll area so "Add fire" / "Apply" is always in thumb reach,
 * even after scrolling down to the crosshair button; it collapses when empty.
 */
function panelShell(title: string, iconName: Parameters<typeof icon>[0], testId: string, onClose: () => void, body: HTMLElement, actions: HTMLElement): HTMLElement {
  actions.classList.add('panel-foot', 'pending-box');
  actions.setAttribute('aria-live', 'polite');
  return h('section', { class: 'tool-panel', dataset: { testid: testId }, aria: { label: title } }, [
    h('header', { class: 'panel-head' }, [
      h('h2', { class: 'panel-title' }, [icon(iconName), title]),
      h('button', { type: 'button', class: 'btn btn-ghost btn-icon', aria: { label: 'Close tool' }, on: { click: onClose } }, icon('close')),
    ]),
    body,
    actions,
  ]);
}

function crosshairButton(ctx: SimContext, label: string, onPick: (p: [number, number]) => void): HTMLButtonElement {
  return button({
    label,
    icon: 'crosshair',
    variant: 'secondary',
    testId: 'use-crosshair',
    onClick: () => {
      const p = ctx.pickCrosshair();
      if (p) onPick(p);
      else ctx.announce('The crosshair is not over the terrain.');
    },
  });
}

// ─────────────────────────────── Mark fire ───────────────────────────────

export function createFirePanel(ctx: SimContext, onClose: () => void): { el: HTMLElement; destroy(): void } {
  const { ui, session } = ctx;
  const originSeg = segmented<Ignition['origin']>({
    label: 'What are you marking?',
    hideLabel: true,
    options: [
      { value: 'observed', label: 'Fire now' },
      { value: 'spot', label: 'Spot fire' },
      { value: 'backburn', label: 'Back burn' },
    ],
    value: ui.get().fireOrigin,
    testId: 'fire-origin',
    onChange: (v) => ui.set({ fireOrigin: v }),
  });
  const inputSeg = segmented<'point' | 'line'>({
    label: 'How',
    hideLabel: true,
    options: [
      { value: 'point', label: 'Tap a point', icon: 'point' },
      { value: 'line', label: 'Draw a line', icon: 'line' },
    ],
    value: ui.get().fireInput,
    testId: 'fire-input',
    onChange: (v) => ui.set({ fireInput: v, drawing: v === 'line', pending: null }),
  });
  const sizeSeg = segmented<'20' | '40' | '100'>({
    label: 'Size of the fire now',
    hideLabel: true,
    options: [
      { value: '20', label: '≈ 40 m' },
      { value: '40', label: '≈ 80 m' },
      { value: '100', label: '≈ 200 m' },
    ],
    value: String(ui.get().firePointRadius) as '20' | '40' | '100',
    onChange: (v) => ui.set({ firePointRadius: Number(v) }),
  });
  const pendingBox = h('div');
  const list = h('div', { class: 'edit-list' });
  const instructions = h('p', { class: 'hint' });
  const crossBtn = crosshairButton(ctx, 'Mark at crosshair', (p) => ui.set({ pending: { kind: 'point', at: p } }));

  const confirm = (): void => {
    const s = ui.get();
    const p = s.pending;
    if (!p) return;
    const id = uniqueId('fire');
    if (p.kind === 'point') session.ignite({ id, kind: 'point', points: [p.at], radius: s.firePointRadius, origin: s.fireOrigin });
    else if (p.kind === 'line' && p.points.length >= 2) session.ignite({ id, kind: 'line', points: p.points, origin: s.fireOrigin });
    ui.set({ pending: null });
    ctx.announce(`${ORIGIN_LABEL[s.fireOrigin]} marked at ${formatClock(ctx.absTime(session.state.get().viewTime), ctx.tz)}.`);
  };

  const render = (): void => {
    const s = ui.get();
    originSeg.set(s.fireOrigin);
    inputSeg.set(s.fireInput);
    sizeSeg.el.hidden = s.fireInput !== 'point';
    crossBtn.hidden = s.fireInput !== 'point';
    instructions.textContent =
      s.fireInput === 'point'
        ? 'Tap the map where the fire is (size across), or aim the crosshair.'
        : 'Draw along the fire edge with your finger. The map is locked while drawing.';
    const p = s.pending;
    const ss = session.state.get();
    // Only when the user scrubbed back: while simply paused the worker has usually computed a little ahead, which an
    // edit discards silently.
    const past = ss.reviewing;
    setChildren(
      pendingBox,
      p && (p.kind === 'point' || p.kind === 'line')
        ? [
            h('p', { class: 'pending-text' }, [
              icon(p.kind === 'point' ? 'point' : 'line'),
              p.kind === 'point' ? `${ORIGIN_LABEL[s.fireOrigin]} — point ready` : `${ORIGIN_LABEL[s.fireOrigin]} — line ${formatDistance(polylineLength(p.points))}`,
            ]),
            past ? h('p', { class: 'hint' }, `You are viewing ${formatClock(ctx.absTime(ss.viewTime), ctx.tz)}. Adding the fire re-runs the simulation from then.`) : null,
            h('div', { class: 'row-actions' }, [
              button({ label: 'Add fire', icon: 'check', variant: 'primary', size: 'lg', testId: 'confirm-fire', onClick: confirm }),
              button({ label: 'Clear', icon: 'close', variant: 'secondary', onClick: () => ui.set({ pending: null }) }),
            ]),
          ]
        : null,
    );
    const ign = ss.ignitions;
    setChildren(
      list,
      ign.length
        ? [
            h('h3', { class: 'sub-title' }, 'Marked'),
            h(
              'ul',
              { class: 'plain-list' },
              ign.map((i) =>
                h('li', { class: 'edit-item' }, [
                  h('span', { class: ['dot', `dot-${i.origin}`] }),
                  h('span', null, `${ORIGIN_LABEL[i.origin]} · ${i.kind === 'line' ? `line ${formatDistance(polylineLength(i.points))}` : 'point'} · ${formatClock(ctx.absTime(i.time), ctx.tz)} (${formatElapsedShort(i.time)})`),
                ]),
              ),
            ),
          ]
        : null,
    );
  };
  const body = h('div', { class: 'panel-body' }, [originSeg.el, inputSeg.el, sizeSeg.el, instructions, crossBtn, list]);
  const el = panelShell('Mark fire', 'flame', 'fire-panel', onClose, body, pendingBox);
  const u1 = ui.subscribe(render, ['pending', 'fireOrigin', 'fireInput', 'firePointRadius']);
  const u2 = session.state.subscribe(render, ['ignitions', 'reviewing']);
  render();
  return {
    el,
    destroy() {
      u1();
      u2();
    },
  };
}

// ─────────────────────────────── Fuel brush ───────────────────────────────

export function createFuelPanel(ctx: SimContext, onClose: () => void): { el: HTMLElement; destroy(): void } {
  const { ui, session } = ctx;
  const presets = h(
    'div',
    { class: 'preset-grid', attrs: { role: 'radiogroup', 'aria-label': 'What did you see?' } },
    FUEL_PRESETS.map((p) =>
      h(
        'button',
        {
          type: 'button',
          class: 'preset',
          dataset: { preset: p.id, testid: `fuel-${p.id}` },
          attrs: { role: 'radio' },
          on: { click: () => ui.set({ fuelPreset: p.id }) },
        },
        [h('span', { class: 'swatch', style: { background: p.colour } }), h('span', { class: 'preset-text' }, h('span', { class: 'preset-name' }, p.label))],
      ),
    ),
  );
  const radius = slider({
    label: 'Brush radius',
    min: 25,
    max: 400,
    step: 25,
    value: ui.get().brushRadius,
    format: (v) => `${v} m`,
    onInput: (v) => ui.set({ brushRadius: v }),
  });
  const modeSeg = segmented<'tap' | 'paint'>({
    label: 'How',
    options: [
      { value: 'tap', label: 'Tap', icon: 'point' },
      { value: 'paint', label: 'Paint', icon: 'brush' },
    ],
    value: ui.get().drawing ? 'paint' : 'tap',
    onChange: (v) => ui.set({ drawing: v === 'paint', pending: null }),
  });
  const presetDesc = h('p', { class: 'hint preset-about', attrs: { 'aria-live': 'polite' } });
  const crossBtn = crosshairButton(ctx, 'Brush at crosshair', (p) => ui.set({ pending: { kind: 'brush', points: [p], radius: ui.get().brushRadius } }));
  const pendingBox = h('div');
  const fuelHint = h('p', { class: 'hint' });
  const list = h('div', { class: 'edit-list' });

  const apply = (): void => {
    const s = ui.get();
    const p = s.pending;
    if (!p || p.kind !== 'brush') return;
    const edit = fuelEditFor(s.fuelPreset, p.points, p.radius, uniqueId('fuel'));
    session.edit(edit);
    ui.set({ pending: null });
    ctx.view.setBrushPreview(null);
    ctx.announce(`${presetById(s.fuelPreset).label} applied.`);
  };
  const render = (): void => {
    const s = ui.get();
    for (const b of presets.querySelectorAll<HTMLButtonElement>('.preset')) {
      const on = b.dataset.preset === s.fuelPreset;
      b.classList.toggle('selected', on);
      b.setAttribute('aria-checked', String(on));
    }
    presetDesc.textContent = presetById(s.fuelPreset).description;
    modeSeg.set(s.drawing ? 'paint' : 'tap');
    const p = s.pending;
    if (p && p.kind === 'brush') {
      const area = p.points.length <= 1 ? Math.PI * p.radius * p.radius : polygonArea(strokeToPolygon(p.points, p.radius));
      setChildren(pendingBox, [
        h('p', { class: 'pending-text' }, [h('span', { class: 'swatch', style: { background: presetById(s.fuelPreset).colour } }), `${presetById(s.fuelPreset).label} — about ${formatArea(area / 10_000)}`]),
        h('div', { class: 'row-actions' }, [
          button({ label: 'Apply', icon: 'check', variant: 'primary', size: 'lg', testId: 'apply-fuel', onClick: apply }),
          button({ label: 'Clear', icon: 'close', variant: 'secondary', onClick: () => (ui.set({ pending: null }), ctx.view.setBrushPreview(null)) }),
        ]),
      ]);
    } else setChildren(pendingBox, null);
    fuelHint.textContent = s.drawing ? 'Paint over the area with your finger (the map is locked while painting).' : 'Tap the map to brush a circle, or use the crosshair.';
    const edits = session.state.get().edits.filter((e) => e.edit.kind === 'fuel');
    setChildren(
      list,
      edits.length
        ? [
            h('h3', { class: 'sub-title' }, 'Your fuel changes'),
            h(
              'ul',
              { class: 'plain-list' },
              edits.map(({ edit, time }) =>
                h('li', { class: 'edit-item' }, [
                  h('span', null, `${edit.kind === 'fuel' ? describeFuelEdit(edit) : ''} · from ${formatClock(ctx.absTime(time), ctx.tz)}`),
                  button({ label: 'Remove', icon: 'trash', variant: 'ghost', iconOnly: true, onClick: () => session.removeEdit(edit.id) }),
                ]),
              ),
            ),
          ]
        : null,
    );
  };
  const body = h('div', { class: 'panel-body' }, [h('span', { class: 'field-label' }, 'What did you see?'), presets, presetDesc, radius.el, modeSeg.el, fuelHint, crossBtn, list]);
  const el = panelShell('Fuel brush', 'brush', 'fuel-panel', onClose, body, pendingBox);
  const u1 = ui.subscribe(render, ['pending', 'fuelPreset', 'drawing']);
  const u2 = session.state.subscribe(render, ['edits']);
  render();
  return {
    el,
    destroy() {
      u1();
      u2();
      ctx.view.setBrushPreview(null);
    },
  };
}

function describeFuelEdit(e: { setType?: number; moistureDelta?: number; barkHazardDelta?: number; elevatedHazardDelta?: number; surfaceHazardDelta?: number; setTimeSinceFire?: number }): string {
  if (e.setType !== undefined) return 'No fuel (road/rock)';
  if (e.moistureDelta) return 'Wetter ground';
  if (e.setTimeSinceFire !== undefined) return 'Less fuel (burnt/HR)';
  if (e.barkHazardDelta) return 'Stringybark';
  if (e.elevatedHazardDelta) return 'Denser understorey';
  return 'More leaf litter';
}

// ─────────────────────────────── Local wind ───────────────────────────────

export function createWindPanel(ctx: SimContext, onClose: () => void): { el: HTMLElement; destroy(): void } {
  const { ui, session } = ctx;
  const unit = (): 'kmh' | 'ms' => ctx.settings.get().units;
  const dial = compassRose({ label: 'Wind comes FROM — drag the arrow', value: ui.get().wind.dir, size: 200, testId: 'wind-dial', onChange: (d) => ui.set({ wind: { ...ui.get().wind, dir: d } }) });
  const speed = slider({
    label: 'Wind speed',
    min: 0,
    max: 90,
    step: 5,
    value: ui.get().wind.kmh,
    format: (v) => (unit() === 'kmh' ? `${v} km/h` : `${(v / 3.6).toFixed(1)} m/s`),
    onInput: (v) => ui.set({ wind: { ...ui.get().wind, kmh: v } }),
  });
  const radius = slider({
    label: 'Applies within',
    min: 100,
    max: 2000,
    step: 100,
    value: ui.get().wind.radius,
    format: (v) => formatDistance(v),
    onInput: (v) => ui.set({ wind: { ...ui.get().wind, radius: v } }),
  });
  const crossBtn = crosshairButton(ctx, 'Place at crosshair', (p) => ui.set({ pending: { kind: 'point', at: p } }));
  const meBtn = ctx.user ? button({ label: 'At my position', icon: 'gps', variant: 'secondary', onClick: () => ui.set({ pending: { kind: 'point', at: ctx.user! } }) }) : null;
  const pendingBox = h('div');
  const list = h('div', { class: 'edit-list' });
  const apply = (): void => {
    const s = ui.get();
    const p = s.pending;
    if (!p || p.kind !== 'point') return;
    const e: WindEdit = { kind: 'wind', id: uniqueId('wind'), x: p.at[0], y: p.at[1], radius: s.wind.radius, speed: kmhToMs(s.wind.kmh), dir: s.wind.dir, time: session.state.get().viewTime };
    session.edit(e);
    ui.set({ pending: null });
    ctx.announce(`Local wind from ${compassName(e.dir)} applied.`);
  };
  const render = (): void => {
    const s = ui.get();
    const p = s.pending;
    setChildren(
      pendingBox,
      p && p.kind === 'point'
        ? h('div', { class: 'row-actions' }, [
            button({ label: `Apply ${compassName(s.wind.dir)} ${unit() === 'kmh' ? `${s.wind.kmh} km/h` : `${(s.wind.kmh / 3.6).toFixed(1)} m/s`}`, icon: 'check', variant: 'primary', size: 'lg', testId: 'apply-wind', onClick: apply }),
            button({ label: 'Clear', icon: 'close', variant: 'secondary', onClick: () => ui.set({ pending: null }) }),
          ])
        : null,
    );
    const edits = session.state.get().edits.filter((e) => e.edit.kind === 'wind');
    setChildren(
      list,
      edits.length
        ? [
            h('h3', { class: 'sub-title' }, 'Your wind observations'),
            h(
              'ul',
              { class: 'plain-list' },
              edits.map(({ edit, time }) =>
                h('li', { class: 'edit-item' }, [
                  h('span', null, edit.kind === 'wind' ? `From ${compassName(edit.dir)} ${formatWind(edit.speed, unit())} within ${formatDistance(edit.radius)} · from ${formatClock(ctx.absTime(time), ctx.tz)}` : ''),
                  button({ label: 'Remove', icon: 'trash', variant: 'ghost', iconOnly: true, onClick: () => session.removeEdit(edit.id) }),
                ]),
              ),
            ),
          ]
        : null,
    );
  };
  const body = h('div', { class: 'panel-body' }, [
    h('p', { class: 'hint' }, 'Tap the map where you observed the wind (or use the crosshair), then set where it comes from and how strong it is.'),
    h('div', { class: 'row-actions' }, [crossBtn, meBtn]),
    h('div', { class: 'wind-controls' }, [dial.el, h('div', { class: 'wind-sliders' }, [speed.el, radius.el])]),
    list,
  ]);
  const el = panelShell('Local wind', 'wind', 'wind-panel', onClose, body, pendingBox);
  const u1 = ui.subscribe(render, ['pending', 'wind']);
  const u2 = session.state.subscribe(render, ['edits']);
  render();
  return {
    el,
    destroy() {
      u1();
      u2();
    },
  };
}
