/**
 * "Simulation debug statistics": a full-screen dialog in the same flat Maps look as "How this simulation works" (it reuses
 * that screen's cards and collapsible groups, modelcard.css): a top app bar with Back and a Copy icon, a card with the
 * one-line summary, the state (live, paused, finished, no run yet) and a labelled Copy button, and then the groups of the
 * catalogue (each collapsed, with its own one-line summary). The content is src/ui/debugStats.ts (pure, tested); this file
 * only reads the live sources, draws it and patches it once a second IN PLACE (text nodes, no rebuild unless a group's rows
 * changed), so a selection and the scroll position survive. It skips while the app is hidden, never pauses or changes
 * playback, and never opens by itself.
 *
 * Copy puts the whole page on the clipboard as plain text and says so on a line of text (no pop-up). When the phone refuses
 * the clipboard the text appears in a box to touch and hold. Nothing leaves the phone. Escape and Android Back close it (the
 * App forwards Back as Escape); Tab stays inside.
 */
import type { ScenarioData } from '../../core/types';
import { DEMO_SITES } from '../../data/demoSites';
import type { SceneViewApi } from '../../render/api';
import { liveMemory } from '../../scenario/memoryModel';
import { bootErrors } from '../bootDiagnostics';
import { APP_VERSION, BUILD_MODE, buildId } from '../buildInfo';
import { buildDebugStats, debugStatsToText, TITLE, type DebugStats, type DebugStatsInput, type StatGroup, type StatRow } from '../debugStats';
import { deviceInfoNow, deviceLater, deviceVolatile, type DeviceLater } from '../deviceInfo';
import { h, setChildren, svg, text, uniqueId } from '../dom';
import { eventLog, longTasks } from '../eventLog';
import { formatClock } from '../format';
import { icon } from '../icons';
import type { Services } from '../modules';
import { iconButton } from '../primitives';
import { defaultSnapshotBudget, type SimSession } from '../session';
import type { PictureQualityAsk } from '../settings';
import { appBar, button, copyText } from '../widgets';

export interface DebugStatsOptions {
  /** The running scenario; null before any run (opened from Setup: the run groups say "No run yet", the phone groups are live). */
  scenario: ScenarioData | null;
  services: Services;
  session: SimSession | null;
  view: SceneViewApi | null;
  /** What asked for the picture quality when the running view was built (SimScreen.pictureQualityAsk); null with no run. */
  qualityAsk: PictureQualityAsk;
  onClose(): void;
}

/** Values are patched at most this often (ms) while the page is open. */
const REFRESH_MS = 1000;
/** The battery level and the storage in use are read again every this many refreshes. */
const VOLATILE_EVERY = 15;
const SITE_NAMES: Readonly<Record<string, string>> = Object.fromEntries(DEMO_SITES.map((s) => [s.id, s.name]));

/** The Air slice recorder's report with the scenario's clock, or null where the view has no recorder (the 2-D map) or there is no run. */
function sliceRecordingFacts(o: DebugStatsOptions): DebugStatsInput['sliceRecording'] {
  const rec = o.view?.sliceRecording;
  const sc = o.scenario;
  if (!rec || !sc) return null;
  const tz = sc.weather.timezone || 'Australia/Sydney';
  return { status: rec.status(), clock: (t) => formatClock(sc.startTime + t * 1000, tz) };
}

