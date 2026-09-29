import { describe, expect, it } from 'vitest';
import type { Insight } from '../core/types';
import { DangerGate, groupInsights, UnseenTracker } from './insightGroups';

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
  it('notifies a kind at most once per hour and pauses only the first time; a rewind forgets later decisions', () => {
    const d = new DangerGate(3600);
    expect(d.decide(card('x', 'crown-fire', 100, 'watch'))).toEqual({ notify: false, pause: false });
    expect(d.decide(card('a', 'crown-fire', 600, 'danger'))).toEqual({ notify: true, pause: true });
    expect(d.decide(card('b', 'crown-fire', 1200, 'danger'))).toEqual({ notify: false, pause: false });
    expect(d.decide(card('c', 'junction-zone', 1300, 'danger'))).toEqual({ notify: true, pause: true });
    expect(d.decide(card('e', 'crown-fire', 4300, 'danger'))).toEqual({ notify: true, pause: false });
    d.reset(500);
    expect(d.decide(card('f', 'crown-fire', 700, 'danger'))).toEqual({ notify: true, pause: true });
  });
});

describe('UnseenTracker (the dock badge)', () => {
  it('counts revealed cards the way the Insights tab groups them: one per kind', () => {
    const u = new UnseenTracker();
    expect(u.count()).toBe(0);
    for (const c of [card('a1', 'junction-zone', 600), card('a2', 'junction-zone', 900), card('b1', 'crown-fire', 1200, 'info')]) expect(u.add(c)).toBe(true);
    expect(u.add(card('a1', 'junction-zone', 600))).toBe(false); // the same card is never counted twice
    expect(u.count()).toBe(2);
    expect(u.dangerCount()).toBe(0);
  });

  it('flags unseen Danger cards (per kind) so the badge can turn red', () => {
    const u = new UnseenTracker();
    u.add(card('a', 'crown-fire', 600, 'danger'));
    u.add(card('b', 'crown-fire', 900, 'danger'));
    u.add(card('c', 'lee-eddy', 1000, 'watch'));
    expect(u.count()).toBe(2);
    expect(u.dangerCount()).toBe(1);
  });

  it('is cleared by opening the Insights tab, and counts only new cards afterwards', () => {
    const u = new UnseenTracker();
    u.add(card('a', 'crown-fire', 600, 'danger'));
    u.markSeen();
    expect([u.count(), u.dangerCount()]).toEqual([0, 0]);
    u.add(card('b', 'lee-eddy', 700));
    expect([u.count(), u.dangerCount()]).toEqual([1, 0]);
  });

  it('follows the view time: scrubbing back hides cards the clock has not reached; a rewind forgets later ones', () => {
    const u = new UnseenTracker();
    u.add(card('a', 'crown-fire', 600, 'danger'));
    u.add(card('b', 'lee-eddy', 1800));
    expect(u.count(1000)).toBe(1);
    expect(u.dangerCount(300)).toBe(0);
    expect(u.count(1800)).toBe(2);
    u.reset(1000);
    expect(u.count()).toBe(1);
    expect(u.add(card('b', 'lee-eddy', 1800))).toBe(true); // recomputed after the rewind
    expect(u.count()).toBe(2);
  });
});
