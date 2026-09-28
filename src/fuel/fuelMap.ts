/**
 * `buildFuelMap` (spec §4.7), the per-cell writer shared with fuel edits (§4.8), `fuelParamsAt` (§2.1 CellFuelParams)
 * and `fuelSummary` ("Why here?").
 *
 * Per cell: class → FuelType (inference where 255, §4.3) → layer loads and FHS via §4.5 → barkHazard → heights (class;
 * post-fire factor) → canopy: height/cover from the CHM where valid, else the type default;
 * H_o,eff = max(CHM p90, 0.8·type H_o) (type H_o where the CHM is invalid; 0 for grass/heath/none without trees) →
 * WRF: class WRF blended towards the post-fire value (WRF − 1, min 1.5) by w, −0.5 on exposed ridges
 * (Ridge/Peak/Spur and CHM p90 < 12 m) except for the wetForest moisture family (D10), −1 for vesta2 with cover < 0.3,
 * clamp [1.5, 6] (vesta2, pine and heath families; grass and none keep the class WRF, which only feeds the moisture
 * model's litter wind) → curing clamp(C_month − 15·[z > 1400 m] + curingOffset + 3·(DF − 5), 20, 100) → grass state
 * from the grass load (≥ 6 natural, 3–6 grazed, < 3 eaten out [V FBI-TG]; class/type overrides) → flags → moisture
 * offset (class 34: +3 pp while KBDI < 100).
 *
 * Fuel-private extension fields (optional, typed arrays or plain data, so they survive structured clone and the UI's
 * cloneFuel): `faBlendW` (§5.9 w for every cell), `cellContext` (CHM/terrain bits edits need), `syntheticBurnTime`
 * (setTimeSinceFire overrides), `severity` (FESM code), `buildContext` (t0, DF, KBDI, month, params).
 */
import type { GridSpec } from '../core/grid';
import { FuelFlag, FuelType, Landform, type CellFuelParams, type FuelMap, type GrassState, type Terrain } from '../core/types';
import { clamp, smoothstep, DEG } from '../core/units';
import type { TerrainDerived } from '../terrain';
import { accumulate, loadCellHistory, makeCellHistory, makeFuelState, syntheticCellHistory, type CellHistory, type FuelState } from './accumulation';
import { CLASS_INFER, FUEL_CLASS_COUNT, FUEL_TYPES, resolveClass, tfiMinYears, type ResolvedFuelClass } from './catalogue';
import { ratingFromFhs } from './hazard';
import type { HistoryRaster } from './history';
import { inferFuelTypes } from './infer';
import { FUEL_PARAMS, resolveFuelParams, YEAR_MS, type FuelParams } from './params';
import { SVTM_SOURCE } from './svtm';

/** Build inputs (spec §4.7; `minorityWet`, `severity`, `sources` are extensions). */
export interface BuildFuelArgs {
  terrain: Terrain /* fire grid */;
  derived: TerrainDerived;
  classId: Uint8Array /* rasteriseVegetation or 255 */;
  history?: HistoryRaster;
  canopy?: { height: Float32Array; cover: Float32Array; valid: Uint8Array } | null;
  t0: number;
  droughtFactor: number;
  kbdi: number;
  /** Local month 1–12. */
  month: number;
  params?: Partial<FuelParams>;
  /** rasteriseVegetation().minorityWet → FuelFlag.WetGullyMinority. */
  minorityWet?: Uint8Array;
  /** FESM severity per cell: 0 unknown, 1 low/moderate, 2 high/extreme (§4.5 post-fire weight). */
  severity?: Uint8Array;
  /** Extra provenance strings appended to `sources`. */
  sources?: string[];
}

/** Scenario-level values the per-cell writer needs (kept on the map for edits). */
export interface FuelBuildContext {
  t0: number;
  droughtFactor: number;
  kbdi: number;
  month: number;
  params?: Partial<FuelParams>;
}

/** FuelMap plus the fuel-private optional fields (see module doc). */
export interface FuelMapExt extends FuelMap {
  faBlendW?: Float32Array;
  cellContext?: Uint8Array;
  syntheticBurnTime?: Float64Array;
  severity?: Uint8Array;
  buildContext?: FuelBuildContext;
}

