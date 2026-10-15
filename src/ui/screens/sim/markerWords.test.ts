/** What a tap on an icon says and does (markerWords.ts): the row, the stacked line, the drop rule and which point a tap asks about. */
import { describe, expect, it } from 'vitest';
import type { Ignition, Insight, InsightKind, InsightSeverity, SpotFire } from '../../../core/types';
import type { MapMarker } from '../../../render/api';
import { Icon } from '../../../render/iconAtlas';
import { MARKER_COLOURS } from '../../../render/palette';
import { placesLegend } from '../../../render/placesLegend';
import { SEVERITY_LABELS } from '../../labels';
import type { ToolId } from './context';
import { INSIGHT_KIND_LABELS } from './insightCard';
import { markerRow, markerShownAt, markerTime, stackedLine, tapTarget } from './markerWords';

/** The wall clock of a scenario that starts at 14:05, in the plain "HH:MM" of the panel. */
const clock = (t: number): string => {
  const m = 14 * 60 + 5 + Math.round(t / 60);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

const ignition = (over: Partial<Ignition> = {}): Ignition => ({ id: 'i1', kind: 'point', points: [[10, 20]], time: 0, origin: 'observed', ...over });
const spot = (over: Partial<SpotFire> = {}): SpotFire => ({ id: 1, x: 5, y: 6, time: 27 * 60, distance: 450, travel: 500, ...over });
const insight = (over: Partial<Insight> = {}): Insight => ({ id: 'n1', kind: 'ridge-crest', severity: 'info', time: 0, x: 1, y: 2, title: 'Fire reaches a ridge top', body: '', factors: [], ...over });

const igMarker = (over: Partial<Ignition> = {}, others = 0): MapMarker => ({ kind: 'ignition', x: 10, y: 20, others, ignition: ignition(over) });
const spotMarker = (over: Partial<SpotFire> = {}, marked = false, others = 0): MapMarker => ({ kind: 'spot', x: 5, y: 6, others, spot: spot(over), ...(marked ? { marked } : {}) });
const insMarker = (over: Partial<Insight> = {}, others = 0): MapMarker => ({ kind: 'insight', x: 1, y: 2, others, insight: insight(over) });

describe('markerRow: the words of every icon', () => {
  it('you', () => {
    expect(markerRow({ kind: 'you', x: 0, y: 0, others: 0 }, clock)).toEqual({ kind: 'you', pic: { kind: 'icon', icon: Icon.User }, name: 'You are here', detail: "Your phone's position", more: null });
  });

  it('an ignition point you marked (the pin marks the point itself)', () => {
    expect(markerRow(igMarker({ time: 0 }), clock)).toEqual({
      kind: 'ignition',
      pic: { kind: 'icon', icon: Icon.Ignition },
      name: 'Ignition point',
      detail: 'Fire you marked, lit at 14:05 (+0:00)',
      more: null,
    });
  });

  it('an ignition line and an ignition area say the pin is at the first point', () => {
    const line = markerRow(igMarker({ kind: 'line', points: [[0, 0], [10, 10]], time: 600 }), clock);
    expect(line.name).toBe('Ignition line');
    expect(line.detail).toBe('Fire you marked, lit at 14:15 (+0:10). The pin is at its first point');
    const area = markerRow(igMarker({ kind: 'area', points: [[0, 0], [10, 10], [0, 10]] }), clock);
    expect(area.name).toBe('Ignition area');
    expect(area.detail).toBe('Fire you marked, lit at 14:05 (+0:00). The pin is at its first point');
  });

  it('a back-burn', () => {
    const r = markerRow(igMarker({ origin: 'backburn', time: 3600 }), clock);
    expect(r.name).toBe('Ignition point');
    expect(r.detail).toBe('Back-burn you marked, lit at 15:05 (+1:00)');
    expect(r.pic).toEqual({ kind: 'icon', icon: Icon.Ignition });
  });

  it('a spot fire the user marked (an ignition with origin spot: the map draws it as the spot icon)', () => {
    const r = markerRow(igMarker({ origin: 'spot', time: 1620 }), clock);
    expect(r).toMatchObject({ kind: 'ignition', pic: { kind: 'icon', icon: Icon.Spot }, name: 'Spot fire', detail: 'Spot fire you marked, lit at 14:32 (+0:27)' });
  });

  it('a simulated spot fire: when, and how far ahead of the front', () => {
    const r = markerRow(spotMarker({ time: 4320, distance: 450 }), clock);
    expect(r).toEqual({ kind: 'spot', pic: { kind: 'icon', icon: Icon.Spot }, name: 'Spot fire', detail: 'Started by an ember at 15:17 (+1:12), 450 m ahead of the front', more: null });
    expect(markerRow(spotMarker({ distance: 1234 }), clock).detail).toContain('1.2 km ahead of the front');
    expect(markerRow(spotMarker({ distance: 0 }), clock).detail).toBe('Started by an ember at 14:32 (+0:27)'); // no "0 m ahead"
  });

  it('a spot fire given to the view as a SpotFire the user marked', () => {
    expect(markerRow(spotMarker({}, true), clock).detail).toBe('Spot fire you marked, lit at 14:32 (+0:27)');
  });

  it('an insight: the severity word and the kind in the name, the card title as the detail, the severity shape as the picture', () => {
    const danger = markerRow(insMarker({ severity: 'danger', kind: 'upslope-run', title: 'Fire running up a steep slope' }), clock);
    expect(danger).toEqual({ kind: 'insight', pic: { kind: 'icon', icon: Icon.Danger }, name: 'Danger: Uphill run', detail: 'Fire running up a steep slope', more: null });
    const watch = markerRow(insMarker({ severity: 'watch', kind: 'mass-spotting', title: 'Embers are landing ahead' }), clock);
    expect(watch).toMatchObject({ pic: { icon: Icon.Watch }, name: 'Watch out: Ember shower', detail: 'Embers are landing ahead' });
    expect(markerRow(insMarker(), clock)).toMatchObject({ pic: { icon: Icon.Info }, name: 'Insight: Ridge top', detail: 'Fire reaches a ridge top' });
  });

  it('every insight kind and severity has a name of the form "Severity: Kind" and the matching picture', () => {
    const icons: Record<InsightSeverity, Icon> = { danger: Icon.Danger, watch: Icon.Watch, info: Icon.Info };
    const kinds = Object.keys(INSIGHT_KIND_LABELS) as InsightKind[];
    expect(kinds.length).toBeGreaterThan(30);
    for (const kind of kinds) {
      for (const severity of ['danger', 'watch', 'info'] as const) {
        const r = markerRow(insMarker({ kind, severity, title: `T ${kind}` }), clock);
        expect(r.name).toBe(`${SEVERITY_LABELS[severity]}: ${INSIGHT_KIND_LABELS[kind]}`);
        expect(r.detail).toBe(`T ${kind}`);
        expect(r.pic).toEqual({ kind: 'icon', icon: icons[severity] });
      }
    }
  });

  it('an insight of a kind this build does not name falls back to the general wording', () => {
    expect(markerRow(insMarker({ kind: 'from-the-future' as InsightKind }), clock).name).toBe('Insight: Fire behaviour');
  });

  it('a home: the UI house in the home marker colour (the roof of the map\'s houses)', () => {
    expect(markerRow({ kind: 'home', x: 1, y: 1, others: 0 }, clock)).toEqual({ kind: 'home', pic: { kind: 'home', colour: MARKER_COLOURS.home }, name: 'Home', detail: 'One marker per address', more: null });
  });

  it('the home colour is the one the Homes legend entry shows', () => {
    const entry = placesLegend({ homes: true })[0]!.entries[0]!;
    expect(entry.colour).toBe(MARKER_COLOURS.home);
  });

  it('times are written as elsewhere in the panel: the clock, then the elapsed time as +h:mm', () => {
    expect(markerRow(igMarker({ time: 8100 }), clock).detail).toBe('Fire you marked, lit at 16:20 (+2:15)');
  });
});

describe('the stacked line', () => {
  it('says how many more icons lie under the finger, in the singular and the plural', () => {
    expect(stackedLine(0)).toBeNull();
    expect(stackedLine(-1)).toBeNull();
    expect(stackedLine(Number.NaN)).toBeNull();
    expect(stackedLine(1)).toBe('+1 more icon here, zoom in to tell them apart');
    expect(stackedLine(2)).toBe('+2 more icons here, zoom in to tell them apart');
    expect(stackedLine(11)).toBe('+11 more icons here, zoom in to tell them apart');
  });

  it('is on the row of whichever kind of icon was tapped', () => {
    for (const m of [igMarker({}, 2), spotMarker({}, false, 2), insMarker({}, 2), { kind: 'you', x: 0, y: 0, others: 2 } as MapMarker, { kind: 'home', x: 0, y: 0, others: 2 } as MapMarker]) {
      expect(markerRow(m, clock).more).toBe('+2 more icons here, zoom in to tell them apart');
    }
  });
});

describe('when an icon exists', () => {
  it('has a time for the time-bound icons only', () => {
    expect(markerTime(igMarker({ time: 600 }))).toBe(600);
    expect(markerTime(spotMarker({ time: 700 }))).toBe(700);
    expect(markerTime(insMarker({ time: 800 }))).toBe(800);
    expect(markerTime({ kind: 'you', x: 0, y: 0, others: 0 })).toBeNull();
    expect(markerTime({ kind: 'home', x: 0, y: 0, others: 0 })).toBeNull();
  });

  it('a time-bound icon is dropped when the view time goes back before it (the session shows an ignition from one second early)', () => {
    for (const m of [igMarker({ time: 600 }), spotMarker({ time: 600 }), insMarker({ time: 600 })]) {
      expect(markerShownAt(m, 1200)).toBe(true);
      expect(markerShownAt(m, 600)).toBe(true);
      expect(markerShownAt(m, 599)).toBe(true);
      expect(markerShownAt(m, 598)).toBe(false);
      expect(markerShownAt(m, 0)).toBe(false);
    }
  });

  it('you and a home exist at every time', () => {
    expect(markerShownAt({ kind: 'you', x: 0, y: 0, others: 0 }, -5)).toBe(true);
    expect(markerShownAt({ kind: 'home', x: 0, y: 0, others: 0 }, 0)).toBe(true);
  });

  it('a forecast card is on the map from the start, whatever its time', () => {
    const f = insight({ id: '', time: 5 * 3600 });
    expect(markerShownAt({ kind: 'insight', x: 0, y: 0, others: 0, insight: f }, 0)).toBe(false);
    expect(markerShownAt({ kind: 'insight', x: 0, y: 0, others: 0, insight: f }, 0, [f])).toBe(true);
    const g = insight({ id: 'f7', time: 5 * 3600 });
    expect(markerShownAt({ kind: 'insight', x: 0, y: 0, others: 0, insight: { ...g } }, 0, [g])).toBe(true); // the same card by id
    expect(markerShownAt({ kind: 'insight', x: 0, y: 0, others: 0, insight: insight({ id: 'other', time: 5 * 3600 }) }, 0, [g])).toBe(false);
  });
});

describe('tapTarget: which point a tap asks about', () => {
  const ground: [number, number] = [100, 200];
  const marker = igMarker();
  const tools: ToolId[] = ['why', 'fire', 'fuel', 'wind', 'layers', 'whatif', 'air'];

  it('in the Why tool the icon wins and the point is the icon\'s own spot, not the ground under the finger', () => {
    expect(tapTarget('why', marker, ground)).toEqual({ point: [10, 20], marker });
  });

  it('the other tools ignore the icon and keep the ground', () => {
    for (const tool of tools.filter((t) => t !== 'why')) expect(tapTarget(tool, marker, ground)).toEqual({ point: ground, marker: null });
  });

  it('with no icon every tool gets the ground, and the Why target has no marker', () => {
    for (const tool of tools) {
      expect(tapTarget(tool, null, ground)).toEqual({ point: ground, marker: null });
      expect(tapTarget(tool, undefined, ground)).toEqual({ point: ground, marker: null });
    }
  });

  it('an icon works in the Why tool when the finger\'s ray misses the ground', () => {
    expect(tapTarget('why', marker, null)).toEqual({ point: [10, 20], marker });
  });

  it('the other tools get nothing when the ground is missed, even with an icon under the finger', () => {
    for (const tool of tools.filter((t) => t !== 'why')) expect(tapTarget(tool, marker, null)).toBeNull();
  });

  it('with neither an icon nor the ground there is nothing to ask about', () => {
    for (const tool of tools) expect(tapTarget(tool, null, null)).toBeNull();
  });
});
