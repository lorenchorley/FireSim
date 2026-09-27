/**
 * InsightEngine (spec §10, §2.4 signature): runs every registry detector each 60 s of simulated time on the
 * SimStateView, drives the per-key state machine `idle → armed → shown → cooldown → idle` (§10.1), renders the cards,
 * serves "Why here?" (`explainAt`, §10.4), the forecast cards (§10.3), the DMZ overlay (§10.5, P1) and checkpoints.
 *
 * State machine per key (§10.1):
 * - armed when score ≥ 1; shown after the rule's persistence (default 2 consecutive cycles);
 * - a shown card stays active while score ≥ 0.8 (hysteresis), then enters cool-down (default 15 min);
 * - a severity escalation (armed/shown/cooldown key whose candidate is more severe than the last shown card)
 *   bypasses persistence and cool-down;
 * - at most 3 new insights per cycle, ranked danger > watch > info, then score, then distance to the head;
 * - [H] kind-level de-duplication: a new key is not shown when a key of the same kind within `dedupRadiusM` is shown
 *   or cooling down with the same or higher severity (the key then tracks silently as shown).
 * Deterministic: fixed rule order, keys processed in sorted order, ties broken by key (no RNG needed).
 */
import { localDate } from '../core/physics';
import type {
  CellExplanation,
  FuelMap,
  FuelType,
  Insight,
  InsightKind,
  SimStateView,
  Terrain,
  TerrainDerived,
  TerrainFeatures,
  WeatherHour,
  WeatherSeries,
} from '../core/types';
import { CycleContext, freshMemory, type EngineMemory } from './context';
import { explainCell } from './explainCell';
import { analyseSeries, buildForecastInsights, type ForecastAnalysis } from './forecast';
import { EXPLAIN_PARAMS } from './params';
import { INSIGHT_RULES, RULE_LIST } from './registry';
import { ridgeGeometry } from './rules/general';
import { SEV_RANK, type InsightRule } from './rules/types';
import { DmzComputer, type DmzRosFn } from './safety';
import { StaticMaps } from './statics';
import type { Candidate } from './text';

const E = EXPLAIN_PARAMS.engine;

export interface InsightEngineOptions {
  /** unix ms of the scenario start (else learnt from forecastInsights, else weather.time is used as "now"). */
  startTime?: number;
  /** fire/ afdrsFbi (spec §2.4) for the S13 "FBI ≥ 50" branch; absent → weather branch only. */
  afdrsFbi?: (fuelType: FuelType, w: WeatherHour, lonDeg: number, df: number, kbdi: number) => { fbi: number; rating: string; intensity: number };
  /** Fuel type the FBI is evaluated for (dominant burnable type); default DryForestShrubby (4). */
  fbiFuelType?: FuelType;
  /** fuel/ fuelSummary (spec §4.7) for explainAt. */
  fuelSummary?: (fuel: FuelMap, k: number) => string;
  /** Rate-of-spread provider for the DMZ sweep (default: Mk5 estimate, see safety.ts). */
  dmzRos?: DmzRosFn;
  /** Rules to run (default: the full registry, in registry order). */
  rules?: readonly InsightRule[];
}

/** Key phases (plain constants: no const enum under isolatedModules). */
const Phase = { Idle: 0, Armed: 1, Shown: 2, Cooldown: 3 } as const;
type Phase = (typeof Phase)[keyof typeof Phase];

interface KeyState {
  key: string;
  kind: InsightKind;
  phase: Phase;
  cycles: number;
  /** Severity rank of the last shown card (−1 none). */
  sev: number;
  offAt: number;
  shownAt: number;
  cooldown: number;
  x: number;
  y: number;
}

export interface EngineCheckpoint {
  v: 1;
  states: KeyState[];
  mem: EngineMemory;
  startMs: number;
  dmzLayer: Float32Array | null;
}

interface Ready {
  st: KeyState;
  c: Candidate;
  rule: InsightRule;
  escalation: boolean;
  dist: number;
}

