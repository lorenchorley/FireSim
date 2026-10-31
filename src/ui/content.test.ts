/**
 * The Help tab's words (content.ts: the how-to list and the glossary), pinned two ways: their shape and voice (plain words, no
 * em dashes, nothing undefined), and, for the 0.3.0, 0.4.0, 0.4.1, 0.5.0, 0.6.0 and 0.7.0 features, that what they say is what the code says (the
 * labels the screens use, the sheet's own sentences, the tap radius, the words of the icons, the footer and the probe
 * sentence of the Air slices panel, the buttons and the status line of its time-lapse recording, the zoom levels, the Wind height
 * chips, the caption and the tab and button words of the wind arrows and flow lines, and in 0.6.0 the Wind detail chip and its sheet, the
 * detailed streaks of the closest zoom, the Wind direction tool and the two-finger turn, and in 0.7.0 What the fire feels, Colour the map by speed, the speed
 * test, the idle stop, reduced motion, the cards of a change of your own and Back to the forecast, and the one-finger pan), so a change to a screen cannot leave a
 * stale sentence in Help.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ATMOS_TIERS } from '../atmosphere/params';
import { AIR_STALE_S } from '../core/airView';
import { FIRE_WIND_TARGET_CELL_M, fireWindBlock } from '../core/fireWind';
import type { GridSpec } from '../core/grid';
import type { Ignition, Insight, InsightKind, InsightSeverity, SpotFire } from '../core/types';
import { EXPLAIN_PARAMS } from '../explain/params';
import { compassWord } from '../explain/text';
import type { MapMarker, WindGlyphStats } from '../render/api';
import { rockDetailCount } from '../render/cliffDrawing';
import { GESTURE } from '../render/cameraRig';
import { PAN } from '../render/groundPan';
import { IDLE_STOP_MS } from '../render/idleStop';
import { LAYER_CATALOG, type AvailabilityContext } from '../render/layerCatalog';
import { DEFAULT_LAYERS, windMapHeight, type LayerState } from '../render/layers';
import { legendFor, sliceLegend, windGlyphLegend, windLegend, windSpeedRangeKmh } from '../render/legends';
import { MIN_HIT_PX } from '../render/markerPick';
import { sampleRamp, sliceFieldScale } from '../render/palette';
import { probeSentence } from '../render/slice/probe';
import { SLICE_FIELDS, SLICE_KIND_LABEL, SLICE_PRESET_HALF_LENGTH_M, type SliceProbeReading, type SliceRecordingStatus } from '../render/slice/types';
import { USE_3D_LABEL, sliceFieldStatuses } from '../render/sliceFields';
import { GLYPH_CALM_MS } from '../render/wind/flowGlyphs';
import { LEVEL_EDGES, LOD_HYSTERESIS, planLod } from '../render/wind/glyphLod';
import { detailGroundFactor, RELIEF_TREE_MAX_M } from '../render/wind/detailStreaks';
import { DETAIL_GEOMETRY, DETAIL_RELIEF, WIND_HEIGHTS, type WindHeight } from '../render/wind/glyphTypes';
import { TERRAIN_DRAWING_NOTE } from '../scenario/datasetRecords';
import { SIM_PARAMS } from '../sim/params';
import { GLOSSARY, HELP_STEPS, type GlossaryEntry } from './content';
import { TITLE as DEBUG_STATS_TITLE } from './debugStats';
import { formatClock } from './format';
import { forcedPace } from './paceModel';
import { FAST_NOTE, paceSheet } from './paceSheetModel';
import { markerRow, stackedLine } from './screens/sim/markerWords';
import { BUDGET_LINE, DIAGNOSED_LINE, EYE_LEVEL_LINE, FELT_FAST_LINE, FELT_NIGHT_LINE, GLYPH_INTRO, GLYPH_SMOOTH_FIT_PX, GLYPH_SWITCH_LABEL, GROUND_LINE, GROUND_LINE_CHOOSE, LEVEL_LINE, NEEDS_3D, PAUSED_STREAKS_LINE, SMOOTH_FIT_LINE, WIND_HEIGHT_CHIPS, WIND_HEIGHT_LABEL, captionHeadline, feltLine, heightLabel, windFromText } from './screens/sim/glyphWords';
import { AIR_SLICE_NOTE, NIGHT_LOOK_HINT, NIGHT_LOOK_OPTIONS } from './screens/sim/layersModel';
import { PERSISTED_LAYER_KEYS } from './screens/sim/layersPrefs';
import { NOT_RECORDED_WORDS, RECORDING_EARLIER_WORDS, recordingText, spacingWords } from './recordingWords';
import { airFromText, scaleTag, TERRAIN_CAPTION } from './screens/sim/slicePanelModel';
import { DEFAULT_UI, type UiState } from './screens/sim/context';
import { createSliceToolActions, type SliceToolHost } from './screens/sim/sliceToolActions';
import {
  AIR_TOOL_LABEL,
  CLEAR_RECORDING_LABEL,
  KEEP_LABEL,
  NEEDS_3D_VIEW,
  OFF_CLEARED_SAY,
  OFF_LABEL,
  OFF_NOTE,
  OFF_SAY,
  PLACE_LABEL,
  PRESET_LABEL,
  SET_LABEL,
  TAB_LABEL,
  controlsView,
  hasStoredLine,
  initialSliceToolState,
  reopened,
  turnOffSlice,
  withTab,
  type CrossSection,
} from './screens/sim/sliceToolModel';
import { WIND_TURN_S, windDirectionTime } from '../scenario/windDirection';
import { EDDIES_LINE, ESTIMATED_LINE, MOST_DETAILED_LINE, PAUSED_LINE, SHEET_TITLE, STILL_LINE, levelLine, windDetailWords } from './screens/sim/windDetailWords';
import { chipLabel, windDetailState, type WindDetailInput } from './screens/sim/windDetailState';
import { BACK_TO_FORECAST_HINT, BACK_TO_FORECAST_LABEL, LIST_TITLE, READINGS_NOTE, READINGS_TITLE, WHEN_OPTIONS, WIND_HINT, applyLabel, dialStart, holdsDirection, problemText, reviewingText } from './screens/sim/windPanelModel';
import { MAP_CHIP_LABEL, windMapPatch, windMapReasonLine, windSpeedSubline } from './screens/sim/windMapWords';
import { SPEED_TEST_BUDGET_MS, SPEED_TEST_REFERENCE, SPEED_TEST_VERSION } from './speedTest';
import { COPY_FLOATS, STENCIL_NX, STENCIL_NY, STENCIL_NZ } from './speedTestKernels';
import { SPEED_TEST_BLOCKED, SPEED_TEST_IDLE, SPEED_TEST_LABEL } from './speedTestModel';
import { PICTURE_QUALITY_HINT } from './screens/settings';
import { resolveRenderQuality } from './settings';
import { Store } from './store';

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

describe('Help and glossary: the 0.5.0 entries say what the wind arrows, the Map view tab and Turn off the slice say', () => {
  const noAir: AvailabilityContext = { hasFire: true, has3dAtmosphere: false, hasContext: false, hasGrass: false, hasCanopyData: false, hasImagery: false };
  const abs = (t: number): number => Date.UTC(2025, 0, 5, 14, 5) + t * 1000;
  const glyphInfo = LAYER_CATALOG.find((l) => l.id === 'windGlyphs')!;
  const squashed = (term: string): string => squash(entry(term).body);
  const read = (file: string): string => readFileSync(resolve(__dirname, file), 'utf8');

  it('every term the release notes ask for has an entry', () => {
    for (const t of ['Arrows and flow lines', 'Wind height', 'Map view', 'Turn off the slice']) expect(entry(t).body.length, t).toBeGreaterThan(200);
  });

  it('Layers: the Help step names the switch and its heading as the panel does, the range of the chips, and says it is off at first and separate from the Wind streaks', () => {
    const layers = squash(step('Layers'));
    expect(glyphInfo.title).toBe('Arrows and flow lines');
    expect(layers).toContain(`“${glyphInfo.title}”`);
    expect(read('screens/sim/layersPanel.ts')).toContain("sectionHeader('Wind and air')");
    expect(layers).toContain('Under Wind and air');
    expect(read('screens/sim/layersPanel.ts')).toContain("label: 'Wind streaks'");
    expect(layers).toContain('moving Wind streaks');
    // (0.7.0: What the fire feels is the first of the seven heights and the one the app starts with; the numbered ones run from 10 m to 2 km.)
    expect(layers).toContain(`a ${WIND_HEIGHT_LABEL} you choose: ${heightLabel(WIND_HEIGHTS[0]!)}, or from ${heightLabel(WIND_HEIGHTS[1]!)} to ${heightLabel(WIND_HEIGHTS[WIND_HEIGHTS.length - 1]!)} above the ground`);
    expect(layers).toContain('it is the first choice at the start');
    expect(layers).toContain('It is off until you switch it on');
    // Off at first (the opt-in of plan decision D9), while the streaks stay on as they were.
    expect(DEFAULT_LAYERS.windGlyphs).toBe(false);
    expect(DEFAULT_LAYERS.wind).toBe('surface');
    expect(layers).toContain('Your choices are remembered');
    expect(squashed('Layer')).toContain('wind arrows and flow lines');
  });

  it('Arrows and flow lines: the zoom ladder is the planner’s (4, 12, 32 and 90 px, 15 % of give at an edge), a calm dot is under the engine’s 0.3 m/s, and the 60 px sentence is the caption’s', () => {
    const b = squashed('Arrows and flow lines');
    expect([...LEVEL_EDGES]).toEqual([4, 12, 32, 90]);
    expect(b).toContain('under about 4 px, nothing is drawn');
    expect(b).toContain('From about 4 px a cell you get straight arrows, from about 12 px the arrows are closer together, from about 32 px they become curved flow lines with arrowheads, and from about 90 px the picture changes to detailed streaks (see Detailed streaks)');
    // The levels are what each step of the ladder draws, in the words of the zoom line under the chips.
    expect(LEVEL_LINE[0]).toBe('Zoom in to see the wind arrows.');
    expect(LEVEL_LINE[1]).toContain('straight arrows');
    expect(LEVEL_LINE[2]).toContain('closer together');
    expect(LEVEL_LINE[3]).toContain('curved flow lines');
    expect(LEVEL_LINE[4]).toContain('moving streaks with small eddies');
    // Each edge is held 15 % past before the level changes, both ways.
    expect(LOD_HYSTERESIS).toBe(1.15);
    const at = (cellPx: number, level: 0 | 1 | 2 | 3 | 4) => planLod(cellPx, 10, { level, spacingExp: 6 }).level;
    expect(at(4 * LOD_HYSTERESIS - 0.01, 0)).toBe(0);
    expect(at(4 * LOD_HYSTERESIS + 0.01, 0)).toBe(1);
    expect(at(4 / LOD_HYSTERESIS + 0.01, 1)).toBe(1);
    expect(at(4 / LOD_HYSTERESIS - 0.01, 1)).toBe(0);
    expect(b).toContain('holds a little past each edge, so it does not flicker while you pinch');
    // Straight arrows up to the second level, curved flow lines from the third; a longer mark is a stronger wind, up to a limit.
    expect([1, 2, 3, 4].map((l) => planLod(LEVEL_EDGES[l - 1]! * 1.2, 10, null).curved)).toEqual([false, false, true, true]);
    const plan = planLod(50, 10, null);
    expect(plan.lengthPx.pxPerMs).toBeGreaterThan(0);
    expect(plan.lengthPx.max).toBeGreaterThan(plan.lengthPx.min);
    expect(b).toContain('A longer mark means a stronger wind, up to a limit');
    expect(GLYPH_CALM_MS).toBe(0.3);
    expect(b).toContain('under about 0.3 m/s) gets a small dot');
    // The smooth-fit sentence: the caption says it from 60 px a cell, in these words.
    expect(GLYPH_SMOOTH_FIT_PX).toBe(60);
    expect(SMOOTH_FIT_LINE).toContain('smooth fit through the model, not new detail');
    expect(b).toContain('more than about 60 px, the curves are a smooth fit through the model, not new detail');
    expect(b).toContain('stay the same size on the screen whatever the zoom');
  });

  it('Arrows and flow lines: the colours are the Wind streaks’ ramp in km/h, it needs the 3-D view and the air picture but no fire, and nothing is drawn at eye level or when the view is full', () => {
    const b = squashed('Arrows and flow lines');
    const legend = windGlyphLegend('near the ground');
    expect(legend.units).toBe('km/h');
    expect(legend.entries).toEqual(windLegend('surface').entries); // the streaks' ramp, not the Wind speed map's
    expect(legend.title).toBe('Wind near the ground');
    expect(b).toContain('the colours of the Wind streaks near the ground');
    expect(b).toContain('speeds in km/h on the legend card');
    expect(NEEDS_3D).toBe('Needs the 3-D view');
    expect(b).toContain('needs the 3-D view and the air picture, which the simulation makes once it has started');
    expect(glyphInfo.available({ ...noAir, hasAirWind: false })).toEqual({ ok: false, reason: 'Needs the air picture, which the simulation makes once it has started' });
    expect(glyphInfo.available({ ...noAir, hasAirWind: true, hasFire: false }).ok).toBe(true); // the diagnosed wind of the fast tier counts, and no fire is needed
    expect(EYE_LEVEL_LINE).toContain('Not drawn at eye level');
    expect(b).toContain('Nothing is drawn at eye level');
    expect(BUDGET_LINE).toContain('already uses all the phone can draw');
    expect(b).toContain('if the picture already uses all the phone can draw, nothing is drawn and the line under the chips says why');
    expect(b).toContain('never changes the fire');
  });

  it('Wind height: the seven chips, 10 m is the model’s open-ground wind and not what the fire feels, and the caption is the very sentence the code writes', () => {
    const b = squashed('Wind height');
    const labels = WIND_HEIGHT_CHIPS.map((c) => c.label);
    // (0.7.0: What the fire feels is the first of seven chips and the one the app starts with.)
    expect(labels).toEqual(['What the fire feels', '10 m', '50 m', '100 m', '300 m', '1 km', '2 km']);
    expect(WIND_HEIGHTS).toEqual<WindHeight[]>(['felt', 'fire', 50, 100, 300, 1000, 2000]);
    expect(b).toContain('The seven chips under');
    expect(b).toContain('What the fire feels, 10 m, 50 m, 100 m, 300 m, 1 km and 2 km');
    expect(b).toContain('What the fire feels is the first, and the one the app starts with');
    expect(DEFAULT_LAYERS.windHeight).toBe('felt');
    expect(b).toContain('From 50 m up, the number is metres above the ground');
    // 10 m is the same field as the Wind speed map's (the model's 10 m wind), and the chip says what the caption says.
    expect(b).toContain('the model’s own wind about 10 m above open ground, the same wind as the Wind speed map');
    expect(captionHeadline('fire', { cellM: 133.3, airTime: 0, shownTime: 0, diagnosed: false }, 'UTC', abs)).toBe('Wind about 10 m above open ground · model grid 133 m · air from 14:05.');
    // The calm-night sentence is the caption's (and the Wind speed map's limit, in the same words as its own Help).
    expect(GROUND_LINE).toBe('On a calm night the fire can feel much less wind than this in places, and much more in others.');
    expect(b).toContain('on a calm night the fire can feel much less wind than this in places, and much more in others');
    expect(b).toContain('It is not the wind the fire feels');
    // The 10 m caption says where to see the difference once the picture has the fire's own wind, in the glossary's words.
    expect(GROUND_LINE_CHOOSE).toBe(`${GROUND_LINE} Choose What the fire feels to see it.`);
    expect(b).toContain('the caption says to choose What the fire feels to see it');
    // No chip between 10 m and 50 m: the model's lowest level is its first level's middle, 15 m above the ground (12.5 m on the High tier).
    expect(ATMOS_TIERS.standard.dz1 / 2).toBe(15);
    expect(ATMOS_TIERS.fast.dz1 / 2).toBe(15);
    expect(b).toContain('the model’s lowest level is about 15 m above the ground');
    // The headline: the height, the model grid and when the air is from, ending in a full stop; older air says how much older, past the same 90 seconds as the footer.
    const example = captionHeadline(100, { cellM: 133.3, airTime: 0, shownTime: 0, diagnosed: false }, 'UTC', abs);
    expect(example).toBe('Wind at 100 m above the ground · model grid 133 m · air from 14:05.');
    expect(b).toContain(`“${example}”`);
    expect(windFromText(0, 240, 'UTC', abs)).toBe(airFromText(0, 240, 'UTC', abs));
    expect(windFromText(0, 240, 'UTC', abs)).toBe('air from 14:05 (4 min before the time shown)');
    expect(b).toContain(`more than ${AIR_STALE_S} seconds older than the picture`);
    // The fast tier adds the diagnosed-wind line, which starts with the footer's own words.
    expect(DIAGNOSED_LINE.startsWith(SLICE_KIND_LABEL.diagnosed)).toBe(true);
    expect(b).toContain('on the fast model it adds that this is the diagnosed wind');
    expect(entry('Diagnosed wind').body).toContain(`“${DIAGNOSED_LINE}”`);
    // The choice is one of the remembered layer choices.
    expect(PERSISTED_LAYER_KEYS).toContain('windHeight');
    expect(PERSISTED_LAYER_KEYS).toContain('windGlyphs');
    expect(b).toContain('remembered for the next run');
    expect(entry('Wind speed map').body).toContain('the 10 m Wind height');
  });

  it('Map view: the tab labels, the switch’s name and its one line are the tool’s, and it is one setting with Layers', () => {
    expect(TAB_LABEL).toEqual({ side: 'Side view', map: 'Map view' });
    const b = squashed('Map view');
    expect(b).toContain('two tabs in its header, Side view and Map view');
    expect(GLYPH_SWITCH_LABEL).toBe('Wind arrows and flow lines');
    expect(b).toContain(`“${GLYPH_SWITCH_LABEL}”`);
    expect(GLYPH_INTRO).toBe('Draws the wind on the map: arrows from far away, flow lines when you zoom in.');
    expect(b).toContain(`“${GLYPH_INTRO}”`);
    // One builder serves the Layers row and the Map view, so a change in one is the other's.
    for (const f of ['screens/sim/layersPanel.ts', 'screens/sim/sliceTool.ts']) expect(read(f), f).toContain('createWindGlyphControls(ctx');
    expect(b).toContain('they are one setting, so a change made in either is there in the other');
    // A tab press drops a placement under way (no crosshair left on the map); the tab is kept when the tool is closed and opened again.
    const placing = { ...initialSliceToolState(), placing: 'a' as const, candidate: [1, 2] as [number, number] };
    expect(withTab(placing, 'map')).toMatchObject({ tab: 'map', placing: null, candidate: null });
    expect(reopened({ ...initialSliceToolState(), tab: 'map' }).tab).toBe('map');
    expect(b).toContain('Pressing a tab drops a line you are placing, so no cross is left on the map, and the tab you chose is kept when you close and reopen the tool');
    // The 2-D map has no tabs: the tool is one line.
    expect(NEEDS_3D_VIEW).toBe('The side view needs the 3-D view.');
    expect(b).toContain('on the 2-D map it says so and has no tabs');
    expect(squash(step('Air slices'))).toContain(`The tool has a second tab, ${TAB_LABEL.map}, for the wind arrows and flow lines`);
    expect(squashed('Air slices')).toContain('The tool has a second tab for the wind arrows and flow lines (see Map view)');
    expect(entry('Side view').body.startsWith('The picture in the Side view tab of the Air slices tool.')).toBe(true);
  });

  describe('Turn off the slice', () => {
    const GRID: GridSpec = { nx: 61, ny: 61, cellSize: 100, x0: -3000, y0: -3000, origin: { lat: -33.7, lon: 150.3 } };
    const hand: CrossSection = { ...DEFAULT_LAYERS.crossSection, enabled: true, a: [0, 0], b: [0, 1000], preset: null, field: 'along', azimuth: 40 };
    /** The real actions on the real stores with a fake scene that only counts what it is told. */
    const rig = (): { tool: ReturnType<typeof createSliceToolActions>; layers: Store<LayerState>; writes: unknown[]; said: string[] } => {
      const ui = new Store<UiState>({ ...DEFAULT_UI, wind: { ...DEFAULT_UI.wind }, tool: 'air', panelOpen: true });
      const layers = new Store<LayerState>({ ...DEFAULT_LAYERS, crossSection: { ...hand } });
      const writes: unknown[] = [];
      const said: string[] = [];
      const host: SliceToolHost = { ui, layers, view: { setLayers: (p) => writes.push(p), slice: () => null }, grid: () => GRID, crosshair: () => null, user: null, hasFire: () => false, announce: (m) => said.push(m) };
      return { tool: createSliceToolActions(host), layers, writes, said };
    };

    it('the words: the button, the warning under it and the two announcements', () => {
      const b = squashed('Turn off the slice');
      expect(OFF_LABEL).toBe('Turn off the slice');
      expect(entry('Turn off the slice').term).toBe(OFF_LABEL);
      expect(OFF_NOTE).toBe('This also clears the recording.');
      expect(b).toContain(`“${OFF_NOTE}”`);
      expect(OFF_SAY).toBe('Slice turned off.');
      expect(OFF_CLEARED_SAY).toBe('Slice turned off. The recording was cleared.');
      expect(b).toContain(`“${OFF_SAY}” or, when there was a recording, “${OFF_CLEARED_SAY}”`);
      expect(b).toContain('There is no confirmation and no undo');
      expect(squash(step('Air slices'))).toContain(`“${OFF_LABEL}”, the last button on either tab`);
      expect(squash(step('Record a line'))).toContain(`switching the slice off in Layers or with “${OFF_LABEL}”`);
    });

    it('one press writes the line away and keeps the chip and the compass; the probe and a placement go too', () => {
      const s = { ...initialSliceToolState(), placing: 'b' as const, candidate: [5, 5] as [number, number], draft: { a: [1, 1] as [number, number], b: null }, probe: { s: 3, z: 4 } };
      const step = turnOffSlice(s, hand, false);
      expect(step.crossSection).toMatchObject({ enabled: false, a: undefined, b: undefined, preset: null, field: 'along', azimuth: 40 });
      expect(step.state).toMatchObject({ placing: null, candidate: null, draft: { a: null, b: null }, probe: null });
      const b = squashed('Turn off the slice');
      expect(b).toContain('the probe and its pin on the map');
      expect(b).toContain('It keeps the colour chip you chose and the Layers compass setting');
      expect(b).toContain('nothing placed, ready for a new line');
    });

    it('the tool stays open and the slice does not come back on opening it; Layers switching it off keeps the line, and opening the tool brings it back; closing the tool leaves it on', () => {
      const r = rig();
      r.tool.open();
      r.tool.close();
      expect(r.layers.get().crossSection.enabled, 'closing the tool leaves the slice on').toBe(true);
      expect(r.writes).toEqual([]);
      // The Layers panel's own off keeps the line, and the tool's next opening shows it again.
      r.layers.set({ crossSection: { ...r.layers.get().crossSection, enabled: false } });
      expect(hasStoredLine(r.layers.get().crossSection)).toBe(true);
      r.tool.open();
      expect(r.layers.get().crossSection.enabled).toBe(true);
      // The tool's own off clears the line, so opening it again does not.
      r.tool.turnOff();
      expect(r.layers.get().crossSection).toMatchObject({ enabled: false, a: undefined, b: undefined, preset: null });
      expect(hasStoredLine(r.layers.get().crossSection)).toBe(false);
      r.tool.open();
      expect(r.layers.get().crossSection.enabled).toBe(false);
      expect(r.said).toEqual([OFF_SAY]);
      const b = squashed('Turn off the slice');
      expect(b).toContain('switching the slice off in Layers, which keeps the line so that opening the tool brings it back, or as closing the tool, which leaves the slice as it is');
      expect(squashed('Air slices')).toContain('switching the slice off in Layers instead keeps the line, and opening the tool brings it back. Closing the tool leaves the slice as it is');
      expect(squash(step('Air slices'))).toContain('closing the tool leaves the slice as it is');
    });

    it('the button is there only while there is a slice or a stored line to turn off, and not while placing', () => {
      const view = (section: CrossSection, over: Partial<Parameters<typeof controlsView>[0]> = {}) =>
        controlsView({ state: initialSliceToolState(), facts: { line: null, source: null, preset: null, issue: null, notes: [], minLengthM: 300 }, presets: { along: { ok: true }, across: { ok: true }, slope: { ok: true }, me: { ok: true } }, fix: 'ok', verdict: null, section, ...over }).off;
      expect(view(hand)).toBe(true);
      expect(view({ ...hand, enabled: false })).toBe(true); // switched off in Layers, line stored
      expect(view({ ...DEFAULT_LAYERS.crossSection })).toBe(false);
      expect(view({ ...DEFAULT_LAYERS.crossSection }, { state: { ...initialSliceToolState(), draft: { a: [0, 0], b: null } } })).toBe(false); // one end only
      expect(view(hand, { state: { ...initialSliceToolState(), placing: 'a' }, verdict: { ok: true } })).toBe(false);
      const b = squashed('Turn off the slice');
      expect(b).toContain('only while there is a slice to turn off, or a line that Layers switched off, and not while you are placing a line or when only one end is set');
      expect(b).toContain('a line under the button says “This also clears the recording.”');
    });
  });
});

