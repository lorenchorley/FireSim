/**
 * Settings: the high-contrast ("bright sun") setting (default off, sanitised, persisted, overridable for a session) and the
 * appearance applier (data-theme, data-contrast, theme-color) that the CSS tokens key off.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  themeChrome,
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
    expect(resolveAppearance({ theme: 'system', highContrast: false }, true)).toEqual({ theme: 'dark', highContrast: false, themeColor: THEME_CHROME.dark.statusBar, chrome: THEME_CHROME.dark });
    expect(resolveAppearance({ theme: 'system', highContrast: false }, false).theme).toBe('light');
    expect(resolveAppearance({ theme: 'light', highContrast: true }, true)).toEqual({ theme: 'light', highContrast: true, themeColor: THEME_CHROME.light.statusBar, chrome: THEME_CHROME['light-hc'] });
    expect(resolveAppearance({ theme: 'dark', highContrast: true }, false).chrome).toBe(THEME_CHROME['dark-hc']);
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
    applyAppearance({ theme: 'light', highContrast: false, themeColor: '#fbbc04', chrome: THEME_CHROME.light }, { root: t.root, meta: null });
    expect(t.root.dataset['theme']).toBe('light');
  });

  it('system bar colours are opaque hex colours and the status bar follows the amber training strip', () => {
    for (const th of ['light', 'dark', 'light-hc', 'dark-hc'] as const) {
      for (const k of ['statusBar', 'navigationBar', 'background'] as const) expect(THEME_CHROME[th][k]).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(THEME_CHROME.light.statusBar).toBe('#fbbc04');
  });

  it('system bars match the tokens in every mode, high contrast included (#121314 on black in high-contrast dark)', () => {
    const tokens = readFileSync(join(__dirname, '..', 'styles', 'tokens.css'), 'utf8');
    const block = (sel: string): string => {
      const i = tokens.indexOf(`${sel} {`);
      expect(i, sel).toBeGreaterThanOrEqual(0);
      return tokens.slice(i, tokens.indexOf('\n}', i));
    };
    const val = (b: string, name: string): string | undefined => new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(b)?.[1]?.toLowerCase();
    const light = block(":root[data-theme='light']");
    const dark = block(":root[data-theme='dark']");
    const hcLight = block(":root[data-contrast='high']:not([data-theme='dark'])");
    const hcDark = block(":root[data-theme='dark'][data-contrast='high']");
    expect(THEME_CHROME.light).toMatchObject({ statusBar: val(light, '--badge-bg'), navigationBar: val(light, '--surface'), background: val(light, '--bg') });
    expect(THEME_CHROME.dark).toMatchObject({ statusBar: val(dark, '--badge-bg'), navigationBar: val(dark, '--surface'), background: val(dark, '--bg') });
    // High contrast keeps the amber strip of its theme.
    expect(THEME_CHROME['light-hc']).toMatchObject({ statusBar: val(hcLight, '--badge-bg') ?? val(light, '--badge-bg'), navigationBar: val(hcLight, '--surface'), background: val(hcLight, '--bg') });
    expect(THEME_CHROME['dark-hc']).toMatchObject({ statusBar: val(hcDark, '--badge-bg') ?? val(dark, '--badge-bg'), navigationBar: '#121314', background: '#000000' });
    expect(val(hcDark, '--surface')).toBe('#121314');
    expect(themeChrome('dark', true)).toBe(THEME_CHROME['dark-hc']);
    expect(themeChrome('light')).toBe(THEME_CHROME.light);
  });
});
