/**
 * The Help tab's words (content.ts: the how-to list and the glossary), pinned two ways: their shape and voice (plain words, no
 * em dashes, nothing undefined), and, for the 0.3.0, 0.4.0 and 0.4.1 features, that what they say is what the code says (the
 * labels the screens use, the sheet's own sentences, the tap radius, the words of the icons, the footer and the probe
 * sentence of the Air slices panel, the buttons and the status line of its time-lapse recording), so a change to a screen
 * cannot leave a stale sentence in Help.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ATMOS_TIERS } from '../atmosphere/params';
import { AIR_STALE_S } from '../core/airView';
import type { Ignition, Insight, InsightKind, InsightSeverity, SpotFire } from '../core/types';
import { compassWord } from '../explain/text';
import type { MapMarker } from '../render/api';
import { rockDetailCount } from '../render/cliffDrawing';
import { LAYER_CATALOG, type AvailabilityContext } from '../render/layerCatalog';
import { legendFor, sliceLegend } from '../render/legends';
import { MIN_HIT_PX } from '../render/markerPick';
import { sampleRamp, sliceFieldScale } from '../render/palette';
import { probeSentence } from '../render/slice/probe';
import { SLICE_FIELDS, SLICE_KIND_LABEL, SLICE_PRESET_HALF_LENGTH_M, type SliceProbeReading, type SliceRecordingStatus } from '../render/slice/types';
import { USE_3D_LABEL, sliceFieldStatuses } from '../render/sliceFields';
import { TERRAIN_DRAWING_NOTE } from '../scenario/datasetRecords';
import { GLOSSARY, HELP_STEPS, type GlossaryEntry } from './content';
import { TITLE as DEBUG_STATS_TITLE } from './debugStats';
import { formatClock } from './format';
import { forcedPace } from './paceModel';
import { FAST_NOTE, paceSheet } from './paceSheetModel';
import { markerRow, stackedLine } from './screens/sim/markerWords';
import { AIR_SLICE_NOTE, NIGHT_LOOK_HINT, NIGHT_LOOK_OPTIONS } from './screens/sim/layersModel';
import { NOT_RECORDED_WORDS, RECORDING_EARLIER_WORDS, recordingText, spacingWords } from './recordingWords';
import { airFromText, scaleTag, TERRAIN_CAPTION } from './screens/sim/slicePanelModel';
import { AIR_TOOL_LABEL, CLEAR_RECORDING_LABEL, KEEP_LABEL, PLACE_LABEL, PRESET_LABEL, SET_LABEL } from './screens/sim/sliceToolModel';
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

describe('Help and glossary: the 0.4.0 entries say what the Air slices screens say', () => {
  const noAir: AvailabilityContext = { hasFire: true, has3dAtmosphere: false, hasContext: false, hasGrass: false, hasCanopyData: false, hasImagery: false };
  const diagnosedAir = { kind: 'diagnosed' as const, has: { wind: true, theta: false, smoke: false } };

  it('every term the release notes ask for has an entry', () => {
    for (const t of ['Air slices', 'Side view', 'Diagnosed wind', 'Air from', 'Model cells', 'Probe', 'Along and across', 'Wind speed map']) expect(entry(t).body.length, t).toBeGreaterThan(80);
  });

  it('Air slices: the tool, its buttons, its presets and its chips are the words of the screens, and the preset length is the code’s', () => {
    const help = squash(step('Air slices'));
    const b = entry('Air slices').body;
    expect(squash(step('Tools'))).toContain(`What if and ${AIR_TOOL_LABEL}`);
    expect(help).toContain(`open Tools, then ${AIR_TOOL_LABEL}`);
    expect(help).toContain(`“${SET_LABEL.a}”`);
    expect(help).toContain(`“${PLACE_LABEL.a}”`);
    for (const label of Object.values(PRESET_LABEL)) {
      expect(help).toContain(`“${label}”`);
      expect(b).toContain(`“${label}”`);
    }
    // The chips, in the order of the panel.
    const chips = SLICE_FIELDS.map((f) => f.label)
      .join(', ')
      .replace(/, ([^,]+)$/, ' or $1');
    expect(chips).toBe('Speed, Along, Up/down, Across, Temp or Smoke');
    expect(help).toContain(chips);
    expect(b).toContain(chips);
    // The four wind chips work on the fast model's air, Temp and Smoke need the 3-D atmosphere (the scene's own answer).
    const st = sliceFieldStatuses(diagnosedAir);
    for (const id of ['speed', 'along', 'up', 'across'] as const) expect(st[id].ok, id).toBe(true);
    for (const id of ['theta', 'smoke'] as const) expect(st[id], id).toMatchObject({ ok: false, action: 'use-3d' });
    expect(b).toContain('The four wind chips work on every run, and Temp and Smoke need the 3-D atmosphere');
    expect(help).toContain('Temp and Smoke wait for the 3-D atmosphere');
    expect(b).toContain(`about ${SLICE_PRESET_HALF_LENGTH_M / 1000} km each way`);
    expect(b).toContain('never changes the fire');
    expect(help).toContain('never changes the fire');
  });

  it('Side view: A is at the left, the scale tag and the ground captions are the panel’s, and the streaks give way to arrows', () => {
    const b = entry('Side view').body;
    expect(scaleTag(1)).toBe('True scale');
    expect(scaleTag(1.5)).toBe('Height ×1.5');
    expect(b).toContain('“True scale”');
    expect(b).toContain('“Height ×1.5”');
    expect(b).toContain('A is always at the left and B at the right');
    expect(TERRAIN_CAPTION).toContain('Dashed line: the ground as the model sees it');
    expect(TERRAIN_CAPTION).toContain('smooths away show only in the filled ground');
    expect(b).toContain('The dashed line is the ground as the model itself sees it');
    expect(b).toContain('smooths away show only in the filled ground');
    expect(b).toContain('Vertical exaggeration');
    expect(b).toContain('still arrows are drawn instead');
  });

  it('Diagnosed wind: the footer’s own words, the button’s label, and that switching computes again from the last checkpoint', () => {
    const b = entry('Diagnosed wind').body;
    expect(b).toContain(`“${SLICE_KIND_LABEL.diagnosed}”`);
    expect(b).toContain(`“${USE_3D_LABEL}”`);
    expect(b).toContain('computed again from the last checkpoint, up to half an hour of fire ago');
    // No temperature and no smoke: the chips that need them are the ones the scene turns off.
    const st = sliceFieldStatuses(diagnosedAir);
    expect(st.theta.ok || st.smoke.ok).toBe(false);
    expect(b).toContain('no temperature and no smoke');
    // The 2-D and 3-D entry points here (and still says how Auto decides: pinned above).
    expect(entry('2-D and 3-D').body).toContain('diagnosed wind');
  });

  it('Air from: the footer’s sentence, and the 90 seconds after which it says how much older the air is', () => {
    const abs = (t: number): number => Date.UTC(2025, 0, 5, 11, 25) + t * 1000;
    expect(airFromText(0, 30, 'UTC', abs)).toBe('air from 11:25');
    expect(airFromText(0, 240, 'UTC', abs)).toBe('air from 11:25 (4 min before the time shown)');
    const b = entry('Air from').body;
    expect(b).toContain('“air from 11:25”');
    expect(b).toContain('“air from 11:25 (4 min before the time shown)”');
    expect(b).toContain(`Past ${AIR_STALE_S} seconds`);
    expect(b).toContain('about every 5 minutes');
    // Only the newest picture carries air made at its own time (snapshotStore.air.test.ts), so while a run plays the air is typically up to 5 minutes older than the picture: "usually the time you are looking at" was wrong.
    expect(b).toContain('up to about 5 minutes older than the fire you see, while the run plays as well as when you jump back');
    expect(b).not.toContain('usually the time you are looking at');
    // 0.4.1: "only the newest picture has air made at its own time" holds only without a recording of the line.
    expect(b).toContain('Without a recording, only the newest picture of the run has air made at its own time');
    expect(b).not.toMatch(/(^|\. )Only the newest picture of the run has air made at its own time/);
  });

  it('Model cells: the switch is labelled the way Help says', () => {
    expect(readFileSync(resolve(__dirname, 'screens/sim/slicePanel.ts'), 'utf8')).toContain("label: 'Show model cells'");
    expect(entry('Model cells').body).toContain('“Show model cells”');
  });

  it('Probe: the example is the very sentence the code writes, and the keys and the clear button are the panel’s', () => {
    const r: SliceProbeReading = { pos: { s: 0, z: 0 }, x: 0, y: 0, aglM: 60, where: 'air', speed: 32 / 3.6, along: 28 / 3.6, across: 0, up: 1.4, fromDeg: 315, fromWord: compassWord(315), thetaK: 3, smoke: null };
    const sentence = probeSentence(r, { units: 'kmh', kind: 'prognostic' });
    expect(sentence).toBe('Wind about 32 km/h from the north-west, along the line 28 km/h towards B, up 1.4 m/s, 60 m above ground, 3 K warmer than average');
    const b = entry('Probe').body;
    expect(b).toContain(`“${sentence}”`);
    // The fast model's air has no temperature, so its sentence has no temperature part.
    expect(probeSentence(r, { units: 'kmh', kind: 'diagnosed' })).not.toMatch(/warmer|cooler/);
    expect(b).toContain('The temperature part is only there on the 3-D atmosphere');
    const panel = readFileSync(resolve(__dirname, 'screens/sim/slicePanel.ts'), 'utf8');
    expect(panel).toContain("label: 'Clear the probe'");
    expect(panel).toContain("ArrowLeft: 'left'");
    expect(b).toContain('arrow keys move the probe and Escape clears it');
  });

  it('Along and across: the signs and the two colours are the legend’s and the palette’s', () => {
    const b = entry('Along and across').body;
    expect(sliceLegend('along', 'prognostic').note).toContain('green blows towards B, purple towards A');
    expect(sliceLegend('across', 'prognostic').note).toContain('green blows towards the right of someone walking from A to B, purple towards the left');
    expect(b).toContain('Along is positive towards B and negative towards A');
    expect(b).toContain('Across is positive towards the right of someone walking from A to B and negative towards the left');
    expect(b).toContain('purple towards A or the left and green towards B or the right');
    const { ramp, lo, hi } = sliceFieldScale('along');
    const neg = sampleRamp(ramp, lo);
    const pos = sampleRamp(ramp, hi);
    expect(neg[0]).toBeGreaterThan(neg[1]); // purple: red and blue above green
    expect(neg[2]).toBeGreaterThan(neg[1]);
    expect(pos[1]).toBeGreaterThan(pos[0]); // green
    expect(pos[1]).toBeGreaterThan(pos[2]);
    expect(sliceLegend('up', 'prognostic').note).toContain('Air rising (red) or sinking (blue)');
    expect(b).toContain('rising (warm colours) or sinking (cool colours)');
  });

  it('Wind speed map: on the fast model’s air it can be shown (once there is a fire), and Help says both', () => {
    const windSpeed = LAYER_CATALOG.find((l) => l.id === 'windSpeed')!;
    expect(windSpeed.available({ ...noAir, hasAirWind: true }).ok).toBe(true);
    expect(windSpeed.available({ ...noAir, hasAirWind: true, hasFire: false })).toEqual({ ok: false, reason: 'Needs a fire: mark one first' });
    expect(windSpeed.available({ ...noAir, hasAirWind: false }).ok).toBe(false);
    const b = entry('Wind speed map').body;
    expect(b).toContain('on the fast model too');
    expect(b).toContain('needs a fire marked first');
    // The limitation measured in 0.4.0 (plan 18.4): the map is the air model's 10 m wind, which on a calm night is not the wind the fire feels, on either tier. The map's own words say it too.
    expect(b).toContain('It is not always the wind the fire feels');
    expect(b).toContain('on a calm night they can differ a lot, on both the fast model and the 3-D atmosphere');
    const why = LAYER_CATALOG.find((l) => l.id === 'windSpeed')!.why;
    expect(why).toContain('on a calm night the wind the fire feels can differ a lot from this map');
    expect(legendFor('windSpeed')!.note).toContain('on a calm night can differ a lot from the wind the fire feels');
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

describe('Help and glossary: the 0.4.1 entries say what the recording of a line says', () => {
  const abs = (t: number): number => Date.UTC(2025, 0, 5, 11, 25) + t * 1000;
  const clock = (t: number): string => formatClock(Date.UTC(2025, 0, 5, 11, 30) + t * 1000, 'UTC');
  const recording = (o: Partial<SliceRecordingStatus> = {}): SliceRecordingStatus => ({ state: 'recording', offFor: null, count: 40, from: 0, to: 4200, spacingS: 0, bytes: 1e6, budgetBytes: 6e6, dropped: null, ...o });
  const layersPanel = (): string => readFileSync(resolve(__dirname, 'screens/sim/layersPanel.ts'), 'utf8');

  it('Record a line: the labels of the tool, the status line’s own example, and what drops a recording', () => {
    const help = squash(step('Record a line'));
    expect([KEEP_LABEL, CLEAR_RECORDING_LABEL]).toEqual(['Keep this line', 'Clear recording']);
    for (const label of [SET_LABEL.a, SET_LABEL.b, KEEP_LABEL, CLEAR_RECORDING_LABEL]) expect(help).toContain(`“${label}”`);
    // The example is the very sentence the status line writes for that recording, and the thinned one is the panel's own word.
    const example = recordingText(recording(), 3000, clock);
    expect(example).toBe('Recorded from 11:30 to 12:40 (every picture kept).');
    expect(help).toContain(`“${example}”`);
    expect(spacingWords(120)).toBe('about every 2 min');
    expect(recordingText(recording({ spacingS: 120 }), 3000, clock)).toBe('Recorded from 11:30 to 12:40 (about every 2 min).');
    expect(help).toContain('“about every 2 min”');
    // A time earlier than the first picture uses the history's saved air, as 0.4.0 did, and the status line says so.
    expect(RECORDING_EARLIER_WORDS).toContain("uses the history's saved air");
    expect(help).toContain('uses the history’s saved air as before');
    // A preset is not recorded, in the words the status line uses.
    expect(NOT_RECORDED_WORDS.preset).toContain('follows the wind and the fire, so it is not recorded');
    expect(help).toContain('a preset follows the wind and the fire and so is not recorded');
    expect(squash(step('Air slices'))).toContain('A line you place is recorded as the run plays, and a preset is not (see Record a line)');
    // Layers' own sentence about the slice switch is what Help repeats.
    expect(AIR_SLICE_NOTE).toContain('Switching the slice off clears its recording.');
    expect(layersPanel()).toContain('description: AIR_SLICE_NOTE');
    expect(help).toContain('switching the slice off in Layers');
    expect(help).toContain('never changes the fire');
  });

  it('Air slices: a line is recorded, a preset is not unless it is kept, and what clears the recording', () => {
    const b = entry('Air slices').body;
    expect(b).toContain('A line you place with A and B is recorded as the run plays');
    expect(b).toContain(`A preset follows the wind and the fire, so it is not recorded unless you press “${KEEP_LABEL}”, which fixes it where it is now`);
    expect(b).toContain(`“${CLEAR_RECORDING_LABEL}” empties the recording`);
    expect(b).toContain('moving the line, switching the slice off in Layers or starting a new scenario clears it too');
    expect(b).toContain('never changes the fire');
  });

  it('Side view and Air from: a recorded picture says "recorded air from", with its age counted from the recorded picture', () => {
    expect(airFromText(0, 30, 'UTC', abs, 0)).toBe('recorded air from 11:25');
    expect(airFromText(0, 240, 'UTC', abs, 0)).toBe('recorded air from 11:25 (4 min before the time shown)');
    expect(airFromText(0, 240, 'UTC', abs, 200)).toBe('recorded air from 11:28');
    expect(entry('Side view').body).toContain('“recorded air from” when the air comes from a recording of the line');
    const b = entry('Air from').body;
    expect(b).toContain('“recorded air from 11:25”');
    expect(b).toContain('about the spacing the status line gives');
    expect(b).toContain('which can be ahead of the time shown');
    expect(b).toContain('“about every 2 min”');
  });

  it('Diagnosed wind: the recording carries on when the run is switched to the 3-D atmosphere, which is the standard tier on the fast tier’s air grid', () => {
    expect(entry('Diagnosed wind').body).toContain('A recording of a line carries on across the switch');
    // "Use the 3-D atmosphere" asks for the standard tier, and the fast and the standard tier are built on one air grid (sliceTimeLapse.test.ts keeps the recording across it); the high tier's is finer.
    expect(layersPanel()).toContain("setQuality('standard')");
    expect(ATMOS_TIERS.fast).toEqual(ATMOS_TIERS.standard);
    expect(ATMOS_TIERS.high).not.toEqual(ATMOS_TIERS.standard);
  });
});
