/**
 * What a tap on a map icon says and does (workstream I, §9e; pure, tested in markerWords.test.ts): the row at the top of the
 * "Why here?" panel (the icon as drawn on the map, its name, one muted line of detail, and "+2 more icons here" when
 * several lie under the finger), the rule for which point a tap asks about, and when a time-bound icon no longer exists.
 */
import type { Insight } from '../../../core/types';
import type { MapMarker } from '../../../render/api';
import { Icon, severityIcon } from '../../../render/iconAtlas';
import { MARKER_COLOURS } from '../../../render/palette';
import { formatDistance, formatElapsedShort } from '../../format';
import { SEVERITY_LABELS } from '../../labels';
import type { ToolId } from './context';
import { INSIGHT_KIND_LABELS } from './insightCard';

/** The picture of a row: the map's own icon, or the UI's house in the home marker's colour (the map draws homes as 3-D houses). */
export type MarkerPic = { kind: 'icon'; icon: Icon } | { kind: 'home'; colour: string };

export interface MarkerRow {
  kind: MapMarker['kind'];
  pic: MarkerPic;
  name: string;
  detail: string;
  /** "+2 more icons here, zoom in to tell them apart", or null when the tapped icon stands alone. */
  more: string | null;
}

/** The stacked line: how many more icons were under the finger. Null for none. */
export function stackedLine(others: number): string | null {
  const n = Math.floor(others);
  if (!(n > 0)) return null;
  return `+${n} more ${n === 1 ? 'icon' : 'icons'} here, zoom in to tell them apart`;
}

/**
 * The row for a tapped icon. `clock` formats a simulation time as the wall clock of the scenario ("14:05"); the elapsed
 * time next to it is written as everywhere else in the panel ("+1:12").
 */
export function markerRow(m: MapMarker, clock: (t: number) => string): MarkerRow {
  const at = (t: number): string => `${clock(t)} (${formatElapsedShort(t)})`;
  const more = stackedLine(m.others);
  switch (m.kind) {
    case 'you':
      return { kind: m.kind, pic: { kind: 'icon', icon: Icon.User }, name: 'You are here', detail: "Your phone's position", more };
    case 'ignition': {
      const ig = m.ignition;
      if (ig.origin === 'spot') return { kind: m.kind, pic: { kind: 'icon', icon: Icon.Spot }, name: 'Spot fire', detail: `Spot fire you marked, lit at ${at(ig.time)}`, more };
      // The pin of a line or an area stands on its first point, and that is the point the panel then asks about.
      const first = ig.kind === 'point' ? '' : '. The pin is at its first point';
      return {
        kind: m.kind,
        pic: { kind: 'icon', icon: Icon.Ignition },
        name: ig.kind === 'line' ? 'Ignition line' : ig.kind === 'area' ? 'Ignition area' : 'Ignition point',
        detail: `${ig.origin === 'backburn' ? 'Back-burn' : 'Fire'} you marked, lit at ${at(ig.time)}${first}`,
        more,
      };
    }
    case 'spot': {
      const pic: MarkerPic = { kind: 'icon', icon: Icon.Spot };
      if (m.marked) return { kind: m.kind, pic, name: 'Spot fire', detail: `Spot fire you marked, lit at ${at(m.spot.time)}`, more };
      const ahead = m.spot.distance >= 5 ? `, ${formatDistance(m.spot.distance)} ahead of the front` : '';
      return { kind: m.kind, pic, name: 'Spot fire', detail: `Started by an ember at ${at(m.spot.time)}${ahead}`, more };
    }
    case 'insight': {
      const ins = m.insight;
      return { kind: m.kind, pic: { kind: 'icon', icon: severityIcon(ins.severity) }, name: `${SEVERITY_LABELS[ins.severity]}: ${INSIGHT_KIND_LABELS[ins.kind] ?? INSIGHT_KIND_LABELS.general}`, detail: ins.title, more };
    }
    case 'home':
      return { kind: m.kind, pic: { kind: 'home', colour: MARKER_COLOURS.home }, name: 'Home', detail: 'One marker per address', more };
  }
}

/** The simulation time (s) an icon exists from, or null for one that has none (you, a home). */
export function markerTime(m: MapMarker): number | null {
  switch (m.kind) {
    case 'ignition':
      return m.ignition.time;
    case 'spot':
      return m.spot.time;
    case 'insight':
      return m.insight.time;
    default:
      return null;
  }
}

/**
 * Whether the icon is on the map at the view time. Ignitions, spot fires and insights appear when their time comes and go
 * again when the clock is taken back before it (the session shows an ignition from one second early). The forecast cards
 * (`forecast`: the cards of the whole run, known from the start) are always on the map whatever their time.
 */
export function markerShownAt(m: MapMarker, viewTime: number, forecast: readonly Insight[] = []): boolean {
  const t = markerTime(m);
  if (t === null) return true;
  if (m.kind === 'insight' && forecast.some((f) => f === m.insight || (f.id !== '' && f.id === m.insight.id))) return true;
  return t <= viewTime + 1;
}

/** What a tap on the map asks about: the point, and the icon it was on (only in the Why tool). */
export interface TapTarget {
  point: [number, number];
  marker: MapMarker | null;
}

/**
 * The point a tap asks about. In the Why tool an icon under the finger wins and the question is about the icon's own spot
 * (a pin's tip, not wherever the finger's ray meets the ground), which also works when the ray misses the ground. The other
 * tools (fire, fuel, wind, …) keep placing and painting on the ground whatever lies under the finger. Null when there is
 * nothing to ask about.
 */
export function tapTarget(tool: ToolId, marker: MapMarker | null | undefined, ground: [number, number] | null): TapTarget | null {
  if (tool === 'why' && marker) return { point: [marker.x, marker.y], marker };
  return ground ? { point: ground, marker: null } : null;
}
