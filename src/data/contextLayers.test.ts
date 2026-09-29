import { describe, expect, it } from 'vitest';
import { LocalProjection } from '../core/geo';
import { DEMO_SITES } from './demoSites';
import { decodeContext, decodeLine, demoSiteCovering, loadBundledContext, roadLengthByClass, type ContextFileV1 } from './contextLayers';

const kat = DEMO_SITES.find((s) => s.id === 'katoomba')!;

describe('decodeLine', () => {
  it('reads delta-coded 1e-5° integers and projects to local metres', () => {
    const proj = new LocalProjection({ lat: -33.715, lon: 150.285 });
    // (150.28500, -33.71500) then +0.001° east and +0.001° north.
    const { xy, lengthM } = decodeLine([15028500, -3371500, 100, 100], proj);
    expect(xy[0]).toBeCloseTo(0, 3);
    expect(xy[1]).toBeCloseTo(0, 3);
    expect(xy[2]).toBeCloseTo(92.4, 0); // 0.001° of longitude at 33.7° S
    expect(xy[3]).toBeCloseTo(111.2, 0);
    expect(lengthM).toBeCloseTo(Math.hypot(xy[2]!, xy[3]!), 3);
  });
});

describe('bundled Katoomba context', () => {
  it('loads, is projected about the site centre and is plausible', async () => {
    const c = await loadBundledContext('katoomba', kat.centre);
    expect(c).not.toBeNull();
    expect(c!.roads.length).toBeGreaterThan(1500);
    expect(c!.fireTrails.length).toBeGreaterThan(50);
    expect(c!.homes.length / 2).toBeGreaterThan(5000);
    expect(c!.zones.some((z) => z.kind === 'residential')).toBe(true);
    expect(c!.places.map((p) => p.name)).toContain('Leura');
    expect(c!.sources.map((s) => s.id).sort()).toEqual(['fireTrails', 'homes', 'places', 'roads', 'zones']);
    // Everything lies near the 9 km square around the centre (+ margin).
    const lim = 4500 + 600;
    for (const r of c!.roads) for (let i = 0; i < r.xy.length; i += 2) {
      // A long road may leave the box; its vertices near the box edge are within the fetched envelope's reach.
      expect(Math.abs(r.xy[i]!)).toBeLessThan(lim + 20000);
    }
    for (let i = 0; i < c!.homes.length; i += 2) {
      expect(Math.abs(c!.homes[i]!)).toBeLessThan(lim);
      expect(Math.abs(c!.homes[i + 1]!)).toBeLessThan(lim);
    }
    const len = roadLengthByClass(c!);
    expect(len.local).toBeGreaterThan(20_000);
    expect(len.track + len.path).toBeGreaterThan(5_000);
    expect(c!.roads.filter((r) => r.name === 'Megalong Road').length).toBeGreaterThan(0);
  });

  it('the Great Western Highway is a primary/arterial road passing through Katoomba town', async () => {
    const c = (await loadBundledContext('katoomba', kat.centre))!;
    const main = c.roads.filter((r) => /highway/i.test(r.name ?? '') && (r.cls === 'primary' || r.cls === 'arterial' || r.cls === 'motorway'));
    expect(main.length).toBeGreaterThan(0);
    expect(main.reduce((a, r) => a + r.lengthM, 0)).toBeGreaterThan(3000);
  });

  it('every demo site has a valid file', async () => {
    for (const s of DEMO_SITES) {
      const c = await loadBundledContext(s.id, s.centre);
      expect(c, s.id).not.toBeNull();
      expect(c!.roads.length, s.id).toBeGreaterThan(0);
      expect(c!.sources.length).toBe(5);
    }
  });
});

describe('demoSiteCovering', () => {
  it('finds the site for a domain inside its square and rejects a domain that sticks out', () => {
    expect(demoSiteCovering(kat.centre, 6000)).toBe('katoomba');
    expect(demoSiteCovering({ lat: -33.715, lon: 150.4 }, 6000)).toBeNull();
    expect(demoSiteCovering(kat.centre, 12000)).toBeNull();
  });
});

describe('decodeContext', () => {
  it('rejects unknown versions', () => {
    expect(() => decodeContext({ version: 2 } as unknown as ContextFileV1, kat.centre)).toThrow(/version/);
  });
});
