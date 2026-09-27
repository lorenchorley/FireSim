/**
 * Compact checkpoints of the per-cell state (spec docs/research/00-synthesis.md §7.13, §12.4: 9 checkpoints of
 * ≈ 8 MB must fit the worker's memory budget).
 *
 * Most fire arrays only ever change on cells that have been in the narrow band ("touched" cells); those are stored
 * packed at the touched indices and restored by resetting to their default and scattering. Arrays that can change
 * anywhere (masks, the moisture cache, the burn state) are copied in full. All copies are typed arrays, so a
 * checkpoint is structured-clone / transfer safe.
 */

export type CellArray = Float32Array | Float64Array | Int32Array | Uint8Array | Uint16Array;

interface Entry {
  name: string;
  arr: CellArray;
  /** Default value for 'touched' arrays (ignored for 'full'). */
  def: number;
  full: boolean;
}

export interface PackedState {
  touched: Int32Array;
  arrays: Record<string, CellArray>;
}

export class StateRegistry {
  private readonly entries: Entry[] = [];

  /** Register a per-cell array stored at touched cells only, reset to `def` elsewhere. */
  touched<T extends CellArray>(name: string, arr: T, def: number): T {
    this.entries.push({ name, arr, def, full: false });
    return arr;
  }

  /** Register a per-cell array copied in full. */
  full<T extends CellArray>(name: string, arr: T): T {
    this.entries.push({ name, arr, def: 0, full: true });
    return arr;
  }

  pack(touchedFlags: Uint8Array): PackedState {
    let count = 0;
    for (let k = 0; k < touchedFlags.length; k++) if (touchedFlags[k] !== 0) count++;
    const idx = new Int32Array(count);
    count = 0;
    for (let k = 0; k < touchedFlags.length; k++) if (touchedFlags[k] !== 0) idx[count++] = k;
    const arrays: Record<string, CellArray> = {};
    for (const e of this.entries) {
      if (e.full) {
        arrays[e.name] = e.arr.slice();
        continue;
      }
      const Ctor = e.arr.constructor as new (n: number) => CellArray;
      const out = new Ctor(count);
      for (let a = 0; a < count; a++) out[a] = e.arr[idx[a]!]!;
      arrays[e.name] = out;
    }
    return { touched: idx, arrays };
  }

  unpack(s: PackedState, touchedFlags: Uint8Array): void {
    touchedFlags.fill(0);
    const idx = s.touched;
    for (let a = 0; a < idx.length; a++) touchedFlags[idx[a]!] = 1;
    for (const e of this.entries) {
      const src = s.arrays[e.name];
      if (!src) throw new Error(`fire checkpoint: missing array ${e.name}`);
      if (e.full) {
        e.arr.set(src as never);
        continue;
      }
      e.arr.fill(e.def);
      for (let a = 0; a < idx.length; a++) e.arr[idx[a]!] = src[a]!;
    }
  }
}
