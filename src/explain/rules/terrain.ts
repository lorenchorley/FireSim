/**
 * Terrain detectors (spec §10.2): upslope-run, downslope-backing (+ S43, S10), gully-chimney, eruptive-slope,
 * ridge-crest, lee-slope-eddy, vorticity-lateral-spread (P1), saddle-channelling, valley-channelling and
 * ridge-speed-up (P1). Scores are soft ANDs (minimum of per-condition ratios, 1 = threshold); count conditions use
 * the K-th largest per-cell score of the tile (TileTopK), so the 0.8 hysteresis of §10.1 applies to the same statistic.
 */
import { BurnState } from '../../core/types';
import { uvToWind, wrapDeg } from '../../core/units';
import type { CycleContext } from '../context';
import { EXPLAIN_PARAMS } from '../params';
import type { Candidate } from '../text';
import { along, angDist, angLe, azimuthOf, cellAzimuth, ge, le, softAnd, stepCell } from '../util';
import { cand, makeRule, mergeByKey, type InsightRule } from './types';

const P = EXPLAIN_PARAMS;
const H = P.engine.hysteresis;

/** Tile candidates from the context accumulator: score = K-th largest, representative = best cell. */
function tileCandidates(
  ctx: CycleContext,
  kind: string,
  build: (t: number, best: number, score: number) => Candidate | null,
): Candidate[] {
  const out: Candidate[] = [];
  const acc = ctx.acc;
  for (let a = 0; a < acc.touchedCount; a++) {
    const t = acc.touchedTile(a);
    const sc = acc.score(t);
    if (sc < H) continue;
    const c = build(t, acc.cell(t, 0), sc);
    if (c) {
      if (!c.key) c.key = ctx.tiles.key(kind, t);
      out.push(c);
    }
  }
  return out;
}

/** Mean of f over the stored top cells of tile t. */
function tileMean(ctx: CycleContext, t: number, f: (k: number) => number): number {
  const n = ctx.acc.size(t);
  let s = 0;
  let m = 0;
  for (let r = 0; r < n; r++) {
    const v = f(ctx.acc.cell(t, r));
    if (v === v) {
      s += v;
      m++;
    }
  }
  return m ? s / m : NaN;
}

// ── upslope-run ──────────────────────────────────────────────────────────────────────────────────────

function detectUpslope(ctx: CycleContext): Candidate[] {
  const U = P.upslope;
  const acc = ctx.acc;
  acc.reset(ctx.kFor(U.minCells));
  const ros = ctx.s.fire.ros;
  for (let a = 0; a < ctx.nFront; a += ctx.fStride) {
    const k = ctx.front[a]!;
    const up = ctx.upslope(k);
    if (!(up === up)) continue;
    const sp = ctx.frontSpread[a]!;
    const th = ctx.frontTheta[a]!;
    if (th < U.minSlopeDeg * H) continue;
    acc.add(k, softAnd(angLe(angDist(sp, up), U.maxAngleDeg), ge(th, U.minSlopeDeg), ge(ros[k]!, U.minRosMs)));
  }
  return tileCandidates(ctx, 'upslope-run', (t, best, score) => {
    const th = tileMean(ctx, t, (k) => ctx.slopeAlong(k, ctx.cellSpread[k]!));
    const r = tileMean(ctx, t, (k) => ros[k]!);
    const sub = tileMean(ctx, t, (k) => ctx.subgridShare(k));
    return cand('', ctx.x(best), ctx.y(best), score, th >= U.watchSlopeDeg ? 'watch' : 'info', { theta: th, ros: r, subgrid: sub });
  });
}

// ── downslope-backing (+ S43 narrow gully floor, S10 strong downslope wind) ──────────────────────────

