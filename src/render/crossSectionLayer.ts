/**
 * Vertical cross-section of the atmosphere (layers.crossSection): a curtain standing on the terrain profile along a
 * line through `centre` at `azimuth`, coloured by the potential-temperature anomaly (warm red / cold blue, smoke
 * greying the colour) with in-plane wind arrows (along-section component and w). Arrows blowing against the section's
 * upper-level wind are drawn cyan: that is lee-side reverse flow and katabatic drainage under a ridge-top wind — the
 * most counter-intuitive mountain behaviour (doc 09 §8.6).
 *
 * The curtain's rows follow the terrain (row 0 on the ground, the last row at the model top), and the colour texture
 * is computed on the CPU on exactly that lattice, so there is no resampling in the shader.
 */
import * as THREE from 'three';
import { sectionLine, type AtmosphereSampler, type SectionLine } from './atmosphereSampler';
import { FOG, TONEMAP } from './glsl';
import { THETA_RAMP, sampleRamp, srgbToLinear, type Rgb } from './palette';
import { StreakBatch } from './streaks';

const SECTION_VERT = /* glsl */ `
uniform float uVex;
varying vec2 vUv;
varying float vZ;
varying float vDist;
void main() {
  vec3 w = vec3(position.x, position.z * uVex, -position.y);
  vUv = uv;
  vZ = position.z;
  vec4 mv = viewMatrix * vec4(w, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const SECTION_FRAG = /* glsl */ `
