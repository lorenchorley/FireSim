/**
 * The "3-D forest": one instanced low-poly mesh per vegetation group (eucalypt, rainforest, conifer, shrub, grass),
 * i.e. five draw calls for up to 60 000 instances.
 *
 * Fire state is resolved ON THE GPU: the vertex shader reads the fire arrival and aux (burn state / Vesta phase)
 * textures at each instance's position and the interpolated display time, so trees scorch, torch and lose their crowns
 * exactly when the front passes, with no per-snapshot CPU work:
 *   burning            crown fire (phase 3) → crown glows and flickers (torching); otherwise the trunk base glows
 *   burnt, phase 3     crown gone, black trunk
 *   burnt, phase 2     scorched brown crown, black lower trunk
 *   burnt, phase ≤ 1   crown slightly browned, charred trunk base
 *   shrubs and grass   consumed (hidden) once burnt
 * Culling happens per instance at the top of the vertex shader (before any texture fetch): tiny instances
 * (< ~1.2 px tall), a distance-dependent random thinning in wide views, and instances whose bounding sphere is outside
 * the view frustum.
 *
 * Near LOD: the few thousand eucalypt / rainforest trees within ~280 m of the camera (eye-level and low views) are
 * drawn with detailed models (forking trunk, branches, 5–7 irregular leaf clumps ≈ 180 triangles) instead of the
 * 20–40-triangle far models, and close-up crowns get a procedural leaf-cluster texture. The split is recomputed when
 * the camera settles (splitLod), at most two extra draw calls.
 */
import * as THREE from 'three';
import { FOG, NOISE, TONEMAP } from './glsl';
import { VEG_GROUP_COUNT, VegGroup, type VegInstances } from './vegetationPlacement';

