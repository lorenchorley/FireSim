/**
 * App shell and screen flow: safety notice → Setup → Building → Simulation, with full-screen screens on top (Settings,
 * Data sets, How this simulation works). Always shows the TRAINING strip and hosts the screen-reader live region.
 *
 * Full-screen screens are OVERLAYS: they cover the stage (which becomes inert, so focus and screen readers stay in the
 * screen) while the simulation keeps running and rendering underneath; opening one never pauses or changes playback.
 * Closing one returns focus to the control that opened it. The Back button (Android hardware Back, the browser's Back,
 * Escape) closes the top-most thing first — a confirmation, a dataset's detail page, the screen, then the simulation's own
 * menus, popovers, panels and dock — and only then asks before leaving the simulation (backStack.ts).
 */
import { LocalProjection } from '../core/geo';
import type { ScenarioData } from '../core/types';
import type { LayerState, OverlayKind } from '../render/layers';
import { BackStack, escapeStep, setAppBackStack } from './backStack';
import { h, text } from './dom';
import { icon } from './icons';
import { loadScenarioImagery } from './imagery';
import type { Services } from './modules';
import { buildRequest, type SetupState } from './setupModel';
import { settingsStore } from './settings';
import { createBuildingScreen, type BuildingScreen } from './screens/building';
import { createDatasetsScreen } from './screens/datasets';
import { createModelCardScreen } from './screens/modelCard';
import { noticeAccepted, showNotice } from './screens/notice';
import { createSettingsScreen } from './screens/settings';
import { createSetupScreen, type SetupScreen } from './screens/setup';
import { createSimScreen, type SimScreen } from './screens/sim/simScreen';
import { confirmDialog } from './widgets';

interface Screen {
  el: HTMLElement;
  destroy(): void;
}

/** What "Show on map" of the Data sets screen asks for. */
export type ShowLayerTarget = { overlay?: OverlayKind; sceneKey?: keyof LayerState };

/** A full-screen screen shown over the stage. */
interface Overlay {
  id: 'settings' | 'datasets' | 'model-card';
  screen: Screen;
  host: HTMLElement;
  opener: HTMLElement | null;
  removeLayer: () => void;
}

