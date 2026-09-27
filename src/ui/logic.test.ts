import { describe, expect, it } from 'vitest';
import type { SimSnapshot, WeatherHour } from '../core/types';
import { kmhToMs } from '../core/units';
import {
  beaufortFromKmh,
  beaufortRepresentativeKmh,
  BEAUFORT,
  deadFuelMoisture,
  detectWindChanges,
  dewPoint,
  ffdi,
  moisturePeriod,
  plumeRegime,
  pressureAtElevation,
  ratingFromIndex,
  ratingStyle,
  relativeHumidityFromWetBulb,
} from './weatherCalc';
import {
  formatArea,
  formatClock,
  formatDayClock,
  formatDirFrom,
  formatDistance,
  formatDuration,
  formatElapsed,
  formatElapsedShort,
  formatIntensity,
  formatLatLon,
  formatMultiplier,
  formatPlaybackSpeed,
  formatRelative,
  formatRos,
  formatWind,
  formatYears,
  localHour,
} from './format';
import { SnapshotStore } from './snapshotStore';
import { isInNsw, parseLatLon } from './nsw';
import { circlePolygon, polygonArea, pointInRing, simplifyPolyline, strokeToPolygon, thinPath, traceOuterBoundary } from './brushGeometry';
import { manualSeries, weatherAt } from './weatherSeries';

// ───────────────────────────── belt weather kit ─────────────────────────────

describe('belt-kit psychrometry', () => {
  it('matches sling-psychrometer tables at sea level', () => {
    // 30 °C dry / 20 °C wet → ≈ 39–40 % (WMO ventilated psychrometer, 1013 hPa).
    expect(relativeHumidityFromWetBulb(30, 20)).toBeCloseTo(39.3, 0);
    // 25 / 25 → saturated.
    expect(relativeHumidityFromWetBulb(25, 25)).toBeCloseTo(100, 5);
    // 35 / 18 → very dry afternoon, ≈ 18 %.
    const rh = relativeHumidityFromWetBulb(35, 18);
    expect(rh).toBeGreaterThan(15);
    expect(rh).toBeLessThan(21);
  });

  it('accounts for the lower pressure on mountain sites', () => {
    const p = pressureAtElevation(1000);
    expect(p).toBeGreaterThan(895);
    expect(p).toBeLessThan(905);
    // Lower pressure → smaller psychrometer correction → higher RH for the same depression.
    expect(relativeHumidityFromWetBulb(30, 20, p)).toBeGreaterThan(relativeHumidityFromWetBulb(30, 20, 1013.25));
  });

  it('rejects a wet bulb warmer than the dry bulb and clamps at 0', () => {
    expect(Number.isNaN(relativeHumidityFromWetBulb(20, 22))).toBe(true);
    expect(relativeHumidityFromWetBulb(45, 5)).toBe(0);
  });

  it('dew point is consistent with RH', () => {
    expect(dewPoint(20, 100)).toBeCloseTo(20, 1);
    expect(dewPoint(30, 39.3)).toBeCloseTo(14.6, 0);
  });
});

describe('Beaufort helper', () => {
  it('maps km/h to forces at the band edges', () => {
    expect(beaufortFromKmh(0).force).toBe(0);
    expect(beaufortFromKmh(0.5).force).toBe(0);
    expect(beaufortFromKmh(1).force).toBe(1);
    expect(beaufortFromKmh(11.9).force).toBe(2);
    expect(beaufortFromKmh(12).force).toBe(3);
    expect(beaufortFromKmh(28).force).toBe(4);
    expect(beaufortFromKmh(29).force).toBe(5);
    expect(beaufortFromKmh(49).force).toBe(6);
    expect(beaufortFromKmh(61.5).force).toBe(7);
    expect(beaufortFromKmh(117).force).toBe(11);
    expect(beaufortFromKmh(200).force).toBe(12);
    expect(beaufortFromKmh(Number.NaN).force).toBe(0);
  });

  it('representative speeds fall inside their own band', () => {
    for (const b of BEAUFORT) {
      const v = beaufortRepresentativeKmh(b.force);
      expect(beaufortFromKmh(v).force).toBe(b.force);
    }
  });
});

