/**
 * Static (once per scenario, or after fuel edits) caches of the insight engine (spec §10.1, doc 10 §9.1 "static
 * terrain precomputation"): feature cell lists, the ridge and recent-burn distance transforms, gully segments with
 * their lower thirds, per-tile ridge representatives, valley-floor samples and fuel-break cells. Nothing here depends
 * on the fire or the weather, so the per-cycle detectors only read typed arrays.
 */
import type { GridSpec } from '../core/grid';
import { FuelFlag, FuelType, Landform, type FuelMap, type Terrain, type TerrainDerived, type TerrainFeatures } from '../core/types';
import { directionalSlopeDeg } from '../terrain';
import { DEMO_SITES } from '../data/demoSites';
import { EXPLAIN_PARAMS, LEE_OF_DIVIDE, DIVIDE_LINE } from './params';
import { Tiles } from './util';

const P = EXPLAIN_PARAMS;

/** One connected gully (trench) segment of `features.gullyBase` (spec §7.6, §10.1 "gully base", "lower third"). */
export interface GullySegment {
  /** Lowest cell (features.gullyBase). */
  base: number;
  zBase: number;
  zTop: number;
  /** Segment cells (trench ≥ minTrench). */
  cells: Int32Array;
  /** Cells with z ≤ z_base + (z_top − z_base)/3. */
  lowerThird: Int32Array;
  /** Steep, deep drainage cells: axial slope ≥ 20°, TPI_small ≤ −10 m, trench ≥ 0.3. */
  steep: Int32Array;
  /** Maximum axial (along-gully) slope (deg) over the steep cells. */
  axialMax: number;
  /** Up-gully azimuth at the base (deg) (circular mean over the lower third). */
  upAzimuth: number;
}

/**
 * Two-pass chamfer (1, √2) distance transform from source cells, with nearest-source propagation.
 * dist in metres (≈ 4 % max error), nearest = index of the source (−1 where none).
 */
export function distanceTransform(g: GridSpec, isSource: Uint8Array, dist: Float32Array, nearest: Int32Array): void {
  const { nx, ny, cellSize: h } = g;
  const d2 = Math.SQRT2 * h;
  for (let k = 0; k < nx * ny; k++) {
    if (isSource[k]) {
      dist[k] = 0;
      nearest[k] = k;
    } else {
      dist[k] = Infinity;
      nearest[k] = -1;
    }
  }
  const relax = (k: number, q: number, w: number): void => {
    const c = dist[q]! + w;
    if (c < dist[k]!) {
      dist[k] = c;
      nearest[k] = nearest[q]!;
    }
  };
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (i > 0) relax(k, k - 1, h);
      if (j > 0) {
        relax(k, k - nx, h);
        if (i > 0) relax(k, k - nx - 1, d2);
        if (i < nx - 1) relax(k, k - nx + 1, d2);
      }
    }
  }
  for (let j = ny - 1; j >= 0; j--) {
    for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i;
      if (i < nx - 1) relax(k, k + 1, h);
      if (j < ny - 1) {
        relax(k, k + nx, h);
        if (i < nx - 1) relax(k, k + nx + 1, d2);
        if (i > 0) relax(k, k + nx - 1, d2);
      }
    }
  }
}

/** Is the site east (lee) of the Great Dividing Range? Demo flag within 20 km of a demo centre, else the divide line. */
export function leeOfDivide(lat: number, lon: number): boolean {
  for (const s of DEMO_SITES) {
    const dy = (s.centre.lat - lat) * 111.2;
    const dx = (s.centre.lon - lon) * 111.2 * Math.cos((lat * Math.PI) / 180);
    if (Math.hypot(dx, dy) < 20 && LEE_OF_DIVIDE[s.id] !== undefined) return LEE_OF_DIVIDE[s.id]!;
  }
  const L = DIVIDE_LINE;
  if (lat >= L[0]![0]) return lon > L[0]![1];
  for (let a = 0; a + 1 < L.length; a++) {
    const [la0, lo0] = L[a]!;
    const [la1, lo1] = L[a + 1]!;
    if (lat <= la0 && lat >= la1) {
      const t = (lat - la0) / (la1 - la0);
      return lon > lo0 + t * (lo1 - lo0);
    }
  }
  return lon > L[L.length - 1]![1];
}

