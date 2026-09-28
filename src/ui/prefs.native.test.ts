/**
 * Regression test for the Android hang on "Loading FireSim…": Capacitor plugin objects are Proxies that return a
 * method wrapper for ANY property, including `then`, so awaiting / returning one from an async function never
 * settles. getPref/setPref must work with such a proxy (and survive a stalled native call).
 */
import { describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
let stall = false;

/** Mimics @capacitor/core registerPlugin(): every property is a callable wrapper; `then` never calls back. */
const pluginProxy = new Proxy(
  {},
  {
    get(_t, prop) {
      switch (prop) {
        case 'get':
          return async (o: { key: string }) => (stall ? new Promise(() => {}) : { value: store.get(o.key) ?? null });
        case 'set':
          return async (o: { key: string; value: string }) => void store.set(o.key, o.value);
        case 'remove':
          return async (o: { key: string }) => void store.delete(o.key);
        default:
          // Like createPluginMethodWrapper('then'): returns a promise of its own and never calls resolve/reject.
          return () => Promise.reject(new Error(`"Preferences.${String(prop)}()" is not implemented on android`)).catch(() => undefined);
      }
    },
  },
);

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' } }));
vi.mock('@capacitor/preferences', () => ({ Preferences: pluginProxy }));

describe('prefs on a native platform', () => {
  it('the proxy is a thenable, i.e. the trap is real', () => {
    expect(typeof (pluginProxy as { then?: unknown }).then).toBe('function');
  });

  it('getPref/setPref resolve through the native plugin (no hang)', async () => {
    const { getPref, setPref } = await import('./prefs');
    const settle = <T>(p: Promise<T>) => Promise.race([p, new Promise<'hung'>((r) => setTimeout(() => r('hung'), 1000))]);
    expect(await settle(getPref('settings', { a: 1 }))).toEqual({ a: 1 });
    await settle(setPref('settings', { a: 2 }));
    expect(store.get('firesim.settings')).toBe('{"a":2}');
    expect(await settle(getPref('settings', { a: 1 }))).toEqual({ a: 2 });
  });

  it('a stalled native call falls back to the local copy after the timeout', async () => {
    vi.useFakeTimers();
    try {
      const { getPref, NATIVE_PREFS_TIMEOUT_MS } = await import('./prefs');
      stall = true;
      const p = getPref('settings', { a: 0 });
      await vi.advanceTimersByTimeAsync(NATIVE_PREFS_TIMEOUT_MS + 10);
      // setPref above also wrote the local (memory/localStorage) copy.
      expect(await p).toEqual({ a: 2 });
    } finally {
      stall = false;
      vi.useRealTimers();
    }
  });
});
