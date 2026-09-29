/**
 * Settings: the high-contrast ("bright sun") setting (default off, sanitised, persisted, overridable for a session) and the
 * appearance applier (data-theme, data-contrast, theme-color) that the CSS tokens key off.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mem = new Map<string, unknown>();
vi.mock('./prefs', () => ({
  PREF_KEYS: { settings: 'settings' },
  getPref: async (key: string, fallback: unknown) => (mem.has(key) ? mem.get(key) : fallback),
  setPref: async (key: string, value: unknown) => void mem.set(key, JSON.parse(JSON.stringify(value))),
}));

import {
  DEFAULT_SETTINGS,
  SETTINGS_VERSION,
  THEME_CHROME,
  applyAppearance,
  initSettings,
  resolveAppearance,
  sanitiseSettings,
  settingsStore,
  type AppearanceTarget,
} from './settings';

beforeEach(() => {
  mem.clear();
  settingsStore.set({ ...DEFAULT_SETTINGS });
});

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('highContrast setting', () => {
  it('is off by default', () => {
    expect(DEFAULT_SETTINGS.highContrast).toBe(false);
  });

  it('sanitising keeps a boolean and drops anything else', () => {
    expect(sanitiseSettings({ highContrast: true })).toEqual({ highContrast: true });
    expect(sanitiseSettings({ highContrast: false })).toEqual({ highContrast: false });
    expect(sanitiseSettings({ highContrast: 'yes' as unknown as boolean })).toEqual({});
    expect(sanitiseSettings({ highContrast: 1 as unknown as boolean })).toEqual({});
  });

  it('is not tied to the settings version (older saved settings load with it off)', () => {
    expect(sanitiseSettings({ settingsVersion: SETTINGS_VERSION - 1 })).not.toHaveProperty('highContrast');
  });

  it('loads from the saved settings', async () => {
    mem.set('settings', { highContrast: true, theme: 'dark' });
    await initSettings();
    expect(settingsStore.get().highContrast).toBe(true);
    expect(settingsStore.get().theme).toBe('dark');
  });

  it('is saved when it changes', async () => {
    await initSettings();
    settingsStore.set({ highContrast: true });
    await flush();
    expect((mem.get('settings') as { highContrast: boolean }).highContrast).toBe(true);
    settingsStore.set({ highContrast: false });
    await flush();
    expect((mem.get('settings') as { highContrast: boolean }).highContrast).toBe(false);
  });

  it('a session override (?contrast=high) applies but is not persisted until the user changes it', async () => {
    await initSettings({ highContrast: true });
    expect(settingsStore.get().highContrast).toBe(true);
    settingsStore.set({ units: 'ms' });
    await flush();
    expect((mem.get('settings') as { highContrast: boolean }).highContrast).toBe(false);
    expect((mem.get('settings') as { units: string }).units).toBe('ms');
  });
});

describe('appearance', () => {
  const target = (): AppearanceTarget & { root: { dataset: Record<string, string | undefined>; style: { colorScheme: string } }; content: string[] } => {
    const content: string[] = [];
    return { root: { dataset: {}, style: { colorScheme: '' } }, meta: { setAttribute: (_n: string, v: string) => void content.push(v) }, content };
  };

  it('resolves the theme (system follows the OS) and the status-bar colour of that theme', () => {
    expect(resolveAppearance({ theme: 'system', highContrast: false }, true)).toEqual({ theme: 'dark', highContrast: false, themeColor: THEME_CHROME.dark.statusBar });
    expect(resolveAppearance({ theme: 'system', highContrast: false }, false).theme).toBe('light');
    expect(resolveAppearance({ theme: 'light', highContrast: true }, true)).toEqual({ theme: 'light', highContrast: true, themeColor: THEME_CHROME.light.statusBar });
  });

  it('sets data-theme, color-scheme and theme-color; data-contrast only when high contrast is on', () => {
    const t = target();
    applyAppearance(resolveAppearance({ theme: 'dark', highContrast: true }, false), t);
    expect(t.root.dataset).toEqual({ theme: 'dark', contrast: 'high' });
    expect(t.root.style.colorScheme).toBe('dark');
    expect(t.content).toEqual([THEME_CHROME.dark.statusBar]);
    applyAppearance(resolveAppearance({ theme: 'dark', highContrast: false }, false), t);
    expect(t.root.dataset).toEqual({ theme: 'dark' });
    expect('contrast' in t.root.dataset).toBe(false);
  });

  it('works without a theme-color meta element', () => {
    const t = target();
    applyAppearance({ theme: 'light', highContrast: false, themeColor: '#fbbc04' }, { root: t.root, meta: null });
    expect(t.root.dataset['theme']).toBe('light');
  });

  it('system bar colours are opaque hex colours and the status bar follows the amber training strip', () => {
    for (const th of ['light', 'dark'] as const) {
      for (const k of ['statusBar', 'navigationBar', 'background'] as const) expect(THEME_CHROME[th][k]).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(THEME_CHROME.light.statusBar).toBe('#fbbc04');
  });
});
