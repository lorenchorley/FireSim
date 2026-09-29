/**
 * Render dev harness (served by Vite at /src/render/dev.html).
 *
 * Loads a bundled demo site (NSW 5 m LiDAR DEM → terrain, bundled canopy → a fabricated fuel map, aerial imagery),
 * then plays a SYNTHETIC fire (devScenario.ts) through SceneView so every layer can be inspected and screenshotted.
 *
 * URL parameters (all optional):
 *   site=katoomba  cell=20  t=10800 (s)  start=13 (local hour)  view=orbit|top|ground  overlay=<OverlayKind>
 *   wind=off|surface|volume  cross=1  crossAz=<deg>  imagery=0|1  veg=0|1  vex=1  iso=30  hud=0  play=1
 *   cam=x,y,dist,az,tilt (camera target & pose)  user=x,y,heading  quality=low|medium|high  focus=1
 *   smoke=0 flames=0 embers=0 legend=0 dpr=<fixed dpr>  arrows=1  brush=x,y,radius  crossAt=x,y
 *   Places layers (bundled NSW context, see src/data/contextLayers.ts): context=1 loads them (also implied by any of
 *   roads= fireTrails= homes= zones= names= being given), each 0|1 switches a layer (defaults: roads, fireTrails and
 *   names on, homes and zones off); town=<place name> aims the camera at a place, with d=<distance m> az=<deg>
 *   tilt=<deg> (defaults 1800, 200, 55); start=22 gives the night theme.
 */
import { makeGridSpec } from '../core/grid';
import type { SimSnapshot } from '../core/types';
import { DEMO_SITES, loadBundledContext, loadCanopy, loadElevation, setAssetBase } from '../data';
import type { ContextLayers } from '../core/places';
import { buildTerrain } from '../terrain';
import { loadDemoImagery } from './demoAssets';
import { fabricateFuel, SyntheticFire } from './devScenario';
import { fireCentroid } from './fields';
import type { OverlayKind } from './layers';
import { crossSectionLegend } from './legends';
import { SceneView } from './SceneView';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number): number => (q.has(k) ? Number(q.get(k)) : d);
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

declare global {
  interface Window {
    __fs?: { view: SceneView; fire: SyntheticFire; ready: boolean; setTime(t: number): void; error?: string };
  }
}

