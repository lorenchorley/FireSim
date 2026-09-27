/**
 * NPWS fire history: parsing, inclusion at the scenario start and rasterisation onto the fire grid (spec §4.4).
 *
 * Parse (NPWS GeoJSON fields verified live, doc 08b §3), per feature:
 *   kind = FireType 1 → Wildfire, 2 → PrescribedBurn, else Unknown; season = FireYear ≥ 10000 ? ⌊FireYear/100⌋ : FireYear;
 *   startDate = localDate(StartDate); endDate = localDate(EndDate) ?? startDate + 3 d [H]; datesKnown = startDate ≠ null;
 *   seasonMid = 1 January (season + 1) 12:00 AEST; startTime = 00:00 AEST of startDate | seasonMid;
 *   endTime (= burn time t_b) = 12:00 AEST of endDate | seasonMid; Intensity ignored; MultiPolygon → one record per part.
 * Inclusion at t0 (d0 = localDate(t0)): future fires excluded; dated fires with startDate ≤ d0 ≤ endDate + 1 d are
 * "active" (excluded from fuel, returned in `activeFires`); undated fires of the current season are excluded with a
 * warning; the rest are included with t_b = endTime.
 * Per cell: timeSinceFire (NaN = no record, D40), lastFireKind, fireCount30, fireCountTfi and the compact record list
 * `FuelHistoryCompact` (records sorted by t_b; `recIndex` points into the per-record `tb`/`kind` arrays).
 */
import { LocalProjection } from '../core/geo';
import type { GridSpec } from '../core/grid';
import { localDate, season as seasonOf } from '../core/physics';
import { FireHistoryKind, type FireHistoryRecord, type FuelHistoryCompact } from '../core/types';
import { resolveClass, tfiMinYears } from './catalogue';
import { DAY_MS, resolveFuelParams, YEAR_MS, type FuelParams } from './params';
import { cellCentreLattice, projectRings, ScanlineRasteriser } from './polygon';

/**
 * Kind code of the synthetic "burnt τ years ago" record written by a setTimeSinceFire edit (§4.8): a prescribed burn
 * with patchiness `editBurnPatchiness` (p = 1: full reset of s/ns, elevated and bark halved). Only fuel/ reads it;
 * `lastFireKind` reports it as PrescribedBurn.
 */
export const FIRE_KIND_USER_BURN = 3;

