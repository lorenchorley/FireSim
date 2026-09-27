/**
 * Insight text library (spec §10.1–§10.2), in plain Australian English for beginner bush firefighters.
 *
 * Wording follows the spec's card table and the education research (docs/research/10-firefighter-education.md
 * §10.1 writing rules and §10.3 cards S01–S46; doc 01 §5 and doc 02 §5 mountain "why" statements):
 * - 2–4 sentences, "because" language, the terrain feature the reader can see ("this gully", "that saddle");
 * - numbers only as support, always with "about" and units (km/h, °, %, m);
 * - one safety line consistent with LACES; never "you are safe" (say "safer" / "less exposed");
 * - EVERY card's safety line ends with the doctrine line {@link DOCTRINE} (spec preamble; §10.1 requires it on
 *   danger cards, FireSim puts it on all of them);
 * - "(steeper than the tested range, so it could be faster)" when θ > 20°, and "The model can't see this
 *   precisely." when a sub-grid term is > 30 % of the local ROS or wind (§10.1).
 *
 * Doctrine wording still needs NSW RFS instructor review (spec §16 item 19).
 */
import type { Insight, InsightFactor, InsightKind, InsightSeverity } from '../core/types';
import { wrapDeg } from '../core/units';
import { EXPLAIN_PARAMS } from './params';

/** The doctrine line every card ends with (spec preamble and §10.1). */
export const DOCTRINE = 'Education only. LACES first. Follow your Crew Leader and NSW RFS procedures.';
/** §10.1 steep-slope note. */
export const STEEP_NOTE = '(steeper than the tested range, so it could be faster)';
/** §10.1 sub-grid note. */
export const SUBGRID_NOTE = "The model can't see this precisely.";

/** Detector output (spec §10.1). */
export interface Candidate {
  key: string;
  x: number;
  y: number;
  score: number;
  severity: InsightSeverity;
  values: Record<string, number | string>;
  /** Optional per-candidate override of the rule's persistence (cycles), e.g. general sub-notes. */
  persistence?: number;
  /** Optional per-candidate override of the rule's cool-down (s). */
  cooldown?: number;
}

export type CardText = Pick<Insight, 'title' | 'body' | 'safety' | 'factors' | 'source' | 'confidence' | 'showLayers'>;

// ─────────────────────────────────────────────────────────────────────────────
// Number and time formatting
// ─────────────────────────────────────────────────────────────────────────────

const num = (c: Candidate, name: string, dflt = NaN): number => {
  const v = c.values[name];
  return typeof v === 'number' ? v : dflt;
};
const str = (c: Candidate, name: string, dflt = ''): string => {
  const v = c.values[name];
  return typeof v === 'string' ? v : dflt;
};

/** Integer string ("12"); "?" for non-finite. */
export function int(v: number): string {
  return Number.isFinite(v) ? String(Math.round(v)) : '?';
}
/** One-decimal string for small values, integer above 10 ("3.4", "12"). */
export function short(v: number): string {
  if (!Number.isFinite(v)) return '?';
  const a = Math.abs(v);
  return a < 10 ? (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '') : String(Math.round(v));
}
/** Multiplier "×4.0" (one decimal below 10). */
export function times(f: number): string {
  if (!Number.isFinite(f)) return '×?';
  return f < 10 ? `×${f.toFixed(1)}` : `×${Math.round(f)}`;
}
/** m/s → km/h string. */
export const kmh = (ms: number): string => int(ms * 3.6);
/** Distance in km ("1.2"), metres below 1 km when `metresBelowKm`. */
export function km(m: number): string {
  return m < 10000 ? (Math.round(m / 100) / 10).toFixed(1) : String(Math.round(m / 1000));
}
/** Rate of spread for beginners: "about 350 m/h" below 1 km/h, "about 2.4 km/h" above. */
export function rate(ms: number): string {
  const mh = ms * 3600;
  if (!Number.isFinite(mh)) return 'an unknown rate';
  return mh < 1000 ? `about ${int(mh)} m/h` : `about ${short(mh / 1000)} km/h`;
}
/** Duration "about 45 min" / "about 2 h 10 min". */
export function duration(s: number): string {
  if (!Number.isFinite(s)) return 'an unknown time';
  const m = Math.max(0, Math.round(s / 60));
  if (m < 60) return `about ${m} min`;
  const h = Math.floor(m / 60);
  const r = m - 60 * h;
  return r === 0 ? `about ${h} h` : `about ${h} h ${r} min`;
}

const WORDS8 = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'] as const;
/** 8-point compass word of an azimuth ("south-west"); "" for NaN. */
export function compassWord(azDeg: number): string {
  if (!Number.isFinite(azDeg)) return '';
  return WORDS8[Math.round(wrapDeg(azDeg) / 45) % 8]!;
}
/** Wind name from its FROM direction: "north-westerly". */
export function windName(fromDeg: number): string {
  const w = compassWord(fromDeg);
  return w ? `${w}erly` : 'variable';
}
/** Aspect words: "north-west-facing"; "flat" for NaN. */
export function facing(aspectDeg: number): string {
  const w = compassWord(aspectDeg);
  return w ? `${w}-facing` : 'flat';
}

