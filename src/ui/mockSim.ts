/**
 * MockSimController: a stand-in for the simulation worker (src/sim SimClient) that produces plausible synthetic
 * snapshots — fires growing as ellipses downwind and up-slope, spot fires and embers ahead of intense heads, a wind
 * change, and insight cards of several kinds (including Danger) with explanations — so the UI can be built,
 * exercised and screenshotted before the real engine is ready. Implements the SimController contract exactly.
 */
import {
  BurnState,
  FuelType,
  SpreadDriver,
  type CellExplanation,
  type FireField,
  type FuelEdit,
  type FuelMap,
  type Ignition,
  type Insight,
  type InsightKind,
  type InsightSeverity,
  type QualityTier,
  type ScenarioData,
  type ScenarioEdit,
  type SimSnapshot,
  type SimStats,
  type SpotFire,
  type WindEdit,
} from '../core/types';
import { cellAt } from '../core/grid';
import { Rng } from '../core/rng';
import { compassName, msToKmh, wrapDeg, windToUV } from '../core/units';
import type { SimController, SimEvents, SimOptionKey } from '../sim/protocol';
import { Emitter } from './store';
import { weatherAt } from './weatherSeries';
import { detectWindChanges, ffdi, ratingFromIndex, type WindChange } from './weatherCalc';
import { formatClock, formatDistance, formatDuration, formatIntensity, formatMetres, formatMultiplier, formatRos, formatYears, localHour } from './format';
import { cellMoisture, directionalRos, isBurnable, solveArrival, windAt, type MockFireResult, type Seed, type SolveInput } from './mockFire';
import { pointInRing, strokeToPolygon, type Pt } from './brushGeometry';
import { DRIVER_LABELS, FUEL_LABELS, LANDFORM_LABELS } from './labels';

const RESIDENCE_S = 20 * 60;
const TICK_MS = 70;

type Opts = { coupling: number; embers: boolean; mountainPhenomena: boolean };

export class MockSimController implements SimController {
  private readonly events = new Emitter<SimEvents>();
  private scenario: ScenarioData | null = null;
  private baseFuel: FuelMap | null = null;
  private fuel: FuelMap | null = null;
  private ignitions: Ignition[] = [];
  private edits: { edit: ScenarioEdit; time: number }[] = [];
  private spots: SpotFire[] = [];
  private moistureDelta: Float32Array | null = null;
  private result: MockFireResult | null = null;
  private dirty = true;
  private time = 0;
  private target = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private options: Opts = { coupling: 1, embers: true, mountainPhenomena: true };
  private lastInsight = new Map<string, number>();
  private windChanges: WindChange[] = [];
  private msPerSimMinute = 0;
  private insightSeq = 0;
  private disposed = false;
  private maxEmbers = 4000;
  /** Last quality tier requested (recorded only). */
  quality: QualityTier | null = null;

  async init(scenario: ScenarioData): Promise<Insight[]> {
    this.pause();
    this.scenario = scenario;
    this.baseFuel = scenario.fuel;
    this.fuel = cloneFuel(scenario.fuel);
    this.ignitions = [...scenario.ignitions];
    this.edits = scenario.edits.map((edit) => ({ edit, time: 0 }));
    this.options = { coupling: scenario.options.coupling, embers: scenario.options.embers, mountainPhenomena: scenario.options.mountainPhenomena };
    this.maxEmbers = scenario.options.maxEmbers ?? 4000;
    this.time = 0;
    this.target = 0;
    this.lastInsight.clear();
    this.rebuildFuel();
    this.windChanges = detectWindChanges(scenario.weather.hours).filter(
      (c) => c.time > scenario.startTime && c.time < scenario.startTime + scenario.duration * 1000,
    );
    const forecast = this.windChanges.map((c) => this.windChangeForecast(c));
    await new Promise((r) => setTimeout(r, 30));
    this.events.emit('ready', forecast);
    // First snapshot so the UI has stats and weather straight away.
    this.emitSnapshot(0, 0);
    return forecast;
  }

  run(until: number): void {
    if (!this.scenario) return;
    this.target = Math.min(until, this.scenario.duration);
    if (this.time >= this.target) {
      this.status(false);
      return;
    }
    if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
    this.status(true);
  }

  pause(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.status(false);
  }

  ignite(ignition: Ignition): void {
    this.ignitions.push(ignition);
    this.dirty = true;
    if (ignition.time < this.time) this.rewindTo(ignition.time);
  }

  edit(edit: ScenarioEdit, time: number): void {
    this.edits = this.edits.filter((e) => e.edit.id !== edit.id);
    this.edits.push({ edit, time });
    this.rebuildFuel();
    this.dirty = true;
    if (time < this.time) this.rewindTo(time);
  }

  removeEdit(id: string): void {
    this.edits = this.edits.filter((e) => e.edit.id !== id);
    this.rebuildFuel();
    this.dirty = true;
  }

  rewind(time: number): void {
    this.rewindTo(time);
    this.status(this.timer !== null);
  }

