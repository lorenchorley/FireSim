/**
 * Main simulation screen (C): full-screen 3-D view with the top bar, floating tool rail, view controls, tool
 * panels, draggable bottom sheet, time scrubber and danger toasts. Owns the map gesture layer that turns taps and
 * finger strokes into "Why here?" queries, fire marks, fuel brush strokes and local wind observations.
 */
import type { Insight, ScenarioData } from '../../../core/types';
import { BurnState } from '../../../core/types';
import type { SceneImagery, SceneViewApi } from '../../../render/api';
import { DEFAULT_LAYERS, type LayerState } from '../../../render/layers';
import { h, listen, setChildren, svg } from '../../dom';
import { icon, type IconName } from '../../icons';
import { thinPath, windScreenRotation, type Pt } from '../../brushGeometry';
import { presetById } from '../../fuelPresets';
import { fuelWithEdits } from '../../fuelDisplay';
import { showMePatch } from '../../showMe';
import { weatherAt } from '../../weatherSeries';
import type { Services } from '../../modules';
import { SimSession } from '../../session';
import { DangerGate } from '../../insightGroups';
import { performanceProfile, settingsStore } from '../../settings';
import { Store } from '../../store';
import { DEFAULT_UI, type SimContext, type ToolId, type UiState } from './context';
import { createFirePanel, createFuelPanel, createWindPanel } from './editPanels';
import { createScrubber } from './scrubber';
import { createSheet } from './sheet';
import { createToasts } from './toasts';
import { createTopBar } from './topBar';
import { createLayersPanel, createMapLegend, createWhatIfPanel } from './viewPanels';
import { createWhyPanel } from './whyPanel';

export interface SimScreenOptions {
  scenario: ScenarioData;
  services: Services;
  imagery: SceneImagery | null;
  /** User position (local m) and heading, when the scenario was built from GPS. */
  user?: { x: number; y: number; heading: number | null } | null;
  /** Non-fatal build warnings to keep visible. */
  buildWarnings?: string[];
  announce(msg: string): void;
  onExit(): void;
  onSettings(): void;
  onNotice(): void;
}

export interface SimScreen {
  el: HTMLElement;
  session: SimSession;
  view: SceneViewApi;
  destroy(): void;
}

const TOOLS: { id: ToolId; label: string; icon: IconName }[] = [
  { id: 'why', label: 'Why here?', icon: 'why' },
  { id: 'fire', label: 'Fire', icon: 'flame' },
  { id: 'fuel', label: 'Fuel', icon: 'brush' },
  { id: 'wind', label: 'Wind', icon: 'wind' },
  { id: 'layers', label: 'Layers', icon: 'layers' },
  { id: 'whatif', label: 'What if', icon: 'whatif' },
];

