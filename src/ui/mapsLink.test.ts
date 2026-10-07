/**
 * The place a person pastes into Setup: plain coordinates, Google Maps links in every form, the text Google Maps' Share makes,
 * geo: and OpenStreetMap links, Google's wrapper links, and short links (recognised here, resolved in data/mapsShortLink.ts).
 *
 * The first block is REAL: addresses a live maps.app.goo.gl link redirected to on 2026-10-07 (the pin and the view centre
 * differ by up to 4 km there, and one link carries no coordinates at all). The Mount Tomah ones are the shape Google makes
 * for the botanic garden (about -33.545, 150.41).
 */
import { describe, expect, it } from 'vitest';
import { isInNsw } from './nsw';
import {
  cleanPlaceName,
  formatCoordinateText,
  isGoogleHost,
  isMapsShortLink,
  LOCATION_MESSAGES,
  parseCoordinates,
  parseLocationText,
  rememberableText,
  scanMapsPage,
  type LocationFound,
} from './mapsLink';

const found = (text: string): LocationFound => {
  const r = parseLocationText(text);
  if (!r.ok) throw new Error(`expected a position for ${JSON.stringify(text)}, got ${r.reason}: ${r.message}`);
  return r;
};

interface Case {
  title: string;
  input: string;
  lat: number;
  lon: number;
  name?: string;
  source?: LocationFound['source'];
  note?: string;
}

const TOMAH = { lat: -33.5447, lon: 150.4097 };

// ───────────── real redirect targets of live maps.app.goo.gl links (2026-10-07) ─────────────
const REAL: Case[] = [
  {
    title: 'a shared place: the !3d!4d pin, not the @ view centre (300 m apart)',
    input:
      'https://www.google.com/maps/place/Edu+Bolos/@-9.4053471,-38.2192099,16.52z/data=!4m6!3m5!1s0x709312a0178a66b:0xe49dcb40956b7a8b!8m2!3d-9.4068691!4d-38.2173097!16s%2Fg%2F11j2yxgsn5!5m1!1e2?entry=tts&g_ep=EgoyMDI2MDYyOS4wIPu8ASoASAFQAw%3D%3D&skid=03fac211-c769-413d-9a68-c39d732eb159',
    lat: -9.4068691,
    lon: -38.2173097,
    name: 'Edu Bolos',
  },
  {
    title: 'a shared place whose view centre is 4 km from the pin',
    input:
      'https://www.google.com/maps/place/Royal+Schez/@21.1858611,72.7992794,13.11z/data=!4m7!3m6!1s0x3be04dcc0c301ce5:0xf2b6ab3c151a79f4!8m2!3d21.2239727!4d72.7854404!16s%2Fg%2F11mwbxy7v2?coh=245187&entry=tts&skid=6bc6b513-d8',
    lat: 21.2239727,
    lon: 72.7854404,
    name: 'Royal Schez',
  },
  {
    title: 'a zoom written in metres (902m)',
    input:
      'https://www.google.com/maps/place/Eden+Rock+Hotel/@27.9061603,34.3245447,902m/data=!3m1!1e3!4m10!3m9!1s0x145339d4cf57bd9d:0x514b790367c2d5fb!5m3!1s2026-01-25!4m1!1i2!8m2!3d27.9061603!4d34.3271143!16s%2Fg%2F1tt4lrt7?coh=277533&entry=tts&skid=acec6dee',
    lat: 27.9061603,
    lon: 34.3271143,
    name: 'Eden Rock Hotel',
  },
  {
    title: 'percent-encoded letters in the name',
    input:
      'https://www.google.com/maps/place/G%C3%B6ttert+SA/@-34.4321845,-58.7245832,17z/data=!3m1!4b1!4m6!3m5!1s0x95bca1f658a28291:0x455bc592494f000f!8m2!3d-34.432189!4d-58.7220083!16s%2Fg%2F12hn6s3gj?entry=tts&g_ep=EgoyMDI2MDgxOS4wIPu8ASoASAFQAw%3D%3D&skid=fedf9e4d',
    lat: -34.432189,
    lon: -58.7220083,
    name: 'Göttert SA',
  },
  {
    title: 'a dropped pin: /maps/search/<lat>,+<lon> (the plus is a space and the longitude keeps its own minus)',
    input: 'https://www.google.com/maps/search/5.811698,+-55.118891?entry=tts&g_ep=EgoyMDI1MDEyOS4xIPu8ASoASAFQAw%3D%3D',
    lat: 5.811698,
    lon: -55.118891,
  },
];

