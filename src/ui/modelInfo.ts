/**
 * "How this simulation works": the CONTENT of the transparency card (src/ui/screens/modelCard.ts), pure (no DOM).
 * `describeModel()` turns the scenario, the engine's own report (SimSnapshot.engine, core/simTypes.ts EngineInfo) and
 * the settings into seven sections; `cardToText()` is the "Copy as text" export.
 *
 *   1 At a glance              one row per component: dimensions, resolution, time step, method, evidence, spec section
 *   2 What it can and cannot resolve   derived from the real grid sizes; what is parameterised instead of resolved
 *   3 How sure are we?         evidence tags of the specification, the open issues that affect numbers on screen,
 *                              the validation summary, the steep-slope / extreme-weather caveat
 *   4 Data in this run         a SHORT summary of the data inventory (the Data sets screen has the detail)
 *   5 Layers and what they show   the layer catalog: dimensionality and resolution of every layer
 *   6 Engine right now         LIVE rows (tier and why, steps, speed, embers, memory, checkpoints)
 *   7 Words used               glossary
 *
 * TRUTH RULES. Every number comes from the engine report, the scenario, the settings or the code's own parameter tables
 * (SIM_PARAMS, ATMOS_TIERS, SPREAD_PARAMS ...) — never typed in. Static sentences were checked against the code and the
 * specification (docs/research/00-synthesis.md, "§" below); the counts and item numbers quoted from the specification
 * and the README are re-checked by modelInfo.test.ts. Empirical relations are called empirical, parameterised effects
 * are not called resolved, FireSim choices are labelled as assumptions. The fast tier (a surface wind fitted to the
 * terrain) and the 3-D tiers (time-stepped air flow) are described differently, from the tier the engine reports NOW
 * (also after a switch mid-run). Before the engine reports (opened from Setup, or before the first picture) the numbers
 * are PLANNED, computed with the same rules the builder and the engine apply, and the card says so.
 */
import { formatBytes, formatCount } from '../core/datasets';
import type { DatasetRecord, EngineInfo, QualityTier, ScenarioData, SimSnapshot, WeatherSeries } from '../core/types';
import { ATMOS_PARAMS, ATMOS_TIERS } from '../atmosphere/params';
import { EMBER_CLASSES, EMBER_PARAMS } from '../embers/params';
import { FIRE_MODEL_PARAMS } from '../fire/models/params';
import { SPREAD_PARAMS } from '../fire/spread/params';
import {
  availabilityContext,
  DIMENSION_HELP,
  LAYER_CATALOG,
  LAYER_GROUPS,
  LAYER_GROUP_BLURBS,
  type AvailabilityContext,
  type LayerDimension,
  type LayerInfo,
  type LayerScenario,
} from '../render/layerCatalog';
import { builtFireCell } from '../scenario/params';
import type { ScenarioRequest } from '../scenario/request';
import { SIM_PARAMS } from '../sim/params';
import { formatDuration, formatNumber, formatPlaybackSpeed, formatSpeedHint, formatStepLabel } from './format';
import type { IconName } from './icons';
import type { Tone } from './primitives';
import type { Settings } from './settings';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** How far a row can be trusted (shown as a badge with its own icon, colour and word). */
export type EvidenceLevel = 'measured' | 'modelled' | 'verified' | 'partly' | 'assumed' | 'synthetic' | 'display';

export const EVIDENCE: Readonly<Record<EvidenceLevel, { label: string; icon: IconName; tone: Tone; gloss: string }>> = {
  measured: { label: 'Measured data', icon: 'ruler', tone: 'ok', gloss: 'Surveyed or measured (LiDAR, satellite, your readings).' },
  modelled: { label: 'Weather-model data', icon: 'cloud', tone: 'neutral', gloss: 'Output of a weather model (a forecast or a reanalysis), not a measurement here.' },
  verified: { label: 'Verified method', icon: 'check-circle', tone: 'ok', gloss: 'Checked against a published source or tested exactly.' },
  partly: { label: 'Partly verified', icon: 'help-circle', tone: 'neutral', gloss: 'A published method, but some parts are FireSim choices or could not be checked.' },
  assumed: { label: 'FireSim assumption', icon: 'warning', tone: 'watch', gloss: 'A rule of thumb or design choice of FireSim: treat the result as indicative.' },
  synthetic: { label: 'Made-up data', icon: 'tune', tone: 'watch', gloss: 'Designed or estimated by the app (a preset day, a fallback), not measured.' },
  display: { label: 'Display only', icon: 'eye', tone: 'neutral', gloss: 'Drawn for you to look at; it does not feed the simulation.' },
};

/** One component of the simulation (section "At a glance"). */
export interface ModelRow {
  id: string;
  component: string;
  /** Dimensionality in plain words ("2-D: a front line moving over the ground"). */
  dimensions: string;
  /** Grid or count with units. */
  resolution: string;
  timeStep: string;
  /** The method in plain words. */
  method: string;
  evidence: EvidenceLevel;
  /** Why that evidence level, naming the uncertain parts. */
  evidenceNote: string;
  /** Section(s) of the specification. */
  specRef: string;
  /** Some of its numbers come from the running engine and change during the run. */
  live: boolean;
}

export interface CardFact {
  id: string;
  key: string;
  value: string;
  note?: string;
  live?: boolean;
}

export interface CardBullet {
  text: string;
  /** can = represented; cannot = not represented; parameterised = a rule instead of a simulation; issue; note. */
  kind: 'can' | 'cannot' | 'parameterised' | 'issue' | 'note';
  ref?: string;
}

export interface LayerLine {
  id: string;
  title: string;
  kind: LayerInfo['kind'];
  dimension: LayerDimension;
  resolution: string;
  what: string;
  /** Why it cannot be shown in this run right now (the catalog's own reason), when it cannot. */
  unavailable?: string;
}

export type CardBlock =
  | { type: 'rows'; rows: ModelRow[] }
  | { type: 'facts'; title?: string; facts: CardFact[] }
  | { type: 'bullets'; title?: string; bullets: CardBullet[] }
  | { type: 'text'; text: string; tone?: 'info' | 'warn' }
  | { type: 'layers'; dimensions: { dimension: LayerDimension; help: string }[]; groups: { title: string; blurb: string; layers: LayerLine[] }[] }
  | { type: 'glossary'; terms: { term: string; gloss: string }[] }
  | { type: 'legend'; title: string; items: { level: EvidenceLevel; label: string; gloss: string }[] }
  | { type: 'action'; action: 'open-datasets'; label: string };

export type SectionId = 'glance' | 'limits' | 'sure' | 'data' | 'layers' | 'engine' | 'words';

export interface ModelSection {
  id: SectionId;
  title: string;
  /** One line under the title (collapsed groups show it). */
  summary: string;
  blocks: CardBlock[];
  /** Holds values that change while the run goes on. */
  live: boolean;
}

export interface ModelCard {
  /**
   * live = the real engine reported (numbers measured now); planned = a scenario but no engine report yet;
   * preview = no scenario (opened from Setup): planned from the request; mock = the demo engine is running.
   */
  mode: 'live' | 'planned' | 'preview' | 'mock';
  title: string;
  /** One honest sentence from the values. */
  headline: string;
  /** Where the numbers come from. */
  subtitle: string;
  sections: ModelSection[];
}

export interface ModelCardInput {
  scenario: ScenarioData | null;
  /** The engine's report (the newest SimSnapshot.engine); null before it reports. */
  engine?: EngineInfo | null;
  /** The picture on screen (spot fires, embers that left the square). */
  snapshot?: SimSnapshot | null;
  settings: Pick<Settings, 'timeStep' | 'solverStep' | 'performance' | 'defaultSpeed'>;
  /** Setup's request (preview when there is no scenario). */
  request?: ScenarioRequest | null;
  /** The time-scrubber history's memory cap on this device (ui/session.ts defaultSnapshotBudget), bytes. */
  historyBudgetBytes?: number;
  /** Which simulation module runs ('mock' = the demo engine). */
  engineSource?: 'real' | 'mock';
}

// ─────────────────────────────────────────────────────────────────────────────
// Facts quoted from the specification and the README (re-checked by modelInfo.test.ts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evidence tags in the model chapters of the specification (§4–§15 of docs/research/00-synthesis.md): bracketed [V] [K]
 * [D] [H] tags and UNVERIFIED marks, counted by modelInfo.test.ts (which fails when the specification changes).
 */
