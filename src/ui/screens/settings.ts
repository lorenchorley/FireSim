/**
 * Settings & About (D): theme, units, handedness, performance mode, the picture interval and solver step, the optional
 * reactions to Danger cards (pause, vibrate; both off unless chosen); data attributions and licences; research
 * references; module status (real engine vs demo/mock).
 */
import { h } from '../dom';
import { icon } from '../icons';
import { ATTRIBUTIONS, REFERENCES } from '../content';
import type { Services } from '../modules';
import { formatStepLabel } from '../format';
import { settingsStore, SOLVER_STEPS, TIME_STEPS, type PerformanceMode, type ThemeSetting } from '../settings';
import { button, section, segmented, toggle } from '../widgets';

export function createSettingsScreen(opts: { services: Services; onClose: () => void; onNotice: () => void }): { el: HTMLElement; destroy(): void } {
  const s = settingsStore.get();
  const set = settingsStore.set.bind(settingsStore);
  const display = section(
    'Display',
    [
      segmented<ThemeSetting>({
        label: 'Theme',
        options: [
          { value: 'system', label: 'Auto' },
          { value: 'light', label: 'Sunlight', icon: 'sun' },
          { value: 'dark', label: 'Night', icon: 'moon' },
        ],
        value: s.theme,
        testId: 'theme',
        onChange: (v) => set({ theme: v }),
      }).el,
      h('p', { class: 'hint' }, 'Sunlight: black on white, strongest contrast for bright days. Night: dark, dimmed map for smoke and darkness. Auto follows the phone.'),
      segmented<'kmh' | 'ms'>({
        label: 'Wind speed units',
        options: [
          { value: 'kmh', label: 'km/h' },
          { value: 'ms', label: 'm/s' },
        ],
        value: s.units,
        onChange: (v) => set({ units: v }),
      }).el,
      segmented<'right' | 'left'>({
        label: 'Tools menu for',
        options: [
          { value: 'right', label: 'Right hand' },
          { value: 'left', label: 'Left hand' },
        ],
        value: s.handedness,
        onChange: (v) => set({ handedness: v }),
      }).el,
    ],
    { icon: 'sun', id: 'display' },
  );
  const sim = section(
    'Simulation',
    [
      segmented<PerformanceMode>({
        label: 'Performance',
        options: [
          { value: 'battery', label: 'Saver' },
          { value: 'auto', label: 'Balanced' },
          { value: 'quality', label: 'Detail' },
        ],
        value: s.performance,
        onChange: (v) => set({ performance: v }),
      }).el,
      h('p', { class: 'hint' }, 'Saver: fewer embers, no smoke and a lighter model — for long runs on battery. Detail: everything on (the phone gets warmer). Applies to the next model you build.'),
      segmented<string>({
        label: 'Picture interval (time step)',
        options: TIME_STEPS.map((sec) => ({ value: String(sec), label: formatStepLabel(sec) })),
        value: String(s.timeStep),
        columns: 3,
        testId: 'time-step',
        onChange: (v) => set({ timeStep: Number(v) }),
      }).el,
      h(
        'p',
        { class: 'hint' },
        'How much fire time each new picture covers, and how finely the timeline can be stepped. Shorter shows more detail and gives the model more to compute. Also in the time menu (tap the clock). Applies from the current time on.',
      ),
      segmented<string>({
        label: 'Solver step limit (advanced)',
        options: SOLVER_STEPS.map((sec) => ({ value: String(sec), label: sec === 0 ? 'Automatic' : formatStepLabel(sec) })),
        value: String(s.solverStep),
        columns: 2,
        testId: 'solver-step',
        onChange: (v) => set({ solverStep: Number(v) }),
      }).el,
      h(
        'p',
        { class: 'hint' },
        'The longest step the fire and wind solvers may take inside one picture. Automatic is safe and fastest. A smaller limit is finer but slower, and it changes the result a little. When a run is open it is recomputed from the time you are viewing.',
      ),
      h('h3', { class: 'field-label settings-sub' }, 'Danger cards'),
      h('p', { class: 'hint' }, 'Nothing pops up over the map and nothing stops the simulation by itself: cards wait in the Insights tab until you open it. These two reactions are optional.'),
      toggle({
        label: 'Pause when a Danger card appears',
        description: 'Off by default. When on, playback stops each time a new Danger card is revealed.',
        checked: s.pauseOnDanger,
        testId: 'pause-on-danger',
        onChange: (v) => set({ pauseOnDanger: v }),
      }).el,
      toggle({
        label: 'Vibrate on new Danger cards',
        description: 'Off by default. A short buzz, without pausing.',
        checked: s.haptics,
        testId: 'haptics',
        onChange: (v) => set({ haptics: v }),
      }).el,
    ],
    { icon: 'speed', id: 'simulation' },
  );
  const safety = section(
    'Safety',
    [
      h('p', null, 'FireSim is a training aid, not an operational prediction tool. Follow your Incident Controller, your Crew Leader and NSW RFS procedures.'),
      button({ label: 'Read the safety notice again', icon: 'warning', variant: 'secondary', onClick: opts.onNotice }),
    ],
    { icon: 'warning', id: 'safety' },
  );
  const data = section(
    'Data and licences',
    h(
      'ul',
      { class: 'attrib-list' },
      ATTRIBUTIONS.map((a) => h('li', null, [h('strong', null, a.name), h('span', null, a.use), h('span', { class: 'attrib-licence' }, a.licence)])),
    ),
    { icon: 'book', id: 'data' },
  );
  const refs = section(
    'Research behind the model',
    [
      h('p', null, 'The physics, thresholds and card wording come from the project’s fact-checked literature reviews (docs/research):'),
      h(
        'ul',
        { class: 'ref-list' },
        REFERENCES.map((r) => h('li', null, [h('span', { class: 'ref-file' }, r.file), ' — ', r.title])),
      ),
    ],
    { icon: 'book', id: 'refs' },
  );
  const src = opts.services.sources;
  const about = section(
    'About',
    [
      h('p', null, 'FireSim 0.1 — a coupled atmosphere, fire and ember simulation for learning how bushfires behave in the mountains of NSW.'),
      h('ul', { class: 'module-status' }, [
        h('li', null, `Simulation engine: ${src.sim === 'real' ? 'full model' : 'demo engine (mock)'}`),
        h('li', null, `3-D view: ${src.scene === 'real' ? 'Three.js' : '2-D map (mock / fallback)'}`),
        h('li', null, `Scenario data: ${src.scenario === 'real' ? 'full builder' : 'demo builder (mock fuel & weather)'}`),
      ]),
    ],
    { icon: 'info', id: 'about' },
  );
  const el = h('div', { class: 'screen settings-screen', dataset: { testid: 'settings' }, attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'settings-title' } }, [
    h('header', { class: 'app-header' }, [
      button({ label: 'Back', icon: 'back', variant: 'ghost', testId: 'close-settings', onClick: opts.onClose }),
      h('h1', { class: 'header-title', id: 'settings-title' }, 'Settings'),
      h('span', { class: 'header-spacer' }),
    ]),
    h('main', { class: 'settings-main' }, [display, sim, safety, data, refs, about, h('p', { class: 'fine-print' }, [icon('lock', { size: 16 }), ' Works offline with the bundled demo sites. No account, no tracking.'])]),
  ]);
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') opts.onClose();
  };
  el.addEventListener('keydown', onKey);
  return { el, destroy: () => el.remove() };
}
