/**
 * Data sets screen (user request: "an information section that details the size of each data set used for a given
 * scenario and their origin, and whatever else you have available that might be interesting"). A full-screen dialog
 * in the flat Maps look: a top app bar with a back arrow, cards of list rows on the grey background.
 *
 *   Summary      data sets · downloaded · in memory · saved on this phone; where the data come from (origin mix bar);
 *                freshness; substitutes in plain English; the model grid and the recipe to rebuild the run (Copy)
 *   List         filter chips (All, Terrain, Vegetation and fuel, Weather, Places, Derived, Yours) and a sort chip
 *                (Kind, Size, Name, Origin); one row per data set with origin, status, sizes, resolution, a spark bar
 *                and a bar of its size against the largest; data that were not used say so, with the reason
 *   Detail       a sub-page per data set: what and why, provider and licence (links are copied, "Open" asks first),
 *                dates, coordinates and extent, resolution as published and in the model, sizes with bars, the
 *                statistics as recorded, the distribution, a heat-map preview in the map's own colours, how far to
 *                trust it, warnings and limitations; Show on map; Copy (this data set, all as text, CSV, JSON)
 *   Memory       the run's working memory by part (scenario/memoryModel.ts) and the JavaScript heap now when the
 *                phone reports it
 *   This phone   bundled demo data, stored copies and saved areas (data/storage.ts) with Delete / Clear (always
 *                after a confirmation, never automatic) and the browser's storage estimate
 *   Planned      opened before a run (no scenario): the Setup's plan (scenario/estimate.ts), sizes marked ≈
 *   How to read  the words of the screen, and a link to "How this simulation works"
 *
 * Nothing pops up by itself: copies are confirmed by an inline line of text, dialogs open only from a tap. Back and
 * Escape step back one level (the sort menu, then the detail page, then the screen).
 */
import {
  datasetsToCsv,
  datasetsToJson,
  datasetsToText,
  formatBytes,
  formatCount,
  type DatasetRecord,
  type DatasetSummary,
  type WorkingMemory,
} from '../../core/datasets';
import type { ScenarioData, SimSnapshot } from '../../core/types';
import type { StorageReport } from '../../data/storage';
import { availabilityContext } from '../../render/layerCatalog';
import type { LayerState, OverlayKind } from '../../render/layers';
import { liveMemory, workingMemoryForScenario } from '../../scenario/memoryModel';
import { h, setChildren, text, uniqueId } from '../dom';
import { icon, type IconName } from '../icons';
import type { Services } from '../modules';
import { badge, bar, kv, meter, originChip, sparkbar, stackedBar, stat, type KvRow } from '../primitives';
import { defaultSnapshotBudget } from '../session';
import { settingsStore } from '../settings';
import { buildRequest, type SetupState } from '../setupModel';
import { appBar, button, chipChoice, confirmDialog, copyText } from '../widgets';
import { heatPreview, heatPreviewData } from './datasetViz';
import {
  availableFilters,
  clean,
  distributionModel,
  evidenceModel,
  fallbackNotes,
  freshness,
  glossary,
  listModel,
  memoryGroups,
  modelFacts,
  ORIGIN_CLASS_INFO,
  originMix,
  partFacts,
  reproduceText,
  shortProvider,
  showTargets,
  sizeFacts,
  sourceFacts,
  spaceFacts,
  statFacts,
  statusCountsLine,
  storageModel,
  summaryHeader,
  timeFacts,
  SORTS,
  type Fact,
  type FilterId,
  type RowModel,
  type SortId,
} from './datasetsModel';

export interface DatasetsScreenOptions {
  /** The running scenario; null = planned/stored/bundled data only (opened from Setup or Settings before a run). */
  scenario: ScenarioData | null;
  services: Services;
  getSnapshot?: () => SimSnapshot | null;
  onClose(): void;
  /** 'Show on map': close the screen and show this layer / heat map. */
  onShowLayer?(t: { overlay?: OverlayKind; sceneKey?: keyof LayerState }): void;
  /** Open the "How this simulation works" card. */
  onOpenModelCard?(): void;
  /** Open straight at this data set's detail page. */
  initialDatasetId?: string;
  /**
   * ADDITION (builder DS): the Setup form, for the planned data when there is no scenario (opened from Setup or from
   * Settings before a run). The App passes `this.setup?.state() ?? this.lastSetup`. Without it (and without a scenario)
   * the screen shows what is stored on the phone only.
   */
  request?: SetupState;
}

/** More rows than this are added in chunks after the first paint (the inventory is normally 15-20 rows). */
const CHUNK = 60;

