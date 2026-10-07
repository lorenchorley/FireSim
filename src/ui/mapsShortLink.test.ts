/**
 * Google short links: what is asked, of whom, and what comes back. The phone's native HTTP is replaced by a script of answers
 * (the real chain of a live maps.app.goo.gl link on 2026-10-07 is ONE 302 to the place address, and that is the first case).
 */
import type { HttpOptions, HttpResponse } from '@capacitor/core';
import { afterEach, describe, expect, it } from 'vitest';
import { resetHttpConfig, setHttpConfig } from '../data/http';
import { LOCATION_MESSAGES } from './mapsLink';
import { resolveMapsShortLink, SHORT_LINK_MESSAGES } from './mapsShortLink';

afterEach(() => resetHttpConfig());

const PLACE = 'https://www.google.com/maps/place/Mount+Tomah+Botanic+Garden/@-33.5400,150.4000,15z/data=!3m1!4b1!4m6!3m5!1s0x6b1292f3c1e5d9e1:0x5017d681632a3b0!8m2!3d-33.5447!4d150.4097!16s%2Fm%2F0gxk9xn?entry=tts&g_ep=EgoyMDI2MDYyOS4wIPu8ASoASAFQAw%3D%3D&skid=03fac211';
const NO_COORDS = 'https://www.google.com/maps/place/Kr%C3%B3lowa+Shoppingu,+Stawowa+61,+31-346+Krak%C3%B3w/data=!4m2!3m1!1s0x47165b0c5d6eb017:0x9558c47aa6f47982!18m1!1e1?utm_source=mstt_1&entry=gps&coh=192189';
const SHORT = 'https://maps.app.goo.gl/AbCdEf123';

type Step = Partial<HttpResponse> | Error | ((o: HttpOptions) => Promise<HttpResponse>);

/** A native plugin that answers by URL (or by call number) and records every request. */
function native(answer: (o: HttpOptions, n: number) => Step) {
  const calls: HttpOptions[] = [];
  const fn = async (o: HttpOptions): Promise<HttpResponse> => {
    calls.push(o);
    const s = answer(o, calls.length);
    if (s instanceof Error) throw s;
    if (typeof s === 'function') return s(o);
    return { status: 200, headers: {}, url: o.url, data: '', ...s } as HttpResponse;
  };
  setHttpConfig({ platform: 'native', nativeRequest: fn, retryDelayMs: 1 });
  return calls;
}

const redirect = (location: string): Partial<HttpResponse> => ({ status: 302, headers: { Location: location }, data: '' });
const html = (body: string, url?: string): Partial<HttpResponse> => ({ status: 200, headers: { 'Content-Type': 'text/html' }, data: Buffer.from(body).toString('base64'), ...(url ? { url } : {}) });

