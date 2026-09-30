/**
 * The Layers panel, Google-Maps style (a bottom sheet in portrait, the side column in landscape), built from the layer
 * catalog only (render/layerCatalog.ts through layersModel.ts, so a new catalog row shows up here by itself):
 *
 *   Map type     Aerial photo / Terrain colours / Plain (radio tiles)
 *   Map details  a tile per scene layer (roads, fire trails, homes, residential areas, names, trees, shrubs, flames, smoke,
 *                embers, wind streaks, insight markers ...): each switches on its own; a greyed tile says why it cannot
 *   Heat maps    every data layer that can colour the ground, grouped as the catalog groups them (collapsible), each with
 *                its colour ramp, unit and availability. One at a time: tapping one shows it, tapping it again turns it
 *                off; the one on show opens its legend, "Show on its own" (hides the photo and the trees), its strength and,
 *                for arrival time, the arrival-time lines. Roads, homes and shrubs have both a Show and a Heat map button.
 *   Trees        Natural / Simple / Coded (and what colours them, with the legend), and "Trees sway in the wind"
 *   Wind and air wind streaks, the vertical air slice (direction, centre, side view), vertical exaggeration
 *
 * Every row has an (i) button that opens the catalog text (what it shows, why it matters, source, how fine, how it is
 * drawn, availability) and a link to the data set behind it on the Data sets screen. Choices are remembered for the next
 * run (layersPrefs.ts). Nothing here pauses or steers the simulation.
 */
import { SNAPSHOT_LAYER_OVERLAYS, fromExternalLegend, legendFor, overlayLegend, rampGradient, type Legend } from '../../legends';
import { h, prefersReducedMotion, setChildren, uniqueId } from '../../dom';
import { icon, type IconName } from '../../icons';
import { kv, sectionHeader, setChipSelected, setTileSelected, tile, tileGrid, chip } from '../../primitives';
import { button, chipChoice, compassRose, segmented, slider, toggle } from '../../widgets';
import { LAYER_GROUP_BLURBS, availabilityContext, sceneLayerOn, type AvailabilityContext, type LayerGroup, type LayerInfo } from '../../../render/layerCatalog';
import type { LayerState, OverlayKind } from '../../../render/layers';
import { canopyCodeLegend, type CanopyCode } from '../../../render/canopyStyle';
import { placesLegend, type PlacesLayerId } from '../../../render/placesLegend';
import { has3dAtmosphere, type SimContext } from './context';
import {
  MAP_TYPES,
  availabilityOf,
  availabilitySignature,
  datasetsForLayer,
  defaultOpenGroups,
  heatPatch,
  heatSubline,
  infoRows,
  layerScenarioOf,
  mapTypeOf,
  mapTypePatch,
  panelPlan,
  scenePatch,
  tileCaption,
  type MapType,
} from './layersModel';
import { cachedLayerPrefs, forgetLayerPrefs, layerDefaults, rememberLayerChoice, viewHasImagery } from './layersPrefs';

/** Icon of a catalog row in the panel (decoration only; unknown ids get the layers icon). */
const LAYER_ICONS: Readonly<Record<string, IconName>> = {
  imagery: 'satellite',
  elevation: 'terrain',
  slope: 'terrain',
  aspect: 'compass',
  landform: 'terrain',
  insolation: 'sun',
  canopy3d: 'tree',
  canopyHeight: 'tree',
  canopyCover: 'tree',
  understorey: 'leaf',
  elevatedHazard: 'leaf',
  surfaceHazard: 'leaf',
  nearSurfaceHazard: 'leaf',
  barkHazard: 'ember',
  grassCuring: 'sun',
  fuelType: 'leaf',
  fuelLoad: 'bar-chart',
  timeSinceFire: 'history',
  fireHistoryKind: 'calendar',
  arrival: 'clock',
  ros: 'speed',
  intensity: 'flame',
  driver: 'why',
  moisture: 'droplet',
  windSpeed: 'wind',
  landing: 'ember',
  trench: 'terrain',
  attach: 'flame',
  vls: 'wind',
  dmz: 'danger',
  roads: 'road',
  fireTrails: 'route',
  homes: 'home',
  zones: 'polygon',
  placeNames: 'text',
  flames: 'flame',
  smoke: 'cloud',
  embers: 'ember',
  wind: 'wind',
  crossSection: 'chart',
  insightMarkers: 'info',
};
const iconOf = (id: string): IconName => LAYER_ICONS[id] ?? 'layers';

const MAP_TYPE_ICONS: Record<MapType, IconName> = { photo: 'satellite', terrain: 'terrain', plain: 'map' };

const CANOPY_CODE_LABELS: Record<CanopyCode, string> = { height: 'Height', cover: 'Cover', bark: 'Bark hazard', understorey: 'Shrub hazard' };

const PLACES_IDS = new Set<string>(['roads', 'fireTrails', 'homes', 'zones', 'placeNames']);

