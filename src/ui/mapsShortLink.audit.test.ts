/**
 * Audit of the Google short-link resolver: the REAL answers of ten live maps.app.goo.gl links (nsw.gov.au Trustee & Guardian office
 * pages; `curl -I` on 2026-10-07: HTTP/2 302 and a Location header, no body, no cookies), the allowlist at the one place a request
 * is made, what a hostile or broken answer can do, and answers a phone plugin might give in odd shapes.
 */
import type { HttpOptions, HttpResponse } from '@capacitor/core';
import { afterEach, describe, expect, it } from 'vitest';
import { resetHttpConfig, setHttpConfig } from '../data/http';
import { resolveMapsShortLink, SHORT_LINK_MESSAGES } from './mapsShortLink';

afterEach(() => resetHttpConfig());

type Step = Partial<HttpResponse> | Error | string | ((o: HttpOptions) => Promise<HttpResponse>);

function native(answer: (o: HttpOptions, n: number) => Step) {
  const calls: HttpOptions[] = [];
  const fn = async (o: HttpOptions): Promise<HttpResponse> => {
    calls.push(o);
    const s = answer(o, calls.length);
    if (s instanceof Error) throw s;
    if (typeof s === 'string') throw s; // a plugin that rejects with a bare string
    if (typeof s === 'function') return s(o);
    return { status: 200, headers: {}, url: o.url, data: '', ...s } as HttpResponse;
  };
  setHttpConfig({ platform: 'native', nativeRequest: fn, retryDelayMs: 1 });
  return calls;
}
const redirect = (location: string): Partial<HttpResponse> => ({ status: 302, headers: { Location: location }, data: '' });
const html = (body: string, url?: string): Partial<HttpResponse> => ({ status: 200, headers: { 'Content-Type': 'text/html' }, data: Buffer.from(body).toString('base64'), ...(url ? { url } : {}) });