const fmtCache = new Map<string, Intl.DateTimeFormat | null>();
/** Civil clock time "3:05 pm" in the scenario time zone (default Australia/Sydney, DST-aware; spec §0.2). */
export function clock(ms: number, timeZone = 'Australia/Sydney'): string {
  if (!Number.isFinite(ms)) return 'an unknown time';
  let f = fmtCache.get(timeZone);
  if (f === undefined) {
    try {
      f = new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone });
    } catch {
      f = null;
    }
    fmtCache.set(timeZone, f);
  }
  if (f) return f.format(new Date(ms)).replace(/ | /g, ' ').toLowerCase();
  // Fallback: fixed AEST (UTC+10).
  const d = new Date(ms + 10 * 3.6e6);
  const h = d.getUTCHours();
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${h % 12 === 0 ? 12 : h % 12}:${mm} ${h < 12 ? 'am' : 'pm'}`;
}

/** Steep-slope note (with a leading space) when θ > 20°, else "". */
export function steep(theta: number): string {
  return theta > EXPLAIN_PARAMS.notes.steepDeg ? ` ${STEEP_NOTE}` : '';
}
/** Sub-grid note (with a leading space) when the share is above 30 %, else "". */
export function subgrid(share: number): string {
  return share > EXPLAIN_PARAMS.notes.subgridShare ? ` ${SUBGRID_NOTE}` : '';
}
/** Safety line + doctrine. */
export function safetyLine(line: string): string {
  return `${line} ${DOCTRINE}`;
}

const f = (label: string, value: string, effect?: string): InsightFactor => (effect ? { label, value, effect } : { label, value });

/** Slope factor used in texts: SF = 2^(θ/10) uphill, capped at 16 (D2, D4). */
export const slopeFactorText = (theta: number): number => Math.min(16, Math.pow(2, Math.max(0, theta) / 10));
/** Kataburn downslope factor s/(2s − 1), s = 2^(|θ|/10) (D3). */
export function kataburn(thetaDown: number): number {
  const s = Math.pow(2, Math.abs(thetaDown) / 10);
  return s / (2 * s - 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Card templates (spec §10.2 table)
// ─────────────────────────────────────────────────────────────────────────────

type Render = (c: Candidate) => CardText;

const upslopeRun: Render = (c) => {
  const th = num(c, 'theta');
  const sf = slopeFactorText(th);
  const lead = th > EXPLAIN_PARAMS.notes.steepDeg ? 'at least' : 'about';
  return {
    title: 'Fire runs uphill',
    body:
      `On this ${int(th)}° slope the flames lean into the fuel above and pre-heat it, so the fire is spreading ${lead} ${times(sf)} ` +
      `faster than on flat ground${steep(th)}. Fire roughly doubles its speed for every 10° of slope. ` +
      `Watch for flames leaning uphill and smoke sweeping up the slope.${subgrid(num(c, 'subgrid', 0))}`,
    safety: safetyLine('Never position yourself upslope of a fire; escape routes should not go uphill.'),
    factors: [f('Slope along the spread', `about ${int(th)}°`, `${times(sf)} spread`), f('Spread rate', rate(num(c, 'ros')))],
    source: 'McArthur 1967; Noble 1980; Cruz 2021',
    confidence: 'physics',
    showLayers: ['slope', 'spread'],
  };
};

const downslopeBacking: Render = (c) => {
  const v = str(c, 'variant');
  const th = num(c, 'theta');
  const safety = safetyLine(`"Fire doesn't go downhill" is not a safe rule; don't be on the opposite slope above a narrow gully.`);
  const common = { source: 'Sullivan 2014; IRPG 2025', confidence: 'physics' as const, showLayers: ['slope'] };
  if (v === 'S10') {
    return {
      ...common,
      title: 'Strong wind can push fire downhill',
      body:
        `Strong wind down this slope can push fire downhill fast: about ${kmh(num(c, 'windDown'))} km/h is blowing down this ` +
        `${int(Math.abs(th))}° slope and the litter is dry (about ${int(num(c, 'moisture'))} %). Without wind a fire backs downhill ` +
        'slowly, but a strong downslope wind overrides that.',
      safety: safetyLine(`"Fire doesn't go downhill" is not a safe rule; check the wind direction against the slope.`),
      factors: [f('Wind down the slope', `about ${kmh(num(c, 'windDown'))} km/h`), f('Slope', `about ${int(Math.abs(th))}°`), f('Litter moisture', `about ${int(num(c, 'moisture'))} %`)],
    };
  }
  const pct = 100 * kataburn(th);
  const base =
    `The fire is creeping downhill at ${rate(num(c, 'ros'))}, about ${int(pct)} % of its flat-ground speed. ` +
    'Downhill spread slows but never stops (kataburn).';
  const note = subgrid(num(c, 'subgrid', 0));
  if (v === 'S43') {
    return {
      ...common,
      title: 'Backing fire reaching a narrow gully',
      body:
        `${base} When it reaches the gully floor it will start running up the other side, which is about ` +
        `${int(num(c, 'wall'))}° steep and already heated across the gap.${note}`,
      safety,
      factors: [f('Slope along the spread', `about ${int(th)}°`, `about ${int(pct)} % of flat`), f('Opposite wall', `about ${int(num(c, 'wall'))}°`)],
    };
  }
  return {
    ...common,
    title: 'Backing downhill',
    body: `${base} Watch for burning bark and logs rolling down and starting fires below.${note}`,
    safety,
    factors: [f('Slope along the spread', `about ${int(th)}°`, `about ${int(pct)} % of flat`), f('Spread rate', rate(num(c, 'ros')))],
  };
};

const gullyChimney: Render = (c) => {
  const a = num(c, 'axial');
  const why = str(c, 'variant') === 'anabatic' ? 'the sun-warmed slopes are drawing air up it' : 'the wind is blowing up it';
  return {
    title: 'Chimney / gully run',
    body:
      "This steep gully works like a chimney: the fire's own heat pulls air up it and the walls heat each other, so fire can " +
      `race up it in minutes. It climbs at about ${int(a)}°${steep(a)} and ${why}. Many firefighter deaths happened in or above gullies like this.` +
      subgrid(num(c, 'subgrid', 0)),
    safety: safetyLine('Do not work in, above or at the head of a gully with fire below.'),
    factors: [f('Gully slope', `about ${int(a)}°`), f('Fire from the gully base', `about ${int(num(c, 'baseDist'))} m`), f('Attachment', short(num(c, 'attach')))],
    source: 'Viegas & Pita 2004; IRPG 2025',
    confidence: 'rule-of-thumb',
    showLayers: ['slope', 'trench'],
  };
};

const eruptiveSlope: Render = (c) => {
  const th = num(c, 'theta');
  return {
    title: 'Flames may "stick" to the slope',
    body:
      `On ground this steep (${int(th)}°) the flame lies down along the slope like a blowtorch${steep(th)}. Heating jumps and the fire ` +
      `can accelerate without any wind change. Eruptive regime: model indicative only.${subgrid(num(c, 'subgrid', 0))}`,
    safety: safetyLine('Expect sudden runs; keep well clear above and beside.'),
    factors: [f('Slope along the spread', `about ${int(th)}°`), f('Attachment score A', short(num(c, 'A'))), f('Extra speed from attachment', times(num(c, 'G')))],
    source: 'Wu 2000; Xie 2017; Fan 2025',
    confidence: 'model-estimate',
    showLayers: ['slope', 'attach'],
  };
};

