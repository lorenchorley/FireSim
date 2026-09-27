/**
 * Danger toasts: a new Danger insight pops a persistent card (no auto-dismiss — doc 09 §9, HIG) near the top with a
 * vibration, "Show" and "Dismiss". At most two are stacked; older ones stay in the Insights tab.
 */
import type { Insight } from '../../../core/types';
import { h, prefersReducedMotion, vibrate } from '../../dom';
import { icon } from '../../icons';
import { formatClock } from '../../format';
import type { SimContext } from './context';

export function createToasts(ctx: SimContext, onShow: (i: Insight) => void): { el: HTMLElement; push(i: Insight): void; pushSystem(message: string): void; destroy(): void } {
  // Each card is role="alert" (announced once when added); the container is not also a live region, which would
  // announce every card twice.
  const el = h('div', { class: 'toasts' });
  /** Danger cards not yet dismissed (newest first); only the newest is shown, with a count of the others. */
  let queue: Insight[] = [];
  const render = (): void => {
    const ins = queue[0];
    if (!ins) {
      el.querySelector('[data-testid=toast]')?.remove();
      return;
    }
    const more = queue.length - 1;
    const card = h('div', { class: ['toast', `sev-${ins.severity}`, prefersReducedMotion() ? '' : 'toast-in'], attrs: { role: 'alert' }, dataset: { testid: 'toast' } }, [
      h('div', { class: 'toast-icon' }, icon('danger', { size: 26 })),
      h('div', { class: 'toast-text' }, [
        h('p', { class: 'toast-kicker' }, `Danger · ${formatClock(ctx.absTime(ins.time), ctx.tz)}${more > 0 ? ` · +${more} more` : ''}`),
        h('p', { class: 'toast-title' }, ins.title),
      ]),
      h('button', { type: 'button', class: 'btn btn-inverse toast-show', on: { click: () => (onShow(ins), dismiss(ins)) } }, 'Show'),
      h('button', { type: 'button', class: 'btn btn-ghost-inverse btn-icon', aria: { label: 'Dismiss' }, on: { click: () => dismiss(ins) } }, icon('close')),
    ]);
    el.querySelector('[data-testid=toast]')?.remove();
    el.append(card);
  };
  const dismiss = (ins: Insight): void => {
    queue = queue.filter((q) => q !== ins);
    render();
  };
  const push = (ins: Insight): void => {
    if (ctx.settings.get().haptics) vibrate([220, 90, 220]);
    queue = [ins, ...queue].slice(0, 6);
    render();
  };
  /** A system problem (e.g. the simulation worker failed): shown above the danger cards until dismissed. */
  const pushSystem = (message: string): void => {
    const card = h('div', { class: 'toast toast-system', attrs: { role: 'alert' } }, [
      h('div', { class: 'toast-icon' }, icon('warning', { size: 26 })),
      h('div', { class: 'toast-text' }, h('p', { class: 'toast-title' }, message)),
      h('button', { type: 'button', class: 'btn btn-ghost-inverse btn-icon', aria: { label: 'Dismiss' }, on: { click: () => card.remove() } }, icon('close')),
    ]);
    el.prepend(card);
  };
  return { el, push, pushSystem, destroy: () => el.remove() };
}
