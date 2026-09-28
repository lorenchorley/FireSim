/**
 * Weather, diurnal and moisture detectors (spec §10.2): wind-change, dead-man-zone (P1), pyroconvection-risk,
 * anabatic-wind, katabatic-wind (+ S17), thermal-belt (+ "ridges don't sleep"), inversion-break (+ breaking now,
 * smoke trapped, wet ground), aspect-dry-fuel (+ S38 forces aligned), moist-gully (+ drought), high-drought,
 * night-slowdown and afternoon-peak (+ S13). Domain cards use `kind:domain` keys (§10.1).
 */
import { lmstHour, localDate } from '../../core/physics';
import { BurnState } from '../../core/types';
import { wrapDeg } from '../../core/units';
import { solarPosition, sunTimes } from '../../terrain';
import type { CycleContext } from '../context';
import { ffdi } from '../deps';
import { cHaines, rain24, type WindChange } from '../forecast';
import { EXPLAIN_PARAMS } from '../params';
import { clock, type Candidate } from '../text';
import { along, angDist, azimuthOf, ge, le, softAnd } from '../util';
import { cand, makeRule, mergeByKey, type InsightRule } from './types';

const P = EXPLAIN_PARAMS;
const H = P.engine.hysteresis;

/**
 * Where a domain card about the fire is placed (§10.1 "domain centre unless a location is meaningful"): the head
 * when there is fire (wind change without an exposed flank, pyroconvection, inversion), else the domain centre.
 */
const domainXY = (ctx: CycleContext): [number, number] => (ctx.headK >= 0 ? [ctx.headX, ctx.headY] : [ctx.cx, ctx.cy]);

/** The next forecast change with time ∈ [now − hold, now + horizon], or null. */
export function nextChange(ctx: CycleContext, horizonS: number): WindChange | null {
  const ch = ctx.forecast?.changes;
  if (!ch) return null;
  for (const c of ch) {
    const dt = (c.time - ctx.nowMs) / 1000;
    if (dt >= -P.windChange.holdAfterS && dt <= horizonS) return c;
  }
  return null;
}

// ── wind-change ──────────────────────────────────────────────────────────────────────────────────────

function detectWindChange(ctx: CycleContext): Candidate[] {
  const W = P.windChange;
  const c = nextChange(ctx, W.horizonS);
  if (!c) return [];
  const newTo = wrapDeg(c.toDir + 180);
  // Exposed flank: front cells whose outward normal is within 45° of the new windTo.
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (let a = 0; a < ctx.nFront; a += ctx.fStride) {
    if (angDist(ctx.frontNormal[a]!, newTo) > W.flankAngleDeg) continue;
    const k = ctx.front[a]!;
    n++;
    sx += ctx.x(k);
    sy += ctx.y(k);
  }
  // Mean cell-count → length factor over orientations: (4/π)·ln(1 + √2) ≈ 1.12 [D].
  const flankM = n * ctx.fStride * ctx.cs * 1.122;
  let [x, y] = domainXY(ctx);
  if (n > 0) {
    // Snap to the flank cell nearest the flank centroid.
    const mx = sx / n;
    const my = sy / n;
    let bd = Infinity;
    for (let a = 0; a < ctx.nFront; a += ctx.fStride) {
      if (angDist(ctx.frontNormal[a]!, newTo) > W.flankAngleDeg) continue;
      const k = ctx.front[a]!;
      const d = (ctx.x(k) - mx) ** 2 + (ctx.y(k) - my) ** 2;
      if (d < bd) {
        bd = d;
        x = ctx.x(k);
        y = ctx.y(k);
      }
    }
  }
  return [
    cand('wind-change:domain', x, y, 2, 'danger', {
      fromDir: c.fromDir,
      toDir: c.toDir,
      shift: c.shift,
      postSpeed: c.postSpeed,
      clock: clock(c.time, ctx.timeZone),
      inS: (c.time - ctx.nowMs) / 1000,
      flankM,
      changeTime: c.time,
    }),
  ];
}

// ── dead-man-zone (P1) ───────────────────────────────────────────────────────────────────────────────

function detectDmz(ctx: CycleContext): Candidate[] {
  const D = P.dmz;
  const c = nextChange(ctx, D.horizonS);
  const mem = ctx.mem;
  if (!c || ctx.nFront === 0 || c.time < ctx.nowMs) {
    if (!c || c.time < ctx.nowMs) mem.dmzCells = 0;
    return [];
  }
  const due = !(mem.dmzT === mem.dmzT) || ctx.t - mem.dmzT >= D.refreshS || mem.dmzChange !== c.time;
  if (due && ctx.services.dmz) {
    ctx.services.dmz(ctx, c);
    mem.dmzT = ctx.t;
    mem.dmzChange = c.time;
  }
  if (mem.dmzCells < D.minCells) return [];
  return [
    cand('dead-man-zone:domain', mem.dmzX, mem.dmzY, 2, 'danger', {
      toDir: c.toDir,
      inS: (c.time - ctx.nowMs) / 1000,
      areaHa: mem.dmzAreaHa,
    }),
  ];
}

