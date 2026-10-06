/**
 * Main simulation screen (C), in the Google-Maps-for-Android language (docs/DESIGN.md): the full-screen 3-D view with a
 * floating pill top bar and its read-out chips, a right-hand column of round white mini-FABs (Layers, View, Compass), an
 * extended "Tools" FAB in the bottom corner whose speed dial holds the tools, the bottom navigation (Insights / Weather /
 * Stats / Help) with its bottom sheet, the timeline strip, the map's legend card and attribution line and, only when the
 * engine fails, a thin error strip. Everything is collapsed by default. Nothing pops up over the map because of a
 * simulation event: new insight cards only raise a badge on the Insights tab, and playback stops only when the user, the
 * end of the scenario or the app going to the background says so. Owns the map gesture layer that turns taps and finger
 * strokes into "Why here?" queries, fire marks, fuel brush strokes and local wind observations.
 */
import type { Insight, ScenarioData } from '../../../core/types';
import { BurnState } from '../../../core/types';
import type { SceneImagery, SceneViewApi } from '../../../render/api';
import { DEFAULT_LAYERS, type LayerState, type OverlayKind } from '../../../render/layers';
import { layerForOverlay, SCENE_LAYER_KEYS, sceneLayerPatch, type SceneLayerKey } from '../../../render/layerCatalog';
import { h, listen, setChildren, svg, text, vibrate } from '../../dom';
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
import { createMapMenu } from './mapMenu';
import { backLayer, reduceMenu } from './layoutModel';
import { mapCredits } from './mapCredits';
import { createMapLegend } from './mapLegend';
import { restoreLayerPrefs } from './layersPrefs';
import { createTopBar } from './topBar';
import { createLayersPanel, createWhatIfPanel } from './viewPanels';
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
  /** Open the Data sets screen (optionally at one data set); the run keeps going underneath. */
  onOpenDatasets?(datasetId?: string): void;
  /** Open "How this simulation works"; the run keeps going underneath. */
  onOpenModelCard?(): void;
}

export interface SimScreen {
  el: HTMLElement;
  session: SimSession;
  view: SceneViewApi;
  /**
   * Android Back: close the top-most open layer of the screen (a top-bar sheet, the speed dial or view list, the tool
   * panel, the bottom sheet), one per press. Returns false when nothing was open, so the app may leave the screen.
   */
  back(): boolean;
  /**
   * "Show on map" from the Data sets screen: switch that heat map (overlay) or scene layer on, and give the map back
   * (the sheet and a tool panel close; playback is not touched).
   */
  showLayer(t: { overlay?: OverlayKind; sceneKey?: keyof LayerState }): void;
  /** A full-screen screen is (or is no longer) on top of this one: the 3-D view stops drawing while it is. Playback is not touched. */
  setCovered(covered: boolean): void;
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

/** The least height (px) the body of a tool panel is given before the read-out chips make room (landscape, large text). */
const PANEL_BODY_MIN = 64;

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
  // Roads, fire trails, homes, residential zones and place names (bundled for the demo sites, queried live elsewhere).
  view.setContext(scenario.context ?? null);
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
    ...(o.onOpenDatasets ? { openDatasets: (id?: string) => o.onOpenDatasets?.(id) } : {}),
    ...(o.onOpenModelCard ? { openModelCard: () => o.onOpenModelCard?.() } : {}),
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
  // Start from the device's defaults plus the layer choices the user made in earlier runs.
  unsubs.push(restoreLayerPrefs(ctx));

  // ───────────── chrome ─────────────
  const topBar = createTopBar(ctx, {
    openHelp: () => {
      if (ui.get().panelOpen || ui.get().pending) closePanel();
      ui.set({ tab: 'help', sheet: ui.get().sheet === 'closed' || ui.get().sheet === 'peek' ? 'half' : ui.get().sheet, menu: null });
    },
  });
  const showInsight = (i: Insight): void => {
    view.focusInsight(i, true);
    const w = weatherAt(scenario.weather, ctx.absTime(i.time));
    const patch = showMePatch(i, (w.windDir10 + 180) % 360);
    if (Object.keys(patch).length) {
      layers.set(patch);
      view.setLayers(patch);
    }
    // Playback is never touched: the user asked to see the place, not to stop the simulation. The dock closes so the
    // map (and the place) is fully visible.
    ui.set({ sheet: 'closed' });
    o.announce(`Showing ${i.title} on the map.`);
  };
  const sheet = createSheet(ctx, showInsight);
  const scrubber = createScrubber(ctx);
  const dangerGate = new DangerGate();

