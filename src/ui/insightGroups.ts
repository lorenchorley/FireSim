/**
 * Grouping of repeated insight cards. A large fire re-reports the same phenomenon (a junction zone, a crown fire, a
 * lee eddy…) on many parts of its edge — hundreds of cards over a 6-hour run. The UI shows one card per kind (the
 * newest of the most severe instances) with a count, puts one marker per kind on the map, and only interrupts the
 * user (danger toast, pause on danger) the first time a kind turns dangerous. Pure and unit-tested.
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
 * Decides which newly revealed Danger cards interrupt the user: a toast when the kind has not been toasted in the
 * last `toastGapS` simulated seconds, a pause only the first time a kind is dangerous. `reset(t)` forgets decisions
 * after t (rewind).
 */
export class DangerGate {
  private readonly toasted = new Map<string, number>();
  private readonly paused = new Map<string, number>();

  constructor(private readonly toastGapS = 3600) {}

  /** What to do for a revealed insight. */
  decide(i: Pick<Insight, 'kind' | 'severity' | 'time'>): { toast: boolean; pause: boolean } {
    if (i.severity !== 'danger') return { toast: false, pause: false };
    const lastToast = this.toasted.get(i.kind);
    const toast = lastToast === undefined || i.time - lastToast >= this.toastGapS || i.time < lastToast;
    if (toast) this.toasted.set(i.kind, i.time);
    const pause = !this.paused.has(i.kind);
    if (pause) this.paused.set(i.kind, i.time);
    return { toast, pause };
  }

  /** Forget decisions made for insights after `t` (the run was rewound). */
  reset(t: number): void {
    for (const m of [this.toasted, this.paused]) for (const [k, v] of m) if (v > t) m.delete(k);
  }
}
