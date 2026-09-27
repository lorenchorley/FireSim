import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadAsset, loadAssetJson, resolveAssetBase, setAssetBase, setAssetLoader, setNodePublicDir } from './assets';

afterEach(() => {
  setAssetLoader(null);
  setAssetBase(null);
  setNodePublicDir(null);
  vi.unstubAllGlobals();
});

describe('asset loader', () => {
  it('reads bundled files from public/ in Node', async () => {
    const m = await loadAssetJson<{ id: string; zoom: number; tiles: number[][] }>('demo/katoomba/manifest.json');
    expect(m?.id).toBe('katoomba');
    expect(m?.zoom).toBe(13);
    expect(m?.tiles.length).toBeGreaterThan(0);
    const png = await loadAsset('/demo/katoomba/canopy.png'); // leading slash tolerated
    expect(png).toBeInstanceOf(Uint8Array);
    expect([...png!.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
  });

  it('returns null for missing or invalid assets', async () => {
    expect(await loadAsset('demo/nowhere/manifest.json')).toBeNull();
    expect(await loadAssetJson('demo/katoomba/canopy.png')).toBeNull(); // not JSON
  });

  it('accepts a custom loader', async () => {
    const seen: string[] = [];
    setAssetLoader(async (p) => (seen.push(p), p === 'x.json' ? new TextEncoder().encode('{"ok":true}') : null));
    expect(await loadAssetJson('/x.json')).toEqual({ ok: true });
    expect(await loadAsset('y.bin')).toBeNull();
    expect(seen).toEqual(['x.json', 'y.bin']);
  });

  it('can be pointed at another public directory', async () => {
    setNodePublicDir(new URL('../../public/demo/', import.meta.url));
    expect((await loadAssetJson<{ id: string }>('grose/manifest.json'))?.id).toBe('grose');
  });

  it('resolves the browser asset base (explicit, document, and Vite worker heuristic)', () => {
    setAssetBase('https://app.example/firesim');
    expect(resolveAssetBase()).toBe('https://app.example/firesim/');
    setAssetBase(null);
    vi.stubGlobal('location', { href: 'https://app.example/firesim/assets/sim.worker-abc123.js' });
    expect(resolveAssetBase()).toBe('https://app.example/firesim/');
    vi.stubGlobal('document', { baseURI: 'https://app.example/other/' });
    expect(resolveAssetBase()).toBe('https://app.example/other/');
  });
});