  // Tools: an extended FAB in the bottom corner (on the handed side) whose speed dial holds the six tools.
  const toolsMenu = createMapMenu({
    id: 'tools',
    label: 'Tools',
    text: 'Tools',
    variant: 'dial',
    testId: 'tools-menu',
    ui,
    current: { icon: TOOLS[0]!.icon, label: TOOLS[0]!.label },
    entries: TOOLS.map((t) => ({ id: t.id, label: t.label, icon: t.icon, toggle: true, testId: `tool-${t.id}`, data: { tool: t.id }, class: 'tool-btn', onSelect: () => selectTool(t.id) })),
  });

  // View: a round mini-FAB showing the camera mode; its card lists the camera modes, fly-to, north up and zoom.
  const VIEW_MODES: { mode: UiState['viewMode']; label: string; icon: IconName }[] = [
    { mode: 'orbit', label: '3D view', icon: 'cube' },
    { mode: 'top', label: 'Top view', icon: 'top' },
    { mode: 'ground', label: 'Eye level', icon: 'person' },
  ];
  const needleSvg = (): SVGElement => svg('svg', { viewBox: '0 0 24 24', width: '20', height: '20', 'aria-hidden': 'true' }, [svg('path', { d: 'M12 1.5 L17 12 L7 12 Z', class: 'needle-n' }), svg('path', { d: 'M12 22.5 L17 12 L7 12 Z', class: 'needle-s' })]);
  const needle = h('span', { class: 'compass-needle', aria: { hidden: true } }, [h('span', { class: 'compass-n' }, 'N'), needleSvg()]);
  const zoomBtn = (dir: 'in' | 'out'): HTMLButtonElement =>
    h(
      'button',
      { type: 'button', class: 'icon-btn menu-zoom-btn', dataset: { testid: `zoom-${dir}` }, aria: { label: dir === 'in' ? 'Zoom in' : 'Zoom out' }, on: { click: () => view.zoomBy(dir === 'in' ? 0.6 : 1 / 0.6) } },
      icon(dir === 'in' ? 'plus' : 'minus'),
    );
  const zoomRow = h('div', { class: 'menu-row menu-zoom', attrs: { role: 'group' }, aria: { label: 'Zoom' } }, [zoomBtn('out'), h('span', { class: 'menu-item-label' }, 'Zoom'), zoomBtn('in')]);
  const viewMenu = createMapMenu({
    id: 'view',
    label: 'View',
    variant: 'card',
    testId: 'view-menu',
    ui,
    // While the card is open the column rises above the Tools button: on a short screen (or with the read-out chips on two rows)
    // the card reaches down to it, and the Zoom row's "+" must not be underneath.
    onOpenChange: (open) => fabColumn.classList.toggle('view-open', open),
    current: { icon: VIEW_MODES[0]!.icon, label: VIEW_MODES[0]!.label },
    entries: [
      ...VIEW_MODES.map((m) => ({
        id: m.mode,
        label: m.label,
        icon: m.icon,
        toggle: true,
        class: 'view-btn',
        data: { mode: m.mode },
        onSelect: () => {
          ui.set({ viewMode: m.mode });
          view.setViewMode(m.mode);
        },
      })),
      { id: 'fly-fire', label: 'Fly to the fire', icon: 'flame' as const, testId: 'fly-fire', onSelect: () => flyToFire() },
      ...(o.user ? [{ id: 'fly-me', label: 'My position', icon: 'gps' as const, testId: 'fly-me', onSelect: () => view.flyTo(o.user!.x, o.user!.y, 1500) }] : []),
      { id: 'compass', label: 'North up', iconEl: needle, testId: 'compass', onSelect: () => view.setHeading(0) },
      { id: 'zoom', el: zoomRow },
    ],
  });
  const compassBtn = viewMenu.items.get('compass')!;