// ───────────── Mount Tomah and the other forms of Google Maps address ─────────────
const GOOGLE: Case[] = [
  {
    title: 'Mount Tomah Botanic Garden, the place address of the Maps app',
    input:
      'https://www.google.com/maps/place/Mount+Tomah+Botanic+Garden/@-33.5447,150.4097,17z/data=!3m1!4b1!4m6!3m5!1s0x6b1292f3c1e5d9e1:0x5017d681632a3b0!8m2!3d-33.5447!4d150.4097!16s%2Fm%2F0gxk9xn?entry=ttu',
    ...TOMAH,
    name: 'Mount Tomah Botanic Garden',
  },
  { title: 'Mount Tomah, pin a little off the view centre', input: 'https://www.google.com/maps/place/Mount+Tomah/@-33.5400,150.4000,15z/data=!4m5!3m4!1s0x0:0x0!8m2!3d-33.5447!4d150.4097', ...TOMAH, name: 'Mount Tomah' },
  { title: 'a map view: /maps/@lat,lon,zoom', input: 'https://www.google.com/maps/@-33.5447,150.4097,15z', ...TOMAH },
  { title: 'a map view with a satellite data part', input: 'https://www.google.com/maps/@-33.5447,150.4097,2104m/data=!3m1!1e3', ...TOMAH },
  { title: 'a Street View address', input: 'https://www.google.com/maps/@-33.5447,150.4097,3a,75y,271.5h,90t/data=!3m6!1e1!3m4!1sAF1Q!2e0!7i16384!8i8192', ...TOMAH },
  { title: '/maps?q=lat,lon', input: 'https://www.google.com/maps?q=-33.5447,150.4097', ...TOMAH },
  { title: 'maps.google.com/?q=lat,lon', input: 'https://maps.google.com/?q=-33.5447,150.4097', ...TOMAH },
  { title: 'q=loc:lat,lon', input: 'https://maps.google.com/maps?q=loc:-33.5447,150.4097&z=15', ...TOMAH },
  { title: 'q=Name@lat,lon gives the name too', input: 'https://www.google.com/maps?q=Mount+Tomah+Botanic+Garden@-33.5447,150.4097', ...TOMAH, name: 'Mount Tomah Botanic Garden' },
  { title: 'q=lat,lon(Label)', input: 'https://maps.google.com/?q=-33.5447,150.4097(Mount+Tomah+lookout)', ...TOMAH, name: 'Mount Tomah lookout' },
  { title: 'q with an encoded comma and a plus', input: 'https://www.google.com/maps?q=-33.5447%2C+150.4097', ...TOMAH },
  { title: '?ll=lat,lon', input: 'https://maps.google.com/maps?ll=-33.5447,150.4097&z=14&t=m', ...TOMAH },
  { title: '?center=lat%2Clon', input: 'https://www.google.com/maps?center=-33.5447%2C150.4097&zoom=14', ...TOMAH },
  { title: 'the Maps URLs API: /maps/search/?api=1&query=lat,lon', input: 'https://www.google.com/maps/search/?api=1&query=-33.5447%2C150.4097', ...TOMAH },
  { title: 'the Maps URLs API map action: center=', input: 'https://www.google.com/maps/@?api=1&map_action=map&center=-33.5447%2C150.4097&zoom=14', ...TOMAH },
  { title: '/maps/search/lat,+lon', input: 'https://www.google.com/maps/search/-33.5447,+150.4097', ...TOMAH },
  { title: '/maps/search/lat,lon/@view', input: 'https://www.google.com/maps/search/-33.5447,150.4097/@-33.5447,150.4097,17z', ...TOMAH },
  { title: '/maps/place/lat,lon', input: 'https://www.google.com/maps/place/-33.5447,150.4097', ...TOMAH },
  {
    title: 'a dropped pin as Google writes it: degrees, minutes, seconds in the place segment, the exact pin in the data',
    input: "https://www.google.com/maps/place/33%C2%B032'40.9%22S+150%C2%B024'35.0%22E/@-33.5447,150.4097,17z/data=!3m1!4b1!4m4!3m3!8m2!3d-33.5447!4d150.4097",
    ...TOMAH,
  },
  { title: 'a dropped pin with only the degrees-minutes-seconds segment', input: "https://www.google.com/maps/place/33%C2%B032'44.2%22S+150%C2%B024'35.1%22E", lat: -33.545611, lon: 150.409750 },
  { title: 'an embed address: !2d<lon>!3d<lat>', input: 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3312.9!2d150.4097!3d-33.5447!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x0!2z!5e0!3m2!1sen!2sau!4v1700000000000', ...TOMAH },
  { title: 'My Maps viewer: ll=', input: 'https://www.google.com/maps/d/viewer?mid=1AbC&ll=-33.5447%2C150.4097&z=12', ...TOMAH },
  { title: 'Street View cbll=', input: 'https://maps.google.com/?layer=c&cbll=-33.5447,150.4097', ...TOMAH },
  { title: 'a place with only a view centre keeps a note', input: 'https://www.google.com/maps/place/Mount+Tomah+Botanic+Garden/@-33.5447,150.4097,17z', ...TOMAH, name: 'Mount Tomah Botanic Garden', note: LOCATION_MESSAGES.viewCentre },
  { title: 'a search by name with a view', input: 'https://www.google.com/maps/search/Mount+Tomah+Botanic+Garden/@-33.5447,150.4097,15z', ...TOMAH, name: 'Mount Tomah Botanic Garden', note: LOCATION_MESSAGES.viewCentre },
  { title: 'a place and the address in the same segment: only the name', input: 'https://www.google.com/maps/place/Mount+Tomah+Botanic+Garden,+Bells+Line+of+Rd,+Mount+Tomah+NSW+2758/@-33.5447,150.4097,17z/data=!3d-33.5447!4d150.4097', ...TOMAH, name: 'Mount Tomah Botanic Garden' },
  { title: 'google.com.au', input: 'https://www.google.com.au/maps/place/Mount+Tomah/@-33.5447,150.4097,17z/data=!3d-33.5447!4d150.4097', ...TOMAH, name: 'Mount Tomah' },
  { title: 'google.co.uk', input: 'https://www.google.co.uk/maps/@-33.5447,150.4097,15z', ...TOMAH },
  { title: 'maps.google.com.au', input: 'https://maps.google.com.au/?q=-33.5447,150.4097', ...TOMAH },
  { title: 'google.de without www', input: 'https://google.de/maps/@-33.5447,150.4097,15z', ...TOMAH },
  { title: 'an upper-case address', input: 'HTTPS://WWW.GOOGLE.COM/MAPS/@-33.5447,150.4097,17Z', ...TOMAH },
  { title: 'http (not https)', input: 'http://maps.google.com/maps?q=-33.5447,150.4097', ...TOMAH },
  { title: 'with no https:// in front', input: 'www.google.com/maps/@-33.5447,150.4097,17z', ...TOMAH },
  { title: 'maps.google.com with no scheme', input: 'maps.google.com/?q=-33.5447,150.4097', ...TOMAH },
  { title: 'the Firebase form of a short link: maps.app.goo.gl/?link=<the address>', input: 'https://maps.app.goo.gl/?link=https%3A%2F%2Fwww.google.com%2Fmaps%2Fplace%2FMount%2BTomah%2F%40-33.5447%2C150.4097%2C17z&apn=com.google.android.apps.maps', ...TOMAH, name: 'Mount Tomah', note: LOCATION_MESSAGES.viewCentre },
  { title: 'a route that has one clear point: dir//lat,lon', input: 'https://www.google.com/maps/dir//-33.5447,150.4097/@-33.5,150.4,12z', ...TOMAH, note: LOCATION_MESSAGES.routeEnd },
  { title: 'a route from "your location" to a point', input: 'https://www.google.com/maps/dir/Your+location/-33.5447,150.4097', ...TOMAH, note: LOCATION_MESSAGES.routeEnd },
  { title: 'the Maps URLs API with only a destination', input: 'https://www.google.com/maps/dir/?api=1&destination=-33.5447%2C150.4097', ...TOMAH, note: LOCATION_MESSAGES.routeEnd },
  {
    title: 'a route to ONE named place: its waypoint is in the data',
    input: 'https://www.google.com/maps/dir//Mount+Tomah+Botanic+Garden/@-33.5,150.4,15z/data=!4m8!4m7!1m0!1m5!1m1!1s0x6b1292f3c1e5d9e1:0x5017d681632a3b0!2m2!1d150.4097!2d-33.5447!3e0',
    ...TOMAH,
    name: 'Mount Tomah Botanic Garden',
    note: LOCATION_MESSAGES.routeEnd,
  },
];

// ───────────── what Google Maps' Share hands over, and other wrappers ─────────────
const WRAPPED: Case[] = [
  { title: 'angle brackets and a full stop around the link', input: 'See <https://www.google.com/maps/@-33.5447,150.4097,17z>.', ...TOMAH },
  { title: 'in brackets with a closing bracket', input: 'Meet here (https://www.google.com/maps/@-33.5447,150.4097,17z)', ...TOMAH },
  { title: 'a trailing comma and quotes', input: '"https://www.google.com/maps?q=-33.5447,150.4097",', ...TOMAH },
  { title: 'zero-width characters and a non-breaking space around the link', input: '\u{200B}\u{00A0}https://www.google.com/maps/@-33.5447,150.4097,17z\u{200B}\u{2060}\u{FEFF}', ...TOMAH },
  { title: 'a name line, then the long link', input: 'Mount Tomah Botanic Garden\nhttps://www.google.com/maps/place/Mount+Tomah+Botanic+Garden/@-33.5447,150.4097,17z/data=!3d-33.5447!4d150.4097', ...TOMAH, name: 'Mount Tomah Botanic Garden' },
  { title: 'a name and an address line, then the link: the name is the first line', input: 'Mount Tomah Botanic Garden\nBells Line of Road, Mount Tomah NSW 2758\nhttps://www.google.com/maps/@-33.5447,150.4097,17z', ...TOMAH, name: 'Mount Tomah Botanic Garden' },
  { title: '"name, address" and the link on one line', input: 'Mount Tomah Botanic Garden, Bells Line of Road, Mount Tomah NSW 2758 https://www.google.com/maps/@-33.5447,150.4097,17z', ...TOMAH, name: 'Mount Tomah Botanic Garden' },
  { title: 'Windows line breaks', input: 'Mount Tomah Botanic Garden\r\nhttps://www.google.com/maps/@-33.5447,150.4097,17z\r\n', ...TOMAH, name: 'Mount Tomah Botanic Garden' },
  { title: 'share boilerplate is not a name', input: 'Check out this place on Google Maps: https://www.google.com/maps/@-33.5447,150.4097,17z', ...TOMAH },
  { title: 'the consent page with the real address in continue=', input: 'https://consent.google.com/m?continue=https://www.google.com/maps/place/Mount+Tomah/@-33.5447,150.4097,17z/data%3D!3d-33.5447!4d150.4097&gl=AU&m=0&pc=m&uxe=eomtm&cm=2&hl=en&src=1', ...TOMAH, name: 'Mount Tomah' },
  { title: 'the consent page with a percent-encoded address', input: 'https://consent.google.com/ml?continue=https%3A%2F%2Fwww.google.com%2Fmaps%2F%40-33.5447%2C150.4097%2C17z&gl=AU&hl=en', ...TOMAH },
  { title: 'the consent page with a twice-encoded address', input: 'https://consent.google.de/m?continue=https%253A%252F%252Fwww.google.com%252Fmaps%252F%25404%252C150%252C3z&gl=DE', lat: 4, lon: 150 },
  { title: "Google's redirect wrapper /url?q=", input: 'https://www.google.com/url?sa=t&url=https%3A%2F%2Fwww.google.com%2Fmaps%2F%40-33.5447%2C150.4097%2C17z&usg=AOvVaw', ...TOMAH },
  { title: 'geo: link', input: 'geo:-33.5447,150.4097', ...TOMAH, source: 'geo-link' },
  { title: 'geo: link with a zoom', input: 'geo:-33.5447,150.4097?z=17', ...TOMAH, source: 'geo-link' },
  { title: 'geo: link with an uncertainty', input: 'geo:-33.5447,150.4097;u=35', ...TOMAH, source: 'geo-link' },
  { title: 'geo:0,0?q=lat,lon(Label)', input: 'geo:0,0?q=-33.5447,150.4097(Mount+Tomah)', ...TOMAH, name: 'Mount Tomah', source: 'geo-link' },
  { title: 'OpenStreetMap #map=zoom/lat/lon', input: 'https://www.openstreetmap.org/#map=17/-33.5447/150.4097', ...TOMAH, source: 'openstreetmap-link' },
  { title: 'OpenStreetMap marker beats the view', input: 'https://www.openstreetmap.org/?mlat=-33.5447&mlon=150.4097#map=15/-33.50/150.30', ...TOMAH, source: 'openstreetmap-link' },
  { title: 'osm.org with a marker', input: 'https://osm.org/?mlat=-33.5447&mlon=150.4097', ...TOMAH, source: 'openstreetmap-link' },
  { title: 'coordinates beside a short link need no network', input: '-33.5447, 150.4097\nhttps://maps.app.goo.gl/AbCdEf123', ...TOMAH, source: 'coordinates' },
  { title: 'a short link and a long one: the long one wins', input: 'https://maps.app.goo.gl/AbCdEf123 https://www.google.com/maps/@-33.5447,150.4097,17z', ...TOMAH },
];

describe('parseLocationText: real and typical Google Maps addresses', () => {
  for (const group of [
    ['real redirect targets', REAL],
    ['Google Maps address forms', GOOGLE],
    ['share text and wrapper links', WRAPPED],
  ] as const) {
    describe(group[0], () => {
      for (const c of group[1]) {
        it(c.title, () => {
          const r = found(c.input);
          expect(r.position.lat).toBeCloseTo(c.lat, 6);
          expect(r.position.lon).toBeCloseTo(c.lon, 6);
          expect(r.name).toBe(c.name);
          expect(r.source).toBe(c.source ?? 'google-maps-link');
          expect(r.note).toBe(c.note);
        });
      }
    });
  }

  it('the corpus is at least 40 inputs, all different', () => {
    const all = [...REAL, ...GOOGLE, ...WRAPPED].map((c) => c.input);
    expect(all.length).toBeGreaterThanOrEqual(40);
    expect(new Set(all).size).toBe(all.length);
  });

  it('every Mount Tomah input lands inside NSW and inside the garden (about -33.545, 150.41)', () => {
    for (const c of [...GOOGLE, ...WRAPPED].filter((x) => Math.abs(x.lat - TOMAH.lat) < 1e-6)) {
      const r = found(c.input);
      expect(isInNsw(r.position), c.title).toBe(true);
    }
  });
});

describe('parseLocationText: the pin beats the view', () => {
  it('!3d!4d is used even when @ says something else and q= is a name', () => {
    const r = found('https://www.google.com/maps/place/X/@10,20,15z/data=!3d-33.5447!4d150.4097');
    expect(r.position).toEqual({ lat: -33.5447, lon: 150.4097 });
  });
  it('the place segment (coordinates) beats the @ view', () => {
    const r = found('https://www.google.com/maps/place/-33.5447,150.4097/@-33.0,150.0,10z');
    expect(r.position).toEqual({ lat: -33.5447, lon: 150.4097 });
  });
  it('q= beats ll=', () => {
    const r = found('https://www.google.com/maps?q=-33.5447,150.4097&ll=-33.0,150.0');
    expect(r.position).toEqual({ lat: -33.5447, lon: 150.4097 });
  });
  it('a name in q= with an ll= view gives the view with a note', () => {
    const r = found('https://maps.google.com/maps?q=Mount+Tomah&ll=-33.5447,150.4097&z=14');
    expect(r.position).toEqual({ lat: -33.5447, lon: 150.4097 });
    expect(r.name).toBe('Mount Tomah');
    expect(r.note).toBe(LOCATION_MESSAGES.viewCentre);
  });
});

describe('parseLocationText: links that cannot be used say why', () => {
  const reasons: [string, string, string][] = [
    ['a real route (two named places)', 'https://www.google.com/maps/dir/Sydney/Katoomba/@-33.7,150.5,9z', 'route'],
    ['a route between two coordinate pairs', 'https://www.google.com/maps/dir/-33.8688,151.2093/-33.5447,150.4097/', 'route'],
    ['a route with an origin and a destination in the API form', 'https://www.google.com/maps/dir/?api=1&origin=Sydney&destination=-33.5447%2C150.4097', 'route'],
    ['a route to a named place with no waypoint data', 'https://www.google.com/maps/dir//Mount+Tomah/', 'route'],
    ['a knowledge-panel link', 'https://g.co/kgs/AbCdEf1', 'knowledge-panel'],
    ['a place with only a place id (a real one)', 'https://www.google.com/maps/place/Kr%C3%B3lowa+Shoppingu,+Stawowa+61,+31-346+Krak%C3%B3w/data=!4m2!3m1!1s0x47165b0c5d6eb017:0x9558c47aa6f47982!18m1!1e1?utm_source=mstt_1&entry=gps&coh=192189', 'no-coordinates'],
    ['a cid link', 'https://maps.google.com/?cid=12345678901234567890', 'no-coordinates'],
    ['a plus code', 'https://www.google.com/maps/place/4RRH46J7%2BX8', 'no-coordinates'],
    ['a place name only', 'https://www.google.com/maps?q=Mount+Tomah', 'no-coordinates'],
    ['an OpenStreetMap object', 'https://www.openstreetmap.org/node/123456', 'no-coordinates'],
    ['geo: with a name only', 'geo:0,0?q=Mount+Tomah', 'no-coordinates'],
    ['another website', 'https://example.com/maps/@-33.5,150.4,10z', 'not-a-map-link'],
    ['a Google search page', 'https://www.google.com/search?q=mount+tomah', 'not-a-map-link'],
    ['a look-alike host', 'https://google.com.evil.example/maps/@-33.5,150.4,10z', 'not-a-map-link'],
    ['a look-alike host that ends in google.com', 'https://notgoogle.com/maps/@-33.5,150.4,10z', 'not-a-map-link'],
    ['a business page', 'https://g.page/mount-tomah', 'not-a-map-link'],
    ['a view outside the range', 'https://www.google.com/maps/@-133.5,350.4,10z', 'out-of-range'],
    ['0, 0', 'https://www.google.com/maps/@0,0,3z', 'zero'],
    ['a pin outside the range', 'https://www.google.com/maps/place/X/data=!3d-95.5!4d150.4', 'out-of-range'],
  ];
  for (const [title, input, reason] of reasons) {
    it(title, () => {
      const r = parseLocationText(input);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toBe(reason);
        expect(r.message.length).toBeGreaterThan(10);
      }
    });
  }

  it('the route message is the plain sentence the feature promises', () => {
    const r = parseLocationText('https://www.google.com/maps/dir/Sydney/Katoomba/');
    expect(r).toMatchObject({ ok: false, message: 'This link is a route. Open the place and share that.' });
  });

  it('a place link with no coordinates keeps its name for the message', () => {
    const r = parseLocationText('https://www.google.com/maps/place/Mount+Tomah/data=!4m2!3m1!1s0x6b:0x50');
    expect(r).toMatchObject({ ok: false, reason: 'no-coordinates', name: 'Mount Tomah' });
  });
});

