/**
 * What this phone is, for the "Simulation debug statistics" screen (workstream A, §5.3 "Phone: hardware" and "Phone: software
 * and graphics"). Web APIs only (decision D5: no native plugin): User-Agent Client Hints where the WebView offers them, else
 * the user agent, whose raw text is always kept so the first copy from a phone shows exactly what its WebView reports. A
 * reduced user agent ("Android 10; K") hides the model and the Android version: that is said, not guessed.
 *
 * Every probe reads an injectable {@link DeviceEnv}, so node tests can feed fixtures (a reduced and a normal WebView user
 * agent, no Client Hints, no battery, no WebGPU, no WebGL2). Nothing here is a serial number or an advertising id, and
 * nothing leaves the phone. `deviceInfoNow` is cheap and re-read every second (the window size changes with rotation);
 * `deviceInfoAsync` runs once and is cached.
 */
import { Capacitor } from '@capacitor/core';
import { openWebgl2 } from './bootDiagnostics';

// ───────────────────────────── the environment (what the probes read) ─────────────────────────────

interface UaData {
  brands?: { brand: string; version: string }[];
  mobile?: boolean;
  platform?: string;
  getHighEntropyValues?(hints: string[]): Promise<Record<string, unknown>>;
}
interface GpuAdapter {
  info?: { vendor?: string; architecture?: string };
  requestAdapterInfo?(): Promise<{ vendor?: string; architecture?: string }>;
}
export interface NavLike {
  userAgent?: string;
  hardwareConcurrency?: number;
  deviceMemory?: number;
  maxTouchPoints?: number;
  userAgentData?: UaData;
  getBattery?(): Promise<{ level: number; charging: boolean }>;
  storage?: { estimate?(): Promise<{ usage?: number; quota?: number }> };
  gpu?: { requestAdapter?(): Promise<GpuAdapter | null> };
}

/** Everything the probes read; the browser's own is {@link browserEnv}. Missing pieces mean "the browser has no such thing". */
export interface DeviceEnv {
  platform: string;
  nav: NavLike;
  screen?: { width?: number; height?: number };
  win?: { innerWidth?: number; innerHeight?: number; devicePixelRatio?: number };
  matchMedia?(query: string): { matches: boolean };
  openGl2?(): WebGL2RenderingContext | null;
  raf?(cb: (t: number) => void): number;
  /** Feature flags the browser's globals give (WebAssembly.validate of a SIMD module, SharedArrayBuffer, ...). */
  wasm?: { validate(bytes: BufferSource): boolean };
  sharedArrayBuffer?: boolean;
  crossOriginIsolated?: boolean;
  offscreenCanvas?: boolean;
  moduleWorkers?(): boolean;
  /** How long the Client Hints, the GPU adapter and the refresh-rate measurement may take (ms). */
  timeoutMs?: number;
}

export function browserEnv(): DeviceEnv {
  const g = globalThis as unknown as Record<string, unknown> & { navigator?: NavLike; screen?: DeviceEnv['screen'] };
  const has = (k: string): boolean => typeof g[k] !== 'undefined';
  return {
    platform: Capacitor.getPlatform(),
    nav: g.navigator ?? {},
    ...(g.screen ? { screen: g.screen } : {}),
    win: g as unknown as DeviceEnv['win'],
    ...(typeof g.matchMedia === 'function' ? { matchMedia: (q: string) => (g.matchMedia as (q: string) => { matches: boolean })(q) } : {}),
    openGl2: openWebgl2,
    ...(typeof g.requestAnimationFrame === 'function' ? { raf: (cb: (t: number) => void) => (g.requestAnimationFrame as (cb: (t: number) => void) => number)(cb) } : {}),
    ...(typeof WebAssembly !== 'undefined' ? { wasm: WebAssembly } : {}),
    sharedArrayBuffer: has('SharedArrayBuffer'),
    ...(typeof g.crossOriginIsolated === 'boolean' ? { crossOriginIsolated: g.crossOriginIsolated } : {}),
    offscreenCanvas: has('OffscreenCanvas'),
    moduleWorkers: probeModuleWorkers,
  };
}