const ridgeCrest: Render = (c) => ({
  title: 'Fire reaching the ridge',
  body:
    `The run up this slope will slow at the crest, but there the fire meets stronger wind (about ${kmh(num(c, 'uRidge'))} km/h on the ridge) ` +
    'and throws embers into the next valley. Spot fires often start on the far side before the main fire gets there.',
  safety: safetyLine('If you are on the ridge or beyond, post a lookout facing the far side.'),
  factors: [f('Ridge-top wind', `about ${kmh(num(c, 'uRidge'))} km/h`), f('Fire from the crest', `about ${int(num(c, 'dist'))} m`)],
  source: 'Sharples 2009',
  confidence: 'rule-of-thumb',
  showLayers: ['wind', 'embers'],
});

const leeSlopeEddy: Render = (c) => ({
  title: 'The wind on this slope blows the "wrong" way',
  body:
    'Behind this steep ridge the main wind lifts off; underneath, air circulates back up the slope, gusty and shifting. ' +
    `Fire here can creep uphill against the main wind.${subgrid(num(c, 'sep', 1))}`,
  safety: safetyLine('Embers from the ridge can land anywhere on this face.'),
  factors: [f('Lee separation score', short(num(c, 'sep'))), f('Ridge-top wind', `about ${kmh(num(c, 'uRidge'))} km/h`), f('Slope', `about ${int(num(c, 'slope'))}°`)],
  source: 'Wood 1995; Sharples 2012',
  confidence: 'sub-grid',
  showLayers: ['wind'],
});

const vls: Render = (c) => {
  const rl = num(c, 'rl');
  const pre = str(c, 'variant') === 'pre';
  const body = pre
    ? `Strong wind (about ${kmh(num(c, 'uRidge'))} km/h) is crossing the ridge ahead of the fire onto a steep lee slope. If the fire gets ` +
      `there it can be dragged sideways across the wind, about ${short(rl)} km/h in 10–15 min surges, while throwing embers far downwind.`
    : 'Wind pouring over the ridge rolls into an eddy on this steep lee slope. Fire caught in it is dragged sideways across the wind, ' +
      `about ${short(rl)} km/h in 10–15 min surges, while throwing embers far downwind.`;
  return {
    title: pre ? 'Lee slope ahead: fire could run sideways' : 'Fire can run sideways along this lee slope',
    body: `${body}${subgrid(1)}`,
    safety: safetyLine("Don't assume the flanks are safe on lee slopes."),
    factors: [f('Lee-slope score (VLS)', short(num(c, 'vls'))), f('Ridge-top wind', `about ${kmh(num(c, 'uRidge'))} km/h`), f('Sideways speed', `about ${short(rl)} km/h`)],
    source: 'Sharples 2012; Simpson 2013',
    confidence: 'sub-grid',
    showLayers: ['vls', 'wind'],
  };
};

const saddle: Render = (c) => ({
  title: 'Saddle ahead',
  body:
    'Wind squeezes through the low point in the ridge and speeds up, and fire follows it into the next valley. ' +
    `This saddle is about ${km(num(c, 'dist'))} km ahead of the head fire, with about ${kmh(num(c, 'uRidge'))} km/h of wind there. ` +
    'Saddles look like easy crossings, but they are fire corridors.',
  safety: safetyLine("Don't park, rest or plan a refuge in a saddle."),
  factors: [f('Distance ahead', `about ${km(num(c, 'dist'))} km`), f('Wind at the saddle', `about ${kmh(num(c, 'uRidge'))} km/h`)],
  source: 'IRPG 2025',
  confidence: 'rule-of-thumb',
  showLayers: ['wind'],
});

const valley: Render = (c) => ({
  title: 'This valley has its own wind',
  body:
    'Valleys steer the wind along their length whatever the wind does above the ridges: up-valley in the afternoon, down-valley at ' +
    `night. Here the valley-floor wind is from the ${compassWord(num(c, 'floorDir'))}, while the ridge-top wind is from the ${compassWord(num(c, 'ridgeDir'))}.`,
  safety: safetyLine('Check the wind where you are, not only the forecast.'),
  factors: [f('Valley-floor wind', `from the ${compassWord(num(c, 'floorDir'))}, about ${kmh(num(c, 'floorSpeed'))} km/h`), f('Direction difference', `about ${int(num(c, 'diff'))}°`), f('Valley depth', `about ${int(num(c, 'relief'))} m`)],
  source: 'Whiteman 2000',
  confidence: 'physics',
  showLayers: ['wind'],
});

const ridgeSpeedUp: Render = (c) => ({
  title: 'Stronger wind on the crest',
  body:
    `Wind speeds up over the top of this ridge (about +${int(100 * num(c, 'speedUp'))} %). A fire reaching it will suddenly get stronger wind, ` +
    'and embers can be thrown over the other side.',
  safety: safetyLine('Expect a flare-up and spotting at the crest.'),
  factors: [f('Speed-up on the crest', `about +${int(100 * num(c, 'speedUp'))} %`), f('Crest wind', `about ${kmh(num(c, 'uCrest'))} km/h`)],
  source: 'Jackson & Hunt 1975; Taylor & Lee 1984',
  confidence: 'physics',
  showLayers: ['wind'],
});

const spotting: Render = (c) => {
  const S = num(c, 'S');
  const bark = str(c, 'variant') === 'bark';
  const body = bark
    ? `Stringybark here is shedding burning strips into about ${kmh(num(c, 'u10'))} km/h of wind, with litter at about ${int(num(c, 'moisture'))} %, ` +
      `so embers can be carried well ahead. The Australian operational model says up to about ${km(S)} km for this fire.`
    : `Burning bark is being carried ${km(num(c, 'd'))} km ahead. The Australian operational model says up to about ${km(S)} km for this fire.`;
  return {
    title: 'Embers landing far ahead',
    body: `${body} In south-east Australia most spot fires land within about 5 km.`,
    safety: safetyLine('Your location can be "ahead of the fire" even if the edge is far away; watch behind you.'),
    factors: bark
      ? [f('Bark hazard', short(num(c, 'bark'))), f('Wind', `about ${kmh(num(c, 'u10'))} km/h`), f('Operational spotting estimate', `about ${km(S)} km`)]
      : [f('Furthest ember that can light', `about ${km(num(c, 'd'))} km`), f('Operational spotting estimate', `about ${km(S)} km`)],
    source: 'Storey 2020; FBI-TG eq 3.51',
    confidence: 'model-estimate',
    showLayers: ['embers'],
  };
};

