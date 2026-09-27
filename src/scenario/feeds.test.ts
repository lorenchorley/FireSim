/** Live context feeds (spec §11.7, doc 08b §8–9): RFS incidents, fire danger / bans, DEA hotspots. */
import { afterEach, describe, expect, it } from 'vitest';
import { districtFor, hotspotsUrl, incidentsNear, loadLiveContext, officialRatingChip, parseFdrToban, parseHotspots, parseMajorIncidents, parseRfsDescription, parseRfsPubDate } from './feeds';
import { fixture, fixtureText, withFakeNetwork } from './testing';

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

describe('RFS major incidents', () => {
  const inc = parseMajorIncidents(fixture('rfs-majorIncidents.json'));
  it('parses all 64 features: categories 31 Advice / 12 Planned Burn / 21 Not Applicable', () => {
    expect(inc).toHaveLength(64);
    const c: Record<string, number> = {};
    for (const i of inc) c[i.alertLevel] = (c[i.alertLevel] ?? 0) + 1;
    expect(c).toEqual({ Advice: 31, 'Planned Burn': 12, 'Not Applicable': 21 });
  });
  it('GeometryCollection → Point location + polygon rings; Point-only → no rings (43 / 21)', () => {
    expect(inc.filter((i) => i.rings?.length).length).toBe(43);
    for (const i of inc) {
      expect(i.location.lat).toBeLessThan(-27);
      expect(i.location.lat).toBeGreaterThan(-38);
      expect(i.location.lon).toBeGreaterThan(140);
      expect(Number.isFinite(i.updated)).toBe(true);
    }
  });
  it('the Texas grass fire: status, size, updated from the local pubDate', () => {
    const t = inc.find((i) => i.title === 'BRUXNER HWY, TEXAS')!;
    expect(t.status).toBe('Under control');
    expect(t.sizeHa).toBe(0);
    expect(t.id).toBe('679643');
    expect(t.updated).toBe(Date.UTC(2026, 8, 26, 23, 1)); // 27/09/2026 9:01 AM AEST
    expect(t.description).toContain('Grass Fire');
  });
  it('pubDate parsing (AM/PM, DST-aware Sydney civil time) and description fields', () => {
    expect(parseRfsPubDate('27/09/2026 7:01:00 AM')).toBe(Date.UTC(2026, 8, 26, 21, 1));
    expect(parseRfsPubDate('01/01/2020 12:30:00 PM')).toBe(Date.UTC(2020, 0, 1, 1, 30)); // AEDT +11
    expect(parseRfsPubDate('01/01/2020 12:30:00 AM')).toBe(Date.UTC(2019, 11, 31, 13, 30));
    expect(Number.isNaN(parseRfsPubDate('yesterday'))).toBe(true);
    const d = parseRfsDescription('ALERT LEVEL: Advice <br />STATUS: Under control <br />SIZE: 67 ha <br />UPDATED: 27 Sep 2026 17:01');
    expect(d).toMatchObject({ 'ALERT LEVEL': 'Advice', STATUS: 'Under control', SIZE: '67 ha', UPDATED: '27 Sep 2026 17:01' });
  });
  it('incidentsNear sorts by distance and filters by radius', () => {
    const c = { lat: -33.715, lon: 150.285 };
    const near = incidentsNear(inc, c, 300_000);
    expect(near.length).toBeGreaterThan(0);
    expect(near.length).toBeLessThan(inc.length);
    expect(incidentsNear(inc, c, 1)).toHaveLength(0);
  });
});

describe('RFS fire danger ratings / fire bans', () => {
  const d = parseFdrToban(fixtureText('rfs-fdrToban.xml'));
  it('parses districts with councils, levels and bans', () => {
    expect(d.length).toBeGreaterThanOrEqual(20);
    expect(d[0]).toMatchObject({ name: 'Far North Coast', regionNumber: 1, dangerLevelToday: 'MODERATE', fireBanToday: false });
    expect(d[0]!.councils).toContain('Byron');
  });
  it('Blue Mountains council → Greater Sydney Region; name hint fallback; chip text', () => {
    const b = districtFor(d, 'Blue Mountains')!;
    expect(b.name).toBe('Greater Sydney Region');
    expect(districtFor(d, undefined, 'greater hunter')!.name).toBe('Greater Hunter');
    expect(districtFor(d, 'Nowhere Shire')).toBeUndefined();
    expect(officialRatingChip(b)).toMatch(/^Official rating today: [A-Z][a-z]+/);
    for (const c of ['Oberon', 'Snowy Monaro', 'Lithgow', 'Shoalhaven', 'Mid-Coast', 'Warrumbungle']) expect(districtFor(d, c), c).toBeDefined();
  });
});

describe('DEA hotspots', () => {
  it('parses 200 features with time, power, confidence, satellite and age', () => {
    const h = parseHotspots(fixture('dea-hotspots-sample.json'));
    expect(h).toHaveLength(200);
    expect(h[0]).toMatchObject({ satellite: 'HIMAWARI-9', power: 49.6, confidence: 100, location: { lat: -33.127, lon: 151.499 } });
    expect(h[0]!.time).toBe(Date.parse('2026-09-25T02:18:31Z'));
    expect(h[0]!.hoursSince).toBeCloseTo(55.6, 1);
  });
  it('bbox in lon,lat order with the EPSG:4326 suffix (doc 08b §9 gotcha)', () => {
    const u = hotspotsUrl([149.5, -34.2, 151.0, -33.2]);
    expect(u).toContain('typeName=public:hotspots_three_days');
    expect(u).toContain('bbox=149.5000,-34.2000,151.0000,-33.2000,EPSG:4326');
    expect(u).toContain('outputFormat=application/json');
  });
});

describe('loadLiveContext', () => {
  it('fetches the three feeds (fake network) and picks the site district', async () => {
    const n = withFakeNetwork([
      { match: ['majorIncidents.json'], body: fixture('rfs-majorIncidents.json') },
      { match: ['fdrToban.xml'], text: fixtureText('rfs-fdrToban.xml') },
      { match: ['hotspots.dea.ga.gov.au'], body: fixture('dea-hotspots-sample.json') },
    ]);
    restore = n.restore;
    const ctx = await loadLiveContext({ centre: { lat: -33.715, lon: 150.285 }, demoSiteId: 'katoomba', radiusM: 300_000 });
    expect(ctx.warnings).toEqual([]);
    expect(ctx.district!.name).toBe('Greater Sydney Region');
    expect(ctx.officialRating).toContain('Official rating today');
    expect(ctx.incidents.length).toBeGreaterThan(0);
    expect(ctx.hotspots).toHaveLength(200);
    expect(n.calls.some((u) => u.startsWith('https://www.rfs.nsw.gov.au/feeds/majorIncidents.json'))).toBe(true);
  });
  it('never throws when offline: empty context with warnings', async () => {
    const n = withFakeNetwork([]);
    restore = n.restore;
    const ctx = await loadLiveContext({ centre: { lat: -33.715, lon: 150.285 } });
    expect(ctx.incidents).toEqual([]);
    expect(ctx.hotspots).toEqual([]);
    expect(ctx.officialRating).toBeNull();
    expect(ctx.warnings).toHaveLength(3);
  });
});
