/**
 * Screen-space icons (user position, ignition pins, spot fires, insight markers by severity, focus halo): instanced
 * camera-facing quads of constant pixel size sampling a procedurally drawn atlas — one draw call for all icons. Icons
 * are drawn on top of everything (no depth test) so a marker behind a ridge is still found; draped decals in the
 * terrain shader show the exact spot on the ground.
 */
import * as THREE from 'three';
import { Icon, ICON_SLOTS as SLOTS, iconAtlasCanvas } from './iconAtlas';
import type { MarkerSource } from './markerPick';

export { Icon, severityIcon } from './iconAtlas';

export interface IconInstance {
  icon: Icon;
  x: number;
  y: number;
  /** Elevation of the anchor (m ASL). */
  z: number;
  sizePx: number;
  /** 1 = pulse the size. */
  pulse?: boolean;
  /** Anchor at the bottom centre (pins) instead of the centre. */
  pin?: boolean;
  /** What a tap on this icon is about (SceneView.pickMarker); absent for icons that are not tappable (the focus ring). */
  marker?: MarkerSource;
}

const ICON_VERT = /* glsl */ `
uniform float uVex;
uniform vec2 uViewport;
uniform float uDpr;
uniform float uClock;
attribute vec3 aPos;
attribute vec4 aIcon; // icon, size px, pulse, pin
varying vec2 vUv;
varying float vIcon;
void main() {
  vec4 clip = projectionMatrix * viewMatrix * vec4(aPos.x, aPos.z * uVex, -aPos.y, 1.0);
  if (clip.w <= 0.0) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
  float size = aIcon.y * uDpr * (aIcon.z > 0.5 ? 1.0 + 0.18 * sin(uClock * 4.0) : 1.0);
  vec2 corner = position.xy; // −0.5 … 0.5
  vec2 anchor = aIcon.w > 0.5 ? vec2(0.0, 0.5) : vec2(0.0);
  vec2 off = (corner + anchor) * size;
  clip.xy += off / (uViewport * 0.5) * clip.w;
  clip.z = 0.0; // always inside the depth range (drawn without depth test)
  gl_Position = clip;
  vUv = vec2((aIcon.x + corner.x + 0.5) / ${SLOTS}.0, corner.y + 0.5);
  vIcon = aIcon.x;
}
`;

const ICON_FRAG = /* glsl */ `
uniform sampler2D uAtlas;
varying vec2 vUv;
varying float vIcon;
void main() {
  vec4 c = texture(uAtlas, vUv);
  if (c.a < 0.02) discard;
  gl_FragColor = c;
  #include <colorspace_fragment>
}
`;

export class IconLayer {
  readonly mesh: THREE.Mesh;
  private readonly geom: THREE.InstancedBufferGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private readonly atlas: THREE.CanvasTexture | null;
  private pos = new Float32Array(0);
  private icon = new Float32Array(0);

  constructor(shared: Record<string, THREE.IUniform>) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.instanceCount = 0;
    this.geom = g;
    const atlas = iconAtlasCanvas();
    this.atlas = atlas ? new THREE.CanvasTexture(atlas) : null;
    if (this.atlas) {
      this.atlas.colorSpace = THREE.SRGBColorSpace;
      this.atlas.generateMipmaps = true;
      this.atlas.minFilter = THREE.LinearMipmapLinearFilter;
      this.atlas.premultiplyAlpha = false;
    }
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uVex: shared.uVex!,
        uViewport: shared.uViewport!,
        uDpr: shared.uDpr!,
        uClock: shared.uClock!,
        uAtlas: { value: this.atlas },
      },
      vertexShader: ICON_VERT,
      fragmentShader: ICON_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.name = 'icons';
  }

  set(icons: IconInstance[]): void {
    const n = icons.length;
    if (this.pos.length < n * 3) {
      this.geom.dispose(); // free the old GPU buffers before replacing the attributes
      this.pos = new Float32Array(Math.max(16, n) * 3);
      this.icon = new Float32Array(Math.max(16, n) * 4);
      this.geom.setAttribute('aPos', new THREE.InstancedBufferAttribute(this.pos, 3));
      this.geom.setAttribute('aIcon', new THREE.InstancedBufferAttribute(this.icon, 4));
    }
    // Draw order: focus halo first, then insights, spots, ignitions, user on top.
    const order = icons.slice().sort((a, b) => rank(a.icon) - rank(b.icon));
    for (let s = 0; s < n; s++) {
      const ic = order[s]!;
      this.pos[s * 3] = ic.x;
      this.pos[s * 3 + 1] = ic.y;
      this.pos[s * 3 + 2] = ic.z;
      this.icon[s * 4] = ic.icon;
      this.icon[s * 4 + 1] = ic.sizePx;
      this.icon[s * 4 + 2] = ic.pulse ? 1 : 0;
      this.icon[s * 4 + 3] = ic.pin ? 1 : 0;
    }
    if (n > 0) {
      this.geom.getAttribute('aPos').needsUpdate = true;
      this.geom.getAttribute('aIcon').needsUpdate = true;
    }
    this.geom.instanceCount = n;
  }

  dispose(): void {
    this.geom.dispose();
    this.mat.dispose();
    this.atlas?.dispose();
  }
}

function rank(i: Icon): number {
  switch (i) {
    case Icon.Focus:
      return 0;
    case Icon.Info:
    case Icon.Watch:
    case Icon.Danger:
      return 1;
    case Icon.Spot:
      return 2;
    case Icon.Ignition:
      return 3;
    case Icon.User:
      return 4;
  }
}
