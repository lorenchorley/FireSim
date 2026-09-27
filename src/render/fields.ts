/**
 * Pure data preparation for the renderer (no Three.js): decimating the DEM for the mesh, Horn gradients, the natural
 * ground-colour raster, overlay value fields, and the per-snapshot fire textures (arrival with a smooth front halo,
 * burn-state / phase / driver bytes, fire glow). Everything here is unit-testable in Node.
 */
import { boxBlur, resample, type GridSpec } from '../core/grid';
import { BurnState, FuelType, type FireField, type FuelMap, type Terrain } from '../core/types';
import { clamp } from '../core/units';
import type { OverlayKind } from './layers';
import { NO_DATA, NOT_BURNT } from './legends';
import { CURED_GRASS, FUEL_GROUND, LITTER, ROCK, ROCK_DARK, hexToRgb, mixRgb, type Rgb } from './palette';

// ─────────────────────────────────────────────────────────────────────────────
// Hashing (deterministic per-cell randomness shared by placement and colour jitter)
// ─────────────────────────────────────────────────────────────────────────────

/** 32-bit integer hash of up to three integers (lowbias32 mix). */
export function hash3(a: number, b: number, c = 0): number {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Uniform [0, 1) from a hash of up to three integers. */
export const hash01 = (a: number, b: number, c = 0): number => hash3(a, b, c) / 4294967296;

// ─────────────────────────────────────────────────────────────────────────────
// DEM decimation and gradients
// ─────────────────────────────────────────────────────────────────────────────

export interface RenderGrid {
  grid: GridSpec;
  elevation: Float32Array;
  /** Source cells per render cell (≥ 1). */
  ratio: number;
}

/**
 * Resample a DEM onto a regular grid of at most `maxN` samples per side spanning the same extent (outer cell centres).
 * Coarser grids are low-pass filtered first (box blur of about half the ratio) so ridges do not alias.
 */
export function decimateGrid(grid: GridSpec, elevation: Float32Array, maxN: number): RenderGrid {
  const n = Math.max(grid.nx, grid.ny);
  if (n <= maxN) return { grid, elevation, ratio: 1 };
  const spanX = (grid.nx - 1) * grid.cellSize;
  const spanY = (grid.ny - 1) * grid.cellSize;
  const span = Math.max(spanX, spanY);
  const cell = span / (maxN - 1);
  const dst: GridSpec = {
    nx: Math.max(2, Math.round(spanX / cell) + 1),
    ny: Math.max(2, Math.round(spanY / cell) + 1),
    cellSize: cell,
    x0: grid.x0,
    y0: grid.y0,
    origin: grid.origin,
  };
  const ratio = cell / grid.cellSize;
  const r = Math.floor(ratio / 2);
  const src = r >= 1 ? boxBlur(grid, elevation, r) : elevation;
  return { grid: dst, elevation: resample(grid, src, dst), ratio };
}

/**
 * Horn (1981) 3 × 3 gradient, the same operator as src/terrain (edge cells replicate the border).
 * dz/dx is + towards east, dz/dy + towards north (j = 0 south).
 */
export function hornGradient(grid: GridSpec, z: ArrayLike<number>): { dzdx: Float32Array; dzdy: Float32Array } {
  const { nx, ny, cellSize: h } = grid;
  const dzdx = new Float32Array(nx * ny);
  const dzdy = new Float32Array(nx * ny);
  const at = (i: number, j: number): number => z[clamp(j, 0, ny - 1) * nx + clamp(i, 0, nx - 1)]!;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      // Rows north (j+1) … south (j−1): a b c / d e f / g h i
      const a = at(i - 1, j + 1);
      const b = at(i, j + 1);
      const c = at(i + 1, j + 1);
      const d = at(i - 1, j);
      const f = at(i + 1, j);
      const g = at(i - 1, j - 1);
      const hh = at(i, j - 1);
      const ii = at(i + 1, j - 1);
      const k = j * nx + i;
      dzdx[k] = (c + 2 * f + ii - (a + 2 * d + g)) / (8 * h);
      dzdy[k] = (a + 2 * b + c - (g + 2 * hh + ii)) / (8 * h);
    }
  }
  return { dzdx, dzdy };
}

