/**
 * The compact "Data used" card of the Stats tab: how many data sets built this scenario, how many bytes came from where,
 * which origins the map cells come from and which data sets were substitutes. Every number is read from the scenario's
 * inventory (ScenarioData.datasets / datasetSummary, core/datasets.ts). Pure and unit-tested; sheet.ts draws it with the
 * data primitives and the card opens the Data sets screen.
 */
import { formatBytes, formatPercent, ORIGIN_TITLES, ROLE_ORDER, type DatasetOrigin, type DatasetRecord, type DatasetSummary } from '../../../core/datasets';
import type { BarColour } from '../../primitives';

export interface OriginShare {
  origin: DatasetOrigin;
  /** Share of the map cells (0-1). */
  share: number;
  label: string;
  /** "42 %". */
  percent: string;
  colour: BarColour;
}

export interface DataRow {
  id: string;
  title: string;
  /** Where it came from, in words ("Bundled with the app"). */
  origin: string;
  /** Bytes obtained for this build ("1.2 MB"). */
  size: string;
  bytes: number;
  substitute: boolean;
}

export interface DataUsed {
  count: number;
  /** Bytes that crossed the network, in words; an honest upper bound ("up to 3.1 MB") when the wire size was not reported. */
  download: string;
  /** What the download figure means. */
  downloadNote: string;
  /** Bytes read from the app's bundled files, stored copies and area packs. */
  local: string;
  /** Typed-array memory of the data while the app runs ('' when not measured). */
  memory: string;
  origins: OriginShare[];
  fallbacks: { id: string; title: string; reason: string }[];
  /** The largest data sets first (at most `top`). */
  rows: DataRow[];
}

/** Colour of each origin in the origin-mix bar (data colours: never the interactive blue). */
export const ORIGIN_BAR: Readonly<Record<DatasetOrigin, BarColour>> = {
  live: 'ok',
  cache: 's4',
  'area-pack': 's1',
  bundled: 's3',
  synthetic: 'watch',
  preset: 'watch',
  user: 's2',
  derived: 'neutral',
  none: 'danger',
};

const SUBSTITUTE = new Set(['fallback', 'unavailable', 'partial']);

/** Summarise an inventory for the Stats card; null when the scenario carries none (older builds, tests). */
export function dataUsed(datasets: readonly DatasetRecord[] | undefined, summary: DatasetSummary | undefined, o: { top?: number } = {}): DataUsed | null {
  if (!datasets?.length) return null;
  const t = summary?.totals;
  let network = 0;
  let unmeasured = 0;
  let transferred = 0;
  let memory = 0;
  for (const r of datasets) {
    network += r.sizes.networkBytes;
    unmeasured += r.sizes.networkUnmeasuredBytes ?? 0;
    transferred += r.sizes.transferredBytes;
    memory += r.sizes.memoryBytes ?? 0;
  }
  // The summary is the authority when it exists (it is what the Data sets screen shows).
  if (t) {
    network = t.networkBytes;
    unmeasured = t.networkUnmeasuredBytes ?? 0;
    transferred = t.transferredBytes;
    memory = t.memoryBytes;
  }
  const download = network <= 0 ? 'None' : unmeasured > 0 ? `up to ${formatBytes(network)}` : formatBytes(network);
  const downloadNote =
    network <= 0
      ? 'Nothing was downloaded: every data set came with the app or from this device.'
      : unmeasured > 0
        ? 'Downloaded for this build. Some answers came compressed without a reported size, so their uncompressed size is counted: the real download was this much or less.'
        : 'Downloaded for this build, as measured on the network.';
  const shares = t?.cellShareByOrigin ?? {};
  const origins: OriginShare[] = (Object.keys(shares) as DatasetOrigin[])
    .filter((k) => (shares[k] ?? 0) > 0)
    .sort((a, b) => (shares[b] ?? 0) - (shares[a] ?? 0))
    .map((k) => ({ origin: k, share: shares[k]!, label: ORIGIN_TITLES[k], percent: formatPercent(shares[k]!), colour: ORIGIN_BAR[k] }));
  const fallbacks = (summary?.fallbacks ?? datasets.filter((r) => SUBSTITUTE.has(r.status)).map((r) => ({ id: r.id, title: r.title, reason: r.fallbackReason ?? '' }))).map((f) => ({ id: f.id, title: f.title, reason: f.reason }));
  const order = (r: DatasetRecord): number => {
    const i = ROLE_ORDER.indexOf(r.role);
    return i < 0 ? ROLE_ORDER.length : i;
  };
  const rows: DataRow[] = datasets
    .filter((r) => r.role !== 'bundle' && r.role !== 'pack')
    .map((r) => ({ r, bytes: r.sizes.transferredBytes }))
    .sort((a, b) => b.bytes - a.bytes || order(a.r) - order(b.r))
    .slice(0, Math.max(0, o.top ?? 5))
    .map(({ r, bytes }) => ({ id: r.id, title: r.title, origin: ORIGIN_TITLES[r.origin], size: formatBytes(bytes), bytes, substitute: SUBSTITUTE.has(r.status) }));
  return {
    count: t?.count ?? datasets.length,
    download,
    downloadNote,
    local: formatBytes(Math.max(0, transferred - network)),
    memory: memory > 0 ? formatBytes(memory) : '',
    origins,
    fallbacks,
    rows,
  };
}
