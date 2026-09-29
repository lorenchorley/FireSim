/**
 * Canopy dev harness (served by Vite at /src/render/devTrees.html): the same demo site, fabricated fuel and synthetic fire
 * as dev.html, plus patches of stringybark / ribbon bark / smooth gum, old burns and lusher understorey so every species and
 * fire response can be looked at. Everything is also reachable from `window.__trees` (view, fuel, find(), shot helpers).
 *
 * URL parameters (all optional):
 *   site=katoomba  cell=10  quality=low|medium|high  t=<s of the synthetic fire>  start=<local hour, 22 = night theme>
 *   canopy=natural|simple|coded  code=height|cover|bark|understorey  sway=0|1  under=0|1  veg=0|1  overlay=<OverlayKind>  solo=0|1
 *   cam=x,y,dist,az,tilt   view=orbit|top|ground   user=x,y  head=<deg>   ws=<wind m/s>  wd=<wind from deg>
 *   flames=0 smoke=0 embers=0 wind=surface|volume (default off)  hud=0  dpr=<fixed>  markers=0
 */
import * as THREE from 'three';
import { makeGridSpec } from '../core/grid';
import { FuelFlag, FuelType, type FuelMap, type SimSnapshot } from '../core/types';
import { DEMO_SITES, loadCanopy, loadElevation, setAssetBase } from '../data';
import { buildTerrain } from '../terrain';
import { loadDemoImagery } from './demoAssets';
import { fabricateFuel, smoothNoise, SyntheticFire } from './devScenario';
import { fireCentroid } from './fields';
import type { OverlayKind } from './layers';
import { SceneView } from './SceneView';
import { BARK_CODE, type CanopyCode, type CanopyStyle } from './canopyStyle';
import { foliageTint, INSTANCE_BYTES, VegGroup, type VegInstances } from './vegetationPlacement';
import type { VegetationLayer } from './vegetationLayer';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number): number => (q.has(k) ? Number(q.get(k)) : d);
const flag = (k: string, d: boolean): boolean => (q.has(k) ? q.get(k) !== '0' : d);
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

interface ShowOpts {
  x?: number;
  y?: number;
  spacing?: number;
  /** Row of extra copies per group: [count, spacing]. */
  bark?: number;
  years?: number;
  under?: number;
  burnt?: boolean;
}

/** Nominal size (height, crown width) of one tree of a group, as the canopy data would give it. */
const SHOW_SIZE: Record<number, [number, number]> = {
  [VegGroup.Stringybark]: [24, 11],
  [VegGroup.Ribbonbark]: [24, 11],
  [VegGroup.SmoothGum]: [24, 10],
  [VegGroup.TallWetGum]: [45, 12],
  [VegGroup.Rainforest]: [27, 19],
  [VegGroup.SnowGum]: [9, 8],
  [VegGroup.Conifer]: [22, 6.5],
  [VegGroup.Heath]: [1.6, 3],
  [VegGroup.Understorey]: [2.2, 2.4],
  [VegGroup.Grass]: [0.5, 0.8],
};

declare global {
  interface Window {
    __trees?: {
      view: SceneView;
      fuel: FuelMap;
      fire: SyntheticFire;
      ready: boolean;
      error?: string;
      setTime(t: number): void;
      find(type: FuelType, n?: number): [number, number][];
      bench(frames: number): { msPerFrame: number };
      typeAt(x: number, y: number): number;
      showcase(groups: number[], o?: ShowOpts): void;
      forceLod(lod: 0 | 1 | 2 | null): void;
      eye(x: number, y: number, heading: number, pitch?: number): void;
    };
  }
}