  /** Move the clock back to the snapshot "checkpoint" at or before `time` and tell the UI (FromWorker 'rewound'). */
  private rewindTo(time: number): void {
    // The mock's solution is deterministic, so rewinding only moves the clock back.
    this.time = this.snapTime(Math.max(0, time));
    for (const [k, t] of this.lastInsight) if (t > this.time) this.lastInsight.delete(k);
    this.events.emit('rewound', this.time);
  }

  setOption(key: SimOptionKey, value: number | boolean): void {
    if (key === 'coupling') this.options.coupling = Number(value);
    else if (key === 'maxEmbers') this.maxEmbers = Math.max(0, Number(value));
    else this.options[key] = Boolean(value);
    this.dirty = true;
  }

  /** Quality tier (fast / standard / high): the mock's cost does not depend on it, so it is only recorded. */
  setQuality(tier: QualityTier): void {
    this.quality = tier;
  }

  /** `time` (s) is an optional extension of the contract: explain at that time instead of the worker's clock. */
  async explain(x: number, y: number, time?: number): Promise<CellExplanation> {
    await new Promise((r) => setTimeout(r, 40));
    return this.explainNow(x, y, time ?? this.time);
  }

  on<K extends keyof SimEvents>(event: K, cb: SimEvents[K]): () => void {
    return this.events.on(event, cb);
  }

  dispose(): void {
    this.disposed = true;
    this.pause();
    this.events.clear();
    this.scenario = null;
    this.result = null;
  }

  // ───────────────────────────── internals ─────────────────────────────

  private get interval(): number {
    return this.scenario?.options.snapshotInterval ?? 300;
  }

  private snapTime(t: number): number {
    return Math.floor(t / this.interval) * this.interval;
  }

  private status(running: boolean): void {
    if (this.disposed) return;
    this.events.emit('status', { time: this.time, running, speed: running ? this.interval / (TICK_MS / 1000) : 0 });
  }

  private tick(): void {
    if (!this.scenario) return;
    if (this.time >= this.target) {
      this.pause();
      return;
    }
    const prev = this.time;
    this.time = Math.min(this.target, this.time + this.interval);
    this.emitSnapshot(prev, this.time);
    this.status(this.time < this.target);
    if (this.time >= this.target) this.pause();
  }

  private rebuildFuel(): void {
    if (!this.baseFuel) return;
    const fuel = cloneFuel(this.baseFuel);
    const g = fuel.grid;
    const delta = new Float32Array(g.nx * g.ny);
    let anyDelta = false;
    for (const { edit } of this.edits) {
      if (edit.kind !== 'fuel') continue;
      forEachCellIn(g, edit, (k) => {
        applyFuelEditCell(fuel, edit, k);
        if (edit.moistureDelta) {
          delta[k] = delta[k]! + edit.moistureDelta;
          anyDelta = true;
        }
      });
    }
    this.fuel = fuel;
    this.moistureDelta = anyDelta ? delta : null;
  }

  private windEdits(): WindEdit[] {
    return this.edits.map((e) => e.edit).filter((e): e is WindEdit => e.kind === 'wind');
  }

  private seeds(): Seed[] {
    const s: Seed[] = [];
    const cs = this.scenario!.terrain.grid.cellSize;
    for (const ign of this.ignitions) {
      if (ign.kind === 'point') {
        const [x, y] = ign.points[0]!;
        const r = ign.radius ?? cs;
        s.push({ x, y, time: ign.time });
        for (let a = 0; a < 8; a++) s.push({ x: x + r * Math.cos((a * Math.PI) / 4), y: y + r * Math.sin((a * Math.PI) / 4), time: ign.time });
      } else {
        const pts = ign.points;
        for (let p = 0; p < pts.length - (ign.kind === 'area' ? 0 : 1); p++) {
          const a = pts[p]!;
          const b = pts[(p + 1) % pts.length]!;
          const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
          const steps = Math.max(1, Math.ceil(L / cs));
          for (let t = 0; t <= steps; t++) s.push({ x: a[0] + ((b[0] - a[0]) * t) / steps, y: a[1] + ((b[1] - a[1]) * t) / steps, time: ign.time });
        }
      }
    }
    for (const sp of this.spots) s.push({ x: sp.x, y: sp.y, time: sp.time });
    return s;
  }

  private solveInput(): SolveInput {
    const sc = this.scenario!;
    return {
      terrain: sc.terrain,
      fuel: this.fuel!,
      weather: sc.weather,
      startTime: sc.startTime,
      horizon: sc.duration,
      seeds: this.seeds(),
      windEdits: this.windEdits(),
      moistureDelta: this.moistureDelta,
      options: { coupling: this.options.coupling, mountainPhenomena: this.options.mountainPhenomena },
    };
  }

  /** Solve, then place spot fires from intense heads (seeded), then solve again including them. */
  private ensureSolved(): void {
    if (!this.dirty && this.result) return;
    const t0 = performance.now();
    const sc = this.scenario!;
    this.spots = [];
    let res = solveArrival(this.solveInput());
    if (this.options.embers && this.ignitions.length) {
      const spots = this.placeSpots(res);
      if (spots.length) {
        this.spots = spots;
        res = solveArrival(this.solveInput());
      }
    }
    this.result = res;
    this.dirty = false;
    const ms = performance.now() - t0;
    this.msPerSimMinute = ms / Math.max(1, sc.duration / 60);
  }

