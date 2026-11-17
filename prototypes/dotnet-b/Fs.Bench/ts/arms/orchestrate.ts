/**
 * T1.5: the main-thread side of every arm, the same code for the Node runner (`node-main.ts`) and the browser page (`page-main.ts`): builds the arena of a problem (outside any timing), hands it
 * to the workers, starts the helpers' loops and the driver, and collects the driver's result. Workers are spawned by the caller once and reused for every problem of a run.
 */
import { makeFixture, type Fixture } from './fixture';
import { buildAirArena } from './air-pool';
import { buildFastArena, type FastMeta } from './fast-pool';

export interface WorkerHandle {
  post(msg: Record<string, unknown>): void;
  /** the next message from the worker (the protocol is strictly request and reply) */
  next(): Promise<Record<string, unknown>>;
  terminate(): void | Promise<unknown>;
}

export interface RawFixture { name: string; header: string; data: ArrayBuffer }

export interface RunSpec {
  /** 'app': the app's unmodified kernels in worker 0; 'pool': the range forms on `threads` workers over a SharedArrayBuffer */
  arm: 'app' | 'pool';
  threads: number;
  spinUs: number;
  mode: 'verify' | 'time';
  samples: number;
  warmMs: number;
  minSampleMs: number;
  only?: string[];
  /** verify: take the chunked paths whatever the size (thresholds 0), as the C# tests do besides the default ones */
  force?: boolean;
}

export function fastMetaOf(fx: Fixture): FastMeta {
  const h = fx.header as unknown as { meta: FastMeta; cases: { kind: string; fireNx?: number; fireNy?: number; cellSize?: number }[] };
  const py = h.cases.find((c) => c.kind === 'pyro');
  if (!py) throw new Error('fixture has no pyro case');
  return { ...h.meta, pyroGrid: { nx: py.fireNx!, ny: py.fireNy!, cell: py.cellSize! } };
}

async function expect(w: WorkerHandle, t: string): Promise<Record<string, unknown>> {
  const m = await w.next();
  if (m.t === 'error') throw new Error(`worker error: ${String(m.message)}`);
  if (m.t !== t) throw new Error(`expected ${t}, got ${String(m.t)}`);
  return m;
}

export async function runProblem(workers: WorkerHandle[], kind: 'air' | 'fast', raw: RawFixture, spec: RunSpec): Promise<Record<string, unknown>> {
  const common = { mode: spec.mode, samples: spec.samples, warmMs: spec.warmMs, minSampleMs: spec.minSampleMs, only: spec.only, force: spec.force };
  if (spec.arm === 'app') {
    workers[0]!.post({ t: 'app', kind, name: raw.name, header: raw.header, data: raw.data.slice(0), ...common });
    return await expect(workers[0]!, 'result');
  }
  if (workers.length < spec.threads) throw new Error(`need ${spec.threads} workers, have ${workers.length}`);
  const fx = makeFixture(raw.name, raw.header, raw.data);
  const built = kind === 'air' ? buildAirArena(fx) : (() => { const meta = fastMetaOf(fx); return { arena: buildFastArena(meta).arena, meta }; })();
  const team = workers.slice(0, spec.threads);
  team.forEach((w, i) => w.post({ t: 'setup', kind, sab: built.arena.sab, table: built.arena.table, meta: built.meta, threads: spec.threads, spinUs: spec.spinUs, role: i === 0 ? 'driver' : 'helper' }));
  for (const w of team) await expect(w, 'ready');
  for (let i = 1; i < team.length; i++) team[i]!.post({ t: 'serve' });
  // the driver needs the raw frames only to replay them, or (fast tier) to build its frames: an air timing run uses the arena alone
  const needData = !(kind === 'air' && spec.mode === 'time');
  team[0]!.post({ t: 'drive', name: raw.name, header: raw.header, data: needData ? raw.data.slice(0) : new ArrayBuffer(0), ...common });
  const res = await expect(team[0]!, 'result');
  for (let i = 1; i < team.length; i++) await expect(team[i]!, 'served');
  return res;
}
