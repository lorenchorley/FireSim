/**
 * The Air slices tool's placement model (sliceToolModel.ts): the steps of placing A and B, the candidate a map tap sets, the draft that
 * keeps the first end until the other exists, the line-writing rules (a and b together, preset null, the first placement's field),
 * the four presets and why one is disabled, Swap, the refusals in plain words, Back, the quiet line under the buttons and the map marks.
 */
import { describe, expect, it } from 'vitest';
import type { GridSpec } from '../../../core/grid';
import { DEFAULT_LAYERS } from '../../../render/layers';
import { resolveSlice, sectionFromEndpoints, slicePresetStatus } from '../../../render/slice/sectionLine';
import { SLICE_PRESET_IDS, type ResolvedSlice, type SlicePoint, type SlicePresetId, type SlicePresetStatus, type SliceResolveContext } from '../../../render/slice/types';
import {
  AIR_TOOL_LABEL,
  LINE_PROJECTION_POINTS,
  NOTE_WORDS,
  PLACE_LABEL,
  SET_LABEL,
  alongPoints,
  backStep,
  cancelPlacing,
  choosePreset,
  controlsView,
  effectiveField,
  fieldWrite,
  hasStoredLine,
  inModelArea,
  initialSliceToolState,
  issueWords,
  lineFacts,
  marksAreLive,
  minLengthFor,
  ownLine,
  placeHere,
  placeVerdict,
  placeWords,
  presetStatuses,
  presetViews,
  probeMapPoint,
  reopened,
  roundUp50,
  sliceAnnotationMarks,
  sliceMarks,
  startPlacing,
  swapEnds,
  tapCandidate,
  userFixOf,
  withProbe,
  withShowCells,
  type ControlsInput,
  type CrossSection,
  type LineFacts,
} from './sliceToolModel';
import type { SliceToolState } from './sliceTypes';

/** A 6 km model area, 100 m cells: x and y from -3000 to 3000. */
const GRID: GridSpec = { nx: 61, ny: 61, cellSize: 100, x0: -3000, y0: -3000, origin: { lat: -33.7, lon: 150.3 } };

const CS: CrossSection = { ...DEFAULT_LAYERS.crossSection };
const EMPTY: LineFacts = { line: null, source: null, preset: null, issue: null, notes: [], minLengthM: 300 };
const withLine = (a: SlicePoint, b: SlicePoint, source: LineFacts['source'] = 'endpoints', extra: Partial<LineFacts> = {}): LineFacts => ({ ...EMPTY, line: { a, b }, source, ...extra });
const placing = (end: 'a' | 'b', extra: Partial<SliceToolState> = {}): SliceToolState => ({ ...initialSliceToolState(), placing: end, ...extra });
const allOk = (): Record<SlicePresetId, SlicePresetStatus> => presetStatuses(null, 'ok');

/** What the scene gives the resolver: a slope rising to the north-east, the wind from the west, a fire at the centre, a phone fix. */
const ctxOf = (grid: GridSpec): SliceResolveContext => ({ grid, heightAt: (x, y) => 500 + 0.2 * x + 0.2 * y, mapCentre: [0, 0], fire: [0, 0], windFromDeg: 270, user: [-500, -500] });

describe('the tool and its words', () => {
  it('has the label the Tools dock shows', () => {
    expect(AIR_TOOL_LABEL).toBe('Air slices');
    expect(SET_LABEL).toEqual({ a: 'Set start (A)', b: 'Set end (B)' });
    expect(PLACE_LABEL).toEqual({ a: 'Place A here', b: 'Place B here' });
  });

  it('rounds the shortest line up to 50 m for the words', () => {
    expect(roundUp50(300)).toBe(300);
    expect(roundUp50(266)).toBe(300);
    expect(roundUp50(301)).toBe(350);
    expect(roundUp50(266.6)).toBe(300);
    expect(roundUp50(10)).toBe(50);
  });

  it('the shortest line is the larger of 300 m and two model cells', () => {
    expect(minLengthFor(GRID)).toBe(300);
    expect(minLengthFor({ ...GRID, cellSize: 200 })).toBe(400);
    expect(minLengthFor(null)).toBe(300);
  });

  it('words every issue in plain language, with no code, no em dash and the number of the model', () => {
    for (const issue of ['too-short', 'outside-model', 'no-user', 'no-fire', 'flat-ground', 'calm'] as const) {
      const w = issueWords(issue, 300);
      expect(w.length).toBeGreaterThan(10);
      expect(w).not.toMatch(/—|[a-z]+-[a-z]+-/);
    }
    expect(issueWords('too-short', 266)).toBe('Make the line longer than 300 m');
    expect(issueWords('too-short', 420)).toBe('Make the line longer than 450 m');
    expect(issueWords('no-user', 300, 'none')).toBe('This run has no position for you');
    expect(issueWords('no-user', 300, 'outside')).toBe('You are outside the model area');
  });

  it('the two notes are the plan words', () => {
    expect(NOTE_WORDS.clipped).toBe('Shown to the edge of the model area');
    expect(NOTE_WORDS['no-fire-centred-on-map']).toBe('No fire yet: centred on the map');
  });
});