// ── pyroconvection-risk ──────────────────────────────────────────────────────────────────────────────

function detectPyro(ctx: CycleContext): Candidate[] {
  const Pp = P.pyro;
  const s = ctx.s;
  const src = s.atmosDiag?.upperAirSource ?? s.series.upperAirSource ?? 'none';
  if (src !== 'model' && src !== 'preset') return [];
  const w = s.weather;
  const F = ffdi(w.temperature, w.relativeHumidity, w.windSpeed10 * 3.6, s.droughtFactor);
  const chD = s.atmosDiag?.cHaines;
  const ch = chD !== null && chD !== undefined && Number.isFinite(chD) ? chD : (cHaines(w, s.series.sourceElevation)?.ch ?? NaN);
  const watch = softAnd(ge(ch, Pp.watchCH), ge(F, Pp.watchFfdi));
  let danger = softAnd(ge(ch, Pp.dangerCH), ge(F, Pp.dangerFfdi));
  let variant = 'ch';
  const d = s.atmosDiag;
  let above = NaN;
  if (d && d.firePowerMW > 0 && Number.isFinite(d.plumeTopASL) && Number.isFinite(d.plumeLclASL) && d.plumeLclASL > 0) {
    above = d.plumeTopASL - d.plumeLclASL;
    const pl = ge(above, Pp.lclMarginM);
    if (pl > danger) {
      danger = pl;
      variant = 'plume';
    }
  }
  if (d && d.pft !== null && Number.isFinite(d.pft) && d.pft > 0 && d.firePowerMW / 1000 > d.pft && danger < 1) {
    danger = 1.5; // P2: P_fire > PFT
    variant = 'pft';
  }
  const [x, y] = domainXY(ctx);
  if (danger >= H) return [cand('pyroconvection-risk:domain', x, y, danger, 'danger', { variant, cHaines: ch, ffdi: F, plumeAboveLcl: above })];
  if (watch >= H) return [cand('pyroconvection-risk:domain', x, y, watch, 'watch', { variant: 'ch', cHaines: ch, ffdi: F })];
  return [];
}

// ── anabatic-wind ────────────────────────────────────────────────────────────────────────────────────

function detectAnabatic(ctx: CycleContext): Candidate[] {
  const A = P.anabatic;
  const s = ctx.s;
  if (ctx.nFront === 0 || s.surfaceHeatFlux.length !== ctx.N) return [];
  const l = s.lmstHour;
  if (!(l >= A.lmstStart && l <= A.lmstEnd)) return [];
  const rU = le(ctx.uRidgeMedian, A.maxURidgeMs);
  if (rU < H) return [];
  const acc = ctx.acc;
  acc.reset(ctx.kFor(A.minCells));
  const qh = s.surfaceHeatFlux;
  const sf = s.slopeFlowS;
  const hasSf = sf.length === ctx.N;
  const slope = ctx.terrain.slopeDeg;
  for (let k = 0; k < ctx.N; k++) {
    if (!(qh[k]! >= A.minQh * H) || slope[k]! < A.minSlopeDeg * H) continue;
    if (s.fire.burnState[k] === BurnState.BurntOut) continue;
    if (ctx.tileFireDist(ctx.tiles.ofCell(k)) > A.fireDistM) continue;
    const d = ctx.distToFire(k, 2 * A.fireDistM);
    if (d > A.fireDistM / H) continue;
    const up = ctx.upslope(k);
    const comp =
      along(s.windU[k]! - s.windBgU[k]! - s.fireIndU[k]!, s.windV[k]! - s.windBgV[k]! - s.fireIndV[k]!, up) + (hasSf ? sf[k]! : 0);
    acc.add(k, softAnd(ge(qh[k]!, A.minQh), ge(slope[k]!, A.minSlopeDeg), ge(comp, A.minUpslopeMs), le(d, A.fireDistM), rU));
  }
  const out: Candidate[] = [];
  for (let a = 0; a < acc.touchedCount; a++) {
    const t = acc.touchedTile(a);
    const sc = acc.score(t);
    if (sc < H) continue;
    let cs = 0;
    let sfs = 0;
    let q = 0;
    let sl = 0;
    const n = acc.size(t);
    for (let r = 0; r < n; r++) {
      const k = acc.cell(t, r);
      const up = ctx.upslope(k);
      const top = hasSf ? sf[k]! : 0;
      cs += along(s.windU[k]! - s.windBgU[k]! - s.fireIndU[k]!, s.windV[k]! - s.windBgV[k]! - s.fireIndV[k]!, up) + top;
      sfs += top;
      q += qh[k]!;
      sl += slope[k]!;
    }
    const k0 = acc.cell(t, 0);
    out.push(
      cand(ctx.tiles.key('anabatic-wind', t), ctx.x(k0), ctx.y(k0), sc, 'info', {
        upslope: cs / n,
        subgrid: cs > 0 ? sfs / cs : 0,
        qh: q / n,
        slope: sl / n,
      }),
    );
  }
  return out;
}

