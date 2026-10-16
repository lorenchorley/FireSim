/**
 * The Air slices tool's placement model (workstream D, plan §8.1 to §8.3): pure, no DOM, unit-tested (sliceToolModel.test.ts).
 * It is the state machine over `SliceToolState` (sliceTypes.ts) and the words of the tool: which step the person is on (placing
 * A or B, a tapped candidate, a draft end waiting for the other), which of the four presets can be tapped and why not, what
 * "Place here" may do with the point it has, what to write into `LayerState.crossSection`, the quiet line under the buttons, and
 * the marks the map shows. The DOM files (sliceTool.ts, simScreen.ts) only apply the results.
 *
 * Line-writing rules (render/slice/types.ts `SliceLineState`, render/layers.ts):
 *   - `a` and `b` are written together or not at all. The first placement of a line the tool does not have yet keeps the placed
 *     end in `draft` until the other exists; re-placing one end of a line that exists (hand-placed or a preset's) writes both
 *     ends (the other from the resolved line). The original curtain's chord (`source: 'centre'`) is not the tool's line.
 *   - Whoever writes `a` and `b` writes `preset: null`; a preset writes `a: undefined, b: undefined`; the first line also writes
 *     `field: 'speed'` (an existing `field` is never changed here).
 *   - Every line write clears the probe, the candidate and the draft, and switches the section on.
 */
import type { GridSpec } from '../../../core/grid';
import type { LayerState } from '../../../render/layers';
import { sameLine } from '../../../render/sliceFields';
import {
  SLICE_MIN_LENGTH_CELLS,
  SLICE_MIN_LENGTH_M,
  SLICE_PRESET_IDS,
  type ResolvedSlice,
  type SliceFieldId,
  type SliceIssue,
  type SliceNote,
  type SlicePoint,
  type SlicePresetId,
  type SlicePresetStatus,
  type SliceProbePos,
  type SliceRecordingStatus,
  type SliceUpdate,
} from '../../../render/slice/types';
import type { SlicePlacing, SliceToolState } from './sliceTypes';

export type CrossSection = LayerState['crossSection'];
/** One end of the line: A (left in the side view) or B. */
export type SliceEnd = 'a' | 'b';

// ─────────────────────────────────────────────────────────────────────────────
// Words
// ─────────────────────────────────────────────────────────────────────────────

export const AIR_TOOL_LABEL = 'Air slices';
export const AIR_PANEL_TITLE = 'Air slice';
export const AIR_PANEL_SUBTITLE = 'Side view';
export const NEEDS_3D_VIEW = 'The side view needs the 3-D view.';
export const LOADING_LINE = 'Loading the side view';
export const LOAD_FAILED_LINE = 'The side view could not be loaded.';
export const LOAD_FAILED_AGAIN_LINE = 'The side view could not be loaded. Close and reopen FireSim to load it.';
export const RETRY_LABEL = 'Try again';

/**
 * What the tool says when the side view's chunk did not arrive, by how many times it has failed. The first failure offers "Try again"
 * (a network that came back); a failed retry says to reopen the app instead and offers no button: a browser remembers a module that
 * failed to load and fails the same import again, so on the web a second try cannot recover (plan 17.4).
 */
export function loadFailedView(failures: number): { line: string; retry: boolean } {
  return failures >= 2 ? { line: LOAD_FAILED_AGAIN_LINE, retry: false } : { line: LOAD_FAILED_LINE, retry: true };
}
export const SWITCHING_3D_LINE = 'Re-computing with the 3-D atmosphere from the last checkpoint. Press Play to continue.';

export const SET_LABEL: Record<SliceEnd, string> = { a: 'Set start (A)', b: 'Set end (B)' };
export const PLACE_LABEL: Record<SliceEnd, string> = { a: 'Place A here', b: 'Place B here' };
export const SWAP_LABEL = 'Swap';
export const CANCEL_LABEL = 'Cancel';
export const PRESETS_LABEL = 'Presets';
/** The time-lapse recording's two buttons (0.4.1) and what the screen reader hears when they are pressed. */
export const KEEP_LABEL = 'Keep this line';
export const CLEAR_RECORDING_LABEL = 'Clear recording';
export const KEEP_SAY = 'Line kept. Recording from the next picture.';
export const CLEAR_SAY = 'Recording cleared. Recording again from the next picture.';
const END_WORD: Record<SliceEnd, string> = { a: 'the start (A)', b: 'the end (B)' };