/** `cellContext` bits. */
export const CTX_CHM_VALID = 1;
export const CTX_RIDGE = 2;
export const CTX_HIGH_ELEV = 4;
export const CTX_CLIFF = 8;
export const CTX_INFERRED = 16;
export const CTX_MINORITY_WET = 32;

/** Flags that belong to the cell, not to its fuel state (kept when the writer recomputes a cell). */
const STICKY_FLAGS = FuelFlag.UserEdited | FuelFlag.Road;

/** Everything the per-cell writer reads besides the cell's class and history. */
export interface CellWriteEnv {
  P: FuelParams;
  t0: number;
  droughtFactor: number;
  kbdi: number;
  month: number;
  state: FuelState;
}

/** Grass state from the grass load L_g = s + ns [V FBI-TG]. */
export const grassStateFromLoad = (lg: number): GrassState => (lg >= 6 ? 'natural' : lg >= 3 ? 'grazed' : 'eatenOut');

/** Moisture offset (pp) a class adds at this KBDI (class 34: +3 while KBDI < 100). */
export function classMoistureOffset(cls: ResolvedFuelClass, kbdi: number): number {
  const m = cls.moistureOffsetIfKbdiBelow;
  return m && kbdi < m.kbdi ? m.pp : 0;
}

/** Grass curing (%) of §4.7 for a class, month, elevation bit and DF. */
export function curingFor(cls: ResolvedFuelClass, month: number, highElev: boolean, df: number, P: FuelParams): number {
  if (cls.family === 'none') return 0;
  const cm = P.curingMonthly[clamp(Math.round(month), 1, 12) - 1]!;
  return clamp(cm - (highElev ? P.curingHighElevDelta : 0) + cls.curingOffset + P.curingDfSlope * (df - P.curingDfRef), P.curingMin, P.curingMax);
}

/** H_o,eff of §4.7. */
export function canopyHeightEffFor(cls: ResolvedFuelClass, chmValid: boolean, chmHeight: number, underWoodland: boolean, P: FuelParams): number {
  const hType = cls.canopyHeight;
  switch (cls.family) {
    case 'none':
      return 0;
    case 'heath':
      return underWoodland ? chmHeight : 0;
    case 'grass':
      if (!(hType > 0)) return 0;
      return chmValid ? Math.max(chmHeight, P.hOEffTypeFactor * hType) : hType;
    default:
      return chmValid ? Math.max(chmHeight, P.hOEffTypeFactor * hType) : hType;
  }
}

/** Ensure every optional per-cell array the writer fills exists on the map. */
export function ensureFuelArrays(f: FuelMapExt): Required<Pick<FuelMapExt, 'fuelClass' | 'wrf' | 'canopyLoad' | 'canopyHeightEff' | 'flags' | 'moistureOffset' | 'fireCount30' | 'fireCountTfi'>> {
  const n = f.type.length;
  f.fuelClass ??= Uint8Array.from(f.type);
  f.wrf ??= new Float32Array(n).fill(NaN);
  f.canopyLoad ??= new Float32Array(n).fill(NaN);
  f.canopyHeightEff ??= new Float32Array(n).fill(NaN);
  f.flags ??= new Uint16Array(n);
  f.moistureOffset ??= new Float32Array(n);
  f.fireCount30 ??= new Uint8Array(n);
  f.fireCountTfi ??= new Uint8Array(n);
  return f as Required<FuelMapExt>;
}

/**
 * Write every fuel-state field of cell k from its class and fire records (§4.5, §4.7). Does not touch
 * `moistureOffset` (the caller owns it: class offset at build, deltas on edits). `inferred`: class came from §4.3.
 * `reuseState`: skip §4.5 and use `env.state` as computed for the previous cell (same class, records and severity).
 */