/** What the app knows right now, gathered for the pure content. */
function collect(o: DebugStatsOptions, later: DeviceLater | null): DebugStatsInput {
  const st = o.session?.state.get() ?? null;
  const snaps = o.session?.snapshots ?? null;
  const sc = o.scenario;
  const mem = (globalThis.navigator as { deviceMemory?: number } | undefined)?.deviceMemory;
  const heap = liveMemory();
  const custom = !!sc && !Object.keys(SITE_NAMES).some((k) => sc.id.startsWith(`${k}-`));
  return {
    engine: st?.snapshot?.engine ?? null,
    engineSource: o.services.sources.sim,
    run: sc ? { id: sc.id, extentM: sc.extent, fireCellM: sc.terrain.grid.cellSize, durationS: sc.duration, startTimeMs: sc.startTime, seed: sc.options.seed } : null,
    playback: st ? { playing: st.playing, viewTime: st.viewTime, headTime: st.headTime, speed: st.speed, seeking: st.seekTarget !== null, reviewing: st.reviewing, pace: st.pace, workerSpeed: st.workerSpeed } : null,
    frames: o.view?.frameStats?.() ?? null,
    longTasks: { supported: longTasks.supported, ...longTasks.recent(performance.now()) },
    quality: o.view?.qualityInfo ?? null,
    qualityAsk: o.qualityAsk,
    terrain: o.view ? (o.view.terrainStats ? o.view.terrainStats() : undefined) : undefined,
    windGlyphs: o.view?.windGlyphStats?.() ?? null,
    store: snaps
      ? {
          bytes: snaps.totalBytes,
          maxBytes: snaps.maxBytes,
          keyframes: snaps.keyframeCount,
          keyframeBytes: snaps.keyframeBytes,
          newestBytes: snaps.newestBytes,
          frames: snaps.size,
          spacingS: snaps.spacing,
          displayStepS: snaps.displayStep,
          range: snaps.range(),
        }
      : null,
    sliceRecording: sliceRecordingFacts(o),
    historyBudget: { bytes: snaps?.maxBytes ?? defaultSnapshotBudget(), memoryGb: typeof mem === 'number' ? mem : null },
    heap: heap.available && heap.usedJSHeapBytes !== undefined ? { usedBytes: heap.usedJSHeapBytes, totalBytes: heap.totalJSHeapBytes ?? null, limitBytes: heap.limitBytes ?? null } : null,
    device: deviceInfoNow(),
    deviceLater: later,
    events: eventLog.list(),
    errors: bootErrors(),
    // A custom place's name may sit in an error or an event text: it is hidden wherever it appears.
    hide: custom && sc ? [sc.name] : [],
    build: { version: APP_VERSION, id: buildId(), mode: BUILD_MODE },
    clock: { nowMs: Date.now(), bootMs: performance.now(), runStartMs: eventLog.runStartMs, tzOffsetMin: -new Date().getTimezoneOffset() },
    siteNames: SITE_NAMES,
  };
}

const CHART_BARS = 20;

/** The tiny bar chart of a series (bars from zero, so a slow-down looks like one). Built once; `drawChart` moves the bars. */
function chart(): SVGSVGElement {
  return svg(
    'svg',
    { class: 'ds-chart', viewBox: `0 0 ${CHART_BARS * 10} 32`, preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Chart of the computing speed samples, oldest first' },
    Array.from({ length: CHART_BARS }, (_, i) => svg('rect', { x: i * 10, width: 8, y: 32, height: 0 })),
  );
}

function drawChart(el: SVGSVGElement, values: readonly (number | null)[]): void {
  const top = Math.max(1e-9, ...values.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)));
  const bars = el.children;
  for (let i = 0; i < CHART_BARS; i++) {
    const v = values[i];
    const hgt = typeof v === 'number' && Number.isFinite(v) ? Math.max(1, (v / top) * 30) : 0;
    bars[i]!.setAttribute('y', String(32 - hgt));
    bars[i]!.setAttribute('height', String(hgt));
  }
}

interface Cells {
  label: HTMLElement;
  value: HTMLElement;
  note: HTMLElement;
  chart?: SVGSVGElement;
}

interface Rendered {
  section: HTMLElement;
  body: HTMLElement;
  toggle: HTMLButtonElement;
  summary: HTMLElement;
  cells: Map<string, Cells>;
  shape: string;
}

const shapeOf = (g: StatGroup): string => g.rows.map((r) => (r.spark ? `${r.id}~` : r.id)).join('|');