export const PRESET_LABEL: Record<SlicePresetId, string> = { along: 'Along the wind', across: 'Across the wind', slope: 'Up the slope', me: 'Me to fire' };
const PRESET_SAY: Record<SlicePresetId, string> = {
  along: 'Slice along the wind, through the fire.',
  across: 'Slice across the wind, through the fire.',
  slope: 'Slice up the slope, through the fire.',
  me: 'Slice from you to the fire.',
};

export const NOTE_WORDS: Record<SliceNote, string> = {
  clipped: 'Shown to the edge of the model area',
  'no-fire-centred-on-map': 'No fire yet: centred on the map',
};

/** The shortest line the words promise: the model's minimum rounded UP to 50 m ("Make the line longer than 300 m"). */
export function roundUp50(m: number): number {
  return Math.max(50, Math.ceil(m / 50 - 1e-9) * 50);
}

/** The model's shortest line when no resolved slice says (the same rule as the pure resolver: max(300 m, 2 cells)). */
export function minLengthFor(grid: GridSpec | null): number {
  return Math.max(SLICE_MIN_LENGTH_M, SLICE_MIN_LENGTH_CELLS * (grid?.cellSize ?? 0));
}

/** Where the phone is against the model area: no fix, a fix outside it, or inside it (what "Me to fire" needs). */
export type UserFix = 'none' | 'outside' | 'ok';

export function userFixOf(user: SlicePoint | null, grid: GridSpec | null): UserFix {
  if (!user) return 'none';
  return grid && !inModelArea(user, grid) ? 'outside' : 'ok';
}

/** The plain-words reason a line cannot be drawn or a preset cannot be tapped (a `SliceIssue` code from the pure resolver). */
export function issueWords(issue: SliceIssue, minLengthM: number, fix: UserFix = 'ok'): string {
  switch (issue) {
    case 'too-short':
      return `Make the line longer than ${roundUp50(minLengthM)} m`;
    case 'outside-model':
      return 'The line is outside the model area';
    case 'no-user':
      return fix === 'outside' ? 'You are outside the model area' : 'This run has no position for you';
    case 'no-fire':
      return 'There is no fire to go to yet';
    case 'flat-ground':
      return 'The ground here is too flat to have an uphill direction';
    case 'calm':
      return 'The wind is calm, so it has no direction yet';
  }
}

/**
 * The reason a preset cannot be drawn. The words of `issueWords`, except "too short": "Make the line longer" is for a line the
 * person placed. A preset comes out too short because of where the phone or the fire is (the fire near a corner of the model, the
 * phone within a model cell or two of the fire), and nobody can lengthen that.
 */
export function presetIssueWords(id: SlicePresetId, issue: SliceIssue, minLengthM: number, fix: UserFix = 'ok'): string {
  if (issue === 'too-short') return id === 'me' ? `You are less than ${roundUp50(minLengthM)} m from the fire` : 'Too near the edge of the model area for a line this long';
  return issueWords(issue, minLengthM, fix);
}

// ─────────────────────────────────────────────────────────────────────────────
// Geometry
// ─────────────────────────────────────────────────────────────────────────────

/** True when the point lies inside the model rectangle (the node extent of the model grid). */
export function inModelArea(p: SlicePoint, grid: GridSpec): boolean {
  const x1 = grid.x0 + (grid.nx - 1) * grid.cellSize;
  const y1 = grid.y0 + (grid.ny - 1) * grid.cellSize;
  return p[0] >= grid.x0 && p[0] <= x1 && p[1] >= grid.y0 && p[1] <= y1;
}

const r1 = (v: number): number => Math.round(v * 10) / 10;
/** A placed point is kept to 0.1 m (the layers store holds tidy numbers). */
const tidy = (p: SlicePoint): SlicePoint => [r1(p[0]), r1(p[1])];