  private placeSpots(res: MockFireResult): SpotFire[] {
    const sc = this.scenario!;
    const g = sc.terrain.grid;
    const rng = new Rng(sc.options.seed * 7919 + this.ignitions.length);
    const out: SpotFire[] = [];
    const n = g.nx * g.ny;
    for (let t = 600; t < sc.duration && out.length < 8; t += 600) {
      // Most intense cell that ignited in the last 10 minutes.
      let best = -1;
      let bestI = 0;
      for (let k = 0; k < n; k++) {
        const a = res.arrival[k]!;
        if (a > t - 600 && a <= t && res.intensity[k]! > bestI) {
          bestI = res.intensity[k]!;
          best = k;
        }
      }
      if (best < 0 || bestI < 2500) continue;
      if (rng.next() > Math.min(0.75, bestI / 12000)) continue;
      const bx = g.x0 + (best % g.nx) * g.cellSize;
      const by = g.y0 + Math.floor(best / g.nx) * g.cellSize;
      const w = windAt({ weather: sc.weather, startTime: sc.startTime, windEdits: this.windEdits() }, bx, by, t);
      if (msToKmh(w.speed) < 15) continue;
      const dist = Math.min(2500, Math.max(180, rng.logNormal(450, 0.55)));
      const az = wrapDeg(w.dir + 180 + rng.range(-18, 18));
      const x = bx + dist * Math.sin((az * Math.PI) / 180);
      const y = by + dist * Math.cos((az * Math.PI) / 180);
      const k = cellAt(g, x, y);
      if (k < 0 || !isBurnable(this.fuel!.type[k]!) || res.arrival[k]! < t + 400) continue;
      out.push({ id: out.length + 1, x, y, time: t + 180, distance: dist, travel: dist * 1.08 });
    }
    return out;
  }

  private emitSnapshot(prevT: number, t: number): void {
    if (!this.scenario || this.disposed) return;
    this.ensureSolved();
    const snap = this.buildSnapshot(t, prevT);
    this.events.emit('snapshot', snap);
  }

  private buildSnapshot(t: number, prevT: number): SimSnapshot {
    const sc = this.scenario!;
    const res = this.result!;
    const g = sc.terrain.grid;
    const n = g.nx * g.ny;
    const fuel = this.fuel!;
    const nowMs = sc.startTime + t * 1000;
    const w = weatherAt(sc.weather, nowMs);
    const hourLocal = localHour(nowMs, sc.weather.timezone);
    const fire: FireField = {
      grid: g,
      arrivalTime: new Float32Array(n),
      burnState: new Uint8Array(n),
      ros: new Float32Array(n),
      intensity: new Float32Array(n),
      flameHeight: new Float32Array(n),
      spreadDir: new Float32Array(n),
      driver: new Uint8Array(n),
      phase: new Uint8Array(n),
    };
    const moisture = new Float32Array(n);
    let burnt = 0;
    let burning = 0;
    let maxRos = 0;
    let maxI = 0;
    let headK = -1;
    let mSum = 0;
    let mCount = 0;
    const burningList: number[] = [];
    for (let k = 0; k < n; k++) {
      const type = fuel.type[k]!;
      const m = isBurnable(type) ? cellMoisture(sc.terrain, fuel, k, w, hourLocal, this.moistureDelta?.[k] ?? 0) : 0;
      moisture[k] = m;
      if (isBurnable(type)) {
        mSum += m;
        mCount++;
      }
      const a = res.arrival[k]!;
      if (a <= t) {
        fire.arrivalTime[k] = a;
        fire.ros[k] = res.ros[k]!;
        fire.intensity[k] = res.intensity[k]!;
        fire.flameHeight[k] = res.flameHeight[k]!;
        fire.spreadDir[k] = res.spreadDir[k]!;
        fire.driver[k] = res.driver[k]!;
        fire.phase[k] = res.phase[k]!;
        burnt++;
        if (res.ros[k]! > maxRos) maxRos = res.ros[k]!;
        if (res.intensity[k]! > maxI) maxI = res.intensity[k]!;
        if (t - a < RESIDENCE_S) {
          fire.burnState[k] = BurnState.Burning;
          burning++;
          burningList.push(k);
          if (headK < 0 || res.ros[k]! > res.ros[headK]!) headK = k;
        } else fire.burnState[k] = BurnState.BurntOut;
      } else {
        fire.arrivalTime[k] = Infinity;
        fire.burnState[k] = isBurnable(type) ? BurnState.Unburnt : BurnState.NonFlammable;
      }
    }
    // Perimeter length: burnt/unburnt cell edges.
    let edges = 0;
    for (let j = 0; j < g.ny; j++)
      for (let i = 0; i < g.nx; i++) {
        const k = j * g.nx + i;
        if (!(res.arrival[k]! <= t)) continue;
        if (i + 1 < g.nx && !(res.arrival[k + 1]! <= t)) edges++;
        if (i > 0 && !(res.arrival[k - 1]! <= t)) edges++;
        if (j + 1 < g.ny && !(res.arrival[k + g.nx]! <= t)) edges++;
        if (j > 0 && !(res.arrival[k - g.nx]! <= t)) edges++;
      }

    const spots = this.spots.filter((s) => s.time <= t);
    const embers = this.makeEmbers(t, burningList, w.windSpeed10, w.windDir10);
    const df = sc.weather.droughtFactor ?? 8;
    const fi = ffdi(w.temperature, w.relativeHumidity, msToKmh(w.windSpeed10), df);
    const headRos = headK >= 0 ? res.ros[headK]! : 0;
    const U = Math.max(0.5, w.windSpeed10);
    const nc = maxI > 0 ? (2 * 9.81 * (headK >= 0 ? res.intensity[headK]! : maxI) * 1000) / (1.1 * 1005 * (w.temperature + 273.15) * Math.max(0.3, U - headRos) ** 3) : 0;
    const stats: SimStats = {
      time: t,
      burntAreaHa: (burnt * g.cellSize * g.cellSize) / 10_000,
      burningCells: burning,
      perimeterKm: (edges * g.cellSize) / 1000,
      maxRos,
      maxIntensity: maxI,
      headDir: headK >= 0 ? res.spreadDir[headK]! : Number.NaN,
      headRos,
      activeEmbers: embers.count,
      spotFires: spots.length,
      embersLeftDomain: Math.round(spots.length * 3.5),
      convectiveNumber: nc,
      weather: w,
      deadFuelMoistureMean: mCount ? mSum / mCount : Number.NaN,
      ffdi: fi,
      fireDangerRating: ratingFromIndex(fi).label,
      msPerSimMinute: this.msPerSimMinute,
    };
    const snap: SimSnapshot = { time: t, fire, moisture, embers, spotFires: spots, stats, insights: [] };
    snap.insights = this.detectInsights(prevT, t, snap, headK);
    return snap;
  }

