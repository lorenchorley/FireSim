/**
 * Air Slice, side view: the shared types and the signatures of the pure modules (workstream D of
 * docs/plans/air-slice-wind-detail-honest-speed.md, §8; built on the air data of workstream C, §7).
 *
 * THIS FILE IS THE CONTRACT OF RELEASE 0.4.0 D. It holds types, a few constants and doc comments, and no behaviour. Four
 * lanes build against it in parallel (who owns which file: scratchpad/lanes/D-CONTRACT.md):
 *   slicecore  src/render/slice/* (sampleSlice, sectionFromEndpoints, resolveSlice, niceTicks, flow2d, probe, SliceUpdater)
 *   curtain    crossSectionLayer, SceneView glue, palette, legends, layer catalog, Layers panel chip row
 *   slicetool  the Air slices tool: state machine, placement, presets, map marks (src/ui/screens/sim/sliceTool*.ts)
 *   slicepanel the side-view panel: canvas, chips, footer, probe, streaks (src/ui/screens/sim/slicePanel*.ts)
 * The "Signatures" blocks below say exactly which function each lane writes and where. A lane may assume every signature
 * named here exists in the module named, with exactly these parameters and this return type; it must not change one.
 * An additive change (a new optional field, a new member of a union) is allowed and must be named in the lane's report.
 *
 * ── Conventions (unit-tested by slicecore; everyone else may rely on them) ──
 *  Coordinates   local metres, x east and y north of the domain origin (core/grid.ts). Heights are metres above sea level
 *                ("ASL") everywhere in a slice; "above ground" is ASL minus the 10 m DEM (never the model's smoothed ground).
 *  Line          A to B. `dir` = (dx, dy) is the unit vector from A to B and `s` is the distance in metres from A.
 *                A is always the LEFT end of the side-view panel; the panel never mirrors. "Swap" exchanges a and b.
 *  Along         along  = u·dx + v·dy         (positive: the air moves from A towards B)
 *  Across        across = u·dy − v·dx         (positive: the air moves towards the RIGHT of someone walking from A to B;
 *                                              a line due north with an easterly wind has across = +u)
 *  Inverse       u = along·dx + across·dy,  v = along·dy − across·dx
 *  Up/down       `up` is w in m/s, positive upwards. `speed` is horizontal: hypot(u, v), without w.
 *  Wind "from"   a wind is reported by the direction it comes FROM, degrees clockwise from north: fromDeg = wrapDeg(atan2(−u, −v))
 *                in degrees, i.e. vectorAzimuthDeg(u, v) + 180, and named with the 8-point compassWord of explain/text.ts
 *                ("north-west", hyphenated like the rest of the app). It is never reported as "towards" in words.
 *  Lattice       a slice is sampled on a regular lattice: column c at s = c / (columns − 1) × length, row r at
 *                z = zMin + r · (zMax − zMin) / (rows − 1). Row 0 is the LOWEST row. Index of (c, r) is r · columns + c.
 *  Units         m/s for speed, along, across and up; kelvin for theta; model units for smoke (concentration, no scale).
 *  Temperature   `theta` is NOT the raw perturbation: it is the potential-temperature anomaly minus the mean of the valid
 *                cells of its own row ("warmer or cooler than the slice's air at that height"), because the raw field
 *                carries the night cold pool and the area-wide daytime warming (§8.4).
 *  Validity      a cell is valid when it lies above the model's own ground and below the model top. Invalid cells hold 0
 *                in every field and are never drawn as air.
 */
import type { GridSpec } from '../../core/grid';
import type { SimSnapshot } from '../../core/types';
import type { AirField, AirKind } from '../../core/airView';
import type { AtmosphereSampler, SectionLine } from '../atmosphereSampler';

// ─────────────────────────────────────────────────────────────────────────────
// Ids
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What a slice is coloured by, in the order of the chips: wind speed (horizontal), wind along the line, up and down air,
 * wind across the line, temperature against the slice's air at that height, smoke. `along`, `up` and `across` are the
 * `along`, `w` and `across` of the conventions above.
 */
export const SLICE_FIELD_IDS = ['speed', 'along', 'up', 'across', 'theta', 'smoke'] as const;
export type SliceFieldId = (typeof SLICE_FIELD_IDS)[number];

