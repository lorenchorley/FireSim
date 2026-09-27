/**
 * Terrain mesh, skirt ("diorama" sides) and the single terrain ShaderMaterial that composites every ground layer:
 *
 *   base colour   natural fuel palette (per fuel cell) with fine procedural detail, or the aerial imagery
 *   lighting      Horn-gradient normals from the FULL-resolution DEM (texture), real sun direction with terrain cast
 *                 shadows, sky-view ambient occlusion and a multi-directional hillshade relief cue, fire glow light
 *   fire          burnt ground (char + ash), flaming band and front line from the arrival-time texture and the
 *                 interpolated display time, still-burning cells from the burn-state texture
 *   overlays      one R32F value texture + a LUT (legends.ts), isochrones every N minutes with fwidth-crisp lines
 *   decals        brush preview, spot-fire rings, ignition points/lines, user position/heading, focused insight
 *
 * Geometry is in LOCAL coordinates (x east, y north, z m ASL); the vertex shader applies the world mapping with the
 * vertical exaggeration uniform, so changing it costs nothing.
 */
import * as THREE from 'three';
import type { GridSpec } from '../core/grid';
import type { FireField, FuelMap, Terrain } from '../core/types';
import { gridTransform } from './coords';
import { groundColours, type OverlayField, type RenderGrid } from './fields';
import { FOG, GRID, NOISE, TONEMAP } from './glsl';
import type { OverlayScale } from './legends';
import { dummyFloat, dummyRgba, halfRgTexture, lutTexture, r8Texture, refillFloat, refillRgba, rgbaTexture } from './textures';
import type { SceneImagery } from './api';

export const MAX_SPOTS = 16;
export const MAX_IGNITION_SEGMENTS = 32;

const TERRAIN_VERT = /* glsl */ `
uniform float uVex;
varying vec2 vLocal;
varying float vZ;
varying float vDist;
void main() {
  vec3 w = vec3(position.x, position.z * uVex, -position.y);
  vLocal = position.xy;
  vZ = position.z;
  vec4 mv = viewMatrix * vec4(w, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const TERRAIN_FRAG = /* glsl */ `
${NOISE}
${TONEMAP}
${FOG}
${GRID}
uniform float uVex;
uniform sampler2D uAlbedo;   uniform vec4 uAlbedoXf;
uniform sampler2D uImagery;  uniform vec4 uImageryXf; uniform float uUseImagery; uniform float uImageryFlipV;
uniform sampler2D uGrad;     uniform vec4 uGradXf;
uniform sampler2D uShade;    uniform vec4 uShadeXf;
uniform sampler2D uArrival;  uniform sampler2D uFireAux; uniform vec4 uFireXf; uniform float uHasFire;
uniform sampler2D uGlow;     uniform vec4 uGlowXf; uniform float uGlowGain;
uniform sampler2D uOverlay;  uniform vec4 uOverlayXf; uniform sampler2D uLut;
uniform vec4 uOverlayScale;  // lo, hi, mode (0 off, 1 ramp, 2 classes, 3 categorical, 4 cyclic), log
uniform vec4 uOverlayNoData; uniform float uOverlayOpacity; uniform float uOverlayFire;
uniform float uTime; uniform float uClock; uniform float uIsoMinutes; uniform float uIsoStrong; uniform float uBurnBand;
uniform vec3 uSunDir; uniform vec3 uSunColour; uniform float uSunI;
uniform vec3 uSkyAmb; uniform vec3 uGroundAmb; uniform float uAmbI; uniform float uNight;
uniform vec4 uBrush; uniform vec3 uBrushColour;
uniform vec4 uUser; uniform float uUserHeading; uniform vec4 uFocus;
uniform vec4 uSpots[${MAX_SPOTS}]; uniform int uSpotCount;
uniform vec4 uIgn[${MAX_IGNITION_SEGMENTS}]; uniform int uIgnCount;
uniform float uPixelMetres;
varying vec2 vLocal;
varying float vZ;
varying float vDist;

// Arrival time with manual bilinear filtering; "not burnt" texels take the latest neighbouring arrival + 10 min so
// the burnt edge stays a smooth curve even next to non-flammable cells.
float arrivalAt(vec2 uv) {
  ivec2 size = textureSize(uArrival, 0);
  vec2 p = uv * vec2(size) - 0.5;
  vec2 f = fract(p);
  ivec2 i0 = ivec2(floor(p));
  ivec2 mx = size - 1;
  float va = texelFetch(uArrival, clamp(i0, ivec2(0), mx), 0).r;
  float vb = texelFetch(uArrival, clamp(i0 + ivec2(1, 0), ivec2(0), mx), 0).r;
  float vc = texelFetch(uArrival, clamp(i0 + ivec2(0, 1), ivec2(0), mx), 0).r;
  float vd = texelFetch(uArrival, clamp(i0 + ivec2(1, 1), ivec2(0), mx), 0).r;
  float m = -1.0;
  if (va < 1e29) m = max(m, va);
  if (vb < 1e29) m = max(m, vb);
  if (vc < 1e29) m = max(m, vc);
  if (vd < 1e29) m = max(m, vd);
  if (m < 0.0) return 1e30;
  float r = m + 600.0;
  va = va < 1e29 ? va : r;
  vb = vb < 1e29 ? vb : r;
  vc = vc < 1e29 ? vc : r;
  vd = vd < 1e29 ? vd : r;
  return mix(mix(va, vb, f.x), mix(vc, vd, f.x), f.y);
}