describe('fire danger', () => {
  it('computes McArthur FFDI', () => {
    // Worked value: T 35, RH 10, V 40, DF 10 → ≈ 69 (published calculators).
    expect(ffdi(35, 10, 40, 10)).toBeGreaterThan(60);
    expect(ffdi(35, 10, 40, 10)).toBeLessThan(80);
    // Mild day
    expect(ffdi(20, 50, 10, 5)).toBeLessThan(5);
  });

  it('labels ratings with AFDRS thresholds', () => {
    expect(ratingFromIndex(5).key).toBe('none');
    expect(ratingFromIndex(12).key).toBe('moderate');
    expect(ratingFromIndex(24).key).toBe('high');
    expect(ratingFromIndex(50).key).toBe('extreme');
    expect(ratingFromIndex(100).key).toBe('catastrophic');
    expect(ratingStyle('Very High').key).toBe('high');
    expect(ratingStyle('CATASTROPHIC').key).toBe('catastrophic');
    expect(ratingStyle('Severe').key).toBe('extreme');
    expect(ratingStyle('').key).toBe('none');
  });

  it('dead fuel moisture follows Matthews (2010)', () => {
    // Doc 10 worked examples (sunny afternoon): RH 15 T 38 → 3.9 %; RH 30 T 30 → 5.9 %.
    expect(deadFuelMoisture(38, 15, 'sunny-afternoon')).toBeCloseTo(3.9, 1);
    expect(deadFuelMoisture(30, 30, 'sunny-afternoon')).toBeCloseTo(5.9, 1);
    expect(deadFuelMoisture(15, 80, 'night')).toBeGreaterThan(deadFuelMoisture(15, 80, 'day'));
    expect(moisturePeriod(14)).toBe('sunny-afternoon');
    expect(moisturePeriod(14, 90)).toBe('day');
    expect(moisturePeriod(22)).toBe('night');
  });

  it('classifies plume regimes', () => {
    expect(plumeRegime(1)).toBe('wind-driven');
    expect(plumeRegime(5)).toBe('mixed');
    expect(plumeRegime(21)).toBe('plume-dominated');
  });
});

describe('wind change detection', () => {
  const H = 3600_000;
  const hour = (i: number, dir: number, kmh: number): WeatherHour => ({
    time: i * H,
    temperature: 30,
    relativeHumidity: 20,
    windSpeed10: kmhToMs(kmh),
    windDir10: dir,
  });

  it('finds a NW → SW change once', () => {
    const hs = [hour(0, 315, 35), hour(1, 315, 40), hour(2, 300, 40), hour(3, 225, 35), hour(4, 220, 30), hour(5, 215, 25)];
    const ch = detectWindChanges(hs);
    expect(ch).toHaveLength(1);
    expect(ch[0]!.time).toBe(3 * H);
    expect(ch[0]!.turn).toBeLessThan(0); // backing (anticlockwise)
    expect(Math.round(ch[0]!.speedAfterKmh)).toBe(35);
  });

  it('ignores light variable winds and slow veers', () => {
    const calm = [hour(0, 0, 3), hour(1, 180, 4), hour(2, 90, 5)];
    expect(detectWindChanges(calm)).toHaveLength(0);
    const slow = Array.from({ length: 10 }, (_, i) => hour(i, 270 + i * 10, 25));
    expect(detectWindChanges(slow)).toHaveLength(0);
  });
});

// ───────────────────────────── formatters ─────────────────────────────