function detectDownslope(ctx: CycleContext): Candidate[] {
  const D = P.downslope;
  const s = ctx.s;
  const acc = ctx.acc;
  const ros = s.fire.ros;
  const out: Candidate[] = [];
  // Main trigger.
  acc.reset(ctx.kFor(D.minCells));
  const s43 = new Map<number, number>();
  for (let a = 0; a < ctx.nFront; a += ctx.fStride) {
    const k = ctx.front[a]!;
    const aspect = ctx.terrain.aspectDeg[k]!;
    if (!(aspect === aspect)) continue;
    const thd = ctx.frontTheta[a]!;
    if (thd > D.maxSlopeDeg * H) continue;
    const sp = ctx.frontSpread[a]!;
    const wAlong = along(s.windU[k]!, s.windV[k]!, sp) * 3.6;
    const c = softAnd(angLe(angDist(sp, aspect), D.maxAngleDeg), ge(-thd, -D.maxSlopeDeg), le(wAlong, D.maxWindAlongKmh));
    if (c <= 0) continue;
    acc.add(k, c);
    // S43: within 50 m of a narrow-valley floor whose opposite wall is ≥ 15°.
    if (c >= 1 && ctx.statics.narrowDist[k]! <= D.s43FloorDistM) {
      const f = ctx.statics.narrowNearest[k]!;
      const far = stepCell(ctx.grid, f, sp, D.s43WallSampleM);
      if (far >= 0) {
        const wall = (Math.atan((ctx.terrain.elevation[far]! - ctx.terrain.elevation[f]!) / D.s43WallSampleM) * 180) / Math.PI;
        if (wall >= D.s43OppositeWallDeg) {
          const t = ctx.tiles.ofCell(k);
          s43.set(t, Math.max(s43.get(t) ?? 0, wall));
        }
      }
    }
  }
  out.push(
    ...tileCandidates(ctx, 'downslope-backing', (t, best, score) => {
      const th = tileMean(ctx, t, (k) => ctx.slopeAlong(k, ctx.cellSpread[k]!));
      const r = tileMean(ctx, t, (k) => ros[k]!);
      const wall = s43.get(t);
      const sub = tileMean(ctx, t, (k) => ctx.subgridShare(k));
      return wall !== undefined
        ? cand('', ctx.x(best), ctx.y(best), score, 'watch', { variant: 'S43', theta: th, ros: r, wall, subgrid: sub })
        : cand('', ctx.x(best), ctx.y(best), score, 'info', { theta: th, ros: r, subgrid: sub });
    }),
  );
  // S10: strong downslope wind on dry fuel.
  acc.reset(ctx.kFor(D.s10MinCells));
  for (let a = 0; a < ctx.nFront; a += ctx.fStride) {
    const k = ctx.front[a]!;
    const aspect = ctx.terrain.aspectDeg[k]!;
    if (!(aspect === aspect)) continue;
    const slope = ctx.terrain.slopeDeg[k]!;
    if (slope < D.s10MinSlopeDeg * H) continue;
    const u = s.windU[k]!;
    const v = s.windV[k]!;
    const wd = along(u, v, aspect) * 3.6;
    if (wd < D.s10MinWindKmh * H) continue;
    const c = softAnd(ge(wd, D.s10MinWindKmh), ge(slope, D.s10MinSlopeDeg), le(s.moisture[k]!, D.s10MaxMoisture), angLe(angDist(azimuthOf(u, v), aspect), D.maxAngleDeg));
    acc.add(k, c);
  }
  out.push(
    ...tileCandidates(ctx, 'downslope-backing', (t, best, score) =>
      cand('', ctx.x(best), ctx.y(best), score, 'watch', {
        variant: 'S10',
        theta: -tileMean(ctx, t, (k) => ctx.terrain.slopeDeg[k]!),
        windDown: tileMean(ctx, t, (k) => along(s.windU[k]!, s.windV[k]!, ctx.terrain.aspectDeg[k]!)),
        moisture: tileMean(ctx, t, (k) => s.moisture[k]!),
      }),
    ),
  );
  return mergeByKey(out.filter((c) => c.score >= H));
}

// ── gully-chimney ────────────────────────────────────────────────────────────────────────────────────

