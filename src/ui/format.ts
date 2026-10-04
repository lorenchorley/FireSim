/**
 * Display formatters for the field UI. Pure functions (no DOM), unit-tested in format.test.ts.
 * Numbers are rounded to what a firefighter can use; precision is never implied beyond the model.
 */
import { compassName, msToKmh, wrapDeg } from '../core/units';

export type SpeedUnit = 'kmh' | 'ms';

export const DEFAULT_TZ = 'Australia/Sydney';

const nf0 = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 1, minimumFractionDigits: 0 });

/** Round to `digits` significant decimals with a thousands separator (en-AU). */
export function formatNumber(v: number, digits = 0): string {
  if (!Number.isFinite(v)) return '–';
  if (digits === 0) return nf0.format(v);
  if (digits === 1) return nf1.format(v);
  return new Intl.NumberFormat('en-AU', { maximumFractionDigits: digits }).format(v);
}

// ───────────────────────────── time ─────────────────────────────

const clockFormats = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string, opts: Intl.DateTimeFormatOptions, key: string): Intl.DateTimeFormat {
  const k = `${tz}|${key}`;
  let f = clockFormats.get(k);
  if (!f) {
    f = new Intl.DateTimeFormat('en-AU', { timeZone: tz, hourCycle: 'h23', ...opts });
    clockFormats.set(k, f);
  }
  return f;
}

/** "14:35" in the scenario's time zone, or "14:35:07" with `withSeconds` (for fine display steps and slow playback). */
export function formatClock(ms: number, tz = DEFAULT_TZ, withSeconds = false): string {
  if (!Number.isFinite(ms)) return '–';
  if (withSeconds) return fmt(tz, { hour: '2-digit', minute: '2-digit', second: '2-digit' }, 'hms').format(ms);
  return fmt(tz, { hour: '2-digit', minute: '2-digit' }, 'hm').format(ms);
}

/** "Sat 14:35". */
export function formatDayClock(ms: number, tz = DEFAULT_TZ): string {
  if (!Number.isFinite(ms)) return '–';
  const parts = fmt(tz, { weekday: 'short', hour: '2-digit', minute: '2-digit' }, 'whm').formatToParts(ms);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('weekday')} ${get('hour')}:${get('minute')}`;
}

/** "Sat 27 Sep 2026, 14:35". */
export function formatDateTime(ms: number, tz = DEFAULT_TZ): string {
  if (!Number.isFinite(ms)) return '–';
  const parts = fmt(tz, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }, 'full').formatToParts(ms);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('weekday')} ${get('day')} ${get('month')} ${get('year')}, ${get('hour')}:${get('minute')}`;
}

/** Local hour of day (0–24, fractional) in a time zone. */
export function localHour(ms: number, tz = DEFAULT_TZ): number {
  const parts = fmt(tz, { hour: '2-digit', minute: '2-digit' }, 'hm').formatToParts(ms);
  const hh = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const mm = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return (hh % 24) + mm / 60;
}

/** Offset (hours) of a time zone from UTC at an instant (handles daylight saving). */
export function tzOffsetHours(ms: number, tz = DEFAULT_TZ): number {
  const p = fmt(tz, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }, 'ymdhm').formatToParts(ms);
  const get = (t: string): number => Number(p.find((x) => x.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'));
  return Math.round(((asUtc - Math.floor(ms / 60_000) * 60_000) / 3600_000) * 4) / 4;
}

/** Local calendar date "yyyy-mm-dd" of an instant in a time zone. */
export function zonedDate(ms: number, tz = DEFAULT_TZ): string {
  const p = fmt(tz, { year: 'numeric', month: '2-digit', day: '2-digit' }, 'ymd').formatToParts(ms);
  const get = (t: string): string => p.find((x) => x.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Unix ms of a wall-clock time on a local date in a time zone. */
export function zonedTime(date: string, hour: number, minute = 0, tz = DEFAULT_TZ): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  const first = guess - tzOffsetHours(guess, tz) * 3600_000;
  // Re-evaluate at the result in case the guess fell on the other side of a daylight-saving change.
  return guess - tzOffsetHours(first, tz) * 3600_000;
}

/**
 * Value for an `<input type="datetime-local">` ("yyyy-mm-ddThh:mm") showing an instant as wall-clock time in `tz`.
 * The setup screen uses the scenario time zone (NSW) rather than the device's, so the times typed match the
 * simulation clock even on a phone or laptop set to another zone.
 */
export function toZonedInput(ms: number, tz = DEFAULT_TZ): string {
  const p = fmt(tz, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }, 'ymdhm').formatToParts(ms);
  const get = (t: string): string => p.find((x) => x.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${String(Number(get('hour')) % 24).padStart(2, '0')}:${get('minute')}`;
}

/** Inverse of {@link toZonedInput}: unix ms of a "yyyy-mm-ddThh:mm" wall-clock time in `tz` (NaN if malformed). */
export function fromZonedInput(v: string, tz = DEFAULT_TZ): number {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(v);
  if (!m) return Number.NaN;
  return zonedTime(m[1]!, Number(m[2]), Number(m[3]), tz);
}

/** Duration "2 h 35 min", "45 min", "0 min", "12 h". Negative values are shown as their magnitude. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '–';
  const totalMin = Math.round(Math.abs(seconds) / 60);
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  if (hh === 0) return `${mm} min`;
  if (mm === 0) return `${hh} h`;
  return `${hh} h ${mm} min`;
}

/** Elapsed simulation time "+2 h 35 min". */
export function formatElapsed(seconds: number): string {
  return `${seconds < 0 ? '−' : '+'}${formatDuration(seconds)}`;
}

/** Compact elapsed "+2:35" (h:mm), or "+2:35:07" (h:mm:ss) with `withSeconds`, for tight spaces. */
export function formatElapsedShort(seconds: number, withSeconds = false): string {
  if (!Number.isFinite(seconds)) return '–';
  const sign = seconds < 0 ? '−' : '+';
  const pad = (n: number): string => String(n).padStart(2, '0');
  if (withSeconds) {
    const total = Math.round(Math.abs(seconds));
    return `${sign}${Math.floor(total / 3600)}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
  }
  const totalMin = Math.round(Math.abs(seconds) / 60);
  return `${sign}${Math.floor(totalMin / 60)}:${pad(totalMin % 60)}`;
}

/** A step or interval "10 s", "1 min", "10 min", "1 h" (seconds in; whole units only, otherwise "1 min 30 s"). */
export function formatStepLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '–';
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  if (s % 3600 === 0) return `${s / 3600} h`;
  if (s % 60 === 0) return `${s / 60} min`;
  return `${Math.floor(s / 60)} min ${s % 60} s`;
}

