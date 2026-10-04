/**
 * The bottom dock, Google-Maps style: a bottom navigation row (Insights with an unseen-cards badge, Weather, Stats, Help)
 * directly above the timeline, and above it a bottom sheet (grab handle, rounded top corners) that a tab opens at
 * "peek"; drag the handle or the navigation row to "half" / "full", tap the handle to step up, tap the same tab, the
 * close button or the map to close it. Collapsed by default. Nothing here ever pops up on its own: new cards only change
 * the badge. Taps work everywhere a drag does, so nothing depends on a gesture.
 */
import type { Insight } from '../../../core/types';
import { msToKmh } from '../../../core/units';
import { h, listen, prefersReducedMotion, setChildren, text } from '../../dom';
import { icon, type IconName } from '../../icons';
import { GLOSSARY } from '../../content';
import {
  compassName,
  formatArea,
  formatClock,
  formatDirFrom,
  formatDistance,
  formatHeading,
  formatIntensity,
  formatMetres,
  formatNumber,
  formatPercent,
  formatRelative,
  formatRH,
  formatRos,
  formatTemp,
  formatWind,
} from '../../format';
import { baselineAt } from '../../session';
import { detectWindChanges, plumeRegime, ratingStyle } from '../../weatherCalc';
import { sampleSeries } from '../../weatherSeries';
import { BurnState } from '../../../core/types';
import { kv, listRow, list, sectionHeader, stackedBar, statRow, type KvRow } from '../../primitives';
import type { SheetTab, SimContext } from './context';
import { insightCard } from './insightCard';
import { has3dAtmosphere } from './context';
import { groupInsights, UnseenTracker, type InsightGroup } from '../../insightGroups';
import { badgeText, cycleDetent, detentHeights, DOCK_H, pressTab, snapDetent, tapHandle } from './layoutModel';
import { dataUsed } from './dataSummary';
import { chartHeight, drawWeatherChart, litterEstimate } from './weatherChart';

const TABS: { id: SheetTab; label: string; icon: IconName }[] = [
  { id: 'insights', label: 'Insights', icon: 'list' },
  { id: 'weather', label: 'Weather', icon: 'chart' },
  { id: 'stats', label: 'Stats', icon: 'stats' },
  { id: 'help', label: 'Help', icon: 'help' },
];