function detectGully(ctx: CycleContext): Candidate[] {
  const Gp = P.gully;
  const s = ctx.s;
  if (ctx.nFront === 0) return [];
  const bs = s.fire.burnState;
  const out: Candidate[] = [];
  const attach = s.aux.attach;
  for (const seg of ctx.statics.gullies) {
    let lowerBurning = false;
    for (let a = 0; a < seg.lowerThird.length; a++) {
      if (bs[seg.lowerThird[a]!] === BurnState.Burning) {
        lowerBurning = true;
        break;
      }
    }
    const baseDist = ctx.distToFire(seg.base, 2 * Gp.baseDistM);
    const rFire = lowerBurning ? 2 : le(baseDist, Gp.baseDistM);
    if (rFire < H) continue;
    const up = seg.upAzimuth === seg.upAzimuth ? seg.upAzimuth : (ctx.features.gullyAxis[seg.base] ?? NaN);
    const wTo = ctx.windTo(seg.base);
    const rW = angLe(angDist(wTo, up), Gp.maxWindAngleDeg);
    const rA = softAnd(ge(s.surfaceHeatFlux[seg.base]!, Gp.anabaticQh), le(ctx.uRidgeMedian, Gp.anabaticMaxURidge));
    const score = softAnd(ge(seg.axialMax, Gp.minAxialSlopeDeg), rFire, Math.max(rW, rA));
    if (score < H) continue;
    let ae = 0;
    let sub = 0;
    for (let a = 0; a < seg.cells.length; a++) {
      const q = seg.cells[a]!;
      ae = Math.max(ae, attach[q] ?? 0);
      if (bs[q] === BurnState.Burning) sub = Math.max(sub, ctx.subgridShare(q));
    }
    out.push(
      cand(ctx.key('gully-chimney', seg.base), ctx.x(seg.base), ctx.y(seg.base), score, ae >= Gp.dangerAttach ? 'danger' : 'watch', {
        axial: seg.axialMax,
        baseDist: lowerBurning ? 0 : baseDist,
        attach: ae,
        variant: rA > rW ? 'anabatic' : 'wind',
        subgrid: sub,
      }),
    );
  }
  return mergeByKey(out);
}

// ── eruptive-slope ───────────────────────────────────────────────────────────────────────────────────

/** Attachment score A of §7.6 along azimuth e at cell k (D33): S(θ_e; 22°, 6°)·max(T, 0.4)·W_align. */
export function attachmentScore(ctx: CycleContext, k: number, e: number): number {
  const E = P.eruptive;
  const th = ctx.slopeAlong(k, e);
  const S = 1 / (1 + Math.exp((-4 * (th - E.attachCentreDeg)) / E.attachWidthDeg));
  const T = Math.max(ctx.features.trench[k] ?? 0, E.trenchFloor);
  const u10 = ctx.windSpeed(k) * 3.6;
  let w = 1;
  if (u10 >= E.alignWindKmh) {
    const d = angDist(ctx.windTo(k), e);
    w = d <= E.alignFullDeg ? 1 : d >= E.alignHalfDeg ? 0.5 : 1 - (0.5 * (d - E.alignFullDeg)) / (E.alignHalfDeg - E.alignFullDeg);
  }
  return S * T * w;
}

function detectEruptive(ctx: CycleContext): Candidate[] {
  const E = P.eruptive;
  const s = ctx.s;
  const acc = ctx.acc;
  acc.reset(ctx.kFor(E.minCells));
  const steps = Math.max(1, Math.ceil(E.runM / ctx.cs));
  const mf = s.atmosDiag?.fireInfluence;
  for (let a = 0; a < ctx.nFront; a += ctx.fStride) {
    const k = ctx.front[a]!;
    const up = ctx.upslope(k);
    if (!(up === up)) continue;
    if (ctx.frontTheta[a]! < 12) continue; // A < 0.03 below 12° (cheap pre-filter)
    const sp = ctx.frontSpread[a]!;
    const ang = angDist(sp, up);
    if (ang > E.maxAngleDeg / H) continue;
    let aMin = attachmentScore(ctx, k, sp);
    for (let st = 1; st <= steps && aMin >= E.minA * H; st++) {
      const q = stepCell(ctx.grid, k, sp, st * ctx.cs);
      if (q < 0) break;
      aMin = Math.min(aMin, attachmentScore(ctx, q, sp));
    }
    acc.add(k, softAnd(angLe(ang, E.maxAngleDeg), ge(aMin, E.minA)));
  }
  return tileCandidates(ctx, 'eruptive-slope', (t, best, score) => {
    let gMax = 1;
    let aeMax = 0;
    for (let r = 0; r < acc.size(t); r++) {
      const k = acc.cell(t, r);
      const ae = s.aux.attach[k] ?? 0;
      const up = ctx.upslope(k);
      const m = mf && mf.length === ctx.N ? mf[k]! : 0;
      const sRes = m * Math.min(1, Math.max(0, along(s.fireIndU[k]!, s.fireIndV[k]!, up) / E.indraftScale));
      const G = 1 + (E.gMax - 1) * ae * (1 - sRes);
      if (G > gMax) gMax = G;
      if (ae > aeMax) aeMax = ae;
    }
    const th = tileMean(ctx, t, (k) => ctx.slopeAlong(k, ctx.cellSpread[k]!));
    const A = tileMean(ctx, t, (k) => attachmentScore(ctx, k, ctx.cellSpread[k]!));
    const danger = aeMax >= E.dangerAE && gMax >= E.dangerG;
    return cand('', ctx.x(best), ctx.y(best), score, danger ? 'danger' : 'watch', { theta: th, A, G: gMax, attachE: aeMax, subgrid: (gMax - 1) / gMax });
  });
}