  private makeEmbers(t: number, burning: number[], windMs: number, windDir: number): { count: number; data: Float32Array } {
    const sc = this.scenario!;
    if (!this.options.embers || burning.length === 0) return { count: 0, data: new Float32Array(0) };
    const res = this.result!;
    const g = sc.terrain.grid;
    const rng = new Rng(Math.floor(t) + 17);
    const hot = burning.filter((k) => res.intensity[k]! > 1500);
    const count = Math.min(900, this.maxEmbers, hot.length * 6);
    const data = new Float32Array(count * 4);
    const [u, v] = windToUV(1, windDir);
    for (let e = 0; e < count; e++) {
      const k = hot[rng.int(hot.length)]!;
      const x0 = g.x0 + (k % g.nx) * g.cellSize;
      const y0 = g.y0 + Math.floor(k / g.nx) * g.cellSize;
      const d = rng.next() ** 2 * Math.min(2500, 60 * windMs + res.intensity[k]! / 20);
      const side = rng.normal() * 0.12 * d;
      const x = x0 + u * d - v * side;
      const y = y0 + v * d + u * side;
      const kk = cellAt(g, x, y);
      const zg = kk >= 0 ? sc.terrain.elevation[kk]! : sc.terrain.minElevation;
      const frac = d / Math.max(1, 60 * windMs + res.intensity[k]! / 20);
      data.set([x, y, zg + 20 + (1 - frac) * rng.range(40, 450), 1 - frac * 0.8], e * 4);
    }
    return { count, data };
  }

  // ───────────────────────────── insights ─────────────────────────────

  private insight(kind: InsightKind, severity: InsightSeverity, time: number, x: number, y: number, title: string, body: string, safety: string | undefined, factors: Insight['factors'], source?: string): Insight {
    this.insightSeq += 1;
    const ins: Insight = { id: `mock-${kind}-${Math.round(time)}-${this.insightSeq}`, kind, severity, time, x, y, title, body, factors };
    if (safety) ins.safety = safety;
    if (source) ins.source = source;
    return ins;
  }

  private windChangeForecast(c: WindChange): Insight {
    const sc = this.scenario!;
    const t = (c.time - sc.startTime) / 1000;
    return this.insight(
      'wind-change',
      'watch',
      t,
      0,
      0,
      `Wind change at ${formatClock(c.time, sc.weather.timezone)}`,
      `The forecast has the wind swinging from ${compassName(c.fromDir)} to ${compassName(c.toDir)} at about ${Math.round(c.speedAfterKmh)} km/h. When it does, the long flank of any fire becomes a wide head fire.`,
      'Plan where the fire will run after the change and who needs to know. Education only. LACES first.',
      [
        { label: 'Direction', value: `${compassName(c.fromDir)} → ${compassName(c.toDir)}`, effect: `${Math.round(Math.abs(c.turn))}° turn` },
        { label: 'Wind after', value: `${Math.round(c.speedAfterKmh)} km/h` },
      ],
      'Cheney et al. 2001 (dead man zone); Lahaye et al. 2018',
    );
  }

