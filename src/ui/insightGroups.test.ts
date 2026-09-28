import { describe, expect, it } from 'vitest';
import type { Insight } from '../core/types';
import { DangerGate, groupInsights } from './insightGroups';

const card = (id: string, kind: string, time: number, severity: Insight['severity'] = 'watch'): Insight =>
  ({ id, kind, time, severity, x: 0, y: 0, title: id, body: '', factors: [] }) as unknown as Insight;

describe('groupInsights', () => {
  it('keeps one card per kind: the newest of the most severe, with the count and time span', () => {
    const g = groupInsights([card('a1', 'junction-zone', 600), card('b1', 'crown-fire', 900, 'danger'), card('a2', 'junction-zone', 1200, 'danger'), card('a3', 'junction-zone', 1800)]);
    expect(g.map((x) => x.kind)).toEqual(['junction-zone', 'crown-fire']);
    expect(g[0]!.lead.id).toBe('a2');
    expect(g[0]!.count).toBe(3);
    expect([g[0]!.first, g[0]!.last]).toEqual([600, 1800]);
    expect(g[1]!.count).toBe(1);
  });
});

describe('DangerGate', () => {
  it('toasts a kind at most once per hour and pauses only the first time; a rewind forgets later decisions', () => {
    const d = new DangerGate(3600);
    expect(d.decide(card('x', 'crown-fire', 100, 'watch'))).toEqual({ toast: false, pause: false });
    expect(d.decide(card('a', 'crown-fire', 600, 'danger'))).toEqual({ toast: true, pause: true });
    expect(d.decide(card('b', 'crown-fire', 1200, 'danger'))).toEqual({ toast: false, pause: false });
    expect(d.decide(card('c', 'junction-zone', 1300, 'danger'))).toEqual({ toast: true, pause: true });
    expect(d.decide(card('e', 'crown-fire', 4300, 'danger'))).toEqual({ toast: true, pause: false });
    d.reset(500);
    expect(d.decide(card('f', 'crown-fire', 700, 'danger'))).toEqual({ toast: true, pause: true });
  });
});