// ── ridge-crest ──────────────────────────────────────────────────────────────────────────────────────

function detectRidgeCrest(ctx: CycleContext): Candidate[] {
  const R = P.ridgeCrest;
  const acc = ctx.acc;
  acc.reset(1);
  const st = ctx.statics;
  const normals = new Map<number, number>();
  const best = new Map<number, { r: number; d: number; u: number }>();
  for (let a = 0; a < ctx.nFront; a += ctx.fStride) {
    const k = ctx.front[a]!;
    const d = st.ridgeDist[k]!;
    if (d > R.distM / H) continue;
    const r0 = st.ridgeNearest[k]!;
    if (r0 < 0) continue;
    const r = st.crestCell(r0);
    const u = ctx.bgSpeed(r);
    if (u * 3.6 < R.minURidgeKmh * H) continue;
    const wTo = ctx.bgTo(r);
    let cn = normals.get(r);
    if (cn === undefined) normals.set(r, (cn = st.crestNormal(r, wTo)));
    const c = softAnd(le(d, R.distM), ge(u * 3.6, R.minURidgeKmh), angLe(angDist(wTo, cn), R.maxAngleDeg));
    const t = ctx.tiles.ofCell(r);
    const prev = acc.size(t) ? acc.value(t, 0) : 0;
    acc.add(r, c, t);
    if (c > prev) best.set(t, { r, d, u });
  }
  return tileCandidates(ctx, 'ridge-crest', (t, rc, score) => {
    const b = best.get(t);
    return cand('', ctx.x(rc), ctx.y(rc), score, 'watch', { uRidge: b?.u ?? ctx.bgSpeed(rc), dist: b?.d ?? 0 });
  });
}

// ── lee-slope-eddy ───────────────────────────────────────────────────────────────────────────────────

function detectLeeEddy(ctx: CycleContext): Candidate[] {
  const L = P.leeEddy;
  const s = ctx.s;
  if (ctx.nFront === 0 || s.aux.sep.length !== ctx.N) return [];
  const acc = ctx.acc;
  acc.reset(L.minCells);
  const sep = s.aux.sep;
  const bs = s.fire.burnState;
  const burningTile = new Set<number>();
  const T = ctx.tiles;
  const g = ctx.grid;
  const cpt = T.cellsPerTile;
  for (let t = 0; t < T.count; t++) {
    // Burning cells are at distance 0, so tiles beyond 500 m of the fire hold no candidate.
    if (ctx.tileFireDist(t) > L.aheadM) continue;
    const i0 = Math.floor(T.tx(t) * cpt);
    const j0 = Math.floor(T.ty(t) * cpt);
    const i1 = Math.min(g.nx, Math.floor((T.tx(t) + 1) * cpt));
    const j1 = Math.min(g.ny, Math.floor((T.ty(t) + 1) * cpt));
    for (let j = j0; j < j1; j++) {
      for (let k = j * g.nx + i0, e = j * g.nx + i1; k < e; k++) {
        const v = sep[k]!;
        if (!(v >= L.minSep * H)) continue;
        const burning = bs[k] === BurnState.Burning;
        if (!burning) {
          if (bs[k] !== BurnState.Unburnt) continue;
          if (ctx.distToFire(k, L.aheadM * 2) > L.aheadM) continue;
        }
        const c = ge(v, L.minSep);
        acc.add(k, c, t);
        if (burning && c >= 1) burningTile.add(t);
      }
    }
  }
  return tileCandidates(ctx, 'lee-slope-eddy', (t, best, score) => {
    const ur = s.uRidge[best]!;
    return cand('', ctx.x(best), ctx.y(best), score, burningTile.has(t) ? 'watch' : 'info', {
      sep: acc.value(t, 0),
      uRidge: ur === ur ? ur : ctx.uRidgeMedian,
      slope: ctx.terrain.slopeDeg[best]!,
    });
  });
}

