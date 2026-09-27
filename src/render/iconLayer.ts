/**
 * Screen-space icons (user position, ignition pins, spot fires, insight markers by severity, focus halo): instanced
 * camera-facing quads of constant pixel size sampling a procedurally drawn atlas — one draw call for all icons. Icons
 * are drawn on top of everything (no depth test) so a marker behind a ridge is still found; draped decals in the
 * terrain shader show the exact spot on the ground.
 */
import * as THREE from 'three';
import type { InsightSeverity } from '../core/types';
import { MARKER_COLOURS, SEVERITY_COLOURS } from './palette';

export enum Icon {
  User = 0,
  Ignition = 1,
  Spot = 2,
  Info = 3,
  Watch = 4,
  Danger = 5,
  Focus = 6,
}
const SLOTS = 8;
const CELL = 128;

export const severityIcon = (s: InsightSeverity): Icon => (s === 'danger' ? Icon.Danger : s === 'watch' ? Icon.Watch : Icon.Info);

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
}

/** Draw the icon atlas (browser only). */
function drawAtlas(): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = CELL * SLOTS;
  cv.height = CELL;
  const g = cv.getContext('2d')!;
  const c = CELL / 2;
  const at = (slot: number, fn: () => void): void => {
    g.save();
    g.translate(slot * CELL, 0);
    fn();
    g.restore();
  };
  const shadow = (): void => {
    g.shadowColor = 'rgba(0,0,0,0.55)';
    g.shadowBlur = 8;
    g.shadowOffsetY = 2;
  };
  const noShadow = (): void => {
    g.shadowColor = 'transparent';
  };
  const flame = (cx: number, cy: number, s: number, fill: string): void => {
    g.beginPath();
    g.moveTo(cx, cy - s);
    g.bezierCurveTo(cx + s * 0.9, cy - s * 0.2, cx + s * 0.75, cy + s * 0.75, cx, cy + s * 0.8);
    g.bezierCurveTo(cx - s * 0.75, cy + s * 0.75, cx - s * 0.9, cy - s * 0.1, cx - s * 0.15, cy - s * 0.45);
    g.bezierCurveTo(cx - s * 0.1, cy - s * 0.1, cx + s * 0.15, cy - s * 0.3, cx, cy - s);
    g.fillStyle = fill;
    g.fill();
  };
  // User: blue dot with white ring.
  at(Icon.User, () => {
    shadow();
    g.beginPath();
    g.arc(c, c, 30, 0, Math.PI * 2);
    g.fillStyle = '#ffffff';
    g.fill();
    noShadow();
    g.beginPath();
    g.arc(c, c, 22, 0, Math.PI * 2);
    g.fillStyle = MARKER_COLOURS.user;
    g.fill();
  });
  // Ignition: red map pin with a flame.
  at(Icon.Ignition, () => {
    shadow();
    g.beginPath();
    g.moveTo(c, CELL - 4);
    g.bezierCurveTo(c - 10, CELL - 30, c - 38, 70, c - 38, 44);
    g.arc(c, 44, 38, Math.PI, 0);
    g.bezierCurveTo(c + 38, 70, c + 10, CELL - 30, c, CELL - 4);
    g.fillStyle = MARKER_COLOURS.ignition;
    g.fill();
    noShadow();
    g.lineWidth = 5;
    g.strokeStyle = '#ffffff';
    g.stroke();
    flame(c, 46, 22, '#ffffff');
  });
  // Spot fire: orange disc with white flame.
  at(Icon.Spot, () => {
    shadow();
    g.beginPath();
    g.arc(c, c, 36, 0, Math.PI * 2);
    g.fillStyle = MARKER_COLOURS.spot;
    g.fill();
    noShadow();
    g.lineWidth = 6;
    g.strokeStyle = '#ffffff';
    g.stroke();
    flame(c, c + 2, 22, '#ffffff');
  });
  const letterBadge = (slot: Icon, fill: string, glyph: string, shape: 'circle' | 'triangle' | 'octagon'): void =>
    at(slot, () => {
      shadow();
      g.beginPath();
      if (shape === 'circle') g.arc(c, c, 38, 0, Math.PI * 2);
      else if (shape === 'triangle') {
        g.moveTo(c, 12);
        g.lineTo(c + 46, CELL - 22);
        g.lineTo(c - 46, CELL - 22);
        g.closePath();
      } else {
        for (let s = 0; s < 8; s++) {
          const a = Math.PI / 8 + (s * Math.PI) / 4;
          const px = c + Math.cos(a) * 42;
          const py = c + Math.sin(a) * 42;
          if (s === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.closePath();
      }
      g.fillStyle = fill;
      g.fill();
      noShadow();
      g.lineWidth = 6;
      g.strokeStyle = '#ffffff';
      g.stroke();
      g.fillStyle = shape === 'triangle' ? '#1a1a1a' : '#ffffff';
      g.font = 'bold 54px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(glyph, c, shape === 'triangle' ? c + 12 : c + 3);
    });
  letterBadge(Icon.Info, SEVERITY_COLOURS.info, 'i', 'circle');
  letterBadge(Icon.Watch, SEVERITY_COLOURS.watch, '!', 'triangle');
  letterBadge(Icon.Danger, SEVERITY_COLOURS.danger, '!', 'octagon');
  // Focus: white ring.
  at(Icon.Focus, () => {
    shadow();
    g.beginPath();
    g.arc(c, c, 52, 0, Math.PI * 2);
    g.lineWidth = 9;
    g.strokeStyle = '#ffffff';
    g.stroke();
  });
  return cv;
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
    this.atlas = typeof document !== 'undefined' ? new THREE.CanvasTexture(drawAtlas()) : null;
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