export function writeCell(f: FuelMapExt, k: number, classId: number, h: CellHistory, env: CellWriteEnv, inferred: boolean, reuseState = false): void {
  const P = env.P;
  const cls = resolveClass(classId);
  // reuseState: env.state already holds §4.5 for this class and these records (the previous cell's, see buildFuelMap).
  const st = reuseState ? env.state : accumulate(cls, h, env.t0, P, f.severity ? f.severity[k]! : 0, env.state);
  const ctx = f.cellContext ? f.cellContext[k]! : 0;
  const chmValid = (ctx & CTX_CHM_VALID) !== 0;
  const a = ensureFuelArrays(f);

  f.type[k] = cls.id;
  a.fuelClass[k] = classId;
  f.surfaceLoad[k] = st.s;
  f.nearSurfaceLoad[k] = st.ns;
  f.elevatedLoad[k] = st.el;
  f.barkLoad[k] = st.b;
  a.canopyLoad[k] = st.o;
  f.surfaceHazard[k] = st.fhsS;
  f.nearSurfaceHazard[k] = st.fhsNs;
  f.elevatedHazard[k] = st.fhsEl;
  f.barkHazard[k] = st.barkHazard;
  const w = st.postFireW;
  f.nearSurfaceHeight[k] = cls.nearSurfaceHeight;
  f.elevatedHeight[k] = cls.elevatedHeight * (1 + P.postFireElHeightFactor * w);

  // Canopy: CHM values are written once by buildFuelMap and kept; otherwise the class default.
  if (!chmValid) {
    f.canopyHeight[k] = cls.canopyHeight;
    f.canopyCover[k] = cls.canopyCover;
  }
  const hO = f.canopyHeight[k]!;
  const cover = f.canopyCover[k]!;
  const underWoodland = cls.family === 'heath' && chmValid && hO >= P.underWoodlandChmMinM && cover >= P.underWoodlandCoverMin;
  a.canopyHeightEff[k] = canopyHeightEffFor(cls, chmValid, hO, underWoodland, P);

  // WRF chain.
  let wrf = cls.wrf;
  if (cls.family === 'vesta2' || cls.family === 'pine' || cls.family === 'heath') {
    if (w > 0) wrf = (1 - w) * wrf + w * Math.max(P.postFireWrfMin, wrf - P.postFireWrfDelta);
    if ((ctx & CTX_RIDGE) !== 0 && hO < P.wrfRidgeChmMaxM && cls.moistureFamily !== 'wetForest') wrf -= P.wrfRidgeDelta;
    if (cls.family === 'vesta2' && cover < P.wrfLowCoverThreshold) wrf -= P.wrfLowCoverDelta;
    wrf = clamp(wrf, P.wrfMin, P.wrfMax);
  }
  a.wrf[k] = wrf;
  f.curing[k] = curingFor(cls, env.month, (ctx & CTX_HIGH_ELEV) !== 0, env.droughtFactor, P);

  // History rasters.
  f.timeSinceFire[k] = st.tsf;
  f.lastFireKind[k] = st.lastKind;
  let c30 = 0;
  const win = P.fireCountWindowYears * YEAR_MS;
  for (let q = 0; q < h.n; q++) if (env.t0 - h.tb[q]! <= win) c30++;
  a.fireCount30[k] = Math.min(255, c30);
  a.fireCountTfi[k] = countShortIntervalsCell(h, tfiMinYears(cls, P.tfiThreshold, P.tfiAvoidYears));

  // Flags.
  let fl = a.flags[k]! & STICKY_FLAGS;
  if (cls.wetSubmodel) fl |= FuelFlag.WetSubmodel;
  if (w > 0) fl |= FuelFlag.PostFire;
  if (cls.barkClass === 'stringy') fl |= FuelFlag.Stringybark;
  if (cls.barkClass === 'ribbon') fl |= FuelFlag.RibbonBark;
  // §4.2: a wet sub-cell strip inside a drier cell. Not when the cell itself resolved (inference, setType) to a wet type.
  if ((ctx & CTX_MINORITY_WET) !== 0 && cls.id !== FuelType.Rainforest && cls.id !== FuelType.WetForest) fl |= FuelFlag.WetGullyMinority;
  if (h.n === 0) fl |= FuelFlag.NoFireRecord;
  if (inferred) fl |= FuelFlag.InferredVegetation;
  if (underWoodland) fl |= FuelFlag.UnderWoodland;
  if ((ctx & CTX_CLIFF) !== 0) fl |= FuelFlag.Cliff;
  if (st.fhsS >= P.heavyFuelFhsS || st.barkHazard >= P.heavyFuelBarkHazard) fl |= FuelFlag.HeavyFuel;
  a.flags[k] = fl;
}