// ten real short links → the Location they really answered with → the pin (the !3d!4d pair, 100 to 250 m from the @ view centre)
const REAL: [string, string, number, number][] = [
  ['3jWg8jLDNCN2A7fU9', 'https://www.google.com/maps/place/114+William+St,+Port+Macquarie+NSW+2444/@-31.431455,152.9061245,16z/data=!3m1!4b1!4m6!3m5!1s0x6b9dff261e2846db:0xf80ff8111ef04d16!8m2!3d-31.4314596!4d152.9086994!16s%2Fg%2F11c5kqllt4?entry=tts&g_ep=EgoyMDI0MDUyMi4wKgBIAVAD', -31.4314596, 152.9086994],
  ['3k2wuSVE7HJSLemy9', 'https://www.google.com/maps/place/Katoomba+Court+House/@-33.7110863,150.311386,17z/data=!3m1!4b1!4m6!3m5!1s0x6b126e9a8ccb482d:0xb72df8ca41c3a6dd!8m2!3d-33.7110863!4d150.3139609!16s%2Fg%2F1ptyt7_5f?entry=tts&g_ep=EgoyMDI0MDYwMy4wKgBIAVAD', -33.7110863, 150.3139609],
  ['7YzJSMoywXNiPDTc6', 'https://www.google.com/maps/place/Level+10%2F727+Hunter+St,+Newcastle+West+NSW+2302/@-32.9260238,151.7603762,16.75z/data=!4m5!3m4!1s0x6b73151e2bbeb787:0xa1cd2829dea2fb42!8m2!3d-32.9262055!4d151.7606984?entry=tts&g_ep=EgoyMDI0MDkxOC4xKgBIAVAD', -32.9262055, 151.7606984],
  ['83oeEkxS1RxQbnTu5', 'https://www.google.com/maps/place/64+Talbragar+St,+Dubbo+NSW+2830/@-32.2447561,148.6010534,16z/data=!3m1!4b1!4m6!3m5!1s0x6b0f71b3afc49fb1:0x3506427042670366!8m2!3d-32.2447561!4d148.6036283!16s%2Fg%2F11b8v5qv0q?entry=tts&g_ep=EgoyMDI0MDYwMy4wKgBIAVAD', -32.2447561, 148.6036283],
  ['DWBHzH43XP3ZMNYr9', "https://www.google.com/maps/place/19+O'Connell+St,+Sydney+NSW+2000/@-33.8649248,151.2069945,17z/data=!3m1!4b1!4m6!3m5!1s0x6b12ae41c2ac2a7b:0xf478d4cfaee2626f!8m2!3d-33.8649293!4d151.2095694!16s%2Fg%2F11b8y7fgqj?entry=tts&g_ep=EgoyMDI0MDUyMS4wKgBIAVAD", -33.8649293, 151.2095694],
  ['KqxRrEScV2RPYpCL6', 'https://www.google.com/maps/place/230+Howick+St,+Bathurst+NSW+2795/@-33.4166239,149.5778915,17z/data=!3m1!4b1!4m6!3m5!1s0x6b11e433e15a25b1:0xa8cbb2d697aeec4b!8m2!3d-33.4166284!4d149.5804718!16s%2Fg%2F11c2ch0_xk?entry=tts&g_ep=EgoyMDI0MDUyMS4wKgBIAVAD', -33.4166284, 149.5804718],
  ['Mqn2YkbDLjy8DKaL8', 'https://www.google.com/maps/place/160+Marsden+St,+Parramatta+NSW+2150/@-33.8123183,150.9989844,17z/data=!3m1!4b1!4m6!3m5!1s0x6b12a31e3a3a90c3:0xfa67688e8ad747d9!8m2!3d-33.8123228!4d151.0015647!16s%2Fg%2F11bw42mkr8?entry=tts&g_ep=EgoyMDI0MDUyMS4wKgBIAVAD', -33.8123228, 151.0015647],
  ['U8NiUZchYQmxkmCz6', 'https://www.google.com/maps/place/6+Zadoc+St,+Lismore+NSW+2480/@-28.8049852,153.2771041,16z/data=!3m1!4b1!4m6!3m5!1s0x6b909e17559d2fbd:0xc4103dd62a9eac21!8m2!3d-28.8049899!4d153.2796844!16s%2Fg%2F11c21cyy_m?entry=tts&g_ep=EgoyMDI0MDUyMS4wKgBIAVAD', -28.8049899, 153.2796844],
  ['UP5qFjoZ8EhJyhrU6', 'https://www.google.com/maps/place/32+Sulphide+St,+Broken+Hill+NSW+2880/@-31.9585575,141.4608277,17z/data=!3m1!4b1!4m6!3m5!1s0x6aeeac2f4eaf09f5:0x57ebc4fcd9a00743!8m2!3d-31.9585621!4d141.463408!16s%2Fg%2F11bw41nf96?entry=tts&g_ep=EgoyMDI0MDUyMS4wKgBIAVAD', -31.9585621, 141.463408],
  ['zv62vr5Nki1cDiWp7', 'https://www.google.com/maps/place/176+Baylis+St,+Wagga+Wagga+NSW+2650/@-35.1122511,147.3670744,17z/data=!3m1!4b1!4m6!3m5!1s0x6b18997f9c4fbd75:0xc85c358319f9fde6!8m2!3d-35.1122555!4d147.3696493!16s%2Fg%2F11bw49jrls?entry=tts&g_ep=EgoyMDI0MDUyMi4wKgBIAVAD', -35.1122555, 147.3696493],
];

describe('real maps.app.goo.gl answers: one 302, the pin, one request, nothing sent', () => {
  for (const [id, location, lat, lon] of REAL) {
    it(`maps.app.goo.gl/${id}`, async () => {
      const calls = native(() => redirect(location));
      const r = await resolveMapsShortLink(`https://maps.app.goo.gl/${id}`);
      expect(r).toMatchObject({ ok: true, position: { lat, lon }, source: 'google-maps-link' });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ url: `https://maps.app.goo.gl/${id}`, method: 'GET', disableRedirects: true });
      expect(calls[0]!.headers ?? {}).toEqual({});
      expect(calls[0]).not.toHaveProperty('data');
    });
  }

  it('the lower-case "location" header of an HTTP/2 answer works too', async () => {
    const [id, location, lat, lon] = REAL[1]!;
    native(() => ({ status: 302, headers: { location }, data: '' }));
    expect(await resolveMapsShortLink(`https://maps.app.goo.gl/${id}`)).toMatchObject({ ok: true, position: { lat, lon } });
  });

  it('a relative Location is read against the address it came from', async () => {
    const calls = native((o) => (o.url.startsWith('https://maps.app.goo.gl/') ? redirect('/maps/place/X/@-33.5,150.4,15z/data=!3d-33.51!4d150.41') : { status: 500 }));
    // a relative Location from maps.app.goo.gl stays on maps.app.goo.gl, which is not a map address: nothing is guessed
    const r = await resolveMapsShortLink('https://maps.app.goo.gl/AbCdEf123');
    expect(r.ok).toBe(false);
    expect(calls.length).toBeLessThanOrEqual(5);
  });
});

