/**
 * "Why here?" cell explanation (spec §10.4): fills `CellExplanation` from the cell — arrival values if burnt, else
 * `s.evaluateCell(k)` (the fire module's own code, §7.12; explain never re-implements spread logic) — and writes a
 * plain-language narrative of up to 5 lines:
 *   1. a "because" summary of the top factors (the §10.4 example target);
 *   2–4. the top three factors ranked by share s_i = |ln f_i| / Σ|ln f_j| over {wind, slope, moisture, fuel, terrain},
 *        each from its §10.4 template;
 *   5. the validity line (§6.12) and the wind decomposition "ambient + terrain + slope flow + fire" (km/h).
 */
import { BurnState, FireHistoryKind, SpreadDriver, type CellExplanation, type FuelMap, type SimStateView, type SpreadFactors } from '../core/types';
import { uvToWind } from '../core/units';
import { FUEL_TYPES, familyAt, fuelNameAt } from './deps';
import { EXPLAIN_PARAMS } from './params';
import { compassWord, facing, int, rate, short, STEEP_NOTE, times } from './text';

const P = EXPLAIN_PARAMS;

export interface ExplainOptions {
  /** fuel/ fuelSummary(fuel, k) (spec §4.7); a local summary is used when absent. */
  fuelSummary?: (fuel: FuelMap, k: number) => string;
  /** unix ms of the scenario start (for the clock; see context.ts). */
  startMs?: number;
}

const hazardWord = (h: number): string => (h < 1 ? 'Low' : h < 2 ? 'Moderate' : h < 3 ? 'High' : h < 3.5 ? 'Very High' : 'Extreme');

/** Local fuel summary in the §4.7 style: "Dry forest (shrubby) · wildfire 6.8 yr ago · litter 9.9 t/ha (69 % of max) · …". */
export function localFuelSummary(fuel: FuelMap, k: number): string {
  const parts: string[] = [fuelNameAt(fuel, k)];
  const tsf = fuel.timeSinceFire[k]!;
  if (Number.isFinite(tsf)) {
    const kind = fuel.lastFireKind[k] === FireHistoryKind.Wildfire ? 'wildfire' : fuel.lastFireKind[k] === FireHistoryKind.PrescribedBurn ? 'prescribed burn' : 'fire';
    parts.push(`${kind} ${short(tsf)} yr ago`);
  } else parts.push('no fire record');
  const row = FUEL_TYPES[fuel.type[k] as keyof typeof FUEL_TYPES];
  const sl = fuel.surfaceLoad[k]!;
  if (sl > 0) {
    const max = row?.surface.load ?? 0;
    parts.push(`litter ${short(sl)} t/ha${max > 0 ? ` (${int((100 * sl) / max)} % of max)` : ''}`);
  }
  if (fuel.elevatedHeight[k]! > 0 && fuel.elevatedHazard[k]! > 0) parts.push(`shrubs ${short(fuel.elevatedHeight[k]!)} m`);
  if (fuel.barkHazard[k]! > 0) parts.push(`bark ${row?.barkClass && row.barkClass !== 'none' ? `${row.barkClass} ` : ''}(${hazardWord(fuel.barkHazard[k]!)})`);
  return parts.join(' · ');
}

/** The largest identifiable reason for the cell's moisture differing from the AFDRS value (spec §10.4). */
export function moistureReason(s: SimStateView, k: number, nowMs: number): string {
  const off = s.fuel.moistureOffset?.[k] ?? 0;
  if (Math.abs(off) >= 0.5) return `user edit (${off > 0 ? '+' : ''}${short(off)} points)`;
  // Rain in the last 48 h.
  let lastRain = NaN;
  for (const h of s.series.hours) if (h.time <= nowMs && h.time > nowMs - 48 * 3.6e6 && (h.precipitation ?? 0) >= 0.2) lastRain = h.time;
  if (Number.isFinite(lastRain)) return `rain ${int((nowMs - lastRain) / 3.6e6)} h ago`;
  const night = s.sunElevation < 0;
  if (night && s.airT.length === s.moisture.length) {
    const z = s.terrain.elevation[k]!;
    const zs = s.series.sourceElevation ?? z;
    const tFree = s.weather.temperature - 0.0065 * (z - zs);
    const d = s.airT[k]! - tFree;
    if (d <= -1.5) return 'cold air pooled in the valley';
    if (d >= 1.5) return 'thermal belt, warmer than the valley floor';
    if ((s.airRH[k] ?? 0) >= 95) return 'dew';
  }
  const a = s.moistureAnomaly[k] ?? 0;
  const slope = s.terrain.slopeDeg[k]!;
  if (!night && slope >= 10 && Math.abs(a) >= 0.5) return a < 0 ? `sunlit ${facing(s.terrain.aspectDeg[k]!)} slope` : `shaded ${facing(s.terrain.aspectDeg[k]!)} slope`;
  if (s.fuel.canopyCover[k]! >= 0.5 && a > 0) return 'shaded by the canopy';
  return "today's weather";
}