const spotFire: Render = (c) => {
  const t = num(c, 'flightTime');
  const h = num(c, 'height');
  const m = num(c, 'moisture');
  const flight = Number.isFinite(t) && Number.isFinite(h) ? ` (${int(t)} s, up to ${int(h)} m high)` : '';
  const land = Number.isFinite(m) ? ` and landed on ${int(m)} % litter` : ' and landed in dry fuel';
  return {
    title: 'Spot fire',
    body:
      `An ember from ${str(c, 'src', 'the fire')} flew ${int(num(c, 'travel'))} m${flight}${land}. ` +
      `It has started a new fire about ${int(num(c, 'dist'))} m from the main front.`,
    safety: safetyLine('Report spot fires; they grow and join quickly.'),
    factors: [f('Ember flight', `about ${int(num(c, 'travel'))} m`), f('Distance from the front', `about ${int(num(c, 'dist'))} m`)],
    source: 'FireSim ember provenance',
    confidence: 'model-estimate',
    showLayers: ['embers'],
  };
};

const massSpotting: Render = (c) => ({
  title: 'Mass spotting',
  body:
    `Embers are starting many new fires ahead of the front (about ${int(num(c, 'count'))} in the last 30 min). ` +
    'They will merge and the fire can jump forward suddenly.',
  safety: safetyLine('Treat any ember as a new fire; be ready to move.'),
  factors: [f('Spot fires (30 min, within 2 km)', int(num(c, 'count')))],
  source: 'Cruz 2012',
  confidence: 'model-estimate',
  showLayers: ['embers'],
});

const junction: Render = (c) => ({
  title: 'Two fire lines meeting',
  body:
    `Where two fires meet at a sharp angle the join races forward about ${times(num(c, 'factor'))} faster by geometry alone, and faster ` +
    `again as they feed each other. These two edges are about ${int(num(c, 'gap'))} m apart and meet at about ${int(num(c, 'alpha'))}°.`,
  safety: safetyLine('Never be in the unburnt pocket between two fires.'),
  factors: [f('Angle between the lines', `about ${int(num(c, 'alpha'))}°`, `${times(num(c, 'factor'))} at the join`), f('Gap', `about ${int(num(c, 'gap'))} m`)],
  source: 'Viegas 2012; Raposo 2018',
  confidence: 'physics',
  showLayers: ['spread'],
});

const windChange: Render = (c) => {
  const dir = compassWord(num(c, 'toDir'));
  const time = str(c, 'clock');
  const L = num(c, 'flankM');
  const inS = num(c, 'inS');
  const countdown = Number.isFinite(inS) && inS > 0 ? ` That is in ${duration(inS)}.` : '';
  const body =
    Number.isFinite(L) && L > 0
      ? `When the wind swings to the ${dir} at about ${time}, this ${km(L)} km flank becomes the front and runs at full speed almost at once.${countdown} A wide front moves fast and is hard to stop.`
      : `The forecast has the wind swinging from the ${compassWord(num(c, 'fromDir'))} to the ${dir} at about ${time} (about ${kmh(num(c, 'postSpeed'))} km/h). ` +
        `When it swings, the long side of the fire facing the new wind becomes the front and runs at full speed almost at once.${countdown}`;
  return {
    title: 'Wind change: this flank becomes the head',
    body,
    safety: safetyLine('Know the change time; move off the flank that will become the head, or into the black, before it.'),
    factors: [
      f('New wind', `from the ${dir}, about ${kmh(num(c, 'postSpeed'))} km/h`),
      f('Wind shift', `about ${int(num(c, 'shift'))}°`),
      f('Change time', `about ${time}`),
      ...(Number.isFinite(L) && L > 0 ? [f('Exposed flank', `about ${km(L)} km`)] : []),
    ],
    source: 'Cheney 2001; Linton coroner 2002',
    confidence: 'rule-of-thumb',
    showLayers: ['wind', 'dmz'],
  };
};

const deadManZone: Render = (c) => ({
  title: 'Dead-man zone',
  body:
    'If the wind changed now, fire could reach anywhere in the shaded zone within 5 minutes. ' +
    `The change to the ${compassWord(num(c, 'toDir'))} is due in ${duration(num(c, 'inS'))}, and the zone covers about ${int(num(c, 'areaHa'))} ha. ` +
    "The model leaves out the fire's own winds here, so the real zone is at least this big.",
  safety: safetyLine('Work close to the black or move out of the zone.'),
  factors: [f('Zone area', `about ${int(num(c, 'areaHa'))} ha`), f('Time to the change', duration(num(c, 'inS')))],
  source: 'Cheney, Gould & McCaw 2001',
  confidence: 'model-estimate',
  showLayers: ['dmz'],
});

const plumeDominated: Render = (c) => ({
  title: 'The fire is making its own weather',
  body:
    "The fire's heat is stronger than the wind. The column stands up, winds near the fire pull toward it from all sides and can " +
    'change quickly. Normal wind-based predictions become unreliable.',
  safety: safetyLine('Expect erratic behaviour and inflow winds; stay near your refuge.'),
  factors: [f('Convective number (N_c)', `about ${int(num(c, 'nc'))}`), f('Length of head affected', `about ${int(num(c, 'lengthM'))} m`)],
  source: 'Byram 1959; Nelson 1993',
  confidence: 'physics',
  showLayers: ['plume'],
});

