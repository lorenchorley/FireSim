/**
 * The touch probe of the side view (pure; plan 8.1 and 8.5): what the air is at a tapped point of a slice, how the keyboard
 * moves it, and the sentence that reads it out. It reads the arrays `sampleSlice` stored (bilinear between lattice points, the
 * validity mask keeping the zeros of cells under the ground out of the blend) and never resamples the air.
 *
 * Wind direction is reported the way the rest of the app says it: where the wind comes FROM, with the hyphenated 8-point
 * compass word of explain/text.ts ("north-west"), rebuilt from `along` and `across` with the inverse of the conventions in
 * types.ts.
 */
import { RAD, wrapDeg } from '../../core/units';
import { compassWord, int, short } from '../../explain/text';
import { LatticeStencil } from './lattice';
import type { SliceData, SliceKind, SliceProbePos, SliceProbeReading, SliceSpeedUnit } from './types';

/** Below this horizontal speed (m/s) the wind has no direction worth naming. */
const CALM_MS = 0.2;
/** A component clause ("along the line ...") is left out below this (m/s): it would read as nothing. */
const SMALL_MS = 0.2;
/** Vertical motion under this (m/s) is not worth a clause. */
const LEVEL_MS = 0.05;

const stencil = new LatticeStencil();

/**
 * The direction a wind with components (u east, v north) comes FROM, degrees clockwise from north in [0, 360): a wind blowing
 * towards the east (u > 0) is from 270. No wind at all gives 0.
 */
export function windFromDeg(u: number, v: number): number {
  if (Math.abs(u) < 1e-9 && Math.abs(v) < 1e-9) return 0;
  return wrapDeg(Math.atan2(-u, -v) * RAD);
}

const clampNum = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * The reading at `pos` (clamped into the slice): the position, the map point of the pin, the height above the 10 m ground and
 * `where`, and, in valid air, the stored fields interpolated there. `fromDeg` is rebuilt from `along` and `across`; it and
 * `fromWord` are null in a calm (under 0.2 m/s). `thetaK` and `smoke` are null where the air has no such field.
 */
export function probeAt(data: SliceData, pos: SliceProbePos): SliceProbeReading {
  const length = data.line.length;
  const s = clampNum(Number.isFinite(pos.s) ? pos.s : 0, 0, length);
  const z = clampNum(Number.isFinite(pos.z) ? pos.z : data.zMin, data.zMin, data.zMax);
  const x = data.line.a[0] + data.line.dir[0] * s;
  const y = data.line.a[1] + data.line.dir[1] * s;
  // The two columns either side of s (columns lie at s = c / (columns - 1) x length) and the fraction between them.
  const cols = data.columns;
  const fc = length > 0 ? (s / length) * (cols - 1) : 0;
  const c0 = Math.min(Math.max(0, Math.floor(fc)), Math.max(0, cols - 2));
  const c1 = Math.min(c0 + 1, cols - 1);
  const t = clampNum(fc - c0, 0, 1);
  const ground = data.ground[c0]! + (data.ground[c1]! - data.ground[c0]!) * t;
  const modelGround = data.modelGround[c0]! + (data.modelGround[c1]! - data.modelGround[c0]!) * t;
  const aglM = z - ground;
  const r: SliceProbeReading = {
    pos: { s, z },
    x,
    y,
    aglM,
    where: 'air',
    speed: null,
    along: null,
    across: null,
    up: null,
    fromDeg: null,
    fromWord: null,
    thetaK: null,
    smoke: null,
  };
  if (z < ground) {
    r.where = 'in-ground';
    return r;
  }
  if (z < modelGround) {
    r.where = 'below-model';
    return r;
  }
  if (z > data.topAsl) {
    r.where = 'above-model';
    return r;
  }
  stencil.locate(data, s, z);
  if (stencil.coverage <= 1e-9) {
    // Between the two ground lines the model has nothing here: every lattice point around the pin is outside it.
    r.where = 'below-model';
    return r;
  }
  const v = data.values;
  const speed = stencil.value(v.speed);
  const along = stencil.value(v.along);
  const across = stencil.value(v.across);
  r.speed = speed;
  r.along = along;
  r.across = across;
  r.up = stencil.value(v.up);
  if (speed >= CALM_MS) {
    const dx = data.line.dir[0];
    const dy = data.line.dir[1];
    r.fromDeg = windFromDeg(along * dx + across * dy, along * dy - across * dx);
    r.fromWord = compassWord(r.fromDeg);
  }
  if (data.has.theta) r.thetaK = stencil.value(v.theta);
  if (data.has.smoke) r.smoke = stencil.value(v.smoke);
  return r;
}