/** Slope (deg) from gradients. */
export const slopeFromGradient = (p: number, q: number): number => (Math.atan(Math.hypot(p, q)) * 180) / Math.PI;

/**
 * A minimal {@link Terrain} on a render grid (elevation + Horn gradients + slope/aspect), enough for src/terrain's
 * castShadows / skyViewFactor / hillshade, which only read grid, elevation and the gradients.
 */
export function lightTerrain(rg: RenderGrid, source: string): Terrain {
  const { grid, elevation } = rg;
  const { dzdx, dzdy } = hornGradient(grid, elevation);
  const n = grid.nx * grid.ny;
  const slopeDeg = new Float32Array(n);
  const aspectDeg = new Float32Array(n);
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = 0; k < n; k++) {
    const p = dzdx[k]!;
    const q = dzdy[k]!;
    slopeDeg[k] = slopeFromGradient(p, q);
    aspectDeg[k] = slopeDeg[k]! < 0.5 ? NaN : ((Math.atan2(-p, -q) * 180) / Math.PI + 360) % 360;
    const e = elevation[k]!;
    if (e < lo) lo = e;
    if (e > hi) hi = e;
  }
  const empty = new Float32Array(n);
  return {
    grid,
    elevation,
    slopeDeg,
    aspectDeg,
    dzdx,
    dzdy,
    tpi: empty,
    curvature: empty,
    landform: new Uint8Array(n),
    minElevation: lo,
    maxElevation: hi,
    source,
  };
}

/** Nearest-cell index of a local point on a grid, clamped to the grid. */
export function nearestCell(g: GridSpec, x: number, y: number): number {
  const i = clamp(Math.round((x - g.x0) / g.cellSize), 0, g.nx - 1);
  const j = clamp(Math.round((y - g.y0) / g.cellSize), 0, g.ny - 1);
  return j * g.nx + i;
}

// ─────────────────────────────────────────────────────────────────────────────
// Natural ground colour
// ─────────────────────────────────────────────────────────────────────────────

const GROUND_RGB = Object.fromEntries(
  Object.entries(FUEL_GROUND).map(([k, v]) => [k, { canopy: hexToRgb(v.canopy), floor: hexToRgb(v.floor) }]),
) as unknown as Record<FuelType, { canopy: Rgb; floor: Rgb }>;
const LITTER_RGB = hexToRgb(LITTER);
const ROCK_RGB = hexToRgb(ROCK);
const ROCK_DARK_RGB = hexToRgb(ROCK_DARK);
const CURED_RGB = hexToRgb(CURED_GRASS);

const GRASSY = new Set<FuelType>([FuelType.Grassland, FuelType.GrassyWoodland, FuelType.AlpineHeathGrass, FuelType.DryForestGrassy]);

/** Slope (deg) above which bare rock shows through regardless of fuel (sandstone cliffs, basalt spires). */
export const CLIFF_SLOPE_DEG = 50;

/**
 * Natural ground colour (sRGB RGBA8, rows j = 0 south) on the fuel grid as seen from above: canopy colour where the
 * canopy is dense, the floor (litter-tinted by the surface fuel hazard, cured grass by curing) between crowns, bare
 * rock on cliffs. A small deterministic jitter breaks up the raster. Alpha stores the rock fraction (0–255).
 */
