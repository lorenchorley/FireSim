/**
 * Installs the probes (card T3.4). Called by export.ts when FS_PROBES is set, before the `Simulation` is built; `finish(sim)` after the run.
 * What it does, all by observation (an argument is read before and after a call, the call gets the same `this` and the same arguments, the
 * result is returned as it is; no random draw, no write to solver state):
 *   1 call recorders       a wrapper on each method of spec.mjs (module functions are wrapped by plugin.mjs at build time)
 *   2 steps tape           after each Simulation.stepOnce: t, dt, tier, stamp, state digests, draw counters of the generators
 *   3 environment tape     at each FireSpreadModel.prepare: the SpreadEnvironment's inputs from the weather and the moisture model
 *   4 air tape             at each prepare: the wind, ridge-wind, air temperature and density arrays the fire reads (air -> fire); and, in the windows,
 *                          every wind and turbulence sample the ember model takes from the air, and every landing answer (so the embers can be
 *                          proven with no air and no fire)
 *   5 draws                the first draws of each random stream, counts per consumer, the draw count of each ember particle advance
 * Windows: init (constructor and t0 snapshot), spin (spinUp), w0 (steps starting before 120 s), w900 (steps starting in [880, 960) s).
 */
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { Rng } from '../../../../src/core/rng';
import { decodeMessage } from '../../../../src/sim/remote/codec';
import { terrainDerived } from '../../../../src/terrain/analysis';
import { MoistureModel } from '../../../../src/fuel/moisture/model';
import { FAST_TABLES, EXPNEG_TABLE } from '../../../../src/fuel/moisture/fastMath';
import { LevelSetCore } from '../../../../src/fire/spread/levelSet';
import { DistanceTransform } from '../../../../src/fire/spread/geometry';
import { FuelCache } from '../../../../src/fire/spread/fuelCache';
import { FireSpreadModel } from '../../../../src/fire/spread/FireSpreadModel';
import { PlumeField } from '../../../../src/embers/plume';
import { EmberModel } from '../../../../src/embers/EmberModel';
import { FastRng, NORMAL_TABLE } from '../../../../src/embers/sampling';
import { MassConsistentSolver } from '../../../../src/atmosphere/massConsistent';
import { EllipticSolver } from '../../../../src/atmosphere/solver';
import { AtmosBase } from '../../../../src/atmosphere/base';
import { DiagnosticWind } from '../../../../src/atmosphere/diagnosticWind';
import { PyrogenicPotential } from '../../../../src/atmosphere/pyrogenic';
import { Atmosphere } from '../../../../src/atmosphere/atmosphere';
import { Simulation } from '../../../../src/sim/simulation';
import { BlobStore, FNV0, ProbeRuntime, WINDOWS, ensureDir, fnv, hashArray, hex8, leafOf, numLeaf, plainify, type Win } from './core';
import { rows, isMethod } from './spec.mjs';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface StartOpts {
  outDir: string;
  scenario: string;
  seed: number;
  runTo: number;
  tier: string;
  embers: boolean;
  /** The bytes of init.bin: the terrain is decoded from them once, so that the derived terrain fields are computed the way a reader of init.bin must (see A2). */
  initBytes: Uint8Array;
}

const CLASSES: Record<string, { prototype: object }> = {
  MoistureModel, LevelSetCore, DistanceTransform, FuelCache, FireSpreadModel, PlumeField, EmberModel, FastRng, MassConsistentSolver,
  EllipticSolver, AtmosBase, DiagnosticWind, PyrogenicPotential, Atmosphere, Simulation, Rng,
};

/** Windows, in simulated seconds from the scenario start (a step belongs to the window its start time is in). */
export const W0_END = 120;
export const W600 = [595, 625] as const;
export const W900 = [880, 960] as const;
/** Steps before this time (and the w900 window) keep their tape arrays in full (blobs); the others are hashed only. */
const BLOB_UNTIL = Number(process.env.FS_PROBES_BLOB_UNTIL ?? 600);
const EMBER_LOG_CAP = 300_000;
const MULBERRY_INC = 0x6d2b79f5;
const INV = (() => {
  let x = MULBERRY_INC;
  for (let i = 0; i < 6; i++) x = Math.imul(x, 2 - Math.imul(MULBERRY_INC, x));
  return x >>> 0;
})();
/** Number of mulberry32 draws between two states. */
const drawsBetween = (s0: number, s1: number): number => Math.imul((s1 - s0) >>> 0, INV) >>> 0;
const winOf = (t: number): Win | null => (t < W0_END ? 'w0' : t >= W600[0] && t < W600[1] ? 'w600' : t >= W900[0] && t < W900[1] ? 'w900' : null);

