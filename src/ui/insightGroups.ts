/**
 * Grouping of repeated insight cards. A large fire re-reports the same phenomenon (a junction zone, a crown fire, a
 * lee eddy…) on many parts of its edge — hundreds of cards over a 6-hour run. The UI shows one card per kind (the
 * newest of the most severe instances) with a count and puts one marker per kind on the map. Nothing ever pops up over
 * the map: new cards only raise a badge on the dock ({@link UnseenTracker}); the opt-in "pause on danger" and
 * "vibrate" settings use {@link DangerGate}. Pure and unit-tested.
 */
import type { Insight } from '../core/types';

export interface InsightGroup {
  kind: Insight['kind'];
  /** The card shown: the newest instance of the most severe level seen. */
  lead: Insight;
  /** Instances in the group (≥ 1). */
  count: number;
  /** Time (s) of the first and the newest instance. */
  first: number;
  last: number;
}

const RANK: Record<Insight['severity'], number> = { info: 0, watch: 1, danger: 2 };

/** Group insights by kind; groups sorted newest activity first. */
export function groupInsights(list: readonly Insight[]): InsightGroup[] {
  const by = new Map<string, InsightGroup>();
  for (const i of list) {
    const g = by.get(i.kind);
    if (!g) {
      by.set(i.kind, { kind: i.kind, lead: i, count: 1, first: i.time, last: i.time });
      continue;
    }
    g.count++;
    g.first = Math.min(g.first, i.time);
    g.last = Math.max(g.last, i.time);
    const r = RANK[i.severity] - RANK[g.lead.severity];
    if (r > 0 || (r === 0 && i.time >= g.lead.time)) g.lead = i;
  }
  return [...by.values()].sort((a, b) => b.last - a.last || RANK[b.lead.severity] - RANK[a.lead.severity]);
}

/**
 * Decides which newly revealed Danger cards trigger the opt-in reactions: `notify` (vibration, when the user turned
 * haptics on) when the kind has not notified in the last `gapS` simulated seconds, `pause` (when the user turned on
 * "pause on danger") only the first time a kind is dangerous. `reset(t)` forgets decisions after t (rewind).
 */
export class DangerGate {
  private readonly notified = new Map<string, number>();
  private readonly paused = new Map<string, number>();

  constructor(private readonly gapS = 3600) {}

  /** What to do for a revealed insight. */
  decide(i: Pick<Insight, 'kind' | 'severity' | 'time'>): { notify: boolean; pause: boolean } {
    if (i.severity !== 'danger') return { notify: false, pause: false };
    const last = this.notified.get(i.kind);
    const notify = last === undefined || i.time - last >= this.gapS || i.time < last;
    if (notify) this.notified.set(i.kind, i.time);
    const pause = !this.paused.has(i.kind);
    if (pause) this.paused.set(i.kind, i.time);
    return { notify, pause };
  }

  /** Forget decisions made for insights after `t` (the run was rewound). */
  reset(t: number): void {
    for (const m of [this.notified, this.paused]) for (const [k, v] of m) if (v > t) m.delete(k);
  }
}

/**
 * The quiet "new cards" indicator: which revealed cards the user has not looked at since they last opened the Insights
 * tab. Cards are counted the way the tab lists them (one per kind), so a fire reporting the same junction zone along
 * its whole edge is one new card, not hundreds. `viewTime` limits the count to cards the clock has reached (scrubbing
 * back hides the later ones again). Pure and unit-tested.
 */
export class UnseenTracker {
  private entries: { id: string; kind: string; time: number; danger: boolean }[] = [];
  private readonly ids = new Set<string>();

  /** Record a revealed card; false when it was already recorded. */
  add(i: Pick<Insight, 'id' | 'kind' | 'severity' | 'time'>): boolean {
    if (this.ids.has(i.id)) return false;
    this.ids.add(i.id);
    this.entries.push({ id: i.id, kind: i.kind, time: i.time, danger: i.severity === 'danger' });
    if (this.entries.length > 5000) {
      const drop = this.entries.splice(0, this.entries.length - 5000);
      for (const d of drop) this.ids.delete(d.id);
    }
    return true;
  }

  /** New cards (distinct kinds) up to `viewTime`. */
  count(viewTime = Infinity): number {
    const kinds = new Set<string>();
    for (const e of this.entries) if (e.time <= viewTime + 1) kinds.add(e.kind);
    return kinds.size;
  }

  /** New Danger cards (distinct kinds) up to `viewTime`. */
  dangerCount(viewTime = Infinity): number {
    const kinds = new Set<string>();
    for (const e of this.entries) if (e.danger && e.time <= viewTime + 1) kinds.add(e.kind);
    return kinds.size;
  }

  /** The user looked at the Insights tab: everything so far is seen. */
  markSeen(): void {
    this.entries = [];
    this.ids.clear();
  }

  /** Forget cards after `t` (the run was rewound and they will be recomputed). */
  reset(t: number): void {
    this.entries = this.entries.filter((e) => e.time <= t);
    this.ids.clear();
    for (const e of this.entries) this.ids.add(e.id);
  }
}