function countShortIntervalsCell(h: CellHistory, tfiYears: number): number {
  if (!(tfiYears > 0)) return 0;
  const lim = tfiYears * YEAR_MS;
  let c = 0;
  for (let q = 1; q < h.n; q++) if (h.tb[q]! - h.tb[q - 1]! < lim) c++;
  return Math.min(255, c);
}

/** The records of cell k the writer should use: a setTimeSinceFire override if present, else the compact history. */
export function cellHistoryFor(f: FuelMapExt, history: HistoryRaster['compact'] | undefined | null, k: number, out: CellHistory): CellHistory {
  const sb = f.syntheticBurnTime;
  if (sb && sb[k] === sb[k]) return syntheticCellHistory(sb[k]!, out);
  return loadCellHistory(history, k, out);
}

/** §5.9 topographic blend weight w = smoothstep(0, 30 m, tpiSmall)·a_w, a_w = 0.5 + 0.5·cos(aspect − 315°) (0.5 if NaN). */
export function faBlendWeight(tpiSmall: number, aspectDeg: number, P: Readonly<FuelParams> = FUEL_PARAMS): number {
  const aw = aspectDeg === aspectDeg ? clamp(0.5 + 0.5 * Math.cos((aspectDeg - P.faBlendAspectPeakDeg) * DEG), 0, 1) : 0.5;
  return smoothstep(0, P.faBlendTpiEdgeM, tpiSmall) * aw;
}

function allocFuelMap(grid: GridSpec): FuelMapExt {
  const n = grid.nx * grid.ny;
  const f32 = (): Float32Array => new Float32Array(n);
  return {
    grid,
    type: new Uint8Array(n),
    surfaceHazard: f32(),
    nearSurfaceHazard: f32(),
    nearSurfaceHeight: f32(),
    elevatedHazard: f32(),
    elevatedHeight: f32(),
    barkHazard: f32(),
    surfaceLoad: f32(),
    nearSurfaceLoad: f32(),
    elevatedLoad: f32(),
    barkLoad: f32(),
    canopyHeight: f32(),
    canopyCover: f32(),
    curing: f32(),
    timeSinceFire: f32(),
    lastFireKind: new Uint8Array(n),
    sources: [],
    fuelClass: new Uint8Array(n),
    wrf: f32(),
    canopyLoad: f32(),
    canopyHeightEff: f32(),
    flags: new Uint16Array(n),
    moistureOffset: f32(),
    fireCount30: new Uint8Array(n),
    fireCountTfi: new Uint8Array(n),
    breakWidth: f32(),
    faBlendW: f32(),
    cellContext: new Uint8Array(n),
  };
}