vec4 overlayColour(vec2 p, float burntMask) {
  int mode = int(uOverlayScale.z + 0.5);
  if (mode == 0) return vec4(0.0);
  vec2 uv = fsGridUv(p, uOverlayXf);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
  float v;
  bool bad = false;
  if (mode == 3) v = fsNearestR(uOverlay, uv);
  else if (mode == 4) v = fsBilinearAngle(uOverlay, uv); // cyclic (aspect): vector interpolation
  else v = fsBilinearR(uOverlay, uv, bad);
  if (v < -1e29) return uOverlayNoData;
  float u;
  if (mode == 3) {
    u = (floor(v + 0.5) + 0.5) / 256.0;
  } else if (mode == 4) {
    u = fract(v / 360.0);
  } else {
    float f = uOverlayScale.w > 0.5 ? log(max(v, 1e-12)) / log(10.0) : v;
    u = clamp((f - uOverlayScale.x) / (uOverlayScale.y - uOverlayScale.x), 0.0, 0.9999);
  }
  vec4 c = texture(uLut, vec2(u, 0.5));
  if (uOverlayFire > 0.5) c.a *= burntMask;
  return c;
}

// Distance from p to segment ab.
float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  return length(p - a - ab * t);
}

// Anti-aliased ring (1 on the ring of radius r and half-width w, pixels via fwidth of the distance).
float ring(float d, float r, float wPx) {
  float aa = max(fwidth(d), 1e-4);
  return 1.0 - smoothstep(wPx * aa, (wPx + 1.0) * aa, abs(d - r));
}
float disc(float d, float r) {
  float aa = max(fwidth(d), 1e-4);
  return 1.0 - smoothstep(r - aa, r + aa, d);
}

