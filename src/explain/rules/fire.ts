/**
 * Fire, ember and fuel detectors (spec §10.2): spotting, spot-fire, mass-spotting, junction-zone, plume-dominated,
 * fire-induced-wind (P1), crown-fire, heavy-fuel, recent-burn, fuel-break-breached and rolling-debris (P1).
 * Event cards (spot-fire, mass-spotting, fuel-break-breached, rolling-debris) use persistence 1.
 */
import { BurnState, FuelFlag, FuelType, Landform, type SpotFire } from '../../core/types';
import type { CycleContext } from '../context';
import { FUEL_TYPES, canopyHeightEffAt, spottingEnvelope } from '../deps';
import { EXPLAIN_PARAMS } from '../params';
import type { Candidate } from '../text';
import { angDist, angLe, azimuthOf, cellIndexAt, ge, le, softAnd } from '../util';
import { cand, makeRule, mergeByKey, type InsightRule } from './types';

const P = EXPLAIN_PARAMS;
const H = P.engine.hysteresis;

// ── spotting ─────────────────────────────────────────────────────────────────────────────────────────

/** AFDRS spotting envelope (m) at the head: ROS m/h, U10 km/h, surface FHS (spec §6.10). */
function headSpotting(ctx: CycleContext): number {
  const k = ctx.headK;
  if (k < 0) return NaN;
  return spottingEnvelope(ctx.headRos * 3600, ctx.windSpeed(k) * 3.6, ctx.fuel.surfaceHazard[k]!);
}

function detectSpotting(ctx: CycleContext): Candidate[] {
  const Sp = P.spotting;
  const s = ctx.s;
  if (ctx.nFront === 0) return [];
  const out: Candidate[] = [];
  const d = s.emberStats?.maxIgnitableDistance10min ?? 0;
  if (d >= Sp.aheadM * H && ctx.headK >= 0) {
    out.push(cand(ctx.key('spotting', ctx.headK), ctx.headX, ctx.headY, ge(d, Sp.aheadM), 'watch', { d, S: headSpotting(ctx) }));
  }
  // Bark variant: burning cells with BH ≥ 3, U10 ≥ 30 km/h, M ≤ 7.
  const acc = ctx.acc;
  acc.reset(ctx.kFor(Sp.minCells));
  for (let a = 0; a < ctx.nFront; a += ctx.fStride) {
    const k = ctx.front[a]!;
    const bh = ctx.fuel.barkHazard[k]!;
    if (bh < Sp.minBark * H) continue;
    const u = ctx.windSpeed(k) * 3.6;
    acc.add(k, softAnd(ge(bh, Sp.minBark), ge(u, Sp.minU10Kmh), le(s.moisture[k]!, Sp.maxMoisture)));
  }
  for (let a = 0; a < acc.touchedCount; a++) {
    const t = acc.touchedTile(a);
    const sc = acc.score(t);
    if (sc < H) continue;
    const k = acc.cell(t, 0);
    out.push(
      cand(ctx.tiles.key('spotting', t), ctx.x(k), ctx.y(k), sc, 'watch', {
        variant: 'bark',
        bark: ctx.fuel.barkHazard[k]!,
        u10: ctx.windSpeed(k),
        moisture: s.moisture[k]!,
        S: headSpotting(ctx),
      }),
    );
  }
  return mergeByKey(out);
}

// ── spot-fire ────────────────────────────────────────────────────────────────────────────────────────

const EMBER_WORDS: Record<string, string> = {
  flake: 'a burning bark flake',
  ribbon: 'a burning ribbon of bark',
  leaf: 'a burning leaf',
  twig: 'a burning twig',
  heavy: 'a burning piece of heavy fuel',
};

/** "a burning ribbon of bark on the ridge" from the spot's provenance. */
function spotSource(ctx: CycleContext, sp: SpotFire): string {
  const what = (sp.emberClass && EMBER_WORDS[sp.emberClass]) || 'a burning ember';
  if (sp.sourceX === undefined || sp.sourceY === undefined) return what;
  const k = cellIndexAt(ctx.grid, sp.sourceX, sp.sourceY);
  if (k < 0) return what;
  const lf = ctx.terrain.landform[k] as Landform;
  const where =
    lf === Landform.Ridge || lf === Landform.Peak || lf === Landform.Spur || ctx.features.ridge[k]
      ? 'on the ridge'
      : lf === Landform.Gully || lf === Landform.ValleyFloor
        ? 'in the gully'
        : ctx.terrain.slopeDeg[k]! >= 10
          ? 'on the slope'
          : 'at the fire edge';
  return `${what} ${where}`;
}

