/**
 * Minimal observable state container used by the UI (no framework).
 * Subscribers are called synchronously after every `set` that changes at least one of the keys they watch
 * (shallow `Object.is` comparison per key).
 */
export type Listener<T> = (state: Readonly<T>, prev: Readonly<T>) => void;

export class Store<T extends object> {
  private state: T;
  private readonly listeners = new Set<{ fn: Listener<T>; keys: readonly (keyof T)[] | null }>();

  constructor(initial: T) {
    this.state = { ...initial };
  }

  get(): Readonly<T> {
    return this.state;
  }

  /** Merge a patch (or the result of an updater) into the state and notify affected subscribers. */
  set(patch: Partial<T> | ((s: Readonly<T>) => Partial<T>)): void {
    const p = typeof patch === 'function' ? patch(this.state) : patch;
    const prev = this.state;
    let changed = false;
    for (const k of Object.keys(p) as (keyof T)[]) {
      if (!Object.is(prev[k], p[k])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.state = { ...prev, ...p };
    for (const l of [...this.listeners]) {
      if (l.keys === null || l.keys.some((k) => !Object.is(prev[k], this.state[k]))) l.fn(this.state, prev);
    }
  }

  /** Subscribe to changes (optionally only of some keys). Returns an unsubscribe function. */
  subscribe(fn: Listener<T>, keys?: readonly (keyof T)[]): () => void {
    const entry = { fn, keys: keys ?? null };
    this.listeners.add(entry);
    return () => this.listeners.delete(entry);
  }
}

/** A typed event emitter. */
export class Emitter<E extends { [K in keyof E]: (...args: never[]) => void }> {
  private readonly map = new Map<keyof E, Set<E[keyof E]>>();

  on<K extends keyof E>(event: K, cb: E[K]): () => void {
    let set = this.map.get(event);
    if (!set) {
      set = new Set();
      this.map.set(event, set);
    }
    set.add(cb);
    return () => set.delete(cb);
  }

  emit<K extends keyof E>(event: K, ...args: Parameters<E[K]>): void {
    const set = this.map.get(event);
    if (!set) return;
    for (const cb of [...set]) (cb as (...a: Parameters<E[K]>) => void)(...args);
  }

  clear(): void {
    this.map.clear();
  }
}
