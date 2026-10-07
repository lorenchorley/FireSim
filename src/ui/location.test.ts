/**
 * The result rows of Setup (what a place is: NSW or not, which bundled site has data for it) and the Paste button's clipboard read.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeFix, describePlace, readClipboardText } from './location';

afterEach(() => vi.unstubAllGlobals());

describe('describePlace', () => {
  it('Mount Tomah Botanic Garden is in NSW and inside the bundled Mount Tomah site', () => {
    const d = describePlace({ lat: -33.5447, lon: 150.4097 });
    expect(d.inNsw).toBe(true);
    expect(d.nearDemo?.id).toBe('tomah');
    expect(d.southHint).toBe(false);
  });

  it('Katoomba is covered by its own site, a place far from every site is not', () => {
    expect(describePlace({ lat: -33.715, lon: 150.285 }).nearDemo?.id).toBe('katoomba');
    expect(describePlace({ lat: -31.95, lon: 141.5 }).nearDemo).toBeNull();
  });

  it('outside NSW is said, and a latitude typed without its minus sign is spotted', () => {
    expect(describePlace({ lat: -37.81, lon: 144.96 }).inNsw).toBe(false); // Melbourne
    const north = describePlace({ lat: 33.5447, lon: 150.4097 });
    expect(north.inNsw).toBe(false);
    expect(north.southHint).toBe(true);
    expect(describePlace({ lat: 40.7, lon: -74 }).southHint).toBe(false);
  });

  it('describeFix keeps its answer for the GPS row', () => {
    const d = describeFix({ lat: -33.715, lon: 150.285 }, 80);
    expect(d).toMatchObject({ inNsw: true, poor: true });
    expect(d.nearDemo?.id).toBe('katoomba');
    expect(describeFix({ lat: -33.715, lon: 150.285 }, 10).poor).toBe(false);
  });
});

describe('readClipboardText', () => {
  it('returns the text', async () => {
    vi.stubGlobal('navigator', { clipboard: { readText: async () => 'https://maps.app.goo.gl/AbCdEf123' } });
    expect(await readClipboardText()).toEqual({ ok: true, text: 'https://maps.app.goo.gl/AbCdEf123' });
  });

  it('says so when the clipboard is empty', async () => {
    vi.stubGlobal('navigator', { clipboard: { readText: async () => '  ' } });
    expect(await readClipboardText()).toMatchObject({ ok: false, reason: 'empty' });
  });

  it('falls back to "touch and hold the box" when the phone refuses', async () => {
    vi.stubGlobal('navigator', {
      clipboard: {
        readText: async () => {
          throw new DOMException('Read permission denied.', 'NotAllowedError');
        },
      },
    });
    const r = await readClipboardText();
    expect(r).toMatchObject({ ok: false, reason: 'blocked' });
    if (!r.ok) expect(r.message).toMatch(/touch and hold the box/i);
  });

  it('falls back the same way when there is no clipboard API', async () => {
    vi.stubGlobal('navigator', {});
    expect(await readClipboardText()).toMatchObject({ ok: false, reason: 'blocked' });
    vi.stubGlobal('navigator', undefined);
    expect(await readClipboardText()).toMatchObject({ ok: false, reason: 'blocked' });
  });
});
