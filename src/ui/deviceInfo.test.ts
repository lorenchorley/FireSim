/**
 * Phone facts (deviceInfo.ts) with stubbed browsers: a reduced user agent, a normal WebView user agent, Client Hints that
 * answer, hang or are missing, no battery API, no WebGPU, WebGL2 that cannot be created, and the refresh-rate measurement.
 */
import { describe, expect, it } from 'vitest';
import { apiLevelOf, deviceInfoAsync, deviceInfoNow, deviceVolatile, makerOf, parseUserAgent, phoneIdentity, type DeviceEnv, type NavLike } from './deviceInfo';

const UA_REDUCED = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const UA_WEBVIEW = 'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.144 Mobile Safari/537.36';
const UA_SAMSUNG = 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.6167.101 Mobile Safari/537.36';

const env = (nav: NavLike, extra: Partial<DeviceEnv> = {}): DeviceEnv => ({ platform: 'android', nav, timeoutMs: 20, ...extra });

/** A WebGL2 context that answers the few questions the probe asks. */
function fakeGl(extensions: string[] = ['WEBGL_debug_renderer_info', 'EXT_color_buffer_float', 'WEBGL_compressed_texture_astc', 'WEBGL_compressed_texture_etc']): WebGL2RenderingContext {
  const dbg = { UNMASKED_VENDOR_WEBGL: 37445, UNMASKED_RENDERER_WEBGL: 37446 };
  return {
    MAX_TEXTURE_SIZE: 3379,
    getParameter: (p: number) => (p === 37445 ? 'ARM' : p === 37446 ? 'Mali-G710' : p === 3379 ? 8192 : null),
    getExtension: (name: string) => {
      if (name === 'WEBGL_debug_renderer_info') return extensions.includes(name) ? dbg : null;
      return extensions.includes(name) ? {} : null;
    },
  } as unknown as WebGL2RenderingContext;
}

/** Every leaf of a value: none may be undefined or NaN (numbers must be finite). */
function expectClean(v: unknown, path = 'info'): void {
  if (v === undefined) throw new Error(`${path} is undefined`);
  if (typeof v === 'number') expect(Number.isFinite(v), path).toBe(true);
  else if (Array.isArray(v)) v.forEach((x, i) => expectClean(x, `${path}[${i}]`));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) expectClean(x, `${path}.${k}`);
}