  private cool(kind: string, t: number, cooldown = 3600): boolean {
    const last = this.lastInsight.get(kind);
    if (last !== undefined && t - last < cooldown) return false;
    this.lastInsight.set(kind, t);
    return true;
  }

  private detectInsights(prevT: number, t: number, snap: SimSnapshot, headK: number): Insight[] {
    const sc = this.scenario!;
    const out: Insight[] = [];
    if (t <= prevT) return out;
    const g = sc.terrain.grid;
    const res = this.result!;
    const tz = sc.weather.timezone;
    const hasFire = snap.stats.burningCells > 0;
    const hx = headK >= 0 ? g.x0 + (headK % g.nx) * g.cellSize : 0;
    const hy = headK >= 0 ? g.y0 + Math.floor(headK / g.nx) * g.cellSize : 0;

    // Wind change approaching: Danger 30 min before, when there is fire on the ground.
    for (const c of this.windChanges) {
      const ct = (c.time - sc.startTime) / 1000;
      if (hasFire && ct - 1800 > prevT && ct - 1800 <= t && this.cool(`wc-${c.time}`, t, 1e9)) {
        // The flank that becomes the head: cells burning on the side facing the new wind-to direction.
        out.push(
          this.insight(
            'dead-man-zone',
            'danger',
            ct - 1800,
            hx,
            hy,
            'Wind change in 30 minutes',
            `At ${formatClock(c.time, tz)} the wind swings from ${compassName(c.fromDir)} to ${compassName(c.toDir)}. The ${compassName(wrapDeg(c.toDir + 180))}-facing flank becomes the head fire and will move out at full speed almost at once. Ground it would reach within about 5 minutes is the dead man zone.`,
            'Get into the black or a safety refuge before the change. Make sure everyone knows the time of the change. Education only. LACES first. Follow your Crew Leader.',
            [
              { label: 'New wind', value: `${compassName(c.toDir)} ${Math.round(c.speedAfterKmh)} km/h`, effect: `${Math.round(Math.abs(c.turn))}° turn` },
              { label: 'Fire edge length', value: `${snap.stats.perimeterKm.toFixed(1)} km` },
            ],
            'Cheney, Gould & McCaw 2001; Linton 1998 coronial findings',
          ),
        );
      }
    }
    if (!hasFire || headK < 0) return out;
    const terrain = sc.terrain;
    const fuel = this.fuel!;
    const f = res.factors;
    const slopeF = f[headK * 6 + 4]!;
    const windF = f[headK * 6 + 1]!;
    const thetaUp = terrain.slopeDeg[headK]!;
    const rosTxt = formatRos(res.ros[headK]!);
    const flat = res.ros[headK]! / Math.max(0.01, slopeF);

    if (slopeF > 2.2 && thetaUp > 24 && this.options.mountainPhenomena && this.cool('eruptive', t, 5400)) {
      out.push(
        this.insight(
          'eruptive-slope',
          'danger',
          t,
          hx,
          hy,
          'Steep slope: flames may stick',
          `The head is climbing a slope of about ${Math.round(thetaUp)}°. Above about 24° flames lie down onto the fuel ahead and the fire can accelerate on its own, without any change in the weather. Models under-predict here — treat ${rosTxt} as the low end.`,
          'Never be above a fire on a slope this steep. Escape routes go downhill, sideways or into the black. Education only. LACES first. Follow your Crew Leader.',
          [
            { label: 'Slope', value: `${Math.round(thetaUp)}°`, effect: `${formatMultiplier(slopeF)} spread` },
            { label: 'Spread now', value: rosTxt },
          ],
          'Wu et al. 2000; Viegas 2005; IRPG 2025 p. 35',
        ),
      );
    } else if (slopeF > 1.6 && this.cool('upslope', t, 3600)) {
      out.push(
        this.insight(
          'upslope-run',
          'watch',
          t,
          hx,
          hy,
          'Fire running uphill',
          `The fire is climbing a slope of about ${Math.round(thetaUp)}°. Uphill, flames lean into the fuel above and pre-heat it, so it spreads about ${formatMultiplier(slopeF)} faster than on flat ground: ${rosTxt} instead of about ${formatRos(flat)}.`,
          'Never position yourself upslope of a fire. Your escape route should not go uphill.',
          [
            { label: 'Slope', value: `${Math.round(thetaUp)}°`, effect: `${formatMultiplier(slopeF)} spread` },
            { label: 'Wind', value: `${Math.round(msToKmh(snap.stats.weather.windSpeed10))} km/h`, effect: `${formatMultiplier(windF)}` },
          ],
          'McArthur 1967; Noble et al. 1980',
        ),
      );
    }

    if (snap.spotFires.length) {
      const fresh = snap.spotFires.filter((s) => s.time > prevT && s.time <= t);
      for (const s of fresh) {
        const first = snap.spotFires.length === 1 || snap.spotFires.indexOf(s) === 0;
        out.push(
          this.insight(
            first ? 'spotting' : 'spot-fire',
            s.distance > 500 ? 'danger' : 'watch',
            s.time,
            s.x,
            s.y,
            first ? 'Embers starting spot fires' : `Spot fire ${formatDistance(s.distance)} ahead`,
            `Burning bark carried by the ${Math.round(msToKmh(snap.stats.weather.windSpeed10))} km/h wind has started a new fire about ${formatDistance(s.distance)} ahead of the front, in dry fuel. New fires can start in front of you, not just at the edge.`,
            s.distance > 500 ? 'Post a lookout that can see downwind. A spot fire below you will run uphill to meet the main fire. Education only. LACES first. Follow your Crew Leader.' : 'Post a lookout that can see downwind of the fire.',
            [
              { label: 'Distance ahead', value: formatDistance(s.distance) },
              { label: 'Litter moisture', value: `${snap.stats.deadFuelMoistureMean.toFixed(1)}%` },
            ],
            'Storey et al. 2020; doc 06',
          ),
        );
      }
    }

    const lf = terrain.landform[headK]!;
    if ((LANDFORM_LABELS[lf as keyof typeof LANDFORM_LABELS] === 'Ridge top' || terrain.tpi[headK]! > 25) && this.cool('ridge', t, 5400)) {
      out.push(
        this.insight(
          'ridge-crest',
          'watch',
          t,
          hx,
          hy,
          'Fire reaching the ridge',
          'At the ridge top the fire meets stronger wind, and embers are thrown over into the next valley. Fires often start on the far side before the main fire arrives.',
          'If you are on the ridge or in the next valley, post a lookout facing the far side too.',
          [{ label: 'Height above surroundings', value: `${Math.round(terrain.tpi[headK]!)} m` }],
          'Sharples 2009; doc 02',
        ),
      );
    }

    // Slow burning in a moist gully / wet forest.
    const wet = res.driver[headK] === SpreadDriver.Backing ? -1 : this.findWetBurning(t);
    if (wet >= 0 && this.cool('moist', t, 7200)) {
      out.push(
        this.insight(
          'moist-gully',
          'info',
          t,
          g.x0 + (wet % g.nx) * g.cellSize,
          g.y0 + Math.floor(wet / g.nx) * g.cellSize,
          'Shady gully: wetter, but not safe',
          `Litter in this ${FUEL_LABELS[fuel.type[wet] as FuelType].toLowerCase()} is about ${snap.moisture[wet]!.toFixed(0)}% moisture, so the fire is creeping here. In drought or strong wind, gullies like this burn too.`,
          'Do not rely on a moist gully to stop a fire tomorrow.',
          [{ label: 'Litter moisture', value: `${snap.moisture[wet]!.toFixed(0)}%` }],
          'Nyman et al. 2015; doc 04',
        ),
      );
    }

    if (snap.stats.convectiveNumber > 10 && this.cool('plume', t, 7200)) {
      out.push(
        this.insight(
          'plume-dominated',
          'watch',
          t,
          hx,
          hy,
          'The fire is making its own weather',
          `The fire's heat is now stronger than the wind (convective number about ${Math.round(snap.stats.convectiveNumber)}). Smoke goes straight up and winds near the fire are pulled towards it from all sides. Normal wind-based predictions become unreliable.`,
          'Expect erratic winds near the fire. Watch the column for collapse.',
          [{ label: 'Byram convective number', value: snap.stats.convectiveNumber.toFixed(0), effect: '> 10 plume-dominated' }],
          'Morvan & Frangieh 2018; doc 07',
        ),
      );
    }

    const hour = localHour(sc.startTime + t * 1000, tz);
    if ((hour >= 20 || hour < 5) && this.cool('night', t, 6 * 3600)) {
      out.push(
        this.insight(
          'night-slowdown',
          'info',
          t,
          hx,
          hy,
          'Night: the fire slows, the ridges don’t',
          'After dark, humidity rises and cool air drains down the slopes, so most of the fire quietens. Ridge tops above the cold air and the mid-slope thermal belt can stay active all night.',
          'Night work still needs lookouts; expect the fire to pick up again mid-morning.',
          [{ label: 'Local time', value: formatClock(sc.startTime + t * 1000, tz) }],
          'Sharples 2009; Holden & Jolly 2011',
        ),
      );
    }
    if (hour >= 13 && hour < 17 && snap.stats.ffdi > 25 && this.cool('afternoon', t, 6 * 3600)) {
      out.push(
        this.insight(
          'afternoon-peak',
          'watch',
          t,
          hx,
          hy,
          'Peak burning period',
          `It is ${formatClock(sc.startTime + t * 1000, tz)}: the hottest, driest part of the day. Litter moisture is about ${snap.stats.deadFuelMoistureMean.toFixed(1)}% and the FFDI is about ${Math.round(snap.stats.ffdi)}.`,
          'The critical burn period is 14:00–17:00. Re-check your escape routes.',
          [
            { label: 'FFDI', value: Math.round(snap.stats.ffdi).toString(), effect: snap.stats.fireDangerRating },
            { label: 'Temperature', value: `${Math.round(snap.stats.weather.temperature)} °C` },
          ],
          'IRPG 2025 common denominators',
        ),
      );
    }
    return out;
  }