export function createDebugStatsScreen(opts: DebugStatsOptions): { el: HTMLElement; destroy(): void } {
  const titleId = uniqueId('ds-title');
  const el = h('section', { class: 'screen debugstats-screen', attrs: { role: 'dialog', 'aria-labelledby': titleId }, aria: { modal: 'true' }, dataset: { testid: 'debug-stats' } });
  let later: DeviceLater | null = null;
  let stats: DebugStats = buildDebugStats(collect(opts, later));
  let destroyed = false;

  // ───────────── header: state, one line, Copy ─────────────
  const status = h('p', { class: 'mc-status t-secondary', attrs: { role: 'status', 'aria-live': 'polite' }, dataset: { testid: 'debug-stats-status' } });
  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  const say = (msg: string): void => {
    status.textContent = msg;
    status.classList.toggle('is-shown', !!msg);
    clearTimeout(statusTimer);
    if (msg) statusTimer = setTimeout(() => say(''), 8000);
  };
  const box = h('textarea', { class: 'ds-box', readOnly: true, rows: 8, hidden: true, aria: { label: 'The statistics as text' }, dataset: { testid: 'debug-stats-fallback' } });
  // The battery and the storage are read again (the page-long reading is from the first open); until the slow facts have come in
  // there is nothing to refresh, and `later` is still null.
  const rereadVolatile = async (): Promise<void> => {
    if (!later) return;
    const v = await deviceVolatile();
    if (!destroyed && later) later = { ...later, ...v };
  };
  const copy = async (): Promise<void> => {
    // A copy made in the first second would carry "Reading..." in place of the phone's facts: it waits for them (they come in
    // within about two seconds at the most) and takes the battery and the storage as they are now.
    later ??= await deviceLater();
    await rereadVolatile();
    const body = debugStatsToText(buildDebugStats(collect(opts, later)));
    if (await copyText(body)) {
      box.hidden = true;
      say('Copied: these statistics as text, ready to paste.');
      return;
    }
    box.value = body;
    box.hidden = false;
    box.focus();
    box.select();
    say('This phone did not allow copying. Touch and hold to select, then Copy.');
  };

  const bar = appBar({
    title: TITLE,
    titleId,
    onBack: () => opts.onClose(),
    backLabel: 'Close',
    backTestId: 'debug-stats-close',
    trailing: iconButton({ icon: 'copy', label: 'Copy as text', onClick: () => void copy(), testId: 'debug-stats-copy-icon' }),
  });
  const state = h('p', { class: 'ds-state', dataset: { testid: 'debug-stats-state' } });
  const headline = h('p', { class: 'mc-headline', dataset: { testid: 'debug-stats-headline' } });
  const subtitle = h('p', { class: 'mc-subtitle t-secondary', dataset: { testid: 'debug-stats-header' } });
  const intro = h('section', { class: 'card mc-intro', aria: { label: 'Summary' } }, [
    state,
    headline,
    subtitle,
    h('div', { class: 'mc-actions cluster' }, [button({ label: 'Copy as text', icon: 'copy', size: 'sm', class: 'ds-copy', testId: 'debug-stats-copy', onClick: () => void copy() })]),
    h('p', { class: 'hint' }, 'Copies this page as text. Nothing is sent anywhere. The numbers are measured on this phone and update every second while this page is open.'),
    status,
    box,
  ]);
  const main = h('main', { class: 'screen-main mc-main', dataset: { testid: 'debug-stats-main' } }, intro);
  el.append(bar, main);

  // ───────────── groups ─────────────
  const rendered = new Map<string, Rendered>();
  // All collapsed at first: the one-line summary above and each group's own line say enough to choose; no group repeats it.
  const open = new Set<string>();

  const renderRow = (r: StatRow, cells: Map<string, Cells>): HTMLElement => {
    const label = h('dt', { class: 'kv-key' }, r.label);
    const value = h('span', { class: 'mc-fact-value ds-val' }, r.value);
    const note = h('span', { class: 'mc-fact-note t-secondary ds-val', hidden: !r.note }, r.note ?? '');
    const c: Cells = { label, value, note };
    if (r.spark) {
      c.chart = chart();
      drawChart(c.chart, r.spark);
    }
    cells.set(r.id, c);
    return h('div', { class: 'kv-row', dataset: { row: r.id } }, [label, h('dd', { class: 'kv-val' }, h('span', { class: 'mc-fact' }, [c.chart ?? null, c.chart ? null : value, note]))]);
  };

  const renderBody = (g: StatGroup, r: Pick<Rendered, 'body' | 'cells'>): void => {
    r.cells.clear();
    setChildren(r.body, h('div', { class: 'mc-facts' }, h('dl', { class: 'kv kv-stack kv-dense', aria: { label: g.title } }, g.rows.map((row) => renderRow(row, r.cells)))));
  };

  const setOpen = (r: Rendered, on: boolean, id: string): void => {
    if (on) open.add(id);
    else open.delete(id);
    r.toggle.setAttribute('aria-expanded', String(on));
    r.body.hidden = !on;
    r.section.classList.toggle('is-open', on);
  };

  const renderGroup = (g: StatGroup): Rendered => {
    const bodyId = uniqueId(`ds-${g.id}`);
    const body = h('div', { class: 'mc-body', id: bodyId, dataset: { testid: `debug-group-${g.id}-body` } });
    const summary = h('span', { class: 'mc-summary t-secondary' }, g.summary);
    const toggle = h('button', { type: 'button', class: 'mc-toggle', aria: { expanded: 'false', controls: bodyId }, dataset: { testid: `debug-group-${g.id}` } }, [
      h('span', { class: 'mc-toggle-text' }, [h('span', { class: 'mc-toggle-title' }, g.title), summary]),
      icon('chevron-down', { class: 'mc-chevron' }),
    ]);
    const section = h('section', { class: ['card', 'mc-section'], dataset: { group: g.id } }, [h('h2', { class: 'mc-heading' }, toggle), body]);
    const r: Rendered = { section, body, toggle, summary, cells: new Map(), shape: shapeOf(g) };
    renderBody(g, r);
    toggle.addEventListener('click', () => setOpen(r, toggle.getAttribute('aria-expanded') !== 'true', g.id));
    setOpen(r, open.has(g.id), g.id);
    return r;
  };

  const paintHeader = (): void => {
    const hd = stats.header;
    text(state, hd.status);
    state.classList.toggle('is-live', hd.status === 'Live');
    text(headline, stats.groups[0]!.rows[0]!.value);
    text(subtitle, `${hd.app} · ${hd.run}${hd.seed ? ` · ${hd.seed}` : ''}`);
  };

  const patchGroup = (g: StatGroup, r: Rendered): void => {
    text(r.summary, g.summary);
    const shape = shapeOf(g);
    if (shape !== r.shape) {
      const hadFocus = r.body.contains(document.activeElement);
      r.shape = shape;
      renderBody(g, r);
      if (hadFocus) r.toggle.focus({ preventScroll: true });
      return;
    }
    for (const row of g.rows) {
      const c = r.cells.get(row.id);
      if (!c) continue;
      text(c.label, row.label);
      text(c.value, row.value);
      text(c.note, row.note ?? '');
      c.note.hidden = !row.note;
      if (c.chart && row.spark) drawChart(c.chart, row.spark);
    }
  };

  const paintAll = (): void => {
    paintHeader();
    for (const r of rendered.values()) r.section.remove();
    rendered.clear();
    for (const g of stats.groups) {
      const r = renderGroup(g);
      rendered.set(g.id, r);
      main.append(r.section);
    }
  };

  const refresh = (): void => {
    stats = buildDebugStats(collect(opts, later));
    paintHeader();
    for (const g of stats.groups) {
      const r = rendered.get(g.id);
      if (r) patchGroup(g, r);
    }
  };

  paintAll();
  // The slow phone facts (Client Hints, battery, graphics probe, refresh rate) arrive a moment after the page opens.
  void deviceLater().then(async (l) => {
    later = l;
    await rereadVolatile(); // the page-long reading may be from an earlier open: the battery and the storage now
    if (!destroyed) refresh();
  });
  let ticks = 0;
  const timer = setInterval(() => {
    if (typeof document !== 'undefined' && document.hidden) return;
    if (++ticks % VOLATILE_EVERY === 0) void rereadVolatile();
    try {
      refresh();
    } catch (e) {
      console.error(e);
    }
  }, REFRESH_MS);

  // ───────────── keyboard: Escape closes, Tab stays inside ─────────────
  el.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    if (e.key === 'Escape') {
      // Stopped here: the App forwards Escape / Back as a synthetic key event that would otherwise bubble on to the
      // simulation underneath and close its dock as well (this page returns you to the same place).
      e.preventDefault();
      e.stopPropagation();
      opts.onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = [...el.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.closest('[hidden]') && x.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && (active === first || !el.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !el.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  });

  return {
    el,
    destroy() {
      destroyed = true;
      clearInterval(timer);
      clearTimeout(statusTimer);
    },
  };
}