/** Decorate the fabricated fuel: bark patches, old burns and understorey variety (harness only). */
function decorate(fuel: FuelMap): void {
  const g = fuel.grid;
  const n = g.nx * g.ny;
  fuel.flags = new Uint16Array(n);
  for (let j = 0; j < g.ny; j++) {
    for (let i = 0; i < g.nx; i++) {
      const k = j * g.nx + i;
      const x = g.x0 + i * g.cellSize;
      const y = g.y0 + j * g.cellSize;
      const t = fuel.type[k] as FuelType;
      if (t === FuelType.DryForestShrubby || t === FuelType.GrassyWoodland || t === FuelType.DryForestGrassy || t === FuelType.WetForest) {
        const v = smoothNoise(x / 650, y / 650, 11);
        if (v > 0.6) {
          fuel.flags[k]! |= FuelFlag.Stringybark;
          fuel.barkHazard[k] = 3.4;
        } else if (v > 0.38) {
          fuel.flags[k]! |= FuelFlag.RibbonBark;
          fuel.barkHazard[k] = 2.4;
        } else fuel.barkHazard[k] = 0.8;
        // Understorey hazard and height vary in patches: sparse open forest to dense ladder fuel.
        const e = smoothNoise(x / 420, y / 420, 21);
        fuel.elevatedHazard[k] = 0.4 + 3.6 * e;
        fuel.elevatedHeight[k] = 0.5 + 2.2 * e;
        fuel.surfaceHazard[k] = 1 + 3 * smoothNoise(x / 380, y / 380, 31);
      }
    }
  }
  // Species patches the fabricated map does not produce: tall wet forest, rainforest, snow gum and a pine plantation.
  const patches: [number, number, number, FuelType, number, number][] = [
    [-400, 900, 320, FuelType.WetForest, 42, 0.85],
    [350, 950, 260, FuelType.Rainforest, 28, 0.95],
    [-1100, -900, 320, FuelType.SnowGumWoodland, 9, 0.55],
    [900, -450, 300, FuelType.PinePlantation, 24, 0.85],
  ];
  for (let j = 0; j < g.ny; j++) {
    for (let i = 0; i < g.nx; i++) {
      const k = j * g.nx + i;
      const x = g.x0 + i * g.cellSize;
      const y = g.y0 + j * g.cellSize;
      for (const [px, py, pr, pt, ph, pc] of patches) {
        if (Math.hypot(x - px, y - py) > pr) continue;
        fuel.type[k] = pt;
        fuel.canopyHeight[k] = ph * (0.9 + 0.2 * smoothNoise(x / 90, y / 90, 41));
        fuel.canopyCover[k] = pc;
        fuel.barkHazard[k] = pt === FuelType.WetForest ? 2.2 : pt === FuelType.Rainforest ? 0.6 : 1;
        fuel.elevatedHazard[k] = pt === FuelType.Rainforest ? 1.4 : pt === FuelType.PinePlantation ? 0.3 : 2.4;
        fuel.elevatedHeight[k] = pt === FuelType.Rainforest ? 2 : 1.2;
        fuel.surfaceHazard[k] = pt === FuelType.PinePlantation ? 3.4 : 2;
      }
    }
  }
  // Old burns of different ages (years since fire): a fresh block, and blocks 2, 4 and 7 years old.
  const burns: [number, number, number][] = [
    [-800, 400, 0.6],
    [-1500, -100, 2],
    [-2300, 500, 4],
    [-700, -900, 7],
  ];
  for (let j = 0; j < g.ny; j++) {
    for (let i = 0; i < g.nx; i++) {
      const x = g.x0 + i * g.cellSize;
      const y = g.y0 + j * g.cellSize;
      for (const [bx, by, yrs] of burns) if (Math.hypot(x - bx, y - by) < 260) fuel.timeSinceFire[j * g.nx + i] = yrs;
    }
  }
}