const VEG_VERT = /* glsl */ `
${NOISE}
uniform float uVex;
uniform float uTime;
uniform float uClock;
uniform float uHasFire;
uniform float uBurnBand;
uniform sampler2D uArrival;
uniform sampler2D uFireAux;
uniform vec4 uFireXf;
uniform sampler2D uGlow;
uniform vec4 uGlowXf;
uniform float uConsumable;
uniform float uPxPerRad;
uniform float uCullPx;
uniform float uThinStart;
uniform float uNearCull;
uniform vec3 uTrunk;
attribute float aPart;
attribute vec3 aInst;
attribute vec2 aSize;
attribute vec2 aRand;
attribute vec3 aTint;
varying vec3 vN;
varying vec3 vCol;
varying float vFlame;
varying float vGlow;
varying float vDist;
varying float vPart;
varying vec3 vLeaf;
void main() {
  vec3 base = vec3(aInst.x, aInst.z * uVex, -aInst.y);
  float dist = distance(base, cameraPosition);
  // Instance-wide culling decided FIRST, so culled instances skip the fire-texture fetches below (every vertex of an
  // instance takes the same branch, so whole instances disappear):
  //   screen size < uCullPx, distance thinning, the eye-level near cull, and a per-instance frustum test on the
  //   instance's bounding sphere (the meshes are drawn with frustumCulled = false, one draw call per group).
  float px = aSize.x / max(dist, 1.0) * uPxPerRad;
  float keep = clamp(uThinStart / max(dist, 1.0), 0.25, 1.0);
  // Thinning draw, decorrelated from aRand.y (which sets the height: thinning by it would remove the tallest trees first).
  float thin = fract(aRand.x * 97.13 + aRand.y * 13.71);
  float rad = 0.5 * max(aSize.x, aSize.y);
  vec4 cv = viewMatrix * vec4(base + vec3(0.0, 0.5 * aSize.x, 0.0), 1.0);
  float depth = -cv.z;
  bool outside = depth < -rad || abs(cv.x) > depth / projectionMatrix[0][0] + rad * 1.5 || abs(cv.y) > depth / projectionMatrix[1][1] + rad * 1.5;
  if (px < uCullPx || thin > keep || dist < uNearCull || outside) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }
  bool culled = false;

  // Fire state at the instance.
  float burnt = 0.0;
  float burning = 0.0;
  float phase = 0.0;
  if (uHasFire > 0.5) {
    vec2 uv = (aInst.xy - uFireXf.xy) / uFireXf.zw;
    if (uv.x >= 0.0 && uv.y >= 0.0 && uv.x <= 1.0 && uv.y <= 1.0) {
      ivec2 sz = textureSize(uArrival, 0);
      ivec2 c = clamp(ivec2(floor(uv * vec2(sz))), ivec2(0), sz - 1);
      float ta = texelFetch(uArrival, c, 0).r;
      vec4 aux = texelFetch(uFireAux, c, 0);
      // Only cells the model marked burnt/burning (not the halo estimates ahead of the front).
      int st = int(aux.r * 255.0 + 0.5);
      if (ta < 1e29 && (st == 1 || st == 2)) {
        float dt = uTime - ta + (aRand.x - 0.5) * 40.0;
        phase = floor(aux.g * 255.0 + 0.5);
        burning = dt >= 0.0 && dt <= uBurnBand ? 1.0 : 0.0;
        burnt = dt > uBurnBand * 0.6 ? 1.0 : 0.0;
      }
    }
  }
  vec3 lp = position;
  float crown = step(0.5, aPart);
  if (uConsumable > 0.5 && burnt > 0.5) culled = true;
  // Crown fire: the crown is consumed.
  if (crown > 0.5 && burnt > 0.5 && phase >= 2.5) lp = vec3(0.0, lp.y * 0.6, 0.0);
  float ang = aRand.x * 6.2831853;
  float cs = cos(ang);
  float sn = sin(ang);
  vec3 sp = vec3(lp.x * aSize.y, lp.y * aSize.x, lp.z * aSize.y);
  sp = vec3(cs * sp.x - sn * sp.z, sp.y, sn * sp.x + cs * sp.z);
  // Gentle sway of crowns.
  sp.x += crown * sin(uClock * 1.3 + aRand.x * 40.0) * 0.012 * aSize.x * lp.y;
  vec3 world = base + sp;
  vec3 nn = normal / vec3(aSize.y, aSize.x, aSize.y);
  nn = vec3(cs * nn.x - sn * nn.z, nn.y, sn * nn.x + cs * nn.z);
  vN = normalize(nn);

  // Colour.
  vec3 tint = pow(aTint, vec3(2.2)); // sRGB bytes → linear
  vec3 col = mix(uTrunk, tint, crown);
  float h01 = clamp(lp.y, 0.0, 1.0);
  if (burnt > 0.5) {
    vec3 charC = vec3(0.035, 0.03, 0.028);
    if (crown > 0.5) {
      // Scorched eucalypt crowns turn copper-brown (phase 2); after a surface fire they are only partly browned.
      vec3 scorch = phase >= 1.5 ? vec3(0.12, 0.05, 0.018) : mix(tint, vec3(0.11, 0.065, 0.025), 0.5);
      col = scorch;
    } else {
      // Char height grows with the fire phase.
      float charTop = phase >= 2.5 ? 1.1 : phase >= 1.5 ? 0.6 : 0.3;
      col = mix(col, charC, step(h01, charTop));
    }
  }
  vFlame = 0.0;
  if (burning > 0.5) {
    float fl = fsNoise(vec2(aRand.x * 50.0, uClock * 3.0));
    if (crown > 0.5 && phase >= 2.5) vFlame = 0.6 + 0.8 * fl;
    else if (crown < 0.5) vFlame = (1.0 - smoothstep(0.0, 0.35, h01)) * (0.5 + 0.6 * fl);
  }
  vCol = col;
  vec2 guv = (aInst.xy - uGlowXf.xy) / uGlowXf.zw;
  vGlow = uHasFire > 0.5 ? texture(uGlow, guv).r : 0.0;
  vPart = crown;
  vLeaf = sp + aRand.x * 31.0; // metres in the instance frame, offset per tree: seeds the foliage texture
  vec4 mv = viewMatrix * vec4(world, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
  if (culled) gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
}
`;