/** A module worker is supported when constructing one reads the `type` option (it is stopped at once; the worker has no code). */
function probeModuleWorkers(): boolean {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') return false;
  let read = false;
  const url = URL.createObjectURL(new Blob([''], { type: 'text/javascript' }));
  try {
    const w = new Worker(url, {
      get type() {
        read = true;
        return 'module' as WorkerType;
      },
    });
    w.terminate();
  } catch {
    /* no workers from a blob here */
  } finally {
    URL.revokeObjectURL(url);
  }
  return read;
}

// ───────────────────────────── user agent ─────────────────────────────

export interface UaFacts {
  /** The phone model the user agent names, or null when it does not (a reduced user agent says "K"). */
  model: string | null;
  /** The Android version it names ("13", "8.1"), or null when it does not (a reduced one freezes it at 10). */
  androidVersion: string | null;
  /** The Chromium version ("120.0.6099.144", or just "120" when the minor parts are zeroed). */
  chromium: string | null;
  webview: boolean;
  /** Chromium's reduced user agent: the model and Android version are not in it. */
  reduced: boolean;
}

export function parseUserAgent(ua: string): UaFacts {
  const m = /Android\s+([\d.]+)(?:;\s*([^;)]*))?/.exec(ua);
  const model = m?.[2]?.replace(/\s*Build\/\S*/, '').trim() ?? '';
  const reduced = model === 'K';
  const c = /(?:Chrome|CriOS)\/(\d+(?:\.\d+){0,3})/.exec(ua)?.[1] ?? null;
  return {
    model: !reduced && model ? model : null,
    androidVersion: !reduced && m ? m[1]! : null,
    chromium: c !== null && /^\d+\.0\.0\.0$/.test(c) ? c.split('.')[0]! : c,
    webview: /;\s*wv\)/.test(ua),
    reduced,
  };
}

/** Android API level of a release ("13" → 33, "8.1" → 27); null for a version this table does not know. */
export function apiLevelOf(version: string | null): number | null {
  if (!version) return null;
  const [maj, min = 0] = version.split('.').map(Number) as [number, number?];
  if (!Number.isFinite(maj) || maj < 5) return null;
  if (maj === 5) return min >= 1 ? 22 : 21;
  if (maj === 6) return 23;
  if (maj === 7) return min >= 1 ? 25 : 24;
  if (maj === 8) return min >= 1 ? 27 : 26;
  if (maj === 12) return min >= 1 ? 32 : 31; // 12L / 12.1 is API 32
  if (maj <= 11) return maj + 19;
  return maj <= 16 ? maj + 20 : null; // 13 is API 33 (32 was the 12L release)
}

const MAKERS: [RegExp, string][] = [
  [/^(Pixel|Nexus)/i, 'Google'],
  [/^(SM-|GT-|SAMSUNG)/i, 'Samsung'],
  [/^(Redmi|POCO|Mi |M\d{4})/i, 'Xiaomi'],
  [/^(moto|XT\d{4})/i, 'Motorola'],
  [/^(XQ-|SO-|SOG)/i, 'Sony'],
  [/^(OnePlus|CPH|IN\d{4}|LE\d{4})/i, 'OnePlus or OPPO'],
];

/** The maker, guessed from the start of a model name (the WebView never says it); null when the name is not in a short list. */
export function makerOf(model: string | null): string | null {
  return model ? (MAKERS.find(([re]) => re.test(model))?.[1] ?? null) : null;
}

// ───────────────────────────── the synchronous part ─────────────────────────────