// ── katabatic-wind (+ S17 evening flip) ──────────────────────────────────────────────────────────────

function recordFrontWind(ctx: CycleContext): void {
  const mem = ctx.mem;
  if (ctx.nFront === 0) return;
  let u = 0;
  let v = 0;
  let n = 0;
  for (let a = 0; a < ctx.nFront; a += ctx.fStride) {
    u += ctx.s.windU[ctx.front[a]!]!;
    v += ctx.s.windV[ctx.front[a]!]!;
    n++;
  }
  const h = mem.windHist;
  h.push(ctx.t, u / n, v / n);
  const keep = P.katabatic.s17LagS + 900;
  let drop = 0;
  while (drop < h.length && h[drop]! < ctx.t - keep) drop += 3;
  if (drop) h.splice(0, drop);
}

function detectKatabatic(ctx: CycleContext): Candidate[] {
  const K = P.katabatic;
  const s = ctx.s;
  recordFrontWind(ctx);
  if (ctx.nFront === 0) return [];
  const out: Candidate[] = [];
  const rGate = ge(s.night.gate, K.minGate);
  const sunLow = s.sunElevation < K.maxSunDeg;
  if (rGate >= H) {
    const acc = ctx.acc;
    acc.reset(K.minCells);
    const qh = s.surfaceHeatFlux;
    const hasQ = qh.length === ctx.N;
    const slope = ctx.terrain.slopeDeg;
    for (let k = 0; k < ctx.N; k++) {
      if (slope[k]! < K.minSlopeDeg * H) continue;
      const cold = sunLow || (hasQ && qh[k]! < 0);
      if (!cold) continue;
      if (ctx.tileFireDist(ctx.tiles.ofCell(k)) > K.fireDistM) continue;
      const d = ctx.distToFire(k, 2 * K.fireDistM);
      if (d > K.fireDistM / H) continue;
      acc.add(k, softAnd(ge(slope[k]!, K.minSlopeDeg), le(d, K.fireDistM), rGate));
    }
    for (let a = 0; a < acc.touchedCount; a++) {
      const t = acc.touchedTile(a);
      const sc = acc.score(t);
      if (sc < H) continue;
      let ds = 0;
      const n = acc.size(t);
      for (let r = 0; r < n; r++) {
        const k = acc.cell(t, r);
        const asp = ctx.terrain.aspectDeg[k]!;
        // The near-surface wind already carries the sub-grid katabatic top-up in full (§8.6), so slopeFlowS
        // (signed, − downslope) is not added again.
        ds += asp === asp ? along(s.windU[k]!, s.windV[k]!, asp) : 0;
      }
      const k0 = acc.cell(t, 0);
      out.push(cand(ctx.tiles.key('katabatic-wind', t), ctx.x(k0), ctx.y(k0), sc, 'info', { downslope: Math.max(0, ds / n) }));
    }
  }
  // S17: within 90 min of sunset the fire-edge wind turned ≥ 90° vs 2 h earlier.
  const st = sunTimes(ctx.nowMs, ctx.lat, ctx.lon);
  if (Number.isFinite(st.sunset) && Math.abs(ctx.nowMs - st.sunset) <= K.s17SunsetWindowS * 1000 && ctx.headK >= 0) {
    const h = ctx.mem.windHist;
    const n = h.length / 3;
    if (n >= 2) {
      const uNow = h[3 * (n - 1) + 1]!;
      const vNow = h[3 * (n - 1) + 2]!;
      let best = -1;
      let bd = Infinity;
      for (let a = 0; a < n - 1; a++) {
        const d = Math.abs(h[3 * a]! - (ctx.t - K.s17LagS));
        if (d < bd) {
          bd = d;
          best = a;
        }
      }
      if (best >= 0 && bd <= 600) {
        const uThen = h[3 * best + 1]!;
        const vThen = h[3 * best + 2]!;
        if (Math.hypot(uNow, vNow) >= K.s17MinWindMs && Math.hypot(uThen, vThen) >= K.s17MinWindMs) {
          const turn = angDist(azimuthOf(uNow, vNow), azimuthOf(uThen, vThen));
          const sc = ge(turn, K.s17MinTurnDeg);
          if (sc >= H) {
            const asp = ctx.terrain.aspectDeg[ctx.headK]!;
            out.push(
              cand(ctx.key('katabatic-wind', ctx.headK), ctx.headX, ctx.headY, sc, 'info', {
                variant: 'S17',
                turn,
                downslope: asp === asp ? Math.max(0, along(uNow, vNow, asp)) : Math.hypot(uNow, vNow),
              }),
            );
          }
        }
      }
    }
  }
  return mergeByKey(out);
}

