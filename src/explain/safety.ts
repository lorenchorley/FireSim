/**
 * Safety overlays (spec §10.5, P1): the dead-man zone (DMZ) — a Dijkstra sweep on a 60 m grid from the current
 * perimeter with the §7.4 three-speed convex ellipse under the post-change wind — plus the refuge rule
 * (clear distance ≥ 4 × flame height, IRPG doubling note) and Tobler walking speeds.
 *
 * DMZ rate of spread: the sim can inject its own `DmzRosFn` (e.g. the fire module's object API under the new
 * wind). The built-in estimate [H] is McArthur Mk5 (spec §6.4, a verified comparison model) from the post-change
 * forecast T, RH, U10 and DF and the cell's fine fuel load, with the D2/D3 slope factors inside the three speeds and
 * the family LB (§6.8). It ignores fire–atmosphere feedback, so the zone is a lower bound (doc 10 §9.4, "at least").
 */
import type { GridSpec } from '../core/grid';
import { BurnState, type FuelMap, type SimStateView, type Terrain } from '../core/types';
import { RAD, wrapDeg } from '../core/units';
import { ellipseCoefficients, createEllipseCoeffs, familyAt, ffdi, isNonFuel, lengthToBreadth, mk5 } from './deps';
import { weatherAtMs } from './forecast';
import { EXPLAIN_PARAMS } from './params';
import { kataburn } from './text';

const S = EXPLAIN_PARAMS.safety;

// ─────────────────────────────────────────────────────────────────────────────
// Walking speed and refuge rule
// ─────────────────────────────────────────────────────────────────────────────

/** Tobler (1993) hiking speed (km/h) on a slope θ (deg, + uphill): v = 6·exp(−3.5·|tan θ + 0.05|) [V]. */
export function toblerKmh(slopeDeg: number): number {
  return S.toblerBase * Math.exp(-S.toblerK * Math.abs(Math.tan(slopeDeg / RAD) + S.toblerOffset));
}

/** Firefighter walking speed (km/h): Tobler × 0.6 off-track × 0.8 load (doc 10 §9.3). */
export function walkingSpeedKmh(slopeDeg: number, offTrack = true, loaded = true): number {
  return toblerKmh(slopeDeg) * (offTrack ? S.offTrack : 1) * (loaded ? S.load : 1);
}

export interface RefugeCheck {
  /** Required clear distance (m) = 4 × FH. */
  requiredM: number;
  /** True when the IRPG "may more than double" condition applies (approach slope > 11° or U10 > 16 km/h). */
  doubled: boolean;
  ok: boolean;
  note: string;
}

/** Refuge rule display (spec §10.5): clear distance ≥ 4 × FH [V LACES], doubling note per IRPG 2025 p. 5. */
export function refugeCheck(clearM: number, flameHeightM: number, approachSlopeDeg: number, u10Kmh: number): RefugeCheck {
  const req = S.refugeMultiple * Math.max(0, flameHeightM);
  const doubled = approachSlopeDeg > S.doublingSlopeDeg || u10Kmh > S.doublingWindKmh;
  const ok = clearM >= req * (doubled ? 2 : 1);
  const base = `A refuge needs clear ground of at least 4 × the flame height: about ${Math.round(req)} m here.`;
  const dbl = doubled ? ' On this slope or in this wind it may need more than double that.' : '';
  const verdict = ok ? ' This clearing is larger than that, so it is less exposed.' : ' This clearing is too small.';
  return { requiredM: req, doubled, ok, note: base + dbl + verdict };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dead-man zone
// ─────────────────────────────────────────────────────────────────────────────

/** Head / back / flank speeds (m/s) and the head azimuth at a fire cell under a hypothetical wind. */
export interface DmzSpeeds {
  rH: number;
  rB: number;
  rF: number;
  /** Head azimuth (deg, towards). */
  e: number;
}
export type DmzRosFn = (k: number, u10Ms: number, windToDeg: number, out: DmzSpeeds) => void;

/** Binary min-heap of (key, node) with lazy deletion. */
class MinHeap {
  private keys: Float64Array;
  private vals: Int32Array;
  size = 0;
  constructor(cap: number) {
    this.keys = new Float64Array(cap);
    this.vals = new Int32Array(cap);
  }
  push(key: number, val: number): void {
    if (this.size === this.keys.length) {
      const k = new Float64Array(this.size * 2);
      k.set(this.keys);
      this.keys = k;
      const v = new Int32Array(this.size * 2);
      v.set(this.vals);
      this.vals = v;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p]! <= key) break;
      this.keys[i] = this.keys[p]!;
      this.vals[i] = this.vals[p]!;
      i = p;
    }
    this.keys[i] = key;
    this.vals[i] = val;
  }
  /** Pop the minimum; returns the node and leaves its key in `lastKey`. */
  lastKey = 0;
  pop(): number {
    const top = this.vals[0]!;
    this.lastKey = this.keys[0]!;
    const n = --this.size;
    if (n > 0) {
      const key = this.keys[n]!;
      const val = this.vals[n]!;
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && this.keys[c + 1]! < this.keys[c]!) c++;
        if (this.keys[c]! >= key) break;
        this.keys[i] = this.keys[c]!;
        this.vals[i] = this.vals[c]!;
        i = c;
      }
      this.keys[i] = key;
      this.vals[i] = val;
    }
    return top;
  }
}