describe('the allowlist is enforced where the request is made', () => {
  it('a pasted http:// short link is asked for over https (the link must not travel in clear)', async () => {
    const [id, location, lat, lon] = REAL[1]!;
    const calls = native(() => redirect(location));
    const r = await resolveMapsShortLink(`http://maps.app.goo.gl/${id}`);
    expect(r).toMatchObject({ ok: true, position: { lat, lon } });
    expect(calls.map((c) => c.url)).toEqual([`https://maps.app.goo.gl/${id}`]);
  });

  it('a redirect to http://www.google.com/... with no coordinates is read over https', async () => {
    const calls = native((o) => (o.url.startsWith('https://maps.app.goo.gl/') ? redirect('http://www.google.com/maps/place/Nowhere/data=!4m2!3m1!1s0x1:0x2') : html('')));
    await resolveMapsShortLink('https://maps.app.goo.gl/AbCdEf123');
    expect(calls.map((c) => c.url)).toEqual(['https://maps.app.goo.gl/AbCdEf123', 'https://www.google.com/maps/place/Nowhere/data=!4m2!3m1!1s0x1:0x2']);
  });

  it.each([
    ['another site', 'https://evil.example/maps/place/X/data=!4m2'],
    ['a look-alike host', 'https://www.google.com.evil.example/maps/place/X/data=!4m2'],
    ['a user name in front of Google', 'https://user:pw@www.google.com/maps/place/X/data=!4m2'],
    ['an odd port on Google', 'https://www.google.com:8443/maps/place/X/data=!4m2'],
    ['an OpenStreetMap address (coordinates in it are not believed)', 'https://www.openstreetmap.org/#map=15/-33.5/150.4'],
    ['a geo: address', 'geo:-33.5,150.4'],
    ['the wrapper google.com/url to another site', `https://www.google.com/url?q=${encodeURIComponent('https://evil.example/x')}`],
  ])('a redirect to %s is refused and nothing else is requested', async (_n, target) => {
    const calls = native(() => redirect(target));
    const r = await resolveMapsShortLink('https://maps.app.goo.gl/AbCdEf123');
    expect(r).toMatchObject({ ok: false, reason: 'refused', message: SHORT_LINK_MESSAGES.refused });
    expect(calls).toHaveLength(1);
  });

  it('the page of an address with no coordinates is fetched by hand: a redirect from it to another site is refused, never followed', async () => {
    const calls = native((o) => {
      if (o.url.startsWith('https://maps.app.goo.gl/')) return redirect('https://www.google.com/maps/place/Nowhere/data=!4m2!3m1!1s0x1:0x2');
      if (o.url.startsWith('https://www.google.com/')) return redirect('https://evil.example/landing');
      return html('<link rel="canonical" href="https://www.google.com/maps/@-33.5,150.4,15z">');
    });
    const r = await resolveMapsShortLink('https://maps.app.goo.gl/AbCdEf123');
    expect(r).toMatchObject({ ok: false, reason: 'refused' });
    expect(calls.map((c) => c.url)).toEqual(['https://maps.app.goo.gl/AbCdEf123', 'https://www.google.com/maps/place/Nowhere/data=!4m2!3m1!1s0x1:0x2']);
    expect(calls.every((c) => c.disableRedirects === true)).toBe(true);
  });

  it('a 200 whose final address is another site (a platform that followed anyway) is not read for coordinates', async () => {
    native((o) => html('<link rel="canonical" href="https://www.google.com/maps/@-33.5,150.4,15z">', o.url === 'https://maps.app.goo.gl/AbCdEf123' ? 'https://evil.example/landing' : o.url));
    expect(await resolveMapsShortLink('https://maps.app.goo.gl/AbCdEf123')).toMatchObject({ ok: false, reason: 'refused' });
  });
});

