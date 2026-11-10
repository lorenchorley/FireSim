/**
 * What a page that a desktop host serves keeps in memory so that "Continue on this device" still works when the host is gone (0.9.0,
 * workstream P, fallback gaps of plan 23.4). A page the host serves can fetch nothing from it once it has died, and the app's own engine and
 * a demo site's files are among what the page fetches from it. Two things are kept here, both pure and given their network by the caller:
 *   - `keepScript`: a Web Worker's script (the simulation's engine, the speed test's) as a Blob, made into an address a new Worker can start from.
 *     A fresh engine made after the host died (the retry after a failed spare engine) is started from it instead of from the host.
 *   - `keepSiteFiles`: the files of ONE bundled demo site (`demo/<id>/...`: terrain tiles, canopy, context layers, the manifest), read when
 *     Desktop is chosen and used as the asset loader's first source (`keptLoader`), so a build after the host died at the start still has its data.
 *     One site at a time and at most {@link KEEP_LIMIT_BYTES}: the largest bundled site is 4.3 MB.
 * Nothing here is fetched while This device runs a page that is not a host's (the app, `vite preview`): its files are its own.
 */
import type { AssetLoader } from '../data/assets';

/** The most bytes of demo files kept (the largest of the ten bundled sites is 4.3 MB, with its terrain tiles). */
export const KEEP_LIMIT_BYTES = 8 * 1024 * 1024;
/** The most bytes of a worker script kept (the engine's is 0.5 MB; a script of another size is not the one meant). */
export const SCRIPT_LIMIT_BYTES = 2 * 1024 * 1024;

/** The files every bundled site has, beside its terrain tiles (public/demo/<id>/). */
export const SITE_FILES = ['manifest.json', 'canopy.json', 'canopy.png', 'context.json', 'dem5m.json', 'dem5m.png', 'imagery.json', 'imagery.jpg', 'fire-history.geojson', 'vegetation.geojson'] as const;
/** The bundle's size ledger, shared by all sites (Setup's data plan reads it). */
export const BUNDLE_FILE = 'demo/provenance.json';

export interface KeptScript {
  /** A `blob:` address a Worker can be started from. */
  url: string;
  bytes: number;
}

export interface ScriptDeps {
  fetchFn: typeof fetch;
  makeUrl(blob: Blob): string;
}

/** A worker script read into memory, or null when it could not be (no answer, not a script, too big). Never throws. */
export async function keepScript(src: string, deps: ScriptDeps, limit = SCRIPT_LIMIT_BYTES): Promise<KeptScript | null> {
  try {
    const res = await deps.fetchFn(src, { cache: 'force-cache' });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (type.includes('text/html')) return null; // a single-page server answers a missing file with the page itself
    const blob = new Blob([await res.arrayBuffer()], { type: 'text/javascript' });
    if (blob.size === 0 || blob.size > limit) return null;
    return { url: deps.makeUrl(blob), bytes: blob.size };
  } catch {
    return null;
  }
}

/**
 * The page's worker scripts, kept once (the first call of `keep`; later calls give the same promise). `url(name)` is the kept script's address
 * once it has been read, else undefined, and then a worker starts from the script's own address as it always did.
 */
export class ScriptKeeper<Name extends string> {
  private readonly kept = new Map<Name, KeptScript>();
  private started: Promise<void> | null = null;

  constructor(
    private readonly deps: ScriptDeps,
    private readonly sources: Record<Name, string>,
  ) {}

  keep(): Promise<void> {
    this.started ??= Promise.all((Object.keys(this.sources) as Name[]).map(async (name) => void (await keepScript(this.sources[name], this.deps).then((k) => k && this.kept.set(name, k))))).then(() => undefined);
    return this.started;
  }

  url(name: Name): string | undefined {
    return this.kept.get(name)?.url;
  }

  /** What is kept, in bytes. */
  bytes(): number {
    let n = 0;
    for (const k of this.kept.values()) n += k.bytes;
    return n;
  }
}

export interface KeptSite {
  site: string;
  files: Map<string, Uint8Array>;
  bytes: number;
  /** Every file wanted was read, within the limit. */
  complete: boolean;
}

/** The terrain tiles a site's manifest lists, as bundled paths (`demo/<id>/terrarium/z/x/y.png`), or [] for a manifest that is not one. */
export function tilePaths(site: string, manifest: unknown): string[] {
  const m = manifest as { zoom?: unknown; tiles?: unknown } | null;
  if (!m || typeof m.zoom !== 'number' || !Array.isArray(m.tiles)) return [];
  const out: string[] = [];
  for (const t of m.tiles) if (Array.isArray(t) && Number.isInteger(t[0]) && Number.isInteger(t[1])) out.push(`demo/${site}/terrarium/${m.zoom}/${t[0]}/${t[1]}.png`);
  return out;
}

/** Read one site's files with `load` (the asset loader's own network read). A file that is missing is left out; the limit stops the reading, and `complete` says so. */
export async function keepSiteFiles(site: string, load: AssetLoader, limit = KEEP_LIMIT_BYTES, signal?: AbortSignal): Promise<KeptSite> {
  const kept: KeptSite = { site, files: new Map(), bytes: 0, complete: true };
  const take = async (path: string): Promise<Uint8Array | null> => {
    if (signal?.aborted) {
      kept.complete = false;
      return null;
    }
    const bytes = await load(path, signal).catch(() => null);
    if (!bytes) return null;
    if (kept.bytes + bytes.byteLength > limit) {
      kept.complete = false;
      return null;
    }
    kept.files.set(path, bytes);
    kept.bytes += bytes.byteLength;
    return bytes;
  };
  const manifest = await take(`demo/${site}/manifest.json`);
  let tiles: string[] = [];
  if (manifest) {
    try {
      tiles = tilePaths(site, JSON.parse(new TextDecoder().decode(manifest)));
    } catch {
      tiles = [];
    }
  }
  const paths = [...SITE_FILES.filter((f) => f !== 'manifest.json').map((f) => `demo/${site}/${f}`), ...tiles, BUNDLE_FILE];
  // Four at a time: a LAN host answers fast, and the page is idle meanwhile.
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < paths.length) await take(paths[next++]!);
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return kept;
}

/** The asset loader that reads the kept files first and `fallback` (the loader's own network read) for everything else. */
export function keptLoader(kept: KeptSite | null, fallback: AssetLoader): AssetLoader {
  if (!kept) return fallback;
  return async (path, signal) => kept.files.get(path.replace(/^\/+/, '')) ?? fallback(path, signal);
}