const pyroconvection: Render = (c) => {
  const safety = safetyLine('Crews should be in safe areas before this; vehicles are not safe from these winds.');
  if (str(c, 'variant') === 'synthetic') {
    return {
      title: 'Fire thunderstorm risk unknown',
      body:
        "Upper-air data unavailable for this date, so FireSim can't check how unstable the air above is. " +
        `On a day this hot, dry and windy (FFDI about ${int(num(c, 'ffdi'))}), treat a fire thunderstorm as possible.`,
      safety,
      factors: [f('FFDI', `about ${int(num(c, 'ffdi'))}`), f('Upper air', 'not available')],
      source: 'Di Virgilio 2019; Tory & Kepert 2021',
      confidence: 'rule-of-thumb',
      showLayers: ['plume'],
    };
  }
  const ch = num(c, 'cHaines');
  return {
    title: 'Fire thunderstorm possible',
    body:
      'The air above is unstable and dry. A big enough fire can build its own storm: violent gusts, downdrafts, lightning and ' +
      'long-range embers. Watch the smoke column for a white cap forming.',
    safety,
    factors: [
      ...(Number.isFinite(ch) ? [f('C-Haines', `about ${short(ch)}`)] : []),
      f('FFDI', `about ${int(num(c, 'ffdi'))}`),
      ...(str(c, 'variant') === 'plume' ? [f('Plume top above cloud base', `about ${int(num(c, 'plumeAboveLcl'))} m`)] : []),
    ],
    source: 'Di Virgilio 2019; Tory & Kepert 2021',
    confidence: 'rule-of-thumb',
    showLayers: ['plume'],
  };
};

const fireInducedWind: Render = (c) => ({
  title: 'The fire is making its own wind',
  body:
    'Heat rising from the fire pulls air in from the sides; near the fire the wind can blow toward the flames, against the forecast. ' +
    `About ${kmh(num(c, 'fw'))} km/h of the wind at the fire edge is air drawn in by the fire.`,
  safety: safetyLine('Expect gusty, shifting winds close in.'),
  factors: [f('Fire-drawn wind', `about ${kmh(num(c, 'fw'))} km/h`), f('Share of the fire edge', `about ${int(100 * num(c, 'share'))} %`)],
  source: 'Clark 1996; FireSim coupled atmosphere',
  confidence: 'model-estimate',
  showLayers: ['wind'],
});

const anabatic: Render = (c) => ({
  title: 'Sun-warmed slope pulling fire uphill',
  body:
    `This slope has been in the sun; warm air creeps up it (about ${kmh(num(c, 'upslope'))} km/h) and adds to the slope effect. ` +
    `Watch for smoke drifting up the slope.${subgrid(num(c, 'subgrid', 0))}`,
  safety: safetyLine('Expect the fire to pick up on sunny slopes.'),
  factors: [f('Upslope breeze', `about ${kmh(num(c, 'upslope'))} km/h`), f('Surface heating', `about ${int(num(c, 'qh'))} W/m²`), f('Slope', `about ${int(num(c, 'slope'))}°`)],
  source: 'Whiteman 2000; WindNinja',
  confidence: 'physics',
  showLayers: ['wind', 'sun'],
});

const katabatic: Render = (c) => {
  const s = num(c, 'downslope');
  const speed = s >= 0.5 / 3.6 ? `about ${kmh(Math.max(s, 1 / 3.6))} km/h` : 'slowly';
  const lead = str(c, 'variant') === 'S17' ? `The wind near the fire has turned about ${int(num(c, 'turn'))}° in the last 2 hours as the sun goes down. ` : '';
  return {
    title: 'Evening: the wind turns downhill',
    body: `${lead}Cool air now drains down the slope and valley (${speed}). Upslope runs slow, the fire may back downhill, and smoke sinks into the valley.`,
    safety: safetyLine('Re-check which side is "the head" at dusk.'),
    factors: [f('Downslope breeze', speed), ...(lead ? [f('Wind turn in 2 h', `about ${int(num(c, 'turn'))}°`)] : [])],
    source: 'Whiteman 2000; IRPG 2025',
    confidence: 'physics',
    showLayers: ['wind'],
  };
};

const thermalBelt: Render = (c) => {
  if (str(c, 'variant') === 'ridge') {
    return {
      title: "Ridges don't sleep",
      body:
        `Up here you're above the night-time cold layer. The wind keeps blowing (about ${kmh(num(c, 'uRidge'))} km/h) and the air stays dry, ` +
        "so the fuel doesn't soak up moisture overnight and fire on the tops can stay active all night.",
      safety: safetyLine("Night doesn't always mean quiet; expect activity on the ridge tops."),
      factors: [f('Ridge-top wind', `about ${kmh(num(c, 'uRidge'))} km/h`), f('Height above the valley floor', `about ${int(num(c, 'hav'))} m`)],
      source: 'Sharples 2009; BNHCRC 2017',
      confidence: 'physics',
      showLayers: ['temperature'],
    };
  }
  return {
    title: 'Thermal belt',
    body:
      'At night cold air sinks into the valley, but the middle of the slope can stay warmer and drier than both the valley and the ridge top. ' +
      'Cold air has pooled in the valley; this band part-way up the slope stays warmer and drier all night ' +
      `(${int(num(c, 'moisture'))} % litter vs ${int(num(c, 'floorMoisture'))} % on the valley floor), so fire keeps burning here.`,
    safety: safetyLine("Night doesn't always mean quiet; expect activity on mid-slopes."),
    factors: [
      f('Litter moisture here', `about ${int(num(c, 'moisture'))} %`),
      f('Valley floor', `about ${int(num(c, 'floorMoisture'))} %`),
      f('Height above the valley floor', `about ${int(num(c, 'hav'))} m`),
    ],
    source: 'Schroeder & Buck 1970; IRPG 2025',
    confidence: 'physics',
    showLayers: ['temperature'],
  };
};

