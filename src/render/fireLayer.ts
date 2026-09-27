/**
 * Flames: instanced, cylindrically camera-facing, procedurally animated billboards at flame sites along the front
 * (fields.ts flameSites). Each flame knows its cell's arrival time and flame life, and the vertex shader shows it only
 * while 0 ≤ displayTime − arrival ≤ life, so the flaming front sweeps smoothly between snapshots. Height is the
 * model's flame height (min 0.5 m) times a zoom-dependent visibility factor, leaning downwind; screen blending.
 */
import * as THREE from 'three';
import type { FlameSite } from './fields';
import { NOISE, TONEMAP } from './glsl';

const FLAME_VERT = /* glsl */ `
uniform float uVex;
uniform float uTime;
uniform float uClock;
uniform float uFlameScale;
uniform float uMinWidth;
uniform float uMinAngle;
uniform vec2 uLean;
attribute vec4 aSite;   // x, y, z ASL, arrival
attribute vec4 aProps;  // flame height, intensity, life, rand
varying vec2 vUv;
varying float vAlpha;
varying float vHeat;
varying float vRand;
varying float vBoost;
void main() {
  float dt = uTime - aSite.w;
  float life = aProps.z;
  float a = smoothstep(0.0, 30.0, dt) * (1.0 - smoothstep(life * 0.55, life * 1.35, dt));
  if (dt < 0.0 || a <= 0.001) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }
  float fresh = 1.0 - smoothstep(0.0, life, dt);
  float flick = 0.8 + 0.35 * sin(uClock * (7.0 + aProps.w * 5.0) + aProps.w * 60.0) * sin(uClock * 3.1 + aProps.w * 17.0);
  // Real flame height (≥ 0.5 m), but never smaller than a minimum on-screen size so the front stays visible when
  // zoomed out (the trainee sees WHERE it burns; close up the true height shows).
  vec3 basePos = vec3(aSite.x, aSite.z * uVex, -aSite.y);
  float camDist = distance(basePos, cameraPosition);
  float heatN = smoothstep(2.0, 4.3, log(max(aProps.y, 10.0)) / log(10.0)); // 100 kW/m → 0, 20 000 kW/m → 1
  float hReal = max(aProps.x, 0.5) * uFlameScale;
  float h = max(hReal, camDist * uMinAngle * (0.3 + 0.7 * heatN)) * (0.45 + 0.55 * fresh) * flick;
  // Enlarged (zoomed-out) flames overlap many neighbours: dim them so the additive front stays orange, not white.
  vBoost = mix(0.3, 1.0, clamp(hReal / h, 0.0, 1.0));
  float w = max(h * 0.62, uMinWidth);
  // View-aligned billboard whose "up" is the world vertical projected on the screen: upright flames in oblique and
  // ground views, and still-readable flame glyphs (instead of edge-on slivers) when looking straight down.
  vec3 base = vec3(aSite.x, aSite.z * uVex, -aSite.y);
  vec4 mv = viewMatrix * vec4(base, 1.0);
  vec2 up2 = (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xy;
  float fore = length(up2);
  up2 = fore > 1e-3 ? up2 / fore : vec2(0.0, 1.0);
  fore = max(fore, 0.6);
  vec2 right2 = vec2(up2.y, -up2.x);
  vec2 lean = (viewMatrix * vec4(uLean.x, 0.0, -uLean.y, 0.0)).xy * position.y * position.y * h;
  mv.xy += right2 * position.x * w + up2 * (position.y - 0.12) * h * fore + lean;
  gl_Position = projectionMatrix * mv;
  vUv = vec2(position.x, position.y);
  vAlpha = a;
  vHeat = clamp(log(max(aProps.y, 10.0)) / log(10.0) / 4.5, 0.2, 1.0) * (0.6 + 0.4 * fresh);
  vRand = aProps.w;
}
`;

const FLAME_FRAG = /* glsl */ `
${NOISE}
${TONEMAP}
uniform float uClock;
uniform float uNight;
varying vec2 vUv;
varying float vAlpha;
varying float vHeat;
varying float vRand;
varying float vBoost;
void main() {
  float y = vUv.y;
  // Turbulent teardrop: narrowing with height, noise rising with time.
  float n = fsNoise(vec2(vUv.x * 3.2 + vRand * 17.0, y * 3.0 - uClock * 2.6 + vRand * 5.0));
  float n2 = fsNoise(vec2(vUv.x * 7.0 - vRand * 9.0, y * 6.0 - uClock * 4.1));
  float halfW = 0.5 * (1.0 - pow(y, 1.4)) * (0.75 + 0.5 * n);
  float x = abs(vUv.x + (n2 - 0.5) * 0.18 * y);
  float body = 1.0 - smoothstep(halfW * 0.6, halfW, x);
  body *= smoothstep(0.0, 0.06, y) * (1.0 - smoothstep(0.62 + 0.3 * n, 1.0, y));
  if (body <= 0.01) discard;
  float core = (1.0 - smoothstep(0.0, halfW * 0.6, x)) * (1.0 - smoothstep(0.05, 0.45, y));
  vec3 red = vec3(0.75, 0.08, 0.01);
  vec3 orange = vec3(1.0, 0.32, 0.03);
  vec3 yellow = vec3(1.0, 0.7, 0.22);
  vec3 c = mix(red, orange, smoothstep(0.15, 0.7, body) * (1.0 - 0.5 * y));
  c = mix(c, yellow, core * 0.85);
  float gain = (0.9 + 1.3 * vHeat) * (1.0 + 0.5 * uNight);
  vec3 ldr = fsTonemap(c * gain * (0.35 + 0.65 * body));
  gl_FragColor = vec4(ldr * vAlpha * body * vBoost, 1.0);
  #include <colorspace_fragment>
}
`;