describe('odd answers never throw and never leave a rejection behind', () => {
  const SHORT = 'https://maps.app.goo.gl/AbCdEf123';
  const cases: [string, Step][] = [
    ['a plugin that rejects with a bare string', 'boom'],
    ['an answer with no headers', { status: 302, headers: undefined as never, data: '' }],
    ['an answer with null data', { status: 200, data: null as never }],
    ['an answer with object data', { status: 200, data: { a: 1 } as never }],
    ['an answer with garbage base64', { status: 200, data: '!!!not base64!!!' }],
    ['a status of 0', { status: 0, data: '' }],
    ['a Location that is not an address', { status: 302, headers: { Location: 'http://[bad' }, data: '' }],
    ['a Location of 100 000 characters', { status: 302, headers: { Location: `https://www.google.com/maps/${'a'.repeat(100000)}` }, data: '' }],
    ['a 429', { status: 429, data: '' }],
    ['a 500', { status: 500, data: '' }],
    ['a 403', { status: 403, data: '' }],
  ];
  for (const [name, step] of cases) {
    it(name, async () => {
      native(() => step);
      const r = await resolveMapsShortLink(SHORT);
      expect(typeof r.ok).toBe('boolean');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message.length).toBeGreaterThan(10);
    });
  }

  it('a native plugin that throws before it returns a promise', async () => {
    setHttpConfig({
      platform: 'native',
      nativeRequest: (() => {
        throw new Error('sync');
      }) as never,
      retryDelayMs: 1,
    });
    expect(await resolveMapsShortLink(SHORT)).toMatchObject({ ok: false, reason: 'unreachable' });
  });

  it('429 and 500 are retried once, then said in plain words', async () => {
    const calls = native(() => ({ status: 429, data: '' }));
    expect(await resolveMapsShortLink(SHORT)).toMatchObject({ ok: false, reason: 'unreachable', message: SHORT_LINK_MESSAGES.unreachable });
    expect(calls).toHaveLength(2);
  });

  it('a 1 MB body from Google is read only up to 512 kB and fast', async () => {
    const body = `${'x'.repeat(1024 * 1024)}`;
    native((o) => (o.url === SHORT ? redirect('https://www.google.com/maps/place/Nowhere/data=!4m2!3m1!1s0x1:0x2') : html(body)));
    const t = performance.now();
    const r = await resolveMapsShortLink(SHORT);
    expect(r).toMatchObject({ ok: false, reason: 'no-coordinates' });
    expect(performance.now() - t).toBeLessThan(500);
  });

  it('a hostile 512 kB page (quadratic for a naive pattern) is scanned in well under a second', async () => {
    native((o) => (o.url === SHORT ? redirect('https://www.google.com/maps/place/Nowhere/data=!4m2!3m1!1s0x1:0x2') : html('<link '.repeat(90000))));
    const t = performance.now();
    expect(await resolveMapsShortLink(SHORT)).toMatchObject({ ok: false, reason: 'no-coordinates' });
    expect(performance.now() - t).toBeLessThan(1000);
  });
});

describe('races: a newer request does not disturb an older one, and an abort leaves nothing behind', () => {
  const A = 'https://maps.app.goo.gl/AAAAAAAA1';
  const B = 'https://maps.app.goo.gl/BBBBBBBB2';
  it('two lookups at once each get their own answer', async () => {
    native(
      (o) => () =>
        new Promise<HttpResponse>((res) => setTimeout(() => res({ status: 302, headers: { Location: o.url === A ? 'https://www.google.com/maps/@-33.1,150.1,15z' : 'https://www.google.com/maps/@-33.2,150.2,15z' }, url: o.url, data: '' } as HttpResponse), o.url === A ? 30 : 5)),
    );
    const [a, b] = await Promise.all([resolveMapsShortLink(A), resolveMapsShortLink(B)]);
    expect(a).toMatchObject({ ok: true, position: { lat: -33.1, lon: 150.1 } });
    expect(b).toMatchObject({ ok: true, position: { lat: -33.2, lon: 150.2 } });
  });

  it('abort during the retry pause ends at once, with no second request', async () => {
    const ctrl = new AbortController();
    const calls = native(() => ({ status: 503, data: '' }));
    setHttpConfig({ retryDelayMs: 1 });
    const p = resolveMapsShortLink(A, { signal: ctrl.signal, retryDelayMs: 60_000 });
    setTimeout(() => ctrl.abort(), 20);
    const t = performance.now();
    expect(await p).toMatchObject({ ok: false, reason: 'aborted' });
    expect(performance.now() - t).toBeLessThan(2000);
    expect(calls).toHaveLength(1);
  });
});
