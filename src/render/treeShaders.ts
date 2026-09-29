/**
 * GLSL of the 3-D canopy. One vertex and one fragment shader serve every species, level of detail and style; per-group
 * differences come from uniforms (uKind, bark colours, …) and per-instance attributes.
 *
 * Fire state is resolved on the GPU from the fire arrival / aux textures exactly as before (no per-snapshot CPU work):
 *   burning, phase 3   crown fire: the crown flares (flame tint), trunk glows at its base
 *   burnt,  phase 3    crown consumed (leaf cards collapse: a bare, charred skeleton of trunk and branches remains)
 *   burnt,  phase 2    scorched copper-brown crown, blackened lower trunk
 *   burnt,  phase ≤ 1  crown partly browned, charred trunk base
 *   shrubs and grass   consumed once burnt
 * Old fires (time since fire from the fuel map): charred trunk with green epicormic shoots, thin crowns that thicken again.
 *
 * Readability: instances fade out with a screen-door dither (never a blend, so no sorting) as the camera looks down steeply,
 * within a radius of active flames / glow, and very close to the eye-level camera, so trees never hide the fire.
 */
import { FOG, NOISE, TONEMAP } from './glsl';
import { MIN_LOBES } from './treeModels';

export const TREE_VERT = /* glsl */ `
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
uniform float uPxPerRad;
uniform float uCullPx;
uniform float uThinStart;
// species / level of detail
uniform float uKind;        // 0 eucalypt 1 tall gum 2 rainforest 3 snow gum 4 pine 5 heath 6 understorey 7 grass
uniform float uLod;         // 0 near 1 mid 2 far (billboard)
uniform float uStyle;       // 0 natural 1 simple 2 coded
uniform float uConsumable;  // shrubs and grass vanish when burnt
uniform float uLobeJit;     // per-tree jitter of the foliage lobes (unit space)
uniform float uLobeHide;    // probability that an optional lobe is missing on a tree
uniform vec3 uBarkCol[3];   // linear trunk colours of smooth / ribbon / stringy bark
uniform vec3 uSimpleCrown;  // linear colours of the simple style
uniform vec3 uSimpleTrunk;
// wind sway: direction (world x, z), lean, oscillation, flutter
uniform float uSway;
uniform vec2 uWindDir;
uniform vec3 uSwayAmp;
// visibility
uniform vec2 uTopFade;      // sine of the view elevation where the canopy starts / finishes fading out (top view)
uniform float uFireFade;    // 0–1 how much foliage thins out around active flames
uniform float uNearFade;    // radius (m) inside which trees fade out (eye-level camera), 0 = off
// colour coding
uniform float uCode;        // 0 height 1 cover 2 bark 3 understorey
uniform vec2 uCodeRange;
uniform sampler2D uCodeLut;
attribute vec3 aMat;        // part, ao, lobe
attribute vec3 aInst;
attribute vec2 aSize;
attribute vec2 aRand;
attribute vec4 aTint;
attribute vec4 aInfo;
attribute vec4 aAux;
varying vec3 vN;
varying vec2 vUv;
varying vec4 vTint;         // crown colour (linear), bark class
varying vec4 vPartAo;       // part, ao, height fraction, metres up the tree
varying vec4 vFire;         // flame emission, glow, char height, scorch
varying vec4 vState;        // epicormic amount, foliage fade, wood fade, distance
varying vec3 vTrunk;        // trunk colour (linear)
varying vec3 vObj;          // object-space metres (bark texture)
varying vec3 vView;         // unit vector to the camera
varying float vLitter;

float hsh(float a, float b) { return fract(sin(a * 127.1 + b * 311.7) * 43758.5453); }

void main() {
  vec3 base = vec3(aInst.x, aInst.z * uVex, -aInst.y);
  float H = aSize.x;
  float W = aSize.y;
  vec3 toCam = cameraPosition - base;
  float dist = length(toCam);
  float part = aMat.x;

  // ── Instance-wide culling, decided first so culled instances skip every fetch below ──
  float px = H / max(dist, 1.0) * uPxPerRad;
  float keep = clamp(uThinStart / max(dist, 1.0), 0.25, 1.0);
  float thin = fract(aRand.x * 97.13 + aRand.y * 13.71);
  float rad = 0.65 * max(H, W);
  vec4 cv = viewMatrix * vec4(base + vec3(0.0, 0.5 * H, 0.0), 1.0);
  float depth = -cv.z;
  bool outside = depth < -rad || abs(cv.x) > depth / projectionMatrix[0][0] + rad * 1.5 || abs(cv.y) > depth / projectionMatrix[1][1] + rad * 1.5;
  float sinEl = clamp(toCam.y / max(dist, 1e-3), -1.0, 1.0);
  // Looking down steeply (the camera's own pitch or the ray to this tree): fade out so the map below stays readable.
  float camDown = viewMatrix[1][2];
  float topFade = 1.0 - smoothstep(uTopFade.x, uTopFade.y, max(sinEl, camDown));
  // Eye-level camera: plants right in front of the viewer thin out, in proportion to their size (a crown in the face, not the shrubs).
  float nearR = uNearFade * clamp(H / 15.0, 0.2, 1.0);
  float nearFade = nearR > 0.0 ? smoothstep(0.35 * nearR, nearR, dist) : 1.0;
  if (px < uCullPx || (uLod > 1.5 && thin > keep) || outside || topFade < 0.03 || nearFade < 0.03) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }

  // ── Fire state at the instance ──
  float burnt = 0.0;
  float burning = 0.0;
  float phase = 0.0;
  if (uHasFire > 0.5) {
    vec2 uv0 = (aInst.xy - uFireXf.xy) / uFireXf.zw;
    if (uv0.x >= 0.0 && uv0.y >= 0.0 && uv0.x <= 1.0 && uv0.y <= 1.0) {
      ivec2 sz = textureSize(uArrival, 0);
      ivec2 c = clamp(ivec2(floor(uv0 * vec2(sz))), ivec2(0), sz - 1);
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
  float glow = 0.0;
  if (uHasFire > 0.5) glow = texture(uGlow, (aInst.xy - uGlowXf.xy) / uGlowXf.zw).r;
  bool shrubby = uKind > 4.5;
  bool consumedPlant = uConsumable > 0.5 && burnt > 0.5;
  float crownFire = burning * step(2.5, phase);
  float crownGone = burnt * step(2.5, phase);
  float scorched2 = burnt * step(1.5, phase) * (1.0 - step(2.5, phase));
  float scorched1 = burnt * (1.0 - step(1.5, phase));

  // Old fires (fuel map): years since the last recorded fire.
  float years = aInfo.w > 0.998 ? 99.0 : aInfo.w * 255.0 / 8.0;
  float regrow = uStyle < 0.5 ? smoothstep(0.3, 5.5, years) : 1.0;         // crown fullness returns over ~5 years
  float fullness = years > 9.0 ? 1.0 : mix(0.3, 1.0, regrow);
  float epi = uStyle < 0.5 ? smoothstep(0.25, 1.0, years) * (1.0 - smoothstep(3.0, 6.5, years)) : 0.0;
  float oldChar = uStyle < 0.5 ? 1.05 * (1.0 - smoothstep(1.5, 8.0, years)) : 0.0;

  // ── Local geometry ──
  bool isLeaf = part > 0.5 && part < 1.5;
  bool isStreamer = part > 1.5 && part < 2.5;
  bool isDecal = part > 2.5 && part < 3.5;
  bool isSolid = part > 3.5 && part < 4.5;
  bool isBoard = part > 4.5;
  bool foliage = isLeaf || isStreamer || isSolid;
  vec3 lp = position;
  float lobe = aMat.z;
  bool hidden = false;
  if (foliage) {
    if (uLobeJit > 0.0 && lobe > 0.5) {
      vec3 j = vec3(hsh(lobe, aRand.y * 17.0), hsh(lobe + 3.0, aRand.y * 29.0), hsh(lobe + 7.0, aRand.y * 41.0)) - 0.5;
      lp += j * vec3(1.0, 0.5, 1.0) * uLobeJit;
    }
    if (uLobeHide > 0.0 && lobe > ${(MIN_LOBES + 0.5).toFixed(1)} && hsh(lobe * 1.7, aRand.y * 91.7) < uLobeHide) hidden = true;
  }
  // Whole-tree lean and a little crookedness (per tree).
  lp.x += (aRand.y - 0.5) * 0.12 * lp.y * lp.y * (uKind > 2.5 && uKind < 3.5 ? 2.0 : 1.0);
  lp.z += (hsh(aRand.x, 5.0) - 0.5) * 0.08 * lp.y * lp.y;
  if (foliage) {
    // Crowns thin out after a fire and grow back; a crown fire consumes them.
    float k = crownGone > 0.5 ? 0.0 : fullness;
    lp.xz *= mix(0.35, 1.0, k);
    lp.y = mix(0.62, lp.y, mix(0.6, 1.0, k));
    if (crownGone > 0.5 || hidden) lp = vec3(0.0, lp.y * 0.6, 0.0);
  }
  if (consumedPlant) lp = vec3(0.0);

  float ang = aRand.x * 6.2831853;
  float cs = cos(ang);
  float sn = sin(ang);
  vec3 sp = vec3(lp.x * W, lp.y * H, lp.z * W);
  sp = vec3(cs * sp.x - sn * sp.z, sp.y, sn * sp.x + cs * sp.z);
  vec3 nn = normal;
  nn = vec3(cs * nn.x - sn * nn.z, nn.y, sn * nn.x + cs * nn.z);
  float h01 = clamp(lp.y, 0.0, 1.0);

  if (isBoard) {
    vec2 th = toCam.xz;
    float tl = length(th);
    th = tl > 1e-3 ? th / tl : vec2(0.0, 1.0);
    vec3 right = vec3(th.y, 0.0, -th.x);
    float flip = aRand.x > 0.5 ? -1.0 : 1.0;
    sp = right * (position.x * W * flip) + vec3(0.0, position.y * H, 0.0);
    nn = normalize(vec3(th.x * 0.75, 0.25 + 0.7 * position.y, th.y * 0.75));
    h01 = position.y;
  }
  if (isDecal) {
    // Lie on the slope, slightly above the ground (the more so, the further away).
    vec2 slope = (aAux.yz * 2.0 - 1.0) * 2.0;
    sp.y = uVex * (slope.x * sp.x - slope.y * sp.z) + 0.3 + dist * 0.0012;
    nn = vec3(0.0, 1.0, 0.0);
  }
  if (part < 0.5) sp.y -= 0.5 * (1.0 - smoothstep(0.0, 0.03, lp.y)); // roots: no gap when the ground dips

  // Wind: lean and sway of the crown (bending grows with height), flutter of leaves and streamers.
  if (uSway > 0.5 && uLod < 2.5 && !isDecal) {
    float bend = pow(clamp(h01, 0.0, 1.0), 1.7);
    float gust = 0.65 + 0.35 * sin(uClock * 0.41 + base.x * 0.013 + base.z * 0.011);
    float osc = sin(uClock * (0.75 + 0.4 * aRand.y) + aRand.x * 40.0 + base.x * 0.02);
    float sway = uSwayAmp.x * gust + uSwayAmp.y * osc * gust;
    sp.xz += uWindDir * sway * bend * H;
    if (uLod < 1.5 && (isLeaf || isStreamer) && !(crownGone > 0.5 || hidden)) {
      float f = uSwayAmp.z * W * gust * (isStreamer ? 2.4 : 1.0);
      sp.x += sin(uClock * 3.3 + position.x * 21.0 + aRand.x * 9.0) * f;
      sp.z += sin(uClock * 2.9 + position.z * 19.0 + aRand.y * 7.0) * f;
      sp.y += sin(uClock * 2.3 + position.y * 17.0) * f * 0.4;
    }
  }

  vec3 world = base + sp;
  vN = normalize(nn);
  vUv = uv;
  vView = normalize(cameraPosition - world);

  // ── Colour ──
  vec3 tint = pow(aTint.rgb, vec3(2.2));   // sRGB bytes → linear
  int bark = int(aTint.a * 255.0 + 0.5);
  vec3 trunkC = uBarkCol[clamp(bark, 0, 2)];
  if (uStyle > 0.5) {
    tint = uSimpleCrown * (0.94 + 0.12 * aRand.y);
    trunkC = uSimpleTrunk;
    if (uStyle > 1.5) {
      if (!shrubby || uCode > 2.5) {
        float v = uCode < 0.5 ? aAux.w * 255.0 * 0.25 : uCode < 1.5 ? aInfo.z * 100.0 : uCode < 2.5 ? aInfo.x * 4.0 : aInfo.y * 4.0;
        float u = clamp((v - uCodeRange.x) / (uCodeRange.y - uCodeRange.x), 0.0, 0.9999);
        tint = pow(textureLod(uCodeLut, vec2(u, 0.5), 0.0).rgb, vec3(2.2));
      }
    }
  }
  // Charred trunk and scorched crown (fire in this run, or an old fire from the fuel map).
  float charTop = burnt > 0.5 ? (phase >= 2.5 ? 1.12 : phase >= 1.5 ? 0.62 : 0.3) : 0.0;
  charTop = max(charTop, oldChar);
  float scorch = max(scorched2 * 1.0 + scorched1 * 0.5, uStyle < 0.5 ? 0.5 * (1.0 - smoothstep(0.1, 1.2, years)) : 0.0);
  float flame = 0.0;
  if (burning > 0.5) {
    float fl = fsNoise(vec2(aRand.x * 50.0, uClock * 3.0));
    if (foliage && crownFire > 0.5) flame = 0.6 + 0.8 * fl;
    else if (!foliage && !isDecal && crownFire < 0.5) flame = (1.0 - smoothstep(0.0, 0.35, h01)) * (0.5 + 0.6 * fl);
    else if (!foliage && !isDecal) flame = 0.25 * fl;
  }
  // Foliage thins out (dither) around active flames so the fire shows through; torching crowns stay more visible.
  // (the glow field is a 250 m blur: a tree in a burning cell counts as being at the flames whatever the glow says)
  float flameNear = max(burning, smoothstep(0.03, 0.2, glow));
  float fFade = 1.0 - uFireFade * flameNear * (crownFire > 0.5 ? 0.45 : 0.85);
  vTint = vec4(tint, aTint.a);
  vTrunk = trunkC;
  vPartAo = vec4(part, aMat.y, h01, lp.y * H);
  vFire = vec4(flame, glow, charTop, scorch);
  vState = vec4(isDecal ? burnt : epi, fFade * topFade * nearFade, topFade * nearFade, dist);
  vObj = sp + vec3(aRand.x * 31.0, 0.0, aRand.y * 17.0);
  vLitter = aAux.x;
  vec4 mv = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
}
`;

