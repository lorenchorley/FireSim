/**
 * The words and the one rule of "Colour the map by speed" (0.7.0, E1b): which Wind height the Wind speed map follows, and what the chip and the Wind
 * speed row say about it. Pure (no DOM, no Three), unit-tested (windMapSwitch.test.ts); in the entry chunk, so it imports only the layer rules and the
 * words the controls already hold. The chip itself is windMapSwitch.ts.
 */
import { shownWindHeight, windMapHeight, type LayerState, type OverlayKind } from '../../../render/layers';
import type { WindHeight } from '../../../render/wind/glyphTypes';
import { heightLabel } from './glyphWords';

export const MAP_CHIP_LABEL = 'Colour the map by speed';

/**
 * The Wind height the Wind speed map follows now, as it is really drawn: the arrows' height while they are on, else the 10 m wind, and the 10 m wind
 * again for What the fire feels when the picture has none (`snapshot.fireWind`). The view, the legend and the Layers panel all use this one rule.
 */
export function mapHeightNow(l: Pick<LayerState, 'windGlyphs' | 'windHeight'>, snapshot: { fireWind?: unknown } | null | undefined): WindHeight {
  return shownWindHeight(windMapHeight(l), !!snapshot?.fireWind);
}

/** The caption line under the chip while it cannot be used: its name and the Wind speed row's own reason ("Colour the map by speed. Needs a fire: mark one first."); '' when it can be used. */
export const windMapReasonLine = (reason: string): string => (reason ? `${MAP_CHIP_LABEL}. ${reason}.` : '');

/** What pressing the chip writes: the Wind speed map on, or no heat map. It writes the one `overlay` key and nothing else (one heat map at a time, solo heat as for any heat map). */
export const windMapPatch = (on: boolean): Pick<LayerState, 'overlay'> => ({ overlay: on ? 'windSpeed' : 'none' });

/**
 * What the chip shows: pressed exactly while the Wind speed map is the heat map; one that cannot be used (the Wind speed row's rule: a fire marked) is
 * greyed with the reason beside it, and one that is on stays operable so it can always be turned off.
 */
export function windMapChipState(overlay: OverlayKind, availability: { ok: boolean; reason?: string }): { pressed: boolean; disabled: boolean; reason: string } {
  const pressed = overlay === 'windSpeed';
  return { pressed, disabled: !availability.ok && !pressed, reason: availability.ok ? '' : (availability.reason ?? 'Not available here') };
}

/** The second line of the Wind speed row ("In km/h") says which wind it is once the map follows a height other than the 10 m one. */
export function windSpeedSubline(line: string, height: WindHeight): string {
  if (height === 'fire') return line;
  return `${line}, ${height === 'felt' ? 'the wind the fire feels' : `at ${heightLabel(height)}`}`;
}
