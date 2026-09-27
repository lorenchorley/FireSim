/**
 * Sky dome: a camera-centred sphere with a zenith–horizon gradient, sun disc and glow, a hazy "ground" below the
 * horizon (the model domain floats on it like a diorama) and faint stars at night. One draw call.
 */
import * as THREE from 'three';
import { NOISE, TONEMAP } from './glsl';

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
  gl_Position = p.xyww; // on the far plane
}
`;

const SKY_FRAG = /* glsl */ `
${NOISE}
${TONEMAP}
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColour;
uniform float uSunI;
uniform float uNight;
uniform vec3 uFogColour;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float e = d.y;
  vec3 col;
  if (e >= 0.0) {
    col = mix(uHorizon, uZenith, pow(e, 0.55));
  } else {
    col = mix(uHorizon, uFogColour * 0.55, smoothstep(0.0, 0.25, -e));
  }
  float s = max(dot(d, uSunDir), 0.0);
  // Sun disc (~0.6°), a tight aureole and a broad forward-scatter glow (stronger in smoke haze near the horizon).
  float disc = smoothstep(0.99994, 0.99997, s);
  col += uSunColour * (disc * 6.0 + pow(s, 400.0) * 0.6 + pow(s, 12.0) * 0.12) * min(uSunI, 1.5) * step(-0.02, uSunDir.y);
  if (uNight > 0.0 && e > 0.0) {
    vec2 q = vec2(atan(d.z, d.x) * 180.0, e * 300.0);
    float st = step(0.9965, fsHash(floor(q)));
    col += vec3(0.8, 0.85, 1.0) * st * uNight * 0.7 * smoothstep(0.0, 0.2, e);
  }
  gl_FragColor = vec4(fsDisplay(col), 1.0);
  #include <colorspace_fragment>
}
`;

export class SkyDome {
  readonly mesh: THREE.Mesh;
  readonly uniforms: Record<string, THREE.IUniform>;
  private readonly geom: THREE.SphereGeometry;
  private readonly mat: THREE.ShaderMaterial;

  constructor(shared: Record<string, THREE.IUniform>) {
    this.geom = new THREE.SphereGeometry(1000, 32, 16);
    this.uniforms = {
      uZenith: { value: new THREE.Color(0.2, 0.35, 0.7) },
      uHorizon: { value: new THREE.Color(0.7, 0.8, 0.9) },
    };
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        ...this.uniforms,
        uSunDir: shared.uSunDir!,
        uSunColour: shared.uSunColour!,
        uSunI: shared.uSunI!,
        uNight: shared.uNight!,
        uExposure: shared.uExposure!,
        uFogColour: shared.uFogColour!,
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(this.geom, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    this.mesh.name = 'sky';
  }

  dispose(): void {
    this.geom.dispose();
    this.mat.dispose();
  }
}