// ── vorticity-lateral-spread (P1) ────────────────────────────────────────────────────────────────────

const vlsRate = (v: number): number => 0.4 + 2.4 * Math.min(1, Math.max(0, (v - 0.5) / 0.5));

function detectVls(ctx: CycleContext): Candidate[] {
  const V = P.vls;
  const s = ctx.s;
  const aux = s.aux;
  if (aux.vls.length !== ctx.N) return [];
  const acc = ctx.acc;
  const out: Candidate[] = [];
  // Active zones.
  if (aux.vlsActive.length === ctx.N) {
    acc.reset(V.minCells);
    for (let k = 0; k < ctx.N; k++) if (aux.vlsActive[k]) acc.add(k, 2 * Math.min(1, aux.vls[k]! / V.minVls));
    out.push(
      ...tileCandidates(ctx, 'vorticity-lateral-spread', (t, best, score) => {
        const v = acc.value(t, 0);
        const ur = s.uRidge[best]!;
        return cand('', ctx.x(best), ctx.y(best), score, 'danger', { vls: v, rl: vlsRate(v), uRidge: ur === ur ? ur : ctx.uRidgeMedian });
      }),
    );
  }
  // Pre-warning: VLS ≥ 0.5 terrain within 1 km downwind of the head, U_ridge ≥ 5 m/s there.
  if (ctx.nHead > 0) {
    acc.reset(V.minCells);
    const steps = Math.ceil(V.lookM / ctx.cs);
    const stride = Math.max(1, Math.ceil(ctx.nHead / 48));
    const g = ctx.grid;
    const mark = ctx.nextStamp();
    const stamp = ctx.stamp;
    for (let a = 0; a < ctx.nHead; a += stride) {
      const h = ctx.head[a]!;
      const wTo = ctx.windTo(h);
      if (!(wTo === wTo)) continue;
      const ux = Math.sin((wTo * Math.PI) / 180);
      const uy = Math.cos((wTo * Math.PI) / 180);
      const jh = (h / g.nx) | 0;
      const ih = h - jh * g.nx;
      for (let st = 1; st <= steps; st++) {
        for (let lat = -V.lateralCells; lat <= V.lateralCells; lat++) {
          const i = Math.round(ih + ux * st + uy * lat);
          const j = Math.round(jh + uy * st - ux * lat);
          if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) continue;
          const k = j * g.nx + i;
          if (stamp[k] === mark) continue;
          stamp[k] = mark;
          if (s.fire.burnState[k] !== BurnState.Unburnt) continue;
          const v = aux.vls[k]!;
          const ur = s.uRidge[k]!;
          if (!(v >= V.minVls * H) || !(ur >= V.minURidge * H)) continue;
          acc.add(k, softAnd(ge(v, V.minVls), ge(ur, V.minURidge)));
        }
      }
    }
    out.push(
      ...tileCandidates(ctx, 'vorticity-lateral-spread', (t, best, score) => {
        const v = acc.value(t, 0);
        return cand('', ctx.x(best), ctx.y(best), score, 'watch', { variant: 'pre', vls: v, rl: vlsRate(v), uRidge: s.uRidge[best]! });
      }),
    );
  }
  return mergeByKey(out);
}

// ── saddle-channelling ───────────────────────────────────────────────────────────────────────────────

