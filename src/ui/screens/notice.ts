/**
 * First-run safety notice (A). A modal dialog that must be explicitly accepted; acceptance is stored with
 * @capacitor/preferences (localStorage fallback) and the notice is re-shown when its wording version changes.
 */
import { pushBackLayer } from '../backStack';
import { h } from '../dom';
import { icon } from '../icons';
import { NOTICE_VERSION, SAFETY_NOTICE } from '../content';
import { getPref, PREF_KEYS, setPref } from '../prefs';
import { button } from '../widgets';

export async function noticeAccepted(): Promise<boolean> {
  return (await getPref<number>(PREF_KEYS.notice, 0)) >= NOTICE_VERSION;
}

/**
 * Show the notice over `host`; resolves when accepted. `review` shows it without the first-run framing: then Back and
 * Escape close it too (the first-run notice can only be accepted).
 */
export function showNotice(host: HTMLElement, opts: { review?: boolean } = {}): Promise<void> {
  return new Promise((resolve) => {
    const previous = document.activeElement as HTMLElement | null;
    let closed = false;
    let removeLayer = (): void => undefined;
    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      removeLayer();
      await setPref(PREF_KEYS.notice, NOTICE_VERSION);
      el.classList.add('closing');
      setTimeout(() => el.remove(), 160);
      previous?.focus?.();
      resolve();
    };
    const accept = button({
      label: opts.review ? 'Close' : SAFETY_NOTICE.accept,
      variant: 'primary',
      size: 'lg',
      icon: 'check',
      testId: 'accept-notice',
      onClick: () => void close(),
    });
    const el = h('div', { class: 'modal-scrim', dataset: { testid: 'notice' } }, [
      h('div', { class: 'modal notice', attrs: { role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'notice-title', 'aria-describedby': 'notice-lead' } }, [
        h('div', { class: 'notice-icon' }, icon('warning', { size: 40 })),
        h('p', { class: 'notice-kicker' }, 'Safety notice'),
        h('h1', { class: 'notice-title', id: 'notice-title' }, SAFETY_NOTICE.title),
        h('p', { class: 'notice-lead', id: 'notice-lead' }, SAFETY_NOTICE.lead),
        h(
          'ul',
          { class: 'notice-points' },
          SAFETY_NOTICE.points.map((p) => h('li', null, p)),
        ),
        accept,
      ]),
    ]);
    // Keep focus inside the dialog (it has a single action).
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        accept.focus();
      } else if (e.key === 'Escape' && opts.review) {
        e.preventDefault();
        e.stopPropagation();
        void close();
      }
    });
    host.appendChild(el);
    if (opts.review) removeLayer = pushBackLayer({ id: 'notice', close: () => void close() });
    requestAnimationFrame(() => accept.focus());
  });
}
