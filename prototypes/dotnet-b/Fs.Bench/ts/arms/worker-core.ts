/**
 * T1.5: the worker side of every arm, the same code in a Node `worker_threads` worker and in a browser Web Worker (`worker-node.ts`, `worker-browser.ts` give it a port).
 * Messages (main -> worker):
 *   {t:'app', kind, header, data, mode, samples, warmMs, minSampleMs, only?}   arm (a) / browser one worker: the app's UNMODIFIED kernels, resident data, timing inside the worker
 *   {t:'setup', kind, sab, table, meta, threads, spinUs, role}                 arm (b)/(c) pool: build views of the arena, the pool and the jobs (every thread in the same order)
 *   {t:'serve'}                                                                 a helper blocks in the pool loop until the driver shuts the pool down
 *   {t:'drive', header, data, name, mode, samples, warmMs, minSampleMs, only?} the driver (thread 0): replays the golden cases ('verify') or times the kernels ('time')
 * Replies: {t:'ready'}, {t:'served'}, {t:'result', ...}, {t:'error', message}.
 * `verify` and `time` are separate runs (separate worker sets) on purpose: a replay feeds NaN, -0 and wide arrays to the loops, which must not shape the timed code's type feedback.
 */
import { hex, sha256 } from './sha';
import { Pool, viewsOf, type Arena, type TypedAny } from './pool';
import { makeFixture, type Fixture } from './fixture';
import { measureAll, type OpStats } from './measure';
import { AppAir, airOpsApp } from './air-app';
import { runAirCases, type CaseResult } from './air-cases';
import { AirPar, type AirMeta } from './air-pool';
import { PoolAir, airOpsPool } from './air-pool-be';
import { appLsFactory, appPyroFactory, fastOpsApp } from './fast-app';
import { runFastCases, type FastCaseResult } from './fast-frames';
import { makeFastThread, replayFactories, fastOpsPool, type FastThread } from './fast-pool-be';
import type { FastMeta } from './fast-pool';

export interface Port {
  post(msg: unknown): void;
  on(cb: (msg: Record<string, unknown>) => void): void;
}

interface Engine { name: string; version: string; crossOriginIsolated?: boolean; hardwareConcurrency?: number }

export function engineInfo(): Engine {
  const g = globalThis as unknown as { process?: { versions?: { node?: string; v8?: string } }; navigator?: { userAgent?: string; hardwareConcurrency?: number }; crossOriginIsolated?: boolean };
  if (g.process?.versions?.node) return { name: 'node', version: `${g.process.versions.node} (V8 ${g.process.versions.v8})` };
  return { name: 'browser', version: g.navigator?.userAgent ?? '?', crossOriginIsolated: g.crossOriginIsolated, hardwareConcurrency: g.navigator?.hardwareConcurrency };
}

interface Setup {
  kind: 'air' | 'fast';
  views: Record<string, TypedAny>;
  pool: Pool;
  meta: AirMeta | FastMeta;
  air?: AirPar;
  fast?: FastThread;
  role: 'driver' | 'helper';
  threads: number;
}

export function installWorker(port: Port): void {
  let setup: Setup | null = null;
  port.on((msg) => {
    try {
      switch (msg.t) {
        case 'app':
          port.post(runApp(msg));
          break;
        case 'setup': {
          const arena: Arena = { sab: msg.sab as SharedArrayBuffer, table: msg.table as Arena['table'] };
          const views = viewsOf(arena);
          const threads = msg.threads as number;
          const pool = new Pool(views.ctl as Int32Array, { threads, spinUs: msg.spinUs as number });
          const kind = msg.kind as 'air' | 'fast';
          const s: Setup = { kind, views, pool, meta: msg.meta as AirMeta | FastMeta, role: msg.role as 'driver' | 'helper', threads };
          if (kind === 'air') s.air = new AirPar(s.meta as AirMeta, views, pool);
          else s.fast = makeFastThread(s.meta as FastMeta, views, pool);
          setup = s;
          port.post({ t: 'ready' });
          break;
        }
        case 'serve':
          setup!.pool.serve();
          port.post({ t: 'served' });
          break;
        case 'drive':
          port.post(drive(setup!, msg));
          break;
        default:
          throw new Error(`unknown message ${String(msg.t)}`);
      }
    } catch (e) {
      port.post({ t: 'error', message: e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e) });
    }
  });
}

