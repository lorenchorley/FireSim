/**
 * The words and the one rule of "Colour the map by speed" (0.7.0, E1b): which Wind height the Wind speed map follows, and what the chip and the Wind
 * speed row say about it. Pure (no DOM, no Three), unit-tested (windMapSwitch.test.ts); in the entry chunk, so it imports only the layer rules and the
 * words the controls already hold. The chip itself is windMapSwitch.ts.
 */
import { shownWindHeight, windMapHeight, type LayerState } from '../../../render/layers';
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

/** The second line of the Wind speed row ("In km/h") says which wind it is once the map follows a height other than the 10 m one. */
export function windSpeedSubline(line: string, height: WindHeight): string {
  if (height === 'fire') return line;
  return `${line}, ${height === 'felt' ? 'the wind the fire feels' : `at ${heightLabel(height)}`}`;
}
