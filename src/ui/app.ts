/**
 * App shell and screen flow: safety notice → Setup → Building → Simulation, with Settings/About on top.
 * Always shows the TRAINING badge and hosts the screen-reader live region.
 */
import { LocalProjection } from '../core/geo';
import type { ScenarioData } from '../core/types';
import { h, text } from './dom';
import { icon } from './icons';
import { loadScenarioImagery } from './imagery';
import type { Services } from './modules';
import { buildRequest, type SetupState } from './setupModel';
import { settingsStore } from './settings';
import { createBuildingScreen } from './screens/building';
import { noticeAccepted, showNotice } from './screens/notice';
import { createSettingsScreen } from './screens/settings';
import { createSetupScreen } from './screens/setup';
import { createSimScreen, type SimScreen } from './screens/sim/simScreen';

interface Screen {
  el: HTMLElement;
  destroy(): void;
}

export class App {
  private screen: Screen | null = null;
  private sim: SimScreen | null = null;
  private settings: Screen | null = null;
  private readonly live: HTMLElement;
  private readonly stage: HTMLElement;
  private build: AbortController | null = null;
  private lastSetup: SetupState | null = null;
  private leavingSim = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly services: Services,
    private readonly params: URLSearchParams,
  ) {
    this.live = h('div', { class: 'sr-only', attrs: { 'aria-live': 'polite', role: 'status' } });
    this.stage = h('div', { class: 'stage' });
    // Full wording where it fits on one line, a short form on narrow phones; the full text is always the accessible name.
    const badge = h('div', { class: 'training-badge', dataset: { testid: 'training-badge' }, attrs: { role: 'note', 'aria-label': 'Training aid, not for operational use' } }, [
      icon('warning', { size: 14 }),
      h('span', { class: 'badge-full', aria: { hidden: true } }, 'Training aid · not for operational use'),
      h('span', { class: 'badge-short', aria: { hidden: true } }, 'Training aid only'),
    ]);
    root.replaceChildren(badge, this.stage, this.live);
    window.addEventListener('popstate', () => this.onBack());
  }

  async start(): Promise<void> {
    this.showSetup();
    if (!(await noticeAccepted()) || this.params.has('notice')) await showNotice(this.root);
  }

  /** Announce to screen readers. */
  announce = (msg: string): void => {
    text(this.live, '');
    requestAnimationFrame(() => text(this.live, msg));
  };

  private swap(next: Screen): void {
    this.screen?.destroy();
    this.screen = next;
    this.stage.replaceChildren(next.el);
    (next.el.querySelector('h1, [data-autofocus]') as HTMLElement | null)?.focus?.();
  }

  showSetup(): void {
    this.sim = null;
    this.swap(
      createSetupScreen({
        onBuild: (s) => void this.buildAndRun(s),
        onSettings: () => this.openSettings(),
      }),
    );
  }

  private openSettings(): void {
    if (this.settings) return;
    history.pushState({ firesim: 'settings' }, '');
    this.settings = createSettingsScreen({
      services: this.services,
      onClose: () => history.back(),
      onNotice: () => void showNotice(this.root, { review: true }),
    });
    this.root.append(this.settings.el);
    (this.settings.el.querySelector('button') as HTMLButtonElement | null)?.focus();
  }

  private closeSettings(): void {
    this.settings?.destroy();
    this.settings = null;
  }

  private onBack(): void {
    if (this.settings) {
      this.closeSettings();
      return;
    }
    if (this.sim) {
      const leave = this.leavingSim || confirm('Leave this simulation and start a new scenario?');
      this.leavingSim = false;
      if (leave) this.showSetup();
      else history.pushState({ firesim: 'sim' }, '');
    }
  }

  /** "New scenario" from the simulation menu: pop the simulation's history entry too, so Back does not pile up. */
  private leaveSim(): void {
    if ((history.state as { firesim?: string } | null)?.firesim === 'sim') {
      this.leavingSim = true;
      history.back(); // → popstate → onBack → showSetup (no confirm: the user chose it from the menu)
    } else this.showSetup();
  }

  private async buildAndRun(setup: SetupState): Promise<void> {
    this.lastSetup = setup;
    const req = buildRequest(setup, settingsStore.get());
    this.build?.abort();
    const ctrl = new AbortController();
    this.build = ctrl;
    const building = createBuildingScreen({
      title: 'Building the 3-D model',
      subtitle: `${req.name ?? 'Scenario'} · ${req.extent / 1000} km square`,
      onCancel: () => {
        ctrl.abort();
        this.showSetup();
      },
      onRetry: () => this.lastSetup && void this.buildAndRun(this.lastSetup),
      onBack: () => this.showSetup(),
    });
    this.swap(building);
    let scenario: ScenarioData;
    let warnings: string[] = [];
    try {
      scenario = await this.services.buildScenario(
        req,
        (p) => {
          if (ctrl.signal.aborted) return;
          warnings = p.warnings;
          building.progress(p);
        },
        ctrl.signal,
      );
    } catch (e) {
      if (ctrl.signal.aborted) return;
      console.error(e);
      building.fail((e as Error).message || 'Unknown error');
      return;
    }
    if (ctrl.signal.aborted) return;
    building.progress({ step: 'done', fraction: 1, message: 'Starting the simulation…', warnings });
    try {
      const imagery = await loadScenarioImagery(scenario.terrain.grid, req.demoSiteId, ctrl.signal).catch(() => null);
      let user: { x: number; y: number; heading: number | null } | null = null;
      if (setup.gps) {
        const [x, y] = new LocalProjection(scenario.origin).toLocal(setup.gps.position);
        if (Math.abs(x) < scenario.extent / 2 && Math.abs(y) < scenario.extent / 2) user = { x, y, heading: null };
      }
      const sim = await createSimScreen({
        scenario,
        services: this.services,
        imagery,
        user,
        buildWarnings: warnings,
        announce: this.announce,
        onExit: () => this.leaveSim(),
        onSettings: () => this.openSettings(),
        onNotice: () => void showNotice(this.root, { review: true }),
      });
      if (ctrl.signal.aborted) {
        sim.destroy();
        return;
      }
      this.swap(sim);
      this.sim = sim;
      sim.view.resize();
      history.pushState({ firesim: 'sim' }, '');
      this.announce(`Model ready: ${scenario.name}. Mark where the fire is with the Fire tool, then press Play.`);
      // Debug handle for development and automated tests only (?debug=1 exposes it in a production build).
      if (import.meta.env.DEV || this.params.has('mock') || this.params.has('debug')) (window as unknown as { __firesim?: unknown }).__firesim = { session: sim.session, view: sim.view, scenario, services: this.services };
    } catch (e) {
      console.error(e);
      building.fail(`Could not start the simulation: ${(e as Error).message}`);
    }
  }
}