export function createDatasetsScreen(opts: DatasetsScreenOptions): { el: HTMLElement; destroy(): void } {
  const scenario = opts.scenario;
  const tz = scenario?.weather?.timezone || 'Australia/Sydney';
  let records: DatasetRecord[] = scenario?.datasets ? [...scenario.datasets] : [];
  let summary: DatasetSummary | null = scenario?.datasetSummary ?? null;
  let storageRep: StorageReport | null = null;
  let planState: 'none' | 'loading' | 'ready' | 'failed' = !scenario && opts.request ? 'loading' : 'none';
  let destroyed = false;
  let filter: FilterId = 'all';
  let sort: SortId = 'kind';
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let detailDispose: (() => void) | null = null;
  let detailId: string | null = null;
  let detailOpener: HTMLElement | null = null;
  let listScroll = 0;
  let memTimer: ReturnType<typeof setInterval> | undefined;

  const el = h('section', {
    class: 'screen datasets-screen',
    attrs: { role: 'dialog', 'data-testid': 'datasets-screen' },
    aria: { modal: 'true', label: 'Data sets' },
  });

  const later = (fn: () => void, ms: number): void => {
    const t = setTimeout(() => {
      timers.delete(t);
      if (!destroyed) fn();
    }, ms);
    timers.add(t);
  };

  /** A line of text that confirms a copy (inline, never a pop-up) and clears itself after a few seconds. */
  const statusLine = (testId: string): HTMLElement => h('p', { class: 'ds-status t-secondary', attrs: { role: 'status', 'aria-live': 'polite' }, dataset: { testid: testId } });
  const say = (line: HTMLElement, msg: string, ms = 6000): void => {
    text(line, msg);
    line.classList.toggle('is-shown', !!msg);
    const stamp = String(Date.now() + Math.random());
    line.dataset.stamp = stamp;
    if (msg && ms > 0) later(() => line.dataset.stamp === stamp && (text(line, ''), line.classList.remove('is-shown')), ms);
  };
  const copyInto = async (line: HTMLElement, value: string, what: string): Promise<void> => {
    const ok = value ? await copyText(value) : false;
    if (destroyed) return;
    say(line, ok ? `Copied ${what} (${formatBytes(new TextEncoder().encode(value).length)} of text).` : `Could not copy ${what}: this phone did not allow it.`);
  };

  // ───────────── list page ─────────────
  const titleId = uniqueId('ds-title');
  const listMain = h('main', { class: 'screen-main ds-main', dataset: { testid: 'datasets-main' } });
  const listPage = h('div', { class: 'ds-page', dataset: { testid: 'datasets-list-page' } }, [
    appBar({ title: 'Data sets', titleId, onBack: () => opts.onClose(), backLabel: 'Close data sets', backTestId: 'datasets-close' }),
    listMain,
  ]);
  const detailTitleId = uniqueId('ds-detail');
  const detailTitle = h('h1', { class: 'app-bar-title', id: detailTitleId, tabIndex: -1 }, '');
  const detailMain = h('main', { class: 'screen-main ds-main ds-detail-main' });
  const detailPage = h('div', { class: 'ds-page ds-detail-page', hidden: true, dataset: { testid: 'dataset-detail' }, attrs: { 'aria-labelledby': detailTitleId, role: 'region' } }, [
    h('header', { class: 'app-bar' }, [
      h('button', { type: 'button', class: 'icon-btn', aria: { label: 'Back to the data sets' }, dataset: { testid: 'dataset-detail-back' }, on: { click: () => closeDetail() } }, icon('arrow-back')),
      detailTitle,
    ]),
    detailMain,
  ]);
  el.append(listPage, detailPage);

  const summaryCard = h('section', { class: 'card ds-summary', dataset: { testid: 'datasets-summary' }, aria: { label: 'Summary' } });
  const listCard = h('section', { class: 'card ds-list-card', dataset: { testid: 'datasets-list' }, aria: { label: 'The data sets' } });
  const memoryCard = h('section', { class: 'card ds-memory', dataset: { testid: 'datasets-memory' }, aria: { label: 'Working memory' } });
  const storageCard = h('section', { class: 'card ds-storage', dataset: { testid: 'datasets-storage' }, aria: { label: 'On this phone' } });
  const howCard = h('section', { class: 'card ds-how', dataset: { testid: 'datasets-how' }, aria: { label: 'How to read this' } });
  const exportCard = h('section', { class: 'card ds-export', dataset: { testid: 'datasets-export' }, aria: { label: 'Copy the inventory' } });
  listMain.append(summaryCard, listCard, memoryCard, storageCard, howCard, exportCard);

  const cardTitle = (label: string, ic: IconName, extra?: HTMLElement | null): HTMLElement =>
    h('div', { class: 'ds-card-head' }, [h('h2', { class: 'card-title' }, [icon(ic), h('span', null, label)]), extra ?? null]);

  // ───────────── DS1 summary ─────────────
  function renderSummary(): void {
    const hd = summaryHeader(records, summary, { storedOnPhoneBytes: storageRep?.onDeviceBytes ?? 0 });
    const out: HTMLElement[] = [cardTitle(hd.title, hd.mode === 'planned' ? 'calendar' : 'database')];
    if (planState === 'loading') {
      out.push(h('p', { class: 't-secondary', attrs: { 'aria-live': 'polite' } }, 'Working out the data this run needs…'), h('span', { class: 'skeleton skeleton-line ds-skel' }));
      setChildren(summaryCard, out);
      return;
    }
    if (planState === 'failed') out.push(h('p', { class: 't-secondary' }, 'The data plan is not available right now. What is stored on this phone is listed below.'));
    out.push(
      h(
        'div',
        { class: 'stat-row ds-stats', attrs: { role: 'group', 'aria-label': hd.sentence }, dataset: { testid: 'datasets-totals' } },
        hd.stats.map((s) => {
          const st = stat({ value: s.value, unit: s.unit || undefined, caption: s.caption });
          st.dataset.stat = s.id;
          if (s.prefix) st.querySelector('.stat-num')?.prepend(h('span', { class: 'stat-unit ds-pre' }, s.prefix));
          return st;
        }),
      ),
    );
    for (const n of hd.notes) out.push(h('p', { class: 'hint ds-note' }, n));
    // Origin mix
    const mix = originMix(records, summary);
    if (mix.parts.length) {
      out.push(
        h('h3', { class: 'sub-title' }, 'Where the data come from'),
        stackedBar(
          mix.parts.map((p) => ({ weight: p.share * 1000, colour: ORIGIN_CLASS_INFO[p.cls].colour, label: `${p.label} ${p.text}` })),
          { label: mix.label, large: true },
        ),
        h(
          'div',
          { class: 'chips ds-legend', attrs: { role: 'list' }, dataset: { testid: 'origin-mix' } },
          mix.parts.map((p) => h('span', { class: 'legend-chip', attrs: { role: 'listitem' } }, [h('span', { class: ['swatch', 'ds-swatch', `ds-swatch-${ORIGIN_CLASS_INFO[p.cls].colour}`] }), `${p.label} ${p.text}`])),
        ),
        h('p', { class: 'hint' }, `${mix.caption}.`),
      );
      const counts = statusCountsLine(records);
      if (counts) out.push(h('p', { class: 'hint' }, `By data set: ${counts}.`));
    }
    // Freshness
    const fr = freshness(records, summary, Date.now(), tz);
    if (fr.lines.length) {
      out.push(
        h('h3', { class: 'sub-title' }, 'How recent'),
        h(
          'ul',
          { class: 'ds-lines', dataset: { testid: 'datasets-freshness' } },
          fr.lines.map((l, i) => h('li', { class: ['ds-line', fr.weatherStale && /^Weather/.test(l) && 'is-watch'] }, [icon(i === 0 && /captured/.test(l) ? 'calendar' : /^Weather/.test(l) ? 'thermometer' : 'clock', { size: 18 }), h('span', null, l)])),
        ),
      );
    }
    // Substitutes, in plain English
    const fb = fallbackNotes(records, summary);
    if (fb.length) {
      out.push(
        h('div', { class: 'callout callout-warn ds-fallbacks', attrs: { role: 'note' }, dataset: { testid: 'datasets-fallbacks' } }, [
          icon('warning'),
          h('div', null, [
            h('p', { class: 't-medium' }, hd.mode === 'planned' ? 'Not real data, or only partly, on this plan:' : 'Not real data, or only partly:'),
            h(
              'ul',
              { class: 'ds-fallback-list' },
              fb.map((f) =>
                h('li', { dataset: { dataset: f.id } }, [h('span', { class: 't-medium' }, f.title), ` (${f.status.toLowerCase()}): ${f.reason}`]),
              ),
            ),
          ]),
        ]),
      );
    }
    // The model and the recipe
    const mf = modelFacts(summary);
    if (mf.length) out.push(h('h3', { class: 'sub-title' }, 'The model'), kv(mf.map(factRow), { label: 'The model grid', dense: true }));
    if (summary?.reproduce) {
      const copied = statusLine('reproduce-status');
      out.push(
        h('h3', { class: 'sub-title' }, 'Rebuild this run'),
        kv(
          [
            { key: 'Scenario', value: h('code', { class: 'code' }, clean(summary.scenarioId)) },
            { key: 'Random seed', value: fc(summary.seed) },
          ],
          { dense: true, label: 'Scenario id and seed' },
        ),
        h('div', { class: 'row-actions ds-actions' }, [
          button({ label: 'Copy recipe', icon: 'copy', variant: 'tonal', size: 'sm', testId: 'copy-reproduce', onClick: () => void copyInto(copied, reproduceText(summary), 'the recipe of this run') }),
        ]),
        copied,
      );
    }
    setChildren(summaryCard, out);
  }

  // ───────────── DS2 list ─────────────
  const sortBtn = h('button', { type: 'button', class: 'chip ds-sort', aria: { haspopup: 'menu', expanded: 'false' }, dataset: { testid: 'datasets-sort' }, on: { click: () => (sortMenu.hidden ? openSort() : closeSort()) } });
  const sortMenu = h('div', { class: 'popover ds-sort-menu', hidden: true, attrs: { role: 'menu', 'aria-label': 'Sort the data sets' }, dataset: { testid: 'datasets-sort-menu' } });
  const filterHost = h('div', { class: 'ds-filters' });
  const rowsHost = h('div', { class: 'ds-rows', attrs: { 'aria-busy': 'false' } });
  /** Read out after a filter or sort change (the rows themselves are not a live region: that would read the whole list). */
  const listStatus = h('p', { class: 'sr-only', attrs: { role: 'status', 'aria-live': 'polite' }, dataset: { testid: 'datasets-list-status' } });
  const listHead = cardTitle('Data sets', 'list', h('div', { class: 'ds-sort-wrap' }, [sortBtn, sortMenu]));

  function renderSortButton(): void {
    setChildren(sortBtn, [icon('filter'), h('span', null, `Sort: ${SORTS.find((s) => s.id === sort)?.label ?? ''}`), icon('chevron-down')]);
    setChildren(
      sortMenu,
      h(
        'ul',
        { class: 'list no-lead' },
        SORTS.map((s) =>
          h(
            'li',
            null,
            h('button', { type: 'button', class: 'list-row ds-menu-row', attrs: { role: 'menuitemradio', 'aria-checked': String(s.id === sort) }, dataset: { sort: s.id }, on: { click: () => pickSort(s.id) } }, [
              h('span', { class: 'list-body' }, h('span', { class: 'list-title' }, s.label)),
              s.id === sort ? h('span', { class: 'list-trail' }, icon('check')) : null,
            ]),
          ),
        ),
      ),
    );
  }
  const onDocDown = (e: Event): void => {
    if (!sortMenu.hidden && !sortMenu.contains(e.target as Node) && !sortBtn.contains(e.target as Node)) closeSort();
  };
  function openSort(): void {
    sortMenu.hidden = false;
    sortBtn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onDocDown, true);
    (sortMenu.querySelector('[aria-checked="true"]') as HTMLElement | null)?.focus({ preventScroll: true });
  }
  function closeSort(focus = true): void {
    if (sortMenu.hidden) return;
    sortMenu.hidden = true;
    sortBtn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onDocDown, true);
    if (focus) sortBtn.focus({ preventScroll: true });
  }
  function pickSort(s: SortId): void {
    sort = s;
    closeSort();
    renderSortButton();
    renderRows();
  }

  function renderFilters(): void {
    const fs = availableFilters(records);
    if (!fs.some((f) => f.id === filter)) filter = 'all';
    const c = chipChoice<FilterId>({
      label: 'Show',
      hideLabel: true,
      scroll: true,
      options: fs.map((f) => ({ value: f.id, label: f.id === 'all' ? `All ${f.count}` : `${f.label} ${f.count}` })),
      value: filter,
      testId: 'datasets-filters',
      onChange: (v) => {
        filter = v;
        renderRows();
      },
    });
    setChildren(filterHost, c.el);
  }

  function rowEl(m: RowModel): HTMLElement {
    const chips: HTMLElement[] = [];
    if (m.origin) chips.push(originChip(m.origin.cls, m.origin.label));
    if (m.status) chips.push(badge(m.status.label, { tone: m.status.tone === 'watch' ? 'watch' : 'neutral', icon: m.status.notUsed ? 'close' : 'warning' }));
    if (m.size) chips.push(h('span', { class: 'ds-size t-num' }, [icon('download', { size: 16 }), m.size]));
    if (m.memory) chips.push(h('span', { class: 'ds-size t-num' }, [icon('storage', { size: 16 }), `${m.memory} in memory`]));
    const sub = [m.provider, m.resolution].filter(Boolean).join(' · ');
    return h(
      'button',
      {
        type: 'button',
        class: ['list-row', 'three-line', 'ds-row', m.notUsed && 'is-not-used'],
        dataset: { testid: `dataset-row-${m.id}`, dataset: m.id },
        attrs: { 'aria-label': m.label },
        on: { click: (e) => openDetail(m.id, e.currentTarget as HTMLElement) },
      },
      [
        h('span', { class: 'list-lead' }, icon(m.icon)),
        h('span', { class: 'list-body' }, [
          h('span', { class: 'list-title' }, m.title),
          sub ? h('span', { class: 'list-sub' }, sub) : null,
          chips.length ? h('span', { class: 'ds-row-chips' }, chips) : null,
          m.reason ? h('span', { class: 'ds-row-reason' }, m.reason) : null,
          m.fraction > 0 ? bar(m.fraction, { label: `${m.sizeLabel}: ${Math.round(m.fraction * 100)} % of the largest data set` }) : null,
        ]),
        h('span', { class: 'list-trail ds-row-trail' }, [m.spark ? sparkbar(m.spark, { label: m.sparkLabel }) : null, icon('chevron-right')]),
      ],
    );
  }

  let chunkRaf = 0;
  function renderRows(): void {
    cancelAnimationFrame(chunkRaf);
    const sections = listModel(records, filter, sort);
    const nodes: HTMLElement[] = [];
    const pending: { list: HTMLUListElement; rows: RowModel[] }[] = [];
    let n = 0;
    for (const s of sections) {
      if (s.title) nodes.push(h('h3', { class: 'section-header ds-group' }, s.title));
      const ul = h('ul', { class: 'list card-list ds-list', aria: { label: s.title || 'Data sets' } });
      const now = s.rows.slice(0, Math.max(0, CHUNK - n));
      for (const m of now) ul.append(h('li', null, rowEl(m)));
      n += now.length;
      if (now.length < s.rows.length) pending.push({ list: ul, rows: s.rows.slice(now.length) });
      nodes.push(ul);
    }
    if (!sections.length) {
      nodes.push(
        h('p', { class: 'empty' }, planState === 'loading' ? 'Working out the data sets…' : scenario || planState === 'ready' ? 'No data set of this kind.' : 'No model built yet: build one to see the data sets it uses.'),
      );
    }
    setChildren(rowsHost, nodes);
    const shown = sections.reduce((a, x) => a + x.rows.length, 0);
    text(listStatus, `Showing ${shown} of ${records.length} data sets, by ${(SORTS.find((x) => x.id === sort)?.label ?? '').toLowerCase()}.`);
    // Rare long lists: add the rest in chunks after the first paint.
    const step = (): void => {
      const p = pending[0];
      if (!p || destroyed) return rowsHost.setAttribute('aria-busy', 'false');
      for (const m of p.rows.splice(0, CHUNK)) p.list.append(h('li', null, rowEl(m)));
      if (!p.rows.length) pending.shift();
      chunkRaf = requestAnimationFrame(step);
    };
    if (pending.length) {
      rowsHost.setAttribute('aria-busy', 'true');
      chunkRaf = requestAnimationFrame(step);
    }
  }

  function renderList(): void {
    const note =
      planState === 'ready'
        ? h('p', { class: 'hint' }, '≈ sizes are planned estimates of the uncompressed answers; bundled sizes are exact. Tap a data set for how each estimate was made.')
        : records.length
          ? h('p', { class: 'hint' }, 'Tap a data set for its origin, dates, resolution, statistics and licence.')
          : null;
    setChildren(listCard, [listHead, note, records.length ? filterHost : null, listStatus, rowsHost]);
    renderSortButton();
    renderFilters();
    renderRows();
  }

  // ───────────── DS4 working memory ─────────────
  const memLive = h('div', { class: 'ds-live', attrs: { 'aria-live': 'off' }, dataset: { testid: 'memory-live' } });
  function currentWorkingMemory(): WorkingMemory | null {
    if (!scenario) return null;
    try {
      const img = records.find((r) => r.id === 'imagery' && (r.status === 'used' || r.status === 'partial'));
      const iw = img?.native?.width ?? img?.model?.width;
      const ih = img?.native?.height ?? img?.model?.height;
      return workingMemoryForScenario(scenario, {
        snapshotBudgetBytes: defaultSnapshotBudget(),
        ...(iw && ih ? { imagery: { width: iw, height: ih } } : {}),
      });
    } catch (e) {
      console.warn('[FireSim] working memory model failed', e);
      return summary?.workingMemory ?? null;
    }
  }
  function renderLive(): void {
    const lm = liveMemory();
    const snap = opts.getSnapshot?.() ?? null;
    const rows: HTMLElement[] = [];
    if (lm.available && lm.usedJSHeapBytes) {
      rows.push(
        lm.limitBytes
          ? meter({ label: 'Screen side, measured now', valueText: `${formatBytes(lm.usedJSHeapBytes)} of ${formatBytes(lm.limitBytes)}`, fraction: lm.usedJSHeapBytes / lm.limitBytes })
          : h('p', { class: 't-body' }, `Screen side, measured now: ${formatBytes(lm.usedJSHeapBytes)}`),
      );
    }
    rows.push(h('p', { class: 'hint' }, lm.note));
    if (snap && scenario) {
      const budget = scenario.options?.maxEmbers;
      rows.push(
        h(
          'p',
          { class: 'hint' },
          `At the latest picture: ${fc(snap.stats?.activeEmbers ?? 0)} embers in the air${budget ? ` (the ember budget is ${fc(budget)})` : ''}. Embers and the burning front take a little more memory as the fire grows.`,
        ),
      );
    }
    setChildren(memLive, rows);
  }
  function renderMemory(): void {
    const wm = currentWorkingMemory();
    if (!wm) {
      memoryCard.hidden = true;
      return;
    }
    memoryCard.hidden = false;
    const mg = memoryGroups(wm);
    const out: HTMLElement[] = [
      cardTitle('Working memory while it runs', 'bar-chart'),
      h('div', { class: 'stat-row ds-stats', attrs: { role: 'group', 'aria-label': `About ${mg.total} in all` } }, [
        stat({ value: mg.total.split(' ')[0]!, unit: mg.total.split(' ')[1], caption: 'in all (modelled)' }),
        ...mg.groups.map((g) => {
          const [v, u] = g.text.split(' ');
          return stat({ value: v!, unit: u, caption: g.title });
        }),
      ]),
      stackedBar(
        mg.groups.map((g) => ({ weight: g.bytes, colour: g.colour, label: `${g.title} ${g.text}` })),
        { label: mg.groups.map((g) => `${g.title} ${g.text}`).join(', '), large: true },
      ),
      h(
        'div',
        { class: 'chips ds-legend' },
        mg.groups.map((g) => h('span', { class: 'legend-chip' }, [h('span', { class: ['swatch', 'ds-swatch', `ds-swatch-${g.colour}`] }), g.title])),
      ),
    ];
    for (const g of mg.groups) {
      out.push(
        h('h3', { class: 'section-header ds-group' }, [h('span', null, g.title), h('span', { class: 't-num' }, g.text)]),
        h('p', { class: 'hint ds-group-gloss' }, g.gloss),
        h(
          'ul',
          { class: 'list card-list no-lead ds-mem-list', aria: { label: g.title } },
          g.items.map((it) =>
            h(
              'li',
              { dataset: { memory: it.id } },
              h('div', { class: 'list-row two-line no-lead ds-mem-row' }, [
                h('span', { class: 'list-body' }, [
                  h('span', { class: 'list-title ds-mem-title' }, it.label),
                  h('span', { class: 'list-sub' }, [it.formula, it.note ? `. ${it.note}` : '']),
                  bar(it.fraction, { label: `${it.text}, ${Math.round(it.fraction * 100)} % of the largest part`, colour: g.colour }),
                ]),
                h('span', { class: 'list-trail t-num' }, it.text),
              ]),
            ),
          ),
        ),
      );
    }
    out.push(h('h3', { class: 'sub-title' }, 'Measured now'), memLive);
    for (const n of mg.notes) out.push(h('p', { class: 'hint ds-note' }, n));
    setChildren(memoryCard, out);
    renderLive();
    clearInterval(memTimer);
    memTimer = setInterval(() => !destroyed && !memoryCard.hidden && renderLive(), 5000);
  }

  // ───────────── DS4 on this phone ─────────────
  const storageResult = statusLine('storage-result');
  let storageLoading = true;
  async function loadStorage(): Promise<void> {
    storageLoading = true;
    renderStorage();
    try {
      const { storage } = await import('../../data/storage');
      const rep = await storage.report();
      if (destroyed) return;
      storageRep = rep;
    } catch (e) {
      console.warn('[FireSim] storage report failed', e);
      storageRep = null;
    }
    storageLoading = false;
    renderStorage();
    if (!summary && !records.length) renderSummary();
  }
  async function clearKind(kind: string, title: string, size: string, entries: string): Promise<void> {
    const ok = await confirmDialog({
      title: `Clear ${title.toLowerCase()}?`,
      body: `This deletes ${size} of stored copies (${entries}) from this phone. The app downloads them again the next time a model needs them and there is a signal. Saved areas are not touched.`,
      confirmLabel: 'Clear',
      danger: true,
      testId: 'confirm-clear-cache',
    });
    if (!ok || destroyed) return;
    say(storageResult, `Clearing ${title.toLowerCase()}…`, 0);
    try {
      const { storage } = await import('../../data/storage');
      const r = await storage.clearCache(kind as Parameters<typeof storage.clearCache>[0]);
      if (destroyed) return;
      say(storageResult, `Cleared ${title.toLowerCase()}: ${fc(r.removed)} ${r.removed === 1 ? 'item' : 'items'}, ${formatBytes(r.bytes)} freed.`, 0);
    } catch (e) {
      say(storageResult, `Could not clear ${title.toLowerCase()}: ${(e as Error).message || String(e)}`, 0);
    }
    void loadStorage();
  }
  async function deletePack(id: string, name: string, size: string): Promise<void> {
    const ok = await confirmDialog({
      title: `Delete the saved area “${name}”?`,
      body: `This deletes ${size} from this phone. Runs there will need a signal again (or use estimates when offline). Stored copies of other downloads are not touched.`,
      confirmLabel: 'Delete',
      danger: true,
      testId: 'confirm-delete-pack',
    });
    if (!ok || destroyed) return;
    say(storageResult, `Deleting “${name}”…`, 0);
    try {
      const { storage } = await import('../../data/storage');
      const done = await storage.deleteAreaPack(id);
      if (destroyed) return;
      say(storageResult, done ? `Deleted “${name}”: ${size} freed.` : `“${name}” was already gone.`, 0);
    } catch (e) {
      say(storageResult, `Could not delete “${name}”: ${(e as Error).message || String(e)}`, 0);
    }
    void loadStorage();
  }
  function renderStorage(): void {
    const out: HTMLElement[] = [cardTitle('On this phone', 'smartphone'), storageResult];
    if (storageLoading && !storageRep) {
      out.push(h('p', { class: 't-secondary' }, 'Reading what the app keeps on this phone…'), h('span', { class: 'skeleton skeleton-line ds-skel' }));
      setChildren(storageCard, out);
      return;
    }
    if (!storageRep) {
      out.push(h('p', { class: 't-secondary' }, 'The app’s storage could not be read on this phone.'));
      setChildren(storageCard, out);
      return;
    }
    const sm = storageModel(storageRep, tz);
    out.push(h('p', { class: 't-body ds-storage-head', dataset: { testid: 'storage-headline' } }, sm.headline));
    for (const w of sm.warnings) out.push(h('div', { class: 'callout callout-warn', attrs: { role: 'note' } }, [icon('warning'), h('div', null, w)]));
    if (sm.quota) out.push(meter({ label: 'Space used (the browser’s estimate)', valueText: sm.quota.text, fraction: sm.quota.fraction, tone: sm.quota.tone }));
    // Stored copies
    out.push(h('h3', { class: 'section-header ds-group' }, [h('span', null, 'Stored copies of downloads'), h('span', { class: 't-num' }, formatBytes(storageRep.cacheBytes))]));
    if (sm.caches.length) {
      out.push(
        h(
          'ul',
          { class: 'list card-list ds-store-list', aria: { label: 'Stored copies' } },
          sm.caches.map((c) =>
            h(
              'li',
              { dataset: { cache: c.kind } },
              h('div', { class: 'list-row three-line ds-store-row' }, [
                h('span', { class: 'list-lead' }, icon('storage')),
                h('span', { class: 'list-body' }, [
                  h('span', { class: 'list-title' }, c.title),
                  h('span', { class: 'list-sub' }, [c.size, ' · ', c.entries, c.dates ? ` · ${c.dates}` : '']),
                  c.places ? h('span', { class: 'list-sub' }, c.places) : null,
                  bar(c.fraction, { label: c.size, colour: 's4' }),
                ]),
                h('span', { class: 'list-trail' }, button({ label: 'Clear', variant: 'ghost', size: 'sm', testId: `clear-cache-${c.kind}`, onClick: () => void clearKind(c.kind, c.title, c.size, c.entries) })),
              ]),
            ),
          ),
        ),
      );
    } else out.push(h('p', { class: 'hint' }, 'None yet: downloads for places away from the demo sites are kept here so they can be run again with no signal.'));
    // Saved areas
    out.push(h('h3', { class: 'section-header ds-group' }, [h('span', null, 'Saved areas for offline use'), h('span', { class: 't-num' }, formatBytes(storageRep.packBytes))]));
    if (sm.packs.length) {
      out.push(
        h(
          'ul',
          { class: 'list card-list ds-store-list', aria: { label: 'Saved areas' } },
          sm.packs.map((p) =>
            h(
              'li',
              { dataset: { pack: p.id } },
              h('div', { class: 'list-row three-line ds-store-row' }, [
                h('span', { class: 'list-lead' }, icon('download')),
                h('span', { class: 'list-body' }, [
                  h('span', { class: 'list-title' }, p.name),
                  h('span', { class: 'list-sub' }, [p.size, ' · ', p.items, p.created ? ` · saved ${p.created}` : '']),
                  p.area ? h('span', { class: 'list-sub' }, p.area) : null,
                  bar(p.fraction, { label: p.size, colour: 's4' }),
                ]),
                h('span', { class: 'list-trail' }, button({ label: 'Delete', variant: 'ghost', size: 'sm', testId: `delete-pack-${p.id}`, onClick: () => void deletePack(p.id, p.name, p.size) })),
              ]),
            ),
          ),
        ),
      );
    } else out.push(h('p', { class: 'hint' }, 'None: save an area from Setup (“Save this area for offline use”) to train there with no signal.'));
    // Bundled with the app
    out.push(h('h3', { class: 'section-header ds-group' }, [h('span', null, 'Bundled with the app'), h('span', { class: 't-num' }, sm.bundled.available ? sm.bundled.total : '')]));
    if (sm.bundled.available) {
      out.push(
        h(
          'ul',
          { class: 'list card-list ds-store-list', aria: { label: 'Bundled demo sites' } },
          [
            ...sm.bundled.sites.map((s) =>
              h(
                'li',
                { dataset: { site: s.id } },
                h('div', { class: 'list-row two-line' }, [
                  h('span', { class: 'list-lead' }, icon('map')),
                  h('span', { class: 'list-body' }, [h('span', { class: 'list-title' }, s.name), h('span', { class: 'list-sub' }, s.captured ? `Demo site, captured ${s.captured}` : 'Demo site'), bar(s.fraction, { label: `${s.size}`, colour: 's1' })]),
                  h('span', { class: 'list-trail t-num' }, s.size),
                ]),
              ),
            ),
            sm.bundled.replays
              ? h('li', null, h('div', { class: 'list-row' }, [h('span', { class: 'list-lead' }, icon('replay')), h('span', { class: 'list-body' }, h('span', { class: 'list-title' }, 'Weather of past fire days (replays)')), h('span', { class: 'list-trail t-num' }, sm.bundled.replays)]))
              : null,
          ].filter((x): x is HTMLLIElement => !!x),
        ),
        h('p', { class: 'hint' }, 'Part of the app: these cannot be deleted, and they let the demo sites work with no signal.'),
      );
    } else out.push(h('p', { class: 'hint' }, 'The list of bundled files is missing from this build, so its size is not shown.'));
    for (const n of sm.notes) out.push(h('p', { class: 'hint ds-note' }, n));
    setChildren(storageCard, out);
  }

  // ───────────── DS6 how to read this ─────────────
  function renderHow(): void {
    const g = glossary(summary?.model.cellSizeM);
    const dl = (title: string, xs: { term: string; text: string }[]): HTMLElement[] => [
      h('h3', { class: 'sub-title' }, title),
      kv(
        xs.map((x) => ({ key: x.term, value: x.text })),
        { layout: 'stack', dense: true },
      ),
    ];
    const details = h('details', { class: 'ds-details', dataset: { testid: 'datasets-how-to-read' } }, [
      h('summary', null, 'How to read this'),
      h('div', { class: 'ds-details-body' }, [
        ...dl('Where the data come from', g.origins),
        ...dl('How far to trust it', g.evidence),
        ...dl('Resolution', g.resolution),
        ...dl('Sizes', g.sizes),
      ]),
    ]);
    const link = opts.onOpenModelCard
      ? h(
          'ul',
          { class: 'list card-list' },
          h(
            'li',
            null,
            h('button', { type: 'button', class: 'list-row two-line', dataset: { testid: 'datasets-model-card' }, on: { click: () => opts.onOpenModelCard?.() } }, [
              h('span', { class: 'list-lead' }, icon('help-circle')),
              h('span', { class: 'list-body' }, [h('span', { class: 'list-title' }, 'How this simulation works'), h('span', { class: 'list-sub' }, 'What is 2-D and what is 3-D, grids, time steps and limits')]),
              h('span', { class: 'list-trail' }, icon('chevron-right')),
            ]),
          ),
        )
      : null;
    setChildren(howCard, [details, link]);
  }

  // ───────────── copy / export ─────────────
  function exportButtons(line: HTMLElement, one?: DatasetRecord): HTMLElement {
    const all = (): DatasetRecord[] => records;
    return h('div', { class: 'row-actions ds-actions ds-export-actions' }, [
      one ? button({ label: 'Copy details', icon: 'copy', variant: 'tonal', size: 'sm', testId: 'copy-details', onClick: () => void copyInto(line, datasetsToText([one]), `the details of “${one.title}”`) }) : null,
      button({ label: one ? 'Copy all as text' : 'Copy as text', icon: 'copy', variant: one ? 'secondary' : 'tonal', size: 'sm', testId: 'copy-text', onClick: () => void copyInto(line, datasetsToText(all(), summary), `${fc(all().length)} data sets as text`) }),
      button({ label: 'Copy as CSV', icon: 'table', variant: 'secondary', size: 'sm', testId: 'copy-csv', onClick: () => void copyInto(line, datasetsToCsv(all()), `${fc(all().length)} data sets as CSV`) }),
      button({ label: 'Copy as JSON', icon: 'file', variant: 'secondary', size: 'sm', testId: 'copy-json', onClick: () => void copyInto(line, datasetsToJson(all(), summary), `${fc(all().length)} data sets as JSON`) }),
      one ? null : button({ label: 'Statistics as CSV', icon: 'stats', variant: 'secondary', size: 'sm', testId: 'copy-stats-csv', onClick: () => void copyInto(line, datasetsToCsv(all(), { stats: true }), 'the statistics as CSV') }),
    ]);
  }
  function renderExport(): void {
    if (!records.length) {
      exportCard.hidden = true;
      return;
    }
    exportCard.hidden = false;
    const line = statusLine('export-status');
    setChildren(exportCard, [
      cardTitle('Copy the inventory', 'share'),
      h('p', { class: 'hint' }, 'Copies the whole list to the clipboard, to paste into a message, a note or a spreadsheet. Nothing is sent anywhere.'),
      exportButtons(line),
      line,
    ]);
  }

  // ───────────── DS3 detail ─────────────
  const factRow = (f: Fact): KvRow => ({ key: f.key, value: f.value.includes('\n') ? h('span', { class: 'ds-multiline' }, f.value) : f.value });
  /**
   * Key-value facts (the .kv primitive) with an optional plain-English note on its own line under each value. `stack` puts
   * each value under its key (long text); otherwise short values sit on the right. `value` may decorate a fact (a link, a bar).
   */
  const factList = (facts: readonly Fact[], o: { label: string; stack?: boolean; testId?: string; value?: (f: Fact) => Node | null }): HTMLElement =>
    h(
      'dl',
      { class: ['kv', 'ds-kv', o.stack && 'kv-stack'], aria: { label: o.label }, dataset: o.testId ? { testid: o.testId } : undefined },
      facts.map((f) =>
        h('div', { class: 'kv-row', dataset: { key: f.key } }, [
          h('dt', { class: 'kv-key' }, f.key),
          h('dd', { class: 'kv-val' }, o.value?.(f) ?? (f.value.includes('\n') ? h('span', { class: 'ds-multiline' }, f.value) : f.value)),
          f.note ? h('dd', { class: 'ds-kv-note' }, f.note) : null,
        ]),
      ),
    );

  function linkValue(name: string, url: string | undefined, what: string): HTMLElement {
    const line = statusLine(`link-status-${what}`);
    const openBtn = button({
      label: 'Open',
      icon: 'open-in-new',
      variant: 'ghost',
      size: 'sm',
      testId: `open-${what}`,
      onClick: async () => {
        const ok = await confirmDialog({ title: 'Open this page in your browser?', body: h('span', { class: 'ds-url' }, url ?? ''), confirmLabel: 'Open', testId: 'confirm-open-link' });
        if (ok && url && !destroyed) window.open(url, '_blank', 'noopener,noreferrer');
      },
    });
    openBtn.hidden = true;
    return h('div', { class: 'ds-link-val' }, [
      h('span', null, name),
      url
        ? h('div', { class: 'ds-link-actions' }, [
            h(
              'button',
              {
                type: 'button',
                class: 'chip ds-link',
                dataset: { testid: `copy-link-${what}` },
                aria: { label: `Copy the link of ${name}: ${url}` },
                on: {
                  click: async () => {
                    const ok = await copyText(url);
                    if (destroyed) return;
                    say(line, ok ? `Link copied: ${url}` : `Could not copy. The link is ${url}`, 12000);
                    openBtn.hidden = false;
                  },
                },
              },
              [icon('link'), h('span', { class: 'ds-link-host' }, hostOf(url))],
            ),
            openBtn,
          ])
        : null,
      url ? line : null,
    ]);
  }

  function section(title: string, ic: IconName, body: (HTMLElement | null | false)[], testId?: string): HTMLElement {
    return h('section', { class: 'card', dataset: testId ? { testid: testId } : undefined, aria: { label: title } }, [cardTitle(title, ic), ...body.filter((x): x is HTMLElement => !!x)]);
  }

  function renderDetail(r: DatasetRecord): { nodes: HTMLElement[]; dispose(): void } {
    const disposeFns: (() => void)[] = [];
    const nodes: HTMLElement[] = [];
    const now = Date.now();
    // Identity
    const chips: HTMLElement[] = [];
    const m = listModel([r], 'all', 'name')[0]?.rows[0];
    if (m?.origin) chips.push(originChip(m.origin.cls, m.origin.label));
    if (m?.status) chips.push(badge(m.status.label, { tone: m.status.tone === 'watch' ? 'watch' : 'neutral', icon: m.status.notUsed ? 'close' : 'warning' }));
    const ev = evidenceModel(r);
    if (ev) chips.push(badge(ev.title, { tone: ev.tone, dot: true }));
    if (r.plan) chips.push(badge('≈ estimate', { tone: 'neutral' }));
    const reason = m?.reason ?? '';
    const snap = opts.getSnapshot?.() ?? null;
    const targets =
      opts.onShowLayer && scenario && !r.plan
        ? showTargets(
            r,
            availabilityContext({
              fuel: scenario.fuel,
              snapshot: snap,
              context: scenario.context ?? null,
              hasImagery: records.some((x) => x.id === 'imagery' && (x.status === 'used' || x.status === 'partial')),
              fire: !!snap,
            }),
          )
        : [];
    nodes.push(
      h('section', { class: 'card ds-identity', dataset: { testid: 'dataset-identity' } }, [
        h('div', { class: 'ds-identity-head' }, [h('span', { class: 'ds-identity-icon' }, icon(m?.icon ?? 'database')), h('div', { class: 'ds-identity-titles' }, [h('h2', { class: 't-title' }, clean(r.title) || r.id), h('p', { class: 't-secondary' }, shortProvider(r.provider?.name ?? ''))])]),
        chips.length ? h('div', { class: 'ds-row-chips ds-identity-chips' }, chips) : null,
        h('p', { class: 't-body' }, clean(r.what)),
        clean(r.why) ? h('h3', { class: 'sub-title' }, 'Why the simulator uses it') : null,
        clean(r.why) ? h('p', { class: 't-body' }, clean(r.why)) : null,
        reason
          ? h('div', { class: ['callout', m?.status?.notUsed ? 'callout-info' : 'callout-warn'], attrs: { role: 'note' }, dataset: { testid: 'dataset-reason' } }, [
              icon(m?.status?.notUsed ? 'info' : 'warning'),
              h('div', null, [h('p', { class: 't-medium' }, m?.status?.label ?? ''), h('p', null, reason)]),
            ])
          : null,
        targets.length
          ? h(
              'div',
              { class: 'row-actions ds-actions' },
              targets.map((t, i) =>
                button({
                  label: t.label,
                  icon: t.kind === 'heat' ? 'layers' : 'map',
                  variant: i === 0 ? 'primary' : 'tonal',
                  size: 'sm',
                  disabled: !t.ok,
                  testId: i === 0 ? 'show-on-map' : 'show-heat',
                  onClick: () => {
                    opts.onShowLayer?.(t.target);
                    if (!destroyed && el.isConnected) opts.onClose();
                  },
                }),
              ),
            )
          : null,
        targets.some((t) => !t.ok || targets.length > 1)
          ? h('p', { class: 'hint' }, targets.map((t) => (t.ok ? `${t.label}: ${t.layerTitle}.` : `${t.layerTitle}: ${t.reason}.`)).join(' '))
          : null,
      ]),
    );
    // Where it comes from
    const src = factList(sourceFacts(r), {
      label: 'Source',
      stack: true,
      value: (f) => (f.key === 'Provider' ? linkValue(f.value, r.provider?.url, 'provider') : f.key === 'Licence' ? linkValue(f.value, r.licence?.url, 'licence') : null),
    });
    nodes.push(section('Where it comes from', 'globe', [src], 'dataset-source'));
    // When
    const tf = timeFacts(r, now, tz);
    if (tf.length) nodes.push(section('When', 'calendar', [factList(tf, { label: 'Dates', stack: true })], 'dataset-time'));
    // Where and how fine
    const sp = spaceFacts(r);
    const spaceBody: (HTMLElement | null)[] = [];
    if (sp.length)
      spaceBody.push(
        factList(sp, {
          label: 'Coordinates and resolution',
          stack: true,
          value: (f) =>
            f.key === 'Real data cover' && !r.plan
              ? h('span', { class: 'ds-coverage' }, [h('span', null, f.value), bar(r.coverage.fraction, { label: `Real data cover ${Math.round(r.coverage.fraction * 100)} % of the model area`, colour: 'ok', large: true })])
              : null,
        }),
      );
    // Heat-map preview in the map's own colours (drawn once, disposed on leaving the page)
    const overlay = r.layer?.overlay as OverlayKind | undefined;
    if (scenario && overlay && !r.plan && r.status !== 'unavailable' && r.status !== 'skipped') {
      try {
        const d = heatPreviewData(overlay, scenario, snap);
        if (d) {
          const pv = heatPreview(d, clean(r.title));
          disposeFns.push(pv.dispose);
          spaceBody.push(h('h3', { class: 'sub-title' }, 'Preview in the heat map’s colours'), pv.el);
        }
      } catch (e) {
        console.warn('[FireSim] preview failed', e);
      }
    }
    if (spaceBody.length) nodes.push(section('Where and how fine', 'grid', spaceBody, 'dataset-space'));
    // Size
    const sz = sizeFacts(r);
    const sizeBody: (HTMLElement | null)[] = [];
    if (sz.parts.length > 1) {
      sizeBody.push(
        stackedBar(
          sz.parts.map((p) => ({ weight: p.bytes, colour: p.colour, label: `${p.label} ${formatBytes(p.bytes)}` })),
          { label: `Obtained from: ${sz.parts.map((p) => `${p.label} ${formatBytes(p.bytes)}`).join(', ')}`, large: true },
        ),
        h(
          'div',
          { class: 'chips ds-legend' },
          sz.parts.map((p) => h('span', { class: 'legend-chip' }, [h('span', { class: ['swatch', 'ds-swatch', `ds-swatch-${p.colour}`] }), `${p.label} ${formatBytes(p.bytes)}`])),
        ),
      );
    }
    if (sz.bars.length) {
      const max = Math.max(...sz.bars.map((b) => b.bytes));
      sizeBody.push(
        h(
          'dl',
          { class: 'kv kv-dense ds-size-bars', aria: { label: 'Sizes compared' } },
          sz.bars.map((b) => h('div', { class: 'kv-row' }, [h('dt', { class: 'kv-key' }, b.label), h('dd', { class: 'kv-val' }, [bar(b.bytes / max, { label: `${b.label} ${b.text}` }), h('span', { class: 'ds-bar-text' }, b.text)])])),
        ),
      );
    }
    if (sz.facts.length) sizeBody.push(factList(sz.facts, { label: 'Sizes', stack: !!r.plan }));
    const parts = partFacts(r);
    if (parts.length) {
      sizeBody.push(
        h('h3', { class: 'sub-title' }, 'Made up of'),
        h(
          'ul',
          { class: 'list card-list no-lead ds-parts' },
          parts.map((p) => h('li', null, h('div', { class: ['list-row', p.note ? 'two-line' : '', 'no-lead'] }, [h('span', { class: 'list-body' }, [h('span', { class: 'list-title ds-part-title' }, p.label), p.note ? h('span', { class: 'list-sub' }, p.note) : null]), h('span', { class: 'list-trail t-num' }, p.value)]))),
        ),
      );
    }
    if (sizeBody.length) nodes.push(section('Size', 'storage', sizeBody, 'dataset-size'));
    // Statistics and distribution
    const st = statFacts(r);
    const dm = distributionModel(r);
    const statBody: (HTMLElement | null)[] = [];
    if (dm) {
      if (dm.kind === 'histogram') {
        statBody.push(
          h('h3', { class: 'sub-title' }, dm.title),
          h('figure', { class: 'ds-hist-fig' }, [
            h('span', { class: 'sparkbar ds-hist', attrs: { role: 'img', 'aria-label': dm.label } }, dm.bars.map((b) => h('i', { style: `--h:${Math.round(b.height * 100)}%`, attrs: { title: b.label } }))),
            dm.axis ? h('figcaption', { class: 'ds-hist-axis t-caption' }, [h('span', null, dm.axis.lo), h('span', null, dm.caption), h('span', null, dm.axis.hi)]) : h('figcaption', { class: 't-caption' }, dm.caption),
          ]),
        );
      } else {
        statBody.push(
          h('h3', { class: 'sub-title' }, dm.title),
          h(
            'dl',
            { class: 'kv kv-dense ds-cats', aria: { label: dm.label } },
            dm.bars.map((b) =>
              h('div', { class: 'kv-row' }, [
                h('dt', { class: 'kv-key ds-cat-key' }, [b.colour ? h('span', { class: 'swatch', style: `background:${b.colour}` }) : null, b.label]),
                h('dd', { class: 'kv-val' }, [h('span', { class: 'bar ds-cat-bar', style: `--v:${Math.round(b.height * 1000) / 10}%${b.colour ? `;--bar-color:${b.colour}` : ''}`, attrs: { role: 'img', 'aria-label': `${b.label} ${Math.round(b.share * 1000) / 10} %` } }, h('span', { class: 'bar-fill' })), h('span', { class: 'ds-bar-text' }, `${pctText(b.share)}`)]),
              ]),
            ),
          ),
          h('p', { class: 't-caption' }, dm.caption),
        );
      }
    }
    if (st.length) statBody.push(h('h3', { class: 'sub-title' }, 'As recorded'), factList(st, { label: 'Statistics', testId: 'dataset-stat-list' }));
    if (statBody.length) nodes.push(section('Statistics', 'stats', statBody, 'dataset-stats'));
    // Trust, warnings, limitations
    const trust: (HTMLElement | null)[] = [];
    if (ev) {
      trust.push(
        h('div', { class: 'ds-row-chips' }, [badge(ev.title, { tone: ev.tone, dot: true })]),
        h('p', { class: 't-body' }, ev.gloss),
        ev.note ? h('p', { class: 't-body' }, ev.note) : null,
        ev.specRef ? h('p', { class: 'hint' }, ['Explained in ', h('code', { class: 'code' }, ev.specRef)]) : null,
      );
    }
    const warnings = r.warnings.map(clean).filter(Boolean);
    if (warnings.length) trust.push(h('div', { class: 'callout callout-warn', attrs: { role: 'note' } }, [icon('warning'), h('div', null, [h('p', { class: 't-medium' }, 'Problems met while building it'), h('ul', { class: 'ds-bullets' }, warnings.map((w) => h('li', null, w)))])]));
    const lims = r.limitations.map(clean).filter(Boolean);
    if (lims.length) trust.push(h('h3', { class: 'sub-title' }, 'What it cannot tell you'), h('ul', { class: 'ds-bullets t-body' }, lims.map((l) => h('li', null, l))));
    if (trust.length) nodes.push(section('How far to trust it', 'check-circle', trust, 'dataset-trust'));
    // Copy
    const line = statusLine('detail-copy-status');
    nodes.push(section('Copy', 'copy', [exportButtons(line, r), line], 'dataset-copy'));
    return { nodes, dispose: () => disposeFns.forEach((f) => f()) };
  }

  function openDetail(id: string, opener?: HTMLElement | null): void {
    const r = records.find((x) => x.id === id);
    if (!r) return;
    closeSort(false);
    detailDispose?.();
    detailOpener = opener ?? null;
    if (listPage.hidden === false) listScroll = listMain.scrollTop;
    const d = renderDetail(r);
    detailDispose = d.dispose;
    detailId = id;
    text(detailTitle, clean(r.title) || r.id);
    setChildren(detailMain, d.nodes);
    detailMain.scrollTop = 0;
    listPage.hidden = true;
    detailPage.hidden = false;
    detailPage.dataset.dataset = id;
    detailTitle.focus({ preventScroll: true });
  }

  function closeDetail(): void {
    if (detailId === null) return;
    detailDispose?.();
    detailDispose = null;
    detailId = null;
    setChildren(detailMain, null);
    detailPage.hidden = true;
    listPage.hidden = false;
    listMain.scrollTop = listScroll;
    const back = detailOpener?.isConnected ? detailOpener : null;
    (back ?? (listPage.querySelector('h1') as HTMLElement | null))?.focus({ preventScroll: true });
  }

  // ───────────── Back and Escape ─────────────
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    e.stopPropagation();
    if (!sortMenu.hidden) closeSort();
    else if (detailId !== null) closeDetail();
    else opts.onClose();
  });

  // ───────────── first paint, then the async parts ─────────────
  function renderAll(): void {
    renderSummary();
    renderList();
    renderMemory();
    renderStorage();
    renderHow();
    renderExport();
  }
  renderAll();
  void loadStorage();
  if (planState === 'loading' && opts.request) {
    const req = opts.request;
    void (async () => {
      try {
        const r = buildRequest(req, settingsStore.get());
        const { estimateScenarioData } = await import('../../scenario/estimate');
        const rs = await estimateScenarioData(r);
        if (destroyed) return;
        records = rs;
        summary = null;
        planState = 'ready';
      } catch (e) {
        console.warn('[FireSim] data plan unavailable', e);
        if (destroyed) return;
        planState = 'failed';
      }
      renderSummary();
      renderList();
      renderExport();
      if (opts.initialDatasetId && records.some((x) => x.id === opts.initialDatasetId)) openDetail(opts.initialDatasetId);
    })();
  } else if (opts.initialDatasetId && records.some((x) => x.id === opts.initialDatasetId)) {
    openDetail(opts.initialDatasetId);
    // The App focuses the first heading after this returns (the list page's, hidden now): move it to the detail title.
    requestAnimationFrame(() => !destroyed && detailId !== null && detailTitle.focus({ preventScroll: true }));
  }

  return {
    el,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelAnimationFrame(chunkRaf);
      clearInterval(memTimer);
      for (const t of timers) clearTimeout(t);
      timers.clear();
      document.removeEventListener('pointerdown', onDocDown, true);
      detailDispose?.();
      el.remove();
    },
  };
}

/** A count whose thousands never break across lines. */
const fc = (n: number): string => formatCount(n).replace(/\u2009/g, '\u202f');

const pctText = (share: number): string => {
  const p = share * 100;
  return p >= 10 ? `${Math.round(p)} %` : p >= 0.1 ? `${Math.round(p * 10) / 10} %` : '<0.1 %';
};

/** Host of a URL for a link chip ('creativecommons.org'); the URL itself when it does not parse. */
function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}