/** Build the fire-grid fuel map (§4.7). `fuel.grid === terrain.grid`. */
export function buildFuelMap(args: BuildFuelArgs): FuelMap {
  const { terrain, derived, t0 } = args;
  const P = resolveFuelParams(args.params);
  const grid = terrain.grid;
  const n = grid.nx * grid.ny;
  if (args.classId.length !== n) throw new Error(`buildFuelMap: classId has ${args.classId.length} cells, grid has ${n}`);
  const f = allocFuelMap(grid);
  const ctx = f.cellContext!;
  const canopy = args.canopy ?? null;

  // Canopy (CHM) where valid, and the terrain context bits.
  const cliffFr = terrain.cliffFraction;
  for (let k = 0; k < n; k++) {
    let c = 0;
    if (canopy && canopy.valid[k] === 1 && Number.isFinite(canopy.height[k]) && Number.isFinite(canopy.cover[k])) {
      f.canopyHeight[k] = Math.max(0, canopy.height[k]!);
      f.canopyCover[k] = clamp(canopy.cover[k]!, 0, 1);
      c |= CTX_CHM_VALID;
    }
    const lf = terrain.landform[k]!;
    if (lf === Landform.Ridge || lf === Landform.Peak || lf === Landform.Spur) c |= CTX_RIDGE;
    if (terrain.elevation[k]! > P.curingHighElevM) c |= CTX_HIGH_ELEV;
    if (cliffFr ? cliffFr[k]! >= P.cliffFlagFraction : lf === Landform.Cliff) c |= CTX_CLIFF;
    if (args.minorityWet && args.minorityWet[k]) c |= CTX_MINORITY_WET;
    ctx[k] = c;
    f.faBlendW![k] = faBlendWeight(derived.tpiSmall[k]!, terrain.aspectDeg[k]!, P);
  }
  if (args.severity) f.severity = args.severity;
  f.buildContext = { t0, droughtFactor: args.droughtFactor, kbdi: args.kbdi, month: args.month, ...(args.params ? { params: { ...args.params } } : {}) };

  // Class per cell; inference where the vegetation raster has none.
  const cls = new Uint8Array(n);
  let nInfer = 0;
  const mask = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const c = args.classId[k]!;
    if (c === CLASS_INFER || c >= FUEL_CLASS_COUNT) {
      mask[k] = 1;
      nInfer++;
    } else cls[k] = c;
  }
  if (nInfer > 0) {
    const inferred = inferFuelTypes(terrain, canopy, mask, P);
    for (let k = 0; k < n; k++) {
      if (mask[k]) {
        cls[k] = inferred[k]!; // generic class id = FuelType
        ctx[k] |= CTX_INFERRED;
      }
    }
  }

  const env: CellWriteEnv = { P, t0, droughtFactor: args.droughtFactor, kbdi: args.kbdi, month: args.month, state: makeFuelState() };
  const hist = makeCellHistory();
  const compact = args.history?.compact;
  const sev = f.severity;
  // Neighbouring cells inside the same polygons share class and records: reuse the §4.5 state of the previous cell.
  let prevCls = -1;
  let prevSev = -1;
  let prevA = 0;
  let prevN = -1;
  for (let k = 0; k < n; k++) {
    const c = cls[k]!;
    const a = compact ? compact.recStart[k]! : 0;
    const nr = compact ? compact.recStart[k + 1]! - a : 0;
    const sv = sev ? sev[k]! : 0;
    let same = c === prevCls && sv === prevSev && nr === prevN;
    if (same && compact) {
      const ri = compact.recIndex;
      for (let q = 0; q < nr; q++) {
        if (ri[a + q] !== ri[prevA + q]) {
          same = false;
          break;
        }
      }
    }
    if (!same) loadCellHistory(compact, k, hist);
    writeCell(f, k, c, hist, env, (ctx[k]! & CTX_INFERRED) !== 0, same);
    f.moistureOffset![k] = classMoistureOffset(resolveClass(c), args.kbdi);
    prevCls = c;
    prevSev = sv;
    prevA = a;
    prevN = nr;
  }

  // Provenance.
  const src: string[] = [];
  if (nInfer < n) src.push(SVTM_SOURCE);
  if (nInfer > 0) src.push(`Vegetation inferred from terrain${canopy ? ' and canopy' : ''} for ${Math.round((100 * nInfer) / n)} % of cells (unmapped or "Not classified")`);
  if (args.history) src.push(args.history.source ?? 'NPWS Fire History');
  else src.push('No fire history: steady-state fuel assumed');
  if (canopy) src.push('Meta/WRI CHM (Tolan et al. 2024, CC BY 4.0)');
  if (args.sources) src.push(...args.sources);
  f.sources = src;
  return f;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-cell parameters for the hot loops (§2.1 CellFuelParams)
// ─────────────────────────────────────────────────────────────────────────────

/** A blank CellFuelParams (for `fuelParamsInto`). */
export function makeCellFuelParams(): CellFuelParams {
  return {
    type: FuelType.NonFuel, fuelClass: 0, family: 'none', moistureFamily: 'none',
    surfaceLoad: 0, nearSurfaceLoad: 0, elevatedLoad: 0, barkLoad: 0, canopyLoad: 0,
    fhsS: 0, fhsNs: 0, fhsEl: 0, barkHazard: 0, hNs: 0, hEl: 0, hO: 0, hOEff: 0,
    cover: 0, coverFromChm: false, lai: 0, wrf: 1, grassState: 'natural', grassWaf: 1, curing: 0,
    underWoodland: false, wetSubmodel: false, spotting: false, barkClass: 'none',
    tauF: 0, receptivity: 0, cRef: 0, faBlendW: 0, moistureOffset: 0, flags: 0, timeSinceFire: NaN,
  };
}

