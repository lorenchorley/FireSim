/**
 * Build progress screen: a progress bar with the current message, then the steps in the order the builder really runs
 * them (ui/labels.ts BUILD_STEPS). As each data set arrives, a row appears under its step with the data set's name,
 * where it came from (origin chip) and its size, read from the build's request ledger (BuildProgress.datasets,
 * scenario/build.ts); network bytes whose wire size was not reported are shown as "up to". When the build is done the
 * rows are replaced by the scenario's measured inventory (ScenarioData.datasets), including the data sets that need no
 * download (a designed weather day, the fuel map worked out on the phone). Non-fatal warnings are flat banners; Cancel,
 * and on failure Back to setup / Try again, sit in the bottom bar.
 */
import { formatBytes, type DatasetRecord } from '../../core/datasets';
import type { BuildProgress } from '../../scenario/request';
import { h, setChildren, text } from '../dom';
import { icon } from '../icons';
import { arrivalOf, BUILD_STEPS, buildStepStates, datasetIcon, datasetStep, type Arrival } from '../labels';
import { badge, originChip } from '../primitives';
import { builtRow, type PlanBadge } from '../setupModel';
import { button } from '../widgets';

export interface BuildingScreen {
  el: HTMLElement;
  progress(p: BuildProgress): void;
  /** Show the measured inventory of the finished scenario (replaces the rows counted during the build). */
  datasets(records: readonly DatasetRecord[]): void;
  fail(message: string): void;
  destroy(): void;
}

/** The chip of a data-set row: provenance (origin-chip) or a plain badge. */
export function badgeElement(b: PlanBadge): HTMLElement {
  return b.kind === 'origin' ? originChip(b.origin, b.label) : badge(b.label, { tone: b.tone === 'watch' ? 'watch' : 'neutral' });
}

const ARRIVAL_BADGE: Record<Arrival['origin'], PlanBadge> = {
  live: { kind: 'origin', origin: 'live', label: 'Live' },
  saved: { kind: 'origin', origin: 'saved', label: 'Saved on device' },
  bundled: { kind: 'origin', origin: 'bundled', label: 'Bundled' },
  none: { kind: 'badge', tone: 'neutral', label: 'Nothing yet' },
};

type Step = BuildProgress['step'];

