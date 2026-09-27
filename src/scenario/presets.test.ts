/**
 * Weather presets (spec §11.3, D46; §14 "preset chips (4)" and the preset upper-air vector): chips (FFDI, AFDRS-parity
 * FBI at z_s for dry shrubby forest on the canonical date), the diurnal shape, the change, the non-superadiabatic
 * upper air and series consistency.
 */
import { describe, expect, it } from 'vitest';
import { FuelType } from '../core/types';
import { lmstHour, rhFromTd } from '../core/physics';
import { angleDiffDeg } from '../core/units';
import { afdrsFbi, ffdi } from '../fire/models';
import { cHaines } from '../atmosphere/plume';
import { WEATHER_PRESETS as UI_PRESETS } from '../ui/content';
import { changeBlend, PRESET_IDS, presetDiurnal, presetUpperAir, WEATHER_PRESETS } from './presets';
import { weatherAt } from './weather';
import { lmstToUtc } from './time';

const LON = 150.285;
const SITE = { location: { lat: -33.715, lon: LON }, sourceElevation: 745 };
const H = 3.6e6;
const at = (date: string, lmst: number): number => lmstToUtc(date, lmst, LON);

describe('diurnal shape D(h) (§11.3)', () => {
  it('0 at 06:00, 1 at 15:00, continuous at both joins, monotone day and night', () => {
    expect(presetDiurnal(6)).toBeCloseTo(0, 12);
    expect(presetDiurnal(15)).toBeCloseTo(1, 12);
    expect(presetDiurnal(15 + 1e-9)).toBeCloseTo(1, 6);
    expect(presetDiurnal(6 - 1e-9)).toBeCloseTo(0, 6);
    expect(presetDiurnal(21)).toBeCloseTo(0.5 + 0.5 * Math.cos((Math.PI * 6) / 15), 12);
    for (let h = 6; h < 15; h += 0.5) expect(presetDiurnal(h + 0.5)).toBeGreaterThan(presetDiurnal(h));
    for (let h = 15; h < 29.5; h += 0.5) expect(presetDiurnal(h + 0.5)).toBeLessThan(presetDiurnal(h));
  });
});

describe('change blend', () => {
  const tc = 1e12;
  it('exactly 0 at t_c − 30 min and 1 at t_c + 30 min, 0.5 at t_c, 10–90 % in ≈ 31–33 min', () => {
    expect(changeBlend(tc - 30 * 60e3, tc)).toBe(0);
    expect(changeBlend(tc + 30 * 60e3, tc)).toBe(1);
    expect(changeBlend(tc, tc)).toBeCloseTo(0.5, 12);
    let t10 = 0;
    let t90 = 0;
    for (let s = -1800; s <= 1800; s++) {
      const f = changeBlend(tc + s * 1000, tc);
      if (!t10 && f >= 0.1) t10 = s;
      if (!t90 && f >= 0.9) t90 = s;
    }
    const min = (t90 - t10) / 60;
    expect(min).toBeGreaterThan(30);
    expect(min).toBeLessThan(33.5);
  });
});

describe('preset chips (§11.3, §14): FFDI and AFDRS-parity FBI at z_s on the canonical date', () => {
  it('the UI chips (ui/content.ts) match the preset chip ratings and start hours', () => {
    for (const p of UI_PRESETS) {
      const s = WEATHER_PRESETS[p.id as keyof typeof WEATHER_PRESETS];
      expect(s, p.id).toBeDefined();
      expect(p.rating).toBe(s.chip.rating);
      expect(p.startHour).toBe(s.canonical.startLmst);
    }
    expect(PRESET_IDS).toEqual(UI_PRESETS.map((p) => p.id));
  });

  it.each([
    ['hot-nw-sw-change', '2026-12-20', 14.5, { T: 35.9, U: 10.96, ffdi: 62.6, fbi: 75, rating: 'Extreme' }],
    ['calm-night-katabatic', '2026-03-15', 21, { T: 18.5, U: 1.83, fbi: 6, rating: 'No rating' }],
    ['mild-spring-hr', '2026-10-15', 15, { T: 20, U: 4.5, RH: 45, ffdi: 6.0, fbi: 16, rating: 'Moderate' }],
    ['catastrophic-black-summer', '2026-12-30', 15, { T: 42, U: 15, ffdi: 147, fbi: 109, rating: 'Catastrophic' }],
  ] as const)('%s', (id, date, lmst, want) => {
    const p = WEATHER_PRESETS[id];
    const start = p.canonicalStart(LON, 2026);
    expect(lmstHour(start, LON)).toBeCloseTo(p.canonical.startLmst, 6);
    const s = p.build(start, 8, SITE);
    const t = at(date, lmst);
    const w = weatherAt(s, t);
    expect(w.temperature).toBeCloseTo(want.T, 1);
    expect(w.windSpeed10).toBeCloseTo(want.U, 2);
    if ('RH' in want) expect(w.relativeHumidity).toBeCloseTo(want.RH, 0);
    const df = s.droughtFactor!;
    const kbdi = s.kbdi!;
    expect([df, kbdi]).toEqual([p.df, p.kbdi]);
    if ('ffdi' in want) expect(ffdi(w.temperature, w.relativeHumidity, 3.6 * w.windSpeed10, df)).toBeCloseTo(want.ffdi, want.ffdi > 100 ? 0 : 1);
    const r = afdrsFbi(FuelType.DryForestShrubby, w, LON, df, kbdi);
    expect(r.fbi).toBe(want.fbi);
    expect(r.rating).toBe(want.rating);
    expect(p.chip.fbi).toBe(want.fbi);
  });

  it('mild-spring 15:00: M_A 7.96, ROS 272 m/h, I 1889 kW/m (spec chip detail)', () => {
    const p = WEATHER_PRESETS['mild-spring-hr'];
    const s = p.build(p.canonicalStart(LON, 2026), 8, SITE);
    const r = afdrsFbi(FuelType.DryForestShrubby, weatherAt(s, at('2026-10-15', 15)), LON, 8, 60);
    expect(r.moisture).toBeCloseTo(7.96, 2);
    expect(Math.abs(r.ros - 272)).toBeLessThanOrEqual(1);
    // fire/models gives 1890.6 kW/m; the spec's 1889 was printed from the rounded chain (ROS 272, M_A 7.96).
    expect(Math.abs(r.intensity - 1889)).toBeLessThanOrEqual(2);
  });
});