// ── thermal-belt (+ ridges don't sleep) ──────────────────────────────────────────────────────────────

function detectThermalBelt(ctx: CycleContext): Candidate[] {
  const T = P.thermalBelt;
  const s = ctx.s;
  if (ctx.nFront === 0 || !(s.sunElevation < 0)) return [];
  const inv = s.tier !== 'fast' && s.atmosDiag?.inversion?.present === true;
  const rNight = Math.max(ge(s.night.dTheta, T.minDTheta), inv ? 2 : 0);
  if (rNight < H) return [];
  const hInv = s.night.hInv;
  const hav = ctx.derived.heightAboveValley;
  const bs = s.fire.burnState;
  const st = ctx.statics;
  const floorT = new Map<number, [number, number, number]>();
  const floorOf = (t: number): [number, number, number] => {
    let f = floorT.get(t);
    if (f) return f;
    const cells = st.floorCellsNearTile(t);
    let tt = 0;
    let rh = 0;
    let m = 0;
    for (let a = 0; a < cells.length; a++) {
      tt += s.airT[cells[a]!]!;
      rh += s.airRH[cells[a]!]!;
      m += s.moisture[cells[a]!]!;
    }
    const n = cells.length;
    f = n ? [tt / n, rh / n, m / n] : [NaN, NaN, NaN];
    floorT.set(t, f);
    return f;
  };
  const acc = ctx.acc;
  const out: Candidate[] = [];
  acc.reset(T.minCells);
  for (let k = 0; k < ctx.N; k++) {
    if (bs[k] !== BurnState.Burning) continue;
    const h = hav[k]!;
    const rBand = le(Math.abs(h - hInv), T.bandM);
    let c = rBand;
    if (c < 1 && s.airT.length === ctx.N) {
      const [tf, rhf] = floorOf(ctx.tiles.ofCell(k));
      c = Math.max(c, softAnd(ge(s.airT[k]! - tf, T.dTWarmer), ge(rhf - s.airRH[k]!, T.dRhDrier)));
    }
    if (h <= T.floorHavM) c = 0; // the valley floor itself is the cold pool
    acc.add(k, softAnd(rNight, c));
  }
  for (let a = 0; a < acc.touchedCount; a++) {
    const t = acc.touchedTile(a);
    const sc = acc.score(t);
    if (sc < H) continue;
    let m = 0;
    let hv = 0;
    const n = acc.size(t);
    for (let r = 0; r < n; r++) {
      m += s.moisture[acc.cell(t, r)]!;
      hv += hav[acc.cell(t, r)]!;
    }
    const k0 = acc.cell(t, 0);
    out.push(cand(ctx.tiles.key('thermal-belt', t), ctx.x(k0), ctx.y(k0), sc, 'info', { moisture: m / n, floorMoisture: floorOf(t)[2], hav: hv / n }));
  }
  // Ridges don't sleep: burning ridge cells above the inversion with U_ridge ≥ 15 km/h.
  acc.reset(T.minCells);
  for (let k = 0; k < ctx.N; k++) {
    if (bs[k] !== BurnState.Burning || !ctx.features.ridge[k]) continue;
    acc.add(k, softAnd(rNight, ge(hav[k]! - hInv, T.bandM), ge(ctx.bgSpeed(k) * 3.6, T.ridgeMinURidgeKmh)));
  }
  for (let a = 0; a < acc.touchedCount; a++) {
    const t = acc.touchedTile(a);
    const sc = acc.score(t);
    if (sc < H) continue;
    const k0 = acc.cell(t, 0);
    out.push(cand(ctx.tiles.key('thermal-belt', t), ctx.x(k0), ctx.y(k0), sc, 'info', { variant: 'ridge', uRidge: ctx.bgSpeed(k0), hav: hav[k0]! }));
  }
  return mergeByKey(out);
}