describe('Help and glossary: the 0.6.0 entries say what the Wind detail chip, the detailed streaks, the Wind direction tool and the two-finger turn say', () => {
  const squashed = (term: string): string => squash(entry(term).body);
  const read = (file: string): string => readFileSync(resolve(__dirname, file), 'utf8');
  /** Help and the screens may spell an apostrophe either way (Help uses the curly one). */
  const straight = (s: string): string => s.replace(/’/g, "'");
  const stats = (over: Partial<WindGlyphStats> = {}): WindGlyphStats => ({
    active: true, idle: null, level: 4, count: 600, segments: 6000, cellPx: 120, cellM: 133, rebuilds: 3, lastMs: 2, sliceP95Ms: 3, sliceMaxMs: 5, slicesLast: 1, detail: 'moving', detailSegments: 6000, glyphs: true, streaks: false, reduced: false, tickMaxMs: 0, ...over,
  });
  const wind = (over: Partial<WindDetailInput> = {}): WindDetailInput => ({ glyphsOn: true, streaks: 'off', viewMode: 'orbit', stats: stats(), air: 'prognostic', height: 'fire', ...over });
  const env = { startMs: Date.UTC(2025, 0, 5, 14, 0), tz: 'UTC', durationS: 4 * 3600 };

  it('every term and step the release notes ask for is there, the old Local wind name is gone, and the Tools list names the tool as the Tools menu does', () => {
    for (const t of ['Wind direction (tool)', 'Wind detail', 'Detailed streaks']) expect(entry(t).body.length, t).toBeGreaterThan(300);
    for (const l of ['Wind direction', 'Fuel']) expect(step(l).length, l).toBeGreaterThan(30);
    expect(HELP_STEPS.map((x) => x.label)).not.toContain('Fuel / Wind');
    for (const t of everything()) expect(t).not.toContain('Local wind');
    expect(read('screens/sim/simScreen.ts')).toContain("{ id: 'wind', label: 'Wind direction', icon: 'wind' }");
    expect(read('screens/sim/windPanel.ts')).toContain("panelShell('Wind direction'");
    expect(squash(step('Tools'))).toContain('opens Why here?, Fire, Fuel, Wind direction, Layers, What if and Air slices');
  });

  it('Wind direction: the turn takes 15 minutes, the choices of When, the button words, and the dial opening on the wind are the panel’s', () => {
    expect(WIND_TURN_S).toBe(900);
    expect(WIND_HINT).toContain(`It turns over ${WIND_TURN_S / 60} minutes and then holds that direction`);
    const b = squashed('Wind direction (tool)');
    const h = squash(step('Wind direction'));
    expect(b).toContain('takes 15 minutes to reach the new direction, the short way round');
    expect(h).toContain('takes 15 minutes to reach the new direction, the short way round');
    expect(WHEN_OPTIONS.map((o) => o.label)).toEqual(['Now', 'In 10 min', 'In 30 min', 'In 1 h', 'At a time']);
    expect(b).toContain('Now, In 10 min, In 30 min, In 1 h or At a time');
    expect(h).toContain('Now, In 10 min, In 30 min, In 1 h or At a time');
    expect(applyLabel(225)).toBe('Turn wind to SW');
    expect(applyLabel(315, true)).toBe('Hold wind from NW');
    expect(holdsDirection(315, 315)).toBe(true);
    expect(holdsDirection(225, 315)).toBe(false);
    for (const t of [b, h]) {
      expect(t).toContain(`“${applyLabel(225)}”`);
      expect(t).toContain(`“${applyLabel(315, true)}”`);
    }
    expect(b).toContain('the dial opens on the wind as it is now');
    expect(dialStart(312)).toBe(310); // the dial opens on the wind rounded to its own step
    // A change cannot start in the last minute of a scenario: the last time is the last whole minute before the end minus one.
    expect(windDirectionTime(env.durationS, env.durationS)).toBe(env.durationS - 60);
    expect(problemText('late', 'now', env.durationS, env)).toBe('There is no time left in this scenario for a wind change.');
    expect(b).toContain('a change cannot start in the last minute of a scenario');
    expect(h).toContain('The last minute of a scenario takes no change');
  });

  it('Wind direction: the speed stays, the whole column turns, the forecast’s later changes are replaced, and the Weather tab says it in the very words', () => {
    const b = squashed('Wind direction (tool)');
    expect(WIND_HINT).toContain('Wind speed stays as forecast.');
    expect(b).toContain('The wind speed stays as forecast, and the whole column of air turns, near the ground and high up');
    expect(squash(step('Wind direction'))).toContain('The wind speed stays as forecast, and the whole column of air turns, near the ground and high up');
    expect(WIND_HINT).toContain("the forecast's later wind changes no longer apply");
    const swings = /const FORECAST_SWINGS_REPLACED = "([^"]+)"/.exec(read('screens/sim/sheet.ts'))?.[1];
    expect(swings).toBe("You changed the wind direction, so the forecast's later wind changes no longer apply.");
    expect(straight(b)).toContain(`“${swings}”`);
    expect(squash(step('Wind direction'))).toContain('so the forecast’s later wind changes no longer apply');
  });

  it('Wind direction: it changes the simulation (the panel says so for an earlier time), Remove is as if never made, and the readings are listed apart and keep their direction', () => {
    const b = squashed('Wind direction (tool)');
    const note = reviewingText(600, env);
    expect(note).toBe('You are viewing 14:10. Applying re-runs the simulation from then.');
    expect(b).toContain(`“${note}”`);
    expect(b).toContain('Unlike the air slices and the wind marks, this changes the simulation');
    expect(squash(step('Wind direction'))).toContain('Unlike the wind marks and the air slices, a change alters the simulation');
    expect(LIST_TITLE).toBe('Your wind changes');
    expect(b).toContain(`“${LIST_TITLE}”`);
    expect(b).toContain('Remove takes it away as if you had never made it, and the simulation is computed again from when you made it, so its cards and its zone go too');
    expect(squash(step('Wind direction'))).toContain('Remove takes it away as if you had never made it. The simulation is computed again from when you made it, so its cards and its zone go too.');
    expect(READINGS_TITLE).toBe('Wind readings');
    expect(READINGS_NOTE).toBe('A reading keeps its own direction when you turn the wind.');
    expect(b).toContain(`“${READINGS_TITLE}”`);
    expect(b).toContain('keeps its own direction near its place when the wind is turned');
    expect(b).toContain('Remove stops it from then on');
    // Back to the forecast: the button's words and what it does, as the panel and the session say it.
    expect(BACK_TO_FORECAST_LABEL).toBe('Back to the forecast');
    expect(b).toContain(`“${BACK_TO_FORECAST_LABEL}”, under the list, takes away every change you made in one press, and the simulation is computed again from when you made the first one`);
    expect(squash(step('Wind direction'))).toContain(`“${BACK_TO_FORECAST_LABEL}”, under the list, takes away every change you made in one press`);
    expect(BACK_TO_FORECAST_HINT).toContain('takes away every wind change you made, as if you had never made them');
    expect(BACK_TO_FORECAST_HINT).toContain('computed again from when you made the first one');
    expect(b).toContain('Readings stay when you go back to the forecast');
    expect(read('screens/sim/windPanel.ts')).toContain("testId: 'wind-back-to-forecast'");
    expect(read('session.ts')).toContain('backToForecast(): number');
    // A turn is its own kind of edit; the belt kit's reading stays the older one.
    expect(read('../core/types.ts')).toContain("kind: 'windDirection'");
    // (0.7.0) A change of yours has its own cards: Watch out, never Danger, from when it was made (src/explain/rules/weather.ts, text.ts).
    const weather = read('../explain/rules/weather.ts');
    expect(weather).toContain("c.user === undefined ? 'danger' : 'watch'");
    expect(weather).toContain('`${kind}:user:${c.user}`');
    const cardText = read('../explain/text.ts');
    expect(cardText).toContain("'Your wind change: this flank becomes the head'");
    expect(b).toContain('“Your wind change: this flank becomes the head”');
    expect(b).toContain('Both say Watch out and never Danger, so they never pause the run');
    expect(b).toContain('While the change is still ahead, and at most an hour away, it also gets a Dead man zone');
    expect(EXPLAIN_PARAMS.dmz.horizonS).toBe(3600);
    expect(squash(step('Wind direction'))).toContain('A change of yours gets a wind change card of its own and, while it is still ahead, a Dead man zone of its own. Both say Watch out and never Danger, so they never pause the run');
    expect(b).toContain('From when you make a change, the forecast’s wind changes that it replaces raise no cards and no zone, and cards raised before that stay in the list as history');
    expect(entry('Wind change').body).toContain('a change you make gets a wind change card of its own');
  });

  it('Wind direction: the fast model follows the turn closely and the 3-D settings can lag, which is what the engine tests allow', () => {
    const b = squashed('Wind direction (tool)');
    expect(b).toContain('On the fast model the fire’s wind follows the turn closely. On the 3-D settings the wind near the ground can lag a little behind it, during a big turn and for a few minutes after');
    expect(squash(step('Wind direction'))).toContain('On the 3-D settings the wind near the ground can lag a little behind a big turn, during it and for a few minutes after');
    expect(read('../sim/windDirection.sim.test.ts')).toContain('the 3-D air runs within 25 degrees of the ambient while it turns and 30 minutes after the change it is within 5 degrees');
  });

  it('Wind detail: the button’s words, four steps, and where it shows and where it does not (no wind mark, the Wind speed map, eye level with only the arrows, the 2-D map)', () => {
    const b = squashed('Wind detail');
    expect(SHEET_TITLE).toBe('Wind detail');
    expect(entry('Wind detail').term).toBe(SHEET_TITLE);
    expect(read('screens/sim/windDetailChip.ts')).toContain("WIND_DETAIL_LABEL = 'Wind detail'");
    expect(b).toContain('the words “Wind detail” and four dots, one filled for each step reached');
    expect(squash(step('Layers'))).toContain('a small “Wind detail” button at the bottom left of the map shows how detailed the wind is at this zoom: four dots, one filled for each step reached');
    expect(squash(step('Layers'))).toContain('it is not shown for the Wind speed map');
    expect(chipLabel(4)).toBe('Wind detail: level 4 of 4. Open the explanation.');
    // Shown only while one of the two wind layers is on, in the 3-D view (the Wind speed map is a heat map: neither layer).
    expect(windDetailState(wind({ glyphsOn: false, streaks: 'off' })).visible).toBe(false);
    expect(windDetailState(wind({ stats: null })).visible).toBe(false);
    expect(windDetailState(wind({ viewMode: 'ground', stats: stats({ active: false, idle: 'eye-level', level: 0, detail: 'off', detailSegments: 0 }) })).visible).toBe(false);
    expect(windDetailState(wind({ glyphsOn: false, streaks: 'surface', viewMode: 'ground', stats: stats({ active: false, idle: 'off', level: 0, detail: 'off', detailSegments: 0 }) })).visible).toBe(true);
    expect(b).toContain('It is not shown at eye level when only the arrows and flow lines are on, for the Wind speed map (a coloured map, not marks), in the 2-D map, or while a panel covers the map');
    expect(read('../styles/sim.css')).toContain('.panel-open .wind-detail');
    // Above the legend, at the bottom left; polled four times a second; a tap opens the sheet, nothing opens by itself.
    expect(read('screens/sim/simScreen.ts')).toContain('The Wind detail chip stands on the legend');
    expect(read('screens/sim/windDetailChip.ts')).toContain('POLL_MS = 250');
    expect(b).toContain('about four times a second');
    expect(b).toContain('never opens by itself and says nothing aloud as you zoom');
  });

  it('Wind detail: the steps and what holds the picture back are the sheet’s own', () => {
    const b = squashed('Wind detail');
    expect(levelLine({ level: 4, kind: 'detailed' })).toBe('Level 4 of 4: detailed streaks.');
    expect(levelLine({ level: 3, kind: 'curves' })).toBe('Level 3 of 4: curved flow lines.');
    expect(levelLine({ level: 1, kind: 'overview' })).toBe('Level 1 of 4: moving streaks over the whole area.');
    expect(b).toContain('from level 0 to level 4');
    expect(b).toContain('Level 4 of 4 is the detailed streaks of the closest zoom');
    expect(b).toContain('straight arrows, curved flow lines, detailed streaks, or the Wind streaks moving over the whole area');
    // The five limits, in the sheet's words and in Help's.
    const words = (s: ReturnType<typeof windDetailState>): string[] => windDetailWords(s, { heightLabel: '10 m', height: 'fire', cellM: 133 }).lines;
    const zoom = windDetailState(wind({ stats: stats({ level: 2, detail: 'off', detailSegments: 0, cellPx: 20 }) }));
    expect(zoom.limits).toContain('zoom');
    expect(words(zoom)).toContain('Zoom in for more detail.');
    expect(b).toContain('you can zoom in for more');
    const cells = windDetailState(wind({ stats: stats({ level: 3, detail: 'off', detailSegments: 0, cellPx: 90 }) }));
    expect(cells.limits).toContain('cells');
    expect(words(cells).join(' ')).toContain('The air model works on cells about 133 m wide. Between its points the wind is a smooth fit.');
    expect(b).toContain('the air model works on cells about 100 to 270 m wide so between its points the wind is a smooth fit');
    expect(windDetailState(wind({ stats: stats({ idle: 'budget', active: false, level: 3, detail: 'off', detailSegments: 0 }) })).limits).toContain('budget');
    expect(BUDGET_LINE).toContain('already uses all the phone can draw');
    expect(b).toContain('the view already uses all the phone can draw');
    expect(windDetailState(wind({ air: 'diagnosed' })).limits).toContain('estimated');
    expect(ESTIMATED_LINE).toBe("The fast tier's wind is estimated from the forecast and the shape of the ground. It is not simulated.");
    expect(b).toContain('the wind of the fast model is estimated from the forecast and not simulated');
    expect(windDetailState(wind({ stats: stats({ detail: 'still' }) })).limits).toContain('still');
    expect(STILL_LINE).toContain('set to reduce motion');
    expect(b).toContain('the phone is set to reduce motion so the streaks stand still');
    expect(MOST_DETAILED_LINE).toBe('This is the most detailed level.');
  });

  it('Detailed streaks: the last step is from about 90 px a cell, both switches (the near-ground streaks and the arrows) feed one picture, and the model’s part and the added part are said apart', () => {
    const b = squashed('Detailed streaks');
    expect(LEVEL_EDGES[3]).toBe(90);
    expect(b).toContain('From about 90 px a model cell');
    const plan = planLod(90 * 1.2, 10, null, undefined, true);
    expect(plan.level).toBe(4);
    expect(plan.lengthPx.pxPerMs).toBe(DETAIL_GEOMETRY.pxPerMs);
    expect(planLod(90 * 1.2, 10, null).lengthPx.pxPerMs).not.toBe(DETAIL_GEOMETRY.pxPerMs); // without the flag the 0.5.0 flow lines stand
    expect(windDetailState(wind({ glyphsOn: false, streaks: 'surface' })).kind).toBe('detailed');
    expect(windDetailState(wind({ glyphsOn: false, streaks: 'volume' })).kind).not.toBe('detailed');
    expect(read('../render/SceneView.ts')).toContain("this.glyphs.setStreaksDetail(l.wind === 'surface')");
    expect(read('../render/SceneView.ts')).toContain('this.wind.setSuppressed(detailInstead)');
    expect(b).toContain('The Wind streaks set to “Near the ground” and the Arrows and flow lines both draw this one picture');
    expect(b).toContain('“Through the plume” is not changed');
    expect(read('screens/sim/layersPanel.ts')).toContain("{ value: 'surface', label: 'Near the ground' }");
    expect(read('screens/sim/layersPanel.ts')).toContain("{ value: 'volume', label: 'Through the plume' }");
    expect(squash(step('Layers'))).toContain('but at the closest zoom both (the Wind streaks set to “Near the ground”) draw the same detailed streaks');
    // What is the model's and what is added, in the sheet's words.
    expect(EDDIES_LINE).toContain('These bends and eddies are added for looks, from the shape of the ground and the trees.');
    expect(b).toContain('are added for looks, from the shape of the ground and the trees; the model does not calculate them, and the Wind detail sheet says so');
    expect(EDDIES_LINE).toContain('The streaks also move faster than the real wind so that you can see them.');
    expect(b).toContain('The streaks also move faster than the real wind so that you can see them.');
    expect(b).toContain('the direction and the speed along each streak, and the colour, are the air model’s');
    // The eddies fade with the Wind height: under half at 300 m.
    expect(detailGroundFactor(10)).toBe(1);
    expect(detailGroundFactor(300)).toBeLessThan(0.5);
    expect(detailGroundFactor(300)).toBeGreaterThan(0.3);
    expect(b).toContain('so the eddies fade (to under half at 300 m)');
    expect(b).toContain('If the phone is set to reduce motion the picture stands still');
    expect(squashed('Arrows and flow lines')).toContain('(the detailed streaks also move along the wind)');
  });

  it('Moving around the map: a two-finger drag to the right turns the camera anticlockwise seen from above (touch only; the mouse and eye level are as they were)', () => {
    const t = squash(step('Moving around the map'));
    expect(t).toContain('Put two fingers on it and move them together: sideways turns the view (drag to the right and the camera turns anticlockwise seen from above, so the map seems to turn clockwise under your fingers), up or down tilts it, or pinch to zoom.');
    expect(t).toContain('At eye level you cannot slide: one finger turns your head.');
    expect(t).toContain('With a mouse: left button slides, right button turns, wheel zooms.');
    const rig = read('../render/cameraRig.ts').replace(/\s*\n\s*\*?\s*/g, ' '); // the code's comments wrap
    expect(rig).toContain('class TwoFingerTurnControls extends OrbitControls');
    expect(rig).toContain('A two-finger drag to the right turns the camera anticlockwise seen from above');
    expect(rig).toContain("the mouse's right-button rotate keeps OrbitControls' direction");
  });
});