function detectSaddle(ctx: CycleContext): Candidate[] {
  const S = P.saddle;
  if (ctx.nHead === 0) return [];
  const acc = ctx.acc;
  acc.reset(1);
  const sd = ctx.statics.saddleReps;
  const info = new Map<number, { d: number; u: number }>();
  for (let a = 0; a < sd.length; a++) {
    const k = sd[a]!;
    if (ctx.tileFireDist(ctx.tiles.ofCell(k)) > S.distM / H) continue;
    const u = ctx.bgSpeed(k);
    if (u * 3.6 < S.minURidgeKmh * H) continue;
    const h = ctx.headHash.nearest(ctx.x(k), ctx.y(k), S.distM / H);
    if (h < 0) continue;
    const d = ctx.headHash.lastDist;
    const dir = ctx.cellSpread[h]!;
    const c = softAnd(le(d, S.distM), angLe(angDist(dir, cellAzimuth(ctx.grid, h, k)), S.maxAngleDeg), ge(u * 3.6, S.minURidgeKmh));
    const t = ctx.tiles.ofCell(k);
    const prev = acc.size(t) ? acc.value(t, 0) : 0;
    acc.add(k, c, t);
    if (c > prev) info.set(t, { d, u });
  }
  return tileCandidates(ctx, 'saddle-channelling', (t, best, score) => {
    const i = info.get(t)!;
    return cand('', ctx.x(best), ctx.y(best), score, 'watch', { dist: i.d, uRidge: i.u });
  });
}

// ── valley-channelling ───────────────────────────────────────────────────────────────────────────────

/** Ridge-top wind direction FROM: vector mean of the background wind over the ridge representatives. */
function ridgeWindFrom(ctx: CycleContext): number {
  const r = ctx.statics.ridgeReps;
  let u = 0;
  let v = 0;
  for (let a = 0; a < r.length; a++) {
    u += ctx.s.windBgU[r[a]!]!;
    v += ctx.s.windBgV[r[a]!]!;
  }
  if (r.length === 0 || u * u + v * v < 1e-6) return ctx.ambientFrom;
  return uvToWind(u, v)[1];
}

function detectValley(ctx: CycleContext): Candidate[] {
  const Vp = P.valley;
  if (ctx.nFront === 0) return [];
  const acc = ctx.acc;
  acc.reset(Vp.minCells);
  const rdir = ridgeWindFrom(ctx);
  const cells = ctx.statics.valleyFloorCells;
  const s = ctx.s;
  for (let a = 0; a < cells.length; a++) {
    const k = cells[a]!;
    if (ctx.tileFireDist(ctx.tiles.ofCell(k)) > Vp.fireDistM) continue;
    const d = ctx.distToFire(k, Vp.fireDistM * 1.5);
    if (d > Vp.fireDistM / H) continue;
    const u = s.windU[k]!;
    const v = s.windV[k]!;
    const sp = Math.sqrt(u * u + v * v);
    const dir = azimuthOf(-u, -v);
    const c = softAnd(le(d, Vp.fireDistM), ge(angDist(dir, rdir), Vp.minDiffDeg), ge(ctx.derived.localRelief[k]!, Vp.minReliefM), ge(sp, Vp.minFloorWindMs));
    acc.add(k, c);
  }
  return tileCandidates(ctx, 'valley-channelling', (_t, best, score) => {
    const [sp, dir] = uvToWind(s.windU[best]!, s.windV[best]!);
    return cand('', ctx.x(best), ctx.y(best), score, 'info', {
      floorDir: dir,
      floorSpeed: sp,
      ridgeDir: rdir,
      diff: angDist(dir, rdir),
      relief: ctx.derived.localRelief[best]!,
    });
  });
}

// ── ridge-speed-up (P1) ──────────────────────────────────────────────────────────────────────────────