export interface DeviceNow {
  platform: string;
  userAgent: string;
  ua: UaFacts;
  cores: number | null;
  /** `navigator.deviceMemory` in GB: a coarse bucket (0.25, 0.5, 1, 2, 4, 8), not the real size. */
  memoryGb: number | null;
  touchPoints: number | null;
  /** `screen` in CSS px, the window in CSS px and the device pixel ratio. */
  screenCss: [number, number] | null;
  windowCss: [number, number] | null;
  pixelRatio: number | null;
  /** Client Hints brands that come without a request ("Chromium 120", "Android WebView 120"), and the platform they report. */
  brands: string[];
  hintsPresent: boolean;
  hintPlatform: string | null;
  reducedMotion: boolean | null;
  moreContrast: boolean | null;
  darkScheme: boolean | null;
}

const pos = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const pair = (a: unknown, b: unknown): [number, number] | null => (pos(a) !== null && pos(b) !== null ? [a as number, b as number] : null);

export function deviceInfoNow(env: DeviceEnv = browserEnv()): DeviceNow {
  const nav = env.nav;
  const ua = typeof nav.userAgent === 'string' ? nav.userAgent : '';
  const data = nav.userAgentData;
  const media = (q: string): boolean | null => {
    try {
      return env.matchMedia ? env.matchMedia(q).matches : null;
    } catch {
      return null;
    }
  };
  return {
    platform: env.platform,
    userAgent: ua,
    ua: parseUserAgent(ua),
    cores: pos(nav.hardwareConcurrency),
    memoryGb: pos(nav.deviceMemory),
    touchPoints: typeof nav.maxTouchPoints === 'number' ? nav.maxTouchPoints : null,
    screenCss: pair(env.screen?.width, env.screen?.height),
    windowCss: pair(env.win?.innerWidth, env.win?.innerHeight),
    pixelRatio: pos(env.win?.devicePixelRatio),
    brands: (data?.brands ?? []).filter((b) => !/not.?a.?brand/i.test(b.brand)).map((b) => `${b.brand} ${b.version}`),
    hintsPresent: !!data,
    hintPlatform: data?.platform ?? null,
    reducedMotion: media('(prefers-reduced-motion: reduce)'),
    moreContrast: media('(prefers-contrast: more)'),
    darkScheme: media('(prefers-color-scheme: dark)'),
  };
}

// ───────────────────────────── the asynchronous part ─────────────────────────────

/** What the high-entropy Client Hints said, when the WebView answered. */
export interface HighHints {
  model: string | null;
  platformVersion: string | null;
  architecture: string | null;
  bitness: string | null;
  /** "Android WebView 120.0.6099.144" and the like; the full versions. */
  fullVersions: string[];
}

export interface GlInfo {
  /** False when no WebGL2 context could be made: the 3-D view cannot run (the 2-D map is used). */
  ok: boolean;
  vendor: string | null;
  renderer: string | null;
  maxTextureSize: number | null;
  /** Render into float and half-float textures, and filter float textures (the air and wind fields need them). */
  floatTargets: boolean;
  halfFloatTargets: boolean;
  floatLinear: boolean;
  /** Compressed texture families the GPU takes ("ASTC", "ETC2", "S3TC"). */
  compressed: string[];
}

export interface GpuInfo {
  /** `navigator.gpu` is there; `adapter` is what it named within the timeout (null: none, or it did not answer). */
  present: boolean;
  adapter: { vendor: string | null; architecture: string | null } | null;
}

export interface DeviceLater {
  hints: HighHints | null;
  battery: { level: number; charging: boolean } | null;
  storage: { usage: number; quota: number } | null;
  /** Display refresh rate (Hz), measured from 30 animation frames; null when it could not be. */
  refreshHz: number | null;
  gl: GlInfo;
  gpu: GpuInfo;
  wasm: boolean;
  simd: boolean;
  sharedArrayBuffer: boolean;
  crossOriginIsolated: boolean | null;
  offscreenCanvas: boolean;
  moduleWorkers: boolean;
}

/** Wasm module with one SIMD instruction: validates only where the engine has SIMD (the probe the wasm-feature-detect library uses). */
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

/** The promise's value, or null when it is rejected or takes longer than `ms`. */
function within<T>(p: Promise<T> | undefined, ms: number): Promise<T | null> {
  if (!p) return Promise.resolve(null);
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(null);
      },
    );
  });
}