export class StaticMaps {
  readonly grid: GridSpec;
  readonly tiles: Tiles;
  readonly ridgeCells: Int32Array;
  /** Highest ridge cell of each 500 m tile (−1 where none). */
  readonly ridgeRepOfTile: Int32Array;
  readonly ridgeReps: Int32Array;
  readonly saddleCells: Int32Array;
  /** Valley-floor samples (≤ 6 lowest per tile) with localRelief ≥ 150 m. */
  readonly valleyFloorCells: Int32Array;
  readonly gullies: GullySegment[];
  readonly narrowValleyCells: Int32Array;
  /** Distance (m) to the nearest ridge cell and its index. */
  readonly ridgeDist: Float32Array;
  readonly ridgeNearest: Int32Array;
  /** Distance (m) to the nearest narrow-valley floor cell (S43). */
  readonly narrowDist: Float32Array;
  readonly narrowNearest: Int32Array;
  /** Distance (m) to the nearest recently burnt cell (timeSinceFire ≤ 5 yr) and its index; refreshed with the fuel. */
  readonly recentDist: Float32Array;
  readonly recentNearest: Int32Array;
  wetGullyCells: Int32Array;
  breakCells: Int32Array;
  /** Slope cells (≥ 10°, within 500 m of a ridge, subsampled) for the mountain-wave lee/windward medians. */
  readonly ridgeSlopeCells: Int32Array;
  /** Lee of the Great Dividing Range (foehn note). */
  readonly leeOfDivide: boolean;
  /** Domain relief (m). */
  readonly relief: number;
  private readonly floorCache = new Map<number, Int32Array>();
  /** Cached gully widths (m) for the narrow-gully note; NaN = not computed. */
  readonly gullyWidth: Float32Array;
  /** Cached crest cell reached by climbing from a ridge cell (−2 = not computed). */
  private readonly crestOf: Int32Array;