describe('resolveMapsShortLink: the answer is read from the redirect', () => {
  it('a real chain: ONE 302 to the place address, whose !3d!4d pin is the place (not the @ view)', async () => {
    const calls = native(() => redirect(PLACE));
    const r = await resolveMapsShortLink(SHORT);
    expect(r).toMatchObject({ ok: true, position: { lat: -33.5447, lon: 150.4097 }, name: 'Mount Tomah Botanic Garden', source: 'google-maps-link' });
    expect(calls).toHaveLength(1);
  });

  it('asks for the redirect only: GET, no redirect following, no headers, 15 s, nothing else', async () => {
    const calls = native(() => redirect(PLACE));
    await resolveMapsShortLink(SHORT);
    expect(calls[0]).toMatchObject({ url: SHORT, method: 'GET', disableRedirects: true, connectTimeout: 15000, readTimeout: 15000 });
    expect(calls[0]!.headers ?? {}).toEqual({});
    expect(calls[0]).not.toHaveProperty('data');
    expect(calls[0]).not.toHaveProperty('webFetchExtra');
  });

  it('a dropped pin: 302 to /maps/search/<lat>,+<lon>', async () => {
    native(() => redirect('https://www.google.com/maps/search/-33.5447,+150.4097?entry=tts&g_ep=EgoyMDI1MDEyOS4xIPu8ASoASAFQAw%3D%3D'));
    const r = await resolveMapsShortLink(SHORT);
    expect(r).toMatchObject({ ok: true, position: { lat: -33.5447, lon: 150.4097 } });
  });

  it('the name above the link (the hint) beats the name in the address', async () => {
    native(() => redirect(PLACE));
    const r = await resolveMapsShortLink('Mount Tomah lookout\nhttps://maps.app.goo.gl/AbCdEf123');
    expect(r).toMatchObject({ ok: true, name: 'Mount Tomah lookout' });
    const r2 = await resolveMapsShortLink(SHORT, { nameHint: 'The garden' });
    expect(r2).toMatchObject({ ok: true, name: 'The garden' });
  });

  it('a chain of two short links (goo.gl/maps then maps.app.goo.gl) is followed by hand', async () => {
    const calls = native((o) => (o.url.startsWith('https://goo.gl/maps/') ? redirect('https://maps.app.goo.gl/XyZ12345') : redirect(PLACE)));
    const r = await resolveMapsShortLink('https://goo.gl/maps/AbCdEf123456');
    expect(r).toMatchObject({ ok: true, position: { lat: -33.5447, lon: 150.4097 } });
    expect(calls.map((c) => c.url)).toEqual(['https://goo.gl/maps/AbCdEf123456', 'https://maps.app.goo.gl/XyZ12345']);
  });

  it("Google's consent page wrapper around the real address is unwrapped", async () => {
    native(() => redirect(`https://consent.google.com/m?continue=${encodeURIComponent(PLACE)}&gl=DE&m=0&pc=m&uxe=eomtm&cm=2&hl=de&src=1`));
    const r = await resolveMapsShortLink(SHORT);
    expect(r).toMatchObject({ ok: true, position: { lat: -33.5447, lon: 150.4097 } });
  });

  it('a route link says so', async () => {
    native(() => redirect('https://www.google.com/maps/dir/Sydney/Katoomba/@-33.7,150.5,9z'));
    const r = await resolveMapsShortLink(SHORT);
    expect(r).toMatchObject({ ok: false, reason: 'route', message: 'This link is a route. Open the place and share that.' });
  });

  it('a plain 200 whose final URL has the place (the platform followed the redirect anyway)', async () => {
    native((o) => html('<html></html>', o.url === SHORT ? PLACE : o.url));
    const r = await resolveMapsShortLink(SHORT);
    expect(r).toMatchObject({ ok: true, position: { lat: -33.5447, lon: 150.4097 } });
  });
});

describe('resolveMapsShortLink: an address with no coordinates in it', () => {
  it('reads the page (every redirect followed by hand, capped) and takes its own canonical address', async () => {
    const calls = native((o) => (o.url === SHORT ? redirect(NO_COORDS) : html('<link rel="canonical" href="https://www.google.com/maps/place/Kr%C3%B3lowa/@50.06,19.93,17z/data=!3d50.0647!4d19.945">')));
    const r = await resolveMapsShortLink(SHORT);
    expect(r).toMatchObject({ ok: true, position: { lat: 50.0647, lon: 19.945 } });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ url: NO_COORDS, method: 'GET', disableRedirects: true }); // every hop by hand: the platform never follows a redirect off Google

    expect(calls[1]!.headers ?? {}).toEqual({});
  });

  it('the page redirects to an address that has them', async () => {
    native((o) => (o.url === SHORT ? redirect(NO_COORDS) : html('', PLACE)));
    const r = await resolveMapsShortLink(SHORT);
    expect(r).toMatchObject({ ok: true, position: { lat: -33.5447, lon: 150.4097 } });
  });

  it("Google's bare app shell (what it really sends) holds no place: say so, and keep the name", async () => {
    // the og:image of the real shell: the middle of the USA at zoom 4, which must never be taken for the place
    const shell = '<meta content="https://maps.google.com/maps/api/staticmap?center=37.0625%2C-95.677068&amp;zoom=4&amp;size=900x900&amp;key=K" property="og:image"><script>APP_INITIALIZATION_STATE=[[[2.6E7,-95.677068,37.06250000000001]]]</script>';
    native((o) => (o.url === SHORT ? redirect(NO_COORDS) : html(shell)));
    const r = await resolveMapsShortLink('Królowa Shoppingu\nhttps://maps.app.goo.gl/AbCdEf123');
    expect(r).toMatchObject({ ok: false, reason: 'no-coordinates', message: LOCATION_MESSAGES.noCoordinates, name: 'Królowa Shoppingu' });
  });

  it('reads at most 512 kB of the page', async () => {
    const big = `${'x'.repeat(600 * 1024)}<link rel="canonical" href="https://www.google.com/maps/@-33.5447,150.4097,17z">`;
    native((o) => (o.url === SHORT ? redirect(NO_COORDS) : html(big)));
    const r = await resolveMapsShortLink(SHORT);
    expect(r).toMatchObject({ ok: false, reason: 'no-coordinates' });
  });
});

