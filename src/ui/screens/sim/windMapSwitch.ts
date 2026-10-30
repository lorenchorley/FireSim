/**
 * "Colour the map by speed" (0.7.0, E1b): the one filter chip under the Wind height chips that paints the Wind speed map at the height chosen for
 * the arrows (docs/plans/0.7.0/D-CONTRACT-070-raster.md sections 0 and 4). C0 STUB: an empty hidden `div`, so the one pre-wired hook in
 * `windGlyphControls.ts` (append `el` after the chips, `update()` in `paint()`, `destroy()` in `destroy()`) is already in place and lane R never
 * edits that file. Inert: nothing is drawn and nothing is read until the lane builds it. Built lazily with the chips, so it costs nothing while the arrows are off.
 */
import type { SimContext } from './context';
import { h } from '../../dom';

export interface WindMapSwitch {
  /** The element `windGlyphControls` appends under the Wind height chips. */
  el: HTMLElement;
  /** Repaint from the stores (called from `paint()`, twice a second while the controls are on screen and on a change of the layer store). */
  update(): void;
  destroy(): void;
}

export function createWindMapSwitch(_ctx: Pick<SimContext, 'layers' | 'view' | 'session'>): WindMapSwitch {
  const el = h('div', { hidden: true, dataset: { testid: 'wind-map-switch' } });
  return { el, update() {}, destroy() {} };
}