describe('geometry', () => {
  it('the model area is the node extent of the grid, edges included', () => {
    expect(inModelArea([0, 0], GRID)).toBe(true);
    expect(inModelArea([-3000, 3000], GRID)).toBe(true);
    expect(inModelArea([3000.1, 0], GRID)).toBe(false);
    expect(inModelArea([0, -3001], GRID)).toBe(false);
  });

  it('works out where the phone is against the model area', () => {
    expect(userFixOf(null, GRID)).toBe('none');
    expect(userFixOf([5000, 0], GRID)).toBe('outside');
    expect(userFixOf([100, 100], GRID)).toBe('ok');
    expect(userFixOf([100, 100], null)).toBe('ok');
  });

  it('draws the line on the terrain as evenly spaced points, ends included', () => {
    const pts = alongPoints([0, 0], [0, 900], 4);
    expect(pts).toEqual([[0, 0], [0, 300], [0, 600], [0, 900]]);
    expect(alongPoints([1, 2], [3, 4], 1)).toHaveLength(2);
  });

  it('puts the probe pin at a + dir * s, and keeps it on the line', () => {
    const line = { a: [0, 0] as SlicePoint, b: [3, 4] as SlicePoint };
    const p = probeMapPoint(line, { s: 2.5, z: 100 })!;
    expect(p[0]).toBeCloseTo(1.5, 9);
    expect(p[1]).toBeCloseTo(2, 9);
    expect(probeMapPoint(line, { s: 99, z: 0 })).toEqual([3, 4]);
    expect(probeMapPoint(line, { s: -5, z: 0 })).toEqual([0, 0]);
    expect(probeMapPoint({ a: [1, 1], b: [1, 1] }, { s: 1, z: 0 })).toBeNull();
  });
});

describe('the line as the tool sees it', () => {
  const resolved = (extra: Partial<ResolvedSlice> = {}): ResolvedSlice => ({
    line: { a: [0, 0], b: [0, 1000], dir: [0, 1], length: 1000 },
    source: 'endpoints',
    preset: null,
    issue: null,
    notes: [],
    minLengthM: 300,
    ...extra,
  });

  it('takes the scene\'s resolved line when there is one', () => {
    const f = lineFacts(resolved({ source: 'preset', preset: 'along', notes: ['clipped'] }), CS, GRID);
    expect(f).toMatchObject({ line: { a: [0, 0], b: [0, 1000] }, source: 'preset', preset: 'along', notes: ['clipped'], minLengthM: 300 });
  });

  it('a line the scene could not make has no line and says why', () => {
    const f = lineFacts(resolved({ line: null, issue: 'too-short', minLengthM: 266 }), CS, GRID);
    expect(f.line).toBeNull();
    expect(f.issue).toBe('too-short');
    expect(f.minLengthM).toBe(266);
  });

  it('before the scene has a slice, the stored section says what the line will be', () => {
    expect(lineFacts(null, { ...CS, a: [0, 0], b: [500, 0] }, GRID)).toMatchObject({ line: { a: [0, 0], b: [500, 0] }, source: 'endpoints' });
    expect(lineFacts(null, { ...CS, preset: 'slope' }, GRID)).toMatchObject({ line: null, source: 'preset', preset: 'slope' });
    expect(lineFacts(null, { ...CS, enabled: true }, GRID).source).toBe('centre');
    expect(lineFacts(null, CS, GRID).source).toBeNull();
    expect(lineFacts(null, CS, { ...GRID, cellSize: 200 }).minLengthM).toBe(400);
  });

  it('the original curtain\'s chord is not a line of the tool\'s', () => {
    expect(ownLine(withLine([0, 0], [1000, 0], 'centre'))).toBeNull();
    expect(ownLine(withLine([0, 0], [1000, 0], 'endpoints'))).not.toBeNull();
    expect(ownLine(withLine([0, 0], [1000, 0], 'preset'))).not.toBeNull();
    expect(ownLine(EMPTY)).toBeNull();
  });

  it('knows when the section holds a line of the tool\'s', () => {
    expect(hasStoredLine(CS)).toBe(false);
    expect(hasStoredLine({ ...CS, a: [0, 0] })).toBe(false); // a lone end is ignored by the resolver
    expect(hasStoredLine({ ...CS, a: [0, 0], b: [0, 500] })).toBe(true);
    expect(hasStoredLine({ ...CS, preset: 'me' })).toBe(true);
  });

  it('the effective chip is the scene\'s, else the stored one, else Speed', () => {
    expect(effectiveField({ field: 'theta' }, { ...CS, field: 'smoke' })).toBe('theta');
    expect(effectiveField(null, { ...CS, field: 'smoke' })).toBe('smoke');
    expect(effectiveField(null, CS)).toBe('speed');
  });
});