/**
 * One tap on a preset line (§8.1): through the fire (or the map centre when there is no fire yet) along the wind, across
 * the wind and up the slope, and from the phone's position to the fire. NOT the same names as the fields: a preset is a
 * line, a field is a colouring.
 */
export const SLICE_PRESET_IDS = ['along', 'across', 'slope', 'me'] as const;
export type SlicePresetId = (typeof SLICE_PRESET_IDS)[number];

/** Which air a slice shows: the time-stepped 3-D atmosphere, or the fast tier's terrain fit of the forecast wind. */
export type SliceKind = Extract<AirKind, 'prognostic' | 'diagnosed'>;

/** The wind speed unit of the settings (the same two values as ui/format.ts SpeedUnit; render code must not import the UI). */
export type SliceSpeedUnit = 'kmh' | 'ms';

/** A point or an endpoint in local metres (east, north). */
export type SlicePoint = [number, number];

/** What a field chip shows and needs. The wording is final unless the slicepanel lane rewords a label (one line each). */
export interface SliceFieldInfo {
  id: SliceFieldId;
  /** Chip text, as short as the mock-up (§8.1): fits six chips in 390 px. */
  label: string;
  /** The full name for legends, readouts and screen readers. */
  name: string;
  /** Which 3-D field of the air it needs (core/airView.ts `airHas`): temperature and smoke exist only in the prognostic air. */
  needs: AirField;
}

/**
 * What the Temp chip is measured against, in words. `theta` is the anomaly minus the mean of the valid cells of its own row of the
 * slice (see the Temperature convention above), so the honest words are "warmer or cooler than the average of the slice at that height",
 * not "than the area". The legend's title and teaching sentence and the chip's name use this phrase; the probe sentence says "than average" (it
 * has to stay short: the landscape readout has room for four lines) and the legend and the Help say what the average is.
 */
export const SLICE_THETA_BASIS = 'the average of the slice at that height';

export const SLICE_FIELDS: readonly SliceFieldInfo[] = [
  { id: 'speed', label: 'Speed', name: 'Wind speed', needs: 'wind' },
  { id: 'along', label: 'Along', name: 'Wind along the line', needs: 'wind' },
  { id: 'up', label: 'Up/down', name: 'Air going up or down', needs: 'wind' },
  { id: 'across', label: 'Across', name: 'Wind across the line', needs: 'wind' },
  { id: 'theta', label: 'Temp', name: `Air temperature against ${SLICE_THETA_BASIS}`, needs: 'theta' },
  { id: 'smoke', label: 'Smoke', name: 'Smoke', needs: 'smoke' },
];

/**
 * How the footer words the kind of air (§8.1 "Honest footer"). Used by the footer and by the Layers panel's callout, so the
 * two never say different things. The footer is "{label} | model grid {cellSizeM} m | air from HH:MM".
 */
export const SLICE_KIND_LABEL: Record<SliceKind, string> = {
  prognostic: '3-D time-stepped air',
  diagnosed: 'Diagnosed wind: terrain effects only',
};

// ─────────────────────────────────────────────────────────────────────────────
// Constants shared by more than one lane
// ─────────────────────────────────────────────────────────────────────────────

/** A slice is recomputed at most this often (ms) when only the air changed (a new snapshot); a line edit is immediate (§8.4). */
export const SLICE_UPDATE_MIN_MS = 250;

/**
 * A line is too short below `max(SLICE_MIN_LENGTH_M, SLICE_MIN_LENGTH_CELLS × model cell size)` metres. The plan says both
 * "two model cells, about 270 m" (§8.2) and "Make the line longer than 300 m" (§8.3); the larger of the two decides, and the
 * words use the number from `ResolvedSlice.minLengthM`, rounded up to 50 m.
 */
export const SLICE_MIN_LENGTH_M = 300;
export const SLICE_MIN_LENGTH_CELLS = 2;

/** A preset line runs this far each way from its centre, so far as the model rectangle allows (about 6 km, §8.4). */
export const SLICE_PRESET_HALF_LENGTH_M = 3000;

// (The footer says how much older the air is than the picture beyond `AIR_STALE_S` = 90 s: core/airView.ts, `airAgeS`.)