/** Speed-up (fraction) of the background wind at crest cell r: 3-D tiers from the field, fast tier analytic. */
export function crestSpeedUp(ctx: CycleContext, r: number): number {
  const Rp = P.ridgeSpeedUp;
  const uC = ctx.bgSpeed(r);
  const to = ctx.bgTo(r);
  if (!(to === to)) return 0;
  const from = wrapDeg(to + 180);
  if (ctx.s.tier !== 'fast') {
    let q = -1;
    for (let d = Rp.upwindM; d >= ctx.cs && q < 0; d -= ctx.cs) q = stepCell(ctx.grid, r, from, d);
    if (q < 0) return 0;
    const uU = ctx.bgSpeed(q);
    return uU > 0.1 ? uC / uU - 1 : 0;
  }
  // Fast tier: analytic ΔS = min(2H/L, 1) (Jackson & Hunt), H = crest − lowest point within 2 km upwind,
  // L = horizontal distance from the crest to where the terrain has dropped by H/2. Terrain-only: cached per
  // crest cell and 10° wind sector.
  const sector = Math.round(from / 10) % 36;
  const key = r * 36 + sector;
  const hit = speedUpCache.get(ctx.statics)?.get(key);
  if (hit !== undefined) return hit;
  const v = analyticSpeedUp(ctx, r, sector * 10);
  let m = speedUpCache.get(ctx.statics);
  if (!m) speedUpCache.set(ctx.statics, (m = new Map()));
  m.set(key, v);
  return v;
}

const speedUpCache = new WeakMap<object, Map<number, number>>();

function analyticSpeedUp(ctx: CycleContext, r: number, from: number): number {
  const Rp = P.ridgeSpeedUp;
  const z = ctx.terrain.elevation;
  const zc = z[r]!;
  let zMin = zc;
  const n = Math.ceil((2 * Rp.upwindM) / ctx.cs);
  for (let st = 1; st <= n; st++) {
    const q = stepCell(ctx.grid, r, from, st * ctx.cs);
    if (q < 0) break;
    zMin = Math.min(zMin, z[q]!);
  }
  const Hh = zc - zMin;
  if (!(Hh > 5)) return 0;
  let L = n * ctx.cs;
  for (let st = 1; st <= n; st++) {
    const q = stepCell(ctx.grid, r, from, st * ctx.cs);
    if (q < 0) break;
    if (z[q]! <= zc - Hh / 2) {
      L = st * ctx.cs;
      break;
    }
  }
  return Math.min((2 * Hh) / L, 1);
}

function detectRidgeSpeedUp(ctx: CycleContext): Candidate[] {
  const Rp = P.ridgeSpeedUp;
  if (ctx.nFront === 0) return [];
  const acc = ctx.acc;
  acc.reset(1);
  const reps = ctx.statics.ridgeReps;
  const su = new Map<number, number>();
  for (let a = 0; a < reps.length; a++) {
    const r = reps[a]!;
    if (ctx.tileFireDist(ctx.tiles.ofCell(r)) > Rp.fireDistM) continue;
    if (ctx.s.fire.burnState[r] !== BurnState.Unburnt) continue;
    const d = ctx.distToFire(r, 2 * Rp.fireDistM);
    if (d > Rp.fireDistM / H) continue;
    const uC = ctx.bgSpeed(r);
    if (uC < Rp.minCrestWindMs * H) continue;
    const x = crestSpeedUp(ctx, r);
    su.set(r, x);
    acc.add(r, softAnd(le(d, Rp.fireDistM), ge(x, Rp.minSpeedUp), ge(uC, Rp.minCrestWindMs)));
  }
  return tileCandidates(ctx, 'ridge-speed-up', (_t, best, score) =>
    cand('', ctx.x(best), ctx.y(best), score, 'info', { speedUp: su.get(best) ?? 0, uCrest: ctx.bgSpeed(best) }),
  );
}

export const TERRAIN_RULES: InsightRule[] = [
  makeRule('upslope-run', detectUpslope),
  makeRule('downslope-backing', detectDownslope),
  makeRule('gully-chimney', detectGully),
  makeRule('eruptive-slope', detectEruptive),
  makeRule('ridge-crest', detectRidgeCrest),
  makeRule('lee-slope-eddy', detectLeeEddy),
  makeRule('vorticity-lateral-spread', detectVls, { priority: 'P1' }),
  makeRule('saddle-channelling', detectSaddle),
  makeRule('valley-channelling', detectValley),
  makeRule('ridge-speed-up', detectRidgeSpeedUp, { priority: 'P1' }),
];