export class InsightEngine {
  readonly statics: StaticMaps;
  private readonly ctx: CycleContext;
  private readonly rules: readonly InsightRule[];
  private readonly ruleOf: Map<InsightKind, InsightRule>;
  private states = new Map<string, KeyState>();
  private mem: EngineMemory = freshMemory();
  private startMs: number;
  private readonly dmz: DmzComputer;
  private dmzLayer: Float32Array | null = null;
  private fcCache: { series: WeatherSeries; n: number; start: number; lon: number; a: ForecastAnalysis } | null = null;
  private readonly geoCache = new Map<number, { cross: number; leeSteeper: boolean }>();
  /** Wall-clock ms of the last update (performance monitor). */
  lastUpdateMs = 0;

  constructor(
    readonly terrain: Terrain,
    readonly derived: TerrainDerived,
    readonly fuel: FuelMap,
    readonly features: TerrainFeatures,
    private readonly opts: InsightEngineOptions = {},
  ) {
    this.statics = new StaticMaps(terrain, derived, fuel, features);
    this.ctx = new CycleContext(terrain, derived, fuel, features, this.statics);
    this.rules = opts.rules ?? RULE_LIST;
    this.ruleOf = new Map(this.rules.map((r) => [r.kind, r]));
    this.startMs = opts.startTime ?? NaN;
    this.dmz = new DmzComputer(terrain, fuel);
    this.ctx.services.dmz = (ctx, change) => {
      const r = this.dmz.compute(ctx.s, ctx.front, ctx.nFront, change, this.opts.dmzRos);
      const m = ctx.mem;
      m.dmzCells = r.cells;
      m.dmzAreaHa = r.areaHa;
      m.dmzX = r.x;
      m.dmzY = r.y;
      this.dmzLayer = r.cells > 0 ? r.layer : null;
    };
  }

  /** Recompute fuel-dependent caches after fuel edits (recent burns, wet gullies, fuel breaks). */
  refreshFuel(): void {
    this.statics.refreshFuel();
  }

  /** Overlay rasters for SimSnapshot.layers (spec §2.1): 'dmz' while a change is ≤ 60 min away. */
  layers(): Record<string, Float32Array> {
    return this.dmzLayer && this.mem.dmzCells > 0 ? { dmz: this.dmzLayer } : {};
  }

  private analysis(series: WeatherSeries, lonDeg: number): ForecastAnalysis | null {
    const hs = series.hours;
    if (hs.length === 0) return null;
    const start = Number.isFinite(this.startMs) ? this.startMs : hs[0]!.time;
    const c = this.fcCache;
    if (c && c.series === series && c.n === hs.length && c.start === start && c.lon === lonDeg) return c.a;
    const dur = Math.max(0, (hs[hs.length - 1]!.time - start) / 1000);
    const a = analyseSeries(series, start, dur, lonDeg);
    this.fcCache = { series, n: hs.length, start, lon: lonDeg, a };
    return a;
  }

