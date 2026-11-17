/**
 * T1.5 (b), (c): a pool of worker threads over one SharedArrayBuffer, the TypeScript counterpart of the C# `Parallel.For` forms of T1.4.
 *
 *  - The arena (`Arena`) is ONE SharedArrayBuffer that holds every array of a problem plus the control block of the pool; every thread builds typed-array views of it by name.
 *  - `Pool.par(job, n)` runs chunks 0..n-1 of registered job `job` on all threads: chunks are claimed dynamically (`Atomics.add` on a shared counter), the calling thread (the driver) takes part,
 *    and the call returns when every thread has finished (a full barrier: one `Atomics` counter). Helpers spin for `spinUs` microseconds waiting for the next region and then sleep in
 *    `Atomics.wait`; the driver wakes them with `Atomics.notify` only when some are asleep. Threads are created once (by the caller), never per call.
 *  - The same code runs in a Node `worker_threads` worker and in a browser Web Worker (no Node import here).
 *  - `threads = 1`: no helpers, the chunks run inline in order (the C# `Par(1)` shape).
 * A job is a closure `(chunk) => void` registered in the same order on every thread (the id is the registration index); what it needs besides its chunk number is in arrays of the arena
 * (a per-instance parameter block written by the driver before `par`; the barrier orders those writes).
 * Nothing here knows about the kernels.
 */

export type ChunkFn = (c: number) => void;

/** indexes into the control block (Int32Array in the arena) */
export const CTL_GEN = 0, CTL_DONE = 1, CTL_NEXT = 2, CTL_JOB = 3, CTL_NCH = 4, CTL_SLEEP = 5, CTL_DWAIT = 6, CTL_LEN = 16;
const EXIT_JOB = -1;

export type ArrayType = 'f32' | 'f64' | 'u8' | 'i32';
export interface ArenaEntry { name: string; type: ArrayType; length: number }
export interface ArenaTable { [name: string]: [ArrayType, number, number] } // type, byte offset, length
export type TypedAny = Float32Array | Float64Array | Uint8Array | Int32Array;

const CTOR = { f32: Float32Array, f64: Float64Array, u8: Uint8Array, i32: Int32Array } as const;
const SIZE = { f32: 4, f64: 8, u8: 1, i32: 4 } as const;

export interface Arena {
  sab: SharedArrayBuffer;
  table: ArenaTable;
}

/** Lays the arrays out one after the other, each at a multiple of 64 bytes (separate cache lines), in ONE SharedArrayBuffer. */
export function makeArena(entries: ArenaEntry[]): Arena {
  const table: ArenaTable = {};
  let off = 0;
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.name)) throw new Error(`arena: duplicate ${e.name}`);
    seen.add(e.name);
    off = (off + 63) & ~63;
    table[e.name] = [e.type, off, e.length];
    off += e.length * SIZE[e.type];
  }
  return { sab: new SharedArrayBuffer(Math.max(64, (off + 63) & ~63)), table };
}

/** views of every array of an arena, by name */
export function viewsOf(a: Arena): Record<string, TypedAny> {
  const v: Record<string, TypedAny> = {};
  for (const [name, [type, off, len]] of Object.entries(a.table)) v[name] = new CTOR[type](a.sab as unknown as ArrayBuffer, off, len);
  return v;
}

export interface PoolOptions {
  threads: number;
  /** microseconds a helper (and the driver at a barrier) spins before it sleeps */
  spinUs: number;
}

export class Pool {
  readonly threads: number;
  readonly spinUs: number;
  private readonly ctl: Int32Array;
  private readonly gen0: number;
  private jobs: ChunkFn[] = [];
  /** regions run and chunks run on this thread, for the report */
  regions = 0;

  constructor(ctl: Int32Array, opt: PoolOptions) {
    this.ctl = ctl;
    this.gen0 = Atomics.load(ctl, CTL_GEN); // set-up of every thread finishes before the first region (the caller waits for every 'ready')
    this.threads = opt.threads;
    this.spinUs = opt.spinUs;
  }