// ── inversion-break ──────────────────────────────────────────────────────────────────────────────────

function detectInversion(ctx: CycleContext): Candidate[] {
  const I = P.inversion;
  const s = ctx.s;
  const n = s.night;
  const mem = ctx.mem;
  if (n.tSunrise !== null && n.tSunrise !== mem.morningKey) {
    mem.morningKey = n.tSunrise;
    mem.morningDThetaMax = n.dTheta;
  }
  if (s.sunElevation >= 0) mem.morningDThetaMax = Math.max(mem.morningDThetaMax, n.dTheta);
  const [x, y] = domainXY(ctx);
  const wet = rain24(s.series, ctx.nowMs) >= I.wetRain24Mm ? 1 : 0;
  const out: Candidate[] = [];
  const afterSunrise = s.sunElevation >= 0 && n.tSunrise !== null && ctx.nowMs >= n.tSunrise;
  if (afterSunrise && n.tBreak !== null) {
    const dtb = (n.tBreak - ctx.nowMs) / 1000;
    const sc = softAnd(ge(n.dTheta, I.minDTheta), le(dtb, I.breakWithinS));
    if (sc >= H) out.push(cand('inversion-break:domain', x, y, sc, 'watch', { dTheta: n.dTheta, clock: clock(n.tBreak, ctx.timeZone), wet }));
    // Breaking now: the morning pool was ≥ 3 K and is now < 1 K (3-D: the inversion is no longer diagnosed).
    const broken = s.tier !== 'fast' && s.atmosDiag?.inversion ? !s.atmosDiag.inversion.present : n.dTheta < I.brokenDTheta;
    if (mem.morningDThetaMax >= I.minDTheta && broken && dtb > -2 * 3600) {
      out.push(cand('inversion-break:domain', x, y, softAnd(ge(mem.morningDThetaMax, I.minDTheta), le(n.dTheta, I.brokenDTheta)), 'watch', { variant: 'now', dTheta: n.dTheta }));
    }
  }
  // Smoke trapped: night / early morning, cold pool ≥ 3 K, fire burning below the inversion top.
  const beforeBreak = s.sunElevation < 0 || (s.sunElevation < I.smokeMaxSunDeg && n.tBreak !== null && ctx.nowMs < n.tBreak);
  if (beforeBreak && ctx.nFront > 0 && n.dTheta >= I.minDTheta * H) {
    let below = 0;
    const hav = ctx.derived.heightAboveValley;
    for (let a = 0; a < ctx.nFront; a += ctx.fStride) if (hav[ctx.front[a]!]! <= n.hInv) below++;
    if (below > 0) out.push(cand('inversion-break:domain', x, y, ge(n.dTheta, I.minDTheta), 'info', { variant: 'smoke', dTheta: n.dTheta }));
  }
  return mergeByKey(out);
}

// ── aspect-dry-fuel (+ S38 forces aligned) ───────────────────────────────────────────────────────────

const inSector = (a: number, from: number, to: number): boolean => (from <= to ? a >= from && a <= to : a >= from || a <= to);

