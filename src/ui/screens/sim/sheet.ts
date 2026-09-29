/**
 * The bottom dock: a slim (44 px) row of four tab buttons — Insights (with an unseen-cards badge), Weather, Stats, Help —
 * directly above the timeline. Collapsed by default; a tab opens the panel above the row at "peek", which can be dragged
 * to half / full height or closed again (tap the same tab, the grip, or the map). Nothing here ever pops up on its own:
 * new cards only change the badge. Taps work everywhere a drag does, so nothing depends on a gesture.
 */
import type { Insight } from '../../../core/types';
import { msToKmh } from '../../../core/units';
import { h, listen, prefersReducedMotion, setChildren, text } from '../../dom';
import { icon } from '../../icons';
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
import type { SheetTab, SimContext } from './context';
import { insightCard } from './insightCard';
import { has3dAtmosphere } from './context';
import { groupInsights, UnseenTracker, type InsightGroup } from '../../insightGroups';
import { badgeText, detentHeights, DOCK_H, pressTab, snapDetent, tapHandle } from './layoutModel';
import { chartHeight, drawWeatherChart, litterEstimate } from './weatherChart';

const TABS: { id: SheetTab; label: string; icon: 'list' | 'chart' | 'stats' | 'help' }[] = [
  { id: 'insights', label: 'Insights', icon: 'list' },
  { id: 'weather', label: 'Weather', icon: 'chart' },
  { id: 'stats', label: 'Stats', icon: 'stats' },
  { id: 'help', label: 'Help', icon: 'help' },
];