describe('placing: steps, candidate, cancel, Back', () => {
  it('Set start (A) starts placing A with nothing tapped yet, and says what to do', () => {
    const step = startPlacing({ ...initialSliceToolState(), candidate: [1, 1] }, 'a');
    expect(step.state).toMatchObject({ placing: 'a', candidate: null });
    expect(step.crossSection).toBeNull();
    expect(step.say).toContain('Place A here');
  });

  it('a map tap while placing sets the candidate, rounded to 0.1 m; a tap outside placing does nothing', () => {
    const s = placing('b');
    expect(tapCandidate(s, [10.04, -20.06]).candidate).toEqual([10, -20.1]);
    const idle = initialSliceToolState();
    expect(tapCandidate(idle, [1, 2])).toBe(idle);
  });

  it('a second tap moves the candidate', () => {
    const s = tapCandidate(placing('a'), [1, 1]);
    expect(tapCandidate(s, [200, 300]).candidate).toEqual([200, 300]);
  });

  it('Cancel drops the placement and the candidate and keeps the rest', () => {
    const s = placing('a', { candidate: [5, 5], draft: { a: null, b: [100, 100] }, showCells: true });
    const step = cancelPlacing(s);
    expect(step.state).toMatchObject({ placing: null, candidate: null, draft: { a: null, b: [100, 100] }, showCells: true });
    expect(step.crossSection).toBeNull();
    const idle = initialSliceToolState();
    expect(cancelPlacing(idle).state).toBe(idle);
    expect(cancelPlacing(idle).say).toBeNull();
  });

  it('Back (and Escape) while placing cancels the placement and keeps the tool open; with nothing to undo it passes the press on', () => {
    expect(backStep(placing('a'))?.state.placing).toBeNull();
    expect(backStep(initialSliceToolState())).toBeNull();
    expect(backStep(undefined)).toBeNull();
    expect(backStep(placing('b', { candidate: [1, 1] }))?.state.candidate).toBeNull();
  });

  it('opening the tool again drops a placement under way and keeps everything else', () => {
    const s = placing('a', { candidate: [1, 1], probe: { s: 100, z: 900 }, showCells: true, draft: { a: [0, 0], b: null } });
    expect(reopened(s)).toMatchObject({ placing: null, candidate: null, probe: { s: 100, z: 900 }, showCells: true, draft: { a: [0, 0], b: null } });
    const idle = initialSliceToolState();
    expect(reopened(idle)).toBe(idle);
  });

  it('starts with the side view, nothing placed, no probe and the model cells off', () => {
    expect(initialSliceToolState()).toEqual({ tab: 'side', placing: null, candidate: null, draft: { a: null, b: null }, probe: null, showCells: false });
  });
});

describe('the verdict on a point: ground, model area, shortest line', () => {
  it('the cross over the sky is refused with "Move the cross over the map"', () => {
    const v = placeVerdict('a', null, placing('a'), EMPTY, GRID);
    expect(v).toEqual({ ok: false, why: 'no-ground' });
    expect(placeWords(v as { ok: false; why: 'no-ground' }, 300)).toBe('Move the cross over the map');
  });

  it('a point outside the model area is refused, with the cross words for the crosshair and its own words for a tap', () => {
    const v = placeVerdict('a', [4000, 0], placing('a'), EMPTY, GRID);
    expect(v).toEqual({ ok: false, why: 'outside' });
    const bad = v as { ok: false; why: 'outside' };
    expect(placeWords(bad, 300)).toBe('Move the cross over the map');
    expect(placeWords(bad, 300, true)).toBe('That spot is outside the model area');
  });

  it('without a grid only the ground matters', () => {
    expect(placeVerdict('a', [99999, 0], placing('a'), EMPTY, null)).toEqual({ ok: true });
  });

  it('a point too close to the other end of the line is refused: "Make the line longer than 300 m"', () => {
    const f = withLine([0, 0], [0, 1000]);
    const v = placeVerdict('a', [0, 800], placing('a'), f, GRID);
    expect(v).toEqual({ ok: false, why: 'too-short' });
    expect(placeWords(v as { ok: false; why: 'too-short' }, 300)).toBe('Make the line longer than 300 m');
    expect(placeVerdict('a', [0, 700], placing('a'), f, GRID)).toEqual({ ok: true }); // exactly the shortest length is fine
    expect(placeVerdict('a', [0, 701], placing('a'), f, GRID)).toEqual({ ok: false, why: 'too-short' });
  });

  it('the shortest length in the words follows the model (two cells), rounded up to 50 m', () => {
    const f = withLine([0, 0], [0, 2000], 'endpoints', { minLengthM: 266.6 });
    const v = placeVerdict('b', [0, 100], placing('b'), f, GRID);
    expect(v.ok).toBe(false);
    expect(placeWords(v as { ok: false; why: 'too-short' }, f.minLengthM)).toBe('Make the line longer than 300 m');
  });

  it('measures against the draft end when the tool has no line yet, and against nothing when it has neither', () => {
    const s = placing('b', { draft: { a: [0, 0], b: null } });
    expect(placeVerdict('b', [100, 100], s, EMPTY, GRID)).toEqual({ ok: false, why: 'too-short' });
    expect(placeVerdict('b', [400, 0], s, EMPTY, GRID)).toEqual({ ok: true });
    expect(placeVerdict('b', [10, 10], placing('b'), EMPTY, GRID)).toEqual({ ok: true });
  });

  it('the original curtain\'s chord does not count as the other end', () => {
    const chord = withLine([-3000, 0], [3000, 0], 'centre');
    expect(placeVerdict('a', [2900, 0], placing('a'), chord, GRID)).toEqual({ ok: true });
  });
});