  constructor(
    readonly terrain: Terrain,
    readonly derived: TerrainDerived,
    readonly fuel: FuelMap,
    readonly features: TerrainFeatures,
  ) {
    const g = (this.grid = terrain.grid);
    const N = g.nx * g.ny;
    const tiles = (this.tiles = new Tiles(g, P.engine.tileM));
    const z = terrain.elevation;
    this.relief = terrain.maxElevation - terrain.minElevation;
    const origin = g.origin;
    this.leeOfDivide = leeOfDivide(origin.lat, origin.lon);

    // Ridge / saddle lists, ridge representatives.
    const ridge: number[] = [];
    const saddle: number[] = [];
    const narrow: number[] = [];
    this.ridgeRepOfTile = new Int32Array(tiles.count).fill(-1);
    for (let k = 0; k < N; k++) {
      if (features.ridge[k]) {
        ridge.push(k);
        const t = tiles.ofCell(k);
        const r = this.ridgeRepOfTile[t]!;
        if (r < 0 || z[k]! > z[r]!) this.ridgeRepOfTile[t] = k;
      }
      if (features.saddle[k]) saddle.push(k);
      if (features.narrowValley[k]) narrow.push(k);
    }
    this.ridgeCells = Int32Array.from(ridge);
    this.saddleCells = Int32Array.from(saddle);
    this.narrowValleyCells = Int32Array.from(narrow);
    this.ridgeReps = Int32Array.from(Array.from(this.ridgeRepOfTile).filter((k) => k >= 0));

    // Distance transforms.
    const src = new Uint8Array(N);
    this.ridgeDist = new Float32Array(N);
    this.ridgeNearest = new Int32Array(N);
    for (const k of ridge) src[k] = 1;
    distanceTransform(g, src, this.ridgeDist, this.ridgeNearest);
    src.fill(0);
    for (const k of narrow) src[k] = 1;
    this.narrowDist = new Float32Array(N);
    this.narrowNearest = new Int32Array(N);
    distanceTransform(g, src, this.narrowDist, this.narrowNearest);
    this.recentDist = new Float32Array(N);
    this.recentNearest = new Int32Array(N);

    // Valley floors (for valley-channelling): lowest ≤ 6 per tile with relief ≥ 150 m.
    const perTile = new Map<number, number[]>();
    for (let k = 0; k < N; k++) {
      const isFloor = terrain.landform[k] === Landform.ValleyFloor || derived.heightAboveValley[k]! <= P.valley.floorHavM;
      if (!isFloor || !(derived.localRelief[k]! >= P.valley.minReliefM)) continue;
      const t = tiles.ofCell(k);
      let l = perTile.get(t);
      if (!l) perTile.set(t, (l = []));
      l.push(k);
    }
    const floors: number[] = [];
    for (const t of [...perTile.keys()].sort((a, b) => a - b)) {
      const l = perTile.get(t)!;
      l.sort((a, b) => z[a]! - z[b]! || a - b);
      for (let a = 0; a < Math.min(6, l.length); a++) floors.push(l[a]!);
    }
    this.valleyFloorCells = Int32Array.from(floors);

    // Gully segments.
    this.gullies = this.buildGullies();

    // Ridge-slope sample for mountain waves.
    const rs: number[] = [];
    for (let k = 0; k < N; k += 3) {
      if (!features.ridge[k] && terrain.slopeDeg[k]! >= 10 && this.ridgeDist[k]! <= 500 && Number.isFinite(terrain.aspectDeg[k]!)) rs.push(k);
    }
    this.ridgeSlopeCells = Int32Array.from(rs);
    this.gullyWidth = new Float32Array(N).fill(NaN);
    this.crestOf = new Int32Array(N).fill(-2);

    this.wetGullyCells = new Int32Array(0);
    this.breakCells = new Int32Array(0);
    this.refreshFuel();
  }

  private buildGullies(): GullySegment[] {
    const { terrain, derived, features } = this;
    const z = terrain.elevation;
    const N = z.length;
    const bySeg = new Map<number, number[]>();
    for (let k = 0; k < N; k++) {
      const b = features.gullyBase[k]!;
      if (b < 0 || !(features.trench[k]! >= P.gully.minTrench)) continue;
      let l = bySeg.get(b);
      if (!l) bySeg.set(b, (l = []));
      l.push(k);
    }
    const out: GullySegment[] = [];
    for (const b of [...bySeg.keys()].sort((a, c) => a - c)) {
      const cells = bySeg.get(b)!;
      let zTop = -Infinity;
      for (const k of cells) if (z[k]! > zTop) zTop = z[k]!;
      const zBase = z[b]!;
      const lim = zBase + (zTop - zBase) / 3;
      const lower: number[] = [];
      const steep: number[] = [];
      let axialMax = 0;
      let sx = 0;
      let sy = 0;
      for (const k of cells) {
        if (z[k]! <= lim) {
          lower.push(k);
          const ax = features.gullyAxis[k]!;
          if (Number.isFinite(ax)) {
            sx += Math.sin((ax * Math.PI) / 180);
            sy += Math.cos((ax * Math.PI) / 180);
          }
        }
        const ax = features.gullyAxis[k]!;
        if (!features.drainage[k] || !Number.isFinite(ax)) continue;
        const axial = directionalSlopeDeg(terrain, k, ax);
        if (axial >= P.gully.minAxialSlopeDeg && derived.tpiSmall[k]! <= P.gully.maxTpiSmall) {
          steep.push(k);
          if (axial > axialMax) axialMax = axial;
        }
      }
      if (steep.length < P.gully.minSteepCells) continue;
      const up = sx * sx + sy * sy > 1e-6 ? ((Math.atan2(sx, sy) * 180) / Math.PI + 360) % 360 : NaN;
      out.push({
        base: b,
        zBase,
        zTop,
        cells: Int32Array.from(cells),
        lowerThird: Int32Array.from(lower),
        steep: Int32Array.from(steep),
        axialMax,
        upAzimuth: up,
      });
    }
    return out;
  }