  /** Run the detectors (every 60 s of simulated time; calls in between return []). */
  update(s: SimStateView): Insight[] {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const mem = this.mem;
    const ctx = this.ctx;
    const tSim = s.time > 1e11 ? (s.time - (Number.isFinite(this.startMs) ? this.startMs : (s.series.hours[0]?.time ?? s.time))) / 1000 : s.time;
    if (mem.lastRunT === mem.lastRunT && tSim - mem.lastRunT < E.cadenceS - 1e-6 && tSim >= mem.lastRunT) return [];
    const lon = this.terrain.grid.origin.lon;
    ctx.prepare(s, mem, this.startMs, this.analysis(s.series, lon));
    ctx.afdrsFbi = this.opts.afdrsFbi
      ? (w: WeatherHour) => this.opts.afdrsFbi!(this.opts.fbiFuelType ?? (4 as FuelType), w, lon, s.droughtFactor, s.kbdi).fbi
      : null;
    // New spot fires since the last cycle.
    const newSpots = [];
    let maxId = mem.spotMaxId;
    for (const sp of s.spotFires) {
      if (sp.id > mem.spotMaxId) newSpots.push(sp);
      if (sp.id > maxId) maxId = sp.id;
    }
    ctx.newSpots = newSpots;

    // Detect.
    const cands = new Map<string, { c: Candidate; rule: InsightRule }>();
    for (const rule of this.rules) {
      const list = rule.detect(s, ctx);
      for (const c of list) {
        const o = cands.get(c.key);
        if (!o || SEV_RANK[c.severity] > SEV_RANK[o.c.severity] || (c.severity === o.c.severity && c.score > o.c.score)) cands.set(c.key, { c, rule });
      }
    }

    // State machine.
    const t = ctx.t;
    const keys = new Set<string>(this.states.keys());
    for (const k of cands.keys()) keys.add(k);
    const ready: Ready[] = [];
    for (const key of [...keys].sort()) {
      const got = cands.get(key);
      let st = this.states.get(key);
      const rule = got?.rule ?? (st ? this.ruleOf.get(st.kind) : undefined);
      if (!rule) continue;
      if (!st) {
        st = { key, kind: rule.kind, phase: Phase.Idle, cycles: 0, sev: -1, offAt: -Infinity, shownAt: -Infinity, cooldown: rule.cooldown, x: 0, y: 0 };
        this.states.set(key, st);
      }
      const score = got ? got.c.score : 0;
      const sev = got ? SEV_RANK[got.c.severity] : -1;
      const persistence = got?.c.persistence ?? rule.persistence;
      if (got) {
        st.cooldown = got.c.cooldown ?? rule.cooldown;
        st.x = got.c.x;
        st.y = got.c.y;
      }
      let escalation = false;
      if (st.phase === Phase.Cooldown) {
        if (t - st.offAt >= st.cooldown) st.phase = Phase.Idle;
        else if (score >= 1 && sev > st.sev) escalation = true;
      }
      if (st.phase === Phase.Shown) {
        if (score >= E.hysteresis) {
          if (score >= 1 && sev > st.sev) escalation = true;
        } else {
          st.phase = Phase.Cooldown;
          st.offAt = t;
        }
      } else if (st.phase === Phase.Armed) {
        if (score >= 1) st.cycles++;
        else {
          st.phase = Phase.Idle;
          st.cycles = 0;
        }
        if (score >= 1 && st.sev >= 0 && sev > st.sev) escalation = true;
      } else if (st.phase === Phase.Idle) {
        if (score >= 1) {
          st.phase = Phase.Armed;
          st.cycles = 1;
        }
      }
      if (got && (escalation || (st.phase === Phase.Armed && st.cycles >= persistence))) {
        ready.push({ st, c: got.c, rule, escalation, dist: ctx.distToHead(got.c.x, got.c.y) });
      }
      if (st.phase === Phase.Idle && !got) this.states.delete(key);
    }

    // Kind-level de-duplication, ranking and the per-cycle cap.
    const selected: Ready[] = [];
    const kept: Ready[] = [];
    for (const r of ready) {
      if (!r.escalation && this.suppressed(r, t)) {
        // Track silently as shown so it neither spams nor re-arms while the nearby card is active.
        r.st.phase = Phase.Shown;
        r.st.sev = SEV_RANK[r.c.severity];
        r.st.shownAt = t;
        r.st.cycles = 0;
        continue;
      }
      kept.push(r);
    }
    kept.sort(
      (a, b) =>
        SEV_RANK[b.c.severity] - SEV_RANK[a.c.severity] || b.c.score - a.c.score || a.dist - b.dist || (a.st.key < b.st.key ? -1 : a.st.key > b.st.key ? 1 : 0),
    );
    for (const r of kept) {
      if (selected.length >= E.maxNewPerCycle) break;
      selected.push(r);
    }
    const out: Insight[] = [];
    for (const r of selected) {
      r.st.phase = Phase.Shown;
      r.st.sev = SEV_RANK[r.c.severity];
      r.st.shownAt = t;
      r.st.cycles = 0;
      r.rule.onShown?.(r.c, mem);
      out.push(this.render(r.rule, r.c, t));
    }
    mem.prevRunT = mem.lastRunT;
    mem.lastRunT = t;
    mem.spotMaxId = maxId;
    mem.spotSeen = s.spotFires.length;
    this.lastUpdateMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    return out;
  }