void main() {
  vec2 p = vLocal;

  // ── Normal from the full-resolution Horn gradient ─────────────────────────
  vec2 grad = texture(uGrad, fsGridUv(p, uGradXf)).rg;
  vec3 n = normalize(vec3(-uVex * grad.x, 1.0, uVex * grad.y));
  vec4 shade = texture(uShade, fsGridUv(p, uShadeXf)); // r hillshade, g sky view, b cast shadow
  float slope = length(grad);

  // ── Base colour ──────────────────────────────────────────────────────────
  vec4 alb = texture(uAlbedo, fsGridUv(p, uAlbedoXf));
  vec3 base = alb.rgb;
  float rock = alb.a;
  // Sandstone strata bands on cliffs (≈ 7 m and 25 m apart), faded out once a pixel spans a good part of a band so
  // they never alias into moiré in wide views (derivative taken here, in uniform control flow).
  float zw = fwidth(vZ);
  float strataN = fsNoise(p / 40.0) * 6.0;
  float strataV = (0.14 * sin(vZ * 0.9 + strataN)) * (1.0 - smoothstep(0.8, 2.5, zw))
                + (0.1 * sin(vZ * 0.25 + strataN * 0.5)) * (1.0 - smoothstep(3.0, 9.0, zw));
  // Fine detail that fades out once a pixel covers more than a few metres (noise is only evaluated where visible).
  float lod = clamp(1.5 - uPixelMetres * vDist / 12.0, 0.0, 1.0);
  float crowns = 0.5;
  float fine = 0.5;
  if (lod > 0.0) {
    crowns = fsFbm(p / 9.0);
    fine = fsNoise(p / 2.3);
    // Extra octave for eye-level views (litter, grass clumps, stones), faded out beyond ~150 m.
    float nearW = 1.0 - smoothstep(20.0, 150.0, vDist);
    if (nearW > 0.0) fine = mix(fine, fsNoise(p / 0.45), 0.5 * nearW);
    if (uUseImagery < 0.5) base *= mix(1.0, 0.8 + 0.34 * crowns + 0.08 * (fine - 0.5), lod * (1.0 - 0.6 * rock));
  }
  // Sandstone strata on cliffs.
  float cliff = rock * clamp(slope - 0.6, 0.0, 1.0);
  if (cliff > 0.0) base *= mix(1.0, 0.9 + strataV, cliff);
  vec3 img = base;
  if (uUseImagery > 0.5) {
    vec2 iuv = fsGridUv(p, uImageryXf);
    if (uImageryFlipV > 0.5) iuv.y = 1.0 - iuv.y;
    img = texture(uImagery, iuv).rgb;
    // Sub-pixel detail so close-up (eye-level) ground is not a smooth smear of 8 m photo pixels.
    base = img * (lod > 0.0 ? mix(1.0, 0.86 + 0.2 * crowns + 0.1 * (fine - 0.5), lod * 0.8) : 1.0);
    // Cliffs: a vertical photo would only have a few stretched pixels on a near-vertical face (the classic drape-map
    // smear), so steep faces (> ~40°, fully > ~58°) show banded sandstone tinted by the photo instead.
    float steep = smoothstep(0.85, 1.6, slope);
    if (steep > 0.0) {
      float strata = 0.9 + strataV + 0.12 * (fine - 0.5);
      base = mix(base, mix(alb.rgb, img, 0.35) * strata, steep * 0.7);
    }
  }

  // ── Lighting ─────────────────────────────────────────────────────────────
  float ndl = max(dot(n, uSunDir), 0.0);
  float shadow = shade.b;
  vec3 sun = uSunColour * uSunI * ndl * (1.0 - 0.92 * shadow);
  float hemi = 0.5 + 0.5 * n.y;
  float relief = 0.55 + 0.9 * shade.r;
  vec3 amb = mix(uGroundAmb, uSkyAmb, hemi) * uAmbI * (0.35 + 0.65 * shade.g) * relief;
  vec3 light = sun + amb;
  light /= LIGHT_REF;
  if (uUseImagery > 0.5) {
    // The photo already contains the capture day's shading: apply the scene lighting relative to a typical sunlit
    // surface NOW at half contrast, scaled by how bright the scene is (dusk and night darken it).
    vec3 refC = (uSunColour * uSunI * 0.72 + uSkyAmb * uAmbI) / LIGHT_REF;
    float refL = max(dot(refC, vec3(0.3333)), 1e-3);
    light = mix(vec3(1.0), light / refL, 0.5) * refC;
  }
  vec3 glowLight = vec3(0.0);
  if (uHasFire > 0.5) {
    float g = texture(uGlow, fsGridUv(p, uGlowXf)).r;
    glowLight = vec3(1.0, 0.36, 0.09) * g * g * uGlowGain / LIGHT_REF;
  }
  vec3 col = base * (light + glowLight);
  vec3 emit = vec3(0.0);
  float burntMask = 0.0;

  // ── Fire on the ground ───────────────────────────────────────────────────
  // Arrival time under this pixel (1e30 = not burnt / no fire). Screen-space derivatives of the front and isochrone
  // coordinates are taken HERE, in uniform control flow: fwidth inside a branch that differs between the pixels of a
  // 2×2 quad is undefined in GLSL and gives speckled lines on some mobile GPUs. The coordinates are clamped to finite
  // values so the derivatives never see inf.
  float ta = 1e30;
  vec2 fuv = fsGridUv(p, uFireXf);
  if (uHasFire > 0.5 && fuv.x >= 0.0 && fuv.y >= 0.0 && fuv.x <= 1.0 && fuv.y <= 1.0) ta = arrivalAt(fuv);
  float taF = min(ta, 1e7);
  float tmFront = (uTime - taF) / 60.0;                 // minutes since the front passed
  float wFront = max(fwidth(tmFront), 1e-3);
  float isoMin = max(uIsoMinutes, 1.0);
  float tmIso = taF / (isoMin * 60.0);                  // isochrone index
  float wIso = max(fwidth(tmIso), 1e-4);
  float majorN = isoMin >= 60.0 ? 1.0 : 60.0 / isoMin;  // every hour drawn bolder
  float tmMajor = tmIso / majorN;
  float wMajor = max(fwidth(tmMajor), 1e-4);

  if (ta < 1e29) {
    float dt = uTime - ta;
    ivec2 fs = textureSize(uFireAux, 0);
    vec4 aux = texelFetch(uFireAux, clamp(ivec2(floor(fuv * vec2(fs))), ivec2(0), fs - 1), 0);
    int bstate = int(aux.r * 255.0 + 0.5);
    // Flame height (m), linearly filtered: weights the glow so the head burns bright and the flanks dimmer.
    float fh = texture(uFireAux, fuv).a * 63.75;
    float fw = clamp(0.2 + fh / 4.0, 0.2, 1.0);
    float flick = fsNoise(p / 14.0 + vec2(uClock * 1.7, -uClock * 1.1)) * 0.6 + fsNoise(p / 5.0 - uClock * 3.0) * 0.4;
    if (dt >= 0.0) {
      burntMask = 1.0;
      // Char, then patchy grey-white ash where the fire burnt hot (fades to its mean when a pixel spans many metres,
      // so the fine pattern does not shimmer in wide views).
      float charT = smoothstep(0.0, 240.0, dt);
      float ashN = lod > 0.0 ? mix(0.25, smoothstep(0.62, 0.9, fsFbm(p / 8.0 + 3.1)), lod) : 0.25;
      float ash = ashN * smoothstep(600.0, 3600.0, dt) * (0.35 + 0.65 * fw);
      vec3 charC = mix(vec3(0.028, 0.025, 0.022), vec3(0.085, 0.08, 0.075), ash);
      col = mix(col, charC * (light * 0.9 + glowLight + 0.02) * 1.6, charT * 0.92);
      // Flaming band just behind the front, then smouldering embers.
      float band = 1.0 - smoothstep(0.0, uBurnBand, dt);
      // Smouldering logs and stumps: scattered glowing spots that die down over the next hour or so.
      float smoulder = exp(-dt / 1500.0) * (bstate == 1 ? 1.0 : 0.18);
      vec3 hot = mix(vec3(0.9, 0.16, 0.02), vec3(1.0, 0.45, 0.08), flick);
      emit += hot * band * band * (0.8 + 1.2 * flick) * fw;
      emit += vec3(0.8, 0.08, 0.01) * smoulder * smoothstep(0.68, 0.95, fsNoise(p / 3.0 + uClock * 0.4)) * 0.9;
    }
    // Active front line (constant pixel width) where the fire is arriving now; hidden when a pixel spans > 3 min.
    float front = (1.0 - smoothstep(0.8 * wFront, 2.0 * wFront, abs(tmFront))) * (1.0 - smoothstep(3.0, 20.0, wFront));
    emit += vec3(1.0, 0.3, 0.04) * front * (0.8 + 0.7 * flick) * fw;
  }

  // ── Tone map, then data overlays in display space ────────────────────────
  vec3 ldr = fsDisplay(col);
  vec4 ov = overlayColour(p, burntMask);
  if (ov.a > 0.0) {
    float rel = 0.72 + 0.4 * shade.r * (1.0 - 0.5 * shade.b);
    ldr = mix(ldr, ov.rgb * rel, ov.a * uOverlayOpacity);
  }
  // Isochrones (derivatives computed above).
  if (uIsoMinutes > 0.0 && burntMask > 0.5) {
    float line = 1.0 - smoothstep(0.6 * wIso, 1.6 * wIso, abs(fract(tmIso + 0.5) - 0.5));
    float lineMajor = uIsoStrong > 0.5 ? 1.0 - smoothstep(1.2 * wMajor, 2.4 * wMajor, abs(fract(tmMajor + 0.5) - 0.5))
                                       : 1.0 - smoothstep(0.5 * wMajor, 1.3 * wMajor, abs(fract(tmMajor + 0.5) - 0.5));
    float fade = 1.0 - smoothstep(0.12, 0.35, wIso); // hide when lines would merge
    // On the plain burnt ground only the major (hourly) lines are drawn, faintly, as a record of the fire's progress —
    // as pale ash lit by the scene light, so at night they stay dark instead of reading as lines of fire.
    float strength = uIsoStrong > 0.5 ? 0.85 : 0.22;
    vec3 isoC = uIsoStrong > 0.5 ? vec3(0.06, 0.05, 0.08) : fsDisplay(vec3(0.3, 0.26, 0.21) * light);
    float l = uIsoStrong > 0.5 ? max(line * 0.7, lineMajor) : lineMajor;
    ldr = mix(ldr, isoC, l * strength * fade);
  }
  ldr += fsTonemap(emit) * 0.9;

  // ── Decals ───────────────────────────────────────────────────────────────
  // Ignition points / lines (red, with a dark halo so they read on any background).
  for (int s = 0; s < ${MAX_IGNITION_SEGMENTS}; s++) {
    if (s >= uIgnCount) break;
    vec4 sg = uIgn[s];
    float d = segDist(p, sg.xy, sg.zw);
    float aa = max(fwidth(d), 1e-3);
    float core = 1.0 - smoothstep(2.0 * aa, 3.2 * aa, d);
    float halo = 1.0 - smoothstep(3.2 * aa, 5.0 * aa, d);
    ldr = mix(ldr, vec3(0.05, 0.0, 0.0), halo * 0.6);
    ldr = mix(ldr, vec3(0.95, 0.12, 0.1), core);
  }
  // Spot fires: pulsing orange rings.
  for (int s = 0; s < ${MAX_SPOTS}; s++) {
    if (s >= uSpotCount) break;
    vec4 sp = uSpots[s];
    float d = length(p - sp.xy);
    float pulse = 0.5 + 0.5 * sin(uClock * 4.0 + sp.w);
    float r = sp.z * (1.0 + 0.15 * pulse);
    ldr = mix(ldr, vec3(0.08, 0.03, 0.0), ring(d, r, 3.5) * 0.7);
    ldr = mix(ldr, vec3(1.0, 0.55, 0.1), ring(d, r, 2.0));
  }
  // Focused insight: pulsing white ring.
  if (uFocus.w > 0.5) {
    float d = length(p - uFocus.xy);
    float ph = fract(uClock * 0.6);
    ldr = mix(ldr, vec3(1.0), ring(d, uFocus.z * (0.4 + 0.8 * ph), 2.0) * (1.0 - ph));
    ldr = mix(ldr, vec3(1.0), ring(d, uFocus.z, 1.5) * 0.9);
  }
  // User position: pulsing halo and heading wedge (the dot itself is a screen-space icon).
  if (uUser.w > 0.5) {
    vec2 dv = p - uUser.xy;
    float d = length(dv);
    float r = uUser.z;
    if (uUserHeading > -10.0 && d < 4.0 * r) {
      float hd = atan(dv.x, dv.y);
      float da = abs(mod(hd - uUserHeading + 3.14159265, 6.2831853) - 3.14159265);
      float wedge = (1.0 - smoothstep(0.42, 0.5, da)) * (1.0 - smoothstep(0.5 * r, 4.0 * r, d));
      ldr = mix(ldr, vec3(0.16, 0.5, 1.0), wedge * 0.5);
    }
    float ph = fract(uClock * 0.8);
    ldr = mix(ldr, vec3(0.1, 0.45, 0.95), ring(d, r * (0.6 + 1.6 * ph), 1.5) * (1.0 - ph) * 0.9);
  }
  // Brush preview.
  if (uBrush.z > 0.0) {
    float d = length(p - uBrush.xy);
    ldr = mix(ldr, uBrushColour, disc(d, uBrush.z) * 0.18);
    ldr = mix(ldr, vec3(0.0), ring(d, uBrush.z, 3.0) * 0.5);
    ldr = mix(ldr, uBrushColour, ring(d, uBrush.z, 1.6));
  }

  ldr = fsFog(ldr, vDist);
  gl_FragColor = vec4(ldr, 1.0);
  #include <colorspace_fragment>
}
`;

const SKIRT_VERT = /* glsl */ `
uniform float uVex;
attribute float aTop;
attribute vec2 aOut;
varying float vTop;
varying float vZ;
varying float vDist;
varying vec2 vOut;
varying vec2 vLocal;
void main() {
  vec3 w = vec3(position.x, position.z * uVex, -position.y);
  vTop = aTop;
  vZ = position.z;
  vOut = aOut;
  vLocal = position.xy;
  vec4 mv = viewMatrix * vec4(w, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const SKIRT_FRAG = /* glsl */ `
${NOISE}
${TONEMAP}
${FOG}
uniform vec3 uSunDir; uniform vec3 uSunColour; uniform float uSunI; uniform vec3 uSkyAmb; uniform float uAmbI;
uniform float uTopZ;
varying float vTop;
varying float vZ;
varying float vDist;
varying vec2 vOut;
varying vec2 vLocal;
void main() {
  vec3 n = normalize(vec3(vOut.x, 0.0, -vOut.y));
  float along = dot(vLocal, vec2(-vOut.y, vOut.x));
  // Sandstone / soil strata with depth.
  float band = fsNoise(vec2(along / 80.0, vZ / 7.0)) * 0.6 + 0.4 * sin(vZ * 0.35 + fsNoise(vec2(along / 300.0, 0.0)) * 4.0);
  vec3 soil = mix(vec3(0.3, 0.2, 0.13), vec3(0.52, 0.4, 0.29), 0.5 + 0.5 * band);
  soil = mix(soil * 0.6, soil, smoothstep(0.0, 1.0, vTop));
  vec3 light = (uSunColour * uSunI * max(dot(n, uSunDir), 0.0) * 0.7 + mix(vec3(0.5), uSkyAmb, 0.5) * uAmbI) / LIGHT_REF;
  vec3 ldr = fsDisplay(soil * light * 1.4);
  ldr = fsFog(ldr, vDist);
  gl_FragColor = vec4(ldr, 1.0);
  #include <colorspace_fragment>
}
`;

export interface TerrainDecals {
  brush: { x: number; y: number; radius: number; colour: THREE.Color } | null;
  spots: { x: number; y: number; radius: number }[];
  /** Ignition segments [x0, y0, x1, y1] (points are zero-length segments). */
  ignitionSegments: [number, number, number, number][];
  user: { x: number; y: number; radius: number; heading: number | null } | null;
  focus: { x: number; y: number; radius: number } | null;
}

/** Terrain mesh + material. Owns its textures. */
export class TerrainLayer {
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh;
  readonly skirt: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private readonly skirtMaterial: THREE.ShaderMaterial;
  readonly uniforms: Record<string, THREE.IUniform>;
  private textures = new Set<THREE.Texture>();
  private arrivalTex: THREE.DataTexture | null = null;
  private auxTex: THREE.DataTexture | null = null;
  private overlayTex: THREE.DataTexture | null = null;
  private lutTex: THREE.DataTexture | null = null;
  private glowTex: THREE.DataTexture | null = null;
  private albedoTex: THREE.DataTexture | null = null;
  private shadeTex: THREE.DataTexture | null = null;
  private imageryTex: THREE.Texture | null = null;
  private readonly shadeData: Uint8Array;
  readonly renderGrid: RenderGrid;

  /**
   * @param shared uniforms shared with the other layers (same-named entries replace the terrain's defaults, so
   *               lighting, time and exaggeration are set once for every material)
   */
  constructor(rg: RenderGrid, terrain: Terrain, shared: Record<string, THREE.IUniform>, private readonly maxAnisotropy = 4) {
    this.renderGrid = rg;
    const { geometry, skirt } = buildTerrainGeometry(rg.grid, rg.elevation, terrain.minElevation);
    const spots = Array.from({ length: MAX_SPOTS }, () => new THREE.Vector4());
    const ign = Array.from({ length: MAX_IGNITION_SEGMENTS }, () => new THREE.Vector4());
    const dF = dummyFloat(1e30);
    const dA = dummyRgba(0, 0, 0, 0);
    const dG = dummyRgba(0, 0, 0, 0);
    const dL = dummyRgba(0, 0, 0, 0, true);
    for (const t of [dF, dA, dG, dL]) this.textures.add(t);
    this.uniforms = {
      uVex: { value: 1 },
      uAlbedo: { value: dL },
      uAlbedoXf: { value: new THREE.Vector4(0, 0, 1, 1) },
      uImagery: { value: dL },
      uImageryXf: { value: new THREE.Vector4(0, 0, 1, 1) },
      uUseImagery: { value: 0 },
      uImageryFlipV: { value: 0 },
      uGrad: { value: dG },
      uGradXf: { value: new THREE.Vector4(...gridTransform(terrain.grid)) },
      uShade: { value: dA },
      uShadeXf: { value: new THREE.Vector4(...gridTransform(rg.grid)) },
      uArrival: { value: dF },
      uFireAux: { value: dA },
      uFireXf: { value: new THREE.Vector4(0, 0, 1, 1) },
      uHasFire: { value: 0 },
      uGlow: { value: dA },
      uGlowXf: { value: new THREE.Vector4(0, 0, 1, 1) },
      uGlowGain: { value: 3 },
      uOverlay: { value: dF },
      uOverlayXf: { value: new THREE.Vector4(0, 0, 1, 1) },
      uLut: { value: dL },
      uOverlayScale: { value: new THREE.Vector4(0, 1, 0, 0) },
      uOverlayNoData: { value: new THREE.Vector4(0, 0, 0, 0) },
      uOverlayOpacity: { value: 0.7 },
      uOverlayFire: { value: 0 },
      uTime: { value: 0 },
      uClock: { value: 0 },
      uIsoMinutes: { value: 30 },
      uIsoStrong: { value: 0 },
      uBurnBand: { value: 420 },
      uSunDir: { value: new THREE.Vector3(0.3, 0.8, -0.4).normalize() },
      uSunColour: { value: new THREE.Color(1, 0.95, 0.88) },
      uSunI: { value: 2.6 },
      uSkyAmb: { value: new THREE.Color(0.5, 0.6, 0.8) },
      uGroundAmb: { value: new THREE.Color(0.3, 0.26, 0.2) },
      uAmbI: { value: 0.65 },
      uNight: { value: 0 },
      uExposure: { value: 1 },
      uFogColour: { value: new THREE.Color(0.7, 0.78, 0.88) },
      uFogDensity: { value: 1 / 45000 },
      uBrush: { value: new THREE.Vector4(0, 0, 0, 0) },
      uBrushColour: { value: new THREE.Color(1, 1, 1) },
      uUser: { value: new THREE.Vector4(0, 0, 30, 0) },
      uUserHeading: { value: -100 },
      uFocus: { value: new THREE.Vector4(0, 0, 150, 0) },
      uSpots: { value: spots },
      uSpotCount: { value: 0 },
      uIgn: { value: ign },
      uIgnCount: { value: 0 },
      uPixelMetres: { value: 0.002 },
      ...shared,
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: TERRAIN_VERT,
      fragmentShader: TERRAIN_FRAG,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'terrain';
    this.skirtMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uVex: this.uniforms.uVex!,
        uSunDir: this.uniforms.uSunDir!,
        uSunColour: this.uniforms.uSunColour!,
        uSunI: this.uniforms.uSunI!,
        uSkyAmb: this.uniforms.uSkyAmb!,
        uAmbI: this.uniforms.uAmbI!,
        uExposure: this.uniforms.uExposure!,
        uFogColour: this.uniforms.uFogColour!,
        uFogDensity: this.uniforms.uFogDensity!,
        uTopZ: { value: terrain.maxElevation },
      },
      vertexShader: SKIRT_VERT,
      fragmentShader: SKIRT_FRAG,
      toneMapped: false,
    });
    this.skirt = new THREE.Mesh(skirt, this.skirtMaterial);
    this.skirt.frustumCulled = false;
    this.skirt.name = 'terrain-skirt';
    this.group.add(this.mesh, this.skirt);

    // Full-resolution Horn gradients as an RG16F normal texture.
    const n = terrain.grid.nx * terrain.grid.ny;
    const g2 = new Float32Array(n * 2);
    for (let k = 0; k < n; k++) {
      g2[k * 2] = terrain.dzdx[k]!;
      g2[k * 2 + 1] = terrain.dzdy[k]!;
    }
    const gradTex = halfRgTexture(g2, terrain.grid.nx, terrain.grid.ny);
    this.textures.add(gradTex);
    this.uniforms.uGrad!.value = gradTex;
    this.shadeData = new Uint8Array(rg.grid.nx * rg.grid.ny * 4);
  }

  private track<T extends THREE.Texture>(t: T): T {
    this.textures.add(t);
    return t;
  }
  private untrack(t: THREE.Texture | null): void {
    if (!t) return;
    this.textures.delete(t);
    t.dispose();
  }

  /** Natural ground colours from the fuel map. */
  setFuel(fuel: FuelMap, terrain: Terrain): void {
    const data = groundColours(fuel, terrain);
    this.untrack(this.albedoTex);
    this.albedoTex = this.track(rgbaTexture(data, fuel.grid.nx, fuel.grid.ny, { srgb: true, linear: true }));
    this.uniforms.uAlbedo!.value = this.albedoTex;
    (this.uniforms.uAlbedoXf!.value as THREE.Vector4).set(...gridTransform(fuel.grid));
  }

  /** Aerial imagery covering the grid's cell-edge extent (row 0 = north). */
  setImagery(imagery: SceneImagery | null, domain: GridSpec): void {
    this.untrack(this.imageryTex);
    this.imageryTex = null;
    if (!imagery) {
      this.uniforms.uImagery!.value = this.uniforms.uAlbedo!.value;
      return;
    }
    const src = imagery.image as TexImageSource;
    const t = new THREE.Texture(src as never);
    const isBitmap = typeof ImageBitmap !== 'undefined' && imagery.image instanceof ImageBitmap;
    t.flipY = !isBitmap; // ImageBitmaps ignore flipY: flip v in the shader instead
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = this.maxAnisotropy;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.needsUpdate = true;
    this.imageryTex = this.track(t);
    this.uniforms.uImagery!.value = t;
    this.uniforms.uImageryFlipV!.value = isBitmap ? 1 : 0;
    (this.uniforms.uImageryXf!.value as THREE.Vector4).set(...gridTransform(domain));
  }

  get hasImagery(): boolean {
    return this.imageryTex !== null;
  }

  setUseImagery(on: boolean): void {
    this.uniforms.uUseImagery!.value = on && this.imageryTex ? 1 : 0;
  }

  /** Hillshade (R), sky-view factor (G) and cast shadow (B), each 0–1 on the render grid. */
  setShade(hill: Float32Array | null, svf: Float32Array | null, shadow: Float32Array | null): void {
    const d = this.shadeData;
    const n = d.length / 4;
    for (let k = 0; k < n; k++) {
      if (hill) d[k * 4] = Math.round(Math.min(1, Math.max(0, hill[k]!)) * 255);
      if (svf) d[k * 4 + 1] = Math.round(Math.min(1, Math.max(0, svf[k]!)) * 255);
      if (shadow) d[k * 4 + 2] = Math.round(Math.min(1, Math.max(0, shadow[k]!)) * 255);
      d[k * 4 + 3] = 255;
    }
    const g = this.renderGrid.grid;
    this.shadeTex = refillRgba(this.shadeTex, d, g.nx, g.ny, false, true);
    this.textures.add(this.shadeTex);
    this.uniforms.uShade!.value = this.shadeTex;
  }

  /** Fire textures for a snapshot (arrival R32F with halo, aux RGBA8). */
  setFire(fire: FireField | null, arrival: Float32Array | null, aux: Uint8Array | null): void {
    if (!fire || !arrival || !aux) {
      this.uniforms.uHasFire!.value = 0;
      return;
    }
    const g = fire.grid;
    const a = refillFloat(this.arrivalTex, arrival, g.nx, g.ny);
    if (a !== this.arrivalTex) {
      if (this.arrivalTex) this.textures.delete(this.arrivalTex);
      this.arrivalTex = this.track(a);
    }
    // Linear filtering only affects texture() lookups (flame height); burn state uses texelFetch.
    const x = refillRgba(this.auxTex, aux, g.nx, g.ny, false, true);
    if (x !== this.auxTex) {
      if (this.auxTex) this.textures.delete(this.auxTex);
      this.auxTex = this.track(x);
    }
    this.uniforms.uArrival!.value = this.arrivalTex;
    this.uniforms.uFireAux!.value = this.auxTex;
    (this.uniforms.uFireXf!.value as THREE.Vector4).set(...gridTransform(g));
    this.uniforms.uHasFire!.value = 1;
  }

  setGlow(grid: GridSpec | null, data: Float32Array | null): void {
    this.untrack(this.glowTex);
    this.glowTex = null;
    if (!grid || !data) return;
    this.glowTex = this.track(r8Texture(data, grid.nx, grid.ny));
    this.uniforms.uGlow!.value = this.glowTex;
    (this.uniforms.uGlowXf!.value as THREE.Vector4).set(...gridTransform(grid));
  }

  /** Current overlay (null = off). `fireDerived` hides the overlay where the fire has not arrived at display time. */
  setOverlay(field: OverlayField | null, scale: OverlayScale | null, fireDerived: boolean): void {
    if (!field || !scale) {
      (this.uniforms.uOverlayScale!.value as THREE.Vector4).set(0, 1, 0, 0);
      return;
    }
    const g = field.grid;
    const t = refillFloat(this.overlayTex, field.values, g.nx, g.ny);
    if (t !== this.overlayTex) {
      if (this.overlayTex) this.textures.delete(this.overlayTex);
      this.overlayTex = this.track(t);
    }
    this.untrack(this.lutTex);
    this.lutTex = this.track(lutTexture(scale.lut));
    this.uniforms.uOverlay!.value = this.overlayTex;
    this.uniforms.uLut!.value = this.lutTex;
    (this.uniforms.uOverlayXf!.value as THREE.Vector4).set(...gridTransform(g));
    const mode = { ramp: 1, classes: 2, categorical: 3, cyclic: 4 }[scale.mode];
    (this.uniforms.uOverlayScale!.value as THREE.Vector4).set(scale.lo, scale.hi, mode, scale.log ? 1 : 0);
    // No-data colour is sRGB: convert to linear for blending.
    const nd = scale.noData;
    const c = new THREE.Color().setRGB(nd[0], nd[1], nd[2], THREE.SRGBColorSpace);
    (this.uniforms.uOverlayNoData!.value as THREE.Vector4).set(c.r, c.g, c.b, nd[3]);
    this.uniforms.uOverlayFire!.value = fireDerived ? 1 : 0;
  }

  setDecals(d: TerrainDecals): void {
    const u = this.uniforms;
    if (d.brush) {
      (u.uBrush!.value as THREE.Vector4).set(d.brush.x, d.brush.y, d.brush.radius, 0);
      (u.uBrushColour!.value as THREE.Color).copy(d.brush.colour);
    } else (u.uBrush!.value as THREE.Vector4).set(0, 0, 0, 0);
    const spots = u.uSpots!.value as THREE.Vector4[];
    const ns = Math.min(MAX_SPOTS, d.spots.length);
    for (let s = 0; s < ns; s++) spots[s]!.set(d.spots[s]!.x, d.spots[s]!.y, d.spots[s]!.radius, s * 1.7);
    u.uSpotCount!.value = ns;
    const ign = u.uIgn!.value as THREE.Vector4[];
    const ni = Math.min(MAX_IGNITION_SEGMENTS, d.ignitionSegments.length);
    for (let s = 0; s < ni; s++) ign[s]!.set(...d.ignitionSegments[s]!);
    u.uIgnCount!.value = ni;
    if (d.user) {
      (u.uUser!.value as THREE.Vector4).set(d.user.x, d.user.y, d.user.radius, 1);
      u.uUserHeading!.value = d.user.heading === null || !Number.isFinite(d.user.heading) ? -100 : (d.user.heading * Math.PI) / 180;
    } else (u.uUser!.value as THREE.Vector4).setW(0);
    if (d.focus) (u.uFocus!.value as THREE.Vector4).set(d.focus.x, d.focus.y, d.focus.radius, 1);
    else (u.uFocus!.value as THREE.Vector4).setW(0);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.skirt.geometry.dispose();
    this.material.dispose();
    this.skirtMaterial.dispose();
    for (const t of this.textures) t.dispose();
    this.textures.clear();
  }
}