function detectSpotFire(ctx: CycleContext): Candidate[] {
  const S = P.spotFire;
  const best = new Map<string, Candidate>();
  for (const sp of ctx.newSpots) {
    if (!(sp.distance >= S.minDistM * H)) continue;
    const t = ctx.tiles.ofPoint(sp.x, sp.y);
    const key = ctx.tiles.key('spot-fire', t);
    const c: Candidate = {
      key,
      x: sp.x,
      y: sp.y,
      score: ge(sp.distance, S.minDistM),
      severity: sp.distance >= S.watchDistM ? 'watch' : 'info',
      values: {
        travel: sp.travel,
        dist: sp.distance,
        flightTime: sp.flightTime ?? NaN,
        height: sp.maxHeightAGL ?? NaN,
        moisture: sp.landingMoisture ?? NaN,
        src: spotSource(ctx, sp),
      },
      cooldown: S.cooldownS,
    };
    const o = best.get(key);
    if (!o || sp.distance > (o.values.dist as number)) best.set(key, c);
  }
  return [...best.values()];
}

// ── mass-spotting ────────────────────────────────────────────────────────────────────────────────────

function detectMassSpotting(ctx: CycleContext): Candidate[] {
  const M = P.massSpotting;
  const spots = ctx.s.spotFires;
  const recent: SpotFire[] = [];
  for (let a = spots.length - 1; a >= 0 && recent.length < 400; a--) {
    const sp = spots[a]!;
    if (sp.time >= ctx.t - M.windowS && sp.time <= ctx.t + 1) recent.push(sp);
  }
  if (recent.length < M.minCount * H) return [];
  let bestN = 0;
  let best: SpotFire | null = null;
  const r2 = M.radiusM * M.radiusM;
  for (const p of recent) {
    let n = 0;
    for (const q of recent) if ((p.x - q.x) ** 2 + (p.y - q.y) ** 2 <= r2) n++;
    if (n > bestN || (n === bestN && best && p.id < best.id)) {
      bestN = n;
      best = p;
    }
  }
  if (!best || bestN < M.minCount * H) return [];
  return [cand(ctx.tiles.key('mass-spotting', ctx.tiles.ofPoint(best.x, best.y)), best.x, best.y, ge(bestN, M.minCount), 'danger', { count: bestN })];
}

// ── junction-zone ────────────────────────────────────────────────────────────────────────────────────