/**
 * The keyboard: one lattice step per key (a quarter of the axis when `big`), starting from the middle of the slice when there
 * is no probe yet, and never leaving the slice. "right" goes towards B, "up" goes up.
 */
export function moveProbe(data: SliceData, pos: SliceProbePos | null, key: 'left' | 'right' | 'up' | 'down', big = false): SliceProbePos {
  const length = data.line.length;
  const span = data.zMax - data.zMin;
  // A position that was already outside is first brought back in, then moved.
  let s = pos && Number.isFinite(pos.s) ? clampNum(pos.s, 0, length) : length / 2;
  let z = pos && Number.isFinite(pos.z) ? clampNum(pos.z, data.zMin, data.zMax) : data.zMin + span / 2;
  const ds = big ? length / 4 : length / Math.max(1, data.columns - 1);
  const dz = big ? span / 4 : span / Math.max(1, data.rows - 1);
  if (key === 'left') s -= ds;
  else if (key === 'right') s += ds;
  else if (key === 'up') z += dz;
  else z -= dz;
  return { s: clampNum(s, 0, length), z: clampNum(z, data.zMin, data.zMax) };
}

/** A speed in the chosen unit: "32 km/h" (whole numbers) or "9.4 m/s" (a decimal below 10). */
function speedWords(ms: number, units: SliceSpeedUnit): string {
  return units === 'ms' ? `${short(ms)} m/s` : `${int(ms * 3.6)} km/h`;
}

/**
 * The readout, in the repo's voice (plain words, "about"), for example "Wind about 32 km/h from the north-west, along the line
 * 28 km/h towards B, up 1.4 m/s, 60 m above ground, 3 K warmer than the area". The wind is always "from"; the along and across
 * parts say which way the air goes in the picture ("towards A" or "towards B", "to the right" or "to the left" of someone
 * walking from A to B); vertical motion is in m/s whatever the speed unit is. The temperature clause is for the time-stepped
 * kind only. A point that is not in the model's air gets one short sentence saying why.
 */
export function probeSentence(r: SliceProbeReading, opts: { units: SliceSpeedUnit; kind: SliceKind }): string {
  if (r.where === 'in-ground') return 'Inside the ground';
  if (r.where === 'below-model') return "Below the model's ground: the model has no air here";
  if (r.where === 'above-model') return 'Above the top of the model';
  const parts: string[] = [];
  const speed = r.speed ?? 0;
  const calm = r.fromWord === null || speed < CALM_MS;
  parts.push(calm ? 'Calm' : `Wind about ${speedWords(speed, opts.units)} from the ${r.fromWord}`);
  const along = r.along ?? 0;
  const across = r.across ?? 0;
  if (!calm && Math.abs(along) >= SMALL_MS) parts.push(`along the line ${speedWords(Math.abs(along), opts.units)} towards ${along >= 0 ? 'B' : 'A'}`);
  if (!calm && Math.abs(across) >= SMALL_MS) parts.push(`across the line ${speedWords(Math.abs(across), opts.units)} to the ${across >= 0 ? 'right' : 'left'}`);
  const up = r.up ?? 0;
  if (Math.abs(up) >= LEVEL_MS) parts.push(`${up > 0 ? 'up' : 'down'} ${short(Math.abs(up))} m/s`);
  parts.push(r.aglM < 1 ? 'at ground level' : `${int(r.aglM >= 20 ? Math.round(r.aglM / 10) * 10 : r.aglM)} m above ground`);
  if (opts.kind === 'prognostic' && r.thetaK !== null) {
    parts.push(Math.abs(r.thetaK) < 0.5 ? 'about the same temperature as the area' : `${short(Math.abs(r.thetaK))} K ${r.thetaK > 0 ? 'warmer' : 'cooler'} than the area`);
  }
  return parts.join(', ');
}