describe('preset upper air (D46)', () => {
  const hot = WEATHER_PRESETS['hot-nw-sw-change'];
  it('§14 vector at z_s = 800 m, hot-nw: T850 29.1 °C, T700 15.1 °C, C-Haines 12.0 (CA 5.0, CB 7.0)', () => {
    const lv = presetUpperAir(hot, 800, 11, 310);
    const l850 = lv.find((l) => l.hPa === 850)!;
    const l700 = lv.find((l) => l.hPa === 700)!;
    expect(l850.temperature).toBeCloseTo(29.1, 1);
    expect(l700.temperature).toBeCloseTo(15.1, 1);
    const ch = cHaines(l850.temperature, l700.temperature, l850.dewPoint!);
    expect(ch.ca).toBeCloseTo(5.0, 1);
    expect(ch.cb).toBeCloseTo(7.0, 1);
    expect(ch.ch).toBeCloseTo(12.0, 1);
  });
  it('at z_s = 0 the table air mass is used (C-Haines 11.7); winds 1.3/1.6/2.0 × the day wind', () => {
    const lv = presetUpperAir(hot, 0, 11, 310);
    const [a, b, c] = lv;
    expect(a!.temperature).toBe(22);
    expect(b!.temperature).toBe(8);
    expect(c!.temperature).toBe(-12);
    expect(cHaines(a!.temperature, b!.temperature, a!.dewPoint!).ch).toBeCloseTo(11.7, 1);
    expect(lv.map((l) => l.windSpeed)).toEqual([1.3 * 11, 1.6 * 11, 2.0 * 11].map((x) => expect.closeTo(x, 9)));
    expect(lv.every((l) => l.windDir === 310)).toBe(true);
    expect(a!.relativeHumidity).toBeCloseTo(rhFromTd(22, -6), 9);
    expect(b!.relativeHumidity).toBe(15);
    expect(c!.relativeHumidity).toBe(20);
  });
  it.each([
    ['hot-nw-sw-change', 11.7],
    ['calm-night-katabatic', 6.0],
    ['mild-spring-hr', 4.7],
    ['catastrophic-black-summer', 13.0],
  ] as const)('§11.3 table C-Haines at z_s = 0: %s → %f', (id, want) => {
    const p = WEATHER_PRESETS[id];
    const lv = presetUpperAir(p, 0, p.wind.day, p.wind.dir);
    const [l850, l700] = lv;
    expect(l850!.temperature).toBe(p.upper.t850);
    expect(cHaines(l850!.temperature, l700!.temperature, l850!.dewPoint!).ch).toBeCloseTo(want, 1);
  });
  it('never superadiabatic above z_s (every preset, z_s 0–1400 m); 850 hPa dropped at z_s ≥ 1500 m', () => {
    for (const id of PRESET_IDS) {
      const p = WEATHER_PRESETS[id];
      for (const zs of [0, 400, 800, 1200, 1400]) {
        const lv = presetUpperAir(p, zs, p.wind.day, p.wind.dir);
        const l850 = lv.find((l) => l.hPa === 850)!;
        // Lapse from the surface (T_max at z_s) to 850 hPa ≤ 9.8 K/km, and aloft stable.
        expect((p.tMax - l850.temperature) / ((1500 - zs) / 1000)).toBeLessThanOrEqual(9.8 + 1e-9);
        // Aloft the table's own 850–700 difference is kept (catastrophic: 16 K over 1.6 km = 10 K/km, as the spec's
        // formula T700 = T850 − (T850_tab − T700_tab) prescribes) and 700–500 is 20 K over 2.7 km.
        const l700 = lv.find((l) => l.hPa === 700)!;
        const l500 = lv.find((l) => l.hPa === 500)!;
        expect(l850.temperature - l700.temperature).toBeCloseTo(p.upper.t850 - p.upper.t700, 9);
        expect(l700.temperature - l500.temperature).toBeCloseTo(20, 9);
        for (const l of lv) {
          expect(l.dewPoint!).toBeLessThanOrEqual(l.temperature + 1e-9);
          expect(l.relativeHumidity).toBeGreaterThan(0);
          expect(l.relativeHumidity).toBeLessThanOrEqual(100);
        }
      }
      const high = presetUpperAir(p, 1600, p.wind.day, p.wind.dir);
      expect(high.map((l) => l.hPa)).toEqual([700, 500]);
    }
  });
});

