/**
 * An independent audit corpus for the "paste a Google Maps link or coordinates" parser: real Google Maps address shapes (desktop
 * and Android), the text Share makes (names in other scripts, emoji, line breaks), wrapper links, other apps' links, odd
 * numbers, hostile strings and speed probes. Every case states the ground truth first (what a person means by the text);
 * the parser has to agree with it, or refuse in plain words, but must never answer with a WRONG position.
 *
 * The first block uses REAL addresses: ten maps.app.goo.gl links published on nsw.gov.au (Trustee & Guardian office pages),
 * resolved with curl on 2026-10-07 (each one is ONE 302 to the /maps/place/... address below; the pin and the map-view centre
 * differ by 100 to 250 m in every one).
 */
import { describe, expect, it } from 'vitest';
import { cleanPlaceName, isGoogleHost, isMapsShortLink, parseCoordinates, parseLocationText, rememberableText, scanMapsPage } from './mapsLink';

type Want =
  | { ok: true; lat: number; lon: number; name?: string | RegExp; note?: boolean; source?: string }
  | { ok: false; reason: string | string[]; name?: string }
  | { short: true; name?: string };

interface Case {
  id: string;
  input: string;
  want: Want;
}

const P = (lat: number, lon: number, extra: Partial<Extract<Want, { ok: true }>> = {}): Want => ({ ok: true, lat, lon, ...extra });
const F = (reason: string | string[], name?: string): Want => ({ ok: false, reason, ...(name ? { name } : {}) });
const S = (name?: string): Want => ({ short: true, ...(name ? { name } : {}) });

const TOMAH_PIN = '!3d-33.5461!4d150.4120';
const TOMAH_PLACE = `https://www.google.com/maps/place/Mount+Tomah+Botanic+Garden/@-33.5452,150.4101,15z/data=!3m1!4b1!4m6!3m5!1s0x6b1292f3c1e5d9e1:0x5017d681632a3b0!8m2${TOMAH_PIN}!16s%2Fm%2F0gxk9xn`;

// ───────────── real redirect targets (Location headers of live maps.app.goo.gl links, 2026-10-07) ─────────────
const REAL: Case[] = [
  ['Katoomba Court House', 'https://www.google.com/maps/place/Katoomba+Court+House/@-33.7110863,150.311386,17z/data=!3m1!4b1!4m6!3m5!1s0x6b126e9a8ccb482d:0xb72df8ca41c3a6dd!8m2!3d-33.7110863!4d150.3139609!16s%2Fg%2F1ptyt7_5f?entry=tts&g_ep=EgoyMDI0MDYwMy4wKgBIAVAD', -33.7110863, 150.3139609],
  ['Port Macquarie', 'https://www.google.com/maps/place/114+William+St,+Port+Macquarie+NSW+2444/@-31.431455,152.9061245,16z/data=!3m1!4b1!4m6!3m5!1s0x6b9dff261e2846db:0xf80ff8111ef04d16!8m2!3d-31.4314596!4d152.9086994!16s%2Fg%2F11c5kqllt4?entry=tts&g_ep=EgoyMDI0MDUyMi4wKgBIAVAD', -31.4314596, 152.9086994],
  ['Newcastle West (a "/" in the name, %2F)', 'https://www.google.com/maps/place/Level+10%2F727+Hunter+St,+Newcastle+West+NSW+2302/@-32.9260238,151.7603762,16.75z/data=!4m5!3m4!1s0x6b73151e2bbeb787:0xa1cd2829dea2fb42!8m2!3d-32.9262055!4d151.7606984?entry=tts&g_ep=EgoyMDI0MDkxOC4xKgBIAVAD', -32.9262055, 151.7606984],
  ['Dubbo', 'https://www.google.com/maps/place/64+Talbragar+St,+Dubbo+NSW+2830/@-32.2447561,148.6010534,16z/data=!3m1!4b1!4m6!3m5!1s0x6b0f71b3afc49fb1:0x3506427042670366!8m2!3d-32.2447561!4d148.6036283!16s%2Fg%2F11b8v5qv0q?entry=tts&g_ep=EgoyMDI0MDYwMy4wKgBIAVAD', -32.2447561, 148.6036283],
  ["Sydney (an apostrophe in the name)", "https://www.google.com/maps/place/19+O'Connell+St,+Sydney+NSW+2000/@-33.8649248,151.2069945,17z/data=!3m1!4b1!4m6!3m5!1s0x6b12ae41c2ac2a7b:0xf478d4cfaee2626f!8m2!3d-33.8649293!4d151.2095694!16s%2Fg%2F11b8y7fgqj?entry=tts&g_ep=EgoyMDI0MDUyMS4wKgBIAVAD", -33.8649293, 151.2095694],
  ['Bathurst', 'https://www.google.com/maps/place/230+Howick+St,+Bathurst+NSW+2795/@-33.4166239,149.5778915,17z/data=!3m1!4b1!4m6!3m5!1s0x6b11e433e15a25b1:0xa8cbb2d697aeec4b!8m2!3d-33.4166284!4d149.5804718!16s%2Fg%2F11c2ch0_xk?entry=tts&g_ep=EgoyMDI0MDUyMS4wKgBIAVAD', -33.4166284, 149.5804718],
  ['Parramatta', 'https://www.google.com/maps/place/160+Marsden+St,+Parramatta+NSW+2150/@-33.8123183,150.9989844,17z/data=!3m1!4b1!4m6!3m5!1s0x6b12a31e3a3a90c3:0xfa67688e8ad747d9!8m2!3d-33.8123228!4d151.0015647!16s%2Fg%2F11bw42mkr8?entry=tts&g_ep=EgoyMDI0MDUyMS4wKgBIAVAD', -33.8123228, 151.0015647],
  ['Lismore', 'https://www.google.com/maps/place/6+Zadoc+St,+Lismore+NSW+2480/@-28.8049852,153.2771041,16z/data=!3m1!4b1!4m6!3m5!1s0x6b909e17559d2fbd:0xc4103dd62a9eac21!8m2!3d-28.8049899!4d153.2796844!16s%2Fg%2F11c21cyy_m?entry=tts&g_ep=EgoyMDI0MDUyMS4wKgBIAVAD', -28.8049899, 153.2796844],
  ['Broken Hill', 'https://www.google.com/maps/place/32+Sulphide+St,+Broken+Hill+NSW+2880/@-31.9585575,141.4608277,17z/data=!3m1!4b1!4m6!3m5!1s0x6aeeac2f4eaf09f5:0x57ebc4fcd9a00743!8m2!3d-31.9585621!4d141.463408!16s%2Fg%2F11bw41nf96?entry=tts&g_ep=EgoyMDI0MDUyMS4wKgBIAVAD', -31.9585621, 141.463408],
  ['Wagga Wagga', 'https://www.google.com/maps/place/176+Baylis+St,+Wagga+Wagga+NSW+2650/@-35.1122511,147.3670744,17z/data=!3m1!4b1!4m6!3m5!1s0x6b18997f9c4fbd75:0xc85c358319f9fde6!8m2!3d-35.1122555!4d147.3696493!16s%2Fg%2F11bw49jrls?entry=tts&g_ep=EgoyMDI0MDUyMi4wKgBIAVAD', -35.1122555, 147.3696493],
].map(([id, input, lat, lon]) => ({ id: `real: ${id as string}`, input: input as string, want: P(lat as number, lon as number, { source: 'google-maps-link' }) }));