export const SPEC_EVIDENCE = { chapters: '§4–§15', verified: 39, literature: 7, derived: 4, heuristic: 91, unverified: 13 } as const;

/** Items of the specification's open-issue register (§16) that change numbers the app shows. `key` = the item's bold title. */
export const SPEC_OPEN_ISSUES: readonly { item: number; key: string; plain: string; affects: string }[] = [
  { item: 1, key: 'Vesta Mk2 coefficients', plain: 'The forest spread model’s coefficients come from one line of computer code; the primary papers were not read.', affects: 'forest spread rates, intensity and flame heights' },
  { item: 2, key: 'Heath 2024 refit', plain: 'The source of the 2024 heath model has not been identified.', affects: 'spread in heath and shrubland' },
  { item: 3, key: 'FBI grass breakpoints', plain: 'Two versions of the grass fire-danger thresholds exist.', affects: 'the fire danger rating over grass' },
  { item: 4, key: 'FHS → load table', plain: 'The table that turns fuel hazard scores into fuel loads was not checked against the official guide.', affects: 'fuel loads and fire intensity' },
  { item: 5, key: 'SVTM → fuel-class mapping', plain: 'Several vegetation-to-fuel rules are FireSim choices awaiting NSW RFS review; satellite tree heights read low in tall forest.', affects: 'fuel types and tree heights' },
  { item: 8, key: 'Moisture anomaly model', plain: 'The sun, shade and gully adjustment of litter moisture is calibrated only roughly.', affects: 'litter moisture on sunny and shaded slopes' },
  { item: 10, key: 'Schroeder P_ig', plain: 'The ignition-probability formula is from the United States, not fitted to eucalypt fuels.', affects: 'whether a landed ember starts a spot fire' },
  { item: 11, key: 'Ember emission E0', plain: 'How many embers a fire makes has no Australian calibration.', affects: 'spot fire counts (compare them, do not read them as real numbers)' },
  { item: 12, key: 'Mountain parameterisations', plain: 'The eruptive, lee-slope, junction and debris rules are FireSim heuristics.', affects: 'runs up gullies, sideways spread on lee slopes, junction zones' },
  { item: 13, key: 'Pyrogenic potential constant k', plain: 'The strength of the fire’s own indraft in the fast mode is a design choice.', affects: 'the fire-made wind in the fast mode' },
  { item: 14, key: 'Double counting', plain: 'Slope effects in the spread models and daytime upslope winds may be counted twice.', affects: 'uphill runs on sunny afternoons' },
  { item: 16, key: 'Upper air for historical dates', plain: 'Past days have no upper-air data, so a standard profile is used.', affects: 'plume and pyroconvection cards for historic days' },
  { item: 20, key: 'Performance', plain: 'Speed figures were measured on a computer, not yet on target phones.', affects: 'which atmosphere the Auto setting picks' },
];

/** The README's validation summary ("Known limitations"), in plain words; modelInfo.test.ts checks the README still says it. */
export const VALIDATION_SUMMARY =
  'The validation scenarios of the specification (§15: slope ratios, wind and slope together, ridge crests, night slowdown, ' +
  'slope winds, spotting distances, lee-slope spread, gullies, wind changes, recent burns, junctions, plumes, determinism and ' +
  'rewind) run automatically and pass, with three known gaps: the speed targets are missed for very large fires (about ' +
  '3 000–5 000 ha, V20), the 3-D wind on flat ground matches the forecast to about 1 % on average but up to about 4 % in single ' +
  'cells (V21), and one long forecast-based scenario is still an expected failure.';

// ─────────────────────────────────────────────────────────────────────────────
// Small formatters (never print undefined or NaN)
// ─────────────────────────────────────────────────────────────────────────────

const ok = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);
/** A no-break space between a number and its unit, so "10 m" never breaks across two lines. */
const NB = '\u00a0';
const m = (v: number): string => `${formatCount(Math.round(v))}${NB}m`;
const secs = (v: number): string => (v >= 10 || Math.abs(v - Math.round(v)) < 0.05 ? `${formatNumber(v)}${NB}s` : `${formatNumber(v, 1)}${NB}s`);
const grid2 = (nx: number, ny: number): string => `${formatCount(nx)}${NB}× ${formatCount(ny)}`;
const pct = (f: number): string => `${Math.round(f * 100)}${NB}%`;
const kmh = (ms: number): string => `${formatNumber(ms * 3.6, 1)}${NB}km/h`;
const km = (mm: number): string => `${formatNumber(mm / 1000, mm % 1000 === 0 ? 0 : 1)}${NB}km`;
const bytes = (b: number): string => formatBytes(b);

const TIER_NAME: Record<QualityTier, string> = { fast: 'Fast (surface wind)', standard: 'Standard (3-D air)', high: 'High (finer 3-D air)' };
const CLASS_WORDS: Record<string, string> = { flake: 'stringybark flakes', ribbon: 'ribbon bark', leaf: 'leaves', twig: 'twigs', heavy: 'heavy pieces' };
const FAMILY_WORDS: Record<string, string> = { vesta2: 'forest', grass: 'grass', heath: 'heath and shrubland', pine: 'pine plantations' };

// ─────────────────────────────────────────────────────────────────────────────
// The numbers: from the engine, else planned from the scenario or the request
// ─────────────────────────────────────────────────────────────────────────────

interface AtmNumbers {
  nx: number;
  ny: number;
  nz: number;
  dxM: number;
  dzFirstM: number;
  topM: number;
  /** Planned top: at least this (the real one also depends on the relief). */
  topIsMinimum: boolean;
}

interface Numbers {
  source: 'engine' | 'scenario' | 'request';
  extentM: number;
  fire: { nx: number; ny: number; cellM: number };
  hiResM: number | null;
  /** Tier in use (engine) or requested (planned; may be 'auto'). */
  tier: QualityTier | 'auto';
  /** The 3-D grid of the tier (standard for auto), or the fast tier's fitting grid. */
  atm: AtmNumbers;
  /** The fast tier's fitting grid (planned auto: shown as the alternative). */
  atmFast: AtmNumbers;
  embersMax: number;
  displayStepS: number;
  solverMaxStepS: number;
  durationS: number | null;
  seed: number | null;
}

function plannedAtm(extentM: number, tier: QualityTier): AtmNumbers {
  const t = ATMOS_TIERS[tier];
  const dx = Math.min(ATMOS_PARAMS.maxCellSize, Math.max(ATMOS_PARAMS.minCellSize, extentM / t.nTier));
  const n = Math.max(2, Math.round(extentM / dx)); // core/grid.ts makeGridSpec
  return { nx: n, ny: n, nz: t.levels, dxM: dx, dzFirstM: t.dz1, topM: ATMOS_PARAMS.atmosTop, topIsMinimum: true };
}

function numbersOf(input: ModelCardInput, e: EngineInfo | null): Numbers | null {
  const sc = input.scenario;
  const st = input.settings;
  if (e && !e.mock && sc) {
    const a = e.atmosphere;
    const atm: AtmNumbers = { nx: a.nx, ny: a.ny, nz: a.nz, dxM: a.dxM, dzFirstM: a.dzFirstM, topM: a.topM, topIsMinimum: false };
    return {
      source: 'engine',
      extentM: sc.extent,
      fire: { nx: e.fire.nx, ny: e.fire.ny, cellM: e.fire.cellM },
      hiResM: sc.terrainHiRes?.grid.cellSize ?? null,
      tier: e.tier,
      atm,
      atmFast: a.kind === 'diagnostic' ? atm : plannedAtm(sc.extent, 'fast'),
      embersMax: e.embers.max,
      displayStepS: e.cadence.displayStepS,
      solverMaxStepS: e.cadence.solverMaxStepS,
      durationS: sc.duration,
      seed: e.run.seed,
    };
  }
  if (sc) {
    const g = sc.terrain.grid;
    const tier = sc.options.tier ?? 'auto';
    const grid3: QualityTier = tier === 'high' ? 'high' : tier === 'fast' ? 'fast' : 'standard';
    return {
      source: 'scenario',
      extentM: sc.extent,
      fire: { nx: g.nx, ny: g.ny, cellM: g.cellSize },
      hiResM: sc.terrainHiRes?.grid.cellSize ?? null,
      tier,
      atm: plannedAtm(sc.extent, grid3),
      atmFast: plannedAtm(sc.extent, 'fast'),
      embersMax: sc.options.maxEmbers ?? SIM_PARAMS.maxEmbersByTier[grid3],
      displayStepS: sc.options.snapshotInterval > 0 ? sc.options.snapshotInterval : st.timeStep,
      solverMaxStepS: sc.options.maxStepS ?? st.solverStep,
      durationS: sc.duration,
      seed: sc.options.seed,
    };
  }
  const r = input.request;
  if (!r) return null;
  const tier = r.options?.tier ?? 'auto';
  const grid3: QualityTier = tier === 'high' ? 'high' : tier === 'fast' ? 'fast' : 'standard';
  const built = builtFireCell(r.extent, r.options?.fireCellSize, tier);
  const n = Math.max(2, Math.round(r.extent / built.cellM));
  return {
    source: 'request',
    extentM: r.extent,
    fire: { nx: n, ny: n, cellM: built.cellM },
    // Demo sites carry the 10 m ground model; elsewhere it is made from whatever terrain is found (spec §11.6).
    hiResM: r.demoSiteId ? 10 : null,
    tier,
    atm: plannedAtm(r.extent, grid3),
    atmFast: plannedAtm(r.extent, 'fast'),
    embersMax: r.options?.maxEmbers ?? SIM_PARAMS.maxEmbersByTier[grid3],
    displayStepS: r.options?.snapshotInterval ?? st.timeStep,
    solverMaxStepS: r.options?.maxStepS ?? st.solverStep,
    durationS: r.duration,
    seed: null,
  };
}