async function main(): Promise<void> {
  setAssetBase(`${location.origin}/`);
  const site = DEMO_SITES.find((s) => s.id === (q.get('site') ?? 'katoomba')) ?? DEMO_SITES[0]!;
  const cell = num('cell', 10);
  const extent = 9000;
  const elev = await loadElevation({ centre: site.centre, extent, cellSize: cell, demoSiteId: site.id });
  const terrain = buildTerrain(elev.grid, elev.elevation, elev.source);
  const fuelGrid = makeGridSpec(site.centre, extent, 30);
  const canopy = await loadCanopy(fuelGrid, { demoSiteId: site.id });
  const fuel = fabricateFuel(terrain, fuelGrid, canopy);
  if (flag('decorate', true)) decorate(fuel);
  const imagery = await loadDemoImagery(site.id, { grid: terrain.grid }).catch(() => null);

  const startHour = num('start', 13);
  const startTime = Date.UTC(2019, 11, 21, startHour - 11, 0, 0);
  const fire = new SyntheticFire(terrain, fuel, { startTime, windSpeed: num('ws', 8), windDir: num('wd', 295) });
  const view = new SceneView($('view'), {
    preserveDrawingBuffer: true,
    quality: (q.get('quality') as 'low' | 'medium' | 'high') ?? 'high',
    fixedDpr: q.has('dpr'),
    maxDpr: q.has('dpr') ? num('dpr', 1) : 1,
  });
  view.setScenario(terrain, fuel, { imagery });
  view.setStartTime(startTime);
  $('loading').classList.add('hidden');
  view.setLayers({
    overlay: (q.get('overlay') ?? 'none') as OverlayKind,
    vegetation: flag('veg', true),
    understorey: flag('under', true),
    canopyStyle: (q.get('canopy') ?? 'natural') as CanopyStyle,
    canopyCode: (q.get('code') ?? 'height') as CanopyCode,
    windSway: flag('sway', true),
    soloHeat: flag('solo', true),
    wind: (q.get('wind') as 'off' | 'surface' | 'volume') ?? 'off',
    smoke: flag('smoke', false),
    flames: flag('flames', true),
    embers: flag('embers', false),
    imagery: flag('imagery', true),
    insightMarkers: false,
    roads: false,
    fireTrails: false,
    placeNames: false,
    isochroneMinutes: 0,
  });
  view.setIgnitions(fire.ignitions(), []);

  let t = num('t', 3 * 3600);
  const setTime = (tt: number): void => {
    t = Math.max(0, Math.min(fire.opts.duration, Math.round(tt / 300) * 300));
    const snap: SimSnapshot = fire.snapshotAt(t);
    view.update(snap);
  };
  setTime(t);

  if (q.has('user')) {
    const [ux, uy] = q.get('user')!.split(',').map(Number);
    view.setUserLocation(ux!, uy!, null);
  }
  if (q.has('cam')) {
    const [cx, cy, d, az, tilt] = q.get('cam')!.split(',').map(Number);
    view.lookAt(cx!, cy!, d!, az ?? 200, tilt ?? 55);
  } else {
    const snap = fire.snapshotAt(t);
    const c = fireCentroid(snap.fire, t, 1800);
    const [wu, wv] = [Math.sin(((fire.opts.windDir + 180) * Math.PI) / 180), Math.cos(((fire.opts.windDir + 180) * Math.PI) / 180)];
    const [cx, cy] = c ? [c.x + wu * 400, c.y + wv * 400] : [fire.ignition[0] + wu * 1500, fire.ignition[1] + wv * 1500];
    view.lookAt(cx, cy, 4200, 200, 58);
  }
  const mode = q.get('view');
  if (mode === 'top' || mode === 'ground') view.setViewMode(mode);
  if (q.has('head')) view.setHeading(num('head', 0));

  const typeAt = (x: number, y: number): number => {
    const i = Math.round((x - fuelGrid.x0) / fuelGrid.cellSize);
    const j = Math.round((y - fuelGrid.y0) / fuelGrid.cellSize);
    if (i < 0 || j < 0 || i >= fuelGrid.nx || j >= fuelGrid.ny) return -1;
    return fuel.type[j * fuelGrid.nx + i]!;
  };
  const find = (type: FuelType, count = 5): [number, number][] => {
    // Cells of the type with a same-type neighbourhood, nearest the domain centre first, spaced apart.
    const out: [number, number][] = [];
    const cand: [number, number, number][] = [];
    for (let j = 6; j < fuelGrid.ny - 6; j += 2) {
      for (let i = 6; i < fuelGrid.nx - 6; i += 2) {
        let same = 0;
        for (let dj = -5; dj <= 5; dj += 5) for (let di = -5; di <= 5; di += 5) if (fuel.type[(j + dj) * fuelGrid.nx + i + di] === type) same++;
        if (same < 9) continue;
        const x = fuelGrid.x0 + i * fuelGrid.cellSize;
        const y = fuelGrid.y0 + j * fuelGrid.cellSize;
        cand.push([x, y, Math.hypot(x, y)]);
      }
    }
    cand.sort((a, b) => a[2] - b[2]);
    for (const [x, y] of cand) {
      if (out.every(([ox, oy]) => Math.hypot(ox - x, oy - y) > 600)) out.push([Math.round(x), Math.round(y)]);
      if (out.length >= count) break;
    }
    return out;
  };
  const bench = (frames: number): { msPerFrame: number } => {
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) view.renderNow();
    const gl = view.renderer.getContext();
    gl.finish();
    return { msPerFrame: (performance.now() - t0) / frames };
  };
  if (q.get('hud') === '0') $('stats').classList.add('hidden');
  setInterval(() => {
    const s = view.stats();
    const d = view.diagnostics();
    $('stats').textContent = `${s.drawCalls} draws · ${(s.triangles / 1000).toFixed(0)}k tris · canopy near/mid/far ${d.vegLod} · trees ${d.vegetation}`;
    const lg = view.canopyLegend();
    const el = $('legend');
    if (!lg || q.get('legend') === '0') el.classList.add('hidden');
    else {
      el.classList.remove('hidden');
      let html = `<h3>${lg.title}${lg.units ? ` (${lg.units})` : ''}</h3>`;
      if (lg.gradient) html += `<div class="bar" style="background:${lg.gradient}"></div>`;
      else html += lg.entries.map((e) => `<div><span class="sw" style="background:${e.colour}"></span>${e.label}</div>`).join('');
      if (lg.note) html += `<div class="note">${lg.note}</div>`;
      el.innerHTML = html;
    }
  }, 400);
  /** Eye-level camera at a ground point, looking along a compass heading and pitch (deg), placed at once. */
  const eye = (x: number, y: number, heading: number, pitch = 0): void => {
    const rig = (view as unknown as { rig: { groundPoint(x: number, y: number): THREE.Vector3; eyeHeight: number; goTo(t: THREE.Vector3, p: THREE.Vector3, s: number): void; eye: THREE.Vector3 | null; setMode(m: string, o?: unknown): void } }).rig;
    view.setUserLocation(x, y, null);
    view.setViewMode('ground');
    const e = rig.groundPoint(x, y);
    e.y += rig.eyeHeight;
    const a = (heading * Math.PI) / 180;
    const p = (pitch * Math.PI) / 180;
    const dir = new THREE.Vector3(Math.sin(a) * Math.cos(p), Math.sin(p), -Math.cos(a) * Math.cos(p));
    rig.goTo(e.clone().addScaledVector(dir, 1), e.clone(), 0);
    rig.eye = e.clone();
  };
  const forceLod = (lod: 0 | 1 | 2 | null): void => {
    const layer = (view as unknown as { vegetation: VegetationLayer }).vegetation;
    layer.nearRatio = lod === 0 ? 1e9 : lod === null ? undefined : 0;
    layer.midRatio = lod === 1 ? 1e9 : lod === null ? undefined : 0;
    layer.replan();
  };
  const showcase = (groups: number[], o: ShowOpts = {}): void => {
    const priv = view as unknown as { vegetation: VegetationLayer; hf: { heightAt(x: number, y: number): number }; placeVegetation: () => void; vegPending: number };
    priv.placeVegetation = () => undefined; // keep the hand-made trees: no re-placement when the camera settles
    priv.vegPending = 0;
    priv.vegetation.cancelPlacement();
    const sets: VegInstances[] = [];
    for (let gi = 0; gi < 10; gi++) {
      const idx = groups.indexOf(gi);
      const n = idx < 0 ? 0 : 1;
      const s: VegInstances = { group: gi, count: n, position: new Float32Array(n * 3), size: new Float32Array(n * 2), rand: new Float32Array(n * 2), tint: new Uint8Array(n * INSTANCE_BYTES), info: new Uint8Array(n * INSTANCE_BYTES), aux: new Uint8Array(n * INSTANCE_BYTES) };
      if (n) {
        const x = (o.x ?? 0) + idx * (o.spacing ?? 26);
        const y = o.y ?? 0;
        const [h, w] = SHOW_SIZE[gi]!;
        s.position.set([x, y, priv.hf.heightAt(x, y)]);
        s.size.set([h, w]);
        s.rand.set([0.31 + 0.13 * idx, 0.55]);
        const t = foliageTint(gi, o.under ?? 2.5, 40, 0.5, 0.5, [0, 0, 0]);
        s.tint.set([Math.round(t[0] * 255), Math.round(t[1] * 255), Math.round(t[2] * 255), gi === VegGroup.Stringybark ? BARK_CODE.stringy : gi === VegGroup.Ribbonbark ? BARK_CODE.ribbon : o.bark ?? 0]);
        s.info.set([160, Math.round(((o.under ?? 2.5) / 4) * 255), 200, o.years === undefined ? 255 : Math.round(o.years * 8)]);
        s.aux.set([140, 128, 128, Math.round(h * 4)]);
      }
      sets.push(s);
    }
    priv.vegetation.setInstances(sets);
    view.renderNow();
  };
  window.__trees = { view, fuel, fire, ready: true, setTime, find, bench, typeAt, showcase, forceLod, eye };
}

main().catch((e: unknown) => {
  console.error(e);
  $('loading').textContent = `Failed: ${String(e)}`;
  window.__trees = { ready: false, error: String(e) } as never;
});
