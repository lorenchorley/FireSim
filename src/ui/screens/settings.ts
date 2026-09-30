/**
 * Settings & About (D), flat Maps style: a top app bar (back arrow + left-aligned title) and cards of list rows, switches and
 * segmented controls.
 *   Display: theme (Auto / Light / Night), High contrast (bright sun), wind units, the hand the Tools menu is for
 *   Simulation: performance, picture interval and solver step, the optional reactions to Danger cards (off by default)
 *   Data and transparency: "Data sets and storage" and "How this simulation works" (full-screen screens)
 *   Safety: the notice again
 *   Data and licences: content.ts ATTRIBUTIONS, with tap-to-copy links (the app never opens a web page by itself)
 *   Research behind the model, About (version, build id, which modules run)
 */
import { CC_BY_4, LICENCES, PROVIDERS } from '../../scenario/recordKit';
import { APP_VERSION, BUILD_MODE, buildId } from '../buildInfo';
import { ATTRIBUTIONS, REFERENCES, type Attribution } from '../content';
import { h } from '../dom';
import { icon } from '../icons';
import type { Services } from '../modules';
import { formatStepLabel } from '../format';
import { kv, listRow, showSnackbar } from '../primitives';
import { performanceProfile, settingsStore, SOLVER_STEPS, TIME_STEPS, type PerformanceMode, type ThemeSetting } from '../settings';
import { detailCell } from '../setupModel';
import { SCENARIO_PARAMS } from '../../scenario/params';
import { appBar, copyText, section, segmented, toggle } from '../widgets';

export interface SettingsScreenOptions {
  services: Services;
  onClose: () => void;
  onNotice: () => void;
  /** Open the Data sets screen (the run keeps going underneath when there is one). */
  onOpenDatasets?: (datasetId?: string) => void;
  /** Open "How this simulation works". */
  onOpenModelCard?: () => void;
}

/** Links of an attribution, from the providers and licences the data-set records use (scenario/recordKit.ts). */
export function attributionLinks(a: Attribution): { label: string; url: string }[] {
  const out: { label: string; url: string }[] = [];
  const add = (label: string, url: string | undefined): void => {
    if (url && !out.some((l) => l.url === url)) out.push({ label, url });
  };
  const n = `${a.name} ${a.provider ?? ''}`;
  if (/Spatial Services/.test(n)) add('Provider', PROVIDERS.spatial.url);
  else if (/SVTM|Climate Change, Energy/.test(n) && !/National Parks/.test(n)) add('Provider', PROVIDERS.dccceew.url);
  else if (/National Parks/.test(n)) add('Provider', PROVIDERS.npws.url);
  else if (/Planning/.test(n)) add('Provider', PROVIDERS.planning.url);
  else if (/Terrain Tiles|SRTM/.test(n)) add('Provider', PROVIDERS.awsTerrain.url);
  else if (/World Resources Institute/.test(n)) add('Provider', PROVIDERS.meta.url);
  else if (/^Open-Meteo/.test(a.name)) add('Provider', PROVIDERS.openMeteo.url);
  if (/^Open-Meteo/.test(a.name)) add('Licence', LICENCES.openMeteo.url);
  else if (/Terrain Tiles|SRTM/.test(n)) add('Licence', LICENCES.publicDomain.url);
  else if (/CC BY 4\.0/.test(a.licence)) add('Licence', CC_BY_4.url);
  return out;
}