const FACTOR_KEYS = ['wind', 'slope', 'moisture', 'fuel', 'terrain'] as const;
type FactorKey = (typeof FACTOR_KEYS)[number];

/** Factor shares s_i = |ln f_i| / Σ|ln f_j| (spec §10.4, doc 10 §9.1), sorted descending. */
export function factorShares(f: SpreadFactors): { key: FactorKey; value: number; share: number }[] {
  const ls = FACTOR_KEYS.map((key) => {
    const v = f[key];
    return { key, value: v, l: Number.isFinite(v) && v > 0 ? Math.abs(Math.log(v)) : 0 };
  });
  const sum = ls.reduce((a, b) => a + b.l, 0);
  return ls.map((x) => ({ key: x.key, value: x.value, share: sum > 0 ? x.l / sum : 0 })).sort((a, b) => b.share - a.share || FACTOR_KEYS.indexOf(a.key) - FACTOR_KEYS.indexOf(b.key));
}

const joinAnd = (xs: string[]): string => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')}, and ${xs[xs.length - 1]}`);

/** Build the CellExplanation (spec §10.4). */
export function explainCell(x: number, y: number, s: SimStateView, opts: ExplainOptions = {}): CellExplanation {
  const terrain = s.terrain;
  const g = terrain.grid;
  const i = Math.min(g.nx - 1, Math.max(0, Math.round((x - g.x0) / g.cellSize)));
  const j = Math.min(g.ny - 1, Math.max(0, Math.round((y - g.y0) / g.cellSize)));
  const k = j * g.nx + i;
  const startMs = opts.startMs;
  const t = s.time > 1e11 ? (s.time - (startMs ?? s.series.hours[0]?.time ?? s.time)) / 1000 : s.time;
  const nowMs = s.time > 1e11 ? s.time : startMs !== undefined ? startMs + s.time * 1000 : s.weather.time;
  const fire = s.fire;
  const arr = fire.arrivalTime[k]!;
  const burnt = Number.isFinite(arr) && arr <= t + 1e-6;
  const bs = fire.burnState[k]!;
  const nonFuel = bs === BurnState.NonFlammable;

  let ros: number;
  let intensity: number;
  let flameHeight: number;
  let driver: SpreadDriver;
  let factors: SpreadFactors;
  let validated: boolean;
  let dir: number;
  if (burnt) {
    ros = fire.ros[k]!;
    intensity = fire.intensity[k]!;
    flameHeight = fire.flameHeight[k]!;
    driver = fire.driver[k] as SpreadDriver;
    factors = s.factorsAt(k);
    dir = fire.spreadDir[k]!;
    validated = true; // set from the §6.12 criteria below
  } else {
    const ev = s.evaluateCell(k);
    ros = ev.ros;
    intensity = ev.intensity;
    flameHeight = ev.flameHeight;
    driver = ev.driver;
    factors = ev.factors;
    dir = ev.headDir;
    validated = ev.validated;
  }
  const u = s.windU[k]!;
  const v = s.windV[k]!;
  const [U, windFrom] = uvToWind(u, v);
  const fw = Math.hypot(s.fireIndU[k]!, s.fireIndV[k]!);
  const th = Number.isFinite(dir) ? Math.atan(terrain.dzdx[k]! * Math.sin((dir * Math.PI) / 180) + terrain.dzdy[k]! * Math.cos((dir * Math.PI) / 180)) * (180 / Math.PI) : 0;
  const M = s.moisture[k]!;
  const fam = familyAt(s.fuel, k);
  // Validity (spec §6.12) for burnt cells, from the same criteria the fire model uses.
  const reasons: string[] = [];
  if (th > 20) reasons.push('slope over 20°');
  if (th < -30) reasons.push('downhill slope over 30°');
  if (fam === 'vesta2' && U * 3.6 < 5) reasons.push('light wind');
  if (U * 3.6 > 70) reasons.push('very strong wind');
  if (fam === 'vesta2' && (M < 4 || M > 20)) reasons.push('moisture outside 4–20 %');
  if ((s.aux.attach[k] ?? 0) > 0.3) reasons.push('eruptive regime');
  if (burnt) validated = reasons.length === 0;

  const fuelSummary = (opts.fuelSummary ?? localFuelSummary)(s.fuel, k);
  const narrative: string[] = [];
  if (nonFuel || fam === 'none') {
    narrative.push(`${fuelNameAt(s.fuel, k)}: nothing here can carry the fire, although embers can fly over it.`);
  } else {
    const shares = factorShares(factors).filter((f) => f.share >= 0.05 && Math.abs(Math.log(Math.max(1e-9, f.value))) >= 0.05);
    const top = shares.slice(0, 3);
    // Position on the fire.
    const d = factors.direction ?? 1;
    const pos = !burnt ? 'head' : d >= 0.8 ? 'head' : d >= 0.2 ? 'flank' : 'back';
    const why = top.map((f) => phrase(f.key, f.value, { th, U, windFrom, fw, M, s, k, dir }));
    const lead = leadText(driver, th, burnt, pos, ros);
    let summary = why.length ? `${lead} because: ${joinAnd(why)}.` : `${lead}.`;
    if (th > P.notes.steepDeg) summary += ` ${STEEP_NOTE}`;
    narrative.push(summary);
    for (const f of top) narrative.push(line(f.key, f.value, { th, U, windFrom, fw, M, s, k, dir, fuelSummary, nowMs }));
  }
  // Validity + wind decomposition.
  const Ua = s.weather.windSpeed10 * 3.6;
  const Ut = Math.hypot(s.windBgU[k]!, s.windBgV[k]!) * 3.6 - Ua;
  const Us = (s.slopeFlowS[k] ?? 0) * 3.6;
  const Uf = fw * 3.6;
  const sg = (x: number): string => (x < -0.5 ? `− ${int(-x)}` : `+ ${int(Math.max(0, x))}`);
  const valid = validated ? 'Model check: inside the tested range.' : `Model check: outside the tested range here (${reasons.join(', ') || 'model limits'}), so treat the numbers as a rough guide.`;
  narrative.push(`${valid} Wind here: ambient ${int(Ua)} ${sg(Ut)} terrain ${sg(Us)} slope flow ${sg(Uf)} fire km/h.`);

  return {
    x: g.x0 + i * g.cellSize,
    y: g.y0 + j * g.cellSize,
    elevation: terrain.elevation[k]!,
    slopeDeg: terrain.slopeDeg[k]!,
    aspectDeg: terrain.aspectDeg[k]!,
    landform: terrain.landform[k]!,
    fuelType: s.fuel.type[k]!,
    fuelSummary,
    deadFuelMoisture: M,
    timeSinceFire: s.fuel.timeSinceFire[k]!,
    windSpeed10: U,
    windDir10: windFrom,
    arrivalTime: arr,
    ros,
    intensity,
    flameHeight,
    driver,
    factors,
    narrative: narrative.slice(0, 5),
  };
}

