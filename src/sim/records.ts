/**
 * The simulation's timeline of user actions (spec §12.2 step 1, §12.4, §12.6): ignitions, fuel / wind edits, edit
 * removals, option changes and quality-tier changes are all *records* with a simulation time. Records are applied at
 * the start of the first atmosphere step whose time is ≥ the record time, in (time, insertion) order, so a rewind
 * followed by a re-run replays them bitwise identically.
 */
import type { FuelEdit, Ignition, QualityTier, ScenarioEdit, WindEdit } from '../core/types';
import type { SimOptionKey } from './protocol';

export type RecordBody =
  | { kind: 'ignite'; ignition: Ignition }
  | { kind: 'edit'; edit: ScenarioEdit }
  | { kind: 'removeEdit'; id: string }
  | { kind: 'option'; key: SimOptionKey; value: number | boolean }
  | { kind: 'quality'; tier: QualityTier };

export interface SimRecord {
  /** Insertion sequence number (tie-breaker at equal times, stable identity in checkpoints). */
  seq: number;
  /** Simulation time (s from the scenario start) from which the record applies. */
  time: number;
  body: RecordBody;
}

/** (time, seq) order. */
export const recordOrder = (a: SimRecord, b: SimRecord): number => a.time - b.time || a.seq - b.seq;

/**
 * Active edits after applying `applied` (record seqs in application order): an edit replaces an active edit with the
 * same id (moving to the end), a removal drops it. Returns the active fuel and wind edits in application order.
 */
export function activeEdits(records: ReadonlyMap<number, SimRecord>, applied: readonly number[]): { fuel: FuelEdit[]; wind: WindEdit[] } {
  const list: ScenarioEdit[] = [];
  for (const seq of applied) {
    const r = records.get(seq);
    if (!r) continue;
    const b = r.body;
    if (b.kind === 'edit') {
      const i = list.findIndex((e) => e.id === b.edit.id);
      if (i >= 0) list.splice(i, 1);
      list.push(b.edit);
    } else if (b.kind === 'removeEdit') {
      const i = list.findIndex((e) => e.id === b.id);
      if (i >= 0) list.splice(i, 1);
    }
  }
  const fuel: FuelEdit[] = [];
  const wind: WindEdit[] = [];
  for (const e of list) {
    if (e.kind === 'fuel') fuel.push(e);
    else wind.push(e);
  }
  return { fuel, wind };
}

/** The seqs of records that change the fuel map (fuel edits and removals of fuel edits), in application order. */
export function fuelSequence(records: ReadonlyMap<number, SimRecord>, applied: readonly number[]): number[] {
  const out: number[] = [];
  const kindOf = new Map<string, 'fuel' | 'wind'>();
  for (const seq of applied) {
    const r = records.get(seq);
    if (!r) continue;
    const b = r.body;
    if (b.kind === 'edit') {
      kindOf.set(b.edit.id, b.edit.kind);
      if (b.edit.kind === 'fuel') out.push(seq);
    } else if (b.kind === 'removeEdit' && kindOf.get(b.id) === 'fuel') out.push(seq);
  }
  return out;
}

export const sameSequence = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
