/**
 * Calendar helpers of the scenario builder (spec §0.2): civil dates in Australia/Sydney (DST-aware, for daily
 * weather aggregation and RFS time stamps) and local mean solar time (LMST = UTC + lon/15 h) for physics clocks
 * (preset diurnal shapes, change times, replay starts). Uses Intl (available in browsers, workers and Node); falls
 * back to a fixed UTC+10 when the runtime has no time-zone data.
 */
const H = 3.6e6;
const DAY = 86.4e6;

const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatter(tz: string): Intl.DateTimeFormat | null {
  let f = formatters.get(tz);
  if (f === undefined) {
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      f = null;
    }
    formatters.set(tz, f);
  }
  return f;
}

/** Offset (ms) of the civil time in `tz` from UTC at instant `ms` (e.g. +10 h for AEST, +11 h for AEDT). */
export function zoneOffsetMs(ms: number, tz = 'Australia/Sydney'): number {
  const f = formatter(tz);
  if (!f || !Number.isFinite(ms)) return 10 * H;
  let y = 0;
  let mo = 0;
  let d = 0;
  let h = 0;
  let mi = 0;
  let s = 0;
  for (const p of f.formatToParts(new Date(ms))) {
    switch (p.type) {
      case 'year':
        y = Number(p.value);
        break;
      case 'month':
        mo = Number(p.value);
        break;
      case 'day':
        d = Number(p.value);
        break;
      case 'hour':
        h = Number(p.value) % 24;
        break;
      case 'minute':
        mi = Number(p.value);
        break;
      case 'second':
        s = Number(p.value);
        break;
    }
  }
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000) * 60000;
}

/** Civil calendar date 'yyyy-mm-dd' of instant `ms` in `tz`. */
export function civilDate(ms: number, tz = 'Australia/Sydney'): string {
  return new Date(ms + zoneOffsetMs(ms, tz)).toISOString().slice(0, 10);
}

/** UTC instant of a civil wall-clock time in `tz` (the earlier instant in an ambiguous DST hour). */
export function civilToUtc(y: number, month1: number, d: number, h = 0, mi = 0, s = 0, tz = 'Australia/Sydney'): number {
  const wall = Date.UTC(y, month1 - 1, d, h, mi, s);
  let t = wall - zoneOffsetMs(wall - 10 * H, tz);
  t = wall - zoneOffsetMs(t, tz);
  return t;
}

/** ISO date plus n days. */
export function addDaysIso(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + n * DAY).toISOString().slice(0, 10);
}

/** Whole days from ISO date a to ISO date b (b − a). */
export function daysBetweenIso(a: string, b: string): number {
  const pa = a.split('-').map(Number) as [number, number, number];
  const pb = b.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / DAY);
}

/** UTC instant of `hourLmst` local mean solar time on the LMST calendar date `date` at longitude `lonDeg` (§0.2). */
export function lmstToUtc(date: string, hourLmst: number, lonDeg: number): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) + (hourLmst - lonDeg / 15) * H;
}

/** LMST calendar date 'yyyy-mm-dd' of an instant. */
export function lmstDate(ms: number, lonDeg: number): string {
  return new Date(ms + (lonDeg / 15) * H).toISOString().slice(0, 10);
}

/** UTC instant of LMST midnight starting the LMST day that contains `ms`. */
export function lmstMidnight(ms: number, lonDeg: number): number {
  const shift = (lonDeg / 15) * H;
  return Math.floor((ms + shift) / DAY) * DAY - shift;
}