  private suppressed(r: Ready, t: number): boolean {
    const rad = r.rule.dedupRadiusM;
    if (!(rad > 0)) return false;
    const sev = SEV_RANK[r.c.severity];
    for (const o of this.states.values()) {
      if (o === r.st || o.kind !== r.st.kind || o.sev < sev) continue;
      const active = o.phase === Phase.Shown || (o.phase === Phase.Cooldown && t - o.offAt < o.cooldown);
      if (!active) continue;
      if (Math.hypot(o.x - r.c.x, o.y - r.c.y) <= rad) return true;
    }
    return false;
  }

  private render(rule: InsightRule, c: Candidate, t: number): Insight {
    const text = rule.render(c);
    return { id: `${c.key}@${Math.round(t)}`, kind: rule.kind, severity: c.severity, time: t, x: c.x, y: c.y, key: c.key, ...text };
  }

  /** "Why here?" explanation of the cell at (x, y) (spec §10.4). */
  explainAt(x: number, y: number, s: SimStateView): CellExplanation {
    const o: { fuelSummary?: (fuel: FuelMap, k: number) => string; startMs?: number } = {};
    if (this.opts.fuelSummary) o.fuelSummary = this.opts.fuelSummary;
    if (Number.isFinite(this.startMs)) o.startMs = this.startMs;
    return explainCell(x, y, s, o);
  }

  /** Forecast cards over [start, start + duration + 3 h] (spec §10.3). Also records the scenario start. */
  forecastInsights(series: WeatherSeries, start: number, duration: number, lonDeg: number): Insight[] {
    if (!Number.isFinite(this.startMs)) this.startMs = start;
    const g = this.terrain.grid;
    const a = analyseSeries(series, start, duration, lonDeg);
    this.fcCache = { series, n: series.hours.length, start, lon: lonDeg, a };
    const ctxLike = { statics: this.statics, features: this.features, terrain: this.terrain };
    const fbi = this.opts.afdrsFbi;
    const out = buildForecastInsights(
      series,
      start,
      duration,
      lonDeg,
      {
        x: g.x0 + ((g.nx - 1) * g.cellSize) / 2,
        y: g.y0 + ((g.ny - 1) * g.cellSize) / 2,
        relief: this.statics.relief,
        leeOfDivide: this.statics.leeOfDivide,
        ridgeGeometry: (from) => ridgeGeometry(ctxLike, from, this.geoCache),
      },
      a,
      fbi ? { afdrsFbi: (w) => fbi(this.opts.fbiFuelType ?? (4 as FuelType), w, lonDeg, series.droughtFactor ?? EXPLAIN_PARAMS.forecast.defaultDf, series.kbdi ?? 0).fbi } : {},
    );
    // The daily high-drought card of t0 is the forecast one.
    if (out.some((i) => i.kind === 'high-drought')) this.mem.highDroughtDay = localDate(start);
    return out;
  }

  checkpoint(): EngineCheckpoint {
    return {
      v: 1,
      states: [...this.states.values()].map((s) => ({ ...s })),
      mem: { ...this.mem, windHist: [...this.mem.windHist] },
      startMs: this.startMs,
      dmzLayer: this.dmzLayer ? this.dmzLayer.slice() : null,
    };
  }

  restore(c: unknown): void {
    const cp = c as EngineCheckpoint;
    if (!cp || cp.v !== 1) throw new Error('InsightEngine.restore: unknown checkpoint');
    this.states = new Map(cp.states.map((s) => [s.key, { ...s }]));
    this.mem = { ...cp.mem, windHist: [...cp.mem.windHist] };
    this.startMs = cp.startMs;
    this.dmzLayer = cp.dmzLayer ? cp.dmzLayer.slice() : null;
  }
}

export { INSIGHT_RULES };