/** The per-cell history rasters of §2.4. */
export interface HistoryRaster {
  /** Years since the last included fire (NaN = no record, D40). */
  timeSinceFire: Float32Array;
  lastFireKind: Uint8Array;
  fireCount30: Uint8Array;
  /** Intervals shorter than the TFI minimum (generic minimum until buildFuelMap recomputes it per class). */
  fireCountTfi: Uint8Array;
  compact: FuelHistoryCompact;
  /** Included records sorted by burn time (index = compact record index). */
  included: FireHistoryRecord[];
  activeFires: FireHistoryRecord[];
  warnings: string[];
  /** Provenance, e.g. "NPWS Fire History current to 2026-09-07" (extension of the §2.4 shape). */
  source?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dates
// ─────────────────────────────────────────────────────────────────────────────

const AEST_MS = 10 * 3.6e6;

function dateParts(d: string): [number, number, number] {
  return [Number(d.slice(0, 4)), Number(d.slice(5, 7)), Number(d.slice(8, 10))];
}
/** Unix ms of hh:00 AEST (UTC+10) on local date 'yyyy-mm-dd'. */
export function aestTime(date: string, hour: number): number {
  const [y, m, d] = dateParts(date);
  return Date.UTC(y, m - 1, d, hour) - AEST_MS;
}
/** 'yyyy-mm-dd' + n days. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = dateParts(date);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
/** Mid-point of an undated season: 1 January (season + 1), 12:00 AEST [H]. */
export const seasonMid = (season: number): number => Date.UTC(season + 1, 0, 1, 12) - AEST_MS;

const kindName = (k: FireHistoryKind): string => (k === FireHistoryKind.Wildfire ? 'Wildfire' : k === FireHistoryKind.PrescribedBurn ? 'Prescribed Burn' : 'Fire');

/** Burn time t_b of a record (§4.4: endTime; startTime when endTime is absent). */
export const burnTime = (r: FireHistoryRecord): number => r.endTime ?? r.startTime;

// ─────────────────────────────────────────────────────────────────────────────
// Parse
// ─────────────────────────────────────────────────────────────────────────────

interface NpwsFeature {
  properties?: Record<string, unknown> | null;
  geometry?: { type: string; coordinates: unknown } | null;
}

export interface ParsedFireHistory {
  records: FireHistoryRecord[];
  /** Latest `VerDate` (unix ms) in the file, if any. */
  verDate: number | null;
  /** Features skipped (no geometry, no usable ring, no season). */
  skipped: number;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Parse NPWS Fire History GeoJSON with metadata (see module doc). Never throws on malformed features. */
export function parseFireHistoryWithMeta(geojson: unknown, params?: Partial<FuelParams>): ParsedFireHistory {
  const P = resolveFuelParams(params);
  const feats = (geojson as { features?: NpwsFeature[] } | null)?.features;
  const records: FireHistoryRecord[] = [];
  let verDate: number | null = null;
  let skipped = 0;
  if (!Array.isArray(feats)) return { records, verDate, skipped };
  for (const f of feats) {
    const p = f?.properties ?? {};
    const g = f?.geometry;
    const vd = num(p['VerDate']);
    if (vd !== null && (verDate === null || vd > verDate)) verDate = vd;
    if (!g || !g.coordinates) {
      skipped++;
      continue;
    }
    const ft = num(p['FireType']);
    const kind = ft === 1 ? FireHistoryKind.Wildfire : ft === 2 ? FireHistoryKind.PrescribedBurn : FireHistoryKind.Unknown;
    const sMs = num(p['StartDate']);
    const eMs = num(p['EndDate']);
    const startDate = sMs !== null ? localDate(sMs) : null;
    let endDate = eMs !== null ? localDate(eMs) : startDate ? addDays(startDate, P.endDateDefaultDays) : null;
    // Data check: one Katoomba row ("Lyrebird Dell Stage 2", 2005-03-16 → 2005-03-05) ends before it starts. A burn
    // time before the start would make the fire "included" (not active) on its own start date: clamp to the start.
    if (startDate !== null && endDate !== null && endDate < startDate) endDate = startDate;
    const fy = num(p['FireYear']);
    const season = fy !== null ? (fy >= 10000 ? Math.floor(fy / 100) : fy) : startDate ? seasonOf(aestTime(startDate, 12)) : null;
    if (season === null) {
      skipped++;
      continue;
    }
    const datesKnown = startDate !== null;
    const mid = seasonMid(season);
    const startTime = datesKnown ? aestTime(startDate, 0) : mid;
    // Spec: endTime = datesKnown ? 12:00 AEST of endDate : seasonMid. A published EndDate with a null StartDate is
    // still the best burn time, so it is used too (three demo rows: "2001-02 Wildfire" at gospers, grose and
    // katoomba, EndDate 2001-09-26 … 2002-01-07). Inclusion still follows the undated (season) rule, and a burn time
    // after t0 is treated as a future fire (inclusionAt).
    const endTime = endDate !== null && (datesKnown || eMs !== null) ? aestTime(endDate, 12) : mid;
    const label = str(p['Label']) ?? `${season}-${String((season + 1) % 100).padStart(2, '0')} ${kindName(kind)}`;
    const name = str(p['FireName']);
    const area = num(p['AreaHa']);
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? (g.coordinates as unknown[]) : [];
    let any = false;
    for (const poly of polys) {
      if (!Array.isArray(poly) || poly.length === 0) continue;
      const outer = poly[0] as unknown[];
      if (!Array.isArray(outer) || outer.length < 4) continue; // outer ring unusable → skip the part
      const rings = (poly as [number, number][][]).filter((r) => Array.isArray(r) && r.length >= 4);
      const rec: FireHistoryRecord = { kind, label, startTime, endTime, rings, season, datesKnown };
      if (name) rec.name = name;
      if (area !== null) rec.areaHa = area;
      if (startDate) rec.startDate = startDate;
      if (endDate) rec.endDate = endDate;
      records.push(rec);
      any = true;
    }
    if (!any) skipped++;
  }
  return { records, verDate, skipped };
}

/** §2.4 signature: NPWS GeoJSON → one FireHistoryRecord per polygon part. */
export function parseFireHistory(geojson: unknown): FireHistoryRecord[] {
  return parseFireHistoryWithMeta(geojson).records;
}

// ─────────────────────────────────────────────────────────────────────────────
// Inclusion
// ─────────────────────────────────────────────────────────────────────────────

export type InclusionStatus = 'included' | 'active' | 'future' | 'undatedCurrentSeason';

/** Inclusion rule of §4.4 for one record at scenario start t0. */
export function inclusionAt(r: FireHistoryRecord, t0: number, params?: Partial<FuelParams>): InclusionStatus {
  const P = resolveFuelParams(params);
  const d0 = localDate(t0);
  const known = r.datesKnown ?? r.startDate !== undefined;
  if (known) {
    const sd = r.startDate ?? localDate(r.startTime);
    const ed = r.endDate ?? localDate(burnTime(r));
    if (sd > d0) return 'future';
    if (d0 <= addDays(ed, P.activeGraceDays)) return 'active';
    return 'included';
  }
  const s0 = seasonOf(t0);
  const s = r.season ?? seasonOf(r.startTime);
  if (s === s0) return 'undatedCurrentSeason';
  if (s > s0) return 'future';
  // Inconsistent rows (a published EndDate after t0 on an earlier season) would give a negative time since fire.
  if (burnTime(r) > t0) return 'future';
  return 'included';
}

export interface IncludedFires {
  /** Sorted by burn time (stable). */
  included: FireHistoryRecord[];
  activeFires: FireHistoryRecord[];
  warnings: string[];
}

/** Apply the §4.4 inclusion rules to all records. */
export function selectFires(recs: FireHistoryRecord[], t0: number, params?: Partial<FuelParams>): IncludedFires {
  const included: FireHistoryRecord[] = [];
  const activeFires: FireHistoryRecord[] = [];
  const undated: string[] = [];
  for (const r of recs) {
    const st = inclusionAt(r, t0, params);
    if (st === 'included') included.push(r);
    else if (st === 'active') activeFires.push(r);
    else if (st === 'undatedCurrentSeason') undated.push(r.label);
  }
  included.sort((a, b) => burnTime(a) - burnTime(b));
  const warnings: string[] = [];
  const uniq = (a: string[]): string[] => [...new Set(a)];
  if (undated.length) warnings.push(`Undated fire in the current season (not used for fuel): ${uniq(undated).join(', ')}`);
  if (activeFires.length) {
    const names = uniq(activeFires.map((r) => r.name ?? r.label));
    warnings.push(`Fire active at the start (this fire was burning at the scenario date; its area keeps pre-fire fuel): ${names.join(', ')}`);
  }
  if (included.length === 0) warnings.push('No fire record: steady-state fuel assumed');
  return { included, activeFires, warnings };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rasterise
// ─────────────────────────────────────────────────────────────────────────────

export interface RasteriseHistoryOptions {
  params?: Partial<FuelParams>;
  /** Latest NPWS VerDate (unix ms) for the provenance string. */
  verDate?: number | null;
  /** Fuel class per cell for fireCountTfi (else the generic TFI minimum `tfiDefaultMinYears`). */
  classId?: Uint8Array;
}

/** Growable Uint32 buffer. */
class U32 {
  a = new Uint32Array(1 << 14);
  n = 0;
  push(v: number): void {
    if (this.n === this.a.length) {
      const b = new Uint32Array(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    this.a[this.n++] = v;
  }
}

/**
 * Rasterise the included fire records onto the cell centres of `grid` (§4.4). Records of the same kind within
 * `recordDedupeDays` in one cell are merged (duplicate NPWS rows) [H].
 */
export function rasteriseFireHistory(grid: GridSpec, recs: FireHistoryRecord[], t0: number, opts: RasteriseHistoryOptions = {}): HistoryRaster {
  const P = resolveFuelParams(opts.params);
  const { included, activeFires, warnings } = selectFires(recs, t0, P);
  const n = grid.nx * grid.ny;
  const nr = included.length;
  const tb = new Float64Array(nr);
  const kind = new Uint8Array(nr);
  for (let r = 0; r < nr; r++) {
    tb[r] = burnTime(included[r]!);
    kind[r] = included[r]!.kind;
  }

  // (cell, record) pairs in record (= t_b) order, then a stable counting sort by cell.
  const proj = new LocalProjection(grid.origin);
  const lat = cellCentreLattice(grid);
  const ras = new ScanlineRasteriser();
  const pairCell = new U32();
  const pairRec = new U32();
  const nx = grid.nx;
  for (let r = 0; r < nr; r++) {
    const rings = projectRings(included[r]!.rings, proj, 4);
    ras.rasterise(rings, lat, (j, i0, i1) => {
      for (let i = i0; i <= i1; i++) {
        pairCell.push(j * nx + i);
        pairRec.push(r);
      }
    });
  }
  const recStart = new Uint32Array(n + 1);
  const np = pairCell.n;
  const pc = pairCell.a;
  const pr = pairRec.a;
  for (let q = 0; q < np; q++) recStart[pc[q]! + 1]!++;
  for (let k = 0; k < n; k++) recStart[k + 1]! += recStart[k]!;
  const fillPos = recStart.slice(0, n);
  const recIndexRaw = new Uint32Array(np);
  for (let q = 0; q < np; q++) recIndexRaw[fillPos[pc[q]!]!++] = pr[q]!;

  // Dedupe consecutive same-kind records within the window, compacting in place.
  const dedupeMs = P.recordDedupeDays * DAY_MS;
  const recIndex = new Uint32Array(np);
  const outStart = new Uint32Array(n + 1);
  let w = 0;
  for (let k = 0; k < n; k++) {
    outStart[k] = w;
    const a = recStart[k]!;
    const b = recStart[k + 1]!;
    for (let q = a; q < b; q++) {
      const r = recIndexRaw[q]!;
      if (w > outStart[k]!) {
        const prev = recIndex[w - 1]!;
        if (kind[prev] === kind[r] && Math.abs(tb[r]! - tb[prev]!) <= dedupeMs) continue;
      }
      recIndex[w++] = r;
    }
  }
  outStart[n] = w;
  const compact: FuelHistoryCompact = { recStart: outStart, recIndex: w === np ? recIndex : recIndex.slice(0, w), tb, kind };

  const timeSinceFire = new Float32Array(n);
  const lastFireKind = new Uint8Array(n);
  const fireCount30 = new Uint8Array(n);
  const fireCountTfi = new Uint8Array(n);
  const win = P.fireCountWindowYears * YEAR_MS;
  for (let k = 0; k < n; k++) {
    const a = outStart[k]!;
    const b = outStart[k + 1]!;
    if (a === b) {
      timeSinceFire[k] = NaN;
      continue;
    }
    const last = compact.recIndex[b - 1]!;
    timeSinceFire[k] = (t0 - tb[last]!) / YEAR_MS;
    lastFireKind[k] = kind[last]! === FIRE_KIND_USER_BURN ? FireHistoryKind.PrescribedBurn : kind[last]!;
    let c30 = 0;
    for (let q = a; q < b; q++) if (t0 - tb[compact.recIndex[q]!]! <= win) c30++;
    fireCount30[k] = Math.min(255, c30);
    const tfi = opts.classId ? tfiMinYears(resolveClass(opts.classId[k]!), P.tfiThreshold, P.tfiAvoidYears) : P.tfiDefaultMinYears;
    fireCountTfi[k] = countShortIntervals(compact, k, tfi);
  }
  const source = opts.verDate != null ? `NPWS Fire History current to ${new Date(opts.verDate).toISOString().slice(0, 10)}` : 'NPWS Fire History';
  return { timeSinceFire, lastFireKind, fireCount30, fireCountTfi, compact, included, activeFires, warnings, source };
}

/** Number of consecutive record pairs of cell k closer than `tfiYears` (NaN → 0). */
export function countShortIntervals(h: FuelHistoryCompact, k: number, tfiYears: number): number {
  if (!(tfiYears > 0)) return 0;
  const a = h.recStart[k]!;
  const b = h.recStart[k + 1]!;
  const lim = tfiYears * YEAR_MS;
  let c = 0;
  for (let q = a + 1; q < b; q++) if (h.tb[h.recIndex[q]!]! - h.tb[h.recIndex[q - 1]!]! < lim) c++;
  return Math.min(255, c);
}

/** An empty history for grids without fire records (steady-state fuel everywhere, D40). */
export function emptyHistory(grid: GridSpec): HistoryRaster {
  const n = grid.nx * grid.ny;
  return {
    timeSinceFire: new Float32Array(n).fill(NaN),
    lastFireKind: new Uint8Array(n),
    fireCount30: new Uint8Array(n),
    fireCountTfi: new Uint8Array(n),
    compact: { recStart: new Uint32Array(n + 1), recIndex: new Uint32Array(0), tb: new Float64Array(0), kind: new Uint8Array(0) },
    included: [],
    activeFires: [],
    warnings: ['No fire record: steady-state fuel assumed'],
  };
}