  private findWetBurning(t: number): number {
    const res = this.result!;
    const fuel = this.fuel!;
    const n = res.arrival.length;
    for (let k = 0; k < n; k += 7) {
      const a = res.arrival[k]!;
      if (a <= t && t - a < RESIDENCE_S && (fuel.type[k] === FuelType.WetForest || fuel.type[k] === FuelType.Rainforest)) return k;
    }
    return -1;
  }

  // ───────────────────────────── explanation ─────────────────────────────

  private explainNow(x: number, y: number, t: number): CellExplanation {
    const sc = this.scenario;
    if (!sc) throw new Error('Not initialised');
    this.ensureSolved();
    const terrain = sc.terrain;
    const g = terrain.grid;
    const fuel = this.fuel!;
    let k = cellAt(g, x, y);
    if (k < 0) k = 0;
    const res = this.result!;
    const nowMs = sc.startTime + t * 1000;
    const w = weatherAt(sc.weather, nowMs);
    const input = this.solveInput();
    const wind = windAt(input, x, y, t);
    const moisture = isBurnable(fuel.type[k]!) ? cellMoisture(terrain, fuel, k, w, localHour(nowMs, sc.weather.timezone), this.moistureDelta?.[k] ?? 0) : 0;
    const burnt = res.arrival[k]! <= t;
    let factors;
    let ros: number;
    let driver: SpreadDriver;
    if (burnt) {
      const f = res.factors.subarray(k * 6, k * 6 + 6);
      factors = { base: f[0]!, wind: f[1]!, moisture: f[2]!, fuel: f[3]!, slope: f[4]!, terrain: f[5]! };
      ros = res.ros[k]!;
      driver = res.driver[k] as SpreadDriver;
    } else {
      const d = directionalRos(input, k, wrapDeg(wind.dir + 180), t, { wind, moisture });
      factors = d.f;
      ros = d.ros;
      driver = SpreadDriver.None;
    }
    const type = fuel.type[k] as FuelType;
    const slope = terrain.slopeDeg[k]!;
    const aspect = terrain.aspectDeg[k]!;
    const lf = terrain.landform[k]!;
    const tsf = fuel.timeSinceFire[k]!;
    const kmh = msToKmh(wind.speed);
    const hazard = (v: number): string => ['nil', 'low', 'moderate', 'high', 'very high'][Math.max(0, Math.min(4, Math.round(v)))]!;
    const fuelSummary = isBurnable(type)
      ? `${FUEL_LABELS[type]}: litter ${hazard(fuel.surfaceHazard[k]!)}, shrubs ${hazard(fuel.elevatedHazard[k]!)} (${formatMetres(fuel.elevatedHeight[k]!)}), bark ${hazard(fuel.barkHazard[k]!)}; about ${Math.round(fuel.surfaceLoad[k]! + fuel.nearSurfaceLoad[k]! + fuel.elevatedLoad[k]! + fuel.barkLoad[k]!)} t/ha fine fuel`
      : `${FUEL_LABELS[type]} — nothing to burn`;
    const upAz = wrapDeg((Number.isFinite(aspect) ? aspect : 0) + 180);
    const narrative: string[] = [];
    if (slope >= 5) narrative.push(`Uphill is towards the ${compassName(upAz)}. A fire running up this slope would spread about ${formatMultiplier(Math.exp(0.069 * Math.min(45, slope)))} faster than on flat ground${slope > 20 ? ' — and on slopes this steep real fires often go faster than any model' : ''}.`);
    narrative.push(`The ${Math.round(kmh)} km/h ${compassName(wind.dir)} wind pushes a head fire towards the ${compassName(wrapDeg(wind.dir + 180))}: ${formatMultiplier(factors.wind)} on its own.`);
    if (isBurnable(type)) {
      narrative.push(`Litter moisture is about ${moisture.toFixed(0)}% — ${moisture < 7 ? 'very dry: embers will catch easily' : moisture < 12 ? 'dry enough to carry fire well' : moisture < 20 ? 'moist: fire spreads slowly' : 'wet: fire struggles to spread'}.`);
      narrative.push(`${formatYears(tsf) === 'No record' ? 'No recorded fire here' : `Last burnt ${formatYears(tsf)} ago`}; ${fuel.barkHazard[k]! >= 3 ? 'stringy bark makes this a strong ember source' : 'bark is not a major ember source'}.`);
    }
    if (burnt) {
      narrative.push(`Fire arrived at ${formatClock(sc.startTime + res.arrival[k]! * 1000, sc.weather.timezone)} (${formatDuration(t - res.arrival[k]!)} ago), moving at ${formatRos(ros)} with flames about ${formatMetres(res.flameHeight[k]!)} — ${formatIntensity(res.intensity[k]!)}. Main driver: ${DRIVER_LABELS[driver].toLowerCase()}.`);
    } else if (isBurnable(type)) {
      narrative.push(`Not burnt yet. A head fire arriving now would move at about ${formatRos(ros)}.`);
    }
    return {
      x,
      y,
      elevation: terrain.elevation[k]!,
      slopeDeg: slope,
      aspectDeg: aspect,
      landform: lf,
      fuelType: type,
      fuelSummary,
      deadFuelMoisture: moisture,
      timeSinceFire: tsf,
      windSpeed10: wind.speed,
      windDir10: wind.dir,
      arrivalTime: burnt ? res.arrival[k]! : Infinity,
      ros,
      intensity: burnt ? res.intensity[k]! : 0,
      flameHeight: burnt ? res.flameHeight[k]! : 0,
      driver,
      factors,
      narrative,
    };
  }
}