/** Relative "in 45 min" / "35 min ago" / "now". */
export function formatRelative(deltaSeconds: number): string {
  if (Math.abs(deltaSeconds) < 60) return 'now';
  return deltaSeconds > 0 ? `in ${formatDuration(deltaSeconds)}` : `${formatDuration(deltaSeconds)} ago`;
}

// ───────────────────────────── speeds ─────────────────────────────

/** Wind speed in the user's unit, e.g. "35 km/h" or "9.7 m/s". Input m/s. */
export function formatWind(ms: number, unit: SpeedUnit = 'kmh'): string {
  if (!Number.isFinite(ms)) return '–';
  return unit === 'kmh' ? `${formatNumber(msToKmh(ms))} km/h` : `${formatNumber(ms, ms < 10 ? 1 : 0)} m/s`;
}

/**
 * Fire rate of spread (input m/s): km/h when ≥ 1 km/h, otherwise m/h (Australian practice), e.g. "2.4 km/h",
 * "450 m/h", "0 m/h".
 */
export function formatRos(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0 m/h';
  const mh = ms * 3600;
  if (mh >= 1000) return `${formatNumber(mh / 1000, 1)} km/h`;
  if (mh >= 100) return `${formatNumber(Math.round(mh / 10) * 10)} m/h`;
  return `${formatNumber(mh)} m/h`;
}

// ───────────────────────────── fire quantities ─────────────────────────────

/** Fireline intensity (kW/m), e.g. "4,300 kW/m", "< 10 kW/m". */
export function formatIntensity(kWm: number): string {
  if (!Number.isFinite(kWm) || kWm <= 0) return '0 kW/m';
  if (kWm < 10) return '< 10 kW/m';
  const r = kWm >= 10000 ? Math.round(kWm / 1000) * 1000 : kWm >= 1000 ? Math.round(kWm / 100) * 100 : Math.round(kWm / 10) * 10;
  return `${formatNumber(r)} kW/m`;
}

/** Area in hectares: "< 0.1 ha", "3.4 ha", "120 ha", "1,250 ha". */
export function formatArea(ha: number): string {
  if (!Number.isFinite(ha) || ha <= 0) return '0 ha';
  if (ha < 0.1) return '< 0.1 ha';
  if (ha < 10) return `${formatNumber(ha, 1)} ha`;
  return `${formatNumber(ha)} ha`;
}

/** Distance: "450 m", "1.2 km", "12 km". */
export function formatDistance(m: number): string {
  if (!Number.isFinite(m)) return '–';
  if (Math.abs(m) < 1000) return `${formatNumber(Math.round(m / 10) * 10)} m`;
  return Math.abs(m) < 10000 ? `${formatNumber(m / 1000, 1)} km` : `${formatNumber(m / 1000)} km`;
}

/** Short lengths such as flame height: "0.6 m", "2.5 m", "15 m". */
export function formatMetres(m: number): string {
  if (!Number.isFinite(m)) return '–';
  return m < 10 ? `${formatNumber(m, 1)} m` : `${formatNumber(m)} m`;
}