describe('placing the first line: a draft end waits for the other, then both are written', () => {
  it('Place A here with no line keeps A in the draft and writes nothing', () => {
    const { step, verdict } = placeHere(placing('a'), [100, 200], CS, EMPTY, GRID);
    expect(verdict).toEqual({ ok: true });
    expect(step.crossSection).toBeNull();
    expect(step.state).toMatchObject({ placing: null, candidate: null, draft: { a: [100, 200], b: null } });
    expect(step.say).toBe('Start (A) placed. Now set the end (B).');
  });

  it('Place B here after A writes both ends together, preset null, the section on and Speed as the first field', () => {
    const s: SliceToolState = { ...placing('b'), draft: { a: [100, 200], b: null }, probe: { s: 5, z: 5 } };
    const { step } = placeHere(s, [1100, 200], CS, EMPTY, GRID);
    expect(step.crossSection).toMatchObject({ enabled: true, a: [100, 200], b: [1100, 200], preset: null, field: 'speed' });
    expect(step.state).toMatchObject({ placing: null, candidate: null, draft: { a: null, b: null }, probe: null });
    expect(step.say).toBe('Line placed. The side view shows it.');
  });

  it('the line may be placed B first, then A', () => {
    const first = placeHere(placing('b'), [1000, 0], CS, EMPTY, GRID).step;
    expect(first.state.draft).toEqual({ a: null, b: [1000, 0] });
    const second = placeHere({ ...first.state, placing: 'a' }, [0, 0], CS, EMPTY, GRID).step;
    expect(second.crossSection).toMatchObject({ a: [0, 0], b: [1000, 0], preset: null });
  });

  it('never writes a lone end: a and b come together or not at all', () => {
    const { step } = placeHere(placing('a'), [0, 0], CS, EMPTY, GRID);
    expect(step.crossSection).toBeNull();
  });

  it('keeps the field the layers already hold, and writes Speed only when there is none', () => {
    const draft = { ...placing('b'), draft: { a: [0, 0] as SlicePoint, b: null } };
    expect(placeHere(draft, [1000, 0], { ...CS, field: 'theta' }, EMPTY, GRID).step.crossSection?.field).toBe('theta');
    expect(placeHere(draft, [1000, 0], CS, EMPTY, GRID).step.crossSection?.field).toBe('speed');
  });

  it('keeps the compass settings (azimuth and centre) of the section untouched', () => {
    const cs: CrossSection = { ...CS, azimuth: 123, centre: [50, 60] };
    const draft = { ...placing('b'), draft: { a: [0, 0] as SlicePoint, b: null } };
    expect(placeHere(draft, [1000, 0], cs, EMPTY, GRID).step.crossSection).toMatchObject({ azimuth: 123, centre: [50, 60] });
  });

  it('uses the candidate a tap set, not the crosshair, when the caller passes it as the point', () => {
    const s = placing('a', { candidate: [10, 10] });
    expect(placeHere(s, s.candidate, CS, EMPTY, GRID).step.state.draft.a).toEqual([10, 10]);
  });

  it('a refused point changes nothing and says why', () => {
    const s = placing('a', { candidate: [1, 1] });
    const out = placeHere(s, null, CS, EMPTY, GRID);
    expect(out.verdict).toEqual({ ok: false, why: 'no-ground' });
    expect(out.step.state).toBe(s);
    expect(out.step.crossSection).toBeNull();
    expect(out.step.say).toBeNull();
    expect(placeHere(s, [9000, 0], CS, EMPTY, GRID).verdict).toEqual({ ok: false, why: 'outside' });
  });

  it('with no placement under way "Place here" does nothing', () => {
    const idle = initialSliceToolState();
    const out = placeHere(idle, [0, 0], CS, EMPTY, GRID);
    expect(out.step.state).toBe(idle);
    expect(out.step.crossSection).toBeNull();
  });

  it('a first placement beside the original curtain\'s chord starts a fresh line (the chord\'s end is not kept)', () => {
    const chord = withLine([-3000, 0], [3000, 0], 'centre');
    const { step } = placeHere(placing('a'), [0, 500], { ...CS, enabled: true }, chord, GRID);
    expect(step.crossSection).toBeNull();
    expect(step.state.draft.a).toEqual([0, 500]);
  });
});

describe('moving one end of a line that exists writes both ends', () => {
  it('re-placing A keeps B of the hand-placed line', () => {
    const f = withLine([0, 0], [0, 1000]);
    const { step } = placeHere(placing('a', { probe: { s: 200, z: 800 } }), [500, 0], { ...CS, field: 'along' }, f, GRID);
    expect(step.crossSection).toMatchObject({ enabled: true, a: [500, 0], b: [0, 1000], preset: null, field: 'along' });
    expect(step.state.probe).toBeNull();
    expect(step.say).toBe('Start (A) moved. The side view follows the new line.');
  });

  it('re-placing B keeps A', () => {
    const f = withLine([0, 0], [0, 1000]);
    expect(placeHere(placing('b'), [900, 900], CS, f, GRID).step.crossSection).toMatchObject({ a: [0, 0], b: [900, 900] });
  });

  it('a preset\'s line is taken the same way: the other end comes from the resolved line and the preset is dropped', () => {
    const f = withLine([-1000, 0], [1000, 0], 'preset', { preset: 'along' });
    const { step } = placeHere(placing('b'), [1500, 1500], { ...CS, preset: 'along' }, f, GRID);
    expect(step.crossSection).toMatchObject({ a: [-1000, 0], b: [1500, 1500], preset: null });
  });

  it('refuses a point too close to the end that stays', () => {
    const f = withLine([0, 0], [0, 1000]);
    const out = placeHere(placing('a'), [0, 900], CS, f, GRID);
    expect(out.verdict).toEqual({ ok: false, why: 'too-short' });
    expect(out.step.crossSection).toBeNull();
  });

  it('clears a stale draft when the line is written', () => {
    const f = withLine([0, 0], [0, 1000]);
    const { step } = placeHere(placing('a', { draft: { a: [7, 7], b: null } }), [500, 0], CS, f, GRID);
    expect(step.state.draft).toEqual({ a: null, b: null });
  });
});