async function main(): Promise<void> {
  setAssetBase(`${location.origin}/`);
  const siteId = q.get('site') ?? 'katoomba';
  const site = DEMO_SITES.find((s) => s.id === siteId) ?? DEMO_SITES[0]!;
  const cell = num('cell', 20);
  const extent = 9000;

  // Terrain: src/data prefers the bundled NSW 5 m LiDAR bare-earth DTM, else the SRTM Terrarium tiles.
  const elev = await loadElevation({ centre: site.centre, extent, cellSize: cell, demoSiteId: site.id });
  const terrain = buildTerrain(elev.grid, elev.elevation, elev.source);

  // Fuel on a 30 m fire grid from the bundled canopy.
  const fuelGrid = makeGridSpec(site.centre, extent, 30);
  const canopy = await loadCanopy(fuelGrid, { demoSiteId: site.id });
  const fuel = fabricateFuel(terrain, fuelGrid, canopy);
  const imagery = await loadDemoImagery(site.id, { grid: terrain.grid }).catch(() => null);
  // Places context (roads, fire trails, homes, zones, names) for the site.
  const wantContext = q.get('context') === '1' || ['roads', 'fireTrails', 'homes', 'zones', 'names'].some((k) => q.has(k));
  const context: ContextLayers | null = wantContext ? await loadBundledContext(site.id, terrain.grid.origin).catch(() => null) : null;
  const flag = (k: string, d: boolean): boolean => (q.has(k) ? q.get(k) !== '0' : d);

  // Start: 21 Dec 2019 at `start` local (AEDT = UTC+11).
  const startHour = num('start', 13);
  const startTime = Date.UTC(2019, 11, 21, startHour - 11, 0, 0);
  const fire = new SyntheticFire(terrain, fuel, { startTime, windSpeed: num('ws', 8), windDir: num('wd', 295) });

  const container = $('view');
  const view = new SceneView(container, {
    preserveDrawingBuffer: true,
    quality: (q.get('quality') as 'low' | 'medium' | 'high') ?? undefined,
    fixedDpr: q.has('dpr'),
    maxDpr: q.has('dpr') ? num('dpr', 1) : undefined,
    windArrows: q.get('arrows') === '1',
  });
  view.setScenario(terrain, fuel, { imagery, context });
  view.setStartTime(startTime);
  $('loading').classList.add('hidden');

  const overlay = (q.get('overlay') ?? 'none') as OverlayKind;
  view.setLayers({
    overlay,
    imagery: q.get('imagery') !== '0',
    vegetation: q.get('veg') !== '0',
    wind: (q.get('wind') as 'off' | 'surface' | 'volume') ?? 'surface',
    isochroneMinutes: num('iso', 30),
    smoke: q.get('smoke') !== '0',
    flames: q.get('flames') !== '0',
    embers: q.get('embers') !== '0',
    verticalExaggeration: num('vex', 1),
    roads: flag('roads', true),
    fireTrails: flag('fireTrails', true),
    homes: flag('homes', false),
    zones: flag('zones', false),
    placeNames: flag('names', true),
    // Section along the wind through the fire (downwind of the ignition).
    crossSection: {
      enabled: q.get('cross') === '1',
      azimuth: num('crossAz', (fire.opts.windDir + 180) % 360),
      centre: q.has('crossAt') ? (q.get('crossAt')!.split(',').map(Number) as [number, number]) : [fire.ignition[0] + 1800 * Math.sin((((fire.opts.windDir + 180) % 360) * Math.PI) / 180), fire.ignition[1] + 1800 * Math.cos((((fire.opts.windDir + 180) % 360) * Math.PI) / 180)],
    },
  });
  view.setIgnitions(fire.ignitions(), []);
  if (q.has('user')) {
    const [ux, uy, uh] = q.get('user')!.split(',').map(Number);
    view.setUserLocation(ux!, uy!, Number.isFinite(uh) ? uh! : null);
  } else {
    // A crew on the ridge downwind of the fire.
    view.setUserLocation(fire.ignition[0] + 2200, fire.ignition[1] - 900, 300);
  }

  if (q.has('brush')) {
    const [bx, by, br] = q.get('brush')!.split(',').map(Number);
    view.setBrushPreview({ x: bx!, y: by!, radius: br!, colour: '#ffd400' });
  }
  let t = num('t', 3 * 3600);
  let playing = q.get('play') === '1';
  const timeInput = $<HTMLInputElement>('time');
  timeInput.max = String(fire.opts.duration);
  const show = (snap: SimSnapshot): void => {
    view.update(snap);
    const ins = fire.insights(snap.time);
    view.setInsights(ins);
    if (q.get('focus') === '1') view.focusInsight(ins[0] ?? null, false);
    const local = new Date(startTime + snap.time * 1000 + 11 * 3600 * 1000);
    $('clock').textContent = `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')} +${(snap.time / 3600).toFixed(1)}h`;
    timeInput.value = String(snap.time);
    renderLegend(view);
  };
  const setTime = (tt: number): void => {
    t = Math.max(0, Math.min(fire.opts.duration, Math.round(tt / 300) * 300));
    show(fire.snapshotAt(t));
  };
  setTime(t);

  // Camera.
  const townName = q.get('town');
  const town = townName && context ? context.places.find((p) => p.name.toLowerCase() === townName.toLowerCase()) : undefined;
  if (town) {
    view.lookAt(town.x, town.y, num('d', 1800), num('az', 200), num('tilt', 55));
  } else if (q.has('cam')) {
    const [cx, cy, d, az, tilt] = q.get('cam')!.split(',').map(Number);
    view.lookAt(cx!, cy!, d!, az ?? 200, tilt ?? 55);
  } else {
    // Frame the active fire (intensity-weighted centroid of the burning cells), a little downwind of it.
    const snap = fire.snapshotAt(t);
    const c = fireCentroid(snap.fire, t, 1800);
    const [wu, wv] = [Math.sin(((fire.opts.windDir + 180) * Math.PI) / 180), Math.cos(((fire.opts.windDir + 180) * Math.PI) / 180)];
    const [cx, cy] = c ? [c.x + wu * 400, c.y + wv * 400] : [fire.ignition[0] + wu * 1500, fire.ignition[1] + wv * 1500];
    view.lookAt(cx, cy, 4200, 200, 58);
  }
  if (q.get('cross') === '1' && !q.has('cam')) view.viewSection(false);
  const mode = q.get('view');
  if (mode === 'top' || mode === 'ground') view.setViewMode(mode);
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-view]')) b.classList.toggle('on', b.dataset.view === (mode ?? 'orbit'));

  // HUD wiring.
  if (q.get('hud') === '0') {
    $('hud').classList.add('hidden');
    $('banner').classList.add('hidden');
  }
  const ov = $<HTMLSelectElement>('overlay');
  ov.value = overlay;
  ov.onchange = () => {
    view.setLayers({ overlay: ov.value as OverlayKind });
    renderLegend(view);
  };
  const wind = $<HTMLSelectElement>('wind');
  wind.value = view.getLayers().wind;
  wind.onchange = () => view.setLayers({ wind: wind.value as 'off' | 'surface' | 'volume' });
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
    b.onclick = () => {
      view.setViewMode(b.dataset.view as 'orbit' | 'top' | 'ground');
      for (const o of document.querySelectorAll<HTMLButtonElement>('[data-view]')) o.classList.toggle('on', o === b);
    };
  }
  const toggle = (id: string, get: () => boolean, set: (v: boolean) => void): void => {
    const el = $<HTMLButtonElement>(id);
    el.classList.toggle('on', get());
    el.onclick = () => {
      set(!get());
      el.classList.toggle('on', get());
    };
  };
  toggle('section', () => view.getLayers().crossSection.enabled, (v) => {
    view.setLayers({ crossSection: { ...view.getLayers().crossSection, enabled: v } });
    renderLegend(view);
  });
  toggle('imagery', () => view.getLayers().imagery, (v) => view.setLayers({ imagery: v }));
  toggle('veg', () => view.getLayers().vegetation, (v) => view.setLayers({ vegetation: v }));
  toggle('roads', () => view.getLayers().roads, (v) => view.setLayers({ roads: v }));
  toggle('trails', () => view.getLayers().fireTrails, (v) => view.setLayers({ fireTrails: v }));
  toggle('homes', () => view.getLayers().homes, (v) => view.setLayers({ homes: v }));
  toggle('zones', () => view.getLayers().zones, (v) => view.setLayers({ zones: v }));
  toggle('names', () => view.getLayers().placeNames, (v) => view.setLayers({ placeNames: v }));
  timeInput.oninput = () => setTime(Number(timeInput.value));
  const play = $<HTMLButtonElement>('play');
  const setPlay = (p: boolean): void => {
    playing = p;
    play.textContent = p ? '❚❚' : '▶';
  };
  setPlay(playing);
  play.onclick = () => setPlay(!playing);
  setInterval(() => {
    if (playing) setTime(t >= fire.opts.duration ? 0 : t + 300);
  }, 900);
  setInterval(() => {
    const s = view.stats();
    const d = view.diagnostics();
    $('stats').textContent = `${s.fps} fps · ${s.drawCalls} draws · ${(s.triangles / 1000).toFixed(0)}k tris · dpr ${d.dpr} · trees ${d.vegetation} · flames ${d.flames} · embers ${d.embers} · puffs ${d.puffs} · mesh ${d.mesh} · places ${d.places}`;
  }, 500);

  // Tap: log the picked ground point (checks picking).
  view.renderer.domElement.addEventListener('dblclick', (e) => {
    const p = view.pickGround(e.clientX, e.clientY);
    if (p) console.log('picked', p.map((v) => v.toFixed(0)).join(', '));
  });

  if (q.get('flush') !== '0') view.flushPlaces(); // flush=0 leaves the sliced build to the render loop (timing checks)
  window.__fs = { view, fire, ready: true, setTime };
}

function renderLegend(view: SceneView): void {
  const el = $('legend');
  const lg = view.legend() ?? (view.getLayers().crossSection.enabled ? crossSectionLegend() : null);
  if (!lg || q.get('legend') === '0') {
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  let html = `<h3>${lg.title}${lg.units ? ` <span style="font-weight:400;color:#aeb6c4">(${lg.units})</span>` : ''}</h3>`;
  if (lg.kind === 'continuous' || lg.kind === 'cyclic') {
    html += `<div class="bar" style="background:${lg.gradient}"></div><div class="ticks">${lg.entries
      .filter((_, i, a) => a.length <= 5 || i % Math.ceil(a.length / 5) === 0 || i === a.length - 1)
      .map((e) => `<span>${e.label}</span>`)
      .join('')}</div>`;
  } else {
    html += lg.entries
      .slice(0, 9)
      .map((e) => `<div><span class="sw" style="background:${e.colour}"></span>${e.label}</div>`)
      .join('');
  }
  if (lg.note) html += `<div class="note">${lg.note}</div>`;
  el.innerHTML = html;
}

main().catch((e: unknown) => {
  console.error(e);
  $('loading').textContent = `Failed: ${String(e)}`;
  window.__fs = { ready: false, error: String(e) } as never;
});
