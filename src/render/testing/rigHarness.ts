/**
 * Test helper: a real CameraRig driven with a minimal fake element (no browser), a fake multi-touch hand, and the real
 * Katoomba terrain (the bundled 10 m DEM, decimated like the renderer does). Used by the camera tests that need relief:
 * `cameraRig.relief.test.ts`. The older `cameraRig.gestures.test.ts` has its own copy of the fake DOM and synthetic terrain.
 */
import * as THREE from 'three';
import { makeGridSpec } from '../../core/grid';
import { loadDemoDem } from '../../data';
import { CameraRig } from '../cameraRig';
import { decimateGrid } from '../fields';
import { rayDirection } from '../groundPan';
import { HeightField } from '../heightfield';

// ───────────── a minimal DOM ─────────────

interface Listener {
  type: string;
  fn: (e: FakeEvent) => void;
  capture: boolean;
}
interface FakeEvent {
  type: string;
  pointerId: number;
  pointerType: string;
  isPrimary: boolean;
  button: number;
  clientX: number;
  clientY: number;
  pageX: number;
  pageY: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  stopped: boolean;
  immediate: boolean;
  stopPropagation(): void;
  stopImmediatePropagation(): void;
  preventDefault(): void;
}

class FakeTarget {
  readonly listeners: Listener[] = [];
  addEventListener(type: string, fn: (e: FakeEvent) => void, opts?: boolean | { capture?: boolean }): void {
    this.listeners.push({ type, fn, capture: typeof opts === 'boolean' ? opts : !!opts?.capture });
  }
  removeEventListener(type: string, fn: (e: FakeEvent) => void, opts?: boolean | { capture?: boolean }): void {
    const capture = typeof opts === 'boolean' ? opts : !!opts?.capture;
    const i = this.listeners.findIndex((l) => l.type === type && l.fn === fn && l.capture === capture);
    if (i >= 0) this.listeners.splice(i, 1);
  }
}

/** Canvas size (CSS px) of the harness: a phone in portrait. */
export const W = 400;
export const H = 800;

class FakeElement extends FakeTarget {
  readonly style: Record<string, string> = {};
  clientWidth = W;
  clientHeight = H;
  constructor(readonly doc: FakeTarget) {
    super();
  }
  get ownerDocument(): FakeTarget {
    return this.doc;
  }
  getRootNode(): FakeTarget {
    return this.doc;
  }
  setPointerCapture(): void {}
  releasePointerCapture(): void {}
  getBoundingClientRect(): { left: number; top: number; width: number; height: number; right: number; bottom: number } {
    return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight, right: this.clientWidth, bottom: this.clientHeight };
  }

  /** Dispatch like the DOM does for a pointer event on this element: target capture, target bubble, then the document. */
  fire(type: string, init: Partial<FakeEvent>): FakeEvent {
    const e: FakeEvent = {
      type,
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: false,
      button: 0,
      clientX: 0,
      clientY: 0,
      pageX: 0,
      pageY: 0,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      stopped: false,
      immediate: false,
      stopPropagation() {
        this.stopped = true;
      },
      stopImmediatePropagation() {
        this.stopped = true;
        this.immediate = true;
      },
      preventDefault() {},
      ...init,
    };
    e.pageX = e.clientX;
    e.pageY = e.clientY;
    const run = (list: Listener[]): void => {
      for (const l of [...list]) {
        if (e.immediate) return;
        l.fn(e);
      }
    };
    const own = this.listeners.filter((l) => l.type === type);
    run(own.filter((l) => l.capture));
    run(own.filter((l) => !l.capture));
    if (!e.stopped) run(this.doc.listeners.filter((l) => l.type === type && !l.capture));
    return e;
  }
}

// ───────────── the real terrain ─────────────

const cache = new Map<number, Promise<HeightField>>();

/** The bundled Katoomba 10 m DEM as the renderer's heightfield: decimated to `mesh` samples per side (320 = the medium quality tier). */
export function katoombaHeightField(mesh = 320): Promise<HeightField> {
  let p = cache.get(mesh);
  if (!p) {
    p = (async () => {
      const dem = await loadDemoDem('katoomba');
      if (!dem) throw new Error('the bundled Katoomba DEM is missing');
      const rg = decimateGrid(dem.grid, dem.elevation, mesh);
      return new HeightField(rg.grid, rg.elevation, 1);
    })();
    cache.set(mesh, p);
  }
  return p;
}