const SF = (theta: number): number => (theta >= 0 ? Math.min(16, Math.pow(2, theta / 10)) : kataburn(theta));

export interface DmzResult {
  /** Fire-grid raster 0–1 (1 at the perimeter, → 0 at 5 min, 0 outside), for SimSnapshot.layers.dmz. */
  layer: Float32Array;
  cells: number;
  areaHa: number;
  x: number;
  y: number;
  /** Wall-clock ms of the sweep. */
  ms: number;
}

export class DmzComputer {
  readonly grid: GridSpec;
  readonly f: number;
  readonly cnx: number;
  readonly cny: number;
  readonly layer: Float32Array;
  private readonly time: Float64Array;
  private readonly rep: Int32Array;
  private readonly aC: Float32Array;
  private readonly cC: Float32Array;
  private readonly bC: Float32Array;
  private readonly eX: Float32Array;
  private readonly eY: Float32Array;
  private readonly stamp: Int32Array;
  private run = 0;
  private readonly heap: MinHeap;
  private readonly sp: DmzSpeeds = { rH: 0, rB: 0, rF: 0, e: 0 };
  private readonly ell = createEllipseCoeffs();

  constructor(
    readonly terrain: Terrain,
    readonly fuel: FuelMap,
  ) {
    const g = (this.grid = terrain.grid);
    this.f = Math.max(1, Math.round(EXPLAIN_PARAMS.dmz.gridM / g.cellSize));
    this.cnx = Math.ceil(g.nx / this.f);
    this.cny = Math.ceil(g.ny / this.f);
    const n = this.cnx * this.cny;
    this.layer = new Float32Array(g.nx * g.ny);
    this.time = new Float64Array(n);
    this.rep = new Int32Array(n);
    this.aC = new Float32Array(n);
    this.cC = new Float32Array(n);
    this.bC = new Float32Array(n);
    this.eX = new Float32Array(n);
    this.eY = new Float32Array(n);
    this.stamp = new Int32Array(n);
    this.heap = new MinHeap(4096);
    for (let cj = 0; cj < this.cny; cj++) {
      for (let ci = 0; ci < this.cnx; ci++) {
        const i = Math.min(g.nx - 1, ci * this.f + (this.f >> 1));
        const j = Math.min(g.ny - 1, cj * this.f + (this.f >> 1));
        this.rep[cj * this.cnx + ci] = j * g.nx + i;
      }
    }
  }

  /** Built-in Mk5-based head/back/flank speeds for the post-change weather (see file header). */
  defaultRos(s: SimStateView, change: { time: number; postSpeed: number }): DmzRosFn {
    const w = weatherAtMs(s.series, change.time) ?? s.weather;
    const F = ffdi(w.temperature, w.relativeHumidity, change.postSpeed * 3.6, s.droughtFactor);
    const t = this.terrain;
    const fuel = this.fuel;
    const ell = this.ell;
    return (k, u10, windTo, out) => {
      const W = fuel.surfaceLoad[k]! + fuel.nearSurfaceLoad[k]! + fuel.elevatedLoad[k]!;
      const r = mk5(F, Math.max(W, 2)).rosMh / 3600;
      ellipseCoefficients(lengthToBreadth(familyAt(fuel, k), u10 * 3.6), ell);
      const e = windTo;
      const th = (az: number): number => Math.atan(t.dzdx[k]! * Math.sin(az / RAD) + t.dzdy[k]! * Math.cos(az / RAD)) * RAD;
      const te = th(e);
      out.e = e;
      out.rH = r * SF(te);
      out.rB = Math.min(out.rH, ell.cb * r * SF(-te));
      out.rF = ell.h * r * 0.5 * (SF(th(e + 90)) + SF(th(e - 90)));
    };
  }