// ───────────── the corpus ─────────────
const CORPUS: Case[] = [
  ...REAL,

  // ── Google Maps addresses, desktop and Android ──
  { id: 'pin beats a different @ centre', input: TOMAH_PLACE, want: P(-33.5461, 150.412, { name: 'Mount Tomah Botanic Garden' }) },
  { id: '/maps/@ with a fractional zoom 15.25z', input: 'https://www.google.com/maps/@-33.54,150.41,15.25z', want: P(-33.54, 150.41) },
  { id: '/maps/@ with metres 2500m and a data part', input: 'https://www.google.com/maps/@-33.54,150.41,2500m/data=!3m1!1e3', want: P(-33.54, 150.41) },
  { id: '/maps/@ street view (3a,75y,90t)', input: 'https://www.google.com/maps/@-33.5400000,150.4100000,3a,75y,90t/data=!3m6!1e1!3m4!1sAF1QipPabc!2e10!7i16384!8i8192', want: P(-33.54, 150.41) },
  { id: '/maps/@ with no zoom at all', input: 'https://www.google.com/maps/@-33.54,150.41', want: P(-33.54, 150.41) },
  { id: '/maps?q=lat,lon', input: 'https://www.google.com/maps?q=-33.5447,150.4097', want: P(-33.5447, 150.4097) },
  { id: 'maps.google.com/?q=lat,lon (WhatsApp location)', input: 'https://maps.google.com/?q=-33.5447,150.4097', want: P(-33.5447, 150.4097) },
  { id: 'maps.google.com/maps?ll=&z=', input: 'https://maps.google.com/maps?ll=-33.5447,150.4097&z=15', want: P(-33.5447, 150.4097) },
  { id: 'Maps URLs API search query=lat%2Clon', input: 'https://www.google.com/maps/search/?api=1&query=-33.5447%2C150.4097', want: P(-33.5447, 150.4097) },
  { id: 'Maps URLs API search query=Mount+Tomah: NO coordinates', input: 'https://www.google.com/maps/search/?api=1&query=Mount+Tomah', want: F('no-coordinates', 'Mount Tomah') },
  { id: 'q=<name> only', input: 'https://www.google.com/maps?q=Mount+Tomah+Botanic+Garden', want: F('no-coordinates') },
  { id: 'place with a name and nothing else', input: 'https://www.google.com/maps/place/Mount+Tomah/', want: F('no-coordinates') },
  { id: 'place by id only (no coordinates anywhere)', input: 'https://www.google.com/maps/place/Mount+Tomah+Botanic+Garden/data=!4m2!3m1!1s0x6b1292f3c1e5d9e1:0x5017d681632a3b0', want: F('no-coordinates') },
  { id: 'place with an @ view only', input: 'https://www.google.com/maps/place/Mount+Tomah/@-33.5452,150.4101,15z/', want: P(-33.5452, 150.4101) },
  { id: 'search/<name>/@view: only the view centre (a note is required)', input: 'https://www.google.com/maps/search/Mount+Tomah/@-33.54,150.41,14z', want: P(-33.54, 150.41, { note: true }) },
  { id: 'dropped pin /maps/search/lat,+lon', input: 'https://www.google.com/maps/search/-33.5447,+150.4097/@-33.5447,150.4097,17z', want: P(-33.5447, 150.4097) },
  { id: 'center= in the Maps URLs API', input: 'https://www.google.com/maps/@?api=1&map_action=map&center=-33.5447,150.4097&zoom=14', want: P(-33.5447, 150.4097) },
  { id: 'viewpoint= (street view API)', input: 'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=-33.5447,150.4097', want: P(-33.5447, 150.4097) },
  { id: 'q=loc:lat,lon', input: 'https://google.com/maps?q=loc:-33.5447,150.4097', want: P(-33.5447, 150.4097) },
  { id: 'q wins over a different sll', input: 'https://maps.google.com/maps?q=-33.5447,150.4097&hl=en&sll=-30.0,148.0&sspn=0.2,0.2', want: P(-33.5447, 150.4097) },
  { id: 'country domain google.com.au', input: 'https://www.google.com.au/maps/@-33.5,150.4,15z', want: P(-33.5, 150.4) },
  { id: 'country domain google.co.uk place with pin', input: 'https://www.google.co.uk/maps/place/X/@-33.5,150.4,15z/data=!8m2!3d-33.51!4d150.41', want: P(-33.51, 150.41) },
  { id: 'My Maps viewer with ll=', input: 'https://www.google.com/maps/d/viewer?mid=1abcDEF&ll=-33.5447%2C150.4097&z=14', want: P(-33.5447, 150.4097) },
  { id: 'DMS in the place path (a dropped pin on desktop; the address bar copies " as %22)', input: "https://www.google.com/maps/place/33°32'41.0%22S+150°24'35.0%22E/@-33.54472,150.40972,17z/data=!3m1!4b1!4m4!3m3!8m2!3d-33.5447222!4d150.4097222", want: P(-33.5447222, 150.4097222) },
  { id: 'DMS in the place path, percent-encoded, no data part', input: "https://www.google.com/maps/place/33%C2%B032'41.0%22S+150%C2%B024'35.0%22E", want: P(-33.54472, 150.40972) },
  { id: 'embed pb= (!2d lon, !3d lat)', input: 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3318.9!2d150.4097!3d-33.5447!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x0!2sMount!5e0!3m2!1sen!2sau!4v1', want: P(-33.5447, 150.4097) },
  { id: 'positive latitude (typed without the minus): accepted as written', input: 'https://www.google.com/maps/@33.5447,150.4097,15z', want: P(33.5447, 150.4097) },
  { id: 'lat out of range inside a link', input: 'https://www.google.com/maps/@-95.5,150.4,15z', want: F('out-of-range') },
  { id: 'a zero pin', input: 'https://www.google.com/maps/place/X/data=!3d0!4d0', want: F(['zero', 'out-of-range', 'no-coordinates']) },
  { id: 'Google Earth is not a Maps link', input: 'https://earth.google.com/web/@-33.54,150.41,800a,1000d,35y,0h,0t,0r', want: F('not-a-map-link') },
  { id: 'a Google search link', input: 'https://www.google.com/search?q=mount+tomah+botanic+garden', want: F('not-a-map-link') },
  { id: 'g.co/kgs knowledge panel', input: 'https://g.co/kgs/AbCd123', want: F('knowledge-panel') },
  { id: 'share.google (new Google share host)', input: 'https://share.google/AbCd123', want: F('not-a-map-link') },

  // ── routes ──
  { id: 'dir with two named stops', input: 'https://www.google.com/maps/dir/Katoomba/Mount+Tomah/', want: F('route') },
  { id: 'dir with two coordinate stops and a view', input: 'https://www.google.com/maps/dir/-33.71,150.31/-33.54,150.41/@-33.6,150.3,10z', want: F('route') },
  { id: 'dir with three stops', input: 'https://www.google.com/maps/dir/Katoomba/Mount+Tomah/Penrith/@-33.6,150.4,9z', want: F('route') },
  { id: 'dir from my position to one coordinate pair', input: 'https://www.google.com/maps/dir//-33.5447,150.4097', want: P(-33.5447, 150.4097, { note: true }) },
  { id: 'dir "Current Location" to one coordinate pair', input: 'https://www.google.com/maps/dir/Current+Location/-33.5447,150.4097/data=!4m2!4m1!3e0', want: P(-33.5447, 150.4097, { note: true }) },
  { id: 'Maps URLs API dir with only a destination', input: 'https://www.google.com/maps/dir/?api=1&destination=-33.5447,150.4097', want: P(-33.5447, 150.4097, { note: true }) },
  { id: 'Maps URLs API dir with origin and destination', input: 'https://www.google.com/maps/dir/?api=1&origin=Katoomba&destination=-33.54,150.41', want: F('route') },
  { id: 'saddr + daddr', input: 'https://maps.google.com/maps?saddr=Katoomba&daddr=Mount+Tomah', want: F('route') },

  // ── short links (no coordinates inside: the caller must ask Google) ──
  { id: 'maps.app.goo.gl', input: 'https://maps.app.goo.gl/3k2wuSVE7HJSLemy9', want: S() },
  { id: 'maps.app.goo.gl with g_st', input: 'https://maps.app.goo.gl/AbCdEf123?g_st=ic', want: S() },
  { id: 'maps.app.goo.gl without a scheme', input: 'maps.app.goo.gl/AbCdEf123', want: S() },
  { id: 'old goo.gl/maps', input: 'https://goo.gl/maps/AbCdEf123456', want: S() },
  { id: 'goo.gl/maps with no id', input: 'https://goo.gl/maps', want: F('not-a-map-link') },
  { id: 'maps.app.goo.gl with no id', input: 'https://maps.app.goo.gl/', want: F('not-a-map-link') },

  // ── share text (Android and iOS), names in other scripts, line breaks ──
  { id: 'share: name, address, short link', input: 'Mount Tomah Botanic Garden\nBells Line of Road, Mount Tomah NSW 2758\nhttps://maps.app.goo.gl/AbCdEf123', want: S('Mount Tomah Botanic Garden') },
  { id: 'share: CRLF line breaks', input: 'Mount Tomah Botanic Garden\r\nBells Line of Road, Mount Tomah NSW 2758\r\nhttps://maps.app.goo.gl/AbCdEf123', want: S('Mount Tomah Botanic Garden') },
  { id: 'share: French name with accents', input: 'Jardin botanique de Mount Tomah\nhttps://maps.app.goo.gl/AbCdEf123', want: S('Jardin botanique de Mount Tomah') },
  { id: 'share: Japanese name', input: 'マウント・トーマ植物園\nhttps://maps.app.goo.gl/AbCdEf123', want: S('マウント・トーマ植物園') },
  { id: 'share: Russian name', input: 'Ботанический сад Маунт-Тома\nhttps://goo.gl/maps/AbCdEf123456', want: S('Ботанический сад Маунт-Тома') },
  { id: 'share: Arabic (RTL) name', input: 'حديقة النباتات\nhttps://maps.app.goo.gl/AbCdEf123', want: S('حديقة النباتات') },
  { id: 'share: Hebrew name with RLM/LRM marks', input: '‏גן הבוטני‎\nhttps://maps.app.goo.gl/AbCdEf123', want: S('גן הבוטני') },
  { id: 'share: emoji pin before a Chinese name', input: '📍 蒙特托马植物园\nhttps://maps.app.goo.gl/AbCdEf123', want: S() },
  { id: 'share: one line, name then link (iOS)', input: 'Mount Tomah Botanic Garden https://maps.app.goo.gl/AbCdEf123', want: S('Mount Tomah Botanic Garden') },
  { id: 'share: link in the middle of a sentence', input: 'Meet at https://maps.app.goo.gl/AbCdEf123 at 8am, bring water.', want: S() },
  { id: 'share: two links, the first is used', input: 'A https://maps.app.goo.gl/AAAAAAAA B https://maps.app.goo.gl/BBBBBBBB', want: S() },
  { id: 'share: long place link with a name above it', input: `Our camp\n${TOMAH_PLACE}`, want: P(-33.5461, 150.412, { name: 'Our camp' }) },
  { id: 'share: coordinates written above a short link', input: '-33.5447, 150.4097\nhttps://maps.app.goo.gl/AbCdEf123', want: P(-33.5447, 150.4097) },
  { id: 'share: a long name is cut, not rejected', input: `${'Mount Tomah Botanic Garden and Arboretum visitor centre car park '.repeat(3)}\nhttps://maps.app.goo.gl/AbCdEf123`, want: S() },
  { id: 'a link in angle brackets', input: `<${TOMAH_PLACE}>`, want: P(-33.5461, 150.412) },
  { id: 'a link in double quotes', input: `"${TOMAH_PLACE}"`, want: P(-33.5461, 150.412) },
  { id: 'a link in single quotes', input: `'${TOMAH_PLACE}'`, want: P(-33.5461, 150.412) },
  { id: 'a link in a markdown link', input: '[Mount Tomah](https://www.google.com/maps/@-33.54,150.41,15z)', want: P(-33.54, 150.41) },
  { id: 'a link in brackets then a full stop', input: 'Meet here (https://www.google.com/maps/@-33.54,150.41,15z).', want: P(-33.54, 150.41) },
  { id: 'a link with utm params', input: 'https://www.google.com/maps/place/X/@-33.5,150.4,15z/data=!8m2!3d-33.51!4d150.41?utm_source=newsletter&utm_medium=email&utm_campaign=x', want: P(-33.51, 150.41) },
  { id: 'a link without https://', input: 'google.com/maps/@-33.5,150.4,15z', want: P(-33.5, 150.4) },
  { id: 'maps.google.com without https://', input: 'maps.google.com/?q=-33.5,150.4', want: P(-33.5, 150.4) },
  { id: 'a link with zero-width characters in it', input: 'https://www.google.com/maps/@-33.54,​150.41,15z', want: P(-33.54, 150.41) },
  { id: 'a link with non-breaking spaces around', input: '  https://www.google.com/maps/@-33.54,150.41,15z ', want: P(-33.54, 150.41) },
  { id: 'consent.google.com wrapper', input: `https://consent.google.com/m?continue=${encodeURIComponent('https://www.google.com/maps/place/X/@-33.5,150.4,15z/data=!8m2!3d-33.51!4d150.41')}&gl=DE&m=0&pc=m&uxe=eomtm&cm=2&src=1`, want: P(-33.51, 150.41) },
  { id: 'google.com/url wrapper', input: `https://www.google.com/url?q=${encodeURIComponent('https://www.google.com/maps/@-33.5,150.4,15z')}&sa=D&usg=AOvVaw`, want: P(-33.5, 150.4) },
  { id: 'maps.app.goo.gl/?link= (dynamic link form)', input: `https://maps.app.goo.gl/?link=${encodeURIComponent('https://www.google.com/maps/@-33.5,150.4,15z')}&apn=com.google.android.apps.maps`, want: P(-33.5, 150.4) },
  { id: 'wrappers nested far too deep stay refused', input: ((): string => { let u = 'https://www.google.com/maps/@-33.5,150.4,15z'; for (let i = 0; i < 8; i++) u = `https://www.google.com/url?q=${encodeURIComponent(u)}`; return u; })(), want: F(['not-recognised', 'not-a-map-link']) },

  // ── look-alike and hostile hosts: never a position, never a fetch ──
  { id: 'evil: google.com.evil.example', input: 'https://www.google.com.evil.example/maps/@-33.5,150.4,15z', want: F('not-a-map-link') },
  { id: 'evil: notgoogle.com', input: 'https://notgoogle.com/maps/@-33.5,150.4,15z', want: F('not-a-map-link') },
  { id: 'evil: userinfo google.com@evil', input: 'https://google.com@evil.example/maps/@-33.5,150.4,15z', want: F('not-a-map-link') },
  { id: 'evil: google link inside the query of another site', input: 'https://evil.example/?u=https://www.google.com/maps/@-33.5,150.4,15z', want: F('not-a-map-link') },
  { id: 'evil: wrapper pointing at another site', input: `https://www.google.com/url?q=${encodeURIComponent('https://evil.example/maps/@-33.5,150.4,15z')}`, want: F('not-a-map-link') },
  { id: 'evil: maps.app.goo.gl.evil.example', input: 'https://maps.app.goo.gl.evil.example/abc123', want: F('not-a-map-link') },
  { id: 'evil: goo.gl.evil.example/maps', input: 'https://goo.gl.evil.example/maps/abc123', want: F('not-a-map-link') },
  { id: 'evil: maps.app.goo.gl@evil', input: 'https://maps.app.goo.gl@evil.example/abc123', want: F('not-a-map-link') },
  { id: 'evil: google short link path on another host', input: 'https://evil.example/maps.app.goo.gl/abc123', want: F('not-a-map-link') },
  { id: 'evil: IP address host', input: 'http://127.0.0.1/maps/@-33.5,150.4,15z', want: F('not-a-map-link') },
  { id: 'evil: a plain https site', input: 'https://evil.example/x', want: F('not-a-map-link') },
  { id: 'evil: javascript: URL', input: 'javascript:alert(1)//https://www.google.com', want: F(['not-a-map-link', 'not-recognised']) },
  { id: 'evil: data: URL', input: 'data:text/html,<script>alert(1)</script>', want: F(['not-a-map-link', 'not-recognised']) },
  { id: 'evil: file: URL', input: 'file:///etc/passwd', want: F(['not-a-map-link', 'not-recognised']) },

  // ── other apps ──
  { id: 'Apple Maps: refused in plain words (not a Google link)', input: 'https://maps.apple.com/?ll=-33.5447,150.4097&q=Mount%20Tomah', want: F('not-a-map-link') },
  { id: 'Waze: refused in plain words (not a Google link)', input: 'https://waze.com/ul?ll=-33.5447%2C150.4097&navigate=yes', want: F('not-a-map-link') },
  { id: 'OpenStreetMap #map=', input: 'https://www.openstreetmap.org/#map=15/-33.5447/150.4097', want: P(-33.5447, 150.4097, { source: 'openstreetmap-link' }) },
  { id: 'OpenStreetMap mlat/mlon', input: 'https://www.openstreetmap.org/?mlat=-33.5447&mlon=150.4097#map=15/-33.5/150.4', want: P(-33.5447, 150.4097, { source: 'openstreetmap-link' }) },
  { id: 'OpenStreetMap node page (no coordinates)', input: 'https://www.openstreetmap.org/node/123456', want: F('no-coordinates') },
  { id: 'geo: plain', input: 'geo:-33.5447,150.4097', want: P(-33.5447, 150.4097, { source: 'geo-link' }) },
  { id: 'geo: with z and uncertainty', input: 'geo:-33.5447,150.4097;u=35?z=15', want: P(-33.5447, 150.4097, { source: 'geo-link' }) },
  { id: 'geo:0,0?q=lat,lon(Label)', input: 'geo:0,0?q=-33.5447,150.4097(Mount+Tomah)', want: P(-33.5447, 150.4097, { source: 'geo-link', name: 'Mount Tomah' }) },
  { id: 'geo:0,0?q=Name has no coordinates', input: 'geo:0,0?q=Mount+Tomah', want: F('no-coordinates') },
  { id: 'what3words', input: 'https://what3words.com/filled.count.soap', want: F('not-a-map-link') },
  { id: 'Bing maps', input: 'https://www.bing.com/maps?cp=-33.5447~150.4097&lvl=15', want: F('not-a-map-link') },
  { id: 'plus code with a locality: not guessed', input: '4RRH+W5 Mount Tomah NSW', want: F(['not-recognised']) },
  { id: 'plus code alone: not guessed', input: '4RRH+W5', want: F(['not-recognised']) },
  { id: 'plus.codes link', input: 'https://plus.codes/4RRH+W5', want: F('not-a-map-link') },

  // ── plain coordinates ──
  { id: 'plain: comma + space', input: '-33.5447, 150.4097', want: P(-33.5447, 150.4097, { source: 'coordinates' }) },
  { id: 'plain: space only', input: '-33.5447 150.4097', want: P(-33.5447, 150.4097) },
  { id: 'plain: comma only', input: '-33.5447,150.4097', want: P(-33.5447, 150.4097) },
  { id: 'plain: in brackets', input: '(-33.5447, 150.4097)', want: P(-33.5447, 150.4097) },
  { id: 'plain: U+2212 minus', input: '−33.5447, 150.4097', want: P(-33.5447, 150.4097) },
  { id: 'plain: en dash as minus', input: '–33.5447, 150.4097', want: P(-33.5447, 150.4097) },
  { id: 'plain: full-width digits and comma', input: '－３３．５４４７，１５０．４０９７', want: P(-33.5447, 150.4097) },
  { id: 'plain: degrees with S and E', input: '33.5447° S, 150.4097° E', want: P(-33.5447, 150.4097) },
  { id: 'plain: S and E in front', input: 'S 33.5447 E 150.4097', want: P(-33.5447, 150.4097) },
  { id: 'plain: S33.5447 E150.4097', input: 'S33.5447 E150.4097', want: P(-33.5447, 150.4097) },
  { id: 'plain: DMS with " and \'', input: '33°32\'41"S 150°24\'35"E', want: P(-33.544722, 150.409722) },
  { id: 'plain: DMS with prime marks', input: '33°32′41″S 150°24′35″E', want: P(-33.544722, 150.409722) },
  { id: 'plain: DMS with decimal seconds and commas', input: '33° 32\' 41.0" S, 150° 24\' 35.0" E', want: P(-33.544722, 150.409722) },
  { id: 'plain: DMS with spaces only', input: '33 32 41 S 150 24 35 E', want: P(-33.544722, 150.409722) },
  { id: 'plain: degrees and decimal minutes', input: "33°32.682'S 150°24.582'E", want: P(-33.5447, 150.4097) },
  { id: 'plain: lat/lon labels', input: 'lat -33.5447 lon 150.4097', want: P(-33.5447, 150.4097) },
  { id: 'plain: Lat: Lng: labels', input: 'Lat: -33.5447, Lng: 150.4097', want: P(-33.5447, 150.4097) },
  { id: 'plain: trailing degree signs', input: '-33.5447°, 150.4097°', want: P(-33.5447, 150.4097) },
  { id: 'plain: longitude first is swapped, with a note', input: '150.4097, -33.5447', want: P(-33.5447, 150.4097, { note: true }) },
  { id: 'plain: comma decimals, European', input: '−33,5447 150,4097', want: F('comma-decimals') },
  { id: 'plain: comma decimals with a semicolon', input: '-33,5447; 150,4097', want: F('comma-decimals') },
  { id: 'plain: a comma-decimal single number is not a pair', input: '−33,545', want: F(['comma-decimals', 'out-of-range', 'not-recognised']) },
  { id: 'plain: out of range lon', input: '-33.5447, 450.4097', want: F('out-of-range') },
  { id: 'plain: both out of range', input: '95, 200', want: F('out-of-range') },
  { id: 'plain: 0,0', input: '0,0', want: F('zero') },
  { id: 'plain: 0.0, 0.0', input: '0.0, 0.0', want: F('zero') },
  { id: 'plain: NaN', input: 'NaN, NaN', want: F('not-recognised') },
  { id: 'plain: Infinity', input: 'Infinity, 1', want: F('not-recognised') },
  { id: 'plain: a phone number', input: '+61 2 4784 7444', want: F('not-recognised') },
  { id: 'plain: a street address', input: '12 Smith Street, Katoomba NSW 2780', want: F('not-recognised') },
  { id: 'plain: a postcode alone', input: '2780', want: F('not-recognised') },
  { id: 'plain: a date', input: '07/10/2026', want: F('not-recognised') },
  { id: 'plain: three numbers (lat, lon, altitude) is not a pair', input: '-33.5447, 150.4097, 812', want: F(['not-recognised', 'comma-decimals']) },
  { id: 'plain: empty', input: '', want: F('empty') },
  { id: 'plain: whitespace only', input: ' \n\t ', want: F('empty') },
  { id: 'plain: just words', input: 'Mount Tomah', want: F('not-recognised') },
  { id: 'plain: Mount Tomah botanic garden lat/lon with N/E wrong sign', input: '-33.5447 N, 150.4097 E', want: F(['not-recognised']) },
  { id: 'plain: 10 000 digits', input: '1'.repeat(10000), want: F('not-recognised') },
  { id: 'plain: a minus then 10 000 digits then a longitude', input: `-${'1'.repeat(10000)}, 150`, want: F(['not-recognised', 'out-of-range']) },
  { id: 'plain: a 30-digit mantissa', input: '-33.544700000000000000000000001, 150.409700000000000000000000001', want: P(-33.5447, 150.4097) },

  // ── names that are hostile text: kept as TEXT by the parser and shown as text by the screen ──
  { id: 'name: HTML in share text', input: '<img src=x onerror=alert(1)>\nhttps://maps.app.goo.gl/AbCdEf123', want: S() },
  { id: 'name: HTML in the place path', input: 'https://www.google.com/maps/place/%3Cimg+src%3Dx+onerror%3Dalert(1)%3E/@-33.5,150.4,15z/data=!8m2!3d-33.51!4d150.41', want: P(-33.51, 150.41, { name: /img/ }) },
  { id: 'name: script tag in the place path', input: 'https://www.google.com/maps/place/%3Cscript%3Ealert(1)%3C%2Fscript%3E/@-33.5,150.4,15z/data=!8m2!3d-33.51!4d150.41', want: P(-33.51, 150.41) },
];

function summarise(r: ReturnType<typeof parseLocationText>): string {
  if (r.ok) return `ok ${r.position.lat},${r.position.lon}${r.name ? ` name=${JSON.stringify(r.name)}` : ''} src=${r.source}${r.note ? ' note' : ''}`;
  return `${r.reason}${r.name ? ` name=${JSON.stringify(r.name)}` : ''}${r.reason === 'short-link-needs-network' ? ` url=${r.url}` : ''}`;
}

describe('corpus: every input has the ground truth the person means', () => {
  it('has at least 60 distinct inputs of its own', () => {
    expect(new Set(CORPUS.map((c) => c.input)).size).toBeGreaterThanOrEqual(60);
    expect(new Set(CORPUS.map((c) => c.id)).size).toBe(CORPUS.length);
  });

  for (const c of CORPUS) {
    it(c.id, () => {
      const r = parseLocationText(c.input);
      const w = c.want;
      const where = `${JSON.stringify(c.input.slice(0, 120))} -> ${summarise(r)}`;
      if ('short' in w) {
        expect(r.ok === false && r.reason === 'short-link-needs-network', where).toBe(true);
        if (w.name && !r.ok) expect(r.name, where).toBe(w.name);
        return;
      }
      if (w.ok) {
        expect(r.ok, where).toBe(true);
        if (!r.ok) return;
        expect(r.position.lat, where).toBeCloseTo(w.lat, 5);
        expect(r.position.lon, where).toBeCloseTo(w.lon, 5);
        if (typeof w.name === 'string') expect(r.name, where).toBe(w.name);
        else if (w.name) expect(r.name ?? '', where).toMatch(w.name);
        if (w.note) expect(r.note, where).toBeTruthy();
        if (w.source) expect(r.source, where).toBe(w.source);
        return;
      }
      expect(r.ok, where).toBe(false);
      if (r.ok) return;
      const reasons = Array.isArray(w.reason) ? w.reason : [w.reason];
      expect(reasons, where).toContain(r.reason);
      if (w.name) expect(r.name, where).toBe(w.name);
      expect(r.message.length, where).toBeGreaterThan(10);
    });
  }
});

// ───────────── speed: no input may take more than a few milliseconds per kilobyte ─────────────
function ms(fn: () => unknown): number {
  const t = performance.now();
  fn();
  return performance.now() - t;
}

const MB = 1024 * 1024;
const BIG: [string, string][] = [
  ['1 MB of a', 'a'.repeat(MB)],
  ['1 MB of digits', '1'.repeat(MB)],
  ['1 MB of "-33.5, "', '-33.5, '.repeat(MB / 7)],
  ['1 MB of https://', 'https://'.repeat(MB / 8)],
  ['1 MB google.com/maps/ repeated', 'google.com/maps/ '.repeat(MB / 17)],
  ['a Google URL with 1 MB path', `https://www.google.com/maps/${'a'.repeat(MB)}`],
  ['1 MB of @', '@'.repeat(MB)],
  ['1 MB of (', '('.repeat(MB)],
  ['1 MB of )', `https://www.google.com/maps/@-33.5,150.4,15z${')'.repeat(MB)}`],
  ['1 MB of %', '%'.repeat(MB)],
  ['bad escapes in a place path', `https://www.google.com/maps/place/${'%E0%A4%A'.repeat(100000)}`],
  ['1 MB of !3d', 'https://www.google.com/maps/place/x/data=' + '!3d'.repeat(MB / 3)],
  ['1 MB of <', '<'.repeat(MB)],
  ['1 MB of <https://', '<https://'.repeat(MB / 9)],
  ['1 MB of hyphens between letters', `a${'-'.repeat(MB)}b`],
  ['1 MB of spaces between letters', `a${' '.repeat(MB)}b`],
  ['1 MB of newlines then a link', `${'\n'.repeat(MB)}https://www.google.com/maps/@-33.5,150.4,15z`],
  ['1 MB of zero-width characters', '​'.repeat(MB)],
  ['1 MB of geo:', 'geo:'.repeat(MB / 4)],
  ['1 MB of ?q=((((', `https://www.google.com/maps?q=${'('.repeat(MB)}`],
  ['4000 chars of ) after a link', `https://www.google.com/maps/@-33.5,150.4,15z${')'.repeat(4000)}`],
  ['4000 chars of - after a name', `a${'-'.repeat(4000)}b\nhttps://maps.app.goo.gl/AbCdEf123`],
  ['4000 chars of ,;:| in a place name', `https://www.google.com/maps/place/a${',;:|'.repeat(1000)}b/@-33.5,150.4,15z`],
  ['4000 chars of ( in a q value', `https://www.google.com/maps?q=${'(a'.repeat(1900)}`],
  ['300 chars of numbers', '1 '.repeat(150)],
  ['many dots', '.'.repeat(MB)],
  ['many degree signs', '°'.repeat(MB)],
  ['many colons in a consent wrapper', `https://consent.google.com/m?continue=${':'.repeat(MB)}`],
];

describe('speed: hostile and huge inputs stay linear (a few ms), never throw', () => {
  for (const [name, text] of BIG) {
    it(name, () => {
      const t = ms(() => {
        const r = parseLocationText(text);
        expect(typeof r.ok).toBe('boolean');
        rememberableText(text);
        parseCoordinates(text);
      });
      expect(t, `${name}: ${t.toFixed(1)} ms`).toBeLessThan(250);
    });
  }

  it('scanMapsPage on a hostile 512 kB page is fast (every regex linear)', () => {
    const page = (s: string): string => s.slice(0, 600 * 1024);
    const bad: [string, string][] = [
      ['<link repeated', page('<link '.repeat(100000))],
      ['<meta repeated', page('<meta '.repeat(100000))],
      ['/maps/ repeated', page('/maps/'.repeat(100000))],
      ['http:// repeated', page('http://'.repeat(100000))],
      ['https://staticmap repeated', page('https://staticmap'.repeat(40000))],
      ['!3d repeated', page('!3d1!4d'.repeat(80000))],
      ['@ repeated', page('/maps/@1.000,1.000,'.repeat(30000))],
      ['one huge unclosed quote', `<link rel="canonical" href="${'a'.repeat(600 * 1024)}`],
    ];
    const slow: string[] = [];
    for (const [name, text] of bad) {
      const t = ms(() => scanMapsPage(text));
      if (t > 500) slow.push(`${name}: ${t.toFixed(0)} ms`);
    }
    expect(slow).toEqual([]);
  });
});

describe('short links are always asked for over https', () => {
  it('a pasted http:// short link is cleaned to https://', () => {
    for (const t of ['http://maps.app.goo.gl/AbCdEf123', 'HTTP://MAPS.APP.GOO.GL/AbCdEf123', 'http://goo.gl/maps/AbCdEf123']) {
      const r = parseLocationText(t);
      expect(r.ok === false && r.reason === 'short-link-needs-network' && r.url.startsWith('https://'), t).toBe(true);
    }
  });
});

describe('helpers', () => {
  it('isGoogleHost / isMapsShortLink are exact', () => {
    for (const h of ['google.com', 'www.google.com', 'maps.google.com.au', 'consent.google.de', 'www.google.co.uk']) expect(isGoogleHost(h), h).toBe(true);
    for (const h of ['google.com.evil.example', 'notgoogle.com', 'evilgoogle.co', 'google.evil', 'xgoogle.com', 'google.c', 'goo.gl', 'maps.app.goo.gl', 'google.com.']) expect(isGoogleHost(h), h).toBe(false);
    expect(isMapsShortLink('https://maps.app.goo.gl/abc')).toBe(true);
    expect(isMapsShortLink('https://maps.app.goo.gl.evil.example/abc')).toBe(false);
    expect(isMapsShortLink('https://goo.gl/maps/abc')).toBe(true);
    expect(isMapsShortLink('https://goo.gl/abc')).toBe(false);
    expect(isMapsShortLink('ftp://maps.app.goo.gl/abc')).toBe(false);
  });

  it('cleanPlaceName never returns markup-free surprises: it only trims, collapses and cuts', () => {
    expect(cleanPlaceName('  Mount Tomah \n Botanic  Garden ')).toBe('Mount Tomah Botanic Garden');
    expect(cleanPlaceName('<b>x</b>')).toBe('<b>x</b>'); // text stays text: the screen inserts it as a text node
    expect((cleanPlaceName('x'.repeat(500)) ?? '').length).toBeLessThanOrEqual(61);
  });
});
