/**
 * The imagery record describes the photo the view really shows: scenario/imagery.ts must pick the same site and crop as
 * ui/imagery.ts (which decodes the photo on the main thread), and nothing for places away from the demo sites.
 */
import { describe, expect, it } from 'vitest';
import { makeGridSpec } from '../core/grid';
import { DatasetLedger, DEMO_SITES, loadDemoImageryInfo } from '../data';
import { imageryCrop } from '../ui/imagery';
import { describeImagery, imageryCropFor } from './imagery';

describe('describeImagery', () => {
  it('matches the UI crop rule for every demo site, several extents and an off-centre domain', async () => {
    for (const s of DEMO_SITES) {
      const info = (await loadDemoImageryInfo(s.id))!;
      for (const [extent, dx] of [[9000, 0], [6000, 0], [3000, 1500], [6000, 2500]] as const) {
        const grid = makeGridSpec({ lat: s.centre.lat, lon: s.centre.lon + dx / (111_320 * Math.cos((s.centre.lat * Math.PI) / 180)) }, extent, 30);
        expect(imageryCropFor(info.meta, grid), `${s.id} ${extent} ${dx}`).toEqual(imageryCrop(info.meta, grid));
      }
    }
  });

  it('Katoomba: the whole bundled photo, its file sizes and capture text; a ledger entry for the details file', async () => {
    const ledger = new DatasetLedger();
    const grid = makeGridSpec({ lat: -33.715, lon: 150.285 }, 9000, 30);
    const im = (await describeImagery(grid, { demoSiteId: 'katoomba', ledger }))!;
    expect(im.siteId).toBe('katoomba');
    expect(im.jpgBytes).toBeGreaterThan(100_000);
    expect(im.capturedOn).toMatch(/^2026-09-2\d$/);
    expect(im.serviceCopyright).toMatch(/Department of Customer Service/);
    expect(im.drawnPx.w).toBeLessThanOrEqual(2048);
    expect(ledger.totals('imagery').bundledBytes).toBeGreaterThan(0);
  });

  it('none away from the demo sites', async () => {
    expect(await describeImagery(makeGridSpec({ lat: -34.4, lon: 150.0 }, 6000, 30), {})).toBeNull();
  });
});