  // The right-hand column of round white buttons (Maps): Layers, View and, while the map is turned, the Compass.
  const layersFab = h(
    'button',
    { type: 'button', class: 'fab fab-sm layers-fab', dataset: { testid: 'layers-fab' }, attrs: { 'aria-pressed': 'false' }, aria: { label: 'Layers' }, on: { click: () => selectTool('layers') } },
    icon('layers'),
  );
  const fabNeedle = h('span', { class: 'compass-needle', aria: { hidden: true } }, [h('span', { class: 'compass-n' }, 'N'), needleSvg()]);
  const compassFab = h('button', { type: 'button', class: 'fab fab-sm compass-fab', dataset: { testid: 'compass-fab' }, aria: { label: 'Turn the map north up' }, on: { click: () => view.setHeading(0) } }, fabNeedle);
  const fabColumn = h('div', { class: 'map-fabs' }, [layersFab, viewMenu.el, compassFab]);

  let shownHeading = NaN;
  const syncCompass = (): void => {
    const hd = Math.round(view.heading);
    if (hd === shownHeading) return;
    shownHeading = hd;
    needle.style.transform = `rotate(${-hd}deg)`;
    fabNeedle.style.transform = `rotate(${-hd}deg)`;
    const deg = ((hd % 360) + 360) % 360;
    const label = `Map faces ${deg}°. Turn the map north up`;
    compassBtn.setAttribute('aria-label', label);
    compassFab.setAttribute('aria-label', label);
    // Like Google Maps, the compass button shows only while the map is turned away from north (North up stays in the
    // View menu); it is the user's own turn of the map that brings it, never the simulation.
    const northUp = deg <= 2 || deg >= 358;
    if (compassFab.hidden !== northUp) {
      compassFab.hidden = northUp;
      scheduleInsets();
    }
  };
  // The needles follow the live heading (a cheap read; the DOM only changes when the rounded heading does).
  const compassTimer = setInterval(syncCompass, 200);
  unsubs.push(() => clearInterval(compassTimer));

  const simNotice = services.sources.sim === 'mock' || services.sources.scene === 'mock' ? h('p', { class: 'mock-banner' }, services.sources.sim === 'mock' ? 'Demo engine' : '2-D map') : null;

  // Simulation failure: the only thing that ever appears uninvited, as a thin strip under the top bar (never a modal).
  const errorChip = h('div', { class: 'error-chip', hidden: true, attrs: { role: 'alert' }, dataset: { testid: 'error-chip' } }, [
    icon('warning'),
    h('span', { class: 'error-chip-text' }, 'Simulation problem'),
    h(
      'button',
      { type: 'button', class: 'btn btn-text btn-sm error-chip-btn', dataset: { testid: 'error-details' }, on: { click: () => ui.set({ tab: 'insights', sheet: 'half', panelOpen: false, menu: null }) } },
      'Details',
    ),
  ]);

  // The attribution line (like Maps'): the credits of what is on screen; a tap opens the Data sets screen.
  const creditText = h('span', { class: 'map-credit-text' });
  const credit = ctx.openDatasets
    ? h('button', { type: 'button', class: 'map-credit tap', dataset: { testid: 'map-credit' }, on: { click: () => ctx.openDatasets?.() } }, creditText)
    : h('p', { class: 'map-credit', dataset: { testid: 'map-credit' } }, creditText);
  let creditKey = '';
  const renderCredit = (): void => {
    // A scenario without an inventory (an older build, the demo engine) still credits its aerial photo.
    const c = mapCredits(scenario.datasets, layers.get(), { hasImagery: !!o.imagery, hasContext: !!scenario.context, ...(o.imagery?.attribution ? { imageryAttribution: o.imagery.attribution } : {}) });
    const txt = c.text;
    if (txt === creditKey) return;
    creditKey = txt;
    credit.hidden = !txt;
    text(creditText, txt);
    credit.setAttribute('aria-label', ctx.openDatasets ? `Map data: ${txt}. Open the data sets.` : `Map data: ${txt}`);
    if (ctx.openDatasets) credit.setAttribute('title', txt);
    scheduleInsets();
  };