function detectAspectDry(ctx: CycleContext): Candidate[] {
  const A = P.aspectDry;
  const s = ctx.s;
  if (ctx.nFront === 0) return [];
  const g = ctx.grid;
  const asp = ctx.terrain.aspectDeg;
  const slope = ctx.terrain.slopeDeg;
  const M = s.moisture;
  const lm = s.lmstHour;
  // Per-tile octant moisture sums of cells with slope ≥ 10° (lazy, per cycle) and the per (tile, opposite octant)
  // mean over the tiles within 1 km.
  const octant = ctx.statics.aspectOctant;
  const T = ctx.tiles;
  const oct = new Map<number, Float64Array>();
  const octOf = (t: number): Float64Array => {
    let o = oct.get(t);
    if (o) return o;
    o = new Float64Array(16);
    const cpt = T.cellsPerTile;
    const i0 = Math.floor(T.tx(t) * cpt);
    const j0 = Math.floor(T.ty(t) * cpt);
    const i1 = Math.min(g.nx, Math.floor((T.tx(t) + 1) * cpt));
    const j1 = Math.min(g.ny, Math.floor((T.ty(t) + 1) * cpt));
    for (let j = j0; j < j1; j++) {
      for (let k = j * g.nx + i0, e = j * g.nx + i1; k < e; k++) {
        const b = octant[k]!;
        if (b === 255) continue;
        o[2 * b] += M[k]!;
        o[2 * b + 1] += 1;
      }
    }
    oct.set(t, o);
    return o;
  };
  const rT = Math.ceil(A.oppositeRadiusM / T.tileM);
  const oppCache = new Map<number, number>();
  const oppMean = (k: number): number => {
    const t = T.ofCell(k);
    const ob = (Math.round(wrapDeg(asp[k]! + 180) / 45) % 8) | 0;
    const key = t * 8 + ob;
    const hit = oppCache.get(key);
    if (hit !== undefined) return hit;
    const tx = T.tx(t);
    const ty = T.ty(t);
    const b0 = (ob + 7) % 8;
    const b2 = (ob + 1) % 8;
    let sm = 0;
    let n = 0;
    for (let dy = -rT; dy <= rT; dy++) {
      for (let dx = -rT; dx <= rT; dx++) {
        const x = tx + dx;
        const y = ty + dy;
        if (x < 0 || y < 0 || x >= T.tnx || y >= T.tny || dx * dx + dy * dy > rT * rT) continue;
        const o = octOf(y * T.tnx + x);
        sm += o[2 * b0]! + o[2 * ob]! + o[2 * b2]!;
        n += o[2 * b0 + 1]! + o[2 * ob + 1]! + o[2 * b2 + 1]!;
      }
    }
    const v = n > 0 ? sm / n : NaN;
    oppCache.set(key, v);
    return v;
  };
  const acc = ctx.acc;
  acc.reset(A.minCells);
  const step = 1.5 * ctx.cs;
  for (let a = 0; a < ctx.nFront; a += ctx.fStride) {
    const f = ctx.front[a]!;
    const sp = ctx.frontSpread[a]!;
    const jf = (f / g.nx) | 0;
    const i = Math.round(f - jf * g.nx + (Math.sin((sp * Math.PI) / 180) * step) / ctx.cs);
    const j = Math.round(jf + (Math.cos((sp * Math.PI) / 180) * step) / ctx.cs);
    if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) continue;
    const k = j * g.nx + i;
    if (s.fire.burnState[k] !== BurnState.Unburnt) continue;
    const a0 = asp[k]!;
    if (!(a0 === a0) || slope[k]! < A.minSlopeDeg * H) continue;
    const sunny = inSector(a0, A.northFrom, A.northTo) || (lm >= A.westAfterLmst && inSector(a0, A.westFrom, A.westTo));
    if (!sunny) continue;
    const mo = oppMean(k);
    const dM = mo - M[k]!;
    acc.add(k, softAnd(ge(slope[k]!, A.minSlopeDeg), ge(dM, A.minDrierPp)));
  }
  const out: Candidate[] = [];
  for (let a = 0; a < acc.touchedCount; a++) {
    const t = acc.touchedTile(a);
    const sc = acc.score(t);
    if (sc < H) continue;
    const k0 = acc.cell(t, 0);
    const mo = oppMean(k0);
    out.push(cand(ctx.tiles.key('aspect-dry-fuel', t), ctx.x(k0), ctx.y(k0), sc, 'info', { aspect: asp[k0]!, moisture: M[k0]!, opposite: mo, dM: mo - M[k0]! }));
  }
  // S38: wind, slope and sun (or drier fuel ahead) all within 45° of the head direction (3 of 3) → watch.
  if (ctx.nHead > 0) {
    const sun = solarPosition(ctx.nowMs, ctx.lat, ctx.lon);
    acc.reset(1);
    const stride = Math.max(1, Math.ceil(ctx.nHead / 400));
    for (let a = 0; a < ctx.nHead; a += stride) {
      const k = ctx.head[a]!;
      const e = ctx.cellSpread[k]!;
      const wS = along(s.windU[k]!, s.windV[k]!, e) * 3.6;
      const rWind = softAnd(ge(wS, A.s38MinWindKmh), 45 / Math.max(1, angDist(ctx.windTo(k), e)));
      const up = ctx.upslope(k);
      const rSlope = softAnd(ge(ctx.slopeAlong(k, e), P.upslope.minSlopeDeg), 45 / Math.max(1, angDist(up, e)));
      const ahead = cellAhead(ctx, k, e);
      const behind = cellAhead(ctx, k, e + 180);
      const sunFacing = lm >= A.s38AfternoonLmst && sun.elevation > 0 && angDist(asp[k]!, sun.azimuth) <= A.s38AngleDeg && angDist(e, sun.azimuth) <= 90;
      const drierAhead = ahead >= 0 && behind >= 0 && M[ahead]! < M[behind]! - 0.5;
      const rSun = sunFacing || drierAhead ? 2 : 0;
      acc.add(k, softAnd(rWind, rSlope, rSun));
    }
    for (let a = 0; a < acc.touchedCount; a++) {
      const t = acc.touchedTile(a);
      const sc = acc.score(t);
      if (sc < 1) continue;
      const k0 = acc.cell(t, 0);
      const e = ctx.cellSpread[k0]!;
      out.push(
        cand(ctx.tiles.key('aspect-dry-fuel', t), ctx.x(k0), ctx.y(k0), sc, 'watch', {
          variant: 'S38',
          wind: along(s.windU[k0]!, s.windV[k0]!, e),
          slope: ctx.slopeAlong(k0, e),
        }),
      );
    }
  }
  return mergeByKey(out);
}