export function createSheet(ctx: SimContext, onShowInsight: (i: Insight) => void): { el: HTMLElement; destroy(): void; targetHeight(): number } {
  const { session, ui } = ctx;
  const unsubs: (() => void)[] = [];

  // ── tab row (the collapsed dock) ──
  const badge = h('span', { class: 'tab-badge', hidden: true, dataset: { testid: 'insights-badge' } });
  const tabBtns = TABS.map((t) =>
    h(
      'button',
      {
        type: 'button',
        class: ['sheet-tab', t.id === 'insights' && 'has-badge'],
        id: `tab-${t.id}`,
        attrs: { role: 'tab', 'aria-controls': `panel-${t.id}` },
        dataset: { testid: `tab-${t.id}` },
        on: { click: () => ui.set(pressTab({ sheet: ui.get().sheet, tab: ui.get().tab }, t.id)) },
      },
      [h('span', { class: 'tab-icon' }, icon(t.icon, { size: 20 })), h('span', { class: 'tab-label' }, t.label), t.id === 'insights' ? badge : null],
    ),
  );
  // The row is the handle: tapping its gaps opens / closes, dragging it resizes the panel.
  const handle = h(
    'div',
    {
      class: 'sheet-handle',
      dataset: { testid: 'sheet-handle' },
      attrs: { role: 'tablist', 'aria-label': 'Panels' },
      on: { click: (e) => e.target === handle && ui.set({ sheet: tapHandle(ui.get().sheet) }) },
    },
    tabBtns,
  );

  // ── panel (above the row) ──
  const grip = h('button', { type: 'button', class: 'sheet-grip-btn', dataset: { testid: 'sheet-grip' }, aria: { label: 'Close panel' }, on: { click: () => ui.set({ sheet: 'closed' }) } }, h('span', { class: 'sheet-grip' }));
  const head = h('div', { class: 'sheet-head' }, grip);
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
    const scrubTop = parent.querySelector('.scrubber')?.getBoundingClientRect().top ?? pr.bottom - 84;
    return Math.max(DOCK_H, scrubTop - top);
  };
  const heights = () => detentHeights(room());
  const targetHeight = (): number => heights()[ui.get().sheet];
  const applyDetent = (): void => {
    const d = ui.get().sheet;
    el.style.height = `${heights()[d]}px`;
    el.dataset.detent = d;
    grip.setAttribute('aria-label', 'Close panel');
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
  const renderTabs = (): void => {
    const s = ui.get();
    const open = s.sheet !== 'closed';
    for (const b of tabBtns) {
      const on = open && b.id === `tab-${s.tab}`;
      b.setAttribute('aria-selected', String(on));
      b.setAttribute('aria-expanded', String(on));
      b.tabIndex = b.id === `tab-${s.tab}` ? 0 : -1;
    }
    for (const [id, p] of Object.entries(panels)) p.hidden = id !== s.tab;
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
  // New cards never interrupt: they only raise this number (red, with one short pulse, when one is a Danger card).
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
    text(badge, badgeText(n));
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
    const list = session.visibleInsights(s);
    const key = `${list.map((i) => i.id).join('|')}|${s.compare ? Math.round(s.viewTime / 300) : ''}|${s.error ?? ''}`;
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
              h('strong', null, 'The simulation stopped with a problem'),
              h('p', null, s.error),
              h('p', { class: 'hint' }, 'The view keeps what was already computed. Go back with the menu (top left) and start a new scenario, or try Play again.'),
            ]),
          ])
        : null,
      compare
        ? h('div', { class: 'callout callout-info compare' }, [
            icon('whatif'),
            h('div', null, [
              h('strong', null, `What-if from ${formatClock(ctx.absTime(compare.since), ctx.tz)}: ${compare.label}`),
              b && cur
                ? h('p', null, `At ${formatClock(ctx.absTime(s.viewTime), ctx.tz)}: ${formatArea(cur.burntAreaHa)} burnt vs ${formatArea(b.burntAreaHa)} before (${pct(cur.burntAreaHa, b.burntAreaHa)}).`)
                : h('p', null, 'Play on to compare with the previous run.'),
            ]),
          ])
        : null,
      list.length === 0
        ? h('div', { class: 'empty' }, [
            icon('flame', { size: 36 }),
            h('p', { class: 'empty-title' }, 'No insights yet'),
            h('p', null, 'Mark where the fire is with the Fire tool, then press Play. Cards explaining what the fire is doing will appear here.'),
          ])
        : [
            groupOf(
              list.filter((i) => forecast.has(i)).map((i) => ({ kind: i.kind, lead: i, count: 1, first: i.time, last: i.time })),
              'Coming up',
              true,
            ),
            // Repeats of the same phenomenon (e.g. junction zones all along a big fire's edge) share one card.
            groupOf(groupInsights(list.filter((i) => !forecast.has(i))), 'What the fire did — newest first', false),
          ],
    ]);
    // Forget cards that are no longer listed (after a rewind or a what-if re-run).
    const listed = new Set(list);
    for (const k of cardCache.keys()) if (!listed.has(k)) cardCache.delete(k);
  };
  // Cards are cached by insight, so re-rendering the list when a new card arrives keeps the others' DOM (an open
  // "Learn more", focus) instead of rebuilding every card.
  const cardCache = new Map<Insight, { el: HTMLElement; count: number }>();
  const groupOf = (items: InsightGroup[], title: string, forecast: boolean): HTMLElement | null => {
    if (!items.length) return null;
    return h('div', { class: 'insight-group' }, [
      h('h3', { class: 'group-title' }, title),
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
  const wxSource = h('p', { class: 'hint' }, `Source: ${ctx.scenario.weather.source}. Tap or drag the chart to read values; wind speed in ${ctx.settings.get().units === 'kmh' ? 'km/h' : 'm/s'} at 10 m.`);
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
      h('div', { class: 'wx-now' }, [
        stat('Temp', formatTemp(w.temperature)),
        stat('RH', formatRH(w.relativeHumidity)),
        stat('Wind', `${compassName(w.windDir10)} ${Math.round(unit === 'kmh' ? msToKmh(w.windSpeed10) : w.windSpeed10)}`),
        stat('Litter', `${litterEstimate(w, ctx.tz).toFixed(1)}%`),
      ]),
      next
        ? h('p', { class: 'callout callout-danger' }, [
            icon('wind'),
            h('span', null, `Wind change ${formatRelative((next.time - abs) / 1000)} (${formatClock(next.time, ctx.tz)}): ${compassName(next.fromDir)} → ${compassName(next.toDir)} ${Math.round(next.speedAfterKmh)} km/h. The flank becomes the head fire.`),
          ])
        : null,
    ]);
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
              h('td', null, formatTemp(w.temperature)),
              h('td', null, formatRH(w.relativeHumidity)),
              h('td', null, `${compassName(w.windDir10)} ${formatWind(w.windSpeed10, unit)}`),
              h('td', null, `${litterEstimate(w, ctx.tz).toFixed(1)}%`),
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
  const renderStats = (): void => {
    const s = session.state.get();
    const st = s.snapshot?.stats;
    const unit = ctx.settings.get().units;
    if (!st) {
      setChildren(panels.stats, h('p', { class: 'empty' }, 'Statistics appear once the simulation has produced its first results.'));
      return;
    }
    let maxFlame = 0;
    const f = s.snapshot!.fire;
    for (let k = 0; k < f.burnState.length; k++) if (f.burnState[k] === BurnState.Burning && f.flameHeight[k]! > maxFlame) maxFlame = f.flameHeight[k]!;
    const rating = ratingStyle(st.fireDangerRating);
    const regime = plumeRegime(st.convectiveNumber);
    const perf = ctx.view.stats();
    const b = s.compare ? baselineAt(s.compare, st.time) : null;
    setChildren(panels.stats, [
      h('div', { class: 'stat-grid' }, [
        tile('Area burnt', formatArea(st.burntAreaHa), b ? `before: ${formatArea(b.burntAreaHa)}` : `${formatNumber(st.burningCells)} cells burning`),
        tile('Fire edge', `${formatNumber(st.perimeterKm, 1)} km`, 'perimeter'),
        tile('Head fire', st.headRos > 0 ? formatRos(st.headRos) : '–', Number.isFinite(st.headDir) && st.headRos > 0 ? formatHeading(st.headDir) : 'no active head'),
        tile('Max intensity', formatIntensity(st.maxIntensity), intensityMeaning(st.maxIntensity)),
        tile('Flame height', maxFlame > 0 ? formatMetres(maxFlame) : '–', 'tallest burning now'),
        tile('Spot fires', String(st.spotFires), `${formatNumber(st.activeEmbers)} embers in the air${st.embersLeftDomain ? ` · ${st.embersLeftDomain} left the area` : ''}`),
        tile('Convective number', Number.isFinite(st.convectiveNumber) ? formatNumber(st.convectiveNumber, 1) : '–', regime === 'wind-driven' ? 'wind-driven fire' : regime === 'mixed' ? 'wind and plume both matter' : 'plume-dominated'),
        tile('FFDI', formatNumber(st.ffdi), rating.key === 'none' ? 'below moderate' : `${rating.label} (approx.)`),
        tile('Litter moisture', formatPercent(st.deadFuelMoistureMean, 1), 'mean over the area'),
        tile('Weather now', `${formatTemp(st.weather.temperature)} · ${formatRH(st.weather.relativeHumidity)}`, `${formatDirFrom(st.weather.windDir10)} ${formatWind(st.weather.windSpeed10, unit)}`),
      ]),
      h('h3', { class: 'sub-title' }, 'Performance'),
      h('div', { class: 'stat-grid' }, [
        tile('Wind model', has3dAtmosphere(s.snapshot) ? '3-D atmosphere' : 'Fast (surface)', has3dAtmosphere(s.snapshot) ? 'plume, cold air and slope winds in 3-D' : 'terrain-adjusted surface wind; chosen for speed'),
        tile('Simulation', Number.isFinite(st.msPerSimMinute) ? `${formatNumber(st.msPerSimMinute, 1)} ms` : '–', 'per simulated minute'),
        tile('Worker speed', s.workerSpeed > 0 ? `${formatNumber(s.workerSpeed)}×` : 'idle', 'simulated / real time'),
        tile('3-D view', `${perf.fps} fps`, `${formatNumber(perf.drawCalls)} draw calls · ${formatNumber(perf.triangles)} triangles`),
        tile('Replay memory', `${formatNumber(session.snapshots.totalBytes / 1048576, 0)} MB`, `${session.snapshots.size} snapshots, every ${Math.round(session.snapshots.spacing / 60)} min`),
      ]),
      h('p', { class: 'hint' }, `Wind ${formatWind(st.weather.windSpeed10, unit)} ≈ ${Math.round(msToKmh(st.weather.windSpeed10))} km/h at 10 m in the open. Spot distances: ${st.spotFires ? formatDistance(Math.max(...(s.snapshot?.spotFires ?? []).map((x) => x.distance), 0)) + ' furthest' : 'none yet'}.`),
      dataNotes,
    ]);
  };
  // Where the model's data came from, plus any build warnings (doc 09 §6.4: say what is estimated or stale).
  const sc = ctx.scenario;
  const coarse = /SRTM|Terrarium|Synthetic/i.test(sc.terrain.source);
  const dataNotes = h('div', { class: 'data-notes' }, [
    h('h3', { class: 'sub-title' }, 'Data used'),
    h('ul', { class: 'plain-list data-list' }, [
      h('li', null, [h('strong', null, 'Terrain: '), sc.terrain.source]),
      h('li', null, [h('strong', null, 'Fuel: '), sc.fuel.sources.join('; ') || '–']),
      h('li', null, [h('strong', null, 'Weather: '), sc.weather.source]),
      h('li', null, [h('strong', null, 'Grid: '), `${sc.terrain.grid.nx} × ${sc.terrain.grid.ny} cells of ${sc.terrain.grid.cellSize} m`]),
    ]),
    coarse ? h('p', { class: 'callout callout-warn' }, [icon('warning'), h('span', null, 'Coarse terrain: real gully walls and cliffs are likely steeper than shown, so fire may be faster on them.')]) : null,
    ...ctx.buildWarnings.map((w) => h('p', { class: 'callout callout-warn' }, [icon('warning'), h('span', null, w)])),
  ]);

  // ───────────── Help ─────────────
  setChildren(panels.help, [
    h('div', { class: 'callout callout-warn' }, [icon('warning'), h('span', null, 'Training aid only — not an operational prediction. Follow your IC, your Crew Leader and NSW RFS procedures. LACES first.')]),
    h('h3', { class: 'sub-title' }, 'How to use'),
    h('ol', { class: 'howto' }, [
      h('li', null, [h('strong', null, 'Tools: '), 'the round button by the screen edge opens Why here?, Fire, Fuel, Wind, Layers and What if. Tap the map for “Why here?” without choosing anything.']),
      h('li', null, [h('strong', null, 'Fire: '), 'tap the map (or use the crosshair) to mark where the fire is; draw a line for a fire edge.']),
      h('li', null, [h('strong', null, 'Play: '), 'press Play and pick a speed; drag or tap the timeline to jump to any time.']),
      h('li', null, [h('strong', null, 'View: '), 'the round button on the other side turns, zooms and flies the camera.']),
      h('li', null, [h('strong', null, 'Insights: '), 'new cards never pop up; a number on the Insights tab tells you how many are waiting.']),
      h('li', null, [h('strong', null, 'Fuel / Wind: '), 'tell the model what you see — more litter, a road, the wind here.']),
      h('li', null, [h('strong', null, 'Layers / What if: '), 'colour the map by arrival time, slope, moisture…; switch physics on/off and compare.']),
    ]),
    h('h3', { class: 'sub-title' }, 'Glossary'),
    h(
      'div',
      { class: 'glossary' },
      GLOSSARY.map((g) => h('details', { class: 'gloss' }, [h('summary', null, [h('strong', null, g.term), g.short ? h('span', { class: 'gloss-short' }, ` — ${g.short}`) : null]), h('p', null, g.body)])),
    ),
  ]);

  const renderActive = (): void => {
    const { tab, sheet } = ui.get();
    if (el.hidden || sheet === 'closed') return; // nothing to draw while the dock is collapsed
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
  unsubs.push(ctx.settings.subscribe(renderActive, ['units', 'theme']));
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

function stat(label: string, value: string): HTMLElement {
  return h('div', { class: 'wx-stat' }, [h('span', { class: 'wx-stat-label' }, label), h('span', { class: 'wx-stat-value' }, value)]);
}

function tile(label: string, value: string, sub: string): HTMLElement {
  return h('div', { class: 'stat-tile' }, [h('span', { class: 'stat-label' }, label), h('span', { class: 'stat-value' }, value), h('span', { class: 'stat-sub' }, sub)]);
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
