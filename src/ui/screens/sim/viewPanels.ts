/**
 * The View tool panels: the Layers panel (layersPanel.ts: map type, map details, heat maps, trees, wind and air, all
 * built from the layer catalog) and the What-if panel (coupling, embers, mountain phenomena → re-run from now).
 */
import { h } from '../../dom';
import { icon } from '../../icons';
import { formatClock } from '../../format';
import { button, toggle } from '../../widgets';
import type { SimContext } from './context';

export { createLayersPanel, currentLegend, legendElement } from './layersPanel';

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
