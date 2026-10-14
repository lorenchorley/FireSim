/**
 * The Help tab's words (content.ts: the how-to list and the glossary), pinned two ways: their shape and voice (plain words, no
 * em dashes, nothing undefined), and, for the 0.3.0 features, that what they say is what the code says (the labels the
 * screens use, the sheet's own sentences, the tap radius, the words of the icons), so a change to a screen cannot leave a
 * stale sentence in Help.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Ignition, Insight, InsightKind, InsightSeverity, SpotFire } from '../core/types';
import type { MapMarker } from '../render/api';
import { rockDetailCount } from '../render/cliffDrawing';
import { MIN_HIT_PX } from '../render/markerPick';
import { TERRAIN_DRAWING_NOTE } from '../scenario/datasetRecords';
import { GLOSSARY, HELP_STEPS, type GlossaryEntry } from './content';
import { TITLE as DEBUG_STATS_TITLE } from './debugStats';
import { forcedPace } from './paceModel';
import { FAST_NOTE, paceSheet } from './paceSheetModel';
import { markerRow, stackedLine } from './screens/sim/markerWords';
import { NIGHT_LOOK_HINT, NIGHT_LOOK_OPTIONS } from './screens/sim/layersModel';
import { PICTURE_QUALITY_HINT } from './screens/settings';
import { resolveRenderQuality } from './settings';

const entry = (term: string): GlossaryEntry => {
  const e = GLOSSARY.find((g) => g.term === term);
  if (!e) throw new Error(`no glossary entry "${term}"`);
  return e;
};
const step = (label: string): string => {
  const s = HELP_STEPS.find((x) => x.label === label);
  if (!s) throw new Error(`no help step "${label}"`);
  return s.text;
};
/** Every sentence of an entry, for the rules that apply to all of it. */
const textOf = (g: GlossaryEntry): string => [g.term, g.short ?? '', g.body, ...(g.items ?? []).flatMap((i) => [i.name, i.text])].join('\n');
const everything = (): string[] => [...GLOSSARY.map(textOf), ...HELP_STEPS.map((s) => `${s.label}\n${s.text}`)];
const squash = (s: string): string => s.replace(/\s+/g, ' ');