function cellAhead(ctx: CycleContext, k: number, az: number): number {
  const g = ctx.grid;
  const j = (k / g.nx) | 0;
  const i = Math.round(k - j * g.nx + 2 * Math.sin((az * Math.PI) / 180));
  const jj = Math.round(j + 2 * Math.cos((az * Math.PI) / 180));
  return i >= 0 && jj >= 0 && i < g.nx && jj < g.ny ? jj * g.nx + i : -1;
}

// ── moist-gully (+ drought) ──────────────────────────────────────────────────────────────────────────

function detectMoistGully(ctx: CycleContext): Candidate[] {
  const Mg = P.moistGully;
  const s = ctx.s;
  const cells = ctx.statics.wetGullyCells;
  if (ctx.nFront === 0 || cells.length === 0) return [];
  // Front means (moisture, availability) of the burnable front.
  let mF = 0;
  let faF = 0;
  let nF = 0;
  for (let a = 0; a < ctx.nFront; a += ctx.fStride) {
    mF += s.moisture[ctx.front[a]!]!;
    faF += s.availability[ctx.front[a]!]!;
    nF++;
  }
  mF /= nF;
  faF /= nF;
  const drought = s.kbdi >= Mg.droughtKbdi;
  const acc = ctx.acc;
  acc.reset(Mg.minCells);
  const bs = s.fire.burnState;
  const wetT = new Set<number>();
  for (let a = 0; a < cells.length; a++) {
    const k = cells[a]!;
    if (bs[k] !== BurnState.Unburnt) continue;
    if (ctx.tileFireDist(ctx.tiles.ofCell(k)) > Mg.fireDistM) continue;
    const d = ctx.distToFire(k, 2 * Mg.fireDistM);
    if (d > Mg.fireDistM / H) continue;
    const rD = le(d, Mg.fireDistM);
    const fa = s.availability[k]!;
    const cWet = softAnd(rD, Math.max(ge(s.moisture[k]! - mF, Mg.wetterPp), faF > 0 ? le(fa, Mg.faRatio * faF) : 0));
    const cDry = drought ? softAnd(rD, ge(fa, Mg.droughtFa), ge(s.kbdi, Mg.droughtKbdi)) : 0;
    const c = Math.max(cWet, cDry);
    acc.add(k, c);
    if (cDry >= 1 && cDry >= cWet) wetT.add(ctx.tiles.ofCell(k));
  }
  const out: Candidate[] = [];
  for (let a = 0; a < acc.touchedCount; a++) {
    const t = acc.touchedTile(a);
    const sc = acc.score(t);
    if (sc < H) continue;
    const k0 = acc.cell(t, 0);
    if (wetT.has(t)) out.push(cand(ctx.tiles.key('moist-gully', t), ctx.x(k0), ctx.y(k0), sc, 'watch', { variant: 'drought', kbdi: s.kbdi, fa: s.availability[k0]! }));
    else out.push(cand(ctx.tiles.key('moist-gully', t), ctx.x(k0), ctx.y(k0), sc, 'info', { moisture: s.moisture[k0]!, frontMoisture: mF }));
  }
  return out;
}

// ── high-drought (daily) ─────────────────────────────────────────────────────────────────────────────

function detectHighDrought(ctx: CycleContext): Candidate[] {
  const D = P.drought;
  const s = ctx.s;
  const day = localDate(ctx.nowMs);
  if (ctx.mem.highDroughtDay === day) return [];
  const sc = Math.max(ge(s.droughtFactor, D.df), ge(s.kbdi, D.kbdi));
  if (sc < 1) return [];
  const [x, y] = [ctx.cx, ctx.cy];
  return [cand('high-drought:domain', x, y, sc, 'watch', { df: s.droughtFactor, kbdi: s.kbdi, day })];
}

// ── night-slowdown ───────────────────────────────────────────────────────────────────────────────────

function frontMeanMoisture(ctx: CycleContext): number {
  let m = 0;
  let n = 0;
  for (let a = 0; a < ctx.nFront; a += ctx.fStride) {
    m += ctx.s.moisture[ctx.front[a]!]!;
    n++;
  }
  return n ? m / n : NaN;
}