describe('short links', () => {
  it.each(['https://maps.app.goo.gl/AbCdEf123', 'http://maps.app.goo.gl/AbCdEf123', 'maps.app.goo.gl/AbCdEf123', 'https://goo.gl/maps/AbCdEf123456', 'https://goo.gl/maps/AbCdEf123456?foo=1', 'https://MAPS.APP.GOO.GL/TvPZdQo9HRmnfb4d8'])('%s needs the network', (u) => {
    const r = parseLocationText(u);
    expect(r).toMatchObject({ ok: false, reason: 'short-link-needs-network' });
    if (!r.ok && r.reason === 'short-link-needs-network') {
      expect(isMapsShortLink(r.url)).toBe(true);
      expect(r.url).not.toMatch(/\s/);
    }
  });

  it('keeps the name written above the link, and the address lines are not the name', () => {
    const r = parseLocationText('Mount Tomah Botanic Garden\nBells Line of Road, Mount Tomah NSW 2758\nhttps://maps.app.goo.gl/AbCdEf123');
    expect(r).toMatchObject({ ok: false, reason: 'short-link-needs-network', name: 'Mount Tomah Botanic Garden', url: 'https://maps.app.goo.gl/AbCdEf123' });
  });

  it('a short link on a line of its own after Windows line breaks and a trailing full stop', () => {
    const r = parseLocationText('Mount Tomah Botanic Garden\r\nhttps://maps.app.goo.gl/AbCdEf123.\r\n');
    expect(r).toMatchObject({ ok: false, reason: 'short-link-needs-network', url: 'https://maps.app.goo.gl/AbCdEf123' });
  });

  it('inside the consent page wrapper', () => {
    const r = parseLocationText('https://consent.google.com/m?continue=https%3A%2F%2Fmaps.app.goo.gl%2FAbCdEf123&gl=AU');
    expect(r).toMatchObject({ ok: false, reason: 'short-link-needs-network', url: 'https://maps.app.goo.gl/AbCdEf123' });
  });

  it('isMapsShortLink allows only the Google short-link hosts', () => {
    expect(isMapsShortLink('https://maps.app.goo.gl/x1')).toBe(true);
    expect(isMapsShortLink('https://goo.gl/maps/x1')).toBe(true);
    expect(isMapsShortLink('https://maps.app.goo.gl/')).toBe(false);
    expect(isMapsShortLink('https://goo.gl/other/x1')).toBe(false);
    expect(isMapsShortLink('https://g.co/kgs/x1')).toBe(false);
    expect(isMapsShortLink('https://maps.app.goo.gl.evil.example/x1')).toBe(false);
    expect(isMapsShortLink('https://evil.example/maps.app.goo.gl/x1')).toBe(false);
    expect(isMapsShortLink('ftp://maps.app.goo.gl/x1')).toBe(false);
    expect(isMapsShortLink('not a url')).toBe(false);
  });

  it('isGoogleHost accepts Google domains of any country and nothing that only looks like one', () => {
    for (const h of ['google.com', 'www.google.com', 'maps.google.com', 'www.google.com.au', 'google.co.uk', 'consent.google.de', 'MAPS.GOOGLE.COM.BR']) expect(isGoogleHost(h), h).toBe(true);
    for (const h of ['google.com.evil.example', 'notgoogle.com', 'google', 'goo.gl', 'maps.app.goo.gl', 'google.evil', 'example.com']) expect(isGoogleHost(h), h).toBe(false);
  });
});