describe('Swap', () => {
  it('exchanges A and B, drops the preset and the probe, and switches the section on', () => {
    const f = withLine([-1000, 0], [1000, 0], 'preset', { preset: 'along' });
    const step = swapEnds({ ...initialSliceToolState(), probe: { s: 10, z: 10 } }, { ...CS, preset: 'along', field: 'up' }, f);
    expect(step.crossSection).toMatchObject({ enabled: true, a: [1000, 0], b: [-1000, 0], preset: null, field: 'up' });
    expect(step.state.probe).toBeNull();
    expect(step.say).toBe('A and B swapped.');
  });

  it('swapping twice gives the original line', () => {
    const f = withLine([0, 0], [0, 1000]);
    const once = swapEnds(initialSliceToolState(), CS, f).crossSection!;
    const again = swapEnds(initialSliceToolState(), once, withLine(once.a!, once.b!)).crossSection!;
    expect(again).toMatchObject({ a: [0, 0], b: [0, 1000] });
  });

  it('does nothing without a line, and a half-placed line cannot be swapped', () => {
    const s = { ...initialSliceToolState(), draft: { a: [0, 0] as SlicePoint, b: null } };
    const step = swapEnds(s, CS, EMPTY);
    expect(step.state).toBe(s);
    expect(step.crossSection).toBeNull();
  });
});

describe('presets', () => {
  it('Me to fire is offered only with a position fix inside the model area', () => {
    expect(presetStatuses(null, 'ok').me).toEqual({ ok: true });
    expect(presetStatuses(null, 'none').me).toEqual({ ok: false, issue: 'no-user' });
    expect(presetStatuses(null, 'outside').me).toEqual({ ok: false, issue: 'no-user' });
    for (const id of ['along', 'across', 'slope'] as const) expect(presetStatuses(null, 'none')[id]).toEqual({ ok: true });
  });

  it('the scene\'s own statuses win once it has them', () => {
    const live = { along: { ok: false, issue: 'calm' }, across: { ok: false, issue: 'calm' }, slope: { ok: true }, me: { ok: true } } as Record<SlicePresetId, SlicePresetStatus>;
    expect(presetStatuses(live, 'none')).toBe(live);
  });

  it('has the four buttons in order with the plan\'s names and a reason on each disabled one', () => {
    const views = presetViews({ ...allOk(), me: { ok: false, issue: 'no-user' }, along: { ok: false, issue: 'calm' } }, 'slope', 'none', 300);
    expect(views.map((v) => v.label)).toEqual(['Along the wind', 'Across the wind', 'Up the slope', 'Me to fire']);
    expect(views.map((v) => v.id)).toEqual([...SLICE_PRESET_IDS]);
    expect(views.map((v) => v.disabled)).toEqual([true, false, false, true]);
    expect(views[0]!.reason).toBe('The wind is calm, so it has no direction yet');
    expect(views[3]!.reason).toBe('This run has no position for you');
    expect(views[1]!.reason).toBeNull();
    expect(views.filter((v) => v.active).map((v) => v.id)).toEqual(['slope']);
  });

  it('the reason of a phone outside the model area says so', () => {
    const views = presetViews(presetStatuses(null, 'outside'), null, 'outside', 300);
    expect(views.find((v) => v.id === 'me')!.reason).toBe('You are outside the model area');
  });

  it('every disabled reason the scene can send is worded (no preset is disabled without words)', () => {
    for (const issue of ['too-short', 'outside-model', 'no-user', 'no-fire', 'flat-ground', 'calm'] as const) {
      const st = { ...allOk(), along: { ok: false, issue } } as Record<SlicePresetId, SlicePresetStatus>;
      expect(presetViews(st, null, 'ok', 300)[0]!.reason).toBeTruthy();
    }
  });

  it('choosing a preset writes the live line: a and b undefined, the preset, the section on, Speed first, and clears the rest', () => {
    const s = placing('a', { candidate: [1, 1], draft: { a: [5, 5], b: null }, probe: { s: 1, z: 1 } });
    const step = choosePreset(s, { ...CS, a: [0, 0], b: [0, 500] }, 'along', { ok: true });
    expect(step.crossSection).toMatchObject({ enabled: true, preset: 'along', a: undefined, b: undefined, field: 'speed' });
    expect(step.crossSection && 'a' in step.crossSection && 'b' in step.crossSection).toBe(true); // explicit undefined: a spread keeps it
    expect(step.state).toMatchObject({ placing: null, candidate: null, draft: { a: null, b: null }, probe: null });
    expect(step.say).toBe('Slice along the wind, through the fire.');
  });

  it('a preset keeps the chosen field and the compass settings', () => {
    const step = choosePreset(initialSliceToolState(), { ...CS, field: 'smoke', azimuth: 77 }, 'me', { ok: true });
    expect(step.crossSection).toMatchObject({ field: 'smoke', azimuth: 77, preset: 'me' });
  });

  it('a preset that cannot be made changes nothing', () => {
    const s = initialSliceToolState();
    const step = choosePreset(s, CS, 'me', { ok: false, issue: 'no-user' });
    expect(step.state).toBe(s);
    expect(step.crossSection).toBeNull();
  });

  it('each preset has its own sentence for the screen reader', () => {
    const said = SLICE_PRESET_IDS.map((id) => choosePreset(initialSliceToolState(), CS, id, { ok: true }).say);
    expect(new Set(said).size).toBe(4);
  });
});