/** Legend element for an overlay (ramp bar with ticks, or class swatches with meanings). */
export function legendElement(l: Legend, testId = 'legend'): HTMLElement {
  const title = h('p', { class: 'legend-title' }, [h('strong', null, l.title), l.unit ? h('span', { class: 'legend-unit' }, ` (${l.unit})`) : null]);
  if (l.kind === 'ramp') {
    return h('div', { class: 'legend', dataset: { testid: testId } }, [
      title,
      h('div', { class: 'legend-ramp', style: { background: l.gradient ?? rampGradient(l.stops) } }),
      h(
        'div',
        { class: 'legend-ticks' },
        l.stops.map((s) => h('span', null, s.label)),
      ),
      l.extra?.length
        ? h(
            'ul',
            { class: 'legend-classes legend-extra' },
            l.extra.map((c) => h('li', null, [h('span', { class: 'swatch', style: { background: c.colour } }), h('span', { class: 'legend-label' }, c.label)])),
          )
        : null,
      l.about ? h('p', { class: 'legend-about' }, l.about) : null,
    ]);
  }
  return h('div', { class: 'legend', dataset: { testid: testId } }, [
    title,
    h(
      'ul',
      { class: 'legend-classes' },
      l.classes.map((c) => h('li', null, [h('span', { class: 'swatch', style: { background: c.colour } }), h('span', { class: 'legend-label' }, c.label), c.note ? h('span', { class: 'legend-note' }, c.note) : null])),
    ),
    l.about ? h('p', { class: 'legend-about' }, l.about) : null,
  ]);
}

/** Legend of the active overlay: the renderer's (exact colours and ranges) with the UI's teaching text, else the UI's. */
export function currentLegend(ctx: SimContext): Legend | null {
  const s = ctx.layers.get();
  const t = ctx.scenario.terrain;
  return overlayLegend(s.overlay, ctx.legendProvider, {
    arrivalMaxSeconds: Math.max(1800, ctx.session.state.get().viewTime),
    isochroneMinutes: s.isochroneMinutes,
    ...(Number.isFinite(t.minElevation) && Number.isFinite(t.maxElevation) ? { elevationRange: [t.minElevation, t.maxElevation] as const } : {}),
  });
}

/** CSS background of a heat map's swatch: its ramp, or its first class colours side by side. */
export function swatchBackground(l: Legend | null): string | null {
  if (!l) return null;
  if (l.kind === 'ramp') return l.gradient ?? rampGradient(l.stops);
  const cs = l.classes.slice(0, 6);
  if (!cs.length) return null;
  const w = 100 / cs.length;
  return `linear-gradient(to right, ${cs.map((c, i) => `${c.colour} ${(i * w).toFixed(1)}% ${((i + 1) * w).toFixed(1)}%`).join(', ')})`;
}

interface TileRef {
  info: LayerInfo;
  el: HTMLElement;
  main: HTMLButtonElement;
  cap: HTMLElement;
  infoBtn: HTMLButtonElement;
}

interface HeatRef {
  info: LayerInfo;
  li: HTMLElement;
  main: HTMLElement;
  sub: HTMLElement;
  heatBtn: HTMLButtonElement;
  showBtn: HTMLButtonElement | null;
  active: HTMLElement;
  infoBox: HTMLElement;
  infoBtn: HTMLButtonElement;
}

interface GroupRef {
  group: LayerGroup;
  head: HTMLButtonElement;
  body: HTMLElement;
  count: HTMLElement;
  rows: HeatRef[];
}