/** Multiplier "×2.4", "×0.55", "×12". */
export function formatMultiplier(f: number): string {
  if (!Number.isFinite(f)) return '×–';
  if (f >= 10) return `×${formatNumber(f)}`;
  if (f >= 0.995 && f <= 1.005) return '×1';
  if (f < 0.1) return `×${formatNumber(f, 2)}`;
  return f < 1 ? `×${formatNumber(f, 2)}` : `×${formatNumber(f, 1)}`;
}

// ───────────────────────────── weather ─────────────────────────────

export const formatTemp = (c: number): string => (Number.isFinite(c) ? `${formatNumber(c)} °C` : '–');
export const formatRH = (rh: number): string => (Number.isFinite(rh) ? `${formatNumber(rh)}%` : '–');
export const formatPercent = (p: number, digits = 0): string => (Number.isFinite(p) ? `${formatNumber(p, digits)}%` : '–');

/** Wind direction (FROM), e.g. "NW (315°)". */
export function formatDirFrom(deg: number): string {
  if (!Number.isFinite(deg)) return '–';
  const d = Math.round(wrapDeg(deg));
  return `${compassName(d)} (${d % 360}°)`;
}

/** Azimuth a thing moves TOWARDS, e.g. "towards NE (45°)". */
export function formatHeading(deg: number): string {
  if (!Number.isFinite(deg)) return '–';
  const d = Math.round(wrapDeg(deg));
  return `towards ${compassName(d)} (${d % 360}°)`;
}

export { compassName };

// ───────────────────────────── other ─────────────────────────────

/** "33.7150° S, 150.2850° E". */
export function formatLatLon(lat: number, lon: number, digits = 4): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '–';
  const ns = lat < 0 ? 'S' : 'N';
  const ew = lon < 0 ? 'W' : 'E';
  return `${Math.abs(lat).toFixed(digits)}° ${ns}, ${Math.abs(lon).toFixed(digits)}° ${ew}`;
}

/** Years since fire: "No record", "< 1 year", "1 year", "7 years", "30+ years". */
export function formatYears(y: number): string {
  if (!Number.isFinite(y)) return 'No record';
  if (y < 1) return '< 1 year';
  if (y >= 30) return '30+ years';
  const r = Math.round(y);
  return r === 1 ? '1 year' : `${r} years`;
}

/** A speed as a plain number: "0.25", "1.5", "60" (no grouping, no trailing zeros). */
function speedNumber(v: number): string {
  if (v >= 10) return String(Math.round(v));
  return String(Number(v.toFixed(2)));
}

/** A speed as a multiple: "0.25×", "60×", "1800×" ("Max" for as fast as possible). */
export function formatSpeedMultiple(speed: number): string {
  return Number.isFinite(speed) ? `${speedNumber(speed)}×` : 'Max';
}

/**
 * Playback speed label (simulated seconds per second) for the speed button: "0.25×", "1×", "60×", "600×", then whole
 * minutes / hours of fire per second when that is shorter ("30 min/s", "1 h/s"), and "Max" for as fast as possible.
 */
export function formatPlaybackSpeed(speed: number): string {
  if (!Number.isFinite(speed)) return 'Max';
  if (speed >= 1800 && speed % 3600 === 0) return `${speed / 3600} h/s`;
  if (speed >= 1800 && speed % 60 === 0) return `${speed / 60} min/s`;
  return formatSpeedMultiple(speed);
}

/** The same speed in words for a hint line: "1 min of fire per second", "Real time", "Slow motion: 1 s of fire takes 4 s". */
export function formatSpeedHint(speed: number): string {
  if (!Number.isFinite(speed)) return 'As fast as the phone can compute';
  if (speed === 1) return 'Real time: 1 s of fire per second';
  if (speed < 1) return `Slow motion: 1 s of fire takes ${speedNumber(1 / speed)} s`;
  if (speed < 60) return `${speedNumber(speed)} s of fire per second`;
  if (speed < 3600) return `${speedNumber(speed / 60)} min of fire per second`;
  return `${speedNumber(speed / 3600)} h of fire per second`;
}

/** Very short form of {@link formatSpeedHint} for the speed presets: "real time", "1 min/s", "1 h/s", "slow". */
export function formatSpeedRate(speed: number): string {
  if (!Number.isFinite(speed)) return 'As fast as possible';
  if (speed === 1) return 'real time';
  if (speed < 1) return 'slow';
  if (speed < 60) return `${speedNumber(speed)} s/s`;
  if (speed < 3600) return `${speedNumber(speed / 60)} min/s`;
  return `${speedNumber(speed / 3600)} h/s`;
}

/** Bytes → "12 MB". */
export function formatBytes(b: number): string {
  if (b < 1024 * 1024) return `${formatNumber(b / 1024)} kB`;
  return `${formatNumber(b / (1024 * 1024), b < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
