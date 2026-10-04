/**
 * The user's layer choices, remembered between runs ("what was on last time"): every switch, heat map, canopy style and
 * map type the user sets in the Layers panel is saved to the UI preferences (prefs.ts; Capacitor Preferences on the device),
 * and a new simulation starts from the device's defaults with those choices on top. Only choices the user made are
 * stored (never a default), so battery mode keeps its lighter defaults for everything the user did not touch.
 *
 * A remembered heat map is restored only where it can be shown (not the fire maps before a fire, not the homes map
 * where there are no homes); the aerial photo only where there is one. The vertical air slice is never restored (its
 * position belongs to one scenario). Nothing here pauses, redraws heavy geometry or opens anything.
 *
 * Wiring (simScreen.ts, once the SimContext exists): `unsubs.push(restoreLayerPrefs(ctx))`.
 */
import type { AvailabilityContext } from '../../../render/layerCatalog';
import { availabilityContext, layerForOverlay, HEAT_OVERLAY_KINDS } from '../../../render/layerCatalog';
import { DEFAULT_LAYERS, type LayerState } from '../../../render/layers';
import { getPref, setPref } from '../../prefs';
import { performanceProfile, type PerformanceMode } from '../../settings';
import type { SimContext } from './context';

export const LAYER_PREFS_KEY = 'layers';
export const LAYER_PREFS_VERSION = 1;

/** LayerState keys a user choice is remembered for (crossSection is scenario-specific; `legend` is not a choice). */
export const PERSISTED_LAYER_KEYS = [
  'imagery',
  'vegetation',
  'understorey',
  'flames',
  'smoke',
  'embers',
  'wind',
  'insightMarkers',
  'roads',
  'fireTrails',
  'homes',
  'zones',
  'placeNames',
  'overlay',
  'overlayOpacity',
  'isochroneMinutes',
  'canopyStyle',
  'canopyCode',
  'windSway',
  'soloHeat',
  'verticalExaggeration',
] as const satisfies readonly (keyof LayerState)[];
export type PersistedLayerKey = (typeof PERSISTED_LAYER_KEYS)[number];

export interface LayerPrefs {
  v: typeof LAYER_PREFS_VERSION;
  /** The user's choices (only what was set in the panel). */
  layers: Partial<Pick<LayerState, PersistedLayerKey>>;
  /** Map type 'Plain' (a view setting, not a LayerState key). */
  plainGround?: boolean;
  /** Heat-map groups the user opened (true) or closed (false). */
  groups?: Partial<Record<string, boolean>>;
}

const BOOL_KEYS = new Set<PersistedLayerKey>(['imagery', 'vegetation', 'understorey', 'flames', 'smoke', 'embers', 'insightMarkers', 'roads', 'fireTrails', 'homes', 'zones', 'placeNames', 'windSway', 'soloHeat']);
const OVERLAYS = new Set<string>(['none', ...HEAT_OVERLAY_KINDS]);

/** Keep only well-formed values (an old or damaged record never breaks the start of a run). */
export function sanitizeLayerPrefs(raw: unknown): LayerPrefs {
  const out: LayerPrefs = { v: LAYER_PREFS_VERSION, layers: {} };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  if (r.v !== LAYER_PREFS_VERSION) return out;
  const src = (r.layers && typeof r.layers === 'object' ? r.layers : {}) as Record<string, unknown>;
  const l = out.layers as Record<string, unknown>;
  for (const k of PERSISTED_LAYER_KEYS) {
    const v = src[k];
    if (v === undefined) continue;
    if (BOOL_KEYS.has(k)) {
      if (typeof v === 'boolean') l[k] = v;
    } else if (k === 'overlay') {
      if (typeof v === 'string' && OVERLAYS.has(v)) l[k] = v;
    } else if (k === 'wind') {
      if (v === 'off' || v === 'surface' || v === 'volume') l[k] = v;
    } else if (k === 'canopyStyle') {
      if (v === 'natural' || v === 'simple' || v === 'coded') l[k] = v;
    } else if (k === 'canopyCode') {
      if (v === 'height' || v === 'cover' || v === 'bark' || v === 'understorey') l[k] = v;
    } else if (k === 'overlayOpacity') {
      if (typeof v === 'number' && Number.isFinite(v)) l[k] = Math.min(1, Math.max(0.2, v));
    } else if (k === 'isochroneMinutes') {
      if (v === 0 || v === 15 || v === 30 || v === 60) l[k] = v;
    } else if (k === 'verticalExaggeration') {
      if (typeof v === 'number' && Number.isFinite(v)) l[k] = Math.min(3, Math.max(1, v));
    }
  }
  if (typeof r.plainGround === 'boolean') out.plainGround = r.plainGround;
  if (r.groups && typeof r.groups === 'object') {
    const g: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(r.groups as Record<string, unknown>)) if (typeof v === 'boolean' && k.length < 64) g[k] = v;
    out.groups = g;
  }
  return out;
}

/**
 * The device's starting layers: the performance mode's smoke and canopy, the photo where there is one, and the trees'
 * wind sway only where it is affordable (it keeps the view redrawing at 30 fps): off in battery mode and on a
 * low-quality renderer.
 */
export function layerDefaults(o: { performance: PerformanceMode; renderQuality?: 'low' | 'medium' | 'high'; hasImagery: boolean }): LayerState {
  const p = performanceProfile(o.performance);
  return {
    ...DEFAULT_LAYERS,
    crossSection: { ...DEFAULT_LAYERS.crossSection },
    smoke: p.smoke,
    vegetation: p.vegetation,
    imagery: o.hasImagery,
    windSway: DEFAULT_LAYERS.windSway && o.performance !== 'battery' && o.renderQuality !== 'low',
  };
}