${TONEMAP}
${FOG}
uniform sampler2D uTex;
uniform float uOpacity;
varying vec2 vUv;
varying float vZ;
varying float vDist;
void main() {
  vec4 c = texture(uTex, vUv);
  // White frame along the top and the ends, a dark ground line along the terrain profile, faint height lines every
  // 500 m (all constant pixel width via fwidth).
  vec2 fw = fwidth(vUv);
  float frame = max(1.0 - smoothstep(fw.y * 1.0, fw.y * 2.5, 1.0 - vUv.y),
                max(1.0 - smoothstep(fw.x * 1.0, fw.x * 2.5, vUv.x), 1.0 - smoothstep(fw.x * 1.0, fw.x * 2.5, 1.0 - vUv.x)));
  float groundLine = 1.0 - smoothstep(fw.y * 1.5, fw.y * 3.0, vUv.y);
  float hz = vZ / 500.0;
  float hl = 1.0 - smoothstep(0.0, 1.5 * fwidth(hz), abs(fract(hz + 0.5) - 0.5));
  vec3 col = mix(c.rgb, vec3(0.1), hl * 0.3);
  col = mix(col, vec3(1.0), frame * 0.9);
  col = mix(col, vec3(0.08, 0.06, 0.05), groundLine);
  float a = max(max(c.a * uOpacity, frame * 0.9), groundLine * 0.95);
  gl_FragColor = vec4(fsFog(col, vDist * 0.5), a);
  #include <colorspace_fragment>
}
`;

export interface SectionSpec {
  centre: [number, number];
  azimuth: number;
}

export class CrossSectionLayer {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh | null = null;
  private geom: THREE.BufferGeometry | null = null;
  private tex: THREE.DataTexture | null = null;
  private readonly mat: THREE.ShaderMaterial;
  readonly arrows: StreakBatch;
  /** Dark halo drawn under the arrows so white/cyan arrows read on the pale (neutral) parts of the section. */
  private readonly halo: StreakBatch;
  private readonly cols = 128;
  private readonly rows = 48;
  line: SectionLine | null = null;

  constructor(shared: Record<string, THREE.IUniform>) {
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uVex: shared.uVex!,
        uExposure: shared.uExposure!,
        uFogColour: shared.uFogColour!,
        uFogDensity: shared.uFogDensity!,
        uTex: { value: null },
        uOpacity: { value: 0.92 },
      },
      vertexShader: SECTION_VERT,
      fragmentShader: SECTION_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.halo = new StreakBatch({ capacity: 400, widthPx: 5, headPx: 13, shared, fog: false });
    this.halo.mesh.renderOrder = 9;
    this.arrows = new StreakBatch({ capacity: 400, widthPx: 2.2, headPx: 9, shared, fog: false });
    this.arrows.mesh.renderOrder = 10;
    this.group.add(this.halo.mesh, this.arrows.mesh);
    this.group.name = 'cross-section';
  }

  /**
   * Rebuild the curtain and arrows.
   * @param bounds    domain rectangle (local m)
   * @param heightAt  ground elevation (m ASL)
   */
  update(
    spec: SectionSpec,
    bounds: { xMin: number; xMax: number; yMin: number; yMax: number },
    heightAt: (x: number, y: number) => number,
    sampler: AtmosphereSampler,
    vex: number,
    dpr: number,
  ): void {
    const line = sectionLine(bounds, spec.centre, spec.azimuth);
    this.line = line;
    if (!line) {
      if (this.mesh) this.mesh.visible = false;
      this.arrows.commit(0);
      this.halo.commit(0);
      return;
    }
    const M = this.cols;
    const N = this.rows;
    const top = sampler.top;
    const pos = new Float32Array(M * N * 3);
    const uv = new Float32Array(M * N * 2);
    const data = new Uint8Array(M * N * 4);
    const c: Rgb = [0, 0, 0];
    let smokeMax = 1e-9;
    const smoke = new Float32Array(M * N);
    const theta = new Float32Array(M * N);
    for (let m = 0; m < M; m++) {
      const s = m / (M - 1);
      const x = line.a[0] + (line.b[0] - line.a[0]) * s;
      const y = line.a[1] + (line.b[1] - line.a[1]) * s;
      const g = heightAt(x, y);
      for (let r = 0; r < N; r++) {
        const t = r / (N - 1);
        // Denser rows near the ground where katabatic / anabatic layers live.
        const z = g + (top - g) * t ** 1.5;
        const k = r * M + m;
        pos[k * 3] = x;
        pos[k * 3 + 1] = y;
        pos[k * 3 + 2] = z;
        uv[k * 2] = s;
        uv[k * 2 + 1] = t;
        theta[k] = sampler.theta(x, y, z);
        smoke[k] = sampler.smoke(x, y, z);
        if (smoke[k]! > smokeMax) smokeMax = smoke[k]!;
      }
    }
    for (let k = 0; k < M * N; k++) {
      sampleRamp(THETA_RAMP, theta[k]!, c);
      const sm = Math.min(1, smoke[k]! / (smokeMax * 0.6)) * 0.3;
      const grey = 0.45;
      data[k * 4] = Math.round((c[0] * (1 - sm) + grey * sm) * 255);
      data[k * 4 + 1] = Math.round((c[1] * (1 - sm) + grey * sm) * 255);
      data[k * 4 + 2] = Math.round((c[2] * (1 - sm) + grey * sm) * 255);
      // Neutral air is a little more transparent so the terrain behind still shows, but the section must read as a
      // solid "slice" of the atmosphere, not a haze.
      const strength = Math.min(1, Math.abs(theta[k]!) / 1.5);
      data[k * 4 + 3] = Math.round((0.58 + 0.4 * Math.max(strength, sm)) * 255);
    }
    const index: number[] = [];
    for (let r = 0; r < N - 1; r++) {
      for (let m = 0; m < M - 1; m++) {
        const a = r * M + m;
        index.push(a, a + 1, a + M + 1, a, a + M + 1, a + M);
      }
    }
    this.geom?.dispose();
    this.geom = new THREE.BufferGeometry();
    this.geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.geom.setIndex(index);
    if (this.tex && this.tex.image.width === M && this.tex.image.height === N) {
      (this.tex.image.data as Uint8Array).set(data);
      this.tex.needsUpdate = true;
    } else {
      this.tex?.dispose();
      this.tex = new THREE.DataTexture(data, M, N, THREE.RGBAFormat, THREE.UnsignedByteType);
      this.tex.colorSpace = THREE.SRGBColorSpace;
      this.tex.magFilter = THREE.LinearFilter;
      this.tex.minFilter = THREE.LinearFilter;
      this.tex.needsUpdate = true;
    }
    this.mat.uniforms.uTex!.value = this.tex;
    if (!this.mesh) {
      this.mesh = new THREE.Mesh(this.geom, this.mat);
      this.mesh.frustumCulled = false;
      this.mesh.renderOrder = 7;
      this.group.add(this.mesh);
    } else this.mesh.geometry = this.geom;
    this.mesh.visible = true;

    // Wind arrows in the plane.
    const MA = 15;
    const heightsAgl = [30, 150, 400, 800, 1400, 2200];
    const spacing = line.length / MA;
    const w = new Float32Array(3);
    // Reference direction: mean along-section wind at the upper levels.
    let refAlong = 0;
    for (let m = 0; m < MA; m++) {
      const s = (m + 0.5) / MA;
      const x = line.a[0] + (line.b[0] - line.a[0]) * s;
      const y = line.a[1] + (line.b[1] - line.a[1]) * s;
      sampler.wind(x, y, top - 300, 1000, w);
      refAlong += w[0]! * line.dir[0] + w[1]! * line.dir[1];
    }
    const refSign = Math.sign(refAlong) || 1;
    let o = 0;
    const A = this.arrows.a;
    const B = this.arrows.b;
    const C = this.arrows.c;
    const white = [1, 1, 1];
    const cyan = [srgbToLinear(0.2), srgbToLinear(0.95), srgbToLinear(1.0)];
    for (let m = 0; m < MA; m++) {
      const s = (m + 0.5) / MA;
      const x = line.a[0] + (line.b[0] - line.a[0]) * s;
      const y = line.a[1] + (line.b[1] - line.a[1]) * s;
      const g = heightAt(x, y);
      for (const agl of heightsAgl) {
        const z = g + agl;
        if (z > top - 50) break;
        sampler.wind(x, y, z, agl, w);
        const along = w[0]! * line.dir[0] + w[1]! * line.dir[1];
        const vert = w[2]!;
        const sp = Math.hypot(along, vert);
        if (sp < 0.3) continue;
        const len = spacing * 0.85 * Math.min(1, 0.25 + sp / 14);
        const ux = (along / sp) * len;
        const uz = (vert / sp) * len;
        // Centre the arrow on the sample point.
        const x0 = x - line.dir[0] * ux * 0.5;
        const y0 = y - line.dir[1] * ux * 0.5;
        const x1 = x + line.dir[0] * ux * 0.5;
        const y1 = y + line.dir[1] * ux * 0.5;
        A[o * 3] = x0;
        A[o * 3 + 1] = (z - uz * 0.5) * vex;
        A[o * 3 + 2] = -y0;
        B[o * 3] = x1;
        B[o * 3 + 1] = (z + uz * 0.5) * vex;
        B[o * 3 + 2] = -y1;
        const reverse = Math.sign(along) !== refSign && Math.abs(along) > 1 && agl < 700;
        const col = reverse ? cyan : white;
        C[o * 4] = col[0]!;
        C[o * 4 + 1] = col[1]!;
        C[o * 4 + 2] = col[2]!;
        C[o * 4 + 3] = 0.95;
        o++;
        if (o >= this.arrows.capacity) break;
      }
    }
    this.arrows.commit(o);
    this.arrows.widthPx = 2.4 * dpr;
    this.arrows.uniforms.uHeadPx!.value = 10 * dpr;
    // Halo: same segments, black, wider.
    this.halo.a.set(A.subarray(0, o * 3));
    this.halo.b.set(B.subarray(0, o * 3));
    const HC = this.halo.c;
    for (let i = 0; i < o; i++) {
      HC[i * 4] = 0.01;
      HC[i * 4 + 1] = 0.01;
      HC[i * 4 + 2] = 0.015;
      HC[i * 4 + 3] = 0.7;
    }
    this.halo.commit(o);
    this.halo.widthPx = 5.4 * dpr;
    this.halo.uniforms.uHeadPx!.value = 14 * dpr;
  }

  set visible(v: boolean) {
    this.group.visible = v;
  }

  dispose(): void {
    this.geom?.dispose();
    this.tex?.dispose();
    this.mat.dispose();
    this.arrows.dispose();
    this.halo.dispose();
  }
}