describe('parseCoordinates: plain coordinates', () => {
  const ok: [string, string, number, number][] = [
    ['decimal with a comma and a space', '-33.5447, 150.4097', -33.5447, 150.4097],
    ['decimal with no space', '-33.5447,150.4097', -33.5447, 150.4097],
    ['decimal with a space only', '-33.5447 150.4097', -33.5447, 150.4097],
    ['a semicolon', '-33.5447; 150.4097', -33.5447, 150.4097],
    ['a typographic minus', '\u{2212}33.5447, 150.4097', -33.5447, 150.4097],
    ['an en dash used as a minus', '\u{2013}33.5447, 150.4097', -33.5447, 150.4097],
    ['brackets', '(-33.5447, 150.4097)', -33.5447, 150.4097],
    ['square brackets', '[-33.5447, 150.4097]', -33.5447, 150.4097],
    ['a plus sign on the longitude', '-33.5447, +150.4097', -33.5447, 150.4097],
    ['a tab and extra spaces', '  -33.5447 \t  150.4097  ', -33.5447, 150.4097],
    ['letters after, no degree signs', '33.5447 S 150.4097 E', -33.5447, 150.4097],
    ['letters after, with degree signs', '33.5447° S, 150.4097° E', -33.5447, 150.4097],
    ['letters after, no spaces', '33.5447S, 150.4097E', -33.5447, 150.4097],
    ['letters before', 'S 33.5447 E 150.4097', -33.5447, 150.4097],
    ['letters before, no spaces', 'S33.5447 E150.4097', -33.5447, 150.4097],
    ['lower-case letters', '33.5447s 150.4097e', -33.5447, 150.4097],
    ['words for the directions', '33.5447 South 150.4097 East', -33.5447, 150.4097],
    ['the longitude first by its letters', 'E 150.4097 S 33.5447', -33.5447, 150.4097],
    ['north and west', '40.7128 N 74.006 W', 40.7128, -74.006],
    ['labelled', 'lat -33.5447 lon 150.4097', -33.5447, 150.4097],
    ['labelled with colons', 'Lat: -33.5447, Lng: 150.4097', -33.5447, 150.4097],
    ['labelled in words', 'Latitude -33.5447 Longitude 150.4097', -33.5447, 150.4097],
    ['labelled, longitude first', 'lon 150.4097, lat -33.5447', -33.5447, 150.4097],
    ['a leading word', 'coordinates: -33.5447, 150.4097', -33.5447, 150.4097],
    ['degrees minutes seconds with S and E', '33°32\'40.9"S 150°24\'35.0"E', -33.544694, 150.409722],
    ['degrees minutes seconds with prime marks', '33°32′40.9″S 150°24′35.0″E', -33.544694, 150.409722],
    ['degrees minutes seconds with curly quotes', '33°32’40.9”S 150°24’35.0”E', -33.544694, 150.409722],
    ['degrees minutes seconds with spaces', '33° 32\' 40.9" S, 150° 24\' 35.0" E', -33.544694, 150.409722],
    ['degrees minutes seconds with doubled apostrophes', "33°32'40.9''S 150°24'35.0''E", -33.544694, 150.409722],
    ['degrees minutes seconds, signed, no letters', '-33°32\'40.9" 150°24\'35.0"', -33.544694, 150.409722],
    ['degrees and decimal minutes', "33°32.6817'S 150°24.5833'E", -33.544695, 150.409722],
    ['degrees and decimal minutes the way a GPS shows them', 'S33 32.682 E150 24.583', -33.5447, 150.409717],
    ['a masculine ordinal indicator as the degree sign', "33\u{00BA}32'40.9\"S 150\u{00BA}24'35.0\"E", -33.544694, 150.409722],
    ['full-width digits', '\u{FF0D}33.5447\u{FF0C}150.4097', -33.5447, 150.4097],
    ['no-break space', '-33.5447\u{00A0}150.4097', -33.5447, 150.4097],
    ['integers', '-33, 150', -33, 150],
    ['a lat of exactly 90', '90, 0.5', 90, 0.5],
    ['positive latitude (the Setup screen says Outside NSW)', '33.5447, 150.4097', 33.5447, 150.4097],
  ];
  for (const [title, input, lat, lon] of ok) {
    it(title, () => {
      const r = parseCoordinates(input);
      expect(r, input).not.toBeNull();
      expect(r!.ok, input).toBe(true);
      if (r && r.ok) {
        expect(r.position.lat).toBeCloseTo(lat, 5);
        expect(r.position.lon).toBeCloseTo(lon, 5);
        expect(r.source).toBe('coordinates');
        expect(r.note).toBeUndefined();
      }
    });
  }

  it('a longitude-first pair is swapped, and says so', () => {
    const r = found('150.4097, -33.5447');
    expect(r.position).toEqual({ lat: -33.5447, lon: 150.4097 });
    expect(r.note).toBe(LOCATION_MESSAGES.swapped);
  });

  it('a pair that works either way is read as latitude, longitude', () => {
    expect(found('33.5, 80.2').position).toEqual({ lat: 33.5, lon: 80.2 });
  });

  const notCoordinates = ['', '   ', 'hello', 'Mount Tomah', 'Katoomba 2780', '-33.5447', '1 2 3', '2026-10-07', '12/10/2026', '0412 345 678', '33.5 S 150.4 S', '33.5 E 150.4 W', '-33.5 N 150.4 E', 'N S', '33 32 44 150 24 35', '33.5° 30\' S, 150.4° E', "33°75'S 150°24'E", '33°32\'75"S 150°24\'E', '-33.5447, 150.4097, 12', 'x'.repeat(400)];
  for (const input of notCoordinates) {
    it(`is not coordinates: ${JSON.stringify(input.slice(0, 40))}`, () => {
      const r = parseCoordinates(input);
      expect(r === null || !r.ok).toBe(true);
    });
  }

  it('out of range and zero say so', () => {
    expect(parseCoordinates('91, 200')).toMatchObject({ ok: false, reason: 'out-of-range' });
    expect(parseCoordinates('-95.5, 150.4')).toMatchObject({ ok: false, reason: 'out-of-range' });
    expect(parseCoordinates('-33.5, 190.4')).toMatchObject({ ok: false, reason: 'out-of-range' });
    expect(parseCoordinates('0, 0')).toMatchObject({ ok: false, reason: 'zero' });
    expect(parseCoordinates('0.0 N 0.0 E')).toMatchObject({ ok: false, reason: 'zero' });
  });

  it('a comma used as the decimal point is not supported, and the message says to use a dot', () => {
    const r = parseLocationText('-33,5447 150,4097');
    expect(r).toMatchObject({ ok: false, reason: 'comma-decimals', message: LOCATION_MESSAGES.commaDecimals });
    expect(parseLocationText('-33,5447; 150,4097')).toMatchObject({ ok: false, reason: 'comma-decimals' });
  });
});