export class FlameLayer {
  readonly mesh: THREE.Mesh;
  private readonly geom: THREE.InstancedBufferGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private site: Float32Array;
  private props: Float32Array;
  private attrSite: THREE.InstancedBufferAttribute;
  private attrProps: THREE.InstancedBufferAttribute;
  readonly uniforms: Record<string, THREE.IUniform>;
  private _count = 0;

  constructor(shared: Record<string, THREE.IUniform>, capacity = 5000) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.site = new Float32Array(capacity * 4);
    this.props = new Float32Array(capacity * 4);
    this.attrSite = new THREE.InstancedBufferAttribute(this.site, 4).setUsage(THREE.DynamicDrawUsage);
    this.attrProps = new THREE.InstancedBufferAttribute(this.props, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aSite', this.attrSite);
    g.setAttribute('aProps', this.attrProps);
    g.instanceCount = 0;
    this.geom = g;
    this.uniforms = {
      uFlameScale: { value: 1 },
      uMinWidth: { value: 4 },
      uMinAngle: { value: 0.012 },
      uLean: { value: new THREE.Vector2(0, 0) },
    };
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uVex: shared.uVex!,
        uTime: shared.uTime!,
        uClock: shared.uClock!,
        uNight: shared.uNight!,
        uExposure: shared.uExposure!,
        ...this.uniforms,
      },
      vertexShader: FLAME_VERT,
      fragmentShader: FLAME_FRAG,
      transparent: true,
      depthWrite: false,
      // "Screen" blending (src + dst·(1 − src)): overlapping flames brighten towards yellow but never clip to a flat
      // white blob the way plain additive blending does at an intense head fire.
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcColorFactor,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'flames';
    this.mesh.renderOrder = 5;
  }

  get count(): number {
    return this._count;
  }

  /** Replace flame sites; `heightAt` gives the ground (m ASL) under a site. */
  setSites(sites: FlameSite[], heightAt: (x: number, y: number) => number): void {
    const cap = this.site.length / 4;
    if (sites.length > cap) {
      // Growing: release the old GPU buffers first (replaced attributes are otherwise never freed by three.js).
      this.geom.dispose();
      const n = Math.min(20000, Math.ceil(sites.length * 1.25));
      this.site = new Float32Array(n * 4);
      this.props = new Float32Array(n * 4);
      this.attrSite = new THREE.InstancedBufferAttribute(this.site, 4).setUsage(THREE.DynamicDrawUsage);
      this.attrProps = new THREE.InstancedBufferAttribute(this.props, 4).setUsage(THREE.DynamicDrawUsage);
      this.geom.setAttribute('aSite', this.attrSite);
      this.geom.setAttribute('aProps', this.attrProps);
    }
    const n = Math.min(sites.length, this.site.length / 4);
    for (let s = 0; s < n; s++) {
      const f = sites[s]!;
      this.site[s * 4] = f.x;
      this.site[s * 4 + 1] = f.y;
      this.site[s * 4 + 2] = heightAt(f.x, f.y);
      this.site[s * 4 + 3] = f.arrival;
      this.props[s * 4] = f.flameHeight;
      this.props[s * 4 + 1] = f.intensity;
      this.props[s * 4 + 2] = f.life;
      this.props[s * 4 + 3] = f.rand;
    }
    this.geom.instanceCount = n;
    this._count = n;
    this.attrSite.needsUpdate = true;
    this.attrProps.needsUpdate = true;
  }

  /**
   * Visibility rules: flames are at least `minPx` tall on screen (pxPerRad = viewport height / vertical fov), and at
   * least as wide as the spacing between flame sites so the front reads as a continuous line.
   */
  setView(pxPerRad: number, siteSpacing: number, minPx = 13): void {
    this.uniforms.uMinAngle!.value = minPx / Math.max(pxPerRad, 1);
    this.uniforms.uMinWidth!.value = siteSpacing * 1.1;
  }

  /** Flame lean (m per m of height, local east/north) from the wind. */
  setLean(u: number, v: number): void {
    const s = Math.hypot(u, v);
    const k = Math.min(0.9, s / 14) / Math.max(s, 1e-6);
    (this.uniforms.uLean!.value as THREE.Vector2).set(u * k, v * k);
  }

  dispose(): void {
    this.geom.dispose();
    this.mat.dispose();
  }
}