// ───────────────────────────── helpers ─────────────────────────────

function cloneFuel(f: FuelMap): FuelMap {
  return {
    grid: f.grid,
    type: f.type.slice(),
    surfaceHazard: f.surfaceHazard.slice(),
    nearSurfaceHazard: f.nearSurfaceHazard.slice(),
    nearSurfaceHeight: f.nearSurfaceHeight.slice(),
    elevatedHazard: f.elevatedHazard.slice(),
    elevatedHeight: f.elevatedHeight.slice(),
    barkHazard: f.barkHazard.slice(),
    surfaceLoad: f.surfaceLoad.slice(),
    nearSurfaceLoad: f.nearSurfaceLoad.slice(),
    elevatedLoad: f.elevatedLoad.slice(),
    barkLoad: f.barkLoad.slice(),
    canopyHeight: f.canopyHeight.slice(),
    canopyCover: f.canopyCover.slice(),
    curing: f.curing.slice(),
    timeSinceFire: f.timeSinceFire.slice(),
    lastFireKind: f.lastFireKind.slice(),
    sources: [...f.sources],
  };
}

/** Visit every cell whose centre lies inside a fuel edit's shape. */
export function forEachCellIn(g: FuelMap['grid'], edit: FuelEdit, fn: (k: number) => void): void {
  const s = edit.shape;
  let ring: Pt[];
  if (s.kind === 'circle') ring = strokeToPolygon([[s.x, s.y]], s.radius);
  else ring = s.points;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const [x, y] of ring) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  const i0 = Math.max(0, Math.floor((x0 - g.x0) / g.cellSize));
  const i1 = Math.min(g.nx - 1, Math.ceil((x1 - g.x0) / g.cellSize));
  const j0 = Math.max(0, Math.floor((y0 - g.y0) / g.cellSize));
  const j1 = Math.min(g.ny - 1, Math.ceil((y1 - g.y0) / g.cellSize));
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) if (pointInRing(g.x0 + i * g.cellSize, g.y0 + j * g.cellSize, ring)) fn(j * g.nx + i);
}

