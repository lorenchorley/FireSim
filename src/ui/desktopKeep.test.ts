import { describe, expect, it, vi } from 'vitest';
import type { AssetLoader } from '../data/assets';
import { BUNDLE_FILE, keepScript, keepSiteFiles, keptLoader, KEEP_LIMIT_BYTES, ScriptKeeper, SITE_FILES, tilePaths } from './desktopKeep';

const bytes = (n: number, fill = 7): Uint8Array => new Uint8Array(n).fill(fill);
const json = (v: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(v));

/** A bundled site as the app ships it: the manifest names its tiles, the other files are fixed. */
function siteFiles(site: string, sizes: { tile?: number; other?: number } = {}): Map<string, Uint8Array> {
  const m = new Map<string, Uint8Array>();
  m.set(`demo/${site}/manifest.json`, json({ id: site, zoom: 13, tiles: [[7514, 4910], [7514, 4911]] }));
  for (const f of SITE_FILES) if (f !== 'manifest.json') m.set(`demo/${site}/${f}`, bytes(sizes.other ?? 1000));
  m.set(`demo/${site}/terrarium/13/7514/4910.png`, bytes(sizes.tile ?? 5000, 1));
  m.set(`demo/${site}/terrarium/13/7514/4911.png`, bytes(sizes.tile ?? 5000, 2));
  m.set(BUNDLE_FILE, bytes(16000));
  return m;
}

const loaderOf =
  (files: Map<string, Uint8Array>, asked: string[] = []): AssetLoader =>
  async (path) => {
    asked.push(path);
    return files.get(path) ?? null;
  };

describe('keepScript: a worker script in memory', () => {
  const script = (body: BodyInit, init: ResponseInit = { headers: { 'content-type': 'text/javascript' } }) => vi.fn(async () => new Response(body, init));

  it('reads the script into a blob and hands back an address a worker can start from, with its size', async () => {
    const fetchFn = script('self.onmessage=()=>{};'.padEnd(1000, ' '));
    const made: Blob[] = [];
    const kept = await keepScript('assets/worker-abc.js', { fetchFn: fetchFn as unknown as typeof fetch, makeUrl: (b) => (made.push(b), 'blob:kept-1') });
    expect(kept).toEqual({ url: 'blob:kept-1', bytes: 1000 });
    expect(made[0]!.type).toBe('text/javascript');
    expect(fetchFn).toHaveBeenCalledWith('assets/worker-abc.js', { cache: 'force-cache' });
  });

  it('keeps nothing for an answer that is not the script: not found, a page, nothing, a script too big, a refused request', async () => {
    const deps = (f: unknown): Parameters<typeof keepScript>[1] => ({ fetchFn: f as typeof fetch, makeUrl: () => 'blob:x' });
    expect(await keepScript('a.js', deps(script('x', { status: 404 })))).toBeNull();
    expect(await keepScript('a.js', deps(script('<!doctype html>', { headers: { 'content-type': 'text/html; charset=utf-8' } })))).toBeNull();
    expect(await keepScript('a.js', deps(script('', { headers: { 'content-type': 'text/javascript' } })))).toBeNull();
    expect(await keepScript('a.js', deps(script('x'.repeat(100)), ), 50)).toBeNull();
    expect(await keepScript('a.js', deps(vi.fn(async () => Promise.reject(new TypeError('Failed to fetch')))))).toBeNull();
  });

  it('never throws, even when the blob cannot be made an address', async () => {
    const kept = await keepScript('a.js', {
      fetchFn: script('x') as unknown as typeof fetch,
      makeUrl: () => {
        throw new Error('no object URLs');
      },
    });
    expect(kept).toBeNull();
  });
});