describe('the field and the switches', () => {
  it('a chip writes the field only when it changes', () => {
    expect(fieldWrite({ ...CS, field: 'speed' }, 'speed')).toBeNull();
    expect(fieldWrite(CS, 'speed')).toMatchObject({ field: 'speed' }); // no field stored yet: the legacy colouring is replaced
    expect(fieldWrite({ ...CS, a: [0, 0], b: [0, 1000], field: 'speed' }, 'theta')).toMatchObject({ a: [0, 0], b: [0, 1000], field: 'theta' });
  });

  it('the probe and the model-cells switch change the state only when they change', () => {
    const s = initialSliceToolState();
    const probe = { s: 100, z: 900 };
    expect(withProbe(s, null)).toBe(s);
    expect(withProbe(s, probe).probe).toBe(probe);
    expect(withShowCells(s, false)).toBe(s);
    expect(withShowCells(s, true).showCells).toBe(true);
  });
});

describe('the controls: buttons and the quiet line', () => {
  const input = (over: Partial<ControlsInput> = {}): ControlsInput => ({ state: initialSliceToolState(), facts: EMPTY, presets: allOk(), fix: 'ok', verdict: null, ...over });

  it('idle with nothing placed says nothing, offers every preset and cannot Swap', () => {
    const v = controlsView(input());
    expect(v).toMatchObject({ placing: null, next: null, hint: '', swapDisabled: true });
    expect(v.presets.every((p) => !p.disabled)).toBe(true);
  });

  it('with a line Swap is enabled and no end is marked as next', () => {
    const v = controlsView(input({ facts: withLine([0, 0], [0, 1000]) }));
    expect(v.swapDisabled).toBe(false);
    expect(v.next).toBeNull();
  });

  it('with one end placed it says which end is next', () => {
    const a = controlsView(input({ state: { ...initialSliceToolState(), draft: { a: [0, 0], b: null } } }));
    expect(a.next).toBe('b');
    expect(a.hint).toBe('Start (A) is set. Now set the end (B).');
    const b = controlsView(input({ state: { ...initialSliceToolState(), draft: { a: null, b: [0, 0] } } }));
    expect(b.next).toBe('a');
    expect(b.hint).toBe('End (B) is set. Now set the start (A).');
  });

  it('while placing it names the end on the button and tells how to place', () => {
    const v = controlsView(input({ state: placing('b'), verdict: { ok: true } }));
    expect(v.placing).toBe('b');
    expect(v.place).toEqual({ label: 'Place B here', disabled: false });
    expect(v.hint).toBe('Move the map until the cross is over the end (B), then press Place B here. You can also tap the map.');
  });

  it('with a tapped candidate the line is about confirming it', () => {
    const v = controlsView(input({ state: placing('a', { candidate: [1, 1] }), verdict: { ok: true } }));
    expect(v.hint).toBe('The mark shows where A will go. Press Place A here, or tap the map to move it.');
  });

  it('disables Place with the reason when the cross is not over the map, outside the model, or too close', () => {
    const sky = controlsView(input({ state: placing('a'), verdict: { ok: false, why: 'no-ground' } }));
    expect(sky.place.disabled).toBe(true);
    expect(sky.hint).toBe('Move the cross over the map');
    const short = controlsView(input({ state: placing('a'), facts: withLine([0, 0], [0, 1000]), verdict: { ok: false, why: 'too-short' } }));
    expect(short.place.disabled).toBe(true);
    expect(short.hint).toBe('Make the line longer than 300 m');
    const tapped = controlsView(input({ state: placing('a', { candidate: [9000, 0] }), verdict: { ok: false, why: 'outside' } }));
    expect(tapped.hint).toBe('That spot is outside the model area');
  });

  it('idle, a line the scene could not draw says why, in plain words', () => {
    const v = controlsView(input({ facts: { ...EMPTY, source: 'preset', preset: 'along', issue: 'calm' } }));
    expect(v.hint).toBe('The wind is calm, so it has no direction yet');
    expect(controlsView(input({ facts: { ...EMPTY, issue: 'too-short', minLengthM: 266 } })).hint).toBe('Make the line longer than 300 m');
  });

  it('a clipped line and a preset without a fire say so quietly', () => {
    expect(controlsView(input({ facts: withLine([0, 0], [0, 1000], 'preset', { notes: ['clipped'] }) })).hint).toBe('Shown to the edge of the model area');
    expect(controlsView(input({ facts: withLine([0, 0], [0, 1000], 'preset', { notes: ['no-fire-centred-on-map'] }) })).hint).toBe('No fire yet: centred on the map');
    expect(controlsView(input({ facts: withLine([0, 0], [0, 1000], 'preset', { notes: ['clipped', 'no-fire-centred-on-map'] }) })).hint).toBe('Shown to the edge of the model area. No fire yet: centred on the map');
  });

  it('while the run switches to the 3-D atmosphere the line says it is re-computing', () => {
    expect(controlsView(input({ switching3d: true })).hint).toBe('Re-computing with the 3-D atmosphere from the last checkpoint. Press Play to continue.');
  });

  it('marks the preset in force and disables Me to fire without a fix, with its reason', () => {
    const v = controlsView(input({ facts: withLine([0, 0], [0, 1000], 'preset', { preset: 'across' }), presets: presetStatuses(null, 'none'), fix: 'none' }));
    expect(v.presets.find((p) => p.active)?.id).toBe('across');
    const me = v.presets.find((p) => p.id === 'me')!;
    expect(me).toMatchObject({ disabled: true, reason: 'This run has no position for you' });
  });
});