/** Evenly spaced ground points from `from` to `to` (both included), for drawing the line on the terrain. */
export function alongPoints(from: SlicePoint, to: SlicePoint, n: number): SlicePoint[] {
  const k = Math.max(2, Math.floor(n));
  const out: SlicePoint[] = [];
  for (let i = 0; i < k; i++) {
    const t = i / (k - 1);
    out.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]);
  }
  return out;
}

/** The map point of the probe: `a + dir * s` (types.ts SliceProbePos), `s` kept inside the line; null for a line without length. */
export function probeMapPoint(line: { a: SlicePoint; b: SlicePoint }, pos: SliceProbePos): SlicePoint | null {
  const dx = line.b[0] - line.a[0];
  const dy = line.b[1] - line.a[1];
  const len = Math.hypot(dx, dy);
  if (!(len > 0)) return null;
  const s = Math.max(0, Math.min(len, pos.s));
  return [line.a[0] + (dx / len) * s, line.a[1] + (dy / len) * s];
}

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

export function initialSliceToolState(): SliceToolState {
  return { tab: 'side', placing: null, candidate: null, draft: { a: null, b: null }, probe: null, showCells: false };
}

/** The tool opens again: a placement that was under way is dropped (the line, draft, probe and switches stay). */
export function reopened(s: SliceToolState): SliceToolState {
  return s.placing || s.candidate ? { ...s, placing: null, candidate: null } : s;
}

/** What one user action does: the new tool state, the new `crossSection` to write (null: the layers do not change), and a short sentence for the screen reader. */
export interface ToolStep {
  state: SliceToolState;
  crossSection: CrossSection | null;
  say: string | null;
}

const noStep = (state: SliceToolState): ToolStep => ({ state, crossSection: null, say: null });

// ─────────────────────────────────────────────────────────────────────────────
// The line as the tool sees it
// ─────────────────────────────────────────────────────────────────────────────

/** What the tool needs to know about the line in force (from the scene's resolved slice, or, before it has one, from the stored `crossSection`). */
export interface LineFacts {
  /** The line, A to B, or null when none can be drawn (or the scene has not said yet). */
  line: { a: SlicePoint; b: SlicePoint } | null;
  /** Which rule of `SliceLineState` made it: 'centre' is the original curtain's chord, which the tool does not treat as its own line. */
  source: ResolvedSlice['source'] | null;
  preset: SlicePresetId | null;
  issue: SliceIssue | null;
  notes: readonly SliceNote[];
  /** The shortest line allowed in this model (m). */
  minLengthM: number;
}

export function lineFacts(resolved: Pick<ResolvedSlice, 'line' | 'source' | 'preset' | 'issue' | 'notes' | 'minLengthM'> | null | undefined, cs: CrossSection, grid: GridSpec | null): LineFacts {
  if (resolved) {
    return {
      line: resolved.line ? { a: resolved.line.a, b: resolved.line.b } : null,
      source: resolved.source,
      preset: resolved.preset,
      issue: resolved.issue,
      notes: resolved.notes,
      minLengthM: resolved.minLengthM,
    };
  }
  // No slice yet (the section is off, or the first snapshot has not come): what is stored says what the line will be.
  const minLengthM = minLengthFor(grid);
  if (cs.preset) return { line: null, source: 'preset', preset: cs.preset, issue: null, notes: [], minLengthM };
  if (cs.a && cs.b) return { line: { a: cs.a, b: cs.b }, source: 'endpoints', preset: null, issue: null, notes: [], minLengthM };
  return { line: null, source: cs.enabled ? 'centre' : null, preset: null, issue: null, notes: [], minLengthM };
}

/** The line the tool owns (hand-placed or a preset's), or null. */
export function ownLine(facts: LineFacts): { a: SlicePoint; b: SlicePoint } | null {
  return facts.line && facts.source !== 'centre' ? facts.line : null;
}

/** The section holds a line of the tool's (so opening the tool shows it again after the Layers panel switched it off). */
export function hasStoredLine(cs: CrossSection): boolean {
  return !!cs.preset || !!(cs.a && cs.b);
}