describe('parseUserAgent', () => {
  it('a normal WebView user agent names the model, the Android version and the full Chromium version', () => {
    expect(parseUserAgent(UA_WEBVIEW)).toEqual({ model: 'Pixel 7', androidVersion: '13', chromium: '120.0.6099.144', webview: true, reduced: false });
  });

  it('a user agent without a build id (Samsung) still names the model', () => {
    expect(parseUserAgent(UA_SAMSUNG)).toMatchObject({ model: 'SM-S918B', androidVersion: '14', chromium: '121.0.6167.101', webview: false, reduced: false });
  });

  it('a reduced user agent hides the model and the Android version (its "10" is a placeholder) and the Chromium minor version', () => {
    expect(parseUserAgent(UA_REDUCED)).toEqual({ model: null, androidVersion: null, chromium: '120', webview: false, reduced: true });
  });

  it('an empty or foreign user agent gives nulls, not guesses', () => {
    expect(parseUserAgent('')).toEqual({ model: null, androidVersion: null, chromium: null, webview: false, reduced: false });
    expect(parseUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.6778.33 Safari/537.36').androidVersion).toBeNull();
  });
});

describe('Android API level and maker', () => {
  it('maps releases to API levels, including the point releases that changed it', () => {
    expect(['8', '8.1', '9', '10', '11', '12', '12.1', '13', '14', '15', '16'].map(apiLevelOf)).toEqual([26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]);
    expect(apiLevelOf(null)).toBeNull();
    expect(apiLevelOf('x')).toBeNull();
    expect(apiLevelOf('99')).toBeNull();
  });

  it('names the maker only for model names it knows', () => {
    expect([makerOf('Pixel 7'), makerOf('SM-S918B'), makerOf('Redmi Note 12'), makerOf('moto g(60)')]).toEqual(['Google', 'Samsung', 'Xiaomi', 'Motorola']);
    expect(makerOf('K2000')).toBeNull();
    expect(makerOf(null)).toBeNull();
  });
});

describe('deviceInfoNow', () => {
  it('reads cores, memory class, screen, pixel ratio, touch points and the preference queries', () => {
    const now = deviceInfoNow(
      env(
        { userAgent: UA_WEBVIEW, hardwareConcurrency: 8, deviceMemory: 4, maxTouchPoints: 5, userAgentData: { platform: 'Android', brands: [{ brand: 'Not_A Brand', version: '8' }, { brand: 'Android WebView', version: '120' }] } },
        { screen: { width: 412, height: 915 }, win: { innerWidth: 412, innerHeight: 800, devicePixelRatio: 2.625 }, matchMedia: (q) => ({ matches: q.includes('reduce') }) },
      ),
    );
    expect(now).toMatchObject({
      platform: 'android',
      userAgent: UA_WEBVIEW,
      cores: 8,
      memoryGb: 4,
      touchPoints: 5,
      screenCss: [412, 915],
      windowCss: [412, 800],
      pixelRatio: 2.625,
      brands: ['Android WebView 120'],
      hintsPresent: true,
      hintPlatform: 'Android',
      reducedMotion: true,
      moreContrast: false,
      darkScheme: false,
    });
    expectClean(now);
  });

  it('an empty browser (no navigator values, no screen, no matchMedia) gives nulls and never throws', () => {
    const now = deviceInfoNow({ platform: 'web', nav: {} });
    expect(now).toMatchObject({ userAgent: '', cores: null, memoryGb: null, touchPoints: null, screenCss: null, windowCss: null, pixelRatio: null, brands: [], hintsPresent: false, reducedMotion: null });
    expectClean(now);
    // A matchMedia that throws counts as "not known".
    expect(
      deviceInfoNow({
        platform: 'web',
        nav: {},
        matchMedia: () => {
          throw new Error('no');
        },
      }).darkScheme,
    ).toBeNull();
  });

  it('zero or non-numeric values do not count as a value', () => {
    const now = deviceInfoNow(env({ userAgent: UA_WEBVIEW, hardwareConcurrency: 0, deviceMemory: NaN }, { win: { devicePixelRatio: 0 } }));
    expect([now.cores, now.memoryGb, now.pixelRatio]).toEqual([null, null, null]);
  });
});

describe('phoneIdentity', () => {
  const hints = { model: 'Pixel 7', platformVersion: '13.0.0', architecture: 'arm', bitness: '64', fullVersions: ['Not_A Brand 8.0.0.0', 'Android WebView 120.0.6099.144', 'Chromium 120.0.6099.144'] };
  const later = (h: object | null) => ({ hints: h }) as unknown as Parameters<typeof phoneIdentity>[1];

  it('a reduced user agent with Client Hints: the hints give the model, the Android version, the API level and the full WebView version', () => {
    const now = deviceInfoNow(env({ userAgent: UA_REDUCED, userAgentData: { platform: 'Android' } }));
    expect(phoneIdentity(now, later(hints))).toEqual({
      model: 'Pixel 7',
      maker: 'Google',
      modelFrom: 'client hints',
      androidVersion: '13',
      apiLevel: 33,
      androidFrom: 'client hints',
      chromium: '120.0.6099.144',
      webview: true,
    });
  });

  it('a reduced user agent and no Client Hints: model and Android version are "hidden", not guessed', () => {
    const now = deviceInfoNow(env({ userAgent: UA_REDUCED }));
    expect(phoneIdentity(now, later(null))).toEqual({ model: null, maker: null, modelFrom: 'hidden', androidVersion: null, apiLevel: null, androidFrom: 'hidden', chromium: '120', webview: false });
    expect(phoneIdentity(now, null).modelFrom).toBe('hidden');
  });

  it('a normal WebView user agent with no Client Hints: model and version from the user agent', () => {
    const now = deviceInfoNow(env({ userAgent: UA_WEBVIEW }));
    expect(phoneIdentity(now, later(null))).toEqual({ model: 'Pixel 7', maker: 'Google', modelFrom: 'user agent', androidVersion: '13', apiLevel: 33, androidFrom: 'user agent', chromium: '120.0.6099.144', webview: true });
  });

  it('nothing known (a desktop browser): "none", no model, no version', () => {
    const now = deviceInfoNow({ platform: 'web', nav: { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' } });
    expect(phoneIdentity(now, null)).toMatchObject({ model: null, modelFrom: 'none', androidVersion: null, androidFrom: 'none', apiLevel: null, chromium: '131' });
  });

  it('a desktop platform version in the hints is not read as an Android version', () => {
    const now = deviceInfoNow({ platform: 'web', nav: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36', userAgentData: { platform: 'Windows' } } });
    expect(phoneIdentity(now, later({ ...hints, model: null, platformVersion: '15.0.0' })).androidVersion).toBeNull();
  });
});

describe('deviceInfoAsync', () => {
  it('everything present: hints, battery, storage, WebGPU adapter, WebGL2 limits, wasm and the refresh rate', async () => {
    let t = 0;
    const later = await deviceInfoAsync(
      env(
        {
          userAgent: UA_WEBVIEW,
          userAgentData: { getHighEntropyValues: async () => ({ model: 'Pixel 7', platformVersion: '13.0.0', architecture: 'arm', bitness: '64', fullVersionList: [{ brand: 'Android WebView', version: '120.0.6099.144' }] }) },
          getBattery: async () => ({ level: 0.8, charging: true }),
          storage: { estimate: async () => ({ usage: 5e6, quota: 4e10 }) },
          gpu: { requestAdapter: async () => ({ info: { vendor: 'arm', architecture: 'valhall' } }) },
        },
        {
          openGl2: () => fakeGl(),
          raf: (cb) => (setTimeout(() => cb((t += 1000 / 60)), 0), 1),
          timeoutMs: 1000,
          wasm: { validate: () => true },
          sharedArrayBuffer: false,
          crossOriginIsolated: false,
          offscreenCanvas: true,
          moduleWorkers: () => true,
        },
      ),
    );
    expect(later.hints).toEqual({ model: 'Pixel 7', platformVersion: '13.0.0', architecture: 'arm', bitness: '64', fullVersions: ['Android WebView 120.0.6099.144'] });
    expect(later.battery).toEqual({ level: 0.8, charging: true });
    expect(later.storage).toEqual({ usage: 5e6, quota: 4e10 });
    expect(later.gpu).toEqual({ present: true, adapter: { vendor: 'arm', architecture: 'valhall' } });
    expect(later.gl).toEqual({ ok: true, vendor: 'ARM', renderer: 'Mali-G710', maxTextureSize: 8192, floatTargets: true, halfFloatTargets: true, floatLinear: false, compressed: ['ASTC', 'ETC2'] });
    expect(later.refreshHz).toBe(60);
    expect([later.wasm, later.simd, later.sharedArrayBuffer, later.crossOriginIsolated, later.offscreenCanvas, later.moduleWorkers]).toEqual([true, true, false, false, true, true]);
    expectClean(later);
  });

  it('no Client Hints, no battery API, no WebGPU, no storage estimate, no animation frames: nulls and "absent", no throw', async () => {
    const later = await deviceInfoAsync(env({ userAgent: UA_REDUCED }, { openGl2: () => fakeGl() }));
    expect(later).toMatchObject({ hints: null, battery: null, storage: null, refreshHz: null, gpu: { present: false, adapter: null }, wasm: false, simd: false, sharedArrayBuffer: false, crossOriginIsolated: null, offscreenCanvas: false, moduleWorkers: false });
    expect(later.gl.ok).toBe(true);
    expectClean(later);
  });

  it('WebGL2 cannot be created (no context, or the call throws): the graphics probe says so', async () => {
    for (const openGl2 of [() => null, () => { throw new Error('context creation failed'); }]) {
      const later = await deviceInfoAsync(env({ userAgent: UA_WEBVIEW }, { openGl2 }));
      expect(later.gl).toEqual({ ok: false, vendor: null, renderer: null, maxTextureSize: null, floatTargets: false, halfFloatTargets: false, floatLinear: false, compressed: [] });
    }
    // No debug extension: the context works but the GPU names stay hidden.
    const masked = await deviceInfoAsync(env({}, { openGl2: () => fakeGl(['EXT_color_buffer_half_float']) }));
    expect(masked.gl).toMatchObject({ ok: true, vendor: null, renderer: null, floatTargets: false, halfFloatTargets: true });
  });

  it('Client Hints that reject or never answer, a battery that rejects and a WebGPU that hangs: each is null within the timeout', async () => {
    const never = new Promise<never>(() => undefined);
    const later = await deviceInfoAsync(
      env({
        userAgent: UA_REDUCED,
        userAgentData: { getHighEntropyValues: () => Promise.reject(new Error('blocked')) },
        getBattery: () => Promise.reject(new Error('blocked')),
        storage: { estimate: () => never },
        gpu: { requestAdapter: () => never },
      }),
    );
    expect(later.hints).toBeNull();
    expect(later.battery).toBeNull();
    expect(later.storage).toBeNull();
    expect(later.gpu).toEqual({ present: true, adapter: null });
  });

  it('WebGPU adapters that only offer requestAdapterInfo (older Chrome) are read through it', async () => {
    const later = await deviceInfoAsync(env({ gpu: { requestAdapter: async () => ({ requestAdapterInfo: async () => ({ vendor: 'qualcomm', architecture: 'adreno-7xx' }) }) } }));
    expect(later.gpu.adapter).toEqual({ vendor: 'qualcomm', architecture: 'adreno-7xx' });
  });

  it('a battery or storage answer with nonsense numbers is dropped; a wasm.validate that throws means no SIMD', async () => {
    const later = await deviceInfoAsync(
      env(
        { getBattery: async () => ({ level: NaN, charging: false }), storage: { estimate: async () => ({ usage: 0, quota: 0 }) } },
        {
          wasm: {
            validate: () => {
              throw new Error('no');
            },
          },
        },
      ),
    );
    expect(later.battery).toBeNull();
    expect(later.storage).toBeNull();
    expect([later.wasm, later.simd]).toEqual([true, false]);
  });

  it('the refresh rate is the median of 30 frames: one slow frame does not move it, 90 and 120 Hz screens are named', async () => {
    const hz = async (dts: number[]): Promise<number | null> => {
      let t = 0;
      let i = 0;
      return (await deviceInfoAsync(env({}, { timeoutMs: 1000, raf: (cb) => (setTimeout(() => cb((t += dts[i++ % dts.length]!)), 0), 1) }))).refreshHz;
    };
    expect(await hz([16.7])).toBe(60);
    expect(await hz([16.7, 16.7, 16.7, 50])).toBe(60);
    expect(await hz([11.1])).toBe(90);
    expect(await hz([8.33])).toBe(120);
  });
});

describe('deviceVolatile', () => {
  it('reads the battery and the storage again each time (the page-long reading of deviceInfoAsync is from the first open)', async () => {
    let level = 0.8;
    let used = 1000;
    const e = env({ getBattery: async () => ({ level, charging: false }), storage: { estimate: async () => ({ usage: used, quota: 5_000_000 }) } });
    expect(await deviceVolatile(e)).toEqual({ battery: { level: 0.8, charging: false }, storage: { usage: 1000, quota: 5_000_000 } });
    level = 0.55; // an hour of play later
    used = 2500;
    expect(await deviceVolatile(e)).toEqual({ battery: { level: 0.55, charging: false }, storage: { usage: 2500, quota: 5_000_000 } });
  });

  it('no battery API, an answer that hangs or nonsense numbers: nulls, no throw', async () => {
    expect(await deviceVolatile(env({}))).toEqual({ battery: null, storage: null });
    const hang = env({ getBattery: () => new Promise(() => undefined), storage: { estimate: async () => ({ usage: Number.NaN, quota: 0 }) } });
    expect(await deviceVolatile(hang)).toEqual({ battery: null, storage: null });
    expect(await deviceVolatile(env({ getBattery: async () => { throw new Error('denied'); } }))).toEqual({ battery: null, storage: null });
  });
});
