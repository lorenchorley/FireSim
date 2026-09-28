/**
 * MockSceneView: a 2-D, top-down canvas implementation of {@link SceneViewApi} for UI development, tests and
 * devices without WebGL2. It draws a hillshade (blended with aerial imagery when given), the selected overlay, the
 * fire (burning / burnt), embers, spot fires, ignitions, insight markers, wind arrows, the brush preview and the
 * user's position, with one-finger pan, pinch / wheel zoom, picking and projection.
 */
import { BurnState, FuelType, type FuelMap, type Ignition, type Insight, type SimSnapshot, type SpotFire, type Terrain } from '../core/types';
import { sampleBilinear } from '../core/grid';
import { DEG, msToKmh, windToUV } from '../core/units';
import { multiHillshade, insolation } from '../terrain';
import type { SceneImagery, SceneViewApi } from '../render/api';
import { DEFAULT_LAYERS, type LayerState } from '../render/layers';
import { driverColour, fuelColour, legendFor, SNAPSHOT_LAYER_OVERLAYS } from './legends';

type Rgb = [number, number, number];

function hex(c: string): Rgb {
  const n = parseInt(c.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Piecewise-linear colour at `v` for stops at positions `at` (optionally in log space). */
function ramp(at: readonly number[], colours: readonly Rgb[], v: number, log = false): Rgb {
  const f = (x: number): number => (log ? Math.log(Math.max(1e-6, x)) : x);
  const x = f(v);
  if (x <= f(at[0]!)) return colours[0]!;
  for (let i = 1; i < at.length; i++) {
    const b = f(at[i]!);
    if (x <= b) {
      const a = f(at[i - 1]!);
      const t = (x - a) / (b - a);
      const c0 = colours[i - 1]!;
      const c1 = colours[i]!;
      return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
    }
  }
  return colours[colours.length - 1]!;
}

function classes(at: readonly number[], colours: readonly Rgb[], v: number): Rgb {
  let c = colours[0]!;
  for (let i = 0; i < at.length; i++) if (v >= at[i]!) c = colours[i]!;
  return c;
}

const legendColours = (kind: Parameters<typeof legendFor>[0]): Rgb[] => {
  const l = legendFor(kind);
  if (!l) return [];
  return (l.kind === 'ramp' ? l.stops : l.classes).map((s) => hex(s.colour));
};

const SEVERITY: Record<Insight['severity'], string> = { info: '#2f80ed', watch: '#f2a900', danger: '#e02424' };
const IGNITION_COLOURS: Record<Ignition['origin'], string> = { observed: '#e02424', spot: '#ff8c1a', backburn: '#7b3fe4' };

export class MockSceneView implements SceneViewApi {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private terrain: Terrain | null = null;
  private fuel: FuelMap | null = null;
  private imagery: SceneImagery | null = null;
  private base: HTMLCanvasElement | null = null;
  private baseImagery: HTMLCanvasElement | null = null;
  private overlay: HTMLCanvasElement | null = null;
  private fireCanvas: HTMLCanvasElement | null = null;
  private glowCanvas: HTMLCanvasElement | null = null;
  private snapshot: SimSnapshot | null = null;
  private layers: LayerState = { ...DEFAULT_LAYERS, crossSection: { ...DEFAULT_LAYERS.crossSection } };
  private ignitions: Ignition[] = [];
  private spots: SpotFire[] = [];
  private insights: Insight[] = [];
  private focus: Insight | null = null;
  private user: { x: number; y: number; heading: number | null } | null = null;
  private brush: { x: number; y: number; radius: number; colour: string } | null = null;
  private interaction = true;
  // View transform: centre (local m) and scale (CSS px per metre).
  private cx = 0;
  private cy = 0;
  private scale = 0.05;
  /** Optical-centre shift (CSS px) from the view insets. */
  private offX = 0;
  private offY = 0;
  private anim: { from: [number, number, number]; to: [number, number, number]; t0: number; dur: number } | null = null;
  private raf = 0;
  private dirty = true;
  private frames: number[] = [];
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinch: { d: number; scale: number } | null = null;
  private readonly ro: ResizeObserver | null;
  private disposed = false;

  constructor(private readonly container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'mock-scene';
    this.canvas.setAttribute('aria-label', '2-D map of the scenario area');
    this.canvas.setAttribute('role', 'img');
    Object.assign(this.canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', touchAction: 'none', display: 'block' });
    container.appendChild(this.canvas);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2-D canvas unavailable');
    this.ctx = ctx;
    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointercancel', this.onUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.resize()) : null;
    this.ro?.observe(container);
    this.resize();
  }

  // ───────────────────────────── SceneViewApi ─────────────────────────────

  setScenario(terrain: Terrain, fuel: FuelMap, opts?: { imagery?: SceneImagery | null }): void {
    this.terrain = terrain;
    this.fuel = fuel;
    this.imagery = opts?.imagery ?? null;
    this.snapshot = null;
    this.buildBase();
    this.buildOverlay();
    this.fit();
    this.invalidate();
  }

  refreshFuel(fuel: FuelMap): void {
    this.fuel = fuel;
    this.buildOverlay();
    this.invalidate();
  }

  update(snapshot: SimSnapshot): void {
    this.snapshot = snapshot;
    this.buildFire();
    if (['arrival', 'ros', 'intensity', 'driver', 'moisture', 'insolation'].includes(this.layers.overlay) || SNAPSHOT_LAYER_OVERLAYS.has(this.layers.overlay)) this.buildOverlay();
    this.invalidate();
  }

  setLayers(layers: Partial<LayerState>): void {
    const prev = this.layers;
    this.layers = { ...prev, ...layers, crossSection: { ...prev.crossSection, ...(layers.crossSection ?? {}) } };
    if (layers.imagery !== undefined && layers.imagery !== prev.imagery) this.buildBase();
    if (layers.overlay !== undefined || layers.isochroneMinutes !== undefined) this.buildOverlay();
    this.invalidate();
  }

  setIgnitions(ignitions: Ignition[], spots: SpotFire[]): void {
    this.ignitions = ignitions;
    this.spots = spots;
    this.invalidate();
  }

  setInsights(insights: Insight[]): void {
    this.insights = insights;
    this.invalidate();
  }

  focusInsight(insight: Insight | null, fly = false): void {
    this.focus = insight;
    if (insight && fly) this.flyTo(insight.x, insight.y, 2500);
    this.invalidate();
  }

  pickGround(clientX: number, clientY: number): [number, number] | null {
    if (!this.terrain) return null;
    const r = this.canvas.getBoundingClientRect();
    const sx = clientX - r.left;
    const sy = clientY - r.top;
    if (sx < 0 || sy < 0 || sx > r.width || sy > r.height) return null;
    const x = this.cx + (sx - r.width / 2 - this.offX) / this.scale;
    const y = this.cy - (sy - r.height / 2 - this.offY) / this.scale;
    const half = this.halfExtent();
    if (Math.abs(x) > half || Math.abs(y) > half) return null;
    return [x, y];
  }

  projectToScreen(x: number, y: number): [number, number] | null {
    const r = this.canvas.getBoundingClientRect();
    const sx = r.width / 2 + this.offX + (x - this.cx) * this.scale;
    const sy = r.height / 2 + this.offY - (y - this.cy) * this.scale;
    if (sx < -50 || sy < -50 || sx > r.width + 50 || sy > r.height + 50) return null;
    return [r.left + sx, r.top + sy];
  }

  flyTo(x: number, y: number, distance = 2000): void {
    const r = this.canvas.getBoundingClientRect();
    const to: [number, number, number] = [x, y, Math.min(r.width, r.height || r.width) / Math.max(200, distance)];
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      [this.cx, this.cy, this.scale] = to;
      this.invalidate();
      return;
    }
    this.anim = { from: [this.cx, this.cy, this.scale], to, t0: performance.now(), dur: 650 };
    this.invalidate();
  }

  setViewMode(mode: 'orbit' | 'top' | 'ground'): void {
    // The 2-D view is always top-down; 'top' re-fits the domain, 'ground' centres on the user.
    if (mode === 'top') this.fit(true);
    if (mode === 'ground' && this.user) this.flyTo(this.user.x, this.user.y, 1500);
  }

  setViewInsets(insets: { top?: number; right?: number; bottom?: number; left?: number }): void {
    this.offX = ((insets.left ?? 0) - (insets.right ?? 0)) / 2;
    this.offY = ((insets.top ?? 0) - (insets.bottom ?? 0)) / 2;
    this.invalidate();
  }

  zoomBy(factor: number): void {
    if (!(factor > 0)) return;
    this.scale = this.clampScale(this.scale / factor);
    this.invalidate();
  }

  /** The 2-D map is always north up. */
  get heading(): number {
    return 0;
  }

  setHeading(_deg: number): void {
    /* always north up */
  }

  setUserLocation(x: number, y: number, headingDeg?: number | null): void {
    this.user = { x, y, heading: headingDeg ?? null };
    this.invalidate();
  }

  setBrushPreview(p: { x: number; y: number; radius: number; colour: string } | null): void {
    this.brush = p;
    this.invalidate();
  }

  setInteractionEnabled(enabled: boolean): void {
    this.interaction = enabled;
    this.canvas.style.touchAction = 'none';
  }

  stats(): { fps: number; drawCalls: number; triangles: number } {
    const f = this.frames;
    const fps = f.length > 1 ? (1000 * (f.length - 1)) / Math.max(1, f[f.length - 1]! - f[0]!) : 0;
    return { fps: Math.round(fps), drawCalls: 1, triangles: 0 };
  }

  resize(): void {
    const r = this.container.getBoundingClientRect();
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.invalidate();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.canvas.remove();
  }

  // ───────────────────────────── building layers ─────────────────────────────

  private halfExtent(): number {
    const g = this.terrain!.grid;
    return (g.nx * g.cellSize) / 2;
  }

  private fit(animate = false): void {
    if (!this.terrain) return;
    const r = this.container.getBoundingClientRect();
    const ext = this.halfExtent() * 2;
    // Fill the width, or ~60 % of the height on tall phones (the chrome covers the top and bottom).
    const s = Math.max(r.width || 400, (r.height || 800) * 0.6) / ext;
    if (animate) this.flyTo(0, 0, ext);
    else {
      this.cx = 0;
      this.cy = 0;
      this.scale = s;
    }
  }

  private gridCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D, ImageData] {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    return [c, ctx, ctx.createImageData(w, h)];
  }

  /** Base map: colour relief × hillshade, or imagery with a light hillshade on top. */
  private buildBase(): void {
    const t = this.terrain;
    if (!t) return;
    const { nx, ny } = t.grid;
    const hs = multiHillshade(t, {});
    const [c, ctx, img] = this.gridCanvas(nx, ny);
    const zr = Math.max(1, t.maxElevation - t.minElevation);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const p = ((ny - 1 - j) * nx + i) * 4;
        const s = hs[k]!;
        const e = (t.elevation[k]! - t.minElevation) / zr;
        const type = this.fuel?.type[k] ?? FuelType.DryForestShrubby;
        // Natural tint: greener low/wet, olive-tan on the tops, pale rock on cliffs.
        let rgb: Rgb = [96 + 60 * e, 118 + 40 * e, 76 + 30 * e];
        if (type === FuelType.NonFuel) rgb = [176, 164, 142];
        else if (type === FuelType.WetForest || type === FuelType.Rainforest) rgb = [70, 104, 66];
        else if (type === FuelType.Heath) rgb = [140, 140, 106];
        else if (type === FuelType.Grassland) rgb = [178, 170, 110];
        const l = 0.35 + 0.8 * s;
        img.data[p] = Math.min(255, rgb[0] * l);
        img.data[p + 1] = Math.min(255, rgb[1] * l);
        img.data[p + 2] = Math.min(255, rgb[2] * l);
        img.data[p + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.base = c;
    this.baseImagery = null;
    if (this.imagery && this.layers.imagery) {
      const src = this.imagery.image;
      const w = 'width' in src ? Number(src.width) : nx;
      const h = 'height' in src ? Number(src.height) : ny;
      const ic = document.createElement('canvas');
      ic.width = w;
      ic.height = h;
      const ictx = ic.getContext('2d')!;
      ictx.drawImage(src as CanvasImageSource, 0, 0, w, h);
      // Light hillshade multiply so the relief reads through the photo.
      const [hc, hctx, himg] = this.gridCanvas(nx, ny);
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          const v = Math.round(255 * Math.min(1, 0.55 + 0.6 * hs[j * nx + i]!));
          const p = ((ny - 1 - j) * nx + i) * 4;
          himg.data[p] = himg.data[p + 1] = himg.data[p + 2] = v;
          himg.data[p + 3] = 255;
        }
      hctx.putImageData(himg, 0, 0);
      ictx.globalCompositeOperation = 'multiply';
      ictx.globalAlpha = 0.55;
      ictx.drawImage(hc, 0, 0, w, h);
      this.baseImagery = ic;
    }
  }

  private buildOverlay(): void {
    const t = this.terrain;
    const kind = this.layers.overlay;
    if (!t || kind === 'none') {
      this.overlay = null;
      return;
    }
    const f = this.fuel;
    const s = this.snapshot;
    const onFireGrid = kind === 'arrival' || kind === 'ros' || kind === 'intensity' || kind === 'driver' || SNAPSHOT_LAYER_OVERLAYS.has(kind);
    const g = onFireGrid ? (s?.fire.grid ?? t.grid) : t.grid;
    // Engine rasters (VLS, attachment, trench, dead man zone, ember landings) travel in SimSnapshot.layers.
    const engineLayer = SNAPSHOT_LAYER_OVERLAYS.has(kind) ? (s?.layers?.[kind] ?? null) : null;
    const { nx, ny } = g;
    const [c, ctx, img] = this.gridCanvas(nx, ny);
    const cols = legendColours(kind);
    let sun: Float32Array | null = null;
    if (kind === 'insolation') {
      const time = s ? s.time : 0;
      try {
        sun = insolation(t, (this.startTime ?? Date.now()) + time * 1000, {}).total;
      } catch {
        sun = null;
      }
    }
    const tNow = s?.time ?? 0;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        let rgb: Rgb | null = null;
        switch (kind) {
          case 'arrival': {
            const a = s?.fire.arrivalTime[k] ?? Infinity;
            if (Number.isFinite(a)) {
              const step = (this.layers.isochroneMinutes || 30) * 60;
              const band = Math.floor(a / step) * step;
              rgb = ramp([0, 0.2, 0.4, 0.6, 0.8, 1], cols, tNow > 0 ? band / tNow : 0);
            }
            break;
          }
          case 'ros':
            if (s && Number.isFinite(s.fire.arrivalTime[k]!)) rgb = ramp([0.05, 0.2, 0.5, 1, 2, 4, 8, 15], cols, msToKmh(s.fire.ros[k]!), true);
            break;
          case 'intensity':
            if (s && Number.isFinite(s.fire.arrivalTime[k]!)) rgb = classes([0, 500, 2000, 4000, 10000, 30000], cols, s.fire.intensity[k]!);
            break;
          case 'driver':
            if (s && Number.isFinite(s.fire.arrivalTime[k]!)) rgb = hex(driverColour(s.fire.driver[k]!));
            break;
          case 'moisture':
            if (s && s.moisture.length === nx * ny && s.moisture[k]! > 0) rgb = ramp([3, 6, 9, 13, 18, 25], cols, s.moisture[k]!);
            break;
          case 'vls':
          case 'attach':
          case 'trench':
          case 'dmz':
            if (engineLayer && engineLayer.length === nx * ny && engineLayer[k]! > 0.02) rgb = ramp([0, 0.25, 0.5, 0.75, 1], cols, engineLayer[k]!);
            break;
          case 'landing':
            if (engineLayer && engineLayer.length === nx * ny && engineLayer[k]! >= 0.1) rgb = ramp([0.1, 1, 10, 100], cols, engineLayer[k]!, true);
            break;
          case 'fuelLoad':
            if (f) rgb = ramp([0, 5, 10, 15, 20, 25, 30, 40], cols, f.surfaceLoad[k]! + f.nearSurfaceLoad[k]! + f.elevatedLoad[k]! + f.barkLoad[k]!);
            break;
          case 'fuelType':
            if (f) rgb = hex(fuelColour(f.type[k] as FuelType));
            break;
          case 'timeSinceFire':
            if (f) rgb = Number.isFinite(f.timeSinceFire[k]!) ? ramp([0, 2, 5, 10, 20, 30, 50], cols, f.timeSinceFire[k]!) : [154, 154, 154];
            break;
          case 'slope':
            rgb = classes([0, 5, 10, 15, 20, 25, 35], cols, t.slopeDeg[k]!);
            break;
          case 'aspect': {
            const a = t.aspectDeg[k]!;
            rgb = Number.isFinite(a) && t.slopeDeg[k]! > 2 ? cols[Math.round(a / 45) % 8]! : cols[8]!;
            break;
          }
          case 'insolation':
            if (sun) rgb = ramp([0, 150, 350, 550, 750, 950, 1100], cols, sun[k]!);
            break;
        }
        if (!rgb) continue;
        const p = ((ny - 1 - j) * nx + i) * 4;
        img.data[p] = rgb[0];
        img.data[p + 1] = rgb[1];
        img.data[p + 2] = rgb[2];
        img.data[p + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.overlay = c;
  }

  /** Scenario start time for time-dependent overlays (set by the UI through the snapshot's weather time). */
  private get startTime(): number | null {
    const s = this.snapshot;
    return s ? s.stats.weather.time - s.time * 1000 : null;
  }

  private buildFire(): void {
    const s = this.snapshot;
    if (!s) return;
    const { nx, ny } = s.fire.grid;
    const [c, ctx, img] = this.gridCanvas(nx, ny);
    const [gc, gctx, gimg] = this.gridCanvas(nx, ny);
    let anyBurning = false;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const st = s.fire.burnState[k]!;
        const p = ((ny - 1 - j) * nx + i) * 4;
        if (st === BurnState.BurntOut) {
          // Charcoal, slightly warmer where the fire went out recently.
          const age = Math.min(1, (s.time - s.fire.arrivalTime[k]!) / 7200);
          img.data[p] = 46 - 16 * age;
          img.data[p + 1] = 34 - 10 * age;
          img.data[p + 2] = 30 - 8 * age;
          img.data[p + 3] = 215;
        } else if (st === BurnState.Burning) {
          anyBurning = true;
          const I = s.fire.intensity[k]!;
          const hot = Math.min(1, Math.max(0, (Math.log10(Math.max(10, I)) - 2) / 2.5));
          img.data[p] = 230 + 25 * hot;
          img.data[p + 1] = 60 + 140 * hot;
          img.data[p + 2] = 15 + 30 * hot;
          img.data[p + 3] = 255;
          gimg.data[p] = 255;
          gimg.data[p + 1] = 120 + 100 * hot;
          gimg.data[p + 2] = 30;
          gimg.data[p + 3] = 200;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    gctx.putImageData(gimg, 0, 0);
    this.fireCanvas = c;
    this.glowCanvas = anyBurning ? gc : null;
  }

  // ───────────────────────────── drawing ─────────────────────────────

  private invalidate(): void {
    this.dirty = true;
    if (!this.raf && !this.disposed) this.raf = requestAnimationFrame(this.frame);
  }

  private readonly frame = (now: number): void => {
    this.raf = 0;
    if (this.disposed) return;
    if (this.anim) {
      const a = this.anim;
      const u = Math.min(1, (now - a.t0) / a.dur);
      const e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
      this.cx = a.from[0] + (a.to[0] - a.from[0]) * e;
      this.cy = a.from[1] + (a.to[1] - a.from[1]) * e;
      this.scale = Math.exp(Math.log(a.from[2]) + (Math.log(a.to[2]) - Math.log(a.from[2])) * e);
      if (u >= 1) this.anim = null;
      this.dirty = true;
    }
    if (this.dirty || this.focus) {
      this.draw(now);
      this.frames.push(now);
      if (this.frames.length > 30) this.frames.shift();
    }
    this.dirty = false;
    if (this.anim || this.focus) this.raf = requestAnimationFrame(this.frame);
  };

  private toScreen(x: number, y: number, W: number, H: number): [number, number] {
    return [W / 2 + this.offX + (x - this.cx) * this.scale, H / 2 + this.offY - (y - this.cy) * this.scale];
  }

  private draw(now: number): void {
    const ctx = this.ctx;
    const dpr = this.canvas.width / Math.max(1, this.canvas.getBoundingClientRect().width || 1);
    const W = this.canvas.width / dpr;
    const H = this.canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#2b2f2a';
    ctx.fillRect(0, 0, W, H);
    const t = this.terrain;
    if (!t) return;
    const half = this.halfExtent();
    const [x0, y0] = this.toScreen(-half, half, W, H);
    const size = 2 * half * this.scale;
    ctx.imageSmoothingEnabled = true;
    const base = this.baseImagery ?? this.base;
    if (base) ctx.drawImage(base, x0, y0, size, size);
    if (this.overlay) {
      ctx.globalAlpha = this.layers.overlayOpacity;
      const og = this.snapshot?.fire.grid ?? t.grid;
      const oh = (og.nx * og.cellSize) / 2;
      const [ox, oy] = this.toScreen(og.x0 + (og.nx - 1) * og.cellSize * 0.5 - oh, og.y0 + (og.ny - 1) * og.cellSize * 0.5 + oh, W, H);
      ctx.drawImage(this.overlay, ox, oy, 2 * oh * this.scale, 2 * oh * this.scale);
      ctx.globalAlpha = 1;
    }
    if (this.fireCanvas && this.snapshot) {
      const fg = this.snapshot.fire.grid;
      const fh = (fg.nx * fg.cellSize) / 2;
      const [fx, fy] = this.toScreen(-fh, fh, W, H);
      const fs = 2 * fh * this.scale;
      ctx.drawImage(this.fireCanvas, fx, fy, fs, fs);
      if (this.glowCanvas && this.layers.flames) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.filter = 'blur(6px)';
        ctx.drawImage(this.glowCanvas, fx, fy, fs, fs);
        ctx.restore();
      }
    }
    this.drawCrossSection(W, H);
    this.drawIgnitions(W, H);
    if (this.layers.embers) this.drawEmbers(W, H);
    if (this.layers.wind !== 'off') this.drawWind(W, H);
    if (this.layers.insightMarkers) this.drawInsights(W, H, now);
    this.drawBrush(W, H);
    this.drawUser(W, H);
    this.drawCompassAndScale(W, H);
  }

  private drawIgnitions(W: number, H: number): void {
    const ctx = this.ctx;
    for (const ign of this.ignitions) {
      const col = IGNITION_COLOURS[ign.origin];
      const pts = ign.points.map(([x, y]) => this.toScreen(x, y, W, H));
      if (ign.kind === 'point' || pts.length === 1) {
        const [sx, sy] = pts[0]!;
        ctx.beginPath();
        ctx.arc(sx, sy, 9, 0, 2 * Math.PI);
        ctx.fillStyle = col;
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      } else {
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        pts.forEach(([sx, sy], i) => (i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy)));
        ctx.lineWidth = 9;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        ctx.lineWidth = 5;
        ctx.strokeStyle = col;
        if (ign.origin === 'backburn') ctx.setLineDash([10, 6]);
        ctx.stroke();
        ctx.restore();
      }
    }
    // User-marked spot fires (setIgnitions) plus the simulated ones in the snapshot, as the 3-D view draws them.
    for (const s of [...this.spots, ...(this.snapshot?.spotFires ?? [])]) {
      const [sx, sy] = this.toScreen(s.x, s.y, W, H);
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#ff8c1a';
      ctx.strokeStyle = '#1a0a00';
      ctx.lineWidth = 2.5;
      ctx.fillRect(-7, -7, 14, 14);
      ctx.strokeRect(-7, -7, 14, 14);
      ctx.restore();
    }
  }

  private drawEmbers(W: number, H: number): void {
    const e = this.snapshot?.embers;
    if (!e || e.count === 0) return;
    const ctx = this.ctx;
    ctx.save();
    const step = Math.max(1, Math.floor(e.count / 400)); // keep it readable: at most ~400 sparks
    for (let i = 0; i < e.count; i += step) {
      const [sx, sy] = this.toScreen(e.data[i * 4]!, e.data[i * 4 + 1]!, W, H);
      const hot = e.data[i * 4 + 3]!;
      ctx.globalAlpha = 0.35 + 0.6 * hot;
      ctx.fillStyle = hot > 0.6 ? '#ffd27a' : '#ff8a2a';
      ctx.beginPath();
      ctx.arc(sx, sy, 1.6, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawWind(W: number, H: number): void {
    const s = this.snapshot;
    if (!s) return;
    const ctx = this.ctx;
    const w = s.stats.weather;
    const a = s.atmosphere;
    const step = 96;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let sy = step * 0.75; sy < H; sy += step) {
      for (let sx = step / 2; sx < W; sx += step) {
        const x = this.cx + (sx - W / 2) / this.scale;
        const y = this.cy - (sy - H / 2) / this.scale;
        if (Math.abs(x) > this.halfExtent() || Math.abs(y) > this.halfExtent()) continue;
        let u: number;
        let v: number;
        if (a) {
          u = sampleBilinear(a.grid, a.surfaceU, x, y);
          v = sampleBilinear(a.grid, a.surfaceV, x, y);
        } else [u, v] = windToUV(w.windSpeed10, w.windDir10);
        const sp = Math.hypot(u, v);
        if (sp < 0.2) continue;
        const L = 14 + Math.min(26, sp * 2.2);
        const dx = (u / sp) * L;
        const dy = (-v / sp) * L;
        const draw = (width: number, colour: string): void => {
          ctx.lineWidth = width;
          ctx.strokeStyle = colour;
          ctx.beginPath();
          ctx.moveTo(sx - dx / 2, sy - dy / 2);
          ctx.lineTo(sx + dx / 2, sy + dy / 2);
          const ang = Math.atan2(dy, dx);
          ctx.moveTo(sx + dx / 2, sy + dy / 2);
          ctx.lineTo(sx + dx / 2 - 8 * Math.cos(ang - 0.5), sy + dy / 2 - 8 * Math.sin(ang - 0.5));
          ctx.moveTo(sx + dx / 2, sy + dy / 2);
          ctx.lineTo(sx + dx / 2 - 8 * Math.cos(ang + 0.5), sy + dy / 2 - 8 * Math.sin(ang + 0.5));
          ctx.stroke();
        };
        draw(5, 'rgba(0,0,0,0.55)');
        draw(2.5, 'rgba(255,255,255,0.95)');
      }
    }
    ctx.restore();
  }

  private drawInsights(W: number, H: number, now: number): void {
    const ctx = this.ctx;
    for (const ins of this.insights) {
      const [sx, sy] = this.toScreen(ins.x, ins.y, W, H);
      ctx.beginPath();
      ctx.arc(sx, sy, 10, 0, 2 * Math.PI);
      ctx.fillStyle = SEVERITY[ins.severity];
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.fillStyle = ins.severity === 'watch' ? '#1a1400' : '#ffffff';
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ins.severity === 'info' ? 'i' : '!', sx, sy + 1);
    }
    if (this.focus) {
      const [sx, sy] = this.toScreen(this.focus.x, this.focus.y, W, H);
      const p = (now % 1400) / 1400;
      ctx.beginPath();
      ctx.arc(sx, sy, 14 + 26 * p, 0, 2 * Math.PI);
      ctx.lineWidth = 4;
      ctx.strokeStyle = `rgba(255,255,255,${1 - p})`;
      ctx.stroke();
    }
  }

  private drawBrush(W: number, H: number): void {
    const b = this.brush;
    if (!b) return;
    const ctx = this.ctx;
    const [sx, sy] = this.toScreen(b.x, b.y, W, H);
    ctx.save();
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(6, b.radius * this.scale), 0, 2 * Math.PI);
    ctx.fillStyle = b.colour + '44';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = b.colour;
    ctx.setLineDash([8, 5]);
    ctx.stroke();
    ctx.restore();
  }

  private drawUser(W: number, H: number): void {
    const u = this.user;
    if (!u) return;
    const ctx = this.ctx;
    const [sx, sy] = this.toScreen(u.x, u.y, W, H);
    if (u.heading !== null) {
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(u.heading * DEG);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, 34, -Math.PI / 2 - 0.45, -Math.PI / 2 + 0.45);
      ctx.closePath();
      ctx.fillStyle = 'rgba(26,115,232,0.35)';
      ctx.fill();
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(sx, sy, 9, 0, 2 * Math.PI);
    ctx.fillStyle = '#1a73e8';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }

  private drawCrossSection(W: number, H: number): void {
    const cs = this.layers.crossSection;
    if (!cs.enabled) return;
    const ctx = this.ctx;
    const L = this.halfExtent() * 1.4;
    const [dx, dy] = [Math.sin(cs.azimuth * DEG) * L, Math.cos(cs.azimuth * DEG) * L];
    const a = this.toScreen(cs.centre[0] - dx, cs.centre[1] - dy, W, H);
    const b = this.toScreen(cs.centre[0] + dx, cs.centre[1] + dy, W, H);
    ctx.save();
    ctx.setLineDash([14, 8]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
    ctx.restore();
  }

  private drawCompassAndScale(_W: number, H: number): void {
    const ctx = this.ctx;
    // North arrow (the 2-D map is always north-up).
    const nx = 30;
    const ny = H * 0.62;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.arc(nx, ny, 20, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(nx, ny - 14);
    ctx.lineTo(nx + 7, ny + 6);
    ctx.lineTo(nx, ny + 2);
    ctx.lineTo(nx - 7, ny + 6);
    ctx.closePath();
    ctx.fill();
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', nx, ny - 26);
    // Scale bar.
    const target = 110 / this.scale;
    const nice = [100, 200, 250, 500, 1000, 2000, 2500, 5000].find((v) => v >= target * 0.6) ?? 5000;
    const px = nice * this.scale;
    const bx = 12;
    const by = ny + 44;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(bx - 4, by - 18, px + 8, 28);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(bx, by, px, 4);
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, bx, by - 6);
    ctx.restore();
  }

  // ───────────────────────────── gestures ─────────────────────────────

  private readonly onDown = (e: PointerEvent): void => {
    if (!this.interaction) return;
    this.canvas.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.anim = null;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), scale: this.scale };
    }
  };

  private readonly onMove = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    if (!p || !this.interaction) return;
    if (this.pointers.size === 1) {
      this.cx -= (e.clientX - p.x) / this.scale;
      this.cy += (e.clientY - p.y) / this.scale;
      this.clampView();
    }
    p.x = e.clientX;
    p.y = e.clientY;
    if (this.pointers.size === 2 && this.pinch) {
      const [a, b] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      this.scale = this.clampScale((this.pinch.scale * d) / Math.max(1, this.pinch.d));
    }
    this.invalidate();
  };

  private readonly onUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
  };

  private readonly onWheel = (e: WheelEvent): void => {
    if (!this.interaction) return;
    e.preventDefault();
    const before = this.pickGround(e.clientX, e.clientY);
    this.scale = this.clampScale(this.scale * Math.exp(-e.deltaY * 0.0015));
    const after = this.pickGround(e.clientX, e.clientY);
    if (before && after) {
      this.cx += before[0] - after[0];
      this.cy += before[1] - after[1];
    }
    this.invalidate();
  };

  private clampScale(s: number): number {
    const r = this.container.getBoundingClientRect();
    const minS = (Math.min(r.width, r.height) || 400) / (this.halfExtent() * 4);
    return Math.min(2, Math.max(minS, s));
  }

  private clampView(): void {
    const h = this.halfExtent();
    this.cx = Math.max(-h, Math.min(h, this.cx));
    this.cy = Math.max(-h, Math.min(h, this.cy));
  }
}