// ─────────────────────────────────────────────────────────────────────────────
// The line: what is asked for, and what it resolves to
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The part of `LayerState.crossSection` that makes the line (render/layers.ts has the full object; it is assignable here).
 * The line is the first of these that applies:
 *   1. `preset` (not null/undefined): a live line, recomputed from the wind at the shown time, the fire, the DEM and the
 *      phone's position every time it is resolved, so "Along the wind" follows a wind change while the run plays;
 *   2. `a` and `b` BOTH set: the hand-placed line (a half-placed line is not stored here; the tool keeps a draft, so a
 *      lone `a` or `b` is ignored);
 *   3. else the longest chord through `centre` along `azimuth` (the original curtain, kept for "Show me" and the compass).
 * Whoever writes `centre` or `azimuth` must also write `a: undefined, b: undefined, preset: null`, and whoever writes `a`
 * and `b` writes `preset: null`; otherwise a stale higher rule hides the change.
 */
export interface SliceLineState {
  /** Compass bearing the line points TOWARDS, degrees clockwise from north (the compass rose's 'towards' mode). */
  azimuth: number;
  centre: SlicePoint;
  a?: SlicePoint;
  b?: SlicePoint;
  preset?: SlicePresetId | null;
}

/**
 * Why no line can be drawn (blocking), or why a preset is not offered. The words belong to the lane that shows them (the
 * slicetool lane for the controls); codes keep the pure modules free of text.
 *   too-short      shorter than `minLengthM` after clipping
 *   outside-model  the line misses the model rectangle, or a point of it is outside
 *   no-user        'me': no phone position, or it lies outside the model area
 *   no-fire        'me': there is no fire to go to
 *   flat-ground    'slope': the ground at the centre is too flat to have an up-slope direction
 *   calm           'along' and 'across': there is no wind direction (calm or unknown)
 */
export type SliceIssue = 'too-short' | 'outside-model' | 'no-user' | 'no-fire' | 'flat-ground' | 'calm';

/**
 * Facts about a line that IS drawn (the controls show them as a quiet line, never a toast):
 *   clipped                  the line met the edge of the model rectangle and was cut ("Shown to the edge of the model area")
 *   no-fire-centred-on-map   a preset (not 'me') had no fire to go through ("No fire yet: centred on the map")
 */
export type SliceNote = 'clipped' | 'no-fire-centred-on-map';

/** The effective line, with where it came from. */
export interface ResolvedSlice {
  /** The line inside the model rectangle, A to B, or null when none can be drawn (then `issue` says why). */
  line: SectionLine | null;
  /** Which rule of `SliceLineState` made it. */
  source: 'preset' | 'endpoints' | 'centre';
  /** The preset in force, or null. */
  preset: SlicePresetId | null;
  issue: SliceIssue | null;
  notes: SliceNote[];
  /** The shortest line allowed in this model (metres), for the words and for a "Place here" check. */
  minLengthM: number;
}

/** Whether a preset can be offered right now, and if not, why. */
export type SlicePresetStatus = { ok: true } | { ok: false; issue: SliceIssue };

/**
 * What the pure resolver needs from the live scene to turn a `SliceLineState` into a line. The scene (SceneView glue,
 * lane curtain) fills it from what it already holds each time it asks.
 */
export interface SliceResolveContext {
  /** The model's horizontal grid: its node extent is the model rectangle, its cell size sets the minimum length. */
  grid: GridSpec;
  /** The 10 m DEM, for the up-slope direction (the gradient over the line's own scale, not the 10 m noise). */
  heightAt(x: number, y: number): number;
  /** The centre of the map view, used when there is no fire. */
  mapCentre: SlicePoint;
  /** The fire's centre at the shown time (the scene's `fireCentroid`), or null before any fire. */
  fire: SlicePoint | null;
  /** The 10 m wind direction at the shown time, FROM, degrees clockwise from north; null when calm or unknown. */
  windFromDeg: number | null;
  /** The phone's position (Setup GPS fix), or null. */
  user: SlicePoint | null;
}