describe('parseLocationText: empty and odd input', () => {
  it('empty text asks for a link or coordinates', () => {
    expect(parseLocationText('')).toMatchObject({ ok: false, reason: 'empty' });
    expect(parseLocationText('  \n\t ')).toMatchObject({ ok: false, reason: 'empty' });
    expect(parseLocationText('\u{200B}\u{200B}')).toMatchObject({ ok: false, reason: 'empty' });
  });
  it('words are not recognised, with a plain message', () => {
    const r = parseLocationText('the shed behind the hall');
    expect(r).toMatchObject({ ok: false, reason: 'not-recognised', message: LOCATION_MESSAGES.notRecognised });
  });
  it('a non-string never throws', () => {
    expect(parseLocationText(undefined as unknown as string)).toMatchObject({ ok: false });
    expect(parseLocationText(null as unknown as string)).toMatchObject({ ok: false });
    expect(parseLocationText(42 as unknown as string)).toMatchObject({ ok: false });
  });
  it('a very long text is cut and still answered', () => {
    const r = parseLocationText(`${'word '.repeat(5000)} https://www.google.com/maps/@-33.5447,150.4097,17z`);
    expect(r.ok === true || r.ok === false).toBe(true);
  });
  it('a malformed percent escape does not throw', () => {
    expect(parseLocationText('https://www.google.com/maps/place/%E0%A4%A/@-33.5447,150.4097,17z').ok).toBe(true);
    expect(parseLocationText('https://www.google.com/maps?q=%ZZ-33.5447,150.4097').ok).toBeDefined();
  });
  it('a bare Google URL with nothing after it is not a place', () => {
    expect(parseLocationText('https://www.google.com/maps')).toMatchObject({ ok: false, reason: 'no-coordinates' });
    expect(parseLocationText('https://www.google.com/')).toMatchObject({ ok: false, reason: 'not-a-map-link' });
  });
  it('the first Google Maps link is used when there are several other links', () => {
    const r = found('Docs: https://example.com/page and the place https://www.google.com/maps/@-33.5447,150.4097,17z and https://www.google.com/maps/@-30,150,17z');
    expect(r.position).toEqual({ lat: -33.5447, lon: 150.4097 });
  });
  it('the result position is a fresh object each time', () => {
    const a = found('-33.5, 150.4');
    const b = found('-33.5, 150.4');
    expect(a.position).not.toBe(b.position);
  });
});