function detectNightSlowdown(ctx: CycleContext): Candidate[] {
  const Nn = P.nightSlow;
  const s = ctx.s;
  const mem = ctx.mem;
  const key = s.night.tSunrise ?? 0;
  if (s.sunElevation >= 0) {
    if (mem.dayKey !== key) {
      mem.dayKey = key;
      mem.dayMaxRos = 0;
    }
    mem.dayMaxRos = Math.max(mem.dayMaxRos, ctx.headRos);
    mem.sunsetKey = NaN;
    return [];
  }
  if (ctx.nFront === 0) return [];
  if (mem.sunsetKey !== key) {
    mem.sunsetKey = key;
    mem.sunsetM = frontMeanMoisture(ctx);
  }
  if (!(mem.dayMaxRos > 0) || ctx.headK < 0) return [];
  const m = frontMeanMoisture(ctx);
  const ratio = ctx.headRos / mem.dayMaxRos;
  const rise = m - mem.sunsetM;
  const sc = softAnd(le(ratio, Nn.rosRatio), ge(rise, Nn.moistureRisePp));
  if (sc < H) return [];
  return [
    cand(ctx.key('night-slowdown', ctx.headK), ctx.headX, ctx.headY, sc, 'info', {
      moisture: m,
      ratio,
      rise,
      ros: ctx.headRos,
      belt: s.night.dTheta >= P.thermalBelt.minDTheta ? 1 : 0,
    }),
  ];
}

// ── afternoon-peak (+ S13), once per day ─────────────────────────────────────────────────────────────

function detectAfternoon(ctx: CycleContext): Candidate[] {
  const A = P.afternoon;
  const s = ctx.s;
  const day = localDate(ctx.nowMs);
  const [x, y] = [ctx.cx, ctx.cy];
  const out: Candidate[] = [];
  const l = lmstHour(ctx.nowMs, ctx.lon);
  if (ctx.mem.afternoonDay !== day && l >= A.lmstStart && l <= A.lmstEnd) {
    const peak = ctx.forecast?.peaks.find((p) => p.date === day);
    if (peak && Math.abs(ctx.nowMs - peak.time) <= A.windowH * 3.6e6) {
      out.push(cand('afternoon-peak:domain', x, y, 2, 'info', { ma: peak.ma, clock: clock(peak.time, ctx.timeZone), day }));
    }
  }
  if (ctx.mem.s13Day !== day) {
    const w = s.weather;
    const d = wrapDeg(w.windDir10);
    const hot = inSector(d, A.s13DirFrom, A.s13DirTo) && w.windSpeed10 * 3.6 >= A.s13MinKmh && w.relativeHumidity <= A.s13MaxRh && w.temperature >= A.s13MinT;
    const fbi = ctx.afdrsFbi ? ctx.afdrsFbi(w) : NaN;
    if (hot || fbi >= A.s13Fbi) {
      out.push(cand('afternoon-peak:domain', x, y, 2, 'watch', { variant: 'S13', dir: w.windDir10, u10: w.windSpeed10, t: w.temperature, rh: w.relativeHumidity, fbi, day }));
    }
  }
  return mergeByKey(out);
}

export const WEATHER_RULES: InsightRule[] = [
  makeRule('wind-change', detectWindChange, { persistence: 1, dedupRadiusM: 0 }),
  makeRule('dead-man-zone', detectDmz, { priority: 'P1', persistence: 1, dedupRadiusM: 0 }),
  makeRule('pyroconvection-risk', detectPyro, { dedupRadiusM: 0 }),
  makeRule('anabatic-wind', detectAnabatic),
  makeRule('katabatic-wind', detectKatabatic),
  makeRule('thermal-belt', detectThermalBelt),
  makeRule('inversion-break', detectInversion, { dedupRadiusM: 0 }),
  makeRule('aspect-dry-fuel', detectAspectDry),
  makeRule('moist-gully', detectMoistGully),
  makeRule('high-drought', detectHighDrought, {
    persistence: 1,
    dedupRadiusM: 0,
    onShown: (c, mem) => (mem.highDroughtDay = String(c.values.day)),
  }),
  makeRule('night-slowdown', detectNightSlowdown, { dedupRadiusM: 3000 }),
  makeRule('afternoon-peak', detectAfternoon, {
    persistence: 1,
    dedupRadiusM: 0,
    onShown: (c, mem) => {
      if (c.values.variant === 'S13') mem.s13Day = String(c.values.day);
      else mem.afternoonDay = String(c.values.day);
    },
  }),
];