const inversionBreak: Render = (c) => {
  const v = str(c, 'variant');
  const safety = safetyLine('A quiet smoky morning is not a safe morning; re-check escape routes before mid-morning.');
  const common = { source: 'Whiteman 1982; IRPG 2025', confidence: 'physics' as const, showLayers: ['temperature', 'smoke'] };
  const wet = num(c, 'wet', 0) > 0 ? ' The ground is wet, so the lid may break later than usual.' : '';
  if (v === 'smoke') {
    return {
      ...common,
      title: 'Smoke trapped in the valley',
      body: "Cold air under a warm lid is trapping smoke here. The fire looks quiet, but it hasn't gone out. It will pick up once the sun breaks the lid.",
      safety,
      factors: [f('Cold-pool strength', `about ${short(num(c, 'dTheta'))} °C`)],
    };
  }
  if (v === 'now') {
    return {
      ...common,
      title: 'Morning inversion breaking now',
      body:
        'The cold lid that held the fire and smoke down overnight is breaking now. Stronger, drier wind from above is reaching the fire; ' +
        'expect a jump in speed and a change in direction.',
      safety,
      factors: [f('Cold-pool strength left', `about ${short(num(c, 'dTheta'))} °C`)],
    };
  }
  const when = str(c, 'clock');
  return {
    ...common,
    title: 'Morning inversion about to break',
    body:
      'The cold lid holding the fire and smoke down is about to break. Stronger, drier wind from above will reach the fire within minutes' +
      `${when ? ` (expected about ${when})` : ''}.${wet}`,
    safety,
    factors: [f('Cold-pool strength', `about ${short(num(c, 'dTheta'))} °C`), ...(when ? [f('Expected break', `about ${when}`)] : [])],
  };
};

const aspectDryFuel: Render = (c) => {
  if (str(c, 'variant') === 'S38') {
    return {
      title: 'Forces aligned',
      body:
        'Right now wind, slope and sun are all pushing the fire the same way. When all three line up, fires make their biggest runs. ' +
        'When they oppose each other, the fire slows.',
      safety: safetyLine('Watch where wind, slope and sun will line up next: that is where the fire will make its next run.'),
      factors: [f('Wind', `about ${kmh(num(c, 'wind'))} km/h with the spread`), f('Slope', `about ${int(num(c, 'slope'))}° uphill`), f('Sun', 'on the slope ahead')],
      source: 'Campbell 1995; IRPG 2025',
      confidence: 'rule-of-thumb',
      showLayers: ['sun', 'slope', 'wind'],
    };
  }
  return {
    title: 'Sunny-side slope',
    body:
      `This ${facing(num(c, 'aspect'))} slope faces the sun; its litter is about ${short(num(c, 'dM'))} points drier than the shady side, ` +
      'so the fire speeds up crossing onto it. In Australia north- and west-facing slopes get the most sun, and the bush there is often more open.',
    safety: safetyLine('Expect the fire to pick up on sunny slopes in the afternoon.'),
    factors: [f('Litter moisture here', `about ${int(num(c, 'moisture'))} %`), f('Shady side', `about ${int(num(c, 'opposite'))} %`)],
    source: 'Slijepcevic 2015; Nyman 2018',
    confidence: 'physics',
    showLayers: ['moisture', 'sun'],
  };
};

const moistGully: Render = (c) => {
  const safety = safetyLine("Moist gullies can still carry fire in drought; don't rely on them.");
  if (str(c, 'variant') === 'drought') {
    return {
      title: 'The gullies have dried out',
      body:
        `In this drought (KBDI about ${int(num(c, 'kbdi'))}) even this sheltered wet gully has dry, available fuel ` +
        `(about ${int(100 * num(c, 'fa'))} % of it can burn). Don't expect it to slow the fire.`,
      safety,
      factors: [f('KBDI', `about ${int(num(c, 'kbdi'))} mm`), f('Fuel available to burn', `about ${int(100 * num(c, 'fa'))} %`)],
      source: 'FBI-TG eq 3.2; AFDRS-RP §10.1',
      confidence: 'rule-of-thumb',
      showLayers: ['moisture'],
    };
  }
  return {
    title: 'Wet gully slowing the fire',
    body:
      `This shaded gully holds moister fuel and wetter forest (${int(num(c, 'moisture'))} %), so the fire slows here. ` +
      'Little sun reaches the gully floor and the air stays damp, so its litter dries slowly.',
    safety,
    factors: [f('Gully litter moisture', `about ${int(num(c, 'moisture'))} %`), f('At the fire edge', `about ${int(num(c, 'frontMoisture'))} %`)],
    source: 'FBI-TG eq 3.2; AFDRS-RP §10.1',
    confidence: 'rule-of-thumb',
    showLayers: ['moisture'],
  };
};

const heavyFuel: Render = (c) => {
  const fh = num(c, 'flameHeight');
  return {
    title: 'Tall understorey: flames will get taller',
    body:
      `Shrubs and bark act as a ladder; flames here are about ${short(fh)} m. ` +
      'Taller flames are hotter, harder to stop and more likely to reach the treetops.',
    safety: safetyLine(`Taller flames need a bigger refuge: clear ground ≥ 4 × flame height (about ${int(4 * fh)} m).`),
    factors: [f('Flame height', `about ${short(fh)} m`), f('Refuge clearance needed', `about ${int(4 * fh)} m`)],
    source: 'Hines 2010; Gould 2007',
    confidence: 'physics',
    showLayers: ['fuel'],
  };
};

const recentBurn: Render = (c) => {
  const n = num(c, 'years');
  const extreme = num(c, 'extreme', 0) > 0 ? ' On extreme days a recent burn may not slow a crown fire much.' : '';
  return {
    title: 'This area burned recently',
    body:
      `It burned ${short(n)} years ago; litter is about ${int(num(c, 'pct'))} % of its long-unburnt amount, so the fire should slow and ` +
      `burn lower.${extreme}`,
    safety: safetyLine("Use it as an anchor, but check for hazard trees; it won't stop embers."),
    factors: [f('Years since fire', `about ${short(n)}`), f('Litter', `about ${int(num(c, 'pct'))} % of long-unburnt`), f('Distance from the head', `about ${int(num(c, 'dist'))} m`)],
    source: 'Olson 1963; FBI-TG eq 3.52',
    confidence: 'physics',
    showLayers: ['fuel', 'history'],
  };
};

const crownFire: Render = (c) => ({
  title: 'The fire is climbing into the treetops',
  body:
    'It is hot enough to set the canopy alight; crown fire spreads faster and throws far more embers. ' +
    `Intensity here is about ${int(num(c, 'intensity'))} kW/m with flames about ${short(num(c, 'flameHeight'))} m.`,
  safety: safetyLine('Direct attack is not possible; go to your refuge or the black.'),
  factors: [f('Fireline intensity', `about ${int(num(c, 'intensity'))} kW/m`), f('Flame height', `about ${short(num(c, 'flameHeight'))} m`)],
  source: 'AFDRS-RP Tables 2.9–2.11',
  confidence: 'rule-of-thumb',
  showLayers: ['intensity'],
});