describe('formatters', () => {
  // 2026-01-10T03:35:00Z = 14:35 AEDT (UTC+11).
  const t = Date.UTC(2026, 0, 10, 3, 35);

  it('formats local clock times in Australia/Sydney', () => {
    expect(formatClock(t)).toBe('14:35');
    expect(formatDayClock(t)).toBe('Sat 14:35');
    expect(localHour(t)).toBeCloseTo(14 + 35 / 60, 5);
  });

  it('formats durations', () => {
    expect(formatDuration(0)).toBe('0 min');
    expect(formatDuration(45 * 60)).toBe('45 min');
    expect(formatDuration(2 * 3600 + 35 * 60)).toBe('2 h 35 min');
    expect(formatDuration(12 * 3600)).toBe('12 h');
    expect(formatElapsed(3600)).toBe('+1 h');
    expect(formatElapsedShort(9300)).toBe('+2:35');
    expect(formatRelative(1800)).toBe('in 30 min');
    expect(formatRelative(-600)).toBe('10 min ago');
    expect(formatRelative(20)).toBe('now');
  });

  it('formats speeds', () => {
    expect(formatWind(10)).toBe('36 km/h');
    expect(formatWind(10, 'ms')).toBe('10 m/s');
    expect(formatWind(2.54, 'ms')).toBe('2.5 m/s');
    expect(formatRos(0)).toBe('0 m/h');
    expect(formatRos(0.01)).toBe('36 m/h');
    expect(formatRos(0.125)).toBe('450 m/h');
    expect(formatRos(0.5)).toBe('1.8 km/h');
    expect(formatPlaybackSpeed(60)).toBe('60×');
    expect(formatPlaybackSpeed(Infinity)).toBe('Max');
  });

  it('formats fire quantities', () => {
    expect(formatIntensity(4321)).toBe('4,300 kW/m');
    expect(formatIntensity(12_345)).toBe('12,000 kW/m');
    expect(formatIntensity(3)).toBe('< 10 kW/m');
    expect(formatArea(0.05)).toBe('< 0.1 ha');
    expect(formatArea(3.44)).toBe('3.4 ha');
    expect(formatArea(1250)).toBe('1,250 ha');
    expect(formatDistance(452)).toBe('450 m');
    expect(formatDistance(1234)).toBe('1.2 km');
    expect(formatMultiplier(2.44)).toBe('×2.4');
    expect(formatMultiplier(0.553)).toBe('×0.55');
    expect(formatMultiplier(1)).toBe('×1');
    expect(formatYears(Number.NaN)).toBe('No record');
    expect(formatYears(1.2)).toBe('1 year');
    expect(formatYears(45)).toBe('30+ years');
  });

  it('formats directions and coordinates', () => {
    expect(formatDirFrom(315)).toBe('NW (315°)');
    expect(formatDirFrom(-45)).toBe('NW (315°)');
    expect(formatDirFrom(359.8)).toBe('N (0°)');
    expect(formatLatLon(-33.715, 150.285)).toBe('33.7150° S, 150.2850° E');
  });
});

// ───────────────────────────── snapshot store ─────────────────────────────

function snap(time: number, bytes = 1000): SimSnapshot {
  return { time, __bytes: bytes } as unknown as SimSnapshot;
}
const sizeOf = (s: SimSnapshot): number => (s as unknown as { __bytes: number }).__bytes;