/** A small synthetic terrain (the same grid as the gesture tests') for tests that do not need real relief. */
export function syntheticHeightField(fn: (x: number, y: number) => number): HeightField {
  const g = makeGridSpec({ lat: -33.7, lon: 150.3 }, 9000, 50);
  const z = new Float32Array(g.nx * g.ny);
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) z[j * g.nx + i] = fn(g.x0 + i * g.cellSize, g.y0 + j * g.cellSize);
  return new HeightField(g, z, 1);
}

// ───────────── the rig and a hand ─────────────

export interface RigHarness {
  rig: CameraRig;
  hf: HeightField;
  /** Advance n frames of 16 ms; returns what update() reported for each. */
  frames(n: number): boolean[];
  /** Finger events by pointer id. */
  down(id: number, x: number, y: number): void;
  move(id: number, x: number, y: number): void;
  up(id: number): void;
  /** Fingers by id. */
  at: Map<number, [number, number]>;
  /**
   * Put the camera `distance` m from the ground point (x, y) (local metres), looking from compass azimuth `azDeg` with the
   * polar angle `polarDeg` (from vertical), and let it settle (30 frames).
   */
  viewAt(x: number, y: number, distance: number, polarDeg: number, azDeg?: number): void;
  /** Canvas position (px) of a local ground point. */
  screenOfGround(p: [number, number]): [number, number];
  /** Local (x, y) of the terrain under a canvas position, as the picking does it; null when there is none. */
  pick(x: number, y: number): [number, number] | null;
  /**
   * Distance (m) from the camera to the visible ground at the middle of the canvas: the picture's scale there (ground metres per
   * pixel = this × 2 tan(fov / 2) ÷ canvas height). NaN when the middle of the canvas shows no ground.
   */
  centreRange(): number;
}