const highDrought: Render = (c) => ({
  title: 'Deep drought',
  body:
    `Drought factor ${short(num(c, 'df'))}: nearly all fine fuel is available, heavy fuels burn, and wet gullies and forests can carry fire. ` +
    `The soil dryness index (KBDI) is about ${int(num(c, 'kbdi'))} mm.`,
  safety: safetyLine("Expect fire where you'd normally expect it to stop."),
  factors: [f('Drought factor', short(num(c, 'df'))), f('KBDI', `about ${int(num(c, 'kbdi'))} mm`)],
  source: 'Griffiths 1999; Finkele 2006',
  confidence: 'physics',
  showLayers: ['moisture'],
});

const nightSlowdown: Render = (c) => ({
  title: 'Night slowdown',
  body:
    `Cooler, moister night air has slowed the fire (litter ${int(num(c, 'moisture'))} %). The head is now spreading at about ` +
    `${int(100 * num(c, 'ratio'))} % of today's fastest rate.` +
    (num(c, 'belt', 0) > 0 ? ' Mid-slopes in the thermal belt can stay active.' : ''),
  safety: safetyLine('It will pick up again after the morning inversion breaks.'),
  factors: [f('Litter moisture', `about ${int(num(c, 'moisture'))} %`, `up about ${short(num(c, 'rise'))} points since sunset`), f('Head spread', rate(num(c, 'ros')))],
  source: 'Vesta night moisture (FBI-TG eq 3.48)',
  confidence: 'physics',
  showLayers: ['moisture'],
});

const afternoonPeak: Render = (c) => {
  if (str(c, 'variant') === 'S13') {
    const fbi = num(c, 'fbi');
    return {
      title: 'Hot, dry and windy',
      body:
        `Hot, dry ${windName(num(c, 'dir'))} winds are drying the leaf litter to a crisp (about ${int(num(c, 't'))} °C, ${int(num(c, 'rh'))} % humidity, ` +
        `${kmh(num(c, 'u10'))} km/h). The fire will be at its most aggressive now, and a wind change later could swing it.`,
      safety: safetyLine('Plan both for the run now and for the change later.'),
      factors: [
        f('Temperature', `about ${int(num(c, 't'))} °C`),
        f('Humidity', `about ${int(num(c, 'rh'))} %`),
        f('Wind', `about ${kmh(num(c, 'u10'))} km/h from the ${compassWord(num(c, 'dir'))}`),
        ...(Number.isFinite(fbi) ? [f('Fire behaviour index', `about ${int(fbi)}`)] : []),
      ],
      source: 'Mills 2008; Sharples 2009',
      confidence: 'rule-of-thumb',
      showLayers: ['moisture', 'wind'],
    };
  }
  const when = str(c, 'clock');
  return {
    title: 'Afternoon peak',
    body:
      `Litter is driest and the air hottest ${when ? `about ${when}` : 'now'}; north- and west-facing slopes are the driest. ` +
      `Litter moisture is about ${int(num(c, 'ma'))} % by the AFDRS equations.`,
    safety: safetyLine('Expect the biggest runs now; re-check terrain, weather and fuel.'),
    factors: [f('AFDRS litter moisture', `about ${int(num(c, 'ma'))} %`), ...(when ? [f('Driest hour', `about ${when}`)] : [])],
    source: 'IRPG 2025',
    confidence: 'rule-of-thumb',
    showLayers: ['moisture'],
  };
};

const fuelBreakBreached: Render = (c) => {
  const safety = safetyLine('Breaks need to be wide and patrolled; embers cross them.');
  if (str(c, 'variant') === 'spot') {
    return {
      title: 'Fire crossed the break',
      body: `An ember flew across a ${int(num(c, 'width'))} m break and started a fire on the other side. Breaks slow the front but don't stop embers.`,
      safety,
      factors: [f('Break width', `about ${int(num(c, 'width'))} m`), f('Ember flight', `about ${int(num(c, 'travel'))} m`)],
      source: 'Wilson 1988',
      confidence: 'rule-of-thumb',
      showLayers: ['fuel', 'embers'],
    };
  }
  return {
    title: 'Fire crossed the break',
    body: `A ${int(num(c, 'width'))} m break at ${int(num(c, 'intensity'))} kW/m has about a ${int(100 * num(c, 'p'))} % chance of being crossed (Wilson). This one was crossed.`,
    safety,
    factors: [f('Break width', `about ${int(num(c, 'width'))} m`), f('Fire intensity', `about ${int(num(c, 'intensity'))} kW/m`), f('Chance of crossing', `about ${int(100 * num(c, 'p'))} %`)],
    source: 'Wilson 1988',
    confidence: 'rule-of-thumb',
    showLayers: ['fuel'],
  };
};

const rollingDebris: Render = (c) => ({
  title: 'Rolling embers and logs',
  body:
    `Burning material is rolling down this ${int(num(c, 'theta'))}° slope and can start fires below you. ` +
    `One piece stopped about ${int(num(c, 'drop'))} m below the fire edge.`,
  safety: safetyLine("Patrol below the line; don't stand in the fall line of a burning slope."),
  factors: [f('Slope', `about ${int(num(c, 'theta'))}°`), f('Items in the last 10 min', int(num(c, 'count')))],
  source: 'Watch Out #13',
  confidence: 'rule-of-thumb',
  showLayers: ['debris'],
});

// ── general sub-notes (spec §10.2 second table) ─────────────────────────────────────────────────────