const fin = (v: number | undefined, dflt: number): number => (v !== undefined && v === v ? v : dflt);

/**
 * Fill `out` with cell k's parameters (no allocation). Optional FuelMap fields fall back to the class/type row, so
 * maps from other producers (UI mocks) work too. Call once per cell at init and after edits, never per step.
 */
export function fuelParamsInto(fuel: FuelMap, k: number, out: CellFuelParams, params?: Partial<FuelParams>): CellFuelParams {
  const f = fuel as FuelMapExt;
  const P = params ? resolveFuelParams(params) : DEFAULT_P;
  const type = fuel.type[k]! as FuelType;
  const classId = f.fuelClass ? f.fuelClass[k]! : type;
  const cls = resolveClass(resolveClass(classId).id === type ? classId : type);
  const ctx = f.cellContext ? f.cellContext[k]! : 0;
  const flags = f.flags ? f.flags[k]! : 0;
  out.type = type;
  out.fuelClass = cls.classId;
  out.family = cls.family;
  out.moistureFamily = cls.moistureFamily;
  out.surfaceLoad = fin(fuel.surfaceLoad[k], cls.surface.load);
  out.nearSurfaceLoad = fin(fuel.nearSurfaceLoad[k], cls.nearSurface.load);
  out.elevatedLoad = fin(fuel.elevatedLoad[k], cls.elevated.load);
  out.barkLoad = fin(fuel.barkLoad[k], cls.bark.load);
  out.canopyLoad = fin(f.canopyLoad?.[k], cls.canopy.load);
  out.fhsS = fin(fuel.surfaceHazard[k], cls.fhsMax.surface);
  out.fhsNs = fin(fuel.nearSurfaceHazard[k], cls.fhsMax.nearSurface);
  out.fhsEl = fin(fuel.elevatedHazard[k], cls.fhsMax.elevated);
  out.barkHazard = fin(fuel.barkHazard[k], 0);
  out.hNs = fin(fuel.nearSurfaceHeight[k], cls.nearSurfaceHeight);
  out.hEl = fin(fuel.elevatedHeight[k], cls.elevatedHeight);
  out.hO = fin(fuel.canopyHeight[k], cls.canopyHeight);
  out.cover = clamp(fin(fuel.canopyCover[k], cls.canopyCover), 0, 1);
  const chmValid = (ctx & CTX_CHM_VALID) !== 0;
  out.coverFromChm = chmValid && Number.isFinite(fuel.canopyCover[k]);
  out.underWoodland = (flags & FuelFlag.UnderWoodland) !== 0;
  out.hOEff = fin(f.canopyHeightEff?.[k], canopyHeightEffFor(cls, chmValid, out.hO, out.underWoodland, P));
  out.lai = chmValid && cls.canopyCover > 0 ? cls.lai * clamp(out.cover / cls.canopyCover, 0, P.laiCoverRatioMax) : cls.lai;
  out.wrf = fin(f.wrf?.[k], cls.wrf);
  out.grassState = cls.grassStateFixed ?? (cls.family === 'grass' ? grassStateFromLoad(out.surfaceLoad + out.nearSurfaceLoad) : 'natural');
  // §6.5: GrassyWoodland 0.5 if cover < 0.3 else 0.3; Grassland 1.0; Urban 0.3.
  out.grassWaf =
    cls.family !== 'grass' ? 1 : cls.id === FuelType.GrassyWoodland ? (out.cover < 0.3 ? 0.5 : 0.3) : (cls.grassWaf ?? 1);
  out.curing = fin(fuel.curing[k], cls.family === 'none' ? 0 : P.curingMax);
  out.wetSubmodel = cls.wetSubmodel;
  out.spotting = cls.spotting;
  out.barkClass = cls.barkClass;
  out.tauF = cls.flameResidence;
  out.receptivity = cls.receptivity;
  out.cRef = cls.moistureRefCanopy;
  out.faBlendW = cls.moistureFamily === 'wetForest' ? fin(f.faBlendW?.[k], 0) : 0;
  out.moistureOffset = fin(f.moistureOffset?.[k], 0);
  out.flags = flags;
  out.timeSinceFire = fuel.timeSinceFire[k]!;
  return out;
}

