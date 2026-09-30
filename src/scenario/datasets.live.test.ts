/**
 * ONE real scenario build against the live services for a place that is not a demo site (Bilpin, -33.52 150.42, a
 * semi-rural village in the Blue Mountains foothills, 6 km at 30 m, weather "now"), to check the data-set records
 * with real bytes and to compare them with the Setup estimates (scenario/estimate.ts). Skipped unless NET=1 (behind a
 * proxy also NODE_USE_ENV_PROXY=1):
 *
 *   NET=1 NODE_USE_ENV_PROXY=1 npx vitest run src/scenario/datasets.live.test.ts
 *
 * With WRITE_FIXTURES=1 it (re)writes tests/fixtures/datasets/live-nondemo.json, the UI builders' mock data.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { datasetsToJson, formatBytes } from '../core/datasets';
import { createMemoryKV, resetHttpConfig, setDefaultCache } from '../data';
import { buildScenario } from './build';
import { estimateScenarioData } from './estimate';
import type { ScenarioRequest } from './request';

const BILPIN = { lat: -33.52, lon: 150.42 };
const OUT = fileURLToPath(new URL('../../tests/fixtures/datasets/', import.meta.url));

describe.skipIf(!process.env.NET)('live scenario build (NET=1)', () => {
  it('Bilpin, 6 km, weather now: every data set measured, estimates within range', { timeout: 600_000 }, async () => {
    resetHttpConfig();
    const kv = createMemoryKV();
    setDefaultCache(kv);
    const req: ScenarioRequest = { name: 'Bilpin (live test)', centre: BILPIN, extent: 6000, weather: { kind: 'now' }, duration: 4 * 3600, online: true };
    const plan = await estimateScenarioData(req, { kv });
    const t0 = Date.now();
    const s = await buildScenario(req);
    const secs = (Date.now() - t0) / 1000;
    const ds = s.datasets!;
    expect(ds.length).toBeGreaterThan(10);
    const lines: string[] = [];
    for (const r of ds) {
      const p = plan.find((x) => x.id === r.id);
      const est = p?.plan ? `${formatBytes(p.plan.lowBytes)}-${formatBytes(p.plan.highBytes)}` : '-';
      lines.push(`${r.id.padEnd(16)} ${r.status.padEnd(11)} ${r.origin.padEnd(9)} net ${formatBytes(r.sizes.networkBytes).padStart(9)} uncompressed ${formatBytes(r.sizes.networkDecodedBytes ?? r.sizes.networkBytes).padStart(9)}${r.sizes.networkUnmeasuredBytes ? ' (wire size not reported)' : ''} all ${formatBytes(r.sizes.transferredBytes).padStart(9)} req ${String(r.sizes.requests).padStart(3)}  estimate ${est}`);
    }
    const report = `Bilpin live build ${secs.toFixed(1)} s, ${formatBytes(s.datasetSummary!.totals.networkBytes)} over the network\n${lines.join('\n')}`;
    console.log(report);
    if (process.env.LIVE_REPORT) writeFileSync(process.env.LIVE_REPORT, report);
    const terrain = ds.find((r) => r.id === 'terrain')!;
    expect(terrain.origin).toBe('live');
    expect(terrain.sizes.networkBytes).toBeGreaterThan(100_000);
    // The estimate of each downloaded data set brackets the real bytes within a factor of 3 either way.
    for (const r of ds) {
      const p = plan.find((x) => x.id === r.id)?.plan;
      // Plans are uncompressed sizes: compare with what the answers decompressed to.
      const got = r.sizes.networkDecodedBytes ?? r.sizes.networkBytes;
      if (!p || got < 20_000) continue;
      expect(got, `${r.id}`).toBeGreaterThan(p.lowBytes / 3);
      expect(got, `${r.id}`).toBeLessThan(p.highBytes * 3);
    }
    if (process.env.WRITE_FIXTURES) {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(`${OUT}live-nondemo.json`, datasetsToJson(ds, s.datasetSummary));
      writeFileSync(`${OUT}live-nondemo.plan.json`, datasetsToJson(plan));
    }
    setDefaultCache(null);
  });
});
