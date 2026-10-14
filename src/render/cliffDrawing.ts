/**
 * What the 3-D view draws the ground from when the scenario has a 10 m terrain (plan 9d.3; pure, no Three.js, no DOM).
 *
 * One place for the order of the cliff modules, so the view and the tests run the same pipeline:
 *   1. sharpen the 10 m terrain along the fall line ({@link cliffSharpen});
 *   2. the render mesh from the sharpened terrain, which keeps an edge and has no single-vertex spikes ({@link decimateTerrain});
 *   3. the mesh's own gradient (`lightTerrain`: the hillshade, sky view and cast shadows follow it) and, from it, the slope
 *      that picks banded rock or the photo. Spike S5: that slope must come from the MESH, because the 10 m slope disagrees
 *      with a 22 or 40 m triangle by up to one vertex spacing and the photo-versus-rock switch draws the disagreement as
 *      spikes along the lip and foot;
 *   4. the lighting gradient, from the sharpened 10 m terrain: the shader's normals (the relief, which is real);
 *   5. the rock mask, with R from the mesh's slope, and the CPU copy of R that tree placement reads.
 * Everything here is for drawing. The simulation, the slope overlay, the elevation numbers and the cards read the terrain as
 * received (plan section 4, rule 10): nothing in the result goes to them.
 */
import { sampleBilinear, type GridSpec } from '../core/grid';
import type { FuelMap, Terrain } from '../core/types';
import { cliffSharpen } from './cliffSharpen';
import { hornGradient, lightTerrain, type RenderGrid } from './fields';
import { buildRockMask, rockCopy, type RockCopy, type RockField, type RockMask } from './rockMask';
import { MESH_DESPIKE_M, decimateTerrain } from './terrainMesh';

/** The picture-quality tiers (SceneView's `RenderQuality`). */
export type DetailTier = 'high' | 'medium' | 'low';

/** The six rock effects of plan 9d.3.5, by name. */
export interface RockDetailFlags {
  /** (a) ledges: a stepped profile of height that perturbs the normal as well as the colour. */
  ledges: boolean;
  /** (b) vertical joints: thin dark cracks along the face. */
  joints: boolean;
  /** (c) overhang bands: darker ambient under each ledge. */
  overhang: boolean;
  /** (d) water stains: noise stretched along height, ochre and dark. */
  stains: boolean;
  /** (e) scree (G): coarse grey-brown speckle below a face. */
  scree: boolean;
  /** (f) lip pavement (B): pale rock patches with a heath tint on the flat top of a face. */
  pavement: boolean;
}

/** Which effects a picture-quality tier draws: High all six, Medium drops (b) and (c), Low keeps (a), (d) and (e). */
export function rockDetailFlags(tier: DetailTier): RockDetailFlags {
  return {
    ledges: true,
    joints: tier === 'high',
    overhang: tier === 'high',
    stains: true,
    scree: true,
    pavement: tier !== 'low',
  };
}

/**
 * Shader defines of the terrain layer for a tier: CLIFF (the rock mask and the mesh slope are there) and one RD_* per effect the tier
 * draws. An overhang is measured from the ledges' phase, so it needs them.
 */
export function cliffDefines(tier: DetailTier): Record<string, number> {
  const f = rockDetailFlags(tier);
  const d: Record<string, number> = { CLIFF: 1 };
  if (f.ledges) d['RD_LEDGES'] = 1;
  if (f.ledges && f.overhang) d['RD_OVERHANG'] = 1;
  if (f.joints) d['RD_JOINTS'] = 1;
  if (f.stains) d['RD_STAINS'] = 1;
  if (f.scree) d['RD_SCREE'] = 1;
  if (f.pavement) d['RD_PAVEMENT'] = 1;
  return d;
}

/** How many of the six effects a tier draws (6, 4 or 3). */
export const rockDetailCount = (tier: DetailTier): number => Object.values(rockDetailFlags(tier)).filter(Boolean).length;

/**
 * How much of the rock detail's normal perturbation stays under the Plain map type and a solo heat map (plan 9d.3.5: "normal-based
 * lighting at about 40 %"), so the overlay's colours read on the shape of the land and the ledges only shade it.
 */
export const ROCK_DETAIL_PLAIN = 0.4;

/**
 * The slope band (deg) that rock R follows on the MESH's slope, by tier. The mask's default band (52 to 62) is for a 10 m slope; the
 * mesh's slope is smoothed over about three vertices (45 m at High, 120 m at Low), so a face reads gentler on a coarser mesh and the
 * same band finds less of it: cells with R of 0.5 or more at Tomah are 503 from the 10 m slope and 396, 224 and 0 from the High, Medium
 * and Low meshes (the verifier's count of the default band). Each tier's band is lowered by 3 degrees a step. Measured on the four
 * sites against the 10 m rock: at least 96 % of the mesh's rock is within 30 m of it, and 73 % (Kanangra, Low; Tomah, Low 75 %) to
 * 96 % of the 10 m rock is within 30 m of the mesh's, where the default band gives 37 % and 0 %. The rock then covers the face the
 * mesh draws, which is about one vertex spacing wider than the 10 m face.
 */
export const MESH_ROCK_BAND_DEG: Readonly<Record<DetailTier, { loDeg: number; hiDeg: number }>> = Object.freeze({
  high: { loDeg: 48, hiDeg: 58 },
  medium: { loDeg: 45, hiDeg: 55 },
  low: { loDeg: 42, hiDeg: 52 },
});