describe('series consistency', () => {
  it.each(PRESET_IDS)('%s: sorted unique stamps, RH ≤ 100, gust ≥ wind, spin-up before start, preset upper air at z_s', (id) => {
    const p = WEATHER_PRESETS[id];
    const start = p.canonicalStart(LON, 2026);
    const s = p.build(start, 6, SITE);
    expect(s.kind).toBe('preset');
    expect(s.sourceElevation).toBe(745);
    expect(s.upperAirSource).toBe('preset');
    expect(s.hours[0]!.time).toBeLessThanOrEqual(start - 72 * H);
    expect(s.hours[s.hours.length - 1]!.time).toBeGreaterThanOrEqual(start + 6 * H);
    for (let i = 0; i < s.hours.length; i++) {
      const h = s.hours[i]!;
      if (i) expect(h.time).toBeGreaterThan(s.hours[i - 1]!.time);
      expect(h.relativeHumidity).toBeLessThanOrEqual(100);
      expect(h.dewPoint!).toBeLessThanOrEqual(h.temperature + 1e-9);
      expect(h.windGust10!).toBeGreaterThanOrEqual(h.windSpeed10);
      expect(h.cloudCover).toBe(p.cloud);
      expect(h.precipitation).toBe(0);
      expect(h.shortwaveRadiation).toBeUndefined();
      expect(h.pressureLevels!.length).toBe(3);
    }
    expect(s.rainLast20).toEqual(new Array(20).fill(0));
    if (id === 'calm-night-katabatic') expect(s.nightTemplate).toEqual({ dThetaMax: 6, hInv: 150 });
    else expect(s.nightTemplate).toBeUndefined();
  });

  it('hot-nw change: 10-min stamps in [t_c − 1 h, t_c + 2 h]; SW 12 m/s then 9 m/s; 8 K cooler and T_d 10 after 2 h', () => {
    const p = WEATHER_PRESETS['hot-nw-sw-change'];
    const s = p.build(p.canonicalStart(LON, 2026), 8, SITE);
    const tc = at('2026-12-20', 15);
    const win = s.hours.filter((h) => h.time >= tc - H - 1 && h.time <= tc + 2 * H + 1);
    expect(win).toHaveLength(19);
    for (let i = 1; i < win.length; i++) expect(win[i]!.time - win[i - 1]!.time).toBe(600_000);
    const pre = weatherAt(s, tc - 31 * 60e3);
    expect(Math.abs(angleDiffDeg(pre.windDir10, 310))).toBeLessThan(1e-6);
    const w40 = weatherAt(s, tc + 40 * 60e3);
    expect(Math.abs(angleDiffDeg(w40.windDir10, 230))).toBeLessThan(0.5);
    expect(w40.windSpeed10).toBeCloseTo(12, 1);
    expect(w40.windGust10! / w40.windSpeed10).toBeCloseTo(1.8, 2);
    const w2 = weatherAt(s, tc + 2 * H);
    expect(w2.windSpeed10).toBeCloseTo(9, 6);
    expect(w2.dewPoint).toBeCloseTo(10, 6);
    // Diurnal T at 17:00 minus ΔT.
    expect(w2.temperature).toBeCloseTo(22 + 14 * presetDiurnal(17) - 8, 6);
    // Direction never goes the long way round (310 → 230 through 270).
    for (const h of win) expect(angleDiffDeg(h.windDir10, 270)).toBeLessThanOrEqual(40 + 1e-6);
  });

  it('a preset started on another date keeps its weather (same LMST hour, same values)', () => {
    const p = WEATHER_PRESETS['mild-spring-hr'];
    const a = weatherAt(p.build(p.canonicalStart(LON, 2026), 6, SITE), at('2026-10-15', 13));
    const b = weatherAt(p.build(lmstToUtc('2026-09-01', 10, LON), 6, SITE), at('2026-09-01', 13));
    expect(b.temperature).toBeCloseTo(a.temperature, 9);
    expect(b.windSpeed10).toBeCloseTo(a.windSpeed10, 9);
  });
});