function summarize(rs: (CaseResult | FastCaseResult)[]): { cases: number; checks: number; mismatches: number; failed: { id: string; mismatches: string[] }[]; digest: string } {
  let checks = 0, mism = 0;
  const failed: { id: string; mismatches: string[] }[] = [];
  for (const r of rs) {
    checks += r.checks;
    mism += r.mismatches.length;
    if (r.mismatches.length) failed.push({ id: r.id, mismatches: r.mismatches.slice(0, 40) });
  }
  // a digest of every hash this implementation computed, whatever the goldens say: two arms in ONE engine are compared by it (Chromium's Math differs from Node's)
  const digest = hex(sha256(new TextEncoder().encode(JSON.stringify(rs.map((r) => [r.id, r.actual])))), 16);
  return { cases: rs.length, checks, mismatches: mism, failed, digest };
}

function fixtureOf(msg: Record<string, unknown>): Fixture {
  return makeFixture((msg.name as string) ?? 'fixture', msg.header as string, msg.data as ArrayBuffer);
}

function runApp(msg: Record<string, unknown>): Record<string, unknown> {
  const fx = fixtureOf(msg);
  const kind = msg.kind as 'air' | 'fast';
  const mode = msg.mode as 'verify' | 'time';
  const t0 = performance.now();
  if (mode === 'verify') {
    const rs = kind === 'air' ? runAirCases(fx, new AppAir(fx)) : runFastCases(fx, appLsFactory, appPyroFactory);
    return { t: 'result', mode, kind, arm: 'app', engine: engineInfo(), verify: summarize(rs), wallMs: performance.now() - t0 };
  }
  const ops = kind === 'air' ? airOpsApp(fx) : fastOpsApp(fx);
  const stats = measureAll(ops, msg.samples as number, msg.warmMs as number, msg.minSampleMs as number, msg.only as string[] | undefined);
  return { t: 'result', mode, kind, arm: 'app', engine: engineInfo(), stats, wallMs: performance.now() - t0 };
}

function drive(s: Setup, msg: Record<string, unknown>): Record<string, unknown> {
  const fx = fixtureOf(msg);
  const mode = msg.mode as 'verify' | 'time';
  const t0 = performance.now();
  let verify: ReturnType<typeof summarize> | undefined;
  let stats: OpStats[] | undefined;
  try {
    if (s.kind === 'air') {
      const par = s.air!;
      if (mode === 'verify') {
        const be = new PoolAir(par, { activeU: fx.get('masks.activeU') as Uint8Array, activeV: fx.get('masks.activeV') as Uint8Array });
        verify = summarize(runAirCases(fx, be));
      } else stats = measureAll(airOpsPool(par), msg.samples as number, msg.warmMs as number, msg.minSampleMs as number, msg.only as string[] | undefined);
    } else {
      const ft = s.fast!;
      if (mode === 'verify') {
        const f = replayFactories(ft, msg.force === true);
        verify = summarize(runFastCases(fx, f.ls, f.py));
      } else stats = measureAll(fastOpsPool(fx, ft), msg.samples as number, msg.warmMs as number, msg.minSampleMs as number, msg.only as string[] | undefined);
    }
  } finally {
    s.pool.shutdown(); // helpers leave their loop even when the driver failed
  }
  return { t: 'result', mode, kind: s.kind, arm: 'pool', threads: s.threads, regions: s.pool.regions, engine: engineInfo(), verify, stats, wallMs: performance.now() - t0 };
}