function applyFuelEditCell(f: FuelMap, e: FuelEdit, k: number): void {
  const c = (v: number): number => Math.min(4, Math.max(0, v));
  if (e.setType !== undefined) {
    f.type[k] = e.setType;
    if (e.setType === FuelType.NonFuel) {
      f.surfaceHazard[k] = f.nearSurfaceHazard[k] = f.elevatedHazard[k] = f.barkHazard[k] = 0;
      f.surfaceLoad[k] = f.nearSurfaceLoad[k] = f.elevatedLoad[k] = f.barkLoad[k] = 0;
    }
  }
  if (e.surfaceHazardDelta) {
    f.surfaceHazard[k] = c(f.surfaceHazard[k]! + e.surfaceHazardDelta);
    f.surfaceLoad[k] = Math.max(0, f.surfaceLoad[k]! + e.surfaceHazardDelta * 4);
  }
  if (e.nearSurfaceHazardDelta) f.nearSurfaceHazard[k] = c(f.nearSurfaceHazard[k]! + e.nearSurfaceHazardDelta);
  if (e.elevatedHazardDelta) {
    f.elevatedHazard[k] = c(f.elevatedHazard[k]! + e.elevatedHazardDelta);
    f.elevatedLoad[k] = Math.max(0, f.elevatedLoad[k]! + e.elevatedHazardDelta * 2);
  }
  if (e.barkHazardDelta) {
    f.barkHazard[k] = c(f.barkHazard[k]! + e.barkHazardDelta);
    f.barkLoad[k] = Math.max(0, f.barkLoad[k]! + e.barkHazardDelta);
  }
  if (e.elevatedHeight !== undefined) f.elevatedHeight[k] = e.elevatedHeight;
  if (e.setTimeSinceFire !== undefined) {
    f.timeSinceFire[k] = e.setTimeSinceFire;
    const acc = 1 - Math.exp(-e.setTimeSinceFire / 5);
    f.surfaceHazard[k] = f.surfaceHazard[k]! * (0.3 + 0.7 * acc);
    f.surfaceLoad[k] = f.surfaceLoad[k]! * acc;
    f.elevatedHazard[k] = f.elevatedHazard[k]! * (0.2 + 0.8 * acc);
    f.elevatedLoad[k] = f.elevatedLoad[k]! * acc;
  }
}
