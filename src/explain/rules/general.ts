/**
 * `general` system notes (spec §10.2 second table), each with its own key `general:<sub>:domain` and cool-down:
 * steep, embers-exit, wind-driven, light-wind (persistence 10 = 10 min), narrow-gully, mountain-wave (P1),
 * foehn (P1).
 */
import { BurnState } from '../../core/types';
import { wrapDeg } from '../../core/units';
import type { CycleContext } from '../context';
import { familyAt } from '../deps';
import { foehnAloft } from '../forecast';
import { EXPLAIN_PARAMS } from '../params';
import type { Candidate } from '../text';
import { angDist, ge, le, medianFinite, softAnd } from '../util';
import { makeRule, type InsightRule } from './types';

const P = EXPLAIN_PARAMS;
const Gp = P.general;
const H = P.engine.hysteresis;

function note(sub: string, x: number, y: number, score: number, values: Candidate['values'], persistence?: number): Candidate {
  const c: Candidate = { key: `general:${sub}:domain`, x, y, score, severity: 'info', values: { sub, ...values } };
  if (persistence !== undefined) c.persistence = persistence;
  return c;
}

/** Ridge geometry for a wind from `windFrom`: share of ridge representatives whose crest-normal is within 45° of
 *  windTo, and whether the median lee slope30 exceeds the windward one. Cached per 22.5° sector. */
export function ridgeGeometry(ctx: Pick<CycleContext, 'statics' | 'features' | 'terrain'>, windFrom: number, cache?: Map<number, { cross: number; leeSteeper: boolean }>): {
  cross: number;
  leeSteeper: boolean;
} {
  const sector = Math.round(wrapDeg(windFrom) / 22.5) % 16;
  const hit = cache?.get(sector);
  if (hit) return hit;
  const st = ctx.statics;
  const to = wrapDeg(sector * 22.5 + 180);
  let n = 0;
  let cross = 0;
  for (let a = 0; a < st.ridgeReps.length; a++) {
    const cn = st.crestNormal(st.ridgeReps[a]!, to);
    if (!(cn === cn)) continue;
    n++;
    if (angDist(cn, to) <= 45) cross++;
  }
  const lee: number[] = [];
  const wind: number[] = [];
  const cells = st.ridgeSlopeCells;
  const asp = ctx.terrain.aspectDeg;
  for (let a = 0; a < cells.length; a++) {
    const k = cells[a]!;
    const d = angDist(asp[k]!, to);
    if (d <= 45) lee.push(ctx.features.slope30[k]!);
    else if (d >= 135) wind.push(ctx.features.slope30[k]!);
  }
  const r = { cross: n ? cross / n : 0, leeSteeper: lee.length > 0 && wind.length > 0 && medianFinite(lee) > medianFinite(wind) };
  cache?.set(sector, r);
  return r;
}

const geoCache = new WeakMap<object, Map<number, { cross: number; leeSteeper: boolean }>>();