function probeGl(env: DeviceEnv): GlInfo {
  const none: GlInfo = { ok: false, vendor: null, renderer: null, maxTextureSize: null, floatTargets: false, halfFloatTargets: false, floatLinear: false, compressed: [] };
  try {
    const gl = env.openGl2?.() ?? null;
    if (!gl) return none;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const text = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
    const out: GlInfo = {
      ok: true,
      vendor: dbg ? text(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)) : null,
      renderer: dbg ? text(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : null,
      maxTextureSize: pos(gl.getParameter(gl.MAX_TEXTURE_SIZE)),
      floatTargets: !!gl.getExtension('EXT_color_buffer_float'),
      halfFloatTargets: !!gl.getExtension('EXT_color_buffer_half_float') || !!gl.getExtension('EXT_color_buffer_float'),
      floatLinear: !!gl.getExtension('OES_texture_float_linear'),
      compressed: [
        ['WEBGL_compressed_texture_astc', 'ASTC'],
        ['WEBGL_compressed_texture_etc', 'ETC2'],
        ['WEBGL_compressed_texture_s3tc', 'S3TC'],
      ]
        .filter(([ext]) => !!gl.getExtension(ext!))
        .map(([, name]) => name!),
    };
    // The throwaway context is not "lost" on purpose (Chromium logs a warning for that); it is released when it is collected.
    return out;
  } catch {
    return none;
  }
}

async function probeGpu(env: DeviceEnv, ms: number): Promise<GpuInfo> {
  const gpu = env.nav.gpu;
  if (!gpu) return { present: false, adapter: null };
  const adapter = await within(gpu.requestAdapter?.(), ms);
  if (!adapter) return { present: true, adapter: null };
  const info = adapter.info ?? (await within(adapter.requestAdapterInfo?.(), ms)) ?? {};
  return { present: true, adapter: { vendor: info.vendor || null, architecture: info.architecture || null } };
}

/** The median frame interval of 30 animation frames as Hz (null when frames do not come, e.g. the page is hidden). */
function measureRefresh(env: DeviceEnv, ms: number): Promise<number | null> {
  const raf = env.raf;
  if (!raf) return Promise.resolve(null);
  return new Promise((resolve) => {
    const times: number[] = [];
    const timer = setTimeout(() => resolve(null), ms);
    const step = (t: number): void => {
      times.push(t);
      if (times.length < 31) {
        raf(step);
        return;
      }
      clearTimeout(timer);
      const d = times
        .slice(1)
        .map((v, i) => v - times[i]!)
        .sort((a, b) => a - b);
      const med = d[d.length >> 1]!;
      resolve(med > 0 ? Math.round(1000 / med) : null);
    };
    raf(step);
  });
}

async function readHints(env: DeviceEnv, ms: number): Promise<HighHints | null> {
  const data = env.nav.userAgentData;
  const v = await within(data?.getHighEntropyValues?.(['model', 'platformVersion', 'architecture', 'bitness', 'fullVersionList']), ms);
  if (!v) return null;
  const str = (k: string): string | null => (typeof v[k] === 'string' && v[k] ? (v[k] as string) : null);
  const list = Array.isArray(v.fullVersionList) ? (v.fullVersionList as { brand?: string; version?: string }[]) : [];
  return {
    model: str('model'),
    platformVersion: str('platformVersion'),
    architecture: str('architecture'),
    bitness: str('bitness'),
    fullVersions: list.filter((b) => b.brand && b.version && !/not.?a.?brand/i.test(b.brand)).map((b) => `${b.brand} ${b.version}`),
  };
}