describe('resolveMapsShortLink: only Google is ever asked', () => {
  it('nothing but a Google short link is requested: a link elsewhere, a long Google link and plain words make no request', async () => {
    const calls = native(() => redirect(PLACE));
    for (const text of ['https://example.com/x', 'https://evil.example/maps.app.goo.gl/AbCdEf123', 'https://maps.app.goo.gl.evil.example/AbCdEf123', 'https://g.co/kgs/AbCdEf1', 'hello', '']) {
      const r = await resolveMapsShortLink(text);
      expect(r, text).toMatchObject({ ok: false, reason: 'not-short-link' });
    }
    expect(calls).toHaveLength(0);
  });

  it('a long Google link is answered from the link itself, with no request', async () => {
    const calls = native(() => redirect(PLACE));
    const r = await resolveMapsShortLink(PLACE);
    expect(r).toMatchObject({ ok: true, position: { lat: -33.5447, lon: 150.4097 } });
    expect(calls).toHaveLength(0);
  });

  it('a short link that redirects to another website is refused, and that website is never requested', async () => {
    const calls = native(() => redirect('https://evil.example/steal?x=1'));
    const r = await resolveMapsShortLink(SHORT);
    expect(r).toMatchObject({ ok: false, reason: 'refused', message: SHORT_LINK_MESSAGES.refused });
    expect(calls.map((c) => c.url)).toEqual([SHORT]);
  });

  it('a redirect to a look-alike Google host is refused', async () => {
    const calls = native(() => redirect('https://www.google.com.evil.example/maps/@-33.5447,150.4097,17z'));
    const r = await resolveMapsShortLink(SHORT);
    expect(r).toMatchObject({ ok: false, reason: 'refused' });
    expect(calls).toHaveLength(1);
  });

  it('a redirect loop ends after a few requests', async () => {
    const calls = native((o) => redirect(o.url === SHORT ? 'https://maps.app.goo.gl/Other123' : SHORT));
    const r = await resolveMapsShortLink(SHORT);
    expect(r).toMatchObject({ ok: false, reason: 'other' });
    expect(calls.length).toBeLessThanOrEqual(5);
  });

  it('a long chain stops at five requests', async () => {
    let n = 0;
    const calls = native(() => redirect(`https://maps.app.goo.gl/Hop${++n}abcdefg`));
    const r = await resolveMapsShortLink(SHORT);
    expect(r).toMatchObject({ ok: false, reason: 'other' });
    expect(calls).toHaveLength(5);
  });
});