  const mapLegend = createMapLegend(ctx, () => selectTool('layers'));
  root.append(topBar.el, ...(simNotice ? [simNotice] : []), errorChip, fabColumn, toolsMenu.el, mapLegend.el, credit, panelHost, sheet.el, scrubber.el);
  unsubs.push(() => mapLegend.destroy(), () => toolsMenu.destroy(), () => viewMenu.destroy());

  // ───────────── visible map area ─────────────
  // The top bar, the error chip, the timeline, the dock and an open tool panel cover parts of the full-screen 3-D view.
  // Tell the view (so fly-to targets and the orbit pivot land in the visible part) and centre the crosshair there too,
  // so "Mark at crosshair" marks the point the view centres on. The same measurements place the Tools button just above
  // whatever covers the bottom, fit the menus' lists to the room, and keep the legend and the credit line beside it.
  /** Height of the column of round buttons (px), remembered for when it is hidden. */
  let colH = 136;
  /** The read-out chips are put away while a tool panel is open on a short landscape screen that cannot hold both (see layoutInsets). */
  let chipsAway = false;
  const shortLandscape = typeof matchMedia === 'function' ? matchMedia('(orientation: landscape) and (max-height: 540px)') : null;
  const layoutInsets = (): void => {
    const host = sceneHost.getBoundingClientRect();
    if (!host.width || !host.height) return;
    let top = Math.max(0, topBar.el.getBoundingClientRect().bottom - host.top);
    errorChip.style.top = `${Math.round(top + 4)}px`;
    if (!errorChip.hidden) top = Math.max(top, errorChip.getBoundingClientRect().bottom - host.top);
    const strip = Math.max(0, host.bottom - scrubber.el.getBoundingClientRect().top);
    let bottom = strip;
    /** Bottom cover that spans the screen (the Tools button sits above it); side columns and short strips do not raise it. */
    let band = strip;
    let left = 0;
    let right = 0;
    /** The slim strip at the bottom (the closed dock in a side column) and the x range it covers. */
    let slim = null as { x0: number; x1: number; fromBottom: number } | null; // set by cover() below
    const cover = (r: { left: number; right: number; top: number; width: number; height: number }): void => {
      if (r.width <= 0 || r.height <= 0) return;
      const fromBottom = host.bottom - r.top;
      if (r.width >= host.width * 0.6) {
        bottom = Math.max(bottom, fromBottom);
        band = Math.max(band, fromBottom);
      } else if (r.height < host.height * 0.4) {
        // a slim strip (the closed dock in a side column)
        bottom = Math.max(bottom, fromBottom);
        slim = { x0: r.left - host.left, x1: r.right - host.left, fromBottom: Math.max(slim?.fromBottom ?? 0, fromBottom) };
      } else if (r.left + r.width / 2 < host.left + host.width / 2) left = Math.max(left, r.right - host.left);
      else right = Math.max(right, host.right - r.left);
    };
    const panelEl = panelHost.firstElementChild as HTMLElement | null;
    // A short landscape screen at a large text size (200 % on 844 x 390): the top bar's two rows, the panel's header and its Add / Clear bar
    // and the timeline leave no room for the panel's body, and the bar ends up under the timeline (Add fire cannot be tapped). The read-out
    // chips are not needed while a panel is open, so when they sit on their own row under the pill and the panel is squeezed they go away
    // until the panel closes (decided once per panel: hidden chips cannot be measured again).
    if (!panelEl) chipsAway = false;
    else if (!chipsAway && shortLandscape?.matches) {
      const body = panelEl.querySelector<HTMLElement>('.panel-body');
      const chips = topBar.el.querySelector<HTMLElement>('.tb-wx');
      const pill = topBar.el.querySelector<HTMLElement>('.tb-pill');
      if (body && chips && pill && body.clientHeight < PANEL_BODY_MIN && chips.getBoundingClientRect().top >= pill.getBoundingClientRect().bottom - 2) chipsAway = true;
    }
    root.classList.toggle('chips-away', chipsAway);
    if (panelEl) cover(panelEl.getBoundingClientRect());
    else if (!sheet.el.hidden) {
      const sr = sheet.el.getBoundingClientRect();
      const target = sheet.targetHeight();
      cover({ left: sr.left, right: sr.right, top: sr.bottom - target, width: sr.width, height: target });
    }
    view.setViewInsets({ top, bottom, left, right });
    // The crosshair marks the view's optical centre: the middle of the uncovered area (the view limits the shift to a
    // third of its size, and so does the crosshair).
    const cx = host.width / 2 + Math.max(-host.width / 3, Math.min(host.width / 3, (left - right) / 2));
    const cy = host.height / 2 + Math.max(-host.height / 3, Math.min(host.height / 3, (top - bottom) / 2));
    crosshair.style.left = `${Math.round(cx)}px`;
    crosshair.style.top = `${Math.round(cy)}px`;
    root.style.setProperty('--menu-bottom', `${Math.round(band + 12)}px`);
    root.style.setProperty('--map-top', `${Math.round(top)}px`);

    // The column of round buttons steps aside when a tool panel or a tall sheet reaches up to it (portrait), and the Tools
    // button gives way when a sheet would push it into the column. (The column's own height is remembered while hidden.)
    // It sits under the top bar; where that leaves no room beside the Tools button (a short landscape screen at a large
    // text size) and the top bar only reaches part way across, it starts higher, level with the top bar's side.
    if (fabColumn.offsetHeight) colH = fabColumn.offsetHeight;
    const colSide = fabColumn.getBoundingClientRect();
    const colX = colSide.width ? colSide.left + colSide.width / 2 - host.left : settingsStore.get().handedness === 'left' ? 32 : host.width - 32;
    const colHalf = (colSide.width || 40) / 2 + 8;
    // Only what is under the column's x range covers it from below (the closed dock of a side column is on the other side).
    const bottomAtCol = Math.max(strip, band, slim && slim.x1 > colX - colHalf && slim.x0 < colX + colHalf ? slim.fromBottom : 0);
    const coverTop = host.height - bottomAtCol;
    const toolsR = toolsMenu.fab.getBoundingClientRect();
    const toolsTop = host.height - (band + 12) - (toolsR.height || 48);
    const toolsBeside = Math.abs(toolsR.left + toolsR.width / 2 - host.left - colX) < host.width / 3;
    let topAtCol = 0;
    for (const e of topBar.el.querySelectorAll<HTMLElement>('.tb-pill, .tb-wx > *')) {
      const r = e.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.right > host.left + colX - colHalf && r.left < host.left + colX + colHalf) topAtCol = Math.max(topAtCol, r.bottom - host.top);
    }
    if (!errorChip.hidden) topAtCol = Math.max(topAtCol, errorChip.getBoundingClientRect().bottom - host.top);
    const fitsAt = (t: number): boolean => coverTop >= t + 8 + colH + 8 && (!toolsBeside || toolsTop >= t + 8 + colH + 8);
    const colBase = !fitsAt(top) && topAtCol < top && fitsAt(topAtCol) ? topAtCol : top;
    root.style.setProperty('--col-top', `${Math.round(colBase)}px`);
    const colBottom = colBase + 8 + colH;
    const colCovered = coverTop < colBottom + 8 && colX > left && colX < host.width - right;
    root.classList.toggle('fabs-crowded', colCovered);
    const crowded = !colCovered && toolsTop < colBottom + 8 && toolsBeside;
    root.classList.toggle('fab-crowded', crowded);

