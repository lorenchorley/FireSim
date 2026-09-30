/**
 * "How this simulation works" (contract stub — builder M implements it): dimensionality, grids, time steps, methods,
 * evidence and limits of the simulation, from live engine values.
 */
import type { ScenarioData, SimSnapshot } from '../../core/types';
import { h } from '../dom';
import type { Services } from '../modules';
import type { Settings } from '../settings';
import type { SetupState } from '../setupModel';

export interface ModelCardOptions {
  /** The running scenario; null = a compact preview computed from `request` (opened from Setup). */
  scenario: ScenarioData | null;
  request?: SetupState;
  services: Services;
  getSnapshot?: () => SimSnapshot | null;
  settings: () => Settings;
  onClose(): void;
  onOpenDatasets?(datasetId?: string): void;
}

export function createModelCardScreen(opts: ModelCardOptions): { el: HTMLElement; destroy(): void } {
  const el = h('section', { class: 'modelcard-screen', attrs: { role: 'dialog', 'data-testid': 'model-card' }, aria: { modal: 'true', label: 'How this simulation works' } });
  void opts;
  return { el, destroy() {} };
}
