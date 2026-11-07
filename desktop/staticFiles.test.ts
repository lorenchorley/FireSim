/**
 * Static serving of the desktop host (contract 0.8.0 J, 3.2 and 5): path traversal in every form a client can send it,
 * no directory listing, content types, caching of index.html. Requests go over a real socket with the path exactly as
 * written (a URL parser would tidy a `..` away before the server saw it).
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contentType, resolveStatic, serveStatic } from './staticFiles';

let base: string;
let root: string;
let server: Server;
let port: number;
const SECRET = 'TOP-SECRET-OUTSIDE-THE-APP';

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), 'firesim-static-'));
  root = join(base, 'dist');
  mkdirSync(join(root, 'assets'), { recursive: true });
  mkdirSync(join(root, 'demo', 'katoomba'), { recursive: true });
  mkdirSync(join(root, 'empty'));
  mkdirSync(join(root, '.git'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>FireSim</title>');
  writeFileSync(join(root, 'assets', 'index-abc123.js'), 'export const x = 1;');
  writeFileSync(join(root, 'assets', 'style-abc123.css'), 'body{}');
  writeFileSync(join(root, 'demo', 'katoomba', 'manifest.json'), '{"a":1}');
  writeFileSync(join(root, 'demo', 'tile.png'), Buffer.from([0x89, 0x50]));
  writeFileSync(join(root, '.env'), 'PASSWORD=hunter2');
  writeFileSync(join(root, '.git', 'config'), 'secret');
  writeFileSync(join(base, 'secret.txt'), SECRET);
  writeFileSync(join(base, 'dist-evil.txt'), SECRET); // a sibling whose name starts with the root's
  symlinkSync(join(base, 'secret.txt'), join(root, 'link-out.txt'));
  symlinkSync(base, join(root, 'dir-out'));
  symlinkSync(join(root, 'assets', 'style-abc123.css'), join(root, 'link-in.css'));
  server = createServer((req, res) => {
    serveStatic(root, req, res).catch(() => res.destroy());
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(base, { recursive: true, force: true });
});

interface Answer {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** A request with the path exactly as given. */
function get(path: string, method = 'GET', headers: Record<string, string> = {}): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('static files', () => {
  it('serves index.html at / and by name, never from a cache', async () => {
    for (const p of ['/', '/index.html', '/?code=1', '/#x']) {
      const r = await get(p);
      expect(r.status, p).toBe(200);
      expect(r.body).toContain('<title>FireSim</title>');
      expect(r.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(r.headers['cache-control']).toBe('no-store');
      expect(r.headers['x-content-type-options']).toBe('nosniff');
      expect(r.headers.etag).toBeUndefined();
    }
  });

  it('serves the build output with its content type, and the hashed files for a year', async () => {
    const js = await get('/assets/index-abc123.js');
    expect(js.status).toBe(200);
    expect(js.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(js.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(js.headers['content-length']).toBe(String('export const x = 1;'.length));
    expect((await get('/assets/style-abc123.css')).headers['content-type']).toBe('text/css; charset=utf-8');
    const json = await get('/demo/katoomba/manifest.json');
    expect(json.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(json.headers['cache-control']).toBe('no-cache');
    expect((await get('/demo/tile.png')).headers['content-type']).toBe('image/png');
  });

  it('answers HEAD without a body and a repeat request with 304 when the file has not changed', async () => {
    const head = await get('/assets/index-abc123.js', 'HEAD');
    expect(head.status).toBe(200);
    expect(head.body).toBe('');
    expect(head.headers['content-length']).toBe('19');
    const first = await get('/demo/katoomba/manifest.json');
    const again = await get('/demo/katoomba/manifest.json', 'GET', { 'If-None-Match': first.headers.etag as string });
    expect(again.status).toBe(304);
    expect(again.body).toBe('');
  });

  it('refuses a method other than GET and HEAD', async () => {
    for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const r = await get('/index.html', m);
      expect(r.status, m).toBe(405);
      expect(r.headers.allow).toBe('GET, HEAD');
    }
  });

  it('says 404 for what is not there, and lists no directory', async () => {
    for (const p of ['/nope.js', '/assets/nope.js', '/assets', '/assets/', '/demo', '/demo/', '/empty', '/empty/', '/demo/katoomba']) {
      const r = await get(p);
      expect(r.status, p).toBe(404);
      expect(r.body, p).not.toContain('index-abc123.js');
    }
  });

  it('refuses every form of path traversal and never returns a byte from outside the app', async () => {
    const attempts = [
      '/../secret.txt',
      '/../../secret.txt',
      '/assets/../../secret.txt',
      '/assets/../../../../../../etc/passwd',
      '/%2e%2e/secret.txt',
      '/%2E%2E/secret.txt',
      '/..%2fsecret.txt',
      '/..%2Fsecret.txt',
      '/%2e%2e%2fsecret.txt',
      '/assets/..%2f..%2fsecret.txt',
      '/..%5csecret.txt',
      '/assets/..\\..\\secret.txt',
      '/%5c..%5csecret.txt',
      '/\\..\\secret.txt',
      '/assets/%00/../../secret.txt',
      '/index.html%00.png',
      '/..;/secret.txt',
      '//../secret.txt',
      '/./../secret.txt',
      '/%252e%252e/secret.txt',
      '/....//secret.txt',
      '/..%c0%afsecret.txt',
      '/%',
      '/%zz',
      '/..%00/secret.txt',
      '/../dist-evil.txt',
      '/../dist/../secret.txt',
    ];
    for (const p of attempts) {
      const r = await get(p);
      expect([400, 404], `${p} -> ${r.status}`).toContain(r.status);
      expect(r.body, p).not.toContain(SECRET);
    }
  });

  it('does not follow a link that leads out of the app, and does follow one that stays in', async () => {
    for (const p of ['/link-out.txt', '/dir-out/secret.txt', '/dir-out/dist-evil.txt']) {
      const r = await get(p);
      expect(r.status, p).toBe(404);
      expect(r.body).not.toContain(SECRET);
    }
    expect((await get('/link-in.css')).status).toBe(200);
  });

  it('does not serve dot files', async () => {
    for (const p of ['/.env', '/.git/config', '/assets/../.env', '/%2eenv', '/.git']) {
      const r = await get(p);
      expect([400, 404], p).toContain(r.status);
      expect(r.body).not.toContain('hunter2');
    }
  });

  it('keeps hostile and malformed request targets from crashing the server', async () => {
    for (const p of ['/' + 'a'.repeat(5000), '/a%', '/%E0%A4%A', '/%C3%A9', '/index.html?' + 'q'.repeat(3000)]) {
      const r = await get(p).catch(() => ({ status: 0 }));
      expect([200, 400, 404, 414, 431, 0], p).toContain(r.status);
    }
    expect((await get('/index.html')).status).toBe(200);
  });
});

describe('resolveStatic and contentType', () => {
  it('resolves the directory itself to its index.html and nothing outside the root', async () => {
    const r = await resolveStatic(root, '/');
    expect(r.ok && r.file.endsWith('index.html')).toBe(true);
    expect(await resolveStatic(root, 'index.html')).toEqual({ ok: false, status: 400 });
    expect(await resolveStatic(root, '/..')).toEqual({ ok: false, status: 400 });
  });

  it('knows the types the app is made of', () => {
    const expected: Record<string, string> = {
      'a.html': 'text/html; charset=utf-8',
      'a.JS': 'text/javascript; charset=utf-8',
      'a.mjs': 'text/javascript; charset=utf-8',
      'a.css': 'text/css; charset=utf-8',
      'a.json': 'application/json; charset=utf-8',
      'a.geojson': 'application/geo+json; charset=utf-8',
      'a.svg': 'image/svg+xml',
      'a.png': 'image/png',
      'a.jpg': 'image/jpeg',
      'a.wasm': 'application/wasm',
      'a.woff2': 'font/woff2',
      'a.unknown': 'application/octet-stream',
      noext: 'application/octet-stream',
    };
    for (const [file, type] of Object.entries(expected)) expect(contentType(file), file).toBe(type);
  });
});