describe('Help and glossary: shape and voice', () => {
  it('every glossary term is unique and has a body; every help step is unique and has a label and text', () => {
    const terms = GLOSSARY.map((g) => g.term.toLowerCase());
    expect(new Set(terms).size).toBe(terms.length);
    for (const g of GLOSSARY) {
      expect(g.term.trim(), 'a term').not.toBe('');
      expect(g.body.trim(), `the body of ${g.term}`).not.toBe('');
      if (g.short !== undefined) expect(g.short.trim(), `the short line of ${g.term}`).not.toBe('');
      for (const it of g.items ?? []) {
        expect(it.name.trim()).not.toBe('');
        expect(it.text.trim()).not.toBe('');
      }
    }
    const labels = HELP_STEPS.map((s) => s.label.toLowerCase());
    expect(new Set(labels).size).toBe(labels.length);
    for (const s of HELP_STEPS) {
      expect(s.label.trim()).not.toBe('');
      expect(s.text.trim()).not.toBe('');
    }
  });

  it('no em dash anywhere (the voice of the app: a full stop, a colon or a comma instead)', () => {
    for (const t of everything()) expect(t).not.toContain('—');
  });

  it('nothing prints a value that is not there, and nothing promises more than the model does', () => {
    for (const t of everything()) {
      expect(t).not.toMatch(/\b(undefined|NaN|Infinity|null|\[object)\b/);
      expect(t).not.toMatch(/you are safe/i);
    }
  });

  it('terms and labels are in sentence case: they start with a capital and are not shouted', () => {
    for (const g of GLOSSARY) expect(g.term).toMatch(/^[A-Z0-9]/);
    for (const s of HELP_STEPS) {
      expect(s.label).toMatch(/^[A-Z]/);
      expect(s.label).not.toMatch(/^[A-Z ]{6,}$/);
    }
  });

  it('numbers are "about" numbers and the old guess that most phones are too slow is gone', () => {
    for (const t of everything()) expect(t).not.toMatch(/most phones|too slow for most/i);
    expect(entry('Map icons').body).toContain(`about ${MIN_HIT_PX} px`);
  });
});

describe('Help and glossary: the 0.3.0 entries say what the screens say', () => {
  it('Night lighting: the three choices of the Layers row, what stays on the clock, and that it never changes the fire', () => {
    const b = entry('Night lighting').body;
    for (const o of NIGHT_LOOK_OPTIONS) expect(b).toContain(o.label);
    // The row's own hint is the source of what follows the clock and what is lit.
    expect(NIGHT_LOOK_HINT).toContain('The sky, stars and the fire’s glow still follow the clock');
    expect(b).toContain('The sky, the stars and the fire’s glow still follow the clock');
    expect(NIGHT_LOOK_HINT).toContain('the ground, trees and roads after dark');
    expect(b).toContain('the ground, trees and roads after dark');
    expect(b).toContain('never the fire');
    expect(b).toContain('“Reset layers”');
    expect(b).toContain('remembered');
    // Realistic is the first choice, which is today's look and the default.
    expect(NIGHT_LOOK_OPTIONS[0]!.label).toBe('Realistic');
    expect(b).toContain('puts it back to Realistic');
    expect(step('Layers')).toContain('Night lighting');
  });

  it('Picture quality: the four choices, who asks for High, the 30 frames a second floor, "next model you build"', () => {
    const b = entry('Picture quality').body;
    for (const w of ['Auto', 'Low', 'Medium', 'High']) expect(b).toContain(w);
    // Auto under the Detail performance setting asks for High; the others leave it to the phone.
    expect(resolveRenderQuality('auto', 'quality')).toBe('high');
    expect(resolveRenderQuality('auto', 'auto')).toBeUndefined();
    expect(b).toContain('picks High when Performance is set to Detail');
    // The Settings hint is the source of the rest.
    expect(PICTURE_QUALITY_HINT).toContain('frame rate stays under 30');
    expect(b).toContain('frame rate stays under 30');
    expect(PICTURE_QUALITY_HINT).toContain('Applies to the next model you build');
    expect(b).toContain('applies to the next model you build');
    expect(PICTURE_QUALITY_HINT).toContain('cores and memory');
    expect(b).toContain('cores and memory');
    expect(b).toContain('may run slowly or close the app');
    expect(step('Settings')).toContain('Picture quality');
  });

  it('Cliffs and rock: what is drawn, that every number uses the data as received, that the detail follows Picture quality (six, four, three), the 60 m limit', () => {
    const b = entry('Cliffs and rock').body;
    expect(b.startsWith('In the 3-D view, cliff faces are drawn steeper than the data and show ledges, joints, stains and scree.')).toBe(true);
    expect(b).toContain('The simulation, the slope overlay and every number use the data as received.');
    // The Data sets Terrain card says the same thing in its own words (plan section 4, rule 10).
    expect(TERRAIN_DRAWING_NOTE).toContain('Cliff faces are drawn steeper than the data');
    expect(TERRAIN_DRAWING_NOTE).toContain('use the data as received');
    // The six effects of the rock detail and how many each Picture quality tier draws.
    for (const w of ['ledges', 'vertical joints', 'bands under overhangs', 'water stains', 'scree', 'bare rock along the top']) expect(b).toContain(w);
    expect([rockDetailCount('high'), rockDetailCount('medium'), rockDetailCount('low')]).toEqual([6, 4, 3]);
    expect(b).toContain('Picture quality: High draws all six kinds, Medium four and Low three');
    // The mesh's resolution limit, that it is always on, and that it never touches the fire.
    expect(b).toContain('A face under about 60 m high still reads as a steep bank');
    expect(b).toContain('always on');
    expect(b).toContain('never the fire');
    expect(entry('Picture quality').body).toContain('rock detail on cliffs');
  });

  it('Simulation debug statistics: the screen title, where it lives, Copy, nothing sent, "Hidden by the WebView"', () => {
    const e = entry(DEBUG_STATS_TITLE);
    expect(e.term).toBe('Simulation debug statistics');
    expect(e.body).toContain('directly under Settings');
    expect(e.body).toContain('“Copy as text”');
    expect(e.body).toContain('Nothing is sent anywhere');
    expect(e.body).toContain('Hidden by the WebView');
    // The words are the screen's: the label of its Copy button and the phrase for a hidden model are in its source.
    const screen = readFileSync(resolve(__dirname, 'screens/debugStats.ts'), 'utf8');
    expect(screen).toContain("label: 'Copy as text'");
    expect(screen).toContain('Nothing is sent anywhere');
    expect(readFileSync(resolve(__dirname, 'debugStats.ts'), 'utf8')).toContain("'Hidden by the WebView'");
    expect(step('Statistics')).toContain(DEBUG_STATS_TITLE);
    expect(step('Statistics')).toContain('Nothing is sent anywhere');
  });

  it('Why is it slow?: the same answers as the sheet (no change to the result, pausing, "All the numbers"), and nothing at Max', () => {
    const sheet = paceSheet({ pace: forcedPace('waiting', 0), engine: { tier: 'standard' }, remainingS: 3600 });
    const b = entry('Why is it slow?').body;
    // The sheet's answer to "Does it change the result?".
    expect(sheet.result.answer).toContain('The same choices give the same fire at any speed');
    expect(b).toContain('the same choices give the same fire at any speed');
    expect(sheet.result.answer.startsWith('No.')).toBe(true);
    expect(b).toContain('It never changes the result');
    // The sheet's advice about pausing, word for word.
    const pausing = sheet.actions?.pausing ?? '';
    expect(pausing).toContain('Pausing stops the simulation too.');
    expect(b).toContain('Pausing stops the simulation too.');
    expect(b).toContain('Playing slower is what helps');
    // The link on the sheet and the action that changes the fire.
    expect(b).toContain(`“${sheet.link}”`);
    // Switching to the fast model restores the latest checkpoint (one per 1800 s of fire) and computes again, so the sheet's note and the
    // glossary both say "from the last checkpoint, up to half an hour of fire ago", not "from this moment".
    expect(sheet.actions?.fast?.note).toBe(FAST_NOTE);
    expect(FAST_NOTE).toContain('from the last checkpoint, up to half an hour of fire ago');
    expect(b).toContain('computed again from the last checkpoint, up to half an hour of fire ago, and comes out a little different');
    expect(b).not.toContain('from that moment');
    expect(b).toContain('There is no button at Max speed');
    expect(b).toContain(DEBUG_STATS_TITLE);
    expect(step('If it runs slowly')).toContain('gauge button');
  });

  it('the 2-D and 3-D entry says how Auto decides, without calling most phones too slow', () => {
    const b = entry('2-D and 3-D').body;
    expect(b).toContain('Auto');
    expect(b).toContain('unless a short timing test when the run starts finds this phone far too slow for it');
    expect(b).not.toMatch(/most phones/i);
  });
});

describe('Help and glossary: the words of the map icons are the words the Why here? row uses', () => {
  const clock = (t: number): string => `${String(14 + Math.floor((5 + t / 60) / 60)).padStart(2, '0')}:${String((5 + Math.round(t / 60)) % 60).padStart(2, '0')}`;
  const ig = (over: Partial<Ignition> = {}): MapMarker => ({ kind: 'ignition', x: 1, y: 2, others: 0, ignition: { id: 'i', kind: 'point', points: [[1, 2]], time: 0, origin: 'observed', ...over } });
  const spot: SpotFire = { id: 1, x: 5, y: 6, time: 1620, distance: 450, travel: 500 };
  const card = (severity: InsightSeverity, kind: InsightKind): MapMarker => ({
    kind: 'insight',
    x: 0,
    y: 0,
    others: 0,
    insight: { id: 'n', kind, severity, time: 0, x: 0, y: 0, title: 'A title', body: '', factors: [] } as Insight,
  });
  const markers: Record<string, MapMarker[]> = {
    'You are here': [{ kind: 'you', x: 0, y: 0, others: 0 }],
    'Ignition point, line or area': [ig(), ig({ kind: 'line', points: [[0, 0], [1, 1]] }), ig({ kind: 'area', points: [[0, 0], [1, 1], [0, 1]] }), ig({ origin: 'backburn' })],
    'Spot fire': [{ kind: 'spot', x: 5, y: 6, others: 0, spot }, ig({ origin: 'spot' })],
    Danger: [card('danger', 'upslope-run')],
    'Watch out': [card('watch', 'mass-spotting')],
    Insight: [card('info', 'ridge-crest')],
    Home: [{ kind: 'home', x: 0, y: 0, others: 0 }],
  };

  it('the entry lists exactly one line for each kind of icon, in the order of the plan, and the row names fit them', () => {
    const items = entry('Map icons').items ?? [];
    expect(items.map((i) => i.name)).toEqual(Object.keys(markers));
    for (const it of items) {
      for (const m of markers[it.name]!) {
        const name = markerRow(m, clock).name;
        // "Ignition point, line or area" stands for three names; the others are the name or its start ("Danger: Uphill run").
        const head = it.name.startsWith('Ignition') ? ['Ignition point', 'Ignition line', 'Ignition area'] : [it.name];
        expect(head.some((h) => name === h || name.startsWith(`${h}:`)), `${name} is under "${it.name}"`).toBe(true);
      }
    }
  });

  it('the pictures described are the ones the atlas draws: blue dot, red pin, orange disc, red octagon, amber triangle, blue circle, a house', () => {
    const t = (n: string): string => entry('Map icons').items!.find((i) => i.name === n)!.text;
    expect(t('You are here')).toMatch(/blue dot with a white ring/);
    expect(t('Ignition point, line or area')).toMatch(/red pin with a flame/);
    expect(t('Spot fire')).toMatch(/orange disc with a flame/);
    expect(t('Danger')).toMatch(/red octagon/);
    expect(t('Watch out')).toMatch(/amber triangle/);
    expect(t('Insight')).toMatch(/blue circle with an i/);
    expect(t('Home')).toMatch(/small house/);
    const atlas = readFileSync(resolve(__dirname, '../render/iconAtlas.ts'), 'utf8');
    for (const s of ["// User: blue dot with white ring", "// Ignition: red map pin with a flame", "// Spot fire: orange disc with white flame", "'circle'", "'triangle'", "'octagon'"]) expect(atlas).toContain(s);
  });

  it('the details the entry promises are the details the row gives: when it was lit, an ember and how far ahead, the first point, the card title, one marker per address', () => {
    const b = (n: string): string => entry('Map icons').items!.find((i) => i.name === n)!.text;
    expect(markerRow(ig(), clock).detail).toMatch(/^Fire you marked, lit at /);
    expect(b('Ignition point, line or area')).toContain('the time it was lit');
    expect(markerRow(ig({ kind: 'line', points: [[0, 0], [1, 1]] }), clock).detail).toContain('The pin is at its first point');
    expect(b('Ignition point, line or area')).toContain('the pin is at its first point');
    expect(markerRow({ kind: 'spot', x: 5, y: 6, others: 0, spot }, clock).detail).toMatch(/^Started by an ember at .*, 450 m ahead of the front$/);
    expect(b('Spot fire')).toContain('how far ahead of the front');
    expect(markerRow(card('danger', 'upslope-run'), clock).detail).toBe('A title');
    expect(b('Danger')).toContain('card’s title');
    expect(markerRow(markers.Home![0]!, clock).detail).toBe('One marker per address');
    expect(b('Home')).toContain('one marker per address');
    expect(stackedLine(2)).toBe('+2 more icons here, zoom in to tell them apart');
    expect(entry('Map icons').body).toContain('zoom in to tell them apart');
  });

  it('the Tools step says to tap an icon to ask about it, and points to the glossary entry', () => {
    const s = squash(step('Tools'));
    expect(s).toContain('Tap an icon to ask about it');
    expect(s).toContain('Map icons');
    expect(s).toContain('Tap the ground beside an icon and there is no icon row');
  });
});
