/**
 * GLSL snippets shared by the scene's custom shaders (WebGL2 / GLSL ES 3.00 via THREE.ShaderMaterial).
 *
 * All custom materials use `toneMapped: false` and do their own ACES tone mapping (same curve as three.js's
 * ACESFilmicToneMapping) so that data overlays and legends can be composited AFTER tone mapping and keep their exact
 * legend colours; three's `colorspace_fragment` then encodes to sRGB.
 */

/** Hash, value noise and fbm (2-D). */
export const NOISE = /* glsl */ `
float fsHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float fsNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(fsHash(i), fsHash(i + vec2(1.0, 0.0)), u.x), mix(fsHash(i + vec2(0.0, 1.0)), fsHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fsFbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int k = 0; k < 4; k++) {
    s += a * fsNoise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return s;
}
`;

/**
 * Tone mapping. Two paths:
 *  - fsTonemap: ACES filmic (three.js fit) for HDR EMISSIVE light — flames, burning ground, glow, embers.
 *  - fsDisplay: for lit SURFACES. Their colours (aerial photo, natural palette, tree tints, sky keyframes) are already
 *    "as seen in daylight", so lighting is normalised by LIGHT_REF (a typical sunlit surface at midday = 1) and only a
 *    soft shoulder is applied. ACES's toe would otherwise darken a photo's shadows by half and make it muddy.
 */
export const TONEMAP = /* glsl */ `
uniform float uExposure;
const float LIGHT_REF = 1.45;
vec3 fsDisplay(vec3 c) {
  c *= uExposure;
  vec3 over = max(c - 0.8, 0.0);
  return min(c, vec3(0.8)) + 0.2 * (1.0 - exp(-over / 0.2));
}
vec3 fsRRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 fsTonemap(vec3 color) {
  const mat3 ACESInputMat = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 ACESOutputMat = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color *= uExposure / 0.6;
  color = ACESInputMat * color;
  color = fsRRTAndODTFit(color);
  color = ACESOutputMat * color;
  return clamp(color, 0.0, 1.0);
}
`;

/** Exponential-squared distance fog applied in display space. */
export const FOG = /* glsl */ `
uniform vec3 uFogColour;
uniform float uFogDensity;
vec3 fsFog(vec3 ldr, float dist) {
  float f = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
  return mix(ldr, fsDisplay(uFogColour), clamp(f, 0.0, 1.0));
}
`;

/** Grid-texture helpers: uv of a local point for a grid transform [originX, originY, sizeX, sizeY]. */
export const GRID = /* glsl */ `
vec2 fsGridUv(vec2 p, vec4 xf) { return (p - xf.xy) / xf.zw; }
// Manual bilinear filtering of an R32F texture (float32 is not guaranteed to be filterable, doc 09 §3.1).
// Returns the value; 'bad' is set when any of the 4 texels is at or beyond +-1e29 (no data / not burnt), in which
// case only the valid texels are blended, so sentinels never mix with real values.
float fsBilinearR(sampler2D t, vec2 uv, out bool bad) {
  ivec2 size = textureSize(t, 0);
  vec2 p = uv * vec2(size) - 0.5;
  vec2 f = fract(p);
  ivec2 i0 = ivec2(floor(p));
  ivec2 mx = size - 1;
  ivec2 a = clamp(i0, ivec2(0), mx);
  ivec2 b = clamp(i0 + ivec2(1, 0), ivec2(0), mx);
  ivec2 c = clamp(i0 + ivec2(0, 1), ivec2(0), mx);
  ivec2 d = clamp(i0 + ivec2(1, 1), ivec2(0), mx);
  float va = texelFetch(t, a, 0).r;
  float vb = texelFetch(t, b, 0).r;
  float vc = texelFetch(t, c, 0).r;
  float vd = texelFetch(t, d, 0).r;
  bad = abs(va) > 1e29 || abs(vb) > 1e29 || abs(vc) > 1e29 || abs(vd) > 1e29;
  if (bad) {
    // Renormalised bilinear over the valid texels: smooth values up to a data edge; no data only if none is valid.
    float wa = abs(va) > 1e29 ? 0.0 : (1.0 - f.x) * (1.0 - f.y);
    float wb = abs(vb) > 1e29 ? 0.0 : f.x * (1.0 - f.y);
    float wc = abs(vc) > 1e29 ? 0.0 : (1.0 - f.x) * f.y;
    float wd = abs(vd) > 1e29 ? 0.0 : f.x * f.y;
    float ws = wa + wb + wc + wd;
    if (ws < 1e-6) {
      ivec2 n = clamp(ivec2(floor(uv * vec2(size))), ivec2(0), mx);
      return texelFetch(t, n, 0).r;
    }
    return (wa * (abs(va) > 1e29 ? 0.0 : va) + wb * (abs(vb) > 1e29 ? 0.0 : vb) + wc * (abs(vc) > 1e29 ? 0.0 : vc) + wd * (abs(vd) > 1e29 ? 0.0 : vd)) / ws;
  }
  return mix(mix(va, vb, f.x), mix(vc, vd, f.x), f.y);
}
// Bilinear filtering of an ANGLE field (degrees, e.g. aspect): the four texels are averaged as unit vectors, so 350°
// and 10° blend to 0°, not to 180°. No-data texels (|v| > 1e29) are skipped; returns -1e30 when none is valid.
float fsBilinearAngle(sampler2D t, vec2 uv) {
  ivec2 size = textureSize(t, 0);
  vec2 p = uv * vec2(size) - 0.5;
  vec2 f = fract(p);
  ivec2 i0 = ivec2(floor(p));
  ivec2 mx = size - 1;
  float v[4];
  v[0] = texelFetch(t, clamp(i0, ivec2(0), mx), 0).r;
  v[1] = texelFetch(t, clamp(i0 + ivec2(1, 0), ivec2(0), mx), 0).r;
  v[2] = texelFetch(t, clamp(i0 + ivec2(0, 1), ivec2(0), mx), 0).r;
  v[3] = texelFetch(t, clamp(i0 + ivec2(1, 1), ivec2(0), mx), 0).r;
  float w[4];
  w[0] = (1.0 - f.x) * (1.0 - f.y);
  w[1] = f.x * (1.0 - f.y);
  w[2] = (1.0 - f.x) * f.y;
  w[3] = f.x * f.y;
  vec2 acc = vec2(0.0);
  float ws = 0.0;
  for (int k = 0; k < 4; k++) {
    if (abs(v[k]) > 1e29) continue;
    float a = radians(v[k]);
    acc += w[k] * vec2(sin(a), cos(a));
    ws += w[k];
  }
  if (ws < 1e-6) return -1e30;
  return mod(degrees(atan(acc.x, acc.y)) + 360.0, 360.0);
}
float fsNearestR(sampler2D t, vec2 uv) {
  ivec2 size = textureSize(t, 0);
  ivec2 n = clamp(ivec2(floor(uv * vec2(size))), ivec2(0), size - 1);
  return texelFetch(t, n, 0).r;
}
`;
