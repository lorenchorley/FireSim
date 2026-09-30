/**
 * Data sets screen (contract stub — builder DS implements it): every data set used by the scenario with its size, origin,
 * vintage, resolution, statistics and licence; working memory; on-device storage; planned data before a build.
 */
import type { ScenarioData, SimSnapshot } from '../../core/types';
import type { LayerState, OverlayKind } from '../../render/layers';
import { h } from '../dom';
import type { Services } from '../modules';

export interface DatasetsScreenOptions {
  /** The running scenario; null = planned/stored/bundled data only (opened from Setup or Settings before a run). */
  scenario: ScenarioData | null;
  services: Services;
  getSnapshot?: () => SimSnapshot | null;
  onClose(): void;
  /** 'Show on map': close the screen and show this layer / heat map. */
  onShowLayer?(t: { overlay?: OverlayKind; sceneKey?: keyof LayerState }): void;
  /** Open the "How this simulation works" card. */
  onOpenModelCard?(): void;
  /** Open straight at this data set's detail page. */
  initialDatasetId?: string;
}

export function createDatasetsScreen(opts: DatasetsScreenOptions): { el: HTMLElement; destroy(): void } {
  const el = h('section', { class: 'datasets-screen', attrs: { role: 'dialog', 'data-testid': 'datasets-screen' }, aria: { modal: 'true', label: 'Data sets' } });
  void opts;
  return { el, destroy() {} };
}