export function createSettingsScreen(opts: SettingsScreenOptions): { el: HTMLElement; destroy(): void } {
  const s = settingsStore.get();
  const set = settingsStore.set.bind(settingsStore);
  const hint = (t: string): HTMLElement => h('p', { class: 'hint' }, t);

  const display = section(
    'Display',
    [
      segmented<ThemeSetting>({
        label: 'Theme',
        options: [
          { value: 'system', label: 'Auto' },
          { value: 'light', label: 'Light', icon: 'sun' },
          { value: 'dark', label: 'Night', icon: 'moon' },
        ],
        value: s.theme,
        testId: 'theme',
        onChange: (v) => set({ theme: v }),
      }).el,
      hint('Light for daytime, Night (dark, dimmed map) for smoke and darkness. Auto follows the phone.'),
      h('div', { class: 'list card-list' }, [
        toggle({
          label: 'High contrast (bright sun)',
          description: 'Bold outlines, darker text and solid colours for direct sunlight, in either theme. Shows at once.',
          checked: s.highContrast,
          icon: 'contrast',
          testId: 'high-contrast',
          onChange: (v) => set({ highContrast: v }),
        }).el,
      ]),
      segmented<'kmh' | 'ms'>({
        label: 'Wind speed units',
        options: [
          { value: 'kmh', label: 'km/h' },
          { value: 'ms', label: 'm/s' },
        ],
        value: s.units,
        testId: 'units',
        onChange: (v) => set({ units: v }),
      }).el,
      segmented<'right' | 'left'>({
        label: 'Tools menu for',
        options: [
          { value: 'right', label: 'Right hand' },
          { value: 'left', label: 'Left hand' },
        ],
        value: s.handedness,
        testId: 'handedness',
        onChange: (v) => set({ handedness: v }),
      }).el,
    ],
    { icon: 'sun', id: 'settings-display' },
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
        testId: 'performance',
        onChange: (v) => set({ performance: v }),
      }).el,
      hint(performanceHint()),
      segmented<string>({
        label: 'Picture interval (time step)',
        options: TIME_STEPS.map((sec) => ({ value: String(sec), label: formatStepLabel(sec) })),
        value: String(s.timeStep),
        columns: 3,
        testId: 'time-step',
        onChange: (v) => set({ timeStep: Number(v) }),
      }).el,
      hint('How much fire time each new picture covers, and how finely the timeline steps. Shorter shows more and computes more. Also in the time menu (tap the clock). Applies from the current time on.'),
      segmented<string>({
        label: 'Solver step limit (advanced)',
        options: SOLVER_STEPS.map((sec) => ({ value: String(sec), label: sec === 0 ? 'Automatic' : formatStepLabel(sec) })),
        value: String(s.solverStep),
        columns: 2,
        testId: 'solver-step',
        onChange: (v) => set({ solverStep: Number(v) }),
      }).el,
      hint('The longest step the fire and wind solvers may take inside one picture. Automatic is safe and fastest; a smaller limit is finer, slower and changes the result a little. A running model is recomputed from the time you are viewing.'),
      h('h3', { class: 'section-header settings-sub' }, 'Danger cards'),
      hint('Nothing pops up over the map and nothing stops the simulation by itself: cards wait in the Insights tab. These two reactions are optional.'),
      h('div', { class: 'list card-list' }, [
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
      ]),
    ],
    { icon: 'speed', id: 'settings-simulation' },
  );
  const transparency = section(
    'Data and transparency',
    h('ul', { class: 'list card-list' }, [
      opts.onOpenDatasets ? h('li', null, listRow({ title: 'Data sets and storage', sub: 'Every data set: size, origin, age, licence; what is on this phone', icon: 'database', chevron: true, testId: 'settings-datasets', onClick: () => opts.onOpenDatasets?.() })) : null,
      opts.onOpenModelCard ? h('li', null, listRow({ title: 'How this simulation works', sub: 'What is 2-D and what is 3-D, grids, time steps and limits', icon: 'help-circle', chevron: true, testId: 'settings-model-card', onClick: () => opts.onOpenModelCard?.() })) : null,
    ]),
    { icon: 'info', id: 'settings-transparency' },
  );
  const safety = section(
    'Safety',
    [
      h('p', { class: 'card-text' }, 'FireSim is a training aid, not an operational prediction tool. Follow your Incident Controller, your Crew Leader and NSW RFS procedures.'),
      h('ul', { class: 'list card-list' }, h('li', null, listRow({ title: 'Read the safety notice again', icon: 'warning', chevron: true, testId: 'settings-notice', onClick: opts.onNotice }))),
    ],
    { icon: 'warning', id: 'settings-safety' },
  );

  const el: HTMLElement = h('div', { class: 'screen settings-screen', dataset: { testid: 'settings' }, attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'settings-title' } });
  const copy = async (label: string, url: string): Promise<void> => {
    const ok = await copyText(url);
    showSnackbar(el, ok ? `${label} link copied: ${url}` : `Could not copy. The link is ${url}`, { durationMs: 5000 });
  };
  const data = section(
    'Data and licences',
    [
      hint('Links are copied when you tap them, so you can open them later in your browser; the app never opens a web page by itself.'),
      h(
        'ul',
        { class: 'list card-list no-lead attrib-list' },
        ATTRIBUTIONS.map((a) => {
          const links = attributionLinks(a);
          return h('li', null, [
            listRow({
              title: a.name,
              sub: a.use,
              sub2: a.status === 'not-used' ? `${a.licence} · not used yet` : a.status === 'fallback' ? `${a.licence} · only when the first choice is missing` : a.licence,
            }),
            links.length
              ? h(
                  'div',
                  { class: 'attrib-links' },
                  links.map((l) =>
                    h('button', { type: 'button', class: 'chip attrib-link', on: { click: () => void copy(`${a.name} ${l.label.toLowerCase()}`, l.url) }, aria: { label: `Copy the ${l.label.toLowerCase()} link of ${a.name}` } }, [
                      icon('copy'),
                      h('span', null, `${l.label} link`),
                    ]),
                  ),
                )
              : null,
          ]);
        }),
      ),
    ],
    { icon: 'book', id: 'settings-data' },
  );
  const refs = section(
    'Research behind the model',
    [
      hint('The physics, thresholds and card wording come from the project’s fact-checked literature reviews (docs/research in the source code).'),
      h('details', { class: 'ref-details' }, [
        h('summary', null, `The ${REFERENCES.length} reviews`),
        h(
          'ul',
          { class: 'list card-list no-lead ref-list' },
          REFERENCES.map((r) => h('li', null, listRow({ title: r.title, sub: r.file }))),
        ),
      ]),
    ],
    { icon: 'book', id: 'settings-refs' },
  );
  const src = opts.services.sources;
  const about = section(
    'About',
    [
      h('p', { class: 'card-text' }, 'A coupled atmosphere, fire and ember simulation for learning how bushfires behave in the mountains of NSW.'),
      kv(
        [
          { key: 'Version', value: APP_VERSION },
          { key: 'Build', value: buildLabel() },
          { key: 'Simulation engine', value: src.sim === 'real' ? 'Full model' : 'Demo engine (mock)' },
          { key: '3-D view', value: src.scene === 'real' ? 'Three.js (WebGL)' : '2-D map (mock or no WebGL)' },
          { key: 'Scenario data', value: src.scenario === 'real' ? 'Full builder' : 'Demo builder (mock fuel and weather)' },
        ],
        { label: 'About this build', dense: true },
      ),
      h('p', { class: 'fine-print' }, [icon('lock'), 'Works offline with the bundled demo sites. No account, no tracking.']),
    ],
    { icon: 'info', id: 'settings-about' },
  );
  el.append(
    appBar({ title: 'Settings', titleId: 'settings-title', onBack: opts.onClose, backLabel: 'Back', backTestId: 'close-settings' }),
    h('main', { class: 'screen-main settings-main' }, [display, sim, transparency, safety, data, refs, about]),
  );
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault();
      opts.onClose();
    }
  };
  el.addEventListener('keydown', onKey);
  return { el, destroy: () => el.remove() };
}

/** "BX3k9aQz (capacitor)" for a built app, "Development server" on the dev server. */
function buildLabel(): string {
  const id = buildId();
  return id === 'development' ? 'Development server' : `${id} (${BUILD_MODE})`;
}

/** What the performance modes change, read from the profiles and the builder's cell rule (settings.ts, setupModel.ts). */
export function performanceHint(): string {
  const saver = performanceProfile('battery');
  const bal = performanceProfile('auto');
  const det = performanceProfile('quality');
  const maxKm = SCENARIO_PARAMS.highDetailMaxExtentM / 1000;
  const detCell = detailCell(maxKm, 'normal', det.tier);
  const saverWind = detailCell(maxKm, 'normal', saver.tier).twoD ? ', simple 2-D wind' : '';
  const n = (x: number): string => x.toLocaleString('en-AU');
  return (
    `Saver: up to ${n(saver.maxEmbers)} embers instead of ${n(bal.maxEmbers)}${saver.smoke ? '' : ', no smoke'}${saverWind}, for long runs on battery. ` +
    `Detail: up to ${n(det.maxEmbers)} embers and ${detCell.cellM} m cells for areas up to ${maxKm} km (the phone gets warmer). Applies to the next model you build.`
  );
}