  /** registers a job; the id is the same on every thread because every thread registers in the same order */
  register(fn: ChunkFn): number {
    this.jobs.push(fn);
    return this.jobs.length - 1;
  }

  /** Driver: run chunks 0..n-1 of `job` on all threads and return when all are done. */
  par(job: number, n: number): void {
    const f = this.jobs[job]!;
    if (this.threads === 1 || n < 2) {
      for (let c = 0; c < n; c++) f(c);
      return;
    }
    const ctl = this.ctl;
    this.regions++;
    Atomics.store(ctl, CTL_NEXT, 0);
    Atomics.store(ctl, CTL_DONE, 0);
    Atomics.store(ctl, CTL_JOB, job);
    Atomics.store(ctl, CTL_NCH, n);
    Atomics.add(ctl, CTL_GEN, 1);
    if (Atomics.load(ctl, CTL_SLEEP) > 0) Atomics.notify(ctl, CTL_GEN);
    for (;;) {
      const c = Atomics.add(ctl, CTL_NEXT, 1);
      if (c >= n) break;
      f(c);
    }
    this.waitDone();
  }

  private waitDone(): void {
    const ctl = this.ctl;
    const want = this.threads - 1;
    const t0 = performance.now();
    let i = 0;
    for (;;) {
      const d = Atomics.load(ctl, CTL_DONE);
      if (d >= want) return;
      if ((++i & 127) === 0 && performance.now() - t0 > this.spinUs) {
        if (performance.now() - t0 > 60000) throw new Error('pool: a helper did not reach the barrier within 60 s');
        Atomics.store(ctl, CTL_DWAIT, 1);
        if (Atomics.load(ctl, CTL_DONE) < want) Atomics.wait(ctl, CTL_DONE, d, 20);
        Atomics.store(ctl, CTL_DWAIT, 0);
      }
    }
  }

  /** Driver: tell the helpers to leave their loop (after the last region of a problem). */
  shutdown(): void {
    if (this.threads === 1) return;
    const ctl = this.ctl;
    Atomics.store(ctl, CTL_DONE, 0);
    Atomics.store(ctl, CTL_JOB, EXIT_JOB);
    Atomics.add(ctl, CTL_GEN, 1);
    Atomics.notify(ctl, CTL_GEN);
    this.waitDone();
  }

  /** Helper: serve regions until the driver shuts the pool down. Blocks the thread. */
  serve(): void {
    const ctl = this.ctl;
    const want = this.threads - 2; // the value of DONE before the last helper's increment
    // the generation at set-up, not at the moment this loop starts: the driver may already have begun its first region (found when a timed run hung in its first kernel)
    let seen = this.gen0;
    for (;;) {
      // wait for a new generation: spin, then sleep
      const t0 = performance.now();
      let i = 0;
      for (;;) {
        if (Atomics.load(ctl, CTL_GEN) !== seen) break;
        if ((++i & 127) === 0 && performance.now() - t0 > this.spinUs) {
          Atomics.add(ctl, CTL_SLEEP, 1);
          if (Atomics.load(ctl, CTL_GEN) === seen) Atomics.wait(ctl, CTL_GEN, seen, 100);
          Atomics.sub(ctl, CTL_SLEEP, 1);
          i = 0;
          if (Atomics.load(ctl, CTL_GEN) !== seen) break;
          // after a sleep go on spinning for a shorter time before the next sleep
        }
      }
      seen = Atomics.load(ctl, CTL_GEN);
      const job = Atomics.load(ctl, CTL_JOB);
      if (job !== EXIT_JOB) {
        const n = Atomics.load(ctl, CTL_NCH);
        const f = this.jobs[job]!;
        for (;;) {
          const c = Atomics.add(ctl, CTL_NEXT, 1);
          if (c >= n) break;
          f(c);
        }
      }
      const prev = Atomics.add(ctl, CTL_DONE, 1);
      if (prev === want && Atomics.load(ctl, CTL_DWAIT) === 1) Atomics.notify(ctl, CTL_DONE);
      if (job === EXIT_JOB) return;
    }
  }
}