/** A growing log of fixed-width float64 records. */
class F64Log {
  private chunks: Float64Array[] = [];
  private cur = new Float64Array(6 * 4096);
  private pos = 0;
  n = 0;
  truncated = false;
  constructor(readonly width: number) {}
  push(...v: number[]): void {
    if (this.n >= EMBER_LOG_CAP) {
      this.truncated = true;
      return;
    }
    if (this.pos + this.width > this.cur.length) {
      this.chunks.push(this.cur);
      this.cur = new Float64Array(this.cur.length);
      this.pos = 0;
    }
    for (let i = 0; i < this.width; i++) this.cur[this.pos++] = v[i]!;
    this.n++;
  }
  bytes(): Uint8Array {
    const total = new Float64Array(this.n * this.width);
    let o = 0;
    for (const c of this.chunks) {
      total.set(c, o);
      o += c.length;
    }
    total.set(this.cur.subarray(0, this.pos), o);
    return new Uint8Array(total.buffer);
  }
}

interface RngStream {
  s0: number;
  n: number;
  first: [string, number][];
  byLabel: Record<string, number>;
}

export function startProbes(o: StartOpts): { finish(sim: Any): void; runtime: ProbeRuntime } {
  const G = new ProbeRuntime();
  const probeRows = rows();
  G.register(probeRows);
  G.outDir = o.outDir;
  ensureDir(join(o.outDir, 'raw'));
  ensureDir(join(o.outDir, 'calls'));
  const blobs = new BlobStore(join(o.outDir, 'blobs.bin'));

  // ── named digests of `this` (before and after a method call) ────────────────────────────────────────────────────────────────
  const ownLeaf = (self: Any): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(self)) {
      const x = self[k];
      if (ArrayBuffer.isView(x) || typeof x === 'number' || typeof x === 'boolean' || typeof x === 'string') out[k] = leafOf(x);
    }
    return out;
  };
  const ownRaw = (self: Any, budget: { bytes: number }, copy = false): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(self)) {
      const x = self[k];
      if (ArrayBuffer.isView(x) || typeof x === 'number' || typeof x === 'boolean' || typeof x === 'string') {
        const p = plainify(x, budget, 0, new Set(), copy);
        if (p !== undefined) out[k] = p;
      }
    }
    return out;
  };
  const pick = (names: string[]) => ({
    leaf: (self: Any) => Object.fromEntries(names.map((k) => [k, leafOf(self[k])])),
    raw: (self: Any, budget: { bytes: number }, copy = false) => Object.fromEntries(names.map((k) => [k, plainify(self[k], budget, 0, new Set(), copy) ?? null])),
  });
  G.digests.fire = {
    leaf: (self: Any) => ({ own: ownLeaf(self), field: leafOf(self.field) }),
    raw: (self: Any, b, copy = false) => ({ own: ownRaw(self, b, copy), field: plainify(self.field, b, 0, new Set(), copy) ?? null }),
  };
  G.digests.moist = pick(['field', 'availability', 'fuelTemp']);
  G.digests.atm = pick(['u', 'v', 'w', 'th', 'sm', 'phi']);
  const PARTICLE = ['px', 'py', 'pz', 'up', 'vp', 'wp', 'age', 'vt0', 'tauB', 'flameEnd', 'W', 'zLaunch', 'maxH', 'sumU', 'sumV', 'cn', 'srcX', 'srcY', 'rx', 'ry', 'rz', 'riseT', 'fl13', 'tBirth', 'cls', 'state', 'srcClass', 'srcCell'];
  const live = (self: Any, k: string): ArrayBufferView | undefined => (self[k] as { subarray?: (a: number, b: number) => ArrayBufferView } | undefined)?.subarray?.(0, self.count);
  const ACTIVE = ['aCell', 'aUntil', 'aTArr', 'aTau', 'aAmp', 'aMask', 'aFL13', 'aHeat', 'aFH', 'aHO', 'aI'];
  const EM_SCALARS = ['count', 'nAct', 'stepId', 'time', 'burntOut', 'dropped', 'leftDomain', 'subSteps', 'firePowerW', 'powerM', 'powerNorm', 'plumeTop', 'windToDeg', 'rateNorm', 'lastHoldoverCheck'];
  const EM_SMALL = ['wC', 'wCarry', 'rateNow', 'lifeS', 'lifeN', 'classPop', 'emitted', 'cellState', 'pileT0', 'pileN'];
  const act = (self: Any, k: string): ArrayBufferView | undefined => (self[k] as { subarray?: (a: number, b: number) => ArrayBufferView } | undefined)?.subarray?.(0, self.nAct);
  G.digests.ember = {
    leaf: (self: Any) => ({
      scalars: Object.fromEntries(EM_SCALARS.map((k) => [k, leafOf(self[k])])),
      particles: Object.fromEntries(PARTICLE.map((k) => [k, leafOf(live(self, k))])),
      active: Object.fromEntries(ACTIVE.map((k) => [k, leafOf(act(self, k))])),
      small: Object.fromEntries(EM_SMALL.map((k) => [k, leafOf(self[k])])),
      pending: leafOf(self.pending),
      holdovers: leafOf(self.holdovers),
    }),
    raw: (self: Any, b, copy = false) => ({
      scalars: Object.fromEntries(EM_SCALARS.map((k) => [k, self[k]])),
      particles: Object.fromEntries(PARTICLE.map((k) => [k, plainify(live(self, k), b, 0, new Set(), copy) ?? null])),
      active: Object.fromEntries(ACTIVE.map((k) => [k, plainify(act(self, k), b, 0, new Set(), copy) ?? null])),
      small: Object.fromEntries(EM_SMALL.map((k) => [k, plainify(self[k], b, 0, new Set(), copy) ?? null])),
      pending: plainify(self.pending, b, 0, new Set(), copy) ?? null,
      holdovers: plainify(self.holdovers, b, 0, new Set(), copy) ?? null,
    }),
  };

  // ── 1 call recorders: methods ───────────────────────────────────────────────────────────────────────────────────────────────────
  const missing: string[] = [];
  /** Classes that the module does not export: their prototype is taken from an instance when the first Simulation is hooked. */
  const LAZY = new Set(['TerrainFeaturesImpl']);
  const wrapMethod = (r: (typeof probeRows)[number], proto: Any, m: string): void => {
    const f = proto ? Object.getOwnPropertyDescriptor(proto, m)?.value : undefined;
    if (typeof f !== 'function') {
      missing.push(r.id);
      return;
    }
    proto[m] = function (this: unknown, ...a: unknown[]): unknown {
      return G.callFn(r.id, f, this, a);
    };
  };
  for (const r of probeRows) {
    if (!isMethod(r.name)) continue;
    const [cls, m] = r.name.split('.') as [string, string];
    if (LAZY.has(cls)) continue;
    const proto = CLASSES[cls]?.prototype as Any;
    wrapMethod(r, proto, m);
  }

  // ── 5 draws: the random streams ─────────────────────────────────────────────────────────────────────────────────────────────────
  const FIRST_DRAWS = 256;
  const rngStreams = new Map<object, RngStream>();
  const fastStream: RngStream = { s0: -1, n: 0, first: [], byLabel: {} };
  const noteDraw = (st: RngStream, u32: number): void => {
    st.n++;
    const label = G.label;
    st.byLabel[label] = (st.byLabel[label] ?? 0) + 1;
    if (st.first.length < FIRST_DRAWS) st.first.push([label, u32]);
  };
  {
    const rp = Rng.prototype as Any;
    const next = rp.next as () => number;
    rp.next = function (this: Any): number {
      if (!G.on) return next.call(this);
      let st = rngStreams.get(this);
      if (!st) rngStreams.set(this, (st = { s0: this.s, n: 0, first: [], byLabel: {} }));
      const r = next.call(this);
      noteDraw(st, Math.round(r * 4294967296));
      return r;
    };
    const fp = FastRng.prototype as Any;
    const fnext = fp.next as () => number;
    fp.next = function (this: Any): number {
      if (!G.on) return fnext.call(this);
      if (fastStream.s0 < 0) fastStream.s0 = this.s;
      const r = fnext.call(this);
      noteDraw(fastStream, Math.round(r * 4294967296));
      return r;
    };
  }
  // per-call draw counts of the ember model: emit and step (public calls: the Rng state is synced at entry and exit), advance (one particle)
  const emberEvents: { k: string; t: number; n: number; s0: number }[] = [];
  const advList: Record<string, number[]> = { w0: [], w600: [], w900: [] };
  const advHist: Record<string, Record<number, number>> = { w0: {}, w600: {}, w900: {}, spin: {}, init: {}, other: {} };
  let advTotal = 0;
  let advViaFast = 0;
  let advCalls = 0;
  {
    const ep = EmberModel.prototype as Any;
    for (const name of ['emit', 'step'] as const) {
      const inner = ep[name] as (...a: unknown[]) => unknown;
      ep[name] = function (this: Any, ...a: unknown[]): unknown {
        if (!G.on) return inner.apply(this, a);
        const s0: number = this.rng.state;
        const wasAir = air.active;
        if (name === 'step') air.active = true;
        try {
          return inner.apply(this, a);
        } finally {
          air.active = wasAir;
          const n = drawsBetween(s0, this.rng.state);
          if (emberEvents.length < 4000) emberEvents.push({ k: name, t: G.t, n, s0 });
        }
      };
    }
    const adv = ep.advance as (...a: unknown[]) => unknown;
    ep.advance = function (this: Any, ...a: unknown[]): unknown {
      if (!G.on) return adv.apply(this, a);
      const r = this.r;
      const s0: number = r.s;
      const f0 = fastStream.n;
      const out = adv.apply(this, a);
      const n = drawsBetween(s0, r.s);
      advTotal += n;
      advViaFast += fastStream.n - f0;
      advCalls++;
      const w = G.win ?? 'other';
      advHist[w]![n] = (advHist[w]![n] ?? 0) + 1;
      if (advList[w]) {
        const l = advList[w]!;
        if (l.length < 12000) l.push(a[0] as number, n);
      }
      return out;
    };
  }

  // ── 4 air tape (ember side) ───────────────────────────────────────────────────────────────────────────────────────────────────
  const air = {
    active: false,
    get on(): boolean {
      return this.active && G.on && (G.win === 'w0' || G.win === 'w900');
    },
    /** Log positions [wind, turb, landing, ignite] now, in a window with logs (else undefined): a step's records are those between two marks. */
    marks(): number[] | undefined {
      const w = G.win;
      if (!G.on || (w !== 'w0' && w !== 'w900')) return undefined;
      return [this.wind[w]!.n, this.turb[w]!.n, this.landing[w]!.length, this.ignite[w]!.length];
    },
    wind: { w0: new F64Log(6), w900: new F64Log(6) } as Record<string, F64Log>,
    turb: { w0: new F64Log(6), w900: new F64Log(6) } as Record<string, F64Log>,
    landing: { w0: [] as unknown[], w900: [] as unknown[] } as Record<string, unknown[]>,
    ignite: { w0: [] as unknown[], w900: [] as unknown[] } as Record<string, unknown[]>,
  };
  const hooked = new WeakSet<object>();
  let lazyDone = false;
  const hookSim = (sim: Any): void => {
    hooked.add(sim);
    if (!lazyDone) {
      lazyDone = true;
      const protos: Record<string, object> = { TerrainFeaturesImpl: Object.getPrototypeOf(sim.features) };
      for (const r of probeRows) {
        if (!isMethod(r.name)) continue;
        const [cls, m] = r.name.split('.') as [string, string];
        if (LAZY.has(cls)) wrapMethod(r, protos[cls] as Any, m);
      }
    }
    const wf = sim.windFn as (x: number, y: number, z: number, out: Float32Array) => void;
    const tf = sim.turbFn as (x: number, y: number, z: number, out: Float32Array) => void;
    const lf = sim.landingFn as (x: number, y: number) => unknown;
    const jf = sim.igniteFn as (x: number, y: number, travel: number, prov: unknown) => void;
    sim.windFn = (x: number, y: number, z: number, out: Float32Array): void => {
      wf(x, y, z, out);
      if (air.on) air.wind[G.win!]!.push(x, y, z, out[0]!, out[1]!, out[2]!);
    };
    sim.turbFn = (x: number, y: number, z: number, out: Float32Array): void => {
      tf(x, y, z, out);
      if (air.on) air.turb[G.win!]!.push(x, y, z, out[0]!, out[1]!, out[2]!);
    };
    sim.landingFn = (x: number, y: number): unknown => {
      const r = lf(x, y);
      if (air.on) {
        const l = air.landing[G.win!]!;
        if (l.length < 20000) l.push({ x: numLeaf(x), y: numLeaf(y), r: leafOf(r) });
      }
      return r;
    };
    sim.igniteFn = (x: number, y: number, travel: number, prov: unknown): void => {
      jf(x, y, travel, prov);
      if (air.on) {
        const l = air.ignite[G.win!]!;
        if (l.length < 5000) l.push({ x: numLeaf(x), y: numLeaf(y), travel: numLeaf(travel), prov: leafOf(prov) });
      }
    };
  };

  // ── 2 steps tape, 3 environment tape, 4 air tape (fire side) ──────────────────────────────────────────────────────────────
  const steps: Record<string, unknown>[] = [];
  const envTape: Record<string, unknown>[] = [];
  const airTape: Record<string, unknown>[] = [];
  const blobOk = (t: number): boolean => t < BLOB_UNTIL || (t >= W600[0] && t < W600[1]) || (t >= W900[0] && t < W900[1]);
  const arrRef = (v: ArrayBufferView, full: boolean): unknown => {
    const l = leafOf(v) as Record<string, unknown>;
    if (full) l.blob = blobs.put(v);
    return l;
  };
  const ENV_ARR = ['moisture', 'availability', 'fuelTempC'];
  const AIR_ARR = ['windU', 'windV', 'windBgU', 'windBgV', 'fireIndU', 'fireIndV', 'uRidge', 'airT', 'airRho'];
  const ENV_SCALAR = ['droughtFactor', 'kbdi', 'time', 'sunElevation', 'lmstHour', 'cloudFrac', 'mountainPhenomena', 'pyrogenicOn', 'coupling'];
  const tapeStep = (env: Any): void => {
    const full = blobOk(G.t);
    const e: Record<string, unknown> = { k: G.step, t: numLeaf(G.t), win: G.win };
    for (const k of ENV_SCALAR) e[k] = leafOf(env[k]);
    e.weather = leafOf(env.weather);
    for (const k of ENV_ARR) e[k] = arrRef(env[k], full);
    envTape.push(e);
    const a: Record<string, unknown> = { k: G.step, t: numLeaf(G.t), win: G.win };
    for (const k of AIR_ARR) a[k] = arrRef(env[k], full);
    airTape.push(a);
  };
  {
    const fp = FireSpreadModel.prototype as Any;
    const prep = fp.prepare as (env: unknown) => unknown;
    fp.prepare = function (this: Any, env: unknown): unknown {
      if (G.on && G.t >= 0) tapeStep(env);
      return prep.call(this, env);
    };
  }
  const combined = (arrs: (ArrayBufferView | undefined)[]): string => {
    let h = FNV0;
    for (const a of arrs) if (a) h = fnv(h, new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
    return hex8(h);
  };
  const afterStep = (sim: Any, t0: number, marks: number[] | undefined): void => {
    const e = envTape[envTape.length - 1];
    if (e && e.k === G.step) {
      e.dt = numLeaf(sim.lastDt);
      e.tier = sim.tierNow;
      e.stampIdx = sim.stampIdx;
      e.night = leafOf(sim.night);
    }
    const atm = sim.atm as Any;
    const s: Record<string, unknown> = {
      k: G.step,
      t: numLeaf(t0),
      tEnd: numLeaf(sim.t),
      dt: numLeaf(sim.lastDt),
      fire: leafOf(sim.fire.field),
      moisture: leafOf(sim.moisture.field),
      heatPrev: leafOf(sim.heatPrev),
      crownPrev: leafOf(sim.crownPrev),
      draws: {
        fire: drawsBetween(seedState(o.seed + 1), sim.rngFire.state),
        embers: drawsBetween(seedState(o.seed), sim.rngEmbers.state),
        atmosphere: drawsBetween(seedState(o.seed + 3), sim.rngAtm.state),
      },
    };
    if (marks) {
      const m1 = air.marks()!;
      s.emberLog = { wind: [marks[0], m1[0]], turb: [marks[1], m1[1]], landing: [marks[2], m1[2]], ignite: [marks[3], m1[3]] };
    }
    if (sim.opts?.embers) {
      const em = sim.embers as Any;
      s.embers = { count: em.count, nAct: em.nAct, h: combined(PARTICLE.map((k) => live(em, k))) };
    }
    if (atm && atm.u instanceof Float32Array) s.atm = { u: leafOf(atm.u), v: leafOf(atm.v), w: leafOf(atm.w), th: leafOf(atm.th), sm: leafOf(atm.sm) };
    steps.push(s);
  };
  const seedState = (seed: number): number => (seed >>> 0 || 0x9e3779b9) >>> 0;

  {
    const sp = Simulation.prototype as Any;
    const stepOnce = sp.stepOnce as () => unknown;
    sp.stepOnce = function (this: Any): unknown {
      const t: number = this.t;
      G.t = t;
      G.win = winOf(t);
      G.step++;
      if (!hooked.has(this)) hookSim(this);
      const marks = air.marks();
      const r = stepOnce.call(this);
      afterStep(this, t, marks);
      return r;
    };
    const spinUp = sp.spinUp as (...a: unknown[]) => unknown;
    sp.spinUp = function (this: Any, ...a: unknown[]): unknown {
      if (!hooked.has(this)) hookSim(this);
      const prev = G.win;
      G.win = 'spin';
      G.t = -1;
      try {
        return spinUp.apply(this, a);
      } finally {
        G.win = prev === 'init' ? null : prev;
      }
    };
  }

  if (process.env.FS_PROBES_RAW === '0') G.rawBudget = 0;
  else if (process.env.FS_PROBES_RAW_MB) G.rawBudget = Number(process.env.FS_PROBES_RAW_MB) * 1e6;
  (globalThis as Any).__FSP = G;
  G.on = true;
  G.win = 'init';
  // A2: the derived terrain fields of a terrain that came through the codec (the exporter's own terrain object has them cached from the builder).
  terrainDerived((decodeMessage(o.initBytes) as Any).scenario.terrain);

  // ── finish ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const finish = (sim: Any): void => {
    G.on = false;
    G.win = null;
    // draws
    const named: Record<string, unknown> = {};
    const seedName = new Map<number, string>([
      [seedState(o.seed), 'embers(Rng)'],
      [seedState(o.seed + 1), 'fire'],
      [seedState(o.seed + 2), 'explain'],
      [seedState(o.seed + 3), 'atmosphere'],
    ]);
    let anon = 0;
    for (const st of rngStreams.values()) {
      const nm = seedName.get(st.s0 >>> 0) ?? `rng${anon++}`;
      named[nm] = { s0: st.s0 >>> 0, drawsViaRngNext: st.n, byLabel: st.byLabel, first: st.first };
    }
    const emberTotal = drawsBetween(seedState(o.seed), sim.rngEmbers.state);
    const standalone = standaloneDraws();
    const tables = tableGoldens();
    const hist = (h: Record<number, number>): Record<string, number> => Object.fromEntries(Object.entries(h).sort((a, b) => Number(a[0]) - Number(b[0])));
    const draws = {
      scenario: o.scenario,
      seed: o.seed,
      embers: o.embers,
      note: 'u32 is the mulberry32 output before the division by 2^32. Streams: embers = seed (state only in the Rng; the draws are taken by the ember model through FastRng and inline in advance), fire = seed+1, explain = seed+2, atmosphere = seed+3.',
      streams: {
        ...named,
        embers: {
          s0: seedState(o.seed),
          totalDraws: emberTotal,
          viaFastRngNext: fastStream.n,
          advanceDrawsAll: advTotal,
          advanceDrawsViaFastRng: advViaFast,
          viaInlineAdvance: advTotal - advViaFast,
          advanceCalls: advCalls,
          sumCheck: fastStream.n + advTotal - advViaFast === emberTotal,
          fastRngByLabel: fastStream.byLabel,
          firstViaFastRng: fastStream.first,
        },
        totals: {
          fire: drawsBetween(seedState(o.seed + 1), sim.rngFire.state),
          embers: emberTotal,
          atmosphere: drawsBetween(seedState(o.seed + 3), sim.rngAtm.state),
        },
      },
      emberEvents,
      perParticleAdvance: {
        note: 'one advance(i, ...) call moves one particle through one step; entries are [slot, draws consumed]; histogram: draws -> number of particle-steps',
        pairs: advList,
        histogram: { w0: hist(advHist.w0!), w600: hist(advHist.w600!), w900: hist(advHist.w900!), other: hist(advHist.other!) },
      },
      standalone,
      tables,
    };
    writeFileSync(join(o.outDir, 'draws.json'), JSON.stringify(draws));

    // call recorders
    const byArea = new Map<string, Record<string, unknown>>();
    const indexProbes: Record<string, unknown> = {};
    for (const ps of G.list) {
      const r = ps.row;
      const entry: Record<string, unknown> = {};
      const idx: Record<string, unknown> = { area: r.area, file: r.file, name: r.name, windows: {} as Record<string, unknown> };
      for (const w of [...WINDOWS, 'other'] as const) {
        const n = ps.n[w] ?? 0;
        if (!n) continue;
        const recs = ps.rec[w] ?? [];
        (idx.windows as Record<string, unknown>)[w] = { calls: n, recorded: recs.length, raw: ps.nraw[w] ?? 0 };
        if (recs.length) entry[w] = recs;
      }
      indexProbes[r.id] = idx;
      if (Object.keys(entry).length) {
        const a = byArea.get(r.area) ?? {};
        a[r.id] = entry;
        byArea.set(r.area, a);
      }
    }
    for (const [area, probes] of byArea) writeFileSync(join(o.outDir, 'calls', `${area}.json`), JSON.stringify({ area, scenario: o.scenario, seed: o.seed, probes }));

    // tapes
    writeFileSync(join(o.outDir, 'steps.json'), JSON.stringify({ scenario: o.scenario, seed: o.seed, steps }));
    const hostCalls = [
      { call: 'new Simulation(scenario, {minSnapshotWallMs: 0})' },
      { call: 'spinUp', args: ['deadline = Infinity'] },
      { call: 'advance', args: [numLeaf(o.runTo), 'deadline = Infinity'] },
      { call: 'emitRunEnd' },
    ];
    writeFileSync(
      join(o.outDir, 'env-tape.json'),
      JSON.stringify({
        scenario: o.scenario,
        seed: o.seed,
        note: 'One entry per FireSpreadModel.prepare (once per atmosphere step), before the fire step. The host feeds nothing else per step in these scenarios: hostCalls is the whole drive. Arrays: {$ta,n,h[,blob:{o,n,k}]}, blob = byte offset o in blobs.bin (k kind, n elements); entries without blob are hashed only.',
        hostCalls,
        steps: envTape,
      }),
    );
    const emberFiles: Record<string, unknown> = {};
    for (const w of ['w0', 'w900'] as const) {
      for (const [kind, log] of [['wind', air.wind[w]!], ['turb', air.turb[w]!]] as const) {
        const f = `ember-${kind}-${w}.f64`;
        writeFileSync(join(o.outDir, f), log.bytes());
        emberFiles[`${kind}.${w}`] = { file: f, records: log.n, width: 6, truncated: log.truncated };
      }
    }
    writeFileSync(
      join(o.outDir, 'air-tape.json'),
      JSON.stringify({
        scenario: o.scenario,
        seed: o.seed,
        note: 'fire side: one entry per prepare, the arrays env.windU.. airRho (air -> fire). ember side (windows w0, w900 only): every atm.sample (wind) and atm.sampleTurb (turb) call made inside EmberModel.step, as float64 records [x, y, zAGL, a, b, c] (wind: a,b,c = u,v,w; turb: zi, wStar, uStar), in call order; landing: every landingFn answer; ignite: every igniteFn call.',
        steps: airTape,
        ember: emberFiles,
        landing: air.landing,
        ignite: air.ignite,
      }),
    );
    blobs.close();

    const seqNames = G.list.map((p) => p.row.id);
    writeFileSync(
      join(o.outDir, 'index.json'),
      JSON.stringify({
        scenario: o.scenario,
        seed: o.seed,
        runToS: o.runTo,
        tier: o.tier,
        embers: o.embers,
        windows: { init: 'constructor and t0 snapshot', spin: 'spinUp', w0: `steps starting before ${W0_END} s`, w600: `steps starting in [${W600[0]}, ${W600[1]}) s`, w900: `steps starting in [${W900[0]}, ${W900[1]}) s` },
        steps: steps.length,
        probesMissing: missing,
        rawFiles: G.rawFiles,
        rawBytes: G.rawBytes,
        blobBytes: blobs.bytesWritten,
        callSequence: { names: seqNames, ...G.seq },
        probes: indexProbes,
      }),
    );
  };

  return { finish, runtime: G };
}