export function createLayersPanel(ctx: SimContext, onClose: () => void): { el: HTMLElement; destroy(): void } {
  const { layers, view } = ctx;
  const plan = panelPlan();
  const offs: (() => void)[] = [];
  const viewPlain = view as { setPlainGround?(on: boolean): void; plainGround?: boolean };
  const canPlain = typeof viewPlain.setPlainGround === 'function';
  let plain = canPlain ? !!viewPlain.plainGround : false;
  const hasImagery = viewHasImagery(ctx);

  // ── availability: the static facts once, the fire and the atmosphere as the run goes ──
  const base = availabilityContext({ fuel: ctx.scenario.fuel, context: ctx.scenario.context ?? null, hasImagery });
  const availNow = (): AvailabilityContext => {
    const st = ctx.session.state.get();
    // A fire exists once one is marked (or the run shows burnt ground); the first snapshot of a run comes before any fire.
    return { ...base, hasFire: st.ignitions.length > 0 || (st.snapshot?.stats?.burntAreaHa ?? 0) > 0, has3dAtmosphere: !!st.snapshot?.atmosphere };
  };
  let avail = availNow();
  let availSig = availabilitySignature(avail);
  let scenarioFacts = layerScenarioOf(ctx.scenario, ctx.session.state.get().snapshot);

  /**
   * Apply a layer change: the view first (so the store's subscribers, e.g. the map legend, read the view's new state:
   * the coded trees' legend comes from the view), then the store, and remember it as the user's choice.
   */
  const set = (p: Partial<LayerState>): void => {
    view.setLayers(p);
    layers.set(p);
    void rememberLayerChoice({ layers: p });
  };

  const body = h('div', { class: 'panel-body layers-body' });

  // ───────────── (i) expansions ─────────────
  const infoContent = (info: LayerInfo): HTMLElement[] => {
    const a = availabilityOf(info, avail);
    const rows = infoRows(info, scenarioFacts, a);
    const out: HTMLElement[] = [kv(rows.map((r) => ({ key: r.key, value: r.value })), { layout: 'stack', label: `About ${info.title}` })];
    if (PLACES_IDS.has(info.id)) {
      const groups = placesLegend({ [info.id]: true } as Partial<Record<PlacesLayerId, boolean>>, ctx.scenario.context ?? null);
      const entries = groups.flatMap((g) => g.entries);
      if (entries.length) {
        out.push(
          h(
            'div',
            { class: 'lp-legend-chips', attrs: { role: 'list' }, aria: { label: `${info.title}: what the map shows` } },
            entries.map((e) =>
              h('span', { class: 'legend-chip', attrs: { role: 'listitem' } }, [
                h('span', { class: ['swatch', `lp-swatch-${e.swatch}`], style: { background: e.colour, ...(e.outline ? { borderColor: e.outline } : {}) } }),
                e.label,
              ]),
            ),
          ),
        );
      }
    }
    const ds = datasetsForLayer(info, ctx.scenario.datasets);
    if (ctx.openDatasets && ds.length) {
      out.push(
        h(
          'div',
          { class: 'lp-links' },
          ds.slice(0, 2).map((d) =>
            button({
              label: `Data set details: ${d.title}`,
              icon: 'database',
              variant: 'text',
              size: 'sm',
              class: 'lp-link',
              testId: `layer-dataset-${info.id}${ds.length > 1 ? `-${d.id}` : ''}`,
              onClick: () => ctx.openDatasets?.(d.id),
            }),
          ),
        ),
      );
    }
    return out;
  };
  const infoButton = (label: string, controls: string, onClick: () => void, testId: string): HTMLButtonElement =>
    h(
      'button',
      { type: 'button', class: 'icon-btn lp-info-btn', attrs: { 'aria-expanded': 'false', 'aria-controls': controls }, aria: { label: `About ${label}` }, dataset: { testid: testId }, on: { click: onClick } },
      icon('info'),
    );
  const setExpanded = (btn: HTMLButtonElement, box: HTMLElement, open: boolean, fill: () => HTMLElement[]): void => {
    btn.setAttribute('aria-expanded', String(open));
    btn.classList.toggle('is-selected', open);
    box.hidden = !open;
    setChildren(box, open ? fill() : null);
  };

  // ───────────── Map type ─────────────
  const mapInfoId = uniqueId('lp-info');
  const mapInfo = h('div', { class: 'lp-info', id: mapInfoId, hidden: true, dataset: { testid: 'layer-info-maptype' } });
  const mapTiles = new Map<MapType, HTMLButtonElement>();
  const photoInfo = plan.mapType;
  for (const m of MAP_TYPES) {
    if (m.id === 'plain' && !canPlain) continue;
    const t = tile({
      label: m.label,
      icon: MAP_TYPE_ICONS[m.id],
      caption: m.caption,
      mode: 'radio',
      testId: `maptype-${m.id}`,
      onClick: () => chooseMapType(m.id),
    });
    t.dataset.maptype = m.id;
    if (m.id === 'photo' && photoInfo) t.dataset.layer = photoInfo.id;
    mapTiles.set(m.id, t);
  }
  const mapGrid = tileGrid([...mapTiles.values()], { cols: 3, label: 'Map type', radio: true });
  mapGrid.classList.add('lp-maptypes');
  const mapInfoBtn = infoButton('the map types', mapInfoId, () => setExpanded(mapInfoBtn, mapInfo, mapInfo.hidden, mapTypeInfo), 'layer-info-btn-maptype');
  const mapTypeInfo = (): HTMLElement[] => [
    ...(photoInfo ? infoContent(photoInfo) : []),
    kv(
      [
        { key: 'Terrain colours', value: 'The ground painted by vegetation type from the vegetation map, with the relief shading of the 3-D ground.' },
        ...(canPlain ? [{ key: 'Plain', value: 'Grey relief only: the shape of the land with nothing painted on it. The clearest base for a heat map.' }] : []),
      ],
      { layout: 'stack', label: 'Without the photo' },
    ),
  ];
  function chooseMapType(t: MapType): void {
    if (t === 'photo' && !hasImagery) return;
    const p = mapTypePatch(t);
    plain = p.plain;
    viewPlain.setPlainGround?.(p.plain);
    set(p.layers);
    void rememberLayerChoice({ plainGround: p.plain });
    renderMapType();
  }
  const renderMapType = (): void => {
    const cur = mapTypeOf(layers.get(), plain, hasImagery);
    for (const [id, t] of mapTiles) {
      setTileSelected(t, id === cur);
      if (id === 'photo') {
        const a = photoInfo ? availabilityOf(photoInfo, avail) : { ok: hasImagery };
        t.disabled = !a.ok;
        const cap = t.querySelector('.tile-cap');
        if (cap) cap.textContent = a.ok ? (MAP_TYPES.find((m) => m.id === 'photo')?.caption ?? '') : (a.reason ?? 'Not available here');
      }
    }
  };
  const mapSection = h('section', { class: 'lp-section', aria: { label: 'Map type' } }, [h('div', { class: 'lp-head' }, [sectionHeader('Map type'), mapInfoBtn]), mapGrid, mapInfo]);

  // ───────────── Map details (scene tiles) ─────────────
  const tileInfo = h('div', { class: 'lp-info', id: uniqueId('lp-info'), hidden: true, dataset: { testid: 'layer-info-tiles' } });
  let tileInfoFor: string | null = null;
  const tiles: TileRef[] = plan.tiles.map((info) => {
    const capId = uniqueId('lp-cap');
    const cap = h('span', { class: 'lp-tile-cap', id: capId });
    const main = h(
      'button',
      { type: 'button', class: 'lp-tile-main', attrs: { 'aria-pressed': 'false', 'aria-describedby': capId }, dataset: { testid: `layer-${info.id}` }, on: { click: () => onTile(ref) } },
      [h('span', { class: 'lp-thumb', aria: { hidden: true } }, icon(iconOf(info.id))), h('span', { class: 'lp-tile-text' }, [h('span', { class: 'lp-tile-label' }, info.title), cap])],
    );
    const infoBtn = infoButton(info.title, tileInfo.id, () => toggleTileInfo(ref), `layer-info-btn-${info.id}`);
    const el = h('div', { class: 'lp-tile', dataset: { layer: info.id, kind: info.kind } }, [main, infoBtn]);
    const ref: TileRef = { info, el, main, cap, infoBtn };
    return ref;
  });
  function onTile(t: TileRef): void {
    const a = availabilityOf(t.info, avail);
    if (!a.ok) {
      // A greyed-out tile explains itself instead of switching.
      if (tileInfoFor !== t.info.id) toggleTileInfo(t);
      return;
    }
    set(scenePatch(layers.get(), t.info.scene!));
  }
  function toggleTileInfo(t: TileRef): void {
    const open = tileInfoFor !== t.info.id;
    for (const o of tiles) {
      o.infoBtn.setAttribute('aria-expanded', 'false');
      o.infoBtn.classList.remove('is-selected');
    }
    tileInfoFor = open ? t.info.id : null;
    setExpanded(t.infoBtn, tileInfo, open, () => [h('h4', { class: 'lp-info-title' }, t.info.title), ...infoContent(t.info)]);
    if (open) tileInfo.dataset.layer = t.info.id;
  }
  const renderTiles = (): void => {
    const s = layers.get();
    for (const t of tiles) {
      const on = sceneLayerOn(s, t.info.scene!);
      const a = availabilityOf(t.info, avail);
      // A greyed-out tile stays operable (a tap explains why it cannot be shown); its status line says so to everyone.
      t.main.setAttribute('aria-pressed', String(on && a.ok));
      t.el.classList.toggle('is-on', on && a.ok);
      t.el.classList.toggle('is-unavailable', !a.ok);
      t.cap.textContent = tileCaption(on, a);
    }
  };
  const tilesEl = h(
    'div',
    { class: 'lp-tiles', attrs: { role: 'group' }, aria: { label: 'Map details' } },
    tiles.map((t) => t.el),
  );
  const detailsSection = h('section', { class: 'lp-section', aria: { label: 'Map details' } }, [sectionHeader('Map details'), tilesEl, tileInfo]);
  // Two columns of tiles unless a label's longest word does not fit one (large text, high contrast, narrow phones): then one.
  let tilesW = -1;
  const fitTiles = (): void => {
    const w = tilesEl.clientWidth;
    if (!w || w === tilesW) return;
    tilesW = w;
    tilesEl.classList.remove('is-1col');
    const tooLong = tiles.some((t) => {
      const l = t.main.querySelector<HTMLElement>('.lp-tile-label');
      return !!l && l.scrollWidth > l.clientWidth + 1;
    });
    tilesEl.classList.toggle('is-1col', tooLong);
  };
  const tilesRo = typeof ResizeObserver === 'function' ? new ResizeObserver(() => fitTiles()) : null;
  tilesRo?.observe(tilesEl);
  offs.push(() => tilesRo?.disconnect());

  // ───────────── Heat maps ─────────────
  const legendRequest = (): { arrivalMaxSeconds: number; isochroneMinutes: number; elevationRange?: readonly [number, number] } => {
    const t = ctx.scenario.terrain;
    return {
      arrivalMaxSeconds: Math.max(1800, ctx.session.state.get().viewTime),
      isochroneMinutes: layers.get().isochroneMinutes,
      ...(Number.isFinite(t.minElevation) && Number.isFinite(t.maxElevation) ? { elevationRange: [t.minElevation, t.maxElevation] as const } : {}),
    };
  };
  const saved = cachedLayerPrefs()?.groups;
  const openGroups = defaultOpenGroups(plan.heat, avail, layers.get().overlay, saved);
  const heatRows: HeatRef[] = [];
  const groups: GroupRef[] = plan.heat.map((g) => {
    const bodyId = uniqueId('lp-grp');
    const count = h('span', { class: 'lp-group-count' });
    const head = h(
      'button',
      {
        type: 'button',
        class: 'lp-group-head',
        attrs: { 'aria-expanded': String(openGroups.has(g.group)), 'aria-controls': bodyId },
        dataset: { testid: `layer-group-${g.group.toLowerCase().replace(/[^a-z]+/g, '-')}` },
        on: { click: () => toggleGroup(ref) },
      },
      [h('span', { class: 'lp-group-text' }, [h('span', { class: 'lp-group-title' }, g.group), count]), icon('chevron-down', { class: 'lp-group-chev' })],
    );
    const rows = g.rows.map((info) => heatRow(info));
    heatRows.push(...rows);
    const groupBody = h('div', { class: 'lp-group-body', id: bodyId, hidden: !openGroups.has(g.group) }, [
      h('p', { class: 'lp-group-blurb' }, LAYER_GROUP_BLURBS[g.group]),
      h(
        'ul',
        { class: 'list lp-heat-list' },
        rows.map((r) => r.li),
      ),
    ]);
    const ref: GroupRef = { group: g.group, head, body: groupBody, count, rows };
    return ref;
  });
  function toggleGroup(g: GroupRef): void {
    const open = g.body.hidden;
    g.body.hidden = !open;
    g.head.setAttribute('aria-expanded', String(open));
    void rememberLayerChoice({ groups: { [g.group]: open } });
  }

  function heatRow(info: LayerInfo): HeatRef {
    const overlay = info.heat!.overlay;
    const legend = legendFor(overlay);
    const sw = swatchBackground(overlayLegend(overlay, ctx.legendProvider, legendRequest()) ?? legend);
    const sub = h('span', { class: 'lp-heat-sub' });
    const text = h('span', { class: 'lp-heat-text' }, [h('span', { class: 'lp-heat-title' }, info.title), sub]);
    const swatch = h('span', { class: 'lp-swatch', style: sw ? { background: sw } : undefined, aria: { hidden: true } });
    const infoId = uniqueId('lp-info');
    const infoBox = h('div', { class: 'lp-info', id: infoId, hidden: true, dataset: { testid: `heat-info-${info.id}` } });
    const active = h('div', { class: 'lp-active', hidden: true });
    let main: HTMLElement;
    let heatBtn: HTMLButtonElement;
    let showBtn: HTMLButtonElement | null = null;
    if (info.kind === 'both' && info.scene) {
      main = h('div', { class: 'lp-heat-main is-static' }, [swatch, text]);
      showBtn = chip({ label: 'Show', kind: 'filter', testId: `layer-${info.id}-show`, onToggle: () => onShow(ref) }) as HTMLButtonElement;
      heatBtn = chip({ label: 'Heat map', kind: 'filter', testId: `overlay-${overlay}`, onToggle: () => onHeat(ref) }) as HTMLButtonElement;
      showBtn.setAttribute('aria-label', `Show ${info.title} on the map`);
      heatBtn.setAttribute('aria-label', `${info.title} as a heat map`);
    } else {
      heatBtn = h('button', { type: 'button', class: 'lp-heat-main', attrs: { 'aria-pressed': 'false' }, dataset: { testid: `overlay-${overlay}`, overlay }, on: { click: () => onHeat(ref) } }, [
        swatch,
        text,
        h('span', { class: 'lp-heat-check', aria: { hidden: true } }, icon('check')),
      ]);
      main = heatBtn;
    }
    heatBtn.dataset.overlay = overlay;
    const infoBtn = infoButton(info.title, infoId, () => setExpanded(infoBtn, infoBox, infoBox.hidden, () => infoContent(info)), `heat-info-btn-${info.id}`);
    const row = h('div', { class: 'lp-heat-row' }, [main, showBtn || heatBtn !== main ? h('span', { class: 'lp-both' }, [showBtn, heatBtn]) : null, infoBtn]);
    const li = h('li', { class: 'lp-heat', dataset: { layer: info.id, kind: info.kind } }, [row, active, infoBox]);
    const ref: HeatRef = { info, li, main, sub, heatBtn, showBtn, active, infoBox, infoBtn };
    return ref;
  }

  const scrollAnchor = (el: HTMLElement, change: () => void): void => {
    const before = el.getBoundingClientRect().top;
    change();
    const after = el.getBoundingClientRect().top;
    if (Math.abs(after - before) > 1) body.scrollTop += after - before;
  };
  function onHeat(r: HeatRef): void {
    const a = availabilityOf(r.info, avail);
    if (!a.ok) {
      renderHeat();
      if (r.infoBox.hidden) setExpanded(r.infoBtn, r.infoBox, true, () => infoContent(r.info));
      return;
    }
    scrollAnchor(r.li, () => set(heatPatch(layers.get(), r.info.heat!.overlay)));
    // The legend and controls of the map just switched on come into view (the list scrolls, the map does not move).
    if (!r.active.hidden) r.active.scrollIntoView?.({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }
  function onShow(r: HeatRef): void {
    const a = availabilityOf(r.info, avail);
    if (!a.ok) {
      renderHeat();
      return;
    }
    set(scenePatch(layers.get(), r.info.scene!));
  }

  // The legend and controls of the heat map on show (rebuilt when it changes).
  let activeKey = '';
  const activeControls = (overlay: OverlayKind): HTMLElement[] => {
    const s = layers.get();
    const l = currentLegend(ctx);
    const snapLayers = ctx.session.state.get().snapshot?.layers as Record<string, unknown> | undefined;
    const missing = SNAPSHOT_LAYER_OVERLAYS.has(overlay) && !snapLayers?.[overlay];
    const out: HTMLElement[] = [];
    if (l) out.push(legendElement(l));
    if (missing) out.push(h('p', { class: 'callout callout-info' }, [icon('info'), h('span', null, 'The simulation computes this map as the fire runs; it appears once there is fire and the engine provides it (not in the demo engine).')]));
    out.push(
      toggle({
        label: 'Show on its own',
        description: 'Hides the aerial photo and the 3-D trees so the colours stand alone on plain ground',
        checked: s.soloHeat,
        testId: 'solo-heat',
        onChange: (v) => set({ soloHeat: v }),
      }).el,
      slider({ label: 'Heat map strength', min: 0.2, max: 1, step: 0.05, value: s.overlayOpacity, format: (v) => `${Math.round(v * 100)}%`, testId: 'overlay-opacity', onInput: (v) => set({ overlayOpacity: v }) }).el,
    );
    if (overlay === 'arrival') {
      out.push(
        segmented<'0' | '15' | '30' | '60'>({
          label: 'Arrival-time lines',
          options: [
            { value: '0', label: 'Off' },
            { value: '15', label: '15 min' },
            { value: '30', label: '30 min' },
            { value: '60', label: '1 h' },
          ],
          value: String(s.isochroneMinutes) as '0' | '15' | '30' | '60',
          testId: 'isochrones',
          onChange: (v) => set({ isochroneMinutes: Number(v) }),
        }).el,
      );
    }
    return out;
  };
  const renderActive = (force = false): void => {
    const s = layers.get();
    const vt = ctx.session.state.get().viewTime;
    const key = `${s.overlay}|${s.overlay === 'arrival' ? `${s.isochroneMinutes}|${Math.floor(vt / 1800)}` : ''}|${s.overlay !== 'none' && SNAPSHOT_LAYER_OVERLAYS.has(s.overlay) ? !!ctx.session.state.get().snapshot?.layers : ''}`;
    if (key === activeKey && !force) return;
    const prevOverlay = activeKey.split('|')[0];
    activeKey = key;
    for (const r of heatRows) {
      const on = r.info.heat!.overlay === s.overlay;
      if (!on) {
        if (!r.active.hidden) {
          r.active.hidden = true;
          setChildren(r.active, null);
        }
        continue;
      }
      // Rebuilding the same heat map's controls (the arrival ramp grows) keeps the slider and switch where they are.
      if (prevOverlay === s.overlay && !force) {
        const lg = r.active.querySelector('[data-testid="legend"]');
        const l = currentLegend(ctx);
        if (lg && l) lg.replaceWith(legendElement(l));
        continue;
      }
      r.active.hidden = false;
      setChildren(r.active, activeControls(s.overlay));
    }
  };
  const renderHeat = (): void => {
    const s = layers.get();
    for (const r of heatRows) {
      const a = availabilityOf(r.info, avail);
      const on = r.info.heat!.overlay === s.overlay;
      if (r.showBtn) {
        // The Show / Heat map pair cannot be used without the data (the row's second line and its (i) say why).
        setChipSelected(r.heatBtn, on);
        setChipSelected(r.showBtn, sceneLayerOn(s, r.info.scene!) && a.ok);
        r.heatBtn.disabled = !a.ok;
        r.showBtn.disabled = !a.ok;
      } else r.heatBtn.setAttribute('aria-pressed', String(on)); // a greyed-out row stays operable: a tap explains why
      r.li.classList.toggle('is-on', on);
      r.li.classList.toggle('is-unavailable', !a.ok);
      // A row with both forms says what its heat map shows ("Heat map: Distance to nearest road or trail, in metres").
      const hl = r.showBtn && a.ok ? legendFor(r.info.heat!.overlay) : null;
      const line = heatSubline(r.info, a);
      r.sub.textContent = hl ? `Heat map: ${hl.title}, ${line.charAt(0).toLowerCase()}${line.slice(1)}` : line;
    }
    for (const g of groups) {
      const shown = g.rows.find((r) => r.info.heat!.overlay === s.overlay);
      const usable = g.rows.filter((r) => availabilityOf(r.info, avail).ok).length;
      g.count.textContent = shown ? `Showing: ${shown.info.title}` : usable === g.rows.length ? `${g.rows.length} maps` : `${usable} of ${g.rows.length} maps available`;
      // The group of the map on show is opened, so its legend and controls are never hidden.
      if (shown && g.body.hidden) {
        g.body.hidden = false;
        g.head.setAttribute('aria-expanded', 'true');
      }
    }
    renderActive();
  };
  const heatSection = h('section', { class: 'lp-section', aria: { label: 'Heat maps' } }, [
    sectionHeader('Heat maps'),
    h('p', { class: 'hint lp-hint' }, 'Colour the ground with one data set at a time. Tap a map to show it, tap it again to turn it off.'),
    ...groups.map((g) => h('div', { class: 'lp-group', dataset: { group: g.group } }, [g.head, g.body])),
  ]);

  // ───────────── Trees ─────────────
  const style = segmented<LayerState['canopyStyle']>({
    label: 'How the trees are drawn',
    options: [
      { value: 'natural', label: 'Natural', sub: 'Real shapes and bark' },
      { value: 'simple', label: 'Simple', sub: 'Clean shapes' },
      { value: 'coded', label: 'Coded', sub: 'Coloured by a measure' },
    ],
    value: layers.get().canopyStyle,
    testId: 'canopy-style',
    onChange: (v) => set({ canopyStyle: v }),
  });
  const code = chipChoice<CanopyCode>({
    label: 'Colour the trees by',
    options: (Object.keys(CANOPY_CODE_LABELS) as CanopyCode[]).map((c) => ({ value: c, label: CANOPY_CODE_LABELS[c] })),
    value: layers.get().canopyCode,
    testId: 'canopy-code',
    onChange: (v) => set({ canopyCode: v }),
  });
  const codeLegend = h('div', { class: 'lp-code-legend' });
  const codeBox = h('div', { class: 'lp-code', hidden: true }, [code.el, codeLegend]);
  const sway = toggle({
    label: 'Trees sway in the wind',
    description: 'Keeps the picture moving, which uses more battery',
    checked: layers.get().windSway,
    testId: 'wind-sway',
    onChange: (v) => set({ windSway: v }),
  });
  const treesOff = h('p', { class: 'hint', hidden: true }, 'The 3-D trees are switched off: turn on “3-D canopy” in Map details to see these choices.');
  const renderTrees = (): void => {
    const s = layers.get();
    style.set(s.canopyStyle);
    code.set(s.canopyCode);
    sway.set(s.windSway);
    codeBox.hidden = s.canopyStyle !== 'coded';
    treesOff.hidden = s.vegetation;
    if (s.canopyStyle === 'coded') {
      // What colours the trees: the 3-D view's own legend when it has one, else the same code table it uses.
      const spec = (view as { canopyLegend?(): ReturnType<typeof canopyCodeLegend> | null }).canopyLegend?.() ?? canopyCodeLegend(s.canopyCode);
      setChildren(codeLegend, legendElement(fromExternalLegend(spec, null), 'canopy-legend'));
    } else setChildren(codeLegend, null);
  };
  const treesSection = h('section', { class: 'lp-section', aria: { label: 'Trees' } }, [sectionHeader('Trees'), treesOff, style.el, codeBox, sway.el]);

  // ───────────── Wind and air, 3-D view ─────────────
  const wind = segmented<LayerState['wind']>({
    label: 'Wind streaks',
    options: [
      { value: 'off', label: 'Off' },
      { value: 'surface', label: 'Near the ground' },
      { value: 'volume', label: 'Through the plume' },
    ],
    value: layers.get().wind,
    testId: 'wind-layer',
    onChange: (v) => set({ wind: v }),
  });
  // The fast tier (auto-tune on slower devices) has no 3-D atmosphere: offer the switch where it matters.
  const need3d = h('div', { class: 'callout callout-info need-3d', hidden: true, dataset: { testid: 'need-3d' } });
  const renderNeed3d = (): void => {
    const l = layers.get();
    const snap = ctx.session.state.get().snapshot;
    const wants = l.crossSection.enabled || l.wind === 'volume';
    need3d.hidden = !wants || !snap || has3dAtmosphere(snap);
    if (need3d.hidden || need3d.childElementCount) return;
    setChildren(need3d, [
      icon('info'),
      h('div', null, [
        h('p', null, 'This run uses the fast surface-wind model (picked for this device’s speed), so there is no 3-D plume or cold air to slice through.'),
        button({
          label: 'Use the 3-D atmosphere',
          icon: 'cube',
          variant: 'secondary',
          testId: 'use-3d',
          onClick: () => {
            ctx.session.controller.setQuality('standard');
            setChildren(need3d, [icon('info'), h('p', null, 'Re-computing with the 3-D atmosphere from the last checkpoint… press Play to continue.')]);
            ctx.announce('Switching to the 3-D atmosphere. The simulation re-computes from the last checkpoint.');
          },
        }),
      ]),
    ]);
  };
  const csBox = h('div', { class: 'cs-box' });
  const csInfo = plan.switches.find((l) => l.scene === 'crossSection');
  const csToggle = toggle({
    label: csInfo?.title ?? 'Vertical air slice',
    description: 'Slice through the atmosphere: warm plume, cold air pools and wind arrows',
    checked: layers.get().crossSection.enabled,
    testId: 'cross-section',
    onChange: (v) => {
      set({ crossSection: { ...layers.get().crossSection, enabled: v, centre: v ? fireCentre(ctx) : layers.get().crossSection.centre } });
      renderCs();
    },
  });
  const renderCs = (): void => {
    const cs = layers.get().crossSection;
    csToggle.set(cs.enabled);
    csBox.hidden = !cs.enabled;
    if (!cs.enabled || csBox.childElementCount) return;
    setChildren(csBox, [
      compassRose({ label: 'Section direction', mode: 'towards', value: cs.azimuth, size: 170, onChange: (d) => set({ crossSection: { ...layers.get().crossSection, azimuth: d } }) }).el,
      h('div', { class: 'row-actions' }, [
        button({ label: 'Centre on the fire', icon: 'target', variant: 'secondary', onClick: () => set({ crossSection: { ...layers.get().crossSection, centre: fireCentre(ctx) } }) }),
        ctx.view.viewSection
          ? button({
              label: 'View from the side',
              icon: 'eye',
              variant: 'secondary',
              testId: 'cs-view',
              onClick: () => {
                ctx.ui.set({ viewMode: 'orbit' });
                ctx.view.viewSection?.();
                ctx.announce('Looking at the cross-section from the side.');
              },
            })
          : null,
      ]),
    ]);
  };
  const switchRows = plan.switches.map((info) => {
    const infoId = uniqueId('lp-info');
    const box = h('div', { class: 'lp-info', id: infoId, hidden: true, dataset: { testid: `layer-info-${info.id}` } });
    const b = infoButton(info.title, infoId, () => setExpanded(b, box, box.hidden, () => infoContent(info)), `layer-info-btn-${info.id}`);
    const control = info.scene === 'crossSection' ? csToggle.el : toggle({ label: info.title, checked: sceneLayerOn(layers.get(), info.scene!), onChange: (v) => set({ [info.scene!]: v } as Partial<LayerState>) }).el;
    return h('div', { class: 'lp-switch', dataset: { layer: info.id, kind: info.kind } }, [h('div', { class: 'lp-switch-row' }, [control, b]), box]);
  });
  const vex = slider({
    label: 'Vertical exaggeration',
    min: 1,
    max: 3,
    step: 0.25,
    value: layers.get().verticalExaggeration,
    format: (v) => `×${v}`,
    testId: 'vertical-exaggeration',
    hint: 'Heights are stretched to make the terrain easier to read. Slope numbers and fire speeds always use the true slope.',
    onInput: (v) => set({ verticalExaggeration: v }),
  });
  const airSection = h('section', { class: 'lp-section', aria: { label: 'Wind and air' } }, [sectionHeader('Wind and air'), wind.el, ...switchRows, need3d, csBox, vex.el]);

  // ───────────── Reset ─────────────
  const reset = button({
    label: 'Reset layers',
    icon: 'undo',
    variant: 'text',
    testId: 'layers-reset',
    onClick: () => {
      const quality = (view as { renderQuality?: 'low' | 'medium' | 'high' }).renderQuality;
      const d = layerDefaults({ performance: ctx.settings.get().performance, ...(quality ? { renderQuality: quality } : {}), hasImagery });
      const cur = layers.get();
      const patch: Partial<LayerState> = { ...d, crossSection: { ...cur.crossSection, enabled: false } };
      view.setLayers(patch);
      layers.set(patch);
      plain = false;
      viewPlain.setPlainGround?.(false);
      void forgetLayerPrefs();
      renderAll();
      ctx.announce('Layers reset to the defaults for this device.');
    },
  });

  setChildren(body, [mapSection, detailsSection, heatSection, treesSection, airSection, h('div', { class: 'lp-foot' }, reset)]);

  const el = h('section', { class: 'tool-panel layers-panel', dataset: { testid: 'layers-panel' }, aria: { label: 'Layers' } }, [
    h('header', { class: 'panel-head' }, [
      h('h2', { class: 'panel-title' }, [icon('layers'), 'Layers']),
      h('button', { type: 'button', class: 'btn btn-ghost btn-icon', aria: { label: 'Close' }, on: { click: onClose } }, icon('close')),
    ]),
    body,
  ]);

  const renderAll = (): void => {
    renderMapType();
    renderTiles();
    renderHeat();
    renderActive(true);
    renderTrees();
    wind.set(layers.get().wind);
    vex.set(layers.get().verticalExaggeration);
    renderCs();
    renderNeed3d();
  };

  offs.push(
    layers.subscribe(() => {
      renderMapType();
      renderTiles();
      renderHeat();
    }, ['imagery', 'vegetation', 'understorey', 'flames', 'smoke', 'embers', 'wind', 'insightMarkers', 'roads', 'fireTrails', 'homes', 'zones', 'placeNames', 'overlay']),
    // The arrival-time lines change the legend only: the controls (and the keyboard focus on them) stay.
    layers.subscribe(() => renderActive(), ['isochroneMinutes']),
    layers.subscribe(renderTrees, ['canopyStyle', 'canopyCode', 'windSway', 'vegetation', 'soloHeat', 'overlay']),
    layers.subscribe(() => wind.set(layers.get().wind), ['wind']),
    layers.subscribe(renderNeed3d, ['crossSection', 'wind']),
    layers.subscribe(renderCs, ['crossSection']),
    ctx.session.state.subscribe(() => {
      const next = availNow();
      const sig = availabilitySignature(next);
      avail = next;
      if (sig !== availSig) {
        availSig = sig;
        scenarioFacts = layerScenarioOf(ctx.scenario, ctx.session.state.get().snapshot);
        renderMapType();
        renderTiles();
        renderHeat();
      }
      renderActive();
      const was = need3d.hidden;
      renderNeed3d();
      // Once the 3-D snapshots arrive, forget the old message so it can be shown again later if needed.
      if (need3d.hidden && !was) setChildren(need3d, null);
    }, ['snapshot', 'ignitions']),
    ctx.session.state.subscribe(() => renderActive(), ['viewTime']),
  );
  renderAll();

  return {
    el,
    destroy() {
      for (const u of offs) u();
    },
  };
}

function fireCentre(ctx: SimContext): [number, number] {
  const ign = ctx.session.state.get().ignitions;
  if (!ign.length) return [0, 0];
  const p = ign[ign.length - 1]!.points[0]!;
  return [p[0], p[1]];
}