describe('names', () => {
  it('cleanPlaceName tidies white space, drops coordinates and links, and caps the length', () => {
    expect(cleanPlaceName('  Mount   Tomah \n Botanic Garden ')).toBe('Mount Tomah Botanic Garden');
    expect(cleanPlaceName('33°32\'44.2"S 150°24\'35.1"E')).toBeUndefined();
    expect(cleanPlaceName('-33.5447, 150.4097')).toBeUndefined();
    expect(cleanPlaceName('https://example.com')).toBeUndefined();
    expect(cleanPlaceName('')).toBeUndefined();
    expect(cleanPlaceName('A')).toBeUndefined();
    expect(cleanPlaceName(undefined)).toBeUndefined();
    expect(cleanPlaceName('x'.repeat(200))!.length).toBeLessThanOrEqual(60);
    expect(cleanPlaceName('Bells Line of Road, Mount Tomah, Blue Mountains, New South Wales, Australia, Earth')!.length).toBeLessThanOrEqual(60);
  });
});

describe('what the Setup box remembers', () => {
  it('plain coordinates are kept as typed', () => {
    expect(rememberableText('-33.70, 149.86')).toBe('-33.70, 149.86');
    expect(rememberableText('  S 33.7 E 149.86 ')).toBe('S 33.7 E 149.86');
  });
  it('a link or share text is replaced by the normalised lat, lon: the link (with its place id) is never kept', () => {
    const share = 'Mount Tomah Botanic Garden\nhttps://www.google.com/maps/place/Mount+Tomah+Botanic+Garden/@-33.5447,150.4097,17z/data=!4m6!3m5!1s0x6b1292f3c1e5d9e1:0x5017d681632a3b0!8m2!3d-33.5447!4d150.4097';
    expect(rememberableText(share)).toBe('-33.54470, 150.40970');
    expect(rememberableText('geo:-33.5447,150.4097')).toBe('-33.54470, 150.40970');
  });
  it('anything that is not a position is dropped (an unresolved short link, junk)', () => {
    expect(rememberableText('https://maps.app.goo.gl/AbCdEf123')).toBe('');
    expect(rememberableText('hello')).toBe('');
    expect(rememberableText('')).toBe('');
    expect(rememberableText(undefined as unknown as string)).toBe('');
  });
  it('formatCoordinateText has five decimals (about a metre) and parses back to the same place', () => {
    const t = formatCoordinateText({ lat: -33.5447123456, lon: 150.4097987654 });
    expect(t).toBe('-33.54471, 150.40980');
    const p = found(t).position;
    expect(p.lat).toBeCloseTo(-33.54471, 5);
    expect(p.lon).toBeCloseTo(150.4098, 5);
  });
});

