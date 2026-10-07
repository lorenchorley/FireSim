/**
 * Emulates the Capacitor **Android** runtime in Chromium so e2e tests exercise the native-only code paths
 * (Capacitor.isNativePlatform() === true, plugin calls over the bridge, CapacitorHttp's patched fetch).
 *
 * What the Android app injects at document start is reproduced here, in the same order as Capacitor's JSInjector:
 *   1. globals: window.Capacitor = { DEBUG, isLoggingEnabled, Plugins }, window.WEBVIEW_SERVER_URL
 *   2. the real native-bridge.js shipped in @capacitor/android (not a copy: read from node_modules)
 *   3. the plugin headers (which methods each native plugin exposes)
 * plus a fake `window.androidBridge` (the Java JavascriptInterface) that answers plugin calls in JS the way the
 * native plugins would: Preferences (in-memory SharedPreferences), CapacitorHttp (real fetch, native response
 * format incl. base64 for binary), Geolocation (a fixed position near Katoomba), Filesystem/Cookies stubs.
 *
 * Every call is recorded on window.__nativeCalls so tests can assert what reached "native". Requests to URLs listed in
 * `httpRoutes` are answered from the list the way the Android HTTP stack would (a 302 with a Location header when redirects are
 * disabled, the followed chain's final address in `url` otherwise) and are recorded on window.__nativeHttp (url, headers,
 * disableRedirects): no real network is touched, so the Google short-link tests are the same on every machine.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';

const require = createRequire(import.meta.url);
const NATIVE_BRIDGE_JS = readFileSync(require.resolve('@capacitor/android/capacitor/src/main/assets/native-bridge.js'), 'utf8');

type Rtype = 'promise' | 'callback';
const header = (name: string, methods: [string, Rtype?][]) => ({ name, methods: methods.map(([n, r]) => ({ name: n, rtype: r ?? 'promise' })) });

/** Plugin headers as the Android bridge generates them for the plugins in android/capacitor.plugins.json. */
const PLUGIN_HEADERS = [
  header('Preferences', [['configure'], ['get'], ['set'], ['remove'], ['clear'], ['keys'], ['migrate'], ['removeOld']]),
  header('CapacitorHttp', [['request'], ['get'], ['post'], ['put'], ['patch'], ['delete']]),
  header('CapacitorCookies', [['getCookies'], ['setCookie'], ['deleteCookie'], ['clearCookies'], ['clearAllCookies']]),
  header('Geolocation', [['getCurrentPosition'], ['watchPosition', 'callback'], ['clearWatch'], ['checkPermissions'], ['requestPermissions']]),
  header('Filesystem', [['readFile'], ['writeFile'], ['appendFile'], ['deleteFile'], ['mkdir'], ['rmdir'], ['readdir'], ['getUri'], ['stat'], ['rename'], ['copy'], ['checkPermissions'], ['requestPermissions']]),
  header('WebView', [['setServerAssetPath'], ['setServerBasePath'], ['getServerBasePath'], ['persistServerBasePath']]),
];

/** A faked answer of the native HTTP plugin (see {@link AndroidEmulationOptions.httpRoutes}). */
export interface FakeHttpRoute {
  /** The address (or the start of it) this answers; the first route that matches is used. */
  match: string;
  /** A redirect: the address of the Location header; `status` is 302 unless given. */
  location?: string;
  status?: number;
  /** The page, for an answer that is not a redirect. */
  body?: string;
  contentType?: string;
  /** Hold the answer back (ms), to see the "Looking up…" state. */
  delayMs?: number;
}

export interface AndroidEmulationOptions {
  /** Geolocation fix returned by the fake plugin (default: Katoomba). */
  position?: { latitude: number; longitude: number; accuracy: number };
  /**
   * Keep the fake SharedPreferences across page reloads of the same tab (the real ones survive the app being closed and
   * reopened). Off by default: each page load then starts with empty preferences.
   */
  persistPreferences?: boolean;
  /** Answers of the native HTTP plugin for some addresses (a Google short link's redirect, for example); other addresses reach the real network. */
  httpRoutes?: FakeHttpRoute[];
}