const VEG_FRAG = /* glsl */ `
${NOISE}
${TONEMAP}
${FOG}
uniform vec3 uSunDir; uniform vec3 uSunColour; uniform float uSunI;
uniform vec3 uSkyAmb; uniform vec3 uGroundAmb; uniform float uAmbI; uniform float uGlowGain;
varying vec3 vN;
varying vec3 vCol;
varying float vFlame;
varying float vGlow;
varying float vDist;
varying float vPart;
varying vec3 vLeaf;
void main() {
  vec3 n = normalize(gl_FrontFacing ? vN : -vN);
  // Close up, break the flat facets of the crowns into leaf clusters (≈ 0.7 m clumps with darker gaps) and add bark
  // streaks to trunks; faded out beyond ~250 m where a crown is only a few pixels.
  float nearF = 1.0 - smoothstep(60.0, 250.0, vDist);
  float leafVar = 1.0;
  if (nearF > 0.0) {
    float l = fsNoise(vLeaf.xz * 1.4 + vLeaf.y * 0.9) * 0.65 + fsNoise(vLeaf.xy * 3.1 - vLeaf.z * 1.7) * 0.35;
    float bark = fsNoise(vec2((vLeaf.x + vLeaf.z) * 6.0, vLeaf.y * 0.35));
    leafVar = mix(1.0, vPart > 0.5 ? 0.55 + 0.8 * smoothstep(0.2, 0.8, l) : 0.75 + 0.5 * bark, nearF);
  }
  // Wrapped diffuse for foliage (light scatters through crowns).
  float wrap = vPart > 0.5 ? 0.45 : 0.1;
  float ndl = clamp((dot(n, uSunDir) + wrap) / (1.0 + wrap), 0.0, 1.0);
  vec3 amb = mix(uGroundAmb, uSkyAmb, 0.5 + 0.5 * n.y) * uAmbI;
  vec3 glow = vec3(1.0, 0.36, 0.09) * vGlow * vGlow * uGlowGain * 1.3;
  // Crowns self-shade: undersides and the inner parts of clumps are darker.
  float ao = vPart > 0.5 ? 0.55 + 0.45 * (0.5 + 0.5 * n.y) : 0.8;
  vec3 col = vCol * leafVar * (uSunColour * uSunI * ndl * 0.85 + amb * 0.8 * ao + glow) / LIGHT_REF * (vPart > 0.5 ? 0.85 : 1.0);
  vec3 ldr = fsDisplay(col) + fsTonemap(vec3(1.0, 0.36, 0.06) * vFlame * 2.2);
  ldr = fsFog(ldr, vDist);
  gl_FragColor = vec4(ldr, 1.0);
  #include <colorspace_fragment>
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Low-poly geometry (unit space: crown width 1 in x/z, height 1 in y)
// ─────────────────────────────────────────────────────────────────────────────

interface Builder {
  pos: number[];
  nor: number[];
  part: number[];
  idx: number[];
}

function vert(b: Builder, p: readonly number[], n: readonly number[], part: number): number {
  b.pos.push(p[0]!, p[1]!, p[2]!);
  b.nor.push(n[0]!, n[1]!, n[2]!);
  b.part.push(part);
  return b.pos.length / 3 - 1;
}

/** Squashed, jittered octahedron "clump" with spherical normals: 6 shared vertices, 8 triangles. */
function clump(b: Builder, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, jitter: number): void {
  const v: [number, number, number][] = [
    [cx + rx, cy, cz + jitter * rz],
    [cx - rx, cy + jitter * ry, cz],
    [cx, cy + ry, cz],
    [cx, cy - ry * 0.8, cz],
    [cx - jitter * rx, cy, cz + rz],
    [cx, cy - jitter * ry, cz - rz],
  ];
  const base = b.pos.length / 3;
  for (const p of v) {
    const nx = (p[0] - cx) / rx;
    const ny = (p[1] - cy) / ry;
    const nz = (p[2] - cz) / rz;
    const l = Math.hypot(nx, ny, nz) || 1;
    vert(b, p, [nx / l, ny / l, nz / l], 1);
  }
  const f = [0, 2, 4, 4, 2, 1, 1, 2, 5, 5, 2, 0, 4, 3, 0, 1, 3, 4, 5, 3, 1, 0, 3, 5];
  for (const i of f) b.idx.push(base + i);
}

/** Triangular trunk prism (6 triangles, flat-shaded sides) from y0 to y1 with radii r0 → r1 (unit space). */
function trunk(b: Builder, r0: number, r1: number, y0: number, y1: number): void {
  for (let s = 0; s < 3; s++) {
    // Angles run 0 → 2π without wrapping, so the mid-angle (face normal) of the last side is 300°, not 120°.
    const t0 = (s * 2 * Math.PI) / 3;
    const t1 = ((s + 1) * 2 * Math.PI) / 3;
    const tm = (t0 + t1) / 2;
    const n = [Math.cos(tm), 0, Math.sin(tm)];
    const i0 = vert(b, [Math.cos(t0) * r0, y0, Math.sin(t0) * r0], n, 0);
    const i1 = vert(b, [Math.cos(t1) * r0, y0, Math.sin(t1) * r0], n, 0);
    const i2 = vert(b, [Math.cos(t1) * r1, y1, Math.sin(t1) * r1], n, 0);
    const i3 = vert(b, [Math.cos(t0) * r1, y1, Math.sin(t0) * r1], n, 0);
    b.idx.push(i0, i2, i1, i0, i3, i2);
  }
}

/** Crossed grass blades fanning out (double-sided material). */
function blades(b: Builder, n: number): void {
  for (let s = 0; s < n; s++) {
    const a = (s / n) * Math.PI + 0.3;
    const dx = Math.cos(a) * 0.5;
    const dz = Math.sin(a) * 0.5;
    const lean = s % 2 === 0 ? 0.25 : -0.25;
    const up = [0, 1, 0];
    const i0 = vert(b, [-dx * 0.3, 0, -dz * 0.3], up, 1);
    const i1 = vert(b, [dx * 0.3, 0, dz * 0.3], up, 1);
    const i2 = vert(b, [dx * lean + dz * 0.2, 1, dz * lean - dx * 0.2], up, 1);
    const i3 = vert(b, [-dx, 0.05, -dz], up, 1);
    const i4 = vert(b, [dx, 0.05, dz], up, 1);
    const i5 = vert(b, [dz * 0.3, 0.85, -dx * 0.3], up, 1);
    b.idx.push(i0, i1, i2, i3, i4, i5);
  }
}

/** Cone (pine crown): flat-shaded sides. */
function cone(b: Builder, y0: number, y1: number, r: number, sides: number): void {
  const slope = r / (y1 - y0);
  const l = Math.hypot(1, slope);
  for (let s = 0; s < sides; s++) {
    const t0 = (s / sides) * Math.PI * 2;
    const t1 = ((s + 1) / sides) * Math.PI * 2;
    const tm = (t0 + t1) / 2;
    const i0 = vert(b, [Math.cos(t0) * r, y0, Math.sin(t0) * r], [Math.cos(t0) / l, slope / l, Math.sin(t0) / l], 1);
    const i1 = vert(b, [0, y1, 0], [Math.cos(tm) / l, slope / l, Math.sin(tm) / l], 1);
    const i2 = vert(b, [Math.cos(t1) * r, y0, Math.sin(t1) * r], [Math.cos(t1) / l, slope / l, Math.sin(t1) / l], 1);
    b.idx.push(i0, i1, i2);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Near-LOD geometry (trees within a few hundred metres of the camera, e.g. the eye-level view)
// ─────────────────────────────────────────────────────────────────────────────

/** Deterministic 0–1 jitter for geometry building. */
const jit = (a: number, b: number): number => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Push a triangle, flipping it if its face normal points against the vertices' (outward) normals. */
function tri(b: Builder, i0: number, i1: number, i2: number): void {
  const P = b.pos;
  const N = b.nor;
  const ax = P[i1 * 3]! - P[i0 * 3]!;
  const ay = P[i1 * 3 + 1]! - P[i0 * 3 + 1]!;
  const az = P[i1 * 3 + 2]! - P[i0 * 3 + 2]!;
  const bx = P[i2 * 3]! - P[i0 * 3]!;
  const by = P[i2 * 3 + 1]! - P[i0 * 3 + 1]!;
  const bz = P[i2 * 3 + 2]! - P[i0 * 3 + 2]!;
  const fx = ay * bz - az * by;
  const fy = az * bx - ax * bz;
  const fz = ax * by - ay * bx;
  let d = 0;
  for (const i of [i0, i1, i2]) d += fx * N[i * 3]! + fy * N[i * 3 + 1]! + fz * N[i * 3 + 2]!;
  if (d >= 0) b.idx.push(i0, i1, i2);
  else b.idx.push(i0, i2, i1);
}

const PHI = (1 + Math.sqrt(5)) / 2;
const ICO_V: [number, number, number][] = [
  [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0], [0, -1, PHI], [0, 1, PHI],
  [0, -1, -PHI], [0, 1, -PHI], [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
];
const ICO_F = [
  0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2,
  6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
];

/**
 * Irregular icosahedral foliage clump (12 vertices, 20 triangles): vertices jittered radially, normals blended
 * between the clump's sphere and the whole crown's dome (`crownC`) so neighbouring clumps shade as one soft crown.
 */
function icoClump(b: Builder, c: readonly number[], r: readonly number[], crownC: readonly number[], seed: number): void {
  const base = b.pos.length / 3;
  const L = Math.hypot(1, PHI);
  ICO_V.forEach((v, i) => {
    const k = 0.78 + 0.4 * jit(seed, i);
    const ux = v[0] / L;
    const uy = v[1] / L;
    const uz = v[2] / L;
    const p = [c[0]! + ux * r[0]! * k, c[1]! + uy * r[1]! * k, c[2]! + uz * r[2]! * k];
    let nx = ux * 0.6 + (p[0]! - crownC[0]!) * 1.2;
    let ny = uy * 0.6 + (p[1]! - crownC[1]!) * 1.6 + 0.15;
    let nz = uz * 0.6 + (p[2]! - crownC[2]!) * 1.2;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    vert(b, p, [nx, ny, nz], 1);
  });
  for (let f = 0; f < ICO_F.length; f += 3) tri(b, base + ICO_F[f]!, base + ICO_F[f + 1]!, base + ICO_F[f + 2]!);
}

/** Tapered, smooth-shaded limb (trunk / branch) from a to e with `sides` sides (part 0 = wood). */
function limb(b: Builder, a: readonly number[], e: readonly number[], r0: number, r1: number, sides: number): void {
  const ax = e[0]! - a[0]!;
  const ay = e[1]! - a[1]!;
  const az = e[2]! - a[2]!;
  const al = Math.hypot(ax, ay, az) || 1;
  const d = [ax / al, ay / al, az / al];
  // Perpendicular basis (u, v) of the limb axis.
  const ref = Math.abs(d[1]!) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let u = [d[1]! * ref[2]! - d[2]! * ref[1]!, d[2]! * ref[0]! - d[0]! * ref[2]!, d[0]! * ref[1]! - d[1]! * ref[0]!];
  const ul = Math.hypot(u[0]!, u[1]!, u[2]!);
  u = u.map((x) => x / ul);
  const v = [d[1]! * u[2]! - d[2]! * u[1]!, d[2]! * u[0]! - d[0]! * u[2]!, d[0]! * u[1]! - d[1]! * u[0]!];
  const ring0: number[] = [];
  const ring1: number[] = [];
  for (let s = 0; s < sides; s++) {
    const t = (s / sides) * Math.PI * 2;
    const n = [0, 1, 2].map((q) => Math.cos(t) * u[q]! + Math.sin(t) * v[q]!);
    ring0.push(vert(b, [a[0]! + n[0]! * r0, a[1]! + n[1]! * r0, a[2]! + n[2]! * r0], n, 0));
    ring1.push(vert(b, [e[0]! + n[0]! * r1, e[1]! + n[1]! * r1, e[2]! + n[2]! * r1], n, 0));
  }
  for (let s = 0; s < sides; s++) {
    const s1 = (s + 1) % sides;
    tri(b, ring0[s]!, ring0[s1]!, ring1[s1]!);
    tri(b, ring0[s]!, ring1[s1]!, ring1[s]!);
  }
}

/**
 * Detailed geometry for the near LOD (≈ 170–190 triangles): a leaning, forking trunk with branches reaching into an
 * open crown of irregular leaf clumps (eucalypt), or a dense rounded crown on a short buttressed trunk (rainforest).
 * Groups without a detailed model return null.
 */
export function vegetationDetailGeometry(group: VegGroup): THREE.BufferGeometry | null {
  const b: Builder = { pos: [], nor: [], part: [], idx: [] };
  if (group === VegGroup.Eucalypt) {
    const crownC = [0.02, 0.74, 0];
    limb(b, [0, 0, 0], [0.025, 0.34, 0.01], 0.055, 0.04, 6);
    limb(b, [0.025, 0.34, 0.01], [0.045, 0.6, -0.01], 0.04, 0.024, 6);
    limb(b, [0.03, 0.42, 0.005], [0.24, 0.66, 0.1], 0.022, 0.01, 4);
    limb(b, [0.035, 0.47, 0], [-0.2, 0.7, -0.13], 0.02, 0.009, 4);
    limb(b, [0.04, 0.52, -0.005], [0.03, 0.68, -0.27], 0.017, 0.008, 4);
    const clumps: [number, number, number, number, number][] = [
      [0.04, 0.88, 0.0, 0.26, 0.15],
      [0.27, 0.74, 0.11, 0.23, 0.14],
      [-0.23, 0.77, -0.13, 0.25, 0.15],
      [0.04, 0.72, -0.29, 0.21, 0.13],
      [-0.13, 0.68, 0.24, 0.2, 0.12],
      [0.31, 0.62, -0.19, 0.17, 0.11],
      [-0.33, 0.62, 0.07, 0.18, 0.11],
    ];
    clumps.forEach(([x, y, z, rh, rv], i) => icoClump(b, [x, y, z], [rh, rv, rh * 0.95], crownC, 11 + i));
  } else if (group === VegGroup.Rainforest) {
    const crownC = [0.02, 0.68, 0];
    limb(b, [0, 0, 0], [0.01, 0.52, 0.0], 0.06, 0.04, 6);
    limb(b, [0.01, 0.4, 0], [0.2, 0.58, -0.1], 0.025, 0.012, 4);
    const clumps: [number, number, number, number, number][] = [
      [0.0, 0.76, 0.0, 0.42, 0.26],
      [0.22, 0.6, -0.12, 0.3, 0.2],
      [-0.2, 0.62, 0.14, 0.3, 0.2],
      [0.06, 0.58, 0.28, 0.24, 0.16],
      [-0.12, 0.56, -0.26, 0.24, 0.16],
    ];
    clumps.forEach(([x, y, z, rh, rv], i) => icoClump(b, [x, y, z], [rh, rv, rh], crownC, 41 + i));
  } else return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(b.part, 1));
  g.setIndex(b.idx);
  return g;
}

/** Cheap fingerprint of the near sets (count + position checksum) to detect "nothing changed". */
function lodSignature(split: { near: VegInstances | null }[]): string {
  return split
    .map((s) => {
      if (!s.near || s.near.count === 0) return '0';
      let h = 0;
      const p = s.near.position;
      for (let i = 0; i < s.near.count; i++) h += p[i * 3]! * 1.37 + p[i * 3 + 1]! * 0.73;
      return `${s.near.count}:${h.toFixed(1)}`;
    })
    .join('|');
}

/** Split of one instance set into the near (detailed) and far (low-poly) LOD. */
export interface LodSplit {
  near: VegInstances;
  far: VegInstances;
}

function subset(src: VegInstances, idx: ArrayLike<number>, n: number): VegInstances {
  const position = new Float32Array(n * 3);
  const size = new Float32Array(n * 2);
  const rand = new Float32Array(n * 2);
  const tint = new Uint8Array(n * 3);
  for (let o = 0; o < n; o++) {
    const i = idx[o]!;
    position[o * 3] = src.position[i * 3]!;
    position[o * 3 + 1] = src.position[i * 3 + 1]!;
    position[o * 3 + 2] = src.position[i * 3 + 2]!;
    size[o * 2] = src.size[i * 2]!;
    size[o * 2 + 1] = src.size[i * 2 + 1]!;
    rand[o * 2] = src.rand[i * 2]!;
    rand[o * 2 + 1] = src.rand[i * 2 + 1]!;
    tint[o * 3] = src.tint[i * 3]!;
    tint[o * 3 + 1] = src.tint[i * 3 + 1]!;
    tint[o * 3 + 2] = src.tint[i * 3 + 2]!;
  }
  return { group: src.group, count: n, position, size, rand, tint };
}

/**
 * Split instance sets by distance from the camera (local x, y and elevation z m ASL; world heights exaggerated by
 * `vex`, tree heights not): the nearest ≤ `max` instances of the groups that have a detailed model and lie within
 * `radius` m (3-D distance to mid-height) form the near LOD. Pure (unit-tested).
 */
export function splitLod(sets: VegInstances[], cam: readonly [number, number, number], vex: number, radius: number, max: number): LodSplit[] {
  const r2 = radius * radius;
  // Candidates from every detailed group, nearest first, capped across groups.
  const cand: { s: number; i: number; d: number }[] = [];
  sets.forEach((set, si) => {
    if (set.group !== VegGroup.Eucalypt && set.group !== VegGroup.Rainforest) return;
    for (let i = 0; i < set.count; i++) {
      const dx = set.position[i * 3]! - cam[0];
      const dy = set.position[i * 3 + 1]! - cam[1];
      if (dx * dx + dy * dy > r2) continue;
      const dz = set.position[i * 3 + 2]! * vex + 0.5 * set.size[i * 2]! - cam[2] * vex;
      const d = dx * dx + dy * dy + dz * dz;
      if (d <= r2) cand.push({ s: si, i, d });
    }
  });
  if (cand.length > max) {
    cand.sort((a, b) => a.d - b.d);
    cand.length = Math.max(0, max);
  }
  const nearIdx = sets.map(() => [] as number[]);
  for (const c of cand) nearIdx[c.s]!.push(c.i);
  return sets.map((set, si) => {
    const ni = nearIdx[si]!.sort((a, b) => a - b);
    if (ni.length === 0) return { near: { ...subset(set, [], 0) }, far: set };
    const isNear = new Uint8Array(set.count);
    for (const i of ni) isNear[i] = 1;
    const fi: number[] = [];
    for (let i = 0; i < set.count; i++) if (!isNear[i]) fi.push(i);
    return { near: subset(set, ni, ni.length), far: subset(set, fi, fi.length) };
  });
}

/** Indexed geometry for a group (≈ 30–40 triangles and 30–36 vertices per tree). */
export function vegetationGeometry(group: VegGroup): THREE.BufferGeometry {
  const b: Builder = { pos: [], nor: [], part: [], idx: [] };
  switch (group) {
    case VegGroup.Eucalypt:
      // Open, clumped crown on a tall trunk (the "stringybark / scribbly gum" silhouette).
      trunk(b, 0.05, 0.022, 0, 0.7);
      clump(b, 0.02, 0.8, 0.0, 0.34, 0.2, 0.32, 0.25);
      clump(b, 0.26, 0.64, 0.12, 0.28, 0.2, 0.26, -0.2);
      clump(b, -0.24, 0.68, -0.14, 0.3, 0.2, 0.28, 0.3);
      clump(b, 0.04, 0.58, -0.28, 0.24, 0.17, 0.22, -0.3);
      break;
    case VegGroup.Rainforest:
      trunk(b, 0.05, 0.035, 0, 0.5);
      clump(b, 0.0, 0.72, 0.0, 0.5, 0.3, 0.48, 0.15);
      clump(b, 0.18, 0.55, -0.1, 0.34, 0.2, 0.36, -0.2);
      break;
    case VegGroup.Conifer:
      trunk(b, 0.06, 0.03, 0, 0.25);
      cone(b, 0.18, 1.0, 0.5, 6);
      break;
    case VegGroup.Shrub:
      clump(b, 0, 0.5, 0, 0.5, 0.5, 0.45, 0.2);
      clump(b, 0.25, 0.35, 0.2, 0.3, 0.35, 0.3, -0.25);
      break;
    case VegGroup.Grass:
      blades(b, 4);
      break;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(b.part, 1));
  g.setIndex(b.idx);
  return g;
}

/** Triangles per instance of each group (for budgeting / stats). */
export function trianglesPerInstance(group: VegGroup): number {
  return vegetationGeometry(group).getIndex()!.count / 3;
}

export interface VegetationUniformSources {
  /** Uniforms shared with the terrain (fire textures, time, lighting, fog). */
  shared: Record<string, THREE.IUniform>;
}

export class VegetationLayer {
  readonly group = new THREE.Group();
  private meshes: THREE.Mesh[] = [];
  private materials: THREE.ShaderMaterial[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  private detailGeometries: (THREE.BufferGeometry | null)[] = [];
  private instanceGeoms: THREE.InstancedBufferGeometry[] = [];
  private sets: VegInstances[] = [];
  private lodCam: [number, number, number] | null = null;
  private lodVex = 1;
  private nearCount = 0;
  /** Near-LOD radius (m, 3-D) and instance cap (0 disables the near LOD). */
  lodRadius = 280;
  lodMax = 2500;
  readonly uniforms: Record<string, THREE.IUniform>;

  constructor(shared: Record<string, THREE.IUniform>) {
    this.group.name = 'vegetation';
    this.uniforms = {
      uPxPerRad: { value: 1000 },
      uCullPx: { value: 1.2 },
      uThinStart: { value: 2500 },
      uNearCull: { value: 0 },
    };
    for (let gi = 0; gi < VEG_GROUP_COUNT; gi++) {
      const geom = vegetationGeometry(gi as VegGroup);
      this.geometries.push(geom);
      this.detailGeometries.push(vegetationDetailGeometry(gi as VegGroup));
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          ...pick(shared, [
            'uVex',
            'uTime',
            'uClock',
            'uHasFire',
            'uBurnBand',
            'uArrival',
            'uFireAux',
            'uFireXf',
            'uGlow',
            'uGlowXf',
            'uGlowGain',
            'uSunDir',
            'uSunColour',
            'uSunI',
            'uSkyAmb',
            'uGroundAmb',
            'uAmbI',
            'uExposure',
            'uFogColour',
            'uFogDensity',
          ]),
          ...this.uniforms,
          uConsumable: { value: gi === VegGroup.Shrub || gi === VegGroup.Grass ? 1 : 0 },
          // Linear trunk colours: pale grey-brown gum bark; darker rainforest / pine bark.
          uTrunk: { value: gi === VegGroup.Eucalypt ? new THREE.Color(0.2, 0.17, 0.13) : new THREE.Color(0.07, 0.05, 0.035) },
        },
        vertexShader: VEG_VERT,
        fragmentShader: VEG_FRAG,
        toneMapped: false,
        side: gi === VegGroup.Grass ? THREE.DoubleSide : THREE.FrontSide,
      });
      this.materials.push(mat);
    }
  }

  /** Replace all instances (the near LOD is re-split around the last camera position). */
  setInstances(sets: VegInstances[]): void {
    this.sets = sets;
    this.rebuild();
  }

  /**
   * Move the near-LOD centre (camera position, local x, y and z m ASL). Re-splits only when the camera moved by more
   * than a fifth of the LOD radius (call when the camera settles).
   */
  updateLod(cam: readonly [number, number, number], vex: number): void {
    const c = this.lodCam;
    if (c && this.lodVex === vex && Math.hypot(cam[0] - c[0], cam[1] - c[1], (cam[2] - c[2]) * vex) < this.lodRadius * 0.2) return;
    this.lodCam = [cam[0], cam[1], cam[2]];
    this.lodVex = vex;
    const split = this.split();
    // Re-uploading ~50 k instances costs a few MB of buffer traffic: skip it when the near set did not change (e.g.
    // every settle of a high overview camera, where no tree is near).
    const sig = lodSignature(split);
    if (sig === this.lodSig) return;
    this.rebuild(split);
  }

  private lodSig = '';

  private split(): { far: VegInstances; near: VegInstances | null }[] {
    return this.lodCam && this.lodMax > 0 ? splitLod(this.sets, this.lodCam, this.lodVex, this.lodRadius, this.lodMax) : this.sets.map((far) => ({ far, near: null }));
  }

  private rebuild(split = this.split()): void {
    for (const m of this.meshes) this.group.remove(m);
    for (const g of this.instanceGeoms) g.dispose();
    this.meshes = [];
    this.instanceGeoms = [];
    this.lodSig = lodSignature(split);
    this.nearCount = 0;
    for (const { far, near } of split) {
      this.addMesh(far, this.geometries[far.group]!, 'far');
      const dg = this.detailGeometries[far.group];
      if (near && near.count > 0 && dg) {
        this.addMesh(near, dg, 'near');
        this.nearCount += near.count;
      }
    }
  }

  private addMesh(s: VegInstances, base: THREE.BufferGeometry, lod: string): void {
    if (s.count === 0) return;
    const ig = new THREE.InstancedBufferGeometry();
    ig.setAttribute('position', base.getAttribute('position'));
    ig.setAttribute('normal', base.getAttribute('normal'));
    ig.setAttribute('aPart', base.getAttribute('aPart'));
    ig.setIndex(base.getIndex());
    ig.setAttribute('aInst', new THREE.InstancedBufferAttribute(s.position, 3));
    ig.setAttribute('aSize', new THREE.InstancedBufferAttribute(s.size, 2));
    ig.setAttribute('aRand', new THREE.InstancedBufferAttribute(s.rand, 2));
    ig.setAttribute('aTint', new THREE.InstancedBufferAttribute(s.tint, 3, true));
    ig.instanceCount = s.count;
    const mesh = new THREE.Mesh(ig, this.materials[s.group]!);
    mesh.frustumCulled = false; // culled per instance in the vertex shader
    mesh.name = `veg-${VegGroup[s.group]}-${lod}`;
    this.meshes.push(mesh);
    this.instanceGeoms.push(ig);
    this.group.add(mesh);
  }

  /** Pixels per radian of view angle (for screen-size culling). */
  setProjection(pxPerRad: number, thinStart: number): void {
    this.uniforms.uPxPerRad!.value = pxPerRad;
    this.uniforms.uThinStart!.value = thinStart;
  }

  /** Hide instances closer than `metres` to the camera (eye-level view). */
  setNearCull(metres: number): void {
    this.uniforms.uNearCull!.value = metres;
  }

  get instanceCount(): number {
    return this.instanceGeoms.reduce((s, g) => s + g.instanceCount, 0);
  }

  /** Instances currently drawn with the detailed near-LOD models. */
  get nearInstanceCount(): number {
    return this.nearCount;
  }

  dispose(): void {
    for (const g of this.instanceGeoms) g.dispose();
    for (const g of this.geometries) g.dispose();
    for (const g of this.detailGeometries) g?.dispose();
    for (const m of this.materials) m.dispose();
    this.meshes = [];
    this.instanceGeoms = [];
    this.sets = [];
  }
}

export function pick(src: Record<string, THREE.IUniform>, keys: string[]): Record<string, THREE.IUniform> {
  const out: Record<string, THREE.IUniform> = {};
  for (const k of keys) {
    const u = src[k];
    if (!u) throw new Error(`uniform ${k} missing`);
    out[k] = u;
  }
  return out;
}