describe('SnapshotStore', () => {
  it('keeps one snapshot per interval plus the head', () => {
    const st = new SnapshotStore({ minInterval: 300, sizeOf });
    for (let t = 0; t <= 900; t += 60) st.push(snap(t));
    expect(st.times()).toEqual([0, 300, 600, 900]);
    st.push(snap(960));
    expect(st.times()).toEqual([0, 300, 600, 900, 960]);
    st.push(snap(1020));
    expect(st.times()).toEqual([0, 300, 600, 900, 1020]);
  });

  it('finds the snapshot at or before a time', () => {
    const st = new SnapshotStore({ minInterval: 300, sizeOf });
    for (const t of [0, 300, 600, 900]) st.push(snap(t));
    expect(st.atOrBefore(-5)!.time).toBe(0);
    expect(st.atOrBefore(299)!.time).toBe(0);
    expect(st.atOrBefore(300)!.time).toBe(300);
    expect(st.atOrBefore(1e9)!.time).toBe(900);
    expect(st.nearest(820)!.time).toBe(900);
    expect(st.range()).toEqual({ start: 0, end: 900 });
  });

  it('invalidates later snapshots on re-simulation and truncation', () => {
    const st = new SnapshotStore({ minInterval: 300, sizeOf });
    for (const t of [0, 300, 600, 900, 1200]) st.push(snap(t));
    st.push(snap(600)); // worker rewound to 600 and re-emitted
    expect(st.times()).toEqual([0, 300, 600]);
    st.truncateAfter(300);
    expect(st.times()).toEqual([0, 300]);
    expect(st.totalBytes).toBe(2000);
  });

  it('ring mode drops the oldest when over budget', () => {
    const st = new SnapshotStore({ minInterval: 300, sizeOf, maxBytes: 3500, mode: 'ring' });
    for (const t of [0, 300, 600, 900, 1200]) st.push(snap(t));
    expect(st.times()).toEqual([600, 900, 1200]);
    expect(st.totalBytes).toBeLessThanOrEqual(3500);
  });

  it('thin mode keeps the first and newest and spreads the rest evenly', () => {
    const st = new SnapshotStore({ minInterval: 300, sizeOf, maxBytes: 5000, mode: 'thin' });
    for (let t = 0; t <= 3000; t += 300) {
      st.push(snap(t));
      expect(st.totalBytes).toBeLessThanOrEqual(5000);
    }
    const ts = st.times();
    expect(ts[0]).toBe(0);
    expect(ts[ts.length - 1]).toBe(3000);
    expect(ts.length).toBeGreaterThanOrEqual(3);
    // Uniform spacing (the stride) except for the gap to the head, which is never longer than one stride.
    const gaps = ts.slice(1).map((v, i) => v - ts[i]!);
    const stride = st.spacing;
    for (const g of gaps.slice(0, -1)) expect(g).toBe(stride);
    expect(gaps[gaps.length - 1]).toBeLessThanOrEqual(stride);
    // Keeps working for a long run at bounded memory.
    for (let t = 3300; t <= 36_000; t += 300) st.push(snap(t));
    expect(st.totalBytes).toBeLessThanOrEqual(5000);
    expect(st.times()[0]).toBe(0);
    expect(st.atOrBefore(20_000)!.time).toBeLessThanOrEqual(20_000);
  });
});

// ───────────────────────────── geography ─────────────────────────────

describe('NSW check and coordinate parsing', () => {
  it('classifies clear cases', () => {
    expect(isInNsw({ lat: -33.715, lon: 150.285 })).toBe(true); // Katoomba
    expect(isInNsw({ lat: -33.87, lon: 151.21 })).toBe(true); // Sydney
    expect(isInNsw({ lat: -36.5, lon: 148.3 })).toBe(true); // Thredbo
    expect(isInNsw({ lat: -31.28, lon: 149.02 })).toBe(true); // Warrumbungles
    expect(isInNsw({ lat: -35.28, lon: 149.13 })).toBe(true); // Canberra (ACT, surrounded by NSW)
    expect(isInNsw({ lat: -27.47, lon: 153.03 })).toBe(false); // Brisbane
    expect(isInNsw({ lat: -37.81, lon: 144.96 })).toBe(false); // Melbourne
    expect(isInNsw({ lat: -34.93, lon: 138.6 })).toBe(false); // Adelaide
    expect(isInNsw({ lat: -34.3, lon: 142.1 })).toBe(false); // Mildura area, Victoria
    expect(isInNsw({ lat: -33.9, lon: 152.5 })).toBe(false); // Tasman Sea
  });

  it('parses coordinates in common formats', () => {
    expect(parseLatLon('-33.715, 150.285')).toEqual({ lat: -33.715, lon: 150.285 });
    expect(parseLatLon('33.715 S 150.285 E')).toEqual({ lat: -33.715, lon: 150.285 });
    const dm = parseLatLon(`33°42.9'S 150°17.1'E`)!;
    expect(dm.lat).toBeCloseTo(-33.715, 3);
    expect(dm.lon).toBeCloseTo(150.285, 3);
    expect(parseLatLon('150.285E 33.715S')).toEqual({ lat: -33.715, lon: 150.285 });
    expect(parseLatLon('hello')).toBeNull();
    expect(parseLatLon('-133, 150')).toBeNull();
  });
});

// ───────────────────────────── brush geometry ─────────────────────────────