const DEFAULT_P: Readonly<FuelParams> = FUEL_PARAMS;

/** §2.4: CellFuelParams of cell k (allocates one object; use fuelParamsInto in loops). */
export function fuelParamsAt(fuel: FuelMap, k: number): CellFuelParams {
  return fuelParamsInto(fuel, k, makeCellFuelParams());
}

// ─────────────────────────────────────────────────────────────────────────────
// "Why here?" summary
// ─────────────────────────────────────────────────────────────────────────────

const shortClass = (name: string): string =>
  name
    .replace(/Dry Sclerophyll Forests?/g, 'DSF')
    .replace(/Wet Sclerophyll Forests?/g, 'WSF')
    .replace(/Dry Sclerophyll Woodlands?/g, 'DS woodland');

/**
 * One-line fuel description for "Why here?" (§4.7), e.g. "Dry forest (shrubby) — Sydney Montane DSF · wildfire
 * 6.8 yr ago · litter 9.9 t/ha (69 % of max) · shrubs 2.0 m · bark stringy (High)".
 */
export function fuelSummary(fuel: FuelMap, k: number): string {
  const p = fuelParamsAt(fuel, k);
  const cls = resolveClass(p.fuelClass);
  const parts: string[] = [];
  const head = FUEL_TYPES[p.type]?.name ?? 'Unknown fuel';
  parts.push(p.fuelClass >= 13 && cls.className !== head ? `${head} — ${shortClass(cls.className)}` : head);
  if (p.family === 'none') return parts[0]!;
  const tsf = p.timeSinceFire;
  if (tsf === tsf) {
    const kind = fuel.lastFireKind[k] === 1 ? 'wildfire' : fuel.lastFireKind[k] === 2 ? 'burnt (prescribed)' : 'fire';
    parts.push(`${kind} ${tsf < 1 ? `${Math.max(1, Math.round(tsf * 12))} months` : `${tsf.toFixed(1)} yr`} ago`);
  } else parts.push('no recorded fire (fuel at steady state)');
  if (p.family === 'heath') {
    const tot = p.surfaceLoad + p.nearSurfaceLoad + p.elevatedLoad;
    parts.push(`shrub fuel ${tot.toFixed(1)} t/ha (${Math.round((100 * tot) / Math.max(1e-6, cls.totalFineLoad))} % of max) · ${p.hEl.toFixed(1)} m tall`);
  } else if (p.family === 'grass') {
    const lg = p.surfaceLoad + p.nearSurfaceLoad;
    parts.push(`grass ${lg.toFixed(1)} t/ha (${p.grassState === 'eatenOut' ? 'eaten out' : p.grassState}) · ${Math.round(p.curing)} % cured`);
  } else {
    const ss = cls.surface.load;
    parts.push(`litter ${p.surfaceLoad.toFixed(1)} t/ha (${Math.round((100 * p.surfaceLoad) / Math.max(1e-6, ss))} % of max)`);
    parts.push(`shrubs ${p.hEl.toFixed(1)} m`);
    const r = ratingFromFhs('bark', p.barkHazard);
    parts.push(`bark ${p.barkClass} (${r})`);
  }
  if ((p.flags & FuelFlag.PostFire) !== 0) parts.push('post-fire regrowth');
  if ((p.flags & FuelFlag.InferredVegetation) !== 0) parts.push('vegetation inferred');
  return parts.join(' · ');
}

/** Deep copy of a fuel map, including the fuel-private extension fields (for the worker's base/working copies). */
export function cloneFuelMap<T extends FuelMap>(f: T): T {
  const out: Record<string, unknown> = { ...(f as FuelMap), grid: { ...f.grid, origin: { ...f.grid.origin } }, sources: [...f.sources] };
  for (const [key, v] of Object.entries(f)) if (ArrayBuffer.isView(v) && !(v instanceof DataView)) out[key] = (v as Uint8Array).slice();
  const bc = (f as FuelMapExt).buildContext;
  if (bc) out['buildContext'] = { ...bc, ...(bc.params ? { params: { ...bc.params } } : {}) };
  return out as T;
}