interface PhraseCtx {
  th: number;
  U: number;
  windFrom: number;
  fw: number;
  M: number;
  s: SimStateView;
  k: number;
  dir: number;
}

function leadText(driver: SpreadDriver, th: number, burnt: boolean, pos: string, ros: number): string {
  if (!burnt) return `If the fire reaches here it would spread ${rate(ros)}`;
  switch (driver) {
    case SpreadDriver.Slope:
    case SpreadDriver.WindAndSlope:
      return th >= 0 ? 'Running uphill here' : 'Running downhill here';
    case SpreadDriver.Wind:
      return 'Running with the wind here';
    case SpreadDriver.Backing:
      return pos === 'flank' ? 'Burning slowly along the flank here' : 'Backing slowly here';
    case SpreadDriver.DryFuel:
      return 'Burning fast in dry fuel here';
    case SpreadDriver.Fuel:
      return 'Burning the way it does here mostly';
    case SpreadDriver.Eruptive:
      return 'Surging up this steep slope';
    case SpreadDriver.LateralVorticity:
      return 'Running sideways along this lee slope';
    case SpreadDriver.Junction:
      return 'Racing where two fire lines meet';
    case SpreadDriver.Spotting:
      return 'Started by embers and spreading here';
    case SpreadDriver.FireInducedWind:
      return "Pulled along by the fire's own wind here";
    default:
      return pos === 'head' ? 'Spreading here' : `Spreading on the ${pos} here`;
  }
}