describe('the marks on the map', () => {
  it('shows nothing before anything is placed, and no state at all shows nothing', () => {
    expect(sliceMarks(initialSliceToolState(), EMPTY)).toEqual([]);
    expect(sliceMarks(undefined, EMPTY)).toEqual([]);
    expect(marksAreLive(initialSliceToolState(), EMPTY)).toBe(false);
  });

  it('shows a draft end on its own', () => {
    const s = { ...initialSliceToolState(), draft: { a: [10, 20] as SlicePoint, b: null } };
    expect(sliceMarks(s, EMPTY)).toEqual([{ kind: 'sliceA', at: [10, 20], pending: false }]);
    expect(marksAreLive(s, EMPTY)).toBe(true);
  });

  it('shows the line with A and B (the line under the ends)', () => {
    const marks = sliceMarks(initialSliceToolState(), withLine([0, 0], [0, 1000]));
    expect(marks.map((m) => m.kind)).toEqual(['slice', 'sliceA', 'sliceB']);
    expect(marks[0]).toEqual({ kind: 'slice', from: [0, 0], to: [0, 1000] });
  });

  it('the line wins over a stale draft', () => {
    const s = { ...initialSliceToolState(), draft: { a: [99, 99] as SlicePoint, b: null } };
    expect(sliceMarks(s, withLine([0, 0], [0, 1000])).filter((m) => m.kind === 'sliceA')).toEqual([{ kind: 'sliceA', at: [0, 0], pending: false }]);
  });

  it('shows the tapped candidate as a pending mark of the end being placed', () => {
    const marks = sliceMarks(placing('b', { candidate: [300, 400] }), EMPTY);
    expect(marks).toEqual([{ kind: 'sliceB', at: [300, 400], pending: true }]);
  });

  it('a candidate left behind after placing is not drawn', () => {
    expect(sliceMarks({ ...initialSliceToolState(), candidate: [1, 1] }, EMPTY)).toEqual([]);
  });

  it('shows the probe pin at a + dir * s of the line', () => {
    const marks = sliceMarks({ ...initialSliceToolState(), probe: { s: 250, z: 800 } }, withLine([0, 0], [0, 1000]));
    expect(marks.at(-1)).toEqual({ kind: 'probe', at: [0, 250] });
  });

  it('no probe pin without a line', () => {
    expect(sliceMarks({ ...initialSliceToolState(), probe: { s: 250, z: 800 } }, EMPTY)).toEqual([]);
  });
});

