/**
 * Vertical cross-section of the air (layers.crossSection): a curtain standing on the terrain profile along the slice's line,
 * coloured by the chip it is set to (wind speed, wind along or across the line, up and down air, temperature against the air
 * at that height, smoke; `sliceFieldScale` colours it, so it matches the legend and the side-view panel), with in-plane wind
 * arrows (along-section component and w). On the 3-D atmosphere, arrows blowing against the section's upper-level wind are
 * drawn cyan: that is lee-side reverse flow and katabatic drainage under a ridge-top wind, the most counter-intuitive
 * mountain behaviour (doc 09 §8.6). The fast tier's diagnosed wind has no such flow, so none are marked there.
 *
 * The curtain does not sample the air itself. It takes the `SliceData` the scene's one `SliceUpdater` computed (shared with the
 * side-view panel): its lattice is the texture, one texel per lattice point, rows linear in height from the lowest ground on the
 * line up (row 0 lowest), so there is no resampling in the shader. The ground profile is drawn from the 10 m ground under each
 * column, and everything under it is cut away; cells outside the model are transparent. The arrows read the sampler, except for a recorded
 * slice (0.4.1: `recordedAt`), whose air is not the picture's: they read its lattice, so they agree with its colours.
 */
import * as THREE from 'three';
import type { AtmosphereSampler, SectionLine } from './atmosphereSampler';
import { colourSlice } from './crossSectionColour';
import { FOG, TONEMAP } from './glsl';
import { srgbToLinear } from './palette';
import { LatticeStencil, latticeInPlaneWind, upperAlongMean } from './slice/lattice';
import type { SliceData, SliceFieldId } from './slice/types';
import { StreakBatch } from './streaks';

const SECTION_VERT = /* glsl */ `
uniform float uVex;
attribute float aGround;
varying vec2 vUv;
varying float vZ;
varying float vGround;
varying float vDist;
void main() {
  vec3 w = vec3(position.x, position.z * uVex, -position.y);
  vUv = uv;
  vZ = position.z;
  vGround = aGround;
  vec4 mv = viewMatrix * vec4(w, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const SECTION_FRAG = /* glsl */ `