export function createBuildingScreen(opts: { title: string; subtitle: string; onCancel: () => void; onRetry: () => void; onBack: () => void }): BuildingScreen {
  const bar = h('div', { class: 'progress-fill' });
  const barWrap = h('div', { class: 'progress building-progress', attrs: { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0, 'aria-label': 'Build progress' } }, bar);
  const pct = h('span', { class: 'progress-pct t-num' }, '0 %');
  const message = h('p', { class: 'build-message', attrs: { 'aria-live': 'polite' } }, 'Starting…');
  const total = h('p', { class: 'build-total t-num', dataset: { testid: 'build-total' } });
  const items = new Map<Step, HTMLLIElement>();
  const nested = new Map<Step, HTMLUListElement>();
  const list = h(
    'ol',
    { class: 'list build-steps', aria: { label: 'Build steps and the data sets each one read' }, dataset: { testid: 'build-datasets' } },
    BUILD_STEPS.map((s) => {
      const sub = h('ul', { class: 'build-step-data', aria: { label: `Data sets of: ${s.label}` } });
      const li = h('li', { class: 'step pending', dataset: { step: s.step } }, [
        h('span', { class: 'list-row build-row' }, [h('span', { class: 'list-lead step-icon', aria: { hidden: true } }, h('span', { class: 'step-dot' })), h('span', { class: 'list-body' }, h('span', { class: 'list-title' }, s.label))]),
        sub,
      ]);
      items.set(s.step, li);
      nested.set(s.step, sub);
      return li;
    }),
  );
  const rows = new Map<string, { li: HTMLLIElement; key: string }>();
  const warnings = h('div', { class: 'build-warnings', attrs: { 'aria-live': 'polite' } });
  const actions = h('div', { class: 'bottom-bar build-actions' }, [button({ label: 'Cancel', icon: 'close', variant: 'secondary', size: 'lg', testId: 'cancel-build', onClick: opts.onCancel })]);
  const el = h('div', { class: 'screen building-screen', dataset: { testid: 'building' } }, [
    h('main', { class: 'screen-main building-main' }, [
      h('section', { class: 'card build-card build-head' }, [
        h('div', { class: 'build-title-row' }, [
          h('span', { class: 'brand-mark', aria: { hidden: true } }, icon('cube')),
          h('div', { class: 'build-titles' }, [h('h1', { class: 'building-title', tabIndex: -1 }, opts.title), h('p', { class: 'building-sub' }, opts.subtitle)]),
        ]),
        h('div', { class: 'progress-row' }, [barWrap, pct]),
        message,
        total,
      ]),
      warnings,
      h('section', { class: 'card card-flush build-card' }, [h('h2', { class: 'section-header' }, 'Steps and data sets'), list]),
    ]),
    actions,
  ]);

  /** Add or update the row of one data set under its step (rebuilt only when its text changed). */
  const setRow = (step: Step, id: string, title: string, b: PlanBadge, size: string, sub?: string): void => {
    const key = `${step}|${title}|${b.label}|${size}|${sub ?? ''}`;
    const cur = rows.get(id);
    if (cur?.key === key) return;
    const li = h('li', { dataset: { dataset: id } }, [
      h('span', { class: ['list-row', 'build-row', 'build-data-row', sub && 'two-line'] }, [
        h('span', { class: 'list-lead', aria: { hidden: true } }, icon(datasetIcon(id))),
        h('span', { class: 'list-body' }, [h('span', { class: 'list-title' }, title), sub ? h('span', { class: 'list-sub' }, sub) : null]),
        h('span', { class: 'list-trail build-trail' }, [badgeElement(b), size ? h('span', { class: 'build-size t-num' }, size) : null]),
      ]),
    ]);
    if (cur) cur.li.replaceWith(li);
    else nested.get(step)!.appendChild(li);
    rows.set(id, { li, key });
  };
  const clearRows = (): void => {
    for (const ul of nested.values()) setChildren(ul, null);
    rows.clear();
  };

  const order = BUILD_STEPS.map((s) => s.step);
  let reached = -1;
  let lastWarnings = '';
  const showWarnings = (ws: readonly string[]): void => {
    const key = ws.join('\n');
    if (key === lastWarnings) return;
    lastWarnings = key;
    setChildren(
      warnings,
      ws.map((w) => h('div', { class: 'banner banner-warn', attrs: { role: 'note' } }, [icon('warning'), h('span', { class: 'banner-text' }, w)])),
    );
  };
  const showTotal = (bytes: number, upTo: boolean, measured: boolean): void => {
    text(total, bytes > 0 ? `${upTo ? 'Up to ' : ''}${formatBytes(bytes)} of data ${measured ? 'used' : 'so far'}` : '');
  };
  return {
    el,
    progress(p) {
      const f = Math.round(Math.max(0, Math.min(1, p.fraction)) * 100);
      bar.style.width = `${f}%`;
      barWrap.setAttribute('aria-valuenow', String(f));
      text(pct, `${f} %`);
      text(message, p.message);
      const st = buildStepStates(p.step, reached);
      reached = st.reached;
      order.forEach((step, i) => {
        const li = items.get(step)!;
        const state = st.states[i]!;
        if (!li.classList.contains(state)) {
          li.className = `step ${state}`;
          setChildren(li.querySelector('.step-icon')!, state === 'done' ? icon('check-circle') : state === 'active' ? h('span', { class: 'spinner' }) : h('span', { class: 'step-dot' }));
          li.setAttribute('aria-current', state === 'active' ? 'step' : 'false');
        }
      });
      if (p.datasets) {
        for (const d of p.datasets) {
          const a = arrivalOf(d, formatBytes);
          setRow(datasetStep(a.id), a.id, a.title, a.failed ? { kind: 'badge', tone: 'watch', label: 'Not received' } : ARRIVAL_BADGE[a.origin], a.size);
        }
        showTotal(
          p.datasets.reduce((s, d) => s + d.bytes, 0),
          p.datasets.some((d) => d.networkUnmeasuredBytes > 0),
          false,
        );
      }
      showWarnings(p.warnings);
    },
    datasets(records) {
      clearRows();
      let bytes = 0;
      let upTo = false;
      for (const r of records) {
        if (r.role === 'bundle' || r.role === 'pack') continue; // their files are counted under each data set
        const b = builtRow(r);
        bytes += r.sizes.transferredBytes;
        upTo ||= (r.sizes.networkUnmeasuredBytes ?? 0) > 0;
        setRow(datasetStep(r.id, r.role), r.id, r.title, b.badge, b.size, b.provider);
      }
      showTotal(bytes, upTo, true);
    },
    fail(msg) {
      text(message, 'The model could not be built.');
      el.classList.add('failed');
      const active = el.querySelector('.step.active .step-icon');
      if (active) setChildren(active, icon('danger'));
      setChildren(warnings, [h('div', { class: 'banner banner-danger', attrs: { role: 'alert' } }, [icon('danger'), h('span', { class: 'banner-text' }, msg)]), ...[...warnings.childNodes]]);
      lastWarnings = '';
      setChildren(actions, [
        button({ label: 'Back to setup', icon: 'arrow-back', variant: 'secondary', size: 'lg', testId: 'build-back', onClick: opts.onBack }),
        button({ label: 'Try again', icon: 'replay', variant: 'primary', size: 'lg', testId: 'build-retry', onClick: opts.onRetry }),
      ]);
    },
    destroy: () => el.remove(),
  };
}