describe('keepSiteFiles: one demo site in memory', () => {
  it('reads the manifest first, then the fixed files, the tiles the manifest names and the bundle ledger', async () => {
    const files = siteFiles('katoomba');
    const asked: string[] = [];
    const kept = await keepSiteFiles('katoomba', loaderOf(files, asked));
    expect(asked[0]).toBe('demo/katoomba/manifest.json');
    expect([...kept.files.keys()].sort()).toEqual([...files.keys()].sort());
    expect(kept.bytes).toBe([...files.values()].reduce((n, b) => n + b.byteLength, 0));
    expect(kept.complete).toBe(true);
    expect(kept.site).toBe('katoomba');
  });

  it('leaves out a file the site does not have, and the rest is kept (still complete: nothing wanted was cut by the limit)', async () => {
    const files = siteFiles('thredbo');
    files.delete('demo/thredbo/fire-history.geojson');
    const kept = await keepSiteFiles('thredbo', loaderOf(files));
    expect(kept.files.has('demo/thredbo/fire-history.geojson')).toBe(false);
    expect(kept.files.has('demo/thredbo/dem5m.png')).toBe(true);
    expect(kept.complete).toBe(true);
  });

  it('stops at the limit and says it is not complete (the loader then asks the network for the rest)', async () => {
    const files = siteFiles('grose', { tile: 40_000, other: 1000 });
    const kept = await keepSiteFiles('grose', loaderOf(files), 50_000);
    expect(kept.bytes).toBeLessThanOrEqual(50_000);
    expect(kept.complete).toBe(false);
    expect(KEEP_LIMIT_BYTES).toBe(8 * 1024 * 1024);
  });

  it('a manifest that is not JSON, or a loader that throws, keeps what it can and never throws', async () => {
    const files = siteFiles('tomah');
    files.set('demo/tomah/manifest.json', bytes(10, 120));
    const kept = await keepSiteFiles('tomah', loaderOf(files));
    expect([...kept.files.keys()].some((k) => k.includes('/terrarium/'))).toBe(false);
    const boom = await keepSiteFiles('tomah', async () => {
      throw new Error('gone');
    });
    expect(boom.files.size).toBe(0);
  });

  it('an aborted read stops and is not complete', async () => {
    const ctl = new AbortController();
    ctl.abort();
    const kept = await keepSiteFiles('gospers', loaderOf(siteFiles('gospers')), KEEP_LIMIT_BYTES, ctl.signal);
    expect(kept.files.size).toBe(0);
    expect(kept.complete).toBe(false);
  });

  it('names the tiles from the manifest only when it is one', () => {
    expect(tilePaths('a', { zoom: 13, tiles: [[1, 2], [3, 4]] })).toEqual(['demo/a/terrarium/13/1/2.png', 'demo/a/terrarium/13/3/4.png']);
    expect(tilePaths('a', { zoom: 13, tiles: [[1, 'x'], 'no', [2.5, 3]] })).toEqual([]);
    expect(tilePaths('a', null)).toEqual([]);
    expect(tilePaths('a', { tiles: [[1, 2]] })).toEqual([]);
  });
});

describe('keptLoader: the kept files first, the network for the rest', () => {
  it('serves a kept file without asking the network, and asks it for any other', async () => {
    const files = siteFiles('katoomba');
    const kept = await keepSiteFiles('katoomba', loaderOf(files));
    const asked: string[] = [];
    const fallback: AssetLoader = async (p) => (asked.push(p), bytes(3));
    const load = keptLoader(kept, fallback);
    expect((await load('demo/katoomba/canopy.png'))!.byteLength).toBe(1000);
    expect((await load('/demo/katoomba/canopy.png'))!.byteLength).toBe(1000); // a leading slash is the same path
    expect(asked).toEqual([]);
    expect((await load('demo/thredbo/canopy.png'))!.byteLength).toBe(3);
    expect(asked).toEqual(['demo/thredbo/canopy.png']);
  });

  it('with nothing kept it is the fallback itself', () => {
    const fallback: AssetLoader = async () => null;
    expect(keptLoader(null, fallback)).toBe(fallback);
  });
});

describe('ScriptKeeper: the page\'s worker scripts, kept once', () => {
  it('reads each script once, however often it is asked, and answers with the kept address; what failed has none', async () => {
    const answers: Record<string, () => Response> = {
      'assets/worker-sim.js': () => new Response('s'.repeat(400), { headers: { 'content-type': 'text/javascript' } }),
      'assets/worker-speed.js': () => new Response('missing', { status: 404 }),
    };
    const fetchFn = vi.fn(async (u: string) => answers[u]!());
    let n = 0;
    const keeper = new ScriptKeeper({ fetchFn: fetchFn as unknown as typeof fetch, makeUrl: () => `blob:kept-${++n}` }, { sim: 'assets/worker-sim.js', speed: 'assets/worker-speed.js' });
    expect(keeper.url('sim')).toBeUndefined(); // nothing is kept before it is asked
    const first = keeper.keep();
    expect(keeper.keep()).toBe(first);
    await first;
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(keeper.url('sim')).toBe('blob:kept-1');
    expect(keeper.url('speed')).toBeUndefined();
    expect(keeper.bytes()).toBe(400);
    await keeper.keep();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
