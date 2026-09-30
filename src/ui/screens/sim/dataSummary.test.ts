import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatBytes, type DatasetRecord, type DatasetSummary } from '../../../core/datasets';
import { dataUsed } from './dataSummary';

const fixture = (name: string): { datasets: DatasetRecord[]; summary?: DatasetSummary } => JSON.parse(readFileSync(join(__dirname, '../../../../tests/fixtures/datasets', `${name}.json`), 'utf8'));

describe('Stats tab "Data used" summary', () => {
  it('reads every number from the inventory: count, bytes, memory, origin mix', () => {
    const f = fixture('katoomba-bundled');
    const d = dataUsed(f.datasets, f.summary)!;
    expect(d.count).toBe(f.summary?.totals.count ?? f.datasets.length);
    const t = f.summary!.totals;
    expect(d.local).toBe(formatBytes(t.transferredBytes - t.networkBytes));
    if (t.memoryBytes > 0) expect(d.memory).toBe(formatBytes(t.memoryBytes));
    const shares = d.origins.reduce((a, o) => a + o.share, 0);
    if (d.origins.length) expect(shares).toBeCloseTo(1, 2);
    for (const o of d.origins) expect(o.colour).not.toBe('info'); // data colours only, never the interactive blue
  });

  it('a bundled demo site downloads nothing and says so', () => {
    const f = fixture('katoomba-bundled');
    const d = dataUsed(f.datasets, f.summary)!;
    if (f.summary!.totals.networkBytes === 0) {
      expect(d.download).toBe('None');
      expect(d.downloadNote).toMatch(/Nothing was downloaded/);
    }
  });

  it('a live build whose wire size was not reported shows an honest upper bound ("up to …")', () => {
    const f = fixture('live-nondemo');
    const d = dataUsed(f.datasets, f.summary)!;
    const t = f.summary!.totals;
    if ((t.networkUnmeasuredBytes ?? 0) > 0) {
      expect(d.download).toBe(`up to ${formatBytes(t.networkBytes)}`);
      expect(d.downloadNote).toMatch(/this much or less/);
    } else expect(d.download).toBe(t.networkBytes > 0 ? formatBytes(t.networkBytes) : 'None');
  });

  it('lists the largest data sets first (at most five by default) and flags the substitutes', () => {
    const f = fixture('offline-synthetic');
    const d = dataUsed(f.datasets, f.summary)!;
    expect(d.rows.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < d.rows.length; i++) expect(d.rows[i - 1]!.bytes).toBeGreaterThanOrEqual(d.rows[i]!.bytes);
    expect(d.fallbacks.length).toBe((f.summary?.fallbacks ?? []).length);
  });

  it('is null for a scenario without an inventory', () => {
    expect(dataUsed(undefined, undefined)).toBeNull();
    expect(dataUsed([], undefined)).toBeNull();
  });
});
