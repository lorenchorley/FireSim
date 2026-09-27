/**
 * Insight text library (spec §10.1–§10.2): every card and variant renders a title, a 2–4 sentence plain-language
 * body (the §10.1 steep / sub-grid notes may add one), one safety line ending with the doctrine line, a source, a
 * confidence badge, "Show me" layers from the §10.2 mapping, and triggering factors; never "you are safe"; no
 * NaN/undefined leaks; formatting helpers (km/h, about, compass words, clock in the NSW time zone).
 */
import { describe, expect, it } from 'vitest';
import type { InsightKind } from '../core/types';
import { INSIGHT_KINDS } from './registry';
import { CARD_TEXT, DOCTRINE, GENERAL_SUBS, STEEP_NOTE, SUBGRID_NOTE, clock, compassWord, duration, kataburn, km, rate, slopeFactorText, times, windName, type Candidate } from './text';

/** Representative values for every template field. */
const V: Record<string, number | string> = {
  theta: 25, ros: 0.08, subgrid: 0.4, wall: 22, windDown: 9, moisture: 6, axial: 27, baseDist: 120, attach: 0.6, A: 0.7, G: 1.8,
  uRidge: 7, dist: 800, sep: 0.7, slope: 26, vls: 0.8, rl: 2.1, floorDir: 20, floorSpeed: 3, ridgeDir: 300, diff: 80, relief: 400,
  speedUp: 0.4, uCrest: 9, S: 2400, d: 1300, u10: 9, bark: 3.5, travel: 850, flightTime: 70, height: 400,
  src: 'a burning ribbon of bark on the ridge', count: 14, factor: 3.9, alpha: 30, gap: 220, fromDir: 315, toDir: 225, shift: 90,
  postSpeed: 12, clock: '4:00 pm', inS: 2400, flankM: 1800, areaHa: 35, nc: 14, lengthM: 300, cHaines: 11.2, ffdi: 64,
  plumeAboveLcl: 900, fw: 3, share: 0.4, upslope: 1.6, qh: 320, downslope: 1.2, turn: 120, floorMoisture: 14, hav: 90, dTheta: 5.2,
  wet: 1, aspect: 350, opposite: 11, dM: 3, wind: 8, kbdi: 170, fa: 0.9, frontMoisture: 7, flameHeight: 12, years: 2, pct: 35,
  extreme: 1, intensity: 12000, df: 9.5, ratio: 0.3, rise: 5, belt: 1, ma: 4, dir: 300, t: 38, rh: 12, fbi: 60, width: 12, p: 0.4,
  drop: 60, dKm: 12, gridM: 200, frH: 0.9, cross: 0.5, synthetic: 1, dirAloft: 300, uAloft: 20,
};
const VARIANTS: Partial<Record<InsightKind, string[]>> = {
  'downslope-backing': ['', 'S43', 'S10'],
  'gully-chimney': ['wind', 'anabatic'],
  'vorticity-lateral-spread': ['', 'pre'],
  spotting: ['', 'bark'],
  'wind-change': ['', 'noflank'],
  'pyroconvection-risk': ['ch', 'plume', 'synthetic'],
  'katabatic-wind': ['', 'S17'],
  'thermal-belt': ['', 'ridge'],
  'inversion-break': ['', 'now', 'smoke'],
  'aspect-dry-fuel': ['', 'S38'],
  'moist-gully': ['', 'drought'],
  'afternoon-peak': ['', 'S13'],
  'fuel-break-breached': ['', 'spot'],
  general: GENERAL_SUBS,
};
/** §10.2 "Show me" mapping keys. */
const LAYERS = new Set(['slope', 'spread', 'sun', 'moisture', 'fuel', 'history', 'intensity', 'wind', 'plume', 'temperature', 'smoke', 'embers', 'trench', 'attach', 'vls', 'dmz', 'debris']);
const sentences = (s: string): number => s.split(/(?<=[.!?])\s+(?=[A-Z("])/).length;

const cases: [InsightKind, string][] = INSIGHT_KINDS.flatMap((k) => (VARIANTS[k] ?? ['']).map((v) => [k, v] as [InsightKind, string]));

describe('card templates', () => {
  it.each(cases)('%s / %s', (kind, variant) => {
    const values = { ...V, variant, sub: variant, ...(variant === 'noflank' ? { flankM: 0 } : {}) };
    const c: Candidate = { key: 'k', x: 0, y: 0, score: 1, severity: 'info', values };
    const t = CARD_TEXT[kind](c);
    expect(t.title.length).toBeGreaterThan(3);
    expect(t.title.length).toBeLessThanOrEqual(60);
    const n = sentences(t.body);
    const notes = t.body.includes(SUBGRID_NOTE) ? 1 : 0; // the steep note is a parenthesis inside a sentence
    expect(n).toBeGreaterThanOrEqual(2);
    expect(n).toBeLessThanOrEqual(4 + notes);
    expect(t.safety!.endsWith(DOCTRINE)).toBe(true);
    expect(t.safety!.split(DOCTRINE)[0]!.trim().length).toBeGreaterThan(10);
    for (const s of [t.title, t.body, t.safety!]) {
      expect(s).not.toMatch(/you are safe|you're safe|you will be safe/i);
      expect(s).not.toMatch(/NaN|undefined|null|\[object|\?/);
    }
    expect(t.source!.length).toBeGreaterThan(3);
    expect(['physics', 'rule-of-thumb', 'model-estimate', 'sub-grid']).toContain(t.confidence);
    expect(t.showLayers!.length).toBeGreaterThan(0);
    for (const l of t.showLayers!) expect(LAYERS.has(l)).toBe(true);
    expect(t.factors.length).toBeGreaterThan(0);
    for (const f of t.factors) {
      expect(f.label.length).toBeGreaterThan(0);
      expect(f.value).not.toMatch(/NaN|undefined|\?/);
    }
  });

  it('spec §10.2 badges and "Show me" layers of the table', () => {
    const r = (k: InsightKind, v = '') => CARD_TEXT[k]({ key: 'k', x: 0, y: 0, score: 1, severity: 'info', values: { ...V, variant: v, sub: v } });
    expect(r('upslope-run')).toMatchObject({ confidence: 'physics', showLayers: ['slope', 'spread'] });
    expect(r('gully-chimney')).toMatchObject({ confidence: 'rule-of-thumb', showLayers: ['slope', 'trench'] });
    expect(r('eruptive-slope')).toMatchObject({ confidence: 'model-estimate', showLayers: ['slope', 'attach'] });
    expect(r('lee-slope-eddy')).toMatchObject({ confidence: 'sub-grid', showLayers: ['wind'] });
    expect(r('vorticity-lateral-spread')).toMatchObject({ confidence: 'sub-grid', showLayers: ['vls', 'wind'] });
    expect(r('wind-change')).toMatchObject({ confidence: 'rule-of-thumb', showLayers: ['wind', 'dmz'] });
    expect(r('plume-dominated')).toMatchObject({ confidence: 'physics', showLayers: ['plume'] });
    expect(r('inversion-break')).toMatchObject({ confidence: 'physics', showLayers: ['temperature', 'smoke'] });
    expect(r('recent-burn')).toMatchObject({ confidence: 'physics', showLayers: ['fuel', 'history'] });
    expect(r('crown-fire')).toMatchObject({ confidence: 'rule-of-thumb', showLayers: ['intensity'] });
    expect(r('rolling-debris')).toMatchObject({ confidence: 'rule-of-thumb', showLayers: ['debris'] });
    expect(r('general', 'narrow-gully').confidence).toBe('sub-grid');
    expect(r('general', 'steep').confidence).toBe('model-estimate');
    expect(r('general', 'wind-driven').confidence).toBe('physics');
  });

  it('§10.1 notes: steep note only above 20°, sub-grid note only above 30 %', () => {
    const body = (theta: number, subgrid: number) => CARD_TEXT['upslope-run']({ key: 'k', x: 0, y: 0, score: 1, severity: 'info', values: { theta, ros: 0.1, subgrid } }).body;
    expect(body(25, 0)).toContain(STEEP_NOTE);
    expect(body(20, 0)).not.toContain(STEEP_NOTE);
    expect(body(15, 0.31)).toContain(SUBGRID_NOTE);
    expect(body(15, 0.3)).not.toContain(SUBGRID_NOTE);
    expect(body(15, 0)).toContain('about ×2.8 faster');
    expect(body(25, 0)).toContain('at least ×5.7 faster');
  });

  it('templates carry the spec wording', () => {
    const r = (k: InsightKind, v: Record<string, number | string> = {}) => CARD_TEXT[k]({ key: 'k', x: 0, y: 0, score: 1, severity: 'danger', values: { ...V, ...v } });
    expect(r('junction-zone', { factor: 1 / Math.sin((15 * Math.PI) / 180) }).body).toContain('about ×3.9 faster by geometry alone');
    expect(r('recent-burn').body).toContain('It burned 2 years ago; litter is about 35 % of its long-unburnt amount');
    expect(r('heavy-fuel').safety).toContain('clear ground ≥ 4 × flame height (about 48 m)');
    expect(r('spot-fire').body).toBe(
      'An ember from a burning ribbon of bark on the ridge flew 850 m (70 s, up to 400 m high) and landed on 6 % litter. It has started a new fire about 800 m from the main front.',
    );
    expect(r('fuel-break-breached').body).toContain('A 12 m break at 12000 kW/m has about a 40 % chance of being crossed (Wilson).');
    expect(r('high-drought').body).toContain('Drought factor 9.5: nearly all fine fuel is available');
    expect(r('downslope-backing', { theta: -20, ros: 0.02 }).body).toContain('about 72 m/h, about 57 % of its flat-ground speed');
  });
});

describe('formatting helpers', () => {
  it('slope factor, Kataburn, multipliers, km, rates, durations', () => {
    expect(slopeFactorText(20)).toBeCloseTo(4, 12);
    expect(slopeFactorText(50)).toBe(16);
    expect(slopeFactorText(-10)).toBe(1);
    expect(kataburn(-20)).toBeCloseTo(0.5714, 4); // V1: down/flat 0.571
    expect(kataburn(-60)).toBeGreaterThan(0.5);
    expect(times(3.94)).toBe('×3.9');
    expect(times(12.4)).toBe('×12');
    expect(km(1840)).toBe('1.8');
    expect(km(23400)).toBe('23');
    expect(rate(0.05)).toBe('about 180 m/h');
    expect(rate(0.7)).toBe('about 2.5 km/h');
    expect(duration(45 * 60)).toBe('about 45 min');
    expect(duration(130 * 60)).toBe('about 2 h 10 min');
  });
  it('compass words and wind names (FROM), NaN-safe', () => {
    expect(compassWord(0)).toBe('north');
    expect(compassWord(224)).toBe('south-west');
    expect(compassWord(359)).toBe('north');
    expect(compassWord(NaN)).toBe('');
    expect(windName(315)).toBe('north-westerly');
    expect(windName(NaN)).toBe('variable');
  });
  it('clock in the NSW time zone, DST-aware', () => {
    expect(clock(Date.UTC(2025, 11, 20, 5, 0))).toBe('4:00 pm'); // AEDT (UTC+11)
    expect(clock(Date.UTC(2025, 5, 20, 5, 30))).toBe('3:30 pm'); // AEST (UTC+10)
    expect(clock(NaN)).toBe('an unknown time');
  });
});