function detectJunction(ctx: CycleContext): Candidate[] {
  const J = P.junction;
  if (ctx.nFront < 4) return [];
  const g = ctx.grid;
  const nx = g.nx;
  const bs = ctx.s.fire.burnState;
  const hash = ctx.frontHash;
  const range = new Int32Array(4);
  const stride = Math.max(1, Math.ceil(ctx.nFront / J.maxProbe));
  const rMax = J.maxGapM / H;
  const rMaxC = rMax / g.cellSize;
  // Cheap dot-product pre-filters (no trigonometry) before the exact angles: facing within 45°/H, normals at least
  // 180° − 60°/H apart.
  const cosFace = Math.cos(((J.faceAngleDeg / H) * Math.PI) / 180);
  const cosOpp = Math.cos(((180 - J.watchAlphaDeg / H) * Math.PI) / 180);
  const cnx = ctx.cellNx;
  const cny = ctx.cellNy;
  const best = new Map<number, Candidate>();
  const alphas = new Map<number, number[]>();
  const unburntAt = (fi: number, fj: number): boolean => {
    const i = Math.round(fi);
    const j = Math.round(fj);
    return i >= 0 && j >= 0 && i < g.nx && j < g.ny && bs[j * nx + i] === BurnState.Unburnt;
  };
  for (let a = 0; a < ctx.nFront; a += stride) {
    const p = ctx.front[a]!;
    const np = ctx.frontNormal[a]!;
    if (!(np === np)) continue;
    const pnx = cnx[p]!;
    const pny = cny[p]!;
    const jp = (p / nx) | 0;
    const ip = p - jp * nx;
    hash.bucketRange(ctx.x(p), ctx.y(p), rMax, range);
    for (let bj = range[2]!; bj <= range[3]!; bj++) {
      for (let bi = range[0]!; bi <= range[1]!; bi++) {
        const b = bj * hash.bnx + bi;
        // Dense fronts: the partner cells are subsampled with the same stride as the probes.
        for (let e = hash.bucketStart(b), end = hash.bucketEnd(b); e < end; e += stride) {
          const q = hash.item(e);
          if (stride === 1 ? q <= p : q === p) continue;
          const jq = (q / nx) | 0;
          const iq = q - jq * nx;
          const dx = iq - ip;
          const dy = jq - jp;
          const dc2 = dx * dx + dy * dy;
          if (dc2 < 6.25 || dc2 > rMaxC * rMaxC) continue;
          const dc = Math.sqrt(dc2);
          const qnx = cnx[q]!;
          const qny = cny[q]!;
          if (pnx * dx + pny * dy < cosFace * dc || -(qnx * dx + qny * dy) < cosFace * dc || pnx * qnx + pny * qny > cosOpp) continue;
          const d = dc * g.cellSize;
          const nq = ctx.cellNormal[q]!;
          const az = azimuthOf(dx, dy);
          const f1 = angDist(np, az);
          if (f1 > J.faceAngleDeg / H) continue;
          const f2 = angDist(nq, az + 180);
          if (f2 > J.faceAngleDeg / H) continue;
          const alpha = 180 - angDist(np, nq);
          if (alpha > J.watchAlphaDeg / H) continue;
          if (!unburntAt(ip + 0.5 * dx, jp + 0.5 * dy) || !unburntAt(ip + 0.25 * dx, jp + 0.25 * dy) || !unburntAt(ip + 0.75 * dx, jp + 0.75 * dy)) continue;
          const face = softAnd(angLe(f1, J.faceAngleDeg), angLe(f2, J.faceAngleDeg));
          const cD = softAnd(face, le(alpha, J.maxAlphaDeg), le(d, J.maxGapM));
          const cW = softAnd(face, le(alpha, J.watchAlphaDeg), le(d, J.watchGapM));
          const danger = cD >= 1;
          const score = danger ? cD : Math.max(cD, cW);
          if (score < H) continue;
          const mx = g.x0 + (ip + 0.5 * dx) * g.cellSize;
          const my = g.y0 + (jp + 0.5 * dy) * g.cellSize;
          const t = ctx.tiles.ofPoint(mx, my);
          let al = alphas.get(t);
          if (!al) alphas.set(t, (al = []));
          al.push(alpha);
          const o = best.get(t);
          const oDanger = o !== undefined && o.severity === 'danger';
          if (o && (oDanger && !danger ? true : oDanger === danger && o.score >= score)) continue;
          const sev = danger ? 'danger' : 'watch';
          best.set(t, cand(ctx.tiles.key('junction-zone', t), mx, my, score, sev, { alpha, gap: d, factor: 1 }));
        }
      }
    }
  }
  // Report the median included angle of the qualifying pairs (robust to distorted normals near the vertex).
  for (const [t, c] of best) {
    const al = alphas.get(t)!.sort((a, b) => a - b);
    const alpha = al[al.length >> 1]!;
    c.values.alpha = alpha;
    c.values.factor = Math.min(J.factorCap, 1 / Math.max(1e-6, Math.sin(((alpha / 2) * Math.PI) / 180)));
  }
  return [...best.values()];
}

// ── plume-dominated ──────────────────────────────────────────────────────────────────────────────────

function detectPlume(ctx: CycleContext): Candidate[] {
  const Pl = P.plume;
  if (ctx.nHead === 0 || ctx.s.aux.nc.length !== ctx.N) return [];
  const K = Math.max(1, Math.ceil(Pl.minLengthM / ctx.cs));
  const acc = ctx.acc;
  acc.reset(K);
  const t = ctx.tiles.ofCell(ctx.headK);
  let nOn = 0;
  for (let a = 0; a < ctx.nHead; a++) {
    const k = ctx.head[a]!;
    const nc = ctx.s.aux.nc[k]!;
    if (nc >= Pl.minNc) nOn++;
    acc.add(k, ge(nc, Pl.minNc), t);
  }
  const sc = acc.score(t);
  if (sc < H) return [];
  return [cand(ctx.tiles.key('plume-dominated', t), ctx.headX, ctx.headY, sc, 'watch', { nc: acc.value(t, 0), lengthM: nOn * ctx.cs })];
}