// ─────────────────────────────────────────────────────────────────────────────
// Presets
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Which presets can be tapped. The scene's update is authoritative (it knows the wind, the fire and the ground); before
 * there is one (the section has never been on) only what the tool itself can see is known: "Me to fire" needs a phone
 * position inside the model area and a fire to go to (`fire`: there is one at the shown time), and the others are offered.
 * The same order as the resolver's: no position first, then no fire.
 */
export function presetStatuses(presets: Record<SlicePresetId, SlicePresetStatus> | null | undefined, fix: UserFix, fire = true): Record<SlicePresetId, SlicePresetStatus> {
  if (presets) return presets;
  const out = {} as Record<SlicePresetId, SlicePresetStatus>;
  for (const id of SLICE_PRESET_IDS) out[id] = { ok: true };
  if (fix !== 'ok') out.me = { ok: false, issue: 'no-user' };
  else if (!fire) out.me = { ok: false, issue: 'no-fire' };
  return out;
}

export interface PresetView {
  id: SlicePresetId;
  label: string;
  disabled: boolean;
  /** The plain-words reason it cannot be tapped (shown under the button), or null. */
  reason: string | null;
  /** This preset is the line in force. */
  active: boolean;
}

export function presetViews(statuses: Record<SlicePresetId, SlicePresetStatus>, active: SlicePresetId | null, fix: UserFix, minLengthM: number): PresetView[] {
  return SLICE_PRESET_IDS.map((id) => {
    const st = statuses[id];
    return { id, label: PRESET_LABEL[id], disabled: !st.ok, reason: st.ok ? null : presetIssueWords(id, st.issue, minLengthM, fix), active: active === id };
  });
}