/** The result of clipping a hand-placed line to the model rectangle. */
export interface SectionResult {
  /** A to B inside the model rectangle (a and b moved to the edge where it was cut; the A to B order is kept), or null. */
  line: SectionLine | null;
  issue: Extract<SliceIssue, 'too-short' | 'outside-model'> | null;
  /** The line was cut at the edge ('clipped' note). */
  clipped: boolean;
  minLengthM: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// The sampled slice
// ─────────────────────────────────────────────────────────────────────────────

/** Which 3-D fields the air really holds (`airHas`); a field it lacks is all zero in `SliceData.values`. */
export type SliceHas = Record<AirField, boolean>;

/**
 * The model's own cells that the line passes through, for "Show model cells" (§8.1): the real grid, not the lattice. One
 * model column per crossed cell of the horizontal grid (a cell of size `cellSize` is centred on its node), and in each of
 * them the model's levels, whose heights follow the terrain, so the cell boundaries are not horizontal in the picture.
 */
export interface SliceCells {
  /** Number of crossed model columns. */
  count: number;
  /** Where the crossed columns begin and end along the line: `count + 1` ascending distances from A (m), first 0, last the length. */
  edges: Float32Array;
  /** The model column index (j · nx + i) of each crossed column. */
  column: Int32Array;
  /** Number of model levels (`nz`). */
  levels: number;
  /** Heights (m ASL) of the level boundaries in each crossed column: `levels + 1` ascending values per column, index c · (levels + 1) + l; the first is the model's ground there, the last the model top. */
  zEdges: Float32Array;
  /** Each field at the centre of each cell (the model's own value: not interpolated), index c · levels + l. */
  values: Record<SliceFieldId, Float32Array>;
}

/**
 * One vertical slice of the air, sampled once per update and read by the curtain, the panel and the probe. Its arrays
 * are REUSED between updates by `sampleSlice(…, out)`: the object a consumer holds changes in place, `seq` changes with it,
 * and a consumer must not keep values across an update it did not hear about. A different size (a longer line) is a new object.
 */
export interface SliceData {
  /** Counts up with every computation, so a consumer can tell "same line, new air" from "nothing happened". */
  seq: number;
  kind: SliceKind;
  /** Simulation time (s) of the recorded sample this slice was read from (0.4.1 time-lapse recorder); absent = sampled from the air of the picture shown. */
  recordedAt?: number;
  /** The line, A to B (`a`, `b`, `dir`, `length`: atmosphereSampler.ts). */
  line: SectionLine;
  columns: number;
  rows: number;
  /** Height axis (m ASL): row r is sampled at `zMin + r · (zMax − zMin) / (rows − 1)`. From the lowest ground on the line minus 50 m up to min(highest ground + 2000 m, model top). */
  zMin: number;
  zMax: number;
  /** Model top (m ASL); `zMax` never exceeds it. */
  topAsl: number;
  /** The fields, each `columns · rows` long, index r · columns + c, row 0 lowest. A field the air lacks is all zero (see `has`). */
  values: Record<SliceFieldId, Float32Array>;
  /** 1 where the cell is inside the model (above its own ground, below its top), else 0: `columns · rows`, same index. */
  valid: Uint8Array;
  /** The 10 m DEM under each column (m ASL): drawn as the filled silhouette. `columns` long. */
  ground: Float32Array;
  /** The model's own smoothed ground under each column (m ASL): drawn as the faint dashed line. `columns` long. */
  modelGround: Float32Array;
  has: SliceHas;
  /** Model grid size (m) for the footer: `view.grid.cellSize`. */
  cellSizeM: number;
  /** The model's cells along the line, for "Show model cells"; null when the line crosses none (cannot happen for a valid line). */
  cells: SliceCells | null;
  /** Simulation time (s) of the air (`AtmosphereView.time`), or null for a view that does not say. */
  airTime: number | null;
  /** Simulation time (s) of the picture the slice is shown with (`SimSnapshot.time`); `core/airView.ts airAgeS(view, shownTime)` is the age. */
  shownTime: number;
}

/** What the footer states (§8.1): the kind, the grid size, the air's time and how old it is against the time shown. */
export type SliceFooterInfo = Pick<SliceData, 'kind' | 'cellSizeM' | 'airTime' | 'shownTime'>;

/** The 10 m ground a slice reads: `HeightField` satisfies it. */
export interface SliceTerrain {
  heightAt(x: number, y: number): number;
}

/** What to sample. */
export interface SliceSpec {
  /** The effective line (`resolveSlice` or `sectionFromEndpoints` made it): already inside the model rectangle. */
  line: SectionLine;
  /** `SimSnapshot.time` of the picture the slice goes with (becomes `SliceData.shownTime`). */
  shownTime: number;
  /** Lattice size overrides for tests; absent: columns `clamp(round(length / (0.5 × model spacing)), 48, 192)`, 48 to 56 rows. */
  columns?: number;
  rows?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Probe
// ─────────────────────────────────────────────────────────────────────────────

/** Where the probe is, in slice coordinates: metres from A along the line, and metres ASL. The map pin is a + dir · s. */
export interface SliceProbePos {
  s: number;
  z: number;
}

/**
 * What a probe reads from the stored arrays (no resampling). `where`:
 *   air             the point is in valid air; the numbers below are real
 *   in-ground       below the 10 m ground ("Inside the ground")
 *   below-model     above the 10 m ground but below the model's own smoothed ground: the model has no air here
 *   above-model     above the model top
 * For anything but 'air' the numbers are null.
 */
export interface SliceProbeReading {
  /** The position asked for, clamped into the slice. */
  pos: SliceProbePos;
  /** The map point of the pin (local m). */
  x: number;
  y: number;
  /** Metres above the 10 m ground (negative inside it). */
  aglM: number;
  where: 'air' | 'in-ground' | 'below-model' | 'above-model';
  speed: number | null;
  along: number | null;
  across: number | null;
  up: number | null;
  /** The direction the horizontal wind comes FROM (deg clockwise from north), and its 8-point word ("north-west"). Null when calm (speed under 0.2 m/s) or not in air. */
  fromDeg: number | null;
  fromWord: string | null;
  /** Kelvin warmer (+) or cooler (−) than the slice's air at that height; null when the air has no temperature field. */
  thetaK: number | null;
  smoke: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// What the scene publishes to the tool and the panel
// ─────────────────────────────────────────────────────────────────────────────

/** Whether a chip can be used on this air, and if not, the plain-words reason (written by lane curtain: all need-3d / diagnosed wording). */
export type SliceFieldStatus = { ok: true } | { ok: false; reason: string; action?: 'use-3d' };

/** The one computation both the curtain and the panel read (made by `SliceUpdater`; `field` and `fields` are added by the scene glue). */
export interface SliceComputed {
  resolved: ResolvedSlice;
  /** Null when there is no line (`resolved.issue`) or the air holds no 3-D wind (the fast tier before it publishes, or no snapshot). */
  data: SliceData | null;
  /** Which presets can be tapped now (so the tool can disable "Me to fire" with its reason). */
  presets: Record<SlicePresetId, SlicePresetStatus>;
}

/**
 * What `SceneViewApi.slice()` and `onSlice` give: the computed slice plus the field to colour by and the state of every chip.
 * `field` is the EFFECTIVE field: `LayerState.crossSection.field`, or when that is absent the original curtain's colouring
 * (temperature where the air has it, else speed), or when the chosen one is not available on this air, speed.
 */
export interface SliceUpdate extends SliceComputed {
  field: SliceFieldId;
  fields: Record<SliceFieldId, SliceFieldStatus>;
  /** The time-lapse recorder's state (0.4.1), added by the scene glue; absent where there is no recorder (the 2-D map). */
  recording?: SliceRecordingStatus;
}

// ─────────────────────────────────────────────────────────────────────────────
// The updater (the one function-bearing type of the pure modules that other lanes hold)
// ─────────────────────────────────────────────────────────────────────────────

/** Everything one computation needs; the scene glue builds it from what it already holds. */
export interface SliceInputs {
  /** The layer state's line part (`layers.crossSection`). */
  line: SliceLineState;
  ctx: SliceResolveContext;
  /** The sampler of the snapshot the slice is shown with. */
  sampler: AtmosphereSampler;
  terrain: SliceTerrain;
  /** `SimSnapshot.time`. */
  shownTime: number;
  /** Recorded slices of the pinned line (0.4.1); absent = every slice is sampled from the picture's air, as in 0.4.0. */
  recording?: SliceRecordingReader;
}

/**
 * One computation shared by the curtain and the panel, never two (§8.4, §8.6). Owned by the SceneView glue (one instance per
 * scene), has no timers (the scene calls `poll` from its frame loop) and takes the clock as an argument, so a test runs it
 * with a fake one.
 *   request(inputs, nowMs, immediate)  runs `resolveSlice`, then `sampleSlice` into the same `SliceData` object, and returns the
 *       result at once when `immediate` is true (a line, field or layer edit) or when at least `minIntervalMs` (default
 *       `SLICE_UPDATE_MIN_MS`) have passed since the last computation (a new snapshot); otherwise it keeps the inputs as
 *       pending and returns null.
 *   poll(nowMs)  computes the pending inputs if the interval has passed and returns the result, else null.
 *   invalidate()  drops the held data and the pending request (new scenario, slice switched off).
 *   latest  the last result, or null.
 * `SliceComputed.presets` is `slicePresetStatus` of the four presets. Allocation: the arrays of `SliceData` are reused; a
 * computation allocates only its small result objects.
 */
export interface SliceUpdater {
  request(inputs: SliceInputs, nowMs: number, immediate?: boolean): SliceComputed | null;
  poll(nowMs: number): SliceComputed | null;
  invalidate(): void;
  readonly latest: SliceComputed | null;
}

/** src/render/slice/sliceUpdater.ts: `export function createSliceUpdater(opts?: { minIntervalMs?: number }): SliceUpdater`. */
export type CreateSliceUpdater = (opts?: { minIntervalMs?: number }) => SliceUpdater;

/*
 * ═════════════════════════════════════════════════════════════════════════════
 * SIGNATURES: pure modules of lane slicecore (src/render/slice/*)
 * Each is a real function in the module named, with a node unit test. No DOM, no Three.js, and no allocation in a
 * per-sample path unless said. Types: above.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * ── src/render/slice/sliceField.ts ──
 *
 *   export function sampleSlice(sampler: AtmosphereSampler, terrain: SliceTerrain, spec: SliceSpec, out?: SliceData | null): SliceData | null
 *
 * Samples the air on the lattice of the conventions with `sampler.fieldsP` (one lookup per lattice point, none of the
 * boxed-double methods) and fills `values` (speed, along, across, up, theta, smoke), `valid`, `ground` (`terrain.heightAt`),
 * `modelGround` (`sampler.modelGroundAt`), `cells` and the scalars. Returns null when `sampler.hasWind` is false (no 3-D
 * wind: kind 'surface' or 'none'); `kind` is `sampler.kind`. `out` of the same size is refilled in place and returned (its
 * `seq` incremented); a different size, or null, allocates. `theta` has the row mean of the valid cells subtracted (conventions).
 * Tests: a uniform field gives a constant; a linear shear is exact; the validity mask; the sign conventions on a rotated
 * line; units; and the ORACLE: a slice value equals the engine's own `Atmosphere.sample()` / `DiagnosticWind.sampleBg` at
 * the same point to 1e-3 m/s.
 *
 * ── src/render/slice/sectionLine.ts ──
 *
 *   export function sectionFromEndpoints(a: SlicePoint, b: SlicePoint, grid: GridSpec): SectionResult
 *
 * Clips the segment A to B to the model rectangle (the node extent of `grid`: x0 to x0 + (nx − 1)·cellSize, same for y),
 * keeps the A to B order, and checks the minimum length `max(SLICE_MIN_LENGTH_M, SLICE_MIN_LENGTH_CELLS × grid.cellSize)` of
 * the CLIPPED line. Swapping a and b gives the same line reversed (`dir` negated, `a` and `b` exchanged).
 *
 *   export function resolveSlice(state: SliceLineState, ctx: SliceResolveContext): ResolvedSlice
 *
 * The rules of `SliceLineState`, in that order. Presets (each is a chord through the centre, the fire or else
 * `ctx.mapCentre`, limited to `SLICE_PRESET_HALF_LENGTH_M` each side and to the model rectangle; no fire adds the note
 * 'no-fire-centred-on-map'):
 *   along   the bearing A to B is the direction the wind blows TOWARDS (windFromDeg + 180): A upwind, B downwind, the wind
 *           runs left to right in the panel and `along` is positive; calm is the issue 'calm'
 *   across  the bearing A to B is the wind-towards bearing minus 90 degrees, so the wind blows towards the right of someone
 *           walking A to B and `across` is positive; calm is 'calm'
 *   slope   A downhill, B uphill: the bearing A to B is the direction the ground rises towards, from the gradient of
 *           `ctx.heightAt` over about a third of the line; ground flatter than about 2 degrees is 'flat-ground'
 *   me      A is `ctx.user`, B is `ctx.fire`, not extended; no phone position, or one outside the model, is 'no-user'; no fire is 'no-fire'
 * Every result is clipped and length-checked like `sectionFromEndpoints`. Never throws: a line that cannot be made is
 * `line: null` with an `issue`. The 'centre' rule is `sectionLine(bounds, centre, azimuth)` (atmosphereSampler.ts), unchanged.
 *
 *   export function slicePresetStatus(preset: SlicePresetId, ctx: SliceResolveContext): SlicePresetStatus
 *
 * Whether `resolveSlice` would make a line for that preset now (the reason is the issue it would return).
 *
 * ── src/render/slice/niceTicks.ts ──
 *
 *   export function niceTicks(lo: number, hi: number, target?: number): { values: number[]; step: number }
 *
 * Axis ticks: the multiples of `step` inside [lo, hi], where `step` is 1, 2 or 5 times a power of ten (so 500 m for a
 * 1500 m axis) chosen to give about `target` (default 5) ticks. `values` ascend and are never empty for hi > lo;
 * lo >= hi gives `{ values: [lo], step: 1 }`. (Labels in km or m are the panel's: ui/format.ts has `formatDistance`.)
 *
 * ── src/render/slice/flow2d.ts ── (streaks in the plane, §8.5)
 *
 *   export interface FlowParticles { count: number; s: Float32Array; z: Float32Array; ps: Float32Array; pz: Float32Array; age: Float32Array; seed: number }
 *   export interface FlowOptions { exaggeration: number; timeScale: number; maxAgeS: number }
 *   export function createFlow(count: number, seed?: number): FlowParticles
 *   export function seedFlow(f: FlowParticles, data: SliceData): void
 *   export function stepFlow(f: FlowParticles, data: SliceData, dtS: number, opts: FlowOptions): void
 *   export function flowArrows(data: SliceData, nCols: number, nRows: number, exaggeration: number): { count: number; s: Float32Array; z: Float32Array; angle: Float32Array; speed: Float32Array }
 *
 * Particles live in slice coordinates (`s` metres from A, `z` metres ASL; `ps`, `pz` the previous position, so a streak is
 * drawn from there to here). `seedFlow` scatters them over valid cells; `stepFlow` advects them through the stored `along`
 * and `up` (bilinear on the lattice, no resampling) for `dtS × timeScale` seconds of air time, the vertical component times
 * `exaggeration` (the on-screen ratio of vertical to horizontal scale, so a streak points the way the picture shows),
 * re-seeds one that leaves valid air or passes `maxAgeS`, and is deterministic for a seed (no Math.random). `flowArrows` is
 * the static lattice of arrows used under reduced motion (`angle`: screen angle of the same exaggerated vector, radians
 * anticlockwise from +s, `speed` in m/s). Tests: against analytic fields (uniform, shear, rotation). About 300 particles.
 *
 * ── src/render/slice/probe.ts ──
 *
 *   export function probeAt(data: SliceData, pos: SliceProbePos): SliceProbeReading
 *   export function moveProbe(data: SliceData, pos: SliceProbePos | null, key: 'left' | 'right' | 'up' | 'down', big?: boolean): SliceProbePos
 *   export function probeSentence(r: SliceProbeReading, opts: { units: SliceSpeedUnit; kind: SliceKind }): string
 *   export function windFromDeg(u: number, v: number): number
 *
 * `probeAt` reads the stored arrays by bilinear interpolation (no resampling, no allocation beyond the returned object),
 * clamps `pos` into the slice and fills `SliceProbeReading` (`fromDeg` is rebuilt from `along` and `across` with the inverse
 * of the conventions). `moveProbe` is the keyboard: one lattice step per key (a quarter of the axis when `big`), starting
 * from the middle of the slice when `pos` is null, and never leaving the slice. `probeSentence` is the readout, in the repo's
 * voice (plain words, "about"): "Wind about 32 km/h from the north-west, along the line 28 km/h towards B, up 1.4 m/s, 60 m
 * above ground, 3 K warmer than average"; "towards A" for a negative along, "to the right" or "to the left" for across,
 * "down" for a negative up; the temperature clause only when the air has one (never for the diagnosed kind); for `where`
 * other than 'air' one short sentence ("Inside the ground", "Below the model's ground: the model has no air here", "Above the
 * top of the model"). `windFromDeg` is the "from" bearing of the conventions, wrapped to 0 to 360.
 *
 * ── src/render/slice/sliceUpdater.ts ──
 *
 *   export function createSliceUpdater(opts?: { minIntervalMs?: number }): SliceUpdater      (see `SliceUpdater`)
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * SIGNATURES: lane curtain (render glue, palette, legends, catalog)
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * ── src/render/palette.ts ──
 *
 *   export const ALONG_RAMP: Ramp
 *   export function sliceFieldScale(field: SliceFieldId): { ramp: Ramp; lo: number; hi: number; diverging: boolean }
 *
 * `ALONG_RAMP` is diverging, luminance-ordered and symmetric about 0 (Machado colour-vision test). `sliceFieldScale` is the
 * colour ramp and the value range of a chip, in the units of `SliceData.values` (speed: WIND_RAMP 0 to 25 m/s, legend 0 to
 * 90 km/h; up: UPDRAFT_RAMP; theta: THETA_RAMP; along and across: ALONG_RAMP, symmetric; smoke: a sequential ramp). The
 * panel's raster and the curtain's texture both colour with it, so they always match the legend.
 *
 * ── src/render/legends.ts ──
 *
 *   export function sliceLegend(field: SliceFieldId, kind: SliceKind): LegendSpec        (replaces `crossSectionLegend`)
 *
 * The legend of a chip (`LegendSpec.overlay` gains 'slice'). The temperature legend says "warmer or cooler than the average
 * of the slice at that height" (`SLICE_THETA_BASIS`), not "Air temperature vs surroundings" and not "than the area".
 *
 * ── src/render/SceneView.ts, api.ts ──
 *
 * The scene owns the `SliceUpdater`: it asks on every snapshot (`request(…, false)`), on every `setLayers` that changes
 * `crossSection` (`immediate`) and from its frame loop (`poll`), builds the `SliceUpdate` (adding `field` and `fields`), draws
 * the curtain from `SliceData`, and calls the `onSlice` subscribers (`SceneViewApi.slice`, `onSlice`: render/api.ts).
 */

// ─────────────────────────────────────────────────────────────────────────────
// The time-lapse recorder (0.4.1, plan 8.6 and decision D7; design in the release notes of 0.4.1)
// ─────────────────────────────────────────────────────────────────────────────

export type RecordingState = 'off' | 'waiting' | 'recording' | 'failed';
export type RecordingDrop = 'line' | 'cleared' | 'model';

export interface SliceRecordingStatus {
  state: RecordingState;
  /** Why it is off although a line is shown: a live preset, or the Layers chord; null otherwise. */
  offFor: 'preset' | 'chord' | null;
  count: number;
  /** Sim time (s) of the first and the newest sample. */
  from: number | null;
  to: number | null;
  /** Minimum spacing after thinning; 0 = every picture kept. */
  spacingS: number;
  bytes: number;
  budgetBytes: number;
  /** What dropped the recording before this one (null: nothing yet). */
  dropped: RecordingDrop | null;
}

export interface SliceRecordingReader {
  /** A recorded slice for exactly this line and kind, at or before `shownTime` and newer than `pictureAirTime`, filled into `out` (reused when it has the lattice); else null. */
  read(line: SectionLine, shownTime: number, kind: SliceKind, pictureAirTime: number | null, out: SliceData | null): SliceData | null;
}

export interface SliceRecordingApi {
  /** Every snapshot, as it arrives (`Session.onSnapshot`). */
  record(snap: SimSnapshot): void;
  /** Keep the samples at or before `t`. */
  truncateAfter(t: number): void;
  /** The person's "Clear recording". */
  clear(): void;
  status(): SliceRecordingStatus;
}