/**
 * Indexed triangle mesh of the render grid (positions in local x, y, z ASL) — each quad is split along the diagonal
 * with the smaller height difference so ridges and gullies are not sawn across — plus a skirt down to
 * `minElevation − depth` around the domain edge.
 */
export function buildTerrainGeometry(
  g: GridSpec,
  z: Float32Array,
  minElevation: number,
): { geometry: THREE.BufferGeometry; skirt: THREE.BufferGeometry } {
  const { nx, ny, cellSize: h } = g;
  const pos = new Float32Array(nx * ny * 3);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      pos[k * 3] = g.x0 + i * h;
      pos[k * 3 + 1] = g.y0 + j * h;
      pos[k * 3 + 2] = z[k]!;
    }
  }
  const quads = (nx - 1) * (ny - 1);
  const index = nx * ny > 65535 ? new Uint32Array(quads * 6) : new Uint16Array(quads * 6);
  let o = 0;
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i; // SW
      const b = a + 1; // SE
      const c = a + nx; // NW
      const d = c + 1; // NE
      // Counter-clockwise seen from above (the local→world mapping is a proper rotation, so front faces point up).
      if (Math.abs(z[a]! - z[d]!) <= Math.abs(z[b]! - z[c]!)) {
        index[o++] = a;
        index[o++] = b;
        index[o++] = d;
        index[o++] = a;
        index[o++] = d;
        index[o++] = c;
      } else {
        index[o++] = a;
        index[o++] = b;
        index[o++] = c;
        index[o++] = b;
        index[o++] = d;
        index[o++] = c;
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));

  // Skirt: walk the boundary counter-clockwise (S edge W→E, E edge S→N, N edge E→W, W edge N→S).
  const ring: [number, number, number, number][] = []; // [i, j, outX, outY]
  for (let i = 0; i < nx; i++) ring.push([i, 0, 0, -1]);
  for (let j = 1; j < ny; j++) ring.push([nx - 1, j, 1, 0]);
  for (let i = nx - 2; i >= 0; i--) ring.push([i, ny - 1, 0, 1]);
  for (let j = ny - 2; j >= 1; j--) ring.push([0, j, -1, 0]);
  ring.push(ring[0]!);
  const depth = Math.max(80, 0.04 * Math.max(nx, ny) * h);
  const zb = minElevation - depth;
  const sp: number[] = [];
  const top: number[] = [];
  const out: number[] = [];
  const sIdx: number[] = [];
  for (let r = 0; r < ring.length - 1; r++) {
    const [i0, j0, ox0, oy0] = ring[r]!;
    const [i1, j1] = ring[r + 1]!;
    // Use this edge's outward normal for both columns (sharp corners).
    const e = [ox0, oy0];
    const base = sp.length / 3;
    for (const [i, j] of [
      [i0, j0],
      [i1, j1],
    ] as [number, number][]) {
      const x = g.x0 + i * h;
      const y = g.y0 + j * h;
      sp.push(x, y, z[j * nx + i]!, x, y, zb);
      top.push(1, 0);
      out.push(e[0]!, e[1]!, e[0]!, e[1]!);
    }
    // base+0 top0, +1 bottom0, +2 top1, +3 bottom1 — outward-facing.
    sIdx.push(base, base + 1, base + 3, base, base + 3, base + 2);
  }
  const skirt = new THREE.BufferGeometry();
  skirt.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  skirt.setAttribute('aTop', new THREE.Float32BufferAttribute(top, 1));
  skirt.setAttribute('aOut', new THREE.Float32BufferAttribute(out, 2));
  skirt.setIndex(sIdx);
  return { geometry, skirt };
}
