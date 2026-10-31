/**
 * "Colour the map by speed" (0.7.0, E1b): the one filter chip under the Wind height chips that paints the Wind speed map at the height chosen for
 * the arrows (docs/plans/0.7.0/D-CONTRACT-070-raster.md sections 0 and 4). It is pressed exactly while the heat map `overlay` is the Wind speed map, and
 * it reads and writes that one layer key (and the remembered choice), so the Layers panel's Wind speed row and this chip are one state. It needs what the
 * row needs (a fire marked, `layerCatalog`'s rule, worked out the way the Layers panel works it out). Built lazily with the Wind height chips, so it costs
 * nothing while the arrows are off. The chip is the whole of it (`el` is the button: the Layers panel's DOM budget has no node to spare); when it cannot be
 * used it is greyed and the caption under it says why (`reason()`, which `windGlyphControls` puts in the caption) and is its accessible description.
 */
import { availabilityContext, layerById } from '../../../render/layerCatalog';
import type { LayerState } from '../../../render/layers';
import { chip, setChipSelected } from '../../primitives';
import type { SimContext } from './context';
import { rememberLayerChoice } from './layersPrefs';
import { MAP_CHIP_LABEL, windMapChipState, windMapPatch } from './windMapWords';

export interface WindMapSwitch {
  /** The element `windGlyphControls` appends under the Wind height chips: the chip itself. */
  el: HTMLElement;
  /** Repaint from the stores (called from `paint()`, twice a second while the controls are on screen and on a change of the layer store); `describedBy` is the id of the caption that says why it cannot be used. */
  update(describedBy?: string): void;
  /** Why the chip cannot be used now (the Wind speed row's reason), or '' when it can. */
  reason(): string;
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
    onToggle: (on) => set(windMapPatch(on)),
  }) as HTMLButtonElement;
  const stateNow = (): ReturnType<typeof windMapChipState> => windMapChipState(layers.get().overlay, availability());
  return {
    el: button,
    update(describedBy) {
      const st = stateNow();
      setChipSelected(button, st.pressed);
      // Like the arrows' own switch: one that cannot be used is greyed and says why in words next to it, and one that is on stays operable so it can be turned off.
      button.disabled = st.disabled;
      if (st.reason && describedBy) button.setAttribute('aria-describedby', describedBy);
      else button.removeAttribute('aria-describedby');
    },
    reason: () => stateNow().reason,
    destroy() {},
  };
}