${TONEMAP}
${FOG}
uniform sampler2D uTex;
uniform vec2 uTexSize;
uniform float uOpacity;
varying vec2 vUv;
varying float vZ;
varying float vGround;
varying float vDist;
void main() {
  // Texel centres sit on the lattice points, so the first and last texel are the two ends of the line and the lowest and highest row.
  vec4 c = texture(uTex, (vUv * (uTexSize - 1.0) + 0.5) / uTexSize);
  // White frame along the top and the ends, a dark ground line along the terrain profile, faint height lines every
  // 500 m (all constant pixel width via fwidth). Nothing is drawn under the ground: the curtain stands on the terrain.
  vec2 fw = fwidth(vUv);
  float fz = max(fwidth(vZ), 1e-3);
  float up = vZ - vGround;
  float above = smoothstep(-0.5 * fz, 0.0, up);
  float frame = max(1.0 - smoothstep(fw.y * 1.0, fw.y * 2.5, 1.0 - vUv.y),
                max(1.0 - smoothstep(fw.x * 1.0, fw.x * 2.5, vUv.x), 1.0 - smoothstep(fw.x * 1.0, fw.x * 2.5, 1.0 - vUv.x)));
  float groundLine = 1.0 - smoothstep(fz * 1.5, fz * 3.0, up);
  float hz = vZ / 500.0;
  float hl = 1.0 - smoothstep(0.0, 1.5 * fwidth(hz), abs(fract(hz + 0.5) - 0.5));
  vec3 col = mix(c.rgb, vec3(0.1), hl * 0.3);
  col = mix(col, vec3(1.0), frame * 0.9);
  col = mix(col, vec3(0.08, 0.06, 0.05), groundLine);
  float a = max(max(c.a * uOpacity, frame * 0.9), groundLine * 0.95) * above;
  gl_FragColor = vec4(fsFog(col, vDist * 0.5), a);
  #include <colorspace_fragment>
}
`;

export class CrossSectionLayer {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh | null = null;
  private geom: THREE.BufferGeometry | null = null;
  private tex: THREE.DataTexture | null = null;
  private pixels: Uint8Array | null = null;
  /** What the geometry was built for (lattice size, line, height range); it is rebuilt only when that changes. */
  private geomKey = '';
  private readonly mat: THREE.ShaderMaterial;
  readonly arrows: StreakBatch;
  /** Dark halo drawn under the arrows so white/cyan arrows read on the pale (neutral) parts of the section. */
  private readonly halo: StreakBatch;
  /** The line of the slice shown, or null while nothing is drawn. */
  line: SectionLine | null = null;
  /** Scratch of the arrows of a recorded slice (its lattice is read, not the sampler): the stencil, the point [s, z] and the answer [along, up]. */
  private readonly stencil = new LatticeStencil();
  private readonly at = new Float64Array(2);
  private readonly inPlane = new Float32Array(2);

  constructor(shared: Record<string, THREE.IUniform>) {
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uVex: shared.uVex!,
        uExposure: shared.uExposure!,
        uFogColour: shared.uFogColour!,
        uFogDensity: shared.uFogDensity!,
        uTex: { value: null },
        uTexSize: { value: new THREE.Vector2(1, 1) },
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

  /** Draw nothing: there is no slice (no line, the air holds no 3-D wind, a new scenario). */
  clear(): void {
    this.line = null;
    if (this.mesh) this.mesh.visible = false;
    this.arrows.commit(0);
    this.halo.commit(0);
  }

  /**
   * Draw the curtain and arrows for a slice.
   * @param data      the slice the scene computed
   * @param field     the chip to colour by (SliceUpdate.field)
   * @param heightAt  ground elevation (m ASL) for the arrows
   * @param sampler   the air, for the arrows
   */
  update(data: SliceData, field: SliceFieldId, heightAt: (x: number, y: number) => number, sampler: AtmosphereSampler, vex: number, dpr: number): void {
    this.line = data.line;
    this.buildGeometry(data);
    this.paint(data, field);
    this.mesh!.visible = true;
    this.drawArrows(data, heightAt, sampler, vex, dpr);
  }

  /** The curtain's two vertices per lattice column (bottom and top), rebuilt when the line or the lattice changes; the ground under each column is refreshed every time. */
  private buildGeometry(d: SliceData): void {
    const M = d.columns;
    const { a, b } = d.line;
    const key = `${M}|${a[0]},${a[1]}|${b[0]},${b[1]}|${d.zMin}|${d.zMax}`;
    if (!this.geom || key !== this.geomKey) {
      this.geomKey = key;
      const pos = new Float32Array(M * 2 * 3);
      const uv = new Float32Array(M * 2 * 2);
      const index: number[] = [];
      for (let c = 0; c < M; c++) {
        const s = c / (M - 1);
        const x = a[0] + (b[0] - a[0]) * s;
        const y = a[1] + (b[1] - a[1]) * s;
        for (let k = 0; k < 2; k++) {
          const v = c * 2 + k;
          pos[v * 3] = x;
          pos[v * 3 + 1] = y;
          pos[v * 3 + 2] = k === 0 ? d.zMin : d.zMax;
          uv[v * 2] = s;
          uv[v * 2 + 1] = k;
        }
        if (c < M - 1) index.push(c * 2, c * 2 + 2, c * 2 + 3, c * 2, c * 2 + 3, c * 2 + 1);
      }
      this.geom?.dispose();
      this.geom = new THREE.BufferGeometry();
      this.geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      this.geom.setAttribute('aGround', new THREE.BufferAttribute(new Float32Array(M * 2), 1));
      this.geom.setIndex(index);
      if (!this.mesh) {
        this.mesh = new THREE.Mesh(this.geom, this.mat);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 7;
        this.group.add(this.mesh);
      } else this.mesh.geometry = this.geom;
    }
    const g = this.geom!.getAttribute('aGround') as THREE.BufferAttribute;
    const arr = g.array as Float32Array;
    for (let c = 0; c < M; c++) {
      arr[c * 2] = d.ground[c]!;
      arr[c * 2 + 1] = d.ground[c]!;
    }
    g.needsUpdate = true;
  }

  /** The colour texture: the slice's lattice, one texel per lattice point. */
  private paint(d: SliceData, field: SliceFieldId): void {
    const M = d.columns;
    const N = d.rows;
    if (!this.tex || this.tex.image.width !== M || this.tex.image.height !== N) {
      this.tex?.dispose();
      this.pixels = new Uint8Array(M * N * 4);
      this.tex = new THREE.DataTexture(this.pixels, M, N, THREE.RGBAFormat, THREE.UnsignedByteType);
      this.tex.colorSpace = THREE.SRGBColorSpace;
      this.tex.magFilter = THREE.LinearFilter;
      this.tex.minFilter = THREE.LinearFilter;
      this.mat.uniforms.uTex!.value = this.tex;
      (this.mat.uniforms.uTexSize!.value as THREE.Vector2).set(M, N);
    }
    colourSlice(d, field, this.pixels!);
    this.tex.needsUpdate = true;
  }

  /** Wind arrows in the plane: 21 columns by the heights 30 to 2200 m above the ground (about twice as many as the first 15 by six), read from the sampler, or from the lattice of a recorded slice. */
  private drawArrows(d: SliceData, heightAt: (x: number, y: number) => number, sampler: AtmosphereSampler, vex: number, dpr: number): void {
    const line = d.line;
    const recorded = d.recordedAt !== undefined;
    const top = recorded ? d.topAsl : sampler.top;
    const MA = 21;
    const heightsAgl = [30, 100, 200, 350, 550, 800, 1100, 1500, 2200];
    const spacing = line.length / MA;
    const w = new Float32Array(3);
    // Reverse flow is a feature of the 3-D atmosphere: reference direction = mean along-section wind at the upper levels.
    const prognostic = d.kind === 'prognostic';
    let refAlong = 0;
    if (prognostic && recorded) refAlong = upperAlongMean(d, MA);
    else if (prognostic) {
      for (let m = 0; m < MA; m++) {
        const s = (m + 0.5) / MA;
        const x = line.a[0] + (line.b[0] - line.a[0]) * s;
        const y = line.a[1] + (line.b[1] - line.a[1]) * s;
        sampler.wind(x, y, top - 300, 1000, w);
        refAlong += w[0]! * line.dir[0] + w[1]! * line.dir[1];
      }
    }
    const refSign = Math.sign(refAlong) || 1;
    // Arrows stay inside the curtain: it ends at the model top or 2 km over the highest ground on the line, whichever is lower.
    const ceiling = Math.min(top - 50, d.zMax);
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
        if (z > ceiling) break;
        let along: number;
        let vert: number;
        if (recorded) {
          this.at[0] = s * line.length;
          this.at[1] = z;
          if (!latticeInPlaneWind(d, this.stencil, this.at, this.inPlane)) continue;
          along = this.inPlane[0]!;
          vert = this.inPlane[1]!;
        } else {
          sampler.wind(x, y, z, agl, w);
          along = w[0]! * line.dir[0] + w[1]! * line.dir[1];
          vert = w[2]!;
        }
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
        const reverse = prognostic && Math.sign(along) !== refSign && Math.abs(along) > 1 && agl < 700;
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