describe('Help and glossary: the 0.7.0 entries say what What the fire feels, Colour the map by speed, the speed test, the idle stop, reduced motion and the pan say', () => {
  const squashed = (term: string): string => squash(entry(term).body);
  const read = (file: string): string => readFileSync(resolve(__dirname, file), 'utf8');
  const abs = (t: number): number => Date.UTC(2025, 0, 5, 14, 5) + t * 1000;
  const stats = (over: Partial<WindGlyphStats> = {}): WindGlyphStats => ({
    active: true, idle: null, level: 4, count: 600, segments: 6000, cellPx: 120, cellM: 133, rebuilds: 3, lastMs: 2, sliceP95Ms: 3, sliceMaxMs: 5, slicesLast: 1, detail: 'moving', detailSegments: 6000, glyphs: true, streaks: false, reduced: false, tickMaxMs: 0, ...over,
  });
  const wind = (over: Partial<WindDetailInput> = {}): WindDetailInput => ({ glyphsOn: true, streaks: 'off', viewMode: 'orbit', stats: stats(), air: 'prognostic', height: 'felt', ...over });

  it('every term the release notes ask for has an entry, and none calls a height "Ground"', () => {
    for (const t of ['Wind the fire feels', 'Colour the map by speed', 'Speed test', 'Paused to save battery', 'Reduced motion']) expect(entry(t).body.length, t).toBeGreaterThan(300);
    expect(entry('Colour the map by speed').term).toBe(MAP_CHIP_LABEL);
    for (const t of everything()) expect(t).not.toMatch(/\bGround\b/);
  });

  it('Wind the fire feels: the chip, the 60 m cells, the refit once a minute on the fast model, the calm-night sentence and the caption are the code’s', () => {
    const b = squashed('Wind the fire feels');
    expect(heightLabel('felt')).toBe('What the fire feels');
    expect(b).toContain('The first Wind height chip, “What the fire feels”, and the one the app starts with');
    // The cells: 20 m and 30 m fire cells are averaged in blocks of 3 and 2, so about 60 m either way.
    expect([fireWindBlock(20) * 20, fireWindBlock(30) * 30]).toEqual([60, 60]);
    expect(FIRE_WIND_TARGET_CELL_M).toBe(60);
    expect(b).toContain('The cells are about 60 m wide: the model’s 20 m or 30 m cells are averaged in blocks, and every picture of the run carries one');
    // What it includes and that it is no measurement: the caption's own sentence.
    expect(feltLine(60)).toBe("The wind the fire model uses in each 60 m cell: slope flow, lee eddies and the fire's own effect on the wind are included. It is not a measurement.");
    expect(b).toContain('It includes slope flow (air running up or down a slope), the eddies in the lee of ridges and the fire’s own effect on the wind');
    expect(b).toContain('It is not a measurement.');
    // The fast model's wind is refitted once a minute (the engine's own interval), and the caption says so.
    expect(SIM_PARAMS.fastWindIntervalS).toBe(60);
    expect(FELT_FAST_LINE).toBe('On the fast model it is refitted once a minute.');
    expect(b).toContain('On the fast model it is refitted once a minute');
    // The calm-night sentence (checked on both tiers in 0.7.0: plan 22.3).
    expect(FELT_NIGHT_LINE).toBe('On a calm night much of it is air draining downhill.');
    expect(b).toContain('On a calm night much of it is air draining downhill');
    // The caption's first line, in the Wind height entry's own quotes.
    const head = captionHeadline('felt', { cellM: 133.3, airTime: 0, shownTime: 0, diagnosed: false, felt: { cellM: 60, time: 0 } }, 'UTC', abs);
    expect(head).toBe('Wind the fire feels · 60 m cells · air from 14:05.');
    expect(squashed('Wind height')).toContain(`“${head}”`);
    // A jumped-back picture carries its keyframe's wind: up to a keyframe interval (300 s) older, stamped (ui/snapshotStore.ts).
    expect(read('snapshotStore.ts')).toContain('const fireWind = key ? key.fireWind : head?.fireWind;');
    expect(b).toContain('up to about 5 minutes older, and the caption says which');
    expect(b).toContain('never changes the fire');
  });

  it('Colour the map by speed: the chip is the Wind speed map on and off, follows the Wind height while the arrows are on, and its legend runs to 60 or 90 km/h', () => {
    const b = squashed('Colour the map by speed');
    expect(MAP_CHIP_LABEL).toBe('Colour the map by speed');
    expect(squash(step('Layers'))).toContain(`“${MAP_CHIP_LABEL}”, under the Wind height chips, colours the ground by the wind speed at that height. It needs a fire marked.`);
    expect(windMapPatch(true)).toEqual({ overlay: 'windSpeed' });
    expect(windMapPatch(false)).toEqual({ overlay: 'none' });
    expect(b).toContain('It is the same thing as the Wind speed row under Heat maps, so only one heat map shows at a time');
    // With the arrows off the map is the 10 m one, as before; with them on it follows the height.
    expect(windMapHeight({ windGlyphs: false, windHeight: 'felt' })).toBe('fire');
    expect(windMapHeight({ windGlyphs: true, windHeight: 'felt' })).toBe('felt');
    expect(entry('Wind speed map').body).toContain('With the arrows off it is the 10 m map, as before');
    expect(entry('Wind speed map').body).toContain('While Arrows and flow lines is on, the map follows the Wind height you chose for them, from What the fire feels to 2 km');
    // It needs a fire, like the row, and the line under the chips says why.
    expect(windMapReasonLine('Needs a fire: mark one first')).toBe('Colour the map by speed. Needs a fire: mark one first.');
    expect(b).toContain('until then the chip is greyed and the line under the chips says why');
    expect(b).toContain('it needs a fire marked first');
    // The ranges: 60 km/h up to 100 m, 90 km/h from 300 m.
    expect([...WIND_HEIGHTS].map((h) => windSpeedRangeKmh(h))).toEqual([60, 60, 60, 60, 90, 90, 90]);
    expect(b).toContain('up to 60 km/h for What the fire feels and from 10 m to 100 m, and up to 90 km/h from 300 m');
    // The legend names the wind, and says plainly when a picture has none at the height.
    expect(legendFor('windSpeed', { windHeight: 100 })!.title).toBe('Wind speed at 100 m');
    expect(legendFor('windSpeed', { windHeight: 'felt' })!.title).toBe('Wind speed the fire feels');
    expect(legendFor('windSpeed', { windHeight: 'felt' })!.note).toContain('cells of about 60 m');
    expect(b).toContain('for example “Wind speed at 100 m”, and for What the fire feels it says the cells are about 60 m');
    const none = legendFor('windSpeed', { windHeight: 300, windNoData: true })!.noData!.label;
    expect(none).toBe('No wind data at 300 m in this picture');
    expect(b).toContain(`“${none}”`);
    // The arrows keep their own ramp over the map (the legend card is the map's).
    expect(windGlyphLegend('at 100 m').entries.map((e) => e.colour)).not.toEqual(legendFor('windSpeed', { windHeight: 100 })!.entries.map((e) => e.colour));
    expect(b).toContain('The arrows keep their own colours on top of the map');
    expect(windSpeedSubline('In km/h', 'felt')).toBe('In km/h, the wind the fire feels');
    expect(squashed('Map view')).toContain('the “Colour the map by speed” chip');
  });

  it('Speed test: the button’s words, what the two jobs are, the reference and the reasons it is off are the code’s', () => {
    const b = squashed('Speed test');
    expect(SPEED_TEST_LABEL).toBe('Run the speed test');
    expect(b).toContain(`“${SPEED_TEST_LABEL}”`);
    expect(squash(step('Statistics'))).toContain(`“${SPEED_TEST_LABEL}”`);
    expect(SPEED_TEST_BUDGET_MS).toBe(2000);
    expect(SPEED_TEST_IDLE).toBe('Not run yet. Takes about 2 seconds.');
    expect(b).toContain('for about 2 seconds, off the main thread');
    expect([STENCIL_NX, STENCIL_NY, STENCIL_NZ]).toEqual([45, 45, 20]);
    expect((COPY_FLOATS * Float32Array.BYTES_PER_ELEMENT) / 1048576).toBe(16);
    expect(b).toContain('over 45 by 45 by 20 cells, and a memory copy of 16 MiB');
    // The jobs are frozen and the reference is another computer's: the build machine, with the version and the date.
    expect(SPEED_TEST_VERSION).toBe(1);
    expect(SPEED_TEST_REFERENCE.stencilMcellsPerS).toBeGreaterThan(0);
    expect(SPEED_TEST_REFERENCE.copyGBps).toBeGreaterThan(0);
    expect(b).toContain('the computer the app was built on, the build machine');
    expect(b).toContain('so two phones can be compared before any run');
    expect(b).toContain('It does not predict a run, and the simulation’s own measured speed is the better number once a run exists');
    // Off while a run plays, and nothing the engine, Auto or the pace button reads.
    expect(SPEED_TEST_BLOCKED.playing).toBe('Pause first so the test is fair.');
    expect(b).toContain('off, with the reason beside it, while a run plays or the simulation is computing and while the app is in the background');
    expect(b).toContain('nothing in the simulation, in Auto or in the speed button of the timeline reads it');
    expect(read('speedTest.deps.test.ts')).toContain('speedTest');
    expect(entry('Simulation debug statistics').body).toContain('(see Speed test)');
  });

  it('Paused to save battery: a minute without a touch, what wakes it, that a running simulation never pauses, and where it says so', () => {
    const b = squashed('Paused to save battery');
    expect(IDLE_STOP_MS).toBe(60_000);
    expect(b).toContain('After a minute with no touch, no camera move and no change of time, layers or screen size');
    // The events that count as a touch (anywhere in the page) and the rule that a new picture is activity, so a running simulation never stops.
    const scene = read('../render/SceneView.ts');
    expect(scene).toContain("const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart'] as const;");
    expect(scene).toContain('a running simulation never lets the view stop');
    expect(b).toContain('A running simulation never lets the view hold still, because the picture changes with the time');
    expect(b).toContain('Only a touch wakes it, so a screen that a class only watches will look stuck after a minute until someone touches it');
    expect(squashed('Detailed streaks')).toContain('On a classroom screen nobody touches, the view will look stuck after a minute until someone does');
    // What it says where: the sheet, the line under the chips (the statistics say "paused").
    expect(PAUSED_LINE).toBe('The streaks paused to save battery. Touch the screen to move them again.');
    expect(PAUSED_STREAKS_LINE).toBe('Showing streaks with small eddies, paused to save battery. This is the most detailed level.');
    expect(b).toContain('the Wind detail sheet and the line under the Wind height chips say “paused to save battery”, and the debug statistics say “paused”');
    const paused = windDetailState(wind({ stats: stats({ detail: 'paused' }) }));
    expect(paused.limits).toContain('paused');
    expect(windDetailWords(paused, { heightLabel: 'What the fire feels', height: 'felt', cellM: 133 }).lines).toContain(PAUSED_LINE);
    expect(read('debugStats.ts')).toContain("paused: 'paused'");
    // The Help's Layers step and the Wind detail entry say it too.
    expect(squash(step('Layers'))).toContain('After a minute without a touch the view holds still to save battery, and any touch starts it again. A running simulation never lets it hold still.');
    expect(squashed('Wind detail')).toContain('or the view has paused to save battery after a minute without a touch');
  });

  it('Reduced motion: the Wind streaks and the trees stand still at every zoom, the fire does not, and the sheet says it', () => {
    const b = squashed('Reduced motion');
    // The old Wind streaks (streaks 'surface' at level 2, where nothing of level 4 is drawn) raise the "still" limit; reduced motion is what stills them.
    const old = windDetailState(wind({ glyphsOn: false, streaks: 'surface', stats: stats({ level: 2, detail: 'off', detailSegments: 0, reduced: true, glyphs: false, streaks: true }) }));
    expect(old.limits).toContain('still');
    expect(windDetailWords(old, { heightLabel: '10 m', height: 'fire', cellM: 133 }).lines).toContain(STILL_LINE);
    expect(squashed('Wind detail')).toContain('the phone is set to reduce motion so the streaks stand still (the Wind streaks too, at every zoom)');
    expect(read('../render/windLayer.ts')).toContain('if (!this.motion) dt = 0;');
    expect(read('../render/vegetationLayer.ts')).toContain('this.motion ? p.amp : 0, this.motion ? p.flutter : 0');
    expect(b).toContain('the trees stop swaying but keep their lean');
    expect(b).toContain('The fire itself keeps moving: flames, embers and smoke show where the fire is and how hot it is, so they are not stilled');
    expect(squash(step('Layers'))).toContain('If the phone is set to reduce motion, the Wind streaks and the trees stand still too.');
  });

  it('Moving around the map: the spot you touch stays under your finger, and far ground near the horizon is the one place the map moves fast', () => {
    const t = squash(step('Moving around the map'));
    expect(t).toContain('The spot you touch stays under your finger. Far away, near the horizon, each pixel covers a lot of country, so the map moves fast when you slide there.');
    // The pan holds the touched ground exactly down to 5 degrees below the horizon, as far as 12 camera-to-target distances (render/groundPan.ts).
    expect(PAN.HORIZON_MARGIN_DEG).toBe(5);
    expect(PAN.FAR).toBe(12);
    expect(PAN).not.toHaveProperty('MAX_SPEEDUP');
    // Turning and tilting are 15 % faster than 0.6.0's 2/3.
    expect(GESTURE.rotateSpeed).toBeCloseTo((2 / 3) * 1.15, 12);
    // The turn and the tilt of two fingers are the rig's own (no private member of OrbitControls), and the Help's other sentences about them stand (above).
    expect(read('../render/twoFingerTurn.ts')).not.toMatch(/_rotateLeft\s*\(|_handleTouchMoveDollyRotate\s*\(/);
  });

  it('Detailed streaks, 0.7.0: they ride on the trees, part round crowns and ridges, and curl into eddies, for What the fire feels and the 10 m wind only; the sheet says they are added', () => {
    const b = squashed('Detailed streaks');
    expect(DETAIL_RELIEF.enabled).toBe(true); // the one switch that draws the 0.6.0 picture again is a constant of the code, not a setting
    // The trees and the plume are for the wind read at the ground's own level: What the fire feels and 10 m both read at 10 m; 50 m and up fly over them.
    expect(RELIEF_TREE_MAX_M).toBeGreaterThanOrEqual(10);
    expect(RELIEF_TREE_MAX_M).toBeLessThan(50);
    expect(b).toContain('The trees and the plume count only for What the fire feels and the 10 m wind: higher up the streaks fly over the trees');
    // Crowns are trees, not heath, shrubs or grass (the placement's groups 0 to 6).
    expect(DETAIL_RELIEF.crowns.maxGroup).toBe(6);
    expect(b).toContain('part round each crown that stands in their way and close up behind it, and slide along a slope that rises ahead of them');
    // A line that meets a crown is steered round it and a seed in a crown starts on its downwind side, so a forest keeps about the lines of open ground (detailObstacles.ts: `steer`, `relocate`).
    expect(b).toContain('A streak that meets a crown slides round its edge and goes on, so a forest still has about as many streaks as open ground');
    expect(read('../render/wind/detailObstacles.ts')).toMatch(/steer\(\): void/);
    expect(read('../render/wind/detailObstacles.ts')).toMatch(/relocate\(\): void/);
    expect(DETAIL_RELIEF.crowns.rim).toBeGreaterThan(1);
    expect(EDDIES_LINE).toContain('Where the ground rises or trees stand, the streaks bend around them, and small eddies are added behind them.');
    expect(EDDIES_LINE).not.toMatch(/model's/);
    // The eddies come in pairs that turn opposite ways (Rankine vortex pairs: detailObstacles.ts).
    expect(read('../render/wind/detailObstacles.ts')).toContain('counter-rotating Rankine vortices');
    expect(b).toContain('a pair of eddies that turn opposite ways');
  });

  it('Air slices: the 3-D button sits under the chips and the reasons stay under the controls', () => {
    expect(squash(step('Air slices'))).toContain(`Then a “${USE_3D_LABEL}” button sits right under the chips, and the reasons are further down, under the controls.`);
    const panel = read('screens/sim/slicePanel.ts');
    expect(panel).toContain('[view, readout, chipRow, use3dRow, legendHost, controlsWrap, reasons, cellsToggle.el');
  });
});