/**
 * The canopy cover that takes rock away (plan 9d.3.4: R = slope x (1 - cover)), on the mesh's grid, and less of it where the mesh is
 * steep: cover x (1 - smoothstep(hiDeg - 2, hiDeg + 8, mesh slope)), so the cover is half gone where the band is complete and all gone
 * 8 degrees above it. The canopy raster is a top-down 20 m product and cannot see a face: of the sharpened 10 m cells steeper than
 * 75 degrees (a wall), 53 to 60 % at Katoomba, Kanangra and Grose and 90 % at Tomah have cover of 0.5 or more, so with the plain rule
 * most of a drawn wall is "forest": no rock detail, trees stood on it and the photo smeared down it. A wall is rock whatever the
 * raster says; a steep slope that is not a wall (under the band) keeps the plan's rule, and the simulation, which never sees this field,
 * keeps the cover (H-sim, 0.3.1).
 */
function coverOnMesh(fuel: CliffDrawingInput['fuel'], mesh: RenderGrid, slopeDeg: Float32Array, band: { loDeg: number; hiDeg: number }): RockField {
  const g = mesh.grid;
  const out = new Float32Array(g.nx * g.ny);
  const from = band.hiDeg - 2;
  const span = 10;
  for (let j = 0, k = 0; j < g.ny; j++) {
    const y = g.y0 + j * g.cellSize;
    for (let i = 0; i < g.nx; i++, k++) {
      const t = Math.min(1, Math.max(0, (slopeDeg[k]! - from) / span));
      const cover = sampleBilinear(fuel.grid, fuel.canopyCover, g.x0 + i * g.cellSize, y);
      out[k] = cover * (1 - t * t * (3 - 2 * t));
    }
  }
  return { grid: g, values: out };
}

export interface CliffDrawingInput {
  /** The scenario's 10 m terrain, as received. It is never modified. */
  hi: { grid: GridSpec; elevation: Float32Array };
  /** The fuel map (canopy cover removes rock, and rock never carries trees). */
  fuel: Pick<FuelMap, 'grid' | 'canopyCover'>;
  /** Most samples per side of the render mesh (the tier's budget). */
  meshN: number;
  tier: DetailTier;
  /** `Terrain.source`, carried onto the mesh's lighting terrain. */
  source: string;
}

/** What a build produced and how long each stage took (wall ms); {@link TerrainDrawStats} less the detail tier, which is the layer's. */
export interface CliffBuildStats {
  /** Share (0 to 1) of the 10 m cells the sharpening moved by 0.5 m or more. */
  sharpenedShare: number;
  sharpenMs: number;
  maskMs: number;
  meshMs: number;
  /** The CPU side of the lighting gradient (the 10 m Horn gradient); the texture fill is the layer's. */
  gradientMs: number;
  meshVertices: number;
  meshTriangles: number;
}

export interface CliffDrawing {
  /** The render mesh, from the sharpened terrain (the grid is the one `decimateGrid` gives). */
  mesh: RenderGrid;
  /** The mesh as a lighting terrain (Horn gradients, slope): hillshade, sky view and cast shadows are computed from it. */
  lightT: Terrain;
  /** The shader's normals: the Horn gradient of the sharpened 10 m terrain, on the 10 m grid. */
  gradient: { grid: GridSpec; dzdx: Float32Array; dzdy: Float32Array };
  /** Gradient magnitude (tan of the slope) of the MESH at every vertex: what picks banded rock or the photo. */
  meshSlope: Float32Array;
  mask: RockMask;
  /** The CPU copy of R for tree placement. */
  rock: RockCopy;
  stats: CliffBuildStats;
}

/** Run the pipeline in the file header. Reads only its input; the sharpened terrain is not kept (the caller never sees it). */
export function buildCliffDrawing(i: CliffDrawingInput): CliffDrawing {
  const { hi } = i;
  const sharp = cliffSharpen(hi.grid, hi.elevation);

  let t = performance.now();
  const mesh = decimateTerrain(hi.grid, sharp.elevation, i.meshN, { despikeM: MESH_DESPIKE_M[i.tier] });
  const meshMs = performance.now() - t;

  const lightT = lightTerrain(mesh, i.source);
  const meshSlope = new Float32Array(mesh.grid.nx * mesh.grid.ny);
  for (let k = 0; k < meshSlope.length; k++) meshSlope[k] = Math.hypot(lightT.dzdx[k]!, lightT.dzdy[k]!);

  t = performance.now();
  const gradient = { grid: hi.grid, ...hornGradient(hi.grid, sharp.elevation) };
  const gradientMs = performance.now() - t;

  // R follows the mesh's slope (it is what is drawn), with the cover that a wall overrides; the scree and pavement windows follow the 10 m slope of the sharpened terrain, the
  // mask's own default: the mesh's slope would start the pavement a vertex spacing from the lip.
  t = performance.now();
  const band = MESH_ROCK_BAND_DEG[i.tier];
  const cover = coverOnMesh(i.fuel, mesh, lightT.slopeDeg, band);
  const coverMs = performance.now() - t;
  const mask = buildRockMask({ grid: hi.grid, elevation: sharp.elevation, slope: { grid: mesh.grid, values: lightT.slopeDeg }, cover }, band);

  return {
    mesh,
    lightT,
    gradient,
    meshSlope,
    mask,
    rock: rockCopy(mask),
    stats: {
      sharpenedShare: sharp.stats.moved / (hi.grid.nx * hi.grid.ny),
      sharpenMs: sharp.stats.ms.total,
      maskMs: mask.stats.ms + coverMs,
      meshMs,
      gradientMs,
      meshVertices: mesh.grid.nx * mesh.grid.ny,
      meshTriangles: 2 * (mesh.grid.nx - 1) * (mesh.grid.ny - 1),
    },
  };
}
