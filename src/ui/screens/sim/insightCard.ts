/**
 * Insight card: severity is shown by colour AND icon AND label (doc 09 §9: never colour alone). Cards never
 * auto-dismiss; tapping one flies the view to the place it is about.
 */
import type { Insight } from '../../../core/types';
import { h } from '../../dom';
import { icon, type IconName } from '../../icons';
import { formatClock, formatElapsedShort } from '../../format';
import { SEVERITY_LABELS } from '../../labels';

const SEVERITY_ICON: Record<Insight['severity'], IconName> = { danger: 'danger', watch: 'warning', info: 'info' };

/** How much to trust a card (Insight.confidence), in plain words. */
export const CONFIDENCE_LABELS: Record<NonNullable<Insight['confidence']>, { label: string; about: string }> = {
  physics: { label: 'Physics', about: 'Well-understood physics the model computes directly.' },
  'rule-of-thumb': { label: 'Rule of thumb', about: 'Field experience and case studies; the model flags where it applies.' },
  'model-estimate': { label: 'Model estimate', about: 'The model’s best estimate; real fires can differ a lot.' },
  'sub-grid': { label: 'Below model detail', about: 'Smaller than the model grid, so the model can’t see this precisely.' },
};

export function insightCard(
  ins: Insight,
  opts: {
    tz: string;
    absTime: (t: number) => number;
    onShow: (i: Insight) => void;
    compact?: boolean;
    forecast?: boolean;
    /** The card stands for several reports of the same phenomenon (see insightGroups). */
    repeats?: { count: number; first: number };
  },
): HTMLElement {
  const when = opts.forecast ? `Forecast · ${formatClock(opts.absTime(ins.time), opts.tz)}` : `${formatClock(opts.absTime(ins.time), opts.tz)} · ${formatElapsedShort(ins.time)}`;
  const rep = opts.repeats && opts.repeats.count > 1 ? opts.repeats : null;
  const show = h(
    'button',
    { type: 'button', class: 'btn btn-secondary insight-show', aria: { label: `Show “${ins.title}” on the map` }, on: { click: () => opts.onShow(ins) } },
    [icon('eye', { size: 20 }), h('span', { class: 'btn-text' }, 'Show on map')],
  );
  const body = [
    h('div', { class: 'insight-head' }, [
      h('span', { class: 'sev-badge' }, [icon(SEVERITY_ICON[ins.severity], { size: 18 }), SEVERITY_LABELS[ins.severity]]),
      ins.confidence && CONFIDENCE_LABELS[ins.confidence]
        ? h('span', { class: 'conf-badge', attrs: { title: CONFIDENCE_LABELS[ins.confidence].about }, aria: { label: `Confidence: ${CONFIDENCE_LABELS[ins.confidence].label}. ${CONFIDENCE_LABELS[ins.confidence].about}` } }, CONFIDENCE_LABELS[ins.confidence].label)
        : null,
      h('span', { class: 'insight-time' }, when),
    ]),
    h('h3', { class: 'insight-title' }, ins.title),
    rep
      ? h('p', { class: 'insight-repeats', dataset: { testid: 'insight-repeats' } }, [
          icon('replay', { size: 16 }),
          ` Seen ${rep.count} times since ${formatClock(opts.absTime(rep.first), opts.tz)} · showing the latest`,
        ])
      : null,
    opts.compact ? null : h('p', { class: 'insight-body' }, ins.body),
    !opts.compact && ins.safety ? h('p', { class: 'insight-safety' }, [icon('lock', { size: 18 }), h('span', null, ins.safety)]) : null,
    !opts.compact && ins.factors.length
      ? h(
          'ul',
          { class: 'factor-chips', aria: { label: 'Factors' } },
          ins.factors.map((f) => h('li', { class: 'factor-chip' }, [h('span', { class: 'fc-label' }, f.label), h('span', { class: 'fc-value' }, f.value), f.effect ? h('span', { class: 'fc-effect' }, f.effect) : null])),
        )
      : null,
    h('div', { class: 'insight-foot' }, [
      !opts.compact && ins.source ? h('details', { class: 'insight-source' }, [h('summary', null, 'Learn more'), h('p', null, `Source: ${ins.source}`)]) : h('span'),
      show,
    ]),
  ];
  const onCardClick = (e: MouseEvent): void => {
    // Tapping the card flies to the place it is about (the explicit button does the same for assistive tech).
    if ((e.target as HTMLElement).closest('button, summary, details, a')) return;
    opts.onShow(ins);
  };
  return h(
    'article',
    {
      on: { click: onCardClick },
      class: ['insight', `sev-${ins.severity}`, opts.compact && 'compact'],
      dataset: { testid: 'insight-card', kind: ins.kind, severity: ins.severity },
      aria: { label: `${SEVERITY_LABELS[ins.severity]}: ${ins.title}` },
    },
    h('div', { class: 'insight-main' }, body),
  );
}
