/**
 * Loader for files bundled with the app under `public/` (demo terrain tiles, canopy rasters, manifests).
 *
 * - Browser / WebView / Worker: fetched relative to the app's base URL (`demo/katoomba/manifest.json`). The base is
 *   the document's base URI on the main thread; in a Web Worker bundled under `/assets/` it is the parent of that
 *   folder, and under the Vite dev server (worker served from `/src/…`) the server root. Override with
 *   {@link setAssetBase} (the main thread can pass `document.baseURI` to its workers).
 * - Node (Vitest, scripts): read from the repository's `public/` directory with `node:fs`.
 * - Anything else (tests, a Capacitor Filesystem-backed store): install a custom loader with {@link setAssetLoader}.
 *
 * A loader resolves to `null` when the asset does not exist, so callers can fall back to cache / network.
 */

/** Resolves the bytes of a bundled asset (path relative to `public/`, no leading slash), or null if absent. */
export type AssetLoader = (path: string, signal?: AbortSignal) => Promise<Uint8Array | null>;

let customLoader: AssetLoader | null = null;
let assetBase: string | null = null;

/** Install a custom asset loader (null restores the default for the current platform). */
export function setAssetLoader(loader: AssetLoader | null): void {
  customLoader = loader;
}

/** Set the base URL bundled assets are fetched from in browsers (e.g. `document.baseURI`, or 'https://host/app/'). */
export function setAssetBase(base: string | null): void {
  assetBase = base;
}

/** Load a bundled asset's bytes, or null if it does not exist. Never throws for a missing asset. */
export async function loadAsset(path: string, signal?: AbortSignal): Promise<Uint8Array | null> {
  const p = path.replace(/^\/+/, '');
  return (customLoader ?? defaultLoader())(p, signal);
}

/** Load and parse a bundled JSON asset, or null if absent / invalid. */
export async function loadAssetJson<T>(path: string, signal?: AbortSignal): Promise<T | null> {
  const bytes = await loadAsset(path, signal);
  if (!bytes) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null; // e.g. an SPA dev server answering a missing file with index.html
  }
}

function isNode(): boolean {
  const g = globalThis as { process?: { versions?: { node?: string } }; window?: unknown; WorkerGlobalScope?: unknown };
  return !!g.process?.versions?.node && typeof g.window === 'undefined' && typeof g.WorkerGlobalScope === 'undefined';
}

function defaultLoader(): AssetLoader {
  return isNode() ? nodeLoader : browserLoader;
}

// ---- Browser ----

/** Base URL for bundled assets in a browser context. */
export function resolveAssetBase(): string {
  if (assetBase) return assetBase.endsWith('/') ? assetBase : assetBase + '/';
  const g = globalThis as { document?: { baseURI?: string }; location?: { href: string } };
  if (g.document?.baseURI) return g.document.baseURI;
  const href = g.location?.href;
  if (href) {
    // A built Vite worker lives at <base>/assets/<name>.js: the app root is the parent of /assets/.
    const i = href.lastIndexOf('/assets/');
    if (i >= 0) return href.slice(0, i + 1);
    // Under the Vite dev server a worker is served from its source path (<root>/src/sim/worker.ts?worker_file…,
    // or /@fs/… / /node_modules/… for dependencies) while public/ is served at the root.
    for (const marker of ['/src/', '/@fs/', '/@id/', '/node_modules/']) {
      const d = href.indexOf(marker);
      if (d >= 0) return href.slice(0, d + 1);
    }
    return new URL('./', href).href;
  }
  return '/';
}

const browserLoader: AssetLoader = async (path, signal) => {
  let url: string;
  try {
    url = new URL(path, resolveAssetBase()).href;
  } catch {
    url = path;
  }
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    // SPA fallbacks answer unknown paths with index.html (200): treat HTML as "missing".
    const type = res.headers.get('content-type') ?? '';
    if (type.includes('text/html') && !path.endsWith('.html')) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    if (signal?.aborted) throw e;
    return null;
  }
};

// ---- Node ----

type FsPromises = { readFile(path: string | URL): Promise<Uint8Array> };
let fsPromise: Promise<FsPromises> | null = null;
let publicDir: string | URL | null = null;

/** Directory used by the Node loader (default: the repository's `public/`). */
export function setNodePublicDir(dir: string | URL | null): void {
  publicDir = dir;
}

function nodePublicDir(): string | URL {
  if (publicDir) return publicDir;
  // src/data/assets.ts → ../../public/ ; a variable keeps bundlers from treating this as an asset import.
  const rel = '../../public/';
  try {
    if (import.meta.url.startsWith('file:')) return new URL(rel, import.meta.url);
  } catch {
    /* fall through */
  }
  const cwd = (globalThis as { process?: { cwd(): string } }).process?.cwd() ?? '.';
  return `${cwd}/public/`;
}

const nodeLoader: AssetLoader = async (path) => {
  // Specifier in a variable so bundlers for the browser never try to resolve node:fs.
  const spec = 'node:fs/promises';
  fsPromise ??= import(/* @vite-ignore */ spec) as Promise<FsPromises>;
  const fs = await fsPromise;
  const base = nodePublicDir();
  const target = typeof base === 'string' ? base.replace(/\/?$/, '/') + path : new URL(path, base);
  try {
    return new Uint8Array(await fs.readFile(target));
  } catch {
    return null;
  }
};