/** A preset was tapped: the line becomes that preset (live: it follows the wind, the fire and the phone), nothing else is kept of the old one. */
export function choosePreset(s: SliceToolState, cs: CrossSection, id: SlicePresetId, status: SlicePresetStatus): ToolStep {
  if (!status.ok) return noStep(s);
  return {
    state: { ...s, placing: null, candidate: null, draft: { a: null, b: null }, probe: null },
    crossSection: { ...cs, enabled: true, a: undefined, b: undefined, preset: id, field: cs.field ?? 'speed' },
    say: PRESET_SAY[id],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Placing
// ─────────────────────────────────────────────────────────────────────────────

/** "Set start (A)" or "Set end (B)": the crosshair shows and the next "Place here" is this end. */
export function startPlacing(s: SliceToolState, end: SliceEnd): ToolStep {
  const place = PLACE_LABEL[end];
  return { state: { ...s, placing: end, candidate: null }, crossSection: null, say: `Placing ${END_WORD[end]}. Move the map under the cross, then press ${place}.` };
}

export function cancelPlacing(s: SliceToolState): ToolStep {
  return { state: s.placing || s.candidate ? { ...s, placing: null, candidate: null } : s, crossSection: null, say: s.placing ? 'Placing cancelled.' : null };
}

/** A tap on the map while placing: the tapped point waits in `candidate` until "Place here". Outside placing a tap does nothing. */
export function tapCandidate(s: SliceToolState, p: SlicePoint): SliceToolState {
  return s.placing ? { ...s, candidate: tidy(p) } : s;
}

/** Android Back and Escape while a placement is under way drop the placement and leave the tool open; null: nothing to undo here. */
export function backStep(s: SliceToolState | undefined): ToolStep | null {
  return s?.placing ? cancelPlacing(s) : null;
}

export type PlaceVerdict = { ok: true } | { ok: false; why: 'no-ground' | 'outside' | 'too-short' };

/** The end that stays where it is while `end` is placed: the line's, or the draft's. */
function otherEnd(end: SliceEnd, s: SliceToolState, facts: LineFacts): SlicePoint | null {
  const other: SliceEnd = end === 'a' ? 'b' : 'a';
  const own = ownLine(facts);
  return own ? own[other] : s.draft[other];
}

/**
 * Whether "Place here" may use `point` for `end`: over the ground (the crosshair can point at the sky), inside the model area,
 * and not closer than the shortest line to the other end.
 */
export function placeVerdict(end: SliceEnd, point: SlicePoint | null, s: SliceToolState, facts: LineFacts, grid: GridSpec | null): PlaceVerdict {
  if (!point) return { ok: false, why: 'no-ground' };
  const p = tidy(point); // judged as it will be stored
  if (grid && !inModelArea(p, grid)) return { ok: false, why: 'outside' };
  const other = otherEnd(end, s, facts);
  if (other && Math.hypot(p[0] - other[0], p[1] - other[1]) + 1e-6 < facts.minLengthM) return { ok: false, why: 'too-short' };
  return { ok: true };
}

/** The words of a refusal. `fromTap`: the point came from a tap on the map and not from the crosshair. */
export function placeWords(v: Extract<PlaceVerdict, { ok: false }>, minLengthM: number, fromTap = false): string {
  if (v.why === 'too-short') return issueWords('too-short', minLengthM);
  if (v.why === 'outside' && fromTap) return 'That spot is outside the model area';
  return 'Move the cross over the map';
}

/**
 * "Place A here" / "Place B here": the confirmed point is the tapped candidate when there is one, else the crosshair's. Writes the
 * line when both ends are known (see the file comment), else keeps the end in `draft`. A refused point changes nothing.
 */
export function placeHere(s: SliceToolState, point: SlicePoint | null, cs: CrossSection, facts: LineFacts, grid: GridSpec | null): { step: ToolStep; verdict: PlaceVerdict } {
  const end = s.placing;
  if (!end) return { step: noStep(s), verdict: { ok: false, why: 'no-ground' } };
  const verdict = placeVerdict(end, point, s, facts, grid);
  if (!verdict.ok || !point) return { step: noStep(s), verdict };
  const p = tidy(point);
  const own = ownLine(facts);
  const done = (a: SlicePoint, b: SlicePoint): ToolStep => ({
    state: { ...s, placing: null, candidate: null, draft: { a: null, b: null }, probe: null },
    crossSection: { ...cs, enabled: true, a, b, preset: null, field: cs.field ?? 'speed' },
    say: own ? `${end === 'a' ? 'Start (A)' : 'End (B)'} moved. The side view follows the new line.` : 'Line placed. The side view shows it.',
  });
  if (own) return { step: end === 'a' ? done(p, own.b) : done(own.a, p), verdict };
  const draft = { ...s.draft, [end]: p };
  if (draft.a && draft.b) return { step: done(draft.a, draft.b), verdict };
  return {
    step: { state: { ...s, placing: null, candidate: null, draft }, crossSection: null, say: `${end === 'a' ? 'Start (A)' : 'End (B)'} placed. Now set ${END_WORD[end === 'a' ? 'b' : 'a']}.` },
    verdict,
  };
}

/** "Swap": A and B change places (the side view flips left and right). A preset becomes the fixed line it was. */
export function swapEnds(s: SliceToolState, cs: CrossSection, facts: LineFacts): ToolStep {
  const line = facts.line;
  if (!line) return noStep(s);
  return {
    state: { ...s, placing: null, candidate: null, draft: { a: null, b: null }, probe: null },
    crossSection: { ...cs, enabled: true, a: line.b, b: line.a, preset: null, field: cs.field ?? 'speed' },
    say: 'A and B swapped.',
  };
}

/**
 * "Keep this line": a live preset (it follows the wind and the fire, so it is never recorded) becomes the fixed line it is now, the same
 * way "Swap" freezes one, and the recording starts with the next picture. Nothing for any other line or for no line.
 */
export function keepLine(s: SliceToolState, cs: CrossSection, facts: LineFacts): ToolStep {
  const line = facts.line;
  if (!line || facts.source !== 'preset' || !facts.preset) return noStep(s);
  return {
    state: { ...s, placing: null, candidate: null, draft: { a: null, b: null }, probe: null },
    crossSection: { ...cs, enabled: true, a: line.a, b: line.b, preset: null, field: cs.field ?? 'speed' },
    say: KEEP_SAY,
  };
}

/** A chip was chosen (in the panel): the section is coloured by it. */
export function fieldWrite(cs: CrossSection, field: SliceFieldId): CrossSection | null {
  return cs.field === field ? null : { ...cs, field };
}

export function withProbe(s: SliceToolState, probe: SliceProbePos | null): SliceToolState {
  return s.probe === probe ? s : { ...s, probe };
}

/**
 * The line changed (the section's `prev` and `next`): the probe was put on the old line (`SliceToolState.probe`: "cleared when the line
 * changes"), so it goes. The tool's own writes clear it with the line; this is for the others: the Layers compass, "Centre on the fire"
 * and "Show me". The same state back when the line is the same (a chip, the switch) or there is no probe.
 */
export function probeAfterLineChange(s: SliceToolState | undefined, prev: CrossSection, next: CrossSection): SliceToolState | undefined {
  return s && s.probe && !sameLine(prev, next) ? { ...s, probe: null } : s;
}

export function withShowCells(s: SliceToolState, on: boolean): SliceToolState {
  return s.showCells === on ? s : { ...s, showCells: on };
}

// ─────────────────────────────────────────────────────────────────────────────
// The controls (what the buttons and the quiet line show)
// ─────────────────────────────────────────────────────────────────────────────

export interface ControlsInput {
  state: SliceToolState;
  facts: LineFacts;
  presets: Record<SlicePresetId, SlicePresetStatus>;
  fix: UserFix;
  /** What "Place here" would do with the point it has (candidate, else crosshair); null when not placing. */
  verdict: PlaceVerdict | null;
  /** The tool just asked for the 3-D atmosphere and the run has not caught up yet. */
  switching3d?: boolean;
  /** The time-lapse recorder's state (`SceneViewApi.sliceRecording.status()`), or null where there is no recorder. */
  recording?: Pick<SliceRecordingStatus, 'count'> | null;
}

export interface ControlsView {
  placing: SlicePlacing;
  /** The end whose "Set" button is the natural next step (the other end of a draft), or null. */
  next: SliceEnd | null;
  /** The label and state of "Place A/B here" (shown while placing). */
  place: { label: string; disabled: boolean };
  swapDisabled: boolean;
  presets: PresetView[];
  /** The quiet line under the buttons, '' when there is nothing to say. */
  hint: string;
  /** "Keep this line" is offered: the line in force is a live preset that can be drawn (and nothing is being placed). */
  keep: boolean;
  /** "Clear recording" is offered: the recorder holds at least one picture (and nothing is being placed). */
  clear: boolean;
}

export function controlsView(i: ControlsInput): ControlsView {
  const { state: s, facts } = i;
  const end = s.placing;
  const next: SliceEnd | null = ownLine(facts) ? null : s.draft.a && !s.draft.b ? 'b' : s.draft.b && !s.draft.a ? 'a' : null;
  return {
    placing: end,
    next,
    place: { label: end ? PLACE_LABEL[end] : PLACE_LABEL.a, disabled: !!i.verdict && !i.verdict.ok },
    swapDisabled: !facts.line,
    presets: presetViews(i.presets, facts.preset, i.fix, facts.minLengthM),
    hint: hintLine(i, next),
    keep: !end && facts.source === 'preset' && !!facts.preset && !!facts.line,
    clear: !end && (i.recording?.count ?? 0) > 0,
  };
}

function hintLine(i: ControlsInput, next: SliceEnd | null): string {
  const { state: s, facts } = i;
  if (i.switching3d) return SWITCHING_3D_LINE;
  if (s.placing) {
    if (i.verdict && !i.verdict.ok) return placeWords(i.verdict, facts.minLengthM, !!s.candidate);
    const place = PLACE_LABEL[s.placing];
    if (s.candidate) return `The mark shows where ${s.placing.toUpperCase()} will go. Press ${place}, or tap the map to move it.`;
    return `Move the map until the cross is over ${END_WORD[s.placing]}, then press ${place}. You can also tap the map.`;
  }
  if (facts.issue) return facts.preset ? presetIssueWords(facts.preset, facts.issue, facts.minLengthM, i.fix) : issueWords(facts.issue, facts.minLengthM, i.fix);
  if (facts.notes.length) return facts.notes.map((n) => NOTE_WORDS[n]).join('. ');
  if (next) return `${next === 'b' ? 'Start (A)' : 'End (B)'} is set. Now set ${END_WORD[next]}.`;
  return '';
}

// ─────────────────────────────────────────────────────────────────────────────
// The map marks
// ─────────────────────────────────────────────────────────────────────────────

/** A mark on the map in ground coordinates; simScreen.ts projects it and draws it (kinds `sliceA`, `sliceB`, `slice`, `probe`). */
export type SliceMark =
  | { kind: 'sliceA' | 'sliceB'; at: SlicePoint; /** Tapped but not placed yet. */ pending: boolean }
  | { kind: 'slice'; from: SlicePoint; to: SlicePoint }
  | { kind: 'probe'; at: SlicePoint };

/** What the map shows while the tool is open: the line with its two ends (else the draft ends), the tapped candidate, the probe pin. */
export function sliceMarks(s: SliceToolState | undefined, facts: LineFacts): SliceMark[] {
  if (!s) return [];
  const marks: SliceMark[] = [];
  const line = facts.line;
  // Over the original curtain's chord (the Layers panel's section: not the tool's line) a draft end is the person's own and is shown instead of the chord's ends.
  const draftOverChord = !!line && !ownLine(facts) && !!(s.draft.a || s.draft.b);
  if (line && !draftOverChord) {
    marks.push({ kind: 'slice', from: line.a, to: line.b }, { kind: 'sliceA', at: line.a, pending: false }, { kind: 'sliceB', at: line.b, pending: false });
  } else {
    if (line) marks.push({ kind: 'slice', from: line.a, to: line.b });
    if (s.draft.a) marks.push({ kind: 'sliceA', at: s.draft.a, pending: false });
    if (s.draft.b) marks.push({ kind: 'sliceB', at: s.draft.b, pending: false });
  }
  if (s.placing && s.candidate) marks.push({ kind: s.placing === 'a' ? 'sliceA' : 'sliceB', at: s.candidate, pending: true });
  if (s.probe && line) {
    const at = probeMapPoint(line, s.probe);
    if (at) marks.push({ kind: 'probe', at });
  }
  return marks;
}

/**
 * A mark in screen coordinates (px in the scene host), as plain data so simScreen.ts can tell when nothing moved and skip the rebuild.
 * `slice` is the line as an SVG path along the terrain (broken where the line leaves the screen).
 */
export type SliceAnnMark =
  | { kind: 'sliceA' | 'sliceB'; at: [number, number]; pending: boolean }
  | { kind: 'slice'; d: string }
  | { kind: 'probe'; at: [number, number] };

/** Number of ground points a line is projected through, so it follows the terrain instead of cutting straight across a valley. */
export const LINE_PROJECTION_POINTS = 16;

/** Project the marks with the scene's `projectToScreen` (null off the screen). Marks whose point is off the screen are left out. */
export function sliceAnnotationMarks(marks: readonly SliceMark[], project: (p: SlicePoint) => [number, number] | null): SliceAnnMark[] {
  const half = (v: number): number => Math.round(v * 2) / 2;
  const out: SliceAnnMark[] = [];
  for (const m of marks) {
    if (m.kind === 'slice') {
      let d = '';
      let pen = false;
      for (const q of alongPoints(m.from, m.to, LINE_PROJECTION_POINTS).map(project)) {
        if (!q) pen = false;
        else {
          d += `${pen ? 'L' : 'M'}${half(q[0])},${half(q[1])} `;
          pen = true;
        }
      }
      if (d) out.push({ kind: 'slice', d: d.trimEnd() });
    } else {
      const q = project(m.at);
      if (!q) continue;
      const at: [number, number] = [half(q[0]), half(q[1])];
      out.push(m.kind === 'probe' ? { kind: 'probe', at } : { kind: m.kind, at, pending: m.pending });
    }
  }
  return out;
}

/** The effective chip: what the scene says, else the stored choice, else Speed (what the first placement writes). */
export function effectiveField(update: Pick<SliceUpdate, 'field'> | null | undefined, cs: CrossSection): SliceFieldId {
  return update?.field ?? cs.field ?? 'speed';
}
