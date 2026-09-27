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

/** The Capacitor Preferences plugin on native platforms only (the web shim would just wrap localStorage). */
function native(): Promise<PreferencesApi | null> {
  nativePrefs ??= (async () => {
    try {
      if (!Capacitor.isNativePlatform()) return null;
      const m = await import('@capacitor/preferences');
      return m.Preferences as PreferencesApi;
    } catch {
      return null;
    }
  })();
  return nativePrefs;
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
      raw = (await p.get({ key: PREFIX + key })).value;
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
    if (raw === null) await p.remove({ key: PREFIX + key });
    else await p.set({ key: PREFIX + key, value: raw });
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