describe('brush geometry', () => {
  it('a tap is a circle', () => {
    const p = strokeToPolygon([[100, 200]], 50);
    expect(polygonArea(p)).toBeCloseTo(Math.PI * 2500, -2);
  });

  it('a straight stroke becomes a capsule of the right area', () => {
    const r = 40;
    const p = strokeToPolygon(
      [
        [0, 0],
        [300, 0],
      ],
      r,
    );
    const expected = 300 * 2 * r + Math.PI * r * r;
    expect(polygonArea(p) / expected).toBeGreaterThan(0.9);
    expect(polygonArea(p) / expected).toBeLessThan(1.1);
    expect(pointInRing(150, 0, p)).toBe(true);
    expect(pointInRing(150, 60, p)).toBe(false);
    expect(pointInRing(-30, 0, p)).toBe(true);
  });

  it('a curved stroke is not filled in like a convex hull', () => {
    // An L-shaped stroke: the inside corner far from the path must stay outside.
    const p = strokeToPolygon(
      [
        [0, 0],
        [400, 0],
        [400, 400],
      ],
      30,
    );
    expect(pointInRing(200, 0, p)).toBe(true);
    expect(pointInRing(400, 200, p)).toBe(true);
    expect(pointInRing(150, 250, p)).toBe(false);
  });

  it('traces a boundary counter-clockwise around a 2 × 2 block', () => {
    const nx = 4;
    const ny = 4;
    const mask = new Uint8Array(nx * ny);
    for (const [i, j] of [
      [1, 1],
      [2, 1],
      [1, 2],
      [2, 2],
    ] as const)
      mask[j * nx + i] = 1;
    const ring = traceOuterBoundary(mask, nx, ny);
    expect(ring).toEqual([
      [1, 1],
      [3, 1],
      [3, 3],
      [1, 3],
    ]);
  });

  it('simplifies and thins paths', () => {
    const line: [number, number][] = [
      [0, 0],
      [1, 0.01],
      [2, 0],
      [3, 0.02],
      [4, 0],
    ];
    expect(simplifyPolyline(line, 0.1)).toEqual([
      [0, 0],
      [4, 0],
    ]);
    expect(thinPath(line, 1.5)).toEqual([
      [0, 0],
      [2, 0],
      [4, 0],
    ]);
    expect(polygonArea(circlePolygon(0, 0, 1, 256))).toBeCloseTo(Math.PI, 2);
  });
});

// ───────────────────────────── weather series ─────────────────────────────

describe('weather series', () => {
  const start = Date.UTC(2026, 0, 10, 0, 0);
  const series = manualSeries({
    location: { lat: -33.7, lon: 150.3 },
    start,
    hours: 6,
    temperature: 33,
    relativeHumidity: 15,
    windKmh: 36,
    windDir: 315,
    droughtFactor: 9,
    change: { time: start + 3 * 3600_000, windKmh: 45, windDir: 225, temperature: 24, relativeHumidity: 45 },
  });

  it('holds manual values and applies the change', () => {
    expect(series.kind).toBe('manual');
    expect(series.droughtFactor).toBe(9);
    const w0 = weatherAt(series, start + 3600_000);
    expect(w0.temperature).toBeCloseTo(33);
    expect(w0.windDir10).toBeCloseTo(315);
    expect(w0.windSpeed10).toBeCloseTo(10);
    const w1 = weatherAt(series, start + 4 * 3600_000);
    expect(w1.windDir10).toBeCloseTo(225);
    expect(w1.relativeHumidity).toBeCloseTo(45);
    expect(detectWindChanges(series.hours)).toHaveLength(1);
  });

  it('interpolates wind direction as a vector across north', () => {
    const s = manualSeries({ location: { lat: 0, lon: 0 }, start, hours: 2, temperature: 20, relativeHumidity: 50, windKmh: 20, windDir: 350 });
    s.hours[2]!.windDir10 = 10;
    const mid = weatherAt(s, (s.hours[1]!.time + s.hours[2]!.time) / 2);
    expect(mid.windDir10 < 5 || mid.windDir10 > 355).toBe(true);
  });
});