export function groundColours(fuel: FuelMap, terrain: Terrain | null): Uint8Array {
  const g = fuel.grid;
  const n = g.nx * g.ny;
  const out = new Uint8Array(n * 4);
  const c: Rgb = [0, 0, 0];
  const floor: Rgb = [0, 0, 0];
  const sameGrid = terrain && terrain.grid.nx === g.nx && terrain.grid.ny === g.ny && Math.abs(terrain.grid.cellSize - g.cellSize) < 1e-6;
  for (let j = 0; j < g.ny; j++) {
    for (let i = 0; i < g.nx; i++) {
      const k = j * g.nx + i;
      const t = (fuel.type[k] ?? FuelType.NonFuel) as FuelType;
      const pal = GROUND_RGB[t] ?? GROUND_RGB[FuelType.NonFuel];
      // Floor: litter tint grows with the surface hazard score (0–4); grass cures towards straw.
      mixRgb(pal.floor, LITTER_RGB, clamp((fuel.surfaceHazard[k] ?? 0) / 4, 0, 1) * 0.45, floor);
      if (GRASSY.has(t)) mixRgb(floor, CURED_RGB, clamp((fuel.curing[k] ?? 0) / 100, 0, 1) * 0.8, floor);
      const cover = t === FuelType.Water ? 1 : clamp(fuel.canopyCover[k] ?? 0, 0, 1);
      mixRgb(floor, pal.canopy, Math.sqrt(cover), c);
      // Rock on cliffs.
      let slope = 0;
      if (terrain) {
        const kt = sameGrid ? k : nearestCell(terrain.grid, g.x0 + i * g.cellSize, g.y0 + j * g.cellSize);
        slope = terrain.slopeDeg[kt] ?? 0;
      }
      let rock = t === FuelType.NonFuel ? 0.85 : 0;
      rock = Math.max(rock, clamp((slope - (CLIFF_SLOPE_DEG - 10)) / 20, 0, 1));
      if (rock > 0) {
        const rockC = mixRgb(ROCK_RGB, ROCK_DARK_RGB, hash01(i, j, 7) * 0.6);
        mixRgb(c, rockC, rock, c);
      }
      const jit = 0.94 + 0.12 * hash01(i, j, 3);
      out[k * 4] = Math.round(clamp(c[0] * jit, 0, 1) * 255);
      out[k * 4 + 1] = Math.round(clamp(c[1] * jit, 0, 1) * 255);
      out[k * 4 + 2] = Math.round(clamp(c[2] * jit, 0, 1) * 255);
      out[k * 4 + 3] = Math.round(rock * 255);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Overlay fields
// ─────────────────────────────────────────────────────────────────────────────

export interface OverlaySources {
  terrain: Terrain;
  fuel: FuelMap;
  fire?: FireField | null;
  moisture?: Float32Array | null;
  /** Insolation on the terrain grid (W/m²), computed by the view for 'insolation'. */
  insolation?: Float32Array | null;
  /** Extra rasters from SimSnapshot.layers (fire grid), keyed by overlay kind ('vls', 'attach', 'trench', 'dmz', 'landing'). */
  layers?: Record<string, Float32Array> | null;
}

export interface OverlayField {
  grid: GridSpec;
  /** Values in legend units; {@link NO_DATA} where there is no value (transparent or noData colour). */
  values: Float32Array;
  /** Categorical fields must be sampled with nearest filtering. */
  categorical: boolean;
}

/** The grid a per-cell array belongs to (moisture may be on the fire, fuel or terrain grid). */
function gridForLength(len: number, s: OverlaySources): GridSpec | null {
  const cands = [s.fire?.grid, s.fuel.grid, s.terrain.grid];
  for (const g of cands) if (g && g.nx * g.ny === len) return g;
  return null;
}

/**
 * Overlay values in legend units on the grid of their source (fire, fuel or terrain grid). Fire-derived overlays are
 * NO_DATA where the cell has not burnt. Returns null if the source is not available (e.g. no fire yet).
 */
export function overlayField(kind: OverlayKind, s: OverlaySources): OverlayField | null {
  const f = s.fire;
  const burnt = (k: number): boolean => !!f && Number.isFinite(f.arrivalTime[k]!) && f.arrivalTime[k]! < NOT_BURNT;
  const map = (g: GridSpec, fn: (k: number) => number, categorical = false): OverlayField => {
    const n = g.nx * g.ny;
    const values = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const v = fn(k);
      values[k] = Number.isFinite(v) ? v : NO_DATA;
    }
    return { grid: g, values, categorical };
  };
  switch (kind) {
    case 'none':
      return null;
    case 'arrival':
      if (!f) return null;
      return map(f.grid, (k) => (burnt(k) ? f.arrivalTime[k]! : NO_DATA));
    case 'ros':
      if (!f) return null;
      return map(f.grid, (k) => (burnt(k) ? f.ros[k]! * 3.6 : NO_DATA));
    case 'intensity':
      if (!f) return null;
      return map(f.grid, (k) => (burnt(k) ? Math.max(f.intensity[k]!, 1) : NO_DATA));
    case 'driver':
      if (!f) return null;
      return map(f.grid, (k) => (burnt(k) ? f.driver[k]! : NO_DATA), true);
    case 'moisture': {
      const m = s.moisture;
      if (!m) return null;
      const g = gridForLength(m.length, s);
      if (!g) return null;
      return map(g, (k) => m[k]!);
    }
    case 'fuelLoad': {
      const u = s.fuel;
      return map(u.grid, (k) =>
        u.type[k] === FuelType.NonFuel || u.type[k] === FuelType.Water ? NO_DATA : u.surfaceLoad[k]! + u.nearSurfaceLoad[k]! + u.elevatedLoad[k]! + u.barkLoad[k]!,
      );
    }
    case 'fuelType':
      return map(s.fuel.grid, (k) => s.fuel.type[k]!, true);
    case 'timeSinceFire':
      return map(s.fuel.grid, (k) => s.fuel.timeSinceFire[k]!);
    case 'slope':
      return map(s.terrain.grid, (k) => s.terrain.slopeDeg[k]!);
    case 'aspect':
      return map(s.terrain.grid, (k) => s.terrain.aspectDeg[k]!);
    case 'insolation': {
      const ins = s.insolation;
      if (!ins) return null;
      const g = gridForLength(ins.length, s);
      if (!g) return null;
      return map(g, (k) => ins[k]!);
    }
    case 'vls':
    case 'attach':
    case 'trench':
    case 'dmz':
    case 'landing': {
      const r = s.layers?.[kind];
      if (!r) return null;
      const g = gridForLength(r.length, s);
      if (!g) return null;
      // Scores below 2 % (or no landings) are transparent so the terrain stays readable.
      return map(g, (k) => (r[k]! > (kind === 'landing' ? 0 : 0.02) ? r[k]! : NO_DATA));
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fire textures
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Arrival times for the GPU (R32F): burnt cells keep their arrival; unburnt flammable cells next to burnt ones get an
 * estimated arrival (neighbour arrival + distance / neighbour ROS, but never before the snapshot `time` since they were
 * still unburnt then) so that the interpolated front is a smooth curve and keeps moving between snapshots; everything
 * else is {@link NOT_BURNT}. Returns the latest finite arrival too.
 */
export function arrivalTexture(fire: FireField, time: number, out?: Float32Array): { data: Float32Array; maxArrival: number; burntCells: number } {
  const g = fire.grid;
  const { nx, ny, cellSize: h } = g;
  const n = nx * ny;
  const data = out && out.length === n ? out : new Float32Array(n);
  const ta = fire.arrivalTime;
  let maxArrival = 0;
  let burntCells = 0;
  for (let k = 0; k < n; k++) {
    const v = ta[k]!;
    if (Number.isFinite(v) && v < NOT_BURNT) {
      data[k] = v;
      if (v > maxArrival) maxArrival = v;
      burntCells++;
    } else data[k] = NOT_BURNT;
  }
  // One-cell halo of estimated arrivals ahead of the front.
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (data[k]! < NOT_BURNT || fire.burnState[k] === BurnState.NonFlammable) continue;
      let best = NOT_BURNT;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = j + dj;
        if (jj < 0 || jj >= ny) continue;
        for (let di = -1; di <= 1; di++) {
          const ii = i + di;
          if ((di === 0 && dj === 0) || ii < 0 || ii >= nx) continue;
          const kk = jj * nx + ii;
          const a = ta[kk]!;
          if (!(Number.isFinite(a) && a < NOT_BURNT)) continue;
          const dist = h * (di !== 0 && dj !== 0 ? Math.SQRT2 : 1);
          const r = Math.max(fire.ros[kk]!, 0.005);
          // Not burnt at the snapshot time, so the true arrival is later than `time`.
          const est = Math.max(a + dist / r, time + 1);
          if (est < best) best = est;
        }
      }
      // Neighbours are read from the source field, so estimates never chain.
      if (best < NOT_BURNT) data[k] = best;
    }
  }
  return { data, maxArrival, burntCells };
}

/** Per-cell fire bytes for the GPU (RGBA8): R burnState, G Vesta phase, B driver, A flame height (0.25 m units). */
export function fireAuxTexture(fire: FireField, out?: Uint8Array): Uint8Array {
  const n = fire.grid.nx * fire.grid.ny;
  const data = out && out.length === n * 4 ? out : new Uint8Array(n * 4);
  for (let k = 0; k < n; k++) {
    data[k * 4] = fire.burnState[k]!;
    data[k * 4 + 1] = fire.phase[k]!;
    data[k * 4 + 2] = fire.driver[k]!;
    data[k * 4 + 3] = Math.min(255, Math.round((fire.flameHeight[k] ?? 0) * 4));
  }
  return data;
}

/**
 * Low-resolution fire glow (0–1, R8-able) used as a local light: burning cells (and cells that ignited in the last
 * `window` seconds) splatted with weight ∝ log intensity, then blurred over ≈ `radius` m. Grid side ≤ `maxN`.
 */
export function glowField(
  fire: FireField,
  time: number,
  opts: { window?: number; radius?: number; maxN?: number } = {},
): { grid: GridSpec; data: Float32Array; total: number } {
  const window = opts.window ?? 900;
  const radius = opts.radius ?? 250;
  const maxN = opts.maxN ?? 128;
  const src = fire.grid;
  const step = Math.max(1, Math.ceil(Math.max(src.nx, src.ny) / maxN));
  const g: GridSpec = {
    nx: Math.ceil(src.nx / step),
    ny: Math.ceil(src.ny / step),
    cellSize: src.cellSize * step,
    x0: src.x0 + ((step - 1) * src.cellSize) / 2,
    y0: src.y0 + ((step - 1) * src.cellSize) / 2,
    origin: src.origin,
  };
  const acc = new Float32Array(g.nx * g.ny);
  let total = 0;
  for (let j = 0; j < src.ny; j++) {
    for (let i = 0; i < src.nx; i++) {
      const k = j * src.nx + i;
      const a = fire.arrivalTime[k]!;
      const burning = fire.burnState[k] === BurnState.Burning;
      const dt = time - a;
      if (!(burning || (dt >= 0 && dt <= window))) continue;
      const fresh = burning ? 1 : 1 - dt / window;
      const w = fresh * clamp(Math.log10(Math.max(fire.intensity[k]!, 10)) / 4.5, 0.15, 1);
      acc[((j / step) | 0) * g.nx + ((i / step) | 0)]! += w;
      total += w;
    }
  }
  const r = Math.max(1, Math.round(radius / g.cellSize));
  const blurred = boxBlur(g, boxBlur(g, acc, r), r);
  // Normalise so a fully burning neighbourhood saturates.
  const norm = (step * step) / 2.5;
  for (let k = 0; k < blurred.length; k++) blurred[k] = clamp(blurred[k]! / norm, 0, 1);
  return { grid: g, data: blurred, total };
}

export interface FlameSite {
  x: number;
  y: number;
  arrival: number;
  flameHeight: number;
  intensity: number;
  /** Time the cell stays flaming after arrival (s). */
  life: number;
  /** 0–1 random. */
  rand: number;
}

/**
 * Cells whose flames may be visible while the display time sweeps [tFrom, tTo]: arrival in [tFrom − maxLife, tTo],
 * or still burning according to the model. Several jittered flame sites per cell (so flames form a continuous line),
 * capped at `max` (keeping the most intense). Flame life ≈ time for the front to cross the cell (≥ minLife).
 */
export function flameSites(
  fire: FireField,
  tFrom: number,
  tTo: number,
  opts: { max?: number; minLife?: number; maxLife?: number; perCell?: number; seed?: number } = {},
): FlameSite[] {
  const max = opts.max ?? 5000;
  const minLife = opts.minLife ?? 180;
  const maxLife = opts.maxLife ?? 1800;
  const perCell = opts.perCell ?? Math.max(1, Math.min(3, Math.round(fire.grid.cellSize / 12)));
  const seed = opts.seed ?? 11;
  const g = fire.grid;
  const h = g.cellSize;
  const cells: number[] = [];
  const lifeOf = (k: number): number => clamp((1.3 * h) / Math.max(fire.ros[k]!, 1e-3), minLife, maxLife);
  for (let k = 0; k < g.nx * g.ny; k++) {
    const a = fire.arrivalTime[k]!;
    if (!Number.isFinite(a) || a >= NOT_BURNT) continue;
    if (fire.burnState[k] === BurnState.Burning || (a <= tTo && a >= tFrom - lifeOf(k))) cells.push(k);
  }
  if (cells.length * perCell > max) cells.sort((p, q) => fire.intensity[q]! - fire.intensity[p]!);
  const out: FlameSite[] = [];
  for (const k of cells) {
    const i = k % g.nx;
    const j = (k / g.nx) | 0;
    // Cells the model still reports as burning keep (lower, older) flames until the next snapshot.
    const life = fire.burnState[k] === BurnState.Burning ? Math.max(lifeOf(k), tTo - fire.arrivalTime[k]! + 240) : lifeOf(k);
    for (let s = 0; s < perCell; s++) {
      if (out.length >= max) return out;
      const r1 = hash01(i, j, seed + s * 3);
      const r2 = hash01(i, j, seed + s * 3 + 1);
      const r3 = hash01(i, j, seed + s * 3 + 2);
      out.push({
        x: g.x0 + (i + r1 - 0.5) * h,
        y: g.y0 + (j + r2 - 0.5) * h,
        // Stagger ignition inside the cell a little so flames do not pop in unison.
        arrival: fire.arrivalTime[k]! + (r3 - 0.5) * 0.3 * lifeOf(k),
        flameHeight: fire.flameHeight[k]!,
        intensity: fire.intensity[k]!,
        life,
        rand: r3,
      });
    }
  }
  return out;
}

/** Intensity-weighted centroid of the burning / recently burnt cells (for plume and camera "look at fire"). */
export function fireCentroid(fire: FireField, time: number, window = 1800): { x: number; y: number; weight: number; maxIntensity: number } | null {
  const g = fire.grid;
  let sx = 0;
  let sy = 0;
  let sw = 0;
  let mi = 0;
  for (let j = 0; j < g.ny; j++) {
    for (let i = 0; i < g.nx; i++) {
      const k = j * g.nx + i;
      const a = fire.arrivalTime[k]!;
      const active = fire.burnState[k] === BurnState.Burning || (time - a >= 0 && time - a <= window);
      if (!active) continue;
      const w = Math.max(fire.intensity[k]!, 50);
      sx += w * (g.x0 + i * g.cellSize);
      sy += w * (g.y0 + j * g.cellSize);
      sw += w;
      if (fire.intensity[k]! > mi) mi = fire.intensity[k]!;
    }
  }
  return sw > 0 ? { x: sx / sw, y: sy / sw, weight: sw, maxIntensity: mi } : null;
}
