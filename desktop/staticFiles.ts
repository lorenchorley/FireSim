/**
 * Static serving of the built app (`dist/`) by the desktop host (contract 0.8.0 J, 3.2). Path-traversal safe: the URL path
 * is decoded once, refused when it holds `..`, a backslash or a NUL, joined under the root, and the real path (symbolic links
 * followed) must still be inside the real root. No directory listing, no dot files, the right content types, and
 * `Cache-Control: no-store` for index.html (the page that carries the build's file names).
 */
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream';

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.bin': 'application/octet-stream',
};

export function contentType(file: string): string {
  return TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
}

export type Resolved = { ok: true; file: string; size: number; mtimeMs: number } | { ok: false; status: 400 | 404 };

/** The file a URL path names under `root`, or why not. `urlPath` is the path of the request URL (no query), still percent-encoded. */
export async function resolveStatic(root: string, urlPath: string): Promise<Resolved> {
  if (!urlPath.startsWith('/')) return { ok: false, status: 400 };
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return { ok: false, status: 400 };
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return { ok: false, status: 400 };
  const segments = decoded.split('/').filter((s) => s !== '' && s !== '.');
  if (segments.includes('..')) return { ok: false, status: 400 };
  if (segments.some((s) => s.startsWith('.'))) return { ok: false, status: 404 };
  try {
    const realRoot = await realpath(root);
    let candidate = resolve(join(realRoot, ...segments));
    if (candidate !== realRoot && !candidate.startsWith(realRoot + sep)) return { ok: false, status: 400 };
    candidate = await realpath(candidate);
    if (candidate !== realRoot && !candidate.startsWith(realRoot + sep)) return { ok: false, status: 404 }; // a link that leads out
    let s = await stat(candidate);
    if (s.isDirectory()) {
      candidate = await realpath(join(candidate, 'index.html'));
      if (!candidate.startsWith(realRoot + sep)) return { ok: false, status: 404 };
      s = await stat(candidate);
    }
    return s.isFile() ? { ok: true, file: candidate, size: s.size, mtimeMs: s.mtimeMs } : { ok: false, status: 404 };
  } catch {
    return { ok: false, status: 404 };
  }
}

const SECURITY_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } as const;

function plain(res: ServerResponse, status: number, text: string, extra: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...extra });
  res.end(text);
}

/** Answer a GET or HEAD for a file of the app. */
export async function serveStatic(root: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return plain(res, 405, 'Method not allowed\n', { Allow: 'GET, HEAD' });
  let pathname: string;
  try {
    pathname = new URL(req.url ?? '/', 'http://host').pathname;
  } catch {
    return plain(res, 400, 'Bad request\n');
  }
  const r = await resolveStatic(root, pathname);
  if (!r.ok) return plain(res, r.status, r.status === 400 ? 'Bad request\n' : 'Not found\n');
  const isIndex = r.file.endsWith(`${sep}index.html`) && resolve(r.file, '..') === (await realpath(root));
  const etag = `W/"${r.size.toString(16)}-${Math.floor(r.mtimeMs).toString(16)}"`;
  const headers: Record<string, string> = {
    'Content-Type': contentType(r.file),
    // index.html names this build's files: never from a cache. Build output under assets/ is named by its hash; the rest revalidates.
    'Cache-Control': isIndex ? 'no-store' : pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    ...SECURITY_HEADERS,
  };
  if (!isIndex) headers.ETag = etag;
  if (!isIndex && req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  headers['Content-Length'] = String(r.size);
  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  pipeline(createReadStream(r.file), res, () => undefined);
}