describe('the tool agrees with the pure resolver of the scene (render/slice/sectionLine.ts)', () => {
  const G: GridSpec = { nx: 46, ny: 46, cellSize: 133, x0: -3000, y0: -3000, origin: { lat: -33.7, lon: 150.3 } };

  it('the shortest line is the resolver\'s, in the words as well', () => {
    const r = resolveSlice({ azimuth: 0, centre: [0, 0], preset: null }, ctxOf(G));
    expect(minLengthFor(G)).toBe(r.minLengthM);
    expect(roundUp50(r.minLengthM)).toBe(300); // two 133 m cells are 266 m: the words say 300
  });

  it('"Place here" is refused exactly when the resolver would call the line too short', () => {
    const f: LineFacts = { ...EMPTY, minLengthM: minLengthFor(G) };
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const stored = (p: SlicePoint): SlicePoint => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]; // ends are kept to 0.1 m
    const inside = (): SlicePoint => stored([-2900 + rnd() * 5800, -2900 + rnd() * 5800]);
    let refused = 0;
    for (let i = 0; i < 400; i++) {
      const a = inside();
      // Points around the limit as well as far from it.
      const ang = rnd() * Math.PI * 2;
      const d = i % 2 ? 150 + rnd() * 900 : 299.5 + rnd();
      const b: SlicePoint = [a[0] + Math.cos(ang) * d, a[1] + Math.sin(ang) * d];
      if (!inModelArea(b, G)) continue;
      const verdict = placeVerdict('b', b, { ...placing('b'), draft: { a, b: null } }, f, G);
      const r = sectionFromEndpoints(stored(a), stored(b), G);
      if (!verdict.ok) refused++;
      expect(verdict.ok, `a=${a} b=${b} d=${d}`).toBe(r.issue === null);
    }
    expect(refused).toBeGreaterThan(50);
  });

  it('a point the resolver clips or misses is refused as outside the model area', () => {
    const f = withLine([0, 0], [0, 1000], 'endpoints', { minLengthM: 300 });
    for (const p of [[2985.1, 0], [-3000.1, 0], [0, 4000], [100000, 100000]] as SlicePoint[]) {
      expect(placeVerdict('a', p, placing('a'), f, G)).toEqual({ ok: false, why: 'outside' });
      expect(sectionFromEndpoints(p, [0, 1000], G).clipped || sectionFromEndpoints(p, [0, 1000], G).issue !== null).toBe(true);
    }
    for (const p of [[2984.9, 0], [-3000, 0], [0, 2985]] as SlicePoint[]) expect(placeVerdict('a', p, placing('a'), f, G).ok).toBe(true);
  });

  it('what the tool shows for Me to fire before there is a slice never disables a preset the resolver would allow', () => {
    for (const user of [null, [9000, 0], [100, 100]] as (SlicePoint | null)[]) {
      for (const fire of [null, [0, 0]] as (SlicePoint | null)[]) {
        const real = slicePresetStatus('me', { ...ctxOf(G), user, fire });
        const shown = presetStatuses(null, userFixOf(user, G)).me;
        if (real.ok) expect(shown.ok).toBe(true);
        if (!shown.ok) expect(real.ok).toBe(false);
      }
    }
    // The one gap: with a fix inside the area and no fire the resolver says no-fire, which only an update can tell.
    expect(slicePresetStatus('me', { ...ctxOf(G), user: [100, 100], fire: null })).toEqual({ ok: false, issue: 'no-fire' });
    expect(presetStatuses(null, 'ok').me).toEqual({ ok: true });
  });

  it('every reason the resolver can give a preset or a line has words', () => {
    const issues = new Set<string>();
    for (const preset of ['along', 'across', 'slope', 'me'] as const) {
      for (const over of [{}, { windFromDeg: null }, { fire: null }, { user: null }, { heightAt: () => 100 }, { mapCentre: [99999, 0] as SlicePoint, fire: null }]) {
        const r = resolveSlice({ azimuth: 0, centre: [0, 0], preset }, { ...ctxOf(G), ...over });
        if (r.issue) issues.add(r.issue);
      }
    }
    expect([...issues].sort()).toEqual(['calm', 'flat-ground', 'no-fire', 'no-user', 'outside-model']);
    for (const i of issues) expect(issueWords(i as Parameters<typeof issueWords>[0], 300).length).toBeGreaterThan(10);
  });
});

describe('the marks on the screen', () => {
  /** 1 px per 10 m, y up on the map and down on the screen. */
  const project = (p: SlicePoint): [number, number] | null => (Math.abs(p[0]) > 5000 ? null : [p[0] / 10, -p[1] / 10]);

  it('projects the ends, the pending mark and the probe, half a pixel at a time', () => {
    const marks = sliceMarks({ ...placing('b', { candidate: [333, 777], probe: { s: 250, z: 800 } }) }, withLine([0, 0], [0, 1000]));
    const out = sliceAnnotationMarks(marks, project);
    expect(out.find((m) => m.kind === 'sliceA')).toEqual({ kind: 'sliceA', at: [0, -0], pending: false });
    expect(out.find((m) => m.kind === 'sliceB' && !m.pending)).toEqual({ kind: 'sliceB', at: [0, -100], pending: false });
    expect(out.find((m) => m.kind === 'sliceB' && m.pending)).toEqual({ kind: 'sliceB', at: [33.5, -77.5], pending: true });
    expect(out.find((m) => m.kind === 'probe')).toEqual({ kind: 'probe', at: [0, -25] });
  });

  it('draws the line as one path through the sampled ground points, from A to B', () => {
    const [line] = sliceAnnotationMarks([{ kind: 'slice', from: [0, 0], to: [0, 1500] }], project) as [{ kind: 'slice'; d: string }];
    const pts = line.d.split(' ');
    expect(pts).toHaveLength(LINE_PROJECTION_POINTS);
    expect(pts[0]).toMatch(/^M0,/);
    expect(pts.slice(1).every((p) => p.startsWith('L'))).toBe(true);
    expect(pts.at(-1)).toBe('L0,-150');
  });

  it('breaks the line where it leaves the screen and leaves off marks that are off the screen', () => {
    const [line] = sliceAnnotationMarks([{ kind: 'slice', from: [-9000, 0], to: [0, 0] }], project) as [{ kind: 'slice'; d: string }];
    expect(line.d.split(' ').filter((p) => p.startsWith('M'))).toHaveLength(1); // starts again where the line comes back on
    expect(line.d.startsWith('M')).toBe(true);
    expect(sliceAnnotationMarks([{ kind: 'sliceA', at: [9000, 0], pending: false }, { kind: 'probe', at: [9000, 0] }], project)).toEqual([]);
    expect(sliceAnnotationMarks([{ kind: 'slice', from: [9000, 0], to: [9500, 0] }], project)).toEqual([]);
  });

  it('gives the same data twice for the same picture (so simScreen can skip the rebuild)', () => {
    const marks = sliceMarks(initialSliceToolState(), withLine([0, 0], [0, 1000]));
    expect(JSON.stringify(sliceAnnotationMarks(marks, project))).toBe(JSON.stringify(sliceAnnotationMarks(marks, project)));
  });
});
