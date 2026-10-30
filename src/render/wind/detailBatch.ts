/** Stub (0.6.0 C0): the D-render lane writes the shader and the body. One instanced quad per segment of the detailed streaks; for now a material that draws nothing. */
import * as THREE from 'three';

const DETAIL_VERT = /* glsl */ `
uniform float uTime;
uniform float uMoving;
uniform float uFade;
uniform float uWidthPx;
uniform float uPxPerM1;
uniform vec2 uViewport;
uniform float uDepthBias;
attribute vec3 aA;
attribute vec3 aB;
attribute vec4 aC;
attribute vec4 aD;
attribute vec4 aE;
void main() {
  gl_Position = vec4(0.0, 0.0, -2.0, 1.0); // clipped: nothing is drawn until the lane writes the shader
}
`;

const DETAIL_FRAG = /* glsl */ `
void main() {
  discard;
}
`;

export class DetailBatch {
  readonly mesh: THREE.Mesh;
  readonly a: Float32Array;
  readonly b: Float32Array;
  readonly c: Float32Array;
  readonly d: Float32Array;
  readonly e: Float32Array;
  readonly capacity: number;
  private readonly geom: THREE.InstancedBufferGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private readonly attrs: THREE.InstancedBufferAttribute[];
  private readonly uniforms: Record<string, THREE.IUniform>;

  constructor(o: { capacity: number; widthPx: number; depthBiasM: number; shared: Record<string, THREE.IUniform> }) {
    this.capacity = o.capacity;
    this.a = new Float32Array(o.capacity * 3);
    this.b = new Float32Array(o.capacity * 3);
    this.c = new Float32Array(o.capacity * 4);
    this.d = new Float32Array(o.capacity * 4);
    this.e = new Float32Array(o.capacity * 4);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const arrays: [string, Float32Array, number][] = [
      ['aA', this.a, 3],
      ['aB', this.b, 3],
      ['aC', this.c, 4],
      ['aD', this.d, 4],
      ['aE', this.e, 4],
    ];
    this.attrs = arrays.map(([name, array, size]) => {
      const at = new THREE.InstancedBufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, at);
      return at;
    });
    g.instanceCount = 0;
    this.geom = g;
    this.uniforms = {
      uTime: o.shared.uClock ?? { value: 0 }, // the view's clock (SceneView's `uClock`)
      uMoving: { value: 1 },
      uFade: { value: 1 },
      uWidthPx: { value: o.widthPx },
      uPxPerM1: { value: 1 },
      uViewport: o.shared.uViewport!,
      uDepthBias: { value: o.depthBiasM },
    };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: DETAIL_VERT,
      fragmentShader: DETAIL_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
  }

  /** Upload the first `n` segments. */
  commit(n: number): void {
    const count = Math.min(n, this.capacity);
    this.geom.instanceCount = count;
    for (const at of this.attrs) {
      at.clearUpdateRanges();
      at.addUpdateRange(0, count * at.itemSize);
      at.needsUpdate = true;
    }
  }

  /** `false` draws the frozen frame (reduced motion). */
  setMoving(on: boolean): void {
    this.uniforms.uMoving!.value = on ? 1 : 0;
  }

  /** 0 to 1: the fade of the whole batch on entering and leaving the level. */
  setFade(f: number): void {
    this.uniforms.uFade!.value = f;
  }

  /** Pixels one metre covers at distance 1 (`css.h / (2 tan(fov / 2))`). */
  setPxPerM1(v: number): void {
    this.uniforms.uPxPerM1!.value = v;
  }

  set widthPx(v: number) {
    this.uniforms.uWidthPx!.value = v;
  }

  dispose(): void {
    this.geom.dispose();
    this.mat.dispose();
  }
}