export async function createSimScreen(o: SimScreenOptions): Promise<SimScreen> {
  const { scenario, services } = o;
  const tz = scenario.weather.timezone || 'Australia/Sydney';
  const unsubs: (() => void)[] = [];

  // ───────────── DOM skeleton ─────────────
  const sceneHost = h('div', { class: 'scene-host', dataset: { testid: 'scene' } });
  const dim = h('div', { class: 'map-dim', aria: { hidden: true } });
  const annotations = svg('svg', { class: 'annotations', 'aria-hidden': 'true' });
  const drawLayer = h('div', { class: 'draw-layer', hidden: true, dataset: { testid: 'draw-layer' }, aria: { label: 'Drawing area — drag your finger to draw' } });
  const crosshair = h('div', { class: 'crosshair', hidden: true, aria: { hidden: true } }, icon('crosshair', { size: 44 }));
  const panelHost = h('div', { class: 'panel-host' });
  const root = h('div', { class: ['screen', 'sim-screen', `hand-${settingsStore.get().handedness}`], dataset: { testid: 'sim' } }, [sceneHost, dim, annotations, drawLayer, crosshair]);

  // ───────────── scene + session ─────────────
  const view = services.createSceneView(sceneHost);
  const prof = performanceProfile(settingsStore.get().performance);
  const layers = new Store<LayerState>({ ...DEFAULT_LAYERS, crossSection: { ...DEFAULT_LAYERS.crossSection }, smoke: prof.smoke, vegetation: prof.vegetation, imagery: !!o.imagery });
  view.setScenario(scenario.terrain, scenario.fuel, { imagery: o.imagery, hiRes: scenario.terrainHiRes ?? null });
  view.setStartTime?.(scenario.startTime);
  view.setLayers(layers.get());
  if (o.user) view.setUserLocation(o.user.x, o.user.y, o.user.heading);
  const controller = services.createController();
  const session = new SimSession(scenario, controller, view);
  const ui = new Store<UiState>({ ...DEFAULT_UI, wind: { ...DEFAULT_UI.wind } });

  const ctx: SimContext = {
    scenario,
    session,
    view,
    layers,
    settings: settingsStore,
    ui,
    tz,
    mapEl: sceneHost,
    user: o.user ? [o.user.x, o.user.y] : null,
    announce: o.announce,
    exit: o.onExit,
    openSettings: o.onSettings,
    showNotice: o.onNotice,
    absTime: (t) => scenario.startTime + t * 1000,
    buildWarnings: o.buildWarnings ?? [],
    get legendProvider() {
      return services.sources.scene === 'real' ? services.legendProvider : null;
    },
    get sceneLegends() {
      return services.sources.scene === 'real' ? services.sceneLegends : null;
    },
    pickCrosshair: () => {
      const r = crosshair.getBoundingClientRect();
      return view.pickGround(r.left + r.width / 2, r.top + r.height / 2);
    },
  };

  // ───────────── chrome ─────────────
  const topBar = createTopBar(ctx);
  const showInsight = (i: Insight): void => {
    view.focusInsight(i, true);
    const w = weatherAt(scenario.weather, ctx.absTime(i.time));
    const patch = showMePatch(i, (w.windDir10 + 180) % 360);
    if (Object.keys(patch).length) {
      layers.set(patch);
      view.setLayers(patch);
    }
    if (session.state.get().playing) session.pause();
    ui.set({ sheet: 'peek' });
    o.announce(`Showing ${i.title} on the map.`);
  };
  const sheet = createSheet(ctx, showInsight);
  const scrubber = createScrubber(ctx);
  const toasts = createToasts(ctx, showInsight);
  const dangerGate = new DangerGate();

  const rail = h(
    'nav',
    { class: 'tool-rail', aria: { label: 'Tools' } },
    TOOLS.map((t) =>
      h(
        'button',
        { type: 'button', class: 'tool-btn', dataset: { tool: t.id, testid: `tool-${t.id}` }, attrs: { 'aria-pressed': 'false' }, on: { click: () => selectTool(t.id) } },
        [icon(t.icon, { size: 26 }), h('span', { class: 'tool-label' }, t.label)],
      ),
    ),
  );
  const viewBtn = (mode: UiState['viewMode'], label: string, iconName: IconName): HTMLButtonElement =>
    h(
      'button',
      {
        type: 'button',
        class: 'view-btn',
        dataset: { mode },
        attrs: { 'aria-pressed': 'false' },
        aria: { label },
        on: {
          click: () => {
            ui.set({ viewMode: mode });
            view.setViewMode(mode);
          },
        },
      },
      [icon(iconName, { size: 22 }), h('span', { class: 'view-label' }, label.split(' ')[0]!)],
    );
  const viewControls = h('div', { class: 'view-controls', attrs: { role: 'group', 'aria-label': 'Camera' } }, [
    viewBtn('orbit', '3D view', 'cube'),
    viewBtn('top', 'Top view', 'top'),
    viewBtn('ground', 'Eye level', 'person'),
    h('button', { type: 'button', class: 'view-btn', aria: { label: 'Fly to the fire' }, on: { click: () => flyToFire() } }, [icon('flame', { size: 22 }), h('span', { class: 'view-label' }, 'Fire')]),
    o.user ? h('button', { type: 'button', class: 'view-btn', aria: { label: 'Fly to my position' }, on: { click: () => view.flyTo(o.user!.x, o.user!.y, 1500) } }, [icon('gps', { size: 22 }), h('span', { class: 'view-label' }, 'Me')]) : null,
  ]);
  // Map navigation for gloved hands (pinch and two-finger rotate still work): compass (tap = north up) and zoom.
  const needle = h('span', { class: 'compass-needle', aria: { hidden: true } }, [
    h('span', { class: 'compass-n' }, 'N'),
    svg('svg', { viewBox: '0 0 24 24', width: '20', height: '20' }, [
      svg('path', { d: 'M12 1.5 L17 12 L7 12 Z', class: 'needle-n' }),
      svg('path', { d: 'M12 22.5 L17 12 L7 12 Z', class: 'needle-s' }),
    ]),
  ]);
  const compassBtn = h('button', { type: 'button', class: 'view-btn nav-btn compass-btn', dataset: { testid: 'compass' }, aria: { label: 'Turn the map north up' }, on: { click: () => view.setHeading(0) } }, needle);
  const zoomBtn = (dir: 'in' | 'out'): HTMLButtonElement =>
    h('button', { type: 'button', class: 'view-btn nav-btn', dataset: { testid: `zoom-${dir}` }, aria: { label: dir === 'in' ? 'Zoom in' : 'Zoom out' }, on: { click: () => view.zoomBy(dir === 'in' ? 0.6 : 1 / 0.6) } }, icon(dir === 'in' ? 'plus' : 'minus', { size: 24 }));
  viewControls.append(h('div', { class: 'view-nav', attrs: { role: 'group', 'aria-label': 'Map navigation' } }, [compassBtn, zoomBtn('in'), zoomBtn('out')]));
  let shownHeading = NaN;
  const compassTimer = setInterval(() => {
    const hd = Math.round(view.heading);
    if (hd === shownHeading) return;
    shownHeading = hd;
    needle.style.transform = `rotate(${-hd}deg)`;
    compassBtn.setAttribute('aria-label', `Map faces ${hd}°. Turn the map north up`);
  }, 200);
  unsubs.push(() => clearInterval(compassTimer));
  const simNotice = services.sources.sim === 'mock' || services.sources.scene === 'mock' ? h('p', { class: 'mock-banner' }, services.sources.sim === 'mock' ? 'Demo engine' : '2-D map') : null;
  if (simNotice) viewControls.prepend(simNotice);

  const mapLegend = createMapLegend(ctx, () => selectTool('layers'));
  root.append(topBar.el, viewControls, rail, mapLegend.el, toasts.el, panelHost, sheet.el, scrubber.el);
  unsubs.push(() => mapLegend.destroy());

  // ───────────── visible map area ─────────────
  // The top bar, the scrubber, an open tool panel and the sheet cover parts of the full-screen 3-D view. Tell the view
  // (so fly-to targets and the orbit pivot land in the visible part) and centre the crosshair there too, so "Mark at
  // crosshair" marks the point the view centres on.
  const layoutInsets = (): void => {
    const host = sceneHost.getBoundingClientRect();
    if (!host.width || !host.height) return;
    const top = Math.max(0, topBar.el.getBoundingClientRect().bottom - host.top);
    let bottom = Math.max(0, host.bottom - scrubber.el.getBoundingClientRect().top);
    let left = 0;
    let right = 0;
    const cover = (r: { left: number; right: number; top: number; width: number; height: number }): void => {
      if (r.width <= 0 || r.height <= 0) return;
      if (r.width >= host.width * 0.6) bottom = Math.max(bottom, host.bottom - r.top);
      else if (r.left + r.width / 2 < host.left + host.width / 2) left = Math.max(left, r.right - host.left);
      else right = Math.max(right, host.right - r.left);
    };
    const panelEl = panelHost.firstElementChild as HTMLElement | null;
    if (panelEl) cover(panelEl.getBoundingClientRect());
    else if (!sheet.el.hidden) {
      const sr = sheet.el.getBoundingClientRect();
      const target = Number.parseFloat(sheet.el.style.height) || sr.height;
      cover({ left: sr.left, right: sr.right, top: sr.bottom - target, width: sr.width, height: target });
    }
    view.setViewInsets({ top, bottom, left, right });
    // The crosshair marks the view's optical centre: the middle of the uncovered area (the view limits the shift to a
    // third of its size, and so does the crosshair).
    const cx = host.width / 2 + Math.max(-host.width / 3, Math.min(host.width / 3, (left - right) / 2));
    const cy = host.height / 2 + Math.max(-host.height / 3, Math.min(host.height / 3, (top - bottom) / 2));
    crosshair.style.left = `${Math.round(cx)}px`;
    crosshair.style.top = `${Math.round(cy)}px`;
    // The overlay legend sits at the bottom of the visible map, between the two button columns.
    let colL = left;
    let colR = host.width - right;
    for (const c of [viewControls, rail]) {
      const r = c.getBoundingClientRect();
      if (!r.width || getComputedStyle(c).display === 'none') continue;
      if (r.left + r.width / 2 < host.left + host.width / 2) colL = Math.max(colL, r.right - host.left);
      else colR = Math.min(colR, r.left - host.left);
    }
    const ls = mapLegend.el.style;
    ls.top = 'auto';
    ls.bottom = `${Math.round(bottom + 10)}px`;
    ls.left = `${Math.round(colL + 8)}px`;
    ls.right = `${Math.round(host.width - colR + 8)}px`;
  };
  let insetRaf = 0;
  let insetTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleInsets = (): void => {
    cancelAnimationFrame(insetRaf);
    insetRaf = requestAnimationFrame(layoutInsets);
    // Once more after the panel / sheet animations (0.2–0.25 s) have settled.
    clearTimeout(insetTimer);
    insetTimer = setTimeout(layoutInsets, 320);
  };
  const insetRo = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleInsets) : null;
  insetRo?.observe(root);
  insetRo?.observe(panelHost);
  insetRo?.observe(sheet.el);
  unsubs.push(
    () => {
      insetRo?.disconnect();
      cancelAnimationFrame(insetRaf);
      clearTimeout(insetTimer);
    },
    ui.subscribe(scheduleInsets, ['sheet', 'panelOpen', 'tool']),
  );

  // ───────────── adaptive tool rail ─────────────
  // Six tools at the full 68 px need ~440 px between the top bar and the peeking sheet: more than a 390 × 844 or
  // 360 × 740 phone has. Measure the room and shrink the buttons (never below 52 px), or fall back to two columns,
  // so every tool stays reachable above the sheet instead of disappearing under it.
  const layoutRail = (): void => {
    if (!rail.isConnected || getComputedStyle(rail).display === 'none') return;
    const r = rail.getBoundingClientRect();
    const limits = [scrubber.el.getBoundingClientRect().top];
    if (!sheet.el.hidden) {
      // Use the sheet's target height (not its animated one) and only when it sits under the rail (in landscape it
      // is a side column).
      const sr = sheet.el.getBoundingClientRect();
      const target = Number.parseFloat(sheet.el.style.height) || sr.height;
      if (sr.left < r.right && sr.right > r.left) limits.push(sr.bottom - target);
    }
    const avail = Math.min(...limits) - r.top - 8;
    const n = TOOLS.length;
    const gap = 6;
    const one = Math.floor((avail - (n - 1) * gap) / n);
    const two = Math.floor((avail - (Math.ceil(n / 2) - 1) * gap) / Math.ceil(n / 2));
    const mode = one >= 68 ? 'full' : one >= 52 ? 'compact' : 'two';
    rail.dataset.layout = mode;
    rail.style.setProperty('--tool-h', `${mode === 'full' ? 68 : mode === 'compact' ? one : Math.max(48, Math.min(68, two))}px`);
  };
  let railRaf = 0;
  const scheduleRail = (): void => {
    cancelAnimationFrame(railRaf);
    railRaf = requestAnimationFrame(layoutRail);
  };
  const railRo = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleRail) : null;
  railRo?.observe(root);
  unsubs.push(
    () => {
      railRo?.disconnect();
      cancelAnimationFrame(railRaf);
    },
    ui.subscribe(scheduleRail, ['sheet', 'panelOpen']),
  );
  scheduleRail();

  /** Fly to the fire, far enough back to see the whole burnt area (1.5–12 km). */
  function flyToFire(): void {
    const snap = session.state.get().snapshot;
    let sx = 0;
    let sy = 0;
    let n = 0;
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    if (snap) {
      const g = snap.fire.grid;
      const t = snap.time;
      for (let k = 0; k < snap.fire.burnState.length; k++) {
        const a = snap.fire.arrivalTime[k]!;
        if (!(a <= t)) continue;
        const x = g.x0 + (k % g.nx) * g.cellSize;
        const y = g.y0 + Math.floor(k / g.nx) * g.cellSize;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        if (snap.fire.burnState[k] === BurnState.Burning) {
          sx += x;
          sy += y;
          n++;
        }
      }
    }
    // Frame the burnt area: its centre, pulled a third of the way towards the burning edge.
    if (Number.isFinite(x0)) {
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      sx = n ? cx + (sx / n - cx) / 3 : cx;
      sy = n ? cy + (sy / n - cy) / 3 : cy;
      n = 1;
    }
    if (!n) {
      const ign = session.state.get().ignitions.at(-1);
      if (ign) {
        [sx, sy] = ign.points[0]!;
        n = 1;
      }
    }
    const span = Number.isFinite(x0) ? Math.max(x1 - x0, y1 - y0) : 0;
    if (n) view.flyTo(sx / n, sy / n, Math.min(12000, Math.max(1500, 1.6 * span)));
    else o.announce('No fire marked yet.');
  }

  // ───────────── tools & panels ─────────────
  function selectTool(id: ToolId): void {
    const s = ui.get();
    if (s.tool === id && (s.panelOpen || id === 'why')) {
      closePanel();
      return;
    }
    ui.set({ tool: id, panelOpen: id !== 'why' || s.why !== null, pending: null, drawing: id === 'fire' ? s.fireInput === 'line' : false });
  }
  function closePanel(): void {
    ui.set({ tool: 'why', panelOpen: false, pending: null, drawing: false, why: null });
  }
  let panel: { el: HTMLElement; destroy(): void } | null = null;
  let panelKey = '';
  const renderPanel = (): void => {
    const s = ui.get();
    const key = s.panelOpen ? s.tool : '';
    for (const b of rail.querySelectorAll<HTMLButtonElement>('.tool-btn')) b.setAttribute('aria-pressed', String(b.dataset.tool === s.tool));
    root.dataset.tool = s.tool;
    root.classList.toggle('panel-open', s.panelOpen);
    if (key === panelKey) return;
    panelKey = key;
    panel?.destroy();
    panel = null;
    setChildren(panelHost, null);
    if (!s.panelOpen) return;
    const factory = { why: createWhyPanel, fire: createFirePanel, fuel: createFuelPanel, wind: createWindPanel, layers: createLayersPanel, whatif: createWhatIfPanel }[s.tool];
    panel = factory(ctx, closePanel);
    panelHost.append(panel.el);
  };
  unsubs.push(ui.subscribe(renderPanel, ['tool', 'panelOpen']));

  const renderModes = (): void => {
    const s = ui.get();
    drawLayer.hidden = !s.drawing;
    view.setInteractionEnabled(!s.drawing);
    const wantsCrosshair = s.panelOpen && ((s.tool === 'fire' && s.fireInput === 'point') || (s.tool === 'fuel' && !s.drawing) || s.tool === 'wind');
    crosshair.hidden = !wantsCrosshair;
    root.classList.toggle('drawing', s.drawing);
    for (const b of viewControls.querySelectorAll<HTMLButtonElement>('[data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === s.viewMode));
    // Brush preview for a pending brush tap.
    const p = s.pending;
    if (s.tool === 'fuel' && p?.kind === 'brush' && p.points.length === 1) view.setBrushPreview({ x: p.points[0]![0], y: p.points[0]![1], radius: p.radius, colour: presetById(s.fuelPreset).colour });
    else if (s.tool !== 'fuel' || !p) view.setBrushPreview(null);
    scheduleAnnotations();
  };
  unsubs.push(ui.subscribe(renderModes, ['drawing', 'tool', 'panelOpen', 'fireInput', 'pending', 'viewMode', 'why', 'wind', 'fuelPreset']));

  // ───────────── map taps ─────────────
  const downs = new Map<number, { x: number; y: number; t: number }>();
  let multi = false;
  unsubs.push(
    listen(
      sceneHost,
      'pointerdown',
      (e) => {
        downs.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
        if (downs.size > 1) multi = true;
      },
      { capture: true },
    ),
    listen(
      sceneHost,
      'pointerup',
      (e) => {
        const d = downs.get(e.pointerId);
        downs.delete(e.pointerId);
        const wasMulti = multi;
        if (downs.size === 0) multi = false;
        if (!d || wasMulti) return;
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 12 || performance.now() - d.t > 700) return;
        onTap(e.clientX, e.clientY);
      },
      { capture: true },
    ),
    listen(sceneHost, 'pointercancel', (e) => void downs.delete(e.pointerId), { capture: true }),
  );

  function onTap(cx: number, cy: number): void {
    const p = view.pickGround(cx, cy);
    if (!p) return;
    // Touching the map brings the map back: collapse an expanded sheet (the tool rail reappears).
    if (ui.get().sheet !== 'peek') ui.set({ sheet: 'peek' });
    const s = ui.get();
    switch (s.panelOpen ? s.tool : 'why') {
      case 'why':
        void askWhy(p);
        break;
      case 'fire':
        if (s.fireInput === 'point') ui.set({ pending: { kind: 'point', at: p } });
        break;
      case 'fuel':
        if (!s.drawing) ui.set({ pending: { kind: 'brush', points: [p], radius: s.brushRadius } });
        break;
      case 'wind':
        ui.set({ pending: { kind: 'point', at: p } });
        break;
      default:
        break;
    }
  }

  let whySeq = 0;
  /**
   * Explain a point at the view time. `refresh` re-asks for the same point after the clock moved (a new snapshot while
   * the panel is open): the previous explanation stays on screen until the new one arrives, so it does not flash.
   */
  async function askWhy(p: [number, number], refresh = false): Promise<void> {
    const seq = ++whySeq;
    const time = session.state.get().viewTime;
    if (!refresh) ui.set({ tool: 'why', panelOpen: true, why: { x: p[0], y: p[1], time, loading: true, explanation: null } });
    whyInFlight = true;
    try {
      const e = await session.explain(p[0], p[1]);
      if (seq === whySeq && ui.get().why) ui.set({ why: { x: p[0], y: p[1], time, loading: false, explanation: e } });
    } catch (err) {
      if (seq === whySeq && ui.get().why && !refresh) ui.set({ why: { x: p[0], y: p[1], time, loading: false, explanation: null, error: (err as Error).message || 'No explanation available here.' } });
    } finally {
      if (seq === whySeq) whyInFlight = false;
    }
  }
  let whyInFlight = false;
  // Keep "Why here?" current while it is open: re-explain when the displayed snapshot changes (the fire arrives, the
  // wind turns, or the user scrubs), at most once per snapshot.
  unsubs.push(
    session.state.subscribe((st) => {
      const u = ui.get();
      const w = u.why;
      if (!w || w.loading || whyInFlight || !u.panelOpen || u.tool !== 'why' || !st.snapshot) return;
      if (Math.abs(st.viewTime - w.time) < 30) return;
      void askWhy([w.x, w.y], true);
    }, ['snapshot']),
  );

  // ───────────── finger drawing (fire lines, fuel painting) ─────────────
  let stroke: { screen: Pt[]; local: Pt[]; id: number } | null = null;
  drawLayer.addEventListener('pointerdown', (e) => {
    drawLayer.setPointerCapture?.(e.pointerId);
    stroke = { screen: [[e.clientX, e.clientY]], local: [], id: e.pointerId };
    const p = view.pickGround(e.clientX, e.clientY);
    if (p) stroke.local.push(p);
    ui.set({ pending: null });
    brushAt(p);
    scheduleAnnotations();
    e.preventDefault();
  });
  drawLayer.addEventListener('pointermove', (e) => {
    if (!stroke || e.pointerId !== stroke.id) return;
    const last = stroke.screen[stroke.screen.length - 1]!;
    if (Math.hypot(e.clientX - last[0], e.clientY - last[1]) < 6) return;
    stroke.screen.push([e.clientX, e.clientY]);
    const p = view.pickGround(e.clientX, e.clientY);
    if (p) stroke.local.push(p);
    brushAt(p);
    scheduleAnnotations();
  });
  const endStroke = (): void => {
    if (!stroke) return;
    const s = ui.get();
    const cs = scenario.terrain.grid.cellSize;
    const pts = thinPath(stroke.local, cs / 2);
    stroke = null;
    if (s.tool === 'fire' && pts.length >= 2) ui.set({ pending: { kind: 'line', points: pts } });
    else if (s.tool === 'fire' && pts.length === 1) ui.set({ pending: { kind: 'point', at: pts[0]! } });
    else if (s.tool === 'fuel' && pts.length) ui.set({ pending: { kind: 'brush', points: pts, radius: s.brushRadius } });
    view.setBrushPreview(null);
    scheduleAnnotations();
  };
  drawLayer.addEventListener('pointerup', endStroke);
  drawLayer.addEventListener('pointercancel', endStroke);
  function brushAt(p: [number, number] | null): void {
    const s = ui.get();
    if (s.tool === 'fuel' && p) view.setBrushPreview({ x: p[0], y: p[1], radius: s.brushRadius, colour: presetById(s.fuelPreset).colour });
  }

  // ───────────── annotations (pending marks, why point, strokes) ─────────────
  // Screen-space marks glued to the terrain. While something is placed they are re-projected every frame (the camera
  // may be moving), but the SVG is only rebuilt when the projected geometry actually changes.
  let annRaf = 0;
  let annKey = '';
  function scheduleAnnotations(): void {
    if (!annRaf) annRaf = requestAnimationFrame(drawAnnotations);
  }
  function drawAnnotations(): void {
    annRaf = 0;
    const s = ui.get();
    const host = sceneHost.getBoundingClientRect();
    const toLocal = (c: [number, number] | null): [number, number] | null => (c ? [c[0] - host.left, c[1] - host.top] : null);
    const project = (p: Pt): [number, number] | null => toLocal(view.projectToScreen(p[0], p[1]));
    const r1 = (v: number): number => Math.round(v * 2) / 2;
    const path = (pts: [number, number][]): string => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${r1(x)},${r1(y)}`).join(' ');
    const marks: AnnMark[] = [];
    let live = false;
    if (stroke && stroke.screen.length > 1) {
      const colour = s.tool === 'fuel' ? presetById(s.fuelPreset).colour : originColour(s.fireOrigin);
      marks.push({ kind: 'stroke', d: path(stroke.screen.map(([x, y]) => [x - host.left, y - host.top] as [number, number])), colour });
    }
    const p = s.pending;
    if (p && !stroke) {
      live = true;
      if (p.kind === 'point') {
        const q = project(p.at);
        if (q) {
          if (s.tool === 'wind') marks.push({ kind: 'wind', at: q, rotate: windScreenRotation(p.at, s.wind.dir, q, project) });
          else marks.push({ kind: 'pin', at: q, colour: s.tool === 'fire' ? originColour(s.fireOrigin) : '#1a73e8' });
        }
      } else if (p.kind === 'line' || (p.kind === 'brush' && p.points.length > 1)) {
        const pts = p.points.map(project).filter((q): q is [number, number] => !!q);
        if (pts.length > 1) {
          const colour = p.kind === 'brush' ? presetById(s.fuelPreset).colour : originColour(s.fireOrigin);
          let width: number | undefined;
          if (p.kind === 'brush') {
            const a = project(p.points[0]!);
            const b = project([p.points[0]![0] + p.radius, p.points[0]![1]]);
            width = a && b ? Math.max(8, Math.round(2 * Math.hypot(b[0] - a[0], b[1] - a[1]))) : 8;
          }
          marks.push({ kind: 'stroke', d: path(pts), colour, width });
        }
      }
    }
    if (s.why && s.panelOpen && s.tool === 'why') {
      live = true;
      const q = project([s.why.x, s.why.y]);
      if (q) marks.push({ kind: 'why', at: [r1(q[0]), r1(q[1])] });
    }
    const key = JSON.stringify(marks);
    if (key !== annKey) {
      annKey = key;
      setChildren(annotations, marks.map(markElement));
    }
    // Keep marks glued to the terrain while the camera moves.
    if (live || stroke) annRaf = requestAnimationFrame(drawAnnotations);
  }


  // ───────────── insights → toasts ─────────────
  unsubs.push(
    session.events.on('reveal', (i) => {
      // A big fire reports the same danger all along its edge: toast a kind at most once an hour (simulated) and
      // pause only the first time it appears, so "pause on danger" teaches without stopping playback every minute.
      const d = dangerGate.decide(i);
      if (d.toast) toasts.push(i);
      if (d.pause && settingsStore.get().pauseOnDanger && session.state.get().playing) {
        session.pause();
        o.announce(`Danger: ${i.title}. Playback paused.`);
      }
    }),
    session.controller.on('rewound', (t) => dangerGate.reset(t)),
    session.events.on('ended', () => o.announce('End of the simulated period.')),
    settingsStore.subscribe((st) => {
      root.classList.toggle('hand-left', st.handedness === 'left');
      root.classList.toggle('hand-right', st.handedness === 'right');
    }, ['handedness']),
    // Performance mode changed during a run: switch the engine tier from now on (the worker restores the latest
    // checkpoint and re-runs with the new atmosphere) and the heavy render layers.
    settingsStore.subscribe((st) => {
      const tier = st.performance === 'battery' ? 'fast' : st.performance === 'quality' ? 'high' : 'standard';
      session.controller.setQuality(tier);
      const p = performanceProfile(st.performance);
      layers.set({ smoke: p.smoke, vegetation: p.vegetation });
      view.setLayers({ smoke: p.smoke, vegetation: p.vegetation });
    }, ['performance']),
    listen(window, 'resize', () => view.resize()),
    // Backgrounded (screen locked, app switched): stop the worker too, not just the frame loop, so it does not burn
    // battery computing hours ahead in the pocket. Playback stays paused until the user presses Play again.
    listen(document, 'visibilitychange', () => {
      if (document.visibilityState === 'hidden' && session.state.get().playing) {
        session.pause();
        o.announce('Paused while FireSim was in the background.');
      }
    }),
    listen(document, 'keydown', (e) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === ' ' && !(t instanceof HTMLButtonElement)) {
        e.preventDefault();
        session.toggle();
      } else if (e.key === 'Escape') closePanel();
    }),
  );
  // Fuel-brush edits: show them in the 3-D view straight away (a display copy of the fuel map; the worker applies the
  // authoritative edit). Recomputed from the scenario's fuel whenever the set of fuel edits changes (add / remove).
  let fuelKey = '';
  unsubs.push(
    session.state.subscribe((st) => {
      const edits = st.edits.map((e) => e.edit).filter((e) => e.kind === 'fuel');
      const key = edits.map((e) => e.id).join('|');
      if (key === fuelKey) return;
      fuelKey = key;
      const display = fuelWithEdits(scenario.fuel, edits);
      if (display) view.refreshFuel(display);
    }, ['edits']),
  );

  const unsubErr = session.state.subscribe((s) => {
    if (!s.error) return;
    o.announce(`Simulation error: ${s.error}`);
    toasts.pushSystem(`Simulation problem: ${s.error}`);
  }, ['error']);
  unsubs.push(unsubErr);

  renderPanel();
  renderModes();

  let destroyed = false;
  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    for (const u of unsubs) u();
    cancelAnimationFrame(annRaf);
    panel?.destroy();
    topBar.destroy();
    sheet.destroy();
    scrubber.destroy();
    toasts.destroy();
    session.dispose();
    view.dispose();
    root.remove();
  };
  try {
    await session.start();
  } catch (e) {
    // Worker init failed: release the WebGL context, the worker and all listeners before reporting the error.
    destroy();
    throw e;
  }

  return { el: root, session, view, destroy };
}

/** A screen-space annotation (pending mark, stroke, "why" point), as plain data so changes can be detected. */
type AnnMark =
  | { kind: 'stroke'; d: string; colour: string; width?: number }
  | { kind: 'pin'; at: [number, number]; colour: string }
  | { kind: 'wind'; at: [number, number]; rotate: number }
  | { kind: 'why'; at: [number, number] };

function markElement(m: AnnMark): SVGElement | SVGElement[] {
  switch (m.kind) {
    case 'stroke':
      return [
        svg('path', { d: m.d, class: 'ann-stroke-casing', style: m.width ? `stroke-width:${m.width + 4}px;opacity:.35` : '' }),
        svg('path', { d: m.d, class: 'ann-stroke', style: `stroke:${m.colour};${m.width ? `stroke-width:${m.width}px;opacity:.55` : ''}` }),
      ];
    case 'pin':
      return pinGlyph(m.at, m.colour);
    case 'wind':
      return windGlyph(m.at, m.rotate);
    case 'why':
      return svg('g', { class: 'ann-why', transform: `translate(${m.at[0]},${m.at[1]})` }, [svg('circle', { r: 16, class: 'ann-why-ring' }), svg('circle', { r: 5, class: 'ann-why-dot' })]);
  }
}

function originColour(o: 'observed' | 'spot' | 'backburn'): string {
  return o === 'observed' ? '#e02424' : o === 'spot' ? '#ff8c1a' : '#7b3fe4';
}

function pinGlyph([x, y]: [number, number], colour: string): SVGElement {
  return svg('g', { class: 'ann-pin', transform: `translate(${x},${y})` }, [
    svg('circle', { r: 22, class: 'ann-pulse', style: `stroke:${colour}` }),
    svg('circle', { r: 10, class: 'ann-pin-dot', style: `fill:${colour}` }),
  ]);
}

function windGlyph([x, y]: [number, number], rotate: number): SVGElement {
  // Arrow drawn blowing downwards (towards +y on screen), rotated to the on-screen downwind direction.
  return svg('g', { class: 'ann-wind', transform: `translate(${x},${y}) rotate(${rotate})` }, [
    svg('path', { d: 'M0 -46 L0 10 M-12 -4 L0 14 L12 -4', class: 'ann-wind-casing' }),
    svg('path', { d: 'M0 -46 L0 10 M-12 -4 L0 14 L12 -4', class: 'ann-wind-arrow' }),
    svg('circle', { r: 6, cy: 0, class: 'ann-pin-dot', style: 'fill:#1a73e8' }),
  ]);
}