function detectGeneral(ctx: CycleContext): Candidate[] {
  const s = ctx.s;
  const out: Candidate[] = [];
  const [hx, hy] = ctx.headK >= 0 ? [ctx.headX, ctx.headY] : [ctx.cx, ctx.cy];
  if (ctx.nFront > 0) {
    // steep: validated = false on ≥ 10 % of front cells because θ > 20°.
    let steep = 0;
    let sk = -1;
    for (let a = 0; a < ctx.nFront; a++) {
      const k = ctx.front[a]!;
      if (ctx.slopeAlong(k, ctx.frontSpread[a]!) > Gp.steepSlopeDeg) {
        steep++;
        if (sk < 0) sk = k;
      }
    }
    const share = steep / ctx.nFront;
    const scS = ge(share, Gp.steepShare);
    if (scS >= H && steep >= 3) out.push(note('steep', ctx.x(sk), ctx.y(sk), scS, { share }));

    // wind-driven and light-wind at the head.
    if (ctx.nHead > 0) {
      const nc: number[] = [];
      const u: number[] = [];
      let v2 = 0;
      let slow = 0;
      for (let a = 0; a < ctx.nHead; a++) {
        const k = ctx.head[a]!;
        nc.push(s.aux.nc[k] ?? 0);
        const sp = ctx.windSpeed(k) * 3.6;
        u.push(sp);
        if (familyAt(ctx.fuel, k) === 'vesta2') {
          v2++;
          if (sp < Gp.lightWindMaxKmh) slow++;
        }
      }
      const mNc = medianFinite(nc);
      const mU = medianFinite(u);
      const scW = softAnd(le(mNc, Gp.windDrivenMaxNc), ge(mU, Gp.windDrivenMinKmh));
      if (scW >= H) out.push(note('wind-driven', hx, hy, scW, { nc: mNc, u10: mU / 3.6 }));
      if (v2 > 0) {
        const scL = softAnd(ge(slow / v2, Gp.lightWindShare), le(mU, Gp.lightWindMaxKmh));
        if (scL >= H) out.push(note('light-wind', hx, hy, scL, { u10: mU / 3.6 }, Gp.lightWindPersistence));
      }
    }

    // narrow-gully: burning drainage cells narrower than 2Δx_a with θ ≥ 25°.
    const gridM = s.atmosphere?.grid.cellSize ?? Gp.atmosCellDefaultM;
    const st = ctx.statics;
    const bs = s.fire.burnState;
    let best = -1;
    let bw = Infinity;
    let bsc = 0;
    for (let a = 0; a < ctx.nFront; a++) {
      const k = ctx.front[a]!;
      if (!ctx.features.drainage[k] || bs[k] !== BurnState.Burning) continue;
      const slope = ctx.terrain.slopeDeg[k]!;
      if (slope < Gp.narrowGullySlopeDeg * H) continue;
      const w = st.trenchWidth(k);
      const sc = softAnd(le(w, 2 * gridM), ge(slope, Gp.narrowGullySlopeDeg));
      if (sc > bsc) {
        bsc = sc;
        best = k;
        bw = w;
      }
    }
    if (bsc >= H) out.push(note('narrow-gully', ctx.x(best), ctx.y(best), bsc, { width: bw, gridM }));
  }

  // embers-exit: embers leaving the domain > 5 % of ignition-capable embers (10 min).
  const es = s.emberStats;
  if (es && es.beyondEdgeHistogram) {
    let exit = 0;
    let far = 0;
    for (let b = 0; b < es.beyondEdgeHistogram.length; b++) {
      const v = es.beyondEdgeHistogram[b]!;
      exit += v;
      if (v > 0) far = b + 1;
    }
    const share = exit / Math.max(1, exit + es.landings10min);
    const sc = ge(share, Gp.embersExitShare);
    if (sc >= H && exit >= 3) out.push(note('embers-exit', hx, hy, sc, { share, dKm: far }));
  }

  // mountain-wave (P1).
  {
    const windFrom = ctx.ambientFrom;
    let cache = geoCache.get(ctx.statics);
    if (!cache) geoCache.set(ctx.statics, (cache = new Map()));
    const geo = ridgeGeometry(ctx, windFrom, cache);
    const d = s.atmosDiag;
    const fr = d?.frH ?? NaN;
    const waveFr = fr >= Gp.mountainWaveFrLo && fr <= Gp.mountainWaveFrHi && geo.leeSteeper ? 2 : 0;
    const waveNight = softAnd(ge(s.night.sn, Gp.mountainWaveSn), ge(ctx.uRidgeMedian, Gp.mountainWaveURidge));
    const sc = softAnd(ge(geo.cross, Gp.mountainWaveCrossShare), Math.max(waveFr, waveNight));
    if (sc >= H) {
      const synthetic = d?.upperAirSource === 'synthetic' || d?.upperAirSource === 'none' ? 1 : 0;
      out.push(note('mountain-wave', hx, hy, sc, { frH: fr, cross: geo.cross, synthetic }));
    }
  }

  // foehn (P1): 850/700 hPa wind from 250–320° at ≥ 15 m/s on the lee side of the divide.
  if (ctx.statics.leeOfDivide) {
    const fa = foehnAloft(s.weather);
    if (fa) out.push(note('foehn', hx, hy, 2, { dirAloft: fa.dir, uAloft: fa.speed }));
  }
  return out;
}

export const GENERAL_RULES: InsightRule[] = [makeRule('general', detectGeneral, { dedupRadiusM: 0 })];