// ── fire-induced-wind (P1) ───────────────────────────────────────────────────────────────────────────

function detectFireWind(ctx: CycleContext): Candidate[] {
  const F = P.fireWind;
  const s = ctx.s;
  if (!(s.coupling > 0) || ctx.nFront === 0) return [];
  let n = 0;
  let m = 0;
  let sum = 0;
  for (let a = 0; a < ctx.nFront; a += ctx.fStride) {
    m++;
    const k = ctx.front[a]!;
    const fu = s.fireIndU[k]!;
    const fv = s.fireIndV[k]!;
    const fi2 = fu * fu + fv * fv;
    if (fi2 < F.minAbsMs * F.minAbsMs) continue;
    const bu = s.windBgU[k]!;
    const bv = s.windBgV[k]!;
    if (fi2 >= F.relBg * F.relBg * (bu * bu + bv * bv)) {
      n++;
      sum += Math.sqrt(fi2);
    }
  }
  const share = n / Math.max(1, m);
  const sc = ge(share, F.minShare);
  if (sc < H || ctx.headK < 0) return [];
  return [cand(ctx.key('fire-induced-wind', ctx.headK), ctx.headX, ctx.headY, sc, 'watch', { fw: n ? sum / n : 0, share })];
}

// ── crown-fire ───────────────────────────────────────────────────────────────────────────────────────

function detectCrown(ctx: CycleContext): Candidate[] {
  const C = P.crown;
  const s = ctx.s;
  const acc = ctx.acc;
  acc.reset(ctx.kFor(C.minCells));
  const I = s.fire.intensity;
  const FH = s.fire.flameHeight;
  const cfb = s.aux.cfb;
  for (let a = 0; a < ctx.nFront; a += ctx.fStride) {
    const k = ctx.front[a]!;
    const ik = I[k]!;
    if (ik < C.iGate * H && !((cfb[k] ?? 0) >= C.cfb * H)) continue;
    const hoe = canopyHeightEffAt(ctx.fuel, k);
    const gated = hoe > 0 ? softAnd(ge(FH[k]!, C.fhRatio * hoe), ge(ik, C.iGate)) : 0;
    acc.add(k, Math.max(ge(ik, C.iCrown), gated, ge(cfb[k] ?? 0, C.cfb)));
  }
  const out: Candidate[] = [];
  for (let a = 0; a < acc.touchedCount; a++) {
    const t = acc.touchedTile(a);
    const sc = acc.score(t);
    if (sc < H) continue;
    let iMax = 0;
    let fhMax = 0;
    for (let r = 0; r < acc.size(t); r++) {
      const k = acc.cell(t, r);
      iMax = Math.max(iMax, I[k]!);
      fhMax = Math.max(fhMax, FH[k]!);
    }
    const k0 = acc.cell(t, 0);
    out.push(cand(ctx.tiles.key('crown-fire', t), ctx.x(k0), ctx.y(k0), sc, 'danger', { intensity: iMax, flameHeight: fhMax }));
  }
  return out;
}

// ── heavy-fuel ───────────────────────────────────────────────────────────────────────────────────────

function detectHeavyFuel(ctx: CycleContext): Candidate[] {
  const Hf = P.heavyFuel;
  const fuel = ctx.fuel;
  const acc = ctx.acc;
  acc.reset(ctx.kFor(Hf.minCells));
  const flags = fuel.flags;
  for (let a = 0; a < ctx.nFront; a += ctx.fStride) {
    const k = ctx.front[a]!;
    let c = Math.max(ge(fuel.surfaceHazard[k]!, Hf.fhsS), ge(fuel.barkHazard[k]!, Hf.bark), ge(fuel.elevatedHazard[k]!, Hf.fhsEl));
    if (flags && flags[k]! & FuelFlag.HeavyFuel) c = Math.max(c, 1);
    if (c >= H) acc.add(k, c);
  }
  const out: Candidate[] = [];
  const FH = ctx.s.fire.flameHeight;
  for (let a = 0; a < acc.touchedCount; a++) {
    const t = acc.touchedTile(a);
    const sc = acc.score(t);
    if (sc < H) continue;
    let fh = 0;
    for (let r = 0; r < acc.size(t); r++) fh = Math.max(fh, FH[acc.cell(t, r)]!);
    const k0 = acc.cell(t, 0);
    out.push(cand(ctx.tiles.key('heavy-fuel', t), ctx.x(k0), ctx.y(k0), sc, fh >= Hf.watchFlameM ? 'watch' : 'info', { flameHeight: fh }));
  }
  return out;
}

