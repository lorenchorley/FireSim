/**
 * Small persistent key/value preferences for the UI (safety-notice acceptance, settings, last setup form).
 *
 * On device this uses @capacitor/preferences (UserDefaults / SharedPreferences, which survive WebView storage
 * eviction); in a browser, or if the plugin is unavailable, it falls back to localStorage, and finally to memory
 * (private mode, locked-down WebViews). Values are JSON. Every call is safe to await and never throws.
 */
import { Capacitor } from '@capacitor/core';

const PREFIX = 'firesim.';
const memory = new Map<string, string>();

type PreferencesApi = {
  get(o: { key: string }): Promise<{ value: string | null }>;
  set(o: { key: string; value: string }): Promise<void>;
  remove(o: { key: string }): Promise<void>;
};

let nativePrefs: Promise<PreferencesApi | null> | null = null;

/** Longest a native Preferences call may take before the local copy is used instead (ms). */
export const NATIVE_PREFS_TIMEOUT_MS = 3000;

/** The Capacitor Preferences plugin on native platforms only (the web shim would just wrap localStorage). */
function native(): Promise<PreferencesApi | null> {
  nativePrefs ??= (async () => {
    try {
      if (!Capacitor.isNativePlatform()) return null;
      const { Preferences } = await import('@capacitor/preferences');
      // Capacitor plugin objects are Proxies that answer EVERY property with a method wrapper — including `then`.
      // Returning one from an async function (or awaiting it) makes the promise machinery call Preferences.then(),
      // which is not a native method: the promise never settles and the app hung on "Loading FireSim…" on
      // Android. Hand out a plain object that only forwards the three methods we use.
      const api: PreferencesApi = {
        get: (o) => Preferences.get(o),
        set: (o) => Preferences.set(o),
        remove: (o) => Preferences.remove(o),
      };
      return api;
    } catch {
      return null;
    }
  })();
  return nativePrefs;
}

/** Resolve with `p`, or reject after `ms` so a stalled native call can never block the UI. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`native Preferences call timed out after ${ms} ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function localGet(key: string): string | null {
  try {
    const v = globalThis.localStorage?.getItem(PREFIX + key);
    if (v !== null && v !== undefined) return v;
  } catch {
    /* storage blocked */
  }
  return memory.get(key) ?? null;
}

function localSet(key: string, value: string | null): void {
  if (value === null) memory.delete(key);
  else memory.set(key, value);
  try {
    if (value === null) globalThis.localStorage?.removeItem(PREFIX + key);
    else globalThis.localStorage?.setItem(PREFIX + key, value);
  } catch {
    /* storage blocked: memory only */
  }
}

/** Read a JSON value (or `fallback` when absent / unreadable). */
export async function getPref<T>(key: string, fallback: T): Promise<T> {
  let raw: string | null = null;
  const p = await native();
  if (p) {
    try {
      raw = (await withTimeout(p.get({ key: PREFIX + key }), NATIVE_PREFS_TIMEOUT_MS)).value;
    } catch {
      raw = null;
    }
  }
  raw ??= localGet(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Store a JSON value (null removes it). */
export async function setPref(key: string, value: unknown): Promise<void> {
  const raw = value === null || value === undefined ? null : JSON.stringify(value);
  localSet(key, raw);
  const p = await native();
  if (!p) return;
  try {
    if (raw === null) await withTimeout(p.remove({ key: PREFIX + key }), NATIVE_PREFS_TIMEOUT_MS);
    else await withTimeout(p.set({ key: PREFIX + key, value: raw }), NATIVE_PREFS_TIMEOUT_MS);
  } catch {
    /* keep the local copy */
  }
}

/** Keys used by the UI. */
export const PREF_KEYS = {
  /** Version of the safety notice the user accepted (re-shown when the wording changes). */
  notice: 'noticeAccepted',
  settings: 'settings',
  setup: 'lastSetup',
} as const;
