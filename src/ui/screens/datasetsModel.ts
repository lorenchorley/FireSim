/**
 * The Data sets screen's view model (pure: no DOM, no I/O, unit-tested in datasetsModel.test.ts). It turns the scenario's
 * measured inventory (ScenarioData.datasets / datasetSummary, core/datasets.ts), a Setup plan (scenario/estimate.ts), the
 * simulation's working memory (scenario/memoryModel.ts) and the device's storage report (data/storage.ts) into the
 * sentences, rows, facts and chart data the screen draws. Every number comes from those inputs; nothing here is typed in
 * except plain-English wording (titles, glosses and the "How to read this" text).
 *
 * Rules kept here so the screen cannot break them:
 *  - never "undefined", "NaN" or "Infinity" in a string (a missing field is left out, never shown as a zero);
 *  - download sizes whose compressed size the phone did not report are an upper bound: "up to …";
 *  - planned sizes are estimates of the uncompressed answers: "≈ …";
 *  - data that were not used (unavailable / skipped) say so, with the reason.
 */
import {
  EVIDENCE_TITLES,
  ORIGIN_TITLES,
  ROLE_TITLES,
  STATUS_TITLES,
  compareDatasets,
  formatBytes,
  formatCount,
  formatDuration,
  formatPercent,
  groupByRole,
  isSubstitute,
  weatherStaleness,
  type DatasetDistribution,
  type DatasetGridInfo,
  type DatasetOrigin,
  type DatasetRecord,
  type DatasetResampling,
  type DatasetRole,
  type DatasetSummary,
  type EvidenceLevel,
  type MemoryWhere,
  type WorkingMemory,
} from '../../core/datasets';
import type { StorageReport } from '../../data/storage';
import type { AvailabilityContext } from '../../render/layerCatalog';
import { layerById, layerForOverlay } from '../../render/layerCatalog';
import type { LayerState, OverlayKind } from '../../render/layers';
import type { IconName } from '../icons';
import { datasetIcon } from '../labels';
import type { BarColour, Origin } from '../primitives';

// ─────────────────────────────────────────────────────────────────────────────
// Small safe formatters
// ─────────────────────────────────────────────────────────────────────────────

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Text that never shows a broken value: '' for undefined / null / NaN / Infinity, the trimmed text otherwise. */
export function clean(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  const s = String(v).trim();
  return /^(undefined|null|NaN|-?Infinity)$/.test(s) ? '' : s;
}

/** '2.3 MB' split into number and unit for a stat ('2.3', 'MB'); '0 B' gives ('0', 'B'). */
export function splitBytes(bytes: number | undefined): { value: string; unit: string } {
  const [value = '0', unit = 'B'] = formatBytes(bytes ?? 0).split(' ');
  return { value, unit };
}