// ── recent-burn ──────────────────────────────────────────────────────────────────────────────────────

function detectRecentBurn(ctx: CycleContext): Candidate[] {
  const R = P.recentBurn;
  if (ctx.nHead === 0) return [];
  const st = ctx.statics;
  const acc = ctx.acc;
  acc.reset(1);
  const dist = new Map<number, number>();
  const bs = ctx.s.fire.burnState;
  for (let a = 0; a < ctx.nHead; a++) {
    const k = ctx.head[a]!;
    const d = st.recentDist[k]!;
    if (d > R.distM / H) continue;
    const r = st.recentNearest[k]!;
    if (r < 0 || bs[r] === BurnState.NonFlammable) continue;
    const t = ctx.tiles.ofCell(r);
    const c = le(d, R.distM);
    const prev = acc.size(t) ? acc.value(t, 0) : 0;
    acc.add(r, c, t);
    if (c > prev) dist.set(t, d);
  }
  const out: Candidate[] = [];
  for (let a = 0; a < acc.touchedCount; a++) {
    const t = acc.touchedTile(a);
    const sc = acc.score(t);
    if (sc < H) continue;
    const r = acc.cell(t, 0);
    const years = ctx.fuel.timeSinceFire[r]!;
    const row = FUEL_TYPES[ctx.fuel.type[r] as FuelType];
    const ss = row?.surface;
    const pct = ss && ss.load > 0 ? (100 * ctx.fuel.surfaceLoad[r]!) / ss.load : ss ? 100 * (1 - Math.exp(-ss.k * years)) : NaN;
    const extreme = ctx.headK >= 0 && ctx.s.fire.phase[ctx.headK] === 3 ? 1 : 0;
    out.push(cand(ctx.tiles.key('recent-burn', t), ctx.x(r), ctx.y(r), sc, 'info', { years, pct: Math.min(100, pct), dist: dist.get(t) ?? 0, extreme }));
  }
  return out;
}

// ── fuel-break-breached ──────────────────────────────────────────────────────────────────────────────

/** Wilson (1988) breach probability P = z/(1 + z), z = exp(1.36 + 0.00036·I − b·W) [V §7.4]. */
export function wilsonBreach(intensityKwm: number, widthM: number, trees: boolean): number {
  const B = P.breach;
  const z = Math.exp(1.36 + 0.00036 * intensityKwm - (trees ? B.bTrees : B.bOpen) * widthM);
  return z / (1 + z);
}