    // In a side-column layout (landscape) the closed dock is a slim tab strip at the bottom: a list must not cover its tabs.
    const dockR = sheet.el.hidden ? null : sheet.el.getBoundingClientRect();
    const slimDock = !!dockR && dockR.width > 0 && dockR.width < host.width * 0.6 && dockR.height < host.height * 0.4 ? dockR : null;
    const menus: { m: typeof toolsMenu; upward: boolean }[] = [
      { m: toolsMenu, upward: true },
      { m: viewMenu, upward: false },
    ];
    // The speed dial rises along the screen edge where the column of round buttons is: where the two would meet (a short
    // screen), the column steps aside while the dial is open; otherwise both stay (the View button still opens its card).
    const dialMeetsColumn = (): boolean => {
      if (!toolsMenu.isOpen()) return false;
      const lr = toolsMenu.list.getBoundingClientRect();
      const cr = fabColumn.getBoundingClientRect();
      if (!lr.width || !cr.width) return root.classList.contains('dial-over-fabs');
      return lr.top < cr.bottom + 8 && lr.right > cr.left - 8 && lr.left < cr.right + 8;
    };
    for (const { m, upward } of menus) {
      const r = m.fab.getBoundingClientRect();
      if (!r.width || getComputedStyle(m.el).display === 'none') continue;
      const onLeft = r.left + r.width / 2 < host.left + host.width / 2;
      // The speed dial rises above its button; the view card hangs beside its button, down to the bottom cover.
      const availH = upward ? r.top - host.top - top - 12 : host.bottom - bottom - r.top - 12;
      const availW = onLeft ? host.right - (upward ? r.left : r.right) - 16 : (upward ? r.right : r.left) - host.left - 16;
      m.fit(availH, availW);
      m.list.style.bottom = '';
      if (upward && slimDock && m.isOpen()) {
        const lr = m.list.getBoundingClientRect();
        if (lr.width > 0 && lr.right > slimDock.left && lr.left < slimDock.right && lr.bottom > slimDock.top) {
          const lift = Math.round(lr.bottom - slimDock.top + 6);
          m.list.style.bottom = `${lift}px`;
          m.fit(availH - lift, availW);
        }
      }
    }