/** The slow facts: Client Hints, battery, storage, the GPU, the refresh rate and the graphics probe. Never rejects. */
export async function deviceInfoAsync(env: DeviceEnv = browserEnv()): Promise<DeviceLater> {
  const ms = env.timeoutMs ?? 1000;
  const nav = env.nav;
  const [hints, battery, storage, gpu, refreshHz] = await Promise.all([
    readHints(env, ms),
    within(nav.getBattery?.(), ms),
    within(nav.storage?.estimate?.(), ms),
    probeGpu(env, ms).catch((): GpuInfo => ({ present: true, adapter: null })),
    measureRefresh(env, 2 * ms).catch(() => null),
  ]);
  let simd = false;
  try {
    simd = !!env.wasm?.validate(SIMD_PROBE);
  } catch {
    /* no */
  }
  let moduleWorkers = false;
  try {
    moduleWorkers = !!env.moduleWorkers?.();
  } catch {
    /* no */
  }
  return {
    hints,
    battery: battery && typeof battery.level === 'number' && Number.isFinite(battery.level) ? { level: battery.level, charging: !!battery.charging } : null,
    storage: storage && pos(storage.usage) !== null && pos(storage.quota) !== null ? { usage: storage.usage!, quota: storage.quota! } : null,
    refreshHz,
    gl: probeGl(env),
    gpu,
    wasm: !!env.wasm,
    simd,
    sharedArrayBuffer: !!env.sharedArrayBuffer,
    crossOriginIsolated: typeof env.crossOriginIsolated === 'boolean' ? env.crossOriginIsolated : null,
    offscreenCanvas: !!env.offscreenCanvas,
    moduleWorkers,
  };
}

// ───────────────────────────── identity: Client Hints first, else the user agent ─────────────────────────────

export interface PhoneIdentity {
  /** Model and maker; null when neither the Client Hints nor the user agent name the model. */
  model: string | null;
  maker: string | null;
  /** Where the model came from; 'hidden' when the WebView reduces its user agent and gave no Client Hint. */
  modelFrom: 'client hints' | 'user agent' | 'hidden' | 'none';
  androidVersion: string | null;
  apiLevel: number | null;
  androidFrom: 'client hints' | 'user agent' | 'hidden' | 'none';
  /** "120.0.6099.144" (full version from the hints) or what the user agent says; null if absent. */
  chromium: string | null;
  webview: boolean;
}

/** Combine what the user agent and the Client Hints say about the phone (the hints win: they are not reduced). */
export function phoneIdentity(now: DeviceNow, later: DeviceLater | null): PhoneIdentity {
  const h = later?.hints ?? null;
  const onAndroid = now.hintPlatform === 'Android' || /android/i.test(now.platform) || now.ua.androidVersion !== null || now.ua.reduced;
  const model = h?.model ?? now.ua.model;
  const modelFrom = h?.model ? 'client hints' : now.ua.model ? 'user agent' : now.ua.reduced ? 'hidden' : 'none';
  const hintVersion = onAndroid && h?.platformVersion ? h.platformVersion.replace(/(\.0)+$/, '') : null;
  const androidVersion = hintVersion || now.ua.androidVersion;
  const androidFrom = hintVersion ? 'client hints' : now.ua.androidVersion ? 'user agent' : now.ua.reduced ? 'hidden' : 'none';
  const pick = (re: RegExp): string | undefined => h?.fullVersions.find((v) => re.test(v));
  const full = pick(/webview/i) ?? pick(/^chromium/i) ?? pick(/chrome/i);
  const chromium = full ? full.replace(/^.*\s/, '') : now.ua.chromium;
  return {
    model,
    maker: makerOf(model),
    modelFrom,
    androidVersion,
    apiLevel: apiLevelOf(androidVersion),
    androidFrom,
    chromium,
    webview: now.ua.webview || (now.brands.concat(h?.fullVersions ?? [])).some((b) => /webview/i.test(b)),
  };
}

// ───────────────────────────── the cached browser reading ─────────────────────────────

let laterOnce: Promise<DeviceLater> | null = null;

/** The slow facts of this browser, read once (the first call starts the reading; later calls share it). */
export function deviceLater(): Promise<DeviceLater> {
  return (laterOnce ??= deviceInfoAsync());
}