function phrase(key: FactorKey, f: number, c: PhraseCtx): string {
  switch (key) {
    case 'slope':
      return `slope ${int(Math.abs(c.th))}° ${c.th >= 0 ? 'upslope' : 'downslope'} (about ${times(f)})`;
    case 'wind': {
      const ax = c.s.features.gullyAxis[c.k]!;
      const to = (c.windFrom + 180) % 360;
      const along = Number.isFinite(ax) && Math.abs(((to - ax + 540) % 360) - 180) <= 30 ? ' aligned with the gully' : '';
      const drawn = c.fw * 3.6 >= 1 ? ` (${int(c.fw * 3.6)} km/h drawn in by the fire)` : '';
      return `wind ${int(c.U * 3.6)} km/h${along}${drawn}`;
    }
    case 'moisture':
      return c.M <= 8 ? `dry litter (${int(c.M)} %)` : c.M >= 15 ? `damp litter (${int(c.M)} %)` : `litter at ${int(c.M)} %`;
    case 'fuel': {
      const tsf = c.s.fuel.timeSinceFire[c.k]!;
      if (f >= 1) return `heavy fuel (about ${times(f)})`;
      return tsf <= 5 ? `light fuel after a recent burn (about ${times(f)})` : `light fuel (about ${times(f)})`;
    }
    case 'terrain':
      return `the steep-country effects (about ${times(f)}, model indicative)`;
  }
}

function line(key: FactorKey, f: number, c: PhraseCtx & { fuelSummary: string; nowMs: number }): string {
  const s = c.s;
  const k = c.k;
  switch (key) {
    case 'slope':
      return `Slope: ${int(Math.abs(c.th))}° ${c.th >= 0 ? 'uphill' : 'downhill'} along the spread → about ${times(f)} (doubles every 10° uphill).`;
    case 'wind': {
      const drawn = c.fw * 3.6 >= 1 ? `; about ${int(c.fw * 3.6)} km/h of it is air drawn in by the fire` : '';
      return `Wind: ${int(c.U * 3.6)} km/h from the ${compassWord(c.windFrom) || 'variable directions'} → ${times(f)}${drawn}.`;
    }
    case 'moisture':
      return `Litter moisture ${int(c.M)} % (${int(s.moistureAfdrs[k]!)} % by the AFDRS equations; ${moistureReason(s, k, c.nowMs)}) → ${times(f)}.`;
    case 'fuel': {
      const t = FUEL_TYPES[s.fuel.type[k] as keyof typeof FUEL_TYPES]?.name ?? 'fuel';
      return `${c.fuelSummary} → ${times(f)} relative to typical ${t.toLowerCase()}.`;
    }
    case 'terrain': {
      const aux = s.aux;
      if ((aux.attach[k] ?? 0) > 0.3) return `Terrain: flames attaching to this steep slope (eruptive regime) → ${times(f)} (model indicative).`;
      if (aux.vlsActive[k]) return `Terrain: sideways run in the lee-slope eddy → ${times(f)} (model indicative).`;
      if ((aux.junction[k] ?? 1) > 1.05) return `Terrain: two fire lines closing in → ${times(f)} (model indicative).`;
      const b = s.factorsAt(k).build ?? aux.build[k] ?? 1;
      if (b < 0.95) return `Build-up: the fire is still growing to its full speed (about ${int(100 * b)} %) → ${times(f)} (model indicative).`;
      return `Terrain and fire dynamics → ${times(f)} (model indicative).`;
    }
  }
}