export const TREE_FRAG = /* glsl */ `
${NOISE}
${TONEMAP}
${FOG}
uniform vec3 uSunDir; uniform vec3 uSunColour; uniform float uSunI;
uniform vec3 uSkyAmb; uniform vec3 uGroundAmb; uniform float uAmbI; uniform float uGlowGain;
uniform float uStyle;
uniform float uNight;
uniform sampler2D uLeaf;
uniform sampler2D uImp;
varying vec3 vN;
varying vec2 vUv;
varying vec4 vTint;
varying vec4 vPartAo;
varying vec4 vFire;
varying vec4 vState;
varying vec3 vTrunk;
varying vec3 vObj;
varying vec3 vView;
varying float vLitter;

float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float luma3(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }
float sharpAlpha(float a) { float w = max(fwidth(a), 0.0001); return clamp((a - 0.5) / w + 0.5, 0.0, 1.0); }

void main() {
  float part = vPartAo.x;
  float ao = vPartAo.y;
  float h01 = vPartAo.z;
  bool isWood = part < 0.5;
  bool isLeaf = part > 0.5 && part < 1.5;
  bool isStreamer = part > 1.5 && part < 2.5;
  bool isDecal = part > 2.5 && part < 3.5;
  bool isSolid = part > 3.5 && part < 4.5;
  bool isBoard = part > 4.5;
  bool foliage = isLeaf || isStreamer || isSolid || isBoard;
  float trunkMask = 0.0;
  float fade = foliage ? vState.y : vState.z;
  float dith = ign(gl_FragCoord.xy);
  float scorch = vFire.w;
  float charTop = vFire.z;
  float glowL = vFire.y;
  float outA = 1.0;
  vec3 albedo = vec3(0.5);
  vec3 n = normalize(vN);
  float wrap = 0.1;
  float trans = 0.0;

  if (isWood) {
    n = normalize(gl_FrontFacing ? vN : -vN);
    int bk = int(vTint.a * 255.0 + 0.5);
    vec2 bp = vec2((vObj.x + vObj.z * 0.7) * 3.0, vPartAo.w * 0.55);
    if (uStyle < 0.5) {
      float f1 = fsNoise(vec2(bp.x * 6.0, bp.y));
      float f2 = fsNoise(vec2(bp.x * 17.0, bp.y * 2.6));
      if (bk >= 2) {
        // Stringybark: deep vertical fibres and furrows, dark and thick.
        float fib = f1 * 0.55 + f2 * 0.45;
        albedo = vTrunk * (0.45 + 1.15 * fib) * (0.7 + 0.3 * step(0.32, f1));
      } else if (bk == 1) {
        // Ribbon bark: pale, streaked, with darker peeling lines.
        albedo = vTrunk * (0.72 + 0.5 * f1) * (0.88 + 0.2 * f2);
      } else {
        // Smooth gum: pale and even with faint mottling.
        albedo = vTrunk * (0.9 + 0.22 * fsNoise(vec2(bp.x * 2.5, bp.y * 0.35)));
      }
    } else albedo = vTrunk;
    // Fire-blackened trunk (with pale ash flecks) and green epicormic shoots on old burns.
    float burntTrunk = step(h01, charTop);
    if (burntTrunk > 0.5) {
      float ash = fsNoise(vec2(bp.x * 12.0, bp.y * 1.4));
      albedo = mix(albedo, vec3(0.03, 0.027, 0.025) * (0.8 + 0.7 * ash), 0.94);
      float shoot = smoothstep(0.66, 0.8, fsNoise(vec2(bp.x * 9.0 + 3.0, bp.y * 2.3))) * vState.x;
      albedo = mix(albedo, vec3(0.16, 0.34, 0.06), shoot);
    }
    ao *= 1.0;
  } else if (isLeaf || isStreamer) {
    vec4 tx = texture(uLeaf, vUv);
    float a = sharpAlpha(tx.a);
    if (a < 0.3) discard;
    outA = a;
    if (isStreamer) {
      albedo = vTrunk * 1.35 * tx.rgb;
      n = normalize(gl_FrontFacing ? vN : -vN);
      wrap = 0.3;
    } else {
      albedo = vTint.rgb * tx.rgb * 1.6;
      wrap = 0.55;
      trans = 0.5;
    }
  } else if (isSolid) {
    albedo = vTint.rgb;
    wrap = 0.4;
  } else if (isBoard) {
    vec4 tx = texture(uImp, vUv);
    float a = sharpAlpha(tx.a);
    if (a < 0.3) discard;
    outA = a;
    trunkMask = step(0.5, tx.g);
    // The crown of a burnt-out tree (crown fire) is gone: only its trunk is left.
    if (charTop > 1.1 && trunkMask < 0.5) discard;
    vec3 crown = vTint.rgb * (0.42 + 0.85 * tx.r) * (0.78 + 0.28 * tx.b);
    // Far away, pale trunks would speckle the forest with white dots: blend them into the crown colour.
    vec3 trunk = mix(vTrunk * (0.6 + 0.9 * tx.r), crown * 0.75, smoothstep(250.0, 1500.0, vState.w));
    albedo = mix(crown, trunk, trunkMask);
    if (trunkMask > 0.5 && vPartAo.z < charTop) albedo = vec3(0.03);
    wrap = 0.5;
    ao = 0.85;
  }
  if ((isLeaf || isSolid || isBoard) && trunkMask < 0.5) {
    // Scorched foliage turns copper-brown.
    vec3 sc = vec3(0.19, 0.075, 0.025) * (0.6 + 0.7 * luma3(albedo));
    albedo = mix(albedo, sc, clamp(scorch, 0.0, 1.0));
  }

  if (isDecal) {
    // Contact shadow with leaf-litter tint: dark under the trunk, litter-coloured toward the edge, thicker with hazard.
    vec2 q = vUv * 2.0 - 1.0;
    float r = length(q);
    if (r > 1.0) discard;
    float sh = smoothstep(1.0, 0.1, r);
    float a = sh * (uStyle < 0.5 ? 0.5 : 0.4) * vState.z * (1.0 - 0.75 * vState.x);
    if (a < 0.05) discard;
    outA = a;
    vec3 litter = mix(vec3(0.05, 0.045, 0.03), vec3(0.16, 0.1, 0.05), vLitter);
    albedo = uStyle < 0.5 ? litter * (0.5 + 0.6 * r) : vec3(0.02);
    n = vec3(0.0, 1.0, 0.0);
    ao = 1.0;
    wrap = 0.0;
  } else if (fade < dith * 0.999) discard;

  float ndl = clamp((dot(n, uSunDir) + wrap) / (1.0 + wrap), 0.0, 1.0);
  vec3 sunL = uSunColour * uSunI;
  // Hemisphere ambient. Foliage undersides are lit by light scattered through and between the crowns and bounced off the
  // ground, so they never go black (wood and ground keep the plain ground colour).
  vec3 ambDown = foliage ? uGroundAmb + 0.5 * uSkyAmb : uGroundAmb;
  vec3 amb = mix(ambDown, uSkyAmb, 0.5 + 0.5 * n.y) * uAmbI;
  vec3 glow = vec3(1.0, 0.36, 0.09) * glowL * glowL * uGlowGain * 1.3;
  // Translucency: a crown lit from behind glows yellow-green.
  float back = pow(clamp(dot(-vView, uSunDir), 0.0, 1.0), 4.0) * trans;
  float aoS = clamp(ao, 0.0, 1.0);
  aoS = mix(1.0, aoS, uStyle < 0.5 ? 0.95 : 0.6);
  vec3 col = albedo * (sunL * ndl * 0.85 * (0.55 + 0.45 * aoS) + amb * 0.85 * aoS + glow + sunL * back * vec3(0.5, 0.75, 0.2) * 0.35) / LIGHT_REF;
  // A little moon/starlight so silhouettes and trunks stay readable on a dark night.
  col += albedo * uNight * 0.05 * vec3(0.32, 0.45, 0.75) * (0.5 + 0.5 * aoS);
  if (foliage) col *= 0.9;
  vec3 ldr = fsDisplay(col) + fsTonemap(vec3(1.0, 0.36, 0.06) * vFire.x * 2.2);
  ldr = fsFog(ldr, vState.w);
  gl_FragColor = vec4(ldr, outA);
  #include <colorspace_fragment>
}
`;
