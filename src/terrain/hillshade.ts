/**
 * Hillshading for rendering (terrain texture, 2-D overview map, printouts).
 *
 * Standard Lambertian hillshade (Horn 1981 gradients as stored in {@link Terrain.dzdx}/{@link Terrain.dzdy}):
 *   shade = n̂ · ŝ = [cos(Z) − tan(S)·… ] expressed with vectors: n = (−p, −q, 1)/√(1+p²+q²), ŝ = light direction,
 * where p = ∂z/∂x (east) and q = ∂z/∂y (north). The result is clamped to 0–1 (0 = facing away from the light).
 *
 * The multi-directional variant blends four light azimuths (225°, 270°, 315°, 360°) with aspect-dependent weights
 * cos²(aspect − azimuth) (Mark 1992, as in GDAL's `-multidirectional`), so slopes of every orientation keep
 * contrast and the relief reads well without the "inverted relief" illusion of a single light.
 */
import type { Terrain } from '../core/types';
import { DEG } from '../core/units';

/** Light direction unit vector (east, north, up) from a compass azimuth and elevation angle (deg). */
function lightVector(azimuthDeg: number, elevationDeg: number): [number, number, number] {
  const a = azimuthDeg * DEG;
  const e = elevationDeg * DEG;
  return [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)];
}

/**
 * Single-light hillshade, 0–1.
 * @param azimuth    compass azimuth the light comes FROM (deg), default 315 (north-west, cartographic convention)
 * @param elevation  light elevation above the horizon (deg), default 45
 * @param zFactor    vertical exaggeration applied to the gradients (default 1)
 */
export function hillshade(terrain: Terrain, azimuth = 315, elevation = 45, zFactor = 1): Float32Array {
  const { dzdx, dzdy } = terrain;
  const n = dzdx.length;
  const out = new Float32Array(n);
  const [lx, ly, lz] = lightVector(azimuth, elevation);
  for (let k = 0; k < n; k++) {
    const p = dzdx[k]! * zFactor;
    const q = dzdy[k]! * zFactor;
    const v = (lz - p * lx - q * ly) / Math.sqrt(1 + p * p + q * q);
    out[k] = v > 0 ? v : 0;
  }
  return out;
}

export interface MultiHillshadeOptions {
  /** Light azimuths (deg). Default [225, 270, 315, 360]. */
  azimuths?: number[];
  /** Light elevation (deg). Default 30 (Mark 1992 / GDAL). */
  elevation?: number;
  zFactor?: number;
  /** 'aspect' (default): weight each light by cos²(aspect − azimuth); 'equal': plain average. */
  weighting?: 'aspect' | 'equal';
}

/** Multi-directional, aspect-weighted hillshade, 0–1. */
export function multiHillshade(terrain: Terrain, opts: MultiHillshadeOptions = {}): Float32Array {
  const azimuths = opts.azimuths ?? [225, 270, 315, 360];
  const elevation = opts.elevation ?? 30;
  const zf = opts.zFactor ?? 1;
  const aspectWeighted = (opts.weighting ?? 'aspect') === 'aspect';
  const { dzdx, dzdy } = terrain;
  const n = dzdx.length;
  const m = azimuths.length;
  const L = azimuths.map((a) => lightVector(a, elevation));
  // Horizontal unit vectors of each light, for the cos² weights.
  const hx = azimuths.map((a) => Math.sin(a * DEG));
  const hy = azimuths.map((a) => Math.cos(a * DEG));
  const out = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const p = dzdx[k]! * zf;
    const q = dzdy[k]! * zf;
    const g2 = p * p + q * q;
    const inv = 1 / Math.sqrt(1 + g2);
    let acc = 0;
    let wsum = 0;
    for (let d = 0; d < m; d++) {
      const l = L[d]!;
      let v = (l[2] - p * l[0] - q * l[1]) * inv;
      if (v < 0) v = 0;
      // cos²(aspect − az) = ((∇z · ĥ)²) / |∇z|² (sign irrelevant). Equal weights on flat cells.
      let w = 1;
      if (aspectWeighted && g2 > 1e-12) {
        const c = p * hx[d]! + q * hy[d]!;
        w = (c * c) / g2 + 1e-3;
      }
      acc += w * v;
      wsum += w;
    }
    out[k] = acc / wsum;
  }
  return out;
}