  /** Recompute the fuel-dependent caches (recent burns, wet gullies, fuel breaks); call after fuel edits. */
  refreshFuel(): void {
    const { terrain, derived, features, fuel, grid } = this;
    const N = grid.nx * grid.ny;
    const src = new Uint8Array(N);
    const tsf = fuel.timeSinceFire;
    for (let k = 0; k < N; k++) {
      const v = tsf[k]!;
      if (v === v && v <= P.recentBurn.maxYears && fuel.type[k] !== FuelType.NonFuel && fuel.type[k] !== FuelType.Water) src[k] = 1;
    }
    distanceTransform(grid, src, this.recentDist, this.recentNearest);
    const wet: number[] = [];
    const brk: number[] = [];
    const flags = fuel.flags;
    const bw = fuel.breakWidth;
    for (let k = 0; k < N; k++) {
      const t = fuel.type[k]!;
      const wetType = t === FuelType.WetForest || t === FuelType.Rainforest || (flags !== undefined && (flags[k]! & FuelFlag.WetGullyMinority) !== 0);
      if (wetType) {
        const lf = terrain.landform[k];
        const gullyish = features.drainage[k] === 1 || lf === Landform.Gully || lf === Landform.ValleyFloor || derived.tpiSmall[k]! <= P.moistGully.maxTpiSmall;
        if (gullyish) wet.push(k);
      }
      if (bw && bw[k]! > 0) brk.push(k);
    }
    this.wetGullyCells = Int32Array.from(wet);
    this.breakCells = Int32Array.from(brk);
  }