function detectBreach(ctx: CycleContext): Candidate[] {
  const B = P.breach;
  const s = ctx.s;
  const out: Candidate[] = [];
  const tArr = s.fire.arrivalTime;
  const t0 = ctx.mem.lastRunT === ctx.mem.lastRunT ? ctx.mem.lastRunT : -Infinity;
  const bw = ctx.fuel.breakWidth;
  const g = ctx.grid;
  if (bw) {
    for (const b of ctx.statics.breakCells) {
      const ta = tArr[b]!;
      if (!(ta > t0 && ta <= ctx.t)) continue;
      // Upwind intensity: the maximum intensity of burnt neighbours that arrived earlier.
      let I = s.fire.intensity[b]!;
      const j = (b / g.nx) | 0;
      const i = b - j * g.nx;
      let trees = ctx.fuel.canopyCover[b]! >= B.canopyCover;
      const r = Math.max(1, Math.round(B.canopyRadiusM / g.cellSize));
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          const ii = i + di;
          const jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= g.nx || jj >= g.ny) continue;
          const q = jj * g.nx + ii;
          if (tArr[q]! < ta) I = Math.max(I, s.fire.intensity[q]!);
          if (Math.hypot(di, dj) * g.cellSize <= B.canopyRadiusM && ctx.fuel.canopyCover[q]! >= B.canopyCover) trees = true;
        }
      }
      const W = bw[b]!;
      out.push(cand(ctx.key('fuel-break-breached', b), ctx.x(b), ctx.y(b), 2, 'watch', { width: W, intensity: I, p: wilsonBreach(I, W, trees) }));
    }
  }
  // Spot variant: an ember carried across a ≥ 10 m non-fuel break.
  for (const sp of ctx.newSpots) {
    if (sp.sourceX === undefined || sp.sourceY === undefined) continue;
    const len = Math.hypot(sp.x - sp.sourceX, sp.y - sp.sourceY);
    const step = g.cellSize / 2;
    const n = Math.ceil(len / step);
    let run = 0;
    let best = 0;
    for (let a = 1; a < n; a++) {
      const f = a / n;
      const k = cellIndexAt(g, sp.sourceX + f * (sp.x - sp.sourceX), sp.sourceY + f * (sp.y - sp.sourceY));
      if (k < 0) continue;
      const ty = ctx.fuel.type[k]!;
      const isBreak = ty === FuelType.NonFuel || ty === FuelType.Water;
      const sub = bw ? bw[k]! : 0;
      if (isBreak) {
        run += step;
        best = Math.max(best, run);
      } else {
        run = 0;
        if (sub > best) best = sub;
      }
    }
    if (best >= B.minSpotBreakM) {
      out.push(cand(ctx.tiles.key('fuel-break-breached', ctx.tiles.ofPoint(sp.x, sp.y)), sp.x, sp.y, 2, 'watch', { variant: 'spot', width: best, travel: sp.travel }));
    }
  }
  return mergeByKey(out);
}

// ── rolling-debris (P1) ──────────────────────────────────────────────────────────────────────────────

function detectDebris(ctx: CycleContext): Candidate[] {
  const Dp = P.debris;
  const deb = ctx.s.aux.debris;
  if (!deb || deb.length === 0) return [];
  const g = ctx.grid;
  const z = ctx.terrain.elevation;
  const bs = ctx.s.fire.burnState;
  const perTile = new Map<number, { k: number; count: number; theta: number; drop: number }>();
  for (const d of deb) {
    if (!(d.t >= ctx.t - Dp.windowS && d.t <= ctx.t + 1) || d.path.length < 4) continue;
    const k0 = cellIndexAt(g, d.path[0]!, d.path[1]!);
    const k1 = cellIndexAt(g, d.path[d.path.length - 2]!, d.path[d.path.length - 1]!);
    if (k0 < 0 || k1 < 0 || bs[k1] !== BurnState.Unburnt || !(z[k1]! < z[k0]!)) continue;
    const t = ctx.tiles.ofCell(k1);
    const o = perTile.get(t);
    const drop = z[k0]! - z[k1]!;
    if (o) {
      o.count++;
      if (drop > o.drop) Object.assign(o, { k: k1, drop, theta: ctx.terrain.slopeDeg[k0]! });
    } else perTile.set(t, { k: k1, count: 1, theta: ctx.terrain.slopeDeg[k0]!, drop });
  }
  const out: Candidate[] = [];
  for (const [t, o] of perTile) {
    out.push(cand(ctx.tiles.key('rolling-debris', t), ctx.x(o.k), ctx.y(o.k), 2, 'watch', { theta: o.theta, drop: o.drop, count: o.count }));
  }
  return out;
}

export const FIRE_RULES: InsightRule[] = [
  makeRule('spotting', detectSpotting),
  makeRule('spot-fire', detectSpotFire, { persistence: 1, cooldown: P.spotFire.cooldownS, dedupRadiusM: 0 }),
  makeRule('mass-spotting', detectMassSpotting, { persistence: 1 }),
  makeRule('junction-zone', detectJunction),
  makeRule('plume-dominated', detectPlume, { persistence: P.plume.persistence, dedupRadiusM: 2000 }),
  makeRule('fire-induced-wind', detectFireWind, { priority: 'P1', persistence: P.fireWind.persistence, dedupRadiusM: 2000 }),
  makeRule('crown-fire', detectCrown),
  makeRule('heavy-fuel', detectHeavyFuel),
  makeRule('recent-burn', detectRecentBurn),
  makeRule('fuel-break-breached', detectBreach, { persistence: 1, dedupRadiusM: 0 }),
  makeRule('rolling-debris', detectDebris, { priority: 'P1', persistence: 1 }),
];