/**
 * The patch that puts the remembered choices back, as far as they can be shown here: a heat map only if the catalog says
 * it is available now, the photo only if there is one.
 */
export function restorePatch(prefs: LayerPrefs, o: { availability: AvailabilityContext; hasImagery: boolean }): Partial<LayerState> {
  const patch: Partial<LayerState> = { ...prefs.layers };
  if (patch.imagery && !o.hasImagery) delete patch.imagery;
  const ov = patch.overlay;
  if (ov !== undefined && ov !== 'none') {
    const info = layerForOverlay(ov);
    let ok = false;
    try {
      ok = !!info && info.available(o.availability).ok;
    } catch {
      ok = false;
    }
    if (!ok) delete patch.overlay;
  }
  return patch;
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage (one in-memory copy, written through to prefs)
// ─────────────────────────────────────────────────────────────────────────────

let cache: LayerPrefs | null = null;
let loading: Promise<LayerPrefs> | null = null;
let chain: Promise<void> = Promise.resolve();

/** The remembered choices (loaded once per app run). */
export function loadLayerPrefs(): Promise<LayerPrefs> {
  if (cache) return Promise.resolve(cache);
  loading ??= getPref<unknown>(LAYER_PREFS_KEY, null).then((raw) => {
    cache ??= sanitizeLayerPrefs(raw);
    return cache;
  });
  return loading;
}

/** The copy in memory, if loaded (synchronous; the panel reads its group state from it). */
export function cachedLayerPrefs(): LayerPrefs | null {
  return cache;
}

/** Merge a choice into the remembered ones and save (writes are queued in order; never throws). */
export function rememberLayerChoice(change: { layers?: Partial<LayerState>; plainGround?: boolean; groups?: Partial<Record<string, boolean>> }): Promise<void> {
  chain = chain
    .then(async () => {
      const cur = await loadLayerPrefs();
      const layers: Record<string, unknown> = { ...cur.layers };
      for (const k of PERSISTED_LAYER_KEYS) if (change.layers && k in change.layers) layers[k] = change.layers[k];
      const next: LayerPrefs = sanitizeLayerPrefs({
        v: LAYER_PREFS_VERSION,
        layers,
        ...(change.plainGround !== undefined ? { plainGround: change.plainGround } : cur.plainGround !== undefined ? { plainGround: cur.plainGround } : {}),
        groups: { ...(cur.groups ?? {}), ...(change.groups ?? {}) },
      });
      cache = next;
      await setPref(LAYER_PREFS_KEY, next);
    })
    .catch(() => undefined);
  return chain;
}

/** Forget every remembered choice (Reset layers). */
export function forgetLayerPrefs(): Promise<void> {
  chain = chain
    .then(async () => {
      cache = { v: LAYER_PREFS_VERSION, layers: {} };
      await setPref(LAYER_PREFS_KEY, null);
    })
    .catch(() => undefined);
  return chain;
}

/** Tests: drop the in-memory copy so the next load reads the store again. */
export function resetLayerPrefsCache(): void {
  cache = null;
  loading = null;
  chain = Promise.resolve();
}

// ─────────────────────────────────────────────────────────────────────────────
// Sim screen hook
// ─────────────────────────────────────────────────────────────────────────────

/** Is there an aerial photo under this view? (The 3-D view knows; else the scenario's imagery record; else the current switch.) */
export function viewHasImagery(ctx: Pick<SimContext, 'view' | 'scenario' | 'layers'>): boolean {
  const v = (ctx.view as { hasImagery?: boolean }).hasImagery;
  if (typeof v === 'boolean') return v;
  const rec = ctx.scenario.datasets?.find((d) => d.id === 'imagery');
  if (rec) return rec.status === 'used' || rec.status === 'partial';
  return ctx.layers.get().imagery;
}

/**
 * Start a run from the device's defaults plus the remembered choices (applied to the layer store and the view as soon as
 * the preferences are read, a few milliseconds after the screen opens). Returns an unsubscribe (nothing to undo today).
 */
export function restoreLayerPrefs(ctx: Pick<SimContext, 'view' | 'scenario' | 'layers' | 'settings' | 'session'>): () => void {
  let live = true;
  void loadLayerPrefs().then((prefs) => {
    if (!live) return;
    const hasImagery = viewHasImagery(ctx);
    const quality = (ctx.view as { renderQuality?: 'low' | 'medium' | 'high' }).renderQuality;
    const d = layerDefaults({ performance: ctx.settings.get().performance, ...(quality ? { renderQuality: quality } : {}), hasImagery });
    const st = ctx.session.state.get();
    const availability = availabilityContext({ fuel: ctx.scenario.fuel, snapshot: st.snapshot, context: ctx.scenario.context ?? null, hasImagery, fire: st.ignitions.length > 0 || (st.snapshot?.stats?.burntAreaHa ?? 0) > 0 });
    const cur = ctx.layers.get();
    const patch: Partial<LayerState> = { ...(d.windSway !== cur.windSway ? { windSway: d.windSway } : {}), ...restorePatch(prefs, { availability, hasImagery }) };
    for (const k of Object.keys(patch) as (keyof LayerState)[]) if (Object.is(patch[k], cur[k])) delete patch[k];
    if (Object.keys(patch).length) {
      ctx.view.setLayers(patch);
      ctx.layers.set(patch);
    }
    if (prefs.plainGround !== undefined) (ctx.view as { setPlainGround?(on: boolean): void }).setPlainGround?.(prefs.plainGround);
  });
  return () => {
    live = false;
  };
}
