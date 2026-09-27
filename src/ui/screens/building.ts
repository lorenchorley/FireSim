/**
 * Build progress screen: step list, progress bar, current message, non-fatal warnings, Cancel; on failure an error
 * with Back / Try again.
 */
import type { BuildProgress } from '../../scenario/request';
import { h, setChildren, text } from '../dom';
import { icon } from '../icons';
import { BUILD_STEPS } from '../labels';
import { button } from '../widgets';

export interface BuildingScreen {
  el: HTMLElement;
  progress(p: BuildProgress): void;
  fail(message: string): void;
  destroy(): void;
}

export function createBuildingScreen(opts: { title: string; subtitle: string; onCancel: () => void; onRetry: () => void; onBack: () => void }): BuildingScreen {
  const bar = h('div', { class: 'progress-fill' });
  const barWrap = h('div', { class: 'progress', attrs: { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0, 'aria-label': 'Build progress' } }, bar);
  const pct = h('span', { class: 'progress-pct' }, '0%');
  const message = h('p', { class: 'build-message', attrs: { 'aria-live': 'polite' } }, 'Starting…');
  const items = new Map<string, HTMLLIElement>();
  const list = h(
    'ol',
    { class: 'step-list' },
    BUILD_STEPS.map((s) => {
      const li = h('li', { class: 'step pending', dataset: { step: s.step } }, [h('span', { class: 'step-icon', aria: { hidden: true } }), h('span', { class: 'step-label' }, s.label)]);
      items.set(s.step, li);
      return li;
    }),
  );
  const warnings = h('div', { class: 'build-warnings' });
  const actions = h('div', { class: 'build-actions' }, [button({ label: 'Cancel', icon: 'close', variant: 'secondary', size: 'lg', testId: 'cancel-build', onClick: opts.onCancel })]);
  const el = h('div', { class: 'screen building-screen', dataset: { testid: 'building' } }, [
    h('main', { class: 'building-main' }, [
      h('div', { class: 'building-hero', aria: { hidden: true } }, icon('cube', { size: 44 })),
      h('h1', { class: 'building-title' }, opts.title),
      h('p', { class: 'building-sub' }, opts.subtitle),
      h('div', { class: 'progress-row' }, [barWrap, pct]),
      message,
      list,
      warnings,
    ]),
    actions,
  ]);

  const order = BUILD_STEPS.map((s) => s.step);
  return {
    el,
    progress(p) {
      const f = Math.round(Math.max(0, Math.min(1, p.fraction)) * 100);
      bar.style.width = `${f}%`;
      barWrap.setAttribute('aria-valuenow', String(f));
      text(pct, `${f}%`);
      text(message, p.message);
      const cur = order.indexOf(p.step);
      order.forEach((step, i) => {
        const li = items.get(step)!;
        const state = p.step === 'done' || i < cur ? 'done' : i === cur ? 'active' : 'pending';
        if (!li.classList.contains(state)) {
          li.className = `step ${state}`;
          setChildren(li.querySelector('.step-icon')!, state === 'done' ? icon('check', { size: 20 }) : state === 'active' ? h('span', { class: 'spinner' }) : null);
          li.setAttribute('aria-current', state === 'active' ? 'step' : 'false');
        }
      });
      setChildren(
        warnings,
        p.warnings.length ? p.warnings.map((w) => h('p', { class: 'callout callout-warn' }, [icon('warning'), h('span', null, w)])) : null,
      );
    },
    fail(msg) {
      text(message, 'The model could not be built.');
      el.classList.add('failed');
      setChildren(warnings, [h('p', { class: 'callout callout-danger', attrs: { role: 'alert' } }, [icon('danger'), h('span', null, msg)]), warnings.childNodes.length ? null : null]);
      setChildren(actions, [
        button({ label: 'Back to setup', icon: 'back', variant: 'secondary', size: 'lg', onClick: opts.onBack }),
        button({ label: 'Try again', icon: 'replay', variant: 'primary', size: 'lg', onClick: opts.onRetry }),
      ]);
    },
    destroy: () => el.remove(),
  };
}