    root.classList.toggle('dial-over-fabs', dialMeetsColumn());

    // The attribution line and the legend: at the bottom of the visible map, on the side away from the Tools button.
    const toolsVisible = toolsR.width > 0 && getComputedStyle(toolsMenu.el).display !== 'none' && !crowded;
    const toolsOnLeft = toolsR.left + toolsR.width / 2 < host.left + host.width / 2;
    let colL = left;
    let colR = host.width - right;
    if (toolsVisible) {
      if (toolsOnLeft) colL = Math.max(colL, toolsR.right - host.left);
      else colR = Math.min(colR, toolsR.left - host.left);
    }
    if (slimDock) {
      // The closed dock of a side-column layout: keep beside it, or above it if there is no room beside it.
      const dl = slimDock.left - host.left;
      const dr = slimDock.right - host.left;
      if (dl - colL > colR - dr) colR = Math.min(colR, dl);
      else colL = Math.max(colL, dr);
    }
    const base = slimDock ? strip : bottom;
    const cs = credit.style;
    cs.bottom = `${Math.round(base + 12)}px`;
    cs.left = `${Math.round(colL + 12)}px`;
    cs.maxWidth = `${Math.max(0, Math.round(colR - colL - 24))}px`;
    const creditH = credit.hidden ? 0 : credit.getBoundingClientRect().height;
    const ls = mapLegend.el.style;
    ls.top = 'auto';
    ls.bottom = `${Math.round(base + 12 + (creditH ? creditH + 8 : 0))}px`;
    ls.left = `${Math.round(colL + 12)}px`;
    ls.maxWidth = `${Math.max(0, Math.round(colR - colL - 24))}px`;
  };
  let insetRaf = 0;
  let insetTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleInsets(): void {
    cancelAnimationFrame(insetRaf);
    insetRaf = requestAnimationFrame(layoutInsets);
    // Once more after the panel / dock animations (0.2–0.25 s) have settled.
    clearTimeout(insetTimer);
    insetTimer = setTimeout(layoutInsets, 320);
  }
  const insetRo = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleInsets) : null;
  for (const e of [root, panelHost, sheet.el, topBar.el, scrubber.el, errorChip, credit, mapLegend.el]) insetRo?.observe(e);
  unsubs.push(
    () => {
      insetRo?.disconnect();
      cancelAnimationFrame(insetRaf);
      clearTimeout(insetTimer);
    },
    ui.subscribe(scheduleInsets, ['sheet', 'panelOpen', 'tool', 'menu', 'pending']), // 'pending': the Add / Clear bar grows the panel's foot
    session.state.subscribe(scheduleInsets, ['error']),
    layers.subscribe(renderCredit, ['imagery', 'vegetation', 'roads', 'fireTrails', 'homes', 'zones', 'placeNames', 'overlay', 'soloHeat']),
    // Portrait: a menu list rises above an open dock. Side columns (landscape): an open sheet fills the column where the
    // wide lists (the view card's columns, the dial's second column) spread, so opening a menu puts the sheet away (one
    // tap on a tab brings it back).
    ui.subscribe((s) => {
      if (!s.menu || s.sheet === 'closed') return;
      const host = sceneHost.getBoundingClientRect();
      const dockW = sheet.el.getBoundingClientRect().width;
      if (host.width && dockW > 0 && dockW < host.width * 0.6) ui.set({ sheet: 'closed' });
    }, ['menu']),
  );
  renderCredit();
  syncCompass();
  scheduleInsets();

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
      if (id === 'why') o.announce('Tap anywhere on the map to see why the fire behaves as it does there.');
      return;
    }
    ui.set({ tool: id, panelOpen: id !== 'why' || s.why !== null, pending: null, drawing: id === 'fire' ? s.fireInput === 'line' : false, menu: reduceMenu(s.menu, { type: 'pick' }) });
  }
  function closePanel(): void {
    ui.set({ tool: 'why', panelOpen: false, pending: null, drawing: false, why: null });
  }
  let panel: { el: HTMLElement; destroy(): void } | null = null;
  let panelKey = '';
  const renderPanel = (): void => {
    const s = ui.get();
    const key = s.panelOpen ? s.tool : '';
    toolsMenu.setPressed(s.tool);
    const t = TOOLS.find((x) => x.id === s.tool)!;
    toolsMenu.setCurrent(t.icon, t.label);
    layersFab.setAttribute('aria-pressed', String(s.tool === 'layers' && s.panelOpen));
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
    viewMenu.setPressed(s.viewMode);
    const vm = VIEW_MODES.find((x) => x.mode === s.viewMode)!;
    viewMenu.setCurrent(vm.icon, vm.label);
    // Brush preview for a pending brush tap.
    const p = s.pending;
    if (s.tool === 'fuel' && p?.kind === 'brush' && p.points.length === 1) view.setBrushPreview({ x: p.points[0]![0], y: p.points[0]![1], radius: p.radius, colour: presetById(s.fuelPreset).colour });
    else if (s.tool !== 'fuel' || !p) view.setBrushPreview(null);
    scheduleAnnotations();
  };
  unsubs.push(ui.subscribe(renderModes, ['drawing', 'tool', 'panelOpen', 'fireInput', 'pending', 'viewMode', 'why', 'wind', 'fuelPreset']));
  // A round menu's list opens over the strip of map the legend occupies: the legend steps aside while a menu is open.
  const renderMenuOpen = (): void => {
    const m = ui.get().menu;
    root.classList.toggle('menu-open', m !== null);
    if (m !== 'tools') root.classList.remove('dial-over-fabs');
  };
  unsubs.push(ui.subscribe(renderMenuOpen, ['menu']));
  renderMenuOpen();

  // ───────────── map taps ─────────────
  const downs = new Map<number, { x: number; y: number; t: number; glide: boolean; far: boolean }>();
  /** Pointers whose press only dismissed an open menu (that tap is not also a map tap). */
  const dismissing = new Set<number>();
  let multi = false;
  unsubs.push(
    // A press anywhere but inside the open menu collapses it (tap on the map, the dock, the top bar…).
    listen(
      root,
      'pointerdown',
      (e) => {
        const open = ui.get().menu;
        if (!open) return;
        const t = e.target as Node | null;
        // The menus handle their own presses (the other menu's button toggles, which also collapses this one).
        if (t && (toolsMenu.el.contains(t) || viewMenu.el.contains(t))) return;
        ui.set({ menu: reduceMenu(open, { type: 'map-tap' }) });
        if (t && sceneHost.contains(t)) dismissing.add(e.pointerId);
      },
      { capture: true },
    ),
    listen(
      sceneHost,
      'pointerdown',
      (e) => {
        // (this capture listener runs before the view's own: a flick of the map is still gliding if this press stops it)
        downs.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), glide: view.gliding, far: false });
        if (downs.size > 1) multi = true;
      },
      { capture: true },
    ),
    // A finger that wandered off by more than a tap's slop dragged the map, even if it came back to where it began.
    listen(
      sceneHost,
      'pointermove',
      (e) => {
        const d = downs.get(e.pointerId);
        if (d && !d.far && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 12) d.far = true;
      },
      { capture: true, passive: true },
    ),
    listen(
      sceneHost,
      'pointerup',
      (e) => {
        const d = downs.get(e.pointerId);
        downs.delete(e.pointerId);
        const wasMulti = multi;
        if (downs.size === 0) multi = false;
        const dismissed = dismissing.delete(e.pointerId);
        if (!d || wasMulti || dismissed || d.glide || d.far) return; // a touch that stopped a gliding map, or dragged it, is not a tap on it
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 12 || performance.now() - d.t > 700) return;
        onTap(e.clientX, e.clientY);
      },
      { capture: true },
    ),
    listen(sceneHost, 'pointercancel', (e) => void downs.delete(e.pointerId), { capture: true }),
    // A dismissing press that ends off the map must not swallow the next real tap.
    listen(window, 'pointerup', (e) => void dismissing.delete(e.pointerId)),
    listen(window, 'pointercancel', (e) => void dismissing.delete(e.pointerId)),
  );

  function onTap(cx: number, cy: number): void {
    const p = view.pickGround(cx, cy);
    if (!p) return;
    // Touching the map brings the map back: collapse an open dock panel.
    if (ui.get().sheet !== 'closed') ui.set({ sheet: 'closed' });
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


  // ───────────── new insight cards ─────────────
  // Cards never interrupt: the dock's Insights badge counts them (sheet.ts). The only reactions are opt-in settings: a
  // vibration and/or a pause on the first Danger card of a kind ("pause on danger" is OFF by default: when the user runs
  // the simulation they want it to run).
  unsubs.push(
    session.events.on('reveal', (i) => {
      const d = dangerGate.decide(i);
      if (d.notify && settingsStore.get().haptics) vibrate([220, 90, 220]);
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
      scheduleInsets();
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
      if (document.visibilityState === 'hidden' && (session.state.get().playing || session.state.get().seekTarget !== null)) {
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
      } else if (e.key === 'Escape') {
        // One layer per press, top-most first (the top-bar sheets handle their own Escape before this).
        closeTopLayer();
      }
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
    errorChip.hidden = !s.error;
    if (s.error) o.announce(`Simulation error: ${s.error}`);
  }, ['error']);
  unsubs.push(unsubErr);

  renderPanel();
  renderModes();

  /** Close the top-most open layer (Back / Escape); false when nothing was open. */
  function closeTopLayer(): boolean {
    const u = ui.get();
    const layer = backLayer({ popover: topBar.popovers.openId(), menu: u.menu, panelOpen: u.panelOpen, pending: !!u.pending, sheet: u.sheet });
    if (layer === 'popover') topBar.popovers.closeAll(false);
    else if (layer === 'menu') ui.set({ menu: reduceMenu(u.menu, { type: 'escape' }) });
    else if (layer === 'panel') closePanel();
    else if (layer === 'sheet') ui.set({ sheet: 'closed' });
    return layer !== null;
  }

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

  function showLayer(t: { overlay?: OverlayKind; sceneKey?: keyof LayerState }): void {
    let patch: Partial<LayerState> = {};
    if (t.overlay) patch.overlay = t.overlay;
    if (t.sceneKey && (SCENE_LAYER_KEYS as readonly string[]).includes(t.sceneKey)) patch = { ...patch, ...sceneLayerPatch(layers.get(), t.sceneKey as SceneLayerKey, true) };
    if (!Object.keys(patch).length) return;
    layers.set(patch);
    view.setLayers(patch);
    if (ui.get().panelOpen || ui.get().pending) closePanel();
    ui.set({ sheet: 'closed', menu: null });
    const name = t.overlay ? (layerForOverlay(t.overlay)?.title ?? t.overlay) : String(t.sceneKey);
    o.announce(`Showing ${name} on the map.`);
  }

  return { el: root, session, view, back: closeTopLayer, showLayer, setCovered: (covered) => view.setCovered?.(covered), destroy };
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