export function createSheet(ctx: SimContext, onShowInsight: (i: Insight) => void): { el: HTMLElement; destroy(): void; targetHeight(): number } {
  const { session, ui } = ctx;
  const unsubs: (() => void)[] = [];

  // ── bottom navigation (the collapsed dock) ──
  const badge = h('span', { class: 'nav-badge sim-badge', hidden: true, dataset: { testid: 'insights-badge' } });
  const tabBtns = TABS.map((t) =>
    h(
      'button',
      {
        type: 'button',
        class: ['nav-item', 'sheet-tab'],
        id: `tab-${t.id}`,
        attrs: { role: 'tab', 'aria-controls': `panel-${t.id}` },
        dataset: { testid: `tab-${t.id}` },
        on: { click: () => ui.set(pressTab({ sheet: ui.get().sheet, tab: ui.get().tab }, t.id)) },
      },
      [h('span', { class: 'nav-icon' }, [icon(t.icon), t.id === 'insights' ? badge : null]), h('span', { class: 'nav-label' }, t.label)],
    ),
  );
  // The row is a handle too: tapping its gaps opens / closes, dragging it resizes the sheet.
  const handle = h(
    'div',
    {
      class: 'bottom-nav sheet-handle',
      dataset: { testid: 'sheet-handle' },
      attrs: { role: 'tablist', 'aria-label': 'Panels' },
      on: { click: (e) => e.target === handle && ui.set({ sheet: tapHandle(ui.get().sheet) }) },
    },
    tabBtns,
  );

  // ── sheet (above the navigation row) ──
  const grip = h('button', { type: 'button', class: 'bottom-sheet-grab sheet-grab', dataset: { testid: 'sheet-grip' }, aria: { label: 'Make the panel taller' }, on: { click: () => ui.set({ sheet: cycleDetent(ui.get().sheet) }) } });
  const title = h('h2', { class: 'bottom-sheet-title sheet-title', attrs: { 'aria-live': 'off' } }, TABS[0]!.label);
  const closeBtn = h('button', { type: 'button', class: 'icon-btn sheet-close', dataset: { testid: 'sheet-close' }, aria: { label: 'Close panel' }, on: { click: () => ui.set({ sheet: 'closed' }) } }, icon('close'));
  const head = h('div', { class: 'sheet-head' }, [grip, title, closeBtn]);
  const panels: Record<SheetTab, HTMLElement> = {
    insights: h('div', { class: 'tab-panel', id: 'panel-insights', attrs: { role: 'tabpanel', 'aria-labelledby': 'tab-insights' } }),
    weather: h('div', { class: 'tab-panel', id: 'panel-weather', attrs: { role: 'tabpanel', 'aria-labelledby': 'tab-weather' } }),
    stats: h('div', { class: 'tab-panel', id: 'panel-stats', attrs: { role: 'tabpanel', 'aria-labelledby': 'tab-stats' } }),
    help: h('div', { class: 'tab-panel', id: 'panel-help', attrs: { role: 'tabpanel', 'aria-labelledby': 'tab-help' } }),
  };
  const body = h('div', { class: 'sheet-body' }, Object.values(panels));
  const sheet = h('section', { class: 'sheet', dataset: { testid: 'sheet' }, aria: { label: 'Insights, weather, statistics and help' } }, [head, body]);
  const el = h('div', { class: 'dock', dataset: { testid: 'dock', detent: 'closed' } }, [sheet, handle]);

  // ───────────── detents & drag ─────────────
  /** Vertical room (px) between the top chrome and the timeline strip, for the dock's detents. */
  const room = (): number => {
    const parent = el.parentElement;
    if (!parent) return window.innerHeight - 200;
    const pr = parent.getBoundingClientRect();
    let top = parent.querySelector('.sim-topbar')?.getBoundingClientRect().bottom ?? pr.top + 100;
    const chip = parent.querySelector('.error-chip');
    if (chip && !(chip as HTMLElement).hidden) top = Math.max(top, chip.getBoundingClientRect().bottom);
    const scrubTop = parent.querySelector('.scrubber')?.getBoundingClientRect().top ?? pr.bottom - 64;
    return Math.max(DOCK_H, scrubTop - top);
  };
  const heights = () => detentHeights(room());
  const targetHeight = (): number => heights()[ui.get().sheet];
  const applyDetent = (): void => {
    const d = ui.get().sheet;
    el.style.height = `${heights()[d]}px`;
    el.dataset.detent = d;
    grip.setAttribute('aria-label', d === 'full' ? 'Make the panel smaller' : 'Make the panel taller');
  };
  let drag: { y: number; h: number; moved: boolean; id: number; src: HTMLElement } | null = null;
  let stopTracking: (() => void) | null = null;
  const onDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag = { y: e.clientY, h: el.getBoundingClientRect().height, moved: false, id: e.pointerId, src: e.currentTarget as HTMLElement };
    // Follow the pointer on the window (a mouse leaves the small handle at once; touches are captured implicitly), and
    // do not capture it explicitly: a plain tap must still reach the tab button under the finger.
    stopTracking?.();
    const offs = [listen(window, 'pointermove', onMove), listen(window, 'pointerup', onUp), listen(window, 'pointercancel', onUp)];
    stopTracking = () => {
      for (const o of offs) o();
      stopTracking = null;
    };
  };
  const onMove = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dy) > 8) {
      drag.moved = true;
      el.classList.add('dragging');
      el.parentElement?.classList.add('dragging-dock');
    }
    if (drag.moved) el.style.height = `${Math.max(DOCK_H, Math.min(heights().full, drag.h - dy))}px`;
  };
  const onUp = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    stopTracking?.();
    el.classList.remove('dragging');
    el.parentElement?.classList.remove('dragging-dock');
    if (!d.moved) return;
    const next = e.type === 'pointercancel' ? ui.get().sheet : snapDetent(el.getBoundingClientRect().height, heights());
    ui.set({ sheet: next });
    applyDetent();
    // Swallow the click that follows a drag.
    const stop = (ev: Event): void => ev.stopPropagation();
    d.src.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => d.src.removeEventListener('click', stop, { capture: true }), 60);
  };
  handle.addEventListener('pointerdown', onDown);
  head.addEventListener('pointerdown', onDown);
  unsubs.push(listen(window, 'resize', applyDetent));

  // ───────────── tabs ─────────────
  let shownTab = ui.get().tab;
  const renderTabs = (): void => {
    const s = ui.get();
    const open = s.sheet !== 'closed';
    // The four panels share one scrolling body: a tab opens at its top, not at the offset the previous tab was left at.
    if (s.tab !== shownTab) {
      shownTab = s.tab;
      body.scrollTop = 0;
    }
    for (const b of tabBtns) {
      const on = open && b.id === `tab-${s.tab}`;
      b.setAttribute('aria-selected', String(on));
      b.setAttribute('aria-expanded', String(on));
      b.tabIndex = b.id === `tab-${s.tab}` ? 0 : -1;
    }
    for (const [id, p] of Object.entries(panels)) p.hidden = id !== s.tab;
    text(title, TABS.find((t) => t.id === s.tab)?.label ?? '');
    el.hidden = s.panelOpen;
    el.parentElement?.classList.toggle('sheet-full', s.sheet === 'full' && !s.panelOpen);
    el.parentElement?.classList.toggle('sheet-open', open && !s.panelOpen);
    applyDetent();
    renderBadge();
    renderActive();
  };
  handle.addEventListener('keydown', (e) => {
    const i = TABS.findIndex((t) => t.id === ui.get().tab);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const n = (i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
      ui.set({ tab: TABS[n]!.id });
      tabBtns[n]!.focus();
    }
  });

  // ───────────── the unseen-cards badge ─────────────
  // New cards never interrupt: they only raise this number (red with a warning mark and one short pulse when one is a
  // Danger card).
  const unseen = new UnseenTracker();
  const insightsShown = (): boolean => {
    const s = ui.get();
    return s.sheet !== 'closed' && s.tab === 'insights' && !s.panelOpen;
  };
  let lastDanger = 0;
  let badgeKey = '';
  const renderBadge = (): void => {
    if (insightsShown()) unseen.markSeen();
    const vt = session.state.get().viewTime;
    const n = unseen.count(vt);
    const d = unseen.dangerCount(vt);
    const key = `${n}|${d}`;
    if (key === badgeKey) return;
    badgeKey = key;
    badge.hidden = n === 0;
    setChildren(badge, d > 0 ? [icon('danger', { class: 'nav-badge-icon' }), badgeText(n)] : badgeText(n));
    badge.classList.toggle('is-danger', d > 0);
    tabBtns[0]!.setAttribute('aria-label', n === 0 ? 'Insights' : `Insights, ${n} new${d > 0 ? `, ${d} of them danger` : ''}`);
    if (d > lastDanger && !prefersReducedMotion()) {
      badge.classList.remove('pulse');
      void badge.offsetWidth; // restart the one-shot animation
      badge.classList.add('pulse');
    }
    lastDanger = d;
  };
  badge.addEventListener('animationend', () => badge.classList.remove('pulse'));
  unsubs.push(
    session.events.on('reveal', (i) => {
      if (!insightsShown()) unseen.add(i);
      renderBadge();
    }),
    session.controller.on('rewound', (t) => {
      unseen.reset(t);
      renderBadge();
    }),
  );

  // ───────────── Insights ─────────────
  let lastInsightKey = '';
  const renderInsights = (): void => {
    const s = session.state.get();
    const items = session.visibleInsights(s);
    const key = `${items.map((i) => i.id).join('|')}|${s.compare ? Math.round(s.viewTime / 300) : ''}|${s.error ?? ''}`;
    if (key === lastInsightKey) return;
    lastInsightKey = key;
    const forecast = new Set(s.forecastInsights);
    const compare = s.compare;
    const b = compare ? baselineAt(compare, s.viewTime) : null;
    const cur = s.snapshot?.stats;
    setChildren(panels.insights, [
      s.error
        ? h('div', { class: 'callout callout-danger sim-error', attrs: { role: 'alert' }, dataset: { testid: 'sim-error' } }, [
            icon('warning'),
            h('div', null, [
              h('p', { class: 'callout-title' }, 'The simulation stopped with a problem'),
              h('p', null, s.error),
              h('p', { class: 'hint' }, 'The view keeps what was already computed. Open the menu (top left) and start a new scenario, or try Play again.'),
            ]),
          ])
        : null,
      compare
        ? h('div', { class: 'callout callout-info compare' }, [
            icon('whatif'),
            h('div', null, [
              h('p', { class: 'callout-title' }, `What-if from ${formatClock(ctx.absTime(compare.since), ctx.tz)}: ${compare.label}`),
              b && cur
                ? h('p', null, `At ${formatClock(ctx.absTime(s.viewTime), ctx.tz)}: ${formatArea(cur.burntAreaHa)} burnt vs ${formatArea(b.burntAreaHa)} before (${pct(cur.burntAreaHa, b.burntAreaHa)}).`)
                : h('p', null, 'Play on to compare with the previous run.'),
            ]),
          ])
        : null,
      items.length === 0
        ? h('div', { class: 'empty sheet-empty' }, [
            icon('flame'),
            h('p', { class: 'empty-title' }, 'No insights yet'),
            h('p', null, 'Mark where the fire is (Tools, then Fire), then press Play. Cards explaining what the fire is doing will appear here.'),
          ])
        : [
            groupOf(
              items.filter((i) => forecast.has(i)).map((i) => ({ kind: i.kind, lead: i, count: 1, first: i.time, last: i.time })),
              'Coming up',
              true,
            ),
            // Repeats of the same phenomenon (e.g. junction zones all along a big fire's edge) share one card.
            groupOf(groupInsights(items.filter((i) => !forecast.has(i))), 'What the fire did, newest first', false),
          ],
    ]);
    // Forget cards that are no longer listed (after a rewind or a what-if re-run).
    const listed = new Set(items);
    for (const k of cardCache.keys()) if (!listed.has(k)) cardCache.delete(k);
  };
  // Cards are cached by insight, so re-rendering the list when a new card arrives keeps the others' DOM (an expanded
  // reason, focus) instead of rebuilding every card.
  const cardCache = new Map<Insight, { el: HTMLElement; count: number }>();
  const groupOf = (items: InsightGroup[], heading: string, forecast: boolean): HTMLElement | null => {
    if (!items.length) return null;
    return h('div', { class: 'insight-group' }, [
      h('h3', { class: 'section-header group-title' }, heading),
      h(
        'div',
        { class: 'insight-list' },
        items.map((g) => {
          const i = g.lead;
          let c = cardCache.get(i);
          if (!c || c.count !== g.count) {
            c = { el: insightCard(i, { tz: ctx.tz, absTime: ctx.absTime, onShow: onShowInsight, forecast, repeats: g.count > 1 ? { count: g.count, first: g.first } : undefined }), count: g.count };
            cardCache.set(i, c);
          }
          return c.el;
        }),
      ),
    ]);
  };

  // ───────────── Weather ─────────────
  const canvas = h('canvas', { class: 'weather-canvas', attrs: { role: 'img', 'aria-label': 'Weather timeline: wind, temperature, humidity and litter moisture' } });
  const wxSummary = h('div', { class: 'wx-summary' });
  const tableHost = h('div', { class: 'table-wrap' });
  const details = h('details', { class: 'wx-table' }, [h('summary', null, 'Show as a table'), tableHost]);
  const wxSource = h('p', { class: 'hint wx-source' });
  setChildren(panels.weather, [wxSummary, h('div', { class: 'chart-wrap' }, canvas), wxSource, details]);
  const changes = detectWindChanges(ctx.scenario.weather.hours);
  let inspect: number | null = null;
  let mapper: { timeAt(x: number): number } | null = null;
  const renderWeather = (): void => {
    const s = session.state.get();
    const abs = ctx.absTime(s.viewTime);
    const unit = ctx.settings.get().units;
    const w = sampleSeries(ctx.scenario.weather, abs, abs, 2)[0]!;
    const next = changes.find((c) => c.time > abs);
    setChildren(wxSummary, [
      statRow(
        [
          statTile('Temperature', formatTemp(w.temperature)),
          statTile('Humidity', formatRH(w.relativeHumidity)),
          statTile(`Wind (${unit === 'kmh' ? 'km/h' : 'm/s'})`, `${compassName(w.windDir10)} ${formatNumber(unit === 'kmh' ? msToKmh(w.windSpeed10) : w.windSpeed10, unit === 'kmh' ? 0 : 1)}`),
          statTile('Litter moisture', `${litterEstimate(w, ctx.tz).toFixed(1)}%`),
        ],
        4,
      ),
      next
        ? h('p', { class: 'callout callout-danger' }, [
            icon('wind'),
            h('span', null, `Wind change ${formatRelative((next.time - abs) / 1000)} (${formatClock(next.time, ctx.tz)}): ${compassName(next.fromDir)} → ${compassName(next.toDir)} ${Math.round(next.speedAfterKmh)} km/h. The side of the fire (flank) becomes the head fire.`),
          ])
        : null,
    ]);
    text(wxSource, `Source: ${ctx.scenario.weather.source}. Tap or drag the chart to read values; wind speed in ${unit === 'kmh' ? 'km/h' : 'm/s'} at 10 m.`);
    const obs = session.snapshots
      .all()
      .filter((sn) => Number.isFinite(sn.stats.deadFuelMoistureMean))
      .map((sn) => ({ time: sn.time, value: sn.stats.deadFuelMoistureMean }));
    if (!panels.weather.hidden && canvas.isConnected) {
      mapper = drawWeatherChart(canvas, { series: ctx.scenario.weather, start: ctx.scenario.startTime, duration: ctx.scenario.duration, viewTime: s.viewTime, tz: ctx.tz, units: unit, changes, moistureObs: obs, inspect });
    }
    if (details.open) renderTable();
  };
  const renderTable = (): void => {
    const unit = ctx.settings.get().units;
    const hrs = sampleSeries(ctx.scenario.weather, ctx.scenario.startTime, ctx.scenario.startTime + ctx.scenario.duration * 1000, Math.round(ctx.scenario.duration / 3600) + 1);
    setChildren(
      tableHost,
      h('table', { class: 'data-table' }, [
        h('thead', null, h('tr', null, ['Time', 'Temp', 'RH', 'Wind', 'Litter'].map((c) => h('th', { scope: 'col' }, c)))),
        h(
          'tbody',
          null,
          hrs.map((w) =>
            h('tr', null, [
              h('th', { scope: 'row' }, formatClock(w.time, ctx.tz)),
              h('td', { class: 'num' }, formatTemp(w.temperature)),
              h('td', { class: 'num' }, formatRH(w.relativeHumidity)),
              h('td', { class: 'num' }, `${compassName(w.windDir10)} ${formatWind(w.windSpeed10, unit)}`),
              h('td', { class: 'num' }, `${litterEstimate(w, ctx.tz).toFixed(1)}%`),
            ]),
          ),
        ),
      ]),
    );
  };
  details.addEventListener('toggle', () => details.open && renderTable());
  canvas.style.height = `${chartHeight()}px`;
  const onChart = (e: PointerEvent): void => {
    if (!mapper) return;
    if (e.type === 'pointerdown') canvas.setPointerCapture?.(e.pointerId);
    if (e.type === 'pointermove' && e.buttons === 0 && e.pointerType !== 'mouse') return;
    inspect = mapper.timeAt(e.clientX);
    renderWeather();
  };
  canvas.addEventListener('pointerdown', onChart);
  canvas.addEventListener('pointermove', onChart);
  canvas.addEventListener('pointerleave', () => {
    inspect = null;
    renderWeather();
  });

  // ───────────── Stats ─────────────
  const statsHost = h('div', { class: 'stats-live' });
  const renderStats = (): void => {
    const s = session.state.get();
    const st = s.snapshot?.stats;
    const unit = ctx.settings.get().units;
    if (!st) {
      setChildren(statsHost, h('p', { class: 'hint stats-empty' }, 'Statistics appear once the simulation has produced its first results.'));
      return;
    }
    let maxFlame = 0;
    const f = s.snapshot!.fire;
    for (let k = 0; k < f.burnState.length; k++) if (f.burnState[k] === BurnState.Burning && f.flameHeight[k]! > maxFlame) maxFlame = f.flameHeight[k]!;
    const rating = ratingStyle(st.fireDangerRating);
    const regime = plumeRegime(st.convectiveNumber);
    const perf = ctx.view.stats();
    const b = s.compare ? baselineAt(s.compare, st.time) : null;
    const g = ctx.scenario.terrain.grid;
    const perfRows: KvRow[] = [
      { key: 'Wind model', value: has3dAtmosphere(s.snapshot) ? '3-D atmosphere: plume, cold air and slope winds' : 'Fast: a surface wind shaped by the terrain' },
      { key: 'Fire grid', value: `${formatNumber(g.nx)} × ${formatNumber(g.ny)} cells of ${formatNumber(g.cellSize)} m` },
      { key: 'Compute time', value: Number.isFinite(st.msPerSimMinute) ? `${formatNumber(st.msPerSimMinute, 1)} ms per simulated minute` : '–' },
      { key: 'Worker speed', value: s.workerSpeed > 0 ? `${formatNumber(s.workerSpeed)}× real time` : 'idle' },
      { key: '3-D view', value: `${perf.fps} frames/s · ${formatNumber(perf.drawCalls)} draw calls` },
      { key: 'Replay memory', value: `${formatNumber(session.snapshots.totalBytes / 1048576, 0)} MB · ${session.snapshots.size} pictures, every ${formatNumber(session.snapshots.spacing / 60)} min` },
    ];
    setChildren(statsHost, [
      h('div', { class: 'stat-grid' }, [
        statTile('Area burnt', formatArea(st.burntAreaHa), b ? `before: ${formatArea(b.burntAreaHa)}` : `${formatNumber(st.burningCells)} cells burning`),
        statTile('Fire edge (perimeter)', `${formatNumber(st.perimeterKm, 1)} km`, 'length of the burning and burnt edge'),
        statTile('Head fire', st.headRos > 0 ? formatRos(st.headRos) : '–', Number.isFinite(st.headDir) && st.headRos > 0 ? `running ${formatHeading(st.headDir)}` : 'no active head'),
        statTile('Max intensity', formatIntensity(st.maxIntensity), intensityMeaning(st.maxIntensity)),
        statTile('Flame height', maxFlame > 0 ? formatMetres(maxFlame) : '–', 'tallest burning now'),
        statTile('Spot fires', String(st.spotFires), `${formatNumber(st.activeEmbers)} embers in the air${st.embersLeftDomain ? ` · ${st.embersLeftDomain} left the area` : ''}`),
        statTile('Convective number', Number.isFinite(st.convectiveNumber) ? formatNumber(st.convectiveNumber, 1) : '–', regime === 'wind-driven' ? 'wind drives the fire' : regime === 'mixed' ? 'wind and smoke column both matter' : 'the smoke column drives the fire'),
        statTile('FFDI (fire danger index)', formatNumber(st.ffdi), rating.key === 'none' ? 'below moderate' : `${rating.label} (approx.)`),
        statTile('Litter moisture', formatPercent(st.deadFuelMoistureMean, 1), 'mean over the area'),
        statTile('Weather now', `${formatTemp(st.weather.temperature)} · ${formatRH(st.weather.relativeHumidity)}`, `${formatDirFrom(st.weather.windDir10)} ${formatWind(st.weather.windSpeed10, unit)}`),
      ]),
      h('p', { class: 'hint' }, `Wind ${formatWind(st.weather.windSpeed10, unit)} ≈ ${Math.round(msToKmh(st.weather.windSpeed10))} km/h at 10 m in the open. Spot distances: ${st.spotFires ? formatDistance(Math.max(...(s.snapshot?.spotFires ?? []).map((x) => x.distance), 0)) + ' furthest' : 'none yet'}.`),
      sectionHeader('How the model runs'),
      kv(perfRows, { dense: true, label: 'Performance' }),
    ]);
  };
  // Built once and kept out of the part that is redrawn while the run plays: a tap on it is never lost to a redraw.
  const modelRow = ctx.openModelCard ? list([listRow({ title: 'How this simulation works', sub: 'What is 2-D and what is 3-D, grid sizes and time steps', icon: 'cube', chevron: true, onClick: () => ctx.openModelCard?.(), testId: 'stats-model-card' })]) : null;
  setChildren(panels.stats, [statsHost, modelRow, dataCard()]);

  /** The "Data used" card: a compact summary of the scenario's data sets that opens the Data sets screen. */
  function dataCard(): HTMLElement {
    const sc = ctx.scenario;
    const d = dataUsed(sc.datasets, sc.datasetSummary);
    const open = (id?: string): void => ctx.openDatasets?.(id);
    const coarse = /SRTM|Terrarium|Synthetic/i.test(sc.terrain.source);
    const warnings = [
      coarse ? h('p', { class: 'callout callout-warn' }, [icon('warning'), h('span', null, 'Coarse terrain: real gully walls and cliffs are likely steeper than shown, so fire may be faster on them.')]) : null,
      ...ctx.buildWarnings.map((w) => h('p', { class: 'callout callout-warn' }, [icon('warning'), h('span', null, w)])),
    ];
    if (!d) {
      // An older scenario without an inventory: say what the scenario itself records.
      return h('section', { class: 'data-notes', dataset: { testid: 'data-used' } }, [
        sectionHeader('Data used'),
        kv(
          [
            { key: 'Terrain', value: sc.terrain.source },
            { key: 'Fuel', value: sc.fuel.sources.join('; ') || '–' },
            { key: 'Weather', value: sc.weather.source },
            { key: 'Grid', value: `${sc.terrain.grid.nx} × ${sc.terrain.grid.ny} cells of ${sc.terrain.grid.cellSize} m` },
          ],
          { layout: 'stack', dense: true },
        ),
        ...warnings,
        ctx.openDatasets ? h('button', { type: 'button', class: 'btn btn-tonal data-open', dataset: { testid: 'data-open' }, on: { click: () => open() } }, [icon('database'), 'Data sets']) : null,
      ]);
    }
    return h('section', { class: 'data-notes', dataset: { testid: 'data-used' } }, [
      sectionHeader(
        'Data used',
        ctx.openDatasets ? h('button', { type: 'button', class: 'btn btn-text btn-sm data-open', dataset: { testid: 'data-open' }, on: { click: () => open() } }, 'See all') : undefined,
      ),
      statRow(
        [
          statTile('Data sets', String(d.count)),
          statTile('Downloaded', d.download),
          statTile('From the app and device', d.local),
          ...(d.memory ? [statTile('In memory', d.memory)] : []),
        ],
        d.memory ? 4 : 3,
      ),
      h('p', { class: 'hint' }, d.downloadNote),
      d.origins.length
        ? h('div', { class: 'data-origins' }, [
            h('p', { class: 'data-origins-title' }, 'Where the map cells come from'),
            stackedBar(
              d.origins.map((o) => ({ weight: o.share, colour: o.colour, label: `${o.label} ${o.percent}` })),
              { label: d.origins.map((o) => `${o.label} ${o.percent}`).join(', '), large: true },
            ),
            h(
              'div',
              { class: 'chips data-origin-keys' },
              d.origins.map((o) => h('span', { class: 'legend-chip' }, [h('span', { class: ['swatch', o.colour !== 'neutral' && `bar-${o.colour}`] }), `${o.label} ${o.percent}`])),
            ),
          ])
        : null,
      ...d.fallbacks.map((f) =>
        h('div', { class: 'callout callout-warn data-fallback' }, [icon('warning'), h('div', null, [h('p', { class: 'callout-title' }, `${f.title}: a substitute was used`), f.reason ? h('p', null, f.reason) : null])]),
      ),
      d.rows.length
        ? list(
            d.rows.map((r) =>
              listRow({
                title: r.title,
                sub: r.origin,
                trailing: r.size,
                chevron: !!ctx.openDatasets,
                truncate: true,
                testId: `data-row-${r.id}`,
                onClick: ctx.openDatasets ? () => open(r.id) : undefined,
              }),
            ),
            { noLead: true, label: 'Largest data sets' },
          )
        : null,
      ...warnings,
    ]);
  }

  // ───────────── Help ─────────────
  setChildren(panels.help, [
    h('div', { class: 'callout callout-warn' }, [icon('warning'), h('span', null, 'Training aid only, not an operational prediction. Follow your IC (incident controller), your Crew Leader and NSW RFS procedures. LACES first (Lookouts, Awareness, Communications, Escape routes, Safety zones).')]),
    sectionHeader('How to use'),
    h('ol', { class: 'howto' }, [
      h('li', null, [h('strong', null, 'Tools: '), 'the Tools button at the bottom of the map opens Why here?, Fire, Fuel, Wind, Layers and What if. Tap the map for “Why here?” without choosing anything.']),
      h('li', null, [h('strong', null, 'Fire: '), 'tap the map (or use the crosshair) to mark where the fire is; draw a line for a fire edge.']),
      h('li', null, [h('strong', null, 'Play: '), 'press the blue Play button and pick a speed on the chip beside it; drag or tap the timeline to jump to any time.']),
      h('li', null, [h('strong', null, 'Map buttons: '), 'the round buttons on the side open the layers, change the camera (top, 3-D, eye level, zoom) and turn the map north up.']),
      h('li', null, [h('strong', null, 'Insights: '), 'new cards never pop up; a number on the Insights tab tells you how many are waiting.']),
      h('li', null, [h('strong', null, 'Fuel / Wind: '), 'tell the model what you see: more litter, a road, the wind here.']),
      h('li', null, [h('strong', null, 'Layers: '), 'choose the map type, switch roads, fire trails, homes, residential areas, names and trees on or off one by one, or colour the ground by one measurement (a heat map). Tap (i) on a row to learn what it shows and where the data come from. Your choices are remembered.']),
      h('li', null, [h('strong', null, 'What if: '), 'switch physics on or off and compare.']),
      h('li', null, [h('strong', null, 'Where am I: '), '“Why here?” also names the nearest road and fire trail, how many homes are close and what the ground is like.']),
      h('li', null, [h('strong', null, 'Data: '), 'the line at the bottom of the map credits the data you see; tap it (or open the menu) for the size, source and date of every data set.']),
      h('li', null, [h('strong', null, 'How it works: '), 'the menu also has “How this simulation works”: what is 2-D and what is 3-D, how fine the grids are and how often they are updated.']),
      h('li', null, [h('strong', null, 'Back: '), 'the Back button closes the open menu, panel or screen first; the simulation keeps running while you read.']),
    ]),
    sectionHeader('Glossary'),
    h(
      'div',
      { class: 'glossary' },
      GLOSSARY.map((g) => h('details', { class: 'gloss' }, [h('summary', null, h('span', { class: 'gloss-text' }, [h('span', { class: 'gloss-term' }, g.term), g.short ? h('span', { class: 'gloss-short' }, g.short) : null])), h('p', null, g.body)])),
    ),
  ]);

  const renderActive = (): void => {
    const { tab, sheet: detent } = ui.get();
    if (el.hidden || detent === 'closed') return; // nothing to draw while the dock is collapsed
    if (tab === 'insights') renderInsights();
    else if (tab === 'weather') renderWeather();
    else if (tab === 'stats') renderStats();
  };
  // Throttle heavy redraws to ~4 Hz while playing.
  let pending = 0;
  const schedule = (): void => {
    if (pending) return;
    pending = window.setTimeout(() => {
      pending = 0;
      renderBadge();
      renderActive();
    }, 250);
  };
  unsubs.push(session.state.subscribe(schedule, ['viewTime', 'snapshot', 'insights', 'forecastInsights', 'compare', 'workerSpeed', 'error']));
  unsubs.push(ui.subscribe(renderTabs, ['tab', 'sheet', 'panelOpen']));
  unsubs.push(ctx.settings.subscribe(renderActive, ['units', 'theme', 'highContrast']));
  // Re-fit the detent heights when the chrome above or below the dock changes size (top bar, timeline, error chip, rotation).
  let chromeRo: ResizeObserver | null = null;
  requestAnimationFrame(() => {
    const parent = el.parentElement;
    if (parent && typeof ResizeObserver === 'function') {
      chromeRo = new ResizeObserver(() => applyDetent());
      for (const t of [parent, ...parent.querySelectorAll('.sim-topbar, .scrubber, .error-chip')]) chromeRo.observe(t);
    }
    renderTabs();
  });
  renderInsights();

  return {
    el,
    targetHeight,
    destroy() {
      for (const u of unsubs) u();
      stopTracking?.();
      chromeRo?.disconnect();
      clearTimeout(pending);
    },
  };
}

/** A number with its caption (the .stat primitive) and an optional plain-English note under it. */
function statTile(label: string, value: string, note?: string): HTMLElement {
  return h('div', { class: 'stat sim-stat' }, [h('span', { class: 'stat-num' }, value), h('span', { class: 'stat-cap' }, label), note ? h('span', { class: 'stat-note' }, note) : null]);
}

function pct(a: number, b: number): string {
  if (b <= 0) return 'new';
  const d = ((a - b) / b) * 100;
  return `${d >= 0 ? '+' : '−'}${Math.abs(Math.round(d))}%`;
}

function intensityMeaning(i: number): string {
  if (i < 500) return 'hand tools can hold it';
  if (i < 2000) return 'tankers and machinery';
  if (i < 4000) return 'limit of direct attack';
  if (i < 10000) return 'indirect attack only';
  return 'crown fire likely';
}