const record = (sc: ScenarioData | null, id: string): DatasetRecord | undefined => sc?.datasets?.find((d) => d.id === id);

/** Median stamp spacing of a weather series (s). */
function stampSpacing(w: WeatherSeries): number {
  const h = w.hours;
  const d: number[] = [];
  for (let i = 1; i < h.length; i++) {
    const s = (h[i]!.time - h[i - 1]!.time) / 1000;
    if (s > 0) d.push(s);
  }
  if (!d.length) return 3600;
  d.sort((a, b) => a - b);
  return d[Math.floor(d.length / 2)]!;
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 1: At a glance
// ─────────────────────────────────────────────────────────────────────────────

function atmosphereIs3d(n: Numbers, e: EngineInfo | null): boolean | 'auto' {
  if (e && !e.mock) return e.atmosphere.kind === '3d';
  return n.tier === 'auto' ? 'auto' : n.tier !== 'fast';
}

function describeAtm(a: AtmNumbers): string {
  return (
    `${grid2(a.nx, a.ny)} columns ${m(a.dxM)} apart, ${a.nz} levels from ${m(a.dzFirstM)} thick at the ground ` +
    `up to ${a.topIsMinimum ? 'at least ' : ''}${m(a.topM)} above the lowest ground`
  );
}

function glanceRows(input: ModelCardInput, n: Numbers, e: EngineInfo | null): ModelRow[] {
  const sc = input.scenario;
  const live = !!e && !e.mock;
  const cell = n.fire.cellM;
  const cellTxt = m(cell);
  const dt = live ? e.atmosphere.currentStepS : null;
  const is3d = atmosphereIs3d(n, e);
  const rows: ModelRow[] = [];

  // Terrain
  const terr = record(sc, 'terrain');
  rows.push({
    id: 'terrain',
    component: 'Terrain (the ground)',
    dimensions: '2.5-D: one height for each point, a surface with no overhangs or caves',
    resolution: `${cellTxt} cells for the fire (${grid2(n.fire.nx, n.fire.ny)})${n.hiResM ? `; the ${m(n.hiResM)} ground model for the 3-D view and the air` : ''}`,
    timeStep: 'Fixed for the run',
    method: 'Slope, aspect (the way a slope faces), ridges, gullies and the sun and shade on every slope are worked out from the heights.',
    evidence: terr?.origin === 'synthetic' || (sc && /synthetic/i.test(sc.terrain.source)) ? 'synthetic' : 'measured',
    evidenceNote: sc
      ? `${sc.terrain.source}${terr?.origin === 'synthetic' || /synthetic/i.test(sc.terrain.source) ? ' (no real terrain was available: made-up ground)' : ''}`
      : 'Surveyed heights: the bundled LiDAR model for demo sites, SRTM satellite heights elsewhere',
    specRef: '§0.2, §11.6',
    live: false,
  });

  // Fuel
  const veg = record(sc, 'vegetation-svtm');
  const inferred = veg && (veg.status === 'fallback' || veg.status === 'unavailable' || veg.origin === 'synthetic');
  rows.push({
    id: 'fuel',
    component: 'Fuel (what can burn)',
    dimensions: 'A stack of layers in each cell (litter, near-surface, shrubs, bark, tree canopy): a column per cell, not a 3-D block model',
    resolution: `${cellTxt} cells, each with a hazard score, a load and a height per layer`,
    timeStep: 'Fixed, except for your fuel edits and the fire burning it',
    method:
      'The vegetation map class of each cell becomes a fuel type; fuel builds back up with the years since the last recorded fire (Olson curves). Tree heights and cover come from the canopy-height map.',
    evidence: inferred ? 'synthetic' : 'partly',
    evidenceNote: `${inferred ? 'No vegetation map here: fuel types were inferred from the terrain and canopy. ' : ''}Map-to-fuel rules and load tables are FireSim choices awaiting NSW RFS review (spec §16 items 4–6)`,
    specRef: '§4',
    live: false,
  });

  // Weather forcing
  const w = sc?.weather;
  const levels = w ? Math.max(0, ...w.hours.map((h) => h.pressureLevels?.length ?? 0)) : 0;
  const upper = w?.upperAirSource ?? (levels > 0 ? 'model' : undefined);
  const upperTxt =
    upper === 'model' ? `${levels} upper-air levels from a weather model` : upper === 'preset' ? `${levels} upper-air levels of the designed air mass` : 'no upper-air data: a standard profile is made up';
  const stamp = w ? stampSpacing(w) : 3600;
  const wRec = record(sc, 'weather');
  const wEvidence: EvidenceLevel = wRec && (wRec.origin === 'synthetic' || wRec.status === 'fallback')
    ? 'synthetic'
    : !w
    ? input.request?.weather.kind === 'preset'
      ? 'synthetic'
      : input.request?.weather.kind === 'manual'
        ? 'assumed'
        : 'modelled'
    : w.kind === 'preset'
      ? 'synthetic'
      : w.kind === 'belt-kit'
        ? 'measured'
        : w.kind === 'manual'
          ? 'assumed'
          : 'modelled';
  rows.push({
    id: 'weather',
    component: 'Weather (what drives it)',
    dimensions: 'One point, not a weather map: a time series at one grid point plus a profile of the air above, applied to the whole area',
    resolution: w ? `${formatCount(w.hours.length)} records, about every ${formatStepLabel(stamp)}; ${upperTxt}` : 'Hourly records of the chosen weather (planned)',
    timeStep: `Linear in time between records${w ? ` (every ${formatStepLabel(stamp)})` : ''}`,
    method: `${w ? `${w.source}. ` : ''}The terrain then bends the wind (see Atmosphere); temperature and humidity are adjusted for height.`,
    evidence: wEvidence,
    evidenceNote:
      wEvidence === 'synthetic'
        ? w?.kind === 'preset' || input.request?.weather.kind === 'preset'
          ? 'A designed training day (preset), not a real forecast'
          : `Made-up weather: ${wRec?.fallbackReason ?? 'no weather data could be obtained'}`
        : wEvidence === 'measured'
          ? 'Your belt weather kit readings'
          : wEvidence === 'assumed'
            ? 'Values you typed in'
            : 'A weather model’s forecast or reconstruction for the grid point, not a measurement on this hill',
    specRef: '§8.2, §11.1–11.3',
    live: false,
  });

  // Litter moisture
  const moistS = live ? e.cadence.moistureUpdateS : SIM_PARAMS.solarIntervalS;
  rows.push({
    id: 'moisture',
    component: 'Litter moisture (dead fine fuel)',
    dimensions: '2-D: one value for each cell',
    resolution: `${cellTxt} cells`,
    timeStep: `Updated every ${formatStepLabel(moistS)} of fire time, with the time lag of drying and wetting`,
    method: 'From temperature, humidity, wind, rain and dew, adjusted for sun and shade on each slope, the canopy, and cold air pooling in gullies at night.',
    evidence: 'partly',
    evidenceNote: 'AFDRS moisture equations (verified); the sun, shade and gully adjustment is calibrated only roughly (spec §16 item 8)',
    specRef: '§5',
    live: false,
  });

  // Fire spread
  const bound = live ? e.cadence.solverBoundS : n.tier === 'fast' ? 10 : SIM_PARAMS.dtMaxS;
  const sub = live ? e.fire.currentSubStepS : null;
  const models = live && e.models.spread.length ? e.models.spread.map((s) => `${s.model} (${FAMILY_WORDS[s.family] ?? s.family}, ${pct(s.share)} of the burnable cells)`).join(', ') : null;
  rows.push({
    id: 'fire',
    component: 'Fire spread',
    dimensions: '2-D: a front line moving over the ground surface (a level set)',
    resolution: `${cellTxt} cells (${grid2(n.fire.nx, n.fire.ny)} = ${formatCount(n.fire.nx * n.fire.ny)} cells)`,
    timeStep: live
      ? ok(sub)
        ? ok(dt) && sub >= dt - 1e-6
          ? `One sub-step per ${secs(dt)} step now (the fire is slow enough); sub-steps get shorter when it runs faster (the CFL limit)`
          : `Sub-steps of ${secs(sub)} now, inside each ${ok(dt) ? secs(dt) : 'outer'} step (shorter when the fire is faster: the CFL limit)`
        : `No front is moving yet; sub-steps get shorter as the fire gets faster (the CFL limit), inside each ${ok(dt) ? secs(dt) : 'outer'} step`
      : `Sub-steps as short as the fire speed needs (the CFL limit), inside outer steps of up to ${secs(bound)}`,
    method:
      `Empirical spread rates, fitted to experimental and real Australian fires: ${models ?? 'Vesta Mk2 for forest, CSIRO grassland, AFDRS heath and a pine model, for whichever fuels the map holds'}. ` +
      'Slope and wind speed up the head; the flanks and back follow an ellipse. Flames and the burning itself are not simulated (no 3-D combustion).',
    evidence: 'partly',
    evidenceNote: 'Level-set numerics as in WRF-Fire (verified); the Vesta Mk2 coefficients come from one line of computer code (unverified, spec §16 item 1)',
    specRef: '§6, §7.1–7.5',
    live,
  });

  // Atmosphere
  if (is3d === true) {
    const a = n.atm;
    const floor = live ? e.cadence.solverFloorS : ATMOS_PARAMS.dtMin;
    rows.push({
      id: 'atmosphere',
      component: 'Atmosphere (the air)',
      dimensions: '3-D: the air flow is simulated through time on a terrain-following grid',
      resolution: describeAtm(a),
      timeStep: ok(dt)
        ? `${secs(dt)} now (between ${secs(floor)} and ${secs(bound)}: shorter in strong wind, for stability)`
        : `Between ${secs(floor)} and ${secs(bound)}, shorter in strong wind (for stability)`,
      method:
        'Simplified equations of dry air flow (Boussinesq): the wind is bent by the terrain, sunny slopes draw air up by day, cold air drains down at night, and the fire’s heat drives an indraft and a plume. The flow is gently steered towards the forecast (nudging) so it does not drift away from it.',
      evidence: 'partly',
      evidenceNote: 'Solver numerics follow WRF and WindNinja (verified); the steering strength and edge tapers are FireSim choices (spec §8.4)',
      specRef: '§8.1–8.6',
      live,
    });
  } else if (is3d === false) {
    const a = n.atmFast;
    rows.push({
      id: 'atmosphere',
      component: 'Atmosphere (the air)',
      dimensions: 'Fast mode: a 2-D surface wind worked out from the terrain; no air flow is simulated through time',
      resolution: `The forecast wind fitted to the terrain on ${grid2(a.nx, a.ny)} columns ${m(a.dxM)} apart (${a.nz} levels); the fire uses its surface wind`,
      timeStep:
        `Fitted again for each weather record (every ${formatStepLabel(live ? e.cadence.weatherStampS : stamp)}; every ${formatStepLabel(ATMOS_PARAMS.subStampS)} when the wind turns more than ${ATMOS_PARAMS.subStampDirDeg}° between records) ` +
        `and blended in between${ok(dt) ? `; outer steps of ${secs(dt)}` : ''}`,
      method:
        'A mass-consistent adjustment (as in WindNinja): the forecast wind is bent around hills and through gaps so that no air piles up. Slope winds, calm valleys at night and the fire’s own indraft are added as estimates on the fire grid. There is no plume in the air, and cold air in the valleys at night is an estimate, not a simulated flow.',
      evidence: 'partly',
      evidenceNote: 'The mass-consistent method follows WindNinja (verified); the fire indraft strength is a design choice (spec §16 item 13)',
      specRef: '§8.3, §8.9',
      live,
    });
  } else {
    const a = n.atm;
    const f = n.atmFast;
    rows.push({
      id: 'atmosphere',
      component: 'Atmosphere (the air)',
      dimensions: 'Auto: 3-D air flow if this phone is fast enough, else the fast mode (a 2-D surface wind fitted to the terrain)',
      resolution: `3-D: ${describeAtm(a)}. Fast mode: the forecast wind fitted to the terrain on ${grid2(f.nx, f.ny)} columns`,
      timeStep: `3-D: ${secs(ATMOS_PARAMS.dtMin)} to ${secs(SIM_PARAMS.dtMaxS)}; fast mode: ${secs(10)}`,
      method: `At the start the engine times ${SIM_PARAMS.autoTuneSteps} steps of the 3-D air and keeps it only if the whole run is predicted to finish within the time budget (about ${formatNumber(SIM_PARAMS.autoTuneBudgetS)} s for ${formatDuration(SIM_PARAMS.autoTuneBudgetRefS)} of fire).`,
      evidence: 'partly',
      evidenceNote: 'See the two modes: 3-D (spec §8.4) or fitted surface wind (spec §8.9); the speed rule is spec §12.6',
      specRef: '§8, §12.6',
      live: false,
    });
  }

  // Coupling
  const coupling = live ? e.models.coupling : 1;
  const fastNow = is3d === false;
  rows.push({
    id: 'coupling',
    component: 'Fire and air feedback (coupling)',
    dimensions:
      coupling <= 0
        ? 'Off: one-way, the fire does not change the wind'
        : fastNow
          ? '2-D estimate: the fire’s own indraft on the ground (no plume in the air)'
          : is3d === true
            ? 'Two-way: the fire’s heat warms the 3-D air, and the air’s answer changes the wind at the fire'
            : 'Two-way in 3-D; a 2-D indraft estimate in the fast mode',
    resolution: fastNow ? `Solved on the fire grid coarsened ×2 (${m(2 * cell)} cells)` : `Heat added to the ${m(n.atm.dxM)} air columns; the wind is read back for each ${cellTxt} fire cell`,
    timeStep: fastNow ? `The indraft is solved again every ${formatStepLabel(SIM_PARAMS.fastWindIntervalS)}` : 'Every step, one step behind (at most 12 s): the heat of the previous step',
    method:
      `Coupling strength ${formatNumber(coupling, 2)} (0 = no feedback, 1 = full). The empirical spread rates already include a fire’s usual indraft, so ` +
      (fastNow
        ? 'the part that would hold the front back is removed along the front; the rest mostly pulls fires together at junctions.'
        : 'the part that opposes the head is removed there; on the flanks and behind the fire the simulated indraft acts in full.'),
    evidence: 'assumed',
    evidenceNote: 'How the resolved and the empirical indraft are combined is a FireSim rule (spec §8.8, decisions D30–D32; §16 item 13)',
    specRef: '§8.7–8.8',
    live,
  });

  // Embers
  const emb = live ? e.embers : null;
  const classes = emb && emb.classes.length ? emb.classes : [...EMBER_CLASSES];
  const subMin = emb ? emb.subStepMinS : EMBER_PARAMS.transport.dtMin;
  const subMax = emb ? emb.subStepMaxS : EMBER_PARAMS.transport.dtMax;
  const embersOn = emb ? emb.on : true;
  rows.push({
    id: 'embers',
    component: 'Embers (spotting)',
    dimensions: '3-D: individual particles carried through the air (Lagrangian)',
    resolution: embersOn
      ? `${emb ? `${formatCount(emb.active)} of ` : 'Up to '}${formatCount(n.embersMax)} tracked particles (each can stand for several real firebrands), of ${classes.length} kinds: ${classes.map((c) => CLASS_WORDS[c] ?? c).join(', ')}`
      : 'Switched off (What if)',
    timeStep: embersOn
      ? `Moved every outer step${emb && ok(emb.stepS) ? ` (${secs(emb.stepS)})` : ''} with the wind of that step, in sub-steps of ${secs(subMin)} to ${secs(subMax)}`
      : 'Not running',
    method:
      `Released from the burning front by bark and fuel type, lofted to a ${SIM_PARAMS.emberLoft === 'briggs' ? 'plume-height estimate (Briggs)' : 'plume'}, carried by the modelled wind with random turbulence, burning out in flight; a landing starts a spot fire with a probability that depends on the fuel and its moisture.`,
    evidence: 'partly',
    evidenceNote: 'Flight and burn-out relations are verified (spec §9.6); how many embers a fire makes is not calibrated for Australia, so spot counts are relative (spec §16 item 11)',
    specRef: '§9',
    live,
  });

  // Smoke
  rows.push(
    is3d === true
      ? {
          id: 'smoke',
          component: 'Smoke and plume',
          dimensions: '3-D: a smoke field in the air',
          resolution: `The ${m(n.atm.dxM)} air grid`,
          timeStep: 'Every air step',
          method: 'A passive smoke tracer, released in proportion to the fire’s heat, carried by the 3-D wind and fading over about 3 hours. It does not dim the sun or change the fire.',
          evidence: 'assumed',
          evidenceNote: 'For the picture and the cards; smoke shading of the sun is not modelled (spec §8.7, §16 item 25)',
          specRef: '§8.7',
          live: false,
        }
      : {
          id: 'smoke',
          component: 'Smoke and plume',
          dimensions: is3d === false ? 'Drawn only: a column above the most intense part of the fire' : 'A 3-D field in 3-D mode; only a drawn column in the fast mode',
          resolution: is3d === false ? 'One drawn column' : `The ${m(n.atm.dxM)} air grid (3-D) or one drawn column (fast)`,
          timeStep: 'With each picture',
          method: 'In the fast mode there is no smoke field: the picture rises from the hottest part of the fire and bends with the wind.',
          evidence: 'display',
          evidenceNote: 'Drawn from the fire and the wind; nothing is simulated in the air',
          specRef: '§8.9',
          live: false,
        },
  );

  // Mountain effects
  const mountains = live ? e.models.mountainPhenomena : (sc?.options.mountainPhenomena ?? true);
  rows.push({
    id: 'mountain',
    component: 'Mountain effects',
    dimensions: '2-D rules on the fire grid',
    resolution: `${cellTxt} cells${n.hiResM ? `, with gullies and ridges found on the ${m(n.hiResM)} ground model` : ''}`,
    timeStep: `Every fire step; lee and ridge masks every ${formatStepLabel(SIM_PARAMS.minuteS)} or when the wind turns ${SIM_PARAMS.sectorDeg}°`,
    method: mountains
      ? 'Parameterised, not resolved: eruptive runs up steep gullies and chimneys, sideways spread on lee slopes (VLS), junction zones and rolling debris are rules that speed up the front where the terrain fits the pattern.'
      : 'Switched off (What if): only slope, wind and fuel shape the front.',
    evidence: 'assumed',
    evidenceNote: 'All are FireSim heuristics built from the research reviews (spec §16 item 12)',
    specRef: '§7.6–7.11',
    live,
  });

  // Display
  rows.push({
    id: 'display',
    component: '3-D view (display)',
    dimensions: '3-D rendering of the results',
    resolution: `Ground drawn from the ${n.hiResM ? m(n.hiResM) : cellTxt} model (fewer points on slower phones); trees drawn one by one near the camera`,
    timeStep: `A new picture every ${formatStepLabel(n.displayStepS)} of fire time; the view blends between pictures`,
    method:
      'Trees are decorative: they are placed from the canopy cover and height of each cell and are not simulated one by one. Roads, fire trails, homes and place names are map data drawn in 3-D; the fire model does not use them.',
    evidence: 'display',
    evidenceNote: 'Nothing drawn here feeds back into the simulation',
    specRef: 'ARCHITECTURE: render/',
    live: false,
  });

  // Time
  const speed = input.settings.defaultSpeed > 0 ? input.settings.defaultSpeed : Infinity;
  const checkS = live ? e.cadence.checkpointS : SIM_PARAMS.checkpointIntervalS;
  const ring = live ? e.cadence.checkpointRing : SIM_PARAMS.checkpointRing;
  const solverTxt = n.solverMaxStepS > 0 ? `limited to ${secs(n.solverMaxStepS)} (your setting)` : `automatic (up to ${secs(bound)})`;
  rows.push({
    id: 'time',
    component: 'Time',
    dimensions: 'A simulated clock, independent of the playback speed',
    resolution: `A picture every ${formatStepLabel(n.displayStepS)} (display step)`,
    timeStep: `Solver step ${ok(dt) ? `${secs(dt)} now, ` : ''}${solverTxt}`,
    method:
      `Playback ${formatPlaybackSpeed(speed)}: ${formatSpeedHint(speed).toLowerCase()}. Checkpoints every ${formatStepLabel(checkS)} (${ring} kept, plus the start) let a change re-run from the last one; ` +
      `the same choices give exactly the same result${n.seed !== null ? ` (seed ${n.seed})` : ''}.`,
    evidence: 'verified',
    evidenceNote: 'Bitwise-identical re-runs are tested (spec §12.5, validation V18)',
    specRef: '§12.2–12.6',
    live,
  });
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 2: what it can and cannot resolve
// ─────────────────────────────────────────────────────────────────────────────

function limitBullets(input: ModelCardInput, n: Numbers, e: EngineInfo | null): { can: CardBullet[]; cannot: CardBullet[]; param: CardBullet[] } {
  const live = !!e && !e.mock;
  const is3d = atmosphereIs3d(n, e);
  const dx = is3d === false ? n.atmFast.dxM : n.atm.dxM;
  const smallest = 2 * dx;
  const cell = n.fire.cellM;
  const extent = km(n.extentM);
  const cap = live ? e.fire.maxSpreadRate : SPREAD_PARAMS.levelSet.rosMaxMs;
  const forestCap = live ? e.fire.forestHeadCapMs : FIRE_MODEL_PARAMS.forestCapMh / 3600;
  const left = input.snapshot?.stats.embersLeftDomain;
  const w = input.scenario?.weather;
  const can: CardBullet[] = [
    { kind: 'can', text: `Slopes, aspects and gullies of about ${m(cell)} and larger shape the fire’s spread (the fire grid).`, ref: '§7' },
    {
      kind: 'can',
      text:
        is3d === false
          ? `Hills and valleys wider than about ${m(smallest)} (twice the ${m(dx)} wind grid) bend the fitted wind.`
          : `Hills, valleys and ridges wider than about ${m(smallest)} (twice the ${m(dx)} air grid) shape the 3-D wind.`,
      ref: '§8.1',
    },
    { kind: 'can', text: `Weather changes that are in the ${w ? 'weather series' : 'chosen weather'}, at their times (a wind change turns the flank into the head).`, ref: '§11' },
    { kind: 'can', text: `Spot fires anywhere inside the ${extent} square.`, ref: '§9.5' },
  ];
  const cannot: CardBullet[] = [
    {
      kind: 'cannot',
      text: `A single gully, spur or saddle narrower than about ${m(smallest)} is smoothed out of the ${is3d === false ? 'fitted wind' : 'air flow'}, and slopes are smoothed to at most ${ATMOS_PARAMS.maxSmoothedSlopeDeg}° for the air (the fire still sees the ${m(cell)} slopes).`,
      ref: '§8.1',
    },
    {
      kind: 'cannot',
      text: `Anything smaller than one ${m(cell)} fire cell — a narrow track, a creek, a rock ledge, a single tree — is averaged into its cell. A narrow break only stops the fire where the map or your fuel brush makes the cell non-fuel.`,
      ref: '§0.2',
    },
    { kind: 'cannot', text: 'Flames, fire whirls and the burning itself: the fire is a moving line with a spread rate, not a 3-D simulation of combustion.', ref: '§6–7' },
    { kind: 'cannot', text: 'Radiant heat on trees, people or houses: the dead man zone overlay is a rule of thumb, not a heat calculation.', ref: '§10.5' },
    { kind: 'cannot', text: 'Smoke chemistry, visibility, or the smoke you would breathe.', ref: '§8.7' },
    {
      kind: 'cannot',
      text: `Spot fires beyond the edge of the ${extent} square: embers that leave it are only counted${ok(left) ? ` (${formatCount(left)} so far)` : ''}.`,
      ref: '§9.5',
    },
    {
      kind: 'cannot',
      text: 'Weather that is not in the series: a thunderstorm, a sea breeze or a change arriving at another time. The series is one point, so a change reaches the whole square at once instead of sweeping across it.',
      ref: '§11.1',
    },
    {
      kind: 'cannot',
      text: 'Real observations during the run (no data assimilation): the model does not learn from satellite hot spots, line scans or radio reports. Only your marks and edits change it.',
      ref: '§12',
    },
    { kind: 'cannot', text: 'Firefighting: containment lines, water and aircraft are not modelled (you can mark back burns and fuel edits).', ref: '§11.5' },
    {
      kind: 'cannot',
      text: `Spread faster than ${kmh(cap)} anywhere (a numerical limit), or forest head fires faster than ${kmh(forestCap)} (a model limit).`,
      ref: '§7.2, D4',
    },
  ];
  if (is3d === false) cannot.push({ kind: 'cannot', text: 'In the fast mode: the plume, moving cold-air pools and the cross-section of the air need the 3-D atmosphere.', ref: '§8.9' });
  const param: CardBullet[] = [
    { kind: 'parameterised', text: 'Eruptive fire in steep gullies and chimneys, sideways spread on lee slopes (VLS), junction zones and rolling debris (the mountain effects).', ref: '§7.6–7.11' },
    { kind: 'parameterised', text: `Slope winds too small for the ${m(dx)} grid: a sub-grid estimate is added to the wind at the fire.`, ref: '§8.6' },
    { kind: 'parameterised', text: 'The wind under the trees: a wind reduction factor for each cell.', ref: '§4.7' },
    { kind: 'parameterised', text: 'Crown fire: a phase of the forest spread model, not trees catching one by one.', ref: '§6.2' },
    { kind: 'parameterised', text: 'Gusts that scatter embers: random turbulence from standard boundary-layer rules.', ref: '§9.3' },
  ];
  if (SIM_PARAMS.emberLoft === 'briggs') param.push({ kind: 'parameterised', text: 'How high embers are lifted: a plume-rise estimate (Briggs), not the modelled updraft.', ref: '§9.3' });
  if (is3d !== false) param.push({ kind: 'parameterised', text: 'Drag of the forest on the air: a roughness worked out from tree height and cover.', ref: '§8.1' });
  if (is3d !== true) param.push({ kind: 'parameterised', text: 'The fire’s own indraft in the fast mode: a 2-D estimate on the ground instead of a simulated plume.', ref: '§8.8' });
  return { can, cannot, param };
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 4: data in this run (short; the Data sets screen has the detail)
// ─────────────────────────────────────────────────────────────────────────────

function dataFacts(input: ModelCardInput, e: EngineInfo | null): CardBlock[] {
  const sc = input.scenario;
  const action: CardBlock = { type: 'action', action: 'open-datasets', label: 'Open the data sets' };
  if (!sc) return [{ type: 'text', text: 'Opened before a run: the Data sets screen lists what your Setup choice will download or read, and what is stored on this phone.' }, action];
  const s = sc.datasetSummary;
  if (!s) return [{ type: 'text', text: 'This scenario carries no data inventory (it was built by the demo builder or an older version).' }, action];
  const t = s.totals;
  const b = t.byStatus;
  const parts = [`${b.used} used`, b.partial ? `${b.partial} partly` : '', b.fallback ? `${b.fallback} substitutes` : '', b.unavailable ? `${b.unavailable} not available` : '', b.skipped ? `${b.skipped} not needed` : '', b.user ? `${b.user} yours` : '']
    .filter(Boolean)
    .join(', ');
  const unmeasured = (t.networkUnmeasuredBytes ?? 0) > 0;
  const facts: CardFact[] = [
    { id: 'data-count', key: 'Data sets', value: `${formatCount(t.count)} (${parts})` },
    {
      id: 'data-network',
      key: 'Downloaded',
      value: t.networkBytes > 0 ? `${unmeasured ? 'up to ' : ''}${bytes(t.networkBytes)}` : 'Nothing (all from the app or this phone)',
      ...(unmeasured ? { note: 'The phone does not report the compressed size of some answers, so this is an upper bound.' } : {}),
    },
    { id: 'data-local', key: 'Read from the app or this phone', value: bytes(Math.max(0, t.transferredBytes - t.networkBytes)) },
    { id: 'data-memory', key: 'Held in memory (the data sets)', value: bytes(t.memoryBytes) },
    {
      id: 'data-fallbacks',
      key: 'Not real data, or only partly',
      value: s.fallbacks.length ? s.fallbacks.map((f) => f.title).join(', ') : 'None: every data set is real and complete',
    },
  ];
  if (s.workingMemory) facts.push({ id: 'data-working', key: 'Working memory of this run (estimated)', value: bytes(s.workingMemory.totalBytes), note: 'Screen, engine and graphics together, worked out from the grid sizes' });
  if (e && !e.mock && e.memory) facts.push({ id: 'data-engine-memory', key: 'Engine memory (measured)', value: bytes(e.memory.totalBytes), live: true, note: `Measured at ${formatDuration(e.memory.measuredAt)} of fire time` });
  return [{ type: 'facts', facts }, action];
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 5: layers
// ─────────────────────────────────────────────────────────────────────────────

function layerScenario(input: ModelCardInput, n: Numbers | null, e: EngineInfo | null): LayerScenario {
  const sc = input.scenario;
  const out: LayerScenario = {};
  if (n) out.fireCellSize = n.fire.cellM;
  if (e && !e.mock) out.atmosphereCellSize = Math.round(e.atmosphere.dxM);
  else if (n) out.atmosphereCellSize = Math.round((n.tier === 'fast' ? n.atmFast : n.atm).dxM);
  if (sc) {
    out.terrainSource = sc.terrain.source;
    out.fuelSources = sc.fuel.sources;
    if (sc.context) out.context = sc.context;
    const img = record(sc, 'imagery');
    if (img?.model?.resolutionM) out.imageryCellSize = img.model.resolutionM;
  }
  return out;
}

/** What can be shown in this run now (the catalog's flags; the 3-D air from the engine's report, the photo from the inventory). */
function availabilityOf(input: ModelCardInput, e: EngineInfo | null): AvailabilityContext | null {
  const sc = input.scenario;
  if (!sc) return null;
  const img = record(sc, 'imagery');
  const ctx = availabilityContext({ fuel: sc.fuel, context: sc.context ?? null, fire: (input.snapshot?.stats.burntAreaHa ?? 0) > 0, hasImagery: !!img && (img.status === 'used' || img.status === 'partial') });
  ctx.has3dAtmosphere = e ? !e.mock && e.atmosphere.kind === '3d' : (input.snapshot?.atmosphere?.nz ?? 0) > 0;
  return ctx;
}

function layersBlock(input: ModelCardInput, n: Numbers | null, e: EngineInfo | null): CardBlock {
  const ls = layerScenario(input, n, e);
  const avail = availabilityOf(input, e);
  const used = new Set<LayerDimension>();
  const groups = LAYER_GROUPS.map((g) => {
    const layers = LAYER_CATALOG.filter((l) => l.group === g).map((l): LayerLine => {
      used.add(l.dimension);
      const a = avail ? l.available(avail) : null;
      return { id: l.id, title: l.title, kind: l.kind, dimension: l.dimension, resolution: l.resolution(ls), what: l.what, ...(a && !a.ok && a.reason ? { unavailable: a.reason } : {}) };
    });
    return { title: g, blurb: LAYER_GROUP_BLURBS[g], layers };
  });
  const dims = (Object.keys(DIMENSION_HELP) as LayerDimension[]).filter((d) => used.has(d)).map((d) => ({ dimension: d, help: DIMENSION_HELP[d] }));
  return { type: 'layers', dimensions: dims, groups };
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 6: the engine right now
// ─────────────────────────────────────────────────────────────────────────────

/** Settings → Performance labels (screens/settings.ts). */
const PERFORMANCE_LABEL: Record<Settings['performance'], string> = { battery: 'Saver', auto: 'Balanced', quality: 'Detail' };

function tierWords(e: EngineInfo, settings: ModelCardInput['settings']): string {
  switch (e.tierCause) {
    case 'requested':
      return e.tier === 'fast'
        ? `Asked for at the start (${settings.performance === 'battery' ? 'performance: Saver' : 'the Fast detail option in Setup'}).`
        : `Asked for at the start (performance: ${PERFORMANCE_LABEL[settings.performance]}).`;
    case 'changed':
      return `${e.tierReason} Changes come from Settings → Performance or the Layers panel’s “Use the 3-D atmosphere”.`;
    default:
      return e.tierReason;
  }
}

function engineFacts(input: ModelCardInput, n: Numbers | null, e: EngineInfo | null): CardBlock[] {
  if (input.engineSource === 'mock' || e?.mock) {
    return [
      {
        type: 'text',
        tone: 'warn',
        text: 'The demo engine is running: a stand-in used when the simulation cannot load (or with ?mock=1). It draws a plausible fire with a simple travel-time search on the terrain grid. None of the physics described on this page is being computed, so there are no live engine values.',
      },
    ];
  }
  if (!e) {
    return [
      {
        type: 'text',
        text: input.scenario
          ? 'The engine has not reported yet (it does with its first picture). The numbers on this page are planned from the scenario.'
          : 'Opened before a run: there is no engine yet. The numbers on this page are planned from your Setup choice; open this page again during a run for live values.',
      },
    ];
  }
  const a = e.atmosphere;
  const facts: CardFact[] = [
    { id: 'eng-tier', key: 'Atmosphere tier', value: TIER_NAME[e.tier], note: tierWords(e, input.settings), live: true },
    {
      id: 'eng-step',
      key: 'Outer step (air, fire and embers step together)',
      value: ok(a.currentStepS) ? secs(a.currentStepS) : 'Not started',
      note:
        e.cadence.solverMaxStepS > 0
          ? `Limited to ${secs(e.cadence.solverMaxStepS)} by your solver step setting`
          : e.cadence.solverFloorS === e.cadence.solverBoundS
            ? `Automatic: fixed at ${secs(e.cadence.solverBoundS)} in the fast mode`
            : `Automatic: ${secs(e.cadence.solverFloorS)} to ${secs(e.cadence.solverBoundS)}, shorter in strong wind`,
      live: true,
    },
    { id: 'eng-substep', key: 'Fire sub-step', value: ok(e.fire.currentSubStepS) ? secs(e.fire.currentSubStepS) : 'No front moving', live: true },
    {
      id: 'eng-speed',
      key: 'Computing speed on this phone',
      value: ok(e.run.simSecondsPerWallSecond) ? `${formatCount(Math.round(e.run.simSecondsPerWallSecond))} s of fire per second` : 'Not measured yet',
      note: ok(e.run.meanStepMs)
        ? `One step takes ${formatNumber(e.run.meanStepMs, e.run.meanStepMs < 10 ? 1 : 0)} ms${ok(a.meanStepMs) ? `, of which the air ${formatNumber(a.meanStepMs, a.meanStepMs < 10 ? 1 : 0)} ms` : ''} (average for this tier)`
        : undefined,
      live: true,
    },
    {
      id: 'eng-playback',
      key: 'Playback speed (your setting)',
      value: formatPlaybackSpeed(input.settings.defaultSpeed > 0 ? input.settings.defaultSpeed : Infinity),
      note: formatSpeedHint(input.settings.defaultSpeed > 0 ? input.settings.defaultSpeed : Infinity),
      live: true,
    },
    { id: 'eng-display', key: 'Display step', value: `A picture every ${formatStepLabel(e.cadence.displayStepS)}`, live: true },
    {
      id: 'eng-embers',
      key: 'Embers in the air',
      value: e.embers.on ? `${formatCount(e.embers.active)} of ${formatCount(e.embers.max)} tracked` : 'Switched off',
      live: true,
    },
    {
      id: 'eng-checkpoints',
      key: 'Checkpoints (rewind points)',
      value: `${e.run.checkpoints} held, ${bytes(e.run.checkpointBytes)}`,
      note: `One every ${formatStepLabel(e.cadence.checkpointS)}; a change in the past re-runs from the one before it`,
      live: true,
    },
  ];
  if (ok(input.historyBudgetBytes)) {
    facts.push({ id: 'eng-history', key: 'Time-scrubber history', value: `Up to ${bytes(input.historyBudgetBytes)} on this phone`, note: 'Older pictures are thinned beyond that; the fire front of any time is still rebuilt exactly', live: false });
  }
  if (e.memory) facts.push({ id: 'eng-memory', key: 'Engine memory (measured)', value: bytes(e.memory.totalBytes), note: `Measured at ${formatDuration(e.memory.measuredAt)} of fire time`, live: true });
  facts.push({ id: 'eng-seed', key: 'Seed', value: String(e.run.seed), note: e.run.deterministic ? 'The same choices give exactly the same result' : undefined, live: false });
  if (n && a.viewDecimated) facts.push({ id: 'eng-view', key: 'Air in the pictures', value: 'Halved for display', note: 'The solver grid is as above; the pictures carry every second column', live: true });
  return [{ type: 'facts', facts }];
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 7: words used
// ─────────────────────────────────────────────────────────────────────────────

export const GLOSSARY: readonly { term: string; gloss: string }[] = [
  { term: '2-D, 2.5-D, 3-D', gloss: '2-D: a map (one value per place). 2.5-D: a surface with one height per place, like the ground. 3-D: a volume with height as well, like the air.' },
  { term: 'Grid, cell', gloss: 'The area is cut into squares (cells); the model keeps one value of each quantity per cell.' },
  { term: 'Resolved', gloss: 'Worked out by the model from its equations on its grid.' },
  { term: 'Parameterised', gloss: 'Too small or too complex to simulate, so a rule or formula stands in for it.' },
  { term: 'Empirical model', gloss: 'Formulas fitted to measurements of real and experimental fires, not derived from physics.' },
  { term: 'Level set', gloss: 'A way to move a front line across a grid smoothly, cell by cell.' },
  { term: 'Head, flank, back', gloss: 'The fastest part of the fire front, its sides, and the part that backs into the wind or downhill.' },
  { term: 'Time step, sub-step', gloss: 'How far the clock jumps between two calculations; a sub-step is a smaller jump inside one step.' },
  { term: 'CFL limit', gloss: 'A step must be short enough that nothing moves more than about one cell in it; faster fire or wind means shorter steps.' },
  { term: 'Tier', gloss: 'How much of the air the phone simulates: Fast (a fitted surface wind), Standard (3-D air) or High (finer 3-D air).' },
  { term: 'Mass-consistent wind', gloss: 'A wind adjusted so that no air piles up or disappears: it flows around hills and through gaps.' },
  { term: 'Boussinesq flow', gloss: 'A standard simplification of the equations of moving air, good for winds near the ground.' },
  { term: 'Terrain-following grid', gloss: 'Air levels that follow the shape of the ground near the surface and flatten out higher up.' },
  { term: 'Nudging', gloss: 'Gently pulling the simulated wind back towards the forecast so the two do not drift apart.' },
  { term: 'Spin-up', gloss: 'A short warm-up of the air before the start, so it has settled over the terrain.' },
  { term: 'Coupling', gloss: 'The fire changing the wind (its heat draws air in and lifts a plume) and the wind changing the fire.' },
  { term: 'Indraft, plume', gloss: 'Air drawn in towards a fire at the ground, and the column of hot air and smoke rising above it.' },
  { term: 'Lagrangian particles', gloss: 'Things tracked one by one as they move (here the embers), rather than as amounts in grid cells.' },
  { term: 'Litter moisture', gloss: 'Water in the dead leaves, bark and twigs on the ground (dead fine fuel), in % of their dry weight.' },
  { term: 'Upper air', gloss: 'Temperature, humidity and wind at heights above the ground; they decide how high a plume can rise.' },
  { term: 'Checkpoint', gloss: 'A saved copy of the whole simulation at one moment, so it can re-run from there.' },
  { term: 'Seed, deterministic', gloss: 'The seed fixes the random numbers, so the same choices always give exactly the same result.' },
  { term: 'Data assimilation', gloss: 'Feeding real observations into a running model to correct it. FireSim does not do this.' },
  { term: 'Evidence tags', gloss: 'The specification marks each formula: [V] verified, [K] standard literature value, [D] derived, [H] FireSim heuristic, UNVERIFIED could not be confirmed.' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Headline and the whole card
// ─────────────────────────────────────────────────────────────────────────────

function headlineOf(mode: ModelCard['mode'], n: Numbers | null, e: EngineInfo | null): string {
  if (mode === 'mock') return 'Demo engine: the fire on screen is drawn by a simple stand-in, not simulated.';
  if (!n) return 'Choose a place and the weather in Setup to see how this simulation will work.';
  const lead = mode === 'live' ? '' : 'Planned: ';
  const fire = `${lead}${lead ? 'fire' : 'Fire'} spreads in 2-D on a ${m(n.fire.cellM)} grid`;
  const is3d = atmosphereIs3d(n, e);
  if (is3d === true) return `${fire}; the air above it is simulated in 3-D (${grid2(n.atm.nx, n.atm.ny)}${NB}× ${n.atm.nz} cells, ${m(n.atm.dxM)} apart).`;
  if (is3d === false) return `${fire}; the wind is a 2-D surface field fitted to the terrain (fast mode, no 3-D air flow).`;
  return `${fire}; the air is simulated in 3-D (${grid2(n.atm.nx, n.atm.ny)}${NB}× ${n.atm.nz} cells, ${m(n.atm.dxM)} apart) if this phone is fast enough, else the wind is a 2-D surface field (fast mode).`;
}

/** The whole card (pure). */
export function describeModel(input: ModelCardInput): ModelCard {
  const rawEngine = input.engine ?? input.snapshot?.engine ?? null;
  const mock = input.engineSource === 'mock' || !!rawEngine?.mock;
  const e = mock ? null : rawEngine;
  const mode: ModelCard['mode'] = mock ? 'mock' : e && input.scenario ? 'live' : input.scenario ? 'planned' : 'preview';
  const n = numbersOf(input, e);
  const sections: ModelSection[] = [];
  if (n) {
    const rows = glanceRows(input, n, e);
    sections.push({
      id: 'glance',
      title: 'At a glance',
      summary: 'Each part of the simulation: its dimensions, how fine it is, how often it is updated, and how well it is backed.',
      blocks: [
        ...(mock ? [{ type: 'text' as const, tone: 'warn' as const, text: 'The demo engine is running: the rows below describe the real simulation as planned for this scenario, not what is on screen.' }] : []),
        { type: 'rows', rows },
        {
          type: 'legend',
          title: 'What the badges mean',
          items: (Object.keys(EVIDENCE) as EvidenceLevel[]).filter((l) => rows.some((r) => r.evidence === l)).map((level) => ({ level, label: EVIDENCE[level].label, gloss: EVIDENCE[level].gloss })),
        },
      ],
      live: mode === 'live',
    });
    const lim = limitBullets(input, n, e);
    sections.push({
      id: 'limits',
      title: 'What it can and cannot resolve',
      summary: `The smallest things each grid can show, and what is a rule instead of a simulation.`,
      blocks: [
        { type: 'bullets', title: 'Represented', bullets: lim.can },
        { type: 'bullets', title: 'Not represented', bullets: lim.cannot },
        { type: 'bullets', title: 'Parameterised (a rule stands in for it)', bullets: lim.param },
      ],
      live: false,
    });
  }
  const slopeMax = e ? e.fire.validSlopeDeg[1] : FIRE_MODEL_PARAMS.slope.validMaxDeg;
  sections.push({
    id: 'sure',
    title: 'How sure are we?',
    summary: 'The evidence behind the model, its known open issues and how it was tested.',
    blocks: [
      {
        type: 'text',
        tone: 'warn',
        text: `On slopes steeper than about ${slopeMax}° and in extreme weather, real fires are often faster than any model: heads on such slopes are flagged “not validated”. Use the results to understand fire behaviour, never to decide what is safe.`,
      },
      {
        type: 'facts',
        title: `Evidence tags in the model chapters of the specification (${SPEC_EVIDENCE.chapters})`,
        facts: [
          { id: 'ev-v', key: 'Verified against a primary source [V]', value: String(SPEC_EVIDENCE.verified) },
          { id: 'ev-k', key: 'Standard literature values [K]', value: String(SPEC_EVIDENCE.literature) },
          { id: 'ev-d', key: 'Derived by calculation [D]', value: String(SPEC_EVIDENCE.derived) },
          { id: 'ev-h', key: 'FireSim heuristics [H]', value: String(SPEC_EVIDENCE.heuristic) },
          { id: 'ev-u', key: 'Could not be confirmed (UNVERIFIED)', value: String(SPEC_EVIDENCE.unverified) },
        ],
      },
      {
        type: 'bullets',
        title: 'Open issues that change numbers on screen (spec §16)',
        bullets: SPEC_OPEN_ISSUES.map((i) => ({ kind: 'issue' as const, text: `${i.plain} Affects: ${i.affects}.`, ref: `§16 item ${i.item}` })),
      },
      { type: 'text', text: VALIDATION_SUMMARY },
    ],
    live: false,
  });
  sections.push({ id: 'data', title: 'Data in this run', summary: 'How many data sets, how much was downloaded, and what stood in for missing data.', blocks: dataFacts(input, e), live: mode === 'live' });
  sections.push({ id: 'layers', title: 'Layers and what they show', summary: 'Every map layer: drawn on the ground, as objects, or through the air, and how fine it is.', blocks: [layersBlock(input, n, e)], live: false });
  sections.push({ id: 'engine', title: 'Engine right now', summary: mode === 'live' ? 'Live values from the running engine.' : 'Live values appear here during a run.', blocks: engineFacts(input, n, e), live: mode === 'live' });
  sections.push({ id: 'words', title: 'Words used', summary: 'The technical words on this page in plain English.', blocks: [{ type: 'glossary', terms: [...GLOSSARY] }], live: false });
  const subtitle =
    mode === 'live'
      ? 'Live values from the running engine, updated every second while this page is open.'
      : mode === 'planned'
        ? 'Planned values: the engine has not reported yet.'
        : mode === 'preview'
          ? 'A preview of your Setup choice: the numbers are planned with the rules the builder and the engine use.'
          : 'The demo engine is running: nothing here is being simulated.';
  return { mode, title: 'How this simulation works', headline: headlineOf(mode, n, e), subtitle, sections };
}

// ─────────────────────────────────────────────────────────────────────────────
// Copy as text
// ─────────────────────────────────────────────────────────────────────────────

/** The card as plain text (every row, fact, bullet, layer and term), for "Copy as text". */
export function cardToText(card: ModelCard): string {
  const out: string[] = ['TRAINING AID · NOT FOR OPERATIONAL USE', '', card.title, card.headline, card.subtitle];
  for (const s of card.sections) {
    out.push('', `== ${s.title} ==`);
    for (const b of s.blocks) {
      switch (b.type) {
        case 'rows':
          for (const r of b.rows) {
            out.push(
              '',
              `${r.component}${r.live ? ' (live)' : ''}`,
              `  Dimensions: ${r.dimensions}`,
              `  Resolution: ${r.resolution}`,
              `  Time step: ${r.timeStep}`,
              `  Method: ${r.method}`,
              `  Evidence: ${EVIDENCE[r.evidence].label}: ${r.evidenceNote} (spec ${r.specRef})`,
            );
          }
          break;
        case 'facts':
          if (b.title) out.push('', b.title);
          for (const f of b.facts) out.push(`  ${f.key}: ${f.value}${f.note ? ` (${f.note})` : ''}`);
          break;
        case 'bullets':
          if (b.title) out.push('', b.title);
          for (const x of b.bullets) out.push(`  - ${x.text}${x.ref ? ` [${x.ref}]` : ''}`);
          break;
        case 'text':
          out.push('', b.text);
          break;
        case 'layers':
          for (const d of b.dimensions) out.push(`  ${d.dimension}: ${d.help}`);
          for (const g of b.groups) {
            out.push('', g.title);
            for (const l of g.layers)
              out.push(`  - ${l.title} (${l.kind === 'heat' ? 'heat map' : l.kind === 'scene' ? 'on/off layer' : 'layer and heat map'}): ${l.dimension}; ${l.resolution}${l.unavailable ? ` (not available now: ${l.unavailable})` : ''}`);
          }
          break;
        case 'glossary':
          for (const t of b.terms) out.push(`  ${t.term}: ${t.gloss}`);
          break;
        case 'legend':
          out.push('', b.title);
          for (const i of b.items) out.push(`  ${i.label}: ${i.gloss}`);
          break;
        case 'action':
          break;
      }
    }
  }
  return out.join('\n');
}