export function makeRig(hf: HeightField): RigHarness {
  const doc = new FakeTarget();
  const el = new FakeElement(doc);
  const rig = new CameraRig(el as unknown as HTMLElement, W / H);
  rig.setHeightField(hf);
  rig.resize(W / H, W, H);
  rig.home(false);
  let clock = performance.now();
  const at = new Map<number, [number, number]>();
  const h: RigHarness = {
    rig,
    hf,
    at,
    frames(n) {
      const out: boolean[] = [];
      for (let i = 0; i < n; i++) {
        clock += 16;
        out.push(rig.update(clock));
      }
      return out;
    },
    down(id, x, y) {
      const primary = at.size === 0;
      at.set(id, [x, y]);
      el.fire('pointerdown', { pointerId: id, clientX: x, clientY: y, isPrimary: primary });
    },
    move(id, x, y) {
      at.set(id, [x, y]);
      el.fire('pointermove', { pointerId: id, clientX: x, clientY: y });
    },
    up(id) {
      const [x, y] = at.get(id) ?? [0, 0];
      at.delete(id);
      el.fire('pointerup', { pointerId: id, clientX: x, clientY: y });
    },
    viewAt(x, y, distance, polarDeg, azDeg = 200) {
      const t = rig.groundPoint(x, y);
      const az = THREE.MathUtils.degToRad(azDeg);
      const po = THREE.MathUtils.degToRad(polarDeg);
      rig.goTo(t, new THREE.Vector3(t.x + Math.sin(az) * Math.sin(po) * distance, t.y + Math.cos(po) * distance, t.z - Math.cos(az) * Math.sin(po) * distance), 0);
      h.frames(30);
    },
    screenOfGround(p) {
      const v = rig.groundPoint(p[0], p[1]).project(rig.camera);
      return [((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H];
    },
    pick(x, y) {
      const cam = rig.camera;
      cam.updateMatrixWorld();
      const d = rayDirection(cam, (x / W) * 2 - 1, -(y / H) * 2 + 1, new THREE.Vector3());
      const hit = hf.raycast(cam.position.x, cam.position.y, cam.position.z, d.x, d.y, d.z);
      return hit ? [hit.x, hit.y] : null;
    },
    centreRange() {
      const cam = rig.camera;
      cam.updateMatrixWorld();
      const d = rayDirection(cam, 0, 0, new THREE.Vector3());
      const hit = hf.raycast(cam.position.x, cam.position.y, cam.position.z, d.x, d.y, d.z);
      return hit ? hit.t : NaN;
    },
  };
  h.frames(3);
  return h;
}

// ───────────── a measured drag ─────────────

export interface DragSpec {
  /** The ground point (local metres) the camera looks at, its distance (m), polar angle (deg from vertical) and compass azimuth (deg). */
  x: number;
  y: number;
  distance: number;
  polar: number;
  az?: number;
  /** The top view (mode 'top', straight down) instead of the orbit view; `polar` is then ignored. */
  top?: boolean;
  /** The finger drags `len` px along the screen direction `dirDeg` (0 = right, 90 = down), centred on the middle of the canvas, at `speed` px/s. */
  len: number;
  dirDeg: number;
  speed?: number;
  /** Frames to watch after the lift (default 240 = 3.8 s); stops earlier once the rig has been still for 30 frames. */
  settle?: number;
}

export interface DragResult {
  /** Camera steps during the drag, metres per frame (over the ground, and in 3-D). */
  peakStep: number;
  avgStep: number;
  peakStep3: number;
  /** Length of the camera's path over the ground ÷ the straight distance between its ends. */
  pathOverNet: number;
  /** Where the ground point under the finger ended up relative to the finger at the lift (px). */
  grabError: number;
  /** After the lift, how far (px) the ground point that was under the finger moved on the screen: the largest and the final value. */
  creepMax: number;
  creepFinal: number;
  /** Largest on-screen step (px per frame) of that ground point after the lift. */
  creepStep: number;
  /** End ÷ start of the orbit distance, and of the distance to the visible ground at the middle of the canvas (the picture's scale there), for the whole drag + settle. */
  distanceRatio: number;
  scaleRatio: number;
  /** The camera's height above the ground under it: the smallest during the run, and the change over the settle (m). */
  minAgl: number;
  /** Frames until the rig was still (after the lift). */
  settledAfter: number;
  /** The lift started a glide (a fast finger): the picture then moves on purpose, so its creep is not a measure of anything. */
  glided: boolean;
  /** The orbit target reached the edge of the domain (the clamp pushes the camera then). */
  edge: boolean;
  /** The camera came within 4 % of the orbit distance of the terrain (the clearance clamp holds it up, it is "flying into the ground"). */
  grounded: boolean;
  /** Largest and smallest distance during the run (m). */
  maxDistance: number;
  minDistance: number;
  /** Largest change of the camera's step from one frame to the next, in units of its average step (a flip-flop is many; smooth speeding up is ~0.1). */
  jerk: number;
  /** Frames in which the camera stepped backwards (against the whole drag's direction). */
  reversals: number;
  /** Frames in which the camera's step pointed against its previous step (a flip-flop; a steady drag has none). */
  flips: number;
}

/** Run one measured drag with the rig as it is; null when the finger would start on the sky. */
export function runDrag(h: RigHarness, s: DragSpec): DragResult | null {
  const rig = h.rig;
  if (rig.mode !== 'orbit') {
    rig.setMode('orbit');
    for (let i = 0; i < 400 && rig.flying; i++) h.frames(1);
  }
  h.viewAt(s.x, s.y, s.distance, s.top ? 0.5 : s.polar, s.az ?? 200);
  if (s.top) {
    rig.setMode('top');
    for (let i = 0; i < 400 && rig.flying; i++) h.frames(1);
    h.frames(10);
  }
  const dir = [Math.cos((s.dirDeg * Math.PI) / 180), Math.sin((s.dirDeg * Math.PI) / 180)] as const;
  const from: [number, number] = [W / 2 - (s.len / 2) * dir[0], H / 2 - (s.len / 2) * dir[1]];
  const grabbed = h.pick(from[0], from[1]);
  if (!grabbed) return null;
  const d0 = rig.cameraState().distance;
  const g0 = h.centreRange();
  const cam = rig.camera.position;
  const aglOf = (): number => cam.y - h.hf.worldHeightAt(THREE.MathUtils.clamp(cam.x, h.hf.xMin, h.hf.xMax), THREE.MathUtils.clamp(-cam.z, h.hf.yMin, h.hf.yMax));
  let minAgl = aglOf();
  let maxD = d0;
  let minD = d0;
  let edge = false;
  let grounded = false;
  const track = (): void => {
    const agl = aglOf();
    minAgl = Math.min(minAgl, agl);
    const t = rig.controls.target;
    if (t.x <= h.hf.xMin + 1 || t.x >= h.hf.xMax - 1 || -t.z <= h.hf.yMin + 1 || -t.z >= h.hf.yMax - 1) edge = true;
    if (agl < 0.04 * rig.cameraState().distance) grounded = true;
    const d = rig.cameraState().distance;
    maxD = Math.max(maxD, d);
    minD = Math.min(minD, d);
  };
  h.down(1, from[0], from[1]);
  const per = ((s.speed ?? 100) * 0.016) / 1; // px per frame
  const n = Math.max(1, Math.round(s.len / per));
  const pts: THREE.Vector3[] = [cam.clone()];
  for (let i = 1; i <= n; i++) {
    h.move(1, from[0] + (dir[0] * s.len * i) / n, from[1] + (dir[1] * s.len * i) / n);
    h.frames(1);
    pts.push(cam.clone());
    track();
  }
  const steps: number[] = [];
  const steps3: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    steps.push(Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z));
    steps3.push(pts[i]!.distanceTo(pts[i - 1]!));
  }
  const path = steps.reduce((a, b) => a + b, 0);
  let jerk = 0;
  let reversals = 0;
  let flips = 0;
  const nx = pts.at(-1)!.x - pts[0]!.x;
  const nz = pts.at(-1)!.z - pts[0]!.z;
  for (let i = 1; i < pts.length; i++) {
    const sx = pts[i]!.x - pts[i - 1]!.x;
    const sz = pts[i]!.z - pts[i - 1]!.z;
    if (sx * nx + sz * nz < 0) reversals++;
    if (i > 1) jerk = Math.max(jerk, Math.hypot(sx - (pts[i - 1]!.x - pts[i - 2]!.x), sz - (pts[i - 1]!.z - pts[i - 2]!.z)));
  }
  jerk /= Math.max(1e-9, path / steps.length);
  for (let i = 2; i < pts.length; i++) {
    const ax = pts[i - 1]!.x - pts[i - 2]!.x;
    const az = pts[i - 1]!.z - pts[i - 2]!.z;
    const bx = pts[i]!.x - pts[i - 1]!.x;
    const bz = pts[i]!.z - pts[i - 1]!.z;
    const small = 0.2 * (path / steps.length);
    if (Math.hypot(ax, az) > small && Math.hypot(bx, bz) > small && ax * bx + az * bz < 0) flips++;
  }
  const net = Math.hypot(pts.at(-1)!.x - pts[0]!.x, pts.at(-1)!.z - pts[0]!.z);
  const end: [number, number] = [from[0] + dir[0] * s.len, from[1] + dir[1] * s.len];
  const under = h.screenOfGround(grabbed);
  const grabError = Math.hypot(under[0] - end[0], under[1] - end[1]);
  h.up(1);
  const glided = rig.gliding;
  const ref = h.screenOfGround(grabbed);
  let prev = ref;
  let creepMax = 0;
  let creepStep = 0;
  let still = 0;
  let settledAfter = s.settle ?? 240;
  const prevCam = cam.clone();
  const prevTgt = rig.controls.target.clone();
  for (let i = 1; i <= (s.settle ?? 240); i++) {
    h.frames(1);
    track();
    const p = h.screenOfGround(grabbed);
    creepMax = Math.max(creepMax, Math.hypot(p[0] - ref[0], p[1] - ref[1]));
    creepStep = Math.max(creepStep, Math.hypot(p[0] - prev[0], p[1] - prev[1]));
    prev = p;
    const moved = cam.distanceToSquared(prevCam) + rig.controls.target.distanceToSquared(prevTgt);
    prevCam.copy(cam);
    prevTgt.copy(rig.controls.target);
    still = moved < 1e-6 ? still + 1 : 0;
    if (still >= 30) {
      settledAfter = i - 30;
      break;
    }
  }
  const fin = h.screenOfGround(grabbed);
  const g1 = h.centreRange();
  return {
    peakStep: Math.max(...steps),
    avgStep: path / steps.length,
    peakStep3: Math.max(...steps3),
    pathOverNet: net > 1e-6 ? path / net : 1,
    grabError,
    creepMax,
    creepFinal: Math.hypot(fin[0] - ref[0], fin[1] - ref[1]),
    creepStep,
    distanceRatio: rig.cameraState().distance / d0,
    scaleRatio: g1 / g0,
    minAgl,
    settledAfter,
    glided,
    edge,
    grounded,
    maxDistance: maxD,
    minDistance: minD,
    jerk,
    reversals,
    flips,
  };
}