/** Install the Android emulation before any page script runs. Call before page.goto(). */
export async function emulateCapacitorAndroid(page: Page, opts: AndroidEmulationOptions = {}): Promise<void> {
  const position = opts.position ?? { latitude: -33.715, longitude: 150.285, accuracy: 12 };
  await page.addInitScript(
    ({ bridgeJs, headers, position, persist, routes }) => {
      const w = window as unknown as Record<string, any>;
      const origFetch = window.fetch.bind(window);
      const prefs = new Map<string, string>();
      const PREFS_KEY = '__nativePrefs';
      if (persist) {
        try {
          for (const [k, v] of JSON.parse(sessionStorage.getItem(PREFS_KEY) ?? '[]') as [string, string][]) prefs.set(k, v);
        } catch {
          /* nothing saved yet */
        }
      }
      const savePrefs = (): void => {
        if (persist) sessionStorage.setItem(PREFS_KEY, JSON.stringify([...prefs]));
      };
      w.__nativeCalls = [] as { plugin: string; method: string }[];
      w.__nativeHttp = [] as { url: string; method: string; headers: Record<string, string>; disableRedirects: boolean }[];

      // 1. Globals the native side injects first.
      w.WEBVIEW_SERVER_URL = location.origin;
      w.Capacitor = { DEBUG: true, isLoggingEnabled: false, Plugins: {} };
      // CapacitorHttp is enabled in capacitor.config.ts: the bridge patches fetch/XHR for non-local URLs.
      w.CapacitorHttpAndroidInterface = { isEnabled: () => true };

      const b64 = (buf: ArrayBuffer): string => {
        const bytes = new Uint8Array(buf);
        let s = '';
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(s);
      };

      /** A faked HttpResponse for an address in `routes`, following redirects only when the request does not disable them; null: not faked. */
      async function fakeHttp(o: any): Promise<unknown | null> {
        let url: string = o.url;
        for (let hop = 0; hop < 8; hop++) {
          const route = routes.find((r: { match: string }) => url.startsWith(r.match));
          if (!route) return hop === 0 ? null : { status: 404, headers: {}, url, data: '' };
          w.__nativeHttp.push({ url, method: o.method ?? 'GET', headers: o.headers ?? {}, disableRedirects: !!o.disableRedirects });
          if (route.delayMs) await new Promise((r) => setTimeout(r, route.delayMs));
          if (route.location) {
            if (o.disableRedirects) return { status: route.status ?? 302, headers: { Location: route.location }, url, data: '' };
            url = new URL(route.location, url).href;
            continue;
          }
          const body: string = route.body ?? '';
          const binary = o.responseType === 'arraybuffer' || o.responseType === 'blob';
          return { status: route.status ?? 200, headers: { 'Content-Type': route.contentType ?? 'text/html' }, url, data: binary ? btoa(unescape(encodeURIComponent(body))) : body };
        }
        return { status: 310, headers: {}, url, data: '' };
      }

      async function handle(pluginId: string, methodName: string, o: any): Promise<unknown> {
        switch (`${pluginId}.${methodName}`) {
          case 'Preferences.get':
            return { value: prefs.has(o.key) ? prefs.get(o.key)! : null };
          case 'Preferences.set':
            prefs.set(o.key, String(o.value));
            savePrefs();
            return {};
          case 'Preferences.remove':
            prefs.delete(o.key);
            savePrefs();
            return {};
          case 'Preferences.clear':
            prefs.clear();
            savePrefs();
            return {};
          case 'Preferences.keys':
            return { keys: [...prefs.keys()] };
          case 'Preferences.configure':
          case 'Preferences.migrate':
          case 'Preferences.removeOld':
            return {};
          case 'Geolocation.checkPermissions':
          case 'Geolocation.requestPermissions':
            return { location: 'granted', coarseLocation: 'granted' };
          case 'Geolocation.getCurrentPosition':
            return {
              timestamp: Date.now(),
              coords: { ...position, altitude: 1010, altitudeAccuracy: 20, heading: null, speed: null },
            };
          case 'CapacitorHttp.request':
          case 'CapacitorHttp.get':
          case 'CapacitorHttp.post': {
            const faked = routes.length ? await fakeHttp(o) : null;
            if (faked) return faked;
            const url = new URL(o.url);
            for (const [k, v] of Object.entries(o.params ?? {})) url.searchParams.set(k, String(v));
            const res = await origFetch(url.toString(), { method: o.method ?? 'GET', headers: o.headers ?? {}, body: o.data });
            const headersOut: Record<string, string> = {};
            res.headers.forEach((v, k) => (headersOut[k] = v));
            const type = res.headers.get('content-type') ?? '';
            let data: unknown;
            if (o.responseType === 'arraybuffer' || o.responseType === 'blob') data = b64(await res.arrayBuffer());
            else if (type.includes('json')) data = await res.json().catch(() => null);
            else data = await res.text();
            return { status: res.status, headers: headersOut, url: res.url, data };
          }
          default:
            throw Object.assign(new Error(`${pluginId}.${methodName} is not emulated`), { code: 'UNIMPLEMENTED' });
        }
      }

      // The Java JavascriptInterface. Results come back asynchronously through Capacitor.fromNative, like the
      // real bridge's evaluateJavascript callbacks.
      w.androidBridge = {
        postMessage(json: string) {
          const call = JSON.parse(json);
          if (call.type) return; // js.error reports and logs
          w.__nativeCalls.push({ plugin: call.pluginId, method: call.methodName });
          handle(call.pluginId, call.methodName, call.options ?? {}).then(
            (data) => setTimeout(() => w.Capacitor.fromNative({ callbackId: call.callbackId, pluginId: call.pluginId, methodName: call.methodName, success: true, data }), 0),
            (e: Error & { code?: string }) =>
              setTimeout(
                () => w.Capacitor.fromNative({ callbackId: call.callbackId, pluginId: call.pluginId, methodName: call.methodName, success: false, error: { message: e.message, code: e.code } }),
                0,
              ),
          );
        },
      };

      // 2. The real native bridge. 3. Plugin headers.
      new Function(bridgeJs)();
      w.Capacitor.PluginHeaders = headers;
    },
    { bridgeJs: NATIVE_BRIDGE_JS, headers: PLUGIN_HEADERS, position, persist: !!opts.persistPreferences, routes: opts.httpRoutes ?? [] },
  );
}