  /**
   * Cells the fire could reach within `minutes` after a wind change to `toDir` at `postSpeed` (m/s), from the
   * current perimeter (spec §10.5). Writes `layer` and returns summary numbers.
   */
  compute(s: SimStateView, front: Int32Array, nFront: number, change: { time: number; toDir: number; postSpeed: number }, ros?: DmzRosFn): DmzResult {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const g = this.grid;
    const { cnx, cny, f } = this;
    const limit = EXPLAIN_PARAMS.dmz.minutes * 60;
    const windTo = wrapDeg(change.toDir + 180);
    const rosFn = ros ?? this.defaultRos(s, change);
    const bs = s.fire.burnState;
    const run = ++this.run;
    this.layer.fill(0);
    const heap = this.heap;
    heap.size = 0;
    const node = (k: number): number => {
      const j = (k / g.nx) | 0;
      return ((j / f) | 0) * cnx + (((k - j * g.nx) / f) | 0);
    };
    const prep = (n: number): boolean => {
      if (this.stamp[n] === run) return this.aC[n]! >= 0;
      this.stamp[n] = run;
      this.time[n] = Infinity;
      const k = this.rep[n]!;
      if (isNonFuel(this.fuel.type[k]!)) {
        this.aC[n] = -1;
        return false;
      }
      rosFn(k, change.postSpeed, windTo, this.sp);
      const { rH, rB, rF, e } = this.sp;
      this.aC[n] = (rH + rB) / 2;
      this.cC[n] = (rH - rB) / 2;
      this.bC[n] = rF;
      this.eX[n] = Math.sin(e / RAD);
      this.eY[n] = Math.cos(e / RAD);
      return true;
    };
    for (let a = 0; a < nFront; a++) {
      const n = node(front[a]!);
      if (!prep(n)) {
        // A seed on non-fuel still spreads into its neighbours: give it the neighbours' speeds lazily.
        this.aC[n] = 0;
      }
      if (this.time[n]! > 0) {
        this.time[n] = 0;
        heap.push(0, n);
      }
    }
    const h = g.cellSize * f;
    while (heap.size > 0) {
      const n = heap.pop();
      const tn = heap.lastKey;
      if (tn > this.time[n]! || tn > limit) {
        if (tn > limit) break;
        continue;
      }
      const ci = n % cnx;
      const cj = (n / cnx) | 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ii = ci + di;
          const jj = cj + dj;
          if (ii < 0 || jj < 0 || ii >= cnx || jj >= cny) continue;
          const m = jj * cnx + ii;
          if (!prep(m)) continue;
          const len = Math.hypot(di, dj);
          const ux = di / len;
          const uy = dj / len;
          // Convex offset-ellipse speed of §7.4 along the step (average of both nodes' ellipses).
          let R = 0;
          for (const q of [n, m]) {
            const a = this.aC[q]!;
            if (!(a > 0)) continue;
            const cp = ux * this.eX[q]! + uy * this.eY[q]!;
            const bF = this.bC[q]!;
            R += 0.5 * (this.cC[q]! * cp + Math.sqrt(a * a * cp * cp + bF * bF * (1 - cp * cp)));
          }
          if (!(R > 1e-6)) continue;
          const tm = tn + (len * h) / R;
          if (tm < this.time[m]! && tm <= limit) {
            this.time[m] = tm;
            heap.push(tm, m);
          }
        }
      }
    }
    // Rasterise onto the fire grid (unburnt burnable cells only).
    let cells = 0;
    let sx = 0;
    let sy = 0;
    for (let k = 0; k < g.nx * g.ny; k++) {
      if (bs[k] !== BurnState.Unburnt) continue;
      const n = node(k);
      if (this.stamp[n] !== run) continue;
      const tm = this.time[n]!;
      if (!(tm <= limit)) continue;
      this.layer[k] = Math.max(0.02, 1 - tm / limit);
      cells++;
      const j = (k / g.nx) | 0;
      sx += g.x0 + (k - j * g.nx) * g.cellSize;
      sy += g.y0 + j * g.cellSize;
    }
    const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    return { layer: this.layer, cells, areaHa: (cells * g.cellSize * g.cellSize) / 1e4, x: cells ? sx / cells : NaN, y: cells ? sy / cells : NaN, ms };
  }
}
