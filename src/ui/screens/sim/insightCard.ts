/**
 * Insight card, as a flat list-style card: a leading severity icon (the icon's shape, its colour and the word all say
 * how serious it is: never colour alone, doc 09 §9), the kind of event as a small chip, the time, the title and a
 * one-line summary. The chevron expands the reason (the full explanation, the safety takeaway, the factors, the source
 * and how much to trust it). Cards never auto-dismiss; tapping one flies the view to the place it is about.
 */
import type { Insight, InsightKind } from '../../../core/types';
import { h, uniqueId } from '../../dom';
import { icon, type IconName } from '../../icons';
import { formatClock, formatElapsedShort } from '../../format';
import { SEVERITY_LABELS } from '../../labels';

const SEVERITY_ICON: Record<Insight['severity'], IconName> = { danger: 'danger', watch: 'warning', info: 'info' };

/** How much to trust a card (Insight.confidence), in plain words. */
export const CONFIDENCE_LABELS: Record<NonNullable<Insight['confidence']>, { label: string; about: string }> = {
  // Not "the model computes it": the spread rates are fitted (empirical) formulas, and in the fast mode the air effects are estimates.
  physics: { label: 'Well established', about: 'A well-documented effect in research and fire observations. The model uses fitted formulas or estimates for it, not a simulation of the physics.' },
  'rule-of-thumb': { label: 'Rule of thumb', about: 'Field experience and case studies; the model flags where it applies.' },
  'model-estimate': { label: 'Model estimate', about: 'The model’s best estimate; real fires can differ a lot.' },
  'sub-grid': { label: 'Below model detail', about: 'Smaller than the model grid, so the model can’t see this precisely.' },
};

/** Short plain-English name of each kind of event (the card's chip). Jargon keeps its everyday gloss. */
export const INSIGHT_KIND_LABELS: Record<InsightKind, string> = {
  'upslope-run': 'Uphill run',
  'downslope-backing': 'Backing downhill',
  'gully-chimney': 'Gully chimney',
  'eruptive-slope': 'Sudden uphill surge',
  'ridge-crest': 'Ridge top',
  'lee-slope-eddy': 'Wind eddy behind a ridge',
  'vorticity-lateral-spread': 'Sideways run (VLS)',
  'saddle-channelling': 'Wind through a saddle',
  'valley-channelling': 'Wind along a valley',
  'ridge-speed-up': 'Faster wind on the ridge',
  spotting: 'Embers ahead',
  'spot-fire': 'Spot fire',
  'mass-spotting': 'Ember shower',
  'junction-zone': 'Fires joining',
  'wind-change': 'Wind change',
  'dead-man-zone': 'Dead man zone',
  'plume-dominated': 'Smoke column in charge',
  'pyroconvection-risk': 'Fire thunderstorm risk',
  'fire-induced-wind': 'Wind made by the fire',
  'anabatic-wind': 'Upslope breeze',
  'katabatic-wind': 'Downslope night breeze',
  'thermal-belt': 'Warm night belt',
  'inversion-break': 'Inversion lifting',
  'aspect-dry-fuel': 'Sun-dried slope',
  'moist-gully': 'Damp gully',
  'heavy-fuel': 'Heavy fuel',
  'recent-burn': 'Recently burnt',
  'crown-fire': 'Crown fire',
  'high-drought': 'Very dry year',
  'night-slowdown': 'Night slow-down',
  'afternoon-peak': 'Afternoon peak',
  'fuel-break-breached': 'Break crossed',
  'rolling-debris': 'Rolling logs',
  general: 'Fire behaviour',
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
  const conf = ins.confidence ? CONFIDENCE_LABELS[ins.confidence] : undefined;
  const moreId = uniqueId('insight-more');
  const show = h(
    'button',
    { type: 'button', class: 'btn btn-tonal insight-show', aria: { label: `Show “${ins.title}” on the map` }, on: { click: () => opts.onShow(ins) } },
    [icon('eye'), h('span', { class: 'btn-text' }, 'Show on map')],
  );
  const expand = h(
    'button',
    {
      type: 'button',
      class: 'icon-btn insight-expand',
      dataset: { testid: 'insight-expand' },
      attrs: { 'aria-expanded': 'false', 'aria-controls': moreId },
      aria: { label: `Why? The reason for “${ins.title}”` },
      on: { click: () => setOpen(expand.getAttribute('aria-expanded') !== 'true') },
    },
    icon('chevron-down'),
  );
  const more = h('div', { class: 'insight-more', id: moreId, hidden: true }, [
    ins.safety ? h('p', { class: 'insight-safety callout callout-warn' }, [icon('lock'), h('span', null, ins.safety)]) : null,
    ins.factors.length
      ? h(
          'ul',
          { class: 'factor-chips', aria: { label: 'What made it happen' } },
          ins.factors.map((f) => h('li', { class: 'factor-chip' }, [h('span', { class: 'fc-label' }, f.label), h('span', { class: 'fc-value' }, f.value), f.effect ? h('span', { class: 'fc-effect' }, f.effect) : null])),
        )
      : null,
    conf ? h('p', { class: 'insight-conf' }, [h('span', { class: 'conf-badge badge' }, conf.label), h('span', null, conf.about)]) : null,
    h('div', { class: 'insight-foot' }, [ins.source ? h('details', { class: 'insight-source' }, [h('summary', null, 'Learn more'), h('p', null, `Source: ${ins.source}`)]) : h('span'), show]),
  ]);
  const body = h('p', { class: 'insight-body' }, ins.body);
  const card = h(
    'article',
    {
      on: { click: (e) => onCardClick(e) },
      class: ['insight', `sev-${ins.severity}`, opts.compact && 'compact'],
      dataset: { testid: 'insight-card', kind: ins.kind, severity: ins.severity },
      aria: { label: `${SEVERITY_LABELS[ins.severity]}: ${ins.title}` },
    },
    [
      h('div', { class: 'insight-row' }, [
        h('span', { class: 'insight-lead', aria: { hidden: true } }, icon(SEVERITY_ICON[ins.severity])),
        h('div', { class: 'insight-main' }, [
          h('div', { class: 'insight-meta' }, [
            h('span', { class: 'sev-word' }, SEVERITY_LABELS[ins.severity]),
            h('span', { class: 'badge insight-kind' }, INSIGHT_KIND_LABELS[ins.kind] ?? INSIGHT_KIND_LABELS.general),
            h('span', { class: 'insight-time' }, when),
          ]),
          h('h3', { class: 'insight-title' }, ins.title),
          opts.compact ? null : body,
          rep
            ? h('p', { class: 'insight-repeats', dataset: { testid: 'insight-repeats' } }, [
                icon('replay'),
                h('span', null, `Seen ${rep.count} times since ${formatClock(opts.absTime(rep.first), opts.tz)} · showing the latest`),
              ])
            : null,
        ]),
        opts.compact ? null : expand,
      ]),
      opts.compact ? null : more,
    ],
  );
  function setOpen(open: boolean): void {
    expand.setAttribute('aria-expanded', String(open));
    more.hidden = !open;
    card.classList.toggle('is-open', open);
  }
  function onCardClick(e: MouseEvent): void {
    // Tapping the card flies to the place it is about (the explicit button does the same for assistive tech).
    if ((e.target as HTMLElement).closest('button, summary, details, a')) return;
    opts.onShow(ins);
  }
  return card;
}
