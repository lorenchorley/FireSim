/**
 * The bundled-data manifest `public/demo/provenance.json` (written by scripts/build-demo-provenance.mjs): the byte
 * length and capture date of every file shipped with the app (demo sites, replays). Read by the data-set records
 * (imagery and bundle sizes), the Setup estimates and the storage report; nothing else needs it. Missing or malformed
 * -> null, and every reader then leaves the numbers out instead of inventing them.
 */
import { loadAssetJson } from './assets';

export interface BundleFile {
  bytes: number;
  /** ISO date the file was fetched from the provider. */
  capturedOn?: string;
  /** Terrarium folder: number of tiles. */
  count?: number;
  /** GeoJSON files: features (polygons). */
  features?: number;
  /** Fire history: newest VerDate (epoch ms) in the file. */
  verDate?: number;
  roads?: number;
  fireTrails?: number;
  zones?: number;
  homes?: number;
  places?: number;
}

export interface BundleSite {
  totalBytes: number;
  files: Record<string, BundleFile>;
}

export interface BundleManifest {
  version: 1;
  sites: Record<string, BundleSite>;
  replays: { totalBytes: number; files: Record<string, BundleFile> };
  totalBytes: number;
}

let memo: Promise<BundleManifest | null> | null = null;

const valid = (m: unknown): m is BundleManifest => {
  const x = m as Partial<BundleManifest> | null;
  return !!x && x.version === 1 && typeof x.sites === 'object' && x.sites !== null && typeof x.replays === 'object' && x.replays !== null;
};

/** The manifest (memoised), or null when the app carries none. Never throws. */
export function loadBundleManifest(signal?: AbortSignal): Promise<BundleManifest | null> {
  if (!memo) {
    memo = loadAssetJson<BundleManifest>('demo/provenance.json', signal)
      .then((m) => (valid(m) ? m : null))
      .catch(() => null);
    memo.then((m) => m ?? (memo = null)).catch(() => (memo = null)); // do not remember a failure
  }
  return memo;
}

/** Forget the memoised manifest (tests). */
export function clearBundleManifestCache(): void {
  memo = null;
}

/** One file of a site, or undefined. */
export const bundleFile = (m: BundleManifest | null | undefined, siteId: string, name: string): BundleFile | undefined => m?.sites[siteId]?.files[name];