/** The first draws of each generator from fixed seeds, with everything `Rng` offers; also FastRng against Rng. Computed with the probes off. */
function standaloneDraws(): unknown {
  const seeds = [0, 1, 11, 12, 13, 14, 15, 0x7fffffff, 0xffffffff];
  const out: Record<string, unknown> = {};
  for (const seed of seeds) {
    const a = new Rng(seed);
    const u32: number[] = [];
    const dbl: unknown[] = [];
    for (let i = 0; i < 32; i++) {
      const r = a.next();
      u32.push(Math.round(r * 4294967296));
      dbl.push(numLeaf(r));
    }
    const b = new Rng(seed);
    const normal = Array.from({ length: 8 }, () => numLeaf(b.normal()));
    const stateAfterNormal = b.state;
    const c = new Rng(seed);
    const pois: number[] = [];
    const poisDraws: number[] = [];
    for (const mean of [0.3, 1.5, 3.7, 3.7, 12, 29.9, 30, 55, 120, 3.7, 3.7, 0.01]) {
      const s0 = c.state;
      pois.push(c.poisson(mean));
      poisDraws.push(drawsBetween(s0, c.state));
    }
    const d = new Rng(seed);
    const range = Array.from({ length: 4 }, () => numLeaf(d.range(2, 5)));
    const fr = new FastRng(new Rng(seed).state);
    const fastEqual = u32.every((x) => Math.round(fr.next() * 4294967296) === x);
    const f2 = new FastRng(new Rng(seed).state);
    const fastNormal = Array.from({ length: 6 }, () => numLeaf(f2.normal()));
    const f3 = new FastRng(new Rng(seed).state);
    const fastPoisson = [0.3, 3.7, 12, 55].map((m) => f3.poisson(m));
    out[String(seed)] = { initialState: new Rng(seed).state, u32, next: dbl, normal, stateAfterNormal, poisson: { means: [0.3, 1.5, 3.7, 3.7, 12, 29.9, 30, 55, 120, 3.7, 3.7, 0.01], values: pois, draws: poisDraws }, range, fastRngEqualsRng: fastEqual, fastNormal, fastPoisson };
  }
  return { note: 'Rng (src/core/rng.ts) from fixed seeds. seed 0 starts from the constant 0x9e3779b9. normal() draws two uniforms per call (Box-Muller, cos branch, no cache); FastRng.normal caches the sin variate.', seeds: out };
}

/** The tables built at module load: hash of every table and a handful of entries. */
function tableGoldens(): unknown {
  const t = (name: string, a: Float64Array): unknown => ({ name, n: a.length, h: hashArray(a), first: Array.from(a.subarray(0, 8), numLeaf), last: Array.from(a.subarray(a.length - 4), numLeaf), at: Array.from({ length: 16 }, (_, i) => numLeaf(a[Math.floor((i * (a.length - 1)) / 15)]!)) });
  return {
    NORMAL_TABLE: t('NORMAL_TABLE', NORMAL_TABLE),
    FAST_TABLES: { tLo: FAST_TABLES.tLo, tInv: FAST_TABLES.tInv, tTop: FAST_TABLES.tTop, hInv: FAST_TABLES.hInv, hTop: FAST_TABLES.hTop, esat: t('esat', FAST_TABLES.esat), rateT: t('rateT', FAST_TABLES.rateT), edk: t('edk', FAST_TABLES.edk) },
    EXPNEG_TABLE: { xInv: EXPNEG_TABLE.xInv, xTop: EXPNEG_TABLE.xTop, xMax: EXPNEG_TABLE.xMax, table: t('EXPNEG', EXPNEG_TABLE.table) },
  };
}