export class App {
  private screen: Screen | null = null;
  private sim: SimScreen | null = null;
  private setup: SetupScreen | null = null;
  private building: BuildingScreen | null = null;
  /** The scenario of the current (or last) simulation, for the Data sets screen and the model card. */
  private scenario: ScenarioData | null = null;
  private readonly overlays: Overlay[] = [];
  private readonly live: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly back: BackStack;
  private build: AbortController | null = null;
  private lastSetup: SetupState | null = null;
  private leaving = false;

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
    this.back = new BackStack(history);
    setAppBackStack(this.back);
    this.back.setBase({ back: () => this.baseBack(), closable: () => !!this.sim || !!this.building });
    window.addEventListener('popstate', () => this.back.onPopState());
    // Cordova-style hardware Back event (fired by the @capacitor/app plugin's bridge when it is installed); without it the
    // native shell maps Back to WebView.goBack(), which arrives here as popstate.
    document.addEventListener('backbutton', () => this.back.back());
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
    (next.el.querySelector('h1, [data-autofocus]') as HTMLElement | null)?.focus?.({ preventScroll: true });
  }

  showSetup(): void {
    this.sim = null;
    this.building = null;
    this.scenario = null; // release the finished run's grids (the Data sets screen then shows planned and stored data)
    this.closeOverlays();
    const setup = createSetupScreen({
      services: this.services,
      onBuild: (s) => void this.buildAndRun(s),
      onSettings: () => this.openSettings(),
      onOpenDatasets: (id) => this.openDatasets(id),
      onOpenModelCard: () => this.openModelCard(),
    });
    this.setup = setup;
    this.swap(setup);
    this.back.sync();
  }

  // ───────────── overlays ─────────────

  private openOverlay(id: Overlay['id'], screen: Screen): void {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const host = h('div', { class: 'app-overlay', dataset: { overlay: id } }, screen.el);
    // Keyboard Escape goes through the same path as Back: one step (e.g. a detail page back to its list), else close.
    host.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape' || !e.isTrusted || e.defaultPrevented) return;
        if (this.overlays[this.overlays.length - 1]?.host !== host) return;
        e.preventDefault();
        e.stopPropagation();
        this.back.back();
      },
      { capture: true },
    );
    const ov: Overlay = { id, screen, host, opener, removeLayer: () => undefined };
    // Back steps inside the screen first (it handles Escape itself: a detail page returns to its list); when nothing
    // inside reacted, the screen closes.
    ov.removeLayer = this.back.push({ id, back: () => this.overlays.includes(ov) && escapeStep(screen.el, host), close: () => this.closeOverlay(ov) });
    this.overlays.push(ov);
    this.root.insertBefore(host, this.live);
    this.updateInert();
    (screen.el.querySelector('h1, [data-autofocus], button') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  private closeOverlay(ov: Overlay): void {
    const i = this.overlays.indexOf(ov);
    if (i < 0) return;
    this.overlays.splice(i, 1);
    ov.removeLayer();
    try {
      ov.screen.destroy();
    } catch (e) {
      console.error(e);
    }
    ov.host.remove();
    this.updateInert();
    if (ov.opener?.isConnected && !ov.opener.closest('[inert]')) ov.opener.focus({ preventScroll: true });
  }

  private closeOverlays(): void {
    for (const ov of [...this.overlays].reverse()) this.closeOverlay(ov);
  }

  /** Only the top-most overlay (or the stage, when none is open) takes focus and is read out. */
  private updateInert(): void {
    const top = this.overlays[this.overlays.length - 1];
    this.stage.inert = !!top;
    for (const ov of this.overlays) ov.host.inert = ov !== top;
  }

  private openSettings(): void {
    if (this.overlays.some((o) => o.id === 'settings')) return;
    let ov: Overlay | undefined;
    const screen = createSettingsScreen({
      services: this.services,
      onClose: () => ov && this.closeOverlay(ov),
      onNotice: () => void showNotice(this.root, { review: true }),
      onOpenDatasets: (id) => this.openDatasets(id),
      onOpenModelCard: () => this.openModelCard(),
    });
    this.openOverlay('settings', screen);
    ov = this.overlays[this.overlays.length - 1];
  }

  /** The Data sets screen: the running scenario's inventory, or (from Setup / no run) the planned, stored and bundled data. */
  openDatasets(datasetId?: string): void {
    const existing = this.overlays.find((o) => o.id === 'datasets');
    if (existing) this.closeOverlay(existing);
    let ov: Overlay | undefined;
    const sim = this.sim;
    const screen = createDatasetsScreen({
      scenario: sim ? this.scenario : null,
      services: this.services,
      getSnapshot: () => this.sim?.session.state.get().snapshot ?? null,
      onClose: () => ov && this.closeOverlay(ov),
      ...(sim ? { onShowLayer: (t: ShowLayerTarget) => this.showLayer(t) } : {}),
      onOpenModelCard: () => this.openModelCard(),
      ...(datasetId ? { initialDatasetId: datasetId } : {}),
    });
    this.openOverlay('datasets', screen);
    ov = this.overlays[this.overlays.length - 1];
  }

  /** "How this simulation works": from the running scenario, or a preview of the Setup's current choice. */
  openModelCard(): void {
    const existing = this.overlays.find((o) => o.id === 'model-card');
    if (existing) this.closeOverlay(existing);
    let ov: Overlay | undefined;
    const request = this.setup?.state() ?? this.lastSetup ?? undefined;
    const screen = createModelCardScreen({
      scenario: this.sim ? this.scenario : null,
      ...(request ? { request } : {}),
      services: this.services,
      getSnapshot: () => this.sim?.session.state.get().snapshot ?? null,
      settings: () => settingsStore.get(),
      onClose: () => ov && this.closeOverlay(ov),
      onOpenDatasets: (id) => this.openDatasets(id),
    });
    this.openOverlay('model-card', screen);
    ov = this.overlays[this.overlays.length - 1];
  }

  /** "Show on map" from the Data sets screen: back to the running simulation, with that layer or heat map on. */
  private showLayer(t: ShowLayerTarget): void {
    this.closeOverlays();
    this.sim?.showLayer(t);
  }

  // ───────────── Back ─────────────

  /** Back with no overlay open: cancel a build; in the simulation close its top-most menu or panel, else ask to leave. */
  private baseBack(): boolean {
    if (this.building) {
      this.build?.abort();
      this.showSetup();
      return true;
    }
    const sim = this.sim;
    if (!sim) return false;
    if (sim.back()) return true;
    void this.confirmLeave();
    return true;
  }

  private async confirmLeave(): Promise<void> {
    if (this.leaving) return;
    this.leaving = true;
    const ok = await confirmDialog({
      title: 'Leave this simulation?',
      body: 'The model and everything you marked are closed, and you go back to Setup to start a new scenario.',
      confirmLabel: 'Leave',
      cancelLabel: 'Stay',
      testId: 'confirm-leave',
    });
    this.leaving = false;
    if (ok && this.sim) this.showSetup();
  }

  // ───────────── build and run ─────────────

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
    this.closeOverlays();
    this.setup = null;
    this.sim = null;
    this.swap(building);
    this.building = building;
    this.back.sync();
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
    if (scenario.datasets?.length) building.datasets(scenario.datasets);
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
        onExit: () => this.showSetup(),
        onSettings: () => this.openSettings(),
        onNotice: () => void showNotice(this.root, { review: true }),
        onOpenDatasets: (id) => this.openDatasets(id),
        onOpenModelCard: () => this.openModelCard(),
      });
      if (ctrl.signal.aborted || this.building !== building) {
        sim.destroy();
        return;
      }
      this.building = null;
      this.scenario = scenario;
      this.swap(sim);
      this.sim = sim;
      sim.view.resize();
      this.back.sync();
      this.announce(`Model ready: ${scenario.name}. Mark where the fire is with the Fire tool, then press Play.`);
      // Debug handle for development and automated tests only (?debug=1 exposes it in a production build).
      if (import.meta.env.DEV || this.params.has('mock') || this.params.has('debug')) (window as unknown as { __firesim?: unknown }).__firesim = { session: sim.session, view: sim.view, scenario, services: this.services, app: this };
    } catch (e) {
      console.error(e);
      building.fail(`Could not start the simulation: ${(e as Error).message}`);
    }
  }
}