/** Metres as '30 m', '1.19 m', '2.5 km' (for resolutions and extents). */
export function formatMetres(m: number | undefined): string {
  if (!isNum(m) || m <= 0) return '';
  if (m >= 1000) return `${Math.round(m / 100) / 10} km`.replace('.0 km', ' km');
  if (m >= 10) return `${Math.round(m)} m`;
  return `${Math.round(m * 100) / 100} m`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** An ISO date or partial date ('2026-09-29', '2026-09', '2016') as '29 Sep 2026', 'Sep 2026', '2016'; '' otherwise. */
export function formatIsoDay(iso: string | undefined): string {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(clean(iso));
  if (!m) return '';
  const mo = m[2] ? MONTHS[Number(m[2]) - 1] : undefined;
  if (m[2] && !mo) return '';
  if (m[3]) return `${Number(m[3])} ${mo} ${m[1]}`;
  if (mo) return `${mo} ${m[1]}`;
  return m[1]!;
}

/** Epoch ms as '30 Sep 2026' in a time zone; '' when not a time. */
export function formatDay(ms: number | undefined, tz = 'Australia/Sydney'): string {
  if (!isNum(ms) || ms <= 0) return '';
  try {
    const p = new Intl.DateTimeFormat('en-AU', { timeZone: tz, day: 'numeric', month: 'numeric', year: 'numeric' }).formatToParts(ms);
    const get = (t: string): string => p.find((x) => x.type === t)?.value ?? '';
    return `${Number(get('day'))} ${MONTHS[Number(get('month')) - 1] ?? ''} ${get('year')}`;
  } catch {
    return '';
  }
}

/** Epoch ms as '30 Sep 2026, 16:10' in a time zone; '' when not a time. */
export function formatDayTime(ms: number | undefined, tz = 'Australia/Sydney'): string {
  if (!isNum(ms) || ms <= 0) return '';
  try {
    const p = new Intl.DateTimeFormat('en-AU', { timeZone: tz, day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(ms);
    const get = (t: string): string => p.find((x) => x.type === t)?.value ?? '';
    return `${Number(get('day'))} ${MONTHS[Number(get('month')) - 1] ?? ''} ${get('year')}, ${get('hour')}:${get('minute')}`;
  } catch {
    return '';
  }
}

/** How long ago, in words: 'just now', '25 min ago', '3 h ago', '4 days ago'. */
export function formatAgo(thenMs: number, nowMs: number): string {
  if (!isNum(thenMs) || !isNum(nowMs) || thenMs <= 0) return '';
  const h = Math.max(0, (nowMs - thenMs) / 3.6e6);
  if (h < 1 / 60) return 'just now';
  if (h < 1) return `${Math.round(h * 60)} min ago`;
  if (h < 48) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** A count whose thousands never break across lines ('3 059' with a narrow no-break space). */
const fc = (n: number): string => formatCount(n).replace(/\u2009/g, '\u202f');
const plural = (n: number, one: string, many = `${one}s`): string => `${fc(n)} ${n === 1 ? one : many}`;

// ─────────────────────────────────────────────────────────────────────────────
// Origin classes (the five words of the origin chips)
// ─────────────────────────────────────────────────────────────────────────────

/** The five provenance words the screen uses (origin chips, the mix bar and its legend). */
export type OriginClass = Origin;

export const ORIGIN_CLASS_ORDER: readonly OriginClass[] = ['live', 'saved', 'bundled', 'synthetic', 'user'];

export const ORIGIN_CLASS_INFO: Readonly<Record<OriginClass, { label: string; colour: BarColour; gloss: string }>> = Object.freeze({
  live: { label: 'Live', colour: 'ok', gloss: 'Downloaded from the provider while this model was built.' },
  saved: { label: 'Saved on device', colour: 's4', gloss: 'A copy this phone kept from an earlier download, or an area you saved for offline use.' },
  bundled: { label: 'Bundled with the app', colour: 's1', gloss: 'Files that ship inside the app (the demo sites), so they work with no signal.' },
  synthetic: { label: 'Estimated or synthetic', colour: 'watch', gloss: 'Worked out, designed or made up by the app where no real data were available.' },
  user: { label: 'Your edits', colour: 's2', gloss: 'Typed, drawn or chosen by you.' },
});

/** Which of the five words an origin is; null for 'none' (nothing obtained). */
export function originClassOf(o: DatasetOrigin): OriginClass | null {
  switch (o) {
    case 'live':
      return 'live';
    case 'cache':
    case 'area-pack':
      return 'saved';
    case 'bundled':
      return 'bundled';
    case 'synthetic':
    case 'preset':
    case 'derived':
      return 'synthetic';
    case 'user':
      return 'user';
    default:
      return null;
  }
}

/** The origin chip of a record: the class and a short label in the record's own words ("Designed", "Worked out"). */
export function originChipOf(r: DatasetRecord): { cls: OriginClass; label: string } | null {
  const cls = originClassOf(r.origin);
  if (!cls) return null;
  const label =
    r.origin === 'preset' ? 'Designed' : r.origin === 'derived' ? 'Worked out' : r.origin === 'synthetic' ? 'Made up' : r.origin === 'area-pack' ? 'Saved area' : cls === 'bundled' ? 'Bundled' : ORIGIN_CLASS_INFO[cls].label;
  return { cls, label };
}

/** The status chip of a record, or null when it is simply used. */
export function statusChipOf(r: DatasetRecord): { label: string; tone: 'watch' | 'neutral'; notUsed: boolean } | null {
  switch (r.status) {
    case 'unavailable':
    case 'skipped':
      return { label: 'Not used', tone: 'neutral', notUsed: true };
    case 'fallback':
      return { label: STATUS_TITLES.fallback, tone: 'watch', notUsed: false };
    case 'partial':
      return { label: STATUS_TITLES.partial, tone: 'watch', notUsed: false };
    default:
      return null;
  }
}

/** Why a record is a substitute or was not used, in the record's words; '' when there is nothing to say. */
export function reasonOf(r: DatasetRecord): string {
  return clean(r.fallbackReason) || (r.status !== 'used' && r.status !== 'user' ? clean(r.coverage?.note) || clean(r.coverage?.filledBy) : '');
}

export interface OriginMixPart {
  cls: OriginClass;
  share: number;
  label: string;
  /** '74 %' */
  text: string;
}

export interface OriginMix {
  basis: 'cells' | 'datasets';
  parts: OriginMixPart[];
  /** What the bar measures, in words. */
  caption: string;
  /** Accessible description of the whole bar. */
  label: string;
}

/**
 * Where the data come from, as one stacked bar. With a summary it is the share of the MAP CELLS (terrain, vegetation,
 * canopy, fire history) by origin (`cellShareByOrigin`: the part real data did not cover counts as estimated); otherwise
 * (a plan, or a scenario without map data) the share of the data sets that were used, by origin.
 */
export function originMix(records: readonly DatasetRecord[], summary?: DatasetSummary | null): OriginMix {
  const shares = new Map<OriginClass, number>();
  const add = (c: OriginClass | null, v: number): void => {
    if (c && isNum(v) && v > 0) shares.set(c, (shares.get(c) ?? 0) + v);
  };
  let basis: OriginMix['basis'] = 'datasets';
  const cells = summary?.totals?.cellShareByOrigin;
  if (cells && Object.values(cells).some((v) => isNum(v) && v > 0)) {
    basis = 'cells';
    for (const [o, v] of Object.entries(cells) as [DatasetOrigin, number][]) add(originClassOf(o), v);
  } else {
    for (const r of records) {
      if (r.role === 'bundle' || r.role === 'pack') continue;
      if (r.status === 'unavailable' || r.status === 'skipped') continue;
      add(originClassOf(r.plan?.likelyOrigin ?? r.origin), 1);
    }
  }
  const total = [...shares.values()].reduce((a, b) => a + b, 0);
  const parts: OriginMixPart[] = ORIGIN_CLASS_ORDER.filter((c) => (shares.get(c) ?? 0) > 0).map((c) => {
    const share = total > 0 ? shares.get(c)! / total : 0;
    return { cls: c, share, label: ORIGIN_CLASS_INFO[c].label, text: formatPercent(share) };
  });
  const caption =
    basis === 'cells'
      ? 'Where the map values come from (ground, vegetation, canopy and fire history; share of the model cells)'
      : 'Where the data sets come from (share of the data sets used)';
  const label = parts.length ? `${caption}: ${parts.map((p) => `${p.label} ${p.text}`).join(', ')}` : `${caption}: nothing yet`;
  return { basis, parts, caption, label };
}

/** '9 used · 2 partly real · 2 substitutes · 2 not used' (only the non-zero counts). */
export function statusCountsLine(records: readonly DatasetRecord[]): string {
  let used = 0;
  let partial = 0;
  let fallback = 0;
  let notUsed = 0;
  let user = 0;
  for (const r of records) {
    if (r.status === 'used') used++;
    else if (r.status === 'partial') partial++;
    else if (r.status === 'fallback') fallback++;
    else if (r.status === 'user') user++;
    else notUsed++;
  }
  const out: string[] = [];
  if (used) out.push(`${used} used`);
  if (partial) out.push(`${partial} partly real`);
  if (fallback) out.push(`${fallback} ${fallback === 1 ? 'substitute' : 'substitutes'}`);
  if (user) out.push(`${user} entered by you`);
  if (notUsed) out.push(`${notUsed} not used`);
  return out.join(' · ');
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary header (DS1)
// ─────────────────────────────────────────────────────────────────────────────

export interface HeaderStat {
  id: 'count' | 'downloaded' | 'memory' | 'stored';
  /** Small word before the number ('up to', '≈'), or ''. */
  prefix: string;
  value: string;
  unit: string;
  caption: string;
}

export interface SummaryHeader {
  mode: 'built' | 'planned' | 'empty';
  title: string;
  /** '15 data sets · 2.3 MB downloaded · 14.0 MB in memory · 3.3 MB stored on this phone' */
  sentence: string;
  stats: HeaderStat[];
  /** Short extra lines under the stats (uncompressed size, bundled bytes, requests). */
  notes: string[];
}

/** Records that stand for a data set (not the bundle / pack packaging records). */
const dataRecords = (records: readonly DatasetRecord[]): DatasetRecord[] => records.filter((r) => r.role !== 'bundle' && r.role !== 'pack');

/**
 * The header of a built scenario (with its summary), of a plan (records with `plan`), or of nothing (no scenario, no
 * plan). `storedOnPhoneBytes` is what the app keeps on the phone in all (storage report), used when there is no scenario.
 */
export function summaryHeader(records: readonly DatasetRecord[], summary: DatasetSummary | null | undefined, o: { storedOnPhoneBytes?: number } = {}): SummaryHeader {
  const planned = records.length > 0 && records.every((r) => !!r.plan);
  // Every row of the list counts (the bundled-site / area-pack rows too), so the header and the list agree.
  const n = records.length;
  const countStat: HeaderStat = { id: 'count', prefix: '', value: fc(n), unit: '', caption: n === 1 ? 'data set' : 'data sets' };
  if (planned) {
    let net = 0;
    let onDevice = 0;
    for (const r of records) {
      const p = r.plan!;
      net += isNum(p.networkBytes) ? p.networkBytes : 0;
      if (p.networkBytes === 0 && (p.onDevice || r.origin === 'bundled')) onDevice += r.sizes.transferredBytes;
    }
    const d = splitBytes(net);
    const s = splitBytes(onDevice);
    const offlineMissing = records.filter((r) => r.plan && !r.plan.offlineOk).map((r) => r.title);
    const stats: HeaderStat[] = [
      countStat,
      { id: 'downloaded', prefix: net > 0 ? '≈' : '', value: d.value, unit: d.unit, caption: 'to download' },
      { id: 'stored', prefix: '', value: s.value, unit: s.unit, caption: 'already on this phone' },
    ];
    const notes = [
      'Planned before anything is downloaded: ≈ sizes are estimates of the uncompressed answers (the services usually send less); bundled sizes are exact.',
      offlineMissing.length ? `Needs a signal for: ${offlineMissing.join(', ')}.` : 'Works with no signal: everything is on this phone.',
    ];
    return {
      mode: 'planned',
      title: 'Planned data for this run',
      sentence: `${plural(n, 'data set')} planned · ${net > 0 ? `≈ ${formatBytes(net)} to download` : 'nothing to download'} · ${formatBytes(onDevice)} already on this phone`,
      stats,
      notes,
    };
  }
  if (!summary && !records.length) {
    const s = splitBytes(o.storedOnPhoneBytes ?? 0);
    return {
      mode: 'empty',
      title: 'No model built yet',
      sentence: `No model built yet · ${formatBytes(o.storedOnPhoneBytes ?? 0)} stored on this phone`,
      stats: [{ id: 'stored', prefix: '', value: s.value, unit: s.unit, caption: 'stored on this phone' }],
      notes: ['Build a model to see every data set it uses. What the app keeps on this phone is listed below.'],
    };
  }
  const t = summary?.totals;
  const net = t ? t.networkBytes : records.reduce((a, r) => a + r.sizes.networkBytes, 0);
  const unmeasured = t ? (t.networkUnmeasuredBytes ?? 0) : records.reduce((a, r) => a + (r.sizes.networkUnmeasuredBytes ?? 0), 0);
  const decoded = t?.networkDecodedBytes;
  const memory = t ? t.memoryBytes : records.reduce((a, r) => a + (r.sizes.memoryBytes ?? 0), 0);
  const stored = t ? t.storedBytes : records.reduce((a, r) => a + (r.sizes.storedOnDeviceBytes ?? 0), 0);
  const transferred = t ? t.transferredBytes : records.reduce((a, r) => a + r.sizes.transferredBytes, 0);
  const cached = t ? t.cachedBytes : records.reduce((a, r) => a + r.sizes.cachedBytes, 0);
  const requests = t ? t.requests : records.reduce((a, r) => a + r.sizes.requests, 0);
  const bundled = Math.max(0, transferred - Math.min(net, transferred) - cached);
  const upTo = unmeasured > 0;
  const d = splitBytes(net);
  const m = splitBytes(memory);
  const s = splitBytes(stored);
  // Nothing downloaded: the second number says where the bytes came from instead of showing a bare zero.
  const read = net > 0 ? null : cached > 0 ? { b: cached, caption: 'from stored copies, nothing downloaded' } : bundled > 0 ? { b: bundled, caption: 'from the app, nothing downloaded' } : null;
  const rd = read ? splitBytes(read.b) : d;
  const stats: HeaderStat[] = [
    countStat,
    { id: 'downloaded', prefix: upTo ? 'up to' : '', value: rd.value, unit: rd.unit, caption: read ? read.caption : 'downloaded' },
    { id: 'memory', prefix: '', value: m.value, unit: m.unit, caption: 'data in memory' },
    { id: 'stored', prefix: '', value: s.value, unit: s.unit, caption: 'saved on this phone' },
  ];
  const notes: string[] = [];
  if (upTo) notes.push(`Up to: the phone did not report the compressed size of ${formatBytes(unmeasured)} of the download, so its uncompressed size is counted; the real download was that much or less.`);
  if (decoded !== undefined && decoded !== net && formatBytes(decoded) !== formatBytes(net)) notes.push(`${formatBytes(decoded)} once uncompressed: the services compress their answers.`);
  const from: string[] = [];
  if (net > 0 || (cached > 0 && bundled > 0)) {
    if (cached > 0 && !(read && read.b === cached)) from.push(`${formatBytes(cached)} from copies stored on this phone`);
    if (bundled > 0 && !(read && read.b === bundled)) from.push(`${formatBytes(bundled)} from files bundled with the app`);
  }
  if (from.length) notes.push(`Also read: ${from.join(' and ')}.`);
  if (requests > 0) notes.push(`${plural(requests, 'request or file read', 'requests and file reads')}${summary?.buildDurationMs ? `; the build took ${formatDuration(summary.buildDurationMs)}` : ''}.`);
  return {
    mode: 'built',
    title: clean(summary?.scenarioName) || 'This model',
    sentence: `${plural(n, 'data set')} · ${upTo ? 'up to ' : ''}${formatBytes(net)} downloaded · ${formatBytes(memory)} in memory · ${formatBytes(stored)} stored on this phone`,
    stats,
    notes,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Freshness, fallbacks, model dimensions, reproduction (DS1)
// ─────────────────────────────────────────────────────────────────────────────

/** Every date in a published capture string ('2019/2020', '2013-10-16 to 2014-01-20', '2016'), as ISO pieces. */
export function capturedDates(s: string | undefined): string[] {
  return [...clean(s).matchAll(/\b(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?\b/g)].map((m) => m[0]).filter((d) => formatIsoDay(d) !== '');
}

export interface Freshness {
  lines: string[];
  /** True when the weather was already stale (docs/research/08 §5.5: 6 h forecast, 24 h past day). */
  weatherStale: boolean;
}

/** 'Newest data captured 29 Sep 2026 (Roads and tracks); oldest 2016 (Tree canopy height)', the weather's age, the build time. */
export function freshness(records: readonly DatasetRecord[], summary: DatasetSummary | null | undefined, nowMs: number, tz = 'Australia/Sydney'): Freshness {
  const lines: string[] = [];
  let newest: { d: string; title: string } | null = null;
  let oldest: { d: string; title: string } | null = null;
  for (const r of dataRecords(records)) {
    if (r.status === 'unavailable' || r.status === 'skipped') continue;
    for (const d of capturedDates(r.vintage?.capturedOn)) {
      if (!newest || d > newest.d) newest = { d, title: r.title };
      if (!oldest || d < oldest.d) oldest = { d, title: r.title };
    }
  }
  if (newest && oldest && newest.d !== oldest.d) lines.push(`Newest data captured ${formatIsoDay(newest.d)} (${newest.title}); oldest ${formatIsoDay(oldest.d)} (${oldest.title}).`);
  else if (newest) lines.push(`Data captured ${formatIsoDay(newest.d)} (${newest.title}).`);
  let weatherStale = false;
  const w = records.find((r) => r.id === 'weather');
  if (w && !w.plan) {
    if (w.origin === 'preset') lines.push('Weather: a day designed by the app, not a forecast or an observation.');
    else if (w.origin === 'user') lines.push('Weather: the readings you entered.');
    else if (w.origin === 'bundled') lines.push(`Weather: a past day bundled with the app${w.vintage.retrievedAt > 0 ? `, captured ${formatDay(w.vintage.retrievedAt, tz)}` : ''}.`);
    else if ((w.origin === 'live' || w.origin === 'cache' || w.origin === 'area-pack') && w.vintage.retrievedAt > 0) {
      const past = /past|archive|historical/i.test(`${w.originDetail ?? ''} ${w.what}`);
      const st = weatherStaleness(w, nowMs, past ? 'past' : 'forecast');
      weatherStale = st.stale;
      const how = w.origin === 'live' ? 'downloaded' : 'from a stored copy made';
      lines.push(`Weather ${how} ${formatAgo(w.vintage.retrievedAt, nowMs)} (${formatDayTime(w.vintage.retrievedAt, tz)})${st.stale ? `: older than ${st.thresholdHours} h, check it against your belt weather kit` : ''}.`);
    } else if (w.status === 'fallback' || w.status === 'unavailable') lines.push(`Weather: ${reasonOf(w) || STATUS_TITLES[w.status]}`);
  }
  if (summary?.builtAt) lines.push(`Model built ${formatDayTime(summary.builtAt, tz)}${summary.buildDurationMs ? ` in ${formatDuration(summary.buildDurationMs)}` : ''}.`);
  return { lines: lines.map(clean).filter(Boolean), weatherStale };
}

export interface FallbackNote {
  id: string;
  title: string;
  status: string;
  reason: string;
}

/** The data sets that are not what they say (substitutes, partly real, missing, stale), with the reason in plain English. */
export function fallbackNotes(records: readonly DatasetRecord[], summary?: DatasetSummary | null): FallbackNote[] {
  if (summary?.fallbacks?.length) return summary.fallbacks.map((f) => ({ id: f.id, title: f.title, status: STATUS_TITLES[f.status] ?? '', reason: clean(f.reason) })).filter((f) => f.reason);
  return records
    .filter((r) => isSubstitute(r))
    .map((r) => ({ id: r.id, title: r.title, status: STATUS_TITLES[r.status], reason: reasonOf(r) }))
    .filter((f) => f.reason);
}

export interface Fact {
  key: string;
  value: string;
  /** A plain-English line under the value (what it means, how it was measured). */
  note?: string;
}

const TIER_WORDS: Record<string, string> = {
  auto: 'Auto: starts on Standard (3-D atmosphere); the app may switch to Fast (a 2-D wind shaped by the ground) after timing this phone',
  fast: 'Fast: a 2-D wind shaped by the ground (no 3-D air movement)',
  standard: 'Standard: 3-D atmosphere',
  high: 'High: finer 3-D atmosphere',
};

/** The model's grid, area and tier from the summary (DS1), as key-value facts. */
export function modelFacts(summary: DatasetSummary | null | undefined): Fact[] {
  const m = summary?.model;
  if (!m) return [];
  const out: Fact[] = [];
  if (isNum(m.nx) && isNum(m.ny) && isNum(m.cellSizeM)) out.push({ key: 'Fire grid', value: `${fc(m.nx)} x ${fc(m.ny)} cells of ${formatMetres(m.cellSizeM)} (${fc(m.cells ?? m.nx * m.ny)} cells)` });
  if (isNum(m.extentM) && m.extentM > 0) out.push({ key: 'Area', value: `${formatMetres(m.extentM)} x ${formatMetres(m.extentM)} (${fc((m.extentM / 1000) ** 2)} km²)` });
  if (isNum(m.hiResNx) && isNum(m.hiResNy) && isNum(m.hiResCellM)) out.push({ key: 'Ground for the 3-D view', value: `${fc(m.hiResNx)} x ${fc(m.hiResNy)} cells of ${formatMetres(m.hiResCellM)}` });
  if (isNum(m.atmosCellM)) out.push({ key: 'Atmosphere grid', value: `${formatMetres(m.atmosCellM)} cells${isNum(m.atmosLevels) ? `, ${m.atmosLevels} levels up from the ground` : ''}` });
  const tier = clean(m.tier);
  if (tier) out.push({ key: 'Detail tier', value: TIER_WORDS[tier] ?? tier });
  if (isNum(m.durationS) && m.durationS > 0) out.push({ key: 'Simulated time', value: formatHours(m.durationS) });
  return out;
}

const formatHours = (s: number): string => {
  const h = s / 3600;
  return h >= 1 ? `${Math.round(h * 10) / 10} h` : `${Math.round(s / 60)} min`;
};

/** The recipe to rebuild the same run: its id, seed and the request facts, as stable text (for "Copy"). */
export function reproduceText(summary: DatasetSummary | null | undefined): string {
  const r = summary?.reproduce;
  if (!r) return '';
  const lines = [
    `FireSim scenario ${clean(r.scenarioId)}`,
    `Seed: ${clean(r.seed)}`,
    isNum(r.centre?.lat) && isNum(r.centre?.lon) ? `Centre: ${r.centre.lat.toFixed(5)}, ${r.centre.lon.toFixed(5)}` : '',
    Array.isArray(r.bbox) && r.bbox.every(isNum) ? `Area (west, south, east, north): ${r.bbox.map((v) => v.toFixed(5)).join(', ')}` : '',
    isNum(r.extentM) ? `Square: ${formatMetres(r.extentM)}; cells ${formatMetres(r.cellSizeM)}` : '',
    isNum(r.startTime) && r.startTime > 0 ? `Start: ${new Date(r.startTime).toISOString()}; ${formatHours(r.durationS)}` : '',
    clean(r.weatherMode) ? `Weather: ${clean(r.weatherMode)}` : '',
    r.demoSiteId ? `Demo site: ${clean(r.demoSiteId)}` : '',
    `Network: ${r.online ? 'on' : 'off'}`,
  ];
  return lines.filter(Boolean).join('\n') + '\n';
}

// ─────────────────────────────────────────────────────────────────────────────
// The list (DS2): filters, sorting, rows
// ─────────────────────────────────────────────────────────────────────────────

export type FilterId = 'all' | 'terrain' | 'vegetation' | 'weather' | 'places' | 'derived' | 'yours';

const FILTER_TESTS: Record<FilterId, (r: DatasetRecord) => boolean> = {
  all: () => true,
  terrain: (r) => r.role === 'terrain' || r.role === 'imagery',
  vegetation: (r) => r.role === 'vegetation' || r.role === 'canopy' || r.role === 'fuel' || r.role === 'fireHistory',
  weather: (r) => r.role === 'weather' || r.role === 'upperAir',
  places: (r) => r.role === 'context',
  derived: (r) => r.role === 'derived' || r.origin === 'derived' || r.kind === 'derived',
  yours: (r) => r.role === 'user' || r.origin === 'user',
};

export const FILTERS: readonly { id: FilterId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'terrain', label: 'Terrain' },
  { id: 'vegetation', label: 'Vegetation and fuel' },
  { id: 'weather', label: 'Weather' },
  { id: 'places', label: 'Places' },
  { id: 'derived', label: 'Derived' },
  { id: 'yours', label: 'Yours' },
];

/** The filters that match at least one record ('All' always), with their counts. */
export function availableFilters(records: readonly DatasetRecord[]): { id: FilterId; label: string; count: number }[] {
  return FILTERS.map((f) => ({ ...f, count: records.filter(FILTER_TESTS[f.id]).length })).filter((f) => f.id === 'all' || f.count > 0);
}

export const filterRecords = (records: readonly DatasetRecord[], f: FilterId): DatasetRecord[] => records.filter(FILTER_TESTS[f] ?? FILTER_TESTS.all);

export type SortId = 'kind' | 'size' | 'name' | 'origin';

export const SORTS: readonly { id: SortId; label: string }[] = [
  { id: 'kind', label: 'Kind' },
  { id: 'size', label: 'Size' },
  { id: 'name', label: 'Name' },
  { id: 'origin', label: 'Origin' },
];

/** Bytes a row is measured by: the planned download of a plan, else what was obtained. */
export const rowBytes = (r: DatasetRecord): number => (r.plan ? (r.plan.networkBytes > 0 ? r.plan.networkBytes : r.sizes.transferredBytes) : r.sizes.transferredBytes);

const originRank = (r: DatasetRecord): number => {
  const c = originClassOf(r.plan?.likelyOrigin ?? r.origin);
  return c ? ORIGIN_CLASS_ORDER.indexOf(c) : ORIGIN_CLASS_ORDER.length;
};

/** A sorted copy: kind = the canonical order, size = biggest first (then memory), name = A-Z, origin = live, saved, bundled, estimated, yours, not used. */
export function sortRecords(records: readonly DatasetRecord[], by: SortId): DatasetRecord[] {
  const rs = [...records];
  switch (by) {
    case 'size':
      return rs.sort((a, b) => rowBytes(b) - rowBytes(a) || (b.sizes.memoryBytes ?? 0) - (a.sizes.memoryBytes ?? 0) || compareDatasets(a, b));
    case 'name':
      return rs.sort((a, b) => a.title.localeCompare(b.title, 'en') || compareDatasets(a, b));
    case 'origin':
      return rs.sort((a, b) => originRank(a) - originRank(b) || compareDatasets(a, b));
    default:
      return rs.sort(compareDatasets);
  }
}

/** Sections of the list: one per role for the 'kind' order (with the role titles), a single untitled one otherwise. */
export function listSections(records: readonly DatasetRecord[], filter: FilterId, sort: SortId): { title: string; role?: DatasetRole; records: DatasetRecord[] }[] {
  const rs = filterRecords(records, filter);
  if (sort === 'kind') return groupByRole(rs).map((g) => ({ title: g.title, role: g.role, records: g.records }));
  return rs.length ? [{ title: '', records: sortRecords(rs, sort) }] : [];
}

/** '5 m → 30 m', '3 059 shapes → 30 m', '96 hourly values'; '' when nothing is known. */
export function resolutionText(r: DatasetRecord): string {
  const side = (g: DatasetGridInfo | undefined, withCounts: boolean): string => {
    if (!g) return '';
    if (isNum(g.resolutionM) && g.resolutionM > 0) return formatMetres(g.resolutionM);
    if (!withCounts) return '';
    if (isNum(g.features) && g.features > 0) return plural(g.features, 'shape');
    if (isNum(g.points) && g.points > 0) return plural(g.points, 'point');
    if (isNum(g.records) && g.records > 0) return plural(g.records, r.kind === 'timeseries' ? 'time step' : 'record');
    return '';
  };
  const a = side(r.native, true);
  const b = side(r.model, false);
  if (a && b && a !== b) return `${a} → ${b}`;
  return a || b;
}

export interface RowModel {
  id: string;
  title: string;
  provider: string;
  icon: IconName;
  origin: { cls: OriginClass; label: string } | null;
  status: { label: string; tone: 'watch' | 'neutral'; notUsed: boolean } | null;
  notUsed: boolean;
  /** Why it is a substitute or not used ('' when it is fine). */
  reason: string;
  resolution: string;
  /** '1.4 MB', 'up to 957.0 KB', '≈ 1.8 MB'; '' when nothing was obtained. */
  size: string;
  /** Accessible wording of the size ('1.4 MB read from files bundled with the app'). */
  sizeLabel: string;
  /** '13.1 MB' in memory, '' when it holds none. */
  memory: string;
  /** Size relative to the largest row (0-1), for the row's size bar. */
  fraction: number;
  spark: number[] | null;
  sparkLabel: string;
  estimate: boolean;
  /** Everything the row says, for its accessible name. */
  label: string;
}

/** Plain provider name (without the parenthetical part). */
export const shortProvider = (name: string): string => clean(name).replace(/\s*\(.*$/, '').trim() || clean(name);

function sizeWords(r: DatasetRecord): { size: string; label: string } {
  if (r.plan) {
    const b = rowBytes(r);
    if (b <= 0) return { size: '', label: '' };
    const exact = r.plan.lowBytes === r.plan.highBytes && r.plan.networkBytes === 0;
    const s = `${exact ? '' : '≈ '}${formatBytes(b)}`;
    return { size: s, label: r.plan.networkBytes > 0 ? `about ${formatBytes(b)} to download (estimate)` : `${formatBytes(b)} already on this phone` };
  }
  const z = r.sizes;
  if (z.transferredBytes <= 0) return { size: '', label: '' };
  const upTo = (z.networkUnmeasuredBytes ?? 0) > 0;
  const s = `${upTo ? 'up to ' : ''}${formatBytes(z.transferredBytes)}`;
  const where = z.networkBytes >= z.transferredBytes ? 'downloaded' : z.cachedBytes >= z.transferredBytes ? 'read from a copy stored on this phone' : z.networkBytes > 0 || z.cachedBytes > 0 ? 'obtained' : 'read from files bundled with the app';
  return { size: s, label: `${s} ${where}` };
}

/** Bars of a distribution for a spark bar: histogram shares as they are, categories largest first (at most 10). */
export function sparkValues(d: DatasetDistribution | undefined): number[] | null {
  if (!d || !Array.isArray(d.values) || d.values.length < 2) return null;
  const v = d.values.map((x) => (isNum(x) && x > 0 ? x : 0));
  if (!v.some((x) => x > 0)) return null;
  return d.kind === 'categorical' ? [...v].sort((a, b) => b - a).slice(0, 10) : v.slice(0, 24);
}

/** One list row (DS2). `maxBytes` is the largest row's bytes (for the relative size bar). */
export function rowModel(r: DatasetRecord, maxBytes: number): RowModel {
  const origin = originChipOf(r.plan ? { ...r, origin: r.plan.likelyOrigin } : r);
  const status = statusChipOf(r);
  const notUsed = !!status?.notUsed;
  const reason = notUsed || isSubstitute(r) ? reasonOf(r) || clean(r.plan?.offlineNote) : '';
  const { size, label: sizeLabel } = sizeWords(r);
  const memory = !r.plan && isNum(r.sizes.memoryBytes) && r.sizes.memoryBytes > 0 ? formatBytes(r.sizes.memoryBytes) : '';
  const bytes = rowBytes(r);
  const spark = r.plan ? null : sparkValues(r.distribution);
  const sparkLabel = spark && r.distribution ? `${clean(r.distribution.title) || 'Distribution'}: ${r.distribution.kind === 'categorical' ? 'shares of the classes' : 'histogram'}` : '';
  const resolution = resolutionText(r);
  const provider = shortProvider(r.provider?.name ?? '');
  const label = [
    r.title,
    provider,
    origin?.label,
    status?.label,
    sizeLabel,
    memory ? `${memory} in memory` : '',
    resolution ? `resolution ${resolution.replace('→', 'to')}` : '',
    reason,
  ]
    .map(clean)
    .filter(Boolean)
    .join(', ');
  return {
    id: r.id,
    title: clean(r.title) || r.id,
    provider,
    icon: datasetIcon(r.id, r.role),
    origin,
    status,
    notUsed,
    reason,
    resolution,
    size,
    sizeLabel,
    memory,
    fraction: maxBytes > 0 && bytes > 0 ? Math.min(1, bytes / maxBytes) : 0,
    spark,
    sparkLabel,
    estimate: !!r.plan || !!r.sizes.estimate,
    label,
  };
}

/** Rows of the list, in sections, for a filter and a sort. */
export function listModel(records: readonly DatasetRecord[], filter: FilterId, sort: SortId): { title: string; rows: RowModel[] }[] {
  const max = records.reduce((m, r) => Math.max(m, rowBytes(r)), 0);
  return listSections(records, filter, sort).map((s) => ({ title: s.title, rows: s.records.map((r) => rowModel(r, max)) }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail (DS3)
// ─────────────────────────────────────────────────────────────────────────────

export const RESAMPLING_WORDS: Readonly<Record<DatasetResampling, string>> = Object.freeze({
  none: 'used as it is',
  nearest: 'nearest value',
  bilinear: 'smoothly interpolated between neighbours (bilinear)',
  'area-average': 'averaged over the area of each cell',
  'block-average': 'finer cells averaged into each model cell',
  majority: 'the most common class in each cell',
  rasterise: 'shapes turned into cells',
  'interpolate-in-time': 'interpolated between its time steps',
  generated: 'generated by the app for the model',
});

const RETRIEVED_WORDS: Record<string, string> = {
  'this-build': 'downloaded for this build',
  'stored-copy': 'when the stored copy was downloaded',
  'bundle-capture': 'when the copy bundled with the app was made',
  generated: 'when the app made it',
  unknown: '',
};

const dims = (g: DatasetGridInfo | undefined): string => {
  if (!g) return '';
  const parts: string[] = [];
  if (isNum(g.resolutionM) && g.resolutionM > 0) parts.push(`${formatMetres(g.resolutionM)} cells`);
  if (isNum(g.width) && isNum(g.height) && g.width > 0 && g.height > 0) parts.push(`${fc(g.width)} x ${fc(g.height)}`);
  if (isNum(g.cells) && g.cells > 0 && !(isNum(g.width) && isNum(g.height))) parts.push(plural(g.cells, 'cell'));
  if (isNum(g.features)) parts.push(plural(g.features, 'shape'));
  if (isNum(g.points)) parts.push(plural(g.points, 'point'));
  if (isNum(g.records)) parts.push(plural(g.records, 'record'));
  return parts.join(', ');
};

const cap = (t: string): string => (t ? t[0]!.toUpperCase() + t.slice(1) : t);

const corner = (lat: number, lon: number): string => `${Math.abs(lat).toFixed(4)}° ${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(4)}° ${lon < 0 ? 'W' : 'E'}`;

/** Provider, licence, credit, services and format (the link rows get their buttons in the screen). */
export function sourceFacts(r: DatasetRecord): Fact[] {
  const out: Fact[] = [];
  const add = (key: string, value: unknown): void => {
    const v = clean(value);
    if (v) out.push({ key, value: v });
  };
  add('Provider', r.provider?.name);
  add('Licence', r.licence?.name);
  add('Credit line', r.attribution);
  add('From', r.originDetail);
  add('Read in this build', r.endpoints.map((e) => `${e.host === 'bundled' ? 'bundled file' : e.host} ${e.path}${e.requests ? ` (${plural(e.requests, 'request')})` : ''}${e.note ? `, ${e.note}` : ''}`).join('\n'));
  add('Original service', r.sourceServices.map((e) => `${e.host}${e.path}${e.note ? ` (${e.note})` : ''}`).join('\n'));
  add('Format', r.format);
  return out;
}

/** Capture date, when this copy was obtained, version, "current to", how long a stored copy stays fresh, weather age. */
export function timeFacts(r: DatasetRecord, nowMs: number, tz = 'Australia/Sydney'): Fact[] {
  const v = r.vintage;
  const out: Fact[] = [];
  if (!v) return out;
  const add = (key: string, value: unknown): void => {
    const s = clean(value);
    if (s) out.push({ key, value: s });
  };
  const cap = clean(v.capturedOn);
  add('Captured', cap ? capturedDates(cap).length === 1 && formatIsoDay(cap) ? formatIsoDay(cap) : cap : v.captureSummary);
  add('About the capture date', v.capturedNote);
  if (v.retrievedAt > 0 && v.retrievedBasis !== 'unknown') {
    const when = v.retrievedBasis === 'bundle-capture' ? formatDay(v.retrievedAt, tz) : formatDayTime(v.retrievedAt, tz);
    const ago = v.retrievedBasis === 'this-build' || v.retrievedBasis === 'stored-copy' ? formatAgo(v.retrievedAt, nowMs) : '';
    add('This copy obtained', `${when}${RETRIEVED_WORDS[v.retrievedBasis] ? ` (${RETRIEVED_WORDS[v.retrievedBasis]})` : ''}${ago ? `, ${ago}` : ''}`);
  }
  add('Version', [clean(v.version), clean(v.versionNote)].filter(Boolean).join(': '));
  add('Current to', formatIsoDay(v.currentTo) || v.currentTo);
  if (isNum(v.cacheFreshUntil) && v.cacheFreshUntil > 0) add('Stored copy used until', `${formatDayTime(v.cacheFreshUntil, tz)}, then asked for again`);
  if ((r.role === 'weather' || r.role === 'upperAir') && isNum(v.ageHoursAtBuild)) {
    add('Age when the model was built', `${Math.round(v.ageHoursAtBuild * 10) / 10} h${isNum(v.staleAfterHours) ? ` (stale after ${v.staleAfterHours} h)` : ''}${v.stale ? ': stale' : ''}`);
  }
  return out;
}

/** Coordinate system, extent, coverage, resolution and dimensions as published and in the model. */
export function spaceFacts(r: DatasetRecord): Fact[] {
  const out: Fact[] = [];
  const add = (key: string, value: unknown): void => {
    const s = clean(value);
    if (s) out.push({ key, value: s });
  };
  if (r.crs) add('Coordinates', `${clean(r.crs.native)}. ${clean(r.crs.toModel)}`);
  const e = r.extent;
  if (e && [e.west, e.south, e.east, e.north].every(isNum)) {
    add('North-west corner', corner(e.north, e.west));
    add('South-east corner', corner(e.south, e.east));
    if (isNum(e.areaKm2) && e.areaKm2 > 0) add('Area', `${fc(e.areaKm2)} km²`);
  }
  if (r.origin !== 'none' && r.coverage && isNum(r.coverage.fraction)) {
    add('Real data cover', `${formatPercent(r.coverage.fraction)} of the model area${r.coverage.filledBy ? `; the rest: ${clean(r.coverage.filledBy)}` : ''}`);
    if (r.coverage.note && r.coverage.note !== r.fallbackReason) add('Coverage note', r.coverage.note);
  }
  add('As published', [dims(r.native), clean(r.native?.note)].filter(Boolean).join('. '));
  if (r.model) {
    const how = RESAMPLING_WORDS[r.model.resampling] ?? '';
    const head = [dims(r.model), how].filter(Boolean).join('; ');
    add('In the model', [head ? cap(head) : '', clean(r.model.note)].filter(Boolean).join('. '));
  }
  const ch = r.model?.channels ?? r.native?.channels;
  if (ch?.length) add('Values held', ch.map(clean).filter(Boolean).join('; '));
  return out;
}

/** Where a planned data set will likely come from, in words that read before the build. */
const PLANNED_FROM: Partial<Record<DatasetOrigin, string>> = {
  live: 'A download while the model is built',
  cache: 'A copy already stored on this phone',
  'area-pack': 'An area you saved for offline use',
  bundled: 'Files bundled with the app',
  synthetic: 'Made up by the app',
  preset: 'Designed by the app',
  user: 'Entered by you',
  derived: 'Worked out on the phone from the other data',
  none: 'Nothing',
};

export interface SizeBreakdown {
  facts: Fact[];
  /** Obtained bytes by where they came from, for a stacked bar (network / stored copies / bundled). */
  parts: { id: 'network' | 'stored' | 'bundled'; label: string; bytes: number; colour: BarColour }[];
  /** The byte figures that get a bar each (relative to the largest of them). */
  bars: { label: string; bytes: number; text: string }[];
}

/** Sizes: obtained, over the network (compressed / uncompressed / up to), stored copies, bundled, decoded, memory, stored. */
export function sizeFacts(r: DatasetRecord): SizeBreakdown {
  const z = r.sizes;
  const facts: Fact[] = [];
  const add = (key: string, value: unknown, note?: string): void => {
    const s = clean(value);
    const n = clean(note);
    if (s) facts.push(n ? { key, value: s, note: n } : { key, value: s });
  };
  const parts: SizeBreakdown['parts'] = [];
  const bars: SizeBreakdown['bars'] = [];
  if (r.plan) {
    const p = r.plan;
    if (p.networkBytes > 0) add('Planned download', `≈ ${formatBytes(p.networkBytes)}`, `Uncompressed; likely ${formatBytes(p.lowBytes)} to ${formatBytes(p.highBytes)}. The services usually send less.`);
    else add('Planned download', 'Nothing', p.onDevice || r.origin === 'bundled' ? 'Already on this phone.' : '');
    if (p.networkBytes === 0 && r.sizes.transferredBytes > 0) add('On this phone', formatBytes(r.sizes.transferredBytes), 'Exact: the size of the files.');
    add('Likely from', PLANNED_FROM[p.likelyOrigin] ?? ORIGIN_TITLES[p.likelyOrigin]);
    if (z.requests > 0) add('Requests', fc(z.requests));
    add('With no signal', p.offlineOk ? 'Works' : 'Needs a signal', p.offlineNote);
    add('How it was estimated', p.basis);
    return { facts, parts, bars };
  }
  const upTo = (z.networkUnmeasuredBytes ?? 0) > 0;
  const bundled = Math.max(0, z.transferredBytes - Math.min(z.networkBytes, z.transferredBytes) - z.cachedBytes);
  add('Obtained for this build', `${upTo ? 'up to ' : ''}${formatBytes(z.transferredBytes)}`, 'From the network, copies stored on this phone and files bundled with the app.');
  if (z.networkBytes > 0) {
    const extra: string[] = [];
    if (isNum(z.networkDecodedBytes) && formatBytes(z.networkDecodedBytes) !== formatBytes(z.networkBytes)) extra.push(`${formatBytes(z.networkDecodedBytes)} once uncompressed.`);
    if (upTo) extra.push(z.networkUnmeasuredBytes! >= z.networkBytes ? 'At most: the phone did not report the compressed size, so the uncompressed size is counted.' : `${formatBytes(z.networkUnmeasuredBytes)} of it is counted uncompressed: the phone did not report its compressed size.`);
    if (z.networkBytes > z.transferredBytes) extra.push('Includes requests that failed or were retried.');
    add('Over the network', `${upTo ? 'up to ' : ''}${formatBytes(z.networkBytes)}`, extra.join(' '));
    parts.push({ id: 'network', label: 'Downloaded', bytes: Math.min(z.networkBytes, z.transferredBytes), colour: 'ok' });
  }
  if (z.cachedBytes > 0) {
    add('From copies stored on this phone', formatBytes(z.cachedBytes));
    parts.push({ id: 'stored', label: 'Stored copy', bytes: z.cachedBytes, colour: 's4' });
  }
  if (bundled > 0) {
    add('From files bundled with the app', formatBytes(bundled));
    parts.push({ id: 'bundled', label: 'Bundled', bytes: bundled, colour: 's1' });
  }
  if (isNum(z.decodedBytes)) add('Unpacked', formatBytes(z.decodedBytes), 'The text or pixels after decompression and decoding.');
  if (isNum(z.memoryBytes)) add('In memory while the app runs', formatBytes(z.memoryBytes), z.memoryBytes > 0 ? 'Its grids, counted on the screen side and in the simulation worker, which keeps its own copy.' : '');
  if (isNum(z.storedOnDeviceBytes)) add('Saved on this phone by the build', formatBytes(z.storedOnDeviceBytes), z.storedOnDeviceBytes > 0 ? 'Kept so this place can be run again with no signal.' : '');
  const counts: string[] = [];
  if (isNum(z.tiles) && z.tiles > 0) counts.push(plural(z.tiles, 'tile'));
  if (isNum(z.features)) counts.push(plural(z.features, 'shape'));
  if (isNum(z.records)) counts.push(plural(z.records, 'record'));
  if (counts.length) add('Counted', counts.join(', '));
  add('Requests and file reads', fc(z.requests));
  if (isNum(z.durationMs) && z.durationMs > 0) add('Time to get and prepare', formatDuration(z.durationMs));
  const push = (label: string, b: number | undefined, prefix = ''): void => {
    if (isNum(b) && b > 0) bars.push({ label, bytes: b, text: `${prefix}${formatBytes(b)}` });
  };
  push('Obtained', z.transferredBytes, upTo ? 'up to ' : '');
  if (isNum(z.networkDecodedBytes)) push('Uncompressed', z.networkDecodedBytes);
  else push('Unpacked', z.decodedBytes);
  push('In memory', z.memoryBytes);
  push('Saved on this phone', z.storedOnDeviceBytes);
  return { facts, parts, bars };
}

/** The recorded statistics, as they were recorded (label, value, hint). */
export function statFacts(r: DatasetRecord): Fact[] {
  return (r.stats ?? [])
    .map((s): Fact => {
      const hint = clean(s.hint);
      return hint ? { key: clean(s.label), value: clean(s.value), note: hint } : { key: clean(s.label), value: clean(s.value) };
    })
    .filter((s) => s.key && s.value);
}

export interface DistributionModel {
  kind: 'histogram' | 'categorical';
  title: string;
  /** Histogram: bar heights 0-1 (largest = 1) with the shares; categorical: the classes largest first. */
  bars: { share: number; height: number; label: string; colour?: string }[];
  /** Axis text of a histogram: lowest and highest bin edge with the unit. */
  axis: { lo: string; hi: string } | null;
  /** 'of 90 000 cells' */
  caption: string;
  label: string;
}

const edge = (v: number, unit: string): string => {
  if (!isNum(v)) return '';
  const a = Math.abs(v);
  const n = a >= 100 ? fc(v) : a >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
  return `${n}${unit ? (unit === '°' || unit === '%' ? unit : ` ${unit}`) : ''}`;
};

/** The distribution chart of a record (histogram with axis text, or class shares), or null. */
export function distributionModel(r: DatasetRecord): DistributionModel | null {
  const d = r.distribution;
  if (!d || !Array.isArray(d.values) || !d.values.length) return null;
  const vals = d.values.map((v) => (isNum(v) && v > 0 ? v : 0));
  if (!vals.some((v) => v > 0)) return null;
  const unit = clean(d.unit);
  const caption = isNum(d.count) && d.count > 0 ? `Share of ${plural(d.count, 'cell')}` : 'Share of the cells';
  if (d.kind === 'categorical') {
    const bars = vals
      .map((share, i) => ({ share, height: 0, label: clean(d.labels?.[i]) || `Class ${i + 1}`, ...(d.colours?.[i] ? { colour: d.colours[i] } : {}) }))
      .filter((b) => b.share > 0)
      .sort((a, b) => b.share - a.share);
    const max = bars[0]?.share ?? 0;
    for (const b of bars) b.height = max > 0 ? b.share / max : 0;
    return { kind: 'categorical', title: clean(d.title) || 'Classes', bars, axis: null, caption, label: `${clean(d.title) || 'Classes'}: ${bars.map((b) => `${b.label} ${formatPercent(b.share)}`).join(', ')}` };
  }
  const max = Math.max(...vals);
  const edges = d.edges && d.edges.length === vals.length + 1 ? d.edges : null;
  const bars = vals.map((share, i) => ({
    share,
    height: max > 0 ? share / max : 0,
    label: edges ? `${edge(edges[i]!, unit)} to ${edge(edges[i + 1]!, unit)}: ${formatPercent(share)}` : clean(d.labels?.[i]) || formatPercent(share),
  }));
  const axis = edges ? { lo: edge(edges[0]!, unit), hi: edge(edges[edges.length - 1]!, unit) } : null;
  return { kind: 'histogram', title: clean(d.title) || 'Distribution', bars, axis, caption, label: `${clean(d.title) || 'Distribution'}${axis ? ` from ${axis.lo} to ${axis.hi}` : ''}: ${bars.map((b) => b.label).join('; ')}` };
}

export const EVIDENCE_INFO: Readonly<Record<EvidenceLevel, { tone: 'ok' | 'neutral' | 'watch'; gloss: string }>> = Object.freeze({
  measured: { tone: 'ok', gloss: 'Read from a survey, a sensor or an official record.' },
  modelled: { tone: 'neutral', gloss: 'Worked out by a model from measurements (a forecast, a map predicted from photos).' },
  calibrated: { tone: 'neutral', gloss: 'A model tuned to match published observations.' },
  assumed: { tone: 'watch', gloss: 'A typical value used because nothing was measured here.' },
  synthetic: { tone: 'watch', gloss: 'Made up by the app to stand in for missing data.' },
});

/** How far to trust it: the level, its word, gloss, the record's own note and the spec reference. */
export function evidenceModel(r: DatasetRecord): { level: EvidenceLevel; title: string; tone: 'ok' | 'neutral' | 'watch'; gloss: string; note: string; specRef: string } | null {
  const e = r.evidence;
  if (!e || !(e.level in EVIDENCE_TITLES)) return null;
  return { level: e.level, title: EVIDENCE_TITLES[e.level], tone: EVIDENCE_INFO[e.level].tone, gloss: EVIDENCE_INFO[e.level].gloss, note: clean(e.note), specRef: clean(e.specRef) };
}

/** Breakdown lines (files, tile sources, parts of a shared file). */
export function partFacts(r: DatasetRecord): { label: string; value: string; note: string }[] {
  return (r.parts ?? [])
    .map((p) => ({
      label: clean(p.label),
      value: [isNum(p.bytes) ? formatBytes(p.bytes) : '', isNum(p.count) && p.count > 0 ? plural(p.count, 'item') : '', p.origin ? (originChipOf({ ...r, origin: p.origin })?.label ?? '') : ''].filter(Boolean).join(' · '),
      note: clean(p.note),
    }))
    .filter((p) => p.label);
}

// ─────────────────────────────────────────────────────────────────────────────
// "Show on map"
// ─────────────────────────────────────────────────────────────────────────────

export interface ShowTarget {
  kind: 'scene' | 'heat';
  /** Button text. */
  label: string;
  /** What the map will show ("Roads and tracks", "Distance to a road"). */
  layerTitle: string;
  target: { overlay?: OverlayKind; sceneKey?: keyof LayerState };
  ok: boolean;
  /** Why it cannot be shown now (the layer catalog's words). */
  reason: string;
}

/**
 * The map layers a record can be shown on: its scene layer (roads, homes, the aerial photo, wind) and / or its heat map
 * (ground height, fuel type, distance to a road ...), with the layer catalog's availability for this scenario.
 */
export function showTargets(r: DatasetRecord, ctx?: AvailabilityContext | null): ShowTarget[] {
  const link = r.layer;
  if (!link || r.status === 'unavailable' || r.status === 'skipped') return [];
  const info = link.layerId ? layerById(link.layerId) : undefined;
  const out: ShowTarget[] = [];
  const avail = (l: ReturnType<typeof layerById>): { ok: boolean; reason: string } => {
    if (!l || !ctx) return { ok: true, reason: '' };
    const a = l.available(ctx);
    return { ok: a.ok, reason: clean(a.reason) };
  };
  if (info?.scene) out.push({ kind: 'scene', label: 'Show on map', layerTitle: info.title, target: { sceneKey: info.scene }, ...avail(info) });
  const overlay = (link.overlay ?? info?.heat?.overlay) as OverlayKind | undefined;
  if (overlay && overlay !== 'none') {
    const heat = layerForOverlay(overlay) ?? info;
    const title = heat?.title ?? overlay;
    out.push({ kind: 'heat', label: out.length ? 'Show as heat map' : 'Show on map', layerTitle: title, target: { overlay }, ...avail(heat) });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Working memory (DS4)
// ─────────────────────────────────────────────────────────────────────────────

export const WHERE_INFO: Readonly<Record<MemoryWhere, { title: string; gloss: string; colour: BarColour }>> = Object.freeze({
  main: { title: 'Screen side', gloss: 'The part of the app that draws the screen and keeps the time-scrubber history.', colour: 's1' },
  worker: { title: 'Simulation worker', gloss: 'The simulation runs beside the screen (a web worker) so the screen stays smooth; it keeps its own copy of the grids.', colour: 's3' },
  gpu: { title: 'Graphics memory (estimate)', gloss: 'Textures and 3-D shapes on the graphics chip; phones do not report this, so it is estimated.', colour: 's5' },
});

export interface MemoryGroup {
  where: MemoryWhere;
  title: string;
  gloss: string;
  bytes: number;
  text: string;
  colour: BarColour;
  items: { id: string; label: string; bytes: number; text: string; formula: string; note: string; fraction: number }[];
}

/** The working memory by where it lives (screen, worker, graphics), items largest first, with bars relative to the largest item. */
export function memoryGroups(wm: WorkingMemory | null | undefined): { total: string; totalBytes: number; groups: MemoryGroup[]; notes: string[] } {
  if (!wm || !Array.isArray(wm.items)) return { total: formatBytes(0), totalBytes: 0, groups: [], notes: [] };
  const max = wm.items.reduce((m, x) => Math.max(m, isNum(x.bytes) ? x.bytes : 0), 0);
  const groups: MemoryGroup[] = (['main', 'worker', 'gpu'] as MemoryWhere[])
    .map((w) => {
      const items = wm.items
        .filter((x) => x.where === w && isNum(x.bytes))
        .sort((a, b) => b.bytes - a.bytes)
        .map((x) => ({ id: x.id, label: clean(x.label), bytes: x.bytes, text: formatBytes(x.bytes), formula: clean(x.formula), note: clean(x.note), fraction: max > 0 ? x.bytes / max : 0 }));
      const bytes = items.reduce((a, x) => a + x.bytes, 0);
      return { where: w, ...WHERE_INFO[w], bytes, text: formatBytes(bytes), items };
    })
    .filter((g) => g.items.length > 0);
  const totalBytes = isNum(wm.totalBytes) ? wm.totalBytes : groups.reduce((a, g) => a + g.bytes, 0);
  return { total: formatBytes(totalBytes), totalBytes, groups, notes: (wm.notes ?? []).map(clean).filter(Boolean) };
}

// ─────────────────────────────────────────────────────────────────────────────
// On this phone (DS4): the storage report
// ─────────────────────────────────────────────────────────────────────────────

export interface StorageModel {
  /** '4.8 MB bundled with the app · 3.3 MB of stored copies · 1 saved area (12.0 MB)' */
  headline: string;
  bundled: { total: string; available: boolean; sites: { id: string; name: string; size: string; bytes: number; captured: string; fraction: number }[]; replays: string };
  caches: { kind: string; title: string; what: string; size: string; bytes: number; entries: string; dates: string; places: string; fraction: number }[];
  packs: { id: string; name: string; size: string; bytes: number; created: string; items: string; area: string; fraction: number }[];
  /** The browser's own estimate of what the app's storage uses, against what it may use. */
  quota: { text: string; fraction: number; tone: 'ok' | 'watch' | 'danger' } | null;
  warnings: string[];
  notes: string[];
}

/** The storage report (data/storage.ts) as rows with sizes, dates and bars relative to the largest item. */
export function storageModel(rep: StorageReport, tz = 'Australia/Sydney'): StorageModel {
  const max = Math.max(1, ...rep.bundled.sites.map((s) => s.bytes), ...rep.caches.map((c) => c.bytes), ...rep.packs.map((p) => p.bytes));
  const frac = (b: number): number => (isNum(b) && b > 0 ? Math.min(1, b / max) : 0);
  const head: string[] = [];
  if (rep.bundled.available) head.push(`${formatBytes(rep.bundled.totalBytes)} bundled with the app`);
  head.push(rep.cacheBytes > 0 ? `${formatBytes(rep.cacheBytes)} of stored copies` : 'no stored copies');
  head.push(rep.packs.length ? `${plural(rep.packs.length, 'saved area')} (${formatBytes(rep.packBytes)})` : 'no saved areas');
  const caches = rep.caches.map((c) => {
    const d: string[] = [];
    if (isNum(c.oldest) && isNum(c.newest) && c.oldest > 0) d.push(formatDay(c.oldest, tz) === formatDay(c.newest, tz) ? `stored ${formatDay(c.newest, tz)}` : `stored ${formatDay(c.oldest, tz)} to ${formatDay(c.newest, tz)}`);
    const places = c.places.slice(0, 3).map((p) => `${clean(p.label)} (${formatBytes(p.bytes)})`).join('; ');
    return {
      kind: c.kind,
      title: clean(c.title),
      what: clean(c.what),
      size: formatBytes(c.bytes),
      bytes: c.bytes,
      entries: plural(c.entries, 'item'),
      dates: d.join(''),
      places: places ? `${c.places.length === 1 ? 'Place' : 'Places'}: ${places}${c.places.length > 3 ? `; and ${plural(c.places.length - 3, 'other place')}` : ''}` : '',
      fraction: frac(c.bytes),
    };
  });
  const packs = rep.packs.map((p) => ({
    id: p.id,
    name: clean(p.name) || 'Saved area',
    size: formatBytes(p.bytes),
    bytes: p.bytes,
    created: formatDay(p.createdAt, tz),
    items: plural(p.items.length, 'item'),
    area: isNum(p.extentM) && p.extentM > 0 ? `${formatMetres(p.extentM)} square around ${Math.abs(p.centre.lat).toFixed(3)}° S, ${p.centre.lon.toFixed(3)}° E` : '',
    fraction: frac(p.bytes),
  }));
  let quota: StorageModel['quota'] = null;
  const est = rep.browserEstimate;
  if (est && isNum(est.usageBytes) && isNum(est.quotaBytes) && est.quotaBytes > 0) {
    const f = Math.max(0, Math.min(1, est.usageBytes / est.quotaBytes));
    quota = { text: `${formatBytes(est.usageBytes)} of ${formatBytes(est.quotaBytes)} (${formatPercent(f)})`, fraction: f, tone: f > 0.9 ? 'danger' : f > 0.7 ? 'watch' : 'ok' };
  }
  return {
    headline: head.join(' · '),
    bundled: {
      total: formatBytes(rep.bundled.totalBytes),
      available: rep.bundled.available,
      sites: rep.bundled.sites.map((s) => ({ id: s.id, name: clean(s.name) || s.id, size: formatBytes(s.bytes), bytes: s.bytes, captured: formatIsoDay(s.capturedOn) || clean(s.capturedOn), fraction: frac(s.bytes) })),
      replays: rep.bundled.replaysBytes > 0 ? formatBytes(rep.bundled.replaysBytes) : '',
    },
    caches,
    packs,
    quota,
    warnings: rep.warnings.map(clean).filter(Boolean),
    notes: rep.notes.map(clean).filter(Boolean),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// "How to read this" (DS6)
// ─────────────────────────────────────────────────────────────────────────────

export interface GlossaryEntry {
  term: string;
  text: string;
}

/** The plain-English key to the screen's words. `cellM` is the model's fire-grid cell size when a model exists. */
export function glossary(cellM?: number): { origins: GlossaryEntry[]; evidence: GlossaryEntry[]; resolution: GlossaryEntry[]; sizes: GlossaryEntry[] } {
  const cell = isNum(cellM) && cellM > 0 ? formatMetres(cellM) : '';
  return {
    origins: ORIGIN_CLASS_ORDER.map((c) => ({ term: ORIGIN_CLASS_INFO[c].label, text: ORIGIN_CLASS_INFO[c].gloss })),
    evidence: (Object.keys(EVIDENCE_INFO) as EvidenceLevel[]).map((l) => ({ term: EVIDENCE_TITLES[l], text: EVIDENCE_INFO[l].gloss })),
    resolution: [
      { term: 'As published (native)', text: 'How fine the data are as the provider publishes them: "5 m" means one value every 5 metres.' },
      {
        term: 'In the model',
        text: `How fine they are inside the simulation${cell ? ` (the fire grid here is ${cell})` : ''}: finer data are averaged into each cell, coarser data are spread out, and shapes such as vegetation areas are turned into cells.`,
      },
      { term: 'Cell', text: 'One square of the model grid. Every cell holds one value of each kind: height, fuel, time since fire and so on.' },
    ],
    sizes: [
      { term: 'Downloaded', text: 'What came over the network while the model was built. Services compress their answers, so it is often smaller than the data once unpacked.' },
      { term: 'Up to', text: 'The phone did not report the compressed size, so the unpacked size is shown: the real download was that much or less.' },
      { term: '≈ (estimate)', text: 'A planned size, worked out before anything is downloaded; the basis is shown with each data set.' },
      { term: 'In memory', text: 'What the data take while the app runs, unpacked into grids. The screen and the simulation worker each keep a copy, so it is often bigger than the download.' },
      { term: 'Saved on this phone', text: 'What the app keeps for next time (stored copies and saved areas), so a place can be run again with no signal.' },
    ],
  };
}

export { ORIGIN_TITLES, ROLE_TITLES, STATUS_TITLES };
