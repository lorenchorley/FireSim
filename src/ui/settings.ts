/**
 * User settings (persisted) and the theme applier.
 *
 * Themes: 'light' is the high-contrast "sunlight" theme (near-black on white, heavy weights, 7:1 text contrast);
 * 'dark' is the "night" theme (dark UI, dimmed map, no pure-white panels). 'system' follows the OS setting and
 * updates live when it changes (doc 09 §9).
 */
import type { SpeedUnit } from './format';
import { getPref, PREF_KEYS, setPref } from './prefs';
import { Store } from './store';

export type ThemeSetting = 'system' | 'light' | 'dark';
export type PerformanceMode = 'auto' | 'battery' | 'quality';

export interface Settings {
  theme: ThemeSetting;
  units: SpeedUnit;
  /** 'battery' lowers render/ember detail and snapshot rate; 'quality' raises them. */
  performance: PerformanceMode;
  /** Side of the screen the tool rail sits on (for one-handed use). */
  handedness: 'right' | 'left';
  /** Pause playback when a Danger card appears (doc 10 §9.1: Danger interrupts playback). */
  pauseOnDanger: boolean;
  /** Vibrate on Danger cards. */
  haptics: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  units: 'kmh',
  performance: 'auto',
  handedness: 'right',
  pauseOnDanger: true,
  haptics: true,
};

export const settingsStore = new Store<Settings>(DEFAULT_SETTINGS);

/** Load persisted settings into {@link settingsStore} and keep them saved on change. */
export async function initSettings(overrides: Partial<Settings> = {}): Promise<void> {
  const saved = sanitise(await getPref<Partial<Settings>>(PREF_KEYS.settings, {}));
  settingsStore.set({ ...DEFAULT_SETTINGS, ...saved, ...overrides });
  // Session overrides (e.g. ?theme=dark) are not persisted unless the user changes that setting themselves.
  const base = { ...DEFAULT_SETTINGS, ...saved };
  settingsStore.subscribe((s, prev) => {
    for (const k of Object.keys(s) as (keyof Settings)[]) if (!(k in overrides) || s[k] !== prev[k]) (base as Record<string, unknown>)[k] = s[k];
    void setPref(PREF_KEYS.settings, base);
  });
}

function sanitise(s: Partial<Settings>): Partial<Settings> {
  const out: Partial<Settings> = {};
  if (s.theme === 'system' || s.theme === 'light' || s.theme === 'dark') out.theme = s.theme;
  if (s.units === 'kmh' || s.units === 'ms') out.units = s.units;
  if (s.performance === 'auto' || s.performance === 'battery' || s.performance === 'quality') out.performance = s.performance;
  if (s.handedness === 'left' || s.handedness === 'right') out.handedness = s.handedness;
  if (typeof s.pauseOnDanger === 'boolean') out.pauseOnDanger = s.pauseOnDanger;
  if (typeof s.haptics === 'boolean') out.haptics = s.haptics;
  return out;
}

/** The theme actually shown for a setting. */
export function resolveTheme(setting: ThemeSetting, systemDark: boolean): 'light' | 'dark' {
  return setting === 'system' ? (systemDark ? 'dark' : 'light') : setting;
}

const THEME_COLOURS = { light: '#ffffff', dark: '#0e1116' } as const;

/** Apply the theme to <html data-theme> and the browser/status bar colour, and follow OS changes. */
export function startThemeSync(root: HTMLElement = document.documentElement): () => void {
  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  const apply = (): void => {
    const theme = resolveTheme(settingsStore.get().theme, mq?.matches ?? false);
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOURS[theme]);
  };
  apply();
  const unsub = settingsStore.subscribe(apply, ['theme']);
  mq?.addEventListener('change', apply);
  return () => {
    unsub();
    mq?.removeEventListener('change', apply);
  };
}

/** Rendering/simulation detail implied by the performance mode. */
export function performanceProfile(mode: PerformanceMode): { maxEmbers: number; snapshotInterval: number; smoke: boolean; vegetation: boolean } {
  switch (mode) {
    case 'battery':
      return { maxEmbers: 1500, snapshotInterval: 600, smoke: false, vegetation: false };
    case 'quality':
      return { maxEmbers: 4000, snapshotInterval: 300, smoke: true, vegetation: true };
    default:
      return { maxEmbers: 3000, snapshotInterval: 300, smoke: true, vegetation: true };
  }
}