describe('resolveMapsShortLink: when it cannot', () => {
  it('in the plain web build nothing is requested and the message says short links need the Android app', async () => {
    const calls: unknown[] = [];
    setHttpConfig({
      platform: 'browser',
      fetch: (async (...a: unknown[]) => {
        calls.push(a);
        return new Response('');
      }) as typeof fetch,
    });
    const r = await resolveMapsShortLink('Mount Tomah\nhttps://maps.app.goo.gl/AbCdEf123');
    expect(r).toMatchObject({ ok: false, reason: 'web', name: 'Mount Tomah', message: 'Short links only work inside the Android app. Open the link in a browser and paste the long address, or paste the coordinates.' });
    expect(calls).toHaveLength(0);
  });

  it('an unknown short link (404)', async () => {
    native(() => ({ status: 404, headers: {}, data: '' }));
    expect(await resolveMapsShortLink(SHORT)).toMatchObject({ ok: false, reason: 'not-found', message: SHORT_LINK_MESSAGES.notFound });
  });

  it('no connection: one retry, then the friendly message', async () => {
    const calls = native(() => new Error('Unable to resolve host "maps.app.goo.gl"'));
    const r = await resolveMapsShortLink(SHORT);
    expect(r).toMatchObject({ ok: false, reason: 'unreachable', message: 'Could not reach Google Maps. Check your connection, or paste the coordinates.' });
    expect(calls).toHaveLength(2);
  });

  it('a lost connection that works on the retry', async () => {
    const calls = native((_o, n) => (n === 1 ? new Error('connection reset') : redirect(PLACE)));
    const r = await resolveMapsShortLink(SHORT);
    expect(r).toMatchObject({ ok: true, position: { lat: -33.5447, lon: 150.4097 } });
    expect(calls).toHaveLength(2);
  });

  it('a busy server (503) is tried once more', async () => {
    const calls = native((_o, n) => (n === 1 ? { status: 503, headers: {}, data: '' } : redirect(PLACE)));
    expect(await resolveMapsShortLink(SHORT)).toMatchObject({ ok: true });
    expect(calls).toHaveLength(2);
    native(() => ({ status: 503, headers: {}, data: '' }));
    expect(await resolveMapsShortLink(SHORT)).toMatchObject({ ok: false, reason: 'unreachable' });
  });

  it('a server that never answers times out (after the retry) with the friendly message', async () => {
    const calls = native(() => () => new Promise<HttpResponse>(() => {}));
    const r = await resolveMapsShortLink(SHORT, { timeoutMs: 20, retryDelayMs: 1 });
    expect(r).toMatchObject({ ok: false, reason: 'unreachable', message: SHORT_LINK_MESSAGES.unreachable });
    expect(calls).toHaveLength(2);
  });

  it('cancelling (the person edits the text) stops it and says nothing', async () => {
    const ctrl = new AbortController();
    const calls = native(() => () => new Promise<HttpResponse>(() => {}));
    const p = resolveMapsShortLink(SHORT, { signal: ctrl.signal, timeoutMs: 5000 });
    setTimeout(() => ctrl.abort(), 10);
    const r = await p;
    expect(r).toMatchObject({ ok: false, reason: 'aborted', message: '' });
    expect(calls).toHaveLength(1);
  });

  it('already cancelled: no request', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const calls = native(() => redirect(PLACE));
    expect(await resolveMapsShortLink(SHORT, { signal: ctrl.signal })).toMatchObject({ ok: false, reason: 'aborted' });
    expect(calls).toHaveLength(0);
  });

  it('a redirect to a place with a position outside the world is refused with the parser message', async () => {
    native(() => redirect('https://www.google.com/maps/@-133.5,350.4,10z'));
    expect(await resolveMapsShortLink(SHORT)).toMatchObject({ ok: false, reason: 'other', message: LOCATION_MESSAGES.outOfRange });
  });

  it('a 3xx with no Location is not a place', async () => {
    native(() => ({ status: 302, headers: {}, data: '' }));
    expect(await resolveMapsShortLink(SHORT)).toMatchObject({ ok: false, reason: 'other' });
  });

  it('works on the Node transport too (fetch with redirect: manual)', async () => {
    const seen: RequestInit[] = [];
    setHttpConfig({
      platform: 'node',
      fetch: (async (_url: RequestInfo | URL, init?: RequestInit) => {
        seen.push(init ?? {});
        return new Response(null, { status: 302, headers: { location: PLACE } });
      }) as typeof fetch,
    });
    const r = await resolveMapsShortLink(SHORT);
    expect(r).toMatchObject({ ok: true, position: { lat: -33.5447, lon: 150.4097 } });
    expect(seen[0]).toMatchObject({ method: 'GET', redirect: 'manual' });
    expect(seen[0]!.headers ?? {}).toEqual({});
  });
});