const GENERAL: Record<string, Render> = {
  steep: (c) => ({
    title: 'Steeper than the tested range',
    body:
      `Parts of this fire are on slopes over 20° (about ${int(100 * num(c, 'share'))} % of the fire edge). Fire models are tested on gentler ` +
      'ground, so spread here could be faster than shown.',
    safety: safetyLine('Treat steep-slope estimates as a minimum.'),
    factors: [f('Fire edge on slopes over 20°', `about ${int(100 * num(c, 'share'))} %`)],
    source: 'Cruz 2021; FireSim validity range (spec §6.12)',
    confidence: 'model-estimate',
    showLayers: ['slope'],
  }),
  'embers-exit': (c) => ({
    title: 'Embers beyond the map',
    body:
      `About ${int(100 * num(c, 'share'))} % of burning embers are carried past the edge of the model area, up to about ${short(num(c, 'dKm'))} km. ` +
      'The model only follows embers inside its map.',
    safety: safetyLine('Spot fires can start outside this map.'),
    factors: [f('Embers leaving the map', `about ${int(100 * num(c, 'share'))} %`)],
    source: 'FireSim ember model',
    confidence: 'model-estimate',
    showLayers: ['embers'],
  }),
  'wind-driven': (c) => ({
    title: 'Wind-driven fire',
    body:
      `The wind dominates this fire: it runs with the wind (about ${kmh(num(c, 'u10'))} km/h at the head) and its plume leans over. ` +
      'Most of its spread comes from the wind pushing the flames onto unburnt fuel.',
    safety: safetyLine('Watch the wind direction; the head follows it.'),
    factors: [f('Wind at the head', `about ${kmh(num(c, 'u10'))} km/h`), f('Convective number', `about ${short(num(c, 'nc'))}`)],
    source: 'Byram 1959; Nelson 1993',
    confidence: 'physics',
    showLayers: ['wind'],
  }),
  'light-wind': (c) => ({
    title: 'Light winds',
    body:
      `Winds at the head (about ${kmh(num(c, 'u10'))} km/h) are below the range the forest model was tested on, so spread here is less certain. ` +
      "In light winds the slope and the fire's own heat decide where it goes.",
    safety: safetyLine('Small wind shifts can change the head direction.'),
    factors: [f('Wind at the head', `about ${kmh(num(c, 'u10'))} km/h`)],
    source: 'Cruz 2021 (Vesta Mk2 data range)',
    confidence: 'model-estimate',
    showLayers: ['wind'],
  }),
  'narrow-gully': (c) => ({
    title: "What the model can't see",
    body:
      `This gully (about ${int(num(c, 'width'))} m across) is narrower than the wind model's grid (about ${int(num(c, 'gridM'))} m), ` +
      'so its channelled winds are only estimated. Wind squeezed into a narrow gully is often faster and gustier than the model shows.',
    safety: safetyLine('Expect local winds stronger than shown.'),
    factors: [f('Gully width', `about ${int(num(c, 'width'))} m`), f('Wind grid', `about ${int(num(c, 'gridM'))} m`)],
    source: 'FireSim atmosphere resolution',
    confidence: 'sub-grid',
    showLayers: ['trench', 'wind'],
  }),
  'mountain-wave': (c) => ({
    title: 'Strong gusts possible on lee slopes',
    body:
      'Wind crossing this range in a stable layer can plunge down the far side in strong, gusty bursts (a downslope windstorm), well ' +
      'beyond what the forecast wind suggests.' +
      (num(c, 'synthetic', 0) > 0 ? ' Upper-air data are synthetic for this date, so this is uncertain.' : ''),
    safety: safetyLine('Expect sudden strong winds on lee slopes and in the valleys below.'),
    factors: [
      ...(Number.isFinite(num(c, 'frH')) ? [f('Froude number', short(num(c, 'frH')))] : []),
      f('Ridges facing the wind', `about ${int(100 * num(c, 'cross'))} %`),
    ],
    source: 'Kepert 2016; Sharples 2009',
    confidence: num(c, 'synthetic', 0) > 0 ? 'model-estimate' : 'rule-of-thumb',
    showLayers: ['wind'],
  }),
  foehn: (c) => ({
    title: 'Hot dry wind off the range',
    body:
      'Air crossing the range sinks and warms on this side, so it arrives hotter and drier than the air it came from. ' +
      `Temperatures can jump and humidity drop quickly (wind over the range about ${kmh(num(c, 'uAloft'))} km/h from the ${compassWord(num(c, 'dirAloft'))}).`,
    safety: safetyLine('Expect the fire to become more active as the wind comes over the range.'),
    factors: [f('Wind above the range', `about ${kmh(num(c, 'uAloft'))} km/h from the ${compassWord(num(c, 'dirAloft'))}`)],
    source: 'Sharples 2009; Sharples & Ma 2026',
    confidence: 'rule-of-thumb',
    showLayers: ['wind'],
  }),
};

const general: Render = (c) => {
  const r = GENERAL[str(c, 'sub')];
  if (r) return r(c);
  return {
    title: 'Note',
    body: str(c, 'text', 'FireSim note.'),
    safety: safetyLine('Keep LACES in place.'),
    factors: [],
    source: 'FireSim',
    confidence: 'model-estimate',
    showLayers: [],
  };
};

/** The template of every InsightKind (spec §10.2). */
export const CARD_TEXT: Record<InsightKind, Render> = {
  'upslope-run': upslopeRun,
  'downslope-backing': downslopeBacking,
  'gully-chimney': gullyChimney,
  'eruptive-slope': eruptiveSlope,
  'ridge-crest': ridgeCrest,
  'lee-slope-eddy': leeSlopeEddy,
  'vorticity-lateral-spread': vls,
  'saddle-channelling': saddle,
  'valley-channelling': valley,
  'ridge-speed-up': ridgeSpeedUp,
  spotting,
  'spot-fire': spotFire,
  'mass-spotting': massSpotting,
  'junction-zone': junction,
  'wind-change': windChange,
  'dead-man-zone': deadManZone,
  'plume-dominated': plumeDominated,
  'pyroconvection-risk': pyroconvection,
  'fire-induced-wind': fireInducedWind,
  'anabatic-wind': anabatic,
  'katabatic-wind': katabatic,
  'thermal-belt': thermalBelt,
  'inversion-break': inversionBreak,
  'aspect-dry-fuel': aspectDryFuel,
  'moist-gully': moistGully,
  'heavy-fuel': heavyFuel,
  'recent-burn': recentBurn,
  'crown-fire': crownFire,
  'high-drought': highDrought,
  'night-slowdown': nightSlowdown,
  'afternoon-peak': afternoonPeak,
  'fuel-break-breached': fuelBreakBreached,
  'rolling-debris': rollingDebris,
  general,
};

/** Sub-note ids of the `general` kind. */
export const GENERAL_SUBS = Object.keys(GENERAL);