  /** Valley-floor cells (height above valley ≤ 20 m) within 1 km of tile t's centre, ≤ 40 samples (cached). */
  floorCellsNearTile(t: number): Int32Array {
    let r = this.floorCache.get(t);
    if (r) return r;
    const g = this.grid;
    const tiles = this.tiles;
    const cpt = tiles.cellsPerTile;
    const ci = (tiles.tx(t) + 0.5) * cpt;
    const cj = (tiles.ty(t) + 0.5) * cpt;
    const rc = P.thermalBelt.floorRadiusM / g.cellSize;
    const hav = this.derived.heightAboveValley;
    const cand: number[] = [];
    const i0 = Math.max(0, Math.floor(ci - rc));
    const i1 = Math.min(g.nx - 1, Math.ceil(ci + rc));
    const j0 = Math.max(0, Math.floor(cj - rc));
    const j1 = Math.min(g.ny - 1, Math.ceil(cj + rc));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if ((i - ci) ** 2 + (j - cj) ** 2 > rc * rc) continue;
        const k = j * g.nx + i;
        if (hav[k]! <= P.thermalBelt.floorHavM) cand.push(k);
      }
    }
    const step = Math.max(1, Math.ceil(cand.length / 40));
    const pick: number[] = [];
    for (let a = 0; a < cand.length; a += step) pick.push(cand[a]!);
    r = Int32Array.from(pick);
    this.floorCache.set(t, r);
    return r;
  }

  /**
   * The crest line cell for ridge cell r: steepest 8-neighbour ascent (≤ 300 m) from r. Broad ridge masks
   * (relPos ≥ 0.9) include upper flanks; the crest-normal must be taken on the crest itself. Cached.
   */
  crestCell(r: number): number {
    const c = this.crestOf[r]!;
    if (c !== -2) return c;
    const g = this.grid;
    const z = this.terrain.elevation;
    let k = r;
    const steps = Math.ceil(300 / g.cellSize);
    for (let s = 0; s < steps; s++) {
      const j = (k / g.nx) | 0;
      const i = k - j * g.nx;
      let best = k;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ii = i + di;
          const jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= g.nx || jj >= g.ny) continue;
          const q = jj * g.nx + ii;
          if (z[q]! > z[best]! + 1e-3) best = q;
        }
      }
      if (best === k) break;
      k = best;
    }
    this.crestOf[r] = k;
    return k;
  }

  /**
   * Crest-normal of ridge cell r for a wind blowing towards `windTo` (spec §10.1): circular mean aspect of the
   * non-ridge cells within 90 m of r on its windTo side. NaN when none.
   */
  crestNormal(r: number, windTo: number): number {
    // Spec: non-ridge cells only; where the ridge mask is wider than 90 m (relPos ≥ 0.9 bands on broad crests)
    // fall back to every sloping cell on the windTo side.
    const a = this.meanAspect(r, windTo, true);
    return a === a ? a : this.meanAspect(r, windTo, false);
  }

  private meanAspect(r: number, windTo: number, nonRidgeOnly: boolean): number {
    const g = this.grid;
    const { nx, ny, cellSize: h } = g;
    const rc = Math.max(1, Math.round(P.ridgeCrest.normalRadiusM / h));
    const jr = (r / nx) | 0;
    const ir = r - jr * nx;
    const wx = Math.sin((windTo * Math.PI) / 180);
    const wy = Math.cos((windTo * Math.PI) / 180);
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let dj = -rc; dj <= rc; dj++) {
      const j = jr + dj;
      if (j < 0 || j >= ny) continue;
      for (let di = -rc; di <= rc; di++) {
        const i = ir + di;
        if (i < 0 || i >= nx || di * di + dj * dj > rc * rc) continue;
        if (di * wx + dj * wy <= 0) continue; // windTo side only
        const k = j * nx + i;
        if (nonRidgeOnly && this.features.ridge[k]) continue;
        const a = this.terrain.aspectDeg[k]!;
        if (!Number.isFinite(a)) continue;
        sx += Math.sin((a * Math.PI) / 180);
        sy += Math.cos((a * Math.PI) / 180);
        n++;
      }
    }
    if (n === 0 || sx * sx + sy * sy < 1e-6 * n * n) return NaN;
    return ((Math.atan2(sx, sy) * 180) / Math.PI + 360) % 360;
  }

  /**
   * Width (m) of the trench at drainage cell k: distance between the wall crests found by marching perpendicular to
   * the gully axis on both sides up to 300 m (spec §10.2 general/narrow-gully). Cached.
   */
  trenchWidth(k: number): number {
    const c = this.gullyWidth[k]!;
    if (c === c) return c;
    const ax = this.features.gullyAxis[k]!;
    if (!Number.isFinite(ax)) {
      this.gullyWidth[k] = Infinity;
      return Infinity;
    }
    const g = this.grid;
    const z = this.terrain.elevation;
    const j0 = (k / g.nx) | 0;
    const i0 = k - j0 * g.nx;
    const maxSteps = Math.ceil(P.general.narrowGullySearchM / g.cellSize);
    let width = 0;
    for (const side of [90, -90]) {
      const r = ((ax + side) * Math.PI) / 180;
      const ux = Math.sin(r);
      const uy = Math.cos(r);
      let zPrev = z[k]!;
      let d = maxSteps * g.cellSize;
      for (let s = 1; s <= maxSteps; s++) {
        const i = Math.round(i0 + ux * s);
        const j = Math.round(j0 + uy * s);
        if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) {
          d = s * g.cellSize;
          break;
        }
        const zz = z[j * g.nx + i]!;
        // The wall top: where the rise per step drops below tan 5° (flattened) or the terrain falls.
        if (zz - zPrev < 0.0875 * g.cellSize) {
          d = (s - 1) * g.cellSize;
          break;
        }
        zPrev = zz;
      }
      width += d;
    }
    this.gullyWidth[k] = width;
    return width;
  }
}
