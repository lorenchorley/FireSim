/**
 * User settings (persisted) and the theme applier.
 *
 * Themes: 'light' is the high-contrast "sunlight" theme (near-black on white, heavy weights, 7:1 text contrast);
 * 'dark' is the "night" theme (dark UI, dimmed map, no pure-white panels). 'system' follows the OS setting and
 * updates live when it changes (doc 09 §9).
 */
import type { QualityTier } from '../core/types';
import type { SpeedUnit } from './format';
import { getPref, PREF_KEYS, setPref } from './prefs';
import { Store } from './store';

export type ThemeSetting = 'system' | 'light' | 'dark';
export type PerformanceMode = 'auto' | 'battery' | 'quality';

export interface Settings {
  theme: ThemeSetting;
  units: SpeedUnit;
  /** 'battery' lowers render/ember detail and the engine tier; 'quality' raises them. */
  performance: PerformanceMode;
  /** Side of the screen the Tools menu button sits on (for one-handed use); the View menu takes the other side. */
  handedness: 'right' | 'left';
  /**
   * Pause playback when a Danger card appears. OFF by default and opt-in only: when the user runs the simulation they
   * want it to run; cards are read when the user chooses to open the Insights.
   */
  pauseOnDanger: boolean;
  /** Vibrate on new Danger cards (opt-in, off by default). */
  haptics: boolean;
  /** Display step (s): how often the engine produces a new picture and how finely the timeline can be stepped. */
  timeStep: number;
  /** Solver step limit (s); 0 = automatic. Smaller is finer and slower (advanced). */
  solverStep: number;
  /** Playback speed last used, simulated seconds per second; 0 = as fast as possible (JSON cannot store Infinity). */
  defaultSpeed: number;
  /** Schema version of the saved settings (see {@link SETTINGS_VERSION}). */
  settingsVersion: number;
}

/** Version 2: pause/vibrate became opt-in (saved `true` values from version 1 were only the old defaults). */
export const SETTINGS_VERSION = 2;

/** Selectable display steps (s) and solver step limits (s, 0 = automatic). */
export const TIME_STEPS: readonly number[] = [10, 30, 60, 120, 300, 600];

/** Playback speed (Infinity = as fast as possible) ⇄ its stored form in {@link Settings.defaultSpeed} (0 = as fast as possible). */
export const speedToStored = (speed: number): number => (Number.isFinite(speed) ? speed : 0);
export const speedFromStored = (stored: number): number => (stored > 0 ? stored : Infinity);
export const SOLVER_STEPS: readonly number[] = [0, 5, 2, 1];

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  units: 'kmh',
  performance: 'auto',
  handedness: 'right',
  pauseOnDanger: false,
  haptics: false,
  timeStep: 60,
  solverStep: 0,
  defaultSpeed: 60,
  settingsVersion: SETTINGS_VERSION,
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
  // Settings saved before version 2 hold the old defaults (pause and vibrate ON), not a choice the user made.
  const current = s.settingsVersion === SETTINGS_VERSION;
  if (current && typeof s.pauseOnDanger === 'boolean') out.pauseOnDanger = s.pauseOnDanger;
  if (current && typeof s.haptics === 'boolean') out.haptics = s.haptics;
  if (typeof s.timeStep === 'number' && TIME_STEPS.includes(s.timeStep)) out.timeStep = s.timeStep;
  if (typeof s.solverStep === 'number' && SOLVER_STEPS.includes(s.solverStep)) out.solverStep = s.solverStep;
  if (typeof s.defaultSpeed === 'number' && s.defaultSpeed >= 0 && s.defaultSpeed <= 86400) out.defaultSpeed = s.defaultSpeed;
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

/**
 * Rendering/simulation detail implied by the performance mode; `tier` is the engine quality tier (SimOptions.tier:
 * 'auto' lets the engine pick from the device). The display step and solver step are the user's own settings
 * ({@link Settings.timeStep}, {@link Settings.solverStep}), no longer tied to the mode.
 */
export function performanceProfile(mode: PerformanceMode): { maxEmbers: number; smoke: boolean; vegetation: boolean; tier: 'auto' | QualityTier } {
  switch (mode) {
    case 'battery':
      return { maxEmbers: 1500, smoke: false, vegetation: false, tier: 'fast' };
    case 'quality':
      return { maxEmbers: 4000, smoke: true, vegetation: true, tier: 'high' };
    default:
      return { maxEmbers: 3000, smoke: true, vegetation: true, tier: 'auto' };
  }
}

/** The settings a scenario request takes: the performance mode and the two step settings. */
export type ScenarioSettings = Pick<Settings, 'performance' | 'timeStep' | 'solverStep'>;

/** What {@link bindStepSettings} needs from a SimSession. */
export interface StepTarget {
  state: { get(): Readonly<{ timeStep: number; solverStep: number }> };
  setTimeStep(seconds: number): void;
  setSolverStep(seconds: number): void;
}

/**
 * Keep a running session's display step and solver step equal to the settings: applies them now if they differ and on
 * every later change (the display step live, the solver step as a what-if from the view time). Returns the unsubscribe.
 * The values in force at build time come from {@link buildRequest}'s request options, so a fresh session is in sync.
 */
export function bindStepSettings(session: StepTarget, store: Pick<Store<Settings>, 'get' | 'subscribe'> = settingsStore): () => void {
  const apply = (s: Readonly<Settings>): void => {
    const cur = session.state.get();
    if (s.timeStep !== cur.timeStep) session.setTimeStep(s.timeStep);
    if (s.solverStep !== cur.solverStep) session.setSolverStep(s.solverStep);
  };
  apply(store.get());
  return store.subscribe(apply, ['timeStep', 'solverStep']);
}