describe('scanMapsPage: the page behind a link, as a last resort', () => {
  it("never takes Google's default picture (the middle of the USA at zoom 4) for a place", () => {
    const shell =
      '<meta content="https://maps.google.com/maps/api/staticmap?center=37.0625%2C-95.677068&amp;zoom=4&amp;size=900x900&amp;language=en&amp;sensor=false&amp;key=K" property="og:image"><script>APP_INITIALIZATION_STATE=[[[2.6E7,-95.677068,37.06250000000001],[0,0,0]]]</script>';
    expect(scanMapsPage(shell)).toBeNull();
  });
  it('finds the page\'s own canonical address', () => {
    const r = scanMapsPage('<head><link rel="canonical" href="https://www.google.com/maps/place/Mount+Tomah/@-33.5447,150.4097,17z/data=!3d-33.5447!4d150.4097"></head>');
    expect(r?.position).toEqual({ lat: -33.5447, lon: 150.4097 });
    expect(r?.name).toBe('Mount Tomah');
  });
  it('finds og:url', () => {
    const r = scanMapsPage('<meta property="og:url" content="https://www.google.com/maps/@-33.5447,150.4097,17z">');
    expect(r?.position).toEqual({ lat: -33.5447, lon: 150.4097 });
  });
  it('finds a !3d!4d pin in the page data', () => {
    const r = scanMapsPage('window.APP=[["x",null,"!1s0x6b:0x50!8m2!3d-33.5447!4d150.4097!16s"]]');
    expect(r?.position).toEqual({ lat: -33.5447, lon: 150.4097 });
  });
  it('finds the marker of a static map picture', () => {
    const r = scanMapsPage('<meta content="https://maps.google.com/maps/api/staticmap?center=-33.5%2C150.4&amp;zoom=15&amp;size=900x900&amp;markers=color%3Ared%7C-33.5447%2C150.4097&amp;key=K" property="og:image">');
    expect(r?.position).toEqual({ lat: -33.5447, lon: 150.4097 });
  });
  it('takes the centre of a close-zoom static map picture, with a note', () => {
    const r = scanMapsPage('<meta content="https://maps.google.com/maps/api/staticmap?center=-33.5447%2C150.4097&amp;zoom=15&amp;size=900x900&amp;key=K" property="og:image">');
    expect(r?.position).toEqual({ lat: -33.5447, lon: 150.4097 });
    expect(r?.note).toBe(LOCATION_MESSAGES.viewCentre);
  });
  it('refuses a far-out static map (zoom under 8)', () => {
    expect(scanMapsPage('<meta content="https://maps.google.com/maps/api/staticmap?center=-33.5447%2C150.4097&amp;zoom=4&amp;size=900x900" property="og:image">')).toBeNull();
  });
  it('finds an @view inside a Maps path in the page', () => {
    const r = scanMapsPage('["/maps/place/Mount+Tomah/@-33.5447,150.4097,17z/data=!4m2"]');
    expect(r?.position).toEqual({ lat: -33.5447, lon: 150.4097 });
  });
  it('reads at most 512 kB and never throws', () => {
    const big = `${'x'.repeat(600 * 1024)}!3d-33.5447!4d150.4097`;
    expect(scanMapsPage(big)).toBeNull();
    expect(scanMapsPage('')).toBeNull();
    expect(scanMapsPage(undefined as unknown as string)).toBeNull();
  });
});

