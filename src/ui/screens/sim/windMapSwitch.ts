/**
 * "Colour the map by speed" (0.7.0, E1b): the one filter chip under the Wind height chips that paints the Wind speed map at the height chosen for
 * the arrows (docs/plans/0.7.0/D-CONTRACT-070-raster.md sections 0 and 4). It is pressed exactly while the heat map `overlay` is the Wind speed map, and
 * it reads and writes that one layer key (and the remembered choice), so the Layers panel's Wind speed row and this chip are one state. It needs what the
 * row needs (a fire marked, `layerCatalog`'s rule, worked out the way the Layers panel works it out) and says why when it cannot be used. Built lazily
 * with the Wind height chips, so it costs nothing while the arrows are off.
 */
import { availabilityContext, layerById } from '../../../render/layerCatalog';
import type { LayerState } from '../../../render/layers';
import { h, text, uniqueId } from '../../dom';
import { chip, setChipSelected } from '../../primitives';
import type { SimContext } from './context';
import { rememberLayerChoice } from './layersPrefs';
import { MAP_CHIP_LABEL } from './windMapWords';

export interface WindMapSwitch {
  /** The element `windGlyphControls` appends under the Wind height chips. */
  el: HTMLElement;
  /** Repaint from the stores (called from `paint()`, twice a second while the controls are on screen and on a change of the layer store). */
  update(): void;
  destroy(): void;
}

export function createWindMapSwitch(ctx: Pick<SimContext, 'layers' | 'view' | 'session'>): WindMapSwitch {
  const { layers, view } = ctx;
  const info = layerById('windSpeed')!;
  /** The view first, then the store (its subscribers read the view's new state), then the remembered choice: the Layers panel's order. */
  const set = (p: Partial<LayerState>): void => {
    view.setLayers(p);
    layers.set(p);
    void rememberLayerChoice({ layers: p });
  };
  /** The Wind speed row's answer, with the Layers panel's rule for "a fire is marked" (an ignition, or ground already burnt), not just "a snapshot exists". */
  const availability = (): { ok: boolean; reason?: string } => {
    try {
      const st = ctx.session.state.get();
      return info.available(availabilityContext({ snapshot: st.snapshot, fire: st.ignitions.length > 0 || (st.snapshot?.stats?.burntAreaHa ?? 0) > 0 }));
    } catch {
      return { ok: false, reason: 'Not available here' };
    }
  };
  const button = chip({
    label: MAP_CHIP_LABEL,
    kind: 'filter',
    selected: layers.get().overlay === 'windSpeed',
    testId: 'wind-map-chip',
    onToggle: (on) => set({ overlay: on ? 'windSpeed' : 'none' }),
  }) as HTMLButtonElement;
  const el = h('div', { class: 'wg-map', dataset: { testid: 'wind-map-switch' } }, button);
  let reason: HTMLElement | null = null; // made the first time it is needed
  return {
    el,
    update() {
      const on = layers.get().overlay === 'windSpeed';
      const a = availability();
      setChipSelected(button, on);
      // Like the arrows' own switch: one that cannot be used says why in words next to it, and one that is on stays operable so it can be turned off.
      button.disabled = !a.ok && !on;
      if (!a.ok && !reason) {
        reason = h('p', { class: 'hint wg-reason', dataset: { testid: 'wind-map-reason' } });
        el.append(reason);
      }
      if (reason) {
        text(reason, a.ok ? '' : (a.reason ?? 'Not available here'));
        reason.hidden = a.ok;
        if (a.ok) button.removeAttribute('aria-describedby');
        else {
          reason.id ||= uniqueId('wg-map-reason');
          button.setAttribute('aria-describedby', reason.id);
        }
      }
    },
    destroy() {},
  };
}