// ───────────── fuzz: junk never throws and never gives an out-of-range position ─────────────

/** mulberry32: a small seeded generator so a failure can be replayed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('fuzz', () => {
  const PIECES = [
    '-', '+', '.', ',', ' ', ';', '/', '@', '!', '?', '&', '=', '%', '%2C', '%E0%A4%A', '+', '°', "'", '"', '′', '″', '\u{200B}', '\n', '(', ')', '<', '>', ':',
    'N', 'S', 'E', 'W', 'lat', 'lon', 'z', 'm', 'http://', 'https://', 'www.google.com/maps', 'maps.google.com', 'maps.app.goo.gl/', 'goo.gl/maps/', 'consent.google.com/m?continue=', 'geo:', 'q=', 'll=', 'center=', '!3d', '!4d', '!2d', '!1d', '!2m2', '/place/', '/search/', '/dir/', '/data=', '/@',
    '0', '1', '9', '33', '90', '91', '180', '181', '-33.5447', '150.4097', '999999999999999999999', '1e308', '-0', 'NaN', 'Infinity', 'Mount Tomah', 'é', '漢', '😀', '\uD83D', '\u{FFFF}', '\u0000', 'x',
  ];

  it('random junk and random links never throw, and every position found is in range and not 0, 0', () => {
    const rand = rng(20261007);
    let positions = 0;
    for (let i = 0; i < 12000; i++) {
      const n = 1 + Math.floor(rand() * 14);
      let s = '';
      for (let k = 0; k < n; k++) s += PIECES[Math.floor(rand() * PIECES.length)]!;
      const r = parseLocationText(s);
      expect(typeof r.ok).toBe('boolean');
      if (r.ok) {
        positions++;
        const { lat, lon } = r.position;
        expect(Number.isFinite(lat) && Number.isFinite(lon), s).toBe(true);
        expect(Math.abs(lat) <= 90 && Math.abs(lon) <= 180, s).toBe(true);
        expect(lat === 0 && lon === 0, s).toBe(false);
      } else {
        expect(r.message.length, s).toBeGreaterThan(0);
      }
      // the remembered text is always safe: empty, or two numbers
      const mem = rememberableText(s);
      expect(mem === '' || /^[^a-z]{3,80}$/i.test(mem) || /^[-+0-9.,;° '"′″NSEWnsewlatonglt:()[\]]+$/.test(mem), s).toBe(true);
    }
    expect(positions).toBeGreaterThan(5); // random junk does produce a pair of numbers now and then
  });

  it('mutated real inputs (characters deleted, inserted and swapped) never throw and keep every position in range', () => {
    const rand = rng(99);
    const seeds = [...REAL, ...GOOGLE, ...WRAPPED].map((c) => c.input).concat(['-33.5447, 150.4097', "33°32'40.9\"S 150°24'35.0\"E", 'S33 32.682 E150 24.583', 'geo:-33.5447,150.4097?q=x']);
    let positions = 0;
    for (let i = 0; i < 20000; i++) {
      let s = seeds[Math.floor(rand() * seeds.length)]!;
      const edits = 1 + Math.floor(rand() * 4);
      for (let e = 0; e < edits; e++) {
        const at = Math.floor(rand() * (s.length + 1));
        const kind = rand();
        if (kind < 0.35) s = s.slice(0, at) + s.slice(at + 1 + Math.floor(rand() * 3));
        else if (kind < 0.7) s = s.slice(0, at) + PIECES[Math.floor(rand() * PIECES.length)]! + s.slice(at);
        else if (kind < 0.85) s = s.slice(0, at) + s.slice(Math.max(0, at - 4), at) + s.slice(at);
        else s = s.slice(0, at);
      }
      const r = parseLocationText(s);
      if (r.ok) {
        positions++;
        const { lat, lon } = r.position;
        expect(Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0), s).toBe(true);
      }
      expect(typeof rememberableText(s)).toBe('string');
    }
    expect(positions).toBeGreaterThan(1000);
  });

  it('round trip: any position written in the usual styles is read back', () => {
    const rand = rng(7);
    for (let i = 0; i < 3000; i++) {
      const lat = (rand() * 2 - 1) * 89.9;
      const lon = (rand() * 2 - 1) * 179.9;
      if (Math.abs(lat) < 0.01 && Math.abs(lon) < 0.01) continue;
      const dec = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
      const letters = `${Math.abs(lat).toFixed(6)}° ${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(6)}° ${lon < 0 ? 'W' : 'E'}`;
      const dms = (v: number, pos: string, neg: string): string => {
        const a = Math.abs(v);
        const d = Math.floor(a);
        const m = Math.floor((a - d) * 60);
        const s = ((a - d) * 60 - m) * 60;
        return `${d}°${m}'${s.toFixed(3)}"${v < 0 ? neg : pos}`;
      };
      const dmsText = `${dms(lat, 'N', 'S')} ${dms(lon, 'E', 'W')}`;
      const url = `https://www.google.com/maps/place/X/@${(lat + 0.01).toFixed(6)},${lon.toFixed(6)},15z/data=!8m2!3d${lat.toFixed(6)}!4d${lon.toFixed(6)}`;
      for (const [text, tol] of [[dec, 1e-6], [letters, 1e-6], [dmsText, 1e-5], [url, 1e-6]] as const) {
        const r = parseLocationText(text);
        expect(r.ok, text).toBe(true);
        if (r.ok) {
          expect(Math.abs(r.position.lat - lat), text).toBeLessThan(tol);
          expect(Math.abs(r.position.lon - lon), text).toBeLessThan(tol);
        }
      }
    }
  });
});
